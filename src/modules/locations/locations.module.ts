import { Module } from '@nestjs/common';
import { LocationsService } from './locations.service';
import { LocationsController } from './locations.controller';
import { MapboxModule } from '../mapbox/mapbox.module';
import { MinioModule } from '../minio/minio.module';

@Module({
  imports: [MapboxModule, MinioModule],
  controllers: [LocationsController],
  providers: [LocationsService],
})
export class LocationsModule { }
