import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApiRouting } from '../src/server';

interface SessionBody {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; displayName: string };
}

describe('Health endpoints (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApiRouting(app);
    await app.init();
  });

  afterAll(async () => app?.close());

  it.each(['/health', '/health/live', '/health/ready'])(
    'GET %s',
    async (path) => {
      const response = await request(app.getHttpServer() as Server)
        .get(path)
        .expect(200);
      const body = response.body as { status?: string };
      expect(body.status).toBe('ok');
    },
  );

  it('registers, logs in, and rotates a real mobile-compatible session', async () => {
    const account = {
      displayName: 'Integration User',
      email: 'integration@example.test',
      password: 'integration-password',
    };
    const registered = await request(app.getHttpServer() as Server)
      .post('/api/v1/auth/register')
      .send(account)
      .expect(201);
    const registeredBody = registered.body as SessionBody;
    expect(registeredBody).toMatchObject({
      user: {
        email: account.email,
        displayName: account.displayName,
      },
    });
    expect(registeredBody.accessToken).toEqual(expect.any(String));
    expect(registeredBody.refreshToken).toEqual(expect.any(String));

    const loggedIn = await request(app.getHttpServer() as Server)
      .post('/api/v1/auth/login')
      .send({ email: account.email, password: account.password })
      .expect(200);
    const loggedInBody = loggedIn.body as SessionBody;
    const refreshed = await request(app.getHttpServer() as Server)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: loggedInBody.refreshToken })
      .expect(200);
    const refreshedBody = refreshed.body as SessionBody;
    expect(refreshedBody.user.id).toBe(loggedInBody.user.id);
  });
});
