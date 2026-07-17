import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { RunControlAction, ViewerMode } from '../shopping.types';

export class RunControlDto {
  @ApiProperty({ enum: RunControlAction })
  @IsEnum(RunControlAction)
  action!: RunControlAction;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

export class ViewerTokenQueryDto {
  @ApiPropertyOptional({ enum: ViewerMode, default: ViewerMode.View })
  @IsOptional()
  @IsEnum(ViewerMode)
  mode: ViewerMode = ViewerMode.View;
}
