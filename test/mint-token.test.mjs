import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { mintToken } from '../mint-token.mjs';

const directory = await mkdtemp(join(tmpdir(), 'paperclip-token-test-'));
after(() => rm(directory, { recursive: true, force: true }));
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const keyPath = join(directory, 'test.pem');
await writeFile(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
const env = { GITHUB_APP_PRIVATE_KEY_PATH: keyPath };
const timestamp = Date.parse('2026-09-09T12:00:00Z');
const now = () => timestamp;
const result = { token: 'ghs_test_token_of_any_length', expires_at: '2026-09-09T13:00:00Z' };

test('signs a valid JWT and exchanges it for an installation token', async () => {
  const actual = await mintToken({ env, now, fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.github.com/app/installations/151595108/access_tokens');
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'error');
    assert.equal(options.body, '{}');
    assert.ok(options.signal instanceof AbortSignal);
    const jwt = options.headers.Authorization.replace(/^Bearer /, '');
    const [header, payload, signature] = jwt.split('.');
    assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url')), { alg: 'RS256', typ: 'JWT' });
    assert.deepEqual(JSON.parse(Buffer.from(payload, 'base64url')), {
      iss: '4501865', iat: timestamp / 1000 - 60, exp: timestamp / 1000 + 540,
    });
    assert.ok(verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, 'base64url')));
    return Response.json({ ...result, permissions: { contents: 'write' } });
  } });
  assert.deepEqual(actual, result);
});

test('honors App and installation overrides', async () => {
  await mintToken({ env: { ...env, GITHUB_APP_ID: 'Iv1.client', GITHUB_INSTALLATION_ID: '123' }, now,
    fetchImpl: async (url, options) => {
      assert.ok(url.endsWith('/123/access_tokens'));
      const payload = options.headers.Authorization.split('.')[1];
      assert.equal(JSON.parse(Buffer.from(payload, 'base64url')).iss, 'Iv1.client');
      return Response.json(result);
    },
  });
});

test('fails on HTTP errors without exposing response contents', async () => {
  for (const status of [401, 403, 404, 422, 500]) {
    await assert.rejects(mintToken({ env, now, fetchImpl: async () => new Response('SECRET', { status }) }),
      (error) => error.message.includes(`HTTP ${status}`) && !error.message.includes('SECRET'));
  }
});

test('rejects invalid, missing, or expired tokens', async () => {
  for (const data of [null, {}, { ...result, token: '' }, { ...result, token: 'a\nb' },
    { ...result, expires_at: 'invalid' }, { ...result, expires_at: '2020-01-01T00:00:00Z' }]) {
    await assert.rejects(mintToken({ env, now, fetchImpl: async () => Response.json(data) }), /invalid token or expiration/);
  }
});

test('sanitizes network and JSON failures', async () => {
  for (const fetchImpl of [async () => { throw new Error('SECRET'); }, async () => new Response('SECRET')]) {
    await assert.rejects(mintToken({ env, now, fetchImpl }),
      (error) => error.message.includes('request failed') && !error.message.includes('SECRET'));
  }
});

test('invalid configuration and key fail before a request', async () => {
  const fetchImpl = async () => assert.fail('Unexpected network request');
  await assert.rejects(mintToken({ env: { ...env, GITHUB_INSTALLATION_ID: '../123' }, fetchImpl }), /numeric/);
  await assert.rejects(mintToken({ env: { ...env, GITHUB_APP_ID: '' }, fetchImpl }), /nonempty/);
  await assert.rejects(mintToken({ env: { GITHUB_APP_PRIVATE_KEY_PATH: join(directory, 'missing') }, fetchImpl }), /Cannot load/);
});

test('CLI reports errors on stderr with empty stdout and nonzero exit', () => {
  const script = new URL('../mint-token.mjs', import.meta.url);
  for (const args of [[], ['--unknown']]) {
    const child = spawnSync(process.execPath, [script.pathname, ...args], {
      env: { ...process.env, GITHUB_APP_PRIVATE_KEY_PATH: join(directory, 'missing') }, encoding: 'utf8',
    });
    assert.ifError(child.error);
    assert.equal(child.status, 1);
    assert.equal(child.stdout, '');
    assert.match(child.stderr, /^mint-token: /);
  }
  const help = spawnSync(process.execPath, [script.pathname, '--help'], { encoding: 'utf8' });
  assert.ifError(help.error);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /^Usage:/);
  assert.equal(help.stderr, '');
});
