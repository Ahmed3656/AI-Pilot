import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  Unique,
} from 'typeorm';
import { JsonValue } from '../ordered-event.types';
import { EventStreamSequenceEntity } from './event-stream-sequence.entity';

@Entity({ name: 'ordered_events' })
@Unique('uq_ordered_events_stream_sequence', ['streamId', 'sequence'])
@Index('idx_ordered_events_retention', ['retainUntil'])
export class OrderedEventEntity {
  @PrimaryColumn({ name: 'event_id', type: 'varchar', length: 128 })
  eventId!: string;

  @Column({ name: 'stream_id', type: 'varchar', length: 128 })
  streamId!: string;

  @ManyToOne(() => EventStreamSequenceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'stream_id' })
  stream!: EventStreamSequenceEntity;

  @Column({ type: 'bigint' })
  sequence!: string;

  @Column({ name: 'event_type', type: 'varchar', length: 120 })
  type!: string;

  @Column({ name: 'schema_version', type: 'varchar', length: 40 })
  schemaVersion!: string;

  @Column({
    name: 'actor_type',
    type: 'varchar',
    length: 80,
    nullable: true,
  })
  actorType!: string | null;

  @Column({ name: 'safe_payload', type: 'jsonb' })
  payload!: Readonly<Record<string, JsonValue>>;

  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt!: Date;

  @CreateDateColumn({ name: 'persisted_at', type: 'timestamptz' })
  persistedAt!: Date;

  @Column({
    name: 'correlation_id',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  correlationId!: string | null;

  @Column({
    name: 'content_fingerprint',
    type: 'char',
    length: 64,
  })
  contentFingerprint!: string;

  @Column({ name: 'retention_class', type: 'varchar', length: 40 })
  retentionClass!: string;

  @Column({ name: 'retain_until', type: 'timestamptz', nullable: true })
  retainUntil!: Date | null;
}
