import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../core/decorators/public.decorator';
import { AiEventDto, ResolveSecretDto, ViewerAuthorizeQueryDto } from './dto';
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

  @Get('viewer/authorize')
  @ApiOperation({
    summary: 'Authorize a viewer token for the live browser harness',
  })
  authorizeViewer(@Query() query: ViewerAuthorizeQueryDto) {
    return this.shopping.authorizeViewer(query.token);
  }
}
