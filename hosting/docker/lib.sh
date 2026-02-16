#!/usr/bin/env bash
# Shared helpers for trigger.container hosting scripts

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Wrap docker compose with correct file/project args based on mode
# Usage: docker_compose <mode> [docker-compose-args...]
docker_compose() {
  local mode="${1:?Usage: docker_compose <full|webapp|worker> [args...]}"
  shift

  case "$mode" in
    full)
      docker compose -f "$SCRIPT_DIR/docker-compose.yml" "$@"
      ;;
    webapp)
      docker compose -f "$SCRIPT_DIR/webapp/docker-compose.yml" -p trigger-webapp "$@"
      ;;
    worker)
      docker compose -f "$SCRIPT_DIR/worker/docker-compose.yml" -p trigger-worker "$@"
      ;;
    *)
      echo "Error: unknown mode '$mode' (expected: full, webapp, worker)" >&2
      return 1
      ;;
  esac
}

# Generate random secrets for .env
generate_secrets() {
  local env_file="${1:-.env}"

  if ! command -v openssl &>/dev/null; then
    echo "Error: openssl is required to generate secrets" >&2
    return 1
  fi

  local session_secret magic_link_secret encryption_key managed_worker_secret
  session_secret="$(openssl rand -hex 16)"
  magic_link_secret="$(openssl rand -hex 16)"
  encryption_key="$(openssl rand -hex 16)"
  managed_worker_secret="$(openssl rand -hex 16)"

  sed -i \
    -e "s/^SESSION_SECRET=.*/SESSION_SECRET=${session_secret}/" \
    -e "s/^MAGIC_LINK_SECRET=.*/MAGIC_LINK_SECRET=${magic_link_secret}/" \
    -e "s/^ENCRYPTION_KEY=.*/ENCRYPTION_KEY=${encryption_key}/" \
    -e "s/^MANAGED_WORKER_SECRET=.*/MANAGED_WORKER_SECRET=${managed_worker_secret}/" \
    "$env_file"

  echo "Secrets generated and written to $env_file"
}

# Ensure .env exists, creating from .env.example if needed
ensure_env() {
  local env_file="$SCRIPT_DIR/.env"

  if [[ -f "$env_file" ]]; then
    return 0
  fi

  if [[ ! -f "$SCRIPT_DIR/.env.example" ]]; then
    echo "Error: no .env or .env.example found in $SCRIPT_DIR" >&2
    return 1
  fi

  echo "Creating .env from .env.example..."
  cp "$SCRIPT_DIR/.env.example" "$env_file"

  read -rp "Generate new secrets? [Y/n] " answer
  case "${answer:-Y}" in
    [Yy]*)
      generate_secrets "$env_file"
      ;;
    *)
      echo "Skipped secret generation. Update secrets in .env before production use."
      ;;
  esac
}
