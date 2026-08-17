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
  panel.includes('onRenameAgent?: (agent: OfficeAgent, newName: string) => Promise<boolean>')
    && renameCommand.includes('const capturedAuthority = exactIdentityAuthority')
    && renameCommand.includes('latestPanelScopeKeyRef.current !== capturedScopeKey')
    && renameCommand.includes('renameRequestGenerationRef.current !== requestGeneration')
    && renameCommand.includes('!isExactIdentityAuthorityCurrent(capturedAuthority)'),
  'header rename captures and fences the exact authority and selected-agent scope',
);
check(
  renameCommand.includes('if (saved !== true)')
    && renameCommand.indexOf('if (saved !== true)') < renameCommand.indexOf('setRenameDraft(null)')
    && renameCommand.includes("message: 'Agent name was not saved. Try again.'"),
  'header rename keeps the editor open and exposes generic failure until a true receipt arrives',
);
check(
  shell.includes('renameBusy: boolean')
    && shell.includes("{renameBusy ? 'Saving…' : 'Save'}")
    && shell.includes('accessibilityLiveRegion={actionNotice.kind === \'error\' ? \'assertive\' : \'polite\'}')
    && shell.includes("accessibilityRole={actionNotice.kind === 'error' ? 'alert' : undefined}"),
  'header commands expose disabled busy state and a live generic result region',
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
  customize.includes('onAppearanceChange: (id: string, appearance: AgentAppearance) => Promise<boolean>')
    && customize.includes('const saved = await onAppearanceChange(')
    && customize.includes('if (saved !== true)')
    && !customize.includes('Promise<void>')
    && !customize.includes('optimistically report'),
  'customization accepts only an asynchronous boolean durable receipt and never treats void as saved',
);
check(
  customize.includes('const saveInFlightRef = useRef(false)')
    && customize.includes('const saveGenerationRef = useRef(0)')
    && customize.includes('saveGenerationRef.current !== generation')
    && customize.includes("label: '✕ NOT SAVED — TRY AGAIN'")
    && !customize.includes('err.message')
    && customize.includes("accessibilityLiveRegion={saveState === 'error' ? 'assertive' : 'polite'}"),
  'customization serializes saves, rejects stale completion, redacts errors, and announces live status',
);

const appearanceOwner = section(office, 'onAppearanceChange={async (id, a) => {', 'environmentType={currentTheme.environmentType}');
check(
  appearanceOwner.includes('const receipt = await updateAgentIdentityExact(')
    && appearanceOwner.includes('!receipt.ok || !receipt.localSaved || !receipt.serverSaved')
    && appearanceOwner.includes('return isOfficeAuthorityCurrent(requestedAuthority)'),
  'Office customization returns true only after the existing exact writer reports full durable success',
);

console.log(`Office Agent panel command-owner smoke: ${assertions} passed`);
