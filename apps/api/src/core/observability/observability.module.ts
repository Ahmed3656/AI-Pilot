import { Global, Module } from '@nestjs/common';
import { RequestContextService } from '../request-context/request-context.service';
import { PerformanceTracker } from './performance-tracker';
import { ProviderPerformanceInstrumentation } from './provider-performance.instrumentation';
import { StructuredLogger } from './structured-logger';

@Global()
@Module({
  providers: [
    RequestContextService,
    StructuredLogger,
    PerformanceTracker,
    ProviderPerformanceInstrumentation,
  ],
  exports: [RequestContextService, StructuredLogger, PerformanceTracker],
})
export class ObservabilityModule {}
