/**
 * generate-docs-site.ts
 *
 * Generates a Vite + React documentation site from completed video flows.
 * Scans projects/<app>/output/ for final .mp4 files and matches them to flows.
 *
 * Usage:
 *   npx tsx scripts/generate-docs-site.ts <project-name> [options]
 *   npx tsx scripts/generate-docs-site.ts demo-app
 *   npx tsx scripts/generate-docs-site.ts demo-app --dev          # auto install + open browser
 *   npx tsx scripts/generate-docs-site.ts demo-app --existing /path/to/existing/docs
 *   npx tsx scripts/generate-docs-site.ts demo-app --out ./my-docs
 */

import fs from 'fs';
import path from 'path';
import { execSync, spawn } from 'child_process';
import type { Flow, DocsSiteSection, ProjectConfig } from './types.js';
import { resolveProjectRoot } from './paths.js';

// ─── Args ─────────────────────────────────────────────────────────────────────
// Usage:
//   npx tsx scripts/generate-docs-site.ts <project-name-or-path> [options]
//   npx tsx scripts/generate-docs-site.ts demo-app           (legacy)
//   npx tsx scripts/generate-docs-site.ts /client/.video-docs  (new)
//   npx tsx scripts/generate-docs-site.ts /client/.video-docs --dev

const projectArg = process.argv[2];
const existingIdx = process.argv.indexOf('--existing');
const outIdx = process.argv.indexOf('--out');
const devMode = process.argv.includes('--dev');

if (!projectArg) {
  console.error('Usage: npx tsx scripts/generate-docs-site.ts <project-name-or-path>');
  process.exit(1);
}

const existingDocsDir = existingIdx !== -1 ? process.argv[existingIdx + 1] : undefined;

// Resolve project root — works for both new (.video-docs/) and legacy (projects/<name>/)
const projectRoot = resolveProjectRoot(projectArg);

const configPath = path.join(projectRoot, 'config.json');
if (!fs.existsSync(configPath)) {
  console.error(`Config not found: ${configPath}`);
  process.exit(1);
}
const config: ProjectConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

// docs/ lives OUTSIDE output/ — at the project root level
const customOut = outIdx !== -1 ? process.argv[outIdx + 1] : undefined;
const outputDir = path.resolve(customOut ?? path.join(projectRoot, 'docs'));

// ─── Discover completed videos ────────────────────────────────────────────────

function getVideoDuration(mp4: string): number | undefined {
  try {
    const out = execSync(
      `ffprobe -v quiet -print_format json -show_format "${mp4}"`,
      { encoding: 'utf-8' }
    );
    return Math.round(parseFloat((JSON.parse(out) as { format: { duration: string } }).format.duration));
  } catch { return undefined; }
}

function discoverSections(): DocsSiteSection[] {
  const outputBase = path.join(projectRoot, 'output');
  const flowsDir   = path.join(projectRoot, 'flows');

  if (!fs.existsSync(outputBase)) { console.warn(`No output directory: ${outputBase}`); return []; }

  const sections: DocsSiteSection[] = [];
  const folders = fs.readdirSync(outputBase)
    .filter(f => f !== 'docs' && fs.statSync(path.join(outputBase, f)).isDirectory());

  for (const folder of folders) {
    const mp4   = path.join(outputBase, folder, 'final', `${folder}.mp4`);
    const thumb = path.join(outputBase, folder, 'final', `${folder}-thumb.jpg`);
    if (!fs.existsSync(mp4)) continue;

    let title       = folder;
    let category    = 'General';
    let description: string | undefined;
    let steps:       string[] | undefined;

    const flowPath     = path.join(flowsDir, `${folder}.json`);
    const enrichedPath = path.join(flowsDir, `${folder}.enriched.json`);

    // Prefer base flow JSON for metadata (category, description, steps_summary)
    // Fall back to enriched if base doesn't exist
    const metaSrc  = fs.existsSync(flowPath) ? flowPath : (fs.existsSync(enrichedPath) ? enrichedPath : undefined);
    if (metaSrc) {
      try {
        const flow: Flow = JSON.parse(fs.readFileSync(metaSrc, 'utf-8'));
        title       = flow.title || folder;
        category    = flow.category || 'General';
        description = flow.description ?? flow.steps.find(s => s.narration)?.narration?.slice(0, 180);
        steps       = flow.steps_summary;
      } catch { /* ignore */ }
    }

    sections.push({
      id: folder,
      title,
      category,
      description,
      steps,
      video_path:     path.relative(outputDir, mp4),
      thumbnail_path: fs.existsSync(thumb) ? path.relative(outputDir, thumb) : undefined,
      duration_sec:   getVideoDuration(mp4),
    });
  }

  return sections.sort((a, b) => a.id.localeCompare(b.id));
}

// ─── Generated file templates ─────────────────────────────────────────────────

function genPackageJson(): string {
  return JSON.stringify({
    name: path.basename(projectRoot) + '-docs',
    version: '1.0.0',
    private: true,
    type: 'module',
    scripts: {
      dev:     'vite',
      build:   'tsc -b && vite build',
      preview: 'vite preview',
    },
    dependencies:    { react: '^18.3.1', 'react-dom': '^18.3.1' },
    devDependencies: {
      '@types/react': '^18.3.1',
      '@types/react-dom': '^18.3.1',
      '@vitejs/plugin-react': '^4.3.1',
      typescript: '^5.5.3',
      vite: '^5.4.2',
    },
  }, null, 2);
}

function genIndexHtml(title: string): string {
  return `<!doctype html>
<html lang="es" data-theme="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title} — Docs</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;
}

function genViteConfig(): string {
  return `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], base: './' });
`;
}

function genTsConfig(): string {
  return JSON.stringify({ files: [], references: [{ path: './tsconfig.app.json' }] }, null, 2);
}

function genTsConfigApp(): string {
  return JSON.stringify({
    compilerOptions: {
      target: 'ES2020', useDefineForClassFields: true,
      lib: ['ES2020', 'DOM', 'DOM.Iterable'], module: 'ESNext',
      skipLibCheck: true, moduleResolution: 'bundler',
      allowImportingTsExtensions: true, isolatedModules: true,
      moduleDetection: 'force', noEmit: true, jsx: 'react-jsx', strict: true,
    },
    include: ['src'],
  }, null, 2);
}

function genMainTsx(): string {
  return `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
`;
}

function genSectionsTs(sections: DocsSiteSection[], appTitle: string, appDescription: string): string {
  // Preserve category order by insertion
  const categories: string[] = [];
  for (const s of sections) {
    if (!categories.includes(s.category)) categories.push(s.category);
  }

  const data = sections.map(s => ({
    id:            s.id,
    title:         s.title,
    category:      s.category,
    description:   s.description,
    steps:         s.steps,
    videoPath:     `./videos/${s.id}.mp4`,
    thumbnailPath: s.thumbnail_path ? `./videos/${s.id}-thumb.jpg` : undefined,
    durationSec:   s.duration_sec,
  }));

  return `export interface Section {
  id: string;
  title: string;
  category: string;
  description?: string;
  steps?: string[];
  videoPath: string;
  thumbnailPath?: string;
  durationSec?: number;
}

export const APP_TITLE = ${JSON.stringify(appTitle)};
export const APP_DESCRIPTION = ${JSON.stringify(appDescription)};
export const CATEGORIES: string[] = ${JSON.stringify(categories, null, 2)};
export const SECTIONS: Section[] = ${JSON.stringify(data, null, 2)};
`;
}

function genIndexCss(): string {
  return `*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg:          #0f1117;
  --surface:     #13161f;
  --card:        #1a1f2e;
  --border:      #1e2535;
  --text:        #f1f5f9;
  --muted:       #94a3b8;
  --dim:         #475569;
  --accent:      #3b82f6;
  --accent-bg:   #1e2b4a;
  --accent-text: #60a5fa;
  --green:       #22c55e;
  --green-bg:    rgba(34,197,94,.12);
  --shadow:      0 4px 24px rgba(0,0,0,.4);
}
[data-theme="light"] {
  --bg:          #f8fafc;
  --surface:     #f1f5f9;
  --card:        #ffffff;
  --border:      #e2e8f0;
  --text:        #0f172a;
  --muted:       #475569;
  --dim:         #94a3b8;
  --accent:      #2563eb;
  --accent-bg:   #eff6ff;
  --accent-text: #1d4ed8;
  --green:       #16a34a;
  --green-bg:    #dcfce7;
  --shadow:      0 4px 24px rgba(0,0,0,.08);
}
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; }
::-webkit-scrollbar { width: 5px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }

/* Header */
.header { display: flex; align-items: center; justify-content: space-between; padding: 0 40px; height: 64px; background: var(--surface); border-bottom: 1px solid var(--border); position: sticky; top: 0; z-index: 100; }
.header-left { display: flex; align-items: center; gap: 12px; cursor: pointer; user-select: none; }
.header-title { font-size: 1rem; font-weight: 700; color: var(--text); line-height: 1.2; }
.header-subtitle { font-size: 0.72rem; color: var(--dim); text-transform: uppercase; letter-spacing: .06em; }
.header-right { display: flex; align-items: center; gap: 8px; }

/* Theme toggle */
.theme-btn { background: var(--card); border: 1px solid var(--border); color: var(--muted); padding: 5px 12px; border-radius: 8px; cursor: pointer; font-size: 0.8rem; display: flex; align-items: center; gap: 5px; transition: all .15s; }
.theme-btn:hover { border-color: var(--accent); color: var(--accent-text); }

/* Home */
.home-wrap { max-width: 980px; margin: 0 auto; padding: 52px 40px; }
.home-hero { margin-bottom: 52px; }
.home-title { font-size: 2.25rem; font-weight: 800; color: var(--text); margin-bottom: 10px; }
.home-sub { font-size: 1rem; color: var(--muted); }
.home-cat { margin-bottom: 44px; }
.cat-label { font-size: 0.7rem; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: var(--dim); padding-bottom: 12px; border-bottom: 1px solid var(--border); margin-bottom: 16px; display: block; }
.cards-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
@media (max-width: 640px) { .cards-grid { grid-template-columns: 1fr; } }

/* Card */
.card { display: flex; align-items: center; gap: 16px; padding: 16px 20px; background: var(--card); border: 1px solid var(--border); border-radius: 10px; cursor: pointer; text-align: left; color: inherit; width: 100%; overflow: hidden; transition: all .15s; }
.card:hover { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
.card-icon { width: 42px; height: 42px; border-radius: 8px; background: var(--accent-bg); color: var(--accent-text); display: flex; align-items: center; justify-content: center; font-size: 1.1rem; flex-shrink: 0; }
.card-body { flex: 1; min-width: 0; }
.card-title { font-size: 0.9rem; font-weight: 600; color: var(--text); margin-bottom: 2px; }
.card-desc { font-size: 0.78rem; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px; }
.card-dur { font-size: 0.72rem; color: var(--dim); margin-top: 5px; }
.card-arrow { color: var(--dim); font-size: 1.3rem; flex-shrink: 0; }

/* Detail top bar */
.dtop { display: flex; align-items: center; justify-content: space-between; padding: 0 24px; height: 56px; background: var(--surface); border-bottom: 1px solid var(--border); position: sticky; top: 0; z-index: 100; }
.dtop-brand { display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 0.9rem; font-weight: 600; color: var(--muted); user-select: none; }
.dtop-brand:hover { color: var(--text); }

/* Layout */
.dlayout { display: flex; height: calc(100vh - 56px); }

/* Sidebar */
.sidebar { width: 260px; min-width: 260px; background: var(--surface); border-right: 1px solid var(--border); overflow-y: auto; flex-shrink: 0; }
.sb-back { display: block; padding: 14px 20px; font-size: 0.8rem; color: var(--muted); cursor: pointer; border-bottom: 1px solid var(--border); }
.sb-back:hover { color: var(--text); }
.sb-group { }
.sb-cat { width: 100%; display: flex; justify-content: space-between; align-items: center; padding: 10px 20px 6px; background: none; border: none; color: var(--dim); font-size: 0.68rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; cursor: pointer; text-align: left; }
.sb-cat:hover { color: var(--muted); }
.sb-chevron { font-size: 0.9rem; display: inline-block; transition: transform .2s; }
.sb-chevron.open { transform: rotate(90deg); }
.sb-item { display: block; width: 100%; text-align: left; padding: 8px 20px 8px 28px; background: none; border: none; border-left: 2px solid transparent; color: var(--muted); font-size: 0.85rem; cursor: pointer; transition: all .15s; line-height: 1.4; }
.sb-item:hover { color: var(--text); background: var(--card); }
.sb-item.active { color: var(--accent-text); background: var(--accent-bg); border-left-color: var(--accent); font-weight: 500; }

/* Detail main */
.dmain { flex: 1; overflow-y: auto; padding: 40px 52px 60px; }
.dmain-inner { max-width: 860px; }
.breadcrumb { font-size: 0.78rem; color: var(--dim); margin-bottom: 18px; display: flex; align-items: center; gap: 8px; }
.bc-link { cursor: pointer; }
.bc-link:hover { color: var(--muted); }
.badge { display: inline-block; padding: 3px 10px; border-radius: 20px; background: var(--green-bg); color: var(--green); font-size: 0.72rem; font-weight: 600; margin-bottom: 14px; }
.detail-h1 { font-size: 1.8rem; font-weight: 800; color: var(--text); margin-bottom: 8px; line-height: 1.2; }
.detail-desc { font-size: 0.95rem; color: var(--muted); line-height: 1.65; margin-bottom: 28px; }
.video-wrap { margin-bottom: 36px; }
.video-wrap video { width: 100%; border-radius: 10px; box-shadow: var(--shadow); display: block; }

/* Steps */
.steps { margin-bottom: 40px; }
.steps-h { font-size: 1rem; font-weight: 700; color: var(--text); margin-bottom: 16px; }
.steps-list { list-style: none; display: flex; flex-direction: column; gap: 12px; }
.step { display: flex; align-items: flex-start; gap: 14px; }
.step-n { width: 28px; height: 28px; border-radius: 50%; background: var(--accent-bg); color: var(--accent-text); display: flex; align-items: center; justify-content: center; font-size: 0.78rem; font-weight: 700; flex-shrink: 0; margin-top: 2px; }
.step-t { font-size: 0.9rem; color: var(--muted); line-height: 1.6; }

/* Nav */
.dnav { display: flex; justify-content: space-between; margin-top: 40px; padding-top: 24px; border-top: 1px solid var(--border); }
.dnav-btn { padding: 8px 16px; border-radius: 8px; background: var(--card); border: 1px solid var(--border); color: var(--muted); cursor: pointer; font-size: 0.83rem; transition: all .15s; max-width: 220px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dnav-btn:hover { border-color: var(--accent); color: var(--accent-text); }
`;
}

function genAppTsx(): string {
  return `import { useState, useEffect } from 'react';
import { APP_TITLE, APP_DESCRIPTION, SECTIONS, CATEGORIES, type Section } from './sections';

type Theme = 'dark' | 'light';

function fmt(sec?: number): string {
  if (!sec) return '';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return m + ':' + (s < 10 ? '0' : '') + s;
}

function ThemeBtn({ theme, toggle }: { theme: Theme; toggle: () => void }) {
  return (
    <button className="theme-btn" onClick={toggle}>
      {theme === 'dark' ? '☀' : '☾'} {theme === 'dark' ? 'Light' : 'Dark'}
    </button>
  );
}

function HomePage({ onSelect }: { onSelect: (id: string) => void }) {
  return (
    <main className="home-wrap">
      <div className="home-hero">
        <h1 className="home-title">Documentación {APP_TITLE}</h1>
        {APP_DESCRIPTION && <p className="home-sub">{APP_DESCRIPTION}</p>}
      </div>
      {CATEGORIES.map((cat: string) => {
        const items = SECTIONS.filter((s: Section) => s.category === cat);
        return (
          <section key={cat} className="home-cat">
            <span className="cat-label">{cat}</span>
            <div className="cards-grid">
              {items.map((s: Section) => (
                <button key={s.id} className="card" onClick={() => onSelect(s.id)}>
                  <div className="card-icon">▷</div>
                  <div className="card-body">
                    <div className="card-title">{s.title}</div>
                    {s.description && <div className="card-desc">{s.description}</div>}
                    {s.durationSec && <div className="card-dur">▷ {fmt(s.durationSec)}</div>}
                  </div>
                  <span className="card-arrow">›</span>
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </main>
  );
}

function Sidebar({ active, onSelect, onHome }: { active: string; onSelect: (id: string) => void; onHome: () => void }) {
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const r: Record<string, boolean> = {};
    CATEGORIES.forEach((c: string) => { r[c] = true; });
    return r;
  });
  return (
    <nav className="sidebar">
      <span className="sb-back" onClick={onHome}>← Documentación</span>
      {CATEGORIES.map((cat: string) => {
        const items = SECTIONS.filter((s: Section) => s.category === cat);
        const isOpen = open[cat] !== false;
        return (
          <div key={cat} className="sb-group">
            <button className="sb-cat" onClick={() => setOpen(o => ({ ...o, [cat]: !isOpen }))}>
              <span>{cat}</span>
              <span className={'sb-chevron' + (isOpen ? ' open' : '')}>›</span>
            </button>
            {isOpen && items.map((s: Section) => (
              <button
                key={s.id}
                className={'sb-item' + (active === s.id ? ' active' : '')}
                onClick={() => onSelect(s.id)}
              >
                {s.title}
              </button>
            ))}
          </div>
        );
      })}
    </nav>
  );
}

function DetailPage({ id, onBack, onSelect }: { id: string; onBack: () => void; onSelect: (id: string) => void }) {
  const section = SECTIONS.find((s: Section) => s.id === id)!;
  const peers   = SECTIONS.filter((s: Section) => s.category === section.category);
  const idx     = peers.indexOf(section);
  const prev    = peers[idx - 1];
  const next    = peers[idx + 1];
  return (
    <div className="dlayout">
      <Sidebar active={id} onSelect={onSelect} onHome={onBack} />
      <div className="dmain">
        <div className="dmain-inner">
          <nav className="breadcrumb">
            <span className="bc-link" onClick={onBack}>Documentación</span>
            <span>›</span>
            <span>{section.title}</span>
          </nav>
          <span className="badge">{section.category}</span>
          <h1 className="detail-h1">{section.title}</h1>
          {section.description && <p className="detail-desc">{section.description}</p>}
          <div className="video-wrap">
            <video key={section.videoPath} controls preload="metadata" poster={section.thumbnailPath}>
              <source src={section.videoPath} type="video/mp4" />
            </video>
          </div>
          {section.steps && section.steps.length > 0 && (
            <div className="steps">
              <h3 className="steps-h">Pasos</h3>
              <ol className="steps-list">
                {section.steps.map((t: string, i: number) => (
                  <li key={i} className="step">
                    <span className="step-n">{i + 1}</span>
                    <span className="step-t">{t}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          <div className="dnav">
            <div>{prev && <button className="dnav-btn" onClick={() => onSelect(prev.id)}>← {prev.title}</button>}</div>
            <div>{next && <button className="dnav-btn" onClick={() => onSelect(next.id)}>{next.title} →</button>}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [theme, setTheme]     = useState<Theme>(() => (localStorage.getItem('docs-theme') as Theme) ?? 'dark');
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('docs-theme', theme);
  }, [theme]);

  const toggle = () => setTheme(t => t === 'dark' ? 'light' : 'dark');

  if (activeId !== null) {
    return (
      <div>
        <div className="dtop">
          <div className="dtop-brand" onClick={() => setActiveId(null)}>{APP_TITLE}</div>
          <ThemeBtn theme={theme} toggle={toggle} />
        </div>
        <DetailPage id={activeId} onBack={() => setActiveId(null)} onSelect={setActiveId} />
      </div>
    );
  }

  return (
    <div>
      <header className="header">
        <div className="header-left" onClick={() => setActiveId(null)}>
          <div>
            <div className="header-title">{APP_TITLE}</div>
            <div className="header-subtitle">Documentación</div>
          </div>
        </div>
        <div className="header-right">
          <ThemeBtn theme={theme} toggle={toggle} />
        </div>
      </header>
      <HomePage onSelect={setActiveId} />
    </div>
  );
}
`;
}

// ─── File generation ──────────────────────────────────────────────────────────

function generateNewSite(sections: DocsSiteSection[]) {
  const title       = config.app_name;
  const description = (config as { description?: string }).description
    ?? `Step-by-step guides for ${title}`;

  console.log(`\n📁 Creating docs site at: ${outputDir}\n`);
  fs.mkdirSync(path.join(outputDir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(outputDir, 'public', 'videos'), { recursive: true });

  fs.writeFileSync(path.join(outputDir, 'package.json'),       genPackageJson());
  fs.writeFileSync(path.join(outputDir, 'index.html'),         genIndexHtml(title));
  fs.writeFileSync(path.join(outputDir, 'vite.config.ts'),     genViteConfig());
  fs.writeFileSync(path.join(outputDir, 'tsconfig.json'),      genTsConfig());
  fs.writeFileSync(path.join(outputDir, 'tsconfig.app.json'),  genTsConfigApp());
  fs.writeFileSync(path.join(outputDir, 'src/main.tsx'),       genMainTsx());
  fs.writeFileSync(path.join(outputDir, 'src/index.css'),      genIndexCss());
  fs.writeFileSync(path.join(outputDir, 'src/sections.ts'),    genSectionsTs(sections, title, description));
  fs.writeFileSync(path.join(outputDir, 'src/App.tsx'),        genAppTsx());

  console.log('  ✓ React app files written');
}

function copyVideos(sections: DocsSiteSection[], targetDir: string) {
  const videosDir  = path.join(targetDir, 'public', 'videos');
  const outputBase = path.join(projectRoot, 'output');
  fs.mkdirSync(videosDir, { recursive: true });

  for (const s of sections) {
    const src  = path.join(outputBase, s.id, 'final', `${s.id}.mp4`);
    const dst  = path.join(videosDir, `${s.id}.mp4`);
    if (fs.existsSync(src)) { fs.copyFileSync(src, dst); console.log(`  ✓ Copied: ${s.id}.mp4`); }

    const ts = path.join(outputBase, s.id, 'final', `${s.id}-thumb.jpg`);
    const td = path.join(videosDir, `${s.id}-thumb.jpg`);
    if (fs.existsSync(ts)) fs.copyFileSync(ts, td);
  }
}

function appendToExisting(sections: DocsSiteSection[], existingDir: string) {
  const sectionsFile = path.join(existingDir, 'src', 'sections.ts');
  if (!fs.existsSync(sectionsFile)) {
    console.error(`Cannot append: sections.ts not found in ${existingDir}`); process.exit(1);
  }
  const existing    = fs.readFileSync(sectionsFile, 'utf-8');
  const existingIds = [...existing.matchAll(/id:\s*["']([^"']+)["']/g)].map(m => m[1]);
  const newSections = sections.filter(s => !existingIds.includes(s.id));

  if (newSections.length === 0) { console.log('  ℹ All sections already exist. Nothing to append.'); return; }

  const entries = newSections.map(s => `  {
    id:          ${JSON.stringify(s.id)},
    title:       ${JSON.stringify(s.title)},
    category:    ${JSON.stringify(s.category)},
    description: ${s.description ? JSON.stringify(s.description) : 'undefined'},
    steps:       ${s.steps ? JSON.stringify(s.steps) : 'undefined'},
    videoPath:   ${JSON.stringify(`./videos/${s.id}.mp4`)},
    thumbnailPath: ${s.thumbnail_path ? JSON.stringify(`./videos/${s.id}-thumb.jpg`) : 'undefined'},
    durationSec: ${s.duration_sec ?? 'undefined'},
  }`).join(',\n');

  const updated = existing.replace(/\];(\s*)$/, `  // Added ${new Date().toISOString().slice(0, 10)}\n${entries},\n];$1`);
  fs.writeFileSync(sectionsFile, updated);
  console.log(`  ✓ Appended ${newSections.length} section(s) to ${sectionsFile}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const sections = discoverSections();

  if (sections.length === 0) {
    console.error(`No completed videos found. Run the pipeline first:`);
    console.error(`  bash scripts/run-all.sh ${path.join(projectRoot, 'flows')}/<flow>.json`);
    process.exit(1);
  }

  console.log(`\n🎬 Found ${sections.length} completed video(s) in: ${path.join(projectRoot, 'output')}`);
  sections.forEach(s => console.log(`   • [${s.category}] ${s.id}: ${s.title}`));

  if (existingDocsDir) {
    console.log(`\n📎 Appending to existing docs: ${existingDocsDir}`);
    const target = path.resolve(existingDocsDir);
    appendToExisting(sections, target);
    copyVideos(sections, target);
  } else {
    generateNewSite(sections);
    copyVideos(sections, outputDir);
  }

  console.log('\n✅ Docs site ready!\n');

  const noOpen = process.argv.includes('--no-open');
  if (!noOpen) {
    const needsInstall = !fs.existsSync(path.join(outputDir, 'node_modules'));
    if (needsInstall) {
      console.log('📦 Installing dependencies...');
      execSync('npm install', { cwd: outputDir, stdio: 'inherit' });
    }
    console.log('\n🚀 Starting dev server...');
    const child = spawn('npx', ['vite', '--open'], {
      cwd: outputDir,
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    console.log('   → http://localhost:5173/\n');
  } else {
    console.log('🚀 To run manually:');
    console.log(`   cd ${outputDir}`);
    console.log('   npm install && npm run dev\n');
  }
}

main().catch(e => { console.error('Error:', e); process.exit(1); });
