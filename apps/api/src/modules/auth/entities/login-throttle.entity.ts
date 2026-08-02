import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'authentication_login_throttles' })
export class LoginThrottle {
  @PrimaryColumn({ name: 'fingerprint', type: 'char', length: 64 })
  fingerprint!: string;

  @Column({ name: 'attempt_count', type: 'integer', default: 0 })
  attemptCount = 0;

  @Column({ name: 'window_started_at', type: 'timestamptz' })
  windowStartedAt!: Date;

  @Column({ name: 'locked_until', type: 'timestamptz', nullable: true })
  lockedUntil!: Date | null;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
