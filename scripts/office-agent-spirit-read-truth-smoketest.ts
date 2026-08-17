import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const spirit = read('src/screens/circles/tabs/office/AgentSpiritPanel.tsx');
const siteAutomation = read('src/lib/siteAutomation.ts');
const integrations = read('src/lib/circleIntegrations.ts');

let assertions = 0;
function check(condition: unknown, message: string): void {
  assertions += 1;
  assert(condition, message);
}

for (const marker of [
  'export async function loadCircleSiteCredentialsExact(',
  'export async function loadSiteCredentialsExact(',
  'generation <= 0',
  'safeGetUserForAccessToken(authority.accessToken)',
  'getSupabaseClientForAccessToken(authority.accessToken)',
  ".setHeader('Authorization', bearer)",
  "return { readOk: false, error: 'invalid_vault_response' }",
  "return { readOk: false, error: 'mismatched_vault_response' }",
  "return { readOk: false, error: 'mismatched_user_credential_response' }",
  "return { readOk: false, error: error.message || 'legacy_circle_read_failed' }",
  "return { readOk: false, error: error.message || 'user_credential_read_failed' }",
]) {
  check(siteAutomation.includes(marker), `strict credential read includes ${marker}`);
}

for (const marker of [
  'export async function buildCircleCapabilityPreflightExact(',
  'normalizeCircleCapabilityReadAuthority(opts.circleId, opts.authority)',
  'safeGetUserForAccessToken(authority.accessToken)',
  'getSupabaseClientForAccessToken(authority.accessToken)',
  ".setHeader('Authorization', `Bearer ${authority.accessToken}`)",
  "return { readOk: false, error: error.message || 'integration_read_failed' }",
  "return { readOk: false, error: 'mismatched_integration_response' }",
  'readOk: true,',
]) {
  check(integrations.includes(marker), `strict integration read includes ${marker}`);
}

for (const marker of [
  'type SpiritReadState<T>',
  "status: 'loading', value: null, error: null",
  "status: 'ready',",
  "status: 'error', value: null",
  "loadCircleSiteCredentialsExact(circleId, 'wordpress', authority)",
  "loadSiteCredentialsExact('wordpress', authority)",
  'buildCircleCapabilityPreflightExact({',
  'if (!circleRead.readOk)',
  'if (!userRead.readOk)',
  'if (!result.readOk)',
  "wordpressRead.status === 'ready'",
  "integrationRead.status === 'ready'",
  'accessibilityLabel="Retry WordPress connection status"',
  'accessibilityLabel="Retry integration readiness"',
  'isIdentityRequestCurrent(capturedRequestKey)',
]) {
  check(spirit.includes(marker), `Spirit read state includes ${marker}`);
}
check(!spirit.includes('loadCircleSiteCredentials(circleId'), 'Spirit does not call the error-swallowing circle credential helper');
check(!spirit.includes("loadSiteCredentials('wordpress')"), 'Spirit does not call the error-swallowing user credential helper');
check(!spirit.includes('buildCircleCapabilityPreflight({'), 'Spirit does not call the error-swallowing integration preflight');
check(
  spirit.indexOf("wordpressRead.status === 'ready'") < spirit.indexOf("? 'Not connected'"),
  'Not connected is only rendered from a verified ready credential state',
);
check(
  spirit.includes('No active WordPress credential was found in the verified circle or user credential stores.'),
  'verified empty WordPress state is distinct from a read error',
);

console.log(`office agent Spirit read-truth smoke passed (${assertions} assertions)`);
