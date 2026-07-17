import { readdir, rm } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const targets = [
  'apps/api/dist',
  'apps/api/coverage',
  'apps/mobile/dist',
  'apps/mobile/.expo',
  'services/ai-service/.pytest_cache',
  '.ruff_cache',
];

async function remove(relativePath) {
  const target = resolve(root, relativePath);
  if (!target.startsWith(`${root}${sep}`))
    throw new Error(`Refusing to clean outside repository: ${target}`);
  await rm(target, { recursive: true, force: true });
  console.log(`Removed ${relative(root, target)}`);
}

async function removePythonCaches(directory) {
  let entries = [];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory() && entry.name === '__pycache__') {
        await rm(path, { recursive: true, force: true });
        return;
      }
      if (entry.isDirectory()) await removePythonCaches(path);
    }),
  );
}

await Promise.all(targets.map(remove));
await removePythonCaches(resolve(root, 'services', 'ai-service'));
