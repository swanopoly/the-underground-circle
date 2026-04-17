import { Platform } from 'react-native';
import { OfficeAgent } from '../../../../lib/officeAgents';

export const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(0) + 'K';
  return String(n);
}

export function formatRelativeTime(iso?: string): string {
  if (!iso) return 'unknown';
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function formatMsgTime(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  return d.toLocaleDateString();
}

export function cacheHitPct(cachedTokens: number, totalInputTokens: number): string {
  if (!totalInputTokens) return '—';
  return Math.round((cachedTokens / totalInputTokens) * 100) + '%';
}

export function getAgentHealth(agent: OfficeAgent): {
  label: string;
  color: string;
  detail: string;
} {
  if (agent.status === 'active' || agent.status === 'building') {
    return {
      label: 'Ready',
      color: '#22c55e',
      detail: agent.currentToolName ? `Working in ${agent.currentToolName}` : 'Connected and responsive',
    };
  }
  if (agent.status === 'idle') {
    return {
      label: 'Standing by',
      color: '#f59e0b',
      detail: 'Connected but not actively executing',
    };
  }
  if (agent.status === 'error') {
    return {
      label: 'Needs attention',
      color: '#ef4444',
      detail: 'Recent runtime state indicates an error path',
    };
  }
  return {
    label: 'Offline',
    color: '#6b7280',
    detail: 'No recent runtime activity detected',
  };
}

export function shortPath(p: string): string {
  if (!p) return '';
  const parts = p.split('/');
  return parts.length > 3 ? `.../${parts.slice(-3).join('/')}` : p;
}
