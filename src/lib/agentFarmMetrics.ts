// Agent Farm Metrics & Analytics System
import { OfficeAgent } from './officeAgents';
import { OpenSwanSession } from './openswanService';

// ─── Performance Scoring ────────────────────────────────────────────

export interface AgentPerformanceScore {
  agentId: string;
  overall: number; // 0-100
  breakdown: {
    reliability: number; // uptime, error rate
    efficiency: number; // tokens/task, cost/output
    productivity: number; // tasks completed, response time
    quality: number; // success rate, retry count
  };
  trend: 'improving' | 'declining' | 'stable';
  rank: number;
  grade: 'S' | 'A' | 'B' | 'C' | 'D' | 'F';
}

export function calculateAgentScore(
  agent: OfficeAgent,
  sessions: OpenSwanSession[],
  allAgents: OfficeAgent[],
): AgentPerformanceScore {
  // Find sessions for this agent (sessions are per-response, match by agentId)
  const agentSessions = sessions.filter(s => s.agentId === agent.id || s.agentId === agent.name);
  // Create an aggregate session for compatibility with downstream functions
  const session = agentSessions.length > 0 ? {
    ...agentSessions[0],
    turns: agentSessions.length,
    totalCost: agentSessions.reduce((sum, s) => sum + (s.totalCost || 0), 0),
    totalInputTokens: agentSessions.reduce((sum, s) => sum + (s.totalInputTokens || 0), 0),
    totalOutputTokens: agentSessions.reduce((sum, s) => sum + (s.totalOutputTokens || 0), 0),
  } : undefined;

  // Reliability: Based on status and uptime
  const reliability = calculateReliability(agent);

  // Efficiency: Tokens per message, cost efficiency
  const efficiency = calculateEfficiency(agent, session);

  // Productivity: Messages processed, response speed
  const productivity = calculateProductivity(agent, session);

  // Quality: Error rate, successful completions
  const quality = calculateQuality(agent, session);

  // Overall score (weighted average)
  const overall = Math.round(
    reliability * 0.3 +
    efficiency * 0.25 +
    productivity * 0.25 +
    quality * 0.2
  );

  // Determine trend (would need historical data - simplified for now)
  const trend: 'improving' | 'declining' | 'stable' = 'stable';

  // Calculate rank among all agents
  const scores = allAgents.map(a => {
    const aSessions = sessions.filter(ses => ses.agentId === a.id || ses.agentId === a.name);
    const s = aSessions.length > 0 ? { ...aSessions[0], turns: aSessions.length, totalCost: aSessions.reduce((sum, ses) => sum + (ses.totalCost || 0), 0) } : undefined;
    return calculateOverallScore(a, s);
  }).sort((a, b) => b - a);
  const rank = scores.indexOf(overall) + 1;

  // Assign grade
  const grade = overall >= 90 ? 'S' : overall >= 80 ? 'A' : overall >= 70 ? 'B' : overall >= 60 ? 'C' : overall >= 50 ? 'D' : 'F';

  return {
    agentId: agent.id,
    overall,
    breakdown: { reliability, efficiency, productivity, quality },
    trend,
    rank,
    grade,
  };
}

function calculateOverallScore(agent: OfficeAgent, session?: OpenSwanSession): number {
  const reliability = calculateReliability(agent);
  const efficiency = calculateEfficiency(agent, session);
  const productivity = calculateProductivity(agent, session);
  const quality = calculateQuality(agent, session);
  return Math.round(
    reliability * 0.3 +
    efficiency * 0.25 +
    productivity * 0.25 +
    quality * 0.2
  );
}

function calculateReliability(agent: OfficeAgent): number {
  // Base score on status
  let score = 0;
  if (agent.status === 'active') score = 100;
  else if (agent.status === 'idle') score = 80;
  else if (agent.status === 'error') score = 30;
  else score = 0; // offline

  // Adjust for uptime
  if (agent.uptimeHours > 24) score = Math.min(100, score + 10);
  if (agent.uptimeHours < 1) score = Math.max(0, score - 20);

  return Math.min(100, Math.max(0, score));
}

function calculateEfficiency(agent: OfficeAgent, session?: OpenSwanSession): number {
  if (!session) return 50; // Default neutral score

  // Calculate tokens per message
  const tokensPerMessage = agent.messagesProcessed > 0
    ? agent.tokensUsed / agent.messagesProcessed
    : 0;

  // Lower tokens per message = more efficient
  // Assume 1000 tokens/msg is baseline, score inversely
  let efficiencyScore = 100;
  if (tokensPerMessage > 0) {
    const ratio = tokensPerMessage / 1000;
    efficiencyScore = Math.max(0, Math.min(100, 100 - (ratio - 1) * 50));
  }

  // Factor in cost efficiency
  const costPerMessage = agent.messagesProcessed > 0
    ? agent.costToday / agent.messagesProcessed
    : 0;

  if (costPerMessage > 0) {
    // Lower cost per message = better efficiency
    const costRatio = costPerMessage / 0.10; // Assume $0.10/msg is baseline
    const costScore = Math.max(0, Math.min(100, 100 - (costRatio - 1) * 50));
    efficiencyScore = (efficiencyScore + costScore) / 2;
  }

  return Math.round(efficiencyScore);
}

function calculateProductivity(agent: OfficeAgent, session?: OpenSwanSession): number {
  // Base on messages processed
  let score = Math.min(100, agent.messagesProcessed * 2); // Cap at 50 messages = 100

  // Bonus for recent activity
  if (agent.status === 'active') score = Math.min(100, score + 20);

  // Penalty for no activity
  if (agent.messagesProcessed === 0) score = 0;

  return Math.round(score);
}

function calculateQuality(agent: OfficeAgent, session?: OpenSwanSession): number {
  // Default to good quality (70) unless we have error signals
  let score = 70;

  // Penalize error status
  if (agent.status === 'error') score = 20;

  // Bonus for consistent activity
  if (agent.recentActions.length > 5) score = Math.min(100, score + 20);

  // Bonus for low error indicators (we'd need to track this separately)
  // For now, assume quality is good if agent is active and productive
  if (agent.status === 'active' && agent.messagesProcessed > 10) score = 90;

  return Math.round(score);
}

// ─── Farm-wide Metrics ──────────────────────────────────────────────

export interface FarmMetrics {
  totalAgents: number;
  activeAgents: number;
  idleAgents: number;
  errorAgents: number;
  offlineAgents: number;
  totalCostToday: number;
  totalCostWeek: number;
  totalTokensUsed: number;
  totalMessagesProcessed: number;
  averageScore: number;
  topPerformer: {
    agent: OfficeAgent;
    score: number;
  } | null;
  bottleneck: {
    agent: OfficeAgent;
    reason: string;
  } | null;
  healthStatus: 'excellent' | 'good' | 'fair' | 'poor' | 'critical';
}

export function calculateFarmMetrics(
  agents: OfficeAgent[],
  sessions: OpenSwanSession[],
): FarmMetrics {
  const scores = agents.map(a => calculateAgentScore(a, sessions, agents));

  const totalAgents = agents.length;
  const activeAgents = agents.filter(a => a.status === 'active').length;
  const idleAgents = agents.filter(a => a.status === 'idle').length;
  const errorAgents = agents.filter(a => a.status === 'error').length;
  const offlineAgents = agents.filter(a => a.status === 'offline').length;

  const totalCostToday = agents.reduce((sum, a) => sum + a.costToday, 0);
  const totalCostWeek = agents.reduce((sum, a) => sum + a.costWeek, 0);
  const totalTokensUsed = agents.reduce((sum, a) => sum + a.tokensUsed, 0);
  const totalMessagesProcessed = agents.reduce((sum, a) => sum + a.messagesProcessed, 0);

  const averageScore = scores.length > 0
    ? Math.round(scores.reduce((sum, s) => sum + s.overall, 0) / scores.length)
    : 0;

  // Find top performer
  const topScore = scores.length > 0
    ? scores.reduce((max, s) => s.overall > max.overall ? s : max, scores[0])
    : null;
  const topPerformer = topScore
    ? {
        agent: agents.find(a => a.id === topScore.agentId)!,
        score: topScore.overall,
      }
    : null;

  // Find bottleneck (lowest score or error state)
  const errorAgent = agents.find(a => a.status === 'error');
  const lowestScore = scores.length > 0
    ? scores.reduce((min, s) => s.overall < min.overall ? s : min, scores[0])
    : null;

  const bottleneck = errorAgent
    ? { agent: errorAgent, reason: 'Agent in error state' }
    : lowestScore && lowestScore.overall < 50
    ? { agent: agents.find(a => a.id === lowestScore.agentId)!, reason: `Low performance score: ${lowestScore.overall}` }
    : null;

  // Overall health status
  const healthStatus =
    errorAgents > 0 ? 'critical' :
    averageScore >= 80 ? 'excellent' :
    averageScore >= 70 ? 'good' :
    averageScore >= 60 ? 'fair' :
    'poor';

  return {
    totalAgents,
    activeAgents,
    idleAgents,
    errorAgents,
    offlineAgents,
    totalCostToday,
    totalCostWeek,
    totalTokensUsed,
    totalMessagesProcessed,
    averageScore,
    topPerformer,
    bottleneck,
    healthStatus,
  };
}

// ─── Workload Distribution ──────────────────────────────────────────

export interface AgentWorkload {
  agentId: string;
  agentName: string;
  currentLoad: number; // 0-100
  tasksInProgress: number;
  tasksPending: number;
  estimatedCapacity: number; // tasks/hour
  recommendedAction: 'add_tasks' | 'optimal' | 'overloaded';
}

export function analyzeWorkloadDistribution(agents: OfficeAgent[]): AgentWorkload[] {
  return agents.map(agent => {
    // Estimate current load based on messages processed and status
    let currentLoad = 0;
    if (agent.status === 'active') {
      // Simple heuristic: more recent actions = higher load
      currentLoad = Math.min(100, agent.recentActions.length * 10 + 30);
    } else if (agent.status === 'idle') {
      currentLoad = 20;
    } else {
      currentLoad = 0;
    }

    // Estimate capacity (simplified - would need historical data)
    const estimatedCapacity = agent.messagesProcessed > 0
      ? Math.round(agent.messagesProcessed / (agent.uptimeHours || 1))
      : 10; // Default assumption

    const recommendedAction =
      currentLoad < 50 ? 'add_tasks' :
      currentLoad > 85 ? 'overloaded' :
      'optimal';

    return {
      agentId: agent.id,
      agentName: agent.name,
      currentLoad,
      tasksInProgress: agent.status === 'active' ? agent.recentActions.length : 0,
      tasksPending: 0, // Would need task queue data
      estimatedCapacity,
      recommendedAction,
    };
  });
}

// ─── Cost Optimization Suggestions ──────────────────────────────────

export interface CostOptimization {
  type: 'model_downgrade' | 'consolidate_agents' | 'archive_inactive' | 'batch_tasks';
  agentId?: string;
  currentCost: number;
  potentialSavings: number;
  recommendation: string;
  priority: 'high' | 'medium' | 'low';
}

export function generateCostOptimizations(
  agents: OfficeAgent[],
  sessions: OpenSwanSession[],
): CostOptimization[] {
  const optimizations: CostOptimization[] = [];

  // Find agents using expensive models with low complexity needs
  for (const agent of agents) {
    if (agent.model.includes('opus') && agent.costToday > 1.0) {
      // Check if they're doing simple tasks
      if (agent.tokensUsed / Math.max(1, agent.messagesProcessed) < 2000) {
        optimizations.push({
          type: 'model_downgrade',
          agentId: agent.id,
          currentCost: agent.costToday,
          potentialSavings: agent.costToday * 0.8, // 80% savings switching opus->sonnet
          recommendation: `Switch ${agent.name} from Opus to Sonnet - their tasks average <2K tokens, Sonnet would be 80% cheaper`,
          priority: 'high',
        });
      }
    }
  }

  // Find inactive agents
  const inactiveAgents = agents.filter(a =>
    a.status === 'offline' || (a.status === 'idle' && a.messagesProcessed === 0)
  );
  if (inactiveAgents.length > 0) {
    optimizations.push({
      type: 'archive_inactive',
      currentCost: inactiveAgents.reduce((sum, a) => sum + a.costToday, 0),
      potentialSavings: inactiveAgents.reduce((sum, a) => sum + a.costToday, 0),
      recommendation: `Archive ${inactiveAgents.length} inactive agent${inactiveAgents.length !== 1 ? 's' : ''}: ${inactiveAgents.map(a => a.name).join(', ')}`,
      priority: 'medium',
    });
  }

  // Find agents with duplicate roles (consolidation opportunity)
  const roleGroups = new Map<string, OfficeAgent[]>();
  agents.forEach(a => {
    const group = roleGroups.get(a.role) || [];
    group.push(a);
    roleGroups.set(a.role, group);
  });

  for (const [role, group] of roleGroups) {
    if (group.length > 2 && group.some(a => a.messagesProcessed < 10)) {
      // Multiple agents in same role, some underutilized
      const underutilized = group.filter(a => a.messagesProcessed < 10);
      optimizations.push({
        type: 'consolidate_agents',
        currentCost: underutilized.reduce((sum, a) => sum + a.costToday, 0),
        potentialSavings: underutilized.reduce((sum, a) => sum + a.costToday, 0) * 0.7,
        recommendation: `Consolidate ${group.length} agents with role "${role}" - ${underutilized.length} are underutilized`,
        priority: 'low',
      });
    }
  }

  return optimizations.sort((a, b) => {
    const priorityOrder = { high: 3, medium: 2, low: 1 };
    return priorityOrder[b.priority] - priorityOrder[a.priority];
  });
}

// ─── Agent Specialization Tracker ──────────────────────────────────

export interface AgentSpecialization {
  agentId: string;
  expertise: {
    domain: string;
    confidence: number; // 0-100
    tasksCompleted: number;
  }[];
  recommendedFor: string[]; // task types this agent should get
}

export function analyzeAgentSpecialization(
  agent: OfficeAgent,
  historicalTasks?: any[], // Would need task history
): AgentSpecialization {
  // Simplified - would analyze actual task history
  const expertise = [];

  // Infer from agent role
  if (agent.role.toLowerCase().includes('dev') || agent.role.toLowerCase().includes('code')) {
    expertise.push({ domain: 'coding', confidence: 80, tasksCompleted: agent.messagesProcessed });
  }
  if (agent.role.toLowerCase().includes('test')) {
    expertise.push({ domain: 'testing', confidence: 75, tasksCompleted: agent.messagesProcessed });
  }
  if (agent.role.toLowerCase().includes('doc')) {
    expertise.push({ domain: 'documentation', confidence: 70, tasksCompleted: agent.messagesProcessed });
  }

  // Default to generalist if no specific role
  if (expertise.length === 0) {
    expertise.push({ domain: 'general', confidence: 60, tasksCompleted: agent.messagesProcessed });
  }

  const recommendedFor = expertise
    .filter(e => e.confidence > 70)
    .map(e => e.domain);

  return {
    agentId: agent.id,
    expertise,
    recommendedFor,
  };
}

// ─── Health Checks ──────────────────────────────────────────────────

export interface HealthCheck {
  passed: boolean;
  issues: {
    severity: 'critical' | 'warning' | 'info';
    message: string;
    agentId?: string;
  }[];
}

export function performHealthCheck(agents: OfficeAgent[], sessions: OpenSwanSession[]): HealthCheck {
  const issues: HealthCheck['issues'] = [];

  // Check for error agents
  const errorAgents = agents.filter(a => a.status === 'error');
  errorAgents.forEach(a => {
    issues.push({
      severity: 'critical',
      message: `Agent ${a.name} is in error state`,
      agentId: a.id,
    });
  });

  // Check for high costs
  const highCostAgents = agents.filter(a => a.costToday > 10);
  highCostAgents.forEach(a => {
    issues.push({
      severity: 'warning',
      message: `Agent ${a.name} has high daily cost: $${a.costToday.toFixed(2)}`,
      agentId: a.id,
    });
  });

  // Check for stale agents (no activity)
  const staleAgents = agents.filter(a =>
    a.status === 'idle' && a.messagesProcessed === 0
  );
  if (staleAgents.length > 0) {
    issues.push({
      severity: 'info',
      message: `${staleAgents.length} agent${staleAgents.length !== 1 ? 's' : ''} have no activity yet`,
    });
  }

  // Check overall farm health
  const activeCount = agents.filter(a => a.status === 'active').length;
  const totalCount = agents.length;
  if (totalCount > 0 && activeCount / totalCount < 0.5) {
    issues.push({
      severity: 'warning',
      message: `Less than 50% of agents are active (${activeCount}/${totalCount})`,
    });
  }

  return {
    passed: issues.filter(i => i.severity === 'critical').length === 0,
    issues: issues.sort((a, b) => {
      const severityOrder = { critical: 3, warning: 2, info: 1 };
      return severityOrder[b.severity] - severityOrder[a.severity];
    }),
  };
}
