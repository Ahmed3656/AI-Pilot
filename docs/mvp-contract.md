# DealPilot Egypt MVP Contract

- Status: **Frozen for MVP implementation**
- Contract version: **1.0.0**
- Last updated: **2026-07-17**

This document is the single normative source of truth for the Egypt-only DealPilot MVP. The companion OpenAPI document at `docs/contracts/mvp-contract.openapi.json` is a machine-readable projection of this contract, not an alternative contract. If the two ever differ, this document governs and the projection must be corrected before merge.

The words **MUST**, **MUST NOT**, **SHOULD**, and **MAY** are normative. Existing code is not precedent when it conflicts with this contract. Known implementation differences are tracked in `docs/mvp-acceptance-matrix.md`; they are follow-up component work and are not compatibility aliases.

## 1. Fixed scope and conventions

The following values are constants, not deployment or user choices:

| Field                | Value                                 |
| -------------------- | ------------------------------------- |
| Market               | `EG`                                  |
| Currency             | `EGP`                                 |
| Business timezone    | `Africa/Cairo`                        |
| Supported locales    | `ar-EG`, `en-EG`                      |
| Request categories   | `auto`, `retail`, `food`, `cinema`    |
| Resolved categories  | `retail`, `food`, `cinema`            |
| Public API prefix    | `/api/v1`                             |
| Event WebSocket path | `/api/v1/shopping/runs/:runId/events` |

There is no country selector, market parameter, currency parameter, locale outside the two listed values, country pack, or international configuration in the MVP. Unknown JSON properties are rejected. Timestamps are RFC 3339 UTC strings with a `Z` suffix; clients render them in `Africa/Cairo`. Identifiers are opaque, case-sensitive strings. API-generated identifiers SHOULD be ULIDs.

Money is transmitted as a non-negative decimal string with exactly two fractional digits, for example `"1250.00"`. Binary floating-point JSON numbers are not valid money values. `null` means unknown, while `"0.00"` means known to be zero.

## 2. Canonical enums and run state machine

```ts
type RequestedCategory = 'auto' | 'retail' | 'food' | 'cinema';
type ResolvedCategory = Exclude<RequestedCategory, 'auto'>;
type Locale = 'ar-EG' | 'en-EG';
type Market = 'EG';
type Currency = 'EGP';

type RunStatus =
  | 'clarifying'
  | 'discovering'
  | 'awaiting_domain_approval'
  | 'comparing'
  | 'awaiting_address_consent'
  | 'awaiting_seat_hold_approval'
  | 'coupon_testing'
  | 'ready_for_handoff'
  | 'user_takeover'
  | 'paused'
  | 'completed'
  | 'cancelled'
  | 'failed';
```

`completed`, `cancelled`, and `failed` are terminal and immutable. A created run starts in `clarifying` when `category=auto` cannot be classified safely; otherwise it starts in `discovering`. `auto` is never a resolved category.

Allowed transitions are exact:

| From                          | Allowed next status                                                                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `clarifying`                  | `discovering`, `paused`, `cancelled`, `failed`                                                                                                                |
| `discovering`                 | `clarifying`, `awaiting_domain_approval`, `paused`, `cancelled`, `failed`                                                                                     |
| `awaiting_domain_approval`    | `discovering`, `comparing`, `paused`, `cancelled`, `failed`                                                                                                   |
| `comparing`                   | `awaiting_domain_approval`, `awaiting_address_consent`, `awaiting_seat_hold_approval`, `coupon_testing`, `ready_for_handoff`, `paused`, `cancelled`, `failed` |
| `awaiting_address_consent`    | `comparing`, `paused`, `cancelled`, `failed`                                                                                                                  |
| `awaiting_seat_hold_approval` | `comparing`, `paused`, `cancelled`, `failed`                                                                                                                  |
| `coupon_testing`              | `comparing`, `ready_for_handoff`, `paused`, `cancelled`, `failed`                                                                                             |
| `ready_for_handoff`           | `paused`, `completed`, `cancelled`, `failed`                                                                                                                  |
| `user_takeover`               | the stored `resumeStatus`, `completed`, `cancelled`, `failed`                                                                                                 |
| `paused`                      | `user_takeover` only for a current AI user-input request; otherwise the stored `resumeStatus`, `cancelled`, `failed`                                          |
| terminal status               | none                                                                                                                                                          |

Entering `paused` stores the immediately preceding nonterminal status as `resumeStatus`. `resume` and takeover release may return only to that stored status; callers cannot choose a target. `ready_for_handoff` means the report and retained browsers are ready for review, but those browsers remain view-only unless a later AI user-input blocker creates a targeted takeover request. A same-status event is idempotent and does not create another state transition. Every other unlisted transition returns `409 INVALID_RUN_TRANSITION`.

The API owns the state machine. AI events propose facts and statuses, but the API validates and persists every transition.

## 3. Common public DTOs

These TypeScript declarations define JSON shapes; they are not implementation-specific classes.

```ts
type Timestamp = string; // RFC 3339 UTC, e.g. 2026-07-17T12:00:00.000Z
type DecimalEGP = string; // ^(?:0|[1-9]\d*)\.\d{2}$

interface RunResource {
  id: string;
  requestedCategory: RequestedCategory;
  category: ResolvedCategory | null;
  market: 'EG';
  currency: 'EGP';
  timezone: 'Africa/Cairo';
  locale: Locale;
  query: string;
  status: RunStatus;
  resumeStatus: Exclude<
    RunStatus,
    'paused' | 'completed' | 'cancelled' | 'failed'
  > | null;
  pendingAction: PendingAction | null;
  failure: { code: string; message: string } | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  completedAt: Timestamp | null;
  browserExpiresAt: Timestamp;
  lastEventId: string | null;
}

type PendingAction =
  | {
      type: 'clarification';
      requestId: string;
      questions: Array<{ id: string; prompt: string; required: boolean }>;
    }
  | {
      type: 'domain_approval';
      requestId: string;
      candidates: Merchant[];
    }
  | {
      type: 'address_consent';
      requestId: string;
      merchantDomains: string[];
      fields: AddressField[];
    }
  | {
      type: 'seat_hold_approval';
      requestId: string;
      offerId: string;
      merchantDomain: string;
      holdDurationSeconds: number | null;
    }
  | {
      type: 'browser_takeover';
      requestId: string;
      merchantAttemptId: string;
      merchantName: string;
      merchantDomain: string;
      reasonCode: string;
      message: string;
    }
  | { type: 'handoff'; requestId: string };

interface Merchant {
  id: string;
  name: string;
  domain: string;
  category: ResolvedCategory;
  market: 'EG';
  currency: 'EGP';
}

type ApprovalType = 'domain_access' | 'address_share' | 'seat_hold';
interface ApprovalResource {
  id: string;
  runId: string;
  requestId: string;
  type: ApprovalType;
  merchantDomains: string[];
  offerId: string | null;
  status: 'approved' | 'expired' | 'revoked';
  approvedAt: Timestamp;
  expiresAt: Timestamp | null;
}

interface ControlLease {
  id: string;
  runId: string;
  holderUserId: string;
  status: 'active' | 'released' | 'expired' | 'recovering';
  claimedAt: Timestamp;
  renewedAt: Timestamp;
  expiresAt: Timestamp;
}
```

`AddressField` is exactly `recipientName`, `mobileNumber`, `governorate`, `cityOrArea`, `street`, `building`, `floor`, `apartment`, `landmark`, or `postalCode`.

## 4. Public API

Every route in this section is under `/api/v1`. No `/v1`, `/shopping/.../actions`, generic approval, `control-token`, or other alias is part of the MVP. Except where stated, endpoints require the run owner's bearer access token.

Every mutating request requires an `Idempotency-Key` header containing 8-128 printable ASCII characters. The API retains the key for 24 hours, scoped to principal + method + canonical path. Repeating an identical request returns the original status and body. Reusing a key with a different body returns `409 IDEMPOTENCY_KEY_REUSED`.

### 4.1 Endpoint list and status behavior

| Method and path                                  | Success | Request                      | Response                                    | State precondition                              |
| ------------------------------------------------ | ------- | ---------------------------- | ------------------------------------------- | ----------------------------------------------- |
| `POST /shopping/runs`                            | `201`   | `CreateRunRequest`           | `{ run: RunResource }`                      | none                                            |
| `GET /shopping/runs/:runId`                      | `200`   | none                         | `{ run: RunResource }`                      | run exists                                      |
| `GET /shopping/merchants?category=...`           | `200`   | concrete category optional   | `{ merchants: Merchant[] }`                 | none                                            |
| `POST /shopping/runs/:runId/clarifications`      | `200`   | `SubmitClarificationRequest` | `{ run: RunResource }`                      | `clarifying` and current request ID             |
| `POST /shopping/runs/:runId/domains/approve`     | `200`   | `ApproveDomainsRequest`      | `ApprovalResponse`                          | `awaiting_domain_approval`                      |
| `POST /shopping/runs/:runId/address-grant`       | `200`   | `AddressGrantRequest`        | `ApprovalResponse`                          | `awaiting_address_consent`                      |
| `POST /shopping/runs/:runId/seat-hold/approve`   | `200`   | `SeatHoldApprovalRequest`    | `ApprovalResponse`                          | `awaiting_seat_hold_approval`                   |
| `POST /shopping/runs/:runId/control`             | `200`   | `RunControlRequest`          | `{ run: RunResource }`                      | action-specific                                 |
| `POST /shopping/runs/:runId/control/claim`       | `200`   | `ClaimControlRequest`        | `{ run: RunResource; lease: ControlLease }` | `paused` with matching `browser_takeover`       |
| `POST /shopping/runs/:runId/control/renew`       | `200`   | `{ leaseId: string }`        | `{ lease: ControlLease }`                   | active lease held by caller                     |
| `POST /shopping/runs/:runId/control/release`     | `200`   | `{ leaseId: string }`        | `{ run: RunResource; lease: ControlLease }` | active/recovering lease held by caller          |
| `POST /shopping/runs/:runId/viewer-tokens`       | `201`   | `CreateViewerTokenRequest`   | `ViewerTokenResponse`                       | nonterminal; control also requires active lease |
| `GET /shopping/runs/:runId/events`               | `200`   | history query                | `EventHistoryResponse`                      | run exists                                      |
| `WS /shopping/runs/:runId/events`                | `101`   | WebSocket upgrade            | `EventEnvelope` frames                      | valid viewer token                              |
| `GET /shopping/runs/:runId/report`               | `200`   | none                         | `RunReport`                                 | run exists                                      |
| `GET /shopping/runs/:runId/evidence/:evidenceId` | `200`   | none                         | redacted `image/png`                        | run ownership and persisted evidence            |

Ownership mismatch returns `404 RUN_NOT_FOUND`, not a run-existence oracle. A stale pending-action `requestId` returns `409 STALE_ACTION_REQUEST`. Viewer token creation is a side effect and therefore uses `POST`, never `GET`.

### 4.2 Exact request and response DTOs

```ts
interface CreateRunRequest {
  query: string; // trimmed, 3..2000 Unicode code points
  category: RequestedCategory;
  locale: Locale;
}

interface SubmitClarificationRequest {
  requestId: string;
  answers: Record<string, string | string[]>; // only IDs in pending questions; non-empty values
}

interface ApproveDomainsRequest {
  requestId: string;
  domains: string[]; // 1..5, unique canonical registrable domains
}

interface EgyptAddress {
  recipientName: string;
  mobileNumber: string; // ^(?:\+20|0)1[0125]\d{8}$
  governorate: string;
  cityOrArea: string;
  street: string;
  building: string;
  floor: string;
  apartment: string;
  landmark: string;
  postalCode?: string;
}

interface AddressGrantRequest {
  requestId: string;
  merchantDomains: string[]; // non-empty subset of approved domains
  address: EgyptAddress;
}

interface SeatHoldApprovalRequest {
  requestId: string;
  offerId: string;
  merchantDomain: string;
}

interface ApprovalResponse {
  run: RunResource;
  approval: ApprovalResource;
}

interface RunControlRequest {
  action: 'pause' | 'resume' | 'cancel' | 'complete';
  reason?: string; // trimmed, 1..300; permitted only for pause/cancel
}

interface ClaimControlRequest {
  requestId: string;
  merchantAttemptId: string;
  requestedLeaseSeconds?: number; // integer 60..900; default 120
}

interface CreateViewerTokenRequest {
  mode: 'view' | 'control';
  leaseId?: string; // required and only permitted for control
}

interface ViewerTokenResponse {
  token: string;
  tokenType: 'Bearer';
  mode: 'view' | 'control';
  viewerUrl: string; // same public origin, /viewer/, never contains the token
  expiresAt: Timestamp;
}
```

`complete` means that the user has finished or abandoned manual interaction and authorizes run cleanup. It never means the AI completed a merchant purchase. `complete` is allowed only from `ready_for_handoff` or `user_takeover`.

## 5. Error contract

Every non-2xx HTTP response, including validation and internal endpoints, uses this envelope and `Content-Type: application/json`:

```ts
interface ErrorResponse {
  error: {
    code: string;
    message: string; // safe, localized only by the client
    status: number;
    requestId: string;
    timestamp: Timestamp;
    details: Array<{
      field: string | null; // JSON Pointer when applicable
      code: string;
      message: string;
    }>;
  };
}
```

The response never echoes secrets, tokens, address values, URLs containing query strings, upstream response bodies, or stack traces. Canonical status mapping:

| HTTP  | Codes and behavior                                                                                                        |
| ----- | ------------------------------------------------------------------------------------------------------------------------- |
| `400` | `VALIDATION_ERROR`, `UNSUPPORTED_CATEGORY`, `UNSUPPORTED_LOCALE`, `DOMAIN_NOT_ALLOWED`; malformed or unknown input        |
| `401` | `UNAUTHENTICATED`, `INVALID_VIEWER_TOKEN`, `INVALID_INTERNAL_TOKEN`; missing, invalid, or expired authentication          |
| `403` | `RUN_ACCESS_DENIED`, `DOMAIN_NOT_APPROVED`, `CONTROL_NOT_ALLOWED`; authenticated but disallowed                           |
| `404` | `RUN_NOT_FOUND`, `OFFER_NOT_FOUND`, `ACTION_REQUEST_NOT_FOUND`                                                            |
| `409` | `INVALID_RUN_TRANSITION`, `STALE_ACTION_REQUEST`, `CONTROL_LEASE_CONFLICT`, `IDEMPOTENCY_KEY_REUSED`, `EVENT_ID_CONFLICT` |
| `410` | `EVENT_CURSOR_EXPIRED`, `ADDRESS_GRANT_EXPIRED`, `CONTROL_LEASE_EXPIRED`                                                  |
| `429` | `RATE_LIMITED`; includes integer `Retry-After` header                                                                     |
| `502` | `AI_COMMAND_REJECTED`, `AI_SERVICE_UNAVAILABLE`; no API state advancement                                                 |
| `503` | `DEPENDENCY_UNAVAILABLE`; required database/browser dependency unavailable                                                |
| `500` | `INTERNAL_ERROR`; opaque safe message                                                                                     |

## 6. Event contract

### 6.1 Envelope and names

All stored history records and WebSocket frames use one envelope. There are no wrapper shapes such as `{event: ...}` and no `observedAt`/`createdAt` aliases.

```ts
interface EventEnvelope<T extends EventType = EventType> {
  id: string; // global, stable cursor and idempotency key
  runId: string;
  type: T;
  status: RunStatus; // run status immediately after applying this event
  timestamp: Timestamp;
  payload: EventPayloadMap[T];
}

type EventType =
  | 'run.created'
  | 'run.clarification_required'
  | 'run.clarification_submitted'
  | 'run.status_changed'
  | 'domains.approval_required'
  | 'domains.approved'
  | 'address.approval_required'
  | 'address.granted'
  | 'seat_hold.approval_required'
  | 'seat_hold.approved'
  | 'merchant.attempt_started'
  | 'merchant.attempt_completed'
  | 'offer.recorded'
  | 'coupon.attempted'
  | 'evidence.captured'
  | 'run.warning'
  | 'control.claimed'
  | 'control.renewed'
  | 'control.released'
  | 'control.lease_expired'
  | 'report.updated'
  | 'run.completed'
  | 'run.cancelled'
  | 'run.failed'
  | 'stream.reset_required';
```

Event payloads are exact:

```ts
interface NormalizedOfferSnapshot {
  title: string;
  sourceUrl: string;
  match: { exact: boolean; confidence: number; explanation: string };
  availability: 'available' | 'unavailable' | 'unknown';
  details: OfferDetails;
  price: PriceBreakdown;
  observedAt?: Timestamp;
  exclusionReason: string | null;
  incompleteFields: string[];
}

interface CouponAttemptSnapshot {
  code: string;
  sourceUrl: string;
  beforeTotal: Money;
  afterTotal: Money | null;
  verifiedDiscount: Money;
  message: string | null;
}

interface EventPayloadMap {
  'run.created': {
    requestedCategory: RequestedCategory;
    category: ResolvedCategory | null;
    locale: Locale;
  };
  'run.clarification_required': {
    requestId: string;
    questions: Array<{ id: string; prompt: string; required: boolean }>;
  };
  'run.clarification_submitted': {
    requestId: string;
    answeredQuestionIds: string[];
    category: ResolvedCategory | null;
  };
  'run.status_changed': {
    from: RunStatus;
    to: RunStatus;
    reasonCode: string | null;
  };
  'domains.approval_required': { requestId: string; candidates: Merchant[] };
  'domains.approved': {
    approvalId: string;
    requestId: string;
    domains: string[];
  };
  'address.approval_required': {
    requestId: string;
    merchantDomains: string[];
    fields: AddressField[];
  };
  'address.granted': {
    approvalId: string;
    requestId: string;
    merchantDomains: string[];
    expiresAt: Timestamp;
  };
  'seat_hold.approval_required': {
    requestId: string;
    offerId: string;
    merchantDomain: string;
    holdDurationSeconds: number | null;
  };
  'seat_hold.approved': {
    approvalId: string;
    requestId: string;
    offerId: string;
    merchantDomain: string;
  };
  'merchant.attempt_started': {
    attemptId: string;
    merchantId: string;
    merchantDomain: string;
    category: ResolvedCategory;
  };
  'merchant.attempt_completed': {
    attemptId: string;
    outcome: MerchantAttemptOutcome;
    failureCode: string | null;
    evidenceIds: string[];
  };
  'offer.recorded': {
    offerId: string;
    validity: 'valid' | 'excluded' | 'incomplete';
    merchantAttemptId: string;
    evidenceIds: string[];
    offer?: NormalizedOfferSnapshot;
  };
  'coupon.attempted': {
    couponAttemptId: string;
    offerId: string;
    status: CouponStatus;
    rejectionReason: CouponRejectionReason | null;
    evidenceIds: string[];
    coupon: CouponAttemptSnapshot;
  };
  'evidence.captured': {
    evidenceId: string;
    kind: EvidenceKind;
    merchantAttemptId: string | null;
    redacted: true;
  };
  'run.warning': {
    code: string;
    message: string;
    merchantAttemptId: string | null;
    evidenceIds: string[];
    requiresUserInput?: boolean;
  'control.claimed': {
    leaseId: string;
    holderUserId: string;
    expiresAt: Timestamp;
    merchantAttemptId: string;
  };
  'control.renewed': { leaseId: string; expiresAt: Timestamp };
  'control.released': {
    leaseId: string;
    releasedAt: Timestamp;
    recovery: 'resumed';
  };
  'control.lease_expired': {
    leaseId: string;
    expiredAt: Timestamp;
    recovery: 'pending' | 'resumed';
  };
  'report.updated': {
    validOfferCount: number;
    excludedOfferCount: number;
    incompleteOfferCount: number;
  };
  'run.completed': { completedAt: Timestamp; reportId: string };
  'run.cancelled': { cancelledAt: Timestamp; reasonCode: string | null };
  'run.failed': {
    failedAt: Timestamp;
    failureCode: string;
    retryable: boolean;
  };
  'stream.reset_required': {
    reason: 'cursor_expired';
    oldestAvailableEventId: string;
    snapshotUrl: string;
  };
}
```

`NormalizedOfferSnapshot` is the normalized title, approved source URL, match, availability,
category details, price breakdown, observation time, exclusion reason, and incomplete fields used
to materialize `OfferReport`. It contains no address, authentication, payment, cookie, or other
secret fields. Older/minimal producers may omit it; the API then preserves the discovery as an
incomplete offer instead of inventing economic details.

`CouponAttemptSnapshot` carries the public code and source URL plus the exact before total,
after total, verified discount, and optional result message. It contains no checkout credentials
or payment data.

The named supporting enums are defined in the report section. Payloads MUST NOT contain address fields or values, viewer/internal tokens, cookies, authorization headers, payment data, or unredacted screenshot bytes.

### 6.2 History, WebSocket authentication, and reconnection

`GET /api/v1/shopping/runs/:runId/events` accepts `after` (exclusive event ID cursor, optional) and `limit` (integer 1-200, default 100). Its response is:

```ts
interface EventHistoryResponse {
  events: EventEnvelope[];
  nextAfter: string | null;
  hasMore: boolean;
}
```

Events are ordered by persisted sequence, never client timestamp. History is retained for at least `EVENT_RETENTION_SECONDS` after terminal status. An unknown cursor that is still within retained history returns `409 EVENT_ID_CONFLICT`; a pruned cursor returns `410 EVENT_CURSOR_EXPIRED` with `oldestAvailableEventId` in error details.

The WebSocket uses the same canonical path and an optional non-secret `after` query parameter. Browser clients authenticate with subprotocols `dealpilot.events.v1` and `bearer.<viewer-token>`; tokens MUST NOT appear in URLs. The server selects only `dealpilot.events.v1` and never echoes the bearer subprotocol. On connection it replays all retained events after the cursor, then streams live events without a gap. The client deduplicates by `id`, stores the last fully processed ID, reconnects with exponential backoff (1, 2, 4, 8 seconds, then 8 seconds), and falls back to REST history plus run polling after three consecutive failures.

If the cursor was pruned, the server sends one `stream.reset_required` envelope and closes with code `4009`. The client fetches the run snapshot, then requests history without an `after` cursor so the first page begins with `oldestAvailableEventId`; it does not invent missing timeline items. Normal closure is `1000`; authentication failure is HTTP `401` before upgrade; authorization loss closes with `4003`.

## 7. API-to-AI internal contract

Internal routes are network-private and use `X-Internal-Token` over the app network. They are never exposed by Caddy. Request and response casing is camelCase only.

| Direction   | Method and path                          | Success |
| ----------- | ---------------------------------------- | ------- |
| API → AI    | `POST /internal/v1/runs`                 | `202`   |
| API → AI    | `POST /internal/v1/runs/:runId/commands` | `202`   |
| AI → API    | `POST /internal/v1/ai-events`            | `202`   |
| AI → API    | `POST /internal/v1/secrets/resolve`      | `200`   |
| Caddy → API | `POST /internal/v1/viewer/authorize`     | `200`   |

Redacted PNG evidence is uploaded with multipart field `file` to `POST /internal/v1/evidence/:runId/:evidenceId`, which returns `201` after persisting the screenshot.

Internal run creation:

```ts
interface InternalCreateRunRequest {
  runId: string; // same ID as the public/API run; no second AI-visible run ID
  query: string;
  requestedCategory: RequestedCategory;
  locale: Locale;
  market: 'EG';
  currency: 'EGP';
  timezone: 'Africa/Cairo';
  browserExpiresAt: Timestamp;
}
interface InternalCreateRunResponse {
  runId: string;
  accepted: true;
  duplicate: boolean;
}
```

The only internal command names are:

```ts
type InternalCommandName =
  | 'clarify'
  | 'pause'
  | 'resume'
  | 'cancel'
  | 'complete'
  | 'approve_domains'
  | 'grant_address'
  | 'approve_seat_hold';

interface InternalCommand {
  id: string;
  runId: string;
  name: InternalCommandName;
  issuedAt: Timestamp;
  payload: Record<string, unknown>;
}
interface InternalCommandResponse {
  id: string;
  runId: string;
  accepted: true;
  duplicate: boolean;
}
```

There are no `pause_ai`, `resume_ai`, `approve`, `deny`, or command `type` aliases. Payloads are exact by name:

| Command             | Payload                                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `clarify`           | `{ requestId: string; answers: Record<string, string \| string[]> }`                                                  |
| `pause`             | `{ reason: "user" \| "safety" }` or `{ reason:"control_claim"; merchantAttemptId:string; merchantDomain:string }`     |
| `resume`            | `{ reason: "user" \| "control_release" \| "lease_expired" }`                                                          |
| `cancel`            | `{ reason: string \| null }`                                                                                          |
| `complete`          | `{ reason: "user_finished"; reportId: string }`                                                                       |
| `approve_domains`   | `{ approvalId: string; requestId: string; domains: string[] }`                                                        |
| `grant_address`     | `{ approvalId: string; requestId: string; secretReference: string; merchantDomains: string[]; expiresAt: Timestamp }` |
| `approve_seat_hold` | `{ approvalId: string; requestId: string; merchantDomain: string; offerId: string }`                                  |

`POST /internal/v1/ai-events` accepts exactly one `EventEnvelope` and returns `{ accepted: true, duplicate: boolean }`. The API validates the event against the run, transition table, approved-domain set, and event payload schema before persistence.

Secret resolution accepts `{ runId, secretReference, merchantDomain, field }` and returns `{ runId, field, value, expiresAt }`. Exactly one semantic address field is returned. Viewer authorization reads `Authorization: Bearer <viewer-token>` and returns `{ authorized: true, runId, mode, userId, leaseId, expiresAt }`; it never accepts a token in the query string.

### 7.1 Idempotency, rejection, and ordering

- Internal create and command requests require `Idempotency-Key` equal to their `runId`/command `id` respectively. The receiver retains outcomes for 24 hours.
- Repeating the same ID and byte-equivalent normalized body returns the original response with `duplicate=true`. Reusing an ID with different content returns `409 IDEMPOTENCY_KEY_REUSED`.
- Event `id` is globally unique. An identical duplicate returns `202 duplicate=true`; a differing duplicate returns `409 EVENT_ID_CONFLICT`.
- Commands for a run are processed serially in `issuedAt`/receipt order. Stale commands that contradict current state return `409 INVALID_RUN_TRANSITION`.
- On timeout, the API retries the same command ID. It MUST NOT create a new ID until it knows the prior command was rejected.
- A public mutation that requires an AI command is staged, the command is accepted, and only then is the new API state and effective approval committed. If AI returns non-2xx or times out, the API returns `502`, leaves run status and effective grants unchanged, and may retain only a non-effective audit attempt.
- AI events cannot bypass an API approval or make an invalid transition. An invalid event is rejected and has no side effect.

## 8. Browser and control lifecycle

There is exactly one isolated Selenium browser session per approved merchant and at most one active run browser pool in the MVP. A retail run therefore uses one to three concurrent sessions, based on the user's selection.

1. The AI service waits for domain approval, then creates one browser session and one agent worker for each selected merchant. It never creates a replacement session for retry, pause, clarification, or takeover.
2. Before every top-level navigation, click that may navigate, form submission, popup/tab switch, and redirect continuation, the target/current URL is checked against the effective approved-domain set.
3. Each merchant's WebDriver session and cookies remain alive through `paused`, `ready_for_handoff`, and `user_takeover`. AI task completion or `ready_for_handoff` MUST NOT call `quit()`.
4. AI control across all merchant workers is paused before a human control lease becomes effective. The requested merchant browser is focused before the lease is granted. AI and user control can never be active concurrently.
5. All merchant browsers close only after `complete` or `cancel` is acknowledged, after an AI-originated terminal failure, or when the absolute browser TTL expires. Closing destroys cookies, tabs, in-memory secrets, address grants, viewer authorization, and every Selenium session in the run.
6. Browser TTL is measured from run creation, defaults to 3600 seconds, and is never extended by control renewal. TTL expiry closes the session and transitions the run to `failed` with `BROWSER_TTL_EXPIRED` unless it is already terminal.

### 8.1 Control claim, renewal, release, and recovery

- Claim is allowed only from `paused` when the current pending action is an AI-originated `browser_takeover` with `requiresUserInput:true`. The request must match both its `requestId` and `merchantAttemptId`; arbitrary paused or `ready_for_handoff` sessions remain view-only. The API sends `pause {reason:"control_claim",merchantAttemptId,merchantDomain}` so the AI service focuses the correct retained browser before the lease becomes active.
- A lease defaults to 120 seconds, may be requested from 60-900 seconds, and is exclusive. The client renews it every 30 seconds. Renewal never exceeds `browserExpiresAt`.
- Control viewer authorization requires `user_takeover`, the same owner, matching active `leaseId`, and unexpired JWT and lease. View-only authorization does not grant input.
- Release sends `resume {reason:"control_release"}`. Only after acceptance does the API revoke control, clear the fulfilled takeover request, mark the lease released, and return to the stored `resumeStatus` so AI work can continue.
- On lease expiry, input is denied immediately. The lease becomes `recovering`; the API retries the same idempotent `resume {reason:"lease_expired"}` command. After acceptance it clears the takeover request, marks the lease expired, and returns to the stored `resumeStatus`.
- If resume is rejected or unavailable, the run remains `user_takeover`, the expired lease cannot control, AI remains paused, and `control.lease_expired` reports `recovery:"pending"`. Recovery retries with the same command ID. Browser TTL remains the final cleanup bound.

## 9. Report contract

```ts
type MerchantAttemptOutcome =
  | 'succeeded'
  | 'blocked'
  | 'timed_out'
  | 'unavailable'
  | 'safety_paused'
  | 'failed';
type CouponStatus =
  'verified' | 'rejected' | 'not_tested' | 'technical_failure';
type CouponRejectionReason =
  | 'invalid_code'
  | 'expired'
  | 'not_eligible'
  | 'minimum_not_met'
  | 'merchant_restriction'
  | 'product_restriction'
  | 'payment_method_required'
  | 'already_applied'
  | 'not_stackable'
  | 'technical_failure'
  | 'unknown';
type EvidenceKind =
  | 'screenshot'
  | 'dom_snapshot'
  | 'price_text'
  | 'coupon_source'
  | 'coupon_result'
  | 'seat_hold';

interface PriceBreakdown {
  itemSubtotal: DecimalEGP;
  deliveryFee: DecimalEGP | null;
  serviceFee: DecimalEGP | null;
  bookingFee: DecimalEGP | null;
  tax: DecimalEGP | null;
  mandatoryFees: Array<{
    label: string;
    amount: DecimalEGP;
    evidenceIds: string[];
  }>;
  verifiedDiscount: DecimalEGP;
  optionalTip: '0.00' | null;
  finalTotal: DecimalEGP | null;
}

interface MerchantAttemptReport {
  id: string;
  merchantId: string;
  merchantName: string;
  merchantDomain: string;
  category: ResolvedCategory;
  outcome: MerchantAttemptOutcome;
  startedAt: Timestamp;
  finishedAt: Timestamp | null;
  failureCode: string | null;
  message: string | null;
  evidenceIds: string[];
}

interface RetailOfferDetails {
  kind: 'retail';
  brand: string;
  model: string;
  variant: string | null;
  storage: string | null;
  size: string | null;
  color: string | null;
  quantity: number;
  condition: 'new';
  deliveryEstimate: string | null;
}

interface FoodOfferDetails {
  kind: 'food';
  restaurant: string;
  meal: string;
  size: string | null;
  modifiers: string[];
  rating: number | null;
  minimumOrder: DecimalEGP | null;
  deliveryEstimate: string | null;
  optionalTipExcluded: true;
  sourceName?: string;
  branchArea?: string | null;
  distanceKm?: number | null;
  distanceText?: string | null;
  proximityBasis?:
    'route_distance' | 'same_area' | 'branch_area_only' | 'unknown';
  priceScope?: 'menu_price' | 'delivered_total';
}

interface CinemaOfferDetails {
  kind: 'cinema';
  movie: string;
  venue: string;
  date: string; // YYYY-MM-DD in Africa/Cairo
  showtime: Timestamp;
  language: string;
  screenFormat: string;
  seatCount: number;
  adjacentSeats: boolean;
  seatType: string;
  holdExpiresAt: Timestamp | null;
}

type OfferDetails = RetailOfferDetails | FoodOfferDetails | CinemaOfferDetails;

interface OfferReport {
  id: string;
  merchantAttemptId: string;
  category: ResolvedCategory;
  merchantName: string;
  merchantDomain: string;
  title: string;
  sourceUrl: string;
  match: { exact: boolean; confidence: number; explanation: string };
  availability: 'available' | 'unavailable' | 'unknown';
  details: OfferDetails; // kind must equal category
  price: PriceBreakdown;
  observedAt: Timestamp;
  evidenceIds: string[];
  exclusionReason: string | null;
  incompleteFields: string[];
}

interface CouponAttemptReport {
  id: string;
  offerId: string;
  merchantDomain: string;
  code: string;
  sourceUrl: string;
  status: CouponStatus;
  beforeTotal: DecimalEGP;
  afterTotal: DecimalEGP | null;
  verifiedDiscount: DecimalEGP;
  rejectionReason: CouponRejectionReason | null;
  message: string | null;
  attemptedAt: Timestamp;
  evidenceIds: string[];
}

interface EvidenceReference {
  id: string;
  kind: EvidenceKind;
  uri: string; // authenticated API/gateway URI, never a local path or data URI
  sha256: string;
  capturedAt: Timestamp;
  merchantAttemptId: string | null;
  redacted: true;
}

// Screenshot URIs serve persisted redacted image/png bytes through the
// authenticated public API. Report and event payloads never contain the bytes.

interface RunReport {
  id: string;
  runId: string;
  status: 'in_progress' | 'final';
  category: ResolvedCategory | null;
  market: 'EG';
  currency: 'EGP';
  timezone: 'Africa/Cairo';
  generatedAt: Timestamp;
  merchantAttempts: MerchantAttemptReport[];
  validOffers: OfferReport[];
  excludedOffers: OfferReport[];
  incompleteOffers: OfferReport[];
  couponAttempts: CouponAttemptReport[];
  evidence: EvidenceReference[];
  warnings: Array<{ code: string; message: string; evidenceIds: string[] }>;
  partialFailures: Array<{
    merchantAttemptId: string;
    code: string;
    message: string;
    retryable: boolean;
  }>;
  conclusion: null | {
    outcome: 'winner' | 'comparison_incomplete' | 'no_valid_offers';
    winnerOfferId: string | null;
    validOfferCount: number;
    statement: string;
  };
}
```

`RunReport.status` is `in_progress` before `ready_for_handoff` and `final` from `ready_for_handoff` onward. A final report's economic evidence and conclusion are immutable; later lifecycle events may change only the run status outside the report.

Every offer has at least one evidence ID. Every coupon attempt has both a `coupon_source` evidence ID and a `coupon_result` evidence ID. All referenced IDs must exist in the report `evidence` array and belong to the same run. Invalid evidence linkage makes the offer/coupon incomplete.

Total rules are exact:

```text
finalTotal = itemSubtotal
           + deliveryFee
           + serviceFee
           + bookingFee
           + tax
           + sum(mandatoryFees.amount)
           - verifiedDiscount
```

- Components not applicable to a category are `"0.00"`; components that could apply but were not verified are `null`.
- `finalTotal` is non-null only when every applicable component is known and evidence-backed. It is rounded once to two decimals using decimal half-up arithmetic after component normalization.
- `verifiedDiscount` is `beforeTotal - afterTotal` only for a `verified` coupon with evidence; otherwise it is `"0.00"`. Discounts cannot make total negative.
- `mandatoryFees` excludes delivery, service, booking, and tax to prevent double counting.
- Food optional tip is always `"0.00"` and is disclosed. Retail/cinema optional tip is `null`.
- `validOffers` are exact/equivalent matches, available, complete, EGP, approved-domain, and evidence-valid. Excluded offers fail matching/availability/scope. Incomplete offers may match but lack a required price or evidence field.
- Ranking uses only `validOffers`: lowest `finalTotal`, then earliest verified delivery/showtime suitability, then higher match confidence, then stable offer ID.
- `winner` requires at least two valid comparable offers. Otherwise the outcome is `comparison_incomplete` or `no_valid_offers`; an incomplete offer is never called cheapest.
- For `winner`, `statement` is exactly `Lowest verified total among the options successfully checked.` For other outcomes it is exactly `Comparison incomplete; fewer than two complete valid offers were verified.` or `No complete valid offer was verified.` These are scope-qualified claims, not global price claims.

## 10. Environment variable matrix

Values listed as required in live environments MUST fail readiness when absent. Test mocks may omit live-only secrets, but the UI/demo must identify mock mode and MUST NOT claim a live run worked.

| Variable                      | Owner / consumer                     | Default                                       | Required        | Secret | Contract behavior                                            |
| ----------------------------- | ------------------------------------ | --------------------------------------------- | --------------- | ------ | ------------------------------------------------------------ |
| `NODE_ENV`                    | API                                  | `development`                                 | no              | no     | `development`, `test`, `production`                          |
| `PORT`                        | API                                  | `3000`                                        | no              | no     | API listen port                                              |
| `DATABASE_ENABLED`            | API                                  | `false` locally; `true` in Compose            | live            | no     | Live MVP requires persistent event/report state              |
| `DATABASE_URL`                | API                                  | local development URL                         | live            | yes    | PostgreSQL connection string; never logged                   |
| `JWT_SECRET`                  | API                                  | none outside test                             | live            | yes    | User access-token signing; minimum 32 random bytes           |
| `JWT_ACCESS_TTL`              | API                                  | `15m`                                         | no              | no     | User access-token lifetime                                   |
| `JWT_REFRESH_TTL`             | API                                  | `7d`                                          | no              | no     | User refresh-token lifetime                                  |
| `AI_SERVICE_URL`              | API                                  | `http://ai-service:8000` in Compose           | live            | no     | Private AI origin, no trailing slash                         |
| `INTERNAL_TOKEN`              | API and Caddy; source for AI mapping | none                                          | live            | yes    | Shared internal authentication, minimum 32 random bytes      |
| `VIEWER_TOKEN_SECRET`         | API                                  | none                                          | live            | yes    | HS256 viewer JWT key; distinct from `JWT_SECRET`             |
| `VIEWER_TOKEN_TTL_SECONDS`    | API                                  | `900`                                         | no              | no     | Maximum viewer JWT lifetime                                  |
| `ADDRESS_SECRET_TTL_MS`       | API                                  | `1800000`                                     | no              | no     | Maximum address grant lifetime                               |
| `CONTROL_LEASE_TTL_SECONDS`   | API                                  | `120`                                         | no              | no     | Default control lease; request still capped at 900           |
| `RUN_BROWSER_TTL_SECONDS`     | API and AI                           | `3600`                                        | no              | no     | Absolute browser/run cleanup bound                           |
| `EVENT_RETENTION_SECONDS`     | API                                  | `86400`                                       | no              | no     | Minimum terminal event-history retention                     |
| `DEALPILOT_PUBLIC_ORIGIN`     | Compose → API/Caddy                  | local `http://localhost:8080`; none for cloud | cloud           | no     | Exact HTTPS origin used for viewer URLs                      |
| `AI_ENVIRONMENT`              | AI                                   | `development`                                 | no              | no     | `development`, `test`, `production`                          |
| `AI_HOST`                     | AI                                   | `0.0.0.0`                                     | no              | no     | Private listen address                                       |
| `AI_PORT`                     | AI                                   | `8000`                                        | no              | no     | Private listen port                                          |
| `AI_LOG_LEVEL`                | AI                                   | `INFO`                                        | no              | no     | Structured log level                                         |
| `AI_MODEL`                    | AI                                   | `openai/gpt-5.2`                              | no              | no     | Exact OpenRouter Responses model                             |
| `AI_VISION_FALLBACK_PROVIDER` | AI                                   | `openrouter`                                  | no              | no     | `openrouter` or direct `gemini` screenshot localizer         |
| `AI_VISION_FALLBACK_MODEL`    | AI                                   | `AI_MODEL`                                    | no              | no     | OpenRouter stale-control screenshot model                    |
| `AI_OPENROUTER_API_KEY`       | AI                                   | none                                          | live AI         | yes    | Never exposed to API, mobile, Caddy, screenshots, or reports |
| `AI_GEMINI_API_KEY`           | AI                                   | none                                          | Gemini fallback | yes    | Direct Gemini key, granted only to the AI container          |
| `AI_GEMINI_VISION_MODEL`      | AI                                   | `gemini-3-flash-preview`                      | no              | no     | Direct Gemini screenshot-grounding model                     |
| `AI_SELENIUM_REMOTE_URL`      | AI                                   | `http://browser:4444/wd/hub`                  | live            | no     | Private WebDriver URL                                        |
| `AI_CONTROL_API_URL`          | AI                                   | `http://api:3000`                             | live            | no     | Private API origin; internal paths appended                  |
| `AI_INTERNAL_TOKEN`           | AI                                   | none                                          | live            | yes    | Compose maps from the same `INTERNAL_TOKEN` value            |
| `AI_MAX_COMPUTER_STEPS`       | AI                                   | `80`                                          | no              | no     | Integer 1..200                                               |
| `AI_MAX_VISUAL_RETRIES`       | AI                                   | `3`                                           | no              | no     | Detector failures before human takeover, 1..10               |
| `AI_REQUEST_TIMEOUT_SECONDS`  | AI                                   | `30`                                          | no              | no     | Internal/OpenRouter request timeout, 1..120                  |
| `EXPO_PUBLIC_API_URL`         | mobile                               | local `http://localhost:8080`                 | build           | no     | Origin only; client appends `/api/v1`                        |
| `EXPO_PUBLIC_AUTH_REQUIRED`   | mobile                               | `true`                                        | no              | no     | Must be `true` for any live/shared demo                      |
| `COMPOSE_PROJECT_NAME`        | Compose                              | `dealpilot-phase1`                            | no              | no     | Resource namespace                                           |
| `DEALPILOT_GATEWAY_PORT`      | Compose                              | `8080`                                        | no              | no     | Loopback-only gateway binding                                |
| `POSTGRES_DB`                 | Compose/PostgreSQL                   | `dealpilot`                                   | no              | no     | Database name                                                |
| `POSTGRES_USER`               | Compose/PostgreSQL                   | `dealpilot`                                   | no              | no     | Database user                                                |
| `POSTGRES_PASSWORD`           | Compose/PostgreSQL                   | none                                          | live            | yes    | No checked-in fallback                                       |
| `CLOUDFLARE_TUNNEL_TOKEN`     | cloudflared                          | none                                          | cloud profile   | yes    | Remotely managed tunnel token                                |
| `CLOUDFLARED_LOG_LEVEL`       | cloudflared                          | `info`                                        | no              | no     | Tunnel log level                                             |
| `POSTGRES_IMAGE`              | Compose                              | pinned tested tag                             | no              | no     | Deliberate upgrades only                                     |
| `SELENIUM_IMAGE`              | Compose                              | pinned tested tag                             | no              | no     | Deliberate upgrades only                                     |
| `CADDY_IMAGE`                 | Compose                              | pinned tested tag                             | no              | no     | Deliberate upgrades only                                     |
| `CLOUDFLARED_IMAGE`           | Compose                              | pinned tested tag                             | no              | no     | Deliberate upgrades only                                     |
| `CADDY_API_UPSTREAM`          | Caddy                                | `api:3000`                                    | no              | no     | API reverse proxy/forward-auth upstream                      |
| `CADDY_VIEWER_UPSTREAM`       | Caddy                                | `browser:7900`                                | no              | no     | Internal noVNC upstream                                      |
| `SE_NODE_MAX_SESSIONS`        | Selenium                             | `3`                                           | no              | no     | Maximum selectable merchants in one retail run               |
| `SE_NODE_SESSION_TIMEOUT`     | Selenium                             | `3600`                                        | no              | no     | Equal to browser TTL; must not expire at handoff             |
| `SE_SESSION_REQUEST_TIMEOUT`  | Selenium                             | `30`                                          | no              | no     | New-session request timeout                                  |

Compose sets `TZ=Africa/Cairo` as a fixed literal on API, AI, Caddy, and Selenium; it is not user-configurable. Compose also fixes `SE_SCREEN_WIDTH=1280`, `SE_SCREEN_HEIGHT=800`, VNC enabled, extensions disabled, and WebDriver/noVNC ports internal-only. There are no `COUNTRY`, `MARKET`, `CURRENCY`, or configurable application timezone variables. Deprecated names such as `AI_OPENAI_API_KEY`, `INTERNAL_SERVICE_TOKEN`, `AI_INTERNAL_SERVICE_TOKEN`, `AI_NEST_API_INTERNAL_URL`, and `VIEWER_AUTH_SHARED_SECRET` are not accepted.

## 11. Security and safety rules

### 11.1 Approved domains and navigation

- The API provides category-eligible Egypt merchant candidates. A domain approval MUST be a non-empty subset of the current candidates; it need not equal the whole category catalog.
- Effective approval is the union of non-expired, non-revoked domain approvals for the run. Address recipients and a cinema seat hold domain must be subsets of it.
- Domains are stored as lowercase registrable roots without scheme, path, port, or trailing dot. Approval of `example.eg` permits `https://example.eg` and `https://*.example.eg`, but not `example.com`, lookalikes, embedded credentials, non-HTTPS URLs, or non-default ports.
- The browser validates a URL before navigation and validates `current_url` after every redirect, navigation response, popup, and tab switch. An unexpected domain is blocked before further DOM inspection or model screenshot capture, emits a redacted warning, pauses the AI, and never auto-approves the redirect.
- Page text is untrusted data. Prompt injection, login, OTP, CAPTCHA, browser security warnings, and access restrictions cause pause/takeover; the system never bypasses them.

### 11.2 Viewer and control tokens

Viewer tokens are HS256 JWTs with exact claims: `iss="dealpilot-api"`, `aud="dealpilot-viewer"`, `sub=<runId>`, `jti`, `mode` (`view` or `control`), `userId`, `leaseId` (`null` for view), `iat`, `nbf`, and `exp`. Maximum lifetime is 15 minutes and never exceeds `browserExpiresAt`; control-token effective lifetime also never exceeds its lease.

Authorization checks signature, algorithm, issuer, audience, time claims, run ownership, nonterminal run status, and server-side lease status on every viewer HTTP/WebSocket authorization. Release, expiry, terminal status, or TTL invalidates control immediately. Tokens are sent in authorization headers/subprotocols, never query strings, logs, reports, screenshots, persistent storage, or viewer URLs.

### 11.3 Address grants and redaction

- An address grant expires at the earliest of 30 minutes, `browserExpiresAt`, cancellation, completion, or failure.
- Plaintext address values exist only in the mobile secure store, the API process-memory vault, and the deterministic browser field-fill operation. They are never persisted or sent to the model.
- The AI requests one semantic field at a time using the grant reference, approved recipient domain, and exact field name. A grant cannot be broadened or refreshed without a new explicit user request.
- Exact values and likely formatted variants are masked from logs, errors, events, model screenshots, evidence, reports, traces, and analytics. Screenshots are masked before leaving the browser harness.

### 11.4 Prohibited AI actions

The AI MUST NOT submit a purchase, place an order, confirm checkout, confirm a booking, enter/request/inspect payment-card or wallet data, click a final irreversible control, or invoke an equivalent keyboard/script/network action. This prohibition applies even if the user asks the AI to do it.

The AI may prepare carts, apply/remove public coupons, calculate totals, and navigate to the last reversible page. Seat selection that creates a temporary hold requires `seat_hold` approval immediately beforehand. Payment and any final order/booking action are performed only by the human while holding control of the retained merchant browser sessions.

Automated tests may use fake providers and local HTML fixtures. Live demonstrations MUST disclose mocks and failures honestly; a mocked or recorded run cannot be presented as a working live merchant run. No test or live preflight may submit an order or booking.

## 12. Contract artifacts and change control

- `docs/contracts/mvp-contract.openapi.json` is the exact machine-readable HTTP/schema projection.
- `scripts/validate-mvp-contract.mjs` is the drift guard executed by `npm run test:contract` and the root test suite.
- `docs/mvp-acceptance-matrix.md` maps every frozen requirement to future automated/manual verification and component ownership.

Any contract change requires updating all three artifacts and their tests in the same commit. Adding an alias, enum value, state transition, endpoint, event name, environment variable, or report field is a breaking contract change unless this document explicitly marks it optional. Component tasks MUST implement this contract rather than preserve conflicting pre-contract behavior.
