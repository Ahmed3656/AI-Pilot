import compression from 'compression';
import helmet from 'helmet';
import {
  INestApplication,
  RequestMethod,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function configureServer(app: INestApplication): void {
  app.use(helmet());
  app.use(compression());
  app.enableCors({ origin: true, credentials: true });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('DealPilot Egypt MVP API')
    .setDescription(
      'Egypt-only shopping control API. Market EG, currency EGP, timezone Africa/Cairo.',
    )
    .setVersion('1.0.0')
    .addBearerAuth(undefined, 'userBearer')
    .addBearerAuth(undefined, 'viewerBearer')
    .addApiKey(
      { type: 'apiKey', in: 'header', name: 'X-Internal-Token' },
      'internalToken',
    )
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);
}

export function configureApiRouting(app: INestApplication): void {
  app.setGlobalPrefix('api', {
    exclude: [
      { path: 'health', method: RequestMethod.ALL },
      { path: 'health/live', method: RequestMethod.ALL },
      { path: 'health/ready', method: RequestMethod.ALL },
      { path: 'internal/v1', method: RequestMethod.ALL },
      { path: 'internal/v1/{*path}', method: RequestMethod.ALL },
    ],
  });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
}
