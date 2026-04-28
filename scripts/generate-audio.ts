/**
 * Generates MP3 audio for each step's narration.
 *
 * Providers (set TTS_PROVIDER in .env):
 *   elevenlabs (default) — Bella voice, eleven_multilingual_v2
 *   openai               — nova voice, tts-1-hd (requires OPENAI_API_KEY)
 *   google               — Kore voice, gemini-2.5-flash-preview-tts (requires GEMINI_API_KEY)
 *   piper                — Daniela voice (es_AR), FREE, local or server
 *                          Requires: tools/piper-tts/ setup (./setup.sh)
 *                          Set PIPER_SERVER_URL for AMD/NVIDIA GPU server
 *
 * To change voice without re-recording the browser video:
 *   1. Update .env (TTS_PROVIDER + voice config)
 *   2. Run: bash scripts/run-all.sh projects/<app>/flows/<flow>.json --skip-video
 *
 * Usage: npx tsx scripts/generate-audio.ts /abs/path/.video-docs/flows/<flow>.json
 *        npx tsx scripts/generate-audio.ts /abs/path/.video-docs/flows/es/<flow>.json
 */
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import type { Flow } from './types.js';
import { projectRootFromFlow, detectLangFromFlow, projectPaths } from './paths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnv(): void {
  const envPath = path.resolve(__dirname, '../.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const match = line.match(/^([^#=\s][^=]*)=(.*)/);
    if (!match) continue;
    const key = match[1].trim();
    const raw = match[2].replace(/#.*$/, '').trim().replace(/^['"]|['"]$/g, '');
    // Don't overwrite values already set in the shell environment
    if (!process.env[key]) process.env[key] = raw;
  }
}
loadEnv();

const PROVIDER = (process.env.TTS_PROVIDER ?? 'elevenlabs').toLowerCase();

// ── Text normalization for Piper es_AR ────────────────────────────────────────
// Piper Daniela is trained on native Spanish — English loanwords get cut off
// or mispronounced. Replace them with phonetically correct Spanish equivalents
// before synthesis.
const PIPER_REPLACEMENTS: [RegExp, string][] = [
  // Tech actions
  [/\bclick\b/gi,          'clic'],
  [/\bclicks\b/gi,         'clics'],
  [/\bclickeá(?:s|n)?\b/gi,'hacé clic'],
  [/\bdrag\b/gi,           'arrastrar'],
  [/\bdrop\b/gi,           'soltar'],
  [/\bscroll\b/gi,         'desplazarse'],
  [/\bzooom?\b/gi,         'zoom'],
  // Files & UI
  [/\bthumbnail\b/gi,      'miniatura'],
  [/\bdashboard\b/gi,      'panel principal'],
  [/\bcheckbox\b/gi,       'casilla'],
  [/\bbutton\b/gi,         'botón'],
  [/\bmodal\b/gi,          'ventana emergente'],
  [/\bdialog\b/gi,         'diálogo'],
  [/\bdropdown\b/gi,       'lista desplegable'],
  [/\btoggle\b/gi,         'interruptor'],
  [/\bswitch\b/gi,         'cambiar'],
  [/\btab\b/gi,            'pestaña'],
  [/\btabs\b/gi,           'pestañas'],
  [/\bform\b/gi,           'formulario'],
  [/\bfooter\b/gi,         'pie de página'],
  [/\bheader\b/gi,         'encabezado'],
  [/\bsidebar\b/gi,        'menú lateral'],
  [/\btooltip\b/gi,        'descripción emergente'],
  [/\bnotification\b/gi,   'notificación'],
  // Internet / account
  [/\blink\b/gi,           'enlace'],
  [/\blogin\b/gi,          'inicio de sesión'],
  [/\blogout\b/gi,         'cerrar sesión'],
  [/\bsign[\s-]?in\b/gi,   'iniciar sesión'],
  [/\bsign[\s-]?up\b/gi,   'registrarse'],
  [/\bpassword\b/gi,       'contraseña'],
  [/\busername\b/gi,       'nombre de usuario'],
  [/\bprofile\b/gi,        'perfil'],
  [/\bsettings\b/gi,       'configuración'],
  [/\bdashboard\b/gi,      'panel'],
  [/\bupload\b/gi,         'subir archivo'],
  [/\bdownload\b/gi,       'descargar'],
  [/\bbackup\b/gi,         'respaldo'],
  [/\bemail\b/gi,          'correo'],
  [/\bapp\b/gi,            'aplicación'],
  [/\bweb\b/gi,            'web'],
  [/\bQR\b/g,              'código qr'],
  [/\bPDF\b/g,             'pé dé éfe'],
  [/\bExcel\b/gi,          'planilla de cálculo'],
  [/\bWhatsApp\b/gi,       'wasap'],
];

function normalizeForPiper(text: string): string {
  let out = text;
  for (const [pattern, replacement] of PIPER_REPLACEMENTS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

// ── Voice resolution per language ─────────────────────────────────────────────
function resolveVoices(lang: string | undefined) {
  const L = lang?.toUpperCase();
  return {
    elevenlabs: (L && process.env[`ELEVENLABS_VOICE_${L}_ID`]) ?? process.env.ELEVENLABS_VOICE_ID ?? 'EXAVITQu4vr4xnSDxMaL',
    openai:     (L && process.env[`OPENAI_VOICE_${L}`])        ?? process.env.OPENAI_VOICE        ?? 'nova',
    gemini:     (L && process.env[`GEMINI_VOICE_${L}`])        ?? process.env.GEMINI_VOICE        ?? 'Kore',
    piper:      (L && process.env[`PIPER_VOICE_${L}`])         ?? process.env.PIPER_VOICE         ?? 'es_AR-daniela-high',
  };
}

// ── ElevenLabs ────────────────────────────────────────────────────────────────
async function generateElevenLabs(text: string, outputPath: string, voiceId: string): Promise<void> {
  const { ElevenLabsClient } = await import('@elevenlabs/elevenlabs-js');
  const client = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY! });

  const audioStream = await client.textToSpeech.convert(
    voiceId,
    {
      text,
      model_id: process.env.ELEVENLABS_MODEL ?? 'eleven_multilingual_v2',
      output_format: 'mp3_44100_128',
    }
  );

  const chunks: Buffer[] = [];
  for await (const chunk of audioStream as unknown as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk));
  }
  fs.writeFileSync(outputPath, Buffer.concat(chunks));
}

// ── OpenAI TTS ────────────────────────────────────────────────────────────────
async function generateOpenAI(text: string, outputPath: string, voiceName: string): Promise<void> {
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

  const voice = voiceName as
    'alloy' | 'ash' | 'coral' | 'echo' | 'fable' | 'onyx' | 'nova' | 'sage' | 'shimmer';

  const response = await client.audio.speech.create({
    model: (process.env.OPENAI_TTS_MODEL ?? 'tts-1-hd') as 'tts-1' | 'tts-1-hd' | 'gpt-4o-mini-tts',
    voice,
    input: text,
    response_format: 'mp3',
    speed: parseFloat(process.env.OPENAI_TTS_SPEED ?? '0.92'),
  });

  fs.writeFileSync(outputPath, Buffer.from(await response.arrayBuffer()));
}

// ── Google Gemini TTS ─────────────────────────────────────────────────────────
async function generateGemini(text: string, outputPath: string, voiceName: string): Promise<void> {
  const { spawnSync } = await import('child_process');
  const { tmpdir } = await import('os');
  const apiKey = process.env.GEMINI_API_KEY!;
  const model = process.env.GEMINI_TTS_MODEL ?? 'gemini-2.5-flash-preview-tts';

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
        },
      }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini TTS error ${res.status}: ${err}`);
  }

  const data = await res.json() as {
    candidates: Array<{ content: { parts: Array<{ inlineData: { data: string } }> } }>;
  };
  const b64 = data.candidates[0].content.parts[0].inlineData.data;
  const pcmBuffer = Buffer.from(b64, 'base64');

  // Write PCM to temp file, then convert to MP3 with FFmpeg (L16, 24kHz, mono)
  const tmpPcm = `${tmpdir()}/gemini-${Date.now()}.pcm`;
  fs.writeFileSync(tmpPcm, pcmBuffer);

  const ff = spawnSync(
    'ffmpeg',
    ['-y', '-f', 's16le', '-ar', '24000', '-ac', '1', '-i', tmpPcm,
      '-codec:a', 'libmp3lame', '-b:a', '128k', outputPath],
    { encoding: 'utf-8', timeout: 15000 }
  );
  fs.unlinkSync(tmpPcm);
  if (ff.status !== 0) throw new Error(`PCM→MP3 failed: ${ff.stderr}`);
}

// ── Piper TTS (local or server) ───────────────────────────────────────────────
async function generatePiper(text: string, outputPath: string, voiceName: string): Promise<void> {
  const piperTool = path.resolve(__dirname, '../../../piper-tts/src/generate.ts');

  if (process.env.PIPER_SERVER_URL) {
    const res = await fetch(`${process.env.PIPER_SERVER_URL.replace(/\/$/, '')}/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        voice: voiceName,
        speed: parseFloat(process.env.PIPER_SPEED ?? '0.95'),
      }),
    });
    if (!res.ok) throw new Error(`Piper server error ${res.status}: ${await res.text()}`);
    const { writeFileSync } = await import('fs');
    writeFileSync(outputPath, Buffer.from(await res.arrayBuffer()));
    return;
  }

  // Local mode: call piper via Python + ffmpeg
  const { spawnSync } = await import('child_process');
  const { tmpdir } = await import('os');
  const tmpWav = `${tmpdir()}/piper-${Date.now()}.wav`;
  const repoRoot = path.resolve(__dirname, '..');
  const rawVoicesDir = process.env.PIPER_VOICES_DIR ?? './tools/piper-tts/voices';
  const voicesDir = path.isAbsolute(rawVoicesDir)
    ? rawVoicesDir
    : path.resolve(repoRoot, rawVoicesDir);
  const modelPath = `${voicesDir}/${voiceName}.onnx`;
  const lengthScale = String(1 / parseFloat(process.env.PIPER_SPEED ?? '0.95'));
  const noiseScale = process.env.PIPER_NOISE_SCALE ?? '0.9';
  const noiseW = process.env.PIPER_NOISE_W ?? '0.8';

  const piper = spawnSync(
    'python3', ['-m', 'piper', '--model', modelPath, '--output_file', tmpWav,
      '--length_scale', lengthScale,
      '--noise_scale', noiseScale,
      '--noise_w', noiseW,
    ],
    { input: text, encoding: 'utf-8', timeout: 30000 }
  );
  if (piper.status !== 0) throw new Error(`Piper synthesis failed: ${piper.stderr}`);

  const ff = spawnSync('ffmpeg', ['-y', '-i', tmpWav, '-codec:a', 'libmp3lame', '-b:a', '128k', outputPath],
    { encoding: 'utf-8', timeout: 15000 });
  const { unlinkSync, existsSync } = await import('fs');
  if (existsSync(tmpWav)) unlinkSync(tmpWav);
  if (ff.status !== 0) throw new Error(`WAV→MP3 failed: ${ff.stderr}`);
}

// ── Duration ──────────────────────────────────────────────────────────────────
function getAudioDurationMs(filePath: string): number {
  try {
    const out = execSync(`ffprobe -v quiet -print_format json -show_format "${filePath}"`, { encoding: 'utf-8' });
    return Math.ceil(parseFloat((JSON.parse(out) as { format: { duration: string } }).format.duration) * 1000);
  } catch {
    return 5000;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const flowPath = process.argv[2];
  if (!flowPath) { console.error('Usage: tsx src/generate-audio.ts <flow.json>'); process.exit(1); }

  if (PROVIDER === 'elevenlabs' && !process.env.ELEVENLABS_API_KEY) {
    console.error('Missing ELEVENLABS_API_KEY in .env'); process.exit(1);
  }
  if (PROVIDER === 'openai' && !process.env.OPENAI_API_KEY) {
    console.error('Missing OPENAI_API_KEY in .env (or set TTS_PROVIDER=elevenlabs)'); process.exit(1);
  }
  if (PROVIDER === 'google' && !process.env.GEMINI_API_KEY) {
    console.error('Missing GEMINI_API_KEY in .env'); process.exit(1);
  }
  if (PROVIDER === 'piper') {
    // Verify piper is available
    const { spawnSync } = await import('child_process');
    const check = spawnSync('python3', ['-c', 'import piper'], { encoding: 'utf-8' });
    if (check.status !== 0) {
      console.error('piper-tts not installed. Run: cd tools/piper-tts && ./setup.sh');
      process.exit(1);
    }
  }

  const flow = JSON.parse(fs.readFileSync(flowPath, 'utf-8')) as Flow;
  const lang = detectLangFromFlow(flowPath);
  const root = projectRootFromFlow(flowPath);
  const paths = projectPaths(root, flow.output_name, lang);
  const outputDir = paths.audio!;
  fs.mkdirSync(outputDir, { recursive: true });

  const voices = resolveVoices(lang);
  const piperServerUrl = process.env.PIPER_SERVER_URL;
  const label = PROVIDER === 'openai'
    ? `OpenAI / ${voices.openai}${lang ? ` [${lang}]` : ''}`
    : PROVIDER === 'google'
    ? `Google Gemini TTS / ${voices.gemini}${lang ? ` [${lang}]` : ''}`
    : PROVIDER === 'piper'
    ? `Piper / ${voices.piper}${lang ? ` [${lang}]` : ''} (${piperServerUrl ? `server: ${piperServerUrl}` : 'local CPU'})`
    : `ElevenLabs / ${voices.elevenlabs}${lang ? ` [${lang}]` : ''}`;

  const narrationSteps = flow.steps.filter(s => s.narration);
  console.log(`🎙  Provider: ${label} — ${narrationSteps.length} narrations to generate\n`);

  let videoCursor = 0;
  let narrationIndex = 0;

  for (const step of flow.steps) {
    videoCursor += step.action_ms;

    if (!step.narration) {
      step.audio_start_ms = videoCursor;
      continue;
    }

    narrationIndex++;
    const audioPath = path.join(outputDir, `${step.id}.mp3`);
    const pct = Math.round((narrationIndex / narrationSteps.length) * 100);
    process.stdout.write(`🎙  [${narrationIndex}/${narrationSteps.length}] (${pct}%) [${step.id}] Generating... `);

    if (PROVIDER === 'openai') {
      await generateOpenAI(step.narration, audioPath, voices.openai);
    } else if (PROVIDER === 'google') {
      await generateGemini(step.narration, audioPath, voices.gemini);
    } else if (PROVIDER === 'piper') {
      await generatePiper(normalizeForPiper(step.narration), audioPath, voices.piper);
    } else {
      await generateElevenLabs(step.narration, audioPath, voices.elevenlabs);
    }

    const durationMs = getAudioDurationMs(audioPath);
    step.audio_file = audioPath;
    step.audio_duration_ms = durationMs;
    step.audio_start_ms = videoCursor;
    videoCursor += durationMs + 500;

    console.log(`✅ ${(durationMs / 1000).toFixed(1)}s`);
  }

  const enrichedPath = flowPath.replace('.json', '.enriched.json');
  fs.writeFileSync(enrichedPath, JSON.stringify(flow, null, 2));

  console.log(`\n✅ Done. Total: ${(videoCursor / 1000).toFixed(1)}s → ${enrichedPath}`);
}

main().catch((err: unknown) => { console.error(err); process.exit(1); });
