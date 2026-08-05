/**
 * v2SaveMemoryCore — the PURE decision layer behind `save_memory` in the
 * swanbot-v2-ai edge function.
 *
 * WHY THIS FILE EXISTS (four verified defects in the v2 handler):
 *   1. UNCONDITIONAL INSERT. v2 always inserted; v1 (`swanbot-ai/index.ts`)
 *      does fetch-then-update. Every repeated agent `save_memory` therefore
 *      grew circle memory forever and diluted retrieval for everything else.
 *   2. `source_run_id` WAS NEVER SET even though the run id is on ToolContext,
 *      so no memory row could be traced to the run that produced it.
 *   3. `source_surface` WAS HARDCODED 'main_chat' regardless of the real
 *      writer (see V2_SAVE_MEMORY_SOURCE_SURFACE for the honest replacement).
 *   4. `scope` WAS HARDCODED 'circle' — nothing agent-scoped was ever written
 *      from v2 even though the request body carries agent identity.
 *
 * ─── WHY THIS DUPLICATES memoryDedupeCore's SCORER ─────────────────────────
 * The dedupe STRATEGY here is deliberately NOT a new one: the ladder, every
 * threshold, and the corroborated duplicate predicate are the ones proven in
 * `src/lib/memoryDedupeCore.ts`. They are restated here only because this
 * module is imported by a DENO edge function, and Deno resolves the whole
 * module graph: `memoryDedupeCore.ts` carries an extensionless
 * `import type { MemoryKind } from './agentRunSystem'`, which makes
 * `deno check supabase/functions/swanbot-v2-ai/index.ts` fail (TS2307). Every
 * other core the edge already imports (v2ToolSelectionCore, userMemoryCaps,
 * toolConnectivityGateCore, …) is likewise import-free — that is the house
 * rule for edge-importable modules, not an accident.
 *
 * DRIFT GUARD: `scripts/v2-save-memory-core-smoketest.ts` imports BOTH this
 * module and `memoryDedupeCore` and asserts they agree — same constants, and
 * identical similarity scores across a battery of pairs. If anyone tunes one
 * scorer without the other, that smoke fails. Do not "fix" a divergence by
 * loosening the assertion.
 *
 * DESIGN BIAS — FALSE NEGATIVES ARE CHEAP, FALSE POSITIVES ARE NOT.
 * A missed duplicate costs one extra memory row (visible, forgettable). A
 * wrong duplicate silently UPDATEs a row in place with no history and destroys
 * the user's original text forever. Every ambiguous case below — empty body,
 * missing id, unknown lane, agent lane with no agent identity, truncated
 * compare window, hostile input — resolves to "NOT a duplicate".
 *
 * PURITY / SAFETY CONTRACT:
 *   - NO IMPORTS AT ALL (Deno edge constraint above). Loads under `npx tsx`
 *     and under Deno unchanged.
 *   - DETERMINISTIC: no Date.now()/Math.random()/argless `new Date`. Callers
 *     pass `nowIso`; an unusable `nowIso` omits `updated_at` rather than
 *     writing junk (the column has a DB default).
 *   - TOTAL: every export tolerates null/undefined/wrong-type/cyclic/throwing-
 *     getter/huge input and returns a safe bounded value instead of throwing.
 *   - SYMMETRIC: v2MemorySimilarityScore(a, b) === v2MemorySimilarityScore(b, a).
 */

// ─── Bounds and thresholds (mirrored from memoryDedupeCore; smoke-locked) ────

/** Chars compared per side; beyond this we compare prefixes (score-capped). */
export const MAX_COMPARE_CHARS = 20000;

/** Cap on tokens extracted per side (bounds the Jaccard set work). */
export const MAX_TOKENS_PER_SIDE = 4000;

/** Containment counts as near-identity only above this length ratio. */
export const CONTAINMENT_MIN_LENGTH_RATIO = 0.6;

/** …and only when the shorter side is a statement, not a topic word. */
export const CONTAINMENT_MIN_CHARS = 24;

/** Title similarity that, WITH corroboration, marks the same memory. */
export const DUPLICATE_TITLE_THRESHOLD = 0.88;

/** Content similarity that alone marks the same memory. */
export const DUPLICATE_CONTENT_THRESHOLD = 0.82;

/** Corroboration floor: a title match may only update when bodies agree. */
export const TITLE_MATCH_CONTENT_FLOOR = 0.5;

/** A prefix-only comparison can never authorize an overwrite. */
export const TRUNCATED_SCORE_CEILING = 0.8;

// ─── v2-specific bounds ─────────────────────────────────────────────────────

/**
 * The honest `source_surface` for a v2 `save_memory` write.
 *
 * WHAT IS ACTUALLY KNOWABLE HERE: the v2 request body has NO surface field
 * (grep `surface` in swanbot-v2-ai/index.ts — the only occurrence is the
 * `agent_runs` insert, which is ITSELF a hardcoded literal 'main_chat', so it
 * is not evidence of anything). A save_memory call can equally originate from
 * Chat, Office, a continuation resume, or an automation that routed through
 * v2. So 'main_chat' was not merely unverified, it was WRONG for every
 * non-chat caller — and it is rendered back to the model as `src:…`.
 *
 * The one thing this handler CAN assert is which writer produced the row, so
 * that is what it records. This follows the existing repo precedent of a
 * writer-named surface (`claude_code_bridge` in memoryService.ts) rather than
 * a surface-named one. If a real originating surface is ever threaded through
 * the request body, pass it as `sourceSurface` and this constant becomes the
 * fallback only.
 */
export const V2_SAVE_MEMORY_SOURCE_SURFACE = 'swanbot_v2_ai';

/** Title cap (unchanged from the existing handler). */
export const MAX_MEMORY_TITLE_CHARS = 120;

/** Content cap (unchanged from the existing handler — do not raise). */
export const MAX_MEMORY_CONTENT_CHARS = 4000;

/** Max rows the handler should fetch for the duplicate scan. */
export const MAX_DEDUPE_CANDIDATES = 200;

/** Cap on a stored agent identity string. */
export const MAX_AGENT_ID_CHARS = 200;

export const V2_MEMORY_KINDS = [
  'fact',
  'instruction',
  'preference',
  'decision',
  'finding',
  'context',
] as const;

export type V2MemoryKind = (typeof V2_MEMORY_KINDS)[number];

/** uuid v-any shape. `memory_entries.source_run_id` is a `uuid` column: a
 *  non-uuid string is a 22P02 insert error, so junk must become NULL. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Loose ISO-8601 instant shape (what `new Date().toISOString()` produces). */
const ISO_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

// ─── Total coercion helpers ─────────────────────────────────────────────────

function toText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

function safeRead(source: unknown, key: string): unknown {
  if (!source || (typeof source !== 'object' && typeof source !== 'function')) return undefined;
  try {
    return (source as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

function safeText(source: unknown, key: string): string {
  return toText(safeRead(source, key));
}

/** Trimmed, bounded string or ''. Never throws. */
function cleanString(value: unknown, maxChars: number): string {
  const text = toText(value).trim();
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

/** A shallow copy of a plain-object metadata bag, or {}. Never throws. */
function safeMetadataObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, unknown> = {};
  try {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      try {
        const entry: unknown = (value as Record<string, unknown>)[key];
        // Drop nested self-references: this bag is JSON-serialized by PostgREST.
        if (entry === value) continue;
        out[key] = entry;
      } catch {
        /* throwing getter — skip the key, keep the rest */
      }
    }
  } catch {
    return {};
  }
  return out;
}

// ─── Normalization ──────────────────────────────────────────────────────────

/**
 * A `memory_entries.source_run_id` value, or null.
 * DEFECT #2 fix: `ctx.runId` is a real uuid on every persisted run, but a
 * throwaway/unpersisted run passes null and a hostile caller could pass junk.
 * Junk must become NULL — a bad uuid literal fails the whole INSERT (22P02),
 * which would turn a provenance bug into a memory-loss bug.
 */
export function normalizeSourceRunId(value: unknown): string | null {
  const text = toText(value).trim().toLowerCase();
  if (!text) return null;
  return UUID_RE.test(text) ? text : null;
}

/** An `updated_at` value we are willing to write, or null (use DB default). */
export function normalizeUpdatedAt(value: unknown): string | null {
  const text = toText(value).trim();
  if (!text || text.length > 40) return null;
  return ISO_INSTANT_RE.test(text) ? text : null;
}

/** The model may send anything; unknown kinds fall back to 'fact'. */
export function normalizeV2MemoryKind(value: unknown): V2MemoryKind {
  const text = toText(value).trim().toLowerCase();
  return (V2_MEMORY_KINDS as readonly string[]).includes(text) ? (text as V2MemoryKind) : 'fact';
}

/** Importance ladder — preserved verbatim from the existing v2 handler. */
export function v2MemoryImportance(kind: unknown): number {
  const normalized = normalizeV2MemoryKind(kind);
  if (normalized === 'instruction') return 0.9;
  if (normalized === 'decision') return 0.8;
  return 0.6;
}

// ─── Similarity (behaviourally identical to memoryDedupeCore) ───────────────

function tokenSet(value: string): Set<string> {
  const out = new Set<string>();
  for (const term of value.split(/\W+/)) {
    if (!term) continue;
    out.add(term);
    if (out.size >= MAX_TOKENS_PER_SIDE) break;
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let overlap = 0;
  for (const term of small) {
    if (large.has(term)) overlap += 1;
  }
  const union = a.size + b.size - overlap;
  return union > 0 ? overlap / union : 0;
}

/**
 * Symmetric 0..1 similarity. Ladder: exact → 1; SUBSTANTIAL containment →
 * 0.5 + 0.5*lengthRatio; otherwise Jaccard |A∩B|/|A∪B|. A truncated
 * (prefix-only) comparison is capped below DUPLICATE_CONTENT_THRESHOLD so it
 * can never authorize an overwrite. Mirrors `memorySimilarityScore`.
 */
export function v2MemorySimilarityScore(a: unknown, b: unknown): number {
  const rawA = toText(a).toLowerCase().trim();
  const rawB = toText(b).toLowerCase().trim();
  if (!rawA || !rawB) return 0;
  if (rawA === rawB) return 1;

  const truncated = rawA.length > MAX_COMPARE_CHARS || rawB.length > MAX_COMPARE_CHARS;
  const aa = truncated ? rawA.slice(0, MAX_COMPARE_CHARS) : rawA;
  const bb = truncated ? rawB.slice(0, MAX_COMPARE_CHARS) : rawB;

  let score = jaccard(tokenSet(aa), tokenSet(bb));

  const [shorter, longer] = aa.length <= bb.length ? [aa, bb] : [bb, aa];
  if (
    shorter.length >= CONTAINMENT_MIN_CHARS &&
    longer.length > 0 &&
    shorter.length / longer.length >= CONTAINMENT_MIN_LENGTH_RATIO &&
    longer.includes(shorter)
  ) {
    score = Math.max(score, 0.5 + 0.5 * (shorter.length / longer.length));
  }

  if (truncated) score = Math.min(score, TRUNCATED_SCORE_CEILING);

  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(1, score));
}

// ─── Lane resolution (DEFECT #4) ────────────────────────────────────────────

export type V2MemoryLaneScope = 'circle' | 'agent';

export type V2MemoryLane = {
  scope: V2MemoryLaneScope;
  /** `memory_entries.agent_id` — NOT NULL for the agent lane, null for circle. */
  agentId: string | null;
  visibility: 'circle_shared' | 'private';
  /** Recorded in metadata so a row's lane is auditable after the fact. */
  reason: 'agent_subject' | 'circle_requested' | 'no_agent_subject';
};

/**
 * The single `memory_entries.agent_id` value for this run.
 *
 * ORDER IS LOAD-BEARING. The client reader
 * (`swanbot.ts` → `memoryService.loadMemories`) queries agent memories with
 * `agentId: getContextAgentSubjectKey(context)` plus
 * `agentAliases: getContextAgentLegacyIds(context)`, and filters rows by
 * `agent_id ∈ {agentId, ...aliases}`. The subject key is therefore the
 * canonical column value; the db id and legacy ids are fallbacks that still
 * land inside the alias set, so a row written under one is still readable.
 * Writing an identifier NOT in that set would make the memory invisible —
 * strictly worse than the circle lane — hence the fallback chain and the
 * "no identity ⇒ circle lane" rule below.
 */
export function resolveV2MemoryAgentId(input: unknown): string | null {
  const subjectKey = cleanString(safeRead(input, 'agentSubjectKey'), MAX_AGENT_ID_CHARS);
  if (subjectKey) return subjectKey;
  const dbId = cleanString(safeRead(input, 'agentDbId'), MAX_AGENT_ID_CHARS);
  if (dbId) return dbId;
  const legacy = safeRead(input, 'agentLegacyIds');
  if (Array.isArray(legacy)) {
    for (const entry of legacy) {
      const cleaned = cleanString(entry, MAX_AGENT_ID_CHARS);
      if (cleaned) return cleaned;
    }
  }
  return null;
}

/**
 * Which memory lane this write belongs to.
 *
 * DEFECT #4: v2 hardcoded scope 'circle' / visibility 'circle_shared', so no
 * agent-scoped memory was EVER written from v2 even though the request body
 * carries agent identity. Now: an identified agent writes to its own lane; the
 * model can still ask for the team-shared circle lane explicitly; and with NO
 * agent identity we fall back to circle rather than fabricate an `agent_id`
 * (an unreadable row is worse than a shared one).
 *
 * Agent-lane column shape matches `memoryService.saveMemoryWithContext` and
 * the RLS insert policy in `20260413_agent_memory_private_owner_only.sql`:
 * scope 'agent' + agent_id NOT NULL + user_id = owner + visibility 'private'.
 */
export function resolveV2MemoryLane(input: unknown): V2MemoryLane {
  const requested = toText(safeRead(input, 'requestedScope')).trim().toLowerCase();
  const agentId = resolveV2MemoryAgentId(input);

  if (requested === 'circle') {
    return { scope: 'circle', agentId: null, visibility: 'circle_shared', reason: 'circle_requested' };
  }
  if (!agentId) {
    return { scope: 'circle', agentId: null, visibility: 'circle_shared', reason: 'no_agent_subject' };
  }
  return { scope: 'agent', agentId, visibility: 'private', reason: 'agent_subject' };
}

// ─── Duplicate selection (DEFECT #1 — the destructive path) ─────────────────

/** Minimal shape the duplicate scan needs from an existing `memory_entries` row. */
export type V2MemoryCandidate = {
  id?: string | null;
  scope?: string | null;
  agent_id?: string | null;
  user_id?: string | null;
  title?: string | null;
  content?: string | null;
  importance?: number | null;
  metadata?: unknown;
};

export type V2DuplicateMatch<T> = {
  memory: T;
  index: number;
  titleScore: number;
  contentScore: number;
  /** Which signal cleared the bar. 'content' wins ties (it is the stronger one). */
  matchedOn: 'content' | 'title';
};

function rankOf(match: V2DuplicateMatch<unknown>): number {
  return Math.max(match.contentScore, match.titleScore);
}

/**
 * Pick the existing row this save should UPDATE, or null to INSERT a new one.
 *
 * Predicate (identical to `memoryDedupeCore.pickDuplicateMemory`):
 *   contentScore >= DUPLICATE_CONTENT_THRESHOLD
 *   OR (titleScore >= DUPLICATE_TITLE_THRESHOLD AND contentScore >= TITLE_MATCH_CONTENT_FLOOR)
 *
 * The corroboration floor matters because v2 titles are model-authored and two
 * unrelated memories can easily share one; a title collision alone must never
 * destroy an older body.
 *
 * AMBIGUOUS ⇒ NOT A DUPLICATE. We return null (→ insert) whenever we cannot
 * PROVE sameness: empty incoming body, unknown lane, agent lane without an
 * agent identity, candidate with no id, candidate in a different lane, or an
 * agent-lane candidate whose `agent_id` is missing or different. The scorer
 * additionally caps prefix-only comparisons below the duplicate threshold.
 *
 * Best score wins; ties resolve to the earliest index, so the result is
 * deterministic for a given candidate order.
 */
export function pickV2DuplicateMemory<T extends V2MemoryCandidate>(
  candidates: unknown,
  query: unknown,
): V2DuplicateMatch<T> | null {
  const list = Array.isArray(candidates) ? candidates : [];
  if (list.length === 0) return null;

  const title = safeText(query, 'title');
  const content = safeText(query, 'content');
  const lane = safeRead(query, 'lane');
  const laneScope = toText(safeRead(lane, 'scope')).trim();
  const laneAgentId = cleanString(safeRead(lane, 'agentId'), MAX_AGENT_ID_CHARS);

  // Never dedupe on nothing: an empty incoming body cannot justify replacing a
  // stored one, and an unknown lane cannot be ownership-checked.
  if (!content.trim()) return null;
  if (laneScope !== 'circle' && laneScope !== 'agent') return null;
  // An agent lane with no identity cannot prove which agent owns a row.
  if (laneScope === 'agent' && !laneAgentId) return null;

  let best: V2DuplicateMatch<T> | null = null;

  for (let index = 0; index < list.length; index += 1) {
    const candidate = list[index] as T;
    if (!candidate || typeof candidate !== 'object') continue;

    const candidateId = safeText(candidate, 'id').trim();
    if (!candidateId) continue;

    if (safeText(candidate, 'scope').trim() !== laneScope) continue;
    if (laneScope === 'agent' && safeText(candidate, 'agent_id').trim() !== laneAgentId) continue;

    const titleScore = v2MemorySimilarityScore(safeText(candidate, 'title'), title);
    const contentScore = v2MemorySimilarityScore(safeText(candidate, 'content'), content);

    const contentMatch = contentScore >= DUPLICATE_CONTENT_THRESHOLD;
    const titleMatch =
      titleScore >= DUPLICATE_TITLE_THRESHOLD && contentScore >= TITLE_MATCH_CONTENT_FLOOR;
    if (!contentMatch && !titleMatch) continue;

    const match: V2DuplicateMatch<T> = {
      memory: candidate,
      index,
      titleScore,
      contentScore,
      matchedOn: contentMatch ? 'content' : 'title',
    };

    if (!best || rankOf(match) > rankOf(best)) best = match;
  }

  return best;
}

// ─── The write plan (single chokepoint the handler executes) ────────────────

export type V2SaveMemoryInsertRow = {
  scope: V2MemoryLaneScope;
  circle_id: string;
  user_id: string | null;
  /** Only present on the agent lane — see planV2SaveMemoryWrite for why. */
  agent_id?: string;
  memory_kind: V2MemoryKind;
  title: string;
  content: string;
  source_run_id: string | null;
  source_surface: string;
  retrieval_mode: 'on_demand';
  importance: number;
  visibility: 'circle_shared' | 'private';
  is_active: true;
  metadata: Record<string, unknown>;
};

export type V2SaveMemoryUpdatePatch = {
  title: string;
  content: string;
  memory_kind: V2MemoryKind;
  source_surface: string;
  /** Omitted (rather than nulled) when this run has no valid uuid. */
  source_run_id?: string;
  importance: number;
  metadata: Record<string, unknown>;
  updated_at?: string;
};

export type V2SaveMemoryPlan =
  | { ok: false; error: string }
  | {
      ok: true;
      action: 'insert' | 'update';
      /** The row to UPDATE, or null for an INSERT. */
      targetId: string | null;
      lane: V2MemoryLane;
      /** Insert payload when action==='insert', update patch when 'update'. */
      row: V2SaveMemoryInsertRow | V2SaveMemoryUpdatePatch;
      duplicate: V2DuplicateMatch<V2MemoryCandidate> | null;
    };

export type V2SaveMemoryPlanInput = {
  title?: unknown;
  content?: unknown;
  kind?: unknown;
  /** Model-selected lane: 'circle' forces the team-shared lane. */
  requestedScope?: unknown;
  circleId?: unknown;
  userId?: unknown;
  /** `ctx.runId` — validated to a uuid or written as NULL. */
  runId?: unknown;
  agentSubjectKey?: unknown;
  agentDbId?: unknown;
  agentLegacyIds?: unknown;
  /** Caller-supplied clock (purity): unusable values omit `updated_at`. */
  nowIso?: unknown;
  /** Active rows already in this lane, from the handler's bounded SELECT. */
  candidates?: unknown;
};

/**
 * Decide INSERT vs UPDATE and build the exact row/patch.
 *
 * Fixes all four defects in one place:
 *   #1 dedupe — `pickV2DuplicateMemory` picks an existing row to UPDATE,
 *      mirroring v1's fetch-then-update instead of always inserting.
 *   #2 `source_run_id` — set from the run id when it is a real uuid.
 *   #3 `source_surface` — the honest writer name, not 'main_chat'.
 *   #4 `scope` — the agent lane when an agent identity is present.
 *
 * Callers MUST run the credential-shape refusal gate
 * (`detectCredentialMemoryContent`) on the same trimmed/capped title+content
 * BEFORE calling this. This function does not — and cannot — see secrets
 * policy; it is pure text-in/row-out.
 */
export function planV2SaveMemoryWrite(input: V2SaveMemoryPlanInput): V2SaveMemoryPlan {
  const title = cleanString(safeRead(input, 'title'), MAX_MEMORY_TITLE_CHARS);
  const content = cleanString(safeRead(input, 'content'), MAX_MEMORY_CONTENT_CHARS);
  if (!title || !content) return { ok: false, error: 'title and content required' };

  const circleId = cleanString(safeRead(input, 'circleId'), 100);
  if (!circleId) return { ok: false, error: 'circleId required' };

  const userId = cleanString(safeRead(input, 'userId'), 100) || null;
  const kind = normalizeV2MemoryKind(safeRead(input, 'kind'));
  const importance = v2MemoryImportance(kind);
  const sourceRunId = normalizeSourceRunId(safeRead(input, 'runId'));
  const updatedAt = normalizeUpdatedAt(safeRead(input, 'nowIso'));
  const lane = resolveV2MemoryLane(input);

  const nextMetadata: Record<string, unknown> = {
    via: 'swanbot-v2-ai',
    scope_reason: lane.reason,
  };
  // `memoryService` falls back to `metadata.agentId` when matching agent rows,
  // so mirroring the column here keeps older readers working.
  if (lane.agentId) nextMetadata.agentId = lane.agentId;

  const duplicate = pickV2DuplicateMemory<V2MemoryCandidate>(safeRead(input, 'candidates'), {
    title,
    content,
    lane,
  });

  if (duplicate) {
    const existingImportance = safeRead(duplicate.memory, 'importance');
    // Never silently DEMOTE: a later save classified 'fact' must not drop an
    // existing instruction from 0.9 to 0.6 and quietly change what gets
    // retrieved. Same rule as `memoryService.saveAgentMemory`.
    const mergedImportance =
      typeof existingImportance === 'number' && Number.isFinite(existingImportance)
        ? Math.max(existingImportance, importance)
        : importance;

    const patch: V2SaveMemoryUpdatePatch = {
      title,
      content,
      memory_kind: kind,
      source_surface: V2_SAVE_MEMORY_SOURCE_SURFACE,
      importance: mergedImportance,
      metadata: { ...safeMetadataObject(safeRead(duplicate.memory, 'metadata')), ...nextMetadata },
    };
    // Only OVERWRITE provenance with a real uuid. A throwaway run must not
    // erase the run id that an earlier, persisted run legitimately recorded.
    if (sourceRunId) patch.source_run_id = sourceRunId;
    if (updatedAt) patch.updated_at = updatedAt;
    // Deliberately NOT patched:
    //   scope / agent_id / visibility / user_id — candidates are lane-filtered,
    //     so a duplicate can never migrate a row into another lane.
    //   is_active — the candidate query already filters is_active=true; forcing
    //     it true here could resurrect a row the user `/forget`-ed inside the
    //     select→update race window.
    return { ok: true, action: 'update', targetId: safeText(duplicate.memory, 'id').trim(), lane, row: patch, duplicate };
  }

  const row: V2SaveMemoryInsertRow = {
    scope: lane.scope,
    circle_id: circleId,
    user_id: userId,
    memory_kind: kind,
    title,
    content,
    source_run_id: sourceRunId,
    source_surface: V2_SAVE_MEMORY_SOURCE_SURFACE,
    retrieval_mode: 'on_demand',
    importance,
    visibility: lane.visibility,
    is_active: true,
    metadata: nextMetadata,
  };
  // `agent_id` is omitted entirely on the circle lane so the circle-lane
  // payload stays column-for-column compatible with what v2 writes today. If
  // `20260411_agent_memory_scope.sql` has not reached an environment, only the
  // NEW agent lane fails there — the pre-existing circle path is untouched.
  if (lane.scope === 'agent' && lane.agentId) row.agent_id = lane.agentId;

  return { ok: true, action: 'insert', targetId: null, lane, row, duplicate: null };
}
