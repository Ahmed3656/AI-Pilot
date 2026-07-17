import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const [major] = process.versions.node.split('.').map(Number);
const nodeSupported = major >= 22;
const checks = [];

function commandVersion(
  label,
  command,
  args,
  { required = true, shell = false } = {},
) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    shell,
  });
  const ok = result.status === 0;
  checks.push({
    label,
    ok,
    required,
    detail: ok ? result.stdout.trim() : 'not available',
  });
}

checks.push({
  label: 'Node.js 22+',
  ok: nodeSupported,
  required: true,
  detail: `v${process.versions.node}${nodeSupported ? '' : ' (upgrade required)'}`,
});
const npmCli = process.env.npm_execpath;
if (npmCli) {
  commandVersion('npm', process.execPath, [npmCli, '--version']);
} else {
  commandVersion('npm', 'npm', ['--version'], {
    shell: process.platform === 'win32',
  });
}
commandVersion(
  'Docker',
  process.platform === 'win32' ? 'docker.exe' : 'docker',
  ['--version'],
  {
    required: false,
  },
);

const venvPython =
  process.platform === 'win32'
    ? resolve(root, '.venv', 'Scripts', 'python.exe')
    : resolve(root, '.venv', 'bin', 'python');
checks.push({
  label: 'AI virtual environment',
  ok: existsSync(venvPython),
  required: true,
  detail: existsSync(venvPython) ? venvPython : 'run `npm run setup:ai`',
});
checks.push({
  label: 'Node dependencies',
  ok: existsSync(resolve(root, 'node_modules')),
  required: true,
  detail: existsSync(resolve(root, 'node_modules'))
    ? 'installed'
    : 'run `npm install`',
});

for (const check of checks) {
  const status = check.ok ? 'PASS' : check.required ? 'FAIL' : 'WARN';
  console.log(`${status}  ${check.label}: ${check.detail}`);
}

if (checks.some((check) => check.required && !check.ok)) process.exit(1);
