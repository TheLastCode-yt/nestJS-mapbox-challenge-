import { Injectable, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import MapboxClient from '@mapbox/mapbox-sdk';
import MapboxGeocoding from '@mapbox/mapbox-sdk/services/geocoding';

interface GeocodeResult {
  latitude: number;
  longitude: number;
  formattedAddress?: string;
}

@Injectable()
export class MapboxService {
  private geocodingClient;

  constructor() {
    const accessToken = process.env.MAPBOX_ACCESS_TOKEN;

    if (!accessToken) {
      throw new Error('MAPBOX_ACCESS_TOKEN is not defined in environment variables');
    }

    const mapboxClient = MapboxClient({ accessToken });
    this.geocodingClient = MapboxGeocoding(mapboxClient);
  }

  async geocodeAddress(address: string): Promise<GeocodeResult> {
    if (!address || address.trim().length === 0) {
      throw new BadRequestException('Address cannot be empty');
    }

    try {
      const response = await this.geocodingClient
        .forwardGeocode({
          query: address.trim(),
          limit: 1,
        })
        .send();

      if (!response.body.features || response.body.features.length === 0) {
        throw new BadRequestException(`Address not found: ${address}`);
      }

      const feature = response.body.features[0];
      const [longitude, latitude] = feature.center;

      return {
        latitude,
        longitude,
        formattedAddress: feature.place_name,
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      // console.error('Mapbox geocoding error:', error);

      throw new InternalServerErrorException(
        `Geocoding service failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}