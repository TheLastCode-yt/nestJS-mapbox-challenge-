import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MapboxService } from '../mapbox/mapbox.service';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { MinioService, BucketType } from '../minio/minio.service';

@Injectable()
export class LocationsService {
  constructor(
    private prisma: PrismaService,
    private mapboxService: MapboxService,
    private minioService: MinioService,
  ) { }

  async create(
    createLocationDto: CreateLocationDto,
    userId: string,
    imageFile?: Express.Multer.File,
  ) {
    const { address, name, description, image } = createLocationDto;

    const { latitude, longitude } =
      await this.mapboxService.geocodeAddress(address);

    let imageUrl = image;
    let uploadedFilePath: string | null = null;

    try {
      if (imageFile) {
        uploadedFilePath = await this.minioService.uploadFile(
          imageFile,
          BucketType.LOCATIONS,
        );
        imageUrl = this.minioService.getFileUrl(uploadedFilePath);
      }

      const location = await this.prisma.location.create({
        data: {
          name,
          description,
          latitude,
          longitude,
          image: imageUrl,
          userId,
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });

      return location;
    } catch (error) {
      // Rollback: delete uploaded file if database operation fails
      if (uploadedFilePath) {
        await this.minioService.deleteFile(uploadedFilePath).catch(err => {
          console.error('Failed to cleanup uploaded file during rollback:', err);
        });
      }
      throw error;
    }
  }

  async findAll(page: number = 1, limit: number = 10) {
    const skip = (page - 1) * limit;

    const [locations, total] = await Promise.all([
      this.prisma.location.findMany({
        skip,
        take: limit,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      }),
      this.prisma.location.count(),
    ]);

    return {
      data: locations,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string) {
    const location = await this.prisma.location.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    if (!location) {
      throw new NotFoundException('Location not found');
    }

    return location;
  }

  async update(
    id: string,
    updateLocationDto: UpdateLocationDto,
    imageFile?: Express.Multer.File,
  ) {
    const existingLocation = await this.findOne(id);

    const { address, keepImage, ...rest } = updateLocationDto;
    let coordinates = {};
    let imageUrl: string | undefined = undefined;
    let uploadedFilePath: string | null = null;
    let oldImagePath: string | null = null;

    try {
      // Handle address geocoding
      if (address) {
        const { latitude, longitude } =
          await this.mapboxService.geocodeAddress(address);
        coordinates = { latitude, longitude };
      }

      // Handle image upload
      if (imageFile) {
        // Upload new image first
        uploadedFilePath = await this.minioService.uploadFile(
          imageFile,
          BucketType.LOCATIONS,
        );
        imageUrl = this.minioService.getFileUrl(uploadedFilePath);

        // Mark old image for deletion (only if it's a MinIO path)
        if (existingLocation.image && this.isMinioPath(existingLocation.image)) {
          oldImagePath = this.extractMinioPath(existingLocation.image);
        }
      } else if (keepImage === false && existingLocation.image) {
        // User explicitly wants to remove image without providing a new one
        imageUrl = '';
        if (this.isMinioPath(existingLocation.image)) {
          oldImagePath = this.extractMinioPath(existingLocation.image);
        }
      }

      // Update location
      const updateData: any = {
        ...rest,
        ...coordinates,
      };

      // Only update image field if we have a new value or explicitly removing it
      if (imageUrl !== undefined) {
        updateData.image = imageUrl;
      }

      const location = await this.prisma.location.update({
        where: { id },
        data: updateData,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });

      // Delete old image after successful update
      if (oldImagePath) {
        await this.minioService.deleteFile(oldImagePath).catch(err => {
          console.error('Failed to delete old image:', err);
        });
      }

      return location;
    } catch (error) {
      // Rollback: delete newly uploaded file if update fails
      if (uploadedFilePath) {
        await this.minioService.deleteFile(uploadedFilePath).catch(err => {
          console.error('Failed to cleanup uploaded file during rollback:', err);
        });
      }
      throw error;
    }
  }

  async remove(id: string) {
    const location = await this.findOne(id);

    // Delete from database
    await this.prisma.location.delete({
      where: { id },
    });

    // Cleanup image from MinIO if it exists
    if (location.image && this.isMinioPath(location.image)) {
      const imagePath = this.extractMinioPath(location.image);
      await this.minioService.deleteFile(imagePath).catch(err => {
        console.error('Failed to delete image from MinIO:', err);
      });
    }

    return { message: 'Location deleted successfully' };
  }

  /**
   * Check if the image URL is from MinIO
   */
  private isMinioPath(imageUrl: string): boolean {
    if (!imageUrl) return false;
    // Check if it contains bucket name pattern
    return imageUrl.includes('/locations/') || imageUrl.startsWith('locations/');
  }

  /**
   * Extract MinIO path from full URL
   * Converts http://localhost:9000/locations/uuid.jpg to locations/uuid.jpg
   */
  private extractMinioPath(imageUrl: string): string {
    if (imageUrl.includes('/locations/')) {
      const parts = imageUrl.split('/locations/');
      return `locations/${parts[1]}`;
    }
    return imageUrl;
  }
}
