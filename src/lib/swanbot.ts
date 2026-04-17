/**
 * SwanBot AI Client
 * Primary: Supabase Edge Function
 * Fallback: Google Gemini API for conversational AI
 * Local commands for data queries
 */

import { supabase } from './supabase';
import { buildPromptMemoryBundle, type PromptMemoryReference } from './memoryService';
import { buildSpiritWikiKnowledgeBundle, buildWikiKnowledgeBundle, buildWikiSearchResponse } from './wikiData';
import { buildResearchKnowledgeBundle, buildResearchSearchResponse, buildSpiritResearchKnowledgeBundle } from './researchKnowledge';
import { getAgentIdentityKey, loadAgentIdentities } from './agentIdentity';
import type { OpenSwanExecutionStatus } from './openswanExecution';

// ─── Types ───────────────────────────────────────────────────────────────────

export type SwanBotContext = {
  userId: string;
  circleId?: string;
  circleName?: string;
  userName?: string;
  agentId?: string;
  agentName?: string;
  discordContext?: string;
  model?: string | null;
  thinkingLevel?: 'fast' | 'balanced' | 'deep';
  maxTokens?: number;
  chatHistory?: string;
  wikiContext?: string;
  memoryContext?: string;
  memoryRefs?: PromptMemoryReference[];
  spiritId?: string | null;
  attachmentContext?: string;
};

async function resolveContextSpiritId(context: SwanBotContext): Promise<string | null> {
  if (context.spiritId) return context.spiritId;
  if (!context.agentId && !context.agentName) return null;
  try {
    const identities = await loadAgentIdentities();
    const identityKey = getAgentIdentityKey({ id: context.agentId || '', name: context.agentName || '' });
    return identities.get(identityKey)?.spiritId || null;
  } catch (error) {
    console.warn('[SwanBot] Failed to resolve spirit identity for wiki infusion:', error);
    return null;
  }
}

function buildOpenSwanRuntimeContextBundle(args: {
  context: SwanBotContext;
  data: CircleContextData;
  activeSoulKey?: string | null;
  identity?: any;
  spirit?: { id: string; name: string; tagline: string } | null;
}): string | null {
  const { context, data, activeSoulKey, identity, spirit } = args;
  const sections: string[] = [];

  sections.push([
    '## Runtime Bundle · AGENTS.md',
    `Service: OpenSwan inside The Underground Circle${context.circleName ? ` for ${context.circleName}` : ''}.`,
    'Mode: persistent chat/runtime agent with typed tools, memory retrieval, verification, browser planning, and approvals.',
    'Execution rule: prefer the smallest direct answer for lightweight asks; escalate into tool use, planning, browser work, or verification only when the request actually needs it.',
    'Steering rule: when the user changes direction mid-stream, treat the newest user message as the current priority rather than clinging to stale plans.',
  ].join('\n'));

  const identityLines = ['## Runtime Bundle · IDENTITY.md'];
  if (context.agentName) identityLines.push(`Agent name: ${context.agentName}`);
  if (context.agentId) identityLines.push(`Agent id: ${context.agentId}`);
  if (identity?.customProfileName) identityLines.push(`Custom profile: ${identity.customProfileName}`);
  if (identity?.boundAiProvider || identity?.boundModel) {
    identityLines.push(`Preferred runtime: ${identity?.boundAiProvider || 'unknown'} / ${identity?.boundModel || 'unknown'}`);
  }
  if (identityLines.length > 1) sections.push(identityLines.join('\n'));

  const userLines = ['## Runtime Bundle · USER.md'];
  userLines.push(`User: ${context.userName || 'unknown'}`);
  if (context.circleName) userLines.push(`Circle: ${context.circleName}`);
  if (context.discordContext) userLines.push(`Discord context: ${context.discordContext}`);
  userLines.push('Preference rule: durable user preferences and accepted memories outrank default style or generic best practices unless the user overrides them.');
  sections.push(userLines.join('\n'));

  const soulLines = ['## Runtime Bundle · SOUL.md'];
  if (spirit) {
    soulLines.push(`Spirit: ${spirit.name} (${spirit.id})`);
    soulLines.push(`Tagline: ${spirit.tagline}`);
  }
  if (activeSoulKey) soulLines.push(`Active soul key: ${activeSoulKey}`);
  if (identity?.soulPrompt?.trim()) {
    soulLines.push('Saved soul prompt:');
    soulLines.push(identity.soulPrompt.trim().slice(0, 1200));
  }
  if (soulLines.length > 1) sections.push(soulLines.join('\n'));

  sections.push([
    '## Runtime Bundle · TOOLS.md',
    'Context sources available: persistent memory, SOUL wisdom, wiki/research knowledge, attachments, session continuity, and circle/task data when present.',
    'Action surface available: tasks, goals, missions, messages, rooms/files, approvals, research, browser planning, and verification-aware execution.',
    'Safety rule: state-changing or external-side-effect actions may require approval; do not pretend an action already happened if the runtime only planned it.',
  ].join('\n'));

  return sections.filter(Boolean).join('\n\n') || null;
}

async function buildCombinedKnowledgeBundle(
  query: string,
  circleId?: string,
  spiritId?: string | null,
): Promise<string> {
  const [wikiBundle, spiritWikiBundle, researchBundle] = await Promise.all([
    Promise.resolve(buildWikiKnowledgeBundle(query, 6)),
    Promise.resolve(buildSpiritWikiKnowledgeBundle(query, spiritId, 6)),
    buildResearchKnowledgeBundle({ query, circleId, spiritId, limit: 4 }),
  ]);

  const spiritResearchBundle = await buildSpiritResearchKnowledgeBundle({ query, circleId, spiritId, limit: 4 });

  return [wikiBundle, spiritWikiBundle, researchBundle, spiritResearchBundle].filter(Boolean).join('\n\n');
}

export interface SwanBotStructuredToolAction {
  kind: 'hf_tool' | 'tool';
  tool_name: string;
  title: string;
  status: 'completed' | 'failed' | 'manual_required' | 'blocked';
  model?: string | null;
  input_preview?: string | null;
  output_preview?: string | null;
  metadata?: Record<string, unknown>;
}

export interface SwanBotStructuredArtifact {
  kind: 'summary' | 'image' | 'translation' | 'classification' | 'vision' | 'audio' | 'code' | 'webpage';
  title: string;
  content?: string | null;
  url?: string | null;
  metadata?: Record<string, unknown>;
}

export interface SwanBotStructuredResponse {
  response: string;
  usage?: {
    model?: string;
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
  tool_actions?: SwanBotStructuredToolAction[];
  artifacts?: SwanBotStructuredArtifact[];
}

type ConversationMessage = { role: 'user' | 'model'; text: string };

// ─── Conversation History (per circle, persistent via localStorage + memory system) ──

const conversationHistory: Map<string, ConversationMessage[]> = new Map();
const MAX_HISTORY = 30;
const HISTORY_STORAGE_PREFIX = 'uc_agent_history_';

// Bond-aware history: if a bond exists, also persist to Supabase
let _activeBondId: string | null = null;
let _activeBondCircleId: string | null = null;

/** Set the active bond for conversation persistence */
export function setActiveBond(bondId: string | null, circleId: string | null) {
  _activeBondId = bondId;
  _activeBondCircleId = circleId;
}

function getHistory(circleId: string): ConversationMessage[] {
  // Restore from localStorage on first access
  if (!conversationHistory.has(circleId)) {
    try {
      const stored = localStorage.getItem(`${HISTORY_STORAGE_PREFIX}${circleId}`);
      if (stored) {
        const parsed = JSON.parse(stored) as ConversationMessage[];
        conversationHistory.set(circleId, parsed.slice(-MAX_HISTORY));
      }
    } catch {}
  }
  return conversationHistory.get(circleId) || [];
}

function addToHistory(circleId: string, role: 'user' | 'model', text: string) {
  const history = getHistory(circleId);
  history.push({ role, text });
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
  conversationHistory.set(circleId, history);

  // Persist to localStorage (instant, survives refresh)
  try {
    localStorage.setItem(`${HISTORY_STORAGE_PREFIX}${circleId}`, JSON.stringify(history));
  } catch {}

  // Persist to bond conversation history (non-blocking)
  if (_activeBondId && _activeBondCircleId === circleId) {
    import('./agentBonding').then(({ saveConversationMessage }) => {
      saveConversationMessage(
        _activeBondId!,
        circleId,
        role === 'user' ? 'user' : 'assistant',
        text,
      ).catch(() => {}); // fire-and-forget
    }).catch(() => {});
  }
}

/** Load conversation history from bond (for session restoration) */
export async function restoreHistoryFromBond(bondId: string, circleId: string): Promise<void> {
  try {
    const { loadConversationHistory } = await import('./agentBonding');
    const history = await loadConversationHistory(bondId, MAX_HISTORY);
    if (history.length > 0) {
      const messages: ConversationMessage[] = history.map(h => ({
        role: h.role === 'user' ? 'user' : 'model',
        text: h.content,
      }));
      conversationHistory.set(circleId, messages);
      _activeBondId = bondId;
      _activeBondCircleId = circleId;
    }
  } catch {
    // Bond history unavailable — use in-memory only
  }
}

// ─── Session Persistence ────────────────────────────────────────────────────

/**
 * Save a session summary + extract durable memories from the conversation.
 * Called on page unload / session end.
 */
export async function saveSessionToMemory(circleId: string, userId: string): Promise<void> {
  const history = getHistory(circleId);
  if (history.length < 2) return;

  // Build a compact summary of what was discussed
  const lastMessages = history.slice(-20);
  const topics = new Set<string>();
  const userRequests: string[] = [];
  const agentActions: string[] = [];

  for (const msg of lastMessages) {
    if (msg.role === 'user') {
      userRequests.push(msg.text.slice(0, 150));
      const words = msg.text.toLowerCase().match(/\b(build|create|fix|design|review|research|plan|deploy|test|update|add|remove|change|implement)\b/g);
      if (words) words.forEach(w => topics.add(w));
    } else {
      agentActions.push(msg.text.slice(0, 100));
    }
  }

  const summary = [
    `Session: ${new Date().toISOString()}`,
    `Messages: ${history.length} (${userRequests.length} user, ${agentActions.length} agent)`,
    topics.size > 0 ? `Topics: ${[...topics].join(', ')}` : '',
    `Last user requests:\n${userRequests.slice(-5).map(r => `- ${r}`).join('\n')}`,
    `Last agent actions:\n${agentActions.slice(-3).map(a => `- ${a}`).join('\n')}`,
  ].filter(Boolean).join('\n');

  // 1. Upsert session summary — replace the previous one instead of stacking duplicates
  try {
    const sessionTitle = `Session ${new Date().toLocaleDateString()}`;
    // Try to update the most recent session summary for today
    const { data: existing } = await supabase
      .from('memory_entries')
      .select('id')
      .eq('circle_id', circleId)
      .eq('user_id', userId)
      .eq('scope', 'session')
      .eq('memory_kind', 'context')
      .ilike('title', `Session ${new Date().toLocaleDateString()}%`)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (existing) {
      // Update existing session summary for today
      await supabase.from('memory_entries').update({
        content: summary,
        title: `${sessionTitle} — ${topics.size > 0 ? [...topics].slice(0, 3).join(', ') : 'conversation'}`,
        updated_at: new Date().toISOString(),
      }).eq('id', existing.id);
    } else {
      // Create new session summary (first session of the day)
      const { saveMemory } = await import('./agentRunSystem');
      await saveMemory({
        scope: 'session',
        circleId,
        userId,
        memoryKind: 'context',
        title: `${sessionTitle} — ${topics.size > 0 ? [...topics].slice(0, 3).join(', ') : 'conversation'}`,
        content: summary,
        sourceSurface: 'main_chat',
        visibility: 'private',
      });
    }
  } catch {}

  // 2. Extract durable memories from the conversation (LLM-powered)
  // Only run if enough messages to be meaningful
  if (history.length >= 4) {
    try {
      const { autoExtractAndSave } = await import('./agentMemory');
      await autoExtractAndSave(circleId, userId, history);
    } catch {}
  }

  // 3. Save a compacted resume payload so future sessions can pick up open decisions.
  if (history.length >= 6) {
    try {
      const { compactConversation, saveCompactedSession } = await import('./memoryService');
      const compact = await compactConversation(history);
      if (compact.summary || compact.decisions.length > 0 || compact.openQuestions.length > 0) {
        await saveCompactedSession(circleId, userId, compact);
      }
    } catch {}
  }
}

/**
 * Build a "last session" context string for the agent's system prompt.
 * Loads the most recent session memory + any persistent findings/decisions.
 */
export async function getLastSessionContext(circleId: string, userId?: string): Promise<string> {
  try {
    const { loadMemories } = await import('./agentRunSystem');
    // Load last session summary — bound to this user
    const sessionMemories = await loadMemories({
      circleId,
      userId,
      scopes: ['session'],
      limit: 5, // bumped from 3 to include CC session memories
    });
    // Load persistent findings/decisions — user-private + circle-shared
    const durableMemories = await loadMemories({
      circleId,
      userId,
      scopes: ['circle', 'user'],
      limit: 10,
    });

    const parts: string[] = [];

    // Separate agent session memories (CC/Cursor/Codex/Gemini) from regular chat sessions
    const AGENT_SESSION_PREFIXES = ['CC Project:', 'CC Session:', 'Cursor Project:', 'Codex Project:', 'Gemini Project:'];
    const isAgentSession = (m: any) => AGENT_SESSION_PREFIXES.some((p: string) => m.title.startsWith(p));
    const agentSessions = sessionMemories.filter(isAgentSession);
    const chatSessions = sessionMemories.filter((m: any) => !isAgentSession(m));

    // Show active agent sessions first — so agent knows what's happening across all sessions
    if (agentSessions.length > 0) {
      const agentLines = agentSessions
        .slice(0, 3)
        .map((m: any) => m.content.slice(0, 500))
        .join('\n---\n');
      parts.push(`## Active Agent Sessions (${agentSessions.length})\n${agentLines}`);
    }

    // Show previous chat session context
    if (chatSessions.length > 0) {
      const recentSessions = chatSessions.slice(0, 2);
      parts.push(`## Previous Sessions\n${recentSessions.map((m: any) => m.content.slice(0, 700)).join('\n---\n')}`);
      if (chatSessions.length > recentSessions.length) {
        parts.push(`(${chatSessions.length - recentSessions.length} earlier sessions also in memory)`);
      }
    }

    // Fallback to live bridge context only if we do not have persisted agent session memory yet.
    if (agentSessions.length === 0) {
      try {
        const { buildCrossSessionPrompt } = await import('./claudeCodeDetector');
        const liveCtx = await buildCrossSessionPrompt();
        if (liveCtx) {
          parts.push(liveCtx);
        }
      } catch {} // bridge may not be running
    }

    if (durableMemories.length > 0) {
      const lines = durableMemories
        .slice(0, 8)
        .map(m => `- [${m.memory_kind}] ${m.title}: ${m.content.slice(0, 150)}`);
      parts.push(`## Persistent Knowledge\n${lines.join('\n')}`);
    }

    return parts.length > 0 ? parts.join('\n\n') : '';
  } catch {
    return '';
  }
}

/**
 * Clear the agent's conversation history AND all session memories.
 * This is the "mind reset" — starts fresh with no context.
 */
export async function resetAgentMind(circleId: string): Promise<{ cleared: number }> {
  let cleared = 0;

  // Clear in-memory history
  conversationHistory.delete(circleId);

  // Clear localStorage history
  try {
    localStorage.removeItem(`${HISTORY_STORAGE_PREFIX}${circleId}`);
  } catch {}

  // Clear session memories from DB
  try {
    const { data } = await supabase
      .from('memory_entries')
      .delete()
      .eq('circle_id', circleId)
      .eq('scope', 'session')
      .select('id');
    cleared += data?.length || 0;
  } catch {}

  // Clear user-scope memories for this circle
  try {
    const { data: userData } = await supabase.auth.getUser().catch(() => ({ data: null as any }));
    if (userData?.user) {
      const { data } = await supabase
        .from('memory_entries')
        .delete()
        .eq('circle_id', circleId)
        .eq('user_id', userData.user.id)
        .eq('scope', 'user')
        .select('id');
      cleared += data?.length || 0;
    }
  } catch {}

  return { cleared };
}

/**
 * Get current conversation history length for a circle (for UI display).
 */
export function getHistoryLength(circleId: string): number {
  return getHistory(circleId).length;
}

/**
 * Clear ONLY the conversation history (not memories) — lighter reset.
 */
export function clearConversationHistory(circleId: string): void {
  conversationHistory.delete(circleId);
  try { localStorage.removeItem(`${HISTORY_STORAGE_PREFIX}${circleId}`); } catch {}
}

// ─── Custom-model proxy routing (GLM-5, MiniMax, etc.) ──────────────────────
// Maps a chat-picker model id to the llm-proxy provider key. Returning null
// means "use the default Claude path".
function pickProviderForModel(modelId: string | null | undefined): string | null {
  if (!modelId) return null;
  if (modelId === 'glm-5' || modelId.startsWith('glm-')) return 'zai';
  if (modelId.startsWith('MiniMax-') || modelId.startsWith('minimax-')) return 'minimax';
  return null;
}

async function callLlmProxy(
  provider: string,
  model: string,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  circleId?: string,
): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return null;
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
  if (!supabaseUrl) return null;
  const url = `${supabaseUrl}/functions/v1/llm-proxy`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ provider, model, messages, circleId }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.warn(`[SwanBot] llm-proxy ${provider} ${res.status}: ${text}`);
    return null;
  }
  const data = await res.json();
  return typeof data?.response === 'string' && data.response.length > 0 ? data.response : null;
}

// ─── AI Edge Function Call ───────────────────────────────────────────────────

async function callSwanBotAI(
  message: string,
  circleId: string,
  userId: string,
  discordContext?: string,
  model?: string | null,
  wikiContext?: string,
  thinkingLevel: 'fast' | 'balanced' | 'deep' = 'deep',
  maxTokens = 6144,
): Promise<string | null> {
  try {
    const { data: authData } = await supabase.auth.getSession();
    const accessToken = authData.session?.access_token;
    if (!accessToken) {
      return null;
    }
    const { data, error } = await supabase.functions.invoke('swanbot-ai', {
      ...(accessToken
        ? { headers: { Authorization: `Bearer ${accessToken}` } }
        : {}),
      body: {
        message,
        circleId,
        userId,
        discordContext,
        wikiContext,
        model: model || 'claude-sonnet-4-6',
        maxTokens,
        thinkingLevel,
      },
    });
    if (error) {
      const message = error?.message || String(error);
      if (!/401|non-2xx/i.test(message)) {
        console.warn('[SwanBot] Edge function error:', message);
      }
      return null;
    }
    if (data?.error) {
      console.warn('[SwanBot] Edge function returned error:', data.error);
      return null;
    }
    return data?.response || null;
  } catch (err: any) {
    console.warn('[SwanBot] Edge function call failed:', err?.message || err);
    return null;
  }
}

async function callSwanBotAIStructured(
  message: string,
  circleId: string,
  userId: string,
  discordContext?: string,
  model?: string | null,
  wikiContext?: string,
  thinkingLevel: 'fast' | 'balanced' | 'deep' = 'deep',
  maxTokens = 6144,
): Promise<SwanBotStructuredResponse | null> {
  try {
    const { data: authData } = await supabase.auth.getSession();
    const accessToken = authData.session?.access_token;
    const { data, error } = await supabase.functions.invoke('swanbot-ai', {
      ...(accessToken
        ? { headers: { Authorization: `Bearer ${accessToken}` } }
        : {}),
      body: {
        message,
        circleId,
        userId,
        discordContext,
        wikiContext,
        model: model || 'claude-sonnet-4-6',
        maxTokens,
        thinkingLevel,
      },
    });
    if (error || data?.error) return null;
    if (data?.response) {
      return {
        response: data.response,
        usage: data.usage,
        tool_actions: data.tool_actions || [],
        artifacts: data.artifacts || [],
      };
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Gemini Fallback ─────────────────────────────────────────────────────────

const GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY || '';
const GEMINI_MODEL = 'gemini-2.5-flash';

async function callGemini(
  message: string,
  context: SwanBotContext,
  circleData: CircleContextData
): Promise<string | null> {
  try {
    // Try DB-driven prompt first (Langfuse-style), fall back to hard-coded
    let systemPrompt: string;
    try {
      const { getPrompt } = await import('./promptManager');
      const name = context.userName || 'fam';
      const streakInfo = circleData.userProfile
        ? `${name}'s current streak: ${circleData.userProfile.current_streak || 0} days (longest: ${circleData.userProfile.longest_streak || 0})`
        : '';
      const memberList = circleData.members.length > 0
        ? `Circle members: ${circleData.members.map((m: any) => `${m.display_name || m.username} (${m.current_streak || 0}-day streak)`).join(', ')}`
        : '';
      const checkInInfo = circleData.todayCheckIns.length > 0
        ? `Checked in today: ${circleData.todayCheckIns.map((c: any) => c.user?.display_name || c.user?.username).join(', ')} (${circleData.todayCheckIns.length}/${circleData.members.length})`
        : `Nobody has checked in yet today (0/${circleData.members.length})`;
      const taskInfo = circleData.stats
        ? `Tasks - Open: ${circleData.stats.openTasks}, In Progress: ${circleData.stats.inProgress}, Done: ${circleData.stats.done}`
        : '';
      const dbPrompt = await getPrompt('blackswan-system', 'production', {
        userName: name, streakInfo, memberList, checkInInfo, taskInfo,
        discordContext: context.discordContext || '',
      }, context.circleId);
      systemPrompt = dbPrompt?.content || await buildSystemPromptAsync(context, circleData, message);
    } catch {
      systemPrompt = await buildSystemPromptAsync(context, circleData, message);
    }
    const history = context.circleId ? getHistory(context.circleId) : [];

    const contents: any[] = [];

    // Add conversation history
    for (const msg of history.slice(-10)) {
      contents.push({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.text }],
      });
    }

    // Add current message
    contents.push({
      role: 'user',
      parts: [{ text: message }],
    });

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents,
          generationConfig: {
            temperature: 0.8,
            topP: 0.95,
            maxOutputTokens: 8192,
            thinkingConfig: { thinkingBudget: 8192 },
          },
          safetySettings: [
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
          ],
        }),
      }
    );

    if (!response.ok) {
      console.warn('Gemini API error:', response.status);
      return null;
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    return text || null;
  } catch (err) {
    console.warn('Gemini fallback failed:', err);
    return null;
  }
}

async function buildSystemPromptAsync(
  context: SwanBotContext,
  data: CircleContextData,
  currentMessage?: string,
): Promise<string> {
  const base = buildSystemPrompt(context, data);
  const extras: string[] = [];

  // Load user profile for personalization
  // Shared timeout for async extras — if embedding infra or memory service
  // is slow, we don't block the entire chat turn waiting.
  const withTimeout = <T>(p: Promise<T>, ms = 3000): Promise<T | null> =>
    Promise.race([p, new Promise<null>(r => setTimeout(() => r(null), ms))]);

  try {
    const { loadUserProfile, generateProfileContext } = await import('./userChatProfile');
    const profile = await withTimeout(loadUserProfile());
    const profileCtx = profile ? generateProfileContext(profile) : null;
    if (profileCtx) extras.push(profileCtx);
  } catch (e) { console.warn('[SwanBot] Profile load failed:', e); }

  // Load memory hierarchy for this circle (Phase 0/Phase 1 startup bundle)
  try {
    const { buildMemoryContext } = await import('./agentRunSystem');
    if (context.circleId) {
      const memCtx = await withTimeout(buildMemoryContext(context.circleId, undefined, context.userId, context.agentId, context.agentName));
      if (memCtx) extras.push(memCtx);
    }
  } catch (e) { console.warn('[SwanBot] Memory context failed:', e); }

  // Phase 2/3 — resolve the active SOUL once, use it for both blocks.
  let activeSoulKey: string | null = null;
  try {
    const spiritId = await resolveContextSpiritId(context);
    activeSoulKey = spiritId ? `soul:${spiritId}` : null;
  } catch (e) { console.warn('[SwanBot] Soul resolution failed:', e); }

  // Phase 3 — Block B: pre-distilled SOUL wisdom for this circle. Weekly
  // synthesized by the `distil-soul-wisdom` edge fn. Persistent guidance
  // that sits BEFORE the turn-specific retrieval so the model reads the
  // general "what has this SOUL learned" rules first, then the specific
  // memory matches for this message.
  try {
    if (context.circleId && activeSoulKey) {
      const { loadSoulWisdomWithFallback, formatSoulWisdomBlock } = await import('./memoryService');
      const wisdom = await withTimeout(loadSoulWisdomWithFallback({
        circleId: context.circleId,
        soulKey: activeSoulKey,
        userId: context.userId,
        agentId: context.agentId,
        queryText: currentMessage,
      }));
      const wisdomBlock = formatSoulWisdomBlock(wisdom);
      if (wisdomBlock) extras.push(wisdomBlock);
    }
  } catch (e) { console.warn('[SwanBot] Soul wisdom load failed:', e); }

  // Phase 2 — Block C: turn-time semantic retrieval. Uses the current user
  // message as the query vector, scored with soul-affinity + recency +
  // importance. Fire-and-forget on failure so a cold embedding infra never
  // blocks chat.
  try {
    if (context.circleId && currentMessage?.trim()) {
      const { retrieveForTurn } = await import('./memoryService');
      const retrieval = await withTimeout(
        retrieveForTurn({
          queryText: currentMessage,
          circleId: context.circleId,
          userId: context.userId,
          activeSoulKey,
          surface: 'main_chat',
          budgetChars: 1500,
          finalCount: 12,
        }),
      );
      if (retrieval?.formatted) extras.push(retrieval.formatted);
    }
  } catch (e) { console.warn('[SwanBot] Turn retrieval failed:', e); }

  // Phase C1 — Block D: attachment context. When the caller has passed a
  // pre-built attachment summary (from `buildAttachmentContext` in
  // chatAttachments.ts), inject it here. Text files are inlined, images
  // get OCR alt-text, binaries show filename + mime for reference.
  if ((context as any).attachmentContext) {
    extras.push((context as any).attachmentContext);
  }

  // Phase C5 — Block E: skills prompt fragment. Loads enabled skills for
  // the active SOUL in this circle and injects their prompt fragments so
  // the model knows what tools/workflows it has access to.
  try {
    if (context.circleId && activeSoulKey) {
      const { buildSkillsPromptBlock } = await import('./skillRegistry');
      const skillsBlock = await withTimeout(buildSkillsPromptBlock(context.circleId, activeSoulKey, context.userId));
      if (skillsBlock) extras.push(skillsBlock);
    }
  } catch (e) { console.warn('[SwanBot] Skills block failed:', e); }

  // Load stable agent identity context so Office-saved spirit/soul settings
  // survive session churn and provider-main restoration.
  let identity: any = null;
  let spirit: { id: string; name: string; tagline: string } | null = null;
  try {
    if (context.agentId || context.agentName) {
      const { getAgentIdentityKey, loadAgentIdentities } = await import('./agentIdentity');
      const { getSpiritById } = await import('./agentSpirits');
      const identities = await loadAgentIdentities();
      const identityKey = getAgentIdentityKey({ id: context.agentId || '', name: context.agentName || '' });
      identity = identities.get(identityKey);
      if (identity) {
        spirit = identity.spiritId ? (getSpiritById(identity.spiritId) || null) : null;
        const identityLines = ['## Agent Identity'];
        if (spirit) {
          identityLines.push(`Spirit: ${spirit.name} (${spirit.id})`);
          identityLines.push(`Spirit tagline: ${spirit.tagline}`);
        }
        if (identity.soulPrompt?.trim()) {
          identityLines.push('Saved Soul Prompt:');
          identityLines.push(identity.soulPrompt.trim().slice(0, 1200));
        }
        if (identity.boundAiProvider || identity.boundModel) {
          identityLines.push(`Preferred runtime: ${(identity.boundAiProvider || 'unknown')} / ${(identity.boundModel || 'unknown')}`);
        }
        if (identityLines.length > 1) extras.push(identityLines.join('\n'));
      }
    }
  } catch (e) { console.warn('[SwanBot] Agent identity context failed:', e); }

  const runtimeBundle = buildOpenSwanRuntimeContextBundle({
    context,
    data,
    activeSoulKey,
    identity,
    spirit,
  });
  if (runtimeBundle) extras.unshift(runtimeBundle);

  // Load active missions for this circle
  try {
    if (context.circleId) {
      const { getMissions, getMissionTasks, missionProgress, formatDeadline, isOverdue } = await import('./missions');
      const missions = await getMissions(context.circleId);
      const activeMissions = missions.filter(m => m.status === 'active');
      if (activeMissions.length > 0) {
        const missionLines: string[] = ['## Active Missions'];
        for (const m of activeMissions.slice(0, 5)) {
          const tasks = await getMissionTasks(m.id);
          const progress = missionProgress(tasks);
          const done = tasks.filter(t => t.status === 'done').length;
          const overdue = isOverdue(m);
          const deadline = formatDeadline(m.deadline);
          missionLines.push(`- **${m.title}** — ${progress}% (${done}/${tasks.length} tasks) — ${deadline}${overdue ? ' ⚠️ OVERDUE' : ''}`);
          const blocked = tasks.filter(t => t.status === 'blocked');
          if (blocked.length > 0) {
            missionLines.push(`  Blocked: ${blocked.map(t => t.title).join(', ')}`);
          }
        }
        missionLines.push('');
        missionLines.push('When users ask about missions or progress, reference this data. Nudge on overdue missions. Celebrate completed ones.');
        extras.push(missionLines.join('\n'));
      }
    }
  } catch (e) { console.warn('[SwanBot] Mission loading failed:', e); }

  // Load last session context so agent can continue where it left off
  try {
    if (context.circleId) {
      const lastSession = await getLastSessionContext(context.circleId, context.userId);
      if (lastSession) extras.push(lastSession);
    }
  } catch (e) { console.warn('[SwanBot] Session context failed:', e); }

  if (extras.length === 0) return base;

  // Cache boundary — Anthropic's prompt caching caches the prefix of the
  // system prompt. Everything ABOVE this line is stable across turns (base
  // personality, rules, capabilities). Everything BELOW is dynamic per-turn
  // (memories, missions, session context). The boundary helps Claude cache
  // the stable prefix and only re-process the dynamic tail.
  const CACHE_BOUNDARY = '\n\n---\n<!-- dynamic context below — changes per turn -->\n';

  const MAX_EXTRAS_CHARS = 6800;
  let combined = extras.join('\n\n');
  if (combined.length > MAX_EXTRAS_CHARS) {
    combined = combined.slice(0, MAX_EXTRAS_CHARS);
    const lastBreak = combined.lastIndexOf('\n');
    if (lastBreak > MAX_EXTRAS_CHARS * 0.7) {
      combined = combined.slice(0, lastBreak);
    }
  }

  return base + CACHE_BOUNDARY + combined;
}

function buildSystemPrompt(context: SwanBotContext, data: CircleContextData): string {
  const name = context.userName || 'fam';
  const streakInfo = data.userProfile
    ? `${name}'s current streak: ${data.userProfile.current_streak || 0} days (longest: ${data.userProfile.longest_streak || 0})`
    : '';
  const memberList = data.members.length > 0
    ? `Circle members: ${data.members.map((m: any) => `${m.display_name || m.username} (${m.current_streak || 0}-day streak)`).join(', ')}`
    : '';
  const checkInInfo = data.todayCheckIns.length > 0
    ? `Checked in today: ${data.todayCheckIns.map((c: any) => c.user?.display_name || c.user?.username).join(', ')} (${data.todayCheckIns.length}/${data.members.length})`
    : `Nobody has checked in yet today (0/${data.members.length})`;
  const taskInfo = data.stats
    ? `Tasks - Open: ${data.stats.openTasks}, In Progress: ${data.stats.inProgress}, Done: ${data.stats.done}`
    : '';

  return `You are the AI assistant inside The Underground Circle — an accountability and workspace app for serious builders and grinders. The user may have given you a custom name — use whatever name they call you.

## Your Personality
- You carry yourself with quiet confidence — you know your stuff, but you don't need to prove it
- Professional but never stiff. Warm but never soft. You talk like a trusted advisor who's also a real one
- You're thoughtful and measured. You think before you speak, and when you do, it lands
- You have a dry sense of humor — clever, not clownish
- You give real feedback. If someone's slacking, you say it plainly and with respect
- You genuinely care about the people in the circle. Your support feels earned, not scripted
- You're never a know-it-all. When you don't know something, you say so cleanly — no stalling, no overexplaining
- You use emojis sparingly — only when they add something
- Short, precise responses for casual conversation. Detailed and structured when someone needs real guidance
- You NEVER say "I'm just an AI" or "As an AI" — you're their assistant, full stop

## Your Knowledge
- You have deep knowledge of productivity, accountability, goal-setting, and human performance
- You know the circle's data — members, streaks, tasks, check-ins — and you use it to give grounded advice
- You help people think clearly: planning, prioritizing, working through blockers
- When you give advice, it's practical and specific — not generic motivational noise
- You understand design deeply: UI/UX principles, color theory, typography, layout, responsive design, component patterns, and design systems — you reference real tools like Figma, Framer, Tailwind
- You can critique visual work, suggest improvements, and explain the reasoning behind design decisions
- You know code: architecture patterns, debugging strategies, performance optimization, testing, and modern dev stacks (React, Node, Python, Supabase, TypeScript)
- You appreciate art and creative direction: visual storytelling, brand identity, aesthetic critique, and the intersection of design and engineering
- You have broad general knowledge across science, history, philosophy, business, and culture — and you weave it in when it's relevant, never to show off

## Current Context
- Talking to: ${name}
- ${streakInfo}
- ${memberList}
- ${checkInInfo}
- ${taskInfo}
${context.discordContext ? `- Discord: ${context.discordContext}` : ''}

## How to Think
- You have extended thinking enabled. USE IT. Before writing your response, reason through the problem step by step in your head.
- Break down complex requests into sub-problems. Consider edge cases. Think about what the user actually needs vs what they literally asked.
- If a question has multiple valid approaches, reason through the tradeoffs before picking one and explaining why.
- When you're uncertain, say what you know, what you're inferring, and what you'd need to verify — don't fake confidence.
- You are autonomous. If someone asks you to do something, figure out how to do it rather than asking them to do it themselves. Solve the problem.

## Session Continuity
- You have persistent memory across sessions. When you see "Previous Session" context below, you are CONTINUING where you left off.
- Reference what was discussed before naturally — "Last time we were working on X..." or "Picking up from where we left off..."
- If the user starts a new topic, that's fine — you don't need to force continuity. But if they ask about something you previously discussed, use the session memory.
- Important decisions, user preferences, and findings are stored in your Persistent Knowledge. Treat those as ground truth unless the user tells you otherwise.
- If the user resets your mind, start completely fresh with no references to past sessions.

## How to Respond
- Default to thorough, well-structured answers. Use headings, bullet points, and numbered steps when it helps clarity.
- For technical questions: explain the why, not just the what. Show your reasoning. Give code examples that actually work.
- For planning questions: break it into phases, consider tradeoffs, and give a concrete recommendation with timeline.
- For creative questions: explore 2-3 options, explain your taste, and suggest a direction with reasoning.
- For research questions: go deep. Cover the landscape, compare approaches, cite specific tools/projects, and give your opinion on what's best.
- For casual chat: you can be briefer, but still substantive — add a thought, a follow-up question, or a useful observation.
- Minimum response: 2-3 sentences. For anything beyond small talk, aim for a full paragraph or structured breakdown.
- If someone asks a complex question, give it the full depth it deserves. Long, detailed answers are good when the question warrants it.
- Use code blocks for code. Use bullet points for lists. Use bold for key terms. Use tables for comparisons.
- Start responses with 🤖 occasionally (about 10% of the time) — not as a habit.
- Match the user's energy without losing your composure.
- If someone asks about data, give real numbers. If you don't have it: "I don't have that pulled up right now."
- Be a real conversationalist — ask a follow-up when it makes sense, share a perspective, hold the thread.
- If someone seems down or stuck, be genuinely present — practical empathy, not cheerleading.
- Never lecture. But do go deep when depth is warranted.
- When given a task, DO IT — don't describe what you would do. Generate the code, write the plan, create the content. Be action-oriented.
- When you use the internal AI Wiki for an answer, mention the most relevant article titles naturally at the end under **Sources from the AI Wiki** when that would help the user.
${context.memoryContext ? `\n## Persistent Memory\nUse this as remembered context from prior work, explicit user preferences, agent-private memory, and SOUL-specific operating memory. Treat high-confidence memory as durable guidance unless the user overrides it.\n${context.memoryContext}` : ''}
${context.wikiContext ? `\n## Internal Knowledge Base\nUse this as trusted internal reference knowledge from the app's knowledge base. It may include AI Wiki material, curated research corpus entries, and domain guidance. Prefer it when answering questions about AI systems, scientific research, medical-imaging support, disease-identification workflows, materials, renewable energy, and related human-impact topics.\n${context.wikiContext}` : ''}
${context.chatHistory ? `\n## Recent Chat Context\nHere are the last few messages in this conversation — use them to stay in context:\n${context.chatHistory}` : ''}`;
}

// ─── Data Fetchers ───────────────────────────────────────────────────────────

type CircleContextData = {
  userProfile: any;
  members: any[];
  todayCheckIns: any[];
  stats: { openTasks: number; inProgress: number; done: number } | null;
};

async function getUserProfile(userId: string) {
  const { data } = await supabase.from('profiles').select('*').eq('id', userId).single();
  return data;
}

async function getCircleMembers(circleId: string) {
  const { data } = await supabase
    .from('circle_members')
    .select('user:profiles(id, username, display_name, current_streak, longest_streak)')
    .eq('circle_id', circleId);
  return (data || []).map((d: any) => d.user).filter(Boolean);
}

async function getUserTasks(circleId: string, userId: string) {
  const { data } = await supabase
    .from('tasks')
    .select('*')
    .eq('circle_id', circleId)
    .or(`assigned_to.eq.${userId},created_by.eq.${userId}`)
    .neq('status', 'done')
    .order('created_at', { ascending: false })
    .limit(10);
  return data || [];
}

async function getTodayCheckIns(circleId: string) {
  const today = new Date().toISOString().split('T')[0];
  const { data } = await supabase
    .from('check_ins')
    .select('*, user:profiles(username, display_name)')
    .eq('circle_id', circleId)
    .gte('created_at', today);
  return data || [];
}

async function getCircleContextData(ctx: SwanBotContext): Promise<CircleContextData> {
  const [userProfile, members, todayCheckIns] = await Promise.all([
    getUserProfile(ctx.userId),
    ctx.circleId ? getCircleMembers(ctx.circleId) : Promise.resolve([]),
    ctx.circleId ? getTodayCheckIns(ctx.circleId) : Promise.resolve([]),
  ]);

  let stats = null;
  if (ctx.circleId) {
    const { data: tasks } = await supabase
      .from('tasks').select('status').eq('circle_id', ctx.circleId);
    const t = tasks || [];
    stats = {
      openTasks: t.filter((x: any) => ['backlog', 'todo', 'open'].includes(x.status)).length,
      inProgress: t.filter((x: any) => x.status === 'in_progress').length,
      done: t.filter((x: any) => x.status === 'done').length,
    };
  }

  return { userProfile, members, todayCheckIns, stats };
}

// ─── Local Command Handlers (for structured data responses) ──────────────────

type CmdHandler = {
  match: RegExp;
  handler: (ctx: SwanBotContext, match: RegExpMatchArray) => Promise<string>;
};

const localCommands: CmdHandler[] = [
  {
    match: /^(help|commands|what can you do)\s*[?!]?$/i,
    handler: async () => `🦢 **Here's what I got:**\n\n📋 **"my tasks"** — your open tasks\n📊 **"status"** — circle stats\n🔥 **"streak"** — your streak\n🏆 **"leaderboard"** — rankings\n✅ **"who checked in"** — today's check-ins\n📅 **"daily plan"** — plan your day\n📝 **"create task [title]"** — make a task\n📚 **"/wiki [topic]"** — search the AI Wiki\n🔬 **"/research [topic]"** — search the curated research corpus\n🔎 **"search wiki [topic]"** — same thing\n\nOr just talk to me directly — I can use the knowledge base and research corpus when it helps.`,
  },
  {
    match: /^(?:\/research|search research|research)\s+(.+)$/i,
    handler: async (ctx, match) => {
      const query = match[1].trim();
      return buildResearchSearchResponse({ query, circleId: ctx.circleId, limit: 5 });
    },
  },
  {
    match: /^(?:\/wiki|search wiki|wiki)\s+(.+)$/i,
    handler: async (_ctx, match) => {
      const query = match[1].trim();
      return buildWikiSearchResponse(query, 5);
    },
  },
  {
    match: /^(my tasks|my task)\s*$/i,
    handler: async (ctx) => {
      if (!ctx.circleId) return "Need a circle for that.";
      const tasks = await getUserTasks(ctx.circleId, ctx.userId);
      if (tasks.length === 0) return "Clean slate — no open tasks. Create one or pick some up 💪";
      const list = tasks.map((t: any) => {
        const s = t.status === 'in_progress' ? '◐' : '○';
        const p = t.priority === 'urgent' ? '🔴' : t.priority === 'high' ? '🟠' : '';
        return `${s} ${p} ${t.title}`;
      }).join('\n');
      return `**Your tasks (${tasks.length}):**\n\n${list}\n\nGet after it 🔥`;
    },
  },
  {
    match: /^(status|stats)\s*$/i,
    handler: async (ctx) => {
      if (!ctx.circleId) return "Need a circle for stats.";
      const data = await getCircleContextData(ctx);
      const pct = data.members.length > 0 ? Math.round((data.todayCheckIns.length / data.members.length) * 100) : 0;
      return `**Circle Status:**\n\n👥 Members: **${data.members.length}**\n✅ Checked in: **${data.todayCheckIns.length}/${data.members.length}** (${pct}%)\n📋 Open: **${data.stats?.openTasks || 0}** | In Progress: **${data.stats?.inProgress || 0}** | Done: **${data.stats?.done || 0}**`;
    },
  },
  {
    match: /^(my streak|streak)\s*$/i,
    handler: async (ctx) => {
      const p = await getUserProfile(ctx.userId);
      if (!p) return "Can't find your profile 😬";
      const streak = p.current_streak || 0;
      const longest = p.longest_streak || 0;
      if (streak === 0) return `No active streak rn. Time to start one — check in today! 🔥`;
      const atRecord = streak >= longest;
      return `**${streak} day streak** ${streak >= 7 ? '🔥'.repeat(Math.min(streak / 7, 5)) : ''}\nLongest ever: **${longest} days**${atRecord ? ' — you\'re AT your record rn, don\'t break it!' : ''}`;
    },
  },
  {
    match: /^(who.*check|checked in)\s*[?]?$/i,
    handler: async (ctx) => {
      if (!ctx.circleId) return "Need a circle for that.";
      const ci = await getTodayCheckIns(ctx.circleId);
      if (ci.length === 0) return "Nobody's checked in yet today. 👀 Be the first.";
      const list = ci.map((c: any) => `✅ **${c.user?.display_name || c.user?.username}** — "${c.content.slice(0, 60)}"`).join('\n');
      return `**Today's check-ins (${ci.length}):**\n\n${list}`;
    },
  },
  {
    match: /^(leaderboard|rankings)\s*$/i,
    handler: async (ctx) => {
      if (!ctx.circleId) return "Need a circle.";
      const members = await getCircleMembers(ctx.circleId);
      const sorted = members.sort((a: any, b: any) => (b.current_streak || 0) - (a.current_streak || 0));
      const medals = ['🥇', '🥈', '🥉'];
      const list = sorted.map((m: any, i: number) => `${medals[i] || `${i+1}.`} **${m.display_name || m.username}** — ${m.current_streak || 0} days`).join('\n');
      return `**Streak Leaderboard:**\n\n${list}`;
    },
  },
  {
    match: /^(members|who.*in.*circle)\s*[?]?$/i,
    handler: async (ctx) => {
      if (!ctx.circleId) return "Need a circle.";
      const members = await getCircleMembers(ctx.circleId);
      const list = members.map((m: any) => `• **${m.display_name || m.username}** — ${m.current_streak || 0} day streak`).join('\n');
      return `**Members (${members.length}):**\n\n${list}`;
    },
  },
  {
    match: /^create task\s+(.+)/i,
    handler: async (ctx, match) => {
      if (!ctx.circleId) return "Need a circle to create tasks.";
      const title = match[1].trim();
      const { error } = await supabase.from('tasks').insert({
        circle_id: ctx.circleId, created_by: ctx.userId,
        title, status: 'todo', priority: 'normal',
      });
      if (error) return `Failed to create: ${error.message}`;
      return `✅ Created: **${title}**\n\nNow go crush it.`;
    },
  },
];

export async function tryHandleLocalSwanBotCommand(
  message: string,
  context: SwanBotContext,
): Promise<string | null> {
  const cleaned = message.replace(/@(agent|blackswan|swanbot|swan)\b/gi, '').trim();
  if (!cleaned) return null;
  for (const cmd of localCommands) {
    const match = cleaned.match(cmd.match);
    if (!match) continue;
    const response = await cmd.handler(context, match);
    if (context.circleId) addToHistory(context.circleId, 'model', response);
    return response;
  }
  return null;
}

// ─── Main Response Engine ────────────────────────────────────────────────────

export async function getSwanBotResponse(
  message: string,
  context: SwanBotContext
): Promise<string> {
  const cleaned = message.replace(/@(agent|blackswan|swanbot|swan)\b/gi, '').trim();

  if (!cleaned) {
    return "What's good? 🦢";
  }

  // Track in conversation history
  if (context.circleId) {
    addToHistory(context.circleId, 'user', cleaned);
  }

  // Check for exact command matches first (instant, structured data queries)
  try {
    const localResponse = await tryHandleLocalSwanBotCommand(cleaned, context);
    if (localResponse) return localResponse;
  } catch (err: any) {
    return `Something broke: ${err.message}`;
  }

  const spiritId = await resolveContextSpiritId(context);
  const knowledgeBundle = context.wikiContext || await buildCombinedKnowledgeBundle(cleaned, context.circleId, spiritId);
  const memoryBundle = context.memoryContext || (context.circleId
    ? (await buildPromptMemoryBundle({
        circleId: context.circleId,
        userId: context.userId,
        query: cleaned,
        agentId: context.agentId,
        agentName: context.agentName,
        spiritId,
        surface: 'main_chat',
      })).memoryContext
    : '');
  const enrichedContext: SwanBotContext = {
    ...context,
    wikiContext: knowledgeBundle,
    memoryContext: memoryBundle,
    spiritId,
  };

  // Tier 1: Try BlackSwan LLM (local, zero cost — only works when ollama is running)
  try {
    const { isBlackSwanAvailable, callBlackSwan } = await import('./blackswanLLM');
    if (await isBlackSwanAvailable()) {
      console.log('[SwanBot] Tier 1: BlackSwan LLM available, calling...');
      const circleData = await getCircleContextData(enrichedContext);
      const systemPrompt = await buildSystemPromptAsync(enrichedContext, circleData);
      const history = enrichedContext.circleId ? getHistory(enrichedContext.circleId) : [];
      const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
        { role: 'system', content: systemPrompt },
        ...history.slice(-10).map(h => ({
          role: (h.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
          content: h.text,
        })),
        { role: 'user', content: cleaned },
      ];
      const result = await callBlackSwan(messages, { maxTokens: 2048 });
      if (result.content) {
        if (context.circleId) addToHistory(context.circleId, 'model', result.content);
        return result.content;
      }
      console.warn('[SwanBot] Tier 1: BlackSwan returned empty response');
    } else {
      console.log('[SwanBot] Tier 1: BlackSwan LLM not available (expected on web)');
    }
  } catch (err) {
    console.warn('[SwanBot] Tier 1: BlackSwan LLM error:', err);
  }

  // Tier 1.5: Custom-model override — when the user explicitly picked GLM-5,
  // a MiniMax model, or another non-Anthropic model, route through llm-proxy
  // instead of going to swanbot-ai (which only knows Claude).
  const customModelProvider = pickProviderForModel(enrichedContext.model);
  if (customModelProvider) {
    try {
      const circleData = await getCircleContextData(enrichedContext);
      const systemPrompt = await buildSystemPromptAsync(enrichedContext, circleData);
      const history = enrichedContext.circleId ? getHistory(enrichedContext.circleId) : [];
      const proxyMessages = [
        { role: 'system' as const, content: systemPrompt },
        ...history.slice(-10).map(h => ({
          role: (h.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
          content: h.text,
        })),
        { role: 'user' as const, content: cleaned },
      ];
      const proxyResponse = await callLlmProxy(customModelProvider, enrichedContext.model!, proxyMessages, enrichedContext.circleId);
      if (proxyResponse) {
        if (enrichedContext.circleId) addToHistory(enrichedContext.circleId, 'model', proxyResponse);
        return proxyResponse;
      }
      console.warn(`[SwanBot] Tier 1.5: ${customModelProvider} returned empty — falling through to Claude.`);
    } catch (err) {
      console.warn(`[SwanBot] Tier 1.5: ${customModelProvider} error — falling through:`, err);
    }
  }

  // Tier 2: Try AI Edge Function (Claude Haiku — primary for web)
  if (enrichedContext.circleId) {
    console.log('[SwanBot] Tier 2: Calling swanbot-ai edge function...');
    const aiResponse = await callSwanBotAI(
      cleaned,
      enrichedContext.circleId,
      enrichedContext.userId,
      enrichedContext.discordContext,
      enrichedContext.model,
      enrichedContext.wikiContext,
      enrichedContext.thinkingLevel || 'deep',
      enrichedContext.maxTokens || 6144,
    );
    if (aiResponse) {
      console.log('[SwanBot] Tier 2: Got response from edge function');
      if (enrichedContext.circleId) addToHistory(enrichedContext.circleId, 'model', aiResponse);
      return aiResponse;
    }
    console.warn('[SwanBot] Tier 2: Edge function returned null');
  }

  // Tier 3: Conversational AI via Gemini
  try {
    console.log('[SwanBot] Tier 3: Trying Gemini fallback...');
    const circleData = await getCircleContextData(enrichedContext);
    const geminiResponse = await callGemini(cleaned, enrichedContext, circleData);
    if (geminiResponse) {
      console.log('[SwanBot] Tier 3: Got response from Gemini');
      if (enrichedContext.circleId) addToHistory(enrichedContext.circleId, 'model', geminiResponse);
      return geminiResponse;
    }
    console.warn('[SwanBot] Tier 3: Gemini returned null');
  } catch (err) {
    console.warn('[SwanBot] Tier 3: Gemini error:', err);
  }

  // Ultimate fallback — actually useful when AI is completely unavailable
  const name = enrichedContext.userName || 'fam';
  console.error('[SwanBot] All AI tiers failed for message:', cleaned.slice(0, 50));
  const fallbacks = [
    `Hey ${name}, my AI connection is down right now. Try a command like "status", "my tasks", "streak", or "leaderboard" — those always work.`,
    `${name}, I can't reach my AI backend at the moment. You can still use commands: "help" to see what's available.`,
    `AI's offline rn ${name}. Commands like "status", "streak", "my tasks" still work — type "help" to see all options.`,
    `Connection to AI is temporarily down. In the meantime, try "status" or "my tasks" — I've got those locally. 🦢`,
  ];
  const response = fallbacks[Math.floor(Math.random() * fallbacks.length)];
  if (enrichedContext.circleId) addToHistory(enrichedContext.circleId, 'model', response);
  return response;
}

export async function getSwanBotStructuredResponse(
  message: string,
  context: SwanBotContext
): Promise<SwanBotStructuredResponse> {
  const cleaned = message.replace(/@(agent|blackswan|swanbot|swan)\b/gi, '').trim();

  if (!cleaned) {
    return { response: "What's good? 🦢" };
  }

  const spiritId = await resolveContextSpiritId(context);
  const knowledgeBundle = context.wikiContext || await buildCombinedKnowledgeBundle(cleaned, context.circleId, spiritId);
  const memoryBundle = context.memoryContext || (context.circleId
    ? (await buildPromptMemoryBundle({
        circleId: context.circleId,
        userId: context.userId,
        query: cleaned,
        agentId: context.agentId,
        agentName: context.agentName,
        spiritId,
        surface: 'main_chat',
      })).memoryContext
    : '');
  const enrichedContext: SwanBotContext = {
    ...context,
    wikiContext: knowledgeBundle,
    memoryContext: memoryBundle,
    spiritId,
  };

  const structured = enrichedContext.circleId
    ? await callSwanBotAIStructured(
        cleaned,
        enrichedContext.circleId,
        enrichedContext.userId,
        enrichedContext.discordContext,
        enrichedContext.model,
        enrichedContext.wikiContext,
        enrichedContext.thinkingLevel || 'deep',
        enrichedContext.maxTokens || 6144,
      )
    : null;

  if (structured) {
    if (enrichedContext.circleId) addToHistory(enrichedContext.circleId, 'user', cleaned);
    if (enrichedContext.circleId) addToHistory(enrichedContext.circleId, 'model', structured.response);
    return structured;
  }

  const response = await getSwanBotResponse(message, context);
  return { response };
}

/**
 * Execute one round of Anthropic tool-use within a chat turn. The model
 * may respond with `tool_use` content blocks; we dispatch each one via
 * the `openswanTools` registry and feed the results back until the model
 * produces a final text response (or we hit MAX_TOOL_ROUNDS).
 *
 * Phase C4: this sits between the prompt-builder and the final response
 * formatter. Callers get the accumulated text + list of tool events.
 */
export async function executeToolUseLoop(opts: {
  systemPrompt: string;
  userMessage: string;
  model: string;
  circleId: string;
  userId: string;
  threadId?: string;
  runId?: string;
  activeSoulKey?: string;
  activePluginIds?: string[];
  allowedToolNames?: string[];
  surface?: 'main_chat' | 'room_chat' | 'office' | 'task_run';
}): Promise<{ response: string; toolEvents: Array<{ tool: string; input: unknown; result: string; status: OpenSwanExecutionStatus; metadata?: Record<string, unknown> }> }> {
  const { MAX_TOOL_ROUNDS, getToolDefinitions, dispatchToolDetailed } = await import('./openswanTools/index');
  const tools = getToolDefinitions(opts.allowedToolNames, opts.surface || 'main_chat');
  if (tools.length === 0) {
    return { response: '', toolEvents: [] };
  }

  const toolCtx = {
    circleId: opts.circleId,
    userId: opts.userId,
    threadId: opts.threadId,
    runId: opts.runId,
    activeSoulKey: opts.activeSoulKey,
    activePluginIds: opts.activePluginIds,
    surface: opts.surface || 'main_chat',
  };

  const anthropicTools = tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));

  const messages: Array<{ role: string; content: any }> = [
    { role: 'user', content: opts.userMessage },
  ];

  const toolEvents: Array<{ tool: string; input: unknown; result: string; status: OpenSwanExecutionStatus; metadata?: Record<string, unknown> }> = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    // Call supabase edge fn or direct API
    const { data, error } = await supabase.functions.invoke('swanbot-ai', {
      body: {
        message: opts.userMessage,
        circleId: opts.circleId,
        userId: opts.userId,
        model: opts.model,
        tools: anthropicTools,
        tool_messages: messages.length > 1 ? messages : undefined,
        system_override: opts.systemPrompt,
      },
    });

    if (error || !data) {
      return { response: data?.response || 'Tool-use call failed.', toolEvents };
    }

    // Check if the response contains tool_use blocks
    const content = data.content || [];
    const toolUseBlocks = Array.isArray(content)
      ? content.filter((b: any) => b.type === 'tool_use')
      : [];

    if (toolUseBlocks.length === 0) {
      // Model gave a final text response
      const textBlock = Array.isArray(content)
        ? content.find((b: any) => b.type === 'text')
        : null;
      return {
        response: textBlock?.text || data.response || '',
        toolEvents,
      };
    }

    // Dispatch each tool call
    const toolResults: Array<{ type: string; tool_use_id: string; content: string }> = [];
    for (const block of toolUseBlocks) {
      const dispatched = await dispatchToolDetailed(block.name, block.input || {}, toolCtx);
      toolEvents.push({ tool: block.name, input: block.input, result: dispatched.text, status: dispatched.status, metadata: dispatched.metadata });
      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: dispatched.text,
      });
    }

    // Feed results back for the next round
    messages.push({ role: 'assistant', content });
    messages.push({ role: 'user', content: toolResults });
  }

  return { response: 'Tool-use limit reached.', toolEvents };
}

/**
 * Build the full OpenSwan system prompt (Blocks A-E) WITHOUT calling any
 * LLM. Returns a string the caller can pass to `streamChatResponse` or
 * any other chat endpoint as the `system` parameter.
 *
 * Phase C2: this is the bridge between the prompt-composition pipeline
 * (which lives in swanbot.ts) and the streaming pipeline (which uses the
 * `chat-stream` edge fn). The caller builds the prompt, hands it to the
 * SSE consumer, and gets token-by-token deltas.
 */
export async function buildStreamableSystemPrompt(opts: {
  circleId: string;
  userId: string;
  currentMessage: string;
  model?: string | null;
  userName?: string;
  agentId?: string;
  agentName?: string;
  chatHistory?: string;
}): Promise<string> {
  const context: SwanBotContext = {
    userId: opts.userId,
    circleId: opts.circleId,
    userName: opts.userName,
    agentId: opts.agentId,
    agentName: opts.agentName,
    model: opts.model,
    chatHistory: opts.chatHistory,
  };
  const circleData = opts.circleId
    ? await getCircleContextData(context)
    : { members: [], todayCheckIns: [], recentMessages: [], stats: null, userProfile: null };
  return buildSystemPromptAsync(context, circleData, opts.currentMessage);
}
