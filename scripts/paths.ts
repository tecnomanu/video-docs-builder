/**
 * paths.ts — central path resolution for video-docs-builder.
 *
 * Projects live inside the client's own repo:
 *   /client-project/.video-docs/flows/01-login.json           ← no language
 *   /client-project/.video-docs/flows/es/01-login.json        ← Spanish
 *   /client-project/.video-docs/flows/en/01-login.json        ← English
 *   /client-project/.video-docs/output/01-login/final/...     ← no language
 *   /client-project/.video-docs/output/es/01-login/final/...  ← Spanish
 *
 * LEGACY (backward compat): inside the skill repo
 *   projects/demo-app/flows/01-login.json
 */
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

export const SKILL_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);

/** Regex for a language/locale folder name: es, en, pt, es_mx, pt_br, zh_tw, etc. */
const LANG_RE = /^[a-z]{2,3}(_[a-z]{2,4})?$/;

/**
 * Returns the language code if the flow lives under flows/<lang>/,
 * or undefined if it's directly under flows/.
 *
 * .video-docs/flows/es/01-login.json  → 'es'
 * .video-docs/flows/01-login.json     → undefined
 */
export function detectLangFromFlow(flowPath: string): string | undefined {
  const abs = path.resolve(flowPath);
  const parentDir  = path.basename(path.dirname(abs));                    // 'es' or 'flows'
  const grandparentDir = path.basename(path.dirname(path.dirname(abs)));  // 'flows' or '.video-docs'
  if (LANG_RE.test(parentDir) && grandparentDir === 'flows') return parentDir;
  return undefined;
}

/**
 * Given any flow JSON path, returns the project root (.video-docs/ or projects/<name>/).
 * Handles both language subfolders (3 levels up) and flat flows (2 levels up).
 */
export function projectRootFromFlow(flowPath: string): string {
  const abs = path.resolve(flowPath);
  const lang = detectLangFromFlow(flowPath);
  // flows/es/01.json → go 3 levels up; flows/01.json → go 2 levels up
  return lang
    ? path.dirname(path.dirname(path.dirname(abs)))
    : path.dirname(path.dirname(abs));
}

/**
 * Returns all relevant paths for a project.
 *
 * @param root      Project root (.video-docs/ or projects/<name>/)
 * @param outputName  Flow output_name (e.g. '01-login')
 * @param lang      Optional language code — scopes flows/ and output/ subdirs
 */
export function projectPaths(root: string, outputName?: string, lang?: string) {
  const outputBase = lang
    ? path.join(root, 'output', lang)
    : path.join(root, 'output');
  const output = outputName ? path.join(outputBase, outputName) : outputBase;
  return {
    root,
    config:   path.join(root, 'config.json'),
    flows:    lang ? path.join(root, 'flows', lang) : path.join(root, 'flows'),
    analysis: path.join(root, 'analysis'),
    output,
    audio:    outputName ? path.join(output, 'audio') : undefined,
    raw:      outputName ? path.join(output, 'raw')   : undefined,
    final:    outputName ? path.join(output, 'final') : undefined,
    docs:     path.join(root, 'docs'),
  };
}

/**
 * Resolves a project root from:
 *   - An absolute or relative path to a .video-docs/ directory
 *   - A short project name (legacy: looks in projects/<name> under skill root)
 */
export function resolveProjectRoot(arg: string): string {
  if (arg.startsWith('/') || arg.startsWith('.') || arg.startsWith('~') || arg.includes('/')) {
    return path.resolve(arg);
  }
  return path.join(SKILL_ROOT, 'projects', arg);
}

/** Read config.json from a project root. */
export function loadConfig(root: string) {
  const p = path.join(root, 'config.json');
  if (!fs.existsSync(p)) throw new Error(`config.json not found: ${p}`);
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}
