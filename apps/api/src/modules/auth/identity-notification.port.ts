import { Injectable } from '@nestjs/common';

export const IDENTITY_NOTIFICATION_PORT = Symbol('IDENTITY_NOTIFICATION_PORT');

export type IdentityNotification =
  | {
      kind: 'email_verification';
      email: string;
      displayName: string;
      token: string;
    }
  | {
      kind: 'password_recovery';
      email: string;
      displayName: string;
      token: string;
    };

export interface IdentityNotificationPort {
  deliver(notification: IdentityNotification): Promise<void>;
}

@Injectable()
export class UnavailableIdentityNotificationAdapter implements IdentityNotificationPort {
  deliver(): Promise<void> {
    return Promise.resolve();
  }
}

export class TestIdentityNotificationAdapter implements IdentityNotificationPort {
  readonly notifications: IdentityNotification[] = [];

  deliver(notification: IdentityNotification): Promise<void> {
    this.notifications.push(notification);
    return Promise.resolve();
  }

  latest(kind: IdentityNotification['kind']): IdentityNotification | null {
    return (
      [...this.notifications].reverse().find((item) => item.kind === kind) ??
      null
    );
  }
}
