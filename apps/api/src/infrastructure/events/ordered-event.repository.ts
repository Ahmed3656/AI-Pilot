import type { PersistenceTransaction } from '../../database/persistence-transaction';
import {
  AppendOrderedEventInput,
  AppendOrderedEventResult,
  OrderedEventPage,
  PruneOrderedEventsInput,
  PruneOrderedEventsResult,
  ReadOrderedEventsInput,
} from './ordered-event.types';

export const ORDERED_EVENT_REPOSITORY = Symbol('ORDERED_EVENT_REPOSITORY');

export interface OrderedEventRepository {
  append(
    input: AppendOrderedEventInput,
    transaction?: PersistenceTransaction,
  ): Promise<AppendOrderedEventResult>;
  readPage(input: ReadOrderedEventsInput): Promise<OrderedEventPage>;
  prune(input: PruneOrderedEventsInput): Promise<PruneOrderedEventsResult>;
}
