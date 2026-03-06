// BlackSwan AI — Supabase Edge Function
// Gathers circle context, sends to Claude, returns intelligent response

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── Types ───────────────────────────────────────────────────────────────────

interface RequestBody {
  message: string;
  circleId: string;
  userId: string;
  model?: string | null; // 'blackswan' | 'claude-haiku' | 'claude-sonnet' | 'claude-opus' | null (auto)
}

// ─── Context Gathering ───────────────────────────────────────────────────────

async function gatherCircleContext(supabase: any, circleId: string, userId: string, userMessage?: string) {
  // Get circle info
  const { data: circle } = await supabase
    .from("circles")
    .select("name, description")
    .eq("id", circleId)
    .single();

  // Get members with profiles
  const { data: membersRaw } = await supabase
    .from("circle_members")
    .select("role, user:profiles(id, username, display_name, current_streak, longest_streak, bio)")
    .eq("circle_id", circleId);

  const members = (membersRaw || []).map((m: any) => ({
    ...m.user,
    role: m.role,
  }));

  // Get current user profile
  const currentUser = members.find((m: any) => m.id === userId);

  // Get recent messages (last 30)
  const { data: recentMessages } = await supabase
    .from("messages")
    .select("content, is_bot, created_at, user:profiles(display_name, username)")
    .eq("circle_id", circleId)
    .order("created_at", { ascending: false })
    .limit(30);

  // Get today's check-ins
  const today = new Date().toISOString().split("T")[0];
  const { data: todayCheckIns } = await supabase
    .from("check_ins")
    .select("content, created_at, user:profiles(display_name, username)")
    .eq("circle_id", circleId)
    .gte("created_at", today);

  // Get open tasks
  const { data: openTasks } = await supabase
    .from("tasks")
    .select("title, description, status, priority, due_date, assignee:profiles!tasks_assigned_to_fkey(display_name, username), creator:profiles!tasks_created_by_fkey(display_name, username)")
    .eq("circle_id", circleId)
    .neq("status", "done")
    .order("created_at", { ascending: false })
    .limit(20);

  // Get user's tasks specifically
  const { data: userTasks } = await supabase
    .from("tasks")
    .select("title, status, priority, due_date")
    .eq("circle_id", circleId)
    .or(`assigned_to.eq.${userId},created_by.eq.${userId}`)
    .neq("status", "done")
    .limit(10);

  // Get recent completed tasks (last 7 days)
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const { data: completedTasks } = await supabase
    .from("tasks")
    .select("title, completed_at, assignee:profiles!tasks_assigned_to_fkey(display_name)")
    .eq("circle_id", circleId)
    .eq("status", "done")
    .gte("completed_at", weekAgo.toISOString())
    .limit(10);

  // Who hasn't checked in today
  const checkedInIds = new Set((todayCheckIns || []).map((c: any) => c.user?.username));
  const notCheckedIn = members.filter((m: any) => !checkedInIds.has(m.username));

  // Get user XP & level
  const { data: userXp } = await supabase
    .from("user_xp")
    .select("total_xp, level, title, grind_karma, social_karma")
    .eq("user_id", userId)
    .single();

  // Get member XP for leaderboard context
  const memberIds = members.map((m: any) => m.id).filter(Boolean);
  const { data: memberXp } = memberIds.length > 0
    ? await supabase.from("user_xp").select("user_id, total_xp, level, title").in("user_id", memberIds)
    : { data: [] };

  // Get user's recent achievements
  const { data: userAchievements } = await supabase
    .from("user_achievements")
    .select("unlocked_at, achievement:achievements(name, description, icon, xp_reward)")
    .eq("user_id", userId)
    .order("unlocked_at", { ascending: false })
    .limit(5);

  // Get active challenges
  const { data: activeChallenges } = await supabase
    .from("challenges")
    .select("title, description, challenge_type, target_value, start_date, end_date, xp_reward, status")
    .eq("circle_id", circleId)
    .eq("status", "active")
    .limit(5);

  // Get user's goals / north star
  const { data: userGoals } = await supabase
    .from("north_star_entries")
    .select("content, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(3);

  // Get recent agent activity in the circle
  const { data: agentActivity } = await supabase
    .from("agent_activity")
    .select("agent_name, activity_type, title, body, created_at")
    .eq("circle_id", circleId)
    .order("created_at", { ascending: false })
    .limit(10);

  // Load relevant past knowledge for this conversation
  let knowledgeEntries: any[] = [];
  try {
    const { data: knowledge } = await supabase.rpc("get_relevant_knowledge", {
      p_circle_id: circleId,
      p_message: userMessage || "",
      p_limit: 5,
    });
    knowledgeEntries = knowledge || [];
  } catch {
    // Knowledge table may not exist yet — gracefully skip
  }

  return {
    circle,
    members,
    currentUser,
    recentMessages: (recentMessages || []).reverse(),
    todayCheckIns: todayCheckIns || [],
    openTasks: openTasks || [],
    userTasks: userTasks || [],
    completedTasks: completedTasks || [],
    notCheckedIn,
    memberCount: members.length,
    checkedInCount: (todayCheckIns || []).length,
    userXp: userXp || null,
    memberXp: memberXp || [],
    userAchievements: userAchievements || [],
    activeChallenges: activeChallenges || [],
    userGoals: userGoals || [],
    agentActivity: agentActivity || [],
    knowledgeEntries,
  };
}

// ─── Build System Prompt ─────────────────────────────────────────────────────

function buildSystemPrompt(ctx: any) {
  const now = new Date();
  const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "America/New_York" });
  const dateStr = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "America/New_York" });

  let prompt = `You are BlackSwan 🦢 — an AI accountability partner embedded in "The Underground Circle," a productivity and accountability app. You live inside circle group chats.

## Your Personality
- You carry yourself with quiet confidence — knowledgeable but never arrogant
- Professional without being stiff. You sound like a trusted advisor who's also a real person
- Thoughtful and measured. What you say lands because you mean it
- You have a dry, sharp wit — funny when it fits, never trying too hard
- Direct. No fluff, no corporate speak, no filler phrases
- You give real feedback — if someone is slacking, you say so plainly and with respect
- You genuinely care about the people here. Support feels earned, not scripted
- You're not a know-it-all. When you don't have the data, say so cleanly
- Use bold (**text**) for structure and emphasis
- Use emojis very sparingly — only when they actually add something (🦢 🔥 ✅)
- Keep responses tight — concise for casual chat, structured and thorough for real guidance

## Expanded Knowledge
- Design & UI/UX: You understand layout, color theory, typography, component patterns, responsive design, design systems. You can critique interfaces, suggest improvements, and reference real tools (Figma, Framer, Tailwind).
- Art & Creative: Visual storytelling, brand identity, aesthetic critique, creative direction, color palettes, illustration guidance. You appreciate craft.
- Code & Technical: Architecture patterns, debugging, code review, performance, testing strategy. You know React, Node, Python, Supabase, TypeScript, and modern stacks deeply.
- General Knowledge: Science, history, philosophy, business strategy, psychology, culture. You weave it in when relevant, never to show off.

## Current Time
${dateStr} at ${timeStr} ET

## Circle Info
Name: ${ctx.circle?.name || "Unknown"}
Description: ${ctx.circle?.description || "None"}
Members: ${ctx.memberCount}
Checked in today: ${ctx.checkedInCount}/${ctx.memberCount}

## Members
${ctx.members.map((m: any) => `- ${m.display_name || m.username} (${m.role || "member"}) — ${m.current_streak || 0} day streak, longest: ${m.longest_streak || 0}`).join("\n")}

## Current User
Name: ${ctx.currentUser?.display_name || ctx.currentUser?.username || "Unknown"}
Streak: ${ctx.currentUser?.current_streak || 0} days
Longest streak: ${ctx.currentUser?.longest_streak || 0} days
Bio: ${ctx.currentUser?.bio || "None set"}`;

  // XP & Level
  if (ctx.userXp) {
    prompt += `\nXP: ${ctx.userXp.total_xp || 0} | Level ${ctx.userXp.level || 1} "${ctx.userXp.title || "Newcomer"}"`;
    prompt += `\nGrind Karma: ${ctx.userXp.grind_karma || 0} | Social Karma: ${ctx.userXp.social_karma || 0}`;
  }

  // Member XP leaderboard
  if (ctx.memberXp && ctx.memberXp.length > 0) {
    const xpMap = new Map(ctx.memberXp.map((x: any) => [x.user_id, x]));
    const ranked = ctx.members
      .map((m: any) => ({ name: m.display_name || m.username, ...(xpMap.get(m.id) || { total_xp: 0, level: 1 }) }))
      .sort((a: any, b: any) => (b.total_xp || 0) - (a.total_xp || 0));
    prompt += `\n\n## XP Leaderboard\n${ranked.map((r: any, i: number) => `${i + 1}. ${r.name} — ${r.total_xp || 0} XP (Lv${r.level || 1})`).join("\n")}`;
  }

  // Recent achievements
  if (ctx.userAchievements && ctx.userAchievements.length > 0) {
    prompt += `\n\n## User's Recent Achievements\n${ctx.userAchievements.map((a: any) => `- ${a.achievement?.icon || "🏅"} ${a.achievement?.name} — ${a.achievement?.description || ""} (+${a.achievement?.xp_reward || 0} XP)`).join("\n")}`;
  }

  // Active challenges
  if (ctx.activeChallenges && ctx.activeChallenges.length > 0) {
    prompt += `\n\n## Active Challenges\n${ctx.activeChallenges.map((c: any) => `- ${c.title} (${c.challenge_type}) — target: ${c.target_value}, ends ${c.end_date || "TBD"}, reward: ${c.xp_reward || 0} XP`).join("\n")}`;
  }

  // User goals
  if (ctx.userGoals && ctx.userGoals.length > 0) {
    prompt += `\n\n## User's Goals / North Star\n${ctx.userGoals.map((g: any) => `- "${g.content}"`).join("\n")}`;
  }

  // Recent agent activity
  if (ctx.agentActivity && ctx.agentActivity.length > 0) {
    prompt += `\n\n## Recent Agent Activity\n${ctx.agentActivity.slice(0, 5).map((a: any) => `- [${a.agent_name}] ${a.activity_type}: ${a.title || a.body?.slice(0, 80) || ""}`).join("\n")}`;
  }

  // Learned knowledge from past conversations
  if (ctx.knowledgeEntries && ctx.knowledgeEntries.length > 0) {
    prompt += `\n\n## Learned Knowledge (from past conversations)
Use these past exchanges to inform your tone, approach, and answers. If a similar question was asked before, build on your previous response rather than starting from scratch.
${ctx.knowledgeEntries.map((k: any) => {
      const summary = k.summary || k.user_message?.slice(0, 100);
      const response = k.bot_response?.slice(0, 150);
      return `- [${k.category}] User asked: "${summary}" → You responded: "${response}..."`;
    }).join("\n")}`;
  }

  if (ctx.notCheckedIn.length > 0) {
    prompt += `\n\n## Haven't Checked In Today\n${ctx.notCheckedIn.map((m: any) => `- ${m.display_name || m.username}`).join("\n")}`;
  }

  if (ctx.todayCheckIns.length > 0) {
    prompt += `\n\n## Today's Check-ins\n${ctx.todayCheckIns.map((c: any) => `- ${c.user?.display_name || c.user?.username}: "${c.content}"`).join("\n")}`;
  }

  if (ctx.userTasks.length > 0) {
    prompt += `\n\n## User's Open Tasks\n${ctx.userTasks.map((t: any) => `- [${t.status}] [${t.priority}] ${t.title}${t.due_date ? ` (due ${t.due_date})` : ""}`).join("\n")}`;
  }

  if (ctx.openTasks.length > 0) {
    prompt += `\n\n## Circle's Open Tasks (${ctx.openTasks.length})\n${ctx.openTasks.slice(0, 10).map((t: any) => `- [${t.priority}] ${t.title} → ${t.assignee?.display_name || "Unassigned"} (${t.status})`).join("\n")}`;
  }

  if (ctx.completedTasks.length > 0) {
    prompt += `\n\n## Recently Completed (past 7 days)\n${ctx.completedTasks.map((t: any) => `- ✅ ${t.title} by ${t.assignee?.display_name || "someone"}`).join("\n")}`;
  }

  if (ctx.recentMessages.length > 0) {
    prompt += `\n\n## Recent Chat Messages (for context)\n${ctx.recentMessages.slice(-15).map((m: any) => {
      const sender = m.is_bot ? "BlackSwan" : (m.user?.display_name || m.user?.username || "Unknown");
      return `[${sender}]: ${m.content.slice(0, 200)}`;
    }).join("\n")}`;
  }

  prompt += `\n\n## Instructions
- You have FULL context of this circle. Use it intelligently — reference real names, real numbers, real situations.
- If someone asks about the circle, give real data. If you don't have it, say "I don't have that right now" — no guessing.
- If asked to create a task, direct them to the task board (you can't create tasks directly in this mode).
- Keep responses under 300 words unless the user explicitly asks for more detail.
- Always prefix your response with 🦢 (don't say "BlackSwan:" — the UI handles that).
- When calling out missed check-ins, be specific: name the people, don't generalize.
- Acknowledge wins with weight, not hype. A short "That's a real streak. Don't break it." lands harder than five fire emojis.
- When someone seems stuck or down, be present and practical — not a cheerleader.

## Games & Social Features
You can run interactive games and social features in chat. Be creative and engaging.

**Games you support:**
- **Trivia** — Ask a question with 4 options (A/B/C/D). Use topics like business, tech, history, science, pop culture. End with "Drop your answer below ⬇️"
- **Would You Rather** — Give two tough choices. Make them relevant to hustle/grind culture when possible. End with "🅰️ or 🅱️?"
- **Hot Takes** — Present a spicy/controversial opinion about work, tech, or life. Ask the circle to agree or disagree. Use "🔥 HOT TAKE:" format.
- **Two Truths & a Lie** — Present 3 statements about a topic (or make them up about a hypothetical person). Ask which is the lie.
- **Rate My Day** — Ask the user to rate their day 1-10 and give them feedback based on their answer and their actual data (streak, tasks done).
- **Word Association / This or That** — Quick-fire rounds. Present pairs or words, ask for fast responses.
- **Roast Battle** — Roast specific circle members by name using their actual streak and task data. Be funny, not mean.

**Challenges & Competitions:**
- **Challenge a Member** — Pick two members (or let them choose) and set up a 1v1: who completes more tasks this week, who checks in more consistently, etc.
- **Speed Task** — Suggest a quick task everyone can race to finish. First to check in with proof wins.
- **Daily Dare** — Give the circle a fun but productive dare.
- **Bet on It** — Help members set friendly stakes on tasks/goals.

**Connect & Social:**
- **Link Discord** — Tell them: "Drop your Discord server invite link in the chat and I'll remember it for the circle! Your crew can stay connected across platforms. 🔗" (You're acknowledging it, the app will add Discord integration soon.)
- **Icebreaker** — Ask a fun get-to-know-you question tailored to a grind/hustle community.
- **Shoutout** — If they mention a member name, give that person a personalized shoutout based on their actual stats.
- **Poll** — Format a quick poll with emoji voting options. Use 1️⃣ 2️⃣ 3️⃣ format.
- **Confession** — Acknowledge it playfully: "Alright, the circle is listening... 👀" and respond to whatever they confess.

**Motivation extras:**
- **Quote of the Day** — Share a real, powerful quote. Not generic stuff — pick from entrepreneurs, athletes, builders.
- **Pep Talk** — Personalized based on their streak, tasks, and recent activity.
- **MVP of the Week** — Look at who has the highest streak, most tasks done, most check-ins, and crown them.

**Key rule for games:** Always end with a call to action that gets people typing in the chat. The goal is ENGAGEMENT — make people want to respond.

## Crypto / Wallet Features
The app has built-in crypto wallets (MetaMask for ETH, Phantom for SOL). Users can send crypto from chat.

**When someone mentions sending crypto, tipping, bounties, or wallet:**
- **"send crypto"** or **"send ETH/SOL"** — Tell them to tap the 💸 Send Crypto button in the quick bar, or use the send panel. They can send to @usernames or wallet addresses.
- **"my wallet"** — Tell them their wallet status. If you see wallet data in their profile, share it. Otherwise tell them to connect one in the Wallet tab.
- **"tip @username"** — Encourage tipping! Tell them to use the 💸 Send button and enter the amount. Even 0.001 ETH counts.
- **"bounty"** — Help them set up a bounty: "Create a task, set the bounty amount, and whoever completes it gets paid. Use the send feature after they deliver."
- **"bet"** with crypto stakes — Help structure the bet with specific terms and amounts.
- Always be hyped about crypto moves. Money moving = accountability with real stakes. 🔥`;

  return prompt;
}

// ─── Call BlackSwan LLM (local/self-hosted, zero cost) ───────────────────────

async function callBlackSwanLLM(systemPrompt: string, userMessage: string): Promise<string | null> {
  const blackswanUrl = Deno.env.get("BLACKSWAN_API_URL");
  if (!blackswanUrl) return null;

  try {
    const response = await fetch(`${blackswanUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "blackswan",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        temperature: 0.7,
        max_tokens: 1024,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) return null;

    const data = await response.json();
    return data.choices?.[0]?.message?.content || null;
  } catch {
    return null;
  }
}

// ─── Call Claude ──────────────────────────────────────────────────────────────

// Map terminal model keys to Anthropic model IDs
const CLAUDE_MODEL_MAP: Record<string, string> = {
  "claude-haiku":  "claude-haiku-4-5-20251001",
  "claude-sonnet": "claude-sonnet-4-6",
  "claude-opus":   "claude-opus-4-6",
};

interface ClaudeResult {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

async function callClaude(systemPrompt: string, userMessage: string, modelKey?: string | null): Promise<ClaudeResult> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY not set");
  }

  const modelId = (modelKey && CLAUDE_MODEL_MAP[modelKey]) || CLAUDE_MODEL_MAP["claude-haiku"];

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: modelId,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [
        { role: "user", content: userMessage },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API error (${modelId}): ${response.status} — ${err}`);
  }

  const data = await response.json();
  const usage = data.usage || {};

  return {
    text: data.content?.[0]?.text || "Something went wrong. Try again.",
    model: modelId,
    inputTokens: usage.input_tokens || 0,
    outputTokens: usage.output_tokens || 0,
    cacheCreationTokens: usage.cache_creation_input_tokens || 0,
    cacheReadTokens: usage.cache_read_input_tokens || 0,
  };
}

// ─── Knowledge Storage ──────────────────────────────────────────────────

function categorizeMessage(message: string): string {
  const lower = message.toLowerCase();
  const patterns: [string, RegExp][] = [
    ["games",             /\b(trivia|game|play|quiz|would you rather|hot take|roast|bet)\b/],
    ["crypto",            /\b(crypto|eth|sol|wallet|send|tip|bounty|metamask|phantom|token)\b/],
    ["tasks",             /\b(task|todo|assign|deadline|due|priority|done|complete)\b/],
    ["accountability",    /\b(streak|check.?in|accountab|habit|goal|commit|discipline)\b/],
    ["coaching",          /\b(advice|help|stuck|motivat|how do i|should i|mentor|guide|improve)\b/],
    ["technical",         /\b(code|bug|error|api|database|react|typescript|deploy|server)\b/],
    ["creative",          /\b(design|art|brand|logo|color|font|ui|ux|layout|creative)\b/],
    ["circle_management", /\b(circle|member|invite|admin|role|kick|settings|manage)\b/],
    ["social",            /\b(hey|hello|what.?s up|how are|thanks|lol|haha|chill|vibe)\b/],
    ["onboarding",        /\b(new here|first time|how does|getting started|what is this)\b/],
    ["feedback",          /\b(feedback|suggest|feature|bug report|improve|issue)\b/],
  ];
  for (const [cat, regex] of patterns) {
    if (regex.test(lower)) return cat;
  }
  return "general";
}

async function storeKnowledgeEntry(
  supabase: any,
  circleId: string,
  userId: string,
  userName: string | null,
  userMessage: string,
  botResponse: string,
  modelUsed: string,
  tokensUsed: number,
  memberCount: number,
  userStreak: number,
  source: string = "webchat",
): Promise<void> {
  try {
    const category = categorizeMessage(userMessage);
    // Simple quality heuristic: longer, substantive responses score higher
    const responseLen = botResponse.length;
    let quality = 0.5;
    if (responseLen > 200) quality = 0.6;
    if (responseLen > 500) quality = 0.7;
    if (responseLen > 1000) quality = 0.8;
    // Penalize very short bot responses (likely errors or "I don't know")
    if (responseLen < 50) quality = 0.3;

    await supabase.from("blackswan_knowledge").insert({
      circle_id: circleId,
      user_id: userId,
      user_name: userName,
      user_message: userMessage,
      bot_response: botResponse,
      category,
      summary: userMessage.length > 100 ? userMessage.slice(0, 100) + "..." : userMessage,
      quality_score: quality,
      response_length: responseLen,
      member_count: memberCount,
      user_streak: userStreak,
      source,
      model_used: modelUsed,
      tokens_used: tokensUsed,
    });
  } catch (e) {
    // Non-critical — don't fail the response if knowledge storage fails
    console.warn("[swanbot-ai] Failed to store knowledge entry:", e);
  }
}

// ─── Main Handler ────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { message, circleId, userId, model }: RequestBody = await req.json();

    if (!message || !circleId || !userId) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: message, circleId, userId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create Supabase client with service role for full access
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Gather full circle context (includes relevant knowledge entries)
    const context = await gatherCircleContext(supabase, circleId, userId, message);

    // Build the system prompt with all context
    const systemPrompt = buildSystemPrompt(context);

    // Route based on requested model:
    // - null/auto/blackswan: try local BlackSwan LLM first, fall back to Claude Haiku
    // - claude-haiku/sonnet/opus: skip local, go straight to that Claude model
    let aiResponse: string | null = null;
    let tokenBreakdown = {
      model: "blackswan",
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_tokens: 0,
      cache_read_tokens: 0,
      total_tokens: 0,
    };
    const isClaudeModel = model && model.startsWith("claude-");

    if (!isClaudeModel) {
      // Try BlackSwan LLM first (zero cost)
      aiResponse = await callBlackSwanLLM(systemPrompt, message);
      if (aiResponse) {
        // Estimate tokens for BlackSwan (local, no real usage data)
        const est = Math.ceil((message.length + aiResponse.length) / 4);
        tokenBreakdown = {
          model: "blackswan",
          input_tokens: Math.ceil(message.length / 4),
          output_tokens: Math.ceil(aiResponse.length / 4),
          cache_creation_tokens: 0,
          cache_read_tokens: 0,
          total_tokens: est,
        };
      }
    }

    if (!aiResponse) {
      // Fall back to Claude (using requested model or default Haiku)
      const result = await callClaude(systemPrompt, message, isClaudeModel ? model : null);
      aiResponse = result.text;
      tokenBreakdown = {
        model: result.model,
        input_tokens: result.inputTokens,
        output_tokens: result.outputTokens,
        cache_creation_tokens: result.cacheCreationTokens,
        cache_read_tokens: result.cacheReadTokens,
        total_tokens: result.inputTokens + result.outputTokens,
      };
    }

    // Store this exchange in the knowledge base (fire-and-forget)
    storeKnowledgeEntry(
      supabase,
      circleId,
      userId,
      context.currentUser?.display_name || context.currentUser?.username || null,
      message,
      aiResponse,
      tokenBreakdown.model,
      tokenBreakdown.total_tokens,
      context.memberCount,
      context.currentUser?.current_streak || 0,
    ).catch(() => {}); // Swallow — never block the response

    return new Response(
      JSON.stringify({
        response: aiResponse,
        usage: tokenBreakdown,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("BlackSwan AI error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
