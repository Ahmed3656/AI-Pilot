import { Column, Entity, Index, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { BaseEntity } from '../../../database/entities/base.entity';
import { ShoppingRun } from './shopping-run.entity';

@Entity({ name: 'shopping_run_events' })
@Unique('uq_shopping_run_events_run_event', ['runId', 'eventId'])
@Index(['runId', 'createdAt'])
export class RunEvent extends BaseEntity {
  @Column({ name: 'run_id', type: 'varchar', length: 26 })
  runId!: string;

  @ManyToOne(() => ShoppingRun, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'run_id' })
  run!: ShoppingRun;

  @Column({ name: 'event_id', type: 'varchar', length: 128 })
  eventId!: string;

  @Column({ type: 'varchar', length: 80 })
  type!: string;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  payload!: Record<string, unknown>;

  @Column({ name: 'observed_at', type: 'timestamptz' })
  observedAt!: Date;
}
