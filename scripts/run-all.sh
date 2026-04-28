#!/usr/bin/env bash
# ============================================================
# run-all.sh — Full documentation video pipeline
#
# Usage (from skill root):
#   bash scripts/run-all.sh projects/<app>/flows/<flow>.json
#   bash scripts/run-all.sh projects/<app>/flows/<flow>.json --skip-audio
#   bash scripts/run-all.sh projects/<app>/flows/<flow>.json --skip-video
# ============================================================
set -e

# Always run from the skill root so relative paths work
cd "$(dirname "$0")/.."

FLOW="$1"
SKIP_AUDIO=false
SKIP_VIDEO=false

for arg in "$@"; do
  [[ "$arg" == "--skip-audio" ]] && SKIP_AUDIO=true
  [[ "$arg" == "--skip-video" ]] && SKIP_VIDEO=true
done

if [[ -z "$FLOW" ]]; then
  echo "Usage: $0 <flow.json> [--skip-audio] [--skip-video]"
  exit 1
fi

if [[ ! -f "$FLOW" ]]; then
  echo "❌ Flow file not found: $FLOW"
  exit 1
fi

ENRICHED="${FLOW/.json/.enriched.json}"

echo "============================================"
echo " documentation-video pipeline"
echo " Flow: $FLOW"
echo "============================================"

# Step 1: Generate audio + enriched JSON
if [[ "$SKIP_AUDIO" == "false" ]]; then
  echo ""
  echo "📣 Step 1/3: Generating audio (ElevenLabs)..."
  npx tsx scripts/generate-audio.ts "$FLOW"
else
  echo "⏭  Step 1/3: Skipping audio generation (using existing enriched.json)"
fi

# Step 2: Record video (uses enriched JSON for timing)
if [[ "$SKIP_VIDEO" == "false" ]]; then
  echo ""
  echo "🎬 Step 2/3: Recording browser video (Playwright)..."
  npx tsx scripts/generate-video.ts "$ENRICHED"
else
  echo "⏭  Step 2/3: Skipping video recording"
fi

# Step 3: Assemble audio + video → final mp4
echo ""
echo "🎞  Step 3/3: Assembling final video (FFmpeg)..."
npx tsx scripts/assemble.ts "$ENRICHED"

echo ""
echo "============================================"
echo " ✅ Pipeline complete!"
FLOW_NAME=$(basename "${FLOW/.json/}")
PROJECT_ROOT=$(dirname "$(dirname "$(realpath "$FLOW")")")
echo " Output: ${PROJECT_ROOT}/output/${FLOW_NAME}/final/"
echo "============================================"
