import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const providers = readFileSync(resolve(process.cwd(), 'src/lib/llmProviders.ts'), 'utf8');
const themes = readFileSync(resolve(process.cwd(), 'src/services/customThemes.ts'), 'utf8');
const customize = readFileSync(
  resolve(process.cwd(), 'src/screens/circles/tabs/office/CustomizePanel.tsx'),
  'utf8',
);
const office = readFileSync(
  resolve(process.cwd(), 'src/screens/circles/tabs/OfficeTab.tsx'),
  'utf8',
);

let assertions = 0;
function check(condition: unknown, message: string): void {
  assert.ok(condition, message);
  assertions += 1;
  console.log(`  ok  ${message}`);
}

function has(source: string, value: string, message: string): void {
  check(source.includes(value), message);
}

function lacks(source: string, value: string, message: string): void {
  check(!source.includes(value), message);
}

function section(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0 && endIndex > startIndex, `missing source section ${start}`);
  return source.slice(startIndex, endIndex);
}

function ordered(source: string, first: string, second: string, message: string): void {
  const firstIndex = source.indexOf(first);
  const secondIndex = source.indexOf(second, firstIndex + first.length);
  check(firstIndex >= 0 && secondIndex > firstIndex, message);
}

console.log('Provider key exact authority');
has(providers, 'export type ProviderKeysExactAuthority', 'provider keys expose immutable exact authority');
for (const field of ['userId: string', 'circleId: string', 'accessToken: string', 'generation: number']) {
  has(providers, field, `provider authority includes ${field}`);
}
has(providers, 'safeGetUserForAccessToken(authority.accessToken)', 'captured bearer subject is server verified');
for (const name of ['listApiKeysExact', 'storeApiKeyExact', 'deleteApiKeyExact', 'testApiKeyExact', 'useUserApiKeysExact']) {
  has(providers, `export ${name.startsWith('use') ? 'function' : 'async function'} ${name}`, `provider exact path exports ${name}`);
}
const providerList = section(providers, 'export async function listApiKeysExact', '/** Store one user provider key');
const providerStore = section(providers, 'export async function storeApiKeyExact', '/** Delete one key');
const providerDelete = section(providers, 'export async function deleteApiKeyExact', '/** Test an API key');
const providerTest = section(providers, 'export async function testApiKeyExact', '/**\n * Verify the credential');
for (const [label, source] of [['list', providerList], ['store', providerStore], ['delete', providerDelete], ['test', providerTest]] as const) {
  has(source, 'providerKeysAuthorityIsCurrent', `${label} fences the captured lifecycle`);
  has(source, 'Bearer ${authority.accessToken}', `${label} sends the captured bearer explicitly`);
  has(source, 'signal', `${label} supports cancellation`);
}
ordered(providerList, 'resolveProviderKeysExactAuthority', ".rpc('list_user_api_keys')", 'metadata verifies authority before RPC');
ordered(providerStore, 'resolveProviderKeysExactAuthority', ".rpc('store_user_api_key'", 'save verifies authority before RPC');
ordered(providerDelete, ".rpc('delete_user_api_key'", 'listApiKeysExact(authority, isCurrent, signal)', 'delete proves absence under the same authority');
has(providers, 'snapshot.scopeKey === scopeKey', 'provider hook withholds stale-scope metadata synchronously');
has(providers, 'abortRef.current?.abort()', 'provider hook cancels retired reads');

console.log('Custom theme exact authority');
has(themes, 'export type CustomThemeExactAuthority', 'themes expose exact user/circle/token/generation authority');
has(themes, 'safeGetUserForAccessToken(authority.accessToken)', 'themes verify captured bearer subject');
for (const name of ['loadCustomThemesExact', 'saveCustomThemeExact', 'deleteCustomThemeExact', 'useCustomThemesExact']) {
  has(themes, `export ${name.startsWith('use') ? 'function' : 'async function'} ${name}`, `themes export ${name}`);
}
const exactThemeLoad = section(themes, 'export async function loadCustomThemesExact', '/** Save a theme');
const exactThemeSave = section(themes, 'export async function saveCustomThemeExact', '/** Delete a theme');
const exactThemeDelete = section(themes, 'export async function deleteCustomThemeExact', '// ─── React Hook');
has(exactThemeLoad, ".eq('user_id', authority.userId)", 'theme reads bind the exact owner');
has(exactThemeLoad, ".eq('circle_id', authority.circleId)", 'theme reads bind the exact circle');
has(exactThemeLoad, ".is('circle_id', null)", 'only owned global themes may cross circles');
has(exactThemeLoad, 'theme?.is_shared === true', 'foreign themes require explicit sharing into the circle');
has(exactThemeLoad, 'Bearer ${authority.accessToken}', 'every exact theme read gets captured Authorization');
has(exactThemeSave, 'circle_id: authority.circleId', 'exact saves force the active circle');
has(exactThemeSave, ".eq('user_id', authority.userId)", 'theme updates bind the owner');
has(exactThemeSave, ".eq('circle_id', authority.circleId)", 'theme updates cannot move another-circle rows');
has(exactThemeDelete, ".select('id')", 'theme delete requires a concrete deletion receipt');
has(themes, 'snapshot.scopeKey === scopeKey', 'theme hook withholds stale-scope rows synchronously');

console.log('Customize exact wiring');
lacks(customize, 'storeApiKey, deleteApiKey, testApiKey, listApiKeys', 'Customize does not import legacy key operations');
lacks(customize, 'saveCustomTheme, deleteCustomTheme,', 'Customize does not import legacy theme mutations');
for (const call of ['storeApiKeyExact(', 'deleteApiKeyExact(', 'testApiKeyExact(', 'saveCustomThemeExact(', 'deleteCustomThemeExact(']) {
  has(customize, call, `Customize calls ${call.slice(0, -1)}`);
}
has(customize, 'apiOperationControllers.current.get(provider)?.abort()', 'new key operations cancel predecessor work');
has(customize, "setApiKeyInputs(prev => ({ ...prev, [provider]: '' }))", 'save removes plaintext from component state before awaiting');
has(customize, 'setApiKeyInputs({});', 'scope cleanup clears every plaintext API-key input');
has(customize, "setNewToken('');", 'scope cleanup clears the connection token input');
has(customize, ".setHeader('Authorization', `Bearer ${authority.accessToken}`)", 'direct Customize database requests carry captured Authorization');
check((customize.match(/updateAgentSpirit\([^\n]+authority\)/g) || []).length === 2, 'both Customize spirit mutations carry captured authority');
has(customize, 'controller.signal.aborted\n        || !figmaAuthorityIsCurrent(authority)', 'Figma disconnect rejects aborted or retired completion');
has(customize, 'disconnectFigmaOAuth(\n        authority.accessToken,', 'Figma disconnect receives captured bearer');
has(customize, 'generation === figmaStatusGeneration.current,\n        controller.signal,', 'Figma disconnect receives exact fence and abort signal');
has(customize, 'if (figmaOperationController.current === controller)', 'Figma controller is cleared only by its owning operation');

console.log('Office exact hook wiring');
has(office, 'useCustomThemesExact, customThemeToOfficeTheme', 'Office imports the exact custom-theme hook');
has(office, 'useUserApiKeysExact }', 'Office imports the exact provider-key hook');
has(
  office,
  'useCustomThemesExact(\n    committedAuthAuthority,\n    isOfficeAuthorityCurrent,',
  'Office theme metadata is scoped to the committed authority generation',
);
has(
  office,
  'useUserApiKeysExact(\n    committedAuthAuthority,\n    isOfficeAuthorityCurrent,',
  'Office provider-key metadata is scoped to the committed authority generation',
);
lacks(office, 'useCustomThemes(circleId)', 'Office no longer hydrates themes through the legacy circle-only hook');
lacks(office, 'useUserApiKeys()', 'Office no longer hydrates provider keys through the owner-global hook');

console.log(`office customize private-authority smoke passed (${assertions} assertions)`);
