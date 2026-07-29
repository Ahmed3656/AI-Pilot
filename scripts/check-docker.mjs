import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

for (const target of ['javascript', 'python']) {
  console.log(`Running the ${target} repository gate in Docker...`);
  const result = spawnSync(
    'docker',
    [
      'build',
      '--file',
      'infra/check/Dockerfile',
      '--target',
      target,
      '--progress',
      'plain',
      '.',
    ],
    { cwd: root, stdio: 'inherit' },
  );
  if (result.error?.code === 'ENOENT') {
    console.error('Docker is not installed or is not available on PATH.');
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(
  'Complete JavaScript, Python, mobile, API, contract, and build gates passed in Docker.',
);
