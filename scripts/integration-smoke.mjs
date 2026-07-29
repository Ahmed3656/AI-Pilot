import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const phaseDirectory = join(root, 'infra', 'phase1');
const envFile = join(phaseDirectory, '.env');
const stateFile = join(phaseDirectory, '.demo-state.json');
const configuration = parseEnvironment(readFileSync(envFile, 'utf8'));
const origin = configuration.DEALPILOT_PUBLIC_ORIGIN || 'http://localhost:8080';
const apiBase = `${origin}/api/v1`;
const demoAccount = {
  displayName: 'DealPilot Demo User',
  email: 'dealpilot.demo@example.test',
  password: 'DealPilot-demo-2026!',
};
let idempotencyCounter = 0;
const socketEvents = new WeakMap();

console.log(
  'TEST ADAPTER: exercising API -> AI -> real Selenium -> API persistence.',
);

await assertStatus('/v1/shopping/merchants', 404);
await assertStatus('/internal/v1/viewer/authorize', 404);
const session = await registerOrLogin();
const token = session.accessToken;
const merchants = await mobileRequest('/shopping/merchants', { token });
assert.deepEqual(
  merchants.merchants.map((merchant) => merchant.domain),
  ['amazon.eg', 'jumia.com.eg', 'noon.com', 'talabat.com', 'voxcinemas.com'],
);

await proveFailedInternalCommandDoesNotAdvance(token);
const seeded = await seedDemoRun(token);
await proveWebSocketAndSameBrowserControl(token, seeded);
await verifyLogsArePrivate();

writeFileSync(
  stateFile,
  `${JSON.stringify(
    {
      mode: 'deterministic-test-adapter',
      account: { email: demoAccount.email, password: demoAccount.password },
      runId: seeded.id,
      status: 'completed',
      apiOrigin: origin,
    },
    null,
    2,
  )}\n`,
  { encoding: 'utf8', mode: 0o600 },
);

console.log(`Seeded demo account: ${demoAccount.email}`);
console.log(`Seeded demo password: ${demoAccount.password}`);
console.log(`Seeded completed report: ${seeded.id}`);
console.log('Integration smoke passed; the Docker stack remains running.');

async function registerOrLogin() {
  const registered = await request('/auth/register', {
    method: 'POST',
    body: demoAccount,
    allow: [201, 401],
  });
  if (registered.response.status === 201) return registered.body;
  return (
    await request('/auth/login', {
      method: 'POST',
      body: { email: demoAccount.email, password: demoAccount.password },
    })
  ).body;
}

async function proveFailedInternalCommandDoesNotAdvance(token) {
  const run = await createAndPrepareRun(
    token,
    'failure-proof-run-v1',
    'Prove internal command rollback with a deterministic laptop comparison',
    ['amazon.eg'],
  );
  const before = await mobileRequest(`/shopping/runs/${run.id}`, { token });
  assert.equal(before.run.status, 'ready_for_handoff');
  completeAiOnly(run.id, 'integration-direct-complete-v1');
  const failedComplete = await request(`/shopping/runs/${run.id}/control`, {
    method: 'POST',
    token,
    idempotencyKey: uniqueKey('failed-complete'),
    body: { action: 'complete' },
    allow: [502],
  });
  assert.equal(failedComplete.body.error.code, 'AI_COMMAND_REJECTED');
  const after = await mobileRequest(`/shopping/runs/${run.id}`, { token });
  assert.equal(after.run.status, before.run.status);
  console.log('PASS internal command rejection leaves API state unchanged.');
}

async function seedDemoRun(token) {
  const run = await createAndPrepareRun(
    token,
    'seeded-demo-run-v1',
    'Compare deterministic test laptops for the client demo',
    ['amazon.eg', 'jumia.com.eg'],
  );
  const report = await mobileRequest(`/shopping/runs/${run.id}/report`, {
    token,
  });
  assert.equal(report.status, 'final');
  assert.ok(report.incompleteOffers.length >= 2);
  assert.equal(
    report.partialFailures.some(
      (failure) => failure.code === 'TEST_MERCHANT_UNAVAILABLE',
    ),
    false,
  );
  assert.ok(report.evidence.every((item) => item.redacted === true));
  console.log('PASS selected merchants complete in isolated browser workers.');
  return run;
}

async function createAndPrepareRun(token, key, query, domains) {
  const created = await request('/shopping/runs', {
    method: 'POST',
    token,
    idempotencyKey: key,
    body: { query, category: 'retail', locale: 'en-EG' },
  });
  const runId = created.body.run.id;
  let run = await waitForRun(token, runId, (value) =>
    ['awaiting_domain_approval', 'comparing', 'ready_for_handoff'].includes(
      value.status,
    ),
  );
  if (run.status === 'awaiting_domain_approval') {
    assert.equal(run.pendingAction.type, 'domain_approval');
    const allowed = new Set(
      run.pendingAction.candidates.map((item) => item.domain),
    );
    assert.ok(domains.every((domain) => allowed.has(domain)));
    await request(`/shopping/runs/${runId}/domains/approve`, {
      method: 'POST',
      token,
      idempotencyKey: `${key}-domains`,
      body: { requestId: run.pendingAction.requestId, domains },
    });
  }
  run = await waitForRun(
    token,
    runId,
    (value) => value.status === 'ready_for_handoff',
    30_000,
  );
  return run;
}

async function proveWebSocketAndSameBrowserControl(token, run) {
  const initialHistory = await mobileRequest(
    `/shopping/runs/${run.id}/events?limit=200`,
    { token },
  );
  assert.ok(initialHistory.events.length > 0);
  assert.equal(
    new Set(initialHistory.events.map((event) => event.id)).size,
    initialHistory.events.length,
  );
  const cursor = initialHistory.events.at(-1).id;
  const viewToken = await viewerToken(token, run.id, 'view');
  const viewRedirect = await fetch(viewToken.viewerUrl, {
    headers: { Authorization: `Bearer ${viewToken.token}` },
    redirect: 'manual',
  });
  assert.equal(viewRedirect.status, 302);
  assert.match(viewRedirect.headers.get('location') ?? '', /view_only=1/);
  assert.ok(
    !(viewRedirect.headers.get('location') ?? '').includes(viewToken.token),
  );

  const socket = await openEvents(run.id, viewToken.token, cursor);
  const sessionsBefore = seleniumSessionIds().sort();
  assert.equal(sessionsBefore.length, 2);
  runPhase1Health();
  console.log(
    'PASS health remains green while merchant sessions are occupied.',
  );

  const denied = await request(`/shopping/runs/${run.id}/control/claim`, {
    method: 'POST',
    token,
    idempotencyKey: uniqueKey('unrequested-claim'),
    body: { requestId: 'not-requested', merchantAttemptId: 'not-requested' },
    allow: [409],
  });
  assert.equal(denied.body.error.code, 'INVALID_RUN_TRANSITION');

  const report = await mobileRequest(`/shopping/runs/${run.id}/report`, {
    token,
  });
  const target = report.merchantAttempts[0];
  assert.ok(target?.id);
  await request(`/shopping/runs/${run.id}/control`, {
    method: 'POST',
    token,
    idempotencyKey: uniqueKey('pause-for-input'),
    body: { action: 'pause', reason: 'deterministic_manual_input_check' },
  });
  const takeoverRequestId = uniqueKey('takeover-warning');
  emitManualInputWarning(run.id, target.id, takeoverRequestId);
  const paused = await waitForRun(
    token,
    run.id,
    (value) =>
      value.status === 'paused' &&
      value.pendingAction?.type === 'browser_takeover',
  );
  assert.equal(paused.pendingAction.merchantName, target.merchantName);
  assert.equal(paused.pendingAction.merchantDomain, target.merchantDomain);

  const claimedPromise = nextEvent(socket, 'control.claimed');
  const claimed = (
    await request(`/shopping/runs/${run.id}/control/claim`, {
      method: 'POST',
      token,
      idempotencyKey: uniqueKey('claim'),
      body: {
        requestId: takeoverRequestId,
        merchantAttemptId: target.id,
        requestedLeaseSeconds: 120,
      },
    })
  ).body;
  assert.equal((await claimedPromise).status, 'user_takeover');
  assert.deepEqual(seleniumSessionIds().sort(), sessionsBefore);
  socket.close(1000);
  await waitForSocketClose(socket);

  const controlToken = await viewerToken(
    token,
    run.id,
    'control',
    claimed.lease.id,
  );
  const controlRedirect = await fetch(controlToken.viewerUrl, {
    headers: { Authorization: `Bearer ${controlToken.token}` },
    redirect: 'manual',
  });
  assert.equal(controlRedirect.status, 302);
  assert.ok(
    !(controlRedirect.headers.get('location') ?? '').includes('view_only=1'),
  );
  assert.ok(
    !(controlRedirect.headers.get('location') ?? '').includes(
      controlToken.token,
    ),
  );

  const reconnectToken = await viewerToken(token, run.id, 'view');
  const reconnected = await openEvents(run.id, reconnectToken.token, cursor);
  const replayed = await nextEvent(reconnected, 'control.claimed');
  assert.equal(replayed.payload.leaseId, claimed.lease.id);
  const releasedPromise = nextEvent(reconnected, 'control.released');
  const released = (
    await request(`/shopping/runs/${run.id}/control/release`, {
      method: 'POST',
      token,
      idempotencyKey: uniqueKey('release'),
      body: { leaseId: claimed.lease.id },
    })
  ).body;
  assert.equal(released.run.status, 'ready_for_handoff');
  assert.equal(released.lease.status, 'released');
  assert.equal((await releasedPromise).payload.recovery, 'resumed');
  assert.deepEqual(seleniumSessionIds().sort(), sessionsBefore);
  reconnected.close(1000);
  await waitForSocketClose(reconnected);

  const history = await mobileRequest(
    `/shopping/runs/${run.id}/events?after=${encodeURIComponent(cursor)}&limit=200`,
    { token },
  );
  assert.ok(history.events.some((event) => event.type === 'control.claimed'));
  assert.ok(history.events.some((event) => event.type === 'control.released'));
  assert.equal(
    new Set(history.events.map((event) => event.id)).size,
    history.events.length,
  );
  console.log(
    'PASS WebSocket delivery, replay, and same-session release/resume.',
  );

  const completed = (
    await request(`/shopping/runs/${run.id}/control`, {
      method: 'POST',
      token,
      idempotencyKey: uniqueKey('complete'),
      body: { action: 'complete' },
    })
  ).body;
  assert.equal(completed.run.status, 'completed');
  assert.equal(seleniumSessionIds().length, 0);
  const retainedReport = await mobileRequest(
    `/shopping/runs/${run.id}/report`,
    {
      token,
    },
  );
  assert.equal(retainedReport.status, 'final');
  assert.ok(retainedReport.incompleteOffers.length >= 1);
  console.log(
    'PASS completed seeded report remains available and all browser sessions close.',
  );
}

async function viewerToken(token, runId, mode, leaseId) {
  return (
    await request(`/shopping/runs/${runId}/viewer-tokens`, {
      method: 'POST',
      token,
      idempotencyKey: uniqueKey(`${mode}-viewer`),
      body: { mode, ...(leaseId ? { leaseId } : {}) },
    })
  ).body;
}

async function mobileRequest(path, options = {}) {
  return (await request(path, options)).body;
}

async function request(
  path,
  { method = 'GET', token, body, idempotencyKey, allow = [200, 201, 202] } = {},
) {
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const responseBody = text ? JSON.parse(text) : {};
  assert.ok(
    allow.includes(response.status),
    `${method} ${path} returned ${response.status}: ${text.slice(0, 300)}`,
  );
  return { response, body: responseBody };
}

async function assertStatus(path, expected) {
  const response = await fetch(`${origin}${path}`, { redirect: 'manual' });
  assert.equal(response.status, expected);
}

async function waitForRun(token, runId, predicate, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await mobileRequest(`/shopping/runs/${runId}`, { token });
    if (predicate(value.run)) return value.run;
    if (['failed', 'cancelled', 'completed'].includes(value.run.status))
      throw new Error(
        `Run became terminal: ${JSON.stringify(value.run.failure)}`,
      );
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Run ${runId} did not reach the expected state`);
}

function openEvents(runId, viewerToken, after) {
  const url = new URL(origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = `/api/v1/shopping/runs/${encodeURIComponent(runId)}/events`;
  if (after) url.searchParams.set('after', after);
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, [
      'dealpilot.events.v1',
      `bearer.${viewerToken}`,
    ]);
    const eventState = { queue: [], waiters: [] };
    socketEvents.set(socket, eventState);
    socket.on('message', (raw) => {
      const event = JSON.parse(raw.toString());
      const index = eventState.waiters.findIndex(
        (waiter) => waiter.type === event.type,
      );
      if (index < 0) {
        eventState.queue.push(event);
        return;
      }
      const [waiter] = eventState.waiters.splice(index, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(event);
    });
    const timer = setTimeout(
      () => reject(new Error('WebSocket open timed out')),
      8_000,
    );
    socket.once('open', () => {
      clearTimeout(timer);
      assert.equal(socket.protocol, 'dealpilot.events.v1');
      resolve(socket);
    });
    socket.once('error', reject);
  });
}

function nextEvent(socket, type) {
  const eventState = socketEvents.get(socket);
  assert.ok(eventState, 'WebSocket event buffer is not initialized');
  const bufferedIndex = eventState.queue.findIndex(
    (event) => event.type === type,
  );
  if (bufferedIndex >= 0) {
    const [event] = eventState.queue.splice(bufferedIndex, 1);
    return Promise.resolve(event);
  }
  return new Promise((resolve, reject) => {
    const waiter = { type, resolve, reject, timer: undefined };
    waiter.timer = setTimeout(() => {
      const index = eventState.waiters.indexOf(waiter);
      if (index >= 0) eventState.waiters.splice(index, 1);
      reject(new Error(`Timed out waiting for ${type}`));
    }, 8_000);
    eventState.waiters.push(waiter);
  });
}

function waitForSocketClose(socket) {
  if (socket.readyState === WebSocket.CLOSED) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 2_000);
    socket.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function seleniumSessionIds() {
  const python = [
    'import json, urllib.request',
    "data=json.load(urllib.request.urlopen('http://browser:4444/status'))['value']",
    "sessions=[slot['session']['sessionId'] for node in data.get('nodes', []) for slot in node.get('slots', []) if slot.get('session')]",
    'print(json.dumps(sessions))',
  ].join('; ');
  return JSON.parse(
    compose(['exec', '-T', 'ai-service', 'python', '-c', python]).trim(),
  );
}

function completeAiOnly(runId, commandId) {
  const python = [
    'import datetime, json, os, sys, urllib.request',
    'run_id=sys.argv[1]',
    'command_id=sys.argv[2]',
    "issued=datetime.datetime.now(datetime.UTC).isoformat().replace('+00:00', 'Z')",
    "body={'id':command_id,'runId':run_id,'name':'complete','issuedAt':issued,'payload':{'reason':'user_finished','reportId':'failure-proof'}}",
    "request=urllib.request.Request(f'http://127.0.0.1:8000/internal/v1/runs/{run_id}/commands',data=json.dumps(body).encode(),headers={'Content-Type':'application/json','X-Internal-Token':os.environ['AI_INTERNAL_TOKEN'],'Idempotency-Key':command_id},method='POST')",
    'response=urllib.request.urlopen(request)',
    'assert response.status == 202',
  ].join('; ');
  compose([
    'exec',
    '-T',
    'ai-service',
    'python',
    '-c',
    python,
    runId,
    commandId,
  ]);
}

function emitManualInputWarning(runId, merchantAttemptId, eventId) {
  const python = [
    'import datetime, json, os, sys, urllib.request',
    'run_id=sys.argv[1]',
    'attempt_id=sys.argv[2]',
    'event_id=sys.argv[3]',
    "timestamp=datetime.datetime.now(datetime.UTC).isoformat().replace('+00:00', 'Z')",
    "body={'id':event_id,'runId':run_id,'type':'run.warning','status':'paused','timestamp':timestamp,'payload':{'code':'captcha_detected','message':'Deterministic human-verification check','merchantAttemptId':attempt_id,'evidenceIds':[],'requiresUserInput':True}}",
    "request=urllib.request.Request('http://api:3000/internal/v1/ai-events',data=json.dumps(body).encode(),headers={'Content-Type':'application/json','X-Internal-Token':os.environ['AI_INTERNAL_TOKEN']},method='POST')",
    'response=urllib.request.urlopen(request)',
    'assert response.status == 202',
  ].join('; ');
  compose([
    'exec',
    '-T',
    'ai-service',
    'python',
    '-c',
    python,
    runId,
    merchantAttemptId,
    eventId,
  ]);
}

function runPhase1Health() {
  execFileSync(
    process.execPath,
    [
      join(root, 'scripts', 'phase1-check.mjs'),
      'health',
      '--profile',
      'local-only',
    ],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
}

async function verifyLogsArePrivate() {
  const logs = compose([
    'logs',
    '--no-color',
    '--tail',
    '500',
    'api',
    'ai-service',
    'gateway',
  ]);
  const forbidden = [
    configuration.POSTGRES_PASSWORD,
    configuration.JWT_SECRET,
    configuration.INTERNAL_TOKEN,
    configuration.VIEWER_TOKEN_SECRET,
    demoAccount.password,
    demoAccount.email,
  ].filter(Boolean);
  for (const value of forbidden) assert.ok(!logs.includes(value));
  assert.doesNotMatch(
    logs,
    /([?&]token=|bearer\.[A-Za-z0-9_-]+|data:image\/[^;]+;base64,|"(?:street|mobileNumber|recipientName)"\s*:)/i,
  );
  console.log(
    'PASS service logs contain no configured secrets, viewer tokens, or demo private data.',
  );
}

function compose(argumentsList) {
  return execFileSync(
    'docker',
    [
      'compose',
      '--project-directory',
      root,
      '--env-file',
      envFile,
      '-f',
      join(root, 'docker-compose.yml'),
      '--profile',
      'local-only',
      ...argumentsList,
    ],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
}

function uniqueKey(prefix) {
  idempotencyCounter += 1;
  return `demo-${prefix}-${Date.now().toString(36)}-${idempotencyCounter}`;
}

function parseEnvironment(source) {
  return Object.fromEntries(
    source
      .split(/\r?\n/)
      .filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line))
      .map((line) => {
        const separator = line.indexOf('=');
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}
