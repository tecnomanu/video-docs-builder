# Troubleshooting

Common errors and fixes for video-docs-builder.

## Contents
- [CSS selector not found (TimeoutError)](#css-selector-not-found-timeouterror)
- [React/Vue/SPA not rendering in headless mode](#reactvuespa-not-rendering-in-headless-mode)
- [Login fails / wrong credentials](#login-fails--wrong-credentials)
- [Audio overlapping or out of sync](#audio-overlapping-or-out-of-sync)
- [Piper model not found](#piper-model-not-found)
- [FFmpeg not found](#ffmpeg-not-found)
- [espeak conflict on macOS](#espeak-conflict-on-macos)
- [Stale enriched.json causes wrong selectors](#stale-enrichedjson-causes-wrong-selectors)

---

## CSS selector not found (TimeoutError)

**Symptom:** `TimeoutError: waiting for selector "input[name='email']" failed`

**Fixes:**
- Inspect the element in DevTools — check the actual `id`, `name`, or `placeholder`
- For React apps: prefer `id` attributes (`#email`) or `input[placeholder='...']`
- If multiple elements match: add `"nth": 0` to the step
- If element is inside a modal/drawer: add a `wait_for` on the trigger selector first

---

## React/Vue/SPA not rendering in headless mode

**Symptom:** Playwright records a blank page or only sees `<div id="app">` with no content.

**Cause:** The app is in dev mode with Vite HMR. The `public/hot` file makes Laravel/the framework load scripts from `http://localhost:5173` (the Vite dev server), which isn't running in headless mode.

**Fix:** Build for production and remove the hot file:
```bash
# Inside Docker (Laravel example):
docker compose exec laravel.test npm run build
docker compose exec laravel.test rm -f public/hot
```

For non-Docker apps:
```bash
npm run build
rm -f public/hot
```

---

## Login fails / wrong credentials

**Symptom:** `wait_for_url: "/dashboard"` times out after submitting credentials.

**Fixes:**
1. Verify credentials manually in a browser first
2. For Laravel: reset password via tinker:
   ```bash
   docker compose exec laravel.test php artisan tinker
   # >>> $u = User::where('email','admin@example.com')->first();
   # >>> $u->password = bcrypt('newpassword'); $u->save();
   ```
3. If email verification is required:
   ```bash
   # >>> $u->email_verified_at = now(); $u->save();
   ```
4. Check if the app redirects to a different URL after login (update `wait_for_url`)

---

## Audio overlapping or out of sync

**Symptom:** Narration plays while the wrong screen is visible, or two audio tracks overlap.

**Diagnose:**
```bash
npx tsx scripts/adjust-timing.ts projects/<app>/flows/<flow>.enriched.json --show
```

**Fix — global offset (push all audio forward):**
```bash
npx tsx scripts/adjust-timing.ts projects/<app>/flows/<flow>.enriched.json \
  --global-offset 800 --reassemble
```

**Fix — offset a specific step:**
```bash
npx tsx scripts/adjust-timing.ts projects/<app>/flows/<flow>.enriched.json \
  --step-offset <step-id>:+1200 --reassemble
```

**Fix — timing golden rule violation:** add a `wait` step with the narration BEFORE the action step. See [timing golden rule](SKILL.md#timing-golden-rule).

---

## Piper model not found

**Symptom:** `Error: model file not found: tools/piper-tts/voices/es_AR-daniela-high.onnx`

**Fix:**
```bash
bash tools/piper-tts/setup.sh
```

If `PIPER_VOICES_DIR` is set to a custom path, verify the `.onnx` file exists there.

---

## FFmpeg not found

**Symptom:** `Error: spawn ffmpeg ENOENT`

**Fix:**
```bash
brew install ffmpeg    # macOS
sudo apt install ffmpeg  # Ubuntu/Debian
```

---

## espeak conflict on macOS

**Symptom:** `brew install espeak-ng` fails with a conflict error.

**Fix:**
```bash
brew unlink espeak
brew install espeak-ng
```

---

## Stale enriched.json causes wrong selectors

**Symptom:** After fixing selectors in `<flow>.json`, the video still uses the old selectors.

**Cause:** `--skip-audio` reads from the existing `.enriched.json` which has the old values.

**Fix:** Delete the enriched file before re-running:
```bash
rm projects/<app>/flows/<flow>.enriched.json
bash scripts/run-all.sh projects/<app>/flows/<flow>.json --skip-audio
```
