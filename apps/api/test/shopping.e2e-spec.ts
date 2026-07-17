import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Server } from 'node:http';
import { createConnection } from 'node:net';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { RunApproval } from '../src/modules/shopping/entities';
import {
  SHOPPING_STORE,
  ShoppingStore,
} from '../src/modules/shopping/repositories';
import { ApprovalType } from '../src/modules/shopping/shopping.types';
import { configureApiRouting } from '../src/server';

const INTERNAL_TOKEN = 'local-internal-token-change-before-production';

interface ApprovalResponseBody {
  approval: { type: string; recipientDomains: string[] };
}

interface ViewerTokenResponseBody {
  mode: string;
  token: string;
  expiresAt: string;
}

interface RunResponseBody {
  state: string;
}

describe('DealPilot Egypt shopping control plane (e2e)', () => {
  let app: INestApplication;
  let store: ShoppingStore;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.OBSERVABILITY_ENABLED = 'false';
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApiRouting(app);
    await app.listen(0, '127.0.0.1');
    store = app.get<ShoppingStore>(SHOPPING_STORE);
    baseUrl = await app.getUrl();
  });

  afterAll(async () => app?.close(), 15_000);

  it('fixes the catalog, market, and currency to Egypt', async () => {
    const merchants = await request(app.getHttpServer() as Server)
      .get('/api/v1/shopping/merchants')
      .expect(200);
    expect(merchants.body).toHaveLength(5);
    expect(merchants.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
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

    await request(app.getHttpServer() as Server)
      .post('/api/v1/shopping/runs')
      .send({
        category: 'retail',
        query: 'television',
        market: 'US',
        currency: 'USD',
      })
      .expect(400);
  });

  it('enforces stateful domain and address approvals without exposing plaintext', async () => {
    const created = await createRun('food', 'Order dinner');
    const runId = created.id as string;
    await request(app.getHttpServer() as Server)
      .post(`/api/v1/shopping/runs/${runId}/domains/approve`)
      .send({ domains: ['talabat.com'] })
      .expect(409);

    const stateEvent = event(runId, 'domain-needed', 'run.state_changed', {
      state: 'awaiting_domain_approval',
    });
    await postAiEvent(stateEvent).expect(202, {
      accepted: true,
      duplicate: false,
    });
    await postAiEvent(stateEvent).expect(202, {
      accepted: true,
      duplicate: true,
    });

    const approved = await request(app.getHttpServer() as Server)
      .post(`/api/v1/shopping/runs/${runId}/domains/approve`)
      .send({ domains: ['talabat.com'] })
      .expect(200);
    const approvedBody = approved.body as ApprovalResponseBody;
    expect(approvedBody.approval).toMatchObject({
      type: 'domain_access',
      recipientDomains: ['talabat.com'],
    });

    await postAiEvent(
      event(runId, 'address-needed', 'run.state_changed', {
        state: 'awaiting_address_consent',
      }),
    ).expect(202);

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
    const grant = await request(app.getHttpServer() as Server)
      .post(`/api/v1/shopping/runs/${runId}/address-grant`)
      .send({ address, merchantDomains: ['talabat.com'] })
      .expect(200);
    const grantBody = grant.body as ApprovalResponseBody;
    expect(grantBody.approval).toMatchObject({
      type: 'address_share',
      recipientDomains: ['talabat.com'],
    });
    const publicText = JSON.stringify(grant.body);
    for (const plaintext of Object.values(address).filter(
      (value) => value.length >= 5,
    ))
      expect(publicText).not.toContain(plaintext);

    const data = await store.report(runId);
    const addressApproval = data.approvals.find(
      (approval) => approval.type === ApprovalType.AddressShare,
    ) as RunApproval;
    const secretReference = addressApproval.metadata.secretReference as string;
    const resolved = await request(app.getHttpServer() as Server)
      .post('/internal/v1/secrets/resolve')
      .set('X-Internal-Token', INTERNAL_TOKEN)
      .send({
        runId,
        secretReference,
        merchantDomain: 'talabat.com',
        field: 'street',
      })
      .expect(200);
    expect(resolved.body).toEqual({
      runId,
      field: 'street',
      value: address.street,
    });

    const report = await request(app.getHttpServer() as Server)
      .get(`/api/v1/shopping/runs/${runId}/report`)
      .expect(200);
    const reportText = JSON.stringify(report.body);
    for (const plaintext of Object.values(address).filter(
      (value) => value.length >= 5,
    ))
      expect(reportText).not.toContain(plaintext);
  });

  it('requires and records explicit seat-hold approval', async () => {
    const created = await createRun('cinema', 'Two movie tickets');
    const runId = created.id as string;
    await postAiEvent(
      event(runId, 'cinema-domain', 'run.state_changed', {
        state: 'awaiting_domain_approval',
      }),
    ).expect(202);
    await request(app.getHttpServer() as Server)
      .post(`/api/v1/shopping/runs/${runId}/domains/approve`)
      .send({ domains: ['voxcinemas.com'] })
      .expect(200);
    await postAiEvent(
      event(runId, 'seat-needed', 'run.state_changed', {
        state: 'awaiting_seat_hold_approval',
      }),
    ).expect(202);
    const response = await request(app.getHttpServer() as Server)
      .post(`/api/v1/shopping/runs/${runId}/seat-hold/approve`)
      .send({ merchantDomain: 'voxcinemas.com', offerId: 'offer-1' })
      .expect(200);
    const responseBody = response.body as ApprovalResponseBody;
    expect(responseBody.approval.type).toBe('seat_hold');
  });

  it('issues scoped viewer tokens, pauses AI control, and authorizes WebSockets', async () => {
    const created = await createRun('retail', 'Find a phone');
    const runId = created.id as string;
    await postAiEvent(
      event(runId, 'viewer-ready', 'run.state_changed', {
        state: 'comparing',
      }),
    ).expect(202);
    await postAiEvent(
      event(runId, 'handoff-ready', 'run.state_changed', {
        state: 'ready_for_handoff',
      }),
    ).expect(202);

    const issued = await request(app.getHttpServer() as Server)
      .get(`/api/v1/shopping/runs/${runId}/viewer-token`)
      .query({ mode: 'control' })
      .expect(200);
    const issuedBody = issued.body as ViewerTokenResponseBody;
    expect(issuedBody.mode).toBe('control');
    expect(issued.headers['set-cookie']?.[0]).toMatch(
      /^dealpilot_viewer=[^;]+; Path=\/viewer; HttpOnly; SameSite=Strict$/,
    );
    expect(
      new Date(issuedBody.expiresAt).getTime() - Date.now(),
    ).toBeGreaterThan(14 * 60 * 1000);
    const current = await request(app.getHttpServer() as Server)
      .get(`/api/v1/shopping/runs/${runId}`)
      .expect(200);
    const currentBody = current.body as RunResponseBody;
    expect(currentBody.state).toBe('user_takeover');

    const authorization = await request(app.getHttpServer() as Server)
      .post('/internal/v1/viewer/authorize')
      .set('X-Internal-Token', INTERNAL_TOKEN)
      .set('Authorization', `Bearer ${issuedBody.token}`)
      .expect(200);
    expect(authorization.body).toMatchObject({
      authorized: true,
      runId,
      mode: 'control',
    });
    await request(app.getHttpServer() as Server)
      .post('/internal/v1/viewer/authorize')
      .set('X-Internal-Token', INTERNAL_TOKEN)
      .set('Cookie', `dealpilot_viewer=${issuedBody.token}x`)
      .expect(401);

    await request(app.getHttpServer() as Server)
      .post('/internal/v1/viewer/authorize')
      .set('X-Internal-Token', INTERNAL_TOKEN)
      .query({ token: issuedBody.token })
      .expect(401);

    const handshake = await websocketHandshake(
      baseUrl,
      `/api/v1/shopping/runs/${runId}/events`,
      ['dealpilot.events.v1', `bearer.${issuedBody.token}`],
    );
    expect(handshake).toContain('101 Switching Protocols');
    expect(handshake).toContain('Sec-WebSocket-Protocol: dealpilot.events.v1');
    expect(handshake).not.toContain(`bearer.${issuedBody.token}`);

    await request(app.getHttpServer() as Server)
      .post(`/api/v1/shopping/runs/${runId}/control`)
      .send({ action: 'release_control' })
      .expect(200);
    await request(app.getHttpServer() as Server)
      .post('/internal/v1/viewer/authorize')
      .set('X-Internal-Token', INTERNAL_TOKEN)
      .set('Authorization', `Bearer ${issuedBody.token}`)
      .expect(403);

    await request(app.getHttpServer() as Server)
      .get('/v1/shopping/merchants')
      .expect(404);
  });

  async function createRun(
    category: string,
    query: string,
  ): Promise<Record<string, unknown>> {
    const response = await request(app.getHttpServer() as Server)
      .post('/api/v1/shopping/runs')
      .send({ category, query, market: 'EG', currency: 'EGP' })
      .expect(201);
    return response.body as Record<string, unknown>;
  }

  function postAiEvent(payload: Record<string, unknown>) {
    return request(app.getHttpServer() as Server)
      .post('/internal/v1/ai-events')
      .set('X-Internal-Token', INTERNAL_TOKEN)
      .send(payload);
  }
});

function event(
  runId: string,
  eventId: string,
  type: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  return {
    runId,
    eventId,
    type,
    observedAt: new Date().toISOString(),
    ...payload,
  };
}

async function websocketHandshake(
  baseUrl: string,
  path: string,
  protocols: string[],
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
          `Sec-WebSocket-Protocol: ${protocols.join(', ')}`,
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
