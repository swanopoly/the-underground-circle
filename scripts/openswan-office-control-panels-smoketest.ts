/**
 * Source-level contract for the Office-side OpenSwan and agent control panels.
 *
 * These React Native modules pull in platform-specific dependencies, so the
 * smoke deliberately verifies their loading, auth, disclosure, and mutation
 * boundaries without pretending to be a live bridge or browser E2E.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeAgentPanelGeometry } from '../src/screens/circles/tabs/office/agentPanelLayoutCore';

let passes = 0;
let failures = 0;

function check(condition: unknown, message: string): void {
  if (condition) {
    passes += 1;
    console.log(`pass: ${message}`);
  } else {
    failures += 1;
    console.error(`FAIL: ${message}`);
  }
}

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

function section(text: string, start: string, end: string): string {
  const startIndex = text.indexOf(start);
  const endIndex = text.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex <= startIndex) return '';
  return text.slice(startIndex, endIndex);
}

const agentPanel = source('src/screens/circles/tabs/office/AgentPanel.tsx');
const panelShell = source('src/screens/circles/tabs/office/AgentPanelShell.tsx');
const gatewayPanels = source('src/screens/circles/tabs/office/AgentGatewayPanels.tsx');
const spiritPanel = source('src/screens/circles/tabs/office/AgentSpiritPanel.tsx');
const terminalPanels = source('src/screens/circles/tabs/office/AgentTerminalPanels.tsx');
const templatesPanel = source('src/screens/circles/tabs/office/AgentTemplates.tsx');
const customizePanel = source('src/screens/circles/tabs/office/CustomizePanel.tsx');
const overviewPanel = source('src/screens/circles/tabs/office/AgentOverviewPanel.tsx');
const officeTab = source('src/screens/circles/tabs/OfficeTab.tsx');
const panelLayout = source('src/screens/circles/tabs/office/useAgentPanelLayout.ts');
const whiteboard = source('src/screens/circles/tabs/office/Whiteboard.tsx');
const agentControlCard = source('src/components/AgentControlCard.tsx');
const bridgeHealthDiag = source('src/lib/bridgeHealthDiag.ts');

check(
  agentPanel.includes('identityAuthority?: AgentIdentityExactAuthority | null;')
    && agentPanel.includes('authorityCircleId !== circleId')
    && !agentPanel.includes('safeGetUser')
    && !agentPanel.includes('supabase.auth.getUser')
    && !agentPanel.includes('supabase.auth.getSession'),
  'the agent panel consumes the captured exact Office authority without mutable auth recovery',
);
check(
  agentPanel.includes("agent?.connectionId === 'db-agent' && isUuidLike(agent.sessionKey)")
    && !agentPanel.includes(".from('circle_office_agents')")
    && !agentPanel.includes('.upsert('),
  'opening a read-only agent panel derives exact published identity without a database write',
);
check(
  !agentPanel.includes('requestIdleCallback')
    && !agentPanel.includes('warmModules')
    && agentPanel.includes("if (!(panelTab === 'openswan' || panelTab === 'cron') || gatewayPanelsModule) return;")
    && agentPanel.includes("if (panelTab !== 'terminal' || terminalPanelsModule) return;")
    && agentPanel.includes("if (panelTab !== 'memory' || memoryPanelModule) return;"),
  'heavy control-panel chunks load only after their tab is selected',
);
check(
  panelShell.includes('React.useEffect(() => {\n    ensureOpenAnimStyle();')
    && !panelShell.includes("window.addEventListener('keydown'")
    && !panelShell.includes('ensureOpenAnimStyle();\n\n  const currentTabIndex'),
  'the panel shell performs no render-time DOM mutation and owns no duplicate Escape listener',
);
check(
  panelShell.includes("role: 'dialog'")
    && panelShell.includes("'aria-modal': panelMode === 'center' ? true : undefined")
    && panelShell.includes('accessibilityHint={tab.description}')
    && !panelShell.includes('{renderDesktopControls()}')
    && !panelShell.includes('<TabNavigationDots')
    && panelShell.includes("{panelTab === 'overview' ? renderRemoveButton(isDesktop) : null}"),
  'the shell keeps one accessible identity header and hides destructive controls outside Overview',
);
check(
  agentPanel.includes("const supportsDockedPanel = !!isDesktop && Platform.OS === 'web';")
    && agentPanel.includes("const effectivePanelMode = supportsDockedPanel ? panelMode : 'center';")
    && agentPanel.includes("ev.key === 'Tab' && effectivePanelMode === 'center'")
    && agentPanel.includes('returnFocusRef.current')
    && agentPanel.includes('findMatchingTriggers()')
    && agentPanel.includes('if (!agent) {\n      restoreAgentPanelFocus();')
    && agentPanel.includes('Replacing one\n  // docked agent with another is not a close')
    && agentPanel.includes('returnFocusGenerationRef.current !== restoreGeneration')
    && agentPanel.includes('liveTarget?.focus({ preventScroll: true })')
    && officeTab.includes('accessibilityLabel={`Open ${agent.name} agent panel`}')
    && officeTab.includes("Platform.OS === 'web' ? ({ tabIndex: 0 } as any)"),
  'only the centered pop-up traps focus and closing restores its invoking Office control',
);
check(
  panelShell.includes('zIndex: 100,')
    && panelLayout.includes('computeAgentPanelGeometry(effectivePanelMode, sideWidth, viewport)')
    && agentPanel.includes('useAgentPanelLayout(supportsDockedPanel)')
    && computeAgentPanelGeometry('center', 480, { w: 1180, h: 820 }).height === 558
    && computeAgentPanelGeometry('center', 480, { w: 3840, h: 2160 }).height === 720,
  'the centered panel stays compact and the mobile sheet owns its controls above sticky Office chrome',
);
check(
  agentControlCard.includes('parseBridgeHealth(catalogEntry, payload)')
    && agentControlCard.includes("parsed.status === 'offline'")
    && agentControlCard.includes("parsed.status === 'degraded'")
    && !agentControlCard.includes('Number(payload?.sessions || 0)')
    && bridgeHealthDiag.includes("detail: 'health endpoint returned an invalid session count'"),
  'the Overview bridge card accepts only the canonical ok=true health contract and never promotes malformed session counts',
);

const removePublishedAgent = section(
  officeTab,
  'const handleRemovePublishedAgent = useCallback(async (agent: OfficeAgent) => {',
  '// ─── Reversible floor editor helpers',
);
check(
  agentPanel.includes('showConfirm({')
    && removePublishedAgent.includes("agent?.connectionId === 'db-agent' && isUuidLike(agent.sessionKey)")
    && removePublishedAgent.includes(".eq('id', publishedAgentId)")
    && removePublishedAgent.includes('removedRows?.length === 1')
    && !removePublishedAgent.includes(".eq('name'"),
  'published-agent removal confirms intent and requires one exact owner-scoped UUID receipt',
);

const frontend = section(
  gatewayPanels,
  'export function OpenSwanFrontendPanel(',
  'export function CronJobsPanel(',
);
const refresh = section(frontend, 'const refresh = useCallback(async () => {', 'const runAction = useCallback(async (');
const advancedGuardIndex = refresh.indexOf('if (!advancedOpen) {');
const sessionListIndex = refresh.indexOf('const sessionsResult = await listSessions(config);');
const diagnosticLoadIndex = refresh.indexOf('const [subagentsResult, jobsResult, agentsResult, statusResult, historyResult]');

check(
  frontend.includes('const [advancedOpen, setAdvancedOpen] = useState(false);')
    && frontend.includes('const essentialSnapshotLoaded = useRef(false);')
    && frontend.includes('Drop it when the disclosure closes;')
    && frontend.includes("setAdvancedLaneState(buildAdvancedLaneState('idle'));")
    && frontend.includes('setPublishedOpenSwanAgents([]);')
    && frontend.includes('setSessionBindings({});'),
  'the Office OpenSwan runtime opens in the essential state',
);
check(
  refresh.includes('if (refreshInFlight.current) return;')
    && sessionListIndex >= 0
    && advancedGuardIndex > sessionListIndex
    && diagnosticLoadIndex > advancedGuardIndex,
  'the essential refresh is single-flight and loads exact sessions before any advanced diagnostics',
);
for (const call of [
  'listSubAgentsDetailed(config)',
  'listCronJobs(config)',
  'listAgents(config)',
  'getSessionStatus(config, active.sessionKey)',
  'getSessionHistory(config, active.sessionKey, 8)',
]) {
  check(refresh.indexOf(call) > advancedGuardIndex, `${call} stays behind Advanced options`);
}
check(
  frontend.indexOf('CONTINUE WITH THIS AGENT IN CHAT') >= 0
    && frontend.indexOf('CONTINUE WITH THIS AGENT IN CHAT') < frontend.indexOf('ADVANCED OPTIONS')
    && frontend.includes('Chat owns the durable message, approval, run, proof, and recovery trail.')
    && frontend.includes('onOpenInChat(taskInput.trim())')
    && !frontend.includes('sendSessionMessage(')
    && !frontend.includes('spawnSubAgent('),
  'the primary task path carries an exact-agent draft into canonical Chat without a second execution owner',
);
check(
  frontend.includes("accessibilityState={{ expanded: advancedOpen }}")
    && frontend.includes('{advancedOpen ? <>')
    && frontend.indexOf('OFFICE SESSION BINDING') > frontend.indexOf('{advancedOpen ? <>')
    && frontend.indexOf('SESSION COCKPIT') > frontend.indexOf('{advancedOpen ? <>')
    && frontend.indexOf('RUNTIME SEARCH') > frontend.indexOf('{advancedOpen ? <>'),
  'binding, evidence, search, delegation, and automation stay in one accessible advanced disclosure',
);
check(
  frontend.includes('{advancedOpen ? (\n        <View style={{ flexDirection: \'row\', flexWrap: \'wrap\', gap: 10, marginTop: 10 }}>')
    && frontend.includes('setActionNotice(result.summary.slice')
    && frontend.includes('{actionNotice ? <Text'),
  'unloaded diagnostic counters are hidden and completed panel actions leave a visible bounded receipt',
);
check(
  frontend.includes('!advancedOpen')
    && frontend.includes('!circleId')
    && frontend.includes('!userId')
    && frontend.includes('isBlackSwanRuntime')
    && frontend.includes('hasCurrentPanelAuthority(identityAuthority, isIdentityAuthorityCurrent)')
    && frontend.includes('loadPanelOpenSwanConfigExact(')
    && gatewayPanels.includes('loadOfficeConnectionsExact(identityAuthority, isIdentityAuthorityCurrent)')
    && gatewayPanels.includes('matchesOpenSwanConnectionFingerprint(runtimeConnectionSnapshot, storedConnection)')
    && gatewayPanels.includes("const liveExactConnection: AgentConnection = { ...storedConnection, status: 'connected' };")
    && frontend.includes('getUserCircleAgentsExact(circleId, capturedAuthority)')
    && frontend.includes('readOfficeAgentSessionBindingsBatch(')
    && frontend.includes('capturedAuthority,')
    && frontend.includes('const actionInFlight = useRef(false);')
    && frontend.includes('if (actionInFlight.current) return false;'),
  'private binding reads and provider mutations use captured exact authority and stay single-flight',
);
check(
  frontend.includes('const bindingRefreshGeneration = sessionRefreshGeneration.current;')
    && frontend.includes('const bindingFingerprint = loadedConnectionFingerprint;')
    && frontend.indexOf('const verifiedSessions = await listSessions(verifiedConfig);') < frontend.indexOf('const bindingResult = await setOfficeAgentSessionBinding(')
    && frontend.includes('bindingRefreshGeneration !== sessionRefreshGeneration.current')
    && frontend.includes('matchesOpenSwanConnectionFingerprint(bindingFingerprint, latestConfig.connection)')
    && frontend.includes('const currentBinding = sessionBindings[officeAgent.id] ?? null;')
    && frontend.includes('isAuthorityCurrent: isIdentityAuthorityCurrent')
    && frontend.includes('bindingResult.receipt.resultBinding'),
  'binding revalidates the runtime/session and commits only through the expected-row CAS receipt',
);
check(
  frontend.includes('const expectedBinding = sessionBindings[officeAgent.id];')
    && frontend.includes('const clearResult = await clearOfficeAgentSessionBinding(')
    && frontend.includes('expectedBinding,')
    && frontend.includes('clearResult.receipt.resultBinding !== null')
    && !frontend.includes('readOfficeAgentSessionBindingsBatch([officeAgent.id], capturedAuthority)'),
  'unbinding submits its exact displayed row to the database CAS and requires a missing postcondition receipt',
);
check(
  gatewayPanels.includes("type AdvancedLaneStatus = 'idle' | 'loading' | 'ready' | 'unsupported' | 'error'")
    && frontend.includes("advancedLaneState.jobs === 'unsupported'")
    && frontend.includes('Cron inventory could not be verified.')
    && frontend.includes('Subagent inventory could not be verified.')
    && frontend.includes('Runtime agent inventory could not be verified.')
    && frontend.includes('Session history could not be verified.'),
  'advanced runtime lanes distinguish verified empty, unsupported, and failed evidence',
);
check(
  frontend.includes('if (!result.ok) return { ok: false, error: \'Runtime memory search failed.')
    && frontend.includes('if (!result.ok) return { ok: false, error: \'Runtime web search failed.')
    && frontend.includes('result.commit?.();'),
  'runtime search failures cannot be painted as green successful results',
);
check(
  frontend.includes('accessibilityLabel="Task draft for Chat"')
    && frontend.includes('accessibilityLabel="Subagent task draft for Chat"')
    && frontend.includes('accessibilityLabel="Runtime memory search query"')
    && frontend.includes('accessibilityLabel="Runtime web search query"')
    && !frontend.includes('Connected-agent message draft for Chat')
    && !frontend.includes('DRAFT FOR CHAT'),
  'every distinct OpenSwan draft and search field is named, with no duplicate generic Chat composer',
);
check(
  frontend.includes('accessibilityLabel="Loading published Office agent bindings"')
    && frontend.includes('accessibilityLabel="Loading exact OpenSwan session"')
    && gatewayPanels.includes('accessibilityLabel="Loading connection cron jobs"')
    && frontend.includes('accessibilityRole="alert" accessibilityLiveRegion="assertive"')
    && gatewayPanels.includes('{error && <Text accessibilityRole="alert" accessibilityLiveRegion="assertive"')
    && frontend.includes('{bindingNotice}</Text>'),
  'runtime loading, error, action, and binding receipts are announced beside their exact controls',
);
check(
  frontend.includes('const bindingReadGeneration = useRef(0);')
    && frontend.includes('const readGeneration = ++bindingReadGeneration.current;')
    && frontend.includes('sessionGeneration === sessionRefreshGeneration.current')
    && frontend.includes('advancedOpenRef.current')
    && frontend.includes('if (!readIsCurrent()) return;'),
  'late published-agent and private-binding reads cannot repopulate a closed or refreshed Advanced disclosure',
);
check(
  frontend.includes('disabled={!memoryQuery.trim()}')
    && frontend.includes('disabled={!webQuery.trim()}')
    && frontend.includes('accessibilityState={{ disabled: actionDisabled, busy: actionState === loadingKey }}'),
  'runtime search actions expose disabled and busy state and cannot submit an empty query',
);
check(
  (frontend.match(/setMemoryResult\(''\);/g) || []).length >= 2
    && (frontend.match(/setMemoryResultQuery\(''\);/g) || []).length >= 3
    && (frontend.match(/setMemorySearchState\('idle'\);/g) || []).length >= 2
    && (frontend.match(/setWebResults\(\[\]\);/g) || []).length >= 2
    && (frontend.match(/setWebResultQuery\(''\);/g) || []).length >= 3
    && (frontend.match(/setWebSearchState\('idle'\);/g) || []).length >= 2
    && (frontend.match(/setActionNotice\(null\);/g) || []).length >= 2
    && (frontend.match(/setBindingNotice\(null\);/g) || []).length >= 2,
  'refreshing or closing Advanced retires private search evidence and prior action receipts before a new exact runtime snapshot',
);
check(
  frontend.includes('const capturedConnectionFingerprint = loadedConnectionFingerprint;')
    && frontend.includes('const actionId = ++actionSequence.current;')
    && frontend.includes('activeActionId.current === actionId')
    && frontend.includes('const latestConfig = await resolveConfig();')
    && frontend.includes('matchesOpenSwanConnectionFingerprint(capturedConnectionFingerprint, latestConfig.connection)')
    && frontend.includes("if (invocationIsCurrent()) {\n        setActionNotice(null);")
    && frontend.includes('hasCurrentPanelAuthority(searchAuthority, isIdentityAuthorityCurrent)'),
  'late runtime search success and failure are fenced by action ownership, authority, refresh generation, disclosure state, and exact connection fingerprint',
);
check(
  frontend.includes("setMemorySearchState('loading')")
    && frontend.includes("setMemorySearchState(ok ? 'ready' : 'error')")
    && frontend.includes('setMemoryResultQuery(query);')
    && frontend.includes('Runtime memory search failed. Check the connection and retry.')
    && frontend.includes("setWebSearchState('loading')")
    && frontend.includes("setWebSearchState(ok ? 'ready' : 'error')")
    && frontend.includes('setWebResultQuery(query);')
    && frontend.includes('RESULTS FOR “{memoryResultQuery}”')
    && frontend.includes('RESULTS FOR “{webResultQuery}”')
    && frontend.includes('No verified web results were returned.')
    && !frontend.includes('await refresh();'),
  'each runtime search renders local loading, error, and verified-empty evidence without erasing its read result in a mutation refresh',
);
check(
  frontend.includes('MANAGE IN CRON JOBS')
    && !frontend.includes('runAction(`Run ${job.id}`'),
  'the runtime summary does not duplicate the Cron panel mutation control',
);

const cronStart = gatewayPanels.indexOf('export function CronJobsPanel(');
const cron = cronStart >= 0 ? gatewayPanels.slice(cronStart) : '';
check(
  cron.includes('const actionInFlight = useRef(false);')
    && cron.includes('if (actionInFlight.current) return;')
    && cron.includes('} finally {\n      actionInFlight.current = false;\n      setActionLoading(null);'),
  'Cron create and mutation paths cannot double-submit or strand the busy state',
);
check(
  cron.includes('Run cron job "${niceName}" now?')
    && cron.includes('Create scheduled job "${createPayload.name}" with schedule')
    && cron.includes('name: newJob.name.trim()')
    && cron.includes('schedule: newJob.schedule.trim()')
    && cron.includes('task: newJob.task.trim()')
    && cron.includes('const result = await createCronJob(config, createPayload);'),
  'both immediate execution and schedule creation require an explicit confirmation',
);

for (const [name, text] of [
  ['Spirit', spiritPanel],
  ['Terminal', terminalPanels],
  ['Templates', templatesPanel],
  ['Customize', customizePanel],
] as const) {
  check(
    !text.includes('supabase.auth.getUser') && !text.includes('supabase.auth.getSession'),
    `${name} panel has no raw auth lookup that can hang during session refresh`,
  );
}
check(
  spiritPanel.includes("if (publishedDbAgentId) {")
    && spiritPanel.includes(".eq('id', publishedDbAgentId)")
    && spiritPanel.includes(".eq('owner_id', authority.userId)")
    && spiritPanel.includes('getSupabaseClientForAccessToken(authority.accessToken)')
    && !spiritPanel.includes('.setHeader(')
    && !spiritPanel.includes('useEffect(() => {\n    ensureDbAgent();'),
  'Spirit resolves published agents by exact owner-scoped UUID through pinned authority and never auto-creates one on mount',
);
check(
  templatesPanel.includes('if (error) throw error;')
    && templatesPanel.includes('setDeployError(')
    && templatesPanel.includes('{deployError}'),
  'template deployment reports persistence failure instead of showing false success',
);
check(
  overviewPanel.includes('setInterval(tick, 120_000)')
    && !overviewPanel.includes('setInterval(tick, 30000)'),
  'Overview memory freshness uses a minute-scale poll instead of hammering the default tab',
);
check(
  overviewPanel.includes('const [detailsOpen, setDetailsOpen] = useState(false);')
    && overviewPanel.includes('detailsOpen ? exactIdentityAuthority : null')
    && overviewPanel.includes('accessibilityState={{ expanded: detailsOpen }}'),
  'Overview defaults to essentials and defers identity and memory detail reads until disclosure',
);
check(
  overviewPanel.includes("const canRunDiagnostics = agent.providerType === 'claude-code' && !!onRunCommand;")
    && overviewPanel.includes('Claude bridge read-only diagnostic allowlist')
    && !overviewPanel.includes('COMPUTER_USE_TTL_MS')
    && !overviewPanel.includes('execBridgeCommand')
    && !overviewPanel.includes("action: 'task_queued'")
    && !overviewPanel.includes('SEND TASK'),
  'Overview exposes the diagnostic allowlist truthfully and never pretends an activity row or raw shell toggle is a task handoff',
);
check(
  agentControlCard.includes('compact, read-only runtime connection summary')
    && agentControlCard.includes("provider === 'openswan'")
    && agentControlCard.includes('getLocalOpenSwanDiscoveryEndpoints()[0]')
    && agentControlCard.includes('hasExactRuntimeConnection')
    && agentControlCard.includes('Connected through this agent’s exact Office runtime connection.')
    && agentControlCard.includes('requestGenerationRef.current')
    && agentControlCard.includes('requestAbortRef.current?.abort()')
    && agentControlCard.includes('const timeoutId = setTimeout(() => controller.abort(), 5_000)')
    && !agentControlCard.includes('supabase.auth.getUser')
    && !agentControlCard.includes('safeGetUser')
    && !agentControlCard.includes('fetch(`http://localhost:${port}/health`')
    && !agentControlCard.includes('setInterval(checkBridge'),
  'the read-only summary consumes an exact Office runtime snapshot or uses one bounded provider-level probe',
);
check(
  agentControlCard.includes('agent: OfficeAgent;')
    && agentControlCard.includes('runtimeConnectionId?: string | null;')
    && agentControlCard.includes('Provider-level check only. This does not verify the selected agent’s exact runtime session.')
    && !agentControlCard.includes('onDelete')
    && !agentControlCard.includes('onRunCommand')
    && !agentControlCard.includes(".from('circle_office_agents')")
    && !agentControlCard.includes('.delete()')
    && !agentControlCard.includes('.update('),
  'the Overview bridge summary has one narrow read-only contract and owns no duplicate agent mutations',
);
check(
  agentPanel.includes('runtimeConnectionId={runtimeConnectionId}')
    && overviewPanel.includes('runtimeConnectionId?: string | null;')
    && overviewPanel.includes('key={`${agent.id}:${runtimeConnectionId || \'provider\'}`}')
    && overviewPanel.includes('runtimeConnectionId={runtimeConnectionId}'),
  'exact runtime identity reaches a freshly keyed Overview bridge summary without stale provider state',
);
check(
  agentControlCard.includes('accessibilityLabel="Refresh provider bridge status"')
    && agentControlCard.includes("accessibilityRole=\"alert\"")
    && agentControlCard.includes('Run npm run start, then confirm the OpenSwan proxy on port 18790 is healthy.')
    && !agentControlCard.includes('MARK OFFLINE')
    && !agentControlCard.includes('START BRIDGE'),
  'the bridge summary exposes a truthful refresh action and visible provider-specific recovery guidance',
);

const bridgeReadinessEffect = section(
  whiteboard,
  'const refreshBridgeReadiness = useCallback(async () => {',
  '// Running tasks',
);
check(
  bridgeReadinessEffect.includes('collapsed strip already has Office connection counts')
    && bridgeReadinessEffect.includes('if (!expanded) {')
    && bridgeReadinessEffect.includes('const timer = setInterval(run, 45_000);')
    && !bridgeReadinessEffect.includes('120_000'),
  'the collapsed Office board performs no deep bridge readiness polling',
);

console.log(`\nOpenSwan Office control panels smoke: ${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
