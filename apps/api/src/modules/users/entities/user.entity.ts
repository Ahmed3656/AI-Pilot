import { Column, Entity, Index } from 'typeorm';
import { UtcBaseEntity } from '../../../database/entities/utc-base.entity';

export type UserStatus = 'pending_verification' | 'active' | 'disabled';

@Entity({ name: 'users' })
@Index(['email'], { unique: true })
export class User extends UtcBaseEntity {
  @Column({ type: 'varchar', length: 320 })
  email!: string;

  @Column({ name: 'display_name', type: 'varchar', length: 120 })
  displayName!: string;

  @Column({ type: 'varchar', length: 32, default: 'pending_verification' })
  status: UserStatus = 'pending_verification';

  @Column({ name: 'email_verified_at', type: 'timestamptz', nullable: true })
  emailVerifiedAt!: Date | null;

  @Column({ type: 'varchar', length: 35, default: 'en' })
  locale = 'en';

  @Column({ type: 'varchar', length: 64, default: 'UTC' })
  timezone = 'UTC';
}
