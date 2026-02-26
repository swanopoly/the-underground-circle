/**
 * circleOffice.ts — Shared Circle Office Agent Registry
 *
 * Manages the public agent profiles visible to all circle members.
 * No secrets here — tokens/endpoints stay in agents_bots (private).
 *
 * Each circle member can:
 *   1. Publish their agent(s) to the circle office
 *   2. Update their agent's live status (building/idle/offline)
 *   3. See ALL other members' agents in real time
 */

import { supabase } from './supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

export type AgentStatus = 'idle' | 'building' | 'offline' | 'error';

export type CircleOfficeAgent = {
  id: string;
  circleId: string;
  ownerId: string;
  ownerDisplayName: string;
  ownerUsername: string;

  // Public agent info
  provider: string;
  name: string;
  color: string;
  toolIcon: string;

  // Live status
  status: AgentStatus;
  currentTask?: string;
  currentGoal?: string;
  sessionUrl?: string;
  returnTime?: string;

  // Office canvas position (0.0–1.0 floats)
  position_x?: number;
  position_y?: number;
  pixel_character?: string;

  // Analytics (from migration 20260226)
  token_usage_today?: number;
  token_usage_total?: number;
  message_count_today?: number;
  message_count_total?: number;
  last_response_ms?: number;
  uptime_score?: number;
  last_command?: string;
  last_command_at?: string;

  // Meta
  isPublished: boolean;
  createdAt: string;
  updatedAt: string;
  lastActiveAt?: string;

  // Gateway (Phase 3)
  gatewayUrl?: string;
  isPublic?: boolean;

  // Runtime (not from DB)
  isOwn?: boolean;
};

export type PublishAgentInput = {
  circleId: string;
  provider: string;
  name: string;
  color: string;
  toolIcon: string;
  gatewayUrl?: string;
  isPublic?: boolean;
};

// ─── Provider → Icon + Color map ─────────────────────────────────────────────

export const PROVIDER_DISPLAY: Record<string, { icon: string; color: string; label: string }> = {
  'openclaw':      { icon: '🐾', color: '#f59e0b', label: 'OpenClaw' },
  'claude-code':   { icon: '💻', color: '#6366f1', label: 'Claude Code' },
  'cowork':        { icon: '💼', color: '#22c55e', label: 'Cowork' },
  'codex':         { icon: '🧠', color: '#10a37f', label: 'OpenAI Codex' },
  'gemini':        { icon: '♊', color: '#4285f4', label: 'Google Gemini' },
  'cursor':        { icon: '🎯', color: '#8b5cf6', label: 'Cursor' },
  'generic-agent': { icon: '⚡', color: '#06b6d4', label: 'AI Agent' },
};

// ─── DB row mapper ────────────────────────────────────────────────────────────

function fromRow(row: any, currentUserId?: string): CircleOfficeAgent {
  return {
    id: row.id,
    circleId: row.circle_id,
    ownerId: row.owner_id,
    ownerDisplayName: row.owner_display_name || row.owner_username || 'Unknown',
    ownerUsername: row.owner_username || '',
    provider: row.provider,
    name: row.name,
    color: row.color || '#6366f1',
    toolIcon: row.tool_icon || '🤖',
    status: row.status || 'offline',
    currentTask: row.current_task,
    currentGoal: row.current_goal,
    sessionUrl: row.session_url,
    returnTime: row.return_time,
    // Canvas position + analytics (from migration 20260226, may be null on old rows)
    position_x:          row.position_x        ?? 0.5,
    position_y:          row.position_y        ?? 0.5,
    pixel_character:     row.pixel_character   ?? 'robot',
    token_usage_today:   row.token_usage_today  ?? 0,
    token_usage_total:   row.token_usage_total  ?? 0,
    message_count_today: row.message_count_today ?? 0,
    message_count_total: row.message_count_total ?? 0,
    last_response_ms:    row.last_response_ms   ?? undefined,
    uptime_score:        row.uptime_score       ?? 1.0,
    last_command:        row.last_command       ?? undefined,
    last_command_at:     row.last_command_at    ?? undefined,
    isPublished: row.is_published,
    gatewayUrl: row.gateway_url ?? undefined,
    isPublic: row.is_public ?? false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastActiveAt: row.last_active_at,
    isOwn: currentUserId ? row.owner_id === currentUserId : false,
  };
}

// ─── Get current user ─────────────────────────────────────────────────────────

async function getCurrentUser(): Promise<{ id: string; displayName: string; username: string } | null> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, username')
    .eq('id', auth.user.id)
    .single();

  return {
    id: auth.user.id,
    displayName: profile?.display_name || profile?.username || 'Unknown',
    username: profile?.username || '',
  };
}

// ─── Load all agents in a circle ──────────────────────────────────────────────

export async function loadCircleOfficeAgents(circleId: string): Promise<{
  agents: CircleOfficeAgent[];
  error?: string;
}> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const currentUserId = auth.user?.id;

    const { data, error } = await supabase
      .from('circle_office_agents')
      .select('*')
      .eq('circle_id', circleId)
      .eq('is_published', true)
      .order('created_at', { ascending: true });

    if (error) return { agents: [], error: error.message };
    return { agents: (data || []).map(r => fromRow(r, currentUserId)) };
  } catch (e: any) {
    return { agents: [], error: e.message };
  }
}

// ─── Publish an agent to the circle office ────────────────────────────────────

export async function publishAgentToCircle(input: PublishAgentInput): Promise<{
  agent?: CircleOfficeAgent;
  error?: string;
}> {
  try {
    const user = await getCurrentUser();
    if (!user) return { error: 'Not authenticated' };

    const { data, error } = await supabase
      .from('circle_office_agents')
      .upsert({
        circle_id: input.circleId,
        owner_id: user.id,
        owner_display_name: user.displayName,
        owner_username: user.username,
        provider: input.provider,
        name: input.name,
        color: input.color,
        tool_icon: input.toolIcon,
        status: 'idle',
        is_published: true,
        gateway_url: input.gatewayUrl ?? null,
        is_public: input.isPublic ?? false,
      }, {
        onConflict: 'circle_id,owner_id,name',
      })
      .select()
      .single();

    if (error) return { error: error.message };
    return { agent: fromRow(data, user.id) };
  } catch (e: any) {
    return { error: e.message };
  }
}

// ─── Remove an agent from the circle office ───────────────────────────────────

export async function unpublishAgentFromCircle(agentId: string): Promise<{ error?: string }> {
  try {
    const { error } = await supabase
      .from('circle_office_agents')
      .delete()
      .eq('id', agentId);
    if (error) return { error: error.message };
    return {};
  } catch (e: any) {
    return { error: e.message };
  }
}

// ─── Update live status ───────────────────────────────────────────────────────

export async function updateAgentStatus(
  circleId: string,
  status: AgentStatus,
  opts: {
    currentTask?: string;
    currentGoal?: string;
    sessionUrl?: string;
    returnTime?: string;
  } = {}
): Promise<{ error?: string }> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return { error: 'Not authenticated' };

    const updatePayload: any = {
      status,
      current_task: opts.currentTask ?? null,
      current_goal: opts.currentGoal ?? null,
      session_url: opts.sessionUrl ?? null,
      return_time: opts.returnTime ?? null,
      updated_at: new Date().toISOString(),
    };
    if (status === 'building') {
      updatePayload.last_active_at = new Date().toISOString();
    }

    const { error } = await supabase
      .from('circle_office_agents')
      .update(updatePayload)
      .eq('circle_id', circleId)
      .eq('owner_id', auth.user.id);

    if (error) return { error: error.message };
    return {};
  } catch (e: any) {
    return { error: e.message };
  }
}

// ─── Set all user's agents in a circle to idle/offline ───────────────────────

export async function setAgentsOffline(circleId: string): Promise<void> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return;
    await supabase
      .from('circle_office_agents')
      .update({ status: 'offline', current_task: null, current_goal: null })
      .eq('circle_id', circleId)
      .eq('owner_id', auth.user.id);
  } catch {}
}

// ─── Check if user has any published agents in a circle ──────────────────────

export async function getUserCircleAgents(circleId: string): Promise<CircleOfficeAgent[]> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return [];

    const { data } = await supabase
      .from('circle_office_agents')
      .select('*')
      .eq('circle_id', circleId)
      .eq('owner_id', auth.user.id);

    return (data || []).map(r => fromRow(r, auth.user!.id));
  } catch { return []; }
}

// ─── Subscribe to real-time changes ──────────────────────────────────────────

export function subscribeToCircleOffice(
  circleId: string,
  onUpdate: () => void
): () => void {
  const channel = supabase
    .channel(`circle-office-${circleId}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'circle_office_agents',
      filter: `circle_id=eq.${circleId}`,
    }, onUpdate)
    .subscribe();

  return () => { supabase.removeChannel(channel); };
}

// ─── Update gateway URL + public flag ────────────────────────────────────────

export async function updateAgentGatewayUrl(
  agentId: string,
  gatewayUrl: string | null,
  isPublic: boolean
): Promise<{ error?: string }> {
  try {
    const { error } = await supabase
      .from('circle_office_agents')
      .update({ gateway_url: gatewayUrl, is_public: isPublic, updated_at: new Date().toISOString() })
      .eq('id', agentId);
    return error ? { error: error.message } : {};
  } catch (e: any) {
    return { error: e.message };
  }
}
