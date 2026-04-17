import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
