/**
 * QuickReplyChips — renders a bot message's suggested replies as tappable chips.
 * Tapping a chip sends that text as the user's next message. Used by the chat
 * clarification loop so a user can answer "what should the task be?" with one
 * tap on an example instead of retyping it (the answer then flows through the
 * pending-clarification resume path and completes the task).
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View, Platform } from 'react-native';

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

interface Props {
  replies: string[];
  onPick: (reply: string) => void;
  accentColor?: string;
  label?: string;
}

export default function QuickReplyChips({ replies, onPick, accentColor = '#6366f1', label = 'Tap to answer' }: Props) {
  const items = (replies || []).map((reply) => String(reply || '').trim()).filter(Boolean).slice(0, 6);
  if (items.length === 0) return null;
  return (
    <View style={s.wrap} nativeID="section-chat-quick-replies">
      <Text style={[s.kicker, { color: accentColor }]}>{label.toUpperCase()}</Text>
      <View style={s.row}>
        {items.map((reply, index) => (
          <Pressable
            key={`${index}:${reply.slice(0, 24)}`}
            onPress={() => onPick(reply)}
            style={({ pressed }) => [
              s.chip,
              { borderColor: accentColor + '50' },
              pressed && { backgroundColor: accentColor + '1e' },
            ]}
            accessibilityLabel={`Reply: ${reply}`}
          >
            <Text style={[s.chipText, { color: accentColor }]} numberOfLines={2}>{reply}</Text>
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
