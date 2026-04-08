import React, { useState, useCallback } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { supabase } from '../../lib/supabase';

interface ContentReportButtonProps {
  circleId: string;
  targetUserId?: string;
  contentType: string;
  contentPreview: string;
  accentColor: string;
}

type ReportState = 'idle' | 'confirm' | 'sending' | 'done' | 'error';

export default function ContentReportButton({
  circleId,
  targetUserId,
  contentType,
  contentPreview,
  accentColor,
}: ContentReportButtonProps) {
  const [state, setState] = useState<ReportState>('idle');

  const handlePress = useCallback(() => {
    if (state === 'idle') {
      setState('confirm');
    }
  }, [state]);

  const handleConfirm = useCallback(async () => {
    setState('sending');
    try {
      const { data: { user } } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
      if (!user) {
        setState('error');
        return;
      }
      const { error } = await supabase.from('content_reports').insert({
        circle_id: circleId,
        reporter_id: user.id,
        target_user_id: targetUserId || null,
        content_type: contentType,
        content_preview: (contentPreview || '').slice(0, 500),
      });
      if (error) {
        console.warn('[ContentReport] insert error:', error.message);
        setState('error');
      } else {
        setState('done');
        setTimeout(() => setState('idle'), 2000);
      }
    } catch (err) {
      console.warn('[ContentReport] unexpected error:', err);
      setState('error');
      setTimeout(() => setState('idle'), 2000);
    }
  }, [circleId, targetUserId, contentType, contentPreview]);

  const handleCancel = useCallback(() => {
    setState('idle');
  }, []);

  // ── Confirm prompt ──
  if (state === 'confirm') {
    return (
      <View style={styles.confirmRow}>
        <Text style={styles.confirmText}>Report this content?</Text>
        <Pressable onPress={handleConfirm} style={[styles.confirmBtn, { backgroundColor: accentColor }]}>
          <Text style={styles.confirmBtnText}>Yes</Text>
        </Pressable>
        <Pressable onPress={handleCancel} style={styles.cancelBtn}>
          <Text style={styles.cancelBtnText}>No</Text>
        </Pressable>
      </View>
    );
  }

  // ── Sending / done / error states ──
  if (state === 'sending') {
    return (
      <View style={styles.statusWrap}>
        <Text style={styles.statusText}>...</Text>
      </View>
    );
  }
  if (state === 'done') {
    return (
      <View style={styles.statusWrap}>
        <Text style={[styles.statusText, { color: '#22c55e' }]}>Reported</Text>
      </View>
    );
  }
  if (state === 'error') {
    return (
      <View style={styles.statusWrap}>
        <Text style={[styles.statusText, { color: '#ef4444' }]}>Failed</Text>
      </View>
    );
  }

  // ── Idle: tiny flag icon button ──
  return (
    <Pressable onPress={handlePress} style={styles.flagBtn} hitSlop={6}>
      <Text style={styles.flagIcon}>F</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flagBtn: {
    width: 16,
    height: 16,
    borderRadius: 2,
    backgroundColor: '#1a1a25',
    borderWidth: 1,
    borderColor: '#2a2a3e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  flagIcon: {
    fontFamily: 'monospace',
    fontSize: 9,
    color: '#6f6f6f',
    fontWeight: '700',
  },
  confirmRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#0a0a0f',
    borderRadius: 2,
    borderWidth: 1,
    borderColor: '#2a2a3e',
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  confirmText: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: '#9e9e9e',
  },
  confirmBtn: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 2,
  },
  confirmBtnText: {
    fontFamily: 'monospace',
    fontSize: 9,
    color: '#fff',
    fontWeight: '700',
  },
  cancelBtn: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 2,
    backgroundColor: '#1a1a25',
    borderWidth: 1,
    borderColor: '#2a2a3e',
  },
  cancelBtnText: {
    fontFamily: 'monospace',
    fontSize: 9,
    color: '#6f6f6f',
  },
  statusWrap: {
    height: 16,
    justifyContent: 'center',
  },
  statusText: {
    fontFamily: 'monospace',
    fontSize: 9,
    color: '#6f6f6f',
  },
});
