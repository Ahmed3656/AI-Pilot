import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../database/entities/base.entity';
import { ShoppingCategory } from '../shopping.types';
import { ShoppingRun } from './shopping-run.entity';

const moneyColumn = {
  type: 'numeric' as const,
  precision: 12,
  scale: 2,
  transformer: {
    to: (value: number | null) => value,
    from: (value: string | null) => (value === null ? null : Number(value)),
  },
};

@Entity({ name: 'shopping_normalized_offers' })
@Index(['runId', 'finalTotal'])
@Check('chk_shopping_normalized_offers_currency_egp', `"currency" = 'EGP'`)
export class NormalizedOffer extends BaseEntity {
  @Column({ name: 'run_id', type: 'varchar', length: 26 })
  runId!: string;

  @ManyToOne(() => ShoppingRun, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'run_id' })
  run!: ShoppingRun;

  @Column({ type: 'varchar', length: 120 })
  merchant!: string;

  @Column({
    type: 'enum',
    enum: ShoppingCategory,
    enumName: 'shopping_offer_category_enum',
  })
  category!: ShoppingCategory;

  @Column({ type: 'text' })
  title!: string;

  @Column({ name: 'source_url', type: 'text' })
  sourceUrl!: string;

  @Column({ type: 'varchar', length: 3, default: 'EGP' })
  currency = 'EGP' as const;

  @Column({ ...moneyColumn, name: 'base_price' })
  basePrice!: number;

  @Column({ ...moneyColumn, name: 'delivery_fee', nullable: true })
  deliveryFee!: number | null;

  @Column({ ...moneyColumn, name: 'service_fee', nullable: true })
  serviceFee!: number | null;

  @Column({ ...moneyColumn, name: 'tax', nullable: true })
  tax!: number | null;

  @Column({ ...moneyColumn, name: 'discount', nullable: true })
  discount!: number | null;

  @Column({ ...moneyColumn, name: 'final_total' })
  finalTotal!: number;

  @Column({ name: 'coupon_code', type: 'varchar', length: 80, nullable: true })
  couponCode!: string | null;

  @Column({ type: 'varchar', length: 80 })
  availability!: string;

  @Column({ name: 'observed_at', type: 'timestamptz' })
  observedAt!: Date;

  @Column({ name: 'evidence_ids', type: 'jsonb', default: () => "'[]'" })
  evidenceIds!: string[];

  @Column({ name: 'match_confidence', type: 'real' })
  matchConfidence!: number;

  @Column({ name: 'incomplete_reason', type: 'text', nullable: true })
  incompleteReason!: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  details!: Record<string, unknown>;
}
