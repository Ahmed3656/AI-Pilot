import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../database/entities/base.entity';

@Entity({ name: 'authentication_refresh_tokens' })
@Index(['tokenHash'], { unique: true })
@Index(['sessionId'])
@Index(['rotationFamilyId'])
export class RefreshToken extends BaseEntity {
  @Column({ name: 'session_id', type: 'varchar', length: 26 })
  sessionId!: string;

  @Column({ name: 'rotation_family_id', type: 'varchar', length: 26 })
  rotationFamilyId!: string;

  @Column({ name: 'token_hash', type: 'char', length: 64 })
  tokenHash!: string;

  @Column({ name: 'expires_at', type: 'timestamp' })
  expiresAt!: Date;

  @Column({ name: 'rotated_at', type: 'timestamp', nullable: true })
  rotatedAt!: Date | null;

  @Column({ name: 'revoked_at', type: 'timestamp', nullable: true })
  revokedAt!: Date | null;
}
