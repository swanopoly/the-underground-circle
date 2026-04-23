/**
 * agent-context-compression-smoketest — verifies the pure context-
 * compression helper in `src/lib/agentContextCompression.ts`.
 *
 * Run: npm run smoke:agent-context-compression
 *
 * Cases:
 *   1. under-threshold → no compression
 *   2. over-threshold → compression, tail preserved, summary injected
 *   3. tool_use/tool_result pair straddling the cut point — pair is
 *      moved to tail intact
 *   4. summariser throws → messages unchanged (bailed safely)
 *   5. messages array is too short to meaningfully compress → no-op
 *   6. estimateMessagesTokens approximates roughly 4 chars/token
 */

import {
  compressContextIfOversized,
  estimateMessagesTokens,
} from '../src/lib/agentContextCompression';
import type { AgentMessage } from '../src/lib/agentExecutionCore';

let failures = 0;
function fail(m: string) { failures += 1; console.error('FAIL:', m); }
function pass(m: string) { console.log('pass:', m); }
function assert(cond: unknown, name: string, detail?: string) {
  if (cond) pass(name); else fail(`${name}${detail ? ' — ' + detail : ''}`);
}

function chat(role: 'user' | 'assistant', text: string): AgentMessage {
  return { role, content: text };
}

function longMessages(n: number, chars = 4000): AgentMessage[] {
  const out: AgentMessage[] = [];
  for (let i = 0; i < n; i++) {
    const role = i % 2 === 0 ? 'user' : 'assistant';
    out.push(chat(role, `[msg ${i}] ` + 'x'.repeat(chars)));
  }
  return out;
}

async function main() {
  // ─── Case 1: under threshold ───────────────────────────────────────────
  {
    const messages = longMessages(5, 100); // ~500 chars total → ~125 tokens
    const result = await compressContextIfOversized(messages, {
      thresholdRatio: 0.5,
      maxContextTokens: 10_000,
      preserveLast: 2,
      summariser: async () => 'should not run',
    });
    assert(!result.compressed, 'case1: under-threshold returns compressed=false');
    assert(result.messages === messages, 'case1: returns original messages array when not compressing');
    assert(result.droppedCount === 0, 'case1: droppedCount=0');
  }

  // ─── Case 2: over threshold, tail preserved ────────────────────────────
  {
    const messages = longMessages(30, 4000); // ~30K tokens
    const result = await compressContextIfOversized(messages, {
      thresholdRatio: 0.5,
      maxContextTokens: 20_000,
      preserveLast: 5,
      summariser: async (toCompress) => `summarised ${toCompress.length} msgs`,
    });
    assert(result.compressed, 'case2: over-threshold returns compressed=true');
    assert(result.droppedCount === 25, `case2: dropped 25 msgs (got ${result.droppedCount})`);
    assert(result.messages.length === 6, `case2: result has 1 summary + 5 tail (got ${result.messages.length})`);
    const first = result.messages[0];
    const firstBlocks = typeof first.content === 'string' ? [{ type: 'text', text: first.content }] : first.content;
    assert(first.role === 'user', 'case2: summary message role=user');
    const firstText = firstBlocks[0].type === 'text' ? firstBlocks[0].text : '';
    assert(firstText.includes('[context-summary]'), 'case2: summary carries [context-summary] marker');
    assert(firstText.includes('summarised 25 msgs'), 'case2: summariser output appears in compressed message');
    // Last 5 messages should match the original tail byte-for-byte
    for (let i = 0; i < 5; i++) {
      const original = messages[messages.length - 5 + i];
      const preserved = result.messages[1 + i];
      assert(
        JSON.stringify(original) === JSON.stringify(preserved),
        `case2: tail[${i}] preserved verbatim`,
      );
    }
  }

  // ─── Case 3: tool_use/tool_result pair straddles cut → stays together ──
  {
    const pairId = 'tu-1';
    const messages: AgentMessage[] = [];
    // 30 filler messages
    for (let i = 0; i < 30; i++) {
      messages.push(chat(i % 2 === 0 ? 'user' : 'assistant', `[filler ${i}] ` + 'x'.repeat(4000)));
    }
    // Then the tool pair — assistant issues a tool_use; user carries the tool_result.
    messages.push({
      role: 'assistant',
      content: [
        { type: 'text', text: 'Using tool' },
        { type: 'tool_use', id: pairId, name: 'search', input: { q: 'hi' } },
      ],
    });
    messages.push({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: pairId, content: 'result body' }],
    });
    // Then 3 more tail messages so the natural cut lands between tool_use and tool_result.
    for (let i = 0; i < 3; i++) {
      messages.push(chat(i % 2 === 0 ? 'assistant' : 'user', `[tail ${i}] ok`));
    }
    // preserveLast = 4 would put the cut between the tool_use and tool_result.
    const result = await compressContextIfOversized(messages, {
      thresholdRatio: 0.5,
      maxContextTokens: 20_000,
      preserveLast: 4,
      summariser: async () => 'ok',
    });
    assert(result.compressed, 'case3: compression triggered');
    // The tail must contain the full pair — both the tool_use and the tool_result.
    const blocks: any[] = [];
    for (const m of result.messages) {
      const bl = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content;
      for (const b of bl) blocks.push(b);
    }
    const hasUse    = blocks.some((b) => b.type === 'tool_use' && b.id === pairId);
    const hasResult = blocks.some((b) => b.type === 'tool_result' && b.tool_use_id === pairId);
    assert(hasUse && hasResult, 'case3: both halves of tool pair survive');
  }

  // ─── Case 4: summariser throws → bail with original ────────────────────
  {
    const messages = longMessages(30, 4000);
    const result = await compressContextIfOversized(messages, {
      thresholdRatio: 0.5,
      maxContextTokens: 20_000,
      preserveLast: 5,
      summariser: async () => { throw new Error('boom'); },
    });
    assert(!result.compressed, 'case4: summariser throw → compressed=false');
    assert(result.messages === messages, 'case4: original messages returned on error');
  }

  // ─── Case 5: too-short history → no-op even if oversized ───────────────
  {
    const messages = longMessages(6, 4000);
    const result = await compressContextIfOversized(messages, {
      thresholdRatio: 0.5,
      maxContextTokens: 20_000,
      preserveLast: 20,           // bigger than history itself
      summariser: async () => 'nope',
    });
    assert(!result.compressed, 'case5: history shorter than preserveLast+MIN_DROP → no-op');
  }

  // ─── Case 6: token estimator sanity ────────────────────────────────────
  {
    const text = 'x'.repeat(400);
    const est = estimateMessagesTokens([chat('user', text)]);
    assert(est >= 90 && est <= 110, `case6: 400 chars ~ 100 tokens (got ${est})`);
  }

  if (failures > 0) {
    console.error(`\n${failures} context-compression smoke-test failure(s)`);
    process.exit(1);
  }
  console.log('\nAll context-compression smoke cases passed.');
}

main().catch((err) => { console.error('fatal:', err); process.exit(1); });
