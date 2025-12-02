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

    // Geocode the address to get latitude and longitude
    const { latitude, longitude } =
      await this.mapboxService.geocodeAddress(address);

    let imageUrl = image;

    if (imageFile) {
      const imagePath = await this.minioService.uploadFile(
        imageFile,
        BucketType.LOCATIONS,
      );
      imageUrl = this.minioService.getFileUrl(imagePath);
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

  async update(id: string, updateLocationDto: UpdateLocationDto) {
    // Check if location exists
    await this.findOne(id);

    const { address, ...rest } = updateLocationDto;
    let coordinates = {};

    // If address is provided, geocode it
    if (address) {
      const { latitude, longitude } =
        await this.mapboxService.geocodeAddress(address);
      coordinates = { latitude, longitude };
    }

    const location = await this.prisma.location.update({
      where: { id },
      data: {
        ...rest,
        ...coordinates,
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
  }

  async remove(id: string) {
    // Check if location exists
    await this.findOne(id);

    await this.prisma.location.delete({
      where: { id },
    });

    return { message: 'Location deleted successfully' };
  }
}
