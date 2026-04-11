/**
 * SwanBot AI Client
 * Primary: Supabase Edge Function
 * Fallback: Google Gemini API for conversational AI
 * Local commands for data queries
 */

import { supabase } from './supabase';
import { buildWikiKnowledgeBundle, buildWikiSearchResponse } from './wikiData';

// ─── Types ───────────────────────────────────────────────────────────────────

export type SwanBotContext = {
  userId: string;
  circleId?: string;
  circleName?: string;
  userName?: string;
  discordContext?: string;
  model?: string | null;
  chatHistory?: string;
  wikiContext?: string;
};

export interface SwanBotStructuredToolAction {
  kind: 'hf_tool' | 'tool';
  tool_name: string;
  title: string;
  status: 'completed' | 'failed';
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

// ─── AI Edge Function Call ───────────────────────────────────────────────────

async function callSwanBotAI(
  message: string,
  circleId: string,
  userId: string,
  discordContext?: string,
  model?: string | null,
  wikiContext?: string,
): Promise<string | null> {
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
        model: model || 'claude-haiku',
        maxTokens: 4096,
        thinkingLevel: 'deep',
      },
    });
    if (error) {
      console.warn('[SwanBot] Edge function error:', error?.message || error);
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
        model: model || 'claude-haiku',
        maxTokens: 4096,
        thinkingLevel: 'deep',
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
      systemPrompt = dbPrompt?.content || await buildSystemPromptAsync(context, circleData);
    } catch {
      systemPrompt = await buildSystemPromptAsync(context, circleData);
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

async function buildSystemPromptAsync(context: SwanBotContext, data: CircleContextData): Promise<string> {
  const base = buildSystemPrompt(context, data);
  const extras: string[] = [];

  // Load user profile for personalization
  try {
    const { loadUserProfile, generateProfileContext } = await import('./userChatProfile');
    const profile = await loadUserProfile();
    const profileCtx = generateProfileContext(profile);
    if (profileCtx) extras.push(profileCtx);
  } catch (e) { console.warn('[SwanBot] Profile load failed:', e); }

  // Load memory hierarchy for this circle
  try {
    const { buildMemoryContext } = await import('./agentRunSystem');
    if (context.circleId) {
      const memCtx = await buildMemoryContext(context.circleId, undefined, context.userId);
      if (memCtx) extras.push(memCtx);
    }
  } catch (e) { console.warn('[SwanBot] Memory context failed:', e); }

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

  // Cap total extras to ~4000 chars to stay within context budget
  const MAX_EXTRAS_CHARS = 4000;
  let combined = extras.join('\n\n');
  if (combined.length > MAX_EXTRAS_CHARS) {
    combined = combined.slice(0, MAX_EXTRAS_CHARS);
    const lastBreak = combined.lastIndexOf('\n');
    if (lastBreak > MAX_EXTRAS_CHARS * 0.7) {
      combined = combined.slice(0, lastBreak);
    }
  }

  return base + '\n\n' + combined;
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
${context.wikiContext ? `\n## Internal AI Wiki Knowledge\nUse this as trusted internal reference knowledge from the app's AI Wiki. Prefer it when answering questions about AI agents, models, MCP, browser automation, retrieval, evals, multimodal tooling, safety, design-to-code, and related topics.\n${context.wikiContext}` : ''}
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
    handler: async () => `🦢 **Here's what I got:**\n\n📋 **"my tasks"** — your open tasks\n📊 **"status"** — circle stats\n🔥 **"streak"** — your streak\n🏆 **"leaderboard"** — rankings\n✅ **"who checked in"** — today's check-ins\n📅 **"daily plan"** — plan your day\n📝 **"create task [title]"** — make a task\n📚 **"/wiki [topic]"** — search the AI Wiki\n🔎 **"search wiki [topic]"** — same thing\n\nOr just... talk to me. I'm not just commands, I'm a whole vibe. 🦢`,
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

// ─── Main Response Engine ────────────────────────────────────────────────────

export async function getSwanBotResponse(
  message: string,
  context: SwanBotContext
): Promise<string> {
  const cleaned = message.replace(/@(agent|blackswan|swanbot|swan)\b/gi, '').trim();
  const enrichedContext: SwanBotContext = {
    ...context,
    wikiContext: context.wikiContext || buildWikiKnowledgeBundle(cleaned, 6),
  };

  if (!cleaned) {
    return "What's good? 🦢";
  }

  // Track in conversation history
  if (context.circleId) {
    addToHistory(context.circleId, 'user', cleaned);
  }

  // Check for exact command matches first (instant, structured data queries)
  for (const cmd of localCommands) {
    const match = cleaned.match(cmd.match);
    if (match) {
      try {
        const response = await cmd.handler(context, match);
        if (context.circleId) addToHistory(context.circleId, 'model', response);
        return response;
      } catch (err: any) {
        return `Something broke: ${err.message}`;
      }
    }
  }

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
  const enrichedContext: SwanBotContext = {
    ...context,
    wikiContext: context.wikiContext || buildWikiKnowledgeBundle(cleaned, 6),
  };

  if (!cleaned) {
    return { response: "What's good? 🦢" };
  }

  const structured = enrichedContext.circleId
    ? await callSwanBotAIStructured(
        cleaned,
        enrichedContext.circleId,
        enrichedContext.userId,
        enrichedContext.discordContext,
        enrichedContext.model,
        enrichedContext.wikiContext,
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
