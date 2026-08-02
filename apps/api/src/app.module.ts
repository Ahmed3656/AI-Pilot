import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { configuration, validateEnvironment } from './config';
import { AllExceptionsFilter } from './core/filters/all-exceptions.filter';
import { RequestLoggingInterceptor } from './core/interceptors/request-logging.interceptor';
import { ApplicationLogger } from './core/logging/application.logger';
import { RequestContextMiddleware } from './core/middlewares/request-context.middleware';
import { ControllerPerformanceInterceptor } from './core/observability/controller-performance.interceptor';
import { ObservabilityModule } from './core/observability/observability.module';
import { DatabaseModule } from './database/database.module';
import {
  NeutralFoundationModule,
  NeutralFoundationModuleOptions,
} from './infrastructure/foundation';
import { AiModule } from './modules/ai/ai.module';
import { AuthModule } from './modules/auth/auth.module';
import { AutomationModule } from './modules/automation/automation.module';
import { DevicesModule } from './modules/devices/devices.module';
import { FilesModule } from './modules/files/files.module';
import { HealthModule } from './modules/health/health.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PermissionsModule } from './modules/permissions/permissions.module';
import { RolesModule } from './modules/roles/roles.module';
import { SettingsModule } from './modules/settings/settings.module';
import { ShoppingModule } from './modules/shopping/shopping.module';
import { SystemModule } from './modules/system/system.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { UsersModule } from './modules/users/users.module';
import { WorkflowsModule } from './modules/workflows/workflows.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [configuration],
      validate: validateEnvironment,
    }),
    ObservabilityModule,
    DatabaseModule.register(),
    NeutralFoundationModule.register(foundationModuleOptions()),
    HealthModule,
    AuthModule,
    UsersModule,
    RolesModule,
    PermissionsModule,
    FilesModule,
    NotificationsModule,
    AiModule,
    AutomationModule,
    DevicesModule,
    TasksModule,
    WorkflowsModule,
    SettingsModule,
    ShoppingModule,
    SystemModule,
  ],
  providers: [
    ApplicationLogger,
    RequestContextMiddleware,
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: RequestLoggingInterceptor },
    {
      provide: APP_INTERCEPTOR,
      useClass: ControllerPerformanceInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RequestContextMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}

function foundationModuleOptions(): NeutralFoundationModuleOptions {
  const runtime = configuration();
  return {
    databaseEnabled: runtime.database.enabled,
    allowInMemoryObjectStorage:
      runtime.app.nodeEnv !== 'production' &&
      !runtime.objectStorage.durablePrivateStorageRequired,
    durablePrivateStorageRequired:
      runtime.objectStorage.durablePrivateStorageRequired,
  };
}
