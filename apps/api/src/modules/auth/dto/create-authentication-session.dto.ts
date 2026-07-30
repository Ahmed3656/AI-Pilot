import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { AuthenticationGrantType } from '../authentication-grant.port';

export class CreateAuthenticationSessionDto {
  @IsIn(['local_fixture', 'external_identity_assertion'])
  grantType!: AuthenticationGrantType;

  @IsString()
  @MinLength(1)
  @MaxLength(8192)
  grant!: string;
}
