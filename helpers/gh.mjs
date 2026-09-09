#!/usr/bin/node
import { spawn } from 'node:child_process';
import { realpath, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { requestToken } from './client.mjs';
import { redactor } from './redact.mjs';

async function main() {
  const args = process.argv.slice(2);
  // Never persist credentials or alter Git auth configuration via gh auth.
  if (args[0] === 'auth' && args[1] !== 'status') throw new Error('Use broker configuration to manage authentication.');
  const command = process.env.PAPERCLIP_GITHUB_REAL_GH ?? '/usr/bin/gh';
  if (!command.startsWith('/') || await realpath(command) === await realpath(process.argv[1])) throw new Error('Invalid real gh executable.');
  const token = await requestToken();
  const configDir = await mkdtemp(join(tmpdir(), 'paperclip-gh-'));
  const env = { ...process.env, GH_TOKEN: token, GITHUB_TOKEN: token, GH_HOST: 'github.com', GH_PROMPT_DISABLED: '1', GH_CONFIG_DIR: configDir };
  delete env.GH_ENTERPRISE_TOKEN; delete env.GITHUB_ENTERPRISE_TOKEN;
  // Preserve broker access for Git subprocesses launched by gh (e.g. repo clone).
  const child = spawn(command, args, { env, stdio: ['inherit', 'pipe', 'pipe'] });
  for (const [stream, destination] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
    stream.pipe(redactor([token, process.env.PAPERCLIP_GITHUB_BROKER_TOKEN])).pipe(destination);
  }
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  child.once('error', () => { process.stderr.write('github-auth: cannot start gh.\n'); process.exitCode = 1; });
  child.once('close', (code, signal) => {
    void rm(configDir, { recursive: true, force: true }).catch(() => {});
    process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 143);
  });
}
main().catch(() => { process.stderr.write('github-auth: gh authentication or launch failed; check broker access and the real gh path.\n'); process.exitCode = 1; });
