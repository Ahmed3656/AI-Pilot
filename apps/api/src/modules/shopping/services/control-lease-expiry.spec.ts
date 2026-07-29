import { ConfigService } from '@nestjs/config';
import { InMemoryShoppingStore } from '../repositories';
import {
  ControlLeaseStatus,
  RequestedCategory,
  ShoppingCategory,
  ShoppingRunState,
  SupportedLocale,
} from '../shopping.types';
import { ShoppingService } from '../shopping.service';
import { AddressSecretVaultService } from './address-secret-vault.service';
import { RunStateMachine } from './run-state-machine';
import { ShoppingAiClientService } from './shopping-ai-client.service';
import { ShoppingEventStreamService } from './shopping-event-stream.service';
import { ShoppingReportService } from './shopping-report.service';
import { ViewerTokenService } from './viewer-token.service';

describe('control lease expiry recovery', () => {
  afterEach(() => jest.useRealTimers());

  it('denies expired requested input and resumes AI with one stable recovery command', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-17T10:00:00.000Z'));
    const store = new InMemoryShoppingStore();
    const config = new ConfigService({
      shopping: {
        browserTtlSeconds: 3600,
        controlLeaseTtlSeconds: 120,
        addressTtlMs: 1_800_000,
      },
    });
    const command = jest.fn().mockResolvedValue('accepted');
    const ai = { command } as unknown as ShoppingAiClientService;
    const service = new ShoppingService(
      store,
      new RunStateMachine(),
      new AddressSecretVaultService(config),
      ai,
      {} as ViewerTokenService,
      { publish: jest.fn() } as unknown as ShoppingEventStreamService,
      {} as ShoppingReportService,
      config,
    );
    const run = await store.createRun({
      id: '01JLEASEEXPIRYTEST00000000',
      userId: 'user-1',
      requestedCategory: RequestedCategory.Retail,
      category: ShoppingCategory.Retail,
      market: 'EG',
      currency: 'EGP',
      timezone: 'Africa/Cairo',
      locale: SupportedLocale.EnglishEgypt,
      query: 'Find a phone',
      status: ShoppingRunState.Paused,
      resumeStatus: ShoppingRunState.Comparing,
      pendingAction: {
        type: 'browser_takeover',
        requestId: 'warning-1',
        merchantAttemptId: 'attempt-1',
        merchantName: 'Amazon Egypt',
        merchantDomain: 'amazon.eg',
        reasonCode: 'captcha_detected',
        message: 'CAPTCHA verification is required.',
      },
      failure: null,
      completedAt: null,
      browserExpiresAt: new Date('2026-07-17T11:00:00.000Z'),
      lastEventId: null,
    });

    const claimed = await service.claimControl('user-1', run.id, {
      requestId: 'warning-1',
      merchantAttemptId: 'attempt-1',
      requestedLeaseSeconds: 60,
    });
    await jest.advanceTimersByTimeAsync(60_001);

    expect((await store.findRun(run.id))?.status).toBe(
      ShoppingRunState.Comparing,
    );
    expect((await store.findLease(claimed.lease.id))?.status).toBe(
      ControlLeaseStatus.Expired,
    );
    expect(command).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: run.id }),
      'resume',
      { reason: 'lease_expired' },
      `lease-expiry:${claimed.lease.id}`,
      claimed.lease.expiresAt,
    );
    expect(
      (await store.report(run.id)).events.some(
        (event) =>
          event.type === 'control.lease_expired' &&
          event.payload.recovery === 'resumed',
      ),
    ).toBe(true);
    service.onModuleDestroy();
  });

  it('hands a safety-paused browser to the user and resumes the interrupted work', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-17T10:00:00.000Z'));
    const store = new InMemoryShoppingStore();
    const config = new ConfigService({
      shopping: {
        browserTtlSeconds: 3600,
        controlLeaseTtlSeconds: 120,
        addressTtlMs: 1_800_000,
      },
    });
    const command = jest.fn().mockResolvedValue('accepted');
    const service = new ShoppingService(
      store,
      new RunStateMachine(),
      new AddressSecretVaultService(config),
      { command } as unknown as ShoppingAiClientService,
      {} as ViewerTokenService,
      { publish: jest.fn() } as unknown as ShoppingEventStreamService,
      {} as ShoppingReportService,
      config,
    );
    const run = await store.createRun({
      id: '01JPAUSEDTAKEOVER000000000',
      userId: 'user-1',
      requestedCategory: RequestedCategory.Food,
      category: ShoppingCategory.Food,
      market: 'EG',
      currency: 'EGP',
      timezone: 'Africa/Cairo',
      locale: SupportedLocale.EnglishEgypt,
      query: 'Find dinner',
      status: ShoppingRunState.Paused,
      resumeStatus: ShoppingRunState.Comparing,
      pendingAction: {
        type: 'browser_takeover',
        requestId: 'warning-2',
        merchantAttemptId: 'attempt-2',
        merchantName: 'Talabat Egypt',
        merchantDomain: 'talabat.com',
        reasonCode: 'login_required',
        message: 'Login must be completed by the user.',
      },
      failure: null,
      completedAt: null,
      browserExpiresAt: new Date('2026-07-17T11:00:00.000Z'),
      lastEventId: null,
    });

    const claimed = await service.claimControl('user-1', run.id, {
      requestId: 'warning-2',
      merchantAttemptId: 'attempt-2',
    });
    expect(claimed.run.status).toBe(ShoppingRunState.UserTakeover);
    const released = await service.releaseControl('user-1', run.id, {
      leaseId: claimed.lease.id,
    });

    expect(released.run.status).toBe(ShoppingRunState.Comparing);
    expect(released.run.resumeStatus).toBeNull();
    expect(command).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: run.id }),
      'pause',
      {
        reason: 'control_claim',
        merchantAttemptId: 'attempt-2',
        merchantDomain: 'talabat.com',
      },
    );
    expect(command).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: run.id }),
      'resume',
      { reason: 'control_release' },
    );
    service.onModuleDestroy();
  });
});
