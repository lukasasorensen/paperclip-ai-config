#!/usr/bin/env node
import { readFile, writeFile, rename } from 'node:fs/promises';
import { randomBytes, createHash } from 'node:crypto';
import { readConfig } from '../lib/config.mjs';
import { paperclipApi } from '../lib/paperclip.mjs';
import { mintToken } from '../mint-token.mjs';

const usage = `Usage:
  node --env-file=/etc/paperclip-github-auth/service.env scripts/manage.mjs company CONFIG COMPANY_ID [EXISTING_GH_TOKEN_SECRET_ID]
  node scripts/manage.mjs enroll CONFIG COMPANY_ID AGENT_ID OUTPUT_ENV_JSON
  node scripts/manage.mjs revoke CONFIG COMPANY_ID AGENT_ID

company creates a GH_TOKEN secret (or explicitly adopts the supplied ID).
enroll creates/rotates a per-agent broker secret and writes secret-free env bindings.
revoke removes broker authorization; remove agent env bindings separately.
These commands change configuration and use the existing Paperclip board API.
Run one management command at a time; see README.md.
`;

async function saveConfig(file, config) {
  const temporary = `${file}.${randomBytes(8).toString('hex')}.tmp`;
  await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  await rename(temporary, file);
}

async function main() {
  const [action, file, companyId, extra, output, ...rest] = process.argv.slice(2);
  if (action === '--help') { process.stdout.write(usage); return; }
  if (!['company', 'enroll', 'revoke'].includes(action) || !file || !/^[a-zA-Z0-9_-]{1,128}$/.test(companyId ?? '')
      || rest.length || (action === 'company' && output) || (action === 'enroll' && (!extra || !output))
      || (action === 'revoke' && (!extra || output))) throw new Error(usage);
  const config = await readConfig(file);
  const api = paperclipApi(config.paperclip);
  if (action === 'revoke') {
    config.clients = config.clients.filter((client) => !(client.companyId === companyId && client.agentId === extra));
    await saveConfig(file, config);
    process.stdout.write('Broker authorization removed. Remove agent bindings too; issued GitHub tokens can remain valid until expiry.\n'); return;
  }
  const secrets = await api(`/companies/${companyId}/secrets`);
  if (!Array.isArray(secrets)) throw new Error('Unexpected secrets API response.');
  if (action === 'company') {
    if (config.targets.some((target) => target.companyId === companyId)) throw new Error('Company already configured.');
    let secret;
    if (extra) {
      secret = secrets.find((entry) => entry.id === extra && entry.name === 'GH_TOKEN' && entry.status === 'active' && entry.provider === 'local_encrypted');
      if (!secret) throw new Error('Supplied ID must be an active local_encrypted GH_TOKEN company secret.');
    } else {
      if (secrets.some((entry) => ['GH_TOKEN', 'GITHUB_TOKEN', 'PAPERCLIP_GITHUB_TOKEN'].includes(entry.name) && entry.status !== 'deleted')) {
        throw new Error('Existing GitHub credentials found. Review their consumers and precedence; explicitly adopt GH_TOKEN by ID.');
      }
      const value = await mintToken();
      secret = await api(`/companies/${companyId}/secrets`, {
        method: 'POST', body: { name: 'GH_TOKEN', provider: 'local_encrypted', value: value.token, description: 'Installation token rotated by paperclip-github-auth' },
      });
    }
    if (!secret?.id) throw new Error('Secret creation returned no ID.');
    config.targets.push({ companyId, secretId: secret.id });
    await saveConfig(file, config);
    process.stdout.write('Company configured. The broker will publish fresh installation tokens to its GH_TOKEN secret.\n'); return;
  }
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(extra)) throw new Error('Invalid agent ID.');
  const target = config.targets.find((entry) => entry.companyId === companyId);
  if (!target) throw new Error('Configure the company first.');
  const agent = await api(`/agents/${extra}`);
  if (agent.companyId !== companyId || !['codex_local', 'claude_local'].includes(agent.adapterType)
      || agent.adapterConfig?.filesystemScope !== 'workspace') {
    throw new Error('Agent must belong to the company, use codex_local or claude_local, and have filesystemScope=workspace.');
  }
  // Create the output file first, refusing to overwrite a reviewed configuration.
  await writeFile(output, '', { flag: 'wx', mode: 0o600 });
  const credential = randomBytes(32).toString('base64url');
  const name = `PAPERCLIP_GITHUB_BROKER_${extra}`;
  let secret = secrets.find((entry) => entry.name === name && entry.status === 'active');
  if (secret) {
    if (secret.provider !== 'local_encrypted') throw new Error('Existing broker secret must use local_encrypted.');
    await api(`/secrets/${secret.id}/rotate`, { method: 'POST', body: { value: credential } });
  } else {
    secret = await api(`/companies/${companyId}/secrets`, { method: 'POST', body: { name, provider: 'local_encrypted', value: credential } });
  }
  if (!secret?.id) throw new Error('Broker secret creation returned no ID.');
  config.clients = config.clients.filter((client) => !(client.companyId === companyId && client.agentId === extra));
  config.clients.push({ companyId, agentId: extra, sha256: createHash('sha256').update(credential).digest('hex') });
  await saveConfig(file, config);
  const env = JSON.parse(await readFile(new URL('../deploy/agent-env.example.json', import.meta.url), 'utf8'));
  env.GH_TOKEN.secretId = target.secretId;
  env.PAPERCLIP_GITHUB_BROKER_TOKEN.secretId = secret.id;
  env.PAPERCLIP_GITHUB_BROKER_URL = `http://127.0.0.1:${config.port}`;
  await writeFile(output, `${JSON.stringify(env, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write('Agent enrolled. Review the generated env bindings and merge them into the agent configuration.\n');
}
main().catch((error) => {
  // Only our own messages; API/network implementations never include remote bodies.
  const message = error?.code ? 'Local file operation failed; check paths, ownership, and output-file existence.' : error.message;
  process.stderr.write(`github-auth-manage: ${message}\n`); process.exitCode = 1;
});
