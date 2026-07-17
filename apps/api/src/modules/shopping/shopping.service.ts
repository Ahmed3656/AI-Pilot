import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ulid } from 'ulid';
import {
  AddressGrantDto,
  AiEventDto,
  ApproveDomainsDto,
  CreateShoppingRunDto,
  NormalizedOfferDto,
  ResolveSecretDto,
  RunControlDto,
  SeatHoldApprovalDto,
} from './dto';
import { RunApproval, RunEvent, ShoppingRun } from './entities';
import { SHOPPING_STORE, ShoppingStore } from './repositories';
import {
  AddressSecretVaultService,
  RunStateMachine,
  ShoppingAiClientService,
  ShoppingEventStreamService,
  ViewerTokenService,
} from './services';
import {
  AiEventType,
  ApprovalType,
  EGYPT_MERCHANTS,
  RunControlAction,
  ShoppingCategory,
  ShoppingRunState,
  TERMINAL_RUN_STATES,
  ViewerMode,
} from './shopping.types';

@Injectable()
export class ShoppingService {
  constructor(
    @Inject(SHOPPING_STORE) private readonly store: ShoppingStore,
    private readonly states: RunStateMachine,
    private readonly vault: AddressSecretVaultService,
    private readonly ai: ShoppingAiClientService,
    private readonly viewerTokens: ViewerTokenService,
    private readonly events: ShoppingEventStreamService,
  ) {}

  async create(dto: CreateShoppingRunDto) {
    const run = await this.store.createRun({
      category: dto.category,
      market: 'EG',
      currency: 'EGP',
      query: dto.query,
      state: ShoppingRunState.Discovering,
      resumeState: null,
      aiRunId: null,
      failureCode: null,
      completedAt: null,
    });
    await this.recordEvent(run.id, 'run.created', {
      category: run.category,
      market: 'EG',
      currency: 'EGP',
      state: run.state,
    });
    try {
      run.aiRunId = await this.ai.createRun(run);
      await this.store.saveRun(run);
    } catch (error) {
      run.failureCode = 'AI_INITIALIZATION_FAILED';
      await this.transition(run, ShoppingRunState.Failed);
      throw error;
    }
    return this.runView(run);
  }

  merchants(category?: ShoppingCategory) {
    return EGYPT_MERCHANTS.filter(
      (merchant) => !category || merchant.category === category,
    );
  }

  async get(id: string) {
    const run = await this.getRun(id);
    const report = await this.store.report(id);
    return {
      ...this.runView(run),
      approvals: report.approvals.map((approval) =>
        this.approvalView(approval),
      ),
      offerCount: report.offers.length,
      lastEventAt: report.events.at(-1)?.observedAt ?? null,
    };
  }

  async approveDomains(id: string, dto: ApproveDomainsDto) {
    const run = await this.getRun(id);
    this.requireState(run, ShoppingRunState.AwaitingDomainApproval);
    this.assertDomains(run, dto.domains);
    const approval = await this.store.saveApproval({
      runId: run.id,
      type: ApprovalType.DomainAccess,
      recipientDomains: dto.domains,
      approvedAt: new Date(),
      metadata: {},
    });
    await this.transition(run, ShoppingRunState.Comparing);
    await this.ai.command(run, 'approve_domains', { domains: dto.domains });
    return { run: this.runView(run), approval: this.approvalView(approval) };
  }

  async grantAddress(id: string, dto: AddressGrantDto) {
    const run = await this.getRun(id);
    this.requireState(run, ShoppingRunState.AwaitingAddressConsent);
    this.assertDomains(run, dto.merchantDomains);
    await this.assertDomainApproval(run.id, dto.merchantDomains);
    const grant = this.vault.store(run.id, dto);
    const approval = await this.store.saveApproval({
      runId: run.id,
      type: ApprovalType.AddressShare,
      recipientDomains: dto.merchantDomains,
      approvedAt: new Date(),
      metadata: {
        secretReference: grant.secretReference,
        expiresAt: grant.expiresAt,
      },
    });
    await this.transition(run, ShoppingRunState.Comparing);
    await this.ai.command(run, 'grant_address', {
      secretReference: grant.secretReference,
      recipientDomains: dto.merchantDomains,
      expiresAt: grant.expiresAt,
    });
    return {
      run: this.runView(run),
      approval: this.approvalView(approval),
      expiresAt: grant.expiresAt,
    };
  }

  async approveSeatHold(id: string, dto: SeatHoldApprovalDto) {
    const run = await this.getRun(id);
    this.requireState(run, ShoppingRunState.AwaitingSeatHoldApproval);
    this.assertDomains(run, [dto.merchantDomain]);
    await this.assertDomainApproval(run.id, [dto.merchantDomain]);
    const approval = await this.store.saveApproval({
      runId: run.id,
      type: ApprovalType.SeatHold,
      recipientDomains: [dto.merchantDomain],
      approvedAt: new Date(),
      metadata: { offerId: dto.offerId },
    });
    await this.transition(run, ShoppingRunState.Comparing);
    await this.ai.command(run, 'approve_seat_hold', {
      merchantDomain: dto.merchantDomain,
      offerId: dto.offerId,
    });
    return { run: this.runView(run), approval: this.approvalView(approval) };
  }

  async control(id: string, dto: RunControlDto) {
    const run = await this.getRun(id);
    switch (dto.action) {
      case RunControlAction.Pause:
        if (
          TERMINAL_RUN_STATES.has(run.state) ||
          run.state === ShoppingRunState.Paused
        ) {
          throw new ConflictException('This run cannot be paused');
        }
        run.resumeState = run.state;
        await this.transition(run, ShoppingRunState.Paused);
        await this.ai.command(run, 'pause', {});
        break;
      case RunControlAction.Resume: {
        this.requireState(run, ShoppingRunState.Paused);
        const resumeState = run.resumeState ?? ShoppingRunState.Discovering;
        await this.transition(run, resumeState);
        run.resumeState = null;
        await this.store.saveRun(run);
        await this.ai.command(run, 'resume', {});
        break;
      }
      case RunControlAction.TakeControl:
        if (
          ![
            ShoppingRunState.ReadyForHandoff,
            ShoppingRunState.UserTakeover,
          ].includes(run.state)
        ) {
          throw new ConflictException('Run is not ready for user control');
        }
        await this.transition(run, ShoppingRunState.UserTakeover);
        await this.ai.command(run, 'pause_ai', {});
        break;
      case RunControlAction.ReleaseControl:
        this.requireState(run, ShoppingRunState.UserTakeover);
        await this.transition(run, ShoppingRunState.ReadyForHandoff);
        await this.ai.command(run, 'resume_ai', {});
        break;
      case RunControlAction.Complete:
        if (
          ![
            ShoppingRunState.ReadyForHandoff,
            ShoppingRunState.UserTakeover,
          ].includes(run.state)
        ) {
          throw new ConflictException('Run is not ready to be completed');
        }
        run.completedAt = new Date();
        await this.transition(run, ShoppingRunState.Completed);
        await this.ai.command(run, 'complete', {});
        break;
      case RunControlAction.Cancel:
        if (TERMINAL_RUN_STATES.has(run.state)) {
          throw new ConflictException('A terminal run cannot be cancelled');
        }
        await this.transition(run, ShoppingRunState.Cancelled);
        await this.ai.command(run, 'cancel', {
          ...(dto.reason ? { reason: dto.reason } : {}),
        });
        break;
    }
    return this.runView(run);
  }

  async viewerToken(id: string, mode: ViewerMode) {
    const run = await this.getRun(id);
    if (
      mode === ViewerMode.Control &&
      run.state === ShoppingRunState.ReadyForHandoff
    ) {
      await this.control(id, { action: RunControlAction.TakeControl });
    }
    return this.viewerTokens.issue(id, mode);
  }

  authorizeViewer(token: string) {
    return this.viewerTokens.authorize(token);
  }

  resolveSecret(dto: ResolveSecretDto) {
    return {
      runId: dto.runId,
      field: dto.field,
      value: this.vault.resolve(
        dto.runId,
        dto.secretReference,
        dto.merchantDomain,
        dto.field,
      ),
    };
  }

  async receiveAiEvent(dto: AiEventDto) {
    const run = await this.getRun(dto.runId);
    this.validateAiEvent(run, dto);
    const event = await this.store.appendEvent({
      runId: run.id,
      eventId: dto.eventId,
      type: dto.type,
      observedAt: new Date(dto.observedAt),
      payload: safeEventPayload(dto),
    });
    if (!event) return { accepted: true, duplicate: true };

    switch (dto.type) {
      case AiEventType.StateChanged:
        await this.transition(run, dto.state!);
        break;
      case AiEventType.MerchantAttempted: {
        const attempt = dto.merchantAttempt!;
        await this.store.saveMerchantAttempt({
          runId: run.id,
          ...attempt,
          startedAt: new Date(attempt.startedAt),
          finishedAt: attempt.finishedAt ? new Date(attempt.finishedAt) : null,
          errorCode: attempt.errorCode ?? null,
        });
        break;
      }
      case AiEventType.OfferNormalized: {
        const offer = dto.offer!;
        await this.store.saveOffer({
          runId: run.id,
          ...offer,
          observedAt: new Date(offer.observedAt),
          deliveryFee: offer.deliveryFee ?? null,
          serviceFee: offer.serviceFee ?? null,
          tax: offer.tax ?? null,
          discount: offer.discount ?? null,
          couponCode: offer.couponCode ?? null,
          incompleteReason: offer.incompleteReason ?? null,
          details: { ...offer.details },
        });
        break;
      }
      case AiEventType.CouponAttempted:
        await this.store.saveCouponAttempt({
          runId: run.id,
          ...dto.couponAttempt!,
          afterTotal: dto.couponAttempt!.afterTotal ?? null,
        });
        break;
      case AiEventType.EvidenceCaptured:
        await this.store.saveEvidence({
          runId: run.id,
          ...dto.evidence!,
          metadata: redactRecord(dto.evidence!.metadata ?? {}),
        });
        break;
      case AiEventType.RunFailed:
        run.failureCode = dto.failureCode ?? 'AI_RUN_FAILED';
        await this.transition(run, ShoppingRunState.Failed);
        break;
    }
    this.events.publish(event);
    return { accepted: true, duplicate: false };
  }

  async report(id: string) {
    const run = await this.getRun(id);
    const report = await this.store.report(id);
    return {
      run: this.runView(run),
      merchantAttempts: report.merchantAttempts,
      offers: report.offers.map(({ details, ...offer }) => ({
        ...offer,
        ...details,
      })),
      couponAttempts: report.couponAttempts,
      approvals: report.approvals.map((approval) =>
        this.approvalView(approval),
      ),
      events: report.events,
      evidence: report.evidence,
      generatedAt: new Date().toISOString(),
    };
  }

  private async transition(
    run: ShoppingRun,
    state: ShoppingRunState,
  ): Promise<void> {
    if (run.state === state) return;
    const previousState = run.state;
    this.states.assertTransition(previousState, state);
    run.state = state;
    await this.store.saveRun(run);
    await this.recordEvent(run.id, 'run.state_changed', {
      previousState,
      state,
    });
  }

  private async recordEvent(
    runId: string,
    type: string,
    payload: Record<string, unknown>,
  ): Promise<RunEvent | null> {
    const event = await this.store.appendEvent({
      runId,
      eventId: `api:${ulid()}`,
      type,
      payload,
      observedAt: new Date(),
    });
    if (event) this.events.publish(event);
    return event;
  }

  private async getRun(id: string): Promise<ShoppingRun> {
    const run = await this.store.findRun(id);
    if (!run) throw new NotFoundException('Shopping run not found');
    return run;
  }

  private requireState(run: ShoppingRun, expected: ShoppingRunState): void {
    if (run.state !== expected) {
      throw new ConflictException(
        `Run must be in ${expected} state; current state is ${run.state}`,
      );
    }
  }

  private assertDomains(run: ShoppingRun, domains: string[]): void {
    const allowed = new Set(
      EGYPT_MERCHANTS.filter(
        (merchant) => merchant.category === run.category,
      ).map((merchant) => merchant.domain),
    );
    const unsupported = domains.find((domain) => !allowed.has(domain));
    if (unsupported) {
      throw new BadRequestException(
        'One or more merchant domains are unavailable for this category in Egypt',
      );
    }
  }

  private async assertDomainApproval(
    runId: string,
    domains: string[],
  ): Promise<void> {
    const report = await this.store.report(runId);
    const approved = new Set(
      report.approvals
        .filter((approval) => approval.type === ApprovalType.DomainAccess)
        .flatMap((approval) => approval.recipientDomains),
    );
    if (domains.some((domain) => !approved.has(domain))) {
      throw new ConflictException(
        'Domain access must be approved before sharing data',
      );
    }
  }

  private validateAiEvent(run: ShoppingRun, dto: AiEventDto): void {
    if (TERMINAL_RUN_STATES.has(run.state)) {
      throw new ConflictException('Terminal runs do not accept AI events');
    }
    switch (dto.type) {
      case AiEventType.StateChanged:
        if (!dto.state)
          throw new BadRequestException('state is required for this event');
        this.states.assertTransition(run.state, dto.state);
        break;
      case AiEventType.MerchantAttempted:
        if (!dto.merchantAttempt)
          throw new BadRequestException(
            'merchantAttempt is required for this event',
          );
        this.assertDomains(run, [dto.merchantAttempt.merchantDomain]);
        break;
      case AiEventType.OfferNormalized:
        if (!dto.offer)
          throw new BadRequestException('offer is required for this event');
        this.assertOffer(run, dto.offer);
        break;
      case AiEventType.CouponAttempted:
        if (!dto.couponAttempt)
          throw new BadRequestException(
            'couponAttempt is required for this event',
          );
        break;
      case AiEventType.EvidenceCaptured:
        if (!dto.evidence)
          throw new BadRequestException('evidence is required for this event');
        break;
      case AiEventType.RunFailed:
        break;
    }
  }

  private assertOffer(run: ShoppingRun, offer: NormalizedOfferDto): void {
    if (offer.category !== run.category || offer.currency !== 'EGP') {
      throw new BadRequestException(
        'Offer category or currency does not match the run',
      );
    }
    let hostname: string;
    try {
      hostname = new URL(offer.sourceUrl).hostname
        .toLowerCase()
        .replace(/^www\./, '');
    } catch {
      throw new BadRequestException('Offer source URL is invalid');
    }
    const merchant = EGYPT_MERCHANTS.find(
      (item) => item.category === run.category && item.domain === hostname,
    );
    if (!merchant)
      throw new BadRequestException('Offer merchant is not supported');
    const required: Record<ShoppingCategory, readonly string[]> = {
      [ShoppingCategory.Retail]: [
        'brand',
        'model',
        'size',
        'color',
        'quantity',
        'deliveryEstimate',
      ],
      [ShoppingCategory.Food]: [
        'restaurant',
        'meal',
        'size',
        'modifiers',
        'rating',
        'minimumOrder',
        'deliveryEstimate',
        'optionalTipExcluded',
      ],
      [ShoppingCategory.Cinema]: [
        'movie',
        'venue',
        'date',
        'showtime',
        'language',
        'screenFormat',
        'seatCount',
        'seatType',
        'bookingFee',
        'holdExpiresAt',
      ],
    };
    if (required[run.category].some((field) => !(field in offer.details))) {
      throw new BadRequestException(
        'Offer is missing category-specific details',
      );
    }
  }

  private runView(run: ShoppingRun) {
    return {
      id: run.id,
      category: run.category,
      market: 'EG' as const,
      currency: 'EGP' as const,
      state: run.state,
      query: run.query,
      failureCode: run.failureCode,
      completedAt: run.completedAt,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    };
  }

  private approvalView(approval: RunApproval) {
    return {
      id: approval.id,
      type: approval.type,
      recipientDomains: approval.recipientDomains,
      approvedAt: approval.approvedAt,
    };
  }
}

function safeEventPayload(dto: AiEventDto): Record<string, unknown> {
  return redactRecord({
    ...(dto.state ? { state: dto.state } : {}),
    ...(dto.merchantAttempt ? { merchantAttempt: dto.merchantAttempt } : {}),
    ...(dto.offer ? { offer: dto.offer } : {}),
    ...(dto.couponAttempt ? { couponAttempt: dto.couponAttempt } : {}),
    ...(dto.evidence ? { evidence: dto.evidence } : {}),
    ...(dto.failureCode ? { failureCode: dto.failureCode } : {}),
  });
}

const SECRET_KEY =
  /recipientName|mobileNumber|governorate|cityOrArea|street|building|floor|apartment|landmark|postalCode|password|secret|token|authorization|cookie/i;

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => redactValue(item));
  if (!value || typeof value !== 'object') return value;
  return redactRecord(value as Record<string, unknown>);
}

function redactRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SECRET_KEY.test(key) ? '[REDACTED]' : redactValue(item),
    ]),
  );
}
