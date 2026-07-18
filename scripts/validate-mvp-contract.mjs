import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const contractUrl = new URL(
  '../docs/contracts/mvp-contract.openapi.json',
  import.meta.url,
);
const contractText = await readFile(contractUrl, 'utf8');
const contract = JSON.parse(contractText);
const schemas = contract.components.schemas;

function resolveLocalRef(ref) {
  return ref
    .slice(2)
    .split('/')
    .reduce(
      (value, segment) => value?.[segment.replaceAll('~1', '/')],
      contract,
    );
}

function assertLocalRefsResolve(value) {
  if (Array.isArray(value)) {
    value.forEach(assertLocalRefsResolve);
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (typeof value.$ref === 'string' && value.$ref.startsWith('#/')) {
    assert.ok(
      resolveLocalRef(value.$ref),
      `Unresolved OpenAPI ref: ${value.$ref}`,
    );
  }
  Object.values(value).forEach(assertLocalRefsResolve);
}

assertLocalRefsResolve(contract);

const expectedPaths = [
  '/api/v1/shopping/merchants',
  '/api/v1/shopping/runs',
  '/api/v1/shopping/runs/{runId}',
  '/api/v1/shopping/runs/{runId}/address-grant',
  '/api/v1/shopping/runs/{runId}/clarifications',
  '/api/v1/shopping/runs/{runId}/control',
  '/api/v1/shopping/runs/{runId}/control/claim',
  '/api/v1/shopping/runs/{runId}/control/release',
  '/api/v1/shopping/runs/{runId}/control/renew',
  '/api/v1/shopping/runs/{runId}/domains/approve',
  '/api/v1/shopping/runs/{runId}/events',
  '/api/v1/shopping/runs/{runId}/report',
  '/api/v1/shopping/runs/{runId}/seat-hold/approve',
  '/api/v1/shopping/runs/{runId}/viewer-tokens',
  '/internal/v1/ai-events',
  '/internal/v1/runs',
  '/internal/v1/runs/{runId}/commands',
  '/internal/v1/secrets/resolve',
  '/internal/v1/viewer/authorize',
].sort();

assert.equal(contract.openapi, '3.1.0');
assert.equal(contract.info.version, '1.0.0');
assert.deepEqual(Object.keys(contract.paths).sort(), expectedPaths);

const publicPaths = Object.keys(contract.paths).filter(
  (path) => !path.startsWith('/internal/'),
);
assert.ok(publicPaths.every((path) => path.startsWith('/api/v1/')));
assert.ok(publicPaths.every((path) => !path.startsWith('/v1/')));

assert.deepEqual(schemas.RequestedCategory.enum, [
  'auto',
  'retail',
  'food',
  'cinema',
]);
assert.deepEqual(schemas.ResolvedCategory.enum, ['retail', 'food', 'cinema']);
assert.deepEqual(schemas.Locale.enum, ['ar-EG', 'en-EG']);
assert.deepEqual(schemas.RunStatus.enum, [
  'clarifying',
  'discovering',
  'awaiting_domain_approval',
  'comparing',
  'awaiting_address_consent',
  'awaiting_seat_hold_approval',
  'coupon_testing',
  'ready_for_handoff',
  'user_takeover',
  'paused',
  'completed',
  'cancelled',
  'failed',
]);

assert.deepEqual(schemas.RunStatus['x-allowed-transitions'], {
  clarifying: ['discovering', 'paused', 'cancelled', 'failed'],
  discovering: [
    'clarifying',
    'awaiting_domain_approval',
    'paused',
    'cancelled',
    'failed',
  ],
  awaiting_domain_approval: [
    'discovering',
    'comparing',
    'paused',
    'cancelled',
    'failed',
  ],
  comparing: [
    'awaiting_domain_approval',
    'awaiting_address_consent',
    'awaiting_seat_hold_approval',
    'coupon_testing',
    'ready_for_handoff',
    'paused',
    'cancelled',
    'failed',
  ],
  awaiting_address_consent: ['comparing', 'paused', 'cancelled', 'failed'],
  awaiting_seat_hold_approval: ['comparing', 'paused', 'cancelled', 'failed'],
  coupon_testing: [
    'comparing',
    'ready_for_handoff',
    'paused',
    'cancelled',
    'failed',
  ],
  ready_for_handoff: ['paused', 'completed', 'cancelled', 'failed'],
  user_takeover: ['$resumeStatus', 'completed', 'cancelled', 'failed'],
  paused: ['user_takeover', '$resumeStatus', 'cancelled', 'failed'],
  completed: [],
  cancelled: [],
  failed: [],
});

assert.deepEqual(schemas.InternalCommandName.enum, [
  'clarify',
  'pause',
  'resume',
  'cancel',
  'complete',
  'approve_domains',
  'grant_address',
  'approve_seat_hold',
]);
assert.ok(!contractText.includes('pause_ai'));
assert.ok(!contractText.includes('resume_ai'));

assert.deepEqual(schemas.EventEnvelope.required, [
  'id',
  'runId',
  'type',
  'status',
  'timestamp',
  'payload',
]);
assert.deepEqual(schemas.EventType.enum, [
  'run.created',
  'run.clarification_required',
  'run.clarification_submitted',
  'run.status_changed',
  'domains.approval_required',
  'domains.approved',
  'address.approval_required',
  'address.granted',
  'seat_hold.approval_required',
  'seat_hold.approved',
  'merchant.attempt_started',
  'merchant.attempt_completed',
  'offer.recorded',
  'coupon.attempted',
  'evidence.captured',
  'run.warning',
  'control.claimed',
  'control.renewed',
  'control.released',
  'control.lease_expired',
  'report.updated',
  'run.completed',
  'run.cancelled',
  'run.failed',
  'stream.reset_required',
]);

assert.deepEqual(schemas.ErrorResponse.properties.error.required, [
  'code',
  'message',
  'status',
  'requestId',
  'timestamp',
  'details',
]);
assert.deepEqual(schemas.RunReport.required, [
  'id',
  'runId',
  'status',
  'category',
  'market',
  'currency',
  'timezone',
  'generatedAt',
  'merchantAttempts',
  'validOffers',
  'excludedOffers',
  'incompleteOffers',
  'couponAttempts',
  'evidence',
  'warnings',
  'partialFailures',
  'conclusion',
]);
assert.equal(schemas.DecimalEGP.type, 'string');
assert.equal(schemas.RunResource.properties.market.const, 'EG');
assert.equal(schemas.RunResource.properties.currency.const, 'EGP');
assert.equal(schemas.RunResource.properties.timezone.const, 'Africa/Cairo');
assert.deepEqual(schemas.ClaimControlRequest.required, [
  'requestId',
  'merchantAttemptId',
]);
assert.ok(
  schemas.PendingAction.oneOf.some(
    (action) => action.properties.type.const === 'browser_takeover',
  ),
);

assert.ok(
  contract.paths['/api/v1/shopping/runs/{runId}/events'].get['x-websocket'],
);
assert.ok(contract.paths['/api/v1/shopping/runs/{runId}/viewer-tokens'].post);
assert.equal(
  contract.paths['/api/v1/shopping/runs/{runId}/viewer-tokens'].get,
  undefined,
);

console.log('DealPilot MVP contract projection is internally consistent.');
