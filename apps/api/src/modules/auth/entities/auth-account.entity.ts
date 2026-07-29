import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../database/entities/base.entity';

@Entity({ name: 'auth_accounts' })
@Index(['email'], { unique: true })
export class AuthAccount extends BaseEntity {
  @Column({ type: 'varchar', length: 320 })
  email!: string;

  @Column({ name: 'display_name', type: 'varchar', length: 120 })
  displayName!: string;

  @Column({ name: 'password_salt', type: 'varchar', length: 64 })
  passwordSalt!: string;

  @Column({ name: 'password_hash', type: 'varchar', length: 128 })
  passwordHash!: string;

  @Column({ name: 'refresh_version', type: 'integer', default: 0 })
  refreshVersion = 0;
}
