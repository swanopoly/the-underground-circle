import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const customize = read('src/screens/circles/tabs/office/CustomizePanel.tsx');
const circleOffice = read('src/lib/circleOffice.ts');
const runtime = read('src/lib/openswanToolRuntime.ts');
const spawn = read('src/components/SpawnAgentPanel.tsx');

let assertions = 0;
function check(condition: boolean, label: string) {
  assertions += 1;
  if (!condition) throw new Error(`FAIL: ${label}`);
  console.log(`  ok  ${label}`);
}

function section(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) throw new Error(`Missing section: ${start} -> ${end}`);
  return source.slice(startIndex, endIndex);
}

const customizeSave = section(customize, 'const savePublishedSpirit = useCallback(', '  // Load personality');
check(customizeSave.includes('updatePublishedAgentSpiritExact({'), 'Customize uses the atomic Spirit command owner');
check(customizeSave.includes('receipt.ok || !receipt.localSaved || !receipt.serverSaved'), 'Customize requires server and local receipt proof');
check(customizeSave.includes('receipt.serverSaved && !receipt.localSaved'), 'Customize distinguishes durable save from a local refresh failure');
check(customizeSave.includes("receipt.error === 'outcome_unknown'"), 'Customize refreshes before replaying an unverifiable Spirit outcome');
check(customizeSave.includes('setSpiritReloadGeneration(value => value + 1)'), 'Customize refreshes exact public truth after a partial local receipt');
check(customizeSave.includes('spiritMutationRef.current === mutationKey'), 'Customize serializes one exact agent scope');
check(customize.includes(".eq('id', exactDbAgentId)"), 'Customize loads an exact durable agent id');
check(!customize.includes(".ilike('name', agentName)"), 'Customize never joins a published agent by display name');
check(!customize.includes('updateAgentSpirit('), 'Customize cannot reach the retired public-only writer');
check(customize.includes("minWidth: 44, minHeight: 44"), 'Customize keeps the destructive Spirit clear target touch-accessible');

const retiredWriter = section(circleOffice, 'export async function updateAgentSpirit', '// ─── Update gateway');
check(retiredWriter.includes("return { error: 'atomic_spirit_assignment_required' }"), 'legacy Circle Office writer fails closed');
check(!retiredWriter.includes(".from('circle_office_agents')"), 'legacy Circle Office writer performs no public-only mutation');

const runtimeDispatchStart = runtime.lastIndexOf("case 'agent.set_spirit':");
const runtimeDispatchEnd = runtime.indexOf("case 'memory.pin':", runtimeDispatchStart);
if (runtimeDispatchStart < 0 || runtimeDispatchEnd < 0) throw new Error('Missing agent.set_spirit dispatch section');
const runtimeWriter = runtime.slice(runtimeDispatchStart, runtimeDispatchEnd);
check(runtimeWriter.includes('No Spirit data was changed.'), 'OpenSwan reports the fail-closed Spirit outcome');
check(!runtimeWriter.includes(".from('circle_office_agents')"), 'OpenSwan has no ambient public-only Spirit write');

const deploy = section(spawn, 'const handleDeploy = useCallback(', '  // ── Render steps');
check(spawn.includes('useExactCircleAuthority(circleId)'), 'Spawn captures one surface-neutral immutable Circle bearer generation');
check(deploy.includes('publishAgentToCircle({') && deploy.includes('}, authority);'), 'Spawn publishes with captured authority');
check(deploy.includes(".eq('id', publishedAgentId)"), 'Spawn extended config targets the exact published UUID');
check(deploy.includes(".eq('circle_id', authority.circleId)"), 'Spawn config stays in the captured circle');
check(deploy.includes(".eq('owner_id', authority.userId)"), 'Spawn config stays with the captured owner');
check(deploy.includes(".select('id, circle_id, owner_id, is_published, current_goal, model_name, status')"), 'Spawn requires a structured config receipt');
check(deploy.includes('updateAgentIdentityExact(publishedAgentId'), 'Spawn writes private identity through the exact CAS owner');
check(deploy.includes('updatePublishedAgentSpiritExact({'), 'Spawn atomically projects Spirit into public and private truth');
check(deploy.includes('if (!spiritReceipt.serverSaved)'), 'Spawn requires durable Spirit proof');
check((deploy.match(/error === 'outcome_unknown'/g) || []).length === 2, 'Spawn stops after unverifiable identity or Spirit outcomes');
check(deploy.includes('do not deploy it again'), 'Spawn truthfully warns on a durable save with local cache failure');
check(!deploy.includes('updateAgentIdentity(') && !deploy.includes('updateAgentSpirit('), 'Spawn has no legacy split writer');
check(!deploy.includes('boundAiProvider:'), 'Spawn cannot overwrite the RPC-owned primary provider lane');

console.log(`\nPASS: ${assertions} published Spirit single-writer assertions`);
