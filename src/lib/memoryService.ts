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

export type MemoryNamespace =
  | 'startup_bundle'
  | 'session_resume'
  | 'task_shared_pattern'
  | 'task_blocker_pattern'
  | 'agent_private_pattern'
  | 'agent_private_blocker';

export type AgentMemoryPromotionKind = 'success' | 'blocker';

// ── Startup Memory Bundle ───────────────────────────────────────────────────

/**
 * Load the startup memory bundle — small, bounded, always-injected.
 * Includes: instructions, preferences, active decisions, recent session summary.
 */
export async function loadStartupMemory(opts: {
  circleId: string;
  userId: string;
  roomId?: string;
}): Promise<string> {
  const allMemories = await loadMemories({
    circleId: opts.circleId,
    roomId: opts.roomId,
    userId: opts.userId,
    scopes: ['circle', 'room', 'user', 'session'],
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

  const durable = startupMemories.filter(m => m.scope !== 'session').slice(0, 10);
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
      .select('content, updated_at, last_edited_at')
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

// ── Remember / Forget Actions ───────────────────────────────────────────────

/**
 * Explicitly remember something from chat.
 */
export async function rememberFromChat(
  circleId: string,
  userId: string,
  content: string,
  kind: MemoryKind = 'fact',
): Promise<MemoryEntry | null> {
  const title = content.slice(0, 60).replace(/\n/g, ' ');
  const isPrivate = kind === 'preference' || kind === 'instruction' || kind === 'context';
  return saveMemory({
    scope: isPrivate ? 'user' : 'circle',
    circleId,
    userId: isPrivate ? userId : undefined,
    memoryKind: kind,
    title,
    content,
    sourceSurface: 'main_chat',
    visibility: isPrivate ? 'private' : 'circle_shared',
    importance: kind === 'instruction' ? 0.9 : kind === 'preference' ? 0.8 : kind === 'decision' ? 0.85 : 0.65,
    retrievalMode: ['instruction', 'preference', 'context'].includes(kind) ? 'startup' : 'on_demand',
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
    (!!userId && row.user_id === userId && (row.scope === 'user' || row.scope === 'session'))
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
  types?: string[];
  limit?: number;
}): Promise<MemoryEntry[]> {
  const memories = await loadMemories({
    circleId: opts.circleId,
    userId: opts.userId,
    scopes: ['user'],
    limit: 120,
  });

  const allowedTypes = new Set(opts.types || []);
  return memories
    .filter(mem => mem.metadata?.agentId === opts.agentId)
    .filter(mem => allowedTypes.size === 0 || allowedTypes.has(String(mem.metadata?.source || '')))
    .sort((a, b) => new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime())
    .slice(0, opts.limit || 10);
}

export async function retrieveTaskMemories(opts: {
  circleId: string;
  userId?: string;
  profileKey?: string;
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
      if (opts.taskId && mem.metadata?.taskId === opts.taskId) return true;
      return !opts.profileKey && !opts.taskId;
    })
    .map(mem => {
      let score = mem.importance || 0.5;
      if (opts.profileKey && mem.metadata?.capabilityProfile === opts.profileKey) score += 2.5;
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
}): Promise<MemoryEntry | null> {
  return saveMemoryWithContext({
    scope: 'user',
    circleId: opts.circleId,
    userId: opts.userId,
    memoryKind: 'finding',
    title: opts.title,
    content: opts.content,
    sourceSurface: 'feed_task',
    visibility: 'private',
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
      agentId: opts.agentId,
      agentName: opts.agentName || null,
      namespace: opts.namespace || inferNamespace(opts.source),
    },
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
    session_id: d.session_id,
    user_id: d.user_id, memory_kind: d.memory_kind, title: d.title,
    content: d.content, source_run_id: d.source_run_id, source_surface: d.source_surface,
    is_active: d.is_active, visibility: d.visibility, importance: d.importance,
    retrieval_mode: d.retrieval_mode, status: d.status, access_count: d.access_count,
    last_accessed_at: d.last_accessed_at, updated_at: d.updated_at, created_at: d.created_at,
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
