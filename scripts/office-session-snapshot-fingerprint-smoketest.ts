/**
 * Red-first contract for exact session-inventory provenance at the shared
 * Office/Feed dispatch boundary. This smoke performs no database or provider
 * I/O. It must stay red until runtime snapshots carry the fingerprint captured
 * with each session response and every consumer rejects torn/stale evidence.
 *
 * Run directly while wiring is in flight:
 *   npx tsx scripts/office-session-snapshot-fingerprint-smoketest.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildOpenSwanConnectionFingerprint,
  resolveOfficeAgentSessionBinding,
} from '../src/lib/officeAgentSessionBindingCore';

const root = process.cwd();
let passed = 0;
const failures: string[] = [];

function check(condition: unknown, label: string): condition is true {
  if (condition) {
    passed += 1;
    return true;
  }
  failures.push(label);
  return false;
}

function source(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

function expectMatch(value: string, pattern: RegExp, label: string): void {
  check(pattern.test(value), label);
}

function expectNoMatch(value: string, pattern: RegExp, label: string): void {
  check(!pattern.test(value), label);
}

function section(value: string, start: string, end: string, label: string): string {
  const startIndex = value.indexOf(start);
  if (!check(startIndex >= 0, `${label}: start marker exists`)) return '';
  const endIndex = value.indexOf(end, startIndex + start.length);
  if (!check(endIndex > startIndex, `${label}: end marker exists`)) return '';
  return value.slice(startIndex, endIndex);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const coreSource = source('src/lib/officeAgentSessionBindingCore.ts');
const bindingSource = source('src/lib/officeAgentSessionBinding.ts');
const stateSource = source('src/lib/agentAutoConnectState.ts');
const autoConnectSource = source('src/lib/agentAutoConnect.ts');
const appSource = source('App.tsx');
const claudeDetectorSource = source('src/lib/claudeCodeDetector.ts');
const codexDetectorSource = source('src/lib/codexDetector.ts');
const geminiDetectorSource = source('src/lib/geminiCliDetector.ts');
const cursorDetectorSource = source('src/lib/cursorDetector.ts');
const supabaseSource = source('src/lib/supabase.ts');
const officeSource = source('src/screens/circles/tabs/OfficeTab.tsx');
const feedSource = source('src/hooks/useKanbanData.ts');
const invocationSource = source('src/lib/agentInvocation.ts');

// ── Pure dispatch boundary ─────────────────────────────────────────────────

const OFFICE_AGENT_ID = '11111111-1111-4111-8111-111111111111';
const BINDING_ID = '22222222-2222-4222-8222-222222222222';
const AGENT_BOT_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_AGENT_BOT_ID = '44444444-4444-4444-8444-444444444444';
const CONNECTION_ID = 'stable-local-connection';
const SESSION_KEY = 'agent:main:exact';

const exactConnection = {
  id: CONNECTION_ID,
  remoteId: AGENT_BOT_ID,
  provider: 'openswan',
  status: 'connected',
  enabled: true,
  endpoint: 'http://127.0.0.1:18790',
  token: 'local-test-token',
};
const exactFingerprint = buildOpenSwanConnectionFingerprint(exactConnection);
check(exactFingerprint !== null, 'fixture has a canonical non-secret connection fingerprint');

const exactInput = {
  officeAgentId: OFFICE_AGENT_ID,
  binding: {
    id: BINDING_ID,
    officeAgentId: OFFICE_AGENT_ID,
    agentBotId: AGENT_BOT_ID,
    sessionKey: SESSION_KEY,
  },
  connections: [exactConnection],
  sessionsByConnection: {
    [CONNECTION_ID]: [{ sessionKey: SESSION_KEY }],
  },
  sessionFingerprintsByConnection: {
    [CONNECTION_ID]: exactFingerprint,
  },
};

function attemptProviderEffect(input: unknown): { ok: boolean; providerEffects: number } {
  const resolution = resolveOfficeAgentSessionBinding(input as any);
  let providerEffects = 0;
  if (resolution.ok) providerEffects += 1;
  return { ok: resolution.ok, providerEffects };
}

check(
  attemptProviderEffect(exactInput).ok,
  'an exact unchanged connection plus co-captured fingerprint resolves',
);
check(
  attemptProviderEffect(exactInput).providerEffects === 1,
  'exact unchanged provenance permits exactly one downstream provider effect',
);

const rejected: Array<[string, (input: any) => void]> = [
  ['missing session provenance fingerprint', (input) => {
    input.sessionFingerprintsByConnection = {};
  }],
  ['same local id with a changed endpoint', (input) => {
    input.connections[0].endpoint = 'http://127.0.0.1:28790';
  }],
  ['same local id with a changed remote bot id', (input) => {
    input.connections[0].remoteId = OTHER_AGENT_BOT_ID;
    input.binding.agentBotId = OTHER_AGENT_BOT_ID;
  }],
  ['connected session evidence after the connection enters error', (input) => {
    input.connections[0].status = 'error';
  }],
  ['duplicate local connection id with distinct bridge identities', (input) => {
    input.connections.push({
      ...input.connections[0],
      remoteId: OTHER_AGENT_BOT_ID,
      endpoint: 'http://127.0.0.1:28790',
    });
  }],
  ['old fingerprint paired with newly replaced session rows', (input) => {
    input.connections[0].endpoint = 'http://127.0.0.1:28790';
    input.binding.sessionKey = 'agent:main:new';
    input.sessionsByConnection[CONNECTION_ID] = [{ sessionKey: 'agent:main:new' }];
  }],
];

for (const [label, mutate] of rejected) {
  const input = clone(exactInput);
  mutate(input);
  const result = attemptProviderEffect(input);
  check(!result.ok, `${label} fails closed`);
  check(result.providerEffects === 0, `${label} performs zero provider effects`);
}

// The snapshot and resolver use one explicit field rather than treating a
// local connection id as sufficient provenance.
expectMatch(
  coreSource,
  /ResolveOfficeAgentSessionBindingInput[\s\S]{0,600}\bsessionFingerprintsByConnection\??\s*:/,
  'pure resolver input carries per-connection session fingerprints',
);
const resolverSection = section(
  coreSource,
  'function resolveOfficeAgentSessionBindingInternal(',
  '/**\n * Resolve one canonical Office binding',
  'pure binding resolution',
);
expectMatch(
  resolverSection,
  /sessionFingerprintsByConnection/,
  'pure resolver reads the fingerprint map associated with session rows',
);
expectMatch(
  resolverSection,
  /matchesOpenSwanConnectionFingerprint\s*\(/,
  'pure resolver compares captured session provenance with the selected current connection',
);

expectMatch(
  bindingSource,
  /interface\s+OfficeSessionSnapshot[\s\S]{0,400}\bsessionFingerprintsByConnection\s*:/,
  'OfficeSessionSnapshot carries per-connection session provenance',
);
const snapshotBuilder = section(
  bindingSource,
  'export function buildOfficeSessionSnapshot(',
  'export function resolveOfficeAgentSessionBinding(',
  'canonical Office session snapshot builder',
);
expectMatch(
  snapshotBuilder,
  /fingerprint/i,
  'snapshot builder accepts the co-captured fingerprint inventory',
);
expectMatch(
  snapshotBuilder,
  /sessionFingerprintsByConnection/,
  'snapshot builder projects fingerprints beside session rows',
);

// ── Shared auto-connect inventory ──────────────────────────────────────────

expectMatch(
  stateSource,
  /Map<\s*string\s*,[^>\n]*OpenSwanConnectionFingerprint/,
  'auto-connect state owns a typed per-connection fingerprint map',
);
expectMatch(
  stateSource,
  /export\s+function\s+getAutoConnectSessionFingerprints\s*\(/,
  'auto-connect state exposes the session provenance inventory',
);
expectMatch(
  stateSource,
  /publishAutoConnectSnapshot[\s\S]{0,500}(?:sessionFingerprints|fingerprints)(?:Map)?\s*:/i,
  'published auto-connect snapshots update fingerprints with connections and sessions',
);

const updateConnections = section(
  autoConnectSource,
  'export function updateAutoConnectConnections(',
  '// ── Manual reconnect',
  'auto-connect connection replacement',
);
expectMatch(
  updateConnections,
  /matchesOpenSwanConnectionFingerprint\s*\(/,
  'same-id connection updates compare the current config with session provenance',
);
expectMatch(
  updateConnections,
  /_sessionsMap\.delete\(connId\)/,
  'same-id connection identity drift invalidates old session rows',
);
expectMatch(
  updateConnections,
  /(?:sessionFingerprints|fingerprints)(?:Map)?\.delete\(connId\)/i,
  'same-id connection identity drift invalidates old session provenance',
);

const autoPoller = section(
  autoConnectSource,
  'poller = new OpenSwanPoller(',
  '_ocPollers.set(conn.id, poller)',
  'shared auto-connect poller callback',
);
expectMatch(autoPoller, /generation|epoch/i, 'auto-connect poller callback is generation guarded');
expectMatch(
  autoPoller,
  /matchesOpenSwanConnectionFingerprint\s*\(/,
  'auto-connect poller callback rechecks the exact connection identity',
);
const autoSessionWrite = autoPoller.indexOf('_sessionsMap.set(');
const autoGuardReturn = autoPoller.lastIndexOf('return;', autoSessionWrite);
check(autoGuardReturn >= 0 && autoSessionWrite > autoGuardReturn, 'late/stopped auto-connect callbacks return before publishing sessions');
expectMatch(
  autoPoller,
  /(?:sessionFingerprints|fingerprints)(?:Map)?\.set\s*\(/i,
  'accepted auto-connect poll results publish their co-captured fingerprint',
);

// One shared localhost/CORS scheduling blip must not tear down every healthy
// poller and publish a false offline/online transition. Each provider needs
// three consecutive misses; a successful observation resets only its counter.
expectMatch(
  autoConnectSource,
  /BRIDGE_OFFLINE_CONFIRM_MISSES\s*=\s*3/,
  'bridge availability requires three consecutive misses before offline teardown',
);
expectMatch(
  autoConnectSource,
  /function\s+_bridgeConfirmedOffline[\s\S]{0,700}detected[\s\S]{0,300}=\s*0[\s\S]{0,500}BRIDGE_OFFLINE_CONFIRM_MISSES/,
  'a successful bridge probe resets its provider-specific miss counter',
);
const bridgeRetryProbe = section(
  autoConnectSource,
  'const tickBridgeProbe = async () => {',
  '// OpenSwan reconnect',
  'local bridge retry probe',
);
expectMatch(
  bridgeRetryProbe,
  /await\s+Promise\.all[\s\S]{0,900}document\.visibilityState\s*===\s*'hidden'[\s\S]{0,260}return;[\s\S]{0,260}_bridgeConfirmedOffline/,
  'late bridge probe results cannot restart or tear down pollers after the tab becomes hidden',
);
for (const [provider, condition] of [
  ['Claude Code', 'ccConfirmedOffline'],
  ['Codex', 'codexConfirmedOffline'],
  ['Gemini CLI', 'geminiConfirmedOffline'],
  ['Cursor', 'cursorConfirmedOffline'],
] as const) {
  expectMatch(
    bridgeRetryProbe,
    new RegExp(`${condition}\\s*&&\\s*_[a-z]+Poller`),
    `${provider} poller teardown is guarded by confirmed consecutive misses`,
  );
}

// App auth is already server-validated before auto-connect starts. Carry that
// immutable user/token pair into every bridge publication instead of asking
// each poller to reacquire Supabase's mutable browser auth lock.
expectMatch(
  appSource,
  /startAgentAutoConnectDeferred\(session:\s*Session\)[\s\S]{0,500}startAgentAutoConnect\(authority\)/,
  'App passes its validated auth authority into auto-connect',
);
expectMatch(
  autoConnectSource,
  /startAgentAutoConnect\(authScope\?:\s*CircleOfficeAuthScope\)[\s\S]{0,500}_authScope\s*=\s*Object\.freeze[\s\S]{0,300}if\s*\(_running\)\s*return/,
  'token refresh updates auto-connect authority even when the singleton is already running',
);
expectNoMatch(
  autoConnectSource,
  /no user authenticated yet \(normal during startup\)/,
  'normal auth restoration no longer emits a warning',
);
expectMatch(
  supabaseSource,
  /getSupabaseClientForAccessToken[\s\S]{0,900}accessToken:\s*async\s*\(\)\s*=>\s*normalized/,
  'exact bearer client bypasses the mutable Supabase session getter',
);
for (const [provider, detector] of [
  ['Claude Code', claudeDetectorSource],
  ['Codex', codexDetectorSource],
  ['Gemini CLI', geminiDetectorSource],
  ['Cursor', cursorDetectorSource],
] as const) {
  expectMatch(
    detector,
    /capturedScope\?:\s*CircleOfficeAuthScope/,
    `${provider} publication accepts the captured auth scope`,
  );
  expectMatch(
    detector,
    /getSupabaseClientForAccessToken\(capturedScope\.accessToken\)/,
    `${provider} status writes use the exact bearer client without a Web Lock lookup`,
  );
}
expectMatch(
  claudeDetectorSource,
  /isBenignAuthAbort\(err\)[\s\S]{0,100}Failed to update agent status/,
  'Claude status publishing suppresses only expected auth cancellations',
);

// ── Office local inventory and command paths ──────────────────────────────

expectMatch(
  officeSource,
  /useRef<\s*Map<\s*string\s*,[^>\n]*OpenSwanConnectionFingerprint[^>\n]*>\s*>\s*\(/,
  'OfficeTab owns fingerprint provenance beside its session ref',
);
expectMatch(
  officeSource,
  /const\s+connectionsRef\s*=\s*useRef<\s*AgentConnection\[\]\s*>/,
  'OfficeTab owns a current connection ref for long-lived command subscriptions',
);
expectMatch(
  officeSource,
  /connectionsRef\.current\s*=\s*connections/,
  'OfficeTab keeps the command-subscription connection ref current',
);

const directCommand = section(
  officeSource,
  'const handleCommandSent = useCallback(',
  '// ─── Terminal command subscription',
  'Office direct command path',
);
const remoteCommand = section(
  officeSource,
  '// ─── Terminal command subscription',
  "// Publish the user's first connection as their circle office agent",
  'Office remote command subscription',
);
expectMatch(
  officeSource,
  /officeSessionSnapshotRef\.current\s*=\s*buildOfficeSessionSnapshot\([\s\S]{0,260}sessionsRef\.current[\s\S]{0,160}(?:sessionFingerprints|fingerprints)Ref\.current/i,
  'OfficeTab rebuilds its current snapshot ref from connections, sessions, and co-captured fingerprints',
);
for (const [label, commandSource] of [
  ['direct Office command', directCommand],
  ['remote Office command', remoteCommand],
] as const) {
  expectMatch(
    commandSource,
    /officeSessionSnapshotRef\.current/,
    `${label} reads the current co-provenanced dispatch snapshot ref`,
  );
}
expectMatch(
  remoteCommand,
  /connectionsRef\.current|officeSessionSnapshotRef\.current|currentOfficeSessionSnapshotRef\.current/,
  'remote Office commands read current connection/snapshot refs at callback time',
);
expectNoMatch(
  remoteCommand,
  /buildOfficeSessionSnapshot\(\s*connections\s*,/,
  'remote Office commands do not build from a stale closed-over connections array',
);

const officePoller = section(
  officeSource,
  'poller = new OpenSwanPoller(',
  'pollersRef.current.set(conn.id, poller)',
  'OfficeTab local poller callback',
);
expectMatch(officePoller, /generation|epoch/i, 'OfficeTab poller callback is generation guarded');
expectMatch(
  officePoller,
  /matchesOpenSwanConnectionFingerprint\s*\(/,
  'OfficeTab poller callback rechecks the exact connection identity',
);
const officeSessionWrite = officePoller.indexOf('sessionsRef.current.set(');
const officeGuardReturn = officePoller.lastIndexOf('return;', officeSessionWrite);
check(officeGuardReturn >= 0 && officeSessionWrite > officeGuardReturn, 'late/stopped OfficeTab callbacks return before publishing sessions');
expectMatch(
  officePoller,
  /(?:sessionFingerprints|fingerprints)Ref\.current\.set\s*\(/i,
  'accepted OfficeTab poll results publish their co-captured fingerprint',
);

// Feed consumes the same atomic singleton snapshot; invocation forwards the
// provenance map into both direct Feed and claimed Office resolver calls.
expectMatch(
  feedSource,
  /buildOfficeSessionSnapshot\([\s\S]{0,400}getAutoConnectSessionFingerprints\s*\(\s*\)/,
  'Feed builds its snapshot with auto-connect session fingerprints',
);
check(
  (invocationSource.match(/sessionFingerprintsByConnection:\s*officeSessionSnapshot\?\.sessionFingerprintsByConnection/g) || []).length >= 2,
  'both Office and Feed invocation branches forward provenance into the pure resolver',
);

if (failures.length > 0) {
  console.error(`office-session-snapshot-fingerprint smoke: ${failures.length} failed, ${passed} passed`);
  failures.forEach((failure, index) => console.error(`  ${index + 1}. ${failure}`));
  process.exitCode = 1;
} else {
  console.log(`office-session-snapshot-fingerprint smoke: all ${passed} assertions passed`);
}
