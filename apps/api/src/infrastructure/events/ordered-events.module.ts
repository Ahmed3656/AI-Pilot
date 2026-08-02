import { DynamicModule, Module, Provider } from '@nestjs/common';
import { getDataSourceToken, TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  EventStreamSequenceEntity,
  OrderedEventEntity,
  PrunedEventCursorEntity,
} from './entities';
import { InMemoryOrderedEventRepository } from './in-memory-ordered-event.repository';
import { InProcessOrderedEventPublisher } from './in-process-ordered-event.publisher';
import { ORDERED_EVENT_PUBLISHER } from './ordered-event.publisher';
import { ORDERED_EVENT_REPOSITORY } from './ordered-event.repository';
import { OrderedEventService } from './ordered-event.service';
import { TypeormOrderedEventRepository } from './typeorm-ordered-event.repository';

const entities = [
  EventStreamSequenceEntity,
  OrderedEventEntity,
  PrunedEventCursorEntity,
];
export interface OrderedEventsModuleOptions {
  databaseEnabled: boolean;
}

@Module({})
export class OrderedEventsModule {
  static register(options: OrderedEventsModuleOptions): DynamicModule {
    const repositoryProvider: Provider = options.databaseEnabled
      ? {
          provide: ORDERED_EVENT_REPOSITORY,
          useFactory: (dataSource: DataSource) =>
            new TypeormOrderedEventRepository(dataSource),
          inject: [getDataSourceToken()],
        }
      : {
          provide: ORDERED_EVENT_REPOSITORY,
          useClass: InMemoryOrderedEventRepository,
        };

    return {
      module: OrderedEventsModule,
      imports: options.databaseEnabled
        ? [TypeOrmModule.forFeature(entities)]
        : [],
      providers: [
        repositoryProvider,
        {
          provide: ORDERED_EVENT_PUBLISHER,
          useClass: InProcessOrderedEventPublisher,
        },
        OrderedEventService,
      ],
      exports: [
        ORDERED_EVENT_REPOSITORY,
        ORDERED_EVENT_PUBLISHER,
        OrderedEventService,
      ],
    };
  }
}
