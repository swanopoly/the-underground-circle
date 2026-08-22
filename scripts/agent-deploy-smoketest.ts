/**
 * Smoke test for the Phase-3 mass-agent-deploy PURE layers:
 *   - agentDeployPolicy   (caps, cost estimate, approval gate)
 *   - agentDeployPlan     (uniform / individual / max plan shapes)
 *   - agentDeployModelPolicy (resolveDeployModel: auto + fail-closed bridge)
 *
 * The impure orchestrator (agentDeployOrchestrator) is intentionally NOT
 * loaded here — it pulls in supabase / react-native-adjacent modules that
 * tsx/esbuild can't load.
 *
 * Run: npx tsx scripts/agent-deploy-smoketest.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  MAX_AGENTS_PER_DEPLOY,
  PER_DEPLOY_COST_CAP_USD,
  DEPLOYED_AGENTS_ARE_TRANSIENT,
  MAX_CONCURRENT_DEPLOY_LAUNCHES,
  capDeployCount,
  estimateDeployCostUsd,
  shouldRequireApproval,
} from '../src/lib/agentDeployPolicy';
import { buildAgentDeployPlan } from '../src/lib/agentDeployPlan';
import { resolveDeployModel } from '../src/lib/agentDeployModelPolicy';
import {
  buildSubagentBridgeTask,
  detectSubagentCapability,
  listSubagentCapabilities,
} from '../src/lib/subagentCapabilities';

let failures = 0;
function assert(label: string, cond: boolean): void {
  if (cond) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${label}`);
  }
}

// ── Policy constants ──────────────────────────────────────────────────────────
console.log('policy constants');
assert('MAX_AGENTS_PER_DEPLOY === 50', MAX_AGENTS_PER_DEPLOY === 50);
assert('PER_DEPLOY_COST_CAP_USD === 10', PER_DEPLOY_COST_CAP_USD === 10);
assert('DEPLOYED_AGENTS_ARE_TRANSIENT === true', DEPLOYED_AGENTS_ARE_TRANSIENT === true);
assert('MAX_CONCURRENT_DEPLOY_LAUNCHES is a bound in 1..MAX', MAX_CONCURRENT_DEPLOY_LAUNCHES >= 1 && MAX_CONCURRENT_DEPLOY_LAUNCHES <= MAX_AGENTS_PER_DEPLOY);

// ── capDeployCount: clamps 1..MAX ─────────────────────────────────────────────
console.log('capDeployCount');
{
  const over = capDeployCount(200);
  assert('200 clamps to 50', over.count === 50);
  assert('200 reports truncated', over.truncated === true);

  const exact = capDeployCount(50);
  assert('50 stays 50', exact.count === 50);
  assert('50 not truncated', exact.truncated === false);

  const mid = capDeployCount(7);
  assert('7 stays 7', mid.count === 7 && mid.truncated === false);

  const zero = capDeployCount(0);
  assert('0 clamps up to 1', zero.count === 1 && zero.truncated === false);

  const neg = capDeployCount(-5);
  assert('-5 clamps up to 1', neg.count === 1);

  const nan = capDeployCount(Number.NaN);
  assert('NaN clamps to 1', nan.count === 1);

  const frac = capDeployCount(3.9);
  assert('3.9 floors to 3', frac.count === 3);
}

// ── estimateDeployCostUsd: sane, scales with count, model-aware ───────────────
console.log('estimateDeployCostUsd');
{
  const oneSonnet = estimateDeployCostUsd(['claude-sonnet-4-6']);
  assert('1 sonnet agent > 0', oneSonnet > 0);
  // 1 agent * 3 turns * (4000*3.75 + 1500*18.75)/1e6 ≈ $0.129 — well under a dollar.
  assert('1 sonnet agent is cents, not dollars', oneSonnet < 1 && oneSonnet > 0.01);

  const tenSonnet = estimateDeployCostUsd(new Array(10).fill('claude-sonnet-4-6'));
  assert('10 agents ~= 10x one agent', Math.abs(tenSonnet - oneSonnet * 10) < 1e-9);

  // Opus is pricier than Sonnet per token → higher estimate for same shape.
  const oneOpus = estimateDeployCostUsd(['claude-opus-4-8']);
  assert('opus costs more than sonnet', oneOpus > oneSonnet);

  // Free/local models (blackswan, ollama) estimate to 0.
  const free = estimateDeployCostUsd(['ollama', 'blackswan']);
  assert('local/free models estimate to 0', free === 0);

  // Empty list → 0, no throw.
  assert('empty model list → 0', estimateDeployCostUsd([]) === 0);

  // Custom opts scale the estimate up.
  const heavy = estimateDeployCostUsd(['claude-sonnet-4-6'], {
    avgTurnsPerAgent: 30,
    avgInTokens: 40000,
    avgOutTokens: 15000,
  });
  assert('heavier opts → larger estimate', heavy > oneSonnet);

  // A full 50-agent opus deploy should land in a plausibly large band
  // (> the $10 cap) so the approval gate has something real to trip on.
  const fullOpus = estimateDeployCostUsd(new Array(50).fill('claude-opus-4-8'), {
    avgTurnsPerAgent: 8,
    avgInTokens: 12000,
    avgOutTokens: 6000,
  });
  assert('50 heavy opus agents exceed $10', fullOpus > 10);
}

// ── shouldRequireApproval: > $10 OR > 10 agents ───────────────────────────────
console.log('shouldRequireApproval');
{
  const cheapSmall = shouldRequireApproval({ count: 5, estimateUsd: 2 });
  assert('5 agents @ $2 → no approval', cheapSmall.required === false);

  const overCost = shouldRequireApproval({ count: 5, estimateUsd: 12 });
  assert('$12 → approval required (cost)', overCost.required === true);
  assert('cost reason mentions cap', /cost cap|per-deploy cap/i.test(overCost.reason));

  const overCount = shouldRequireApproval({ count: 11, estimateUsd: 1 });
  assert('11 agents → approval required (count)', overCount.required === true);
  assert('count reason mentions threshold', /threshold/i.test(overCount.reason));

  const boundaryCost = shouldRequireApproval({ count: 1, estimateUsd: 10 });
  assert('exactly $10 → no approval (strict >)', boundaryCost.required === false);

  const boundaryCount = shouldRequireApproval({ count: 10, estimateUsd: 1 });
  assert('exactly 10 agents → no approval (strict >)', boundaryCount.required === false);

  const both = shouldRequireApproval({ count: 50, estimateUsd: 40 });
  assert('50 agents @ $40 → approval required', both.required === true);
}

// ── buildAgentDeployPlan: uniform / individual / max ──────────────────────────
console.log('buildAgentDeployPlan');
{
  // uniform → same model on every agent
  const uniform = buildAgentDeployPlan({ mode: 'uniform', count: 3, model: 'claude-sonnet-4-6', role: 'coder', prompt: 'do x' });
  assert('uniform mode preserved', uniform.mode === 'uniform');
  assert('uniform has 3 specs', uniform.specs.length === 3);
  assert('uniform all same model', uniform.specs.every((s) => s.model === 'claude-sonnet-4-6'));
  assert('uniform indices 0..2', uniform.specs.map((s) => s.index).join(',') === '0,1,2');
  assert('uniform role/prompt threaded', uniform.specs[0].role === 'coder' && uniform.specs[0].prompt === 'do x');
  assert('uniform not truncated', uniform.truncated === false && uniform.cappedCount === 3);

  // individual → perAgentModels[i] with fallback to model
  const individual = buildAgentDeployPlan({
    mode: 'individual',
    count: 3,
    model: 'claude-haiku-4-5',
    perAgentModels: ['claude-opus-4-8', 'claude-sonnet-4-6'], // 3rd missing → fallback
  });
  assert('individual mode preserved', individual.mode === 'individual');
  assert('individual[0] = opus', individual.specs[0].model === 'claude-opus-4-8');
  assert('individual[1] = sonnet', individual.specs[1].model === 'claude-sonnet-4-6');
  assert('individual[2] falls back to model', individual.specs[2].model === 'claude-haiku-4-5');

  const specialized = buildAgentDeployPlan({
    mode: 'individual',
    count: 4,
    role: 'coder',
    perAgentRoles: ['researcher', '  designer  ', null, 'security'],
  });
  assert('individual preserves exact per-agent specialty roles', specialized.specs.map((s) => s.role).join(',') === 'researcher,designer,coder,security');

  const uniformSpecialty = buildAgentDeployPlan({
    mode: 'uniform',
    count: 2,
    role: '  tester  ',
  });
  assert('uniform trims and preserves one specialty role', uniformSpecialty.specs.every((s) => s.role === 'tester'));

  // max → fill to ceiling regardless of requested count
  const max = buildAgentDeployPlan({ mode: 'max', count: 3, model: 'claude-sonnet-4-6' });
  assert('max mode preserved', max.mode === 'max');
  assert('max fills to ceiling', max.specs.length === MAX_AGENTS_PER_DEPLOY);
  assert('max all same model', max.specs.every((s) => s.model === 'claude-sonnet-4-6'));
  assert('max requestedCount reflects ceiling', max.requestedCount === MAX_AGENTS_PER_DEPLOY);

  // over-ceiling request is clamped + truncated
  const huge = buildAgentDeployPlan({ mode: 'uniform', count: 999, model: 'claude-sonnet-4-6' });
  assert('999 clamps to 50 specs', huge.specs.length === 50);
  assert('999 reports truncated', huge.truncated === true);
  assert('999 requestedCount preserved', huge.requestedCount === 999);

  // no model anywhere → still produces a (default) non-empty plan
  const noModel = buildAgentDeployPlan({ mode: 'uniform', count: 2 });
  assert('no-model plan still has specs', noModel.specs.length === 2);
  assert('no-model plan has a non-empty model', noModel.specs.every((s) => !!s.model));
}

// ── specialty/SOUL bridge handoff ────────────────────────────────────────────
console.log('specialty/SOUL bridge handoff');
{
  const capabilities = listSubagentCapabilities();
  assert('every launch specialty has an explicit SOUL', capabilities.every((capability) => !!capability.spiritId));
  assert('every launch specialty has a skill bundle', capabilities.every((capability) => !!capability.skillBundleId));

  const securityTask = buildSubagentBridgeTask('security', 'Audit the authorization boundary.');
  assert('bridge handoff names exact specialty', securityTask.includes('Specialty: Security (security)'));
  assert('bridge handoff names exact SOUL', securityTask.includes('SOUL: security'));
  assert('bridge handoff names exact skill bundle', securityTask.includes('Skill bundle: seceng-harden-and-threatmodel'));
  assert('bridge handoff includes specialty knowledge', securityTask.includes('SPECIALTY KNOWLEDGE'));
  assert('bridge handoff preserves exact task brief', securityTask.endsWith('TASK\nAudit the authorization boundary.'));
  assert('bridge handoff preserves approval/tool boundary', securityTask.includes('not permission to bypass approval'));

  const unknownTask = buildSubagentBridgeTask('not-a-role', 'Build the feature.');
  assert('unknown bridge role falls back visibly to Builder', unknownTask.includes('Specialty: Builder (coder)'));
  assert('unknown bridge role still has the coder SOUL', unknownTask.includes('SOUL: sr-engineer'));

  const exactReviewer = detectSubagentCapability('[specialty:reviewer] Design a new settings screen.');
  assert('explicit specialty directive wins over task-keyword inference', exactReviewer?.role === 'reviewer');
  const invalidDirective = detectSubagentCapability('[specialty:not-real] Research provider options.');
  assert('invalid specialty directive falls back to safe task inference', invalidDirective?.role === 'researcher');
}

// ── production launch-surface wiring ─────────────────────────────────────────
console.log('production launch-surface wiring');
{
  const root = resolve(__dirname, '..');
  const modal = readFileSync(resolve(root, 'src/screens/circles/tabs/chat/SpawnAgentsModal.tsx'), 'utf8');
  const chat = readFileSync(resolve(root, 'src/screens/circles/tabs/ChatTab.tsx'), 'utf8');
  const officeGateway = readFileSync(resolve(root, 'src/screens/circles/tabs/office/AgentGatewayPanels.tsx'), 'utf8');
  const massDeploy = chat.slice(chat.indexOf('<SpawnAgentsModal'), chat.indexOf('<ChatThreadHeader'));

  assert('Chat gives mass deploy exact Circle scope', massDeploy.includes('circleId={circleId}'));
  assert('Chat gives mass deploy exact user scope', massDeploy.includes('userId={currentUserId}'));
  assert('mass deploy plan carries per-agent specialties', modal.includes('perAgentRoles: resolved.map((r) => r.role)'));
  assert('bridge launch uses the specialty handoff', modal.includes('buildSubagentBridgeTask(rr.role, rr.task)'));
  assert('mass deploy owns a synchronous single-flight gate', modal.includes('if (spawnInFlightRef.current) return;') && modal.includes('spawnInFlightRef.current = true;'));
  assert('uniform launcher visibly selects specialty + SOUL + skill', modal.includes('SPECIALTY · SOUL + SKILL'));
  assert('individual launcher exposes per-agent specialty selection', modal.includes('updateSlot(slot.id, { role: choice.role })'));
  assert('Office popup exposes an exact subagent specialty selector', officeGateway.includes('setSpawnRole(specialty.role)'));
  assert('Office popup carries the specialty directive into Chat', officeGateway.includes('`[specialty:${selectedSpawnSpecialty.role}] Launch a ${selectedSpawnSpecialty.displayName} specialist subagent'));
  assert('Office popup discloses linked SOUL and skill bundle', officeGateway.includes('SOUL {selectedSpawnSpecialty.spiritId} · SKILL {selectedSpawnSpecialty.skillBundleId}'));
}

// ── resolveDeployModel: auto resolution + fail-closed bridge ──────────────────
console.log('resolveDeployModel');
{
  // 'auto' resolves to a concrete catalog model (sonnet default w/ no providers)
  const autoWeb = resolveDeployModel('auto', { connectedProviders: [], channel: 'web' });
  assert('auto resolves ok on web', autoWeb.ok === true);
  assert('auto resolves to a concrete (non-auto) id', autoWeb.model.toLowerCase() !== 'auto' && autoWeb.model.length > 0);

  // exact catalog claude id is allowed on both channels
  const sonnetWeb = resolveDeployModel('claude-sonnet-4-6', { connectedProviders: [], channel: 'web' });
  assert('sonnet ok on web', sonnetWeb.ok === true && sonnetWeb.model === 'claude-sonnet-4-6');

  const sonnetBridge = resolveDeployModel('claude-sonnet-4-6', { connectedProviders: [], channel: 'bridge' });
  assert('sonnet ok on bridge (claude id)', sonnetBridge.ok === true);

  // FAIL CLOSED: non-claude catalog id over the bridge channel
  const gptBridge = resolveDeployModel('gpt-5.5', { connectedProviders: ['openai'], channel: 'bridge' });
  assert('gpt-5.5 FAILS CLOSED on bridge', gptBridge.ok === false);
  assert('gpt-5.5 bridge reason mentions claude/bridge', /claude|bridge/i.test(gptBridge.reason || ''));
  assert('gpt-5.5 bridge does NOT swap the model', gptBridge.model === 'gpt-5.5');

  // ...but the same non-claude id is fine on the web channel
  const gptWeb = resolveDeployModel('gpt-5.5', { connectedProviders: ['openai'], channel: 'web' });
  assert('gpt-5.5 ok on web', gptWeb.ok === true && gptWeb.model === 'gpt-5.5');

  // provider-prefixed claude id passes the bridge claude check
  const orClaudeBridge = resolveDeployModel('anthropic/claude-opus-4-8', { connectedProviders: [], channel: 'bridge' });
  assert('anthropic/claude-opus-4-8 ok on bridge', orClaudeBridge.ok === true);

  // alias normalization: prefix token normalized, model id untouched
  const hf = resolveDeployModel('hugging_face/Qwen/Qwen3-32B', { connectedProviders: ['huggingface'], channel: 'web' });
  assert('hugging_face prefix normalized to huggingface', hf.ok === true && hf.model.startsWith('huggingface/'));
  assert('hugging_face model id portion untouched', hf.model === 'huggingface/Qwen/Qwen3-32B');

  const zai = resolveDeployModel('z_ai/glm-5', { connectedProviders: ['zai'], channel: 'web' });
  assert('z_ai prefix normalized to zai', zai.ok === true && zai.model === 'zai/glm-5');

  // unknown/garbage id fails closed even on web (never launches)
  const garbage = resolveDeployModel('totally-not-a-real-model', { connectedProviders: [], channel: 'web' });
  assert('unknown bare id fails closed on web', garbage.ok === false);

  // HOUSE INVARIANT: NO Grok / xAI anywhere. A structurally-valid
  // provider-prefixed passthrough id must NOT sneak an xAI model past the
  // gate on the web channel (the head 'openrouter' + non-empty tail would
  // otherwise satisfy the structural check).
  const grokOr = resolveDeployModel('openrouter/x-ai/grok-2', { connectedProviders: ['openrouter'], channel: 'web' });
  assert('openrouter/x-ai/grok-2 FAILS CLOSED on web (banned vendor)', grokOr.ok === false);
  assert('grok reason names the banned vendor', /grok|xai/i.test(grokOr.reason || ''));
  const grokOr2 = resolveDeployModel('openrouter/grok', { connectedProviders: ['openrouter'], channel: 'web' });
  assert('openrouter/grok FAILS CLOSED on web (banned vendor)', grokOr2.ok === false);
  const grokBare = resolveDeployModel('grok-2', { connectedProviders: ['openrouter'], channel: 'web' });
  assert('bare grok-2 FAILS CLOSED on web', grokBare.ok === false);
  const xaiHead = resolveDeployModel('xai/grok-3', { connectedProviders: ['openrouter'], channel: 'web' });
  assert('xai/grok-3 FAILS CLOSED on web', xaiHead.ok === false);
  const grokBridge = resolveDeployModel('openrouter/x-ai/grok-2', { connectedProviders: ['openrouter'], channel: 'bridge' });
  assert('openrouter/x-ai/grok-2 FAILS CLOSED on bridge too', grokBridge.ok === false);
  // Guard against over-eager matching: a legit non-xAI catalog id whose name
  // merely contains letters must still resolve (no false ban).
  const notGrok = resolveDeployModel('openrouter/anthropic/claude-sonnet-4-6', { connectedProviders: ['openrouter'], channel: 'web' });
  assert('legit openrouter/anthropic/claude id is NOT banned', notGrok.ok === true);

  // empty id fails closed
  const empty = resolveDeployModel('', { connectedProviders: [], channel: 'web' });
  assert('empty id fails closed', empty.ok === false);

  // 'auto' over the bridge must still be a claude id (sonnet default is) → ok
  const autoBridge = resolveDeployModel('auto', { connectedProviders: [], channel: 'bridge' });
  assert('auto (sonnet default) ok on bridge', autoBridge.ok === true && /claude/i.test(autoBridge.model));
}

console.log('');
if (failures === 0) {
  console.log('agent-deploy smoke: ALL PASS');
  process.exit(0);
} else {
  console.error(`agent-deploy smoke: ${failures} FAILURE(S)`);
  process.exit(1);
}
