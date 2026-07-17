import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../database/entities/base.entity';
import { PriceBreakdown, ShoppingCategory } from '../shopping.types';
import { ShoppingRun } from './shopping-run.entity';

@Entity({ name: 'shopping_normalized_offers' })
@Index(['runId', 'validity'])
export class NormalizedOffer extends BaseEntity {
  @Column({ name: 'run_id', type: 'varchar', length: 26 })
  runId!: string;

  @ManyToOne(() => ShoppingRun, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'run_id' })
  run!: ShoppingRun;

  @Column({ name: 'merchant_attempt_id', type: 'varchar', length: 128 })
  merchantAttemptId!: string;

  @Column({ name: 'merchant', type: 'varchar', length: 120 })
  merchantName!: string;

  @Column({ name: 'merchant_domain', type: 'varchar', length: 255 })
  merchantDomain!: string;

  @Column({ type: 'varchar', length: 16 })
  category!: ShoppingCategory;

  @Column({ type: 'text' })
  title!: string;

  @Column({ name: 'source_url', type: 'text' })
  sourceUrl!: string;

  @Column({ type: 'jsonb' })
  match!: { exact: boolean; confidence: number; explanation: string };

  @Column({ type: 'varchar', length: 16 })
  availability!: 'available' | 'unavailable' | 'unknown';

  @Column({ type: 'jsonb' })
  details!: Record<string, unknown>;

  @Column({ type: 'jsonb' })
  price!: PriceBreakdown;

  @Column({ type: 'varchar', length: 16 })
  validity!: 'valid' | 'excluded' | 'incomplete';

  @Column({ name: 'observed_at', type: 'timestamptz' })
  observedAt!: Date;

  @Column({ name: 'evidence_ids', type: 'jsonb', default: () => "'[]'::jsonb" })
  evidenceIds!: string[];

  @Column({ name: 'exclusion_reason', type: 'text', nullable: true })
  exclusionReason!: string | null;

  @Column({
    name: 'incomplete_fields',
    type: 'jsonb',
    default: () => "'[]'::jsonb",
  })
  incompleteFields!: string[];
}
