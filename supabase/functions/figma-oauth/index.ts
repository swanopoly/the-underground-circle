// figma-oauth — personal Figma OAuth and bounded server-side file reads.
//
// Browser code receives only a nonce-bound completion result and a bounded
// design summary. Access tokens, refresh tokens, and the PKCE verifier remain
// inside the service-only database/Edge boundary.
//
// Routes:
//   POST /authorize    { client_nonce, scopes }
//   GET  /callback     Figma redirect
//   POST /status
//   POST /disconnect
//   POST /file-summary { fileKey, nodeId? }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const FIGMA_CLIENT_ID = Deno.env.get("FIGMA_CLIENT_ID") || "";
const FIGMA_CLIENT_SECRET = Deno.env.get("FIGMA_CLIENT_SECRET") || "";
const SITE_URL = Deno.env.get("SITE_URL") || "https://app.chrisswanson.xyz";
const APP_ORIGIN = (() => {
  try {
    const parsed = new URL(SITE_URL);
    const isHttps = parsed.protocol === "https:";
    const isLoopbackHttp = parsed.protocol === "http:"
      && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]");
    if (!isHttps && !isLoopbackHttp) throw new Error("invalid app origin");
    return parsed.origin;
  } catch {
    return "https://app.chrisswanson.xyz";
  }
})();

const FIGMA_SCOPE = "file_content:read";
const OAUTH_NONCE_PATTERN = /^[a-f0-9]{48}$/;
const FIGMA_FILE_KEY_PATTERN = /^[A-Za-z0-9_-]{6,128}$/;
const FIGMA_NODE_ID_PATTERN = /^[A-Za-z0-9:;._-]{1,160}$/;
const PROVIDER_TIMEOUT_MS = 15_000;
const REFRESH_BUSY_RETRY_MS = 500;
const REFRESH_BUSY_ATTEMPTS = 4;

function getCallbackUrl(): string {
  return `${SUPABASE_URL}/functions/v1/figma-oauth/callback`;
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function firstRpcRow(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    const row = value[0];
    return row && typeof row === "object" ? row as Record<string, unknown> : null;
  }
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function randomHex(byteLength = 24): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function basicAuthorization(clientId: string, clientSecret: string): string {
  const bytes = new TextEncoder().encode(`${clientId}:${clientSecret}`);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `Basic ${btoa(binary)}`;
}

async function createPkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifierBytes = new Uint8Array(48);
  crypto.getRandomValues(verifierBytes);
  const verifier = base64Url(verifierBytes);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64Url(new Uint8Array(digest)) };
}

function parseCombinedOAuthState(raw: string): { serverNonce: string; clientNonce: string } | null {
  const [serverNonce, clientNonce, extra] = raw.split(".");
  if (extra !== undefined
    || !OAUTH_NONCE_PATTERN.test(serverNonce)
    || !OAUTH_NONCE_PATTERN.test(clientNonce)) {
    return null;
  }
  return { serverNonce, clientNonce };
}

function normalizeFigmaScopes(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  const scopes = raw
    .split(/[\s,]+/)
    .map((scope) => scope.trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set(scopes)).filter((scope) => scope === FIGMA_SCOPE);
}

function hasUnsupportedFigmaScope(raw: unknown): boolean {
  if (typeof raw !== "string") return false;
  return raw
    .split(/[\s,]+/)
    .map((scope) => scope.trim().toLowerCase())
    .filter(Boolean)
    .some((scope) => scope !== FIGMA_SCOPE);
}

type TimedProviderResponse = {
  response: Response;
  controller: AbortController;
  deadline: number;
  dispose: () => void;
};

class ProviderResponseTooLargeError extends Error {}

async function fetchWithTimeout(input: string, init: RequestInit, callerSignal?: AbortSignal): Promise<TimedProviderResponse> {
  const controller = new AbortController();
  const deadline = Date.now() + PROVIDER_TIMEOUT_MS;
  const abortFromCaller = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) abortFromCaller();
  else callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  const timer = setTimeout(() => controller.abort("provider_response_timeout"), PROVIDER_TIMEOUT_MS);
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    return {
      response,
      controller,
      deadline,
      dispose: () => {
        clearTimeout(timer);
        callerSignal?.removeEventListener("abort", abortFromCaller);
      },
    };
  } catch (error) {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", abortFromCaller);
    throw error;
  }
}

async function readBoundedJson(timed: TimedProviderResponse, maxBytes: number): Promise<unknown> {
  const { response, controller, deadline, dispose } = timed;
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    controller.abort("provider_response_too_large");
    dispose();
    throw new ProviderResponseTooLargeError("provider_response_too_large");
  }
  if (!response.body) {
    dispose();
    return null;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        controller.abort("provider_response_timeout");
        void reader.cancel("provider_response_timeout").catch(() => {});
        throw new Error("provider_response_timeout");
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort("provider_response_timeout");
          void reader.cancel("provider_response_timeout").catch(() => {});
          reject(new Error("provider_response_timeout"));
        }, remainingMs);
      });
      let readResult: ReadableStreamReadResult<Uint8Array>;
      try {
        readResult = await Promise.race([reader.read(), timeout]);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
      const { done, value } = readResult;
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        controller.abort("provider_response_too_large");
        void reader.cancel("provider_response_too_large").catch(() => {});
        throw new ProviderResponseTooLargeError("provider_response_too_large");
      }
      chunks.push(value);
    }
  } finally {
    try { reader.releaseLock(); } catch { /* a timed-out read may still own the lock */ }
    dispose();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

type OAuthResultPage = {
  success: boolean;
  error?: string;
  clientNonce?: string;
};

function oauthResultResponse(result: OAuthResultPage): Response {
  const error = typeof result.error === "string" ? result.error.slice(0, 500) : "";
  const clientNonce = typeof result.clientNonce === "string"
      && OAUTH_NONCE_PATTERN.test(result.clientNonce)
    ? result.clientNonce
    : "";
  const relayUrl = new URL("/oauth/email-calendar/callback", APP_ORIGIN);
  relayUrl.hash = new URLSearchParams({
    success: result.success ? "1" : "0",
    provider: "figma",
    email: "",
    error,
    nonce: clientNonce,
  }).toString();
  return new Response(null, {
    status: 303,
    headers: {
      "Location": relayUrl.toString(),
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

type ActiveFigmaCredential = {
  accessToken: string;
  expiresAt: string;
  providerSubject: string;
  scopes: string;
  credentialRevision: number;
  intentEpoch: number;
};

class FigmaRefreshBusyError extends Error {}
class FigmaCredentialUnavailableError extends Error {}
class FigmaReconnectRequiredError extends Error {}

function figmaOAuthErrorCode(payload: unknown): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
  const record = payload as Record<string, unknown>;
  for (const key of ["error", "error_code", "code", "message"]) {
    const value = record[key];
    if (typeof value !== "string") continue;
    const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_").slice(0, 160);
    if (normalized.includes("invalid_grant")) return "invalid_grant";
    if (normalized.includes("invalid_refresh_token")) return "invalid_refresh_token";
    if (normalized.includes("refresh_token_revoked")) return "refresh_token_revoked";
  }
  return "";
}

function isFigmaRefreshCredentialRejection(status: number, errorCode: string): boolean {
  // Only an explicit rejected user grant is reconnectable. HTTP 401 and
  // invalid_client represent app configuration/client authentication problems;
  // reconnecting the same user cannot repair those and must not erase tokens.
  return status === 400 && [
    "invalid_grant",
    "invalid_refresh_token",
    "refresh_token_revoked",
  ].includes(errorCode);
}

function isFigmaFileCredentialRejectionStatus(status: number): boolean {
  // Figma's file and file-nodes endpoints document 403 for an invalid or
  // expired developer/OAuth token. Keep 401 as a defensive equivalent, while
  // 404 remains the distinct missing-or-unshared-file result.
  return status === 401 || status === 403;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveFreshFigmaCredential(userId: string): Promise<ActiveFigmaCredential | null> {
  if (!FIGMA_CLIENT_ID || !FIGMA_CLIENT_SECRET) {
    throw new FigmaCredentialUnavailableError("Figma OAuth is not configured");
  }
  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const claimId = crypto.randomUUID();
  let claim: Record<string, unknown> | null = null;
  for (let attempt = 0; attempt < REFRESH_BUSY_ATTEMPTS; attempt += 1) {
    const claimResult = await serviceClient.rpc("claim_figma_oauth_refresh_v1", {
      p_user_id: userId,
      p_claim_id: claimId,
      p_lease_seconds: 45,
    });
    if (claimResult.error) throw new FigmaCredentialUnavailableError("Credential lookup failed");
    claim = firstRpcRow(claimResult.data);
    if (claim?.outcome !== "busy") break;
    if (attempt === REFRESH_BUSY_ATTEMPTS - 1) {
      throw new FigmaRefreshBusyError("Refresh is already in progress");
    }
    await wait(REFRESH_BUSY_RETRY_MS);
  }
  const outcome = typeof claim?.outcome === "string" ? claim.outcome : "";
  if (outcome === "missing") return null;
  if (outcome !== "fresh" && outcome !== "claimed") {
    throw new FigmaCredentialUnavailableError("Credential lookup returned an invalid result");
  }

  const accessToken = typeof claim?.access_token === "string" ? claim.access_token : "";
  const expiresAt = typeof claim?.expires_at === "string" ? claim.expires_at : "";
  const providerSubject = typeof claim?.provider_subject === "string" ? claim.provider_subject : "";
  const scopes = typeof claim?.granted_scopes === "string" ? claim.granted_scopes : "";
  const revision = Number(claim?.credential_revision);
  const intentEpoch = Number(claim?.intent_epoch);
  if (!accessToken
    || !providerSubject
    || !normalizeFigmaScopes(scopes).includes(FIGMA_SCOPE)
    || !Number.isSafeInteger(revision)
    || !Number.isSafeInteger(intentEpoch)) {
    throw new FigmaCredentialUnavailableError("Credential lookup returned an invalid result");
  }
  if (outcome === "fresh") {
    return { accessToken, expiresAt, providerSubject, scopes, credentialRevision: revision, intentEpoch };
  }

  const refreshToken = typeof claim?.refresh_token === "string" ? claim.refresh_token : "";
  let committed = false;
  try {
    if (!refreshToken) {
      const invalidated = await invalidateRejectedFigmaCredential(userId, intentEpoch, revision);
      if (invalidated) throw new FigmaReconnectRequiredError("No refresh token is available");
      throw new FigmaCredentialUnavailableError("Figma credential changed; retry with the current connection");
    }
    let response: Response;
    let providerErrorCode = "";
    try {
      const timedResponse = await fetchWithTimeout("https://api.figma.com/v1/oauth/token", {
        method: "POST",
        headers: {
          "Authorization": basicAuthorization(FIGMA_CLIENT_ID, FIGMA_CLIENT_SECRET),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        }),
      });
      response = timedResponse.response;
      if (!response.ok) {
        const errorPayload = await readBoundedJson(timedResponse, 16_000).catch(() => null);
        providerErrorCode = figmaOAuthErrorCode(errorPayload);
      } else {
        const tokens = await readBoundedJson(timedResponse, 64_000).catch(() => null) as Record<string, unknown> | null;
        const nextAccessToken = typeof tokens?.access_token === "string" ? tokens.access_token : "";
        if (!nextAccessToken || nextAccessToken.length > 16_384) {
          throw new FigmaCredentialUnavailableError("Figma returned an invalid refresh response");
        }
        const expiresInRaw = Number(tokens?.expires_in);
        const expiresIn = Number.isFinite(expiresInRaw)
          ? Math.max(60, Math.min(expiresInRaw, 180 * 24 * 60 * 60))
          : 90 * 24 * 60 * 60;
        const nextExpiry = new Date(Date.now() + expiresIn * 1000).toISOString();
        const nextRefreshToken = typeof tokens?.refresh_token === "string"
          ? tokens.refresh_token.slice(0, 16_384)
          : "";
        const commitResult = await serviceClient.rpc("commit_figma_oauth_refresh_v1", {
          p_user_id: userId,
          p_expected_intent_epoch: intentEpoch,
          p_expected_revision: revision,
          p_claim_id: claimId,
          p_operation_id: crypto.randomUUID(),
          p_access_token: nextAccessToken,
          p_refresh_token: nextRefreshToken,
          p_expires_at: nextExpiry,
          p_provider_subject: providerSubject,
          p_granted_scopes: FIGMA_SCOPE,
        });
        const commit = firstRpcRow(commitResult.data);
        if (commitResult.error
          || commit?.applied !== true
          || !Number.isSafeInteger(Number(commit.credential_revision))) {
          throw new FigmaCredentialUnavailableError("Figma refresh persistence failed");
        }
        committed = true;
        return {
          accessToken: nextAccessToken,
          expiresAt: nextExpiry,
          providerSubject,
          scopes: FIGMA_SCOPE,
          credentialRevision: Number(commit.credential_revision),
          intentEpoch,
        };
      }
    } catch {
      throw new FigmaCredentialUnavailableError("Figma refresh transport failed");
    }
    if (!response.ok) {
      if (isFigmaRefreshCredentialRejection(response.status, providerErrorCode)) {
        const invalidated = await invalidateRejectedFigmaCredential(userId, intentEpoch, revision);
        if (invalidated) {
          throw new FigmaReconnectRequiredError("Figma refresh credential was rejected");
        }
        throw new FigmaCredentialUnavailableError("Figma credential changed; retry with the current connection");
      }
      throw new FigmaCredentialUnavailableError("Figma refresh is temporarily unavailable");
    }
    throw new FigmaCredentialUnavailableError("Figma refresh returned no usable credential");
  } finally {
    if (!committed) {
      try {
        await serviceClient.rpc("release_figma_oauth_refresh_v1", {
          p_user_id: userId,
          p_expected_intent_epoch: intentEpoch,
          p_expected_revision: revision,
          p_claim_id: claimId,
        });
      } catch {
        // The short database lease remains the final recovery boundary.
      }
    }
  }
}

async function invalidateRejectedFigmaCredential(
  userId: string,
  expectedIntentEpoch: number,
  expectedRevision: number,
): Promise<boolean> {
  if (!Number.isSafeInteger(expectedRevision) || !Number.isSafeInteger(expectedIntentEpoch)) {
    throw new FigmaCredentialUnavailableError("Figma credential fence is invalid");
  }
  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const result = await serviceClient.rpc("invalidate_figma_oauth_credential_v1", {
    p_user_id: userId,
    p_expected_intent_epoch: expectedIntentEpoch,
    p_expected_revision: expectedRevision,
    p_operation_id: crypto.randomUUID(),
  });
  if (result.error) throw new FigmaCredentialUnavailableError("Figma rejection persistence failed");
  const invalidated = firstRpcRow(result.data);
  if (typeof invalidated?.applied !== "boolean") {
    throw new FigmaCredentialUnavailableError("Figma rejection persistence returned an invalid result");
  }
  return invalidated.applied;
}

function shortText(value: unknown, limit: number): string {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, limit) : "";
}

function buildFileReference(
  payload: unknown,
  fileKey: string,
  nodeId: string | null,
): { title: string; summary: string } | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const data = payload as Record<string, unknown>;
  const nodes = data.nodes && typeof data.nodes === "object" && !Array.isArray(data.nodes)
    ? data.nodes as Record<string, unknown>
    : null;
  const nodeEntry = nodeId && nodes && nodes[nodeId] && typeof nodes[nodeId] === "object"
    ? nodes[nodeId] as Record<string, unknown>
    : null;
  const rootCandidate = nodeEntry?.document ?? data.document;
  const root = rootCandidate && typeof rootCandidate === "object" && !Array.isArray(rootCandidate)
    ? rootCandidate as Record<string, unknown>
    : null;
  const fileName = shortText(data.name, 240) || "Figma file";
  const rootName = shortText(root?.name, 240);
  const rootType = shortText(root?.type, 80);
  const children = Array.isArray(root?.children) ? root.children.slice(0, 8) : [];
  const childSummary = children
    .map((child) => {
      if (!child || typeof child !== "object" || Array.isArray(child)) return "";
      const record = child as Record<string, unknown>;
      const name = shortText(record.name, 120);
      const type = shortText(record.type, 60);
      return name ? `${name}${type ? ` (${type})` : ""}` : "";
    })
    .filter(Boolean)
    .join(", ")
    .slice(0, 1_500);
  const lastModified = shortText(data.lastModified ?? data.last_modified, 80);
  const summary = [
    `File: ${fileName}`,
    rootName ? `Focus node: ${rootName}` : nodeId ? `Focus node ID: ${nodeId}` : "",
    rootType ? `Node type: ${rootType}` : "",
    childSummary ? `Visible child layers: ${childSummary}` : "",
    lastModified ? `Last modified: ${lastModified}` : "",
    `Figma file key: ${fileKey}`,
  ].filter(Boolean).join("\n").slice(0, 4_000);
  return {
    title: [fileName, rootName].filter(Boolean).join(" — ").slice(0, 320) || "Figma file",
    summary,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const action = url.pathname.split("/").filter(Boolean).pop() || "";

  if (action === "authorize" && req.method === "POST") {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY
      || !FIGMA_CLIENT_ID || !FIGMA_CLIENT_SECRET) {
      return jsonResponse({ error: "Figma OAuth is not configured" }, 503);
    }
    const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
    });
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) return jsonResponse({ error: "Not authenticated" }, 401);

    let body: { provider?: unknown; scopes?: unknown; client_nonce?: unknown } = {};
    try { body = await req.json(); } catch { /* invalid input handled below */ }
    if (body.provider !== undefined && body.provider !== "figma") {
      return jsonResponse({ error: "Unsupported provider" }, 400);
    }
    const clientNonce = typeof body.client_nonce === "string" ? body.client_nonce : "";
    const requestedScopes = body.scopes === undefined
      ? [FIGMA_SCOPE]
      : normalizeFigmaScopes(body.scopes);
    if (!OAUTH_NONCE_PATTERN.test(clientNonce)) {
      return jsonResponse({ error: "Invalid OAuth attempt nonce" }, 400);
    }
    if (hasUnsupportedFigmaScope(body.scopes)
      || requestedScopes.length !== 1
      || requestedScopes[0] !== FIGMA_SCOPE) {
      return jsonResponse({ error: "Only Figma file content read access is supported" }, 400);
    }

    const serverNonce = randomHex();
    const operationId = crypto.randomUUID();
    const { verifier, challenge } = await createPkcePair();
    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const reservationResult = await serviceClient.rpc("reserve_figma_oauth_authorization_v1", {
      p_user_id: user.id,
      p_state: serverNonce,
      p_client_nonce: clientNonce,
      p_code_verifier: verifier,
      p_requested_scopes: FIGMA_SCOPE,
      p_operation_id: operationId,
      p_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });
    const reservation = firstRpcRow(reservationResult.data);
    if (reservationResult.error
      || typeof reservation?.state_id !== "string"
      || !Number.isSafeInteger(Number(reservation.intent_epoch))
      || !Number.isSafeInteger(Number(reservation.credential_revision))
      || !normalizeFigmaScopes(reservation.required_scopes).includes(FIGMA_SCOPE)) {
      console.error("[figma-oauth] authorization reservation failed");
      return jsonResponse({ error: "Could not start the Figma connection" }, 503);
    }
    try {
      await serviceClient.rpc("cleanup_figma_oauth_states_v1", { p_limit: 500 });
    } catch {
      // Expired rows are also rejected by the claim function; cleanup is best effort.
    }

    const authUrl = new URL("https://www.figma.com/oauth");
    authUrl.searchParams.set("client_id", FIGMA_CLIENT_ID);
    authUrl.searchParams.set("redirect_uri", getCallbackUrl());
    authUrl.searchParams.set("scope", FIGMA_SCOPE);
    authUrl.searchParams.set("state", `${serverNonce}.${clientNonce}`);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("code_challenge", challenge);
    authUrl.searchParams.set("code_challenge_method", "S256");
    return jsonResponse({ url: authUrl.toString() });
  }

  if (action === "callback" && req.method === "GET") {
    const parsedState = parseCombinedOAuthState(url.searchParams.get("state") || "");
    if (!parsedState || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return oauthResultResponse({ success: false, error: "Invalid or expired state" });
    }
    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const claimResult = await serviceClient.rpc("claim_figma_oauth_state_v1", {
      p_state: parsedState.serverNonce,
      p_client_nonce: parsedState.clientNonce,
    });
    const state = firstRpcRow(claimResult.data);
    if (claimResult.error || !state) {
      if (claimResult.error) console.error("[figma-oauth] OAuth state claim failed");
      return oauthResultResponse({
        success: false,
        error: "Invalid or expired state",
        clientNonce: parsedState.clientNonce,
      });
    }

    const resultContext = { clientNonce: parsedState.clientNonce };
    const userId = typeof state.user_id === "string" ? state.user_id : "";
    const claimedClientNonce = typeof state.client_nonce === "string" ? state.client_nonce : "";
    const codeVerifier = typeof state.code_verifier === "string" ? state.code_verifier : "";
    const intentEpoch = Number(state.intent_epoch);
    const revision = Number(state.credential_revision);
    const operationId = typeof state.operation_id === "string" ? state.operation_id : "";
    const requiredScopes = normalizeFigmaScopes(state.required_scopes);
    if (!userId
      || claimedClientNonce !== parsedState.clientNonce
      || codeVerifier.length < 43
      || !Number.isSafeInteger(intentEpoch)
      || !Number.isSafeInteger(revision)
      || !operationId
      || requiredScopes.length !== 1
      || requiredScopes[0] !== FIGMA_SCOPE) {
      return oauthResultResponse({ ...resultContext, success: false, error: "Invalid or expired state" });
    }

    const providerError = url.searchParams.get("error");
    if (providerError) {
      return oauthResultResponse({
        ...resultContext,
        success: false,
        error: providerError === "access_denied" ? "Authorization was cancelled" : "Figma authorization failed",
      });
    }
    const code = url.searchParams.get("code") || "";
    if (!code || code.length > 4_096) {
      return oauthResultResponse({ ...resultContext, success: false, error: "Missing authorization code" });
    }
    if (!FIGMA_CLIENT_ID || !FIGMA_CLIENT_SECRET) {
      return oauthResultResponse({ ...resultContext, success: false, error: "Figma OAuth is not configured" });
    }

    let tokenResponse: TimedProviderResponse;
    try {
      tokenResponse = await fetchWithTimeout("https://api.figma.com/v1/oauth/token", {
        method: "POST",
        headers: {
          "Authorization": basicAuthorization(FIGMA_CLIENT_ID, FIGMA_CLIENT_SECRET),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          redirect_uri: getCallbackUrl(),
          code,
          grant_type: "authorization_code",
          code_verifier: codeVerifier,
        }),
      });
    } catch {
      console.error("[figma-oauth] token exchange transport failed");
      return oauthResultResponse({ ...resultContext, success: false, error: "Token exchange failed" });
    }
    if (!tokenResponse.response.ok) {
      tokenResponse.dispose();
      console.error(`[figma-oauth] token exchange failed (${tokenResponse.response.status})`);
      return oauthResultResponse({ ...resultContext, success: false, error: "Token exchange failed" });
    }
    const tokens = await readBoundedJson(tokenResponse, 64_000).catch(() => null) as Record<string, unknown> | null;
    const accessToken = typeof tokens?.access_token === "string" ? tokens.access_token : "";
    const refreshToken = typeof tokens?.refresh_token === "string" ? tokens.refresh_token : "";
    const providerSubject = typeof tokens?.user_id_string === "string" ? tokens.user_id_string : "";
    if (!accessToken || accessToken.length > 16_384
      || !refreshToken || refreshToken.length > 16_384
      || !providerSubject || providerSubject.length > 512) {
      return oauthResultResponse({ ...resultContext, success: false, error: "Figma returned an invalid token response" });
    }
    const expiresInRaw = Number(tokens?.expires_in);
    const expiresIn = Number.isFinite(expiresInRaw)
      ? Math.max(60, Math.min(expiresInRaw, 180 * 24 * 60 * 60))
      : 90 * 24 * 60 * 60;
    const commitResult = await serviceClient.rpc("commit_figma_oauth_authorization_v1", {
      p_user_id: userId,
      p_expected_intent_epoch: intentEpoch,
      p_expected_revision: revision,
      p_operation_id: operationId,
      p_access_token: accessToken,
      p_refresh_token: refreshToken,
      p_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
      p_provider_subject: providerSubject,
      p_granted_scopes: FIGMA_SCOPE,
    });
    const commit = firstRpcRow(commitResult.data);
    if (commitResult.error || commit?.applied !== true) {
      console.error("[figma-oauth] fenced authorization commit failed");
      return oauthResultResponse({ ...resultContext, success: false, error: "Could not save the Figma connection" });
    }
    return oauthResultResponse({ ...resultContext, success: true });
  }

  if (req.method !== "POST") return jsonResponse({ error: "Not found" }, 404);
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse({ error: "Connection service is unavailable" }, 503);
  }
  const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
  });
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return jsonResponse({ error: "Not authenticated" }, 401);

  if (action === "disconnect") {
    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const disconnectResult = await serviceClient.rpc("disconnect_figma_oauth_provider_v1", {
      p_user_id: user.id,
      p_operation_id: crypto.randomUUID(),
    });
    const disconnected = firstRpcRow(disconnectResult.data);
    if (disconnectResult.error || disconnected?.disconnected !== true) {
      console.error("[figma-oauth] disconnect persistence failed");
      return jsonResponse({ disconnected: false, error: "Could not disconnect Figma" }, 500);
    }
    return jsonResponse({ disconnected: true, provider: "figma" });
  }

  if (action === "status") {
    try {
      const credential = await resolveFreshFigmaCredential(user.id);
      if (!credential) return jsonResponse({ connected: false, provider: "figma" });
      return jsonResponse({
        connected: true,
        provider: "figma",
        accountId: credential.providerSubject.slice(0, 160),
      });
    } catch (error) {
      if (error instanceof FigmaReconnectRequiredError) {
        return jsonResponse({ connected: false, provider: "figma", reconnectRequired: true });
      }
      if (error instanceof FigmaRefreshBusyError) {
        return jsonResponse({ connected: false, provider: "figma", error: "Connection refresh is in progress" }, 409);
      }
      console.error("[figma-oauth] status lookup failed");
      return jsonResponse({ connected: false, provider: "figma", error: "Connection status is unavailable" }, 503);
    }
  }

  if (action === "file-summary") {
    let body: { fileKey?: unknown; nodeId?: unknown } = {};
    try { body = await req.json(); } catch { /* invalid input handled below */ }
    const fileKey = typeof body.fileKey === "string" ? body.fileKey : "";
    const nodeId = typeof body.nodeId === "string" && body.nodeId ? body.nodeId : null;
    if (!FIGMA_FILE_KEY_PATTERN.test(fileKey)
      || (nodeId !== null && !FIGMA_NODE_ID_PATTERN.test(nodeId))) {
      return jsonResponse({ error: "Invalid Figma file locator" }, 400);
    }

    let credential: ActiveFigmaCredential | null;
    try {
      credential = await resolveFreshFigmaCredential(user.id);
    } catch (error) {
      if (error instanceof FigmaReconnectRequiredError) {
        return jsonResponse({ error: "Reconnect Figma to read this file", reconnectRequired: true }, 409);
      }
      if (error instanceof FigmaRefreshBusyError) {
        return jsonResponse({ error: "Figma connection refresh is in progress" }, 409);
      }
      return jsonResponse({ error: "Figma connection is unavailable" }, 503);
    }
    if (!credential) return jsonResponse({ error: "Connect Figma to read this file", connected: false }, 409);

    const endpoint = nodeId
      ? `https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}/nodes?ids=${encodeURIComponent(nodeId)}&depth=3`
      : `https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}?depth=2`;
    let timedResponse: TimedProviderResponse;
    try {
      timedResponse = await fetchWithTimeout(endpoint, {
        method: "GET",
        headers: { Authorization: `Bearer ${credential.accessToken}` },
      }, req.signal);
    } catch {
      return jsonResponse({ error: "Figma did not respond" }, 502);
    }
    const response = timedResponse.response;
    if (isFigmaFileCredentialRejectionStatus(response.status)) {
      timedResponse.dispose();
      let invalidated: boolean;
      try {
        invalidated = await invalidateRejectedFigmaCredential(
          user.id,
          credential.intentEpoch,
          credential.credentialRevision,
        );
      } catch {
        console.error("[figma-oauth] provider rejection invalidation failed");
        return jsonResponse({ error: "Figma connection state is unavailable" }, 503);
      }
      if (invalidated) {
        return jsonResponse({ error: "Reconnect Figma to read this file", reconnectRequired: true }, 409);
      }
      return jsonResponse({ error: "Figma connection changed; retry with the current account" }, 409);
    }
    if (response.status === 404) {
      timedResponse.dispose();
      return jsonResponse({ error: "This Figma file is unavailable to the connected account" }, 404);
    }
    if (!response.ok) {
      timedResponse.dispose();
      return jsonResponse({ error: "Figma file lookup failed" }, 502);
    }

    let payload: unknown;
    try {
      payload = await readBoundedJson(timedResponse, 2_000_000);
    } catch (error) {
      if (error instanceof ProviderResponseTooLargeError) {
        return jsonResponse({
          error: "This Figma file is too large for a bounded root summary; use a specific frame or node link",
          errorCode: "file_response_too_large",
        }, 413);
      }
      return jsonResponse({ error: "Figma returned an invalid file response" }, 502);
    }
    const reference = buildFileReference(payload, fileKey, nodeId);
    if (!reference) return jsonResponse({ error: "Figma returned an invalid file response" }, 502);
    return jsonResponse({ reference });
  }

  return jsonResponse({ error: "Not found" }, 404);
});
