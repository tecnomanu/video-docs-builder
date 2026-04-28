/**
 * Assembles the final video by overlaying all narration audio tracks
 * onto the recorded Playwright video at their correct timestamps.
 *
 * Uses FFmpeg filter_complex with adelay to position each audio track.
 *
 * Usage: tsx src/assemble.ts projects/demo-app/flows/06-feature-demo.enriched.json
 */
import { execSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { Flow, FlowStep } from './types.js';
import { projectRootFromFlow, detectLangFromFlow, projectPaths } from './paths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function checkFFmpeg(): void {
  const result = spawnSync('ffmpeg', ['-version'], { encoding: 'utf-8' });
  if (result.error) {
    console.error('❌ ffmpeg not found. Install with: brew install ffmpeg');
    process.exit(1);
  }
}

function buildFilterComplex(audioSteps: FlowStep[]): { inputs: string[]; filter: string } {
  const inputs: string[] = [];
  const labels: string[] = [];

  audioSteps.forEach((step, i) => {
    const delayMs = step.audio_start_ms ?? 0;
    inputs.push(`-i "${step.audio_file!}"`);
    labels.push(`[${i + 1}:a]adelay=${delayMs}|${delayMs}[a${i}]`);
  });

  const mixInputs = audioSteps.map((_, i) => `[a${i}]`).join('');
  const mix = `${mixInputs}amix=inputs=${audioSteps.length}:duration=longest:normalize=0[aout]`;

  const filter = [...labels, mix].join('; ');
  return { inputs, filter };
}

async function main(): Promise<void> {
  const enrichedFlowPath = process.argv[2];
  if (!enrichedFlowPath) {
    console.error('Usage: tsx src/assemble.ts <flow.enriched.json>');
    process.exit(1);
  }

  checkFFmpeg();

  const flow = JSON.parse(fs.readFileSync(enrichedFlowPath, 'utf-8')) as Flow;
  const lang = detectLangFromFlow(enrichedFlowPath);
  const root = projectRootFromFlow(enrichedFlowPath);
  const paths = projectPaths(root, flow.output_name, lang);
  const finalDir = paths.final!;
  fs.mkdirSync(finalDir, { recursive: true });

  const videoPath = path.join(paths.raw!, `${flow.output_name}.webm`);
  if (!fs.existsSync(videoPath)) {
    const rawDir = paths.raw!;
    const webms = fs.readdirSync(rawDir).filter(f => f.endsWith('.webm'));
    if (webms.length === 0) {
      console.error(`❌ No video found in ${rawDir}. Run generate-video first.`);
      process.exit(1);
    }
    // Use most recent
    webms.sort();
    const found = path.join(rawDir, webms[webms.length - 1]);
    fs.renameSync(found, videoPath);
    console.log(`   Renamed ${found} → ${videoPath}`);
  }

  const audioSteps = flow.steps.filter(s => s.audio_file && s.audio_duration_ms);

  if (audioSteps.length === 0) {
    console.error('❌ No audio steps found. Run generate-audio first.');
    process.exit(1);
  }

  const finalPath = path.join(finalDir, `${flow.output_name}.mp4`);
  const trimMs = flow.trim_start_ms ?? 0;
  const trimSec = trimMs / 1000;

  console.log(`🎞  Assembling: "${flow.title}"`);
  console.log(`   Video: ${videoPath}`);
  console.log(`   Audio tracks: ${audioSteps.length}`);
  if (trimMs > 0) console.log(`   ✂️  Trimming first ${trimSec.toFixed(1)}s (login section)`);
  console.log(`   Output: ${finalPath}`);

  // audio_start_ms is measured from Phase 2 start (after setup), so it's already
  // relative to the trimmed video. No adjustment needed — -ss handles the trim.
  const { inputs, filter } = buildFilterComplex(audioSteps);

  const audioInputsStr = inputs.join(' ');
  const cmd = [
    'ffmpeg -y',
    trimMs > 0 ? `-ss ${trimSec.toFixed(3)}` : '',
    `-i "${videoPath}"`,
    audioInputsStr,
    `-filter_complex "${filter}"`,
    '-map 0:v',
    '-map "[aout]"',
    '-c:v libx264 -preset fast -crf 23',
    '-c:a aac -b:a 128k',
    '-shortest',
    `"${finalPath}"`,
  ].join(' ');

  console.log(`\n   Running FFmpeg...`);
  execSync(cmd, { stdio: 'inherit' });

  const stats = fs.statSync(finalPath);
  const sizeMb = (stats.size / 1024 / 1024).toFixed(1);

  console.log(`\n✅ Final video: ${finalPath} (${sizeMb} MB)`);

  // Also output a thumbnail
  const thumbPath = path.join(finalDir, `${flow.output_name}-thumb.jpg`);
  try {
    execSync(
      `ffmpeg -y -i "${finalPath}" -ss 00:00:05 -vframes 1 -q:v 2 "${thumbPath}"`,
      { stdio: 'pipe' }
    );
    console.log(`   Thumbnail: ${thumbPath}`);
  } catch {
    // Non-critical
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
