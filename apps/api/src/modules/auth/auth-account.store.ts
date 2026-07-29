import { Injectable } from '@nestjs/common';
import { DeepPartial, Repository } from 'typeorm';
import { AuthAccount } from './entities/auth-account.entity';

export const AUTH_ACCOUNT_STORE = Symbol('AUTH_ACCOUNT_STORE');

export interface AuthAccountStore {
  findByEmail(email: string): Promise<AuthAccount | null>;
  findById(id: string): Promise<AuthAccount | null>;
  save(account: DeepPartial<AuthAccount>): Promise<AuthAccount>;
}

@Injectable()
export class InMemoryAuthAccountStore implements AuthAccountStore {
  private readonly accounts = new Map<string, AuthAccount>();

  findByEmail(email: string): Promise<AuthAccount | null> {
    return Promise.resolve(
      [...this.accounts.values()].find((item) => item.email === email) ?? null,
    );
  }

  findById(id: string): Promise<AuthAccount | null> {
    return Promise.resolve(this.accounts.get(id) ?? null);
  }

  save(value: DeepPartial<AuthAccount>): Promise<AuthAccount> {
    const account = Object.assign(
      value.id
        ? (this.accounts.get(String(value.id)) ?? new AuthAccount())
        : new AuthAccount(),
      value,
    );
    account.createdAt ??= new Date();
    account.updatedAt = new Date();
    account.deletedAt ??= null;
    this.accounts.set(account.id, account);
    return Promise.resolve(account);
  }
}

export class TypeormAuthAccountStore implements AuthAccountStore {
  constructor(private readonly accounts: Repository<AuthAccount>) {}

  findByEmail(email: string): Promise<AuthAccount | null> {
    return this.accounts.findOneBy({ email });
  }

  findById(id: string): Promise<AuthAccount | null> {
    return this.accounts.findOneBy({ id });
  }

  save(value: DeepPartial<AuthAccount>): Promise<AuthAccount> {
    return this.accounts.save(this.accounts.create(value));
  }
}
