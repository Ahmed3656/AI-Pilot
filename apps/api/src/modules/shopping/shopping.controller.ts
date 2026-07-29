import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Request, Response } from 'express';
import { AuthenticatedActor } from '../auth/types/authenticated-actor.type';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  AddressGrantDto,
  ApproveDomainsDto,
  ClaimControlDto,
  CreateShoppingRunDto,
  CreateViewerTokenDto,
  EventHistoryQueryDto,
  LeaseDto,
  ListMerchantsQueryDto,
  RunControlDto,
  SeatHoldApprovalDto,
  SubmitClarificationDto,
} from './dto';
import { IdempotencyService } from './services';
import { ShoppingService } from './shopping.service';
import { ShoppingCategory } from './shopping.types';

type AuthRequest = Request & { user: AuthenticatedActor };

@ApiTags('shopping')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'shopping', version: '1' })
export class ShoppingController {
  constructor(
    private readonly shopping: ShoppingService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Post('runs')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: 'Create an Egypt-only shopping run' })
  create(
    @Req() request: AuthRequest,
    @Headers('idempotency-key') key: string | undefined,
    @Body() dto: CreateShoppingRunDto,
  ) {
    return this.idempotency.execute(
      request.user.id,
      'POST',
      '/api/v1/shopping/runs',
      key,
      dto,
      () => this.shopping.create(request.user.id, dto),
    );
  }

  @Get('runs/:runId')
  @ApiParam({ name: 'runId' })
  get(@Req() request: AuthRequest, @Param('runId') runId: string) {
    return this.shopping.get(request.user.id, runId);
  }

  @Get('merchants')
  @ApiQuery({ name: 'category', enum: ShoppingCategory, required: false })
  merchants(@Query() query: ListMerchantsQueryDto) {
    return this.shopping.merchants(query.category);
  }

  @Post('runs/:runId/clarifications')
  @HttpCode(HttpStatus.OK)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  clarify(
    @Req() request: AuthRequest,
    @Param('runId') runId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() dto: SubmitClarificationDto,
  ) {
    return this.idempotency.execute(
      request.user.id,
      'POST',
      `/api/v1/shopping/runs/${runId}/clarifications`,
      key,
      dto,
      () => this.shopping.clarify(request.user.id, runId, dto),
    );
  }

  @Post('runs/:runId/domains/approve')
  @HttpCode(HttpStatus.OK)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  approveDomains(
    @Req() request: AuthRequest,
    @Param('runId') runId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() dto: ApproveDomainsDto,
  ) {
    return this.idempotency.execute(
      request.user.id,
      'POST',
      `/api/v1/shopping/runs/${runId}/domains/approve`,
      key,
      dto,
      () => this.shopping.approveDomains(request.user.id, runId, dto),
    );
  }

  @Post('runs/:runId/address-grant')
  @HttpCode(HttpStatus.OK)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  grantAddress(
    @Req() request: AuthRequest,
    @Param('runId') runId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() dto: AddressGrantDto,
  ) {
    return this.idempotency.execute(
      request.user.id,
      'POST',
      `/api/v1/shopping/runs/${runId}/address-grant`,
      key,
      dto,
      () => this.shopping.grantAddress(request.user.id, runId, dto),
    );
  }

  @Post('runs/:runId/seat-hold/approve')
  @HttpCode(HttpStatus.OK)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  approveSeatHold(
    @Req() request: AuthRequest,
    @Param('runId') runId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() dto: SeatHoldApprovalDto,
  ) {
    return this.idempotency.execute(
      request.user.id,
      'POST',
      `/api/v1/shopping/runs/${runId}/seat-hold/approve`,
      key,
      dto,
      () => this.shopping.approveSeatHold(request.user.id, runId, dto),
    );
  }

  @Post('runs/:runId/control')
  @HttpCode(HttpStatus.OK)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  control(
    @Req() request: AuthRequest,
    @Param('runId') runId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() dto: RunControlDto,
  ) {
    return this.idempotency.execute(
      request.user.id,
      'POST',
      `/api/v1/shopping/runs/${runId}/control`,
      key,
      dto,
      () => this.shopping.control(request.user.id, runId, dto),
    );
  }

  @Post('runs/:runId/control/claim')
  @HttpCode(HttpStatus.OK)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  claim(
    @Req() request: AuthRequest,
    @Param('runId') runId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() dto: ClaimControlDto,
  ) {
    return this.idempotency.execute(
      request.user.id,
      'POST',
      `/api/v1/shopping/runs/${runId}/control/claim`,
      key,
      dto,
      () => this.shopping.claimControl(request.user.id, runId, dto),
    );
  }

  @Post('runs/:runId/control/renew')
  @HttpCode(HttpStatus.OK)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  renew(
    @Req() request: AuthRequest,
    @Param('runId') runId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() dto: LeaseDto,
  ) {
    return this.idempotency.execute(
      request.user.id,
      'POST',
      `/api/v1/shopping/runs/${runId}/control/renew`,
      key,
      dto,
      () => this.shopping.renewControl(request.user.id, runId, dto),
    );
  }

  @Post('runs/:runId/control/release')
  @HttpCode(HttpStatus.OK)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  release(
    @Req() request: AuthRequest,
    @Param('runId') runId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() dto: LeaseDto,
  ) {
    return this.idempotency.execute(
      request.user.id,
      'POST',
      `/api/v1/shopping/runs/${runId}/control/release`,
      key,
      dto,
      () => this.shopping.releaseControl(request.user.id, runId, dto),
    );
  }

  @Post('runs/:runId/viewer-tokens')
  @HttpCode(HttpStatus.CREATED)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  async viewerToken(
    @Req() request: AuthRequest,
    @Param('runId') runId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-forwarded-proto') forwardedProto: string | undefined,
    @Res({ passthrough: true }) response: Response,
    @Body() dto: CreateViewerTokenDto,
  ) {
    const viewer = await this.idempotency.execute(
      request.user.id,
      'POST',
      `/api/v1/shopping/runs/${runId}/viewer-tokens`,
      key,
      dto,
      () => this.shopping.viewerToken(request.user.id, runId, dto),
    );
    const maxAge = Math.max(
      1,
      Math.floor((new Date(viewer.expiresAt).getTime() - Date.now()) / 1000),
    );
    response.setHeader(
      'Set-Cookie',
      `dealpilot_viewer=${viewer.token}; Path=/viewer; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${forwardedProto === 'https' ? '; Secure' : ''}`,
    );
    return viewer;
  }

  @Get('runs/:runId/events')
  history(
    @Req() request: AuthRequest,
    @Param('runId') runId: string,
    @Query() query: EventHistoryQueryDto,
  ) {
    return this.shopping.eventHistory(
      request.user.id,
      runId,
      query.after,
      query.limit,
    );
  }

  @Get('runs/:runId/report')
  report(@Req() request: AuthRequest, @Param('runId') runId: string) {
    return this.shopping.report(request.user.id, runId);
  }

  @Get('runs/:runId/evidence/:evidenceId')
  async evidence(
    @Req() request: AuthRequest,
    @Param('runId') runId: string,
    @Param('evidenceId') evidenceId: string,
    @Res() response: Response,
  ) {
    const evidence = await this.shopping.evidence(
      request.user.id,
      runId,
      evidenceId,
    );
    response.setHeader('Content-Type', evidence.contentType);
    response.setHeader('Content-Length', String(evidence.content.length));
    response.setHeader('Content-Disposition', 'inline');
    response.send(evidence.content);
  }
}
