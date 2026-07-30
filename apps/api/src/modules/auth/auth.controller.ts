import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { ContractException } from '../../core/filters/contract-exception';
import { Public } from '../../core/decorators/public.decorator';
import { AuthService } from './auth.service';
import { CreateAuthenticationSessionDto } from './dto/create-authentication-session.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import { RequestIdentityActionDto } from './dto/request-identity-action.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { RevokeSessionDto } from './dto/revoke-session.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuthenticatedActor } from './types/authenticated-actor.type';

type AuthenticatedRequest = Request & { user: AuthenticatedActor };

@ApiTags('auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create an unverified local account' })
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Authenticate a verified local account' })
  login(@Req() request: Request, @Body() dto: LoginDto) {
    return this.auth.login(dto, networkIdentity(request));
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate a legacy mobile authentication session' })
  refresh(@Body() dto: RefreshTokenDto) {
    return this.auth.refresh(dto);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke the current authentication session' })
  logout(@Req() request: AuthenticatedRequest) {
    return this.auth.logout(request.user);
  }

  @Public()
  @Post('email-verification/request')
  @HttpCode(HttpStatus.ACCEPTED)
  requestEmailVerification(@Body() dto: RequestIdentityActionDto) {
    return this.auth.requestEmailVerification(dto.email);
  }

  @Public()
  @Post('email-verification/verify')
  @HttpCode(HttpStatus.OK)
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.auth.verifyEmail(dto.token);
  }

  @Public()
  @Post('password-recovery/request')
  @HttpCode(HttpStatus.ACCEPTED)
  requestPasswordRecovery(@Body() dto: RequestIdentityActionDto) {
    return this.auth.requestPasswordRecovery(dto.email);
  }

  @Public()
  @Post('password-recovery/reset')
  @HttpCode(HttpStatus.OK)
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto.token, dto.password);
  }

  @Public()
  @Post('sessions')
  @HttpCode(HttpStatus.CREATED)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ operationId: 'createAuthenticationSession' })
  createAuthenticationSession(
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CreateAuthenticationSessionDto,
  ) {
    requireIdempotencyKey(idempotencyKey);
    return this.auth.createAuthenticationSession(dto);
  }

  @Public()
  @Post('sessions/refresh')
  @HttpCode(HttpStatus.OK)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ operationId: 'refreshAuthenticationSession' })
  refreshAuthenticationSession(
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: RefreshTokenDto,
  ) {
    requireIdempotencyKey(idempotencyKey);
    return this.auth.refresh(dto, false);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('sessions/:sessionId/revoke')
  @HttpCode(HttpStatus.OK)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ operationId: 'revokeAuthenticationSession' })
  revokeAuthenticationSession(
    @Req() request: AuthenticatedRequest,
    @Param('sessionId') sessionId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: RevokeSessionDto,
  ) {
    requireIdempotencyKey(idempotencyKey);
    return this.auth.revokeSession(request.user, sessionId, dto.reason);
  }
}

function networkIdentity(request: Request): string {
  return request.ip || request.socket.remoteAddress || 'unknown';
}

function requireIdempotencyKey(key: string | undefined): void {
  if (!key || key.length < 8 || key.length > 128 || !/^[\x20-\x7E]+$/.test(key))
    throw new ContractException(
      'VALIDATION_ERROR',
      400,
      'Idempotency-Key must contain 8-128 printable ASCII characters',
    );
}
