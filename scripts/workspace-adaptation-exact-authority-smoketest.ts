import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';

process.env.EXPO_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||= 'test-anon-key';

type RemoteProfile = {
  id: string;
  office_preferences: Record<string, unknown> | null;
};

const localStore = new Map<string, string>();
const storageReads: string[] = [];
const storageWrites: string[] = [];
const bearerHeaders: string[] = [];
const verifiedTokens: string[] = [];
const remoteProfiles = new Map<string, RemoteProfile>([
  ['user-a', {
    id: 'user-a',
    office_preferences: {
      autoApprove: { enabled: false },
      adaptiveWorkspace: {
        'circle-b': { enabled: false, pinLandingTab: 'FEED' },
      },
    },
  }],
  ['user-b', { id: 'user-b', office_preferences: {} }],
]);
const tokenOwners = new Map([
  ['token-a', 'user-a'],
  ['token-b', 'user-b'],
]);

let storageGate: Promise<void> | null = null;
let authGate: Promise<void> | null = null;
let authUnavailable = false;
let remoteUnavailable = false;
let forceOneConflict = false;
let dropNextLocalWrite = false;

const fakeStorage = {
  async getItem(key: string): Promise<string | null> {
    storageReads.push(key);
    if (storageGate) await storageGate;
    return localStore.get(key) ?? null;
  },
  async setItem(key: string, value: string): Promise<void> {
    storageWrites.push(key);
    if (!dropNextLocalWrite) localStore.set(key, String(value));
    dropNextLocalWrite = false;
  },
  async removeItem(key: string): Promise<void> {
    localStore.delete(key);
  },
};

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

class FakeProfileQuery implements PromiseLike<{ data: unknown; error: unknown }> {
  private operation: 'select' | 'update' = 'select';
  private updatePayload: Record<string, unknown> | null = null;
  private equalFilters: Array<[string, unknown]> = [];
  private nullFilters: string[] = [];
  private bearer = '';

  select(): this { return this; }
  maybeSingle(): this { return this; }
  eq(column: string, value: unknown): this {
    this.equalFilters.push([column, value]);
    return this;
  }
  is(column: string, value: unknown): this {
    if (value === null) this.nullFilters.push(column);
    return this;
  }
  update(payload: Record<string, unknown>): this {
    this.operation = 'update';
    this.updatePayload = structuredClone(payload);
    return this;
  }
  setHeader(name: string, value: string): this {
    if (name === 'Authorization') {
      this.bearer = value;
      bearerHeaders.push(value);
    }
    return this;
  }

  private execute(): { data: unknown; error: unknown } {
    if (remoteUnavailable) return { data: null, error: { message: 'offline' } };
    const token = this.bearer.replace(/^Bearer\s+/i, '');
    const owner = tokenOwners.get(token);
    if (!owner) return { data: null, error: { message: 'invalid bearer' } };
    const idFilter = this.equalFilters.find(([column]) => column === 'id')?.[1];
    if (idFilter !== owner) return { data: null, error: null };
    const row = remoteProfiles.get(owner);
    if (!row) return { data: null, error: null };
    if (this.operation === 'select') return { data: structuredClone(row), error: null };
    if (forceOneConflict) {
      forceOneConflict = false;
      return { data: null, error: null };
    }
    const expectedPreferences = this.equalFilters.find(([column]) => column === 'office_preferences')?.[1];
    if (expectedPreferences !== undefined && !sameJson(row.office_preferences, expectedPreferences)) {
      return { data: null, error: null };
    }
    if (this.nullFilters.includes('office_preferences') && row.office_preferences !== null) {
      return { data: null, error: null };
    }
    row.office_preferences = structuredClone(
      (this.updatePayload?.office_preferences || null) as Record<string, unknown> | null,
    );
    return { data: structuredClone(row), error: null };
  }

  then<TResult1 = { data: unknown; error: unknown }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }
}

const fakeSupabase = {
  from(table: string) {
    assert.equal(table, 'profiles', 'exact remote adaptation only accesses profiles');
    return new FakeProfileQuery();
  },
};

const fakeAuthSession = {
  async safeGetUserForAccessToken(token: string) {
    verifiedTokens.push(token);
    if (authGate) await authGate;
    if (authUnavailable) return { value: null, error: new Error('offline') };
    const owner = tokenOwners.get(token);
    return owner
      ? { value: { id: owner }, error: null }
      : { value: null, error: new Error('invalid token') };
  },
};

const originalLoad = (Module as any)._load;
(Module as any)._load = function loadWithWorkspaceAdaptationStubs(
  request: string,
  parent: { filename?: string } | undefined,
  isMain: boolean,
) {
  const fromWorkspaceAdaptation = parent?.filename?.endsWith('/src/lib/workspaceAdaptation.ts')
    || parent?.filename?.endsWith('/src/lib/workspaceAdaptation.js');
  if (fromWorkspaceAdaptation && request === './storage') return { storage: fakeStorage };
  if (fromWorkspaceAdaptation && request === './supabase') return { supabase: fakeSupabase };
  if (fromWorkspaceAdaptation && request === './authSession') return fakeAuthSession;
  return originalLoad.call(this, request, parent, isMain);
};

const authorityA = Object.freeze({
  userId: 'user-a',
  circleId: 'circle-a',
  accessToken: 'token-a',
  generation: 1,
});
const authorityB = Object.freeze({
  userId: 'user-b',
  circleId: 'circle-a',
  accessToken: 'token-b',
  generation: 2,
});
const authorityOtherCircle = Object.freeze({
  userId: 'user-a',
  circleId: 'circle-b',
  accessToken: 'token-a',
  generation: 3,
});
let currentAuthority: typeof authorityA | typeof authorityB | typeof authorityOtherCircle = authorityA;
const isCurrent = (authority: typeof authorityA) => (
  authority.userId === currentAuthority.userId
  && authority.circleId === currentAuthority.circleId
  && authority.accessToken === currentAuthority.accessToken
  && authority.generation === currentAuthority.generation
);

async function main(): Promise<void> {
  const adaptation = await import('../src/lib/workspaceAdaptation');

  console.log('Exact user/circle key isolation');
  const profileKeyA = adaptation.workspaceProfileExactStorageKey(authorityA)!;
  const profileKeyB = adaptation.workspaceProfileExactStorageKey(authorityB)!;
  const profileKeyOtherCircle = adaptation.workspaceProfileExactStorageKey(authorityOtherCircle)!;
  const settingsKeyA = adaptation.adaptiveWorkspaceSettingsExactStorageKey(authorityA)!;
  assert.equal(profileKeyA, '@workspace_adaptation_v2:user:user-a:circle:circle-a');
  assert.equal(settingsKeyA, '@workspace_adaptation_settings_v2:user:user-a:circle:circle-a');
  assert.notEqual(profileKeyA, profileKeyB, 'different users never share an activity lane');
  assert.notEqual(profileKeyA, profileKeyOtherCircle, 'different circles never share an activity lane');
  assert(!profileKeyA.includes('token-a'), 'bearer material is absent from storage keys');
  assert.equal(adaptation.workspaceProfileExactStorageKey({ ...authorityA, generation: 0 }), null);
  assert.equal(adaptation.adaptiveWorkspaceSettingsExactStorageKey({ ...authorityA, accessToken: '' }), null);

  localStore.set('@workspace_adaptation_v1:circle-a', JSON.stringify({
    circleId: 'circle-a',
    office: { runtimeActions: 999_999 },
  }));
  localStore.set('@workspace_adaptation_settings_v1:circle-a', JSON.stringify({
    enabled: false,
    pinLandingTab: 'PROFILE',
  }));
  storageReads.length = 0;
  const empty = await adaptation.loadCircleWorkspaceProfileExact(authorityA, isCurrent as any);
  assert.equal(empty.ok, true);
  assert.equal(empty.localLoaded, false);
  assert.equal(empty.profile?.office.runtimeActions, 0, 'legacy activity is never imported');
  assert.deepEqual(storageReads, [profileKeyA], 'exact profile load reads only its user+circle key');
  assert.equal(verifiedTokens.length, 0, 'local-only activity reads do not add a network auth round trip');

  console.log('Serialized exact activity and stale-generation fences');
  const increments = Array.from({ length: 40 }, () => (
    adaptation.recordOfficeActivityExact(authorityA, 'runtime', isCurrent as any)
  ));
  const incrementResults = await Promise.all(increments);
  assert(incrementResults.every(result => result.ok && result.localSaved));
  const afterIncrements = await adaptation.loadCircleWorkspaceProfileExact(authorityA, isCurrent as any);
  assert.equal(afterIncrements.profile?.office.runtimeActions, 40, 'rapid activity updates do not lose increments');
  await adaptation.recordWorkspaceTabVisitExact(authorityA, 'OFFICE', isCurrent as any);
  await adaptation.recordChatActivityExact(authorityA, 'message', isCurrent as any);
  await adaptation.recordFeedActivityExact(authorityA, 'mobile_tab', 'goals', isCurrent as any);
  const afterOtherActivity = await adaptation.loadCircleWorkspaceProfileExact(authorityA, isCurrent as any);
  assert.equal(afterOtherActivity.profile?.tabVisits.OFFICE, 1);
  assert.equal(afterOtherActivity.profile?.chat.messagesSent, 1);
  assert.equal(afterOtherActivity.profile?.feed.mobileTabVisits.goals, 1);

  const writesBeforeRetired = storageWrites.length;
  currentAuthority = authorityB;
  const retiredWrite = await adaptation.recordOfficeActivityExact(authorityA, 'workspace', isCurrent as any);
  assert.equal(retiredWrite.error, 'authority_retired');
  assert.equal(storageWrites.length, writesBeforeRetired, 'retired activity performs no local write');

  currentAuthority = authorityA;
  let releaseStorage!: () => void;
  storageGate = new Promise<void>(resolve => { releaseStorage = resolve; });
  const lateProfileLoad = adaptation.loadCircleWorkspaceProfileExact(authorityA, isCurrent as any);
  await Promise.resolve();
  currentAuthority = authorityB;
  releaseStorage();
  const retiredLoad = await lateProfileLoad;
  storageGate = null;
  assert.equal(retiredLoad.error, 'authority_retired');
  assert.equal(retiredLoad.profile, null, 'late local data is not published after an account switch');

  const userBProfile = await adaptation.loadCircleWorkspaceProfileExact(authorityB, isCurrent as any);
  assert.equal(userBProfile.profile?.office.runtimeActions, 0, 'the next user starts from an isolated profile');

  console.log('Captured-bearer settings load and save');
  currentAuthority = authorityA;
  bearerHeaders.length = 0;
  verifiedTokens.length = 0;
  const savedSettings = await adaptation.saveAdaptiveWorkspaceSettingsExact({
    enabled: true,
    pinLandingTab: 'OFFICE',
    pinOfficeTerminalTab: 'automations',
  }, authorityA, isCurrent as any);
  assert.equal(savedSettings.ok, true);
  assert.equal(savedSettings.localSaved, true);
  assert.equal(savedSettings.remoteSaved, true);
  assert.deepEqual(verifiedTokens, ['token-a'], 'remote save verifies the captured bearer subject');
  assert(bearerHeaders.length >= 2 && bearerHeaders.every(value => value === 'Bearer token-a'));
  const exactSettingsEnvelope = JSON.parse(localStore.get(settingsKeyA)!);
  assert.equal(exactSettingsEnvelope.userId, 'user-a');
  assert.equal(exactSettingsEnvelope.circleId, 'circle-a');
  assert.equal(exactSettingsEnvelope.settings.pinOfficeTerminalTab, 'automations');
  assert.equal(localStore.get('@workspace_adaptation_settings_v1:circle-a')?.includes('PROFILE'), true, 'legacy settings remain untouched');

  const remoteA = remoteProfiles.get('user-a')!.office_preferences as Record<string, any>;
  assert.deepEqual(remoteA.autoApprove, { enabled: false }, 'remote save preserves unrelated preferences');
  assert.equal(remoteA.adaptiveWorkspace['circle-b'].pinLandingTab, 'FEED', 'remote save preserves another circle');
  assert.equal(remoteA.adaptiveWorkspace['circle-a'].pinLandingTab, 'OFFICE');

  localStore.set(settingsKeyA, JSON.stringify({
    schemaVersion: 2,
    userId: 'user-a',
    circleId: 'circle-a',
    settings: { enabled: true, pinLandingTab: 'CHAT' },
  }));
  storageReads.length = 0;
  const loadedSettings = await adaptation.loadAdaptiveWorkspaceSettingsExact(authorityA, isCurrent as any);
  assert.equal(loadedSettings.ok, true);
  assert.equal(loadedSettings.localLoaded, true);
  assert.equal(loadedSettings.remoteLoaded, true);
  assert.equal(loadedSettings.settings?.pinLandingTab, 'CHAT', 'exact local choice overrides the same exact remote scope');
  assert(!storageReads.includes('@workspace_adaptation_settings_v1:circle-a'), 'exact settings load never reads legacy settings');

  console.log('Subject mismatch, late auth, offline, conflict, and receipt failures');
  const mismatchedAuthority = { ...authorityA, accessToken: 'token-b', generation: 4 };
  const writesBeforeMismatch = storageWrites.length;
  const mismatch = await adaptation.saveAdaptiveWorkspaceSettingsExact(
    { enabled: true, pinLandingTab: 'FEED' },
    mismatchedAuthority,
    () => true,
  );
  assert.equal(mismatch.error, 'authority_mismatch');
  assert.equal(storageWrites.length, writesBeforeMismatch, 'a bearer for another user cannot write exact local settings');

  let releaseAuth!: () => void;
  authGate = new Promise<void>(resolve => { releaseAuth = resolve; });
  currentAuthority = authorityA;
  const lateSettingsLoad = adaptation.loadAdaptiveWorkspaceSettingsExact(authorityA, isCurrent as any);
  await Promise.resolve();
  currentAuthority = authorityB;
  releaseAuth();
  const lateSettings = await lateSettingsLoad;
  authGate = null;
  assert.equal(lateSettings.error, 'authority_retired');
  assert.equal(lateSettings.settings, null, 'late settings are never published after account retirement');

  currentAuthority = authorityA;
  authUnavailable = true;
  const offlineSave = await adaptation.saveAdaptiveWorkspaceSettingsExact(
    { enabled: true, pinLandingTab: 'ANALYTICS' },
    authorityA,
    isCurrent as any,
  );
  authUnavailable = false;
  assert.equal(offlineSave.ok, true, 'verified-current exact local settings remain usable offline');
  assert.equal(offlineSave.localSaved, true);
  assert.equal(offlineSave.remoteSaved, false);
  assert.equal(offlineSave.error, 'remote_unavailable');

  forceOneConflict = true;
  const retriedSave = await adaptation.saveAdaptiveWorkspaceSettingsExact(
    { enabled: true, pinLandingTab: 'MEMBERS' },
    authorityA,
    isCurrent as any,
  );
  assert.equal(retriedSave.remoteSaved, true, 'one optimistic remote conflict is retried once');

  dropNextLocalWrite = true;
  const failedReceipt = await adaptation.recordOfficeActivityExact(authorityA, 'workspace', isCurrent as any);
  assert.equal(failedReceipt.error, 'local_storage_failed', 'activity save requires byte-identical readback proof');

  const source = fs.readFileSync('src/lib/workspaceAdaptation.ts', 'utf8');
  const exactStart = source.indexOf('export async function loadCircleWorkspaceProfileExact');
  const legacyStart = source.indexOf('export async function loadCircleWorkspaceProfile(circleId', exactStart);
  const exactApiSource = source.slice(exactStart, legacyStart);
  assert(exactStart >= 0 && legacyStart > exactStart);
  assert(!exactApiSource.includes('profileKey('), 'exact APIs cannot call the legacy profile key helper');
  assert(!exactApiSource.includes('settingsKey('), 'exact APIs cannot call the legacy settings key helper');
  assert(source.includes('export async function loadCircleWorkspaceProfile(circleId'), 'legacy profile API remains for non-Office callers');
  assert(source.includes('export async function saveAdaptiveWorkspaceSettings(circleId'), 'legacy settings API remains for non-Office callers');

  const officeSource = fs.readFileSync('src/screens/circles/tabs/OfficeTab.tsx', 'utf8');
  assert(officeSource.includes('loadCircleWorkspaceProfileExact(requestedAuthority, requestIsCurrent)'), 'Office loads adaptive activity through exact authority');
  assert(officeSource.includes('loadAdaptiveWorkspaceSettingsExact(requestedAuthority, requestIsCurrent)'), 'Office loads adaptive settings through exact authority');
  assert(officeSource.includes('recordOfficeActivityExact('), 'Office records adaptive counters through exact authority');
  assert(officeSource.includes('!floorLayoutHydrated\n      || officeAccessError'), 'Office waits for membership-backed hydration before reading adaptive state');
  assert(!officeSource.includes('loadCircleWorkspaceProfile(circleId)'), 'Office no longer reads circle-only adaptive activity');
  assert(!officeSource.includes('loadAdaptiveWorkspaceSettings(circleId)'), 'Office no longer reads circle-only adaptive settings');
  assert(!officeSource.includes('recordOfficeActivity(circleId'), 'Office no longer writes circle-only adaptive counters');

  console.log('workspace adaptation exact-authority smoketest: all assertions passed');
}

void main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
