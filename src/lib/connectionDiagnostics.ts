/**
 * connectionDiagnostics.ts
 *
 * Detects WHY a connection failed and returns an actionable fix.
 * Used by the setup wizard and connection panel to give users
 * specific steps instead of generic error messages.
 */

export type DiagnosticErrorCode =
  | 'cors'
  | 'refused'
  | 'auth'
  | 'timeout'
  | 'proxy_incompatible'
  | 'proxy_missing'
  | 'unknown';

export interface DiagnosticResult {
  ok: boolean;
  errorCode?: DiagnosticErrorCode;
  message: string;
  fix: string;
  fixAction?: 'copy_command' | 'open_url' | 'none';
  fixValue?: string;
  sessionCount?: number;
}

// ─── Main diagnostic function ─────────────────────────────────────────────────

export async function diagnoseConnection(
  endpoint: string,
  token: string
): Promise<DiagnosticResult> {
  const url = endpoint.replace(/\/$/, '');

  try {
    const res = await fetch(`${url}/tools/invoke`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ tool: 'sessions_list', args: { limit: 1 } }),
      signal: AbortSignal.timeout(8000),
    });

    // Server responded — check auth / route compatibility
    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        errorCode: 'auth',
        message: 'Authentication failed — wrong or missing token',
        fix: 'Get your token with this command:',
        fixAction: 'copy_command',
        fixValue: getTokenHint(),
      };
    }

    if (res.status === 404 || res.status === 405) {
      return {
        ok: false,
        errorCode: 'proxy_incompatible',
        message: 'Endpoint responded, but it does not support OpenSwan tool RPCs',
        fix: 'Point this connection at a compatible OpenSwan gateway/proxy endpoint',
        fixAction: 'none',
      };
    }

    // Any other response means server is reachable
    const sessionCount = await tryParseSessionCount(res);
    return {
      ok: true,
      message: 'Connected successfully',
      fix: '',
      sessionCount,
    };
  } catch (err: any) {
    // Timeout
    if (err?.name === 'AbortError' || err?.name === 'TimeoutError') {
      return {
        ok: false,
        errorCode: 'timeout',
        message: 'No response after 8 seconds',
        fix: 'Make sure OpenSwan gateway is running:',
        fixAction: 'copy_command',
        fixValue: 'openswan gateway start',
      };
    }

    // Network error — try to distinguish CORS vs fully refused
    if (
      err?.message?.includes('Failed to fetch') ||
      err?.message?.includes('Network request failed') ||
      err?.message?.includes('fetch') ||
      err?.name === 'TypeError'
    ) {
      // Try a no-cors probe to see if the server is actually up
      const serverUp = await probeNoAuth(url);

      if (serverUp) {
        // Server is up but CORS is blocking our request → need proxy
        return {
          ok: false,
          errorCode: 'cors',
          message: 'Server is running but CORS is blocking the request',
          fix: 'Start the CORS proxy in your project folder:',
          fixAction: 'copy_command',
          fixValue: 'node openswan-proxy.js',
        };
      }

      // Server is completely unreachable
      return {
        ok: false,
        errorCode: 'refused',
        message: `Cannot reach ${url}`,
        fix: 'OpenSwan isn\'t running. Start it:',
        fixAction: 'copy_command',
        fixValue: 'openswan gateway start',
      };
    }

    return {
      ok: false,
      errorCode: 'unknown',
      message: err?.message || 'Unknown error',
      fix: 'Check that OpenSwan is running and the endpoint is correct',
      fixAction: 'none',
    };
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function probeNoAuth(url: string): Promise<boolean> {
  try {
    // no-cors lets us see if the server responds at all (even with opaque result)
    const res = await fetch(`${url}/health`, {
      mode: 'no-cors',
      signal: AbortSignal.timeout(3000),
    });
    // If we get here (even with opaque), server is up
    return res.type === 'opaque' || res.ok;
  } catch {
    return false;
  }
}

async function tryParseSessionCount(res: Response): Promise<number | undefined> {
  try {
    const data = await res.clone().json();
    const sessions =
      data?.result?.details?.sessions ||
      data?.result?.sessions ||
      data?.sessions;
    if (Array.isArray(sessions)) return sessions.length;
  } catch {}
  return undefined;
}

export function getTokenHint(): string {
  return "cat ~/.openswan/openswan.json | grep gatewayToken";
}

// ─── Friendly label for error codes ──────────────────────────────────────────

export function errorCodeLabel(code: DiagnosticErrorCode): string {
  switch (code) {
    case 'cors':          return 'CORS blocked';
    case 'refused':       return 'Connection refused';
    case 'auth':          return 'Auth failed';
    case 'timeout':       return 'Timed out';
    case 'proxy_incompatible': return 'Wrong gateway route';
    case 'proxy_missing': return 'Proxy not running';
    default:              return 'Connection error';
  }
}
