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
    objectStorage: {
      provider: process.env.OBJECT_STORAGE_PROVIDER,
      bucket: process.env.OBJECT_STORAGE_BUCKET,
      region: process.env.OBJECT_STORAGE_REGION,
      endpoint: process.env.OBJECT_STORAGE_ENDPOINT,
      accessKeyId: process.env.OBJECT_STORAGE_ACCESS_KEY_ID,
      secretAccessKey: process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY,
      kmsKeyId: process.env.OBJECT_STORAGE_KMS_KEY_ID,
      forcePathStyle: process.env.OBJECT_STORAGE_FORCE_PATH_STYLE === 'true',
      publicAccessBlocked:
        process.env.OBJECT_STORAGE_PUBLIC_ACCESS_BLOCKED === 'true',
      durablePrivateStorageRequired:
        process.env.DURABLE_PRIVATE_STORAGE_REQUIRED === 'true' ||
        ((process.env.NODE_ENV ?? 'development') === 'production' &&
          process.env.DURABLE_PRIVATE_STORAGE_REQUIRED !== 'false'),
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
      accessTtlSeconds: durationSeconds(process.env.JWT_ACCESS_TTL ?? '15m'),
      refreshTtlSeconds: durationSeconds(process.env.JWT_REFRESH_TTL ?? '7d'),
      verificationTtlSeconds: Number(
        process.env.AUTH_VERIFICATION_TTL_SECONDS ?? 86_400,
      ),
      recoveryTtlSeconds: Number(process.env.AUTH_RECOVERY_TTL_SECONDS ?? 3600),
      loginMaximumAttempts: Number(
        process.env.AUTH_LOGIN_MAXIMUM_ATTEMPTS ?? 5,
      ),
      loginNetworkMaximumAttempts: Number(
        process.env.AUTH_LOGIN_NETWORK_MAXIMUM_ATTEMPTS ?? 50,
      ),
      loginWindowSeconds: Number(process.env.AUTH_LOGIN_WINDOW_SECONDS ?? 900),
      loginLockSeconds: Number(process.env.AUTH_LOGIN_LOCK_SECONDS ?? 900),
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

function durationSeconds(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value);
  if (!match) return Number.NaN;
  const multiplier = { s: 1, m: 60, h: 3600, d: 86_400 }[
    match[2] as 's' | 'm' | 'h' | 'd'
  ];
  return Number(match[1]) * multiplier;
}
