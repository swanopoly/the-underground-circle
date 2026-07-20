// proactiveSurfacingCore — the PURE "what should I bring up right now" decision
// brain. It sits ABOVE the single-item detectors (runStall / runFreshness /
// deadlineSla / approvalDigest) and the render-only chatAttentionQueue: given a
// bounded set of heterogeneous trouble SIGNALS (stalled missions, failed runs,
// overdue tasks, expiring credentials, aging/blocked approvals) plus the current
// chat turn's topic, it decides — deterministically — WHETHER to say anything at
// all, and if so WHICH top-k signals to surface, ranked by a relevance×urgency
// composite and gated by a per-key anti-nag state machine (cooldown → decay →
// retirement).
//
// It answers three questions no existing core answers together:
//   1. IS IT WORTH SPEAKING? — a `speakFloor` on the composite score; below it
//      the turn stays silent (`surface: []`, `note: null`).
//   2. OF THE THINGS WORTH SPEAKING, WHICH FEW? — relevance×urgency ranking with
//      a top-k cap; the overflow is reported as `capped`, never dropped blind.
//   3. HAVE I SAID THIS TOO MUCH? — a persisted `SurfacingMemory` keyed per
//      signal: a just-surfaced key is on `cooldown`, its score `decay`s with
//      each showing, and once it hits `maxShowings` (or the user dismisses it)
//      it is `retired` and never surfaced again.
//
// It composes with — does not duplicate — its neighbours: chatAttentionQueue
// items can be fed in AS candidate signals (blocked_approval); the four
// snapshot-derived trouble kinds are added; then THIS core makes the single
// speak/silent + selection decision none of them make.
//
// PURITY: `import type` only (loads under tsx/esbuild — no react-native /
// supabase / network). Fully DETERMINISTIC: `nowMs` and `turnIndex` are always
// INPUTS — it never reads the clock, never calls Math.random, uses only frozen
// const maps. Every export is TOTAL: null / undefined / wrong-type / cyclic /
// huge / secret-shaped input degrades to a safe bounded default and NEVER
// throws. BOUNDED: exported MAX_* caps, every string clamped, every array
// capped. SECRET-SAFE: user-influenced titles are stripped of control /
// line-separator / prompt-fence chars and any secret-shaped value renders as
// '[hidden]', so a surfaced chip or the prompt note can never leak a credential.

// ─── Signal kinds ────────────────────────────────────────────────────────────

/**
 * The heterogeneous trouble kinds this core ranks across. The first four are
 * derived from `circleContextSnapshot` (missions / recentRuns / tasks /
 * integrations); `blocked_approval` folds in live chatAttentionQueue items.
 */
export type SurfacingSignalKind =
  | 'failed_run'
  | 'expiring_credential'
  | 'blocked_approval'
  | 'overdue_task'
  | 'stalled_mission';

/** Frozen ordered list of every valid kind (used for validation + iteration). */
export const SURFACING_KINDS: readonly SurfacingSignalKind[] = Object.freeze([
  'failed_run',
  'expiring_credential',
  'blocked_approval',
  'overdue_task',
  'stalled_mission',
]);

/**
 * Base severity per kind, in [0,1] — the "how bad is this kind of trouble"
 * prior before any time pressure. A caller may override per-signal via
 * `SurfacingSignal.severity`. Frozen so it can never be mutated at runtime.
 */
export const KIND_SEVERITY: Readonly<Record<SurfacingSignalKind, number>> = Object.freeze({
  failed_run: 0.9,
  expiring_credential: 0.85,
  blocked_approval: 0.8,
  overdue_task: 0.7,
  stalled_mission: 0.6,
});

const KIND_REASON: Readonly<Record<SurfacingSignalKind, string>> = Object.freeze({
  failed_run: 'a run failed and is unresolved',
  expiring_credential: 'a credential is expiring soon',
  blocked_approval: 'an approval is waiting on you',
  overdue_task: 'a task is past its due date',
  stalled_mission: 'a mission has stalled',
});

const KIND_NOTE_WORD: Readonly<Record<SurfacingSignalKind, string>> = Object.freeze({
  failed_run: 'failed',
  expiring_credential: 'credential expiring',
  blocked_approval: 'needs approval',
  overdue_task: 'overdue',
  stalled_mission: 'stalled',
});

// ─── Bounds / tunables (all exported so callers + smokes share the exact caps) ──

/** Upper bound on signals scanned in one turn (hostile input stays bounded). */
export const MAX_SIGNALS = 200;
/** Default top-k surfaced per turn. */
export const DEFAULT_MAX_SURFACE = 3;
/** Hard cap on `maxSurface` no matter what the caller passes. */
export const MAX_SURFACE_CAP = 8;
/** Signals below this composite score never surface (the speak floor). */
export const DEFAULT_SPEAK_FLOOR = 0.55;
/** Turns to wait after surfacing a key before it may surface again. */
export const DEFAULT_COOLDOWN_TURNS = 3;
/** A key surfaced this many times (or dismissed) is retired forever. */
export const DEFAULT_MAX_SHOWINGS = 2;
/**
 * Composite score is multiplied by this per prior showing (anti-nag decay).
 * Tuned against DEFAULT_SPEAK_FLOOR so a high-severity signal survives its
 * second showing (0.9 → 0.63 ≥ floor) but a mid-severity one naturally goes
 * quiet after one (0.6 → 0.42 < floor) — urgent things earn a couple of
 * mentions, minor things at most one, before retirement at maxShowings.
 */
export const DECAY_FACTOR = 0.7;
/** Extra weight a topical (message-relevant) signal earns over its urgency. */
export const TOPICAL_BOOST = 0.35;
/** Time-pressure bonus added to the base severity when a deadline looms/ages. */
export const TIME_BONUS = 0.25;

/** A credential expiring within this window earns rising time pressure (24h). */
export const EXPIRY_HORIZON_MS = 24 * 60 * 60 * 1000;
/** A task/mission that has been in trouble this long earns max time pressure (3d). */
export const STALE_HORIZON_MS = 3 * 24 * 60 * 60 * 1000;

export const MAX_TITLE_LEN = 100;
export const MAX_ID_LEN = 128;
export const MAX_SURFACE_LOC_LEN = 32;
export const MAX_TOPIC_TOKENS = 32;
export const MAX_MESSAGE_LEN = 4000;
export const MAX_NOTE_LEN = 300;
export const MAX_MEMORY_KEYS = 500;
export const MAX_SUPPRESSED = 64;
/** Shortest token that counts for relevance (drops "a", "the", ids too short). */
export const MIN_TOKEN_LEN = 3;
/** Hard ceiling on a stored showing count (defends against poisoned memory). */
export const MAX_SHOWN_COUNT = 1_000_000;

// ─── Public input model ──────────────────────────────────────────────────────

export interface SurfacingSignal {
  /**
   * Stable per-signal key the anti-nag memory is keyed by (e.g.
   * "failed_run:run_abc"). Derived from kind+entity/title when absent.
   */
  key?: string | null;
  kind: SurfacingSignalKind;
  /** Human title of the underlying entity (mission/run/task title, provider). */
  title: string;
  /** Optional deep-link id for the entity (also a strong relevance signal). */
  entityId?: string | null;
  /** Optional home surface for navigation ('feed' | 'office' | 'marketplace'). */
  surface?: string | null;
  /** Epoch ms after which the signal is moot (deadline/expiry already passed). */
  expiresAtMs?: number | null;
  /** Epoch ms the trouble began (past); older → more time pressure. */
  sinceMs?: number | null;
  /** Explicit severity in [0,1] overriding the kind's base. */
  severity?: number | null;
  /** Extra relevance tokens describing the entity (beyond its title). */
  topicTokens?: string[] | null;
}

export interface SurfacingContext {
  /** Monotonic per-thread turn counter (≥0). Cooldown/decay key off this. */
  turnIndex: number;
  /** Epoch ms "now" — for moot (expiry) + time pressure. Injected, never read. */
  nowMs: number;
  /** The current user message (relevance source). Optional. */
  message?: string | null;
  /** Pre-tokenized topic tokens (alternative/supplement to `message`). */
  topicTokens?: string[] | null;
}

export interface SurfacingOptions {
  /** Max signals surfaced this turn (clamped to [0, MAX_SURFACE_CAP]). */
  maxSurface?: number;
  /** Minimum composite score to surface at all (clamped to [0,1]). */
  speakFloor?: number;
  /** Turns before a surfaced key may re-surface (clamped ≥0). */
  cooldownTurns?: number;
  /** Times a key may ever surface before retirement (clamped ≥1). */
  maxShowings?: number;
}

// ─── Persisted anti-nag memory ───────────────────────────────────────────────

export interface SurfacingMemoryEntry {
  /** Times this key has been surfaced to the user. */
  shownCount: number;
  /** turnIndex at which it was last surfaced (−1 = never). */
  lastShownTurn: number;
  /** True once the user dismissed it — never surface again. */
  dismissed: boolean;
}

export interface SurfacingMemory {
  v: 1;
  /** Per-key state, bounded to MAX_MEMORY_KEYS, alphabetical for determinism. */
  entries: Record<string, SurfacingMemoryEntry>;
}

// ─── Public output model ─────────────────────────────────────────────────────

export interface ProactiveSurfacing {
  key: string;
  kind: SurfacingSignalKind;
  /** Bounded, secret-safe display title. */
  title: string;
  entityId: string | null;
  /** Home surface for nav, when known. */
  surface: string | null;
  /** Final composite score used for ranking + floor (post-decay), in [0,1]. */
  score: number;
  /** Urgency component (base severity + time pressure), in [0,1]. */
  urgency: number;
  /** Relevance to the current message, in [0,1] (0 when off-topic). */
  relevance: number;
  /** True when the signal topically matches the current message. */
  topical: boolean;
  /** Short human reason for surfacing. */
  reason: string;
  /** How many times this key was surfaced BEFORE this turn. */
  priorShowings: number;
}

export type SurfacingSuppressionReason = 'cooldown' | 'retired' | 'moot' | 'below_floor' | 'capped';

export interface SuppressedSurfacing {
  key: string;
  kind: SurfacingSignalKind;
  reason: SurfacingSuppressionReason;
  /** The composite score it would have had (0 for moot/retired). */
  score: number;
}

export interface ProactiveSurfacingDecision {
  /** The chosen signals to surface, best-first, bounded by maxSurface. */
  surface: ProactiveSurfacing[];
  /** Every considered-but-not-surfaced signal with its reason (bounded). */
  suppressed: SuppressedSurfacing[];
  /** One optional bounded prompt-tail line; null when nothing to say. */
  note: string | null;
  /** Memory to persist for next turn (deterministic, bounded). */
  nextMemory: SurfacingMemory;
}

// ─── Numeric guards ──────────────────────────────────────────────────────────

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function round4(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10000) / 10000;
}

// ─── Secret-safe text handling ───────────────────────────────────────────────
// Local copies of the canonical secret-shape guards (kept dependency-free so
// this module loads under tsx). Order matters: mask the most specific shapes
// first so a JWT/GitHub token is not half-eaten by the generic long-run pass.

const BEARER_RE = /\bbearer\s+[A-Za-z0-9._~+/=-]{6,}/gi;
const JWT_RE = /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/g;
const GITHUB_TOKEN_RE = /\bgh[opusr]_[A-Za-z0-9]{16,}/g;
const SLACK_TOKEN_RE = /\bxox[baprs]-[A-Za-z0-9-]{8,}/g;
const AWS_KEY_RE = /\bAKIA[A-Z0-9]{12,}/g;
const KEY_PREFIX_RE = /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{6,}/g;
const PEM_RE = /-----BEGIN[A-Z0-9 ]*PRIVATE KEY-----/g;
// Generic long opaque run (≥28 spaceless base64/hex-ish chars) — a title word
// is never this long; a token frequently is. Runs LAST among the maskers.
const LONG_TOKEN_RE = /[A-Za-z0-9+/_=-]{28,}/g;

// Control chars (C0 + DEL + C1), U+2028/U+2029 line/para separators, and the
// prompt-fence chars we never want smuggled into a chip or the note.
const CONTROL_RE = /[\x00-\x1f\x7f-\x9f\u2028\u2029]/g;
const FENCE_RE = /[<>`]/g;

const HIDDEN = '[hidden]';

/** Does the whole (already control-stripped) string look like a secret VALUE? */
function looksLikeSecretValue(text: string): boolean {
  if (!text) return false;
  // A long spaceless blob is a value, never a human title.
  if (text.length > 40 && !/\s/.test(text)) return true;
  if (/eyJ[A-Za-z0-9_-]{8,}/.test(text)) return true; // JWT-ish
  if (/\b[A-Fa-f0-9]{32,}\b/.test(text)) return true; // long hex digest
  if (/[A-Za-z0-9+/]{40,}={0,2}/.test(text)) return true; // long base64 run
  if (/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}/.test(text)) return true; // sk-ant-… style
  if (/\bgh[pousr]_[A-Za-z0-9]{16,}/.test(text)) return true; // GitHub token
  if (/\bxox[bpsae]-[A-Za-z0-9-]{10,}/.test(text)) return true; // Slack token
  if (/\bAKIA[A-Z0-9]{12,}/.test(text)) return true; // AWS access key id
  if (/-----BEGIN[A-Z0-9 ]*PRIVATE KEY-----/.test(text)) return true; // PEM
  return false;
}

/**
 * Coerce any input to a safe, bounded, secret-free display string. Non-strings
 * become ''. Control / line-sep / fence chars are stripped; secret-shaped
 * substrings are masked to '[hidden]'; a wholly secret-shaped value becomes
 * '[hidden]'. Deterministic, never throws.
 */
function sanitizeText(raw: unknown, max: number): string {
  let s: string;
  try {
    s = typeof raw === 'string' ? raw : raw == null ? '' : String(raw);
  } catch {
    return '';
  }
  if (!s) return '';
  // Strip structure-forging chars first so they can't split a token past a masker.
  s = s.replace(CONTROL_RE, ' ').replace(FENCE_RE, ' ');
  // Mask secrets most-specific-first, generic last.
  s = s
    .replace(BEARER_RE, HIDDEN)
    .replace(JWT_RE, HIDDEN)
    .replace(GITHUB_TOKEN_RE, HIDDEN)
    .replace(SLACK_TOKEN_RE, HIDDEN)
    .replace(AWS_KEY_RE, HIDDEN)
    .replace(KEY_PREFIX_RE, HIDDEN)
    .replace(PEM_RE, HIDDEN)
    .replace(LONG_TOKEN_RE, HIDDEN);
  s = s.replace(/\s{2,}/g, ' ').trim();
  if (!s) return '';
  if (looksLikeSecretValue(s)) return HIDDEN;
  const limit = Number.isFinite(max) && max > 0 ? Math.floor(max) : MAX_TITLE_LEN;
  if (s.length <= limit) return s;
  if (limit <= 1) return s.slice(0, limit);
  return `${s.slice(0, limit - 1).trimEnd()}…`;
}

/** A safe id: control/fence-stripped, spaceless, clamped, secret-shaped → null. */
function sanitizeId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(CONTROL_RE, '').replace(FENCE_RE, '').trim();
  if (!cleaned || /\s/.test(cleaned)) return null;
  if (looksLikeSecretValue(cleaned)) return null;
  return cleaned.length > MAX_ID_LEN ? cleaned.slice(0, MAX_ID_LEN) : cleaned;
}

// ─── Tokenization + relevance ────────────────────────────────────────────────

function tokenize(text: string, cap: number): string[] {
  const lowered = text.toLowerCase();
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of lowered.split(/[^a-z0-9_]+/)) {
    if (t.length < MIN_TOKEN_LEN) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= cap) break;
  }
  return out;
}

interface TopicContext {
  tokens: Set<string>;
  lower: string;
}

function buildTopicContext(context: SurfacingContext): TopicContext {
  const parts: string[] = [];
  const msg = sanitizeText(context?.message, MAX_MESSAGE_LEN);
  if (msg && msg !== HIDDEN) parts.push(msg);
  const extra = Array.isArray(context?.topicTokens) ? context.topicTokens : [];
  for (const tok of extra.slice(0, MAX_TOPIC_TOKENS)) {
    const clean = sanitizeText(tok, 48);
    if (clean && clean !== HIDDEN) parts.push(clean);
  }
  const combined = parts.join(' ');
  return { tokens: new Set(tokenize(combined, 256)), lower: combined.toLowerCase() };
}

/** Relevance of a signal to the turn's topic. 0 (off-topic) → 1 (id/full match). */
function computeRelevance(
  topic: TopicContext,
  signalTokens: string[],
  entityId: string | null,
): { relevance: number; topical: boolean } {
  if (topic.tokens.size === 0) return { relevance: 0, topical: false };
  // A distinctive entity-id mention is the strongest possible signal.
  if (entityId && entityId.length >= 4 && topic.lower.includes(entityId.toLowerCase())) {
    return { relevance: 1, topical: true };
  }
  if (signalTokens.length === 0) return { relevance: 0, topical: false };
  let overlap = 0;
  for (const t of signalTokens) if (topic.tokens.has(t)) overlap += 1;
  if (overlap === 0) return { relevance: 0, topical: false };
  const coverage = overlap / signalTokens.length;
  return { relevance: clamp01(0.5 + 0.5 * coverage), topical: true };
}

// ─── Urgency ─────────────────────────────────────────────────────────────────

/** Time pressure in [0,1] from whatever time fields are present (max of them). */
function timePressure(signal: NormalizedSignal, nowMs: number): number {
  let pressure = 0;
  if (signal.expiresAtMs !== null && signal.expiresAtMs > nowMs) {
    const soonness = 1 - (signal.expiresAtMs - nowMs) / EXPIRY_HORIZON_MS;
    pressure = Math.max(pressure, clamp01(soonness));
  }
  if (signal.sinceMs !== null && signal.sinceMs < nowMs) {
    const ageness = (nowMs - signal.sinceMs) / STALE_HORIZON_MS;
    pressure = Math.max(pressure, clamp01(ageness));
  }
  return pressure;
}

function computeUrgency(signal: NormalizedSignal, nowMs: number): number {
  const base = signal.severity !== null ? clamp01(signal.severity) : KIND_SEVERITY[signal.kind];
  return clamp01(base + TIME_BONUS * timePressure(signal, nowMs));
}

// ─── Signal normalization ────────────────────────────────────────────────────

interface NormalizedSignal {
  key: string;
  kind: SurfacingSignalKind;
  title: string;
  entityId: string | null;
  surface: string | null;
  expiresAtMs: number | null;
  sinceMs: number | null;
  severity: number | null;
  tokens: string[];
}

function readField(obj: Record<string, unknown>, field: string): unknown {
  try {
    return obj[field];
  } catch {
    return undefined; // throwing getter → treat as absent
  }
}

function isValidKind(value: unknown): value is SurfacingSignalKind {
  return typeof value === 'string' && (SURFACING_KINDS as readonly string[]).includes(value);
}

/** Short alnum slug of a title for key derivation when no id/key is given. */
function slug(title: string): string {
  const s = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s.slice(0, 32);
}

function normalizeSignal(raw: unknown, index: number): NormalizedSignal | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const kind = readField(obj, 'kind');
  if (!isValidKind(kind)) return null; // no valid kind ⇒ cannot rank or key it

  const title = sanitizeText(readField(obj, 'title'), MAX_TITLE_LEN) || `(untitled ${kind})`;
  const entityId = sanitizeId(readField(obj, 'entityId'));
  const surfaceRaw = sanitizeText(readField(obj, 'surface'), MAX_SURFACE_LOC_LEN);
  const surface = surfaceRaw && surfaceRaw !== HIDDEN ? surfaceRaw : null;

  const rawKey = readField(obj, 'key');
  const keyClean = typeof rawKey === 'string' ? sanitizeId(rawKey) : null;
  const key = keyClean || `${kind}:${entityId || slug(title) || `idx${index}`}`;

  const expiresRaw = readField(obj, 'expiresAtMs');
  const expiresAtMs = typeof expiresRaw === 'number' && Number.isFinite(expiresRaw) ? expiresRaw : null;
  const sinceRaw = readField(obj, 'sinceMs');
  const sinceMs = typeof sinceRaw === 'number' && Number.isFinite(sinceRaw) ? sinceRaw : null;
  const sevRaw = readField(obj, 'severity');
  const severity = typeof sevRaw === 'number' && Number.isFinite(sevRaw) ? clamp01(sevRaw) : null;

  const extraTokens = Array.isArray(readField(obj, 'topicTokens')) ? (obj.topicTokens as unknown[]) : [];
  const tokenSource = [title, ...extraTokens.slice(0, MAX_TOPIC_TOKENS).map((t) => sanitizeText(t, 48))].join(' ');
  const tokens = tokenize(tokenSource, MAX_TOPIC_TOKENS);

  return { key, kind, title, entityId, surface, expiresAtMs, sinceMs, severity, tokens };
}

// ─── Memory helpers ──────────────────────────────────────────────────────────

/** A fresh, empty anti-nag memory. */
export function emptySurfacingMemory(): SurfacingMemory {
  return { v: 1, entries: {} };
}

function normalizeEntry(raw: unknown): SurfacingMemoryEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  let shownCount = Math.floor(finiteOr(readSafe(obj, 'shownCount'), 0));
  if (shownCount < 0) shownCount = 0;
  if (shownCount > MAX_SHOWN_COUNT) shownCount = MAX_SHOWN_COUNT;
  const lastShownTurn = Math.floor(finiteOr(readSafe(obj, 'lastShownTurn'), -1));
  const dismissed = readSafe(obj, 'dismissed') === true;
  return { shownCount, lastShownTurn, dismissed };
}

function readSafe(obj: Record<string, unknown>, field: string): unknown {
  try {
    return obj[field];
  } catch {
    return undefined;
  }
}

/** Validate + bound an untrusted memory object. Never throws. */
function normalizeMemory(raw: unknown): SurfacingMemory {
  const out = emptySurfacingMemory();
  if (!raw || typeof raw !== 'object') return out;
  const entries = readSafe(raw as Record<string, unknown>, 'entries');
  if (!entries || typeof entries !== 'object') return out;
  const acc: Record<string, SurfacingMemoryEntry> = {};
  let count = 0;
  // Enumerate eagerly + guarded: an exotic `entries` (e.g. a Proxy whose ownKeys
  // trap throws) must degrade to the empty default, never escape this "never
  // throws" helper — readSafe guards per-property GETs but not the enumeration.
  let keys: string[];
  try {
    keys = Object.keys(entries as Record<string, unknown>);
  } catch {
    return out;
  }
  for (const key of keys) {
    if (count >= MAX_MEMORY_KEYS) break;
    const cleanKey = sanitizeId(key);
    if (!cleanKey) continue;
    const entry = normalizeEntry(readSafe(entries as Record<string, unknown>, key));
    if (!entry) continue;
    acc[cleanKey] = entry;
    count += 1;
  }
  return { v: 1, entries: acc };
}

/** Deterministic prune + alphabetical rebuild of a memory's entries. */
function finalizeMemory(entries: Map<string, SurfacingMemoryEntry>): SurfacingMemory {
  let keys = Array.from(entries.keys());
  if (keys.length > MAX_MEMORY_KEYS) {
    // Keep the most-recently-shown keys; deterministic tiebreak by key.
    keys.sort((a, b) => {
      const ea = entries.get(a)!;
      const eb = entries.get(b)!;
      if (eb.lastShownTurn !== ea.lastShownTurn) return eb.lastShownTurn - ea.lastShownTurn;
      return a < b ? -1 : a > b ? 1 : 0;
    });
    keys = keys.slice(0, MAX_MEMORY_KEYS);
  }
  keys.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const out: Record<string, SurfacingMemoryEntry> = {};
  for (const k of keys) out[k] = entries.get(k)!;
  return { v: 1, entries: out };
}

function isRetired(entry: SurfacingMemoryEntry | undefined, maxShowings: number): boolean {
  if (!entry) return false;
  return entry.dismissed || entry.shownCount >= maxShowings;
}

/**
 * Record that the user dismissed a surfaced key — the pure state transition the
 * chat chip's dismiss action performs. Returns a NEW memory (input untouched);
 * an unknown key is created as dismissed so it can never re-surface.
 */
export function markSurfacingDismissed(memory: unknown, key: unknown): SurfacingMemory {
  const mem = normalizeMemory(memory);
  const cleanKey = sanitizeId(key);
  if (!cleanKey) return mem;
  const map = new Map(Object.entries(mem.entries));
  const prior = map.get(cleanKey);
  map.set(cleanKey, {
    shownCount: prior ? prior.shownCount : 0,
    lastShownTurn: prior ? prior.lastShownTurn : -1,
    dismissed: true,
  });
  return finalizeMemory(map);
}

/** Derive the canonical anti-nag key for a signal (mirror of internal keying). */
export function surfacingSignalKey(kind: unknown, entityId: unknown): string {
  const k = isValidKind(kind) ? kind : 'signal';
  const id = sanitizeId(entityId);
  return `${k}:${id || 'unknown'}`;
}

// ─── Note assembly ───────────────────────────────────────────────────────────

function buildNote(surfaced: ProactiveSurfacing[]): string | null {
  if (surfaced.length === 0) return null;
  const parts = surfaced.map((s) => `${s.title} ${KIND_NOTE_WORD[s.kind]}`);
  const body = `Worth surfacing: ${parts.join('; ')}.`;
  const clean = sanitizeText(body, MAX_NOTE_LEN);
  return clean || null;
}

// ─── The decision ────────────────────────────────────────────────────────────

/**
 * Decide, deterministically, what (if anything) to proactively surface this
 * turn. Ranks candidate signals by a relevance×urgency composite, applies the
 * per-key anti-nag state machine (moot → retired → cooldown → decay → floor →
 * top-k cap), and returns the chosen `surface[]`, a bounded `suppressed[]` with
 * reasons, an optional one-line `note`, and the `nextMemory` to persist.
 *
 * TOTAL: any hostile/degenerate input yields a valid empty-ish decision with a
 * safe carried-forward memory, never a throw.
 */
export function selectProactiveSurfacings(
  signalsRaw: unknown,
  contextRaw: unknown,
  memoryRaw?: unknown,
  optsRaw?: unknown,
): ProactiveSurfacingDecision {
  const priorMemory = normalizeMemory(memoryRaw);
  try {
    const ctxObj = (contextRaw && typeof contextRaw === 'object' ? contextRaw : {}) as Partial<SurfacingContext>;
    const context: SurfacingContext = {
      turnIndex: Math.max(0, Math.floor(finiteOr(ctxObj.turnIndex, 0))),
      nowMs: finiteOr(ctxObj.nowMs, 0),
      message: typeof ctxObj.message === 'string' ? ctxObj.message : null,
      topicTokens: Array.isArray(ctxObj.topicTokens) ? ctxObj.topicTokens : null,
    };

    const optsObj = (optsRaw && typeof optsRaw === 'object' ? optsRaw : {}) as Partial<SurfacingOptions>;
    const maxSurface = Math.min(
      MAX_SURFACE_CAP,
      Math.max(0, Math.floor(finiteOr(optsObj.maxSurface, DEFAULT_MAX_SURFACE))),
    );
    const speakFloor = clamp01(finiteOr(optsObj.speakFloor, DEFAULT_SPEAK_FLOOR));
    const cooldownTurns = Math.max(0, Math.floor(finiteOr(optsObj.cooldownTurns, DEFAULT_COOLDOWN_TURNS)));
    const maxShowings = Math.max(1, Math.floor(finiteOr(optsObj.maxShowings, DEFAULT_MAX_SHOWINGS)));

    const topic = buildTopicContext(context);

    const signals = Array.isArray(signalsRaw) ? signalsRaw.slice(0, MAX_SIGNALS) : [];
    const seenKeys = new Set<string>();

    interface Candidate {
      signal: NormalizedSignal;
      urgency: number;
      relevance: number;
      topical: boolean;
      score: number; // post-decay composite
      priorShowings: number;
    }
    const eligible: Candidate[] = [];
    const suppressed: SuppressedSurfacing[] = [];

    for (let i = 0; i < signals.length; i += 1) {
      const signal = normalizeSignal(signals[i], i);
      if (!signal) continue;
      if (seenKeys.has(signal.key)) continue; // dedupe by key, keep first
      seenKeys.add(signal.key);

      const entry = priorMemory.entries[signal.key];

      // Hard stops (report the most objective reason first).
      if (signal.expiresAtMs !== null && signal.expiresAtMs <= context.nowMs) {
        suppressed.push({ key: signal.key, kind: signal.kind, reason: 'moot', score: 0 });
        continue;
      }
      if (isRetired(entry, maxShowings)) {
        suppressed.push({ key: signal.key, kind: signal.kind, reason: 'retired', score: 0 });
        continue;
      }

      const urgency = computeUrgency(signal, context.nowMs);
      const { relevance, topical } = computeRelevance(topic, signal.tokens, signal.entityId);
      const base = clamp01(urgency + TOPICAL_BOOST * relevance * urgency);
      const priorShowings = entry ? entry.shownCount : 0;
      const score = clamp01(base * Math.pow(DECAY_FACTOR, priorShowings));

      // Cooldown: a previously-shown key waits `cooldownTurns` before returning.
      if (entry && entry.shownCount > 0 && entry.lastShownTurn >= 0 && context.turnIndex - entry.lastShownTurn < cooldownTurns) {
        suppressed.push({ key: signal.key, kind: signal.kind, reason: 'cooldown', score: round4(score) });
        continue;
      }
      if (score < speakFloor) {
        suppressed.push({ key: signal.key, kind: signal.kind, reason: 'below_floor', score: round4(score) });
        continue;
      }

      eligible.push({ signal, urgency, relevance, topical, score, priorShowings });
    }

    // Rank: score desc → urgency desc → topical first → key asc (deterministic).
    eligible.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.urgency !== a.urgency) return b.urgency - a.urgency;
      if (a.topical !== b.topical) return a.topical ? -1 : 1;
      return a.signal.key < b.signal.key ? -1 : a.signal.key > b.signal.key ? 1 : 0;
    });

    const chosen = eligible.slice(0, maxSurface);
    for (const c of eligible.slice(maxSurface)) {
      suppressed.push({ key: c.signal.key, kind: c.signal.kind, reason: 'capped', score: round4(c.score) });
    }

    const surface: ProactiveSurfacing[] = chosen.map((c) => ({
      key: c.signal.key,
      kind: c.signal.kind,
      title: c.signal.title,
      entityId: c.signal.entityId,
      surface: c.signal.surface,
      score: round4(c.score),
      urgency: round4(c.urgency),
      relevance: round4(c.relevance),
      topical: c.topical,
      reason: KIND_REASON[c.signal.kind],
      priorShowings: c.priorShowings,
    }));

    // Build nextMemory: carry every prior entry, bump the surfaced keys.
    const memMap = new Map<string, SurfacingMemoryEntry>(Object.entries(priorMemory.entries));
    for (const c of chosen) {
      const prior = memMap.get(c.signal.key);
      memMap.set(c.signal.key, {
        shownCount: Math.min(MAX_SHOWN_COUNT, (prior ? prior.shownCount : 0) + 1),
        lastShownTurn: context.turnIndex,
        dismissed: prior ? prior.dismissed : false,
      });
    }

    // Deterministic, bounded suppressed list (score desc → key asc).
    suppressed.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    });

    return {
      surface,
      suppressed: suppressed.slice(0, MAX_SUPPRESSED),
      note: buildNote(surface),
      nextMemory: finalizeMemory(memMap),
    };
  } catch {
    // Last-resort totality: valid empty decision, memory preserved.
    return {
      surface: [],
      suppressed: [],
      note: null,
      nextMemory: finalizeMemory(new Map(Object.entries(priorMemory.entries))),
    };
  }
}
