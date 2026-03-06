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

const SLACK_CLIENT_ID = process.env.EXPO_PUBLIC_SLACK_CLIENT_ID || '';
const SLACK_SCOPES = 'chat:write,channels:read,channels:history,commands,users:read,app_mentions:read';

// ─── Connection ─────────────────────────────────────────────────────

export async function getSlackConfig(circleId: string): Promise<SlackConnection | null> {
  const { data } = await supabase
    .from('slack_connections')
    .select('*')
    .eq('circle_id', circleId)
    .eq('is_active', true)
    .single();

  return data;
}

export async function getSlackConfigByOrg(orgId: string): Promise<SlackConnection | null> {
  const { data } = await supabase
    .from('slack_connections')
    .select('*')
    .eq('org_id', orgId)
    .eq('is_active', true)
    .single();

  return data;
}

export function initiateSlackOAuth(circleId?: string, orgId?: string) {
  const state = btoa(JSON.stringify({ circleId, orgId }));
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
  const redirectUri = `${supabaseUrl}/functions/v1/slack-oauth`;

  const oauthUrl = `https://slack.com/oauth/v2/authorize?client_id=${SLACK_CLIENT_ID}&scope=${SLACK_SCOPES}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;

  Linking.openURL(oauthUrl);
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
