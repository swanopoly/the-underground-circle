/**
 * AssignPickerCard — when the user types `/assign` with no arg, show
 * a picker of every live agent in the circle. Tapping a row seeds
 * the composer with `/assign @<agent> ` so they can finish the task
 * description and send.
 *
 * Saves users from remembering exact agent names — they see the
 * roster, pick one, and type the task.
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, Platform } from 'react-native';

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

export interface AssignPickerAgent {
  id: string;
  name: string;
  provider?: string | null;
  status?: string | null;
  spirit?: string | null;
  color?: string | null;
}

interface Props {
  agents: AssignPickerAgent[];
  onPick: (agent: AssignPickerAgent) => void;
  accentColor?: string;
}

const PROVIDER_GLYPH: Record<string, string> = {
  'openswan':    '✦',
  'claude-code': '$',
  'codex':       '⌘',
  'gemini':      '◆',
  'gemini-cli':  '◆',
  'cursor':      '▲',
};

export default function AssignPickerCard({ agents, onPick, accentColor = '#22c55e' }: Props) {
  return (
    <View style={[s.card, { borderColor: accentColor + '40' }]} nativeID="section-chat-assign-picker">
      <View style={s.header}>
        <Text style={[s.kicker, { color: accentColor }]}>ASSIGN TO AGENT</Text>
        <Text style={s.count}>{agents.length} available</Text>
      </View>
      <Text style={s.hint}>Pick an agent — we'll seed the composer with /assign @&lt;name&gt; so you can type the task.</Text>
      {agents.length === 0 ? (
        <Text style={s.empty}>No live agents in this circle yet. Connect via the bridges or office.</Text>
      ) : (
        <ScrollView style={{ maxHeight: 280 }} contentContainerStyle={{ gap: 6 }}>
          {agents.map(agent => {
            const provider = (agent.provider || '').toLowerCase();
            const glyph = PROVIDER_GLYPH[provider] || '·';
            const tone = agent.color || accentColor;
            return (
              <Pressable
                key={agent.id}
                onPress={() => onPick(agent)}
                style={({ pressed }) => [
                  s.row,
                  { borderColor: tone + '30' },
                  pressed && { backgroundColor: tone + '14' },
                ]}
                accessibilityLabel={`Assign to ${agent.name}`}
              >
                <Text style={[s.glyph, { color: tone }]}>{glyph}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={s.name}>{agent.name}</Text>
                  <Text style={s.meta} numberOfLines={1}>
                    {provider ? provider : 'agent'}{agent.status ? ` · ${agent.status}` : ''}{agent.spirit ? ` · ${agent.spirit}` : ''}
                  </Text>
                </View>
                <Text style={[s.pickArrow, { color: tone }]}>→</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: '#0a0f1c',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    gap: 6,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  kicker: { fontSize: 9, fontWeight: '900', letterSpacing: 1.5, fontFamily: MONO },
  count: { fontSize: 9, color: '#64748b', fontFamily: MONO },
  hint: { color: '#64748b', fontSize: 11, lineHeight: 15, marginBottom: 4 },
  empty: { color: '#64748b', fontStyle: 'italic', fontSize: 11, textAlign: 'center', paddingVertical: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 10,
  },
  glyph: { fontSize: 14, fontWeight: '900', fontFamily: MONO, width: 18, textAlign: 'center' },
  name: { color: '#e2e8f0', fontSize: 12, fontWeight: '700' },
  meta: { color: '#64748b', fontSize: 10, fontFamily: MONO },
  pickArrow: { fontSize: 14, fontWeight: '900' },
});
