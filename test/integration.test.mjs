import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = new URL('../', import.meta.url).pathname;
const run = (command, args, options = {}, input = '') => new Promise((resolve, reject) => {
  const child = spawn(command, args, { ...options, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = '';
  child.on('error', reject);
  child.stdout.on('data', (value) => { stdout += value; }); child.stderr.on('data', (value) => { stderr += value; });
  child.stdin.end(input);
  child.on('close', (status) => resolve({ status, stdout, stderr }));
});

test('installed Git and gh helpers use fresh broker tokens, redact output, and fail closed', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'paperclip-helper-integration-'));
  let available = true; let sequence = 0;
  const server = createServer((req, res) => {
    assert.equal(req.headers.authorization, `Bearer ${'a'.repeat(43)}`);
    if (!available) { res.writeHead(503); res.end('{}'); return; }
    sequence++;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ token: `ghs_live_fixture_${sequence}`, expires_at: new Date(Date.now() + 3600_000).toISOString() }));
  });
  await new Promise((resolve, reject) => { server.on('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => { server.closeAllConnections(); server.close(); await rm(directory, { recursive: true, force: true }); });
  const stage = join(directory, 'stage');
  assert.equal((await run('sh', ['scripts/install.sh'], { cwd: root, env: { ...process.env, DESTDIR: stage } })).status, 0);
  const install = join(stage, 'opt/paperclip-github-auth');
  const helper = join(install, 'helpers/git-credential.mjs');
  const template = JSON.parse(await readFile(join(root, 'deploy/agent-env.example.json'), 'utf8'));
  const gitConfig = Object.fromEntries(Object.entries(template).filter(([key]) => key.startsWith('GIT_')));
  const env = { ...process.env, ...gitConfig, HOME: directory, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
    PAPERCLIP_GITHUB_BROKER_URL: `http://127.0.0.1:${server.address().port}`, PAPERCLIP_GITHUB_BROKER_TOKEN: 'a'.repeat(43),
    GIT_CONFIG_VALUE_1: helper };
  // Recent Git sends both capabilities to helpers during an HTTP auth challenge.
  const input = 'capability[]=authtype\ncapability[]=state\nprotocol=https\nhost=github.com\npath=owner/private.git\n\n';
  const git = await run('git', ['credential', 'fill'], { env }, input);
  assert.equal(git.status, 0, git.stderr); assert.match(git.stdout, /password=ghs_live_fixture_1/);
  const denied = await run('git', ['credential', 'fill'], { env }, 'protocol=https\nhost=evil.example\n\n');
  assert.notEqual(denied.status, 0); assert.equal(sequence, 1);
  const fakeGh = join(directory, 'real-gh');
  await writeFile(fakeGh, '#!/bin/sh\nprintf "%s\\n" "$GH_TOKEN"\nprintf "%s\\n" "$PAPERCLIP_GITHUB_BROKER_TOKEN" >&2\nprintf "%s\\n" "$@"\nexit 7\n', { mode: 0o755 });
  env.PAPERCLIP_GITHUB_REAL_GH = fakeGh;
  const gh = await run(join(install, 'bin/gh'), ['pr', 'create', '--title', 'a title with spaces'], { env });
  assert.equal(gh.status, 7); assert.match(gh.stdout, /a title with spaces/);
  assert.match(gh.stdout, /\[REDACTED\]/); assert.doesNotMatch(gh.stdout + gh.stderr, /ghs_live_fixture|a{43}/);
  assert.equal(sequence, 2);
  available = false;
  const failed = await run(join(install, 'bin/gh'), ['pr', 'list'], { env });
  assert.equal(failed.status, 1); assert.equal(failed.stdout, '');
  const gitFailed = await run('git', ['credential', 'fill'], { env }, input);
  assert.notEqual(gitFailed.status, 0); assert.doesNotMatch(gitFailed.stdout, /password=/);
  // Reinstall preserves operator configuration and contains the full helper dependency tree.
  const configPath = join(stage, 'etc/paperclip-github-auth/config.json');
  await writeFile(configPath, 'OPERATOR CONFIG\n');
  assert.equal((await run('sh', ['scripts/install.sh'], { cwd: root, env: { ...process.env, DESTDIR: stage } })).status, 0);
  assert.equal(await readFile(configPath, 'utf8'), 'OPERATOR CONFIG\n');
  await access(join(install, 'scripts/manage.mjs'));
});

test('management enrolls through existing APIs without modifying agent settings, then revokes locally', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'paperclip-enrollment-'));
  const calls = [];
  const secrets = [{ id: 'github-secret', companyId: 'company', name: 'GH_TOKEN', status: 'active', provider: 'local_encrypted' }];
  const server = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer board-fixture');
    let raw = ''; for await (const chunk of req) raw += chunk;
    calls.push({ method: req.method, path: req.url, body: raw ? JSON.parse(raw) : null });
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'GET' && req.url.endsWith('/secrets')) res.end(JSON.stringify(secrets));
    else if (req.method === 'GET' && req.url === '/api/agents/agent') res.end(JSON.stringify({ companyId: 'company', adapterType: 'claude_local', adapterConfig: { filesystemScope: 'workspace' } }));
    else if (req.method === 'POST' && req.url.endsWith('/secrets')) res.end(JSON.stringify({ id: 'broker-secret' }));
    else { res.writeHead(404); res.end('{}'); }
  });
  await new Promise((resolve, reject) => { server.on('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => { server.closeAllConnections(); server.close(); await rm(directory, { recursive: true, force: true }); });
  const key = join(directory, 'board-key'); await writeFile(key, 'board-fixture');
  const file = join(directory, 'config.json');
  await writeFile(file, JSON.stringify({ version: 1, port: 3199, paperclip: { url: `http://127.0.0.1:${server.address().port}`, apiKeyPath: key }, targets: [], clients: [] }));
  const command = resolve(root, 'scripts/manage.mjs');
  let result = await run(process.execPath, [command, 'company', file, 'company', 'github-secret']);
  assert.equal(result.status, 0, result.stderr);
  const output = join(directory, 'env.json');
  result = await run(process.execPath, [command, 'enroll', file, 'company', 'agent', output]);
  assert.equal(result.status, 0, result.stderr);
  const stored = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(stored.clients[0].agentId, 'agent'); assert.match(stored.clients[0].sha256, /^[a-f0-9]{64}$/);
  const env = JSON.parse(await readFile(output, 'utf8'));
  assert.equal(env.GH_TOKEN.secretId, 'github-secret'); assert.equal(env.PAPERCLIP_GITHUB_BROKER_TOKEN.secretId, 'broker-secret');
  const posted = calls.find((entry) => entry.method === 'POST').body.value;
  assert.ok(posted.length >= 43); assert.ok(!JSON.stringify(stored).includes(posted));
  assert.ok(!(await readFile(output, 'utf8')).includes(posted)); assert.ok(!JSON.stringify(result).includes(posted));
  assert.ok(calls.every((entry) => entry.method !== 'PATCH'));
  result = await run(process.execPath, [command, 'revoke', file, 'company', 'agent']);
  assert.equal(result.status, 0); assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).clients, []);
});
