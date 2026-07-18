import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { ulid } from 'ulid';
import { ContractException } from '../../core/filters/contract-exception';
import {
  AddressGrantDto,
  AiEventDto,
  ApproveDomainsDto,
  ClaimControlDto,
  CreateShoppingRunDto,
  CreateViewerTokenDto,
  LeaseDto,
  ResolveSecretDto,
  RunControlDto,
  SeatHoldApprovalDto,
  SubmitClarificationDto,
} from './dto';
import { ControlLease, RunApproval, RunEvent, ShoppingRun } from './entities';
import { SHOPPING_STORE, ShoppingStore } from './repositories';
import {
  AddressSecretVaultService,
  AiBrowserBusyError,
  RunStateMachine,
  ShoppingAiClientService,
  ShoppingEventStreamService,
  ShoppingReportService,
  ViewerTokenService,
} from './services';
import { eventEnvelope } from './services/shopping-event-stream.service';
import {
  ADDRESS_FIELDS,
  AddressField,
  ApprovalStatus,
  ApprovalType,
  ControlLeaseStatus,
  EGYPT_MERCHANTS,
  EventType,
  RequestedCategory,
  RunControlAction,
  ShoppingCategory,
  ShoppingRunState,
  SupportedLocale,
  TERMINAL_RUN_STATES,
  ViewerMode,
} from './shopping.types';

const USER_INPUT_WARNING_CODES = new Set([
  'login_required',
  'one_time_code_required',
  'captcha_detected',
  'browser_warning',
]);

@Injectable()
export class ShoppingService implements OnModuleDestroy {
  private readonly browserTtlSeconds: number;
  private readonly leaseTtlSeconds: number;
  private readonly publicOrigin: string;
  private readonly leaseTimers = new Map<string, NodeJS.Timeout>();
  private readonly pendingRunOwners = new Map<string, string>();

  constructor(
    @Inject(SHOPPING_STORE) private readonly store: ShoppingStore,
    private readonly states: RunStateMachine,
    private readonly vault: AddressSecretVaultService,
    private readonly ai: ShoppingAiClientService,
    private readonly viewerTokens: ViewerTokenService,
    private readonly events: ShoppingEventStreamService,
    private readonly reports: ShoppingReportService,
    config: ConfigService,
  ) {
    this.browserTtlSeconds = config.get<number>(
      'shopping.browserTtlSeconds',
      3600,
    );
    this.leaseTtlSeconds = config.get<number>(
      'shopping.controlLeaseTtlSeconds',
      120,
    );
    this.publicOrigin = config
      .get<string>('shopping.publicOrigin', 'http://localhost:8080')
      .replace(/\/$/, '');
  }

  onModuleDestroy(): void {
    for (const timer of this.leaseTimers.values()) clearTimeout(timer);
    this.leaseTimers.clear();
  }

  async create(userId: string, dto: CreateShoppingRunDto) {
    const category =
      dto.category === RequestedCategory.Auto
        ? classify(dto.query)
        : (dto.category as unknown as ShoppingCategory);
    const requestId = category ? null : ulid();
    const candidate = Object.assign(new ShoppingRun(), {
      userId,
      requestedCategory: dto.category,
      category,
      market: 'EG' as const,
      currency: 'EGP' as const,
      timezone: 'Africa/Cairo' as const,
      locale: dto.locale,
      query: dto.query,
      status: category
        ? ShoppingRunState.Discovering
        : ShoppingRunState.Clarifying,
      resumeStatus: null,
      pendingAction: requestId
        ? {
            type: 'clarification' as const,
            requestId,
            questions: [
              {
                id: 'category',
                prompt:
                  dto.locale === SupportedLocale.ArabicEgypt
                    ? 'هل تبحث عن منتج أم طعام أم تذاكر سينما؟'
                    : 'Are you shopping for retail, food, or cinema?',
                required: true,
              },
            ],
          }
        : null,
      failure: null,
      completedAt: null,
      browserExpiresAt: new Date(Date.now() + this.browserTtlSeconds * 1000),
      lastEventId: null,
    });
    this.pendingRunOwners.set(candidate.id, userId);
    let run: ShoppingRun;
    try {
      await this.createAiRun(candidate, userId);
      run = await this.store.createRun(candidate);
    } finally {
      this.pendingRunOwners.delete(candidate.id);
    }
    await this.recordEvent(run, 'run.created', {
      requestedCategory: run.requestedCategory,
      category: run.category,
      locale: run.locale,
    });
    if (run.pendingAction?.type === 'clarification') {
      await this.recordEvent(run, 'run.clarification_required', {
        requestId: run.pendingAction.requestId,
        questions: run.pendingAction.questions,
      });
    }
    return { run: this.runView(run) };
  }

  private async createAiRun(
    candidate: ShoppingRun,
    userId: string,
  ): Promise<void> {
    try {
      await this.ai.createRun(candidate);
      return;
    } catch (error) {
      if (!(error instanceof AiBrowserBusyError)) throw error;
      await this.recoverOrTranslateBrowserBusy(error, candidate, userId);
    }
  }

  private async recoverOrTranslateBrowserBusy(
    error: AiBrowserBusyError,
    candidate: ShoppingRun,
    userId: string,
  ): Promise<void> {
    const activeRunId = error.activeRunId;
    const activeRun = activeRunId
      ? await this.store.findRun(activeRunId)
      : null;
    if (
      activeRun &&
      activeRun.userId === userId &&
      !TERMINAL_RUN_STATES.has(activeRun.status)
    ) {
      throw new ContractException(
        'ACTIVE_RUN_EXISTS',
        409,
        'You already have an unfinished shopping run',
        [
          {
            field: 'runId',
            code: 'ACTIVE_RUN',
            message: activeRun.id,
          },
        ],
      );
    }

    const pendingOwner = activeRunId
      ? this.pendingRunOwners.get(activeRunId)
      : undefined;
    if (activeRun && !TERMINAL_RUN_STATES.has(activeRun.status)) {
      this.browserBusy(error);
    }
    if (pendingOwner !== undefined) {
      this.browserBusy(error);
    }
    if (!activeRunId) {
      this.browserBusy(error);
    }

    // The AI process can survive an API restart or a failed persistence step.
    // If its active ID is absent from the authoritative API store (or already
    // terminal there), no user can resume or cancel it through the public API.
    // Close that orphan and retry this admission once.
    try {
      await this.ai.cancelOrphanRun(activeRunId);
      await this.ai.createRun(candidate);
    } catch (recoveryError) {
      if (recoveryError instanceof AiBrowserBusyError)
        this.browserBusy(recoveryError);
      this.browserBusy(error);
    }
  }

  private browserBusy(error: AiBrowserBusyError): never {
    throw new ContractException(
      'BROWSER_BUSY',
      429,
      `The shopping browser is busy; try again in ${error.retryAfterSeconds} seconds`,
    );
  }

  merchants(category?: ShoppingCategory) {
    return {
      merchants: EGYPT_MERCHANTS.filter(
        (merchant) => !category || merchant.category === category,
      ),
    };
  }

  async get(userId: string, id: string) {
    return { run: this.runView(await this.getOwnedRun(userId, id)) };
  }

  async clarify(userId: string, id: string, dto: SubmitClarificationDto) {
    const run = await this.getOwnedRun(userId, id);
    this.requireState(run, ShoppingRunState.Clarifying);
    const pending = this.requirePending(run, 'clarification', dto.requestId);
    const questionIds = new Set(
      pending.questions.map((question) => question.id),
    );
    const answerIds = Object.keys(dto.answers);
    if (
      answerIds.some((key) => !questionIds.has(key)) ||
      pending.questions.some(
        (question) =>
          question.required && !nonEmptyAnswer(dto.answers[question.id]),
      )
    ) {
      throw new ContractException(
        'VALIDATION_ERROR',
        400,
        'Clarification answers do not match the pending questions',
      );
    }
    const category = run.category ?? categoryFromAnswer(dto.answers.category);
    await this.ai.command(run, 'clarify', {
      requestId: dto.requestId,
      answers: dto.answers,
    });
    run.category = category;
    run.pendingAction = null;
    if (category) run.status = ShoppingRunState.Discovering;
    await this.store.saveRun(run);
    await this.recordEvent(run, 'run.clarification_submitted', {
      requestId: dto.requestId,
      answeredQuestionIds: answerIds,
      category: run.category,
    });
    return { run: this.runView(run) };
  }

  async approveDomains(userId: string, id: string, dto: ApproveDomainsDto) {
    const run = await this.getOwnedRun(userId, id);
    this.requireState(run, ShoppingRunState.AwaitingDomainApproval);
    const pending = this.requirePending(run, 'domain_approval', dto.requestId);
    const candidates = new Set(
      pending.candidates.map((merchant) => merchant.domain),
    );
    if (
      dto.domains.some(
        (domain) => !canonicalDomain(domain) || !candidates.has(domain),
      )
    ) {
      throw new ContractException(
        'DOMAIN_NOT_ALLOWED',
        400,
        'Approved domains must be a non-empty subset of current candidates',
      );
    }
    const approval = Object.assign(new RunApproval(), {
      id: ulid(),
      runId: run.id,
      requestId: dto.requestId,
      type: ApprovalType.DomainAccess,
      merchantDomains: dto.domains,
      offerId: null,
      status: ApprovalStatus.Approved,
      approvedAt: new Date(),
      expiresAt: null,
    });
    await this.ai.command(run, 'approve_domains', {
      approvalId: approval.id,
      requestId: dto.requestId,
      domains: dto.domains,
    });
    run.pendingAction = null;
    this.changeStatus(run, ShoppingRunState.Comparing);
    await this.store.saveRunAndApproval(run, approval);
    await this.recordEvent(run, 'domains.approved', {
      approvalId: approval.id,
      requestId: dto.requestId,
      domains: dto.domains,
    });
    return { run: this.runView(run), approval: this.approvalView(approval) };
  }

  async grantAddress(userId: string, id: string, dto: AddressGrantDto) {
    const run = await this.getOwnedRun(userId, id);
    this.requireState(run, ShoppingRunState.AwaitingAddressConsent);
    const pending = this.requirePending(run, 'address_consent', dto.requestId);
    if (
      dto.merchantDomains.some(
        (domain) => !pending.merchantDomains.includes(domain),
      )
    )
      this.stale();
    await this.assertEffectiveDomains(run.id, dto.merchantDomains);
    const grant = this.vault.store(run.id, dto, run.browserExpiresAt);
    const approval = Object.assign(new RunApproval(), {
      id: ulid(),
      runId: run.id,
      requestId: dto.requestId,
      type: ApprovalType.AddressShare,
      merchantDomains: dto.merchantDomains,
      offerId: null,
      status: ApprovalStatus.Approved,
      approvedAt: new Date(),
      expiresAt: new Date(grant.expiresAt),
    });
    try {
      await this.ai.command(run, 'grant_address', {
        approvalId: approval.id,
        requestId: dto.requestId,
        secretReference: grant.secretReference,
        merchantDomains: dto.merchantDomains,
        expiresAt: grant.expiresAt,
      });
    } catch (error) {
      this.vault.delete(grant.secretReference);
      throw error;
    }
    try {
      run.pendingAction = null;
      this.changeStatus(run, ShoppingRunState.Comparing);
      await this.store.saveRunAndApproval(run, approval);
    } catch (error) {
      this.vault.delete(grant.secretReference);
      throw error;
    }
    await this.recordEvent(run, 'address.granted', {
      approvalId: approval.id,
      requestId: dto.requestId,
      merchantDomains: dto.merchantDomains,
      expiresAt: grant.expiresAt,
    });
    return { run: this.runView(run), approval: this.approvalView(approval) };
  }

  async approveSeatHold(userId: string, id: string, dto: SeatHoldApprovalDto) {
    const run = await this.getOwnedRun(userId, id);
    this.requireState(run, ShoppingRunState.AwaitingSeatHoldApproval);
    if (run.category !== ShoppingCategory.Cinema)
      throw new ContractException(
        'INVALID_RUN_TRANSITION',
        409,
        'Seat holds apply only to cinema runs',
      );
    const pending = this.requirePending(
      run,
      'seat_hold_approval',
      dto.requestId,
    );
    if (
      pending.offerId !== dto.offerId ||
      pending.merchantDomain !== dto.merchantDomain
    )
      this.stale();
    await this.assertEffectiveDomains(run.id, [dto.merchantDomain]);
    const approval = Object.assign(new RunApproval(), {
      id: ulid(),
      runId: run.id,
      requestId: dto.requestId,
      type: ApprovalType.SeatHold,
      merchantDomains: [dto.merchantDomain],
      offerId: dto.offerId,
      status: ApprovalStatus.Approved,
      approvedAt: new Date(),
      expiresAt: null,
    });
    await this.ai.command(run, 'approve_seat_hold', {
      approvalId: approval.id,
      requestId: dto.requestId,
      merchantDomain: dto.merchantDomain,
      offerId: dto.offerId,
    });
    run.pendingAction = null;
    this.changeStatus(run, ShoppingRunState.Comparing);
    await this.store.saveRunAndApproval(run, approval);
    await this.recordEvent(run, 'seat_hold.approved', {
      approvalId: approval.id,
      requestId: dto.requestId,
      offerId: dto.offerId,
      merchantDomain: dto.merchantDomain,
    });
    return { run: this.runView(run), approval: this.approvalView(approval) };
  }

  async control(userId: string, id: string, dto: RunControlDto) {
    const run = await this.getOwnedRun(userId, id);
    if (
      (dto.action === RunControlAction.Resume ||
        dto.action === RunControlAction.Complete) &&
      dto.reason
    ) {
      throw new ContractException(
        'VALIDATION_ERROR',
        400,
        'reason is permitted only for pause or cancel',
      );
    }
    switch (dto.action) {
      case RunControlAction.Pause:
        if (
          run.status === ShoppingRunState.Paused ||
          TERMINAL_RUN_STATES.has(run.status)
        )
          this.invalidTransition();
        await this.ai.command(run, 'pause', { reason: 'user' });
        run.resumeStatus = run.status;
        await this.setStatus(run, ShoppingRunState.Paused);
        break;
      case RunControlAction.Resume: {
        this.requireState(run, ShoppingRunState.Paused);
        if (!run.resumeStatus) this.invalidTransition();
        await this.ai.command(run, 'resume', { reason: 'user' });
        const target = run.resumeStatus;
        this.changeStatus(run, target);
        run.resumeStatus = null;
        await this.store.saveRun(run);
        break;
      }
      case RunControlAction.Cancel:
        if (TERMINAL_RUN_STATES.has(run.status)) this.invalidTransition();
        await this.ai.command(run, 'cancel', { reason: dto.reason ?? null });
        run.completedAt = new Date();
        this.changeStatus(run, ShoppingRunState.Cancelled);
        await this.store.saveRun(run);
        this.clearLeaseTimer(run.id);
        this.vault.deleteRun(run.id);
        await this.recordEvent(run, 'run.cancelled', {
          cancelledAt: run.completedAt.toISOString(),
          reasonCode: dto.reason ? 'USER_CANCELLED' : null,
        });
        break;
      case RunControlAction.Complete: {
        if (
          ![
            ShoppingRunState.ReadyForHandoff,
            ShoppingRunState.UserTakeover,
          ].includes(run.status)
        )
          this.invalidTransition();
        const report = await this.reports.build(run);
        await this.ai.command(run, 'complete', {
          reason: 'user_finished',
          reportId: report.id,
        });
        run.completedAt = new Date();
        this.changeStatus(run, ShoppingRunState.Completed);
        await this.store.saveRun(run);
        this.clearLeaseTimer(run.id);
        this.vault.deleteRun(run.id);
        await this.recordEvent(run, 'run.completed', {
          completedAt: run.completedAt.toISOString(),
          reportId: report.id,
        });
        break;
      }
    }
    return { run: this.runView(run) };
  }

  async claimControl(userId: string, id: string, dto: ClaimControlDto) {
    const run = await this.getOwnedRun(userId, id);
    this.requireState(run, ShoppingRunState.Paused);
    const pending = this.requirePending(run, 'browser_takeover', dto.requestId);
    if (pending.merchantAttemptId !== dto.merchantAttemptId) this.stale();
    if (await this.store.findActiveLease(run.id))
      throw new ContractException(
        'CONTROL_LEASE_CONFLICT',
        409,
        'A control lease is already active',
      );
    const now = new Date();
    const requested = dto.requestedLeaseSeconds ?? this.leaseTtlSeconds;
    const lease = Object.assign(new ControlLease(), {
      id: ulid(),
      runId: run.id,
      holderUserId: userId,
      status: ControlLeaseStatus.Active,
      claimedAt: now,
      renewedAt: now,
      expiresAt: new Date(
        Math.min(
          now.getTime() + requested * 1000,
          run.browserExpiresAt.getTime(),
        ),
      ),
    });
    await this.ai.command(run, 'pause', {
      reason: 'control_claim',
      merchantAttemptId: pending.merchantAttemptId,
      merchantDomain: pending.merchantDomain,
    });
    this.changeStatus(run, ShoppingRunState.UserTakeover);
    await this.store.saveRunAndLease(run, lease);
    this.scheduleLeaseRecovery(run.id, lease);
    await this.recordEvent(run, 'control.claimed', {
      leaseId: lease.id,
      holderUserId: userId,
      expiresAt: lease.expiresAt.toISOString(),
      merchantAttemptId: pending.merchantAttemptId,
    });
    return { run: this.runView(run), lease: this.leaseView(lease) };
  }

  async renewControl(userId: string, id: string, dto: LeaseDto) {
    const run = await this.getOwnedRun(userId, id);
    const lease = await this.ownedLease(run, userId, dto.leaseId);
    if (lease.expiresAt <= new Date())
      throw new ContractException(
        'CONTROL_LEASE_EXPIRED',
        410,
        'Control lease has expired',
      );
    lease.renewedAt = new Date();
    lease.expiresAt = new Date(
      Math.min(
        lease.renewedAt.getTime() + this.leaseTtlSeconds * 1000,
        run.browserExpiresAt.getTime(),
      ),
    );
    await this.store.saveLease(lease);
    this.scheduleLeaseRecovery(run.id, lease);
    await this.recordEvent(run, 'control.renewed', {
      leaseId: lease.id,
      expiresAt: lease.expiresAt.toISOString(),
    });
    return { lease: this.leaseView(lease) };
  }

  async releaseControl(userId: string, id: string, dto: LeaseDto) {
    const run = await this.getOwnedRun(userId, id);
    this.requireState(run, ShoppingRunState.UserTakeover);
    const lease = await this.ownedLease(run, userId, dto.leaseId, true);
    if (
      lease.expiresAt <= new Date() &&
      lease.status === ControlLeaseStatus.Active
    )
      lease.status = ControlLeaseStatus.Recovering;
    await this.ai.command(run, 'resume', { reason: 'control_release' });
    lease.status = ControlLeaseStatus.Released;
    const resumeStatus = run.resumeStatus ?? ShoppingRunState.ReadyForHandoff;
    this.changeStatus(run, resumeStatus);
    run.resumeStatus = null;
    run.pendingAction = null;
    await this.store.saveRunAndLease(run, lease);
    this.clearLeaseTimer(run.id);
    const releasedAt = new Date().toISOString();
    await this.recordEvent(run, 'control.released', {
      leaseId: lease.id,
      releasedAt,
      recovery: 'resumed',
    });
    return { run: this.runView(run), lease: this.leaseView(lease) };
  }

  viewerToken(userId: string, id: string, dto: CreateViewerTokenDto) {
    if (dto.mode === ViewerMode.Control && !dto.leaseId)
      throw new ContractException(
        'VALIDATION_ERROR',
        400,
        'leaseId is required for control viewer tokens',
      );
    return this.viewerTokens.issue(id, userId, dto.mode, dto.leaseId);
  }

  authorizeViewer(token: string) {
    return this.viewerTokens.authorize(token);
  }

  async uploadEvidence(
    runId: string,
    evidenceId: string,
    file:
      | { buffer: Buffer; mimetype: string; originalname: string; size: number }
      | undefined,
  ) {
    if (!file || file.mimetype !== 'image/png' || !isPng(file.buffer))
      throw new ContractException(
        'VALIDATION_ERROR',
        400,
        'Evidence must be a PNG screenshot',
      );
    if (!evidenceId || evidenceId.length > 128)
      throw new ContractException(
        'VALIDATION_ERROR',
        400,
        'Evidence ID is invalid',
      );
    const run = await this.store.findRun(runId);
    if (!run)
      throw new ContractException(
        'RUN_NOT_FOUND',
        404,
        'Shopping run not found',
      );
    const existing = await this.store.findEvidence(evidenceId);
    if (existing && existing.runId !== runId)
      throw new ContractException(
        'EVENT_ID_CONFLICT',
        409,
        'Evidence ID belongs to another run',
      );
    const content = Buffer.from(file.buffer);
    const saved = await this.store.saveEvidence({
      ...(existing ?? {}),
      id: evidenceId,
      runId,
      kind: existing?.kind ?? 'screenshot',
      uri: this.evidenceUri(runId, evidenceId),
      sha256: createHash('sha256').update(content).digest('hex'),
      contentType: 'image/png',
      content,
      capturedAt: existing?.capturedAt ?? new Date(),
      merchantAttemptId: existing?.merchantAttemptId ?? null,
      redacted: true,
    });
    return { accepted: true, evidenceId: saved.id, sha256: saved.sha256 };
  }

  async evidence(userId: string, runId: string, evidenceId: string) {
    await this.getOwnedRun(userId, runId);
    const evidence = await this.store.findEvidence(evidenceId);
    if (
      !evidence ||
      evidence.runId !== runId ||
      !evidence.content ||
      evidence.contentType !== 'image/png'
    )
      throw new ContractException(
        'EVIDENCE_NOT_FOUND',
        404,
        'Screenshot evidence was not found',
      );
    return { content: evidence.content, contentType: evidence.contentType };
  }

  async resolveSecret(dto: ResolveSecretDto) {
    const run = await this.store.findRun(dto.runId);
    if (!run || TERMINAL_RUN_STATES.has(run.status))
      throw new ContractException(
        'RUN_NOT_FOUND',
        404,
        'Shopping run not found',
      );
    const resolved = this.vault.resolve(
      dto.runId,
      dto.secretReference,
      dto.merchantDomain,
      dto.field,
    );
    return {
      runId: dto.runId,
      field: dto.field,
      value: resolved.value,
      expiresAt: resolved.expiresAt,
    };
  }

  async receiveAiEvent(dto: AiEventDto) {
    if (!AI_EVENT_TYPES.has(dto.type)) {
      throw new ContractException(
        'INVALID_RUN_TRANSITION',
        409,
        'AI cannot emit this API-owned event type',
      );
    }
    assertEventPayload(dto.type, dto.payload);
    const run = await this.getRun(dto.runId);
    if (containsSecretKey(dto.payload))
      throw new ContractException(
        'VALIDATION_ERROR',
        400,
        'Event payload contains prohibited secret fields',
      );
    await this.validateAiEventStatus(run, dto);
    const appended = await this.store.appendEvent({
      runId: run.id,
      eventId: dto.id,
      type: dto.type,
      status: dto.status,
      timestamp: new Date(dto.timestamp),
      payload: dto.payload,
    });
    if (appended.duplicate) return { accepted: true, duplicate: true };
    await this.applyAiEvent(run, dto);
    await this.store.saveRun(run);
    this.events.publish(appended.event);
    return { accepted: true, duplicate: false };
  }

  async eventHistory(
    userId: string,
    id: string,
    after: string | undefined,
    limit: number,
  ) {
    await this.getOwnedRun(userId, id);
    const history = await this.store.eventsAfter(id, after, limit);
    return {
      events: history.events.map(eventEnvelope),
      nextAfter: history.hasMore
        ? (history.events.at(-1)?.eventId ?? null)
        : null,
      hasMore: history.hasMore,
    };
  }

  async report(userId: string, id: string) {
    return this.reports.build(await this.getOwnedRun(userId, id));
  }

  private async validateAiEventStatus(
    run: ShoppingRun,
    dto: AiEventDto,
  ): Promise<void> {
    if (TERMINAL_RUN_STATES.has(run.status)) this.invalidTransition();
    if (
      [
        ShoppingRunState.ReadyForHandoff,
        ShoppingRunState.UserTakeover,
      ].includes(run.status) &&
      ECONOMIC_EVENT_TYPES.has(dto.type)
    ) {
      throw new ContractException(
        'INVALID_RUN_TRANSITION',
        409,
        'Final report evidence is immutable after handoff readiness',
      );
    }
    const transitionTypes = new Set<EventType>([
      'run.clarification_required',
      'domains.approval_required',
      'address.approval_required',
      'seat_hold.approval_required',
      'run.status_changed',
      'run.completed',
      'run.cancelled',
      'run.failed',
    ]);
    if (!transitionTypes.has(dto.type) && dto.status !== run.status)
      this.invalidTransition();
    if (dto.status !== run.status)
      this.states.assertTransition(run.status, dto.status, run.resumeStatus);
    if (
      dto.type === 'run.status_changed' &&
      (dto.payload.from !== run.status || dto.payload.to !== dto.status)
    )
      this.invalidTransition();
    if (dto.type === 'domains.approval_required') {
      const candidates = dto.payload.candidates as Array<{
        domain: string;
        category: ShoppingCategory;
      }>;
      if (
        !run.category ||
        candidates.some(
          (candidate) =>
            candidate.category !== run.category ||
            !EGYPT_MERCHANTS.some(
              (merchant) =>
                merchant.category === run.category &&
                merchant.domain === candidate.domain,
            ),
        )
      ) {
        throw new ContractException(
          'DOMAIN_NOT_ALLOWED',
          400,
          'Domain candidates are outside the Egypt catalog',
        );
      }
    }
    if (dto.type === 'merchant.attempt_started') {
      const merchant = EGYPT_MERCHANTS.find(
        (candidate) => candidate.id === dto.payload.merchantId,
      );
      if (
        !merchant ||
        merchant.domain !== dto.payload.merchantDomain ||
        merchant.category !== run.category
      ) {
        throw new ContractException(
          'DOMAIN_NOT_ALLOWED',
          400,
          'Merchant attempt is outside the run catalog',
        );
      }
      await this.assertEffectiveDomains(run.id, [merchant.domain]);
    }
    if (dto.type === 'merchant.attempt_completed') {
      const data = await this.store.report(run.id);
      if (
        !data.merchantAttempts.some(
          (attempt) => attempt.id === dto.payload.attemptId,
        )
      ) {
        throw new ContractException(
          'ACTION_REQUEST_NOT_FOUND',
          404,
          'Merchant attempt was not started',
        );
      }
    }
    if (dto.type === 'evidence.captured' && dto.payload.merchantAttemptId) {
      const data = await this.store.report(run.id);
      if (
        !data.merchantAttempts.some(
          (attempt) => attempt.id === dto.payload.merchantAttemptId,
        )
      )
        this.missingEventReference('Merchant attempt');
    }
    if (dto.type === 'run.warning' && dto.payload.requiresUserInput === true) {
      const merchantAttemptId = dto.payload.merchantAttemptId;
      if (
        dto.status !== ShoppingRunState.Paused ||
        !isString(merchantAttemptId)
      )
        invalidEvent(dto.type);
      const data = await this.store.report(run.id);
      if (
        !data.merchantAttempts.some(
          (attempt) => attempt.id === merchantAttemptId,
        )
      )
        this.missingEventReference('Merchant attempt');
    }
    if (dto.type === 'offer.recorded') {
      const data = await this.store.report(run.id);
      if (
        !data.merchantAttempts.some(
          (attempt) => attempt.id === dto.payload.merchantAttemptId,
        )
      )
        this.missingEventReference('Merchant attempt');
      this.assertEvidenceReferences(data.evidence, dto.payload.evidenceIds);
    }
    if (dto.type === 'coupon.attempted') {
      const data = await this.store.report(run.id);
      if (!data.offers.some((offer) => offer.id === dto.payload.offerId))
        this.missingEventReference('Offer');
      this.assertEvidenceReferences(data.evidence, dto.payload.evidenceIds);
      const kinds = new Set(
        data.evidence
          .filter((item) =>
            (dto.payload.evidenceIds as string[]).includes(item.id),
          )
          .map((item) => item.kind),
      );
      if (!kinds.has('coupon_source') || !kinds.has('coupon_result'))
        throw new ContractException(
          'VALIDATION_ERROR',
          400,
          'Coupon evidence must include source and result artifacts',
        );
    }
  }

  private async applyAiEvent(run: ShoppingRun, dto: AiEventDto): Promise<void> {
    const previousStatus = run.status;
    run.status = dto.status;
    run.lastEventId = dto.id;
    if (
      dto.type === 'run.status_changed' &&
      dto.status === ShoppingRunState.Paused &&
      previousStatus !== ShoppingRunState.Paused
    ) {
      run.resumeStatus = previousStatus;
    } else if (
      dto.type === 'run.status_changed' &&
      previousStatus === ShoppingRunState.Paused &&
      dto.status !== ShoppingRunState.Paused
    ) {
      run.resumeStatus = null;
    }
    switch (dto.type) {
      case 'run.clarification_required':
        run.pendingAction = {
          type: 'clarification',
          requestId: String(dto.payload.requestId),
          questions: dto.payload.questions as Array<{
            id: string;
            prompt: string;
            required: boolean;
          }>,
        };
        break;
      case 'domains.approval_required':
        run.pendingAction = {
          type: 'domain_approval',
          requestId: String(dto.payload.requestId),
          candidates: dto.payload
            .candidates as typeof EGYPT_MERCHANTS extends readonly (infer T)[]
            ? T[]
            : never,
        };
        break;
      case 'address.approval_required':
        run.pendingAction = {
          type: 'address_consent',
          requestId: String(dto.payload.requestId),
          merchantDomains: dto.payload.merchantDomains as string[],
          fields: dto.payload.fields as typeof ADDRESS_FIELDS,
        };
        break;
      case 'seat_hold.approval_required':
        run.pendingAction = {
          type: 'seat_hold_approval',
          requestId: String(dto.payload.requestId),
          offerId: String(dto.payload.offerId),
          merchantDomain: String(dto.payload.merchantDomain),
          holdDurationSeconds: dto.payload.holdDurationSeconds as number | null,
        };
        break;
      case 'run.warning': {
        if (dto.payload.requiresUserInput !== true) break;
        const data = await this.store.report(run.id);
        const attempt = data.merchantAttempts.find(
          (candidate) => candidate.id === dto.payload.merchantAttemptId,
        );
        if (!attempt) break;
        run.pendingAction = {
          type: 'browser_takeover',
          requestId: dto.id,
          merchantAttemptId: attempt.id,
          merchantName: attempt.merchantName,
          merchantDomain: attempt.merchantDomain,
          reasonCode: String(dto.payload.code),
          message: String(dto.payload.message),
        };
        break;
      }
      case 'merchant.attempt_started': {
        const merchant = EGYPT_MERCHANTS.find(
          (candidate) => candidate.id === dto.payload.merchantId,
        );
        if (!merchant) break;
        await this.store.saveMerchantAttempt({
          id: String(dto.payload.attemptId),
          runId: run.id,
          merchantId: merchant.id,
          merchantName: merchant.name,
          merchantDomain: merchant.domain,
          category: merchant.category,
          outcome: 'in_progress',
          failureCode: null,
          message: 'Merchant attempt is still in progress.',
          evidenceIds: [],
          startedAt: new Date(dto.timestamp),
          finishedAt: null,
        });
        break;
      }
      case 'merchant.attempt_completed': {
        const data = await this.store.report(run.id);
        const attempt = data.merchantAttempts.find(
          (candidate) => candidate.id === dto.payload.attemptId,
        );
        if (!attempt) break;
        attempt.outcome = String(dto.payload.outcome);
        attempt.failureCode = dto.payload.failureCode as string | null;
        attempt.message = null;
        attempt.evidenceIds = dto.payload.evidenceIds as string[];
        attempt.finishedAt = new Date(dto.timestamp);
        await this.store.saveMerchantAttempt(attempt);
        break;
      }
      case 'evidence.captured': {
        const evidenceId = String(dto.payload.evidenceId);
        const uploaded = await this.store.findEvidence(evidenceId);
        if (uploaded && uploaded.runId !== run.id)
          throw new ContractException(
            'EVENT_ID_CONFLICT',
            409,
            'Evidence ID belongs to another run',
          );
        await this.store.saveEvidence({
          ...(uploaded ?? {}),
          id: evidenceId,
          runId: run.id,
          kind: String(dto.payload.kind),
          uri: this.evidenceUri(run.id, evidenceId),
          sha256:
            uploaded?.sha256 ??
            createHash('sha256')
              .update(`${run.id}:${evidenceId}`)
              .digest('hex'),
          contentType: uploaded?.contentType ?? null,
          content: uploaded?.content ?? null,
          capturedAt: new Date(dto.timestamp),
          merchantAttemptId: dto.payload.merchantAttemptId as string | null,
          redacted: true,
        });
        break;
      }
      case 'offer.recorded': {
        const data = await this.store.report(run.id);
        const attempt = data.merchantAttempts.find(
          (candidate) => candidate.id === dto.payload.merchantAttemptId,
        );
        if (!attempt) break;
        const incomingValidity = String(dto.payload.validity);
        await this.store.saveOffer({
          id: String(dto.payload.offerId),
          runId: run.id,
          merchantAttemptId: attempt.id,
          merchantName: attempt.merchantName,
          merchantDomain: attempt.merchantDomain,
          category: attempt.category,
          title: `Offer ${String(dto.payload.offerId)}`,
          sourceUrl: `https://${attempt.merchantDomain}/`,
          match: {
            exact: false,
            confidence: 0,
            explanation:
              'The canonical event confirms discovery but carries no economic detail.',
          },
          availability: 'unknown',
          details: incompleteDetails(attempt.category),
          price: {
            itemSubtotal: '0.00',
            deliveryFee: null,
            serviceFee: null,
            bookingFee: null,
            tax: null,
            mandatoryFees: [],
            verifiedDiscount: '0.00',
            optionalTip:
              attempt.category === ShoppingCategory.Food ? '0.00' : null,
            finalTotal: null,
          },
          validity: incomingValidity === 'excluded' ? 'excluded' : 'incomplete',
          observedAt: new Date(dto.timestamp),
          evidenceIds: dto.payload.evidenceIds as string[],
          exclusionReason:
            incomingValidity === 'excluded'
              ? 'The AI classified this offer outside the comparison scope.'
              : null,
          incompleteFields: ['economicDetails'],
        });
        break;
      }
      case 'coupon.attempted': {
        const offer = await this.store.findOffer(String(dto.payload.offerId));
        if (!offer) break;
        await this.store.saveCouponAttempt({
          id: String(dto.payload.couponAttemptId),
          runId: run.id,
          offerId: offer.id,
          merchantDomain: offer.merchantDomain,
          code: '[not supplied by event]',
          sourceUrl: `https://${offer.merchantDomain}/`,
          status: String(dto.payload.status),
          beforeTotal: '0.00',
          afterTotal: null,
          verifiedDiscount: '0.00',
          rejectionReason: dto.payload.rejectionReason as string | null,
          message: 'Coupon economics were not included in the event envelope.',
          attemptedAt: new Date(dto.timestamp),
          evidenceIds: dto.payload.evidenceIds as string[],
        });
        break;
      }
      case 'run.failed':
        run.resumeStatus = null;
        run.failure = {
          code: String(dto.payload.failureCode),
          message: 'The shopping run failed',
        };
        run.completedAt = new Date(dto.timestamp);
        run.pendingAction = null;
        this.clearLeaseTimer(run.id);
        this.vault.deleteRun(run.id);
        break;
      case 'run.completed':
      case 'run.cancelled':
        run.resumeStatus = null;
        run.completedAt = new Date(dto.timestamp);
        run.pendingAction = null;
        this.clearLeaseTimer(run.id);
        this.vault.deleteRun(run.id);
        break;
      default:
        if (
          ![
            ShoppingRunState.Clarifying,
            ShoppingRunState.AwaitingDomainApproval,
            ShoppingRunState.AwaitingAddressConsent,
            ShoppingRunState.AwaitingSeatHoldApproval,
            ShoppingRunState.ReadyForHandoff,
          ].includes(run.status)
        )
          run.pendingAction = null;
    }
  }

  private async setStatus(
    run: ShoppingRun,
    status: ShoppingRunState,
  ): Promise<void> {
    this.changeStatus(run, status);
    await this.store.saveRun(run);
  }

  private changeStatus(run: ShoppingRun, status: ShoppingRunState): void {
    if (run.status === status) return;
    this.states.assertTransition(run.status, status, run.resumeStatus);
    run.status = status;
  }

  private async recordEvent(
    run: ShoppingRun,
    type: EventType,
    payload: Record<string, unknown>,
  ): Promise<RunEvent> {
    const result = await this.store.appendEvent({
      runId: run.id,
      eventId: `api:${ulid()}`,
      type,
      status: run.status,
      timestamp: new Date(),
      payload,
    });
    run.lastEventId = result.event.eventId;
    await this.store.saveRun(run);
    if (!result.duplicate) this.events.publish(result.event);
    return result.event;
  }

  private async getOwnedRun(userId: string, id: string): Promise<ShoppingRun> {
    const run = await this.store.findRun(id);
    if (!run || run.userId !== userId)
      throw new ContractException(
        'RUN_NOT_FOUND',
        404,
        'Shopping run not found',
      );
    return run;
  }

  private async getRun(id: string): Promise<ShoppingRun> {
    const run = await this.store.findRun(id);
    if (!run)
      throw new ContractException(
        'RUN_NOT_FOUND',
        404,
        'Shopping run not found',
      );
    return run;
  }

  private requireState(run: ShoppingRun, expected: ShoppingRunState): void {
    if (run.status !== expected) this.invalidTransition();
  }

  private requirePending<
    T extends NonNullable<ShoppingRun['pendingAction']>['type'],
  >(
    run: ShoppingRun,
    type: T,
    requestId: string,
  ): Extract<NonNullable<ShoppingRun['pendingAction']>, { type: T }> {
    const pending = run.pendingAction;
    if (!pending || pending.type !== type)
      throw new ContractException(
        'ACTION_REQUEST_NOT_FOUND',
        404,
        'Pending action was not found',
      );
    if (pending.requestId !== requestId) this.stale();
    return pending as Extract<
      NonNullable<ShoppingRun['pendingAction']>,
      { type: T }
    >;
  }

  private async assertEffectiveDomains(
    runId: string,
    domains: string[],
  ): Promise<void> {
    const data = await this.store.report(runId);
    const now = new Date();
    const approved = new Set(
      data.approvals
        .filter(
          (approval) =>
            approval.type === ApprovalType.DomainAccess &&
            approval.status === ApprovalStatus.Approved &&
            (!approval.expiresAt || approval.expiresAt > now),
        )
        .flatMap((approval) => approval.merchantDomains),
    );
    if (domains.some((domain) => !approved.has(domain)))
      throw new ContractException(
        'DOMAIN_NOT_APPROVED',
        403,
        'Domain access is not approved',
      );
  }

  private assertEvidenceReferences(
    evidence: Array<{ id: string }>,
    value: unknown,
  ): void {
    const known = new Set(evidence.map((item) => item.id));
    if (!(value as string[]).every((id) => known.has(id)))
      this.missingEventReference('Evidence');
  }

  private missingEventReference(kind: string): never {
    throw new ContractException(
      'ACTION_REQUEST_NOT_FOUND',
      404,
      `${kind} reference was not found for this run`,
    );
  }

  private async ownedLease(
    run: ShoppingRun,
    userId: string,
    leaseId: string,
    recovering = false,
  ): Promise<ControlLease> {
    const lease = await this.store.findLease(leaseId);
    const statuses = recovering
      ? [ControlLeaseStatus.Active, ControlLeaseStatus.Recovering]
      : [ControlLeaseStatus.Active];
    if (
      !lease ||
      lease.runId !== run.id ||
      lease.holderUserId !== userId ||
      !statuses.includes(lease.status)
    )
      throw new ContractException(
        'CONTROL_LEASE_CONFLICT',
        409,
        'Control lease is unavailable',
      );
    return lease;
  }

  private runView(run: ShoppingRun) {
    return {
      id: run.id,
      requestedCategory: run.requestedCategory,
      category: run.category,
      market: 'EG' as const,
      currency: 'EGP' as const,
      timezone: 'Africa/Cairo' as const,
      locale: run.locale,
      query: run.query,
      status: run.status,
      resumeStatus: run.resumeStatus,
      pendingAction: run.pendingAction,
      failure: run.failure,
      createdAt: run.createdAt.toISOString(),
      updatedAt: run.updatedAt.toISOString(),
      completedAt: run.completedAt?.toISOString() ?? null,
      browserExpiresAt: run.browserExpiresAt.toISOString(),
      lastEventId: run.lastEventId,
    };
  }

  private approvalView(approval: RunApproval) {
    return {
      id: approval.id,
      runId: approval.runId,
      requestId: approval.requestId,
      type: approval.type,
      merchantDomains: approval.merchantDomains,
      offerId: approval.offerId,
      status: approval.status,
      approvedAt: approval.approvedAt.toISOString(),
      expiresAt: approval.expiresAt?.toISOString() ?? null,
    };
  }

  private leaseView(lease: ControlLease) {
    return {
      id: lease.id,
      runId: lease.runId,
      holderUserId: lease.holderUserId,
      status: lease.status,
      claimedAt: lease.claimedAt.toISOString(),
      renewedAt: lease.renewedAt.toISOString(),
      expiresAt: lease.expiresAt.toISOString(),
    };
  }

  private scheduleLeaseRecovery(runId: string, lease: ControlLease): void {
    this.clearLeaseTimer(runId);
    const delay = Math.max(0, lease.expiresAt.getTime() - Date.now());
    const timer = setTimeout(() => {
      void this.recoverExpiredLease(
        runId,
        lease.id,
        `lease-expiry:${lease.id}`,
        lease.expiresAt.toISOString(),
        false,
      );
    }, delay);
    timer.unref();
    this.leaseTimers.set(runId, timer);
  }

  private async recoverExpiredLease(
    runId: string,
    leaseId: string,
    commandId: string,
    issuedAt: string,
    pendingReported: boolean,
  ): Promise<void> {
    const [run, lease] = await Promise.all([
      this.store.findRun(runId),
      this.store.findLease(leaseId),
    ]);
    if (
      !run ||
      !lease ||
      run.status !== ShoppingRunState.UserTakeover ||
      ![ControlLeaseStatus.Active, ControlLeaseStatus.Recovering].includes(
        lease.status,
      )
    ) {
      this.clearLeaseTimer(runId);
      return;
    }
    if (lease.expiresAt > new Date()) {
      this.scheduleLeaseRecovery(runId, lease);
      return;
    }
    if (lease.status === ControlLeaseStatus.Active) {
      lease.status = ControlLeaseStatus.Recovering;
      await this.store.saveLease(lease);
    }
    try {
      await this.ai.command(
        run,
        'resume',
        { reason: 'lease_expired' },
        commandId,
        issuedAt,
      );
    } catch {
      if (!pendingReported) {
        await this.recordEvent(run, 'control.lease_expired', {
          leaseId,
          expiredAt: lease.expiresAt.toISOString(),
          recovery: 'pending',
        });
      }
      const timer = setTimeout(() => {
        void this.recoverExpiredLease(
          runId,
          leaseId,
          commandId,
          issuedAt,
          true,
        );
      }, 5_000);
      timer.unref();
      this.leaseTimers.set(runId, timer);
      return;
    }
    lease.status = ControlLeaseStatus.Expired;
    const resumeStatus = run.resumeStatus ?? ShoppingRunState.ReadyForHandoff;
    this.changeStatus(run, resumeStatus);
    run.resumeStatus = null;
    run.pendingAction = null;
    await this.store.saveRunAndLease(run, lease);
    await this.recordEvent(run, 'control.lease_expired', {
      leaseId,
      expiredAt: lease.expiresAt.toISOString(),
      recovery: 'resumed',
    });
    this.clearLeaseTimer(runId);
  }

  private clearLeaseTimer(runId: string): void {
    const timer = this.leaseTimers.get(runId);
    if (timer) clearTimeout(timer);
    this.leaseTimers.delete(runId);
  }

  private evidenceUri(runId: string, evidenceId: string): string {
    return `${this.publicOrigin}/api/v1/shopping/runs/${encodeURIComponent(runId)}/evidence/${encodeURIComponent(evidenceId)}`;
  }

  private stale(): never {
    throw new ContractException(
      'STALE_ACTION_REQUEST',
      409,
      'Pending action request is stale',
    );
  }
  private invalidTransition(): never {
    throw new ContractException(
      'INVALID_RUN_TRANSITION',
      409,
      'Run state does not allow this operation',
    );
  }
}

function classify(query: string): ShoppingCategory | null {
  const text = query.toLocaleLowerCase('en');
  const groups: Array<[ShoppingCategory, RegExp]> = [
    [
      ShoppingCategory.Cinema,
      /\b(cinema|movie|film|ticket|showtime|vox)\b|سينما|فيلم|تذاكر/iu,
    ],
    [
      ShoppingCategory.Food,
      /\b(food|meal|restaurant|pizzas?|burgers?|delivery|talabat|elmenus|menu egypt|google maps|koshar[yi]s?|shaw(?:a|e)rmas?)\b|طعام|أكل|مطعم|بيتزا|وجبة|كشري|كشرى|شاورما/iu,
    ],
    [
      ShoppingCategory.Retail,
      /\b(buy|phone|laptop|television|tv|product|amazon|jumia|noon)\b|شراء|هاتف|موبايل|لابتوب|منتج|تلفزيون/iu,
    ],
  ];
  const matches = groups.filter(([, pattern]) => pattern.test(text));
  return matches.length === 1 ? matches[0][0] : null;
}

function categoryFromAnswer(
  value: string | string[] | undefined,
): ShoppingCategory | null {
  const answer = Array.isArray(value) ? value[0] : value;
  return Object.values(ShoppingCategory).includes(answer as ShoppingCategory)
    ? (answer as ShoppingCategory)
    : answer
      ? classify(answer)
      : null;
}

function nonEmptyAnswer(value: string | string[] | undefined): boolean {
  return typeof value === 'string'
    ? value.trim().length > 0
    : Array.isArray(value) &&
        value.length > 0 &&
        value.every((item) => item.trim().length > 0);
}

function isPng(content: Buffer): boolean {
  return (
    content.length >= 8 &&
    content
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  );
}

function canonicalDomain(domain: string): boolean {
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(domain);
}

const EVENT_KEYS: Record<
  EventType,
  { required: string[]; optional?: string[] }
> = {
  'run.created': { required: ['requestedCategory', 'category', 'locale'] },
  'run.clarification_required': { required: ['requestId', 'questions'] },
  'run.clarification_submitted': {
    required: ['requestId', 'answeredQuestionIds', 'category'],
  },
  'run.status_changed': { required: ['from', 'to', 'reasonCode'] },
  'domains.approval_required': { required: ['requestId', 'candidates'] },
  'domains.approved': { required: ['approvalId', 'requestId', 'domains'] },
  'address.approval_required': {
    required: ['requestId', 'merchantDomains', 'fields'],
  },
  'address.granted': {
    required: ['approvalId', 'requestId', 'merchantDomains', 'expiresAt'],
  },
  'seat_hold.approval_required': {
    required: ['requestId', 'offerId', 'merchantDomain', 'holdDurationSeconds'],
  },
  'seat_hold.approved': {
    required: ['approvalId', 'requestId', 'offerId', 'merchantDomain'],
  },
  'merchant.attempt_started': {
    required: ['attemptId', 'merchantId', 'merchantDomain', 'category'],
  },
  'merchant.attempt_completed': {
    required: ['attemptId', 'outcome', 'failureCode', 'evidenceIds'],
  },
  'offer.recorded': {
    required: ['offerId', 'validity', 'merchantAttemptId', 'evidenceIds'],
  },
  'coupon.attempted': {
    required: [
      'couponAttemptId',
      'offerId',
      'status',
      'rejectionReason',
      'evidenceIds',
    ],
  },
  'evidence.captured': {
    required: ['evidenceId', 'kind', 'merchantAttemptId', 'redacted'],
  },
  'run.warning': {
    required: ['code', 'message', 'merchantAttemptId', 'evidenceIds'],
    optional: ['requiresUserInput'],
  },
  'control.claimed': {
    required: ['leaseId', 'holderUserId', 'expiresAt', 'merchantAttemptId'],
  },
  'control.renewed': { required: ['leaseId', 'expiresAt'] },
  'control.released': { required: ['leaseId', 'releasedAt', 'recovery'] },
  'control.lease_expired': { required: ['leaseId', 'expiredAt', 'recovery'] },
  'report.updated': {
    required: ['validOfferCount', 'excludedOfferCount', 'incompleteOfferCount'],
  },
  'run.completed': { required: ['completedAt', 'reportId'] },
  'run.cancelled': { required: ['cancelledAt', 'reasonCode'] },
  'run.failed': { required: ['failedAt', 'failureCode', 'retryable'] },
  'stream.reset_required': {
    required: ['reason', 'oldestAvailableEventId', 'snapshotUrl'],
  },
};

const AI_EVENT_TYPES = new Set<EventType>([
  'run.clarification_required',
  'run.status_changed',
  'domains.approval_required',
  'address.approval_required',
  'seat_hold.approval_required',
  'merchant.attempt_started',
  'merchant.attempt_completed',
  'offer.recorded',
  'coupon.attempted',
  'evidence.captured',
  'run.warning',
  'report.updated',
  'run.failed',
]);

const ECONOMIC_EVENT_TYPES = new Set<EventType>([
  'merchant.attempt_started',
  'merchant.attempt_completed',
  'offer.recorded',
  'coupon.attempted',
  'evidence.captured',
  'report.updated',
]);

function assertEventPayload(
  type: EventType,
  payload: Record<string, unknown>,
): void {
  const required = EVENT_KEYS[type].required;
  const allowed = [...required, ...(EVENT_KEYS[type].optional ?? [])];
  const keys = Object.keys(payload);
  if (
    required.some((key) => !(key in payload)) ||
    keys.some((key) => !allowed.includes(key))
  ) {
    invalidEvent(type);
  }
  switch (type) {
    case 'run.clarification_required':
      if (
        !isString(payload.requestId) ||
        !Array.isArray(payload.questions) ||
        payload.questions.length === 0 ||
        payload.questions.some((question) => !exactQuestion(question))
      )
        invalidEvent(type);
      break;
    case 'run.status_changed':
      if (
        !isRunStatus(payload.from) ||
        !isRunStatus(payload.to) ||
        !nullableString(payload.reasonCode)
      )
        invalidEvent(type);
      break;
    case 'domains.approval_required':
      if (
        !isString(payload.requestId) ||
        !Array.isArray(payload.candidates) ||
        payload.candidates.length === 0 ||
        payload.candidates.length > 5 ||
        payload.candidates.some((candidate) => !exactMerchant(candidate))
      )
        invalidEvent(type);
      break;
    case 'address.approval_required':
      if (
        !isString(payload.requestId) ||
        !isStringArray(payload.merchantDomains, true) ||
        !Array.isArray(payload.fields) ||
        payload.fields.some(
          (field) =>
            typeof field !== 'string' ||
            !ADDRESS_FIELDS.includes(field as AddressField),
        )
      )
        invalidEvent(type);
      break;
    case 'seat_hold.approval_required':
      if (
        !isString(payload.requestId) ||
        !isString(payload.offerId) ||
        !isString(payload.merchantDomain) ||
        !(
          payload.holdDurationSeconds === null ||
          (Number.isInteger(payload.holdDurationSeconds) &&
            Number(payload.holdDurationSeconds) >= 0)
        )
      )
        invalidEvent(type);
      break;
    case 'merchant.attempt_started':
      if (
        !isString(payload.attemptId) ||
        !isString(payload.merchantId) ||
        !isString(payload.merchantDomain) ||
        !isCategory(payload.category)
      )
        invalidEvent(type);
      break;
    case 'merchant.attempt_completed':
      if (
        !isString(payload.attemptId) ||
        ![
          'succeeded',
          'blocked',
          'timed_out',
          'unavailable',
          'safety_paused',
          'failed',
        ].includes(String(payload.outcome)) ||
        !nullableString(payload.failureCode) ||
        !isStringArray(payload.evidenceIds)
      )
        invalidEvent(type);
      break;
    case 'offer.recorded':
      if (
        !isString(payload.offerId) ||
        !['valid', 'excluded', 'incomplete'].includes(
          String(payload.validity),
        ) ||
        !isString(payload.merchantAttemptId) ||
        !isStringArray(payload.evidenceIds, true)
      )
        invalidEvent(type);
      break;
    case 'coupon.attempted':
      if (
        !isString(payload.couponAttemptId) ||
        !isString(payload.offerId) ||
        !['verified', 'rejected', 'not_tested', 'technical_failure'].includes(
          String(payload.status),
        ) ||
        !nullableString(payload.rejectionReason) ||
        !isStringArray(payload.evidenceIds, true)
      )
        invalidEvent(type);
      break;
    case 'evidence.captured':
      if (
        !isString(payload.evidenceId) ||
        ![
          'screenshot',
          'dom_snapshot',
          'price_text',
          'coupon_source',
          'coupon_result',
          'seat_hold',
        ].includes(String(payload.kind)) ||
        !nullableString(payload.merchantAttemptId) ||
        payload.redacted !== true
      )
        invalidEvent(type);
      break;
    case 'run.warning':
      if (
        !isString(payload.code) ||
        !isString(payload.message) ||
        !nullableString(payload.merchantAttemptId) ||
        !isStringArray(payload.evidenceIds) ||
        (payload.requiresUserInput !== undefined &&
          typeof payload.requiresUserInput !== 'boolean') ||
        (payload.requiresUserInput === true &&
          (!isString(payload.merchantAttemptId) ||
            !USER_INPUT_WARNING_CODES.has(String(payload.code))))
      )
        invalidEvent(type);
      break;
    case 'report.updated':
      if (
        ![
          payload.validOfferCount,
          payload.excludedOfferCount,
          payload.incompleteOfferCount,
        ].every((value) => Number.isInteger(value) && Number(value) >= 0)
      )
        invalidEvent(type);
      break;
    case 'run.failed':
      if (
        !isTimestamp(payload.failedAt) ||
        !isString(payload.failureCode) ||
        typeof payload.retryable !== 'boolean'
      )
        invalidEvent(type);
      break;
  }
}

function invalidEvent(type: EventType): never {
  throw new ContractException(
    'VALIDATION_ERROR',
    400,
    `Event payload does not match ${type}`,
  );
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
function nullableString(value: unknown): boolean {
  return value === null || isString(value);
}
function isStringArray(value: unknown, nonEmpty = false): value is string[] {
  return (
    Array.isArray(value) &&
    (!nonEmpty || value.length > 0) &&
    value.every(isString) &&
    new Set(value).size === value.length
  );
}
function isRunStatus(value: unknown): value is ShoppingRunState {
  return Object.values(ShoppingRunState).includes(value as ShoppingRunState);
}
function isCategory(value: unknown): value is ShoppingCategory {
  return Object.values(ShoppingCategory).includes(value as ShoppingCategory);
}
function isTimestamp(value: unknown): value is string {
  return (
    isString(value) && !Number.isNaN(Date.parse(value)) && value.endsWith('Z')
  );
}

function exactQuestion(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const question = value as Record<string, unknown>;
  return (
    Object.keys(question).sort().join(',') === 'id,prompt,required' &&
    isString(question.id) &&
    isString(question.prompt) &&
    typeof question.required === 'boolean'
  );
}

function exactMerchant(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const merchant = value as Record<string, unknown>;
  return (
    Object.keys(merchant).sort().join(',') ===
      'category,currency,domain,id,market,name' &&
    isString(merchant.id) &&
    isString(merchant.name) &&
    isString(merchant.domain) &&
    isCategory(merchant.category) &&
    merchant.market === 'EG' &&
    merchant.currency === 'EGP'
  );
}

function containsSecretKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsSecretKey);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value as Record<string, unknown>).some(
    ([key, item]) =>
      /recipientName|mobileNumber|governorate|cityOrArea|street|building|floor|apartment|landmark|postalCode|password|secret|token|authorization|cookie|payment|card/i.test(
        key,
      ) || containsSecretKey(item),
  );
}

function incompleteDetails(
  category: ShoppingCategory,
): Record<string, unknown> {
  if (category === ShoppingCategory.Retail)
    return {
      kind: 'retail',
      brand: '',
      model: '',
      variant: null,
      storage: null,
      size: null,
      color: null,
      quantity: 1,
      condition: 'new',
      deliveryEstimate: null,
    };
  if (category === ShoppingCategory.Food)
    return {
      kind: 'food',
      restaurant: '',
      meal: '',
      size: null,
      modifiers: [],
      rating: null,
      minimumOrder: null,
      deliveryEstimate: null,
      optionalTipExcluded: true,
    };
  return {
    kind: 'cinema',
    movie: '',
    venue: '',
    date: '1970-01-01',
    showtime: '1970-01-01T00:00:00.000Z',
    language: '',
    screenFormat: '',
    seatCount: 0,
    adjacentSeats: false,
    seatType: '',
    holdExpiresAt: null,
  };
}
