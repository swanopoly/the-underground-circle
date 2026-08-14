import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Session, User } from '@supabase/supabase-js';
import {
  bootstrapValidatedAuthSessionCore,
  inspectAuthSessionCandidateCore,
  inspectBootstrapAuthSessionCore,
  validateAuthSessionCandidateCore,
} from '../src/lib/authBootstrapCore';
import {
  buildPasswordResetRedirect,
  getSafeAuthErrorMessage,
  isExistingAccountError,
  isPasswordRecoveryLocation,
  normalizeAuthEmail,
} from '../src/lib/authUiPolicy';

const user = { id: 'user-one', email: 'member@example.com' } as User;
const session = {
  access_token: 'access-token',
  refresh_token: 'refresh-token',
  expires_in: 3600,
  token_type: 'bearer',
  user,
} as Session;

async function main() {
  let userLookups = 0;
  const accepted = await validateAuthSessionCandidateCore(session, async () => {
    userLookups += 1;
    return { value: { ...user, email: 'fresh@example.com' } as User, error: null };
  });
  assert.equal(accepted?.user.email, 'fresh@example.com');
  assert.equal(userLookups, 1);

  const mismatched = await validateAuthSessionCandidateCore(session, async () => ({
    value: { ...user, id: 'different-user' } as User,
    error: null,
  }));
  assert.equal(mismatched, null, 'a cached session cannot admit a different verified user');

  const rejected = await validateAuthSessionCandidateCore(session, async () => ({
    value: null,
    error: new Error('verification unavailable'),
  }));
  assert.equal(rejected, null, 'legacy nullable validation still fails closed');

  const unavailable = await inspectAuthSessionCandidateCore(session, async () => ({
    value: null,
    error: new Error('verification unavailable'),
  }));
  assert.equal(unavailable.status, 'unavailable',
    'a network/lock failure is retryable and must not be mistaken for logout');

  const definitiveError = Object.assign(new Error('invalid token'), {
    name: 'AuthApiError',
    status: 401,
    code: 'bad_jwt',
  });
  const definitivelyRejected = await inspectAuthSessionCandidateCore(session, async () => ({
    value: null,
    error: definitiveError,
  }));
  assert.deepEqual(definitivelyRejected, {
    status: 'signed_out',
    session: null,
    reason: 'auth_rejected',
  }, 'a structured Auth rejection remains a real signed-out decision');

  userLookups = 0;
  const noCandidate = await validateAuthSessionCandidateCore(null, async () => {
    userLookups += 1;
    return { value: user, error: null };
  });
  assert.equal(noCandidate, null);
  assert.equal(userLookups, 0, 'signed-out bootstrap should not make a user request');

  const bootstrapped = await bootstrapValidatedAuthSessionCore(
    async () => ({ value: session, error: null }),
    async () => ({ value: user, error: null }),
  );
  assert.equal(bootstrapped?.user.id, user.id);

  const sessionLookupFailure = await bootstrapValidatedAuthSessionCore(
    async () => ({ value: session, error: new Error('cache read failed') }),
    async () => ({ value: user, error: null }),
  );
  assert.equal(sessionLookupFailure, null);

  const retryableBootstrap = await inspectBootstrapAuthSessionCore(
    async () => ({ value: null, error: new Error('storage temporarily unavailable') }),
    async () => ({ value: user, error: null }),
  );
  assert.equal(retryableBootstrap.status, 'unavailable',
    'cold-start storage failure remains retryable without deleting the session');

  assert.equal(normalizeAuthEmail('  MEMBER@Example.COM  '), 'member@example.com');
  assert.equal(
    getSafeAuthErrorMessage('login', { message: 'internal auth backend detail' }),
    'Email or password is incorrect.',
  );
  assert.equal(
    getSafeAuthErrorMessage('login', { status: 429, message: 'backend throttle detail' }),
    'Too many attempts. Wait a moment before trying again.',
  );
  assert.equal(
    getSafeAuthErrorMessage('login', { code: 'weak_password', message: 'password is known to be leaked' }),
    'For security, reset your password before signing in.',
  );
  assert.equal(isExistingAccountError({ code: 'user_already_exists' }), true);

  assert.equal(
    buildPasswordResetRedirect('https://app.chrisswanson.xyz'),
    'https://app.chrisswanson.xyz/reset-password',
  );
  assert.equal(buildPasswordResetRedirect('not an origin'), undefined);
  assert.equal(isPasswordRecoveryLocation('/reset-password', '', ''), true);
  assert.equal(isPasswordRecoveryLocation('/login', '?type=recovery', ''), true);
  assert.equal(isPasswordRecoveryLocation('/login', '', '#type=recovery&token=one'), true);
  assert.equal(isPasswordRecoveryLocation('/login', '?type=signup', ''), false);

  const appSource = readFileSync('App.tsx', 'utf8');
  const authBootstrapSource = readFileSync('src/lib/authBootstrap.ts', 'utf8');
  const authSessionSource = readFileSync('src/lib/authSession.ts', 'utf8');
  const authHookSource = readFileSync('src/hooks/useAuth.ts', 'utf8');
  const supabaseSource = readFileSync('src/lib/supabase.ts', 'utf8');
  const loginSource = readFileSync('src/screens/auth/LoginScreen.tsx', 'utf8');
  const signUpSource = readFileSync('src/screens/auth/SignUpScreen.tsx', 'utf8');
  assert.match(appSource, /inspectBootstrapAuthSession\(\)/);
  assert.match(authBootstrapSource, /AUTH_BOOTSTRAP_CALL_TIMEOUT_MS = 15_000/,
    'cold-start verification tolerates a slow Auth edge without widening ordinary identity reads');
  assert.match(authBootstrapSource, /safeGetSession\(AUTH_BOOTSTRAP_CALL_TIMEOUT_MS\)/);
  assert.match(authBootstrapSource, /safeGetUserForAccessToken\(candidate\?\.access_token \|\| '', AUTH_BOOTSTRAP_CALL_TIMEOUT_MS\)/,
    'candidate verification uses the exact token and does not reacquire the session Web Lock');
  assert.match(authSessionSource, /safeGetUser\(timeoutMs = AUTH_CALL_TIMEOUT_MS\)/);
  assert.match(authSessionSource, /supabase\.auth\.getUser\(accessToken\)/);
  assert.match(authSessionSource, /safeGetSession\(timeoutMs = AUTH_CALL_TIMEOUT_MS\)/);
  assert.match(appSource, /validation\.status === 'unavailable'/);
  assert.match(appSource, /RECONNECTING SECURE SESSION/);
  assert.match(appSource, /<AuthSessionProvider session=\{session\} loading=\{loading\}>/);
  const applySessionStart = appSource.indexOf('const applyValidatedSession');
  const unavailableStart = appSource.indexOf("if (validation.status === 'unavailable')", applySessionStart);
  const signedOutStart = appSource.indexOf("if (validation.status === 'signed_out')", unavailableStart);
  const unavailableBranch = appSource.slice(unavailableStart, signedOutStart);
  assert.ok(unavailableStart > applySessionStart && signedOutStart > unavailableStart,
    'active-session unavailable branch is source-identifiable');
  assert.match(unavailableBranch, /retainsVerifiedSession/);
  assert.match(unavailableBranch, /scheduleAuthRetry/);
  assert.doesNotMatch(unavailableBranch, /clearInvalidLocalAuthSession|secureSignOut/,
    'transient active-session verification cannot invoke logout cleanup');
  const authEventStart = appSource.indexOf('supabase.auth.onAuthStateChange');
  const authEventEnd = appSource.indexOf('// A persisted session is only a candidate', authEventStart);
  const authEventBranch = appSource.slice(authEventStart, authEventEnd);
  assert.ok(authEventStart >= 0 && authEventEnd > authEventStart,
    'root Auth event branch is source-identifiable');
  assert.match(authEventBranch, /!coldStartSettled && \(event === 'INITIAL_SESSION' \|\| !!nextSession\)/,
    'cold start funnels recovered SIGNED_IN and INITIAL_SESSION through one verification path');
  assert.match(authEventBranch, /if \(!coldStartEventVerificationStarted\)/);
  assert.match(authEventBranch, /applyValidatedSession\(nextSession, event\)/);
  assert.match(appSource, /authBootstrapFallbackTimer = setTimeout\([\s\S]*?coldStartEventVerificationStarted[\s\S]*?runBootstrap\(\)/,
    'getSession bootstrap is a bounded fallback and does not race the normal initial event');
  assert.match(appSource, /authRetryInFlight/);
  assert.match(appSource, /addEventListener\('online', retryAuthWhenOnline\)/);
  assert.match(appSource, /addEventListener\('visibilitychange', retryAuthWhenVisible\)/);
  assert.doesNotMatch(authHookSource, /onAuthStateChange|clearInvalidLocalAuthSession/,
    'descendant useAuth consumers cannot install competing session owners or delete Auth state');
  assert.match(authHookSource, /App\.tsx is the sole auth-event\/session owner/);
  assert.doesNotMatch(supabaseSource, /\block\s*:/,
    'Supabase browser Auth must retain its default cross-tab Web Lock');
  assert.match(appSource, /session && !passwordRecovery/);
  assert.match(loginSource, /resetPasswordForEmail/);
  assert.match(loginSource, /updateUser\(\{ password: newPassword \}\)/);
  assert.match(loginSource, /accessibilityRole="button"/);
  assert.match(signUpSource, /autoComplete="new-password"/);
  assert.doesNotMatch(loginSource, /\*:focus-visible\s*\{\s*outline:\s*none/);
  assert.doesNotMatch(loginSource, /setError\(signInError\.message\)/);
  assert.doesNotMatch(signUpSource, /setError\(signUpError\.message\)/);

  console.log('Auth security flow smoke passed (session gate, safe errors, recovery, accessibility).');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
