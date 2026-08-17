/**
 * AgentControlCard — compact, read-only runtime connection summary.
 *
 * The Office Agent panel owns identity, pause/resume, removal, Terminal, and
 * task routing. This component intentionally owns only one bounded bridge
 * health probe plus manual refresh; keeping mutations here previously created
 * duplicate command owners and ambient-auth destructive paths.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import type { OfficeAgent } from '../lib/officeAgents';
import { getBridgeUrl } from '../lib/bridgeEnvironment';
import { getLocalOpenSwanDiscoveryEndpoints } from '../lib/connectionManager';

type Props = {
  agent: OfficeAgent;
};

type BridgeState = 'checking' | 'online' | 'offline' | 'unsupported';

const BRIDGE_PORTS: Readonly<Record<string, number>> = {
  'claude-code': 7778,
  codex: 7779,
  gemini: 7780,
  cursor: 7781,
  openswan: 18789,
};

function bridgeProvider(agent: OfficeAgent): string {
  return agent.providerType === 'blackswan-local' ? 'openswan' : (agent.providerType || '');
}

function bridgeEndpoint(provider: string): string | null {
  if (provider === 'openswan') return getLocalOpenSwanDiscoveryEndpoints()[0] || null;
  const port = BRIDGE_PORTS[provider];
  return port ? getBridgeUrl(port) : null;
}

function offlineHelp(provider: string): string {
  if (provider === 'openswan') return 'Run npm run start, then confirm the OpenSwan proxy on port 18790 is healthy.';
  if (provider === 'claude-code') return 'Run npm run start, then confirm the Claude Code bridge on port 7778 is healthy.';
  if (provider === 'codex') return 'Run npm run start, then confirm the Codex bridge on port 7779 is healthy.';
  if (provider === 'gemini') return 'Run npm run start, then confirm the Gemini bridge on port 7780 is healthy.';
  if (provider === 'cursor') return 'Run npm run start, then confirm the Cursor bridge on port 7781 is healthy.';
  return 'This provider does not advertise a local bridge health endpoint.';
}

export default function AgentControlCard({ agent }: Props) {
  const provider = bridgeProvider(agent);
  const [state, setState] = useState<BridgeState>('checking');
  const [detail, setDetail] = useState('Checking runtime connection…');
  const requestGenerationRef = useRef(0);
  const requestAbortRef = useRef<AbortController | null>(null);

  const checkBridge = useCallback(() => {
    const generation = requestGenerationRef.current + 1;
    requestGenerationRef.current = generation;
    requestAbortRef.current?.abort();
    requestAbortRef.current = null;

    const endpoint = bridgeEndpoint(provider);
    if (!BRIDGE_PORTS[provider]) {
      setState('unsupported');
      setDetail('No local bridge health contract is available for this provider.');
      return;
    }
    if (!endpoint) {
      setState('offline');
      setDetail('The local bridge is unavailable in this environment.');
      return;
    }

    setState('checking');
    setDetail('Checking runtime connection…');
    const controller = new AbortController();
    requestAbortRef.current = controller;
    const timeoutId = setTimeout(() => controller.abort(), 5_000);
    void fetch(`${endpoint}/health`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('bridge_unavailable');
        return response.json();
      })
      .then(payload => {
        if (generation !== requestGenerationRef.current) return;
        const sessionCount = Number(payload?.sessions || 0);
        setState('online');
        setDetail(sessionCount > 0
          ? `Connected · ${sessionCount} active session${sessionCount === 1 ? '' : 's'}`
          : 'Connected · no active sessions reported');
      })
      .catch(() => {
        if (generation !== requestGenerationRef.current) return;
        setState('offline');
        setDetail('Runtime bridge could not be reached.');
      })
      .finally(() => {
        clearTimeout(timeoutId);
        if (generation === requestGenerationRef.current) requestAbortRef.current = null;
      });
  }, [provider]);

  useEffect(() => {
    checkBridge();
    return () => {
      requestGenerationRef.current += 1;
      requestAbortRef.current?.abort();
      requestAbortRef.current = null;
    };
  }, [checkBridge]);

  const tone = state === 'online'
    ? '#22c55e'
    : state === 'offline'
      ? '#f59e0b'
      : '#8b949e';

  return (
    <View style={[styles.card, { borderColor: tone + '38' }]} nativeID="section-agent-bridge-status">
      <View style={styles.summaryRow} accessibilityLiveRegion="polite">
        <View style={[styles.statusDot, { backgroundColor: tone }]} />
        <View style={styles.copy}>
          <Text style={styles.title}>Runtime connection</Text>
          <Text style={[styles.detail, { color: tone }]}>{detail}</Text>
        </View>
        <Pressable
          onPress={checkBridge}
          disabled={state === 'checking'}
          accessibilityRole="button"
          accessibilityLabel="Refresh runtime connection status"
          accessibilityState={{ disabled: state === 'checking', busy: state === 'checking' }}
          style={({ hovered }: any) => [
            styles.refreshButton,
            hovered && styles.refreshButtonHover,
            state === 'checking' && styles.disabled,
            Platform.OS === 'web' && ({ cursor: state === 'checking' ? 'wait' : 'pointer' } as any),
          ]}
        >
          {state === 'checking'
            ? <ActivityIndicator size="small" color="#8b949e" />
            : <Text style={styles.refreshText}>Refresh</Text>}
        </Pressable>
      </View>

      {state === 'offline' || state === 'unsupported' ? (
        <View style={styles.help} accessibilityRole="alert">
          <Text style={styles.helpText}>{offlineHelp(provider)}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: '#0d1117',
    padding: 10,
    gap: 8,
  },
  summaryRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  copy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    color: '#e6edf3',
    fontSize: 13,
    fontWeight: '600',
  },
  detail: {
    fontSize: 11,
    lineHeight: 16,
  },
  refreshButton: {
    minWidth: 64,
    minHeight: 44,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#30363d',
    backgroundColor: '#161b22',
    alignItems: 'center',
    justifyContent: 'center',
  },
  refreshButtonHover: {
    borderColor: '#8b949e',
    backgroundColor: '#21262d',
  },
  refreshText: {
    color: '#c9d1d9',
    fontSize: 11,
    fontWeight: '600',
  },
  disabled: {
    opacity: 0.6,
  },
  help: {
    borderTopWidth: 1,
    borderTopColor: '#21262d',
    paddingTop: 8,
  },
  helpText: {
    color: '#8b949e',
    fontSize: 11,
    lineHeight: 16,
  },
});
