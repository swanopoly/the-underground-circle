/**
 * FollowupChipRow — renders cross-surface chips: a finalized bot turn's
 * follow-up actions (crossSurfaceFollowupCore) or a user message's resolved
 * reference jump-tos (crossSurfaceReferenceResolverCore, mapped by the
 * parent). Visual clone of QuickReplyChips so the chip rows read as one
 * system; the parent owns what each chip actually does (tab switch,
 * task-create event, input seed). Props are structurally generic — the
 * component reads only `kind` / `label` / `hint`.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View, Platform } from 'react-native';

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

interface Props<T extends { kind: string; label: string; hint?: string }> {
  followups: T[];
  onPress: (followup: T) => void;
  accentColor?: string;
  label?: string;
}

export default function FollowupChipRow<T extends { kind: string; label: string; hint?: string }>(
  { followups, onPress, accentColor = '#6366f1', label = 'Follow up' }: Props<T>,
) {
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
