import { plainToInstance } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
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

class EnvironmentVariables {
  @IsEnum(NodeEnvironment)
  NODE_ENV: NodeEnvironment = NodeEnvironment.Development;

  @IsInt()
  @Min(1)
  PORT = 3000;

  @IsBoolean()
  DATABASE_ENABLED = false;

  @IsBoolean()
  OBSERVABILITY_ENABLED = true;

  @IsEnum(LogLevel)
  LOG_LEVEL: LogLevel = LogLevel.Info;

  @IsInt()
  @Min(1)
  SLOW_REQUEST_MS = 500;

  @IsInt()
  @Min(1)
  SLOW_CONTROLLER_MS = 450;

  @IsInt()
  @Min(1)
  SLOW_SERVICE_MS = 250;

  @IsInt()
  @Min(1)
  SLOW_REPOSITORY_MS = 120;

  @IsInt()
  @Min(1)
  SLOW_QUERY_MS = 100;

  @IsInt()
  @Min(2)
  N_PLUS_ONE_THRESHOLD = 5;

  @IsInt()
  @Min(1)
  BLOCKING_OPERATION_MS = 250;

  @IsNumber()
  @Min(0)
  BLOCKING_EVENT_LOOP_UTILIZATION = 0.75;

  @IsOptional()
  @IsString()
  DATABASE_URL?: string;

  @IsString()
  @MinLength(32)
  JWT_SECRET = 'local-development-secret-change-before-production';

  @IsOptional()
  @IsString()
  AI_SERVICE_URL?: string;

  @IsString()
  @MinLength(32)
  INTERNAL_TOKEN = 'local-internal-token-change-before-production';

  @IsString()
  @MinLength(32)
  VIEWER_TOKEN_SECRET = 'local-development-secret-change-before-production';

  @IsInt()
  @Min(1000)
  ADDRESS_SECRET_TTL_MS = 30 * 60 * 1000;
}

export function validateEnvironment(config: Record<string, unknown>) {
  const numeric = (key: string, fallback: number) =>
    Number(config[key] ?? fallback);
  const normalized = {
    ...config,
    NODE_ENV: config.NODE_ENV ?? NodeEnvironment.Development,
    PORT: Number(config.PORT ?? 3000),
    DATABASE_ENABLED:
      config.DATABASE_ENABLED === true || config.DATABASE_ENABLED === 'true',
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
    JWT_SECRET:
      config.JWT_SECRET ?? 'local-development-secret-change-before-production',
    INTERNAL_TOKEN:
      config.INTERNAL_TOKEN ?? 'local-internal-token-change-before-production',
    VIEWER_TOKEN_SECRET:
      config.VIEWER_TOKEN_SECRET ??
      config.JWT_SECRET ??
      'local-development-secret-change-before-production',
    ADDRESS_SECRET_TTL_MS: numeric('ADDRESS_SECRET_TTL_MS', 30 * 60 * 1000),
  };
  const validated = plainToInstance(EnvironmentVariables, normalized);
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    throw new Error(errors.map((error) => error.toString()).join('\n'));
  }
  if (validated.NODE_ENV === NodeEnvironment.Production && !config.JWT_SECRET) {
    throw new Error('JWT_SECRET must be provided in production');
  }
  if (
    validated.NODE_ENV === NodeEnvironment.Production &&
    (!config.INTERNAL_TOKEN || !config.VIEWER_TOKEN_SECRET)
  ) {
    throw new Error(
      'INTERNAL_TOKEN and VIEWER_TOKEN_SECRET must be provided in production',
    );
  }
  return normalized;
}
