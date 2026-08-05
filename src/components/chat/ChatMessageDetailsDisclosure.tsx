import React, { useState } from 'react';
import { View, Text, Pressable, Platform } from 'react-native';

export type ChatMessageDetailsDisclosureTone = 'neutral' | 'attention' | 'approval' | 'complete';

type Props = {
  /** One-line, user-facing gist shown next to the chevron while collapsed. */
  summary: string;
  /** Optional short status pill (e.g. "Needs your input"). */
  statusLabel?: string;
  statusTone?: ChatMessageDetailsDisclosureTone;
  /** Accent used for the chevron + open-state border tint. */
  accentColor: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
};

const TONE_COLOR: Record<ChatMessageDetailsDisclosureTone, string> = {
  neutral: '#64748b',
  attention: '#ef4444',
  approval: '#f59e0b',
  complete: '#22c55e',
};

/**
 * Compact-by-default disclosure for computer/desktop/app-task bot messages.
 * Collapsed it shows a single tappable header row (chevron + one-line summary
 * + optional status pill); open it reveals the explanatory cards below. Pure
 * presentational, owns its own open/closed state. Dark theme matching the
 * surrounding chat cards.
 */
export default function ChatMessageDetailsDisclosure({
  summary,
  statusLabel,
  statusTone = 'neutral',
  accentColor,
  children,
  defaultOpen = false,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const pillColor = TONE_COLOR[statusTone] || TONE_COLOR.neutral;
  return (
    <View
      style={{
        marginTop: 8,
        borderWidth: 1,
        borderColor: open ? `${accentColor}45` : '#2a2a2a',
        borderRadius: 8,
        backgroundColor: '#161616',
        overflow: 'hidden',
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={open ? 'Hide details' : 'Show details'}
        onPress={() => setOpen((prev) => !prev)}
        style={({ pressed }) => [
          {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            paddingHorizontal: 10,
            paddingVertical: 8,
            backgroundColor: pressed ? '#1d1d1d' : 'transparent',
          },
          Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
        ]}
      >
        <Text style={{ color: accentColor, fontSize: 11, fontWeight: '900', width: 12 }}>
          {open ? '▾' : '▸'}
        </Text>
        <Text
          style={{
            flex: 1,
            color: '#94a3b8',
            fontSize: 11,
            fontWeight: '800',
            letterSpacing: 1,
            textTransform: 'uppercase',
          }}
          numberOfLines={2}
        >
          {summary}
        </Text>
        {statusLabel ? (
          <View
            style={{
              borderWidth: 1,
              borderColor: `${pillColor}66`,
              backgroundColor: `${pillColor}14`,
              borderRadius: 999,
              paddingHorizontal: 7,
              paddingVertical: 2,
            }}
          >
            <Text style={{ color: pillColor, fontSize: 9, fontWeight: '800' }} numberOfLines={1}>
              {statusLabel}
            </Text>
          </View>
        ) : null}
      </Pressable>
      {open ? (
        <View style={{ paddingHorizontal: 10, paddingBottom: 10, gap: 8 }}>
          {children}
        </View>
      ) : null}
    </View>
  );
}
