import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString } from 'class-validator';
import { AddressField } from '../shopping.types';

export class ResolveSecretDto {
  @ApiProperty()
  @IsString()
  runId!: string;

  @ApiProperty()
  @IsString()
  secretReference!: string;

  @ApiProperty()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  merchantDomain!: string;

  @ApiProperty({ enum: AddressField })
  @IsEnum(AddressField)
  field!: AddressField;
}
