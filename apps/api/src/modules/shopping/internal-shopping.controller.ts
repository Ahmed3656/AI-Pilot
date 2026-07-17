import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  UseGuards,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
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
    @Res({ passthrough: true }) response: Response,
  ) {
    const match = /^Bearer (\S+)$/.exec(authorization ?? '');
    if (!match)
      throw new ContractException(
        'INVALID_VIEWER_TOKEN',
        401,
        'Viewer bearer token is required',
      );
    const authorizationResult = await this.shopping.authorizeViewer(match[1]);
    response.setHeader('X-DealPilot-Viewer-Mode', authorizationResult.mode);
    return authorizationResult;
  }
}
