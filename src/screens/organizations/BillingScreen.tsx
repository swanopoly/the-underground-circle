import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Alert,
  Platform,
} from 'react-native';
import { useOrg } from '../../hooks/useOrg';
import {
  getOrgBilling,
  getUsageSummary,
  createCheckoutSession,
  openBillingPortal,
  getBillingEvents,
  PLAN_LIMITS,
} from '../../lib/billing';

const PLAN_COLORS: Record<string, string> = {
  free: '#6b7280',
  pro: '#6366f1',
  business: '#f59e0b',
  enterprise: '#ec4899',
};

export default function BillingScreen({ route, navigation }: any) {
  const { orgId } = route.params;
  const { org, isOwner } = useOrg(orgId);
  const [billing, setBilling] = useState<any>(null);
  const [usage, setUsage] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadBilling();
  }, [orgId]);

  const loadBilling = async () => {
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
      console.error('Billing load error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleUpgrade = async (priceId: string) => {
    const { error } = await createCheckoutSession(orgId, priceId);
    if (error) {
      if (Platform.OS === 'web') alert(error);
      else Alert.alert('Error', error);
    }
  };

  const handleManage = async () => {
    const { error } = await openBillingPortal(orgId);
    if (error) {
      if (Platform.OS === 'web') alert(error);
      else Alert.alert('Error', error);
    }
  };

  const plan = billing?.plan || 'free';
  const planColor = PLAN_COLORS[plan] || '#6b7280';

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

        {/* Upgrade buttons */}
        {plan === 'free' && (
          <View style={styles.upgradeSection}>
            <Text style={styles.upgradeTitle}>Upgrade Your Plan</Text>
            <PlanCard
              name="Pro"
              price="$29/mo"
              features={['5 circles', '25 members/circle', 'Analytics', 'Slack integration', 'CSV export']}
              color="#6366f1"
              onUpgrade={() => handleUpgrade('price_pro_placeholder')}
            />
            <PlanCard
              name="Business"
              price="$99/mo"
              features={['Unlimited circles', '100 members/circle', 'Full analytics', 'Slack + Teams', 'PDF reports', 'Goal alignment']}
              color="#f59e0b"
              onUpgrade={() => handleUpgrade('price_business_placeholder')}
            />
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

function PlanCard({ name, price, features, color, onUpgrade }: {
  name: string; price: string; features: string[]; color: string; onUpgrade: () => void;
}) {
  return (
    <View style={[styles.planCardOffer, { borderColor: color + '40' }]}>
      <View style={styles.planCardHeader}>
        <Text style={[styles.planCardName, { color }]}>{name}</Text>
        <Text style={styles.planCardPrice}>{price}</Text>
      </View>
      {features.map((f, i) => (
        <Text key={i} style={styles.planCardFeature}>✓ {f}</Text>
      ))}
      <Pressable onPress={onUpgrade} style={[styles.planCardBtn, { backgroundColor: color }]}>
        <Text style={styles.planCardBtnText}>Upgrade to {name}</Text>
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
  upgradeTitle: { color: '#fff', fontSize: 15, fontWeight: '700', fontFamily: 'monospace', marginBottom: 12 },
  planCardOffer: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderRadius: 12,
    padding: 20,
    marginBottom: 12,
  },
  planCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  planCardName: { fontSize: 18, fontWeight: '700', fontFamily: 'monospace' },
  planCardPrice: { color: '#ccc', fontSize: 16, fontFamily: 'monospace' },
  planCardFeature: { color: '#888', fontSize: 12, fontFamily: 'monospace', marginBottom: 4 },
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
