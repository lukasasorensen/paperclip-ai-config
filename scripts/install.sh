#!/bin/sh
# Install artifacts only; never start services, overwrite secrets, or change Paperclip.
set -eu
repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
stage_dir=${DESTDIR:-}
if [ -z "$stage_dir" ]; then
  [ "$(id -u)" = 0 ] || { echo 'Run as root or set DESTDIR for a staging install.' >&2; exit 1; }
  if ! id paperclip-github-auth >/dev/null 2>&1; then
    useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin paperclip-github-auth
  fi
fi
app_dir="$stage_dir/opt/paperclip-github-auth"
config_dir="$stage_dir/etc/paperclip-github-auth"
install -d -m 755 "$app_dir/lib" "$app_dir/helpers" "$app_dir/bin" "$app_dir/deploy" "$app_dir/scripts" "$stage_dir/etc/systemd/system"
install -d -m 700 "$config_dir"
install -m 644 "$repo_dir/mint-token.mjs" "$repo_dir/broker.mjs" "$app_dir/"
install -m 644 "$repo_dir/README.md" "$repo_dir/LICENSE" "$app_dir/"
install -m 644 "$repo_dir/scripts/manage.mjs" "$app_dir/scripts/"
install -m 644 "$repo_dir/scripts/smoke-agent.mjs" "$app_dir/scripts/"
install -m 644 "$repo_dir/scripts/check-sandbox.mjs" "$app_dir/scripts/"
for source_file in "$repo_dir"/lib/*.mjs; do install -m 644 "$source_file" "$app_dir/lib/"; done
for source_file in "$repo_dir"/helpers/*.mjs; do install -m 755 "$source_file" "$app_dir/helpers/"; done
ln -sfn ../helpers/gh.mjs "$app_dir/bin/gh"
install -m 755 "$repo_dir/deploy/paperclip-bwrap" "$app_dir/bin/paperclip-bwrap"
install -m 644 "$repo_dir/deploy/agent-env.example.json" "$repo_dir/deploy/config.example.json" "$repo_dir/deploy/service.env.example" "$app_dir/deploy/"
install -m 644 "$repo_dir/deploy/paperclip-github-auth.service" "$stage_dir/etc/systemd/system/"
if [ ! -f "$config_dir/config.json" ]; then install -m 600 "$repo_dir/deploy/config.example.json" "$config_dir/config.json"; fi
if [ ! -f "$config_dir/service.env" ]; then install -m 600 "$repo_dir/deploy/service.env.example" "$config_dir/service.env"; fi
if [ -z "$stage_dir" ]; then chown -R paperclip-github-auth:paperclip-github-auth "$config_dir"; fi
echo 'Installed independent service artifacts. Configure secrets and agent access before enabling the service; see README.md.'
