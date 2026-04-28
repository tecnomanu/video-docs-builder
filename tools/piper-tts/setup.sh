#!/usr/bin/env bash
# ============================================================
# setup.sh — Instala piper-tts local (macOS/Linux) + Daniela voice
# ============================================================
set -e

echo "=== Piper TTS Setup ==="

OS="$(uname -s)"
ARCH="$(uname -m)"
VOICES_DIR="$(dirname "$0")/voices"
mkdir -p "$VOICES_DIR"

# 1. Install piper Python package
echo ""
echo "1. Installing piper-tts Python package..."
pip3 install piper-tts --quiet || pip install piper-tts --quiet
echo "   ✅ piper-tts installed"

# 2. Install espeak-ng (dependency for phonemization)
echo ""
echo "2. Checking espeak-ng..."
if command -v espeak-ng &>/dev/null; then
  echo "   ✅ espeak-ng already installed"
elif [ "$OS" = "Darwin" ]; then
  brew install espeak-ng
  echo "   ✅ espeak-ng installed via homebrew"
elif command -v apt-get &>/dev/null; then
  sudo apt-get install -y espeak-ng
  echo "   ✅ espeak-ng installed via apt"
fi

# 3. Download voice model
echo ""
echo "3. Downloading Daniela voice (es_AR, 109MB)..."
BASE="https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/es/es_AR/daniela/high"

if [ ! -f "$VOICES_DIR/es_AR-daniela-high.onnx" ]; then
  curl -L --progress-bar "${BASE}/es_AR-daniela-high.onnx" -o "$VOICES_DIR/es_AR-daniela-high.onnx"
else
  echo "   ✅ Model already downloaded"
fi

if [ ! -f "$VOICES_DIR/es_AR-daniela-high.onnx.json" ]; then
  curl -sL "${BASE}/es_AR-daniela-high.onnx.json" -o "$VOICES_DIR/es_AR-daniela-high.onnx.json"
fi
echo "   ✅ Voice model ready"

# 4. Install TypeScript dependencies
echo ""
echo "4. Installing Node.js dependencies..."
npm install --quiet
echo "   ✅ npm dependencies installed"

# 5. Copy .env.example if .env doesn't exist
if [ ! -f "$(dirname "$0")/.env" ]; then
  cp "$(dirname "$0")/.env.example" "$(dirname "$0")/.env"
  echo "   ✅ Created .env from template"
fi

# 6. Test
echo ""
echo "5. Testing synthesis..."
echo "Hola, soy Daniela. Todo funcionó correctamente." | \
  python3 -m piper \
  --model "$VOICES_DIR/es_AR-daniela-high.onnx" \
  --output_file /tmp/piper-setup-test.wav 2>/dev/null

if [ -f /tmp/piper-setup-test.wav ]; then
  SIZE=$(du -h /tmp/piper-setup-test.wav | cut -f1)
  echo "   ✅ Test WAV generated ($SIZE)"
  rm /tmp/piper-setup-test.wav
fi

echo ""
echo "=== Setup complete! ==="
echo ""
echo "Usage:"
echo "  echo 'Tu texto aquí' | npx tsx src/generate.ts output.mp3"
echo "  npx tsx src/generate.ts output.mp3 'Tu texto aquí'"
echo ""
echo "As documentation-video provider:"
echo "  TTS_PROVIDER=piper in tools/documentation-video/.env"
