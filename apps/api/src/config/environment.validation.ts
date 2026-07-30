import { plainToInstance } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

enum NodeEnvironment {
  Development = 'development',
  Test = 'test',
  Production = 'production',
}
enum LogLevel {
  Debug = 'debug',
  Info = 'info',
  Warn = 'warn',
  Error = 'error',
}
enum ObjectStorageProvider {
  S3 = 's3',
}

class EnvironmentVariables {
  @IsEnum(NodeEnvironment) NODE_ENV: NodeEnvironment =
    NodeEnvironment.Development;
  @IsInt() @Min(1) PORT = 3000;
  @IsBoolean() DATABASE_ENABLED = false;
  @IsOptional() @IsString() DATABASE_URL?: string;
  @IsOptional()
  @IsEnum(ObjectStorageProvider)
  OBJECT_STORAGE_PROVIDER?: ObjectStorageProvider;
  @IsOptional() @IsString() OBJECT_STORAGE_BUCKET?: string;
  @IsOptional() @IsString() OBJECT_STORAGE_REGION?: string;
  @IsOptional() @IsUrl({ require_tld: false }) OBJECT_STORAGE_ENDPOINT?: string;
  @IsOptional() @IsString() OBJECT_STORAGE_ACCESS_KEY_ID?: string;
  @IsOptional() @IsString() OBJECT_STORAGE_SECRET_ACCESS_KEY?: string;
  @IsOptional() @IsString() OBJECT_STORAGE_KMS_KEY_ID?: string;
  @IsBoolean() OBJECT_STORAGE_FORCE_PATH_STYLE = false;
  @IsBoolean() OBJECT_STORAGE_PUBLIC_ACCESS_BLOCKED = false;
  @IsBoolean() DURABLE_PRIVATE_STORAGE_REQUIRED = false;
  @IsOptional() @IsString() @MinLength(32) JWT_SECRET?: string;
  @IsOptional() @IsString() @MinLength(32) INTERNAL_TOKEN?: string;
  @IsOptional() @IsString() @MinLength(32) VIEWER_TOKEN_SECRET?: string;
  @IsOptional() @IsUrl({ require_tld: false }) AI_SERVICE_URL?: string;
  @IsInt() @Min(1000) @Max(1_800_000) ADDRESS_SECRET_TTL_MS = 1_800_000;
  @IsInt() @Min(1) @Max(900) VIEWER_TOKEN_TTL_SECONDS = 900;
  @IsInt() @Min(60) @Max(900) CONTROL_LEASE_TTL_SECONDS = 120;
  @IsInt() @Min(60) RUN_BROWSER_TTL_SECONDS = 3600;
  @IsInt() @Min(60) EVENT_RETENTION_SECONDS = 86400;
  @IsOptional() @IsUrl({ require_tld: false }) DEALPILOT_PUBLIC_ORIGIN?: string;
  @IsInt() @Min(1) @Max(120) AI_REQUEST_TIMEOUT_SECONDS = 10;
  @IsBoolean() OBSERVABILITY_ENABLED = true;
  @IsEnum(LogLevel) LOG_LEVEL: LogLevel = LogLevel.Info;
  @IsInt() @Min(1) SLOW_REQUEST_MS = 500;
  @IsInt() @Min(1) SLOW_CONTROLLER_MS = 450;
  @IsInt() @Min(1) SLOW_SERVICE_MS = 250;
  @IsInt() @Min(1) SLOW_REPOSITORY_MS = 120;
  @IsInt() @Min(1) SLOW_QUERY_MS = 100;
  @IsInt() @Min(2) N_PLUS_ONE_THRESHOLD = 5;
  @IsInt() @Min(1) BLOCKING_OPERATION_MS = 250;
  @IsNumber() @Min(0) BLOCKING_EVENT_LOOP_UTILIZATION = 0.75;
}

export function validateEnvironment(config: Record<string, unknown>) {
  const deprecatedVariables = [
    'INTERNAL_SERVICE_TOKEN',
    'AI_INTERNAL_SERVICE_TOKEN',
    'AI_NEST_API_INTERNAL_URL',
    'VIEWER_AUTH_SHARED_SECRET',
    'COUNTRY',
    'MARKET',
    'CURRENCY',
    'TIMEZONE',
  ].filter((key) => config[key] !== undefined);
  if (deprecatedVariables.length) {
    throw new Error(
      `Unsupported environment variables: ${deprecatedVariables.join(', ')}`,
    );
  }
  const numeric = (key: string, fallback: number) =>
    Number(config[key] ?? fallback);
  const nodeEnv = config.NODE_ENV ?? NodeEnvironment.Development;
  const isTest = nodeEnv === NodeEnvironment.Test;
  const normalized = {
    ...config,
    NODE_ENV: nodeEnv,
    PORT: numeric('PORT', 3000),
    DATABASE_ENABLED:
      config.DATABASE_ENABLED === true || config.DATABASE_ENABLED === 'true',
    OBJECT_STORAGE_FORCE_PATH_STYLE:
      config.OBJECT_STORAGE_FORCE_PATH_STYLE === true ||
      config.OBJECT_STORAGE_FORCE_PATH_STYLE === 'true',
    OBJECT_STORAGE_PUBLIC_ACCESS_BLOCKED:
      config.OBJECT_STORAGE_PUBLIC_ACCESS_BLOCKED === true ||
      config.OBJECT_STORAGE_PUBLIC_ACCESS_BLOCKED === 'true',
    DURABLE_PRIVATE_STORAGE_REQUIRED:
      config.DURABLE_PRIVATE_STORAGE_REQUIRED === true ||
      config.DURABLE_PRIVATE_STORAGE_REQUIRED === 'true' ||
      (nodeEnv === NodeEnvironment.Production &&
        config.DURABLE_PRIVATE_STORAGE_REQUIRED !== 'false'),
    OBSERVABILITY_ENABLED:
      config.OBSERVABILITY_ENABLED !== false &&
      config.OBSERVABILITY_ENABLED !== 'false',
    LOG_LEVEL: config.LOG_LEVEL ?? LogLevel.Info,
    SLOW_REQUEST_MS: numeric('SLOW_REQUEST_MS', 500),
    SLOW_CONTROLLER_MS: numeric('SLOW_CONTROLLER_MS', 450),
    SLOW_SERVICE_MS: numeric('SLOW_SERVICE_MS', 250),
    SLOW_REPOSITORY_MS: numeric('SLOW_REPOSITORY_MS', 120),
    SLOW_QUERY_MS: numeric('SLOW_QUERY_MS', 100),
    N_PLUS_ONE_THRESHOLD: numeric('N_PLUS_ONE_THRESHOLD', 5),
    BLOCKING_OPERATION_MS: numeric('BLOCKING_OPERATION_MS', 250),
    BLOCKING_EVENT_LOOP_UTILIZATION: numeric(
      'BLOCKING_EVENT_LOOP_UTILIZATION',
      0.75,
    ),
    ADDRESS_SECRET_TTL_MS: numeric('ADDRESS_SECRET_TTL_MS', 1_800_000),
    VIEWER_TOKEN_TTL_SECONDS: numeric('VIEWER_TOKEN_TTL_SECONDS', 900),
    CONTROL_LEASE_TTL_SECONDS: numeric('CONTROL_LEASE_TTL_SECONDS', 120),
    RUN_BROWSER_TTL_SECONDS: numeric('RUN_BROWSER_TTL_SECONDS', 3600),
    EVENT_RETENTION_SECONDS: numeric('EVENT_RETENTION_SECONDS', 86400),
    AI_REQUEST_TIMEOUT_SECONDS: numeric('AI_REQUEST_TIMEOUT_SECONDS', 10),
    JWT_SECRET:
      config.JWT_SECRET ??
      (isTest ? 'test-jwt-secret-at-least-32-characters-long' : undefined),
  };
  const validated = plainToInstance(EnvironmentVariables, normalized);
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length)
    throw new Error(errors.map((error) => error.toString()).join('\n'));
  if (validated.AI_SERVICE_URL?.endsWith('/'))
    throw new Error('AI_SERVICE_URL must not have a trailing slash');
  if (validated.NODE_ENV !== NodeEnvironment.Test && !normalized.JWT_SECRET)
    throw new Error('JWT_SECRET must be provided outside tests');
  if (validated.NODE_ENV === NodeEnvironment.Production) {
    const required = [
      'DATABASE_URL',
      'AI_SERVICE_URL',
      'INTERNAL_TOKEN',
      'VIEWER_TOKEN_SECRET',
      'DEALPILOT_PUBLIC_ORIGIN',
    ] as const;
    const missing: string[] = required.filter((key) => !config[key]);
    if (!validated.DATABASE_ENABLED) missing.push('DATABASE_ENABLED');
    if (missing.length)
      throw new Error(
        `Live API configuration is incomplete: ${[...new Set(missing)].join(', ')}`,
      );
  }
  if (validated.DURABLE_PRIVATE_STORAGE_REQUIRED) {
    const requiredStorage = [
      'OBJECT_STORAGE_PROVIDER',
      'OBJECT_STORAGE_BUCKET',
      'OBJECT_STORAGE_REGION',
      'OBJECT_STORAGE_ACCESS_KEY_ID',
      'OBJECT_STORAGE_SECRET_ACCESS_KEY',
    ] as const;
    const missingStorage = requiredStorage.filter((key) => !config[key]);
    if (missingStorage.length)
      throw new Error(
        `Durable private object storage is incomplete: ${missingStorage.join(', ')}`,
      );
    if (validated.OBJECT_STORAGE_PROVIDER !== ObjectStorageProvider.S3)
      throw new Error(
        'Durable private object storage must use the s3 provider',
      );
    if (!validated.OBJECT_STORAGE_PUBLIC_ACCESS_BLOCKED)
      throw new Error(
        'Durable private object storage must block public access',
      );
  }
  const secrets = [
    validated.JWT_SECRET,
    validated.INTERNAL_TOKEN,
    validated.VIEWER_TOKEN_SECRET,
  ].filter((secret): secret is string => Boolean(secret));
  if (new Set(secrets).size !== secrets.length)
    throw new Error(
      'JWT_SECRET, INTERNAL_TOKEN, and VIEWER_TOKEN_SECRET must be distinct',
    );
  return normalized;
}
