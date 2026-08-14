import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const panel = read('src/screens/circles/tabs/office/AgentPanel.tsx');
const overview = read('src/screens/circles/tabs/office/AgentOverviewPanel.tsx');
const terminal = read('src/screens/circles/tabs/office/AgentTerminalPanels.tsx');
const spirit = read('src/screens/circles/tabs/office/AgentSpiritPanel.tsx');

let assertions = 0;
function check(condition: unknown, message: string): void {
  assertions += 1;
  assert(condition, message);
}

check(panel.includes('identityAuthority?: AgentIdentityExactAuthority | null'), 'AgentPanel accepts one exact identity authority');
check(panel.includes('authorityCircleId !== circleId'), 'AgentPanel rejects a mismatched authority circle');
check(!panel.includes('safeGetUser'), 'AgentPanel never recovers mutable global auth');
check((panel.match(/identityAuthority=\{exactIdentityAuthority\}/g) || []).length === 4, 'AgentPanel threads exact authority to Overview, both Terminal panels, and Spirit');
check((panel.match(/key=\{`\$\{exactIdentityAuthority\?\.userId/g) || []).length === 4, 'private child state remounts at the user boundary');
check(panel.includes('if (!onRenameAgent || !exactIdentityAuthority) return'), 'panel-shell rename fails closed without authority');

check(overview.includes('loadAgentIdentitiesExact(exactIdentityAuthority)'), 'Overview reads the exact identity cache');
check(overview.includes('renameAgentExact(sessionKey, cleanName, capturedAuthority)'), 'Overview exact-renames when no parent callback exists');
check(overview.includes('setMainAgentForProviderExact(sessionKey, agent.providerType, capturedAuthority)'), 'Overview primary-agent mutation is exact-scoped');
check(!/\bloadAgentIdentities\(/.test(overview), 'Overview has no ownerless identity read');
check(!/\brenameAgent\(/.test(overview), 'Overview has no ownerless rename fallback');
check(!/\bsetMainAgentForProvider\(/.test(overview), 'Overview has no ownerless primary-agent mutation');
check(overview.includes('latestIdentityRequestKeyRef.current !== capturedRequestKey'), 'Overview rejects late identity reads and mutations');
check(overview.includes(".setHeader('Authorization', `Bearer ${accessToken}`)"), 'Overview memory status binds the captured bearer');
check(overview.includes('!receipt.localSaved'), 'Overview requires a truthful local identity receipt');

check(terminal.includes('loadAgentIdentitiesExact(exactIdentityAuthority)'), 'Terminal profile reads exact-scoped identity data');
check(terminal.includes('updateAgentIdentityExact(identityKey'), 'Terminal profile writes with captured exact authority');
check(!/\bloadAgentIdentities\(/.test(terminal), 'Terminal profile has no ownerless identity read');
check(!/\bupdateAgentIdentity\(/.test(terminal), 'Terminal profile has no ownerless identity write');
check(terminal.includes('latestIdentityRequestKeyRef.current !== capturedRequestKey'), 'Terminal rejects late profile results');
check(terminal.includes('Sign in to this circle before saving'), 'Terminal fails closed with actionable locked-state copy');
check(terminal.includes('if (!receipt.localSaved)'), 'Terminal requires a truthful exact-save receipt');
check(!terminal.includes('safeGetUser'), 'Quick Terminal never recovers mutable global auth');
check(terminal.includes('identityAuthority?: AgentIdentityExactAuthority | null'), 'both Terminal surfaces accept exact identity authority');
check(terminal.includes('userId: capturedAuthority.userId'), 'SwanBot fallback receives the captured owner');
check(terminal.includes('circleId: capturedAuthority.circleId || circleId'), 'SwanBot fallback remains bound to the captured circle');
check((terminal.match(/isTerminalRequestCurrent\(capturedRequestKey, capturedAuthority\.accessToken\)/g) || []).length >= 7, 'Quick Terminal fences late imports, sends, errors, history, and scroll updates');
check(terminal.includes("setHistory([])") && terminal.includes("setInput('')"), 'Quick Terminal clears private conversation state on authority or agent change');

for (const source of [overview, terminal, spirit]) {
  check(!source.includes('${exactIdentityAuthority.accessToken}'), 'bearer material is not embedded in request identity strings');
}

check(spirit.includes('loadAgentIdentitiesExact(authority)'), 'Spirit hydrates only the exact identity scope');
check(spirit.includes('updateAgentIdentityExact(stableSessionKey, updates, authority)'), 'Spirit identity patches bind captured authority');
check(!/\bloadAgentIdentities\(/.test(spirit), 'Spirit has no ownerless identity read');
check(!/\bupdateAgentIdentity\(/.test(spirit), 'Spirit has no ownerless identity write');
check(!spirit.includes('safeGetUser'), 'Spirit never swaps to mutable global auth');
check((spirit.match(/updateAgentSpirit\([^\n]+authority\)/g) || []).length === 4, 'every Spirit public-row mutation receives captured authority');
check((spirit.match(/isIdentityRequestCurrent\(capturedRequestKey\)/g) || []).length >= 20, 'Spirit guards asynchronous state publication across authority changes');
check(spirit.includes('setCustomProfiles([])') && spirit.includes('setSoulText(\'\')'), 'Spirit clears private state when its exact scope changes');
check(spirit.includes(".eq('user_id', authority.userId)"), 'Spirit server operations filter the captured owner');
check(spirit.includes(".setHeader('Authorization', `Bearer ${authority.accessToken}`)"), 'Spirit server operations bind the captured bearer');

console.log(`office agent panels exact-identity smoke passed (${assertions} assertions)`);
