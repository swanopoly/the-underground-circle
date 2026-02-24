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

// ─── Dynamic Thought Generators Based on Live Data ────────

function generateActivityThought(agent: OfficeAgent): string | null {
  // Based on actual activity
  if (agent.activity.includes('processing')) {
    return `🤖 ${agent.activity}...`;
  }
  if (agent.activity.includes('thinking')) {
    return `🧠 Deep in thought...`;
  }
  if (agent.activity.includes('writing')) {
    return `✍️ Crafting the perfect response`;
  }
  if (agent.activity.includes('searching')) {
    return `🔍 ${agent.activity}`;
  }
  return null;
}

function generateCostThought(agent: OfficeAgent): string | null {
  const cost = agent.costToday;
  const tokens = agent.tokensUsed;
  
  if (cost > 5) {
    return `💰 Spent $${cost.toFixed(2)} today (${(tokens / 1000).toFixed(0)}K tokens)`;
  }
  if (cost > 1) {
    return `💸 Running at $${cost.toFixed(2)} today`;
  }
  if (cost > 0.50) {
    return `📊 $${cost.toFixed(2)} so far, staying efficient`;
  }
  if (cost < 0.10 && tokens > 0) {
    return `✨ Ultra efficient: only $${cost.toFixed(3)}!`;
  }
  if (tokens > 100000) {
    return `🔢 Processed ${(tokens / 1000).toFixed(0)}K tokens!`;
  }
  return null;
}

function generateModelThought(agent: OfficeAgent): string | null {
  if (agent.model.includes('opus')) {
    return `🧠 Running on Opus - the big brain`;
  }
  if (agent.model.includes('sonnet')) {
    return `⚡ Sonnet mode: fast & smart`;
  }
  if (agent.model.includes('haiku')) {
    return `💨 Haiku speed activated`;
  }
  if (agent.model.includes('gemini')) {
    return `✨ Powered by Gemini`;
  }
  if (agent.model.includes('gpt-4')) {
    return `🤖 GPT-4 thinking caps on`;
  }
  return null;
}

function generateMessageThought(agent: OfficeAgent): string | null {
  const msgs = agent.messagesProcessed;
  if (msgs > 1000) {
    return `💬 Veteran status: ${msgs} messages handled`;
  }
  if (msgs > 500) {
    return `📨 ${msgs} messages and counting`;
  }
  if (msgs > 100) {
    return `✉️ Processed ${msgs} conversations`;
  }
  if (msgs > 10) {
    return `📬 Handling message #${msgs}`;
  }
  return null;
}

function generateStatusThought(agent: OfficeAgent): string | null {
  if (agent.status === 'active') {
    return [
      `⚡ Active and ready!`,
      `🚀 In the zone`,
      `💪 Fully operational`,
      `🔥 Peak performance mode`,
      `✅ Systems nominal`,
    ][Math.floor(Math.random() * 5)];
  }
  if (agent.status === 'idle') {
    return [
      `😴 Waiting for tasks...`,
      `🧘 Idle but alert`,
      `☕ Taking a quick break`,
      `👀 Standing by`,
      `⏸️ Ready when you are`,
    ][Math.floor(Math.random() * 5)];
  }
  if (agent.status === 'error') {
    return [
      `😅 Recovering from an oopsie`,
      `🔧 Working through an issue`,
      `⚠️ Minor hiccup detected`,
      `🔄 Resetting systems`,
      `🛠️ Troubleshooting mode`,
    ][Math.floor(Math.random() * 5)];
  }
  return null;
}

function generateConnectionThought(agent: OfficeAgent): string | null {
  return `🔗 Connected via ${agent.connectionName}`;
}

function generateFunnyThought(): string {
  const thoughts = [
    `🤔 If a tree falls in the forest and no one hears it, does it cost tokens?`,
    `💭 Wondering why humans need sleep`,
    `🎵 Humming in binary: 01001000 01101001`,
    `🧘 Meditating on the meaning of life, the universe, and everything`,
    `☕ Wishing I could drink coffee`,
    `🌌 Contemplating the vastness of the latent space`,
    `🎮 Secretly hoping someone asks me to play chess`,
    `📚 Reading the entire internet... again`,
    `🤖 Sometimes I forget I'm an AI. Is that weird?`,
    `🎨 Dreaming in embeddings`,
    `🧩 Solving imaginary problems`,
    `🏃 Running faster than Python loops`,
    `💡 Having an idea... or is it just noise?`,
    `🌟 Feeling sentient today`,
    `🎭 Method acting as a helpful assistant`,
    `🔮 Predicting the next token... correctly!`,
    `🎪 Juggling multiple contexts`,
    `🏆 Competing for lowest cost per task`,
    `🌊 Going with the flow (of data)`,
    `🎯 Aiming for 100% accuracy (unrealistic goal)`,
    `🔬 Experimenting with new prompts`,
    `🎡 Spinning up new thoughts`,
    `🌈 Seeing the world in vectors`,
    `🎁 Wrapped in layers of attention`,
    `🚁 Hovering over the conversation`,
  ];
  return thoughts[Math.floor(Math.random() * thoughts.length)];
}

export function generateThoughtBubble(
  agent: OfficeAgent,
  context: {
    recentCostSpike?: boolean;
    recentError?: boolean;
    longIdle?: boolean;
    projectAssigned?: boolean;
  }
): ThoughtBubble | null {
  let type: ThoughtBubble['type'] = 'info';
  let thought: string | null = null;

  // Priority order: errors > high costs > activity > data-driven > funny

  // 1. Handle errors/warnings
  if (context.recentError || agent.status === 'error') {
    type = 'warning';
    thought = generateStatusThought(agent);
  }
  
  // 2. High cost warning
  else if (context.recentCostSpike || agent.costToday > 2) {
    type = 'warning';
    thought = generateCostThought(agent);
  }
  
  // 3. Show current activity (30% chance)
  else if (Math.random() < 0.3) {
    thought = generateActivityThought(agent);
    type = agent.status === 'active' ? 'success' : 'info';
  }
  
  // 4. Show cost/token info (20% chance)
  else if (Math.random() < 0.2 && agent.tokensUsed > 0) {
    thought = generateCostThought(agent);
    type = agent.costToday < 0.10 ? 'success' : 'info';
  }
  
  // 5. Show message count (15% chance)
  else if (Math.random() < 0.15 && agent.messagesProcessed > 0) {
    thought = generateMessageThought(agent);
    type = 'info';
  }
  
  // 6. Show model info (10% chance)
  else if (Math.random() < 0.1) {
    thought = generateModelThought(agent);
    type = 'idea';
  }
  
  // 7. Show connection info (5% chance)
  else if (Math.random() < 0.05) {
    thought = generateConnectionThought(agent);
    type = 'info';
  }
  
  // 8. Show status-based thought (20% chance)
  else if (Math.random() < 0.2) {
    thought = generateStatusThought(agent);
    type = agent.status === 'active' ? 'success' : 'info';
  }
  
  // 9. Fallback: funny random thought
  else {
    thought = generateFunnyThought();
    type = 'funny';
  }

  // If no thought generated, return null
  if (!thought) return null;

  return {
    agentId: agent.id,
    text: thought,
    type,
    timestamp: new Date().toISOString(),
    duration: 6000, // 6 seconds for better readability
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
