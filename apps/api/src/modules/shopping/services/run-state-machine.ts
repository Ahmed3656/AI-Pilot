import { ConflictException, Injectable } from '@nestjs/common';
import { ShoppingRunState, TERMINAL_RUN_STATES } from '../shopping.types';

const TRANSITIONS: Readonly<
  Record<ShoppingRunState, readonly ShoppingRunState[]>
> = {
  [ShoppingRunState.Clarifying]: [
    ShoppingRunState.Discovering,
    ShoppingRunState.Paused,
    ShoppingRunState.Failed,
    ShoppingRunState.Cancelled,
  ],
  [ShoppingRunState.Discovering]: [
    ShoppingRunState.Clarifying,
    ShoppingRunState.AwaitingDomainApproval,
    ShoppingRunState.Comparing,
    ShoppingRunState.Paused,
    ShoppingRunState.Failed,
    ShoppingRunState.Cancelled,
  ],
  [ShoppingRunState.AwaitingDomainApproval]: [
    ShoppingRunState.Discovering,
    ShoppingRunState.Comparing,
    ShoppingRunState.Paused,
    ShoppingRunState.Failed,
    ShoppingRunState.Cancelled,
  ],
  [ShoppingRunState.Comparing]: [
    ShoppingRunState.AwaitingDomainApproval,
    ShoppingRunState.AwaitingAddressConsent,
    ShoppingRunState.AwaitingSeatHoldApproval,
    ShoppingRunState.CouponTesting,
    ShoppingRunState.ReadyForHandoff,
    ShoppingRunState.Paused,
    ShoppingRunState.Failed,
    ShoppingRunState.Cancelled,
  ],
  [ShoppingRunState.AwaitingAddressConsent]: [
    ShoppingRunState.Comparing,
    ShoppingRunState.Paused,
    ShoppingRunState.Failed,
    ShoppingRunState.Cancelled,
  ],
  [ShoppingRunState.AwaitingSeatHoldApproval]: [
    ShoppingRunState.Comparing,
    ShoppingRunState.Paused,
    ShoppingRunState.Failed,
    ShoppingRunState.Cancelled,
  ],
  [ShoppingRunState.CouponTesting]: [
    ShoppingRunState.Comparing,
    ShoppingRunState.ReadyForHandoff,
    ShoppingRunState.Paused,
    ShoppingRunState.Failed,
    ShoppingRunState.Cancelled,
  ],
  [ShoppingRunState.ReadyForHandoff]: [
    ShoppingRunState.UserTakeover,
    ShoppingRunState.Completed,
    ShoppingRunState.Paused,
    ShoppingRunState.Failed,
    ShoppingRunState.Cancelled,
  ],
  [ShoppingRunState.UserTakeover]: [
    ShoppingRunState.ReadyForHandoff,
    ShoppingRunState.Completed,
    ShoppingRunState.Paused,
    ShoppingRunState.Failed,
    ShoppingRunState.Cancelled,
  ],
  [ShoppingRunState.Paused]: Object.values(ShoppingRunState).filter(
    (state) =>
      state !== ShoppingRunState.Paused && !TERMINAL_RUN_STATES.has(state),
  ),
  [ShoppingRunState.Completed]: [],
  [ShoppingRunState.Failed]: [],
  [ShoppingRunState.Cancelled]: [],
};

@Injectable()
export class RunStateMachine {
  assertTransition(from: ShoppingRunState, to: ShoppingRunState): void {
    if (from === to) return;
    if (!TRANSITIONS[from].includes(to)) {
      throw new ConflictException(
        `Invalid shopping run state transition: ${from} -> ${to}`,
      );
    }
  }
}
