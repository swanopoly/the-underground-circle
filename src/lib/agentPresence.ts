/**
 * agentPresence.ts — Real-time Supabase Presence for circle agents
 *
 * This is the ephemeral "live" layer on top of the durable circle_office_agents table.
 *
 * Architecture:
 *   Layer 1 (this file) — Supabase Realtime Presence channel
 *     • Each user's Office tab joins "circle:{circleId}"
 *     • Broadcasts agent status in real-time via channel.track()
 *     • When tab closes → presence auto-drops, others see it instantly
 *     • 25s heartbeat doubles as Supabase keepalive
 *
 *   Layer 2 (circle_office_agents table) — Durable persistence
 *     • Last known state survives disconnects
 *     • Shows "last seen X ago" when agent is offline
 *     • Updated by agentHeartbeat.ts every 30s
 *
 * Together: live agents show as "🟢 Online", offline ones show last status from DB.
 */

import { supabase } from './supabase';
import { RealtimeChannel } from '@supabase/supabase-js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type AgentPresencePayload = {
  userId: string;
  displayName: string;
  agents: AgentLiveState[];
  joinedAt: string;
};

export type AgentLiveState = {
  agentId: string;        // matches circle_office_agents.id
  name: string;
  provider: string;
  toolIcon: string;
  color: string;
  status: 'idle' | 'building' | 'offline';
  currentTask?: string;
  currentGoal?: string;
  sessionUrl?: string;
};

type PresenceState = Record<string, AgentPresencePayload[]>;

export type ConnectionStatus = 'connecting' | 'live' | 'reconnecting' | 'offline';

type PresenceCallbacks = {
  onSync: (state: PresenceState) => void;
  onJoin: (userId: string, payload: AgentPresencePayload) => void;
  onLeave: (userId: string) => void;
  onConnectionStatus?: (status: ConnectionStatus) => void;
};

// ─── Module state ─────────────────────────────────────────────────────────────

const activeChannels = new Map<string, RealtimeChannel>();
const heartbeatTimers = new Map<string, ReturnType<typeof setInterval>>();

// Mutable current payload per circle — updated whenever status changes
// This ensures heartbeats always broadcast current state, not stale initial state
const currentPayloads = new Map<string, AgentPresencePayload>();

// Reconnect state
const reconnectAttempts = new Map<string, number>();
const reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();

// ─── Join a circle's presence channel ────────────────────────────────────────

export async function joinPresenceChannel(
  circleId: string,
  myAgents: AgentLiveState[],
  callbacks: PresenceCallbacks
): Promise<() => void> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return () => {};

  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, username')
    .eq('id', auth.user.id)
    .single();

  const displayName = profile?.display_name || profile?.username || 'Unknown';
  const userId = auth.user.id;

  const channelName = `circle-presence-${circleId}`;

  // Clean up any existing channel for this circle
  await leavePresenceChannel(circleId);

  const channel = supabase.channel(channelName, {
    config: {
      presence: { key: userId },
    },
  });

  const myPayload: AgentPresencePayload = {
    userId,
    displayName,
    agents: myAgents,
    joinedAt: new Date().toISOString(),
  };

  channel
    .on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState<AgentPresencePayload>();
      callbacks.onSync(state);
    })
    .on('presence', { event: 'join' }, ({ key, newPresences }) => {
      const payload = newPresences[0] as unknown as AgentPresencePayload;
      callbacks.onJoin(key, payload);
    })
    .on('presence', { event: 'leave' }, ({ key }) => {
      callbacks.onLeave(key);
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        reconnectAttempts.set(circleId, 0);
        await channel.track(myPayload);
        startPresenceHeartbeat(circleId, channel, myPayload);
        callbacks.onConnectionStatus?.('live');
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        callbacks.onConnectionStatus?.('reconnecting');
        scheduleReconnect(circleId, myAgents, callbacks);
      } else if (status === 'CLOSED') {
        callbacks.onConnectionStatus?.('offline');
      } else {
        // SUBSCRIBING state
        callbacks.onConnectionStatus?.('connecting');
      }
    });

  activeChannels.set(circleId, channel);
  currentPayloads.set(circleId, myPayload);

  // Return cleanup function
  return () => leavePresenceChannel(circleId);
}

// ─── Update your live agent status ───────────────────────────────────────────
// Call this when an agent's task changes (Step Away / Back at Keyboard)

export async function broadcastAgentUpdate(
  circleId: string,
  updatedAgents: AgentLiveState[]
): Promise<void> {
  const channel = activeChannels.get(circleId);
  if (!channel) return;

  // Update the stored payload so future heartbeats broadcast the new status
  const existing = currentPayloads.get(circleId);
  if (existing) {
    const updated: AgentPresencePayload = {
      ...existing,
      agents: updatedAgents,
      joinedAt: new Date().toISOString(),
    };
    currentPayloads.set(circleId, updated);
    await channel.track(updated);
  }
}

// ─── Leave a circle's presence channel ───────────────────────────────────────

export async function leavePresenceChannel(circleId: string): Promise<void> {
  // Clear everything synchronously first to prevent race conditions
  const hb = heartbeatTimers.get(circleId);
  if (hb) { clearInterval(hb); heartbeatTimers.delete(circleId); }

  const rt = reconnectTimers.get(circleId);
  if (rt) { clearTimeout(rt); reconnectTimers.delete(circleId); }

  currentPayloads.delete(circleId);

  // Leave the Supabase channel
  const channel = activeChannels.get(circleId);
  activeChannels.delete(circleId); // remove from map before async calls
  if (channel) {
    try {
      await channel.untrack();
      await supabase.removeChannel(channel);
    } catch {
      // Channel may already be dead — that's fine
    }
  }
}

// ─── Get current live presence state ─────────────────────────────────────────

export function getPresenceState(circleId: string): PresenceState {
  const channel = activeChannels.get(circleId);
  if (!channel) return {};
  return channel.presenceState<AgentPresencePayload>();
}

// ─── Extract all live agents from presence state ──────────────────────────────

export function extractLiveAgents(state: PresenceState): Map<string, {
  displayName: string;
  agents: AgentLiveState[];
  isOnline: boolean;
}> {
  const result = new Map<string, { displayName: string; agents: AgentLiveState[]; isOnline: boolean }>();

  for (const [userId, presences] of Object.entries(state)) {
    const latest = presences[presences.length - 1];
    if (!latest) continue;
    result.set(userId, {
      displayName: latest.displayName,
      agents: latest.agents,
      isOnline: true,
    });
  }

  return result;
}

// ─── Internal: presence heartbeat ────────────────────────────────────────────

function startPresenceHeartbeat(
  circleId: string,
  channel: RealtimeChannel,
  _initialPayload: AgentPresencePayload // kept for signature compat, we use the map
): void {
  // Clear any existing heartbeat
  const existing = heartbeatTimers.get(circleId);
  if (existing) clearInterval(existing);

  const timer = setInterval(async () => {
    try {
      // Always use the CURRENT payload from the map — never stale
      const current = currentPayloads.get(circleId);
      if (!current) return;
      await channel.track({ ...current, joinedAt: new Date().toISOString() });
    } catch {
      // Will be caught by status handler → schedules reconnect
    }
  }, 25_000);

  heartbeatTimers.set(circleId, timer);
}

// ─── Internal: exponential backoff reconnect ─────────────────────────────────

function scheduleReconnect(
  circleId: string,
  fallbackAgents: AgentLiveState[],
  callbacks: PresenceCallbacks
): void {
  const attempts = (reconnectAttempts.get(circleId) || 0) + 1;
  reconnectAttempts.set(circleId, attempts);

  // Exponential backoff: 1s, 2s, 4s, 8s... capped at 5 min
  const baseDelay = Math.min(1000 * Math.pow(2, attempts - 1), 300_000);
  const jitter = Math.random() * 1000;
  const delay = baseDelay + jitter;

  console.log(`[AgentPresence] Reconnecting circle ${circleId} in ${Math.round(delay / 1000)}s (attempt ${attempts})`);

  const timer = setTimeout(() => {
    reconnectTimers.delete(circleId);
    // Use current payload's agents if available (preserves latest status)
    const currentPayload = currentPayloads.get(circleId);
    const agents = currentPayload?.agents ?? fallbackAgents;
    joinPresenceChannel(circleId, agents, callbacks);
  }, delay);

  reconnectTimers.set(circleId, timer);
}

// ─── Leave all channels on app close ─────────────────────────────────────────

export async function leaveAllPresenceChannels(): Promise<void> {
  for (const [circleId] of activeChannels) {
    await leavePresenceChannel(circleId);
  }
}
