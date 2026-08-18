/**
 * Focused source contract for Office Agent popup command ownership.
 *
 * Pins three high-risk UI mutations without contacting Supabase:
 *   - the Shell header is the only rename editor;
 *   - published-agent removal closes only after an exact boolean receipt;
 *   - customization never converts a void/sync callback into saved UI.
 *
 * Run: npx tsx scripts/office-agent-panel-command-owner-smoketest.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = process.cwd();
const read = (path: string) => readFileSync(`${root}/${path}`, 'utf8');
const panel = read('src/screens/circles/tabs/office/AgentPanel.tsx');
const shell = read('src/screens/circles/tabs/office/AgentPanelShell.tsx');
const overview = read('src/screens/circles/tabs/office/AgentOverviewPanel.tsx');
const customize = read('src/screens/circles/tabs/office/AgentCustomizePanel.tsx');
const office = read('src/screens/circles/tabs/OfficeTab.tsx');

let assertions = 0;
function check(condition: unknown, message: string): void {
  assertions += 1;
  assert.ok(condition, message);
}

function section(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing source marker: ${startMarker}`);
  assert.ok(end > start, `missing end marker after: ${startMarker}`);
  return source.slice(start, end);
}

check(
  !overview.includes('renameAgentExact')
    && !overview.includes('onRenameAgent')
    && !overview.includes('renamingAgent')
    && !overview.includes('agentNameDraft'),
  'Overview owns no duplicate rename state, callback, or exact writer',
);
check(
  shell.includes('accessibilityLabel="Agent name"')
    && shell.includes('accessibilityLabel="Save agent name"')
    && panel.includes('setRenameDraft({ scopeKey: panelScopeKey, name: agent.name })'),
  'the Shell header is the single visible rename editor',
);

const renameCommand = section(panel, 'onSubmitRename={async () => {', 'onCancelRename={() => {');
check(
  panel.includes('onRenameAgent?: (agent: OfficeAgent, newName: string) => Promise<AgentIdentityExactSaveResult>')
    && renameCommand.includes('const capturedAuthority = exactIdentityAuthority')
    && renameCommand.includes('latestPanelScopeKeyRef.current !== capturedScopeKey')
    && renameCommand.includes('renameRequestGenerationRef.current !== requestGeneration')
    && renameCommand.includes('!isExactIdentityAuthorityCurrent(capturedAuthority)'),
  'header rename captures and fences the exact authority and selected-agent scope',
);
check(
  renameCommand.includes("receipt.error === 'outcome_unknown'")
    && renameCommand.includes('receipt.serverSaved === true && !receipt.localSaved')
    && renameCommand.includes('Reload this agent before retrying the rename.')
    && renameCommand.includes('do not save the name again.')
    && renameCommand.includes("actionLabel: 'Reload identity'")
    && renameCommand.includes('onAction: reloadIdentityForNotice')
    && renameCommand.includes("message: 'Agent name was not saved. Try again.'"),
  'header rename distinguishes unknown, durable-server/local-refresh, and definitive failure receipts',
);
check(
  shell.includes('renameBusy: boolean')
    && shell.includes("{renameBusy ? 'Saving…' : 'Save'}")
    && shell.includes("actionNotice.kind === 'warning'")
    && shell.includes("accessibilityLiveRegion={actionNotice.kind === 'success' ? 'polite' : 'assertive'}")
    && shell.includes("accessibilityRole={actionNotice.kind === 'success' ? undefined : 'alert'}")
    && shell.includes('actionNotice.actionLabel && actionNotice.onAction'),
  'header commands expose disabled busy state plus assertive and actionable warning/error receipt regions',
);

const removeCommand = section(panel, 'onRemoveAgent={async () => {', 'tabs={tabs}');
check(
  panel.includes('onRemoveAgent?: (agent: OfficeAgent) => Promise<boolean>')
    && removeCommand.includes('const capturedAuthority = exactIdentityAuthority')
    && removeCommand.includes('latestPanelScopeKeyRef.current !== capturedScopeKey')
    && removeCommand.includes('removeRequestGenerationRef.current !== requestGeneration')
    && removeCommand.includes('if (removed !== true)'),
  'published-agent removal is authority-fenced and requires an explicit true receipt',
);
check(
  removeCommand.includes("message: 'Agent could not be removed. Try again.'")
    && removeCommand.indexOf('if (removed !== true)') < removeCommand.indexOf('onClose();'),
  'failed removal remains open with generic live-region copy',
);

const removeOwner = section(
  office,
  'const handleRemovePublishedAgent = useCallback(async (agent: OfficeAgent) => {',
  '// ─── Reversible floor editor helpers',
);
check(
  removeOwner.includes(".eq('id', publishedAgentId)")
    && removeOwner.includes(".eq('circle_id', requestedAuthority.circleId)")
    && removeOwner.includes(".eq('owner_id', requestedAuthority.userId)")
    && removeOwner.includes('removedRows?.length === 1')
    && removeOwner.includes('return isOfficeAuthorityCurrent(requestedAuthority)')
    && !removeOwner.includes('setSelectedAgent(null)'),
  'Office returns true only after the exact one-row delete and delegates panel closure to the command owner',
);

check(
  customize.includes('onAppearanceChange: (id: string, appearance: AgentAppearance) => Promise<AgentIdentityExactSaveResult>')
    && customize.includes('const receipt = await onAppearanceChange(')
    && customize.includes("setSaveState('refresh-needed')")
    && customize.includes("setSaveState('outcome-unknown')")
    && !customize.includes('Promise<void>')
    && !customize.includes('optimistically report'),
  'customization consumes the exact receipt and preserves partial or unknown save truth',
);
check(
  customize.includes('const saveInFlightRef = useRef(false)')
    && customize.includes('const saveGenerationRef = useRef(0)')
    && customize.includes('saveGenerationRef.current !== generation')
    && customize.includes("label: 'SAVED ON SERVER — RELOAD REQUIRED'")
    && customize.includes("label: 'OUTCOME UNKNOWN — REOPEN BEFORE RETRY'")
    && customize.includes("saveState === 'refresh-needed'")
    && customize.includes("saveState === 'outcome-unknown'")
    && customize.includes('disabled={saveBlocked}')
    && customize.includes('const refreshed = await onIdentityRefresh()')
    && customize.includes('RELOAD APPEARANCE')
    && customize.includes("label: '✕ NOT SAVED — TRY AGAIN'")
    && !customize.includes('err.message')
    && customize.includes("accessibilityRole={saveState === 'error' || saveState === 'refresh-needed' || saveState === 'outcome-unknown' ? 'alert' : undefined}"),
  'customization serializes saves, blocks stale-result replay, redacts errors, and announces receipt truth',
);

const appearanceOwner = section(office, 'onAppearanceChange={async (id, a): Promise<AgentIdentityExactSaveResult> => {', 'environmentType={currentTheme.environmentType}');
check(
  appearanceOwner.includes('const receipt = await updateAgentIdentityExact(')
    && appearanceOwner.includes('!receipt.ok || !receipt.localSaved || receipt.serverSaved !== true')
    && appearanceOwner.includes('return receipt;')
    && appearanceOwner.indexOf('!receipt.ok || !receipt.localSaved || receipt.serverSaved !== true') < appearanceOwner.indexOf('setAppearances('),
  'Office customization returns the exact receipt and adopts appearance only after full durable local success',
);
check(
  office.includes('const selectedAgentPanelAppearances = useMemo(() => {')
    && office.includes('getAgentIdentityByAgent(agentIdentities, selectedAgent)?.appearance')
    && office.includes('[selectedAgent.id]: resolvedAppearance')
    && office.includes('appearances={selectedAgentPanelAppearances}')
    && panel.includes('onIdentityRefresh={onAgentIdentityChange}'),
  'an explicit exact identity reload rehydrates the popup appearance from verified server truth',
);

console.log(`Office Agent panel command-owner smoke: ${assertions} passed`);
