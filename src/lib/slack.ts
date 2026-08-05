/**
 * Slack integration — OAuth, channel management, notifications.
 * Follows the pattern of discord.ts
 */

import { supabase } from './supabase';
import { Linking } from 'react-native';

// ─── Types ───────────────────────────────────────────────────────────

export interface SlackConnection {
  id: string;
  org_id?: string;
  circle_id?: string;
  team_id: string;
  team_name?: string;
  bot_user_id?: string;
  default_channel_id?: string;
  default_channel_name?: string;
  scopes?: string[];
  is_active: boolean;
  created_at: string;
}

export interface SlackChannelMapping {
  id: string;
  slack_connection_id: string;
  circle_id: string;
  slack_channel_id: string;
  slack_channel_name?: string;
  event_types: string[];
}

// ─── Config ─────────────────────────────────────────────────────────

// Slack client_id + scopes now live in the slack-oauth edge function, which
// mints the authorize URL + a server-stored CSRF state bound to the verified
// caller (advisory #3). A client-built state was forgeable.

// ─── Connection ─────────────────────────────────────────────────────

// Per-session flag. Once we've observed that `slack_connections` doesn't
// exist in this project's schema, stop calling it so every page-load
// doesn't emit a 404 to the browser console.
let slackConnectionsUnavailable = false;

export async function getSlackConfig(circleId: string): Promise<SlackConnection | null> {
  if (slackConnectionsUnavailable) return null;
  const { data, error } = await supabase
    .from('slack_connections')
    .select('*')
    .eq('circle_id', circleId)
    .eq('is_active', true)
    .maybeSingle();
  if ((error as any)?.code === 'PGRST205' || (error as any)?.code === 'PGRST204') {
    slackConnectionsUnavailable = true;
    return null;
  }
  return data;
}

export async function getSlackConfigByOrg(orgId: string): Promise<SlackConnection | null> {
  if (slackConnectionsUnavailable) return null;
  const { data, error } = await supabase
    .from('slack_connections')
    .select('*')
    .eq('org_id', orgId)
    .eq('is_active', true)
    .maybeSingle();
  if ((error as any)?.code === 'PGRST205' || (error as any)?.code === 'PGRST204') {
    slackConnectionsUnavailable = true;
    return null;
  }
  return data;
}

export async function initiateSlackOAuth(circleId?: string, orgId?: string): Promise<{ error?: string }> {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
  // The authorize URL and its CSRF state must be minted server-side, bound to
  // the verified caller and a circle they belong to (advisory #3). A
  // client-built btoa(JSON) state was forgeable → workspace-to-victim binding.
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { error: 'Not signed in' };
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/slack-oauth`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ circleId, orgId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) return { error: data.error || `Failed to start Slack OAuth (${res.status})` };
    if (data.url) Linking.openURL(data.url);
    return {};
  } catch (e: any) {
    return { error: e?.message || 'Failed to start Slack OAuth' };
  }
}

export async function disconnectSlack(connectionId: string): Promise<{ error?: string }> {
  const { error } = await supabase
    .from('slack_connections')
    .update({ is_active: false })
    .eq('id', connectionId);

  if (error) return { error: error.message };
  return {};
}

// ─── Channel Mappings ───────────────────────────────────────────────

export async function getChannelMappings(connectionId: string, circleId: string): Promise<SlackChannelMapping[]> {
  const { data } = await supabase
    .from('slack_channel_mappings')
    .select('*')
    .eq('slack_connection_id', connectionId)
    .eq('circle_id', circleId);

  return data || [];
}

export async function updateChannelMappings(
  connectionId: string,
  circleId: string,
  mappings: { channelId: string; channelName: string; eventTypes: string[] }[]
): Promise<{ error?: string }> {
  // Delete existing mappings
  await supabase
    .from('slack_channel_mappings')
    .delete()
    .eq('slack_connection_id', connectionId)
    .eq('circle_id', circleId);

  // Insert new mappings
  if (mappings.length > 0) {
    const { error } = await supabase
      .from('slack_channel_mappings')
      .insert(
        mappings.map(m => ({
          slack_connection_id: connectionId,
          circle_id: circleId,
          slack_channel_id: m.channelId,
          slack_channel_name: m.channelName,
          event_types: m.eventTypes,
        }))
      );

    if (error) return { error: error.message };
  }
  return {};
}

// ─── Send Notification ──────────────────────────────────────────────

export async function sendSlackNotification(
  connectionId: string,
  channelId: string,
  message: string
): Promise<{ error?: string }> {
  const { error } = await supabase.functions.invoke('slack-actions', {
    body: { connectionId, channelId, text: message },
  });

  if (error) return { error: error.message };
  return {};
}
