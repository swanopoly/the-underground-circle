/**
 * Memory Service — Clean API for the agent memory system.
 *
 * Separates concerns from agentRunSystem.ts and swanbot.ts:
 * - Startup memory: always loaded at session start (instructions, preferences)
 * - Archival memory: retrieved on-demand by relevance
 * - Session memory: working state for the current thread
 * - Compaction: summarize and trim stale context
 */

import { supabase } from './supabase';
import {
  loadMemories, saveMemory,
  type MemoryScope, type MemoryKind, type MemoryEntry,
} from './agentRunSystem';
import { decideSoulMemoryRouting, getAgentSoulInfo, getMemorySoulKey } from './agentSoulMemory';

export type MemoryNamespace =
  | 'startup_bundle'
  | 'session_resume'
  | 'task_shared_pattern'
  | 'task_blocker_pattern'
  | 'agent_private_pattern'
  | 'agent_private_blocker'
  | 'external_agent_shared_pattern'
  | 'external_agent_user_context';

export type AgentMemoryPromotionKind = 'success' | 'blocker';
export type PromptMemoryReference = {
  id: string;
  title: string;
  scope: MemoryScope;
  memoryKind: MemoryKind;
  sourceSurface?: string | null;
  soulKey?: string | null;
  pinned?: boolean | null;
  importance?: number | null;
  retrievalMode?: 'startup' | 'on_demand' | 'manual_only' | null;
  updatedAt?: string | null;
  lastAccessedAt?: string | null;
  confidence?: number | null;
  score?: number | null;
  taskFit?: 'core' | 'supporting' | 'background' | null;
  matchReason?: string | null;
  helpfulness?: number | null;
  memoryState?: 'startup' | 'retrieved' | 'supporting' | 'distilled' | null;
};

export type OpenSwanMemoryRecommendation = {
  id: string;
  title: string;
  content: string;
  memoryKind: MemoryKind;
  priority: 'high' | 'medium' | 'low';
  rationale: string;
  target: 'agent_private' | 'circle_shared' | 'user_private' | 'promote_existing';
  source: 'response_pattern' | 'failure_pattern' | 'guidance_promotion';
  recommendationType: 'save_new' | 'promote_existing';
  memoryId?: string | null;
  soulKey?: string | null;
  sourceMemoryIds?: string[];
  importance?: number;
  retrievalMode?: 'startup' | 'on_demand' | 'manual_only';
};

// ── Startup Memory Bundle ───────────────────────────────────────────────────

/**
 * Load the startup memory bundle — small, bounded, always-injected.
 * Includes: instructions, preferences, active decisions, recent session summary.
 */
export async function loadStartupMemory(opts: {
  circleId: string;
  userId: string;
  roomId?: string;
  agentId?: string;
}): Promise<string> {
  const allMemories = await loadMemories({
    circleId: opts.circleId,
    roomId: opts.roomId,
    agentId: opts.agentId,
    userId: opts.userId,
    scopes: opts.agentId ? ['circle', 'room', 'user', 'session', 'agent'] : ['circle', 'room', 'user', 'session'],
    limit: 40,
  });

  const startupMemories = allMemories
    .filter(m => m.retrieval_mode !== 'manual_only')
    .sort((a, b) => {
      const aStartup = a.retrieval_mode === 'startup' ? 1 : 0;
      const bStartup = b.retrieval_mode === 'startup' ? 1 : 0;
      if (bStartup !== aStartup) return bStartup - aStartup;
      if ((b.importance || 0) !== (a.importance || 0)) return (b.importance || 0) - (a.importance || 0);
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

  const durable = startupMemories.filter(m => m.scope !== 'session' && m.scope !== 'agent').slice(0, 10);
  const soulInfo = opts.agentId
    ? await getAgentSoulInfo({ circleId: opts.circleId, agentId: opts.agentId, userId: opts.userId })
    : null;
  const activeSoulKey = soulInfo?.soulKey || null;
  const agentPrivate = startupMemories
    .filter(m => m.scope === 'agent' && (!opts.agentId || m.agent_id === opts.agentId))
    .sort((a, b) => new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime())
    .sort((a, b) => {
      const aSoul = getMemorySoulKey(a);
      const bSoul = getMemorySoulKey(b);
      const aBoost = aSoul && aSoul === activeSoulKey ? 3 : !aSoul ? 1 : 0;
      const bBoost = bSoul && bSoul === activeSoulKey ? 3 : !bSoul ? 1 : 0;
      if (bBoost !== aBoost) return bBoost - aBoost;
      return new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime();
    })
    .slice(0, 8);
  const sessionMemories = startupMemories
    .filter(m => m.scope === 'session')
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  // Separate agent session memories (CC/Cursor/Codex/Gemini) from regular chat sessions
  const AGENT_SESSION_PREFIXES = ['CC Project:', 'CC Session:', 'Cursor Project:', 'Codex Project:', 'Gemini Project:'];
  const isAgentSession = (m: MemoryEntry) => AGENT_SESSION_PREFIXES.some(p => m.title.startsWith(p));
  const agentSessions = sessionMemories.filter(isAgentSession);
  const chatSessions = sessionMemories.filter(m => !isAgentSession(m));

  const parts: string[] = [];
  try {
    const { data: sharedDoc } = await supabase
      .from('circle_memory')
      .select('content, last_edited_at')
      .eq('circle_id', opts.circleId)
      .single();

    const sharedContent = sharedDoc?.content?.trim();
    if (sharedContent) {
      parts.push(`## Shared Circle Memory\n${sharedContent.slice(0, 1200)}`);
    }
  } catch {}

  if (durable.length > 0) {
    parts.push(
      `## Startup Memory\n${durable.map(m => `- [${m.scope}/${m.memory_kind}] ${m.title}: ${m.content.slice(0, 160)}`).join('\n')}`
    );
  }
  if (agentPrivate.length > 0) {
    const activeSoulMemories = activeSoulKey
      ? agentPrivate.filter(m => getMemorySoulKey(m) === activeSoulKey).slice(0, 4)
      : [];
    const agentCoreMemories = agentPrivate.filter(m => !getMemorySoulKey(m)).slice(0, 3);
    const fallbackAgentMemories = activeSoulKey
      ? agentPrivate.filter(m => getMemorySoulKey(m) !== activeSoulKey && !!getMemorySoulKey(m)).slice(0, 2)
      : agentPrivate.slice(0, 2);

    parts.push(
      `## Agent Specialization\n${
        [
          ...(activeSoulMemories.length > 0
            ? [`Active Soul${soulInfo?.soulLabel ? ` (${soulInfo.soulLabel})` : ''}:`, ...activeSoulMemories.map(m => `- ${m.title}: ${m.content.slice(0, 180)}`)]
            : []),
          ...(agentCoreMemories.length > 0
            ? [`Core Agent Memory:`, ...agentCoreMemories.map(m => `- ${m.title}: ${m.content.slice(0, 180)}`)]
            : []),
          ...(fallbackAgentMemories.length > 0
            ? [`Other Soul Memory:`, ...fallbackAgentMemories.map(m => `- ${m.title}: ${m.content.slice(0, 180)}`)]
            : []),
        ].join('\n')
      }`
    );
  }
  // Show agent session context — what all agent sessions have been working on
  if (agentSessions.length > 0) {
    const agentLines = agentSessions.slice(0, 3).map(m => m.content.slice(0, 500)).join('\n---\n');
    parts.push(`## Agent Sessions (${agentSessions.length} recent)\n${agentLines}`);
  }
  if (chatSessions.length > 0) {
    parts.push(`## Previous Session\n${chatSessions[0].content.slice(0, 800)}`);
  }

  // Enforce total character budget — prevent prompt bloat
  const MAX_MEMORY_CHARS = 3000;
  let result = parts.join('\n\n');
  if (result.length > MAX_MEMORY_CHARS) {
    // Trim from the bottom (least important sections added last)
    result = result.slice(0, MAX_MEMORY_CHARS);
    // Find last clean line break to avoid mid-sentence cut
    const lastNewline = result.lastIndexOf('\n');
    if (lastNewline > MAX_MEMORY_CHARS * 0.8) {
      result = result.slice(0, lastNewline) + '\n...(memory truncated)';
    }
  }
  return result;
}

// ── Soul Wisdom ─────────────────────────────────────────────────────────────
// Phase 3 of AGENT_MEMORY_GOD_PLAN. Reads the pre-distilled per-(circle,SOUL)
// guidance block that the `distil-soul-wisdom` edge fn writes. Cached in
// memory for the session so we don't hammer the DB on every turn.

export interface SoulWisdomEntry {
  body: string;
  soulKey: string;
  generatedAt: string;
  sourceCount: number;
  sourceKind?: 'stored' | 'synthesized';
}

const soulWisdomCache = new Map<string, { entry: SoulWisdomEntry | null; fetchedAt: number }>();
const SOUL_WISDOM_TTL_MS = 10 * 60 * 1000; // 10 min — wisdom is weekly, cache 10m per session

export function invalidateSoulWisdomCache(circleId: string, soulKey?: string | null): void {
  if (!circleId) return;
  if (soulKey) {
    soulWisdomCache.delete(`${circleId}::${soulKey}`);
    soulWisdomCache.delete(`${circleId}::${soulKey}::synth`);
    return;
  }
  for (const key of Array.from(soulWisdomCache.keys())) {
    if (key.startsWith(`${circleId}::`)) soulWisdomCache.delete(key);
  }
}

export async function loadSoulWisdom(circleId: string, soulKey: string): Promise<SoulWisdomEntry | null> {
  const key = `${circleId}::${soulKey}`;
  const cached = soulWisdomCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < SOUL_WISDOM_TTL_MS) {
    return cached.entry;
  }
  try {
    const { data, error } = await supabase
      .from('soul_wisdom')
      .select('body, soul_key, generated_at, source_count')
      .eq('circle_id', circleId)
      .eq('soul_key', soulKey)
      .maybeSingle();
    if (error) {
      // PGRST205 = table not yet in schema cache; treat as "no wisdom yet"
      if ((error as any).code !== 'PGRST205') {
        console.warn('[memoryService] loadSoulWisdom error:', error.message);
      }
      soulWisdomCache.set(key, { entry: null, fetchedAt: Date.now() });
      return null;
    }
    if (!data) {
      soulWisdomCache.set(key, { entry: null, fetchedAt: Date.now() });
      return null;
    }
    const entry: SoulWisdomEntry = {
      body: data.body,
      soulKey: data.soul_key,
      generatedAt: data.generated_at,
      sourceCount: data.source_count || 0,
      sourceKind: 'stored',
    };
    soulWisdomCache.set(key, { entry, fetchedAt: Date.now() });
    return entry;
  } catch (err) {
    console.warn('[memoryService] loadSoulWisdom failed:', err);
    return null;
  }
}

/**
 * Format a SoulWisdomEntry as a system-prompt block. Returns '' if no
 * wisdom exists yet so callers can unconditionally concatenate.
 */
export function formatSoulWisdomBlock(entry: SoulWisdomEntry | null): string {
  if (!entry || !entry.body?.trim()) return '';
  const soulName = entry.soulKey.replace(/^soul:/, '').replace(/-/g, ' ');
  const title = soulName.replace(/\b\w/g, c => c.toUpperCase());
  const dateStr = entry.generatedAt ? new Date(entry.generatedAt).toISOString().slice(0, 10) : '';
  const sourceSuffix = entry.sourceKind === 'synthesized' ? ' • distilled from active memory' : '';
  const header = `## ${title} wisdom in this circle${dateStr ? ` (updated ${dateStr})` : ''}${sourceSuffix}`;
  return `${header}\n${entry.body.trim()}`;
}

async function synthesizeSoulWisdomFromMemories(opts: {
  circleId: string;
  soulKey: string;
  userId?: string;
  agentId?: string;
  queryText?: string;
  taskKind?: string;
  profile?: string;
}): Promise<SoulWisdomEntry | null> {
  if (!opts.circleId || !opts.soulKey || !opts.userId) return null;

  const sourceMemories = await loadMemories({
    circleId: opts.circleId,
    userId: opts.userId,
    agentId: opts.agentId,
    scopes: opts.agentId ? ['circle', 'user', 'agent'] : ['circle', 'user'],
    limit: 80,
  });
  if (sourceMemories.length === 0) return null;

  const candidateIds = sourceMemories.map((mem) => mem.id);
  const soulLinksByMemoryId = new Map<string, { soul_key: string; role: string }[]>();
  const helpfulnessByMemoryId = new Map<string, number>();

  try {
    const { data: linkRows } = await supabase
      .from('memory_soul_links')
      .select('memory_id, soul_key, role')
      .in('memory_id', candidateIds);
    for (const row of (linkRows || []) as any[]) {
      const next = soulLinksByMemoryId.get(row.memory_id) || [];
      next.push({ soul_key: row.soul_key, role: row.role });
      soulLinksByMemoryId.set(row.memory_id, next);
    }
  } catch {}

  try {
    const { data: evaluationRows } = await supabase
      .from('memory_evaluations')
      .select('memory_id, score, passed, metadata')
      .in('memory_id', candidateIds)
      .eq('evaluation_kind', 'manual_review');
    const grouped = new Map<string, number[]>();
    for (const row of (evaluationRows || []) as any[]) {
      const action = row.metadata?.action;
      const inferredScore =
        typeof row.score === 'number'
          ? row.score
          : action === 'accepted' || action === 'promoted' || action === 'pinned'
            ? 1
            : action === 'dismissed' || action === 'not_helpful'
              ? 0
              : row.passed === true
                ? 0.8
                : row.passed === false
                  ? 0.2
                  : null;
      if (typeof inferredScore !== 'number') continue;
      const next = grouped.get(row.memory_id) || [];
      next.push(inferredScore);
      grouped.set(row.memory_id, next);
    }
    for (const [memoryId, scores] of grouped.entries()) {
      helpfulnessByMemoryId.set(memoryId, scores.reduce((sum, score) => sum + score, 0) / scores.length);
    }
  } catch {}

  const relevant = sourceMemories
    .filter((mem) => mem.is_active !== false && mem.retrieval_mode !== 'manual_only')
    .map((mem) => {
      const links = soulLinksByMemoryId.get(mem.id) || [];
      const explicitSoulKey = getMemorySoulKey(mem);
      const linkedToSoul = links.some((link) => link.soul_key === opts.soulKey);
      const soulMatch = explicitSoulKey === opts.soulKey || linkedToSoul;
      const coreGuidance = ['instruction', 'preference', 'decision', 'policy'].includes(mem.memory_kind);
      const helpfulness = helpfulnessByMemoryId.get(mem.id) ?? null;
      const recencyAgeDays = (Date.now() - new Date(mem.updated_at || mem.created_at).getTime()) / 86_400_000;
      const recencyBoost = Math.max(0.05, 0.28 - Math.min(0.23, recencyAgeDays * 0.008));
      const taskAffinity = scoreMemoryTaskAffinity(
        {
          title: mem.title,
          content: mem.content,
          memory_kind: mem.memory_kind,
          metadata: mem.metadata || {},
        },
        opts.taskKind,
        opts.profile,
      );
      let score = (mem.importance || 0.5) * 1.35;
      if (coreGuidance) score += 0.25;
      if (mem.retrieval_mode === 'startup') score += 0.22;
      if ((mem as any).pinned) score += 0.2;
      if (soulMatch) score += 0.3;
      if (links.some((link) => link.role === 'primary')) score += 0.08;
      if (helpfulness != null) score += (helpfulness - 0.5) * 0.5;
      score += recencyBoost;
      score += taskAffinity.score * 0.8;
      return { mem, score, soulMatch, helpfulness, taskAffinity };
    })
    .filter((item) => item.soulMatch || item.score >= 0.95)
    .sort((a, b) => b.score - a.score);

  if (relevant.length === 0) return null;

  const guidance = relevant
    .filter(({ mem }) => ['instruction', 'preference', 'decision', 'policy'].includes(mem.memory_kind) || mem.retrieval_mode === 'startup')
    .slice(0, 3);
  const patterns = relevant
    .filter(({ mem }) => !['instruction', 'preference', 'decision', 'policy'].includes(mem.memory_kind))
    .filter(({ mem }) => !/\b(blocker|failure|failed|error|regression)\b/i.test(`${mem.title}\n${mem.content}`))
    .slice(0, 3);
  const blockers = relevant
    .filter(({ mem }) => /\b(blocker|failure|failed|error|regression|avoid)\b/i.test(`${mem.title}\n${mem.content}`))
    .slice(0, 2);

  const sections: string[] = [];
  if (guidance.length > 0) {
    sections.push(`Operating guidance:\n${guidance.map(({ mem }) => `- ${mem.title}: ${mem.content.slice(0, 220)}`).join('\n')}`);
  }
  if (patterns.length > 0) {
    sections.push(`Reusable patterns:\n${patterns.map(({ mem, taskAffinity }) => `- ${mem.title}: ${mem.content.slice(0, 200)}${taskAffinity.reason ? ` (${taskAffinity.reason})` : ''}`).join('\n')}`);
  }
  if (blockers.length > 0) {
    sections.push(`Known blockers:\n${blockers.map(({ mem }) => `- ${mem.title}: ${mem.content.slice(0, 200)}`).join('\n')}`);
  }
  if (sections.length === 0) return null;

  return {
    body: sections.join('\n\n'),
    soulKey: opts.soulKey,
    generatedAt: new Date().toISOString(),
    sourceCount: Math.min(relevant.length, guidance.length + patterns.length + blockers.length),
    sourceKind: 'synthesized',
  };
}

export async function loadSoulWisdomWithFallback(opts: {
  circleId: string;
  soulKey: string;
  userId?: string;
  agentId?: string;
  queryText?: string;
  taskKind?: string;
  profile?: string;
}): Promise<SoulWisdomEntry | null> {
  const stored = await loadSoulWisdom(opts.circleId, opts.soulKey);
  if (stored?.body?.trim()) return stored;

  const key = `${opts.circleId}::${opts.soulKey}::synth`;
  const cached = soulWisdomCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < SOUL_WISDOM_TTL_MS) {
    return cached.entry;
  }

  const synthesized = await synthesizeSoulWisdomFromMemories(opts);
  soulWisdomCache.set(key, { entry: synthesized, fetchedAt: Date.now() });
  return synthesized;
}

export async function routeExistingMemoryToSoulKnowledge(opts: {
  memoryId: string;
  circleId: string;
  currentSoulKey?: string | null;
}): Promise<string[]> {
  const { data: memoryRow, error } = await supabase
    .from('memory_entries')
    .select('id, circle_id, title, content, metadata')
    .eq('id', opts.memoryId)
    .single();
  if (error || !memoryRow) return [];

  const routing = decideSoulMemoryRouting({
    text: `${memoryRow.title}\n${memoryRow.content}`,
    currentSoulKey: opts.currentSoulKey || (typeof memoryRow.metadata?.soul_key === 'string' ? memoryRow.metadata.soul_key : null),
  });
  if (!routing.primarySoulKey || routing.ownershipMode === 'agent_core') {
    return [];
  }

  const desiredRows = [
    {
      memory_id: memoryRow.id,
      soul_key: routing.primarySoulKey,
      role: 'primary' as const,
      ownership_mode: routing.ownershipMode,
      confidence: Math.max(0, Math.min(1, routing.confidence)),
      rationale: routing.rationale,
      circle_id: opts.circleId,
    },
    ...(
      routing.ownershipMode === 'shared_multi'
        ? routing.relevantSoulKeys
            .filter((key) => key && key !== routing.primarySoulKey)
            .map((key) => ({
              memory_id: memoryRow.id,
              soul_key: key,
              role: 'shared' as const,
              ownership_mode: 'shared_multi' as const,
              confidence: Math.max(0, Math.min(1, routing.confidence * 0.85)),
              rationale: routing.rationale,
              circle_id: opts.circleId,
            }))
        : []
    ),
  ];

  try {
    const { data: existingLinks } = await supabase
      .from('memory_soul_links')
      .select('soul_key, role')
      .eq('memory_id', memoryRow.id);
    const existingKeys = new Set((existingLinks || []).map((row: any) => `${row.soul_key}:${row.role}`));
    const newRows = desiredRows.filter((row) => !existingKeys.has(`${row.soul_key}:${row.role}`));
    if (newRows.length > 0) {
      await supabase.from('memory_soul_links').insert(newRows);
    }
  } catch {}

  try {
    const nextMetadata = {
      ...(memoryRow.metadata || {}),
      soul_key: routing.primarySoulKey,
      relevant_souls: routing.relevantSoulKeys,
      ownership_mode: routing.ownershipMode,
      soul_confidence: routing.confidence,
      wisdom_candidate: true,
      wisdom_candidate_at: new Date().toISOString(),
    };
    await supabase
      .from('memory_entries')
      .update({ metadata: nextMetadata, updated_at: new Date().toISOString() })
      .eq('id', memoryRow.id);
  } catch {}

  Array.from(new Set(routing.relevantSoulKeys.filter(Boolean))).forEach((soulKey) => {
    invalidateSoulWisdomCache(opts.circleId, soulKey);
  });

  return Array.from(new Set(routing.relevantSoulKeys.filter(Boolean)));
}

// ── Turn-time semantic retrieval ────────────────────────────────────────────
// Phase 2 of AGENT_MEMORY_GOD_PLAN. Given the user's current message, pull
// the memories most likely to help this specific turn. Separate from
// `loadStartupMemory` (which is always-on, generic) — this fires every
// turn with the freshest query vector.
//
// Scoring pipeline:
//   1. Base  = cosine similarity (0..1, from the `match_memories` RPC)
//   2. + Soul boost      — active SOUL's memories get a thumb on the scale
//   3. + Importance bonus — memories the extractor marked high-value
//   4. × Recency decay   — age falls off on a 30-day half-life
//
// Also logs a `memory_access_log` row per injected memory so the UI can
// later answer "which memories informed this response?"

export interface RetrievedMemory {
  id: string;
  title: string;
  content: string;
  memory_kind: string;
  scope: string;
  importance: number;
  similarity: number;    // raw cosine similarity
  score: number;         // post-boost final ranking score
  soul_role?: 'primary' | 'shared' | 'reference' | null;
  task_fit?: 'core' | 'supporting' | 'background' | null;
  reason?: string | null;
  pinned?: boolean;
  helpfulness?: number | null;
  metadata: Record<string, unknown>;
}

const TURN_RETRIEVAL_DEFAULTS = {
  candidatePoolSize: 40,
  finalCount: 12,
  budgetChars: 1500,
  recencyHalfLifeDays: 30,
  soulPrimaryBoost: 0.25,
  soulSharedBoost: 0.10,
  agentCoreBoost: 0.05,
  pinnedBoost: 0.12,
  importanceBonus: 0.15,      // multiplier × importance (0..1)
};

const EXTERNAL_AGENT_MEMORY_SOURCES = new Set([
  'claude_code_bridge',
  'codex_bridge',
  'cursor_bridge',
  'gemini_bridge',
]);

const EXTERNAL_AGENT_PROVIDER_SURFACES: Record<'claude-code' | 'codex' | 'cursor' | 'gemini', string> = {
  'claude-code': 'claude_code_bridge',
  codex: 'codex_bridge',
  cursor: 'cursor_bridge',
  gemini: 'gemini_bridge',
};

const EXTERNAL_AGENT_PROVIDER_LABELS: Record<'claude-code' | 'codex' | 'cursor' | 'gemini', string> = {
  'claude-code': 'CC',
  codex: 'Codex',
  cursor: 'Cursor',
  gemini: 'Gemini',
};

const EXTERNAL_AGENT_SOURCE_LABELS: Record<string, string> = {
  claude_code_bridge: 'Claude Code',
  codex_bridge: 'Codex',
  cursor_bridge: 'Cursor',
  gemini_bridge: 'Gemini',
};

function normalizeExternalProjectKey(projectDir: string): string {
  const project = projectDir.split('/').filter(Boolean).pop() || 'project';
  return project.toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
}

type ExternalAgentKnowledgeSession = {
  sessionId: string;
  projectDir: string;
  model?: string;
  status?: string;
  task?: string;
  lastActivity?: string;
  messageCount?: number;
  recentActions?: string[];
  lastUserMessage?: string;
  lastAssistantText?: string;
  activeFiles?: string[];
  currentToolName?: string;
};

/**
 * Pull the top memories relevant to the current user message, ranked by
 * semantic similarity + SOUL affinity + recency + importance.
 *
 * Returns the formatted markdown block for direct injection into a system
 * prompt AND the raw entries for UI affordances ("why did you say X?").
 */
export async function retrieveForTurn(opts: {
  queryText: string;
  circleId: string;
  userId?: string;
  runId?: string;
  activeSoulKey?: string | null;
  surface?: string;                // e.g. 'main_chat', 'room_chat'
  taskKind?: string;
  profile?: string;
  budgetChars?: number;
  candidatePoolSize?: number;
  finalCount?: number;
}): Promise<{ memories: RetrievedMemory[]; formatted: string }> {
  const cfg = { ...TURN_RETRIEVAL_DEFAULTS, ...opts };
  if (!opts.queryText?.trim() || !opts.circleId) {
    return { memories: [], formatted: '' };
  }

  // Step 1 — embed + candidate search via the Phase 1 semantic RPC
  const { semanticSearchMemories } = await import('./memoryEmbeddings');
  const candidates = await semanticSearchMemories({
    queryText: opts.queryText,
    circleId: opts.circleId,
    limit: cfg.candidatePoolSize,
    matchThreshold: 0, // let every match through; we rank ourselves
  });
  if (candidates.length === 0) return { memories: [], formatted: '' };

  // Step 2 — load soul-link rows for the candidate set in one round-trip.
  // Using a single IN-query avoids N+1; memory_soul_links RLS mirrors
  // memory_entries, so we only see links we'd already see.
  const ids = candidates.map(c => c.id);
  const linksByMemoryId = new Map<string, { soul_key: string; role: string; ownership_mode: string }[]>();
  try {
    const { data: linkRows, error: linkErr } = await supabase
      .from('memory_soul_links')
      .select('memory_id, soul_key, role, ownership_mode')
      .in('memory_id', ids);
    if (!linkErr && linkRows) {
      for (const row of linkRows as any[]) {
        const arr = linksByMemoryId.get(row.memory_id) || [];
        arr.push({ soul_key: row.soul_key, role: row.role, ownership_mode: row.ownership_mode });
        linksByMemoryId.set(row.memory_id, arr);
      }
    }
  } catch { /* missing table just means no soul boost */ }

  const helpfulnessByMemoryId = new Map<string, number>();
  try {
    const { data: evaluationRows, error: evaluationErr } = await supabase
      .from('memory_evaluations')
      .select('memory_id, score, passed, metadata')
      .in('memory_id', ids)
      .eq('evaluation_kind', 'manual_review');
    if (!evaluationErr && evaluationRows) {
      const grouped = new Map<string, number[]>();
      for (const row of evaluationRows as any[]) {
        const metaAction = row.metadata?.action;
        const inferredScore =
          typeof row.score === 'number'
            ? row.score
            : metaAction === 'accepted' || metaAction === 'promoted'
              ? 1
              : metaAction === 'dismissed' || metaAction === 'not_helpful'
                ? 0
                : row.passed === true
                  ? 0.8
                  : row.passed === false
                    ? 0.2
                    : null;
        if (typeof inferredScore !== 'number') continue;
        const arr = grouped.get(row.memory_id) || [];
        arr.push(inferredScore);
        grouped.set(row.memory_id, arr);
      }
      for (const [memoryId, scores] of grouped.entries()) {
        helpfulnessByMemoryId.set(memoryId, scores.reduce((sum, value) => sum + value, 0) / scores.length);
      }
    }
  } catch { /* no eval rows just means neutral helpfulness */ }

  // Step 3 — score each candidate
  const now = Date.now();
  const halfLifeMs = cfg.recencyHalfLifeDays * 24 * 60 * 60 * 1000;

  const scored: RetrievedMemory[] = candidates.map(c => {
    const links = linksByMemoryId.get(c.id) || [];
    let soulBoost = 0;
    let soulRole: RetrievedMemory['soul_role'] = null;

    if (opts.activeSoulKey) {
      const matched = links.find(l => l.soul_key === opts.activeSoulKey);
      if (matched) {
        soulRole = matched.role as any;
        soulBoost = matched.role === 'primary'
          ? cfg.soulPrimaryBoost
          : matched.role === 'shared'
            ? cfg.soulSharedBoost
            : cfg.agentCoreBoost;
      } else if (links.some(l => l.ownership_mode === 'agent_core')) {
        soulBoost = cfg.agentCoreBoost;
      }
    }

    // Soft recency decay — half-life 30 days, floor at 0.6 so old-but-
    // high-similarity memories aren't effectively banned.
    const timestamp = (c as any).updated_at || (c as any).created_at || now;
    const ageMs = Math.max(0, now - new Date(timestamp).getTime());
    const recencyFactor = Math.exp(-Math.LN2 * (ageMs / halfLifeMs));

    const importanceBonus = (c.importance || 0) * cfg.importanceBonus;
    const pinnedBoost = (c as any).pinned ? cfg.pinnedBoost : 0;
    const helpfulness = helpfulnessByMemoryId.get(c.id) ?? null;
    const helpfulnessAdjustment = helpfulness == null ? 0 : (helpfulness - 0.5) * 0.24;
    const taskAffinity = scoreMemoryTaskAffinity(c, opts.taskKind, opts.profile);
    const baseScore = c.similarity + soulBoost + pinnedBoost + importanceBonus + helpfulnessAdjustment + taskAffinity.score;
    const finalScore = baseScore * (0.6 + 0.4 * recencyFactor);

    return {
      id: c.id,
      title: c.title,
      content: c.content,
      memory_kind: c.memory_kind,
      scope: c.scope,
      importance: c.importance,
      similarity: c.similarity,
      score: Number.isFinite(finalScore) ? finalScore : c.similarity,
      pinned: !!(c as any).pinned,
      helpfulness,
      soul_role: soulRole,
      task_fit: taskAffinity.fit,
      reason: buildRetrievedMemoryReason({
        similarity: c.similarity,
        soulRole,
        taskReason: taskAffinity.reason,
        retrievalMode: (c as any).retrieval_mode || null,
      }),
      metadata: c.metadata || {},
    };
  });

  scored.sort((a, b) => b.score - a.score);

  // Step 4 — enforce finalCount AND budgetChars (first one to bite wins)
  const kept: RetrievedMemory[] = [];
  let used = 0;
  for (const mem of scored.slice(0, cfg.finalCount)) {
    const line = `- [${mem.memory_kind}] ${mem.title}: ${mem.content}\n`;
    if (used + line.length > cfg.budgetChars) break;
    kept.push(mem);
    used += line.length;
  }
  if (kept.length === 0) return { memories: [], formatted: '' };

  // Step 5 — log access (best-effort; prompt build doesn't wait on it)
  void (async () => {
    try {
      const rows = kept.map(m => ({
        memory_id: m.id,
        run_id: opts.runId || null,
        user_id: opts.userId || null,
        surface: opts.surface || 'main_chat',
        reason: 'retrieval' as const,
      }));
      await supabase.from('memory_access_log').insert(rows);
    } catch (err) {
      console.warn('[memoryService] access log insert failed:', err);
    }
  })();

  // Step 6 — format for prompt injection
  const header = opts.activeSoulKey
    ? `## Relevant memory (soul: ${opts.activeSoulKey.replace(/^soul:/, '')})`
    : '## Relevant memory';
  const body = kept.map(m => {
    const reason = m.reason ? ` (${m.reason})` : '';
    return `- [${m.memory_kind}] ${m.title}: ${m.content}${reason}`;
  }).join('\n');
  const formatted = `${header}\n${body}`;

  return { memories: kept, formatted };
}

export async function retrieveSoulMemories(opts: {
  circleId: string;
  userId: string;
  soulKey: string;
  limit?: number;
  query?: string;
}): Promise<MemoryEntry[]> {
  const { data } = await supabase
    .from('memory_entries')
    .select('*')
    .eq('circle_id', opts.circleId)
    .eq('scope', 'agent')
    .eq('user_id', opts.userId)
    .eq('visibility', 'private')
    .eq('is_active', true)
    .contains('metadata', { soul_key: opts.soulKey })
    .order('updated_at', { ascending: false })
    .limit(Math.max((opts.limit || 6) * 3, 12));

  const queryTerms = extractSearchTerms((opts.query || '').toLowerCase());
  const scored = (data || [])
    .map(mapMemoryEntry)
    .map((mem) => {
      let score = (mem.importance || 0.5) * 2.2;
      const haystack = `${mem.title} ${mem.content} ${JSON.stringify(mem.metadata || {})}`.toLowerCase();
      for (const term of queryTerms) {
        if (haystack.includes(term)) score += term.length > 5 ? 1.5 : 1;
      }
      const ageDays = (Date.now() - new Date(mem.updated_at || mem.created_at).getTime()) / 86_400_000;
      score += Math.max(0.2, 1.8 - Math.min(1.4, ageDays * 0.03));
      return { mem, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.limit || 6)
    .map((item) => item.mem);

  if (scored.length > 0) {
    logMemoryAccess(scored, opts.userId, 'retrieval');
  }
  return scored;
}

export async function buildPromptMemoryBundle(opts: {
  circleId?: string;
  userId: string;
  query: string;
  roomId?: string;
  agentId?: string;
  agentName?: string;
  spiritId?: string | null;
  surface?: string;
  taskKind?: string;
  profile?: string;
  runId?: string;
  limit?: number;
}): Promise<{ memoryContext: string; references: PromptMemoryReference[] }> {
  if (!opts.circleId) {
    return { memoryContext: '', references: [] };
  }

  const soulInfo = opts.agentId || opts.agentName
    ? await getAgentSoulInfo({
        circleId: opts.circleId,
        agentId: opts.agentId,
        agentName: opts.agentName,
        userId: opts.userId,
      })
    : null;
  const resolvedSoulKey = soulInfo?.soulKey || (opts.spiritId ? `soul:${opts.spiritId}` : null);

  const [startupContext, soulWisdom, externalAgentKnowledge, rankedTurnRetrieval, agentMemories, soulMemories] = await Promise.all([
    loadStartupMemory({
      circleId: opts.circleId,
      userId: opts.userId,
      roomId: opts.roomId,
      agentId: opts.agentId,
    }),
    resolvedSoulKey
      ? loadSoulWisdomWithFallback({
          circleId: opts.circleId,
          soulKey: resolvedSoulKey,
          userId: opts.userId,
          agentId: opts.agentId,
          queryText: opts.query,
          taskKind: opts.taskKind,
          profile: opts.profile,
        })
      : Promise.resolve(null),
    buildExternalAgentKnowledgeBundle({
      circleId: opts.circleId,
      userId: opts.userId,
      query: opts.query,
      taskKind: opts.taskKind,
      profile: opts.profile,
    }),
    retrieveForTurn({
      circleId: opts.circleId,
      userId: opts.userId,
      runId: opts.runId,
      queryText: opts.query,
      activeSoulKey: resolvedSoulKey,
      surface: opts.surface,
      taskKind: opts.taskKind,
      profile: opts.profile,
      finalCount: Math.max(4, opts.limit || 6),
      budgetChars: 1800,
    }),
    opts.agentId
      ? retrieveAgentMemories({
          circleId: opts.circleId,
          userId: opts.userId,
          agentId: opts.agentId,
          agentName: opts.agentName,
          soulKey: resolvedSoulKey || undefined,
          query: opts.query,
          limit: 5,
        })
      : Promise.resolve([]),
    resolvedSoulKey
      ? retrieveSoulMemories({
          circleId: opts.circleId,
          userId: opts.userId,
          soulKey: resolvedSoulKey,
          query: opts.query,
          limit: 4,
        })
      : Promise.resolve([]),
  ]);

  const references = new Map<string, PromptMemoryReference>();
  const rankedTurnReferenceIds = new Set<string>();

  rankedTurnRetrieval.memories.forEach((mem) => {
    rankedTurnReferenceIds.add(mem.id);
    references.set(mem.id, {
      id: mem.id,
      title: mem.title,
      scope: mem.scope as MemoryScope,
      memoryKind: mem.memory_kind as MemoryKind,
      sourceSurface: typeof (mem as any).source_surface === 'string' ? (mem as any).source_surface : null,
      soulKey: typeof mem.metadata?.soul_key === 'string' ? mem.metadata.soul_key : null,
      pinned: typeof (mem as any).pinned === 'boolean' ? (mem as any).pinned : null,
      importance: mem.importance ?? null,
      retrievalMode: typeof (mem as any).retrieval_mode === 'string'
        ? (mem as any).retrieval_mode as any
        : typeof mem.metadata?.retrieval_mode === 'string'
          ? mem.metadata.retrieval_mode as any
          : 'on_demand',
      updatedAt: typeof (mem as any).updated_at === 'string'
        ? (mem as any).updated_at
        : typeof mem.metadata?.updated_at === 'string'
          ? mem.metadata.updated_at
          : null,
      lastAccessedAt: null,
      confidence: typeof mem.metadata?.soul_confidence === 'number' ? mem.metadata.soul_confidence : null,
      score: mem.score,
      taskFit: mem.task_fit || null,
      matchReason: mem.reason || null,
      helpfulness: mem.helpfulness,
      memoryState: (mem as any).retrieval_mode === 'startup' ? 'startup' : 'retrieved',
    });
  });

  [...agentMemories, ...soulMemories].forEach((mem) => {
    if (references.has(mem.id)) return;
    const isSoulMemory = !!getMemorySoulKey(mem);
    references.set(mem.id, {
      id: mem.id,
      title: mem.title,
      scope: mem.scope,
      memoryKind: mem.memory_kind,
      sourceSurface: mem.source_surface || null,
      soulKey: getMemorySoulKey(mem),
      pinned: typeof (mem as any).pinned === 'boolean' ? (mem as any).pinned : null,
      importance: mem.importance ?? null,
      retrievalMode: mem.retrieval_mode ?? null,
      updatedAt: mem.updated_at || mem.created_at,
      lastAccessedAt: mem.last_accessed_at || null,
      confidence: typeof mem.metadata?.soul_confidence === 'number' ? mem.metadata.soul_confidence : null,
      score: null,
      taskFit: isSoulMemory ? 'supporting' : 'background',
      matchReason: isSoulMemory ? 'active soul memory' : 'agent private memory',
      helpfulness: null,
      memoryState: mem.retrieval_mode === 'startup' ? 'startup' : 'supporting',
    });
  });

  externalAgentKnowledge.references.forEach((ref) => {
    if (references.has(ref.id)) return;
    references.set(ref.id, ref);
  });

  const rankedTurnLines = rankedTurnRetrieval.memories
    .slice(0, opts.limit || 8)
    .map((mem) => {
      const soulKey = typeof mem.metadata?.soul_key === 'string' ? mem.metadata.soul_key : null;
      const soulTag = soulKey ? ` [${soulKey.replace(/^soul:/, '')}]` : '';
      const fitTag = mem.task_fit ? ` • ${mem.task_fit}` : '';
      const reasonTag = mem.reason ? ` • ${mem.reason}` : '';
      return `- [${mem.scope}/${mem.memory_kind}]${soulTag}${fitTag}${reasonTag} ${mem.title}: ${mem.content.slice(0, 180)}`;
    });

  const supportingLines = Array.from(references.values())
    .filter((ref) => !rankedTurnReferenceIds.has(ref.id))
    .slice(0, 4)
    .map((ref) => {
      const soulTag = ref.soulKey ? ` [${ref.soulKey.replace(/^soul:/, '')}]` : '';
      return `- [${ref.scope}/${ref.memoryKind}]${soulTag} ${ref.title}: ${ref.matchReason || 'supporting memory'}`;
    });

  const sections = [
    startupContext,
    soulWisdom ? formatSoulWisdomBlock(soulWisdom) : '',
    externalAgentKnowledge.block,
    rankedTurnLines.length > 0 ? `## Relevant Working Memory\n${rankedTurnLines.join('\n')}` : '',
    supportingLines.length > 0 ? `## Supporting Memory\n${supportingLines.join('\n')}` : '',
  ].filter(Boolean);

  return {
    memoryContext: sections.join('\n\n').slice(0, 5000),
    references: Array.from(references.values()).slice(0, opts.limit || 8),
  };
}

async function buildExternalAgentKnowledgeBundle(opts: {
  circleId: string;
  userId: string;
  query: string;
  taskKind?: string;
  profile?: string;
}): Promise<{ block: string; references: PromptMemoryReference[] }> {
  const memories = await loadMemories({
    circleId: opts.circleId,
    userId: opts.userId,
    scopes: ['session'],
    limit: 60,
  });

  const external = memories
    .filter((mem) => mem.is_active !== false)
    .filter((mem) => EXTERNAL_AGENT_MEMORY_SOURCES.has(mem.source_surface || ''))
    .map((mem) => {
      const providerLabel = EXTERNAL_AGENT_SOURCE_LABELS[mem.source_surface || ''] || 'External Agent';
      const taskAffinity = scoreMemoryTaskAffinity(
        {
          title: mem.title,
          content: mem.content,
          memory_kind: mem.memory_kind,
          metadata: mem.metadata || {},
        },
        opts.taskKind,
        opts.profile,
      );
      const queryTerms = extractSearchTerms((opts.query || '').toLowerCase());
      const haystack = `${mem.title}\n${mem.content}\n${JSON.stringify(mem.metadata || {})}`.toLowerCase();
      let queryScore = 0;
      for (const term of queryTerms) {
        if (haystack.includes(term)) queryScore += term.length > 5 ? 0.18 : 0.1;
      }
      const ageDays = (Date.now() - new Date(mem.updated_at || mem.created_at).getTime()) / 86_400_000;
      const recencyBoost = Math.max(0.04, 0.3 - Math.min(0.24, ageDays * 0.015));
      const score = (mem.importance || 0.5) + taskAffinity.score + queryScore + recencyBoost + ((mem.retrieval_mode === 'startup') ? 0.15 : 0);
      return { mem, providerLabel, score, taskAffinity };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);

  if (external.length === 0) {
    return { block: '', references: [] };
  }

  const grouped = new Map<string, typeof external>();
  for (const entry of external) {
    const next = grouped.get(entry.providerLabel) || [];
    next.push(entry);
    grouped.set(entry.providerLabel, next);
  }

  const blockLines: string[] = ['## Knowledge from active external agent sessions'];
  for (const [provider, items] of grouped.entries()) {
    blockLines.push(`### ${provider}`);
    for (const { mem, taskAffinity } of items.slice(0, 2)) {
      const compact = mem.content
        .replace(/^.+?\n/, '')
        .replace(/\s+/g, ' ')
        .slice(0, 220);
      blockLines.push(`- ${mem.title}: ${compact}${taskAffinity.reason ? ` (${taskAffinity.reason})` : ''}`);
    }
  }

  const references: PromptMemoryReference[] = external.map(({ mem, providerLabel, score, taskAffinity }) => ({
    id: mem.id,
    title: mem.title,
    scope: mem.scope,
    memoryKind: mem.memory_kind,
    sourceSurface: mem.source_surface || null,
    soulKey: getMemorySoulKey(mem),
    pinned: typeof (mem as any).pinned === 'boolean' ? (mem as any).pinned : null,
    importance: mem.importance ?? null,
    retrievalMode: mem.retrieval_mode ?? null,
    updatedAt: mem.updated_at || mem.created_at,
    lastAccessedAt: mem.last_accessed_at || null,
    confidence: null,
    score,
    helpfulness: null,
    taskFit: taskAffinity.fit === 'background' ? 'supporting' : taskAffinity.fit,
    matchReason: `${providerLabel} session knowledge${taskAffinity.reason ? ` + ${taskAffinity.reason}` : ''}`,
    memoryState: 'distilled',
  }));

  return {
    block: blockLines.join('\n'),
    references,
  };
}

async function upsertExternalKnowledgeMemory(opts: {
  scope: MemoryScope;
  circleId: string;
  userId?: string;
  title: string;
  content: string;
  memoryKind: MemoryKind;
  visibility: 'private' | 'circle_shared';
  retrievalMode: 'startup' | 'on_demand';
  importance: number;
  sourceSurface: string;
  metadata: Record<string, unknown>;
}): Promise<MemoryEntry | null> {
  let query = supabase
    .from('memory_entries')
    .select('*')
    .eq('circle_id', opts.circleId)
    .eq('scope', opts.scope)
    .eq('source_surface', opts.sourceSurface)
    .eq('title', opts.title)
    .eq('is_active', true)
    .contains('metadata', opts.metadata)
    .limit(1);

  query = opts.scope === 'user'
    ? query.eq('user_id', opts.userId || '')
    : query.is('user_id', null);

  const { data: existingRows } = await query;
  const existing = existingRows?.[0];

  if (existing) {
    const updated_at = new Date().toISOString();
    const { error } = await supabase
      .from('memory_entries')
      .update({
        content: opts.content,
        memory_kind: opts.memoryKind,
        visibility: opts.visibility,
        retrieval_mode: opts.retrievalMode,
        importance: Math.max(existing.importance || 0, opts.importance),
        metadata: {
          ...(existing.metadata || {}),
          ...opts.metadata,
        },
        updated_at,
      })
      .eq('id', existing.id);
    if (error) return null;
    return mapMemoryEntry({
      ...existing,
      content: opts.content,
      memory_kind: opts.memoryKind,
      visibility: opts.visibility,
      retrieval_mode: opts.retrievalMode,
      importance: Math.max(existing.importance || 0, opts.importance),
      metadata: {
        ...(existing.metadata || {}),
        ...opts.metadata,
      },
      updated_at,
    });
  }

  return saveMemoryWithContext({
    scope: opts.scope,
    circleId: opts.circleId,
    userId: opts.scope === 'user' ? opts.userId : undefined,
    memoryKind: opts.memoryKind,
    title: opts.title,
    content: opts.content,
    sourceSurface: opts.sourceSurface,
    visibility: opts.visibility,
    importance: opts.importance,
    retrievalMode: opts.retrievalMode,
    sourceType: 'manual',
    excerpt: opts.content.slice(0, 220),
    evaluation: {
      kind: 'quality',
      score: 0.82,
      feedback: 'Consolidated from repeated external agent session memory.',
      passed: true,
    },
    metadata: opts.metadata,
  });
}

export async function promoteExternalAgentSessionKnowledge(opts: {
  circleId: string;
  userId: string;
  provider: 'claude-code' | 'codex' | 'cursor' | 'gemini';
  sessions: ExternalAgentKnowledgeSession[];
  shareWithCircle?: boolean;
}): Promise<void> {
  if (!opts.circleId || !opts.userId || opts.sessions.length === 0) return;

  const providerSurface = EXTERNAL_AGENT_PROVIDER_SURFACES[opts.provider];
  const providerLabel = EXTERNAL_AGENT_PROVIDER_LABELS[opts.provider];
  const sorted = [...opts.sessions].sort((a, b) => {
    const aTime = a.lastActivity ? new Date(a.lastActivity).getTime() : 0;
    const bTime = b.lastActivity ? new Date(b.lastActivity).getTime() : 0;
    return bTime - aTime;
  });
  const latest = sorted[0];
  const projectKey = normalizeExternalProjectKey(latest.projectDir);
  const project = latest.projectDir.split('/').filter(Boolean).pop() || 'project';
  const recentTasks = sorted
    .map((session) => session.task || session.lastUserMessage || '')
    .filter(Boolean)
    .slice(0, 6);
  const recentResponses = sorted
    .map((session) => session.lastAssistantText || '')
    .filter(Boolean)
    .slice(0, 4);
  const recentActions = Array.from(new Set(
    sorted.flatMap((session) => session.recentActions || []).filter(Boolean),
  )).slice(0, 8);
  const activeFiles = Array.from(new Set(
    sorted.flatMap((session) => session.activeFiles || []).map((file) => file.split('/').pop() || file),
  )).slice(0, 8);
  const currentTools = Array.from(new Set(
    sorted.map((session) => session.currentToolName || '').filter(Boolean),
  )).slice(0, 6);
  const totalMessages = sorted.reduce((sum, session) => sum + (session.messageCount || 0), 0);

  if (recentTasks.length === 0 && recentActions.length === 0 && activeFiles.length === 0) return;

  const sharedContent = [
    `Provider: ${providerLabel}`,
    `Project: ${project}`,
    `Sessions observed: ${sorted.length}`,
    totalMessages > 0 ? `Messages observed: ${totalMessages}` : '',
    recentTasks.length > 0 ? `Recurring work: ${recentTasks.join(' | ').slice(0, 700)}` : '',
    recentActions.length > 0 ? `Typical actions: ${recentActions.join(', ')}` : '',
    currentTools.length > 0 ? `Typical tools: ${currentTools.join(', ')}` : '',
    activeFiles.length > 0 ? `Repeated files: ${activeFiles.join(', ')}` : '',
    recentResponses.length > 0 ? `Useful response patterns: ${recentResponses.join(' | ').slice(0, 700)}` : '',
  ].filter(Boolean).join('\n');

  const userContextContent = [
    `${providerLabel} has active context on ${project}.`,
    recentTasks.length > 0 ? `Current focus: ${recentTasks.join(' | ').slice(0, 420)}` : '',
    activeFiles.length > 0 ? `Files in play: ${activeFiles.join(', ')}` : '',
    recentActions.length > 0 ? `Actions in flight: ${recentActions.join(', ')}` : '',
    latest.model ? `Preferred model: ${latest.model}` : '',
  ].filter(Boolean).join('\n');

  const metadata = {
    source: 'external_agent_session_promotion',
    provider: opts.provider,
    providerLabel,
    projectKey,
    projectDir: latest.projectDir,
    latestTask: recentTasks[0] || null,
    namespace: 'external_agent_shared_pattern',
  };

  await upsertExternalKnowledgeMemory({
    scope: 'user',
    circleId: opts.circleId,
    userId: opts.userId,
    title: `Agent context: ${providerLabel} / ${project}`,
    content: userContextContent,
    memoryKind: 'context',
    visibility: 'private',
    retrievalMode: 'startup',
    importance: 0.84,
    sourceSurface: providerSurface,
    metadata: {
      ...metadata,
      knowledgeKind: 'user_startup_context',
      namespace: 'external_agent_user_context',
    },
  });

  if (opts.shareWithCircle) {
    await upsertExternalKnowledgeMemory({
      scope: 'circle',
      circleId: opts.circleId,
      title: `External agent pattern: ${providerLabel} / ${project}`,
      content: sharedContent,
      memoryKind: 'finding',
      visibility: 'circle_shared',
      retrievalMode: 'on_demand',
      importance: 0.78,
      sourceSurface: providerSurface,
      metadata: {
        ...metadata,
        knowledgeKind: 'shared_project_pattern',
        namespace: 'external_agent_shared_pattern',
      },
    });
  }

  if (recentActions.length >= 2 || activeFiles.length >= 2) {
    try {
      const { saveProceduralMemory } = await import('./memoryConsolidation');
      await saveProceduralMemory({
        circleId: opts.circleId,
        userId: opts.userId,
        taskType: `${providerLabel} / ${project}`,
        outcome: 'success',
        steps: [
          `Open project: ${project}`,
          ...(recentTasks[0] ? [`Focus on: ${recentTasks[0].slice(0, 120)}`] : []),
          ...(activeFiles.length > 0 ? [`Work in files: ${activeFiles.join(', ')}`] : []),
          ...(recentActions.length > 0 ? [`Use actions/tools: ${recentActions.join(', ')}`] : []),
        ],
        learnings: sharedContent.slice(0, 500),
      });
    } catch {}
  }
}

export async function getLatestSpiritMemoryReferences(opts: {
  circleId: string;
  userId: string;
  spiritId?: string | null;
  limit?: number;
}): Promise<PromptMemoryReference[]> {
  const soulKey = opts.spiritId ? `soul:${opts.spiritId}` : null;
  if (!soulKey) return [];

  const memories = await loadMemories({
    circleId: opts.circleId,
    userId: opts.userId,
    scopes: ['agent'],
    limit: Math.max(8, (opts.limit || 4) * 4),
  });

  return memories
    .filter((mem) => getMemorySoulKey(mem) === soulKey && mem.is_active !== false)
    .sort((a, b) => {
      const aUpdated = new Date(a.updated_at || a.created_at).getTime();
      const bUpdated = new Date(b.updated_at || b.created_at).getTime();
      if (bUpdated !== aUpdated) return bUpdated - aUpdated;
      return (b.importance || 0) - (a.importance || 0);
    })
    .slice(0, opts.limit || 4)
    .map((mem) => ({
      id: mem.id,
      title: mem.title,
      scope: mem.scope,
      memoryKind: mem.memory_kind,
      soulKey: getMemorySoulKey(mem),
      importance: mem.importance ?? null,
      retrievalMode: mem.retrieval_mode ?? null,
      updatedAt: mem.updated_at || mem.created_at,
      lastAccessedAt: mem.last_accessed_at || null,
      confidence: typeof mem.metadata?.soul_confidence === 'number' ? mem.metadata.soul_confidence : null,
    }));
}

export async function getSpiritMemoryEntries(opts: {
  circleId: string;
  userId: string;
  spiritId?: string | null;
  query?: string;
  limit?: number;
}): Promise<MemoryEntry[]> {
  const soulKey = opts.spiritId ? `soul:${opts.spiritId}` : null;
  if (!soulKey) return [];

  const memories = await loadMemories({
    circleId: opts.circleId,
    userId: opts.userId,
    scopes: ['agent'],
    limit: Math.max(24, (opts.limit || 12) * 5),
  });

  const query = opts.query?.trim().toLowerCase() || '';
  return memories
    .filter((mem) => getMemorySoulKey(mem) === soulKey && mem.is_active !== false)
    .filter((mem) => {
      if (!query) return true;
      const haystack = `${mem.title}\n${mem.content}\n${mem.metadata?.impactDomain || ''}\n${mem.metadata?.capabilityProfile || ''}`.toLowerCase();
      return haystack.includes(query);
    })
    .sort((a, b) => {
      const aUpdated = new Date(a.updated_at || a.created_at).getTime();
      const bUpdated = new Date(b.updated_at || b.created_at).getTime();
      if (bUpdated !== aUpdated) return bUpdated - aUpdated;
      return (b.importance || 0) - (a.importance || 0);
    })
    .slice(0, opts.limit || 12);
}

export async function captureOpenSwanOutcomeMemory(opts: {
  circleId: string;
  userId: string;
  agentId: string;
  agentName?: string;
  spiritId?: string | null;
  taskKind: string;
  profile: string;
  title: string;
  prompt: string;
  response: string;
  artifacts?: Array<{ kind: string; title: string }>;
  verificationResults?: Array<{ ok: boolean; summary: string }>;
}): Promise<void> {
  const failedChecks = (opts.verificationResults || []).filter((result) => !result.ok);
  const kind: AgentMemoryPromotionKind = failedChecks.length > 0 ? 'blocker' : 'success';
  const source = kind === 'success' ? 'agent_task_completion' : 'agent_task_blocker';
  const namespace = kind === 'success' ? 'agent_private_pattern' : 'agent_private_blocker';
  const artifactLabels = (opts.artifacts || []).slice(0, 4).map((artifact) => `${artifact.kind}:${artifact.title}`);
  const content = [
    `Task kind: ${opts.taskKind}`,
    `Profile: ${opts.profile}`,
    `Prompt shape: ${opts.prompt.slice(0, 260)}`,
    failedChecks.length > 0
      ? `Failure pattern: ${failedChecks.map((check) => check.summary).join('; ')}`
      : `Effective response pattern: ${opts.response.slice(0, 320)}`,
    artifactLabels.length > 0 ? `Typical outputs: ${artifactLabels.join(', ')}` : '',
  ].filter(Boolean).join('\n');

  await saveSoulAwareAgentMemory({
    circleId: opts.circleId,
    userId: opts.userId,
    agentId: opts.agentId,
    agentName: opts.agentName,
    title: `${kind === 'success' ? 'OpenSwan pattern' : 'OpenSwan blocker'}: ${opts.taskKind}/${opts.profile}`,
    content,
    source,
    profileKey: opts.profile,
    importance: kind === 'success' ? 0.74 : 0.69,
    excerpt: failedChecks[0]?.summary || opts.response.slice(0, 220) || opts.title,
    evaluationScore: kind === 'success' ? 0.86 : 0.78,
    feedback: kind === 'success'
      ? 'OpenSwan completion pattern captured from a successful run.'
      : 'OpenSwan blocker pattern captured from a verification failure.',
    namespace,
    sourceType: 'run',
    currentSoulKey: opts.spiritId ? `soul:${opts.spiritId}` : null,
  });

  await promoteAgentMemoriesToSharedPatterns({
    circleId: opts.circleId,
    userId: opts.userId,
    agentId: opts.agentId,
    agentName: opts.agentName,
    profileKey: opts.profile,
    kind,
  });
}

export function buildOpenSwanMemoryRecommendations(opts: {
  taskKind: string;
  profile: string;
  prompt: string;
  response: string;
  spiritId?: string | null;
  memoryReferences?: PromptMemoryReference[];
  verificationResults?: Array<{ ok: boolean; summary: string }>;
  artifacts?: Array<{ kind: string; title: string }>;
}): OpenSwanMemoryRecommendation[] {
  const recommendations: OpenSwanMemoryRecommendation[] = [];
  const failedChecks = (opts.verificationResults || []).filter((result) => !result.ok);
  const soulKey = opts.spiritId ? `soul:${opts.spiritId}` : null;
  const artifactSummary = (opts.artifacts || []).slice(0, 4).map((artifact) => `${artifact.kind}:${artifact.title}`).join(', ');

  if (failedChecks.length > 0) {
    recommendations.push({
      id: `failure-pattern:${opts.taskKind}:${opts.profile}`,
      title: `Save blocker pattern for ${opts.taskKind}/${opts.profile}`,
      content: [
        `Task kind: ${opts.taskKind}`,
        `Profile: ${opts.profile}`,
        `Prompt intent: ${opts.prompt.slice(0, 220)}`,
        `Failure pattern: ${failedChecks.map((check) => check.summary).join('; ')}`,
        artifactSummary ? `Artifacts present: ${artifactSummary}` : '',
      ].filter(Boolean).join('\n'),
      memoryKind: 'finding',
      priority: 'high',
      rationale: 'This run hit a real blocker. Saving it helps OpenSwan avoid repeating the same failure mode.',
      target: 'agent_private',
      source: 'failure_pattern',
      recommendationType: 'save_new',
      soulKey,
      sourceMemoryIds: [],
      importance: 0.82,
      retrievalMode: 'on_demand',
    });
  } else if (opts.response.trim().length >= 140) {
    recommendations.push({
      id: `response-pattern:${opts.taskKind}:${opts.profile}`,
      title: `Save reusable OpenSwan pattern for ${opts.taskKind}/${opts.profile}`,
      content: [
        `Task kind: ${opts.taskKind}`,
        `Profile: ${opts.profile}`,
        `Prompt intent: ${opts.prompt.slice(0, 220)}`,
        `Effective response pattern: ${opts.response.slice(0, 360)}`,
        artifactSummary ? `Typical outputs: ${artifactSummary}` : '',
      ].filter(Boolean).join('\n'),
      memoryKind: 'finding',
      priority: ['build', 'debug', 'architect', 'automation'].includes(opts.taskKind) ? 'high' : 'medium',
      rationale: 'This response pattern looks reusable for similar OpenSwan tasks and can sharpen future runs.',
      target: 'agent_private',
      source: 'response_pattern',
      recommendationType: 'save_new',
      soulKey,
      sourceMemoryIds: [],
      importance: 0.76,
      retrievalMode: 'on_demand',
    });
  }

  const promotableRefs = (opts.memoryReferences || [])
    .filter((ref) =>
      !!ref.id &&
      !ref.pinned &&
      ref.taskFit === 'core' &&
      (ref.importance ?? 0.5) < 0.9 &&
      ref.retrievalMode !== 'startup',
    )
    .sort((a, b) => (b.score ?? b.importance ?? 0) - (a.score ?? a.importance ?? 0))
    .slice(0, 2);

  promotableRefs.forEach((ref) => {
    recommendations.push({
      id: `promote:${ref.id}`,
      title: `Promote memory: ${ref.title}`,
      content: ref.matchReason || ref.title,
      memoryKind: ref.memoryKind,
      priority: 'medium',
      rationale: `${ref.title} was core to this run. Promoting it makes it more likely to stay in OpenSwan’s always-on guidance set.`,
      target: 'promote_existing',
      source: 'guidance_promotion',
      recommendationType: 'promote_existing',
      memoryId: ref.id,
      soulKey: ref.soulKey || null,
      sourceMemoryIds: [ref.id],
      importance: Math.max(0.9, ref.importance ?? 0.75),
      retrievalMode: 'startup',
    });
  });

  const seen = new Set<string>();
  return recommendations.filter((recommendation) => {
    const key = recommendation.memoryId || recommendation.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 3);
}

export async function applyOpenSwanMemoryRecommendation(opts: {
  circleId: string;
  userId: string;
  agentId?: string;
  agentName?: string;
  recommendation: OpenSwanMemoryRecommendation;
}): Promise<boolean> {
  const recommendation = opts.recommendation;
  if (recommendation.recommendationType === 'promote_existing' && recommendation.memoryId) {
    const { promoteMemory, recordMemoryFeedback } = await import('./memoryActions');
    const promoted = await promoteMemory(recommendation.memoryId);
    if (promoted) {
      await recordMemoryFeedback({
        memoryId: recommendation.memoryId,
        action: 'promoted',
        note: recommendation.rationale,
        userId: opts.userId,
        source: 'openswan_recommendation',
      });
    }
    return promoted;
  }

  if (recommendation.target === 'agent_private' && opts.agentId) {
    const saved = await saveSoulAwareAgentMemory({
      circleId: opts.circleId,
      userId: opts.userId,
      agentId: opts.agentId,
      agentName: opts.agentName,
      memoryKind: recommendation.memoryKind,
      title: recommendation.title,
      content: recommendation.content,
      source: recommendation.source,
      importance: recommendation.importance ?? 0.76,
      feedback: recommendation.rationale,
      namespace: recommendation.source === 'failure_pattern' ? 'agent_private_blocker' : 'agent_private_pattern',
      sourceType: 'manual',
      currentSoulKey: recommendation.soulKey || null,
    });
    if (saved) {
      const { recordMemoryFeedback } = await import('./memoryActions');
      await recordMemoryFeedback({
        memoryId: saved.id,
        action: 'accepted',
        note: recommendation.rationale,
        userId: opts.userId,
        source: 'openswan_recommendation',
      });
    }
    return !!saved;
  }

  if (recommendation.target === 'circle_shared') {
    const saved = await saveSharedTaskMemory({
      circleId: opts.circleId,
      userId: opts.userId,
      title: recommendation.title,
      content: recommendation.content,
      source: recommendation.source,
      importance: recommendation.importance ?? 0.72,
      feedback: recommendation.rationale,
    });
    if (saved) {
      const { recordMemoryFeedback } = await import('./memoryActions');
      await recordMemoryFeedback({
        memoryId: saved.id,
        action: 'accepted',
        note: recommendation.rationale,
        userId: opts.userId,
        source: 'openswan_recommendation',
      });
    }
    return !!saved;
  }

  const saved = await saveMemory({
    scope: 'user',
    circleId: opts.circleId,
    userId: opts.userId,
    memoryKind: recommendation.memoryKind,
    title: recommendation.title,
    content: recommendation.content,
    sourceSurface: 'main_chat',
    visibility: 'private',
    importance: recommendation.importance ?? 0.72,
    retrievalMode: recommendation.retrievalMode || 'on_demand',
    metadata: {
      source: recommendation.source,
      rationale: recommendation.rationale,
      soul_key: recommendation.soulKey || null,
      source_memory_ids: recommendation.sourceMemoryIds || [],
    },
  });
  if (saved) {
    const { recordMemoryFeedback } = await import('./memoryActions');
    await recordMemoryFeedback({
      memoryId: saved.id,
      action: 'accepted',
      note: recommendation.rationale,
      userId: opts.userId,
      source: 'openswan_recommendation',
    });
  }
  return !!saved;
}

// ── Archival Retrieval ──────────────────────────────────────────────────────

/**
 * Search archival memory by relevance to a query.
 * Uses keyword matching (upgradeable to embeddings with pgvector later).
 */
export async function retrieveRelevantMemories(opts: {
  circleId: string;
  userId: string;
  query: string;
  roomId?: string;
  limit?: number;
}): Promise<MemoryEntry[]> {
  const query = opts.query.trim().toLowerCase();
  const keywords = extractSearchTerms(query);
  if (keywords.length === 0) return [];

  const candidates = await loadMemories({
    circleId: opts.circleId,
    roomId: opts.roomId,
    userId: opts.userId,
    scopes: ['circle', 'room', 'user', 'session'],
    limit: 120,
  });

  const deduped = new Map<string, MemoryEntry>();
  for (const mem of candidates) {
    const key = `${mem.scope}:${mem.user_id || 'shared'}:${mem.title.trim().toLowerCase()}`;
    const existing = deduped.get(key);
    if (!existing || new Date(mem.created_at).getTime() > new Date(existing.created_at).getTime()) {
      deduped.set(key, mem);
    }
  }

  const scored = Array.from(deduped.values()).map(mem => {
    if (mem.retrieval_mode === 'manual_only') return { mem, score: -1 };

    const titleLower = mem.title.toLowerCase();
    const contentLower = mem.content.toLowerCase();
    const metadataText = JSON.stringify(mem.metadata || {}).toLowerCase();
    const haystacks = [titleLower, contentLower, metadataText];

    let score = 0;
    let matchedTerms = 0;

    for (const kw of keywords) {
      let termHits = 0;
      if (titleLower.includes(kw)) {
        score += kw.length > 5 ? 5 : 4;
        termHits += 1;
      }
      if (contentLower.includes(kw)) {
        score += kw.length > 5 ? 3 : 2;
        termHits += 1;
      }
      if (metadataText.includes(kw)) {
        score += 2;
        termHits += 1;
      }
      if (termHits > 0) matchedTerms += 1;
    }

    if (query.length > 8 && (titleLower.includes(query) || contentLower.includes(query))) {
      score += 8;
    }

    const titleTokens = new Set(titleLower.split(/\W+/).filter(Boolean));
    const overlapRatio = keywords.length > 0
      ? keywords.filter(kw => haystacks.some(h => h.includes(kw))).length / keywords.length
      : 0;
    score += overlapRatio * 6;
    score += Math.min(3, Array.from(titleTokens).filter(t => keywords.includes(t)).length);

    const imp = mem.importance || 0.5;
    score *= (0.65 + imp);

    if (mem.retrieval_mode === 'startup') score *= 1.1;
    if (mem.memory_kind === 'instruction' || mem.memory_kind === 'decision') score *= 1.15;
    if (mem.scope === 'session') score *= 1.08;
    if (mem.scope === 'room' && opts.roomId && mem.room_id === opts.roomId) score *= 1.12;

    const ageMs = Date.now() - new Date(mem.updated_at || mem.created_at).getTime();
    const ageDays = ageMs / 86_400_000;
    const recencyMultiplier =
      mem.memory_kind === 'decision' || mem.memory_kind === 'instruction'
        ? Math.max(0.55, 1.0 - ageDays * 0.003)
        : Math.max(0.3, 1.0 - ageDays * 0.01);
    score *= recencyMultiplier;

    if (matchedTerms === 0) score = -1;

    return { mem, score };
  });

  scored.sort((a, b) => b.score - a.score);

  const results = scored
    .filter(s => s.score > 0)
    .slice(0, opts.limit || 10)
    .map(s => s.mem);

  if (results.length > 0) {
    logMemoryAccess(results, opts.userId, 'retrieval');
  }

  return results;
}

// ── Session Compaction ──────────────────────────────────────────────────────

/**
 * Compact a conversation history into a summary + key facts.
 * Used when conversations get long to keep context manageable.
 */
export async function compactConversation(
  messages: Array<{ role: string; text: string }>,
): Promise<{ summary: string; decisions: string[]; openQuestions: string[] }> {
  const GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY || '';
  if (!GEMINI_API_KEY || messages.length < 6) {
    return { summary: '', decisions: [], openQuestions: [] };
  }

  const transcript = messages.slice(-30).map(m =>
    `${m.role === 'user' ? 'User' : 'Agent'}: ${m.text.slice(0, 200)}`
  ).join('\n');

  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `Analyze this conversation and extract:
1. A concise summary (2-3 sentences max)
2. Key decisions made (array of strings)
3. Open questions still unresolved (array of strings)

Conversation:
${transcript}

Return JSON: { "summary": "...", "decisions": ["..."], "openQuestions": ["..."] }
Return ONLY the JSON, no other text.` }] }],
          generationConfig: { maxOutputTokens: 512, temperature: 0.1 },
        }),
      },
    );

    if (!resp.ok) return { summary: '', decisions: [], openQuestions: [] };
    const data = await resp.json();
    let text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    text = text.replace(/^```json?\n?/i, '').replace(/\n?```$/i, '').trim();
    const parsed = JSON.parse(text);
    return {
      summary: parsed.summary || '',
      decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
      openQuestions: Array.isArray(parsed.openQuestions) ? parsed.openQuestions : [],
    };
  } catch {
    return { summary: '', decisions: [], openQuestions: [] };
  }
}

/**
 * Save compacted session state as memories.
 */
export async function saveCompactedSession(
  circleId: string,
  userId: string,
  compact: { summary: string; decisions: string[]; openQuestions: string[] },
): Promise<void> {
  // Save summary
  if (compact.summary) {
    await saveMemory({
      scope: 'session', circleId, userId,
      memoryKind: 'context',
      title: `Session summary ${new Date().toLocaleDateString()}`,
      content: compact.summary,
      sourceSurface: 'main_chat',
      visibility: 'private',
      importance: 0.7,
      retrievalMode: 'startup',
    });
  }

  // Save decisions as durable circle-level memories
  for (const decision of compact.decisions.slice(0, 5)) {
    await saveMemory({
      scope: 'circle', circleId,
      memoryKind: 'decision',
      title: decision.slice(0, 60),
      content: decision,
      sourceSurface: 'main_chat',
      visibility: 'circle_shared',
      importance: 0.85,
      retrievalMode: 'startup',
    });
  }

  // Save open questions as session-level memories
  if (compact.openQuestions.length > 0) {
    await saveMemory({
      scope: 'session', circleId, userId,
      memoryKind: 'context',
      title: 'Open questions',
      content: compact.openQuestions.map(q => `- ${q}`).join('\n'),
      sourceSurface: 'main_chat',
      visibility: 'private',
      importance: 0.55,
      retrievalMode: 'startup',
    });
  }
}

// ── Memory Evaluation ───────────────────────────────────────────────────────

/**
 * Simple evaluator: should this memory be kept, updated, or discarded?
 */
export function evaluateMemoryCandidate(
  candidate: { kind: string; title: string; content: string },
  existing: MemoryEntry[],
): 'save' | 'update' | 'skip' {
  // Too short to be useful
  if (candidate.content.length < 10) return 'skip';
  // Too generic
  if (/^(yes|no|ok|sure|thanks|got it)$/i.test(candidate.content.trim())) return 'skip';

  // Check for contradiction with existing
  const titleLower = candidate.title.toLowerCase();
  const match = existing.find(e => {
    const t = e.title.toLowerCase();
    return t === titleLower || t.includes(titleLower) || titleLower.includes(t);
  });

  if (match) {
    // Content changed → update
    if (match.content.toLowerCase() !== candidate.content.toLowerCase()) return 'update';
    // Same content → skip
    return 'skip';
  }

  return 'save';
}

function normalizeRememberContent(content: string): string {
  return content
    .trim()
    .replace(/^["']+|["']+$/g, '')
    .replace(/\s+/g, ' ');
}

function inferRememberKind(content: string): MemoryKind {
  const lower = content.toLowerCase();

  if (
    /\b(always|never|treat every request|optimi[sz]e for|reason thoroughly|think step-by-step|consider tradeoffs|provide comprehensive analysis)\b/.test(lower) ||
    /\bhow i want you\b/.test(lower)
  ) {
    return 'instruction';
  }

  if (
    /\b(i prefer|i like|i want|my preference|prefer)\b/.test(lower)
  ) {
    return 'preference';
  }

  if (/\b(decided|decision|we use|our stack|project uses)\b/.test(lower)) {
    return 'decision';
  }

  return 'fact';
}

function buildRememberTitle(content: string, kind: MemoryKind): string {
  const lower = content.toLowerCase();

  if (
    /\b(reason thoroughly|think step-by-step|consider tradeoffs|comprehensive analysis)\b/.test(lower)
  ) {
    return 'Response Standard: Deep Thorough Reasoning';
  }

  if (kind === 'instruction') return `Instruction: ${content.slice(0, 44)}`.trim();
  if (kind === 'preference') return `Preference: ${content.slice(0, 45)}`.trim();
  if (kind === 'decision') return `Decision: ${content.slice(0, 47)}`.trim();
  return content.slice(0, 60).replace(/\n/g, ' ');
}

function slugifyMemoryKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64) || 'memory';
}

function inferExplicitMemoryKey(content: string, kind: MemoryKind): string {
  const lower = content.toLowerCase();

  if (
    /\b(reason thoroughly|think step-by-step|consider tradeoffs|comprehensive analysis)\b/.test(lower)
  ) {
    return 'response_standard.deep_thorough_reasoning';
  }

  return `${kind}.${slugifyMemoryKey(content.slice(0, 80))}`;
}

function memorySimilarityScore(a: string, b: string): number {
  const aa = a.toLowerCase().trim();
  const bb = b.toLowerCase().trim();
  if (!aa || !bb) return 0;
  if (aa === bb) return 1;
  if (aa.includes(bb) || bb.includes(aa)) return 0.92;

  const aTerms = new Set(aa.split(/\W+/).filter(Boolean));
  const bTerms = new Set(bb.split(/\W+/).filter(Boolean));
  if (aTerms.size === 0 || bTerms.size === 0) return 0;

  let overlap = 0;
  for (const term of aTerms) {
    if (bTerms.has(term)) overlap++;
  }
  return overlap / Math.min(aTerms.size, bTerms.size);
}

function scoreMemoryTaskAffinity(
  candidate: {
    title?: string | null;
    content?: string | null;
    memory_kind?: string | null;
    metadata?: Record<string, unknown> | null;
  },
  taskKind?: string,
  profile?: string,
): { score: number; fit: 'core' | 'supporting' | 'background'; reason: string | null } {
  const haystack = [
    candidate.title || '',
    candidate.content || '',
    candidate.memory_kind || '',
    JSON.stringify(candidate.metadata || {}),
    taskKind || '',
    profile || '',
  ].join('\n').toLowerCase();

  let score = 0;
  let reason: string | null = null;

  const add = (delta: number, nextReason: string) => {
    if (delta > score || !reason) reason = nextReason;
    score += delta;
  };

  if (taskKind === 'debug') {
    if (/\b(blocker|failure|failed|error|regression|verification|fix|root cause)\b/.test(haystack)) add(0.28, 'recent blocker pattern');
    if (/\b(decision|instruction|preference)\b/.test(haystack)) add(0.08, 'durable debugging guidance');
  } else if (taskKind === 'build') {
    if (/\b(pattern|effective response pattern|successful|completion|output|artifact|deliverable)\b/.test(haystack)) add(0.24, 'successful execution pattern');
    if (/\b(decision|instruction|preference)\b/.test(haystack)) add(0.08, 'durable implementation guidance');
  } else if (taskKind === 'architect') {
    if (/\b(decision|instruction|preference|constraint|standard|architecture|system)\b/.test(haystack)) add(0.26, 'durable design guidance');
    if (/\b(pattern|shared pattern)\b/.test(haystack)) add(0.09, 'reusable system pattern');
  } else if (taskKind === 'review') {
    if (/\b(blocker|failure|checklist|verification|compliance|review)\b/.test(haystack)) add(0.24, 'review risk pattern');
    if (/\b(decision|instruction|standard)\b/.test(haystack)) add(0.08, 'review baseline');
  } else if (taskKind === 'research') {
    if (/\b(research|source|finding|evidence|summary|reference|citation)\b/.test(haystack)) add(0.22, 'evidence memory');
    if (/\b(decision|instruction)\b/.test(haystack)) add(0.06, 'research guidance');
  } else if (taskKind === 'automation') {
    if (/\b(schedule|automation|workflow|task|room|approval|integration)\b/.test(haystack)) add(0.21, 'automation pattern');
    if (/\b(blocker|failure)\b/.test(haystack)) add(0.08, 'known automation blocker');
  } else {
    if (/\b(decision|instruction|preference)\b/.test(haystack)) add(0.12, 'durable user guidance');
  }

  if (score >= 0.22) return { score, fit: 'core', reason };
  if (score >= 0.1) return { score, fit: 'supporting', reason };
  return { score, fit: 'background', reason };
}

function buildRetrievedMemoryReason(opts: {
  similarity: number;
  soulRole?: RetrievedMemory['soul_role'];
  taskReason?: string | null;
  retrievalMode?: string | null;
}): string {
  const parts: string[] = [];
  if (opts.taskReason) parts.push(opts.taskReason);
  if (opts.soulRole === 'primary') parts.push('active soul memory');
  else if (opts.soulRole === 'shared') parts.push('shared soul memory');
  else if (opts.retrievalMode === 'startup') parts.push('startup guidance');
  else if (opts.similarity >= 0.8) parts.push('strong semantic match');
  else parts.push('semantic match');
  return parts.slice(0, 2).join(' + ');
}

function buildAgentMemoryGroupKey(opts: {
  agentId: string;
  source: string;
  namespace?: string;
  taskId?: string;
  profileKey?: string;
  impactDomain?: string;
  title: string;
  content: string;
}): string {
  return [
    opts.agentId,
    opts.source,
    opts.namespace || '',
    opts.taskId || '',
    opts.profileKey || '',
    opts.impactDomain || '',
    slugifyMemoryKey(opts.title.slice(0, 80)),
    slugifyMemoryKey(opts.content.slice(0, 120)),
  ].join('::');
}

function buildAgentMemoryFingerprint(groupKey: string, soulKey?: string | null): string {
  return `${groupKey}::${soulKey || 'agent_core'}`;
}

async function upsertAgentMemoryTarget(opts: {
  circleId: string;
  userId: string;
  agentId: string;
  memoryKind: MemoryKind;
  title: string;
  content: string;
  sourceSurface: string;
  importance: number;
  retrievalMode: 'startup' | 'on_demand' | 'manual_only';
  sourceType?: 'message' | 'run' | 'step' | 'artifact' | 'approval' | 'manual';
  sourceId?: string;
  excerpt?: string;
  evaluationScore?: number;
  feedback?: string;
  metadata: Record<string, unknown>;
  groupKey: string;
  soulKey?: string | null;
}): Promise<MemoryEntry | null> {
  const fingerprint = buildAgentMemoryFingerprint(opts.groupKey, opts.soulKey);
  const nextMetadata = {
    ...opts.metadata,
    memory_group_key: opts.groupKey,
    memory_fingerprint: fingerprint,
  };

  const { data: existingRows } = await supabase
    .from('memory_entries')
    .select('*')
    .eq('circle_id', opts.circleId)
    .eq('scope', 'agent')
    .eq('user_id', opts.userId)
    .eq('agent_id', opts.agentId)
    .eq('visibility', 'private')
    .eq('is_active', true)
    .contains('metadata', { memory_fingerprint: fingerprint })
    .limit(1);

  const existing = existingRows?.[0];
  if (existing) {
    const updated_at = new Date().toISOString();
    const { error } = await supabase
      .from('memory_entries')
      .update({
        title: opts.title,
        content: opts.content,
        memory_kind: opts.memoryKind,
        importance: Math.max(existing.importance || 0, opts.importance),
        retrieval_mode: opts.retrievalMode,
        metadata: {
          ...(existing.metadata || {}),
          ...nextMetadata,
        },
        updated_at,
      })
      .eq('id', existing.id);

    if (error) return null;
    return {
      ...existing,
      title: opts.title,
      content: opts.content,
      memory_kind: opts.memoryKind,
      importance: Math.max(existing.importance || 0, opts.importance),
      retrieval_mode: opts.retrievalMode,
      metadata: {
        ...(existing.metadata || {}),
        ...nextMetadata,
      },
      updated_at,
    };
  }

  return saveMemoryWithContext({
    scope: 'agent',
    circleId: opts.circleId,
    agentId: opts.agentId,
    userId: opts.userId,
    memoryKind: opts.memoryKind,
    title: opts.title,
    content: opts.content,
    sourceSurface: opts.sourceSurface,
    visibility: 'private',
    importance: opts.importance,
    retrievalMode: opts.retrievalMode,
    sourceType: opts.sourceType || 'run',
    sourceId: opts.sourceId,
    excerpt: opts.excerpt,
    evaluation: {
      kind: 'quality',
      score: opts.evaluationScore,
      feedback: opts.feedback,
      passed: (opts.evaluationScore ?? 0.75) >= 0.6,
    },
    metadata: nextMetadata,
  });
}

async function upsertExplicitMemory(opts: {
  circleId: string;
  userId?: string;
  scope: MemoryScope;
  memoryKind: MemoryKind;
  title: string;
  content: string;
  visibility: 'private' | 'room_shared' | 'circle_shared' | 'org_shared';
  retrievalMode: 'startup' | 'on_demand' | 'manual_only';
  importance: number;
  key: string;
  sourceSurface?: string;
}): Promise<MemoryEntry | null> {
  const metadata = {
    source: 'explicit_user_memory',
    namespace: opts.retrievalMode === 'startup' ? 'startup_bundle' : 'session_resume',
    memory_type: opts.key,
  };

  let existingQuery = supabase
    .from('memory_entries')
    .select('*')
    .eq('circle_id', opts.circleId)
    .eq('scope', opts.scope)
    .eq('is_active', true)
    .contains('metadata', { memory_type: opts.key, source: 'explicit_user_memory' })
    .limit(1);

  if (opts.scope === 'user' || opts.scope === 'agent' || opts.scope === 'session') {
    if (!opts.userId) return null;
    existingQuery = existingQuery.eq('user_id', opts.userId);
  }

  const { data: keyedRows } = await existingQuery;
  const keyed = keyedRows?.[0];

  if (keyed) {
    const updatedAt = new Date().toISOString();
    const { error } = await supabase
      .from('memory_entries')
      .update({
        title: opts.title,
        content: opts.content,
        memory_kind: opts.memoryKind,
        visibility: opts.visibility,
        importance: opts.importance,
        retrieval_mode: opts.retrievalMode,
        source_surface: opts.sourceSurface || 'main_chat',
        metadata: {
          ...(keyed.metadata || {}),
          ...metadata,
        },
        is_active: true,
        updated_at: updatedAt,
      })
      .eq('id', keyed.id);

    return error ? null : {
      ...keyed,
      title: opts.title,
      content: opts.content,
      memory_kind: opts.memoryKind,
      visibility: opts.visibility,
      importance: opts.importance,
      retrieval_mode: opts.retrievalMode,
      source_surface: opts.sourceSurface || 'main_chat',
      metadata: {
        ...(keyed.metadata || {}),
        ...metadata,
      },
      is_active: true,
      updated_at: updatedAt,
    };
  }

  return saveMemory({
    scope: opts.scope,
    circleId: opts.circleId,
    userId: opts.scope === 'user' || opts.scope === 'session' || opts.scope === 'agent' ? opts.userId : undefined,
    memoryKind: opts.memoryKind,
    title: opts.title,
    content: opts.content,
    sourceSurface: opts.sourceSurface || 'main_chat',
    visibility: opts.visibility,
    importance: opts.importance,
    retrievalMode: opts.retrievalMode,
    metadata,
  });
}

export async function saveResponseStandardMemory(
  circleId: string,
  userId: string,
  content = 'Always reason thoroughly and deeply. Treat every request as complex unless I explicitly say otherwise. Never optimize for brevity at the expense of quality. Think step-by-step, consider tradeoffs, and provide comprehensive analysis.',
): Promise<MemoryEntry | null> {
  const normalizedContent = normalizeRememberContent(content);

  return upsertExplicitMemory({
    circleId,
    userId,
    scope: 'user',
    memoryKind: 'instruction',
    title: 'Response Standard: Deep Thorough Reasoning',
    content: normalizedContent,
    visibility: 'private',
    retrievalMode: 'startup',
    importance: 0.95,
    key: 'response_standard.deep_thorough_reasoning',
    sourceSurface: 'main_chat',
  });
}

// ── Remember / Forget Actions ───────────────────────────────────────────────

/**
 * Explicitly remember something from chat.
 */
export async function rememberFromChat(
  circleId: string,
  userId: string,
  content: string,
  kind?: MemoryKind,
): Promise<MemoryEntry | null> {
  const normalizedContent = normalizeRememberContent(content);
  const inferredKind = kind || inferRememberKind(normalizedContent);
  const title = buildRememberTitle(normalizedContent, inferredKind);
  const isPrivate = inferredKind === 'preference' || inferredKind === 'instruction' || inferredKind === 'context';
  const scope = isPrivate ? 'user' : 'circle';
  const visibility = isPrivate ? 'private' : 'circle_shared';
  const retrievalMode = ['instruction', 'preference', 'context'].includes(inferredKind) ? 'startup' : 'on_demand';
  const importance = inferredKind === 'instruction' ? 0.95 : inferredKind === 'preference' ? 0.85 : inferredKind === 'decision' ? 0.85 : 0.65;
  const explicitKey = inferExplicitMemoryKey(normalizedContent, inferredKind);

  const explicitSaved = await upsertExplicitMemory({
    circleId,
    userId: isPrivate ? userId : undefined,
    scope,
    memoryKind: inferredKind,
    title,
    content: normalizedContent,
    visibility,
    retrievalMode,
    importance,
    key: explicitKey,
    sourceSurface: 'main_chat',
  });
  if (explicitSaved) return explicitSaved;

  const existing = await loadMemories({
    circleId,
    userId,
    scopes: isPrivate ? ['user'] : ['circle'],
    limit: 80,
  });

  const duplicate = existing.find(mem => {
    if (mem.scope !== scope) return false;
    if (isPrivate && mem.user_id !== userId) return false;
    if (!isPrivate && mem.scope !== 'circle') return false;

    const titleScore = memorySimilarityScore(mem.title, title);
    const contentScore = memorySimilarityScore(mem.content, normalizedContent);
    return titleScore >= 0.88 || contentScore >= 0.82;
  });

  if (duplicate) {
    const { error } = await supabase
      .from('memory_entries')
      .update({
        title,
        content: normalizedContent,
        memory_kind: inferredKind,
        retrieval_mode: retrievalMode,
        importance,
        visibility,
        updated_at: new Date().toISOString(),
      })
      .eq('id', duplicate.id)
      ;

    return error ? null : {
      ...duplicate,
      title,
      content: normalizedContent,
      memory_kind: inferredKind,
      retrieval_mode: retrievalMode,
      importance,
      visibility,
      updated_at: new Date().toISOString(),
    };
  }

  return saveMemory({
    scope,
    circleId,
    userId: isPrivate ? userId : undefined,
    memoryKind: inferredKind,
    title,
    content: normalizedContent,
    sourceSurface: 'main_chat',
    visibility,
    importance,
    retrievalMode,
  });
}

/**
 * Forget a specific memory by searching for it.
 */
export async function forgetFromChat(
  circleId: string,
  userId: string,
  query: string,
): Promise<{ forgotten: number }> {
  const { data } = await supabase
    .from('memory_entries')
    .select('id, scope, user_id')
    .eq('circle_id', circleId)
    .eq('is_active', true)
    .or(`title.ilike.%${query}%,content.ilike.%${query}%`)
    .limit(12);

  if (!data || data.length === 0) return { forgotten: 0 };

  const owned = data.filter(row =>
    row.scope === 'circle' ||
    (!!userId && row.user_id === userId && (row.scope === 'user' || row.scope === 'session' || row.scope === 'agent'))
  ).slice(0, 5);

  if (owned.length === 0) return { forgotten: 0 };

  let forgotten = 0;
  for (const row of owned) {
    const { error } = await supabase
      .from('memory_entries')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', row.id);
    if (!error) forgotten++;
  }

  return { forgotten };
}

export async function retrieveAgentMemories(opts: {
  circleId: string;
  userId: string;
  agentId: string;
  agentName?: string;
  types?: string[];
  limit?: number;
  soulKey?: string;
  query?: string;
}): Promise<MemoryEntry[]> {
  const agentScopedMemories = await loadMemories({
    circleId: opts.circleId,
    agentId: opts.agentId,
    userId: opts.userId,
    scopes: ['agent'],
    limit: 120,
  });

  const legacyMemories = await loadMemories({
    circleId: opts.circleId,
    userId: opts.userId,
    scopes: ['user'],
    limit: 120,
  });

  const memories = [
    ...agentScopedMemories,
    ...legacyMemories.filter(mem => mem.metadata?.agentId === opts.agentId),
  ];
  const activeSoulKey = opts.soulKey || (await getAgentSoulInfo({
    circleId: opts.circleId,
    agentId: opts.agentId,
    agentName: opts.agentName,
    userId: opts.userId,
  })).soulKey;
  const queryTerms = extractSearchTerms((opts.query || '').toLowerCase());

  const allowedTypes = new Set(opts.types || []);
  const deduped = new Map<string, MemoryEntry>();
  for (const mem of memories) {
    const key = String(mem.metadata?.memory_group_key || mem.id || `${mem.scope}:${mem.agent_id || mem.metadata?.agentId || 'unknown'}:${mem.title}`);
    const existing = deduped.get(key);
    const existingSoulKey = existing ? getMemorySoulKey(existing) : null;
    const memSoulKey = getMemorySoulKey(mem);
    const existingBoost = activeSoulKey && existingSoulKey === activeSoulKey ? 3 : !existingSoulKey ? 1 : 0;
    const memBoost = activeSoulKey && memSoulKey === activeSoulKey ? 3 : !memSoulKey ? 1 : 0;
    if (
      !existing ||
      memBoost > existingBoost ||
      (
        memBoost === existingBoost &&
        new Date(mem.updated_at || mem.created_at).getTime() > new Date(existing.updated_at || existing.created_at).getTime()
      )
    ) {
      deduped.set(key, mem);
    }
  }

  return Array.from(deduped.values())
    .filter(mem => (mem.agent_id || mem.metadata?.agentId) === opts.agentId)
    .filter(mem => allowedTypes.size === 0 || allowedTypes.has(String(mem.metadata?.source || '')))
    .map(mem => {
      let score = 0;
      const soulKey = getMemorySoulKey(mem);
      const relevantSouls = Array.isArray(mem.metadata?.relevant_souls)
        ? mem.metadata!.relevant_souls.filter((item): item is string => typeof item === 'string')
        : [];
      const ownershipMode = String(mem.metadata?.soul_memory_mode || '');
      if (activeSoulKey && soulKey === activeSoulKey) score += 7;
      else if (activeSoulKey && relevantSouls.includes(activeSoulKey)) score += ownershipMode === 'shared_multi' ? 4.5 : 3;
      else if (!soulKey) score += 2.5;
      else score += 0.4;

      score += (mem.importance || 0.5) * 2;

      if (queryTerms.length > 0) {
        const haystack = `${mem.title} ${mem.content} ${JSON.stringify(mem.metadata || {})}`.toLowerCase();
        for (const term of queryTerms) {
          if (haystack.includes(term)) score += term.length > 5 ? 1.4 : 0.9;
        }
      }

      const ageDays = (Date.now() - new Date(mem.updated_at || mem.created_at).getTime()) / 86_400_000;
      score += Math.max(0.2, 2 - Math.min(1.7, ageDays * 0.035));
      return { mem, score };
    })
    .sort((a, b) => b.score - a.score)
    .map(item => item.mem)
    .slice(0, opts.limit || 10);
}

export async function retrieveTaskMemories(opts: {
  circleId: string;
  userId?: string;
  profileKey?: string;
  impactDomain?: string;
  taskId?: string;
  namespaces?: MemoryNamespace[];
  limit?: number;
  query?: string;
}): Promise<MemoryEntry[]> {
  const memories = await loadMemories({
    circleId: opts.circleId,
    userId: opts.userId,
    scopes: ['circle'],
    limit: 120,
  });

  const allowedNamespaces = new Set(opts.namespaces || []);
  const searchTerms = extractSearchTerms((opts.query || '').toLowerCase());

  const scored = memories
    .filter(mem => {
      const namespace = String(mem.metadata?.namespace || '');
      if (allowedNamespaces.size > 0 && !allowedNamespaces.has(namespace as MemoryNamespace)) return false;
      if (opts.profileKey && mem.metadata?.capabilityProfile === opts.profileKey) return true;
      if (opts.impactDomain && mem.metadata?.impactDomain === opts.impactDomain) return true;
      if (opts.taskId && mem.metadata?.taskId === opts.taskId) return true;
      return !opts.profileKey && !opts.impactDomain && !opts.taskId;
    })
    .map(mem => {
      let score = mem.importance || 0.5;
      if (opts.profileKey && mem.metadata?.capabilityProfile === opts.profileKey) score += 2.5;
      if (opts.impactDomain && mem.metadata?.impactDomain === opts.impactDomain) score += 1.8;
      if (opts.taskId && mem.metadata?.taskId === opts.taskId) score += 1.5;

      const haystack = `${mem.title} ${mem.content} ${JSON.stringify(mem.metadata || {})}`.toLowerCase();
      for (const term of searchTerms) {
        if (haystack.includes(term)) score += term.length > 5 ? 1.2 : 0.8;
      }

      const ageMs = Date.now() - new Date(mem.updated_at || mem.created_at).getTime();
      const ageDays = ageMs / 86_400_000;
      score *= Math.max(0.4, 1 - ageDays * 0.01);

      return { mem, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.limit || 8)
    .map(item => item.mem);

  if (scored.length > 0) {
    logMemoryAccess(scored, opts.userId, 'retrieval');
  }

  return scored;
}

export async function saveAgentMemory(opts: {
  circleId: string;
  userId: string;
  agentId: string;
  agentName?: string;
  memoryKind?: MemoryKind;
  title: string;
  content: string;
  source: string;
  profileKey?: string;
  taskId?: string;
  importance?: number;
  excerpt?: string;
  sourceType?: 'message' | 'run' | 'step' | 'artifact' | 'approval' | 'manual';
  sourceId?: string;
  evaluationScore?: number;
  feedback?: string;
  namespace?: MemoryNamespace;
  impactDomain?: string;
  soulKey?: string | null;
  soulLabel?: string | null;
  relevantSoulKeys?: string[];
  ownershipMode?: 'exclusive' | 'shared_multi' | 'agent_core';
  routingConfidence?: number;
  routingRationale?: string;
}): Promise<MemoryEntry | null> {
  const groupKey = buildAgentMemoryGroupKey({
    agentId: opts.agentId,
    source: opts.source,
    namespace: opts.namespace,
    taskId: opts.taskId,
    profileKey: opts.profileKey,
    impactDomain: opts.impactDomain,
    title: opts.title,
    content: opts.content,
  });
  const targets = Array.from(new Set([
    opts.soulKey || null,
    ...((opts.relevantSoulKeys || []).filter(Boolean)),
  ].filter(Boolean))) as string[];

  const primary = await upsertAgentMemoryTarget({
    circleId: opts.circleId,
    userId: opts.userId,
    agentId: opts.agentId,
    memoryKind: opts.memoryKind || 'finding',
    title: opts.title,
    content: opts.content,
    sourceSurface: 'feed_task',
    importance: opts.importance ?? 0.7,
    retrievalMode: opts.memoryKind === 'instruction' ? 'startup' : 'on_demand',
    sourceType: opts.sourceType || 'run',
    sourceId: opts.sourceId,
    excerpt: opts.excerpt,
    evaluationScore: opts.evaluationScore,
    feedback: opts.feedback,
    groupKey,
    soulKey: opts.soulKey || null,
    metadata: {
      source: opts.source,
      taskId: opts.taskId || null,
      capabilityProfile: opts.profileKey || null,
      impactDomain: opts.impactDomain || null,
      agentId: opts.agentId,
      agentName: opts.agentName || null,
      namespace: opts.namespace || inferNamespace(opts.source),
      access: 'agent_private',
      soul_key: opts.soulKey || null,
      soul_label: opts.soulLabel || null,
      relevant_souls: targets,
      soul_memory_mode: opts.ownershipMode || (targets.length > 1 ? 'shared_multi' : opts.soulKey ? 'exclusive' : 'agent_core'),
      soul_routing_confidence: opts.routingConfidence ?? null,
      soul_routing_rationale: opts.routingRationale || null,
    },
  });
  if (!primary) return null;

  const extraTargets = targets.filter(key => key !== (opts.soulKey || null));
  for (const soulKey of extraTargets.slice(0, 2)) {
    void upsertAgentMemoryTarget({
      circleId: opts.circleId,
      userId: opts.userId,
      agentId: opts.agentId,
      memoryKind: opts.memoryKind || 'finding',
      title: opts.title,
      content: opts.content,
      sourceSurface: 'feed_task',
      importance: Math.max(0.55, (opts.importance ?? 0.7) - 0.05),
      retrievalMode: opts.memoryKind === 'instruction' ? 'startup' : 'on_demand',
      sourceType: opts.sourceType || 'run',
      sourceId: opts.sourceId,
      excerpt: opts.excerpt,
      groupKey,
      soulKey,
      metadata: {
        source: `${opts.source}_cross_soul`,
        taskId: opts.taskId || null,
        capabilityProfile: opts.profileKey || null,
        impactDomain: opts.impactDomain || null,
        agentId: opts.agentId,
        agentName: opts.agentName || null,
        namespace: opts.namespace || inferNamespace(opts.source),
        access: 'agent_private',
        soul_key: soulKey,
        soul_label: soulKey.replace(/^soul:/, ''),
        relevant_souls: targets,
        cross_soul_learning: true,
        soul_memory_mode: 'shared_multi',
        soul_routing_confidence: opts.routingConfidence ?? null,
        soul_routing_rationale: opts.routingRationale || null,
      },
    });
  }

  return primary;
}

export async function saveSoulAwareAgentMemory(opts: {
  circleId: string;
  userId: string;
  agentId: string;
  agentName?: string;
  memoryKind?: MemoryKind;
  title: string;
  content: string;
  source: string;
  importance?: number;
  excerpt?: string;
  sourceType?: 'message' | 'run' | 'step' | 'artifact' | 'approval' | 'manual';
  sourceId?: string;
  evaluationScore?: number;
  feedback?: string;
  namespace?: MemoryNamespace;
  impactDomain?: string;
  profileKey?: string;
  taskId?: string;
  currentSoulKey?: string | null;
}): Promise<MemoryEntry | null> {
  const resolvedSoulKey = opts.currentSoulKey || (await getAgentSoulInfo({
    circleId: opts.circleId,
    agentId: opts.agentId,
    agentName: opts.agentName,
    userId: opts.userId,
  })).soulKey;
  const routing = (opts.importance ?? 0.7) >= 0.6
    ? decideSoulMemoryRouting({
        text: `${opts.title}\n${opts.content}`,
        currentSoulKey: resolvedSoulKey,
      })
    : {
        primarySoulKey: resolvedSoulKey,
        relevantSoulKeys: resolvedSoulKey ? [resolvedSoulKey] : [],
        ownershipMode: resolvedSoulKey ? 'exclusive' as const : 'agent_core' as const,
        confidence: resolvedSoulKey ? 0.6 : 0.3,
        rationale: resolvedSoulKey
          ? 'The memory stays with the current Soul because the importance score is low.'
          : 'The memory stays in agent core because there is no current Soul and the importance score is low.',
      };
  return saveAgentMemory({
    ...opts,
    soulKey: routing.primarySoulKey,
    soulLabel: routing.primarySoulKey ? routing.primarySoulKey.replace(/^soul:/, '') : null,
    relevantSoulKeys: routing.relevantSoulKeys,
    ownershipMode: routing.ownershipMode,
    routingConfidence: routing.confidence,
    routingRationale: routing.rationale,
    feedback: opts.feedback || routing.rationale,
  });
}

export async function saveSharedTaskMemory(opts: {
  circleId: string;
  userId?: string;
  title: string;
  content: string;
  source: string;
  profileKey?: string;
  taskId?: string;
  agentId?: string;
  agentName?: string;
  importance?: number;
  excerpt?: string;
  sourceType?: 'message' | 'run' | 'step' | 'artifact' | 'approval' | 'manual';
  sourceId?: string;
  evaluationScore?: number;
  feedback?: string;
  namespace?: MemoryNamespace;
  impactDomain?: string;
}): Promise<MemoryEntry | null> {
  return saveMemoryWithContext({
    scope: 'circle',
    circleId: opts.circleId,
    userId: opts.userId,
    memoryKind: 'finding',
    title: opts.title,
    content: opts.content,
    sourceSurface: 'feed_task',
    visibility: 'circle_shared',
    importance: opts.importance ?? 0.7,
    retrievalMode: 'on_demand',
    sourceType: opts.sourceType || 'run',
    sourceId: opts.sourceId,
    excerpt: opts.excerpt,
    evaluation: {
      kind: 'quality',
      score: opts.evaluationScore,
      feedback: opts.feedback,
      passed: (opts.evaluationScore ?? 0.75) >= 0.6,
    },
    metadata: {
      source: opts.source,
      taskId: opts.taskId || null,
      capabilityProfile: opts.profileKey || null,
      impactDomain: opts.impactDomain || null,
      agentId: opts.agentId || null,
      agentName: opts.agentName || null,
      namespace: opts.namespace || inferNamespace(opts.source),
    },
  });
}

export async function promoteAgentMemoriesToSharedPatterns(opts: {
  circleId: string;
  userId: string;
  agentId: string;
  agentName?: string;
  profileKey?: string;
  kind: AgentMemoryPromotionKind;
}): Promise<MemoryEntry | null> {
  const sourceType = opts.kind === 'success' ? 'agent_task_completion' : 'agent_task_blocker';
  const namespace = opts.kind === 'success' ? 'task_shared_pattern' : 'task_blocker_pattern';
  const promotionSource = opts.kind === 'success' ? 'agent_pattern_promotion' : 'agent_blocker_promotion';

  const agentMemories = await retrieveAgentMemories({
    circleId: opts.circleId,
    userId: opts.userId,
    agentId: opts.agentId,
    types: [sourceType],
    limit: 12,
  });

  const matching = agentMemories.filter(mem =>
    !opts.profileKey || mem.metadata?.capabilityProfile === opts.profileKey
  );

  if (matching.length < 2) return null;

  const existingShared = await retrieveTaskMemories({
    circleId: opts.circleId,
    userId: opts.userId,
    profileKey: opts.profileKey,
    namespaces: [namespace],
    limit: 8,
    query: `${opts.agentName || opts.agentId} ${opts.profileKey || ''}`,
  });

  const duplicate = existingShared.find(mem =>
    mem.metadata?.source === promotionSource &&
    mem.metadata?.agentId === opts.agentId &&
    (!opts.profileKey || mem.metadata?.capabilityProfile === opts.profileKey)
  );
  if (duplicate) return null;

  const topMemories = matching.slice(0, 3);
  const titleBase = opts.profileKey || 'general';
  const title = opts.kind === 'success'
    ? `Promoted agent pattern: ${titleBase}`
    : `Promoted blocker pattern: ${titleBase}`;

  const content = [
    `Agent: ${opts.agentName || opts.agentId}`,
    opts.profileKey ? `Capability profile: ${opts.profileKey}` : '',
    opts.kind === 'success'
      ? 'Repeated successful private patterns promoted to circle memory.'
      : 'Repeated blocker patterns promoted to circle memory.',
    ...topMemories.map((mem, index) => `Example ${index + 1}: ${mem.content.slice(0, 240)}`),
  ].filter(Boolean).join('\n');

  return saveSharedTaskMemory({
    circleId: opts.circleId,
    userId: opts.userId,
    title,
    content,
    source: promotionSource,
    profileKey: opts.profileKey,
    agentId: opts.agentId,
    agentName: opts.agentName,
    importance: opts.kind === 'success' ? 0.83 : 0.78,
    excerpt: topMemories[0]?.content.slice(0, 220) || title,
    evaluationScore: opts.kind === 'success' ? 0.9 : 0.82,
    feedback: opts.kind === 'success'
      ? 'Promoted after repeated successful private agent patterns.'
      : 'Promoted after repeated private blocker patterns.',
    namespace,
    sourceType: 'manual',
  });
}

export async function saveMemoryWithContext(opts: {
  scope: MemoryScope;
  circleId?: string;
  roomId?: string;
  agentId?: string;
  userId?: string;
  sessionId?: string;
  memoryKind: MemoryKind;
  title: string;
  content: string;
  sourceRunId?: string;
  sourceSurface?: string;
  visibility?: 'private' | 'room_shared' | 'circle_shared' | 'org_shared';
  importance?: number;
  retrievalMode?: 'startup' | 'on_demand' | 'manual_only';
  metadata?: Record<string, unknown>;
  sourceType?: 'message' | 'run' | 'step' | 'artifact' | 'approval' | 'manual';
  sourceId?: string;
  excerpt?: string;
  evaluation?: {
    kind: 'quality' | 'contradiction' | 'sensitivity' | 'durability' | 'manual_review';
    passed?: boolean;
    score?: number;
    feedback?: string;
    metadata?: Record<string, unknown>;
  };
}): Promise<MemoryEntry | null> {
  const saved = await saveMemory({
    scope: opts.scope,
    circleId: opts.circleId,
    roomId: opts.roomId,
    agentId: opts.agentId,
    userId: opts.userId,
    sessionId: opts.sessionId,
    memoryKind: opts.memoryKind,
    title: opts.title,
    content: opts.content,
    sourceRunId: opts.sourceRunId,
    sourceSurface: opts.sourceSurface,
    visibility: opts.visibility,
    importance: opts.importance,
    retrievalMode: opts.retrievalMode,
    metadata: opts.metadata,
  });

  if (!saved) return null;

  if (opts.sourceType) {
    void supabase.from('memory_sources').insert({
      memory_id: saved.id,
      source_type: opts.sourceType,
      source_id: opts.sourceId || null,
      excerpt: opts.excerpt || opts.content.slice(0, 280),
    }).then(() => {});
  }

  if (opts.evaluation) {
    void supabase.from('memory_evaluations').insert({
      memory_id: saved.id,
      evaluation_kind: opts.evaluation.kind,
      evaluator: 'auto',
      passed: opts.evaluation.passed ?? null,
      score: opts.evaluation.score ?? null,
      feedback: opts.evaluation.feedback || null,
      metadata: opts.evaluation.metadata || {},
    }).then(() => {});
  }

  return saved;
}

// ── Mapper ──────────────────────────────────────────────────────────────────

function mapMemoryEntry(d: any): MemoryEntry {
  return {
    id: d.id, scope: d.scope, circle_id: d.circle_id, room_id: d.room_id,
    agent_id: d.agent_id,
    session_id: d.session_id,
    user_id: d.user_id, memory_kind: d.memory_kind, title: d.title,
    content: d.content, source_run_id: d.source_run_id, source_surface: d.source_surface,
    is_active: d.is_active, visibility: d.visibility, importance: d.importance,
    retrieval_mode: d.retrieval_mode, status: d.status, access_count: d.access_count,
    last_accessed_at: d.last_accessed_at, updated_at: d.updated_at, created_at: d.created_at,
    metadata: d.metadata || {},
  };
}

function extractSearchTerms(query: string): string[] {
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
    'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'shall',
    'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'it', 'this', 'that', 'and',
    'or', 'but', 'not', 'if', 'then', 'so', 'as', 'what', 'how', 'when', 'where', 'who',
    'which', 'why', 'i', 'me', 'my', 'we', 'you', 'your', 'our', 'their', 'they', 'them',
  ]);

  const quoted = Array.from(query.matchAll(/"([^"]+)"/g))
    .map(match => match[1].trim())
    .filter(Boolean);

  const tokens = query
    .split(/[^a-z0-9._/-]+/i)
    .map(token => token.trim())
    .filter(token => token.length > 2 && !stopWords.has(token));

  return Array.from(new Set([...quoted, ...tokens])).slice(0, 12);
}

function inferNamespace(source: string): MemoryNamespace {
  switch (source) {
    case 'task_completion':
      return 'task_shared_pattern';
    case 'task_blocker':
      return 'task_blocker_pattern';
    case 'agent_task_completion':
      return 'agent_private_pattern';
    case 'agent_task_blocker':
      return 'agent_private_blocker';
    default:
      return 'startup_bundle';
  }
}

function logMemoryAccess(memories: MemoryEntry[], userId: string | undefined, reason: 'startup' | 'retrieval' | 'session_resume' | 'manual_pin' | 'search') {
  try {
    const rows = memories.slice(0, 12).map(memory => ({
      memory_id: memory.id,
      user_id: userId || null,
      surface: 'memory_service',
      reason,
    }));
    void supabase.from('memory_access_log').insert(rows).then(() => {});
  } catch {}
}
