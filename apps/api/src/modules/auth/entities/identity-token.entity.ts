import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../database/entities/base.entity';

export type IdentityTokenPurpose = 'email_verification' | 'password_recovery';

@Entity({ name: 'identity_one_time_tokens' })
@Index(['tokenHash'], { unique: true })
@Index(['userId', 'purpose'])
export class IdentityToken extends BaseEntity {
  @Column({ name: 'user_id', type: 'varchar', length: 26 })
  userId!: string;

  @Column({ type: 'varchar', length: 32 })
  purpose!: IdentityTokenPurpose;

  @Column({ name: 'token_hash', type: 'char', length: 64 })
  tokenHash!: string;

  @Column({ name: 'expires_at', type: 'timestamp' })
  expiresAt!: Date;

  @Column({ name: 'consumed_at', type: 'timestamp', nullable: true })
  consumedAt!: Date | null;

  @Column({ name: 'revoked_at', type: 'timestamp', nullable: true })
  revokedAt!: Date | null;
}
