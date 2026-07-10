/**
 * Smoke test for src/lib/marketplaceToolTierPolicy.ts (PURE, tsx-loadable).
 *
 * Run: npx tsx scripts/marketplace-tool-tier-smoketest.ts
 *
 * Asserts the Phase 2 "break the model wall" tier matrix:
 *   - flag off (the DEFAULT) -> plain_text always, even for action turns;
 *   - flag on + tool-capable model + action-shaped -> relay_tool_loop;
 *   - flag on + tool-less model + action-shaped -> delegate_executor with the
 *     claude-sonnet-4-6 executor (mirrors modelCollaborationPolicy's safe id);
 *   - flag on + conversational turn -> plain_text;
 *   - unknown model id -> NEVER relay (fail closed to delegate_executor);
 *   - flag helper precedence (runtime override before storage, default OFF);
 *   - proxy tool-call escalation gating + tool_use block conversion bounds.
 */

import {
  buildDelegateExecutorNotice,
  decideMarketplaceToolTier,
  isMarketplaceToolLoopEnabled,
  isMarketplaceTurnActionShaped,
  MARKETPLACE_TOOL_EXECUTOR_MODEL_ID,
  MARKETPLACE_TOOL_LOOP_FLAG,
  proxyToolCallsToAnthropicContent,
  setMarketplaceToolLoopOverride,
  shouldEscalateProxyToolCalls,
} from '../src/lib/marketplaceToolTierPolicy';

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

// The proof-recipe message: an action-shaped local-computer read.
const ACTION_MSG = 'list my open tabs';
// A second action shape from the generic action-verb taxonomy.
const ACTION_MSG_2 = 'create a task for tomorrow and update the mission budget cap';
// Plain conversation — must never enter a tool loop.
const CHAT_MSG = 'what is the capital of france?';

// ── 1. Flag OFF (default) -> plain_text ALWAYS ───────────────────────────────
{
  for (const model of ['openrouter/anthropic/claude-sonnet-4-6', 'deepseek/deepseek-reasoner', 'totally-unknown-model']) {
    for (const message of [ACTION_MSG, ACTION_MSG_2, CHAT_MSG]) {
      const d = decideMarketplaceToolTier({ modelId: model, message, flagEnabled: false });
      assert(`flag off -> plain_text (${model} / "${message.slice(0, 24)}")`, d.tier === 'plain_text');
      assert(`flag off -> no executor leaked (${model})`, d.executorModelId === undefined);
    }
  }
}

// ── 2. Flag ON + toolUse:true + action-shaped -> relay_tool_loop ─────────────
{
  for (const model of [
    'openrouter/anthropic/claude-sonnet-4-6',
    'groq/llama-3.3-70b-versatile',
    'deepseek/deepseek-v3.2',
  ]) {
    const d = decideMarketplaceToolTier({ modelId: model, message: ACTION_MSG, flagEnabled: true });
    assert(`flag on + tool-capable + action -> relay_tool_loop (${model})`, d.tier === 'relay_tool_loop');
  }
  const d2 = decideMarketplaceToolTier({
    modelId: 'openrouter/anthropic/claude-sonnet-4-6',
    message: ACTION_MSG_2,
    flagEnabled: true,
  });
  assert('generic action verbs also relay', d2.tier === 'relay_tool_loop');
}

// ── 3. Flag ON + tool-less model + action-shaped -> delegate_executor ────────
{
  for (const model of ['deepseek/deepseek-reasoner', 'perplexity/sonar-pro', 'flux-schnell']) {
    const d = decideMarketplaceToolTier({ modelId: model, message: ACTION_MSG, flagEnabled: true });
    assert(`flag on + tool-less + action -> delegate_executor (${model})`, d.tier === 'delegate_executor');
    assert(`executor is sonnet (${model})`, d.executorModelId === 'claude-sonnet-4-6');
  }
  assert('executor constant is claude-sonnet-4-6', MARKETPLACE_TOOL_EXECUTOR_MODEL_ID === 'claude-sonnet-4-6');
}

// ── 4. Flag ON + conversational turn -> plain_text ───────────────────────────
{
  for (const model of ['openrouter/anthropic/claude-sonnet-4-6', 'deepseek/deepseek-reasoner']) {
    const d = decideMarketplaceToolTier({ modelId: model, message: CHAT_MSG, flagEnabled: true });
    assert(`flag on + chat turn -> plain_text (${model})`, d.tier === 'plain_text');
  }
  const empty = decideMarketplaceToolTier({ modelId: 'openrouter/anthropic/claude-sonnet-4-6', message: '   ', flagEnabled: true });
  assert('empty message -> plain_text', empty.tier === 'plain_text');
}

// ── 5. Unknown model id -> NEVER relay (fail closed) ─────────────────────────
{
  for (const model of ['totally-unknown-model', 'openrouter/some-org/mystery-9000', '']) {
    const d = decideMarketplaceToolTier({ modelId: model, message: ACTION_MSG, flagEnabled: true });
    assert(`unknown id never relays (${JSON.stringify(model)})`, d.tier !== 'relay_tool_loop');
    assert(`unknown id delegates to sonnet (${JSON.stringify(model)})`, d.tier === 'delegate_executor' && d.executorModelId === 'claude-sonnet-4-6');
  }
}

// ── 6. Action-shape detector reuses the existing taxonomies ─────────────────
{
  assert('awareness read is action-shaped', isMarketplaceTurnActionShaped(ACTION_MSG) === true);
  assert('generic action verbs are action-shaped', isMarketplaceTurnActionShaped(ACTION_MSG_2) === true);
  assert('plain Q&A is not action-shaped', isMarketplaceTurnActionShaped(CHAT_MSG) === false);
  assert('empty is not action-shaped', isMarketplaceTurnActionShaped('') === false);
}

// ── 7. Runtime flag helper: default OFF, override precedence ────────────────
{
  assert('flag key name', MARKETPLACE_TOOL_LOOP_FLAG === 'uc_marketplace_tool_loop');
  setMarketplaceToolLoopOverride(null);
  assert('default OFF (no storage, no override)', isMarketplaceToolLoopEnabled() === false);
  // Default OFF means decideMarketplaceToolTier with no flagEnabled is plain_text.
  const dDefault = decideMarketplaceToolTier({ modelId: 'openrouter/anthropic/claude-sonnet-4-6', message: ACTION_MSG });
  assert('live default is plain_text', dDefault.tier === 'plain_text');
  setMarketplaceToolLoopOverride(true);
  assert('runtime override ON wins', isMarketplaceToolLoopEnabled() === true);
  setMarketplaceToolLoopOverride(false);
  assert('runtime override OFF wins', isMarketplaceToolLoopEnabled() === false);
  setMarketplaceToolLoopOverride(null);
  // localStorage opt-in path (simulated store).
  (globalThis as any).localStorage = { getItem: (k: string) => (k === MARKETPLACE_TOOL_LOOP_FLAG ? '1' : null) };
  assert('storage "1" opts in', isMarketplaceToolLoopEnabled() === true);
  (globalThis as any).localStorage = { getItem: () => 'off' };
  assert('storage non-opt-in value stays OFF', isMarketplaceToolLoopEnabled() === false);
  // Override beats storage.
  (globalThis as any).localStorage = { getItem: () => '1' };
  setMarketplaceToolLoopOverride(false);
  assert('runtime override beats storage', isMarketplaceToolLoopEnabled() === false);
  setMarketplaceToolLoopOverride(null);
  delete (globalThis as any).localStorage;
}

// ── 8. Proxy tool-call escalation gating ─────────────────────────────────────
{
  const calls = [{ id: 'c1', name: 'tools.search', arguments: '{"query":"tabs"}' }];
  assert(
    'flag off -> never escalate',
    shouldEscalateProxyToolCalls({ modelId: 'openrouter/anthropic/claude-sonnet-4-6', toolCalls: calls, flagEnabled: false }) === false,
  );
  assert(
    'flag on + tool-capable + calls -> escalate',
    shouldEscalateProxyToolCalls({ modelId: 'openrouter/anthropic/claude-sonnet-4-6', toolCalls: calls, flagEnabled: true }) === true,
  );
  assert(
    'unknown model id -> never escalate (fail closed)',
    shouldEscalateProxyToolCalls({ modelId: 'openrouter/some-org/mystery-9000', toolCalls: calls, flagEnabled: true }) === false,
  );
  assert(
    'no calls -> no escalation',
    shouldEscalateProxyToolCalls({ modelId: 'openrouter/anthropic/claude-sonnet-4-6', toolCalls: [], flagEnabled: true }) === false,
  );
  assert(
    'absent field -> no escalation',
    shouldEscalateProxyToolCalls({ modelId: 'openrouter/anthropic/claude-sonnet-4-6', toolCalls: undefined, flagEnabled: true }) === false,
  );
  assert(
    'malformed calls (no name) -> no escalation',
    shouldEscalateProxyToolCalls({ modelId: 'openrouter/anthropic/claude-sonnet-4-6', toolCalls: [{ id: 'x' }], flagEnabled: true }) === false,
  );
}

// ── 9. tool_use conversion: shapes, defenses, bounds ─────────────────────────
{
  const blocks = proxyToolCallsToAnthropicContent([
    { id: 'a', name: 'tools.search', arguments: '{"query":"tabs"}' },
    { name: 'desktop.list_tabs', arguments: { limit: 5 } },
    { name: '', arguments: '{}' }, // skipped: empty name
    { name: 'bad.args', arguments: 'not-json' }, // kept, {} input
  ]);
  assert('conversion keeps well-formed calls', blocks.length === 3);
  assert('block type is tool_use', blocks.every((b) => b.type === 'tool_use'));
  assert('string args parsed', (blocks[0].input as any).query === 'tabs');
  assert('object args passed through', (blocks[1].input as any).limit === 5);
  assert('missing id synthesized', blocks[1].id.length > 0);
  assert('unparseable args -> {}', Object.keys(blocks[2].input).length === 0);
  const many = proxyToolCallsToAnthropicContent(
    Array.from({ length: 20 }, (_, i) => ({ id: `t${i}`, name: `tool.${i}` })),
  );
  assert('conversion bounded to 8', many.length === 8);
  assert('non-array input -> []', proxyToolCallsToAnthropicContent('nope').length === 0);
}

// ── 10. Visible delegate notice ──────────────────────────────────────────────
{
  const notice = buildDelegateExecutorNotice('deepseek/deepseek-reasoner', 'claude-sonnet-4-6');
  assert('notice wording', notice === 'deepseek/deepseek-reasoner plans, claude-sonnet-4-6 executes.');
  const fallback = buildDelegateExecutorNotice('', '');
  assert('notice fails safe on empty ids', fallback === `Selected model plans, ${MARKETPLACE_TOOL_EXECUTOR_MODEL_ID} executes.`);
}

// ─────────────────────────────────────────────────────────────────────────────
// eslint-disable-next-line no-console
console.log(`\nmarketplace-tool-tier smoke: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
