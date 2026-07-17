import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';
import { InstrumentedLayer, PerformanceTracker } from './performance-tracker';

const WRAPPED = Symbol('ai-pilot-observability-wrapped');
const SKIPPED_PROVIDERS = new Set([
  'ConfigService',
  'ModulesContainer',
  'RequestContextService',
  'StructuredLogger',
  'PerformanceTracker',
  'ProviderPerformanceInstrumentation',
]);
const SKIPPED_METHODS = new Set([
  'constructor',
  'onModuleInit',
  'onApplicationBootstrap',
  'onModuleDestroy',
  'beforeApplicationShutdown',
  'onApplicationShutdown',
]);

@Injectable()
export class ProviderPerformanceInstrumentation implements OnApplicationBootstrap {
  constructor(
    private readonly modules: ModulesContainer,
    private readonly tracker: PerformanceTracker,
  ) {}

  onApplicationBootstrap(): void {
    for (const moduleRef of this.modules.values()) {
      for (const wrapper of moduleRef.providers.values()) {
        const instance = wrapper.instance as object | undefined;
        const providerName = instance?.constructor.name;
        if (!instance || !providerName || SKIPPED_PROVIDERS.has(providerName))
          continue;
        const layer = resolveLayer(providerName);
        if (layer) this.wrapProviderMethods(instance, providerName, layer);
      }
    }
  }

  private wrapProviderMethods(
    instance: object,
    providerName: string,
    layer: InstrumentedLayer,
  ): void {
    let prototype = Object.getPrototypeOf(instance) as object | null;
    while (prototype && prototype !== Object.prototype) {
      for (const methodName of Object.getOwnPropertyNames(prototype)) {
        if (SKIPPED_METHODS.has(methodName) || methodName.startsWith('_'))
          continue;
        const descriptor = Object.getOwnPropertyDescriptor(
          prototype,
          methodName,
        );
        const original = descriptor?.value as
          ((...args: unknown[]) => unknown) | undefined;
        if (!original || typeof original !== 'function') continue;
        const marked = original as typeof original & { [WRAPPED]?: boolean };
        if (marked[WRAPPED]) continue;

        const tracker = this.tracker;
        const wrapped = function (this: object, ...args: unknown[]) {
          return tracker.track(layer, `${providerName}.${methodName}`, () =>
            original.apply(this, args),
          );
        };
        Object.defineProperty(wrapped, WRAPPED, { value: true });
        Object.defineProperty(instance, methodName, {
          configurable: true,
          value: wrapped,
          writable: true,
        });
      }
      prototype = Object.getPrototypeOf(prototype) as object | null;
    }
  }
}

function resolveLayer(providerName: string): InstrumentedLayer | undefined {
  if (/Repository$/.test(providerName)) return 'repository';
  if (/Service$/.test(providerName)) return 'service';
  return undefined;
}
