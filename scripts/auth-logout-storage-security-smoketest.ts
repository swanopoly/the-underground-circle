import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  createNativeSecureAuthStorage,
  secureAuthStorageKey,
  type AuthKeyValueStorage,
} from '../src/lib/authStorage';
import { clearRecordingStateForLogout } from '../src/lib/chatRecording';

class MemoryStorage implements AuthKeyValueStorage {
  readonly values = new Map<string, string>();
  async getItem(key: string) { return this.values.get(key) ?? null; }
  async setItem(key: string, value: string) { this.values.set(key, value); }
  async removeItem(key: string) { this.values.delete(key); }
}

class MemorySecureStore {
  readonly values = new Map<string, string>();
  constructor(private readonly available = true) {}
  async isAvailableAsync() { return this.available; }
  async getItemAsync(key: string) { return this.values.get(key) ?? null; }
  async setItemAsync(key: string, value: string) { this.values.set(key, value); }
  async deleteItemAsync(key: string) { this.values.delete(key); }
}

class FailingDeleteSecureStore extends MemorySecureStore {
  override async deleteItemAsync(key: string) {
    if (key.endsWith('_0')) throw new Error('simulated keychain failure');
    await super.deleteItemAsync(key);
  }
}

class FailingAvailabilitySecureStore extends MemorySecureStore {
  override async isAvailableAsync(): Promise<boolean> {
    throw new Error('simulated secure-store probe failure');
  }
}

class MemoryLocalStorage {
  readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  key(index: number) { return Array.from(this.values.keys())[index] ?? null; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

async function main() {
  const legacy = new MemoryStorage();
  const secure = new MemorySecureStore();
  const authStorage = createNativeSecureAuthStorage({
    legacyStorage: legacy,
    loadSecureStore: async () => secure,
  });
  const authKey = 'sb-project-ref-auth-token';
  const secureKey = secureAuthStorageKey(authKey);
  assert.match(secureKey, /^[A-Za-z0-9._-]+$/, 'SecureStore key uses only supported characters');

  const longSession = JSON.stringify({ access_token: 'a'.repeat(2_400), refresh_token: 'r'.repeat(2_400) });
  await authStorage.setItem(authKey, longSession);
  assert.equal(legacy.values.has(authKey), false, 'secure device does not retain plaintext AsyncStorage session');
  assert.equal(secure.values.get(secureKey), 'uc-auth-v2:0:3', 'large session is committed to an atomic bounded-chunk slot');
  assert.equal(await authStorage.getItem(authKey), longSession, 'chunked session round-trips');

  const unicodeSession = JSON.stringify({ user_metadata: { display_name: '🦊'.repeat(1_200) } });
  await authStorage.setItem(authKey, unicodeSession);
  assert.equal(await authStorage.getItem(authKey), unicodeSession, 'multibyte session data round-trips');
  for (const [key, value] of secure.values) {
    if (key.startsWith(`${secureKey}_`)) {
      assert.ok(Buffer.byteLength(value, 'utf8') <= 1_800, 'every SecureStore chunk stays under its byte cap');
    }
  }

  await authStorage.setItem(authKey, 'short-session');
  assert.equal(await authStorage.getItem(authKey), 'short-session', 'session replacement round-trips');
  assert.equal(secure.values.has(`${secureKey}_1`), false, 'short replacement removes stale secure chunks');

  await authStorage.removeItem(authKey);
  assert.equal(await authStorage.getItem(authKey), null, 'logout removes secure auth session');
  assert.equal(Array.from(secure.values.keys()).some((key) => key.startsWith(secureKey)), false,
    'logout removes manifest and every bounded chunk');

  const failingSecure = new FailingDeleteSecureStore();
  const failingStorage = createNativeSecureAuthStorage({
    legacyStorage: new MemoryStorage(),
    loadSecureStore: async () => failingSecure,
  });
  await failingStorage.setItem(authKey, 'must-not-silently-survive');
  await failingStorage.removeItem(authKey);
  assert.equal(await failingStorage.getItem(authKey), null,
    'a keychain deletion refusal still removes the authoritative manifest');
  assert.equal(
    Array.from(failingSecure.values.entries())
      .filter(([key]) => key.startsWith(`${secureKey}_`))
      .every(([, value]) => value === ''),
    true,
    'undeletable keychain chunks are zeroed so no credential material survives logout',
  );

  const migrationLegacy = new MemoryStorage();
  const migrationSecure = new MemorySecureStore();
  await migrationLegacy.setItem(authKey, 'legacy-session');
  const migrationStorage = createNativeSecureAuthStorage({
    legacyStorage: migrationLegacy,
    loadSecureStore: async () => migrationSecure,
  });
  assert.equal(await migrationStorage.getItem(authKey), 'legacy-session', 'legacy session remains usable during migration');
  assert.equal(await migrationLegacy.getItem(authKey), null, 'legacy plaintext is deleted after secure migration');
  assert.equal(await migrationStorage.getItem(authKey), 'legacy-session', 'migrated secure session remains readable');

  const fallbackLegacy = new MemoryStorage();
  const unavailableStorage = createNativeSecureAuthStorage({
    legacyStorage: fallbackLegacy,
    loadSecureStore: async () => new MemorySecureStore(false),
  });
  await unavailableStorage.setItem(authKey, 'fallback-session');
  assert.equal(await fallbackLegacy.getItem(authKey), null,
    'an unavailable OS secure store never downgrades auth authority to plaintext AsyncStorage');
  assert.equal(await unavailableStorage.getItem(authKey), 'fallback-session',
    'an unavailable OS secure store keeps the session memory-only for the current process');
  const restartedUnavailableStorage = createNativeSecureAuthStorage({
    legacyStorage: fallbackLegacy,
    loadSecureStore: async () => new MemorySecureStore(false),
  });
  assert.equal(await restartedUnavailableStorage.getItem(authKey), 'fallback-session',
    'memory-only fallback is shared by adapters only within the current process');
  await unavailableStorage.removeItem(authKey);
  assert.equal(await restartedUnavailableStorage.getItem(authKey), null,
    'logout clears the process-wide volatile fallback for every adapter');

  const probeFailureLegacy = new MemoryStorage();
  const probeFailureStorage = createNativeSecureAuthStorage({
    legacyStorage: probeFailureLegacy,
    loadSecureStore: async () => new FailingAvailabilitySecureStore(),
  });
  await assert.rejects(() => probeFailureStorage.setItem(authKey, 'must-stay-secure'),
    'a SecureStore probe error fails closed instead of downgrading a token to AsyncStorage');
  assert.equal(await probeFailureLegacy.getItem(authKey), null,
    'failed SecureStore probe leaves no plaintext token behind');

  const corruptLegacy = new MemoryStorage();
  const corruptSecure = new MemorySecureStore();
  await corruptLegacy.setItem(authKey, 'stale-plaintext-session');
  corruptSecure.values.set(secureKey, 'malformed-manifest');
  const corruptStorage = createNativeSecureAuthStorage({
    legacyStorage: corruptLegacy,
    loadSecureStore: async () => corruptSecure,
  });
  assert.equal(await corruptStorage.getItem(authKey), null,
    'malformed secure data fails closed instead of resurrecting a stale plaintext token');

  const browserStorage = new MemoryLocalStorage();
  (globalThis as { localStorage?: unknown }).localStorage = browserStorage;
  browserStorage.setItem('uc_active_recording_v1', JSON.stringify({
    name: 'active-a', circleId: 'circle-a', userId: 'user-a', startedAt: 1, steps: [],
  }));
  browserStorage.setItem('uc_recordings_v1', JSON.stringify({
    a: { name: 'a', circleId: 'circle-a', userId: 'user-a', createdAt: 1, durationMs: 1, steps: [] },
    b: { name: 'b', circleId: 'circle-b', userId: 'user-b', createdAt: 1, durationMs: 1, steps: [] },
    legacy: { name: 'legacy', circleId: 'circle-a', createdAt: 1, durationMs: 1, steps: [] },
  }));
  const recordingCleanup = clearRecordingStateForLogout('user-a');
  assert.deepEqual(recordingCleanup, { activeCleared: true, savedCleared: 2 },
    'logout clears the outgoing account recording and unowned legacy data');
  const remainingRecordings = JSON.parse(browserStorage.getItem('uc_recordings_v1') || '{}');
  assert.deepEqual(Object.keys(remainingRecordings), ['b'], 'another explicit local account recording is preserved');

  const repoRoot = path.resolve(import.meta.dirname, '..');
  const logoutSource = fs.readFileSync(path.join(repoRoot, 'src/lib/authLogout.ts'), 'utf8');
  const appSource = fs.readFileSync(path.join(repoRoot, 'App.tsx'), 'utf8');
  const desktopBridgeSource = fs.readFileSync(path.join(repoRoot, 'src/lib/desktopBridge.ts'), 'utf8');
  const signOutSources = [
    'src/hooks/useAuth.ts',
    'src/lib/authBootstrap.ts',
    'src/screens/auth/LoginScreen.tsx',
    'src/screens/profile/ProfileScreen.tsx',
    'src/screens/profile/EditProfileScreen.tsx',
  ].map((file) => fs.readFileSync(path.join(repoRoot, file), 'utf8'));

  for (const requirement of [
    'stopAgentAutoConnect',
    'clearLocalSwanBotSessionState',
    'clearRecordingStateForLogout',
    'revokeAllActiveStickyAllowScopes',
    'clearLocalAgentConnectionsForLogout',
    'clearLocalFileSessionGrant',
    'clearBridgeAuthStateForLogout',
    'clearDesktopBridgeTokenForLogout',
    'clearOpenSwanApprovalResumeOutboxForLogout',
  ]) {
    assert.ok(logoutSource.includes(requirement), `central logout cleanup includes ${requirement}`);
  }
  for (const officeStoragePrefix of [
    '@office_layout_cache_v2:',
    '@office_private_v2:',
    '@local_secret:office_telegram_bot_token_v1:',
    '@office_telegram_config',
    '@office_session_cache_v2:',
    '@office_daily_costs_v2:',
    '@office_session_tags_v2:',
    '@office_tag_suggestions_v2:',
    '@session_tags_backup_v2:',
    '@office_addon_catalog_preferences_v1:',
    '@office_floors',
    '@office_floors_updated_at',
    '@office_current_floor',
  ]) {
    assert.ok(logoutSource.includes(`'${officeStoragePrefix}'`), `logout clears Office storage prefix ${officeStoragePrefix}`);
  }
  assert.ok(
    appSource.includes('queueAccountCleanup(signedOutUserId)')
      && appSource.includes('clearLocalAuthResidualAuthority(userId)'),
    'external/expired SIGNED_OUT events queue residual-authority cleanup before another account mounts',
  );
  assert.ok(desktopBridgeSource.includes('desktopBridgeTokenGeneration += 1')
    && desktopBridgeSource.includes('tokenGeneration !== desktopBridgeTokenGeneration')
    && desktopBridgeSource.includes('pendingSecondaryTokenWrites'),
  'logout invalidates in-flight primary and secondary desktop-token writes');
  for (const source of signOutSources) {
    assert.ok(source.includes('secureSignOut'), 'every user-facing/auth-maintenance logout uses secureSignOut');
    assert.equal(source.includes('supabase.auth.signOut'), false, 'no audited caller bypasses central cleanup');
  }

  console.log('auth logout + secure storage security smoke passed');
}

void main();
