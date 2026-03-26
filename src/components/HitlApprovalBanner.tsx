import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, Animated, ScrollView, Platform } from 'react-native';
import { AgentApproval, resolveApproval } from '../services/hitlService';
import { supabase } from '../lib/supabase';

interface Props {
  approvals: AgentApproval[];
  circleId: string;
}

function actionColor(type: string): string {
  if (type === 'spending') return '#f59e0b';
  if (type === 'tool_call') return '#6366f1';
  if (type === 'external_message') return '#3b82f6';
  return '#9e9e9e';
}

function CountdownTimer({
  requestedAt,
  timeoutSeconds,
}: {
  requestedAt: string;
  timeoutSeconds: number;
}) {
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    const calc = () => {
      const elapsed = (Date.now() - new Date(requestedAt).getTime()) / 1000;
      setRemaining(Math.max(0, timeoutSeconds - elapsed));
    };
    calc();
    const t = setInterval(calc, 1000);
    return () => clearInterval(t);
  }, [requestedAt, timeoutSeconds]);

  return (
    <Text style={[styles.countdown, remaining < 60 && styles.countdownUrgent]}>
      {Math.floor(remaining)}s
    </Text>
  );
}

export default function HitlApprovalBanner({ approvals, circleId }: Props) {
  const [expanded, setExpanded] = useState(false);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (approvals.length > 0) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.5,
            duration: 600,
            useNativeDriver: Platform.OS !== 'web',
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 600,
            useNativeDriver: Platform.OS !== 'web',
          }),
        ]),
      );
      loop.start();
      return () => loop.stop();
    }
  }, [approvals.length]);

  if (approvals.length === 0) return null;

  const handleResolve = async (approvalId: string, status: 'approved' | 'rejected') => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      await resolveApproval(approvalId, status, user.id);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <View style={styles.container}>
      <Pressable style={styles.banner} onPress={() => setExpanded(!expanded)}>
        <Animated.View style={[styles.dot, { transform: [{ scale: pulseAnim }] }]} />
        <Text style={styles.bannerText}>
          {approvals.length} AGENT {approvals.length === 1 ? 'REQUEST' : 'REQUESTS'} AWAITING
          APPROVAL
        </Text>
        <Text style={styles.chevron}>{expanded ? '▲' : '▼'}</Text>
      </Pressable>

      {expanded && (
        <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
          {approvals.map((ap) => (
            <View key={ap.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.agentName}>{ap.agent_name}</Text>
                <View
                  style={[
                    styles.typeBadge,
                    {
                      backgroundColor: actionColor(ap.action_type) + '20',
                      borderColor: actionColor(ap.action_type) + '60',
                    },
                  ]}
                >
                  <Text style={[styles.typeText, { color: actionColor(ap.action_type) }]}>
                    {ap.action_type.replace(/_/g, ' ').toUpperCase()}
                  </Text>
                </View>
                <CountdownTimer
                  requestedAt={ap.requested_at}
                  timeoutSeconds={ap.timeout_seconds}
                />
              </View>
              <Text style={styles.description}>{ap.description}</Text>
              {ap.payload && Object.keys(ap.payload).length > 0 && (
                <Text style={styles.payload}>
                  {JSON.stringify(ap.payload, null, 2).slice(0, 180)}
                </Text>
              )}
              <View style={styles.actions}>
                <Pressable
                  style={styles.rejectBtn}
                  onPress={() => handleResolve(ap.id, 'rejected')}
                >
                  <Text style={styles.rejectText}>REJECT</Text>
                </Pressable>
                <Pressable
                  style={styles.approveBtn}
                  onPress={() => handleResolve(ap.id, 'approved')}
                >
                  <Text style={styles.approveText}>APPROVE</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    maxHeight: 420,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0a0a0a',
    borderBottomWidth: 1,
    borderColor: '#2a2a2a',
    paddingHorizontal: 16,
    paddingVertical: 11,
    gap: 10,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#f59e0b',
  },
  bannerText: {
    flex: 1,
    color: '#f59e0b',
    fontSize: 11,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 1,
  },
  chevron: { color: '#f59e0b', fontSize: 10 },
  list: {
    backgroundColor: '#0a0a0a',
    borderBottomWidth: 1,
    borderColor: '#1a1a1a',
    maxHeight: 340,
  },
  card: {
    padding: 14,
    borderBottomWidth: 1,
    borderColor: '#1a1a1a',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  agentName: {
    flex: 1,
    color: '#e8e8e8',
    fontSize: 12,
    fontWeight: '800',
    fontFamily: 'monospace',
  },
  typeBadge: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  typeText: {
    fontSize: 8,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 0.5,
  },
  countdown: {
    color: '#9e9e9e',
    fontSize: 9,
    fontFamily: 'monospace',
  },
  countdownUrgent: { color: '#ef4444' },
  description: {
    color: '#9e9e9e',
    fontSize: 12,
    fontFamily: 'monospace',
    marginBottom: 6,
    lineHeight: 16,
  },
  payload: {
    color: '#6f6f6f',
    fontSize: 9,
    fontFamily: 'monospace',
    backgroundColor: '#000000',
    padding: 8,
    borderRadius: 4,
    marginBottom: 8,
  },
  actions: { flexDirection: 'row', gap: 8 },
  rejectBtn: {
    flex: 1,
    backgroundColor: '#ef444415',
    borderWidth: 1,
    borderColor: '#ef444440',
    borderRadius: 12,
    paddingVertical: 9,
    alignItems: 'center',
  },
  rejectText: { color: '#ef4444', fontSize: 11, fontWeight: '800', fontFamily: 'monospace' },
  approveBtn: {
    flex: 1,
    backgroundColor: '#22c55e15',
    borderWidth: 1,
    borderColor: '#22c55e40',
    borderRadius: 12,
    paddingVertical: 9,
    alignItems: 'center',
  },
  approveText: { color: '#22c55e', fontSize: 11, fontWeight: '800', fontFamily: 'monospace' },
});
