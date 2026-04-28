/**
 * adjust-timing.ts — Edit audio_start_ms in enriched.json without re-recording.
 *
 * Usage:
 *   npx tsx src/adjust-timing.ts <enriched.json> [options]
 *
 * Options:
 *   --show                     Print current timing table (default if no other flags)
 *   --global-offset <ms>       Shift ALL audio tracks by N ms (+/-)
 *   --step <id>:<ms>           Set audio_start_ms for a specific step
 *   --step-offset <id>:<ms>    Shift audio_start_ms of a specific step by N ms
 *   --reassemble               After editing, re-run assemble.ts
 *
 * Examples:
 *   # Show current timings
 *   npx tsx src/adjust-timing.ts projects/demo-app/flows/01-feature-demo.enriched.json --show
 *
 *   # Delay all audio by 800ms (useful when video loads slower than expected)
 *   npx tsx src/adjust-timing.ts ... --global-offset 800
 *
 *   # Fix just the first step (audio was 1s too early)
 *   npx tsx src/adjust-timing.ts ... --step-offset open_register:1000
 *
 *   # Manually set exact position for a step
 *   npx tsx src/adjust-timing.ts ... --step fill_name:9500
 *
 *   # Edit and immediately re-assemble
 *   npx tsx src/adjust-timing.ts ... --global-offset 500 --reassemble
 */
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import type { Flow, FlowStep } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function printTimingTable(flow: Flow): void {
  console.log(`\n📊 Timing table: "${flow.title}"`);
  if (flow.trim_start_ms) {
    console.log(`   ✂️  trim_start_ms: ${flow.trim_start_ms}ms (login trimmed)`);
  }
  console.log();
  console.log('  Step                   | audio_start_ms | duration | audio_end_ms | gap_before');
  console.log('  ─────────────────────────────────────────────────────────────────────────────');

  let prevEnd = 0;
  for (const step of flow.steps) {
    if (!step.narration) {
      console.log(`  ${step.id.padEnd(22)} | (no narration)`);
      continue;
    }
    const start = step.audio_start_ms ?? 0;
    const dur = step.audio_duration_ms ?? 0;
    const end = start + dur;
    const gap = start - prevEnd;
    const gapStr = gap < 0 ? `⚠️  OVERLAP ${gap}ms` : `+${gap}ms`;
    console.log(
      `  ${step.id.padEnd(22)} | ${String(start).padStart(14)} | ${String(dur).padStart(8)} | ${String(end).padStart(12)} | ${gapStr}`
    );
    prevEnd = end;
  }
  console.log();
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const enrichedPath = args[0];

  if (!enrichedPath || enrichedPath.startsWith('--')) {
    console.error('Usage: npx tsx src/adjust-timing.ts <enriched.json> [options]');
    console.error('       npx tsx src/adjust-timing.ts <enriched.json> --show');
    process.exit(1);
  }

  if (!fs.existsSync(enrichedPath)) {
    console.error(`File not found: ${enrichedPath}`);
    process.exit(1);
  }

  const flow = JSON.parse(fs.readFileSync(enrichedPath, 'utf-8')) as Flow;
  const showOnly = args.includes('--show') || args.length === 1;

  if (showOnly) {
    printTimingTable(flow);
    return;
  }

  let changed = false;

  // --global-offset <ms>
  const globalIdx = args.indexOf('--global-offset');
  if (globalIdx !== -1) {
    const offset = parseInt(args[globalIdx + 1] ?? '0', 10);
    console.log(`\n🔧 Global offset: ${offset > 0 ? '+' : ''}${offset}ms`);
    for (const step of flow.steps) {
      if (step.audio_start_ms !== undefined) {
        const oldVal = step.audio_start_ms;
        step.audio_start_ms = Math.max(0, step.audio_start_ms + offset);
        console.log(`   ${step.id}: ${oldVal} → ${step.audio_start_ms}`);
      }
    }
    changed = true;
  }

  // --step <id>:<ms>  (absolute)
  const stepArgs = args.filter((a, i) => args[i - 1] === '--step');
  for (const val of stepArgs) {
    const [id, msStr] = val.split(':');
    const ms = parseInt(msStr ?? '0', 10);
    const step = flow.steps.find((s: FlowStep) => s.id === id);
    if (!step) { console.warn(`   ⚠️  Step not found: ${id}`); continue; }
    console.log(`\n🔧 Set ${id}: ${step.audio_start_ms} → ${ms}`);
    step.audio_start_ms = ms;
    changed = true;
  }

  // --step-offset <id>:<ms>  (relative)
  const stepOffsetArgs = args.filter((a, i) => args[i - 1] === '--step-offset');
  for (const val of stepOffsetArgs) {
    const [id, msStr] = val.split(':');
    const offset = parseInt(msStr ?? '0', 10);
    const step = flow.steps.find((s: FlowStep) => s.id === id);
    if (!step) { console.warn(`   ⚠️  Step not found: ${id}`); continue; }
    const oldVal = step.audio_start_ms ?? 0;
    step.audio_start_ms = Math.max(0, oldVal + offset);
    console.log(`\n🔧 Offset ${id}: ${oldVal} + ${offset} → ${step.audio_start_ms}`);
    changed = true;
  }

  if (!changed) {
    printTimingTable(flow);
    console.log('No changes made. Use --show to inspect, or --global-offset / --step / --step-offset to edit.');
    return;
  }

  // Save
  fs.writeFileSync(enrichedPath, JSON.stringify(flow, null, 2));
  console.log(`\n✅ Saved: ${enrichedPath}`);
  printTimingTable(flow);

  // --reassemble
  if (args.includes('--reassemble')) {
    console.log('\n🎞  Re-assembling...');
    const flowPath = enrichedPath.replace('.enriched.json', '.json');
    const cmd = `cd "${path.resolve(__dirname, '..')}" && npx tsx src/assemble.ts "${enrichedPath}"`;
    execSync(cmd, { stdio: 'inherit' });
  } else {
    console.log('\nTo re-assemble without re-recording:');
    console.log(`  cd tools/documentation-video`);
    console.log(`  npx tsx src/assemble.ts ${enrichedPath}`);
  }
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
