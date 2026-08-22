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
import {
  BRIDGE_CATALOG,
  parseBridgeHealth,
  type BridgeName,
} from '../lib/bridgeHealthDiag';
import { getLocalOpenSwanDiscoveryEndpoints } from '../lib/connectionManager';

type Props = {
  agent: OfficeAgent;
  /** Exact connected OpenSwan connection resolved by the Office owner. */
  runtimeConnectionId?: string | null;
};

type BridgeState = 'checking' | 'online' | 'degraded' | 'offline' | 'unsupported';

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

function bridgeCatalogName(provider: string): BridgeName | null {
  if (provider === 'gemini') return 'gemini-cli';
  if (provider === 'openswan') return 'openswan-proxy';
  if (provider === 'claude-code' || provider === 'codex' || provider === 'cursor') return provider;
  return null;
}

function offlineHelp(provider: string): string {
  if (provider === 'openswan') return 'Run npm run start, then confirm the OpenSwan proxy on port 18790 is healthy.';
  if (provider === 'claude-code') return 'Run npm run start, then confirm the Claude Code bridge on port 7778 is healthy.';
  if (provider === 'codex') return 'Run npm run start, then confirm the Codex bridge on port 7779 is healthy.';
  if (provider === 'gemini') return 'Run npm run start, then confirm the Gemini bridge on port 7780 is healthy.';
  if (provider === 'cursor') return 'Run npm run start, then confirm the Cursor bridge on port 7781 is healthy.';
  return 'This provider does not advertise a local bridge health endpoint.';
}

export default function AgentControlCard({ agent, runtimeConnectionId }: Props) {
  const provider = bridgeProvider(agent);
  const hasExactRuntimeConnection = provider === 'openswan' && !!runtimeConnectionId?.trim();
  const [state, setState] = useState<BridgeState>('checking');
  const [detail, setDetail] = useState('Checking runtime connection…');
  const [guidance, setGuidance] = useState<string | null>(null);
  const requestGenerationRef = useRef(0);
  const requestAbortRef = useRef<AbortController | null>(null);

  const checkBridge = useCallback(() => {
    const generation = requestGenerationRef.current + 1;
    requestGenerationRef.current = generation;
    requestAbortRef.current?.abort();
    requestAbortRef.current = null;

    // Office already resolved this id from one enabled, connected, exact
    // OpenSwan connection. AgentControlCard does not receive (and must not
    // recover) the private connection endpoint/token, so consume that canonical
    // snapshot instead of probing an unrelated localhost gateway.
    if (hasExactRuntimeConnection) {
      setState('online');
      setDetail('Connected through this agent’s exact Office runtime connection.');
      setGuidance(null);
      return;
    }

    const endpoint = bridgeEndpoint(provider);
    if (!BRIDGE_PORTS[provider]) {
      setState('unsupported');
      setDetail('No local bridge health contract is available for this provider.');
      setGuidance(null);
      return;
    }
    if (!endpoint) {
      setState('offline');
      setDetail('The local bridge is unavailable in this environment.');
      setGuidance(null);
      return;
    }

    setState('checking');
    setDetail('Checking runtime connection…');
    setGuidance(null);
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
        const catalogName = bridgeCatalogName(provider);
        const catalogEntry = catalogName
          ? BRIDGE_CATALOG.find(entry => entry.name === catalogName)
          : null;
        if (!catalogEntry) throw new Error('bridge_contract_missing');
        const parsed = parseBridgeHealth(catalogEntry, payload);
        setGuidance(parsed.hint || null);
        if (parsed.status === 'offline') {
          setState('offline');
          setDetail(parsed.detail);
          return;
        }
        if (parsed.status === 'degraded') {
          setState('degraded');
          setDetail(parsed.detail);
          return;
        }
        setState('online');
        setDetail(parsed.sessionCount === undefined
          ? 'Provider bridge reachable'
          : parsed.sessionCount > 0
            ? `Provider bridge reachable · ${parsed.sessionCount} session${parsed.sessionCount === 1 ? '' : 's'} reported`
            : 'Provider bridge reachable · no sessions reported');
      })
      .catch(() => {
        if (generation !== requestGenerationRef.current) return;
        setState('offline');
        setDetail('Runtime bridge could not be reached.');
        setGuidance(null);
      })
      .finally(() => {
        clearTimeout(timeoutId);
        if (generation === requestGenerationRef.current) requestAbortRef.current = null;
      });
  }, [hasExactRuntimeConnection, provider]);

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
    : state === 'offline' || state === 'degraded'
      ? '#f59e0b'
      : '#8b949e';

  return (
    <View style={[styles.card, { borderColor: tone + '38' }]} nativeID="section-agent-bridge-status">
      <View style={styles.summaryRow} accessibilityLiveRegion="polite">
        <View style={[styles.statusDot, { backgroundColor: tone }]} />
        <View style={styles.copy}>
          <Text style={styles.title}>{hasExactRuntimeConnection ? 'Runtime connection' : 'Provider bridge'}</Text>
          <Text style={[styles.detail, { color: tone }]}>{detail}</Text>
        </View>
        {!hasExactRuntimeConnection ? (
          <Pressable
            onPress={checkBridge}
            disabled={state === 'checking'}
            accessibilityRole="button"
            accessibilityLabel="Refresh provider bridge status"
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
        ) : null}
      </View>

      {!hasExactRuntimeConnection ? (
        <View style={styles.scopeNote}>
          <Text style={styles.scopeNoteText}>
            Provider-level check only. This does not verify the selected agent’s exact runtime session.
          </Text>
        </View>
      ) : null}

      {state === 'offline' || state === 'degraded' || state === 'unsupported' ? (
        <View style={styles.help} accessibilityRole="alert">
          <Text style={styles.helpText}>{guidance || offlineHelp(provider)}</Text>
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
  scopeNote: {
    borderTopWidth: 1,
    borderTopColor: '#21262d',
    paddingTop: 8,
  },
  scopeNoteText: {
    color: '#6e7681',
    fontSize: 10,
    lineHeight: 15,
  },
});
