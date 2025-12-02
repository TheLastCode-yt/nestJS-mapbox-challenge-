import {
  Injectable,
  BadRequestException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Minio from 'minio';
import { randomUUID } from 'crypto';
import * as path from 'path';

/**
 * Enum para tipos de buckets disponíveis no MinIO
 */
export enum BucketType {
  LOCATIONS = 'locations',
}

@Injectable()
export class MinioService implements OnModuleInit {
  private readonly logger = new Logger(MinioService.name);
  private minioClient: Minio.Client;
  private readonly bucketName: string;

  constructor(private configService: ConfigService) {
    const port = this.configService.get<string>('MINIO_PORT');

    this.minioClient = new Minio.Client({
      endPoint: this.configService.get<string>('MINIO_ENDPOINT') || 'localhost',
      port: port ? parseInt(port, 10) : 9000,
      useSSL: this.configService.get<string>('MINIO_USE_SSL') === 'true',
      accessKey: this.configService.get<string>('MINIO_ACCESS_KEY'),
      secretKey: this.configService.get<string>('MINIO_SECRET_KEY'),
    });

    this.bucketName =
      this.configService.get<string>('MINIO_BUCKET_NAME') || 'default';
  }

  async onModuleInit() {
    await this.initializeBuckets();
  }

  /**
   * Inicializa todos os buckets necessários com políticas de leitura pública
   */
  private async initializeBuckets(): Promise<void> {
    // ✅ Usar Object.values é mais elegante e manutenível
    const bucketsToInitialize = Object.values(BucketType);

    for (const bucketName of bucketsToInitialize) {
      await this.initializeBucket(bucketName);
    }
  }

  /**
   * Inicializa um bucket específico com política de leitura pública
   * Operações de escrita/deleção requerem autenticação na aplicação
   */
  private async initializeBucket(bucketName: string): Promise<void> {
    try {
      const bucketExists = await this.minioClient.bucketExists(bucketName);

      if (!bucketExists) {
        await this.minioClient.makeBucket(bucketName, 'us-east-1');
        this.logger.log(`Bucket ${bucketName} criado com sucesso`);

        // Política de leitura pública (GetObject)
        const policy = {
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Principal: { AWS: ['*'] },
              Action: ['s3:GetObject'],
              Resource: [`arn:aws:s3:::${bucketName}/*`],
            },
          ],
        };

        await this.minioClient.setBucketPolicy(
          bucketName,
          JSON.stringify(policy),
        );
        this.logger.log(
          `Política de leitura pública configurada para bucket ${bucketName}`,
        );
      } else {
        this.logger.log(`Bucket ${bucketName} já existe`);
      }
    } catch (error) {
      this.logger.error(
        `Erro ao inicializar bucket ${bucketName}: ${error.message}`,
      );
      this.logger.warn(
        `A aplicação continuará, mas uploads para ${bucketName} podem falhar`,
      );
    }
  }

  /**
   * Faz upload de um arquivo
   * @param file - Arquivo enviado via multer
   * @param bucketType - Tipo do bucket (LOCATIONS)
   * @returns Caminho do arquivo no formato: bucket/uuid.ext
   */
  async uploadFile(
    file: Express.Multer.File,
    bucketType: BucketType = BucketType.LOCATIONS,
  ): Promise<string> {
    try {
      if (!file) {
        throw new BadRequestException('Nenhum arquivo fornecido');
      }

      this.validateFile(file);

      const bucketName = bucketType;
      const fileExtension = path.extname(file.originalname);
      const fileName = `${randomUUID()}${fileExtension}`;

      const metaData = {
        'Content-Type': file.mimetype,
        'X-Amz-Meta-Original-Name': Buffer.from(file.originalname).toString(
          'base64',
        ),
      };

      await this.minioClient.putObject(
        bucketName,
        fileName,
        file.buffer,
        file.size,
        metaData,
      );

      const filePath = `${bucketName}/${fileName}`;
      this.logger.log(`Arquivo enviado: ${filePath}`);

      return filePath;
    } catch (error) {
      this.logger.error(`Erro ao fazer upload: ${error.message}`);
      throw new BadRequestException(`Erro no upload: ${error.message}`);
    }
  }

  /**
   * Faz upload de múltiplos arquivos
   */
  async uploadMultipleFiles(
    files: Express.Multer.File[],
    bucketType: BucketType = BucketType.LOCATIONS,
  ): Promise<string[]> {
    try {
      if (!files || files.length === 0) {
        throw new BadRequestException('Nenhum arquivo fornecido');
      }

      const uploadPromises = files.map((file) =>
        this.uploadFile(file, bucketType),
      );
      return await Promise.all(uploadPromises);
    } catch (error) {
      this.logger.error(`Erro ao fazer upload múltiplo: ${error.message}`);
      throw new BadRequestException(`Erro no upload: ${error.message}`);
    }
  }

  /**
   * Remove um arquivo do MinIO
   * @param filePath - Caminho completo: bucket/filename.ext
   */
  async deleteFile(filePath: string): Promise<void> {
    try {
      if (!filePath) {
        throw new BadRequestException('Caminho do arquivo não fornecido');
      }

      const { bucketName, fileName } = this.extractBucketAndFileName(filePath);

      if (!bucketName || !fileName) {
        throw new BadRequestException('Caminho do arquivo inválido');
      }

      const exists = await this.fileExists(bucketName, fileName);
      if (!exists) {
        this.logger.warn(`Arquivo não encontrado: ${bucketName}/${fileName}`);
        return;
      }

      await this.minioClient.removeObject(bucketName, fileName);
      this.logger.log(`Arquivo deletado: ${bucketName}/${fileName}`);
    } catch (error) {
      this.logger.error(`Erro ao deletar arquivo: ${error.message}`);
      throw new BadRequestException(`Erro ao deletar: ${error.message}`);
    }
  }

  /**
   * Remove múltiplos arquivos
   */
  async deleteMultipleFiles(filePaths: string[]): Promise<void> {
    try {
      if (!filePaths || filePaths.length === 0) {
        return;
      }

      const deletePromises = filePaths
        .filter((path) => path)
        .map((path) => this.deleteFile(path));

      await Promise.all(deletePromises);
    } catch (error) {
      this.logger.error(`Erro ao deletar arquivos: ${error.message}`);
      throw new BadRequestException(`Erro ao deletar: ${error.message}`);
    }
  }

  /**
   * Gera URL pública do arquivo
   * @param filePath - Caminho: bucket/filename.ext
   * @returns URL pública do arquivo
   */
  getFileUrl(filePath: string): string {
    if (!filePath) {
      return '';
    }

    const { bucketName, fileName } = this.extractBucketAndFileName(filePath);
    if (!bucketName || !fileName) {
      return '';
    }

    const endpoint = this.configService.get<string>('MINIO_ENDPOINT');
    const port = this.configService.get<string>('MINIO_PORT');
    const useSSL = this.configService.get<string>('MINIO_USE_SSL') === 'true';
    const protocol = useSSL ? 'https' : 'http';

    const portSuffix =
      (useSSL && port === '443') || (!useSSL && port === '80')
        ? ''
        : `:${port}`;

    return `${protocol}://${endpoint}${portSuffix}/${bucketName}/${fileName}`;
  }

  /**
   * Gera URLs públicas para múltiplos arquivos
   */
  getMultipleFileUrls(filePaths: string[]): string[] {
    if (!filePaths || filePaths.length === 0) {
      return [];
    }

    return filePaths.map((path) => this.getFileUrl(path));
  }

  /**
   * Valida o arquivo (tamanho e tipo)
   */
  private validateFile(file: Express.Multer.File): void {
    const maxSize = 12 * 1024 * 1024; // 12MB
    if (file.size > maxSize) {
      throw new BadRequestException('Arquivo maior que 12MB');
    }

    if (file.size === 0) {
      throw new BadRequestException('Arquivo vazio');
    }

    const allowedTypes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/svg+xml',
    ];

    if (!allowedTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        `Tipo de arquivo não permitido: ${file.mimetype}. Tipos permitidos: ${allowedTypes.join(', ')}`,
      );
    }
  }

  /**
   * Extrai o bucket e o nome do arquivo do caminho completo
   * @param filePath - Caminho no formato: bucket/filename.ext
   * @returns Objeto com bucketName e fileName
   */
  private extractBucketAndFileName(filePath: string): {
    bucketName: string | null;
    fileName: string | null;
  } {
    try {
      if (!filePath || typeof filePath !== 'string') {
        return { bucketName: null, fileName: null };
      }

      filePath = filePath.trim();
      const parts = filePath.split('/');

      if (parts.length < 2) {
        return { bucketName: null, fileName: null };
      }

      const bucketName = parts[0];
      const fileName = parts.slice(1).join('/');

      // ✅ Validação simplificada: aceita buckets válidos
      const validBuckets = Object.values(BucketType) as string[];

      if (!validBuckets.includes(bucketName)) {
        this.logger.warn(
          `Bucket '${bucketName}' não é um bucket válido. Buckets válidos: ${validBuckets.join(', ')}`,
        );
        // Retorna null para forçar validação apropriada
        return { bucketName: null, fileName: null };
      }

      return { bucketName, fileName };
    } catch (error) {
      this.logger.error(
        `Erro ao extrair bucket e nome do arquivo: ${error.message}`,
      );
      return { bucketName: null, fileName: null };
    }
  }

  /**
   * Verifica se arquivo existe
   */
  private async fileExists(
    bucketName: string,
    fileName: string,
  ): Promise<boolean> {
    try {
      await this.minioClient.statObject(bucketName, fileName);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Obter informações do arquivo
   */
  async getFileInfo(filePath: string): Promise<Minio.BucketItemStat | null> {
    try {
      const { bucketName, fileName } = this.extractBucketAndFileName(filePath);
      if (!bucketName || !fileName) return null;

      return await this.minioClient.statObject(bucketName, fileName);
    } catch (error) {
      this.logger.error(`Erro ao obter info do arquivo: ${error.message}`);
      return null;
    }
  }
}
