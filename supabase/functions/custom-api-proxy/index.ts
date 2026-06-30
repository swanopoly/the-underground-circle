// custom-api-proxy — guarded server-side execution for Custom API marketplace connectors.
//
// This function is intentionally narrow. It only calls the base URL saved on a
// connected `custom_api` circle integration, only uses methods allowed by that
// integration metadata, blocks private/local destinations, hides secret values,
// caps response bytes, and requires a matching approved OpenSwan approval row
// for non-read methods.

import {
  corsHeaders,
  createServiceRoleClient,
  errResponse,
  getAuthenticatedUser,
  jsonResponse,
} from "../_shared/edge.ts";

type HttpMethod = "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";

interface RequestBody {
  circleId?: string;
  runId?: string | null;
  toolName?: "custom_api.read" | "custom_api.request";
  toolArgs?: Record<string, unknown>;
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

function stableValue(value: unknown): unknown {
  if (value === undefined) return null;
  if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(stableValue);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = stableValue((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return String(value);
}

function buildApprovalKey(tool: string, args: Record<string, unknown>): string {
  return JSON.stringify({ version: 1, tool, args: stableValue(args || {}) });
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
  if (error) throw new Error(`Secret lookup failed: ${error.message}`);
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

async function requireApprovedToolCall(supabase: any, runId: string | null | undefined, toolName: string, toolArgs: Record<string, unknown> | undefined) {
  if (!runId) throw new Error("Approval runId is required for write-like Custom API requests.");
  if (!toolArgs || typeof toolArgs !== "object") throw new Error("Original tool args are required for approval verification.");
  const approvalKey = buildApprovalKey(toolName, toolArgs);
  const { data, error } = await supabase
    .from("agent_run_approvals")
    .select("id,status,payload")
    .eq("run_id", runId)
    .eq("title", `OpenSwan approval required: ${toolName}`)
    .in("status", ["approved", "auto_approved"])
    .order("requested_at", { ascending: false })
    .limit(8);
  if (error) throw new Error(`Approval lookup failed: ${error.message}`);
  const approved = (data || []).some((row: any) => row?.payload?.toolApprovalKey === approvalKey);
  if (!approved) throw new Error("A matching approved OpenSwan approval is required before this Custom API request can run.");
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

  const supabase = createServiceRoleClient();
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
  if (integrationError) return errResponse(500, "integration_lookup_failed", integrationError.message);

  const needleId = clip(body.integrationId, 120);
  const needleName = clip(body.apiName, 120).toLowerCase();
  const needleNamespace = clip(body.toolNamespace, 120).toLowerCase();
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
  const method = normalizeMethod(body.method || metadata.defaultMethod, "GET");
  if (!method) return errResponse(400, "bad_method", "Unsupported HTTP method.");
  const readOnly = READ_METHODS.has(method);
  const toolName = body.toolName || (readOnly ? "custom_api.read" : "custom_api.request");
  if (toolName === "custom_api.read" && !readOnly) return errResponse(400, "read_tool_method", "custom_api.read only allows GET or HEAD.");
  if (toolName === "custom_api.request" && !WRITE_METHODS.has(method)) return errResponse(400, "request_tool_method", "custom_api.request only allows POST, PUT, PATCH, or DELETE.");

  const allowedMethods = parseAllowedMethods(metadata.allowedMethods);
  if (!allowedMethods.has(method)) {
    return errResponse(403, "method_not_allowed_by_integration", `${method} is not listed in this integration's allowedMethods.`);
  }

  try {
    if (!readOnly) await requireApprovedToolCall(supabase, body.runId, toolName, body.toolArgs);

    const target = buildTargetUrl(metadata.baseUrl, body.path, body.query, metadata.defaultEndpoint);
    const secrets = await loadSecrets(supabase, integration.id);
    const headers = new Headers();
    headers.set("accept", "application/json, text/plain;q=0.9, */*;q=0.1");
    const authUsed = applyAuth(headers, metadata, secrets);

    let requestBody: BodyInit | undefined;
    if (!readOnly && body.body !== undefined && body.body !== null) {
      requestBody = typeof body.body === "string" ? body.body : JSON.stringify(body.body);
      headers.set("content-type", typeof body.body === "string" ? "text/plain" : "application/json");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    const res = await fetch(target.toString(), {
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? undefined : requestBody,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const maxBytes = Math.max(256, Math.min(20_000, Number(body.maxBytes) || 8_000));
    const preview = method === "HEAD"
      ? { text: "", bytesRead: 0, truncated: false }
      : await readResponsePreview(res, maxBytes);
    const contentType = res.headers.get("content-type") || "unknown";
    const visibleUrl = `${target.origin}${target.pathname}${target.search ? "?..." : ""}`;

    return jsonResponse({
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
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
      bodyPreview: preview.text,
      approvalVerified: !readOnly,
    }, res.ok ? 200 : 502);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return errResponse(400, "custom_api_request_blocked", message);
  }
});
