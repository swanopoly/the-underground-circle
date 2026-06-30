/**
 * Smoke test for src/lib/aiFirstChatPolicy.ts (PURE, tsx-loadable).
 *
 * Run: npx tsx scripts/ai-first-chat-policy-smoketest.ts
 *
 * Asserts the AI-first orchestration brain:
 *   - plain Q&A -> plain_model (streamFirst true, no capabilities)
 *   - app/computer/browser/build/design/wp/code/verify action -> escalate_tools
 *     (streamFirst STAYS true: stream then escalate on tool_use)
 *   - explicit deploy/spawn of MULTIPLE agents -> spawn_agents (streamFirst false)
 *   - streamFirst correct per tier; explicit flags honored; fail-safe default.
 */

import {
  decideChatOrchestration,
  type ChatTurnSignals,
  type OrchestrationDecision,
  type ChatOrchestrationTier,
} from '../src/lib/aiFirstChatPolicy';

let passed = 0;
let failed = 0;

function assert(label: string, cond: boolean): void {
  if (cond) {
    passed += 1;
    // eslint-disable-next-line no-console
    console.log(`  ok  ${label}`);
  } else {
    failed += 1;
    // eslint-disable-next-line no-console
    console.error(`FAIL  ${label}`);
  }
}

function decide(message: string, extra: Partial<ChatTurnSignals> = {}): OrchestrationDecision {
  return decideChatOrchestration({ message, ...extra });
}

function expectTier(
  label: string,
  d: OrchestrationDecision,
  tier: ChatOrchestrationTier,
  streamFirst: boolean,
): void {
  assert(`${label} -> tier=${tier}`, d.tier === tier);
  assert(`${label} -> streamFirst=${streamFirst}`, d.streamFirst === streamFirst);
}

// ── 1. Plain Q&A / conversational -> plain_model, streamFirst true ───────────
{
  const d = decide('What is the capital of France?');
  expectTier('plain Q&A', d, 'plain_model', true);
  assert('plain Q&A -> no suggested capabilities', d.suggestedCapabilities.length === 0);
}
{
  const d = decide('Explain how transformers work, in simple terms.');
  expectTier('explain request', d, 'plain_model', true);
}
{
  const d = decide('Thanks, that makes sense!');
  expectTier('chit-chat', d, 'plain_model', true);
}

// ── 2. Action turns -> escalate_tools, streamFirst STAYS true ────────────────
{
  // The headline spec example: design + desktop families.
  const d = decide('open Photoshop and export a PNG');
  expectTier('"open Photoshop and export a PNG"', d, 'escalate_tools', true);
  assert(
    '"open Photoshop..." -> suggests design',
    d.suggestedCapabilities.includes('design'),
  );
  assert(
    '"open Photoshop..." -> suggests desktop',
    d.suggestedCapabilities.includes('desktop'),
  );
}
{
  const d = decide('browse to example.com and fill out the contact form');
  expectTier('browser form', d, 'escalate_tools', true);
  assert('browser form -> suggests browser', d.suggestedCapabilities.includes('browser'));
}
{
  const d = decide('publish a post to WordPress about our spring sale');
  expectTier('wordpress publish', d, 'escalate_tools', true);
  assert('wordpress -> suggests wordpress', d.suggestedCapabilities.includes('wordpress'));
}
{
  const d = decide('build me a landing page for a coffee brand');
  expectTier('build landing page', d, 'escalate_tools', true);
  assert('build -> suggests code', d.suggestedCapabilities.includes('code'));
}
{
  const d = decide('verify that the login flow actually works');
  expectTier('verify request', d, 'escalate_tools', true);
  assert('verify -> suggests verify', d.suggestedCapabilities.includes('verify'));
}
{
  const d = decide('research the latest on RAG and cite your sources');
  expectTier('research request', d, 'escalate_tools', true);
  assert('research -> suggests research', d.suggestedCapabilities.includes('research'));
}
{
  // Explicit tool flag forces escalation even for plain-looking text.
  const d = decide('just do the thing', { explicitToolRequest: true });
  expectTier('explicit tool flag', d, 'escalate_tools', true);
}
{
  // An explicit non-default runtime mode opts into tools.
  const d = decide('here is some context', { mode: 'openswan' });
  expectTier('explicit runtime mode', d, 'escalate_tools', true);
}
{
  // mode 'none'/'chat' must NOT force escalation.
  const d = decide('what do you think about this idea?', { mode: 'none' });
  expectTier("mode 'none' stays plain", d, 'plain_model', true);
}

// ── 3. Spawn agents -> spawn_agents, streamFirst FALSE ───────────────────────
{
  // The headline spec example.
  const d = decide('deploy 10 agents to research X');
  expectTier('"deploy 10 agents to research X"', d, 'spawn_agents', false);
  assert(
    '"deploy 10 agents..." -> suggests deploy_agents',
    d.suggestedCapabilities.includes('deploy_agents'),
  );
  assert(
    '"deploy 10 agents to research X" -> keeps research capability',
    d.suggestedCapabilities.includes('research'),
  );
}
{
  const d = decide('spawn a swarm of agents to crawl these sites');
  expectTier('spawn swarm', d, 'spawn_agents', false);
  assert('spawn swarm -> deploy_agents first', d.suggestedCapabilities[0] === 'deploy_agents');
}
{
  // Explicit agent flag forces the deploy tier.
  const d = decide('handle this', { explicitAgentRequest: true });
  expectTier('explicit agent flag', d, 'spawn_agents', false);
  assert('explicit agent flag -> deploy_agents', d.suggestedCapabilities.includes('deploy_agents'));
}
{
  // A SINGLE agent should NOT become a swarm — stays in the normal tool path.
  const d = decide('spawn an agent to fix the bug');
  assert('single-agent spawn is NOT spawn_agents', d.tier !== 'spawn_agents');
  expectTier('single-agent spawn -> escalate_tools', d, 'escalate_tools', true);
}

// ── 4. Invariants across many turns ──────────────────────────────────────────
{
  const samples: string[] = [
    'hello there',
    'open the browser and download the report',
    'deploy 50 agents to summarize the docs',
    'what time is it in Tokyo?',
    'refactor this function for me',
  ];
  for (const s of samples) {
    const d = decide(s);
    // spawn_agents <=> streamFirst false; every other tier streams first.
    const ok = d.tier === 'spawn_agents' ? d.streamFirst === false : d.streamFirst === true;
    assert(`invariant streamFirst<->tier for "${s.slice(0, 32)}"`, ok);
    assert(`reason present for "${s.slice(0, 32)}"`, typeof d.reason === 'string' && d.reason.length > 0);
  }
}
{
  // Empty / whitespace message must fail safe to plain_model, not throw.
  const d = decide('   ');
  expectTier('empty message fail-safe', d, 'plain_model', true);
}

// ── Summary ──────────────────────────────────────────────────────────────────
// eslint-disable-next-line no-console
console.log(`\n${passed} passed, ${failed} failed (${passed + failed} assertions)`);
if (failed > 0) {
  process.exit(1);
}
