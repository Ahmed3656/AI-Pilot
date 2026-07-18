import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { Public } from '../../core/decorators/public.decorator';
import { ContractException } from '../../core/filters/contract-exception';
import { AiEventDto, ResolveSecretDto } from './dto';
import { InternalTokenGuard } from './services';
import { ShoppingService } from './shopping.service';

@ApiTags('shopping-internal')
@ApiHeader({ name: 'X-Internal-Token', required: true })
@Public()
@UseGuards(InternalTokenGuard)
@Controller({ path: 'internal/v1', version: VERSION_NEUTRAL })
export class InternalShoppingController {
  constructor(private readonly shopping: ShoppingService) {}

  @Post('ai-events')
  @HttpCode(HttpStatus.ACCEPTED)
  aiEvent(@Body() dto: AiEventDto) {
    return this.shopping.receiveAiEvent(dto);
  }

  @Post('evidence/:runId/:evidenceId')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { files: 1, fileSize: 3 * 1024 * 1024 },
    }),
  )
  uploadEvidence(
    @Param('runId') runId: string,
    @Param('evidenceId') evidenceId: string,
    @UploadedFile()
    file:
      | { buffer: Buffer; mimetype: string; originalname: string; size: number }
      | undefined,
  ) {
    return this.shopping.uploadEvidence(runId, evidenceId, file);
  }

  @Post('secrets/resolve')
  @HttpCode(HttpStatus.OK)
  resolveSecret(@Body() dto: ResolveSecretDto) {
    return this.shopping.resolveSecret(dto);
  }

  @Post('viewer/authorize')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Authorize a bearer viewer token without accepting URL tokens',
  })
  async authorizeViewer(
    @Headers('authorization') authorization: string | undefined,
    @Headers('cookie') cookie: string | undefined,
    @Headers('x-forwarded-proto') forwardedProto: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const bearer = /^Bearer (\S+)$/.exec(authorization ?? '')?.[1];
    const cookieToken = /(?:^|;\s*)dealpilot_viewer=([^;]+)/.exec(
      cookie ?? '',
    )?.[1];
    const token = bearer ?? cookieToken;
    if (!token)
      throw new ContractException(
        'INVALID_VIEWER_TOKEN',
        401,
        'Viewer bearer token is required',
      );
    const authorizationResult = await this.shopping.authorizeViewer(token);
    response.setHeader('X-DealPilot-Viewer-Mode', authorizationResult.mode);
    const maxAge = Math.max(
      1,
      Math.floor(
        (new Date(authorizationResult.expiresAt).getTime() - Date.now()) / 1000,
      ),
    );
    response.setHeader(
      'Set-Cookie',
      `dealpilot_viewer=${token}; Path=/viewer; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${forwardedProto === 'https' ? '; Secure' : ''}`,
    );
    return authorizationResult;
  }
}
