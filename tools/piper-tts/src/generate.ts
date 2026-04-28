/**
 * Piper TTS generator — local inference or remote HTTP server.
 *
 * Modes:
 *   LOCAL  (default): calls `python3 -m piper` with the local voice model
 *   SERVER: POSTs to PIPER_SERVER_URL (for AMD/NVIDIA GPU server)
 *
 * Usage:
 *   echo "Texto a sintetizar" | npx tsx src/generate.ts output.mp3
 *   npx tsx src/generate.ts output.mp3 "Texto a sintetizar"
 *
 * As library:
 *   import { generatePiper } from './generate.js'
 *   await generatePiper("Hola mundo", "output.mp3")
 */
import { execSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function loadEnv(): void {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}
loadEnv();

const VOICE_DIR    = path.join(ROOT, 'voices');
const VOICE_NAME   = process.env.PIPER_VOICE ?? 'es_AR-daniela-high';
const SERVER_URL   = process.env.PIPER_SERVER_URL?.replace(/\/$/, '') ?? '';
const SPEED        = parseFloat(process.env.PIPER_SPEED ?? '1.0');
const NOISE_SCALE  = parseFloat(process.env.PIPER_NOISE_SCALE ?? '0.667');
const NOISE_W      = parseFloat(process.env.PIPER_NOISE_W ?? '0.8');

// ── Local synthesis via python3 -m piper ──────────────────────────────────
function synthesizeLocal(text: string, outputMp3: string): void {
  const modelPath = path.join(VOICE_DIR, `${VOICE_NAME}.onnx`);
  if (!fs.existsSync(modelPath)) {
    throw new Error(`Voice model not found: ${modelPath}\nRun: ./setup.sh`);
  }

  const tmpWav = path.join(os.tmpdir(), `piper-${Date.now()}.wav`);

  const result = spawnSync(
    'python3',
    ['-m', 'piper', '--model', modelPath, '--output_file', tmpWav,
     ...(SPEED !== 1.0 ? ['--length_scale', String(1 / SPEED)] : []),
     '--noise_scale', String(NOISE_SCALE),
     '--noise_w', String(NOISE_W),
    ],
    { input: text, encoding: 'utf-8', timeout: 30000 }
  );

  if (result.status !== 0) {
    throw new Error(`piper failed: ${result.stderr}`);
  }

  // Convert WAV → MP3
  const ffmpegResult = spawnSync('ffmpeg', [
    '-y', '-i', tmpWav, '-codec:a', 'libmp3lame', '-b:a', '128k', outputMp3,
  ], { encoding: 'utf-8', timeout: 15000 });

  fs.unlinkSync(tmpWav);

  if (ffmpegResult.status !== 0) {
    throw new Error(`ffmpeg WAV→MP3 failed: ${ffmpegResult.stderr}`);
  }
}

// ── Remote synthesis via HTTP server ──────────────────────────────────────
async function synthesizeRemote(text: string, outputMp3: string): Promise<void> {
  const res = await fetch(`${SERVER_URL}/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice: VOICE_NAME, speed: SPEED }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Piper server error ${res.status}: ${err}`);
  }

  // Server returns MP3 directly
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(outputMp3, buffer);
}

// ── Public API ────────────────────────────────────────────────────────────
export async function generatePiper(text: string, outputMp3: string): Promise<void> {
  fs.mkdirSync(path.dirname(outputMp3), { recursive: true });

  if (SERVER_URL) {
    await synthesizeRemote(text, outputMp3);
  } else {
    synthesizeLocal(text, outputMp3);
  }
}

export function getAudioDurationMs(filePath: string): number {
  try {
    const out = execSync(`ffprobe -v quiet -print_format json -show_format "${filePath}"`, { encoding: 'utf-8' });
    return Math.ceil(parseFloat((JSON.parse(out) as { format: { duration: string } }).format.duration) * 1000);
  } catch {
    return 4000;
  }
}

// ── CLI entry point ───────────────────────────────────────────────────────
async function main(): Promise<void> {
  const outputArg = process.argv[2];
  const textArg   = process.argv[3];

  if (!outputArg) {
    console.error('Usage: npx tsx src/generate.ts <output.mp3> [text]');
    console.error('       echo "text" | npx tsx src/generate.ts <output.mp3>');
    process.exit(1);
  }

  const text = textArg ?? fs.readFileSync('/dev/stdin', 'utf-8').trim();
  if (!text) { console.error('No text provided'); process.exit(1); }

  const mode = SERVER_URL ? `server (${SERVER_URL})` : `local (${VOICE_NAME})`;
  console.log(`🎤 Synthesizing with Piper [${mode}]`);
  console.log(`   Text: ${text.slice(0, 80)}${text.length > 80 ? '…' : ''}`);

  await generatePiper(text, outputArg);

  const durationMs = getAudioDurationMs(outputArg);
  const sizekb = (fs.statSync(outputArg).size / 1024).toFixed(0);
  console.log(`✅ ${outputArg} (${(durationMs / 1000).toFixed(1)}s, ${sizekb}KB)`);
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
