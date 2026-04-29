/**
 * TerminalOutputCard — renders a /run result inline in chat.
 *
 * Shows the command, working directory hint, exit code, duration, and
 * truncated stdout/stderr with a "show more" toggle for large output.
 * Output is local-only — never persisted to Supabase. The card lives
 * on the local message timeline only.
 */
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View, Platform } from 'react-native';
import type { TerminalRunResult } from '../../../../lib/terminalChatCommands';

interface Props {
  result: TerminalRunResult;
  accentColor?: string;
}

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';
const PREVIEW_CHARS = 1200;

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function previewAndOverflow(text: string): { preview: string; overflow: number } {
  if (!text) return { preview: '', overflow: 0 };
  if (text.length <= PREVIEW_CHARS) return { preview: text, overflow: 0 };
  return { preview: text.slice(0, PREVIEW_CHARS), overflow: text.length - PREVIEW_CHARS };
}

export default function TerminalOutputCard({ result, accentColor = '#22d3ee' }: Props) {
  const [stdoutExpanded, setStdoutExpanded] = useState(false);
  const [stderrExpanded, setStderrExpanded] = useState(false);

  const stdoutPiece = useMemo(() => previewAndOverflow(result.stdout || ''), [result.stdout]);
  const stderrPiece = useMemo(() => previewAndOverflow(result.stderr || ''), [result.stderr]);

  const codeColor =
    result.error ? '#ef4444' :
    result.code === 0 ? '#22c55e' :
    result.code == null ? '#94a3b8' :
    '#f59e0b';

  const codeLabel =
    result.error ? `error: ${result.error}` :
    result.code == null ? '—' :
    `exit ${result.code}`;

  return (
    <View style={[s.card, { borderColor: accentColor + '30' }]} nativeID="section-terminal-output">
      {/* Header — command + status */}
      <View style={s.header}>
        <Text style={[s.prompt, { color: accentColor }]}>$</Text>
        <Text style={s.command} selectable numberOfLines={3}>{result.command}</Text>
      </View>

      {/* Meta row — cwd, exit, duration */}
      <View style={s.metaRow}>
        {result.cwd && (
          <Text style={s.meta} numberOfLines={1}>cwd: <Text style={s.metaValue}>{result.cwd}</Text></Text>
        )}
        <Text style={[s.meta, { color: codeColor }]}>{codeLabel}</Text>
        <Text style={s.meta}>{formatDuration(result.durationMs)}</Text>
      </View>

      {/* stdout */}
      {stdoutPiece.preview ? (
        <View style={s.streamBlock}>
          <Text style={s.streamLabel}>STDOUT</Text>
          <Text style={s.streamText} selectable>
            {stdoutExpanded ? result.stdout : stdoutPiece.preview}
            {stdoutPiece.overflow > 0 && !stdoutExpanded ? '\n…' : ''}
          </Text>
          {stdoutPiece.overflow > 0 && (
            <Pressable onPress={() => setStdoutExpanded(v => !v)} style={s.expandBtn}>
              <Text style={[s.expandText, { color: accentColor }]}>
                {stdoutExpanded ? 'collapse' : `show ${stdoutPiece.overflow.toLocaleString()} more chars`}
              </Text>
            </Pressable>
          )}
        </View>
      ) : null}

      {/* stderr */}
      {stderrPiece.preview ? (
        <View style={s.streamBlock}>
          <Text style={[s.streamLabel, { color: '#fca5a5' }]}>STDERR</Text>
          <Text style={[s.streamText, { color: '#fca5a5' }]} selectable>
            {stderrExpanded ? result.stderr : stderrPiece.preview}
            {stderrPiece.overflow > 0 && !stderrExpanded ? '\n…' : ''}
          </Text>
          {stderrPiece.overflow > 0 && (
            <Pressable onPress={() => setStderrExpanded(v => !v)} style={s.expandBtn}>
              <Text style={[s.expandText, { color: '#fca5a5' }]}>
                {stderrExpanded ? 'collapse' : `show ${stderrPiece.overflow.toLocaleString()} more chars`}
              </Text>
            </Pressable>
          )}
        </View>
      ) : null}

      {/* Empty-result hint */}
      {!stdoutPiece.preview && !stderrPiece.preview && !result.error ? (
        <Text style={s.empty}>(no output)</Text>
      ) : null}

      {/* Privacy footer */}
      <Text style={s.footer}>local — not saved to circle</Text>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: '#0a0f1c',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    gap: 8,
  },
  header: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  prompt: {
    fontSize: 13, fontWeight: '900', fontFamily: MONO, lineHeight: 18,
  },
  command: {
    flex: 1, color: '#e2e8f0', fontSize: 13, fontFamily: MONO,
    lineHeight: 18,
  },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  meta: { color: '#64748b', fontSize: 10, fontFamily: MONO, fontWeight: '700', letterSpacing: 0.4 },
  metaValue: { color: '#94a3b8' },
  streamBlock: {
    borderRadius: 6, backgroundColor: '#020617',
    borderWidth: 1, borderColor: '#1e293b',
    padding: 10, gap: 4,
  },
  streamLabel: {
    color: '#94a3b8', fontSize: 9, fontWeight: '900', letterSpacing: 1.2,
    fontFamily: MONO,
  },
  streamText: {
    color: '#e2e8f0', fontSize: 12, fontFamily: MONO, lineHeight: 17,
  },
  expandBtn: {
    alignSelf: 'flex-start', paddingVertical: 2, paddingHorizontal: 4,
  },
  expandText: { fontSize: 10, fontWeight: '700', fontFamily: MONO },
  empty: { color: '#475569', fontSize: 11, fontStyle: 'italic', fontFamily: MONO },
  footer: {
    color: '#475569', fontSize: 9, fontFamily: MONO,
    fontWeight: '700', letterSpacing: 0.6, textAlign: 'right',
  },
});
