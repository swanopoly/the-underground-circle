/**
 * CompletedWorkPanel — Lists tasks the current user has completed in this circle.
 * Lives on the Profile dashboard. Replaces the "Completed Work" story bucket
 * previously rendered inside CircleStoriesRail on the Feed tab.
 *
 * Style: app slate surfaces matching the modern profile dashboard.
 */

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { supabase } from '../lib/supabase';
import { PROFILE_DASHBOARD_TOKENS as PD } from './profile/profileDashboardTheme';

// Module-level fetch coalescer — if multiple CompletedWorkPanel instances
// mount for the same circle in quick succession (ProfileTab renders alongside
// ProfileScreen + other cards; parent re-renders can re-mount children), they
// all share one in-flight request instead of hammering the DB with 5x the
// identical query. Cache hits within 30s return instantly.
const INFLIGHT = new Map<string, Promise<CompletedTask[]>>();
const CACHE = new Map<string, { at: number; tasks: CompletedTask[] }>();
const CACHE_TTL_MS = 30_000;

interface Props {
  circleId: string;
}

interface CompletedTask {
  id: string;
  title: string;
  created_at: string;
}

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'JUST NOW';
  if (mins < 60) return `${mins}M AGO`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}H AGO`;
  return `${Math.floor(hrs / 24)}D AGO`;
}

export default function CompletedWorkPanel({ circleId }: Props) {
  const [tasks, setTasks] = useState<CompletedTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data: userData } = await supabase.auth.getUser().catch(() => ({ data: null as any }));
      const uid = userData?.user?.id ?? null;
      if (cancelled) return;
      setUserId(uid);
      if (!uid) {
        setLoading(false);
        return;
      }

      const cacheKey = `${circleId}:${uid}`;

      // Serve from 30s cache if we have a fresh result — no network call.
      const cached = CACHE.get(cacheKey);
      if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
        if (!cancelled) {
          setTasks(cached.tasks);
          setLoading(false);
        }
        return;
      }

      // De-dupe concurrent fetches from multiple panel instances.
      let inflight = INFLIGHT.get(cacheKey);
      if (!inflight) {
        const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        inflight = (async (): Promise<CompletedTask[]> => {
          try {
            const { data, error } = await supabase
              .from('tasks')
              .select('id, title, created_at')
              .eq('circle_id', circleId)
              .eq('assigned_to', uid)
              .eq('status', 'done')
              .gte('created_at', since)
              .order('created_at', { ascending: false })
              .limit(50);
            if (error) throw error;
            const rows = (data as CompletedTask[]) ?? [];
            CACHE.set(cacheKey, { at: Date.now(), tasks: rows });
            return rows;
          } finally {
            INFLIGHT.delete(cacheKey);
          }
        })();
        INFLIGHT.set(cacheKey, inflight);
      }

      try {
        const rows = await inflight;
        if (cancelled) return;
        setTasks(rows);
      } catch (err) {
        if (cancelled) return;
        console.warn('[CompletedWorkPanel] Failed to load completed tasks:', err);
        setTasks([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [circleId]);

  return (
    <View style={s.card} nativeID="section-profile-completed-work">
      <View style={s.header}>
        <View style={s.iconBox}><Text style={s.iconText}>{'//'}</Text></View>
        <Text style={s.title}>COMPLETED WORK</Text>
        <View style={s.countPill}>
          <Text style={s.countText}>{tasks.length}</Text>
        </View>
      </View>
      <Text style={s.subtitle}>YOUR TASKS MARKED DONE · LAST 7 DAYS</Text>
      <View style={s.divider} />

      {loading ? (
        <Text style={s.hint}>LOADING...</Text>
      ) : !userId ? (
        <Text style={s.hint}>SIGN IN TO SEE YOUR COMPLETED TASKS</Text>
      ) : tasks.length === 0 ? (
        <View style={s.emptyBox}>
          <Text style={s.emptyTitle}>NO COMPLETED TASKS YET</Text>
          <Text style={s.emptyHint}>SHIP SOMETHING. MARK IT DONE. IT SHOWS UP HERE.</Text>
        </View>
      ) : (
        <View style={s.list}>
          {tasks.map((t) => (
            <View key={t.id} style={s.row}>
              <View style={s.checkBox}><Text style={s.checkText}>x</Text></View>
              <Text style={s.rowTitle} numberOfLines={2}>{t.title || '(untitled task)'}</Text>
              <Text style={s.rowTime}>{timeAgo(t.created_at)}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const hoverCSS = Platform.OS === 'web'
  ? ({ transition: 'all 0.15s ease' } as any)
  : {};

const s = StyleSheet.create({
  card: {
    backgroundColor: PD.panel,
    borderWidth: 1,
    borderColor: PD.border,
    borderRadius: PD.panelRadius,
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconBox: {
    width: 28,
    height: 28,
    borderWidth: 1,
    borderColor: `${PD.success}33`,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: `${PD.success}12`,
  },
  iconText: {
    color: PD.success,
    fontFamily: 'monospace',
    fontSize: 11,
    fontWeight: '900',
  },
  title: {
    flex: 1,
    color: PD.text,
    fontFamily: 'monospace',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 1.4,
  },
  countPill: {
    minWidth: 28,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: PD.borderStrong,
    borderRadius: 999,
    alignItems: 'center',
    backgroundColor: PD.inset,
  },
  countText: {
    color: PD.textSecondary,
    fontFamily: 'monospace',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },
  subtitle: {
    marginTop: 6,
    color: PD.textMuted,
    fontFamily: 'monospace',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.1,
  },
  divider: {
    height: 1,
    backgroundColor: PD.border,
    marginVertical: 12,
  },
  hint: {
    color: PD.textMuted,
    fontFamily: 'monospace',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    paddingVertical: 8,
  },
  emptyBox: {
    borderWidth: 1,
    borderColor: PD.border,
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
    gap: 6,
    backgroundColor: PD.inset,
  },
  emptyTitle: {
    color: PD.text,
    fontFamily: 'monospace',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  emptyHint: {
    color: PD.textMuted,
    fontSize: 10,
    fontWeight: '500',
    lineHeight: 15,
    textAlign: 'center',
  },
  list: {
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: PD.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    backgroundColor: PD.inset,
    ...hoverCSS,
  },
  checkBox: {
    width: 20,
    height: 20,
    borderWidth: 1,
    borderColor: PD.success,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: `${PD.success}12`,
  },
  checkText: {
    color: PD.success,
    fontFamily: 'monospace',
    fontSize: 10,
    fontWeight: '900',
  },
  rowTitle: {
    flex: 1,
    color: PD.text,
    fontSize: 12,
    fontWeight: '600',
  },
  rowTime: {
    color: PD.textMuted,
    fontFamily: 'monospace',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
});
