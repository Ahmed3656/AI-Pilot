import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'event_stream_sequences' })
export class EventStreamSequenceEntity {
  @PrimaryColumn({ name: 'stream_id', type: 'varchar', length: 128 })
  streamId!: string;

  @Column({ name: 'last_sequence', type: 'bigint', default: '0' })
  lastSequence!: string;

  @Column({
    name: 'retained_from',
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
  })
  retainedFrom!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
