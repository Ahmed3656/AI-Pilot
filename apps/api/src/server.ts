import compression from 'compression';
import helmet from 'helmet';
import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function configureServer(app: INestApplication): void {
  app.use(helmet());
  app.use(compression());
  app.enableCors({ origin: true, credentials: true });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('AI Pilot API')
    .setDescription('Foundational API contracts for the AI Pilot platform.')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);
}
