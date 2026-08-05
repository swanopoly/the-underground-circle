// crossSurfaceReferenceResolverCore — the PURE middle piece that turns an
// ordinary chat message ("how's the Acme redesign mission going?", "continue in
// the Backend room", "what did run 1a2b3c4d do?") into concrete, confidence-
// ranked navigation targets on the right app surface.
//
// Two halves already exist and are disconnected:
//   (1) circleContextSnapshot.ts injects a searchable INDEX of internal work
//       (tasks/missions/rooms/runs/members: id + title + status) into the prompt.
//   (2) entityHandleCore.ts ENCODES/DECODES a deep link (`<surface>:<kind>:<id>`)
//       for the CircleDetailScreen `uc:switch-tab` listener — but has ZERO
//       consumers, because nothing PRODUCES the `{kind,id,surface}` it needs.
// This module is that missing producer: it reads the raw user message and
// RESOLVES it against the compact entities the runtime already holds from the
// snapshot, emitting ranked `EntityHandle` nav targets + a suggested surface.
// It never fetches, opens, or validates anything — it only decides which
// existing internal work item a reference most likely means.
//
// Distinct from its neighbours (see nonDuplication): entityHandleCore only
// encodes a handle you already hold; searchCircleContextSnapshot ranks snapshot
// LINES for the model to READ from a query the model composes (no surface, no
// confidence, no handle); chatEntityLinkifyCore detects literal SYNTAX spans
// (urls/paths/#hex) with no catalog knowledge; mentions resolves explicit
// user-picked `@[kind:id:label]` tokens (impure/supabase). This core matches
// ACTUAL entities by title/name/alias, deterministically, on the raw prose.
//
// PURITY: the ONLY import is `import type` from entityHandleCore (itself
// zero-import, tsx-loadable). No supabase / react-native / network. DETERMINISTIC
// — no Date.now / Math.random / mutable module state; frozen const maps. Every
// export is TOTAL: null / undefined / wrong-typed / huge / hostile / cyclic /
// throwing-getter input yields a safe bounded CrossSurfaceRouteResult and NEVER
// throws. BOUNDED — message, entity count, match count, and every emitted string
// are clamped (MAX_* consts). SECRET-SAFE — titles / aliases / matchedText are
// stripped of control / line-separator / prompt-fence chars and pass a
// value-shape guard (a title that looks like a secret VALUE renders '[hidden]');
// only ids already supplied by the caller are echoed (they must round-trip
// through encodeEntityHandle), and nothing is constructed or fetched.

import type { EntityKind, EntitySurface, EntityHandle } from './entityHandleCore';

// ── Public types ────────────────────────────────────────────────────────────

/**
 * The compact entity shape the runtime already has from circleContextSnapshot
 * sections (tasks/missions → feed, rooms → rooms, recentRuns → office, …).
 * `surface` overrides the canonical home for `kind` when provided.
 */
export interface CrossSurfaceEntity {
  kind: EntityKind;
  id: string;
  title: string;
  surface?: EntitySurface;
  status?: string;
  aliases?: string[];
}

/** How sure we are that a message referred to this entity. */
export type ReferenceConfidence = 'high' | 'medium' | 'low';

/** Which signal produced the match (strongest single signal wins). */
export type ReferenceReason = 'id' | 'exact-title' | 'title-tokens' | 'alias' | 'partial';

/** A single resolved reference → nav target. `handle` feeds encodeEntityHandle. */
export interface SurfaceReferenceMatch {
  handle: EntityHandle;
  title: string;
  status: string;
  /** The original-case text (from the message or the title) that matched. */
  matchedText: string;
  confidence: ReferenceConfidence;
  score: number;
  reason: ReferenceReason;
}

/** The full result of resolving one message against a set of entities. */
export interface CrossSurfaceRouteResult {
  matches: SurfaceReferenceMatch[];
  /** Where to jump if the user acts on this: best match's surface, else a cue. */
  suggestedSurface: EntitySurface | null;
  /** The surface word detected in the message itself (feed/office/rooms/chat). */
  surfaceCue: EntitySurface | null;
}

// ── Bounds (exported so callers share the exact same caps) ────────────────────
/** Longest message we scan; anything past this is truncated. */
export const MAX_MESSAGE_LEN = 4000;
/** Most entities we score in one call (the rest are ignored, never an error). */
export const MAX_ENTITIES_SCANNED = 400;
/** Hard cap on returned matches regardless of the caller's maxMatches. */
export const MAX_MATCHES = 8;
/** Longest emitted title / matchedText source before clamping. */
export const MAX_TITLE_LEN = 120;
/** Longest emitted matchedText echo. */
export const MAX_MATCHED_TEXT_LEN = 80;
/** Most aliases considered per entity. */
export const MAX_ALIASES = 6;
/** Tokens shorter than this are dropped for title-token coverage. */
export const MIN_TOKEN_LEN = 3;

// ── Internal bounds ───────────────────────────────────────────────────────────
/** Default returned when the caller does not pin maxMatches. */
const DEFAULT_MAX_MATCHES = 5;
/**
 * Longest id we echo. LOCKSTEP with entityHandleCore.MAX_ID_LEN (256): an id
 * longer than this is rejected by encodeEntityHandle, so we never emit one.
 */
const MAX_ID_LEN = 256;
const MAX_STATUS_LEN = 24;
const MAX_ALIAS_LEN = 80;
/** Guard against a pathological message producing an unbounded token list. */
const MAX_TOKENS = 1200;
/** Minimum final score for a match to be emitted at all. */
const FLOOR = 100;

// ── Frozen vocab maps (deterministic) ─────────────────────────────────────────

/**
 * Canonical home surface per kind. LOCKSTEP with
 * entityHandleCore.targetSurfaceForEntity / SURFACE_BY_KIND — duplicated locally
 * (not imported) so this module's only import stays `import type`.
 */
const SURFACE_BY_KIND: Readonly<Record<EntityKind, EntitySurface>> = Object.freeze({
  task: 'feed',
  run: 'office',
  thread: 'chat',
  mission: 'feed',
  agent: 'office',
  room: 'rooms',
  message: 'chat',
});

/** Fallback surface for an unknown/junk kind — Chat is the primary surface. */
const FALLBACK_SURFACE: EntitySurface = 'chat';

/**
 * Message word → the surface it cues. Frozen with a NULL prototype so raw
 * message tokens that collide with Object.prototype member names (notably
 * "constructor", which survives toLowerCase) resolve to `undefined`, not the
 * inherited `Object` function — keeping detectSurfaceCue's contract of
 * `EntitySurface | null`.
 */
const SURFACE_CUE_WORDS: Readonly<Record<string, EntitySurface>> = Object.freeze(Object.assign(Object.create(null), {
  feed: 'feed',
  mission: 'feed',
  missions: 'feed',
  goal: 'feed',
  goals: 'feed',
  office: 'office',
  agents: 'office',
  agent: 'office',
  run: 'office',
  runs: 'office',
  dashboard: 'office',
  room: 'rooms',
  rooms: 'rooms',
  project: 'rooms',
  projects: 'rooms',
  chat: 'chat',
  thread: 'chat',
  threads: 'chat',
  conversation: 'chat',
  conversations: 'chat',
}));

/**
 * Message word → the entity kind it cues (for the +60 kind-cue boost). Frozen
 * with a NULL prototype for the same reason as SURFACE_CUE_WORDS: a raw token
 * like "constructor" must miss (undefined), never inherit `Object` and poison
 * messageKindCues.
 */
const KIND_CUE_WORDS: Readonly<Record<string, EntityKind>> = Object.freeze(Object.assign(Object.create(null), {
  mission: 'mission',
  missions: 'mission',
  task: 'task',
  tasks: 'task',
  room: 'room',
  rooms: 'room',
  run: 'run',
  runs: 'run',
  agent: 'agent',
  agents: 'agent',
  thread: 'thread',
  threads: 'thread',
  message: 'message',
  messages: 'message',
}));

/** Confidence tiers → rank for the sort tiebreak. Frozen. */
const CONFIDENCE_RANK: Readonly<Record<ReferenceConfidence, number>> = Object.freeze({
  high: 3,
  medium: 2,
  low: 1,
});

const ENTITY_KIND_SET: ReadonlySet<string> = new Set<string>([
  'task', 'run', 'thread', 'mission', 'agent', 'room', 'message',
]);
const ENTITY_SURFACE_SET: ReadonlySet<string> = new Set<string>(['chat', 'office', 'feed', 'rooms']);

/**
 * Small functional-word stoplist. Dropped ONLY for title-token coverage (kept
 * for id / exact-title / alias compares). Deliberately excludes every
 * kind/surface cue word so those still count as real title tokens.
 */
const STOPWORDS: ReadonlySet<string> = new Set<string>([
  'the', 'and', 'for', 'that', 'this', 'these', 'those', 'with', 'from', 'into', 'onto',
  'your', 'you', 'our', 'are', 'was', 'were', 'how', 'what', 'whats', 'why', 'who', 'whom',
  'did', 'does', 'doing', 'has', 'have', 'had', 'its', 'their', 'them', 'they', 'then',
  'than', 'but', 'not', 'all', 'any', 'some', 'more', 'most', 'just', 'want', 'need',
  'please', 'about', 'now', 'can', 'will', 'would', 'should', 'could', 'going', 'gonna',
  'tell', 'show', 'give', 'let', 'lets', 'make', 'get', 'got', 'see', 'look', 'here',
  'there', 'over', 'still', 'yet', 'been', 'being', 'also',
]);

// ── Lenient coercion (LOCKSTEP with entityHandleCore coerceKind/coerceSurface) ─

function coerceKind(x: unknown): EntityKind | null {
  if (typeof x !== 'string') return null;
  const k = x.trim().toLowerCase();
  return ENTITY_KIND_SET.has(k) ? (k as EntityKind) : null;
}

function coerceSurface(x: unknown): EntitySurface | null {
  if (typeof x !== 'string') return null;
  const s = x.trim().toLowerCase();
  return ENTITY_SURFACE_SET.has(s) ? (s as EntitySurface) : null;
}

function coerceConfidence(x: unknown): ReferenceConfidence | null {
  return x === 'high' || x === 'medium' || x === 'low' ? x : null;
}

/**
 * The safe id charset. LOCKSTEP with entityHandleCore.SAFE_ID_RE — an id we
 * cannot encode is never emitted, guaranteeing every match round-trips.
 */
const SAFE_ID_RE = /^[A-Za-z0-9._:-]+$/;

function coerceId(x: unknown): string {
  if (typeof x !== 'string') return '';
  const id = x.trim();
  if (id.length === 0 || id.length > MAX_ID_LEN) return '';
  return SAFE_ID_RE.test(id) ? id : '';
}

// ── Secret-safe text cleaning (LOCKSTEP with connectedResourcesDigest) ─────────

/** Value-shaped secret material found ANYWHERE inside a string. */
function containsSecretPattern(text: string): boolean {
  if (/eyJ[A-Za-z0-9_-]{8,}/.test(text)) return true; // JWT-ish
  if (/\b[A-Fa-f0-9]{32,}\b/.test(text)) return true; // long hex digest/key
  if (/[A-Za-z0-9+/]{40,}={0,2}/.test(text)) return true; // long base64 run
  if (/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}/.test(text)) return true; // sk-ant-… style
  if (/\bgh[pousr]_[A-Za-z0-9]{16,}/.test(text)) return true; // GitHub tokens
  if (/\bxox[bpsae]-[A-Za-z0-9-]{10,}/.test(text)) return true; // Slack tokens
  if (/\bAKIA[A-Z0-9]{12,}/.test(text)) return true; // AWS access key id
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) return true; // PEM
  return false;
}

/** Heuristic: does this string look like a secret VALUE (not a short name/title)? */
function looksLikeSecretValue(text: string): boolean {
  if (text.length > 40 && !/\s/.test(text)) return true; // long + spaceless
  if (containsSecretPattern(text)) return true;
  if (
    text.length >= 24 &&
    !/\s/.test(text) &&
    /[A-Za-z]/.test(text) &&
    /\d/.test(text) &&
    /^[A-Za-z0-9+/=._-]+$/.test(text)
  ) return true; // high-entropy-ish api-key shape
  return false;
}

/**
 * Flatten a user-influenced field for one prompt-safe line: drop control chars /
 * line separators (no structure forging), strip fence/tag chars (`<`,`>`,
 * backtick), collapse whitespace, hard-clip to `max`. Returns '' for
 * non-scalar/empty. Pre-clips huge input so the regex work stays bounded.
 */
function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return '';
  let raw: string;
  try {
    raw = String(value);
  } catch {
    return '';
  }
  const cap = Math.max(1, max) * 4;
  if (raw.length > cap) raw = raw.slice(0, cap);
  const text = raw
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ')
    .replace(/[<>`]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!text) return '';
  return text.length > max ? text.slice(0, max) : text;
}

/** cleanText + secret-VALUE guard: a value-shaped string becomes '[hidden]'. */
function guardText(value: unknown, max: number): string {
  const cleaned = cleanText(value, max);
  if (!cleaned) return '';
  return looksLikeSecretValue(cleaned) ? '[hidden]' : cleaned;
}

// ── Tokenization + boundary search ────────────────────────────────────────────

function isAlnumChar(ch: string): boolean {
  if (!ch) return false;
  return (
    (ch >= '0' && ch <= '9') ||
    (ch >= 'a' && ch <= 'z') ||
    (ch >= 'A' && ch <= 'Z')
  );
}

/** Split on any run of non-[a-z0-9] chars. Input should already be lowercased. */
function tokenize(lower: string): string[] {
  const out: string[] = [];
  if (!lower) return out;
  for (const part of lower.split(/[^a-z0-9]+/)) {
    if (!part) continue;
    out.push(part);
    if (out.length >= MAX_TOKENS) break;
  }
  return out;
}

/**
 * First index of `needle` in `haystack` where both edges sit on a word boundary
 * (start/end of string, or a non-alphanumeric neighbour). -1 if absent. Bounded
 * by the haystack length; never throws.
 */
function boundaryIndexOf(haystack: string, needle: string): number {
  if (!needle || !haystack || needle.length > haystack.length) return -1;
  let from = 0;
  // Guard is redundant with indexOf advancing, but caps worst-case scans.
  for (let guard = 0; guard <= haystack.length; guard += 1) {
    const idx = haystack.indexOf(needle, from);
    if (idx < 0) return -1;
    const before = idx === 0 ? '' : haystack.charAt(idx - 1);
    const afterPos = idx + needle.length;
    const after = afterPos >= haystack.length ? '' : haystack.charAt(afterPos);
    if (!isAlnumChar(before) && !isAlnumChar(after)) return idx;
    from = idx + 1;
    if (from > haystack.length) return -1;
  }
  return -1;
}

/**
 * Original-case echo of `needleLower` as it appears in `scanLower`, sliced from
 * the parallel original-case `base`. Guarded + bounded by the caller. Minor
 * length drift from `toLowerCase` (rare Unicode) only nudges the cosmetic echo;
 * it can never throw or leak (result is always re-guarded).
 */
function echoSpan(base: string, scanLower: string, needleLower: string): string {
  const idx = boundaryIndexOf(scanLower, needleLower);
  if (idx < 0) return '';
  return base.slice(idx, idx + needleLower.length);
}

/**
 * Does a message token point at this entity's id? Handles: a whole-id paste, a
 * distinctive alnum id-SEGMENT (contains a digit, e.g. a uuid segment or a
 * `run_1a2b3c4d` hash), and a ≥4-char idish PREFIX of such a segment (the
 * snapshot shows the 8-char shortId). A digit is required for segment/prefix
 * hits so plain words ('run', 'task', 'backend') never collide with an id.
 */
function idTokenHit(idLower: string, token: string): boolean {
  if (token.length < 4) return false;
  if (token === idLower) return true;
  for (const seg of idLower.split(/[^a-z0-9]+/)) {
    if (!seg) continue;
    if (seg === token && /\d/.test(token)) return true;
    if (seg.length > token.length && seg.startsWith(token) && /\d/.test(token)) return true;
  }
  return false;
}

// ── Public: home surface + surface cue ────────────────────────────────────────

/**
 * Canonical home surface for a kind. LOCKSTEP with
 * entityHandleCore.targetSurfaceForEntity. Total: junk kind → 'chat'.
 */
export function homeSurfaceForKind(kind: unknown): EntitySurface {
  const k = coerceKind(kind);
  return k === null ? FALLBACK_SURFACE : SURFACE_BY_KIND[k];
}

/**
 * The surface word the user typed, if any: feed/mission(s)/goal(s) → feed;
 * office/agent(s)/run(s)/dashboard → office; room(s)/project(s) → rooms;
 * chat/thread(s)/conversation(s) → chat. Returns the FIRST cue in the message
 * for determinism. Total: non-string / cue-less input → null.
 */
export function detectSurfaceCue(message: unknown): EntitySurface | null {
  const base = coerceMessage(message);
  if (!base) return null;
  for (const token of tokenize(base.toLowerCase())) {
    const cue = SURFACE_CUE_WORDS[token];
    if (cue) return cue;
  }
  return null;
}

function coerceMessage(message: unknown): string {
  if (typeof message !== 'string') return '';
  return cleanText(message, MAX_MESSAGE_LEN);
}

// ── Public: resolve ───────────────────────────────────────────────────────────

interface Signal {
  points: number;
  reason: ReferenceReason;
  confidence: ReferenceConfidence;
  /** Lowercased needle to echo from the message, if present. */
  needle: string;
  /** Fallback matchedText when the needle isn't a contiguous message span. */
  fallback: string;
}

/**
 * Resolve a raw chat message against the entities the runtime already holds and
 * return confidence-ranked navigation targets. Pure, deterministic, total.
 *
 * opts:
 *   - maxMatches: cap on returned matches (default 5, hard max MAX_MATCHES=8).
 *   - minConfidence: drop matches below this tier (default 'low' → keep all).
 *   - surfaceHint: a surface the caller is already on; a light +25 tiebreak.
 */
export function resolveCrossSurfaceReferences(
  message: unknown,
  entities: unknown,
  opts?: { maxMatches?: number; minConfidence?: ReferenceConfidence; surfaceHint?: EntitySurface | null },
): CrossSurfaceRouteResult {
  // Read opts defensively (a hostile/proxy opts must never throw).
  let maxMatchesOpt: unknown;
  let minConfOpt: unknown;
  let surfaceHintOpt: unknown;
  try {
    const o = opts && typeof opts === 'object' ? (opts as Record<string, unknown>) : {};
    maxMatchesOpt = o.maxMatches;
    minConfOpt = o.minConfidence;
    surfaceHintOpt = o.surfaceHint;
  } catch {
    maxMatchesOpt = undefined;
    minConfOpt = undefined;
    surfaceHintOpt = undefined;
  }

  const surfaceCue = detectSurfaceCue(message);
  const surfaceHint = coerceSurface(surfaceHintOpt);
  const minConfidence = coerceConfidence(minConfOpt) ?? 'low';

  const fallbackResult = (): CrossSurfaceRouteResult => ({
    matches: [],
    suggestedSurface: surfaceCue ?? surfaceHint ?? null,
    surfaceCue,
  });

  const base = coerceMessage(message);
  if (!base) return fallbackResult();

  let collected: SurfaceReferenceMatch[] = [];
  try {
    const scanLower = base.toLowerCase();
    const allTokens = tokenize(scanLower);
    const messageTokenSet = new Set(allTokens);
    const messageKindCues = new Set<EntityKind>();
    for (const t of allTokens) {
      const k = KIND_CUE_WORDS[t];
      if (k) messageKindCues.add(k);
    }

    const list = Array.isArray(entities) ? entities.slice(0, MAX_ENTITIES_SCANNED) : [];
    for (const raw of list) {
      const match = scoreEntity(raw, {
        base,
        scanLower,
        allTokens,
        messageTokenSet,
        messageKindCues,
        surfaceCue,
        surfaceHint,
      });
      if (match) collected.push(match);
    }
  } catch {
    return fallbackResult();
  }

  // 5. Filter by minConfidence, sort, dedupe by encoded identity, slice.
  const minRank = CONFIDENCE_RANK[minConfidence];
  collected = collected.filter((m) => CONFIDENCE_RANK[m.confidence] >= minRank);
  collected.sort(compareMatches);

  const seen = new Set<string>();
  const deduped: SurfaceReferenceMatch[] = [];
  for (const m of collected) {
    const key = encodeKey(m.handle);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(m);
  }

  const limit = matchLimit(maxMatchesOpt);
  const matches = deduped.slice(0, limit);

  const suggestedSurface = matches[0]?.handle.surface ?? surfaceCue ?? surfaceHint ?? null;
  return { matches, suggestedSurface, surfaceCue };
}

interface ScoreCtx {
  base: string;
  scanLower: string;
  allTokens: string[];
  messageTokenSet: Set<string>;
  messageKindCues: Set<EntityKind>;
  surfaceCue: EntitySurface | null;
  surfaceHint: EntitySurface | null;
}

/** Score one (untrusted) entity against the message; null if no real match. */
function scoreEntity(raw: unknown, ctx: ScoreCtx): SurfaceReferenceMatch | null {
  let kind: EntityKind | null;
  let id: string;
  let titleClean: string;
  let titleOut: string;
  let statusOut: string;
  let surface: EntitySurface | null;
  let aliases: string[];
  try {
    if (!raw || typeof raw !== 'object') return null;
    const rec = raw as {
      kind?: unknown; id?: unknown; title?: unknown; surface?: unknown; status?: unknown; aliases?: unknown;
    };
    kind = coerceKind(rec.kind);
    if (kind === null) return null;
    id = coerceId(rec.id);
    if (!id) return null;
    titleClean = cleanText(rec.title, MAX_TITLE_LEN);
    if (!titleClean) return null;
    titleOut = looksLikeSecretValue(titleClean) ? '[hidden]' : titleClean;
    statusOut = guardText(rec.status, MAX_STATUS_LEN);
    surface = coerceSurface(rec.surface);
    aliases = readAliases(rec.aliases);
  } catch {
    return null; // hostile getter / proxy trap → skip this entity, never throw
  }

  const entitySurface: EntitySurface = surface ?? SURFACE_BY_KIND[kind];
  const idLower = id.toLowerCase();
  const titleLower = titleClean.toLowerCase();

  let best: Signal | null = null;
  const consider = (
    points: number,
    reason: ReferenceReason,
    confidence: ReferenceConfidence,
    needle: string,
    fallback: string,
  ): void => {
    if (!best || points > best.points) best = { points, reason, confidence, needle, fallback };
  };

  // id (whole id / distinctive segment / idish prefix) as a whole token.
  for (const token of ctx.allTokens) {
    if (idTokenHit(idLower, token)) {
      consider(1000, 'id', 'high', token, token);
      break;
    }
  }

  // exact title phrase (len ≥ 3) on a word boundary.
  if (titleLower.length >= 3 && boundaryIndexOf(ctx.scanLower, titleLower) >= 0) {
    consider(600, 'exact-title', 'high', titleLower, titleOut);
  }

  // title-token coverage (+ partial band, cue-gated).
  const titleTokens = uniqueSignificantTokens(titleLower);
  const total = titleTokens.length;
  if (total > 0) {
    let matched = 0;
    for (const tt of titleTokens) if (ctx.messageTokenSet.has(tt)) matched += 1;
    if (matched > 0) {
      const coverage = matched / total;
      if (coverage >= 1) {
        consider(400 + 20 * matched, 'title-tokens', total >= 2 ? 'high' : 'medium', titleLower, titleOut);
      } else if (coverage >= 0.6) {
        consider(250, 'title-tokens', 'medium', titleLower, titleOut);
      } else if (coverage >= 0.34) {
        const kindCued = ctx.messageKindCues.has(kind);
        const surfaceCued = ctx.surfaceCue !== null && entitySurface === ctx.surfaceCue;
        // A cue-less single-token partial is DROPPED (a mislink is worse than a miss).
        if (kindCued || surfaceCued) consider(120, 'partial', 'low', titleLower, titleOut);
      }
    }
  }

  // alias phrase / token hit.
  for (const alias of aliases) {
    if (boundaryIndexOf(ctx.scanLower, alias) >= 0) {
      consider(300, 'alias', 'medium', alias, titleOut);
      break;
    }
  }

  if (!best) return null;
  // TS: `best` is definitely a Signal past the guard above.
  const signal: Signal = best;

  const kindBoost = ctx.messageKindCues.has(kind) ? 60 : 0;
  let surfaceBoost = 0;
  if (ctx.surfaceCue !== null && entitySurface === ctx.surfaceCue) surfaceBoost = 50;
  else if (ctx.surfaceHint !== null && entitySurface === ctx.surfaceHint) surfaceBoost = 25;

  const score = signal.points + kindBoost + surfaceBoost;
  if (score < FLOOR) return null;

  const echoed = echoSpan(ctx.base, ctx.scanLower, signal.needle);
  let matchedText = guardText(echoed || signal.fallback, MAX_MATCHED_TEXT_LEN);
  if (!matchedText) matchedText = guardText(signal.fallback, MAX_MATCHED_TEXT_LEN) || titleOut;

  const handle: EntityHandle = { kind, id, surface: entitySurface };
  return {
    handle,
    title: titleOut,
    status: statusOut,
    matchedText,
    confidence: signal.confidence,
    score,
    reason: signal.reason,
  };
}

/** Unique, stopword-filtered, ≥ MIN_TOKEN_LEN tokens of a lowercased title. */
function uniqueSignificantTokens(titleLower: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokenize(titleLower)) {
    if (t.length < MIN_TOKEN_LEN || STOPWORDS.has(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** Clean, secret-guard, lowercase, cap aliases for matching. */
function readAliases(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const a of value) {
    const cleaned = cleanText(a, MAX_ALIAS_LEN);
    if (!cleaned || looksLikeSecretValue(cleaned)) continue;
    const lower = cleaned.toLowerCase();
    if (lower.length < MIN_TOKEN_LEN) continue;
    if (!out.includes(lower)) out.push(lower);
    if (out.length >= MAX_ALIASES) break;
  }
  return out;
}

function encodeKey(h: EntityHandle): string {
  return `${h.surface ?? ''}:${h.kind}:${h.id}`;
}

/** score desc → confidence rank desc → id asc → full key asc (stable + total). */
function compareMatches(a: SurfaceReferenceMatch, b: SurfaceReferenceMatch): number {
  if (b.score !== a.score) return b.score - a.score;
  const cr = CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence];
  if (cr !== 0) return cr;
  const idc = a.handle.id.localeCompare(b.handle.id);
  if (idc !== 0) return idc;
  return encodeKey(a.handle).localeCompare(encodeKey(b.handle));
}

function matchLimit(maxMatchesOpt: unknown): number {
  const requested =
    typeof maxMatchesOpt === 'number' && Number.isFinite(maxMatchesOpt)
      ? Math.floor(maxMatchesOpt)
      : DEFAULT_MAX_MATCHES;
  return Math.max(0, Math.min(requested, MAX_MATCHES));
}
