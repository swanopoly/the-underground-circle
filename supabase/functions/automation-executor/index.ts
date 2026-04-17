// automation-executor — Supabase Edge Function
//
// Executes circle automations: gathers context, calls AI, routes output.
// Called by pg_cron (schedule), DB triggers (event), or frontend (manual).
//
// Deploy: npx supabase functions deploy automation-executor
// Secrets: ANTHROPIC_API_KEY (required)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";
import {
  errResponse,
  getAuthenticatedUser,
  isServiceRoleRequest,
  jsonResponse,
} from "../_shared/edge.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── Model routing ───────────────────────────────────────────────────────────

const CLAUDE_MODEL_MAP: Record<string, string> = {
  "claude-haiku":  "claude-haiku-4-5-20251001",
  "claude-sonnet": "claude-sonnet-4-6",
  "claude-opus":   "claude-opus-4-6",
};

interface AIResult {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
}

// Rough cost per 1M tokens (input, output)
const MODEL_COSTS: Record<string, [number, number]> = {
  "claude-haiku-4-5-20251001": [0.80, 4.00],
  "claude-sonnet-4-6":        [3.00, 15.00],
  "claude-opus-4-6":          [15.00, 75.00],
};

async function callClaude(systemPrompt: string, userMessage: string, modelKey: string): Promise<AIResult> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const modelId = CLAUDE_MODEL_MAP[modelKey] || CLAUDE_MODEL_MAP["claude-haiku"];

  // Retry with exponential backoff for transient errors (429, 503, network)
  const MAX_RETRIES = 3;
  const FALLBACK_MODELS = ["claude-haiku-4-5-20251001"]; // Fallback to cheaper model on persistent failure
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const useModel = attempt < MAX_RETRIES - 1 ? modelId : (FALLBACK_MODELS[0] || modelId);

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: useModel,
          max_tokens: 1024,
          system: systemPrompt,
          messages: [{ role: "user", content: userMessage }],
        }),
      });

      // Non-retryable errors: bad request, auth, not found
      if (res.status === 400 || res.status === 401 || res.status === 403 || res.status === 404) {
        const err = await res.text();
        throw new Error(`Anthropic API ${res.status}: ${err}`);
      }

      // Retryable errors: rate limit, server errors, overloaded
      if (!res.ok) {
        const err = await res.text();
        lastError = new Error(`Anthropic API ${res.status}: ${err}`);
        if (attempt < MAX_RETRIES - 1) {
          const backoffMs = Math.pow(2, attempt + 1) * 1000; // 2s, 4s
          await new Promise(r => setTimeout(r, backoffMs));
          continue;
        }
        throw lastError;
      }

      const data = await res.json();
      const usage = data.usage || {};
      const inputTokens = usage.input_tokens || 0;
      const outputTokens = usage.output_tokens || 0;
      const costs = MODEL_COSTS[useModel] || [0.80, 4.00];
      const estimatedCost = (inputTokens * costs[0] + outputTokens * costs[1]) / 1_000_000;

      return {
        text: data.content?.[0]?.text || "No response generated.",
        model: useModel,
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        estimatedCost,
      };
    } catch (e: any) {
      lastError = e;
      if (attempt < MAX_RETRIES - 1 && (e.message?.includes("fetch") || e.message?.includes("network"))) {
        const backoffMs = Math.pow(2, attempt + 1) * 1000;
        await new Promise(r => setTimeout(r, backoffMs));
        continue;
      }
      throw e;
    }
  }

  throw lastError || new Error("callClaude: all retries exhausted");
}

// ─── Context gathering (lighter version of swanbot-ai) ───────────────────────

interface ContextFlags {
  members?: boolean;
  check_ins?: boolean;
  tasks?: boolean;
  streaks?: boolean;
  analytics?: boolean;
  rooms?: boolean;
  goals?: boolean;
  trading?: boolean;
}

async function gatherContext(supabase: any, circleId: string, flags: ContextFlags) {
  // Always get circle info
  const { data: circle } = await supabase
    .from("circles")
    .select("name, description")
    .eq("id", circleId)
    .single();

  let members: any[] = [];
  let memberCount = 0;
  if (flags.members !== false) {
    const { data: membersRaw } = await supabase
      .from("circle_members")
      .select("role, user:profiles(id, username, display_name, current_streak, longest_streak)")
      .eq("circle_id", circleId);
    members = (membersRaw || []).map((m: any) => ({ ...m.user, role: m.role }));
    memberCount = members.length;
  }

  let todayCheckIns: any[] = [];
  let notCheckedIn: any[] = [];
  if (flags.check_ins !== false) {
    const today = new Date().toISOString().split("T")[0];
    const { data } = await supabase
      .from("check_ins")
      .select("content, created_at, user:profiles(display_name, username)")
      .eq("circle_id", circleId)
      .gte("created_at", today);
    todayCheckIns = data || [];

    const checkedInIds = new Set(todayCheckIns.map((c: any) => c.user?.username));
    notCheckedIn = members.filter((m: any) => !checkedInIds.has(m.username));
  }

  let openTasks: any[] = [];
  let completedTasks: any[] = [];
  let recentTasks: any[] = [];
  let stuckTasks: any[] = [];
  let peerReviewTasks: any[] = [];
  if (flags.tasks !== false) {
    const { data: open } = await supabase
      .from("tasks")
      .select("title, status, priority, due_date, created_at, updated_at, assignee:profiles!tasks_assigned_to_fkey(display_name)")
      .eq("circle_id", circleId)
      .neq("status", "done")
      .order("created_at", { ascending: false })
      .limit(30);
    openTasks = open || [];

    // Tasks in peer_review status
    peerReviewTasks = openTasks.filter((t: any) => t.status === "peer_review" || t.status === "review");

    // Stuck tasks: in_progress for >3 days without update
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    stuckTasks = openTasks.filter((t: any) => {
      if (t.status !== "in_progress") return false;
      const lastUpdate = new Date(t.updated_at || t.created_at);
      return lastUpdate < threeDaysAgo;
    });

    // Recent tasks (created in last 7 days)
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    recentTasks = openTasks.filter((t: any) => new Date(t.created_at) >= weekAgo);

    const { data: done } = await supabase
      .from("tasks")
      .select("title, completed_at, assignee:profiles!tasks_assigned_to_fkey(display_name)")
      .eq("circle_id", circleId)
      .eq("status", "done")
      .gte("completed_at", weekAgo.toISOString())
      .limit(10);
    completedTasks = done || [];
  }

  // ── Goals ──
  let goals: any[] = [];
  if (flags.goals !== false) {
    const { data: goalsRaw } = await supabase
      .from("goals")
      .select("id, name, description, status, target_count, created_at")
      .eq("circle_id", circleId)
      .order("created_at", { ascending: false })
      .limit(20);
    goals = goalsRaw || [];
  }

  // ── Rooms ──
  let rooms: any[] = [];
  let roomFiles: any[] = [];
  let roomMessages: any[] = [];
  if (flags.rooms !== false) {
    const { data: roomsRaw } = await supabase
      .from("circle_rooms")
      .select("id, name, description, language, updated_at")
      .eq("circle_id", circleId)
      .eq("is_active", true)
      .order("updated_at", { ascending: false })
      .limit(15);
    rooms = roomsRaw || [];

    if (rooms.length > 0) {
      const roomIds = rooms.map((r: any) => r.id);

      // Get files with content — text files get content, binary files get metadata only
      // Budget: ~20KB total content to keep token count reasonable
      const { data: filesRaw } = await supabase
        .from("room_files")
        .select("id, room_id, name, folder, file_type, content, storage_url, size_bytes, updated_at")
        .in("room_id", roomIds)
        .eq("is_deleted", false)
        .order("updated_at", { ascending: false })
        .limit(80);
      roomFiles = filesRaw || [];

      // Trim file contents to fit within budget
      const MAX_TOTAL_CONTENT = 20000; // ~20KB total
      const MAX_PER_FILE = 4000; // ~4KB per file
      let totalContentSize = 0;
      for (const f of roomFiles) {
        // Skip binary files (have storage_url but no text content)
        if (f.storage_url && (!f.content || f.content.startsWith("http"))) {
          f._contentTruncated = false;
          f._hasContent = false;
          continue;
        }
        if (f.content && totalContentSize < MAX_TOTAL_CONTENT) {
          const remaining = MAX_TOTAL_CONTENT - totalContentSize;
          const maxForThis = Math.min(MAX_PER_FILE, remaining);
          if (f.content.length > maxForThis) {
            f.content = f.content.slice(0, maxForThis);
            f._contentTruncated = true;
          } else {
            f._contentTruncated = false;
          }
          f._hasContent = true;
          totalContentSize += f.content.length;
        } else if (f.content) {
          // Over budget — strip content but keep metadata
          f.content = null;
          f._hasContent = false;
          f._contentTruncated = true;
        } else {
          f._hasContent = false;
        }
      }

      // Get recent room messages (last 24h)
      const dayAgo = new Date();
      dayAgo.setDate(dayAgo.getDate() - 1);
      const { data: msgsRaw } = await supabase
        .from("room_messages")
        .select("room_id, agent_name, content, message_type, created_at")
        .in("room_id", roomIds)
        .gte("created_at", dayAgo.toISOString())
        .order("created_at", { ascending: false })
        .limit(30);
      roomMessages = msgsRaw || [];
    }
  }

  // ── Trading / Wallet context ──
  let wallets: any[] = [];
  let tradingAlerts: any[] = [];
  let dcaConfigs: any[] = [];
  let recentTrades: any[] = [];

  if (flags.trading) {
    // Get member wallet addresses
    const memberIds = members.map((m: any) => m.user_id);
    if (memberIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, display_name, wallet_address_sol, portfolio_value_usd")
        .in("id", memberIds);
      wallets = (profiles || []).filter((p: any) => p.wallet_address_sol);
    }

    // Get active alerts
    if (memberIds.length > 0) {
      const { data: alerts } = await supabase
        .from("trading_alerts")
        .select("*")
        .in("user_id", memberIds)
        .eq("triggered", false)
        .limit(50);
      tradingAlerts = alerts || [];
    }

    // Get DCA configs
    if (memberIds.length > 0) {
      const { data: dca } = await supabase
        .from("trading_dca_configs")
        .select("*")
        .in("user_id", memberIds)
        .eq("is_active", true)
        .limit(20);
      dcaConfigs = dca || [];
    }

    // Get recent trade log
    if (memberIds.length > 0) {
      const { data: trades } = await supabase
        .from("trading_log")
        .select("*")
        .in("user_id", memberIds)
        .order("created_at", { ascending: false })
        .limit(30);
      recentTrades = trades || [];
    }
  }

  return {
    circle,
    members,
    memberCount,
    todayCheckIns,
    checkedInCount: todayCheckIns.length,
    notCheckedIn,
    openTasks,
    completedTasks,
    recentTasks,
    stuckTasks,
    peerReviewTasks,
    goals,
    rooms,
    roomFiles,
    roomMessages,
    wallets,
    tradingAlerts,
    dcaConfigs,
    recentTrades,
  };
}

// ─── Build prompt context string ─────────────────────────────────────────────

function buildContextString(ctx: any): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "America/New_York" });
  const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "America/New_York" });

  let s = `Circle: ${ctx.circle?.name || "Unknown"}\nDate: ${dateStr} at ${timeStr} ET\nMembers: ${ctx.memberCount}\nChecked in today: ${ctx.checkedInCount}/${ctx.memberCount}`;

  if (ctx.members?.length > 0) {
    s += `\n\nMembers:\n${ctx.members.map((m: any) =>
      `- ${m.display_name || m.username} (${m.role || "member"}) — ${m.current_streak || 0} day streak`
    ).join("\n")}`;
  }

  if (ctx.notCheckedIn?.length > 0) {
    s += `\n\nHaven't checked in today:\n${ctx.notCheckedIn.map((m: any) =>
      `- ${m.display_name || m.username}`
    ).join("\n")}`;
  }

  if (ctx.todayCheckIns?.length > 0) {
    s += `\n\nToday's check-ins:\n${ctx.todayCheckIns.map((c: any) =>
      `- ${c.user?.display_name || c.user?.username}: "${c.content}"`
    ).join("\n")}`;
  }

  if (ctx.openTasks?.length > 0) {
    s += `\n\nOpen tasks (${ctx.openTasks.length}):\n${ctx.openTasks.slice(0, 15).map((t: any) =>
      `- [${t.priority || "normal"}] ${t.title} → ${t.assignee?.display_name || "Unassigned"} (${t.status})`
    ).join("\n")}`;
  }

  if (ctx.stuckTasks?.length > 0) {
    s += `\n\n⚠️ Stuck tasks (in_progress >3 days, no updates):\n${ctx.stuckTasks.map((t: any) =>
      `- ${t.title} → ${t.assignee?.display_name || "Unassigned"} (last update: ${t.updated_at?.split("T")[0] || "unknown"})`
    ).join("\n")}`;
  }

  if (ctx.peerReviewTasks?.length > 0) {
    s += `\n\nTasks awaiting peer review (${ctx.peerReviewTasks.length}):\n${ctx.peerReviewTasks.map((t: any) =>
      `- ${t.title} → ${t.assignee?.display_name || "Unassigned"}`
    ).join("\n")}`;
  }

  if (ctx.completedTasks?.length > 0) {
    s += `\n\nCompleted this week:\n${ctx.completedTasks.map((t: any) =>
      `- ✅ ${t.title} by ${t.assignee?.display_name || "someone"}`
    ).join("\n")}`;
  }

  // Goals
  if (ctx.goals?.length > 0) {
    s += `\n\nGoals (${ctx.goals.length}):\n${ctx.goals.map((g: any) =>
      `- [${g.status}] ${g.name}${g.description ? ": " + g.description.slice(0, 80) : ""}${g.target_count ? ` (target: ${g.target_count})` : ""}`
    ).join("\n")}`;
  }

  // Rooms
  if (ctx.rooms?.length > 0) {
    s += `\n\nProject Rooms (${ctx.rooms.length}):`;
    for (const room of ctx.rooms) {
      const roomFileList = (ctx.roomFiles || []).filter((f: any) => f.room_id === room.id);
      const recentMsgs = (ctx.roomMessages || []).filter((m: any) => m.room_id === room.id);
      s += `\n\n### Room: ${room.name} (${room.language || "general"}, ${roomFileList.length} files)`;
      if (room.description) s += `\n  Description: ${room.description.slice(0, 120)}`;
      s += `\n  Room ID: ${room.id}`;

      // File contents
      if (roomFileList.length > 0) {
        s += `\n  Files:`;
        for (const f of roomFileList) {
          const path = f.folder && f.folder !== "/" ? `${f.folder}/${f.name}` : f.name;
          const sizeLabel = f.size_bytes ? ` (${f.size_bytes} bytes)` : "";
          s += `\n    - ${path} [${f.file_type || "text"}]${sizeLabel}`;
          if (f._hasContent && f.content) {
            s += `\n\`\`\`${f.file_type || ""}\n${f.content}${f._contentTruncated ? "\n...[truncated]" : ""}\n\`\`\``;
          } else if (f.storage_url) {
            s += ` (binary file in storage)`;
          }
        }
      }

      // Recent messages
      if (recentMsgs.length > 0) {
        s += `\n  Recent activity (${recentMsgs.length} messages in last 24h):`;
        for (const msg of recentMsgs.slice(0, 5)) {
          const who = msg.agent_name || "user";
          s += `\n    [${who}] ${(msg.content || "").slice(0, 200)}`;
        }
      }
    }
  }

  // Trading / Wallet context
  if (ctx.wallets?.length > 0) {
    s += `\n\nConnected Wallets (${ctx.wallets.length}):`;
    for (const w of ctx.wallets) {
      s += `\n- ${w.display_name}: ${w.wallet_address_sol}${w.portfolio_value_usd ? ` ($${Number(w.portfolio_value_usd).toFixed(2)})` : ""}`;
    }
  }

  if (ctx.tradingAlerts?.length > 0) {
    s += `\n\nActive Trading Alerts (${ctx.tradingAlerts.length}):\n${ctx.tradingAlerts.map((a: any) =>
      `- ${a.token_symbol} ${a.alert_type}: target $${a.target_value}`
    ).join("\n")}`;
  }

  if (ctx.dcaConfigs?.length > 0) {
    s += `\n\nActive DCA Configs (${ctx.dcaConfigs.length}):\n${ctx.dcaConfigs.map((d: any) =>
      `- ${d.output_mint.slice(0, 8)}... every ${d.interval_hours}h, ${d.amount_per_interval} lamports/interval${d.max_price ? `, max $${d.max_price}` : ""}`
    ).join("\n")}`;
  }

  if (ctx.recentTrades?.length > 0) {
    s += `\n\nRecent Trades (${ctx.recentTrades.length}):\n${ctx.recentTrades.slice(0, 10).map((t: any) =>
      `- [${t.status}] ${t.action}: ${t.input_amount} → ${t.output_amount}${t.tx_hash ? ` (tx: ${t.tx_hash.slice(0, 12)}...)` : ""}${t.reason ? ` — ${t.reason}` : ""}`
    ).join("\n")}`;
  }

  return s;
}

// ─── Variable substitution ──────────────────────────────────────────────────

function substituteVariables(prompt: string, vars: Record<string, string>): string {
  return prompt.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

// ─── Trade action parsing ────────────────────────────────────────────────────

interface ParsedTradeAction {
  actionType: string;
  inputMint: string;
  outputMint: string;
  amountLamports: number;
  slippageBps?: number;
  maxPrice?: number;
  reason?: string;
  userId?: string;
}

/**
 * Parse trade actions from AI response text.
 * Looks for JSON blocks with trade instructions.
 * Supports both JSON array format and structured text with TRADE_ACTION markers.
 */
function parseTradingActions(aiText: string): ParsedTradeAction[] {
  const actions: ParsedTradeAction[] = [];

  // 1. Try to find JSON array in the response
  const jsonMatch = aiText.match(/\[[\s\S]*?\{[\s\S]*?"(?:action_type|actionType|action)"[\s\S]*?\}[\s\S]*?\]/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          const outputMint = item.output_mint || item.outputMint || item.token_mint || item.mint;
          const amountSol = parseFloat(item.amount_sol || item.amountSol || item.amount || "0");
          const amountLamports = item.amount_lamports || item.amountLamports || Math.floor(amountSol * 1e9);
          if (outputMint && amountLamports > 0) {
            actions.push({
              actionType: item.action_type || item.actionType || item.action || "swap",
              inputMint: item.input_mint || item.inputMint || "So11111111111111111111111111111111111111112",
              outputMint,
              amountLamports,
              slippageBps: item.slippage_bps || item.slippageBps || 50,
              maxPrice: item.max_price || item.maxPrice,
              reason: item.reason || item.status,
              userId: item.user_id || item.userId,
            });
          }
        }
      }
    } catch {
      // JSON parse failed — try other formats
    }
  }

  // 2. Try TRADE_ACTION markers: TRADE_ACTION: swap SOL→<mint> <amount>SOL reason:<text>
  const markerRegex = /TRADE_ACTION:\s*(swap|dca_buy|limit_buy|limit_sell|stop_loss)\s+\S+→(\S+)\s+([\d.]+)\s*SOL(?:\s+reason:(.+))?/gi;
  let match;
  while ((match = markerRegex.exec(aiText)) !== null) {
    const amountSol = parseFloat(match[3]);
    if (amountSol > 0) {
      actions.push({
        actionType: match[1].toLowerCase(),
        inputMint: "So11111111111111111111111111111111111111112",
        outputMint: match[2],
        amountLamports: Math.floor(amountSol * 1e9),
        reason: match[4]?.trim(),
      });
    }
  }

  return actions;
}

// ─── Room file action parsing & execution ────────────────────────────────────

interface ParsedRoomFileAction {
  action: "create" | "update" | "delete";
  room: string;       // room name or UUID
  file: string;       // filename
  folder?: string;    // folder path, defaults to "/"
  language?: string;   // file_type / language tag
  content?: string;   // file content (required for create/update)
}

/**
 * Parse room file actions from AI response text.
 * Supports [FILE_ACTIONS]...[/FILE_ACTIONS] JSON blocks and
 * individual FILE_ACTION: markers with code blocks.
 */
function parseRoomFileActions(aiText: string): ParsedRoomFileAction[] {
  const actions: ParsedRoomFileAction[] = [];

  // 1. Try [FILE_ACTIONS]...[/FILE_ACTIONS] JSON block
  const blockMatch = aiText.match(/\[FILE_ACTIONS\]\s*([\s\S]*?)\s*\[\/FILE_ACTIONS\]/i);
  if (blockMatch) {
    try {
      const parsed = JSON.parse(blockMatch[1]);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        if (item.action && item.room && item.file) {
          actions.push({
            action: item.action,
            room: item.room,
            file: item.file,
            folder: item.folder || "/",
            language: item.language || item.file_type || "",
            content: item.content || "",
          });
        }
      }
    } catch {
      // JSON parse failed — try other formats
    }
  }

  // 2. Try individual FILE_ACTION markers followed by code blocks
  // Format: FILE_ACTION: create room:"room-name" file:"filename.ext" folder:"/path"
  // ```lang
  // content
  // ```
  const markerRegex = /FILE_ACTION:\s*(create|update|delete)\s+room:"([^"]+)"\s+file:"([^"]+)"(?:\s+folder:"([^"]*)")?/gi;
  let match;
  while ((match = markerRegex.exec(aiText)) !== null) {
    const action = match[1].toLowerCase() as "create" | "update" | "delete";
    const room = match[2];
    const file = match[3];
    const folder = match[4] || "/";

    if (action === "delete") {
      actions.push({ action, room, file, folder });
      continue;
    }

    // Look for the next code block after this marker
    const afterMarker = aiText.slice(match.index + match[0].length);
    const codeMatch = afterMarker.match(/```(\w+)?\n([\s\S]+?)```/);
    if (codeMatch) {
      actions.push({
        action,
        room,
        file,
        folder,
        language: codeMatch[1] || "",
        content: codeMatch[2].trim(),
      });
    }
  }

  return actions;
}

const LANG_TO_EXT: Record<string, string> = {
  html: "html", css: "css", js: "javascript", javascript: "javascript",
  ts: "typescript", typescript: "typescript", tsx: "tsx", jsx: "jsx",
  json: "json", python: "python", py: "python", sql: "sql",
  md: "markdown", markdown: "markdown", yaml: "yaml", yml: "yaml",
  sh: "bash", bash: "bash", xml: "xml", txt: "text",
  rust: "rust", go: "go", java: "java", cpp: "cpp", c: "c",
  ruby: "ruby", php: "php", swift: "swift", kotlin: "kotlin",
};

/**
 * Execute parsed room file actions against the database.
 * Returns a summary of what was done.
 */
async function executeRoomFileActions(
  supabase: any,
  circleId: string,
  actions: ParsedRoomFileAction[],
  agentName: string,
): Promise<string[]> {
  const results: string[] = [];

  for (const act of actions) {
    try {
      // Resolve room name → room ID
      let roomId = act.room;
      if (!act.room.match(/^[0-9a-f-]{36}$/i)) {
        const { data: room } = await supabase
          .from("circle_rooms")
          .select("id")
          .eq("circle_id", circleId)
          .ilike("name", act.room)
          .eq("is_active", true)
          .single();
        if (!room) {
          results.push(`⚠ Room "${act.room}" not found — skipped ${act.action} ${act.file}`);
          continue;
        }
        roomId = room.id;
      }

      const folder = act.folder || "/";
      const fileType = act.language
        ? (LANG_TO_EXT[act.language.toLowerCase()] || act.language)
        : (act.file.includes(".") ? act.file.split(".").pop() || "text" : "text");

      if (act.action === "create") {
        if (!act.content) {
          results.push(`⚠ Cannot create "${act.file}" — no content provided`);
          continue;
        }
        // Check if file already exists (upsert)
        const { data: existing } = await supabase
          .from("room_files")
          .select("id")
          .eq("room_id", roomId)
          .eq("name", act.file)
          .eq("folder", folder)
          .eq("is_deleted", false)
          .maybeSingle();

        if (existing) {
          // Update existing file
          await supabase.from("room_files")
            .update({
              content: act.content,
              size_bytes: act.content.length,
              file_type: fileType,
              updated_at: new Date().toISOString(),
            })
            .eq("id", existing.id);
          results.push(`✓ Updated existing file "${act.file}" in room "${act.room}" (${act.content.length} bytes)`);
        } else {
          await supabase.from("room_files").insert({
            room_id: roomId,
            name: act.file,
            folder,
            file_type: fileType,
            content: act.content,
            size_bytes: act.content.length,
          });
          results.push(`✓ Created file "${act.file}" in room "${act.room}" (${act.content.length} bytes)`);
        }

        // Post a message to the room about the file action
        await supabase.from("room_messages").insert({
          room_id: roomId,
          agent_name: agentName,
          content: `📝 ${existing ? "Updated" : "Created"} file: ${folder === "/" ? "" : folder + "/"}${act.file}`,
          message_type: "system",
          metadata: { automation_file_action: true, action: act.action, file: act.file },
        });

      } else if (act.action === "update") {
        if (!act.content) {
          results.push(`⚠ Cannot update "${act.file}" — no content provided`);
          continue;
        }
        const { data: updated } = await supabase.from("room_files")
          .update({
            content: act.content,
            size_bytes: act.content.length,
            file_type: fileType,
            updated_at: new Date().toISOString(),
          })
          .eq("room_id", roomId)
          .eq("name", act.file)
          .eq("is_deleted", false)
          .select("id")
          .maybeSingle();

        if (updated) {
          results.push(`✓ Updated file "${act.file}" in room "${act.room}" (${act.content.length} bytes)`);
          await supabase.from("room_messages").insert({
            room_id: roomId,
            agent_name: agentName,
            content: `📝 Updated file: ${folder === "/" ? "" : folder + "/"}${act.file}`,
            message_type: "system",
            metadata: { automation_file_action: true, action: "update", file: act.file },
          });
        } else {
          // File doesn't exist — create it
          await supabase.from("room_files").insert({
            room_id: roomId,
            name: act.file,
            folder,
            file_type: fileType,
            content: act.content,
            size_bytes: act.content.length,
          });
          results.push(`✓ File "${act.file}" didn't exist — created in room "${act.room}" (${act.content.length} bytes)`);
          await supabase.from("room_messages").insert({
            room_id: roomId,
            agent_name: agentName,
            content: `📝 Created file: ${folder === "/" ? "" : folder + "/"}${act.file}`,
            message_type: "system",
            metadata: { automation_file_action: true, action: "create", file: act.file },
          });
        }

      } else if (act.action === "delete") {
        const { data: deleted } = await supabase.from("room_files")
          .update({ is_deleted: true, updated_at: new Date().toISOString() })
          .eq("room_id", roomId)
          .eq("name", act.file)
          .eq("is_deleted", false)
          .select("id")
          .maybeSingle();

        if (deleted) {
          results.push(`✓ Deleted file "${act.file}" from room "${act.room}"`);
          await supabase.from("room_messages").insert({
            room_id: roomId,
            agent_name: agentName,
            content: `🗑️ Deleted file: ${folder === "/" ? "" : folder + "/"}${act.file}`,
            message_type: "system",
            metadata: { automation_file_action: true, action: "delete", file: act.file },
          });
        } else {
          results.push(`⚠ File "${act.file}" not found in room "${act.room}" — skip delete`);
        }
      }
    } catch (err: any) {
      results.push(`❌ Failed to ${act.action} "${act.file}": ${err.message}`);
    }
  }

  return results;
}

// ─── Output routing ──────────────────────────────────────────────────────────

async function routeOutput(
  supabase: any,
  outputTarget: string,
  circleId: string,
  agentName: string,
  text: string,
  webhookUrl?: string,
  automationName?: string,
) {
  // Skip output if AI said SKIP
  if (text.trim() === "SKIP") return;

  switch (outputTarget) {
    case "chat":
      // Insert as a bot message in the circle chat
      await supabase.from("messages").insert({
        circle_id: circleId,
        content: text,
        is_bot: true,
        user_id: null,
      });
      break;

    case "activity":
      await supabase.from("agent_activity").insert({
        circle_id: circleId,
        agent_name: agentName,
        source: "cron",
        source_detail: `automation:${automationName || "unknown"}`,
        activity_type: "task_completed",
        title: `Automation: ${automationName || "Task"}`,
        body: text.slice(0, 2000),
        status: "completed",
      });
      break;

    case "webhook":
      if (webhookUrl) {
        try {
          // Telegram Bot API detection: URL contains api.telegram.org or has telegram config
          if (webhookUrl.includes("api.telegram.org")) {
            // Direct Telegram URL: extract bot token and chat ID from URL params
            await fetch(webhookUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ text, parse_mode: "Markdown" }),
              signal: AbortSignal.timeout(10000),
            });
          } else {
            await fetch(webhookUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                text,
                source: "circle-automation",
                automation: automationName,
                circle_id: circleId,
              }),
              signal: AbortSignal.timeout(10000),
            });
          }
        } catch (e) {
          console.warn("Webhook delivery failed:", e);
        }
      }
      // Also try Telegram via circle settings if no webhookUrl
      if (!webhookUrl) {
        try {
          const { data: circle } = await supabase
            .from("circles")
            .select("settings")
            .eq("id", circleId)
            .single();
          const tg = circle?.settings?.telegram;
          if (tg?.bot_token && tg?.chat_id) {
            await fetch(
              `https://api.telegram.org/bot${tg.bot_token}/sendMessage`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  chat_id: tg.chat_id,
                  text: `\u{1F9B2} *${automationName || "Automation"}*\n\n${text}`,
                  parse_mode: "Markdown",
                }),
                signal: AbortSignal.timeout(10000),
              }
            );
          }
        } catch (e) {
          console.warn("Telegram fallback failed:", e);
        }
      }
      break;

    case "silent":
      // Output stored only in automation_runs
      break;

    default:
      // Support room routing: "room:{room_id}" or "room:{room_name}"
      if (outputTarget.startsWith("room:")) {
        const roomRef = outputTarget.slice(5);
        try {
          // Try as UUID first, then as name
          let roomId = roomRef;
          if (!roomRef.match(/^[0-9a-f-]{36}$/i)) {
            const { data: room } = await supabase
              .from("circle_rooms")
              .select("id")
              .eq("circle_id", circleId)
              .ilike("name", roomRef)
              .eq("is_active", true)
              .single();
            if (room) roomId = room.id;
          }
          await supabase.from("room_messages").insert({
            room_id: roomId,
            agent_name: agentName,
            content: text,
            message_type: "agent_output",
            metadata: { automation: automationName, source: "automation" },
          });
        } catch (e) {
          console.warn(`Room output failed for ${outputTarget}:`, e);
        }
      }
      break;
  }
}

// ─── Build detailed report task ──────────────────────────────────────────────

interface ReportInput {
  automationName: string;
  automationId: string;
  runId: string;
  triggerSource: string;
  model: string;
  modelKey: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  durationMs: number;
  outputTarget: string;
  skipped: boolean;
  circleName: string;
  memberCount: number;
  checkedInCount: number;
  members: any[];
  notCheckedIn: any[];
  todayCheckIns: any[];
  openTasks: any[];
  completedTasks: any[];
  aiOutput: string;
  resolvedPrompt: string;
  systemPrompt: string;
  logSteps: string[];
  completedAt: string;
}

function buildReportTask(r: ReportInput): { title: string; description: string } {
  const ts = new Date(r.completedAt);
  const dateLabel = ts.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const timeLabel = ts.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "America/New_York" });
  const title = `[Auto] ${r.automationName} - ${dateLabel} ${timeLabel}`;

  const lines: string[] = [];

  // ── Summary ──
  lines.push(`AUTOMATION REPORT: ${r.automationName}`);
  lines.push(`${"=".repeat(50)}`);
  lines.push(`Status: ${r.skipped ? "SKIPPED" : "COMPLETED"}`);
  lines.push(`Trigger: ${r.triggerSource}`);
  lines.push(`Completed: ${dateLabel} at ${timeLabel} ET`);
  lines.push(`Duration: ${(r.durationMs / 1000).toFixed(1)}s`);
  lines.push(`Model: ${r.model} (${r.modelKey})`);
  lines.push(`Tokens: ${r.totalTokens} total (${r.inputTokens} input / ${r.outputTokens} output)`);
  lines.push(`Cost: $${r.estimatedCost.toFixed(4)}`);
  lines.push(`Output routed to: ${r.outputTarget}`);
  lines.push(`Run ID: ${r.runId}`);
  lines.push("");

  // ── Context Analyzed ──
  lines.push(`CONTEXT ANALYZED`);
  lines.push(`${"-".repeat(50)}`);
  lines.push(`Circle: ${r.circleName}`);
  lines.push(`Members: ${r.memberCount} total, ${r.checkedInCount} checked in today`);
  lines.push(`Open tasks: ${r.openTasks.length}`);
  lines.push(`Completed tasks (7d): ${r.completedTasks.length}`);
  lines.push("");

  // Members
  if (r.members.length > 0) {
    lines.push(`MEMBERS REVIEWED (${r.members.length})`);
    lines.push(`${"-".repeat(50)}`);
    for (const m of r.members) {
      const streak = m.current_streak || 0;
      const longest = m.longest_streak || 0;
      lines.push(`  ${m.display_name || m.username} (${m.role || "member"}) - ${streak}d streak (best: ${longest}d)`);
    }
    lines.push("");
  }

  // Not checked in
  if (r.notCheckedIn.length > 0) {
    lines.push(`NOT CHECKED IN TODAY (${r.notCheckedIn.length})`);
    lines.push(`${"-".repeat(50)}`);
    for (const m of r.notCheckedIn) {
      lines.push(`  - ${m.display_name || m.username}`);
    }
    lines.push("");
  }

  // Check-ins
  if (r.todayCheckIns.length > 0) {
    lines.push(`TODAY'S CHECK-INS (${r.todayCheckIns.length})`);
    lines.push(`${"-".repeat(50)}`);
    for (const c of r.todayCheckIns) {
      const who = c.user?.display_name || c.user?.username || "Unknown";
      const when = new Date(c.created_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
      lines.push(`  [${when}] ${who}: "${c.content}"`);
    }
    lines.push("");
  }

  // Open tasks
  if (r.openTasks.length > 0) {
    lines.push(`OPEN TASKS REVIEWED (${r.openTasks.length})`);
    lines.push(`${"-".repeat(50)}`);
    for (const t of r.openTasks.slice(0, 20)) {
      const who = t.assignee?.display_name || "Unassigned";
      lines.push(`  [${(t.priority || "normal").toUpperCase()}] ${t.title} -> ${who} (${t.status})${t.due_date ? ` due ${t.due_date}` : ""}`);
    }
    lines.push("");
  }

  // Completed tasks
  if (r.completedTasks.length > 0) {
    lines.push(`COMPLETED THIS WEEK (${r.completedTasks.length})`);
    lines.push(`${"-".repeat(50)}`);
    for (const t of r.completedTasks) {
      const who = t.assignee?.display_name || "someone";
      lines.push(`  [done] ${t.title} by ${who}`);
    }
    lines.push("");
  }

  // ── AI Response ──
  lines.push(`AI RESPONSE`);
  lines.push(`${"=".repeat(50)}`);
  lines.push(r.aiOutput);
  lines.push("");

  // ── Execution Log ──
  lines.push(`EXECUTION LOG`);
  lines.push(`${"-".repeat(50)}`);
  for (const step of r.logSteps) {
    lines.push(`  ${step}`);
  }
  lines.push("");

  // ── Prompt ──
  lines.push(`PROMPT SENT TO AI`);
  lines.push(`${"-".repeat(50)}`);
  lines.push(r.resolvedPrompt);

  return { title, description: lines.join("\n") };
}

// ─── Main handler ────────────────────────────────────────────────────────────

interface AutomationRequest {
  automationId: string;
  circleId: string;
  triggerSource: "schedule" | "event" | "manual" | "retry";
  triggeredBy?: string;
  eventPayload?: any;
  retryCount?: number;
  dryRun?: boolean; // If true, run AI but don't route output or create tasks
}

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 30_000; // 30 seconds

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method === "GET") {
    return jsonResponse({ status: "ok", service: "automation-executor" });
  }

  const isServiceCaller = isServiceRoleRequest(req);
  const authedUser = isServiceCaller ? null : await getAuthenticatedUser(req);
  if (!isServiceCaller && !authedUser) {
    return errResponse(401, "unauthorized", "automation-executor requires user or service-role authorization");
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body: AutomationRequest = await req.json();
    const { automationId, circleId, triggerSource, eventPayload, retryCount = 0, dryRun = false } = body;
    const triggeredBy = authedUser?.id ?? body.triggeredBy ?? null;

    if (!automationId || !circleId) {
      return jsonResponse({ error: "Missing automationId or circleId" }, 400);
    }

    if (!isServiceCaller && triggerSource !== "manual") {
      return errResponse(403, "forbidden", "Only service-role callers may trigger non-manual automations");
    }

    if (authedUser) {
      const { data: membership, error: membershipError } = await supabase
        .from("circle_members")
        .select("circle_id")
        .eq("circle_id", circleId)
        .eq("user_id", authedUser.id)
        .maybeSingle();
      if (membershipError || !membership) {
        return errResponse(403, "forbidden", "You are not a member of this circle");
      }
    }

    // 1. Load automation config
    const { data: automation, error: autoErr } = await supabase
      .from("circle_automations")
      .select("*")
      .eq("id", automationId)
      .single();

    if (autoErr || !automation) {
      return jsonResponse({ error: "Automation not found" }, 404);
    }

    if (automation.circle_id !== circleId) {
      return errResponse(400, "circle_mismatch", "Automation does not belong to the requested circle");
    }

    if (!automation.enabled && triggerSource !== "manual") {
      return jsonResponse({ error: "Automation is disabled" }, 400);
    }

    // 2. Create run record
    const { data: run } = await supabase
      .from("automation_runs")
      .insert({
        automation_id: automationId,
        circle_id: circleId,
        status: "running",
        trigger_source: triggerSource,
        triggered_by: triggeredBy || null,
      })
      .select("id")
      .single();

    const runId = run?.id;
    const startTime = Date.now();
    const logSteps: string[] = [];

    // Helper to log a step and update the run record in realtime
    const logStep = async (step: string) => {
      logSteps.push(`[${((Date.now() - startTime) / 1000).toFixed(1)}s] ${step}`);
      if (runId) {
        await supabase
          .from("automation_runs")
          .update({ error_message: logSteps.join("\n") })
          .eq("id", runId)
          .eq("status", "running");
      }
    };

    try {
      // 3. Gather context
      await logStep(`⏳ Gathering context for "${automation.name}"...`);
      const contextFlags: ContextFlags = automation.include_context || {};
      const context = await gatherContext(supabase, circleId, contextFlags);
      await logStep(`✓ Context loaded — ${context.memberCount} members, ${context.checkedInCount} checked in, ${context.openTasks?.length || 0} open tasks, ${context.goals?.length || 0} goals, ${context.rooms?.length || 0} rooms${context.stuckTasks?.length ? `, ${context.stuckTasks.length} stuck` : ""}${context.peerReviewTasks?.length ? `, ${context.peerReviewTasks.length} in review` : ""}`);

      // 3b. Load memory notes for this automation
      let memoryNotes: any[] = [];
      try {
        const { data: notes } = await supabase
          .from("automation_memory_notes")
          .select("title, content")
          .eq("automation_id", automationId)
          .order("created_at", { ascending: true });
        memoryNotes = notes || [];
        if (memoryNotes.length > 0) {
          await logStep(`✓ Loaded ${memoryNotes.length} memory note(s)`);
        }
      } catch {
        // Memory notes table may not exist yet — that's fine
      }

      // 3c. GitHub Summary — fetch unprocessed events if this is a github_summary automation
      let githubEventsContext = "";
      const isGitHubSummary = (automation.prompt || "").includes("{{github_events}}") ||
        automation.name?.toLowerCase().includes("github summary");
      if (isGitHubSummary) {
        try {
          const { data: ghEvents } = await supabase
            .from("circle_github_events")
            .select("id, event_type, action, title, body, author, url, ref, commits_count, additions, deletions, created_at")
            .eq("circle_id", circleId)
            .eq("processed", false)
            .order("created_at", { ascending: false })
            .limit(20);

          if (!ghEvents || ghEvents.length === 0) {
            // No events — post a simple "no activity" message and complete
            const noActivityMsg = "🦢 No new GitHub activity since last check.";
            await logStep("ℹ️ No unprocessed GitHub events found");

            if (!dryRun) {
              const noActivityTarget = automation.output_target || "chat";
              await routeOutput(supabase, noActivityTarget, circleId, automation.agent || "BlackSwan", noActivityMsg, automation.webhook_url, automation.name);
              await supabase.from("agent_activity").insert({
                circle_id: circleId,
                agent_name: automation.agent || "BlackSwan",
                source: "cron",
                source_detail: `automation:${automation.name}`,
                activity_type: "task_completed",
                title: `🤖 ${automation.name}`,
                body: noActivityMsg,
                status: "completed",
                metadata: { automation_id: automationId, run_id: runId, github_events: 0 },
              });
            }

            // Mark run completed
            if (runId) {
              logSteps.push(`[${((Date.now() - startTime) / 1000).toFixed(1)}s] ✅ No events — completed`);
              await supabase.from("automation_runs").update({
                status: "completed",
                completed_at: new Date().toISOString(),
                duration_ms: Date.now() - startTime,
                error_message: logSteps.join("\n"),
              }).eq("id", runId);
            }
            return new Response(
              JSON.stringify({ ok: true, run_id: runId, github_events: 0, skipped: true }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }

          // Build context string from events
          githubEventsContext = ghEvents.map((e: any) =>
            `- [${e.event_type}${e.action ? `:${e.action}` : ""}] ${e.title} (by ${e.author}, ${e.created_at})${e.url ? `\n  ${e.url}` : ""}`
          ).join("\n");
          await logStep(`✓ Found ${ghEvents.length} unprocessed GitHub event(s)`);

          // Store event IDs so we can mark them processed after AI response
          (context as any)._githubEventIds = ghEvents.map((e: any) => e.id);
        } catch (ghErr: any) {
          await logStep(`⚠ GitHub events fetch failed: ${ghErr.message}`);
        }
      }

      // 3d. Nudge Inactive Members — check commit activity per member
      const isNudgeInactive = (automation.prompt || "").includes("{{inactive_members}}") ||
        automation.name?.toLowerCase().includes("nudge inactive");
      let inactiveMembersContext = "";
      if (isNudgeInactive) {
        try {
          const threeDaysAgo = new Date();
          threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

          // Get all members with their usernames
          const { data: membersRaw } = await supabase
            .from("circle_members")
            .select("user_id, user:profiles(display_name, username)")
            .eq("circle_id", circleId);
          const membersList = membersRaw || [];

          // Get recent commit authors from GitHub events
          const { data: recentCommits } = await supabase
            .from("circle_github_events")
            .select("author")
            .eq("circle_id", circleId)
            .eq("event_type", "push")
            .gte("created_at", threeDaysAgo.toISOString());

          const activeAuthors = new Set((recentCommits || []).map((c: any) => (c.author || "").toLowerCase()));

          // Find members who haven't pushed in >3 days
          const inactiveMembers = membersList.filter((m: any) => {
            const username = (m.user?.username || "").toLowerCase();
            const displayName = (m.user?.display_name || "").toLowerCase();
            return !activeAuthors.has(username) && !activeAuthors.has(displayName);
          });

          if (inactiveMembers.length === 0) {
            // Everyone is active — skip the AI call
            const skipMsg = "🦢 Everyone in the circle has pushed code recently. Keep shipping!";
            await logStep("ℹ️ No inactive members found — skipping nudge");

            if (!dryRun) {
              const target = automation.output_target || "chat";
              await routeOutput(supabase, target, circleId, automation.agent || "BlackSwan", skipMsg, automation.webhook_url, automation.name);
              await supabase.from("agent_activity").insert({
                circle_id: circleId,
                agent_name: automation.agent || "BlackSwan",
                source: "cron",
                source_detail: `automation:${automation.name}`,
                activity_type: "task_completed",
                title: `🤖 ${automation.name}`,
                body: skipMsg,
                status: "completed",
                metadata: { automation_id: automationId, run_id: runId, inactive_count: 0 },
              });
            }

            if (runId) {
              logSteps.push(`[${((Date.now() - startTime) / 1000).toFixed(1)}s] ✅ All members active — completed`);
              await supabase.from("automation_runs").update({
                status: "completed",
                completed_at: new Date().toISOString(),
                duration_ms: Date.now() - startTime,
                error_message: logSteps.join("\n"),
              }).eq("id", runId);
            }
            return new Response(
              JSON.stringify({ ok: true, run_id: runId, inactive_count: 0, skipped: true }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }

          inactiveMembersContext = inactiveMembers.map((m: any) => {
            const name = m.user?.display_name || m.user?.username || "Unknown";
            return `- ${name} (@${m.user?.username || "unknown"})`;
          }).join("\n");
          await logStep(`✓ Found ${inactiveMembers.length} inactive member(s) (no commits in 3+ days)`);
        } catch (nudgeErr: any) {
          await logStep(`⚠ Inactive members check failed: ${nudgeErr.message}`);
        }
      }

      // 3e. Deploy Failure Alert — check for failed workflow_run events
      const isDeployFailure = (automation.prompt || "").includes("{{deploy_failures}}") ||
        automation.name?.toLowerCase().includes("deploy failure");
      let deployFailuresContext = "";
      if (isDeployFailure) {
        try {
          const { data: failedRuns } = await supabase
            .from("circle_github_events")
            .select("id, title, body, author, url, ref, created_at")
            .eq("circle_id", circleId)
            .eq("event_type", "workflow_run")
            .eq("processed", false)
            .order("created_at", { ascending: false })
            .limit(10);

          // Filter for failures — action/conclusion stored in body or title
          const failures = (failedRuns || []).filter((e: any) => {
            const bodyLower = (e.body || "").toLowerCase();
            const titleLower = (e.title || "").toLowerCase();
            return bodyLower.includes("failure") || bodyLower.includes("failed") ||
                   titleLower.includes("failure") || titleLower.includes("failed");
          });

          if (failures.length === 0) {
            await logStep("ℹ️ No deploy failures found — skipping alert");

            if (runId) {
              logSteps.push(`[${((Date.now() - startTime) / 1000).toFixed(1)}s] ✅ No failures — completed`);
              await supabase.from("automation_runs").update({
                status: "completed",
                completed_at: new Date().toISOString(),
                duration_ms: Date.now() - startTime,
                error_message: logSteps.join("\n"),
              }).eq("id", runId);
            }
            return new Response(
              JSON.stringify({ ok: true, run_id: runId, deploy_failures: 0, skipped: true }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }

          deployFailuresContext = failures.map((e: any) =>
            `- ${e.title} (by ${e.author}, ${e.created_at})${e.url ? `\n  ${e.url}` : ""}`
          ).join("\n");
          await logStep(`✓ Found ${failures.length} deploy failure(s)`);

          // Store IDs to mark processed after output
          (context as any)._deployFailureIds = failures.map((e: any) => e.id);
        } catch (deployErr: any) {
          await logStep(`⚠ Deploy failure check failed: ${deployErr.message}`);
        }
      }

      // 4. Substitute variables in prompt
      const contextString = buildContextString(context);
      const vars: Record<string, string> = {
        circle_name: context.circle?.name || "Unknown",
        member_count: String(context.memberCount || 0),
        checked_in_count: String(context.checkedInCount || 0),
        date: new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }),
        time: new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "America/New_York" }),
        // Goals list
        goals: (context.goals || []).length > 0
          ? context.goals.map((g: any) => `- [${g.status}] ${g.name}${g.description ? ": " + g.description.slice(0, 80) : ""}`).join("\n")
          : "No goals set",
        // Tasks in peer review
        tasks_in_peer_review: (context.peerReviewTasks || []).length > 0
          ? context.peerReviewTasks.map((t: any) => `- ${t.title} → ${t.assignee?.display_name || "Unassigned"}`).join("\n")
          : "No tasks in peer review",
        // Stuck tasks (in_progress >3 days)
        stuck_tasks: (context.stuckTasks || []).length > 0
          ? context.stuckTasks.map((t: any) => `- ${t.title} → ${t.assignee?.display_name || "Unassigned"} (since ${t.updated_at?.split("T")[0] || "unknown"})`).join("\n")
          : "No stuck tasks",
        // Recent tasks (last 7 days)
        recent_tasks: (context.recentTasks || []).length > 0
          ? context.recentTasks.map((t: any) => `- [${t.priority || "normal"}] ${t.title} → ${t.assignee?.display_name || "Unassigned"} (${t.status})`).join("\n")
          : "No recent tasks",
        // Rooms summary
        rooms: (context.rooms || []).length > 0
          ? context.rooms.map((r: any) => `- ${r.name} (${r.language || "general"})${r.description ? ": " + r.description.slice(0, 60) : ""}`).join("\n")
          : "No project rooms",
        // Room files listing
        room_files: (context.rooms || []).length > 0
          ? context.rooms.map((r: any) => {
              const files = (context.roomFiles || []).filter((f: any) => f.room_id === r.id);
              if (files.length === 0) return `${r.name}: (no files)`;
              return `${r.name}:\n${files.map((f: any) => `  - ${f.folder && f.folder !== "/" ? f.folder + "/" : ""}${f.name} [${f.file_type || "text"}]${f.size_bytes ? ` (${f.size_bytes}b)` : ""}`).join("\n")}`;
            }).join("\n")
          : "No room files",
        // Trading data
        wallets: (context.wallets || []).length > 0
          ? context.wallets.map((w: any) => `- ${w.display_name}: ${w.wallet_address_sol}${w.portfolio_value_usd ? ` ($${Number(w.portfolio_value_usd).toFixed(2)})` : ""}`).join("\n")
          : "No wallets connected",
        trading_alerts: (context.tradingAlerts || []).length > 0
          ? context.tradingAlerts.map((a: any) => `- ${a.token_symbol} ${a.alert_type}: target $${a.target_value}`).join("\n")
          : "No active alerts",
        dca_configs: (context.dcaConfigs || []).length > 0
          ? context.dcaConfigs.map((d: any) => `- ${d.output_mint.slice(0, 8)}... every ${d.interval_hours}h, ${d.amount_per_interval} lamports`).join("\n")
          : "No DCA configs",
        recent_trades: (context.recentTrades || []).length > 0
          ? context.recentTrades.slice(0, 10).map((t: any) => `- [${t.status}] ${t.action}: ${t.input_amount} → ${t.output_amount}`).join("\n")
          : "No recent trades",
      };
      if (eventPayload) {
        vars.event = JSON.stringify(eventPayload);
      }
      if (githubEventsContext) {
        vars.github_events = githubEventsContext;
      }
      if (inactiveMembersContext) {
        vars.inactive_members = inactiveMembersContext;
      }
      if (deployFailuresContext) {
        vars.deploy_failures = deployFailuresContext;
      }

      const resolvedPrompt = substituteVariables(automation.prompt, vars);
      await logStep(`✓ Prompt resolved (${resolvedPrompt.length} chars)`);

      // 5. Build system prompt (with optional spirit injection)
      let spiritPrefix = "";
      if (automation.spirit) {
        // Spirit prompts are stored client-side in agentSpirits.ts but we inject a
        // lighter version server-side based on the spirit ID stored on the automation.
        // The full spirit catalog isn't available at edge-fn runtime, so the client
        // sends the spirit_prompt field when creating/updating the automation.
        // Fallback: use the spirit name as a role hint.
        spiritPrefix = automation.spirit_prompt
          ? `${automation.spirit_prompt}\n\n---\n\n`
          : `You are operating with the "${automation.spirit}" specialist mindset. Apply that expertise deeply.\n\n`;
      }

      // Inject memory notes as persistent context
      let memorySection = "";
      if (memoryNotes.length > 0) {
        memorySection = `\n\n## Memory Notes (persistent context for this automation)\n${memoryNotes.map((n: any) => `### ${n.title}\n${n.content}`).join("\n\n")}\n`;
      }

      // Room file operations instructions (only when rooms context is enabled)
      let roomFileInstructions = "";
      if (contextFlags.rooms !== false && (context.rooms || []).length > 0) {
        roomFileInstructions = `

## Room File Operations
You have FULL ACCESS to create, update, and delete files in project rooms. When your task requires modifying files, include file actions in your response using one of these formats:

**Format 1 — JSON block (preferred for multiple files):**
[FILE_ACTIONS]
[
  {"action": "create", "room": "room-name", "file": "filename.ext", "folder": "/", "language": "typescript", "content": "file content here"},
  {"action": "update", "room": "room-name", "file": "existing-file.ts", "content": "updated content"},
  {"action": "delete", "room": "room-name", "file": "old-file.js"}
]
[/FILE_ACTIONS]

**Format 2 — Inline markers (good for single files with code blocks):**
FILE_ACTION: create room:"room-name" file:"newfile.tsx" folder:"/"
\`\`\`typescript
// file content here
\`\`\`

Rules:
- Use the exact room name as shown in the context
- For "update", provide the COMPLETE new file content (not a diff)
- For "create", the file is auto-created if it doesn't exist, or updated if it does
- For "delete", the file is soft-deleted
- A system message is posted to the room for each file operation
- You can see the current file contents in the Room sections below
`;
      }

      const systemPrompt = `${spiritPrefix}You are BlackSwan 🦢 — an AI assistant for "${context.circle?.name || "Unknown"}" circle.
You are running an automated task: "${automation.name}".
Be concise, direct, and actionable. Use real data from the context below.
Always prefix your response with 🦢.${memorySection}${roomFileInstructions}

## Circle Context
${contextString}`;

      // 6. Call AI
      const modelKey = automation.model || "claude-haiku";
      const modelId = CLAUDE_MODEL_MAP[modelKey] || CLAUDE_MODEL_MAP["claude-haiku"];
      await logStep(`⏳ Calling ${modelId}...`);
      const aiResult = await callClaude(systemPrompt, resolvedPrompt, modelKey);
      await logStep(`✓ AI responded — ${aiResult.totalTokens} tokens (${aiResult.inputTokens} in / ${aiResult.outputTokens} out) · $${aiResult.estimatedCost.toFixed(4)}`);

      // 6a-gh. Mark GitHub events as processed (if github_summary)
      if (isGitHubSummary && (context as any)._githubEventIds?.length > 0 && !dryRun) {
        try {
          const eventIds: string[] = (context as any)._githubEventIds;
          await supabase
            .from("circle_github_events")
            .update({ processed: true, processed_at: new Date().toISOString() })
            .in("id", eventIds);
          await logStep(`✓ Marked ${eventIds.length} GitHub event(s) as processed`);
        } catch (markErr: any) {
          await logStep(`⚠ Failed to mark GitHub events as processed: ${markErr.message}`);
        }
      }

      // 6a-df. Mark deploy failure events as processed
      if (isDeployFailure && (context as any)._deployFailureIds?.length > 0 && !dryRun) {
        try {
          const eventIds: string[] = (context as any)._deployFailureIds;
          await supabase
            .from("circle_github_events")
            .update({ processed: true, processed_at: new Date().toISOString() })
            .in("id", eventIds);
          await logStep(`✓ Marked ${eventIds.length} deploy failure event(s) as processed`);
        } catch (markErr: any) {
          await logStep(`⚠ Failed to mark deploy failure events as processed: ${markErr.message}`);
        }
      }

      // 6b. Parse & queue trade actions (if trading automation)
      if (contextFlags.trading) {
        try {
          const tradeActions = parseTradingActions(aiResult.text);
          if (tradeActions.length > 0) {
            await logStep(`📈 Found ${tradeActions.length} trade action(s) — queuing for approval`);
            for (const action of tradeActions) {
              // Find the wallet owner for this action
              const targetUserId = action.userId || context.wallets?.[0]?.id;
              if (!targetUserId) continue;

              await supabase.from("trading_pending_actions").insert({
                user_id: targetUserId,
                circle_id: circleId,
                automation_run_id: runId,
                action_type: action.actionType || "swap",
                input_mint: action.inputMint || "So11111111111111111111111111111111111111112",
                output_mint: action.outputMint,
                amount_lamports: action.amountLamports,
                slippage_bps: action.slippageBps || 50,
                max_price: action.maxPrice || null,
                reason: action.reason || `Proposed by ${automation.name}`,
                proposed_by: automation.agent || "BlackSwan",
                source: automation.name?.toLowerCase().includes("dca") ? "dca" : "automation",
                metadata: { automation_id: automationId, run_id: runId, raw: action },
              });
            }
            await logStep(`✓ ${tradeActions.length} trade action(s) queued for user approval`);
          }
        } catch (tradeErr: any) {
          await logStep(`⚠ Trade action parsing failed: ${tradeErr.message}`);
        }
      }

      // 6c. Parse & execute room file actions (if rooms context enabled)
      let roomFileResults: string[] = [];
      if (contextFlags.rooms !== false) {
        try {
          const fileActions = parseRoomFileActions(aiResult.text);
          if (fileActions.length > 0) {
            await logStep(`📁 Found ${fileActions.length} file action(s) — executing...`);
            if (dryRun) {
              await logStep(`🧪 DRY RUN — skipping file operations: ${fileActions.map(a => `${a.action} ${a.file}`).join(", ")}`);
              roomFileResults = fileActions.map(a => `🧪 [dry-run] Would ${a.action} "${a.file}" in room "${a.room}"`);
            } else {
              roomFileResults = await executeRoomFileActions(
                supabase,
                circleId,
                fileActions,
                automation.agent || "BlackSwan",
              );
              for (const r of roomFileResults) {
                await logStep(r);
              }
            }
          }
        } catch (fileErr: any) {
          await logStep(`⚠ Room file action parsing/execution failed: ${fileErr.message}`);
          roomFileResults = [`❌ File action error: ${fileErr.message}`];
        }
      }

      // 7. Route output (skip for dry runs)
      const outputTarget = automation.output_target || "silent";
      if (dryRun) {
        await logStep(`🧪 DRY RUN — skipping output routing to ${outputTarget}`);
      } else {
        if (outputTarget !== "silent") {
          await logStep(`⏳ Routing output → ${outputTarget}...`);
        }
        await routeOutput(
          supabase,
          outputTarget,
          circleId,
          automation.agent || "BlackSwan",
          aiResult.text,
          automation.webhook_url,
          automation.name,
        );
        if (outputTarget !== "silent") {
          await logStep(`✓ Output delivered to ${outputTarget}`);
        }
      }

      // 8. Log to agent_activity (skip for dry runs)
      if (!dryRun) {
      const activityBody = `**${automation.name}** (${triggerSource})\n\n${aiResult.text.slice(0, 1500)}\n\n_${aiResult.totalTokens} tokens · ${modelId} · $${aiResult.estimatedCost.toFixed(4)}_`;
      await supabase.from("agent_activity").insert({
        circle_id: circleId,
        agent_name: automation.agent || "BlackSwan",
        source: triggerSource === "manual" ? "webchat" : "cron",
        source_detail: `automation:${automation.name}`,
        activity_type: "task_completed",
        title: `🤖 ${automation.name}`,
        body: activityBody.slice(0, 2000),
        status: "completed",
        metadata: {
          automation_id: automationId,
          run_id: runId,
          model: modelId,
          tokens: aiResult.totalTokens,
          cost: aiResult.estimatedCost,
          trigger: triggerSource,
          output_target: outputTarget,
        },
      });
      } // end if (!dryRun)

      // 9. Update run as completed with detailed log
      const durationMs = Date.now() - startTime;
      logSteps.push(`[${(durationMs / 1000).toFixed(1)}s] ✅ Completed successfully`);
      const completedAt = new Date().toISOString();

      // Build rich input_context with everything the agent saw and did
      const richContext: Record<string, any> = {
        // Execution trace
        log: logSteps,
        // Circle info
        circle: context.circle?.name,
        circleDescription: context.circle?.description || null,
        // Member data
        memberCount: context.memberCount,
        checkedInCount: context.checkedInCount,
        members: (context.members || []).map((m: any) => {
          const checkedInUsernames = new Set((context.todayCheckIns || []).map((c: any) => c.user?.username));
          return {
            name: m.display_name || m.username || 'Unknown',
            role: m.role || 'member',
            checkedIn: checkedInUsernames.has(m.username),
            streak: m.current_streak || 0,
          };
        }).slice(0, 30),
        notCheckedIn: (context.notCheckedIn || []).map((m: any) => m.display_name || m.username || 'Unknown'),
        // Check-in data
        todayCheckIns: (context.todayCheckIns || []).map((c: any) => ({
          user: c.user?.display_name || c.user?.username || 'Unknown',
          content: (c.content || '').slice(0, 200),
          time: c.created_at || '',
        })).slice(0, 20),
        // Task data
        openTaskCount: context.openTasks?.length || 0,
        openTasks: (context.openTasks || []).map((t: any) => ({
          title: (t.title || '').slice(0, 100),
          assignee: t.assignee?.display_name || null,
          status: t.status || 'open',
          priority: t.priority || null,
        })).slice(0, 20),
        completedTaskCount: context.completedTasks?.length || 0,
        // Specialized task views
        stuckTasks: (context.stuckTasks || []).map((t: any) => ({
          title: (t.title || '').slice(0, 100),
          assignee: t.assignee?.display_name || null,
          status: t.status || 'in_progress',
          lastUpdate: t.updated_at?.split("T")[0] || null,
          daysSinceUpdate: t.updated_at ? Math.floor((Date.now() - new Date(t.updated_at).getTime()) / 86400000) : null,
        })),
        peerReviewTasks: (context.peerReviewTasks || []).map((t: any) => ({
          title: (t.title || '').slice(0, 100),
          assignee: t.assignee?.display_name || null,
          status: t.status || 'peer_review',
        })),
        recentTaskCount: context.recentTasks?.length || 0,
        // Goals
        goals: (context.goals || []).map((g: any) => ({
          name: g.name || g.title,
          title: g.title || g.name,
          status: g.status,
          description: (g.description || '').slice(0, 80),
          target_count: g.target_count || null,
          current_count: g.current_count || 0,
        })),
        // Rooms
        rooms: (context.rooms || []).map((r: any) => ({
          name: r.name,
          language: r.language,
          description: (r.description || '').slice(0, 60),
          fileCount: (context.roomFiles || []).filter((f: any) => f.room_id === r.id).length,
          files: (context.roomFiles || []).filter((f: any) => f.room_id === r.id).map((f: any) => ({
            name: f.name,
            folder: f.folder,
            fileType: f.file_type,
            sizeBytes: f.size_bytes,
            hasContent: f._hasContent || false,
          })),
          recentMessages: (context.roomMessages || []).filter((m: any) => m.room_id === r.id).length,
        })),
        // Room file actions executed
        roomFileActions: roomFileResults.length > 0 ? roomFileResults : null,
        // Trading data
        wallets: (context.wallets || []).map((w: any) => ({
          name: w.display_name,
          address: w.wallet_address_sol,
          portfolioUsd: w.portfolio_value_usd ? Number(w.portfolio_value_usd) : null,
        })),
        tradingAlerts: (context.tradingAlerts || []).length,
        dcaConfigs: (context.dcaConfigs || []).length,
        recentTrades: (context.recentTrades || []).slice(0, 5).map((t: any) => ({
          action: t.action,
          status: t.status,
          inputAmount: t.input_amount,
          outputAmount: t.output_amount,
        })),
        // AI configuration
        spirit: automation.spirit || null,
        spiritPrompt: automation.spirit_prompt ? automation.spirit_prompt.slice(0, 500) + '...' : null,
        systemPrompt: systemPrompt.slice(0, 3000),
        userPrompt: resolvedPrompt,
        // Token breakdown
        inputTokens: aiResult.inputTokens,
        outputTokens: aiResult.outputTokens,
        totalTokens: aiResult.totalTokens,
        // Full context that was sent to the AI
        contextString: contextString.slice(0, 3000),
        // Event trigger data (if applicable)
        eventPayload: eventPayload ? JSON.stringify(eventPayload).slice(0, 1000) : null,
        // Output routing
        outputTarget: outputTarget,
        webhookUrl: automation.webhook_url || null,
        agent: automation.agent || 'BlackSwan',
        dryRun: dryRun || false,
        memoryNotes: memoryNotes.length > 0 ? memoryNotes.map((n: any) => n.title) : [],
      };

      await supabase
        .from("automation_runs")
        .update({
          status: "completed",
          completed_at: completedAt,
          duration_ms: durationMs,
          output_text: aiResult.text,
          prompt_used: resolvedPrompt,
          token_count: aiResult.totalTokens,
          model_used: aiResult.model,
          estimated_cost: aiResult.estimatedCost,
          input_context: richContext,
          output_target: outputTarget,
          error_message: null,
        })
        .eq("id", runId);

      // 10. Update automation metadata
      // Note: For scheduled triggers, pg_cron already updates last_run_at, run_count, and next_run_at.
      // Only update here for non-schedule triggers (manual, event, retry) to avoid double-counting.
      if (triggerSource !== "schedule") {
        await supabase
          .from("circle_automations")
          .update({
            last_error: null,
            last_run_at: new Date().toISOString(),
            run_count: (automation.run_count || 0) + 1,
          })
          .eq("id", automationId);
      } else {
        // For schedule triggers, only clear the last_error (pg_cron handles the rest)
        await supabase
          .from("circle_automations")
          .update({ last_error: null })
          .eq("id", automationId);
      }

      // 11. Create detailed report task (skip for dry runs)
      if (dryRun) {
        await logStep("🧪 DRY RUN — skipping report task creation");
      }
      const skipped = aiResult.text.trim() === "SKIP";
      const taskCreator = triggeredBy || automation.created_by || null;
      if (taskCreator && !dryRun) {
        const reportTask = buildReportTask({
          automationName: automation.name,
          automationId,
          runId: runId || "unknown",
          triggerSource,
          model: modelId,
          modelKey,
          inputTokens: aiResult.inputTokens,
          outputTokens: aiResult.outputTokens,
          totalTokens: aiResult.totalTokens,
          estimatedCost: aiResult.estimatedCost,
          durationMs,
          outputTarget,
          skipped,
          circleName: context.circle?.name || "Unknown",
          memberCount: context.memberCount,
          checkedInCount: context.checkedInCount,
          members: context.members,
          notCheckedIn: context.notCheckedIn,
          todayCheckIns: context.todayCheckIns,
          openTasks: context.openTasks,
          completedTasks: context.completedTasks,
          aiOutput: aiResult.text,
          resolvedPrompt,
          systemPrompt,
          logSteps,
          completedAt,
        });
        const { data: newTask } = await supabase.from("tasks").insert({
          circle_id: circleId,
          created_by: taskCreator,
          title: reportTask.title,
          description: reportTask.description,
          priority: skipped ? "low" : "normal",
          status: "done",
          completed_at: completedAt,
          position: 99999,
        }).select("id").single();

        // Add the full AI output as a comment on the task
        if (newTask?.id) {
          await supabase.from("task_comments").insert({
            task_id: newTask.id,
            user_id: taskCreator,
            content: `[AUTOMATION_REPORT]\n\n--- AI FULL OUTPUT ---\n${aiResult.text}\n\n--- PROMPT SENT ---\n${resolvedPrompt}\n\n--- SYSTEM PROMPT ---\n${systemPrompt}`,
          });
        }
        await logStep("✓ Report task created");
      }

      return new Response(
        JSON.stringify({ ok: true, runId, durationMs, tokens: aiResult.totalTokens }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );

    } catch (execErr: any) {
      // Update run as failed with detailed log
      const durationMs = Date.now() - startTime;
      logSteps.push(`[${(durationMs / 1000).toFixed(1)}s] ❌ Failed: ${execErr.message}`);

      if (runId) {
        await supabase
          .from("automation_runs")
          .update({
            status: "failed",
            completed_at: new Date().toISOString(),
            duration_ms: durationMs,
            error_message: execErr.message,
            input_context: { log: logSteps },
          })
          .eq("id", runId);
      }

      // Log failure to activity feed
      await supabase.from("agent_activity").insert({
        circle_id: circleId,
        agent_name: automation.agent || "BlackSwan",
        source: triggerSource === "manual" ? "webchat" : "cron",
        source_detail: `automation:${automation.name}`,
        activity_type: "task_completed",
        title: `🤖 ${automation.name}`,
        body: `❌ Failed: ${execErr.message}\n\n${logSteps.join("\n")}`.slice(0, 2000),
        status: "failed",
        metadata: { automation_id: automationId, run_id: runId, trigger: triggerSource },
      });

      // Update automation last_error
      await supabase
        .from("circle_automations")
        .update({ last_error: execErr.message, last_run_at: new Date().toISOString() })
        .eq("id", automationId);

      // Create failure report task
      const failCreator = triggeredBy || automation.created_by || null;
      if (failCreator) {
        const ts = new Date();
        const dateLabel = ts.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        const timeLabel = ts.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "America/New_York" });
        const failReport = [
          `AUTOMATION FAILED: ${automation.name}`,
          `${"=".repeat(50)}`,
          `Status: FAILED`,
          `Error: ${execErr.message}`,
          `Trigger: ${triggerSource}`,
          `Failed at: ${dateLabel} at ${timeLabel} ET`,
          `Duration: ${(durationMs / 1000).toFixed(1)}s`,
          `Run ID: ${runId || "unknown"}`,
          "",
          `EXECUTION LOG`,
          `${"-".repeat(50)}`,
          ...logSteps.map((s: string) => `  ${s}`),
        ].join("\n");

        await supabase.from("tasks").insert({
          circle_id: circleId,
          created_by: failCreator,
          title: `[Auto] FAILED: ${automation.name} - ${dateLabel} ${timeLabel}`,
          description: failReport,
          priority: "high",
          status: "backlog",
          position: 99999,
        });
      }

      // Retry logic: dispatch retry immediately via pg_net (fire-and-forget)
      // Using pg_net instead of setTimeout because Deno edge functions
      // terminate after response — setTimeout would never fire.
      if (retryCount < MAX_RETRIES) {
        const nextRetry = retryCount + 1;
        console.log(`Dispatching retry ${nextRetry}/${MAX_RETRIES} for automation ${automationId}`);
        try {
          // Schedule retry via pg_net http_post (runs async in Postgres)
          await supabase.rpc("schedule_automation_retry", {
            p_automation_id: automationId,
            p_circle_id: circleId,
            p_trigger_source: "retry",
            p_triggered_by: triggeredBy || null,
            p_event_payload: eventPayload ? JSON.stringify(eventPayload) : null,
            p_retry_count: nextRetry,
          });
        } catch (retryErr) {
          // Fallback: fire-and-forget fetch (best-effort, may not complete)
          console.error(`Retry dispatch failed, trying direct fetch:`, retryErr);
          const supabaseUrl = Deno.env.get("SUPABASE_URL");
          const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
          if (supabaseUrl && serviceKey) {
            fetch(`${supabaseUrl}/functions/v1/automation-executor`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${serviceKey}`,
              },
              body: JSON.stringify({
                automationId, circleId, triggerSource: "retry",
                triggeredBy, eventPayload, retryCount: nextRetry,
              }),
            }).catch(() => {});
          }
        }
      }

      throw execErr;
    }

  } catch (err: any) {
    console.error("automation-executor error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
