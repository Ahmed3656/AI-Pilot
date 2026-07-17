import { Check, Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../database/entities/base.entity';
import {
  PendingAction,
  RequestedCategory,
  ShoppingCategory,
  ShoppingRunState,
  SupportedLocale,
} from '../shopping.types';

@Entity({ name: 'shopping_runs' })
@Index(['userId', 'status'])
@Check('chk_shopping_runs_market_eg', `"market" = 'EG'`)
@Check('chk_shopping_runs_currency_egp', `"currency" = 'EGP'`)
@Check('chk_shopping_runs_timezone_cairo', `"timezone" = 'Africa/Cairo'`)
export class ShoppingRun extends BaseEntity {
  @Column({ name: 'user_id', type: 'varchar', length: 128 })
  userId!: string;

  @Column({ name: 'requested_category', type: 'varchar', length: 16 })
  requestedCategory!: RequestedCategory;

  @Column({
    type: 'enum',
    enum: ShoppingCategory,
    enumName: 'shopping_run_category_enum',
    nullable: true,
  })
  category!: ShoppingCategory | null;

  @Column({ type: 'varchar', length: 2, default: 'EG' })
  market = 'EG' as const;

  @Column({ type: 'varchar', length: 3, default: 'EGP' })
  currency = 'EGP' as const;

  @Column({ type: 'varchar', length: 32, default: 'Africa/Cairo' })
  timezone = 'Africa/Cairo' as const;

  @Column({ type: 'varchar', length: 5 })
  locale!: SupportedLocale;

  @Column({
    name: 'state',
    type: 'enum',
    enum: ShoppingRunState,
    enumName: 'shopping_run_state_enum',
  })
  status!: ShoppingRunState;

  @Column({
    name: 'resume_state',
    type: 'enum',
    enum: ShoppingRunState,
    enumName: 'shopping_run_state_enum',
    nullable: true,
  })
  resumeStatus!: ShoppingRunState | null;

  @Column({ type: 'text' })
  query!: string;

  @Column({ name: 'pending_action', type: 'jsonb', nullable: true })
  pendingAction!: PendingAction | null;

  @Column({ type: 'jsonb', nullable: true })
  failure!: { code: string; message: string } | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @Column({ name: 'browser_expires_at', type: 'timestamptz' })
  browserExpiresAt!: Date;

  @Column({
    name: 'last_event_id',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  lastEventId!: string | null;
}
