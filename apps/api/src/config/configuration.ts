export function configuration() {
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
        'local-development-secret-change-before-production',
      accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
      refreshTtl: process.env.JWT_REFRESH_TTL ?? '7d',
    },
  };
}
