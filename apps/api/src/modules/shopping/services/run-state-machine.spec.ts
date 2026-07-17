import { ShoppingRunState as S } from '../shopping.types';
import { RunStateMachine } from './run-state-machine';

describe('RunStateMachine', () => {
  const machine = new RunStateMachine();

  it('accepts canonical transitions and same-status idempotency', () => {
    expect(() =>
      machine.assertTransition(S.Discovering, S.AwaitingDomainApproval),
    ).not.toThrow();
    expect(() =>
      machine.assertTransition(S.Comparing, S.Comparing),
    ).not.toThrow();
    expect(() =>
      machine.assertTransition(S.Paused, S.Comparing, S.Comparing),
    ).not.toThrow();
  });

  it('allows paused runs to resume only to the stored status', () => {
    expect(() =>
      machine.assertTransition(S.Paused, S.Discovering, S.Comparing),
    ).toThrow('Invalid run transition');
  });

  it.each([S.Cancelled, S.Failed])(
    'allows paused runs to enter terminal state %s',
    (terminal) => {
      expect(() =>
        machine.assertTransition(S.Paused, terminal, S.Comparing),
      ).not.toThrow();
    },
  );

  it.each([S.Completed, S.Cancelled, S.Failed])(
    'keeps terminal state %s immutable',
    (terminal) => {
      expect(() => machine.assertTransition(terminal, S.Discovering)).toThrow(
        'Invalid run transition',
      );
    },
  );

  it('rejects the removed discovering-to-comparing shortcut', () => {
    expect(() => machine.assertTransition(S.Discovering, S.Comparing)).toThrow(
      'Invalid run transition',
    );
  });
});
