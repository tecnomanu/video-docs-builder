#!/usr/bin/env bash
# ============================================================
# setup.sh — First-time setup for the video-docs-builder skill
#
# Run by the agent on first use (or when .env is missing).
# Installs npm deps, Playwright, checks FFmpeg, creates .env.
#   bash scripts/setup.sh
# ============================================================
set -e

SKILL_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SKILL_DIR"

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║     video-docs skill — setup wizard      ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── 1. Node dependencies ──────────────────────────────────────────────────────
echo "📦 Installing Node.js dependencies..."
npm install --silent
echo "   ✅ npm packages installed"

# ── 2. Playwright browser ─────────────────────────────────────────────────────
echo ""
echo "🌐 Installing Playwright Chromium (headless browser for recording)..."
npx playwright install chromium --quiet
echo "   ✅ Chromium installed"

# ── 3. FFmpeg check ───────────────────────────────────────────────────────────
echo ""
echo "🎞  Checking FFmpeg..."
if command -v ffmpeg &>/dev/null; then
  echo "   ✅ FFmpeg found: $(ffmpeg -version 2>&1 | head -1 | awk '{print $3}')"
else
  echo "   ⚠️  FFmpeg not found."
  if [[ "$(uname)" == "Darwin" ]]; then
    echo "   Run: brew install ffmpeg"
  else
    echo "   Run: sudo apt-get install ffmpeg"
  fi
  echo "   Setup will continue but video assembly will fail without it."
fi

# ── 4. .env setup ─────────────────────────────────────────────────────────────
echo ""
if [[ -f "$SKILL_DIR/.env" ]]; then
  echo "📄 .env already exists. Skipping TTS configuration."
  echo "   Edit .env manually to change provider or API keys."
else
  echo "🎙  Choose a TTS (Text-to-Speech) provider for narration:"
  echo ""
  echo "   A) Piper   — Free, runs locally, no API key needed (recommended)"
  echo "              — Voice: Daniela (Argentina, natural accent)"
  echo ""
  echo "   B) ElevenLabs — Best quality, requires API key"
  echo "              — Free plan available at elevenlabs.io"
  echo ""
  echo "   C) OpenAI TTS — Very good quality, requires API key"
  echo "              — Requires OpenAI account"
  echo ""
  read -p "   Your choice [A/B/C]: " TTS_CHOICE
  TTS_CHOICE="${TTS_CHOICE^^}"  # uppercase

  cp "$SKILL_DIR/.env.example" "$SKILL_DIR/.env"

  case "$TTS_CHOICE" in
    A)
      echo ""
      echo "   Setting up Piper TTS..."
      # Update TTS_PROVIDER in .env
      sed -i.bak 's/^TTS_PROVIDER=.*/TTS_PROVIDER=piper/' "$SKILL_DIR/.env" && rm -f "$SKILL_DIR/.env.bak"
      # Add PIPER_VOICES_DIR pointing to bundled tools
      if ! grep -q "PIPER_VOICES_DIR" "$SKILL_DIR/.env"; then
        echo "PIPER_VOICES_DIR=./tools/piper-tts/voices" >> "$SKILL_DIR/.env"
      fi
      echo ""
      echo "   📥 Downloading Daniela voice model (~109MB)..."
      bash "$SKILL_DIR/tools/piper-tts/setup.sh" 2>&1 | grep -E "✅|⚠|❌|Downloading|Error" || true
      echo "   ✅ Piper configured"
      ;;
    B)
      echo ""
      read -p "   ElevenLabs API key (from elevenlabs.io/app/settings/api-keys): " EL_KEY
      sed -i.bak 's/^TTS_PROVIDER=.*/TTS_PROVIDER=elevenlabs/' "$SKILL_DIR/.env" && rm -f "$SKILL_DIR/.env.bak"
      sed -i.bak "s|^# ELEVENLABS_API_KEY=.*|ELEVENLABS_API_KEY=$EL_KEY|" "$SKILL_DIR/.env" && rm -f "$SKILL_DIR/.env.bak"
      sed -i.bak "s|^ELEVENLABS_API_KEY=.*|ELEVENLABS_API_KEY=$EL_KEY|" "$SKILL_DIR/.env" && rm -f "$SKILL_DIR/.env.bak"
      echo "   ✅ ElevenLabs configured"
      ;;
    C)
      echo ""
      read -p "   OpenAI API key (from platform.openai.com/api-keys): " OAI_KEY
      sed -i.bak 's/^TTS_PROVIDER=.*/TTS_PROVIDER=openai/' "$SKILL_DIR/.env" && rm -f "$SKILL_DIR/.env.bak"
      sed -i.bak "s|^# OPENAI_API_KEY=.*|OPENAI_API_KEY=$OAI_KEY|" "$SKILL_DIR/.env" && rm -f "$SKILL_DIR/.env.bak"
      sed -i.bak "s|^OPENAI_API_KEY=.*|OPENAI_API_KEY=$OAI_KEY|" "$SKILL_DIR/.env" && rm -f "$SKILL_DIR/.env.bak"
      echo "   ✅ OpenAI TTS configured"
      ;;
    *)
      echo "   Invalid choice. Copy .env.example to .env and configure manually."
      ;;
  esac
fi

# ── 5. Done ───────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════╗"
echo "║         ✅ Setup complete!               ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "  The skill is ready. When an agent activates it, it will:"
echo "  1. Ask which app to document and its URL"
echo "  2. Analyze the app and discover sections"
echo "  3. Generate flow JSONs for each section"
echo "  4. Record + narrate + assemble videos"
echo "  5. Optionally generate a React docs site"
echo ""
echo "  Manual usage:"
echo "    ./run-all.sh projects/<app>/flows/<flow>.json"
echo "    npm run analyze-app <project-name>"
echo "    npm run generate-docs <project-name>"
echo ""
echo "  TTS provider: $(grep '^TTS_PROVIDER' .env 2>/dev/null | cut -d= -f2 || echo 'check .env')"
echo ""
