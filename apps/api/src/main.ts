import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { formatStartupBanner } from './core/bootstrap/startup-banner';
import { ApplicationLogger } from './core/logging/application.logger';
import { configureApiRouting, configureServer } from './server';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(ApplicationLogger));

  configureApiRouting(app);
  configureServer(app);
  app.enableShutdownHooks();

  const config = app.get(ConfigService);
  const port = config.get<number>('app.port', 3000);
  await app.listen(port, '0.0.0.0');
  console.log(
    formatStartupBanner({
      environment: config.get<string>('app.nodeEnv', 'development'),
      port,
    }),
  );
}

void bootstrap();
