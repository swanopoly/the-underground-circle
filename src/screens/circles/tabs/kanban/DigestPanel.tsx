/**
 * DigestPanel — modern collapsible daily stats bar
 */

import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import { supabase } from '../../../../lib/supabase';
import { generateNudge, getProgressInsight } from '../../../../lib/coach';
import { indexSafeProfiles, loadSafeCircleProfiles } from '../../../../lib/safeProfiles';

interface Props {
  circleId: string;
}

interface DigestData {
  todayCheckIns: any[];
  activeMembers: number;
  tasksCompleted: number;
  mvp: { name: string; xp: number } | null;
  nudge: string | null;
  insight: string;
}

export default function DigestPanel({ circleId }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [digest, setDigest] = useState<DigestData | null>(null);

  const today = new Date().toISOString().split('T')[0];

  const fetchDigest = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    try {
      const [checkInRes, memberRes, taskRes] = await Promise.all([
        supabase.from('check_ins').select('user_id, content, created_at')
          .eq('circle_id', circleId).gte('created_at', today + 'T00:00:00').order('created_at', { ascending: false }).limit(20),
        supabase.from('circle_members').select('user_id').eq('circle_id', circleId).limit(50),
        supabase.from('tasks').select('id').eq('circle_id', circleId).eq('status', 'done').gte('completed_at', today + 'T00:00:00'),
      ]);
      const todayCheckIns = checkInRes.data || [];
      const checkInProfiles = indexSafeProfiles(await loadSafeCircleProfiles({
        circleId,
        userIds: todayCheckIns.map((row: any) => row.user_id),
      }));
      const hydratedCheckIns = todayCheckIns.map((row: any) => ({
        ...row,
        profiles: checkInProfiles.get(row.user_id) || null,
      }));
      const activeMembers = new Set(todayCheckIns.map((c: any) => c.user_id)).size;

      const memberIds = (memberRes.data || []).map((m: any) => m.user_id);
      let mvp: { name: string; xp: number } | null = null;
      if (memberIds.length > 0) {
        const [xpRes, profiles] = await Promise.all([
          supabase.from('user_points').select('user_id, lifetime_points')
            .in('user_id', memberIds).order('lifetime_points', { ascending: false }).limit(1),
          loadSafeCircleProfiles({ circleId, userIds: memberIds }),
        ]);
        const topXp = xpRes.data?.[0];
        if (topXp) {
          const prof = profiles.find((p: any) => p.id === topXp.user_id);
          mvp = { name: prof?.display_name || prof?.username || 'Unknown', xp: topXp.lifetime_points };
        }
      }
      const nudge = await generateNudge(user.id).catch(() => null);
      const insight = await getProgressInsight(user.id).catch(() => '');
      setDigest({ todayCheckIns: hydratedCheckIns, activeMembers, tasksCompleted: taskRes.data?.length || 0, mvp, nudge, insight });
    } catch {}
  }, [circleId, today]);

  useEffect(() => { fetchDigest(); }, [fetchDigest]);

  if (!digest) return null;

  return (
    <View style={s.container}>
      <Pressable onPress={() => setExpanded(p => !p)} style={s.header}>
        {/* Inline stats */}
        <View style={s.statsRow}>
          <StatPill value={digest.todayCheckIns.length} label="check-ins" color="#6366f1" />
          <StatPill value={digest.activeMembers} label="active" color="#22c55e" />
          <StatPill value={digest.tasksCompleted} label="done" color="#f59e0b" />
          {digest.mvp && (
            <View style={s.mvpPill}>
              <Text style={s.mvpStar}>*</Text>
              <Text style={s.mvpName}>{digest.mvp.name}</Text>
            </View>
          )}
        </View>
        <Text style={s.toggle}>{expanded ? '-' : '+'}</Text>
      </Pressable>

      {expanded && (
        <View style={s.body}>
          {digest.nudge && (
            <View style={[s.insight, { borderLeftColor: '#6366f1' }]}>
              <Text style={[s.insightText, { color: '#a5b4fc' }]}>{digest.nudge}</Text>
            </View>
          )}
          {digest.insight ? (
            <View style={[s.insight, { borderLeftColor: '#22c55e' }]}>
              <Text style={[s.insightText, { color: '#86efac' }]}>{digest.insight}</Text>
            </View>
          ) : null}

          {digest.todayCheckIns.length > 0 && (
            <View style={s.checkinsBox}>
              {digest.todayCheckIns.slice(0, 3).map((c: any, i: number) => (
                <View key={i} style={s.checkinRow}>
                  <View style={s.checkinAvatar}>
                    <Text style={s.checkinAvatarText}>
                      {((c.profiles as any)?.display_name || (c.profiles as any)?.username || '?')[0].toUpperCase()}
                    </Text>
                  </View>
                  <View style={s.checkinContent}>
                    <Text style={s.checkinName}>
                      {(c.profiles as any)?.display_name || (c.profiles as any)?.username || 'Member'}
                    </Text>
                    <Text style={s.checkinText} numberOfLines={1}>{c.content}</Text>
                  </View>
                </View>
              ))}
              {digest.todayCheckIns.length > 3 && (
                <Text style={s.moreText}>+{digest.todayCheckIns.length - 3} more check-ins</Text>
              )}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

function StatPill({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <View style={[s.statPill, { backgroundColor: color + '10' }]}>
      <Text style={[s.statValue, { color }]}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    borderBottomWidth: 1,
    borderBottomColor: '#15151e',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#0a0a12',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    flexWrap: 'wrap',
  },
  statPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  statValue: {
    fontSize: 13,
    fontWeight: '700',
  },
  statLabel: {
    fontSize: 11,
    color: '#6b6b80',
    fontWeight: '500',
  },
  mvpPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 20,
    backgroundColor: '#f59e0b10',
  },
  mvpStar: {
    color: '#f59e0b',
    fontSize: 12,
    fontWeight: '700',
  },
  mvpName: {
    color: '#f59e0b',
    fontSize: 11,
    fontWeight: '600',
  },
  toggle: {
    color: '#555566',
    fontSize: 16,
    fontWeight: '300',
    width: 24,
    textAlign: 'center',
  },
  body: {
    backgroundColor: '#08080e',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
  },
  insight: {
    borderLeftWidth: 3,
    paddingLeft: 10,
    paddingVertical: 4,
  },
  insightText: {
    fontSize: 12,
    lineHeight: 18,
  },
  checkinsBox: {
    gap: 6,
    marginTop: 4,
  },
  checkinRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  checkinAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#1a1a28',
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkinAvatarText: {
    color: '#6b6b80',
    fontSize: 10,
    fontWeight: '700',
  },
  checkinContent: {
    flex: 1,
  },
  checkinName: {
    color: '#9090a8',
    fontSize: 11,
    fontWeight: '600',
  },
  checkinText: {
    color: '#555566',
    fontSize: 11,
  },
  moreText: {
    color: '#444455',
    fontSize: 11,
    paddingLeft: 32,
  },
});
