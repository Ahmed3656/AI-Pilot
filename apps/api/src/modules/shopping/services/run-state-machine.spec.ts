import { ConflictException } from '@nestjs/common';
import { RunStateMachine } from './run-state-machine';
import { ShoppingRunState } from '../shopping.types';

describe('RunStateMachine', () => {
  const machine = new RunStateMachine();

  it('allows an approval-driven progression', () => {
    expect(() =>
      machine.assertTransition(
        ShoppingRunState.Discovering,
        ShoppingRunState.AwaitingDomainApproval,
      ),
    ).not.toThrow();
    expect(() =>
      machine.assertTransition(
        ShoppingRunState.AwaitingDomainApproval,
        ShoppingRunState.Comparing,
      ),
    ).not.toThrow();
  });

  it('rejects invalid and terminal state transitions', () => {
    expect(() =>
      machine.assertTransition(
        ShoppingRunState.Discovering,
        ShoppingRunState.Completed,
      ),
    ).toThrow(ConflictException);
    expect(() =>
      machine.assertTransition(
        ShoppingRunState.Cancelled,
        ShoppingRunState.Discovering,
      ),
    ).toThrow(ConflictException);
  });
});
