/**
 * Source-level UX contract for the web OpenSwan Control Panel.
 *
 * React Native's module graph is not safe to import in the Node smoke runner,
 * so this pins the presentation hierarchy and the existing Chat dispatch seam.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let passes = 0;
let failures = 0;

function assert(condition: unknown, message: string): void {
  if (condition) {
    passes += 1;
    console.log(`pass: ${message}`);
  } else {
    failures += 1;
    console.error(`FAIL: ${message}`);
  }
}

function section(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex <= startIndex) return '';
  return source.slice(startIndex, endIndex);
}

const repoRoot = process.cwd();
const consoleSource = readFileSync(
  join(repoRoot, 'src/components/openswan/OpenSwanConsole.tsx'),
  'utf8',
);
const stylesSource = readFileSync(
  join(repoRoot, 'src/components/openswan/openswanConsoleStyles.ts'),
  'utf8',
);
const chatSource = readFileSync(
  join(repoRoot, 'src/screens/circles/tabs/ChatTab.tsx'),
  'utf8',
);

const visiblePanel = section(
  consoleSource,
  'return (\n    <View',
  'function LaunchReadinessPanel(',
);
const readinessPanel = section(
  consoleSource,
  'function LaunchReadinessPanel(',
  '// ── Group divider',
);
const chatConsole = section(
  chatSource,
  '<OpenSwanConsole',
  "{Platform.OS === 'web' && agentMonitorTask",
);

assert(
  consoleSource.includes("const DEFAULT_OPEN_SECTIONS: ControlPanelOpenState = { taskMode: true };")
    && consoleSource.includes('const [advancedOpen, setAdvancedOpen] = useState(false);')
    && consoleSource.includes('const [modeOptionsOpen, setModeOptionsOpen] = useState(false);'),
  'the panel opens with only the task section expanded and both disclosure layers closed',
);
assert(
  consoleSource.includes('setAdvancedOpen(false);')
    && consoleSource.includes('setModeOptionsOpen(false);'),
  'reopening the panel always returns to the clean essential view',
);

const taskIndex = visiblePanel.indexOf('title="Task"');
const advancedToggleIndex = visiblePanel.indexOf('<Text style={styles.advancedDisclosureTitle}>Advanced options</Text>');
const advancedGroupIndex = visiblePanel.indexOf('<GroupHeader label="ADVANCED OPTIONS"');
assert(
  taskIndex >= 0 && advancedToggleIndex > taskIndex && advancedGroupIndex > advancedToggleIndex,
  'task entry stays ahead of the advanced disclosure and all optional controls',
);
assert(
  visiblePanel.includes('WHAT SHOULD OPENSWAN DO?')
    && visiblePanel.includes('OpenSwan will route each action to the right tool.'),
  'the essential view asks for the outcome in plain language',
);
assert(
  consoleSource.includes('getAgentSubjectSummary(agentSubjectMetadata)')
    && visiblePanel.includes("{selectedAgentSummary?.label || 'OpenSwan'}")
    && visiblePanel.includes("{selectedAgentSummary ? 'selected in Chat' : 'default chat runtime'}"),
  'the compact composer shows the exact Chat-selected agent without inventing a second roster',
);
assert(
  visiblePanel.includes('WORK TYPE')
    && visiblePanel.includes('`Auto · ${selectedIntentMeta.label}`')
    && visiblePanel.includes("'detected from your task'")
    && visiblePanel.includes('APPROVALS')
    && visiblePanel.includes('{guardrailWatchOption.label}'),
  'essential context keeps automatic route and approval posture visible',
);
assert(
  consoleSource.includes('const inferredIntentMeta = useMemo(')
    && consoleSource.includes('shouldRequireLiveCapabilityPreflight(selectedIntentMeta, mode)')
    && consoleSource.includes('setMode((current) => current === inferredIntentMeta.mode ? current : inferredIntentMeta.mode);')
    && visiblePanel.includes('accessibilityLabel="Use automatic OpenSwan workflow routing"'),
  'typed tasks continuously infer workflow and mode while preserving an explicit Auto route control',
);
assert(
  visiblePanel.includes("accessibilityLabel={modeOptionsOpen ? 'Hide OpenSwan mode choices' : 'Change OpenSwan mode'}")
    && visiblePanel.includes('accessibilityState={{ expanded: modeOptionsOpen }}')
    && visiblePanel.includes('{modeOptionsOpen ? ('),
  'the full mode list is hidden behind one accessible compact selector',
);
assert(
  visiblePanel.includes("accessibilityLabel={advancedOpen ? 'Hide OpenSwan advanced options' : 'Show OpenSwan advanced options'}")
    && visiblePanel.includes('accessibilityState={{ expanded: advancedOpen }}')
    && visiblePanel.includes('{advancedOpen ? (\n            <>'),
  'advanced controls use one explicit accessible disclosure',
);
for (const label of [
  'Work Type',
  'Automation Readiness',
  'Scheduled Automations',
  'Bridge And Tunnel',
  'Agent Guardrails',
  'Templates',
  'Posture',
  'Advanced Maintenance',
]) {
  assert(
    visiblePanel.indexOf(`title="${label}"`) > advancedGroupIndex,
    `${label} stays inside the advanced region`,
  );
}

assert(
  readinessPanel.includes('detailed: boolean;')
    && readinessPanel.includes('{detailed ? (')
    && !readinessPanel.includes('SHOW ALL')
    && !readinessPanel.includes('FOCUS'),
  'launch readiness defaults to a compact truthful headline instead of dashboard controls',
);
assert(
  visiblePanel.includes('{trimmed ? (\n            <LaunchReadinessPanel')
    && visiblePanel.indexOf('{trimmed ? (\n            <LaunchReadinessPanel') > taskIndex
    && readinessPanel.includes("issue !== 'Add a task before launch.'"),
  'an empty task stays focused on the composer and readiness appears only after task entry',
);

assert(
  consoleSource.includes('useCircleAutomations(visible && advancedOpen ? (circleId || null) : null)')
    && consoleSource.includes('if (!visible || !advancedOpen || !circleId || !userId) return;')
    && consoleSource.includes('if (!visible || !advancedOpen || !memoryDrawerOpen || !circleId) return;'),
  'automation subscriptions, run telemetry, and memory detail stay lazy until advanced options open',
);
assert(
  consoleSource.includes('useClaudeSpendBreakdown(visible && advancedOpen ? circleId || null : null, 24)')
    && consoleSource.includes('getCircleBudgetSnapshot(circleId)')
    && consoleSource.includes('if (!visible || !circleId || !hasTaskForPreflight)')
    && consoleSource.includes('if (!visible || !advancedOpen || !circleId) {\n      automationReadinessProbeRef.current += 1;')
    && consoleSource.includes('if (capabilityLoading || (!capabilityAudit && !capabilityError)) {')
    && consoleSource.includes('if (!visible || !circleId || (!advancedOpen && !requiresLiveCapabilityPreflight)) {'),
  'cold open skips hidden I/O and advanced readiness waits for one coherent capability snapshot',
);
assert(
  consoleSource.includes('capabilityAuditFailed: requiresLiveCapabilityPreflight ? capabilityError : null')
    && consoleSource.includes('automationBlockers: null')
    && consoleSource.includes("Planning can continue; live execution will re-check access."),
  'global diagnostics cannot block unrelated planning while task-specific live capability gates remain authoritative',
);
assert(
  consoleSource.includes('const launchTask = useMemo(')
    && consoleSource.includes('buildGuardrailedTask(trimmed, guardrailPrefs, selectedIntentMeta)')
    && consoleSource.includes('onSubmit({ task: launchTask, displayTask: trimmed, mode, model: currentModel });'),
  'progressive disclosure does not bypass the existing guardrail or launch contract',
);
assert(
  visiblePanel.includes('SCHEDULE OWNER · OPENSWAN')
    && visiblePanel.includes('retained for accountability')
    && visiblePanel.includes('dispatched live from Chat or Office only while their exact connection is available')
    && visiblePanel.includes('identity ${savedSubject.label}'),
  'scheduled automation UI distinguishes hosted execution from connected-agent identity attribution',
);

assert(
  chatConsole.includes('agentSubjectMetadata={selectedAgentSubjectContext.agentSubjectMetadata}')
    && chatConsole.includes('sendMessage(task, {')
    && chatConsole.includes('modeOverride: mode,'),
  'the panel retains selected Office-agent identity and dispatches through the canonical Chat path',
);
assert(
  chatSource.includes('loadCircleOfficeAgents(circleId)')
    && chatSource.includes('loadAgentIdentities()')
    && chatSource.includes('loadConnections()')
    && chatSource.includes('buildChatAgentTargets(liveAgents)'),
  'Chat still builds one selector from Office rows, live agent identities, and connected runtimes',
);

assert(
  stylesSource.includes('maxWidth: 900,')
    && stylesSource.includes('essentialContextRow: {')
    && stylesSource.includes('advancedDisclosure: {')
    && stylesSource.includes("flexWrap: 'wrap'"),
  'the simplified modal is bounded and its essential context can wrap responsively',
);

console.log(`\nOpenSwan progressive disclosure smoke: ${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
