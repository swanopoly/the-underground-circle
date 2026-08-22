/**
 * Discord integration for The Underground Circle.
 * Connects Discord servers to circles, fetches channels and recent messages.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClientForAccessToken, supabase } from './supabase';
import { deleteLocalSecret, readLocalSecret, writeLocalSecret } from './localSecrets';
import { safeGetSession, safeGetUserForAccessToken } from './authSession';

const DISCORD_API = 'https://discord.com/api/v10';
const DISCORD_TOKEN_PLACEHOLDER = '__local_secret__';
const DISCORD_TOKEN_NAMESPACE = 'discord_bot_token_v2';

type DiscordAuthority = Readonly<{
  userId: string;
  accessToken: string;
  client: SupabaseClient;
}>;

function discordTokenSecretId(userId: string, circleId: string): string {
  return `${encodeURIComponent(userId)}:${encodeURIComponent(circleId)}`;
}

async function captureDiscordAuthority(): Promise<DiscordAuthority | null> {
  const { value: session } = await safeGetSession();
  const accessToken = session?.access_token || '';
  const userId = session?.user?.id || '';
  if (!accessToken || !userId) return null;
  const { value: verifiedUser } = await safeGetUserForAccessToken(accessToken);
  if (verifiedUser?.id !== userId) return null;
  return {
    userId,
    accessToken,
    client: getSupabaseClientForAccessToken(accessToken),
  };
}

async function discordAuthorityIsCurrent(authority: DiscordAuthority): Promise<boolean> {
  const { value: session } = await safeGetSession();
  return session?.user?.id === authority.userId;
}

function emptyDiscordConfig(): CircleDiscordConfig {
  return {
    guild_id: null,
    bot_token: null,
    webhook_url: null,
    connected_at: null,
  };
}

// ─── Types ───────────────────────────────────────────────────────────

export interface DiscordChannel {
  id: string;
  name: string;
  type: number; // 0=text, 2=voice, 4=category, 5=announcement, 15=forum
  parent_id: string | null;
  position: number;
  topic: string | null;
}

export interface DiscordMessage {
  id: string;
  content: string;
  author: {
    id: string;
    username: string;
    global_name: string | null;
    avatar: string | null;
  };
  timestamp: string;
  attachments: any[];
  embeds: any[];
}

export interface DiscordGuildInfo {
  id: string;
  name: string;
  icon: string | null;
  member_count?: number;
}

export interface CircleDiscordConfig {
  guild_id: string | null;
  bot_token: string | null;
  webhook_url: string | null;
  connected_at: string | null;
}

// ─── Channel Type Labels ─────────────────────────────────────────────

const CHANNEL_TYPES: Record<number, string> = {
  0: '💬', 2: '🔊', 4: '📂', 5: '📢', 13: '🎙️', 15: '📋',
};

export function channelIcon(type: number): string {
  return CHANNEL_TYPES[type] || '#';
}

export function isTextChannel(type: number): boolean {
  return type === 0 || type === 5 || type === 15;
}

// ─── API Helpers ─────────────────────────────────────────────────────

async function discordFetch(endpoint: string, botToken: string, options?: RequestInit) {
  const res = await fetch(`${DISCORD_API}${endpoint}`, {
    ...options,
    headers: {
      'Authorization': `Bot ${botToken}`,
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Discord API error ${res.status}: ${err}`);
  }

  return res.json();
}

// ─── Connection ──────────────────────────────────────────────────────

export async function connectDiscordServer(
  circleId: string,
  botToken: string
): Promise<{ success: boolean; guild?: DiscordGuildInfo; error?: string }> {
  try {
    const authority = await captureDiscordAuthority();
    if (!authority || !circleId) throw new Error('An authenticated Circle is required.');
    // Validate the bot token by fetching bot user
    const botUser = await discordFetch('/users/@me', botToken);
    if (!botUser?.id) throw new Error('Invalid bot token');

    // Get the bot's guilds
    const guilds: any[] = await discordFetch('/users/@me/guilds', botToken);
    if (!guilds || guilds.length === 0) {
      return { success: false, error: 'Bot is not in any servers. Invite the bot to your Discord server first.' };
    }

    // Use the first guild (or let user pick if multiple)
    const guild = guilds[0];

    // Save to circle
    const { data: receipt, error } = await authority.client.from('circles').update({
      discord_guild_id: guild.id,
      discord_bot_token: DISCORD_TOKEN_PLACEHOLDER,
      discord_connected_at: new Date().toISOString(),
    }).eq('id', circleId).select('id').maybeSingle();

    if (error || !receipt) throw new Error(error?.message || 'Circle access could not be verified.');
    await deleteLocalSecret('discord_bot_token', circleId);
    await writeLocalSecret(
      DISCORD_TOKEN_NAMESPACE,
      discordTokenSecretId(authority.userId, circleId),
      botToken,
    );

    // Sync channels
    await syncChannels(circleId, guild.id, botToken, authority.client);
    if (!(await discordAuthorityIsCurrent(authority))) {
      throw new Error('The signed-in account changed before Discord setup completed.');
    }

    return {
      success: true,
      guild: { id: guild.id, name: guild.name, icon: guild.icon },
    };
  } catch (e: any) {
    return { success: false, error: e.message || 'Failed to connect Discord' };
  }
}

export async function connectDiscordWithGuildId(
  circleId: string,
  botToken: string,
  guildId: string
): Promise<{ success: boolean; guild?: DiscordGuildInfo; error?: string }> {
  try {
    const authority = await captureDiscordAuthority();
    if (!authority || !circleId) throw new Error('An authenticated Circle is required.');
    const guild = await discordFetch(`/guilds/${guildId}?with_counts=true`, botToken);
    if (!guild?.id) throw new Error('Could not find server. Make sure the bot is invited.');

    const { data: receipt, error } = await authority.client.from('circles').update({
      discord_guild_id: guild.id,
      discord_bot_token: DISCORD_TOKEN_PLACEHOLDER,
      discord_connected_at: new Date().toISOString(),
    }).eq('id', circleId).select('id').maybeSingle();

    if (error || !receipt) throw new Error(error?.message || 'Circle access could not be verified.');
    await deleteLocalSecret('discord_bot_token', circleId);
    await writeLocalSecret(
      DISCORD_TOKEN_NAMESPACE,
      discordTokenSecretId(authority.userId, circleId),
      botToken,
    );

    await syncChannels(circleId, guild.id, botToken, authority.client);
    if (!(await discordAuthorityIsCurrent(authority))) {
      throw new Error('The signed-in account changed before Discord setup completed.');
    }

    return {
      success: true,
      guild: {
        id: guild.id,
        name: guild.name,
        icon: guild.icon,
        member_count: guild.approximate_member_count,
      },
    };
  } catch (e: any) {
    return { success: false, error: e.message || 'Failed to connect Discord' };
  }
}

export async function disconnectDiscord(circleId: string): Promise<void> {
  const authority = await captureDiscordAuthority();
  if (!authority || !circleId) throw new Error('An authenticated Circle is required.');
  const { data: receipt, error } = await authority.client.from('circles').update({
    discord_guild_id: null,
    discord_bot_token: null,
    discord_webhook_url: null,
    discord_connected_at: null,
  }).eq('id', circleId).select('id').maybeSingle();

  if (error || !receipt) {
    throw new Error(error?.message || 'Circle access could not be verified.');
  }

  await deleteLocalSecret('discord_bot_token', circleId);
  await deleteLocalSecret(
    DISCORD_TOKEN_NAMESPACE,
    discordTokenSecretId(authority.userId, circleId),
  );

  // Remove cached channels
  await authority.client.from('discord_channels').delete().eq('circle_id', circleId);
}

// ─── Channels ────────────────────────────────────────────────────────

export async function syncChannels(
  circleId: string,
  guildId: string,
  botToken: string,
  client: SupabaseClient = supabase,
): Promise<DiscordChannel[]> {
  const channels: any[] = await discordFetch(`/guilds/${guildId}/channels`, botToken);

  // Filter to text-like channels
  const relevant = channels.filter(c => [0, 2, 4, 5, 13, 15].includes(c.type));

  // Clear old + insert new
  await client.from('discord_channels').delete().eq('circle_id', circleId);

  if (relevant.length > 0) {
    await client.from('discord_channels').insert(
      relevant.map(c => ({
        id: c.id,
        circle_id: circleId,
        guild_id: guildId,
        name: c.name,
        type: c.type,
        parent_id: c.parent_id || null,
        position: c.position || 0,
        topic: c.topic || null,
        last_synced_at: new Date().toISOString(),
      }))
    );
  }

  return relevant;
}

export async function getCachedChannels(circleId: string): Promise<DiscordChannel[]> {
  const { data } = await supabase
    .from('discord_channels')
    .select('*')
    .eq('circle_id', circleId)
    .order('position');

  return (data || []).map(c => ({
    id: c.id,
    name: c.name,
    type: c.type,
    parent_id: c.parent_id,
    position: c.position,
    topic: c.topic,
  }));
}

// ─── Messages ────────────────────────────────────────────────────────

export async function getChannelMessages(
  channelId: string,
  botToken: string,
  limit: number = 20
): Promise<DiscordMessage[]> {
  const messages = await discordFetch(`/channels/${channelId}/messages?limit=${limit}`, botToken);
  return messages.map((m: any) => ({
    id: m.id,
    content: m.content,
    author: {
      id: m.author.id,
      username: m.author.username,
      global_name: m.author.global_name,
      avatar: m.author.avatar,
    },
    timestamp: m.timestamp,
    attachments: m.attachments || [],
    embeds: m.embeds || [],
  }));
}

// ─── Send to Discord ─────────────────────────────────────────────────

export async function sendToChannel(
  channelId: string,
  content: string,
  botToken: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await discordFetch(`/channels/${channelId}/messages`, botToken, {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

// ─── Guild Info ──────────────────────────────────────────────────────

export async function getGuildInfo(
  guildId: string,
  botToken: string
): Promise<DiscordGuildInfo | null> {
  try {
    const guild = await discordFetch(`/guilds/${guildId}?with_counts=true`, botToken);
    return {
      id: guild.id,
      name: guild.name,
      icon: guild.icon,
      member_count: guild.approximate_member_count,
    };
  } catch {
    return null;
  }
}

export function getGuildIconUrl(guildId: string, iconHash: string | null): string | null {
  if (!iconHash) return null;
  return `https://cdn.discordapp.com/icons/${guildId}/${iconHash}.png?size=64`;
}

// ─── Circle Discord Config ──────────────────────────────────────────

export async function getCircleDiscordConfig(circleId: string): Promise<CircleDiscordConfig> {
  const authority = await captureDiscordAuthority();
  if (!authority || !circleId) return emptyDiscordConfig();

  const { data, error } = await authority.client
    .from('circles')
    .select('discord_guild_id, discord_connected_at')
    .eq('id', circleId)
    .maybeSingle();

  if (error || !data) return emptyDiscordConfig();

  // A Circle-only device key is not attributable after an account switch.
  // Delete it unread and use the exact account+Circle namespace instead.
  await deleteLocalSecret('discord_bot_token', circleId);
  let localToken = await readLocalSecret(
    DISCORD_TOKEN_NAMESPACE,
    discordTokenSecretId(authority.userId, circleId),
  );
  let webhookUrl: string | null = null;

  // Legacy database secrets are creator-only. This bounded RPC lets the
  // creator migrate a retained token to their encrypted device store without
  // ever granting raw secret columns to ordinary Circle members.
  if (!localToken) {
    const { data: capabilityRow, error: capabilityError } = await authority.client
      .rpc('get_circle_capability_secrets_v1', { p_circle_id: circleId })
      .maybeSingle();
    if (!capabilityError && capabilityRow) {
      const capabilitySecrets = capabilityRow as {
        discord_bot_token?: unknown;
        discord_webhook_url?: unknown;
      };
      const remoteToken = typeof capabilitySecrets.discord_bot_token === 'string'
        ? capabilitySecrets.discord_bot_token
        : null;
      const legacyRemoteToken = remoteToken && remoteToken !== DISCORD_TOKEN_PLACEHOLDER
        ? remoteToken
        : null;
      webhookUrl = typeof capabilitySecrets.discord_webhook_url === 'string'
        ? capabilitySecrets.discord_webhook_url
        : null;
      if (legacyRemoteToken) {
        localToken = legacyRemoteToken;
        await writeLocalSecret(
          DISCORD_TOKEN_NAMESPACE,
          discordTokenSecretId(authority.userId, circleId),
          legacyRemoteToken,
        );
        await authority.client
          .from('circles')
          .update({ discord_bot_token: DISCORD_TOKEN_PLACEHOLDER })
          .eq('id', circleId)
          .eq('created_by', authority.userId);
      }
    }
  }

  if (!(await discordAuthorityIsCurrent(authority))) return emptyDiscordConfig();

  return {
    guild_id: data?.discord_guild_id || null,
    bot_token: localToken || null,
    webhook_url: webhookUrl,
    connected_at: data?.discord_connected_at || null,
  };
}

// ─── Build Context for SwanBot ───────────────────────────────────────

export async function buildDiscordContext(
  circleId: string,
  botToken: string,
  guildId: string,
  options?: { channelLimit?: number; messageLimit?: number }
): Promise<string> {
  const channelLimit = options?.channelLimit || 5;
  const messageLimit = options?.messageLimit || 5;
  const parts: string[] = [];

  try {
    // Get guild info
    const guild = await getGuildInfo(guildId, botToken);
    if (guild) {
      parts.push(`DISCORD SERVER: ${guild.name} (${guild.member_count || '?'} members)`);
    }

    // Get channels
    const channels = await getCachedChannels(circleId);
    const textChannels = channels.filter(c => isTextChannel(c.type));

    if (textChannels.length > 0) {
      parts.push('DISCORD CHANNELS: ' + textChannels.slice(0, 10).map(c => `#${c.name}`).join(', '));

      // Get recent messages from top channels
      for (const ch of textChannels.slice(0, channelLimit)) {
        try {
          const msgs = await getChannelMessages(ch.id, botToken, messageLimit);
          if (msgs.length > 0) {
            parts.push(`\n#${ch.name} (recent):`);
            msgs.reverse().forEach(m => {
              if (m.content) {
                parts.push(`  ${m.author.global_name || m.author.username}: ${m.content.slice(0, 200)}`);
              }
            });
          }
        } catch { /* channel may not be readable */ }
      }
    }
  } catch (e) {
    parts.push('DISCORD: Error fetching context');
  }

  return parts.join('\n');
}
