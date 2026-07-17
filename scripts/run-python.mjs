import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const candidates = [
  resolve(root, '.venv', 'Scripts', 'python.exe'),
  resolve(root, '.venv', 'bin', 'python'),
];
const python = candidates.find(existsSync);

if (!python) {
  console.error(
    'AI virtual environment not found. Run `npm run setup:ai` first.',
  );
  process.exit(1);
}

const result = spawnSync(python, process.argv.slice(2), {
  cwd: root,
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
