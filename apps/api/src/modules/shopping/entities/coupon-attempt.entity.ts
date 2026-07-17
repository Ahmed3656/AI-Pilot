import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../database/entities/base.entity';
import { ShoppingRun } from './shopping-run.entity';

@Entity({ name: 'shopping_coupon_attempts' })
@Index(['runId', 'offerId'])
export class CouponAttempt extends BaseEntity {
  @Column({ name: 'run_id', type: 'varchar', length: 26 })
  runId!: string;

  @ManyToOne(() => ShoppingRun, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'run_id' })
  run!: ShoppingRun;

  @Column({ name: 'offer_id', type: 'varchar', length: 128 })
  offerId!: string;

  @Column({ name: 'merchant_domain', type: 'varchar', length: 255 })
  merchantDomain!: string;

  @Column({ name: 'coupon_code', type: 'varchar', length: 80 })
  code!: string;

  @Column({ name: 'source_url', type: 'text' })
  sourceUrl!: string;

  @Column({ type: 'varchar', length: 32 })
  status!: string;

  @Column({ name: 'before_total', type: 'numeric', precision: 12, scale: 2 })
  beforeTotal!: string;

  @Column({
    name: 'after_total',
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  afterTotal!: string | null;

  @Column({
    name: 'verified_discount',
    type: 'numeric',
    precision: 12,
    scale: 2,
  })
  verifiedDiscount!: string;

  @Column({
    name: 'rejection_reason',
    type: 'varchar',
    length: 40,
    nullable: true,
  })
  rejectionReason!: string | null;

  @Column({ type: 'text', nullable: true })
  message!: string | null;

  @Column({ name: 'attempted_at', type: 'timestamptz' })
  attemptedAt!: Date;

  @Column({ name: 'evidence_ids', type: 'jsonb', default: () => "'[]'::jsonb" })
  evidenceIds!: string[];
}
