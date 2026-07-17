import { Column, Entity, Index, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { BaseEntity } from '../../../database/entities/base.entity';
import { EventType, ShoppingRunState } from '../shopping.types';
import { ShoppingRun } from './shopping-run.entity';

@Entity({ name: 'shopping_run_events' })
@Unique('uq_shopping_run_events_event_id', ['eventId'])
@Index(['runId', 'sequence'])
export class RunEvent extends BaseEntity {
  @Column({ name: 'run_id', type: 'varchar', length: 26 })
  runId!: string;

  @ManyToOne(() => ShoppingRun, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'run_id' })
  run!: ShoppingRun;

  @Column({ name: 'event_id', type: 'varchar', length: 128 })
  eventId!: string;

  @Column({ type: 'bigint', generated: 'increment' })
  sequence!: string;

  @Column({ type: 'varchar', length: 80 })
  type!: EventType;

  @Column({ type: 'varchar', length: 40 })
  status!: ShoppingRunState;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  payload!: Record<string, unknown>;

  @Column({ name: 'observed_at', type: 'timestamptz' })
  timestamp!: Date;
}
