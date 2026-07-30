export type OrderedEventErrorCode =
  | 'EVENT_CURSOR_EXPIRED'
  | 'EVENT_ID_CONFLICT'
  | 'EVENT_INPUT_INVALID'
  | 'EVENT_PAYLOAD_FORBIDDEN'
  | 'EVENT_PAYLOAD_TOO_LARGE';

export class OrderedEventError extends Error {
  constructor(
    readonly code: OrderedEventErrorCode,
    message: string,
    readonly metadata: Readonly<Record<string, string | null>> = {},
  ) {
    super(message);
    this.name = 'OrderedEventError';
  }
}

export function eventIdConflict(eventId: string): OrderedEventError {
  return new OrderedEventError(
    'EVENT_ID_CONFLICT',
    'Event ID was reused with different content',
    { eventId },
  );
}

export function unknownCursor(cursor: string): OrderedEventError {
  return new OrderedEventError(
    'EVENT_ID_CONFLICT',
    'Event cursor is not in retained history',
    { cursor },
  );
}

export function expiredCursor(
  cursor: string,
  oldestAvailableEventId: string | null,
): OrderedEventError {
  return new OrderedEventError(
    'EVENT_CURSOR_EXPIRED',
    'Event cursor has been pruned from retained history',
    { cursor, oldestAvailableEventId },
  );
}
