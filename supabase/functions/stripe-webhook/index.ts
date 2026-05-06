// Stripe Webhook Handler — Supabase Edge Function
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";
import Stripe from "https://esm.sh/stripe@14.14.0?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Map Stripe price IDs to plan names (configure these after creating products)
const PRICE_TO_PLAN: Record<string, string> = {
  // Set these in Supabase env vars or hardcode after Stripe setup
  // "price_xxx": "pro",
  // "price_yyy": "business",
};

function getPlanFromSubscription(subscription: any): string {
  // Try to get plan from price metadata first
  const item = subscription.items?.data?.[0];
  if (item?.price?.metadata?.plan) return item.price.metadata.plan;
  if (item?.price?.id && PRICE_TO_PLAN[item.price.id]) return PRICE_TO_PLAN[item.price.id];

  // Fallback: infer from price amount
  const amount = item?.price?.unit_amount || 0;
  if (amount >= 9900) return "business";
  if (amount >= 2900) return "pro";
  return "free";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
      apiVersion: "2023-10-16",
    });

    const body = await req.text();
    const signature = req.headers.get("stripe-signature")!;
    const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    } catch (err: any) {
      console.error("Webhook signature verification failed:", err.message);
      return new Response(
        JSON.stringify({ error: "Invalid signature" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Log the event
    const { error: billingEventError } = await supabase.from("billing_events").insert({
      org_id: null, // will be set below if we can identify the org
      stripe_event_id: event.id,
      event_type: event.type,
      data: event.data.object as any,
    });
    if (billingEventError) {
      console.warn("Billing event log failed:", billingEventError.message);
    }

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const orgId = session.subscription
          ? (await stripe.subscriptions.retrieve(session.subscription as string)).metadata.org_id
          : session.metadata?.org_id;

        if (orgId && session.subscription) {
          const subscription = await stripe.subscriptions.retrieve(session.subscription as string);
          const plan = getPlanFromSubscription(subscription);

          await supabase.from("organizations").update({
            plan,
            stripe_subscription_id: subscription.id,
            stripe_customer_id: session.customer as string,
            subscription_status: "active",
            updated_at: new Date().toISOString(),
          }).eq("id", orgId);

          // Update billing_events with org_id
          await supabase.from("billing_events")
            .update({ org_id: orgId })
            .eq("stripe_event_id", event.id);
        }
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const orgId = subscription.metadata.org_id;

        if (orgId) {
          const plan = getPlanFromSubscription(subscription);
          await supabase.from("organizations").update({
            plan,
            subscription_status: subscription.status === "active" ? "active" : subscription.status,
            updated_at: new Date().toISOString(),
          }).eq("id", orgId);

          await supabase.from("billing_events")
            .update({ org_id: orgId })
            .eq("stripe_event_id", event.id);
        }
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const orgId = subscription.metadata.org_id;

        if (orgId) {
          await supabase.from("organizations").update({
            plan: "free",
            subscription_status: "canceled",
            stripe_subscription_id: null,
            updated_at: new Date().toISOString(),
          }).eq("id", orgId);

          await supabase.from("billing_events")
            .update({ org_id: orgId })
            .eq("stripe_event_id", event.id);
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;

        const { data: org } = await supabase
          .from("organizations")
          .select("id")
          .eq("stripe_customer_id", customerId)
          .single();

        if (org) {
          await supabase.from("organizations").update({
            subscription_status: "past_due",
            updated_at: new Date().toISOString(),
          }).eq("id", org.id);

          await supabase.from("billing_events")
            .update({ org_id: org.id })
            .eq("stripe_event_id", event.id);
        }
        break;
      }

      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;

        const { data: org } = await supabase
          .from("organizations")
          .select("id")
          .eq("stripe_customer_id", customerId)
          .single();

        if (org) {
          await supabase.from("organizations").update({
            subscription_status: "active",
            updated_at: new Date().toISOString(),
          }).eq("id", org.id);

          await supabase.from("billing_events")
            .update({ org_id: org.id })
            .eq("stripe_event_id", event.id);
        }
        break;
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Stripe webhook error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
