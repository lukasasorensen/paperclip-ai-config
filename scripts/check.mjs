import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const files = ['mint-token.mjs', 'broker.mjs'];
for (const directory of ['lib', 'helpers', 'scripts', 'test']) {
  for (const file of await readdir(directory)) if (file.endsWith('.mjs')) files.push(`${directory}/${file}`);
}
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.error || result.status !== 0) process.exit(1);
}
