/**
 * AgentQuickConnect.tsx
 *
 * Shows the npx @underground-circle/connect command with the user's
 * pre-filled token. Auto-generates a token if needed.
 * Falls back to bridge detection for backward compat.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, Pressable, ActivityIndicator, Platform,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { ensureConnectToken } from '../lib/agentConnect';
import { detectClaudeCodeBridge } from '../lib/claudeCodeDetector';

interface Props {
  circleId?: string;
  onOpenWizard: () => void;
  compact?: boolean;
}

export default function AgentQuickConnect({ circleId, onOpenWizard, compact }: Props) {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [bridgeOnline, setBridgeOnline] = useState(false);

  // Auto-generate connect token
  useEffect(() => {
    let mounted = true;
    (async () => {
      const t = await ensureConnectToken(circleId);
      if (mounted) {
        setToken(t?.token || null);
        setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [circleId]);

  // Also poll for local bridge (backward compat)
  useEffect(() => {
    let mounted = true;
    const check = async () => {
      const ok = await detectClaudeCodeBridge();
      if (mounted) setBridgeOnline(ok);
    };
    check();
    const iv = setInterval(check, 5000);
    return () => { mounted = false; clearInterval(iv); };
  }, []);

  const handleCopy = useCallback(async (text: string) => {
    await Clipboard.setStringAsync(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

  if (bridgeOnline) {
    return (
      <View style={[s.root, compact && s.rootCompact]}>
        <Text style={s.onlineIcon}>&#x2713;</Text>
        <Text style={s.onlineTitle}>Agent bridge detected!</Text>
        <Text style={s.onlineSub}>Your sessions will appear momentarily...</Text>
        <ActivityIndicator color="#22c55e" size="small" style={{ marginTop: 8 }} />
      </View>
    );
  }

  const npxCmd = token
    ? `npx @underground-circle/connect --token=${token}`
    : 'npx @underground-circle/connect --token=YOUR_TOKEN';

  if (compact) {
    return (
      <View style={[s.root, s.rootCompact]}>
        {loading ? (
          <>
            <ActivityIndicator color="#6366f1" size="small" />
            <Text style={s.checkText}>Preparing...</Text>
          </>
        ) : (
          <>
            <Text style={{ fontSize: 24, marginBottom: 4 }}>&#x26A1;</Text>
            <Text style={s.compactTitle}>Connect your agent</Text>
            <View style={s.cmdBox}>
              <Text style={s.cmdText} numberOfLines={1}>{npxCmd}</Text>
              <Pressable
                style={[s.copyBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                onPress={() => handleCopy(npxCmd)}
              >
                <Text style={s.copyBtnText}>{copied ? 'Copied!' : 'Copy'}</Text>
              </Pressable>
            </View>
            <View style={s.scanRow}>
              <ActivityIndicator color="#6366f180" size="small" />
              <Text style={s.scanText}>Listening... auto-connects when detected</Text>
            </View>
            <Pressable
              onPress={onOpenWizard}
              style={[s.otherLink, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
            >
              <Text style={s.otherLinkText}>Manual setup</Text>
            </Pressable>
          </>
        )}
      </View>
    );
  }

  return (
    <View style={s.root}>
      {loading ? (
        <>
          <ActivityIndicator color="#6366f1" size="large" style={{ marginBottom: 16 }} />
          <Text style={s.title}>Preparing agent connect...</Text>
        </>
      ) : (
        <>
          <Text style={{ fontSize: 48, marginBottom: 12 }}>&#x26A1;</Text>
          <Text style={s.title}>Connect your AI agent</Text>
          <Text style={s.subtitle}>
            Run one command and your agent auto-connects to the circle — forever.
          </Text>

          <View style={s.stepCard}>
            <View style={s.stepHeader}>
              <View style={s.stepBadge}><Text style={s.stepBadgeText}>1</Text></View>
              <Text style={s.stepTitle}>Run this in any terminal:</Text>
            </View>
            <View style={s.cmdBoxLarge}>
              <Text style={s.cmdTextLarge} selectable>{npxCmd}</Text>
              <Pressable
                style={[s.copyBtnLarge, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                onPress={() => handleCopy(npxCmd)}
              >
                <Text style={s.copyBtnLargeText}>{copied ? 'Copied!' : 'Copy'}</Text>
              </Pressable>
            </View>
          </View>

          <View style={s.stepCard}>
            <View style={s.stepHeader}>
              <View style={s.stepBadge}><Text style={s.stepBadgeText}>2</Text></View>
              <Text style={s.stepTitle}>That's it — agents connect automatically</Text>
            </View>
            <Text style={s.stepDesc}>
              The CLI detects Claude Code, Codex, Gemini CLI, and Cursor on your machine
              and configures them to report activity to your circle. No bridges to run.
            </Text>
          </View>

          <View style={s.howItWorks}>
            <Text style={s.howTitle}>How it works</Text>
            <Text style={s.howText}>
              Your AI tools get lightweight hooks that ping the circle whenever you start a session.
              Works across machines. One-time setup per device.
            </Text>
          </View>

          <View style={s.scanRowLarge}>
            <ActivityIndicator color="#6366f180" size="small" />
            <Text style={s.scanTextLarge}>Listening for agent connections...</Text>
          </View>

          <Pressable
            onPress={onOpenWizard}
            style={[s.wizardLink, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
          >
            <Text style={s.wizardLinkText}>
              Prefer manual setup? Advanced options &#x2192;
            </Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { alignItems: 'center', paddingVertical: 24, paddingHorizontal: 16, width: '100%' },
  rootCompact: { paddingVertical: 12, paddingHorizontal: 12 },

  onlineIcon: { fontSize: 36, color: '#22c55e', marginBottom: 8 },
  onlineTitle: { color: '#22c55e', fontSize: 16, fontWeight: '700', fontFamily: 'monospace', marginBottom: 4 },
  onlineSub: { color: '#666', fontSize: 12, fontFamily: 'monospace', textAlign: 'center' },

  checkText: { color: '#888', fontSize: 13, fontFamily: 'monospace', marginTop: 8 },

  title: { color: '#e4e4e7', fontSize: 20, fontWeight: '700', fontFamily: 'monospace', marginBottom: 6, textAlign: 'center' },
  subtitle: { color: '#71717a', fontSize: 13, fontFamily: 'monospace', textAlign: 'center', marginBottom: 20, paddingHorizontal: 12, lineHeight: 20 },

  stepCard: {
    backgroundColor: '#111', borderWidth: 1, borderColor: '#27272a',
    borderRadius: 12, padding: 16, width: '100%', maxWidth: 500, marginBottom: 12,
  },
  stepHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  stepBadge: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#6366f1', alignItems: 'center', justifyContent: 'center' },
  stepBadgeText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  stepTitle: { color: '#d4d4d8', fontSize: 13, fontWeight: '600', fontFamily: 'monospace' },
  stepDesc: { color: '#71717a', fontSize: 12, fontFamily: 'monospace', lineHeight: 18, paddingLeft: 34 },

  cmdBox: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#0a0a0a', borderWidth: 1, borderColor: '#27272a',
    borderRadius: 8, padding: 10, gap: 8,
  },
  cmdText: { color: '#a78bfa', fontSize: 12, fontFamily: 'monospace', flex: 1 },
  copyBtn: {
    backgroundColor: '#1e1e2e', borderRadius: 6,
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: '#6366f133',
  },
  copyBtnText: { color: '#a5b4fc', fontSize: 11, fontWeight: '700', fontFamily: 'monospace' },

  cmdBoxLarge: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#0a0a0a', borderWidth: 1, borderColor: '#6366f130',
    borderRadius: 8, padding: 12, gap: 8,
  },
  cmdTextLarge: { color: '#a78bfa', fontSize: 13, fontFamily: 'monospace', flex: 1, fontWeight: '600' },
  copyBtnLarge: { backgroundColor: '#6366f1', borderRadius: 6, paddingHorizontal: 14, paddingVertical: 7 },
  copyBtnLargeText: { color: '#fff', fontSize: 12, fontWeight: '700', fontFamily: 'monospace' },

  howItWorks: {
    backgroundColor: '#0d0d11', borderWidth: 1, borderColor: '#1e1e2e',
    borderRadius: 10, padding: 14, width: '100%', maxWidth: 500, marginBottom: 12,
  },
  howTitle: { color: '#a1a1aa', fontSize: 12, fontWeight: '600', fontFamily: 'monospace', marginBottom: 4 },
  howText: { color: '#52525b', fontSize: 11, fontFamily: 'monospace', lineHeight: 16 },

  scanRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  scanText: { color: '#52525b', fontSize: 11, fontFamily: 'monospace' },
  scanRowLarge: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, marginBottom: 16 },
  scanTextLarge: { color: '#52525b', fontSize: 11, fontFamily: 'monospace' },

  wizardLink: { marginTop: 4, paddingVertical: 8 },
  wizardLinkText: { color: '#6366f1', fontSize: 12, fontFamily: 'monospace' },
  otherLink: { marginTop: 8, paddingVertical: 6 },
  otherLinkText: { color: '#6366f180', fontSize: 11, fontFamily: 'monospace' },

  compactTitle: { color: '#d4d4d8', fontSize: 13, fontWeight: '700', fontFamily: 'monospace', marginBottom: 4 },
});
