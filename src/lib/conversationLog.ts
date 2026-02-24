// Conversation Log - Track messages sent to and from agents
import { getItem, setItem, removeItem } from './storage';

const STORAGE_KEY = '@office_conversation_log';

export interface ConversationMessage {
  id: string;
  timestamp: number;
  direction: 'outgoing' | 'incoming';
  agentId: string;
  agentName: string;
  agentColor: string;
  message: string;
  actionType?: string; // standup, sync, broadcast, etc.
  conversationId?: string;
  sessionKey?: string;
}

export interface ConversationThread {
  id: string;
  title: string;
  startedAt: number;
  participants: string[]; // agent IDs
  messages: ConversationMessage[];
  lastActivity: number;
}

// ─── Storage Functions ─────────────────────────────────────

export async function loadConversationLog(): Promise<ConversationMessage[]> {
  try {
    const raw = await getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (error) {
    console.error('Failed to load conversation log:', error);
    return [];
  }
}

export async function saveConversationLog(messages: ConversationMessage[]): Promise<void> {
  try {
    await setItem(STORAGE_KEY, JSON.stringify(messages));
  } catch (error) {
    console.error('Failed to save conversation log:', error);
  }
}

export async function addConversationMessage(message: Omit<ConversationMessage, 'id' | 'timestamp'>): Promise<ConversationMessage> {
  const messages = await loadConversationLog();
  
  const newMessage: ConversationMessage = {
    ...message,
    id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    timestamp: Date.now(),
  };

  messages.push(newMessage);

  // Keep only last 500 messages to avoid bloat
  const trimmed = messages.slice(-500);
  await saveConversationLog(trimmed);

  return newMessage;
}

export async function getRecentMessages(limit: number = 50): Promise<ConversationMessage[]> {
  const messages = await loadConversationLog();
  return messages.slice(-limit).reverse(); // Most recent first
}

export async function getMessagesByAgent(agentId: string, limit: number = 50): Promise<ConversationMessage[]> {
  const messages = await loadConversationLog();
  return messages
    .filter(m => m.agentId === agentId)
    .slice(-limit)
    .reverse();
}

export async function getMessagesByConversation(conversationId: string): Promise<ConversationMessage[]> {
  const messages = await loadConversationLog();
  return messages
    .filter(m => m.conversationId === conversationId)
    .sort((a, b) => a.timestamp - b.timestamp);
}

export async function clearConversationLog(): Promise<void> {
  await removeItem(STORAGE_KEY);
}

// ─── Conversation Threading ────────────────────────────────

export function groupMessagesByConversation(messages: ConversationMessage[]): ConversationThread[] {
  const threads = new Map<string, ConversationThread>();

  messages.forEach(msg => {
    const threadId = msg.conversationId || `agent_${msg.agentId}`;
    
    if (!threads.has(threadId)) {
      threads.set(threadId, {
        id: threadId,
        title: msg.actionType ? `${msg.actionType} - ${msg.agentName}` : msg.agentName,
        startedAt: msg.timestamp,
        participants: [msg.agentId],
        messages: [],
        lastActivity: msg.timestamp,
      });
    }

    const thread = threads.get(threadId)!;
    thread.messages.push(msg);
    thread.lastActivity = Math.max(thread.lastActivity, msg.timestamp);
    
    if (!thread.participants.includes(msg.agentId)) {
      thread.participants.push(msg.agentId);
    }
  });

  return Array.from(threads.values()).sort((a, b) => b.lastActivity - a.lastActivity);
}

// ─── Formatting Helpers ────────────────────────────────────

export function formatMessageForTerminal(msg: ConversationMessage): string {
  const time = new Date(msg.timestamp).toLocaleTimeString('en-US', { 
    hour: '2-digit', 
    minute: '2-digit',
    hour12: false,
  });
  
  const direction = msg.direction === 'outgoing' ? '→' : '←';
  const action = msg.actionType ? `[${msg.actionType}] ` : '';
  
  return `[${time}] ${direction} ${action}${msg.agentName}: ${msg.message}`;
}

export function formatThreadSummary(thread: ConversationThread): string {
  const msgCount = thread.messages.length;
  const lastMsg = thread.messages[thread.messages.length - 1];
  const time = new Date(thread.lastActivity).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  return `📋 ${thread.title} (${msgCount} msgs) | Last: ${time}`;
}
