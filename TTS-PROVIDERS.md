# TTS Providers

Reference for configuring text-to-speech narration in video-docs-builder.

## Contents
- [Choosing a provider by language](#choosing-a-provider-by-language)
- [Piper (free, local)](#piper-free-local)
- [ElevenLabs](#elevenlabs)
- [OpenAI TTS](#openai-tts)
- [Google Gemini TTS](#google-gemini-tts)
- [Switching providers](#switching-providers)
- [Environment variables reference](#environment-variables-reference)

---

## Choosing a provider by language

| Language | Piper | ElevenLabs | OpenAI TTS | Google Gemini |
|----------|-------|------------|------------|---------------|
| Spanish (es_AR, es_ES, es_MX) | ✅ `es_AR-daniela-high` (default) | ✅ | ✅ | ✅ Kore |
| English | ✅ `en_US-lessac-high` | ✅ | ✅ | ✅ Aoede |
| Portuguese (BR) | ✅ `pt_BR-faber-high` | ✅ | ✅ | ✅ |
| French | ✅ `fr_FR-upmc-high` | ✅ | ✅ | ✅ |
| German | ✅ `de_DE-thorsten-high` | ✅ | ✅ | ✅ |
| Italian | ✅ `it_IT-riccardo-high` | ✅ | ✅ | ✅ |
| Russian | ✅ `ru_RU-ruslan-high` | ✅ | ✅ | ✅ |
| Chinese, Japanese, Arabic, etc. | ❌ (no Piper model bundled) | ✅ | ✅ | ✅ |

**If the target language has no Piper model listed:** use ElevenLabs, OpenAI, or Google Gemini — all are fully multilingual.

---

## Piper (free, local)

No API key required. Requires a downloaded `.onnx` voice model for each language.

**Setup (first time):**
```bash
bash tools/piper-tts/setup.sh
# Downloads the default voice (es_AR-daniela-high, ~109MB)
```

**For a different language**, download the model manually:
```bash
# Example: English (en_US-lessac-high)
cd tools/piper-tts/voices
wget https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/high/en_US-lessac-high.onnx
wget https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/high/en_US-lessac-high.onnx.json
```

Browse all available voices: https://huggingface.co/rhasspy/piper-voices

> **Note:** Always prefer `-high` quality models. If a `-high` variant doesn't exist for a specific voice, check the HuggingFace page and use `-medium` as fallback. Quality difference is significant.

**`.env` config:**
```env
TTS_PROVIDER=piper
PIPER_VOICE=es_AR-daniela-high     # change to match your language
PIPER_SPEED=0.95
PIPER_VOICES_DIR=./tools/piper-tts/voices
```

**Common voice model names by language:**

| Language | Voice model |
|----------|-------------|
| Spanish (AR) | `es_AR-daniela-high` |
| Spanish (ES) | `es_ES-davefx-high` |
| Spanish (MX) | `es_MX-ald-high` |
| English (US) | `en_US-lessac-high` |
| English (GB) | `en_GB-alba-high` |
| Portuguese (BR) | `pt_BR-faber-high` |
| French | `fr_FR-upmc-high` |
| German | `de_DE-thorsten-high` |
| Italian | `it_IT-riccardo-high` |
| Russian | `ru_RU-ruslan-high` |

**Remote GPU server** (for faster synthesis on AMD/NVIDIA):
```env
PIPER_SERVER_URL=http://your-server:5000
```

---

## ElevenLabs

Best naturalness. Fully multilingual — works with any language automatically. Free tier: 10k chars/month.

**Get API key:** https://elevenlabs.io → Profile → API Keys

**`.env` config:**
```env
TTS_PROVIDER=elevenlabs
ELEVENLABS_API_KEY=sk_...
ELEVENLABS_VOICE_ID=EXAVITQu4vr4xnSDxMaL   # Bella (default, multilingual)
ELEVENLABS_MODEL=eleven_multilingual_v2
```

**Find voice IDs:** use the ElevenLabs voice library or API. The `eleven_multilingual_v2` model automatically detects language from the text.

---

## OpenAI TTS

Very natural, fully multilingual. Requires paid API. Automatically detects language from text.

**`.env` config:**
```env
TTS_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_VOICE=nova          # alloy | ash | coral | echo | fable | onyx | nova | sage | shimmer
OPENAI_TTS_MODEL=tts-1-hd  # tts-1 | tts-1-hd | gpt-4o-mini-tts
OPENAI_TTS_SPEED=0.92
```

---

## Google Gemini TTS

Very natural voices. Fully multilingual. Requires a Google AI Studio API key (free tier available).

**Get API key:** https://aistudio.google.com/apikey

**`.env` config:**
```env
TTS_PROVIDER=google
GEMINI_API_KEY=AIzaSy...
GEMINI_VOICE=Kore              # see voice list below
GEMINI_TTS_MODEL=gemini-2.5-flash-preview-tts
```

**Available voices** (all work in any language):

| Voice | Character |
|-------|-----------|
| `Kore` | Warm, feminine — **recommended for Spanish** |
| `Aoede` | Warm, feminine |
| `Charon` | Masculine |
| `Puck` | Energetic, masculine |
| `Fenrir` | Deep, masculine |
| `Leda` | Clear, feminine |
| `Orus` | Neutral |

Full list (30+ voices): `Achird Algieba Alnilam Autonoe Callirrhoe Despina Enceladus Erinome Gacrux Iocaste Izar Laomedeia Meissa Mimas Mintaka Mira Murzim Nashira Navi Nereid Oberon Pulcherrima Rasalas Schedar Sulafat Umbriel Vindemiatrix Wasat Zubenelgenubi`

**Per-language voice override:**
```env
GEMINI_VOICE_ES=Kore
GEMINI_VOICE_EN=Aoede
GEMINI_VOICE_PT=Kore
```

> **Note:** Google Gemini TTS returns raw PCM audio (L16, 24kHz mono). The tool automatically converts it to MP3 via FFmpeg — no extra setup needed.

---

## Switching providers

To change the TTS provider or voice without re-recording the browser video:

```bash
# 1. Update .env (TTS_PROVIDER + voice config)
# 2. Regenerate audio only and reassemble
bash scripts/run-all.sh projects/<app>/flows/<flow>.json --skip-video
```

---

## Environment variables reference

| Variable | Provider | Default | Description |
|----------|----------|---------|-------------|
| `TTS_PROVIDER` | all | `elevenlabs` | `piper` \| `elevenlabs` \| `openai` \| `google` |
| `ELEVENLABS_API_KEY` | elevenlabs | — | API key |
| `ELEVENLABS_VOICE_ID` | elevenlabs | `EXAVITQu4vr4xnSDxMaL` | Voice ID |
| `ELEVENLABS_MODEL` | elevenlabs | `eleven_multilingual_v2` | Model |
| `OPENAI_API_KEY` | openai | — | API key |
| `OPENAI_VOICE` | openai | `nova` | Voice name |
| `OPENAI_TTS_MODEL` | openai | `tts-1-hd` | Model |
| `OPENAI_TTS_SPEED` | openai | `0.92` | Speed (0.25–4.0) |
| `PIPER_VOICE` | piper | `es_AR-daniela-high` | Voice model name |
| `PIPER_SPEED` | piper | `0.95` | Speed (higher = faster) |
| `PIPER_VOICES_DIR` | piper | `./tools/piper-tts/voices` | Path to .onnx models |
| `PIPER_SERVER_URL` | piper | — | Remote server URL (optional) |
| `PIPER_NOISE_SCALE` | piper | `0.9` | Voice variation |
| `PIPER_NOISE_W` | piper | `0.8` | Phoneme duration variation |
| `GEMINI_API_KEY` | google | — | Google AI Studio API key |
| `GEMINI_VOICE` | google | `Kore` | Voice name (Kore, Aoede, Charon, Puck…) |
| `GEMINI_TTS_MODEL` | google | `gemini-2.5-flash-preview-tts` | Gemini TTS model |
