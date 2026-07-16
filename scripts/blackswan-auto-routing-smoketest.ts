/**
 * blackswan-auto-routing-smoketest — verifies the P8 BlackSwan-aware Auto
 * lane (docs/CHAT_UX_INTEGRATION_UPGRADE_PLAN.md): the app-trained model
 * wins exactly the lanes its training covers (status / memory / casual /
 * social + app-grounded light questions), never tool/heavy work; explicit
 * picks stay authoritative; failover chains and the executor swap keep the
 * lane safe; the grounding contract emits for BlackSwan routes.
 *
 * Run: npm run smoke:blackswan-auto-routing
 */

import {
  explainAutoModelChoice,
  getModelFailoverChain,
  resolveModelForProfile,
  resolveModelForSoul,
} from '../src/lib/serviceProfileSouls';
import {
  BLACKSWAN_ENDPOINT_MODEL_ID,
  BLACKSWAN_PUBLIC_MODEL_ID,
  buildBlackSwanGroundingBlock,
  describeBlackSwanEscalation,
  looksLikeAppGroundedMessage,
  resolveComputerTaskPlannerModel,
  resolveOpenSwanToolLoopModel,
  shouldEscalateBlackSwanToFrontier,
} from '../src/lib/blackswanRouting';
import { getModelCapabilityFlags } from '../src/lib/modelCapabilities';

let failures = 0;

function fail(message: string) {
  failures += 1;
  console.error('FAIL:', message);
}

function pass(message: string) {
  console.log('pass:', message);
}

function expect(condition: unknown, message: string) {
  if (!condition) fail(message);
}

const WITH_BLACKSWAN = new Set(['anthropic', 'blackswan']);
const WITHOUT_BLACKSWAN = new Set(['anthropic']);

// ── App-grounded lanes route to BlackSwan when connected ────────────────────
{
  for (const intent of ['status', 'memory', 'casual', 'social'] as const) {
    const model = resolveModelForSoul('sr-engineer', 'auto', intent, 'simple', false, false, WITH_BLACKSWAN);
    expect(model === BLACKSWAN_ENDPOINT_MODEL_ID, `auto ${intent} + blackswan connected → endpoint id (got ${model})`);
  }
  pass('status/memory/casual/social lanes → BlackSwan endpoint');
}

// ── Without the integration, lanes are unchanged ────────────────────────────
{
  const model = resolveModelForSoul('sr-engineer', 'auto', 'status', 'simple', false, false, WITHOUT_BLACKSWAN);
  expect(model !== BLACKSWAN_ENDPOINT_MODEL_ID && model !== BLACKSWAN_PUBLIC_MODEL_ID,
    'no blackswan integration → lane falls through to the normal ladder');
  expect(model === 'claude-haiku-4-5', `status without blackswan stays on Haiku (got ${model})`);
  pass('lane requires the connected integration');
}

// ── App-grounded light questions route to BlackSwan; general/heavy never ────
{
  const grounded = resolveModelForProfile('auto', null, 'question', WITH_BLACKSWAN, 'simple', { appGroundedHint: true });
  expect(grounded === BLACKSWAN_ENDPOINT_MODEL_ID, `app-grounded light question → BlackSwan (got ${grounded})`);

  const general = resolveModelForProfile('auto', null, 'question', WITH_BLACKSWAN, 'simple', { appGroundedHint: false });
  expect(general !== BLACKSWAN_ENDPOINT_MODEL_ID, 'general question never routes to the app specialist');

  const heavy = resolveModelForProfile('auto', null, 'question', WITH_BLACKSWAN, 'complex', { appGroundedHint: true });
  expect(heavy === 'claude-sonnet-4-6', `heavy question stays on Sonnet even when app-grounded (got ${heavy})`);
  pass('question lane: grounded-light only');
}

// ── Work intents never route to BlackSwan ───────────────────────────────────
{
  for (const intent of ['build', 'debug', 'review', 'research', 'architect', 'browser'] as const) {
    const model = resolveModelForSoul('sr-engineer', 'auto', intent, 'complex', false, false, WITH_BLACKSWAN);
    expect(
      model !== BLACKSWAN_ENDPOINT_MODEL_ID && model !== BLACKSWAN_PUBLIC_MODEL_ID,
      `auto ${intent} never routes to BlackSwan (got ${model})`,
    );
  }
  pass('coding/research/browser intents stay on frontier models');
}

// ── Explicit picks always win ───────────────────────────────────────────────
{
  expect(
    resolveModelForSoul('sr-engineer', 'claude-opus-4-8', 'status', 'simple', false, false, WITH_BLACKSWAN) === 'claude-opus-4-8',
    'explicit pick overrides the BlackSwan lane',
  );
  expect(
    resolveModelForSoul('sr-engineer', BLACKSWAN_PUBLIC_MODEL_ID, 'build', 'complex', false, false, WITHOUT_BLACKSWAN) === BLACKSWAN_PUBLIC_MODEL_ID,
    'explicit BlackSwan pick is honored (executor swap happens at the loop, not here)',
  );
  pass('explicit picks stay authoritative');
}

// ── Only ONE BlackSwan: v5 on the dedicated endpoint ────────────────────────
// The local Ollama weight is retired from the catalog; stale persisted picks
// normalize to cswan801/BlackSwan-v5 on the endpoint — the one sanctioned
// exception to explicit-picks-pass-verbatim (same-family upgrade only).
{
  expect(
    resolveModelForSoul('sr-engineer', 'blackswan', 'build', 'complex', false, false, WITHOUT_BLACKSWAN) === BLACKSWAN_ENDPOINT_MODEL_ID,
    'stale local pick "blackswan" normalizes to the v5 endpoint',
  );
  expect(
    resolveModelForSoul('sr-engineer', 'ollama/blackswan', 'status', 'simple', false, false, WITH_BLACKSWAN) === BLACKSWAN_ENDPOINT_MODEL_ID,
    'stale local pick "ollama/blackswan" normalizes to the v5 endpoint',
  );
  expect(
    BLACKSWAN_ENDPOINT_MODEL_ID === 'huggingface_endpoint/cswan801/BlackSwan-v5',
    'the one BlackSwan is cswan801/BlackSwan-v5 (dedicated endpoint id pinned)',
  );
  pass('only cswan801/BlackSwan-v5 is ever used');
}

// ── Failover chains cover both hosted ids ───────────────────────────────────
{
  for (const id of [BLACKSWAN_ENDPOINT_MODEL_ID, BLACKSWAN_PUBLIC_MODEL_ID]) {
    const chain = getModelFailoverChain(id);
    expect(chain.length >= 2 && chain.includes('claude-sonnet-4-6'), `failover chain for ${id} degrades to Sonnet`);
  }
  pass('failover chains defined for both hosted BlackSwan ids');
}

// ── App-domain detector precision ───────────────────────────────────────────
{
  expect(looksLikeAppGroundedMessage('what is my circle streak this week?'), 'streak question → app-grounded');
  expect(looksLikeAppGroundedMessage('summarize the proof of work from yesterday'), 'proof of work → app-grounded');
  expect(looksLikeAppGroundedMessage('who missed check-ins?'), 'check-ins → app-grounded');
  expect(!looksLikeAppGroundedMessage('what is the capital of France?'), 'general knowledge → not app-grounded');
  expect(!looksLikeAppGroundedMessage('refactor this function to use async/await'), 'coding ask → not app-grounded');
  expect(!looksLikeAppGroundedMessage(''), 'empty → not app-grounded');
  pass('app-domain detector: high precision');
}

// ── Executor swap + grounding contract (collaboration split) ────────────────
{
  expect(
    resolveOpenSwanToolLoopModel(BLACKSWAN_ENDPOINT_MODEL_ID, ['memory.search']) === 'claude-haiku-4-5',
    'tool turns swap BlackSwan for the executor',
  );
  expect(
    resolveOpenSwanToolLoopModel('claude-sonnet-4-6', ['memory.search']) === 'claude-sonnet-4-6',
    'non-BlackSwan models pass through the swap untouched',
  );
  // No memoryReferences (both real call sites — swanbot.ts and
  // openswanSessionRuntime.ts — invoke this without any): the bare
  // "## ... Contract" header + route/surface line must NOT appear. Isolated
  // testing found that exact bare shape triggers a non-terminating
  // self-referential loop on realistic production prompts, so grounding with
  // no real reference content folds into plain rule sentences instead.
  const groundingNoRefs = buildBlackSwanGroundingBlock({ model: BLACKSWAN_ENDPOINT_MODEL_ID, source: 'openswan' });
  expect(!groundingNoRefs.includes('BlackSwan App-Grounding Contract'), 'no bare contract header when memoryReferences is empty');
  expect(!groundingNoRefs.includes('Runtime route:'), 'no route/surface metadata line when memoryReferences is empty');
  expect(groundingNoRefs.includes('Do not invent app state'), 'grounding rules still emit for BlackSwan routes without references');

  // With memoryReferences present, the full contract header + route line +
  // reference list still emits (real content backs the header this time).
  const groundingWithRefs = buildBlackSwanGroundingBlock({
    model: BLACKSWAN_ENDPOINT_MODEL_ID,
    source: 'openswan',
    memoryReferences: [{ title: 'circle streak note', memoryKind: 'fact', scope: 'circle' } as any],
  });
  expect(groundingWithRefs.includes('BlackSwan App-Grounding Contract'), 'grounding contract emits when memoryReferences are present');
  expect(groundingWithRefs.includes('Runtime route:'), 'route/surface metadata line emits when memoryReferences are present');
  expect(groundingWithRefs.includes('circle streak note'), 'reference list is included when memoryReferences are present');

  expect(buildBlackSwanGroundingBlock({ model: 'claude-sonnet-4-6', source: 'main_chat' }) === '', 'no grounding block for plain frontier turns');
  pass('executor swap + grounding contract');
}

// ── Composer-pattern planner split (P9) ─────────────────────────────────────
// Auto browser/app tasks PLAN with the app-trained model; the screen loop
// keeps its Sonnet pin downstream; explicit picks plan with the pick.
{
  expect(
    resolveComputerTaskPlannerModel('auto', WITH_BLACKSWAN) === BLACKSWAN_ENDPOINT_MODEL_ID,
    'auto + blackswan connected → BlackSwan plans the computer task',
  );
  expect(
    resolveComputerTaskPlannerModel('', WITH_BLACKSWAN) === BLACKSWAN_ENDPOINT_MODEL_ID,
    'empty selection counts as auto for the planner split',
  );
  expect(
    resolveComputerTaskPlannerModel('auto', WITHOUT_BLACKSWAN) === null,
    'no blackswan integration → planner falls back to the caller model',
  );
  expect(
    resolveComputerTaskPlannerModel('claude-sonnet-4-6', WITH_BLACKSWAN) === null,
    'explicit pick → planner uses the pick (never overridden)',
  );
  pass('planner split: BlackSwan plans, pinned loop executes');
}

// ── Capabilities registered (fail-closed, buffered) ─────────────────────────
{
  const flags = getModelCapabilityFlags(BLACKSWAN_ENDPOINT_MODEL_ID);
  expect(!flags.toolUse && !flags.computerUse && !flags.vision, 'BlackSwan capabilities fail closed on tools/vision/computer');
  expect(flags.streaming === false, 'BlackSwan registered as non-streaming (llm-proxy buffers HF)');
  pass('capability registry: deliberate BlackSwan row');
}

// ── Auto-model transparency: explainAutoModelChoice lockstep (P11) ──────────
// The explainer names WHY Auto chose a model but delegates the id to
// resolveModelForSoul. (a) Anti-drift: across an argument matrix, the
// explanation's model ALWAYS equals the resolver's id. (c) Every reason is
// a non-empty, ≤60-char human clause.
const WITH_OPENAI = new Set(['anthropic', 'openai']);
const WITH_PERPLEXITY = new Set(['anthropic', 'perplexity']);
type SoulArgs = Parameters<typeof resolveModelForSoul>;
const EXPLAIN_MATRIX: Array<[label: string, args: SoulArgs]> = [
  ['status + blackswan',        ['sr-engineer', 'auto', 'status', 'simple', false, false, WITH_BLACKSWAN, undefined]],
  ['memory + blackswan',        ['sr-engineer', 'auto', 'memory', 'simple', false, false, WITH_BLACKSWAN, undefined]],
  ['app question + hint',       ['sr-engineer', 'auto', 'question', 'simple', false, false, WITH_BLACKSWAN, { appGroundedHint: true }]],
  ['heavy question + hint',     ['sr-engineer', 'auto', 'question', 'complex', false, false, WITH_BLACKSWAN, { appGroundedHint: true }]],
  ['light question, no hint',   ['sr-engineer', 'auto', 'question', 'simple', false, false, WITHOUT_BLACKSWAN, undefined]],
  ['status, no blackswan',      ['sr-engineer', 'auto', 'status', 'trivial', false, false, WITHOUT_BLACKSWAN, undefined]],
  ['complex build + openai',    ['sr-engineer', 'auto', 'build', 'complex', false, false, WITH_OPENAI, undefined]],
  ['simple debug, anthropic',   ['sr-engineer', 'auto', 'debug', 'simple', false, false, WITHOUT_BLACKSWAN, undefined]],
  ['research + perplexity',     ['ai-researcher', 'auto', 'research', 'complex', false, false, WITH_PERPLEXITY, undefined]],
  ['architect lane',            ['architect', 'auto', 'architect', 'complex', false, false, WITHOUT_BLACKSWAN, undefined]],
  ['design lane',               ['designer', 'auto', 'design', 'simple', false, false, WITHOUT_BLACKSWAN, undefined]],
  ['browser lane',              ['sr-engineer', 'auto', 'browser', 'moderate', false, false, WITHOUT_BLACKSWAN, undefined]],
  ['task_mgmt lane',            ['sr-engineer', 'auto', 'task_mgmt', 'simple', false, false, WITHOUT_BLACKSWAN, undefined]],
  ['build exploring',           ['sr-engineer', 'auto', 'build', 'simple', false, true, WITH_OPENAI, undefined]],
  ['build converging',          ['sr-engineer', 'auto', 'build', 'moderate', true, false, WITH_OPENAI, undefined]],
  ['no intent (soul default)',  ['sr-engineer', 'auto', undefined, undefined, false, false, WITHOUT_BLACKSWAN, undefined]],
  ['explicit pick',             ['code-reviewer', 'claude-opus-4-8', 'status', 'simple', false, false, WITH_BLACKSWAN, undefined]],
  ['legacy local pick',         ['sr-engineer', 'blackswan', 'build', 'complex', false, false, WITHOUT_BLACKSWAN, undefined]],
  ['legacy ollama-prefixed',    ['sr-engineer', 'ollama/blackswan', 'status', 'simple', false, false, WITH_BLACKSWAN, undefined]],
  ['no providers at all',       ['sr-engineer', 'auto', 'question', 'complex', false, false, undefined, undefined]],
];
{
  for (const [label, args] of EXPLAIN_MATRIX) {
    const explained = explainAutoModelChoice(...args);
    const resolved = resolveModelForSoul(...args);
    expect(
      explained.model === resolved,
      `matrix "${label}": explanation id must equal resolver id (explain=${explained.model}, resolve=${resolved})`,
    );
    expect(
      typeof explained.reason === 'string' && explained.reason.trim().length > 0,
      `matrix "${label}": reason is non-empty`,
    );
    expect(
      explained.reason.length <= 60,
      `matrix "${label}": reason ≤60 chars (got ${explained.reason.length}: "${explained.reason}")`,
    );
  }
  pass(`anti-drift matrix: ${EXPLAIN_MATRIX.length} combos — explain().model === resolveModelForSoul(), reasons bounded`);
}

// (b) reasonKind names the branch that actually fired, in ladder order.
{
  const statusLane = explainAutoModelChoice('sr-engineer', 'auto', 'status', 'simple', false, false, WITH_BLACKSWAN);
  expect(statusLane.reasonKind === 'blackswan_app_lane', `status + blackswan → 'blackswan_app_lane' (got ${statusLane.reasonKind})`);
  expect(statusLane.model === BLACKSWAN_ENDPOINT_MODEL_ID, 'blackswan_app_lane explanation carries the endpoint id');

  const appQuestion = explainAutoModelChoice('sr-engineer', 'auto', 'question', 'simple', false, false, WITH_BLACKSWAN, { appGroundedHint: true });
  expect(appQuestion.reasonKind === 'blackswan_app_question', `light question + hint → 'blackswan_app_question' (got ${appQuestion.reasonKind})`);

  const heavyBuild = explainAutoModelChoice('sr-engineer', 'auto', 'build', 'complex', false, false, WITH_OPENAI);
  expect(heavyBuild.reasonKind === 'coding_lane', `complex build + openai → 'coding_lane' (got ${heavyBuild.reasonKind})`);

  const explicit = explainAutoModelChoice('sr-engineer', 'claude-opus-4-8', 'status', 'simple', false, false, WITH_BLACKSWAN);
  expect(explicit.reasonKind === 'explicit_pick', `explicit pick → 'explicit_pick' (got ${explicit.reasonKind})`);
  expect(explicit.model === 'claude-opus-4-8', 'explicit-pick explanation echoes the pick verbatim');

  const legacy = explainAutoModelChoice('sr-engineer', 'blackswan', 'build', 'complex', false, false, WITHOUT_BLACKSWAN);
  expect(legacy.reasonKind === 'legacy_blackswan_normalized', `local 'blackswan' pick → 'legacy_blackswan_normalized' (got ${legacy.reasonKind})`);
  expect(legacy.model === BLACKSWAN_ENDPOINT_MODEL_ID, 'legacy normalization explanation carries the v5 endpoint id');

  const noIntent = explainAutoModelChoice('sr-engineer', 'auto', undefined, undefined, false, false, WITHOUT_BLACKSWAN);
  expect(noIntent.reasonKind === 'soul_default', `no intent → 'soul_default' (got ${noIntent.reasonKind})`);

  // Ladder-order guards: heavy app questions leave the BlackSwan lane;
  // the same intents without the integration fall to the plain fast lane;
  // build phases classify before intent branches.
  const heavyAppQuestion = explainAutoModelChoice('sr-engineer', 'auto', 'question', 'complex', false, false, WITH_BLACKSWAN, { appGroundedHint: true });
  expect(heavyAppQuestion.reasonKind === 'question_heavy', `heavy question + hint → 'question_heavy', never BlackSwan (got ${heavyAppQuestion.reasonKind})`);
  const statusPlain = explainAutoModelChoice('sr-engineer', 'auto', 'status', 'simple', false, false, WITHOUT_BLACKSWAN);
  expect(statusPlain.reasonKind === 'casual_lane', `status without blackswan → 'casual_lane' (got ${statusPlain.reasonKind})`);
  const exploring = explainAutoModelChoice('sr-engineer', 'auto', 'build', 'simple', false, true, WITH_OPENAI);
  expect(exploring.reasonKind === 'build_exploring', `exploring phase wins over the intent branch (got ${exploring.reasonKind})`);
  const converging = explainAutoModelChoice('sr-engineer', 'auto', 'build', 'moderate', true, false, WITH_OPENAI);
  expect(converging.reasonKind === 'build_converging', `converging phase wins over the intent branch (got ${converging.reasonKind})`);
  pass('reasonKind matches the real ladder branch per lane');
}

// ── Reliability guard: WHEN BlackSwan handles vs escalates within its lane ──
// BlackSwan-v5 is a small (Qwen3.5-4B) fine-tune that mis-discriminates on
// hard/broad/ambiguous inputs. The guard ESCALATES only the hard SUBSET of
// the app-grounded lane to the frontier fallback — it must NEVER remove
// BlackSwan from the simple grounded turns it is designed for, and must NEVER
// introduce another BlackSwan id.
{
  // (1) The simple grounded turns BlackSwan is designed for STAY on BlackSwan
  //     even with the guard live (message threaded through). This is the hard
  //     product constraint: no removal for the easy lane.
  const simpleGrounded: Array<[intent: any, complexity: any, hint: boolean | undefined, msg: string]> = [
    ['status',  'simple',  undefined, "what's my streak?"],
    ['status',  'simple',  undefined, 'how many tasks are open?'],
    ['memory',  'simple',  undefined, 'what did we decide about the north star?'],
    ['casual',  'trivial', undefined, 'hey, what is up'],
    ['social',  'simple',  undefined, 'shout-out to the circle today'],
    ['question','simple',  true,      'how many missions are open?'],
    ['question','simple',  true,      'who missed check-ins this week?'],
  ];
  for (const [intent, complexity, hint, msg] of simpleGrounded) {
    const opts = hint === undefined ? undefined : { appGroundedHint: hint };
    const model = resolveModelForSoul('sr-engineer', 'auto', intent, complexity, false, false, WITH_BLACKSWAN, opts, msg);
    expect(model === BLACKSWAN_ENDPOINT_MODEL_ID, `simple grounded "${msg}" STAYS on BlackSwan (got ${model})`);
    expect(shouldEscalateBlackSwanToFrontier(msg).escalate === false, `guard does NOT escalate simple grounded "${msg}"`);
  }
  pass('reliability guard: simple grounded lane preserved on BlackSwan (no removal)');

  // (2) The genuinely-hard SUBSET of the SAME lane escalates to the frontier
  //     fallback — never BlackSwan, never any other blackswan id.
  const hardSubset: Array<[intent: any, complexity: any, hint: boolean | undefined, reason: string, msg: string]> = [
    ['status',  'simple', undefined, 'multi_step',          'check my streak then update the mission then close it'],
    ['question','simple', true,      'technical_reasoning', 'why does my streak keep resetting?'],
    ['question','simple', true,      'technical_reasoning', 'explain the difference between missions and tasks'],
    ['question','simple', true,      'long_compound',       'what is my streak? and who missed check-ins? and how much xp?'],
    ['status',  'simple', undefined, 'action_verb',         'deploy the office agents and run the standup automation'],
    ['question','simple', true,      'ambiguous',           "not sure if this check-in counts, which is better?"],
  ];
  for (const [intent, complexity, hint, reason, msg] of hardSubset) {
    const opts = hint === undefined ? undefined : { appGroundedHint: hint };
    const model = resolveModelForSoul('sr-engineer', 'auto', intent, complexity, false, false, WITH_BLACKSWAN, opts, msg);
    const decision = shouldEscalateBlackSwanToFrontier(msg);
    expect(decision.escalate === true, `guard escalates hard turn "${msg}"`);
    expect(decision.reason === reason, `hard turn "${msg}" → reason '${reason}' (got ${decision.reason})`);
    expect(
      model !== BLACKSWAN_ENDPOINT_MODEL_ID && model !== BLACKSWAN_PUBLIC_MODEL_ID,
      `escalated hard turn "${msg}" leaves BlackSwan (got ${model})`,
    );
  }
  pass('reliability guard: hard subset escalates to frontier fallback');

  // (3) The escalation target is EXACTLY the frontier model the lane would
  //     have used absent BlackSwan (single source of truth, not a new model):
  //     compare the escalated pick to the same call with the integration off.
  {
    const longCompound = 'what is my streak? and who missed check-ins? and how much xp did we earn?';
    const escalated = resolveModelForSoul('sr-engineer', 'auto', 'status', 'simple', false, false, WITH_BLACKSWAN, undefined, longCompound);
    const withoutBlackswan = resolveModelForSoul('sr-engineer', 'auto', 'status', 'simple', false, false, WITHOUT_BLACKSWAN, undefined, longCompound);
    expect(escalated === withoutBlackswan, `escalated model == lane's non-BlackSwan pick (esc=${escalated}, base=${withoutBlackswan})`);

    // Heavy escalated question routes to the heavy-question frontier (Sonnet),
    // proving the fall-through uses the real ladder, not a hardcoded tier.
    const heavyHardQ = 'explain the trade-offs between our mission cadence and the streak system in detail';
    const heavyEsc = resolveModelForSoul('sr-engineer', 'auto', 'question', 'complex', false, false, WITH_BLACKSWAN, { appGroundedHint: true }, heavyHardQ);
    expect(heavyEsc === 'claude-sonnet-4-6', `heavy hard app question escalates to Sonnet frontier (got ${heavyEsc})`);
  }
  pass('reliability guard: escalation target is the lane frontier fallback');

  // (4) Guard is a no-op when no message is threaded (the pre-guard 8-arg
  //     call shape) — every existing lane behaves exactly as before.
  {
    const noMsg = resolveModelForSoul('sr-engineer', 'auto', 'status', 'simple', false, false, WITH_BLACKSWAN);
    expect(noMsg === BLACKSWAN_ENDPOINT_MODEL_ID, 'no message threaded → BlackSwan lane unchanged (guard no-op)');
  }
  pass('reliability guard: no-op without message (backward compatible)');

  // (5) The endpoint-id normalization is UNTOUCHED and NO OTHER blackswan id
  //     is ever introduced by the guard. Explicit stale-local picks still
  //     normalize to cswan801/BlackSwan-v5 even alongside a hard message; and
  //     every model the guard can return for an escalated turn is a frontier
  //     Anthropic model, never a blackswan id.
  {
    expect(
      resolveModelForSoul('sr-engineer', 'blackswan', 'status', 'simple', false, false, WITH_BLACKSWAN, undefined, 'why does this keep failing then reset?')
        === BLACKSWAN_ENDPOINT_MODEL_ID,
      'explicit legacy pick still normalizes to the v5 endpoint (guard never rewrites explicit picks)',
    );
    expect(
      BLACKSWAN_ENDPOINT_MODEL_ID === 'huggingface_endpoint/cswan801/BlackSwan-v5',
      'endpoint id normalization untouched: cswan801/BlackSwan-v5 pinned',
    );
    // Sweep the escalated outputs across the grounded lane: assert none is a
    // BlackSwan id in any form (endpoint, public, or bare repo).
    const escalatingMsgs = [
      'check my streak then close the mission',
      'deploy the office agents for my circle',
      'why does my xp keep dropping?',
      'not sure which mission to pick, help me decide',
      'what is my streak? and my xp? and my check-ins?',
    ];
    for (const msg of escalatingMsgs) {
      for (const intent of ['status', 'memory', 'casual', 'social'] as const) {
        const m = resolveModelForSoul('sr-engineer', 'auto', intent, 'simple', false, false, WITH_BLACKSWAN, undefined, msg).toLowerCase();
        expect(
          !m.includes('blackswan') && !m.includes('cswan801'),
          `escalated "${msg}" (${intent}) never yields a blackswan id (got ${m})`,
        );
      }
    }
    pass('reliability guard: endpoint normalization intact, no other blackswan id introduced');
  }

  // (6) explainAutoModelChoice stays LOCKSTEP with the guard: when escalation
  //     fires the reasonKind names the escape, the id equals the resolver's
  //     frontier pick, and the reason wording is a bounded human clause.
  {
    const hardMsg = 'check my streak then update the mission then close it out';
    const explained = explainAutoModelChoice('sr-engineer', 'auto', 'status', 'simple', false, false, WITH_BLACKSWAN, undefined, hardMsg);
    const resolved = resolveModelForSoul('sr-engineer', 'auto', 'status', 'simple', false, false, WITH_BLACKSWAN, undefined, hardMsg);
    expect(explained.model === resolved, `escalated explain().model === resolve() (explain=${explained.model}, resolve=${resolved})`);
    expect(explained.reasonKind === 'blackswan_escalated_to_frontier', `escalated turn → 'blackswan_escalated_to_frontier' (got ${explained.reasonKind})`);
    expect(explained.reason.length > 0 && explained.reason.length <= 60, `escalated reason bounded ≤60 (got ${explained.reason.length}: "${explained.reason}")`);

    // A simple grounded turn WITH a message still names the BlackSwan lane
    // (proves the explainer didn't over-escalate).
    const simpleExplain = explainAutoModelChoice('sr-engineer', 'auto', 'status', 'simple', false, false, WITH_BLACKSWAN, undefined, "what's my streak?");
    expect(simpleExplain.reasonKind === 'blackswan_app_lane', `simple grounded + message → still 'blackswan_app_lane' (got ${simpleExplain.reasonKind})`);
    expect(simpleExplain.model === BLACKSWAN_ENDPOINT_MODEL_ID, 'simple grounded + message still explains as BlackSwan');
    pass('reliability guard: explainAutoModelChoice lockstep on escalation');
  }

  // (7) describeBlackSwanEscalation wording: every reason ≤60 chars & human,
  //     and the null/unknown case falls back to the BlackSwan-kept clause.
  {
    for (const r of ['multi_step', 'action_verb', 'technical_reasoning', 'long_compound', 'ambiguous'] as const) {
      const text = describeBlackSwanEscalation(r);
      expect(text.length > 0 && text.length <= 60, `describe(${r}) ≤60 chars (got ${text.length}: "${text}")`);
      expect(text.includes('frontier'), `describe(${r}) names the frontier fallback (got "${text}")`);
    }
    expect(describeBlackSwanEscalation(null).includes('BlackSwan'), 'describe(null) is the BlackSwan-kept clause');
    pass('reliability guard: escalation wording bounded and human');
  }

  // (8) Guard precision: object-noun gating keeps "open"/"running" recall
  //     questions on BlackSwan (no false-positive escalation).
  {
    for (const msg of ['show me the open missions', 'how many open issues do we have?', 'what is the running total of xp?', 'who has the longest streak']) {
      expect(shouldEscalateBlackSwanToFrontier(msg).escalate === false, `precision: "${msg}" does NOT escalate`);
    }
    expect(shouldEscalateBlackSwanToFrontier('').escalate === false, 'empty message never escalates');
    pass('reliability guard: conservative precision (recall questions stay on BlackSwan)');
  }
}

if (failures > 0) {
  console.error(`\n${failures} blackswan auto-routing smoke failure(s)`);
  process.exit(1);
}

console.log('\nAll blackswan auto-routing smoke cases passed.');
