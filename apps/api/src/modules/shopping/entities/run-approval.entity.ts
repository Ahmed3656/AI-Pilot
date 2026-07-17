import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../database/entities/base.entity';
import { ApprovalStatus, ApprovalType } from '../shopping.types';
import { ShoppingRun } from './shopping-run.entity';

@Entity({ name: 'shopping_run_approvals' })
@Index(['runId', 'type'])
export class RunApproval extends BaseEntity {
  @Column({ name: 'run_id', type: 'varchar', length: 26 })
  runId!: string;

  @ManyToOne(() => ShoppingRun, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'run_id' })
  run!: ShoppingRun;

  @Column({ name: 'request_id', type: 'varchar', length: 128 })
  requestId!: string;

  @Column({
    type: 'enum',
    enum: ApprovalType,
    enumName: 'shopping_approval_type_enum',
  })
  type!: ApprovalType;

  @Column({
    name: 'recipient_domains',
    type: 'jsonb',
    default: () => "'[]'::jsonb",
  })
  merchantDomains!: string[];

  @Column({ name: 'offer_id', type: 'varchar', length: 128, nullable: true })
  offerId!: string | null;

  @Column({ type: 'varchar', length: 16, default: ApprovalStatus.Approved })
  status!: ApprovalStatus;

  @Column({ name: 'approved_at', type: 'timestamptz' })
  approvedAt!: Date;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt!: Date | null;
}
