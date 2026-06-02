/**
 * chatRecording — UC-4 record & replay engine.
 *
 * Captures every client-delegated tool call (desktop.*, browser.*)
 * while a recording session is active. On `stop`, the trace is saved
 * as a named recording in localStorage. `/replay <name>` later reads
 * the trace and re-fires the same calls in order.
 *
 * Why localStorage (not Supabase yet): recordings are per-device —
 * the bridge + AX grant + browser profile are all on THIS Mac, so
 * syncing recordings cross-device would mean replaying against
 * someone else's AX tree which is meaningless. When we eventually
 * ship a cloud-executor path (UC-cloud-future), recordings can sync.
 *
 * Replay strategy per step:
 * - `browser.click_role` / `browser.fill_field` — re-fire verbatim;
 *   role + name is already semantic.
 * - `desktop.set_element_value` — re-fire by semantic target when
 *   recorded from an AX field; fall back to the captured path.
 * - `desktop.click_element` — re-fetch the a11y tree for the
 *   captured app, locate the element by role + label (not path,
 *   because paths shift when the app's tree changes), click it.
 * - `desktop.click_at` — best-effort, fires the same pixel coord
 *   (may break if the screen resolution changed; recorded only as
 *   a fallback).
 * - Everything else (launch_app, type_text, press_keys, open_url,
 *   screenshot, wait_for_app) — re-fire verbatim.
 */

const STORE_KEY = 'uc_recordings_v1';
const ACTIVE_KEY = 'uc_active_recording_v1';

// ─── Types ──────────────────────────────────────────────────────────

export interface RecordedStep {
  ts: number;                     // Date.now()
  tool: string;                   // 'desktop.launch_app', 'browser.click_role', ...
  input: Record<string, unknown>;
  /** Redacted subset of the tool result. We keep enough to make replay
   *  possible (app name, pid, clicked element's label) but drop the
   *  full a11y tree dumps to keep records small. */
  outcome: {
    ok: boolean;
    summary?: string;            // human-readable, e.g. "Launched Zoom" or "Clicked 'Send'"
    error?: string;
    /** Semantic target for desktop.click_element replay — captured at
     *  record time so replay can find the element even if path shifts. */
    target?: { role?: string; label?: string; app?: string };
  };
}

export interface Recording {
  name: string;
  description: string;
  circleId: string;
  userId: string;
  createdAt: number;
  durationMs: number;
  steps: RecordedStep[];
}

export interface ActiveSession {
  name: string;
  circleId: string;
  userId: string;
  startedAt: number;
  steps: RecordedStep[];
}

/**
 * Format an elapsed-seconds value for the RecordingBadge + similar
 * read-outs. Pure — no locale / timezone / DateTime dependencies so
 * it's safe to smoke-test. Contract:
 *   <60s   → "Ns"
 *   <1h    → "Mm Ss"
 *   ≥1h    → "Hh Mm"
 * Negative or NaN inputs are clamped to 0.
 */
export function formatElapsedSec(sec: number): string {
  const safe = Number.isFinite(sec) && sec > 0 ? Math.floor(sec) : 0;
  if (safe < 60) return `${safe}s`;
  if (safe < 3600) return `${Math.floor(safe / 60)}m ${safe % 60}s`;
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  return `${h}h ${m}m`;
}

// ─── LocalStorage helpers ───────────────────────────────────────────

function readStore(): Record<string, Recording> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

function writeStore(store: Record<string, Recording>): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); }
  catch (err) { console.warn('[recording] failed to persist:', err); }
}

function readActive(): ActiveSession | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(ACTIVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.steps)) {
      return parsed as ActiveSession;
    }
    return null;
  } catch { return null; }
}

function writeActive(session: ActiveSession | null): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (session) localStorage.setItem(ACTIVE_KEY, JSON.stringify(session));
    else localStorage.removeItem(ACTIVE_KEY);
  } catch (err) { console.warn('[recording] failed to persist active:', err); }
}

// ─── Name normalisation ─────────────────────────────────────────────
//
// Recordings are addressable by human-friendly names but stored under
// a kebab-cased slug so `replay "Open Zoom"` and `replay open-zoom`
// both work. Keep it ASCII-only so localStorage keys stay predictable.

export function slugifyRecordingName(raw: string): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || '';
}

// ─── Session control ────────────────────────────────────────────────

export function startRecording(args: {
  name: string;
  circleId: string;
  userId: string;
}): { ok: true; session: ActiveSession } | { ok: false; error: string } {
  const slug = slugifyRecordingName(args.name);
  if (!slug) return { ok: false, error: 'name required (alphanumerics + dashes)' };
  if (readActive()) {
    return { ok: false, error: 'a recording is already active — /record stop or /record abort first' };
  }
  const session: ActiveSession = {
    name: slug,
    circleId: args.circleId,
    userId: args.userId,
    startedAt: Date.now(),
    steps: [],
  };
  writeActive(session);
  return { ok: true, session };
}

export function appendStep(step: RecordedStep): void {
  const active = readActive();
  if (!active) return;
  // Cap at 200 steps per recording; beyond that it's unlikely to be
  // useful and localStorage has finite quota.
  if (active.steps.length >= 200) return;
  active.steps.push(step);
  writeActive(active);
}

export function getActiveSession(): ActiveSession | null {
  return readActive();
}

export function stopRecording(opts: { description?: string } = {}): { ok: true; recording: Recording } | { ok: false; error: string } {
  const active = readActive();
  if (!active) return { ok: false, error: 'no recording in progress' };
  if (active.steps.length === 0) {
    writeActive(null);
    return { ok: false, error: 'recording had zero steps — discarded' };
  }
  const recording: Recording = {
    name: active.name,
    description: String(opts.description || '').slice(0, 400) || `Recorded ${active.steps.length} steps`,
    circleId: active.circleId,
    userId: active.userId,
    createdAt: active.startedAt,
    durationMs: Date.now() - active.startedAt,
    steps: active.steps,
  };
  const store = readStore();
  store[active.name] = recording;
  writeStore(store);
  writeActive(null);
  return { ok: true, recording };
}

export function abortRecording(): { ok: true; discardedSteps: number } {
  const active = readActive();
  writeActive(null);
  return { ok: true, discardedSteps: active?.steps.length ?? 0 };
}

// ─── Library reads ──────────────────────────────────────────────────

export function listRecordings(filter?: { circleId?: string }): Recording[] {
  const store = readStore();
  let rows = Object.values(store);
  if (filter?.circleId) rows = rows.filter((r) => r.circleId === filter.circleId);
  rows.sort((a, b) => b.createdAt - a.createdAt);
  return rows;
}

export function getRecording(name: string): Recording | null {
  const store = readStore();
  return store[slugifyRecordingName(name)] || null;
}

export function deleteRecording(name: string): boolean {
  const store = readStore();
  const slug = slugifyRecordingName(name);
  if (!store[slug]) return false;
  delete store[slug];
  writeStore(store);
  return true;
}

// ─── Observer — called from the dispatcher ──────────────────────────
//
// `captureToolCall` is the public hook the swanbot dispatcher uses to
// report a completed tool call. Keeping it a pure function over the
// inputs + outputs keeps the dispatcher independent of recording.

/** Tools that ARE worth recording. Excludes read-only probes. */
const RECORDABLE_TOOLS = new Set([
  // Desktop (writes or user-visible)
  'desktop.launch_app',
  'desktop.focus_app',
  'desktop.type_text',
  'desktop.paste_text',
  'desktop.press_keys',
  'desktop.menu_click',
  'desktop.mouse_click',
  'desktop.mouse_down',
  'desktop.mouse_up',
  'desktop.mouse_drag',
  'desktop.mouse_scroll',
  'desktop.click_at',
  'desktop.click_element',
  'desktop.set_element_value',
  'desktop.open_url',
  'desktop.open_path',
  'desktop.wait_for_app',
  // Browser
  'browser.open_url',
  'browser.click_role',
  'browser.fill_field',
  'browser.press_key',
]);

export function isRecordable(tool: string): boolean {
  return RECORDABLE_TOOLS.has(tool);
}

/**
 * Build a redacted step from a tool-call observation. Kept as a pure
 * transform so it's trivial to smoke-test independent of DOM/AX state.
 */
export function buildStep(args: {
  tool: string;
  input: Record<string, unknown>;
  result: { ok: boolean; data?: unknown; error?: string };
  a11yTarget?: { role?: string; label?: string; app?: string };
}): RecordedStep {
  const ok = !!args.result.ok;
  let summary: string | undefined;
  const d = (args.result.data || {}) as Record<string, unknown>;

  switch (args.tool) {
    case 'desktop.launch_app':
    case 'desktop.focus_app':
      summary = `${args.tool === 'desktop.launch_app' ? 'Launched' : 'Focused'} ${String(args.input.appName || '')}`;
      break;
    case 'desktop.type_text':
      summary = `Typed ${String(args.input.text || '').length} chars`;
      break;
    case 'desktop.paste_text':
      summary = `Pasted ${String(args.input.text || '').length} chars`;
      break;
    case 'desktop.press_keys':
      summary = `Pressed ${String(args.input.combo || '')}`;
      break;
    case 'desktop.click_element':
      summary = args.a11yTarget?.label
        ? `Clicked "${args.a11yTarget.label}"`
        : `Clicked element at ${String(args.input.path || '')}`;
      break;
    case 'desktop.set_element_value':
      summary = args.a11yTarget?.label
        ? `Set "${args.a11yTarget.label}" to ${String(args.input.text || '').length} chars`
        : `Set element at ${String(args.input.path || '')} to ${String(args.input.text || '').length} chars`;
      break;
    case 'desktop.click_at':
      summary = `Clicked at (${args.input.x}, ${args.input.y})`;
      break;
    case 'desktop.mouse_click':
      summary = `Mouse clicked at (${args.input.x}, ${args.input.y})`;
      break;
    case 'desktop.mouse_down':
      summary = `Mouse down at (${args.input.x}, ${args.input.y})`;
      break;
    case 'desktop.mouse_up':
      summary = typeof args.input.x === 'number' && typeof args.input.y === 'number'
        ? `Mouse up at (${args.input.x}, ${args.input.y})`
        : 'Mouse up';
      break;
    case 'desktop.mouse_drag':
      summary = `Dragged from (${args.input.fromX}, ${args.input.fromY}) to (${args.input.toX}, ${args.input.toY})`;
      break;
    case 'desktop.mouse_scroll':
      summary = `Scrolled mouse deltaY=${String(args.input.deltaY ?? '')}`;
      break;
    case 'browser.open_url':
      summary = `Opened ${String(args.input.url || '')}`;
      break;
    case 'browser.click_role':
      summary = `Clicked ${String(args.input.role)} "${String(args.input.name || '')}"`;
      break;
    case 'browser.fill_field':
      summary = `Filled ${String(args.input.role)} "${String(args.input.name || '')}" with ${String(args.input.text || '').length} chars`;
      break;
    default:
      summary = args.tool;
  }

  const out: RecordedStep = {
    ts: Date.now(),
    tool: args.tool,
    input: args.input,
    outcome: { ok, summary, error: ok ? undefined : args.result.error },
  };
  if (args.a11yTarget) out.outcome.target = args.a11yTarget;
  // Drop unserialisable values defensively — localStorage is JSON.
  // Any Buffer/typed-array/function would throw on JSON.stringify.
  return JSON.parse(JSON.stringify(out));
}

// ─── Replay planning ────────────────────────────────────────────────
//
// `planReplay` turns a saved recording into a list of tool invocations
// the dispatcher can fire. Kept separate from the actual dispatch so
// the logic is testable with no bridge attached.

export type ReplayInvocation = {
  tool: string;
  input: Record<string, unknown>;
  /** Optional note the UI can render ("Finding element by label rather
   *  than path — app tree may have shifted since recording."). */
  note?: string;
};

/**
 * Translates a recorded step into the tool call to fire at replay time.
 * For semantic AX steps we carry both the original path and `_target`.
 * The replay dispatcher should prefer target lookup because paths are
 * unstable across app restarts; path remains a last-resort fallback.
 */
export function planReplayStep(step: RecordedStep): ReplayInvocation {
  if (step.tool === 'desktop.click_element' || step.tool === 'desktop.set_element_value') {
    return {
      tool: step.tool,
      input: {
        // Path is carried through but the replay dispatcher should
        // prefer target lookup. Keeping both lets the dispatcher use
        // path as a last resort for apps whose tree is stable.
        ...step.input,
        _target: step.outcome.target || null,
      },
      note: step.outcome.target?.label
        ? `Finding element by label "${step.outcome.target.label}" rather than path.`
        : undefined,
    };
  }
  return { tool: step.tool, input: step.input };
}

export function planReplay(recording: Recording): ReplayInvocation[] {
  return recording.steps.filter((s) => s.outcome.ok).map(planReplayStep);
}
