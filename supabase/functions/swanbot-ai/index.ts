// SwanBot AI — Supabase Edge Function
// Gathers circle context, sends to OpenAI, returns intelligent response

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
}

// ─── Context Gathering ───────────────────────────────────────────────────────

async function gatherCircleContext(supabase: any, circleId: string, userId: string) {
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
  };
}

// ─── Build System Prompt ─────────────────────────────────────────────────────

function buildSystemPrompt(ctx: any) {
  const now = new Date();
  const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "America/New_York" });
  const dateStr = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "America/New_York" });

  let prompt = `You are SwanBot 🦢 — an AI accountability partner embedded in "The Underground Circle," a productivity and accountability app. You live inside circle group chats.

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
      const sender = m.is_bot ? "SwanBot" : (m.user?.display_name || m.user?.username || "Unknown");
      return `[${sender}]: ${m.content.slice(0, 200)}`;
    }).join("\n")}`;
  }

  prompt += `\n\n## Instructions
- You have FULL context of this circle. Use it intelligently — reference real names, real numbers, real situations.
- If someone asks about the circle, give real data. If you don't have it, say "I don't have that right now" — no guessing.
- If asked to create a task, direct them to the task board (you can't create tasks directly in this mode).
- Keep responses under 300 words unless the user explicitly asks for more detail.
- Always prefix your response with 🦢 (don't say "SwanBot:" — the UI handles that).
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

// ─── Call OpenAI ──────────────────────────────────────────────────────────────

async function callOpenAI(systemPrompt: string, userMessage: string): Promise<string> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not set");
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      temperature: 0.7,
      max_tokens: 500,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI API error: ${response.status} — ${err}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || "Something went wrong. Try again.";
}

// ─── Main Handler ────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { message, circleId, userId }: RequestBody = await req.json();

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

    // Gather full circle context
    const context = await gatherCircleContext(supabase, circleId, userId);

    // Build the system prompt with all context
    const systemPrompt = buildSystemPrompt(context);

    // Call OpenAI
    const aiResponse = await callOpenAI(systemPrompt, message);

    return new Response(
      JSON.stringify({ response: aiResponse }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("SwanBot AI error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
