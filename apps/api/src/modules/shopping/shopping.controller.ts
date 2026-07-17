import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Request, Response } from 'express';
import { Public } from '../../core/decorators/public.decorator';
import {
  AddressGrantDto,
  ApproveDomainsDto,
  CreateShoppingRunDto,
  ListMerchantsQueryDto,
  RunControlDto,
  SeatHoldApprovalDto,
  ViewerTokenQueryDto,
} from './dto';
import { ShoppingService } from './shopping.service';
import { ShoppingCategory } from './shopping.types';

@ApiTags('shopping')
@ApiResponse({ status: 400, description: 'DTO validation failed' })
@ApiResponse({ status: 409, description: 'Run state or approval conflict' })
@Public()
@Controller({ path: 'shopping', version: '1' })
export class ShoppingController {
  constructor(private readonly shopping: ShoppingService) {}

  @Post('runs')
  @ApiOperation({ summary: 'Create an Egypt shopping run' })
  create(@Body() dto: CreateShoppingRunDto) {
    return this.shopping.create(dto);
  }

  @Get('runs/:id')
  @ApiOperation({ summary: 'Get current shopping run state' })
  @ApiParam({ name: 'id', description: 'Shopping run ULID' })
  get(@Param('id') id: string) {
    return this.shopping.get(id);
  }

  @Get('merchants')
  @ApiOperation({ summary: 'List the fixed Phase 1 Egypt merchant catalog' })
  @ApiQuery({ name: 'category', enum: ShoppingCategory, required: false })
  merchants(@Query() query: ListMerchantsQueryDto) {
    return this.shopping.merchants(query.category);
  }

  @Post('runs/:id/domains/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve access to selected merchant domains' })
  approveDomains(@Param('id') id: string, @Body() dto: ApproveDomainsDto) {
    return this.shopping.approveDomains(id, dto);
  }

  @Post('runs/:id/address-grant')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Grant a 30-minute, domain-scoped in-memory address secret',
  })
  grantAddress(@Param('id') id: string, @Body() dto: AddressGrantDto) {
    return this.shopping.grantAddress(id, dto);
  }

  @Post('runs/:id/seat-hold/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve a cinema seat hold' })
  approveSeatHold(@Param('id') id: string, @Body() dto: SeatHoldApprovalDto) {
    return this.shopping.approveSeatHold(id, dto);
  }

  @Post('runs/:id/control')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Pause, resume, cancel, complete, or take over a run',
  })
  control(@Param('id') id: string, @Body() dto: RunControlDto) {
    return this.shopping.control(id, dto);
  }

  @Get('runs/:id/viewer-token')
  @ApiOperation({ summary: 'Issue a 15-minute view or control viewer token' })
  async viewerToken(
    @Param('id') id: string,
    @Query() query: ViewerTokenQueryDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.shopping.viewerToken(id, query.mode);
    const forwardedProtocol = request
      .header('x-forwarded-proto')
      ?.split(',')[0]
      .trim()
      .toLowerCase();
    response.cookie('dealpilot_viewer', result.token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: request.secure || forwardedProtocol === 'https',
      path: '/viewer',
    });
    return result;
  }

  @Get('runs/:id/report')
  @ApiOperation({
    summary: 'Get the normalized comparison and evidence report',
  })
  report(@Param('id') id: string) {
    return this.shopping.report(id);
  }

  @Get('runs/:id/events')
  @ApiOperation({
    summary: 'WebSocket event stream authenticated with bearer subprotocol',
  })
  websocketOnly(): never {
    throw new HttpException('WebSocket upgrade required', 426);
  }
}
