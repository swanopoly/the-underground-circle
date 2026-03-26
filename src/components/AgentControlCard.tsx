/**
 * AgentControlCard — compact agent control panel with remote shell
 *
 * Clean, single-card design that shows:
 *  - Agent name + status (ONLINE/PAUSED/OFFLINE) + close button
 *  - Connection status message (bridge connected, active sessions, etc.)
 *  - Provider info
 *  - Power buttons: KILL/RESUME, DISCONNECT, FULL PANEL
 *  - Remote shell: quick command chips + free-form input + output
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, Pressable, TextInput, ScrollView, StyleSheet, Platform,
  ActivityIndicator,
} from 'react-native';
import { OfficeAgent } from '../lib/officeAgents';
import { AgentControl, upsertAgentControl } from '../services/hitlService';
import { supabase } from '../lib/supabase';

const MONO = Platform.OS === 'web' ? 'monospace' : undefined;

type Props = {
  agent: OfficeAgent;
  circleId: string;
  control: AgentControl | null;
  onClose: () => void;
  onOpenPanel: () => void;
  onDisconnect: () => void;
  onRunCommand?: (cmd: string) => Promise<{ ok: boolean; stdout?: string; stderr?: string }>;
  embedded?: boolean;  // When true, skip card container + header (embedded in AgentPanel)
};

const QUICK_COMMANDS = [
  { label: 'pwd',        cmd: 'pwd',                 icon: '📂' },
  { label: 'git status', cmd: 'git status',          icon: '🔀' },
  { label: 'git log',    cmd: 'git log --oneline -5', icon: '📋' },
  { label: 'ls',         cmd: 'ls -la',              icon: '📁' },
  { label: 'disk',       cmd: 'df -h /',             icon: '💾' },
  { label: 'uptime',     cmd: 'uptime',              icon: '⏱️' },
  { label: 'top',        cmd: 'ps aux --sort=-%cpu | head -8', icon: '📊' },
  { label: 'node -v',    cmd: 'node -v',             icon: '🟢' },
];

// ── Kill commands per provider ───────────────────────────────────────────────

const KILL_COMMANDS: Record<string, string> = {
  'claude-code': 'pkill -f "claude" 2>/dev/null; echo "✓ Claude Code processes terminated"',
  'codex':       'pkill -f "codex" 2>/dev/null; echo "✓ Codex processes terminated"',
  'gemini':      'pkill -f "gemini" 2>/dev/null; echo "✓ Gemini CLI processes terminated"',
  'openclaw':    'pkill -f "openclaw" 2>/dev/null; echo "✓ OpenClaw processes terminated"',
};

const BRIDGE_PORTS: Record<string, number> = {
  'claude-code': 7778,
  'codex': 7779,
  'gemini': 7780,
  'cursor': 7781,
  'openclaw': 18789,
};

// ── Component ────────────────────────────────────────────────────────────────

export default function AgentControlCard({
  agent, circleId, control, onClose, onOpenPanel, onDisconnect, onRunCommand, embedded = false,
}: Props) {
  const [cmdInput, setCmdInput] = useState('');
  const [cmdOutput, setCmdOutput] = useState('');
  const [cmdRunning, setCmdRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [bridgeOk, setBridgeOk] = useState<boolean | null>(null);

  const isPaused = control?.is_paused ?? false;
  const isOnline = agent.status === 'active' || agent.status === 'building' || agent.status === 'idle';
  const provider = agent.providerType || 'claude-code';

  // Check bridge health on mount + every 15s
  const checkBridge = useCallback(() => {
    const port = BRIDGE_PORTS[provider] || 7778;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    fetch(`http://localhost:${port}/health`, { signal: controller.signal })
      .then(r => { clearTimeout(timeout); return r.json(); })
      .then(d => {
        setBridgeOk(true);
        const sessions = d.sessions ?? 0;
        setStatusMsg(sessions > 0
          ? `Bridge connected — ${sessions} active session${sessions > 1 ? 's' : ''}`
          : 'Bridge connected — no active sessions');
      })
      .catch(() => {
        clearTimeout(timeout);
        setBridgeOk(false);
        setStatusMsg('Bridge offline — cannot reach local agent');
      });
  }, [provider]);

  useEffect(() => {
    checkBridge();
    const interval = setInterval(checkBridge, 15000);
    return () => clearInterval(interval);
  }, [checkBridge]);

  // ── Status ─────────────────────────────────────────────────────────────────

  const statusLabel = isPaused ? 'PAUSED' : agent.status === 'building' ? 'BUILDING' :
    agent.status === 'active' ? 'ACTIVE' : agent.status === 'idle' ? 'IDLE' :
    agent.status === 'error' ? 'ERROR' : 'OFFLINE';

  const statusColor = isPaused ? '#f59e0b' :
    agent.status === 'active' || agent.status === 'building' ? '#22c55e' :
    agent.status === 'idle' ? '#f59e0b' :
    agent.status === 'error' ? '#ef4444' : '#4b5563';

  // ── Power controls ─────────────────────────────────────────────────────────

  const handleKill = useCallback(async () => {
    setSaving(true);
    setCmdOutput('');
    let processKilled = false;
    try {
      // Try to kill via bridge — may fail if bridge is offline
      if (onRunCommand) {
        const result = await onRunCommand(KILL_COMMANDS[provider] || `echo "Unknown provider: ${provider}"`);
        processKilled = result.ok;
        setCmdOutput(result.stdout || result.stderr || 'Kill signal sent');
      }
      // Always update DB regardless of bridge status
      await upsertAgentControl(circleId, agent.sessionKey, agent.name, { is_paused: true });
      const { data: auth } = await supabase.auth.getUser();
      if (auth.user) {
        await supabase.from('circle_office_agents').update({
          status: 'offline', current_task: 'Killed by user', updated_at: new Date().toISOString(),
        }).eq('circle_id', circleId).eq('owner_id', auth.user.id).eq('name', agent.name);
      }
      if (processKilled) {
        setStatusMsg('Agent process terminated');
      } else {
        setStatusMsg('Agent marked offline — process may still be running (bridge unreachable)');
      }
    } catch (e: any) {
      setCmdOutput(`Error: ${e.message}`);
    }
    setSaving(false);
  }, [circleId, agent, provider, onRunCommand]);

  const handleResume = useCallback(async () => {
    setSaving(true);
    setCmdOutput('');
    try {
      await upsertAgentControl(circleId, agent.sessionKey, agent.name, { is_paused: false });
      const { data: auth } = await supabase.auth.getUser();
      if (auth.user) {
        await supabase.from('circle_office_agents').update({
          status: 'idle', current_task: 'Resumed — awaiting session', updated_at: new Date().toISOString(),
        }).eq('circle_id', circleId).eq('owner_id', auth.user.id).eq('name', agent.name);
      }
      setStatusMsg('Agent resumed — start a new CLI session to reconnect');
      setCmdOutput('✓ Agent unpaused');
    } catch (e: any) {
      setCmdOutput(`Error: ${e.message}`);
    }
    setSaving(false);
  }, [circleId, agent]);

  const handleDisconnect = useCallback(async () => {
    setSaving(true);
    try {
      // Try to kill agent process + bridge — best-effort, don't block on failure
      if (onRunCommand) {
        const killResult = await onRunCommand(KILL_COMMANDS[provider] || 'true').catch(() => ({ ok: false }));
        if (killResult.ok) {
          const port = BRIDGE_PORTS[provider] || 7778;
          await onRunCommand(`lsof -ti:${port} | xargs kill -9 2>/dev/null; echo "✓ Bridge on :${port} killed"`).catch(() => {});
        }
      }
      // Always DELETE the agent from the circle (not just mark offline — removes the pixel agent)
      const { data: auth } = await supabase.auth.getUser();
      if (auth.user) {
        await supabase.from('circle_office_agents')
          .delete()
          .eq('circle_id', circleId)
          .eq('owner_id', auth.user.id)
          .eq('name', agent.name);
      }
    } catch {}
    setSaving(false);
    onDisconnect();
  }, [circleId, agent, provider, onRunCommand, onDisconnect]);

  // ── Remote shell ───────────────────────────────────────────────────────────

  const runCmd = useCallback(async (cmd: string) => {
    if (!cmd.trim() || !onRunCommand) return;
    setCmdRunning(true);
    setCmdOutput('');
    try {
      const r = await onRunCommand(cmd.trim());
      setCmdOutput((r.stdout || '') + (r.stderr ? `\n${r.stderr}` : '') || (r.ok ? '(no output)' : 'Failed'));
    } catch (e: any) {
      setCmdOutput(`Error: ${e.message}`);
    }
    setCmdRunning(false);
  }, [onRunCommand]);

  // ── Render ─────────────────────────────────────────────────────────────────

  const content = (
    <>
      {/* ── SECTION: agent-bridge-status — Connection health ─────────────── */}
      <View style={c.connRow} nativeID="section-agent-bridge-status">
        <View style={[c.connDot, { backgroundColor: bridgeOk ? '#22c55e' : bridgeOk === false ? '#ef4444' : '#4b5563' }]} />
        <Text style={c.connText}>{statusMsg || 'Checking bridge...'}</Text>
        <Pressable onPress={checkBridge} style={{ padding: 4, ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) }}>
          <Text style={{ color: '#6b7280', fontSize: 10, fontFamily: MONO }}>refresh</Text>
        </Pressable>
      </View>

      {/* ── Provider info ───────────────────────────────────────────────────── */}
      <Text style={c.providerText}>
        {agent.model !== 'unknown' ? agent.model : provider}
        {agent.connectionName ? ` via ${agent.connectionName}` : ''}
      </Text>

      {/* ── Activity ────────────────────────────────────────────────────────── */}
      {agent.activity && agent.activity !== 'Idling' ? (
        <Text style={c.activityText} numberOfLines={2}>{agent.activity}</Text>
      ) : null}

      {/* ── SECTION: agent-power-buttons — Kill/Resume/Disconnect ─────── */}
      <View style={c.powerRow} nativeID="section-agent-power-buttons">
        {isPaused ? (
          <Pressable style={[c.powerBtn, c.btnResume]} onPress={handleResume} disabled={saving}>
            <Text style={c.btnText}>{saving ? '...' : '▶ RESUME'}</Text>
          </Pressable>
        ) : (
          <Pressable style={[c.powerBtn, c.btnKill]} onPress={handleKill} disabled={saving}>
            <Text style={c.btnText}>{saving ? '...' : '⏸ KILL AGENT'}</Text>
          </Pressable>
        )}
        <Pressable style={[c.powerBtn, c.btnDisconnect]} onPress={handleDisconnect} disabled={saving}>
          <Text style={c.btnText}>⏻ DISCONNECT</Text>
        </Pressable>
        {!embedded && (
          <Pressable style={[c.powerBtn, c.btnPanel]} onPress={onOpenPanel}>
            <Text style={c.btnText}>⚙ FULL PANEL</Text>
          </Pressable>
        )}
      </View>

      {/* ── Remote shell ────────────────────────────────────────────────────── */}
      {onRunCommand && bridgeOk && (
        <View style={c.shell}>
          <Text style={c.shellTitle}>REMOTE SHELL</Text>

          {/* Quick commands */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={c.qcScroll}>
            {QUICK_COMMANDS.map(q => (
              <Pressable
                key={q.cmd}
                onPress={() => { setCmdInput(q.cmd); runCmd(q.cmd); }}
                style={[c.qcBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
              >
                <Text style={c.qcText}>{q.icon} {q.label}</Text>
              </Pressable>
            ))}
          </ScrollView>

          {/* Input row */}
          <View style={c.inputRow}>
            <Text style={c.prompt}>$</Text>
            <TextInput
              style={c.input}
              value={cmdInput}
              onChangeText={setCmdInput}
              placeholder="run a command..."
              placeholderTextColor="#3b3b5b"
              onSubmitEditing={() => cmdInput.trim() && runCmd(cmdInput.trim())}
              returnKeyType="send"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Pressable
              style={[c.runBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
              onPress={() => cmdInput.trim() && runCmd(cmdInput.trim())}
              disabled={cmdRunning}
            >
              <Text style={c.runBtnText}>{cmdRunning ? '...' : 'RUN'}</Text>
            </Pressable>
          </View>

          {/* Output */}
          {(cmdOutput || cmdRunning) ? (
            <ScrollView style={c.output} nestedScrollEnabled>
              {cmdRunning && <ActivityIndicator size="small" color="#8b5cf6" style={{ marginBottom: 4 }} />}
              <Text style={c.outputText} selectable>{cmdOutput}</Text>
            </ScrollView>
          ) : null}
        </View>
      )}

      {/* ── SECTION: agent-no-bridge — Bridge offline warning ──────────── */}
      {bridgeOk === false && (
        <View style={c.noBridge} nativeID="section-agent-no-bridge">
          <Text style={c.noBridgeText}>
            Bridge not reachable on :{BRIDGE_PORTS[provider] || 7778}.{'\n'}
            Start the bridge: node scripts/{provider === 'codex' ? 'codex' : provider === 'gemini' ? 'gemini' : 'claude'}-bridge.js
          </Text>
        </View>
      )}
    </>
  );

  // When embedded in AgentPanel, skip the card container
  if (embedded) {
    return <View nativeID="section-agent-controls-embedded">{content}</View>;
  }

  // Standalone floating card mode
  return (
    <View style={c.card} nativeID="section-agent-control-card">
      {/* ── SECTION: agent-control-header ────────────────────────────────── */}
      <View style={c.header} nativeID="section-agent-control-header">
        <Text style={[c.agentName, { color: agent.color || '#e8e8e8' }]} numberOfLines={1}>
          {agent.name}
        </Text>
        <View style={[c.statusPill, { backgroundColor: statusColor + '20', borderColor: statusColor + '60' }]}>
          <View style={[c.statusDot, { backgroundColor: statusColor }]} />
          <Text style={[c.statusLabel, { color: statusColor }]}>{statusLabel}</Text>
        </View>
        <Pressable onPress={onClose} style={c.closeBtn} hitSlop={8}>
          <Text style={c.closeBtnText}>✕</Text>
        </Pressable>
      </View>
      {content}
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const c = StyleSheet.create({
  card: {
    backgroundColor: '#0c0c1d',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e1e3a',
    padding: 14,
    width: 340,
    maxHeight: 520,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 24,
    shadowOpacity: 0.6,
  },

  // Header
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 8 },
  agentName: { fontSize: 15, fontWeight: '800', fontFamily: MONO, flex: 1 },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: 10, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 2,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusLabel: { fontSize: 9, fontWeight: '800', fontFamily: MONO, letterSpacing: 0.8 },
  closeBtn: { padding: 2 },
  closeBtnText: { color: '#4b5563', fontSize: 16, fontWeight: '600' },

  // Connection
  connRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  connDot: { width: 5, height: 5, borderRadius: 3 },
  connText: { color: '#6b7280', fontSize: 10, fontFamily: MONO, flex: 1 },

  // Provider
  providerText: { color: '#4b5563', fontSize: 10, fontFamily: MONO, marginBottom: 4 },

  // Activity
  activityText: { color: '#9ca3af', fontSize: 11, fontFamily: MONO, lineHeight: 16, marginBottom: 6 },

  // Power buttons
  powerRow: { flexDirection: 'row', gap: 5, marginBottom: 10 },
  powerBtn: {
    flex: 1, paddingVertical: 7, borderRadius: 6, alignItems: 'center', borderWidth: 1,
  },
  btnKill: { backgroundColor: '#ef444412', borderColor: '#ef444440' },
  btnResume: { backgroundColor: '#22c55e12', borderColor: '#22c55e40' },
  btnDisconnect: { backgroundColor: '#f59e0b12', borderColor: '#f59e0b40' },
  btnPanel: { backgroundColor: '#6366f112', borderColor: '#6366f140' },
  btnText: {
    color: '#d1d5db', fontSize: 9, fontWeight: '800', fontFamily: MONO, letterSpacing: 0.4,
  },

  // Shell
  shell: { borderTopWidth: 1, borderTopColor: '#1e1e3a', paddingTop: 10 },
  shellTitle: { color: '#6b7280', fontSize: 9, fontWeight: '800', letterSpacing: 1.2, fontFamily: MONO, marginBottom: 6 },

  qcScroll: { marginBottom: 8, maxHeight: 30 },
  qcBtn: {
    backgroundColor: '#12122a', borderRadius: 5, borderWidth: 1, borderColor: '#1e1e3a',
    paddingHorizontal: 8, paddingVertical: 4, marginRight: 5,
  },
  qcText: { color: '#9ca3af', fontSize: 10, fontFamily: MONO },

  inputRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#08081a', borderRadius: 8, borderWidth: 1, borderColor: '#1e1e3a',
    paddingHorizontal: 10, marginBottom: 6,
  },
  prompt: { color: '#22c55e', fontSize: 13, fontWeight: '800', fontFamily: MONO, marginRight: 6 },
  input: {
    flex: 1, color: '#e8e8f8', fontSize: 12, fontFamily: MONO, paddingVertical: 8,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}),
  } as any,
  runBtn: { backgroundColor: '#8b5cf6', borderRadius: 5, paddingHorizontal: 10, paddingVertical: 4 },
  runBtnText: { color: '#fff', fontSize: 10, fontWeight: '800', fontFamily: MONO },

  output: {
    backgroundColor: '#08081a', borderRadius: 8, borderWidth: 1, borderColor: '#1e1e3a',
    padding: 10, maxHeight: 160,
  },
  outputText: { color: '#c9d1e8', fontSize: 11, fontFamily: MONO, lineHeight: 16 },

  // No bridge
  noBridge: {
    backgroundColor: '#ef444410', borderRadius: 8, borderWidth: 1, borderColor: '#ef444430',
    padding: 10, marginTop: 8,
  },
  noBridgeText: { color: '#fca5a5', fontSize: 10, fontFamily: MONO, lineHeight: 16, textAlign: 'center' },
});
