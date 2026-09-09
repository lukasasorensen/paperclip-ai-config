# paperclip-ai-config

GitHub App authentication for a self-hosted Paperclip server, without modifying
Paperclip source code. This repository contains the token script, independent
credential service, agent helpers, installer, service unit, configuration
examples, and tests. Installation does not start services or enable agents.

## Architecture and Paperclip updates

```text
App private key (outside agent sandboxes)
                 |
paperclip-github-auth.service -> mint-token.mjs -> installation token cache
                 |                                 |
       existing Paperclip Secrets API       authenticated local broker
                 |                                 |
       company GH_TOKEN secret              agent Git helper / gh launcher
                 |                                 |
       managed clone/fetch + bindings       clone, fetch, push, pull requests
```

Paperclip documents GitHub Apps and secret-backed agent environment variables.
**Automatic refresh here is custom operational code using supported interfaces,
not a built-in Paperclip feature.** See the [GitHub setup guide](https://docs.paperclip.ing/how-to/connect-agent-to-github/),
[secrets configuration](https://docs.paperclip.ing/reference/deploy/secrets/), and
[Secrets API](https://docs.paperclip.ing/reference/api/secrets/).

The installer does not edit `/opt/paperclip-ai`, Paperclip's service unit,
environment file, database schema, routes, adapters, or packages. It installs
only a separate application, configuration directory, and systemd unit.
There is no Paperclip source patch to reapply. After updates, still run a smoke
test: public APIs and sandbox configuration may change in future versions.

Integration interfaces were checked against the installed Paperclip source on
2026-09-09: board API key authentication, company secret list/create/rotate,
agent metadata, filesystem sandbox settings, and agent environment bindings.
An **agent API key cannot rotate company secrets**; the service needs a board
API key authorized for the configured companies.

## Access boundaries

- One GitHub App installation per broker. In GitHub, select the private repos
  and grant Contents read/write and Pull requests read/write. Add other
  permissions only when needed (for example, workflow-file changes).
- Every enrolled agent receives the installation's full selected-repository
  access. Client IDs are administrative labels linked to bearer credentials;
  they are not an independent agent identity check or run-bound authorization.
- Only enrolled agents receive broker and GitHub bindings. However, a company
  secret named `GH_TOKEN` also enables Paperclip's **server-side managed Git**
  operations by name. This is company-level clone access, not an agent-specific
  clone gate. Workspace permissions govern access to already cloned files.
- Supported enrollment targets are locally sandboxed `codex_local` and
  `claude_local` agents. Remote runtimes are outside this version.
- The private key, board key and broker config must be excluded from every
  untrusted agent mount, including parent-directory mounts. Unrestricted host
  root processes can read them regardless of file ownership. A separate service
  account alone does not isolate credentials from unrestricted root agents.
- Agents can read and disclose credentials delivered to them. Helpers avoid
  logging credentials and redact known tokens from `gh` output; that cannot
  prevent an agent deliberately printing or exfiltrating a secret.
- Use GitHub.com HTTPS remotes without embedded credentials, such as
  `https://github.com/OWNER/REPO.git`. SSH and GitHub Enterprise are unsupported.
- GitHub rulesets/branch protection govern protected-branch writes and merges.
  Keep the App out of bypass lists. PR instructions alone do not enforce this.

## Installed files and Git backup coverage

| Installed/runtime location | Tracked source | Recovery |
| --- | --- | --- |
| `/opt/paperclip-github-auth/broker.mjs`, `mint-token.mjs`, `lib/` | Same files here | Reinstall a recorded Git revision |
| `/opt/paperclip-github-auth/helpers/`, `bin/gh` | `helpers/`; installer creates symlink | Reinstall |
| `/opt/paperclip-github-auth/scripts/manage.mjs` | `scripts/manage.mjs` | Reinstall |
| `/opt/paperclip-github-auth/deploy/` | `deploy/` | Reinstall examples |
| `/etc/systemd/system/paperclip-github-auth.service` | `deploy/paperclip-github-auth.service` | Reinstall |
| `/etc/paperclip-github-auth/config.json` | `deploy/config.example.json` is the template | Back up actual IDs and client hashes as restricted operational metadata |
| `/etc/paperclip-github-auth/service.env` | `deploy/service.env.example` | Back up populated configuration securely |
| `/etc/paperclip-github-auth/paperclip-api-key` | Intentionally untracked | Encrypted backup or issue a new board key |
| `/etc/paperclip/github/paperclip-agent-bot.private-key.pem` | Intentionally untracked | Encrypted backup or rotate the App key |
| Paperclip settings, bindings, encrypted secret versions | Secret-free deployment templates may be tracked here | Back up database **and actual configured secrets master key** |
| Generated agent-env JSON | Derived from `deploy/agent-env.example.json` | IDs only; review and track an operator copy if appropriate |
| In-memory token cache | None | Regenerate on restart |
| `/tmp/paperclip-gh-*` | Created by launcher | Isolated CLI config; removed on exit, no backup |
| systemd journal | Runtime logs | Normal log retention, no credentials intentionally logged |

**No custom executable code is maintained only outside Git.** Update installed
copies from this repository, not by editing them in place. Commit and push the
repository to your backed-up remote as part of deployment; uncommitted files
are not backed up by Git.

`.gitignore` excludes private keys, populated `.env` files, `runtime/`,
`*.credential`, `paperclip-api-key`, and `config.local.json`. Never force-add
secrets. Actual credential files need encrypted backups outside Git.

## Host prerequisites

1. Linux/systemd, Node.js 22+ at `/usr/bin/node`, Git, GitHub CLI at `/usr/bin/gh`,
   and Paperclip sandbox dependencies including `bwrap`.
2. Running Paperclip, an existing company/coding agent, and a board API key with
   company access. Provision the key from a secure file, not a prompt or argv.
3. The App RSA private key and correct installation ID.
4. Host access to `api.github.com` and agent access to GitHub plus the broker.
5. A dedicated private pilot repository included in the App installation.

The broker binds **127.0.0.1:3199 only**. Do not expose it through public port
forwarding or a reverse proxy. Every token request requires a per-agent bearer
key; browser-origin requests are rejected. Start with workspace filesystem
confinement and shared host networking. Separate network namespaces/proxies need
an actual connectivity test; they are not automatically configured here.

## Installation

From this checkout:

```sh
npm test
npm run check
sudo sh scripts/install.sh
```

There are no npm dependencies. The installer creates a dedicated
`paperclip-github-auth` system user, preserves existing `config.json` and
`service.env`, and **does not start/restart either service**. Inspect a staging
install without touching host configuration using:

```sh
DESTDIR=/tmp/paperclip-github-auth-stage sh scripts/install.sh
```

Provision credentials from secure local files, replacing the source paths:

```sh
sudo install -d -o paperclip-github-auth -g paperclip-github-auth -m 0700 /etc/paperclip/github
sudo install -o paperclip-github-auth -g paperclip-github-auth -m 0600 /secure/app-private-key.pem /etc/paperclip/github/paperclip-agent-bot.private-key.pem
sudo install -o paperclip-github-auth -g paperclip-github-auth -m 0600 /secure/paperclip-board-key /etc/paperclip-github-auth/paperclip-api-key
sudoedit /etc/paperclip-github-auth/service.env
sudoedit /etc/paperclip-github-auth/config.json
```

Set the Paperclip server URL **without `/api`** in `config.json`. HTTP is accepted
only for loopback hosts; use HTTPS otherwise. URLs may not contain credentials,
queries or fragments. Initially keep `targets` and `clients` empty. Keep config
files service-account-owned and mode 0600. The App ID, installation and key path
are in `service.env`; systemd loads this file, the minting module does not.

### Register a company

Run management commands as the service user so atomically rewritten config files
retain the correct ownership. Replace `COMPANY_ID`:

```sh
sudo -u paperclip-github-auth /usr/bin/node --env-file=/etc/paperclip-github-auth/service.env /opt/paperclip-github-auth/scripts/manage.mjs company /etc/paperclip-github-auth/config.json COMPANY_ID
```

This creates an encrypted company `GH_TOKEN` secret containing an initial
installation token, and saves its ID. No agent is bound. It refuses creation if
an existing GitHub credential is detected.

To deliberately adopt an existing active `local_encrypted` **GH_TOKEN** secret,
append its secret ID to this command. Adoption allows the broker to replace its
value: inspect existing consumers first. Paperclip checks `GITHUB_TOKEN` before
`GH_TOKEN` for managed Git. Review any competing credential and its consumers;
adopting GH_TOKEN does not change this precedence.

Run management commands serially. API and filesystem changes are not one
transaction. After interruption, inspect Secrets and config before retrying.
A company secret created before a file-write failure can be adopted by ID;
re-enrollment rotates the existing named broker credential.

### Start the broker

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now paperclip-github-auth.service
curl --fail http://127.0.0.1:3199/healthz
sudo journalctl -u paperclip-github-auth.service -n 30 --no-pager
```

Health exposes only `ready`, `refreshes`, and `failures`. It returns 503 until
minting and all configured Paperclip publications succeed. Logs omit credentials,
headers and remote response bodies.

## Opt in an agent

1. Configure the agent's adapter with workspace filesystem confinement and a
   read-only helper mount. Merge with required existing mounts:

   ```json
   {
     "filesystemScope": "workspace",
     "filesystemExtraPaths": [
       { "path": "/opt/paperclip-github-auth", "access": "ro" }
     ]
   }
   ```

   Never mount `/etc`, the credential directories, or broad parents exposing host
   credentials. Check the live sandbox; a configuration flag is not proof of isolation.

2. Enroll the selected agent, replacing IDs and using a **new** output filename:

   ```sh
   sudo -u paperclip-github-auth /usr/bin/node /opt/paperclip-github-auth/scripts/manage.mjs enroll /etc/paperclip-github-auth/config.json COMPANY_ID AGENT_ID /etc/paperclip-github-auth/agent-env.json
   ```

   Enrollment checks company, local adapter type and filesystem-scope setting.
   It stores a random broker credential in Paperclip and only its SHA-256 hash
   in the allowlist. It never prints the credential or modifies the agent.

3. Review the generated JSON and merge it into the agent's **env** using
   Paperclip's UI/API, preserving unrelated settings. Keep secret references at
   `latest`. This binds the actual GitHub token as `GH_TOKEN`, satisfying existing
   PR preflight, and a separate broker credential for command-time refresh.

4. Preserve existing CLI PATH entries, with `/opt/paperclip-github-auth/bin` first.
   The example PATH matches this host. Set `PAPERCLIP_GITHUB_REAL_GH` if the real
   CLI is not `/usr/bin/gh`.

5. The generated `GIT_CONFIG_COUNT` entries clear competing helpers and GitHub
   extra authentication headers, then install the GitHub-only helper.
   If `GIT_CONFIG_*` already exists, merge and renumber
   entries rather than silently replacing it. Review project/environment
   overrides for conflicting credentials, Git config, PATH, and broker settings.

6. Configure clean HTTPS project `repoUrl`, base branch, and workspace mode using
   normal Paperclip settings. Instruct agents to work on branches and open PRs.

Agents use normal `git` and `gh` commands. The Git helper refreshes credentials
on `get` and never persists `store`/`erase`. The `gh` launcher refreshes each
invocation, isolates CLI config, preserves arguments and exit codes, and redacts
known credentials in stdout/stderr. It blocks `gh auth` except `auth status`;
manage authentication through the broker. Saved host logins and aliases are not
used. Calling `/usr/bin/gh` directly bypasses command-time refresh.

## Refresh and revocation

- The broker caches installation tokens in memory and refreshes when fewer than
  five minutes remain. Concurrent requests share a mint attempt.
- A 60-second maintenance pass rotates changed tokens through the existing
  Secrets API. It verifies active company GH_TOKEN metadata, skips completed
  targets, and retries failures on the next pass.
- Valid broker credentials can still work while Paperclip's API is unavailable;
  health stays degraded until publication recovers. Mint failures do not return
  stale near-expiry credentials.
- Secret rotation does not update a running child's environment. Helpers refresh
  between commands. A **single command** making requests beyond token expiry may
  require restarting; this is not mid-command token replacement.
- Restarts mint and publish a fresh token. Rotations add database secret versions;
  account for this in retention/backups. This service never prunes secret history
  or writes directly to Paperclip's database.
- Config is reloaded per token request and maintenance pass. Changes to the port
  or service environment require a broker restart.

Revoke broker access with:

```sh
sudo -u paperclip-github-auth /usr/bin/node /opt/paperclip-github-auth/scripts/manage.mjs revoke /etc/paperclip-github-auth/config.json COMPANY_ID AGENT_ID
```

**Also remove the agent's GH_TOKEN and broker bindings in Paperclip**, and stop
active runs if needed. Broker revocation alone does not remove its native token
binding. Issued GitHub tokens may remain usable until expiry. Emergency App
revocation affects other agents sharing the installation. Re-enroll and apply
updated bindings to restore access; re-enrollment rotates its broker key.

## Pilot and acceptance checks

Use a dedicated private test repo and the actual Paperclip agent sandbox:

- Confirm `command -v gh` points to the launcher. Verify helper visibility and
  that the App key, board key, config and host process/privileged escape paths
  are inaccessible. Unrestricted root agents invalidate this isolation claim.
- Check broker connectivity. If network isolation exists, test its real proxy
  path; do not expose the broker publicly or disable isolation as a workaround.
- Verify Paperclip managed clone/base fetch, then agent clone/fetch, a harmless
  temporary branch push, and draft PR creation. Verify App identity in GitHub;
  Git commit author name/email are separate settings.
- Confirm a **private** repo outside the installation is denied. Public repos
  are not a valid negative test because anonymous reads are possible.
- Run another authenticated operation after renewal without restarting the
  agent. Revoke the pilot and remove bindings; verify later retrieval fails.
- Inspect and close the draft PR, then remove the pilot branch.

Automated tests use temporary RSA keys, mocked APIs, loopback HTTP, real Git
credential plumbing, a fake gh executable, and a staged install. They do not
access personal repos or prove production sandbox isolation.

```sh
npm test
npm run check
git diff --check
```

Tests require subprocesses and loopback listeners. An execution sandbox can
report EPERM; use a test context that permits these operations without weakening
the production sandbox policy.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Health 503 / refresh failure | App IDs, RSA key permissions, clock, GitHub access, board key and company permissions |
| Broker works, health stays 503 | Paperclip publication and target metadata; use active local_encrypted GH_TOKEN |
| Managed clone uses wrong credential | Existing GITHUB_TOKEN takes precedence; inspect consumers before changes |
| PR preflight fails | Bind the actual installation secret as agent GH_TOKEN at latest, not the broker credential |
| Works on host, not in sandbox | Read-only helper mount, PATH, executable paths, loopback/proxy and env overrides |
| Git prompts / stale auth | Helper configuration, clean HTTPS remote, competing inline credentials/auth headers |
| SSH/public-key error | Change remote to HTTPS |
| gh fails | Broker binding, revocation, real gh path, launcher PATH and health |
| Enrollment output error | Use a new output filename; existing output files are not overwritten |
| Config unreadable | Valid JSON, service account ownership and 0600 mode |

Do not debug with `env`, shell tracing, raw credential-fill output, authorization
headers, or key contents in shared logs. Inspect metadata and status instead.

## Backup, restore and rollback

Before deploying/updating, record the Git revision and back up committed history
to your remote, `/etc/paperclip-github-auth` and the App key to encrypted storage,
and Paperclip's database together with its **actual configured** encryption master
key. Secret-free company exports cannot restore usable credentials by themselves.
Preserve non-secret agent/project bindings and sandbox settings as well.

Restore by reinstalling the recorded revision, restoring restricted config/key
ownership, restoring the database and encryption key together, then running the
pilot. Keys may instead be reissued. Re-enroll agents if broker hashes and stored
secret values no longer match.

For a **Paperclip update**, use its normal update procedure. Afterwards verify
secret publication, agent preflight, helper mounts, managed Git and agent Git/gh
before resuming unattended work. No source patch or unit override is involved.

For an **integration update**, test the revision, pause pilot work, stop the
broker, rerun the installer, reload systemd, restart the broker, and run the pilot.
The installer preserves operator config but overwrites tracked artifacts/unit.
The copy operation is not an atomic live upgrade; stop the broker first.

Rollback removes the added agent bindings, helper PATH/Git settings and optional
mount, then disables the independent service:

```sh
sudo systemctl disable --now paperclip-github-auth.service
```

Review GH_TOKEN consumers before disabling/deleting it: that also removes managed
clone access through it. Install a previous integration revision if desired.
Paperclip's source and update process require no restoration.

## Mint a GitHub App token

`mint-token.mjs` uses Node.js 22+ built-ins (no npm dependencies) to sign an
RS256 JWT and exchange it for a GitHub installation access token. Defaults match
the existing `paperclip-agent-bot` App:

| Environment variable | Default |
| --- | --- |
| `GITHUB_APP_ID` | `4501865` (can also be a Client ID) |
| `GITHUB_INSTALLATION_ID` | `151595108` |
| `GITHUB_APP_PRIVATE_KEY_PATH` | `/etc/paperclip/github/paperclip-agent-bot.private-key.pem` |

Place the App's downloaded private key at that path on the server, or override
the path. Restrict the key to the trusted server account (for example, file mode
`0600` and a parent directory accessible only to that account). Do not commit the
key or use the App's OAuth client secret. `.env.example` lists the configuration;
the script reads exported environment variables, not `.env` files automatically.

Run from this checkout:

```sh
node mint-token.mjs
node mint-token.mjs --json
```

Default stdout contains only the token plus a newline. `--json` emits only
`{"token":"...","expires_at":"..."}`. Errors go to stderr with a nonzero exit
code and no token output. The script does not store tokens on disk.

For a trusted server-side shell command, check minting succeeds before running
`gh`, so an authentication failure cannot fall back to saved personal credentials:

```sh
token="$(node /path/to/paperclip-ai-config/mint-token.mjs)" || exit 1
GH_TOKEN="$token" gh pr list --repo OWNER/REPO
unset token
```

The server can also import `mintToken()` and pass its returned `token` as
`GH_TOKEN` to an agent subprocess. Installation tokens expire after about one
hour: mint again before expiry using `expires_at`, or before each operation.
Updating the server environment does not refresh an already-running child's
environment. `GH_TOKEN` authenticates `gh`; bare Git needs its own HTTPS credential
helper configured to use that token.

Run minting in the trusted server process, and give agents only the resulting
short-lived token. A script or wrapper running under the same unrestricted OS
account as an agent does **not** isolate the private key; that needs process/user
isolation or a trusted token broker. The independent broker and configuration
integration supplied by this repository are described above.

Tokens inherit the installation's selected repositories and granted permissions.
Enforce PR-only changes with GitHub branch rules/rulesets and keep the App out of
their bypass lists; the minting script cannot prevent direct pushes by itself.

Protocol references: [GitHub JWT authentication](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app)
and [installation access tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app).

## Tests

```sh
node --test
```

Tests generate temporary RSA keys and mock GitHub; no real credentials or external
network requests are needed. Integration tests use local loopback HTTP listeners.
