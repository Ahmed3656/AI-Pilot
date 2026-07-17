import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { ShoppingCategory } from '../shopping.types';

export class ListMerchantsQueryDto {
  @ApiPropertyOptional({ enum: ShoppingCategory })
  @IsOptional()
  @IsEnum(ShoppingCategory)
  category?: ShoppingCategory;
}
