// ─── App Analysis ───────────────────────────────────────────────────────────

export interface PageElement {
  tag: string;
  type?: string;
  selector: string;
  text?: string;
  placeholder?: string;
}

export interface AppSection {
  id: string;
  title: string;
  url: string;
  screenshot: string;
  elements: PageElement[];
  existing_flow?: string;
}

export interface AppAnalysis {
  app_name: string;
  base_url: string;
  analyzed_at: string;
  sections: AppSection[];
}

// ─── Docs Site ───────────────────────────────────────────────────────────────

export interface DocsSiteSection {
  id: string;
  title: string;
  category: string;
  description?: string;
  steps?: string[];
  video_path: string;
  thumbnail_path?: string;
  duration_sec?: number;
}

export interface DocsSiteConfig {
  title: string;
  description?: string;
  sections: DocsSiteSection[];
  output_dir: string;
  mode: 'new' | 'append';
  existing_docs_dir?: string;
}

// ─── Flow types ──────────────────────────────────────────────────────────────

export type StepAction =
  | 'navigate'
  | 'fill'
  | 'type'         // types character-by-character with delay (for inputs that block fill)
  | 'click'
  | 'blur'         // removes focus from an element (Tab press)
  | 'paste'        // dispatches ClipboardEvent (for React controlled inputs that ignore fill)
  | 'otp_fill'     // fills a multi-input OTP component digit by digit using nth()
  | 'wait'
  | 'hover'
  | 'scroll'
  | 'screenshot'
  | 'mailpit_code'; // extracts 6-digit code from mailpit and stores it as a variable

export interface FlowStep {
  id: string;
  action: StepAction;
  /** URL for navigate, text for fill, variable name for mailpit_code result */
  value?: string;
  /** CSS selector for fill/click/hover */
  selector?: string;
  /** 0-based index when multiple elements match the selector */
  nth?: number;
  /** Narration text converted to voice. Omit for silent steps. */
  narration?: string;
  /**
   * Milliseconds to wait AFTER the action completes (and after wait_for resolves)
   * before the narration audio starts. Allows UI animations/transitions to finish.
   */
  action_ms: number;
  /** CSS selector to wait for AFTER the action completes */
  wait_for?: string;
  /** URL fragment to wait for (trailing glob: "/admin/drivers" won't match "/admin/drivers/create") */
  wait_for_url?: string;
  /** For mailpit_code: email address to search */
  email?: string;

  // Populated by generate-audio.ts — do not set manually:
  audio_duration_ms?: number;
  audio_file?: string;
  /** Cumulative ms in the final video where this audio overlay starts */
  audio_start_ms?: number;
}

/** Steps that run BEFORE recording starts (login, setup state, etc.) */
export interface SetupStep {
  action: 'navigate' | 'fill' | 'click' | 'wait_ms';
  value?: string;
  selector?: string;
}

export interface ProjectConfig {
  app_name: string;
  base_url: string;
  mailpit_url?: string;
  credentials: Record<string, { email: string; password: string }>;
  setup_login: { email: string; password: string };
}

export interface Flow {
  /** Must match a folder in projects/ (e.g. "demo-app"). Omit only for ad-hoc JSON next to this tool. */
  project?: string;
  title: string;
  /** Category label shown in the docs site sidebar (e.g. "Getting Started", "Administration") */
  category?: string;
  /** Short description shown under the title in docs site cards and detail pages */
  description?: string;
  /** Numbered steps shown below the video in the docs site */
  steps_summary?: string[];
  /** Slug used for output folder and file names */
  output_name: string;
  viewport: { width: number; height: number };
  /**
   * If true, runs setup_login from config.json before recording starts.
   * The login steps are NOT recorded in the video.
   */
  use_setup_login?: boolean;
  /** Custom setup steps to run before recording (not recorded). */
  setup?: SetupStep[];
  /**
   * Show the red cursor overlay during recording. Defaults to true.
   * Set to false to hide the cursor (e.g. for form-heavy flows where the dot is distracting).
   */
  show_cursor?: boolean;
  steps: FlowStep[];
  /**
   * Milliseconds to trim from the start of the raw video (login section).
   * Populated automatically by generate-video.ts — do not set manually.
   */
  trim_start_ms?: number;
}
