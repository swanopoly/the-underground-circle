import type { ProviderType } from './connectionManager';
import { probeEndpointHealth } from './connectionManager';
import { testConnection, type OpenSwanSession } from './openswanService';

export type AgentBridgeTestResult = {
  ok: boolean;
  message: string;
  error?: string;
  sessionCount?: number;
  sessions?: OpenSwanSession[];
  capability: 'openswan-rpc' | 'health-only';
};

export function supportsOpenSwanRpc(provider: ProviderType): boolean {
  return provider === 'openswan';
}

export function getAgentBridgeCapabilityLabel(provider: ProviderType): string {
  return supportsOpenSwanRpc(provider) ? 'openswan-rpc' : 'health-only';
}

export async function testAgentBridgeConnection(args: {
  provider: ProviderType;
  endpoint: string;
  token: string;
}): Promise<AgentBridgeTestResult> {
  if (supportsOpenSwanRpc(args.provider)) {
    const result = await testConnection({ endpoint: args.endpoint, token: args.token });
    if (!result.ok) {
      return {
        ok: false,
        message: result.error || 'Connection failed',
        error: result.error || 'Connection failed',
        capability: 'openswan-rpc',
      };
    }
    const sessionCount = result.sessions?.length ?? 0;
    return {
      ok: true,
      message: `Connected! Found ${sessionCount} session${sessionCount !== 1 ? 's' : ''}`,
      sessionCount,
      sessions: result.sessions,
      capability: 'openswan-rpc',
    };
  }

  const healthy = await probeEndpointHealth(args.endpoint);
  if (!healthy) {
    return {
      ok: false,
      message: 'Could not reach the agent bridge /health endpoint',
      error: 'Could not reach the agent bridge /health endpoint',
      capability: 'health-only',
    };
  }

  return {
    ok: true,
    message: 'Bridge reachable. This agent can publish presence into the Office.',
    capability: 'health-only',
  };
}
