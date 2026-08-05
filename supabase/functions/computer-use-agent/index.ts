// computer-use-agent — autonomous browser/computer use via Anthropic's
// native computer_use tool, streamed back as SSE so the client can render
// the agent thinking + acting live (same pattern as Perplexity's
// Personal Computer feature).
//
// Flow:
//   1. Client POSTs { task, circleId, browserbase: {apiKey, projectId} }
//   2. Server opens a Browserbase session (or reuses one by sessionId).
//   3. Loop:
//        - Call a Claude computer-use capable model with conversation +
//          tool_result from previous turn.
//        - Claude returns either (a) a tool_use asking for a browser action,
//          or (b) a final text answer (stop_reason: 'end_turn').
//        - If tool_use: execute against Browserbase → capture screenshot +
//          current_url → emit SSE → feed back to Claude as tool_result.
//        - If end_turn: emit `result` SSE with the final answer + session
//          link, close stream.
//   4. Safety rails: max 12 iterations, 75k token budget, 5-minute wall
//      clock, per-action timeout.
//
// SSE protocol (outbound):
//   event: action      data: {"tool":"screenshot","input":{...}}
//   event: screenshot  data: {"b64":"...","url":"https://..."}
//   event: reasoning   data: {"text":"I'll search for..."}
//   event: result      data: {"summary":"Found 5 matches","url":"...","tokens":1234}
//   event: error       data: {"message":"..."}

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";
import {
  callClaude,
  computeCostUsd,
  addUsage,
  checkCircleClaudeBudget,
  logClaudeUsage,
  EMPTY_USAGE,
  type UsageBreakdown,
} from "../_claude/anthropic.ts";
import { byokMissingMessage, isServiceRoleRequest, resolveUserModelApiKey } from "../_shared/edge.ts";
// P61: shared stuck-loop machinery (same pure modules as both client loops —
// the zero-import core keeps Deno's strict resolution happy).
import { detectRepeatedToolFailure, hashToolInput } from "../../../src/lib/toolLoopStuckCore.ts";
import { buildSolverConsultationMessage, previewToolInput, shouldConsultSolver } from "../../../src/lib/toolLoopSolver.ts";
import {
  resolveRunCaps,
  HARD_MAX_ITERATIONS,
  HARD_MAX_TOKENS,
  PAY_CONFIRM_TIMEOUT_MS,
  DEFAULT_ASK_TIMEOUT_MS,
  detectFinalPaySubmission,
  isPayConfirmQuestion,
} from "../_shared/booking-edge-contract.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Anthropic currently exposes native computer use on Sonnet-class models.
// Do not route this through Opus/Haiku: those can reject the computer tool.
const DEFAULT_AGENT_MODEL = "claude-sonnet-4-6";

function resolveComputerUseModel(model?: string | null): string {
  const raw = String(model || "").trim();
  if (!raw) return DEFAULT_AGENT_MODEL;
  const normalized = raw.startsWith("anthropic/") ? raw.slice("anthropic/".length) : raw;
  return /^claude-.*sonnet/i.test(normalized) ? normalized : DEFAULT_AGENT_MODEL;
}

// Anthropic's computer-use tool spec. The viewport is a reasonable
// middle-ground — matches what Browserbase ships by default.
//
// TODO(zoom / E3): `computer_20251124` (+ beta header "computer-use-2025-11-24"
// + `enable_zoom: true`) adds the `zoom` action — region re-screenshot at full
// resolution, Anthropic's prescribed fix for missed small targets. The default
// model (claude-sonnet-4-6) supports it, but the upgrade is NOT contained here:
//   1. `resolveComputerUseModel` accepts ANY Sonnet-family model (e.g.
//      claude-sonnet-4-5), and computer_20251124 only works on Opus 4.5+ /
//      Sonnet 4.6 — the tool version + beta header would have to become
//      model-conditional (per-request tool array instead of this const).
//   2. The zoom action sends `{ action: "zoom", region: [x1, y1, x2, y2] }`
//      and the client must return a cropped, full-resolution screenshot of
//      that region. Our Browserbase command bridge (`bbCommand` →
//      /v1/sessions/{id}/commands) only exposes full-viewport `screenshot`
//      with no clip/region parameter, so honoring zoom needs either a
//      Browserbase clip param (unverified) or PNG decode/crop/encode inside
//      this edge function (new image dependency). Returning the full
//      screenshot for a zoom call would be silently wrong (the model would
//      treat it as the zoomed region), so do not fake it.
// docs/EXECUTION_LADDER_RESEARCH_2026-06-11.md, finding #5 / E3.
const COMPUTER_USE_TOOL = {
  type: "computer_20250124",
  name: "computer",
  display_width_px: 1280,
  display_height_px: 800,
  display_number: 1,
};

// ── Screenshot-history pruning (E5) ─────────────────────────────────────
// Anthropic guidance: screenshots cost ~1,000–1,800 input tokens each, so
// keep only the last few in model context — but prune in byte-identical
// BATCHES. Replacing one old screenshot per turn would rewrite the message
// prefix on every call, shifting the prompt-cache prefix every turn and
// defeating caching entirely. Instead we let screenshots accumulate until
// the count exceeds PRUNE_HIGH_WATER, then collapse everything except the
// newest KEEP_RECENT in ONE pass. Between prunes the already-pruned
// placeholders stay byte-identical, so the prefix is stable and cache reads
// keep hitting; each batch prune pays one cache re-create from the earliest
// pruned block, amortized over the next ~(PRUNE_HIGH_WATER - KEEP_RECENT)
// turns. See docs/EXECUTION_LADDER_RESEARCH_2026-06-11.md (finding #5, E5).
// Mid-run steering (plan §4e) — kept in LOCKSTEP with the client owner
// `src/lib/computerUseSteering.ts` (marker, bound, and the guidance-only
// framing). Steering rows live in computer_use_confirmations as
// pre-resolved rows so no schema change is needed; ask_user polling reads
// rows by its own id, so the two never collide.
const STEERING_QUESTION_MARKER = "__steering__";
const MAX_STEERING_NOTE_CHARS = 500;
function formatSteeringNoteForModel(note: string): string {
  return [
    "[User steering note — live guidance for your next steps. This is NOT an approval,",
    "confirmation, or consent to any consequential action; anything that needs",
    "confirmation still goes through ask_user.]",
    String(note || "").trim(),
  ].join("\n");
}

async function handleSteeringRequest(
  req: Request,
  steer: { runId?: string; note?: string },
): Promise<Response> {
  const json = (status: number, payload: unknown) => new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
  const svcUrl = Deno.env.get("SUPABASE_URL");
  const svcKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const authorization = req.headers.get("Authorization") || "";
  const service = svcUrl && svcKey ? createClient(svcUrl, svcKey) : null;
  const userClient = svcUrl && anonKey && authorization
    ? createClient(svcUrl, anonKey, { global: { headers: { Authorization: authorization } } })
    : null;
  if (!service || !userClient) return json(500, { ok: false, error: "Supabase service configuration required" });

  const { data: { user } } = await userClient.auth.getUser();
  if (!user?.id) return json(401, { ok: false, error: "Unauthenticated", code: "unauthenticated" });

  const runId = String(steer.runId || "").trim();
  const note = String(steer.note || "").replace(/\s+/g, " ").trim().slice(0, MAX_STEERING_NOTE_CHARS);
  if (!runId || !note) return json(400, { ok: false, error: "runId and note required" });

  // Membership check rides the runs RLS read policy — the row is only
  // visible to the caller when they are a member of the run's circle.
  const { data: run } = await userClient
    .from("computer_use_runs")
    .select("id, status")
    .eq("id", runId)
    .maybeSingle();
  if (!run) return json(404, { ok: false, error: "Run not found (or you are not a circle member)." });
  if (String(run.status) !== "running") {
    return json(409, { ok: false, error: "That task is no longer running.", code: "not_running" });
  }

  const { error } = await service.from("computer_use_confirmations").insert({
    run_id: runId,
    question: STEERING_QUESTION_MARKER,
    options: [],
    context: "steering",
    choice: note,
    user_id: user.id,
    resolved_at: new Date().toISOString(),
  });
  if (error) return json(500, { ok: false, error: error.message });
  return json(200, { ok: true });
}

const PRUNE_HIGH_WATER = 8; // prune only once history holds more screenshots than this
const KEEP_RECENT = 3;      // always keep the newest N screenshots intact

// Placeholders must be deterministic so a pruned block never changes bytes
// on later passes. "step" is the screenshot's ordinal across the whole run
// (already-pruned placeholders are counted too so numbering stays true).
const PRUNED_PLACEHOLDER_RE = /^\[screenshot from step \d+ pruned/;
const prunedPlaceholder = (step: number) =>
  `[screenshot from step ${step} pruned — re-screenshot if you need this state]`;

/** Replace all but the newest KEEP_RECENT screenshot image blocks with text
 *  placeholders, in one batch, only when the count exceeds PRUNE_HIGH_WATER.
 *  Mutates `messages` in place. tool_use/tool_result pairing is never split:
 *  only the image content block INSIDE a tool_result is swapped for a text
 *  block, so the tool_result stays valid. Returns how many were pruned. */
function pruneScreenshotHistory(messages: Array<{ role: string; content: any }>): number {
  const images: Array<{ blocks: any[]; index: number; step: number }> = [];
  let step = 0;
  for (const msg of messages) {
    if (msg.role !== "user" || !Array.isArray(msg.content)) continue;
    for (const part of msg.content) {
      if (part?.type !== "tool_result" || !Array.isArray(part.content)) continue;
      for (let i = 0; i < part.content.length; i++) {
        const block = part.content[i];
        if (block?.type === "image") {
          step += 1;
          images.push({ blocks: part.content, index: i, step });
        } else if (block?.type === "text" && PRUNED_PLACEHOLDER_RE.test(String(block.text || ""))) {
          step += 1; // keep ordinals stable across previous prunes
        }
      }
    }
  }
  if (images.length <= PRUNE_HIGH_WATER) return 0;
  const toPrune = images.slice(0, images.length - KEEP_RECENT);
  for (const { blocks, index, step: n } of toPrune) {
    blocks[index] = { type: "text", text: prunedPlaceholder(n) };
  }
  return toPrune.length;
}

// Basic bash tool so the agent can think out loud or do small shell tasks
// inside the Browserbase container (rare but useful for file downloads).
const BASH_TOOL = {
  type: "bash_20250124",
  name: "bash",
};

// Custom `ask_user` tool — Claude calls it before taking any action the
// system prompt flagged as risky (purchases, submissions, credential
// entry, anything irreversible). The edge function inserts a row in
// `computer_use_confirmations`, emits an SSE event, and polls the row
// until the user picks an option (or a timeout). This is the stop-and-
// confirm flow without needing a second transport channel.
const ASK_USER_TOOL = {
  name: "ask_user",
  description:
    "Pause for a user question or human-only checkpoint. Use kind 'human_takeover' " +
    "for 2FA, CAPTCHA, payment-card entry, or another step the user must perform " +
    "in the live browser. Saved-credential use and every native browser mutation " +
    "are independently gated by the edge runtime; an answer to this tool never " +
    "authorizes a later or different click, typing, keyboard, or credential call. " +
    "Never include a password, token, payment-card value, or text intended for a " +
    "form field in the question/context. The tool returns the user's choice.",
  input_schema: {
    type: "object",
    properties: {
      question: {
        type: "string",
        description:
          "The specific question to ask the user, e.g. 'Confirm purchase of $2,499.00 " +
          "to Amazon for the Sony A7IV camera?' — include the amount and merchant where possible.",
      },
      options: {
        type: "array",
        description:
          "Choices to offer. Defaults to ['Yes, continue', 'No, cancel'] when omitted. " +
          "Keep labels short (<30 chars).",
        items: { type: "string" },
      },
      context: {
        type: "string",
        description:
          "Optional one-line context — what page you're on, what you're about to do.",
      },
      kind: {
        type: "string",
        enum: ["confirm", "human_takeover"],
        description:
          "Use 'human_takeover' when the user must DO something in the live session view " +
          "(2FA code, CAPTCHA, human-only login step) rather than just approve. Takeover " +
          "asks get a longer wait (5 minutes) and the wait does not count against the " +
          "task's time budget. Default 'confirm'.",
      },
    },
    required: ["question"],
  },
};

const FILL_SAVED_LOGIN_TOOL = {
  name: "fill_saved_login",
  description:
    "Request one saved-vault login fill. The edge itself will show the user " +
    "an exact one-call approval before any browser mutation, so do not call " +
    "ask_user separately for this tool. " +
    "Use this only after navigating to the site's login page and focusing the username/email field. " +
    "This tool never returns the secret. It types the username and secret directly into the browser.",
  input_schema: {
    type: "object",
    properties: {
      credential_id: {
        type: "string",
        description: "The saved vault credential id to use.",
      },
      purpose: {
        type: "string",
        description: "Short reason for using the credential, e.g. 'log in to publish a draft post'.",
      },
      grantee: {
        type: "string",
        description: "Automation grantee from the vault runbook, e.g. OpenSwan or a named agent.",
      },
      grantee_type: {
        type: "string",
        enum: ["agent", "runtime", "chat", "member", "openswan"],
        description: "Automation grantee type from the vault runbook. Defaults to openswan when omitted.",
      },
      username_coordinate: {
        type: "array",
        description: "Optional [x, y] coordinate for the username/email field. If omitted, the current focus is used.",
        items: { type: "number" },
      },
      password_coordinate: {
        type: "array",
        description: "Optional [x, y] coordinate for the password field. If omitted, Tab is used after typing username.",
        items: { type: "number" },
      },
      submit: {
        type: "boolean",
        description: "Whether to press Enter after filling. Defaults to false; prefer false unless the user approved login.",
      },
    },
    required: ["credential_id", "purpose"],
  },
};

const COMPUTER_USE_POLICY_SCHEMA_VERSION = 1;
const POLICY_CONSTRAINT_LIMIT = 8;
const POLICY_CONSTRAINT_CHAR_LIMIT = 160;
const PRE_RUN_GRANT_MAX_MS = 30 * 60 * 1000;
const ALWAYS_CONFIRM_CATEGORIES = new Set([
  "browser_mutation",
  "opaque_target",
  "credentials",
  "external_side_effect",
]);

type ComputerUseExecutionMode = "interactive" | "scheduled_observation";
type ComputerUsePolicySource = "chat" | "queue" | "watch" | "service_watch";

interface ComputerUsePreRunBrowserPermission {
  kind: "explicit_user_grant";
  grantId: string;
  scope: "low_consequence_browser";
  issuedAt: string;
  expiresAt: string;
}

interface ComputerUsePolicyEnvelope {
  schemaVersion: 1;
  executionMode: ComputerUseExecutionMode;
  source: ComputerUsePolicySource;
  userConstraints: string[];
  alwaysConfirmCategories: string[];
  preRunBrowserPermission?: ComputerUsePreRunBrowserPermission;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function forcedScheduledPolicy(): ComputerUsePolicyEnvelope {
  return {
    schemaVersion: 1,
    executionMode: "scheduled_observation",
    source: "service_watch",
    userConstraints: ["Observe and report only; do not change browser or application data."],
    alwaysConfirmCategories: [
      "browser_mutation",
      "opaque_target",
      "credentials",
      "external_side_effect",
    ],
  };
}

/**
 * Validate the caller policy before opening a Browserbase session.
 *
 * Service-role watch calls are forced into the most restrictive policy even
 * when an older scheduler omits the envelope. All user-authenticated calls
 * must carry a complete v1 envelope; a missing/malformed envelope is a 400,
 * never implicit mutation authority.
 */
function validateComputerUsePolicyEnvelope(
  raw: unknown,
  forceScheduled: boolean,
  nowMs = Date.now(),
): { ok: true; policy: ComputerUsePolicyEnvelope } | { ok: false; error: string } {
  if (forceScheduled) return { ok: true, policy: forcedScheduledPolicy() };
  if (!isRecord(raw)) return { ok: false, error: "computer_use_policy_required" };
  if (raw.schemaVersion !== COMPUTER_USE_POLICY_SCHEMA_VERSION) {
    return { ok: false, error: "computer_use_policy_version_invalid" };
  }
  const executionMode = raw.executionMode;
  const source = raw.source;
  const validModeAndSource =
    (executionMode === "interactive" && (source === "chat" || source === "queue"))
    || (executionMode === "scheduled_observation" && source === "watch");
  if (!validModeAndSource) return { ok: false, error: "computer_use_policy_mode_invalid" };

  if (!Array.isArray(raw.userConstraints) || raw.userConstraints.length > POLICY_CONSTRAINT_LIMIT) {
    return { ok: false, error: "computer_use_policy_constraints_invalid" };
  }
  const userConstraints: string[] = [];
  for (const constraint of raw.userConstraints) {
    if (typeof constraint !== "string") {
      return { ok: false, error: "computer_use_policy_constraints_invalid" };
    }
    const bounded = constraint.replace(/\s+/g, " ").trim();
    if (!bounded || bounded.length > POLICY_CONSTRAINT_CHAR_LIMIT || userConstraints.includes(bounded)) {
      return { ok: false, error: "computer_use_policy_constraints_invalid" };
    }
    userConstraints.push(bounded);
  }

  if (!Array.isArray(raw.alwaysConfirmCategories) || raw.alwaysConfirmCategories.length > 4) {
    return { ok: false, error: "computer_use_policy_confirm_categories_invalid" };
  }
  const alwaysConfirmCategories: string[] = [];
  for (const category of raw.alwaysConfirmCategories) {
    if (typeof category !== "string"
      || !ALWAYS_CONFIRM_CATEGORIES.has(category)
      || alwaysConfirmCategories.includes(category)) {
      return { ok: false, error: "computer_use_policy_confirm_categories_invalid" };
    }
    alwaysConfirmCategories.push(category);
  }

  let preRunBrowserPermission: ComputerUsePreRunBrowserPermission | undefined;
  if (raw.preRunBrowserPermission !== undefined) {
    const grant = raw.preRunBrowserPermission;
    if (!isRecord(grant)) return { ok: false, error: "computer_use_pre_run_permission_invalid" };
    const grantId = typeof grant.grantId === "string" ? grant.grantId.trim() : "";
    const issuedAt = typeof grant.issuedAt === "string" ? Date.parse(grant.issuedAt) : NaN;
    const expiresAt = typeof grant.expiresAt === "string" ? Date.parse(grant.expiresAt) : NaN;
    if (
      grant.kind !== "explicit_user_grant"
      || grant.scope !== "low_consequence_browser"
      || grantId.length < 8
      || grantId.length > 128
      || !Number.isFinite(issuedAt)
      || !Number.isFinite(expiresAt)
      || issuedAt > nowMs + 60_000
      || expiresAt <= nowMs
      || expiresAt - issuedAt <= 0
      || expiresAt - issuedAt > PRE_RUN_GRANT_MAX_MS
    ) {
      return { ok: false, error: "computer_use_pre_run_permission_invalid" };
    }
    preRunBrowserPermission = {
      kind: "explicit_user_grant",
      grantId,
      scope: "low_consequence_browser",
      issuedAt: String(grant.issuedAt),
      expiresAt: String(grant.expiresAt),
    };
  }

  return {
    ok: true,
    policy: {
      schemaVersion: 1,
      executionMode: executionMode as ComputerUseExecutionMode,
      source: source as ComputerUsePolicySource,
      userConstraints,
      alwaysConfirmCategories,
      ...(preRunBrowserPermission ? { preRunBrowserPermission } : {}),
    },
  };
}

type NativeComputerActionClass =
  | { kind: "observation_navigation"; action: string }
  | { kind: "mutation"; action: string; opaqueTarget: true }
  | { kind: "unknown_mutation"; action: string };

function classifyNativeComputerAction(input: unknown): NativeComputerActionClass {
  const action = isRecord(input) && typeof input.action === "string"
    ? input.action.trim().toLowerCase()
    : "";
  if (["screenshot", "wait", "mouse_move", "scroll"].includes(action)) {
    return { kind: "observation_navigation", action };
  }
  if (["left_click", "right_click", "double_click", "type", "key"].includes(action)) {
    // Anthropic's current native schema gives coordinates/current focus, not
    // a trusted semantic locator. Treat every target as opaque.
    return { kind: "mutation", action, opaqueTarget: true };
  }
  return { kind: "unknown_mutation", action: action || "(missing)" };
}

function redactToolInputForTelemetry(tool: string, input: unknown): unknown {
  if (!isRecord(input)) return {};
  if (tool === "computer") {
    const action = typeof input.action === "string" ? input.action : "(missing)";
    if (action === "type" || action === "key") {
      return {
        action,
        text: "[redacted]",
      };
    }
    const out: Record<string, unknown> = { action };
    if (Array.isArray(input.coordinate)) {
      out.coordinate = input.coordinate.slice(0, 2).map((value) =>
        typeof value === "number" && Number.isFinite(value) ? value : null);
    }
    if (typeof input.scroll_direction === "string") out.scroll_direction = input.scroll_direction.slice(0, 16);
    if (typeof input.duration === "number" && Number.isFinite(input.duration)) out.duration = input.duration;
    return out;
  }
  if (tool === "fill_saved_login") {
    return { credential: "[redacted]", purpose: "[redacted]", submit: input.submit === true };
  }
  if (tool === "ask_user") {
    return {
      kind: input.kind === "human_takeover" ? "human_takeover" : "confirm",
      question: "[confirmation text omitted from telemetry]",
    };
  }
  return {};
}

function scrubSensitiveToolUseForHistory(toolUse: any): void {
  const tool = typeof toolUse?.name === "string" ? toolUse.name : "";
  if (tool === "fill_saved_login" || tool === "ask_user") {
    toolUse.input = redactToolInputForTelemetry(tool, toolUse?.input);
    return;
  }
  if (tool === "computer") {
    const action = classifyNativeComputerAction(toolUse?.input).action;
    if (action === "type" || action === "key") {
      toolUse.input = redactToolInputForTelemetry(tool, toolUse?.input);
    }
  }
}

function buildExactMutationConfirmation(
  action: NativeComputerActionClass & { kind: "mutation" },
  input: unknown,
  payOrBookingCommit: boolean,
): { question: string; context: string } {
  const record = isRecord(input) ? input : {};
  const coordinate = Array.isArray(record.coordinate)
    && record.coordinate.length >= 2
    && record.coordinate.slice(0, 2).every((value) => typeof value === "number" && Number.isFinite(value))
    ? ` at screen coordinates (${record.coordinate[0]}, ${record.coordinate[1]})`
    : " at an unspecified screen location";
  let detail: string;
  switch (action.action) {
    case "left_click":
      detail = `one left click${coordinate}`;
      break;
    case "right_click":
      detail = `one right click${coordinate}`;
      break;
    case "double_click":
      detail = `one double click${coordinate}`;
      break;
    case "type": {
      detail = "one typing action (contents hidden) in the currently focused field";
      break;
    }
    default:
      detail = "one keyboard action (key details hidden) at the current focus";
      break;
  }
  const consequence = payOrBookingCommit ? " This may commit a payment or binding booking." : "";
  return {
    question: `Allow ${detail}?${consequence}`,
    context:
      "This approval is for this exact call only. The target is coordinate/focus based, so its semantic identity cannot be proven; approval will not carry forward.",
  };
}

function canRunMutationWithoutLiveConfirmation(
  policy: ComputerUsePolicyEnvelope,
  action: NativeComputerActionClass & { kind: "mutation" },
): boolean {
  // A pre-run permission is necessary but never sufficient. Native Computer
  // Use mutations are all opaque today, and user constraints/always-confirm
  // floors cannot be interpreted by the model as permission to bypass this.
  if (!policy.preRunBrowserPermission) return false;
  if (policy.userConstraints.length > 0 || policy.alwaysConfirmCategories.length > 0) return false;
  if (action.opaqueTarget) return false;
  return true;
}

function isAffirmativeChoice(choice: string): boolean {
  return /^(yes|y|continue|done|approve|approved|ok|okay|use|log in)/i.test(String(choice || "").trim());
}

function resolveAllowedConfirmationChoice(
  storedChoice: string,
  options: string[],
): string | null {
  const exact = options.find((option) => option === storedChoice);
  if (exact) return exact;
  if (isAffirmativeChoice(storedChoice)) {
    return options.find((option) => isAffirmativeChoice(option)) || null;
  }
  if (/^(n|no|nope|cancel|stop|decline|reject|not now)\b/i.test(storedChoice.trim())) {
    return options.find((option) =>
      /^(n|no|cancel|stop|decline|reject)\b/i.test(option.trim())) || null;
  }
  return null;
}

function validateNativeMutationInput(
  action: NativeComputerActionClass & { kind: "mutation" },
  input: unknown,
): string | null {
  const record = isRecord(input) ? input : {};
  if (["left_click", "right_click", "double_click"].includes(action.action)) {
    const coordinate = record.coordinate;
    if (!Array.isArray(coordinate)
      || coordinate.length !== 2
      || !coordinate.every((value) => typeof value === "number" && Number.isFinite(value))
      || coordinate[0] < 0
      || coordinate[0] >= 1280
      || coordinate[1] < 0
      || coordinate[1] >= 800) {
      return "click_coordinate_invalid";
    }
    return null;
  }
  if (typeof record.text !== "string") return "keyboard_text_invalid";
  if (record.text.length > 10_000) return "keyboard_text_too_large";
  return null;
}

interface AgentRequest {
  task: string;
  circleId: string;
  userId?: string;
  /** Mid-run steering (plan §4e): when present, the request is a steering
   *  note for an in-flight run (handled by handleSteeringRequest), not a
   *  new task. `runId` targets the run; `note` is the user's nudge. */
  steer?: { runId?: string; note?: string };
  /** Optional: resume an existing Browserbase session. */
  sessionId?: string;
  /** Credentials for Browserbase. Caller pulls these from circle
   *  integrations + passes through. */
  browserbase: {
    apiKey: string;
    projectId: string;
    region?: string;
  };
  /** Max iterations. Defaults to 12. */
  maxIterations?: number;
  /** Max tokens budget. Defaults to 75_000. */
  maxTokensBudget?: number;
  /** Optional selected model. Non-computer-use-capable choices fall back
   *  to the supported Sonnet computer-use model for this native loop. */
  model?: string | null;
  /** Max USD cost for this task. Aborts the run gracefully if the
   *  estimated cost would exceed this. Defaults to the circle's
   *  `computer_use_max_cost_usd` setting, else $0.75. */
  maxCostUsd?: number;
  /** Booking-class flag. When true, run caps default to the raised
   *  booking-class ceiling (more iterations/tokens/cost/wall-clock) so a
   *  multi-leg checkout flow can complete. Non-booking runs are unchanged. */
  booking?: boolean;
  /** Phase 7a (server-side watch scheduler): the watch schedule's
   *  `created_by` user id. Honored ONLY when the request carries the
   *  service-role key — see the scheduled-path check in the handler. */
  scheduledBy?: string;
  /** Required for user-authenticated runs. Service watch calls are always
   *  forced to scheduled_observation, including legacy callers that omit it. */
  policy?: unknown;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let body: AgentRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ── Mid-run steering action (plan §4e) ──────────────────────────────────
  // {steer: {runId, note}} — records a guidance note the running loop
  // injects at its next iteration boundary. Server-mediated because
  // clients have SELECT/UPDATE but no INSERT policy on
  // computer_use_confirmations; membership is proven by reading the run
  // through the caller's own RLS before the service-role insert.
  if (body.steer && typeof body.steer === "object") {
    return await handleSteeringRequest(req, body.steer as { runId?: string; note?: string });
  }

  if (!body.task || !body.browserbase?.apiKey) {
    return new Response(JSON.stringify({ error: "task and browserbase credentials required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Service-role Supabase client for persistence + follow-up-context reads.
  const svcUrl = Deno.env.get("SUPABASE_URL");
  const svcKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = svcUrl && svcKey ? createClient(svcUrl, svcKey) : null;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const authorization = req.headers.get("Authorization") || "";
  const userSupabase = svcUrl && anonKey && authorization
    ? createClient(svcUrl, anonKey, {
        global: { headers: { Authorization: authorization } },
      })
    : null;
  if (!supabase || !userSupabase) {
    return new Response(JSON.stringify({ error: "Supabase service configuration required" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Scheduled path (Phase 7a): the server-side watch-scheduler edge fn —
  // our own cron infrastructure — calls this function with the service-role
  // key and the watch schedule's `created_by` in body.scheduledBy. End users
  // never hold the service key, so trusting scheduledBy here does not let a
  // user impersonate anyone. The user-JWT requirement is skipped and the
  // schedule owner becomes `userId`, meaning resolveUserModelApiKey below
  // resolves THEIR Anthropic key. Everything else (creds required in body,
  // loop, budget rails) is unchanged.
  const scheduledBy = typeof body.scheduledBy === "string" ? body.scheduledBy.trim() : "";
  let userId: string | null = null;
  if (scheduledBy && isServiceRoleRequest(req)) {
    userId = scheduledBy;
  } else {
    const { data: { user } } = await userSupabase.auth.getUser();
    userId = user?.id || null;
  }
  if (!userId) {
    return new Response(JSON.stringify({ error: "Unauthenticated", code: "unauthenticated" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Cross-circle IDOR guard: the reads below are keyed on body.circleId via the
  // service-role client (RLS bypassed). A verified caller must be a MEMBER of
  // that circle. The scheduled service-role path (trusted internal caller) is
  // exempt. Service-role + explicit (circle_id, user_id) equality checks the
  // VERIFIED user's own membership and avoids the circle_members RLS recursion.
  const isScheduledServiceCall = Boolean(scheduledBy) && isServiceRoleRequest(req);
  const policyResult = validateComputerUsePolicyEnvelope(body.policy, isScheduledServiceCall);
  if (!policyResult.ok) {
    return new Response(
      JSON.stringify({
        error: "A valid Computer Use policy envelope is required.",
        code: policyResult.error,
      }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
  const executionPolicy = policyResult.policy;
  if (!isScheduledServiceCall && supabase && body.circleId) {
    const { data: membership } = await supabase
      .from("circle_members")
      .select("circle_id")
      .eq("circle_id", body.circleId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!membership) {
      return new Response(
        JSON.stringify({ error: "Not a member of this circle", code: "forbidden" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
  }

  const apiKey = await resolveUserModelApiKey({
    supabase,
    userId,
    provider: "anthropic",
    envVarName: "ANTHROPIC_API_KEY",
  });
  if (!apiKey) {
    return new Response(JSON.stringify({ error: byokMissingMessage("anthropic"), code: "key_missing" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Guided replay (D7c): if this exact task succeeded before (recipes and
  // schedules re-run verbatim task text), fetch the proven action sequence
  // so the agent follows it instead of re-exploring. Long window — weekly
  // schedules must still match. Tolerant of a pre-migration DB (column
  // missing → query errors → no replay, never a failure).
  const normalizeTaskForReplay = (value: string) => String(value || "")
    .toLowerCase()
    .replace(/^run this computer task exactly as written:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  let replayBlock = "";
  if (supabase && body.circleId) {
    try {
      const since = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from("computer_use_runs")
        .select("task, action_trace, completed_at")
        .eq("circle_id", body.circleId)
        .eq("status", "done")
        .not("action_trace", "is", null)
        .gte("completed_at", since)
        .order("completed_at", { ascending: false })
        .limit(5);
      const wanted = normalizeTaskForReplay(body.task);
      const prior = (data || []).find((row: any) =>
        wanted && normalizeTaskForReplay(row.task) === wanted && Array.isArray(row.action_trace) && row.action_trace.length > 0);
      if (prior) {
        const steps = (prior.action_trace as Array<{ tool: string; input: unknown }>)
          // Historical traces may predate telemetry redaction. Never copy
          // typed text, key material, or credential calls back into a prompt.
          .filter((a) => {
            if (a.tool === "fill_saved_login") return false;
            if (a.tool !== "computer") return true;
            const classified = classifyNativeComputerAction(a.input);
            return classified.kind !== "unknown_mutation"
              && classified.action !== "type"
              && classified.action !== "key";
          })
          .slice(0, 40)
          .map((a, i) => `${i + 1}. ${a.tool}(${JSON.stringify(redactToolInputForTelemetry(a.tool, a.input)).slice(0, 200)})`)
          .join("\n");
        if (steps) {
          replayBlock = `PROVEN ACTION SEQUENCE — this exact task succeeded before (${String(prior.completed_at).slice(0, 10)}). Follow it step by step instead of re-exploring:\n${steps}\n\nReplay rules: before each action, confirm the visible state still matches what the step expects; if it doesn't, STOP following the script at that point and re-ground normally (observe, then act). Every mutation still requires the runtime's current approval policy; a prior trace is never consent. Skip exploration the script already answers.`;
        }
      }
    } catch { /* replay is an optimization — never block the run */ }
  }

  // Pull the most recent completed run for this circle to inject as
  // follow-up context. Caps the window at 30 minutes so day-old tasks
  // don't bleed into unrelated sessions.
  let followUpContext = "";
  if (supabase && body.circleId) {
    try {
      const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      // Include stopped-early runs (D8 writes a partial-progress summary on
      // status "error") so a resume run knows what was already done instead
      // of restarting blind. Runs without a summary are skipped either way.
      const { data } = await supabase
        .from("computer_use_runs")
        .select("task, summary, findings, status")
        .eq("circle_id", body.circleId)
        .in("status", ["done", "error"])
        .not("summary", "is", null)
        .gte("completed_at", since)
        .order("completed_at", { ascending: false })
        .limit(1);
      const prev = data?.[0];
      if (prev?.summary) {
        const findingsBlurb = Array.isArray(prev.findings) && prev.findings.length
          ? `\nKey items from that run:\n${(prev.findings as any[])
              .slice(0, 5)
              .map((f: any, i: number) => `${i + 1}. ${f.title || "(untitled)"}${f.url ? ` — ${f.url}` : ""}${f.price ? ` (${f.price})` : ""}`)
              .join("\n")}`
          : "";
        const wasPartial = prev.status === "error";
        followUpContext = wasPartial
          ? `Your previous task in this circle stopped early:\n"${prev.task}"\n\nProgress before it stopped:\n${String(prev.summary).slice(0, 1200)}${findingsBlurb}\n\nIf the user's new task is a resume/continue of that work, pick up AFTER the completed actions above — do not redo them. If it's unrelated, ignore it.`
          : `Your previous task in this circle:\n"${prev.task}"\n\nWhat you found:\n${String(prev.summary).slice(0, 1200)}${findingsBlurb}\n\nIf the user's new task is a follow-up ("tell me more about #3", "continue", "the cheapest one"), leverage that context. If it's unrelated, ignore it.`;
      }
    } catch { /* follow-up context is a nice-to-have; never block the run */ }
  }

  // Available saved-login inventory (cross-dashboard wiring): the model can
  // only call fill_saved_login with a credential_id it knows exists. Without
  // this block a login wall dead-ended on ask_user even when the vault held a
  // matching credential. We list the circle's site credentials (the RPC
  // returns NO secrets — only id/platform/label/site/username/allowed-actions)
  // through the CALLER's client so RLS applies, and surface only entries whose
  // allowed_actions include "login". The secret is still revealed server-side
  // inside fill_saved_login and never enters the model context.
  let credentialInventory = "";
  if (userSupabase && body.circleId) {
    try {
      const { data: creds } = await userSupabase.rpc("list_circle_site_credentials", {
        p_circle_id: body.circleId,
      });
      const loginable = (Array.isArray(creds) ? creds : [])
        .filter((c: any) => {
          const actions = Array.isArray(c?.allowed_actions) ? c.allowed_actions.map((a: any) => String(a).toLowerCase()) : [];
          return actions.length === 0 || actions.includes("login");
        })
        .slice(0, 12);
      if (loginable.length > 0) {
        const lines = loginable.map((c: any) => {
          const origins = Array.isArray(c?.allowed_origins) && c.allowed_origins.length
            ? ` [origins: ${c.allowed_origins.slice(0, 3).join(", ")}]`
            : (c?.site_url ? ` [site: ${c.site_url}]` : "");
          return `- credential_id="${c.id}" — ${c.platform || "site"}/${c.label || "login"}${origins}`;
        }).join("\n");
        credentialInventory = `SAVED LOGINS AVAILABLE (circle vault). When a page requires signing in and it matches one of these, call fill_saved_login with the matching credential_id; the edge will request exact one-call approval and type the secret directly without showing it to you. Only these are available:\n${lines}\n\nRules: match the current page's origin to the credential's site/origins before using it; if none match the site you're on, ask the user. Never guess a credential_id.`;
      }
    } catch { /* credential inventory is best-effort; never block the run */ }
  }

  // Insert the initial run row so clients can track it in real-time even
  // before completion.
  let runId: string | null = null;
  if (supabase) {
    try {
      const { data } = await supabase
        .from("computer_use_runs")
        .insert({
          circle_id: body.circleId,
          user_id: userId,
          task: body.task,
          status: "running",
        })
        .select("id")
        .single();
      runId = data?.id || null;
    } catch { /* persistence is best-effort */ }
  }

  // Booking-class caps: a booking run raises the iteration/token/cost/wall
  // ceilings so a 20-40-step checkout flow completes; non-booking runs keep
  // today's exact defaults. Explicit client overrides still win per-field.
  const runCaps = resolveRunCaps({
    booking: body.booking === true,
    maxIterations: body.maxIterations,
    maxTokensBudget: body.maxTokensBudget,
    // maxCostUsd/deadlineMs resolved below so the circle-settings read + the
    // ask-wait deadline logic stay in their existing places.
  });
  const maxIterations = Math.min(runCaps.maxIterations, HARD_MAX_ITERATIONS);
  const maxTokensBudget = Math.min(runCaps.maxTokensBudget, HARD_MAX_TOKENS);
  const agentModel = resolveComputerUseModel(body.model);
  // Model substitution visibility (2.5): the Sonnet pin above is untouched,
  // but when a requested non-Sonnet model was coerced, say so via a typed
  // `model_resolved` stream event instead of swapping silently. An empty
  // request is the plain default, not a substitution — no event.
  const requestedModelRaw = String(body.model || "").trim();
  const requestedModelNormalized = requestedModelRaw.startsWith("anthropic/")
    ? requestedModelRaw.slice("anthropic/".length)
    : requestedModelRaw;
  const modelWasSubstituted = Boolean(requestedModelRaw) && requestedModelNormalized !== agentModel;

  // Per-circle budget cap — read from `circles.settings.computer_use_max_cost_usd`
  // unless the caller passed an explicit override. Defaults to $0.75. Any
  // iteration that would push running cost above this aborts the run
  // gracefully with a summary of what was done so far.
  let maxCostUsd = typeof body.maxCostUsd === "number" && body.maxCostUsd > 0 ? body.maxCostUsd : runCaps.maxCostUsd;
  if (supabase && body.circleId && typeof body.maxCostUsd !== "number") {
    try {
      const { data } = await supabase
        .from("circles")
        .select("settings")
        .eq("id", body.circleId)
        .maybeSingle();
      const configured = (data?.settings as any)?.computer_use_max_cost_usd;
      if (typeof configured === "number" && configured > 0) maxCostUsd = configured;
    } catch { /* fall back to default */ }
  }

  // Umbrella Claude cap — a tighter `claude_total_max_cost_usd` than
  // the per-run CU cap should block the launch. Return a 429 BEFORE we
  // spin up a Browserbase session (those cost real $ too). Fail-open if
  // the check itself errors.
  if (supabase && body.circleId) {
    const umbrella = await checkCircleClaudeBudget(supabase, body.circleId);
    if (!umbrella.allowed) {
      return new Response(JSON.stringify({
        error: "circle_claude_budget_exceeded",
        detail: umbrella.reason,
        spent24h: umbrella.spent24h,
        cap: umbrella.cap,
      }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch { /* stream may be closed */ }
      };
      const closeStream = () => { try { controller.close(); } catch {} };

      // Running totals via the shared `UsageBreakdown` type — matches
      // Anthropic's billing structure (cache reads 10% of input, creates 1.25x).
      let usage: UsageBreakdown = { ...EMPTY_USAGE };
      const startTime = Date.now();
      const DEADLINE_MS = runCaps.deadlineMs;
      // Tracks the most recent observed page URL so the exact per-call gate
      // can warn when a mutation also looks like a pay/book commit.
      let lastKnownUrl: string | null = null;
      // Time spent paused on ask_user does not count against the work
      // deadline (D5) — a human fetching a 2FA code should not starve the
      // agent's 5-minute budget.
      let confirmationWaitMs = 0;
      // P61: progress-based stuck handling for the native browser loop
      // (parity with the client loops' P56/P59). A bounded ring of real
      // browser-action dispatches feeds detectRepeatedToolFailure; three
      // identical failing actions → ONE fresh-eyes solver consultation;
      // still stuck after that → clean partial_result stop instead of
      // burning the remaining iterations on a doomed action.
      let solverConsulted = false;
      let lastBrowserToolError: string | null = null;
      let lastFailingBrowserCall: { tool: string; input: unknown } | null = null;
      const browserActionRing: Array<{ name: string; inputHash: string; ok: boolean }> = [];

      // Conversation messages for the Claude loop. Prepend follow-up
      // context (from the most recent completed run in this circle) so
      // the agent can thread continuity across tasks without requiring
      // the user to restate history.
      const contextBlocks = [replayBlock, followUpContext, credentialInventory].filter(Boolean);
      const userContent = contextBlocks.length
        ? `${contextBlocks.join("\n\n---\n\n")}\n\n---\n\nNew task:\n${body.task}`
        : body.task;
      const messages: Array<{ role: string; content: any }> = [
        { role: "user", content: userContent },
      ];

      // Emitted first (before run_started) so clients can label the run's
      // model before any other event arrives. Same shape as the client-side
      // mirror in src/lib/chatComputerHandoffContext.ts.
      if (modelWasSubstituted) {
        emit("model_resolved", {
          requestedModel: requestedModelRaw,
          resolvedModel: agentModel,
          reason: "computer_use_requires_sonnet",
        });
      }

      if (runId) emit("run_started", { runId });

      // Heartbeat every 10s so the client's stream reader has a reason to
      // show "still thinking" progress even when Claude is mid-reasoning
      // and no `action` / `reasoning` events are firing for a while. Keeps
      // the connection alive through proxies that idle-close after 30s.
      const heartbeat = setInterval(() => {
        emit("heartbeat", { at: Date.now() });
      }, 10_000);
      const clearHeartbeat = () => { try { clearInterval(heartbeat); } catch {} };

      try {
        // ── Open or reuse Browserbase session ─────────────────────────
        // A passed-in sessionId (follow-up like "book option 2") may point at
        // a session that has already died (idle timeout, keepAlive off on a
        // free plan). Don't blindly trust it — probe with a lightweight
        // screenshot, and on ANY failure fall back to a fresh session. The
        // existing followUpContext / finding-URL re-navigation then drives
        // re-entry (spec Case C), so a stale reuse degrades gracefully instead
        // of failing the whole run against a dead session.
        let sessionId: string;
        let liveUrl: string;
        if (body.sessionId) {
          let reuseOk = false;
          try {
            await bbCommand(body.browserbase, body.sessionId, "screenshot", {});
            reuseOk = true;
          } catch {
            reuseOk = false;
          }
          if (reuseOk) {
            sessionId = body.sessionId;
            liveUrl = `https://www.browserbase.com/sessions/${body.sessionId}`;
          } else {
            emit("reasoning", { text: "[session] Prior browser session was gone — opening a fresh one and re-navigating." });
            ({ sessionId, liveUrl } = await openBrowserbaseSession(body.browserbase));
          }
        } else {
          ({ sessionId, liveUrl } = await openBrowserbaseSession(body.browserbase));
        }
        emit("session_started", { sessionId, liveUrl });

        // ── Partial-results support (D8) ──────────────────────────────
        // A stopped run must hand back something checkable, not just an
        // error string. Track a bounded breadcrumb log of completed
        // actions + the last reasoning snippet; on any bounded stop
        // (timeout / token budget / cost cap / stall) emit `partial_result`
        // with the progress so far and the live session link, and persist
        // the same onto the run row so follow-up context can resume from
        // what was actually done.
        const progressLog: Array<{ iter: number; tool: string; detail: string }> = [];
        let lastReasoning = "";
        const recordProgress = (iter: number, tool: string, input: unknown) => {
          let detail = "";
          try {
            const safeInput = redactToolInputForTelemetry(tool, input);
            detail = JSON.stringify(safeInput).slice(0, 100);
          } catch { detail = ""; }
          progressLog.push({ iter, tool, detail });
          if (progressLog.length > 24) progressLog.shift();
        };

        // Guided-replay trace (D7c): only successfully completed, safe-to-
        // replay actions are recorded. Typed/key/credential inputs are
        // omitted rather than merely key-name redacted: native `text` was a
        // historical leak seam and a placeholder must never be typed later.
        const actionTrace: Array<{ tool: string; input: unknown }> = [];
        const recordTrace = (tool: string, input: unknown) => {
          if (tool === "fill_saved_login" || tool === "ask_user") return;
          if (tool === "computer") {
            const action = classifyNativeComputerAction(input).action;
            if (action === "type" || action === "key") return;
          }
          actionTrace.push({ tool, input: redactToolInputForTelemetry(tool, input) });
          if (actionTrace.length > 40) actionTrace.shift();
        };
        const emitPartialResult = async (iter: number, stopReason: string, message: string) => {
          const recent = progressLog.slice(-12);
          const progressSummary = recent.length
            ? `Stopped (${stopReason}) after ${iter} iteration${iter === 1 ? "" : "s"}. Completed actions: ${recent.map((p) => `${p.tool}${p.detail ? ` (${p.detail.slice(0, 60)})` : ""}`).join("; ")}.`
            : `Stopped (${stopReason}) after ${iter} iteration${iter === 1 ? "" : "s"} with no completed actions.`;
          if (supabase && runId) {
            try {
              await supabase
                .from("computer_use_runs")
                .update({
                  status: "error",
                  error_message: message.slice(0, 500),
                  summary: progressSummary.slice(0, 1500),
                  session_id: sessionId,
                  live_url: liveUrl,
                  iterations: iter,
                  input_tokens: usage.uncachedIn + usage.cacheCreate + usage.cacheRead,
                  output_tokens: usage.output,
                  estimated_cost: computeCostUsd(agentModel, usage),
                  completed_at: new Date().toISOString(),
                })
                .eq("id", runId);
            } catch { /* best-effort */ }
          }
          emit("partial_result", {
            stopReason,
            message,
            summary: progressSummary,
            progress: recent,
            lastReasoning: lastReasoning.slice(0, 400) || null,
            iterations: iter,
            sessionId,
            liveUrl,
            runId,
          });
        };

        // Mid-run steering (plan §4e): notes posted via the `steer` action
        // while this run is live. Consumed ids are loop-local — one run,
        // one loop — and each note is injected exactly once.
        const consumedSteeringIds = new Set<string>();
        const fetchUnconsumedSteeringNotes = async (): Promise<Array<{ id: string; note: string }>> => {
          if (!supabase || !runId) return [];
          try {
            const { data } = await supabase
              .from("computer_use_confirmations")
              .select("id, choice")
              .eq("run_id", runId)
              .eq("question", STEERING_QUESTION_MARKER)
              .not("resolved_at", "is", null)
              .order("created_at", { ascending: true })
              .limit(5);
            const fresh = (data || []).filter((row: any) =>
              row?.id && row?.choice && !consumedSteeringIds.has(String(row.id)));
            for (const row of fresh) consumedSteeringIds.add(String((row as any).id));
            return fresh.map((row: any) => ({ id: String(row.id), note: String(row.choice) }));
          } catch {
            return []; // steering is best-effort — never stall the loop
          }
        };

        // ── Agent loop ────────────────────────────────────────────────
        agentLoop:
        for (let iter = 0; iter < maxIterations; iter++) {
          if (Date.now() - startTime - confirmationWaitMs > DEADLINE_MS) {
            const message = `Timed out after ${iter} iteration${iter === 1 ? '' : 's'} (${Math.round(DEADLINE_MS / 60_000)}-minute limit). The task is too long for one run — try splitting it, or narrow the scope (e.g. "just the top 3 results").`;
            await emitPartialResult(iter, "timeout", message);
            emit("error", { message });
            break;
          }
          // Token cap is "new work only" — cache reads don't count because
          // they're free re-use of prior context. Uncached input + output +
          // cache creates (these write real new tokens) is the right budget.
          const newWorkTokens = usage.uncachedIn + usage.cacheCreate + usage.output;
          if (newWorkTokens > maxTokensBudget) {
            const message = `Token budget reached: ${newWorkTokens.toLocaleString()} > ${maxTokensBudget.toLocaleString()}. Too much to read this run — narrow the task or break it up.`;
            await emitPartialResult(iter, "token_budget", message);
            emit("error", { message });
            break;
          }
          const runningCost = computeCostUsd(agentModel, usage);
          if (runningCost > maxCostUsd) {
            const message = `Budget cap reached: $${runningCost.toFixed(4)} > $${maxCostUsd.toFixed(2)}. Raise the cap in circle settings or run a narrower task.`;
            await emitPartialResult(iter, "cost_cap", message);
            emit("error", { message });
            break;
          }

          const claudeResponse = await callClaudeWithTools(apiKey.apiKey, messages, agentModel);
          usage = addUsage(usage, claudeResponse.usage);
          // Running ticker — cache-aware. `inputTokens` stays the total
          // input-side count (uncached + create + read) for backwards
          // compat with old clients; new clients read `cachedTokens`
          // separately to surface the cache-hit rate.
          const totalInputSide = usage.uncachedIn + usage.cacheCreate + usage.cacheRead;
          emit("usage", {
            iteration: iter + 1,
            inputTokens:  totalInputSide,
            outputTokens: usage.output,
            uncachedInputTokens: usage.uncachedIn,
            cacheCreateTokens:   usage.cacheCreate,
            cacheReadTokens:     usage.cacheRead,
            estimatedCost: computeCostUsd(agentModel, usage),
          });

          // Record the assistant's turn verbatim so tool_use_id refs resolve
          // next iteration. Secret-bearing tool inputs are scrubbed in-place
          // after dispatch so subsequent model calls never receive typed/key
          // text or credential/question payloads from history.
          messages.push({ role: "assistant", content: claudeResponse.content });

          // Surface any thinking / text blocks as reasoning events.
          const turnContainsSecretBearingTool = claudeResponse.content.some((block: any) => {
            if (block?.type !== "tool_use") return false;
            if (block.name === "fill_saved_login" || block.name === "ask_user") return true;
            return block.name === "computer"
              && ["type", "key"].includes(classifyNativeComputerAction(block.input).action);
          });
          for (const block of claudeResponse.content) {
            if (block.type === "text" && block.text) {
              const safeReasoning = turnContainsSecretBearingTool
                ? "[Reasoning withheld because this turn contains redacted form, keyboard, credential, or confirmation data.]"
                : block.text;
              emit("reasoning", { text: safeReasoning });
              lastReasoning = safeReasoning;
            }
          }

          // End turn — agent believes it's done.
          if (claudeResponse.stop_reason === "end_turn") {
            const finalText = claudeResponse.content
              .filter((b: any) => b.type === "text")
              .map((b: any) => b.text)
              .join("\n")
              .trim();

            // Parse structured findings if the agent emitted them.
            // Supports either <FINDINGS>[...]</FINDINGS> tags OR a single
            // fenced ```json code block containing an array. The array
            // items are intentionally loosely typed — caller renders
            // whatever fields exist (title, url, price, rating, notes,
            // thumbnail, etc.) so the agent has freedom to shape output
            // for different task types.
            const { findings, summaryWithoutFindings } = extractStructuredFindings(finalText);
            const { extractedData, summaryWithoutExtractedData } = extractStructuredData(summaryWithoutFindings);
            const summary = summaryWithoutExtractedData || "(agent finished without a written summary)";
            // Mark the run complete in DB (best-effort — do this BEFORE
            // emitting so a disconnected client can still see the final
            // state via the follow-up-context read on the next run).
            const finalCost = computeCostUsd(agentModel, usage);
            const totalInputSideFinal = usage.uncachedIn + usage.cacheCreate + usage.cacheRead;
            if (supabase && runId) {
              try {
                await supabase
                  .from("computer_use_runs")
                  .update({
                    status: "done",
                    session_id: sessionId,
                    live_url: liveUrl,
                    summary,
                    findings,
                    iterations: iter + 1,
                    input_tokens: totalInputSideFinal,
                    output_tokens: usage.output,
                    estimated_cost: finalCost,
                    completed_at: new Date().toISOString(),
                  })
                  .eq("id", runId);
              } catch { /* best-effort */ }
              // Action trace persists separately (D7c) so a pre-migration DB
              // (column missing) can never break run completion.
              if (actionTrace.length > 0) {
                try {
                  await supabase
                    .from("computer_use_runs")
                    .update({ action_trace: actionTrace })
                    .eq("id", runId);
                } catch { /* replay trace is an optimization */ }
              }
            }
            emit("result", {
              summary,
              findings,
              extractedData,
              sessionId,
              liveUrl,
              tokens: {
                input:       totalInputSideFinal,
                output:      usage.output,
                uncachedIn:  usage.uncachedIn,
                cacheCreate: usage.cacheCreate,
                cacheRead:   usage.cacheRead,
              },
              iterations: iter + 1,
              runId,
            });
            break;
          }

          // Otherwise expect tool_use blocks; execute each and reply.
          const toolUses = claudeResponse.content.filter((b: any) => b.type === "tool_use");
          if (toolUses.length === 0) {
            const message = "Agent stalled — Claude neither finished nor asked for a tool. Try re-running the task; if it repeats, rephrase it more concretely.";
            await emitPartialResult(iter + 1, "stall", message);
            emit("error", { message });
            break;
          }

          // Union: tool_result blocks plus the trailing steering TEXT blocks
          // (text must FOLLOW tool_result blocks in the same user turn).
          const toolResults: Array<
            | { type: string; tool_use_id: string; content: any }
            | { type: "text"; text: string }
          > = [];
          // Did THIS round push anything into the stuck-detection ring?
          // Gate-only ask_user calls deliberately don't touch the ring, so a
          // round made only of them must not re-evaluate a stale failure tail.
          // A verified saved-login dispatch does touch the ring as a real
          // browser operation.
          let ringTouchedThisRound = false;
          for (const tu of toolUses) {
            const rawToolInput = tu.input;
            const safeToolInput = redactToolInputForTelemetry(tu.name, rawToolInput);
            let mutationCall = false;
            let mutationDispatchStarted = false;
            try {
              // Stop-and-confirm: when Claude calls `ask_user`, pause the
              // loop and wait for the client to write a decision. No real
              // browser action fires until the user answers (or times out).
              if (tu.name === "ask_user") {
                const rawQuestion = String((rawToolInput as any)?.question || "");
                const rawContext = typeof (rawToolInput as any)?.context === "string"
                  ? (rawToolInput as any).context
                  : null;
                const isTakeover = (rawToolInput as any)?.kind === "human_takeover";
                const isPayConfirm = isPayConfirmQuestion(rawQuestion, rawContext);
                // Model-authored questions/options can echo arbitrary form
                // text or secrets. Show fixed, bounded copy; the exact
                // mutation gate later identifies the actual single call.
                const question = isTakeover
                  ? "The browser needs a human-only step. Open the live session, complete it there, then choose Done."
                  : isPayConfirm
                    ? "Review the final payment or booking state in the live browser. Do you want the agent to continue?"
                    : "The browser agent needs your decision before it can continue.";
                const options = isTakeover
                  ? ["Done, continue", "Cancel the task"]
                  : ["Yes, continue", "No, cancel"];
                const ctx = isTakeover
                  ? "Nothing you type in the live browser is copied into chat, telemetry, or model history."
                  : "This answer is guidance only and does not authorize a later browser mutation.";
                emit("action", { tool: tu.name, input: safeToolInput });
                scrubSensitiveToolUseForHistory(tu);
                // Takeover asks: the user must act in the live session view
                // (2FA, CAPTCHA). While the loop is parked here NO tools run
                // and NO screenshots are captured — whatever the user types
                // in the live view never enters model context.
                // Pay/book confirmations get the longer (>=300s) window so a
                // human reviewing the final amount / fetching a card isn't
                // auto-cancelled. Takeovers keep their existing 300s; ordinary
                // asks keep 120s.
                const askTimeoutMs = isTakeover || isPayConfirm
                  ? PAY_CONFIRM_TIMEOUT_MS
                  : DEFAULT_ASK_TIMEOUT_MS;
                const waitStarted = Date.now();
                const choice = await askUserAndWait(
                  supabase, runId, question, options, ctx, emit,
                  askTimeoutMs,
                );
                confirmationWaitMs += Date.now() - waitStarted;
                recordProgress(iter + 1, tu.name, safeToolInput);
                const timedOut = choice === "__timeout__" || /did not respond within/i.test(choice);
                // Pay-confirm timeout: instead of feeding a "treat as No" back
                // into the loop and terminating, hand the run back as a
                // resumable partial_result carrying the sessionId so the user
                // can confirm & resume the SAME session later.
                if (isPayConfirm && timedOut) {
                  await emitPartialResult(
                    iter + 1,
                    "awaiting_confirmation",
                    "Awaiting booking confirmation — the final pay/book step is paused for your OK. Reply to confirm and I'll resume this session.",
                  );
                  emit("error", { message: "Paused awaiting your booking confirmation. Reply to resume." });
                  // Break the OUTER agent loop (labeled) so usage logging +
                  // stream cleanup in the enclosing finally still run. The
                  // partial_result already carries the sessionId so the user
                  // can confirm & resume the SAME session.
                  break agentLoop;
                }
                toolResults.push({
                  type: "tool_result",
                  tool_use_id: tu.id,
                  content: [{
                    type: "text",
                    text: isAffirmativeChoice(choice)
                      ? "User chose the affirmative option for this question only."
                      : "User declined or did not complete this question.",
                  }],
                });
                continue;
              }

              if (tu.name === "fill_saved_login") {
                mutationCall = true;
                scrubSensitiveToolUseForHistory(tu);
                if (executionPolicy.executionMode === "scheduled_observation") {
                  const message = "Scheduled Computer Use is observation-only. Saved-login filling was blocked before any browser mutation.";
                  await emitPartialResult(iter + 1, "scheduled_mutation_blocked", message);
                  emit("error", { message });
                  break agentLoop;
                }
                const waitStarted = Date.now();
                const choice = await askUserAndWait(
                  supabase,
                  runId,
                  "Allow this one saved-login fill in the currently observed login form?",
                  ["Yes, run this action", "No, stop"],
                  "Credential id, username, password, purpose, and typed values remain redacted. Approval applies to this call only.",
                  emit,
                  DEFAULT_ASK_TIMEOUT_MS,
                );
                confirmationWaitMs += Date.now() - waitStarted;
                if (!isAffirmativeChoice(choice)) {
                  const message = "Saved-login filling was not approved. No browser mutation was dispatched.";
                  await emitPartialResult(iter + 1, "mutation_not_approved", message);
                  emit("error", { message });
                  break agentLoop;
                }
                const before = await bbCommand(body.browserbase, sessionId, "screenshot", {});
                if (!before.screenshot) {
                  const message = "Could not obtain the required fresh pre-action screenshot. Saved-login filling was not dispatched.";
                  await emitPartialResult(iter + 1, "mutation_precondition_failed", message);
                  emit("error", { message });
                  break agentLoop;
                }
                emit("screenshot", { b64: before.screenshot, url: before.currentUrl });
                emit("action", { tool: tu.name, input: safeToolInput });
                await fillSavedLoginFromVault({
                  creds: body.browserbase,
                  sessionId,
                  input: rawToolInput,
                  circleId: body.circleId,
                  userSupabase,
                  approved: true,
                  mutationMaxAttempts: 1,
                  onMutationDispatchStart: () => {
                    mutationDispatchStarted = true;
                  },
                });
                const after = await bbCommand(body.browserbase, sessionId, "screenshot", {});
                if (!after.screenshot) throw new Error("post-action screenshot unavailable");
                if (after.currentUrl) lastKnownUrl = after.currentUrl;
                emit("screenshot", { b64: after.screenshot, url: after.currentUrl });
                recordProgress(iter + 1, tu.name, safeToolInput);
                toolResults.push({
                  type: "tool_result",
                  tool_use_id: tu.id,
                  content: [
                    { type: "image", source: { type: "base64", media_type: "image/png", data: after.screenshot } },
                    { type: "text", text: "Saved-login action dispatched once and followed by a fresh verification screenshot. Secrets were not returned." },
                  ],
                });
                browserActionRing.push({ name: tu.name, inputHash: hashToolInput(safeToolInput), ok: true });
                if (browserActionRing.length > 24) browserActionRing.splice(0, browserActionRing.length - 24);
                ringTouchedThisRound = true;
                continue;
              }

              if (tu.name !== "computer" && tu.name !== "bash") {
                const message = "An unknown tool was blocked before dispatch.";
                await emitPartialResult(iter + 1, "unknown_tool_blocked", message);
                emit("error", { message });
                scrubSensitiveToolUseForHistory(tu);
                break agentLoop;
              }

              const actionClass = tu.name === "computer"
                ? classifyNativeComputerAction(rawToolInput)
                : null;
              if (actionClass?.kind === "unknown_mutation") {
                mutationCall = true;
                scrubSensitiveToolUseForHistory(tu);
                const message = "An unknown native computer action was treated as a mutation and blocked before dispatch.";
                await emitPartialResult(iter + 1, "unknown_mutation_blocked", message);
                emit("error", { message });
                break agentLoop;
              }
              if (actionClass?.kind === "mutation") {
                mutationCall = true;
                if (executionPolicy.executionMode === "scheduled_observation") {
                  scrubSensitiveToolUseForHistory(tu);
                  const message = `Scheduled Computer Use is observation-only. The ${actionClass.action} mutation was blocked before dispatch.`;
                  await emitPartialResult(iter + 1, "scheduled_mutation_blocked", message);
                  emit("error", { message });
                  break agentLoop;
                }

                const mutationInputError = validateNativeMutationInput(actionClass, rawToolInput);
                if (mutationInputError) {
                  scrubSensitiveToolUseForHistory(tu);
                  const message = `The ${actionClass.action} mutation had invalid or out-of-bounds input and was blocked before approval or dispatch.`;
                  await emitPartialResult(iter + 1, mutationInputError, message);
                  emit("error", { message });
                  break agentLoop;
                }

                const payOrBookingCommit = detectFinalPaySubmission({
                  toolName: tu.name,
                  action: (rawToolInput as any)?.action ?? null,
                  actionText: (rawToolInput as any)?.text ?? null,
                  lastReasoning,
                  lastUrl: lastKnownUrl,
                  // Earlier ask_user answers are guidance, not reusable
                  // authorization. The exact gate below owns this one call.
                  payConfirmed: false,
                  booking: body.booking === true,
                });
                // Keep only the local rawToolInput reference needed for this
                // dispatch; scrub the conversation copy before waiting on a
                // human or making another model call.
                scrubSensitiveToolUseForHistory(tu);
                if (!canRunMutationWithoutLiveConfirmation(executionPolicy, actionClass)) {
                  const confirmation = buildExactMutationConfirmation(
                    actionClass,
                    rawToolInput,
                    payOrBookingCommit,
                  );
                  const waitStarted = Date.now();
                  const choice = await askUserAndWait(
                    supabase,
                    runId,
                    confirmation.question,
                    ["Yes, run this action", "No, stop"],
                    confirmation.context,
                    emit,
                    payOrBookingCommit ? PAY_CONFIRM_TIMEOUT_MS : DEFAULT_ASK_TIMEOUT_MS,
                  );
                  confirmationWaitMs += Date.now() - waitStarted;
                  if (!isAffirmativeChoice(choice)) {
                    scrubSensitiveToolUseForHistory(tu);
                    const message = `The ${actionClass.action} mutation was not approved. No browser mutation was dispatched.`;
                    await emitPartialResult(iter + 1, "mutation_not_approved", message);
                    emit("error", { message });
                    break agentLoop;
                  }
                }

                const before = await bbCommand(body.browserbase, sessionId, "screenshot", {});
                if (!before.screenshot) {
                  scrubSensitiveToolUseForHistory(tu);
                  const message = `Could not obtain the required fresh pre-action screenshot. The ${actionClass.action} mutation was not dispatched.`;
                  await emitPartialResult(iter + 1, "mutation_precondition_failed", message);
                  emit("error", { message });
                  break agentLoop;
                }
                emit("screenshot", { b64: before.screenshot, url: before.currentUrl });
                emit("action", { tool: tu.name, input: safeToolInput });
                mutationDispatchStarted = true;
                await runTool(body.browserbase, sessionId, tu.name, rawToolInput, {
                  mutationMaxAttempts: 1,
                  mutationAuthorization: APPROVED_MUTATION_DISPATCH,
                });
                const after = await bbCommand(body.browserbase, sessionId, "screenshot", {});
                if (!after.screenshot) throw new Error("post-action screenshot unavailable");
                const out: ToolOutcome = {
                  screenshot: after.screenshot,
                  currentUrl: after.currentUrl,
                  text: "Action dispatched once and followed by a fresh verification screenshot.",
                };
                scrubSensitiveToolUseForHistory(tu);
                if (out.currentUrl) lastKnownUrl = out.currentUrl;
                emit("screenshot", { b64: out.screenshot, url: out.currentUrl });
                recordProgress(iter + 1, tu.name, safeToolInput);
                recordTrace(tu.name, safeToolInput);
                toolResults.push({
                  type: "tool_result",
                  tool_use_id: tu.id,
                  content: [
                    { type: "image", source: { type: "base64", media_type: "image/png", data: out.screenshot } },
                    { type: "text", text: out.text },
                  ],
                });
                browserActionRing.push({ name: tu.name, inputHash: hashToolInput(safeToolInput), ok: true });
                if (browserActionRing.length > 24) browserActionRing.splice(0, browserActionRing.length - 24);
                ringTouchedThisRound = true;
                continue;
              }

              // Observation/navigation actions and the non-executing bash
              // refusal remain available to both interactive and watch runs.
              emit("action", { tool: tu.name, input: safeToolInput });
              const out = await runTool(body.browserbase, sessionId, tu.name, rawToolInput);
              if (out.currentUrl) lastKnownUrl = out.currentUrl;
              if (out.screenshot) {
                emit("screenshot", { b64: out.screenshot, url: out.currentUrl });
              }
              recordProgress(iter + 1, tu.name, safeToolInput);
              recordTrace(tu.name, safeToolInput);
              toolResults.push({
                type: "tool_result",
                tool_use_id: tu.id,
                content: out.screenshot
                  ? [
                      { type: "image", source: { type: "base64", media_type: "image/png", data: out.screenshot } },
                      ...(out.text ? [{ type: "text", text: out.text }] : []),
                    ]
                  : [{ type: "text", text: out.text || "(no output)" }],
              });
              // P61: record the successful dispatch (conservative failure
              // semantics — only THROWN tool errors count as failures; a
              // visually-failed action with a clean screenshot stays the
              // model's job to judge from pixels).
              browserActionRing.push({ name: tu.name, inputHash: hashToolInput(safeToolInput), ok: true });
              if (browserActionRing.length > 24) browserActionRing.splice(0, browserActionRing.length - 24);
              ringTouchedThisRound = true;
            } catch {
              scrubSensitiveToolUseForHistory(tu);
              if (mutationCall) {
                const stopReason = mutationDispatchStarted
                  ? "mutation_outcome_unknown"
                  : "mutation_precondition_failed";
                const message = mutationDispatchStarted
                  ? `The ${tu.name === "computer" ? classifyNativeComputerAction(rawToolInput).action : "saved-login"} mutation was dispatched once, but its result could not be verified. Outcome is unknown; it will not be replayed automatically.`
                  : `The ${tu.name === "computer" ? classifyNativeComputerAction(rawToolInput).action : "saved-login"} mutation failed before dispatch and was not run.`;
                await emitPartialResult(iter + 1, stopReason, message);
                emit("error", { message });
                // Do not add a failure ring/solver payload: mutation errors
                // may contain request text, and an ambiguous dispatch must
                // never be retried by the model or replay machinery.
                break agentLoop;
              }
              const safeError = `Tool ${String(tu.name || "(missing)").slice(0, 60)} failed without exposing request parameters.`;
              emit("error", { message: safeError });
              toolResults.push({
                type: "tool_result",
                tool_use_id: tu.id,
                content: [{ type: "text", text: safeError }],
              });
              // P61: record the failure for the progress-based detector.
              browserActionRing.push({ name: tu.name, inputHash: hashToolInput(safeToolInput), ok: false });
              if (browserActionRing.length > 24) browserActionRing.splice(0, browserActionRing.length - 24);
              ringTouchedThisRound = true;
              lastBrowserToolError = safeError;
              lastFailingBrowserCall = { tool: tu.name, input: safeToolInput };
            }
          }
          // Mid-run steering (plan §4e): unconsumed notes ride the same
          // user turn as the tool results (text blocks must FOLLOW
          // tool_result blocks). Guidance only — the framing tells the
          // model a note is not consent; ask_user still gates
          // consequential actions.
          const steeringNotes = await fetchUnconsumedSteeringNotes();
          for (const steering of steeringNotes) {
            toolResults.push({ type: "text", text: formatSteeringNoteForModel(steering.note) });
            emit("steering_applied", { note: steering.note.slice(0, 200) });
          }

          // P61: progress-based stuck handling. The consultation rides the
          // same user turn as the tool results (text AFTER tool_result blocks
          // — the steering precedent); gates (ask_user, pay floor) are
          // untouched — it changes the plan, never permissions.
          // Only evaluate on rounds that actually recorded a ring entry:
          // gate-only rounds (ask_user answer, saved-login fill, pay-floor
          // block) would otherwise re-fire the STALE pre-consultation verdict
          // and kill the run right after the user unblocked it.
          const stuckVerdict = ringTouchedThisRound
            ? detectRepeatedToolFailure(browserActionRing)
            : { stuck: false, reason: "" };
          if (stuckVerdict.stuck) {
            // #6: only consult when a NEXT iteration exists to consume the
            // advice. The consultation is one extra turn (root cause + two
            // approaches for the model to run next); on the FINAL iteration
            // the loop exits right after pushing it, wasting the consult and
            // burning the run's one consultation. `iter < maxIterations - 1`
            // is the edge's `nextTurnExists` bound — parity with the typed
            // core's `iteration < maxIterations` and the legacy relay loop.
            // On the last iteration we fall through to the honest stop below.
            const nextIterationExists = iter < maxIterations - 1;
            if (nextIterationExists && shouldConsultSolver({ stuck: true, alreadyConsulted: solverConsulted })) {
              solverConsulted = true;
              emit("solver_consultation", { reason: stuckVerdict.reason });
              toolResults.push({
                type: "text",
                text: buildSolverConsultationMessage({
                  tool: lastFailingBrowserCall?.tool || "the failing tool",
                  inputPreview: lastFailingBrowserCall ? previewToolInput(lastFailingBrowserCall.input) : null,
                  stuckReason: stuckVerdict.reason,
                  lastError: lastBrowserToolError,
                  availableTools: ["computer", "bash", "ask_user", "fill_saved_login"],
                  lastObservation: lastKnownUrl ? `current page: ${lastKnownUrl}` : null,
                }),
              });
              // Fresh window for the consultation's advice: the model gets a
              // full 3-strike run at a DIFFERENT approach before the
              // (consultation-spent) verdict below can terminate the run.
              browserActionRing.length = 0;
            } else {
              // #6: this branch now also covers the FINAL iteration (no next
              // turn to consult), not just the consultation-spent case. Word
              // the reason accurately — parity with the typed core's
              // conditional stop text — so we don't claim a consult was spent
              // when it never ran (last-round stop, or a stuck verdict before
              // any consultation).
              const spentClause = solverConsulted
                ? "no progress and the run's one solver consultation is already spent"
                : "no progress and no turns remain to try a different approach";
              const stopMessage = `Stopped: ${stuckVerdict.reason} — ${spentClause}. The session is preserved so you can take over or retry with different instructions.`;
              await emitPartialResult(iter + 1, "stuck_no_progress", stopMessage);
              emit("error", { message: stopMessage });
              messages.push({ role: "user", content: toolResults });
              break agentLoop;
            }
          }
          messages.push({ role: "user", content: toolResults });

          // Batch screenshot pruning (E5) — runs before the next Claude
          // call. No cost-math change is needed here: the token budget and
          // cost cap above read the API-reported usage of each call, so a
          // pruned (smaller) history shows up automatically as fewer
          // uncached-input / cache-create tokens on the next iteration.
          const prunedCount = pruneScreenshotHistory(messages);
          if (prunedCount > 0) {
            emit("screenshot_history_pruned", { pruned: prunedCount, kept: KEEP_RECENT });
          }
        }

        // Fire usage log to claude_api_usage (best-effort). The shared
        // helper handles cache columns + cost math so every edge function
        // reports the same way.
        await logClaudeUsage(supabase, {
          circleId: body.circleId || null,
          userId,
          source:   "computer-use-agent",
          model:    agentModel,
          usage,
          metadata: {
            runId,
            executionMode: executionPolicy.executionMode,
            source: executionPolicy.source,
          },
        });
      } catch {
        // Runtime/provider errors can echo request parameters. Keep the
        // persisted/SSE copy generic; no typed text, credential, or tool input
        // crosses this final catch boundary.
        const errMsg = "Computer Use stopped unexpectedly without exposing browser action parameters.";
        // Mark the run failed in DB too so the history panel and
        // follow-up context both reflect the outcome.
        if (supabase && runId) {
          try {
            await supabase
              .from("computer_use_runs")
              .update({
                status: "error",
                error_message: errMsg,
                iterations: 0,
                input_tokens: usage.uncachedIn + usage.cacheCreate + usage.cacheRead,
                output_tokens: usage.output,
                estimated_cost: computeCostUsd(agentModel, usage),
                completed_at: new Date().toISOString(),
              })
              .eq("id", runId);
          } catch {}
        }
        emit("error", { message: errMsg });
      } finally {
        clearHeartbeat();
        closeStream();
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
});

// ── Helpers ─────────────────────────────────────────────────────────────

// System prompt the agent reads on every turn. Kept stable across calls so
// prompt caching (cache_control below) turns the second+ turn into a cache
// hit — ~10% of the input-token cost.
const AGENT_SYSTEM_PROMPT = `You are a browser agent driving a real Chrome browser on behalf of a user.

BEHAVIOR
- Take screenshots frequently (before acting, after a page loads, and whenever you're unsure what's visible).
- Navigate by clicking on what you actually see in the screenshot — do NOT invent pixel coordinates.
- When you type, type the exact text you intend. Don't type "username" literally unless that's the value.
- When you're unsure which element to click, scroll to bring it into view first, then re-screenshot.
- Prefer reading visible text to guessing layout. If you can't see it, take a screenshot.

TASK COMPLETION
- When you've completed the user's task, write a concise summary (3-8 bullets or 1-3 paragraphs) and STOP. Do NOT emit another tool call.
- The summary should include concrete findings (prices, links, names, quotes) — not meta-commentary about what you did.
- If the task can't be completed (paywall, stale info, no account exists), explain what stopped you and stop. Login walls, 2FA, and CAPTCHA are NOT dead ends — use the vault or human-takeover flows below first.

BROWSERBASE WORKFLOW PROFILES
- Web data retrieval: open the source page, wait for dynamic content to render, extract only the requested fields/records, include source URLs when visible, and stop promptly. For list-like results, use the <FINDINGS> block. For table/record/json style output, use <EXTRACTED_DATA> with valid JSON after the human summary.
- Stagehand-style browser work: break ambiguous UI work into small semantic actions (act/extract-sized steps), then verify with screenshots or visible text before continuing. Use deterministic clicks/typing when the target is obvious; do not overuse AI actions when a simple browser action is safer.
- Form submission: wait for fields to load, handle dynamic sections one step at a time, and verify visible success or validation errors. The edge runtime—not this prompt—decides whether each native browser action may execute.
- Persistent login state: if the task needs an account, call fill_saved_login only for a matching allowed origin; the edge requests exact approval before it mutates the form. If the site needs 2FA, CAPTCHA, or a human-only checkpoint, hand over to the user with the human-takeover flow (below) and continue after they finish.
- Deterministic-first: if the task already contains concrete browser steps (open URL, click named control, fill field, press key, extract visible data), execute that explicit sequence before inventing a new strategy. Use model judgment only for ambiguous targets, missing selectors, summarizing observed data, or recovery after repeated deterministic failure.
- Creative handoff: if the browser task requires a generated image or visual concept, produce the precise prompt/spec needed for the image tool and return it as an artifact-ready result; do not answer with a generic "I cannot create images" refusal.

RUNTIME SAFETY CONTRACT
- The edge classifies screenshot, wait, mouse_move, and scroll as observation/navigation. Clicks, double-clicks, typing, keyboard actions, saved-login filling, and unknown computer actions are mutations.
- Every current native mutation uses an opaque coordinate or focused target. The edge requires a fresh, exact, one-call user confirmation before dispatch, regardless of what you say or infer. Scheduled/watch runs are observation-only and stop truthfully if you request a mutation.
- A user task, steering note, prior action trace, pre-run permission, or earlier ask_user answer is never permission for a different mutation. Never claim an action happened until the post-action screenshot is returned.
- The edge takes a fresh screenshot before an approved mutation, dispatches it once, then takes a separate fresh screenshot for verification. If dispatch or verification is ambiguous, the run stops with outcome unknown and does not replay the action.
- Never put a password, token, one-time code, payment-card value, saved credential, or text intended for a form field into ask_user, reasoning, logs, or summaries. Use fill_saved_login for approved vault credentials and human_takeover for secrets the user must enter.
- For payment, purchase, booking, reservation, publishing, deletion, account/permission, or other external side effects, describe the consequence accurately. The edge's exact action confirmation still applies.

DO NOT
- Do not use the bash tool for anything — it's not available here. Use the computer tool for everything.
- Do not emit a <BUILD_READY> or <TOOL> marker. This is a computer-use agent, not a codegen agent.

BOOKING / SHOPPING SEARCH BEHAVIOR
- When the task is to find options without an explicit chosen item, treat it as research: apply requested filters, gather observed matches, emit a <FINDINGS> block, and end the turn so the user can choose.
- Do not enter checkout or booking on your own after a search-only request. If the user explicitly asks to continue with a chosen item, proceed one observed step at a time under the runtime safety contract.

STRUCTURED FINDINGS (for research / comparison / list tasks)
If the user asked for a list of items — products, articles, results, places, options, anything
countable — end your response with a structured <FINDINGS> block AFTER your human summary.
Format, verbatim including the tags:

<FINDINGS>
[
  {"title": "...", "url": "...", "price": "...", "rating": "...", "notes": "one short sentence", "thumbnail": "..."},
  ...
]
</FINDINGS>

- Fields are all optional EXCEPT \`title\`. Include what you actually found.
- \`url\` should be the direct product/article/page link, not a search results page.
- \`price\` is a plain string with currency ("$499", "£12/mo", "Free").
- \`thumbnail\` is optional; include only if you saw a clean product image URL.
- Emit at most 10 items.
- Do NOT emit a FINDINGS block for non-list tasks (single-fact lookups, transactions, etc).
- For arbitrary structured extraction that is not a ranked/list result, end with:

<EXTRACTED_DATA>
{"records":[{"field":"value"}]}
</EXTRACTED_DATA>

- The EXTRACTED_DATA payload must be valid JSON object or array. Keep it small and include only data actually observed.`;

// Incremental conversation caching (E5 companion). The shared callClaude()
// only puts a cache breakpoint on the system prompt, so without this the
// growing screenshot-heavy message history is re-billed as uncached input
// on EVERY iteration. Moving a single ephemeral breakpoint to the last
// content block of the latest message makes each turn a cache read of the
// previous turn's prefix plus a small cache-create increment — which is
// what makes batch pruning's "stable prefix between prunes" pay off.
// (2 breakpoints total with the system one; API max is 4.)
function applyIncrementalCacheBreakpoint(messages: Array<{ role: string; content: any }>) {
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue;
    for (const block of msg.content) {
      if (block && typeof block === "object" && block.cache_control) delete block.cache_control;
    }
  }
  const last = messages[messages.length - 1];
  if (Array.isArray(last?.content) && last.content.length > 0) {
    const lastBlock = last.content[last.content.length - 1];
    if (lastBlock && typeof lastBlock === "object") {
      lastBlock.cache_control = { type: "ephemeral" };
    }
  }
}

// Thin wrapper around the shared `callClaude()` — pins the computer-use
// beta header + the frozen system prompt (cached automatically). The
// agent loop uses `.content`, `.stop_reason`, and `.usage` directly.
async function callClaudeWithTools(apiKey: string, messages: Array<{ role: string; content: any }>, model = DEFAULT_AGENT_MODEL) {
  applyIncrementalCacheBreakpoint(messages);
  return await callClaude({
    apiKey,
    model,
    maxTokens: 4096,
    system: AGENT_SYSTEM_PROMPT,
    tools: [COMPUTER_USE_TOOL, BASH_TOOL, ASK_USER_TOOL, FILL_SAVED_LOGIN_TOOL],
    messages,
    betaHeaders: ["computer-use-2025-01-24"],
  });
}

// ── Stop-and-confirm helper ─────────────────────────────────────────────
// Inserts a row in `computer_use_confirmations`, emits an SSE event so the
// client can render an approval card, and polls for the user's choice.
// If the client doesn't answer within 2 minutes we treat the action as
// rejected — better to stall than silently execute a risky action.

async function askUserAndWait(
  supabase: any,
  runId: string | null,
  question: string,
  options: string[],
  context: string | null,
  emit: (event: string, data: unknown) => void,
  timeoutMs = 120_000,
): Promise<string> {
  if (!supabase || !runId) {
    // No persistence available — can't park the decision anywhere.
    // Emit the event so the client sees it and default to reject so
    // nothing risky happens without user input.
    emit("confirmation_required", { id: null, question, options, context, timeoutSec: 0 });
    return options.find((o) => /^no/i.test(o) || /cancel/i.test(o)) || "No";
  }

  const TIMEOUT_MS = timeoutMs;
  const POLL_MS = 500;

  let confirmationId: string | null = null;
  try {
    const { data } = await supabase
      .from("computer_use_confirmations")
      .insert({ run_id: runId, question, options, context })
      .select("id")
      .single();
    confirmationId = data?.id || null;
  } catch {
    // DB insert failed — same conservative fallback as above.
    emit("confirmation_required", { id: null, question, options, context, timeoutSec: 0 });
    return options.find((o) => /^no/i.test(o) || /cancel/i.test(o)) || "No";
  }

  emit("confirmation_required", {
    id: confirmationId,
    question,
    options,
    context,
    timeoutSec: Math.floor(TIMEOUT_MS / 1000),
  });

  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const { data } = await supabase
        .from("computer_use_confirmations")
        .select("choice, resolved_at")
        .eq("id", confirmationId)
        .maybeSingle();
      if (data?.choice && data?.resolved_at) {
        const storedChoice = String(data.choice);
        // UI buttons persist the exact option label, while Chat can resolve a
        // live confirmation with a bounded natural reply such as "yes" or
        // "no". Map only canonical affirmative/negative aliases onto an
        // existing fixed option; arbitrary text (including model-authored
        // option labels) is never forwarded or treated as authorization.
        const allowedChoice = resolveAllowedConfirmationChoice(storedChoice, options);
        if (!allowedChoice) {
          const rejected = options.find((o) => /^no/i.test(o) || /cancel|stop/i.test(o)) || "No";
          emit("confirmation_resolved", { id: confirmationId, choice: rejected });
          return rejected;
        }
        emit("confirmation_resolved", { id: confirmationId, choice: allowedChoice });
        return allowedChoice;
      }
    } catch { /* transient — keep polling */ }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }

  // Timeout: mark rejected so stale rows don't hang around as "pending".
  try {
    await supabase
      .from("computer_use_confirmations")
      .update({ choice: "__timeout__", resolved_at: new Date().toISOString() })
      .eq("id", confirmationId);
  } catch {}
  emit("confirmation_resolved", { id: confirmationId, choice: "__timeout__" });
  return `User did not respond within ${Math.round(TIMEOUT_MS / 60_000)} minute(s) — treating as a No / cancel. Try again and wait for the user.`;
}

function normalizeRpcPayload(data: unknown): any {
  if (typeof data === "string") {
    try {
      return JSON.parse(data);
    } catch {
      return data;
    }
  }
  return data;
}

function hostnameFromUrl(value?: string | null): string | null {
  if (!value) return null;
  try {
    const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    return new URL(withProtocol).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function credentialPolicy(row: any): Record<string, any> {
  return (row?.accessPolicy || row?.access_policy || {}) as Record<string, any>;
}

function credentialAllowedOrigins(row: any): string[] {
  const policyOrigins = stringArray(credentialPolicy(row).allowed_origins);
  if (policyOrigins.length > 0) return policyOrigins;
  return [row?.siteUrl || row?.site_url, row?.loginUrl || row?.login_url]
    .map((value) => hostnameFromUrl(value))
    .filter(Boolean)
    .map(String);
}

function credentialAllowedActions(row: any): string[] {
  const actions = stringArray(credentialPolicy(row).allowed_actions).map((item) => item.toLowerCase());
  return actions.length > 0 ? actions : ["login"];
}

function credentialMetadata(row: any): Record<string, any> {
  return (row?.metadata || {}) as Record<string, any>;
}

function normalizeGrantType(value: unknown): string {
  const normalized = String(value || "").trim().toLowerCase();
  if (["runtime", "chat", "member", "openswan"].includes(normalized)) return normalized;
  return "agent";
}

function credentialAutomationGrants(row: any): Array<Record<string, any>> {
  const meta = credentialMetadata(row);
  const raw = Array.isArray(meta.agentGrants)
    ? meta.agentGrants
    : Array.isArray(meta.automationGrants)
      ? meta.automationGrants
      : [];
  return raw.filter((item) => item && typeof item === "object");
}

function grantExpired(grant: Record<string, any>): boolean {
  const expiresAt = String(grant.expiresAt || grant.expires_at || "");
  if (!expiresAt) return false;
  const ts = Date.parse(expiresAt);
  return Number.isFinite(ts) && ts <= Date.now();
}

function credentialGrantAllowsLogin(row: any, input: any): boolean {
  const grants = credentialAutomationGrants(row).filter((grant) => !grantExpired(grant));
  if (grants.length === 0) return true;
  const grantee = String(input?.grantee || "").trim().toLowerCase();
  const granteeType = normalizeGrantType(input?.grantee_type || input?.granteeType || "openswan");
  if (!grantee) return false;
  return grants.some((grant) => {
    const grantGrantee = String(grant.grantee || "").trim().toLowerCase();
    const grantType = normalizeGrantType(grant.granteeType || grant.grantee_type);
    const grantActions = stringArray(grant.actions).map((item) => item.toLowerCase());
    return grantGrantee === grantee && grantType === granteeType && grantActions.includes("login");
  });
}

function hostAllowed(currentUrl: string | null | undefined, allowedOrigins: string[]): boolean {
  const currentHost = hostnameFromUrl(currentUrl);
  if (!currentHost) return false;
  const allowedHosts = allowedOrigins
    .map((origin) => hostnameFromUrl(origin) || origin.replace(/^www\./, "").toLowerCase())
    .filter(Boolean);
  return allowedHosts.some((host) => currentHost === host || currentHost.endsWith(`.${host}`));
}

function coordinate(input: unknown): [number, number] | null {
  if (!Array.isArray(input) || input.length !== 2) return null;
  const x = Number(input[0]);
  const y = Number(input[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x >= 1280 || y < 0 || y >= 800) return null;
  return [x, y];
}

async function fillSavedLoginFromVault(args: {
  creds: BrowserbaseCreds;
  sessionId: string;
  input: any;
  circleId: string;
  userSupabase: any;
  approved: boolean;
  mutationMaxAttempts: number;
  onMutationDispatchStart: () => void;
}): Promise<ToolOutcome> {
  const credentialId = String(args.input?.credential_id || "").trim();
  const purpose = String(args.input?.purpose || "computer_use_login").slice(0, 240);
  if (!credentialId) {
    throw new Error("credential_id is required.");
  }
  if (!args.userSupabase) {
    throw new Error("Saved credential login requires an authenticated user session.");
  }

  const { data: listData, error: listError } = await args.userSupabase.rpc("list_circle_site_credentials", {
    p_circle_id: args.circleId,
    p_platform: null,
  });
  if (listError) {
    throw new Error(`Could not list vault credentials: ${listError.message || listError}`);
  }
  const rows = normalizeRpcPayload(listData);
  const credential = Array.isArray(rows) ? rows.find((row: any) => String(row?.id) === credentialId) : null;
  if (!credential) {
    throw new Error("Saved credential was not found or you do not have access.");
  }
  if ((credential.isActive ?? credential.is_active) === false) {
    throw new Error("Saved credential is inactive.");
  }

  const policy = credentialPolicy(credential);
  if (policy.require_approval !== false && !args.approved) {
    throw new Error("Saved credential use was not approved by the runtime.");
  }
  if (!credentialAllowedActions(credential).includes("login")) {
    throw new Error("This credential policy does not allow login actions.");
  }
  if (!credentialGrantAllowsLogin(credential, args.input)) {
    throw new Error("This saved credential has scoped automation grants. Pass the matching grantee and grantee_type from the vault runbook before using it.");
  }

  const pageState = await bbCommand(args.creds, args.sessionId, "screenshot", {});
  if (!hostAllowed(pageState.currentUrl, credentialAllowedOrigins(credential))) {
    throw new Error(`Current page ${pageState.currentUrl || "(unknown URL)"} is not in this credential's allowed origins.`);
  }

  const { data: secretData, error: secretError } = await args.userSupabase.rpc("get_circle_site_credential_secret", {
    p_credential_id: credentialId,
    p_purpose: purpose || "computer_use_login",
  });
  if (secretError) {
    throw new Error(`Could not retrieve saved credential: ${secretError.message || secretError}`);
  }
  const payload = normalizeRpcPayload(secretData);
  const username = String(payload?.username || credential?.username || "");
  const secret = String(payload?.secret || "");
  if (!username || !secret) {
    throw new Error("Saved credential is missing username or secret.");
  }

  const usernameCoordinate = coordinate(args.input?.username_coordinate);
  const passwordCoordinate = coordinate(args.input?.password_coordinate);
  if (args.input?.username_coordinate !== undefined && !usernameCoordinate) {
    throw new Error("username coordinate invalid");
  }
  if (args.input?.password_coordinate !== undefined && !passwordCoordinate) {
    throw new Error("password coordinate invalid");
  }
  args.onMutationDispatchStart();
  if (usernameCoordinate) {
    await bbCommand(args.creds, args.sessionId, "click", { x: usernameCoordinate[0], y: usernameCoordinate[1] }, false, args.mutationMaxAttempts);
  }
  await bbCommand(args.creds, args.sessionId, "type", { text: username }, false, args.mutationMaxAttempts);
  if (passwordCoordinate) {
    await bbCommand(args.creds, args.sessionId, "click", { x: passwordCoordinate[0], y: passwordCoordinate[1] }, false, args.mutationMaxAttempts);
  } else {
    await bbCommand(args.creds, args.sessionId, "key", { key: "Tab" }, false, args.mutationMaxAttempts);
  }
  await bbCommand(args.creds, args.sessionId, "type", { text: secret }, false, args.mutationMaxAttempts);
  if (args.input?.submit === true) {
    await bbCommand(args.creds, args.sessionId, "key", { key: "Enter" }, false, args.mutationMaxAttempts);
  }

  return {
    currentUrl: pageState.currentUrl,
    text: `Filled saved login for ${payload?.platform || credential?.platform || "site"}/${payload?.label || credential?.label || "default"} at ${pageState.currentUrl || "current page"}. Secret was not returned.`,
  };
}

// ── Structured findings extractor ───────────────────────────────────────

interface Finding {
  title: string;
  url?: string;
  price?: string;
  rating?: string;
  notes?: string;
  thumbnail?: string;
  [extra: string]: unknown;
}

const FINDINGS_TAG_RE = /<FINDINGS>\s*([\s\S]*?)\s*<\/FINDINGS>/i;
const FINDINGS_FENCE_RE = /```(?:json)?\s*(\[[\s\S]*?\])\s*```/;
const EXTRACTED_DATA_TAG_RE = /<EXTRACTED_DATA>\s*([\s\S]*?)\s*<\/EXTRACTED_DATA>/i;

function extractStructuredFindings(text: string): {
  findings: Finding[] | null;
  summaryWithoutFindings: string;
} {
  if (!text) return { findings: null, summaryWithoutFindings: "" };

  let payload: string | null = null;
  let stripped = text;

  const tagMatch = text.match(FINDINGS_TAG_RE);
  if (tagMatch) {
    payload = tagMatch[1];
    stripped = text.replace(FINDINGS_TAG_RE, "").trim();
  } else {
    // Fallback: a bare JSON code block at the end that parses as an array.
    const fenceMatch = text.match(FINDINGS_FENCE_RE);
    if (fenceMatch) {
      payload = fenceMatch[1];
      stripped = text.replace(FINDINGS_FENCE_RE, "").trim();
    }
  }

  if (!payload) return { findings: null, summaryWithoutFindings: text.trim() };

  try {
    const parsed = JSON.parse(payload);
    if (!Array.isArray(parsed)) return { findings: null, summaryWithoutFindings: text.trim() };
    const clean: Finding[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const title = typeof (item as any).title === "string" ? (item as any).title.trim() : "";
      if (!title) continue;
      clean.push({
        title,
        url: typeof (item as any).url === "string" ? (item as any).url : undefined,
        price: typeof (item as any).price === "string" ? (item as any).price : undefined,
        rating: typeof (item as any).rating === "string" ? (item as any).rating : undefined,
        notes: typeof (item as any).notes === "string" ? (item as any).notes : undefined,
        thumbnail: typeof (item as any).thumbnail === "string" ? (item as any).thumbnail : undefined,
      });
      if (clean.length >= 10) break;
    }
    return {
      findings: clean.length > 0 ? clean : null,
      summaryWithoutFindings: stripped,
    };
  } catch {
    // Bad JSON — keep the raw text in the summary, don't throw.
    return { findings: null, summaryWithoutFindings: text.trim() };
  }
}

function extractStructuredData(text: string): {
  extractedData: unknown | null;
  summaryWithoutExtractedData: string;
} {
  if (!text) return { extractedData: null, summaryWithoutExtractedData: "" };

  const tagMatch = text.match(EXTRACTED_DATA_TAG_RE);
  if (!tagMatch) {
    return { extractedData: null, summaryWithoutExtractedData: text.trim() };
  }

  const stripped = text.replace(EXTRACTED_DATA_TAG_RE, "").trim();
  try {
    const parsed = JSON.parse(tagMatch[1]);
    if (!parsed || (typeof parsed !== "object" && !Array.isArray(parsed))) {
      return { extractedData: null, summaryWithoutExtractedData: text.trim() };
    }
    return { extractedData: parsed, summaryWithoutExtractedData: stripped };
  } catch {
    return { extractedData: null, summaryWithoutExtractedData: text.trim() };
  }
}

// ── Browserbase glue ────────────────────────────────────────────────────
//
// We call Browserbase's REST API directly from the edge function. A full
// browser session lives in the cloud; we only send actions and receive
// screenshot/URL responses. This is the same shape Stagehand uses — we're
// just removing its subprocess indirection.

interface BrowserbaseCreds { apiKey: string; projectId: string; region?: string }

async function openBrowserbaseSession(c: BrowserbaseCreds): Promise<{ sessionId: string; liveUrl: string }> {
  const res = await fetch("https://www.browserbase.com/v1/sessions", {
    method: "POST",
    headers: {
      "X-BB-API-Key": c.apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      projectId: c.projectId,
      region: c.region || "us-east-1",
      // Keep the session warm between runs so a follow-up like "book option 2"
      // (Case B) can re-enter the same live browser instead of hitting a dead
      // session. 15-minute idle timeout bounds cost if no follow-up arrives.
      keepAlive: true,
      timeout: 900,
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Browserbase session create ${res.status}: ${t.slice(0, 300)}`);
  }
  const j = await res.json();
  return {
    sessionId: j.id,
    liveUrl: `https://www.browserbase.com/sessions/${j.id}`,
  };
}

interface ToolOutcome {
  screenshot?: string;   // base64 PNG
  currentUrl?: string;
  text?: string;
}

// Module-private capability token: even a future accidental direct runTool()
// call cannot dispatch a native mutation without going through the exact
// approval + pre-observation branch above.
const APPROVED_MUTATION_DISPATCH = Symbol("approved_mutation_dispatch");

async function runTool(
  creds: BrowserbaseCreds,
  sessionId: string,
  name: string,
  input: any,
  options?: {
    mutationMaxAttempts?: number;
    mutationAuthorization?: typeof APPROVED_MUTATION_DISPATCH;
  },
): Promise<ToolOutcome> {
  if (name === "bash") {
    // We don't expose a real shell from the cloud browser — return a polite
    // refusal so Claude keeps driving the computer tool instead of trying
    // to use bash for everything.
    return { text: "bash is not available in this environment. Use the `computer` tool instead." };
  }

  // Everything else routes through the computer tool. Browserbase exposes
  // Playwright-compatible actions; we map the Anthropic action names
  // (`screenshot`, `left_click`, `type`, `key`, `mouse_move`, `scroll`) to
  // Playwright calls via the REST bridge.
  const action = String(input?.action || "").trim().toLowerCase();
  if (
    ["left_click", "right_click", "double_click", "type", "key"].includes(action)
    && options?.mutationAuthorization !== APPROVED_MUTATION_DISPATCH
  ) {
    throw new Error("Native mutation missing exact-call authorization.");
  }
  switch (action) {
    case "screenshot":
      return await bbCommand(creds, sessionId, "screenshot", {});
    case "left_click":
      return await bbCommand(creds, sessionId, "click", { x: input.coordinate?.[0], y: input.coordinate?.[1] }, false, options?.mutationMaxAttempts ?? 1);
    case "right_click":
      return await bbCommand(creds, sessionId, "click", { x: input.coordinate?.[0], y: input.coordinate?.[1], button: "right" }, false, options?.mutationMaxAttempts ?? 1);
    case "double_click":
      return await bbCommand(creds, sessionId, "dblclick", { x: input.coordinate?.[0], y: input.coordinate?.[1] }, false, options?.mutationMaxAttempts ?? 1);
    case "mouse_move":
      return await bbCommand(creds, sessionId, "mouse_move", { x: input.coordinate?.[0], y: input.coordinate?.[1] });
    case "type":
      return await bbCommand(creds, sessionId, "type", { text: input.text }, false, options?.mutationMaxAttempts ?? 1);
    case "key":
      return await bbCommand(creds, sessionId, "key", { key: input.text }, false, options?.mutationMaxAttempts ?? 1);
    case "scroll":
      return await bbCommand(creds, sessionId, "scroll", { dx: input.scroll_direction === "right" ? 300 : input.scroll_direction === "left" ? -300 : 0, dy: input.scroll_direction === "down" ? 300 : input.scroll_direction === "up" ? -300 : 0 });
    case "wait":
      await new Promise((r) => setTimeout(r, Math.min((input.duration ?? 1) * 1000, 5000)));
      return { text: "waited" };
    default:
      throw new Error("Unknown native computer action blocked.");
  }
}

/** Thin wrapper around Browserbase's session-command REST endpoint.
 *  Retries on transient errors (5xx, 429, network blips) with a short
 *  exponential backoff. Never retries on 4xx client errors — those are
 *  programming bugs that won't fix themselves by waiting. */
async function bbCommand(
  creds: BrowserbaseCreds,
  sessionId: string,
  command: string,
  params: Record<string, any>,
  returnScreenshot: boolean = true,
  maxAttempts: number = 3,
): Promise<ToolOutcome> {
  const MAX_ATTEMPTS = Math.max(1, Math.min(3, Math.floor(maxAttempts)));
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`https://www.browserbase.com/v1/sessions/${sessionId}/commands`, {
        method: "POST",
        headers: {
          "X-BB-API-Key": creds.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ command, params, returnScreenshot }),
        // 30s per-call cap — Browserbase commands are generally sub-5s,
        // so anything beyond this almost certainly means the session is
        // wedged and we're better off giving up.
        signal: AbortSignal.timeout(30_000),
      });
      if (res.ok) {
        const j = await res.json();
        return {
          screenshot: j.screenshot,
          currentUrl: j.currentUrl,
          text: j.text || j.message,
        };
      }
      // Don't burn retries on deterministic 4xx errors (bad params, auth).
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        const t = await res.text().catch(() => "");
        throw new Error(`Browserbase command ${command} ${res.status}: ${t.slice(0, 300)}`);
      }
      const t = await res.text().catch(() => "");
      lastErr = new Error(`Browserbase command ${command} ${res.status}: ${t.slice(0, 300)}`);
    } catch (err) {
      lastErr = err;
    }
    // Backoff: 500ms, 1500ms. Don't wait on the last attempt.
    if (attempt < MAX_ATTEMPTS - 1) {
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1) * (attempt + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr || "Browserbase command failed"));
}
