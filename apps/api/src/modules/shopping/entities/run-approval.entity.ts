import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../database/entities/base.entity';
import { ApprovalType } from '../shopping.types';
import { ShoppingRun } from './shopping-run.entity';

@Entity({ name: 'shopping_run_approvals' })
@Index(['runId', 'type'])
export class RunApproval extends BaseEntity {
  @Column({ name: 'run_id', type: 'varchar', length: 26 })
  runId!: string;

  @ManyToOne(() => ShoppingRun, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'run_id' })
  run!: ShoppingRun;

  @Column({
    type: 'enum',
    enum: ApprovalType,
    enumName: 'shopping_approval_type_enum',
  })
  type!: ApprovalType;

  @Column({
    name: 'recipient_domains',
    type: 'jsonb',
    default: () => "'[]'",
  })
  recipientDomains!: string[];

  @Column({ name: 'approved_at', type: 'timestamptz' })
  approvedAt!: Date;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  metadata!: Record<string, unknown>;
}
