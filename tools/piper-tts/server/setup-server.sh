#!/usr/bin/env bash
# ============================================================
# setup-server.sh — Instala el servidor Piper TTS en Linux
# Para servidor AMD Radeon (ROCm) o CPU
#
# Uso:
#   ./setup-server.sh          # CPU
#   ./setup-server.sh --rocm   # AMD GPU (ROCm)
#   ./setup-server.sh --cuda   # NVIDIA GPU
# ============================================================
set -e

USE_ROCM=false
USE_CUDA=false

for arg in "$@"; do
  [[ "$arg" == "--rocm" ]] && USE_ROCM=true
  [[ "$arg" == "--cuda" ]] && USE_CUDA=true
done

echo "=== Piper TTS Server Setup ==="
echo "GPU: ${USE_ROCM:+AMD ROCm}${USE_CUDA:+NVIDIA CUDA}$([ "$USE_ROCM" = false ] && [ "$USE_CUDA" = false ] && echo 'CPU')"

# Install base dependencies
pip install piper-tts fastapi "uvicorn[standard]" python-multipart

# GPU-specific ONNX Runtime
if [ "$USE_ROCM" = "true" ]; then
  echo ""
  echo "Installing onnxruntime-rocm..."
  # ROCm 6.x: pip install onnxruntime-rocm
  # Find the right wheel for your ROCm version at:
  # https://download.onnxruntime.ai/
  ROCM_VERSION=$(rocm-smi --version 2>/dev/null | grep -oP '\d+\.\d+' | head -1 || echo "6.0")
  echo "Detected ROCm version: $ROCM_VERSION"
  pip install onnxruntime-rocm || {
    echo "⚠️  onnxruntime-rocm not available via pip."
    echo "   Manual install: https://download.onnxruntime.ai/"
    echo "   Example: pip install https://download.onnxruntime.ai/onnxruntime_rocm614-1.18.1-cp310-cp310-linux_x86_64.whl"
  }
elif [ "$USE_CUDA" = "true" ]; then
  echo ""
  echo "Installing onnxruntime-gpu..."
  pip install onnxruntime-gpu
fi

# Download Daniela voice if not present
VOICE_DIR="$(dirname "$0")/../voices"
mkdir -p "$VOICE_DIR"

if [ ! -f "$VOICE_DIR/es_AR-daniela-high.onnx" ]; then
  echo ""
  echo "Downloading Daniela voice (109MB)..."
  BASE="https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/es/es_AR/daniela/high"
  curl -L "${BASE}/es_AR-daniela-high.onnx" -o "$VOICE_DIR/es_AR-daniela-high.onnx"
  curl -L "${BASE}/es_AR-daniela-high.onnx.json" -o "$VOICE_DIR/es_AR-daniela-high.onnx.json"
fi

echo ""
echo "=== Setup complete ==="
echo "Run the server:"
if [ "$USE_ROCM" = "true" ]; then
  echo "  HIP_VISIBLE_DEVICES=0 python server.py --voices-dir ../voices --use-gpu"
elif [ "$USE_CUDA" = "true" ]; then
  echo "  CUDA_VISIBLE_DEVICES=0 python server.py --voices-dir ../voices --use-gpu"
else
  echo "  python server.py --voices-dir ../voices --port 8090"
fi
