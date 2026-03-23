/**
 * AgentControlCard — floating popup card with power controls + remote shell
 *
 * Appears when clicking a pixel agent on the office floor.
 * Provides:
 *  - Status + current task
 *  - PAUSE / RESUME / DISCONNECT power buttons
 *  - Quick shell commands (run on the agent's machine via bridge /exec)
 *  - Free-form command input
 *  - Link to open full Agent Panel
 */

import React, { useState, useCallback } from 'react';
import {
  View, Text, Pressable, TextInput, ScrollView, StyleSheet, Platform,
  ActivityIndicator,
} from 'react-native';
import { OfficeAgent } from '../lib/officeAgents';
import { AgentControl, upsertAgentControl } from '../services/hitlService';
import { supabase } from '../lib/supabase';

// ── Types ────────────────────────────────────────────────────────────────────

type Props = {
  agent: OfficeAgent;
  circleId: string;
  control: AgentControl | null;
  onClose: () => void;
  onOpenPanel: () => void;          // Open full AgentPanel
  onDisconnect: () => void;         // Hard disconnect this agent
  onRunCommand?: (cmd: string) => Promise<{ ok: boolean; stdout?: string; stderr?: string }>;
};

// ── Quick commands ───────────────────────────────────────────────────────────

const QUICK_COMMANDS = [
  { label: 'pwd', cmd: 'pwd', icon: '📂' },
  { label: 'git status', cmd: 'git status', icon: '🔀' },
  { label: 'git log -5', cmd: 'git log --oneline -5', icon: '📋' },
  { label: 'ls', cmd: 'ls -la', icon: '📁' },
  { label: 'disk', cmd: 'df -h /', icon: '💾' },
  { label: 'uptime', cmd: 'uptime', icon: '⏱️' },
];

// ── Component ────────────────────────────────────────────────────────────────

export default function AgentControlCard({
  agent, circleId, control, onClose, onOpenPanel, onDisconnect, onRunCommand,
}: Props) {
  const [cmdInput, setCmdInput] = useState('');
  const [cmdOutput, setCmdOutput] = useState('');
  const [cmdRunning, setCmdRunning] = useState(false);
  const [saving, setSaving] = useState(false);

  const isPaused = control?.is_paused ?? false;
  const isOnline = agent.status === 'active' || agent.status === 'building' || agent.status === 'idle';

  // ── Power controls ─────────────────────────────────────────────────────────

  const handlePauseToggle = useCallback(async () => {
    setSaving(true);
    try {
      await upsertAgentControl(circleId, agent.sessionKey, agent.name, {
        is_paused: !isPaused,
      });
    } catch {}
    setSaving(false);
  }, [circleId, agent.sessionKey, agent.name, isPaused]);

  const handleDisconnect = useCallback(async () => {
    // Mark offline in DB
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (auth.user) {
        await supabase
          .from('circle_office_agents')
          .update({ status: 'offline', current_task: 'Disconnected by user', updated_at: new Date().toISOString() })
          .eq('circle_id', circleId)
          .eq('owner_id', auth.user.id)
          .eq('name', agent.name);
      }
    } catch {}
    onDisconnect();
  }, [circleId, agent.name, onDisconnect]);

  // ── Remote shell ───────────────────────────────────────────────────────────

  const runCommand = useCallback(async (cmd: string) => {
    if (!cmd.trim() || !onRunCommand) return;
    setCmdRunning(true);
    setCmdOutput('');
    try {
      const result = await onRunCommand(cmd.trim());
      const output = (result.stdout || '') + (result.stderr ? `\n${result.stderr}` : '');
      setCmdOutput(output || (result.ok ? '(no output)' : 'Command failed'));
    } catch (e: any) {
      setCmdOutput(`Error: ${e.message || 'Failed to execute'}`);
    }
    setCmdRunning(false);
  }, [onRunCommand]);

  const handleQuickCommand = useCallback((cmd: string) => {
    setCmdInput(cmd);
    runCommand(cmd);
  }, [runCommand]);

  const handleSubmitCommand = useCallback(() => {
    if (cmdInput.trim()) runCommand(cmdInput.trim());
  }, [cmdInput, runCommand]);

  // ── Status color ───────────────────────────────────────────────────────────

  const statusColor =
    agent.status === 'active' || agent.status === 'building' ? '#22c55e' :
    agent.status === 'idle' ? '#f59e0b' :
    agent.status === 'error' ? '#ef4444' :
    '#6b7280';

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <View style={s.card}>
      {/* Header */}
      <View style={s.header}>
        <View style={[s.statusDot, { backgroundColor: statusColor }]} />
        <Text style={s.agentName} numberOfLines={1}>{agent.name}</Text>
        <Text style={[s.statusText, { color: statusColor }]}>
          {isPaused ? 'PAUSED' : agent.status.toUpperCase()}
        </Text>
        <Pressable onPress={onClose} style={s.closeBtn}>
          <Text style={s.closeBtnText}>x</Text>
        </Pressable>
      </View>

      {/* Current task */}
      {agent.activity ? (
        <Text style={s.taskText} numberOfLines={2}>{agent.activity}</Text>
      ) : null}

      {/* Model + provider */}
      <Text style={s.metaText}>
        {agent.model !== 'unknown' ? agent.model : agent.providerType || 'agent'}
        {agent.connectionName ? ` via ${agent.connectionName}` : ''}
      </Text>

      {/* Power buttons */}
      <View style={s.powerRow}>
        <Pressable
          style={[s.powerBtn, isPaused ? s.powerBtnResume : s.powerBtnPause]}
          onPress={handlePauseToggle}
          disabled={saving}
        >
          <Text style={s.powerBtnText}>
            {saving ? '...' : isPaused ? '▶ RESUME' : '⏸ PAUSE'}
          </Text>
        </Pressable>

        <Pressable
          style={[s.powerBtn, s.powerBtnDisconnect]}
          onPress={handleDisconnect}
        >
          <Text style={s.powerBtnText}>⏻ DISCONNECT</Text>
        </Pressable>

        <Pressable
          style={[s.powerBtn, s.powerBtnPanel]}
          onPress={onOpenPanel}
        >
          <Text style={s.powerBtnText}>⚙ FULL PANEL</Text>
        </Pressable>
      </View>

      {/* Remote shell section */}
      {onRunCommand && isOnline && (
        <View style={s.shellSection}>
          <Text style={s.shellLabel}>REMOTE SHELL</Text>

          {/* Quick commands */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.quickRow}>
            {QUICK_COMMANDS.map(qc => (
              <Pressable
                key={qc.cmd}
                style={[s.quickBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                onPress={() => handleQuickCommand(qc.cmd)}
              >
                <Text style={s.quickBtnText}>{qc.icon} {qc.label}</Text>
              </Pressable>
            ))}
          </ScrollView>

          {/* Command input */}
          <View style={s.cmdRow}>
            <Text style={s.cmdPrompt}>$</Text>
            <TextInput
              style={s.cmdInput}
              value={cmdInput}
              onChangeText={setCmdInput}
              placeholder="run a command..."
              placeholderTextColor="#4b5563"
              onSubmitEditing={handleSubmitCommand}
              returnKeyType="send"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Pressable
              style={[s.cmdRunBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
              onPress={handleSubmitCommand}
              disabled={cmdRunning}
            >
              <Text style={s.cmdRunBtnText}>{cmdRunning ? '...' : 'RUN'}</Text>
            </Pressable>
          </View>

          {/* Output */}
          {(cmdOutput || cmdRunning) && (
            <ScrollView style={s.outputScroll} nestedScrollEnabled>
              {cmdRunning && <ActivityIndicator size="small" color="#6366f1" style={{ marginBottom: 4 }} />}
              <Text style={s.outputText} selectable>{cmdOutput}</Text>
            </ScrollView>
          )}
        </View>
      )}

      {!onRunCommand && isOnline && (
        <Text style={s.noShellText}>
          No local bridge detected — shell requires a running bridge.
        </Text>
      )}
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  card: {
    backgroundColor: '#111827',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e293b',
    padding: 12,
    width: 320,
    maxHeight: 420,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
    shadowOpacity: 0.5,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  agentName: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
    letterSpacing: 0.5,
  },
  closeBtn: { padding: 4 },
  closeBtnText: { color: '#6b7280', fontSize: 14, fontWeight: '600' },
  taskText: {
    color: '#9ca3af',
    fontSize: 11,
    marginBottom: 4,
    lineHeight: 15,
  },
  metaText: {
    color: '#4b5563',
    fontSize: 10,
    marginBottom: 8,
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },
  powerRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 8,
  },
  powerBtn: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: 6,
    alignItems: 'center',
  },
  powerBtnPause: { backgroundColor: '#f59e0b20', borderWidth: 1, borderColor: '#f59e0b40' },
  powerBtnResume: { backgroundColor: '#22c55e20', borderWidth: 1, borderColor: '#22c55e40' },
  powerBtnDisconnect: { backgroundColor: '#ef444420', borderWidth: 1, borderColor: '#ef444440' },
  powerBtnPanel: { backgroundColor: '#6366f120', borderWidth: 1, borderColor: '#6366f140' },
  powerBtnText: {
    color: '#d1d5db',
    fontSize: 9,
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
    letterSpacing: 0.3,
  },
  shellSection: {
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
    paddingTop: 8,
  },
  shellLabel: {
    color: '#6b7280',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 6,
  },
  quickRow: {
    flexDirection: 'row',
    marginBottom: 6,
    maxHeight: 28,
  },
  quickBtn: {
    backgroundColor: '#1e293b',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginRight: 4,
  },
  quickBtnText: {
    color: '#9ca3af',
    fontSize: 10,
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },
  cmdRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0d1117',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#30363d',
    paddingHorizontal: 8,
    marginBottom: 4,
  },
  cmdPrompt: {
    color: '#22c55e',
    fontSize: 12,
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
    marginRight: 4,
  },
  cmdInput: {
    flex: 1,
    color: '#c9d1d9',
    fontSize: 12,
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
    paddingVertical: 6,
    outlineStyle: 'none',
  } as any,
  cmdRunBtn: {
    backgroundColor: '#6366f1',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  cmdRunBtnText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  outputScroll: {
    backgroundColor: '#0d1117',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#30363d',
    padding: 8,
    maxHeight: 140,
  },
  outputText: {
    color: '#c9d1d9',
    fontSize: 11,
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
    lineHeight: 16,
  },
  noShellText: {
    color: '#4b5563',
    fontSize: 10,
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 4,
  },
});
