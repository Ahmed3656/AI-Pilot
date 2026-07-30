import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../database/entities/base.entity';

export type PasswordHashAlgorithm = 'argon2id' | 'legacy_scrypt';

@Entity({ name: 'password_credentials' })
@Index(['userId'], { unique: true })
export class PasswordCredential extends BaseEntity {
  @Column({ name: 'user_id', type: 'varchar', length: 26 })
  userId!: string;

  @Column({ type: 'varchar', length: 32 })
  algorithm!: PasswordHashAlgorithm;

  @Column({ name: 'password_hash', type: 'varchar', length: 512 })
  passwordHash!: string;

  @Column({
    name: 'legacy_salt',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  legacySalt!: string | null;
}
