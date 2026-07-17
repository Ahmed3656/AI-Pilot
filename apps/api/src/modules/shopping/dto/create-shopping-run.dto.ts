import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Equals,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ShoppingCategory } from '../shopping.types';

export class CreateShoppingRunDto {
  @ApiProperty({ enum: ShoppingCategory })
  @IsEnum(ShoppingCategory)
  category!: ShoppingCategory;

  @ApiProperty({ example: 'Find a 55-inch 4K television under EGP 30,000' })
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  query!: string;

  @ApiPropertyOptional({ enum: ['EG'], default: 'EG' })
  @IsOptional()
  @Equals('EG')
  market = 'EG' as const;

  @ApiPropertyOptional({ enum: ['EGP'], default: 'EGP' })
  @IsOptional()
  @Equals('EGP')
  currency = 'EGP' as const;
}
