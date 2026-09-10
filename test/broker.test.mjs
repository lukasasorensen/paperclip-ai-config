import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createBroker, authenticate } from '../broker.mjs';
import { createTokenManager } from '../lib/token-manager.mjs';
import { validateConfig, localUrl } from '../lib/config.mjs';
import { publishToken, paperclipApi } from '../lib/paperclip.mjs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const access = 'a'.repeat(43);
const client = { companyId: 'company', agentId: 'agent', sha256: createHash('sha256').update(access).digest('hex') };
const config = () => ({ version: 1, port: 3199, paperclip: { url: 'http://127.0.0.1:3100', apiKeyPath: '/secret' }, targets: [{ companyId: 'company', secretId: 'secret' }], clients: [client] });
const validToken = () => ({ token: 'ghs_fixture', expires_at: new Date(Date.now() + 3600_000).toISOString() });

test('refresh coalesces concurrent requests, expires during a run, and retries failure', async () => {
  let now = Date.now(); let calls = 0; let fail = false;
  const manager = createTokenManager({ now: () => now, mint: async () => {
    calls++; if (fail) throw new Error('private detail');
    return { token: `token${calls}`, expires_at: new Date(now + 3600_000).toISOString() };
  } });
  const values = await Promise.all(Array.from({ length: 20 }, () => manager.get()));
  assert.equal(calls, 1); assert.ok(values.every((value) => value.token === 'token1'));
  now += 56 * 60_000;
  assert.equal((await manager.get()).token, 'token2');
  now += 56 * 60_000; fail = true;
  await assert.rejects(manager.get()); assert.equal(manager.status().ready, false);
  fail = false; assert.equal((await manager.get()).token, 'token4');
});

test('rejects unsafe configuration and unauthenticated callers', () => {
  assert.equal(validateConfig(config()).version, 1);
  for (const url of ['http://remote.example', 'https://user:pass@example.com', 'file:///etc/passwd']) assert.throws(() => localUrl(url, 'test'));
  assert.throws(() => validateConfig({ ...config(), clients: [client, client] }));
  assert.throws(() => validateConfig({ ...config(), clients: [{ ...client, companyId: 'other' }] }));
  assert.equal(authenticate(`Bearer ${access}`, [client]), true);
  for (const header of [undefined, '', `Bearer ${'b'.repeat(43)}`, `Bearer ${access}\n`]) assert.equal(authenticate(header, [client]), false);
});

test('broker authenticates, reloads revocation, rejects bad routes, and does not leak failures', async (t) => {
  let current = config(); let minted = 0; let fail = false;
  const broker = createBroker({ loadConfig: async () => current, manager: {
    get: async () => { minted++; if (fail) throw new Error('PRIVATE_KEY_SECRET'); return validToken(); },
    status: () => ({ ready: !fail, refreshes: minted }),
  }, publish: async () => {}, log: () => {} });
  await new Promise((resolve, reject) => { broker.server.once('error', reject); broker.server.listen(0, '127.0.0.1', resolve); });
  t.after(() => { broker.server.closeAllConnections(); broker.server.close(); });
  const url = `http://127.0.0.1:${broker.server.address().port}`;
  const get = (headers = {}, path = '/v1/token') => fetch(`${url}${path}`, { method: 'POST', headers });
  assert.equal((await get()).status, 401); assert.equal(minted, 0);
  const headers = { Authorization: `Bearer ${access}` };
  const response = await get(headers);
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.json()).token, 'ghs_fixture');
  assert.equal((await get({ ...headers, Origin: 'https://evil.test' })).status, 400);
  assert.equal((await get(headers, '/v1/token?other=installation')).status, 404);
  current = { ...config(), clients: [] };
  assert.equal((await get(headers)).status, 401);
  current = config(); fail = true;
  const failed = await get(headers); assert.equal(failed.status, 503); assert.doesNotMatch(await failed.text(), /PRIVATE_KEY/);
});

test('publication retries failures without minting again or republishing completed targets', async () => {
  let calls = 0; let fail = true; const logs = [];
  const manager = createTokenManager({ mint: async () => { calls++; return validToken(); } });
  const counts = { secret: 0, second: 0 };
  const broker = createBroker({ loadConfig: async () => ({ ...config(), targets: [...config().targets, { companyId: 'other', secretId: 'second' }] }), manager,
    publish: async (_, target) => { counts[target.secretId]++; if (target.secretId === 'second' && fail) throw new Error('SECRET'); }, log: (line) => logs.push(line) });
  await broker.sync(); fail = false; await broker.sync(); await broker.sync();
  assert.equal(calls, 1); assert.deepEqual(counts, { secret: 1, second: 2 }); assert.doesNotMatch(logs.join(''), /SECRET/);
});

test('Paperclip publication uses metadata and existing rotate API, refusing wrong targets', async () => {
  const calls = [];
  const target = { companyId: 'company', secretId: 'secret' };
  const secret = { id: 'secret', companyId: 'company', name: 'GH_TOKEN', status: 'active', provider: 'local_encrypted' };
  const api = async (path, options) => { calls.push([path, options]); return [secret]; };
  await publishToken(api, target, 'TOKEN');
  assert.deepEqual(calls, [['/companies/company/secrets', undefined], ['/secrets/secret/rotate', { method: 'POST', body: { value: 'TOKEN' } }]]);
  secret.companyId = 'other'; await assert.rejects(publishToken(api, target, 'TOKEN'), /configured company/);
});

test('dedicated secret names support agent-only publication without global GH_TOKEN discovery', async () => {
  const target = { companyId: 'company', secretId: 'private', secretName: 'GH_APP_FOUNDING_ENGINEER' };
  const calls = [];
  const api = async (path, options) => {
    calls.push({ path, options });
    return [{ id: 'private', companyId: 'company', name: target.secretName, status: 'active', provider: 'local_encrypted' }];
  };
  await publishToken(api, target, 'TOKEN');
  assert.equal(calls[1].path, '/secrets/private/rotate');
  await assert.rejects(publishToken(api, { ...target, secretName: 'GH_TOKEN' }, 'TOKEN'));
  assert.throws(() => validateConfig({ ...config(), targets: [{ ...target, secretName: '../invalid' }] }));
});

test('API errors never include board keys or remote response bodies', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'paperclip-api-test-'));
  try {
    const file = join(directory, 'key'); await writeFile(file, 'board-secret', { mode: 0o600 });
    const api = paperclipApi({ url: 'http://127.0.0.1:3100', apiKeyPath: file }, async (_, options) => {
      assert.equal(options.headers.Authorization, 'Bearer board-secret'); assert.equal(options.redirect, 'error');
      return new Response('SECRET', { status: 403 });
    });
    await assert.rejects(api('/companies/company/secrets'), (error) => /403/.test(error.message) && !/SECRET|board-secret/.test(error.message));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
