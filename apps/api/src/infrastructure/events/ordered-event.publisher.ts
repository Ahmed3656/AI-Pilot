import { OrderedEvent } from './ordered-event.types';

export const ORDERED_EVENT_PUBLISHER = Symbol('ORDERED_EVENT_PUBLISHER');

export interface OrderedEventPublisher {
  publish(event: OrderedEvent): void;
}

export type OrderedEventListener = (
  event: OrderedEvent,
) => void | Promise<void>;

export interface OrderedEventSubscription {
  unsubscribe(): void;
}
