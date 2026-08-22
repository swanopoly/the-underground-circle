// watch-scheduler — server-side runner for recurring computer-task watches
// (Phase 7a of docs/CHAT_UX_INTEGRATION_UPGRADE_PLAN.md).
//
// Invoked every 15 minutes by pg_cron (migration
// 20260702_watch_scheduler_cron.sql) with the service-role key. Each tick:
//
//   1. Load due rows from `computer_use_schedules` across ALL circles
//      (active AND next_run_at <= now), soonest first.
//   2. For each due watch, SEQUENTIALLY (one browser run at a time):
//      a. Atomically CLAIM it — the same compare-and-set on next_run_at the
//         client runner uses (src/lib/computerTaskSchedules.ts
//         `claimComputerTaskScheduleRun`), so this scheduler and an open app
//         can never double-run the same due tick. Losing the CAS = the other
//         runner owns it; skip silently.
//      b. Resolve the circle's Browserbase creds from circle_integrations +
//         circle_integration_secrets (service-role reads mirroring
//         src/lib/computerUseCreds.ts + src/lib/circleIntegrations.ts).
//      c. POST the task to the computer-use-agent edge fn (service-role +
//         body.scheduledBy = the schedule's created_by, so the agent
//         resolves THAT user's Anthropic key) and consume its SSE stream to
//         completion.
//      d. Diff findings against the schedule's last_findings and re-stamp
//         the row from COMPLETION time (overwriting the claim's provisional
//         next_run_at — the cadence counts from when the check finished).
//      e. Post a chat update ONLY per the notify policy (error, or
//         notify_on='always', or an actual change) — identical to the
//         client runner. A quiet changes_only watch posts NOTHING.
//
// SAFETY: watches are created read-only (floor-checked at create time) and
// this scheduler never registers a confirmation path — an ask_user gate in
// the agent times out server-side and the run comes back partial/failed.
// Every schedule is processed inside its own try/catch: one bad watch never
// blocks the rest, and the claim has already advanced next_run_at so even a
// crashed run cannot hot-loop.
//
// Deno edge functions cannot import from src/lib, so the tiny pure pieces
// this needs (cadence math, findings diff, message formats, secret decode,
// claim CAS) are duplicated here with LOCKSTEP comments naming their client
// owners. Keep the wording byte-identical so client-run and server-run
// watch updates read the same in chat.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";
import { corsHeaders, errResponse, isServiceRoleRequest, jsonResponse } from "../_shared/edge.ts";

// ── Bounds ──────────────────────────────────────────────────────────────────

// Per-tick cap on how many due watches this scheduler runs. Each watch is a
// full browser + Claude computer-use run (~$0.10–0.75, up to ~5 min), so the
// tick is deliberately bounded for cost control: at most 2 runs per 15-minute
// cron tick. A backlog simply drains over subsequent ticks — watches are
// hourly at the fastest, so this keeps up with the MAX_ACTIVE_WATCHES cap.
const MAX_SCHEDULES_PER_TICK = 2;

// Hard wall clock per agent run. The agent's own internal wall clock is ~5
// minutes; this is the scheduler-side backstop that aborts the SSE stream if
// the edge fn hangs.
const RUN_WALL_CLOCK_MS = 6 * 60 * 1000;

const SCHEDULES_TABLE = "computer_use_schedules";

// LOCKSTEP: FOLDER_WATCH_TASK_PREFIX in src/lib/folderWatchModel.ts — rows
// whose task starts with this prefix are LOCAL folder watches ("local-folder:
// ~/Downloads | *.pdf"). They need the user's desktop bridge, which only the
// client runner (src/lib/computerTaskScheduleRunner.ts) can reach, so this
// server-side scheduler must never select, claim, or run them.
const FOLDER_WATCH_TASK_PREFIX = "local-folder:";

// ── Types (mirrors, not imports — Deno can't reach src/lib) ────────────────

// LOCKSTEP: `ComputerTaskScheduleRow` in src/lib/computerTaskScheduleModel.ts
// (1:1 mirror of a computer_use_schedules row).
type ScheduleRow = {
  id: string;
  circle_id: string;
  created_by: string | null;
  task: string;
  cadence: "hourly" | "daily" | "weekly";
  notify_on: "always" | "changes_only";
  thread_id: string | null;
  active: boolean;
  last_run_at: string | null;
  last_findings: unknown[] | null;
  last_diff_summary: string | null;
  next_run_at: string;
};

// LOCKSTEP: `ComputerRunFindingLike` in src/lib/computerRunDiff.ts.
type FindingLike = {
  title: string;
  url?: string | null;
  price?: string | null;
  rating?: string | null;
  notes?: string | null;
};

type FindingsDiff = {
  added: FindingLike[];
  removed: FindingLike[];
  priceChanged: Array<{ title: string; before: string; after: string }>;
  unchangedCount: number;
  hasChanges: boolean;
};

// ── Cadence math ────────────────────────────────────────────────────────────

// LOCKSTEP: CADENCE_INTERVAL_MS / computeNextRunAtIso in
// src/lib/computerTaskScheduleModel.ts — the client runner and this
// scheduler must agree on what one cadence interval is.
const CADENCE_INTERVAL_MS: Record<ScheduleRow["cadence"], number> = {
  hourly: 3_600_000,
  daily: 86_400_000,
  weekly: 604_800_000,
};

function computeNextRunAtIso(cadence: ScheduleRow["cadence"], fromMs: number): string {
  return new Date(fromMs + (CADENCE_INTERVAL_MS[cadence] ?? CADENCE_INTERVAL_MS.daily)).toISOString();
}

// ── Text helpers ────────────────────────────────────────────────────────────

// LOCKSTEP: clampText in src/lib/computerTaskScheduleModel.ts.
function clampText(value: string, max: number): string {
  const text = String(value || "").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

// LOCKSTEP: formatChatAttentionDuration in src/lib/chatAttentionQueue.ts —
// the "(2h 10m ago)" wording inside the diff summary must match the client.
function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 1) return "just now";
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

// ── Findings diff ───────────────────────────────────────────────────────────

// LOCKSTEP: findingKey in src/lib/computerRunDiff.ts — identity is the URL
// when present (host+path, query/tracking params stripped, www. dropped),
// else the lowercased title.
function findingKey(finding: FindingLike): string {
  const url = String(finding.url || "").trim().toLowerCase();
  if (url) {
    const match = url.match(/^[a-z]+:\/\/(?:www\.)?([^?#]+)/i);
    if (match) return `url:${match[1].replace(/\/+$/, "")}`;
  }
  return `title:${String(finding.title || "").trim().toLowerCase()}`;
}

function normalizedPrice(finding: FindingLike): string {
  return String(finding.price || "").replace(/\s+/g, " ").trim();
}

// LOCKSTEP: diffComputerRunFindings in src/lib/computerRunDiff.ts.
function diffFindings(
  previous: FindingLike[] | null | undefined,
  current: FindingLike[] | null | undefined,
): FindingsDiff {
  const prev = (previous || []).filter((f) => f && f.title);
  const curr = (current || []).filter((f) => f && f.title);
  const prevByKey = new Map(prev.map((f) => [findingKey(f), f] as const));
  const currByKey = new Map(curr.map((f) => [findingKey(f), f] as const));

  const added = curr.filter((f) => !prevByKey.has(findingKey(f)));
  const removed = prev.filter((f) => !currByKey.has(findingKey(f)));
  const priceChanged: FindingsDiff["priceChanged"] = [];
  let unchangedCount = 0;
  for (const [key, currFinding] of currByKey) {
    const prevFinding = prevByKey.get(key);
    if (!prevFinding) continue;
    const before = normalizedPrice(prevFinding);
    const after = normalizedPrice(currFinding);
    if (before && after && before !== after) {
      priceChanged.push({ title: String(currFinding.title).slice(0, 90), before, after });
    } else {
      unchangedCount += 1;
    }
  }

  return {
    added,
    removed,
    priceChanged,
    unchangedCount,
    hasChanges: added.length > 0 || removed.length > 0 || priceChanged.length > 0,
  };
}

// LOCKSTEP: formatComputerRunDiffSummary in src/lib/computerRunDiff.ts —
// copy the exact wording so client-run and server-run watch updates read
// identically in chat.
function formatDiffSummary(
  diff: FindingsDiff | null | undefined,
  opts: { previousAgeMs?: number | null } = {},
): string {
  if (!diff) return "";
  const age = typeof opts.previousAgeMs === "number" && Number.isFinite(opts.previousAgeMs) && opts.previousAgeMs >= 0
    ? ` (${formatDuration(opts.previousAgeMs)} ago)`
    : "";

  if (!diff.hasChanges) {
    return `**No changes since the last run${age}.** Same ${diff.unchangedCount} item${diff.unchangedCount === 1 ? "" : "s"} as before.`;
  }

  const headBits: string[] = [];
  if (diff.added.length > 0) headBits.push(`${diff.added.length} new`);
  if (diff.priceChanged.length > 0) headBits.push(`${diff.priceChanged.length} price change${diff.priceChanged.length === 1 ? "" : "s"}`);
  if (diff.removed.length > 0) headBits.push(`${diff.removed.length} gone`);

  const lines = [`**Since the last run${age}: ${headBits.join(" · ")}.**`];
  for (const change of diff.priceChanged.slice(0, 3)) {
    lines.push(`• Price: ${change.title} — ${change.before} → ${change.after}`);
  }
  for (const finding of diff.added.slice(0, 3)) {
    const price = normalizedPrice(finding);
    lines.push(`• New: ${String(finding.title).slice(0, 90)}${price ? ` — ${price}` : ""}`);
  }
  for (const finding of diff.removed.slice(0, 2)) {
    lines.push(`• Gone: ${String(finding.title).slice(0, 90)}`);
  }
  return lines.join("\n").slice(0, 700);
}

// LOCKSTEP: formatWatchUpdateMessage in src/lib/computerTaskScheduleModel.ts
// — header `🔁 Watch update — "<task ≤80>"`, body priority error → diff →
// run summary, whole message ≤ 800 chars so persisted rows stay bounded.
function formatWatchUpdateMessage(input: {
  task: string;
  diffSummary: string | null;
  runSummary: string | null;
  errorMessage?: string | null;
}): string {
  const header = `🔁 Watch update — "${clampText(input.task, 80)}"`;
  const error = String(input.errorMessage || "").trim();
  const diff = String(input.diffSummary || "").trim();
  const run = String(input.runSummary || "").trim();
  let body: string;
  if (error) {
    body = `Check failed: ${clampText(error, 200)}`;
  } else if (diff) {
    body = clampText(diff, 400);
  } else if (run) {
    body = clampText(run, 400);
  } else {
    body = "Check completed — nothing was reported.";
  }
  return `${header}\n${body}`.slice(0, 800);
}

// LOCKSTEP: coerceStoredFindings in src/lib/computerTaskScheduleRunner.ts —
// best-effort coercion of persisted last_findings JSON into diffable shape.
function coerceStoredFindings(value: unknown[] | null | undefined): FindingLike[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((item): item is FindingLike => {
    if (!item || typeof item !== "object") return false;
    const title = (item as { title?: unknown }).title;
    return typeof title === "string" && title.length > 0;
  });
}

// ── Browserbase creds (service-role reads) ──────────────────────────────────

// LOCKSTEP: decodeSecret in src/lib/circleIntegrations.ts. Secrets are
// base64-obfuscated by the client (`btoa(unescape(encodeURIComponent(v)))`),
// NOT client-side-encrypted, so the service role can decode them here.
function decodeSecret(value: string): string {
  try {
    return decodeURIComponent(escape(atob(value)));
  } catch {
    try {
      return atob(value);
    } catch {
      return value;
    }
  }
}

/**
 * Service-role equivalent of src/lib/computerUseCreds.ts
 * `resolveComputerUseCreds`: `circle_integrations` row for provider
 * 'browserbase' (is_active, newest updated_at — mirrors
 * `getCircleIntegration`), then its `circle_integration_secrets` rows
 * (mirrors `getCircleIntegrationSecretValues`) decoded to api_key /
 * project_id / session_region.
 */
async function resolveBrowserbaseCreds(
  // deno-typecheck: force the `any` schema so table rows are not inferred
  // as `never` under supabase-js 2.95 strict generics (type-level only).
  supabase: ReturnType<typeof createClient<any>>,
  circleId: string,
): Promise<
  | { ok: true; creds: { apiKey: string; projectId: string; region?: string } }
  | { ok: false; reason: string }
> {
  const { data: integration, error: integrationError } = await supabase
    .from("circle_integrations")
    .select("id, status, is_active")
    .eq("circle_id", circleId)
    .eq("provider", "browserbase")
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (integrationError || !integration || integration.is_active === false || integration.status === "disabled") {
    return { ok: false, reason: "Browserbase is not connected for this circle. Add it in Marketplace → Browserbase." };
  }

  const { data: secretRows, error: secretsError } = await supabase
    .from("circle_integration_secrets")
    .select("key, value_encrypted")
    .eq("integration_id", integration.id);
  if (secretsError) {
    return { ok: false, reason: "Could not load Browserbase credentials for this circle." };
  }
  const secrets: Record<string, string> = {};
  for (const row of (secretRows || []) as Array<{ key: string; value_encrypted: string }>) {
    secrets[row.key] = decodeSecret(row.value_encrypted);
  }

  const apiKey = String(secrets.api_key || "").trim();
  const projectId = String(secrets.project_id || "").trim();
  const region = String(secrets.session_region || "").trim() || undefined;
  if (!apiKey || !projectId) {
    return { ok: false, reason: "Browserbase is connected but missing api_key or project_id. Edit the integration to add them." };
  }
  return { ok: true, creds: { apiKey, projectId, region } };
}

// ── computer-use-agent invocation (SSE consumer) ────────────────────────────

type AgentRunOutcome = {
  ok: boolean;
  summary: string;
  findings: FindingLike[] | null;
  errorMessage: string | null;
};

/**
 * POST the watch task to the computer-use-agent edge fn (service-role +
 * scheduledBy) and consume its SSE stream to completion. The agent's wire
 * format is `event: <name>\ndata: <json>\n\n`; we collect the `result`
 * payload ({summary, findings, extractedData, sessionId, liveUrl, tokens,
 * iterations, runId}) or the last `error` payload ({message}). A hard
 * wall-clock cap aborts the stream if the run hangs.
 */
async function runAgentTask(input: {
  supabaseUrl: string;
  serviceKey: string;
  task: string;
  circleId: string;
  scheduledBy: string | null;
  browserbase: { apiKey: string; projectId: string; region?: string };
}): Promise<AgentRunOutcome> {
  const controller = new AbortController();
  const wallClock = setTimeout(() => {
    try {
      controller.abort();
    } catch { /* already settled */ }
  }, RUN_WALL_CLOCK_MS);

  try {
    const res = await fetch(`${input.supabaseUrl}/functions/v1/computer-use-agent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.serviceKey}`,
      },
      body: JSON.stringify({
        task: input.task,
        circleId: input.circleId,
        scheduledBy: input.scheduledBy || undefined,
        browserbase: input.browserbase,
      }),
      signal: controller.signal,
    });

    const contentType = res.headers.get("content-type") || "";
    if (!res.ok || !contentType.includes("text/event-stream") || !res.body) {
      let message = `computer-use-agent responded ${res.status}`;
      try {
        const payload = await res.json();
        if (payload?.error) message = String(payload.error);
      } catch { /* non-JSON error body */ }
      return { ok: false, summary: "", findings: null, errorMessage: message };
    }

    // Parse `event:`/`data:` line pairs (the agent emits one-line JSON data).
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let eventName = "";
    let result: { summary?: unknown; findings?: unknown } | null = null;
    let lastError: string | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newlineAt = buffer.indexOf("\n");
      while (newlineAt >= 0) {
        const line = buffer.slice(0, newlineAt).replace(/\r$/, "");
        buffer = buffer.slice(newlineAt + 1);
        newlineAt = buffer.indexOf("\n");
        if (line.startsWith("event:")) {
          eventName = line.slice("event:".length).trim();
        } else if (line.startsWith("data:")) {
          try {
            const data = JSON.parse(line.slice("data:".length).trim());
            if (eventName === "result") {
              result = data;
            } else if (eventName === "error") {
              lastError = String((data as { message?: unknown })?.message || "Computer-use run failed.");
            }
          } catch { /* ignore malformed data lines */ }
        }
        // Blank lines are event boundaries; nothing to do.
      }
    }

    if (result) {
      const findings = Array.isArray(result.findings)
        ? (result.findings as unknown[]).filter((f): f is FindingLike =>
            Boolean(f) && typeof f === "object" && typeof (f as { title?: unknown }).title === "string")
        : null;
      return {
        ok: true,
        summary: String(result.summary || ""),
        findings,
        errorMessage: null,
      };
    }
    return {
      ok: false,
      summary: "",
      findings: null,
      errorMessage: lastError || "The run ended without a result.",
    };
  } catch (err) {
    const aborted = (err as { name?: string })?.name === "AbortError" || controller.signal.aborted;
    return {
      ok: false,
      summary: "",
      findings: null,
      errorMessage: aborted
        ? `Watch run timed out after ${Math.round(RUN_WALL_CLOCK_MS / 60_000)} minutes.`
        : String((err as Error)?.message || err),
    };
  } finally {
    clearTimeout(wallClock);
  }
}

// ── Chat notification ───────────────────────────────────────────────────────

type ScheduleDispatchAuthority =
  | { ok: true; threadId: string }
  | { ok: false; unavailable: boolean };

/**
 * Re-prove the schedule owner and exact destination under the service role.
 * A schedule row is historical intent, not durable authority: Circle or
 * private/shared-thread membership can be revoked between recurrences.
 */
async function resolveScheduleDispatchAuthority(
  supabase: ReturnType<typeof createClient<any>>,
  schedule: ScheduleRow,
): Promise<ScheduleDispatchAuthority> {
  if (!schedule.created_by) return { ok: false, unavailable: false };

  const { data: membership, error: membershipError } = await supabase
    .from("circle_members")
    .select("user_id")
    .eq("circle_id", schedule.circle_id)
    .eq("user_id", schedule.created_by)
    .maybeSingle();
  if (membershipError) return { ok: false, unavailable: true };
  if (!membership) return { ok: false, unavailable: false };

  let threadQuery = supabase
    .from("circle_chat_threads")
    .select("id,created_by,visibility")
    .eq("circle_id", schedule.circle_id)
    .eq("archived", false);
  threadQuery = schedule.thread_id
    ? threadQuery.eq("id", schedule.thread_id)
    : threadQuery.eq("visibility", "circle");
  const { data: thread, error: threadError } = await threadQuery.maybeSingle();
  if (threadError) return { ok: false, unavailable: true };
  if (!thread) return { ok: false, unavailable: false };

  if (thread.visibility === "circle" || thread.created_by === schedule.created_by) {
    return { ok: true, threadId: thread.id };
  }

  const { data: threadMembership, error: threadMembershipError } = await supabase
    .from("circle_chat_thread_members")
    .select("thread_id")
    .eq("thread_id", thread.id)
    .eq("user_id", schedule.created_by)
    .maybeSingle();
  if (threadMembershipError) return { ok: false, unavailable: true };
  return threadMembership
    ? { ok: true, threadId: thread.id }
    : { ok: false, unavailable: false };
}

async function deactivateRevokedSchedule(
  supabase: ReturnType<typeof createClient<any>>,
  scheduleId: string,
): Promise<void> {
  await supabase
    .from(SCHEDULES_TABLE)
    .update({
      active: false,
      last_diff_summary: "Watch paused because its Circle or Chat access changed.",
      updated_at: new Date().toISOString(),
    })
    .eq("id", scheduleId)
    .eq("active", true);
}

/**
 * Post the watch update as a bot message. Same insert shape the other
 * service-role posters use (automation-executor, github-webhook):
 * user_id null + is_bot true; thread_id targets the watch's thread (see
 * src/lib/chatService.ts `persistChatMessage` for the column set).
 * Best-effort — the schedule row is already re-stamped before this runs,
 * so a failed insert can never leave the watch due/hot-looping.
 */
async function postWatchMessage(
  // deno-typecheck: force the `any` schema so table rows are not inferred
  // as `never` under supabase-js 2.95 strict generics (type-level only).
  supabase: ReturnType<typeof createClient<any>>,
  schedule: ScheduleRow,
  content: string,
): Promise<"posted" | "scope_revoked" | "authority_unavailable" | "insert_failed"> {
  const authority = await resolveScheduleDispatchAuthority(supabase, schedule);
  if (!authority.ok) {
    if (!authority.unavailable) await deactivateRevokedSchedule(supabase, schedule.id);
    return authority.unavailable ? "authority_unavailable" : "scope_revoked";
  }
  try {
    const { error } = await supabase.from("messages").insert({
      circle_id: schedule.circle_id,
      content,
      is_bot: true,
      user_id: null,
      thread_id: authority.threadId,
    });
    if (error) {
      console.warn(`[watch-scheduler] message insert failed for schedule ${schedule.id}`);
      return "insert_failed";
    }
    return "posted";
  } catch (err) {
    console.warn(`[watch-scheduler] message insert failed for schedule ${schedule.id}`, {
      name: err instanceof Error ? err.name : typeof err,
    });
    return "insert_failed";
  }
}

// ── Per-schedule processing ─────────────────────────────────────────────────

async function processSchedule(
  // deno-typecheck: force the `any` schema so table rows are not inferred
  // as `never` under supabase-js 2.95 strict generics (type-level only).
  supabase: ReturnType<typeof createClient<any>>,
  env: { supabaseUrl: string; serviceKey: string },
  schedule: ScheduleRow,
): Promise<{ scheduleId: string; status: string }> {
  // a. CAS-claim the due row before doing ANYTHING else. LOCKSTEP:
  // `claimComputerTaskScheduleRun` in src/lib/computerTaskSchedules.ts —
  // conditional UPDATE that advances next_run_at only if it still holds the
  // value we just read; exactly 1 returned row = we won. The client runner
  // races on the same CAS, so first claimant wins and the loser skips.
  // The provisional value also acts as the hot-loop guard: even if this
  // process dies mid-run the watch is no longer due.
  const provisionalNextRunAtIso = computeNextRunAtIso(schedule.cadence, Date.now());
  const { data: claimRows, error: claimError } = await supabase
    .from(SCHEDULES_TABLE)
    .update({ next_run_at: provisionalNextRunAtIso, updated_at: new Date().toISOString() })
    .eq("id", schedule.id)
    .eq("next_run_at", schedule.next_run_at)
    .eq("active", true)
    .select("id");
  if (claimError || !Array.isArray(claimRows) || claimRows.length !== 1) {
    return { scheduleId: schedule.id, status: "claim_lost" };
  }

  // The due row proves only that a watch once existed. Re-check the current
  // user/Circle/private-thread relationship before decrypting either Circle
  // Browserbase credentials or the creator's personal model key.
  let dispatchAuthority = await resolveScheduleDispatchAuthority(supabase, schedule);
  if (!dispatchAuthority.ok) {
    if (!dispatchAuthority.unavailable) await deactivateRevokedSchedule(supabase, schedule.id);
    return {
      scheduleId: schedule.id,
      status: dispatchAuthority.unavailable ? "authority_unavailable" : "scope_revoked",
    };
  }
  schedule.thread_id = dispatchAuthority.threadId;

  // b. Resolve Browserbase creds for the schedule's circle. Missing creds →
  // failed-soft: stamp the skip reason and tell the thread. The claim above
  // already advanced next_run_at, so this posts at most once per cadence.
  const credsResult = await resolveBrowserbaseCreds(supabase, schedule.circle_id);
  if (!credsResult.ok) {
    console.warn(`[watch-scheduler] schedule ${schedule.id} skipped: ${credsResult.reason}`);
    try {
      await supabase
        .from(SCHEDULES_TABLE)
        .update({
          last_diff_summary: "Check skipped: Browserbase is not connected for this circle.",
          updated_at: new Date().toISOString(),
        })
        .eq("id", schedule.id);
    } catch { /* best-effort */ }
    const postStatus = await postWatchMessage(
      supabase,
      schedule,
      formatWatchUpdateMessage({
        task: schedule.task,
        diffSummary: null,
        runSummary: null,
        errorMessage: credsResult.reason,
      }),
    );
    if (postStatus === "scope_revoked" || postStatus === "authority_unavailable") {
      return { scheduleId: schedule.id, status: postStatus };
    }
    return { scheduleId: schedule.id, status: "skipped_no_creds" };
  }

  // c. Run the task through the normal computer-use pipeline and wait for
  // the stream to finish.
  dispatchAuthority = await resolveScheduleDispatchAuthority(supabase, schedule);
  if (!dispatchAuthority.ok) {
    if (!dispatchAuthority.unavailable) await deactivateRevokedSchedule(supabase, schedule.id);
    return {
      scheduleId: schedule.id,
      status: dispatchAuthority.unavailable ? "authority_unavailable" : "scope_revoked",
    };
  }
  schedule.thread_id = dispatchAuthority.threadId;
  const outcome = await runAgentTask({
    supabaseUrl: env.supabaseUrl,
    serviceKey: env.serviceKey,
    task: schedule.task,
    circleId: schedule.circle_id,
    scheduledBy: schedule.created_by,
    browserbase: credsResult.creds,
  });

  // d./e. Diff, then re-stamp the row from COMPLETION time BEFORE notifying
  // (a notify failure must never leave the watch due). This deliberately
  // overwrites the claim's provisional next_run_at — the cadence counts
  // from when the check finished. Mirrors the client runner
  // (src/lib/computerTaskScheduleRunner.ts) exactly.
  const now = Date.now();
  const nextRunAtIso = computeNextRunAtIso(schedule.cadence, now);
  const lastRunAtIso = new Date(now).toISOString();
  const previousFindings = coerceStoredFindings(schedule.last_findings);

  let diffSummary = "";
  let runSummary = "";
  let errorMessage: string | undefined;
  let hasChanges = false;

  if (outcome.ok) {
    const previousAgeMs = schedule.last_run_at
      ? Math.max(0, now - Date.parse(schedule.last_run_at))
      : null;
    const diff = diffFindings(previousFindings, outcome.findings);
    diffSummary = formatDiffSummary(diff, { previousAgeMs });
    runSummary = outcome.summary;
    hasChanges = diff.hasChanges;
    await supabase
      .from(SCHEDULES_TABLE)
      .update({
        last_run_at: lastRunAtIso,
        next_run_at: nextRunAtIso,
        last_findings: outcome.findings ?? null,
        last_diff_summary: diffSummary,
        updated_at: new Date().toISOString(),
      })
      .eq("id", schedule.id);
  } else {
    errorMessage = String(outcome.errorMessage || "Watch run failed.").slice(0, 400);
    // A failed run still advances next_run_at from completion time, and the
    // previous findings stay as baseline so the next diff is real.
    await supabase
      .from(SCHEDULES_TABLE)
      .update({
        last_run_at: lastRunAtIso,
        next_run_at: nextRunAtIso,
        last_findings: schedule.last_findings ?? null,
        last_diff_summary: `Check failed: ${errorMessage.slice(0, 160)}`,
        updated_at: new Date().toISOString(),
      })
      .eq("id", schedule.id);
  }

  // f. Notify policy — identical to the client runner: failed checks always
  // post; otherwise `always` posts every run and `changes_only` posts only
  // when the diff found something. No change + no error + changes_only →
  // NO message (that silence is the point of changes_only).
  const shouldNotify = Boolean(errorMessage) || schedule.notify_on === "always" || hasChanges;
  if (shouldNotify) {
    const postStatus = await postWatchMessage(
      supabase,
      schedule,
      formatWatchUpdateMessage({
        task: schedule.task,
        diffSummary,
        runSummary,
        errorMessage,
      }),
    );
    if (postStatus === "scope_revoked" || postStatus === "authority_unavailable") {
      return { scheduleId: schedule.id, status: postStatus };
    }
  }

  return { scheduleId: schedule.id, status: outcome.ok ? "completed" : "failed" };
}

// ── Request handler ─────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // 1. Only our own cron tick (or an operator with the service key) may
  // invoke this — it runs unattended browser tasks and posts to chat.
  if (!isServiceRoleRequest(req)) {
    return errResponse(401, "unauthorized", "watch-scheduler requires service-role authorization");
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ ok: false, error: "scheduler env not configured" }, 500);
  }
  const supabase = createClient<any>(supabaseUrl, serviceKey);

  // 2. Due watches across ALL circles, soonest first, bounded per tick
  // (MAX_SCHEDULES_PER_TICK — cost control; see the constant's comment).
  // Local folder watches are excluded IN THE QUERY (not just skipped in the
  // loop): they only run on the user's machine, so their next_run_at can sit
  // in the past for days while the app is closed — left in the result they
  // would permanently occupy the per-tick limit and starve real page
  // watches. LOCKSTEP: FOLDER_WATCH_TASK_PREFIX (folderWatchModel.ts).
  const nowIso = new Date().toISOString();
  const { data: dueRows, error: dueError } = await supabase
    .from(SCHEDULES_TABLE)
    .select("id, circle_id, created_by, task, cadence, notify_on, thread_id, active, last_run_at, last_findings, last_diff_summary, next_run_at")
    .eq("active", true)
    .lte("next_run_at", nowIso)
    .not("task", "ilike", `${FOLDER_WATCH_TASK_PREFIX}%`)
    .order("next_run_at", { ascending: true })
    .limit(MAX_SCHEDULES_PER_TICK);
  if (dueError) {
    // Pre-migration DB (table missing) or transient read failure — report
    // it, but as a clean no-op tick rather than a crash loop in pg_net logs.
    console.warn("[watch-scheduler] due-schedule read failed:", dueError.message);
    return jsonResponse({ ok: true, processed: 0, results: [], note: `due read failed: ${dueError.message}` });
  }

  // 3. Sequential on purpose — one browser run at a time keeps peak cost and
  // Browserbase session pressure flat. Each schedule is isolated in its own
  // try/catch: one bad watch never blocks the rest, and the CAS claim has
  // already advanced next_run_at, so even a crash here cannot hot-loop.
  const results: Array<{ scheduleId: string; status: string }> = [];
  for (const row of (dueRows || []) as ScheduleRow[]) {
    // Defense in depth behind the query filter above: NEVER claim or run a
    // local folder watch server-side — this scheduler has no path to the
    // user's disk; only the client runner + desktop bridge can execute it.
    // LOCKSTEP: FOLDER_WATCH_TASK_PREFIX in src/lib/folderWatchModel.ts.
    if (String(row.task || "").trim().toLowerCase().startsWith(FOLDER_WATCH_TASK_PREFIX)) {
      results.push({ scheduleId: row.id, status: "skipped_local_folder" });
      continue;
    }
    try {
      results.push(await processSchedule(supabase, { supabaseUrl, serviceKey }, row));
    } catch (err) {
      console.warn(`[watch-scheduler] schedule ${row.id} crashed:`, err);
      results.push({ scheduleId: row.id, status: "crashed" });
    }
  }

  // 4. Compact tick report (visible in pg_net's response table).
  return jsonResponse({ ok: true, processed: results.length, results });
});
