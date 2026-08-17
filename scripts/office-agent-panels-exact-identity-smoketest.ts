import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const panel = read('src/screens/circles/tabs/office/AgentPanel.tsx');
const overview = read('src/screens/circles/tabs/office/AgentOverviewPanel.tsx');
const terminal = read('src/screens/circles/tabs/office/AgentTerminalPanels.tsx');
const memory = read('src/screens/circles/tabs/office/AgentMemoryPanel.tsx');
const spirit = read('src/screens/circles/tabs/office/AgentSpiritPanel.tsx');

let assertions = 0;
function check(condition: unknown, message: string): void {
  assertions += 1;
  assert(condition, message);
}

check(panel.includes('identityAuthority?: AgentIdentityExactAuthority | null'), 'AgentPanel accepts one exact identity authority');
check(panel.includes('authorityCircleId !== circleId'), 'AgentPanel rejects a mismatched authority circle');
check(panel.includes('Number.isSafeInteger(generation)') && panel.includes('generation <= 0'), 'AgentPanel requires positive generation-bearing authority');
check(!panel.includes('safeGetUser'), 'AgentPanel never recovers mutable global auth');
check((panel.match(/identityAuthority=\{exactIdentityAuthority\}/g) || []).length >= 5, 'AgentPanel threads exact authority to Overview, both Terminal surfaces, Spirit, and Memory');
check((panel.match(/isIdentityAuthorityCurrent=\{isExactIdentityAuthorityCurrent\}/g) || []).length >= 4, 'AgentPanel threads one lifecycle fence to Runtime, Spirit, Memory, and Cron');
check(panel.includes('chatAgentTargetIdFromOfficeAgentId(chatAgentId)'), 'AgentPanel admits Chat handoff only when the exact Office identity resolves to a canonical Chat target');
check((panel.match(/onOpenInChat=\{openAgentInChat\}/g) || []).length >= 5, 'all task-creating child surfaces share the exact canonical Chat handoff');
check(panel.includes('key={panelScopeKey}') && panel.includes('<memoryPanelModule.default'), 'Memory state remounts at the complete agent and authority boundary');
check(
  panel.includes('!onRenameAgent')
    && panel.includes('!capturedAuthority')
    && panel.includes('!isExactIdentityAuthorityCurrent(capturedAuthority)')
    && panel.includes('if (saved !== true)'),
  'panel-shell rename fails closed without live exact authority or an explicit durable receipt',
);

check(overview.includes('loadAgentIdentitiesExact(exactIdentityAuthority)'), 'Overview reads the exact identity cache');
check(
  !overview.includes('renameAgentExact')
    && !overview.includes('onRenameAgent')
    && !overview.includes('renamingAgent'),
  'Overview delegates rename exclusively to the fenced panel header command owner',
);
check(overview.includes('setMainAgentForProviderExact(') && overview.includes('agent.providerType,\n        capturedAuthority,\n        isIdentityAuthorityCurrent,'), 'Overview primary-agent mutation is exact-scoped and fenced');
check(!/\bloadAgentIdentities\(/.test(overview), 'Overview has no ownerless identity read');
check(!/\brenameAgent\(/.test(overview), 'Overview has no ownerless rename fallback');
check(!/\bsetMainAgentForProvider\(/.test(overview), 'Overview has no ownerless primary-agent mutation');
check(overview.includes('latestIdentityRequestKeyRef.current !== capturedRequestKey'), 'Overview rejects late identity reads and mutations');
check(overview.includes(".setHeader('Authorization', `Bearer ${accessToken}`)"), 'Overview memory status binds the captured bearer');
check(overview.includes('!receipt.ok || !receipt.localSaved || !receipt.serverSaved'), 'Overview requires a complete durable identity receipt');
check(overview.includes('isParentIdentityAuthorityCurrent(authority)'), 'Overview composes its local request fence with the parent authority lifecycle');

check(terminal.includes('loadAgentIdentitiesExact(exactIdentityAuthority)'), 'Terminal profile reads exact-scoped identity data');
check(terminal.includes('updateAgentIdentityExact(identityKey'), 'Terminal profile writes with captured exact authority');
check(!/\bloadAgentIdentities\(/.test(terminal), 'Terminal profile has no ownerless identity read');
check(!/\bupdateAgentIdentity\(/.test(terminal), 'Terminal profile has no ownerless identity write');
check(terminal.includes('latestIdentityRequestKeyRef.current !== capturedRequestKey'), 'Terminal profile rejects late results');
check(terminal.includes('Sign in to this circle before saving'), 'Terminal profile fails closed with actionable locked-state copy');
check(terminal.includes('!receipt.ok || !receipt.localSaved || !receipt.serverSaved'), 'Terminal profile requires a truthful durable exact-save receipt');
check(!terminal.includes('safeGetUser'), 'Terminal surfaces never recover mutable global auth');
check(terminal.includes('onOpenInChat?: (draft?: string) => void'), 'Quick Terminal exposes only the canonical Chat handoff');
check(terminal.includes('onOpenInChat(message)') && !/onOpenInChat\(message\);\s*setInput\(''\)/.test(terminal), 'Quick Terminal carries a draft to Chat without clearing it before admission');
check(terminal.includes('Chat owns the durable message, approvals, run, proof, and recovery trail.'), 'Quick Terminal explains canonical Chat ownership');
for (const retiredDirectPath of ['sendSwanBotMessage', 'loadConversationHistory', 'listConversationSessions', 'sendSessionMessage']) {
  check(!terminal.includes(retiredDirectPath), `Quick Terminal has no direct ${retiredDirectPath} path`);
}

check(memory.includes('identityAuthority: AgentMemoryPanelAuthority | null'), 'Memory requires exact authority');
check(memory.includes('isIdentityAuthorityCurrent: AgentMemoryPanelAuthorityFence'), 'Memory requires a lifecycle fence');
check(memory.includes(".setHeader('Authorization', bearer)"), 'Memory reads bind the captured bearer');
check(memory.includes('if (result.error) throw result.error'), 'Memory propagates read failures instead of converting them to empty state');
check(memory.includes('The memory change did not return exactly one receipt.'), 'Memory mutations require exactly one row receipt');
check(memory.includes(".eq('circle_id', authority.circleId)") && memory.includes(".eq('user_id', authority.userId)"), 'Memory writes bind exact circle and owner filters');
check(!memory.includes("import('../../../../lib/agentMemory')") && !memory.includes("import('../../../../lib/memoryActions')"), 'Memory has no ambient mutation helper path');
check(memory.includes('onOpenInChat(request.slice(0, 3_500))'), 'new Memory and instruction drafts continue through canonical Chat');
check(!memory.includes('<ScrollView'), 'Memory leaves vertical scrolling to the panel shell');
check(!memory.includes(".eq('name', agentName.trim())"), 'Memory Soul projection never aliases a live session to a published agent by display name');

check(spirit.includes('syncAgentIdentitiesFromServerExact(authority)'), 'Spirit hydrates from a durable exact identity snapshot');
check(spirit.includes('updateAgentIdentityExact(') && spirit.includes('updates,\n      authority,\n      isIdentityAuthorityCurrent,'), 'Spirit identity patches bind captured authority and its live generation fence');
check(!/\bloadAgentIdentities\(/.test(spirit), 'Spirit has no ownerless identity read');
check(!/\bupdateAgentIdentity\(/.test(spirit), 'Spirit has no ownerless identity write');
check(!spirit.includes('safeGetUser'), 'Spirit never swaps to mutable global auth');
check(!spirit.includes('updateAgentSpirit('), 'Spirit has no ambient or zero-row-success public assignment helper');
check(!spirit.includes('.ilike(') && !spirit.includes(".upsert({\n        circle_id"), 'Spirit never name-matches or auto-creates a public agent row');
check(spirit.includes('deleteUnreferencedCustomAgentProfileExact(') && spirit.includes('receipt.serverDeleted'), 'Spirit profile deletion requires the exact unreferenced-profile RPC receipt');
check(spirit.includes('updatePublishedAgentSpiritExact({') && spirit.includes('receipt.localSaved') && spirit.includes('receipt.serverSaved'), 'Spirit assignment requires one atomic public/private receipt plus local publication');
check(spirit.includes("receipt.error === 'profile_referenced'"), 'Spirit preserves referenced profiles and asks the user to clear assignments first');
check(spirit.includes('spiritAssignmentBusyRef.current') && spirit.includes('disabled={spiritAssignmentBusy}'), 'Spirit assignment is a visible single-flight mutation');
check(spirit.includes('receipt.serverSaved === true && !receipt.localSaved') && spirit.includes('Spirit was saved on the server, but this view could not refresh'), 'Spirit preserves a durable-server/local-refresh partial outcome without false failure copy');
check(spirit.includes("receipt.error === 'outcome_unknown'") && spirit.includes('Refresh this Spirit before retrying.') && spirit.includes('Refresh profiles before retrying.'), 'Spirit and profile deletion preserve an unverifiable 2xx outcome without blind replay copy');
check(spirit.includes("String(data.user_id || '') !== authority.userId") && spirit.includes("String(data.name || '') !== requestedProfileName"), 'Spirit adopts a saved profile only from an exact owner/name receipt');
check(spirit.includes('isIdentityAuthorityCurrent(current)'), 'Spirit fences late results against the current authority generation');
check(spirit.includes('setCustomProfiles([])') && spirit.includes("setSoulText('')"), 'Spirit clears private state when its exact scope changes');
check(spirit.includes("useState<'loading' | 'ready' | 'error'>('loading')") && spirit.includes('Retry loading verified Spirit identity'), 'Spirit distinguishes verified empty identity from retryable load failure');
check(spirit.includes(".eq('user_id', authority.userId)"), 'Spirit server operations filter the captured owner');
check(spirit.includes(".setHeader('Authorization', `Bearer ${authority.accessToken}`)"), 'Spirit server operations bind the captured bearer');
check(!spirit.includes("import('../../../../lib/memoryService')"), 'Spirit artifacts use Chat instead of an ambient memory writer');

for (const source of [overview, terminal, memory, spirit]) {
  check(!source.includes('${exactIdentityAuthority.accessToken}'), 'bearer material is not embedded in request identity strings');
}

console.log(`office agent panels exact-identity smoke passed (${assertions} assertions)`);
