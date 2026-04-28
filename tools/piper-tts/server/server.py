"""
Piper TTS HTTP Server — runs on AMD Radeon (ROCm) or NVIDIA (CUDA) GPU server.

Endpoints:
  POST /tts      { "text": "...", "voice": "es_AR-daniela-high", "speed": 1.0 }
                 → returns audio/mpeg (MP3)
  GET  /voices   → list available voices
  GET  /health   → {"status": "ok", "device": "cuda|rocm|cpu"}

Setup (Linux server with AMD GPU):
  pip install piper-tts onnxruntime-rocm fastapi uvicorn python-multipart

Setup (Linux server with NVIDIA GPU):
  pip install piper-tts onnxruntime-gpu fastapi uvicorn python-multipart

Setup (CPU only):
  pip install piper-tts fastapi uvicorn python-multipart

Run:
  python server.py --voices-dir /path/to/voices --port 8090
  # With ROCm: HIP_VISIBLE_DEVICES=0 python server.py --use-gpu ...
"""
import argparse
import io
import logging
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Optional

# FastAPI
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
import uvicorn

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
log = logging.getLogger(__name__)

app = FastAPI(title="Piper TTS Server", version="1.0.0")

# ── Config ────────────────────────────────────────────────────────────────
VOICES_DIR: Path = Path("voices")
USE_CUDA: bool = False
DEFAULT_VOICE: str = "es_AR-daniela-high"

# Voice cache: voice_name → PiperVoice instance
_voice_cache: dict = {}


def load_voice(voice_name: str):
    """Load (or return cached) PiperVoice instance."""
    if voice_name in _voice_cache:
        return _voice_cache[voice_name]

    model_path = VOICES_DIR / f"{voice_name}.onnx"
    if not model_path.exists():
        raise FileNotFoundError(f"Voice model not found: {model_path}")

    try:
        from piper.voice import PiperVoice
        voice = PiperVoice.load(str(model_path), use_cuda=USE_CUDA)
        _voice_cache[voice_name] = voice
        log.info(f"Loaded voice: {voice_name} (cuda={USE_CUDA})")
        return voice
    except Exception as e:
        raise RuntimeError(f"Failed to load voice {voice_name}: {e}") from e


def wav_to_mp3(wav_bytes: bytes) -> bytes:
    """Convert WAV bytes to MP3 bytes via ffmpeg."""
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        f.write(wav_bytes)
        wav_path = f.name

    mp3_path = wav_path.replace(".wav", ".mp3")
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-i", wav_path, "-codec:a", "libmp3lame", "-b:a", "128k", mp3_path],
            check=True, capture_output=True
        )
        with open(mp3_path, "rb") as f:
            return f.read()
    finally:
        os.unlink(wav_path)
        if os.path.exists(mp3_path):
            os.unlink(mp3_path)


# ── Request model ─────────────────────────────────────────────────────────
class TTSRequest(BaseModel):
    text: str
    voice: str = DEFAULT_VOICE
    speed: float = 1.0


# ── Endpoints ─────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    device = "cpu"
    if USE_CUDA:
        try:
            import onnxruntime as ort
            providers = ort.get_available_providers()
            if "ROCMExecutionProvider" in providers:
                device = "rocm"
            elif "CUDAExecutionProvider" in providers:
                device = "cuda"
        except Exception:
            pass
    return {"status": "ok", "device": device, "voices_dir": str(VOICES_DIR)}


@app.get("/voices")
def list_voices():
    voices = [p.stem for p in VOICES_DIR.glob("*.onnx")]
    return {"voices": voices, "default": DEFAULT_VOICE}


@app.post("/tts")
async def synthesize(req: TTSRequest):
    if not req.text.strip():
        raise HTTPException(400, "text cannot be empty")

    try:
        voice = load_voice(req.voice)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    except RuntimeError as e:
        raise HTTPException(500, str(e))

    # length_scale: 1/speed (higher = slower)
    length_scale = 1.0 / max(0.5, min(2.0, req.speed))

    # Synthesize to WAV in memory
    wav_io = io.BytesIO()
    import wave
    with wave.open(wav_io, "wb") as wf:
        voice.synthesize(
            req.text,
            wf,
            length_scale=length_scale,
        )
    wav_bytes = wav_io.getvalue()

    # Convert to MP3
    try:
        mp3_bytes = wav_to_mp3(wav_bytes)
    except Exception as e:
        raise HTTPException(500, f"WAV→MP3 conversion failed: {e}")

    log.info(f"Synthesized {len(req.text)} chars → {len(mp3_bytes)/1024:.0f}KB MP3 [{req.voice}]")
    return Response(content=mp3_bytes, media_type="audio/mpeg")


# ── Main ──────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Piper TTS HTTP Server")
    parser.add_argument("--voices-dir", default="voices", help="Directory with .onnx voice models")
    parser.add_argument("--port", type=int, default=8090)
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--use-gpu", action="store_true", help="Enable GPU (ROCm/CUDA) inference")
    parser.add_argument("--preload-voice", default=DEFAULT_VOICE, help="Preload this voice on startup")
    args = parser.parse_args()

    VOICES_DIR = Path(args.voices_dir).resolve()
    USE_CUDA = args.use_gpu

    if not VOICES_DIR.exists():
        log.error(f"Voices directory not found: {VOICES_DIR}")
        sys.exit(1)

    log.info(f"Voices dir: {VOICES_DIR}")
    log.info(f"GPU: {'enabled' if USE_CUDA else 'disabled (CPU)'}")
    log.info(f"Preloading voice: {args.preload_voice}")

    # Warm up
    try:
        load_voice(args.preload_voice)
    except Exception as e:
        log.warning(f"Preload failed: {e}")

    log.info(f"Server starting on {args.host}:{args.port}")
    uvicorn.run(app, host=args.host, port=args.port)
