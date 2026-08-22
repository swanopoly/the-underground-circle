import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

type AgentConnection = any;
type AgentLiveState = any;
type AgentPresencePayload = any;
type PresenceState = Record<string, AgentPresencePayload[]>;
interface AgentPresenceChannelAdapter {
  on(eventType: string, filter: Record<string, unknown>, callback: (payload?: any) => void): AgentPresenceChannelAdapter;
  subscribe(callback: (status: string) => void): unknown;
  track(payload: AgentPresencePayload): PromiseLike<unknown>;
  presenceState<T extends Record<string, unknown>>(): Record<string, T[]>;
}
interface AgentPresenceTransport {
  channel: AgentPresenceChannelAdapter;
  close(): Promise<void>;
}
interface AgentHeartbeatRuntimeDependencies {
  autoPublish(circleId: string, connections: AgentConnection[], authority: Authority, isCurrent: () => boolean): Promise<void>;
  wakeOffline(circleId: string, authority: Authority): Promise<void>;
  touchBuilding(circleId: string, authority: Authority): Promise<void>;
  ping(circleId: string, authority: Authority): Promise<void>;
  markIdle(circleId: string, authority: Authority): Promise<void>;
  setInterval(callback: () => void, delayMs: number): ReturnType<typeof setInterval>;
  clearInterval(handle: ReturnType<typeof setInterval>): void;
}
interface AgentPresenceRuntimeDependencies {
  loadDisplayName(authority: Authority): Promise<string>;
  createTransport(circleId: string, authority: Authority): Promise<AgentPresenceTransport>;
  setInterval(callback: () => void, delayMs: number): ReturnType<typeof setInterval>;
  clearInterval(handle: ReturnType<typeof setInterval>): void;
  setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  clearTimeout(handle: ReturnType<typeof setTimeout>): void;
  random(): number;
}

const require = createRequire(import.meta.url);

function loadRuntimeModules(): {
  createAgentHeartbeatRuntime: any;
  createAgentPresenceRuntime: any;
} {
  const Module = require('node:module') as { _load: (...args: unknown[]) => unknown };
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request: unknown, parent: unknown, isMain: unknown) {
    if (request === 'react-native') return { Platform: { OS: 'web' } };
    if (request === './supabase' || request === '../lib/supabase') {
      const query: any = new Proxy({}, {
        get: () => () => query,
      });
      return {
        supabase: {
          auth: {
            getSession: async () => ({ data: { session: null }, error: null }),
            getUser: async () => ({ data: { user: null }, error: null }),
          },
          from: () => query,
        },
      };
    }
    if (request === './circleOffice') {
      return {
        publishAgentToCircle: async () => null,
        PROVIDER_DISPLAY: {
          'generic-agent': { icon: 'G', color: '#fff' },
        },
      };
    }
    return originalLoad.apply(this, [request, parent, isMain]);
  };
  try {
    const heartbeat = require('../src/lib/agentHeartbeat') as any;
    const presence = require('../src/lib/agentPresence') as any;
    return {
      createAgentHeartbeatRuntime: heartbeat.createAgentHeartbeatRuntime,
      createAgentPresenceRuntime: presence.createAgentPresenceRuntime,
    };
  } finally {
    Module._load = originalLoad;
  }
}

const { createAgentHeartbeatRuntime, createAgentPresenceRuntime } = loadRuntimeModules();

type Authority = Readonly<{ userId: string; accessToken: string; displayName?: string }>;

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise<void>((resolve) => setImmediate(resolve));
}

async function testHeartbeatLifecycle(): Promise<number> {
  const authorityA: Authority = { userId: 'user-a', accessToken: 'token-a' };
  const authorityB: Authority = { userId: 'user-b', accessToken: 'token-b' };
  const events: string[] = [];
  const intervalCallbacks = new Map<number, () => void>();
  let nextIntervalId = 0;
  const releaseA = deferred();
  let blockFirstA = true;

  const dependencies: AgentHeartbeatRuntimeDependencies = {
    async autoPublish(circleId, _connections, authority, isCurrent) {
      events.push(`publish:${authority.userId}:${authority.accessToken}:${circleId}`);
      if (authority.userId === authorityA.userId && blockFirstA) {
        blockFirstA = false;
        await releaseA.promise;
      }
      events.push(`publish-current:${authority.userId}:${isCurrent()}`);
    },
    async wakeOffline(circleId, authority) {
      events.push(`wake:${authority.userId}:${authority.accessToken}:${circleId}`);
    },
    async touchBuilding(circleId, authority) {
      events.push(`building:${authority.userId}:${authority.accessToken}:${circleId}`);
    },
    async ping(circleId, authority) {
      events.push(`ping:${authority.userId}:${authority.accessToken}:${circleId}`);
    },
    async markIdle(circleId, authority) {
      events.push(`idle:${authority.userId}:${authority.accessToken}:${circleId}`);
    },
    setInterval(callback) {
      const id = ++nextIntervalId;
      intervalCallbacks.set(id, callback);
      return id as unknown as ReturnType<typeof setInterval>;
    },
    clearInterval(handle) {
      intervalCallbacks.delete(handle as unknown as number);
    },
  };

  const runtime = createAgentHeartbeatRuntime(dependencies);
  const startA = runtime.start('circle-shared', [], authorityA);
  await flush();
  const cleanupB = await runtime.start('circle-shared', [], authorityB);
  assert.equal(runtime.getActiveScopeKeys().length, 2, 'a delayed account-A start does not block account B in the same circle');
  assert(events.includes('ping:user-b:token-b:circle-shared'), 'B pings with B captured bearer while A remains delayed');

  releaseA.resolve();
  const cleanupA = await startA;
  assert(events.includes('ping:user-a:token-a:circle-shared'), 'A eventually pings with A captured bearer');

  await cleanupA();
  assert.equal(runtime.getActiveScopeKeys().length, 1, 'A cleanup removes only A scope');
  assert(runtime.getActiveScopeKeys()[0]?.includes('user-b'), 'B lifecycle survives late A cleanup');
  assert(events.includes('idle:user-a:token-a:circle-shared'), 'A cleanup binds A bearer for final idle write');
  assert(!events.includes('idle:user-b:token-b:circle-shared'), 'A cleanup never idles B');

  const cleanupOldB = cleanupB;
  const cleanupNewB = await runtime.start('circle-shared', [], authorityB);
  await cleanupOldB();
  assert.equal(runtime.getActiveScopeKeys().length, 1, 'old same-scope cleanup cannot retire a replacement generation');
  assert(runtime.getActiveScopeKeys()[0]?.includes('user-b'), 'replacement generation remains B-owned');

  const pingCountBeforeTimers = events.filter((event) => event.startsWith('ping:user-b:')).length;
  for (const callback of intervalCallbacks.values()) callback();
  await flush();
  const pingCountAfterTimers = events.filter((event) => event.startsWith('ping:user-b:')).length;
  assert.equal(pingCountAfterTimers, pingCountBeforeTimers + 1, 'only the active replacement timer may ping');

  await cleanupNewB();
  assert.equal(runtime.getActiveScopeKeys().length, 0, 'all exact heartbeat scopes can be retired');
  return 13;
}

class FakePresenceChannel implements AgentPresenceChannelAdapter {
  readonly handlers = new Map<string, Array<(payload?: any) => void>>();
  readonly tracked: AgentPresencePayload[] = [];
  state: PresenceState = {};
  statusCallback: ((status: string) => void) | null = null;

  on(
    _eventType: string,
    filter: Record<string, unknown>,
    callback: (payload?: any) => void,
  ): AgentPresenceChannelAdapter {
    const event = String(filter.event || '');
    const existing = this.handlers.get(event) || [];
    existing.push(callback);
    this.handlers.set(event, existing);
    return this;
  }

  subscribe(callback: (status: string) => void): void {
    this.statusCallback = callback;
  }

  async track(payload: AgentPresencePayload): Promise<void> {
    this.tracked.push(payload);
  }

  presenceState<T extends Record<string, unknown>>(): Record<string, T[]> {
    return this.state as unknown as Record<string, T[]>;
  }

  emit(event: 'sync' | 'join' | 'leave', payload?: unknown): void {
    for (const callback of this.handlers.get(event) || []) callback(payload);
  }

  emitStatus(status: string): void {
    this.statusCallback?.(status);
  }
}

async function testPresenceLifecycle(): Promise<number> {
  const authorityA: Authority = { userId: 'user-a', accessToken: 'token-a', displayName: 'A' };
  const authorityB: Authority = { userId: 'user-b', accessToken: 'token-b', displayName: 'B' };
  const transports: Array<{
    authority: Authority;
    circleId: string;
    channel: FakePresenceChannel;
    closed: boolean;
  }> = [];
  const intervalCallbacks = new Map<number, () => void>();
  const timeoutCallbacks = new Map<number, () => void>();
  const allTimeoutCallbacks = new Map<number, () => void>();
  let nextTimerId = 0;
  const releaseDisplayA = deferred();
  let blockFirstA = true;

  const dependencies: AgentPresenceRuntimeDependencies = {
    async loadDisplayName(authority) {
      if (authority.userId === authorityA.userId && blockFirstA) {
        blockFirstA = false;
        await releaseDisplayA.promise;
      }
      return authority.displayName || authority.userId;
    },
    async createTransport(circleId, authority): Promise<AgentPresenceTransport> {
      const record = {
        authority,
        circleId,
        channel: new FakePresenceChannel(),
        closed: false,
      };
      transports.push(record);
      return {
        channel: record.channel,
        async close() { record.closed = true; },
      };
    },
    setInterval(callback) {
      const id = ++nextTimerId;
      intervalCallbacks.set(id, callback);
      return id as unknown as ReturnType<typeof setInterval>;
    },
    clearInterval(handle) {
      intervalCallbacks.delete(handle as unknown as number);
    },
    setTimeout(callback) {
      const id = ++nextTimerId;
      timeoutCallbacks.set(id, callback);
      allTimeoutCallbacks.set(id, callback);
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout(handle) {
      timeoutCallbacks.delete(handle as unknown as number);
    },
    random: () => 0,
  };

  const callbacksAEvents: string[] = [];
  const callbacksBEvents: string[] = [];
  const callbacks = (events: string[]) => ({
    onSync: () => events.push('sync'),
    onJoin: (userId: string) => events.push(`join:${userId}`),
    onLeave: (userId: string) => events.push(`leave:${userId}`),
    onConnectionStatus: (status: string) => events.push(`status:${status}`),
  });
  const agents: AgentLiveState[] = [{
    agentId: 'agent-1',
    name: 'Agent',
    provider: 'openswan',
    toolIcon: 'S',
    color: '#fff',
    status: 'idle',
  }];

  const runtime = createAgentPresenceRuntime(dependencies);
  const startA = runtime.join('circle-shared', agents, callbacks(callbacksAEvents), authorityA);
  await flush();
  const cleanupB = await runtime.join('circle-shared', agents, callbacks(callbacksBEvents), authorityB);
  assert.equal(runtime.getActiveScopeKeys().length, 2, 'a delayed A profile load does not block B presence in the same circle');
  assert.equal(transports.length, 1, 'B transport opens independently while A is delayed');
  assert.deepEqual(transports[0]?.authority, authorityB, 'B transport receives the exact B authority snapshot');

  releaseDisplayA.resolve();
  const cleanupA = await startA;
  assert.equal(transports.length, 2, 'A transport opens after its own exact load completes');
  assert.deepEqual(transports[1]?.authority, authorityA, 'A transport receives the exact A authority snapshot');

  transports[0]!.channel.emitStatus('SUBSCRIBED');
  transports[1]!.channel.emitStatus('SUBSCRIBED');
  await flush();
  assert(callbacksAEvents.includes('status:live'), 'A receives its own live status');
  assert(callbacksBEvents.includes('status:live'), 'B receives its own live status');

  await cleanupA();
  assert.equal(runtime.getActiveScopeKeys().length, 1, 'A presence cleanup removes only A scope');
  assert.equal(transports[1]?.closed, true, 'A transport is closed');
  assert.equal(transports[0]?.closed, false, 'B transport survives A cleanup');

  const oldBChannel = transports[0]!.channel;
  const cleanupNewB = await runtime.join('circle-shared', agents, callbacks(callbacksBEvents), authorityB);
  const newBTransport = transports[2]!;
  const callbackCountBeforeStaleEvents = callbacksBEvents.length;
  oldBChannel.emit('sync');
  oldBChannel.emit('join', { key: 'stale-user', newPresences: [{ userId: 'stale-user' }] });
  oldBChannel.emitStatus('CHANNEL_ERROR');
  await flush();
  assert.equal(callbacksBEvents.length, callbackCountBeforeStaleEvents, 'retired channel callbacks cannot mutate the replacement lifecycle');
  await cleanupB();
  assert(runtime.getActiveScopeKeys()[0]?.includes('user-b'), 'old B cleanup cannot close the replacement B generation');
  assert.equal(newBTransport.closed, false, 'replacement B transport remains open after old cleanup');

  newBTransport.channel.emitStatus('CHANNEL_ERROR');
  assert.equal(timeoutCallbacks.size, 1, 'active channel error schedules one bounded reconnect');
  const staleReconnect = Array.from(allTimeoutCallbacks.values()).at(-1)!;
  const cleanupNewestB = await runtime.join('circle-shared', agents, callbacks(callbacksBEvents), authorityB);
  const transportCountBeforeStaleReconnect = transports.length;
  staleReconnect();
  await flush();
  assert.equal(transports.length, transportCountBeforeStaleReconnect, 'retired reconnect timer cannot resurrect an older lifecycle');
  await cleanupNewB();
  assert.equal(runtime.getActiveScopeKeys().length, 1, 'prior replacement cleanup cannot close newest B generation');
  await cleanupNewestB();
  assert.equal(runtime.getActiveScopeKeys().length, 0, 'newest exact presence lifecycle can be retired');
  return 19;
}

async function main(): Promise<void> {
  let assertions = 0;
  assertions += await testHeartbeatLifecycle();
  assertions += await testPresenceLifecycle();

  const heartbeatSource = readFileSync(new URL('../src/lib/agentHeartbeat.ts', import.meta.url), 'utf8');
  const presenceSource = readFileSync(new URL('../src/lib/agentPresence.ts', import.meta.url), 'utf8');
  assert(!heartbeatSource.includes('supabase.auth.getUser()'), 'heartbeat never rereads mutable global user auth');
  assert(!presenceSource.includes('supabase.auth.getUser()'), 'presence never rereads mutable global user auth');
  assert((heartbeatSource.match(/\.setHeader\('Authorization', `Bearer \$\{authority\.accessToken\}`\)/g) || []).length >= 5,
    'every heartbeat database lane binds the captured bearer explicitly');
  assert(presenceSource.includes('new RealtimeClient(') && presenceSource.includes('await client.setAuth(authority.accessToken)'),
    'presence uses a dedicated Realtime client pinned to the captured bearer');
  assert(presenceSource.includes(".setHeader('Authorization', `Bearer ${authority.accessToken}`)"),
    'presence profile enrichment binds the captured bearer explicitly');
  assertions += 5;

  console.log(`office presence/heartbeat authority smoke passed (${assertions} assertions)`);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
