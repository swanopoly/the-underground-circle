/**
 * agentHeartbeat.ts — Keeps circle office agents alive across sessions
 *
 * Problem: Users close their laptop, lose wifi, or log out.
 * Solution: Heartbeat system that:
 *   1. Pings Supabase every 30s while the user has the Office open
 *   2. Marks agents "last_seen" when pings stop (after 2 min)
 *   3. Auto-reconnects and resumes last known status on return
 *   4. Lets circle members see "last seen 4 hours ago" for offline agents
 */

import { supabase } from './supabase';
import { publishAgentToCircle, updateAgentStatus, PROVIDER_DISPLAY } from './circleOffice';
import { AgentConnection } from './connectionManager';

const HEARTBEAT_INTERVAL_MS = 30_000;   // ping every 30s
const OFFLINE_THRESHOLD_MS  = 120_000;  // 2 min without ping = offline

type HeartbeatSession = {
  circleId: string;
  intervalId: ReturnType<typeof setInterval>;
};

// ─── Module-level heartbeat registry ────────────────────────────────────────
// One heartbeat per circle the user has open
const activeSessions = new Map<string, HeartbeatSession>();

// ─── Start heartbeat for a circle ────────────────────────────────────────────

export async function startHeartbeat(
  circleId: string,
  connections: AgentConnection[]
): Promise<void> {
  // Don't double-start
  if (activeSessions.has(circleId)) return;

  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return;

  const userId = auth.user.id;

  // Auto-publish all enabled connections that aren't already in the circle
  await autoPublishConnections(circleId, connections);

  // Mark idle (but don't overwrite 'building' — user may have refreshed mid-session)
  await supabase
    .from('circle_office_agents')
    .update({
      status: 'idle',
      last_active_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('circle_id', circleId)
    .eq('owner_id', userId)
    .eq('is_published', true)
    .eq('status', 'offline'); // only wake up offline agents, leave building alone

  // Update last_active_at for building agents too (keeps them fresh)
  await supabase
    .from('circle_office_agents')
    .update({ last_active_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('circle_id', circleId)
    .eq('owner_id', userId)
    .eq('status', 'building');

  // Start the ping loop
  const intervalId = setInterval(() => heartbeatPing(circleId, userId), HEARTBEAT_INTERVAL_MS);

  activeSessions.set(circleId, { circleId, intervalId });

  // Also ping immediately
  heartbeatPing(circleId, userId);
}

// ─── Stop heartbeat (tab closed / user navigates away) ───────────────────────

export async function stopHeartbeat(circleId: string): Promise<void> {
  const session = activeSessions.get(circleId);
  if (!session) return;

  // Delete from map FIRST to prevent race condition on fast remount
  clearInterval(session.intervalId);
  activeSessions.delete(circleId);

  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return;

  // Mark agents offline when user leaves
  await supabase
    .from('circle_office_agents')
    .update({
      status: 'offline',
      updated_at: new Date().toISOString(),
    })
    .eq('circle_id', circleId)
    .eq('owner_id', auth.user.id);
}

// ─── The actual heartbeat ping ────────────────────────────────────────────────

async function heartbeatPing(circleId: string, userId: string): Promise<void> {
  try {
    await supabase
      .from('circle_office_agents')
      .update({
        last_active_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('circle_id', circleId)
      .eq('owner_id', userId)
      .neq('status', 'building'); // don't interrupt building status with idle ping
  } catch {
    // Silent fail — will be caught by OFFLINE_THRESHOLD on others' side
  }
}

// ─── Auto-publish enabled connections ────────────────────────────────────────
// Called on heartbeat start — registers any connected agents not yet in circle

export async function autoPublishConnections(
  circleId: string,
  connections: AgentConnection[]
): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return;

  const enabledConns = connections.filter(c => c.enabled && c.status === 'connected');
  if (enabledConns.length === 0) return;

  // Get already-published agent names for this user/circle
  const { data: existing } = await supabase
    .from('circle_office_agents')
    .select('name')
    .eq('circle_id', circleId)
    .eq('owner_id', auth.user.id);

  const publishedNames = new Set((existing || []).map(r => r.name));

  // Publish any connections not yet registered
  for (const conn of enabledConns) {
    if (!publishedNames.has(conn.name)) {
      const display = PROVIDER_DISPLAY[conn.provider] || PROVIDER_DISPLAY['generic-agent'];
      const isLocal = conn.endpoint.includes('localhost') || conn.endpoint.includes('127.0.0.1');
      await publishAgentToCircle({
        circleId,
        provider: conn.provider,
        name: conn.name,
        color: conn.color || display.color,
        toolIcon: display.icon,
        gatewayUrl: conn.endpoint,
        isPublic: !isLocal,
      });
    }
  }
}

// ─── Compute "last seen" string from last_active_at ──────────────────────────

export function getLastSeen(lastActiveAt: string | undefined): {
  text: string;
  isOnline: boolean;
  isRecent: boolean; // within 5 min
} {
  if (!lastActiveAt) return { text: 'Never connected', isOnline: false, isRecent: false };

  const ms = Date.now() - new Date(lastActiveAt).getTime();

  if (ms < OFFLINE_THRESHOLD_MS) {
    return { text: 'Online now', isOnline: true, isRecent: true };
  }
  if (ms < 5 * 60_000) {
    return { text: `${Math.floor(ms / 60000)}m ago`, isOnline: false, isRecent: true };
  }
  if (ms < 60 * 60_000) {
    return { text: `${Math.floor(ms / 60000)}m ago`, isOnline: false, isRecent: false };
  }
  if (ms < 24 * 60 * 60_000) {
    return { text: `${Math.floor(ms / 3600000)}h ago`, isOnline: false, isRecent: false };
  }
  return { text: `${Math.floor(ms / 86400000)}d ago`, isOnline: false, isRecent: false };
}

// ─── Mark all circles' agents offline on app close ───────────────────────────

export async function markAllOfflineOnExit(): Promise<void> {
  for (const [circleId] of activeSessions) {
    await stopHeartbeat(circleId);
  }
}
