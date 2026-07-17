import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const normalizeDomains = ({ value }: { value: unknown }): unknown =>
  Array.isArray(value)
    ? (value as unknown[]).map((domain): unknown =>
        typeof domain === 'string' ? domain.trim().toLowerCase() : domain,
      )
    : value;

export class ApproveDomainsDto {
  @ApiProperty({ example: ['amazon.eg', 'jumia.com.eg'], type: [String] })
  @Transform(normalizeDomains)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsString({ each: true })
  domains!: string[];
}

export class EgyptAddressDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  recipientName!: string;

  @ApiProperty({ example: '01012345678' })
  @IsString()
  @Matches(/^(?:\+20|0)1[0125]\d{8}$/)
  mobileNumber!: string;

  @ApiProperty({ example: 'Cairo' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  governorate!: string;

  @ApiProperty({ example: 'Nasr City' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  cityOrArea!: string;

  @ApiProperty()
  @IsString()
  @MinLength(2)
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
  @MinLength(2)
  @MaxLength(200)
  landmark!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  postalCode?: string;
}

export class AddressGrantDto {
  @ApiProperty({ type: EgyptAddressDto })
  @Type(() => EgyptAddressDto)
  @ValidateNested()
  address!: EgyptAddressDto;

  @ApiProperty({ example: ['talabat.com'], type: [String] })
  @Transform(normalizeDomains)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsString({ each: true })
  merchantDomains!: string[];
}

export class SeatHoldApprovalDto {
  @ApiProperty({ example: 'voxcinemas.com' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  merchantDomain!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  offerId!: string;
}

export enum ApprovalDecision {
  Approve = 'approve',
}

export class ExplicitApprovalDto {
  @ApiProperty({ enum: ApprovalDecision, default: ApprovalDecision.Approve })
  @IsEnum(ApprovalDecision)
  decision: ApprovalDecision = ApprovalDecision.Approve;
}
