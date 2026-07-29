import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = join(root, 'infra', 'phase1', '.env');
const composeFile = join(root, 'docker-compose.yml');
const action = process.argv[2] ?? 'health';
const profile = argumentValue('--profile') ?? 'local-only';
const timeoutSeconds = Number(argumentValue('--timeout') ?? '300');
const configuration = parseEnvironment(readFileSync(envFile, 'utf8'));
const environment = { ...configuration, ...process.env };
const composePrefix = [
  'compose',
  '--project-directory',
  root,
  '--env-file',
  envFile,
  '-f',
  composeFile,
  '--profile',
  profile,
];

if (!['health', 'smoke'].includes(action)) fail(`Unknown check: ${action}`);
if (!['local-only', 'cloud-tunnel'].includes(profile))
  fail(`Unsupported profile: ${profile}`);
if (
  !Number.isInteger(timeoutSeconds) ||
  timeoutSeconds < 1 ||
  timeoutSeconds > 1800
)
  fail('Timeout must be an integer from 1 through 1800 seconds.');

await health();
if (action === 'smoke') await smoke();

async function health() {
  const required = ['postgres', 'api', 'browser', 'ai-service', 'gateway'];
  if (profile === 'cloud-tunnel') required.push('cloudflared');
  const deadline = Date.now() + timeoutSeconds * 1000;

  for (;;) {
    const pending = required
      .map((service) => [service, containerState(service)])
      .filter(
        ([service, state]) =>
          state !== 'running|healthy|0' &&
          !(service === 'cloudflared' && state === 'running|none|0'),
      );
    if (pending.length === 0) break;
    if (Date.now() >= deadline) {
      fail(
        `Phase 1 services did not become healthy within ${timeoutSeconds} seconds: ${pending
          .map(([service, state]) => `${service}=${state}`)
          .join(', ')}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  assert.equal(
    containerState('migrate'),
    'exited|none|0',
    'The migration gate did not complete successfully.',
  );
  const origin = gatewayOrigin();
  const gateway = await getJson(`${origin}/_gateway/health`);
  assert.equal(gateway.status, 'ok');
  const api = await getJson(`${origin}/health/ready`);
  assert.equal(api.status, 'ok');
  assert.equal(api.dependencies.database, 'up');

  compose([
    'exec',
    '-T',
    'postgres',
    'sh',
    '-ec',
    `test "$(psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT to_regclass('public.shopping_runs')::text")" = "shopping_runs"`,
  ]);
  compose([
    'exec',
    '-T',
    'ai-service',
    'python',
    '-c',
    [
      'import os, urllib.error, urllib.request',
      "def status(token):\n request=urllib.request.Request('http://api:3000/internal/v1/secrets/resolve',data=b'{}',headers={'Content-Type':'application/json','X-Internal-Token':token},method='POST')\n try:\n  urllib.request.urlopen(request,timeout=5); return 200\n except urllib.error.HTTPError as error: return error.code",
      "assert status('invalid-internal-token') == 401",
      "assert status(os.environ['AI_INTERNAL_TOKEN']) == 400",
    ].join('\n'),
  ]);
  compose([
    'exec',
    '-T',
    'api',
    'node',
    '-e',
    [
      "const endpoint='http://ai-service:8000/internal/v1/runs';",
      "const check=async(token,body)=>(await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json','x-internal-token':token,'idempotency-key':'infrastructure-auth-probe'},body:JSON.stringify(body)})).status;",
      "const valid={runId:'infrastructure-auth-probe',query:'Infrastructure authentication probe',requestedCategory:'retail',locale:'en-EG',market:'EG',currency:'EGP',timezone:'Africa/Cairo',browserExpiresAt:new Date(Date.now()+3600000).toISOString()};",
      "(async()=>{if(await check('invalid-internal-token',valid)!==401)process.exit(1);if(await check(process.env.INTERNAL_TOKEN,{})!==400)process.exit(1)})().catch(()=>process.exit(1));",
    ].join(''),
  ]);
  compose([
    'exec',
    '-T',
    'ai-service',
    'python',
    '-c',
    "import json,urllib.request; value=json.load(urllib.request.urlopen('http://browser:4444/status',timeout=5))['value']; assert any(node.get('availability') == 'UP' for node in value.get('nodes', []))",
  ]);

  console.log(`Phase 1 is healthy (${profile}): ${origin}`);
  console.log(
    'Verified migration completion, schema availability, API-to-AI auth, AI-to-API auth, Selenium, and gateway readiness.',
  );
}

async function smoke() {
  const origin = gatewayOrigin();
  assert.equal((await gatewayRequest('/health/ready')).status, 200);
  assert.equal(
    (await gatewayRequest('/api/v1/shopping/merchants')).status,
    401,
    'The canonical authenticated API route was not reached.',
  );
  for (const path of [
    '/internal/v1/viewer/authorize',
    '/ai/health',
    '/wd/hub/status',
    '/v1/shopping/merchants',
    '/api/v1/shopping/ws',
    '/api/v1/shopping/runs/not-a-run/viewer-token',
  ]) {
    assert.equal(
      (await gatewayRequest(path)).status,
      404,
      `Non-canonical path ${path} is unexpectedly reachable.`,
    );
  }
  for (const [service, port] of [
    ['postgres', '5432'],
    ['api', '3000'],
    ['ai-service', '8000'],
    ['browser', '4444'],
    ['browser', '7900'],
  ]) {
    assert.equal(
      hasPublishedPort(service, port),
      false,
      `${service} port ${port} is unexpectedly published.`,
    );
  }
  const logs = compose([
    'logs',
    '--no-color',
    '--tail',
    '300',
    'gateway',
    'api',
    'ai-service',
  ]);
  const secrets = [
    configuration.POSTGRES_PASSWORD,
    configuration.JWT_SECRET,
    configuration.INTERNAL_TOKEN,
    configuration.VIEWER_TOKEN_SECRET,
    environment.AI_OPENROUTER_API_KEY,
  ].filter(Boolean);
  assert.ok(secrets.every((secret) => !logs.includes(secret)));
  assert.doesNotMatch(
    logs,
    /([?&]token=|bearer\.[A-Za-z0-9_-]+|data:image\/[^;]+;base64,|"(?:recipientName|mobileNumber|street)"\s*:)/i,
  );
  console.log(`Smoke checks passed (${profile}): ${origin}`);
  console.log(
    'Verified canonical public routing, legacy-route rejection, dependency health, port isolation, and log privacy.',
  );
}

function containerState(service) {
  const id = compose(['ps', '-a', '-q', service], true).trim();
  if (!id) return 'missing';
  try {
    return execFileSync(
      'docker',
      [
        'inspect',
        '--format',
        '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}|{{.State.ExitCode}}',
        id,
      ],
      { cwd: root, encoding: 'utf8', env: environment },
    ).trim();
  } catch {
    return 'inspect-failed';
  }
}

function hasPublishedPort(service, port) {
  const id = compose(['ps', '-a', '-q', service]).trim();
  if (!id) fail(`The ${service} container is missing.`);
  const bindings = JSON.parse(
    execFileSync(
      'docker',
      ['inspect', '--format', '{{json .HostConfig.PortBindings}}', id],
      { cwd: root, encoding: 'utf8', env: environment },
    ),
  );
  return (
    Array.isArray(bindings?.[`${port}/tcp`]) &&
    bindings[`${port}/tcp`].length > 0
  );
}

function gatewayOrigin() {
  const address = compose(['port', 'gateway', '8080']).trim();
  if (!address) fail('The gateway loopback port is not published.');
  const port = address.match(/:(\d+)$/)?.[1];
  if (!port) fail('The gateway port could not be determined.');
  return `http://127.0.0.1:${port}`;
}

async function gatewayRequest(path) {
  return fetch(`${gatewayOrigin()}${path}`, {
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
  });
}

async function getJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  assert.equal(response.status, 200, `${url} returned ${response.status}`);
  return response.json();
}

function compose(argumentsList, allowFailure = false) {
  try {
    return execFileSync('docker', [...composePrefix, ...argumentsList], {
      cwd: root,
      encoding: 'utf8',
      env: environment,
      stdio: ['ignore', 'pipe', allowFailure ? 'ignore' : 'pipe'],
    });
  } catch (error) {
    if (allowFailure) return '';
    throw new Error('A Phase 1 container check failed.', { cause: error });
  }
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
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

function fail(message) {
  console.error(message);
  process.exit(1);
}
