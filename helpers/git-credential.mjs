#!/usr/bin/node
import { pathToFileURL } from 'node:url';
import { requestToken } from './client.mjs';

export async function credential(action, input, getToken = requestToken) {
  if (action === 'store' || action === 'erase') return '';
  if (action !== 'get') throw new Error('Unsupported credential operation.');
  const fields = new Map();
  for (const line of input.split('\n')) {
    if (!line) break;
    const index = line.indexOf('=');
    if (index < 1) throw new Error('Malformed Git credential request.');
    const key = line.slice(0, index);
    if (fields.has(key)) throw new Error('Duplicate Git credential field.');
    fields.set(key, line.slice(index + 1));
  }
  // quit=true also prevents Git from trying an ambient askpass credential.
  if (fields.get('protocol') !== 'https' || fields.get('host') !== 'github.com') return 'quit=true\n\n';
  return `username=x-access-token\npassword=${await getToken()}\n\n`;
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 16384) throw new Error('Credential request too large.');
  }
  process.stdout.write(await credential(process.argv[2], input));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => {
  process.stdout.write('quit=true\n\n');
  process.stderr.write('github-auth: Git credential unavailable.\n'); process.exitCode = 1;
});
