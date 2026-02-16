#!/usr/bin/env bash
# Update Trigger.dev services (pull latest images and restart)
# Usage: ./update.sh [full|webapp|worker]
#   full   — combined stack (default)
#   webapp — webapp services only
#   worker — worker services only

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

MODE="${1:-full}"

echo "Pulling latest images ($MODE)..."
docker_compose "$MODE" pull

echo "Restarting services ($MODE)..."
docker_compose "$MODE" up -d

echo "Trigger.dev ($MODE) updated."
