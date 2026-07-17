import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../database/entities/base.entity';
import { ShoppingCategory } from '../shopping.types';
import { ShoppingRun } from './shopping-run.entity';

@Entity({ name: 'shopping_merchant_attempts' })
@Index(['runId', 'merchantDomain'])
export class MerchantAttempt extends BaseEntity {
  @Column({ name: 'run_id', type: 'varchar', length: 26 })
  runId!: string;

  @ManyToOne(() => ShoppingRun, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'run_id' })
  run!: ShoppingRun;

  @Column({ name: 'merchant_id', type: 'varchar', length: 128 })
  merchantId!: string;

  @Column({ name: 'merchant', type: 'varchar', length: 120 })
  merchantName!: string;

  @Column({ name: 'merchant_domain', type: 'varchar', length: 255 })
  merchantDomain!: string;

  @Column({ type: 'varchar', length: 16 })
  category!: ShoppingCategory;

  @Column({ name: 'status', type: 'varchar', length: 32 })
  outcome!: string;

  @Column({ name: 'error_code', type: 'varchar', length: 80, nullable: true })
  failureCode!: string | null;

  @Column({ type: 'text', nullable: true })
  message!: string | null;

  @Column({ name: 'evidence_ids', type: 'jsonb', default: () => "'[]'::jsonb" })
  evidenceIds!: string[];

  @Column({ name: 'started_at', type: 'timestamptz' })
  startedAt!: Date;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt!: Date | null;
}
