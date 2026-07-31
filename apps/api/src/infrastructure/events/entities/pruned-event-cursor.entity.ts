import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  Unique,
} from 'typeorm';
import { EventStreamSequenceEntity } from './event-stream-sequence.entity';

@Entity({ name: 'pruned_event_cursors' })
@Unique('uq_pruned_event_cursors_stream_sequence', ['streamId', 'sequence'])
export class PrunedEventCursorEntity {
  @PrimaryColumn({ name: 'event_id', type: 'varchar', length: 128 })
  eventId!: string;

  @Column({ name: 'stream_id', type: 'varchar', length: 128 })
  streamId!: string;

  @ManyToOne(() => EventStreamSequenceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'stream_id' })
  stream!: EventStreamSequenceEntity;

  @Column({ type: 'bigint' })
  sequence!: string;

  @Column({
    name: 'content_fingerprint',
    type: 'char',
    length: 64,
  })
  contentFingerprint!: string;

  @CreateDateColumn({ name: 'pruned_at', type: 'timestamptz' })
  prunedAt!: Date;
}
