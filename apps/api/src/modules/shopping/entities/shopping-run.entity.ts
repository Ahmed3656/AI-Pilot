import { Check, Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../database/entities/base.entity';
import { ShoppingCategory, ShoppingRunState } from '../shopping.types';

@Entity({ name: 'shopping_runs' })
@Index(['state'])
@Check('chk_shopping_runs_market_eg', `"market" = 'EG'`)
@Check('chk_shopping_runs_currency_egp', `"currency" = 'EGP'`)
export class ShoppingRun extends BaseEntity {
  @Column({
    type: 'enum',
    enum: ShoppingCategory,
    enumName: 'shopping_run_category_enum',
  })
  category!: ShoppingCategory;

  @Column({ type: 'varchar', length: 2, default: 'EG' })
  market = 'EG' as const;

  @Column({ type: 'varchar', length: 3, default: 'EGP' })
  currency = 'EGP' as const;

  @Column({
    type: 'enum',
    enum: ShoppingRunState,
    enumName: 'shopping_run_state_enum',
  })
  state!: ShoppingRunState;

  @Column({
    name: 'resume_state',
    type: 'enum',
    enum: ShoppingRunState,
    enumName: 'shopping_run_state_enum',
    nullable: true,
  })
  resumeState!: ShoppingRunState | null;

  @Column({ type: 'text' })
  query!: string;

  @Column({ name: 'ai_run_id', type: 'varchar', length: 128, nullable: true })
  aiRunId!: string | null;

  @Column({ name: 'failure_code', type: 'varchar', length: 80, nullable: true })
  failureCode!: string | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;
}
