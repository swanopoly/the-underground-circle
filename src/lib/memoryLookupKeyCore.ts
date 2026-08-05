/**
 * memoryLookupKeyCore — the pure agent-memory lookup-key seam.
 *
 * Agent memory is keyed by ONE write key (the runtime subject key:
 * `dbAgentId || sessionKey || identityKey`, see `agentRuntimeSubject.ts`), but
 * that key ROTATES: a session-derived local-bridge agent that later gets
 * published to `circle_office_agents` switches from its session key to a uuid,
 * and a bridge reconnect can mint a new session key. Every row written under
 * the previous key becomes invisible unless the read side asks for the aliases
 * too.
 *
 * That asymmetry produced three shipped bugs (2026-07-24):
 *   1. SOUL memory readers passed `scopes: ['agent']` with NO agent id, so the
 *      agent branch never ran AND the shared branch filtered 'agent' out —
 *      every caller got `[]` forever, with no error.
 *   2. `buildMemoryContext` had no aliases parameter, so the MODEL read
 *      alias-blind while the Office UI read alias-aware: memory stayed visible
 *      on screen and invisible to the agent that wrote it.
 *   3. The agent-scope query was pinned at `.limit(20)` regardless of the
 *      caller's requested limit, silently truncating agents with >20 memories.
 *
 * This module owns the shared, testable half of all three: which ids a read
 * must look under, when a caller has asked for agent scope without giving one
 * (a caller bug that must be LOUD, never a silent empty array), and what limit
 * an agent-scope query should actually use.
 *
 * Rules for this module (smoke-testable via `npx tsx`):
 *   - ZERO heavy imports. No supabase, no react-native. `import type` only for
 *     anything that would drag a runtime in.
 *   - No clocks, no randomness, no I/O. Same input → same output.
 *   - Partial / missing / malformed input must never throw.
 */

import { buildAgentRuntimeSubject } from './agentRuntimeSubject';

/** What `loadMemories` used to hard-code for the agent-scope query. */
export const DEFAULT_AGENT_SCOPE_MEMORY_LIMIT = 20;

/** Upper bound for any single memory-scope query, so a bad caller limit can't
 *  turn into an unbounded fetch. */
export const MAX_MEMORY_SCOPE_QUERY_LIMIT = 500;

/** Upper bound on the `agent_id IN (...)` list. Alias sets are small (subject
 *  key + identity key + session key + db id + OpenSwan legacy names); anything
 *  larger is a caller accident, not a real agent. */
export const MAX_MEMORY_LOOKUP_IDS = 32;

/** Scope names as used by `memory_entries.scope` / `MemoryScope`. Kept as a
 *  loose string union input so this module never has to import the runtime. */
export type MemoryScopeName = string;

const REJECTED_KEYS = new Set(['null', 'undefined', 'nan', 'none', 'false', '0']);

/**
 * A lookup id exactly as it must be sent to Postgres — trimmed, original
 * casing preserved (`agent_id` equality is case-sensitive). Returns '' for
 * anything unusable, including stringified nullish junk that upstream string
 * interpolation loves to produce.
 */
export function normalizeMemoryLookupKey(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return '';
  const text = String(value).trim();
  if (!text) return '';
  if (REJECTED_KEYS.has(text.toLowerCase())) return '';
  return text;
}

/**
 * The case-folded form used for in-memory comparison and dedupe. Never send
 * this to the database — send `normalizeMemoryLookupKey` output.
 */
export function memoryLookupComparisonKey(value: unknown): string {
  return normalizeMemoryLookupKey(value).toLowerCase();
}

/** Flatten arbitrarily nested alias arrays into usable lookup strings. */
export function flattenMemoryLookupValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(flattenMemoryLookupValues);
  const text = normalizeMemoryLookupKey(value);
  return text ? [text] : [];
}

/**
 * The canonical `[agentId, ...aliases]` → lookup ids transform.
 *
 * - Order preserving: the primary write key stays first, so single-id callers
 *   can still use `.eq()` and callers that rank results get the live key first.
 * - Dedupe is case-INSENSITIVE (first spelling wins), matching the alias
 *   generation in `agentRuntimeSubject.uniqueSubjectStrings`. Upstream already
 *   case-folds, so a case-only "distinct" id is an upstream accident, not a
 *   real second row.
 * - Bounded by `MAX_MEMORY_LOOKUP_IDS`.
 */
export function resolveMemoryLookupIds(
  agentId?: unknown,
  agentAliases?: unknown,
  opts: { max?: number } = {},
): string[] {
  const max = Number.isFinite(opts.max) ? Math.max(1, Math.floor(opts.max as number)) : MAX_MEMORY_LOOKUP_IDS;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const candidate of [...flattenMemoryLookupValues(agentId), ...flattenMemoryLookupValues(agentAliases)]) {
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
    if (out.length >= max) break;
  }
  return out;
}

export type MemoryLookupSubjectInput = {
  agentId?: string | null;
  agentName?: string | null;
  sessionKey?: string | null;
  dbAgentId?: string | null;
  agentAliases?: unknown;
};

/**
 * Lookup ids for a caller that only has an agent id/name in scope (task runs,
 * Kanban execution) and therefore cannot hand us a real alias list.
 *
 * Runs the same subject derivation the Office roster uses, so at minimum the
 * identity key (`default::blackswan` → `blackswan`, `provider-main::x` →
 * `provider-main:x`) and the OpenSwan legacy names come along. Explicit
 * `agentAliases` from the caller always win the ordering.
 */
export function deriveMemoryLookupIds(input: MemoryLookupSubjectInput): string[] {
  const agentId = normalizeMemoryLookupKey(input.agentId);
  const dbAgentId = normalizeMemoryLookupKey(input.dbAgentId) || null;
  const sessionKey = normalizeMemoryLookupKey(input.sessionKey);
  const explicit = flattenMemoryLookupValues(input.agentAliases);
  if (!agentId && !dbAgentId && !sessionKey) return resolveMemoryLookupIds(undefined, explicit);

  let derived: string[] = [];
  try {
    const subject = buildAgentRuntimeSubject(
      {
        id: agentId || dbAgentId || sessionKey,
        name: normalizeMemoryLookupKey(input.agentName) || agentId || 'agent',
        ...(sessionKey ? { sessionKey } : {}),
      } as Parameters<typeof buildAgentRuntimeSubject>[0],
      { dbAgentId },
    );
    derived = flattenMemoryLookupValues(subject.memoryAgentAliases);
  } catch {
    derived = [];
  }
  return resolveMemoryLookupIds(agentId || dbAgentId || sessionKey, [...explicit, ...derived]);
}

/** True when `candidate` is one of the lookup ids (case-insensitive). */
export function memoryLookupIdsMatch(lookupIds: unknown, candidate: unknown): boolean {
  const key = memoryLookupComparisonKey(candidate);
  if (!key) return false;
  return flattenMemoryLookupValues(lookupIds).some(id => id.toLowerCase() === key);
}

/** Does this scope list ask for agent-scoped memory at all? */
export function scopesRequestAgentMemory(scopes: readonly MemoryScopeName[] | null | undefined): boolean {
  if (!Array.isArray(scopes)) return false;
  return scopes.some(scope => normalizeMemoryLookupKey(scope).toLowerCase() === 'agent');
}

/**
 * THE recurrence guard for Bug 1.
 *
 * `scopes: ['agent']` with no agent id can never return a row: the agent branch
 * is gated on having a lookup id, and the shared branch filters 'agent' out.
 * The old code answered that with `[]`, which reads exactly like "this agent
 * has no memories" — which is why two SOUL readers stayed broken. Callers in
 * this state are BUGS and must be told so.
 */
export function isAgentScopeMissingLookupId(args: {
  scopes?: readonly MemoryScopeName[] | null;
  lookupIds?: readonly string[] | null;
}): boolean {
  if (!scopesRequestAgentMemory(args.scopes)) return false;
  return flattenMemoryLookupValues(args.lookupIds).length === 0;
}

/**
 * The warning text for that caller bug. Pure (no clock), bounded, and free of
 * secrets — only scope names and an optional caller label, never memory
 * content, user ids or credentials.
 */
export function describeAgentScopeLookupWarning(args: {
  scopes?: readonly MemoryScopeName[] | null;
  caller?: string | null;
}): string {
  const scopeList = flattenMemoryLookupValues(args.scopes).slice(0, 8).join(', ') || 'agent';
  const caller = normalizeMemoryLookupKey(args.caller).slice(0, 80);
  return [
    '[memory] agent-scope read requested without an agent lookup id',
    caller ? ` (caller: ${caller})` : '',
    `: scopes=[${scopeList}] but agentId/agentAliases were empty, so this query can only ever return [].`,
    ' Pass agentId plus agentRuntimeSubject.memoryAgentAliases — the subject key rotates on publish/reconnect.',
  ].join('');
}

/**
 * Resolve the row limit for a scoped memory query.
 *
 * Bug 3: the agent branch pinned `.limit(20)` while the caller asked for 200,
 * so the Office panel AND the prompt context both truncated at 20 with no
 * signal. Callers own the limit; this only supplies the fallback and the cap.
 */
export function resolveMemoryScopeQueryLimit(
  requested?: number | null,
  fallback: number = DEFAULT_AGENT_SCOPE_MEMORY_LIMIT,
  max: number = MAX_MEMORY_SCOPE_QUERY_LIMIT,
): number {
  const safeMax = Number.isFinite(max) && (max as number) > 0 ? Math.floor(max as number) : MAX_MEMORY_SCOPE_QUERY_LIMIT;
  const safeFallback = Number.isFinite(fallback) && (fallback as number) > 0
    ? Math.min(Math.floor(fallback as number), safeMax)
    : Math.min(DEFAULT_AGENT_SCOPE_MEMORY_LIMIT, safeMax);
  if (typeof requested !== 'number' || !Number.isFinite(requested)) return safeFallback;
  const floored = Math.floor(requested);
  if (floored <= 0) return safeFallback;
  return Math.min(floored, safeMax);
}
