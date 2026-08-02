import type { EntityManager } from 'typeorm';

export type PersistenceTransactionEffect = () => void | Promise<void>;

export interface PersistenceTransaction {
  readonly manager?: EntityManager;
  afterCommit(effect: PersistenceTransactionEffect): void;
  afterRollback(effect: PersistenceTransactionEffect): void;
}

export class PersistenceTransactionLifecycle implements PersistenceTransaction {
  private readonly commitEffects: PersistenceTransactionEffect[] = [];
  private readonly rollbackEffects: PersistenceTransactionEffect[] = [];
  private state: 'active' | 'committed' | 'rolled_back' = 'active';

  constructor(readonly manager?: EntityManager) {}

  afterCommit(effect: PersistenceTransactionEffect): void {
    this.assertActive();
    this.commitEffects.push(effect);
  }

  afterRollback(effect: PersistenceTransactionEffect): void {
    this.assertActive();
    this.rollbackEffects.push(effect);
  }

  async commit(): Promise<void> {
    this.assertActive();
    this.state = 'committed';
    this.rollbackEffects.length = 0;
    // Once persistence committed, observer failure cannot change the durable outcome.
    for (const effect of this.commitEffects) {
      try {
        await effect();
      } catch {
        continue;
      }
    }
    this.commitEffects.length = 0;
  }

  async rollback(): Promise<void> {
    if (this.state !== 'active') return;
    this.state = 'rolled_back';
    this.commitEffects.length = 0;
    let failure: Error | undefined;
    for (const effect of this.rollbackEffects.reverse()) {
      try {
        await effect();
      } catch (error) {
        failure ??=
          error instanceof Error
            ? error
            : new Error('Persistence rollback effect failed', {
                cause: error,
              });
      }
    }
    this.rollbackEffects.length = 0;
    if (failure) throw failure;
  }

  private assertActive(): void {
    if (this.state !== 'active')
      throw new Error('Persistence transaction is no longer active');
  }
}

export function isPersistenceTransaction(
  value: unknown,
): value is PersistenceTransaction {
  return Boolean(
    value &&
    typeof value === 'object' &&
    'afterCommit' in value &&
    typeof value.afterCommit === 'function' &&
    'afterRollback' in value &&
    typeof value.afterRollback === 'function',
  );
}
