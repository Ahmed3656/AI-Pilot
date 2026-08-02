import { Column, Entity, Index } from 'typeorm';
import { UtcBaseEntity } from '../../../database/entities/utc-base.entity';

@Entity({ name: 'authentication_refresh_tokens' })
@Index(['tokenHash'], { unique: true })
@Index(['sessionId'])
@Index(['rotationFamilyId'])
export class RefreshToken extends UtcBaseEntity {
  @Column({ name: 'session_id', type: 'varchar', length: 26 })
  sessionId!: string;

  @Column({ name: 'rotation_family_id', type: 'varchar', length: 26 })
  rotationFamilyId!: string;

  @Column({ name: 'token_hash', type: 'char', length: 64 })
  tokenHash!: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'rotated_at', type: 'timestamptz', nullable: true })
  rotatedAt!: Date | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;
}
