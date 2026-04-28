---
name: video-docs-builder
description: Records and assembles documentation videos for web apps using Playwright browser automation, TTS narration, and FFmpeg. Generates a React docs site with embedded videos. Use when asked to document an app, record user flows, create tutorial videos, walkthroughs, onboarding videos, step-by-step guides, how-to videos, "make docs", "document my app", "show how to use", or "create a video guide".
---

# Video Docs Builder

Records interactive documentation videos for web apps.

**Pipeline**: Playwright (browser recording) → TTS narration → FFmpeg assembly → React docs site

**Skill root**: the directory containing this SKILL.md file. All commands run from here.

---

## Contents

- [Skill structure](#skill-structure)
- [First-time setup](#first-time-setup)
- [TTS providers](#tts-providers)
- [Narration language](#narration-language)
- [Interaction protocol](#interaction-protocol) — 8-step checklist
- [Flow JSON format](#flow-json-format)
- [Timing golden rule](#timing-golden-rule)
- [Quick command reference](#quick-command-reference)
- [Output structure](#output-structure)
- [TTS provider details → TTS-PROVIDERS.md](TTS-PROVIDERS.md)
- [Troubleshooting → TROUBLESHOOTING.md](TROUBLESHOOTING.md)

---

## Skill structure

```
video-docs-builder/
├── SKILL.md                      ← Agent instructions (this file)
├── TTS-PROVIDERS.md              ← TTS provider setup and voice options
├── TROUBLESHOOTING.md            ← Common errors and fixes
├── evaluations/                  ← Test scenarios
├── package.json
├── scripts/
│   ├── setup.sh                  ← Runs first time to install deps + configure TTS
│   ├── run-all.sh                ← Full pipeline for one flow
│   ├── gen-all-flows.sh          ← Batch pipeline for a flows directory
│   ├── analyze-app.ts            ← Playwright: discovers sections, screenshots
│   ├── generate-audio.ts         ← TTS: generates MP3 per step
│   ├── generate-video.ts         ← Playwright: records video with cursor
│   ├── assemble.ts               ← FFmpeg: assembles final MP4
│   ├── adjust-timing.ts          ← Adjust audio timing without re-recording
│   ├── generate-docs-site.ts     ← Generates React docs site from videos
│   └── types.ts                  ← Shared TypeScript types
├── tools/
│   └── piper-tts/                ← Free local TTS (language-specific voice models)
└── projects/                     ← gitignored — legacy location (still supported)
```

---

## First-time setup

**Always verify the skill is ready before starting:**

```bash
# 1. Check .env exists and TTS is configured
ls .env 2>/dev/null && grep '^TTS_PROVIDER' .env || echo "NO .env — run scripts/setup.sh"
```

If `.env` is missing or `TTS_PROVIDER` is not set → **stop and run setup**:

```bash
bash scripts/setup.sh
```

The wizard installs npm dependencies, Playwright Chromium, checks FFmpeg, and asks which TTS provider to configure:

```
Which TTS provider?
  A) Piper (free, local — included in tools/piper-tts/)
  B) ElevenLabs (best quality — API key required)
  C) OpenAI TTS (very good — API key required)
  D) Google Gemini TTS (very natural — GEMINI_API_KEY required)
```

**Do not skip this step.** Without `.env`, audio generation will fail.

### Keeping the skill up to date

The skill is installed as a git clone. Pull the latest version before starting a session:

```bash
git pull
```

---

## TTS providers

| Provider            | Quality   | Cost                   | Languages                                             |
| ------------------- | --------- | ---------------------- | ----------------------------------------------------- |
| **Piper**           | Good      | **Free**               | Language-specific voice models (see TTS-PROVIDERS.md) |
| **ElevenLabs**      | Excellent | Free tier / paid       | Multilingual — any language, no extra config          |
| **OpenAI TTS**      | Very good | Paid API               | Multilingual — any language, no extra config          |
| **Google Gemini**   | Excellent | Free tier (AI Studio)  | Multilingual — Kore voice recommended for Spanish     |

For full setup instructions, voice models by language, and environment variables → see [TTS-PROVIDERS.md](TTS-PROVIDERS.md).

---

## Narration language

Narration language is **never hardcoded** — always infer it from context:

1. **User's language** — if the user writes in Spanish, narrate in Spanish. If in English, in English. If in Russian, in Russian.
2. **App UI language** — if the app interface is in a different language than the user, ask which to use:
    ```
    The app appears to be in English but you wrote to me in Spanish.
    Which language should the narration be in?
      A) Spanish (same as our conversation)
      B) English (same as the app UI)
    ```
3. **When uncertain** — ask before writing any flow JSON.

**TTS provider compatibility:**

- **ElevenLabs / OpenAI TTS** — multilingual, work with any language automatically.
- **Piper** — requires a voice model for the specific language. Check [TTS-PROVIDERS.md](TTS-PROVIDERS.md) for available voices. If no voice exists for the target language, recommend switching to ElevenLabs or OpenAI TTS.

---

## Multi-language videos

To produce the same flows in multiple languages, place flow JSONs under language subfolders:

```
flows/
├── es/01-login.json    ← Spanish narration
├── en/01-login.json    ← English narration
└── pt/01-login.json    ← Portuguese narration
```

Language detection is **automatic** — the pipeline reads the lang code from the folder name and uses the matching voice from `.env`. Output is isolated per language under `output/<lang>/`.

### Per-language voices in `.env`

```bash
# ── Default voice (used when no language-specific voice is set) ───────────────
ELEVENLABS_VOICE_ID=EXAVITQu4vr4xnSDxMaL
OPENAI_VOICE=nova
PIPER_VOICE=es_AR-daniela-high

# ── Per-language overrides (optional — fall back to default if not set) ───────
ELEVENLABS_VOICE_ES_ID=<elevenlabs-id-for-spanish>
ELEVENLABS_VOICE_EN_ID=<elevenlabs-id-for-english>
ELEVENLABS_VOICE_PT_ID=<elevenlabs-id-for-portuguese>

OPENAI_VOICE_ES=nova
OPENAI_VOICE_EN=alloy
OPENAI_VOICE_PT=shimmer

PIPER_VOICE_ES=es_AR-daniela-high
PIPER_VOICE_EN=en_US-lessac-medium
```

**Resolution priority**: `ELEVENLABS_VOICE_{LANG}_ID` → `ELEVENLABS_VOICE_ID` (same pattern for OpenAI and Piper).

### Running multi-language flows

```bash
# Run Spanish flow
bash scripts/run-all.sh /abs/path/client/.video-docs/flows/es/01-login.json
# → output goes to .video-docs/output/es/01-login/final/

# Run English flow
bash scripts/run-all.sh /abs/path/client/.video-docs/flows/en/01-login.json
# → output goes to .video-docs/output/en/01-login/final/
```

### Multi-language workflow — primary language first

**Always complete the primary language before starting others.**

Errors in flows (wrong selectors, timing issues, narration adjustments) are caught during the first run. Fixing them in one language and then replicating to the rest is far cheaper than fixing the same issue across multiple languages in parallel.

**Protocol when the user requests multiple languages:**

1. Identify the primary language (usually the user's language or the app's main locale).
2. Complete the full pipeline for that language: flows → audio → video → assemble.
3. Show the result and ask for confirmation:

```
✅ Primary language (ES) done — 3 videos generated.

Before I continue with EN and PT, please review:
  • .video-docs/output/es/01-login/final/01-login.mp4
  • .video-docs/output/es/02-dashboard/final/02-dashboard.mp4
  • .video-docs/output/es/03-settings/final/03-settings.mp4

Does everything look good? (narration, timing, UI interactions)
  A) Yes, continue with EN and PT
  B) Fix [describe issue] first, then continue
```

4. Only proceed with the remaining languages once the client confirms.

This avoids regenerating audio and video across N languages every time a narration tweak or selector fix is needed.

---

## Project storage — where files live

Projects are stored **inside the client's own repo**, not inside the skill:

```
client-project/                    ← client's Git repository
├── .gitignore                     ← skill adds: .video-docs/output/
└── .video-docs/                   ← all video-docs files live here
    ├── README.md                  ← regeneration instructions (commit this)
    ├── config.json                ← app URL + credentials (add to .gitignore if sensitive)
    ├── flows/                     ← flow JSONs — commit these, they're small and useful
    │   ├── 01-login.json          ← no language (default)
    │   ├── es/                    ← Spanish flows (optional)
    │   │   └── 01-login.json
    │   └── en/                    ← English flows (optional)
    │       └── 01-login.json
    ├── output/                    ← gitignored — heavy generated files
    │   ├── .gitignore
    │   ├── 01-login/              ← output for default (no language) flows
    │   │   ├── audio/
    │   │   ├── raw/
    │   │   └── final/             ← 01-login.mp4
    │   ├── es/                    ← output for Spanish flows
    │   │   └── 01-login/
    │   │       └── final/         ← 01-login.mp4
    │   └── en/
    │       └── 01-login/
    │           └── final/         ← 01-login.mp4
    └── docs/                      ← React docs site — commit or ignore (your choice)
```

**Language detection is automatic** — if a flow lives under `flows/es/`, output goes to `output/es/`. No extra flags needed.

**Why this structure:**

- `flows/` is versionable — each language has its own narration scripts
- `output/` is gitignored — regenerate any language anytime from its flows
- Backward-compatible — flows directly in `flows/` (no lang subfolder) work exactly as before

### Initialize a new project

```bash
npm run init-project /absolute/path/to/client-project
# Creates .video-docs/ structure and adds .video-docs/output/ to .gitignore
```

### All commands use absolute paths

```bash
# From the skill directory:
bash scripts/run-all.sh /absolute/path/client/.video-docs/flows/01-login.json
bash scripts/run-all.sh /absolute/path/client/.video-docs/flows/es/01-login.json
npx tsx scripts/generate-docs-site.ts /absolute/path/client/.video-docs --dev
npx tsx scripts/analyze-app.ts /absolute/path/client/.video-docs
```

---

## Interaction protocol

Follow these steps in order. Copy the checklist below and track progress.

```
Documentation Progress:
- [ ] Step 0: Verify setup (.env exists, TTS configured, git pull)
- [ ] Step 1: Get app info (URL, client project path, credentials)
- [ ] Step 2: Initialize .video-docs/ in client project (npm run init-project)
- [ ] Step 3: Analyze the app (npx tsx scripts/analyze-app.ts <path>)
- [ ] Step 4: Choose sections to document
- [ ] Step 5: Create or update flow JSONs
- [ ] Step 5b: Rehearse the flow (npx tsx scripts/rehearse.ts <flow.json>)
- [ ] Step 6: Confirm TTS provider
- [ ] Step 7: Run the pipeline (absolute path to flow)
- [ ] Step 8: Generate docs site (optional)
```

---

### STEP 1 — Get app info

Ask the user:

```
Which app do you want to document?
  • Base URL (e.g. http://localhost:8100)
  • Absolute path to the client project (e.g. /home/user/projects/my-app)
• Access credentials: email and password
  (or let me know if .video-docs/config.json already exists in that project)
```

---

### STEP 2 — Initialize .video-docs/ in client project

Check if `.video-docs/` already exists:

```bash
ls /absolute/path/client/.video-docs/config.json 2>/dev/null && echo "exists" || echo "missing"
```

If missing → initialize:

```bash
npm run init-project /absolute/path/to/client-project
```

Then edit `.video-docs/config.json` with the real app info:

```json
{
	"app_name": "<visible app name>",
	"base_url": "<URL>",
	"credentials": {
		"demo": { "email": "<email>", "password": "<password>" }
	},
	"setup_login": { "email": "<email>", "password": "<password>" }
}
```

---

### STEP 3 — Analyze the app

```bash
npx tsx scripts/analyze-app.ts /absolute/path/client/.video-docs
```

Navigates the app, screenshots every nav section, extracts CSS selectors, saves:

- `.video-docs/analysis/sections.json`
- `.video-docs/analysis/screenshots/`

If auto-login fails: add `-- --no-login` to the command.

**SPA note**: if the app uses Vite/Webpack dev server, ensure a production build is active (no `public/hot` file). See [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

---

### STEP 4 — Choose sections to document

Show discovered sections as a lettered list:

```
Found these sections in [App Name]:

  A) Login              — /login
  B) Dashboard          — /dashboard  [existing flow: 01-dashboard.json]
  C) Bot Management     — /bots
  D) All sections

Which sections to document? (e.g. A, C or D for all)
```

---

### STEP 5 — Create or reuse flow JSONs

**If a flow already exists:**

```
"[Section]" already has a flow: /absolute/path/client/.video-docs/flows/<name>.json

  A) Use existing flow as-is
  B) Update flow based on current screenshots
  C) Create from scratch
```

**If no flow exists** → write it directly. Read screenshots from `.video-docs/analysis/screenshots/` to understand the UI.

Flow JSON template:

```json
{
	"project": "<name>",
	"title": "<descriptive title>",
	"category": "<docs site sidebar group, e.g. Getting Started>",
	"description": "<one-line summary shown in docs site cards>",
	"steps_summary": ["Step 1 text", "Step 2 text"],
	"output_name": "<NN-slug>",
	"viewport": { "width": 1280, "height": 800 },
	"use_setup_login": true,
	"steps": [
		{
			"id": "navigate_section",
			"action": "navigate",
			"value": "<URL>",
			"narration": "<What this screen is and what the user can do here>",
			"action_ms": 2000,
			"wait_for": "<CSS selector confirming the page has rendered>"
		},
		{
			"id": "pre_action",
			"action": "wait",
			"narration": "<Narrate WHAT WE ARE ABOUT TO DO — plays BEFORE the action>",
			"action_ms": 600
		},
		{
			"id": "do_action",
			"action": "click",
			"selector": "<CSS selector>",
			"action_ms": 500
		}
	]
}
```

**`action_ms` guidelines:**

- `navigate` SPA: 2000ms + `wait_for: "<selector confirming render>"`
- `fill`: 600–800ms (no narration — silent typing feels natural)
- `click` simple: 800ms
- `click` that navigates: 500ms + `wait_for_url`
- `wait` to show content: 2000–3000ms

**`use_setup_login`:**

- `false` → the video SHOWS the login (flow IS about login)
- `true` → login happens off-camera before recording starts

---

### STEP 5b — Rehearse the flow

**Always rehearse before running the full pipeline.**

Rehearsal runs all steps with Playwright (real browser, real selectors, real navigation) but skips video recording, audio generation, and narration pauses. It finishes in seconds and reports every broken step at once instead of failing mid-pipeline after minutes of TTS.

```bash
npx tsx scripts/rehearse.ts /abs/path/client/.video-docs/flows/<flow>.json
```

Example output:
```
🎭 Rehearsing: "Checkout flow"
   8 steps + 4 setup

🔐 Setup login (demo@example.com)... ✅ → /dashboard
📋 Setup steps:
   setup[0] navigate → https://app/plans... ✅
   setup[1] click .plan-card button... ✅

📹 Recording steps:
   [navigate_checkout] navigate → https://app/checkout... ✅ 312ms → /checkout
   [fill_email] fill #email → demo@example.com... ✅ 98ms
   [fill_card] fill #card-number → 4242... ❌ Timeout: waiting for #card-number
   [submit] click button[type=submit]... ❌ Timeout: waiting for button[type=submit]

─────────────────────────────────────────────────
🎭 Rehearsal complete: 6/8 steps passed (2.4s)

❌ Failed steps (2):
   • [fill_card] Timeout: waiting for #card-number
   • [submit] Timeout: waiting for button[type=submit]

⚠️  Fix these steps before running the full pipeline.
```

Fix the reported selectors, then re-rehearse until all steps pass before launching `run-all.sh`.

**`mailpit_code` in rehearsal** — injects the fake code `"123456"` so downstream `fill` steps using `${variable}` don't fail due to a missing code. This only validates that the OTP input field exists and accepts input — it does not test actual email delivery.

---

### STEP 6 — Confirm TTS provider

```bash
grep '^TTS_PROVIDER' .env
```

If not configured → ask:

```
Which TTS provider should I use?
  A) Piper (free, local — included in tools/piper-tts/)
  B) ElevenLabs (best quality — API key required)
  C) OpenAI TTS (very good — API key required)
  D) Google Gemini TTS (very natural — GEMINI_API_KEY required)
```

For setup details → see [TTS-PROVIDERS.md](TTS-PROVIDERS.md).

---

### STEP 7 — Run the pipeline

Always use the **absolute path** to the flow file:

```bash
bash scripts/run-all.sh /absolute/path/client/.video-docs/flows/<flow>.json
```

**Flags:**

- `--skip-audio` → re-record video only (UI changed, keep audio)
- `--skip-video` → re-assemble only (adjust timing)

If errors occur → see [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

---

### STEP 8 — Generate docs site (optional)

```
Videos are ready! 🎉

Would you like a React docs site with all videos embedded?
  A) No, just the videos
  B) Yes, generate site — opens browser automatically
  C) Yes, add videos to an existing docs site (tell me the path)
```

**Option B:**

```bash
npx tsx scripts/generate-docs-site.ts /absolute/path/client/.video-docs
# Generates .video-docs/docs/, installs deps, opens browser automatically
# Add --no-open to skip auto-launch
```

**Option C:**

```bash
npx tsx scripts/generate-docs-site.ts /absolute/path/client/.video-docs --existing <path>
```

---

## Flow JSON format

### Two-phase execution model

Every flow has two phases. **Only Phase 2 appears in the final video.**

```
Phase 1 — Setup (off-camera, trimmed away)
  use_setup_login: true  → automatic login from config.json credentials
  setup: [...]           → any custom Playwright steps (navigate, click, fill, wait_ms)

Phase 2 — Recording (what the viewer sees)
  steps: [...]           → narrated, timed tutorial steps
```

Use `setup[]` whenever the video needs to **start mid-flow** — already logged in,
already on a specific page, with a cart filled, after an OTP entered, etc.
The viewer never sees these steps.

---

### Flow JSON — full reference

```json
{
  "project": "<name>",
  "title": "<descriptive title>",
  "category": "<docs site sidebar group, e.g. Getting Started>",
  "description": "<one-line summary shown in docs site cards>",
  "steps_summary": ["Step 1 text", "Step 2 text"],
  "output_name": "<NN-slug>",
  "viewport": { "width": 1280, "height": 800 },

  "use_setup_login": true,
  "show_cursor": true,
  "setup": [
    { "action": "navigate", "value": "https://app.example.com/plans" },
    { "action": "click",    "selector": ".plan-card:first-child button" },
    { "action": "wait_ms",  "value": "1500" },
    { "action": "fill",     "selector": "#email", "value": "demo@example.com" }
  ],

  "steps": [
    {
      "id": "navigate_checkout",
      "action": "navigate",
      "value": "https://app.example.com/checkout",
      "narration": "We are now at the checkout screen.",
      "action_ms": 2000,
      "wait_for": ".checkout-form"
    },
    {
      "id": "pre_click",
      "action": "wait",
      "narration": "We fill in the card number and confirm.",
      "action_ms": 600
    },
    {
      "id": "fill_card",
      "action": "fill",
      "selector": "#card-number",
      "value": "4242 4242 4242 4242",
      "action_ms": 800
    },
    {
      "id": "submit",
      "action": "click",
      "selector": "button[type=submit]",
      "action_ms": 500,
      "wait_for_url": "/confirmation"
    }
  ]
}
```

**`use_setup_login`**

- `false` (or omit) → the video SHOWS the login — use when the flow IS about login
- `true` → logs in silently off-camera using `config.setup_login` before recording

**`show_cursor`** (default `true`)

- `true` → red dot cursor overlay visible — recommended for most flows
- `false` → cursor hidden — use for form-heavy flows where the dot is distracting, or for flows that don't need to show pointer movement

**`setup[]`** — runs before recording, never appears in the video. Supports:

| action      | fields              | description                        |
| ----------- | ------------------- | ---------------------------------- |
| `navigate`  | `value`: URL        | go to a URL                        |
| `fill`      | `selector`, `value` | fill a field                       |
| `click`     | `selector`          | click an element                   |
| `wait_ms`   | `value`: ms string  | wait N milliseconds                |

**Step fields (`steps[]`)**

| field          | type    | description                                                     |
| -------------- | ------- | --------------------------------------------------------------- |
| `id`           | string  | unique identifier (used in audio filenames)                     |
| `action`       | string  | see actions table below                                         |
| `value`        | string  | URL / text / variable name — supports `${varName}` substitution |
| `selector`     | CSS     | target element                                                  |
| `nth`          | number  | 0-based index when selector matches multiple elements           |
| `narration`    | string  | text spoken by TTS — omit for silent steps                      |
| `action_ms`    | number  | pause after the action before the next step begins              |
| `wait_for`     | CSS     | wait for this selector to appear after the action               |
| `wait_for_url` | string  | wait until URL contains this fragment after the action          |
| `email`        | string  | for `mailpit_code` — email address to search (overrides default)|

### Available actions (steps[])

| `action`       | `value`                   | `selector`     | description                                                        |
| -------------- | ------------------------- | -------------- | ------------------------------------------------------------------ |
| `navigate`     | URL                       | —              | navigate to URL                                                    |
| `fill`         | text or `${var}`          | CSS            | fill an input — instant, no keyboard events                        |
| `type`         | text or `${var}`          | CSS            | type character-by-character (200ms/char) — use when `fill` doesn't trigger validation or masked fields |
| `click`        | —                         | CSS            | click an element                                                   |
| `blur`         | —                         | CSS            | remove focus (Tab press) — useful after `type` to trigger blur-validation |
| `paste`        | text or `${var}`          | CSS            | dispatch ClipboardEvent — for React inputs that listen to `onPaste` and ignore `fill` |
| `otp_fill`     | code or `${var}`          | CSS (optional) | fill multi-input OTP component digit by digit (default selector: `input[inputmode="numeric"]`) |
| `hover`        | —                         | CSS            | move cursor to element (for tooltips, dropdowns)                   |
| `scroll`       | `"down"` \| `"up"` \| px  | CSS (optional) | scroll page or element into view                                   |
| `wait`         | —                         | —              | pause for `action_ms` ms — use for narration windows               |
| `mailpit_code` | variable name             | —              | **Mailpit only** — extract 6-digit OTP, store in variable          |

### Variable substitution

Use `${varName}` anywhere in `value` fields to inject a stored variable:

```json
{ "id": "get_otp",  "action": "mailpit_code", "value": "otp", "email": "demo@example.com", "action_ms": 1000 },
{ "id": "fill_otp", "action": "fill", "selector": "#otp-input", "value": "${otp}", "action_ms": 600 }
```

### Common pre-recording patterns

**Start the video on a page that requires navigation through several screens first:**
```json
"use_setup_login": true,
"setup": [
  { "action": "navigate", "value": "https://app/products" },
  { "action": "click",    "selector": ".product-card:first-child a" },
  { "action": "wait_ms",  "value": "1200" },
  { "action": "click",    "selector": "button.add-to-cart" },
  { "action": "navigate", "value": "https://app/checkout" },
  { "action": "wait_ms",  "value": "1000" }
]
```

**Register a new user off-camera (video starts after account exists):**
```json
"use_setup_login": false,
"setup": [
  { "action": "navigate", "value": "https://app/register" },
  { "action": "fill",     "selector": "#email",    "value": "demo@example.com" },
  { "action": "fill",     "selector": "#password", "value": "Demo1234!" },
  { "action": "click",    "selector": "button[type=submit]" },
  { "action": "wait_ms",  "value": "2000" }
]
```

### Email / OTP verification flows

**Always ask the client before writing an OTP flow:**

```
Does the flow involve an email verification code or OTP?
If yes — how does your test environment handle email?
  A) Mailpit (local inbox at localhost:8025 or similar)
  B) Mailtrap or another SMTP testing service
  C) The code arrives to a real inbox I can read manually
  D) No email verification involved
```

Each option requires a different approach:

**A) Mailpit** — use the built-in `mailpit_code` action. Make sure `mailpit_url` is set in `config.json`:
```json
// config.json
{ "mailpit_url": "http://localhost:8025" }
```
```json
// flow setup[] + steps[]
"setup": [
  { "action": "click",   "selector": "#send-otp-button" },
  { "action": "wait_ms", "value": "2000" }
],
"steps": [
  { "id": "get_code",  "action": "mailpit_code", "value": "otp", "email": "demo@example.com", "action_ms": 500 },
  { "id": "fill_code", "action": "fill", "selector": "#otp-input", "value": "${otp}", "action_ms": 600 },
  { "id": "submit",    "action": "click", "selector": "button[type=submit]", "action_ms": 500, "wait_for_url": "/dashboard" }
]
```

**B) Mailtrap / external service** — `mailpit_code` does NOT work. Use a fixed demo code if the test account always gets the same code, or skip OTP in the demo by using a pre-verified account in `setup[]`:
```json
"setup": [
  { "action": "navigate", "value": "https://app/register" },
  { "action": "fill",     "selector": "#email",    "value": "already-verified@example.com" },
  { "action": "fill",     "selector": "#password", "value": "Demo1234!" },
  { "action": "click",    "selector": "button[type=submit]" },
  { "action": "wait_ms",  "value": "2000" }
]
```

**C) Manual code** — ask the client to run the flow manually first, note the code, then hardcode it as a `fill` value. Or use a pre-verified test account that bypasses OTP entirely.

> `mailpit_code` is only available in `steps[]`, not in `setup[]`. To handle OTP invisibly, trigger the send in `setup[]` and extract in the first recorded step — the extraction is fast and the viewer sees only a brief pause.

---

## Timing golden rule

Narration describes what is **about to happen**, not what just happened.

```
❌ Wrong — dashboard appears 4s before narration
{ "id": "click_login", "action": "click", ..., "narration": "We click Login", "action_ms": 4000 }

✅ Right — narration plays on the form, THEN click happens
{ "id": "pre_login",  "action": "wait",  "narration": "We click Login to authenticate.", "action_ms": 600 },
{ "id": "click_login","action": "click", ..., "action_ms": 500, "wait_for_url": "/dashboard" }
```

---

## Quick command reference

```bash
# Analyze app and discover sections
npx tsx scripts/analyze-app.ts /absolute/path/client/.video-docs
npx tsx scripts/analyze-app.ts /absolute/path/client/.video-docs --no-login

# Rehearse a flow (validate selectors without recording)
npx tsx scripts/rehearse.ts /absolute/path/client/.video-docs/flows/<flow>.json

# Full pipeline for one flow
bash scripts/run-all.sh /absolute/path/client/.video-docs/flows/<flow>.json

# Individual steps
npx tsx scripts/generate-audio.ts /absolute/path/client/.video-docs/flows/<flow>.json
npx tsx scripts/generate-video.ts /absolute/path/client/.video-docs/flows/<flow>.json
npx tsx scripts/assemble.ts /absolute/path/client/.video-docs/flows/<flow>.enriched.json

# Re-record without regenerating audio
bash scripts/run-all.sh /absolute/path/client/.video-docs/flows/<flow>.json --skip-audio

# Adjust audio timing without re-recording
npx tsx scripts/adjust-timing.ts /absolute/path/client/.video-docs/flows/<flow>.enriched.json --show
npx tsx scripts/adjust-timing.ts ... --step <id>:<ms> --reassemble

# Batch all flows in a directory
bash scripts/gen-all-flows.sh /absolute/path/client/.video-docs/flows/

# Generate docs site (with auto browser open)
npx tsx scripts/generate-docs-site.ts /absolute/path/client/.video-docs --dev
npx tsx scripts/generate-docs-site.ts /absolute/path/client/.video-docs --out /custom/path
npx tsx scripts/generate-docs-site.ts /absolute/path/client/.video-docs --existing /path/to/existing/docs
```

---

## Output structure

```
/absolute/path/client/.video-docs/
├── output/
│   └── <flow-name>/
│       ├── audio/           ← MP3 per step
│       ├── raw/             ← .webm recording
│       └── final/
│           ├── <flow>.mp4   ← FINAL VIDEO
│           └── <flow>-thumb.jpg
└── docs/                    ← React site (if generated)
    ├── package.json
    ├── src/App.tsx
    └── public/videos/
```
