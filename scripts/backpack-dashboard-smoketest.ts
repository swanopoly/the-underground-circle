/**
 * Source-level coverage for the owner-only Backpack dashboard.
 *
 * The screen imports React Native and large dashboard panels, so this smoke
 * validates the pure inventory plus the UI routing contract without loading
 * the app bundle in Node.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BACKPACK_COMPARTMENTS,
  BACKPACK_COMPARTMENT_KEYS,
  type BackpackCompartmentKey,
} from '../src/lib/backpackCompartments';
import { getAllCompartmentStats } from '../src/components/backpack3d/compartmentActivity';

const backpackSource = readFileSync('src/screens/circles/tabs/BackpackTab.tsx', 'utf8');
const backpack2dSource = readFileSync(
  'src/components/backpack2d/InteractiveBackpack2D.tsx',
  'utf8',
);
const backpackDataSource = readFileSync('src/hooks/useBackpackData.ts', 'utf8');
const costSource = readFileSync('src/components/CostDashboard.tsx', 'utf8');
const deviceSource = readFileSync('src/components/DevicePanel.tsx', 'utf8');
const deviceManagerSource = readFileSync('src/lib/deviceManager.ts', 'utf8');
const claudeBridgeSource = readFileSync('scripts/claude-bridge.js', 'utf8');
const modelLabSource = readFileSync('src/components/ModelLabPanel.tsx', 'utf8');
const llmBenchSource = readFileSync('src/components/LLMBenchmarkPanel.tsx', 'utf8');
const farmSource = readFileSync('src/components/FarmHealthDashboard.tsx', 'utf8');
const performanceSource = readFileSync('src/components/AgentPerformanceMetrics.tsx', 'utf8');
const analyticsSource = readFileSync('src/components/OfficeAnalyticsPanel.tsx', 'utf8');
const traceSource = readFileSync('src/components/TraceViewer.tsx', 'utf8');
const memorySource = readFileSync('src/components/SharedMemoryPanel.tsx', 'utf8');
const tradingSource = readFileSync('src/components/TradingBotPanel.tsx', 'utf8');
const terminalSource = readFileSync('src/components/OfficeTerminal.tsx', 'utf8');
const terminalLibSource = readFileSync('src/lib/officeTerminal.ts', 'utf8');

const EXPECTED_KEYS = [
  'analytics',
  'canvas',
  'cost',
  'devices',
  'farm',
  'knowledge',
  'llm-bench',
  'model-lab',
  'performance',
  'projects',
  'prompts',
  'terminal',
  'traces',
  'trading',
] as const satisfies readonly BackpackCompartmentKey[];

assert.equal(BACKPACK_COMPARTMENTS.length, 14, 'Backpack should expose fourteen real workspaces');
assert.deepEqual(
  [...BACKPACK_COMPARTMENT_KEYS].sort(),
  EXPECTED_KEYS,
  'the canonical Backpack inventory must include every supported dashboard exactly once',
);
assert.equal(
  new Set(BACKPACK_COMPARTMENT_KEYS).size,
  BACKPACK_COMPARTMENT_KEYS.length,
  'Backpack compartment keys must be unique',
);
for (const key of EXPECTED_KEYS) {
  assert.equal(
    BACKPACK_COMPARTMENTS.filter(compartment => compartment.key === key).length,
    1,
    `${key} must appear exactly once in the canonical Backpack inventory`,
  );
}

const knowledge = BACKPACK_COMPARTMENTS.find(item => item.key === 'knowledge');
assert.equal(knowledge?.label, 'Knowledge System', 'Knowledge System must be a normal Backpack item');
assert.equal(knowledge?.zone, 'lid', 'Knowledge System should remain the featured top compartment');

for (const compartment of BACKPACK_COMPARTMENTS) {
  assert.ok(compartment.label.trim(), `${compartment.key} needs a visible label`);
  assert.ok(compartment.shortLabel.trim(), `${compartment.key} needs a compact label`);
  assert.ok(compartment.description.trim(), `${compartment.key} needs an accessibility hint`);
  assert.match(compartment.color, /^#[0-9a-f]{6}$/i, `${compartment.key} needs a six-digit accent color`);
}

const renderedKeys = Array.from(
  backpackSource.matchAll(/activeCompartment === '([^']+)'/g),
  match => match[1],
);
assert.deepEqual(
  [...renderedKeys].sort(),
  EXPECTED_KEYS,
  'every Backpack item must have exactly one focused route branch and no panel may be orphaned',
);
for (const key of EXPECTED_KEYS) {
  assert.equal(
    renderedKeys.filter(renderedKey => renderedKey === key).length,
    1,
    `${key} must have one and only one focused route branch`,
  );
}

const panelContracts = {
  analytics: ['OfficeAnalyticsPanel'],
  canvas: ['PixelOfficeCanvas'],
  cost: ['CostDashboard'],
  devices: ['DevicePanel'],
  farm: ['FarmHealthDashboard'],
  knowledge: ['SecondBrainDashboard'],
  'llm-bench': ['LLMBenchmarkPanel'],
  'model-lab': ['ModelLabPanel'],
  performance: ['AgentPerformanceMetrics'],
  projects: ['SharedMemoryPanel', 'ProjectRoomsPanel', 'SessionTagsDashboard'],
  prompts: ['PromptManagerPanel'],
  terminal: ['OfficeTerminal'],
  traces: ['TraceViewer'],
  trading: ['TradingBotPanel'],
} as const satisfies Record<BackpackCompartmentKey, readonly string[]>;

assert.equal(
  Object.keys(panelContracts).length,
  EXPECTED_KEYS.length,
  'all fourteen destinations must have an explicit panel contract',
);

const panelComponentNames = [...new Set(Object.values(panelContracts).flat())];
assert.equal(
  panelComponentNames.length,
  16,
  'the fourteen destinations should defer their sixteen panel components, including the Projects trio',
);
for (const componentName of panelComponentNames) {
  assert.match(
    backpackSource,
    new RegExp(`const ${componentName} = lazy\\(\\(\\) => import\\(`),
    `${componentName} must be lazy-loaded instead of entering the overview bundle`,
  );
  assert.doesNotMatch(
    backpackSource,
    new RegExp(`import ${componentName} from`),
    `${componentName} must not also have an eager default import`,
  );
}

for (const [key, componentNames] of Object.entries(panelContracts)) {
  const branchStart = backpackSource.indexOf(`activeCompartment === '${key}'`);
  assert.notEqual(branchStart, -1, `${key} must have a focused render branch`);
  const nextBranch = backpackSource.indexOf("activeCompartment === '", branchStart + 1);
  const branch = backpackSource.slice(branchStart, nextBranch === -1 ? undefined : nextBranch);
  for (const componentName of componentNames) {
    assert.match(branch, new RegExp(`<${componentName}\\b`), `${key} must render ${componentName}`);
  }
}

const boundaryStart = backpackSource.indexOf('<CompartmentErrorBoundary ');
const boundaryEnd = backpackSource.indexOf('</CompartmentErrorBoundary>', boundaryStart);
assert.notEqual(boundaryStart, -1, 'focused destinations must have a shared error boundary');
assert.notEqual(boundaryEnd, -1, 'the shared destination error boundary must close');
const sharedDestinationBoundary = backpackSource.slice(boundaryStart, boundaryEnd);
assert.equal(
  (sharedDestinationBoundary.match(/<Suspense\b/g) || []).length,
  1,
  'all focused destinations must share one Suspense boundary',
);
assert.equal(
  (sharedDestinationBoundary.match(/<\/Suspense>/g) || []).length,
  1,
  'the shared destination Suspense boundary must close inside the error boundary',
);
for (const componentName of panelComponentNames) {
  assert.match(
    sharedDestinationBoundary,
    new RegExp(`<${componentName}\\b`),
    `${componentName} must render inside the shared Suspense and error boundary`,
  );
}

assert.equal(
  (backpackSource.match(/<SecondBrainDashboard\b/g) || []).length,
  1,
  'Knowledge must render only in its focused compartment, not inline on the overview',
);
assert.match(
  backpackSource,
  /activeCompartment === 'knowledge'[\s\S]*?<ScrollView[\s\S]*?<SecondBrainDashboard/,
  'the focused Knowledge System must remain vertically scrollable',
);
assert.match(
  backpackSource,
  /const SecondBrainDashboard = lazy\(\(\) => import\('\.\.\/\.\.\/\.\.\/components\/SecondBrainDashboard'\)\)/,
  'the large Knowledge dashboard should remain lazy-loaded',
);
assert.match(
  backpackSource,
  /onOpenCompartment=\{handleNestedCompartmentOpen\}/,
  'Knowledge must preserve its guarded route into the Command Center',
);
assert.match(
  backpackSource,
  /data\.error && !data\.lastRefreshed[\s\S]*?<BackpackLoadFailure/,
  'a failed first load must render a visible retry state',
);
assert.match(
  backpackSource,
  /data\.error && data\.lastRefreshed[\s\S]*?styles\.staleBanner[\s\S]*?accessibilityRole="alert"/,
  'a failed refresh must keep the previous snapshot and identify it as stale',
);
assert.match(
  backpackSource,
  /accessibilityState=\{\{ busy: data\.refreshing, disabled: data\.refreshing \}\}/,
  'refresh must expose its busy and disabled state',
);
assert.match(
  backpackSource,
  /testID="backpack-open-office-terminal"[\s\S]*?onPress=\{onOpenOffice\}/,
  'the Backpack terminal must route mutations to the Office authority surface',
);
assert.match(
  backpackSource,
  /<OfficeTerminal[\s\S]*?\breadOnly[\s\S]*?readOnlyReason="Backpack shows recorded history only\./,
  'the Backpack terminal must mount as explicit read-only history',
);
assert.match(
  terminalSource,
  /readOnly \? \([\s\S]*?RECORDED HISTORY[\s\S]*?: \([\s\S]*?styles\.termTabBar/,
  'read-only terminal history must replace the mutable tool tabs',
);
assert.match(
  terminalSource,
  /\{!readOnly && \([\s\S]*?\/\* Autocomplete \*\/[\s\S]*?styles\.controlPanel[\s\S]*?office-terminal-command-input/,
  'read-only terminal history must remove targeting and command input controls',
);
assert.match(
  terminalSource,
  /const generation = \+\+transcriptGenerationRef\.current;[\s\S]*?transcriptCircleRef\.current === requestedCircleId[\s\S]*?if \(historyError\) throw new Error\(historyError\)/,
  'terminal history must fence prior-circle loads and surface structured history failures',
);
assert.match(
  terminalSource,
  /History unavailable[\s\S]*?Retry loading recorded command history[\s\S]*?void reloadTranscript\(\)/,
  'terminal history failures must provide an accessible retry instead of a false empty state',
);
assert.match(
  terminalLibSource,
  /if \(error\) \{\s*throw new Error\(error\.message \|\| 'Terminal responses could not be loaded\.'\)/,
  'terminal response read failures must propagate to the visible transcript error state',
);
assert.match(
  backpackSource,
  /summaryMetricRefs\.current\[origin\.id\]\?\.focus\?\.\(\)/,
  'summary metrics must regain focus after their focused dashboard closes',
);
assert.match(
  backpackSource,
  /const healthPct = data\.enrichedAgents\.length > 0[\s\S]*?: null;/,
  'an empty agent read must produce unknown health instead of a perfect score',
);
assert.match(
  backpackSource,
  /value: healthPct == null \? '—' : `\$\{healthPct\}%`[\s\S]*?'No verified agent data'/,
  'the empty health summary must disclose that no verified agent data exists',
);

assert.match(
  backpackSource,
  /<CostDashboard[\s\S]*?costAuthority="estimated"/,
  'Backpack must identify its token-derived cost totals as estimates',
);
assert.match(
  costSource,
  /costAuthority === 'estimated'[\s\S]*?ESTIMATED COST VIEW[\s\S]*?not as provider billing receipts/,
  'the Cost dashboard must visibly distinguish estimates from provider billing receipts',
);
assert.match(
  backpackDataSource,
  /loadOfficeUserPreferences\(normalizedCircleId, exactScope\)[\s\S]*?normalizeBudgetConfig\(budgetResult\.preferences\?\.budgetConfig\)/,
  'Backpack budget configuration must come from the canonical exact-user-and-circle Office preferences',
);
assert.doesNotMatch(
  backpackDataSource,
  /loadBudgetConfig\(/,
  'Backpack must not read the retired device-local budget path that has no matching writer',
);
assert.match(
  backpackSource,
  /data\.budgetConfigNotice[\s\S]*?Budget alerts unavailable/,
  'a canonical budget preference failure must be visible instead of looking like disabled alerts',
);

for (const receiptContract of [
  /const result = await printText[\s\S]{0,500}?if \(!result\.ok\)/,
  /const result = await sendGCode[\s\S]{0,500}?if \(!result\.ok\)/,
  /const result = await sendToSerial[\s\S]{0,500}?if \(!result\.ok\)/,
]) {
  assert.match(
    deviceSource,
    receiptContract,
    'Device mutations must check the bridge receipt before reporting success',
  );
}
assert.match(
  deviceSource,
  /gcodeTarget === 'serial' && !selectedSerialPort[\s\S]*?Choose an exact serial port/,
  'serial G-code must require an exact selected port before review',
);
assert.match(
  deviceSource,
  /const serviceMatches = printers3D\.filter[\s\S]*?serviceMatches\.length !== 1/,
  'network G-code must require exactly one detected service target',
);
assert.match(
  deviceSource,
  /accessibilityLabel="Review G-code command"[\s\S]*?onPress=\{requestSendGCode\}[\s\S]*?>\s*REVIEW/,
  'the first G-code action must stage a review instead of mutating hardware',
);
assert.match(
  deviceSource,
  /CONFIRM HARDWARE ACTION[\s\S]*?Target: \{pendingGCode\.port[\s\S]*?onPress=\{confirmSendGCode\}[\s\S]*?RUN COMMAND/,
  'G-code execution must show the exact target and require a separate confirmation',
);
assert.match(
  deviceSource,
  /localhost:7778/,
  'offline recovery copy must point to the authenticated local bridge on port 7778',
);
assert.match(
  deviceSource,
  /serviceUrl: matchedService\?\.url[\s\S]*?serviceUrl: pendingGCode\.serviceUrl[\s\S]*?pendingGCode\.port \|\| pendingGCode\.serviceUrl/,
  'network G-code review and dispatch must carry the exact detected service URL',
);
assert.match(
  claudeBridgeSource,
  /if \(expectedServiceUrl && serviceUrl !== expectedServiceUrl\)[\s\S]*?does not match the bridge-detected target/,
  'the authenticated bridge must reject a network G-code target that does not match discovery',
);
assert.match(
  deviceSource,
  /!printerResult\.ok \? `3D printer discovery[\s\S]*?!networkResult\.ok \? `network discovery[\s\S]*?Retry the scan for a complete result/,
  'partial device discovery failures must remain visible instead of reporting a complete empty scan',
);
assert.match(
  deviceManagerSource,
  /case 'gcode': \{\s*return 'G-code requires an exact detected target and a separate hardware confirmation\./,
  'the local terminal shortcut must not bypass the Devices hardware confirmation',
);

for (const [source, testId, disclosure] of [
  [modelLabSource, 'model-lab-reference-notice', 'REFERENCE WORKSPACE'],
  [llmBenchSource, 'llm-benchmark-reference-notice', 'REFERENCE SNAPSHOT'],
  [farmSource, 'farm-health-estimate-notice', 'DIRECTIONAL ESTIMATES'],
  [performanceSource, 'agent-performance-estimate-notice', 'DIRECTIONAL ESTIMATES'],
] as const) {
  assert.match(source, new RegExp(`testID="${testId}"`), `${testId} must remain a stable truth notice`);
  assert.match(source, new RegExp(disclosure), `${testId} must visibly disclose its data authority`);
}

assert.match(
  analyticsSource,
  /const ANALYTICS_PAGE_SIZE = 500;[\s\S]*?\.order\('created_at', \{ ascending: true \}\)[\s\S]*?\.order\('id', \{ ascending: true \}\)[\s\S]*?\.range\(offset, offset \+ ANALYTICS_PAGE_SIZE - 1\)/,
  'Office Analytics must page deterministic seven-day reads past the PostgREST row cap',
);
assert.match(
  analyticsSource,
  /const windowEnd = new Date\(snapshotTime\)\.toISOString\(\);[\s\S]*?loadAllResponseRows\(circleId, windowStart, windowEnd\)[\s\S]*?loadAllMessageRows\(circleId, windowStart, windowEnd\)/,
  'Office Analytics must bind every atomic snapshot read to one fixed time window',
);
assert.match(
  analyticsSource,
  /chunkValues\(messageIds, ANALYTICS_FILTER_CHUNK_SIZE\)[\s\S]*?\.in\('message_id', messageIdChunk\)[\s\S]*?\.range\(offset, offset \+ ANALYTICS_PAGE_SIZE - 1\)/,
  'Office Analytics must chunk and paginate large message-response lookups',
);

assert.match(
  traceSource,
  /if \(responsesError\) throw responsesError;[\s\S]*?if \(messagesError\) throw messagesError;[\s\S]*?if \(profilesError\) throw profilesError;/,
  'Traces must surface response, message, and profile read failures',
);
assert.match(
  traceSource,
  /loadGenerationRef\.current[\s\S]*?Traces unavailable[\s\S]*?Retry loading request traces/,
  'Traces must fence late reads and provide an accessible retry state',
);
assert.match(
  traceSource,
  /case 'streaming':[\s\S]*?label: 'STREAMING'[\s\S]*?case 'pending':[\s\S]*?label: 'PENDING'/,
  'Traces must preserve distinct streaming and pending states',
);

assert.match(
  memorySource,
  /getSession\(\)[\s\S]*?guardBaseContent: baseContent[\s\S]*?if \(!result\.ok\)/,
  'Shared Memory saves must capture auth, guard the base version, and check the write receipt',
);
assert.match(
  memorySource,
  /result\.status === 'conflict'[\s\S]*?action: result\.status === 'conflict' \? 'reload' : 'retry'[\s\S]*?finally \{[\s\S]*?setSaving\(false\)/,
  'Shared Memory must recover from conflict/failure and always release its saving state',
);
assert.match(
  memorySource,
  /setHistoryError\('Memory history could not be loaded\.'\)[\s\S]*?setLoadingHistory\(false\)/,
  'Shared Memory history must expose failures and release its loading state',
);

for (const tradingTab of ['portfolio', 'positions', 'history'] as const) {
  assert.match(
    tradingSource,
    new RegExp(`\\{ key: '${tradingTab}',`),
    `Trading must expose its ${tradingTab} workspace in the tab registry`,
  );
  assert.match(
    tradingSource,
    new RegExp(`tab === '${tradingTab}' && <[A-Z][A-Za-z]+Tab\\b`),
    `Trading must route the ${tradingTab} tab to its implemented panel`,
  );
}
assert.doesNotMatch(
  tradingSource,
  /dashboard_poll|setInterval\(|setTimeout\(/,
  'mounting or leaving the Trading dashboard open must never schedule financial mutations',
);
assert.equal(
  (tradingSource.match(/runTradingBotAutopilot\(/g) || []).length,
  1,
  'Trading autopilot must have one invocation path: the explicit Bot-tab action',
);
assert.match(
  tradingSource,
  /const handleRunAutopilot = async \(\) => \{[\s\S]*?triggerSource: 'bot_tab_manual'[\s\S]*?testID="trading-autopilot-run-once"/,
  'the sole autopilot invocation must remain in the handler behind the named manual action',
);
assert.match(
  tradingSource,
  /const requestedScope = `\$\{userId\}:\$\{circleId\}`;[\s\S]*?initGenerationRef\.current === generation[\s\S]*?currentScopeRef\.current === requestedScope/,
  'Trading initialization must fence late results to the exact user and circle',
);
assert.match(
  tradingSource,
  /trading_pending_actions'[\s\S]*?\.eq\('user_id', userId\)\.eq\('circle_id', circleId\)[\s\S]*?trading_positions'[\s\S]*?\.eq\('user_id', userId\)\.eq\('circle_id', circleId\)/,
  'Trading initialization badges must not mix pending actions or positions across circles',
);
assert.match(
  tradingSource,
  /function HistoryTab[\s\S]*?const requestedScope = `\$\{userId\}:\$\{circleId\}:\$\{modeFilter\}`;[\s\S]*?\.eq\('user_id', userId\)[\s\S]*?\.eq\('circle_id', circleId\)[\s\S]*?trading-history-error/,
  'History loads must be generation-fenced, circle-scoped, and visibly recoverable',
);
assert.match(
  tradingSource,
  /function PositionsTab[\s\S]*?const requestedScope = `\$\{userId\}:\$\{circleId\}:\$\{modeFilter\}`;[\s\S]*?\.eq\('user_id', userId\)[\s\S]*?\.eq\('circle_id', circleId\)[\s\S]*?trading-positions-error/,
  'Position loads must be generation-fenced, circle-scoped, and visibly recoverable',
);

assert.match(
  backpack2dSource,
  /BACKPACK_COMPARTMENTS\.filter\(compartment => compartment\.zone === zone\)/,
  'the 2D backpack must consume the canonical inventory',
);
for (const zoneList of [
  'LID_COMPARTMENTS',
  'MAIN_COMPARTMENTS',
  'FRONT_COMPARTMENTS',
  'LEFT_COMPARTMENTS',
  'RIGHT_COMPARTMENTS',
  'BASE_COMPARTMENTS',
]) {
  assert.match(
    backpack2dSource,
    new RegExp(`${zoneList}\\.map\\(item => renderPocket\\(item,`),
    `${zoneList} must render semantic pocket buttons`,
  );
}
assert.match(backpack2dSource, /accessibilityRole="button"/, 'every pocket needs button semantics');
assert.match(
  backpack2dSource,
  /accessibilityLabel=\{`Open \$\{item\.label\}`\}/,
  'every pocket needs an explicit accessible name',
);
assert.match(
  backpack2dSource,
  /accessibilityHint=\{item\.description\}/,
  'every pocket needs a useful accessibility hint',
);
assert.match(
  backpack2dSource,
  /testID=\{`backpack-compartment-\$\{item\.key\}`\}/,
  'every pocket needs a stable interaction target',
);
assert.match(
  backpack2dSource,
  /accessibilityValue=\{statusText \? \{ text: statusText \} : undefined\}/,
  'pocket status text must be available to assistive technology',
);
assert.match(backpack2dSource, /focused \? styles\.pocketFocused/, 'keyboard focus must be visible');
assert.match(
  backpack2dSource,
  /const responsiveWidth = measuredWidth \|\| windowWidth;[\s\S]*?const compact = responsiveWidth < 700;[\s\S]*?const tiny = responsiveWidth < 420;/,
  'responsive modes must follow the measured Backpack container, with a tiny-screen fallback',
);
assert.match(
  backpack2dSource,
  /onLayout=\{handleStageLayout\}/,
  'the Backpack must measure its own rendered container instead of relying only on the window',
);
for (const tinyStyle of [
  'stageTiny',
  'packBodyTiny',
  'mainGridPocketTiny',
  'frontGridPocketTiny',
  'sidePocketTiny',
]) {
  assert.match(
    backpack2dSource,
    new RegExp(`tiny[^\\n]*styles\\.${tinyStyle}`),
    `${tinyStyle} must participate in the narrowest responsive layout`,
  );
}

for (const decorativeLayer of [
  'stageHalo',
  'handleBack',
  'handleOuter',
  'floorShadow',
  'contactShadow',
  'bodyGusset',
  'packDepth',
  'canvasWeave',
  'lidDepth',
  'mainPocketDepth',
  'frontPocketDepth',
  'baseSleeveDepth',
  'sidePocketDepth',
]) {
  assert.match(
    backpack2dSource,
    new RegExp(`<View\\s+pointerEvents="none"\\s+style=\\{(?:\\[)?styles\\.${decorativeLayer}`),
    `${decorativeLayer} must remain a non-interactive static depth layer`,
  );
}
assert.match(
  backpack2dSource,
  /<Text accessibilityRole="header" style=\{styles\.title\}>/,
  'the Backpack selector must expose a navigable heading',
);
assert.match(
  backpack2dSource,
  /accessible=\{false\}[\s\S]*?styles\.activityDot/,
  'the visual activity dot must not duplicate the spoken pocket status',
);
assert.doesNotMatch(
  backpack2dSource,
  /from ['"][^'"]*(?:three|@react-three|spline|expo-gl|react-native-svg)|<Canvas\b|SplineBackpack/i,
  'the 2.5D Backpack hub must not depend on GPU, stale 3D, or SVG rendering paths',
);

const emptyBackpackData = {
  enrichedAgents: [],
  enrichedSessions: [],
  displayAgents: [],
  sessionTags: new Map(),
  mergedCircleAgents: [],
  budgetConfig: { enabled: false },
  periodCosts: { today: 0, week: 0, month: 0 },
  budgetAlerts: [],
  traceCount: 0,
  totalTokensToday: 0,
  totalMessagesToday: 0,
  featuredTradeCount: 0,
  recentActivity: [],
  lastRefreshed: '',
  currentUserId: '',
  currentUserName: '',
  loading: false,
  refreshing: false,
  error: null,
  agentCount: 0,
  sessionCount: 0,
  refresh: async () => undefined,
} as Parameters<typeof getAllCompartmentStats>[0];

const emptyStats = getAllCompartmentStats(emptyBackpackData);
assert.deepEqual(
  Object.keys(emptyStats).sort(),
  EXPECTED_KEYS,
  'every Backpack workspace must expose a status entry',
);
for (const key of EXPECTED_KEYS) {
  assert.ok(emptyStats[key].miniStat.trim(), `${key} must expose a non-empty status at rest`);
}
assert.equal(
  emptyStats.farm.miniStat,
  'No agent data',
  'an empty agent set must not be presented as 100% healthy',
);

console.log('Backpack dashboard smoke passed');
