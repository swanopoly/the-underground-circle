import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function errResponse(status: number, code: string, message: string): Response {
  return jsonResponse({ error: message, code }, status);
}

export function getRequiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export function createServiceRoleClient() {
  return createClient(
    getRequiredEnv("SUPABASE_URL"),
    getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
  );
}

export function getBearerToken(req: Request): string | null {
  const authHeader = req.headers.get("Authorization") || req.headers.get("authorization") || "";
  const [scheme, token] = authHeader.split(/\s+/, 2);
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") {
    return null;
  }
  return token;
}

export function isServiceRoleRequest(req: Request): boolean {
  const token = getBearerToken(req);
  if (!token) {
    return false;
  }
  return token === getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");
}

export async function getAuthenticatedUser(req: Request) {
  const authHeader = req.headers.get("Authorization") || req.headers.get("authorization") || "";
  if (!authHeader) {
    return null;
  }

  const anonClient = createClient(
    getRequiredEnv("SUPABASE_URL"),
    getRequiredEnv("SUPABASE_ANON_KEY"),
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: auth } = await anonClient.auth.getUser();
  return auth.user ?? null;
}

export type ApiKeySource = "request" | "user" | "platform";

/**
 * Credential source policy for server-side model calls.
 *
 * `user_then_platform` preserves the legacy owner/test fallback behavior.
 * Public BYOK surfaces should opt into `user_required` so an authenticated
 * user's request can never silently spend a platform credential.
 */
export type CredentialPolicy = "user_required" | "user_then_platform";

export interface ResolvedApiKey {
  apiKey: string;
  endpoint?: string | null;
  source: ApiKeySource;
}

/**
 * A stored credential row exists or its lookup failed, but the Edge runtime
 * could not safely read it. Keep this distinct from an absent key so callers
 * never tell the user to add a duplicate key when the actual problem is
 * ciphertext/key-version or database health.
 */
export class StoredApiKeyLookupError extends Error {
  readonly code = "credential_unreadable" as const;

  constructor(provider?: string) {
    super(byokUnreadableMessage(provider));
    this.name = "StoredApiKeyLookupError";
  }
}

function envList(name: string): string[] {
  return (Deno.env.get(name) || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function canUsePlatformModelKey(userId: string | null | undefined): boolean {
  if (Deno.env.get("ALLOW_PLATFORM_MODEL_KEYS_FOR_ALL") === "true") {
    return true;
  }
  if (!userId) return false;

  const allowlist = new Set([
    ...envList("PLATFORM_API_ALLOWLIST_USER_IDS"),
    ...envList("APP_OWNER_USER_IDS"),
    ...envList("OWNER_USER_IDS"),
  ]);
  return allowlist.has(userId);
}

export function providerDisplayName(provider: string): string {
  const names: Record<string, string> = {
    anthropic: "Anthropic",
    openai: "OpenAI",
    openai_compatible: "OpenAI-compatible business model",
    "openai-embed": "OpenAI",
    openrouter: "OpenRouter",
    groq: "Groq",
    ollama: "Ollama",
    replicate: "Replicate",
    "github-models": "GitHub Models",
    huggingface: "Hugging Face",
    zai: "z.ai",
    minimax: "MiniMax",
    google_ai: "Google AI",
    mistral_ai: "Mistral AI",
    cohere: "Cohere",
    perplexity: "Perplexity",
    together_ai: "Together AI",
    fireworks_ai: "Fireworks AI",
    deepseek: "DeepSeek",
    brave: "Brave Search",
  };
  return names[provider] || provider;
}

export function byokMissingMessage(provider: string): string {
  return `Connect your ${providerDisplayName(provider)} API key in Marketplace → Models, then retry.`;
}

export function byokUnreadableMessage(provider?: string): string {
  const credential = provider
    ? `saved ${providerDisplayName(provider)} API key`
    : "saved provider API key";
  return `Your ${credential} could not be read. Replace it in Marketplace → Models, then retry.`;
}

export async function getUserStoredApiKey(
  supabase: any,
  userId: string,
  provider: string,
  label: string | null = "default",
): Promise<{ apiKey: string; endpoint?: string | null } | null> {
  const { data, error } = await supabase.rpc("get_user_api_key", {
    p_user_id: userId,
    p_provider: provider,
    p_label: label,
  });

  if (error) throw new StoredApiKeyLookupError(provider);
  if (!data) return null;
  const row = Array.isArray(data) ? data[0] : data;
  if (typeof row === "string" && row.trim()) return { apiKey: row.trim() };
  if (row?.api_key && typeof row.api_key === "string") {
    return { apiKey: row.api_key, endpoint: row.endpoint ?? null };
  }
  return null;
}

export async function resolveUserModelApiKey(opts: {
  supabase: any;
  userId: string;
  provider: string;
  storageProvider?: string;
  /** Omitted selects `default`; explicit null selects the latest active row. */
  label?: string | null;
  requestApiKey?: string | null;
  envVarName?: string;
  /** Defaults to the legacy user-first, allowlisted-platform-fallback policy. */
  credentialPolicy?: CredentialPolicy;
  /**
   * Opt-in while callers migrate to a structured credential-health response.
   * Legacy functions keep their prior null/missing behavior instead of
   * unexpectedly turning an existing deployment into an unhandled 500.
   */
  failOnStoredLookupError?: boolean;
}): Promise<ResolvedApiKey | null> {
  const requestKey = opts.requestApiKey?.trim();
  if (requestKey) {
    return { apiKey: requestKey, source: "request" };
  }

  const credentialPolicy = opts.credentialPolicy ?? "user_then_platform";
  const lookupLabel = opts.label === undefined ? "default" : opts.label;
  let stored: { apiKey: string; endpoint?: string | null } | null = null;
  let storedLookupError: StoredApiKeyLookupError | null = null;
  try {
    stored = await getUserStoredApiKey(
      opts.supabase,
      opts.userId,
      opts.storageProvider || opts.provider,
      lookupLabel,
    );
  } catch (error) {
    if (!(error instanceof StoredApiKeyLookupError)) throw error;
    // A user-required call must surface damaged/unreadable ciphertext now. It
    // must not inspect a platform environment variable or hide the condition
    // behind an owner/test fallback.
    if (credentialPolicy === "user_required") throw error;
    storedLookupError = error;
  }
  if (stored?.apiKey) {
    return { ...stored, source: "user" };
  }

  // This return intentionally precedes every Deno.env/platform-key read.
  if (credentialPolicy === "user_required") return null;

  const platformKey = opts.envVarName ? Deno.env.get(opts.envVarName) : null;
  if (platformKey && canUsePlatformModelKey(opts.userId)) {
    return { apiKey: platformKey, source: "platform" };
  }

  if (storedLookupError && opts.failOnStoredLookupError === true) throw storedLookupError;

  return null;
}

/**
 * True if `userId` belongs to the org and/or circle that owns an integration
 * connection. Used to authorize outbound actions (Slack/Teams) so a caller
 * cannot drive a connection they don't belong to by guessing connectionId
 * (IDOR → message spoofing into any connected workspace).
 */
export async function userOwnsConnection(
  supabase: any,
  userId: string,
  orgId: string | null,
  circleId: string | null,
): Promise<boolean> {
  if (circleId) {
    const { data } = await supabase
      .from("circle_members")
      .select("user_id")
      .eq("circle_id", circleId)
      .eq("user_id", userId)
      .maybeSingle();
    if (data) return true;
  }
  if (orgId) {
    const { data } = await supabase
      .from("org_members")
      .select("user_id")
      .eq("org_id", orgId)
      .eq("user_id", userId)
      .maybeSingle();
    if (data) return true;
  }
  return false;
}
