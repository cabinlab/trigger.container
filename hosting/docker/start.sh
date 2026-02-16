#!/usr/bin/env bash
# Start Trigger.dev services
# Usage: ./start.sh [full|webapp|worker]
#   full   — combined stack (default), uses docker-compose.yml with includes
#   webapp — webapp services only (for split deployments)
#   worker — worker services only (for split deployments)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

MODE="${1:-full}"

ensure_env

echo "Starting Trigger.dev ($MODE)..."
docker_compose "$MODE" up -d

echo ""
echo "Trigger.dev ($MODE) is starting."
echo "  Webapp: http://localhost:8030 (when ready)"
echo "  Logs:   docker compose -f $SCRIPT_DIR/docker-compose.yml logs -f"
