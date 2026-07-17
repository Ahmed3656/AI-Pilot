import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../database/entities/base.entity';
import { ShoppingRun } from './shopping-run.entity';

@Entity({ name: 'shopping_merchant_attempts' })
@Index(['runId', 'merchantDomain'])
export class MerchantAttempt extends BaseEntity {
  @Column({ name: 'run_id', type: 'varchar', length: 26 })
  runId!: string;

  @ManyToOne(() => ShoppingRun, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'run_id' })
  run!: ShoppingRun;

  @Column({ type: 'varchar', length: 120 })
  merchant!: string;

  @Column({ name: 'merchant_domain', type: 'varchar', length: 255 })
  merchantDomain!: string;

  @Column({ type: 'varchar', length: 40 })
  status!: string;

  @Column({ name: 'error_code', type: 'varchar', length: 80, nullable: true })
  errorCode!: string | null;

  @Column({ name: 'started_at', type: 'timestamptz' })
  startedAt!: Date;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt!: Date | null;
}
