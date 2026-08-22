import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const office = read('src/screens/circles/tabs/OfficeTab.tsx');
const persistence = read('src/lib/officeDashboardPersistence.ts');
const migration = read('supabase/migrations/20260813220000_office_user_preferences.sql');
const sessionTags = read('src/lib/sessionTags.ts');
const sessionCache = read('src/lib/sessionCache.ts');
const tagInput = read('src/components/SessionTagInput.tsx');
const logout = read('src/lib/authLogout.ts');

assert(office.includes('testID="office-private-scope-loading"'), 'the entire Office subtree has an exact-scope loading boundary');
assert(office.includes('!authReady || !floorLayoutScope || !floorLayoutHydrated'), 'the private subtree gate requires committed hydration');
assert(office.indexOf('testID="office-private-scope-loading"') < office.lastIndexOf('return (\n    <View style={styles.container}>'), 'private loading gate precedes the full dashboard return');

assert(office.includes("const OFFICE_TELEGRAM_SECRET_NAMESPACE = 'office_telegram_bot_token_v1'"), 'Telegram uses the encrypted device-secret namespace');
assert(office.includes('writeVerifiedLocalSecret(') && office.includes('readVerifiedLocalSecret('), 'Telegram token uses verified encrypted write/read');
assert(office.includes('legacyOfficeTelegramStorageKey') && office.includes('LEGACY_OWNERLESS_TELEGRAM_STORAGE_KEY'), 'legacy plaintext Telegram stores are explicitly purged');
assert(!office.includes('telegramConfig: telegramConfig'), 'raw Telegram configuration is never sent to preferences');
assert(office.includes('pushOfficePreferences({ telegramMetadata }, requestedAuthority)'), 'only captured non-secret Telegram metadata enters remote preferences');
assert(migration.includes("WHERE telegram_key NOT IN ('chatId', 'botName')"), 'the server accepts only the matching metadata keys');
assert(migration.includes('office_preferences_contains_secret_key_v1'), 'the server recursively rejects secret-like keys');
assert(migration.includes("SET agent_appearance = '{}'::jsonb"), 'legacy peer-readable appearance data is scrubbed');

assert(persistence.includes(".rpc('read_my_office_preferences_v1'"), 'private preferences read through the owner/circle RPC');
assert(persistence.includes(".rpc('patch_my_office_preferences_v1'"), 'private preferences patch through the owner/circle RPC');
assert(!office.includes(".select('office_preferences, agent_appearance')"), 'Office no longer hydrates private state from peer-readable profiles');
assert(office.includes('currentScope?.generation !== item.authorityGeneration'), 'preference transport rechecks exact lifecycle generation');

assert(office.includes('loadCircleOfficeAgents(circleId, {'), 'Circle Office read receives captured authority');
assert(office.includes('startHeartbeat(circleId, connectedConns, authority)'), 'heartbeat receives captured authority');
assert(office.includes('joinPresenceChannel(circleId, myAgents, {'), 'presence joins through its generation-bound lifecycle');
assert(office.includes('heartbeatCleanup = cleanup') && office.includes('presenceCleanup = cleanup'), 'Office retains exact cleanup handles');
assert(!office.includes('stopHeartbeat(circleId);') && !office.includes('leavePresenceChannel(circleId);'), 'cleanup cannot infer a mutable account from circle alone');

assert(office.includes('officeSessionStorageScope'), 'Office constructs one exact cache scope');
assert(office.includes('enrichAgentsWithCache(allAgents, storageScope)'), 'agent cache enrichment is scoped');
assert(office.includes('enrichSessionsWithCache(normalizedSessions, storageScope)'), 'session cache enrichment is scoped');
assert(office.includes('takeSnapshot(fullyEnriched, sessionTags, storageScope)'), 'snapshot writes are scoped');
assert(office.includes('addSessionTag(\n      sessionKey,\n      tag,\n      sessionTags,\n      officeSessionStorageScope'), 'tag writes are scoped');
assert(sessionTags.includes('A scoped read never falls back') && sessionCache.includes('Passing a scope is fail-closed'), 'cache cores document fail-closed legacy isolation');
assert(tagInput.includes('loadTagSuggestions(storageScope)'), 'tag autocomplete uses the same exact scope');

for (const prefix of [
  '@office_private_v2:',
  '@local_secret:office_telegram_bot_token_v1:',
  '@office_session_cache_v2:',
  '@office_daily_costs_v2:',
  '@office_session_tags_v2:',
  '@office_tag_suggestions_v2:',
  '@session_tags_backup_v2:',
]) {
  assert(logout.includes(`'${prefix}'`), `logout clears ${prefix}`);
}

console.log('office private runtime wiring smoke passed (35 assertions)');
