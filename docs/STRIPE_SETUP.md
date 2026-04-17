# Stripe Setup Guide — The Underground Circle

End-to-end checklist to take the billing system from "code is wired" to "users can actually pay." The code changes are done; this doc covers the Stripe Dashboard + env var configuration that only you can do.

**Estimated setup time:** 30–45 minutes.

---

## 1. Stripe Dashboard — create products + prices

Go to <https://dashboard.stripe.com/products> (start in **Test mode** — toggle top-right).

Create **two products**:

### Product A: "Underground Circle — Pro"
- Add two prices:
  - **Pro Monthly** — $29/mo recurring
  - **Pro Annual** — $290/yr recurring (works out to ~$24/mo, 2 months free)

### Product B: "Underground Circle — Business"
- Add two prices:
  - **Business Monthly** — $99/mo recurring
  - **Business Annual** — $990/yr recurring

**Copy the four `price_xxxxxx` IDs** from the product detail pages — you'll need them in step 2.

> **Note on seat-based pricing**: `create-checkout/index.ts` passes `quantity: org.seat_count` to Stripe. If you want per-seat billing later, switch the products to "Per-unit pricing" in Stripe; the code already sends the quantity. For now, a single-seat subscription is the simplest path.

---

## 2. Client env vars — price IDs

These are **public** identifiers (safe to ship in the client bundle — they're not secrets). They must be prefixed with `EXPO_PUBLIC_` so Expo/Metro inlines them at build time.

Add to `.env` (local dev) **and** Netlify → Site settings → Environment variables (production):

```bash
EXPO_PUBLIC_STRIPE_PRICE_PRO_MONTHLY=price_xxxxxxxxxxxxxxxxxxx
EXPO_PUBLIC_STRIPE_PRICE_PRO_ANNUAL=price_xxxxxxxxxxxxxxxxxxx
EXPO_PUBLIC_STRIPE_PRICE_BUSINESS_MONTHLY=price_xxxxxxxxxxxxxxxxxxx
EXPO_PUBLIC_STRIPE_PRICE_BUSINESS_ANNUAL=price_xxxxxxxxxxxxxxxxxxx
```

**Rebuild required** — Expo only inlines env vars at build time. After adding them:
- Local: `npm run web` (restart dev server)
- Netlify: trigger a redeploy

> **Validation:** `src/lib/pricing.ts::getPriceId()` will refuse to start a checkout if the env var is missing or still contains the literal string `placeholder`. You'll see a clear error in the BillingScreen ("Stripe Price ID for pro/monthly is not configured. Set EXPO_PUBLIC_STRIPE_PRICE_PRO_MONTHLY…") instead of a silent failure.

---

## 3. Server env vars — Stripe secrets

These are **secrets** — they must only exist on the edge functions, never in the client bundle.

Get them from Stripe Dashboard → Developers → API keys:
- **Secret key** → starts with `sk_test_` (test mode) or `sk_live_` (live mode)

Set via Supabase CLI:

```bash
npx supabase secrets set STRIPE_SECRET_KEY=sk_test_xxxxxxxxxxxxxxxxxxx
```

The `STRIPE_WEBHOOK_SECRET` comes from step 4 — set it after creating the webhook endpoint.

---

## 4. Configure the Stripe webhook endpoint

Go to <https://dashboard.stripe.com/webhooks> → **Add endpoint**.

- **Endpoint URL**:
  ```
  https://rjkniqiqdtroeholxacg.supabase.co/functions/v1/stripe-webhook
  ```
- **Description**: "UC billing events"
- **Events to send** (select these exact 5 — that's what `stripe-webhook/index.ts` handles):
  - `checkout.session.completed`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_failed`
  - `invoice.paid`

After creating, Stripe shows a **Signing secret** (starts with `whsec_`). Set it:

```bash
npx supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxxxxx
```

---

## 5. Deploy the edge functions

All three functions need the secrets from steps 3+4:

```bash
npx supabase functions deploy create-checkout
npx supabase functions deploy create-portal-session
npx supabase functions deploy stripe-webhook
```

After deploy, check the logs panel in Supabase Dashboard → Edge Functions for any startup errors.

---

## 6. Run the realtime migration

Enable realtime broadcast on `organizations` + `org_features` so feature gates auto-invalidate when the webhook writes a new plan:

```sql
-- From supabase/migrations/20260414_organizations_realtime.sql
DO $$ BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE organizations;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END; $$;

DO $$ BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE org_features;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END; $$;

NOTIFY pgrst, 'reload schema';
```

---

## 7. Smoke test — the full checkout loop

With all six steps done, walk through this end-to-end in **test mode**:

1. **Sign in** and navigate to an organization's Billing screen.
2. **Verify the plan cards show**: `$29/mo` (Pro Monthly), toggle to Annual → `$24/mo · save $58/yr`.
3. **Click "Upgrade to Pro"** → should redirect to `checkout.stripe.com`.
4. **Use Stripe test card** `4242 4242 4242 4242`, any future expiry, any CVC, any ZIP.
5. **Submit** → Stripe redirects back to `/org/{orgId}?billing=success`.
6. **Within ~3 seconds** the BillingScreen should update from "FREE" to "PRO" (the polling loop catches the webhook-driven plan change).
7. **Check Billing History** — you should see `checkout.session.completed` and `invoice.paid` events with today's timestamp.
8. **Open a feature-gated surface** elsewhere in the app (e.g., analytics). It should now be accessible without a reload — the realtime subscription from step 6 flips `features.analytics_enabled` to `true`.
9. **Click "Manage Subscription"** → redirects to Stripe billing portal; verify you can see the active subscription and update payment method.

---

## 8. Going live

When test mode works end-to-end:

1. **Toggle Stripe Dashboard to Live mode** (top-right).
2. **Re-create the products + prices in live mode** (Stripe doesn't migrate them).
3. **Copy the live `price_xxx` IDs** and update the `EXPO_PUBLIC_STRIPE_PRICE_*` env vars in Netlify.
4. **Get the live Stripe secret key** (starts with `sk_live_`) and set it: `npx supabase secrets set STRIPE_SECRET_KEY=sk_live_xxx`.
5. **Add a live-mode webhook endpoint** (same URL, new endpoint in live mode, new `whsec_xxx`).
6. **Update `STRIPE_WEBHOOK_SECRET`** with the live signing secret.
7. **Redeploy edge functions** so they pick up the new secrets: `npx supabase functions deploy stripe-webhook`.
8. **Re-smoke-test** in live mode with a real card, then immediately refund it from Stripe Dashboard.

---

## Troubleshooting

### "Stripe Price ID for pro/monthly is not configured"
Env var missing. Check `.env` locally, Netlify env vars in production. Remember to **rebuild** after adding.

### "Stripe does not recognize price ID"
You're using a test-mode price ID with a live secret key (or vice versa), OR the price was deleted, OR the product is archived. Open Stripe Dashboard, confirm mode (test/live), confirm the price is active.

### Checkout succeeds but plan stays "free" in-app
The webhook isn't reaching the edge function. Check:
1. **Stripe Dashboard → Webhooks → the endpoint**: "Event attempts" panel shows what was sent and the response. 200 = success, anything else = problem.
2. **`STRIPE_WEBHOOK_SECRET` matches** the endpoint's signing secret (different secrets for test/live mode).
3. **Edge function logs** (Supabase Dashboard → Edge Functions → stripe-webhook → Logs).

### `billing_events` table empty after checkout
Same as above — webhook isn't firing or the function is erroring before the insert.

### Feature gates stay stale after upgrade
The realtime migration (step 6) wasn't run, OR the user's client lost its realtime connection. Fallback: `useOrg.refresh()` is available — can be called manually.

### Users in native apps can't check out
`Linking.openURL(session.url)` opens the URL in their browser. Works on iOS/Android; the return URL brings them back to the app via deep link (already configured in `app.json` scheme).

---

## Reference: file map

| Concern | File |
|---|---|
| Pricing tier display + price ID lookup | `src/lib/pricing.ts` |
| Plan limits + feature flags | `src/lib/billing.ts` |
| Client checkout invocation | `src/lib/billing.ts::createCheckoutSession` |
| Billing screen UI | `src/screens/organizations/BillingScreen.tsx` |
| Feature gating hook | `src/hooks/useFeatureGate.ts` + `src/hooks/useOrg.ts` |
| Checkout edge function | `supabase/functions/create-checkout/index.ts` |
| Portal edge function | `supabase/functions/create-portal-session/index.ts` |
| Webhook handler | `supabase/functions/stripe-webhook/index.ts` |
| Org + billing schema | `supabase/migrations/20260303_organizations.sql`, `20260303_billing.sql` |
| Realtime broadcast opt-in | `supabase/migrations/20260414_organizations_realtime.sql` |
