import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const venv = resolve(root, '.venv');
const venvPython =
  process.platform === 'win32'
    ? resolve(venv, 'Scripts', 'python.exe')
    : resolve(venv, 'bin', 'python');

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  return result.status === 0;
}

if (!existsSync(venvPython)) {
  const candidates =
    process.platform === 'win32'
      ? [
          ['py', ['-3.12']],
          ['python', []],
        ]
      : [
          ['python3.12', []],
          ['python3', []],
          ['python', []],
        ];

  const created = candidates.some(([command, prefix]) =>
    run(command, [...prefix, '-m', 'venv', venv]),
  );
  if (!created) {
    console.error(
      'Python 3.12+ was not found. Install it, then rerun `npm run setup:ai`.',
    );
    process.exit(1);
  }
}

if (
  !run(venvPython, [
    '-m',
    'pip',
    'install',
    '--require-hashes',
    '-r',
    'services/ai-service/requirements-dev.lock.txt',
  ]) ||
  !run(venvPython, [
    '-m',
    'pip',
    'install',
    '--no-deps',
    '-e',
    'services/ai-service',
  ])
) {
  process.exit(1);
}
