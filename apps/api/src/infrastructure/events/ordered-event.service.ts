import { Inject, Injectable } from '@nestjs/common';
import {
  ORDERED_EVENT_PUBLISHER,
  OrderedEventPublisher,
} from './ordered-event.publisher';
import {
  ORDERED_EVENT_REPOSITORY,
  OrderedEventRepository,
} from './ordered-event.repository';
import {
  AppendOrderedEventInput,
  AppendOrderedEventResult,
  OrderedEventPage,
  PruneOrderedEventsInput,
  PruneOrderedEventsResult,
  ReadOrderedEventsInput,
} from './ordered-event.types';

@Injectable()
export class OrderedEventService {
  constructor(
    @Inject(ORDERED_EVENT_REPOSITORY)
    private readonly repository: OrderedEventRepository,
    @Inject(ORDERED_EVENT_PUBLISHER)
    private readonly publisher: OrderedEventPublisher,
  ) {}

  async append(
    input: AppendOrderedEventInput,
  ): Promise<AppendOrderedEventResult> {
    const result = await this.repository.append(input);
    if (!result.duplicate) this.publisher.publish(result.event);
    return result;
  }

  readPage(input: ReadOrderedEventsInput): Promise<OrderedEventPage> {
    return this.repository.readPage(input);
  }

  prune(input: PruneOrderedEventsInput): Promise<PruneOrderedEventsResult> {
    return this.repository.prune(input);
  }
}
