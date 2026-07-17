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

  it('requires JWT, internal, and viewer secrets to be distinct', () => {
    expect(() =>
      validateEnvironment({
        ...productionEnvironment,
        VIEWER_TOKEN_SECRET: productionEnvironment.JWT_SECRET,
      }),
    ).toThrow('must be distinct');
  });
});
