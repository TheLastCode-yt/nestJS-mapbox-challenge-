import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsBoolean } from 'class-validator';

export class UpdateLocationWithImageDto {
  @ApiProperty({
    type: 'string',
    format: 'binary',
    required: false,
    description: 'Image file to upload (jpg, jpeg, png, webp, svg). Max size: 20MB'
  })
  image?: any;

  @ApiProperty({ example: 'Eiffel Tower', required: false })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({ example: 'Famous landmark in Paris', required: false })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({
    example: 'Champ de Mars, 5 Avenue Anatole France, 75007 Paris, France',
    description: 'Address to be geocoded to latitude/longitude',
    required: false
  })
  @IsString()
  @IsOptional()
  address?: string;

  @ApiProperty({
    example: true,
    description: 'If true, keeps the existing image. If false, removes it. If a new image file is provided, this is ignored.',
    required: false,
    type: Boolean
  })
  @IsBoolean()
  @IsOptional()
  keepImage?: boolean;
}
