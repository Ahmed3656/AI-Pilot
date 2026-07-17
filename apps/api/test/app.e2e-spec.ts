import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Health endpoints (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
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
});
