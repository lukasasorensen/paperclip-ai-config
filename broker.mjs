#!/usr/bin/env node
import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { mintToken } from './mint-token.mjs';
import { readConfig } from './lib/config.mjs';
import { paperclipApi, publishToken } from './lib/paperclip.mjs';
import { createTokenManager } from './lib/token-manager.mjs';

export function authenticate(header, clients) {
  if (typeof header !== 'string' || !/^Bearer [A-Za-z0-9_-]{43,128}$/.test(header)) return false;
  const hash = createHash('sha256').update(header.slice(7)).digest();
  return clients.some((client) => timingSafeEqual(hash, Buffer.from(client.sha256, 'hex')));
}

export function createBroker({ loadConfig, manager, publish, log = (message) => process.stderr.write(`${message}\n`) }) {
  const published = new Map();
  let syncPending;
  let ready = false;
  let failures = 0;
  let active = 0;
  async function sync() {
    syncPending ??= (async () => {
      try {
        const config = await loadConfig();
        const value = await manager.get();
        for (const target of config.targets) {
          const key = `${target.companyId}/${target.secretId}`;
          if (published.get(key) === value.token) continue;
          await publish(config, target, value.token);
          published.set(key, value.token);
        }
        ready = true;
      } catch {
        ready = false; failures += 1;
        log('github-auth: refresh or Paperclip secret publication failed; check configuration and connectivity.');
      }
    })().finally(() => { syncPending = undefined; });
    return syncPending;
  }
  const server = createServer({ maxHeaderSize: 4096, requestTimeout: 10_000, headersTimeout: 10_000 }, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json');
    const send = (status, value) => { res.writeHead(status); res.end(JSON.stringify(value)); };
    if (req.headers.origin || req.headers['transfer-encoding'] || (req.headers['content-length'] && req.headers['content-length'] !== '0')) {
      res.setHeader('Connection', 'close'); send(400, { error: 'Body and browser requests are not supported.' }); req.resume(); return;
    }
    if (req.method === 'GET' && req.url === '/healthz') {
      const status = manager.status();
      send(ready && status.ready ? 200 : 503, { ready: ready && status.ready, refreshes: status.refreshes, failures }); return;
    }
    if (req.method !== 'POST' || req.url !== '/v1/token') { send(404, { error: 'Not found.' }); return; }
    if (active >= 32) { send(503, { error: 'Busy; retry later.' }); return; }
    active += 1;
    try {
      // Reload on every request: removing a client takes effect without restarting.
      const config = await loadConfig();
      if (!authenticate(req.headers.authorization, config.clients)) { send(401, { error: 'Unauthorized.' }); return; }
      const value = await manager.get();
      // Recheck authorization after a potentially slow mint.
      if (!authenticate(req.headers.authorization, (await loadConfig()).clients)) { send(401, { error: 'Unauthorized.' }); return; }
      send(200, value);
    } catch { send(503, { error: 'Credential service unavailable.' }); }
    finally { active -= 1; }
  });
  return { server, sync };
}

export async function main() {
  const path = process.env.PAPERCLIP_GITHUB_CONFIG ?? '/etc/paperclip-github-auth/config.json';
  const initial = await readConfig(path);
  const loadConfig = () => readConfig(path);
  const manager = createTokenManager({ mint: () => mintToken() });
  const broker = createBroker({ loadConfig, manager, publish: (config, target, token) => publishToken(paperclipApi(config.paperclip), target, token) });
  await new Promise((resolve, reject) => {
    broker.server.once('error', reject);
    broker.server.listen(initial.port, '127.0.0.1', resolve);
  });
  const interval = setInterval(() => { void broker.sync(); }, 60_000);
  void broker.sync();
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
    clearInterval(interval); broker.server.close(); broker.server.closeAllConnections();
    setTimeout(() => process.exit(0), 1000).unref();
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { process.stderr.write('github-auth: startup failed; check configuration, permissions, and listen port.\n'); process.exitCode = 1; });
}
