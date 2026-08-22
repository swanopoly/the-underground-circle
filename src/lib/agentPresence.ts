/**
 * agentPresence.ts — Exact-authority Supabase Presence for circle agents.
 *
 * Presence is ephemeral, but its authentication and lifecycle boundaries are
 * not. Each explicit join owns a dedicated Realtime client pinned to one
 * captured bearer token, and registries are keyed by the exact user+circle
 * pair. A generation-bound cleanup can retire reconnects spawned by that join
 * without ever touching a newer join or another signed-in account.
 */

import { RealtimeClient, type RealtimeChannel } from '@supabase/supabase-js';
import { safeGetSession, safeGetUserForAccessToken } from './authSession';
import { supabase } from './supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

export type AgentPresencePayload = {
  userId: string;
  displayName: string;
  agents: AgentLiveState[];
  joinedAt: string;
};

export type AgentLiveState = {
  agentId: string;
  name: string;
  provider: string;
  toolIcon: string;
  color: string;
  status: 'idle' | 'building' | 'offline';
  currentTask?: string;
  currentGoal?: string;
  sessionUrl?: string;
};

export type PresenceState = Record<string, AgentPresencePayload[]>;
export type ConnectionStatus = 'connecting' | 'live' | 'reconnecting' | 'offline';

export type PresenceCallbacks = {
  onSync: (state: PresenceState) => void;
  onJoin: (userId: string, payload: AgentPresencePayload) => void;
  onLeave: (userId: string) => void;
  onConnectionStatus?: (status: ConnectionStatus) => void;
};

export type AgentPresenceAuthority = Readonly<{
  userId: string;
  accessToken: string;
  displayName?: string;
}>;

export type AgentPresenceCleanup = () => Promise<void>;

type NormalizedPresenceAuthority = Readonly<{
  userId: string;
  accessToken: string;
  displayName?: string;
}>;

export interface AgentPresenceChannelAdapter {
  on(
    eventType: string,
    filter: Record<string, unknown>,
    callback: (payload?: any) => void,
  ): AgentPresenceChannelAdapter;
  subscribe(callback: (status: string) => void): unknown;
  track(payload: AgentPresencePayload): PromiseLike<unknown>;
  presenceState<T extends Record<string, unknown>>(): Record<string, T[]>;
}

export interface AgentPresenceTransport {
  channel: AgentPresenceChannelAdapter;
  close(): Promise<void>;
}

export interface AgentPresenceRuntimeDependencies {
  loadDisplayName(authority: NormalizedPresenceAuthority): Promise<string>;
  createTransport(
    circleId: string,
    authority: NormalizedPresenceAuthority,
  ): Promise<AgentPresenceTransport>;
  setInterval(callback: () => void, delayMs: number): ReturnType<typeof setInterval>;
  clearInterval(handle: ReturnType<typeof setInterval>): void;
  setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  clearTimeout(handle: ReturnType<typeof setTimeout>): void;
  random(): number;
}

type PresenceLifecycle = {
  id: number;
  scopeKey: string;
  circleId: string;
  authority: NormalizedPresenceAuthority;
  agents: AgentLiveState[];
  callbacks: PresenceCallbacks;
  reconnectAttempts: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
};

type PresenceSession = {
  lifecycle: PresenceLifecycle;
  transport: AgentPresenceTransport;
  payload: AgentPresencePayload;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
};

function normalizeAuthority(
  authority: AgentPresenceAuthority | null | undefined,
): NormalizedPresenceAuthority | null {
  if (!authority) return null;
  const userId = String(authority.userId || '').trim();
  const accessToken = String(authority.accessToken || '').trim();
  const displayName = typeof authority.displayName === 'string'
    ? authority.displayName.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 120)
    : '';
  if (!userId || userId.length > 200 || !accessToken || accessToken.length > 16_384) return null;
  return Object.freeze({
    userId,
    accessToken,
    ...(displayName ? { displayName } : {}),
  });
}

function normalizeCircleId(value: string): string | null {
  const circleId = String(value || '').trim();
  return circleId && circleId.length <= 200 ? circleId : null;
}

function presenceScopeKey(authority: NormalizedPresenceAuthority, circleId: string): string {
  return JSON.stringify([authority.userId, circleId]);
}

function cloneAgents(agents: AgentLiveState[]): AgentLiveState[] {
  return agents.map((agent) => ({ ...agent }));
}

async function resolveJoinAuthority(
  capturedAuthority?: AgentPresenceAuthority,
): Promise<NormalizedPresenceAuthority | null> {
  let authority = normalizeAuthority(capturedAuthority);
  if (capturedAuthority === undefined) {
    const { value: session } = await safeGetSession();
    authority = normalizeAuthority(session ? {
      userId: session.user.id,
      accessToken: session.access_token,
      displayName: session.user.user_metadata?.display_name,
    } : null);
  }
  if (!authority) return null;

  const { value: verifiedUser } = await safeGetUserForAccessToken(authority.accessToken);
  return verifiedUser?.id === authority.userId ? authority : null;
}

async function createExactPresenceTransport(
  circleId: string,
  authority: NormalizedPresenceAuthority,
): Promise<AgentPresenceTransport> {
  const projectUrl = String(process.env.EXPO_PUBLIC_SUPABASE_URL || '').trim();
  const anonKey = String(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '').trim();
  if (!projectUrl || !anonKey) throw new Error('Supabase Realtime is not configured.');

  const realtimeEndpoint = new URL('realtime/v1', `${projectUrl.replace(/\/+$/, '')}/`).toString();
  const client = new RealtimeClient(realtimeEndpoint.replace(/\/+$/, ''), {
    params: { apikey: anonKey },
    // A dedicated client never consults the app singleton's mutable session.
    accessToken: async () => authority.accessToken,
  });
  await client.setAuth(authority.accessToken);
  const channel = client.channel(`circle-presence-${circleId}`, {
    config: { private: true, presence: { key: authority.userId } },
  });

  return {
    channel: channel as unknown as AgentPresenceChannelAdapter,
    async close() {
      try { await channel.untrack(); } catch {}
      try { await client.removeChannel(channel); } catch {}
      try { client.disconnect(); } catch {}
    },
  };
}

const defaultDependencies: AgentPresenceRuntimeDependencies = {
  async loadDisplayName(authority) {
    if (authority.displayName) return authority.displayName;
    const { data } = await supabase
      .from('profiles')
      .select('display_name, username')
      .eq('id', authority.userId)
      .setHeader('Authorization', `Bearer ${authority.accessToken}`)
      .maybeSingle();
    const displayName = String(data?.display_name || data?.username || 'Unknown')
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .trim()
      .slice(0, 120);
    return displayName || 'Unknown';
  },
  createTransport: createExactPresenceTransport,
  setInterval: (callback, delayMs) => setInterval(callback, delayMs),
  clearInterval: (handle) => clearInterval(handle),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle),
  random: () => Math.random(),
};

export function createAgentPresenceRuntime(
  dependencies: AgentPresenceRuntimeDependencies,
): {
  join(
    circleId: string,
    agents: AgentLiveState[],
    callbacks: PresenceCallbacks,
    authority: NormalizedPresenceAuthority,
  ): Promise<AgentPresenceCleanup>;
  leave(circleId: string, authority: NormalizedPresenceAuthority): Promise<void>;
  broadcast(
    circleId: string,
    agents: AgentLiveState[],
    authority: NormalizedPresenceAuthority,
  ): Promise<void>;
  getState(circleId: string, authority: NormalizedPresenceAuthority): PresenceState;
  leaveAll(): Promise<void>;
  getActiveScopeKeys(): string[];
} {
  const lifecycles = new Map<string, PresenceLifecycle>();
  const sessions = new Map<string, PresenceSession>();
  const laneTails = new Map<string, Promise<void>>();
  let nextLifecycleId = 0;

  const enqueue = <T>(scopeKey: string, operation: () => Promise<T>): Promise<T> => {
    const previous = laneTails.get(scopeKey) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(operation);
    const tail = run.then(() => undefined, () => undefined);
    laneTails.set(scopeKey, tail);
    void tail.then(() => {
      if (laneTails.get(scopeKey) === tail) laneTails.delete(scopeKey);
    });
    return run;
  };

  const lifecycleIsCurrent = (lifecycle: PresenceLifecycle): boolean => (
    lifecycles.get(lifecycle.scopeKey) === lifecycle
  );

  const sessionIsCurrent = (session: PresenceSession): boolean => (
    lifecycleIsCurrent(session.lifecycle)
    && sessions.get(session.lifecycle.scopeKey) === session
  );

  const closeSession = async (session: PresenceSession): Promise<void> => {
    if (sessions.get(session.lifecycle.scopeKey) === session) {
      sessions.delete(session.lifecycle.scopeKey);
    }
    if (session.heartbeatTimer !== null) {
      dependencies.clearInterval(session.heartbeatTimer);
      session.heartbeatTimer = null;
    }
    await session.transport.close().catch(() => {});
  };

  const startHeartbeat = (session: PresenceSession): void => {
    if (session.heartbeatTimer !== null) dependencies.clearInterval(session.heartbeatTimer);
    session.heartbeatTimer = dependencies.setInterval(() => {
      if (!sessionIsCurrent(session)) return;
      const refreshedPayload: AgentPresencePayload = {
        ...session.payload,
        agents: cloneAgents(session.lifecycle.agents),
        joinedAt: new Date().toISOString(),
      };
      session.payload = refreshedPayload;
      void Promise.resolve(session.transport.channel.track(refreshedPayload)).catch(() => {});
    }, 25_000);
  };

  const scheduleReconnect = (lifecycle: PresenceLifecycle): void => {
    if (!lifecycleIsCurrent(lifecycle) || lifecycle.reconnectTimer !== null) return;
    lifecycle.reconnectAttempts += 1;
    const baseDelay = Math.min(1000 * Math.pow(2, lifecycle.reconnectAttempts - 1), 300_000);
    const delay = baseDelay + dependencies.random() * 1000;
    console.log(
      `[AgentPresence] Reconnecting circle ${lifecycle.circleId} for user ${lifecycle.authority.userId} `
      + `in ${Math.round(delay / 1000)}s (attempt ${lifecycle.reconnectAttempts})`,
    );
    lifecycle.reconnectTimer = dependencies.setTimeout(() => {
      lifecycle.reconnectTimer = null;
      if (!lifecycleIsCurrent(lifecycle)) return;
      void enqueue(lifecycle.scopeKey, () => connectLifecycle(lifecycle)).catch(() => {});
    }, delay);
  };

  const connectLifecycle = async (lifecycle: PresenceLifecycle): Promise<void> => {
    const priorSession = sessions.get(lifecycle.scopeKey);
    if (priorSession) await closeSession(priorSession);
    if (!lifecycleIsCurrent(lifecycle)) return;

    let transport: AgentPresenceTransport | null = null;
    try {
      const displayName = await dependencies.loadDisplayName(lifecycle.authority);
      if (!lifecycleIsCurrent(lifecycle)) return;
      transport = await dependencies.createTransport(lifecycle.circleId, lifecycle.authority);
      if (!lifecycleIsCurrent(lifecycle)) {
        await transport.close().catch(() => {});
        return;
      }

      const payload: AgentPresencePayload = {
        userId: lifecycle.authority.userId,
        displayName,
        agents: cloneAgents(lifecycle.agents),
        joinedAt: new Date().toISOString(),
      };
      const session: PresenceSession = {
        lifecycle,
        transport,
        payload,
        heartbeatTimer: null,
      };
      sessions.set(lifecycle.scopeKey, session);

      transport.channel
        .on('presence', { event: 'sync' }, () => {
          if (!sessionIsCurrent(session)) return;
          lifecycle.callbacks.onSync(
            transport!.channel.presenceState<AgentPresencePayload>() as PresenceState,
          );
        })
        .on('presence', { event: 'join' }, (event) => {
          if (!sessionIsCurrent(session)) return;
          const key = String(event?.key || '');
          const joined = Array.isArray(event?.newPresences) ? event.newPresences[0] : null;
          if (key && joined) lifecycle.callbacks.onJoin(key, joined as AgentPresencePayload);
        })
        .on('presence', { event: 'leave' }, (event) => {
          if (!sessionIsCurrent(session)) return;
          const key = String(event?.key || '');
          if (key) lifecycle.callbacks.onLeave(key);
        })
        .subscribe((status) => {
          if (!sessionIsCurrent(session)) return;
          if (status === 'SUBSCRIBED') {
            lifecycle.reconnectAttempts = 0;
            void Promise.resolve(transport!.channel.track(session.payload)).then(() => {
              if (!sessionIsCurrent(session)) return;
              startHeartbeat(session);
              lifecycle.callbacks.onConnectionStatus?.('live');
            }).catch(() => {
              if (sessionIsCurrent(session)) scheduleReconnect(lifecycle);
            });
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            lifecycle.callbacks.onConnectionStatus?.('reconnecting');
            scheduleReconnect(lifecycle);
          } else if (status === 'CLOSED') {
            lifecycle.callbacks.onConnectionStatus?.('offline');
          } else {
            lifecycle.callbacks.onConnectionStatus?.('connecting');
          }
        });
    } catch {
      if (transport) await transport.close().catch(() => {});
      if (lifecycleIsCurrent(lifecycle)) {
        lifecycle.callbacks.onConnectionStatus?.('offline');
      }
    }
  };

  const leaveLifecycle = async (lifecycle: PresenceLifecycle): Promise<void> => {
    if (!lifecycleIsCurrent(lifecycle)) return;
    lifecycles.delete(lifecycle.scopeKey);
    if (lifecycle.reconnectTimer !== null) {
      dependencies.clearTimeout(lifecycle.reconnectTimer);
      lifecycle.reconnectTimer = null;
    }
    const currentSession = sessions.get(lifecycle.scopeKey);
    if (currentSession?.lifecycle === lifecycle && currentSession.heartbeatTimer !== null) {
      dependencies.clearInterval(currentSession.heartbeatTimer);
      currentSession.heartbeatTimer = null;
    }
    await enqueue(lifecycle.scopeKey, async () => {
      const session = sessions.get(lifecycle.scopeKey);
      if (session?.lifecycle === lifecycle) await closeSession(session);
    }).catch(() => {});
  };

  const join = async (
    circleId: string,
    agents: AgentLiveState[],
    callbacks: PresenceCallbacks,
    authority: NormalizedPresenceAuthority,
  ): Promise<AgentPresenceCleanup> => {
    const scopeKey = presenceScopeKey(authority, circleId);
    const priorLifecycle = lifecycles.get(scopeKey);
    if (priorLifecycle?.reconnectTimer !== null && priorLifecycle?.reconnectTimer !== undefined) {
      dependencies.clearTimeout(priorLifecycle.reconnectTimer);
      priorLifecycle.reconnectTimer = null;
    }
    const priorSession = sessions.get(scopeKey);
    if (priorSession?.heartbeatTimer !== null && priorSession?.heartbeatTimer !== undefined) {
      dependencies.clearInterval(priorSession.heartbeatTimer);
      priorSession.heartbeatTimer = null;
    }

    const lifecycle: PresenceLifecycle = {
      id: ++nextLifecycleId,
      scopeKey,
      circleId,
      authority,
      agents: cloneAgents(agents),
      callbacks,
      reconnectAttempts: 0,
      reconnectTimer: null,
    };
    // Render-time equivalent for runtime callbacks: replacement is synchronous,
    // so old channel events are ignored before any asynchronous teardown.
    lifecycles.set(scopeKey, lifecycle);
    await enqueue(scopeKey, () => connectLifecycle(lifecycle)).catch(() => {});
    return () => leaveLifecycle(lifecycle);
  };

  const leave = async (
    circleId: string,
    authority: NormalizedPresenceAuthority,
  ): Promise<void> => {
    const lifecycle = lifecycles.get(presenceScopeKey(authority, circleId));
    if (lifecycle) await leaveLifecycle(lifecycle);
  };

  const broadcast = async (
    circleId: string,
    agents: AgentLiveState[],
    authority: NormalizedPresenceAuthority,
  ): Promise<void> => {
    const lifecycle = lifecycles.get(presenceScopeKey(authority, circleId));
    if (!lifecycle) return;
    lifecycle.agents = cloneAgents(agents);
    const session = sessions.get(lifecycle.scopeKey);
    if (!session || !sessionIsCurrent(session)) return;
    const updated: AgentPresencePayload = {
      ...session.payload,
      agents: cloneAgents(lifecycle.agents),
      joinedAt: new Date().toISOString(),
    };
    session.payload = updated;
    await Promise.resolve(session.transport.channel.track(updated)).catch(() => {});
  };

  const getState = (
    circleId: string,
    authority: NormalizedPresenceAuthority,
  ): PresenceState => {
    const session = sessions.get(presenceScopeKey(authority, circleId));
    if (!session || !sessionIsCurrent(session)) return {};
    return session.transport.channel.presenceState<AgentPresencePayload>() as PresenceState;
  };

  const leaveAll = async (): Promise<void> => {
    const active = Array.from(lifecycles.values());
    await Promise.all(active.map((lifecycle) => leaveLifecycle(lifecycle)));
  };

  return {
    join,
    leave,
    broadcast,
    getState,
    leaveAll,
    getActiveScopeKeys: () => Array.from(lifecycles.keys()),
  };
}

const presenceRuntime = createAgentPresenceRuntime(defaultDependencies);

/**
 * Join Presence with one captured authority. The returned cleanup is the
 * strongest lifecycle handle because it is bound to this exact join generation.
 */
export async function joinPresenceChannel(
  circleId: string,
  myAgents: AgentLiveState[],
  callbacks: PresenceCallbacks,
  capturedAuthority?: AgentPresenceAuthority,
): Promise<AgentPresenceCleanup> {
  const normalizedCircleId = normalizeCircleId(circleId);
  const authority = await resolveJoinAuthority(capturedAuthority);
  if (!normalizedCircleId || !authority) return async () => {};
  return presenceRuntime.join(normalizedCircleId, myAgents, callbacks, authority);
}

export async function broadcastAgentUpdate(
  circleId: string,
  updatedAgents: AgentLiveState[],
  capturedAuthority?: AgentPresenceAuthority,
): Promise<void> {
  const normalizedCircleId = normalizeCircleId(circleId);
  const authority = normalizeAuthority(capturedAuthority);
  if (!normalizedCircleId || !authority) return;
  await presenceRuntime.broadcast(normalizedCircleId, updatedAgents, authority);
}

/**
 * Authority-less cleanup deliberately does nothing: after an account switch,
 * a circle id alone cannot prove which user's channel the caller owns. Prefer
 * invoking the cleanup returned by `joinPresenceChannel`.
 */
export async function leavePresenceChannel(
  circleId: string,
  capturedAuthority?: AgentPresenceAuthority,
): Promise<void> {
  const normalizedCircleId = normalizeCircleId(circleId);
  const authority = normalizeAuthority(capturedAuthority);
  if (!normalizedCircleId || !authority) return;
  await presenceRuntime.leave(normalizedCircleId, authority);
}

export function getPresenceState(
  circleId: string,
  capturedAuthority?: AgentPresenceAuthority,
): PresenceState {
  const normalizedCircleId = normalizeCircleId(circleId);
  const authority = normalizeAuthority(capturedAuthority);
  if (!normalizedCircleId || !authority) return {};
  return presenceRuntime.getState(normalizedCircleId, authority);
}

export function extractLiveAgents(state: PresenceState): Map<string, {
  displayName: string;
  agents: AgentLiveState[];
  isOnline: boolean;
}> {
  const result = new Map<string, {
    displayName: string;
    agents: AgentLiveState[];
    isOnline: boolean;
  }>();
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

export async function leaveAllPresenceChannels(): Promise<void> {
  await presenceRuntime.leaveAll();
}

export const __agentPresenceTestables = Object.freeze({
  normalizeAuthority,
  presenceScopeKey,
});
