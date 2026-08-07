import type { AuthError } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { removeStorageKeysByPrefix } from './storage';

export type AuthSignOutScope = 'global' | 'local' | 'others';

export interface AuthLogoutCleanupResult {
  completed: string[];
  failed: string[];
}

const AUTH_SESSION_STORAGE_PREFIXES = [
  'computer_task_grants_v1_',
  'computer_task_state_v1_',
  '@chat_session_archive_v1:',
  'uc_agent_history_',
  'uc_mem_extract_',
  'uc_chat_failure_ledger::',
  'uc_pending_clarifications::',
  'uc_last_app_resolution::',
  'uc_chat_active_thread::',
  'uc_circle_cache_',
  'uc_circles_cache_v1:',
  '@office_conversation_log',
  '@office_session_cache',
  '@office_terminal_history',
  '@local_secret:office_connection:',
] as const;

async function resolveCurrentUserId(timeoutMs = 500): Promise<string | null> {
  try {
    const result = await Promise.race([
      supabase.auth.getSession(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
    if (!result) return null;
    return result.data.session?.user?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Remove only session data and locally reusable execution authority. Durable
 * server content, memories, tasks, and saved account preferences are not
 * deleted. The cleanup is idempotent and fail-soft so an unavailable local
 * bridge can never prevent the Supabase session from being revoked.
 */
export async function clearLocalAuthResidualAuthority(
  userId?: string | null,
): Promise<AuthLogoutCleanupResult> {
  const completed: string[] = [];
  const failed: string[] = [];
  const attempt = async (label: string, operation: () => void | Promise<void>): Promise<void> => {
    try {
      await operation();
      completed.push(label);
    } catch {
      failed.push(label);
    }
  };

  // Stop new local work before clearing bearer state. These imports are lazy so
  // a user who logs out before entering Chat does not load the agent runtime.
  await attempt('agent-auto-connect', async () => {
    const { stopAgentAutoConnect } = await import('./agentAutoConnect');
    stopAgentAutoConnect();
  });
  await Promise.all([
    attempt('swanbot-session-context', async () => {
      const { clearLocalSwanBotSessionState } = await import('./swanbot');
      clearLocalSwanBotSessionState();
    }),
    attempt('chat-recording-state', async () => {
      const { clearRecordingStateForLogout } = await import('./chatRecording');
      clearRecordingStateForLogout(userId);
    }),
    attempt('standing-computer-grants', async () => {
      const { revokeAllActiveStickyAllowScopes } = await import('./computerGrantGateStore');
      await revokeAllActiveStickyAllowScopes(userId);
    }),
    attempt('connected-agent-secrets', async () => {
      const { clearLocalAgentConnectionsForLogout } = await import('./connectionManager');
      await clearLocalAgentConnectionsForLogout();
    }),
    attempt('session-storage', async () => {
      await removeStorageKeysByPrefix(AUTH_SESSION_STORAGE_PREFIXES);
    }),
    attempt('desktop-file-grant', async () => {
      const { clearLocalFileSessionGrant } = await import('./desktopBridge');
      clearLocalFileSessionGrant();
    }),
    attempt('bridge-auth-cache', async () => {
      const { clearBridgeAuthStateForLogout } = await import('./bridgeAuth');
      await clearBridgeAuthStateForLogout();
    }),
    attempt('desktop-bridge-token', async () => {
      const { clearDesktopBridgeTokenForLogout } = await import('./desktopBridge');
      await clearDesktopBridgeTokenForLogout();
    }),
  ]);

  return { completed, failed };
}

/**
 * Canonical sign-out entrypoint. Local execution authority is cleared in
 * parallel with Supabase revocation; cleanup failures are reported but never
 * used to keep the account signed in.
 */
export async function secureSignOut(options: {
  scope?: AuthSignOutScope;
  userId?: string | null;
} = {}): Promise<{ error: AuthError | null; cleanup: AuthLogoutCleanupResult }> {
  const userId = options.userId ?? await resolveCurrentUserId();
  const cleanupPromise = clearLocalAuthResidualAuthority(userId);
  let signOutResult: Awaited<ReturnType<typeof supabase.auth.signOut>>;
  try {
    signOutResult = await supabase.auth.signOut({ scope: options.scope ?? 'local' });
  } finally {
    // If GoTrue throws instead of returning an AuthError, still finish cleanup
    // before propagating the exception to the caller.
    await cleanupPromise;
  }
  return {
    error: signOutResult.error,
    cleanup: await cleanupPromise,
  };
}
