/**
 * ConnectAllBridgesPanel — primary "Connect Bridges" affordance on the
 * Office tab. One button. One command. Detects everything the user is
 * already running, auto-pairs the desktop bridge, scans live agents,
 * and surfaces an actionable install command for whatever is missing.
 *
 * Why this exists: before today, users landing on the live HTTPS site
 * saw a passive "BridgeUnavailableBanner" with prose. Most never got
 * past it. The new flow is one click + a token-prefilled npx command
 * the user pastes into Terminal — works from a fresh machine, doesn't
 * require cloning the repo, and auto-pairs the moment the bridge
 * boots.
 *
 * Visibility: the parent collapses this panel to a small "✓ Connected"
 * chip once `isFullyConnected` is true OR the user dismisses it. The
 * dismiss flag is per-circle in localStorage so a different circle
 * with offline bridges still gets the prompt.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import {
  connectAllBridges,
  isFullyConnected,
  REOPEN_COMMAND,
  type ConnectAllBridgesResult,
} from '../../lib/bridgeOneClickConnect';
import { ensureConnectToken } from '../../lib/agentConnect';
import type { BridgeProbeResult } from '../../lib/bridgeHealthDiag';

interface Props {
  circleId: string;
  /** Called once results are in so the parent can refresh agent lists. */
  onConnected?: (result: ConnectAllBridgesResult) => void;
  /** Hide entirely — used after the user dismisses. */
  hidden?: boolean;
  onDismiss?: () => void;
}

const DISMISS_PREFIX = 'uc_connect_bridges_dismissed_';

export default function ConnectAllBridgesPanel({ circleId, onConnected, hidden, onDismiss }: Props) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ConnectAllBridgesResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  // Initial render is the compact prompt: title + one-line description +
  // "Connect Bridges" button + X. The bridge list, install command, and
  // pairing details only mount once the user taps the button.
  const [expanded, setExpanded] = useState(false);

  // Pre-fetch the connect token so the install command is ready the
  // moment the user expands the panel — no spinner-on-tap.
  useEffect(() => {
    let mounted = true;
    (async () => {
      const t = await ensureConnectToken(circleId);
      if (mounted) setToken(t?.token || null);
    })();
    return () => { mounted = false; };
  }, [circleId]);

  const npxCommand = useMemo(
    () => token
      ? `npx @underground-circle/connect --token=${token}`
      : 'npx @underground-circle/connect --token=YOUR_TOKEN',
    [token],
  );

  const handleConnect = useCallback(async () => {
    if (running) return;
    setRunning(true);
    setError(null);
    setExpanded(true);
    try {
      const r = await connectAllBridges();
      setResult(r);
      onConnected?.(r);
    } catch (err: any) {
      setError(err?.message || 'Connect threw an unexpected error.');
    } finally {
      setRunning(false);
    }
  }, [running, onConnected]);

  const handleCopy = useCallback(async (text: string, label: string) => {
    try {
      await Clipboard.setStringAsync(text);
      setCopied(label);
      setTimeout(() => setCopied((c) => (c === label ? null : c)), 1800);
    } catch {
      // Clipboard can fail on some browsers — ignore quietly.
    }
  }, []);

  const handleDismiss = useCallback(() => {
    if (typeof window !== 'undefined') {
      try { window.localStorage?.setItem(DISMISS_PREFIX + circleId, '1'); } catch {}
    }
    onDismiss?.();
  }, [circleId, onDismiss]);

  if (hidden) return null;

  const fullyConnected = isFullyConnected(result);
  const showPrimaryAction = !result || !fullyConnected;

  return (
    <View style={styles.root} nativeID="section-office-connect-bridges">
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <View style={[styles.statusDot, { backgroundColor: dotForState(result, running) }]} />
          <Text style={styles.title}>
            {result && fullyConnected ? 'All bridges connected' : 'Connect your agents'}
          </Text>
        </View>
        <Pressable
          onPress={handleDismiss}
          style={styles.dismiss}
          accessibilityRole="button"
          accessibilityLabel="Dismiss connect panel"
        >
          <Text style={styles.dismissText}>×</Text>
        </Pressable>
      </View>

      <Text style={styles.subtitle}>
        {result
          ? result.summary
          : 'Detect Claude Code, Codex, Gemini CLI, and Cursor on your machine in one click. The desktop bridge auto-pairs.'}
      </Text>

      {showPrimaryAction && (
        <Pressable
          onPress={handleConnect}
          disabled={running}
          style={({ hovered }: any) => [
            styles.primaryBtn,
            hovered && !running && styles.primaryBtnHover,
            running && styles.primaryBtnDisabled,
            Platform.OS === 'web' && ({ cursor: running ? 'wait' : 'pointer' } as any),
          ]}
        >
          {running
            ? <ActivityIndicator size="small" color="#e0e7ff" />
            : <Text style={styles.primaryBtnText}>{result ? 'Re-scan bridges' : 'Connect Bridges'}</Text>}
        </Pressable>
      )}

      {expanded && error && (
        <Text style={styles.errorText}>{error}</Text>
      )}

      {expanded && result && (
        <View style={styles.resultsBlock}>
          {result.liveAgentCount > 0 && (
            <View style={styles.agentBadge}>
              <Text style={styles.agentBadgeText}>
                {result.liveAgentCount} live agent{result.liveAgentCount === 1 ? '' : 's'} discovered
              </Text>
            </View>
          )}

          <View style={styles.bridgeList}>
            {result.bridges.map((b) => (
              <BridgeRow
                key={b.name}
                bridge={b}
                liveCount={result.liveAgentsByBridge[b.name] || 0}
                onCopy={(text, label) => handleCopy(text, label)}
                copiedLabel={copied}
              />
            ))}
          </View>

          {result.desktopBridge.reachable && (
            <View style={styles.pairingNote}>
              <View style={[styles.statusDot, { backgroundColor: result.desktopBridge.paired ? '#22c55e' : '#f59e0b' }]} />
              <Text style={styles.pairingText}>
                Desktop automation:{' '}
                {result.desktopBridge.paired
                  ? result.desktopBridge.pairedJustNow
                    ? 'paired just now (launch / type / keys ready)'
                    : 'already paired'
                  : `pairing failed${result.desktopBridge.reason ? ` — ${result.desktopBridge.reason}` : ''}`}
              </Text>
            </View>
          )}
        </View>
      )}

      {/* Install / first-run command — only shown after the user expands
          the panel via Connect Bridges. De-emphasized once everything
          is healthy so it doesn't compete with the "all connected"
          state. */}
      {expanded && (
      <View style={[styles.installBlock, fullyConnected && styles.installBlockDim]}>
        <Text style={styles.installLabel}>
          {fullyConnected ? 'On a different machine?' : 'Don\'t have the bridge installed yet?'}
        </Text>
        <View style={styles.cmdBox}>
          <Text style={styles.cmdText} selectable numberOfLines={1}>{npxCommand}</Text>
          <Pressable
            onPress={() => handleCopy(npxCommand, 'npx')}
            style={[styles.copyBtn, Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}
            accessibilityRole="button"
            accessibilityLabel="Copy install command"
          >
            <Text style={styles.copyBtnText}>{copied === 'npx' ? 'Copied' : 'Copy'}</Text>
          </Pressable>
        </View>
        <Text style={styles.installHint}>
          Paste in Terminal. Detects Claude Code, Codex, Gemini CLI, and Cursor — pre-tokenized for this circle.
        </Text>

        <View style={styles.cmdBoxSecondary}>
          <Text style={styles.cmdLabelSecondary}>Already cloned the repo?</Text>
          <View style={styles.cmdBox}>
            <Text style={styles.cmdText} selectable numberOfLines={1}>{REOPEN_COMMAND}</Text>
            <Pressable
              onPress={() => handleCopy(REOPEN_COMMAND, 'reopen')}
              style={[styles.copyBtn, Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}
            >
              <Text style={styles.copyBtnText}>{copied === 'reopen' ? 'Copied' : 'Copy'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
      )}
    </View>
  );
}

function BridgeRow({
  bridge,
  liveCount,
  onCopy,
  copiedLabel,
}: {
  bridge: BridgeProbeResult;
  liveCount: number;
  onCopy: (text: string, label: string) => void;
  copiedLabel: string | null;
}) {
  const dotColor =
    bridge.status === 'healthy' ? '#22c55e' :
    bridge.status === 'degraded' ? '#f59e0b' :
    '#ef4444';
  const restartCmd =
    bridge.status !== 'healthy'
      ? bridge.hint?.replace(/^Restart with:\s*/i, '') || ''
      : '';
  const copyKey = `bridge_${bridge.name}`;

  return (
    <View style={styles.bridgeRow}>
      <View style={[styles.statusDot, { backgroundColor: dotColor }]} />
      <View style={styles.bridgeRowMain}>
        <View style={styles.bridgeRowHeader}>
          <Text style={styles.bridgeName}>{bridge.label}</Text>
          <Text style={styles.bridgePort}>:{bridge.port}</Text>
          {liveCount > 0 && (
            <Text style={styles.bridgeAgentCount}>{liveCount} agent{liveCount === 1 ? '' : 's'}</Text>
          )}
        </View>
        <Text style={styles.bridgeDetail}>{bridge.detail}</Text>
        {bridge.hint && bridge.status !== 'healthy' && (
          <Text style={styles.bridgeHint}>{bridge.hint}</Text>
        )}
      </View>
      {restartCmd && (
        <Pressable
          onPress={() => onCopy(restartCmd, copyKey)}
          style={[styles.smallCopyBtn, Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}
          accessibilityRole="button"
          accessibilityLabel={`Copy restart command for ${bridge.label}`}
        >
          <Text style={styles.smallCopyBtnText}>
            {copiedLabel === copyKey ? 'Copied' : 'Copy cmd'}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

function dotForState(result: ConnectAllBridgesResult | null, running: boolean): string {
  if (running) return '#a78bfa';
  if (!result) return '#6366f1';
  if (isFullyConnected(result)) return '#22c55e';
  if (result.bridges.some((b) => b.status === 'healthy')) return '#f59e0b';
  return '#ef4444';
}

/** Helper: read the per-circle dismiss flag. Used by the parent to
 *  decide whether to mount the panel at all. */
export function isConnectPanelDismissed(circleId: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage?.getItem(DISMISS_PREFIX + circleId) === '1';
  } catch {
    return false;
  }
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: '#0a0f1c',
    borderWidth: 1,
    borderColor: '#1e293b',
    borderLeftWidth: 3,
    borderLeftColor: '#6366f1',
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 16,
    marginTop: 8,
    gap: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusDot: { width: 8, height: 8, borderRadius: 999 },
  title: { color: '#e6edf3', fontSize: 14, fontWeight: '700' },
  subtitle: { color: '#94a3b8', fontSize: 12, lineHeight: 18 },
  dismiss: { padding: 4 },
  dismissText: { color: '#64748b', fontSize: 16, lineHeight: 16 },
  primaryBtn: {
    alignSelf: 'flex-start',
    backgroundColor: '#6366f1',
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 10,
    minWidth: 160,
    alignItems: 'center',
  },
  primaryBtnHover: { backgroundColor: '#4f46e5' },
  primaryBtnDisabled: { backgroundColor: '#312e81', opacity: 0.85 },
  primaryBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  errorText: { color: '#fca5a5', fontSize: 12 },
  resultsBlock: { gap: 8 },
  agentBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#16a34a22',
    borderWidth: 1,
    borderColor: '#16a34a55',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  agentBadgeText: { color: '#86efac', fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },
  bridgeList: { gap: 6, marginTop: 4 },
  bridgeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: '#0f172a',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  bridgeRowMain: { flex: 1, gap: 2 },
  bridgeRowHeader: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  bridgeName: { color: '#e6edf3', fontSize: 12, fontWeight: '600' },
  bridgePort: {
    color: '#64748b',
    fontSize: 10,
    fontFamily: Platform.select({ web: 'ui-monospace, SFMono-Regular, Menlo, monospace', default: 'monospace' }) as string,
  },
  bridgeAgentCount: {
    color: '#a5b4fc',
    fontSize: 10,
    fontWeight: '700',
    marginLeft: 'auto',
  },
  bridgeDetail: { color: '#94a3b8', fontSize: 11 },
  bridgeHint: { color: '#fbbf24', fontSize: 11 },
  smallCopyBtn: {
    backgroundColor: '#1e293b',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: '#334155',
    alignSelf: 'center',
  },
  smallCopyBtnText: { color: '#cbd5e1', fontSize: 10, fontWeight: '700' },
  pairingNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 4,
  },
  pairingText: { color: '#94a3b8', fontSize: 11 },
  installBlock: {
    marginTop: 6,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
    gap: 6,
  },
  installBlockDim: { opacity: 0.65 },
  installLabel: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  cmdBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#020617',
    borderWidth: 1,
    borderColor: '#1e293b',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 8,
  },
  cmdText: {
    color: '#a78bfa',
    fontSize: 12,
    flex: 1,
    fontFamily: Platform.select({ web: 'ui-monospace, SFMono-Regular, Menlo, monospace', default: 'monospace' }) as string,
  },
  copyBtn: {
    backgroundColor: '#6366f1',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  copyBtnText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  installHint: { color: '#64748b', fontSize: 11 },
  cmdBoxSecondary: { gap: 6, marginTop: 6 },
  cmdLabelSecondary: { color: '#64748b', fontSize: 11 },
});
