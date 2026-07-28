// messaging-notify — guarded server-side outbound posting to a team channel
// (Slack / Discord / Microsoft Teams) through a connected INCOMING WEBHOOK.
//
// This function is the write-side counterpart to the marketplace messaging
// integrations, which until now only "tracked the connection" and could not
// DO anything. It is modeled EXACTLY on custom-api-proxy's security posture:
//   - authenticates the caller and verifies they own the circle connection;
//   - resolves the stored incoming-webhook URL SERVER-SIDE only (never returned,
//     never logged, never echoed back to the client/model);
//   - blocks private / loopback / link-local / metadata destinations so a
//     mis-saved webhook can't be used for SSRF;
//   - requires an exact runtime-consumed OpenSwan v2 receipt plus one durable
//     action-ledger claim before it POSTs (an external side effect);
//   - caps the response and returns only `{ ok, status }` with NO secret.
//
// The provider payload shape mirrors src/lib/messagingNotify.ts (kept in sync;
// that pure module is the smoke-tested source of truth). Provider formatting
// remains inlined; only the pure canonical approval helpers are imported from
// the shared source module.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";
import {
  corsHeaders,
  createServiceRoleClient,
  errResponse,
  getAuthenticatedUser,
  getRequiredEnv,
  jsonResponse,
} from "../_shared/edge.ts";
import {
  buildOpenSwanApprovalAuthorityBindingDigest,
  buildOpenSwanToolApprovalDigest,
  isOpenSwanApprovalAuditPayload,
  stableApprovalJson,
} from "../../../src/lib/openswanToolApprovals.ts";

type MessagingProvider = "slack" | "discord" | "teams";
const MESSAGING_PROVIDERS = new Set<MessagingProvider>(["slack", "discord", "teams"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CALL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,179}$/;
const APPROVAL_DIGEST_RE = /^approval-v2:sha256:[0-9a-f]{64}$/;
const AUTHORITY_DIGEST_RE = /^authority-v2:sha256:[0-9a-f]{64}$/;
const ARGS_DIGEST_RE = /^args-v2:sha256:[0-9a-f]{64}$/;
const RECEIPT_KEYS = new Set([
  "schemaVersion",
  "approvalId",
  "approvalDigest",
  "approvalKeyDigest",
  "authorityBindingDigest",
  "status",
  "source",
  "consumedAt",
  "userId",
  "circleId",
  "approvalRunId",
  "runId",
  "toolName",
  "toolUseId",
  "iteration",
]);

type V2ApprovalReceipt = {
  schemaVersion: 2;
  approvalId: string;
  approvalDigest: string;
  approvalKeyDigest: string;
  authorityBindingDigest: string;
  status: "approved" | "auto_approved";
  source: "run_scoped" | "cross_run" | "category_auto";
  consumedAt: string;
  userId: string;
  circleId: string;
  approvalRunId: string;
  runId: string;
  toolName: string;
  toolUseId: string;
  iteration: number;
};

type EdgeDispatchLease = {
  receipt: V2ApprovalReceipt;
  toolArgsFingerprint: string;
  contractFingerprint: string;
  actionId: string;
  idempotencyKey: string;
  claimToken: string;
};

interface MessagingField {
  label: string;
  value: string;
}

interface MessageArgs {
  title?: string;
  body?: string;
  linkUrl?: string;
  fields?: MessagingField[];
}

interface RequestBody {
  circleId?: string;
  runId?: string | null;
  provider?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  approvalReceipt?: Record<string, unknown> | null;
  integrationId?: string;
}

// ── Bounds (mirror src/lib/messagingNotify.ts MESSAGING_LIMITS) ──────────────
const LIMITS = {
  title: 200,
  body: 3000,
  fields: 6,
  fieldLabel: 80,
  fieldValue: 500,
  linkUrl: 1000,
};

// ── Secret scrub (mirror src/lib/messagingNotify.ts scrubSecrets) ────────────
const SECRET_TOKEN_PATTERNS: RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._\-]{8,}/gi,
  /\bAuthorization\s*[:=]\s*[A-Za-z0-9._\-]{8,}/gi,
  /\bsk-[A-Za-z0-9]{16,}/g,
  /\bsk-ant-[A-Za-z0-9._\-]{16,}/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/gi,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bAKIA[0-9A-Z]{12,}/g,
  /\bAIza[0-9A-Za-z._\-]{20,}/g,
  /\bhf_[A-Za-z0-9]{16,}/g,
  /\beyJ[A-Za-z0-9._\-]{16,}\.[A-Za-z0-9._\-]{8,}\.[A-Za-z0-9._\-]{8,}/g,
  /\b(?:api[_-]?key|secret|token|password|passwd|client[_-]?secret|access[_-]?key|refresh[_-]?token|private[_-]?key|credential)\b\s*[:=]\s*["']?[A-Za-z0-9._\-/+]{6,}["']?/gi,
];

function scrubSecrets(value: unknown): string {
  let text = typeof value === "string" ? value : value == null ? "" : String(value);
  for (const pattern of SECRET_TOKEN_PATTERNS) {
    text = text.replace(pattern, "[redacted]");
  }
  return text;
}

function clip(value: unknown, max: number): string {
  const scrubbed = scrubSecrets(value).replace(/\r\n/g, "\n").trim();
  if (scrubbed.length <= max) return scrubbed;
  return `${scrubbed.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

function isHttpUrl(value: unknown): value is string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > LIMITS.linkUrl) return false;
  return /^https?:\/\/[^\s]+$/i.test(text) && !/\s/.test(text);
}

function normalizeFields(fields: unknown): MessagingField[] {
  if (!Array.isArray(fields)) return [];
  const out: MessagingField[] = [];
  for (const raw of fields) {
    if (out.length >= LIMITS.fields) break;
    if (!raw || typeof raw !== "object") continue;
    const label = clip((raw as Record<string, unknown>).label, LIMITS.fieldLabel);
    const value = clip((raw as Record<string, unknown>).value, LIMITS.fieldValue);
    if (!label && !value) continue;
    out.push({ label: label || "—", value: value || "—" });
  }
  return out;
}

function normalizeInput(input: MessageArgs) {
  const title = clip(input?.title, LIMITS.title);
  const body = clip(input?.body, LIMITS.body) || "(no message body)";
  const linkUrl = isHttpUrl(input?.linkUrl) ? (input!.linkUrl as string).trim() : "";
  const fields = normalizeFields(input?.fields);
  return { title, body, linkUrl, fields };
}

// ── Provider payload builders (mirror src/lib/messagingNotify.ts) ────────────
function buildSlackPayload(input: MessageArgs): Record<string, unknown> {
  const { title, body, linkUrl, fields } = normalizeInput(input);
  const text = [title, body].filter(Boolean).join("\n") || body;
  const blocks: Array<Record<string, unknown>> = [];
  if (title) {
    blocks.push({ type: "header", text: { type: "plain_text", text: title.slice(0, 150), emoji: true } });
  }
  blocks.push({ type: "section", text: { type: "mrkdwn", text: body } });
  if (fields.length > 0) {
    blocks.push({ type: "section", fields: fields.map((f) => ({ type: "mrkdwn", text: `*${f.label}*\n${f.value}` })) });
  }
  if (linkUrl) {
    blocks.push({
      type: "actions",
      elements: [{ type: "button", text: { type: "plain_text", text: "Open link", emoji: true }, url: linkUrl }],
    });
  }
  blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: "Posted by an Underground Circle agent" }] });
  return { text, blocks };
}

function buildDiscordPayload(input: MessageArgs): Record<string, unknown> {
  const { title, body, linkUrl, fields } = normalizeInput(input);
  const contentParts: string[] = [];
  if (title) contentParts.push(`**${title}**`);
  contentParts.push(body);
  if (linkUrl) contentParts.push(linkUrl);
  const payload: Record<string, unknown> = { content: contentParts.join("\n").slice(0, 2000) };
  if (title || fields.length > 0) {
    const embed: Record<string, unknown> = {};
    if (title) embed.title = title.slice(0, 256);
    embed.description = body.slice(0, 2048);
    if (linkUrl) embed.url = linkUrl;
    if (fields.length > 0) {
      embed.fields = fields.map((f) => ({ name: f.label.slice(0, 256), value: f.value.slice(0, 1024), inline: f.value.length <= 40 }));
    }
    payload.embeds = [embed];
  }
  return payload;
}

function buildTeamsPayload(input: MessageArgs): Record<string, unknown> {
  const { title, body, linkUrl, fields } = normalizeInput(input);
  const card: Record<string, unknown> = {
    "@type": "MessageCard",
    "@context": "https://schema.org/extensions",
    summary: (title || body).slice(0, 200) || "Notification",
    themeColor: "0F62FE",
    title: title || undefined,
    text: body,
  };
  if (fields.length > 0) {
    card.sections = [{ facts: fields.map((f) => ({ name: f.label, value: f.value })) }];
  }
  if (linkUrl) {
    card.potentialAction = [{ "@type": "OpenUri", name: "Open link", targets: [{ os: "default", uri: linkUrl }] }];
  }
  return card;
}

function buildMessagingPayload(provider: MessagingProvider, input: MessageArgs): Record<string, unknown> {
  const safe = input && typeof input === "object" ? input : ({ body: "" } as MessageArgs);
  switch (provider) {
    case "slack":
      return buildSlackPayload(safe);
    case "discord":
      return buildDiscordPayload(safe);
    case "teams":
      return buildTeamsPayload(safe);
    default:
      return buildSlackPayload(safe);
  }
}

// ── Private-host guard (ported from custom-api-proxy) ────────────────────────
function isPrivateIpv4(hostname: string): boolean {
  const match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;
  const nums = match.slice(1).map(Number);
  if (nums.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = nums;
  return a === 10
    || a === 127
    || a === 0
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 100 && b >= 64 && b <= 127);
}

function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost"
    || host.endsWith(".localhost")
    || host.endsWith(".local")
    || host.endsWith(".internal")
    || host === "::1"
    || host.startsWith("fc")
    || host.startsWith("fd")
    || host.startsWith("fe80")
    || host === "169.254.169.254"
    || isPrivateIpv4(host);
}

/** Validate the resolved webhook URL: HTTPS + public host only. Throws on block. */
function assertSafeWebhookUrl(rawUrl: string): URL {
  const text = String(rawUrl || "").trim();
  if (!text) throw new Error("Messaging webhook URL is not configured.");
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error("Stored messaging webhook URL is not a valid URL.");
  }
  if (url.protocol !== "https:") {
    throw new Error("Messaging webhook URL must use HTTPS.");
  }
  if (isBlockedHostname(url.hostname)) {
    throw new Error("Messaging webhook URL points at a private or local host, which is blocked.");
  }
  return url;
}

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

// ── Consumed v2 approval receipt verification ────────────────────────────────
async function sha256Hex(value: string): Promise<string> {
  if (typeof value !== "string" || value.length > 1_000_000) return "";
  try {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    const hex = Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    return hex.length === 64 ? hex : "";
  } catch {
    return "";
  }
}

function parseV2ApprovalReceipt(
  value: unknown,
  expected: { userId: string; circleId: string; runId: string; toolName: string },
): V2ApprovalReceipt | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !RECEIPT_KEYS.has(key))) return null;
  const status = record.status === "approved" || record.status === "auto_approved"
    ? record.status
    : null;
  const source = record.source === "run_scoped"
    || record.source === "cross_run"
    || record.source === "category_auto"
    ? record.source
    : null;
  if (!status || !source) return null;
  const receipt: V2ApprovalReceipt = {
    schemaVersion: 2,
    approvalId: typeof record.approvalId === "string" ? record.approvalId : "",
    approvalDigest: typeof record.approvalDigest === "string" ? record.approvalDigest : "",
    approvalKeyDigest: typeof record.approvalKeyDigest === "string" ? record.approvalKeyDigest : "",
    authorityBindingDigest: typeof record.authorityBindingDigest === "string" ? record.authorityBindingDigest : "",
    status,
    source,
    consumedAt: typeof record.consumedAt === "string" ? record.consumedAt : "",
    userId: typeof record.userId === "string" ? record.userId : "",
    circleId: typeof record.circleId === "string" ? record.circleId : "",
    approvalRunId: typeof record.approvalRunId === "string" ? record.approvalRunId : "",
    runId: typeof record.runId === "string" ? record.runId : "",
    toolName: typeof record.toolName === "string" ? record.toolName : "",
    toolUseId: typeof record.toolUseId === "string" ? record.toolUseId : "",
    iteration: Number(record.iteration),
  };
  if (
    record.schemaVersion !== 2
    || !UUID_RE.test(receipt.approvalId)
    || !APPROVAL_DIGEST_RE.test(receipt.approvalDigest)
    || receipt.approvalKeyDigest !== receipt.approvalDigest
    || !AUTHORITY_DIGEST_RE.test(receipt.authorityBindingDigest)
    || !Number.isFinite(Date.parse(receipt.consumedAt))
    || !UUID_RE.test(receipt.approvalRunId)
    || receipt.userId !== expected.userId
    || receipt.circleId !== expected.circleId
    || receipt.runId !== expected.runId
    || receipt.toolName !== expected.toolName
    || !CALL_ID_RE.test(receipt.toolUseId)
    || !Number.isInteger(receipt.iteration)
    || receipt.iteration < 1
    || receipt.iteration > 1_000
  ) {
    return null;
  }
  return receipt;
}

function isExactConsumedApprovalPayload(
  payload: unknown,
  receipt: V2ApprovalReceipt,
): payload is Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const record = payload as Record<string, unknown>;
  if (!isOpenSwanApprovalAuditPayload(record)) return false;
  const policyFamily = typeof record.policyFamily === "string" ? record.policyFamily : "";
  const autoApproveCategory = typeof record.autoApproveCategory === "string" ? record.autoApproveCategory : "";
  const floorCategory = typeof record.floorCategory === "string" ? record.floorCategory : "";
  return record.approvalSchemaVersion === 2
    && record.toolName === receipt.toolName
    && record.toolApprovalDigest === receipt.approvalDigest
    && record.toolApprovalKey === receipt.approvalDigest
    && record.toolApprovalKeyVersion === 2
    && CALL_ID_RE.test(policyFamily)
    && record.approvalMode === "ask"
    && record.mutatesState === true
    && record.externalSideEffect === true
    && (!autoApproveCategory || CALL_ID_RE.test(autoApproveCategory))
    && (!floorCategory || CALL_ID_RE.test(floorCategory))
    && record.dispatchReceiptSchemaVersion === 2
    && record.dispatchBindingDigest === receipt.authorityBindingDigest
    && record.dispatchConsumedAt === new Date(Date.parse(receipt.consumedAt)).toISOString();
}

function createAuthenticatedRpcClient(req: Request) {
  const authorization = req.headers.get("Authorization") || req.headers.get("authorization") || "";
  if (!authorization) return null;
  return createClient(
    getRequiredEnv("SUPABASE_URL"),
    getRequiredEnv("SUPABASE_ANON_KEY"),
    { global: { headers: { Authorization: authorization } } },
  );
}

async function requireConsumedToolReceipt(input: {
  serviceSupabase: any;
  userId: string;
  circleId: string;
  runId: string | null | undefined;
  toolName: string;
  toolArgs: Record<string, unknown> | undefined;
  receiptValue: unknown;
}): Promise<V2ApprovalReceipt> {
  if (!UUID_RE.test(String(input.runId || ""))) {
    throw new Error("A persisted approval run is required before posting to a team channel.");
  }
  if (!input.toolArgs || typeof input.toolArgs !== "object" || Array.isArray(input.toolArgs)) {
    throw new Error("Exact tool arguments are required for approval verification.");
  }
  const runId = String(input.runId);
  const receipt = parseV2ApprovalReceipt(input.receiptValue, {
    userId: input.userId,
    circleId: input.circleId,
    runId,
    toolName: input.toolName,
  });
  if (!receipt) {
    throw new Error("A valid consumed OpenSwan v2 approval receipt is required. Nothing was posted.");
  }
  const exactDigest = await buildOpenSwanToolApprovalDigest(input.toolName, input.toolArgs);
  if (!exactDigest || exactDigest !== receipt.approvalDigest) {
    throw new Error("The consumed approval does not match these exact tool arguments. Nothing was posted.");
  }
  const expectedBinding = await buildOpenSwanApprovalAuthorityBindingDigest({
    approvalId: receipt.approvalId,
    approvalRunId: receipt.approvalRunId,
    approvalDigest: receipt.approvalDigest,
    status: receipt.status,
    source: receipt.source,
    identity: {
      userId: receipt.userId,
      circleId: receipt.circleId,
      runId: receipt.runId,
      toolName: receipt.toolName,
      toolUseId: receipt.toolUseId,
      iteration: receipt.iteration,
    },
  });
  if (!expectedBinding || expectedBinding !== receipt.authorityBindingDigest) {
    throw new Error("The approval dispatch binding is invalid. Nothing was posted.");
  }
  const { data: run, error: runError } = await input.serviceSupabase
    .from("agent_runs")
    .select("id")
    .eq("id", runId)
    .eq("user_id", input.userId)
    .eq("circle_id", input.circleId)
    .maybeSingle();
  if (runError || !run) {
    throw new Error("The approval receipt is not bound to the authenticated persisted run. Nothing was posted.");
  }
  if (receipt.approvalRunId !== runId) {
    const { data: approvalRun, error: approvalRunError } = await input.serviceSupabase
      .from("agent_runs")
      .select("id")
      .eq("id", receipt.approvalRunId)
      .eq("user_id", input.userId)
      .eq("circle_id", input.circleId)
      .maybeSingle();
    if (approvalRunError || !approvalRun) {
      throw new Error("The approval authority run does not match the authenticated user and circle. Nothing was posted.");
    }
  }
  const { data: row, error } = await input.serviceSupabase
    .from("agent_run_approvals")
    .select("id,run_id,circle_id,requested_by,requested_at,timeout_seconds,status,title,payload")
    .eq("id", receipt.approvalId)
    .maybeSingle();
  if (error || !row) throw new Error("Approval receipt lookup failed. Nothing was posted.");

  const requestedAtMs = Date.parse(String(row.requested_at || ""));
  const timeoutSeconds = Number(row.timeout_seconds);
  const consumedAtMs = Date.parse(receipt.consumedAt);
  const expiresAtMs = requestedAtMs + timeoutSeconds * 1_000;
  if (
    row.run_id !== receipt.approvalRunId
    || row.circle_id !== input.circleId
    || row.requested_by !== input.userId
    || row.status !== receipt.status
    || row.title !== `OpenSwan approval required: ${input.toolName}`
    || (receipt.source === "cross_run" && receipt.approvalRunId === runId)
    || (receipt.source !== "cross_run" && receipt.approvalRunId !== runId)
    || !Number.isFinite(requestedAtMs)
    || !Number.isFinite(timeoutSeconds)
    || timeoutSeconds < 1
    || timeoutSeconds > 86_400
    || !Number.isFinite(consumedAtMs)
    || consumedAtMs < requestedAtMs
    || consumedAtMs > expiresAtMs
    || consumedAtMs > Date.now() + 5_000
    || Date.now() >= expiresAtMs
    || !isExactConsumedApprovalPayload(row.payload, receipt)
  ) {
    throw new Error("The approval is malformed, expired, cross-run, or already invalid. Nothing was posted.");
  }
  return receipt;
}

async function claimEdgeDispatch(input: {
  userSupabase: any;
  receipt: V2ApprovalReceipt;
  integrationId: string;
  provider: MessagingProvider;
  targetUrl: string;
}): Promise<EdgeDispatchLease> {
  const bindingHex = input.receipt.authorityBindingDigest.slice("authority-v2:sha256:".length);
  const toolArgsFingerprint = `args-v2:sha256:${input.receipt.approvalDigest.slice("approval-v2:sha256:".length)}`;
  const contractHex = await sha256Hex(stableApprovalJson({
    schemaVersion: 1,
    edge: "messaging_notify",
    approvalId: input.receipt.approvalId,
    approvalDigest: input.receipt.approvalDigest,
    authorityBindingDigest: input.receipt.authorityBindingDigest,
    integrationId: input.integrationId,
    provider: input.provider,
    targetUrl: input.targetUrl,
  }));
  const contractFingerprint = `args-v2:sha256:${contractHex}`;
  const actionId = `edge:${bindingHex}`;
  const idempotencyKey = `edge-v2:${bindingHex}`;
  if (!ARGS_DIGEST_RE.test(toolArgsFingerprint) || !ARGS_DIGEST_RE.test(contractFingerprint)) {
    throw new Error("The durable dispatch fingerprint could not be created. Nothing was posted.");
  }
  const { data, error } = await input.userSupabase.rpc("claim_agent_action_call", {
    p_user_id: input.receipt.userId,
    p_circle_id: input.receipt.circleId,
    p_run_id: input.receipt.runId,
    p_tool_name: input.receipt.toolName,
    p_tool_use_id: input.receipt.toolUseId,
    p_action_id: actionId,
    p_tool_args_fingerprint: toolArgsFingerprint,
    p_contract_fingerprint: contractFingerprint,
    p_idempotency_key: idempotencyKey,
    p_metadata: {
      surface: "system",
      risk: "high",
      approvalId: input.receipt.approvalId,
      source: "openswan_tool_runtime",
      actor: "user_authorized_agent",
      redacted: true,
    },
    p_ttl_seconds: 120,
  });
  if (
    error
    || !data
    || data.ok !== true
    || data.disposition !== "claimed"
    || data.state !== "claimed"
    || data.attemptCount !== 1
    || !UUID_RE.test(String(data.claimToken || ""))
  ) {
    throw new Error("This approval receipt was already claimed or the durable dispatch ledger is unavailable. Nothing was posted.");
  }
  return {
    receipt: input.receipt,
    toolArgsFingerprint,
    contractFingerprint,
    actionId,
    idempotencyKey,
    claimToken: String(data.claimToken),
  };
}

function edgeDispatchRpcArgs(lease: EdgeDispatchLease) {
  return {
    p_user_id: lease.receipt.userId,
    p_circle_id: lease.receipt.circleId,
    p_run_id: lease.receipt.runId,
    p_tool_name: lease.receipt.toolName,
    p_tool_use_id: lease.receipt.toolUseId,
    p_action_id: lease.actionId,
    p_tool_args_fingerprint: lease.toolArgsFingerprint,
    p_contract_fingerprint: lease.contractFingerprint,
    p_idempotency_key: lease.idempotencyKey,
    p_claim_token: lease.claimToken,
  };
}

async function startEdgeDispatch(userSupabase: any, lease: EdgeDispatchLease): Promise<void> {
  const { data, error } = await userSupabase.rpc("start_agent_action_call", edgeDispatchRpcArgs(lease));
  if (error || !data || data.ok !== true || data.disposition !== "started" || data.state !== "dispatched") {
    throw new Error("Durable dispatch start was refused. Nothing was posted.");
  }
}

async function finishEdgeDispatch(
  userSupabase: any,
  lease: EdgeDispatchLease,
  finalState: "verified" | "outcome_unknown",
): Promise<boolean> {
  const { data, error } = await userSupabase.rpc("finish_agent_action_call", {
    ...edgeDispatchRpcArgs(lease),
    p_final_state: finalState,
    p_metadata: {
      completionVerified: finalState === "verified",
      outcomeUnknown: finalState === "outcome_unknown",
      redacted: true,
    },
  });
  return !error && data?.ok === true && data?.state === finalState;
}

async function loadWebhookUrl(supabase: any, integrationId: string): Promise<string> {
  const { data, error } = await supabase
    .from("circle_integration_secrets")
    .select("key, value_encrypted")
    .eq("integration_id", integrationId);
  if (error) throw new Error("Messaging credential lookup failed.");
  const secrets: Record<string, string> = {};
  for (const row of data || []) {
    secrets[row.key] = decodeSecret(row.value_encrypted);
  }
  // Accept the canonical key plus a couple of tolerant aliases so a slightly
  // differently-named secret still resolves rather than silently failing.
  return (
    secrets.incoming_webhook_url
    || secrets.webhook_url
    || secrets.webhook
    || ""
  ).trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errResponse(405, "method_not_allowed", "Use POST.");

  const user = await getAuthenticatedUser(req);
  if (!user) return errResponse(401, "unauthorized", "Sign in before posting to a team channel.");

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return errResponse(400, "bad_json", "Request body must be JSON.");
  }

  const circleId = String(body.circleId || "").trim();
  if (!circleId) return errResponse(400, "missing_circle", "circleId is required.");

  if (body.toolName !== "messaging.notify") {
    return errResponse(400, "tool_identity_mismatch", "messaging.notify is required for outbound channel posts.");
  }
  const exactToolArgs = (
    body.toolArgs
    && typeof body.toolArgs === "object"
    && !Array.isArray(body.toolArgs)
  )
    ? body.toolArgs
    : null;
  if (!exactToolArgs) {
    return errResponse(400, "missing_exact_args", "Digest-bound toolArgs are required before posting to a team channel.");
  }
  const provider = String(exactToolArgs.provider || "").trim().toLowerCase() as MessagingProvider;
  if (!MESSAGING_PROVIDERS.has(provider)) {
    return errResponse(400, "bad_provider", "provider must be one of slack, discord, teams.");
  }

  const supabase = createServiceRoleClient();
  const userSupabase = createAuthenticatedRpcClient(req);
  if (!userSupabase) return errResponse(401, "unauthorized", "A user-scoped authorization token is required.");

  // Exact IDOR guard: an unrelated caller-supplied organization id must never
  // stand in for membership in the circle whose webhook secret will be used.
  const { data: membership, error: membershipError } = await supabase
    .from("circle_members")
    .select("user_id")
    .eq("circle_id", circleId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (membershipError || !membership) {
    return errResponse(403, "not_circle_member", "You are not a member of this circle.");
  }

  // Resolve the active messaging integration for this circle + provider.
  const { data: integrations, error: integrationError } = await supabase
    .from("circle_integrations")
    .select("id,provider,label,display_name,status,is_active")
    .eq("circle_id", circleId)
    .eq("provider", provider)
    .eq("is_active", true);
  if (integrationError) {
    return errResponse(500, "integration_lookup_failed", "Messaging connection lookup failed. Retry after the integration service is healthy.");
  }

  const candidates = (integrations || []) as any[];
  // Messaging tool args identify the provider, not an integration id. Refuse
  // ambiguity instead of letting an unapproved duplicate top-level field pick
  // another webhook connection.
  if (candidates.length > 1) {
    return errResponse(409, "ambiguous_connection", `Multiple active ${provider} connections exist; keep exactly one active before posting.`);
  }
  const integration = candidates.length === 1 ? candidates[0] : null;

  if (!integration || integration.status === "disabled") {
    return jsonResponse({
      ok: false,
      error: "not_connected",
      provider,
      hint: `No active ${provider} connection with an incoming webhook. Connect ${provider} in Marketplace and paste an incoming webhook URL, then try again.`,
    }, 200);
  }

  try {
    const toolName = "messaging.notify";
    const webhookUrl = await loadWebhookUrl(supabase, integration.id);
    if (!webhookUrl) {
      return jsonResponse({
        ok: false,
        error: "not_connected",
        provider,
        hint: `The ${provider} connection has no incoming webhook URL saved. Add it in Marketplace and try again.`,
      }, 200);
    }

    // Resolve + validate the destination host SERVER-SIDE. Never returned.
    const target = assertSafeWebhookUrl(webhookUrl);

    // The exact digest-bound tool args are the sole source of message content.
    // Any duplicate legacy fields in the JSON envelope are ignored.
    const outboundPayload = buildMessagingPayload(provider, {
      title: typeof exactToolArgs.title === "string" ? exactToolArgs.title : undefined,
      body: typeof exactToolArgs.body === "string" ? exactToolArgs.body : "",
      linkUrl: typeof exactToolArgs.linkUrl === "string" ? exactToolArgs.linkUrl : undefined,
      fields: Array.isArray(exactToolArgs.fields) ? exactToolArgs.fields as MessagingField[] : undefined,
    });

    // Finish read-only preparation before re-verifying the upstream-consumed
    // receipt, then durably claim immediately before dispatch. An invalid
    // webhook must never create an edge action-ledger claim.
    const approvalReceipt = await requireConsumedToolReceipt({
      serviceSupabase: supabase,
      userId: user.id,
      circleId,
      runId: body.runId,
      toolName,
      toolArgs: body.toolArgs,
      receiptValue: body.approvalReceipt,
    });

    const dispatchLease = await claimEdgeDispatch({
      userSupabase,
      receipt: approvalReceipt,
      integrationId: String(integration.id),
      provider,
      targetUrl: target.toString(),
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    let res: Response;
    let dispatchStartAttempted = false;
    try {
      // Set before awaiting the RPC: a lost start response is ambiguous and
      // must be sealed outcome_unknown if the server did enter dispatched.
      dispatchStartAttempted = true;
      await startEdgeDispatch(userSupabase, dispatchLease);
      res = await fetch(target.toString(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(outboundPayload),
        signal: controller.signal,
        redirect: "error", // never follow a redirect off the validated host
      });
    } catch (error) {
      if (dispatchStartAttempted) {
        await finishEdgeDispatch(userSupabase, dispatchLease, "outcome_unknown");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    const sealed = await finishEdgeDispatch(
      userSupabase,
      dispatchLease,
      res.ok ? "verified" : "outcome_unknown",
    );
    if (!sealed) {
      throw new Error("The outbound post completed but its durable outcome could not be sealed. It must not be replayed.");
    }

    // Capped, secret-free result. No webhook URL, no payload echo.
    return jsonResponse({
      ok: res.ok,
      status: res.status,
      provider,
      integration: {
        id: integration.id,
        label: integration.display_name || integration.label || provider,
      },
      approvalVerified: true,
      providerMessage: res.ok ? undefined : "Webhook provider returned a non-success status.",
    }, res.ok ? 200 : 502);
  } catch (e) {
    void e;
    return errResponse(
      400,
      "messaging_notify_blocked",
      "The channel post was blocked or could not be verified. Review the approval/run receipt before retrying; no automatic replay occurred.",
    );
  }
});
