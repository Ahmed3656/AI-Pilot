import { PersistenceTransactionLifecycle } from './persistence-transaction';

describe('PersistenceTransactionLifecycle', () => {
  it('runs commit effects only after commit', async () => {
    const transaction = new PersistenceTransactionLifecycle();
    const effect = jest.fn();

    transaction.afterCommit(effect);
    expect(effect).not.toHaveBeenCalled();

    await transaction.commit();
    expect(effect).toHaveBeenCalledTimes(1);
  });

  it('rolls participants back in reverse write order', async () => {
    const transaction = new PersistenceTransactionLifecycle();
    const order: string[] = [];

    transaction.afterRollback(() => {
      order.push('first');
    });
    transaction.afterRollback(() => {
      order.push('second');
    });
    await transaction.rollback();

    expect(order).toEqual(['second', 'first']);
  });

  it('contains observer failures after the durable commit', async () => {
    const transaction = new PersistenceTransactionLifecycle();
    const delivered = jest.fn();

    transaction.afterCommit(() => {
      throw new Error('subscriber failed');
    });
    transaction.afterCommit(delivered);

    await expect(transaction.commit()).resolves.toBeUndefined();
    expect(delivered).toHaveBeenCalledTimes(1);
  });
});
