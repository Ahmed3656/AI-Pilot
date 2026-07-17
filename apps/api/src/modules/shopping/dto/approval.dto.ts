import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

const normalizeDomains = ({ value }: { value: unknown }): unknown =>
  Array.isArray(value)
    ? value.map((domain): unknown =>
        typeof domain === 'string' ? domain.trim().toLowerCase() : domain,
      )
    : value;

export class SubmitClarificationDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  requestId!: string;

  @ApiProperty({ type: 'object', additionalProperties: true })
  @IsObject()
  answers!: Record<string, string | string[]>;
}

export class ApproveDomainsDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  requestId!: string;

  @ApiProperty({ example: ['amazon.eg', 'jumia.com.eg'], type: [String] })
  @Transform(normalizeDomains)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @ArrayUnique()
  @IsString({ each: true })
  domains!: string[];
}

export class EgyptAddressDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  recipientName!: string;

  @ApiProperty({ example: '01012345678' })
  @IsString()
  @Matches(/^(?:\+20|0)1[0125]\d{8}$/)
  mobileNumber!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  governorate!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  cityOrArea!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  street!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  building!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  floor!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  apartment!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  landmark!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  postalCode?: string;
}

export class AddressGrantDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  requestId!: string;

  @ApiProperty({ example: ['talabat.com'], type: [String] })
  @Transform(normalizeDomains)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @ArrayUnique()
  @IsString({ each: true })
  merchantDomains!: string[];

  @ApiProperty({ type: EgyptAddressDto })
  @Type(() => EgyptAddressDto)
  @ValidateNested()
  address!: EgyptAddressDto;
}

export class SeatHoldApprovalDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  requestId!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  offerId!: string;

  @ApiProperty({ example: 'voxcinemas.com' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  merchantDomain!: string;
}
