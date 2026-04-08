/**
 * HandoffCard — Actionable handoff suggestion rendered inline in chat.
 *
 * Shows a compact dark card with type-specific border color and icon.
 * User can press "Execute" to perform the handoff (create task, open room, etc.).
 */

import React, { useState } from 'react';
import { View, Text, Pressable, Platform, StyleSheet } from 'react-native';
import { HandoffSuggestion } from '../../lib/agentRuntime';
import { executeHandoff, HandoffAction } from '../../lib/agentHandoffs';

// ─── Config ─────────────────────────────────────────────────────────────────

const TYPE_CONFIG: Record<
  string,
  { icon: string; label: string; color: string }
> = {
  create_task: { icon: 'T', label: 'CREATE TASK', color: '#f59e0b' },
  open_room: { icon: 'R', label: 'OPEN ROOM', color: '#06b6d4' },
  escalate: { icon: '!', label: 'ESCALATE', color: '#ef4444' },
  continue_session: { icon: '>', label: 'CONTINUE', color: '#6366f1' },
};

// ─── Props ──────────────────────────────────────────────────────────────────

interface HandoffCardProps {
  suggestion: HandoffSuggestion;
  circleId: string;
  userId: string;
  onExecute: (action: HandoffAction) => void;
  accentColor: string;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function HandoffCard({
  suggestion,
  circleId,
  userId,
  onExecute,
  accentColor,
}: HandoffCardProps) {
  const [executing, setExecuting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [resultMessage, setResultMessage] = useState<string | null>(null);

  const config = TYPE_CONFIG[suggestion.type] || TYPE_CONFIG.continue_session;
  const borderColor = config.color;

  const handleExecute = async () => {
    if (executing || completed) return;
    setExecuting(true);
    try {
      const action = await executeHandoff(suggestion, circleId, userId);
      setResultMessage(action.message);
      setCompleted(true);
      onExecute(action);
    } catch (err: any) {
      setResultMessage(`Failed: ${err?.message || 'Unknown error'}`);
    } finally {
      setExecuting(false);
    }
  };

  return (
    <View
      style={[
        styles.card,
        { borderColor: borderColor + '60' },
        ...(Platform.OS === 'web'
          ? [{ boxShadow: `0 2px 12px ${borderColor}15` } as any]
          : []),
      ]}
      nativeID="section-handoff-card"
    >
      {/* Header row: icon + label */}
      <View style={styles.header}>
        <View style={[styles.iconBox, { backgroundColor: borderColor + '20', borderColor: borderColor + '40' }]}>
          <Text style={[styles.iconText, { color: borderColor }]}>
            {config.icon}
          </Text>
        </View>
        <Text style={[styles.typeLabel, { color: borderColor }]}>
          {config.label}
        </Text>
      </View>

      {/* Title + description */}
      <Text style={styles.title}>{suggestion.title}</Text>
      <Text style={styles.description}>{suggestion.description}</Text>

      {/* Action row */}
      {completed ? (
        <View style={styles.resultRow}>
          <Text style={[styles.resultText, { color: '#22c55e' }]}>
            {resultMessage}
          </Text>
        </View>
      ) : (
        <Pressable
          onPress={handleExecute}
          disabled={executing}
          accessibilityRole="button"
          accessibilityLabel={`Execute ${config.label}`}
          style={[
            styles.executeButton,
            { backgroundColor: borderColor + '18', borderColor: borderColor + '50' },
            executing && { opacity: 0.5 },
            ...(Platform.OS === 'web'
              ? [{ cursor: executing ? 'wait' : 'pointer', transition: 'all 0.15s ease' } as any]
              : []),
          ]}
        >
          <Text style={[styles.executeText, { color: borderColor }]}>
            {executing ? 'Executing...' : 'Execute'}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#0f0f17',
    borderWidth: 1,
    borderRadius: 2,
    padding: 12,
    marginVertical: 6,
    marginHorizontal: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  iconBox: {
    width: 28,
    height: 28,
    borderWidth: 1,
    borderRadius: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  iconText: {
    fontSize: 13,
    fontWeight: '800',
    fontFamily: 'monospace',
  },
  typeLabel: {
    fontSize: 11,
    fontWeight: '700',
    fontFamily: 'monospace',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  title: {
    color: '#e8e8e8',
    fontSize: 14,
    fontWeight: '600',
    fontFamily: 'monospace',
    marginBottom: 4,
  },
  description: {
    color: '#9e9e9e',
    fontSize: 12,
    fontFamily: 'monospace',
    lineHeight: 18,
    marginBottom: 10,
  },
  executeButton: {
    borderWidth: 1,
    borderRadius: 2,
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignItems: 'center',
    alignSelf: 'flex-start',
  },
  executeText: {
    fontSize: 12,
    fontWeight: '700',
    fontFamily: 'monospace',
    letterSpacing: 1,
  },
  resultRow: {
    paddingVertical: 4,
  },
  resultText: {
    fontSize: 12,
    fontFamily: 'monospace',
  },
});
