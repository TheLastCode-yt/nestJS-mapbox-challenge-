import { Injectable } from '@nestjs/common';
import MapboxClient from '@mapbox/mapbox-sdk';
import MapboxGeocoding from '@mapbox/mapbox-sdk/services/geocoding';

@Injectable()
export class MapboxService {
  private geocodingClient;

  constructor() {
    const mapboxClient = MapboxClient({
      accessToken: process.env.MAPBOX_ACCESS_TOKEN,
    });
    this.geocodingClient = MapboxGeocoding(mapboxClient);
  }

  async geocodeAddress(address: string): Promise<{ latitude: number; longitude: number }> {
    try {
      const response = await this.geocodingClient
        .forwardGeocode({
          query: address,
          limit: 1,
        })
        .send();

      if (response.body.features.length === 0) {
        throw new Error('Address not found');
      }

      const [longitude, latitude] = response.body.features[0].center;
      return { latitude, longitude };
    } catch (error) {
      throw new Error(`Geocoding failed: ${error.message}`);
    }
  }
}
