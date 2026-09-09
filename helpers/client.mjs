import { localUrl } from '../lib/config.mjs';

export async function requestToken(env = process.env, fetchImpl = globalThis.fetch) {
  const base = localUrl(env.PAPERCLIP_GITHUB_BROKER_URL ?? 'http://127.0.0.1:3199', 'Broker');
  const credential = env.PAPERCLIP_GITHUB_BROKER_TOKEN;
  if (!credential || !/^[A-Za-z0-9_-]{43,128}$/.test(credential)) throw new Error('Broker access is not configured.');
  try {
    const response = await fetchImpl(new URL('/v1/token', base), {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(40_000),
      headers: { Authorization: `Bearer ${credential}` },
    });
    if (!response.ok) throw new Error('Unavailable');
    const value = await response.json();
    if (typeof value?.token !== 'string' || !value.token || /\s/.test(value.token)
        || !(Date.parse(value.expires_at) > Date.now() + 60_000)) throw new Error('Invalid response');
    return value.token;
  } catch { throw new Error('GitHub credential unavailable; check broker health and agent access.'); }
}
