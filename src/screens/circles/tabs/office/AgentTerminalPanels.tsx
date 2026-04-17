import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { supabase } from '../../../../lib/supabase';
import { MONO } from './AgentPanelShared';

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

export function AgentQuickTerminal({ agentName, agentId, circleId }: { agentName: string; agentId: string; circleId: string }) {
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<{ role: 'user' | 'agent' | 'error'; text: string }[]>([]);
  const [sending, setSending] = useState(false);
  const [outputHeight, setOutputHeight] = useState(300);
  const scrollRef = useRef<ScrollView>(null);
  const dragStartY = useRef(0);
  const dragStartH = useRef(0);

  const handleSend = async () => {
    if (!input.trim() || sending) return;
    const message = input.trim();
    setInput('');
    setHistory(prev => [...prev, { role: 'user', text: message }]);
    setSending(true);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    try {
      const { getSwanBotResponse } = await import('../../../../lib/swanbot');
      const response = await getSwanBotResponse(`@${agentName}: ${message}`, {
        userId: (await supabase.auth.getUser()).data.user?.id || '',
        circleId,
        agentId,
        agentName,
      });
      setHistory(prev => [...prev, { role: 'agent', text: response }]);
    } catch (e: any) {
      setHistory(prev => [...prev, { role: 'error', text: e.message || 'Failed' }]);
    }
    setSending(false);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
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
        <Text style={{ color: '#909098', fontSize: 12, fontWeight: '700', letterSpacing: 1, fontFamily: MONO }}>{agentName.toUpperCase()} TERMINAL</Text>
        <Text style={{ color: '#808090', fontSize: 12, marginLeft: 'auto' as any }}>{history.length} msg</Text>
      </View>
      <ScrollView ref={scrollRef} style={{ height: outputHeight, backgroundColor: '#05050a', borderWidth: 1, borderColor: '#1a1a2e', borderRadius: 2, padding: 12 }} nestedScrollEnabled showsVerticalScrollIndicator>
        {history.length === 0 && <Text style={{ color: '#808090', fontSize: 14, fontFamily: MONO, fontStyle: 'italic' }}>Type a command to talk to {agentName}...</Text>}
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
          placeholder={`Command ${agentName}...`}
          placeholderTextColor="#3b3b5b"
          onSubmitEditing={handleSend}
          returnKeyType="send"
          autoCapitalize="none"
          multiline
        />
        <Pressable onPress={handleSend} disabled={sending || !input.trim()} accessibilityRole="button" style={{ backgroundColor: '#8b5cf6', borderRadius: 2, paddingHorizontal: 10, paddingVertical: 6, opacity: sending || !input.trim() ? 0.4 : 1 }}>
          <Text style={{ color: '#fff', fontSize: 14, fontWeight: '800', fontFamily: MONO }}>{sending ? '..' : '>>'}</Text>
        </Pressable>
      </View>
    </View>
  );
}
