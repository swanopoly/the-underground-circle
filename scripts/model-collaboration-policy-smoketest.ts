/**
 * Smoke test for modelCollaborationPolicy (PURE).
 *
 * Verifies the "AI models + SwanBot/OpenSwan collaborate" plan:
 *   - a BlackSwan id + a tool turn  -> BlackSwan grounds, a Claude id executes
 *   - a frontier id                 -> it is primary, no forced grounding
 *   - appTrainedModelAvailable      -> flips grounding on for app-work turns
 *   - 'auto'                        -> resolves to a concrete Claude id
 *   - everything fails safe to a concrete claude id (never 'auto', never a key)
 *
 * Pure module: imports VALUES only from blackswanRouting + serviceProfileSouls,
 * which are tsx-safe. No react-native, no supabase.
 *
 * Run: npx tsx scripts/model-collaboration-policy-smoketest.ts
 */

import {
  planModelCollaboration,
  type CollaborationPlan,
} from '../src/lib/modelCollaborationPolicy';
import {
  BLACKSWAN_TOOL_EXECUTOR_MODEL_ID,
  BLACKSWAN_ENDPOINT_MODEL_ID,
  isBlackSwanModel,
} from '../src/lib/blackswanRouting';

let failures = 0;
function assert(label: string, cond: boolean): void {
  if (cond) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${label}`);
  }
}

const isClaude = (m: string | null): boolean => typeof m === 'string' && /^claude-/.test(m);

// ── BlackSwan selected + tools -> grounding=blackswan, executor=a claude id ────
console.log('blackswan + tools (collaboration: BlackSwan grounds, Claude executes)');
{
  const plan: CollaborationPlan = planModelCollaboration({
    selectedModel: BLACKSWAN_ENDPOINT_MODEL_ID, // huggingface_endpoint/cswan801/BlackSwan-v5
    task: 'tools',
    connectedProviders: [],
  });
  assert('groundingModel is BlackSwan', isBlackSwanModel(plan.groundingModel));
  assert('toolExecutorModel is a claude id', isClaude(plan.toolExecutorModel));
  assert(
    'toolExecutorModel === BLACKSWAN_TOOL_EXECUTOR_MODEL_ID',
    plan.toolExecutorModel === BLACKSWAN_TOOL_EXECUTOR_MODEL_ID,
  );
  assert('primaryModel is the claude executor (drives the loop)', isClaude(plan.primaryModel));
  assert('primaryModel is NOT BlackSwan (BlackSwan must not drive tools)', !isBlackSwanModel(plan.primaryModel));
  assert('roles map the executor as executor', plan.roles[plan.toolExecutorModel as string] === 'executor');
  assert('roles map BlackSwan as grounding', plan.roles[plan.groundingModel as string] === 'grounding');
  assert('pattern mentions BlackSwan + the loop', /BlackSwan/.test(plan.pattern) && /loop/.test(plan.pattern));
}

// ── BlackSwan selected + plain chat -> BlackSwan answers directly, no executor ─
console.log('blackswan + chat (stream-first, no forced executor)');
{
  const plan = planModelCollaboration({
    selectedModel: 'blackswan', // local ollama form is still BlackSwan
    task: 'chat',
    connectedProviders: [],
  });
  assert('primaryModel is BlackSwan', isBlackSwanModel(plan.primaryModel));
  assert('groundingModel is BlackSwan', isBlackSwanModel(plan.groundingModel));
  assert('toolExecutorModel is null on a chat turn', plan.toolExecutorModel === null);
  assert('roles map BlackSwan as primary', plan.roles[plan.primaryModel] === 'primary');
}

// ── Frontier selected -> primary=that model, no forced grounding ───────────────
console.log('frontier + chat (primary=model, no forced grounding)');
{
  const plan = planModelCollaboration({
    selectedModel: 'claude-opus-4-8',
    task: 'chat',
    connectedProviders: [],
  });
  assert('primaryModel === the selected frontier model', plan.primaryModel === 'claude-opus-4-8');
  assert('groundingModel is null (not forced)', plan.groundingModel === null);
  assert('toolExecutorModel is null on a chat turn', plan.toolExecutorModel === null);
  assert('roles map the model as primary', plan.roles['claude-opus-4-8'] === 'primary');
  assert('pattern says stream-first', /stream-first/.test(plan.pattern));
}

// ── Frontier selected + tools -> it is primary AND executor, no forced grounding
console.log('frontier + tools (model is its own reliable executor)');
{
  const plan = planModelCollaboration({
    selectedModel: 'claude-sonnet-4-6',
    task: 'tools',
    connectedProviders: [],
  });
  assert('primaryModel === selected model', plan.primaryModel === 'claude-sonnet-4-6');
  assert('toolExecutorModel === selected model (no swap needed)', plan.toolExecutorModel === 'claude-sonnet-4-6');
  assert('groundingModel still null (no app-trained model available)', plan.groundingModel === null);
}

// ── appTrainedModelAvailable flips grounding on (frontier + app-work turn) ─────
console.log('appTrainedModelAvailable flips grounding on');
{
  const off = planModelCollaboration({
    selectedModel: 'claude-opus-4-8',
    task: 'tools',
    appTrainedModelAvailable: false,
    connectedProviders: [],
  });
  const on = planModelCollaboration({
    selectedModel: 'claude-opus-4-8',
    task: 'tools',
    appTrainedModelAvailable: true,
    connectedProviders: [],
  });
  assert('grounding off when app-trained model unavailable', off.groundingModel === null);
  assert('grounding ON when app-trained model available', isBlackSwanModel(on.groundingModel));
  assert('app-trained grounding model is the BlackSwan-v5 endpoint id', on.groundingModel === BLACKSWAN_ENDPOINT_MODEL_ID);
  assert('frontier stays primary even with grounding on', on.primaryModel === 'claude-opus-4-8');
  assert('frontier stays its own executor with grounding on', on.toolExecutorModel === 'claude-opus-4-8');
  assert('pattern describes the BlackSwan-v5 grounding', /BlackSwan-v5/.test(on.pattern));
}

// ── appTrainedModelAvailable does NOT force grounding on a plain chat turn ─────
console.log('appTrainedModelAvailable does not force grounding on plain chat');
{
  const plan = planModelCollaboration({
    selectedModel: 'claude-opus-4-8',
    task: 'chat',
    appTrainedModelAvailable: true,
    connectedProviders: [],
  });
  assert('plain chat stays ungrounded (clean stream-first answer)', plan.groundingModel === null);
}

// ── appTrainedModelAvailable + task 'grounding' brings the model in even on chat-shaped grounding
console.log("appTrainedModelAvailable + task 'grounding' adds the model");
{
  const plan = planModelCollaboration({
    selectedModel: 'claude-sonnet-4-6',
    task: 'grounding',
    appTrainedModelAvailable: true,
    connectedProviders: [],
  });
  assert('grounding turn brings in BlackSwan-v5', plan.groundingModel === BLACKSWAN_ENDPOINT_MODEL_ID);
  assert('grounding turn forces no executor', plan.toolExecutorModel === null);
}

// ── 'auto' resolves to a concrete claude id (fail-safe, never 'auto') ──────────
console.log("'auto' resolves to a concrete model");
{
  const plan = planModelCollaboration({
    selectedModel: 'auto',
    task: 'chat',
    connectedProviders: [],
  });
  assert('primaryModel is concrete (not "auto")', plan.primaryModel !== 'auto' && plan.primaryModel.length > 0);
  assert('auto with no providers lands on a claude id', isClaude(plan.primaryModel));
}

// ── 'auto' + tools still yields a usable executor ─────────────────────────────
console.log("'auto' + tools yields a concrete executor");
{
  const plan = planModelCollaboration({
    selectedModel: 'auto',
    task: 'tools',
    connectedProviders: [],
  });
  assert('primaryModel concrete', plan.primaryModel !== 'auto' && plan.primaryModel.length > 0);
  assert('toolExecutorModel concrete (loop can run)', !!plan.toolExecutorModel && plan.toolExecutorModel !== 'auto');
}

// ── Fail-safe: empty / junk selection never yields 'auto' or empty ────────────
console.log('fail-safe on empty / whitespace selection');
{
  const empty = planModelCollaboration({ selectedModel: '', task: 'chat', connectedProviders: [] });
  const blank = planModelCollaboration({ selectedModel: '   ', task: 'tools', connectedProviders: [] });
  assert('empty selection -> concrete claude primary', isClaude(empty.primaryModel));
  assert('blank selection -> concrete claude primary', isClaude(blank.primaryModel));
  assert('blank+tools -> concrete executor', !!blank.toolExecutorModel && blank.toolExecutorModel !== 'auto');
}

// ── Never leaks a secret-looking value: plan only ever holds model ids ─────────
console.log('plan carries only model ids (no secrets)');
{
  const plan = planModelCollaboration({
    selectedModel: BLACKSWAN_ENDPOINT_MODEL_ID,
    task: 'agents',
    appTrainedModelAvailable: true,
    connectedProviders: ['anthropic', 'openrouter'],
  });
  const allValues = [
    plan.primaryModel,
    plan.groundingModel,
    plan.toolExecutorModel,
    ...Object.keys(plan.roles),
  ].filter(Boolean) as string[];
  // crude secret sniff: real keys contain sk-/whsec_/hf_ patterns; model ids do not.
  const looksSecret = (v: string) => /sk-|whsec_|hf_[A-Za-z0-9]{8,}|Bearer\s/.test(v);
  assert('no plan value looks like a secret', allValues.every((v) => !looksSecret(v)));
  assert('agents turn (BlackSwan) still routes tools to a claude executor', isClaude(plan.toolExecutorModel));
}

console.log('');
if (failures === 0) {
  console.log('ALL PASS — model-collaboration-policy smoke');
} else {
  console.error(`${failures} FAILURE(S) — model-collaboration-policy smoke`);
  process.exit(1);
}
