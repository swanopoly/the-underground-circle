/**
 * chatRecording — UC-4 record & replay engine.
 *
 * Captures every client-delegated tool call (desktop.*, browser.*)
 * while a recording session is active. On `stop`, the trace is saved
 * as a named recording in localStorage. `/replay <name>` may later repeat
 * only the explicitly reviewed observation allowlist. A recording containing
 * any browser/desktop mutation returns a typed OpenSwan runtime handoff and
 * executes zero steps.
 *
 * Why localStorage (not Supabase yet): recordings are per-device —
 * the bridge + AX grant + browser profile are all on THIS Mac, so
 * syncing recordings cross-device would mean replaying against
 * someone else's AX tree which is meaningless. When we eventually
 * ship a cloud-executor path (UC-cloud-future), recordings can sync.
 *
 * Mutation recordings are useful as planning evidence, but they are never
 * authority to replay a side effect. A fresh authenticated run must observe
 * the target, issue a new provider tool-use identity, obtain exact approval,
 * claim the action durably, dispatch once, and verify fresh after-state.
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

export interface RecordingOwnerScope {
  userId: string;
  circleId: string;
}

function normalizeRecordingScope(scope: RecordingOwnerScope | null | undefined): RecordingOwnerScope | null {
  const userId = typeof scope?.userId === 'string' ? scope.userId.trim().toLowerCase() : '';
  const circleId = typeof scope?.circleId === 'string' ? scope.circleId.trim().toLowerCase() : '';
  if (!userId || !circleId || userId.length > 200 || circleId.length > 200) return null;
  return { userId, circleId };
}

function recordingMatchesScope(
  recording: Pick<Recording, 'userId' | 'circleId'> | Pick<ActiveSession, 'userId' | 'circleId'> | null | undefined,
  scope: RecordingOwnerScope | null | undefined,
): boolean {
  const normalized = normalizeRecordingScope(scope);
  return !!normalized
    && typeof recording?.userId === 'string'
    && typeof recording?.circleId === 'string'
    && recording.userId.trim().toLowerCase() === normalized.userId
    && recording.circleId.trim().toLowerCase() === normalized.circleId;
}

function recordingStoreKey(scope: RecordingOwnerScope, slug: string): string {
  return `${encodeURIComponent(scope.userId)}:${encodeURIComponent(scope.circleId)}:${slug}`;
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
  const scope = normalizeRecordingScope(args);
  if (!scope) return { ok: false, error: 'signed-in user and Circle are required' };
  const slug = slugifyRecordingName(args.name);
  if (!slug) return { ok: false, error: 'name required (alphanumerics + dashes)' };
  if (readActive()) {
    return { ok: false, error: 'a recording is already active — /record stop or /record abort first' };
  }
  const session: ActiveSession = {
    name: slug,
    circleId: scope.circleId,
    userId: scope.userId,
    startedAt: Date.now(),
    steps: [],
  };
  writeActive(session);
  return { ok: true, session };
}

export function appendStep(step: RecordedStep, scope: RecordingOwnerScope): void {
  const active = readActive();
  if (!active || !recordingMatchesScope(active, scope)) return;
  // Cap at 200 steps per recording; beyond that it's unlikely to be
  // useful and localStorage has finite quota.
  if (active.steps.length >= 200) return;
  active.steps.push(step);
  writeActive(active);
}

export function getActiveSession(scope: RecordingOwnerScope): ActiveSession | null {
  const active = readActive();
  return recordingMatchesScope(active, scope) ? active : null;
}

/** Read-only badge helper. It still requires the exact signed-in owner and
 * never exposes another local account's active task text or recording name. */
export function getActiveSessionForUser(userId: string | null | undefined): ActiveSession | null {
  const normalizedUserId = typeof userId === 'string' ? userId.trim().toLowerCase() : '';
  const active = readActive();
  return normalizedUserId
    && active?.userId?.trim().toLowerCase() === normalizedUserId
    ? active
    : null;
}

export function stopRecording(opts: RecordingOwnerScope & { description?: string }): { ok: true; recording: Recording } | { ok: false; error: string } {
  const active = readActive();
  const scope = normalizeRecordingScope(opts);
  if (!scope || !active || !recordingMatchesScope(active, scope)) {
    return { ok: false, error: 'no recording in progress' };
  }
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
  store[recordingStoreKey(scope, active.name)] = recording;
  writeStore(store);
  writeActive(null);
  return { ok: true, recording };
}

export function abortRecording(scope: RecordingOwnerScope): { ok: true; discardedSteps: number } {
  const active = readActive();
  if (!active || !recordingMatchesScope(active, scope)) return { ok: true, discardedSteps: 0 };
  writeActive(null);
  return { ok: true, discardedSteps: active?.steps.length ?? 0 };
}

/**
 * Remove recording data owned by the account leaving this device while
 * preserving recordings explicitly owned by other local accounts. Legacy
 * rows without an owner are removed because they cannot be isolated safely.
 */
export function clearRecordingStateForLogout(userId?: string | null): {
  activeCleared: boolean;
  savedCleared: number;
} {
  const active = readActive();
  // There can be only one active recorder on the device. It is executable
  // session state, so any account exit aborts it regardless of a corrupt or
  // stale owner field.
  const shouldClearActive = !!active;
  if (shouldClearActive) writeActive(null);

  if (!userId) return { activeCleared: shouldClearActive, savedCleared: 0 };
  const store = readStore();
  let savedCleared = 0;
  for (const [name, recording] of Object.entries(store)) {
    if (!recording?.userId || recording.userId === userId) {
      delete store[name];
      savedCleared += 1;
    }
  }
  if (savedCleared > 0) writeStore(store);
  return { activeCleared: shouldClearActive, savedCleared };
}

// ─── Library reads ──────────────────────────────────────────────────

export function listRecordings(scope: RecordingOwnerScope): Recording[] {
  const normalized = normalizeRecordingScope(scope);
  if (!normalized) return [];
  const store = readStore();
  const rows = Object.values(store).filter((recording) => recordingMatchesScope(recording, normalized));
  rows.sort((a, b) => b.createdAt - a.createdAt);
  return rows;
}

export function getRecording(name: string, scope: RecordingOwnerScope): Recording | null {
  const normalized = normalizeRecordingScope(scope);
  if (!normalized) return null;
  const store = readStore();
  const slug = slugifyRecordingName(name);
  const exact = store[recordingStoreKey(normalized, slug)];
  if (recordingMatchesScope(exact, normalized)) return exact;
  // Pre-v2 stores used only the slug as their object key. Accept such a row
  // only when its embedded owner and Circle match exactly.
  const legacy = store[slug];
  return recordingMatchesScope(legacy, normalized) ? legacy : null;
}

export function deleteRecording(name: string, scope: RecordingOwnerScope): boolean {
  const normalized = normalizeRecordingScope(scope);
  if (!normalized) return false;
  const store = readStore();
  const slug = slugifyRecordingName(name);
  const exactKey = recordingStoreKey(normalized, slug);
  if (recordingMatchesScope(store[exactKey], normalized)) {
    delete store[exactKey];
  } else if (recordingMatchesScope(store[slug], normalized)) {
    delete store[slug];
  } else {
    return false;
  }
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
