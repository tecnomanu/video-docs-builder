/**
 * Records a browser session using Playwright with deterministic timing.
 *
 * Flow:
 *  1. Run setup[] steps (recorded but fast, no narration) — typically login
 *  2. Run each step with (action_ms + audio_duration_ms) pauses
 *
 * Features:
 *  - Visible cursor overlay: red dot follows real cursor position
 *  - trim_start_ms: stored in enriched JSON so assemble.ts can trim the login
 *
 * Usage: tsx src/generate-video.ts projects/demo-app/flows/01-feature-demo.json
 *        tsx src/generate-video.ts projects/demo-app/flows/01-feature-demo.enriched.json
 */
import { chromium, type Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { Flow, FlowStep, SetupStep, ProjectConfig } from './types.js';
import { projectRootFromFlow, detectLangFromFlow, projectPaths } from './paths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Cursor overlay injected into every page ────────────────────────────────
const CURSOR_SCRIPT = `
(function() {
  if (document.__cursorInjected) return;
  document.__cursorInjected = true;

  // Inject keyframe animation for pulse ring
  const style = document.createElement('style');
  style.textContent = \`
    @keyframes __cursor_pulse {
      0%   { transform: translate(-50%,-50%) scale(1);   opacity: 0.7; }
      70%  { transform: translate(-50%,-50%) scale(2.2); opacity: 0; }
      100% { transform: translate(-50%,-50%) scale(1);   opacity: 0; }
    }
    @keyframes __cursor_click {
      0%   { transform: translate(-50%,-50%) scale(1); }
      30%  { transform: translate(-50%,-50%) scale(0.7); }
      100% { transform: translate(-50%,-50%) scale(1); }
    }
  \`;
  document.head.appendChild(style);

  // Outer pulse ring
  const ring = document.createElement('div');
  Object.assign(ring.style, {
    position: 'fixed', top: '0px', left: '0px',
    width: '28px', height: '28px',
    border: '2.5px solid rgba(220,38,38,0.7)',
    borderRadius: '50%', pointerEvents: 'none',
    zIndex: '2147483646',
    transform: 'translate(-50%,-50%)',
    animation: '__cursor_pulse 1.4s ease-out infinite',
  });

  // Main dot
  const dot = document.createElement('div');
  Object.assign(dot.style, {
    position: 'fixed', top: '0px', left: '0px',
    width: '22px', height: '22px',
    background: 'rgba(220, 38, 38, 0.95)',
    borderRadius: '50%', pointerEvents: 'none',
    zIndex: '2147483647',
    transform: 'translate(-50%,-50%)',
    boxShadow: '0 0 0 3px white, 0 2px 8px rgba(0,0,0,0.6)',
    transition: 'left 0.06s ease-out, top 0.06s ease-out',
  });

  document.body.appendChild(ring);
  document.body.appendChild(dot);

  function moveTo(x, y) {
    dot.style.left = x + 'px'; dot.style.top = y + 'px';
    ring.style.left = x + 'px'; ring.style.top = y + 'px';
  }

  document.addEventListener('mousemove', function(e) { moveTo(e.clientX, e.clientY); });
  document.addEventListener('mousedown', function() {
    dot.style.animation = '__cursor_click 0.2s ease-out';
    setTimeout(function(){ dot.style.animation = ''; }, 220);
  });

  // Start at center
  moveTo(window.innerWidth / 2, window.innerHeight / 2);
  window.__moveCursor = moveTo;
})();
`;

// ── Mailpit: extract 6-digit verification code ─────────────────────────────
async function extractMailpitCode(mailpitUrl: string, toEmail: string): Promise<string> {
  const listUrl = `${mailpitUrl}/api/v1/messages`;
  const res = await fetch(listUrl);
  const data = await res.json() as { messages?: Array<{ ID: string; To: Array<{ Address: string }> }> };
  const messages = data.messages ?? [];

  const msg = messages.find(m => m.To.some(t => t.Address === toEmail));
  if (!msg) throw new Error(`No mailpit email found for ${toEmail}`);

  const bodyRes = await fetch(`${mailpitUrl}/api/v1/message/${msg.ID}`);
  const body = await bodyRes.json() as { Text?: string; HTML?: string };
  const text = body.Text ?? body.HTML ?? '';

  const match = text.match(/\b(\d{6})\b/);
  if (!match) throw new Error(`No 6-digit code found in email to ${toEmail}`);
  return match[1];
}

// ── Execute a single step ──────────────────────────────────────────────────
async function executeStep(page: Page, step: FlowStep | SetupStep, variables: Record<string, string>, config: ProjectConfig): Promise<void> {
  const resolve = (val: string) => val.replace(/\$\{(\w+)\}/g, (_, k) => variables[k] ?? '');

  const locator = (sel: string, nth?: number) =>
    nth !== undefined ? page.locator(sel).nth(nth) : page.locator(sel).first();

  switch (step.action) {
    case 'navigate': {
      const url = resolve(step.value!);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      console.log(`   📍 ${page.url()}`);
      break;
    }
    case 'fill': {
      const flowStep = step as FlowStep;
      await locator(step.selector!, flowStep.nth).waitFor({ timeout: 8000 });
      await locator(step.selector!, flowStep.nth).fill(resolve(step.value!));
      break;
    }
    case 'click': {
      const flowStep = step as FlowStep;
      await locator(step.selector!, flowStep.nth).waitFor({ timeout: 8000 });
      await locator(step.selector!, flowStep.nth).click();
      console.log(`   📍 ${page.url()}`);
      break;
    }
    case 'wait_ms':
      await page.waitForTimeout(parseInt(step.value ?? '1000'));
      break;
    case 'wait':
      break;
    case 'hover': {
      const flowStep = step as FlowStep;
      await locator(step.selector!, flowStep.nth).waitFor({ timeout: 8000 });
      await locator(step.selector!, flowStep.nth).hover();
      break;
    }
    case 'scroll': {
      // step.value: "down" | "up" | "<px>" (default 300px down)
      const amount = step.value === 'up' ? -400 : step.value === 'down' ? 400 : parseInt(step.value ?? '400', 10);
      if (step.selector) {
        const flowStep = step as FlowStep;
        await locator(step.selector, flowStep.nth).waitFor({ timeout: 5000 }).catch(() => {});
        await locator(step.selector, flowStep.nth).scrollIntoViewIfNeeded().catch(() => {});
      } else {
        await page.evaluate((y) => window.scrollBy({ top: y, behavior: 'smooth' }), amount);
      }
      break;
    }
    case 'mailpit_code': {
      const flowStep = step as FlowStep;
      const mailpitUrl = config.mailpit_url ?? 'http://localhost:8026';
      const email = flowStep.email ?? config.credentials.admin.email;
      console.log(`   📬 Extracting code from mailpit for ${email}...`);
      const code = await extractMailpitCode(mailpitUrl, email);
      const varName = flowStep.value ?? 'verification_code';
      variables[varName] = code;
      console.log(`   🔑 Code: ${code} → $\{${varName}}`);
      break;
    }
    case 'blur': {
      const flowStep = step as FlowStep;
      await locator(step.selector!, flowStep.nth).waitFor({ timeout: 8000 });
      await locator(step.selector!, flowStep.nth).press('Tab');
      break;
    }
    case 'type': {
      // Types character-by-character with delay — use when fill() doesn't trigger
      // input validation or masked fields that require real keyboard events.
      const flowStep = step as FlowStep;
      await locator(step.selector!, flowStep.nth).waitFor({ timeout: 8000 });
      await locator(step.selector!, flowStep.nth).click();
      await page.keyboard.type(resolve(step.value!), { delay: 200 });
      break;
    }
    case 'otp_fill': {
      // Fills a multi-input OTP component (e.g. 6 separate inputs) digit by digit.
      // Uses fill() on each nth input so React onChange fires correctly.
      const code = resolve(step.value!);
      const sel = step.selector ?? 'input[inputmode="numeric"]';
      const inputs = page.locator(sel);
      await inputs.first().waitFor({ timeout: 8000 });
      for (let i = 0; i < code.length; i++) {
        await inputs.nth(i).fill(code[i]);
        await page.waitForTimeout(150);
      }
      break;
    }
    case 'paste': {
      // Dispatches a ClipboardEvent — use for React controlled inputs that
      // listen to onPaste instead of onChange and ignore programmatic fill().
      const flowStep = step as FlowStep;
      const text = resolve(step.value!);
      await locator(step.selector!, flowStep.nth).waitFor({ timeout: 8000 });
      await locator(step.selector!, flowStep.nth).click();
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
    case 'screenshot':
      break;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const flowPath = process.argv[2];
  if (!flowPath) {
    console.error('Usage: tsx src/generate-video.ts <flow.json|flow.enriched.json>');
    process.exit(1);
  }

  const flow = JSON.parse(fs.readFileSync(flowPath, 'utf-8')) as Flow;
  const lang = detectLangFromFlow(flowPath);
  const root = projectRootFromFlow(flowPath);
  const paths = projectPaths(root, flow.output_name, lang);
  const configPath = paths.config;
  if (!fs.existsSync(configPath)) throw new Error(`config.json not found: ${configPath}`);
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as ProjectConfig;
  const rawDir = paths.raw!;
  fs.mkdirSync(rawDir, { recursive: true });

  const showCursor = flow.show_cursor !== false; // default true
  console.log(`🎬 "${flow.title}" [${flow.project ?? path.basename(path.dirname(root))}]`);
  console.log(`   Viewport: ${flow.viewport.width}x${flow.viewport.height}`);
  console.log(`   Steps: ${flow.steps.length}${flow.use_setup_login ? ' (+ auto-login)' : ''}${showCursor ? '' : ' (cursor hidden)'}`);

  const variables: Record<string, string> = {};
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });

  const context = await browser.newContext({
    viewport: flow.viewport,
    recordVideo: { dir: rawDir, size: flow.viewport },
  });
  if (showCursor) await context.addInitScript(CURSOR_SCRIPT);

  const page = await context.newPage();

  // ── Phase 1: Setup (recorded fast, no narration) ─────────────────────────
  const setupStart = Date.now();

  if (flow.use_setup_login) {
    const { email, password } = config.setup_login;
    console.log(`\n🔐 Setup: logging in as ${email}...`);
    await page.goto(`${config.base_url}/login`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.locator('#email').fill(email);
    await page.waitForTimeout(150);
    await page.locator('#password').fill(password);
    await page.waitForTimeout(150);
    await page.locator('button[type=submit]').click();
    await page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 12000 }).catch(() => {
      console.warn(`   ⚠️  Login redirect timeout, current URL: ${page.url()}`);
    });
    await page.waitForTimeout(800);
    console.log(`   ✅ Logged in → ${page.url()}`);
  }

  for (const step of flow.setup ?? []) {
    await executeStep(page, step, variables, config);
    await page.waitForTimeout(300);
  }

  const setupDurationMs = Date.now() - setupStart;
  if ((flow.use_setup_login || (flow.setup?.length ?? 0) > 0) && setupDurationMs > 500) {
    // Store trim point so assemble.ts can cut the login section
    flow.trim_start_ms = setupDurationMs;
    console.log(`   ✂️  Setup took ${(setupDurationMs / 1000).toFixed(1)}s → trim_start_ms stored`);
  }

  // ── Phase 2: Recorded tutorial steps (measure ACTUAL timing) ────────────
  // We measure real elapsed time for each step so audio_start_ms values
  // reflect the actual video timestamps, not the assumed action_ms values.
  const recordingStart = Date.now();
  // trim_start_ms is already accounted for — recording cursor starts at 0
  // (setup already happened; we measure from here)
  let actualCursor = 0; // ms elapsed inside the tutorial (after setup)
  const totalSteps = flow.steps.length;

  for (const [stepIdx, step] of flow.steps.entries()) {
    const stepNum = stepIdx + 1;
    const pct = Math.round((stepNum / totalSteps) * 100);
    console.log(`\n▶  [${stepNum}/${totalSteps}] (${pct}%) [${step.id}] ${step.action}${step.value ? ` → ${step.value.slice(0, 60)}` : ''}`);

    const stepStart = Date.now();

    await executeStep(page, step, variables, config);

    if (step.wait_for_url) {
      await page.waitForURL(`**${step.wait_for_url}`, { timeout: 12000 }).catch(() => {
        console.warn(`   ⚠️  Expected URL "${step.wait_for_url}", got: ${page.url()}`);
      });
    }
    if (step.wait_for) {
      await page.locator(step.wait_for).first().waitFor({ timeout: 10000 }).catch(() => {
        console.warn(`   ⚠️  wait_for not found: ${step.wait_for}`);
      });
    }

    await page.waitForTimeout(step.action_ms);

    // Measure actual DOM operation + action_ms wait elapsed
    const actionActualMs = Date.now() - stepStart;
    actualCursor += actionActualMs;

    // Store the measured audio_start_ms (overrides generate-audio.ts estimate)
    step.audio_start_ms = actualCursor;

    const narrationMs = (step.audio_duration_ms ?? 0) + (step.narration ? 500 : 0);
    if (narrationMs > 0) {
      console.log(`   ⏸  ${(narrationMs / 1000).toFixed(1)}s narration pause`);
      await page.waitForTimeout(narrationMs);
      actualCursor += narrationMs;
    }

    if (step.narration) {
      console.log(`   📍 audio_start_ms=${step.audio_start_ms}ms (action actual: ${actionActualMs}ms, was ${step.action_ms}ms)`);
    }

    if (step.wait_for_url) {
      console.log(`   📍 ${page.url()}`);
    }
  }

  const videoPath = await page.video()?.path();
  await context.close();
  await browser.close();

  const expectedVideo = path.join(rawDir, `${flow.output_name}.webm`);
  if (videoPath && videoPath !== expectedVideo) {
    fs.renameSync(videoPath, expectedVideo);
  }

  // Update enriched JSON with REAL measured audio_start_ms values + trim
  const enrichedPath = flowPath.endsWith('.enriched.json') ? flowPath : flowPath.replace('.json', '.enriched.json');
  if (fs.existsSync(enrichedPath)) {
    const enriched = JSON.parse(fs.readFileSync(enrichedPath, 'utf-8')) as Flow;
    if (flow.trim_start_ms) enriched.trim_start_ms = flow.trim_start_ms;
    // Sync measured audio_start_ms back to enriched steps
    for (const measured of flow.steps) {
      const target = enriched.steps.find(s => s.id === measured.id);
      if (target && measured.audio_start_ms !== undefined) {
        target.audio_start_ms = measured.audio_start_ms;
      }
    }
    fs.writeFileSync(enrichedPath, JSON.stringify(enriched, null, 2));
    console.log(`\n   ✅ Updated audio_start_ms in enriched.json (measured timings)`);
  }

  console.log(`\n✅ Video recorded: ${expectedVideo}`);
}

main().catch((err: unknown) => { console.error(err); process.exit(1); });
