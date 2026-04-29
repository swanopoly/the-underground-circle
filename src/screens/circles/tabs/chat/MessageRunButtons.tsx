/**
 * MessageRunButtons — when an agent reply contains shell commands,
 * surface them as one-tap RUN buttons so the user doesn't have to
 * retype `/run <cmd>`.
 *
 * Detection (intentionally conservative — false positives prompt
 * unintended execution, false negatives just lose convenience):
 *   1. Fenced code blocks tagged ```bash / ```sh / ```shell / ```zsh —
 *      every newline-separated, non-comment, non-empty line is a
 *      command candidate.
 *   2. Inline single-backtick code starting with a known shell verb
 *      (npm, npx, yarn, pnpm, git, ls, cd, mkdir, cat, grep, find,
 *      curl, brew, etc.).
 *
 * Tapping a RUN button reuses the same path as the /run slash
 * command — output stays local-only.
 */
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View, Platform } from 'react-native';
import { executeTerminalCommandStream, type TerminalRunResult } from '../../../../lib/terminalChatCommands';
import TerminalOutputCard from './TerminalOutputCard';

interface Props {
  content: string;
  circleId: string;
  accentColor?: string;
  /** Optional — when wired, each result card shows "↗ reply to chat"
   *  so the agent can see the output and continue reasoning. */
  onReplyToChat?: (replyText: string) => void;
}

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

const SHELL_VERBS = new Set([
  'npm', 'npx', 'yarn', 'pnpm', 'bun', 'deno',
  'git', 'gh',
  'ls', 'cd', 'pwd', 'mkdir', 'rmdir', 'cp', 'mv', 'touch',
  'cat', 'head', 'tail', 'less', 'more',
  'grep', 'find', 'rg', 'ag', 'fd', 'sed', 'awk',
  'curl', 'wget', 'http',
  'brew', 'apt', 'apt-get', 'dnf', 'pacman',
  'docker', 'kubectl', 'helm', 'terraform',
  'python', 'python3', 'pip', 'pip3', 'poetry', 'uv',
  'node', 'tsx', 'ts-node',
  'cargo', 'rustc',
  'go', 'gofmt',
  'make', 'cmake',
  'open', 'echo', 'export', 'env',
]);

function isLikelyShellCommand(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return false;
  // Strip a leading `$ ` prompt marker.
  const stripped = trimmed.replace(/^\$\s+/, '');
  // First token must be a known verb (or a known assignment-then-verb pattern).
  const verb = stripped.split(/\s+/)[0]?.replace(/^[A-Z_]+=[^\s]*$/, '') || '';
  return SHELL_VERBS.has(verb);
}

interface CommandHit {
  source: 'fenced' | 'inline';
  command: string;
}

function extractCommands(content: string): CommandHit[] {
  if (!content) return [];
  const hits: CommandHit[] = [];
  const seen = new Set<string>();

  // 1. Fenced code blocks with a shell-flavored language tag.
  const FENCE_RE = /```(?:bash|sh|shell|zsh)\n([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = FENCE_RE.exec(content)) !== null) {
    const body = m[1] || '';
    for (const rawLine of body.split('\n')) {
      const line = rawLine.replace(/^\$\s+/, '').trim();
      if (!line || line.startsWith('#')) continue;
      // Cap to a sane length so a paragraph in a code block doesn't slip through.
      if (line.length > 400) continue;
      if (seen.has(line)) continue;
      seen.add(line);
      hits.push({ source: 'fenced', command: line });
    }
  }

  // 2. Inline `code` snippets that look like shell commands.
  const INLINE_RE = /`([^`\n]+?)`/g;
  while ((m = INLINE_RE.exec(content)) !== null) {
    const candidate = m[1].trim();
    if (!candidate || candidate.length > 200) continue;
    if (!isLikelyShellCommand(candidate)) continue;
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    hits.push({ source: 'inline', command: candidate });
  }

  // Cap the total — a wall of buttons is noise, not a feature.
  return hits.slice(0, 6);
}

export default function MessageRunButtons({ content, circleId, accentColor = '#22d3ee', onReplyToChat }: Props) {
  const commands = useMemo(() => extractCommands(content), [content]);
  const [running, setRunning] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, TerminalRunResult>>({});

  if (commands.length === 0) return null;

  const handleRun = async (command: string) => {
    setRunning(command);
    try {
      const handle = executeTerminalCommandStream({
        circleId,
        input: `/run ${command}`,
        onProgress: (result) => {
          // Update the in-flight result every chunk so the user sees
          // stdout/stderr land as they arrive, same as /run does.
          setResults(prev => ({ ...prev, [command]: result }));
        },
      });
      await handle.promise;
    } finally {
      setRunning(null);
    }
  };

  return (
    <View style={s.wrap} nativeID="section-message-run-buttons">
      <Text style={s.label}>RUNNABLE COMMANDS</Text>
      <View style={s.row}>
        {commands.map((hit, i) => {
          const result = results[hit.command];
          const isRunning = running === hit.command;
          const ranOk = result && !result.error && result.code === 0;
          const ranBad = result && (result.error || (result.code != null && result.code !== 0));
          const borderColor =
            ranOk ? '#22c55e' :
            ranBad ? '#f59e0b' :
            accentColor + '60';
          return (
            <Pressable
              key={`${hit.command}-${i}`}
              onPress={() => { void handleRun(hit.command); }}
              disabled={isRunning}
              style={[s.btn, { borderColor }]}
            >
              <Text style={[s.btnPrefix, { color: accentColor }]}>$</Text>
              <Text style={s.btnText} numberOfLines={1}>{hit.command}</Text>
              <Text style={[s.btnAction, { color: isRunning ? '#94a3b8' : ranOk ? '#22c55e' : ranBad ? '#f59e0b' : accentColor }]}>
                {isRunning ? '…' : ranOk ? 'rerun' : ranBad ? 'retry' : 'run'}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {/* Render the most recent result inline. Multiple results stack. */}
      {Object.keys(results).length > 0 ? (
        <View style={s.resultsWrap}>
          {Object.entries(results).map(([cmd, res]) => (
            <TerminalOutputCard
              key={cmd}
              result={res}
              accentColor={accentColor}
              onReplyToChat={onReplyToChat}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginTop: 6, gap: 6 },
  label: {
    color: '#64748b', fontSize: 9, fontWeight: '900',
    letterSpacing: 1.5, fontFamily: MONO,
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  btn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 8, paddingVertical: 5,
    borderRadius: 6, borderWidth: 1,
    backgroundColor: '#0a0f1c',
    maxWidth: 380,
  },
  btnPrefix: { fontSize: 11, fontWeight: '900', fontFamily: MONO },
  btnText: { color: '#e2e8f0', fontSize: 11, fontFamily: MONO, flexShrink: 1 },
  btnAction: {
    fontSize: 9, fontWeight: '900', fontFamily: MONO,
    letterSpacing: 0.6, marginLeft: 4,
  },
  resultsWrap: { gap: 6 },
});
