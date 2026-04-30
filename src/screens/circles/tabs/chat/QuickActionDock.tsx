/**
 * QuickActionDock — persistent inline row of one-tap shortcuts under the
 * chat composer. Surfaces the high-frequency commands users would
 * otherwise need to remember as slash strings: /run, /assign, /diag,
 * /memories, /mission, /remember, /search.
 *
 * Inspired by Linear's command-palette ergonomics + Cursor's quick
 * actions. Goal: every common navigation/automation is one tap from
 * the chat input. Power users can still type slash; new users see the
 * verbs and learn by tapping.
 *
 * Each pill, when tapped, seeds the composer with the command text +
 * trailing space, focusing the user's typing cursor right after the
 * verb. They finish the argument and hit send.
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, Platform } from 'react-native';

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

interface QuickActionPillSpec {
  /** Slash command + space, ready to be inserted into the composer. */
  insert: string;
  /** Short label shown in the pill — keep under ~12 chars. */
  label: string;
  /** Glyph or short emoji-free icon. */
  icon: string;
  /** Tooltip / accessibility hint. */
  hint: string;
  /** Color accent for the pill border. */
  color: string;
}

const QUICK_ACTIONS: QuickActionPillSpec[] = [
  { insert: '/run ',      label: 'RUN',       icon: '$',  hint: 'Run a shell command on your machine via the bridge', color: '#22d3ee' },
  { insert: '/assign ',   label: 'ASSIGN',    icon: '→',  hint: 'Assign a task to a specific agent session by name',  color: '#22c55e' },
  { insert: '/mission ',  label: 'MISSION',   icon: '#',  hint: 'Mission status, create, complete',                   color: '#f59e0b' },
  { insert: '/remember ', label: 'REMEMBER',  icon: '◆',  hint: 'Save something to memory',                           color: '#a855f7' },
  { insert: '/memories',  label: 'MEMORIES',  icon: '☰',  hint: 'Open the memory viewer',                             color: '#a855f7' },
  { insert: '/diag',      label: 'DIAG',      icon: '✓',  hint: 'Probe all local bridges',                            color: '#22d3ee' },
  { insert: '/search ',   label: 'SEARCH',    icon: '⌕',  hint: 'Search this chat',                                   color: '#94a3b8' },
];

interface Props {
  /** Called with the text to insert into the composer (already includes
   *  trailing space when applicable). The host (ChatTab) sets the input
   *  state and focuses the text input. */
  onInsert: (text: string) => void;
  /** When true, hide the dock — useful when the user is mid-composition
   *  with a longer message and the dock would just be visual noise. */
  hidden?: boolean;
  accentColor?: string;
}

export default function QuickActionDock({ onInsert, hidden, accentColor = '#22d3ee' }: Props) {
  if (hidden) return null;
  return (
    <View style={s.dock} nativeID="section-quick-action-dock">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.scrollContent}
      >
        {QUICK_ACTIONS.map((action) => (
          <Pressable
            key={action.insert}
            onPress={() => onInsert(action.insert)}
            style={({ pressed }) => [
              s.pill,
              { borderColor: action.color + '40' },
              pressed && { backgroundColor: action.color + '15' },
            ]}
            accessibilityLabel={action.hint}
          >
            <Text style={[s.icon, { color: action.color }]}>{action.icon}</Text>
            <Text style={s.label}>{action.label}</Text>
          </Pressable>
        ))}
        {/* Tail spacer so the last pill isn't flush with the right edge. */}
        <View style={{ width: 4 }} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  dock: {
    paddingVertical: 4,
    paddingLeft: 4,
    backgroundColor: '#020617',
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
  },
  scrollContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingRight: 4,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    backgroundColor: '#0a0f1c',
  },
  icon: {
    fontSize: 11,
    fontWeight: '900',
    fontFamily: MONO,
  },
  label: {
    color: '#cbd5e1',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
    fontFamily: MONO,
  },
});
