/**
 * connected-agent-chat-handoff-wiring-smoketest
 *
 * Source-level integration coverage for Chat's truthful connected-agent
 * acknowledgement boundary. The smoke never contacts or launches a bridge.
 *
 * Run: npm run smoke:connected-agent-chat-handoff
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = process.cwd();
const chatPath = resolve(repoRoot, 'src/screens/circles/tabs/ChatTab.tsx');
const typesPath = resolve(repoRoot, 'src/lib/chatMessageTypes.ts');
const receiptPath = resolve(repoRoot, 'src/lib/connectedAgentDispatch.ts');
const corePath = resolve(repoRoot, 'src/lib/connectedAgentHandoffCore.ts');
const runSystemPath = resolve(repoRoot, 'src/lib/agentRunSystem.ts');
const persistedMetadataPath = resolve(repoRoot, 'src/lib/persistedChatMetadata.ts');
const terminalControlPath = resolve(repoRoot, 'src/lib/terminalAgentControl.ts');
const terminalLauncherPath = resolve(repoRoot, 'src/lib/terminalAgentSessionLauncher.ts');
const openSwanServicePath = resolve(repoRoot, 'src/lib/openswanService.ts');
const openSwanLifecycleCorePath = resolve(repoRoot, 'src/lib/openswanSubagentLifecycleCore.ts');
const chatSource = readFileSync(chatPath, 'utf8');
const typesSource = readFileSync(typesPath, 'utf8');
const receiptSource = readFileSync(receiptPath, 'utf8');
const coreSource = readFileSync(corePath, 'utf8');
const runSystemSource = readFileSync(runSystemPath, 'utf8');
const persistedMetadataSource = readFileSync(persistedMetadataPath, 'utf8');
const terminalControlSource = readFileSync(terminalControlPath, 'utf8');
const terminalLauncherSource = readFileSync(terminalLauncherPath, 'utf8');
const openSwanServiceSource = readFileSync(openSwanServicePath, 'utf8');
const openSwanLifecycleCoreSource = readFileSync(openSwanLifecycleCorePath, 'utf8');

let assertions = 0;
let failures = 0;

function assert(condition: unknown, message: string, detail?: string): void {
  assertions += 1;
  if (condition) {
    console.log('pass:', message);
    return;
  }
  failures += 1;
  console.error('FAIL:', `${message}${detail ? ` — ${detail}` : ''}`);
}

function section(source: string, startMarker: string, endMarker: string, label: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert(start >= 0 && end > start, `${label} source section is reachable`);
  return start >= 0 && end > start ? source.slice(start, end) : '';
}

function count(source: string, pattern: RegExp): number {
  return (source.match(pattern) || []).length;
}

function assertReceiptReply(
  source: string,
  surface: string,
  dispatchCall: RegExp,
  label: string,
): void {
  assert(dispatchCall.test(source), `${label} obtains a typed handoff receipt`);
  const surfaceNeedle = `surface: '${surface}'`;
  const surfaceIndex = source.indexOf(surfaceNeedle);
  const callStart = surfaceIndex >= 0 ? source.lastIndexOf('addBotMessage(', surfaceIndex) : -1;
  const callEnd = surfaceIndex >= 0 ? source.indexOf('});', surfaceIndex) : -1;
  const call = callStart >= 0 && callEnd > callStart ? source.slice(callStart, callEnd + 3) : '';
  assert(call.length > 0, `${label} finalizes a bot message on ${surface}`);
  assert(/addBotMessage\(handoff\.message, undefined, \{/.test(call), `${label} renders the bounded receipt message`);
  assert(/delegatedTo:\s*handoff\.actor/.test(call), `${label} persists receipt actor attribution`);
  assert(/connectedAgentHandoff:\s*projectConnectedAgentHandoffSnapshot\(handoff\) \|\| undefined/.test(call), `${label} persists the bounded typed handoff snapshot`);
  assert(/outcomeVerdict:\s*'unknown'/.test(call), `${label} persists a non-complete outcome`);
  assert(/runId:\s*handoff\.runId/.test(call), `${label} accepts run lineage only from the sanitized receipt`);
  assert(/showRunTrace:\s*!!handoff\.runId/.test(call), `${label} exposes run trace only for a genuine receipt run id`);
  assert(!/localOnly:\s*true/.test(call), `${label} receipt remains transcript-durable`);
}

const assignedDispatch = section(
  chatSource,
  'const dispatchAssignedAgentTask = useCallback',
  'const spawnDedicatedOpenSwanSession = useCallback',
  'assigned-agent dispatcher',
);
const dedicatedSpawn = section(
  chatSource,
  'const spawnDedicatedOpenSwanSession = useCallback',
  'useEffect(() => {\n    if (showPluginPicker)',
  'dedicated OpenSwan dispatcher',
);
const addBotMessage = section(
  chatSource,
  'const addBotMessage = (',
  'const updateBotMessage = (',
  'bot-message finalizer',
);
const multiAgentRoute = section(
  chatSource,
  'const strategySurface = multiAgentPlan.strategy',
  '// ─── Selected connected-agent route',
  'multi-agent route',
);
const selectedRoute = section(
  chatSource,
  '// ─── Selected connected-agent route',
  '// ─── Slash intercepts',
  'selected-agent route',
);
const assignCommand = section(
  chatSource,
  '// /assign — single-target dispatch.',
  '// /v2loop — per-device canary flip',
  '/assign route',
);
const terminalControlRoute = section(
  chatSource,
  '// ─── Terminal agent control',
  '// ─── Terminal agent launcher',
  'terminal-agent control route',
);
const terminalLaunchRoute = section(
  chatSource,
  '// ─── Terminal agent launcher',
  '// ─── Automation builder intercept',
  'terminal-agent launch route',
);
const assignmentPanelArea = section(
  chatSource,
  "{selectedAgent?.provider === 'openswan'",
  '{/* Handoff suggestion card */}',
  'assignment-panel handlers',
);

assert(
  /import\s*\{[\s\S]{0,180}\bbuildConnectedAgentHandoffReceipt\b[\s\S]{0,180}\btype ConnectedAgentHandoffReceipt\b[\s\S]{0,80}\}\s*from '\.\.\/\.\.\/\.\.\/lib\/connectedAgentDispatch';/.test(chatSource),
  'Chat imports the canonical receipt builder and type',
);
assert(
  /export function buildConnectedAgentHandoffReceipt\(input\?: unknown\): ConnectedAgentHandoffReceipt/.test(coreSource),
  'connectedAgentHandoffCore owns the pure receipt builder',
);
assert(
  /export\s*\{[\s\S]{0,260}\bbuildConnectedAgentHandoffReceipt\b[\s\S]{0,260}\}\s*from '\.\/connectedAgentHandoffCore';/.test(receiptSource),
  'connectedAgentDispatch re-exports the canonical handoff contract',
);
assert(
  count(chatSource, /buildConnectedAgentHandoffReceipt\(\{/g) >= 2,
  'Chat builds receipts for assigned dispatch and dedicated OpenSwan spawn',
);

assert(
  /\): Promise<ConnectedAgentHandoffReceipt> =>/.test(assignedDispatch)
    && /buildConnectedAgentHandoffReceipt\(\{/.test(assignedDispatch),
  'dispatchAssignedAgentTask returns the typed canonical receipt',
);
assert(
  /\): Promise<ConnectedAgentHandoffReceipt> =>/.test(dedicatedSpawn)
    && /const receipt = buildConnectedAgentHandoffReceipt\(\{/.test(dedicatedSpawn)
    && /return attachAcceptedHandoffRun\(/.test(dedicatedSpawn),
  'dedicated OpenSwan spawn returns the typed canonical receipt',
);

assert(
  /if \(sessionResult\.ok\) \{[\s\S]{0,520}return trackedReceipt\(\s*receipt\(\s*'accepted'/.test(assignedDispatch),
  'existing OpenSwan session success is accepted, not completed',
);
assert(
  /if \(spawnResult\.ok\) \{[\s\S]{0,560}return trackedReceipt\(\s*receipt\(\s*'accepted'/.test(assignedDispatch),
  'new OpenSwan session success is accepted, not completed',
);
assert(
  /if \(sendResult\.ok\) \{[\s\S]{0,300}return trackedReceipt\(receipt\(\s*'accepted'/.test(assignedDispatch),
  'managed terminal session send is accepted, not completed',
);

const managedBridgeResultStart = assignedDispatch.indexOf('if (result.ok) {');
const managedBridgeResultEnd = assignedDispatch.indexOf(
  'if (result.transportAccepted !== false)',
  Math.max(0, managedBridgeResultStart),
);
const managedBridgeResult = managedBridgeResultStart >= 0 && managedBridgeResultEnd > managedBridgeResultStart
  ? assignedDispatch.slice(managedBridgeResultStart, managedBridgeResultEnd)
  : '';
const missingBridgeSessionStart = managedBridgeResult.indexOf('if (!result.sessionId) {');
const acceptedBridgeTrackingStart = managedBridgeResult.indexOf("return trackedReceipt(receipt(\n            'accepted'");
const synchronousDraftStart = managedBridgeResult.indexOf("return receipt(\n          'drafted'");
const missingBridgeSessionBranch = missingBridgeSessionStart >= 0 && acceptedBridgeTrackingStart > missingBridgeSessionStart
  ? managedBridgeResult.slice(missingBridgeSessionStart, acceptedBridgeTrackingStart)
  : '';

assert(
  managedBridgeResultStart >= 0
    && missingBridgeSessionStart >= 0
    && acceptedBridgeTrackingStart > missingBridgeSessionStart
    && synchronousDraftStart > acceptedBridgeTrackingStart,
  'managed bridge result classifies exact lineage before accepted tracking or synchronous drafting',
);
assert(
  /return receipt\(\s*'unknown'/.test(missingBridgeSessionBranch)
    && /exact session identity|session lineage/i.test(missingBridgeSessionBranch)
    && !/(?:trackedReceipt|attachAcceptedHandoffRun|wakeAndAssignTask|dispatchBridgeTask|spawnNewSession)\s*\(/.test(missingBridgeSessionBranch),
  'missing-session positive bridge acknowledgement becomes unknown with no canonical writer or replay',
);
assert(
  /return trackedReceipt\(receipt\(\s*'accepted'[\s\S]{0,500}result\.sessionId/.test(
    managedBridgeResult.slice(Math.max(0, acceptedBridgeTrackingStart), Math.max(0, synchronousDraftStart)),
  ),
  'genuine session-linked managed bridge launch is accepted and tracked',
);
assert(
  /if \(customResult\.ok\) \{[\s\S]{0,340}return trackedReceipt\(receipt\(\s*'accepted'/.test(assignedDispatch),
  'custom bridge success is accepted, not completed',
);
assert(
  synchronousDraftStart > acceptedBridgeTrackingStart
    && /return receipt\(\s*'drafted'[\s\S]{0,260}synchronous draft/i.test(
      managedBridgeResult.slice(synchronousDraftStart),
    ),
  'successful non-bridge synchronous fallback output is explicitly drafted',
);
assert(
  /const aiResp = await getAIResponse[\s\S]{0,950}return receipt\(\s*'drafted'/.test(assignedDispatch),
  'generic synchronous AI fallback is explicitly drafted',
);
assert(
  !/executed via/i.test(chatSource),
  'Chat source no longer describes an acknowledgement as executed',
);
assert(
  !/(?:\|\||\?\?)\s*['"]Done['"]/.test(chatSource),
  'Chat source no longer defaults connected-agent acknowledgement copy to Done',
);

assert(
  /runId:\s*null,[\s\S]{0,80}message,/.test(assignedDispatch),
  'assigned dispatch never manufactures a run id from bridge acknowledgement data',
);
assert(
  /sessionId:\s*result\.sessionKey \|\| null,[\s\S]{0,100}providerRunId:\s*result\.providerRunId \|\| null,[\s\S]{0,100}runId:\s*null,/.test(dedicatedSpawn),
  'dedicated OpenSwan acknowledgement keeps provider lineage distinct and does not manufacture a local run id',
);
assert(
  /export function parseOpenSwanSpawnDisposition\([\s\S]{0,120}\): OpenSwanSpawnDisposition \| null/.test(openSwanLifecycleCoreSource)
    && /export function parseOpenSwanSpawnHandle\(input:\s*unknown\): OpenSwanSpawnHandle \| null/.test(openSwanLifecycleCoreSource)
    && /disposition\.phase !== 'accepted'/.test(openSwanLifecycleCoreSource),
  'OpenSwan lifecycle core owns structured spawn disposition and accepted-handle parsing',
);
assert(
  /const disposition = parseOpenSwanSpawnDispositionCore\(result\.result\)/.test(openSwanServiceSource)
    && /providerRunId:\s*disposition\.providerRunId/.test(openSwanServiceSource)
    && /sessionKey:\s*disposition\.childSessionKey/.test(openSwanServiceSource),
  'OpenSwan spawn returns structured provider-run and child-session lineage',
);
assert(
  /if \(sessionResult\.transportAccepted !== false\) \{[\s\S]{0,520}return receipt\(\s*'unknown'/.test(assignedDispatch)
    && /if \(spawnResult\.transportAccepted !== false\) \{[\s\S]{0,520}return receipt\(\s*'unknown'/.test(assignedDispatch),
  'OpenSwan uncertain send and spawn attempts remain durable unknown handoffs',
);
assert(
  /status:\s*'unknown'[\s\S]{0,500}providerRunId:\s*result\.providerRunId \|\| null/.test(dedicatedSpawn),
  'dedicated OpenSwan uncertain spawn retains outcome-unknown external lineage',
);
assert(
  /spawnResult\.sessionKey,[\s\S]{0,100}spawnResult\.providerRunId/.test(assignedDispatch)
    && /sessionId:\s*result\.sessionKey \|\| null,[\s\S]{0,100}providerRunId:\s*result\.providerRunId \|\| null/.test(dedicatedSpawn),
  'assigned and dedicated OpenSwan paths adopt only parsed structured spawn handles',
);
assert(
  !/runId:\s*(?:agent|result|sessionResult|sendResult|spawnResult|customResult)\b/.test(assignedDispatch + dedicatedSpawn),
  'dispatchers never substitute agent, bridge, or session identifiers for run ids',
);

assert(
  /export type TerminalAgentControlResult = \{[\s\S]{0,120}kind:\s*'status_query' \| 'handoff';[\s\S]{0,120}ok:\s*boolean;/.test(terminalControlSource),
  'direct terminal control returns a typed status-versus-handoff discriminant',
);
assert(
  /return \{ kind:\s*'status_query',\s*ok:\s*true,\s*message:\s*formatTerminalAgentStatus\(sessions\) \};/.test(terminalControlSource),
  'terminal status queries are explicitly non-handoff results',
);
assert(
  count(terminalControlSource, /kind:\s*'handoff'/g) >= 5,
  'every direct terminal send/launch-or-fail branch is marked as a handoff result',
);
assert(
  /if \(terminalAgentControl\.kind === 'status_query'\) \{[\s\S]{0,260}localOnly:\s*true,[\s\S]{0,120}durability:\s*'ephemeral'/.test(terminalControlRoute),
  'status-query output stays ephemeral and bypasses handoff persistence',
);
assert(
  /const terminalControlStatus = terminalAgentControl\.ok[\s\S]{0,220}terminalAgentControl\.transportAccepted === false[\s\S]{0,120}'unknown'/.test(terminalControlRoute)
    && /status:\s*terminalControlStatus/.test(terminalControlRoute)
    && /runId:\s*null/.test(terminalControlRoute),
  'direct terminal sends normalize accepted/failed/unknown state without synthesizing a run id',
);
assert(
  /const handoff = await attachAcceptedHandoffRun\([\s\S]{0,180}rawReceipt,[\s\S]{0,180}content,[\s\S]{0,180}terminalAgentControl\.agentSubjectMetadata/.test(terminalControlRoute),
  'direct terminal handoff adopts a canonical run only through the accepted-run recorder',
);
assert(
  /outcomeVerdict:\s*terminalControlStatus === 'failed' \? 'failed' : 'unknown'/.test(terminalControlRoute)
    && /hadError:\s*terminalControlStatus === 'failed'/.test(terminalControlRoute),
  'direct terminal acceptance and uncertainty stay unknown while proven failure is failed with hadError',
);
assert(
  /connectedAgentHandoff:\s*projectConnectedAgentHandoffSnapshot\(handoff\) \|\| undefined/.test(terminalControlRoute)
    && /runId:\s*handoff\.runId/.test(terminalControlRoute),
  'direct terminal result persists its bounded receipt and canonical run lineage',
);
assert(
  !/addBotMessage\(terminalAgentControl\.message, undefined, \{ localOnly:\s*true \}\)/.test(terminalControlRoute),
  'direct terminal handoffs no longer collapse into plain local-only prose',
);

assert(
  /if \(launchPlan\.usedDefaultPrompts && launchResult\.launched > 0\) \{/.test(terminalLaunchRoute),
  'standby-only session launch is distinguished from a task-bearing launch',
);
assert(
  /export interface TerminalAgentLaunchExecution \{[\s\S]{0,120}plan:\s*TerminalAgentLaunchPlan;[\s\S]{0,120}result:\s*TerminalAgentLaunchResult;/.test(terminalLauncherSource)
    && /return \{ plan, result, message:\s*formatTerminalAgentLaunchResponse\(plan, result\) \};/.test(terminalLauncherSource),
  'terminal launcher returns the parsed plan and structured launch result for task-bearing classification',
);
assert(
  /if \(launchPlan\.usedDefaultPrompts && launchResult\.launched > 0\) \{[\s\S]{0,520}localOnly:\s*true,[\s\S]{0,520}return;/.test(terminalLaunchRoute),
  'standby-only launch remains a local launch acknowledgement and exits before task receipt adoption',
);
assert(
  /const launchHandoffStatus = launchResult\.launched > 0[\s\S]{0,220}launchResult\.transportAccepted === false[\s\S]{0,120}'unknown'/.test(terminalLaunchRoute)
    && /status:\s*launchHandoffStatus/.test(terminalLaunchRoute)
    && /sessionId:\s*launchedSessionId/.test(terminalLaunchRoute)
    && /providerRunId:\s*launchResult\.launchId \|\| null/.test(terminalLaunchRoute)
    && /runId:\s*null/.test(terminalLaunchRoute),
  'task-bearing launch keeps single-session, provider-run, and local-run identities distinct',
);
assert(
  /const handoff = await attachAcceptedHandoffRun\(rawReceipt, content, launchSubject\)/.test(terminalLaunchRoute),
  'task-bearing launch adopts a canonical accepted run',
);
assert(
  /outcomeVerdict:\s*launchHandoffStatus === 'failed' \? 'failed' : 'unknown'/.test(terminalLaunchRoute)
    && /hadError:\s*launchHandoffStatus === 'failed'/.test(terminalLaunchRoute),
  'task-bearing launch acceptance and uncertainty stay unknown while proven failure is failed with hadError',
);
assert(
  /connectedAgentHandoff:\s*projectConnectedAgentHandoffSnapshot\(handoff\) \|\| undefined/.test(terminalLaunchRoute)
    && /runId:\s*handoff\.runId/.test(terminalLaunchRoute),
  'task-bearing launch persists its bounded receipt and canonical run lineage',
);
assert(
  !/addBotMessage\(terminalAgentLaunch\.message, undefined, \{ localOnly:\s*true \}\)/.test(terminalLaunchRoute),
  'task-bearing launches no longer collapse into undifferentiated local-only prose',
);

assert(
  /outcomeVerdict\?: ChatOutcomeVerdict;/.test(typesSource),
  'ChatBotMessageExtra exposes the explicit typed outcome override',
);
assert(
  /const finalizeVerdict = authoritativeOutcomeSignal\?\.verdict\s*\|\|\s*extra\?\.outcomeVerdict\s*\|\|\s*inferredFinalizeVerdict;/.test(addBotMessage),
  'runtime terminal evidence wins before explicit outcomeVerdict and prose inference',
);

assertReceiptReply(
  selectedRoute,
  'selected_chat_agent_dispatch',
  /const handoff = await dispatchAssignedAgentTask\(selectedDispatchAgent, content, selectedAgentVisualBriefs\)/,
  'selected-agent route',
);
assertReceiptReply(
  assignCommand,
  'assign_agent_command',
  /const handoff = await dispatchAssignedAgentTask\(target, task, visualBriefs\)/,
  '/assign route',
);

const dedicatedUiStart = chatSource.lastIndexOf('const handoff = await spawnDedicatedOpenSwanSession', chatSource.indexOf("surface: 'dedicated_openswan_spawn'"));
const dedicatedUiEnd = chatSource.indexOf('} catch (e: any)', chatSource.indexOf("surface: 'dedicated_openswan_spawn'"));
const dedicatedUi = dedicatedUiStart >= 0 && dedicatedUiEnd > dedicatedUiStart
  ? chatSource.slice(dedicatedUiStart, dedicatedUiEnd)
  : '';
assertReceiptReply(
  dedicatedUi,
  'dedicated_openswan_spawn',
  /const handoff = await spawnDedicatedOpenSwanSession\(selectedAgent, requestedTask\)/,
  'dedicated OpenSwan UI route',
);

const assignPanelSurface = chatSource.indexOf("surface: 'assign_panel_agent'");
const assignPanelStart = chatSource.lastIndexOf('const handoff = await dispatchAssignedAgentTask', assignPanelSurface);
const assignPanelEnd = chatSource.indexOf('} catch (e: any)', assignPanelSurface);
const assignPanel = assignPanelStart >= 0 && assignPanelEnd > assignPanelStart
  ? chatSource.slice(assignPanelStart, assignPanelEnd)
  : '';
assertReceiptReply(
  assignPanel,
  'assign_panel_agent',
  /const handoff = await dispatchAssignedAgentTask\(selectedAgent, assignedTask\)/,
  'assign-panel route',
);
assert(
  !/circle_office_agents[\s\S]{0,240}\.update\(/.test(assignmentPanelArea),
  'assignment handlers do not reset an accepted roster agent to idle before typed completion',
);

const multiReply = section(
  multiAgentRoute,
  'const addMultiAgentReply = (',
  'const addMultiAgentCompletion = (',
  'multi-agent reply finalizer',
);
assert(/addBotMessage\(result\.reply, undefined, \{/.test(multiReply), 'multi-agent replies finalize the receipt message');
assert(/delegatedTo:\s*result\.agent\.name/.test(multiReply), 'multi-agent replies persist delegated agent attribution');
assert(/outcomeVerdict:\s*result\.receipt\?\.status === 'failed' \|\| !result\.ok \? 'failed' : 'unknown'/.test(multiReply), 'multi-agent receipt replies persist truthful non-complete or failed outcomes');
assert(/runId:\s*result\.receipt\?\.runId \|\| null/.test(multiReply), 'multi-agent replies accept only sanitized receipt run lineage');
assert(/showRunTrace:\s*!!result\.receipt\?\.runId/.test(multiReply), 'multi-agent trace visibility requires receipt run lineage');
assert(!/localOnly:\s*true/.test(multiReply), 'multi-agent receipt replies remain transcript-durable');
assert(count(multiAgentRoute, /receipt:\s*handoff/g) >= 2, 'sequential and parallel multi-agent paths retain typed receipts');
assert(/dispatch update:/.test(multiAgentRoute), 'multi-agent summary is labeled as a dispatch update');
assert(/Accepted handoffs are still awaiting typed completion/.test(multiAgentRoute), 'multi-agent summary states that accepted sessions still await typed completion');
assert(/Unknown dispatches were not replayed/.test(multiAgentRoute), 'multi-agent summary tells users to verify uncertain sessions before retrying');
assert(
  /outcomeVerdict:\s*accepted\.length > 0 \|\| drafted\.length > 0 \|\| unknown\.length > 0 \? 'unknown' : 'failed'/.test(multiAgentRoute),
  'multi-agent summary remains non-complete while accepted, drafted, or uncertain work exists',
);

assert(
  /import type \{ ConnectedAgentHandoffSnapshot \} from '\.\/connectedAgentHandoffCore';/.test(typesSource),
  'Chat message types use the canonical durable handoff snapshot',
);
assert(
  count(typesSource, /connectedAgentHandoff\?: ConnectedAgentHandoffSnapshot \| null;/g) >= 2,
  'live Chat messages and bot-message extras both carry typed handoff lineage',
);
assert(
  /connectedAgentHandoff\?: ConnectedAgentHandoffSnapshot \| null;/.test(persistedMetadataSource),
  'persisted Chat metadata exposes typed handoff lineage',
);
assert(
  count(persistedMetadataSource, /projectConnectedAgentHandoffSnapshot\(metadata\.connectedAgentHandoff\)/g) >= 5,
  'all persistence tiers project the bounded message-free handoff snapshot',
);
assert(
  /connectedAgentHandoff:\s*projectConnectedAgentHandoffSnapshot\(parsed\.connectedAgentHandoff\) \|\| undefined/.test(persistedMetadataSource),
  'persisted Chat metadata validates the handoff snapshot on read',
);
assert(
  /connectedAgentHandoff:\s*metadata\.connectedAgentHandoff \|\| undefined/.test(chatSource)
    && /assign\('connectedAgentHandoff', message\.connectedAgentHandoff\)/.test(chatSource),
  'initial/realtime hydration and projection retain the handoff snapshot',
);
const persistedHydration = section(
  chatSource,
  'function hydratePersistedChatBotMetadata',
  'function projectPersistedChatBotMetadata',
  'persisted-message hydration',
);
assert(
  /const runId = metadata\.runId[\s\S]{0,120}\|\| metadata\.connectedAgentHandoff\?\.runId[\s\S]{0,120}\|\| metadata\.computerHandoff\?\.runId/.test(persistedHydration),
  'persisted hydration recovers only canonical local run lineage',
);
assert(
  /const crossSurfaceFollowups = runId[\s\S]{0,220}deriveCrossSurfaceFollowups\(\{[\s\S]{0,180}contextRun:\s*\{ kind: 'run', id: runId \}/.test(persistedHydration),
  'persisted hydration re-derives the exact Office run action',
);
const pendingRecovery = section(
  chatSource,
  'function mapPendingBotRecordsToChatMessages',
  'function mergeRecoveredChatMessages',
  'pending-message recovery',
);
assert(
  /const connectedAgentHandoff = projectConnectedAgentHandoffSnapshot\(record\.connectedAgentHandoff\);/.test(pendingRecovery),
  'pending-message recovery sanitizes the durable handoff snapshot',
);
assert(
  /const recoveredRunId = record\.runId \|\| connectedAgentHandoff\?\.runId \|\| undefined;/.test(pendingRecovery),
  'pending-message recovery falls back only to the snapshot canonical run id',
);
assert(
  /connectedAgentHandoff:\s*connectedAgentHandoff \|\| undefined/.test(pendingRecovery),
  'pending-message recovery rehydrates only sanitized handoff lineage',
);
assert(
  /delegatedTo:\s*record\.delegatedTo \|\| connectedAgentHandoff\?\.actor/.test(pendingRecovery),
  'pending-message recovery falls back to the sanitized receipt actor',
);
assert(
  /runId:\s*recoveredRunId,[\s\S]{0,80}showRunTrace:\s*!!recoveredRunId/.test(pendingRecovery),
  'pending-message recovery restores Run Trace only for recovered canonical run lineage',
);
assert(
  /const recoveredRunFollowups = recoveredRunId[\s\S]{0,220}deriveCrossSurfaceFollowups\(\{[\s\S]{0,180}contextRun:\s*\{ kind: 'run', id: recoveredRunId \}/.test(pendingRecovery)
    && /crossSurfaceFollowups:\s*recoveredRunFollowups\.length > 0/.test(pendingRecovery),
  'pending-message recovery restores the exact Office run action',
);
assert(
  !/recoveredRunId\s*=.*(?:providerRunId|sessionId)/.test(pendingRecovery),
  'pending-message recovery never promotes external provider or session identity to a local run id',
);

const acceptedRunAttacher = section(
  chatSource,
  'const attachAcceptedHandoffRun = useCallback',
  'const dispatchAssignedAgentTask = useCallback',
  'Chat accepted-run adopter',
);
assert(
  /if \(candidate\.status !== 'accepted' \|\| candidate\.runId \|\| !currentUserId\) return candidate;/.test(acceptedRunAttacher),
  'Chat records only unlinked accepted handoffs',
);
assert(
  /const run = await recordConnectedAgentAcceptedRun\(\{[\s\S]{0,300}threadId:\s*activeThreadId,[\s\S]{0,180}receipt:\s*candidate/.test(acceptedRunAttacher),
  'Chat sends accepted receipts through the one canonical run recorder',
);
assert(
  /if \(!run\) \{[\s\S]{0,300}runId:\s*null,[\s\S]{0,300}Completion remains unverified/.test(acceptedRunAttacher),
  'tracking failure stays nonterminal and never manufactures a run id',
);
assert(
  /return buildConnectedAgentHandoffReceipt\(\{[\s\S]{0,180}\.\.\.candidate,[\s\S]{0,180}runId:\s*run\.id/.test(acceptedRunAttacher),
  'only the canonical agent_runs id is adopted into the receipt',
);
assert(
  !/(?:sessionId|providerRunId|threadId)\s*(?:\|\||\?\?)\s*candidate\.runId/.test(acceptedRunAttacher + coreSource),
  'session, provider, and thread lineage can never substitute for local run identity',
);

const acceptedRunRecorder = section(
  runSystemSource,
  'export async function recordConnectedAgentAcceptedRun',
  '// ── 2. Update Run Status',
  'accepted-handoff run recorder',
);
assert(
  /const projection = buildConnectedAgentAcceptedRunProjection\(\{[\s\S]{0,180}receipt:\s*opts\.receipt,[\s\S]{0,180}task:\s*opts\.task,[\s\S]{0,180}threadId:\s*opts\.threadId/.test(acceptedRunRecorder),
  'run recorder admits only the pure accepted-run projection',
);
assert(
  /return createRun\(\{[\s\S]{0,600}surface:\s*projection\.surface,[\s\S]{0,600}delegatedTo:\s*projection\.delegatedTo/.test(acceptedRunRecorder),
  'accepted projection enters the existing canonical run store',
);
assert(
  /agentId:\s*subjectPayload\.subject\?\.agentSubjectKey/.test(acceptedRunRecorder)
    && /\.\.\.subjectPayload\.runMetadata/.test(acceptedRunRecorder),
  'accepted run retains canonical agent-subject attribution',
);
assert(
  !/chatSessionId\s*:/.test(acceptedRunRecorder),
  'circle thread identity is never written as legacy chat_session_id',
);
assert(
  !/(?:heartbeat|startedAt|started_at)\s*:/.test(acceptedRunRecorder),
  'accepted handoff does not fabricate runtime activity or a heartbeat',
);
assert(
  /status:\s*'queued'/.test(section(runSystemSource, 'export async function createRun', '/**\n * Record a bridge/session acceptance', 'canonical createRun')),
  'canonical createRun leaves an accepted external handoff queued',
);

if (failures > 0) {
  console.error(`\n${failures} failure(s) across ${assertions} assertions.`);
  process.exit(1);
}

console.log(`\nAll ${assertions} connected-agent Chat handoff wiring assertions passed.`);
