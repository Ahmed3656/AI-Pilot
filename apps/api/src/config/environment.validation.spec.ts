import { validateEnvironment } from './environment.validation';

const productionEnvironment = {
  NODE_ENV: 'production',
  DATABASE_ENABLED: 'true',
  DATABASE_URL: 'postgresql://dealpilot:private@postgres:5432/dealpilot',
  AI_SERVICE_URL: 'http://ai-service:8000',
  DEALPILOT_PUBLIC_ORIGIN: 'https://dealpilot.example.test',
  JWT_SECRET: 'jwt-secret-value-that-is-longer-than-32-bytes',
  INTERNAL_TOKEN: 'internal-token-value-that-is-longer-than-32-bytes',
  VIEWER_TOKEN_SECRET: 'viewer-secret-value-that-is-longer-than-32-bytes',
  OBJECT_STORAGE_PROVIDER: 's3',
  OBJECT_STORAGE_BUCKET: 'private-testing-evidence',
  OBJECT_STORAGE_REGION: 'us-east-1',
  OBJECT_STORAGE_ACCESS_KEY_ID: 'testing-access-key',
  OBJECT_STORAGE_SECRET_ACCESS_KEY: 'testing-secret-key',
  OBJECT_STORAGE_PUBLIC_ACCESS_BLOCKED: 'true',
};

describe('environment validation', () => {
  it('accepts and normalizes canonical MVP timeout variables', () => {
    const environment = validateEnvironment({
      ...productionEnvironment,
      VIEWER_TOKEN_TTL_SECONDS: '600',
      CONTROL_LEASE_TTL_SECONDS: '90',
      RUN_BROWSER_TTL_SECONDS: '3600',
      EVENT_RETENTION_SECONDS: '86400',
    });

    expect(environment).toMatchObject({
      VIEWER_TOKEN_TTL_SECONDS: 600,
      CONTROL_LEASE_TTL_SECONDS: 90,
      RUN_BROWSER_TTL_SECONDS: 3600,
      EVENT_RETENTION_SECONDS: 86400,
    });
  });

  it('fails production startup when persistence or private integration is absent', () => {
    expect(() =>
      validateEnvironment({
        ...productionEnvironment,
        DATABASE_ENABLED: 'false',
      }),
    ).toThrow('DATABASE_ENABLED');
  });

  it('fails closed when required durable private object storage is incomplete', () => {
    expect(() =>
      validateEnvironment({
        ...productionEnvironment,
        OBJECT_STORAGE_BUCKET: undefined,
      }),
    ).toThrow('OBJECT_STORAGE_BUCKET');
  });

  it.each([
    ['INTERNAL_TOKEN', 'JWT_SECRET'],
    ['VIEWER_TOKEN_SECRET', 'JWT_SECRET'],
    ['VIEWER_TOKEN_SECRET', 'INTERNAL_TOKEN'],
  ] as const)('rejects matching %s and %s', (duplicateKey, sourceKey) => {
    expect(() =>
      validateEnvironment({
        ...productionEnvironment,
        [duplicateKey]: productionEnvironment[sourceKey],
      }),
    ).toThrow('must be distinct');
  });

  it.each([
    'INTERNAL_SERVICE_TOKEN',
    'AI_INTERNAL_SERVICE_TOKEN',
    'AI_NEST_API_INTERNAL_URL',
    'VIEWER_AUTH_SHARED_SECRET',
    'COUNTRY',
    'MARKET',
    'CURRENCY',
    'TIMEZONE',
  ])('rejects obsolete or configurable fixed-scope variable %s', (key) => {
    expect(() =>
      validateEnvironment({ ...productionEnvironment, [key]: 'obsolete' }),
    ).toThrow(key);
  });
});
