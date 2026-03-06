/**
 * FeatureGate — wraps content behind a plan requirement.
 * Shows upgrade prompt when feature is not available.
 */

import React, { ReactNode } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useFeatureGate } from '../hooks/useFeatureGate';
import { FEATURE_REQUIRED_PLAN } from '../lib/billing';

interface FeatureGateProps {
  feature: string;
  orgId: string | null | undefined;
  children: ReactNode;
  fallback?: ReactNode;
}

export default function FeatureGate({ feature, orgId, children, fallback }: FeatureGateProps) {
  const { allowed, plan, requiredPlan, loading } = useFeatureGate(feature, orgId);

  if (loading) {
    return (
      <View style={styles.container}>
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  if (allowed) {
    return <>{children}</>;
  }

  if (fallback) {
    return <>{fallback}</>;
  }

  return (
    <View style={styles.container}>
      <View style={styles.upgradeCard}>
        <Text style={styles.lockIcon}>🔒</Text>
        <Text style={styles.title}>Upgrade Required</Text>
        <Text style={styles.description}>
          This feature requires the{' '}
          <Text style={styles.planHighlight}>{requiredPlan.toUpperCase()}</Text> plan.
          {plan !== 'free' ? ` You're currently on ${plan.toUpperCase()}.` : ''}
        </Text>
        <Pressable style={styles.upgradeBtn}>
          <Text style={styles.upgradeBtnText}>
            Upgrade to {requiredPlan.charAt(0).toUpperCase() + requiredPlan.slice(1)}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  loadingText: { color: '#666', fontSize: 14, fontFamily: 'monospace' },
  upgradeCard: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#6366f1' + '30',
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    maxWidth: 400,
    width: '100%',
  },
  lockIcon: { fontSize: 40, marginBottom: 16 },
  title: { color: '#fff', fontSize: 18, fontWeight: '700', fontFamily: 'monospace', marginBottom: 8 },
  description: {
    color: '#888',
    fontSize: 13,
    fontFamily: 'monospace',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  planHighlight: { color: '#6366f1', fontWeight: '700' },
  upgradeBtn: {
    backgroundColor: '#6366f1',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
  },
  upgradeBtnText: { color: '#fff', fontSize: 14, fontWeight: '700', fontFamily: 'monospace' },
});
