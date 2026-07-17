import { Type } from 'class-transformer';
import {
  ArrayUnique,
  Equals,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsHash,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  AiEventType,
  ShoppingCategory,
  ShoppingRunState,
} from '../shopping.types';

export class OfferDetailsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  brand?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  model?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  size?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  color?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(1)
  quantity?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  deliveryEstimate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  restaurant?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  meal?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  modifiers?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(5)
  rating?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  minimumOrder?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  optionalTipExcluded?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  movie?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  venue?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  showtime?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  language?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  screenFormat?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(1)
  seatCount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  seatType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  bookingFee?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  holdExpiresAt?: string;
}

export class NormalizedOfferDto {
  @ApiProperty()
  @IsString()
  merchant!: string;

  @ApiProperty({ enum: ShoppingCategory })
  @IsEnum(ShoppingCategory)
  category!: ShoppingCategory;

  @ApiProperty()
  @IsString()
  title!: string;

  @ApiProperty()
  @IsUrl({ require_tld: true, require_protocol: true })
  sourceUrl!: string;

  @ApiProperty({ enum: ['EGP'] })
  @Equals('EGP')
  currency!: 'EGP';

  @ApiProperty()
  @IsNumber()
  @Min(0)
  basePrice!: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  deliveryFee?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  serviceFee?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  tax?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  discount?: number | null;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  finalTotal!: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  couponCode?: string | null;

  @ApiProperty()
  @IsString()
  availability!: string;

  @ApiProperty()
  @IsDateString()
  observedAt!: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  evidenceIds!: string[];

  @ApiProperty({ minimum: 0, maximum: 1 })
  @IsNumber()
  @Min(0)
  @Max(1)
  matchConfidence!: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  incompleteReason?: string | null;

  @ApiProperty({ type: OfferDetailsDto })
  @Type(() => OfferDetailsDto)
  @ValidateNested()
  details!: OfferDetailsDto;
}

export class MerchantAttemptDto {
  @IsString()
  merchant!: string;

  @IsString()
  merchantDomain!: string;

  @IsString()
  status!: string;

  @IsOptional()
  @IsString()
  errorCode?: string | null;

  @IsDateString()
  startedAt!: string;

  @IsOptional()
  @IsDateString()
  finishedAt?: string | null;
}

export class CouponAttemptDto {
  @IsString()
  merchant!: string;

  @IsString()
  couponCode!: string;

  @IsString()
  status!: string;

  @IsNumber()
  @Min(0)
  beforeTotal!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  afterTotal?: number | null;

  @IsArray()
  @IsString({ each: true })
  evidenceIds!: string[];
}

export class EvidenceArtifactDto {
  @IsString()
  kind!: string;

  @IsUrl({ require_tld: false, require_protocol: true })
  uri!: string;

  @IsHash('sha256')
  sha256!: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class AiEventDto {
  @ApiProperty()
  @IsString()
  eventId!: string;

  @ApiProperty()
  @IsString()
  runId!: string;

  @ApiProperty({ enum: AiEventType })
  @IsEnum(AiEventType)
  type!: AiEventType;

  @ApiProperty()
  @IsDateString()
  observedAt!: string;

  @ApiPropertyOptional({ enum: ShoppingRunState })
  @IsOptional()
  @IsEnum(ShoppingRunState)
  state?: ShoppingRunState;

  @ApiPropertyOptional({ type: MerchantAttemptDto })
  @IsOptional()
  @Type(() => MerchantAttemptDto)
  @ValidateNested()
  merchantAttempt?: MerchantAttemptDto;

  @ApiPropertyOptional({ type: NormalizedOfferDto })
  @IsOptional()
  @Type(() => NormalizedOfferDto)
  @ValidateNested()
  offer?: NormalizedOfferDto;

  @ApiPropertyOptional({ type: CouponAttemptDto })
  @IsOptional()
  @Type(() => CouponAttemptDto)
  @ValidateNested()
  couponAttempt?: CouponAttemptDto;

  @ApiPropertyOptional({ type: EvidenceArtifactDto })
  @IsOptional()
  @Type(() => EvidenceArtifactDto)
  @ValidateNested()
  evidence?: EvidenceArtifactDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  failureCode?: string;
}
