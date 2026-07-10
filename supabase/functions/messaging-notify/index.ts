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
//   - requires a matching APPROVED OpenSwan approval row before it POSTs
//     (posting to a team channel is an external side effect);
//   - caps the response and returns only `{ ok, status }` with NO secret.
//
// The provider payload shape mirrors src/lib/messagingNotify.ts (kept in sync;
// that pure module is the smoke-tested source of truth). Logic is inlined here
// because Deno edge functions cannot import from ../../../src.

import {
  corsHeaders,
  createServiceRoleClient,
  errResponse,
  getAuthenticatedUser,
  jsonResponse,
  userOwnsConnection,
} from "../_shared/edge.ts";

type MessagingProvider = "slack" | "discord" | "teams";
const MESSAGING_PROVIDERS = new Set<MessagingProvider>(["slack", "discord", "teams"]);

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
  orgId?: string | null;
  runId?: string | null;
  provider?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  // Either a ready-made provider payload (built client-side) or the raw message
  // args (built here). Both are re-scrubbed/bounded before sending.
  payload?: Record<string, unknown>;
  messageArgs?: MessageArgs;
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

// ── Approval verification (identical scheme to custom-api-proxy) ─────────────
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

async function requireApprovedToolCall(
  supabase: any,
  runId: string | null | undefined,
  toolName: string,
  toolArgs: Record<string, unknown> | undefined,
) {
  if (!runId) throw new Error("Approval runId is required before posting to a team channel.");
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
  if (!approved) throw new Error("A matching approved OpenSwan approval is required before this message can be posted.");
}

async function loadWebhookUrl(supabase: any, integrationId: string): Promise<string> {
  const { data, error } = await supabase
    .from("circle_integration_secrets")
    .select("key, value_encrypted")
    .eq("integration_id", integrationId);
  if (error) throw new Error(`Secret lookup failed: ${error.message}`);
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

  const provider = String(body.provider || "").trim().toLowerCase() as MessagingProvider;
  if (!MESSAGING_PROVIDERS.has(provider)) {
    return errResponse(400, "bad_provider", "provider must be one of slack, discord, teams.");
  }

  const supabase = createServiceRoleClient();

  // IDOR guard: the caller must belong to the circle (or org) that owns the
  // connection — same intent as custom-api-proxy's membership check.
  const owns = await userOwnsConnection(supabase, user.id, body.orgId ?? null, circleId);
  if (!owns) return errResponse(403, "not_circle_member", "You are not a member of this circle.");

  // Resolve the active messaging integration for this circle + provider.
  const { data: integrations, error: integrationError } = await supabase
    .from("circle_integrations")
    .select("id,provider,label,display_name,status,is_active")
    .eq("circle_id", circleId)
    .eq("provider", provider)
    .eq("is_active", true);
  if (integrationError) return errResponse(500, "integration_lookup_failed", integrationError.message);

  const candidates = (integrations || []) as any[];
  const needleId = String(body.integrationId || "").trim();
  const integration = candidates.find((row) => needleId && row.id === needleId)
    || (candidates.length >= 1 ? candidates[0] : null);

  if (!integration || integration.status === "disabled") {
    return jsonResponse({
      ok: false,
      error: "not_connected",
      provider,
      hint: `No active ${provider} connection with an incoming webhook. Connect ${provider} in Marketplace and paste an incoming webhook URL, then try again.`,
    }, 200);
  }

  try {
    // Approval MUST be verified before any external post (external side effect).
    const toolName = String(body.toolName || "messaging.notify");
    await requireApprovedToolCall(supabase, body.runId, toolName, body.toolArgs);

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

    // Prefer freshly-building from messageArgs (re-scrub/bound here); fall back
    // to a client-supplied payload, which we still send as-is only after JSON
    // round-trip (no secret scrub possible on an opaque object, so messageArgs
    // is the trusted path and what the tool handler uses).
    const outboundPayload = body.messageArgs && typeof body.messageArgs === "object"
      ? buildMessagingPayload(provider, body.messageArgs)
      : (body.payload && typeof body.payload === "object" ? body.payload : buildMessagingPayload(provider, {}));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    let res: Response;
    try {
      res = await fetch(target.toString(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(outboundPayload),
        signal: controller.signal,
        redirect: "error", // never follow a redirect off the validated host
      });
    } finally {
      clearTimeout(timeout);
    }

    // Read a tiny bounded body only to surface provider error text (Slack/Discord
    // return short strings). Never echo the webhook URL.
    let providerText = "";
    try {
      const raw = await res.text();
      providerText = raw.slice(0, 400);
    } catch {
      providerText = "";
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
      providerMessage: res.ok ? undefined : (providerText || res.statusText || "Webhook post failed."),
    }, res.ok ? 200 : 502);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return errResponse(400, "messaging_notify_blocked", message);
  }
});
