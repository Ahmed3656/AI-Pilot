import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../database/entities/base.entity';

export type AuthenticationSessionStatus = 'active' | 'revoked' | 'expired';

@Entity({ name: 'authentication_sessions' })
@Index(['principalId'])
@Index(['rotationFamilyId'])
export class AuthenticationSession extends BaseEntity {
  @Column({ name: 'principal_id', type: 'varchar', length: 26 })
  principalId!: string;

  @Column({ type: 'varchar', length: 16, default: 'active' })
  status: AuthenticationSessionStatus = 'active';

  @Column({ name: 'rotation_family_id', type: 'varchar', length: 26 })
  rotationFamilyId!: string;

  @Column({ name: 'issued_at', type: 'timestamp' })
  issuedAt!: Date;

  @Column({ name: 'expires_at', type: 'timestamp' })
  expiresAt!: Date;

  @Column({ name: 'revoked_at', type: 'timestamp', nullable: true })
  revokedAt!: Date | null;

  @Column({
    name: 'revocation_reason',
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  revocationReason!: string | null;
}
