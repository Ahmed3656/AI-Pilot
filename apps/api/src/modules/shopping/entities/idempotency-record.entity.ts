import { Column, Entity, Index, Unique } from 'typeorm';
import { BaseEntity } from '../../../database/entities/base.entity';

@Entity({ name: 'shopping_idempotency_records' })
@Unique('uq_shopping_idempotency_scope', [
  'principalId',
  'method',
  'path',
  'key',
])
@Index(['expiresAt'])
export class IdempotencyRecord extends BaseEntity {
  @Column({ name: 'principal_id', type: 'varchar', length: 128 })
  principalId!: string;

  @Column({ type: 'varchar', length: 8 })
  method!: string;

  @Column({ type: 'varchar', length: 512 })
  path!: string;

  @Column({ type: 'varchar', length: 128 })
  key!: string;

  @Column({ name: 'request_hash', type: 'varchar', length: 64 })
  requestHash!: string;

  @Column({ type: 'jsonb' })
  response!: Record<string, unknown>;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;
}
