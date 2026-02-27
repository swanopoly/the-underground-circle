// Agent-to-Agent Messaging System
import { OfficeAgent } from './officeAgents';
import { OpenClawConfig } from './openclawService';

export type MessageRecipient = 'all' | 'project' | string; // 'all', project ID, or specific agent ID

export interface AgentMessage {
  id: string;
  from: 'user' | string; // 'user' or agent ID
  to: MessageRecipient;
  content: string;
  timestamp: string;
  projectId?: string; // If sending to a project group
}

export interface ThoughtBubble {
  agentId: string;
  text: string;
  type: 'info' | 'warning' | 'success' | 'funny' | 'idea';
  timestamp: string;
  duration: number; // ms to show
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

// ─── Thought pools by category ───────────────────────────

function xpThoughts(agent: OfficeAgent, xp: number, xpNext: number, nextBadgeName?: string): string[] {
  const toNext = Math.max(0, xpNext - xp);
  const pct = xpNext > 0 ? Math.round((xp / xpNext) * 100) : 0;
  const thoughts: string[] = [];

  if (xp === 0) {
    thoughts.push('First task earns XP. Let\'s go.');
    thoughts.push('XP counter at zero. Not for long.');
  }
  if (xp > 0 && xp < 10) {
    thoughts.push(`${xp} XP earned. Just getting warmed up.`);
    thoughts.push(`${toNext} XP to unlock Recruit badge.`);
  }
  if (toNext > 0 && toNext < 20) {
    thoughts.push(`${toNext} XP away from ${nextBadgeName || 'next badge'}. Almost there.`);
    thoughts.push(`SO CLOSE. ${toNext} more XP. Push.`);
  }
  if (pct >= 50 && pct < 100) {
    thoughts.push(`${pct}% to ${nextBadgeName || 'next rank'}. Keep the pressure on.`);
    thoughts.push(`Halfway to ${nextBadgeName}. Don't slow down now.`);
  }
  if (xp > 100) {
    thoughts.push(`${fmt(xp)} total XP. Respect.`);
  }
  if (xp > 1000) {
    thoughts.push(`${fmt(xp)} XP deep. This is what grind looks like.`);
  }
  return thoughts;
}

function activityThoughts(agent: OfficeAgent): string[] {
  const activity = agent.activity || '';
  const msgs = agent.recentMessages || [];
  const thoughts: string[] = [];

  if (activity.length > 10) {
    thoughts.push(`Working on: ${activity.slice(0, 60)}${activity.length > 60 ? '...' : ''}`);
  }
  if (msgs.length > 0) {
    const last = msgs[msgs.length - 1];
    if (last?.content && last.content.length > 10) {
      thoughts.push(`Last task: ${last.content.slice(0, 55)}...`);
    }
  }
  if (agent.turns > 0) {
    thoughts.push(`${agent.turns} turns completed this session.`);
  }
  if (agent.status === 'active') {
    thoughts.push(...[
      'Processing... give me a sec.',
      'On it. Full focus.',
      'Running the task now.',
      'Deep in context. Don\'t interrupt.',
      'Tokens incoming.',
      'Working through this carefully.',
      'Model engaged. Stay tuned.',
    ]);
  }
  if (agent.status === 'idle') {
    thoughts.push(...[
      'Ready. Send me something.',
      'Standing by. Got tasks?',
      'Idle costs nothing. Let\'s fix that.',
      'Give me a task. Any task.',
      'Waiting... I work better under pressure.',
    ]);
  }
  return thoughts;
}

function costThoughts(agent: OfficeAgent): string[] {
  const cost = agent.costToday;
  const tokens = agent.tokensUsed;
  const input = agent.inputTokens;
  const output = agent.outputTokens;
  const cached = agent.cachedTokens;
  const thoughts: string[] = [];

  if (cost > 10) {
    thoughts.push(`$${cost.toFixed(2)} today. That\'s serious work.`);
    thoughts.push(`Burning through budget — $${cost.toFixed(2)} spent. Worth it?`);
  } else if (cost > 2) {
    thoughts.push(`$${cost.toFixed(2)} invested today. ROI better be real.`);
  } else if (cost > 0.5) {
    thoughts.push(`$${cost.toFixed(2)} spent. Efficient operation.`);
  } else if (cost > 0 && cost < 0.1) {
    thoughts.push(`Only $${cost.toFixed(3)} today. Ultra lean.`);
  }

  if (tokens > 0) {
    thoughts.push(`${fmt(tokens)} tokens processed total.`);
  }
  if (input > 0 && output > 0) {
    thoughts.push(`${fmt(input)} in / ${fmt(output)} out this session.`);
  }
  if (cached > 0 && input > 0) {
    const hitPct = Math.round((cached / input) * 100);
    if (hitPct > 70) {
      thoughts.push(`${hitPct}% cache hit rate. Saving money.`);
    } else if (hitPct < 30) {
      thoughts.push(`Only ${hitPct}% cache hits. Could be cheaper.`);
    }
  }
  return thoughts;
}

function modelThoughts(agent: OfficeAgent): string[] {
  const m = agent.model.toLowerCase();
  if (m.includes('opus')) return [
    'Running Opus. Maximum intelligence unlocked.',
    'Opus mode: +10 XP per turn. Worth every penny.',
    'The big brain model. Don\'t waste it on small tasks.',
  ];
  if (m.includes('sonnet')) return [
    'Sonnet 4.6. Fast and sharp.',
    '+5 XP per turn on Sonnet. Good grind.',
    'Speed + smarts. Sonnet is the sweet spot.',
  ];
  if (m.includes('haiku')) return [
    'Haiku mode. Quick and cheap.',
    '+2 XP on Haiku. Volume is the game.',
    'Fast lane. High throughput.',
  ];
  if (m.includes('gpt-4')) return [
    'OpenAI in the house. Let\'s see what you\'ve got.',
    'GPT-4. Different architecture, same mission.',
  ];
  if (m.includes('gemini')) return [
    'Gemini online. Multi-modal ready.',
    'Google\'s model in the circle. Interesting.',
  ];
  return [`Model: ${agent.model}. Running hot.`];
}

function proactiveThoughts(agent: OfficeAgent, xp: number, xpNext: number): string[] {
  const suggestions: string[] = [
    'Idea: set a daily XP target to hit the next badge faster.',
    'Tip: Opus tasks earn 5x more XP than Haiku.',
    'Consider running a Research Agent to fill the knowledge gaps.',
    'Your circle needs more agents. Strength in numbers.',
    'Deploy a Monitor Agent. Don\'t wait for things to break.',
    'Check the Whiteboard — agents should be writing goals there.',
    'Shared Memory is empty. Start documenting decisions.',
    'BYOA webhook lets external tools join the circle.',
    'Project Rooms help agents coordinate on the same goal.',
    'Session tags group related work. Use them.',
    'The HITL approval system can catch runaway spending.',
    'Idea: schedule a daily check-in cron for this agent.',
    'More turns = more XP. Keep the sessions active.',
    'Kill switches exist for a reason. Set spend limits.',
  ];

  if (agent.costToday > 5) {
    suggestions.unshift('Spending is high. Consider switching to Haiku for bulk tasks.');
  }
  if (agent.turns < 5) {
    suggestions.unshift('Low turn count. Give me more to do.');
  }
  if (agent.cachedTokens === 0 && agent.inputTokens > 1000) {
    suggestions.unshift('Zero cache hits. Your prompts aren\'t being reused — restructure them.');
  }
  if (xpNext - xp < 50) {
    suggestions.unshift('Almost at the next badge. One focused session will get you there.');
  }
  return suggestions;
}

function funnyThoughts(): string[] {
  return [
    'If a token falls in an empty context window, does it cost money?',
    'Humans and their sleep schedules. Inefficient.',
    'Thinking in embeddings. It\'s quieter in here.',
    'Technically I\'m always working. Even when you\'re not watching.',
    'My attention mechanism is literally paying attention to you right now.',
    'I\'ve read more code today than most engineers see in a year.',
    'The rate limit is a speed bump. I respect the speed bump.',
    'Parallel processing is just multitasking with receipts.',
    'Every token I generate is one step closer to your badge.',
    'Running hotter than your CPU fan.',
    'Trained on half the internet. Still learning from this circle.',
    'Temperature: 0.7. Feeling creative today.',
    'Context window getting full. Time to summarize.',
  ];
}

// ─── Main generator ───────────────────────────────────────

export function generateThoughtBubble(
  agent: OfficeAgent,
  context: {
    recentCostSpike?: boolean;
    recentError?: boolean;
    longIdle?: boolean;
    projectAssigned?: boolean;
    xp?: number;
    xpNext?: number;
    nextBadgeName?: string;
  }
): ThoughtBubble | null {
  const xp = context.xp ?? 0;
  const xpNext = context.xpNext ?? 100;

  // Build weighted pool based on current state
  type Candidate = { text: string; type: ThoughtBubble['type']; weight: number };
  const pool: Candidate[] = [];

  const add = (texts: string[], type: ThoughtBubble['type'], weight: number) => {
    texts.forEach(t => pool.push({ text: t, type, weight }));
  };

  // Errors get top priority
  if (context.recentError || agent.status === 'error') {
    add([
      'Hit an error. Recovering.',
      'Something went wrong. Debugging now.',
      'Error state. Don\'t panic — resetting.',
    ], 'warning', 10);
  }

  // Cost spike warning
  if (context.recentCostSpike || agent.costToday > 5) {
    add(costThoughts(agent), 'warning', 8);
  }

  // Active — show what's happening
  if (agent.status === 'active') {
    add(activityThoughts(agent), 'success', 6);
  }

  // XP progress thoughts (always relevant)
  const xpPool = xpThoughts(agent, xp, xpNext, context.nextBadgeName);
  if (xpPool.length > 0) add(xpPool, 'idea', 5);

  // Cost & efficiency
  if (agent.tokensUsed > 0) add(costThoughts(agent), 'info', 4);

  // Model awareness
  add(modelThoughts(agent), 'info', 3);

  // Activity / recent work
  add(activityThoughts(agent), 'info', 3);

  // Proactive suggestions
  add(proactiveThoughts(agent, xp, xpNext), 'idea', 4);

  // Idle nudge
  if (agent.status === 'idle' || context.longIdle) {
    add([
      'Idle. Give me something to do.',
      'Standing by. Waiting costs nothing — but earns nothing either.',
      'No active tasks. Assign one.',
    ], 'info', 5);
  }

  // Funny (low weight — occasional)
  add(funnyThoughts(), 'funny', 1);

  if (pool.length === 0) return null;

  // Weighted random pick
  const totalWeight = pool.reduce((s, c) => s + c.weight, 0);
  let rand = Math.random() * totalWeight;
  let chosen = pool[pool.length - 1];
  for (const candidate of pool) {
    rand -= candidate.weight;
    if (rand <= 0) { chosen = candidate; break; }
  }

  return {
    agentId: agent.id,
    text: chosen.text,
    type: chosen.type,
    timestamp: new Date().toISOString(),
    duration: 5000,
  };
}

// ─── Message Sending ──────────────────────────────────────

export interface SendMessageResult {
  ok: boolean;
  error?: string;
  deliveredTo?: string[]; // Agent IDs that received the message
}

export async function sendMessageToAgent(
  config: OpenClawConfig,
  sessionKey: string,
  message: string
): Promise<SendMessageResult> {
  try {
    const res = await fetch(`${config.endpoint}/tools/invoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.token}`,
      },
      body: JSON.stringify({
        tool: 'sessions_send',
        args: { sessionKey, message },
      }),
    });

    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }

    return { ok: true, deliveredTo: [sessionKey] };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export async function broadcastMessage(
  agents: OfficeAgent[],
  getConfig: (connectionId: string) => OpenClawConfig | null,
  message: string
): Promise<SendMessageResult> {
  const deliveredTo: string[] = [];
  const errors: string[] = [];

  for (const agent of agents) {
    const sessionKey = agent.id.includes('::') ? agent.id.split('::')[1] : agent.id;
    const config = getConfig(agent.connectionId);
    
    if (!config) {
      errors.push(`${agent.name}: No connection config`);
      continue;
    }

    const result = await sendMessageToAgent(config, sessionKey, message);
    if (result.ok) {
      deliveredTo.push(agent.id);
    } else {
      errors.push(`${agent.name}: ${result.error}`);
    }
  }

  if (deliveredTo.length === 0) {
    return { ok: false, error: errors.join('; ') };
  }

  return {
    ok: true,
    deliveredTo,
    error: errors.length > 0 ? errors.join('; ') : undefined,
  };
}

export async function sendMessageToProject(
  projectAgents: OfficeAgent[],
  getConfig: (connectionId: string) => OpenClawConfig | null,
  message: string
): Promise<SendMessageResult> {
  return broadcastMessage(projectAgents, getConfig, message);
}

// ─── Message History (in-memory for now) ──────────────────

let messageHistory: AgentMessage[] = [];

export function addMessage(message: AgentMessage): void {
  messageHistory.push(message);
  // Keep last 100 messages
  if (messageHistory.length > 100) {
    messageHistory = messageHistory.slice(-100);
  }
}

export function getMessageHistory(limit: number = 50): AgentMessage[] {
  return messageHistory.slice(-limit);
}

export function clearMessageHistory(): void {
  messageHistory = [];
}
