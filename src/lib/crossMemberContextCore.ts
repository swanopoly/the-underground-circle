// crossMemberContextCore -- the PURE "which teammate facts bear on ME right now"
// selector. Given the acting member + the turn's focus scopes (the mission /
// room / task this thread is about), it derives the member-RELATIVE
// collaboration slice from a bounded stream of team activity: who is running
// something in-flight on my work, who owns a task I'm looking at, who recently
// produced proof I can reuse, who else is collaborating on my mission/room.
//
// It is the PRODUCER of a neutral, different fact family than its neighbours:
//   - circleContextSnapshot.ts is a FLAT per-circle index (not member-relative,
//     no self-exclusion, no focus-overlap derivation) -- this core CONSUMES the
//     same kind of rows PLUS "who am I" + "what am I looking at" to compute the
//     relative slice the snapshot cannot express.
//   - proactiveSurfacingCore.ts ranks a CLOSED trouble enum it takes as INPUT;
//     it does not model teammate/focus overlap. This core could later FEED it,
//     but the derivation is the value and lives nowhere else.
//
// PURITY: ZERO runtime imports -- `import type` only, so it loads under
// tsx/esbuild (no react-native / supabase / network). DETERMINISTIC: the caller
// injects `nowMs`; it never reads the clock, never calls Math.random / argless
// `new Date`, and uses only frozen const maps keyed by the module's OWN enums.
// Untrusted ids live solely in string Sets / Maps and equality -- never as plain
// object-map keys -- so there is no constructor/__proto__ lookup hazard. TOTAL:
// null / undefined / wrong-type / huge / cyclic / throwing-getter / secret-shaped
// input degrades to a safe bounded default and NEVER throws. BOUNDED: every
// exported MAX_* caps the work and every emitted string. SECRET-SAFE: member
// names / titles pass a local sanitize (control / line-sep / prompt-fence /
// Unicode-Tag / lone-surrogate stripped by numeric code-point checks,
// code-point-aware clamp) and a secret-value guard (-> '[hidden]'), and the
// rendered block wraps them in a single <untrusted_quoted> fence with the
// trusted header OUTSIDE it.

// --- Public model ------------------------------------------------------------

export type CrossMemberScopeKind = 'mission' | 'room' | 'task';

export type CrossMemberFactKind =
  | 'in_flight_overlap'
  | 'ownership'
  | 'recent_proof'
  | 'co_working';

export interface CrossMemberFocusScope {
  kind: CrossMemberScopeKind;
  id: string;
  title?: string;
}

export interface CrossMemberFocus {
  /** The member whose turn this is; their own activity is excluded. */
  actingMemberId: string;
  /** The mission/room/task scopes this thread is about (bounded). */
  scopes: CrossMemberFocusScope[];
}

export interface CrossMemberActivityItem {
  memberId: string;
  memberName?: string;
  kind: 'assignment' | 'active_run' | 'finished_run';
  missionId?: string;
  roomId?: string;
  taskId?: string;
  title?: string;
  status?: string;
  /** Epoch ms the activity happened (assignment/run start, finish time). */
  atMs?: number;
}

export interface CrossMemberFact {
  kind: CrossMemberFactKind;
  memberId: string;
  /** Bounded, secret-safe display name (falls back to a neutral label). */
  memberName: string;
  scopeKind: CrossMemberScopeKind;
  scopeId: string;
  /** Sanitized focus-scope title ('' when the focus scope carried none). */
  scopeTitle: string;
  /** Sanitized activity-item title ('' when absent). */
  itemTitle: string;
  /** Sanitized status ('' when absent). */
  status: string;
  /** Ranking composite in [0,1] (round4). */
  score: number;
  /** nowMs minus atMs when a valid atMs was present, else null. */
  ageMs: number | null;
  /** Bounded, secret-safe one-line summary (also the block body line). */
  note: string;
}

export interface CrossMemberContextCounts {
  inFlightOverlap: number;
  ownership: number;
  recentProof: number;
  coWorking: number;
  /** Distinct teammates across the pre-cap deduped facts. */
  teammates: number;
}

export interface CrossMemberContextResult {
  facts: CrossMemberFact[];
  counts: CrossMemberContextCounts;
  /** Precomputed prompt block, or null when there are no facts. */
  block: string | null;
}

export interface CrossMemberContextOptions {
  /** Injected "now"; deterministic -- the core never reads the clock. */
  nowMs?: number;
  /** Max facts returned (clamped to [0, MAX_FACTS]). */
  maxFacts?: number;
  /** Fairness cap: max facts per teammate (clamped to [1, MAX_FACTS]). */
  maxPerTeammate?: number;
  /** Finished runs older than this are stale prior art and dropped. */
  recentProofHorizonMs?: number;
}

// --- Bounds / tunables (exported so callers + smokes share the exact caps) ----

/** Upper bound on activity items scanned in one turn. */
export const MAX_ACTIVITY_SCANNED = 400;
/** Upper bound on focus scopes considered. */
export const MAX_FOCUS_SCOPES = 40;
/** Hard ceiling on emitted facts regardless of caller opts. */
export const MAX_FACTS = 10;
/** Default emitted-fact cap. */
export const DEFAULT_MAX_FACTS = 6;
/** Default per-teammate fairness cap. */
export const DEFAULT_MAX_PER_TEAMMATE = 2;
/** Default recent-proof horizon (24h). */
export const DEFAULT_RECENT_PROOF_HORIZON_MS = 86_400_000;

export const MAX_TITLE_LEN = 100;
export const MAX_NAME_LEN = 60;
export const MAX_ID_LEN = 128;
export const MAX_STATUS_LEN = 40;
export const MAX_NOTE_LEN = 200;
/** Hard cap on the assembled prompt block. */
export const MAX_BLOCK_CHARS = 2500;

/** Neutral display name when an item carried no usable name. */
const DEFAULT_MEMBER_NAME = 'A teammate';

/** Base severity per fact kind (the "how relevant to me" prior). Frozen. */
export const KIND_SEVERITY: Readonly<Record<CrossMemberFactKind, number>> = Object.freeze({
  in_flight_overlap: 0.9,
  ownership: 0.8,
  recent_proof: 0.7,
  co_working: 0.55,
});

/** Bonus for a narrower focus overlap (task beats room beats mission). Frozen. */
export const SCOPE_SPECIFICITY_BONUS: Readonly<Record<CrossMemberScopeKind, number>> = Object.freeze({
  task: 0.1,
  room: 0.05,
  mission: 0,
});

/** Tie-break priority per kind (lower = ranked first). Frozen. */
const KIND_PRIORITY: Readonly<Record<CrossMemberFactKind, number>> = Object.freeze({
  in_flight_overlap: 0,
  ownership: 1,
  recent_proof: 2,
  co_working: 3,
});

/** Fixed scope nouns for note rendering. Frozen, keyed by our own enum. */
const SCOPE_NOUN: Readonly<Record<CrossMemberScopeKind, string>> = Object.freeze({
  mission: 'mission',
  room: 'room',
  task: 'task',
});

/** Ordered lists of valid enum values (validation + smoke iteration). */
export const FACT_KINDS: readonly CrossMemberFactKind[] = Object.freeze([
  'in_flight_overlap',
  'ownership',
  'recent_proof',
  'co_working',
]);
export const SCOPE_KINDS: readonly CrossMemberScopeKind[] = Object.freeze([
  'mission',
  'room',
  'task',
]);

/** Max recency bonus, and the age over which it decays to zero. */
const RECENCY_BONUS_MAX = 0.1;
const RECENCY_BONUS_HORIZON_MS = 7 * 86_400_000; // 7 days

// Dedupe-key field separator: a C0 control char that sanitized ids/kinds can
// never contain (scrubChars strips all C0/C1 controls), so composite keys can
// never collide. Built from a code point -- never a raw literal.
const SEP = String.fromCharCode(0x1f);
/** The ellipsis appended by the code-point clamp. Built from a code point. */
const ELLIPSIS = String.fromCharCode(0x2026);

const HIDDEN = '[hidden]';

// --- Numeric guards ----------------------------------------------------------

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clampInt(value: unknown, fallback: number, lo: number, hi: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.max(lo, Math.min(hi, n));
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

/** Guarded field read -- a throwing getter is treated as absent. */
function readField(obj: unknown, field: string): unknown {
  try {
    return (obj as Record<string, unknown>)[field];
  } catch {
    return undefined;
  }
}

// --- Secret-safe text handling -----------------------------------------------
// Local, dependency-free copies of the canonical secret-shape guards (so this
// module loads under tsx). Character stripping is done by NUMERIC code-point
// checks -- no raw control chars or line separators ever appear in a literal.

/**
 * Single code-point pass that removes every structure-forging / invisible /
 * exotic char, using only numeric range checks:
 *   - lone surrogates and Unicode Tag chars (U+E0000..E007F) -> dropped;
 *   - C0 controls, DEL, C1, and U+2028/U+2029 line/para separators -> a space
 *     (text) or dropped (ids), per `controlsToSpace`;
 *   - prompt-fence chars '<' '>' backtick -> a space (text) or dropped (ids);
 *   - zero-width / word-joiner / BOM / bidi override + isolate format chars
 *     -> dropped.
 * Iterates by code point (for..of), so surrogate pairs are never split.
 */
function scrubChars(s: string, controlsToSpace: boolean): string {
  let out = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0) as number;
    // Lone surrogate (a single unbalanced UTF-16 unit) -> drop.
    if (ch.length === 1 && cp >= 0xd800 && cp <= 0xdfff) continue;
    // Unicode Tag block (astral) -> drop.
    if (cp >= 0xe0000 && cp <= 0xe007f) continue;
    // C0 controls, DEL/C1, line/para separators.
    if (cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f) || cp === 0x2028 || cp === 0x2029) {
      if (controlsToSpace) out += ' ';
      continue;
    }
    // Prompt-fence chars: '<' (0x3c), '>' (0x3e), backtick (0x60).
    if (cp === 0x3c || cp === 0x3e || cp === 0x60) {
      if (controlsToSpace) out += ' ';
      continue;
    }
    // ARABIC LETTER MARK (061c), zero-width (200b-200f), word joiner (2060), BOM
    // (feff), bidi overrides (202a-202e), bidi isolates (2066-2069) -> drop. 061c is
    // a bidi-control sibling of LRM/RLM (200e/200f); strip it for the same reason.
    if (
      cp === 0x061c ||
      (cp >= 0x200b && cp <= 0x200f) ||
      cp === 0x2060 ||
      cp === 0xfeff ||
      (cp >= 0x202a && cp <= 0x202e) ||
      (cp >= 0x2066 && cp <= 0x2069)
    ) {
      continue;
    }
    out += ch;
  }
  return out;
}

// Secret maskers, most-specific first, generic long-run last. All patterns are
// printable ASCII -- safe as regex literals.
const BEARER_RE = /\bbearer\s+[A-Za-z0-9._~+/=-]{6,}/gi;
const JWT_RE = /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/g;
const GITHUB_TOKEN_RE = /\bgh[opusr]_[A-Za-z0-9]{16,}/g;
const SLACK_TOKEN_RE = /\bxox[baprs]-[A-Za-z0-9-]{8,}/g;
const AWS_KEY_RE = /\bAKIA[A-Z0-9]{12,}/g;
const KEY_PREFIX_RE = /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{6,}/g;
const PEM_RE = /-----BEGIN[A-Z0-9 ]*PRIVATE KEY-----/g;
const LONG_TOKEN_RE = /[A-Za-z0-9+/_=-]{28,}/g;

/** Does the whole (already control-stripped) string look like a secret VALUE? */
function looksLikeSecretValue(text: string): boolean {
  if (!text) return false;
  if (text.length > 40 && !/\s/.test(text)) return true; // long spaceless blob
  if (/eyJ[A-Za-z0-9_-]{8,}/.test(text)) return true; // JWT-ish
  if (/\b[A-Fa-f0-9]{32,}\b/.test(text)) return true; // long hex digest
  if (/[A-Za-z0-9+/]{40,}={0,2}/.test(text)) return true; // long base64 run
  if (/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}/.test(text)) return true; // sk-prefixed key
  if (/\bgh[pousr]_[A-Za-z0-9]{16,}/.test(text)) return true; // GitHub token
  if (/\bxox[bpsae]-[A-Za-z0-9-]{10,}/.test(text)) return true; // Slack token
  if (/\bAKIA[A-Z0-9]{12,}/.test(text)) return true; // AWS access key id
  if (/-----BEGIN[A-Z0-9 ]*PRIVATE KEY-----/.test(text)) return true; // PEM
  return false;
}

function maskSecrets(s: string): string {
  return s
    .replace(BEARER_RE, HIDDEN)
    .replace(JWT_RE, HIDDEN)
    .replace(GITHUB_TOKEN_RE, HIDDEN)
    .replace(SLACK_TOKEN_RE, HIDDEN)
    .replace(AWS_KEY_RE, HIDDEN)
    .replace(KEY_PREFIX_RE, HIDDEN)
    .replace(PEM_RE, HIDDEN)
    .replace(LONG_TOKEN_RE, HIDDEN);
}

/**
 * Code-point-aware clamp that also keeps the emitted UTF-16 `.length` within
 * `max`: it accumulates whole code points (never splitting a surrogate pair)
 * until adding the next unit would exceed the budget, then appends an ellipsis.
 * Result `.length` <= max (so `Array.from(result).length` <= max too).
 */
function clampUnits(s: string, max: number): string {
  const limit = Number.isFinite(max) && max > 0 ? Math.floor(max) : MAX_TITLE_LEN;
  if (s.length <= limit) return s;
  if (limit <= 1) {
    for (const ch of s) return ch.length <= limit ? ch : '';
    return '';
  }
  const budget = limit - 1; // reserve one UTF-16 unit for the ellipsis
  let out = '';
  for (const ch of s) {
    if (out.length + ch.length > budget) break;
    out += ch;
  }
  return `${out.replace(/\s+$/u, '')}${ELLIPSIS}`;
}

/**
 * Coerce any input to a safe, bounded, secret-free display string. Non-strings
 * become '' (or a coerced form for numbers/bigints). Structural / invisible /
 * exotic code points are removed, secret-shaped substrings masked, and a wholly
 * secret-shaped value becomes '[hidden]'. Deterministic; never throws.
 */
function sanitizeText(raw: unknown, max: number): string {
  let s: string;
  try {
    s = typeof raw === 'string' ? raw : raw == null ? '' : String(raw);
  } catch {
    return '';
  }
  if (!s) return '';
  s = scrubChars(s, true);
  s = maskSecrets(s);
  s = s.replace(/\s{2,}/g, ' ').trim();
  if (!s) return '';
  if (looksLikeSecretValue(s)) return HIDDEN;
  return clampUnits(s, max);
}

/**
 * A safe id: structural / invisible / exotic chars removed, must be non-empty
 * and spaceless, secret-shaped -> null, clamped to MAX_ID_LEN. Non-strings ->
 * null (ids are strings; numeric ids are intentionally rejected fail-closed).
 */
function sanitizeId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = scrubChars(raw, false).trim();
  if (!s || /\s/.test(s)) return null;
  if (looksLikeSecretValue(s)) return null;
  return s.length > MAX_ID_LEN ? s.slice(0, MAX_ID_LEN) : s;
}

// --- Scoring -----------------------------------------------------------------

function recencyBonus(ageMs: number | null): number {
  if (ageMs === null) return 0;
  if (ageMs <= 0) return RECENCY_BONUS_MAX; // now / future -> freshest
  return RECENCY_BONUS_MAX * clamp01(1 - ageMs / RECENCY_BONUS_HORIZON_MS);
}

// --- Note rendering ----------------------------------------------------------

function buildNote(
  kind: CrossMemberFactKind,
  name: string,
  scopeKind: CrossMemberScopeKind,
  scopeTitle: string,
  itemTitle: string,
  status: string,
): string {
  // scopeKind / kind are our OWN validated literals -- never untrusted keys.
  const noun = SCOPE_NOUN[scopeKind];
  const where = scopeTitle ? `${noun} "${scopeTitle}"` : `a shared ${noun}`;
  const item = itemTitle ? ` "${itemTitle}"` : '';
  const dash = item ? ` -${item}` : '';
  let core: string;
  switch (kind) {
    case 'in_flight_overlap':
      core = `${name} has an active run in ${where}${dash}`;
      break;
    case 'ownership':
      core = `${name} owns ${where}${dash}`;
      break;
    case 'co_working':
      core = `${name} is collaborating in ${where}${dash}`;
      break;
    case 'recent_proof':
      core = `${name} recently completed${item || ' work'} in ${where}`;
      break;
    default:
      core = `${name} is active in ${where}`;
  }
  if (status) core = `${core} (${status})`;
  return clampUnits(core, MAX_NOTE_LEN);
}

// --- Per-item derivation -----------------------------------------------------

function deriveFactFromItem(
  itemRaw: unknown,
  me: string,
  taskScopes: Map<string, string>,
  roomScopes: Map<string, string>,
  missionScopes: Map<string, string>,
  nowMs: number,
  horizonMs: number,
): CrossMemberFact | null {
  try {
    if (!itemRaw || typeof itemRaw !== 'object') return null;

    const memberId = sanitizeId(readField(itemRaw, 'memberId'));
    if (!memberId || memberId === me) return null; // self-authored or unkeyable

    const itemKind = readField(itemRaw, 'kind');
    if (itemKind !== 'assignment' && itemKind !== 'active_run' && itemKind !== 'finished_run') {
      return null;
    }

    // Narrowest focus overlap: task > room > mission. No match => drop (only
    // overlap with MY current work matters; no cross-scope inference). Map.has
    // keeps untrusted ids off any object-map key path.
    const taskId = sanitizeId(readField(itemRaw, 'taskId'));
    const roomId = sanitizeId(readField(itemRaw, 'roomId'));
    const missionId = sanitizeId(readField(itemRaw, 'missionId'));
    let scopeKind: CrossMemberScopeKind;
    let scopeId: string;
    let scopeTitle: string;
    if (taskId && taskScopes.has(taskId)) {
      scopeKind = 'task'; scopeId = taskId; scopeTitle = taskScopes.get(taskId) || '';
    } else if (roomId && roomScopes.has(roomId)) {
      scopeKind = 'room'; scopeId = roomId; scopeTitle = roomScopes.get(roomId) || '';
    } else if (missionId && missionScopes.has(missionId)) {
      scopeKind = 'mission'; scopeId = missionId; scopeTitle = missionScopes.get(missionId) || '';
    } else {
      return null;
    }

    const atRaw = readField(itemRaw, 'atMs');
    const atMs = typeof atRaw === 'number' && Number.isFinite(atRaw) ? atRaw : null;
    const ageMs = atMs === null ? null : nowMs - atMs;

    let factKind: CrossMemberFactKind;
    if (itemKind === 'active_run') {
      factKind = 'in_flight_overlap';
    } else if (itemKind === 'assignment') {
      factKind = scopeKind === 'task' ? 'ownership' : 'co_working';
    } else {
      // finished_run: recent proof only within the horizon; older / undated is
      // stale prior art and dropped (fail-closed on unknown recency).
      if (ageMs === null || ageMs > horizonMs) return null;
      factKind = 'recent_proof';
    }

    const memberName = sanitizeText(readField(itemRaw, 'memberName'), MAX_NAME_LEN) || DEFAULT_MEMBER_NAME;
    const itemTitle = sanitizeText(readField(itemRaw, 'title'), MAX_TITLE_LEN);
    const status = sanitizeText(readField(itemRaw, 'status'), MAX_STATUS_LEN);

    // KIND_SEVERITY / SCOPE_SPECIFICITY_BONUS are keyed by our own enums only.
    const score = round4(clamp01(
      KIND_SEVERITY[factKind] + SCOPE_SPECIFICITY_BONUS[scopeKind] + recencyBonus(ageMs),
    ));
    const note = buildNote(factKind, memberName, scopeKind, scopeTitle, itemTitle, status);

    return {
      kind: factKind,
      memberId,
      memberName,
      scopeKind,
      scopeId,
      scopeTitle,
      itemTitle,
      status,
      score,
      ageMs,
      note,
    };
  } catch {
    return null;
  }
}

// --- Ranking -----------------------------------------------------------------

/** Strict total order: score desc -> kind priority -> freshest -> memberId -> scopeId. */
function rankCompare(a: CrossMemberFact, b: CrossMemberFact): number {
  if (b.score !== a.score) return b.score - a.score;
  const pa = KIND_PRIORITY[a.kind];
  const pb = KIND_PRIORITY[b.kind];
  if (pa !== pb) return pa - pb;
  const ra = a.ageMs === null ? Infinity : a.ageMs;
  const rb = b.ageMs === null ? Infinity : b.ageMs;
  if (ra !== rb) return ra - rb; // smaller age = fresher
  if (a.memberId !== b.memberId) return a.memberId < b.memberId ? -1 : 1;
  if (a.scopeId !== b.scopeId) return a.scopeId < b.scopeId ? -1 : 1;
  return 0;
}

// --- Block assembly ----------------------------------------------------------

const BLOCK_HEADER = '## Team activity relevant to you';
const FENCE_OPEN = '<untrusted_quoted>';
const FENCE_CLOSE = '</untrusted_quoted>';

/** Defensive: neutralize any nested fence marker before wrapping (belt & braces). */
function neutralizeFence(text: string): string {
  return text.replace(/<\s*\/?\s*untrusted_quoted\s*>/gi, '[fence-removed]');
}

/** Surrogate-safe hard slice to a UTF-16 unit bound (never splits a pair). */
function sliceUnitsSafe(s: string, max: number): string {
  if (s.length <= max) return s;
  let end = max;
  const code = s.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1; // don't split a high surrogate
  return s.slice(0, Math.max(0, end));
}

function assembleBlockFromFacts(facts: unknown): string {
  if (!Array.isArray(facts) || facts.length === 0) return '';
  const lines: string[] = [];
  for (const f of facts.slice(0, MAX_FACTS)) {
    let note = '';
    try {
      note = f && typeof (f as CrossMemberFact).note === 'string' ? (f as CrossMemberFact).note : '';
    } catch {
      note = '';
    }
    // Re-sanitize defensively: facts from derive are already clean, but a
    // hostile direct render(result) call may carry unsanitized notes.
    const clean = sanitizeText(note, MAX_NOTE_LEN);
    if (clean) lines.push(`- ${clean}`);
  }
  if (lines.length === 0) return '';

  const build = (ls: string[]): string =>
    `${BLOCK_HEADER}\n${FENCE_OPEN}\n${neutralizeFence(ls.join('\n'))}\n${FENCE_CLOSE}`;
  const kept = lines.slice();
  let block = build(kept);
  while (block.length > MAX_BLOCK_CHARS && kept.length > 1) {
    kept.pop();
    block = build(kept);
  }
  if (block.length > MAX_BLOCK_CHARS) block = sliceUnitsSafe(block, MAX_BLOCK_CHARS);
  return block;
}

// --- Public API --------------------------------------------------------------

/** A fresh, empty result (safe default for degenerate input). */
export function emptyCrossMemberContext(): CrossMemberContextResult {
  return {
    facts: [],
    counts: { inFlightOverlap: 0, ownership: 0, recentProof: 0, coWorking: 0, teammates: 0 },
    block: null,
  };
}

/**
 * Render the precomputed prompt block from a result (or any shape). Returns ''
 * when there are no facts. The derive path stores this same value in
 * `result.block` (as string|null). TOTAL -- never throws.
 */
export function renderCrossMemberContextBlock(resultRaw: unknown): string {
  try {
    const facts = resultRaw && typeof resultRaw === 'object' && Array.isArray((resultRaw as CrossMemberContextResult).facts)
      ? (resultRaw as CrossMemberContextResult).facts
      : [];
    return assembleBlockFromFacts(facts);
  } catch {
    return '';
  }
}

/**
 * Derive the member-relative cross-member context for the acting member.
 *
 * Pipeline: validate focus (a resolvable actingMemberId + >=1 focus scope are
 * required -- otherwise there is no "me" or nothing to overlap, and the result
 * is empty) -> per activity item: self-exclude, match narrowest focus scope,
 * classify, score -> dedupe by (memberId, scopeId, kind) keeping the best ->
 * counts over the pre-cap deduped set -> rank -> per-teammate fairness cap ->
 * slice to maxFacts -> render block.
 *
 * TOTAL: any hostile/degenerate input yields a valid empty-ish result, never a
 * throw, never a leaked secret; every emitted string is bounded + code-point
 * clean.
 */
export function deriveCrossMemberContext(
  focusRaw: unknown,
  activityRaw: unknown,
  optsRaw?: unknown,
): CrossMemberContextResult {
  try {
    const opts = optsRaw && typeof optsRaw === 'object' ? optsRaw : {};
    const nowMs = finiteOr(readField(opts, 'nowMs'), 0);
    const maxFacts = clampInt(readField(opts, 'maxFacts'), DEFAULT_MAX_FACTS, 0, MAX_FACTS);
    const maxPerTeammate = clampInt(readField(opts, 'maxPerTeammate'), DEFAULT_MAX_PER_TEAMMATE, 1, MAX_FACTS);
    const horizonMs = Math.max(0, finiteOr(readField(opts, 'recentProofHorizonMs'), DEFAULT_RECENT_PROOF_HORIZON_MS));

    if (!focusRaw || typeof focusRaw !== 'object') return emptyCrossMemberContext();
    const actingMemberId = sanitizeId(readField(focusRaw, 'actingMemberId'));
    if (!actingMemberId) return emptyCrossMemberContext(); // no valid "me" => fail closed

    // Focus scopes -> per-kind id->title Maps (membership via .has, safe keys).
    const taskScopes = new Map<string, string>();
    const roomScopes = new Map<string, string>();
    const missionScopes = new Map<string, string>();
    let scopeList: unknown[] = [];
    try {
      const raw = readField(focusRaw, 'scopes');
      if (Array.isArray(raw)) scopeList = raw.slice(0, MAX_FOCUS_SCOPES);
    } catch {
      scopeList = [];
    }
    for (const sc of scopeList) {
      if (!sc || typeof sc !== 'object') continue;
      const id = sanitizeId(readField(sc, 'id'));
      if (!id) continue;
      const kind = readField(sc, 'kind');
      const title = sanitizeText(readField(sc, 'title'), MAX_TITLE_LEN);
      if (kind === 'task') {
        if (!taskScopes.has(id)) taskScopes.set(id, title);
      } else if (kind === 'room') {
        if (!roomScopes.has(id)) roomScopes.set(id, title);
      } else if (kind === 'mission') {
        if (!missionScopes.has(id)) missionScopes.set(id, title);
      }
    }
    if (taskScopes.size === 0 && roomScopes.size === 0 && missionScopes.size === 0) {
      return emptyCrossMemberContext(); // nothing to overlap with
    }

    // Scan activity (bounded), derive + dedupe by (memberId, scopeId, kind).
    let scanned: unknown[] = [];
    try {
      if (Array.isArray(activityRaw)) scanned = activityRaw.slice(0, MAX_ACTIVITY_SCANNED);
    } catch {
      scanned = [];
    }
    const dedup = new Map<string, CrossMemberFact>();
    for (const it of scanned) {
      const f = deriveFactFromItem(it, actingMemberId, taskScopes, roomScopes, missionScopes, nowMs, horizonMs);
      if (!f) continue;
      const key = f.memberId + SEP + f.scopeId + SEP + f.kind;
      const prev = dedup.get(key);
      if (!prev || rankCompare(f, prev) < 0) dedup.set(key, f);
    }
    const deduped = Array.from(dedup.values());

    // Counts reflect the PRE-cap deduped totals.
    const counts: CrossMemberContextCounts = {
      inFlightOverlap: 0, ownership: 0, recentProof: 0, coWorking: 0, teammates: 0,
    };
    const team = new Set<string>();
    for (const f of deduped) {
      team.add(f.memberId);
      if (f.kind === 'in_flight_overlap') counts.inFlightOverlap += 1;
      else if (f.kind === 'ownership') counts.ownership += 1;
      else if (f.kind === 'recent_proof') counts.recentProof += 1;
      else if (f.kind === 'co_working') counts.coWorking += 1;
    }
    counts.teammates = team.size;

    // Rank, then apply the per-teammate fairness cap (keeps each teammate's best
    // in ranked order), then slice to maxFacts.
    deduped.sort(rankCompare);
    const perTeam = new Map<string, number>();
    const capped: CrossMemberFact[] = [];
    for (const f of deduped) {
      const n = perTeam.get(f.memberId) || 0;
      if (n >= maxPerTeammate) continue;
      perTeam.set(f.memberId, n + 1);
      capped.push(f);
    }
    const facts = capped.slice(0, maxFacts);
    const block = assembleBlockFromFacts(facts);
    return { facts, counts, block: block || null };
  } catch {
    return emptyCrossMemberContext();
  }
}
