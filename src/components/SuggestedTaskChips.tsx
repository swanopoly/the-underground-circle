/**
 * SuggestedTaskChips — presentational row of "next action" chips shown under
 * a first-run empty state so a new user always has an obvious thing to try.
 *
 * PRESENTATIONAL ONLY: renders the chips and calls `onPick(action)` when one
 * is tapped. It has no knowledge of navigation, commands, or side effects —
 * the host surface decides what an action means. Suggestions come from the
 * pure module src/lib/emptyStateSuggestions.ts.
 *
 * Works on React Native and React Native Web. Dark theme to match the app's
 * empty states.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View, Platform } from 'react-native';
import type {
  EmptyStateSuggestion,
  EmptyStateSuggestionAction,
} from '../lib/emptyStateSuggestions';
import { EMPTY_STATE_MAX_SUGGESTIONS } from '../lib/emptyStateSuggestions';

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

interface Props {
  /** Suggestions to render. Only the first {@link EMPTY_STATE_MAX_SUGGESTIONS} are shown. */
  suggestions: EmptyStateSuggestion[];
  /** Called with the picked suggestion's action. The host performs the effect. */
  onPick: (action: EmptyStateSuggestionAction) => void;
  /** Accent color for chip borders / arrows. */
  accentColor?: string;
  /**
   * Optional label shown above the row. Defaults to a gentle prompt. Pass
   * an empty string to hide it.
   */
  heading?: string;
  /** nativeID passthrough for e2e / analytics anchoring. */
  nativeID?: string;
}

export default function SuggestedTaskChips({
  suggestions,
  onPick,
  accentColor = '#6366f1',
  heading = 'Try one of these',
  nativeID,
}: Props) {
  const shown = Array.isArray(suggestions)
    ? suggestions.slice(0, EMPTY_STATE_MAX_SUGGESTIONS)
    : [];
  if (shown.length === 0) return null;

  return (
    <View style={styles.wrap} nativeID={nativeID}>
      {heading ? <Text style={styles.heading}>{heading}</Text> : null}
      <View style={styles.row}>
        {shown.map((s, i) => (
          <Pressable
            key={`${s.action.kind}:${s.action.value}:${i}`}
            onPress={() => onPick(s.action)}
            accessibilityRole="button"
            accessibilityLabel={s.label}
            accessibilityHint={s.hint || undefined}
            style={({ pressed }) => [
              styles.chip,
              { borderColor: accentColor + '55' },
              pressed && { backgroundColor: accentColor + '18' },
              Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
            ]}
          >
            <View style={styles.chipTextCol}>
              <View style={styles.chipLabelRow}>
                <Text style={[styles.chipArrow, { color: accentColor }]}>{'>'}</Text>
                <Text style={styles.chipLabel} numberOfLines={1}>
                  {s.label}
                </Text>
              </View>
              {s.hint ? (
                <Text style={styles.chipHint} numberOfLines={2}>
                  {s.hint}
                </Text>
              ) : null}
            </View>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    alignItems: 'center',
    gap: 8,
  },
  heading: {
    color: '#6b7280',
    fontSize: 10,
    letterSpacing: 1,
    textTransform: 'uppercase',
    fontWeight: '700',
    fontFamily: MONO,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
    maxWidth: 560,
  },
  chip: {
    flexGrow: 1,
    flexBasis: 240,
    maxWidth: 300,
    minWidth: 180,
    backgroundColor: '#0a0f1c',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  chipTextCol: {
    gap: 3,
  },
  chipLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  chipArrow: {
    fontSize: 12,
    fontWeight: '900',
    fontFamily: MONO,
  },
  chipLabel: {
    flex: 1,
    color: '#e6edf3',
    fontSize: 12,
    fontWeight: '700',
  },
  chipHint: {
    color: '#8b949e',
    fontSize: 11,
    lineHeight: 15,
  },
});
