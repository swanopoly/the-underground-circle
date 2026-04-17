import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export type BillingErrorCode =
  | "config_missing"
  | "validation"
  | "unauthenticated"
  | "forbidden"
  | "org_not_found"
  | "no_billing_account"
  | "stripe_invalid_price"
  | "stripe_error"
  | "internal";

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function errResponse(status: number, code: BillingErrorCode, message: string): Response {
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

export async function getAuthenticatedUser(req: Request) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) {
    return null;
  }

  const anonClient = createClient(
    getRequiredEnv("SUPABASE_URL"),
    getRequiredEnv("SUPABASE_ANON_KEY"),
  );

  const { data: { user } } = await anonClient.auth.getUser(token);
  return user ?? null;
}

export async function requireOrgAdmin(
  supabase: ReturnType<typeof createServiceRoleClient>,
  orgId: string,
  userId: string,
): Promise<boolean> {
  const { data: membership } = await supabase
    .from("org_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .single();

  return !!membership && ["owner", "admin"].includes(membership.role);
}
