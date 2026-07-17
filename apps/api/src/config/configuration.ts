export function configuration() {
  const isTest = (process.env.NODE_ENV ?? 'development') === 'test';
  return {
    app: {
      name: process.env.APP_NAME ?? 'AI Pilot API',
      nodeEnv: process.env.NODE_ENV ?? 'development',
      port: Number(process.env.PORT ?? 3000),
    },
    database: {
      enabled: process.env.DATABASE_ENABLED === 'true',
      url:
        process.env.DATABASE_URL ??
        'postgresql://agent:agent@localhost:5432/agent_platform',
    },
    observability: {
      enabled: process.env.OBSERVABILITY_ENABLED !== 'false',
      logLevel: process.env.LOG_LEVEL ?? 'info',
      slowRequestMs: Number(process.env.SLOW_REQUEST_MS ?? 500),
      slowControllerMs: Number(process.env.SLOW_CONTROLLER_MS ?? 450),
      slowServiceMs: Number(process.env.SLOW_SERVICE_MS ?? 250),
      slowRepositoryMs: Number(process.env.SLOW_REPOSITORY_MS ?? 120),
      slowQueryMs: Number(process.env.SLOW_QUERY_MS ?? 100),
      nPlusOneThreshold: Number(process.env.N_PLUS_ONE_THRESHOLD ?? 5),
      blockingOperationMs: Number(process.env.BLOCKING_OPERATION_MS ?? 250),
      blockingEventLoopUtilization: Number(
        process.env.BLOCKING_EVENT_LOOP_UTILIZATION ?? 0.75,
      ),
    },
    auth: {
      jwtSecret:
        process.env.JWT_SECRET ??
        (isTest ? 'test-jwt-secret-at-least-32-characters-long' : undefined),
      accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
      refreshTtl: process.env.JWT_REFRESH_TTL ?? '7d',
    },
    shopping: {
      aiBaseUrl: process.env.AI_SERVICE_URL ?? '',
      internalToken: process.env.INTERNAL_TOKEN,
      viewerSecret: process.env.VIEWER_TOKEN_SECRET,
      addressTtlMs: Number(process.env.ADDRESS_SECRET_TTL_MS ?? 30 * 60 * 1000),
      viewerTtlSeconds: Number(process.env.VIEWER_TOKEN_TTL_SECONDS ?? 900),
      controlLeaseTtlSeconds: Number(
        process.env.CONTROL_LEASE_TTL_SECONDS ?? 120,
      ),
      browserTtlSeconds: Number(process.env.RUN_BROWSER_TTL_SECONDS ?? 3600),
      eventRetentionSeconds: Number(
        process.env.EVENT_RETENTION_SECONDS ?? 86400,
      ),
      publicOrigin:
        process.env.DEALPILOT_PUBLIC_ORIGIN ?? 'http://localhost:8080',
      aiTimeoutMs: Number(process.env.AI_REQUEST_TIMEOUT_SECONDS ?? 10) * 1000,
    },
  };
}
