import { test } from 'node:test';
import assert from 'node:assert/strict';
import { credential } from '../helpers/git-credential.mjs';
import { requestToken } from '../helpers/client.mjs';
import { redactor } from '../helpers/redact.mjs';

test('Git helper only answers exact GitHub HTTPS get requests and never stores tokens', async () => {
  let calls = 0;
  const mint = async () => { calls++; return 'short-token'; };
  assert.equal(await credential('get', 'protocol=https\nhost=github.com\npath=owner/repo.git\n\n', mint), 'username=x-access-token\npassword=short-token\n\n');
  for (const action of ['store', 'erase']) assert.equal(await credential(action, 'password=SECRET\n', mint), '');
  for (const input of ['protocol=http\nhost=github.com\n', 'protocol=https\nhost=github.com.evil.test\n', 'protocol=https\nhost=github.com:444\n', 'protocol=https\nhost=evil.test\n']) {
    assert.equal(await credential('get', input, mint), 'quit=true\n\n');
  }
  assert.equal(calls, 1);
  await assert.rejects(credential('get', 'host=github.com\nhost=evil.test\n', mint), /Duplicate/);
});

test('client uses broker authentication, rejects expired tokens, and sanitizes failures', async () => {
  const env = { PAPERCLIP_GITHUB_BROKER_TOKEN: 'a'.repeat(43) };
  const token = await requestToken(env, async (url, options) => {
    assert.equal(url.href, 'http://127.0.0.1:3199/v1/token');
    assert.equal(options.headers.Authorization, `Bearer ${env.PAPERCLIP_GITHUB_BROKER_TOKEN}`);
    return Response.json({ token: 'fresh', expires_at: new Date(Date.now() + 3600_000).toISOString() });
  });
  assert.equal(token, 'fresh');
  for (const response of [new Response('SECRET', { status: 401 }), Response.json({ token: 'stale', expires_at: '2000-01-01' })]) {
    await assert.rejects(requestToken(env, async () => response), (error) => !error.message.includes('SECRET'));
  }
});

test('redaction handles every split of a token and preserves multibyte output', async () => {
  const token = 'ghs_very_secret';
  for (let split = 0; split <= token.length; split++) {
    const stream = redactor([token]); let result = '';
    stream.on('data', (chunk) => { result += chunk.toString(); });
    stream.write(`before ${token.slice(0, split)}`); stream.write(`${token.slice(split)} after `);
    for (const byte of Buffer.from('✓')) stream.write(Buffer.from([byte]));
    stream.end(); await new Promise((resolve) => stream.on('end', resolve));
    assert.equal(result, 'before [REDACTED] after ✓');
  }
});
