/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createServer, Server } from 'node:http';
import { createConnection } from 'node:net';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/modules/auth/auth.service';
import {
  SHOPPING_STORE,
  ShoppingStore,
} from '../src/modules/shopping/repositories';
import { ShoppingRun } from '../src/modules/shopping/entities';
import { ShoppingAiClientService } from '../src/modules/shopping/services';
import {
  ShoppingCategory,
  ShoppingRunState,
  SupportedLocale,
} from '../src/modules/shopping/shopping.types';
import { configureApiRouting } from '../src/server';

const INTERNAL_TOKEN = 'test-internal-token-at-least-32-characters';
const VIEWER_SECRET = 'test-viewer-token-secret-at-least-32-chars';

describe('DealPilot canonical API contract (e2e)', () => {
  let app: INestApplication;
  let fakeAi: Server;
  let baseUrl: string;
  let token: string;
  let otherToken: string;
  let store: ShoppingStore;
  const aiRequests: Array<{
    path: string;
    headers: Record<string, string | string[] | undefined>;
    body: Record<string, unknown>;
  }> = [];
  let failNextCommand = false;

  beforeAll(async () => {
    fakeAi = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const body = JSON.parse(
          Buffer.concat(chunks).toString('utf8'),
        ) as Record<string, unknown>;
        aiRequests.push({ path: req.url ?? '', headers: req.headers, body });
        if (failNextCommand && /\/commands$/.test(req.url ?? '')) {
          failNextCommand = false;
          res.writeHead(409, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({ error: { code: 'INVALID_RUN_TRANSITION' } }),
          );
          return;
        }
        res.writeHead(202, { 'content-type': 'application/json' });
        if (req.url === '/internal/v1/runs') {
          res.end(
            JSON.stringify({
              runId: body.runId,
              accepted: true,
              duplicate: false,
            }),
          );
        } else {
          res.end(
            JSON.stringify({
              id: body.id,
              runId: body.runId,
              accepted: true,
              duplicate: false,
            }),
          );
        }
      });
    });
    await new Promise<void>((resolve) =>
      fakeAi.listen(0, '127.0.0.1', resolve),
    );
    const address = fakeAi.address();
    if (!address || typeof address === 'string')
      throw new Error('Fake AI server did not start');
    process.env.NODE_ENV = 'test';
    process.env.OBSERVABILITY_ENABLED = 'false';
    process.env.AI_SERVICE_URL = `http://127.0.0.1:${address.port}`;
    process.env.INTERNAL_TOKEN = INTERNAL_TOKEN;
    process.env.VIEWER_TOKEN_SECRET = VIEWER_SECRET;
    process.env.DEALPILOT_PUBLIC_ORIGIN = 'https://dealpilot.test';

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApiRouting(app);
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
    store = app.get<ShoppingStore>(SHOPPING_STORE);
    const auth = app.get(AuthService);
    token = (
      await auth.issueTokenPair({ id: 'user-1', roles: [], permissions: [] })
    ).accessToken;
    otherToken = (
      await auth.issueTokenPair({ id: 'user-2', roles: [], permissions: [] })
    ).accessToken;
  });

  afterAll(async () => {
    await app?.close();
    await new Promise<void>((resolve) => fakeAi?.close(() => resolve()));
  }, 15_000);

  it('exposes only /api/v1, requires auth, and returns exact fixed scope fields', async () => {
    await request(app.getHttpServer())
      .get('/v1/shopping/merchants')
      .expect(404);
    const unauthenticated = await request(app.getHttpServer())
      .get('/api/v1/shopping/merchants')
      .expect(401);
    expect(unauthenticated.body.error).toMatchObject({
      code: 'UNAUTHENTICATED',
      status: 401,
    });

    const catalog = await api().get('/api/v1/shopping/merchants').expect(200);
    expect(catalog.body.merchants).toHaveLength(5);
    expect(catalog.body.merchants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'amazon-eg',
          domain: 'amazon.eg',
          market: 'EG',
          currency: 'EGP',
        }),
        expect.objectContaining({ domain: 'talabat.com', category: 'food' }),
        expect.objectContaining({
          domain: 'voxcinemas.com',
          category: 'cinema',
        }),
      ]),
    );

    const created = await createRun('retail', 'Find a phone', 'en-EG');
    expect(created.run).toMatchObject({
      requestedCategory: 'retail',
      category: 'retail',
      market: 'EG',
      currency: 'EGP',
      timezone: 'Africa/Cairo',
      locale: 'en-EG',
      status: 'discovering',
    });
    expect(Object.keys(created.run).sort()).toEqual(
      [
        'browserExpiresAt',
        'category',
        'completedAt',
        'createdAt',
        'currency',
        'failure',
        'id',
        'lastEventId',
        'locale',
        'market',
        'pendingAction',
        'query',
        'requestedCategory',
        'resumeStatus',
        'status',
        'timezone',
        'updatedAt',
      ].sort(),
    );
    expect(aiRequests.at(-1)).toMatchObject({
      path: '/internal/v1/runs',
      body: {
        runId: created.run.id,
        query: 'Find a phone',
        requestedCategory: 'retail',
        locale: 'en-EG',
        market: 'EG',
        currency: 'EGP',
        timezone: 'Africa/Cairo',
      },
    });
    expect(aiRequests.at(-1)?.headers['x-internal-token']).toBe(INTERNAL_TOKEN);
    expect(aiRequests.at(-1)?.headers['idempotency-key']).toBe(created.run.id);
  });

  it('sends every frozen API-to-AI command name in the exact envelope', async () => {
    const client = app.get(ShoppingAiClientService);
    const run = Object.assign(new ShoppingRun(), {
      id: '01JTESTCOMMANDRUN0000000000',
      requestedCategory: 'retail',
      category: ShoppingCategory.Retail,
      locale: SupportedLocale.EnglishEgypt,
      query: 'Contract command test',
      browserExpiresAt: new Date(Date.now() + 3_600_000),
      status: ShoppingRunState.Discovering,
    });
    const commands: Array<[string, Record<string, unknown>]> = [
      ['clarify', { requestId: 'request-1', answers: { category: 'retail' } }],
      ['pause', { reason: 'user' }],
      ['resume', { reason: 'user' }],
      ['cancel', { reason: null }],
      ['complete', { reason: 'user_finished', reportId: 'report-1' }],
      [
        'approve_domains',
        {
          approvalId: 'approval-1',
          requestId: 'request-2',
          domains: ['amazon.eg'],
        },
      ],
      [
        'grant_address',
        {
          approvalId: 'approval-2',
          requestId: 'request-3',
          secretReference: 'address-reference',
          merchantDomains: ['amazon.eg'],
          expiresAt: '2026-07-17T13:00:00.000Z',
        },
      ],
      [
        'approve_seat_hold',
        {
          approvalId: 'approval-3',
          requestId: 'request-4',
          merchantDomain: 'voxcinemas.com',
          offerId: 'offer-1',
        },
      ],
    ];
    const before = aiRequests.length;
    for (const [name, payload] of commands) {
      const id = `command-${name}`;
      await client.command(
        run,
        name as Parameters<ShoppingAiClientService['command']>[1],
        payload,
        id,
      );
    }
    const sent = aiRequests.slice(before);
    expect(sent).toHaveLength(commands.length);
    sent.forEach((entry, index) => {
      const [name, payload] = commands[index];
      expect(entry.path).toBe(`/internal/v1/runs/${run.id}/commands`);
      expect(entry.headers['x-internal-token']).toBe(INTERNAL_TOKEN);
      expect(entry.headers['idempotency-key']).toBe(`command-${name}`);
      expect(entry.body).toMatchObject({
        id: `command-${name}`,
        runId: run.id,
        name,
        payload,
      });
      expect(entry.body).toHaveProperty('issuedAt');
      expect(Object.keys(entry.body).sort()).toEqual(
        ['id', 'issuedAt', 'name', 'payload', 'runId'].sort(),
      );
    });
  });

  it('supports auto classification, canonical clarification, and 24-hour idempotency behavior', async () => {
    const automatic = await createRun(
      'auto',
      'Find two cinema tickets after 8 PM',
      'en-EG',
    );
    expect(automatic.run).toMatchObject({
      requestedCategory: 'auto',
      category: 'cinema',
      status: 'discovering',
    });

    const key = idem('clarify-create');
    const body = {
      query: 'Help me compare something',
      category: 'auto',
      locale: 'ar-EG',
    };
    const first = await api()
      .post('/api/v1/shopping/runs')
      .set('Idempotency-Key', key)
      .send(body)
      .expect(201);
    const replay = await api()
      .post('/api/v1/shopping/runs')
      .set('Idempotency-Key', key)
      .send(body)
      .expect(201);
    expect(replay.body).toEqual(first.body);
    await api()
      .post('/api/v1/shopping/runs')
      .set('Idempotency-Key', key)
      .send({ ...body, query: 'Different request' })
      .expect(409)
      .expect(({ body: responseBody }) =>
        expect(responseBody.error.code).toBe('IDEMPOTENCY_KEY_REUSED'),
      );

    const pending = first.body.run.pendingAction;
    const clarified = await api()
      .post(`/api/v1/shopping/runs/${first.body.run.id}/clarifications`)
      .set('Idempotency-Key', idem('clarify-answer'))
      .send({ requestId: pending.requestId, answers: { category: 'food' } })
      .expect(200);
    expect(clarified.body.run).toMatchObject({
      category: 'food',
      status: 'discovering',
      pendingAction: null,
    });
    expect(aiRequests.at(-1)?.body).toMatchObject({
      name: 'clarify',
      payload: { requestId: pending.requestId, answers: { category: 'food' } },
    });
  });

  it('approves any valid candidate subset and rolls back completely when AI rejects', async () => {
    const created = await createRun('retail', 'Find a laptop', 'en-EG');
    const runId = created.run.id as string;
    const requestId = 'domain-request-1';
    await requireDomains(runId, requestId, ['amazon.eg', 'jumia.com.eg']);
    const approved = await api()
      .post(`/api/v1/shopping/runs/${runId}/domains/approve`)
      .set('Idempotency-Key', idem('domain-subset'))
      .send({ requestId, domains: ['amazon.eg'] })
      .expect(200);
    expect(approved.body.approval).toMatchObject({
      runId,
      requestId,
      type: 'domain_access',
      merchantDomains: ['amazon.eg'],
      status: 'approved',
      expiresAt: null,
    });
    expect(approved.body.run.status).toBe('comparing');
    expect(aiRequests.at(-1)?.body).toMatchObject({
      name: 'approve_domains',
      payload: {
        approvalId: approved.body.approval.id,
        requestId,
        domains: ['amazon.eg'],
      },
    });

    const rejected = await createRun('retail', 'Find a television', 'en-EG');
    await requireDomains(rejected.run.id, 'domain-request-2', ['amazon.eg']);
    failNextCommand = true;
    await api()
      .post(`/api/v1/shopping/runs/${rejected.run.id}/domains/approve`)
      .set('Idempotency-Key', idem('domain-reject'))
      .send({ requestId: 'domain-request-2', domains: ['amazon.eg'] })
      .expect(502)
      .expect(({ body }) =>
        expect(body.error.code).toBe('AI_COMMAND_REJECTED'),
      );
    const current = await api()
      .get(`/api/v1/shopping/runs/${rejected.run.id}`)
      .expect(200);
    expect(current.body.run.status).toBe('awaiting_domain_approval');
    expect((await store.report(rejected.run.id)).approvals).toHaveLength(0);
  });

  it('scopes address grants by request, approved domain, cityOrArea, and earliest TTL without exposing plaintext', async () => {
    const created = await createRun('food', 'Order pizza', 'en-EG');
    const runId = created.run.id as string;
    await requireDomains(runId, 'food-domain', ['talabat.com']);
    await api()
      .post(`/api/v1/shopping/runs/${runId}/domains/approve`)
      .set('Idempotency-Key', idem('food-domain'))
      .send({ requestId: 'food-domain', domains: ['talabat.com'] })
      .expect(200);
    await postEvent(
      runId,
      'awaiting_address_consent',
      'address.approval_required',
      {
        requestId: 'address-request',
        merchantDomains: ['talabat.com'],
        fields: [
          'recipientName',
          'mobileNumber',
          'governorate',
          'cityOrArea',
          'street',
          'building',
          'floor',
          'apartment',
          'landmark',
          'postalCode',
        ],
      },
    );
    const address = {
      recipientName: 'Private Recipient',
      mobileNumber: '01012345678',
      governorate: 'Cairo',
      cityOrArea: 'Nasr City',
      street: 'Private Street',
      building: '10',
      floor: '2',
      apartment: '4',
      landmark: 'Private Landmark',
      postalCode: '11765',
    };
    const granted = await api()
      .post(`/api/v1/shopping/runs/${runId}/address-grant`)
      .set('Idempotency-Key', idem('address-grant'))
      .send({
        requestId: 'address-request',
        merchantDomains: ['talabat.com'],
        address,
      })
      .expect(200);
    expect(JSON.stringify(granted.body)).not.toContain(address.street);
    const command = aiRequests.at(-1)?.body as {
      payload: { secretReference: string; expiresAt: string };
    };
    expect(command).toMatchObject({
      name: 'grant_address',
      payload: {
        requestId: 'address-request',
        merchantDomains: ['talabat.com'],
      },
    });
    expect(new Date(command.payload.expiresAt).getTime()).toBeLessThanOrEqual(
      new Date(created.run.browserExpiresAt).getTime(),
    );
    const resolved = await request(app.getHttpServer())
      .post('/internal/v1/secrets/resolve')
      .set('X-Internal-Token', INTERNAL_TOKEN)
      .send({
        runId,
        secretReference: command.payload.secretReference,
        merchantDomain: 'talabat.com',
        field: 'cityOrArea',
      })
      .expect(200);
    expect(resolved.body).toMatchObject({
      runId,
      field: 'cityOrArea',
      value: 'Nasr City',
      expiresAt: command.payload.expiresAt,
    });
    await request(app.getHttpServer())
      .post('/internal/v1/secrets/resolve')
      .set('X-Internal-Token', INTERNAL_TOKEN)
      .send({
        runId,
        secretReference: command.payload.secretReference,
        merchantDomain: 'amazon.eg',
        field: 'street',
      })
      .expect(403);
    expect(JSON.stringify(await store.report(runId))).not.toContain(
      address.street,
    );
  });

  it('claims, tokenizes, authorizes, and releases exclusive control in the same run session', async () => {
    const created = await createRun('retail', 'Find a phone', 'en-EG');
    const runId = created.run.id as string;
    await requireDomains(runId, 'control-domain', ['amazon.eg']);
    await api()
      .post(`/api/v1/shopping/runs/${runId}/domains/approve`)
      .set('Idempotency-Key', idem('control-domain'))
      .send({ requestId: 'control-domain', domains: ['amazon.eg'] })
      .expect(200);
    await postEvent(runId, 'ready_for_handoff', 'run.status_changed', {
      from: 'comparing',
      to: 'ready_for_handoff',
      reasonCode: null,
    });
    const view = await api()
      .post(`/api/v1/shopping/runs/${runId}/viewer-tokens`)
      .set('Idempotency-Key', idem('view-token'))
      .send({ mode: 'view' })
      .expect(201);
    expect(view.body).toMatchObject({
      tokenType: 'Bearer',
      mode: 'view',
      viewerUrl: 'https://dealpilot.test/viewer/',
    });
    expect(view.body.viewerUrl).not.toContain(view.body.token);

    const claimed = await api()
      .post(`/api/v1/shopping/runs/${runId}/control/claim`)
      .set('Idempotency-Key', idem('control-claim'))
      .send({ requestedLeaseSeconds: 120 })
      .expect(200);
    expect(claimed.body.run.status).toBe('user_takeover');
    expect(claimed.body.lease.status).toBe('active');
    expect(aiRequests.at(-1)?.body).toMatchObject({
      name: 'pause',
      payload: { reason: 'control_claim' },
    });
    await api()
      .post(`/api/v1/shopping/runs/${runId}/control/claim`)
      .set('Idempotency-Key', idem('second-claim'))
      .send({})
      .expect(409);

    const control = await api()
      .post(`/api/v1/shopping/runs/${runId}/viewer-tokens`)
      .set('Idempotency-Key', idem('control-token'))
      .send({ mode: 'control', leaseId: claimed.body.lease.id })
      .expect(201);
    const authorization = await request(app.getHttpServer())
      .post('/internal/v1/viewer/authorize')
      .set('X-Internal-Token', INTERNAL_TOKEN)
      .set('Authorization', `Bearer ${control.body.token}`)
      .expect(200);
    expect(authorization.headers['x-dealpilot-viewer-mode']).toBe('control');
    expect(authorization.body).toMatchObject({
      authorized: true,
      runId,
      mode: 'control',
      userId: 'user-1',
      leaseId: claimed.body.lease.id,
    });
    const handshake = await websocketHandshake(
      baseUrl,
      `/api/v1/shopping/runs/${runId}/events`,
      view.body.token,
    );
    expect(handshake).toContain('101 Switching Protocols');
    expect(handshake).toContain('Sec-WebSocket-Protocol: dealpilot.events.v1');
    expect(handshake).not.toContain(`bearer.${view.body.token}`);

    const released = await api()
      .post(`/api/v1/shopping/runs/${runId}/control/release`)
      .set('Idempotency-Key', idem('control-release'))
      .send({ leaseId: claimed.body.lease.id })
      .expect(200);
    expect(released.body).toMatchObject({
      run: { status: 'ready_for_handoff' },
      lease: { status: 'released' },
    });
    expect(aiRequests.at(-1)?.body).toMatchObject({
      name: 'resume',
      payload: { reason: 'control_release' },
    });
    await request(app.getHttpServer())
      .post('/internal/v1/viewer/authorize')
      .set('X-Internal-Token', INTERNAL_TOKEN)
      .set('Authorization', `Bearer ${control.body.token}`)
      .expect(401);
  });

  it('builds an evidence-linked comparison report and excludes invalid EGP arithmetic from ranking', async () => {
    const created = await createRun('retail', 'Find a laptop', 'en-EG');
    const runId = created.run.id as string;
    await requireDomains(runId, 'report-domain', ['amazon.eg']);
    await api()
      .post(`/api/v1/shopping/runs/${runId}/domains/approve`)
      .set('Idempotency-Key', idem('report-domain'))
      .send({ requestId: 'report-domain', domains: ['amazon.eg'] })
      .expect(200);
    const now = new Date('2026-07-17T12:00:00.000Z');
    await store.saveMerchantAttempt({
      id: 'attempt-1',
      runId,
      merchantId: 'amazon-eg',
      merchantName: 'Amazon Egypt',
      merchantDomain: 'amazon.eg',
      category: ShoppingCategory.Retail,
      outcome: 'succeeded',
      failureCode: null,
      message: null,
      evidenceIds: ['e-price'],
      startedAt: now,
      finishedAt: now,
    });
    for (const [id, kind] of [
      ['e-price', 'price_text'],
      ['e-source', 'coupon_source'],
      ['e-result', 'coupon_result'],
    ] as const) {
      await store.saveEvidence({
        id,
        runId,
        kind,
        uri: `https://dealpilot.test/evidence/${id}`,
        sha256: 'a'.repeat(64),
        capturedAt: now,
        merchantAttemptId: 'attempt-1',
        redacted: true,
      });
    }
    await seedOffer(runId, 'offer-100', '100.00', '100.00');
    await seedOffer(runId, 'offer-090', '90.00', '90.00');
    await seedOffer(runId, 'offer-bad', '200.00', '199.00');
    await store.saveCouponAttempt({
      id: 'coupon-1',
      runId,
      offerId: 'offer-090',
      merchantDomain: 'amazon.eg',
      code: 'SAVE10',
      sourceUrl: 'https://amazon.eg/coupons',
      status: 'rejected',
      beforeTotal: '90.00',
      afterTotal: null,
      verifiedDiscount: '0.00',
      rejectionReason: 'not_eligible',
      message: 'Coupon does not apply',
      attemptedAt: now,
      evidenceIds: ['e-source', 'e-result'],
    });

    const response = await api()
      .get(`/api/v1/shopping/runs/${runId}/report`)
      .expect(200);
    expect(
      response.body.validOffers.map((offer: { id: string }) => offer.id),
    ).toEqual(['offer-090', 'offer-100']);
    expect(
      response.body.incompleteOffers.map((offer: { id: string }) => offer.id),
    ).toContain('offer-bad');
    expect(response.body.couponAttempts[0]).toMatchObject({
      sourceUrl: 'https://amazon.eg/coupons',
      rejectionReason: 'not_eligible',
      message: 'Coupon does not apply',
      evidenceIds: ['e-source', 'e-result'],
    });
    expect(response.body.conclusion).toEqual({
      outcome: 'winner',
      winnerOfferId: 'offer-090',
      validOfferCount: 2,
      statement:
        'Lowest verified total among the options successfully checked.',
    });
  });

  it('paginates canonical event envelopes and hides run existence from another user', async () => {
    const created = await createRun('retail', 'Find a phone', 'en-EG');
    const first = await api()
      .get(`/api/v1/shopping/runs/${created.run.id}/events`)
      .query({ limit: 1 })
      .expect(200);
    expect(first.body).toMatchObject({ hasMore: false, nextAfter: null });
    expect(Object.keys(first.body.events[0]).sort()).toEqual(
      ['id', 'payload', 'runId', 'status', 'timestamp', 'type'].sort(),
    );
    await request(app.getHttpServer())
      .get(`/api/v1/shopping/runs/${created.run.id}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);
  });

  it('materializes canonical AI evidence and incomplete offers while retaining partial merchant failures', async () => {
    const created = await createRun(
      'retail',
      'Find a deterministic integration laptop',
      'en-EG',
    );
    const runId = created.run.id as string;
    await requireDomains(runId, 'materialize-domain', ['amazon.eg']);
    await api()
      .post(`/api/v1/shopping/runs/${runId}/domains/approve`)
      .set('Idempotency-Key', idem('materialize-domain'))
      .send({ requestId: 'materialize-domain', domains: ['amazon.eg'] })
      .expect(200);

    const attemptId = 'attempt:identifier-longer-than-twenty-six-characters';
    const evidenceId = 'evidence:identifier-longer-than-twenty-six-characters';
    const offerId = 'offer:identifier-longer-than-twenty-six-characters';
    await postEvent(runId, 'comparing', 'merchant.attempt_started', {
      attemptId,
      merchantId: 'amazon-eg',
      merchantDomain: 'amazon.eg',
      category: 'retail',
    });
    await postEvent(runId, 'comparing', 'evidence.captured', {
      evidenceId,
      kind: 'screenshot',
      merchantAttemptId: attemptId,
      redacted: true,
    });
    await postEvent(runId, 'comparing', 'offer.recorded', {
      offerId,
      validity: 'incomplete',
      merchantAttemptId: attemptId,
      evidenceIds: [evidenceId],
    });
    await postEvent(runId, 'comparing', 'merchant.attempt_completed', {
      attemptId,
      outcome: 'unavailable',
      failureCode: 'MERCHANT_UNAVAILABLE',
      evidenceIds: [evidenceId],
    });

    const report = await api()
      .get(`/api/v1/shopping/runs/${runId}/report`)
      .expect(200);
    expect(report.body.incompleteOffers).toEqual([
      expect.objectContaining({
        id: offerId,
        merchantAttemptId: attemptId,
        evidenceIds: [evidenceId],
      }),
    ]);
    expect(report.body.partialFailures).toEqual([
      expect.objectContaining({
        merchantAttemptId: attemptId,
        code: 'MERCHANT_UNAVAILABLE',
      }),
    ]);
    expect(report.body.evidence).toEqual([
      expect.objectContaining({ id: evidenceId, redacted: true }),
    ]);
  });

  function api() {
    return {
      get: (path: string) =>
        request(app.getHttpServer())
          .get(path)
          .set('Authorization', `Bearer ${token}`),
      post: (path: string) =>
        request(app.getHttpServer())
          .post(path)
          .set('Authorization', `Bearer ${token}`),
    };
  }

  async function createRun(category: string, query: string, locale: string) {
    const response = await api()
      .post('/api/v1/shopping/runs')
      .set('Idempotency-Key', idem(`create-${category}-${query}`))
      .send({ category, query, locale })
      .expect(201);
    return response.body as { run: Record<string, any> };
  }

  async function requireDomains(
    runId: string,
    requestId: string,
    domains: string[],
  ) {
    const candidates = domains.map((domain) => {
      const entry =
        domain === 'amazon.eg'
          ? { id: 'amazon-eg', name: 'Amazon Egypt', category: 'retail' }
          : domain === 'jumia.com.eg'
            ? { id: 'jumia-eg', name: 'Jumia Egypt', category: 'retail' }
            : { id: 'talabat-eg', name: 'Talabat Egypt', category: 'food' };
      return { ...entry, domain, market: 'EG', currency: 'EGP' };
    });
    await postEvent(
      runId,
      'awaiting_domain_approval',
      'domains.approval_required',
      { requestId, candidates },
    );
  }

  async function postEvent(
    runId: string,
    status: string,
    type: string,
    payload: Record<string, unknown>,
  ) {
    const id = `ai-${type}-${Math.random().toString(36).slice(2)}`;
    return request(app.getHttpServer())
      .post('/internal/v1/ai-events')
      .set('X-Internal-Token', INTERNAL_TOKEN)
      .send({
        id,
        runId,
        type,
        status,
        timestamp: new Date().toISOString(),
        payload,
      })
      .expect(202);
  }

  async function seedOffer(
    runId: string,
    id: string,
    subtotal: string,
    finalTotal: string,
  ) {
    await store.saveOffer({
      id,
      runId,
      merchantAttemptId: 'attempt-1',
      merchantName: 'Amazon Egypt',
      merchantDomain: 'amazon.eg',
      category: ShoppingCategory.Retail,
      title: `Laptop ${id}`,
      sourceUrl: `https://amazon.eg/${id}`,
      match: { exact: true, confidence: 0.95, explanation: 'Exact model' },
      availability: 'available',
      details: {
        kind: 'retail',
        brand: 'Brand',
        model: 'Model',
        variant: null,
        storage: null,
        size: null,
        color: null,
        quantity: 1,
        condition: 'new',
        deliveryEstimate: 'Tomorrow',
      },
      price: {
        itemSubtotal: subtotal,
        deliveryFee: '0.00',
        serviceFee: '0.00',
        bookingFee: '0.00',
        tax: '0.00',
        mandatoryFees: [],
        verifiedDiscount: '0.00',
        optionalTip: null,
        finalTotal,
      },
      validity: 'valid',
      observedAt: new Date('2026-07-17T12:00:00.000Z'),
      evidenceIds: ['e-price'],
      exclusionReason: null,
      incompleteFields: [],
    });
  }
});

let idempotencyCounter = 0;
function idem(seed: string): string {
  idempotencyCounter += 1;
  return `idem-${idempotencyCounter}-${seed}`.slice(0, 128).padEnd(8, 'x');
}

async function websocketHandshake(
  baseUrl: string,
  path: string,
  token: string,
): Promise<string> {
  const url = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const socket = createConnection(Number(url.port), url.hostname, () => {
      socket.write(
        [
          `GET ${path} HTTP/1.1`,
          `Host: ${url.host}`,
          'Upgrade: websocket',
          'Connection: Upgrade',
          'Sec-WebSocket-Version: 13',
          'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
          `Sec-WebSocket-Protocol: dealpilot.events.v1, bearer.${token}`,
          '\r\n',
        ].join('\r\n'),
      );
    });
    socket.once('data', (data) => {
      socket.destroy();
      resolve(data.toString('utf8'));
    });
    socket.once('error', reject);
  });
}
