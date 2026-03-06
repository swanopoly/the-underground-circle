/**
 * Billing service — Stripe checkout, portal, plan limits, and feature checks.
 */

import { supabase } from './supabase';
import { Linking } from 'react-native';

// ─── Plan Limits ────────────────────────────────────────────────────

export const PLAN_LIMITS: Record<string, {
  circles: number;
  membersPerCircle: number;
  analytics: boolean;
  slack: boolean;
  teams: boolean;
  sso: boolean;
  export: false | 'csv' | 'pdf' | 'full';
  whitelabel: boolean;
  goals: boolean;
  price: number;
  seatPrice: number;
  seatThreshold: number;
}> = {
  free: { circles: 1, membersPerCircle: 8, analytics: false, slack: false, teams: false, sso: false, export: false, whitelabel: false, goals: false, price: 0, seatPrice: 0, seatThreshold: 0 },
  pro: { circles: 5, membersPerCircle: 25, analytics: true, slack: true, teams: false, sso: false, export: 'csv', whitelabel: false, goals: false, price: 29, seatPrice: 5, seatThreshold: 10 },
  business: { circles: 9999, membersPerCircle: 100, analytics: true, slack: true, teams: true, sso: false, export: 'pdf', whitelabel: false, goals: true, price: 99, seatPrice: 8, seatThreshold: 25 },
  enterprise: { circles: 9999, membersPerCircle: 9999, analytics: true, slack: true, teams: true, sso: true, export: 'full', whitelabel: true, goals: true, price: 0, seatPrice: 0, seatThreshold: 0 },
};

// ─── Feature-to-plan mapping ────────────────────────────────────────

export const FEATURE_REQUIRED_PLAN: Record<string, string> = {
  analytics_enabled: 'pro',
  slack_enabled: 'pro',
  teams_enabled: 'business',
  sso_enabled: 'enterprise',
  export_enabled: 'pro',
  whitelabel_enabled: 'enterprise',
  goal_alignment: 'business',
  custom_branding: 'business',
};

// ─── Billing Info ───────────────────────────────────────────────────

export async function getOrgBilling(orgId: string) {
  const { data } = await supabase
    .from('organizations')
    .select('plan, subscription_status, seat_count, stripe_customer_id, stripe_subscription_id')
    .eq('id', orgId)
    .single();

  return {
    plan: data?.plan || 'free',
    status: data?.subscription_status || 'active',
    seats: data?.seat_count || 1,
    hasStripe: !!data?.stripe_customer_id,
    subscriptionId: data?.stripe_subscription_id,
  };
}

// ─── Checkout ───────────────────────────────────────────────────────

export async function createCheckoutSession(
  orgId: string,
  priceId: string
): Promise<{ error?: string }> {
  const { data, error } = await supabase.functions.invoke('create-checkout', {
    body: {
      orgId,
      priceId,
      successUrl: `https://app.chrisswanson.xyz/org/${orgId}?billing=success`,
      cancelUrl: `https://app.chrisswanson.xyz/org/${orgId}?billing=canceled`,
    },
  });

  if (error) return { error: error.message };
  if (data?.url) {
    await Linking.openURL(data.url);
  }
  return {};
}

// ─── Portal ─────────────────────────────────────────────────────────

export async function openBillingPortal(orgId: string): Promise<{ error?: string }> {
  const { data, error } = await supabase.functions.invoke('create-portal-session', {
    body: {
      orgId,
      returnUrl: `https://app.chrisswanson.xyz/org/${orgId}`,
    },
  });

  if (error) return { error: error.message };
  if (data?.url) {
    await Linking.openURL(data.url);
  }
  return {};
}

// ─── Usage Summary ──────────────────────────────────────────────────

export async function getUsageSummary(orgId: string) {
  const [
    { count: memberCount },
    { count: circleCount },
    { data: org },
  ] = await Promise.all([
    supabase.from('org_members').select('*', { count: 'exact', head: true }).eq('org_id', orgId),
    supabase.from('circles').select('*', { count: 'exact', head: true }).eq('org_id', orgId),
    supabase.from('organizations').select('plan, seat_count').eq('id', orgId).single(),
  ]);

  const plan = org?.plan || 'free';
  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;

  return {
    members: { used: memberCount || 0, limit: org?.seat_count || limits.membersPerCircle },
    circles: { used: circleCount || 0, limit: limits.circles },
    plan,
  };
}

// ─── Feature Check ──────────────────────────────────────────────────

export function canAccessFeature(plan: string, feature: string): boolean {
  const requiredPlan = FEATURE_REQUIRED_PLAN[feature];
  if (!requiredPlan) return true;

  const planOrder = ['free', 'pro', 'business', 'enterprise'];
  return planOrder.indexOf(plan) >= planOrder.indexOf(requiredPlan);
}

// ─── Billing Events ─────────────────────────────────────────────────

export async function getBillingEvents(orgId: string, limit: number = 20) {
  const { data } = await supabase
    .from('billing_events')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(limit);

  return data || [];
}
