import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Alert,
  Platform,
  Linking,
  ActivityIndicator,
} from 'react-native';
import { useOrg } from '../../hooks/useOrg';
import {
  getOrgBilling,
  getUsageSummary,
  createCheckoutSession,
  openBillingPortal,
  getBillingEvents,
} from '../../lib/billing';
import {
  TIERS,
  getPriceId,
  formatPrice,
  annualSavings,
  PlanTier,
  BillingInterval,
  TierDisplay,
} from '../../lib/pricing';

export default function BillingScreen({ route, navigation }: any) {
  const { orgId } = route.params;
  useOrg(orgId); // keeps hook in case we later gate UI on ownership
  const [billing, setBilling] = useState<any>(null);
  const [usage, setUsage] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [billingInterval, setBillingInterval] = useState<BillingInterval>('monthly');
  const [pendingTier, setPendingTier] = useState<PlanTier | null>(null);

  const loadBilling = useCallback(async () => {
    setLoading(true);
    try {
      const [billingData, usageData, eventsData] = await Promise.all([
        getOrgBilling(orgId),
        getUsageSummary(orgId),
        getBillingEvents(orgId),
      ]);
      setBilling(billingData);
      setUsage(usageData);
      setEvents(eventsData);
    } catch (err) {
      console.error('[BillingScreen] load error:', err);
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    loadBilling();
  }, [loadBilling]);

  // Handle the "?billing=success" / "?billing=canceled" redirect from Stripe
  // Checkout. On success we wait for the webhook to flip org.plan, then refresh.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const status = params.get('billing');
    if (!status) return;
    if (status === 'success') {
      // Poll for webhook-driven plan change. Give up after 15s with a gentle
      // message rather than lying that the plan is live.
      const started = Date.now();
      const poll = setInterval(async () => {
        const fresh = await getOrgBilling(orgId);
        if (fresh.plan !== 'free') {
          clearInterval(poll);
          setBilling(fresh);
          if (Platform.OS === 'web') alert(`Welcome to ${fresh.plan.toUpperCase()} — your subscription is active.`);
        } else if (Date.now() - started > 15_000) {
          clearInterval(poll);
          if (Platform.OS === 'web') {
            alert('Payment succeeded, but we haven’t received the webhook yet. Refresh in a minute or check Billing History below.');
          }
        }
      }, 1500);
      // Strip the query params so a refresh doesn't re-trigger
      window.history.replaceState({}, '', window.location.pathname);
      return () => clearInterval(poll);
    } else if (status === 'canceled') {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [orgId]);

  const handleUpgrade = async (tier: TierDisplay) => {
    if (tier.sellsOn === 'contact' && tier.contactTarget) {
      await Linking.openURL(tier.contactTarget);
      return;
    }
    if (tier.sellsOn !== 'self-serve') return;

    const lookup = getPriceId(tier.tier, billingInterval);
    if (!lookup.ok) {
      const msg = lookup.error;
      if (Platform.OS === 'web') alert(msg);
      else Alert.alert('Cannot start checkout', msg);
      return;
    }

    setPendingTier(tier.tier);
    try {
      const { error } = await createCheckoutSession(orgId, lookup.priceId);
      if (error) {
        const msg = `Stripe checkout failed: ${error}`;
        if (Platform.OS === 'web') alert(msg);
        else Alert.alert('Error', msg);
      }
    } finally {
      setPendingTier(null);
    }
  };

  const handleManage = async () => {
    const { error } = await openBillingPortal(orgId);
    if (error) {
      if (Platform.OS === 'web') alert(`Unable to open billing portal: ${error}`);
      else Alert.alert('Error', `Unable to open billing portal: ${error}`);
    }
  };

  const plan = (billing?.plan || 'free') as PlanTier;
  const currentTier = TIERS.find(t => t.tier === plan) || TIERS[0];
  const planColor = currentTier.color;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </Pressable>
        <Text style={styles.title}>Billing</Text>
      </View>

      <ScrollView style={styles.content} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Current plan */}
        <View style={styles.planCard}>
          <Text style={styles.planLabel}>Current Plan</Text>
          <Text style={[styles.planName, { color: planColor }]}>
            {plan.toUpperCase()}
          </Text>
          <Text style={styles.planStatus}>
            Status: {billing?.status || 'active'}
          </Text>
        </View>

        {/* Usage bars */}
        {usage && (
          <View style={styles.usageSection}>
            <UsageBar
              label="Members"
              used={usage.members.used}
              limit={usage.members.limit}
              color="#6366f1"
            />
            <UsageBar
              label="Circles"
              used={usage.circles.used}
              limit={usage.circles.limit}
              color="#22c55e"
            />
          </View>
        )}

        {loading && <ActivityIndicator size="small" color="#6366f1" style={{ marginVertical: 16 }} />}

        {/* Upgrade section — always visible so paid users can change tier */}
        {!loading && (
          <View style={styles.upgradeSection}>
            <View style={styles.upgradeHeader}>
              <Text style={styles.upgradeTitle}>Plans</Text>
              <IntervalToggle value={billingInterval} onChange={setBillingInterval} />
            </View>
            {TIERS.filter(t => t.tier !== 'free').map(tier => (
              <PlanCard
                key={tier.tier}
                tier={tier}
                interval={billingInterval}
                isCurrent={plan === tier.tier}
                isPending={pendingTier === tier.tier}
                onSelect={() => handleUpgrade(tier)}
              />
            ))}
          </View>
        )}

        {plan !== 'free' && billing?.hasStripe && (
          <Pressable onPress={handleManage} style={styles.manageBtn}>
            <Text style={styles.manageBtnText}>Manage Subscription</Text>
          </Pressable>
        )}

        {/* Billing history */}
        {events.length > 0 && (
          <>
            <Text style={styles.historyTitle}>Billing History</Text>
            {events.slice(0, 10).map((event: any) => (
              <View key={event.id} style={styles.eventRow}>
                <Text style={styles.eventType}>{event.event_type}</Text>
                <Text style={styles.eventDate}>
                  {new Date(event.created_at).toLocaleDateString()}
                </Text>
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function IntervalToggle({ value, onChange }: { value: BillingInterval; onChange: (v: BillingInterval) => void }) {
  return (
    <View style={styles.intervalToggle}>
      {(['monthly', 'annual'] as const).map(k => {
        const active = value === k;
        return (
          <Pressable
            key={k}
            onPress={() => onChange(k)}
            style={[styles.intervalPill, active && styles.intervalPillActive, Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}
          >
            <Text style={[styles.intervalPillText, active && styles.intervalPillTextActive]}>
              {k === 'annual' ? 'Annual · 2 months free' : 'Monthly'}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function UsageBar({ label, used, limit, color }: { label: string; used: number; limit: number; color: string }) {
  const pct = limit > 0 ? Math.min((used / limit) * 100, 100) : 0;
  const displayLimit = limit >= 9999 ? '∞' : String(limit);

  return (
    <View style={styles.usageBar}>
      <View style={styles.usageHeader}>
        <Text style={styles.usageLabel}>{label}</Text>
        <Text style={styles.usageCount}>{used} / {displayLimit}</Text>
      </View>
      <View style={styles.barBg}>
        <View style={[styles.barFill, { width: `${pct}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

function PlanCard({ tier, interval, isCurrent, isPending, onSelect }: {
  tier: TierDisplay;
  interval: BillingInterval;
  isCurrent: boolean;
  isPending: boolean;
  onSelect: () => void;
}) {
  const priceLabel = formatPrice(tier, interval);
  const savings = annualSavings(tier);
  const disabled = isCurrent || isPending;
  const ctaLabel = isCurrent ? 'Current plan' : isPending ? 'Redirecting…' : tier.ctaLabel;

  return (
    <View style={[
      styles.planCardOffer,
      { borderColor: tier.color + '55' },
      tier.highlight && styles.planCardOfferHighlight,
    ]}>
      <View style={styles.planCardHeader}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={[styles.planCardName, { color: tier.color }]}>{tier.name}</Text>
            {tier.highlight && (
              <View style={[styles.popularBadge, { backgroundColor: tier.color + '22', borderColor: tier.color }]}>
                <Text style={[styles.popularBadgeText, { color: tier.color }]}>POPULAR</Text>
              </View>
            )}
          </View>
          <Text style={styles.planCardTagline}>{tier.tagline}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.planCardPrice}>{priceLabel}</Text>
          {interval === 'annual' && savings > 0 && (
            <Text style={styles.planCardSavings}>save ${savings}/yr</Text>
          )}
        </View>
      </View>
      {tier.features.map((f, i) => (
        <Text key={i} style={styles.planCardFeature}>✓ {f}</Text>
      ))}
      <Pressable
        onPress={disabled ? undefined : onSelect}
        disabled={disabled}
        style={[
          styles.planCardBtn,
          { backgroundColor: disabled ? '#2a2a2a' : tier.color },
          Platform.OS === 'web' && ({ cursor: disabled ? 'default' : 'pointer' } as any),
        ]}
      >
        <Text style={[styles.planCardBtnText, disabled && { color: '#707086' }]}>
          {ctaLabel}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
  },
  backBtn: { paddingRight: 12 },
  backText: { color: '#6366f1', fontSize: 14, fontFamily: 'monospace' },
  title: { color: '#fff', fontSize: 18, fontWeight: '700', fontFamily: 'monospace' },
  content: { flex: 1, padding: 16 },
  planCard: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
  },
  planLabel: { color: '#888', fontSize: 12, fontFamily: 'monospace' },
  planName: { fontSize: 28, fontWeight: '700', fontFamily: 'monospace', marginVertical: 4 },
  planStatus: { color: '#ccc', fontSize: 13, fontFamily: 'monospace' },
  usageSection: { gap: 12, marginBottom: 20 },
  usageBar: {},
  usageHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  usageLabel: { color: '#ccc', fontSize: 12, fontFamily: 'monospace' },
  usageCount: { color: '#888', fontSize: 12, fontFamily: 'monospace' },
  barBg: { height: 8, backgroundColor: '#2a2a2a', borderRadius: 4, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 4 },
  upgradeSection: { marginBottom: 20 },
  upgradeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    gap: 12,
    flexWrap: 'wrap',
  },
  upgradeTitle: { color: '#fff', fontSize: 15, fontWeight: '700', fontFamily: 'monospace' },
  intervalToggle: {
    flexDirection: 'row',
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 999,
    padding: 2,
  },
  intervalPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  intervalPillActive: {
    backgroundColor: '#6366f1',
  },
  intervalPillText: {
    color: '#888',
    fontSize: 11,
    fontWeight: '700',
    fontFamily: 'monospace',
    letterSpacing: 0.5,
  },
  intervalPillTextActive: {
    color: '#fff',
  },
  planCardOffer: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderRadius: 12,
    padding: 20,
    marginBottom: 12,
  },
  planCardOfferHighlight: {
    borderWidth: 2,
  },
  planCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
    gap: 12,
  },
  planCardName: { fontSize: 18, fontWeight: '700', fontFamily: 'monospace' },
  planCardTagline: { color: '#888', fontSize: 11, fontFamily: 'monospace', marginTop: 2 },
  planCardPrice: { color: '#fff', fontSize: 18, fontFamily: 'monospace', fontWeight: '700' },
  planCardSavings: { color: '#22c55e', fontSize: 10, fontFamily: 'monospace', fontWeight: '700', marginTop: 2 },
  planCardFeature: { color: '#aaa', fontSize: 12, fontFamily: 'monospace', marginBottom: 4 },
  popularBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
  },
  popularBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1,
    fontFamily: 'monospace',
  },
  planCardBtn: {
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 12,
  },
  planCardBtnText: { color: '#fff', fontSize: 14, fontWeight: '700', fontFamily: 'monospace' },
  manageBtn: {
    backgroundColor: '#6366f1',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 24,
  },
  manageBtnText: { color: '#fff', fontSize: 15, fontWeight: '700', fontFamily: 'monospace' },
  historyTitle: { color: '#fff', fontSize: 14, fontWeight: '700', fontFamily: 'monospace', marginBottom: 10 },
  eventRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
  },
  eventType: { color: '#ccc', fontSize: 12, fontFamily: 'monospace' },
  eventDate: { color: '#888', fontSize: 12, fontFamily: 'monospace' },
});
