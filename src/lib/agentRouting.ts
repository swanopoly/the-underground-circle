/**
 * Agent Routing — suggest the best agent for a task
 *
 * Scores agents based on:
 * - Completion rate (proof_of_work entries with agent_name)
 * - Recent activity (turns in last 7 days)
 * - Cost efficiency (tokens/dollar per successful run)
 * - Task keyword match against agent name/specialization
 *
 * Returns ranked list of agents with match scores.
 */
import { supabase } from './supabase';
import type { CircleOfficeAgent } from './circleOffice';

export interface AgentScore {
  agent: CircleOfficeAgent;
  score: number;              // 0-100 overall match score
  completionRate: number;     // 0-1 based on proof_of_work
  recentActivity: number;     // turns in last 7 days
  avgCost: number;            // cost per turn
  specialtyMatch: number;     // 0-1 keyword match
  reasons: string[];          // human-readable explanations
}

// Specialization keywords — agents with matching names get boost
const AGENT_SPECIALTIES: Record<string, string[]> = {
  code: ['code', 'build', 'implement', 'refactor', 'fix', 'debug', 'test', 'deploy'],
  research: ['research', 'find', 'investigate', 'analyze', 'study', 'compare', 'search'],
  write: ['write', 'draft', 'article', 'blog', 'content', 'copy', 'email'],
  review: ['review', 'check', 'audit', 'evaluate', 'critique', 'assess'],
  plan: ['plan', 'organize', 'schedule', 'roadmap', 'outline'],
  design: ['design', 'ui', 'ux', 'mockup', 'wireframe', 'layout'],
};

function matchesSpecialty(taskText: string, agentName: string): number {
  const task = taskText.toLowerCase();
  const name = agentName.toLowerCase();
  let score = 0;

  // Direct name match (e.g., "code review" + agent named "CodeReviewer")
  for (const word of task.split(/\s+/)) {
    if (word.length > 3 && name.includes(word)) score += 0.3;
  }

  // Specialty category match
  for (const [specialty, keywords] of Object.entries(AGENT_SPECIALTIES)) {
    const taskHasSpecialty = keywords.some(k => task.includes(k));
    const agentHasSpecialty = name.includes(specialty) || keywords.some(k => name.includes(k));
    if (taskHasSpecialty && agentHasSpecialty) score += 0.4;
  }

  return Math.min(1, score);
}

/**
 * Score and rank agents for a given task description.
 * Returns top matches with explanations.
 */
export async function suggestAgentsForTask(opts: {
  circleId: string;
  agents: CircleOfficeAgent[];
  taskTitle: string;
  taskDescription?: string;
  limit?: number;
}): Promise<AgentScore[]> {
  const { circleId, agents, taskTitle, taskDescription, limit = 3 } = opts;
  const taskText = `${taskTitle} ${taskDescription || ''}`.trim();

  if (agents.length === 0) return [];

  // Fetch completion stats from proof_of_work (last 30 days)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
  const { data: proofs } = await supabase
    .from('proof_of_work')
    .select('agent_name, pow_type')
    .eq('circle_id', circleId)
    .gte('created_at', thirtyDaysAgo)
    .not('agent_name', 'is', null);

  // Count completions per agent
  const completionCounts: Record<string, number> = {};
  (proofs || []).forEach(p => {
    if (p.agent_name) completionCounts[p.agent_name] = (completionCounts[p.agent_name] || 0) + 1;
  });

  const maxCompletions = Math.max(1, ...Object.values(completionCounts));

  // Score each agent
  const scored: AgentScore[] = agents.map(agent => {
    const reasons: string[] = [];

    // Completion rate (40% weight)
    const completions = completionCounts[agent.name] || 0;
    const completionRate = completions / maxCompletions;
    if (completions > 5) reasons.push(`${completions} recent completions`);

    // Recent activity (20% weight)
    const turns = (agent as any).turns || 0;
    const recentActivity = Math.min(1, turns / 20); // 20 turns = max
    if (turns >= 20) reasons.push(`highly active (${turns} turns)`);

    // Cost efficiency (15% weight) — lower cost per turn is better
    const costToday = (agent as any).cost_today || 0;
    const avgCost = turns > 0 ? costToday / turns : 0;
    const costScore = avgCost === 0 ? 0.5 : Math.max(0, 1 - avgCost * 10); // penalty above $0.10/turn
    if (avgCost > 0 && avgCost < 0.05) reasons.push('cost-efficient');

    // Specialty match (25% weight)
    const specialtyMatch = matchesSpecialty(taskText, agent.name);
    if (specialtyMatch > 0.5) reasons.push('name matches task');

    // Status bonus — active agents preferred
    const isActive = agent.status === 'active' || agent.status === 'idle' || agent.status === 'building';
    if (!isActive) reasons.push('offline');

    const score = Math.round(
      (completionRate * 40 +
       recentActivity * 20 +
       costScore * 15 +
       specialtyMatch * 25) * (isActive ? 1 : 0.3)
    );

    return { agent, score, completionRate, recentActivity, avgCost, specialtyMatch, reasons };
  });

  // Sort by score, return top N
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Get a single best-match agent for quick suggestions */
export async function suggestBestAgent(opts: {
  circleId: string;
  agents: CircleOfficeAgent[];
  taskTitle: string;
  taskDescription?: string;
}): Promise<AgentScore | null> {
  const results = await suggestAgentsForTask({ ...opts, limit: 1 });
  return results[0] || null;
}
