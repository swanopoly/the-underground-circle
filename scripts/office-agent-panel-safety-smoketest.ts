/** Source contract for Office Agent section failure, stale-detail, and deletion safety. */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = process.cwd();
const read = (path: string) => readFileSync(`${root}/${path}`, 'utf8');
const memory = read('src/screens/circles/tabs/office/AgentMemoryPanel.tsx');
const runs = read('src/screens/circles/tabs/office/AgentRunsPanel.tsx');
const spirit = read('src/screens/circles/tabs/office/AgentSpiritPanel.tsx');
const panel = read('src/screens/circles/tabs/office/AgentPanel.tsx');
const shell = read('src/screens/circles/tabs/office/AgentPanelShell.tsx');
const overview = read('src/screens/circles/tabs/office/AgentOverviewPanel.tsx');
const activity = read('src/screens/circles/tabs/office/AgentActivityPanel.tsx');
const gateway = read('src/screens/circles/tabs/office/AgentGatewayPanels.tsx');
const terminal = read('src/screens/circles/tabs/office/AgentTerminalPanels.tsx');
const evolution = read('src/screens/circles/tabs/office/AgentEvolutionPanel.tsx');
const customize = read('src/screens/circles/tabs/office/AgentCustomizePanel.tsx');
const sessionTagInput = read('src/components/SessionTagInput.tsx');
const sessionTagsHelp = read('src/components/SessionTagsHelp.tsx');

let assertions = 0;
const check = (condition: unknown, message: string) => {
  assert.ok(condition, message);
  assertions += 1;
};

check(
  memory.includes("const [loadError, setLoadError] = useState<string | null>(null)")
    && memory.includes("? 'Memory refresh failed. Showing the last verified snapshot")
    && memory.includes(": 'Memory could not be loaded. Check the connection and try again.'")
    && memory.includes('accessibilityLabel="Retry loading agent memory"')
    && memory.includes('loadError && !hasVerifiedSnapshot ? null')
    && memory.includes('loading && hasVerifiedSnapshot')
    && memory.includes('visibleMemories.length'),
  'Memory load failures preserve only a same-scope verified snapshot and remain retryable instead of claiming false empty state',
);
check(
  memory.includes('const requestDeleteMemory = (mem: any) =>')
    && memory.includes('window.confirm(message)')
    && memory.includes("Alert.alert('Delete memory?', message")
    && memory.includes('onPress={() => requestDeleteMemory(mem)}')
    && !memory.includes('onPress={() => handleDelete(mem.id)}'),
  'Memory deletion requires an explicit web or native confirmation',
);
check(
  memory.includes('const [deletingMemoryId, setDeletingMemoryId]')
    && memory.includes('const [mutatingMemoryId, setMutatingMemoryId]')
    && memory.includes('if (!memoryId || memoryMutationLockRef.current) return false')
    && memory.includes('await mutateMemoryExact(mem, { is_active: false })')
    && memory.includes("setMemoryActionStatus(`CONFLICT: ${conflictMessage}`)")
    && memory.includes("setMemoryActionStatus('OUTCOME UNKNOWN:")
    && memory.includes('busy: deletingMemoryId === mem.id')
    && memory.includes("deletingMemoryId === mem.id ? 'Deleting…' : 'Delete'")
    && memory.includes('`Deleted memory: ${title}`')
    && memory.includes('`Could not delete memory: ${title}. No successful deletion was confirmed.`'),
  'Memory deletion serializes mutations and exposes conflict, unknown, busy, success, and failure states',
);
check(
  memory.includes('accessibilityLabel={`Edit memory:')
    && memory.includes('accessibilityLabel={`${mem.pinned ? \'Unpin\' : \'Pin\'} memory:')
    && memory.includes('accessibilityLabel={`Promote memory:')
    && memory.includes('accessibilityLabel={`Delete memory:')
    && memory.includes('minHeight: 44, minWidth: 44'),
  'Memory card actions have accessible names, state, and reliable target sizing',
);

check(
  runs.includes("const [loadError, setLoadError] = useState<string | null>(null)")
    && runs.includes("setLoadError('Runs could not be loaded. Check the connection and try again.')")
    && runs.includes('accessibilityLabel="Retry loading agent runs"')
    && runs.includes('loadError && runs.length === 0 ? null'),
  'Run-list failures render a retryable error instead of a false empty state',
);
check(
  runs.includes('const detailRequestGenerationRef = useRef(0)')
    && runs.includes("setRunDetails({ rootRunId, runId, selectedRun, status: 'loading', steps: [], childRuns: [], error: null })")
    && runs.includes('if (detailRequestGenerationRef.current !== requestGeneration) return;')
    && runs.includes("setRunDetails({ rootRunId, runId, selectedRun, status: 'ready', steps: stepData, childRuns: childRunData, error: null })"),
  'Run details clear atomically before loading and ignore stale generations',
);
check(
  runs.includes("status: 'error'")
    && runs.includes("error: 'Run details could not be loaded. Try again.'")
    && runs.includes('accessibilityLabel={`Retry loading details for')
    && runs.includes("currentDetails.status === 'error'"),
  'Run-detail failures expose an explicit retry state',
);
check(
  !runs.includes('setSteps(')
    && !runs.includes('setChildRuns(')
    && runs.includes('detailRequestGenerationRef.current += 1;')
    && runs.includes('setRunDetails(EMPTY_RUN_DETAILS)'),
  'Run collapse and authority changes cannot leave prior steps or children visible',
);
check(
  runs.includes('Presentation-only liveness projection')
    && runs.includes('const data = rawData;')
    && !runs.includes("reapRun(runId, 'heartbeat_stale')")
    && !runs.includes("import('../../../../lib/agentRunSystem').reapRun"),
  'Opening per-agent run history remains read-only and cannot reap canonical runs',
);

const customProfilesStart = spirit.indexOf('{(customProfiles.length > 0 || Boolean(profileActionStatus))');
const customProfilesEnd = spirit.indexOf('<View testID="agent-soul-library"', customProfilesStart);
assert.ok(customProfilesStart >= 0 && customProfilesEnd > customProfilesStart, 'custom profile section is discoverable');
const customProfilesSection = spirit.slice(customProfilesStart, customProfilesEnd);
assertions += 1;

check(
  spirit.includes('const requestDeleteCustomProfile = (profile: any) =>')
    && spirit.includes('window.confirm(message)')
    && spirit.includes("Alert.alert('Delete custom profile?', message")
    && customProfilesSection.includes('onPress={() => requestDeleteCustomProfile(profile)}')
    && !customProfilesSection.includes('onLongPress='),
  'Custom-profile deletion is visible and confirmed rather than hidden behind long press',
);
check(
  customProfilesSection.includes('accessibilityLabel={`Delete custom profile')
    && customProfilesSection.includes('busy: deleting')
    && customProfilesSection.includes("deleting ? 'DELETING…' : 'DELETE PROFILE'")
    && spirit.includes('customProfileDeleteBtn: {')
    && spirit.includes('minHeight: 44,'),
  'Custom-profile delete exposes an accessible 44px busy control',
);
check(
  spirit.includes('deleteUnreferencedCustomAgentProfileExact(')
    && spirit.includes('authority,\n        isIdentityAuthorityCurrent,')
    && spirit.includes('!receipt.ok || receipt.serverDeleted !== true')
    && spirit.includes("receipt.error === 'outcome_unknown'")
    && spirit.includes('Refresh profiles before retrying.')
    && spirit.includes("receipt.error === 'profile_referenced'")
    && spirit.includes('The profile deletion did not return one exact server receipt.')
    && spirit.includes('Clear every assignment before deleting it.')
    && spirit.includes('setProfileActionStatus(`Deleted custom profile: ${profileName}`)')
    && spirit.includes('`ERROR: Could not delete custom profile: ${profileName}`')
    && customProfilesSection.includes('accessibilityLiveRegion="polite"'),
  'Custom-profile deletion retains exact owner authority and provides verified, visible success and error receipts',
);
check(
  spirit.includes('const requestedProfileName = saveProfileName.trim()')
    && spirit.includes('const expectedProfileReceipt = {')
    && spirit.includes('const exactClient = getSupabaseClientForAccessToken(authority.accessToken);')
    && spirit.includes("exactClient.from('custom_agent_profiles')\n                                  .insert(expectedProfileReceipt)")
    && !spirit.includes("exactClient.from('custom_agent_profiles').upsert(")
    && spirit.includes('if (!Array.isArray(insertedProfiles) || insertedProfiles.length !== 1)')
    && spirit.includes('Object.entries(expectedProfileReceipt).every(([field, requestedValue])')
    && spirit.includes('returnedProfile[field] === requestedValue')
    && spirit.includes(".select('id, user_id, name, emoji, color, tagline, system_prompt, skill_bundle, risk_tier, action_posture, evidence_posture, communication_density, skepticism, escalation_trigger')")
    && spirit.includes("String(data.user_id || '') !== authority.userId")
    && spirit.includes("String(data.name || '') !== requestedProfileName")
    && spirit.includes('accessibilityLabel="Save custom Spirit profile"')
    && spirit.includes('accessibilityLabel="Cancel saving custom Spirit profile"')
    && spirit.includes('Choose a new name; the existing profile was not changed.')
    && spirit.includes('Custom profile outcome could not be verified. No profile was adopted; refresh profiles before retrying.')
    && spirit.includes('if (savingProfileTokenRef.current === savingToken)')
    && spirit.includes('minHeight: 44'),
  'Custom-profile Save As is create-only, validates one exact receipt, and exposes accessible 44px save/cancel controls',
);
check(
  (spirit.match(/^\s*<ScrollView\b/gmu) || []).length === 1
    && spirit.includes('<ScrollView\n                  ref={personalityScrollRef}\n                  horizontal')
    && spirit.includes('accessibilityLabel={`${showSoul ? \'Hide\' : \'Show\'} system prompt`}')
    && spirit.includes('roleDismissBtn: {\n    minHeight: 44')
    && spirit.includes('opsActionBtn: {\n    minHeight: 44')
    && spirit.includes('opsSaveBtn: {\n    minHeight: 44'),
  'Spirit leaves vertical scrolling to the shell and preserves accessible 44px operations-artifact actions',
);

check(
  !spirit.includes('ROLE READINESS')
    && !spirit.includes('spiritCareerProfiles')
    && !spirit.includes('handleGenerateRoleArtifact')
    && !spirit.includes('handleSaveRoleArtifact')
    && !spirit.includes('Draft a resume artifact in this Spirit')
    && !spirit.includes('Draft interview preparation in this Spirit')
    && !spirit.includes('WORK SAMPLE'),
  'Spirit omits the complete Role Readiness summary, source-link, and career-artifact surface',
);

check(
  spirit.includes('accessibilityLabel="Spirit skill bundle"')
    && spirit.includes('accessibilityLabel="Spirit escalation trigger"')
    && spirit.includes('accessibilityLabel="Spirit system prompt"')
    && spirit.includes('accessibilityLabel="Custom Spirit profile name"')
    && spirit.includes('accessibilityLabel="Custom agent personality instructions"'),
  'Spirit edit fields expose stable screen-reader names instead of relying on placeholder text',
);
check(
  spirit.includes("accessibilityLabel={`${label.toLowerCase()} ${opt.replace(/-/g, ' ')}`}")
    && spirit.includes('accessibilityState={{ selected: value === opt }}')
    && spirit.includes("style={[{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 8")
    && spirit.includes('accessibilityLabel={`Use ${tmpl.name} personality`}')
    && spirit.includes('accessibilityState={{ selected: isActive }}')
    && spirit.includes("personalityChip: {\n    minHeight: 44, justifyContent: 'center'"),
  'Spirit knob and personality choices expose their button and selected semantics',
);
check(
  spirit.includes('accessibilityLabel="Scroll personality choices left"')
    && spirit.includes('accessibilityLabel="Scroll personality choices right"')
    && spirit.includes('accessibilityLabel="Save agent personality instructions"')
    && spirit.includes('accessibilityLabel="Clear agent personality instructions"')
    && spirit.includes("width: 44,\n    height: 44,")
    && spirit.includes("minHeight: 44, justifyContent: 'center', paddingHorizontal: 16"),
  'Spirit personality navigation and save controls have descriptive names and reliable targets',
);
check(
  spirit.includes("accessibilityLabel={showSpirits ? 'Hide Spirit settings' : 'Show Spirit settings'}")
    && spirit.includes('accessibilityState={{ expanded: showSpirits }}')
    && spirit.includes("accessibilityLabel={`${editingSpirit ? 'Stop editing' : 'Edit'} ${s.name} Spirit settings`}")
    && spirit.includes('accessibilityLabel="Draft an operations plan in this Spirit"')
    && spirit.includes('accessibilityLabel="Dismiss operations artifact"')
    && spirit.includes('accessibilityLabel={`Save ${s.name} settings as a custom Spirit profile`}')
    && spirit.includes('accessibilityLabel="Loading verified Spirit identity"')
    && spirit.includes("spiritRow: {\n    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',\n    minHeight: 44")
    && spirit.includes("spiritClearBtn: {\n    minHeight: 44"),
  'Spirit disclosure, editing, operations-artifact, loading, and custom-profile actions expose named stateful 44px controls',
);

for (const [label, source] of [
  ['Overview', overview],
  ['Activity', activity],
  ['OpenSwan and Schedules', gateway],
  ['Terminal', terminal],
  ['Memory', memory],
  ['Runs', runs],
  ['Spirit', spirit],
  ['XP and Achievements', evolution],
  ['Customize', customize],
] as const) {
  check(
    !/borderRadius: [234]\b/.test(source) && !source.includes("fontWeight: '900'"),
    `${label} uses the shared 6px-or-softer popup corner and type-weight language instead of legacy sharp/heavy controls`,
  );
}

check(
  shell.includes('style={styles.tabPanel}')
    && shell.includes('tabPanel: {\n    gap: 16,')
    && activity.includes('style={{ gap: 16, paddingBottom: 16 }}')
    && gateway.includes('style={{ gap: 16, paddingBottom: 16 }}')
    && !panel.includes('nativeID="section-agent-memory" style={{ paddingHorizontal: 8')
    && !panel.includes('nativeID="section-agent-runs" style={{ paddingHorizontal: 8')
    && !panel.includes('nativeID="section-agent-cron" style={{ paddingHorizontal: 8'),
  'Every popup destination inherits one shell-owned horizontal inset and a stable 16px section rhythm',
);

check(
  terminal.includes('disabled={cmdRunning || !cmdInput.trim()}')
    && terminal.includes('accessibilityState={{ disabled: cmdRunning || !cmdInput.trim(), busy: cmdRunning }}')
    && terminal.includes('accessibilityLabel="Running read-only diagnostic"')
    && terminal.includes('accessibilityLabel="Loading verified terminal profile"')
    && evolution.includes('accessibilityLiveRegion="polite"')
    && evolution.includes('Loading verified progression…'),
  'Terminal and progression expose consistent disabled and named loading states',
);
check(
  spirit.includes('const executionTruth = resolveOfficeAgentExecutionTruth(agent);')
    && spirit.includes("executionTruth.state === 'warning'")
    && spirit.includes("executionTruth.state === 'active'")
    && spirit.includes("executionTruth.state === 'connected'")
    && spirit.includes("executionTruth.state === 'active' ? 'NOW:' : 'STATUS:'")
    && !spirit.includes('<Text style={styles.activityValue}>{agent.activity}</Text>'),
  'Spirit never labels retained offline or warning activity as current work',
);
check(
  spirit.includes("if (!currentSpirit.startsWith('custom::')) return null;")
    && spirit.includes("const profileId = currentSpirit.slice('custom::'.length);")
    && spirit.includes('const customSpirit: AgentSpirit = {')
    && spirit.includes('{selectedSpirit ? (')
    && spirit.includes('{selectedSpirit && (() => {')
    && spirit.includes('selectedSpirit.name')
    && spirit.includes('selectedSpirit.emoji'),
  'A verified custom Spirit resolves to the same visible badge and editable detail contract as a built-in Spirit',
);

const sessionTagToggle = sessionTagInput.indexOf("accessibilityLabel={showHelp ? 'Hide Session Tags Guide'");
const sessionTagDisclosure = sessionTagInput.indexOf('<SessionTagsHelp visible={showHelp} />');
check(
  sessionTagToggle >= 0
    && sessionTagDisclosure > sessionTagToggle
    && sessionTagInput.includes("'aria-controls': 'uc-session-tags-help'")
    && sessionTagInput.includes('accessibilityState={{ expanded: showHelp }}')
    && sessionTagsHelp.includes('nativeID="uc-session-tags-help"')
    && sessionTagsHelp.includes("role: 'region'")
    && !sessionTagsHelp.includes('<ScrollView')
    && !sessionTagsHelp.includes('styles.overlay'),
  'Session Tags help is an in-flow disclosure after its persistent expanded-state toggle, not a nested faux modal',
);
check(
  sessionTagInput.includes('accessibilityLabel={`Remove ${tag.label} session tag`}')
    && sessionTagInput.includes('accessibilityLabel="Session tag"')
    && sessionTagInput.includes('accessibilityLabel="Add session tag"')
    && sessionTagInput.includes('accessibilityLabel={`Start ${meta.label} session tag`}')
    && sessionTagInput.includes('accessibilityLabel={`Add suggested session tag ${suggestion.label}`}')
    && sessionTagInput.includes("tagRemove: {\n    width: 44,\n    height: 44,"),
  'Session tag editing, suggestions, removal, and help expose named controls with a 44px primary target',
);

console.log(`Office Agent panel safety smoke: ${assertions} passed`);
