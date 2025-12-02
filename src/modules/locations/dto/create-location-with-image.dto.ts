import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional } from 'class-validator';

export class CreateLocationWithImageDto {
  @ApiProperty({ example: 'Eiffel Tower' })
  @IsString()
  name: string;

  @ApiProperty({ example: 'Famous landmark in Paris', required: false })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({
    example: 'Champ de Mars, 5 Avenue Anatole France, 75007 Paris, France',
    description: 'Address to be geocoded to latitude/longitude',
  })
  @IsString()
  address: string;

  @ApiProperty({
    type: 'string',
    format: 'binary',
    required: false,
    description: 'Image file for the location',
  })
  image?: any;
}
