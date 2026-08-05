// custom-api-proxy — guarded server-side execution for Custom API marketplace connectors.
//
// This function is intentionally narrow. It only calls the base URL saved on a
// connected `custom_api` circle integration, only uses methods allowed by that
// integration metadata, blocks private/local destinations, hides secret values,
// caps response bytes, and requires an exact runtime-consumed OpenSwan v2
// approval receipt plus one durable action-ledger claim for non-read methods.

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

type HttpMethod = "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";

interface RequestBody {
  circleId?: string;
  runId?: string | null;
  toolName?: "custom_api.read" | "custom_api.request";
  toolArgs?: Record<string, unknown>;
  approvalReceipt?: Record<string, unknown> | null;
  integrationId?: string;
  apiName?: string;
  toolNamespace?: string;
  method?: string;
  path?: string;
  query?: Record<string, unknown>;
  body?: unknown;
  maxBytes?: number;
}

const READ_METHODS = new Set<HttpMethod>(["GET", "HEAD"]);
const WRITE_METHODS = new Set<HttpMethod>(["POST", "PUT", "PATCH", "DELETE"]);
const ALL_METHODS = new Set<HttpMethod>(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]);
const SECRETISH_KEY_RE = /(secret|token|password|private|credential|api[_-]?key|access[_-]?key|refresh|client[_-]?secret|authorization|cookie)/i;
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

function clip(value: unknown, max = 160): string {
  return String(value || "").trim().slice(0, max);
}

function normalizeMethod(value: unknown, fallback: HttpMethod): HttpMethod | null {
  const method = String(value || fallback).trim().toUpperCase();
  return ALL_METHODS.has(method as HttpMethod) ? method as HttpMethod : null;
}

function parseAllowedMethods(value: unknown): Set<HttpMethod> {
  const raw = String(value || "").trim();
  const methods = raw
    ? raw.split(",").map((part) => normalizeMethod(part, "GET")).filter((method): method is HttpMethod => !!method)
    : ["GET" as HttpMethod];
  return new Set(methods);
}

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

function normalizePath(pathValue: unknown, defaultEndpoint: unknown): string {
  const raw = String(pathValue || defaultEndpoint || "").trim();
  if (!raw) return "";
  if (/^\/\//.test(raw)) throw new Error("Protocol-relative paths are not allowed.");
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^https?:\/\//i.test(raw)) {
    throw new Error("Only HTTPS URLs or relative API paths are allowed.");
  }
  return raw;
}

function cleanEndpointPath(value: unknown): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    const url = /^https?:\/\//i.test(raw) ? new URL(raw) : new URL(raw.startsWith("/") ? raw : `/${raw}`, "https://example.invalid");
    return url.pathname.replace(/\/+$/, "") || "/";
  } catch {
    return null;
  }
}

function buildTargetUrl(baseUrl: unknown, pathValue: unknown, query: Record<string, unknown> | undefined, defaultEndpoint: unknown): URL {
  const baseText = String(baseUrl || "").trim();
  if (!baseText) throw new Error("Custom API baseUrl is not configured.");
  const base = new URL(baseText);
  if (base.protocol !== "https:") {
    throw new Error("Custom API baseUrl must use HTTPS.");
  }
  if (isBlockedHostname(base.hostname)) {
    throw new Error("Custom API baseUrl points at a private or local host, which is blocked.");
  }

  const normalizedPath = normalizePath(pathValue, defaultEndpoint);
  let target: URL;
  if (/^https?:\/\//i.test(normalizedPath)) {
    target = new URL(normalizedPath);
  } else {
    const basePath = base.pathname.replace(/\/+$/, "");
    const rel = normalizedPath.replace(/^\/+/, "");
    target = new URL(`${base.origin}${basePath}${rel ? `/${rel}` : ""}`);
  }

  if (target.origin !== base.origin) {
    throw new Error("Custom API request must stay on the configured baseUrl origin.");
  }
  if (isBlockedHostname(target.hostname)) {
    throw new Error("Custom API request target is private or local, which is blocked.");
  }

  const basePath = base.pathname.replace(/\/+$/, "");
  if (basePath && basePath !== "/" && !target.pathname.startsWith(basePath)) {
    throw new Error("Custom API request must stay under the configured baseUrl path.");
  }

  const endpointPath = cleanEndpointPath(defaultEndpoint);
  if (endpointPath && endpointPath !== "/" && !target.pathname.startsWith(endpointPath)) {
    throw new Error("Custom API request must stay under the configured defaultEndpoint.");
  }

  for (const [key, value] of Object.entries(query || {}).slice(0, 50)) {
    if (!key || SECRETISH_KEY_RE.test(key)) continue;
    if (value === null || value === undefined) continue;
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") continue;
    target.searchParams.set(key, String(value));
  }
  target.hash = "";
  return target;
}

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

async function readResponsePreview(res: Response, maxBytes: number): Promise<{ text: string; bytesRead: number; truncated: boolean }> {
  const cap = Math.max(256, Math.min(20_000, maxBytes || 8_000));
  if (!res.body) {
    const text = await res.text();
    return { text: text.slice(0, cap), bytesRead: Math.min(text.length, cap), truncated: text.length > cap };
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytesRead = 0;
  let truncated = false;
  while (bytesRead < cap) {
    const next = await reader.read();
    if (next.done) break;
    const chunk = next.value;
    const remaining = cap - bytesRead;
    if (chunk.byteLength > remaining) {
      chunks.push(chunk.slice(0, remaining));
      bytesRead += remaining;
      truncated = true;
      try { await reader.cancel(); } catch { /* noop */ }
      break;
    }
    chunks.push(chunk);
    bytesRead += chunk.byteLength;
  }
  if (bytesRead >= cap) truncated = true;

  const merged = new Uint8Array(bytesRead);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder().decode(merged), bytesRead, truncated };
}

function metadataString(metadata: Record<string, unknown>, key: string): string {
  const value = metadata?.[key];
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value).trim()
    : "";
}

async function loadSecrets(supabase: any, integrationId: string): Promise<Record<string, string>> {
  const { data, error } = await supabase
    .from("circle_integration_secrets")
    .select("key, value_encrypted")
    .eq("integration_id", integrationId);
  if (error) throw new Error("Custom API credential lookup failed.");
  const out: Record<string, string> = {};
  for (const row of data || []) {
    out[row.key] = decodeSecret(row.value_encrypted);
  }
  return out;
}

function applyAuth(headers: Headers, metadata: Record<string, unknown>, secrets: Record<string, string>): string {
  const requested = metadataString(metadata, "authScheme").toLowerCase();
  const scheme = requested || (secrets.bearer_token || secrets.api_key ? "bearer" : secrets.basic_username ? "basic" : "none");
  if (scheme === "none") return "none";

  if (scheme === "basic") {
    const username = secrets.basic_username || "";
    const password = secrets.basic_password || "";
    if (!username || !password) throw new Error("Basic auth is selected, but basic_username/basic_password are incomplete.");
    headers.set("authorization", `Basic ${btoa(`${username}:${password}`)}`);
    return "basic";
  }

  if (scheme === "x-api-key") {
    const apiKey = secrets.api_key || secrets.bearer_token || "";
    const headerName = metadataString(metadata, "apiKeyHeaderName") || "x-api-key";
    if (!/^[A-Za-z0-9-]{1,64}$/.test(headerName) || (SECRETISH_KEY_RE.test(headerName) && headerName.toLowerCase() !== "x-api-key")) {
      throw new Error("Configured API key header name is not allowed.");
    }
    if (!apiKey) throw new Error("x-api-key auth is selected, but api_key is not configured.");
    headers.set(headerName, apiKey);
    return `header:${headerName.toLowerCase()}`;
  }

  if (scheme === "bearer") {
    const token = secrets.bearer_token || secrets.api_key || "";
    if (!token) throw new Error("Bearer auth is selected, but bearer_token/api_key is not configured.");
    headers.set("authorization", `Bearer ${token}`);
    return "bearer";
  }

  throw new Error("Unsupported authScheme. Use bearer, x-api-key, basic, or none.");
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
    throw new Error("A persisted approval run is required before this outbound request.");
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
    throw new Error("A valid consumed OpenSwan v2 approval receipt is required. Nothing was sent.");
  }
  const exactDigest = await buildOpenSwanToolApprovalDigest(input.toolName, input.toolArgs);
  if (!exactDigest || exactDigest !== receipt.approvalDigest) {
    throw new Error("The consumed approval does not match these exact tool arguments. Nothing was sent.");
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
    throw new Error("The approval dispatch binding is invalid. Nothing was sent.");
  }
  const { data: run, error: runError } = await input.serviceSupabase
    .from("agent_runs")
    .select("id")
    .eq("id", runId)
    .eq("user_id", input.userId)
    .eq("circle_id", input.circleId)
    .maybeSingle();
  if (runError || !run) {
    throw new Error("The approval receipt is not bound to the authenticated persisted run. Nothing was sent.");
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
      throw new Error("The approval authority run does not match the authenticated user and circle. Nothing was sent.");
    }
  }
  const { data: row, error } = await input.serviceSupabase
    .from("agent_run_approvals")
    .select("id,run_id,circle_id,requested_by,requested_at,timeout_seconds,status,title,payload")
    .eq("id", receipt.approvalId)
    .maybeSingle();
  if (error || !row) throw new Error("Approval receipt lookup failed. Nothing was sent.");

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
    throw new Error("The approval is malformed, expired, cross-run, or already invalid. Nothing was sent.");
  }
  return receipt;
}

async function claimEdgeDispatch(input: {
  userSupabase: any;
  receipt: V2ApprovalReceipt;
  integrationId: string;
  method: string;
  targetUrl: string;
}): Promise<EdgeDispatchLease> {
  const bindingHex = input.receipt.authorityBindingDigest.slice("authority-v2:sha256:".length);
  const toolArgsFingerprint = `args-v2:sha256:${input.receipt.approvalDigest.slice("approval-v2:sha256:".length)}`;
  const contractHex = await sha256Hex(stableApprovalJson({
    schemaVersion: 1,
    edge: "custom_api",
    approvalId: input.receipt.approvalId,
    approvalDigest: input.receipt.approvalDigest,
    authorityBindingDigest: input.receipt.authorityBindingDigest,
    integrationId: input.integrationId,
    method: input.method,
    targetUrl: input.targetUrl,
  }));
  const contractFingerprint = `args-v2:sha256:${contractHex}`;
  const actionId = `edge:${bindingHex}`;
  const idempotencyKey = `edge-v2:${bindingHex}`;
  if (!ARGS_DIGEST_RE.test(toolArgsFingerprint) || !ARGS_DIGEST_RE.test(contractFingerprint)) {
    throw new Error("The durable dispatch fingerprint could not be created. Nothing was sent.");
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
    throw new Error("This approval receipt was already claimed or the durable dispatch ledger is unavailable. Nothing was sent.");
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
    throw new Error("Durable dispatch start was refused. Nothing was sent.");
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errResponse(405, "method_not_allowed", "Use POST.");

  const user = await getAuthenticatedUser(req);
  if (!user) return errResponse(401, "unauthorized", "Sign in before using Custom API connectors.");

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return errResponse(400, "bad_json", "Request body must be JSON.");
  }

  const circleId = String(body.circleId || "").trim();
  if (!circleId) return errResponse(400, "missing_circle", "circleId is required.");
  const exactMutationArgs = (
    body.toolName === "custom_api.request"
    && body.toolArgs
    && typeof body.toolArgs === "object"
    && !Array.isArray(body.toolArgs)
  )
    ? body.toolArgs
    : null;
  // For writes the digest-bound tool args are the sole source of action
  // parameters. Duplicate top-level fields cannot alter the approved target.
  const requestInput = exactMutationArgs || body;

  const supabase = createServiceRoleClient();
  const userSupabase = createAuthenticatedRpcClient(req);
  if (!userSupabase) return errResponse(401, "unauthorized", "A user-scoped authorization token is required.");
  const { data: membership, error: membershipError } = await supabase
    .from("circle_members")
    .select("user_id")
    .eq("circle_id", circleId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (membershipError || !membership) return errResponse(403, "not_circle_member", "You are not a member of this circle.");

  const { data: integrations, error: integrationError } = await supabase
    .from("circle_integrations")
    .select("id,provider,label,display_name,status,metadata,capability_flags,is_active")
    .eq("circle_id", circleId)
    .eq("provider", "custom_api")
    .eq("is_active", true);
  if (integrationError) {
    return errResponse(500, "integration_lookup_failed", "Custom API connection lookup failed. Retry after the integration service is healthy.");
  }

  const needleId = clip(requestInput.integrationId, 120);
  const needleName = clip(requestInput.apiName, 120).toLowerCase();
  const needleNamespace = clip(requestInput.toolNamespace, 120).toLowerCase();
  const candidates = (integrations || []) as any[];
  const integration = candidates.find((row) => {
    const metadata = row.metadata || {};
    return (needleId && row.id === needleId)
      || (needleName && String(metadata.apiName || row.display_name || row.label || "").trim().toLowerCase() === needleName)
      || (needleNamespace && String(metadata.toolNamespace || "").trim().toLowerCase() === needleNamespace);
  }) || (candidates.length === 1 ? candidates[0] : null);

  if (!integration) {
    return errResponse(404, "custom_api_not_found", "No matching Custom API integration found. Pass integrationId, apiName, or toolNamespace.");
  }
  if (integration.status === "disabled") return errResponse(409, "integration_disabled", "Custom API integration is disabled.");

  const metadata = (integration.metadata || {}) as Record<string, unknown>;
  const method = normalizeMethod(requestInput.method || metadata.defaultMethod, "GET");
  if (!method) return errResponse(400, "bad_method", "Unsupported HTTP method.");
  const readOnly = READ_METHODS.has(method);
  const toolName = readOnly ? "custom_api.read" : "custom_api.request";
  if ((!readOnly && body.toolName !== toolName) || (readOnly && body.toolName && body.toolName !== toolName)) {
    return errResponse(400, "tool_identity_mismatch", `${toolName} is required for this HTTP method.`);
  }
  if (!readOnly && !exactMutationArgs) {
    return errResponse(400, "missing_exact_args", "Digest-bound toolArgs are required for write-like Custom API requests.");
  }

  const allowedMethods = parseAllowedMethods(metadata.allowedMethods);
  if (!allowedMethods.has(method)) {
    return errResponse(403, "method_not_allowed_by_integration", `${method} is not listed in this integration's allowedMethods.`);
  }

  try {
    const target = buildTargetUrl(
      metadata.baseUrl,
      requestInput.path,
      requestInput.query as Record<string, unknown> | undefined,
      metadata.defaultEndpoint,
    );
    const secrets = await loadSecrets(supabase, integration.id);
    const headers = new Headers();
    headers.set("accept", "application/json, text/plain;q=0.9, */*;q=0.1");
    const authUsed = applyAuth(headers, metadata, secrets);

    let requestBody: BodyInit | undefined;
    if (!readOnly && requestInput.body !== undefined && requestInput.body !== null) {
      requestBody = typeof requestInput.body === "string" ? requestInput.body : JSON.stringify(requestInput.body);
      headers.set("content-type", typeof requestInput.body === "string" ? "text/plain" : "application/json");
    }

    // Finish read-only preparation before re-verifying the upstream-consumed
    // receipt, then durably claim immediately before dispatch. Invalid target
    // or credential state must never create an edge action-ledger claim.
    const approvalReceipt = !readOnly
      ? await requireConsumedToolReceipt({
          serviceSupabase: supabase,
          userId: user.id,
          circleId,
          runId: body.runId,
          toolName,
          toolArgs: body.toolArgs,
          receiptValue: body.approvalReceipt,
        })
      : null;

    const dispatchLease = approvalReceipt
      ? await claimEdgeDispatch({
          userSupabase,
          receipt: approvalReceipt,
          integrationId: String(integration.id),
          method,
          targetUrl: target.toString(),
        })
      : null;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    let res: Response;
    let dispatchStartAttempted = false;
    try {
      if (dispatchLease) {
        // Set before awaiting the RPC: a lost start response is ambiguous and
        // must be sealed outcome_unknown if the server did enter dispatched.
        dispatchStartAttempted = true;
        await startEdgeDispatch(userSupabase, dispatchLease);
      }
      res = await fetch(target.toString(), {
        method,
        headers,
        body: method === "GET" || method === "HEAD" ? undefined : requestBody,
        signal: controller.signal,
        // SSRF guard: the host allow-list is enforced pre-flight on the configured
        // hostname, so following a 3xx to an internal/metadata host would escape
        // it. Do not follow redirects — any redirect is treated as blocked below.
        redirect: "manual",
      });
    } catch (error) {
      if (dispatchLease && dispatchStartAttempted) {
        await finishEdgeDispatch(userSupabase, dispatchLease, "outcome_unknown");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    // A redirect points somewhere the host guard never vetted. Refuse without
    // reading or forwarding the body (mirrors the isBlockedHostname block).
    if ((res.status >= 300 && res.status < 400) || res.type === "opaqueredirect") {
      if (dispatchLease) {
        await finishEdgeDispatch(userSupabase, dispatchLease, "outcome_unknown");
      }
      throw new Error("Custom API upstream attempted a redirect, which is blocked.");
    }

    let preview: { text: string; bytesRead: number; truncated: boolean };
    try {
      const maxBytes = Math.max(256, Math.min(20_000, Number(requestInput.maxBytes) || 8_000));
      preview = method === "HEAD"
        ? { text: "", bytesRead: 0, truncated: false }
        : await readResponsePreview(res, maxBytes);
    } catch (error) {
      if (dispatchLease) {
        await finishEdgeDispatch(userSupabase, dispatchLease, "outcome_unknown");
      }
      throw error;
    }
    if (dispatchLease) {
      const sealed = await finishEdgeDispatch(
        userSupabase,
        dispatchLease,
        res.ok ? "verified" : "outcome_unknown",
      );
      if (!sealed) {
        throw new Error("The outbound request completed but its durable outcome could not be sealed. It must not be replayed.");
      }
    }
    const contentType = res.headers.get("content-type") || "unknown";
    const visibleUrl = `${target.origin}${target.pathname}${target.search ? "?..." : ""}`;

    return jsonResponse({
      ok: res.ok,
      status: res.status,
      statusText: res.ok ? "success" : "non_success",
      method,
      url: visibleUrl,
      integration: {
        id: integration.id,
        label: integration.display_name || integration.label || metadata.apiName || "Custom API",
        toolNamespace: metadataString(metadata, "toolNamespace") || null,
      },
      contentType,
      authUsed,
      bytesRead: preview.bytesRead,
      truncated: preview.truncated,
      bodyPreview: res.ok || readOnly ? preview.text : "",
      approvalVerified: Boolean(approvalReceipt),
    }, res.ok ? 200 : 502);
  } catch (e) {
    void e;
    return errResponse(
      400,
      "custom_api_request_blocked",
      "Custom API dispatch was blocked or could not be verified. Review the approval/run receipt before retrying; no automatic replay occurred.",
    );
  }
});
