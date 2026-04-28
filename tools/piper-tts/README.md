# tools/piper-tts

TTS local gratuito con [Piper](https://github.com/rhasspy/piper) — voz **Daniela** (es_AR, acento argentino nativo).  
Alternativa a ElevenLabs sin quota ni costo. Funciona offline.

## Comparación con ElevenLabs

| | ElevenLabs | Piper (Daniela) |
|---|---|---|
| Costo | ~$5/mes (Starter) | **Gratis** |
| Quota | 30.000 chars/mes | **Ilimitado** |
| Latencia / clip | ~2s (API) | ~0.3s (local CPU M-series) |
| Acento | Inglés con multilingual | **Argentino nativo** |
| Internet | Requerido | **Offline** |
| Calidad | Alta | Alta (VITS neural) |

## Setup rápido (Mac M-series)

```bash
cd tools/piper-tts
./setup.sh
```

El script instala `piper-tts` vía pip, `espeak-ng` vía homebrew, y descarga el modelo Daniela (109MB).

## Uso

```bash
# Generar MP3 desde texto
echo "Welcome to the demo app" | npx tsx src/generate.ts output.mp3
npx tsx src/generate.ts output.mp3 "Welcome to the demo app"

# Test completo
npm test
```

## Integración con documentation-video

Agregar al `.env` de `tools/documentation-video/`:

```env
TTS_PROVIDER=piper
PIPER_VOICE=es_AR-daniela-high
PIPER_SPEED=0.95
```

Luego correr normalmente:

```bash
./run-all.sh projects/demo-app/flows/06-feature-walkthrough.json
# Para regenerar solo audio (cambio de voz):
./run-all.sh projects/demo-app/flows/06-feature-walkthrough.json --skip-video
```

## Servidor GPU (AMD Radeon / NVIDIA)

Para acelerar la síntesis en un servidor Linux con GPU:

```bash
# En el servidor (Linux + AMD ROCm):
cd tools/piper-tts/server
./setup-server.sh --rocm
python server.py --voices-dir ../voices --use-gpu --port 8090

# En el cliente (Mac), agregar al .env:
PIPER_SERVER_URL=http://192.168.1.100:8090
```

El servidor expone:
- `POST /tts` — `{ "text": "...", "voice": "es_AR-daniela-high", "speed": 1.0 }` → MP3
- `GET /voices` — lista voces disponibles
- `GET /health` — estado + device (cpu/rocm/cuda)

### ROCm vs CPU

Para clips cortos (~10s), el M3 Pro en CPU es ya muy rápido (~0.3s por clip). El servidor GPU aportaría más en batches grandes o voces más pesadas.

Si el servidor tiene ROCm 6.x instalado:

```bash
pip install onnxruntime-rocm
HIP_VISIBLE_DEVICES=0 python server.py --voices-dir ../voices --use-gpu
```

## Variables de entorno

| Variable | Default | Descripción |
|---|---|---|
| `PIPER_VOICE` | `es_AR-daniela-high` | Nombre del modelo (sin .onnx) |
| `PIPER_SPEED` | `0.95` | Velocidad (0.8=lento, 1.2=rápido) |
| `PIPER_SERVER_URL` | _(vacío)_ | URL servidor remoto (deja vacío para local) |

## Agregar más voces

```bash
# Voces disponibles: https://huggingface.co/rhasspy/piper-voices
# Ejemplo: voz masculina española
curl -L "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/es/es_ES/sharvard/medium/es_ES-sharvard-medium.onnx" \
  -o voices/es_ES-sharvard-medium.onnx
curl -L "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/es/es_ES/sharvard/medium/es_ES-sharvard-medium.onnx.json" \
  -o voices/es_ES-sharvard-medium.onnx.json
```

Cambiar en `.env`: `PIPER_VOICE=es_ES-sharvard-medium`
