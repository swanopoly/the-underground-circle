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

export interface ResolvedApiKey {
  apiKey: string;
  endpoint?: string | null;
  source: ApiKeySource;
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
    "openai-embed": "OpenAI",
    openrouter: "OpenRouter",
    groq: "Groq",
    ollama: "Ollama",
    replicate: "Replicate",
    "github-models": "GitHub Models",
    huggingface: "Hugging Face",
    zai: "z.ai",
    minimax: "MiniMax",
  };
  return names[provider] || provider;
}

export function byokMissingMessage(provider: string): string {
  return `Add your own ${providerDisplayName(provider)} API key in Office > Customize > API Keys to use this model. Platform model keys are reserved for owner/test accounts.`;
}

export async function getUserStoredApiKey(
  supabase: any,
  userId: string,
  provider: string,
  label = "default",
): Promise<{ apiKey: string; endpoint?: string | null } | null> {
  const { data, error } = await supabase.rpc("get_user_api_key", {
    p_user_id: userId,
    p_provider: provider,
    p_label: label,
  });

  if (error || !data) return null;
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
  label?: string;
  requestApiKey?: string | null;
  envVarName?: string;
}): Promise<ResolvedApiKey | null> {
  const requestKey = opts.requestApiKey?.trim();
  if (requestKey) {
    return { apiKey: requestKey, source: "request" };
  }

  const stored = await getUserStoredApiKey(
    opts.supabase,
    opts.userId,
    opts.storageProvider || opts.provider,
    opts.label || "default",
  );
  if (stored?.apiKey) {
    return { ...stored, source: "user" };
  }

  const platformKey = opts.envVarName ? Deno.env.get(opts.envVarName) : null;
  if (platformKey && canUsePlatformModelKey(opts.userId)) {
    return { apiKey: platformKey, source: "platform" };
  }

  return null;
}
