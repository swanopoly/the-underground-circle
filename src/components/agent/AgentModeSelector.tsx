/**
 * AgentModeSelector — Horizontal pill row for selecting the agent mode.
 *
 * Modes: Talk, Plan, Execute, Review, Research, Support, Design
 * Each has a monospace icon glyph and accent color.
 * Shown above the chat input in both main chat and room chat.
 */

import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, Platform, StyleSheet } from 'react-native';

// ─── Mode Definitions ───────────────────────────────────────────────────────

export interface AgentMode {
  key: string;
  label: string;
  icon: string;
  color: string;
  description: string;
}

export const AGENT_MODES: AgentMode[] = [
  { key: 'talk',     label: 'Talk',     icon: '..',  color: '#22c55e', description: 'Natural conversation' },
  { key: 'plan',     label: 'Plan',     icon: 'P',   color: '#6366f1', description: 'Break down and strategize' },
  { key: 'execute',  label: 'Execute',  icon: '!',   color: '#f59e0b', description: 'Concrete actions and code' },
  { key: 'review',   label: 'Review',   icon: '?',   color: '#6366f1', description: 'Critique and improve' },
  { key: 'research', label: 'Research', icon: 'R',   color: '#a855f7', description: 'Cite sources, compare, report' },
  { key: 'support',  label: 'Support',  icon: 'S',   color: '#3b82f6', description: 'Answer questions, escalate' },
  { key: 'design',   label: 'Design',   icon: 'D',   color: '#ec4899', description: 'Visual approach and mockups' },
];

// ─── Props ──────────────────────────────────────────────────────────────────

interface AgentModeSelectorProps {
  mode: string;
  onModeChange: (mode: string) => void;
  accentColor: string;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function AgentModeSelector({
  mode,
  onModeChange,
  accentColor,
}: AgentModeSelectorProps) {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  return (
    <View style={styles.container} nativeID="section-agent-mode-selector">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {AGENT_MODES.map((m) => {
          const isActive = m.key === mode;
          const isHovered = m.key === hoveredKey;
          const pillColor = isActive ? m.color : '#3e3e3e';

          return (
            <Pressable
              key={m.key}
              onPress={() => onModeChange(m.key)}
              onHoverIn={() => setHoveredKey(m.key)}
              onHoverOut={() => setHoveredKey(null)}
              accessibilityRole="button"
              accessibilityLabel={`${m.label} mode: ${m.description}`}
              accessibilityState={{ selected: isActive }}
              style={[
                styles.pill,
                {
                  borderColor: pillColor + (isActive ? '80' : '40'),
                  backgroundColor: isActive
                    ? m.color + '18'
                    : isHovered
                      ? '#1a1a28'
                      : 'transparent',
                },
                ...(Platform.OS === 'web'
                  ? [{ cursor: 'pointer', transition: 'all 0.15s ease' } as any]
                  : []),
              ]}
            >
              {/* Icon block */}
              <View
                style={[
                  styles.iconBox,
                  {
                    backgroundColor: isActive ? m.color + '25' : '#1a1a25',
                    borderColor: isActive ? m.color + '50' : '#2a2a3e',
                  },
                ]}
              >
                <Text
                  style={[
                    styles.iconText,
                    { color: isActive ? m.color : '#6f6f6f' },
                  ]}
                >
                  {m.icon}
                </Text>
              </View>

              {/* Label */}
              <Text
                style={[
                  styles.label,
                  {
                    color: isActive ? m.color : isHovered ? '#9e9e9e' : '#6f6f6f',
                  },
                ]}
              >
                {m.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  scrollContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 2,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 2,
    paddingVertical: 4,
    paddingHorizontal: 8,
    gap: 5,
  },
  iconBox: {
    width: 22,
    height: 22,
    borderWidth: 1,
    borderRadius: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: {
    fontSize: 10,
    fontWeight: '800',
    fontFamily: 'monospace',
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
    fontFamily: 'monospace',
    letterSpacing: 0.5,
  },
});
