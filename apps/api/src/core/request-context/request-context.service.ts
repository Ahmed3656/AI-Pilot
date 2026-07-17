import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';

export interface RequestContext {
  requestId: string;
  method: string;
  route: string;
  startedAtEpochMs: number;
  queryCount: number;
  slowQueryCount: number;
  queryFingerprints: Map<string, number>;
  reportedNPlusOne: Set<string>;
}

@Injectable()
export class RequestContextService {
  private readonly storage = new AsyncLocalStorage<RequestContext>();

  run<T>(context: RequestContext, callback: () => T): T {
    return this.storage.run(context, callback);
  }

  get requestId(): string | undefined {
    return this.storage.getStore()?.requestId;
  }

  get current(): RequestContext | undefined {
    return this.storage.getStore();
  }

  recordQuery(fingerprint: string, slow: boolean): number {
    const context = this.current;
    if (!context) return 0;
    context.queryCount += 1;
    if (slow) context.slowQueryCount += 1;
    const count = (context.queryFingerprints.get(fingerprint) ?? 0) + 1;
    context.queryFingerprints.set(fingerprint, count);
    return count;
  }
}
