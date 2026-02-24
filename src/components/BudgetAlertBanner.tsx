// Budget Alert Banner Component
// Display budget warnings at the top of the Office

import React from 'react';
import { View, Text, StyleSheet, Pressable, Platform } from 'react-native';
import { BudgetAlert, getAlertColor, getAlertBackgroundColor } from '../lib/budgetAlerts';

interface Props {
  alerts: BudgetAlert[];
  onDismiss?: () => void;
  onConfigure?: () => void;
}

export default function BudgetAlertBanner({ alerts, onDismiss, onConfigure }: Props) {
  if (alerts.length === 0) return null;

  // Show only the highest-severity alert
  const topAlert = alerts[0];
  const color = getAlertColor(topAlert.level);
  const bgColor = getAlertBackgroundColor(topAlert.level);

  return (
    <View style={[styles.banner, { backgroundColor: bgColor, borderColor: color }]}>
      <View style={styles.content}>
        <View style={styles.left}>
          <View style={[styles.progressBar, { backgroundColor: color + '30' }]}>
            <View style={[styles.progressFill, { width: `${Math.min(100, topAlert.percentage)}%`, backgroundColor: color }]} />
          </View>
          <View style={styles.textBlock}>
            <Text style={[styles.message, { color }]}>{topAlert.message}</Text>
            <Text style={styles.detail}>
              ${topAlert.spent.toFixed(2)} / ${topAlert.budget.toFixed(2)} {topAlert.period}
            </Text>
          </View>
        </View>
        <View style={styles.actions}>
          {onConfigure && (
            <Pressable
              onPress={onConfigure}
              style={[styles.actionBtn, { borderColor: color + '40' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
            >
              <Text style={[styles.actionText, { color }]}>⚙️</Text>
            </Pressable>
          )}
          {onDismiss && (
            <Pressable
              onPress={onDismiss}
              style={[styles.actionBtn, { borderColor: color + '40' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
            >
              <Text style={[styles.actionText, { color }]}>×</Text>
            </Pressable>
          )}
        </View>
      </View>
      
      {/* Show count if multiple alerts */}
      {alerts.length > 1 && (
        <Text style={styles.moreCount}>
          +{alerts.length - 1} more alert{alerts.length > 2 ? 's' : ''}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginHorizontal: 12,
    marginVertical: 8,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  left: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  progressBar: {
    width: 60,
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  textBlock: {
    flex: 1,
    gap: 2,
  },
  message: {
    fontSize: 12,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 0.3,
  },
  detail: {
    fontSize: 10,
    color: '#888',
    fontFamily: 'monospace',
  },
  actions: {
    flexDirection: 'row',
    gap: 6,
  },
  actionBtn: {
    width: 28,
    height: 28,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0a0a1015',
  },
  actionText: {
    fontSize: 14,
    fontWeight: '700',
  },
  moreCount: {
    fontSize: 9,
    color: '#666',
    fontFamily: 'monospace',
    marginTop: 6,
    fontStyle: 'italic',
  },
});
