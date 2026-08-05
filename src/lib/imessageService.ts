// ─── Multi-Platform Messaging Service ────────────────────────────────────────
// Supports: iMessage (BlueBubbles), Android SMS (android-sms-gateway / httpSMS),
//           Telegram (Bot API), Discord (Bot API)

import { storage } from './storage';
import { deleteLocalSecret, readLocalSecret, writeLocalSecret } from './localSecrets';

const STORAGE_KEY = '@phone_messenger_config';
const SECRET_FIELDS = ['bbPassword', 'androidApiKey', 'telegramBotToken', 'discordBotToken'] as const;
type SecretField = typeof SECRET_FIELDS[number];

// ─── Unified Types ───────────────────────────────────────────────────────────

export type MessagingPlatform = 'imessage' | 'android' | 'telegram' | 'discord';

export interface PlatformConfig {
  platform: MessagingPlatform;
  // BlueBubbles (iMessage)
  bbServerUrl?: string;
  bbPassword?: string;
  // Android SMS Gateway
  androidServerUrl?: string;
  androidApiKey?: string;
  // Telegram
  telegramBotToken?: string;
  telegramChatId?: string;
  // Discord
  discordBotToken?: string;
  discordChannelId?: string;
}

type StoredPlatformConfig = Omit<PlatformConfig, SecretField> & Partial<Record<SecretField, string | undefined>>;

export interface UnifiedChat {
  id: string;
  name: string;
  lastMessage?: string;
  lastMessageTime?: number;
  isGroup: boolean;
  platform: MessagingPlatform;
  avatar?: string;       // emoji or initial
  service?: string;      // iMessage, SMS, etc.
  unread?: number;
}

export interface UnifiedMessage {
  id: string;
  text: string;
  isFromMe: boolean;
  timestamp: number;
  sender?: string;
  platform: MessagingPlatform;
  hasAttachment?: boolean;
}

export const PLATFORM_INFO: Record<MessagingPlatform, {
  name: string;
  icon: string;
  color: string;
  description: string;
  requiresMac: boolean;
  setupFields: { key: string; label: string; placeholder: string; secure?: boolean }[];
}> = {
  imessage: {
    name: 'iMessage',
    icon: '🍏',
    color: '#34C759',
    description: 'Connect via BlueBubbles server (requires Mac)',
    requiresMac: true,
    setupFields: [
      { key: 'bbServerUrl', label: 'Server URL', placeholder: 'https://your-server.ngrok.io' },
      { key: 'bbPassword', label: 'Password', placeholder: 'Your server password', secure: true },
    ],
  },
  android: {
    name: 'Android SMS',
    icon: '🤖',
    color: '#A4C639',
    description: 'Connect via android-sms-gateway on your phone',
    requiresMac: false,
    setupFields: [
      { key: 'androidServerUrl', label: 'Gateway URL', placeholder: 'https://your-phone-ip:8080' },
      { key: 'androidApiKey', label: 'API Key (optional)', placeholder: 'API key if configured', secure: true },
    ],
  },
  telegram: {
    name: 'Telegram',
    icon: '✈️',
    color: '#0088cc',
    description: 'Connect with a Telegram Bot token',
    requiresMac: false,
    setupFields: [
      { key: 'telegramBotToken', label: 'Bot Token', placeholder: '123456:ABC-DEF...', secure: true },
      { key: 'telegramChatId', label: 'Chat ID (optional)', placeholder: '-100123456789 or leave blank' },
    ],
  },
  discord: {
    name: 'Discord',
    icon: '🎮',
    color: '#5865F2',
    description: 'Connect with a Discord Bot token',
    requiresMac: false,
    setupFields: [
      { key: 'discordBotToken', label: 'Bot Token', placeholder: 'Your bot token', secure: true },
      { key: 'discordChannelId', label: 'Channel ID (optional)', placeholder: 'Default channel ID' },
    ],
  },
};

// ─── Config Storage ──────────────────────────────────────────────────────────

export async function saveConfig(config: PlatformConfig): Promise<void> {
  const persisted: StoredPlatformConfig = { ...config };
  for (const field of SECRET_FIELDS) {
    await writeLocalSecret('phone_messenger', field, config[field] || '');
    delete persisted[field];
  }
  await storage.setItem(STORAGE_KEY, JSON.stringify(persisted));
}

export async function loadConfig(): Promise<PlatformConfig | null> {
  try {
    const raw = await storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredPlatformConfig;
    const secrets = await Promise.all(
      SECRET_FIELDS.map(async (field) => [field, await readLocalSecret('phone_messenger', field)] as const)
    );
    return {
      ...parsed,
      ...Object.fromEntries(secrets.filter(([, value]) => value)),
    } as PlatformConfig;
  } catch {
    return null;
  }
}

export async function clearConfig(): Promise<void> {
  await storage.removeItem(STORAGE_KEY);
  await Promise.all(SECRET_FIELDS.map(field => deleteLocalSecret('phone_messenger', field)));
}

// ═══════════════════════════════════════════════════════════════════════════════
//  BLUEBUBBLES (iMessage)
// ═══════════════════════════════════════════════════════════════════════════════
//
// AUTH-MODEL DECISION (A8 security backlog):
//   The BlueBubbles server REST API authenticates ONLY via a query parameter —
//   the server password passed as `?password=` / `?guid=` / `?token=` (all three
//   are aliases for the same value). See the official docs:
//   https://docs.bluebubbles.app/server/developer-guides/rest-api-and-webhooks
//   The core server does NOT accept an Authorization header or a body field for
//   auth (header names like `x-password`/`x-guid` exist only in some 3rd-party
//   webhook *receivers*, not the server we call here). Moving the password to a
//   header would therefore BREAK a working integration, so we keep it in the
//   query string as the API requires.
//
//   The residual exposure is logs/referrer for a localhost/LAN BlueBubbles
//   server. We contain it: `bbUrl` is the ONLY place the password-bearing URL
//   is built, `bbFetch` never lets a raw URL escape in a thrown error (the
//   low-level fetch/`undici` can embed the full URL in its message), and any
//   URL we might surface is run through `redactBbUrl` first. No caller should
//   log the return of `bbUrl`.

/** Query-param names BlueBubbles treats as the auth secret (all aliases). */
const BB_SECRET_PARAMS = ['password', 'guid', 'token'] as const;

/**
 * Strip the BlueBubbles auth secret from any URL-or-string so it can never land
 * in a log, error banner, or referrer. Fail-open on parse errors by falling
 * back to a regex scrub, and never throws.
 */
export function redactBbUrl(value: unknown): string {
  const raw = typeof value === 'string' ? value : value == null ? '' : String(value);
  if (!raw) return raw;
  try {
    const url = new URL(raw);
    let touched = false;
    for (const key of BB_SECRET_PARAMS) {
      if (url.searchParams.has(key)) {
        url.searchParams.set(key, 'REDACTED');
        touched = true;
      }
    }
    if (touched) return url.toString();
  } catch {
    /* not a full URL — fall through to the regex scrub below */
  }
  // Regex fallback covers relative URLs and non-URL strings that still carry a
  // `password=`/`guid=`/`token=` pair.
  return raw.replace(/\b(password|guid|token)=[^&#\s]*/gi, '$1=REDACTED');
}

function bbUrl(cfg: PlatformConfig, path: string, params?: Record<string, string>): string {
  const base = (cfg.bbServerUrl || '').replace(/\/+$/, '');
  const url = new URL(`${base}${path}`);
  // Required by the BlueBubbles API (query-param auth only — see note above).
  url.searchParams.set('password', cfg.bbPassword || '');
  if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

async function bbFetch<T>(cfg: PlatformConfig, path: string, opts?: {
  method?: string; body?: any; params?: Record<string, string>;
}): Promise<T> {
  const url = bbUrl(cfg, path, opts?.params);
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts?.method || 'GET',
      headers: opts?.body ? { 'Content-Type': 'application/json' } : undefined,
      body: opts?.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch (e: any) {
    // Low-level fetch failures (DNS/TLS/network) can embed the full request URL
    // — which carries the password — in the thrown message. Redact before it
    // can bubble to a caller's error banner or log. Fail-VISIBLE: we still
    // report the failure, just without the secret-bearing URL.
    const detail = redactBbUrl(e?.message || 'network error');
    throw new Error(`BlueBubbles request failed: ${detail}`);
  }
  if (!res.ok) throw new Error(`BlueBubbles ${res.status}`);
  const json = await res.json();
  // Never echo `json.message` verbatim — the server may reflect the request URL
  // (incl. the password) back in its error text.
  if (json.status && json.status >= 400) throw new Error(redactBbUrl(json.message || 'API error'));
  return json.data as T;
}

async function bbPing(cfg: PlatformConfig): Promise<boolean> {
  try { await bbFetch(cfg, '/api/v1/ping'); return true; } catch { return false; }
}

async function bbChats(cfg: PlatformConfig): Promise<UnifiedChat[]> {
  const data = await bbFetch<any[]>(cfg, '/api/v1/chat/query', {
    method: 'POST',
    body: { limit: 30, offset: 0, sort: 'lastmessage', with: ['lastMessage', 'sms'] },
  });
  return (data || []).map(c => ({
    id: c.guid,
    name: c.displayName || (c.participants?.length === 1
      ? formatAddress(c.participants[0].address)
      : c.participants?.slice(0, 3).map((p: any) => formatAddress(p.address)).join(', ') || c.chatIdentifier || 'Unknown'),
    lastMessage: c.lastMessage?.text || undefined,
    lastMessageTime: c.lastMessage?.dateCreated,
    isGroup: c.style === 43,
    platform: 'imessage' as MessagingPlatform,
    avatar: c.style === 43 ? '👥' : '👤',
    service: c.participants?.[0]?.service || 'iMessage',
  }));
}

async function bbMessages(cfg: PlatformConfig, chatId: string): Promise<UnifiedMessage[]> {
  const data = await bbFetch<any[]>(cfg, `/api/v1/chat/${encodeURIComponent(chatId)}/message`, {
    params: { limit: '50', offset: '0', sort: 'DESC', with: 'attachment' },
  });
  return (data || []).reverse().map(m => ({
    id: m.guid,
    text: m.text || (m.attachments?.length ? '📎 Attachment' : ''),
    isFromMe: m.isFromMe,
    timestamp: m.dateCreated,
    sender: m.handle?.address ? formatAddress(m.handle.address) : undefined,
    platform: 'imessage' as MessagingPlatform,
    hasAttachment: (m.attachments?.length || 0) > 0,
  }));
}

async function bbSend(cfg: PlatformConfig, chatId: string, text: string): Promise<void> {
  const tempGuid = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await bbFetch(cfg, '/api/v1/message/text', {
    method: 'POST',
    body: { chatGuid: chatId, tempGuid, message: text },
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ANDROID SMS GATEWAY
// ═══════════════════════════════════════════════════════════════════════════════

async function androidFetch<T>(cfg: PlatformConfig, path: string, opts?: {
  method?: string; body?: any;
}): Promise<T> {
  const base = (cfg.androidServerUrl || '').replace(/\/+$/, '');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cfg.androidApiKey) headers['Authorization'] = `Bearer ${cfg.androidApiKey}`;
  const res = await fetch(`${base}${path}`, {
    method: opts?.method || 'GET',
    headers,
    body: opts?.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) throw new Error(`Android Gateway ${res.status}`);
  return res.json();
}

async function androidPing(cfg: PlatformConfig): Promise<boolean> {
  try {
    const base = (cfg.androidServerUrl || '').replace(/\/+$/, '');
    const headers: Record<string, string> = {};
    if (cfg.androidApiKey) headers['Authorization'] = `Bearer ${cfg.androidApiKey}`;
    const res = await fetch(`${base}/health`, { headers });
    return res.ok;
  } catch { return false; }
}

async function androidChats(cfg: PlatformConfig): Promise<UnifiedChat[]> {
  try {
    const data = await androidFetch<any>(cfg, '/api/v1/conversations');
    const convs = data.conversations || data.data || data || [];
    return (Array.isArray(convs) ? convs : []).map((c: any) => ({
      id: c.thread_id?.toString() || c.id?.toString() || c.address || '',
      name: c.display_name || c.contact_name || formatAddress(c.address || ''),
      lastMessage: c.snippet || c.last_message || undefined,
      lastMessageTime: c.date ? Number(c.date) : undefined,
      isGroup: false,
      platform: 'android' as MessagingPlatform,
      avatar: '📱',
      service: 'SMS',
      unread: c.unread_count || 0,
    }));
  } catch {
    // Fallback: fetch recent messages and group by sender
    const data = await androidFetch<any>(cfg, '/api/v1/messages?limit=50');
    const msgs = data.messages || data.data || data || [];
    const chatMap = new Map<string, any>();
    for (const m of (Array.isArray(msgs) ? msgs : [])) {
      const addr = m.address || m.from || m.to || 'Unknown';
      if (!chatMap.has(addr)) {
        chatMap.set(addr, {
          id: addr,
          name: formatAddress(addr),
          lastMessage: m.body || m.text || '',
          lastMessageTime: m.date ? Number(m.date) : Date.now(),
          isGroup: false,
          platform: 'android',
          avatar: '📱',
          service: 'SMS',
        });
      }
    }
    return Array.from(chatMap.values());
  }
}

async function androidMessages(cfg: PlatformConfig, chatId: string): Promise<UnifiedMessage[]> {
  const data = await androidFetch<any>(cfg, `/api/v1/messages?address=${encodeURIComponent(chatId)}&limit=50`);
  const msgs = data.messages || data.data || data || [];
  return (Array.isArray(msgs) ? msgs : []).map((m: any) => ({
    id: m.id?.toString() || `${m.date}-${Math.random()}`,
    text: m.body || m.text || '',
    isFromMe: m.type === 2 || m.is_from_me === true || m.direction === 'outgoing',
    timestamp: m.date ? Number(m.date) : Date.now(),
    sender: m.address || m.from || undefined,
    platform: 'android' as MessagingPlatform,
  })).sort((a: UnifiedMessage, b: UnifiedMessage) => a.timestamp - b.timestamp);
}

async function androidSend(cfg: PlatformConfig, chatId: string, text: string): Promise<void> {
  await androidFetch(cfg, '/api/v1/messages', {
    method: 'POST',
    body: { address: chatId, body: text },
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  TELEGRAM
// ═══════════════════════════════════════════════════════════════════════════════

const TG_BASE = 'https://api.telegram.org/bot';

async function tgFetch<T>(token: string, method: string, body?: any): Promise<T> {
  const res = await fetch(`${TG_BASE}${token}/${method}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.description || 'Telegram API error');
  return data.result as T;
}

async function tgPing(cfg: PlatformConfig): Promise<boolean> {
  try {
    await tgFetch(cfg.telegramBotToken || '', 'getMe');
    return true;
  } catch { return false; }
}

async function tgChats(cfg: PlatformConfig): Promise<UnifiedChat[]> {
  const token = cfg.telegramBotToken || '';
  // Telegram bots get updates, not chat lists — fetch recent updates to build chat list
  const updates = await tgFetch<any[]>(token, 'getUpdates', { limit: 100 });
  const chatMap = new Map<string, UnifiedChat>();
  for (const u of updates) {
    const msg = u.message || u.channel_post;
    if (!msg) continue;
    const chatId = msg.chat.id.toString();
    if (!chatMap.has(chatId)) {
      chatMap.set(chatId, {
        id: chatId,
        name: msg.chat.title || msg.chat.first_name || msg.chat.username || chatId,
        lastMessage: msg.text || '📎 Media',
        lastMessageTime: msg.date * 1000,
        isGroup: msg.chat.type === 'group' || msg.chat.type === 'supergroup',
        platform: 'telegram',
        avatar: msg.chat.type === 'private' ? '👤' : '👥',
        service: 'Telegram',
      });
    } else {
      const existing = chatMap.get(chatId)!;
      if (msg.date * 1000 > (existing.lastMessageTime || 0)) {
        existing.lastMessage = msg.text || '📎 Media';
        existing.lastMessageTime = msg.date * 1000;
      }
    }
  }
  // If a specific chat ID is configured and no updates, add it
  if (cfg.telegramChatId && !chatMap.has(cfg.telegramChatId)) {
    try {
      const chatInfo = await tgFetch<any>(token, 'getChat', { chat_id: cfg.telegramChatId });
      chatMap.set(cfg.telegramChatId, {
        id: cfg.telegramChatId,
        name: chatInfo.title || chatInfo.first_name || cfg.telegramChatId,
        isGroup: chatInfo.type !== 'private',
        platform: 'telegram',
        avatar: chatInfo.type === 'private' ? '👤' : '👥',
        service: 'Telegram',
      });
    } catch { /* ignore */ }
  }
  return Array.from(chatMap.values()).sort((a, b) => (b.lastMessageTime || 0) - (a.lastMessageTime || 0));
}

async function tgMessages(cfg: PlatformConfig, chatId: string): Promise<UnifiedMessage[]> {
  const token = cfg.telegramBotToken || '';
  const updates = await tgFetch<any[]>(token, 'getUpdates', { limit: 100 });
  const messages: UnifiedMessage[] = [];
  for (const u of updates) {
    const msg = u.message || u.channel_post;
    if (!msg || msg.chat.id.toString() !== chatId) continue;
    messages.push({
      id: msg.message_id.toString(),
      text: msg.text || '📎 Media',
      isFromMe: msg.from?.is_bot === true,
      timestamp: msg.date * 1000,
      sender: msg.from?.first_name || msg.from?.username || undefined,
      platform: 'telegram',
    });
  }
  return messages.sort((a, b) => a.timestamp - b.timestamp);
}

async function tgSend(cfg: PlatformConfig, chatId: string, text: string): Promise<void> {
  await tgFetch(cfg.telegramBotToken || '', 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'Markdown',
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  DISCORD
// ═══════════════════════════════════════════════════════════════════════════════

const DC_BASE = 'https://discord.com/api/v10';

async function dcFetch<T>(token: string, path: string, opts?: { method?: string; body?: any }): Promise<T> {
  const res = await fetch(`${DC_BASE}${path}`, {
    method: opts?.method || 'GET',
    headers: {
      'Authorization': `Bot ${token}`,
      ...(opts?.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: opts?.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) throw new Error(`Discord ${res.status}`);
  return res.json();
}

async function dcPing(cfg: PlatformConfig): Promise<boolean> {
  try {
    await dcFetch(cfg.discordBotToken || '', '/users/@me');
    return true;
  } catch { return false; }
}

async function dcChats(cfg: PlatformConfig): Promise<UnifiedChat[]> {
  const token = cfg.discordBotToken || '';
  // Get bot's guilds, then channels
  const guilds = await dcFetch<any[]>(token, '/users/@me/guilds');
  const chats: UnifiedChat[] = [];

  for (const guild of guilds.slice(0, 5)) {
    try {
      const channels = await dcFetch<any[]>(token, `/guilds/${guild.id}/channels`);
      for (const ch of channels.filter((c: any) => c.type === 0)) { // text channels
        chats.push({
          id: ch.id,
          name: `#${ch.name}`,
          lastMessage: ch.topic || undefined,
          isGroup: true,
          platform: 'discord',
          avatar: '💬',
          service: guild.name,
        });
      }
    } catch { /* skip guild */ }
  }

  // If specific channel ID configured, ensure it's included
  if (cfg.discordChannelId && !chats.find(c => c.id === cfg.discordChannelId)) {
    try {
      const ch = await dcFetch<any>(token, `/channels/${cfg.discordChannelId}`);
      chats.unshift({
        id: ch.id,
        name: `#${ch.name}`,
        isGroup: true,
        platform: 'discord',
        avatar: '💬',
        service: 'Discord',
      });
    } catch { /* ignore */ }
  }

  return chats;
}

async function dcMessages(cfg: PlatformConfig, channelId: string): Promise<UnifiedMessage[]> {
  const token = cfg.discordBotToken || '';
  const msgs = await dcFetch<any[]>(token, `/channels/${channelId}/messages?limit=50`);
  const botUser = await dcFetch<any>(token, '/users/@me');
  return (msgs || []).reverse().map(m => ({
    id: m.id,
    text: m.content || (m.attachments?.length ? '📎 Attachment' : ''),
    isFromMe: m.author?.id === botUser.id,
    timestamp: new Date(m.timestamp).getTime(),
    sender: m.author?.username || m.author?.global_name || undefined,
    platform: 'discord' as MessagingPlatform,
    hasAttachment: (m.attachments?.length || 0) > 0,
  }));
}

async function dcSend(cfg: PlatformConfig, channelId: string, text: string): Promise<void> {
  await dcFetch(cfg.discordBotToken || '', `/channels/${channelId}/messages`, {
    method: 'POST',
    body: { content: text },
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  UNIFIED API
// ═══════════════════════════════════════════════════════════════════════════════

export async function testConnection(cfg: PlatformConfig): Promise<boolean> {
  switch (cfg.platform) {
    case 'imessage': return bbPing(cfg);
    case 'android': return androidPing(cfg);
    case 'telegram': return tgPing(cfg);
    case 'discord': return dcPing(cfg);
    default: return false;
  }
}

export async function getChats(cfg: PlatformConfig): Promise<UnifiedChat[]> {
  switch (cfg.platform) {
    case 'imessage': return bbChats(cfg);
    case 'android': return androidChats(cfg);
    case 'telegram': return tgChats(cfg);
    case 'discord': return dcChats(cfg);
    default: return [];
  }
}

export async function getMessages(cfg: PlatformConfig, chatId: string): Promise<UnifiedMessage[]> {
  switch (cfg.platform) {
    case 'imessage': return bbMessages(cfg, chatId);
    case 'android': return androidMessages(cfg, chatId);
    case 'telegram': return tgMessages(cfg, chatId);
    case 'discord': return dcMessages(cfg, chatId);
    default: return [];
  }
}

export async function sendMsg(cfg: PlatformConfig, chatId: string, text: string): Promise<void> {
  switch (cfg.platform) {
    case 'imessage': return bbSend(cfg, chatId, text);
    case 'android': return androidSend(cfg, chatId, text);
    case 'telegram': return tgSend(cfg, chatId, text);
    case 'discord': return dcSend(cfg, chatId, text);
  }
}

// ─── Display Helpers ─────────────────────────────────────────────────────────

export function formatAddress(address: string): string {
  if (!address) return 'Unknown';
  if (address.includes('@')) return address;
  const digits = address.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1'))
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  if (digits.length === 10)
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  return address;
}

export function formatMessageTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  const hrs = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  if (hrs < 24) return `${hrs}h`;
  if (days < 7) return `${days}d`;
  const d = new Date(timestamp);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
