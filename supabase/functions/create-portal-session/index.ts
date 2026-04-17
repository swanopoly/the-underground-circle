// Stripe Customer Portal Session — Supabase Edge Function
import Stripe from "https://esm.sh/stripe@14.14.0?target=deno";
import {
  corsHeaders,
  createServiceRoleClient,
  errResponse,
  getAuthenticatedUser,
  jsonResponse,
  requireOrgAdmin,
} from "../_shared/billing.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  if (!stripeKey) {
    console.error("[create-portal-session] STRIPE_SECRET_KEY not set");
    return errResponse(
      500,
      "config_missing",
      "Stripe is not configured on the server. Set STRIPE_SECRET_KEY via `npx supabase secrets set` and redeploy the edge function."
    );
  }

  try {
    const { orgId, returnUrl } = await req.json();

    if (!orgId) {
      return errResponse(400, "validation", "Missing orgId in request body.");
    }

    const supabase = createServiceRoleClient();

    const user = await getAuthenticatedUser(req);

    if (!user) {
      return errResponse(401, "unauthenticated", "Not authenticated.");
    }

    const isOrgAdmin = await requireOrgAdmin(supabase, orgId, user.id);
    if (!isOrgAdmin) {
      return errResponse(403, "forbidden", "You must be an org owner or admin to open the billing portal.");
    }

    const { data: org } = await supabase
      .from("organizations")
      .select("stripe_customer_id")
      .eq("id", orgId)
      .single();

    if (!org) {
      return errResponse(404, "org_not_found", "Organization not found or not accessible.");
    }

    if (!org.stripe_customer_id) {
      return errResponse(400, "no_billing_account", "No billing account exists yet. Upgrade first.");
    }

    const stripe = new Stripe(stripeKey, {
      apiVersion: "2023-10-16",
    });

    let session;
    try {
      session = await stripe.billingPortal.sessions.create({
        customer: org.stripe_customer_id,
        return_url: returnUrl || `https://app.chrisswanson.xyz/org/${orgId}`,
      });
    } catch (stripeError: any) {
      console.error("[create-portal-session] Stripe error:", stripeError?.type, stripeError?.code, stripeError?.message);
      return errResponse(
        502,
        "stripe_error",
        stripeError?.message || "Stripe rejected the billing portal request."
      );
    }

    return jsonResponse({ url: session.url });
  } catch (error: any) {
    console.error("[create-portal-session] internal error:", error);
    return errResponse(500, "internal", error?.message || "Internal server error");
  }
});
