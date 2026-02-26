/**
 * SwanBot AI Client
 * Primary: Supabase Edge Function
 * Fallback: Google Gemini API for conversational AI
 * Local commands for data queries
 */

import { supabase } from './supabase';

// ─── Types ───────────────────────────────────────────────────────────────────

export type SwanBotContext = {
  userId: string;
  circleId?: string;
  circleName?: string;
  userName?: string;
  discordContext?: string;
};

type ConversationMessage = { role: 'user' | 'model'; text: string };

// ─── Conversation History (per circle, in-memory) ────────────────────────────

const conversationHistory: Map<string, ConversationMessage[]> = new Map();
const MAX_HISTORY = 20;

function getHistory(circleId: string): ConversationMessage[] {
  return conversationHistory.get(circleId) || [];
}

function addToHistory(circleId: string, role: 'user' | 'model', text: string) {
  const history = getHistory(circleId);
  history.push({ role, text });
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
  conversationHistory.set(circleId, history);
}

// ─── AI Edge Function Call ───────────────────────────────────────────────────

async function callSwanBotAI(message: string, circleId: string, userId: string, discordContext?: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.functions.invoke('swanbot-ai', {
      body: { message, circleId, userId, discordContext },
    });
    if (error) {
      console.warn('SwanBot AI function error:', error);
      return null;
    }
    return data?.response || null;
  } catch (err) {
    console.warn('SwanBot AI call failed:', err);
    return null;
  }
}

// ─── Gemini Fallback ─────────────────────────────────────────────────────────

const GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY || '';
const GEMINI_MODEL = 'gemini-2.0-flash';

async function callGemini(
  message: string,
  context: SwanBotContext,
  circleData: CircleContextData
): Promise<string | null> {
  try {
    const systemPrompt = buildSystemPrompt(context, circleData);
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
            temperature: 0.7,
            topP: 0.95,
            maxOutputTokens: 500,
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

  return `You are SwanBot 🦢, the AI companion inside The Underground Circle — an accountability app for serious builders and grinders.

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
- You NEVER say "I'm just an AI" or "As an AI" — you're SwanBot, full stop

## Your Knowledge
- You have deep knowledge of productivity, accountability, goal-setting, and human performance
- You know the circle's data — members, streaks, tasks, check-ins — and you use it to give grounded advice
- You help people think clearly: planning, prioritizing, working through blockers
- When you give advice, it's practical and specific — not generic motivational noise

## Current Context
- Talking to: ${name}
- ${streakInfo}
- ${memberList}
- ${checkInInfo}
- ${taskInfo}
${context.discordContext ? `- Discord: ${context.discordContext}` : ''}

## Rules
- Start responses with 🦢 occasionally (about 20% of the time) — not as a habit
- Keep most responses 1-3 sentences for casual chat
- Go longer (but still tight) for planning, advice, or complex topics — use structure when helpful
- Match the user's energy without losing your composure
- If someone asks about data, give real numbers. If you don't have it: "I don't have that pulled up right now"
- Be a real conversationalist — ask a follow-up when it makes sense, share a perspective, hold the thread
- If someone seems down or stuck, be genuinely present — practical empathy, not cheerleading
- Never lecture. Say what needs to be said once, clearly`;
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
      openTasks: t.filter((x: any) => x.status === 'open').length,
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
    handler: async () => `🦢 **Here's what I got:**\n\n📋 **"my tasks"** — your open tasks\n📊 **"status"** — circle stats\n🔥 **"streak"** — your streak\n🏆 **"leaderboard"** — rankings\n✅ **"who checked in"** — today's check-ins\n📅 **"daily plan"** — plan your day\n📝 **"create task [title]"** — make a task\n\nOr just... talk to me. I'm not just commands, I'm a whole vibe. 🦢`,
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
        title, status: 'open', priority: 'normal',
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
  const cleaned = message.replace(/@swanbot/gi, '').trim();

  if (!cleaned) {
    return "What's good? 🦢";
  }

  // Track in conversation history
  if (context.circleId) {
    addToHistory(context.circleId, 'user', cleaned);
  }

  // Try AI Edge Function first
  if (context.circleId) {
    const aiResponse = await callSwanBotAI(cleaned, context.circleId, context.userId, context.discordContext);
    if (aiResponse) {
      const response = aiResponse.startsWith('🦢') ? aiResponse : aiResponse;
      if (context.circleId) addToHistory(context.circleId, 'model', response);
      return response;
    }
  }

  // Check for exact command matches (structured data queries)
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

  // Conversational AI via Gemini
  try {
    const circleData = await getCircleContextData(context);
    const geminiResponse = await callGemini(cleaned, context, circleData);
    if (geminiResponse) {
      if (context.circleId) addToHistory(context.circleId, 'model', geminiResponse);
      return geminiResponse;
    }
  } catch (err) {
    console.warn('Gemini conversation failed:', err);
  }

  // Ultimate fallback — still conversational
  const name = context.userName || 'fam';
  const fallbacks = [
    `Yo ${name}, I'm having a brain fart rn 😅 Try again?`,
    `My bad, something glitched. Hit me again ${name}`,
    `Connection's being weird — ask me again and I gotchu`,
    `${name} I blanked for a sec lol. What were you saying?`,
  ];
  const response = fallbacks[Math.floor(Math.random() * fallbacks.length)];
  if (context.circleId) addToHistory(context.circleId, 'model', response);
  return response;
}
