import { Injectable } from '@nestjs/common';
import {
  OrderedEventListener,
  OrderedEventPublisher,
  OrderedEventSubscription,
} from './ordered-event.publisher';
import { OrderedEvent } from './ordered-event.types';

@Injectable()
export class InProcessOrderedEventPublisher implements OrderedEventPublisher {
  private readonly listeners = new Map<string, Set<OrderedEventListener>>();

  publish(event: OrderedEvent): void {
    for (const listener of this.listeners.get(event.streamId) ?? []) {
      try {
        void Promise.resolve(listener(event)).catch(() => undefined);
      } catch {
        continue;
      }
    }
  }

  subscribe(
    streamId: string,
    listener: OrderedEventListener,
  ): OrderedEventSubscription {
    const listeners = this.listeners.get(streamId) ?? new Set();
    listeners.add(listener);
    this.listeners.set(streamId, listeners);
    return {
      unsubscribe: () => {
        listeners.delete(listener);
        if (listeners.size === 0) this.listeners.delete(streamId);
      },
    };
  }
}
