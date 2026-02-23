import AsyncStorage from '@react-native-async-storage/async-storage';

export type ProviderType = 'openclaw' | 'claude-code' | 'generic-agent';

export interface AgentConnection {
  id: string;
  name: string;
  provider: ProviderType;
  endpoint: string;
  token: string;
  enabled: boolean;
  status: 'connected' | 'connecting' | 'disconnected' | 'error';
  error?: string;
  lastConnected?: string;
  sessionCount?: number;
  agentIds?: string[];
  color: string;
}

export const PROVIDER_META: Record<ProviderType, { icon: string; label: string; color: string; defaultEndpoint: string }> = {
  'openclaw': { icon: '🐾', label: 'OpenClaw', color: '#6366f1', defaultEndpoint: 'http://localhost:18790' },
  'claude-code': { icon: '🤖', label: 'Claude Code', color: '#f59e0b', defaultEndpoint: 'http://localhost:8080' },
  'generic-agent': { icon: '⚡', label: 'Generic Agent', color: '#10b981', defaultEndpoint: 'https://' },
};

const STORAGE_KEY = '@office_connections';

export function generateId(): string {
  return `conn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function loadConnections(): Promise<AgentConnection[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const connections = JSON.parse(raw) as AgentConnection[];
    // Reset status on load
    return connections.map(c => ({ ...c, status: 'disconnected' as const, error: undefined }));
  } catch { return []; }
}

export async function saveConnections(connections: AgentConnection[]): Promise<void> {
  // Save without volatile status fields
  const toSave = connections.map(({ status, error, sessionCount, agentIds, ...rest }) => rest);
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
}
