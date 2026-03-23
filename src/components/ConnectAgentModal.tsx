/**
 * ConnectAgentModal — guides users through connecting their CLI agents
 * to The Underground Circle via cloud hooks.
 *
 * Flow:
 *  1. Pick agent type (Claude Code, Codex, Gemini CLI, etc.)
 *  2. Generate a connect token (or use existing)
 *  3. Show personalized config snippet to copy-paste
 *  4. Listen for first heartbeat → celebrate
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator,
  Platform,
} from 'react-native';
import {
  AgentType, ConnectToken, HookConfig,
  listConnectTokens, createConnectToken, deleteConnectToken, generateHookConfig,
} from '../lib/agentConnect';
import { supabase } from '../lib/supabase';

// ── Props ────────────────────────────────────────────────────────────────────

type Props = {
  circleId: string;
  onClose: () => void;
};

// ── Agent options ────────────────────────────────────────────────────────────

const AGENT_OPTIONS: { type: AgentType; label: string; icon: string; color: string; desc: string }[] = [
  { type: 'claude-code', label: 'Claude Code', icon: '💻', color: '#6366f1', desc: 'Native HTTP hooks' },
  { type: 'codex',       label: 'Codex CLI',   icon: '🧠', color: '#10a37f', desc: 'OpenAI\'s CLI agent' },
  { type: 'gemini-cli',  label: 'Gemini CLI',  icon: '♊', color: '#4285f4', desc: 'Google\'s CLI agent' },
  { type: 'cursor',      label: 'Cursor',      icon: '🎯', color: '#8b5cf6', desc: 'AI code editor' },
  { type: 'windsurf',    label: 'Windsurf',    icon: '🏄', color: '#06b6d4', desc: 'Codeium\'s editor' },
  { type: 'copilot',     label: 'Copilot',     icon: '🤖', color: '#1f6feb', desc: 'GitHub\'s AI agent' },
  { type: 'aider',       label: 'Aider',       icon: '🛠️', color: '#f59e0b', desc: 'AI pair programming' },
  { type: 'cline',       label: 'Cline',       icon: '⚡', color: '#ec4899', desc: 'VS Code AI agent' },
];

// ── Component ────────────────────────────────────────────────────────────────

export default function ConnectAgentModal({ circleId, onClose }: Props) {
  const [step, setStep] = useState<'pick' | 'setup' | 'waiting' | 'done'>('pick');
  const [selectedAgent, setSelectedAgent] = useState<AgentType | null>(null);
  const [token, setToken] = useState<ConnectToken | null>(null);
  const [hookConfig, setHookConfig] = useState<HookConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [connected, setConnected] = useState(false);
  const [pollTimer, setPollTimer] = useState<ReturnType<typeof setInterval> | null>(null);

  // Cleanup polling on unmount OR step change
  useEffect(() => {
    return () => {
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [pollTimer]);

  // Clear timer whenever we leave the 'waiting' step
  useEffect(() => {
    if (step !== 'waiting' && pollTimer) {
      clearInterval(pollTimer);
      setPollTimer(null);
    }
  }, [step]);

  // ── Step 1: Pick agent type ────────────────────────────────────────────────

  const handlePickAgent = useCallback(async (agentType: AgentType) => {
    setSelectedAgent(agentType);
    setLoading(true);
    setError('');

    try {
      // Check for existing token
      const tokens = await listConnectTokens();
      let connectToken = tokens.find(t => t.circleId === circleId);

      if (!connectToken) {
        // Create one
        connectToken = await createConnectToken(circleId, `${agentType} auto-connect`);
      }

      setToken(connectToken);
      setHookConfig(generateHookConfig(agentType, connectToken.token));
      setStep('setup');
    } catch (e: any) {
      setError(e.message || 'Failed to generate token');
    } finally {
      setLoading(false);
    }
  }, [circleId]);

  // ── Step 2→3: Copy config and start listening ──────────────────────────────

  const handleCopy = useCallback(async () => {
    if (!hookConfig) return;

    try {
      if (Platform.OS === 'web' && navigator.clipboard) {
        await navigator.clipboard.writeText(hookConfig.configSnippet);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      // Fallback: select all text
      setCopied(false);
    }
  }, [hookConfig]);

  const handleStartListening = useCallback(() => {
    setStep('waiting');

    // Poll for the agent showing up
    const timer = setInterval(async () => {
      if (!token || !selectedAgent) return;

      const { data } = await supabase
        .from('agent_connect_tokens')
        .select('last_used_at')
        .eq('id', token.id)
        .single();

      if (data?.last_used_at) {
        setConnected(true);
        setStep('done');
        clearInterval(timer);
      }
    }, 3000);

    setPollTimer(timer);
  }, [token, selectedAgent]);

  // ── Render helpers ─────────────────────────────────────────────────────────

  const renderPick = () => (
    <View>
      <Text style={s.title}>Connect Your Agent</Text>
      <Text style={s.subtitle}>
        Pick your CLI agent. We'll generate a config snippet that makes it
        report activity to your circle automatically — no bridges needed.
      </Text>

      <View style={s.grid}>
        {AGENT_OPTIONS.map(opt => (
          <Pressable
            key={opt.type}
            style={[s.agentCard, { borderColor: opt.color + '40' }]}
            onPress={() => handlePickAgent(opt.type)}
          >
            <Text style={s.agentIcon}>{opt.icon}</Text>
            <Text style={s.agentLabel}>{opt.label}</Text>
            <Text style={s.agentDesc}>{opt.desc}</Text>
          </Pressable>
        ))}
      </View>

      {loading && (
        <View style={s.loadingRow}>
          <ActivityIndicator color="#6366f1" />
          <Text style={s.loadingText}>Generating connect token...</Text>
        </View>
      )}

      {error ? <Text style={s.error}>{error}</Text> : null}
    </View>
  );

  const renderSetup = () => {
    if (!hookConfig || !token) return null;
    const agent = AGENT_OPTIONS.find(a => a.type === selectedAgent);

    return (
      <View>
        <Pressable onPress={() => setStep('pick')} style={s.backBtn}>
          <Text style={s.backText}>{'< Back'}</Text>
        </Pressable>

        <Text style={s.title}>
          {agent?.icon} Connect {agent?.label}
        </Text>

        <View style={s.stepsContainer}>
          {hookConfig.instructions.map((inst, i) => (
            <Text key={i} style={s.instruction}>
              {inst.startsWith('  ') ? inst : `${i + 1}. ${inst}`}
            </Text>
          ))}
        </View>

        <Text style={s.configLabel}>
          Add this to {hookConfig.configPath}:
        </Text>

        <View style={s.codeBlock}>
          <ScrollView horizontal>
            <Text style={s.codeText} selectable>
              {hookConfig.configSnippet}
            </Text>
          </ScrollView>
        </View>

        <View style={s.btnRow}>
          <Pressable style={s.copyBtn} onPress={handleCopy}>
            <Text style={s.copyBtnText}>
              {copied ? 'Copied!' : 'Copy Config'}
            </Text>
          </Pressable>

          <Pressable
            style={[s.copyBtn, { backgroundColor: '#22c55e' }]}
            onPress={handleStartListening}
          >
            <Text style={s.copyBtnText}>I've Pasted It</Text>
          </Pressable>
        </View>

        <View style={s.tokenInfo}>
          <Text style={s.tokenLabel}>Your connect token:</Text>
          <Text style={s.tokenValue} selectable numberOfLines={1}>
            {token.token}
          </Text>
          <Text style={s.tokenHint}>
            This token authenticates your agent. Keep it private.
          </Text>
        </View>
      </View>
    );
  };

  const renderWaiting = () => {
    const agent = AGENT_OPTIONS.find(a => a.type === selectedAgent);

    return (
      <View style={s.waitingContainer}>
        <ActivityIndicator size="large" color={agent?.color || '#6366f1'} />
        <Text style={s.waitingTitle}>Listening for {agent?.label}...</Text>
        <Text style={s.waitingSubtitle}>
          Open your terminal and start a {agent?.label} session.
          {'\n'}We'll detect it automatically when the hook fires.
        </Text>

        <Pressable
          style={[s.copyBtn, { marginTop: 20, backgroundColor: '#374151' }]}
          onPress={() => { setStep('setup'); if (pollTimer) clearInterval(pollTimer); }}
        >
          <Text style={s.copyBtnText}>Go Back</Text>
        </Pressable>
      </View>
    );
  };

  const renderDone = () => {
    const agent = AGENT_OPTIONS.find(a => a.type === selectedAgent);

    return (
      <View style={s.waitingContainer}>
        <Text style={{ fontSize: 48 }}>{agent?.icon}</Text>
        <Text style={[s.waitingTitle, { color: '#22c55e' }]}>
          {agent?.label} Connected!
        </Text>
        <Text style={s.waitingSubtitle}>
          Your agent is now reporting to the circle.
          {'\n'}It'll appear in the Office whenever you start a session.
        </Text>

        <Pressable
          style={[s.copyBtn, { marginTop: 20, backgroundColor: '#22c55e' }]}
          onPress={onClose}
        >
          <Text style={s.copyBtnText}>Done</Text>
        </Pressable>
      </View>
    );
  };

  // ── Main render ────────────────────────────────────────────────────────────

  return (
    <View style={s.overlay}>
      <Pressable style={s.backdrop} onPress={onClose} />
      <View style={s.modal}>
        <Pressable style={s.closeBtn} onPress={onClose}>
          <Text style={s.closeBtnText}>X</Text>
        </Pressable>

        <ScrollView
          style={s.content}
          contentContainerStyle={s.contentInner}
          showsVerticalScrollIndicator={false}
        >
          {step === 'pick' && renderPick()}
          {step === 'setup' && renderSetup()}
          {step === 'waiting' && renderWaiting()}
          {step === 'done' && renderDone()}
        </ScrollView>
      </View>
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 999,
  },
  backdrop: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  modal: {
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2a2a4a',
    width: '90%',
    maxWidth: 560,
    maxHeight: '85%',
    padding: 24,
  },
  closeBtn: {
    position: 'absolute',
    top: 12,
    right: 16,
    zIndex: 10,
    padding: 4,
  },
  closeBtnText: {
    color: '#666',
    fontSize: 18,
    fontWeight: '600',
  },
  content: { flex: 1 },
  contentInner: { paddingBottom: 16 },
  title: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 8,
  },
  subtitle: {
    color: '#9ca3af',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 20,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  agentCard: {
    backgroundColor: '#111827',
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    width: '47%',
    minWidth: 140,
    alignItems: 'center',
  },
  agentIcon: { fontSize: 32, marginBottom: 8 },
  agentLabel: { color: '#fff', fontSize: 15, fontWeight: '600', marginBottom: 4 },
  agentDesc: { color: '#6b7280', fontSize: 12, textAlign: 'center' },
  loadingRow: { flexDirection: 'row', alignItems: 'center', marginTop: 16, gap: 8 },
  loadingText: { color: '#9ca3af', fontSize: 13 },
  error: { color: '#ef4444', fontSize: 13, marginTop: 8 },
  backBtn: { marginBottom: 12 },
  backText: { color: '#6366f1', fontSize: 14 },
  stepsContainer: { marginBottom: 16 },
  instruction: {
    color: '#d1d5db',
    fontSize: 13,
    lineHeight: 20,
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },
  configLabel: {
    color: '#9ca3af',
    fontSize: 12,
    marginBottom: 6,
    fontWeight: '600',
  },
  codeBlock: {
    backgroundColor: '#0d1117',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#30363d',
    padding: 12,
    marginBottom: 16,
    maxHeight: 220,
  },
  codeText: {
    color: '#c9d1d9',
    fontSize: 12,
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
    lineHeight: 18,
  },
  btnRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  copyBtn: {
    backgroundColor: '#6366f1',
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    flex: 1,
    alignItems: 'center',
  },
  copyBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  tokenInfo: {
    backgroundColor: '#111827',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  tokenLabel: { color: '#6b7280', fontSize: 11, fontWeight: '600', marginBottom: 4 },
  tokenValue: {
    color: '#f59e0b',
    fontSize: 12,
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
    marginBottom: 4,
  },
  tokenHint: { color: '#4b5563', fontSize: 11 },
  waitingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  waitingTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
    marginTop: 16,
    marginBottom: 8,
  },
  waitingSubtitle: {
    color: '#9ca3af',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
});
