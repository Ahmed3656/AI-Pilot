import { ApiProperty } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsObject,
  IsString,
  Matches,
} from 'class-validator';
import { EVENT_TYPES, EventType, ShoppingRunState } from '../shopping.types';

export class AiEventDto {
  @ApiProperty()
  @IsString()
  id!: string;

  @ApiProperty()
  @IsString()
  runId!: string;

  @ApiProperty({ enum: EVENT_TYPES })
  @IsIn(EVENT_TYPES)
  type!: EventType;

  @ApiProperty({ enum: ShoppingRunState })
  @IsIn(Object.values(ShoppingRunState))
  status!: ShoppingRunState;

  @ApiProperty()
  @IsDateString({ strict: true })
  @Matches(/Z$/)
  timestamp!: string;

  @ApiProperty({ type: 'object', additionalProperties: true })
  @IsObject()
  payload!: Record<string, unknown>;
}
