/**
 * Source-level wiring coverage for OpenSwan's structured external lifecycle.
 *
 * The pure contract has its own smoke. This file pins the service and Chat
 * callsites without importing React Native or contacting an OpenSwan gateway.
 *
 * Run: npm run smoke:openswan-service-lifecycle-wiring
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const service = readFileSync(resolve(root, 'src/lib/openswanService.ts'), 'utf8');
const lifecycleCore = readFileSync(resolve(root, 'src/lib/openswanSubagentLifecycleCore.ts'), 'utf8');
const chat = readFileSync(resolve(root, 'src/screens/circles/tabs/ChatTab.tsx'), 'utf8');
const officeChat = readFileSync(resolve(root, 'src/screens/circles/tabs/office/OfficeChat.tsx'), 'utf8');
const agentGatewayPanels = readFileSync(resolve(root, 'src/screens/circles/tabs/office/AgentGatewayPanels.tsx'), 'utf8');

function section(source: string, startMarker: string, endMarker: string, label: string): string {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `${label}: missing start marker`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `${label}: missing end marker`);
  assert.ok(end > start, `${label}: invalid marker order`);
  return source.slice(start, end);
}

function numericLiteral(source: string, pattern: RegExp, label: string): number {
  const match = source.match(pattern);
  assert.ok(match?.[1], `${label}: numeric literal is present`);
  const value = Number(match![1].replace(/_/g, ''));
  assert.ok(Number.isFinite(value), `${label}: numeric literal is finite`);
  return value;
}

const serviceWrappers = section(
  service,
  '/** Read only the current gateway\'s structured details',
  'function isWebDirectLocalGateway',
  'OpenSwan service lifecycle wrappers',
);
const toolCapabilityState = section(
  service,
  'const unsupportedToolCache',
  '// Per-tool timeouts.',
  'OpenSwan capability cooldowns',
);
const rawToolInvoker = section(
  service,
  '// Per-tool timeouts.',
  '// ─── High-level API',
  'OpenSwan raw tool invoker',
);
const cronInventoryService = section(
  service,
  'export interface CronJob',
  'export async function sendAgentTask',
  'OpenSwan cron inventory service',
);
const agentInventoryService = section(
  service,
  'export async function listAgents',
  'export async function spawnSubAgent',
  'OpenSwan runtime-agent inventory service',
);
const sessionInventoryService = section(
  service,
  'export async function testConnection',
  'export async function getSessionStatus',
  'OpenSwan exact session inventory service',
);
const providerParsers = section(
  service,
  '// ─── Parsers',
  '// ─── Polling Manager',
  'OpenSwan structured provider parsers',
);
const webSearchService = section(
  service,
  'export interface OpenSwanWebSearchResult',
  '// ─── Parsers',
  'OpenSwan structured web-search service',
);
const spawnService = section(
  service,
  'export async function spawnSubAgent',
  'export async function manageCronJob',
  'OpenSwan spawn service',
);
const sendService = section(
  service,
  'export async function sendSessionMessage',
  'export async function listSubAgents',
  'OpenSwan session-send service',
);
const detailedListService = section(
  service,
  'export async function listSubAgentsDetailed',
  '// ─── Polling Manager',
  'OpenSwan detailed subagent list',
);
const sendCore = section(
  lifecycleCore,
  'export function parseOpenSwanSessionSendHandle',
  '/** Parse current `subagents action:list`',
  'OpenSwan session-send core',
);
const listCore = section(
  lifecycleCore,
  'export function parseOpenSwanSubagentLifecycleSnapshot',
  '/**\n * Exact, case-sensitive provider-run lookup.',
  'OpenSwan lifecycle-list core',
);
const assignedOpenSwanRoute = section(
  chat,
  "if (normalizedProvider === 'openswan')",
  "const bridgeProviders = ['claude-code'",
  'Chat assigned OpenSwan route',
);
const terminalLaunchRoute = section(
  chat,
  '// ─── Terminal agent launcher',
  '// ─── Automation builder intercept',
  'Chat terminal launch route',
);
const officeSessionMessageRoute = section(
  officeChat,
  '      // msg',
  '      // broadcast',
  'OfficeChat session-message route',
);

// The React Native service is an adapter only. Identity and lifecycle truth
// stay in the import-free core.
assert.match(service, /parseOpenSwanSpawnDisposition as parseOpenSwanSpawnDispositionCore/, 'service imports the canonical spawn disposition reader');
assert.match(service, /parseOpenSwanSessionSendHandle as parseOpenSwanSessionSendHandleCore/, 'service imports the canonical session-send reader');
assert.match(service, /parseOpenSwanSubagentLifecycleSnapshot as parseOpenSwanSubagentLifecycleSnapshotCore/, 'service imports the canonical lifecycle-list reader');
assert.match(serviceWrappers, /return parseOpenSwanSpawnHandleCore\(value\);/, 'public spawn reader delegates to the core');
assert.match(serviceWrappers, /return parseOpenSwanSpawnDispositionCore\(value\);/, 'public spawn-disposition reader delegates to the core');
assert.match(serviceWrappers, /return parseOpenSwanSessionSendHandleCore\(value\);/, 'public session-send reader delegates to the core');
assert.match(serviceWrappers, /return parseOpenSwanSubagentLifecycleSnapshotCore\(value\);/, 'public lifecycle-list reader delegates to the core');
assert.match(spawnService, /const disposition = parseOpenSwanSpawnDispositionCore\(result\.result\);/, 'spawn service reads the full structured disposition through the core');
const parsedSpawnIndex = spawnService.indexOf('const disposition = parseOpenSwanSpawnDispositionCore(result.result);');
const acceptedSpawnIndex = spawnService.indexOf('ok: true', parsedSpawnIndex);
assert.ok(parsedSpawnIndex >= 0 && acceptedSpawnIndex > parsedSpawnIndex, 'spawn acceptance follows structured parsing');
const spawnAcceptanceGate = spawnService.slice(parsedSpawnIndex, acceptedSpawnIndex);
assert.match(spawnAcceptanceGate, /!disposition/, 'missing structured spawn disposition has an explicit outcome-unknown gate');
assert.match(spawnAcceptanceGate, /disposition\.transportAccepted === false/, 'explicit spawn rejection remains failed');
assert.match(spawnAcceptanceGate, /disposition\.transportAccepted !== true/, 'ambiguous spawn remains non-accepted');
assert.match(spawnAcceptanceGate, /!disposition\.providerRunId \|\| !disposition\.childSessionKey/, 'positive spawn acceptance requires both exact identities');
assert.match(spawnAcceptanceGate, /transportAccepted:\s*null/, 'transport-boundary and malformed spawn outcomes remain unknown');
const acceptedSpawnReturn = spawnService.slice(acceptedSpawnIndex, spawnService.indexOf('} catch', acceptedSpawnIndex));
assert.match(acceptedSpawnReturn, /providerRunId:\s*disposition\.providerRunId/, 'accepted spawn preserves the required provider-run lineage');
assert.match(acceptedSpawnReturn, /sessionKey:\s*disposition\.childSessionKey/, 'accepted spawn preserves the required child-session lineage');
assert.match(acceptedSpawnReturn, /transportAccepted:\s*true/, 'accepted spawn exposes positive transport evidence only after the identity gate');

// sessions_send asks the gateway to return before the client abort boundary.
const clientTimeoutMs = numericLiteral(
  rawToolInvoker,
  /const SLOW_TOOL_TIMEOUT_MS = ([\d_]+);/,
  'slow client timeout',
);
const sendTimeoutSeconds = numericLiteral(
  sendService,
  /timeoutSeconds:\s*(\d+)/,
  'sessions_send gateway timeout',
);
assert.ok(sendTimeoutSeconds * 1_000 < clientTimeoutMs, 'gateway timeout stays below the client abort boundary');
assert.doesNotMatch(
  rawToolInvoker.match(/const FAST_TOOLS = new Set\(\[([^\]]*)\]\)/)?.[1] || '',
  /sessions_send/,
  'sessions_send remains on the declared slow client boundary',
);
assert.match(
  rawToolInvoker,
  /const isFastRead = FAST_TOOLS\.has\(tool\) \|\| \(tool === 'cron' && args\.action === 'list'\);/,
  'cron inventory uses the bounded fast-read deadline without shortening cron mutation budgets',
);
assert.match(
  rawToolInvoker,
  /const timer = setTimeout[\s\S]*const res = await fetch[\s\S]*const payload = await res\.json\(\);[\s\S]*finally \{\s*clearTimeout\(timer\);/,
  'the raw tool deadline remains armed through response-body consumption',
);
assert.match(toolCapabilityState, /const unsupportedToolEndpointCache = new Map<string, number>\(\);/, 'endpoint capability failures expire instead of surviving until page reload');
assert.match(rawToolInvoker, /if \(tool === 'sessions_list'\) markToolRpcEndpointUnsupported\(endpointKey\);/, 'only the baseline session inventory may classify the whole tool endpoint as unsupported');
assert.match(rawToolInvoker, /markToolUnsupported\(endpointKey, tool\);[\s\S]{0,320}if \(tool === 'sessions_list'\)/, 'an optional-tool 404 is cached per tool without disabling other capabilities');
assert.match(cronInventoryService, /Array\.isArray\(rawJobs\)[\s\S]{0,420}jobs\.every\(\(job\): job is CronJob => !!job\)[\s\S]{0,220}new Set\(ids\)\.size === ids\.length/, 'cron inventory rejects malformed, partial, and duplicate structured snapshots');
assert.match(cronInventoryService, /raw\.enabled === undefined && raw\.disabled === undefined/, 'cron inventory never assumes a missing enabled state is true');
assert.match(agentInventoryService, /const rawAgents = Array\.isArray\(raw\)/, 'runtime-agent inventory requires a recognized structured array');
assert.match(agentInventoryService, /new Set\(agents\)\.size !== agents\.length/, 'runtime-agent inventory rejects malformed members and duplicates');
assert.match(sessionInventoryService, /if \(!sessions\) \{[\s\S]{0,160}no trustworthy structured session inventory/, 'session inventory rejects malformed 2xx payloads instead of publishing empty evidence');
assert.match(providerParsers, /isProviderRecord\(raw\.details\)[\s\S]{0,120}Array\.isArray\(raw\.details\.sessions\)/, 'session identity comes only from structured details.sessions');
assert.doesNotMatch(providerParsers, /parseSessionsFromText|session\[:\\s\]/, 'session identity is never fabricated from prose');
assert.match(providerParsers, /seen\.has\(sessionKey\)/, 'duplicate exact session keys invalidate the whole snapshot');
assert.match(detailedListService, /return \{ ok: false, subagents: \[\], error: 'OpenSwan returned no structured subagent inventory' \}/, 'unrecognized subagent payloads become lane errors rather than verified empty state');
assert.match(webSearchService, /result\.result\?\.details\?\.citations/, 'web search consumes the structured citations inventory');
assert.match(webSearchService, /parsed\.protocol !== 'https:' \|\| parsed\.username \|\| parsed\.password/, 'web-search citations require credential-free HTTPS URLs');
assert.doesNotMatch(webSearchService, /result\.result\?\.results\s*\|\|\s*\[\]/, 'web-search prose or unknown schemas never become verified empty results');

// OfficeChat must let the service's 25s gateway disposition arrive before the
// service's 30s client abort. It may call the service directly or use a wrapper
// whose deadline is strictly beyond the service boundary.
const directOfficeSessionSend = /const result = await sendSessionMessage\(defaultConn\.config, sessionKey, message\);/.test(officeSessionMessageRoute);
const wrappedOfficeSessionSend = officeSessionMessageRoute.match(
  /withTimeout\(\s*sendSessionMessage\(defaultConn\.config, sessionKey, message\)\s*,\s*([A-Za-z_$][\w$]*|[\d_]+)/,
);
let officeSessionTimeoutMs: number | null = null;
if (wrappedOfficeSessionSend?.[1]) {
  const timeoutToken = wrappedOfficeSessionSend[1];
  if (/^[\d_]+$/.test(timeoutToken)) {
    officeSessionTimeoutMs = Number(timeoutToken.replace(/_/g, ''));
  } else {
    const escapedToken = timeoutToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const declaration = officeChat.match(new RegExp(`const\\s+${escapedToken}\\s*=\\s*([\\d_]+)`));
    officeSessionTimeoutMs = declaration?.[1] ? Number(declaration[1].replace(/_/g, '')) : null;
  }
}
assert.ok(
  directOfficeSessionSend
    || (officeSessionTimeoutMs !== null && officeSessionTimeoutMs > clientTimeoutMs),
  'OfficeChat cannot time out an exact session send before OpenSwan returns its structured disposition',
);
assert.match(
  officeSessionMessageRoute,
  /addMsg\(result\.ok \? `↗ \$\{result\.reply\}` : `❌ \$\{result\.error \|\| 'Failed'\}`/,
  'OfficeChat presents accepted session transport as a handoff rather than verified task completion',
);
assert.doesNotMatch(
  officeSessionMessageRoute,
  /addMsg\(result\.ok \? `✅/,
  'OfficeChat never gives an accepted session send a completion checkmark',
);

assert.doesNotMatch(
  agentGatewayPanels,
  /\bsendSessionMessage\b|\bspawnSubAgent\b|\bsaveSoulAwareAgentMemory\b/,
  'AgentGatewayPanels does not own a second task, subagent, or action-memory execution path',
);
assert.match(
  agentGatewayPanels,
  /onOpenInChat\(taskInput\.trim\(\)\)/,
  'the primary Runtime task carries its draft to canonical Chat without auto-send',
);
assert.doesNotMatch(
  agentGatewayPanels,
  /messageInput|DRAFT FOR CHAT|send a session message/,
  'the Runtime panel keeps one generic Chat draft instead of a duplicate advanced composer',
);
assert.match(
  agentGatewayPanels,
  /onOpenInChat\(`Delegate this to a subagent: \$\{spawnInput\.trim\(\)\}`\)/,
  'the advanced delegation draft also hands off to canonical Chat',
);
const runtimeSearchAction = section(
  agentGatewayPanels,
  'const runAction = useCallback',
  'const exactSessionMatches',
  'OpenSwan runtime search action',
);
const runtimeProviderResult = runtimeSearchAction.indexOf('const result = await fn(config);');
const runtimeProviderSuccessGate = runtimeSearchAction.indexOf('if (!result.ok) throw new Error(result.error);');
const runtimeCurrentGate = runtimeSearchAction.indexOf('if (!invocationIsCurrent()) return false;', runtimeProviderSuccessGate);
const runtimeLatestConfigRead = runtimeSearchAction.indexOf('const latestConfig = await resolveConfig();', runtimeCurrentGate);
const runtimeFingerprintGate = runtimeSearchAction.indexOf(
  '!matchesOpenSwanConnectionFingerprint(capturedConnectionFingerprint, latestConfig.connection)',
  runtimeLatestConfigRead,
);
const runtimeResultCommit = runtimeSearchAction.indexOf('result.commit?.();', runtimeFingerprintGate);
assert.ok(
  runtimeProviderResult >= 0
    && runtimeProviderSuccessGate > runtimeProviderResult
    && runtimeCurrentGate > runtimeProviderSuccessGate
    && runtimeLatestConfigRead > runtimeCurrentGate
    && runtimeFingerprintGate > runtimeLatestConfigRead
    && runtimeResultCommit > runtimeFingerprintGate,
  'read-only runtime search results commit only after exact success, live authority, and connection revalidation',
);
assert.match(service, /export function parseCronMutationReceipt\([\s\S]{0,2200}if \(expectedAction === 'run' && !runId\) return null;/, 'cron actions require a structured exact target receipt and run lineage');
assert.doesNotMatch(section(service, 'export async function manageCronJob', 'export async function createCronJob', 'cron mutation'), /\.match\(|'Done'/, 'cron mutation success is never inferred from provider prose');
assert.doesNotMatch(section(service, 'export async function createCronJob', 'export async function searchMemory', 'cron creation'), /'created'|idMatch|\.match\(/, 'cron creation never fabricates an id or infers it from prose');

// The service preserves provider identity for every recognized disposition,
// but only a typed true acceptance returns ok:true.
assert.match(sendService, /const handle = parseOpenSwanSessionSendHandleCore\(result\.result\);/, 'sessions_send delegates structured disposition to the core');
assert.match(sendService, /if \(!result\.ok\) \{[\s\S]{0,180}transportAccepted:\s*null/, 'sessions_send transport failure remains outcome-unknown');
assert.match(sendService, /handle\.transportAccepted === true[\s\S]{0,180}!handle\.providerRunId[\s\S]{0,180}handle\.sessionKey !== sessionKey/, 'positive sessions_send evidence requires exact provider and requested-session lineage');
assert.match(
  sendService,
  /const lineage = \{[\s\S]{0,240}providerRunId:\s*handle\.providerRunId \|\| undefined,[\s\S]{0,160}sessionKey:\s*handle\.sessionKey \|\| undefined,[\s\S]{0,160}providerStatus:\s*handle\.providerStatus,[\s\S]{0,160}transportAccepted:\s*handle\.transportAccepted/,
  'sessions_send keeps provider run, session, status, and acceptance as separate lineage',
);
const acceptedIdentityGateStart = sendService.indexOf('handle.transportAccepted === true');
const acceptedIdentityGateEnd = sendService.indexOf('const lineage = {', acceptedIdentityGateStart);
const firstAcceptedSendReturn = sendService.indexOf('ok: true', acceptedIdentityGateStart);
assert.ok(
  acceptedIdentityGateStart >= 0
    && acceptedIdentityGateEnd > acceptedIdentityGateStart
    && firstAcceptedSendReturn > acceptedIdentityGateEnd,
  'sessions_send validates accepted identity before any ok:true result',
);
const acceptedIdentityGate = sendService.slice(acceptedIdentityGateStart, acceptedIdentityGateEnd);
assert.match(acceptedIdentityGate, /!handle\.providerRunId/, 'accepted session send requires a provider-run id');
assert.match(acceptedIdentityGate, /!handle\.sessionKey/, 'accepted session send requires an echoed session key');
assert.match(acceptedIdentityGate, /handle\.sessionKey !== sessionKey/, 'accepted session send requires the echoed session to exactly match the requested session');
assert.match(acceptedIdentityGate, /ok:\s*false/, 'missing or mismatched accepted identity fails closed');
assert.match(acceptedIdentityGate, /dispatch outcome is unknown/, 'missing or mismatched accepted identity stays outcome-unknown');
assert.match(acceptedIdentityGate, /task was not replayed/, 'missing or mismatched accepted identity cannot trigger an automatic replay');
assert.match(acceptedIdentityGate, /transportAccepted:\s*null/, 'untrustworthy accepted identity is not exposed as positive transport acceptance');
assert.match(sendCore, /taskCompletionVerified:\s*false as const/, 'every session-send disposition remains task-unverified');
assert.match(sendCore, /case 'accepted':[\s\S]{0,260}transportAccepted:\s*true,[\s\S]{0,180}terminalResult:\s*null/, 'accepted proves transport acceptance only');
assert.match(sendCore, /case 'ok':[\s\S]{0,260}transportAccepted:\s*true,[\s\S]{0,180}terminalResult:\s*'outcome_unknown'/, 'ok ends the provider turn without claiming task completion');
assert.match(sendCore, /case 'timeout':[\s\S]{0,260}transportAccepted:\s*true,[\s\S]{0,180}responseTimedOut:\s*true/, 'timeout preserves accepted external work while the response is pending');
assert.match(
  sendService,
  /if \(handle\.phase === 'response_timeout'\) \{[\s\S]{0,260}ok:\s*true,[\s\S]{0,180}The session accepted the task\. Its response is still pending\.[\s\S]{0,120}\.\.\.lineage/,
  'service returns timeout as accepted-but-pending with external lineage',
);
assert.doesNotMatch(sendService, /completionVerified:\s*true/, 'service never promotes a session-send response to task completion');

// Error and future/unknown statuses fail closed. The adapter never calls them
// accepted and tells Chat not to replay an ambiguous send.
assert.match(
  sendCore,
  /case 'error':[\s\S]{0,1800}phase:\s*'pre_dispatch_failed',[\s\S]{0,180}transportAccepted:\s*false/,
  'an identity-free provider error is an explicit pre-dispatch failure',
);
assert.match(
  sendCore,
  /case 'error':[\s\S]{0,2600}phase:\s*'provider_error_unknown_dispatch',[\s\S]{0,180}transportAccepted:\s*null/,
  'an error with present or malformed provider identity remains dispatch-unknown',
);
assert.match(sendCore, /phase:\s*'unrecognized_status',[\s\S]{0,180}transportAccepted:\s*null,[\s\S]{0,180}terminalResult:\s*'outcome_unknown'/, 'unrecognized provider status remains acceptance-unknown');
assert.match(sendService, /if \(!handle\) \{[\s\S]{0,220}ok:\s*false,[\s\S]{0,180}dispatch outcome is unknown/, 'missing structured disposition fails closed');
assert.match(sendService, /if \(handle\.transportAccepted === false\) \{[\s\S]{0,220}ok:\s*false/, 'explicit rejection cannot be returned as accepted');
assert.match(
  sendService,
  /if \(handle\.transportAccepted !== true\) \{[\s\S]{0,260}ok:\s*false,[\s\S]{0,220}The task was not replayed\./,
  'ambiguous provider error cannot be called accepted or auto-replayed',
);

// An exact existing OpenSwan session is a single-attempt route. Ambiguous
// transport becomes a durable unknown receipt; explicit rejection throws.
const exactSessionStart = assignedOpenSwanRoute.indexOf("if (agent.sessionKey && agent.source === 'openswan-session')");
const spawnFallbackStart = assignedOpenSwanRoute.indexOf('const preface = [');
assert.ok(exactSessionStart >= 0 && spawnFallbackStart > exactSessionStart, 'exact-session branch precedes spawn fallback');
const exactSessionBranch = assignedOpenSwanRoute.slice(exactSessionStart, spawnFallbackStart);
assert.match(exactSessionBranch, /const sessionResult = await sendSessionMessage\(config, agent\.sessionKey, taskWithVisualContext\)/, 'exact session receives one structured send attempt');
assert.match(exactSessionBranch, /if \(sessionResult\.ok\) \{[\s\S]{0,760}return trackedReceipt\(\s*receipt\(/, 'accepted exact-session send returns its tracked receipt');
assert.match(exactSessionBranch, /if \(sessionResult\.transportAccepted !== false\) \{[\s\S]{0,520}return receipt\(\s*'unknown'/, 'uncertain exact-session send returns a durable unknown receipt');
assert.match(exactSessionBranch, /throw new Error\(sessionResult\.error \|\|/, 'failed exact-session send stops routing');
assert.doesNotMatch(exactSessionBranch, /spawnSubAgent\(/, 'failed exact-session send cannot silently spawn or replay');

const attemptedSpawnStart = assignedOpenSwanRoute.indexOf('const spawnResult = await spawnSubAgent(config, preface, preferredModel);');
assert.ok(attemptedSpawnStart > spawnFallbackStart, 'Chat attempted-spawn result handling is reachable');
const attemptedSpawnRoute = assignedOpenSwanRoute.slice(attemptedSpawnStart);
const acceptedSpawnBranch = attemptedSpawnRoute.indexOf('if (spawnResult.ok) {');
const acceptedSpawnReturnIndex = attemptedSpawnRoute.search(/return trackedReceipt\(\s*receipt\(/);
const unknownSpawnReturnIndex = attemptedSpawnRoute.search(/return receipt\(\s*'unknown'/);
const failedSpawnThrowIndex = attemptedSpawnRoute.indexOf('throw new Error(spawnResult.error ||', unknownSpawnReturnIndex);
assert.ok(
  acceptedSpawnBranch >= 0
    && acceptedSpawnReturnIndex > acceptedSpawnBranch
    && unknownSpawnReturnIndex > acceptedSpawnReturnIndex
    && failedSpawnThrowIndex > unknownSpawnReturnIndex,
  'an attempted OpenSwan spawn returns accepted, unknown, or explicit failure before generic fallback',
);

// Current active/recent rows use only structured identity/status. Display copy
// may use bounded label/model/task fields, but content text is never decoded.
assert.match(detailedListService, /const lifecycle = parseOpenSwanSubagentLifecycleSnapshotCore\(raw\);/, 'current list delegates active/recent buckets to the core parser');
assert.match(
  detailedListService,
  /id:\s*record\.providerRunId,[\s\S]{0,180}sessionKey:\s*record\.childSessionKey,[\s\S]{0,180}status:\s*record\.runtimeStatus/,
  'current list projects exact structured lifecycle identity and status',
);
assert.doesNotMatch(detailedListService, /content\?\.|JSON\.parse|\.text\b/, 'current and legacy lifecycle identity never parse content text');
assert.match(listCore, /readStructuredField\(details, 'active'\)/, 'core reads the structured active bucket');
assert.match(listCore, /readStructuredField\(details, 'recent'\)/, 'core reads the structured recent bucket');

// Terminal task launch carries three distinct identities: provider launch id,
// exact single session id, then the local UUID returned by canonical tracking.
const launchReceiptStart = terminalLaunchRoute.indexOf('const rawReceipt = buildConnectedAgentHandoffReceipt({');
const launchReceiptEnd = terminalLaunchRoute.indexOf('const handoff = await attachAcceptedHandoffRun', launchReceiptStart);
assert.ok(launchReceiptStart >= 0 && launchReceiptEnd > launchReceiptStart, 'task-bearing terminal launch receipt is reachable');
const launchReceipt = terminalLaunchRoute.slice(launchReceiptStart, launchReceiptEnd);
assert.match(launchReceipt, /sessionId:\s*launchedSessionId/, 'terminal launch stores only the exact single session as session lineage');
assert.match(launchReceipt, /providerRunId:\s*launchResult\.launchId \|\| null/, 'terminal launch stores the provider launch id separately');
assert.match(launchReceipt, /runId:\s*null/, 'terminal launch never treats external lineage as a local run UUID');
assert.match(terminalLaunchRoute, /const handoff = await attachAcceptedHandoffRun\(rawReceipt, content, launchSubject\)/, 'canonical tracking alone may add the local run UUID');

console.log('openswan-service-lifecycle-wiring smoke: all contracts passed');
