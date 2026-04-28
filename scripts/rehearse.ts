/**
 * rehearse.ts — Dry-run a flow without recording video or generating audio.
 *
 * Validates that every step's selector exists and every navigation lands
 * where expected. Functional waits (wait_for, wait_for_url, wait_ms) are
 * respected. Narration pauses (action_ms) are collapsed to 200ms so the
 * whole flow runs in seconds.
 *
 * Continues past failures so all broken steps are reported at once.
 *
 * Usage:
 *   npx tsx scripts/rehearse.ts /abs/path/client/.video-docs/flows/<flow>.json
 *   npx tsx scripts/rehearse.ts /abs/path/client/.video-docs/flows/es/<flow>.json
 */

import { chromium, type Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { Flow, FlowStep, SetupStep, ProjectConfig } from './types.js';
import { projectRootFromFlow, detectLangFromFlow, projectPaths } from './paths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Step executor (same logic as generate-video, no timing) ──────────────────

async function executeStep(
  page: Page,
  step: FlowStep | SetupStep,
  variables: Record<string, string>,
  config: ProjectConfig,
): Promise<void> {
  const resolve = (val: string) => val.replace(/\$\{(\w+)\}/g, (_, k) => variables[k] ?? `\${${k}}`);
  const locator = (sel: string, nth?: number) =>
    nth !== undefined ? page.locator(sel).nth(nth) : page.locator(sel).first();

  switch (step.action) {
    case 'navigate': {
      const url = resolve(step.value!);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      break;
    }
    case 'fill': {
      const s = step as FlowStep;
      await locator(step.selector!, s.nth).waitFor({ timeout: 8000 });
      await locator(step.selector!, s.nth).fill(resolve(step.value!));
      break;
    }
    case 'type': {
      const s = step as FlowStep;
      await locator(step.selector!, s.nth).waitFor({ timeout: 8000 });
      await locator(step.selector!, s.nth).click();
      await page.keyboard.type(resolve(step.value!), { delay: 50 }); // faster than real recording
      break;
    }
    case 'click': {
      const s = step as FlowStep;
      await locator(step.selector!, s.nth).waitFor({ timeout: 8000 });
      await locator(step.selector!, s.nth).click();
      break;
    }
    case 'blur': {
      const s = step as FlowStep;
      await locator(step.selector!, s.nth).waitFor({ timeout: 8000 });
      await locator(step.selector!, s.nth).press('Tab');
      break;
    }
    case 'hover': {
      const s = step as FlowStep;
      await locator(step.selector!, s.nth).waitFor({ timeout: 8000 });
      await locator(step.selector!, s.nth).hover();
      break;
    }
    case 'scroll': {
      const amount = step.value === 'up' ? -400 : step.value === 'down' ? 400 : parseInt(step.value ?? '400', 10);
      if (step.selector) {
        const s = step as FlowStep;
        await locator(step.selector, s.nth).waitFor({ timeout: 5000 }).catch(() => {});
        await locator(step.selector, s.nth).scrollIntoViewIfNeeded().catch(() => {});
      } else {
        await page.evaluate((y) => window.scrollBy({ top: y, behavior: 'smooth' }), amount);
      }
      break;
    }
    case 'wait_ms':
      await page.waitForTimeout(parseInt(step.value ?? '500'));
      break;
    case 'wait':
      await page.waitForTimeout(200);
      break;
    case 'otp_fill': {
      const code = resolve(step.value!);
      const sel = step.selector ?? 'input[inputmode="numeric"]';
      const inputs = page.locator(sel);
      await inputs.first().waitFor({ timeout: 8000 });
      for (let i = 0; i < code.length; i++) {
        await inputs.nth(i).fill(code[i]);
        await page.waitForTimeout(50);
      }
      break;
    }
    case 'paste': {
      const s = step as FlowStep;
      const text = resolve(step.value!);
      await locator(step.selector!, s.nth).waitFor({ timeout: 8000 });
      await locator(step.selector!, s.nth).click();
      await page.evaluate(({ sel, text }: { sel: string; text: string }) => {
        const el = document.querySelector(sel) as HTMLInputElement | null;
        if (!el) return;
        el.focus();
        const dt = new DataTransfer();
        dt.setData('text/plain', text);
        el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      }, { sel: step.selector!, text });
      break;
    }
    case 'mailpit_code': {
      // In rehearse mode, inject a fake code so dependent fill steps don't fail
      const s = step as FlowStep;
      const varName = s.value ?? 'verification_code';
      variables[varName] = '123456';
      console.log(`   ℹ️  mailpit_code → using fake code "123456" for $\{${varName}}`);
      break;
    }
    case 'screenshot':
      break;
  }
}

// ── Result types ──────────────────────────────────────────────────────────────

type StepResult = { id: string; ok: boolean; ms: number; error?: string; url?: string };

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const flowPath = process.argv[2];
  if (!flowPath) {
    console.error('Usage: npx tsx scripts/rehearse.ts <flow.json>');
    process.exit(1);
  }

  const flow = JSON.parse(fs.readFileSync(flowPath, 'utf-8')) as Flow;
  const lang = detectLangFromFlow(flowPath);
  const root = projectRootFromFlow(flowPath);
  const paths = projectPaths(root, flow.output_name, lang);
  if (!fs.existsSync(paths.config)) throw new Error(`config.json not found: ${paths.config}`);
  const config = JSON.parse(fs.readFileSync(paths.config, 'utf-8')) as ProjectConfig;

  console.log(`\n🎭 Rehearsing: "${flow.title}"`);
  console.log(`   ${flow.steps.length} steps${flow.setup?.length ? ` + ${flow.setup.length} setup` : ''}${lang ? ` [${lang}]` : ''}\n`);

  const variables: Record<string, string> = {};
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: flow.viewport });
  const page = await context.newPage();

  // ── Phase 1: Setup ──────────────────────────────────────────────────────────

  if (flow.use_setup_login) {
    const { email, password } = config.setup_login;
    process.stdout.write(`🔐 Setup login (${email})... `);
    try {
      await page.goto(`${config.base_url}/login`, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.locator('#email').fill(email);
      await page.locator('#password').fill(password);
      await page.locator('button[type=submit]').click();
      await page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 12000 });
      console.log(`✅ → ${page.url()}`);
    } catch (e) {
      console.log(`❌ ${(e as Error).message}`);
    }
  }

  if (flow.setup?.length) {
    console.log('📋 Setup steps:');
    for (const [i, step] of (flow.setup ?? []).entries()) {
      const label = `setup[${i}] ${step.action}${step.selector ? ` ${step.selector}` : ''}${step.value ? ` → ${String(step.value).slice(0, 50)}` : ''}`;
      process.stdout.write(`   ${label}... `);
      try {
        await executeStep(page, step, variables, config);
        console.log(`✅`);
      } catch (e) {
        console.log(`❌ ${(e as Error).message}`);
      }
    }
  }

  // ── Phase 2: Steps ──────────────────────────────────────────────────────────

  console.log('\n📹 Recording steps:');
  const results: StepResult[] = [];
  const totalSteps = flow.steps.length;

  for (const [stepIdx, step] of flow.steps.entries()) {
    const stepNum = stepIdx + 1;
    const pct = Math.round((stepNum / totalSteps) * 100);
    const label = `[${stepNum}/${totalSteps}] (${pct}%) [${step.id}] ${step.action}${step.selector ? ` ${step.selector}` : ''}${step.value ? ` → ${String(step.value).slice(0, 40)}` : ''}`;
    process.stdout.write(`   ${label}... `);

    const t0 = Date.now();
    let ok = true;
    let error: string | undefined;

    try {
      await executeStep(page, step, variables, config);

      if (step.wait_for_url) {
        await page.waitForURL(`**${step.wait_for_url}`, { timeout: 12000 });
      }
      if (step.wait_for) {
        await page.locator(step.wait_for).first().waitFor({ timeout: 10000 });
      }

      // Minimal pause — just enough for animations
      await page.waitForTimeout(200);
    } catch (e) {
      ok = false;
      error = (e as Error).message.split('\n')[0]; // first line only
    }

    const ms = Date.now() - t0;
    const url = page.url();
    results.push({ id: step.id, ok, ms, error, url });

    if (ok) {
      console.log(`✅ ${ms}ms → ${url.replace(config.base_url, '')}`);
    } else {
      console.log(`❌ ${error}`);
    }
  }

  await context.close();
  await browser.close();

  // ── Summary ─────────────────────────────────────────────────────────────────

  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok);
  const totalMs = results.reduce((s, r) => s + r.ms, 0);

  console.log('\n─────────────────────────────────────────────────');
  console.log(`🎭 Rehearsal complete: ${passed}/${results.length} steps passed (${(totalMs / 1000).toFixed(1)}s)`);

  if (failed.length > 0) {
    console.log(`\n❌ Failed steps (${failed.length}):`);
    for (const r of failed) {
      console.log(`   • [${r.id}] ${r.error}`);
    }
    console.log('\n⚠️  Fix these steps before running the full pipeline.');
    process.exit(1);
  } else {
    console.log('✅ All steps OK — ready to record.\n');
  }
}

main().catch((err: unknown) => { console.error(err); process.exit(1); });
