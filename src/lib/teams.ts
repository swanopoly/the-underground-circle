/**
 * MS Teams integration — OAuth, channel management, notifications.
 * Follows the same pattern as slack.ts with shared IntegrationAdapter.
 */

import { supabase } from './supabase';
import { Linking } from 'react-native';
import type { IntegrationAdapter } from './integrationCore';
import {
  formatCheckInDefault,
  formatStreakDefault,
  formatMemberJoinedDefault,
  formatTaskCompletedDefault,
} from './integrationCore';

// ─── Types ───────────────────────────────────────────────────────────

export interface TeamsConnection {
  id: string;
  org_id?: string;
  circle_id?: string;
  tenant_id: string;
  team_name?: string;
  bot_id?: string;
  default_channel_id?: string;
  default_channel_name?: string;
  scopes?: string[];
  is_active: boolean;
  created_at: string;
}

export interface TeamsChannelMapping {
  id: string;
  teams_connection_id: string;
  circle_id: string;
  teams_channel_id: string;
  teams_channel_name?: string;
  event_types: string[];
}

// ─── Config ──────────────────────────────────────────────────────────

// Teams client_id + scopes now live in the teams-auth edge function, which
// mints the authorize URL + a server-stored CSRF state bound to the verified
// caller (org admin / circle creator). A client-built state was forgeable.

// ─── Connection ─────────────────────────────────────────────────────

// Per-session flag. Once we've observed `teams_connections` is missing we
// stop hitting the endpoint so the browser stops logging 404s.
let teamsConnectionsUnavailable = false;

export async function getTeamsConfig(circleId: string): Promise<TeamsConnection | null> {
  if (teamsConnectionsUnavailable) return null;
  const { data, error } = await supabase
    .from('teams_connections')
    .select('*')
    .eq('circle_id', circleId)
    .eq('is_active', true)
    .maybeSingle();
  if ((error as any)?.code === 'PGRST205' || (error as any)?.code === 'PGRST204') {
    teamsConnectionsUnavailable = true;
    return null;
  }
  return data;
}

export async function getTeamsConfigByOrg(orgId: string): Promise<TeamsConnection | null> {
  if (teamsConnectionsUnavailable) return null;
  const { data, error } = await supabase
    .from('teams_connections')
    .select('*')
    .eq('org_id', orgId)
    .eq('is_active', true)
    .maybeSingle();
  if ((error as any)?.code === 'PGRST205' || (error as any)?.code === 'PGRST204') {
    teamsConnectionsUnavailable = true;
    return null;
  }
  return data;
}

export async function initiateTeamsOAuth(circleId?: string, orgId?: string): Promise<{ error?: string }> {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
  // The authorize URL + its CSRF state are minted server-side, bound to the
  // verified caller (org admin / circle creator). A client-built btoa(JSON)
  // state was forgeable → Teams-bot-to-victim binding (advisory, 2nd sweep).
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { error: 'Not signed in' };
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/teams-auth`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ circleId, orgId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) return { error: data.error || `Failed to start Teams OAuth (${res.status})` };
    if (data.url) Linking.openURL(data.url);
    return {};
  } catch (e: any) {
    return { error: e?.message || 'Failed to start Teams OAuth' };
  }
}

export async function disconnectTeams(connectionId: string): Promise<{ error?: string }> {
  const { error } = await supabase
    .from('teams_connections')
    .update({ is_active: false })
    .eq('id', connectionId);

  if (error) return { error: error.message };
  return {};
}

// ─── Channel Mappings ───────────────────────────────────────────────

export async function getTeamsChannelMappings(connectionId: string, circleId: string): Promise<TeamsChannelMapping[]> {
  const { data } = await supabase
    .from('teams_channel_mappings')
    .select('*')
    .eq('teams_connection_id', connectionId)
    .eq('circle_id', circleId);

  return data || [];
}

export async function updateTeamsChannelMappings(
  connectionId: string,
  circleId: string,
  mappings: { channelId: string; channelName: string; eventTypes: string[] }[]
): Promise<{ error?: string }> {
  await supabase
    .from('teams_channel_mappings')
    .delete()
    .eq('teams_connection_id', connectionId)
    .eq('circle_id', circleId);

  if (mappings.length > 0) {
    const { error } = await supabase
      .from('teams_channel_mappings')
      .insert(
        mappings.map(m => ({
          teams_connection_id: connectionId,
          circle_id: circleId,
          teams_channel_id: m.channelId,
          teams_channel_name: m.channelName,
          event_types: m.eventTypes,
        }))
      );

    if (error) return { error: error.message };
  }
  return {};
}

// ─── Send Notification ──────────────────────────────────────────────

export async function sendTeamsNotification(
  connectionId: string,
  channelId: string,
  message: string
): Promise<{ error?: string }> {
  const { error } = await supabase.functions.invoke('teams-webhook', {
    body: { connectionId, channelId, text: message, action: 'send' },
  });

  if (error) return { error: error.message };
  return {};
}

// ─── Adapter ─────────────────────────────────────────────────────────

export const teamsAdapter: IntegrationAdapter = {
  type: 'teams',
  sendNotification: sendTeamsNotification,
  formatCheckIn: formatCheckInDefault,
  formatStreakUpdate: formatStreakDefault,
  formatMemberJoined: formatMemberJoinedDefault,
  formatTaskCompleted: formatTaskCompletedDefault,
};
