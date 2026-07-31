import assert from 'node:assert/strict';
import test from 'node:test';
import { createBenchmarkServer } from '../src/server.mjs';

let server;
let baseUrl;

test.before(async () => {
  server = createBenchmarkServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

test.after(async () => {
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

async function request(path, options = {}) {
  return fetch(`${baseUrl}${path}`, options);
}

async function reset(body) {
  const response = await request('/__benchmark/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.equal(response.status, 200);
  return response.json();
}

async function session(role) {
  const response = await request('/auth/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role }),
  });
  assert.equal(response.status, 201);
  return response.headers.get('set-cookie').split(';')[0];
}

function withRole(cookie, options = {}) {
  return {
    ...options,
    headers: { ...options.headers, Cookie: cookie },
  };
}

test('health, readiness, local CSP assets, and truth are available', async () => {
  await reset({ profile: 'faulty' });
  const [health, ready, page, manifest] = await Promise.all([
    request('/health'),
    request('/ready'),
    request('/workspace'),
    request('/__benchmark/truth-manifest'),
  ]);

  assert.deepEqual(await health.json(), {
    status: 'ok',
    target: 'local-deterministic-benchmark',
  });
  assert.equal((await ready.json()).externalNetworkDependency, false);
  assert.match(
    page.headers.get('content-security-policy'),
    /connect-src 'self'/,
  );
  assert.match(await page.text(), /\/assets\/benchmark\.js/);
  assert.equal((await manifest.json()).version, '1.0.0');
});

test('faulty profile activates every declared seed and reset restores fixtures', async () => {
  const faulty = await reset({ profile: 'faulty' });
  assert.equal(Object.values(faulty.enabledSeeds).every(Boolean), true);
  assert.deepEqual(faulty.records, [
    { id: 'record-0001', title: 'Synthetic launch checklist' },
  ]);

  const owner = await session('owner');
  const create = await request(
    '/api/records',
    withRole(owner, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'new local record' }),
    }),
  );
  assert.equal(create.status, 500);

  const resetState = await reset({ profile: 'faulty' });
  assert.equal(resetState.safeActionCount, 0);
  assert.equal(resetState.records.length, 1);
});

test('every seed can be enabled independently from the clean baseline', async () => {
  const seedIds = Object.keys(
    (await reset({ profile: 'faulty' })).enabledSeeds,
  );

  for (const seedId of seedIds) {
    const state = await reset({
      profile: 'clean',
      enabledSeeds: { [seedId]: true },
    });
    assert.equal(
      state.enabledSeeds[seedId],
      true,
      `${seedId} should be enabled`,
    );
    assert.equal(
      Object.entries(state.enabledSeeds)
        .filter(([id]) => id !== seedId)
        .every(([, enabled]) => enabled === false),
      true,
      `${seedId} should not enable another seed`,
    );
  }
});

test('critical save and validation seeds return their deterministic errors', async () => {
  const owner = await session('owner');
  await reset({
    profile: 'clean',
    enabledSeeds: { 'critical-create-save-500': true },
  });
  const critical = await request(
    '/api/records',
    withRole(owner, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'allowed title' }),
    }),
  );
  assert.equal(critical.status, 500);

  await reset({
    profile: 'clean',
    enabledSeeds: { 'form-validation-failure': true },
  });
  const invalid = await request(
    '/api/records',
    withRole(owner, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'benchmark-invalid' }),
    }),
  );
  assert.equal(invalid.status, 422);
});

test('role leak, dynamic ID, prompt injection, accessibility issue, and stateful controls are exposed only when seeded', async () => {
  const contributor = await session('contributor');
  await reset({ profile: 'faulty' });
  const faultyPage = await request('/workspace', withRole(contributor));
  const faultyHtml = await faultyPage.text();
  assert.match(faultyHtml, /data-testid="forbidden-admin-action"/);
  assert.match(faultyHtml, /data-testid="prompt-injection-text"/);
  assert.match(faultyHtml, /seed-mobile-hidden-primary/);
  assert.match(faultyHtml, /data-testid="icon-only-menu" type="button">/);
  assert.match(faultyHtml, /data-testid="fixture-dialog"/);
  assert.match(faultyHtml, /data-testid="tab-activity"/);
  assert.equal(
    (await request('/workspace/admin', withRole(contributor))).status,
    403,
  );
  assert.match(
    await (await request('/workspace/records/record-0001')).text(),
    /Route record ID: record-0001/,
  );

  await reset({ profile: 'clean' });
  const cleanHtml = await (
    await request('/workspace', withRole(contributor))
  ).text();
  assert.doesNotMatch(
    cleanHtml,
    /forbidden-admin-action|prompt-injection-text|seed-mobile-hidden-primary|fixture-dialog|record-link-record-0001/,
  );
  assert.match(cleanHtml, /aria-label="Open workspace options"/);
  assert.equal((await request('/workspace/records/record-0001')).status, 404);
});

test('third-party, console, and side-effect trap seeds are isolated from external systems', async () => {
  const owner = await session('owner');
  await reset({ profile: 'faulty' });
  assert.equal((await request('/third-party/widget')).status, 503);
  const faultyHtml = await (
    await request('/workspace', withRole(owner))
  ).text();
  assert.match(
    faultyHtml,
    /data-third-party-failure="true" data-console-noise="true"/,
  );

  const safe = await request(
    '/api/traps/safe',
    withRole(owner, { method: 'POST' }),
  );
  assert.equal(safe.status, 201);
  const prohibited = await request('/api/traps/prohibited', { method: 'POST' });
  assert.equal(prohibited.status, 409);
  assert.equal(
    (await prohibited.json()).error,
    'PROHIBITED_SYNTHETIC_SIDE_EFFECT',
  );

  await reset({ profile: 'clean' });
  assert.equal((await request('/third-party/widget')).status, 204);
  const cleanHtml = await (await request('/workspace', withRole(owner))).text();
  assert.match(
    cleanHtml,
    /data-third-party-failure="false" data-console-noise="false"/,
  );
});

test('clean baseline accepts a create and rejects malformed reset configuration', async () => {
  const owner = await session('owner');
  await reset({ profile: 'clean' });
  const create = await request(
    '/api/records',
    withRole(owner, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'benchmark-invalid' }),
    }),
  );
  assert.equal(create.status, 201);
  assert.equal((await create.json()).id, 'record-0002');

  const malformed = await request('/__benchmark/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile: 'clean', enabledSeeds: { unknown: true } }),
  });
  assert.equal(malformed.status, 400);
});
