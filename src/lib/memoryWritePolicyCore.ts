/**
 * memoryWritePolicyCore — which scopes dedupe on write, and how.
 *
 * WHY THIS EXISTS (production evidence, 2026-07-28):
 * `saveMemory` gated its dedupe on `scope === 'session'`. Every other scope fell
 * straight through to an unconditional INSERT. A live check of the production
 * database found **4,621 of 4,716 active memories (98%) sitting in 26
 * duplicate-title groups**, the worst being a single title repeated **3,020
 * times**:
 *
 *     3020x  Workflow: cc / the-underground-circle   (context / main_chat)
 *      733x  Workflow: codex / .codex
 *
 * The writer is `memoryConsolidation.saveProceduralMemory`, which calls
 * `saveMemory({ scope: 'circle', … })` with a title that is stable by
 * construction (`Workflow: ${taskType}`). Circle scope — the shared,
 * team-visible surface — was the one with no dedupe at all, so the same lesson
 * was re-inserted on every successful run for three months.
 *
 * That is not merely wasted rows: retrieval ranks over this table, so 3,020
 * copies of one memory crowd out everything else a turn might have recalled.
 *
 * DESIGN
 * Dedupe semantics legitimately differ per scope, so this is a data-driven
 * policy table rather than scattered `if`s:
 *
 *   - `session`  — an evolving per-session summary. Exact title match, replace
 *                  in place. (Unchanged: this is the behaviour that already
 *                  shipped, and changing it is out of scope for a bug fix.)
 *   - `circle`   — shared team knowledge. Titles here are template-generated
 *                  BUCKETS, not identities: the 3,020-row group above holds
 *                  1,889 DISTINCT contents. So circle dedupes only on
 *                  title + byte-identical content. A first pass at this fix
 *                  used title-identity and would have destroyed those 1,889
 *                  records — the exact failure the bias below exists to stop.
 *   - `agent`/`user`/`room` — similarity-based, delegated to `memoryDedupeCore`,
 *                  which is deliberately biased "when ambiguous, NOT a
 *                  duplicate" because a wrong merge destroys the user's text.
 *
 * The bias throughout: a missed duplicate costs one extra visible row that
 * `/forget` can remove. A wrong duplicate destroys content that cannot be
 * recovered. Every ambiguous case resolves to "not a duplicate".
 *
 * Repo convention: `import type` only for heavy deps so `npx tsx` can load
 * this; no `Date.now()` (callers pass `nowMs`); every export total.
 */

import type { MemoryScope } from './agentRunSystem';

/** How a scope decides whether an incoming write is a repeat. */
export type MemoryDedupeStrategy =
  /** Exact (circle, scope, title, surface, owner) match → replace in place.
   *  ONLY safe where the title is a true identity and the row is meant to be
   *  overwritten (a session summary). */
  | 'identity'
  /** Title match AND byte-identical content → replace. Collapses genuine
   *  re-inserts while never merging two rows that say different things. */
  | 'content_identity'
  /** Score against loaded candidates via memoryDedupeCore's thresholds. */
  | 'similarity'
  /** Always insert. */
  | 'none';

export interface MemoryWriteScopePolicy {
  strategy: MemoryDedupeStrategy;
  /** Extra columns the identity lookup must match, beyond circle+scope+title. */
  identityKeys: ReadonlyArray<'source_surface' | 'user_id' | 'agent_id'>;
  /** Max rows to load for a similarity comparison. Bounded: this runs on the
   *  write path and must not turn a save into a table scan. */
  candidateLimit: number;
  why: string;
}

const IDENTITY_SURFACE_OWNER = ['source_surface', 'user_id'] as const;

const POLICY: Record<string, MemoryWriteScopePolicy> = {
  session: {
    strategy: 'identity',
    identityKeys: IDENTITY_SURFACE_OWNER,
    candidateLimit: 1,
    why: 'A session summary evolves in place; the title is the session key.',
  },
  circle: {
    // NOT 'identity'. The first attempt at this fix used title-identity and it
    // was WRONG: the 3,020-row group in production has 1,889 DISTINCT contents.
    // `saveProceduralMemory` writes a category as the title (`Workflow: cc /
    // the-underground-circle`) and the run's actual steps as the content, so
    // the title is a bucket, not an identity. Title-identity dedupe would have
    // silently collapsed 1,889 real records into one — destroying content,
    // which is the failure this module's bias exists to prevent.
    //
    // 'content_identity' collapses only byte-identical re-inserts (~1,131 of
    // that group) and never merges two rows that say different things.
    strategy: 'content_identity',
    identityKeys: IDENTITY_SURFACE_OWNER,
    candidateLimit: 1,
    why: 'Shared team surface. Titles are template-generated buckets, so only '
      + 'an exact content repeat is a true duplicate.',
  },
  user: {
    strategy: 'similarity',
    identityKeys: ['user_id'],
    candidateLimit: 25,
    why: 'User-authored phrasing varies; only merge on a real content match.',
  },
  agent: {
    strategy: 'similarity',
    identityKeys: ['agent_id', 'user_id'],
    candidateLimit: 25,
    why: 'Agent lessons are free-text; never merge across agents or owners.',
  },
  room: {
    strategy: 'similarity',
    identityKeys: ['user_id'],
    candidateLimit: 25,
    why: 'Room notes vary in phrasing like user notes.',
  },
};

const FALLBACK: MemoryWriteScopePolicy = {
  strategy: 'none',
  identityKeys: [],
  candidateLimit: 0,
  why: 'Unknown scope — insert rather than risk merging unrelated rows.',
};

/** Policy for a scope. Unknown/garbage scope ⇒ always-insert (never a merge). */
export function memoryWriteScopePolicy(scope: unknown): MemoryWriteScopePolicy {
  if (typeof scope !== 'string') return FALLBACK;
  return POLICY[scope] ?? FALLBACK;
}

/** Every scope this module knows about. */
export const MEMORY_WRITE_SCOPES: ReadonlyArray<string> = Object.keys(POLICY);

export interface DedupeEligibilityInput {
  scope: unknown;
  circleId?: unknown;
  title?: unknown;
}

export interface DedupeEligibility {
  eligible: boolean;
  strategy: MemoryDedupeStrategy;
  reason: string;
}

/**
 * Can this write be deduped at all? Requires a circle and a non-blank title —
 * without a title there is no stable identity and a similarity compare would be
 * scoring against an empty string.
 */
export function evaluateDedupeEligibility(input: DedupeEligibilityInput): DedupeEligibility {
  const raw = (input && typeof input === 'object' ? input : {}) as DedupeEligibilityInput;
  const policy = memoryWriteScopePolicy(raw.scope);
  if (policy.strategy === 'none') {
    return { eligible: false, strategy: 'none', reason: 'scope_has_no_dedupe' };
  }
  const circleId = typeof raw.circleId === 'string' ? raw.circleId.trim() : '';
  if (!circleId) return { eligible: false, strategy: policy.strategy, reason: 'missing_circle' };
  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  if (!title) return { eligible: false, strategy: policy.strategy, reason: 'missing_title' };
  return { eligible: true, strategy: policy.strategy, reason: 'ok' };
}

/** Content cap for the client write path. The edge functions cap at 4000; the
 *  client had no cap at all, so an oversized row could be written from the app
 *  but never from the edge. */
export const MEMORY_CONTENT_MAX_CHARS = 4000;
export const MEMORY_TITLE_MAX_CHARS = 200;

export interface ClampedMemoryText {
  title: string;
  content: string;
  titleTruncated: boolean;
  contentTruncated: boolean;
}

/** Bound title/content to the same limits the edge enforces. Truncation is
 *  reported so the caller can log it rather than silently shortening a user's
 *  memory. */
export function clampMemoryText(title: unknown, content: unknown): ClampedMemoryText {
  const t = typeof title === 'string' ? title : '';
  const c = typeof content === 'string' ? content : '';
  return {
    title: t.length > MEMORY_TITLE_MAX_CHARS ? t.slice(0, MEMORY_TITLE_MAX_CHARS) : t,
    content: c.length > MEMORY_CONTENT_MAX_CHARS ? c.slice(0, MEMORY_CONTENT_MAX_CHARS) : c,
    titleTruncated: t.length > MEMORY_TITLE_MAX_CHARS,
    contentTruncated: c.length > MEMORY_CONTENT_MAX_CHARS,
  };
}
