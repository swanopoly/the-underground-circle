/**
 * agentDispatch — universal "assign this task to that agent" routing.
 *
 * Resolves a session name across every source UC knows about (live
 * bridges, circle_office_agents, connections, BlackSwan default), then
 * dispatches the task by capability. Adding a new agentic AI is a
 * matter of writing a bridge that implements the protocol — the
 * dispatcher walks BRIDGE_CATALOG generically.
 *
 * Spec: docs/superpowers/specs/2026-04-30-agent-dispatch-design.md
 */
import { BRIDGE_CATALOG, probeBridges, type BridgeProbeResult, type BridgeName, type BridgeCapability } from './bridgeHealthDiag';

export type DispatchVerb = 'spawn' | 'send' | 'queue' | 'auto';

export interface SessionRef {
  /** Where the session lives. The string identifiers are deliberately
   *  open: future bridges can register custom kinds without expanding
   *  this union (see "byo:<connection-id>"). */
  bridge: BridgeName | 'circle_office' | 'openswan' | 'blackswan' | string;
  sessionId: string;
  sessionName: string;
  projectDir?: string;
  status?: 'active' | 'idle' | 'offline' | 'unknown';
  /** Bridge URL when applicable, so the dispatcher can hit /spawn etc.
   *  without re-resolving from the catalog. */
  bridgeUrl?: string;
  /** Capabilities the bridge declares (or we infer pre-spec). Lets the
   *  dispatcher pick spawn / send / queue without hardcoding. */
  capabilities: BridgeCapability[];
}

export interface DispatchInput {
  session: SessionRef;
  task: string;
  preferredVerb?: DispatchVerb;
  /** Optional: include circle context for OpenSwan / BlackSwan dispatch. */
  circleId?: string;
  userId?: string;
}

export interface DispatchResult {
  ok: boolean;
  kind: 'spawn' | 'send' | 'queue' | 'rejected';
  sessionId?: string;
  pid?: number;
  logFile?: string;
  message: string;
  pollUrl?: string;
  error?: string;
}

// Pre-spec capability inference — same table as bridgeHealthDiag's
// bridgesWithCapability fallback, extended with the dispatch:* tokens.
// Once every bridge advertises capabilities, this becomes a no-op.
const PRE_CAPABILITY_INFERENCE: Record<BridgeName | 'circle_office' | 'openswan' | 'blackswan' | 'byo', BridgeCapability[]> = {
  'claude-code':    ['sessions', 'exec', 'exec/stream', 'spawn'],
  'codex':          ['sessions', 'exec/stream', 'register', 'update'],
  'gemini-cli':     ['sessions'],
  'cursor':         ['sessions', 'register', 'update'],
  'openswan-proxy': [],
  'circle_office':  [],
  'openswan':       ['sessions'],
  'blackswan':      [],
  'byo':            [],
};

function inferredCapabilities(bridge: string): BridgeCapability[] {
  return (PRE_CAPABILITY_INFERENCE as any)[bridge] || [];
}

// ─── Resolver ───────────────────────────────────────────────────────────────

/**
 * Probe every source we know about and return all sessions whose name
 * (or id, slug, or display name) matches the query. Caller disambiguates.
 *
 * Sources walked in parallel:
 *   1. Healthy bridges with sessions capability → /sessions
 *   2. (future) circle_office_agents — caller injects via opts
 *   3. (future) connections — caller injects via opts
 *   4. Hardcoded BlackSwan / SwanBot aliases
 */
export async function resolveSessions(opts: {
  query: string;
  /** Caller-provided list of additional candidates from DB sources we
   *  can't query without supabase deps. Keeps this module RN-free. */
  extraSessions?: SessionRef[];
}): Promise<SessionRef[]> {
  const q = (opts.query || '').trim().toLowerCase();
  if (!q) return [];

  const probes = await probeBridges({ timeoutMs: 2500 });
  const live: SessionRef[] = [];

  // For every healthy bridge with `sessions` capability, fetch /sessions.
  await Promise.all(
    probes.map(async (probe) => {
      if (probe.status === 'offline') return;
      const caps = (probe.capabilities && probe.capabilities.length > 0)
        ? probe.capabilities
        : inferredCapabilities(probe.name);
      if (!caps.includes('sessions')) return;
      const entry = BRIDGE_CATALOG.find(e => e.name === probe.name);
      if (!entry?.sessionsUrl) return;
      try {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 2500);
        const res = await fetch(entry.sessionsUrl, { signal: ac.signal });
        clearTimeout(timer);
        if (!res.ok) return;
        const data = await res.json().catch(() => null);
        const rows: any[] = (data?.sessions || []) as any[];
        for (const row of rows) {
          const sessionName = String(row.slug || row.sessionName || row.sessionId || '');
          if (!sessionName) continue;
          live.push({
            bridge: probe.name,
            sessionId: String(row.sessionId || row.id || sessionName),
            sessionName,
            projectDir: typeof row.projectDir === 'string' ? row.projectDir : undefined,
            status: typeof row.status === 'string' ? (row.status as any) : 'unknown',
            bridgeUrl: entry.sessionsUrl.replace(/\/sessions$/, ''),
            capabilities: caps,
          });
        }
      } catch {
        // Bridge non-responsive — skip silently.
      }
    }),
  );

  // BlackSwan default — always present, name-matched against common aliases.
  const BLACKSWAN_ALIASES = ['blackswan', 'swanbot', 'swan', 'bs'];
  const blackswanRef: SessionRef = {
    bridge: 'blackswan',
    sessionId: 'blackswan:default',
    sessionName: 'BlackSwan',
    capabilities: ['exec', 'exec/stream'] as BridgeCapability[],   // logical; routes through chat-stream
    status: 'active',
  };

  const all = [...live, ...(opts.extraSessions || []), blackswanRef];

  // Match in order of specificity: exact > slug fuzzy > friendly > display name.
  const lower = (s: string) => (s || '').toLowerCase();
  const exact = all.filter(s => lower(s.sessionName) === q || lower(s.sessionId) === q);
  if (exact.length > 0) return exact;

  const slug = all.filter(s => lower(s.sessionName).includes(q) || lower(s.sessionId).includes(q));
  if (slug.length > 0) return slug;

  const friendly = all.filter(s => {
    if (s.bridge === 'blackswan' && BLACKSWAN_ALIASES.includes(q)) return true;
    if (typeof s.bridge === 'string' && lower(s.bridge).includes(q)) return true;
    return false;
  });
  return friendly;
}

// ─── Dispatcher ─────────────────────────────────────────────────────────────

/**
 * Dispatch a task to a resolved session. Picks the right endpoint based
 * on the session's capabilities + the user's preferred verb. Falls back
 * gracefully when a verb isn't supported (returns kind: 'queue' with a
 * clear message rather than failing).
 */
export async function dispatchToSession(input: DispatchInput): Promise<DispatchResult> {
  const { session, task, preferredVerb = 'auto' } = input;
  if (!task.trim()) {
    return { ok: false, kind: 'rejected', message: 'Empty task body — nothing to dispatch.', error: 'empty_task' };
  }

  const caps = session.capabilities;
  const canSpawn = caps.includes('spawn' as any);
  const canSend  = caps.includes('exec' as any) || caps.includes('exec/stream' as any) || session.bridge === 'blackswan' || session.bridge === 'openswan';
  const canQueue = caps.includes('register' as any) || caps.includes('update' as any);

  // Pick a verb based on preference + availability.
  let verb: DispatchVerb;
  if (preferredVerb === 'auto') {
    verb = canSpawn ? 'spawn' : canSend ? 'send' : canQueue ? 'queue' : 'spawn';
  } else {
    verb = preferredVerb;
  }

  // ─ Spawn (Claude Code primary; future bridges that implement /spawn) ─
  if (verb === 'spawn' && canSpawn && session.bridgeUrl) {
    try {
      const res = await fetch(`${session.bridgeUrl}/spawn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task, count: 1 }),
      });
      if (!res.ok) {
        return { ok: false, kind: 'rejected', message: `Bridge rejected /spawn: HTTP ${res.status}`, error: `http_${res.status}` };
      }
      const data: any = await res.json();
      const spawned = (data?.results && Array.isArray(data.results)) ? data.results[0] : data;
      return {
        ok: !!data?.ok,
        kind: 'spawn',
        sessionId: spawned?.sessionId || data?.sessionId,
        pid: typeof spawned?.pid === 'number' ? spawned.pid : undefined,
        logFile: typeof spawned?.logFile === 'string' ? spawned.logFile : undefined,
        message: data?.ok
          ? `Spawned ${session.bridge} session for task "${task.slice(0, 60)}"`
          : (data?.error || 'spawn failed'),
        pollUrl: spawned?.logFile ? `${session.bridgeUrl}/spawn/status` : undefined,
      };
    } catch (err: any) {
      return { ok: false, kind: 'rejected', message: 'Spawn failed: ' + (err?.message || 'unknown'), error: err?.message };
    }
  }

  // ─ Send (BlackSwan / OpenSwan / future bridges with /send) ─
  if (verb === 'send') {
    if (session.bridge === 'blackswan') {
      // BlackSwan dispatch is handled by the caller (ChatTab) since it
      // needs the chat surface state. Return a "redirect" outcome the
      // caller knows to interpret as "drive this through normal chat".
      return {
        ok: true,
        kind: 'send',
        message: `Routing to BlackSwan: ${task.slice(0, 60)}`,
        sessionId: 'blackswan:default',
      };
    }
    if (session.bridge === 'openswan') {
      // OpenSwan send needs the openswanService config; defer to caller.
      return {
        ok: true,
        kind: 'send',
        message: `Routing to OpenSwan session ${session.sessionName}`,
        sessionId: session.sessionId,
      };
    }
    if (session.bridgeUrl) {
      try {
        const sendUrl = `${session.bridgeUrl}/send`;
        const res = await fetch(sendUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: session.sessionId, prompt: task, message: task }),
        });
        if (res.ok) {
          const data: any = await res.json().catch(() => ({}));
          return { ok: true, kind: 'send', sessionId: session.sessionId, message: `Sent to ${session.sessionName}` , error: data?.error };
        }
        return { ok: false, kind: 'rejected', message: `Bridge rejected /send: HTTP ${res.status}`, error: `http_${res.status}` };
      } catch (err: any) {
        return { ok: false, kind: 'rejected', message: 'Send failed: ' + (err?.message || 'unknown'), error: err?.message };
      }
    }
  }

  // ─ Queue (Codex / Cursor — push state to the bridge so the user sees
  //   the task next time they open the CLI) ─
  if (verb === 'queue' && canQueue && session.bridgeUrl) {
    try {
      const updateUrl = `${session.bridgeUrl}/update`;
      const res = await fetch(updateUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.sessionId, task }),
      });
      if (res.ok) {
        return {
          ok: true,
          kind: 'queue',
          sessionId: session.sessionId,
          message: `Queued for ${session.sessionName} — visible next time you open the CLI`,
        };
      }
      return { ok: false, kind: 'rejected', message: `Bridge rejected /update: HTTP ${res.status}`, error: `http_${res.status}` };
    } catch (err: any) {
      return { ok: false, kind: 'rejected', message: 'Queue failed: ' + (err?.message || 'unknown'), error: err?.message };
    }
  }

  return {
    ok: false,
    kind: 'rejected',
    message: `${session.bridge} doesn't support ${verb} dispatch. Capabilities: ${caps.join(', ') || '(none)'}.`,
    error: 'capability_missing',
  };
}
