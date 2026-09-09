import { readFile } from 'node:fs/promises';

export function localUrl(value, label) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`Invalid ${label} URL.`); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash
      || (url.protocol === 'http:' && !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname))) {
    throw new Error(`${label} must use HTTPS or loopback HTTP, without credentials or query parameters.`);
  }
  return url;
}

const id = (value) => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
export function validateConfig(config) {
  if (!config || config.version !== 1 || !Number.isInteger(config.port) || config.port < 1024 || config.port > 65535) {
    throw new Error('Config requires version 1 and a port between 1024 and 65535.');
  }
  localUrl(config.paperclip?.url, 'Paperclip');
  if (!config.paperclip?.apiKeyPath?.startsWith('/')) throw new Error('Use an absolute Paperclip apiKeyPath.');
  if (!Array.isArray(config.targets) || !Array.isArray(config.clients)) throw new Error('Config requires targets and clients arrays.');
  const companies = new Set();
  const secrets = new Set();
  for (const target of config.targets) {
    if (!id(target.companyId) || !id(target.secretId) || companies.has(target.companyId) || secrets.has(target.secretId)) {
      throw new Error('Targets require unique companyId and secretId values.');
    }
    companies.add(target.companyId); secrets.add(target.secretId);
  }
  const clients = new Set();
  const hashes = new Set();
  for (const client of config.clients) {
    const name = `${client.companyId}/${client.agentId}`;
    if (!companies.has(client.companyId) || !id(client.agentId) || !/^[a-f0-9]{64}$/.test(client.sha256)
        || clients.has(name) || hashes.has(client.sha256)) throw new Error('Invalid or duplicate client configuration.');
    clients.add(name); hashes.add(client.sha256);
  }
  return config;
}

export async function readConfig(path) {
  try { return validateConfig(JSON.parse(await readFile(path, 'utf8'))); }
  catch { throw new Error('Cannot load broker configuration; check JSON, IDs, URLs, and file permissions.'); }
}
