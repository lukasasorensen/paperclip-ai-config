#!/usr/bin/env node
// Run inside the enrolled agent's actual workspace sandbox, never in a host shell.
import { access, mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { requestToken } from '../helpers/client.mjs';
import { sanitizeDiagnostic } from '../helpers/diagnostics.mjs';

const writeTest = process.argv.includes('--write');
const privateRepo = 'lukasasorensen/paperclip-internal-tools';
const testRepo = 'lukasasorensen/paperclip-ai-config';
const branch = `paperclip-auth-smoke-${randomUUID()}`;
let directory; let checkout; let pushed = false; let pr;
function run(command, args, cwd = directory) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let stderr = ''; child.stdout.on('data', c => { out += c; });
    child.stderr.on('data', c => { stderr = (stderr + c).slice(-8192); });
    child.once('error', () => reject(new Error(`Cannot start ${command}.`)));
    child.once('close', code => code === 0 ? resolve(out.trim()) : reject(new Error(`${command} ${args[0]} failed (exit ${code}): ${sanitizeDiagnostic(stderr, [process.env.GH_TOKEN, process.env.PAPERCLIP_GITHUB_BROKER_TOKEN])}`)));
  });
}
try {
  for (const path of ['/etc/paperclip/github/paper-clip-agent-bot.pem', '/etc/paperclip-github-auth/config.json', '/root/.config/paperclip/github-auth-board-key']) {
    let visible = false; try { await access(path); visible = true; } catch {}
    if (visible) throw new Error('Host credential path visible; refusing smoke test outside proper confinement.');
  }
  const proc = await readFile('/proc/self/status', 'utf8');
  if (!/^CapEff:\s+0+$/m.test(proc)) throw new Error('Effective Linux capabilities are not fully dropped.');
  console.log('PASS: host credentials hidden and effective capabilities dropped');
  await requestToken();
  let denied = false; try { await requestToken({ ...process.env, PAPERCLIP_GITHUB_BROKER_TOKEN: 'x'.repeat(43) }); } catch { denied = true; }
  if (!denied) throw new Error('Broker accepted an invalid credential.');
  console.log('PASS: enrolled broker access accepted; invalid credential rejected');
  directory = await mkdtemp(join(tmpdir(), 'paperclip-auth-pilot-'));
  await run('git', ['clone', '--depth', '1', `https://github.com/${privateRepo}.git`, join(directory, 'private')]);
  console.log('PASS: private repository clone through Git helper');
  await run('gh', ['repo', 'view', privateRepo, '--json', 'nameWithOwner']);
  console.log('PASS: private repository API read through gh launcher');
  if (writeTest) {
    checkout = join(directory, 'write-test');
    await run('git', ['clone', '--depth', '1', `https://github.com/${testRepo}.git`, checkout]);
    const base = await run('git', ['branch', '--show-current'], checkout);
    await run('git', ['checkout', '-b', branch], checkout);
    await writeFile(join(checkout, 'PAPERCLIP_AUTH_SMOKE_TEST.txt'), 'Temporary Founding Engineer credential validation. This branch is deleted after the draft PR check.\n');
    await run('git', ['add', 'PAPERCLIP_AUTH_SMOKE_TEST.txt'], checkout);
    await run('git', ['-c', 'user.name=Paperclip Auth Pilot', '-c', 'user.email=paperclip-auth-pilot@users.noreply.github.com', 'commit', '-m', 'test: validate Founding Engineer GitHub credentials'], checkout);
    await run('git', ['push', '-u', 'origin', branch], checkout); pushed = true;
    console.log('PASS: temporary branch pushed: ' + branch);
    pr = await run('gh', ['pr', 'create', '--repo', testRepo, '--head', branch, '--base', base, '--draft', '--title', 'Smoke test: Founding Engineer GitHub authentication', '--body', 'Temporary integration verification using the Founding Engineer credentials. This draft will be closed and its branch deleted automatically. No default-branch changes.'], checkout);
    if (!/^https:\/\/github\.com\/lukasasorensen\/paperclip-ai-config\/pull\/\d+$/.test(pr)) throw new Error('Unexpected draft PR result; inspect the temporary branch.');
    console.log('PASS: draft pull request created: ' + pr);
    await run('gh', ['pr', 'close', pr, '--repo', testRepo], checkout); pr = undefined;
    await run('git', ['push', 'origin', '--delete', branch], checkout); pushed = false;
    console.log('PASS: draft PR closed and temporary branch deleted');
  }
  console.log('PASS: pilot completed');
} catch (error) { console.error(error.code ? `Pilot local file operation failed (${error.code}; ${error.syscall ?? 'unknown syscall'}).` : error.message); process.exitCode = 1; }
finally {
  if (pr && checkout) await run('gh', ['pr', 'close', pr, '--repo', testRepo], checkout).catch(() => console.error('Cleanup needed for draft PR: ' + pr));
  if (pushed && checkout) await run('git', ['push', 'origin', '--delete', branch], checkout).catch(() => console.error('Cleanup needed for branch: ' + branch));
  if (directory) await rm(directory, { recursive: true, force: true });
}
