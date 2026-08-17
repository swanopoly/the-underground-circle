/** Source contract for Office Agent section failure, stale-detail, and deletion safety. */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = process.cwd();
const read = (path: string) => readFileSync(`${root}/${path}`, 'utf8');
const memory = read('src/screens/circles/tabs/office/AgentMemoryPanel.tsx');
const runs = read('src/screens/circles/tabs/office/AgentRunsPanel.tsx');
const spirit = read('src/screens/circles/tabs/office/AgentSpiritPanel.tsx');

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
    && memory.includes("await mutateMemoryExact(mem, { is_active: false }, row => row.is_active === false)")
    && memory.includes('The memory change did not return exactly one receipt.')
    && memory.includes('busy: deletingMemoryId === mem.id')
    && memory.includes("deletingMemoryId === mem.id ? 'Deleting…' : 'Delete'")
    && memory.includes('setMemoryActionStatus(`Deleted memory: ${title}`)')
    && memory.includes('setMemoryActionStatus(`ERROR: Could not delete memory: ${title}`)'),
  'Memory deletion serializes mutations and exposes exact receipt, busy, success, and error states',
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

const customProfilesStart = spirit.indexOf('{(customProfiles.length > 0 || profileActionStatus)');
const customProfilesEnd = spirit.indexOf('{SPIRIT_CATEGORIES.map', customProfilesStart);
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
    && spirit.includes('Object.entries(expectedProfileReceipt).every(([field, requestedValue])')
    && spirit.includes('returnedProfile[field] === requestedValue')
    && spirit.includes(".select('id, user_id, name, emoji, color, tagline, system_prompt, skill_bundle, risk_tier, action_posture, evidence_posture, communication_density, skepticism, escalation_trigger')")
    && spirit.includes("String(data.user_id || '') !== authority.userId")
    && spirit.includes("String(data.name || '') !== requestedProfileName")
    && spirit.includes('accessibilityLabel="Save custom Spirit profile"')
    && spirit.includes('accessibilityLabel="Cancel saving custom Spirit profile"')
    && spirit.includes('Custom profile outcome could not be verified. Refresh profiles before retrying.')
    && spirit.includes('minHeight: 44'),
  'Custom-profile save validates its exact receipt and exposes accessible 44px save/cancel controls',
);
check(
  (spirit.match(/^\s*<ScrollView\b/gmu) || []).length === 1
    && spirit.includes('<ScrollView\n                  ref={personalityScrollRef}\n                  horizontal')
    && spirit.includes('accessibilityLabel={`${showSoul ? \'Hide\' : \'Show\'} system prompt`}')
    && spirit.includes('roleActionBtn: {\n    minHeight: 44')
    && spirit.includes('roleSaveBtn: {\n    minHeight: 44')
    && spirit.includes('roleDismissBtn: {\n    minHeight: 44')
    && spirit.includes('opsActionBtn: {\n    minHeight: 44')
    && spirit.includes('opsSaveBtn: {\n    minHeight: 44'),
  'Spirit leaves vertical scrolling to the shell and preserves accessible 44px artifact actions',
);

console.log(`Office Agent panel safety smoke: ${assertions} passed`);
