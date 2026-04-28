/**
 * analyze-app.ts
 *
 * Navigates a web app with Playwright, screenshots every main section,
 * extracts interactive elements (selectors), and saves an analysis.json
 * that an agent uses to generate flow JSONs.
 *
 * Usage:
 *   npx tsx scripts/analyze-app.ts /absolute/path/to/client/.video-docs
 *   npx tsx scripts/analyze-app.ts /absolute/path/to/client/.video-docs --no-login
 *   npx tsx scripts/analyze-app.ts demo-app            ← legacy: looks in projects/demo-app/
 */

import { chromium, type Page } from 'playwright';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import type { AppAnalysis, AppSection, PageElement, ProjectConfig } from './types.js';
import { resolveProjectRoot, projectPaths } from './paths.js';

dotenv.config();

// ─── Config ──────────────────────────────────────────────────────────────────

const projectArg = process.argv[2];
const noLogin = process.argv.includes('--no-login');

if (!projectArg) {
  console.error('Usage: npx tsx scripts/analyze-app.ts <path-to-.video-docs | project-name>');
  process.exit(1);
}

const projectRoot = resolveProjectRoot(projectArg);
const paths = projectPaths(projectRoot);

if (!fs.existsSync(paths.config)) {
  console.error(`Config not found: ${paths.config}`);
  console.error(`Run init-project first or check the path.`);
  process.exit(1);
}

const config: ProjectConfig = JSON.parse(fs.readFileSync(paths.config, 'utf-8'));
const screenshotsDir = path.join(paths.analysis, 'screenshots');

fs.mkdirSync(screenshotsDir, { recursive: true });
fs.mkdirSync(paths.flows, { recursive: true });

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function screenshot(page: Page, name: string): Promise<string> {
  const absPath = path.join(screenshotsDir, `${name}.jpg`);
  await page.screenshot({ path: absPath, type: 'jpeg', quality: 85, fullPage: false });
  return absPath;
}

async function extractElements(page: Page): Promise<PageElement[]> {
  return page.evaluate(() => {
    const elements: { tag: string; type?: string; selector: string; text?: string; placeholder?: string }[] = [];
    const seen = new Set<string>();

    const addEl = (el: Element, tag: string, extra: Partial<PageElement> = {}) => {
      let selector = '';
      const id = el.getAttribute('id');
      const name = el.getAttribute('name');
      const dataTestid = el.getAttribute('data-testid');
      const type = el.getAttribute('type');
      const href = el.getAttribute('href');

      if (id) selector = `#${id}`;
      else if (dataTestid) selector = `[data-testid="${dataTestid}"]`;
      else if (name) selector = `${tag}[name="${name}"]`;
      else if (type && tag === 'input') selector = `input[type="${type}"]`;
      else if (href && tag === 'a') selector = `a[href="${href}"]`;
      else return;

      if (seen.has(selector)) return;
      seen.add(selector);

      elements.push({
        tag,
        type: type || undefined,
        selector,
        text: (el.textContent || '').trim().slice(0, 60) || undefined,
        placeholder: el.getAttribute('placeholder') || undefined,
        ...extra,
      });
    };

    document.querySelectorAll('input:not([type="hidden"])').forEach(el => addEl(el, 'input'));
    document.querySelectorAll('button, [role="button"]').forEach(el => addEl(el, 'button'));
    document.querySelectorAll('a[href]').forEach(el => addEl(el, 'a'));
    document.querySelectorAll('select').forEach(el => addEl(el, 'select'));
    document.querySelectorAll('textarea').forEach(el => addEl(el, 'textarea'));

    return elements;
  });
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function findExistingFlow(sectionId: string): string | undefined {
  if (!fs.existsSync(paths.flows)) return undefined;
  const files = fs.readdirSync(paths.flows).filter(f => f.endsWith('.json') && !f.endsWith('.enriched.json'));
  const match = files.find(f => f.includes(sectionId) || slugify(f).includes(sectionId));
  return match ? path.join(paths.flows, match) : undefined;
}

// ─── Nav discovery ────────────────────────────────────────────────────────────

async function discoverNavLinks(page: Page, baseUrl: string): Promise<{ text: string; href: string }[]> {
  const links = await page.evaluate((base) => {
    const navSelectors = ['nav a', '[role="navigation"] a', 'aside a', '.sidebar a', 'header a'];
    const found: { text: string; href: string }[] = [];
    const seen = new Set<string>();

    for (const sel of navSelectors) {
      document.querySelectorAll(sel).forEach(el => {
        const href = el.getAttribute('href') || '';
        const text = (el.textContent || '').trim();
        if (!href || href.startsWith('#') || href.startsWith('javascript') || !text) return;
        const full = href.startsWith('http') ? href : base + href;
        if (seen.has(full)) return;
        seen.add(full);
        found.push({ text, href: full });
      });
    }
    return found;
  }, baseUrl);

  const origin = new URL(baseUrl).origin;
  return links.filter(l => l.href.startsWith(origin)).slice(0, 20);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🔍 Analyzing app: ${config.app_name} (${config.base_url})`);
  console.log(`   Project root: ${projectRoot}\n`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();

  const sections: AppSection[] = [];

  // ── Pre-login screenshot ──────────────────────────────────────────────────
  try {
    console.log('📸 Screenshot: pre-login state');
    await page.goto(config.base_url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(1500);

    const loginScreenshot = await screenshot(page, '00-login');
    const loginElements = await extractElements(page);

    sections.push({
      id: 'login',
      title: 'Login / Acceso',
      url: page.url(),
      screenshot: loginScreenshot,
      elements: loginElements,
      existing_flow: findExistingFlow('login'),
    });

    console.log(`  ✓ Captured ${loginElements.length} interactive elements`);
  } catch (e) {
    console.warn('  ⚠ Could not capture login page:', (e as Error).message);
  }

  // ── Login if credentials available ────────────────────────────────────────
  if (!noLogin && config.setup_login) {
    try {
      console.log('\n🔐 Logging in...');

      const emailSelectors = ['input[name="email"]', '#email', 'input[type="email"]', 'input[placeholder*="email" i]'];
      const passSelectors = ['input[name="password"]', '#password', 'input[type="password"]'];
      const submitSelectors = ['button[type="submit"]', 'button:text("Log in")', 'button:text("Login")', 'button:text("Sign in")', 'button:text("Iniciar sesión")'];

      let loggedIn = false;
      for (const emailSel of emailSelectors) {
        try {
          await page.fill(emailSel, config.setup_login.email, { timeout: 3000 });
          for (const passSel of passSelectors) {
            try {
              await page.fill(passSel, config.setup_login.password, { timeout: 2000 });
              for (const submitSel of submitSelectors) {
                try {
                  await page.click(submitSel, { timeout: 2000 });
                  await page.waitForTimeout(3000);
                  loggedIn = true;
                  break;
                } catch { /* try next */ }
              }
              if (loggedIn) break;
            } catch { /* try next */ }
          }
          if (loggedIn) break;
        } catch { /* try next */ }
      }

      if (loggedIn) {
        console.log('  ✓ Logged in, current URL:', page.url());
      } else {
        console.warn('  ⚠ Could not auto-login. Run with --no-login to skip.');
      }
    } catch (e) {
      console.warn('  ⚠ Login failed:', (e as Error).message);
    }
  }

  // ── Discover navigation sections ──────────────────────────────────────────
  const currentUrl = page.url();
  const isAuthenticated = !currentUrl.includes('/login') && !currentUrl.includes('/register');

  if (isAuthenticated) {
    console.log('\n🗺  Discovering navigation sections...\n');
    const navLinks = await discoverNavLinks(page, config.base_url);
    console.log(`  Found ${navLinks.length} nav links\n`);

    for (let i = 0; i < navLinks.length; i++) {
      const link = navLinks[i];
      const id = slugify(link.text) || `section-${i + 1}`;
      const num = String(i + 1).padStart(2, '0');

      try {
        console.log(`📸 [${num}/${navLinks.length}] ${link.text} → ${link.href}`);
        await page.goto(link.href, { waitUntil: 'domcontentloaded', timeout: 12000 });
        await page.waitForTimeout(1500);

        const shot = await screenshot(page, `${num}-${id}`);
        const elements = await extractElements(page);

        sections.push({
          id,
          title: link.text,
          url: link.href,
          screenshot: shot,
          elements,
          existing_flow: findExistingFlow(id),
        });

        console.log(`  ✓ ${elements.length} elements captured`);
      } catch (e) {
        console.warn(`  ⚠ Skipped (${(e as Error).message})`);
      }
    }
  }

  await browser.close();

  // ── Write analysis.json ────────────────────────────────────────────────────
  const analysis: AppAnalysis = {
    app_name: config.app_name,
    base_url: config.base_url,
    analyzed_at: new Date().toISOString(),
    sections,
  };

  const outputPath = path.join(paths.analysis, 'sections.json');
  fs.writeFileSync(outputPath, JSON.stringify(analysis, null, 2));

  console.log(`\n✅ Analysis complete!`);
  console.log(`   ${sections.length} sections found`);
  console.log(`   Saved: ${outputPath}`);
  console.log(`   Screenshots: ${screenshotsDir}/\n`);

  // ── Print summary for agent ────────────────────────────────────────────────
  console.log('─────────────────────────────────────────────');
  console.log(`SECTIONS FOUND IN "${config.app_name}":`);
  sections.forEach((s, i) => {
    const letter = String.fromCharCode(65 + i);
    const flowNote = s.existing_flow ? ` [flow: ${s.existing_flow}]` : ' [sin flow]';
    console.log(`  ${letter}) ${s.title} — ${s.url}${flowNote}`);
  });
  console.log('─────────────────────────────────────────────\n');
}

main().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
