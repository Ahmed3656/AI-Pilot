import { IsEmail } from 'class-validator';

export class RequestIdentityActionDto {
  @IsEmail()
  email!: string;
}
