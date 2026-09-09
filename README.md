# paperclip-ai-config

Configuration tools for the Paperclip AI server.

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
isolation or a trusted token broker. This repo provides the minting script, not
that broker or automatic Paperclip integration.

Tokens inherit the installation's selected repositories and granted permissions.
Enforce PR-only changes with GitHub branch rules/rulesets and keep the App out of
their bypass lists; the minting script cannot prevent direct pushes by itself.

Protocol references: [GitHub JWT authentication](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app)
and [installation access tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app).

## Tests

```sh
node --test
```

Tests generate a temporary RSA key and mock GitHub; no real credentials or network
requests are needed.
