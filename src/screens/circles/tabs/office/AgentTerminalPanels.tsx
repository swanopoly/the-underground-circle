import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { MONO } from './AgentPanelShared';
import { OfficeAgent } from '../../../../lib/officeAgents';
import {
  getAgentIdentityKey,
  loadAgentIdentitiesExact,
  updateAgentIdentityExact,
  type AgentIdentityExactAuthority,
  type TerminalAgentOfficeConfig,
  type TerminalLaunchMode,
} from '../../../../lib/agentIdentity';
import { launchClaudeCodeSessions } from '../../../../lib/claudeCodeDetector';
import { launchCodexSessions } from '../../../../lib/codexDetector';
import { launchGeminiCliSessions } from '../../../../lib/geminiCliDetector';
import { sendTerminalAgentSessionMessage } from '../../../../lib/bridgeTaskDispatcher';

const QUICK_COMMANDS = [
  { label: 'pwd', cmd: 'pwd', icon: '>' },
  { label: 'git status', cmd: 'git status', icon: '~' },
  { label: 'git log', cmd: 'git log --oneline -5', icon: '#' },
  { label: 'ls', cmd: 'ls -la', icon: '[]' },
  { label: 'disk', cmd: 'df -h /', icon: 'D' },
  { label: 'uptime', cmd: 'uptime', icon: 'U' },
  { label: 'top', cmd: 'ps aux --sort=-%cpu | head -8', icon: '%' },
  { label: 'node -v', cmd: 'node -v', icon: 'N' },
];

const COMMAND_TIMEOUT_MS = 30_000;

function normalizeTerminalProvider(provider: string | null | undefined): 'claude-code' | 'codex' | 'gemini' | null {
  const normalized = String(provider || '').toLowerCase().replace(/\s+/g, '-');
  if (normalized === 'claude-code') return 'claude-code';
  if (normalized === 'codex') return 'codex';
  if (normalized === 'gemini' || normalized === 'gemini-cli') return 'gemini';
  return null;
}

function modeLabel(mode: TerminalLaunchMode): string {
  if (mode === 'full-auto') return 'Full Auto';
  if (mode === 'auto') return 'Auto Edit';
  return 'Safe';
}

function normalizeTerminalIdentityAuthority(
  circleId: string | undefined,
  authority: AgentIdentityExactAuthority | null | undefined,
): AgentIdentityExactAuthority | null {
  const userId = authority?.userId?.trim();
  const authorityCircleId = authority?.circleId?.trim();
  const accessToken = authority?.accessToken?.trim();
  if (!circleId || !userId || authorityCircleId !== circleId || !accessToken) return null;
  return { userId, circleId: authorityCircleId, accessToken };
}

export function AgentRemoteShell({ onRunCommand }: { onRunCommand: (cmd: string) => Promise<{ ok: boolean; stdout?: string; stderr?: string }> }) {
  const [cmdInput, setCmdInput] = useState('');
  const [cmdOutput, setCmdOutput] = useState('');
  const [cmdOutputKind, setCmdOutputKind] = useState<'idle' | 'ok' | 'empty' | 'timeout' | 'error'>('idle');
  const [cmdRunning, setCmdRunning] = useState(false);
  const [outputHeight, setOutputHeight] = useState(280);
  // Command history — up/down arrows cycle through recent commands. Cursor
  // points at the slot being viewed (-1 = live input, 0 = most recent, etc.).
  const [history, setHistory] = useState<string[]>([]);
  const historyCursor = useRef<number>(-1);
  const liveDraft = useRef<string>('');
  const scrollRef = useRef<ScrollView>(null);
  const dragStartY = useRef(0);
  const dragStartH = useRef(0);

  const runCmd = useCallback(async (cmd: string) => {
    const trimmed = cmd.trim();
    if (!trimmed) return;
    // Push into history if new (dedupes consecutive repeats). Reset cursor.
    setHistory(prev => (prev[0] === trimmed ? prev : [trimmed, ...prev].slice(0, 50)));
    historyCursor.current = -1;
    liveDraft.current = '';
    setCmdRunning(true);
    setCmdOutput('');
    setCmdOutputKind('idle');
    try {
      // Race the command against a timeout so hangs don't leave the UI spinning.
      const result = await Promise.race([
        onRunCommand(trimmed),
        new Promise<null>((_, reject) => setTimeout(() => reject(new Error('__timeout__')), COMMAND_TIMEOUT_MS)),
      ]);
      if (!result) {
        setCmdOutput(`(timed out after ${COMMAND_TIMEOUT_MS / 1000}s)`);
        setCmdOutputKind('timeout');
      } else {
        const stdout = result.stdout || '';
        const stderr = result.stderr || '';
        const combined = stdout + (stderr ? `\n${stderr}` : '');
        if (combined.trim().length > 0) {
          setCmdOutput(combined);
          setCmdOutputKind(result.ok ? 'ok' : 'error');
        } else if (result.ok) {
          setCmdOutput('(no output)');
          setCmdOutputKind('empty');
        } else {
          setCmdOutput('(failed, no output)');
          setCmdOutputKind('error');
        }
      }
    } catch (e: any) {
      if (e?.message === '__timeout__') {
        setCmdOutput(`(timed out after ${COMMAND_TIMEOUT_MS / 1000}s)`);
        setCmdOutputKind('timeout');
      } else {
        setCmdOutput(`Error: ${e?.message || 'unknown'}`);
        setCmdOutputKind('error');
      }
    }
    setCmdRunning(false);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
  }, [onRunCommand]);

  // Up/Down arrow history navigation (web only — native keyboards don't have
  // arrow keys exposed this way).
  const handleInputKey = useCallback((ev: any) => {
    if (Platform.OS !== 'web') return;
    const key = ev?.nativeEvent?.key ?? ev?.key;
    if (key === 'ArrowUp') {
      if (history.length === 0) return;
      ev.preventDefault?.();
      const idx = Math.min(historyCursor.current + 1, history.length - 1);
      if (historyCursor.current === -1) liveDraft.current = cmdInput;
      historyCursor.current = idx;
      setCmdInput(history[idx]);
    } else if (key === 'ArrowDown') {
      if (historyCursor.current < 0) return;
      ev.preventDefault?.();
      const idx = historyCursor.current - 1;
      historyCursor.current = idx;
      setCmdInput(idx < 0 ? liveDraft.current : history[idx]);
    }
  }, [cmdInput, history]);

  const handleResizeStart = (e: any) => {
    if (Platform.OS !== 'web') return;
    dragStartY.current = e.nativeEvent?.pageY || 0;
    dragStartH.current = outputHeight;
    const onMove = (ev: MouseEvent) => setOutputHeight(Math.max(150, Math.min(600, dragStartH.current + (ev.pageY - dragStartY.current))));
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <View style={{ paddingHorizontal: 8, marginBottom: 8 }} nativeID="section-agent-remote-shell">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 }}>
        <View style={{ width: 18, height: 18, borderRadius: 2, backgroundColor: '#22c55e15', borderWidth: 1, borderColor: '#22c55e30', justifyContent: 'center', alignItems: 'center' }}>
          <Text style={{ color: '#22c55e', fontSize: 12, fontWeight: '800', fontFamily: MONO }}>$</Text>
        </View>
        <Text style={{ color: '#909098', fontSize: 12, fontWeight: '700', letterSpacing: 1, fontFamily: MONO }}>REMOTE SHELL</Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10, maxHeight: 32 }} contentContainerStyle={{ gap: 4 }}>
        {QUICK_COMMANDS.map(command => (
          <Pressable
            key={command.cmd}
            onPress={() => { setCmdInput(command.cmd); runCmd(command.cmd); }}
            style={[
              { backgroundColor: '#0a0a10', borderRadius: 2, borderWidth: 1, borderColor: '#1a1a28', paddingHorizontal: 8, paddingVertical: 6 },
              Platform.OS === 'web' && { cursor: 'pointer' } as any,
            ]}
          >
            <Text style={{ color: '#808090', fontSize: 13, fontFamily: MONO }}>
              <Text style={{ color: '#22c55e', fontWeight: '700' }}>{command.icon}</Text> {command.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#05050a', borderRadius: 2, borderWidth: 1, borderColor: '#1a1a28', paddingHorizontal: 8, gap: 6, marginBottom: 8 }}>
        <Text style={{ color: '#22c55e', fontSize: 16, fontWeight: '800', fontFamily: MONO }}>$</Text>
        <TextInput
          style={{ flex: 1, color: '#e8e8f8', fontSize: 12, fontFamily: MONO, paddingVertical: 8, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}) } as any}
          value={cmdInput}
          onChangeText={(t) => {
            setCmdInput(t);
            historyCursor.current = -1;
            liveDraft.current = t;
          }}
          placeholder={history.length > 0 ? 'run a command (↑/↓ for history)…' : 'run a command…'}
          placeholderTextColor="#3b3b5b"
          onSubmitEditing={() => cmdInput.trim() && runCmd(cmdInput.trim())}
          onKeyPress={handleInputKey as any}
          returnKeyType="send"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Pressable style={[{ backgroundColor: '#22c55e', borderRadius: 2, paddingHorizontal: 10, paddingVertical: 5 }, Platform.OS === 'web' && { cursor: 'pointer' } as any]} onPress={() => cmdInput.trim() && runCmd(cmdInput.trim())} disabled={cmdRunning}>
          <Text style={{ color: '#050508', fontSize: 13, fontWeight: '800', fontFamily: MONO }}>{cmdRunning ? '..' : 'RUN'}</Text>
        </Pressable>
      </View>

      <ScrollView ref={scrollRef} style={{ height: outputHeight, backgroundColor: '#05050a', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 2, padding: 12 }} nestedScrollEnabled showsVerticalScrollIndicator>
        {!cmdOutput && !cmdRunning && <Text style={{ color: '#808090', fontSize: 14, fontFamily: MONO, fontStyle: 'italic' }}>Run a command to see output...</Text>}
        {cmdRunning && <ActivityIndicator size="small" color="#22c55e" style={{ marginBottom: 8 }} />}
        {cmdOutput ? (
          <Text
            style={{
              color:
                cmdOutputKind === 'error' ? '#ef4444' :
                cmdOutputKind === 'timeout' ? '#f59e0b' :
                cmdOutputKind === 'empty' ? '#707086' :
                '#c9d1e8',
              fontSize: 14, fontFamily: MONO, lineHeight: 16,
              fontStyle: cmdOutputKind === 'empty' ? 'italic' : 'normal',
            }}
            selectable
          >{cmdOutput}</Text>
        ) : null}
      </ScrollView>

      {Platform.OS === 'web' && (
        <View onPointerDown={handleResizeStart as any} style={{ height: 6, backgroundColor: '#1a1a28', borderRadius: 2, marginVertical: 2, alignItems: 'center' as any, justifyContent: 'center' as any, ...(Platform.OS === 'web' ? { cursor: 'ns-resize' } as any : {}) }}>
          <View style={{ width: 30, height: 2, backgroundColor: '#2a2a3e', borderRadius: 1 }} />
        </View>
      )}
    </View>
  );
}

export function AgentTerminalProfilePanel({
  agent,
  circleId,
  identityAuthority,
  onRenameAgent,
  onIdentityChange,
}: {
  agent: OfficeAgent;
  circleId?: string;
  identityAuthority?: AgentIdentityExactAuthority | null;
  onRenameAgent?: (agent: OfficeAgent, newName: string) => Promise<void> | void;
  onIdentityChange?: () => void;
}) {
  const identityKey = getAgentIdentityKey(agent);
  const provider = normalizeTerminalProvider(agent.providerType);
  const exactIdentityAuthority = useMemo(
    () => normalizeTerminalIdentityAuthority(circleId, identityAuthority),
    [circleId, identityAuthority?.accessToken, identityAuthority?.circleId, identityAuthority?.userId],
  );
  const identityRequestKey = exactIdentityAuthority
    ? `${exactIdentityAuthority.userId}\u0000${exactIdentityAuthority.circleId}\u0000${agent.id}\u0000${identityKey}`
    : '';
  const latestIdentityRequestKeyRef = useRef(identityRequestKey);
  const latestIdentityAccessTokenRef = useRef(exactIdentityAuthority?.accessToken || '');
  latestIdentityRequestKeyRef.current = identityRequestKey;
  latestIdentityAccessTokenRef.current = exactIdentityAuthority?.accessToken || '';
  const [displayName, setDisplayName] = useState(agent.name);
  const [config, setConfig] = useState<TerminalAgentOfficeConfig>({
    defaultCwd: agent.projectDir || '',
    defaultModel: agent.model && agent.model !== 'unknown' ? agent.model : '',
    defaultPrompt: '',
    launchMode: 'safe',
    autoSaveMemory: true,
  });
  const [saving, setSaving] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [result, setResult] = useState<string>('');

  useEffect(() => {
    setDisplayName(agent.name);
    setConfig({
      defaultCwd: agent.projectDir || '',
      defaultModel: agent.model && agent.model !== 'unknown' ? agent.model : '',
      defaultPrompt: '',
      launchMode: 'safe',
      autoSaveMemory: true,
    });
    setResult('');
    if (!exactIdentityAuthority || !identityRequestKey) return;
    let cancelled = false;
    const capturedRequestKey = identityRequestKey;
    loadAgentIdentitiesExact(exactIdentityAuthority).then((identities) => {
      if (
        cancelled
        || latestIdentityRequestKeyRef.current !== capturedRequestKey
        || latestIdentityAccessTokenRef.current !== exactIdentityAuthority.accessToken
      ) return;
      const identity = identities.get(identityKey);
      setDisplayName(identity?.customName || agent.name);
      setConfig({
        defaultCwd: identity?.terminalConfig?.defaultCwd ?? agent.projectDir ?? '',
        defaultModel: identity?.terminalConfig?.defaultModel ?? identity?.boundModel ?? (agent.model && agent.model !== 'unknown' ? agent.model : ''),
        defaultPrompt: identity?.terminalConfig?.defaultPrompt ?? '',
        launchMode: identity?.terminalConfig?.launchMode ?? 'safe',
        autoSaveMemory: identity?.terminalConfig?.autoSaveMemory ?? true,
      });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [agent.id, agent.model, agent.name, agent.projectDir, exactIdentityAuthority, identityKey, identityRequestKey]);

  const patchConfig = (patch: Partial<TerminalAgentOfficeConfig>) => {
    setConfig(prev => ({ ...prev, ...patch }));
  };

  const saveProfile = async (): Promise<boolean> => {
    const capturedAuthority = exactIdentityAuthority;
    const capturedRequestKey = identityRequestKey;
    if (!identityKey || !capturedAuthority || !capturedRequestKey) {
      setResult('Sign in to this circle before saving an Office terminal profile.');
      return false;
    }
    setSaving(true);
    setResult('');
    try {
      const cleanName = displayName.trim();
      if (cleanName && cleanName !== agent.name && onRenameAgent) {
        await onRenameAgent(agent, cleanName);
      }
      if (
        latestIdentityRequestKeyRef.current !== capturedRequestKey
        || latestIdentityAccessTokenRef.current !== capturedAuthority.accessToken
      ) return false;
      const receipt = await updateAgentIdentityExact(identityKey, {
        customName: cleanName || undefined,
        boundAiProvider: agent.providerType,
        boundModel: config.defaultModel?.trim() || agent.model,
        terminalConfig: {
          defaultCwd: config.defaultCwd?.trim() || undefined,
          defaultModel: config.defaultModel?.trim() || undefined,
          defaultPrompt: config.defaultPrompt?.trim() || undefined,
          launchMode: config.launchMode || 'safe',
          autoSaveMemory: config.autoSaveMemory !== false,
        },
        isCustomized: true,
      }, capturedAuthority);
      if (!receipt.localSaved) throw new Error(receipt.error || 'identity save failed');
      if (
        latestIdentityRequestKeyRef.current !== capturedRequestKey
        || latestIdentityAccessTokenRef.current !== capturedAuthority.accessToken
      ) return false;
      onIdentityChange?.();
      setResult('Saved terminal profile. Chat assignments will use this profile.');
      return true;
    } catch (err: any) {
      if (
        latestIdentityRequestKeyRef.current === capturedRequestKey
        && latestIdentityAccessTokenRef.current === capturedAuthority.accessToken
      ) {
        setResult(`Save failed: ${err?.message || 'unknown error'}`);
      }
      return false;
    } finally {
      if (
        latestIdentityRequestKeyRef.current === capturedRequestKey
        && latestIdentityAccessTokenRef.current === capturedAuthority.accessToken
      ) setSaving(false);
    }
  };

  const launchFromProfile = async () => {
    const capturedAuthority = exactIdentityAuthority;
    const capturedRequestKey = identityRequestKey;
    if (!capturedAuthority || !capturedRequestKey) {
      setResult('Sign in to this circle before launching an Office terminal profile.');
      return;
    }
    if (!provider) {
      setResult('This agent does not support managed terminal launches yet.');
      return;
    }
    setLaunching(true);
    setResult('');
    try {
      if (
        !await saveProfile()
        || latestIdentityRequestKeyRef.current !== capturedRequestKey
        || latestIdentityAccessTokenRef.current !== capturedAuthority.accessToken
      ) return;
      const prompt = config.defaultPrompt?.trim()
        || `Stand by as ${displayName.trim() || agent.name}. Wait for delegated tasks from The Underground Circle.`;
      const input = {
        count: 1,
        prompts: [prompt],
        names: [displayName.trim() || agent.name],
        model: config.defaultModel?.trim() || undefined,
        projectDir: config.defaultCwd?.trim() || undefined,
        cwd: config.defaultCwd?.trim() || undefined,
        circleId,
        userId: capturedAuthority.userId,
      };

      const launchResult = provider === 'claude-code'
        ? await launchClaudeCodeSessions({
            ...input,
            permissionMode: config.launchMode === 'full-auto'
              ? 'bypassPermissions'
              : config.launchMode === 'auto'
                ? 'acceptEdits'
                : 'default',
          })
        : provider === 'codex'
          ? await launchCodexSessions({ ...input, fullAuto: config.launchMode === 'full-auto' })
          : await launchGeminiCliSessions({ ...input, yolo: config.launchMode === 'full-auto' });

      if (
        latestIdentityRequestKeyRef.current !== capturedRequestKey
        || latestIdentityAccessTokenRef.current !== capturedAuthority.accessToken
      ) return;
      if (launchResult.ok && launchResult.launched > 0) {
        setResult(`Launched ${launchResult.launched} managed ${provider === 'gemini' ? 'Gemini CLI' : provider} session from this Office profile.`);
      } else {
        setResult(`Launch failed: ${launchResult.error || launchResult.failed?.[0]?.error || 'unknown error'}`);
      }
    } catch (err: any) {
      if (
        latestIdentityRequestKeyRef.current === capturedRequestKey
        && latestIdentityAccessTokenRef.current === capturedAuthority.accessToken
      ) {
        setResult(`Launch failed: ${err?.message || 'unknown error'}`);
      }
    } finally {
      if (
        latestIdentityRequestKeyRef.current === capturedRequestKey
        && latestIdentityAccessTokenRef.current === capturedAuthority.accessToken
      ) setLaunching(false);
    }
  };

  const inputStyle = {
    backgroundColor: '#05050a',
    borderWidth: 1,
    borderColor: '#1a1a28',
    borderRadius: 2,
    color: '#e8e8f8',
    fontSize: 12,
    fontFamily: MONO,
    paddingHorizontal: 10,
    paddingVertical: 8,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  } as any;

  return (
    <View style={{ paddingHorizontal: 8, marginBottom: 12 }} nativeID="section-agent-terminal-profile">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 }}>
        <View style={{ width: 18, height: 18, borderRadius: 2, backgroundColor: '#38bdf815', borderWidth: 1, borderColor: '#38bdf830', justifyContent: 'center', alignItems: 'center' }}>
          <Text style={{ color: '#38bdf8', fontSize: 11, fontWeight: '800', fontFamily: MONO }}>#</Text>
        </View>
        <Text style={{ color: '#909098', fontSize: 12, fontWeight: '700', letterSpacing: 1, fontFamily: MONO }}>OFFICE TERMINAL PROFILE</Text>
        <Text style={{ color: provider ? '#22c55e' : '#f59e0b', fontSize: 11, marginLeft: 'auto' as any, fontFamily: MONO }}>
          {provider ? 'MANAGED' : 'OBSERVE'}
        </Text>
      </View>

      <View style={{ gap: 8 }}>
        <Text style={{ color: '#707086', fontSize: 12, fontFamily: MONO }}>
          Saved here, used in Chat assignments, Office launches, and managed terminal follow-ups.
        </Text>

        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' as any }}>
          <View style={{ flex: 1, minWidth: 180 }}>
            <Text style={{ color: '#808090', fontSize: 11, fontWeight: '800', marginBottom: 4, fontFamily: MONO }}>DISPLAY NAME</Text>
            <TextInput value={displayName} onChangeText={setDisplayName} placeholder="Agent name" placeholderTextColor="#3b3b5b" style={inputStyle} />
          </View>
          <View style={{ flex: 1, minWidth: 180 }}>
            <Text style={{ color: '#808090', fontSize: 11, fontWeight: '800', marginBottom: 4, fontFamily: MONO }}>MODEL</Text>
            <TextInput value={config.defaultModel || ''} onChangeText={text => patchConfig({ defaultModel: text })} placeholder="default / provider model" placeholderTextColor="#3b3b5b" style={inputStyle} autoCapitalize="none" />
          </View>
        </View>

        <View>
          <Text style={{ color: '#808090', fontSize: 11, fontWeight: '800', marginBottom: 4, fontFamily: MONO }}>WORKING DIRECTORY</Text>
          <TextInput value={config.defaultCwd || ''} onChangeText={text => patchConfig({ defaultCwd: text })} placeholder="/Users/cswanson/the-underground-circle" placeholderTextColor="#3b3b5b" style={inputStyle} autoCapitalize="none" />
        </View>

        <View>
          <Text style={{ color: '#808090', fontSize: 11, fontWeight: '800', marginBottom: 4, fontFamily: MONO }}>DEFAULT INSTRUCTIONS</Text>
          <TextInput
            value={config.defaultPrompt || ''}
            onChangeText={text => patchConfig({ defaultPrompt: text })}
            placeholder="Persistent instructions Chat should prepend when assigning this terminal agent work..."
            placeholderTextColor="#3b3b5b"
            style={[inputStyle, { minHeight: 84, textAlignVertical: 'top' }]}
            multiline
          />
        </View>

        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' as any }}>
          {(['safe', 'auto', 'full-auto'] as TerminalLaunchMode[]).map(mode => {
            const active = (config.launchMode || 'safe') === mode;
            return (
              <Pressable
                key={mode}
                onPress={() => patchConfig({ launchMode: mode })}
                style={[
                  { borderRadius: 2, borderWidth: 1, borderColor: active ? '#38bdf8' : '#1a1a28', backgroundColor: active ? '#38bdf8' : '#080812', paddingHorizontal: 10, paddingVertical: 7 },
                  Platform.OS === 'web' && { cursor: 'pointer' } as any,
                ]}
              >
                <Text style={{ color: active ? '#050508' : '#9ca3af', fontSize: 12, fontWeight: '800', fontFamily: MONO }}>{modeLabel(mode)}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' as any }}>
          <Pressable
            onPress={saveProfile}
            disabled={saving || !exactIdentityAuthority}
            style={[{ backgroundColor: '#22c55e', borderRadius: 2, paddingHorizontal: 12, paddingVertical: 8, opacity: saving || !exactIdentityAuthority ? 0.55 : 1 }, Platform.OS === 'web' && { cursor: exactIdentityAuthority ? 'pointer' : 'not-allowed' } as any]}
          >
            <Text style={{ color: '#050508', fontSize: 12, fontWeight: '900', fontFamily: MONO }}>{saving ? 'SAVING...' : 'SAVE PROFILE'}</Text>
          </Pressable>
          <Pressable
            onPress={launchFromProfile}
            disabled={launching || !provider || !exactIdentityAuthority}
            style={[{ backgroundColor: provider ? '#38bdf8' : '#252536', borderRadius: 2, paddingHorizontal: 12, paddingVertical: 8, opacity: launching ? 0.55 : 1 }, Platform.OS === 'web' && { cursor: provider ? 'pointer' : 'not-allowed' } as any]}
          >
            <Text style={{ color: '#050508', fontSize: 12, fontWeight: '900', fontFamily: MONO }}>{launching ? 'LAUNCHING...' : 'LAUNCH FROM PROFILE'}</Text>
          </Pressable>
        </View>

        {!!result && (
          <Text style={{ color: result.toLowerCase().includes('failed') ? '#ef4444' : '#22c55e', fontSize: 12, fontFamily: MONO }}>
            {result}
          </Text>
        )}
      </View>
    </View>
  );
}

export function AgentQuickTerminal({
  agentName,
  agentId,
  circleId,
  providerType,
  sessionKey,
  identityAuthority,
}: {
  agentName: string;
  agentId: string;
  circleId: string;
  providerType?: string;
  sessionKey?: string;
  identityAuthority?: AgentIdentityExactAuthority | null;
}) {
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<{ role: 'user' | 'agent' | 'error'; text: string }[]>([]);
  const [sending, setSending] = useState(false);
  const [outputHeight, setOutputHeight] = useState(300);
  const scrollRef = useRef<ScrollView>(null);
  const dragStartY = useRef(0);
  const dragStartH = useRef(0);
  const terminalProvider = normalizeTerminalProvider(providerType);
  const isManagedTerminal = Boolean(terminalProvider && sessionKey);
  const exactIdentityAuthority = useMemo(
    () => normalizeTerminalIdentityAuthority(circleId, identityAuthority),
    [circleId, identityAuthority?.accessToken, identityAuthority?.circleId, identityAuthority?.userId],
  );
  const terminalRequestKey = exactIdentityAuthority
    ? `${exactIdentityAuthority.userId}\u0000${exactIdentityAuthority.circleId}\u0000${agentId}\u0000${agentName}\u0000${providerType || ''}\u0000${sessionKey || ''}`
    : '';
  const latestTerminalRequestKeyRef = useRef(terminalRequestKey);
  const latestTerminalAccessTokenRef = useRef(exactIdentityAuthority?.accessToken || '');
  latestTerminalRequestKeyRef.current = terminalRequestKey;
  latestTerminalAccessTokenRef.current = exactIdentityAuthority?.accessToken || '';

  useEffect(() => {
    setInput('');
    setHistory([]);
    setSending(false);
  }, [exactIdentityAuthority?.accessToken, terminalRequestKey]);

  const isTerminalRequestCurrent = (
    capturedRequestKey: string,
    capturedAccessToken: string,
  ): boolean => (
    !!capturedRequestKey
    && latestTerminalRequestKeyRef.current === capturedRequestKey
    && latestTerminalAccessTokenRef.current === capturedAccessToken
  );

  const handleSend = async () => {
    const capturedAuthority = exactIdentityAuthority;
    const capturedRequestKey = terminalRequestKey;
    if (!input.trim() || sending || !capturedAuthority || !capturedRequestKey) return;
    const message = input.trim();
    setInput('');
    setHistory(prev => [...prev, { role: 'user', text: message }]);
    setSending(true);
    setTimeout(() => {
      if (isTerminalRequestCurrent(capturedRequestKey, capturedAuthority.accessToken)) {
        scrollRef.current?.scrollToEnd({ animated: true });
      }
    }, 50);
    try {
      if (isManagedTerminal && terminalProvider && sessionKey) {
        const result = await sendTerminalAgentSessionMessage(terminalProvider, sessionKey, message);
        if (!result.ok) throw new Error(result.error || 'Terminal send failed');
        if (!isTerminalRequestCurrent(capturedRequestKey, capturedAuthority.accessToken)) return;
        setHistory(prev => [...prev, { role: 'agent', text: result.response || 'Message sent to managed terminal session.' }]);
      } else {
        const { getSwanBotResponse } = await import('../../../../lib/swanbot');
        if (!isTerminalRequestCurrent(capturedRequestKey, capturedAuthority.accessToken)) return;
        const response = await getSwanBotResponse(`@${agentName}: ${message}`, {
          userId: capturedAuthority.userId,
          circleId: capturedAuthority.circleId || circleId,
          agentId,
          agentName,
        });
        if (!isTerminalRequestCurrent(capturedRequestKey, capturedAuthority.accessToken)) return;
        setHistory(prev => [...prev, { role: 'agent', text: response }]);
      }
    } catch (e: any) {
      if (!isTerminalRequestCurrent(capturedRequestKey, capturedAuthority.accessToken)) return;
      setHistory(prev => [...prev, { role: 'error', text: e.message || 'Failed' }]);
    }
    if (!isTerminalRequestCurrent(capturedRequestKey, capturedAuthority.accessToken)) return;
    setSending(false);
    setTimeout(() => {
      if (isTerminalRequestCurrent(capturedRequestKey, capturedAuthority.accessToken)) {
        scrollRef.current?.scrollToEnd({ animated: true });
      }
    }, 50);
  };

  const handleResizeStart = (e: any) => {
    if (Platform.OS !== 'web') return;
    dragStartY.current = e.nativeEvent?.pageY || 0;
    dragStartH.current = outputHeight;
    const onMove = (ev: MouseEvent) => setOutputHeight(Math.max(150, Math.min(600, dragStartH.current + (ev.pageY - dragStartY.current))));
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <View style={{ flex: 1, paddingHorizontal: 8 }} nativeID="section-agent-quick-terminal">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: sending ? '#f59e0b' : '#22c55e' }} />
        <Text style={{ color: '#909098', fontSize: 12, fontWeight: '700', letterSpacing: 1, fontFamily: MONO }}>{agentName.toUpperCase()} {isManagedTerminal ? 'MANAGED TERMINAL' : 'TERMINAL'}</Text>
        <Text style={{ color: '#808090', fontSize: 12, marginLeft: 'auto' as any }}>{history.length} msg</Text>
      </View>
      <ScrollView ref={scrollRef} style={{ height: outputHeight, backgroundColor: '#05050a', borderWidth: 1, borderColor: '#1a1a2e', borderRadius: 2, padding: 12 }} nestedScrollEnabled showsVerticalScrollIndicator>
        {history.length === 0 && <Text style={{ color: '#808090', fontSize: 14, fontFamily: MONO, fontStyle: 'italic' }}>{isManagedTerminal ? `Send a follow-up directly into ${agentName}'s Terminal tab...` : `Type a command to talk to ${agentName}...`}</Text>}
        {history.map((entry, index) => (
          <View key={index} style={{ marginBottom: 10 }}>
            <Text style={{ color: entry.role === 'user' ? '#8b5cf6' : entry.role === 'error' ? '#ef4444' : '#22c55e', fontSize: 12, fontWeight: '700', fontFamily: MONO, marginBottom: 2 }}>
              {entry.role === 'user' ? '> YOU' : entry.role === 'error' ? '! ERROR' : `< ${agentName.toUpperCase()}`}
            </Text>
            <Text style={{ color: entry.role === 'error' ? '#ef4444' : '#c9d1e8', fontSize: 14, fontFamily: MONO, lineHeight: 16 }} selectable>{entry.text}</Text>
          </View>
        ))}
        {sending && <Text style={{ color: '#f59e0b', fontSize: 14, fontFamily: MONO }}>thinking...</Text>}
      </ScrollView>
      {Platform.OS === 'web' && (
        <View onPointerDown={handleResizeStart as any} style={{ height: 6, backgroundColor: '#1a1a2e', borderRadius: 3, marginVertical: 2, alignItems: 'center' as any, justifyContent: 'center' as any, ...(Platform.OS === 'web' ? { cursor: 'ns-resize' } as any : {}) }}>
          <View style={{ width: 30, height: 2, backgroundColor: '#2a2a3e', borderRadius: 1 }} />
        </View>
      )}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end' as any, backgroundColor: '#08081a', borderRadius: 2, borderWidth: 1, borderColor: '#1e1e3a', paddingHorizontal: 8, paddingVertical: 6, gap: 6 }}>
        <Text style={{ color: '#8b5cf6', fontSize: 16, fontWeight: '800', fontFamily: MONO, paddingBottom: 4 }}>{'>'}</Text>
        <TextInput
          style={{ flex: 1, color: '#e8e8f8', fontSize: 12, fontFamily: MONO, minHeight: 36, maxHeight: 100, paddingVertical: 6, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) } as any}
          value={input}
          onChangeText={setInput}
          editable={!!exactIdentityAuthority}
          placeholder={exactIdentityAuthority ? `Command ${agentName}...` : 'Sign in to this circle to message this agent'}
          placeholderTextColor="#3b3b5b"
          onSubmitEditing={handleSend}
          returnKeyType="send"
          autoCapitalize="none"
          multiline
        />
        <Pressable onPress={handleSend} disabled={sending || !input.trim() || !exactIdentityAuthority} accessibilityRole="button" style={{ backgroundColor: '#8b5cf6', borderRadius: 2, paddingHorizontal: 10, paddingVertical: 6, opacity: sending || !input.trim() || !exactIdentityAuthority ? 0.4 : 1 }}>
          <Text style={{ color: '#fff', fontSize: 14, fontWeight: '800', fontFamily: MONO }}>{sending ? '..' : '>>'}</Text>
        </Pressable>
      </View>
    </View>
  );
}
