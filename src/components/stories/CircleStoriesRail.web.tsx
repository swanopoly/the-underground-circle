/**
 * CircleStoriesRail — Horizontal rail of tappable story circles (web only).
 *
 * Loads recent circle activity from Supabase (check-ins, agent activity
 * from the last 24 hours) and presents them as Instagram-style stories
 * using react-insta-stories.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Modal } from 'react-native';
import Stories from 'react-insta-stories';
import type { Story } from 'react-insta-stories/dist/interfaces';
import { supabase } from '../../lib/supabase';
import { indexSafeProfiles, loadSafeCircleProfiles } from '../../lib/safeProfiles';

// ── Types ────────────────────────────────────────────────────────────────
interface StoryGroup {
  id: string;
  name: string;
  avatarLetter: string;
  color: string;
  hasNew: boolean;
  stories: Story[];
}

interface Props {
  circleId: string;
  accentColor: string;
}

// ── Design Tokens ────────────────────────────────────────────────────────
const BG = '#050508';
const BG_SURFACE = '#0a0a10';
const BORDER = '#1a1a2e';
const TEXT_PRI = '#f0f0f5';
const TEXT_SEC = '#a0a0b0';
const TEXT_TER = '#606075';
const RING_NEW = '#22c55e';

// ── Helpers ──────────────────────────────────────────────────────────────
function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function pickColor(name: string): string {
  const colors = ['#6366f1', '#06b6d4', '#22c55e', '#f59e0b', '#ec4899', '#8b5cf6', '#ef4444'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

// ── Custom story content renderer ────────────────────────────────────────
function StoryContent({ heading, subheading, body, accentColor, timestamp }: {
  heading: string;
  subheading: string;
  body: string;
  accentColor: string;
  timestamp: string;
}) {
  return (
    <View style={cs.storyPage}>
      <View style={cs.storyInner}>
        <View style={[cs.storyAccent, { backgroundColor: accentColor }]} />
        <Text style={cs.storyHeading}>{heading}</Text>
        <Text style={cs.storySubheading}>{subheading}</Text>
        <View style={cs.storyDivider} />
        <Text style={cs.storyBody}>{body}</Text>
        <Text style={cs.storyTimestamp}>{timeAgo(timestamp)}</Text>
      </View>
    </View>
  );
}

// ── Main Component ───────────────────────────────────────────────────────
export default function CircleStoriesRail({ circleId, accentColor }: Props) {
  const [groups, setGroups] = useState<StoryGroup[]>([]);
  const [activeGroup, setActiveGroup] = useState<StoryGroup | null>(null);
  const [viewedIds, setViewedIds] = useState<Set<string>>(new Set());

  // Fetch recent activity from 3 tables
  useEffect(() => {
    let cancelled = false;
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    async function load() {
      const [checkIns, agentActs] = await Promise.all([
        supabase
          .from('check_ins')
          .select('id, user_id, content, created_at')
          .eq('circle_id', circleId)
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(30),
        supabase
          .from('agent_activity')
          .select('id, agent_name, title, body, created_at')
          .eq('circle_id', circleId)
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(30),
      ]);

      if (cancelled) return;

      const profileById = indexSafeProfiles(await loadSafeCircleProfiles({
        circleId,
        userIds: (checkIns.data || []).map(row => row.user_id),
      }));
      if (cancelled) return;

      const map = new Map<string, StoryGroup>();

      // -- Check-ins --
      for (const row of (checkIns.data ?? [])) {
        const profile = profileById.get(row.user_id);
        const name = profile?.display_name || profile?.username || 'Member';
        const key = `user-${row.user_id}`;
        if (!map.has(key)) {
          map.set(key, {
            id: key,
            name,
            avatarLetter: name.charAt(0).toUpperCase(),
            color: pickColor(name),
            hasNew: true,
            stories: [],
          });
        }
        map.get(key)!.stories.push({
          duration: 5000,
          content: ({ action, isPaused }) => (
            <StoryContent
              heading={name}
              subheading="Check-in"
              body={row.content || '(no content)'}
              accentColor={accentColor}
              timestamp={row.created_at}
            />
          ),
        });
      }

      // -- Agent activity --
      for (const row of (agentActs.data ?? [])) {
        const name = row.agent_name || 'Agent';
        const key = `agent-${name}`;
        if (!map.has(key)) {
          map.set(key, {
            id: key,
            name,
            avatarLetter: name.charAt(0).toUpperCase(),
            color: pickColor(name),
            hasNew: true,
            stories: [],
          });
        }
        map.get(key)!.stories.push({
          duration: 5000,
          content: ({ action, isPaused }) => (
            <StoryContent
              heading={name}
              subheading={row.title || 'Activity'}
              body={row.body || '(no details)'}
              accentColor={map.get(key)!.color}
              timestamp={row.created_at}
            />
          ),
        });
      }

      setGroups(Array.from(map.values()));
    }

    load();
    return () => { cancelled = true; };
  }, [circleId, accentColor]);

  // Nothing to show
  if (groups.length === 0) return null;

  return (
    <>
      {/* ── Story Circles Rail ── */}
      <View style={rs.rail} nativeID="section-feed-stories-rail">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={rs.railScroll}
        >
          {groups.map(g => {
            const seen = viewedIds.has(g.id);
            return (
              <Pressable
                key={g.id}
                onPress={() => {
                  setActiveGroup(g);
                  setViewedIds(prev => new Set(prev).add(g.id));
                }}
                style={rs.circleWrap}
              >
                <View style={[
                  rs.avatarRing,
                  { borderColor: seen ? BORDER : RING_NEW },
                ]}>
                  <View style={[rs.avatar, { backgroundColor: g.color + '25' }]}>
                    <Text style={[rs.avatarLetter, { color: g.color }]}>{g.avatarLetter}</Text>
                  </View>
                </View>
                <Text style={rs.circleName} numberOfLines={1}>{g.name}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* ── Full-screen Story Viewer (Modal) ── */}
      {activeGroup && (
        <Modal
          visible
          transparent
          animationType="fade"
          onRequestClose={() => setActiveGroup(null)}
        >
          <Pressable style={rs.overlay} onPress={() => setActiveGroup(null)}>
            <Pressable style={rs.closeBtn} onPress={() => setActiveGroup(null)}>
              <Text style={rs.closeBtnText}>X</Text>
            </Pressable>
            <Pressable style={rs.viewerWrap} onPress={(e) => e.stopPropagation()}>
              <Stories
                stories={activeGroup.stories}
                defaultInterval={5000}
                width="100%"
                height="100%"
                storyContainerStyles={{ background: BG, borderRadius: 12, overflow: 'hidden' }}
                keyboardNavigation
                onAllStoriesEnd={() => setActiveGroup(null)}
              />
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────
const rs = StyleSheet.create({
  rail: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    marginBottom: 8,
  },
  railScroll: {
    paddingHorizontal: 12,
    gap: 14,
  },
  circleWrap: {
    alignItems: 'center',
    width: 68,
  },
  avatarRing: {
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 2,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarLetter: {
    fontSize: 18,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  circleName: {
    marginTop: 4,
    fontSize: 10,
    fontWeight: '500',
    color: TEXT_SEC,
    textAlign: 'center',
    fontFamily: 'monospace',
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeBtn: {
    position: 'absolute',
    top: 20,
    right: 20,
    zIndex: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1a1a28',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeBtnText: {
    color: TEXT_PRI,
    fontWeight: '700',
    fontSize: 14,
    fontFamily: 'monospace',
  },
  viewerWrap: {
    width: 380,
    height: 640,
    maxWidth: '95%',
    maxHeight: '90%',
    borderRadius: 12,
    overflow: 'hidden',
  },
});

const cs = StyleSheet.create({
  storyPage: {
    flex: 1,
    backgroundColor: BG,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  storyInner: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: BG_SURFACE,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 2,
    padding: 24,
    position: 'relative',
    overflow: 'hidden',
  },
  storyAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
  },
  storyHeading: {
    fontSize: 18,
    fontWeight: '700',
    color: TEXT_PRI,
    fontFamily: 'monospace',
    marginBottom: 4,
  },
  storySubheading: {
    fontSize: 12,
    fontWeight: '500',
    color: TEXT_SEC,
    fontFamily: 'monospace',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 12,
  },
  storyDivider: {
    height: 1,
    backgroundColor: BORDER,
    marginBottom: 12,
  },
  storyBody: {
    fontSize: 14,
    fontWeight: '400',
    color: TEXT_PRI,
    fontFamily: 'monospace',
    lineHeight: 22,
    marginBottom: 16,
  },
  storyTimestamp: {
    fontSize: 11,
    fontWeight: '400',
    color: TEXT_TER,
    fontFamily: 'monospace',
  },
});
