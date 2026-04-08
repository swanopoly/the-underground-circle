/**
 * RunStatusBar — Shows active run status, current subagent, step progress.
 * Renders inline in the chat above the message input.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet, Platform, ActivityIndicator } from 'react-native';

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

interface Props {
  status: 'idle' | 'running' | 'delegated' | 'waiting_approval';
  subagentName?: string;
  subagentIcon?: string;
  subagentColor?: string;
  currentStep?: string;
  stepCount?: number;
  totalSteps?: number;
  pluginName?: string;
  onPause?: () => void;
  onCancel?: () => void;
  accentColor?: string;
}

export default function RunStatusBar({
  status, subagentName, subagentIcon, subagentColor,
  currentStep, stepCount, totalSteps, pluginName,
  onPause, onCancel, accentColor = '#6366f1',
}: Props) {
  if (status === 'idle') return null;

  const statusColor = status === 'running' ? '#22c55e' : status === 'delegated' ? subagentColor || '#a855f7' : '#f59e0b';

  return (
    <View style={s.bar}>
      {/* Status indicator */}
      <View style={s.statusSection}>
        {status === 'running' || status === 'delegated' ? (
          <ActivityIndicator size="small" color={statusColor} />
        ) : (
          <View style={[s.statusDot, { backgroundColor: statusColor }]} />
        )}
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            {subagentName && (
              <View style={[s.subagentBadge, { backgroundColor: (subagentColor || '#a855f7') + '20', borderColor: (subagentColor || '#a855f7') + '40' }]}>
                <Text style={[s.subagentBadgeText, { color: subagentColor || '#a855f7' }]}>
                  {subagentIcon || subagentName.charAt(0)}
                </Text>
              </View>
            )}
            <Text style={[s.statusText, { color: statusColor }]}>
              {status === 'delegated' ? `${subagentName}` : status === 'waiting_approval' ? 'Waiting for approval' : 'Working'}
              {pluginName ? ` via ${pluginName}` : ''}
            </Text>
          </View>
          {currentStep && (
            <Text style={s.stepText} numberOfLines={1}>{currentStep}</Text>
          )}
        </View>
      </View>

      {/* Progress */}
      {totalSteps && totalSteps > 0 && (
        <View style={s.progressSection}>
          <View style={s.progressBar}>
            <View style={[s.progressFill, { width: `${Math.min(100, ((stepCount || 0) / totalSteps) * 100)}%`, backgroundColor: statusColor }]} />
          </View>
          <Text style={s.progressText}>{stepCount || 0}/{totalSteps}</Text>
        </View>
      )}

      {/* Controls */}
      <View style={s.controls}>
        {onPause && (
          <Pressable onPress={onPause} style={[s.controlBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
            <Text style={s.controlBtnText}>||</Text>
          </Pressable>
        )}
        {onCancel && (
          <Pressable onPress={onCancel} style={[s.controlBtn, s.cancelBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
            <Text style={[s.controlBtnText, { color: '#ef4444' }]}>X</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#0a0a10',
    borderTopWidth: 1,
    borderTopColor: '#1a1a28',
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a28',
  },
  statusSection: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 10, fontWeight: '700', fontFamily: MONO },
  stepText: { color: '#606075', fontSize: 9, fontFamily: MONO, marginTop: 1 },
  subagentBadge: { width: 16, height: 16, borderRadius: 2, borderWidth: 1, justifyContent: 'center', alignItems: 'center' },
  subagentBadgeText: { fontSize: 8, fontWeight: '800', fontFamily: MONO },
  progressSection: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  progressBar: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#1a1a28', overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 2 } as any,
  progressText: { color: '#3a3a4e', fontSize: 8, fontFamily: MONO },
  controls: { flexDirection: 'row', gap: 4 },
  controlBtn: { width: 20, height: 20, borderRadius: 2, backgroundColor: '#1a1a28', borderWidth: 1, borderColor: '#2a2a3e', justifyContent: 'center', alignItems: 'center' },
  cancelBtn: { borderColor: '#ef444440' },
  controlBtnText: { color: '#606075', fontSize: 8, fontWeight: '800', fontFamily: MONO },
});
