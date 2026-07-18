import { Injectable } from '@nestjs/common';
import { ContractException } from '../../../core/filters/contract-exception';
import { ShoppingRunState } from '../shopping.types';

const S = ShoppingRunState;
const TRANSITIONS: Readonly<
  Record<ShoppingRunState, readonly ShoppingRunState[]>
> = {
  [S.Clarifying]: [S.Discovering, S.Paused, S.Cancelled, S.Failed],
  [S.Discovering]: [
    S.Clarifying,
    S.AwaitingDomainApproval,
    S.Paused,
    S.Cancelled,
    S.Failed,
  ],
  [S.AwaitingDomainApproval]: [
    S.Discovering,
    S.Comparing,
    S.Paused,
    S.Cancelled,
    S.Failed,
  ],
  [S.Comparing]: [
    S.AwaitingDomainApproval,
    S.AwaitingAddressConsent,
    S.AwaitingSeatHoldApproval,
    S.CouponTesting,
    S.ReadyForHandoff,
    S.Paused,
    S.Cancelled,
    S.Failed,
  ],
  [S.AwaitingAddressConsent]: [S.Comparing, S.Paused, S.Cancelled, S.Failed],
  [S.AwaitingSeatHoldApproval]: [S.Comparing, S.Paused, S.Cancelled, S.Failed],
  [S.CouponTesting]: [
    S.Comparing,
    S.ReadyForHandoff,
    S.Paused,
    S.Cancelled,
    S.Failed,
  ],
  [S.ReadyForHandoff]: [
    S.UserTakeover,
    S.Paused,
    S.Completed,
    S.Cancelled,
    S.Failed,
  ],
  [S.UserTakeover]: [S.ReadyForHandoff, S.Completed, S.Cancelled, S.Failed],
  [S.Paused]: [S.UserTakeover, S.Cancelled, S.Failed],
  [S.Completed]: [],
  [S.Cancelled]: [],
  [S.Failed]: [],
};

@Injectable()
export class RunStateMachine {
  assertTransition(
    from: ShoppingRunState,
    to: ShoppingRunState,
    resumeStatus?: ShoppingRunState | null,
  ): void {
    if (from === to) return;
    const allowed =
      from === S.Paused || from === S.UserTakeover
        ? resumeStatus === to || TRANSITIONS[from].includes(to)
        : TRANSITIONS[from].includes(to);
    if (!allowed) {
      throw new ContractException(
        'INVALID_RUN_TRANSITION',
        409,
        `Invalid run transition from ${from} to ${to}`,
      );
    }
  }
}
