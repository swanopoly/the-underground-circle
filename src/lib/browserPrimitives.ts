/**
 * browserPrimitives — pure, dependency-light shapes + normalizers for the
 * Lane-A browser primitives (multi-tab, downloads, explicit waits, wheel
 * scroll). No fetch / no Supabase / no react-native so smoke tests import
 * this in Node, and `scripts/browser-bridge.js` (plain CommonJS) mirrors
 * the same shapes.
 *
 * Why a separate pure module: the tab-list normalizer, download-proof
 * builder, wait-spec parser, and scroll clamp are the parts most worth
 * covering with an offline smoke test — they are where garbage input,
 * duplicate-active tabs, or an oversized wheel delta would otherwise slip
 * through to the live browser. The bridge server (browser-bridge.js) and
 * the client (browserBridge.ts) both defer to these so the three surfaces
 * cannot drift.
 */

// ─── Multi-tab ────────────────────────────────────────────────────────────

/** One tracked browser tab (page) in the persistent context. */
export interface BrowserTabInfo {
  /** 0-based index in the context's page list. */
  index: number;
  url: string;
  title: string;
  /** Exactly one tab in a normalized list is active (the foreground page). */
  active: boolean;
}

export interface NormalizedTabList {
  tabs: BrowserTabInfo[];
  /** Index of the active tab, or -1 when the list is empty. */
  activeIndex: number;
}

/** Hard bound so a runaway page list can never blow up a tool result. */
export const MAX_TRACKED_TABS = 50;
/** Model-visible title/url slices stay bounded like the DOM-tree render. */
const TAB_URL_MAX = 400;
const TAB_TITLE_MAX = 200;

function coerceString(value: unknown, max: number): string {
  if (value == null) return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * Tolerant tab-list normalizer. Accepts whatever the bridge (or a flaky
 * page enumeration) hands back and returns a bounded, well-typed list with
 * exactly one active tab:
 *  - non-array input → empty list;
 *  - indices are re-derived from position (never trusted from the payload)
 *    so they always match `tabs[i].index === i`;
 *  - url/title are coerced to bounded strings;
 *  - if zero tabs claim active, the first tab becomes active;
 *  - if several claim active, only the first-claimed stays active
 *    (fail-closed to a single foreground page).
 */
export function normalizeTabList(raw: unknown): NormalizedTabList {
  if (!Array.isArray(raw)) return { tabs: [], activeIndex: -1 };
  const bounded = raw.slice(0, MAX_TRACKED_TABS);
  let activeIndex = -1;
  const tabs: BrowserTabInfo[] = bounded.map((entry, index) => {
    const obj = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
    const claimsActive = obj.active === true;
    // First claim wins; later "active" flags are dropped so the list has a
    // single foreground page.
    let active = false;
    if (claimsActive && activeIndex === -1) {
      active = true;
      activeIndex = index;
    }
    return {
      index,
      url: coerceString(obj.url, TAB_URL_MAX),
      title: coerceString(obj.title, TAB_TITLE_MAX),
      active,
    };
  });
  // No tab claimed active → default the first one so callers always have a
  // foreground to act on.
  if (activeIndex === -1 && tabs.length > 0) {
    tabs[0].active = true;
    activeIndex = 0;
  }
  return { tabs, activeIndex };
}

/**
 * Clamp a caller-supplied tab index against the current tab count. Returns
 * a fail-closed error shape rather than throwing so both the bridge and the
 * client can surface `invalid_input` consistently.
 */
export function clampTabIndex(
  index: unknown,
  tabCount: number,
): { ok: true; index: number } | { ok: false; error: string } {
  const n = Number(index);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return { ok: false, error: 'tab index must be an integer' };
  if (n < 0) return { ok: false, error: 'tab index must be non-negative' };
  if (tabCount <= 0) return { ok: false, error: 'no open tabs' };
  if (n >= tabCount) return { ok: false, error: `tab index ${n} out of range (0..${tabCount - 1})` };
  return { ok: true, index: n };
}

// ─── Download proof ────────────────────────────────────────────────────────

export interface DownloadProofInput {
  /** Absolute path the file was saved to on disk. */
  path?: string | null;
  /** Byte size on disk — the backend-aware proof (real file, real size). */
  sizeBytes?: number | null;
  /** Saved basename; derived from `path` when omitted. */
  basename?: string | null;
  /** The browser's suggested filename before we scoped it (optional). */
  suggestedFilename?: string | null;
}

export interface DownloadProof {
  basename: string;
  sizeBytes: number;
  humanSize: string;
  /** Compact, home-path-safe tail of the save path (e.g. ".../UC/downloads/x.pdf"). */
  pathTail: string;
  suggestedFilename?: string;
  /** One-line evidence string suitable for the evidence contract / chat proof. */
  summary: string;
}

/** Format a byte count the way a user would read it (B/KB/MB/GB). */
export function formatByteSize(bytes: unknown): string {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return '0 B';
  if (n < 1024) return `${Math.round(n)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = n / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  // One decimal below 10, whole numbers above — keeps it human ("1.4 MB", "37 KB").
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}

function basenameFromPath(rawPath: string): string {
  const cleaned = rawPath.replace(/[\\/]+$/, '');
  const parts = cleaned.split(/[\\/]/);
  return parts[parts.length - 1] || '';
}

/**
 * Build a compact, home-path-safe tail of a save path. We never want to
 * leak the full `/Users/<name>/...` home prefix into model-visible proof;
 * keep the last two segments (dir + file) prefixed with an ellipsis so the
 * model still sees WHERE it landed without the absolute home path.
 */
export function toSafePathTail(rawPath: unknown, segments = 2): string {
  const raw = coerceString(rawPath, 1024);
  if (!raw) return '';
  const parts = raw.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length <= segments) return parts.join('/');
  return `.../${parts.slice(-segments).join('/')}`;
}

/**
 * Turn a saved-download descriptor into the compact proof object the
 * evidence contract expects: real basename, human size, and a home-safe
 * path tail. This is the backend-aware proof (file exists on disk + size),
 * NOT a screenshot — it is what proves a "download the invoice" task
 * actually produced a file. Fail-closed: missing/garbage size becomes 0.
 */
export function buildDownloadProof(input: DownloadProofInput): DownloadProof {
  const rawPath = coerceString(input.path, 1024);
  const basename = coerceString(input.basename, TAB_TITLE_MAX)
    || (rawPath ? basenameFromPath(rawPath) : '')
    || coerceString(input.suggestedFilename, TAB_TITLE_MAX)
    || 'download';
  const sizeNum = Number(input.sizeBytes);
  const sizeBytes = Number.isFinite(sizeNum) && sizeNum > 0 ? Math.round(sizeNum) : 0;
  const humanSize = formatByteSize(sizeBytes);
  const pathTail = toSafePathTail(rawPath);
  const suggestedFilename = coerceString(input.suggestedFilename, TAB_TITLE_MAX) || undefined;
  const summary = `Downloaded "${basename}" (${humanSize})${pathTail ? ` → ${pathTail}` : ''}`;
  const proof: DownloadProof = { basename, sizeBytes, humanSize, pathTail, summary };
  if (suggestedFilename && suggestedFilename !== basename) proof.suggestedFilename = suggestedFilename;
  return proof;
}

// ─── wait_for spec ──────────────────────────────────────────────────────────

export type WaitForMode = 'selector' | 'state' | 'timeout';
export type WaitForLoadState = 'load' | 'domcontentloaded' | 'networkidle';
export type WaitForSelectorState = 'attached' | 'detached' | 'visible' | 'hidden';

export interface WaitForSpec {
  mode: WaitForMode;
  /** Present when mode==='selector'. */
  selector?: string;
  /** waitForSelector state (mode==='selector'); defaults to 'visible'. */
  selectorState?: WaitForSelectorState;
  /** Present when mode==='state'. */
  state?: WaitForLoadState;
  /** Bounded ms — used directly for mode==='timeout', and as the auto-wait
   *  budget for selector/state. */
  timeoutMs: number;
}

export const WAIT_FOR_MIN_TIMEOUT_MS = 0;
export const WAIT_FOR_MAX_TIMEOUT_MS = 60_000;
export const WAIT_FOR_DEFAULT_TIMEOUT_MS = 15_000;
/** Plain-delay ceiling is lower than the selector/state wait budget — a
 *  bare sleep should never hold the bridge for a full minute. */
export const WAIT_FOR_MAX_DELAY_MS = 30_000;

const LOAD_STATES = new Set<WaitForLoadState>(['load', 'domcontentloaded', 'networkidle']);
const SELECTOR_STATES = new Set<WaitForSelectorState>(['attached', 'detached', 'visible', 'hidden']);

function clampTimeout(value: unknown, fallback: number, max = WAIT_FOR_MAX_TIMEOUT_MS): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(WAIT_FOR_MIN_TIMEOUT_MS, Math.min(max, Math.round(n)));
}

/**
 * Parse a wait_for request into a bounded, well-typed spec. Precedence
 * mirrors what a caller most likely means:
 *   1. an explicit selector → wait for that element (state defaults to
 *      'visible');
 *   2. a load state ('load'|'domcontentloaded'|'networkidle') → wait for
 *      that lifecycle event;
 *   3. otherwise a plain bounded delay.
 * Garbage / empty input fails closed to a short default delay so the
 * caller never hangs on an unbounded wait.
 */
export function parseWaitForSpec(input: unknown): WaitForSpec {
  const obj = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};

  // 1. selector wait.
  const selector = coerceString(obj.selector, 1024);
  if (selector) {
    const rawState = coerceString(obj.state, 40).toLowerCase() as WaitForSelectorState;
    const selectorState = SELECTOR_STATES.has(rawState) ? rawState : 'visible';
    return {
      mode: 'selector',
      selector,
      selectorState,
      timeoutMs: clampTimeout(obj.timeoutMs, WAIT_FOR_DEFAULT_TIMEOUT_MS),
    };
  }

  // 2. load-state wait.
  const rawState = coerceString(obj.state, 40).toLowerCase() as WaitForLoadState;
  if (LOAD_STATES.has(rawState)) {
    return {
      mode: 'state',
      state: rawState,
      timeoutMs: clampTimeout(obj.timeoutMs, WAIT_FOR_DEFAULT_TIMEOUT_MS),
    };
  }

  // 3. plain delay (fail-closed default). A missing/garbage timeout still
  //    yields a short, bounded sleep rather than an unbounded wait.
  const hasTimeout = obj.timeoutMs != null && Number.isFinite(Number(obj.timeoutMs));
  return {
    mode: 'timeout',
    timeoutMs: clampTimeout(hasTimeout ? obj.timeoutMs : 1_000, 1_000, WAIT_FOR_MAX_DELAY_MS),
  };
}

/** One-line description of what a wait_for spec awaited (for tool results). */
export function describeWaitForSpec(spec: WaitForSpec): string {
  switch (spec.mode) {
    case 'selector':
      return `waited for selector ${spec.selector} to be ${spec.selectorState || 'visible'} (≤${spec.timeoutMs}ms)`;
    case 'state':
      return `waited for page state "${spec.state}" (≤${spec.timeoutMs}ms)`;
    case 'timeout':
    default:
      return `waited ${spec.timeoutMs}ms`;
  }
}

// ─── Scroll delta ────────────────────────────────────────────────────────────

export interface ScrollDelta {
  dx: number;
  dy: number;
}

/** Single-gesture wheel bound — a real trackpad flick is a few hundred px;
 *  anything past this is almost certainly a mistake or an attempt to jump
 *  the whole document, which should be several bounded scrolls instead. */
export const SCROLL_DELTA_MAX = 5_000;

/**
 * Clamp a wheel-scroll request to sane bounds. Non-finite axes become 0
 * (no movement on that axis) so a garbage dx never scrolls sideways
 * unexpectedly; a default downward nudge is applied only when BOTH axes are
 * absent so `scroll()` with no args still advances the page.
 */
export function normalizeScrollDelta(input: unknown): ScrollDelta {
  const obj = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const hasDx = obj.dx != null && Number.isFinite(Number(obj.dx));
  const hasDy = obj.dy != null && Number.isFinite(Number(obj.dy));
  const clampAxis = (value: unknown): number => {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.max(-SCROLL_DELTA_MAX, Math.min(SCROLL_DELTA_MAX, Math.round(n)));
  };
  const dx = hasDx ? clampAxis(obj.dx) : 0;
  let dy = hasDy ? clampAxis(obj.dy) : 0;
  // Bare scroll() with no delta → a viewport-ish downward nudge so
  // infinite-scroll/lazy content advances.
  if (!hasDx && !hasDy) dy = 600;
  return { dx, dy };
}
