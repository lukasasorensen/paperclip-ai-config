import { readFile } from 'node:fs/promises';
import { localUrl } from './config.mjs';

// Existing board-authenticated REST API only; never access Paperclip's database.
export function paperclipApi(config, fetchImpl = globalThis.fetch) {
  const base = localUrl(config.url, 'Paperclip');
  return async (path, { method = 'GET', body } = {}) => {
    let response;
    try {
      const key = (await readFile(config.apiKeyPath, 'utf8')).trim();
      if (!key || /\s/.test(key)) throw new Error('Invalid key');
      response = await fetchImpl(new URL(`${base.pathname.replace(/\/$/, '')}/api${path}`, base), {
        method, redirect: 'error', signal: AbortSignal.timeout(30_000),
        headers: { Authorization: `Bearer ${key}`, Accept: 'application/json', 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch { throw new Error('Paperclip request failed; check API URL, board API key file, and connectivity.'); }
    if (!response.ok) throw new Error(`Paperclip returned HTTP ${response.status}; check board access and secret configuration.`);
    try { return await response.json(); }
    catch { throw new Error('Paperclip returned invalid JSON.'); }
  };
}

export async function publishToken(api, target, token) {
  // Prevent a mistyped secret ID from rotating an unrelated credential.
  const secrets = await api(`/companies/${target.companyId}/secrets`);
  const secret = Array.isArray(secrets) ? secrets.find((item) => item.id === target.secretId) : null;
  if (!secret || secret.companyId !== target.companyId || secret.name !== (target.secretName ?? 'GH_TOKEN')
      || secret.provider !== 'local_encrypted' || secret.status !== 'active') {
    throw new Error('Rotation target must match the configured company and secret name and be active with local_encrypted storage.');
  }
  await api(`/secrets/${target.secretId}/rotate`, { method: 'POST', body: { value: token } });
}
