#!/usr/bin/env bash
# Stop Trigger.dev services
# Usage: ./stop.sh [full|webapp|worker]
#   full   — combined stack (default)
#   webapp — webapp services only
#   worker — worker services only

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

MODE="${1:-full}"

echo "Stopping Trigger.dev ($MODE)..."
docker_compose "$MODE" down

echo "Trigger.dev ($MODE) stopped."
