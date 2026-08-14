/**
 * agentHeartbeat.ts — Keeps circle office agents alive across sessions.
 *
 * Every lifecycle owns one immutable user/token authority snapshot. Database
 * requests bind that bearer explicitly, and the in-memory registry is keyed by
 * the exact user+circle pair. A cleanup returned by `startHeartbeat` is also
 * bound to one lifecycle generation, so a late cleanup cannot stop a newer
 * session for either the same scope or a newly signed-in account.
 */

import { safeGetSession, safeGetUserForAccessToken } from './authSession';
import {
  publishAgentToCircle,
  PROVIDER_DISPLAY,
  type CircleOfficeAuthScope,
} from './circleOffice';
import type { AgentConnection } from './connectionManager';
import { supabase } from './supabase';

const HEARTBEAT_INTERVAL_MS = 30_000;
const OFFLINE_THRESHOLD_MS = 120_000;

export type AgentHeartbeatAuthority = CircleOfficeAuthScope;
export type AgentHeartbeatCleanup = () => Promise<void>;

type NormalizedHeartbeatAuthority = Readonly<{
  userId: string;
  accessToken: string;
}>;

type HeartbeatLifecycle = {
  id: number;
  scopeKey: string;
  circleId: string;
  authority: NormalizedHeartbeatAuthority;
  intervalId: ReturnType<typeof setInterval> | null;
};

export interface AgentHeartbeatRuntimeDependencies {
  autoPublish(
    circleId: string,
    connections: AgentConnection[],
    authority: NormalizedHeartbeatAuthority,
    isCurrent: () => boolean,
  ): Promise<void>;
  wakeOffline(circleId: string, authority: NormalizedHeartbeatAuthority): Promise<void>;
  touchBuilding(circleId: string, authority: NormalizedHeartbeatAuthority): Promise<void>;
  ping(circleId: string, authority: NormalizedHeartbeatAuthority): Promise<void>;
  markIdle(circleId: string, authority: NormalizedHeartbeatAuthority): Promise<void>;
  setInterval(callback: () => void, delayMs: number): ReturnType<typeof setInterval>;
  clearInterval(handle: ReturnType<typeof setInterval>): void;
}

function normalizeAuthority(
  authority: AgentHeartbeatAuthority | null | undefined,
): NormalizedHeartbeatAuthority | null {
  if (!authority) return null;
  const userId = String(authority.userId || '').trim();
  const accessToken = String(authority.accessToken || '').trim();
  if (!userId || userId.length > 200 || !accessToken || accessToken.length > 16_384) return null;
  return Object.freeze({ userId, accessToken });
}

function normalizeCircleId(value: string): string | null {
  const circleId = String(value || '').trim();
  return circleId && circleId.length <= 200 ? circleId : null;
}

function heartbeatScopeKey(authority: NormalizedHeartbeatAuthority, circleId: string): string {
  return JSON.stringify([authority.userId, circleId]);
}

async function resolveStartAuthority(
  capturedAuthority?: AgentHeartbeatAuthority,
): Promise<NormalizedHeartbeatAuthority | null> {
  let authority = normalizeAuthority(capturedAuthority);
  if (capturedAuthority === undefined) {
    const { value: session } = await safeGetSession();
    authority = normalizeAuthority(session ? {
      userId: session.user.id,
      accessToken: session.access_token,
    } : null);
  }
  if (!authority) return null;

  // Verify the exact token rather than consulting mutable current auth after it
  // has been captured. A token for user B must never be paired with user A.
  const { value: verifiedUser } = await safeGetUserForAccessToken(authority.accessToken);
  return verifiedUser?.id === authority.userId ? authority : null;
}

async function autoPublishConnectionsWithAuthority(
  circleId: string,
  connections: AgentConnection[],
  authority: NormalizedHeartbeatAuthority,
  isCurrent: () => boolean,
): Promise<void> {
  const enabledConnections = connections.filter(
    (connection) => connection.enabled && connection.status === 'connected',
  );
  if (enabledConnections.length === 0 || !isCurrent()) return;

  const { data: existing, error } = await supabase
    .from('circle_office_agents')
    .select('name')
    .eq('circle_id', circleId)
    .eq('owner_id', authority.userId)
    .setHeader('Authorization', `Bearer ${authority.accessToken}`);
  if (error || !isCurrent()) return;

  const publishedNames = new Set(
    (existing || []).map((row: { name?: unknown }) => String(row.name || '')),
  );
  for (const connection of enabledConnections) {
    if (!isCurrent()) return;
    if (publishedNames.has(connection.name)) continue;
    const display = PROVIDER_DISPLAY[connection.provider] || PROVIDER_DISPLAY['generic-agent'];
    const isLocal = connection.endpoint.includes('localhost')
      || connection.endpoint.includes('127.0.0.1');
    await publishAgentToCircle({
      circleId,
      provider: connection.provider,
      name: connection.name,
      color: connection.color || display.color,
      toolIcon: display.icon,
      gatewayUrl: connection.endpoint,
      isPublic: !isLocal,
    }, authority);
    publishedNames.add(connection.name);
  }
}

const defaultDependencies: AgentHeartbeatRuntimeDependencies = {
  autoPublish: autoPublishConnectionsWithAuthority,
  async wakeOffline(circleId, authority) {
    await supabase
      .from('circle_office_agents')
      .update({
        status: 'idle',
        last_active_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('circle_id', circleId)
      .eq('owner_id', authority.userId)
      .eq('is_published', true)
      .eq('status', 'offline')
      .setHeader('Authorization', `Bearer ${authority.accessToken}`);
  },
  async touchBuilding(circleId, authority) {
    await supabase
      .from('circle_office_agents')
      .update({
        last_active_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('circle_id', circleId)
      .eq('owner_id', authority.userId)
      .eq('status', 'building')
      .setHeader('Authorization', `Bearer ${authority.accessToken}`);
  },
  async ping(circleId, authority) {
    await supabase
      .from('circle_office_agents')
      .update({
        last_active_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('circle_id', circleId)
      .eq('owner_id', authority.userId)
      .neq('status', 'building')
      .setHeader('Authorization', `Bearer ${authority.accessToken}`);
  },
  async markIdle(circleId, authority) {
    await supabase
      .from('circle_office_agents')
      .update({
        status: 'idle',
        current_task: 'Session ended — idling',
        updated_at: new Date().toISOString(),
      })
      .eq('circle_id', circleId)
      .eq('owner_id', authority.userId)
      .setHeader('Authorization', `Bearer ${authority.accessToken}`);
  },
  setInterval: (callback, delayMs) => setInterval(callback, delayMs),
  clearInterval: (handle) => clearInterval(handle),
};

export function createAgentHeartbeatRuntime(
  dependencies: AgentHeartbeatRuntimeDependencies,
): {
  start(
    circleId: string,
    connections: AgentConnection[],
    authority: NormalizedHeartbeatAuthority,
  ): Promise<AgentHeartbeatCleanup>;
  stop(circleId: string, authority: NormalizedHeartbeatAuthority): Promise<void>;
  stopAll(): Promise<void>;
  getActiveScopeKeys(): string[];
} {
  const activeLifecycles = new Map<string, HeartbeatLifecycle>();
  const laneTails = new Map<string, Promise<void>>();
  let nextLifecycleId = 0;

  const enqueue = (scopeKey: string, operation: () => Promise<void>): Promise<void> => {
    const previous = laneTails.get(scopeKey) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(operation);
    const tail = run.then(() => undefined, () => undefined);
    laneTails.set(scopeKey, tail);
    void tail.then(() => {
      if (laneTails.get(scopeKey) === tail) laneTails.delete(scopeKey);
    });
    return run;
  };

  const isCurrent = (lifecycle: HeartbeatLifecycle): boolean => (
    activeLifecycles.get(lifecycle.scopeKey) === lifecycle
  );

  const stopLifecycle = async (lifecycle: HeartbeatLifecycle): Promise<void> => {
    if (!isCurrent(lifecycle)) return;
    activeLifecycles.delete(lifecycle.scopeKey);
    if (lifecycle.intervalId !== null) {
      dependencies.clearInterval(lifecycle.intervalId);
      lifecycle.intervalId = null;
    }
    await enqueue(lifecycle.scopeKey, async () => {
      // This final write uses the retired lifecycle's captured authority. It is
      // serialized after any in-flight ping/start work and before a newer
      // same-scope start, so cleanup is the last effect of this generation.
      await dependencies.markIdle(lifecycle.circleId, lifecycle.authority);
    }).catch(() => {});
  };

  const start = async (
    circleId: string,
    connections: AgentConnection[],
    authority: NormalizedHeartbeatAuthority,
  ): Promise<AgentHeartbeatCleanup> => {
    const scopeKey = heartbeatScopeKey(authority, circleId);
    const prior = activeLifecycles.get(scopeKey);
    if (prior?.intervalId !== null && prior?.intervalId !== undefined) {
      dependencies.clearInterval(prior.intervalId);
      prior.intervalId = null;
    }

    const lifecycle: HeartbeatLifecycle = {
      id: ++nextLifecycleId,
      scopeKey,
      circleId,
      authority,
      intervalId: null,
    };
    // Replace synchronously. Every old callback now fails `isCurrent` before
    // the asynchronous close/start lane has a chance to yield.
    activeLifecycles.set(scopeKey, lifecycle);

    await enqueue(scopeKey, async () => {
      const current = () => isCurrent(lifecycle);
      if (!current()) return;
      await dependencies.autoPublish(circleId, connections, authority, current);
      if (!current()) return;
      await dependencies.wakeOffline(circleId, authority);
      if (!current()) return;
      await dependencies.touchBuilding(circleId, authority);
      if (!current()) return;

      lifecycle.intervalId = dependencies.setInterval(() => {
        void enqueue(scopeKey, async () => {
          if (!current()) return;
          await dependencies.ping(circleId, authority);
        }).catch(() => {});
      }, HEARTBEAT_INTERVAL_MS);
      await dependencies.ping(circleId, authority);
    }).catch(() => {});

    return () => stopLifecycle(lifecycle);
  };

  const stop = async (
    circleId: string,
    authority: NormalizedHeartbeatAuthority,
  ): Promise<void> => {
    const lifecycle = activeLifecycles.get(heartbeatScopeKey(authority, circleId));
    if (lifecycle) await stopLifecycle(lifecycle);
  };

  const stopAll = async (): Promise<void> => {
    const lifecycles = Array.from(activeLifecycles.values());
    await Promise.all(lifecycles.map((lifecycle) => stopLifecycle(lifecycle)));
  };

  return {
    start,
    stop,
    stopAll,
    getActiveScopeKeys: () => Array.from(activeLifecycles.keys()),
  };
}

const heartbeatRuntime = createAgentHeartbeatRuntime(defaultDependencies);

/**
 * Start one exact user+circle heartbeat lifecycle.
 *
 * Callers should retain and invoke the returned cleanup. Passing an authority
 * is the preferred path; omitting it remains a safe compatibility start that
 * captures and verifies one session snapshot before any mutation.
 */
export async function startHeartbeat(
  circleId: string,
  connections: AgentConnection[],
  capturedAuthority?: AgentHeartbeatAuthority,
): Promise<AgentHeartbeatCleanup> {
  const normalizedCircleId = normalizeCircleId(circleId);
  const authority = await resolveStartAuthority(capturedAuthority);
  if (!normalizedCircleId || !authority) return async () => {};
  const snapshot = connections.map((connection) => ({ ...connection }));
  return heartbeatRuntime.start(normalizedCircleId, snapshot, authority);
}

/**
 * Stop the current lifecycle for one exact user+circle pair.
 *
 * Authority-less cleanup fails closed because a late account-A cleanup cannot
 * safely infer whether a circle-only registry entry belongs to account B. Use
 * the cleanup returned by `startHeartbeat` whenever possible.
 */
export async function stopHeartbeat(
  circleId: string,
  capturedAuthority?: AgentHeartbeatAuthority,
): Promise<void> {
  const normalizedCircleId = normalizeCircleId(circleId);
  const authority = normalizeAuthority(capturedAuthority);
  if (!normalizedCircleId || !authority) return;
  await heartbeatRuntime.stop(normalizedCircleId, authority);
}

// ─── Auto-publish enabled connections ────────────────────────────────────────

export async function autoPublishConnections(
  circleId: string,
  connections: AgentConnection[],
  capturedAuthority?: AgentHeartbeatAuthority,
): Promise<void> {
  const normalizedCircleId = normalizeCircleId(circleId);
  const authority = await resolveStartAuthority(capturedAuthority);
  if (!normalizedCircleId || !authority) return;
  await autoPublishConnectionsWithAuthority(
    normalizedCircleId,
    connections.map((connection) => ({ ...connection })),
    authority,
    () => true,
  );
}

// ─── Compute "last seen" string from last_active_at ──────────────────────────

export function getLastSeen(lastActiveAt: string | undefined): {
  text: string;
  isOnline: boolean;
  isRecent: boolean;
} {
  if (!lastActiveAt) return { text: 'Never connected', isOnline: false, isRecent: false };

  const ms = Date.now() - new Date(lastActiveAt).getTime();
  if (ms < OFFLINE_THRESHOLD_MS) return { text: 'Online now', isOnline: true, isRecent: true };
  if (ms < 5 * 60_000) return { text: `${Math.floor(ms / 60_000)}m ago`, isOnline: false, isRecent: true };
  if (ms < 60 * 60_000) return { text: `${Math.floor(ms / 60_000)}m ago`, isOnline: false, isRecent: false };
  if (ms < 24 * 60 * 60_000) return { text: `${Math.floor(ms / 3_600_000)}h ago`, isOnline: false, isRecent: false };
  return { text: `${Math.floor(ms / 86_400_000)}d ago`, isOnline: false, isRecent: false };
}

export async function markAllOfflineOnExit(): Promise<void> {
  await heartbeatRuntime.stopAll();
}

export const __agentHeartbeatTestables = Object.freeze({
  heartbeatScopeKey,
  normalizeAuthority,
});
