/**
 * Pricing — single source of truth for subscription tiers, display metadata,
 * and Stripe Price ID lookup.
 *
 * Tier limits/feature flags live in `billing.ts` (used by the feature-gate
 * system). This file owns the *marketing* view + the Stripe wiring.
 *
 * ── How price IDs work ─────────────────────────────────────────────────────
 * Price IDs come from Stripe Dashboard → Products. Each tier × interval
 * (monthly/annual) is a separate Price. Stripe conventionally priced annual
 * plans as "12 × monthly − 2 months" (i.e., 2 months free).
 *
 * ── Env vars ───────────────────────────────────────────────────────────────
 * Public price IDs are safe to ship in the client bundle (they're identifiers,
 * not secrets). The actual STRIPE_SECRET_KEY only lives in the edge function.
 *
 * Expo/Metro inlines `process.env.EXPO_PUBLIC_*` at build time via static
 * analysis — dynamic `process.env[key]` lookups won't work. That's why the
 * map below uses literal property reads.
 *
 *   EXPO_PUBLIC_STRIPE_PRICE_PRO_MONTHLY
 *   EXPO_PUBLIC_STRIPE_PRICE_PRO_ANNUAL
 *   EXPO_PUBLIC_STRIPE_PRICE_BUSINESS_MONTHLY
 *   EXPO_PUBLIC_STRIPE_PRICE_BUSINESS_ANNUAL
 */

export type PlanTier = 'free' | 'pro' | 'business' | 'enterprise';
export type BillingInterval = 'monthly' | 'annual';

// ─── Tier display metadata ──────────────────────────────────────────────────

export interface TierDisplay {
  tier: PlanTier;
  name: string;             // short human name ("Pro")
  tagline: string;          // one-line positioning
  color: string;            // accent color
  monthlyPrice: number;     // USD, 0 for free/enterprise
  annualPrice: number;      // USD, annual total (= monthly × 10 for "2 months free")
  features: string[];       // checklist, in order of importance
  highlight?: boolean;      // "most popular" visual emphasis
  ctaLabel: string;         // button text
  // How the tier is acquired. 'self-serve' flows through Stripe Checkout;
  // 'contact' shows a mailto or similar (enterprise typically).
  sellsOn: 'self-serve' | 'contact' | 'current';
  // Contact target for 'contact' tier
  contactTarget?: string;
}

export const TIERS: TierDisplay[] = [
  {
    tier: 'free',
    name: 'Free',
    tagline: 'Start with your crew',
    color: '#6b7280',
    monthlyPrice: 0,
    annualPrice: 0,
    features: [
      '1 circle',
      '8 members per circle',
      'Missions + proof-of-work',
      'BlackSwan basic (cloud)',
      '7 days history',
    ],
    ctaLabel: 'Current plan',
    sellsOn: 'current',
  },
  {
    tier: 'pro',
    name: 'Pro',
    tagline: 'For teams shipping together',
    color: '#6366f1',
    monthlyPrice: 29,
    annualPrice: 290, // 2 months free
    features: [
      '5 circles',
      '25 members per circle',
      'Analytics + insights',
      'Slack integration',
      'CSV export',
      '90 days history',
    ],
    highlight: true,
    ctaLabel: 'Upgrade to Pro',
    sellsOn: 'self-serve',
  },
  {
    tier: 'business',
    name: 'Business',
    tagline: 'Full stack for serious crews',
    color: '#f59e0b',
    monthlyPrice: 99,
    annualPrice: 990,
    features: [
      'Unlimited circles',
      '100 members per circle',
      'Full analytics suite',
      'Slack + Teams',
      'PDF reports + goal alignment',
      'Priority BlackSwan',
      '1 year history',
    ],
    ctaLabel: 'Upgrade to Business',
    sellsOn: 'self-serve',
  },
  {
    tier: 'enterprise',
    name: 'Enterprise',
    tagline: 'Your org, your rules',
    color: '#ec4899',
    monthlyPrice: 0,
    annualPrice: 0,
    features: [
      'Unlimited everything',
      'SAML SSO',
      'White-label + custom domain',
      'Audit logs + data export',
      'SLA + dedicated support',
    ],
    ctaLabel: 'Contact sales',
    sellsOn: 'contact',
    contactTarget: 'mailto:sales@chrisswanson.xyz?subject=Underground%20Circle%20Enterprise',
  },
];

export function getTier(tier: PlanTier): TierDisplay {
  const found = TIERS.find(t => t.tier === tier);
  if (!found) throw new Error(`Unknown tier: ${tier}`);
  return found;
}

// ─── Price ID lookup ────────────────────────────────────────────────────────

// Static map — values are inlined by Metro at build time. Don't refactor to
// dynamic `process.env[key]` — Expo's bundler won't replace those.
const PRICE_IDS: Record<PlanTier, Partial<Record<BillingInterval, string | undefined>>> = {
  free: {},
  pro: {
    monthly: process.env.EXPO_PUBLIC_STRIPE_PRICE_PRO_MONTHLY,
    annual: process.env.EXPO_PUBLIC_STRIPE_PRICE_PRO_ANNUAL,
  },
  business: {
    monthly: process.env.EXPO_PUBLIC_STRIPE_PRICE_BUSINESS_MONTHLY,
    annual: process.env.EXPO_PUBLIC_STRIPE_PRICE_BUSINESS_ANNUAL,
  },
  enterprise: {},
};

// Matches Stripe's own price-id format so we can reject obvious placeholders.
const STRIPE_PRICE_ID_PATTERN = /^price_[A-Za-z0-9]+$/;

export interface PriceLookupOk {
  ok: true;
  priceId: string;
  envVar: string;
}
export interface PriceLookupErr {
  ok: false;
  error: string;
  envVar: string;
  tier: PlanTier;
  interval: BillingInterval;
  /**
   * Reason buckets:
   *   unsupported — tier doesn't self-serve via Checkout (free, enterprise)
   *   missing     — env var is unset/empty
   *   placeholder — env var looks like a stub ('price_pro_placeholder' etc.)
   */
  reason: 'unsupported' | 'missing' | 'placeholder';
}
export type PriceLookup = PriceLookupOk | PriceLookupErr;

export function getPriceId(tier: PlanTier, interval: BillingInterval): PriceLookup {
  const envVar = `EXPO_PUBLIC_STRIPE_PRICE_${tier.toUpperCase()}_${interval.toUpperCase()}`;

  if (tier === 'free' || tier === 'enterprise') {
    return {
      ok: false,
      error: `${tier} tier is not purchased via Checkout (it's ${tier === 'free' ? 'the default plan' : 'contact-sales only'}).`,
      envVar,
      tier,
      interval,
      reason: 'unsupported',
    };
  }

  const priceId = PRICE_IDS[tier]?.[interval];

  if (!priceId || priceId.trim() === '') {
    return {
      ok: false,
      error: `Stripe Price ID for ${tier}/${interval} is not configured. Set ${envVar} in your environment (Netlify + local .env), then rebuild.`,
      envVar,
      tier,
      interval,
      reason: 'missing',
    };
  }

  // Catch the `price_pro_placeholder` / `price_business_placeholder` pattern
  // that was hardcoded in BillingScreen before we centralized. These WILL
  // return a Stripe error on checkout; better to fail fast here.
  if (!STRIPE_PRICE_ID_PATTERN.test(priceId) || priceId.includes('placeholder')) {
    return {
      ok: false,
      error: `Stripe Price ID for ${tier}/${interval} looks like a placeholder: "${priceId}". Replace ${envVar} with a real price_xxx ID from Stripe Dashboard.`,
      envVar,
      tier,
      interval,
      reason: 'placeholder',
    };
  }

  return { ok: true, priceId, envVar };
}

// ─── Helpers for display ────────────────────────────────────────────────────

export function formatPrice(tier: TierDisplay, interval: BillingInterval): string {
  if (tier.sellsOn === 'contact') return 'Custom';
  if (tier.monthlyPrice === 0) return 'Free';
  if (interval === 'annual') {
    // Display as per-month billed annually so users compare apples to apples
    const perMonth = tier.annualPrice / 12;
    return `$${perMonth.toFixed(0)}/mo`;
  }
  return `$${tier.monthlyPrice}/mo`;
}

export function annualSavings(tier: TierDisplay): number {
  if (tier.monthlyPrice === 0) return 0;
  return tier.monthlyPrice * 12 - tier.annualPrice;
}
