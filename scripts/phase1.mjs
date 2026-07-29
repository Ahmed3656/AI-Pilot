import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { redactPhase1LogLine } from './phase1-log-redaction.mjs';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const composeFile = join(repositoryRoot, 'docker-compose.yml');
const phase1Directory = join(repositoryRoot, 'infra', 'phase1');
const envExampleFile = join(phase1Directory, '.env.example');
const envFile = join(phase1Directory, '.env');
const action = process.argv[2] ?? 'help';
const profile =
  argumentValue('--profile') ?? process.env.DEALPILOT_PROFILE ?? 'local-only';
const testAdapter = process.argv.includes('--test-adapter');
const supportedProfiles = new Set(['local-only', 'cloud-tunnel']);
const noAiActions = new Set([
  'build',
  'config',
  'migrate',
  'stop',
  'logs',
  'health',
  'smoke',
  'clean',
  'ps',
]);

if (!supportedProfiles.has(profile)) fail(`Unsupported profile: ${profile}`);
if (testAdapter && profile !== 'local-only')
  fail('The deterministic test adapter is local-only.');

if (action === 'help') {
  console.log(
    'Usage: node scripts/phase1.mjs <config|build|start|stop|logs|migrate|health|smoke|ps|clean> [--profile local-only|cloud-tunnel] [--test-adapter]',
  );
  process.exit(0);
}

const configuration = ensureLocalEnvironment();
const runtimeEnvironment = { ...configuration, ...process.env };
if (testAdapter) {
  runtimeEnvironment.AI_ENVIRONMENT = 'test';
  runtimeEnvironment.AI_OPENROUTER_API_KEY =
    'deterministic-test-adapter-not-a-live-openrouter-key';
}
if (noAiActions.has(action) && !runtimeEnvironment.AI_OPENROUTER_API_KEY) {
  runtimeEnvironment.AI_OPENROUTER_API_KEY = 'not-used-by-this-command';
}
validateConfiguration(runtimeEnvironment, action, profile);
verifyDocker();

const composeArguments = [
  'compose',
  '--project-directory',
  repositoryRoot,
  '--env-file',
  envFile,
  '-f',
  composeFile,
  '--profile',
  profile,
];

switch (action) {
  case 'config':
    runDocker(['config', '--quiet']);
    console.log('Phase 1 Compose configuration is valid.');
    break;
  case 'build':
    runDocker(['build']);
    break;
  case 'start':
    runDocker(['config', '--quiet']);
    runDocker(['up', '-d', '--build', '--wait']);
    runCheck('health');
    if (testAdapter)
      console.log(
        'TEST ADAPTER ACTIVE: deterministic Selenium data; this is not a live merchant/OpenRouter run.',
      );
    console.log(
      'DealPilot Egypt MVP is ready at the configured loopback gateway.',
    );
    break;
  case 'stop':
    runDocker(['down', '--remove-orphans']);
    console.log('DealPilot Egypt MVP stopped; database data was preserved.');
    break;
  case 'logs':
    await streamRedactedLogs(configuration);
    break;
  case 'migrate':
    runDocker(['run', '--rm', '--build', 'migrate']);
    console.log('Database migrations completed.');
    break;
  case 'health':
    runCheck('health');
    break;
  case 'smoke':
    runCheck('smoke');
    break;
  case 'ps':
    runDocker(['ps']);
    break;
  case 'clean':
    runDocker(['down', '--volumes', '--remove-orphans']);
    console.log(
      'DealPilot containers, networks, and the Phase 1 database volume were removed.',
    );
    break;
  default:
    fail(`Unknown Phase 1 action: ${action}`);
}

function ensureLocalEnvironment() {
  const example = readFileSync(envExampleFile, 'utf8');
  if (!existsSync(envFile)) {
    const generated = replaceEnvironmentValues(example, {
      POSTGRES_PASSWORD: randomSecret(32),
      JWT_SECRET: randomSecret(48),
      INTERNAL_TOKEN: randomSecret(48),
      VIEWER_TOKEN_SECRET: randomSecret(48),
    });
    writeFileSync(envFile, generated, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    console.log(
      'Created an ignored infra/phase1/.env with random local service secrets.',
    );
  }
  const current = readFileSync(envFile, 'utf8');
  const migrated = current
    .replace(/^AI_OPENAI_API_KEY=/m, 'AI_OPENROUTER_API_KEY=')
    .replace(/^AI_MODEL=gpt-5\.6$/m, 'AI_MODEL=openai/gpt-5.2');
  if (migrated !== current) {
    writeFileSync(envFile, migrated, { encoding: 'utf8', mode: 0o600 });
    console.log(
      'Migrated the ignored Phase 1 environment from OpenAI to OpenRouter names.',
    );
  }
  return parseEnvironment(migrated);
}

function replaceEnvironmentValues(source, replacements) {
  return source
    .split(/\r?\n/)
    .map((line) => {
      const match = /^([A-Z][A-Z0-9_]*)=/.exec(line);
      return match && replacements[match[1]]
        ? `${match[1]}=${replacements[match[1]]}`
        : line;
    })
    .join('\n');
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

function validateConfiguration(environment, currentAction, currentProfile) {
  for (const key of [
    'POSTGRES_PASSWORD',
    'JWT_SECRET',
    'INTERNAL_TOKEN',
    'VIEWER_TOKEN_SECRET',
  ]) {
    if ((environment[key] ?? '').length < 32)
      fail(`${key} must contain at least 32 characters.`);
  }
  if (
    new Set([
      environment.JWT_SECRET,
      environment.INTERNAL_TOKEN,
      environment.VIEWER_TOKEN_SECRET,
    ]).size !== 3
  ) {
    fail(
      'JWT_SECRET, INTERNAL_TOKEN, and VIEWER_TOKEN_SECRET must be distinct.',
    );
  }
  const exact = {
    AI_SERVICE_URL: 'http://ai-service:8000',
    AI_CONTROL_API_URL: 'http://api:3000',
    AI_SELENIUM_REMOTE_URL: 'http://browser:4444/wd/hub',
  };
  for (const [key, expected] of Object.entries(exact)) {
    if (environment[key] !== expected)
      fail(`${key} must be ${expected} for the MVP stack.`);
  }
  if (
    environment.RUN_BROWSER_TTL_SECONDS !== environment.SE_NODE_SESSION_TIMEOUT
  ) {
    fail(
      'RUN_BROWSER_TTL_SECONDS and SE_NODE_SESSION_TIMEOUT must remain equal.',
    );
  }
  if (
    !noAiActions.has(currentAction) &&
    (environment.AI_OPENROUTER_API_KEY ?? '').length < 20
  ) {
    fail(
      'Set AI_OPENROUTER_API_KEY in ignored infra/phase1/.env before starting the live MVP.',
    );
  }
  if (currentProfile === 'cloud-tunnel' && currentAction === 'start') {
    if (!(environment.CLOUDFLARE_TUNNEL_TOKEN ?? '').trim())
      fail('CLOUDFLARE_TUNNEL_TOKEN is required for cloud-tunnel.');
    if (!/^https:\/\/[^/]+$/.test(environment.DEALPILOT_PUBLIC_ORIGIN ?? '')) {
      fail(
        'DEALPILOT_PUBLIC_ORIGIN must be an HTTPS origin with no path in cloud-tunnel mode.',
      );
    }
  }
}

function verifyDocker() {
  const result = spawnSync('docker', ['compose', 'version', '--short'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: runtimeEnvironment,
  });
  if (result.error?.code === 'ENOENT')
    fail('Docker is not installed or is not available on PATH.');
  if (result.status !== 0)
    fail('Docker Compose is unavailable or Docker Desktop is not running.');
  const version = (result.stdout || result.stderr)
    .trim()
    .replace(/^v/, '')
    .split(/[+-]/)[0];
  const [major = 0, minor = 0] = version.split('.').map(Number);
  if (major < 2 || (major === 2 && minor < 24))
    fail('Docker Compose 2.24 or newer is required.');
}

function runDocker(argumentsList) {
  const result = spawnSync('docker', [...composeArguments, ...argumentsList], {
    cwd: repositoryRoot,
    env: runtimeEnvironment,
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function runCheck(check) {
  const result = spawnSync(
    process.execPath,
    [
      join(repositoryRoot, 'scripts', 'phase1-check.mjs'),
      check,
      '--profile',
      profile,
    ],
    { cwd: repositoryRoot, env: runtimeEnvironment, stdio: 'inherit' },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}

async function streamRedactedLogs(localConfiguration) {
  const child = spawn(
    'docker',
    [...composeArguments, 'logs', '--follow', '--tail', '200'],
    {
      cwd: repositoryRoot,
      env: runtimeEnvironment,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const secrets = [
    localConfiguration.POSTGRES_PASSWORD,
    localConfiguration.JWT_SECRET,
    localConfiguration.INTERNAL_TOKEN,
    localConfiguration.VIEWER_TOKEN_SECRET,
    runtimeEnvironment.AI_OPENROUTER_API_KEY,
    runtimeEnvironment.CLOUDFLARE_TUNNEL_TOKEN,
  ];
  for (const stream of [child.stdout, child.stderr]) {
    const lines = createInterface({ input: stream });
    lines.on('line', (line) => console.log(redactPhase1LogLine(line, secrets)));
  }
  const code = await new Promise((resolve) => child.once('close', resolve));
  if (code !== 0) process.exit(code ?? 1);
}

function randomSecret(bytes) {
  return randomBytes(bytes).toString('base64url');
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
