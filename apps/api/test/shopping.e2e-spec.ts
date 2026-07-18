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
  let busyWithRunId: string | null = null;

  beforeAll(async () => {
    fakeAi = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const body = JSON.parse(
          Buffer.concat(chunks).toString('utf8'),
        ) as Record<string, unknown>;
        aiRequests.push({ path: req.url ?? '', headers: req.headers, body });
        if (req.url === '/internal/v1/runs' && busyWithRunId) {
          res.writeHead(429, {
            'content-type': 'application/json',
            'retry-after': '2',
          });
          res.end(
            JSON.stringify({
              error: {
                code: 'RATE_LIMITED',
                details: [
                  {
                    field: 'runId',
                    code: 'ACTIVE_RUN',
                    message: busyWithRunId,
                  },
                ],
              },
            }),
          );
          return;
        }
        if (failNextCommand && /\/commands$/.test(req.url ?? '')) {
          failNextCommand = false;
          res.writeHead(409, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({ error: { code: 'INVALID_RUN_TRANSITION' } }),
          );
          return;
        }
        if (body.name === 'cancel' && body.runId === busyWithRunId) {
          busyWithRunId = null;
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
    expect(catalog.body.merchants).toHaveLength(8);
    expect(catalog.body.merchants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'amazon-eg',
          domain: 'amazon.eg',
          market: 'EG',
          currency: 'EGP',
        }),
        expect.objectContaining({ domain: 'talabat.com', category: 'food' }),
        expect.objectContaining({ domain: 'google.com', category: 'food' }),
        expect.objectContaining({ domain: 'menuegypt.com', category: 'food' }),
        expect.objectContaining({ domain: 'elmenus.com', category: 'food' }),
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

  it('lets the owner cancel an active session and start a replacement without leaking its ID', async () => {
    const active = await createRun(
      'retail',
      'Keep this shopping session active',
      'en-EG',
    );
    const activeRunId = active.run.id as string;
    busyWithRunId = activeRunId;

    const replacementRequest = {
      category: 'retail',
      query: 'Start a different shopping session',
      locale: 'en-EG',
    };
    const conflict = await api()
      .post('/api/v1/shopping/runs')
      .set('Idempotency-Key', idem('active-run-conflict'))
      .send(replacementRequest)
      .expect(409);
    expect(conflict.body.error).toMatchObject({
      code: 'ACTIVE_RUN_EXISTS',
      details: [
        {
          field: 'runId',
          code: 'ACTIVE_RUN',
          message: activeRunId,
        },
      ],
    });

    const otherUserBusy = await request(app.getHttpServer())
      .post('/api/v1/shopping/runs')
      .set('Authorization', `Bearer ${otherToken}`)
      .set('Idempotency-Key', idem('other-user-active-run'))
      .send(replacementRequest)
      .expect(429);
    expect(otherUserBusy.body.error).toMatchObject({
      code: 'BROWSER_BUSY',
      details: [],
    });
    expect(JSON.stringify(otherUserBusy.body)).not.toContain(activeRunId);

    await api()
      .post(`/api/v1/shopping/runs/${activeRunId}/control`)
      .set('Idempotency-Key', idem('replace-active-run'))
      .send({ action: 'cancel', reason: 'replaced_by_new_run' })
      .expect(200)
      .expect(({ body }) => expect(body.run.status).toBe('cancelled'));
    expect(busyWithRunId).toBeNull();

    await api()
      .post('/api/v1/shopping/runs')
      .set('Idempotency-Key', idem('replacement-run'))
      .send(replacementRequest)
      .expect(201)
      .expect(({ body }) =>
        expect(body.run).toMatchObject({
          query: replacementRequest.query,
          status: 'discovering',
        }),
      );
  });

  it('closes an orphaned AI browser session and retries after the API reconnects', async () => {
    const orphanedRunId = '01JORPHANEDRUN000000000000';
    busyWithRunId = orphanedRunId;
    const before = aiRequests.length;

    const created = await createRun(
      'retail',
      'Recover after a disconnected session',
      'en-EG',
    );

    expect(created.run).toMatchObject({
      query: 'Recover after a disconnected session',
      status: 'discovering',
    });
    expect(busyWithRunId).toBeNull();
    expect(aiRequests.slice(before).map((entry) => entry.path)).toEqual([
      '/internal/v1/runs',
      `/internal/v1/runs/${orphanedRunId}/commands`,
      '/internal/v1/runs',
    ]);
    expect(aiRequests.at(-2)?.body).toMatchObject({
      runId: orphanedRunId,
      name: 'cancel',
      payload: { reason: 'orphaned_control_session' },
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

    const naturalRetail = await createRun(
      'auto',
      'Find a Samsung A55 256 GB under 25,000 EGP, delivered by Thursday',
      'en-EG',
    );
    expect(naturalRetail.run).toMatchObject({
      requestedCategory: 'auto',
      category: 'retail',
      status: 'discovering',
    });

    for (const query of [
      'Find koshary near me',
      'Compare burgers close to me',
      'Show shawerma menu prices',
      'Find pizza nearby',
    ]) {
      const food = await createRun('auto', query, 'en-EG');
      expect(food.run).toMatchObject({
        requestedCategory: 'auto',
        category: 'food',
        status: 'discovering',
      });
    }

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

  it('permits takeover only for the merchant named by a user-input warning', async () => {
    const created = await createRun('retail', 'Find a monitor', 'en-EG');
    const runId = created.run.id as string;
    await requireDomains(runId, 'pause-domain', ['amazon.eg']);
    await api()
      .post(`/api/v1/shopping/runs/${runId}/domains/approve`)
      .set('Idempotency-Key', idem('pause-domain'))
      .send({ requestId: 'pause-domain', domains: ['amazon.eg'] })
      .expect(200);

    await postEvent(runId, 'comparing', 'merchant.attempt_started', {
      attemptId: 'pause-attempt',
      merchantId: 'amazon-eg',
      merchantDomain: 'amazon.eg',
      category: 'retail',
    });

    await postEvent(runId, 'paused', 'run.status_changed', {
      from: 'comparing',
      to: 'paused',
      reasonCode: 'captcha_detected',
    });

    await api()
      .post(`/api/v1/shopping/runs/${runId}/control/claim`)
      .set('Idempotency-Key', idem('pause-without-request'))
      .send({ requestId: 'missing', merchantAttemptId: 'pause-attempt' })
      .expect(404);

    await postEvent(
      runId,
      'paused',
      'run.warning',
      {
        code: 'captcha_detected',
        message: 'CAPTCHA/human verification detected',
        merchantAttemptId: 'pause-attempt',
        evidenceIds: [],
        requiresUserInput: true,
      },
      'pause-warning',
    );

    const paused = await api()
      .get(`/api/v1/shopping/runs/${runId}`)
      .expect(200);
    expect(paused.body.run).toMatchObject({
      status: 'paused',
      resumeStatus: 'comparing',
      pendingAction: {
        type: 'browser_takeover',
        requestId: 'pause-warning',
        merchantAttemptId: 'pause-attempt',
        merchantName: 'Amazon Egypt',
        merchantDomain: 'amazon.eg',
      },
    });

    await api()
      .post(`/api/v1/shopping/runs/${runId}/control/claim`)
      .set('Idempotency-Key', idem('wrong-pause-attempt'))
      .send({
        requestId: 'pause-warning',
        merchantAttemptId: 'another-attempt',
      })
      .expect(409);

    const claimed = await api()
      .post(`/api/v1/shopping/runs/${runId}/control/claim`)
      .set('Idempotency-Key', idem('pause-takeover'))
      .send({
        requestId: 'pause-warning',
        merchantAttemptId: 'pause-attempt',
      })
      .expect(200);
    expect(claimed.body.run).toMatchObject({
      status: 'user_takeover',
      resumeStatus: 'comparing',
    });
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

  it('claims the requested merchant, authorizes control, and resumes AI work', async () => {
    const created = await createRun('retail', 'Find a phone', 'en-EG');
    const runId = created.run.id as string;
    await requireDomains(runId, 'control-domain', ['amazon.eg']);
    await api()
      .post(`/api/v1/shopping/runs/${runId}/domains/approve`)
      .set('Idempotency-Key', idem('control-domain'))
      .send({ requestId: 'control-domain', domains: ['amazon.eg'] })
      .expect(200);
    await postEvent(runId, 'comparing', 'merchant.attempt_started', {
      attemptId: 'control-attempt',
      merchantId: 'amazon-eg',
      merchantDomain: 'amazon.eg',
      category: 'retail',
    });
    await postEvent(runId, 'paused', 'run.status_changed', {
      from: 'comparing',
      to: 'paused',
      reasonCode: 'login_required',
    });
    await postEvent(
      runId,
      'paused',
      'run.warning',
      {
        code: 'login_required',
        message: 'Login must be completed by the user',
        merchantAttemptId: 'control-attempt',
        evidenceIds: [],
        requiresUserInput: true,
      },
      'control-warning',
    );
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
    expect(String(view.headers['set-cookie']?.[0] ?? '')).toContain(
      'dealpilot_viewer=',
    );
    expect(view.body.viewerUrl).not.toContain(view.body.token);

    const claimed = await api()
      .post(`/api/v1/shopping/runs/${runId}/control/claim`)
      .set('Idempotency-Key', idem('control-claim'))
      .send({
        requestId: 'control-warning',
        merchantAttemptId: 'control-attempt',
        requestedLeaseSeconds: 120,
      })
      .expect(200);
    expect(claimed.body.run.status).toBe('user_takeover');
    expect(claimed.body.lease.status).toBe('active');
    expect(aiRequests.at(-1)?.body).toMatchObject({
      name: 'pause',
      payload: {
        reason: 'control_claim',
        merchantAttemptId: 'control-attempt',
        merchantDomain: 'amazon.eg',
      },
    });
    await api()
      .post(`/api/v1/shopping/runs/${runId}/control/claim`)
      .set('Idempotency-Key', idem('second-claim'))
      .send({
        requestId: 'control-warning',
        merchantAttemptId: 'control-attempt',
      })
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
    const viewerCookie = String(authorization.headers['set-cookie']?.[0] ?? '');
    expect(viewerCookie).toContain('dealpilot_viewer=');
    expect(viewerCookie).toContain('HttpOnly');
    expect(authorization.body).toMatchObject({
      authorized: true,
      runId,
      mode: 'control',
      userId: 'user-1',
      leaseId: claimed.body.lease.id,
    });
    await request(app.getHttpServer())
      .post('/internal/v1/viewer/authorize')
      .set('X-Internal-Token', INTERNAL_TOKEN)
      .set('Cookie', viewerCookie.split(';', 1)[0])
      .expect(200);
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
      run: { status: 'comparing', pendingAction: null },
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

  it('keeps ready-for-handoff browser sessions view-only', async () => {
    const created = await createRun(
      'retail',
      'Find a view-only phone',
      'en-EG',
    );
    const runId = created.run.id as string;
    await requireDomains(runId, 'view-only-domain', ['amazon.eg']);
    await api()
      .post(`/api/v1/shopping/runs/${runId}/domains/approve`)
      .set('Idempotency-Key', idem('view-only-domain'))
      .send({ requestId: 'view-only-domain', domains: ['amazon.eg'] })
      .expect(200);
    await postEvent(runId, 'ready_for_handoff', 'run.status_changed', {
      from: 'comparing',
      to: 'ready_for_handoff',
      reasonCode: null,
    });

    await api()
      .post(`/api/v1/shopping/runs/${runId}/control/claim`)
      .set('Idempotency-Key', idem('view-only-claim'))
      .send({ requestId: 'not-requested', merchantAttemptId: 'not-requested' })
      .expect(409);
  });

  it('resumes an AI-originated safety pause from its previous run state', async () => {
    const created = await createRun('retail', 'Find a phone safely', 'en-EG');
    const runId = created.run.id as string;
    await requireDomains(runId, 'safety-pause-domain', ['amazon.eg']);
    await api()
      .post(`/api/v1/shopping/runs/${runId}/domains/approve`)
      .set('Idempotency-Key', idem('safety-pause-domain'))
      .send({
        requestId: 'safety-pause-domain',
        domains: ['amazon.eg'],
      })
      .expect(200);
    await postEvent(runId, 'paused', 'run.status_changed', {
      from: 'comparing',
      to: 'paused',
      reasonCode: 'browser_warning',
    });

    const paused = await api()
      .get(`/api/v1/shopping/runs/${runId}`)
      .expect(200);
    expect(paused.body.run).toMatchObject({
      status: 'paused',
      resumeStatus: 'comparing',
    });

    const resumed = await api()
      .post(`/api/v1/shopping/runs/${runId}/control`)
      .set('Idempotency-Key', idem('safety-pause-resume'))
      .send({ action: 'resume' })
      .expect(200);
    expect(resumed.body.run).toMatchObject({
      status: 'comparing',
      resumeStatus: null,
    });
    expect(aiRequests.at(-1)?.body).toMatchObject({
      name: 'resume',
      payload: { reason: 'user' },
    });
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
    const screenshot = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03,
    ]);
    await postEvent(runId, 'comparing', 'merchant.attempt_started', {
      attemptId,
      merchantId: 'amazon-eg',
      merchantDomain: 'amazon.eg',
      category: 'retail',
    });
    const uploaded = await request(app.getHttpServer())
      .post(
        `/internal/v1/evidence/${encodeURIComponent(runId)}/${encodeURIComponent(evidenceId)}`,
      )
      .set('X-Internal-Token', INTERNAL_TOKEN)
      .attach('file', screenshot, {
        filename: 'screenshot.png',
        contentType: 'image/png',
      })
      .expect(201);
    expect(uploaded.body).toMatchObject({ accepted: true, evidenceId });
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
    await postEvent(runId, 'comparing', 'offer.recorded', {
      offerId: 'offer:materialized-samsung-a55',
      validity: 'valid',
      merchantAttemptId: attemptId,
      evidenceIds: [evidenceId],
      offer: {
        title: 'Samsung Galaxy A55 5G 256GB',
        sourceUrl: 'https://www.amazon.eg/example-a55',
        match: {
          exact: true,
          confidence: 0.98,
          explanation: 'Exact model and storage match.',
        },
        availability: 'available',
        details: {
          kind: 'retail',
          brand: 'Samsung',
          model: 'A55',
          variant: '8 GB RAM',
          storage: '256 GB',
          size: null,
          color: 'blue',
          quantity: 1,
          condition: 'new',
          deliveryEstimate: '2026-07-19',
        },
        price: {
          itemSubtotal: '24495.00',
          deliveryFee: '0.00',
          serviceFee: '0.00',
          bookingFee: '0.00',
          tax: '0.00',
          mandatoryFees: [],
          verifiedDiscount: '0.00',
          optionalTip: null,
          finalTotal: '24495.00',
        },
        observedAt: '2026-07-18T10:00:00.000Z',
        exclusionReason: null,
        incompleteFields: [],
      },
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
    expect(report.body.validOffers).toEqual([
      expect.objectContaining({
        id: 'offer:materialized-samsung-a55',
        title: 'Samsung Galaxy A55 5G 256GB',
        price: expect.objectContaining({ finalTotal: '24495.00' }),
        details: expect.objectContaining({
          model: 'A55',
          storage: '256 GB',
          deliveryEstimate: '2026-07-19',
        }),
      }),
    ]);
    expect(report.body.partialFailures).toEqual([
      expect.objectContaining({
        merchantAttemptId: attemptId,
        code: 'MERCHANT_UNAVAILABLE',
      }),
    ]);
    expect(report.body.evidence).toEqual([
      expect.objectContaining({
        id: evidenceId,
        redacted: true,
        sha256: uploaded.body.sha256,
        uri: `https://dealpilot.test/api/v1/shopping/runs/${runId}/evidence/${encodeURIComponent(evidenceId)}`,
      }),
    ]);
    const downloaded = await api()
      .get(
        `/api/v1/shopping/runs/${runId}/evidence/${encodeURIComponent(evidenceId)}`,
      )
      .expect('Content-Type', /image\/png/)
      .expect(200);
    expect(Buffer.from(downloaded.body)).toEqual(screenshot);
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
    eventId?: string,
  ) {
    const id = eventId ?? `ai-${type}-${Math.random().toString(36).slice(2)}`;
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
