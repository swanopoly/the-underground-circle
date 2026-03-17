/**
 * compartmentActivity.ts — Shared stats/activity logic for compartments.
 * Used by both the 3D backpack meshes and the 2D compartment cards.
 */
import type { BackpackData } from '../../hooks/useBackpackData';

export interface CompartmentStats {
  miniStat: string;
  hasActivity: boolean;
}

const fmtTokens = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 1000 ? `${(n / 1000).toFixed(1)}K`
    : String(n);

export function getCompartmentStats(
  key: string,
  data: BackpackData,
): CompartmentStats {
  const activeAgents = data.enrichedAgents.filter(a => a.status === 'active').length;
  const healthyAgents = data.enrichedAgents.filter(a => a.status !== 'error').length;
  const healthPct = data.enrichedAgents.length > 0
    ? Math.round((healthyAgents / data.enrichedAgents.length) * 100)
    : 100;
  const tagCount = data.sessionTags.size;

  switch (key) {
    case 'cost':
      return {
        miniStat: `$${data.periodCosts.today.toFixed(2)} today`,
        hasActivity: data.periodCosts.today > 0,
      };
    case 'terminal':
      return {
        miniStat: `${data.agentCount} agents · ${data.totalMessagesToday} msgs`,
        hasActivity: data.totalMessagesToday > 0,
      };
    case 'traces':
      return {
        miniStat: `${data.traceCount} traces`,
        hasActivity: data.traceCount > 0,
      };
    case 'farm':
      return {
        miniStat: `${healthPct}% healthy · ${activeAgents} active`,
        hasActivity: activeAgents > 0,
      };
    case 'performance': {
      const top = data.enrichedAgents.reduce(
        (best, a) => a.turns > (best?.turns || 0) ? a : best,
        data.enrichedAgents[0],
      );
      return {
        miniStat: top ? `Top: ${top.name}` : 'No data',
        hasActivity: (top?.turns || 0) > 0,
      };
    }
    case 'projects':
      return {
        miniStat: `${tagCount} tags · ${data.sessionCount} sessions`,
        hasActivity: tagCount > 0,
      };
    case 'analytics':
      return {
        miniStat: `${data.mergedCircleAgents.length} agents · ${fmtTokens(data.totalTokensToday)} tokens`,
        hasActivity: data.mergedCircleAgents.length > 0,
      };
    case 'canvas':
      return {
        miniStat: `${data.mergedCircleAgents.length} agents`,
        hasActivity: data.mergedCircleAgents.length > 0,
      };
    case 'prompts':
      return { miniStat: 'Prompt library', hasActivity: false };
    case 'llm-bench':
      return { miniStat: '29 models', hasActivity: false };
    case 'trading':
      return {
        miniStat: data.featuredTradeCount > 0
          ? `${data.featuredTradeCount} active trades`
          : 'Solana trading',
        hasActivity: data.featuredTradeCount > 0,
      };
    default:
      return { miniStat: '', hasActivity: false };
  }
}

/** Build the stats map for all compartments at once */
export function getAllCompartmentStats(data: BackpackData): Record<string, CompartmentStats> {
  const keys = ['cost', 'terminal', 'traces', 'farm', 'performance', 'projects', 'analytics', 'canvas', 'prompts', 'llm-bench', 'trading'];
  const result: Record<string, CompartmentStats> = {};
  for (const key of keys) {
    result[key] = getCompartmentStats(key, data);
  }
  return result;
}
