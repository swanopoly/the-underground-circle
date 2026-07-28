/**
 * officeRunLookup — the pure run↔agent attribution seam for the Office.
 *
 * Until `agent_runs` carries a durable `agent_id` (plan item O6), everything the
 * Office says about an agent's work — the Building-Now board, the per-agent live
 * ops lines, the accountability line, the desk plaque, cost attribution — hangs
 * off matching a run to an agent by NAME and identity aliases. That made it the
 * highest-consequence untested logic on the surface: a miss silently attributes
 * an agent's failures to nobody, and a false hit attributes them to the wrong
 * agent. It lived inline in `OfficeTab.tsx` (7k lines) where no smoke test could
 * reach it.
 *
 * Rules for this module (smoke-testable via tsx):
 *   - ZERO runtime imports beyond other pure libs. No supabase, no react-native.
 *   - No clocks: callers pass whatever time context they need.
 *   - Partial / missing / malformed input must never throw.
 */

import { buildAgentRuntimeSubject, isUuidLike } from './agentRuntimeSubject';
import { getAgentIdentityKey } from './agentIdentityKey';
import { freshnessRank, type RunFreshnessResult } from './runFreshnessCore';
import type { OfficeAgent } from './officeAgents';
import type { OfficeRunNode } from './officeOpsBoard';

/** Structural minimum this module needs from a run node — the real
 *  `OfficeRunNode` stays assignable. */
export type OfficeRunNodeLike = Pick<OfficeRunNode, 'runId'> &
  Partial<Pick<OfficeRunNode, 'agentName' | 'subjectKey' | 'subjectDisplayName' | 'subjectDbId' | 'subjectAliases'>>;

// ─── Run recency ─────────────────────────────────────────────────────────────

/** Minimal shape of the run row this module reads. */
export interface RunTimestampsLike {
  updated_at?: string | null;
  completed_at?: string | null;
  started_at?: string | null;
  created_at?: string | null;
}

/**
 * `updatedAtMs` for classifyRunFreshness — the shared
 * `updated_at || completed_at || started_at || created_at` fallback. `agent_runs`
 * stamps `updated_at`, but the live-board select omits it, so completed/started/
 * created carry recency. Returns NaN when unusable; classifyRunFreshness degrades
 * that to a null age safely.
 */
export function runFreshnessUpdatedAtMs(run: RunTimestampsLike | null | undefined): number {
  if (!run) return Number.NaN;
  const raw = run.updated_at || run.completed_at || run.started_at || run.created_at;
  return raw ? Date.parse(raw) : Number.NaN;
}

/**
 * The freshest (most-alive by `freshnessRank`) run among an agent's live/blocked
 * nodes, from the id→freshness index built on the run poll. Null when the agent
 * has no classified live run — the roster freshness chip then hides rather than
 * showing a stale one.
 */
export function pickFreshestRunFreshness(
  nodes: OfficeRunNodeLike[] | null | undefined,
  freshnessById: Map<string, RunFreshnessResult> | null | undefined,
): RunFreshnessResult | null {
  if (!nodes || nodes.length === 0 || !freshnessById || freshnessById.size === 0) return null;
  let best: RunFreshnessResult | null = null;
  for (const node of nodes) {
    const freshness = node && freshnessById.get(node.runId);
    if (!freshness) continue;
    if (!best || freshnessRank(freshness.freshness) < freshnessRank(best.freshness)) {
      best = freshness;
    }
  }
  return best;
}

// ─── Lookup-key normalization ────────────────────────────────────────────────

export function normalizeOpsLookupKey(value: unknown): string | null {
  const text = String(value || '').trim().toLowerCase();
  return text || null;
}

/** Flattens nested alias arrays to non-empty trimmed strings. */
export function flattenOpsLookupValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(flattenOpsLookupValues);
  const text = String(value || '').trim();
  return text ? [text] : [];
}

/** Order-preserving, case-insensitive dedupe over mixed scalar/array inputs. */
export function uniqueOpsLookupKeys(values: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of Array.isArray(values) ? values : []) {
    for (const text of flattenOpsLookupValues(value)) {
      const key = normalizeOpsLookupKey(text);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}

/** Every key a run node can be indexed under. */
export function buildOpsRunNodeLookupKeys(node: OfficeRunNodeLike | null | undefined): string[] {
  if (!node) return [];
  return uniqueOpsLookupKeys([
    node.agentName,
    node.subjectKey,
    node.subjectDisplayName,
    node.subjectDbId,
    node.subjectAliases,
  ]);
}

/**
 * Every key an agent can be matched by — display name, ids, session key, the
 * canonical identity key, and the runtime subject's aliases/legacy ids. Order
 * matters: earlier keys are the more specific match, and the getters below
 * return on the first hit.
 */
export function buildOfficeAgentRunLookupKeys(agent: OfficeAgent | null | undefined): string[] {
  if (!agent) return [];
  const subject = buildAgentRuntimeSubject(agent, {
    dbAgentId: isUuidLike(agent.id) ? agent.id : null,
  });
  return uniqueOpsLookupKeys([
    agent.name,
    agent.id,
    agent.sessionKey,
    getAgentIdentityKey(agent),
    subject.subjectKey,
    subject.dbAgentId,
    subject.sessionKey,
    subject.identityKey,
    subject.memoryAgentAliases,
    subject.runAgentAliases,
    subject.legacyIds,
  ]);
}

// ─── Attribution getters ─────────────────────────────────────────────────────

/** All run nodes attributable to this agent, deduped by runId across keys. */
export function getOpsRunNodesForAgent<T extends OfficeRunNodeLike>(
  agent: OfficeAgent | null | undefined,
  nodesByKey: Map<string, T[]> | null | undefined,
): T[] {
  const out: T[] = [];
  if (!nodesByKey) return out;
  const seen = new Set<string>();
  for (const key of buildOfficeAgentRunLookupKeys(agent)) {
    for (const node of nodesByKey.get(key) || []) {
      if (!node || seen.has(node.runId)) continue;
      seen.add(node.runId);
      out.push(node);
    }
  }
  return out;
}

/** First accountability entry matching any of the agent's keys, else undefined. */
export function getOpsAccountabilityForAgent<T>(
  agent: OfficeAgent | null | undefined,
  index: Map<string, T> | null | undefined,
): T | undefined {
  if (!index) return undefined;
  for (const key of buildOfficeAgentRunLookupKeys(agent)) {
    const entry = index.get(key);
    if (entry) return entry;
  }
  return undefined;
}
