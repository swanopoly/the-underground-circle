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

// ─── Funny Thought Generators ──────────────────────────────

const FUNNY_THOUGHTS = {
  idle: [
    "🤔 If a tree falls in the forest and no one hears it, does it still cost tokens?",
    "💭 Contemplating the meaning of 42... tokens",
    "☕ BRB, brewing some digital coffee",
    "🎵 Humming binary... 01001000 01101001",
    "🧘 Meditating on the blockchain",
  ],
  active: [
    "🔥 I'm on fire! (Metaphorically. Don't panic.)",
    "💪 Crushing it like a neural network crushes gradients",
    "🚀 To infinity and beyond! (But within budget)",
    "⚡ Faster than a GPU with unlimited VRAM",
    "🎯 Bullseye! Another task completed",
  ],
  error: [
    "😅 Oops, that wasn't supposed to happen",
    "🤦 I've made a huge mistake",
    "💀 Error 404: My confidence not found",
    "🆘 Help! I'm stuck in a loop!",
    "🔴 Red alert! But like, a friendly red alert",
  ],
  expensive: [
    "💸 That last call cost more than your coffee",
    "⚠️ Token meter going brrr",
    "💰 Cha-ching! Worth it though",
    "📈 My costs are trending... up",
    "🤑 I'm expensive but I'm worth it",
  ],
  efficient: [
    "✨ Optimized! Like a well-tuned F1 car",
    "🎉 That was cheap AND effective!",
    "💚 Green is my favorite color (low cost)",
    "🏆 Cost efficiency: 100",
    "😎 Smooth like butter, cheap like water",
  ],
};

const USEFUL_TIPS = [
  "💡 Tip: Use tags to track project costs",
  "📊 FYI: Your spending is up 20% today",
  "⏰ Reminder: Weekly budget at 75%",
  "🎯 Pro tip: Switch to Haiku for simple tasks",
  "📌 Note: 3 agents idle for 10+ minutes",
  "🔔 Heads up: New session started",
  "💾 Reminder: Export your data weekly",
  "🚀 Suggestion: Assign me to project 'Website'",
];

export function generateThoughtBubble(
  agent: OfficeAgent,
  context: {
    recentCostSpike?: boolean;
    recentError?: boolean;
    longIdle?: boolean;
    projectAssigned?: boolean;
  }
): ThoughtBubble | null {
  let type: ThoughtBubble['type'] = 'funny';
  let thoughts: string[] = [];

  // Priority: contextual thoughts
  if (context.recentError) {
    type = 'warning';
    thoughts = FUNNY_THOUGHTS.error;
  } else if (context.recentCostSpike) {
    type = 'warning';
    thoughts = FUNNY_THOUGHTS.expensive;
  } else if (context.longIdle) {
    type = 'info';
    thoughts = FUNNY_THOUGHTS.idle;
  } else if (agent.status === 'active') {
    type = 'success';
    thoughts = FUNNY_THOUGHTS.active;
  } else if (agent.costToday < 0.05) {
    type = 'success';
    thoughts = FUNNY_THOUGHTS.efficient;
  } else {
    // Random mix of funny and useful
    if (Math.random() > 0.5) {
      thoughts = USEFUL_TIPS;
      type = 'idea';
    } else {
      thoughts = FUNNY_THOUGHTS.idle;
      type = 'funny';
    }
  }

  if (thoughts.length === 0) return null;

  return {
    agentId: agent.id,
    text: thoughts[Math.floor(Math.random() * thoughts.length)],
    type,
    timestamp: new Date().toISOString(),
    duration: 5000, // 5 seconds
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
