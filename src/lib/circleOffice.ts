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

export type AgentStatus = 'active' | 'idle' | 'building' | 'offline' | 'error';

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

  // Analytics (from migration 20260226 + 20260324)
  token_usage_today?: number;
  token_usage_total?: number;
  message_count_today?: number;
  message_count_total?: number;
  last_response_ms?: number;
  uptime_score?: number;
  last_command?: string;
  last_command_at?: string;

  // Granular token breakdown (from migration 20260324)
  input_tokens_today?: number;
  output_tokens_today?: number;
  cached_tokens_today?: number;
  input_tokens_total?: number;
  output_tokens_total?: number;
  cached_tokens_total?: number;
  estimated_cost_today?: number;
  estimated_cost_total?: number;
  model_name?: string;

  // Meta
  isPublished: boolean;
  createdAt: string;
  updatedAt: string;
  lastActiveAt?: string;

  // Agent Spirit (role/specialty)
  spirit?: string;         // e.g. 'Senior Software Engineer', 'Designer', 'Philosopher'
  spirit_emoji?: string;   // e.g. '💻', '🎨', '🏛️'

  // Gateway (Phase 3)
  gatewayUrl?: string;
  isPublic?: boolean;

  // Runtime (not from DB)
  isOwn?: boolean;
};

const forbiddenPublishCooldowns = new Map<string, number>();
const FORBIDDEN_PUBLISH_COOLDOWN_MS = 60_000;

function buildPublishCooldownKey(circleId: string, ownerId: string, name: string): string {
  return `${circleId}::${ownerId}::${name.toLowerCase()}`;
}

function hasForbiddenPublishCooldown(key: string): boolean {
  const expiresAt = forbiddenPublishCooldowns.get(key);
  if (!expiresAt) return false;
  if (expiresAt <= Date.now()) {
    forbiddenPublishCooldowns.delete(key);
    return false;
  }
  return true;
}

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
  'blackswan':     { icon: '🦢', color: '#22c55e', label: 'BlackSwan' },
  'openswan':      { icon: '🐾', color: '#f59e0b', label: 'OpenSwan' },
  'claude-code':   { icon: '💻', color: '#6366f1', label: 'Claude Code' },
  'cowork':        { icon: '💼', color: '#22c55e', label: 'Cowork' },
  'codex':         { icon: '🧠', color: '#10a37f', label: 'OpenAI Codex' },
  'gemini':        { icon: '♊', color: '#4285f4', label: 'Google Gemini' },
  'cursor':        { icon: '🎯', color: '#8b5cf6', label: 'Cursor' },
  'opencode':      { icon: 'OC', color: '#38bdf8', label: 'OpenCode' },
  'aider':         { icon: 'AI', color: '#f97316', label: 'Aider' },
  'cline':         { icon: 'CL', color: '#ec4899', label: 'Cline' },
  'windsurf':      { icon: 'WS', color: '#06b6d4', label: 'Windsurf' },
  'copilot':       { icon: 'CP', color: '#1f6feb', label: 'Copilot' },
  'continue':      { icon: 'CN', color: '#22c55e', label: 'Continue' },
  'amp':           { icon: 'AM', color: '#a78bfa', label: 'Amp' },
  'generic-agent': { icon: '⚡', color: '#06b6d4', label: 'AI Agent' },
  // BYO LLM providers
  'openai':        { icon: '🟢', color: '#10a37f', label: 'OpenAI' },
  'anthropic':     { icon: '🟠', color: '#d97706', label: 'Anthropic' },
  'openrouter':    { icon: '🔀', color: '#6d28d9', label: 'OpenRouter' },
  'groq':          { icon: '⚡', color: '#f97316', label: 'Groq' },
  'ollama':        { icon: '🦙', color: '#0ea5e9', label: 'Ollama' },
  'replicate':     { icon: '🎨', color: '#ec4899', label: 'Replicate' },
  'figma':         { icon: '🎨', color: '#a259ff', label: 'Figma' },
};

// ─── BlackSwan default agent — always present in every circle ────────────────

export const BLACKSWAN_AGENT_ID = 'blackswan-default';

export function createBlackSwanAgent(circleId: string): CircleOfficeAgent {
  return {
    id: BLACKSWAN_AGENT_ID,
    circleId,
    ownerId: 'system',
    ownerDisplayName: 'The Underground Circle',
    ownerUsername: 'system',
    provider: 'blackswan',
    name: 'BlackSwan',
    color: '#22c55e',
    toolIcon: '🦢',
    status: 'idle',
    isPublished: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isOwn: false,
    isPublic: true,
  };
}

// ─── DB row mapper ────────────────────────────────────────────────────────────

function fromRow(row: any, currentUserId?: string): CircleOfficeAgent {
  // Keep agents visible regardless of idle time — never auto-transition to offline
  // Users can manually disconnect via the AgentControlCard if needed
  let status = row.status || 'idle';

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
    status,
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
    // Granular token breakdown (from migration 20260324)
    input_tokens_today:   row.input_tokens_today   ?? 0,
    output_tokens_today:  row.output_tokens_today  ?? 0,
    cached_tokens_today:  row.cached_tokens_today  ?? 0,
    input_tokens_total:   row.input_tokens_total   ?? 0,
    output_tokens_total:  row.output_tokens_total  ?? 0,
    cached_tokens_total:  row.cached_tokens_total  ?? 0,
    estimated_cost_today: parseFloat(row.estimated_cost_today) || 0,
    estimated_cost_total: parseFloat(row.estimated_cost_total) || 0,
    model_name:           row.model_name           ?? undefined,
    spirit: row.spirit ?? undefined,
    spirit_emoji: row.spirit_emoji ?? undefined,
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
    const agents = (data || []).map(r => fromRow(r, currentUserId));

    // Always include BlackSwan as the first agent (unless one is already published by name)
    const hasBlackSwan = agents.some(a => a.name.toLowerCase() === 'blackswan');
    if (!hasBlackSwan) {
      agents.unshift(createBlackSwanAgent(circleId));
    }

    return { agents };
  } catch (e: any) {
    return { agents: [], error: e.message };
  }
}

// ─── Hidden-agent suppression ─────────────────────────────────────────────────
// In-memory set of `${circleId}::${name}` keys whose owners have explicitly
// removed them from the office. Bridge pollers re-publish on every tick (every
// 5s), so without this the row would be re-created seconds after deletion.
// The set lives until the next tab reload — which is the right scope: a fresh
// session means the user wants their agents discoverable again.
const _hiddenAgents = new Set<string>();

function hiddenKey(circleId: string, name: string): string {
  return `${circleId}::${name.toLowerCase()}`;
}

export function hideAgentInOffice(circleId: string, name: string): void {
  _hiddenAgents.add(hiddenKey(circleId, name));
}

export function unhideAgentInOffice(circleId: string, name: string): void {
  _hiddenAgents.delete(hiddenKey(circleId, name));
}

export function isAgentHiddenInOffice(circleId: string, name: string): boolean {
  return _hiddenAgents.has(hiddenKey(circleId, name));
}

// ─── Publish an agent to the circle office ────────────────────────────────────

export async function publishAgentToCircle(input: PublishAgentInput): Promise<{
  agent?: CircleOfficeAgent;
  error?: string;
}> {
  try {
    if (isAgentHiddenInOffice(input.circleId, input.name)) {
      return { error: 'agent_hidden' };
    }
    const user = await getCurrentUser();
    if (!user) return { error: 'Not authenticated' };
    const cooldownKey = buildPublishCooldownKey(input.circleId, user.id, input.name);
    if (hasForbiddenPublishCooldown(cooldownKey)) {
      return { error: 'publish_forbidden_cooldown' };
    }

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

    if (error) {
      const statusCode = (error as any)?.code;
      const message = String(error.message || '');
      if (
        statusCode === '403'
        || /forbidden|permission denied|row-level security/i.test(message)
      ) {
        forbiddenPublishCooldowns.set(cooldownKey, Date.now() + FORBIDDEN_PUBLISH_COOLDOWN_MS);
      }
      return { error: error.message };
    }
    forbiddenPublishCooldowns.delete(cooldownKey);
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

// ─── Update agent spirit ──────────────────────────────────────────────────────

export async function updateAgentSpirit(
  agentId: string,
  spirit: string | null,
  spiritEmoji: string | null,
): Promise<{ error?: string }> {
  try {
    const { error } = await supabase
      .from('circle_office_agents')
      .update({
        spirit: spirit || null,
        spirit_emoji: spiritEmoji || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', agentId);
    return error ? { error: error.message } : {};
  } catch (e: any) {
    return { error: e.message };
  }
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

// ─── Remove a published agent row owned by the current user ─────────────────

export async function removeCircleOfficeAgent(
  agentId: string
): Promise<{ error?: string }> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return { error: 'Not authenticated' };

    const { error } = await supabase
      .from('circle_office_agents')
      .delete()
      .eq('id', agentId)
      .eq('owner_id', auth.user.id);

    return error ? { error: error.message } : {};
  } catch (e: any) {
    return { error: e.message };
  }
}
