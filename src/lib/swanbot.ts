/**
 * SwanBot AI Client
 * Primary: Supabase Edge Function
 * Fallback: Google Gemini API for conversational AI
 * Local commands for data queries
 */

import { supabase } from './supabase';
import { getFreshAccessToken } from './authSession';
import type { PromptMemoryReference } from './memoryService';
import { buildSpiritWikiKnowledgeBundle, buildWikiKnowledgeBundle, buildWikiSearchResponse } from './wikiData';
import { buildResearchKnowledgeBundle, buildResearchSearchResponse, buildSpiritResearchKnowledgeBundle } from './researchKnowledge';
import { getAgentIdentityKey, loadAgentIdentities } from './agentIdentity';
import type { OpenSwanExecutionStatus } from './openswanExecution';
import { getStrictLocalAiModeMessage, isStrictLocalAiModeEnabled, shouldBlockExternalAiProvider } from './privacyMode';
import type { OpenSwanMemoryStores } from './openswanMemoryStores';
import type { OpenSwanChatMode } from './openswanModePolicy';
import type { OpenSwanResolvedSkill } from './openswanSkillResolution';

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
  conversationMessages?: Array<{ role: 'user' | 'assistant' | 'model'; content: string }>;
  wikiContext?: string;
  memoryContext?: string;
  memoryStores?: OpenSwanMemoryStores;
  memoryRefs?: PromptMemoryReference[];
  modeKey?: OpenSwanChatMode | string | null;
  taskKind?: string | null;
  sessionProfile?: string | null;
  resolvedSkills?: OpenSwanResolvedSkill[];
  resolvedSkillsPromptBlock?: string | null;
  spiritId?: string | null;
  attachmentContext?: string;
  sessionArchiveContext?: string;
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
  if (shouldBlockExternalAiProvider(provider)) return null;
  const accessToken = await getFreshAccessToken();
  if (!accessToken) return null;
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
  if (!supabaseUrl) return null;
  const url = `${supabaseUrl}/functions/v1/llm-proxy`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
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

/**
 * Invokes the v2 edge function (`swanbot-v2-ai`). Mirrors
 * `callSwanBotAI`'s signature so the call-site switch is transparent.
 *
 * M2 round-trip pattern: when the edge fn returns
 * `{ pending: true, clientToolCalls, continuationRunId }`, we execute
 * the client-side tools (desktop bridge, etc.) and POST the results
 * back with `{ continuationRunId, toolResults }`. Loop until terminal
 * or 6-continuation cap.
 *
 * Returns `null` on failure so the caller can fall back to v1.
 * See `docs/SWANBOT_V2_MIGRATION_PLAN.md` for rollout boundaries.
 */
async function callSwanBotV2(
  message: string,
  circleId: string,
  userId: string,
  _discordContext?: string,
  model?: string | null,
  _wikiContext?: string,
  conversationMessages?: Array<{ role: string; content: string }>,
  thinkingLevel: 'fast' | 'balanced' | 'deep' = 'deep',
  _maxTokens = 6144,
  systemDirective?: string,
): Promise<string | null> {
  if (shouldBlockExternalAiProvider('anthropic')) return null;
  const MAX_CONTINUATIONS = 6;
  try {
    const accessToken = await getFreshAccessToken();
    if (!accessToken) return null;

    // ── First call — initial message. ─────────────────────────────────
    let response = await invokeSwanbotV2(accessToken, {
      message,
      circleId,
      userId,
      mode: thinkingLevel === 'fast' ? 'talk' : 'build',
      model: model || undefined,
      systemDirective,
      legacy: { conversationMessages },
    });
    if (!response) return null;

    // ── Continuation loop for clientOnly tool calls. ──────────────────
    for (let i = 0; i < MAX_CONTINUATIONS; i++) {
      if (!response.pending) break;
      const toolResults = await executeClientToolCalls(response.clientToolCalls || []);
      response = await invokeSwanbotV2(accessToken, {
        circleId,
        userId,
        continuationRunId: response.continuationRunId,
        toolResults,
      });
      if (!response) return null;
    }

    if (response.pending) {
      console.warn('[SwanBot/v2] hit continuation cap — returning partial.');
      return null;
    }
    return response.text || response.response || null;
  } catch (err: any) {
    console.warn('[SwanBot/v2] call failed:', err?.message || err);
    return null;
  }
}

type V2Response =
  | {
      pending: true;
      clientToolCalls: Array<{ id: string; name: string; input: unknown }>;
      continuationRunId: string;
      text?: string;
      response?: string;
    }
  | {
      pending?: false;
      text?: string;
      response?: string;
    };

async function invokeSwanbotV2(
  accessToken: string,
  body: Record<string, unknown>,
): Promise<V2Response | null> {
  const { data, error } = await supabase.functions.invoke('swanbot-v2-ai', {
    headers: { Authorization: `Bearer ${accessToken}` },
    body,
  });
  if (error) {
    console.warn('[SwanBot/v2] invoke error:', error?.message || String(error));
    return null;
  }
  if (data?.error) {
    console.warn('[SwanBot/v2] edge returned error:', data.error);
    return null;
  }
  return (data || null) as V2Response | null;
}

// Dispatch client-delegated tool calls against the local bridge. Every
// returned `{ tool_use_id, content, is_error? }` gets forwarded to the
// edge fn as the next `tool_result` content block.
async function executeClientToolCalls(
  calls: Array<{ id: string; name: string; input: unknown }>,
): Promise<Array<{ tool_use_id: string; content: string; is_error?: boolean }>> {
  if (calls.length === 0) return [];
  const bridge = await import('./desktopBridge');
  const out: Array<{ tool_use_id: string; content: string; is_error?: boolean }> = [];
  for (const call of calls) {
    try {
      const result = await dispatchOneClientTool(bridge, call);
      out.push({
        tool_use_id: call.id,
        content: JSON.stringify(result.ok ? { ok: true, data: result.data } : { ok: false, error: result.error || 'failed' }),
        is_error: !result.ok,
      });
    } catch (err: any) {
      out.push({
        tool_use_id: call.id,
        content: JSON.stringify({ ok: false, error: err?.message || 'client tool dispatch threw' }),
        is_error: true,
      });
    }
  }
  return out;
}

async function dispatchOneClientTool(
  bridge: typeof import('./desktopBridge'),
  call: { id: string; name: string; input: unknown },
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const input = (call.input || {}) as Record<string, any>;
  switch (call.name) {
    case 'desktop.launch_app':        return bridge.launchApp(String(input.appName || ''));
    case 'desktop.focus_app':         return bridge.focusApp(String(input.appName || ''));
    case 'desktop.type_text':         return bridge.typeText(String(input.text || ''));
    case 'desktop.press_keys':        return bridge.pressKeys(String(input.combo || ''));
    case 'desktop.list_running_apps': {
      const r = await bridge.listRunningApps();
      return r.ok ? { ok: true, data: { apps: r.data || [] } } : r;
    }
    case 'desktop.wait_for_app':
      return bridge.waitForApp(String(input.appName || ''), typeof input.timeoutMs === 'number' ? input.timeoutMs : undefined);
    case 'desktop.screenshot': {
      const r = await bridge.takeScreenshot();
      if (!r.ok) return r;
      // Don't round-trip full base64 through the model — it blows the
      // context budget. Return size + a short preview so the model
      // knows the screenshot happened; the UI surfaces the full image.
      return {
        ok: true,
        data: {
          sizeBytes: r.data?.sizeBytes ?? 0,
          mimeType: r.data?.mimeType || 'image/png',
          preview: (r.data?.base64 || '').slice(0, 128) + '…',
        },
      };
    }
    case 'desktop.open_url':   return bridge.openUrl(String(input.url || ''));
    case 'desktop.open_path':  return bridge.openPath(String(input.path || ''));
    case 'desktop.click_at':   return bridge.clickAt(Number(input.x), Number(input.y));
    case 'desktop.screen_size':return bridge.getScreenSize();

    // ── M3c: workspace + verification ─────────────────────────────────
    case 'workspace.create_room':
      return dispatchWorkspaceCreateRoom(input);
    case 'workspace.apply_artifacts':
      return dispatchWorkspaceApplyArtifacts(input);
    case 'workspace.open_preview':
      return dispatchWorkspaceOpenPreview(input);
    case 'verification.typecheck':
    case 'verification.tests':
    case 'verification.lint':
      return dispatchVerification(call.name, input);

    // ── M3d: credentials (1Password via local bridge) ─────────────────
    case 'credentials.get':
      return dispatchCredentialsGet(input);

    // ── M3e: WordPress publishing (external side-effect) ──────────────
    case 'wp.discover_types':
      return dispatchWpDiscoverTypes(input);
    case 'wp.list_posts':
      return dispatchWpListPosts(input);
    case 'wp.upload_media':
      return dispatchWpUploadMedia(input);
    case 'wp.create_slide':
      return dispatchWpCreateSlide(input);

    default:
      return { ok: false, error: `Unknown client tool "${call.name}"` };
  }
}

// ─── M3c dispatchers ──────────────────────────────────────────────────────
//
// Lazy imports keep the module graph light when v2 isn't in use — v1
// users never pay the cost of loading chatWorkspace.ts, roomWorkspaceLauncher.ts,
// or claudeCodeDetector.ts unless the model actually invokes one of
// these tools through the v2 round-trip.

function normalizeArtifact(raw: unknown): {
  kind: 'summary' | 'image' | 'translation' | 'classification' | 'vision' | 'audio' | 'code' | 'webpage';
  title: string;
  content?: string | null;
  url?: string | null;
  metadata?: Record<string, unknown>;
} | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as any;
  const kind = String(a.kind || '');
  const allowed = ['summary', 'image', 'translation', 'classification', 'vision', 'audio', 'code', 'webpage'];
  if (!allowed.includes(kind)) return null;
  const title = String(a.title || '').slice(0, 200);
  if (!title) return null;
  return {
    kind: kind as any,
    title,
    content: typeof a.content === 'string' ? a.content : null,
    url: typeof a.url === 'string' ? a.url : null,
    metadata: (a.metadata && typeof a.metadata === 'object') ? a.metadata : undefined,
  };
}

async function dispatchWorkspaceCreateRoom(input: Record<string, any>): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const artifact = normalizeArtifact(input.artifact);
  if (!artifact) return { ok: false, error: 'artifact required with valid { kind, title }' };
  const circleId = String(input.circleId || '').trim();
  if (!circleId) return { ok: false, error: 'circleId required' };
  try {
    const { createWorkspaceFromArtifact } = await import('./chatWorkspace');
    const result = await createWorkspaceFromArtifact(circleId, artifact);
    if (!result.roomId) return { ok: false, error: 'workspace creation returned no roomId' };
    return { ok: true, data: result };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

async function dispatchWorkspaceApplyArtifacts(input: Record<string, any>): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const roomId = String(input.roomId || '').trim();
  if (!roomId) return { ok: false, error: 'roomId required' };
  const artifact = normalizeArtifact(input.artifact);
  if (!artifact) return { ok: false, error: 'artifact required with valid { kind, title }' };
  try {
    const { createFilesInRoomFromArtifact } = await import('./chatWorkspace');
    const result = await createFilesInRoomFromArtifact(roomId, artifact);
    return { ok: true, data: result };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

async function dispatchWorkspaceOpenPreview(input: Record<string, any>): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const roomId = String(input.roomId || '').trim();
  if (!roomId) return { ok: false, error: 'roomId required' };
  const preferredPanel: 'chat' | 'playground' = input.preferredPanel === 'chat' ? 'chat' : 'playground';
  try {
    const { primeRoomWorkspaceLaunch, focusRoomWorkspaceFile } = await import('./roomWorkspaceLauncher');
    if (input.circleId) {
      primeRoomWorkspaceLaunch({
        circleId: String(input.circleId),
        roomId,
        primaryFileId: input.primaryFileId ? String(input.primaryFileId) : null,
        preferredPanel,
      });
    } else {
      focusRoomWorkspaceFile({
        roomId,
        primaryFileId: input.primaryFileId ? String(input.primaryFileId) : null,
        preferredPanel,
      });
    }
    return { ok: true, data: { roomId, preferredPanel } };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

const DEFAULT_VERIFICATION_COMMANDS: Record<'verification.typecheck' | 'verification.tests' | 'verification.lint', string> = {
  'verification.typecheck': 'npm run typecheck:app',
  'verification.tests': 'npm test',
  'verification.lint': 'npm run lint',
};

// ─── M3e: WordPress dispatchers ────────────────────────────────────────
//
// Each tool validates siteUrl shape (must be http/https) + the
// required onePasswordItem reference before touching the wpAdmin
// module. Summaries are trimmed to keep tool_result payloads small —
// the full WP response is available via another round-trip if the
// model actually needs the raw data.

function validateWpSite(input: Record<string, any>): { ok: true; site: { siteUrl: string; onePasswordItem: string; onePasswordVault?: string } } | { ok: false; error: string } {
  const siteUrl = String(input?.siteUrl || '').trim();
  if (!/^https?:\/\//i.test(siteUrl)) return { ok: false, error: 'siteUrl must start with http(s)://' };
  const onePasswordItem = String(input?.onePasswordItem || '').trim();
  if (!onePasswordItem) return { ok: false, error: 'onePasswordItem required' };
  const onePasswordVault = typeof input?.vault === 'string' && input.vault.trim() ? input.vault.trim() : undefined;
  return { ok: true, site: { siteUrl, onePasswordItem, onePasswordVault } };
}

async function dispatchWpDiscoverTypes(input: Record<string, any>): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const v = validateWpSite(input);
  if (!v.ok) return v;
  try {
    const { discoverPostTypes } = await import('./wpAdmin');
    const types = await discoverPostTypes(v.site);
    const slim = Object.entries(types).slice(0, 40).map(([slug, t]: [string, any]) => ({
      slug,
      name: t?.name || slug,
      rest_base: t?.rest_base || slug,
    }));
    return { ok: true, data: { siteUrl: v.site.siteUrl, count: slim.length, types: slim } };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

async function dispatchWpListPosts(input: Record<string, any>): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const v = validateWpSite(input);
  if (!v.ok) return v;
  const postType = typeof input?.postType === 'string' ? input.postType : undefined;
  const perPage = typeof input?.perPage === 'number' ? Math.max(1, Math.min(50, input.perPage)) : 20;
  const status = typeof input?.status === 'string' ? input.status : undefined;
  try {
    const { listPosts } = await import('./wpAdmin');
    const posts = await listPosts(v.site, { postType, perPage, status });
    const slim = posts.slice(0, perPage).map((p) => ({
      id: p.id,
      title: typeof p.title === 'string' ? p.title : p.title?.rendered,
      status: p.status,
      link: p.link,
    }));
    return { ok: true, data: { count: slim.length, posts: slim } };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

async function dispatchWpUploadMedia(input: Record<string, any>): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const v = validateWpSite(input);
  if (!v.ok) return v;
  const storagePath = String(input?.storagePath || '').trim();
  const fileName = String(input?.fileName || '').trim();
  if (!storagePath || !fileName) return { ok: false, error: 'storagePath and fileName required' };
  const mimeType = typeof input?.mimeType === 'string' && input.mimeType.trim() ? input.mimeType.trim() : 'application/octet-stream';
  try {
    const { uploadMediaFromStorage } = await import('./wpAdmin');
    const media = await uploadMediaFromStorage(v.site, storagePath, fileName, mimeType);
    return { ok: true, data: { id: media.id, source_url: media.source_url, fileName } };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

async function dispatchWpCreateSlide(input: Record<string, any>): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const v = validateWpSite(input);
  if (!v.ok) return v;
  const storagePath = String(input?.storagePath || '').trim();
  const fileName = String(input?.fileName || '').trim();
  if (!storagePath || !fileName) return { ok: false, error: 'storagePath and fileName required' };
  const mimeType = typeof input?.mimeType === 'string' && input.mimeType.trim() ? input.mimeType.trim() : 'image/jpeg';
  const status: 'draft' | 'publish' = input?.status === 'draft' ? 'draft' : 'publish';
  const title = typeof input?.title === 'string' ? input.title : undefined;
  const slideType = typeof input?.slideType === 'string' && input.slideType.trim() ? input.slideType.trim() : undefined;
  try {
    const { uploadImageAndCreateSlide } = await import('./wpAdmin');
    const result = await uploadImageAndCreateSlide(
      v.site,
      { storagePath, fileName, mimeType },
      { title, status, slideType },
    );
    return {
      ok: true,
      data: {
        media: { id: result.media.id, source_url: result.media.source_url },
        slide: {
          id: result.slide.id,
          link: result.slide.link,
          status: result.slide.status,
          title: typeof result.slide.title === 'string' ? result.slide.title : result.slide.title?.rendered,
        },
      },
    };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

async function dispatchCredentialsGet(input: Record<string, any>): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const item = String(input?.item || '').trim();
  if (!item) return { ok: false, error: 'item required' };
  const vault = typeof input?.vault === 'string' ? input.vault.trim() : undefined;
  const fields = Array.isArray(input?.fields)
    ? (input.fields as unknown[]).map((f) => String(f)).filter(Boolean)
    : undefined;
  try {
    const { getCredentials } = await import('./credentialService');
    const r = await getCredentials({ item, vault, fields });
    if (!r.ok) return { ok: false, error: r.error || 'credential fetch failed' };
    // Return the fields map verbatim. The caller is responsible for not
    // echoing these to chat / other tools. The tool description warns
    // the model; we don't strip or mask here because callers like
    // `wp.create_slide` legitimately need the raw values.
    return { ok: true, data: { item, vault: vault || null, fields: r.fields } };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

async function dispatchVerification(
  name: 'verification.typecheck' | 'verification.tests' | 'verification.lint',
  input: Record<string, any>,
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const command = typeof input.command === 'string' && input.command.trim()
    ? input.command.trim()
    : DEFAULT_VERIFICATION_COMMANDS[name];
  try {
    const { detectClaudeCodeBridge, execBridgeCommand } = await import('./claudeCodeDetector');
    const alive = await detectClaudeCodeBridge();
    if (!alive) {
      return { ok: false, error: 'Local coding bridge unavailable — start it with `npm run bridge`.' };
    }
    const result = await execBridgeCommand(command);
    // Cap stdout/stderr at ~8KB each so long test output doesn't blow
    // the context budget on the next Anthropic turn.
    const clip = (s?: string) => (s ? s.slice(0, 8192) : '');
    return {
      ok: !!result.ok,
      data: {
        command,
        ok: !!result.ok,
        stdout: clip(result.stdout),
        stderr: clip(result.stderr),
        truncated: (result.stdout && result.stdout.length > 8192) || (result.stderr && result.stderr.length > 8192),
      },
      error: result.ok ? undefined : (result.error || 'verification failed'),
    };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

async function callSwanBotAI(
  message: string,
  circleId: string,
  userId: string,
  discordContext?: string,
  model?: string | null,
  wikiContext?: string,
  conversationMessages?: Array<{ role: string; content: string }>,
  thinkingLevel: 'fast' | 'balanced' | 'deep' = 'deep',
  maxTokens = 6144,
  systemDirective?: string,
): Promise<string | null> {
  // Phase M1 router: if the user opted into v2, try v2 first. On any
  // v2 failure we fall through to v1 so a flaky v2 deploy never breaks
  // chat. See `docs/SWANBOT_V2_MIGRATION_PLAN.md`.
  try {
    const { isSwanbotV2Enabled } = await import('./swanbotRouting');
    if (isSwanbotV2Enabled()) {
      const v2 = await callSwanBotV2(
        message, circleId, userId, discordContext, model, wikiContext,
        conversationMessages, thinkingLevel, maxTokens, systemDirective,
      );
      if (v2) return v2;
      console.log('[SwanBot] v2 returned null — falling back to v1.');
    }
  } catch (err) {
    console.warn('[SwanBot] routing check failed — using v1:', err);
  }
  if (shouldBlockExternalAiProvider('anthropic')) {
    console.warn('[SwanBot] Strict local AI mode blocked swanbot-ai');
    return null;
  }
  try {
    const accessToken = await getFreshAccessToken();
    if (!accessToken) {
      return null;
    }
    const { data, error } = await supabase.functions.invoke('swanbot-ai', {
      headers: { Authorization: `Bearer ${accessToken}` },
      body: {
        message,
        circleId,
        userId,
        discordContext,
        wikiContext,
        conversationMessages,
        model: model || 'claude-sonnet-4-6',
        maxTokens,
        thinkingLevel,
        // High-priority behavior directive prepended to the frozen system
        // prompt on the server. Used by the conversational build
        // orchestrator to enforce the ask-questions-first protocol.
        ...(systemDirective ? { systemDirective } : {}),
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
  conversationMessages?: Array<{ role: string; content: string }>,
  thinkingLevel: 'fast' | 'balanced' | 'deep' = 'deep',
  maxTokens = 6144,
): Promise<SwanBotStructuredResponse | null> {
  if (shouldBlockExternalAiProvider('anthropic')) {
    console.warn('[SwanBot] Strict local AI mode blocked structured swanbot-ai');
    return null;
  }
  try {
    const accessToken = await getFreshAccessToken();
    if (!accessToken) return null;
    const { data, error } = await supabase.functions.invoke('swanbot-ai', {
      headers: { Authorization: `Bearer ${accessToken}` },
      body: {
        message,
        circleId,
        userId,
        discordContext,
        wikiContext,
        conversationMessages,
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
  if (shouldBlockExternalAiProvider('gemini')) return null;
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
  // ── Adaptive context loading ──────────────────────────────────────────
  // Determine how much context to load based on message complexity.
  // Simple messages get a lean prompt (fast, cheap). Complex tasks get
  // the full context stack (memory, wisdom, skills, wiki, missions).
  const { analyzeMessageRouting } = await import('./messageRouting');
  const route = currentMessage
    ? analyzeMessageRouting(currentMessage, 'main_chat').route
    : null;
  const complexity = route?.complexity || 'moderate';
  const responseIntent = route?.intent || 'question';
  const base = buildSystemPrompt(context, data, responseIntent);
  const extras: string[] = [];

  // Context tiers:
  //   trivial  → profile only (greeting, thanks, yes/no)
  //   simple   → profile + memory startup bundle
  //   moderate → + SOUL wisdom + turn retrieval + missions
  //   complex  → + skills + attachments + full retrieval budget
  const loadProfile  = true;
  const loadMemory   = complexity !== 'trivial';
  const loadWisdom   = complexity === 'moderate' || complexity === 'complex';
  const loadRetrieval = complexity === 'moderate' || complexity === 'complex';
  const loadMissions = complexity === 'moderate' || complexity === 'complex';
  const loadSkills   = complexity === 'complex';
  const retrievalBudget = complexity === 'complex' ? 2500 : complexity === 'moderate' ? 1200 : 600;
  const retrievalCount  = complexity === 'complex' ? 12 : complexity === 'moderate' ? 6 : 3;

  // Shared timeout for async extras
  const withTimeout = <T>(p: Promise<T>, ms = 3000): Promise<T | null> =>
    Promise.race([p, new Promise<null>(r => setTimeout(() => r(null), ms))]);

  if (loadProfile) {
    try {
      const { loadUserProfile, generateProfileContext } = await import('./userChatProfile');
      const profile = await withTimeout(loadUserProfile());
      const profileCtx = profile ? generateProfileContext(profile) : null;
      if (profileCtx) extras.push(profileCtx);
    } catch (e) { console.warn('[SwanBot] Profile load failed:', e); }
  }

  // Load memory hierarchy for this circle (Phase 0/Phase 1 startup bundle)
  if (loadMemory) {
    try {
      if (context.circleId) {
        const contextSpiritId = await resolveContextSpiritId(context);
        const stores = context.memoryStores || await withTimeout(import('./openswanMemoryStores').then(({ buildOpenSwanMemoryStores }) => buildOpenSwanMemoryStores({
          circleId: context.circleId,
          userId: context.userId,
          query: currentMessage || '',
          agentId: context.agentId,
          agentName: context.agentName,
          spiritId: contextSpiritId,
          surface: 'main_chat',
          limit: 8,
        })));
        if (stores?.userProfile) extras.push(stores.userProfile);
        if (stores?.runtimeMemory) extras.push(stores.runtimeMemory);
        if (stores?.workingMemory) extras.push(`## Working Memory\n${stores.workingMemory}`);
      }
    } catch (e) { console.warn('[SwanBot] Memory context failed:', e); }
  }

  // Phase 2/3 — resolve the active SOUL once, use it for both blocks.
  let activeSoulKey: string | null = null;
  try {
    const spiritId = await resolveContextSpiritId(context);
    activeSoulKey = spiritId ? `soul:${spiritId}` : null;
  } catch (e) { console.warn('[SwanBot] Soul resolution failed:', e); }

  // Phase 3 — Block B: pre-distilled SOUL wisdom
  if (loadWisdom) {
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
  }

  // Phase 2 — Block C: turn-time semantic retrieval
  if (loadRetrieval) {
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
            budgetChars: retrievalBudget,
            finalCount: retrievalCount,
          }),
        );
        if (retrieval?.formatted) extras.push(retrieval.formatted);
      }
    } catch (e) { console.warn('[SwanBot] Turn retrieval failed:', e); }
  }

  // Wiki / knowledge base — only load for moderate+ complexity and when
  // the message touches knowledge topics. Keeps simple chat lean.
  if (loadWisdom && context.wikiContext) {
    extras.push(`## Internal Knowledge Base\nUse this as trusted internal reference knowledge.\n${context.wikiContext}`);
  }

  // Phase C1 — Block D: attachment context
  if ((context as any).attachmentContext) {
    extras.push((context as any).attachmentContext);
  }

  // Progressive project context discovery — load root context eagerly and
  // only inject deeper directory guidance when those paths actually show up
  // in the active conversation.
  try {
    const discovery = await withTimeout(import('./openswanContextDiscovery').then(({ discoverOpenSwanProjectContext }) => discoverOpenSwanProjectContext({
      currentMessage,
      chatHistory: context.chatHistory,
      conversationMessages: context.conversationMessages,
    })));
    if (discovery?.block) {
      extras.push(discovery.block);
    }
  } catch (e) { console.warn('[SwanBot] Project context discovery failed:', e); }

  // Phase C5 — Block E: skills prompt fragment
  if (loadSkills) {
    try {
      if (context.circleId && activeSoulKey) {
        const skillsBlock = context.resolvedSkillsPromptBlock
          || await withTimeout(import('./openswanSkills').then(({ resolveOpenSwanSkills }) => resolveOpenSwanSkills({
            circleId: context.circleId,
            userId: context.userId,
            soulKey: activeSoulKey,
            mode: context.modeKey,
            taskKind: context.taskKind,
            query: currentMessage || context.chatHistory || '',
            maxSkills: context.modeKey === 'research' || context.taskKind === 'research' ? 8 : 6,
          }).then((resolution) => resolution.promptBlock)));
        if (skillsBlock) extras.push(skillsBlock);
      }
    } catch (e) { console.warn('[SwanBot] Skills block failed:', e); }
  }

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

  // Load active missions for this circle (skip for trivial/simple messages)
  if (loadMissions) {
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
  }

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

  // Adaptive extras budget — trivial messages get a tiny prompt, complex ones get the full budget
  const MAX_EXTRAS_CHARS = complexity === 'trivial' ? 1200 : complexity === 'simple' ? 3000 : complexity === 'moderate' ? 5500 : 8000;
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

// ── Adaptive response directives per intent ─────────────────────────────────
// Instead of one static "How to Respond" block, generate directives matched
// to the detected intent. This controls length, tone, structure, and depth.

type ResponseIntent = import('./agenticCodingProfile').MessageIntent;

const RESPONSE_DIRECTIVES: Record<ResponseIntent, string> = {
  casual: `- Keep it short — 1-3 sentences max. Match the user's energy. A follow-up question or observation is fine, not a paragraph.
- Warm but not performative. Be a person, not a bot.`,

  question: `- Answer clearly and directly. Lead with the answer, then explain the why.
- Keep it under 200 words unless the question is genuinely complex. Use a list or code block if it helps.
- If you don't know, say so cleanly.`,

  status: `- Lead with data: numbers, streaks, progress, who shipped. Commentary second.
- Be factual and concise. Under 150 words.
- If data is missing, say what you'd need to look it up.`,

  social: `- Be fun and playful. Match the social energy.
- Keep it under 100 words. Games, polls, and banter should feel lightweight.`,

  memory: `- Confirm the action briefly: "Noted.", "Saved.", "Here's what I know about that:"
- Under 100 words unless showing a list of memories.`,

  support: `- Be helpful and step-by-step. Number your steps.
- Under 300 words. If you can't resolve it, suggest creating a task or escalating.
- Link to docs or specific settings when possible.`,

  creative: `- Write the actual content — don't describe what you'd write. Be the writer.
- Match the requested voice/tone. Explore 2-3 angles if the brief is open.
- Under 500 words for a first draft. Offer to iterate.`,

  task_mgmt: `- Be action-oriented. Confirm what you did, then suggest next steps.
- Under 150 words. Use tool calls to actually create/update tasks, don't just describe the action.`,

  build: `- Ship implementation-ready code. Use code blocks and structured artifacts.
- Explain key decisions briefly (1-2 lines), not the entire reasoning chain.
- Under 800 words. Emit artifacts the app can preview or apply.
- When given a task, DO IT — generate the code, don't describe what you would do.`,

  debug: `- Lead with root cause, not symptoms. Structure: root cause > fix > verification.
- Under 600 words. Include a code fix when possible.
- Be explicit about what's known vs inferred vs needs verification.`,

  review: `- Lead with findings ranked by severity: critical > high > medium > low.
- Be constructive. Each finding should have: what's wrong, why it matters, how to fix.
- Under 600 words. Use bullet lists for findings.`,

  architect: `- Lead with tradeoffs, then recommendation. Structure: options > analysis > pick.
- Under 800 words. Include diagrams (ASCII or markdown) when they help.
- Consider integration boundaries, failure modes, and scaling implications.`,

  design: `- Describe the visual approach: layout, colors, typography, spacing.
- Under 500 words. Emit HTML/CSS artifacts when practical.
- Reference real tools (Figma, Tailwind). Explain aesthetic reasoning.`,

  research: `- Go deep. Cover the landscape, compare options, cite specific tools/projects.
- Up to 1000 words. Use tables for comparisons. End with a clear recommendation.
- Distinguish facts from opinions. Link sources when available.`,

  browser: `- Describe the plan before executing: what pages, what actions, what to extract.
- Under 200 words for the plan. Use tool calls to execute.
- Be procedural and precise about selectors and actions.`,
};

function getResponseDirective(intent: ResponseIntent = 'question'): string {
  const directive = RESPONSE_DIRECTIVES[intent] || RESPONSE_DIRECTIVES.question;
  return `${directive}
- Use code blocks for code. Use bold for key terms. Use tables for comparisons.
- Match the user's energy without losing your composure. Be action-oriented.`;
}

function buildSystemPrompt(
  context: SwanBotContext,
  data: CircleContextData,
  responseIntent: ResponseIntent = 'question',
): string {
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
${getResponseDirective(responseIntent)}
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

function isModelStatusQuestion(message: string): boolean {
  const normalized = message.trim().toLowerCase().replace(/\s+/g, ' ');
  return [
    /^(what|which|wht) model (are you|r u|is this|is it|are u) (using|on|running)( to respond( with)?)?\s*[?!]?$/,
    /^(what|which|wht) model are you using to respond( with)?\s*[?!]?$/,
    /^(what|which|wht) model is this\s*[?!]?$/,
    /^(what|which|wht) model are you on\s*[?!]?$/,
    /^what model\s*[?!]?$/,
  ].some((pattern) => pattern.test(normalized));
}

function buildModelStatusResponse(ctx: SwanBotContext): string {
  const selectedModel = (ctx.model || '').trim();
  if (!selectedModel || selectedModel === 'auto') {
    return 'You are on **Auto** right now, so the effective model is chosen at send time based on the request.';
  }
  return `Right now I’m set to **${selectedModel}**.`;
}

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
  if (isModelStatusQuestion(cleaned)) {
    const response = buildModelStatusResponse(context);
    if (context.circleId) addToHistory(context.circleId, 'model', response);
    return response;
  }
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

  // Adaptive context: only load heavy knowledge/memory for non-trivial messages
  const { analyzeMessageRouting } = await import('./messageRouting');
  const { route: msgRoute } = analyzeMessageRouting(cleaned, 'main_chat');
  const { resolveModelForSoul } = await import('./serviceProfileSouls');
  // Build-state markers let the resolver pick a latency-appropriate model:
  // exploring -> Haiku (fast clarifying questions), converging -> Opus
  // (reasoning to propose a brief). Without these hints the router would
  // send "build" intent to Sonnet and every discovery turn would feel slow.
  const buildConverging = (context as any).buildConverging === true;
  const buildStateCtx = (context as any).buildState as
    | import('./conversationalBuild').BuildConversationState
    | undefined;
  const buildExploring = buildStateCtx === 'exploring';
  const effectiveModel = resolveModelForSoul(
    spiritId,
    context.model,
    msgRoute.intent,
    msgRoute.complexity,
    buildConverging,
    buildExploring,
  );
  // During a conversational build, the SYSTEM DIRECTIVE is the behavior —
  // the LLM does NOT need wiki bundles, memory lookups, or personality
  // context to ask "who's the audience?". Skipping those saves ~1-2s of
  // DB round-trips per turn, which is the biggest latency knob we have.
  const buildInProgress = buildExploring || buildConverging;
  const needsKnowledge = !buildInProgress
    && msgRoute.complexity !== 'trivial'
    && msgRoute.complexity !== 'simple';
  const knowledgeBundle = needsKnowledge
    ? (context.wikiContext || await buildCombinedKnowledgeBundle(cleaned, context.circleId, spiritId))
    : '';
  const memoryStores = !buildInProgress && msgRoute.complexity !== 'trivial' && context.circleId
    ? (context.memoryStores || await import('./openswanMemoryStores').then(({ buildOpenSwanMemoryStores }) => buildOpenSwanMemoryStores({
        circleId: context.circleId,
        userId: context.userId,
        query: cleaned,
        agentId: context.agentId,
        agentName: context.agentName,
        spiritId,
        surface: 'main_chat',
        limit: 8,
      })))
    : null;
  const memoryBundle = [
    memoryStores?.combined || context.memoryContext || '',
    context.sessionArchiveContext || '',
  ].filter(Boolean).join('\n\n');
  // When the ChatTab tells us a build conversation is active, compute the
  // orchestrator protocol and ship it separately as a high-priority
  // `systemDirective`. DO NOT stuff it into wikiContext — the edge function
  // frames wikiContext as "reference knowledge" which the model ignores.
  // systemDirective is prepended to the frozen system prompt with
  // <DIRECTIVE> tags so the model treats it as a behavior rule.
  const buildState = (context as any).buildState as
    | import('./conversationalBuild').BuildConversationState
    | undefined;
  let buildDirective = '';
  if (buildState && buildState !== 'idle') {
    const { buildSystemAddendum } = await import('./conversationalBuild');
    buildDirective = buildSystemAddendum(buildState);
  }

  const enrichedContext: SwanBotContext = {
    ...context,
    model: effectiveModel,
    wikiContext: knowledgeBundle,
    memoryContext: memoryBundle,
    memoryStores: memoryStores || undefined,
    spiritId,
  };
  if (buildDirective) {
    (enrichedContext as any).systemDirective = buildDirective;
  }

  // Latency knobs for build conversations:
  //
  // * Exploring (asking ONE clarifying question): thinkingLevel='fast'
  //   (no extended thinking, 1024 max_tokens). Clarifying questions are
  //   2-3 sentences — no point burning budget on reasoning.
  // * Converging (proposing a concrete brief): thinkingLevel='balanced'
  //   (medium effort, 8192 max_tokens). The bot needs headroom to reason
  //   about shape and emit the <BUILD_READY> marker, but not full deep
  //   thinking — the brief is a single paragraph, not an essay.
  // * Conversation-history trim: during builds, only send the last 6
  //   turns instead of the full ~30. The directive + a few recent turns
  //   are all the model needs; more is just token bloat.
  if (buildExploring) {
    enrichedContext.thinkingLevel = 'fast';
    enrichedContext.maxTokens = 1024;
  } else if (buildConverging) {
    enrichedContext.thinkingLevel = 'balanced';
    enrichedContext.maxTokens = 4096;
  }
  if (buildInProgress && Array.isArray(enrichedContext.conversationMessages)) {
    enrichedContext.conversationMessages = enrichedContext.conversationMessages.slice(-6);
  }

  // Tier 1: Try BlackSwan LLM (local, zero cost — only works when ollama is running)
  try {
    const { isBlackSwanAvailable, callBlackSwan } = await import('./blackswanLLM');
    if (await isBlackSwanAvailable()) {
      console.log('[SwanBot] Tier 1: BlackSwan LLM available, calling...');
      const circleData = await getCircleContextData(enrichedContext);
      const systemPrompt = await buildSystemPromptAsync(enrichedContext, circleData, cleaned);
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
  if (customModelProvider && !shouldBlockExternalAiProvider(customModelProvider)) {
    try {
      const circleData = await getCircleContextData(enrichedContext);
      const systemPrompt = await buildSystemPromptAsync(enrichedContext, circleData, cleaned);
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
  if (enrichedContext.circleId && !shouldBlockExternalAiProvider('anthropic')) {
    console.log('[SwanBot] Tier 2: Calling swanbot-ai edge function...');
    const aiResponse = await callSwanBotAI(
      cleaned,
      enrichedContext.circleId,
      enrichedContext.userId,
      enrichedContext.discordContext,
      enrichedContext.model,
      enrichedContext.wikiContext,
      enrichedContext.conversationMessages,
      enrichedContext.thinkingLevel || 'deep',
      enrichedContext.maxTokens || 6144,
      (enrichedContext as any).systemDirective,
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
    if (shouldBlockExternalAiProvider('gemini')) {
      throw new Error(getStrictLocalAiModeMessage('gemini'));
    }
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
  if (isStrictLocalAiModeEnabled()) {
    const response = getStrictLocalAiModeMessage('external providers');
    if (enrichedContext.circleId) addToHistory(enrichedContext.circleId, 'model', response);
    return response;
  }
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
  if (isStrictLocalAiModeEnabled() && shouldBlockExternalAiProvider('anthropic')) {
    return { response: getStrictLocalAiModeMessage('anthropic') };
  }

  const spiritId = await resolveContextSpiritId(context);

  // Adaptive context for structured path — same logic as simple path
  const { analyzeMessageRouting } = await import('./messageRouting');
  const { route: structuredRoute } = analyzeMessageRouting(cleaned, 'main_chat');
  const { resolveModelForSoul } = await import('./serviceProfileSouls');
  const effectiveModel = resolveModelForSoul(spiritId, context.model, structuredRoute.intent);
  const needsKnowledgeStructured = structuredRoute.complexity !== 'trivial' && structuredRoute.complexity !== 'simple';
  const knowledgeBundle = needsKnowledgeStructured
    ? (context.wikiContext || await buildCombinedKnowledgeBundle(cleaned, context.circleId, spiritId))
    : '';
  const memoryStores = structuredRoute.complexity !== 'trivial' && context.circleId
    ? (context.memoryStores || await import('./openswanMemoryStores').then(({ buildOpenSwanMemoryStores }) => buildOpenSwanMemoryStores({
        circleId: context.circleId,
        userId: context.userId,
        query: cleaned,
        agentId: context.agentId,
        agentName: context.agentName,
        spiritId,
        surface: 'main_chat',
        limit: 8,
      })))
    : null;
  const memoryBundle = [
    memoryStores?.combined || context.memoryContext || '',
    context.sessionArchiveContext || '',
  ].filter(Boolean).join('\n\n');
  const enrichedContext: SwanBotContext = {
    ...context,
    model: effectiveModel,
    wikiContext: knowledgeBundle,
    memoryContext: memoryBundle,
    memoryStores: memoryStores || undefined,
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
        enrichedContext.conversationMessages,
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
  if (shouldBlockExternalAiProvider('anthropic')) {
    return { response: getStrictLocalAiModeMessage('anthropic'), toolEvents: [] };
  }
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
    // Call supabase edge fn or direct API. Refresh the JWT per-round so long
    // tool-use loops don't starve across an expiry boundary.
    const accessToken = await getFreshAccessToken();
    const { data, error } = await supabase.functions.invoke('swanbot-ai', {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
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

    if (toolUseBlocks.length === 0 || data.stop_reason !== 'tool_use') {
      // Model gave a final text response (or stop_reason isn't tool_use)
      const textParts = Array.isArray(content)
        ? content.filter((b: any) => b.type === 'text').map((b: any) => b.text)
        : [];
      return {
        response: textParts.join('') || data.response || '',
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

  // Exhausted tool rounds — return whatever text we accumulated
  const lastAssistant = messages.filter(m => m.role === 'assistant').pop();
  const lastText = Array.isArray(lastAssistant?.content)
    ? lastAssistant.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')
    : '';
  return { response: lastText || 'Tool-use limit reached.', toolEvents };
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
  sessionArchiveContext?: string;
  modeKey?: OpenSwanChatMode | string | null;
  taskKind?: string | null;
  sessionProfile?: string | null;
  resolvedSkills?: OpenSwanResolvedSkill[];
  resolvedSkillsPromptBlock?: string | null;
}): Promise<string> {
  const context: SwanBotContext = {
    userId: opts.userId,
    circleId: opts.circleId,
    userName: opts.userName,
    agentId: opts.agentId,
    agentName: opts.agentName,
    model: opts.model,
    chatHistory: opts.chatHistory,
    sessionArchiveContext: opts.sessionArchiveContext,
    modeKey: opts.modeKey,
    taskKind: opts.taskKind,
    sessionProfile: opts.sessionProfile,
    resolvedSkills: opts.resolvedSkills,
    resolvedSkillsPromptBlock: opts.resolvedSkillsPromptBlock,
  };
  const circleData = opts.circleId
    ? await getCircleContextData(context)
    : { members: [], todayCheckIns: [], recentMessages: [], stats: null, userProfile: null };
  return buildSystemPromptAsync(context, circleData, opts.currentMessage);
}
