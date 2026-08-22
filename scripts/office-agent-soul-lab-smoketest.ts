import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildSoulBlueprint,
  buildSoulEvaluationDraft,
  SOUL_EVALUATION_SCENARIOS,
} from '../src/lib/agentSpiritPromptCore.ts';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const panel = read('src/screens/circles/tabs/office/AgentSpiritPanel.tsx');

let assertions = 0;
function check(condition: unknown, message: string): void {
  assertions += 1;
  assert.ok(condition, message);
}

check(SOUL_EVALUATION_SCENARIOS.length === 4, 'Soul Lab exposes four representative evaluation scenarios');
check(
  new Set(SOUL_EVALUATION_SCENARIOS.map(scenario => scenario.id)).size === SOUL_EVALUATION_SCENARIOS.length,
  'Soul Lab scenario ids are unique',
);

for (const scenario of SOUL_EVALUATION_SCENARIOS) {
  const draft = buildSoulEvaluationDraft(scenario.id);
  check(typeof draft === 'string' && draft.length > 0 && draft.length <= 3_500, `${scenario.id} produces one bounded draft`);
  check(draft?.includes('no-action evaluation') && draft.includes('Do not call tools'), `${scenario.id} remains an explicit no-action simulation`);
  check(draft?.includes('Success criteria:') && scenario.successCriteria.every(item => draft.includes(item)), `${scenario.id} carries its success criteria`);
  check(!draft?.includes('private-profile-name') && !draft?.includes('private-profile-prompt'), `${scenario.id} does not project private profile metadata`);
}
check(buildSoulEvaluationDraft('not-a-scenario') === null, 'unknown Soul evaluation scenarios fail closed');

const completeBlueprint = buildSoulBlueprint({
  purpose: 'Support reliable delivery.',
  systemPrompt: 'Work carefully and verify outcomes.',
  skillBundle: 'delivery-review',
  escalationTrigger: 'The target, authority, or evidence is unclear.',
  actionPosture: 'act-gated',
  evidencePosture: 'very-high',
  communicationDensity: 'terse',
  skepticism: 'high',
  riskTier: 'critical',
});
check(completeBlueprint.completeCount === completeBlueprint.checks.length, 'a fully defined structured Soul marks every blueprint field ready');
check(completeBlueprint.autonomy.includes('approval gate'), 'blueprint explains gated autonomy');
check(completeBlueprint.evidence.includes('multiple proofs'), 'blueprint explains very-high evidence posture');
check(completeBlueprint.risk.includes('human oversight'), 'blueprint explains critical risk posture');

check(buildSoulBlueprint({ systemPrompt: 'a'.repeat(4_000) }).promptFootprint === 'compact', '4,000 visible characters remain compact');
check(buildSoulBlueprint({ systemPrompt: 'a'.repeat(4_001) }).promptFootprint === 'extended', '4,001 visible characters become extended');
check(buildSoulBlueprint({ systemPrompt: 'a'.repeat(8_001) }).promptFootprint === 'very-large', '8,001 visible characters become very large');
check(buildSoulBlueprint({}).completeCount === 0, 'an empty blueprint does not claim configured fields');

for (const marker of [
  'testID="agent-soul-lab"',
  'testID="agent-soul-library"',
  'testID="agent-soul-search"',
  'testID="agent-soul-test-chat"',
  'const [showSoulLibrary, setShowSoulLibrary] = useState(false)',
  '{showSoulLibrary ? SPIRIT_CATEGORIES',
  'buildSoulBlueprint({',
  'buildSoulEvaluationDraft(selectedSoulTestScenario)',
  'onOpenInChat?.(draft)',
  'Prefills a no-action evaluation and does not send or run it',
  'Chat receives a draft only; nothing is sent or executed automatically.',
  "const soulTestDisabled = !onOpenInChat || editingSpirit",
  'accessibilityState={{ selected }}',
  'minHeight: 44',
]) {
  check(panel.includes(marker), `Agent Soul surface includes ${marker}`);
}

const filterStart = panel.indexOf('const filteredSpirits = useMemo');
const filterEnd = panel.indexOf('const executionTruth', filterStart);
check(filterStart >= 0 && filterEnd > filterStart, 'Soul catalog filter is discoverable');
const filterSource = panel.slice(filterStart, filterEnd);
check(
  filterSource.includes('spirit.name')
    && filterSource.includes('spirit.tagline')
    && filterSource.includes('spirit.skillBundle'),
  'Soul search covers public role, specialty, and skill metadata',
);
check(!filterSource.includes('systemPromptPrefix'), 'Soul search does not index raw prompt text');

const testStart = panel.indexOf('testID="agent-soul-test-chat"');
const testEnd = panel.indexOf('</Pressable>', testStart);
check(testStart >= 0 && testEnd > testStart, 'Soul Chat handoff is discoverable');
const handoffSource = panel.slice(testStart, testEnd);
check(
  !/sendMessage|dispatch|execute|runAgent|invokeAgent/u.test(handoffSource),
  'Soul Lab does not send, dispatch, execute, or invoke from the popup',
);
check(
  panel.includes('persistSpiritSelection(spirit.id, spirit.emoji, {')
    && panel.includes('if (!saved || !isIdentityRequestCurrent(capturedRequestKey)) return;'),
  'Soul library assignment retains the exact persisted assignment path and scope fence',
);

console.log(`office agent Soul Lab smoke passed (${assertions} assertions)`);
