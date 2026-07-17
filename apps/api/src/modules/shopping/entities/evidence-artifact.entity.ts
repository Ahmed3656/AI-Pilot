import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../database/entities/base.entity';
import { ShoppingRun } from './shopping-run.entity';

@Entity({ name: 'shopping_evidence_artifacts' })
@Index(['runId', 'kind'])
export class EvidenceArtifact extends BaseEntity {
  @Column({ name: 'run_id', type: 'varchar', length: 26 })
  runId!: string;

  @ManyToOne(() => ShoppingRun, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'run_id' })
  run!: ShoppingRun;

  @Column({ type: 'varchar', length: 40 })
  kind!: string;

  @Column({ type: 'text' })
  uri!: string;

  @Column({ type: 'varchar', length: 64 })
  sha256!: string;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  metadata!: Record<string, unknown>;
}
