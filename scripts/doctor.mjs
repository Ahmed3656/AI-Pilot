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
  { required = true, shell = false, minimumMajor, minimumMinor = 0 } = {},
) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    shell,
  });
  const detail = result.status === 0 ? result.stdout.trim() : 'not available';
  const match = /(?:^|\s)v?(\d+)\.(\d+)/.exec(detail);
  const versionSupported =
    minimumMajor === undefined ||
    (match !== null &&
      (Number(match[1]) > minimumMajor ||
        (Number(match[1]) === minimumMajor &&
          Number(match[2]) >= minimumMinor)));
  const ok = result.status === 0 && versionSupported;
  checks.push({
    label,
    ok,
    required,
    detail:
      result.status === 0 && !versionSupported
        ? `${detail} (upgrade required)`
        : detail,
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
  commandVersion('npm 10+', process.execPath, [npmCli, '--version'], {
    minimumMajor: 10,
  });
} else {
  commandVersion('npm 10+', 'npm', ['--version'], {
    shell: process.platform === 'win32',
    minimumMajor: 10,
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
if (existsSync(venvPython)) {
  commandVersion('Python 3.12+', venvPython, ['--version'], {
    minimumMajor: 3,
    minimumMinor: 12,
  });
} else {
  checks.push({
    label: 'Python 3.12+',
    ok: false,
    required: true,
    detail: 'run `npm run setup:ai`',
  });
}
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
