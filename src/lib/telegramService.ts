// Telegram Bot API integration for the Office Dashboard
// Users provide their own bot token + chat ID to connect

const BASE = 'https://api.telegram.org/bot';

export interface TelegramBot {
  id: number;
  first_name: string;
  username: string;
  is_bot: true;
}

export interface TelegramMessage {
  message_id: number;
  from?: { id: number; first_name: string; username?: string; is_bot: boolean };
  chat: { id: number; title?: string; type: string };
  date: number;
  text?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

export interface TelegramStatus {
  connected: boolean;
  bot: TelegramBot | null;
  chatTitle: string | null;
  messageCount: number;
  lastActivity: string | null;
  error: string | null;
}

const EMPTY_STATUS: TelegramStatus = {
  connected: false,
  bot: null,
  chatTitle: null,
  messageCount: 0,
  lastActivity: null,
  error: null,
};

// Validate bot token and return bot info
export async function verifyBot(token: string): Promise<{ ok: boolean; bot?: TelegramBot; error?: string }> {
  try {
    const res = await fetch(`${BASE}${token}/getMe`);
    const data = await res.json();
    if (data.ok) return { ok: true, bot: data.result };
    return { ok: false, error: data.description || 'Invalid token' };
  } catch (e: any) {
    return { ok: false, error: e.message || 'Network error' };
  }
}

// Get recent updates (messages sent to the bot)
export async function getUpdates(
  token: string,
  offset?: number,
  limit = 20,
): Promise<{ ok: boolean; updates?: TelegramUpdate[]; error?: string }> {
  try {
    const params = new URLSearchParams({ limit: String(limit) });
    if (offset) params.set('offset', String(offset));
    const res = await fetch(`${BASE}${token}/getUpdates?${params}`);
    const data = await res.json();
    if (data.ok) return { ok: true, updates: data.result };
    return { ok: false, error: data.description };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

// Send a message from the bot
export async function sendMessage(
  token: string,
  chatId: string,
  text: string,
): Promise<{ ok: boolean; message?: TelegramMessage; error?: string }> {
  try {
    const res = await fetch(`${BASE}${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
    });
    const data = await res.json();
    if (data.ok) return { ok: true, message: data.result };
    return { ok: false, error: data.description };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

// Get chat info
export async function getChat(
  token: string,
  chatId: string,
): Promise<{ ok: boolean; title?: string; error?: string }> {
  try {
    const res = await fetch(`${BASE}${token}/getChat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId }),
    });
    const data = await res.json();
    if (data.ok) return { ok: true, title: data.result.title || data.result.first_name || chatId };
    return { ok: false, error: data.description };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

// Get webhook info (to show if webhook is set)
export async function getWebhookInfo(token: string): Promise<{ url: string; pendingCount: number } | null> {
  try {
    const res = await fetch(`${BASE}${token}/getWebhookInfo`);
    const data = await res.json();
    if (data.ok) return { url: data.result.url || '', pendingCount: data.result.pending_update_count || 0 };
    return null;
  } catch {
    return null;
  }
}

// Simple polling manager for updates
export class TelegramPoller {
  private token: string;
  private offset = 0;
  private interval: ReturnType<typeof setInterval> | null = null;
  private onMessages: (msgs: TelegramMessage[]) => void;

  constructor(token: string, onMessages: (msgs: TelegramMessage[]) => void) {
    this.token = token;
    this.onMessages = onMessages;
  }

  start(intervalMs = 5000) {
    this.poll(); // immediate first poll
    this.interval = setInterval(() => this.poll(), intervalMs);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private async poll() {
    const result = await getUpdates(this.token, this.offset ? this.offset : undefined);
    if (result.ok && result.updates && result.updates.length > 0) {
      const msgs = result.updates
        .filter(u => u.message)
        .map(u => u.message!);
      if (msgs.length > 0) this.onMessages(msgs);
      // Advance offset past the last update
      this.offset = result.updates[result.updates.length - 1].update_id + 1;
    }
  }
}
