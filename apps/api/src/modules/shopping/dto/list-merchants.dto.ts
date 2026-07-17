import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ShoppingCategory } from '../shopping.types';

export class ListMerchantsQueryDto {
  @ApiPropertyOptional({ enum: ShoppingCategory })
  @IsOptional()
  @IsEnum(ShoppingCategory)
  category?: ShoppingCategory;
}

export class EventHistoryQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  after?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit = 100;
}
