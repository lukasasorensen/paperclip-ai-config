#!/usr/bin/env node
import { createPrivateKey, sign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const HELP = `Usage: node mint-token.mjs [--json]

Print a fresh GitHub App installation token to stdout.
--json prints { token, expires_at } instead.

Environment (defaults for paperclip-agent-bot):
  GITHUB_APP_ID                4501865 (App ID or Client ID)
  GITHUB_INSTALLATION_ID       151595108
  GITHUB_APP_PRIVATE_KEY_PATH  /etc/paperclip/github/paperclip-agent-bot.private-key.pem
`;

export async function mintToken({ env = process.env, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  const appId = env.GITHUB_APP_ID ?? '4501865';
  const installationId = env.GITHUB_INSTALLATION_ID ?? '151595108';
  const keyPath = env.GITHUB_APP_PRIVATE_KEY_PATH ?? '/etc/paperclip/github/paperclip-agent-bot.private-key.pem';
  if (!appId.trim() || !/^[1-9]\d*$/.test(installationId)) {
    throw new Error('Set a nonempty GITHUB_APP_ID and a positive numeric GITHUB_INSTALLATION_ID.');
  }

  let key;
  try {
    key = createPrivateKey(await readFile(keyPath));
    if (key.asymmetricKeyType !== 'rsa') throw new Error('Not RSA');
  } catch {
    throw new Error('Cannot load an RSA private key. Check GITHUB_APP_PRIVATE_KEY_PATH, PEM format, and file permissions.');
  }

  const timestamp = Math.floor(now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const payload = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iss: appId, iat: timestamp - 60, exp: timestamp + 540 })}`;
  const jwt = `${payload}.${sign('RSA-SHA256', Buffer.from(payload), key).toString('base64url')}`;

  let response;
  let data;
  try {
    response = await fetchImpl(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${jwt}`,
        'X-GitHub-Api-Version': '2026-03-10',
        'User-Agent': 'paperclip-ai-config',
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    if (response.ok) data = await response.json();
  } catch {
    // Do not print request headers, JWTs, or remote response bodies on errors.
    throw new Error('GitHub token request failed. Check network access and the server clock; the request has a 30-second timeout.');
  }

  if (!response.ok) {
    const hints = {
      401: 'Check the App ID, private key, and server clock.',
      403: 'Check installation status, App permissions, and GitHub rate limits.',
      404: 'Check that the installation ID belongs to this App and the App is installed.',
      422: 'Check the installation configuration.',
    };
    throw new Error(`GitHub returned HTTP ${response.status}. ${hints[response.status] ?? 'Retry later or check GitHub service status.'}`);
  }
  if (typeof data?.token !== 'string' || !data.token || /\s/.test(data.token)
      || typeof data.expires_at !== 'string' || !(Date.parse(data.expires_at) > now())) {
    throw new Error('GitHub returned an invalid token or expiration.');
  }
  return { token: data.token, expires_at: data.expires_at };
}

export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    process.stdout.write(HELP);
    return;
  }
  if (args.length > 1 || (args.length === 1 && args[0] !== '--json')) {
    throw new Error('Usage: node mint-token.mjs [--json | --help]');
  }
  const result = await mintToken();
  process.stdout.write(`${args[0] === '--json' ? JSON.stringify(result) : result.token}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`mint-token: ${error.message}\n`);
    process.exitCode = 1;
  });
}
