import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Session, User } from '@supabase/supabase-js';
import {
  bootstrapValidatedAuthSessionCore,
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
  assert.equal(rejected, null, 'verification failures must fail closed');

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
  const loginSource = readFileSync('src/screens/auth/LoginScreen.tsx', 'utf8');
  const signUpSource = readFileSync('src/screens/auth/SignUpScreen.tsx', 'utf8');
  assert.match(appSource, /bootstrapValidatedAuthSession\(\)/);
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
