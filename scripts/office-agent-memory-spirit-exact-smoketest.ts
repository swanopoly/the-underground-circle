import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const memory = read('src/screens/circles/tabs/office/AgentMemoryPanel.tsx');
const spirit = read('src/screens/circles/tabs/office/AgentSpiritPanel.tsx');

let assertions = 0;
function check(condition: unknown, message: string): void {
  assertions += 1;
  assert(condition, message);
}

for (const marker of [
  'identityAuthority: AgentMemoryPanelAuthority | null',
  'isIdentityAuthorityCurrent: AgentMemoryPanelAuthorityFence',
  'Number.isSafeInteger(generation)',
  'generation <= 0',
  'isIdentityAuthorityCurrent(authority)',
  ".setHeader('Authorization', bearer)",
  'if (result.error) throw result.error',
  'The memory change did not return exactly one receipt.',
  'The memory change returned a mismatched receipt.',
  ".eq('circle_id', authority.circleId)",
  ".eq('user_id', authority.userId)",
  ".select('id, circle_id, user_id, scope, content, is_active, pinned, retrieval_mode, importance')",
  "row.is_active === false",
  "row.pinned === nextPinned",
  "row.retrieval_mode === 'startup'",
  'row.content === editContent',
  'INSPECT IDENTITY DETAILS',
]) {
  check(memory.includes(marker), `Memory exact architecture includes ${marker}`);
}
check(!memory.includes("import('../../../../lib/agentMemory')"), 'Memory does not use ambient management helpers');
check(!memory.includes("import('../../../../lib/memoryActions')"), 'Memory pin and promote do not use ambient helpers');
check(!memory.includes("import('../../../../lib/memoryService')"), 'Memory does not use ambient manual-write helpers');
check(!memory.includes('<ScrollView'), 'Memory leaves vertical scrolling to the Agent panel shell');
check(memory.includes('onOpenInChat(request.slice(0, 3_500))'), 'manual writes are truthfully handed to a bounded Chat draft');
check(memory.includes('Show me the exact memory receipt before claiming it is saved.'), 'reasoning-standard handoff preserves receipt truth');
check(memory.indexOf('INSPECT IDENTITY DETAILS') < memory.indexOf('CANONICAL SUBJECT'), 'raw subject ids stay behind disclosure');

for (const marker of [
  'identityAuthority: AgentSpiritPanelAuthority | null',
  'isIdentityAuthorityCurrent: AgentSpiritPanelAuthorityFence',
  'Number.isSafeInteger(generation)',
  'exactIdentityAuthority.generation',
  'isIdentityAuthorityCurrent(current)',
  'syncAgentIdentitiesFromServerExact(authority)',
  "useState<'loading' | 'ready' | 'error'>('loading')",
  'Retry loading verified Spirit identity',
  'No assignment or risk posture is being inferred from an empty response.',
  'receipt.serverSaved',
  ".select('id, user_id')",
  'deleteReceipts.length !== 1',
  "String(deleteReceipts[0]?.id || '') !== profileId",
  ".select('id, circle_id, owner_id, spirit, spirit_emoji')",
  'receipts.length !== 1',
  '(receipts[0]?.spirit ?? null) !== spirit',
  'CONTINUE IN CHAT',
  "onOpenInChat([",
]) {
  check(spirit.includes(marker), `Spirit exact architecture includes ${marker}`);
}
check(!spirit.includes("import('../../../../lib/memoryService')"), 'Spirit artifacts never use an ambient memory writer');
check(!spirit.includes('.ilike('), 'Spirit never aliases a live session to a public row by mutable display name');
check(!spirit.includes('updateAgentSpirit('), 'Spirit never accepts a zero-row public assignment helper as success');
check(
  spirit.indexOf(".select('id, user_id')") < spirit.indexOf('setCustomProfiles(prev => prev.filter'),
  'Spirit removes local profile state only after the exact delete receipt',
);
check(
  spirit.indexOf('deleteReceipts.length !== 1') < spirit.indexOf('persistSpiritSelection(null, null, {'),
  'Spirit clears an active assignment only after the exact profile delete receipt',
);

console.log(`office agent Memory and Spirit exact smoke passed (${assertions} assertions)`);
