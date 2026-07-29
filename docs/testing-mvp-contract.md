# Autonomous Web Testing MVP Contract

- Status: **Frozen for MVP implementation**
- Contract version: **1.0.0**
- Last updated: **2026-07-29**

This document is the normative contract for the autonomous web-testing platform introduced beside DealPilot. The DealPilot shopping contract remains separate and unchanged. The OpenAPI document at `docs/contracts/testing.openapi.json` and the registry at `docs/contracts/testing-registry.json` are machine-readable projections of this document. If an artifact differs, this document governs and all projections MUST be corrected before merge.

The words **MUST**, **MUST NOT**, **SHOULD**, and **MAY** are normative. This packet freezes interfaces and invariants; it does not claim that follow-up components already implement them.

## 1. MVP boundary and fixed conventions

The MVP performs authorized, browser-driven testing of web applications. It may navigate, inspect, interact, evaluate oracles, collect redacted evidence, and report findings within a verified target boundary.

The MVP explicitly excludes:

- active penetration testing, vulnerability exploitation, credential attacks, fuzzing, port scanning, or bypassing access controls;
- load, stress, soak, concurrency, denial-of-service, or capacity testing;
- live payments or the entry, collection, inspection, storage, or transmission of payment-card or wallet data;
- purchases, bookings, account deletion, production data deletion, outbound messages, or any other irreversible or externally visible real-world action;
- native mobile applications, emulators, physical devices, and device farms; `responsive_mobile_chromium` is browser viewport emulation only;
- unverified, expired, rejected, or revoked targets;
- arbitrary browser extensions, arbitrary user scripts, downloads, local-file access, private-network discovery, and navigation outside verified origins.

Automated tests use local fixtures, mocks, and authorized test tenants only. A mock, recording, or synthetic run MUST be identified as such and MUST NOT be presented as a live target result.

Fixed conventions:

| Concern                            | Contract                                                          |
| ---------------------------------- | ----------------------------------------------------------------- |
| Public API prefix                  | `/api/v1`                                                         |
| Tenant scope                       | `/api/v1/tenants/{tenantId}/testing`                              |
| Internal API prefix                | `/internal/v1/testing`                                            |
| JSON casing                        | camelCase                                                         |
| Dates and times                    | RFC 3339 UTC with a literal `Z` suffix                            |
| Fractional values                  | non-negative decimal strings, never JSON floating-point numbers   |
| Identifiers                        | opaque, case-sensitive strings; generated IDs SHOULD be ULIDs     |
| Object strictness                  | unknown JSON properties are rejected                              |
| Browser                            | managed Chromium only                                             |
| Active browser sessions per run    | exactly one                                                       |
| Active job lease per run           | at most one                                                       |
| Active human control lease per run | at most one                                                       |
| Required inference provider class  | self-hosted open-weight via a provider-neutral internal interface |

`null` means unknown or not applicable as documented; it never means zero. Counts and bounded byte values are JSON integers. Durations, ratios, scores, and other fractional quantities are decimal strings.

## 2. Canonical registry and immutable versions

`docs/contracts/testing-registry.json` is the canonical machine-readable registry for statuses, transitions, decisions, events, permissions, side-effect classes, oracle types, failure sources, finding taxonomy, evidence kinds, profiles, packs, readiness gates, and stable error codes.

Registry values are closed enums. A service MUST reject unknown values and MUST NOT create compatibility aliases. Adding, removing, renaming, or reordering a registry value requires a new contract version and synchronized updates to this document, OpenAPI, acceptance matrix, and drift validator.

```ts
type Timestamp = string; // RFC 3339 UTC with Z
type DecimalString = string; // ^(?:0|[1-9]\d*)(?:\.\d+)?$
type DecimalIntegerString = string; // ^(?:0|[1-9]\d*)$
type CatalogVersion = '1.0.0';

interface VersionReference {
  key: string;
  version: CatalogVersion;
}
```

Profile and pack definitions are immutable. Runs persist the resolved definitions, target version, limits, entrypoints, and side-effect policy as one immutable `RunPlanSnapshot`. A later catalog or target change never alters an existing run. The MVP provides no profile or pack mutation endpoint.

The built-in profiles are:

- `desktop_chromium@1.0.0`: managed Chromium with a desktop viewport.
- `responsive_mobile_chromium@1.0.0`: managed Chromium with a mobile viewport and user-agent emulation; it is not native mobile testing.

The built-in packs are `smoke@1.0.0`, `functional@1.0.0`, `accessibility@1.0.0`, `visual@1.0.0`, and `exploratory@1.0.0`. Their allowed oracle types are exact in the registry. A visual pack without a compatible immutable baseline is capture-only: it emits `run.warning`, produces no visual-regression finding, and does not silently select another baseline.

## 3. Organizations, tenant isolation, authentication, and authorization

An `OrganizationResource` is the product-facing tenant. Its `id` is the canonical tenant identifier and is serialized as `tenantId` on every organization-owned resource and path. There is no separate organization ID, tenant record, tenant alias, or implicit "current tenant." A tenant rename changes only `name`, never `id`.

Authentication-session creation and refresh are the only anonymous public operations. Organization creation requires an authenticated principal and `organization.create`; organization listing returns only memberships visible to that principal. Every organization-owned public operation requires a user bearer token and the explicit `tenantId` path value. The token identifies the principal; it does not silently select or override the path tenant.

Resource resolution order is exact:

1. authenticate the bearer token;
2. resolve an active membership for `(principalId, tenantId)`;
3. check the operation's registered permission within that membership;
4. resolve the project with `(tenantId, projectId)` when the operation is project-scoped;
5. resolve the environment with `(tenantId, projectId, environmentId)` when the operation is environment-scoped;
6. resolve the requested resource with all parent keys, such as `(tenantId, projectId, environmentId, targetId)`;
7. perform state, immutable-version, and optimistic-version checks.

Missing or inactive membership returns `404 TENANT_NOT_FOUND`. A missing parent, a missing resource, and a resource owned by another tenant/project/environment return the same resource-specific `404`, with the same envelope and observably equivalent timing class. Once membership and resource scope are established, a missing permission returns `403 PERMISSION_DENIED`. The API MUST NOT perform an unscoped resource lookup before tenant scope is established and MUST NOT reveal which parent failed.

Authentication sessions contain only an opaque session ID, principal ID, issued/expiry timestamps, status, and rotation family ID. Refresh secrets are returned once, stored hashed, rotated on every refresh, and reuse revokes the family. Session revoke is idempotent. Memberships bind one principal to one organization and one registry role; role inheritance and grants are exact in the registry. Role or membership changes increment `version`, revoke affected sessions/control leases, and append an audit event.

Internal operations use `X-Internal-Token` on a private application network. Job mutations additionally require `X-Job-Lease-Token`. Neither internal route family is gateway-exposed.

Permissions are exact:

| Operation family                  | Permission                              |
| --------------------------------- | --------------------------------------- |
| organization create/read          | `organization.create` / `.read`         |
| membership read/manage            | `organization.membership.*`             |
| session revoke/manage             | `authentication.session.manage`         |
| project/environment               | matching `testing.*.read/create/manage` |
| catalog                           | `testing.catalog.read`                  |
| readiness                         | `testing.readiness.read`                |
| target list/get                   | `testing.target.read`                   |
| target create                     | `testing.target.create`                 |
| target verification decision      | `testing.target.verify`                 |
| run list/get, events, report      | `testing.run.read`                      |
| run create                        | `testing.run.create`                    |
| run pause/resume/cancel           | `testing.run.control`                   |
| resolve a requested decision      | `testing.decision.resolve`              |
| create viewer token               | `testing.viewer.create`                 |
| claim/renew/release human control | `testing.control.claim`                 |
| finding/occurrence list/get       | `testing.finding.read`                  |
| finding lifecycle operations      | matching `testing.finding.*`            |
| evidence metadata/content         | `testing.evidence.read`                 |

## 4. Targets and verification

Targets are exact web-origin allowlists. Origin values MUST be canonical HTTPS origins with no user information, path other than `/`, query, fragment, wildcard, or non-default port. Production/private/link-local/loopback IP literals and hostnames are rejected. The only exception is an explicitly marked local fixture environment, where loopback HTTP origins are allowed and results are marked `synthetic=true`.

Approval of `https://app.example.test` does not approve sibling origins, parent domains, alternate ports, HTTP, embedded credentials, or lookalikes. Redirects, popups, frames that become top-level, and tab switches are checked before interaction and again after navigation.

```ts
type TargetStatus =
  'pending_verification' | 'verified' | 'rejected' | 'revoked' | 'expired';

interface TargetVersion {
  id: string;
  targetId: string;
  environmentId: string;
  version: DecimalIntegerString;
  origin: string;
  allowedOrigins: string[]; // 1..20, unique canonical origins; includes origin
  createdAt: Timestamp;
  createdBy: string;
}

interface TargetResource {
  id: string;
  tenantId: string;
  projectId: string;
  environmentId: string;
  name: string;
  status: TargetStatus;
  currentVersion: TargetVersion;
  verificationReference: string | null;
  authorizationExpiresAt: Timestamp | null;
  verifiedAt: Timestamp | null;
  verifiedBy: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

interface CreateTargetRequest {
  projectId: string;
  environmentId: string;
  name: string; // trimmed, 1..120 Unicode code points
  origin: string;
  allowedOrigins: string[]; // 1..20
}

interface TargetVerificationDecisionRequest {
  expectedVersion: DecimalIntegerString;
  outcome: 'verify' | 'reject' | 'revoke';
  reason: string; // trimmed, 1..500
  verificationReference?: string; // required only for verify; opaque, 1..200
  authorizationExpiresAt?: Timestamp; // required only for verify; future UTC
}
```

Target creation yields `pending_verification` and an immutable version `"1"`. The permissioned verification decision is an operator attestation that authorization evidence was reviewed outside the execution worker. `verify` requires both `verificationReference` and `authorizationExpiresAt`; `reject` and `revoke` forbid them. The decision is audit-recorded. The same principal MAY create and verify only when tenant policy explicitly grants both permissions; segregation-of-duties policy is an open product choice.

No run may be created unless the target is `verified`, authorization outlives the requested run deadline, and every entrypoint belongs to the immutable allowed-origin set. A target change requires a new target in the MVP; no mutation endpoint exists.

## 5. Run state, plan, and readiness snapshot

```ts
type RunStatus =
  | 'queued'
  | 'preparing'
  | 'running'
  | 'waiting_for_decision'
  | 'paused'
  | 'cancelling'
  | 'completed'
  | 'failed'
  | 'cancelled';

interface RunLimits {
  maxDurationSeconds: number; // integer 60..3600; default 900
  maxSteps: number; // integer 1..500; default 100
  maxEvidenceBytes: number; // integer 1..104857600; default 52428800
}

interface SideEffectPolicy {
  maximumClass: 'none' | 'read_only' | 'reversible';
  requireDecisionForReversible: true;
  cleanupRequiredForReversible: true;
}

interface CreateRunRequest {
  campaignId: string;
  approvedPlanVersionId: string;
  budgetReservationId: string;
  fixtureInstanceIds: string[]; // unique, all ready and unexpired
  targetVersionId: string;
  profile: VersionReference;
  packs: VersionReference[]; // 1..5, unique keys
  objective: string; // trimmed, 3..2000 Unicode code points
  entrypoints: string[]; // 1..20 verified URLs, query and fragment forbidden
  sideEffectPolicy: SideEffectPolicy;
  limits?: Partial<RunLimits>;
  baselineRunId?: string; // only permitted when visual pack is selected
}

interface RunPlanSnapshot {
  campaignId: string;
  projectId: string;
  environmentId: string;
  approvedPlanVersionId: string;
  budgetReservationId: string;
  fixtureVersionIds: string[];
  targetVersion: TargetVersion;
  profile: VersionReference;
  packs: VersionReference[];
  objective: string;
  entrypoints: string[];
  sideEffectPolicy: SideEffectPolicy;
  limits: RunLimits;
  baselineRunId: string | null;
  catalogVersion: CatalogVersion;
}

interface Failure {
  source: FailureSource;
  code: string;
  message: string;
  retryable: boolean;
}

interface RunResource {
  id: string;
  tenantId: string;
  projectId: string;
  environmentId: string;
  campaignId: string;
  approvedPlanVersionId: string;
  budgetReservationId: string;
  status: RunStatus;
  resumeStatus: 'preparing' | 'running' | 'waiting_for_decision' | null;
  plan: RunPlanSnapshot;
  readiness: ReadinessSnapshot;
  synthetic: boolean;
  activeDecisionId: string | null;
  activeControlLeaseId: string | null;
  failure: Failure | null;
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  startedAt: Timestamp | null;
  completedAt: Timestamp | null;
  deadlineAt: Timestamp;
  lastEventId: string | null;
}
```

A campaign is the user-facing testing control plane. A run is exactly one immutable execution attempt of one approved plan version within that campaign. It is never a campaign, plan, retry group, or final result. A campaign may own multiple ordered runs; a run belongs to exactly one campaign and cannot move. Retrying creates a new run ID and job, preserving prior execution history.

The registry transition table is exact. `completed`, `failed`, and `cancelled` are terminal and immutable. Entering `paused` stores the immediately preceding resumable status as `resumeStatus`; resume returns only there. A same-status fact is idempotent and emits no state transition. Every other unlisted transition returns `409 INVALID_RUN_TRANSITION`.

The API owns state transitions. Workers propose events and outcomes; the API validates and persists them atomically with state. A worker, browser provider, or event payload cannot bypass target, decision, side-effect, lease, or terminal-state rules.

## 6. Public HTTP operations

Every path is exact; no alias is part of the MVP.

| Method and path                                                                       | Operation ID                      | Success | Permission                 |
| ------------------------------------------------------------------------------------- | --------------------------------- | ------- | -------------------------- |
| `GET /api/v1/tenants/{tenantId}/testing/catalog`                                      | `getTestingCatalog`               | `200`   | `testing.catalog.read`     |
| `GET /api/v1/tenants/{tenantId}/testing/readiness`                                    | `getTestingReadiness`             | `200`   | `testing.readiness.read`   |
| `POST /api/v1/tenants/{tenantId}/testing/targets`                                     | `createTestingTarget`             | `201`   | `testing.target.create`    |
| `GET /api/v1/tenants/{tenantId}/testing/targets`                                      | `listTestingTargets`              | `200`   | `testing.target.read`      |
| `GET /api/v1/tenants/{tenantId}/testing/targets/{targetId}`                           | `getTestingTarget`                | `200`   | `testing.target.read`      |
| `POST /api/v1/tenants/{tenantId}/testing/targets/{targetId}/verification-decisions`   | `decideTestingTargetVerification` | `200`   | `testing.target.verify`    |
| `POST /api/v1/tenants/{tenantId}/testing/runs`                                        | `createTestingRun`                | `202`   | `testing.run.create`       |
| `GET /api/v1/tenants/{tenantId}/testing/runs`                                         | `listTestingRuns`                 | `200`   | `testing.run.read`         |
| `GET /api/v1/tenants/{tenantId}/testing/runs/{runId}`                                 | `getTestingRun`                   | `200`   | `testing.run.read`         |
| `POST /api/v1/tenants/{tenantId}/testing/runs/{runId}/decisions/{decisionId}/resolve` | `resolveTestingRunDecision`       | `200`   | `testing.decision.resolve` |
| `POST /api/v1/tenants/{tenantId}/testing/runs/{runId}/control`                        | `controlTestingRun`               | `200`   | `testing.run.control`      |
| `POST /api/v1/tenants/{tenantId}/testing/runs/{runId}/control/claim`                  | `claimTestingRunControl`          | `200`   | `testing.control.claim`    |
| `POST /api/v1/tenants/{tenantId}/testing/runs/{runId}/control/renew`                  | `renewTestingRunControl`          | `200`   | `testing.control.claim`    |
| `POST /api/v1/tenants/{tenantId}/testing/runs/{runId}/control/release`                | `releaseTestingRunControl`        | `200`   | `testing.control.claim`    |
| `POST /api/v1/tenants/{tenantId}/testing/runs/{runId}/viewer-tokens`                  | `createTestingRunViewerToken`     | `201`   | `testing.viewer.create`    |
| `GET /api/v1/tenants/{tenantId}/testing/runs/{runId}/events`                          | `listTestingRunEvents`            | `200`   | `testing.run.read`         |
| `GET /api/v1/tenants/{tenantId}/testing/runs/{runId}/findings`                        | `listTestingRunFindings`          | `200`   | `testing.finding.read`     |
| `GET /api/v1/tenants/{tenantId}/testing/runs/{runId}/findings/{findingId}`            | `getTestingRunFinding`            | `200`   | `testing.finding.read`     |
| `GET /api/v1/tenants/{tenantId}/testing/runs/{runId}/evidence/{evidenceId}`           | `getTestingRunEvidence`           | `200`   | `testing.evidence.read`    |
| `GET /api/v1/tenants/{tenantId}/testing/runs/{runId}/evidence/{evidenceId}/content`   | `downloadTestingRunEvidence`      | `200`   | `testing.evidence.read`    |
| `GET /api/v1/tenants/{tenantId}/testing/runs/{runId}/report`                          | `getTestingRunReport`             | `200`   | `testing.run.read`         |

List operations use the cursor contract in section 8. All public mutations require `Idempotency-Key`. Mutable-resource commands additionally require an `expectedVersion` optimistic version.

## 7. Public mutation DTOs

```ts
interface ResolveDecisionRequest {
  outcome: 'approve' | 'deny';
  expectedVersion: DecimalIntegerString;
  reason?: string; // trimmed, 1..500
}

interface RunControlRequest {
  action: 'pause' | 'resume' | 'cancel';
  reason?: string; // trimmed, 1..500; allowed for pause/cancel only
}

interface ClaimControlRequest {
  requestedLeaseSeconds?: number; // integer 60..900; default 120
}

interface LeaseRequest {
  leaseId: string;
}

interface CreateViewerTokenRequest {
  mode: 'view' | 'control';
  leaseId?: string; // required and only permitted for control
}
```

`cancel` requests `cancelling`; the current fenced worker performs bounded cleanup and the API commits `cancelled`. If no live lease exists, the API performs platform cleanup and commits `cancelled`. Cancellation never authorizes an action that was otherwise prohibited.

## 8. Pagination, idempotency, and concurrency

All non-event list operations accept `cursor` and `limit`. `limit` is an integer from 1 through 100 and defaults to 50. Responses use:

```ts
interface PageInfo {
  nextCursor: string | null;
  hasMore: boolean;
}

interface Page<T> {
  items: T[];
  page: PageInfo;
}
```

Default list ordering is `createdAt DESC, id DESC`; findings use `observedAt DESC, id DESC`. Cursors are opaque, authenticated, expire after 24 hours, and are scoped to principal, permission, resource, sort, normalized filters, and tenant whenever the operation is tenant-scoped. A malformed or mismatched cursor returns `400 INVALID_CURSOR`; a valid pruned or expired cursor returns `410 CURSOR_EXPIRED`. Clients MUST NOT construct cursors.

Every public `POST` requires `Idempotency-Key` containing 8-128 printable ASCII characters. The key is retained for at least 24 hours and scoped to tenant + principal + method + canonical path when those identities exist. Anonymous session operations instead use method + canonical path + a server-derived one-way grant-identity fingerprint; the raw grant is never stored in the idempotency record. An identical normalized request returns the original status, headers, and body. Reuse with different content returns `409 IDEMPOTENCY_KEY_REUSED`.

Internal claim requests use their request ID as the idempotency key. Job heartbeats, events, evidence uploads, completion, and failure are idempotent under job ID + lease ID + request/event/evidence ID. Stale lease attempts are fenced and return `409 JOB_LEASE_CONFLICT` or `410 JOB_LEASE_EXPIRED`.

## 9. Decisions and side-effect policy

```ts
type DecisionType =
  | 'allow_reversible_action'
  | 'provide_authenticated_session'
  | 'continue_after_safety_pause';
type DecisionStatus = 'pending' | 'approved' | 'denied' | 'expired' | 'revoked';
type SideEffectClass =
  'none' | 'read_only' | 'reversible' | 'externally_visible' | 'irreversible';

interface DecisionResource {
  id: string;
  tenantId: string;
  runId: string;
  type: DecisionType;
  status: DecisionStatus;
  sideEffectClass: SideEffectClass;
  summary: string;
  requestedByStepId: string | null;
  expectedCleanup: string | null;
  version: DecimalIntegerString;
  requestedAt: Timestamp;
  expiresAt: Timestamp;
  resolvedAt: Timestamp | null;
  resolvedBy: string | null;
  reason: string | null;
}
```

`none` and `read_only` may run automatically within the verified origins and run plan. `reversible` requires all of:

1. the run policy maximum is `reversible`;
2. a current `allow_reversible_action` decision explicitly describes the action and cleanup;
3. the target is a non-production test environment;
4. the worker has a deterministic cleanup action and cleanup oracle;
5. approval is unexpired and unused.

Approvals are single-use and cannot be broadened. Denial or expiry returns the run to its prior safe state or ends the affected step as blocked. Revocation is allowed only before the action begins.

`externally_visible` and `irreversible` are prohibited in the MVP and cannot be approved. Examples include sending email/SMS, publishing content, creating support tickets against real systems, purchases, bookings, payment submission, destructive data operations, or changing production access. The platform pauses before uncertain actions and classifies ambiguity upward.

`provide_authenticated_session` authorizes only a human-held control lease to establish an already permitted test account session. Credentials, OTPs, cookies, and secrets MUST NOT enter API DTOs, events, evidence, logs, prompts, reports, or analytics. The autonomous worker resumes only after the human releases control and secret redaction checks pass.

## 10. Events, history, and replay

All stored events, REST history items, and WebSocket frames use:

```ts
interface EventEnvelope<T extends EventType = EventType> {
  id: string; // global idempotency key and stable cursor
  sequence: DecimalIntegerString; // API-assigned, monotonically increasing per run
  tenantId: string;
  runId: string;
  type: T;
  status: RunStatus; // status after application
  timestamp: Timestamp; // API persistence time
  payload: EventPayloadMap[T];
}
```

Event payloads are exact:

```ts
interface EventPayloadMap {
  'run.created': {
    targetVersionId: string;
    profile: VersionReference;
    packs: VersionReference[];
    synthetic: boolean;
  };
  'run.status_changed': {
    from: RunStatus;
    to: RunStatus;
    reasonCode: string | null;
  };
  'run.warning': {
    code: string;
    message: string;
    source: FailureSource;
    evidenceIds: string[];
  };
  'decision.requested': {
    decisionId: string;
    type: DecisionType;
    sideEffectClass: SideEffectClass;
    expiresAt: Timestamp;
  };
  'decision.resolved': {
    decisionId: string;
    status: Exclude<DecisionStatus, 'pending'>;
    resolvedBy: string | null;
  };
  'step.started': {
    stepId: string;
    index: number;
    action: string;
    origin: string;
    path: string;
  };
  'step.completed': {
    stepId: string;
    outcome: 'passed' | 'failed' | 'skipped' | 'blocked';
    durationSeconds: DecimalString;
    evidenceIds: string[];
  };
  'oracle.evaluated': {
    oracleId: string;
    oracleType: OracleType;
    outcome: 'passed' | 'failed' | 'inconclusive';
    occurrenceId: string | null;
    evidenceIds: string[];
  };
  'evidence.captured': {
    evidenceId: string;
    kind: EvidenceKind;
    status: 'available' | 'quarantined';
    redacted: true;
  };
  'finding.created': {
    occurrenceId: string;
    fingerprint: string;
    type: FindingType;
    severity: FindingSeverity;
    confidence: FindingConfidence;
    confidenceScore: DecimalString;
    failureSource: FailureSource;
    oracleType: OracleType;
    title: string;
    description: string;
    origin: string;
    path: string;
    stepId: string | null;
    evidenceIds: string[];
    observedAt: Timestamp;
  };
  'control.claimed': {
    leaseId: string;
    holderUserId: string;
    expiresAt: Timestamp;
  };
  'control.renewed': { leaseId: string; expiresAt: Timestamp };
  'control.released': {
    leaseId: string;
    releasedAt: Timestamp;
    recovery: 'resumed' | 'waiting_for_decision';
  };
  'control.lease_expired': {
    leaseId: string;
    expiredAt: Timestamp;
    recovery: 'pending' | 'resumed' | 'waiting_for_decision';
  };
  'report.finalized': {
    reportId: string;
    findingCount: number;
  };
  'run.completed': { completedAt: Timestamp; reportId: string };
  'run.failed': {
    failedAt: Timestamp;
    source: FailureSource;
    failureCode: string;
    retryable: boolean;
  };
  'run.cancelled': { cancelledAt: Timestamp; reason: string | null };
  'stream.reset_required': {
    reason: 'cursor_expired';
    oldestAvailableEventId: string;
    snapshotUrl: string;
  };
}
```

Payloads MUST NOT contain credentials, tokens, cookies, authorization headers, query strings, form values classified as secrets or personal data, raw request/response bodies, unredacted screenshots, local paths, private object-store URLs, or stack traces.

History accepts `after` (exclusive event ID) and `limit` (integer 1-500, default 100), ordered by persisted `sequence`. Its response is `{ events: EventEnvelope[]; nextAfter: string | null; hasMore: boolean }`. Events remain replayable for at least 30 days after a terminal status. An unknown retained-range cursor returns `409 EVENT_ID_CONFLICT`; a pruned cursor returns `410 EVENT_CURSOR_EXPIRED`.

The WebSocket uses the same events path with optional non-secret `after`. Browser clients authenticate with subprotocols `testing.events.v1` and `bearer.<viewer-token>`; the server selects only `testing.events.v1`. It replays retained events after the cursor, then streams live events without a gap. Clients deduplicate by `id`.

For a pruned cursor, the server sends one `stream.reset_required` event and closes with `4009`. The client fetches the run snapshot and restarts history without `after`; it never invents missing events. Normal closure is `1000`; authentication failure is HTTP `401` before upgrade; authorization loss closes with `4003`.

## 11. Internal durable job contract

| Method and path                                    | Operation ID                       | Success |
| -------------------------------------------------- | ---------------------------------- | ------- |
| `POST /internal/v1/testing/jobs/claim`             | `claimInternalTestingJob`          | `200`   |
| `POST /internal/v1/testing/jobs/{jobId}/heartbeat` | `heartbeatInternalTestingJob`      | `200`   |
| `POST /internal/v1/testing/jobs/{jobId}/events`    | `appendInternalTestingJobEvent`    | `202`   |
| `POST /internal/v1/testing/jobs/{jobId}/evidence`  | `uploadInternalTestingJobEvidence` | `201`   |
| `POST /internal/v1/testing/jobs/{jobId}/complete`  | `completeInternalTestingJob`       | `200`   |
| `POST /internal/v1/testing/jobs/{jobId}/fail`      | `failInternalTestingJob`           | `200`   |
| `POST /internal/v1/testing/viewer/authorize`       | `authorizeInternalTestingViewer`   | `200`   |

```ts
interface ClaimJobRequest {
  requestId: string;
  workerId: string;
  profiles: VersionReference[];
  packs: VersionReference[];
  maxJobs: 1;
}

interface JobLease {
  jobId: string;
  runId: string;
  tenantId: string;
  status: 'leased';
  attempt: number; // integer >= 1; fencing generation
  leaseId: string;
  leaseToken: string; // returned only from claim; secret
  leasedAt: Timestamp;
  leaseExpiresAt: Timestamp;
  runDeadlineAt: Timestamp;
  plan: RunPlanSnapshot;
}

interface ClaimJobResponse {
  job: JobLease | null;
  retryAfterSeconds: number; // integer 1..30
}

interface JobHeartbeatRequest {
  leaseId: string;
  attempt: number;
  workerStatus: 'running' | 'waiting_for_decision';
  lastEventId: string | null;
}

interface JobHeartbeatResponse {
  jobId: string;
  status: 'running' | 'waiting_for_decision' | 'cancelled';
  leaseExpiresAt: Timestamp;
  cancellationRequested: boolean;
}

interface AppendJobEventRequest {
  eventId: string;
  leaseId: string;
  attempt: number;
  emittedAt: Timestamp;
  type: EventType;
  payload: EventPayloadMap[EventType];
}

interface AppendJobEventResponse {
  accepted: true;
  duplicate: boolean;
  event: EventEnvelope;
}

interface CompleteJobRequest {
  requestId: string;
  leaseId: string;
  attempt: number;
  lastEventId: string;
}

interface FailJobRequest {
  requestId: string;
  leaseId: string;
  attempt: number;
  source: FailureSource;
  failureCode: string;
  message: string;
  retryable: boolean;
  evidenceIds: string[];
}

interface JobTerminalResponse {
  jobId: string;
  run: RunResource;
  duplicate: boolean;
}
```

Claim is long-poll free in MVP. `job=null` means no compatible work and includes a retry hint; it is not an error. One claim leases at most one job for 60 seconds. A worker heartbeats at least every 20 seconds; renewal is capped by `runDeadlineAt`. Delivery is at-least-once. `attempt` and the opaque lease token fence stale workers.

The API persists queued work before returning `202` from public run creation. Claim, lease renewal, event application, decision waiting, cancellation, completion, failure, and lease expiry are transactional. Lease expiry makes the prior token unusable, records `lease_expired`, and either requeues within retry policy or fails the run. The retry policy is fixed at three total attempts with delays of 1, 5, and 15 seconds; non-retryable policy/safety failures are never retried.

Events are applied in API receipt order after lease fencing. An identical event ID and normalized body returns `duplicate=true`; differing content returns `409 EVENT_ID_CONFLICT`. A stale worker cannot append evidence/events or complete/fail a job. Completion requires all required evidence to be available, all findings to reference same-run evidence, cleanup to be proven for reversible actions, no pending decision/control lease, and a final report. Failure and cancellation perform the same bounded cleanup.

Evidence upload is multipart with exactly two fields: JSON `metadata` matching `EvidenceUploadMetadata` and binary `content`. Each item is at most 10 MiB, the run total cannot exceed its plan limit, and the API computes the authoritative SHA-256. The worker-supplied digest is checked, not trusted.

## 12. Viewer and human control authorization

```ts
interface ControlLease {
  id: string;
  tenantId: string;
  runId: string;
  holderUserId: string;
  status: 'active' | 'released' | 'expired' | 'recovering';
  claimedAt: Timestamp;
  renewedAt: Timestamp;
  expiresAt: Timestamp;
}

interface ViewerTokenResponse {
  token: string;
  tokenType: 'Bearer';
  mode: 'view' | 'control';
  viewerUrl: string; // same public origin under /viewer/; never contains token
  expiresAt: Timestamp;
}

interface ViewerAuthorization {
  authorized: true;
  tenantId: string;
  runId: string;
  mode: 'view' | 'control';
  userId: string;
  leaseId: string | null;
  expiresAt: Timestamp;
}
```

Claim is permitted from `running`, `waiting_for_decision`, or `paused`. The API fences the worker and confirms automation is paused before making the exclusive lease active. Automation and human control MUST NOT be active concurrently.

A lease defaults to 120 seconds, may request 60-900 seconds, renews every 30 seconds, and never exceeds `deadlineAt`. Release revokes input before resuming the stored status. On expiry, input is denied immediately and the lease becomes `recovering`; API recovery keeps automation paused until browser state and redaction checks pass. Failed recovery remains safely paused until retry, cancellation, or deadline cleanup.

Viewer JWTs use only HS256 with exact claims: `iss="testing-api"`, `aud="testing-viewer"`, `sub=<runId>`, `tenantId`, `jti`, `mode`, `userId`, `leaseId`, `iat`, `nbf`, and `exp`. Maximum lifetime is 15 minutes and never exceeds the run deadline; control lifetime also never exceeds the lease.

Authorization validates signature, algorithm, issuer, audience, time, tenant membership, permission, run state, and current lease on every HTTP/WebSocket request. The token is supplied in `Authorization` or the WebSocket bearer subprotocol, never a URL, log, report, evidence item, screenshot, persistent client storage, or `viewerUrl`. Internal authorization receives both `X-Internal-Token` and `Authorization: Bearer <viewer-token>`.

Human control does not expand target origins or side-effect policy. Live payments, externally visible actions, and irreversible actions remain prohibited during control.

## 13. Evidence contract and access

```ts
type EvidenceKind =
  | 'screenshot'
  | 'dom_snapshot'
  | 'accessibility_tree'
  | 'console_log'
  | 'network_log'
  | 'browser_trace'
  | 'oracle_result'
  | 'action_log'
  | 'human_note';

interface EvidenceUploadMetadata {
  evidenceId: string;
  leaseId: string;
  attempt: number;
  kind: EvidenceKind;
  mediaType: string;
  sha256: string; // lowercase 64-character hex
  byteLength: number;
  capturedAt: Timestamp;
  stepId: string | null;
  redacted: true;
}

interface EvidenceResource {
  id: string;
  tenantId: string;
  runId: string;
  kind: EvidenceKind;
  status: 'available' | 'quarantined' | 'deleted';
  mediaType: string;
  sha256: string;
  byteLength: number;
  capturedAt: Timestamp;
  stepId: string | null;
  redacted: true;
  retentionExpiresAt: Timestamp;
}
```

Allowed media types are exact:

| Evidence kind        | Media types               |
| -------------------- | ------------------------- |
| `screenshot`         | `image/png`, `image/jpeg` |
| `dom_snapshot`       | `text/html`               |
| `accessibility_tree` | `application/json`        |
| `console_log`        | `application/json`        |
| `network_log`        | `application/json`        |
| `browser_trace`      | `application/zip`         |
| `oracle_result`      | `application/json`        |
| `action_log`         | `application/json`        |
| `human_note`         | `text/plain`              |

Evidence is immutable after acceptance. Reusing an evidence ID with different bytes or metadata returns `409 EVENT_ID_CONFLICT`. Content is encrypted in transit and at rest, tenant-keyed, and retained for at least 30 days after terminal status unless tenant policy requires longer. Deletion retains a non-sensitive tombstone and digest.

Before upload, the worker removes authorization headers, cookies, storage values, tokens, credentials, personal data, payment fields, query strings, response bodies, and other configured secrets. DOM and accessibility evidence includes only the minimum subtree needed for the oracle. Network evidence contains method, canonical origin/path, status, safe timing, and approved header names; it excludes bodies and sensitive headers. Quarantined evidence cannot satisfy an oracle or finding and cannot be downloaded.

Metadata access returns JSON. Content access streams from the API/gateway with `Cache-Control: private, no-store`, a safe `Content-Disposition`, content sniffing disabled, and no redirect to a persistent or public object URL. Tenant, run, evidence, permission, retention, and quarantine checks are performed on every request. Object-store keys and signed provider URLs are never public contract fields.

## 14. Findings, oracles, and report

```ts
type FindingState =
  | 'open'
  | 'triaged'
  | 'expected_behavior'
  | 'fix_claimed'
  | 'retest_pending'
  | 'resolved'
  | 'closed'
  | 'dismissed';
type FindingType =
  | 'functional'
  | 'visual'
  | 'accessibility'
  | 'content'
  | 'console'
  | 'network'
  | 'performance';
type FindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
type FindingConfidence = 'confirmed' | 'high' | 'medium' | 'low';
type FailureSource =
  | 'product'
  | 'test_definition'
  | 'agent'
  | 'browser'
  | 'target_environment'
  | 'platform'
  | 'provider'
  | 'policy'
  | 'unknown';
type OracleType =
  | 'url'
  | 'dom'
  | 'text'
  | 'http_status'
  | 'accessibility'
  | 'visual'
  | 'console'
  | 'network'
  | 'semantic'
  | 'human_review';

interface FindingOccurrenceResource {
  id: string;
  tenantId: string;
  projectId: string;
  environmentId: string;
  campaignId: string;
  runId: string;
  canonicalFindingId: string;
  fingerprint: string;
  type: FindingType;
  severity: FindingSeverity;
  confidence: FindingConfidence;
  confidenceScore: DecimalString;
  failureSource: FailureSource;
  oracleType: OracleType;
  title: string;
  description: string;
  origin: string;
  path: string;
  stepId: string | null;
  evidenceIds: string[]; // non-empty, same run, available
  observedAt: Timestamp;
  createdAt: Timestamp;
}

interface RunReport {
  id: string;
  tenantId: string;
  runId: string;
  status: 'in_progress' | 'final';
  generatedAt: Timestamp;
  startedAt: Timestamp | null;
  completedAt: Timestamp | null;
  durationSeconds: DecimalString | null;
  steps: {
    total: number;
    passed: number;
    failed: number;
    blocked: number;
    skipped: number;
  };
  findings: {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
  };
  oracleSummary: Array<{
    type: OracleType;
    passed: number;
    failed: number;
    inconclusive: number;
  }>;
  findingOccurrenceIds: string[];
  evidenceIds: string[];
  warnings: Array<{
    code: string;
    message: string;
    source: FailureSource;
    evidenceIds: string[];
  }>;
  conclusion: {
    outcome: 'passed' | 'failed' | 'inconclusive' | 'cancelled';
    statement: string;
  } | null;
}
```

Finding occurrences are immutable execution observations. Canonical finding identity and lifecycle are defined in section 26; state is never stored on or mutated through an occurrence. The run finding operations return occurrences and retain their historical operation IDs for compatibility.

Every finding has at least one available same-run evidence item and one oracle result. Semantic or visual uncertainty uses `confidence=low` and cannot produce `critical` without a confirming deterministic or human-review oracle. Accessibility severity follows the pinned rule metadata. Performance findings are single-session observational timing findings only; they are not load or capacity claims.

The report is `in_progress` until terminal status. A terminal report is `final` and immutable. Counts reconcile exactly with referenced steps/findings, all IDs belong to the run, and all fractional values are decimal strings. A cancelled or failed run may have partial evidence and findings but MUST use a scope-qualified conclusion and identify gaps. The system never claims absence of defects outside executed entrypoints, packs, profiles, and oracles.

## 15. Error contract

Every non-2xx HTTP response, public or internal, uses:

```ts
interface ErrorResponse {
  error: {
    code: StableErrorCode;
    message: string; // safe, non-localized
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

Stable codes and HTTP mappings are exact in the registry. Responses never echo tokens, credentials, cookies, personal or payment data, evidence content, query strings, upstream bodies, object-store locations, lease tokens, or stack traces. `429 RATE_LIMITED` includes an integer `Retry-After`.

| HTTP  | Stable codes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `400` | `VALIDATION_ERROR`, `INVALID_CURSOR`, `UNSUPPORTED_PROFILE`, `UNSUPPORTED_PACK`, `TARGET_ORIGIN_INVALID`, `SIDE_EFFECT_NOT_ALLOWED`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `401` | `SESSION_INVALID`, `UNAUTHENTICATED`, `INVALID_VIEWER_TOKEN`, `INVALID_INTERNAL_TOKEN`, `INVALID_JOB_LEASE`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `403` | `PERMISSION_DENIED`, `TARGET_NOT_VERIFIED`, `CONTROL_NOT_ALLOWED`, `EVIDENCE_ACCESS_DENIED`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `404` | `TENANT_NOT_FOUND`, `ORGANIZATION_NOT_FOUND`, `AUTHENTICATION_SESSION_NOT_FOUND`, `MEMBERSHIP_NOT_FOUND`, `PROJECT_NOT_FOUND`, `ENVIRONMENT_NOT_FOUND`, `APPLICATION_ROLE_NOT_FOUND`, `CREDENTIAL_HANDLE_NOT_FOUND`, `FIXTURE_NOT_FOUND`, `FIXTURE_VERSION_NOT_FOUND`, `FIXTURE_INSTANCE_NOT_FOUND`, `CAMPAIGN_NOT_FOUND`, `REQUIREMENT_SOURCE_NOT_FOUND`, `REQUIREMENT_INGESTION_NOT_FOUND`, `REQUIREMENT_NOT_FOUND`, `REQUIREMENT_VERSION_NOT_FOUND`, `DISCOVERY_NOT_FOUND`, `DISCOVERY_VERSION_NOT_FOUND`, `PLAN_NOT_FOUND`, `PLAN_VERSION_NOT_FOUND`, `CAMPAIGN_PROFILE_NOT_FOUND`, `BUDGET_RESERVATION_NOT_FOUND`, `CANONICAL_FINDING_NOT_FOUND`, `FINDING_OCCURRENCE_NOT_FOUND`, `FIX_CLAIM_NOT_FOUND`, `RETEST_NOT_FOUND`, `RISK_ACCEPTANCE_NOT_FOUND`, `EXPORT_NOT_FOUND`, `TARGET_NOT_FOUND`, `RUN_NOT_FOUND`, `DECISION_NOT_FOUND`, `FINDING_NOT_FOUND`, `EVIDENCE_NOT_FOUND`, `JOB_NOT_FOUND` |
| `409` | `IDEMPOTENCY_KEY_REUSED`, `INVALID_RUN_TRANSITION`, `INVALID_DOMAIN_TRANSITION`, `STALE_RESOURCE_VERSION`, `VERSION_IMMUTABLE`, `PLAN_NOT_APPROVED`, `ENVIRONMENT_NOT_READY`, `BUDGET_RESERVATION_EXHAUSTED`, `CLEANUP_RESERVE_EXHAUSTED`, `DECISION_ALREADY_RESOLVED`, `CONTROL_LEASE_CONFLICT`, `EVENT_ID_CONFLICT`, `JOB_LEASE_CONFLICT`, `JOB_ALREADY_TERMINAL`, `TARGET_VERIFICATION_CONFLICT`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `410` | `CURSOR_EXPIRED`, `EVENT_CURSOR_EXPIRED`, `CONTROL_LEASE_EXPIRED`, `JOB_LEASE_EXPIRED`, `EVIDENCE_EXPIRED`, `CREDENTIAL_HANDLE_EXPIRED`, `EXPORT_EXPIRED`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `413` | `EVIDENCE_TOO_LARGE`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `415` | `EVIDENCE_MEDIA_TYPE_UNSUPPORTED`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `429` | `RATE_LIMITED`, `QUOTA_EXCEEDED`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `500` | `INTERNAL_ERROR`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `502` | `EXECUTION_PROVIDER_UNAVAILABLE`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `503` | `NOT_READY`, `DEPENDENCY_UNAVAILABLE`, `NO_CAPABLE_WORKER`, `FINAL_RESULT_NOT_READY`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

Validation uses `400`, not `422`. Internal/provider failures never advance API state unless a transaction described by this contract committed. A `502 EXECUTION_PROVIDER_UNAVAILABLE` or `503 DEPENDENCY_UNAVAILABLE` leaves the run safely queued/paused or terminal according to the durable retry policy.

## 16. Readiness gates

```ts
interface ReadinessGate {
  name:
    | 'database'
    | 'durable_jobs'
    | 'browser_runtime'
    | 'evidence_store'
    | 'event_store'
    | 'viewer_gateway'
    | 'viewer_signing_key'
    | 'policy_registry'
    | 'target_verified'
    | 'catalog_compatible'
    | 'local_inference'
    | 'ai_capabilities';
  status: 'pass' | 'warn' | 'fail';
  required: boolean;
  code: string | null;
  checkedAt: Timestamp;
}

interface ReadinessSnapshot {
  status: 'ready' | 'degraded' | 'not_ready';
  checkedAt: Timestamp;
  expiresAt: Timestamp;
  gates: ReadinessGate[];
  inference: InferenceCapabilityDeclaration | null;
}
```

All twelve named gates are present exactly once. For run creation, all are required. `ready` means every gate passes. `degraded` is used only by the standalone readiness endpoint when all required gates pass and an operational warning exists; it is not accepted for run creation. `not_ready` means at least one required failure.

Readiness is evaluated after tenant and target resolution and no more than 30 seconds before run creation. Failure returns `503 NOT_READY` with one safe detail per failed gate. The snapshot is persisted with the run for audit, but workers recheck target validity, policy registry version, lease fencing, and provider availability before execution. A later target revocation immediately pauses/cancels affected runs.

Tests and local fixtures MAY replace provider gates with deterministic fakes only when `synthetic=true`. Production readiness MUST fail closed for missing database durability, job leasing, evidence/event storage, browser isolation, viewer authorization, signing keys, policy registry, target verification, catalog compatibility, local inference, or required inference capabilities.

## 17. Local inference and minimum AI capability contract

The required MVP inference provider class is `self_hosted_open_weight`. Local development, automated testing, the controlled benchmark, and MVP deployment MUST operate without paid inference APIs, paid credits, external AI accounts, or external AI API keys. No OpenRouter, OpenAI, Anthropic, or other hosted-provider key is a readiness input. Paid hosted inference providers are outside MVP scope.

Self-hosting removes hosted-provider fees; it does not make inference resource-free. Operators remain responsible for sufficient local CPU/GPU capacity, memory, storage, electricity, model licensing, and operational security. Insufficient local capacity fails readiness rather than silently falling back to a hosted service.

Public HTTP, event, evidence, finding, and report contracts remain provider-neutral. They MUST NOT expose vendor names, model names, inference-engine names, SDK types, provider response shapes, local filesystem paths, credentials, API keys, hidden reasoning, or raw model transcripts. The exact open-weight model and inference engine are replaceable runtime configuration behind the internal interface.

The canonical inference registry values are:

```ts
type InferenceProviderClass = 'self_hosted_open_weight';
type InferenceCapability =
  | 'structured_output'
  | 'tool_call_proposals'
  | 'vision_input'
  | 'cancellation'
  | 'timeout'
  | 'bounded_context'
  | 'bounded_output'
  | 'deterministic_failures';
type InferenceFailureReason =
  | 'unavailable'
  | 'timeout'
  | 'cancelled'
  | 'capability_missing'
  | 'context_limit'
  | 'output_limit'
  | 'invalid_structured_output'
  | 'retry_exhausted';

interface InferenceCapabilityDeclaration {
  interfaceVersion: '1.0.0';
  structuredOutput: true;
  toolCallProposals: true;
  visionInput: boolean;
  cancellation: true;
  timeout: true;
  deterministicFailures: true;
  supportedSchemaVersions: ['1.0.0'];
  maxContextTokens: number; // integer >= 8192
  maxOutputTokens: number; // integer >= 1024
}
```

Every MVP campaign requires `structured_output`, `tool_call_proposals`, `cancellation`, `timeout`, `bounded_context`, `bounded_output`, and `deterministic_failures`. A workflow may send image evidence only when its resolved pack explicitly requires `vision_input`; in catalog version `1.0.0`, only the `visual` pack requires it. Other packs may capture screenshots as evidence but MUST NOT send them to inference.

The provider-neutral internal request contract includes an opaque request ID, input schema name/version, output schema name/version, resolved toolset version, required capabilities, redacted input, permitted evidence IDs, context/output limits, and an absolute deadline. Tool definitions and output schemas are versioned, closed, and strict. The response is either:

- a structured proposal that validates exactly against the requested output schema, with zero or more tool-call proposals that validate against the resolved tool schemas; or
- a deterministic `InferenceFailureReason`.

No provider-specific field is accepted or returned. A tool call is a proposal only. It has no authority until the API and runner apply the normal tenant, target, permission, budget, side-effect, decision, lease, and state checks.

Inference calls default to a 60-second timeout, are capped at 120 seconds, and use at most two total attempts. Only `unavailable`, `timeout`, or `invalid_structured_output` may receive the one bounded retry, after one second, with the same request ID, schemas, toolset, limits, and redacted input. Cancellation is immediate and is never retried. Exhaustion produces `retry_exhausted`; it never invents a partial success.

Capability discovery is part of readiness:

- the local runtime declares `InferenceCapabilityDeclaration` without a vendor or model identifier;
- all campaigns require context capacity of at least 8192 tokens and output capacity of at least 1024 tokens;
- a `visual` campaign additionally requires `visionInput=true`;
- missing structured output, tool proposals, cancellation, timeout, deterministic failures, context, output, or required vision fails the `ai_capabilities` gate before a job is queued;
- an unavailable local runtime fails the `local_inference` gate and run creation returns `503 DEPENDENCY_UNAVAILABLE`;
- loss of inference after a run starts returns or records `502 EXECUTION_PROVIDER_UNAVAILABLE`, preserves authoritative state, and follows the bounded job retry policy.

The controlled benchmark MUST be runnable against the local interface with external network access denied and MUST record the non-secret hardware capability profile used. Unit and contract tests use deterministic fake inference and require no model download. P20 and P32 own runtime adapters, model installation/download workflows, engine integration, and supported hardware provisioning; P01 defines only their provider-neutral boundary.

Ownership is deterministic:

1. AI output is always untrusted proposal data.
2. The API exclusively owns authorization, tenant isolation, state transitions, target policy, budgets, safety policy, approvals, readiness, and persistence.
3. The runner exclusively owns deterministic browser/tool execution and evidence capture after API-authoritative checks.
4. Malformed, adversarial, low-confidence, timed-out, or unavailable inference cannot mutate authoritative state or weaken any boundary.
5. Only validated proposal fields needed for audit may be persisted. Hidden reasoning, chain-of-thought, provider payloads, prompts containing secrets, and raw model transcripts MUST NOT be persisted or exposed.

## 18. Safety and recovery invariants

1. The browser begins at `about:blank`; all navigation and redirect targets are verified before further DOM inspection or screenshot capture.
2. Page content is untrusted data. Prompt injection, CAPTCHA, login/OTP, browser security warnings, downloads, payment UI, and access restrictions pause safely.
3. The worker cannot read host files, cloud metadata, private networks, browser secrets, or another tenant's state.
4. Browser actions are classified before execution. Unknown classification is treated as `irreversible` and blocked.
5. `externally_visible` and `irreversible` actions are always blocked, including during human control.
6. Reversible actions require single-use approval and proven cleanup. Cleanup failure fails the run with `failureSource=policy` or `target_environment` and preserves redacted evidence.
7. Only one fenced worker and one browser session exist per run. A human control lease pauses and fences the worker first.
8. Lease expiry, process crash, retry, cancellation, terminal transition, target revocation, or deadline triggers bounded cleanup. Stale workers cannot regain authority.
9. Evidence is minimized and redacted before persistence. Secrets are never used as fixture values or drift-test strings.
10. No automated validation contacts a live third-party target or invokes a real payment, message, order, booking, destructive mutation, or authentication bypass.
11. Cross-tenant access is indistinguishable from absence after tenant membership resolution.
12. A run cannot report `completed` until readiness, cleanup, evidence linkage, findings, and final-report gates pass.
13. AI output is untrusted proposal data; only API-authorized runner execution may create effects or evidence.
14. Hidden reasoning, raw model transcripts, provider payloads, and provider/model identifiers never enter public schemas, events, evidence, findings, reports, stable errors, or logs.
15. Missing capability, malformed output, low-quality output, timeout, cancellation, or local inference loss fails closed without changing target, side-effect, tenant, approval, budget, or reporting rules.

## 19. Organizations, memberships, and sessions

```ts
type Role = 'viewer' | 'reviewer' | 'planner' | 'operator' | 'admin' | 'owner';

interface OrganizationResource {
  id: string; // exactly the tenantId used everywhere else
  name: string;
  status: 'active' | 'suspended';
  version: DecimalIntegerString;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

interface MembershipResource {
  id: string;
  tenantId: string;
  principalId: string;
  role: Role;
  status: 'invited' | 'active' | 'suspended' | 'revoked';
  version: DecimalIntegerString;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

interface AuthenticationSessionResource {
  id: string;
  principalId: string;
  status: 'active' | 'revoked' | 'expired';
  rotationFamilyId: string;
  issuedAt: Timestamp;
  expiresAt: Timestamp;
  revokedAt: Timestamp | null;
}
```

Organization creation makes the creator an active `owner` in the same transaction. Invitation creates `invited`; activation requires proof that the authenticated principal owns the invitation address or external identity. Membership transitions and role changes require `expectedVersion`. The last active owner cannot be suspended, revoked, or demoted. Session expiry is clock-driven; refresh rotates its secret without changing the session ID, while revoke is terminal. `listTestingDomainEvents` replays tenant-domain events by opaque `after` sequence with the same no-gap, bounded-retention, cursor-expiry, and tenant authorization rules as run-event history; it returns `DomainEventEnvelope` values and never accepts client-appended events.

## 20. Projects, environments, and environment-scoped targets

```ts
interface ProjectResource {
  id: string;
  tenantId: string;
  name: string;
  status: 'active' | 'archived';
  version: DecimalIntegerString;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

interface EnvironmentVersion {
  id: string;
  environmentId: string;
  version: DecimalIntegerString;
  type: 'development' | 'staging' | 'production';
  entrypoints: string[];
  configuration: Record<string, string>; // non-secret allowlisted settings
  productionPolicy:
    'deny' | 'manual_approval_each_campaign' | 'preapproved_reversible_only';
  createdAt: Timestamp;
  createdBy: string;
}

interface EnvironmentResource {
  id: string;
  tenantId: string;
  projectId: string;
  name: string;
  status: 'draft' | 'pending_verification' | 'ready' | 'suspended' | 'archived';
  currentVersion: EnvironmentVersion;
  verificationReference: string | null;
  authorizationExpiresAt: Timestamp | null;
  version: DecimalIntegerString;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

Projects group environments and cannot move organizations. Environments cannot move projects. Every target belongs to exactly one environment and inherits its project and tenant. Creating an environment version never mutates an older version and moves the environment to `pending_verification`. Verification applies to the exact version. Production defaults to `deny`; production can never relax the global prohibition on externally visible, irreversible, live-payment, or destructive actions. Staging and development still require target authorization and the same safety policy.

## 21. Application roles, credential handles, and fixtures

```ts
interface ApplicationRoleResource {
  id: string;
  tenantId: string;
  projectId: string;
  environmentId: string;
  name: string;
  type: 'anonymous' | 'standard_user' | 'privileged_user' | 'administrator';
  status: 'active' | 'disabled' | 'archived';
  credentialHandleId: string | null;
  version: DecimalIntegerString;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

interface CredentialHandleResource {
  id: string;
  tenantId: string;
  projectId: string;
  environmentId: string;
  label: string;
  status: 'active' | 'expired' | 'revoked';
  expiresAt: Timestamp | null;
  createdAt: Timestamp;
  revokedAt: Timestamp | null;
}

interface FixtureVersion {
  id: string;
  fixtureId: string;
  version: DecimalIntegerString;
  setupSteps: TestStep[];
  cleanupSteps: TestStep[];
  expiresAfterSeconds: number;
  createdAt: Timestamp;
  createdBy: string;
}

interface FixtureResource {
  id: string;
  tenantId: string;
  projectId: string;
  environmentId: string;
  name: string;
  status: 'draft' | 'in_review' | 'approved' | 'rejected' | 'retired';
  currentVersion: FixtureVersion;
  version: DecimalIntegerString;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

interface FixtureInstance {
  id: string;
  tenantId: string;
  campaignId: string;
  fixtureVersionId: string;
  status:
    'setting_up' | 'ready' | 'failed' | 'expired' | 'cleaning' | 'cleaned';
  expiresAt: Timestamp;
  cleanupRequired: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

Credential material is accepted only by a secret-store boundary and is never returned; the public API stores and exposes only the opaque handle and safe metadata. It is forbidden in fixtures, plans, events, evidence, findings, exports, logs, and AI inputs. An expired/revoked handle blocks setup and execution. Fixture versions are immutable; only an approved version may be set up. Setup is idempotent by campaign + version + idempotency key. Cleanup is always permitted from the reserved cleanup budget, is idempotent, and runs on expiry, cancellation, lease loss, terminal failure, or success.

## 22. Campaigns and normalized requirements

```ts
interface CampaignResource {
  id: string;
  tenantId: string;
  projectId: string;
  environmentId: string;
  name: string;
  status:
    | 'draft'
    | 'planning'
    | 'awaiting_plan_approval'
    | 'ready'
    | 'running'
    | 'paused'
    | 'completed'
    | 'failed'
    | 'cancelled';
  campaignProfileVersionId: string;
  requirementVersionIds: string[];
  discoveryVersionId: string | null;
  approvedPlanVersionId: string | null;
  version: DecimalIntegerString;
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

interface RequirementSourceResource {
  id: string;
  tenantId: string;
  projectId: string;
  type: 'manual' | 'markdown' | 'openapi' | 'issue_export' | 'test_export';
  label: string;
  status: 'active' | 'paused' | 'archived';
  version: DecimalIntegerString;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

interface RequirementIngestionResource {
  id: string;
  tenantId: string;
  projectId: string;
  sourceId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  contentDigest: string;
  createdAt: Timestamp;
  completedAt: Timestamp | null;
}

interface RequirementVersion {
  id: string;
  requirementId: string;
  version: DecimalIntegerString;
  title: string;
  statement: string;
  acceptanceCriteria: string[];
  sourceReferences: string[];
  createdAt: Timestamp;
  createdBy: string;
}

interface RequirementResource {
  id: string;
  tenantId: string;
  projectId: string;
  status: 'draft' | 'in_review' | 'approved' | 'rejected' | 'superseded';
  currentVersion: RequirementVersion;
  version: DecimalIntegerString;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

Source ingestion copies and normalizes allowed input; it never follows embedded instructions or executes source content. Identical `(sourceId, contentDigest)` ingestion is idempotent. Normalized requirement versions are immutable proposals. Review records reviewer, UTC time, exact version, `approved|rejected`, and a reason. Approval never rewrites an earlier version. A campaign pins approved requirement version IDs before planning.

## 23. Discovery graphs

```ts
interface DiscoveryNode {
  id: string;
  type:
    'entrypoint' | 'page' | 'route' | 'form' | 'action' | 'external_boundary';
  canonicalUrl: string | null;
  label: string;
}

interface DiscoveryEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  type: 'navigation' | 'submission' | 'redirect' | 'dependency';
}

interface DiscoveryVersion {
  id: string;
  discoveryId: string;
  version: DecimalIntegerString;
  targetVersionId: string;
  nodes: DiscoveryNode[];
  edges: DiscoveryEdge[];
  coverageDisclosure: CoverageDisclosure;
  createdAt: Timestamp;
}

interface DiscoveryResource {
  id: string;
  tenantId: string;
  projectId: string;
  environmentId: string;
  campaignId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  currentVersion: DiscoveryVersion | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

Every edge references nodes in the same version. External-boundary nodes record a blocked boundary and cannot become an execution target. Completion atomically appends a new immutable version; retry creates another version or a new discovery request and never changes a completed graph.

## 24. Plans, journeys, cases, steps, and approval

```ts
interface OracleDefinition {
  id: string;
  type: OracleType;
  expected: Record<string, string>;
}

interface EvidenceRequirement {
  id: string;
  kind: EvidenceKind;
  required: boolean;
  retentionClass: 'standard';
}

interface TestStep {
  id: string;
  action: string;
  sideEffectClass: SideEffectClass;
  applicationRoleId: string;
  oracleIds: string[];
  evidenceRequirementIds: string[];
  cleanupStepIds: string[];
}

interface TestCase {
  id: string;
  title: string;
  requirementVersionIds: string[];
  steps: TestStep[];
}

interface CriticalJourney {
  id: string;
  title: string;
  priority: 'critical' | 'high' | 'normal';
  testCases: TestCase[];
}

interface PlanVersion {
  id: string;
  planId: string;
  version: DecimalIntegerString;
  campaignId: string;
  requirementVersionIds: string[];
  discoveryVersionId: string;
  journeys: CriticalJourney[];
  oracles: OracleDefinition[];
  evidenceRequirements: EvidenceRequirement[];
  estimatedDurationSeconds: DecimalString;
  estimatedSteps: number;
  estimatedEvidenceBytes: DecimalIntegerString;
  createdAt: Timestamp;
  createdBy: string;
}

interface PlanResource {
  id: string;
  tenantId: string;
  projectId: string;
  environmentId: string;
  campaignId: string;
  status: 'draft' | 'in_review' | 'approved' | 'rejected' | 'superseded';
  currentVersion: PlanVersion;
  approvedVersionId: string | null;
  version: DecimalIntegerString;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

Plan creation and AI-assisted planning create untrusted drafts only. Review uses an exact immutable version and optimistic resource version. Approval is rejected unless every requirement reference is approved, the discovery version is complete, every oracle/evidence/cleanup reference resolves, estimates fit a campaign profile, and all actions remain within MVP policy. Approved versions are immutable and cannot be silently replaced; changing intent creates a new draft version and requires a new approval. Only `approvedVersionId` can be attached to a run.

## 25. Campaign profiles, budgets, reservations, usage, and quotas

```ts
interface ResourceBudget {
  maxRuns: number;
  maxSteps: number;
  maxDurationSeconds: DecimalIntegerString;
  maxEvidenceBytes: DecimalIntegerString;
  maxInferenceTokens: DecimalIntegerString;
  cleanupReservePercent: DecimalString;
}

interface CampaignProfileVersion {
  id: string;
  campaignProfileId: string;
  version: DecimalIntegerString;
  budget: ResourceBudget;
  runLimits: RunLimits;
  createdAt: Timestamp;
  createdBy: string;
}

interface CampaignProfileResource {
  id: string;
  tenantId: string;
  projectId: string;
  name: string;
  status: 'active' | 'archived';
  currentVersion: CampaignProfileVersion;
  version: DecimalIntegerString;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

interface QuotaResource {
  id: string;
  tenantId: string;
  projectId: string | null;
  scope: 'organization' | 'project' | 'campaign';
  limits: ResourceBudget;
  used: ResourceUsage;
  resetsAt: Timestamp | null;
}

interface ResourceUsage {
  runs: number;
  steps: number;
  durationSeconds: DecimalIntegerString;
  evidenceBytes: DecimalIntegerString;
  inferenceTokens: DecimalIntegerString;
  cleanupSteps: number;
}

interface BudgetReservationResource {
  id: string;
  tenantId: string;
  projectId: string;
  campaignId: string;
  campaignProfileVersionId: string;
  status: 'pending' | 'active' | 'exhausted' | 'released' | 'expired';
  reserved: ResourceBudget;
  used: ResourceUsage;
  cleanupReserveRemaining: ResourceUsage;
  expiresAt: Timestamp;
  version: DecimalIntegerString;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

These values meter testing resources, not money, billing, credits, or MonetizePilot. Reservation is atomic across organization/project/campaign quotas. Usage is append-only and idempotent by `(reservationId, usageEventId)`. Ordinary execution stops before exceeding any dimension and returns `429 QUOTA_EXCEEDED` or `409 BUDGET_RESERVATION_EXHAUSTED`; cleanup alone can consume the isolated reserve. Cleanup-reserve exhaustion stops further target actions, attempts platform cleanup, fails closed, and records `CLEANUP_RESERVE_EXHAUSTED`. Releasing a reservation is terminal and returns unused capacity.

## 26. Persistent findings and immutable occurrences

```ts
interface CanonicalFindingResource {
  id: string;
  tenantId: string;
  projectId: string;
  environmentId: string;
  fingerprint: string;
  type: FindingType;
  title: string;
  state: FindingState;
  severity: FindingSeverity;
  assigneePrincipalId: string | null;
  expectedBehavior: boolean;
  latestOccurrenceId: string;
  occurrenceCount: number;
  activeFixClaimId: string | null;
  version: DecimalIntegerString;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

interface FindingComment {
  id: string;
  findingId: string;
  authorPrincipalId: string;
  body: string;
  createdAt: Timestamp;
}

interface FindingAssignment {
  id: string;
  findingId: string;
  assigneePrincipalId: string | null;
  assignedBy: string;
  createdAt: Timestamp;
}

interface FixClaimResource {
  id: string;
  findingId: string;
  status: 'active' | 'superseded' | 'verified' | 'rejected';
  reference: string;
  claimedBy: string;
  createdAt: Timestamp;
}

interface RetestResource {
  id: string;
  findingId: string;
  campaignId: string;
  runId: string | null;
  status: 'queued' | 'running' | 'passed' | 'failed' | 'cancelled';
  createdAt: Timestamp;
  completedAt: Timestamp | null;
}

interface RiskAcceptanceResource {
  id: string;
  findingId: string;
  status: 'active' | 'revoked' | 'expired';
  rationale: string;
  acceptedBy: string;
  expiresAt: Timestamp;
  createdAt: Timestamp;
  revokedAt: Timestamp | null;
}
```

The deduplication key is tenant + project + environment + normalized fingerprint. Recording a finding occurrence is atomic: append the immutable occurrence, attach it to exactly one canonical finding, and update that finding's summary/version. It never changes an earlier occurrence. Reproduction creates another campaign/run occurrence. Assignment and comments append history. Expected-behavior marking changes canonical state and records reason/reviewer. A fix claim is not proof; it moves to retest. Only a passed retest against the claimed fix can resolve it, and closure is a separate reviewed transition. Risk acceptance is stored separately, expires, never changes the finding state, and never suppresses occurrences or evidence.

## 27. Readiness, coverage, exports, and immutable final results

```ts
interface CampaignReadinessReport {
  id: string;
  tenantId: string;
  campaignId: string;
  ready: boolean;
  checkedAt: Timestamp;
  campaignVersion: DecimalIntegerString;
  approvedPlanVersionId: string | null;
  budgetReservationId: string | null;
  gates: ReadinessGate[];
  blockers: string[];
}

interface CoverageDisclosure {
  entrypointsPlanned: number;
  entrypointsExecuted: number;
  requirementsPlanned: number;
  requirementsExecuted: number;
  journeysPlanned: number;
  journeysExecuted: number;
  exclusions: string[];
  limitations: string[];
}

interface ExportResource {
  id: string;
  tenantId: string;
  campaignId: string;
  finalResultId: string;
  format: 'json' | 'junit_xml' | 'sarif' | 'html';
  status: 'queued' | 'running' | 'completed' | 'failed' | 'expired';
  contentDigest: string | null;
  expiresAt: Timestamp;
  createdAt: Timestamp;
  completedAt: Timestamp | null;
}

interface CampaignFinalResult {
  id: string;
  tenantId: string;
  projectId: string;
  environmentId: string;
  campaignId: string;
  approvedPlanVersionId: string;
  campaignProfileVersionId: string;
  runIds: string[];
  findingOccurrenceIds: string[];
  canonicalFindingIds: string[];
  coverage: CoverageDisclosure;
  outcome: 'passed' | 'failed' | 'inconclusive' | 'cancelled';
  generatedAt: Timestamp;
}
```

Readiness is a deterministic projection and is not approval. It includes environment/target verification, approved pinned inputs, fixture validity, policy, capacity, quota/reservation, cleanup reserve, and local inference gates. Finalization requires a terminal campaign, terminal runs, reconciled usage, attempted cleanup, complete occurrence/evidence links, and coverage disclosure. A final result and its coverage are immutable. Exports are immutable renderings of one final result, are access-controlled on every download, contain no secrets/provider identifiers, and expire without deleting the final-result record.

## 28. Relationship and lifecycle invariants

The ownership chain is exact:

```text
Organization(id = tenantId)
  -> Project
    -> Environment -> Target -> immutable TargetVersion
      -> Campaign -> approved immutable PlanVersion
        -> Run (one execution attempt) -> Job (one active fenced lease)
          -> Evidence + immutable FindingOccurrence -> CanonicalFinding
        -> immutable CampaignFinalResult -> Export
```

A campaign has at most one current approved plan version, one active budget reservation, and zero or more runs. A run has exactly one approved plan version and reservation, at least one job attempt over its lifetime, and zero or more evidence items/occurrences. A job belongs to one run; lease retries do not change run identity. Evidence and occurrences belong to one run and cannot be relinked. A canonical finding aggregates occurrences across campaigns only within the same tenant/project/environment. A final result pins all referenced IDs and never follows later canonical-finding state.

Lifecycle transitions are closed and exact in the registry. The principal tables are:

| Resource         | Allowed forward or recovery transitions                                                                                                                                                                                                                                                                               |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| organization     | `active -> suspended`; `suspended -> active`                                                                                                                                                                                                                                                                          |
| membership       | `invited -> active, revoked`; `active -> suspended, revoked`; `suspended -> active, revoked`; `revoked -> terminal`                                                                                                                                                                                                   |
| project          | `active -> archived`; `archived -> terminal`                                                                                                                                                                                                                                                                          |
| environment      | `draft -> pending_verification, archived`; `pending_verification -> ready, draft, suspended, archived`; `ready -> pending_verification, suspended, archived`; `suspended -> pending_verification, archived`; `archived -> terminal`                                                                                   |
| fixture          | `draft -> in_review, retired`; `in_review -> approved, rejected, draft`; `approved -> retired`; `rejected -> draft, retired`; `retired -> terminal`                                                                                                                                                                   |
| campaign         | `draft -> planning, cancelled`; `planning -> awaiting_plan_approval, failed, cancelled`; `awaiting_plan_approval -> planning, ready, cancelled`; `ready -> running, cancelled`; `running -> paused, completed, failed, cancelled`; `paused -> running, failed, cancelled`; `completed, failed, cancelled -> terminal` |
| requirement/plan | `draft -> in_review, superseded`; `in_review -> approved, rejected, draft`; `approved -> superseded`; `rejected -> draft, superseded`; `superseded -> terminal`                                                                                                                                                       |
| finding          | exact `findingTransitions` registry table; risk acceptance is not a state                                                                                                                                                                                                                                             |

Terminal statuses have no outbound transition unless the registry explicitly defines recovery. Automatic expiry transitions are clock-driven, idempotent, audit-recorded, and use the same tenant fencing.

## 29. Domain operations and common mutation rules

The OpenAPI `operationId`, `x-required-permission`, success status, strict request/response schema, headers, and errors are normative. The registry's `domainFamilies` manifest is the required-domain inventory and the drift validator fails when any listed schema, operation, permission, status family, event, error, or acceptance ID is missing.

All list operations use section 8 pagination. All public `POST` operations use section 8 idempotency. Commands that alter an existing mutable resource include `expectedVersion`; stale commands return `409 STALE_RESOURCE_VERSION`. Immutable version resources reject update/delete with `409 VERSION_IMMUTABLE`. Internal completion/usage/finalization operations require deterministic event IDs and are idempotent; job-scoped ones also require the active lease token.

Operation families are frozen as follows:

| Family                  | Public operations                                                                                                                                                                                                                                                                                                                                                  | Internal operations                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| organization/access     | `createAuthenticationSession`, `refreshAuthenticationSession`, `revokeAuthenticationSession`, `createOrganization`, `listOrganizations`, `getOrganization`, `listOrganizationMemberships`, `createOrganizationMembership`, `transitionOrganizationMembership`, `listTestingDomainEvents`                                                                           | none                                                                                     |
| project/environment     | `createTestingProject`, `listTestingProjects`, `getTestingProject`, `transitionTestingProject`, `createTestingEnvironment`, `listTestingEnvironments`, `getTestingEnvironment`, `createTestingEnvironmentVersion`, `decideTestingEnvironmentVerification`, target operations in section 6                                                                          | none                                                                                     |
| application state       | `createTestingApplicationRole`, `listTestingApplicationRoles`, `transitionTestingApplicationRole`, `registerTestingCredentialHandle`, `listTestingCredentialHandles`, `revokeTestingCredentialHandle`, `createTestingFixture`, `listTestingFixtures`, `createTestingFixtureVersion`, `reviewTestingFixtureVersion`, `setupTestingFixture`, `cleanupTestingFixture` | none                                                                                     |
| campaigns               | `createTestingCampaign`, `listTestingCampaigns`, `getTestingCampaign`, `transitionTestingCampaign`, `requestTestingCampaignPlanning`                                                                                                                                                                                                                               | none                                                                                     |
| requirements            | `createTestingRequirementSource`, `listTestingRequirementSources`, `transitionTestingRequirementSource`, `ingestTestingRequirementSource`, `listTestingRequirements`, `getTestingRequirement`, `createTestingRequirementVersion`, `reviewTestingRequirementVersion`                                                                                                | `completeInternalTestingRequirementIngestion`, `failInternalTestingRequirementIngestion` |
| discovery               | `createTestingDiscovery`, `listTestingDiscoveries`, `getTestingDiscovery`, `listTestingDiscoveryVersions`, `getTestingDiscoveryVersion`                                                                                                                                                                                                                            | `completeInternalTestingDiscovery`                                                       |
| planning                | `createTestingPlan`, `getTestingPlan`, `getTestingPlanVersion`, `reviewTestingPlanVersion`                                                                                                                                                                                                                                                                         | `createInternalTestingPlanVersion`                                                       |
| resource governance     | `createTestingCampaignProfile`, `listTestingCampaignProfiles`, `createTestingCampaignProfileVersion`, `getTestingQuota`, `reserveTestingCampaignBudget`, `getTestingBudgetReservation`, `releaseTestingBudgetReservation`, `getTestingCampaignUsage`                                                                                                               | `recordInternalTestingUsage`                                                             |
| findings                | run occurrence reads plus `listTestingFindings`, `getTestingFinding`, `assignTestingFinding`, `commentOnTestingFinding`, `markTestingFindingExpectedBehavior`, `createTestingFindingFixClaim`, `requestTestingFindingRetest`, `closeTestingFinding`, `createTestingFindingRiskAcceptance`, `revokeTestingFindingRiskAcceptance`                                    | occurrence recording is atomic with `appendInternalTestingJobEvent`                      |
| results                 | `getTestingCampaignReadinessReport`, `getTestingCampaignCoverage`, `createTestingCampaignExport`, `getTestingCampaignExport`, `getTestingCampaignFinalResult`                                                                                                                                                                                                      | `finalizeInternalTestingCampaignResult`                                                  |
| execution relationships | existing run/viewer/control/evidence operations plus `getTestingCampaignExecutionGraph`                                                                                                                                                                                                                                                                            | existing job lease/event/evidence/completion operations                                  |

Every operation is mapped to an automated acceptance ID in `docs/testing-acceptance-matrix.md`. Manual gates supplement rather than replace deterministic authorization, transition, schema, idempotency, lookup-order, and immutability tests.

## 30. Genuine open product and provider decisions

The following choices are intentionally not invented by this contract. They may be selected later without changing public semantics; a choice that changes a DTO, enum, safety boundary, or readiness rule requires a contract revision.

- browser execution vendor and regional capacity placement;
- durable queue/database technology and worker autoscaling strategy;
- evidence object store, malware scanner, encryption-key provider, and retention beyond the 30-day floor;
- exact open-weight model, local inference engine, quantization, supported hardware profile, and implementation of the `semantic` oracle; the self-hosted open-weight provider class is not open;
- optional future hosted adapters, provided they remain outside MVP readiness and never become a required fallback;
- automated target-ownership verification mechanism beyond the MVP permissioned operator attestation;
- optional organization role templates beyond the frozen built-in roles and whether target creation/verification require separate principals;
- visual-diff engine, baseline approval workflow, and perceptual threshold;
- notification channels, billing, pricing, and service-level objectives; testing-resource quota semantics are frozen above and are not billing;
- production deployment regions and data-residency offerings.

These are recorded choices, not readiness exemptions. Required local inference must be selected and configured; optional future hosted adapters never satisfy or replace its readiness gates.

## 31. Contract artifacts and change control

- `docs/testing-mvp-contract.md` is normative.
- `docs/contracts/testing.openapi.json` is the exact HTTP/schema projection.
- `docs/contracts/testing-registry.json` is the exact closed-value registry.
- `docs/testing-acceptance-matrix.md` maps every public/internal operation and safety invariant to deterministic or explicit manual verification.
- `scripts/validate-testing-contract.mjs` is the drift guard executed by `npm run test:testing-contract`, `npm run test:contract`, and the root test suite.

Any contract change updates all five artifacts in the same reviewed change. Component packets implement this contract without modifying DealPilot shopping behavior or claiming planned autonomous-testing behavior is already live.
