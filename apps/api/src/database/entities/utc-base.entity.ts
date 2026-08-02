import {
  CreateDateColumn,
  DeleteDateColumn,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ulid } from 'ulid';

/**
 * New platform foundations store instants with timezone semantics. The legacy
 * BaseEntity remains unchanged until shopping receives its own migration.
 */
export abstract class UtcBaseEntity {
  @PrimaryColumn('varchar', { length: 26 })
  id: string = ulid();

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
