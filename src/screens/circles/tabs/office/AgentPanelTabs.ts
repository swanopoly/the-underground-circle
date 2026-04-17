import { OfficeAgent } from '../../../../lib/officeAgents';

export type AgentPanelTabKey =
  | 'overview'
  | 'activity'
  | 'memory'
  | 'cron'
  | 'spirit'
  | 'evolution'
  | 'runs'
  | 'openswan'
  | 'terminal'
  | 'customize';

export interface AgentPanelTab {
  key: AgentPanelTabKey;
  label: string;
  description: string;
}

const BASE_TABS: AgentPanelTab[] = [
  { key: 'overview', label: 'Overview', description: 'Identity, readiness, controls, and high-signal agent context.' },
  { key: 'activity', label: 'Activity', description: 'Execution telemetry, timeline, tools, messages, and session evidence.' },
  { key: 'memory', label: 'Memory', description: 'Agent, shared, and startup memory available to this runtime.' },
  { key: 'cron', label: 'Cron Jobs', description: 'Scheduled jobs and automated background triggers for this agent.' },
  { key: 'spirit', label: 'Spirit', description: 'Soul, personality, and long-lived behavioral configuration.' },
  { key: 'evolution', label: 'XP & Achievements', description: 'Progression, milestones, and long-term agent growth signals.' },
  { key: 'runs', label: 'Runs', description: 'Tracked runs and step-by-step execution records for this agent.' },
  { key: 'terminal', label: 'Terminal', description: 'Direct remote shell and interactive command execution surfaces.' },
  { key: 'customize', label: 'Customize', description: 'Appearance and presentation settings for this agent.' },
];

export function getAgentPanelTabs(agent: OfficeAgent): AgentPanelTab[] {
  const tabs = [...BASE_TABS];
  if (agent.providerType === 'openswan' || agent.providerType === 'blackswan-local') {
    tabs.splice(7, 0, { key: 'openswan', label: 'Runtime', description: 'BlackSwan and OpenSwan runtime controls, coding sessions, delegation, and automation.' });
  }
  return tabs;
}

export function getFallbackAgentPanelTab(agent: OfficeAgent, currentTab: AgentPanelTabKey): AgentPanelTabKey {
  const tabs = getAgentPanelTabs(agent);
  return tabs.some(tab => tab.key === currentTab) ? currentTab : tabs[0]?.key || 'overview';
}
