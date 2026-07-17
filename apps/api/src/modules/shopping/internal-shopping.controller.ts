import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  UnauthorizedException,
  UseGuards,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { Public } from '../../core/decorators/public.decorator';
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
  @ApiOperation({ summary: 'Receive an idempotent event from the AI harness' })
  aiEvent(@Body() dto: AiEventDto) {
    return this.shopping.receiveAiEvent(dto);
  }

  @Post('secrets/resolve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Resolve exactly one approved semantic address field',
  })
  resolveSecret(@Body() dto: ResolveSecretDto) {
    return this.shopping.resolveSecret(dto);
  }

  @Post('viewer/authorize')
  @HttpCode(HttpStatus.OK)
  @ApiHeader({ name: 'Authorization', required: false })
  @ApiOperation({
    summary: 'Authorize a viewer token for the live browser harness',
  })
  async authorizeViewer(
    @Headers('authorization') authorization: string | undefined,
    @Headers('cookie') cookie: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const token = viewerCredential(authorization, cookie);
    const result = await this.shopping.authorizeViewer(token);
    response.setHeader('X-DealPilot-Viewer-Mode', result.mode);
    return result;
  }
}

function viewerCredential(
  authorization: string | undefined,
  cookie: string | undefined,
): string {
  const match = /^Bearer ([^\s]+)$/.exec(authorization ?? '');
  if (match) return match[1];

  for (const part of cookie?.split(';') ?? []) {
    const [name, ...value] = part.trim().split('=');
    if (name === 'dealpilot_viewer' && value.length) {
      try {
        return decodeURIComponent(value.join('='));
      } catch {
        break;
      }
    }
  }
  throw new UnauthorizedException('Viewer credentials are required');
}
