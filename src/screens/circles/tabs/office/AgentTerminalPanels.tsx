import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { MONO } from './AgentPanelShared';
import { OfficeAgent } from '../../../../lib/officeAgents';
import {
  getAgentIdentityKey,
  refreshAgentIdentitiesFromServerExact,
  updateAgentIdentityExact,
  type TerminalAgentOfficeConfig,
  type TerminalLaunchMode,
} from '../../../../lib/agentIdentity';
import type {
  OfficeConnectionAuthorityFence,
  OfficeConnectionExactAuthority,
} from '../../../../lib/connectionManager';

const QUICK_COMMANDS = [
  { label: 'pwd', cmd: 'pwd', icon: '>' },
  { label: 'git status', cmd: 'git status', icon: '~' },
  { label: 'git log', cmd: 'git log --oneline -5', icon: '#' },
  { label: 'ls', cmd: 'ls -la', icon: '[]' },
  { label: 'disk', cmd: 'df -h /', icon: 'D' },
  { label: 'uptime', cmd: 'uptime', icon: 'U' },
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

type TerminalProfileLoadState =
  | 'locked'
  | 'loading'
  | 'ready'
  | 'refresh-needed'
  | 'outcome-unknown'
  | 'error';

type ActiveOutputResize = {
  onMove: (event: MouseEvent) => void;
  onUp: () => void;
};

function defaultTerminalConfig(agent: OfficeAgent): TerminalAgentOfficeConfig {
  return {
    defaultCwd: agent.projectDir || '',
    defaultModel: agent.model && agent.model !== 'unknown' ? agent.model : '',
    defaultPrompt: '',
    launchMode: 'safe',
    autoSaveMemory: true,
  };
}

function normalizeTerminalIdentityAuthority(
  circleId: string | undefined,
  authority: OfficeConnectionExactAuthority | null | undefined,
): OfficeConnectionExactAuthority | null {
  const userId = authority?.userId?.trim();
  const authorityCircleId = authority?.circleId?.trim();
  const accessToken = authority?.accessToken?.trim();
  const generation = Number(authority?.generation);
  if (
    !circleId
    || !userId
    || authorityCircleId !== circleId
    || !accessToken
    || !Number.isSafeInteger(generation)
    || generation <= 0
  ) return null;
  return { userId, circleId: authorityCircleId, accessToken, generation };
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
  const activeOutputResizeRef = useRef<ActiveOutputResize | null>(null);

  const stopOutputResize = useCallback(() => {
    const activeResize = activeOutputResizeRef.current;
    if (!activeResize) return;
    activeOutputResizeRef.current = null;
    if (typeof window === 'undefined') return;
    window.removeEventListener('mousemove', activeResize.onMove);
    window.removeEventListener('mouseup', activeResize.onUp);
    window.removeEventListener('blur', activeResize.onUp);
  }, []);

  useEffect(() => () => {
    stopOutputResize();
  }, [stopOutputResize]);

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
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    try {
      // Race the command against a timeout so hangs don't leave the UI spinning.
      const result = await Promise.race([
        onRunCommand(trimmed),
        new Promise<null>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error('__timeout__')), COMMAND_TIMEOUT_MS);
        }),
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
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
    setCmdRunning(false);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 50);
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

  const handleResizeStart = useCallback((e: any) => {
    if (Platform.OS !== 'web') return;
    stopOutputResize();
    dragStartY.current = e.nativeEvent?.pageY || 0;
    dragStartH.current = outputHeight;
    const onMove = (ev: MouseEvent) => setOutputHeight(Math.max(150, Math.min(600, dragStartH.current + (ev.pageY - dragStartY.current))));
    const onUp = () => stopOutputResize();
    activeOutputResizeRef.current = { onMove, onUp };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('blur', onUp);
  }, [outputHeight, stopOutputResize]);

  return (
    <View style={{ marginBottom: 8 }} nativeID="section-agent-remote-shell">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 }}>
        <View style={{ width: 18, height: 18, borderRadius: 6, backgroundColor: '#22c55e15', borderWidth: 1, borderColor: '#22c55e30', justifyContent: 'center', alignItems: 'center' }}>
          <Text style={{ color: '#22c55e', fontSize: 12, fontWeight: '800', fontFamily: MONO }}>$</Text>
        </View>
        <Text style={{ color: '#909098', fontSize: 12, fontWeight: '700', letterSpacing: 1, fontFamily: MONO }}>REMOTE SHELL</Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10, maxHeight: 32 }} contentContainerStyle={{ gap: 4 }}>
        {QUICK_COMMANDS.map(command => (
          <Pressable
            key={command.cmd}
            onPress={() => { setCmdInput(command.cmd); runCmd(command.cmd); }}
            disabled={cmdRunning}
            accessibilityRole="button"
            accessibilityLabel={`Run read-only diagnostic: ${command.label}`}
            accessibilityState={{ disabled: cmdRunning, busy: cmdRunning }}
            style={[
              { minHeight: 44, backgroundColor: '#0a0a10', borderRadius: 6, borderWidth: 1, borderColor: '#1a1a28', paddingHorizontal: 8, paddingVertical: 6, justifyContent: 'center', opacity: cmdRunning ? 0.5 : 1 },
              Platform.OS === 'web' && { cursor: cmdRunning ? 'default' : 'pointer' } as any,
            ]}
          >
            <Text style={{ color: '#808090', fontSize: 13, fontFamily: MONO }}>
              <Text style={{ color: '#22c55e', fontWeight: '700' }}>{command.icon}</Text> {command.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#05050a', borderRadius: 6, borderWidth: 1, borderColor: '#1a1a28', paddingHorizontal: 8, gap: 6, marginBottom: 8 }}>
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
          accessibilityLabel="Read-only Claude bridge diagnostic command"
        />
        <Pressable
          style={[{ minHeight: 44, backgroundColor: '#22c55e', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 5, justifyContent: 'center', opacity: cmdRunning || !cmdInput.trim() ? 0.55 : 1 }, Platform.OS === 'web' && { cursor: cmdRunning || !cmdInput.trim() ? 'default' : 'pointer' } as any]}
          onPress={() => cmdInput.trim() && runCmd(cmdInput.trim())}
          disabled={cmdRunning || !cmdInput.trim()}
          accessibilityRole="button"
          accessibilityLabel="Run read-only Claude bridge diagnostic"
          accessibilityState={{ disabled: cmdRunning || !cmdInput.trim(), busy: cmdRunning }}
        >
          <Text style={{ color: '#050508', fontSize: 13, fontWeight: '800', fontFamily: MONO }}>{cmdRunning ? '..' : 'RUN'}</Text>
        </Pressable>
      </View>

      <ScrollView ref={scrollRef} style={{ height: outputHeight, backgroundColor: '#05050a', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 6, padding: 12 }} nestedScrollEnabled showsVerticalScrollIndicator>
        {!cmdOutput && !cmdRunning && <Text style={{ color: '#808090', fontSize: 14, fontFamily: MONO, fontStyle: 'italic' }}>Run a command to see output...</Text>}
        {cmdRunning && (
          <ActivityIndicator
            accessibilityRole="progressbar"
            accessibilityLabel="Running read-only diagnostic"
            accessibilityLiveRegion="polite"
            size="small"
            color="#22c55e"
            style={{ marginBottom: 8 }}
          />
        )}
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
        <View onPointerDown={handleResizeStart as any} style={{ height: 6, backgroundColor: '#1a1a28', borderRadius: 6, marginVertical: 2, alignItems: 'center' as any, justifyContent: 'center' as any, ...(Platform.OS === 'web' ? { cursor: 'ns-resize' } as any : {}) }}>
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
  isIdentityAuthorityCurrent,
  onIdentityChange,
  onOpenInChat,
}: {
  agent: OfficeAgent;
  circleId?: string;
  identityAuthority?: OfficeConnectionExactAuthority | null;
  isIdentityAuthorityCurrent: OfficeConnectionAuthorityFence;
  onIdentityChange?: () => void;
  onOpenInChat?: (draft?: string) => void;
}) {
  const identityKey = getAgentIdentityKey(agent);
  const provider = normalizeTerminalProvider(agent.providerType);
  const exactIdentityAuthority = useMemo(
    () => normalizeTerminalIdentityAuthority(circleId, identityAuthority),
    [circleId, identityAuthority?.accessToken, identityAuthority?.circleId, identityAuthority?.generation, identityAuthority?.userId],
  );
  const identityRequestKey = exactIdentityAuthority
    ? `${exactIdentityAuthority.userId}\u0000${exactIdentityAuthority.circleId}\u0000${exactIdentityAuthority.generation}\u0000${agent.id}\u0000${identityKey}`
    : '';
  const latestIdentityRequestKeyRef = useRef(identityRequestKey);
  const latestIdentityAccessTokenRef = useRef(exactIdentityAuthority?.accessToken || '');
  latestIdentityRequestKeyRef.current = identityRequestKey;
  latestIdentityAccessTokenRef.current = exactIdentityAuthority?.accessToken || '';
  const [config, setConfig] = useState<TerminalAgentOfficeConfig>(() => defaultTerminalConfig(agent));
  const [profileLoadState, setProfileLoadState] = useState<TerminalProfileLoadState>('loading');
  const [profileReloadGeneration, setProfileReloadGeneration] = useState(0);
  const [saving, setSaving] = useState(false);
  const [continuingInChat, setContinuingInChat] = useState(false);
  const [result, setResult] = useState<string>('');

  useEffect(() => {
    setConfig(defaultTerminalConfig(agent));
    setResult('');
    setSaving(false);
    setContinuingInChat(false);
    if (
      !identityKey
      || !exactIdentityAuthority
      || !identityRequestKey
      || !isIdentityAuthorityCurrent(exactIdentityAuthority)
    ) {
      setProfileLoadState('locked');
      return;
    }
    let cancelled = false;
    const capturedRequestKey = identityRequestKey;
    const capturedAuthority = exactIdentityAuthority;
    setProfileLoadState('loading');
    refreshAgentIdentitiesFromServerExact(
      exactIdentityAuthority,
      isIdentityAuthorityCurrent,
    )
      .then(serverResult => {
        if (
          cancelled
          || !isIdentityAuthorityCurrent(capturedAuthority)
          || latestIdentityRequestKeyRef.current !== capturedRequestKey
          || latestIdentityAccessTokenRef.current !== capturedAuthority.accessToken
        ) return;
        if (!serverResult.serverVerified) {
          setProfileLoadState('error');
          return;
        }
        const identity = serverResult.identities.get(identityKey);
        setConfig({
          defaultCwd: identity?.terminalConfig?.defaultCwd ?? agent.projectDir ?? '',
          defaultModel: identity?.terminalConfig?.defaultModel ?? identity?.boundModel ?? (agent.model && agent.model !== 'unknown' ? agent.model : ''),
          defaultPrompt: identity?.terminalConfig?.defaultPrompt ?? '',
          launchMode: identity?.terminalConfig?.launchMode ?? 'safe',
          autoSaveMemory: identity?.terminalConfig?.autoSaveMemory ?? true,
        });
        setProfileLoadState('ready');
      })
      .catch((error: unknown) => {
        console.warn('[AgentTerminalProfilePanel] Failed to load exact terminal profile:', error);
        if (
          cancelled
          || !isIdentityAuthorityCurrent(capturedAuthority)
          || latestIdentityRequestKeyRef.current !== capturedRequestKey
          || latestIdentityAccessTokenRef.current !== capturedAuthority.accessToken
        ) return;
        setProfileLoadState('error');
      });
    return () => { cancelled = true; };
  }, [
    agent.id,
    agent.model,
    agent.name,
    agent.projectDir,
    exactIdentityAuthority,
    identityKey,
    identityRequestKey,
    isIdentityAuthorityCurrent,
    profileReloadGeneration,
  ]);

  useEffect(() => () => {
    latestIdentityRequestKeyRef.current = '';
    latestIdentityAccessTokenRef.current = '';
  }, []);

  const patchConfig = (patch: Partial<TerminalAgentOfficeConfig>) => {
    setConfig(prev => ({ ...prev, ...patch }));
  };

  const saveProfile = async (): Promise<boolean> => {
    const capturedAuthority = exactIdentityAuthority;
    const capturedRequestKey = identityRequestKey;
    if (
      !identityKey
      || !capturedAuthority
      || !capturedRequestKey
    ) {
      setResult('Sign in to this circle before saving an Office terminal profile.');
      return false;
    }
    if (profileLoadState !== 'ready') {
      setResult('Load and verify this exact terminal profile before saving changes.');
      return false;
    }
    setSaving(true);
    setResult('');
    try {
      if (
        !isIdentityAuthorityCurrent(capturedAuthority)
        ||
        latestIdentityRequestKeyRef.current !== capturedRequestKey
        || latestIdentityAccessTokenRef.current !== capturedAuthority.accessToken
      ) return false;
      const receipt = await updateAgentIdentityExact(identityKey, {
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
      }, capturedAuthority, isIdentityAuthorityCurrent);
      if (
        !isIdentityAuthorityCurrent(capturedAuthority)
        ||
        latestIdentityRequestKeyRef.current !== capturedRequestKey
        || latestIdentityAccessTokenRef.current !== capturedAuthority.accessToken
      ) return false;
      if (receipt.error === 'outcome_unknown' || receipt.serverSaved === null) {
        setProfileLoadState('outcome-unknown');
        return false;
      }
      if (receipt.serverSaved === true && !receipt.localSaved) {
        setProfileLoadState('refresh-needed');
        return false;
      }
      if (!receipt.ok || !receipt.localSaved || receipt.serverSaved !== true) {
        setResult('Save failed. Reload the exact terminal profile, then retry.');
        return false;
      }
      onIdentityChange?.();
      setResult('Saved terminal profile. Chat assignments will use this profile.');
      return true;
    } catch (error: unknown) {
      console.warn('[AgentTerminalProfilePanel] Failed to save exact terminal profile:', error);
      if (
        isIdentityAuthorityCurrent(capturedAuthority)
        &&
        latestIdentityRequestKeyRef.current === capturedRequestKey
        && latestIdentityAccessTokenRef.current === capturedAuthority.accessToken
      ) {
        setResult('Save failed. Reload the exact terminal profile, then retry.');
      }
      return false;
    } finally {
      if (
        isIdentityAuthorityCurrent(capturedAuthority)
        &&
        latestIdentityRequestKeyRef.current === capturedRequestKey
        && latestIdentityAccessTokenRef.current === capturedAuthority.accessToken
      ) setSaving(false);
    }
  };

  const continueLaunchInChat = async () => {
    const capturedAuthority = exactIdentityAuthority;
    const capturedRequestKey = identityRequestKey;
    if (profileLoadState !== 'ready' || !capturedAuthority || !capturedRequestKey || !onOpenInChat) {
      setResult('Load and verify this exact terminal profile before continuing through Chat.');
      return;
    }
    if (!provider) {
      setResult('This agent does not support managed terminal launches yet.');
      return;
    }
    setContinuingInChat(true);
    setResult('');
    try {
      if (
        !await saveProfile()
        || !isIdentityAuthorityCurrent(capturedAuthority)
        || latestIdentityRequestKeyRef.current !== capturedRequestKey
        || latestIdentityAccessTokenRef.current !== capturedAuthority.accessToken
      ) return;
      const prompt = config.defaultPrompt?.trim()
        || `Stand by as ${agent.name}. Wait for delegated tasks from The Underground Circle.`;
      onOpenInChat([
        `Launch one managed ${provider === 'gemini' ? 'Gemini CLI' : provider} session for this exact agent using its saved Office terminal profile.`,
        `Launch posture: ${modeLabel(config.launchMode || 'safe')}.`,
        config.defaultModel?.trim() ? `Model: ${config.defaultModel.trim()}.` : '',
        config.defaultCwd?.trim() ? `Working directory: ${config.defaultCwd.trim()}.` : '',
        `Instructions:\n${prompt}`,
        '',
        'Show the approval posture and accepted run/session receipt in Chat; do not claim launch completion without runtime evidence.',
      ].filter(Boolean).join('\n'));
      setResult('Profile saved. Review and submit the launch request in Chat.');
    } catch (error: unknown) {
      console.warn('[AgentTerminalProfilePanel] Failed to prepare Chat launch handoff:', error);
      if (
        isIdentityAuthorityCurrent(capturedAuthority)
        &&
        latestIdentityRequestKeyRef.current === capturedRequestKey
        && latestIdentityAccessTokenRef.current === capturedAuthority.accessToken
      ) {
        setResult('Chat handoff failed. Reload the exact terminal profile, then retry.');
      }
    } finally {
      if (
        isIdentityAuthorityCurrent(capturedAuthority)
        &&
        latestIdentityRequestKeyRef.current === capturedRequestKey
        && latestIdentityAccessTokenRef.current === capturedAuthority.accessToken
      ) setContinuingInChat(false);
    }
  };

  const inputStyle = {
    backgroundColor: '#05050a',
    borderWidth: 1,
    borderColor: '#1a1a28',
    borderRadius: 6,
    color: '#e8e8f8',
    fontSize: 12,
    fontFamily: MONO,
    paddingHorizontal: 10,
    paddingVertical: 8,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  } as any;

  return (
    <View style={{ marginBottom: 12 }} nativeID="section-agent-terminal-profile">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 }}>
        <View style={{ width: 18, height: 18, borderRadius: 6, backgroundColor: '#38bdf815', borderWidth: 1, borderColor: '#38bdf830', justifyContent: 'center', alignItems: 'center' }}>
          <Text style={{ color: '#38bdf8', fontSize: 11, fontWeight: '800', fontFamily: MONO }}>#</Text>
        </View>
        <Text style={{ color: '#909098', fontSize: 12, fontWeight: '700', letterSpacing: 1, fontFamily: MONO }}>OFFICE TERMINAL PROFILE</Text>
        <Text style={{ color: provider ? '#22c55e' : '#f59e0b', fontSize: 11, marginLeft: 'auto' as any, fontFamily: MONO }}>
          {provider ? 'MANAGED' : 'OBSERVE'}
        </Text>
      </View>

      <View style={{ gap: 8 }}>
        <Text style={{ color: '#707086', fontSize: 12, fontFamily: MONO }}>
          Saved here, then used by Chat-owned assignments and managed terminal follow-ups.
        </Text>

        {profileLoadState === 'loading' ? (
          <View accessibilityLiveRegion="polite" style={{ minHeight: 120, alignItems: 'center', justifyContent: 'center', gap: 10 }}>
            <ActivityIndicator
              accessibilityRole="progressbar"
              accessibilityLabel="Loading verified terminal profile"
              size="small"
              color="#38bdf8"
            />
            <Text style={{ color: '#808090', fontSize: 11, fontFamily: MONO }}>Loading verified terminal profile…</Text>
          </View>
        ) : profileLoadState === 'locked' ? (
          <View accessibilityRole="alert" style={{ padding: 10, gap: 6, borderWidth: 1, borderColor: '#f59e0b45', backgroundColor: '#2a1a0618', borderRadius: 6 }}>
            <Text style={{ color: '#fbbf24', fontSize: 11, lineHeight: 17, fontFamily: MONO }}>
              Terminal profile settings are locked until this Office session has exact identity authority.
            </Text>
          </View>
        ) : profileLoadState === 'refresh-needed' ? (
          <View accessibilityRole="alert" accessibilityLiveRegion="assertive" style={{ padding: 10, gap: 8, borderWidth: 1, borderColor: '#f59e0b55', backgroundColor: '#2a1a06', borderRadius: 6 }}>
            <Text style={{ color: '#fbbf24', fontSize: 11, lineHeight: 17, fontFamily: MONO }}>
              The terminal profile was saved on the server, but this view could not refresh. Reload the profile; do not save it again.
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Reload terminal profile after server save"
              onPress={() => setProfileReloadGeneration(value => value + 1)}
              style={[{ alignSelf: 'flex-start', minHeight: 44, paddingHorizontal: 12, borderWidth: 1, borderColor: '#f59e0b66', borderRadius: 6, justifyContent: 'center' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
            >
              <Text style={{ color: '#fbbf24', fontSize: 11, fontWeight: '800', fontFamily: MONO }}>RELOAD PROFILE</Text>
            </Pressable>
          </View>
        ) : profileLoadState === 'outcome-unknown' ? (
          <View accessibilityRole="alert" accessibilityLiveRegion="assertive" style={{ padding: 10, gap: 8, borderWidth: 1, borderColor: '#f59e0b55', backgroundColor: '#2a1a06', borderRadius: 6 }}>
            <Text style={{ color: '#fbbf24', fontSize: 11, lineHeight: 17, fontFamily: MONO }}>
              The terminal-profile outcome could not be verified. Reload the profile before retrying or continuing to Chat.
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Reload terminal profile after unknown outcome"
              onPress={() => setProfileReloadGeneration(value => value + 1)}
              style={[{ alignSelf: 'flex-start', minHeight: 44, paddingHorizontal: 12, borderWidth: 1, borderColor: '#f59e0b66', borderRadius: 6, justifyContent: 'center' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
            >
              <Text style={{ color: '#fbbf24', fontSize: 11, fontWeight: '800', fontFamily: MONO }}>RELOAD PROFILE</Text>
            </Pressable>
          </View>
        ) : profileLoadState === 'error' ? (
          <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ padding: 10, gap: 8, borderWidth: 1, borderColor: '#ef444455', backgroundColor: '#2a0b0b', borderRadius: 6 }}>
            <Text style={{ color: '#fca5a5', fontSize: 11, lineHeight: 17, fontFamily: MONO }}>
              The terminal profile could not be verified. Saved settings are hidden and editing remains disabled.
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry loading exact terminal profile"
              onPress={() => setProfileReloadGeneration(value => value + 1)}
              style={[{ alignSelf: 'flex-start', minHeight: 44, paddingHorizontal: 12, borderWidth: 1, borderColor: '#ef444466', borderRadius: 6, justifyContent: 'center' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
            >
              <Text style={{ color: '#fca5a5', fontSize: 11, fontWeight: '800', fontFamily: MONO }}>RETRY</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' as any }}>
          <View style={{ flex: 1, minWidth: 180, minHeight: 44, justifyContent: 'center' }}>
            <Text style={{ color: '#808090', fontSize: 11, fontWeight: '800', marginBottom: 4, fontFamily: MONO }}>AGENT IDENTITY</Text>
            <Text style={{ color: '#c9d1e8', fontSize: 12, fontFamily: MONO }}>{agent.name}</Text>
            <Text style={{ color: '#606075', fontSize: 10, lineHeight: 15, fontFamily: MONO }}>Rename this agent once from Overview.</Text>
          </View>
          <View style={{ flex: 1, minWidth: 180 }}>
            <Text style={{ color: '#808090', fontSize: 11, fontWeight: '800', marginBottom: 4, fontFamily: MONO }}>MODEL</Text>
            <TextInput accessibilityLabel="Terminal profile model" value={config.defaultModel || ''} onChangeText={text => patchConfig({ defaultModel: text })} placeholder="default / provider model" placeholderTextColor="#3b3b5b" style={inputStyle} autoCapitalize="none" />
          </View>
        </View>

        <View>
          <Text style={{ color: '#808090', fontSize: 11, fontWeight: '800', marginBottom: 4, fontFamily: MONO }}>WORKING DIRECTORY</Text>
          <TextInput accessibilityLabel="Terminal profile working directory" value={config.defaultCwd || ''} onChangeText={text => patchConfig({ defaultCwd: text })} placeholder="/Users/cswanson/the-underground-circle" placeholderTextColor="#3b3b5b" style={inputStyle} autoCapitalize="none" />
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
            accessibilityLabel="Terminal profile default instructions"
          />
        </View>

        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' as any }}>
          {(['safe', 'auto', 'full-auto'] as TerminalLaunchMode[]).map(mode => {
            const active = (config.launchMode || 'safe') === mode;
            return (
              <Pressable
                key={mode}
                onPress={() => patchConfig({ launchMode: mode })}
                accessibilityRole="button"
                accessibilityLabel={`Use ${modeLabel(mode)} terminal launch mode`}
                accessibilityState={{ selected: active }}
                style={[
                  { minHeight: 44, borderRadius: 6, borderWidth: 1, borderColor: active ? '#38bdf8' : '#1a1a28', backgroundColor: active ? '#38bdf8' : '#080812', paddingHorizontal: 10, paddingVertical: 7, justifyContent: 'center' },
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
            accessibilityRole="button"
            accessibilityLabel="Save terminal profile"
            accessibilityState={{ disabled: saving || !exactIdentityAuthority, busy: saving }}
            style={[{ minHeight: 44, backgroundColor: '#22c55e', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 8, justifyContent: 'center', opacity: saving || !exactIdentityAuthority ? 0.55 : 1 }, Platform.OS === 'web' && { cursor: exactIdentityAuthority ? 'pointer' : 'not-allowed' } as any]}
          >
            <Text style={{ color: '#050508', fontSize: 12, fontWeight: '700', fontFamily: MONO }}>{saving ? 'SAVING...' : 'SAVE PROFILE'}</Text>
          </Pressable>
          <Pressable
            onPress={continueLaunchInChat}
            disabled={continuingInChat || !provider || !exactIdentityAuthority || !onOpenInChat}
            accessibilityRole="button"
            accessibilityLabel={`Continue ${agent.name} terminal launch in Chat`}
            accessibilityState={{ disabled: continuingInChat || !provider || !exactIdentityAuthority || !onOpenInChat, busy: continuingInChat }}
            style={[{ minHeight: 44, backgroundColor: provider ? '#38bdf8' : '#252536', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 8, justifyContent: 'center', opacity: continuingInChat ? 0.55 : 1 }, Platform.OS === 'web' && { cursor: provider && onOpenInChat ? 'pointer' : 'not-allowed' } as any]}
          >
            <Text style={{ color: '#050508', fontSize: 12, fontWeight: '700', fontFamily: MONO }}>{continuingInChat ? 'OPENING CHAT...' : 'CONTINUE LAUNCH IN CHAT'}</Text>
          </Pressable>
        </View>

        {!!result && (
          <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ color: result.toLowerCase().includes('failed') ? '#ef4444' : '#22c55e', fontSize: 12, fontFamily: MONO }}>
            {result}
          </Text>
        )}
          </>
        )}
      </View>
    </View>
  );
}

export function AgentQuickTerminal({
  agentName,
  circleId,
  identityAuthority,
  isIdentityAuthorityCurrent,
  onOpenInChat,
}: {
  agentName: string;
  circleId: string;
  identityAuthority?: OfficeConnectionExactAuthority | null;
  isIdentityAuthorityCurrent: OfficeConnectionAuthorityFence;
  onOpenInChat?: (draft?: string) => void;
}) {
  const [input, setInput] = useState('');
  const exactIdentityAuthority = useMemo(
    () => normalizeTerminalIdentityAuthority(circleId, identityAuthority),
    [circleId, identityAuthority?.accessToken, identityAuthority?.circleId, identityAuthority?.generation, identityAuthority?.userId],
  );

  useEffect(() => {
    setInput('');
  }, [agentName, exactIdentityAuthority?.accessToken]);

  const openChat = () => {
    const message = input.trim();
    if (!message || !exactIdentityAuthority || !isIdentityAuthorityCurrent(exactIdentityAuthority) || !onOpenInChat) return;
    onOpenInChat(message);
  };

  return (
    <View style={{ paddingBottom: 12, gap: 8 }} nativeID="section-agent-quick-terminal">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 }}>
        <View style={{ width: 8, height: 8, borderRadius: 6, backgroundColor: '#8b5cf6' }} />
        <Text style={{ color: '#909098', fontSize: 12, fontWeight: '700', letterSpacing: 1, fontFamily: MONO }}>CONTINUE WITH {agentName.toUpperCase()} IN CHAT</Text>
      </View>
      <Text style={{ color: '#707086', fontSize: 11, lineHeight: 17, fontFamily: MONO }}>
        Chat owns the durable message, approvals, run, proof, and recovery trail. This carries your draft to the exact agent and never sends automatically.
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end' as any, backgroundColor: '#08081a', borderRadius: 6, borderWidth: 1, borderColor: '#1e1e3a', paddingHorizontal: 8, paddingVertical: 6, gap: 6 }}>
        <Text style={{ color: '#8b5cf6', fontSize: 16, fontWeight: '800', fontFamily: MONO, paddingBottom: 4 }}>{'>'}</Text>
        <TextInput
          style={{ flex: 1, color: '#e8e8f8', fontSize: 12, fontFamily: MONO, minHeight: 36, maxHeight: 100, paddingVertical: 6, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) } as any}
          value={input}
          onChangeText={setInput}
          editable={!!exactIdentityAuthority && !!onOpenInChat}
          placeholder={exactIdentityAuthority && onOpenInChat ? `Draft a task for ${agentName}...` : 'Reopen this agent from an authenticated Office session'}
          placeholderTextColor="#3b3b5b"
          onSubmitEditing={openChat}
          returnKeyType="send"
          autoCapitalize="none"
          multiline
          accessibilityLabel={`Draft a Chat task for ${agentName}`}
        />
        <Pressable
          onPress={openChat}
          disabled={!input.trim() || !exactIdentityAuthority || !onOpenInChat}
          accessibilityRole="button"
          accessibilityLabel={`Open Chat with ${agentName}`}
          accessibilityState={{ disabled: !input.trim() || !exactIdentityAuthority || !onOpenInChat }}
          style={{ minHeight: 44, backgroundColor: '#8b5cf6', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6, justifyContent: 'center', opacity: !input.trim() || !exactIdentityAuthority || !onOpenInChat ? 0.4 : 1 }}
        >
          <Text style={{ color: '#fff', fontSize: 12, fontWeight: '800', fontFamily: MONO }}>OPEN CHAT</Text>
        </Pressable>
      </View>
    </View>
  );
}
