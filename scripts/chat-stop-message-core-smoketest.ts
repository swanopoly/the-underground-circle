/**
 * chat-stop-message-core-smoketest — pins the pure user-facing stop-message
 * resolver (src/lib/chatStopMessageCore.ts) that replaces SwanBot's raw
 * dead-end turn endings ("Tool-use call failed.", "Too many client-side
 * continuation rounds.", model-directed "Ask me to continue…" notes shown to
 * the user verbatim). Load-bearing assertions:
 *
 *   RESOLVE (resolveChatStopMessage): every canonical ChatStopReason yields a
 *   non-empty friendly message < 280 chars that is never model-directed, the
 *   expected canContinue flag, and <= 3 quick replies (Continue/Start fresh
 *   when continuable, Try again otherwise); internal aliases used by
 *   swanbot.ts ('continuation_failed'/'continuation_cap') and the typed loop
 *   ('loop_stopped_no_progress', 'max_tokens') map to the right reason;
 *   unknown/garbage/'__proto__' reasons fall back to the safe generic
 *   resolution; toolName is sanitized+woven into tool_use_failed /
 *   truncated_tool_call; unsafe (model-directed or internal-jargon) detail is
 *   dropped; huge toolName/detail stay bounded.
 *
 *   DETECT (isLikelyModelDirectedNote): the spec cues ("you should", "ask me
 *   to continue", "the model", "fresh observation", "do not repeat",
 *   "I stopped instead of") and the two real swanbot.ts v2 stop strings are
 *   flagged; benign user-facing text and non-strings are not.
 *
 *   HUMANIZE (humanizeStopText): the four real repo dead-end strings are
 *   replaced with the matching friendly resolution (inference), an explicit
 *   fallbackReason wins, empty/non-string input falls back, clean text passes
 *   through trimmed and bounded, and output is never model-directed.
 *
 *   And: deterministic, returned arrays are fresh per call, and every export
 *   is total — degenerate/hostile input never throws.
 *
 * Pure — loads under tsx (chatStopMessageCore has zero imports).
 */

import {
  CHAT_STOP_QUICK_REPLIES,
  resolveChatStopMessage,
  isLikelyModelDirectedNote,
  humanizeStopText,
  matchStopResolution,
  type ChatStopReason,
  type ChatStopResolution,
} from '../src/lib/chatStopMessageCore';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes++;
  else {
    failures++;
    console.error(`FAIL: ${msg}${extra ? ' :: ' + extra : ''}`);
  }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

/** Real strings currently produced by the runtime (verbatim from the repo). */
const SWANBOT_V2_CAP_STRING =
  'SwanBot v2 reached its client-tool continuation limit before it could produce a final answer. I stopped instead of falling back to legacy SwanBot so the same desktop or browser actions are not repeated. Ask me to continue and I will start from fresh evidence.';
const SWANBOT_V2_FAILED_STRING =
  'I ran the local SwanBot tool step, but the v2 continuation did not finish. I stopped instead of retrying through legacy SwanBot so I do not repeat a desktop or browser action. Ask me to continue after a fresh observation if you want me to proceed.';
const EDGE_CAP_STRING = 'Too many client-side continuation rounds.';
const EDGE_TOOL_FAILED_STRING = 'Tool-use call failed.';

const ALL_REASONS: ChatStopReason[] = [
  'v2_continuation_failed',
  'v2_continuation_cap',
  'step_cap',
  'truncated_tool_call',
  'interrupted_stream',
  'tool_use_failed',
  'stuck_loop',
  'edge_unreachable',
];

const EXPECTED: Record<ChatStopReason, { canContinue: boolean; replies: string }> = {
  v2_continuation_failed: { canContinue: true, replies: 'Continue|Start fresh' },
  v2_continuation_cap: { canContinue: true, replies: 'Continue|Start fresh' },
  step_cap: { canContinue: true, replies: 'Continue|Start fresh' },
  truncated_tool_call: { canContinue: true, replies: 'Continue|Start fresh' },
  interrupted_stream: { canContinue: true, replies: 'Continue|Start fresh' },
  tool_use_failed: { canContinue: false, replies: 'Try again' },
  stuck_loop: { canContinue: false, replies: 'Try again|Start fresh' },
  edge_unreachable: { canContinue: false, replies: 'Try again' },
};

function noThrow(label: string, fn: () => unknown): void {
  try {
    fn();
    assert(true, `${label} does not throw`);
  } catch (e) {
    assert(false, `${label} does not throw`, String(e));
  }
}

function main(): void {
  // (1) CHAT_STOP_QUICK_REPLIES canonical labels
  assertEq(CHAT_STOP_QUICK_REPLIES.continue, 'Continue', 'quick-reply continue label');
  assertEq(CHAT_STOP_QUICK_REPLIES.retry, 'Try again', 'quick-reply retry label');
  assertEq(CHAT_STOP_QUICK_REPLIES.fresh, 'Start fresh', 'quick-reply fresh label');
  assert(Object.isFrozen(CHAT_STOP_QUICK_REPLIES), 'quick-reply labels frozen');

  // (2) every canonical reason resolves to a bounded, friendly, actionable stop
  for (const reason of ALL_REASONS) {
    const r: ChatStopResolution = resolveChatStopMessage(reason);
    assert(typeof r.message === 'string' && r.message.trim().length > 0, `${reason}: message non-empty`);
    assert(r.message.length < 280, `${reason}: message < 280 chars`, `len ${r.message.length}`);
    assertEq(r.canContinue, EXPECTED[reason].canContinue, `${reason}: canContinue`);
    assertEq(r.quickReplies.join('|'), EXPECTED[reason].replies, `${reason}: quick replies`);
    assert(r.quickReplies.length >= 1 && r.quickReplies.length <= 3, `${reason}: 1..3 quick replies`);
    assert(!isLikelyModelDirectedNote(r.message), `${reason}: message not model-directed`, r.message);
  }

  // (3) continuable vs terminal semantics
  assert(resolveChatStopMessage('v2_continuation_cap').canContinue === true, 'cap is continuable');
  assert(resolveChatStopMessage('tool_use_failed').canContinue === false, 'tool failure is not continuable');
  assert(
    resolveChatStopMessage('step_cap').quickReplies.includes(CHAT_STOP_QUICK_REPLIES.continue),
    'step_cap offers Continue',
  );
  assert(
    resolveChatStopMessage('edge_unreachable').quickReplies.includes(CHAT_STOP_QUICK_REPLIES.retry),
    'edge_unreachable offers Try again',
  );
  assert(
    !resolveChatStopMessage('edge_unreachable').quickReplies.includes(CHAT_STOP_QUICK_REPLIES.continue),
    'edge_unreachable does not offer Continue',
  );
  assert(
    resolveChatStopMessage('stuck_loop').quickReplies.includes(CHAT_STOP_QUICK_REPLIES.fresh),
    'stuck_loop offers Start fresh',
  );

  // (4) runtime aliases + unknown reasons
  assertEq(
    resolveChatStopMessage('continuation_failed').message,
    resolveChatStopMessage('v2_continuation_failed').message,
    'swanbot.ts alias continuation_failed',
  );
  assertEq(
    resolveChatStopMessage('continuation_cap').message,
    resolveChatStopMessage('v2_continuation_cap').message,
    'swanbot.ts alias continuation_cap',
  );
  assertEq(
    resolveChatStopMessage('  STEP_CAP  ').message,
    resolveChatStopMessage('step_cap').message,
    'reason id is trimmed + case-insensitive',
  );
  assertEq(
    resolveChatStopMessage('loop_stopped_no_progress').message,
    resolveChatStopMessage('stuck_loop').message,
    'typed-loop alias loop_stopped_no_progress',
  );
  assertEq(
    resolveChatStopMessage('max_tokens').message,
    resolveChatStopMessage('truncated_tool_call').message,
    'alias max_tokens -> truncated_tool_call',
  );
  const generic = resolveChatStopMessage('totally_unknown_reason_xyz');
  assert(generic.message.length > 0 && generic.message.length < 280, 'unknown reason: generic bounded message');
  assertEq(generic.canContinue, false, 'unknown reason: not continuable');
  assertEq(generic.quickReplies.join('|'), 'Try again', 'unknown reason: Try again reply');
  assertEq(resolveChatStopMessage('__proto__').message, generic.message, '__proto__ reason is generic (no proto walk)');
  assertEq(resolveChatStopMessage('constructor').message, generic.message, 'constructor reason is generic');

  // (5) opts weaving: toolName + detail, sanitized and bounded
  const withTool = resolveChatStopMessage('tool_use_failed', { toolName: 'desktop.edit_file' });
  assert(withTool.message.includes('desktop.edit_file'), 'tool_use_failed weaves toolName', withTool.message);
  const truncTool = resolveChatStopMessage('truncated_tool_call', { toolName: 'gmail.send' });
  assert(truncTool.message.includes('gmail.send'), 'truncated_tool_call weaves toolName', truncTool.message);
  const injected = resolveChatStopMessage('tool_use_failed', { toolName: 'evil`$(rm)`\ntool' });
  assert(!injected.message.includes('`') && !injected.message.includes('\n'), 'toolName strips backticks/newlines');
  const hugeTool = resolveChatStopMessage('tool_use_failed', { toolName: 'x'.repeat(100000) });
  assert(hugeTool.message.length < 280, 'huge toolName stays bounded', `len ${hugeTool.message.length}`);
  assertEq(
    resolveChatStopMessage('step_cap', { toolName: 'desktop.edit_file' }).message,
    resolveChatStopMessage('step_cap').message,
    'toolName ignored where template has no slot',
  );
  const withDetail = resolveChatStopMessage('edge_unreachable', { detail: 'status 522 from edge' });
  assert(withDetail.message.includes('status 522 from edge'), 'safe detail is appended', withDetail.message);
  assert(withDetail.message.length < 280, 'detail-bearing message < 280 chars');
  assertEq(
    resolveChatStopMessage('edge_unreachable', { detail: 'Ask me to continue and I will start from fresh evidence.' }).message,
    resolveChatStopMessage('edge_unreachable').message,
    'model-directed detail is dropped',
  );
  assertEq(
    resolveChatStopMessage('edge_unreachable', { detail: EDGE_TOOL_FAILED_STRING }).message,
    resolveChatStopMessage('edge_unreachable').message,
    'internal-jargon detail is dropped',
  );
  const hugeDetail = resolveChatStopMessage('edge_unreachable', { detail: 'd'.repeat(500000) });
  assert(hugeDetail.message.length < 280, 'huge detail stays bounded', `len ${hugeDetail.message.length}`);
  assertEq(
    resolveChatStopMessage('tool_use_failed', { toolName: 42 as unknown as string }).message,
    resolveChatStopMessage('tool_use_failed').message,
    'non-string toolName ignored',
  );

  // (6) isLikelyModelDirectedNote: spec cues, real repo strings, benign text
  assert(isLikelyModelDirectedNote('You should retry the tool with fresh args.'), 'cue: you should');
  assert(isLikelyModelDirectedNote('Ask me to continue when ready.'), 'cue: ask me to continue');
  assert(isLikelyModelDirectedNote('The model must not proceed.'), 'cue: the model');
  assert(isLikelyModelDirectedNote('Retry only after a FRESH OBSERVATION of the screen.'), 'cue: fresh observation (case-insensitive)');
  assert(isLikelyModelDirectedNote('Do not repeat the desktop action.'), 'cue: do not repeat');
  assert(isLikelyModelDirectedNote('I stopped instead of falling back.'), 'cue: i stopped instead of');
  assert(isLikelyModelDirectedNote(SWANBOT_V2_CAP_STRING), 'real swanbot v2 cap string flagged');
  assert(isLikelyModelDirectedNote(SWANBOT_V2_FAILED_STRING), 'real swanbot v2 failed string flagged');
  assert(!isLikelyModelDirectedNote('Done! I updated the doc and shared the link.'), 'benign completion text not flagged');
  assert(!isLikelyModelDirectedNote("Here's the summary you asked for."), 'benign summary text not flagged');
  assert(!isLikelyModelDirectedNote('I could not find that file.'), 'benign failure text not flagged');
  assert(!isLikelyModelDirectedNote(''), 'empty string not flagged');
  assert(!isLikelyModelDirectedNote(null), 'null not flagged');
  assert(!isLikelyModelDirectedNote(12345), 'number not flagged');
  assert(!isLikelyModelDirectedNote({ text: 'you should' }), 'object not flagged');

  // (7) humanizeStopText: real dead-end strings become friendly resolutions
  assertEq(
    humanizeStopText(SWANBOT_V2_CAP_STRING),
    resolveChatStopMessage('v2_continuation_cap').message,
    'swanbot cap string humanized via inference',
  );
  assertEq(
    humanizeStopText(SWANBOT_V2_FAILED_STRING),
    resolveChatStopMessage('v2_continuation_failed').message,
    'swanbot failed string humanized via inference',
  );
  assertEq(
    humanizeStopText(EDGE_TOOL_FAILED_STRING, 'tool_use_failed'),
    resolveChatStopMessage('tool_use_failed').message,
    'raw "Tool-use call failed." replaced (explicit fallback)',
  );
  assertEq(
    humanizeStopText(EDGE_TOOL_FAILED_STRING),
    resolveChatStopMessage('tool_use_failed').message,
    'raw "Tool-use call failed." replaced (inference)',
  );
  assertEq(
    humanizeStopText(EDGE_CAP_STRING),
    resolveChatStopMessage('v2_continuation_cap').message,
    'raw "Too many client-side continuation rounds." replaced',
  );
  assertEq(
    humanizeStopText('you should re-run the tool', 'edge_unreachable'),
    resolveChatStopMessage('edge_unreachable').message,
    'explicit fallbackReason wins over inference',
  );
  assertEq(humanizeStopText(''), resolveChatStopMessage('unknown').message, 'empty text falls back to generic');
  assertEq(humanizeStopText('   \n\t '), resolveChatStopMessage('unknown').message, 'whitespace-only falls back');
  assertEq(humanizeStopText(null), resolveChatStopMessage('unknown').message, 'null falls back to generic');
  assertEq(
    humanizeStopText(undefined, 'stuck_loop'),
    resolveChatStopMessage('stuck_loop').message,
    'undefined text uses fallbackReason',
  );
  assertEq(humanizeStopText('  All done — the PR is up.  '), 'All done — the PR is up.', 'clean text passes through trimmed');
  const hugeClean = humanizeStopText('The task finished. ' + 'ok '.repeat(50000));
  assert(hugeClean.length < 280, 'huge clean text bounded < 280', `len ${hugeClean.length}`);
  assert(hugeClean.endsWith('…'), 'huge clean text truncation marked with ellipsis');
  for (const probe of [SWANBOT_V2_CAP_STRING, SWANBOT_V2_FAILED_STRING, EDGE_CAP_STRING, EDGE_TOOL_FAILED_STRING]) {
    assert(!isLikelyModelDirectedNote(humanizeStopText(probe)), 'humanized output never model-directed', probe.slice(0, 40));
  }

  // (8) determinism + fresh arrays per call
  assertEq(
    resolveChatStopMessage('stuck_loop').message,
    resolveChatStopMessage('stuck_loop').message,
    'deterministic message across calls',
  );
  const first = resolveChatStopMessage('step_cap');
  first.quickReplies.push('MUTATED');
  first.quickReplies[0] = 'MUTATED';
  const second = resolveChatStopMessage('step_cap');
  assertEq(second.quickReplies.join('|'), 'Continue|Start fresh', 'returned quickReplies are fresh per call');
  assert(first !== second, 'each call returns a new resolution object');

  // (9) degenerate input at every export: never throws
  noThrow('resolveChatStopMessage(null)', () => resolveChatStopMessage(null as unknown as string));
  noThrow('resolveChatStopMessage(undefined)', () => resolveChatStopMessage(undefined as unknown as string));
  noThrow('resolveChatStopMessage({})', () => resolveChatStopMessage({} as unknown as string));
  noThrow('resolveChatStopMessage([])', () => resolveChatStopMessage([] as unknown as string));
  noThrow('resolveChatStopMessage(Symbol)', () => resolveChatStopMessage(Symbol('x') as unknown as string));
  noThrow('resolveChatStopMessage(1e9 reason chars)', () => resolveChatStopMessage('r'.repeat(1_000_000)));
  noThrow('resolveChatStopMessage opts=string', () =>
    resolveChatStopMessage('step_cap', 'nope' as unknown as { toolName?: string }));
  noThrow('resolveChatStopMessage opts=array', () =>
    resolveChatStopMessage('step_cap', [] as unknown as { toolName?: string }));
  noThrow('resolveChatStopMessage hostile getter opts', () =>
    resolveChatStopMessage('step_cap', {
      get toolName(): string {
        throw new Error('boom');
      },
    } as { toolName?: string }));
  noThrow('isLikelyModelDirectedNote(undefined)', () => isLikelyModelDirectedNote(undefined));
  noThrow('isLikelyModelDirectedNote([])', () => isLikelyModelDirectedNote([]));
  noThrow('isLikelyModelDirectedNote(Symbol)', () => isLikelyModelDirectedNote(Symbol('y')));
  noThrow('isLikelyModelDirectedNote(function)', () => isLikelyModelDirectedNote(() => 'you should'));
  noThrow('isLikelyModelDirectedNote(huge)', () => isLikelyModelDirectedNote('z'.repeat(2_000_000)));
  noThrow('humanizeStopText({}, bad reason)', () =>
    humanizeStopText({}, 'not_a_reason' as unknown as ChatStopReason));
  noThrow('humanizeStopText([], null reason)', () =>
    humanizeStopText([], null as unknown as ChatStopReason));
  noThrow('humanizeStopText(Symbol)', () => humanizeStopText(Symbol('z')));
  noThrow('humanizeStopText(huge, undefined)', () => humanizeStopText('h'.repeat(2_000_000), undefined));
  // Degenerate calls still return the safe shape.
  const degenerate = resolveChatStopMessage(null as unknown as string);
  assert(
    typeof degenerate.message === 'string' && degenerate.message.length > 0 && degenerate.message.length < 280,
    'degenerate reason still yields bounded generic message',
  );
  assert(Array.isArray(degenerate.quickReplies) && degenerate.quickReplies.length <= 3, 'degenerate reason yields <=3 replies');
  assertEq(typeof humanizeStopText(undefined), 'string', 'humanizeStopText always returns a string');

  // ─── matchStopResolution — round-trip: a generated message is recognized ──
  for (const reason of ['v2_continuation_failed', 'v2_continuation_cap', 'step_cap', 'interrupted_stream', 'tool_use_failed', 'stuck_loop', 'edge_unreachable'] as ChatStopReason[]) {
    const gen = resolveChatStopMessage(reason);
    const matched = matchStopResolution(gen.message);
    assert(matched !== null, `matchStopResolution recognizes the ${reason} message`);
    assert(!!matched && matched.quickReplies.length === gen.quickReplies.length, `matched ${reason} carries its quick replies`);
    assert(!!matched && matched.canContinue === gen.canContinue, `matched ${reason} preserves canContinue`);
  }
  // withTool variant ("The <tool> step failed…") is still recognized.
  const toolFail = resolveChatStopMessage('tool_use_failed', { toolName: 'rooms.create' });
  assert(matchStopResolution(toolFail.message) !== null, 'matchStopResolution recognizes a withTool variant');
  // Ordinary answers are NOT mistaken for stop messages (precision guard).
  for (const ordinary of [
    'The weather in Paris is sunny today.',
    'The function sorts the array in place.',
    'Here is your summary of the document.',
    "I created the room and added three tasks.",
    'Sure! What would you like to build?',
    '',
    'ok',
  ]) {
    assertEq(matchStopResolution(ordinary), null, `ordinary answer not a false stop match: "${ordinary.slice(0, 30)}"`);
  }
  noThrow('matchStopResolution(null)', () => matchStopResolution(null));
  noThrow('matchStopResolution(number)', () => matchStopResolution(42));
  noThrow('matchStopResolution(huge)', () => matchStopResolution('x'.repeat(1_000_000)));

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll chatStopMessageCore smoke cases passed (${passes} passed).`);
}

main();
