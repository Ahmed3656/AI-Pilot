import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { RunControlAction, ViewerMode } from '../shopping.types';

export class RunControlDto {
  @ApiProperty({ enum: RunControlAction })
  @IsEnum(RunControlAction)
  action!: RunControlAction;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  reason?: string;
}

export class ClaimControlDto {
  @ApiPropertyOptional({ minimum: 60, maximum: 900, default: 120 })
  @IsOptional()
  @IsInt()
  @Min(60)
  @Max(900)
  requestedLeaseSeconds?: number;
}

export class LeaseDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  leaseId!: string;
}

export class CreateViewerTokenDto {
  @ApiProperty({ enum: ViewerMode })
  @IsEnum(ViewerMode)
  mode!: ViewerMode;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  leaseId?: string;
}
