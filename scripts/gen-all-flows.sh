#!/usr/bin/env bash
# Generate all flows for a given project directory
# Usage (from skill root): bash scripts/gen-all-flows.sh projects/<app>/flows [--skip-audio] [--skip-video]
set -e

# Always run from the skill root
cd "$(dirname "$0")/.."

FLOWS_DIR="${1:-projects}"
EXTRA_ARGS="${@:2}"

if [[ -z "$(ls -A "$FLOWS_DIR"/*.json 2>/dev/null)" ]]; then
  echo "❌ No .json flows found in: $FLOWS_DIR"
  echo "Usage: $0 <flows-directory> [--skip-audio] [--skip-video]"
  exit 1
fi

for flow in "$FLOWS_DIR"/*.json; do
  name=$(basename "${flow/.json/}")
  echo ""
  echo "=========================================="
  echo "  ▶ Starting: $name"
  echo "=========================================="
  bash scripts/run-all.sh "$flow" $EXTRA_ARGS && echo "  ✅ $name done" || echo "  ❌ $name FAILED"
done

echo ""
echo "======================================="
echo "  ✅ All flows complete!"
echo "======================================="
