export type AgentIdentityKeyInput = {
  id?: string | null;
  name?: string | null;
  sessionKey?: string | null;
};

export function getAgentIdentityKey(agent: AgentIdentityKeyInput | null | undefined): string {
  if (!agent) return '';
  if (agent.sessionKey?.trim()) return agent.sessionKey.trim();
  if (typeof agent.id === 'string' && agent.id.trim()) {
    if (agent.id.startsWith('provider-main::')) {
      return `provider-main:${agent.id.split('::')[1] || agent.id}`;
    }
    if (agent.id.includes('::')) {
      return agent.id.split('::')[1] || agent.id;
    }
    return agent.id;
  }
  return agent.name?.trim() || '';
}
