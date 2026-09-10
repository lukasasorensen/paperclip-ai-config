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
    // Git permits repeated array attributes (capability[], wwwauth[], state[]).
    // This username/password helper does not consume them or unknown extensions.
    if (!['protocol', 'host', 'path', 'username', 'password'].includes(key)) continue;
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
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => {
  process.stdout.write('quit=true\n\n');
  const safeMessages = ['Unsupported credential operation.', 'Malformed Git credential request.',
    'Duplicate Git credential field.', 'Credential request too large.', 'Broker access is not configured.',
    'GitHub credential unavailable; check broker health and agent access.'];
  const reason = safeMessages.includes(error.message) ? error.message : 'Credential helper runtime failure.';
  process.stderr.write(`github-auth: ${reason}\n`); process.exitCode = 1;
});
