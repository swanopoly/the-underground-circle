/**
 * AgentDispatchCard — renders the result of an /assign / /delegate /
 * /spawn / /send / /queue dispatch.
 *
 * For spawn dispatches, polls the bridge's /spawn/status endpoint at
 * 2-second intervals until the process exits or 10 minutes pass
 * (timeout safeguard). For send/queue dispatches, renders the
 * one-shot result.
 *
 * Local-only — paths + PIDs may be machine-specific. Render once and
 * forget; the chat history is unaffected.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, Platform } from 'react-native';
import type { DispatchResult } from '../../../../lib/agentDispatch';

interface Props {
  dispatch: DispatchResult;
  /** Friendly session name to display in the header. */
  sessionName: string;
  /** Bridge name (claude-code, codex, …) shown alongside the session. */
  bridge: string;
  /** Original task text, captured at dispatch time. */
  task: string;
  accentColor?: string;
  /** Optional reply-to-chat callback so the user can pipe spawned
   *  process output back into the conversation as a follow-up
   *  message. Mirrors TerminalOutputCard. */
  onReplyToChat?: (replyText: string) => void;
}

interface SpawnStatus {
  ok: boolean;
  /** True while the spawned process is still running. */
  alive?: boolean;
  /** Process exit code (when known). Bridge currently doesn't capture
   *  this — `completed: true` just means the PID is no longer alive. */
  exitCode?: number | null;
  /** Tail of the spawn log file. Bridge field is `output`; we surface
   *  it as logTail for clarity. */
  logTail?: string;
  /** Total log file size — useful to detect "still nothing" cases. */
  byteLength?: number;
  durationMs?: number;
  error?: string;
}

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';
const POLL_INTERVAL_MS = 2_000;
const POLL_MAX_MS = 10 * 60 * 1000;
const LOG_TAIL_PREVIEW_CHARS = 1000;

function formatDuration(ms: number | undefined): string {
  if (!ms || ms <= 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

export default function AgentDispatchCard({
  dispatch,
  sessionName,
  bridge,
  task,
  accentColor = '#a855f7',
  onReplyToChat,
}: Props) {
  const [status, setStatus] = useState<SpawnStatus | null>(null);
  const [polling, setPolling] = useState(false);
  const [logExpanded, setLogExpanded] = useState(false);
  const [replied, setReplied] = useState(false);
  const startedAtRef = useRef<number>(Date.now());
  const cancelledRef = useRef(false);

  const isSpawn = dispatch.kind === 'spawn' && dispatch.ok && dispatch.pollUrl && dispatch.pid != null;

  // Poll /spawn/status until the process exits or we time out.
  useEffect(() => {
    if (!isSpawn) return;
    cancelledRef.current = false;
    setPolling(true);
    const tick = async () => {
      if (cancelledRef.current) return;
      const elapsed = Date.now() - startedAtRef.current;
      if (elapsed > POLL_MAX_MS) {
        setPolling(false);
        return;
      }
      try {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 3500);
        const res = await fetch(dispatch.pollUrl!, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pid: dispatch.pid, logFile: dispatch.logFile }),
          signal: ac.signal,
        });
        clearTimeout(timer);
        if (cancelledRef.current) return;
        if (!res.ok) {
          // Bridge may not implement /spawn/status; stop polling silently.
          setPolling(false);
          return;
        }
        const data: any = await res.json().catch(() => ({}));
        // claude-bridge /spawn/status returns: ok, isRunning, completed,
        // hasOutput, output, byteLength, lastUpdatedAt. Translate to our
        // generic shape so other bridges can reuse the same card.
        const alive = typeof data?.alive === 'boolean' ? data.alive
          : typeof data?.isRunning === 'boolean' ? data.isRunning
          : undefined;
        const logTail = typeof data?.logTail === 'string' ? data.logTail
          : typeof data?.output === 'string' ? data.output
          : undefined;
        setStatus({
          ok: data?.ok !== false,
          alive,
          exitCode: typeof data?.exitCode === 'number' ? data.exitCode : (alive === false ? 0 : null),
          logTail,
          byteLength: typeof data?.byteLength === 'number' ? data.byteLength : undefined,
          durationMs: elapsed,
        });
        // Stop when the process is no longer alive.
        if (alive === false) {
          setPolling(false);
          return;
        }
      } catch {
        // Polling failure — keep trying for a few more cycles, then bail.
      }
      if (!cancelledRef.current) {
        setTimeout(tick, POLL_INTERVAL_MS);
      }
    };
    void tick();
    return () => {
      cancelledRef.current = true;
      setPolling(false);
    };
  }, [isSpawn, dispatch.pollUrl, dispatch.pid, dispatch.logFile]);

  const handleReply = useCallback(() => {
    if (!onReplyToChat || replied) return;
    const lines: string[] = [
      `Result of dispatching to \`${sessionName}\` (${bridge}):`,
      `Task: ${task}`,
      `Mode: ${dispatch.kind}`,
    ];
    if (dispatch.pid != null) lines.push(`PID: ${dispatch.pid}`);
    if (status?.exitCode != null) lines.push(`Exit code: ${status.exitCode}`);
    if (status?.durationMs != null) lines.push(`Duration: ${formatDuration(status.durationMs)}`);
    if (status?.logTail) {
      const tail = status.logTail.length > 4000 ? status.logTail.slice(-4000) : status.logTail;
      lines.push('', '```log', tail, '```');
    } else if (dispatch.logFile) {
      lines.push(`Log file (on local disk): \`${dispatch.logFile}\``);
    }
    if (dispatch.error) lines.push(`Error: ${dispatch.error}`);
    onReplyToChat(lines.join('\n'));
    setReplied(true);
  }, [onReplyToChat, replied, sessionName, bridge, task, dispatch, status]);

  const statusColor =
    !dispatch.ok ? '#ef4444' :
    status?.alive === false && (status?.exitCode === 0) ? '#22c55e' :
    status?.alive === false && status?.exitCode != null && status.exitCode !== 0 ? '#f59e0b' :
    polling ? accentColor :
    accentColor;

  const statusLabel =
    !dispatch.ok ? 'REJECTED' :
    status?.alive === false && status?.exitCode === 0 ? 'COMPLETED' :
    status?.alive === false && status?.exitCode != null ? `EXITED (${status.exitCode})` :
    polling ? 'RUNNING' :
    dispatch.kind.toUpperCase();

  const tailPreview = status?.logTail && !logExpanded
    ? (status.logTail.length > LOG_TAIL_PREVIEW_CHARS
        ? status.logTail.slice(-LOG_TAIL_PREVIEW_CHARS)
        : status.logTail)
    : status?.logTail;

  return (
    <View style={[s.card, { borderColor: accentColor + '30' }]} nativeID="section-agent-dispatch">
      {/* Header — target + status */}
      <View style={s.header}>
        <Text style={[s.arrow, { color: accentColor }]}>→</Text>
        <Text style={s.target} selectable numberOfLines={1}>
          {sessionName} <Text style={s.bridge}>· {bridge}</Text>
        </Text>
        <Text style={[s.status, { color: statusColor }]}>{statusLabel}</Text>
      </View>

      {/* Task body */}
      <Text style={s.task} selectable numberOfLines={3}>{task}</Text>

      {/* Meta — pid / log / duration */}
      <View style={s.metaRow}>
        {dispatch.pid != null && (
          <Text style={s.meta}>PID <Text style={s.metaValue}>{dispatch.pid}</Text></Text>
        )}
        {status?.durationMs != null && (
          <Text style={s.meta}>{formatDuration(status.durationMs)}</Text>
        )}
        {dispatch.logFile && (
          <Text style={s.meta} numberOfLines={1}>log <Text style={s.metaValue}>{dispatch.logFile}</Text></Text>
        )}
      </View>

      {/* Outcome message */}
      {dispatch.message && (
        <Text style={s.message}>{dispatch.message}</Text>
      )}

      {/* Log tail (when polling has yielded any) */}
      {tailPreview ? (
        <View style={s.logBlock}>
          <Text style={s.logLabel}>LOG TAIL</Text>
          <Text style={s.logText} selectable>{tailPreview}</Text>
          {(status?.logTail?.length || 0) > LOG_TAIL_PREVIEW_CHARS && (
            <Pressable onPress={() => setLogExpanded(v => !v)} style={s.expandBtn}>
              <Text style={[s.expandText, { color: accentColor }]}>
                {logExpanded ? 'collapse' : `show all ${(status?.logTail?.length || 0).toLocaleString()} chars`}
              </Text>
            </Pressable>
          )}
        </View>
      ) : null}

      {/* Action row */}
      {(dispatch.ok && (onReplyToChat || dispatch.error)) ? (
        <View style={s.actionRow}>
          {onReplyToChat ? (
            <Pressable
              onPress={handleReply}
              disabled={replied}
              style={[s.actionBtn, { borderColor: accentColor + '60', opacity: replied ? 0.5 : 1 }]}
            >
              <Text style={[s.actionText, { color: replied ? '#94a3b8' : accentColor }]}>
                {replied ? 'sent to chat' : '↗ reply to chat with result'}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {/* Footer */}
      <Text style={s.footer}>local — not saved to circle{polling ? ' · polling /spawn/status' : ''}</Text>
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
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  arrow: { fontSize: 14, fontWeight: '900', fontFamily: MONO },
  target: { flex: 1, color: '#e2e8f0', fontSize: 13, fontWeight: '700' },
  bridge: { color: '#94a3b8', fontWeight: '500' },
  status: {
    fontSize: 9, fontWeight: '900', letterSpacing: 1, fontFamily: MONO,
  },
  task: {
    color: '#cbd5e1', fontSize: 12, lineHeight: 17, fontFamily: MONO,
    paddingHorizontal: 6, paddingVertical: 4,
    backgroundColor: '#020617', borderRadius: 4,
    borderWidth: 1, borderColor: '#1e293b',
  },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  meta: { color: '#64748b', fontSize: 10, fontFamily: MONO, fontWeight: '700', letterSpacing: 0.4 },
  metaValue: { color: '#94a3b8' },
  message: { color: '#94a3b8', fontSize: 11, lineHeight: 15 },
  logBlock: {
    borderRadius: 6, backgroundColor: '#020617',
    borderWidth: 1, borderColor: '#1e293b',
    padding: 10, gap: 4,
  },
  logLabel: { color: '#94a3b8', fontSize: 9, fontWeight: '900', letterSpacing: 1.2, fontFamily: MONO },
  logText: { color: '#e2e8f0', fontSize: 11, fontFamily: MONO, lineHeight: 16 },
  expandBtn: { alignSelf: 'flex-start' },
  expandText: { fontSize: 10, fontWeight: '700', fontFamily: MONO },
  actionRow: { flexDirection: 'row', gap: 6 },
  actionBtn: {
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 4, borderWidth: 1, backgroundColor: '#0f172a',
  },
  actionText: { fontSize: 10, fontWeight: '800', fontFamily: MONO, letterSpacing: 0.4 },
  footer: {
    color: '#475569', fontSize: 9, fontFamily: MONO,
    fontWeight: '700', letterSpacing: 0.6, textAlign: 'right',
  },
});
