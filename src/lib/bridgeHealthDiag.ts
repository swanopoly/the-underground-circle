/**
 * bridgeHealthDiag — single-call health probe across every local agent
 * bridge the app discovers from. Built after a 2026-04-23/24 incident
 * where the Feed looked sparse and the user had no way to tell which
 * bridge was the problem (turned out: Gemini CLI wasn't authed). This
 * module returns a structured snapshot so future "is everything
 * connected?" questions are one tool call away.
 *
 * Contract:
 *   - `BRIDGE_CATALOG` is the source of truth for which bridges exist.
 *     Mirrors the URLs hardcoded in `claude-bridge.js`, `codex-bridge.js`,
 *     `gemini-bridge.js`, `cursor-bridge.js`, `openswan-proxy.js`.
 *   - `probeBridges(fetchImpl)` calls each `/health` in parallel,
 *     classifies the response shape via `parseBridgeHealth`, and
 *     returns `BridgeProbeResult[]`.
 *   - `parseBridgeHealth(name, raw)` is pure — given a JSON body it
 *     extracts session count, auth state, and any actionable hint.
 *     Smoke-testable without real network.
 *   - `summarizeBridgeProbes(results)` formats a one-screen
 *     human-readable report (used by `scripts/check-bridges.ts`).
 *
 * No DOM / Supabase deps so it imports cleanly into the Node CLI
 * runner. The caller injects `fetchImpl` so we can mock it in tests.
 */

export type BridgeName = 'claude-code' | 'codex' | 'gemini-cli' | 'cursor' | 'openswan-proxy';

export interface BridgeCatalogEntry {
  name: BridgeName;
  /** Display label for terminal output. */
  label: string;
  port: number;
  /** Endpoint we probe to classify health. Always has a `/health` shape. */
  healthUrl: string;
  /** Optional secondary endpoint for richer session listing. */
  sessionsUrl?: string;
  /** Process command users should restart when this bridge is offline. */
  restartCommand: string;
}

export const BRIDGE_CATALOG: readonly BridgeCatalogEntry[] = [
  {
    name: 'claude-code',
    label: 'Claude Code',
    port: 7778,
    healthUrl: 'http://localhost:7778/health',
    sessionsUrl: 'http://localhost:7778/sessions',
    restartCommand: 'node scripts/claude-bridge.js',
  },
  {
    name: 'codex',
    label: 'Codex',
    port: 7779,
    healthUrl: 'http://localhost:7779/health',
    sessionsUrl: 'http://localhost:7779/sessions',
    restartCommand: 'node scripts/codex-bridge.js',
  },
  {
    name: 'gemini-cli',
    label: 'Gemini CLI',
    port: 7780,
    healthUrl: 'http://localhost:7780/health',
    sessionsUrl: 'http://localhost:7780/sessions',
    restartCommand: 'node scripts/gemini-bridge.js',
  },
  {
    name: 'cursor',
    label: 'Cursor',
    port: 7781,
    healthUrl: 'http://localhost:7781/health',
    sessionsUrl: 'http://localhost:7781/sessions',
    restartCommand: 'node scripts/cursor-bridge.js',
  },
  {
    name: 'openswan-proxy',
    label: 'OpenSwan Proxy',
    port: 18790,
    healthUrl: 'http://localhost:18790/health',
    restartCommand: 'node openswan-proxy.js',
  },
] as const;

export type BridgeStatus = 'healthy' | 'degraded' | 'offline';

export interface BridgeProbeResult {
  name: BridgeName;
  label: string;
  port: number;
  status: BridgeStatus;
  /** Short human-readable line. */
  detail: string;
  /** Number of agent sessions exposed. Absent when the bridge has no
   *  notion of sessions (e.g. the proxy itself). */
  sessionCount?: number;
  /** True when the bridge runs but auth/login is missing. We treat
   *  this as `degraded` not `offline` — the bridge is up, the user
   *  just needs to authenticate. */
  authMissing?: boolean;
  /** Suggestion the user should act on. */
  hint?: string;
  /** Raw JSON body the parser saw, for debug. */
  raw?: unknown;
}

// ─── Pure parser ───────────────────────────────────────────────────

/**
 * Parse a `/health` response body into a probe result. Tolerant of the
 * fact that each bridge author chose slightly different field names —
 * Claude bridge uses `sessions: number`, Gemini uses
 * `{ sessions, auth, email }`, others may add their own.
 */
export function parseBridgeHealth(
  entry: BridgeCatalogEntry,
  raw: unknown,
): Omit<BridgeProbeResult, 'name' | 'label' | 'port'> {
  // The proxy doesn't track sessions — `{ ok: true }` means alive.
  if (entry.name === 'openswan-proxy') {
    if (raw && typeof raw === 'object' && (raw as any).ok === true) {
      return { status: 'healthy', detail: 'live (CORS + auth proxy)', raw };
    }
    return {
      status: 'offline',
      detail: 'health endpoint did not return { ok: true }',
      hint: `Restart with: ${entry.restartCommand}`,
      raw,
    };
  }

  if (!raw || typeof raw !== 'object' || (raw as any).ok !== true) {
    return {
      status: 'offline',
      detail: 'no response or malformed JSON',
      hint: `Restart with: ${entry.restartCommand}`,
      raw,
    };
  }

  const body = raw as Record<string, unknown>;
  const sessionCount = typeof body.sessions === 'number' ? body.sessions : undefined;
  const auth = typeof body.auth === 'string' ? body.auth : undefined;
  const email = typeof body.email === 'string' ? body.email : undefined;

  // Gemini reports `auth: 'none'` when the user hasn't logged in. The
  // bridge IS running but it can't expose anything until auth.
  const authMissing = auth === 'none' || (entry.name === 'gemini-cli' && !email);
  if (authMissing) {
    return {
      status: 'degraded',
      detail: `bridge up but not authenticated${auth ? ` (auth=${auth})` : ''}`,
      sessionCount: sessionCount ?? 0,
      authMissing: true,
      hint:
        entry.name === 'gemini-cli'
          ? 'Run `gemini auth login` in a terminal, then refresh.'
          : 'Authenticate the underlying CLI tool, then refresh.',
      raw,
    };
  }

  const detailParts: string[] = [];
  if (sessionCount !== undefined) detailParts.push(`${sessionCount} session${sessionCount === 1 ? '' : 's'}`);
  if (email) detailParts.push(email);
  const detail = detailParts.length > 0 ? detailParts.join(' · ') : 'healthy';

  return {
    status: 'healthy',
    detail,
    sessionCount,
    raw,
  };
}

// ─── Async probe ──────────────────────────────────────────────────

export interface ProbeOptions {
  /** Per-request timeout. Default 3s — bridges should respond instantly
   *  on localhost; anything slower is effectively offline. */
  timeoutMs?: number;
  /** Injectable fetch so smoke tests can mock without a real network. */
  fetchImpl?: typeof fetch;
  /** Optional runtime URL resolver. Defaults to the catalog's localhost URLs. */
  urlForPort?: (port: number, entry: BridgeCatalogEntry) => string | null | undefined;
}

export async function probeBridges(opts: ProbeOptions = {}): Promise<BridgeProbeResult[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 3000;
  return Promise.all(
    BRIDGE_CATALOG.map((entry) => probeOne(entry, fetchImpl, timeoutMs, opts.urlForPort)),
  );
}

async function probeOne(
  entry: BridgeCatalogEntry,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  urlForPort?: ProbeOptions['urlForPort'],
): Promise<BridgeProbeResult> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const baseUrl = urlForPort?.(entry.port, entry)?.replace(/\/$/, '');
  const healthUrl = baseUrl ? `${baseUrl}/health` : entry.healthUrl;
  try {
    const res = await fetchImpl(healthUrl, { signal: ac.signal });
    if (!res.ok) {
      return {
        name: entry.name,
        label: entry.label,
        port: entry.port,
        status: 'offline',
        detail: `HTTP ${res.status}`,
        hint: `Restart with: ${entry.restartCommand}`,
      };
    }
    const raw = await res.json().catch(() => null);
    const parsed = parseBridgeHealth(entry, raw);
    return { name: entry.name, label: entry.label, port: entry.port, ...parsed };
  } catch (err) {
    return {
      name: entry.name,
      label: entry.label,
      port: entry.port,
      status: 'offline',
      detail: err instanceof Error && err.name === 'AbortError'
        ? `timed out after ${timeoutMs}ms`
        : `connection failed: ${err instanceof Error ? err.message : String(err)}`,
      hint: `Restart with: ${entry.restartCommand}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ─── Pretty summary ───────────────────────────────────────────────

/**
 * Render the probe results as a multi-line plain-text block — same
 * shape regardless of caller (CLI, future chat command, future panel).
 */
export function summarizeBridgeProbes(results: BridgeProbeResult[]): string {
  const lines: string[] = [];
  const counts = { healthy: 0, degraded: 0, offline: 0 };
  for (const r of results) counts[r.status] += 1;
  lines.push(`Bridges: ${counts.healthy} healthy · ${counts.degraded} degraded · ${counts.offline} offline`);
  lines.push('');
  for (const r of results) {
    const icon = r.status === 'healthy' ? '✓' : r.status === 'degraded' ? '⚠' : '✗';
    lines.push(`${icon} ${r.label.padEnd(18)} :${r.port}  ${r.detail}`);
    if (r.hint) lines.push(`    → ${r.hint}`);
  }
  return lines.join('\n');
}
