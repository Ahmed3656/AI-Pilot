import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../database/entities/base.entity';
import { ShoppingRun } from './shopping-run.entity';

@Entity({ name: 'shopping_coupon_attempts' })
@Index(['runId', 'merchant'])
export class CouponAttempt extends BaseEntity {
  @Column({ name: 'run_id', type: 'varchar', length: 26 })
  runId!: string;

  @ManyToOne(() => ShoppingRun, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'run_id' })
  run!: ShoppingRun;

  @Column({ type: 'varchar', length: 120 })
  merchant!: string;

  @Column({ name: 'coupon_code', type: 'varchar', length: 80 })
  couponCode!: string;

  @Column({ type: 'varchar', length: 40 })
  status!: string;

  @Column({ name: 'before_total', type: 'numeric', precision: 12, scale: 2 })
  beforeTotal!: number;

  @Column({
    name: 'after_total',
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  afterTotal!: number | null;

  @Column({ name: 'evidence_ids', type: 'jsonb', default: () => "'[]'" })
  evidenceIds!: string[];
}
