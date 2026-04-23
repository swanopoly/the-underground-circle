/**
 * agent-prompt-builder-smoketest — verifies the composable named-component
 * layer in `src/lib/agentPromptBuilder.ts`.
 *
 * Covers:
 *   - DEFAULT_COMPONENT_ORDER is respected
 *   - frozen vs volatile separation (cache_control on first block only)
 *   - null renders drop cleanly
 *   - variant ordering filter works
 *   - rendered[] metadata is accurate
 *
 * Run: npm run smoke:agent-prompt-builder
 */

import {
  buildAgentPromptBlocks,
  DEFAULT_PROMPT_COMPONENTS,
  DEFAULT_COMPONENT_ORDER,
  PROMPT_VARIANTS,
  type DefaultPromptContext,
} from '../src/lib/agentPromptBuilder';

let failures = 0;
function fail(m: string) { failures += 1; console.error('FAIL:', m); }
function pass(m: string) { console.log('pass:', m); }
function assert(cond: any, name: string, detail?: string) {
  if (cond) pass(name);
  else fail(`${name}${detail ? ' — ' + detail : ''}`);
}

async function main() {
  // ─── Case 1: frozen + volatile separation ────────────────────────────
  {
    const ctx: DefaultPromptContext = {
      role: 'BlackSwan — Underground Circle\'s accountability AI.',
      capabilities: '- read memory\n- list skills',
      rules: '- Never delete without approval.',
      environmentDetails: `now=${new Date().toISOString()}\nuser=test`,
      objective: 'Help the crew ship.',
    };
    const built = await buildAgentPromptBlocks({ components: DEFAULT_PROMPT_COMPONENTS, ctx });

    assert(built.blocks.length === 2, 'case1: emits two blocks when both frozen + volatile present');
    assert((built.blocks[0] as any).cache_control?.type === 'ephemeral',
      'case1: first block carries cache_control ephemeral');
    assert((built.blocks[1] as any).cache_control == null,
      'case1: second (volatile) block has NO cache_control');

    assert(built.frozen.includes('AGENT') && built.frozen.includes('BlackSwan'),
      'case1: frozen block contains agent role');
    assert(built.frozen.includes('RULES') && built.frozen.includes('Never delete'),
      'case1: frozen block contains rules');
    assert(built.frozen.includes('OBJECTIVE'),
      'case1: frozen block contains objective heading');
    assert(!built.frozen.includes('ENVIRONMENT DETAILS'),
      'case1: ENVIRONMENT DETAILS NOT in frozen block');
    assert(built.volatile.includes('ENVIRONMENT DETAILS'),
      'case1: volatile block contains environment details');
    assert(!built.volatile.includes('BlackSwan'),
      'case1: volatile block does NOT contain role');
  }

  // ─── Case 2: null components drop cleanly ─────────────────────────────
  {
    const ctx: DefaultPromptContext = {
      role: 'Role only.',
    };
    const built = await buildAgentPromptBlocks({ components: DEFAULT_PROMPT_COMPONENTS, ctx });

    assert(built.rendered.length === 1, 'case2: only role rendered');
    assert(built.rendered[0].key === 'agent_role', 'case2: rendered key is agent_role');
    assert(built.blocks.length === 1, 'case2: no volatile → single block only');
    assert(!built.volatile, 'case2: volatile empty');
  }

  // ─── Case 3: ordering ────────────────────────────────────────────────
  {
    const ctx: DefaultPromptContext = {
      role: 'R',
      capabilities: 'C',
      rules: 'U',
      objective: 'O',
    };
    const built = await buildAgentPromptBlocks({ components: DEFAULT_PROMPT_COMPONENTS, ctx });
    const keys = built.rendered.map((r) => r.key);
    assert(
      keys.indexOf('agent_role') < keys.indexOf('capabilities') &&
      keys.indexOf('capabilities') < keys.indexOf('rules') &&
      keys.indexOf('rules') < keys.indexOf('objective'),
      'case3: default order preserved (role → capabilities → rules → objective)',
      `got: ${keys.join(' → ')}`,
    );
  }

  // ─── Case 4: variant filter (minimal) ────────────────────────────────
  {
    const ctx: DefaultPromptContext = {
      role: 'R',
      capabilities: 'C',
      toolsBlock: 'T',
      skillsBlock: 'S',
      mcpBlock: 'M',
      memoryBankBlock: 'MB',
      rules: 'U',
      environmentDetails: 'E',
      objective: 'O',
    };
    const built = await buildAgentPromptBlocks({
      components: DEFAULT_PROMPT_COMPONENTS,
      ctx,
      order: PROMPT_VARIANTS.minimal,
    });
    const keys = built.rendered.map((r) => r.key);
    assert(
      JSON.stringify(keys) === JSON.stringify(['agent_role', 'rules', 'objective']),
      'case4: minimal variant renders only agent_role/rules/objective',
      `got: ${JSON.stringify(keys)}`,
    );
  }

  // ─── Case 5: variant filter (compact) drops skills + mcp ─────────────
  {
    const ctx: DefaultPromptContext = {
      role: 'R',
      skillsBlock: 'S',
      mcpBlock: 'M',
      memoryBankBlock: 'MB',
      rules: 'U',
      objective: 'O',
    };
    const built = await buildAgentPromptBlocks({
      components: DEFAULT_PROMPT_COMPONENTS,
      ctx,
      order: PROMPT_VARIANTS.compact,
    });
    const keys = built.rendered.map((r) => r.key);
    assert(!keys.includes('skills'), 'case5: compact variant drops skills');
    assert(!keys.includes('mcp_servers'), 'case5: compact variant drops mcp_servers');
    assert(keys.includes('memory_bank'), 'case5: compact variant keeps memory_bank');
  }

  // ─── Case 6: rendered[] char counts match body length ────────────────
  {
    const ctx: DefaultPromptContext = {
      role: 'abc',
    };
    const built = await buildAgentPromptBlocks({ components: DEFAULT_PROMPT_COMPONENTS, ctx });
    const roleRender = built.rendered.find((r) => r.key === 'agent_role');
    assert(roleRender && roleRender.chars > 0, 'case6: rendered char count positive');
  }

  // ─── Case 7: DEFAULT_COMPONENT_ORDER covers all DEFAULT_PROMPT_COMPONENTS
  {
    const order = new Set(DEFAULT_COMPONENT_ORDER);
    const componentKeys = new Set(DEFAULT_PROMPT_COMPONENTS.map((c) => c.key));
    let ok = true;
    for (const k of componentKeys) if (!order.has(k)) ok = false;
    for (const k of order) if (!componentKeys.has(k)) ok = false;
    assert(ok, 'case7: DEFAULT_COMPONENT_ORDER ↔ DEFAULT_PROMPT_COMPONENTS key parity');
  }

  if (failures > 0) {
    console.error(`\n${failures} agent-prompt-builder smoke-test failure(s)`);
    process.exit(1);
  }
  console.log('\nAll agent-prompt-builder smoke cases passed.');
}

main().catch((err) => { console.error('fatal:', err); process.exit(1); });
