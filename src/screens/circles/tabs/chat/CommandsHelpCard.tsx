/**
 * CommandsHelpCard — interactive `/help` panel. Old /help dumped the
 * 80+ commands as plain text — readable but not actionable. This card
 * groups commands by category, lets the user filter by keyword, and
 * each row is a one-tap insert into the composer.
 *
 * The list is sourced live from CHAT_COMMAND_REGISTRY so the panel
 * stays in sync as commands are added/removed elsewhere.
 */
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, Platform } from 'react-native';
import {
  CHAT_COMMAND_REGISTRY,
  type ChatCommandDefinition,
  type ChatSlashCommandCategory,
  getChatCommandCategoryLabel,
} from '../../../../lib/chatCommandRegistry';

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

const CATEGORY_ORDER: ChatSlashCommandCategory[] = [
  'general',
  'knowledge',
  'memory',
  'missions',
  'rooms',
  'github',
  'wordpress',
  'ai_tools',
  'vault',
  'governance',
];

const CATEGORY_ACCENT: Record<ChatSlashCommandCategory, string> = {
  general:    '#94a3b8',
  knowledge:  '#6366f1',
  memory:     '#a855f7',
  missions:   '#f59e0b',
  rooms:      '#6366f1',
  github:     '#22c55e',
  wordpress:  '#0ea5e9',
  ai_tools:   '#ec4899',
  vault:      '#facc15',
  governance: '#ef4444',
};

interface Props {
  onInsert: (text: string) => void;
  accentColor?: string;
}

function groupByCategory(filtered: ChatCommandDefinition[]) {
  const groups: Partial<Record<ChatSlashCommandCategory, ChatCommandDefinition[]>> = {};
  for (const cmd of filtered) {
    if (cmd.showInHelp === false) continue;
    (groups[cmd.category] ||= []).push(cmd);
  }
  return groups;
}

function matchesQuery(cmd: ChatCommandDefinition, q: string): boolean {
  if (!q) return true;
  const haystack = [
    cmd.command,
    ...(cmd.aliases || []),
    cmd.title,
    cmd.description,
    ...(cmd.keywords || []),
  ].join(' ').toLowerCase();
  return haystack.includes(q);
}

export default function CommandsHelpCard({ onInsert, accentColor = '#94a3b8' }: Props) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () => CHAT_COMMAND_REGISTRY.filter(c => matchesQuery(c, q)),
    [q],
  );
  const groups = useMemo(() => groupByCategory(filtered), [filtered]);

  return (
    <View style={[s.card, { borderColor: accentColor + '40' }]} nativeID="section-chat-commands-help">
      <View style={s.header}>
        <Text style={[s.kicker, { color: accentColor }]}>COMMANDS</Text>
        <Text style={s.count}>{filtered.length} of {CHAT_COMMAND_REGISTRY.length}</Text>
      </View>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="filter — e.g. memory, github, mission"
        placeholderTextColor="#475569"
        style={s.filter}
      />
      <ScrollView style={{ maxHeight: 380 }} contentContainerStyle={{ gap: 10 }}>
        {CATEGORY_ORDER.map((cat) => {
          const list = groups[cat];
          if (!list || list.length === 0) return null;
          const color = CATEGORY_ACCENT[cat];
          return (
            <View key={cat} style={s.group}>
              <Text style={[s.groupTitle, { color }]}>{getChatCommandCategoryLabel(cat).toUpperCase()}</Text>
              {list.map((cmd) => (
                <Pressable
                  key={cmd.id}
                  onPress={() => onInsert(cmd.insertText)}
                  style={({ pressed }) => [
                    s.row,
                    { borderColor: color + '30' },
                    pressed && { backgroundColor: color + '14' },
                  ]}
                  accessibilityLabel={`Insert ${cmd.command} — ${cmd.description}`}
                >
                  <View style={s.rowHead}>
                    <Text style={[s.cmd, { color }]}>{cmd.command}</Text>
                    <Text style={s.title}>{cmd.title}</Text>
                  </View>
                  <Text style={s.desc} numberOfLines={2}>{cmd.description}</Text>
                </Pressable>
              ))}
            </View>
          );
        })}
        {filtered.length === 0 ? (
          <Text style={s.empty}>No commands match "{query}".</Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: '#0a0f1c',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    gap: 8,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  kicker: { fontSize: 9, fontWeight: '900', letterSpacing: 1.5, fontFamily: MONO },
  count: { fontSize: 9, color: '#64748b', fontFamily: MONO },
  filter: {
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#1e293b',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    color: '#e2e8f0',
    fontSize: 12,
    fontFamily: MONO,
  },
  group: { gap: 4 },
  groupTitle: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.2,
    fontFamily: MONO,
    marginBottom: 2,
  },
  row: {
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 2,
  },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cmd: { fontSize: 11, fontWeight: '900', fontFamily: MONO },
  title: { color: '#cbd5e1', fontSize: 11, fontWeight: '700' },
  desc: { color: '#64748b', fontSize: 10.5, lineHeight: 15 },
  empty: { color: '#64748b', fontStyle: 'italic', fontSize: 11, textAlign: 'center', paddingVertical: 12 },
});
