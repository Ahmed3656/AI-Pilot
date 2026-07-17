import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const rootCompose = read('docker-compose.yml');
const compose = read('infra/phase1/docker-compose.yml');
const caddy = read('infra/phase1/Caddyfile');
const environment = read('infra/phase1/.env.example');
const packageJson = JSON.parse(read('package.json'));

assert.match(
  rootCompose,
  /include:\s+[\s\S]*infra\/phase1\/docker-compose\.yml/,
);
assert.doesNotMatch(rootCompose, /^services:/m);

for (const deprecated of [
  'AI_OPENAI_API_KEY',
  'INTERNAL_SERVICE_TOKEN',
  'AI_INTERNAL_SERVICE_TOKEN',
  'AI_NEST_API_INTERNAL_URL',
  'VIEWER_AUTH_SHARED_SECRET',
  'SELENIUM_SESSION_TIMEOUT_SECONDS',
  'SELENIUM_REQUEST_TIMEOUT_SECONDS',
]) {
  assert.equal(
    compose.includes(deprecated),
    false,
    `${deprecated} is deprecated`,
  );
  assert.equal(
    environment.includes(deprecated),
    false,
    `${deprecated} is deprecated`,
  );
}

assert.match(compose, /migrate:[\s\S]*runMigrations/);
assert.match(
  compose,
  /migrate:\s*\n\s*condition: service_completed_successfully/,
);
assert.match(compose, /to_regclass\('public\.shopping_runs'\)/);
assert.match(compose, /AI_OPENROUTER_API_KEY/);
assert.equal(
  (compose.match(/secrets:\s*\n\s*- ai_openrouter_api_key/g) ?? []).length,
  1,
);
assert.doesNotMatch(compose, /SE_VNC_VIEW_ONLY/);
assert.doesNotMatch(compose, /^\s+(?:COUNTRY|MARKET|CURRENCY|TIMEZONE):/m);
assert.match(compose, /selenium\/standalone-chromium:4\.45\.0-20260606/);
assert.match(compose, /SE_SCREEN_WIDTH: ['"]1280['"]/);
assert.match(compose, /SE_SCREEN_HEIGHT: ['"]800['"]/);
assert.match(compose, /availability['"]\) == ['"]UP['"]/);
assert.doesNotMatch(compose, /\['value'\]\['ready'\] is True/);
assert.match(
  compose,
  /\$\{DEALPILOT_GATEWAY_BIND:-127\.0\.0\.1\}:\$\{DEALPILOT_GATEWAY_PORT/,
);
assert.equal((compose.match(/^\s+ports:/gm) ?? []).length, 1);
assert.equal((compose.match(/TZ: Africa\/Cairo/g) ?? []).length, 5);
assert.match(compose, /control-plane:[\s\S]*internal: true/);
assert.match(compose, /data-plane:[\s\S]*internal: true/);

for (const required of [
  'POSTGRES_PASSWORD',
  'JWT_SECRET',
  'AI_SERVICE_URL',
  'INTERNAL_TOKEN',
  'VIEWER_TOKEN_SECRET',
  'DEALPILOT_GATEWAY_BIND',
  'DEALPILOT_PUBLIC_ORIGIN',
  'AI_OPENROUTER_API_KEY',
  'AI_SELENIUM_REMOTE_URL',
  'AI_CONTROL_API_URL',
  'CADDY_API_UPSTREAM',
  'CADDY_VIEWER_UPSTREAM',
  'SE_NODE_SESSION_TIMEOUT',
]) {
  assert.match(
    environment,
    new RegExp(`^${required}=`, 'm'),
    `${required} is documented`,
  );
}

assert.match(caddy, /method POST/);
assert.match(caddy, /rewrite \/internal\/v1\/viewer\/authorize/);
assert.match(caddy, /header_up X-Internal-Token \{\$INTERNAL_TOKEN\}/);
assert.match(caddy, /\^\/api\/v1\/shopping\/runs\/\[\^\/\]\+\/events\$/);
assert.match(caddy, /view_only=1/);
assert.match(
  caddy,
  /request_header X-DealPilot-Viewer-Mode \{rp\.header\.X-Dealpilot-Viewer-Mode\}/,
);
assert.doesNotMatch(caddy, /\?token=|VIEWER_AUTH_SHARED_SECRET/);
assert.match(caddy, /header_up -Authorization/);
assert.match(caddy, /header_up -Cookie/);

for (const command of ['start', 'stop', 'logs', 'migrate', 'smoke', 'clean']) {
  assert.equal(
    packageJson.scripts[`mvp:${command}`],
    `node scripts/phase1.mjs ${command}`,
    `mvp:${command} delegates to the canonical runtime`,
  );
}

assert.equal(packageJson.scripts.start, 'npm run dev:mobile');
assert.equal(
  packageJson.scripts['check:docker'],
  'node scripts/check-docker.mjs',
);

console.log('Phase 1 infrastructure contract validation passed.');
