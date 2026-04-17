// Stripe Checkout Session Creator — Supabase Edge Function
//
// Returns a URL the client redirects to for Stripe-hosted checkout. Errors
// come back as { error, code } so the client can distinguish config issues
// (missing env) from runtime issues (bad price ID, no payment method on file).
//
// Error codes:
//   config_missing      — STRIPE_SECRET_KEY not set on the edge function
//   validation          — orgId/priceId missing from request body
//   unauthenticated     — no valid Supabase auth token on request
//   forbidden           — caller isn't org owner/admin
//   org_not_found       — the orgId doesn't exist or isn't visible
//   stripe_invalid_price — Stripe rejected the price_xxx ID
//   stripe_error        — any other Stripe API error (message passed through)
//   internal            — unclassified
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

  // Fail fast on missing secrets rather than making Stripe reject with a
  // confusing error. This is the #1 cause of "why doesn't my checkout work".
  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  if (!stripeKey) {
    console.error("[create-checkout] STRIPE_SECRET_KEY not set");
    return errResponse(
      500,
      "config_missing",
      "Stripe is not configured on the server. Set STRIPE_SECRET_KEY via `npx supabase secrets set` and redeploy the edge function."
    );
  }

  try {
    const { orgId, priceId, successUrl, cancelUrl } = await req.json();

    if (!orgId || !priceId) {
      return errResponse(400, "validation", "Missing orgId or priceId in request body.");
    }

    const supabase = createServiceRoleClient();
    const user = await getAuthenticatedUser(req);

    if (!user) {
      return errResponse(401, "unauthenticated", "Not authenticated.");
    }

    const isOrgAdmin = await requireOrgAdmin(supabase, orgId, user.id);
    if (!isOrgAdmin) {
      return errResponse(403, "forbidden", "You must be an org owner or admin to start a checkout.");
    }

    const { data: org } = await supabase
      .from("organizations")
      .select("stripe_customer_id, name, seat_count")
      .eq("id", orgId)
      .single();

    if (!org) {
      return errResponse(404, "org_not_found", "Organization not found or not accessible.");
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2023-10-16" });

    let customerId = org.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        name: org.name || "Organization",
        metadata: { org_id: orgId, user_id: user.id },
      });
      customerId = customer.id;

      await supabase
        .from("organizations")
        .update({ stripe_customer_id: customerId })
        .eq("id", orgId);
    }

    let session;
    try {
      session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        line_items: [
          { price: priceId, quantity: org.seat_count || 1 },
        ],
        subscription_data: {
          metadata: { org_id: orgId },
        },
        success_url: successUrl || `https://app.chrisswanson.xyz/org/${orgId}?billing=success`,
        cancel_url: cancelUrl || `https://app.chrisswanson.xyz/org/${orgId}?billing=canceled`,
      });
    } catch (stripeError: any) {
      // Stripe errors come with a `.type` and `.code`. Surface invalid-price
      // specifically because that's the most common config mistake.
      console.error("[create-checkout] Stripe error:", stripeError?.type, stripeError?.code, stripeError?.message);
      if (stripeError?.code === "resource_missing" && stripeError?.param === "line_items[0][price]") {
        return errResponse(
          400,
          "stripe_invalid_price",
          `Stripe does not recognize price ID "${priceId}". Double-check it exists in your Stripe Dashboard (and that you're using the right mode — test vs live).`
        );
      }
      return errResponse(
        502,
        "stripe_error",
        stripeError?.message || "Stripe rejected the checkout request."
      );
    }

    return jsonResponse({ sessionId: session.id, url: session.url });
  } catch (error: any) {
    console.error("[create-checkout] internal error:", error);
    return errResponse(500, "internal", error?.message || "Internal server error");
  }
});
