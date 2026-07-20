/**
 * FollowupChipRow — renders a finalized bot turn's cross-surface follow-up
 * actions (derived by crossSurfaceFollowupCore) as tappable chips: create a
 * Feed task for untracked work, open/retry the run in Office, or resolve a
 * pending approval. Visual clone of QuickReplyChips so the two chip rows read
 * as one system; the parent owns what each chip actually does (tab switch,
 * task-create event, input seed).
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View, Platform } from 'react-native';
import type { CrossSurfaceFollowup } from '../../../../lib/crossSurfaceFollowupCore';

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

interface Props {
  followups: CrossSurfaceFollowup[];
  onPress: (followup: CrossSurfaceFollowup) => void;
  accentColor?: string;
  label?: string;
}

export default function FollowupChipRow({ followups, onPress, accentColor = '#6366f1', label = 'Follow up' }: Props) {
  const items = (followups || [])
    .filter((f) => f && typeof f.label === 'string' && f.label.trim().length > 0)
    .slice(0, 4);
  if (items.length === 0) return null;
  return (
    <View style={s.wrap} nativeID="section-chat-followup-chips">
      <Text style={[s.kicker, { color: accentColor }]}>{label.toUpperCase()}</Text>
      <View style={s.row}>
        {items.map((followup, index) => (
          <Pressable
            key={`${index}:${followup.kind}`}
            onPress={() => onPress(followup)}
            style={({ pressed }) => [
              s.chip,
              { borderColor: accentColor + '50' },
              pressed && { backgroundColor: accentColor + '1e' },
            ]}
            accessibilityLabel={followup.hint || followup.label}
          >
            <Text style={[s.chipText, { color: accentColor }]} numberOfLines={2}>{followup.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 6, marginTop: 4 },
  kicker: { fontSize: 9, fontWeight: '900', letterSpacing: 1.5, fontFamily: MONO },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    maxWidth: '100%',
  },
  chipText: { fontSize: 12, fontWeight: '700' },
});
