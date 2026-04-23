import type { ChatCommandDecision } from './chatCommandRegistry';

export function readRunCommandDecisions(metadata: Record<string, unknown> | null | undefined): ChatCommandDecision[] {
  const current = metadata?.command_route_decisions;
  if (Array.isArray(current)) return current as ChatCommandDecision[];
  const legacy = metadata?.commandDecisions;
  return Array.isArray(legacy) ? legacy as ChatCommandDecision[] : [];
}

export function formatCommandDecisionRoute(decision: ChatCommandDecision): string {
  return decision.routeId.replace(/_/g, ' ').toUpperCase();
}

export function formatCommandDecisionSource(decision: ChatCommandDecision): string {
  return decision.source.replace(/_/g, ' ').toUpperCase();
}

export function buildCommandDecisionSummary(decisions: ChatCommandDecision[]): string | null {
  if (!decisions.length) return null;
  const labels = Array.from(new Set(decisions.map((decision) => formatCommandDecisionRoute(decision))));
  return labels.slice(0, 2).join(' · ');
}
