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

  return parts.join('\n\n');
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
  // Extract keywords from query
  const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'it', 'this', 'that', 'and', 'or', 'but', 'not', 'if', 'then', 'so', 'as', 'what', 'how', 'when', 'where', 'who', 'which', 'why', 'i', 'me', 'my', 'we', 'you', 'your']);
  const keywords = opts.query.toLowerCase()
    .split(/\W+/)
    .filter(w => w.length > 2 && !stopWords.has(w))
    .slice(0, 8);

  if (keywords.length === 0) return [];

  // Try full-text search first (uses GIN index), fall back to ILIKE
  const tsQuery = keywords.join(' & '); // PostgreSQL tsquery format
  let data: any[] | null = null;

  // Attempt tsvector full-text search
  try {
    const ftsResult = await supabase
      .from('memory_entries')
      .select('*')
      .eq('circle_id', opts.circleId)
      .eq('is_active', true)
      .textSearch('title', tsQuery, { type: 'websearch' })
      .order('created_at', { ascending: false })
      .limit(opts.limit || 10);

    if (ftsResult.data && ftsResult.data.length > 0) {
      data = ftsResult.data;
    }
  } catch {}

  // Fallback to ILIKE keyword search
  if (!data || data.length === 0) {
    const orFilter = keywords.map(k => `title.ilike.%${k}%,content.ilike.%${k}%`).join(',');
    const iResult = await supabase
      .from('memory_entries')
      .select('*')
      .eq('circle_id', opts.circleId)
      .eq('is_active', true)
      .or(orFilter)
      .order('created_at', { ascending: false })
      .limit(opts.limit || 10);
    data = iResult.data;
  }

  const error = null; // handled above

  if (error || !data) return [];

  // Score and rank results
  const scored = data.map((d: any) => {
    const mem = mapMemoryEntry(d);
    if (mem.retrieval_mode === 'manual_only') return { mem, score: -1 };
    let score = 0;
    const titleLower = mem.title.toLowerCase();
    const contentLower = mem.content.toLowerCase();
    for (const kw of keywords) {
      if (titleLower.includes(kw)) score += 3;
      if (contentLower.includes(kw)) score += 1;
    }
    if (keywords.some(kw => titleLower === kw || titleLower.startsWith(`${kw} `))) score += 2;
    // Boost by importance
    const imp = mem.importance || 0.5;
    score *= (0.5 + imp);
    if (mem.memory_kind === 'decision' || mem.memory_kind === 'instruction') score *= 1.15;
    // Recency decay — newer memories slightly preferred
    const ageMs = Date.now() - new Date(mem.created_at).getTime();
    const ageDays = ageMs / 86_400_000;
    score *= Math.max(0.3, 1.0 - ageDays * 0.01); // lose ~1% per day
    return { mem, score };
  });

  scored.sort((a, b) => b.score - a.score);

  // Filter to only user's own user-scope + shared circle/room scope
  return scored
    .filter(s => s.mem.scope !== 'user' || s.mem.user_id === opts.userId)
    .map(s => s.mem)
    .slice(0, opts.limit || 10);
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
