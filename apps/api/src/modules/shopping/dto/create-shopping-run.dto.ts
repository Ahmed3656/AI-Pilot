import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';
import { RequestedCategory, SupportedLocale } from '../shopping.types';

export class CreateShoppingRunDto {
  @ApiProperty({ example: 'Find a 55-inch television under EGP 30,000' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  query!: string;

  @ApiProperty({ enum: RequestedCategory })
  @IsEnum(RequestedCategory)
  category!: RequestedCategory;

  @ApiProperty({ enum: SupportedLocale })
  @IsEnum(SupportedLocale)
  locale!: SupportedLocale;
}
