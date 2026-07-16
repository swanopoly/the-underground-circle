// Smoke test for chatMessageTypes — pure, tsx-loadable, deterministic.
// Run: npx tsx scripts/chat-message-types-smoketest.ts
//
// Exercises the type-guard / shape helpers that travel with the moved
// ChatMessage / ChatMessageSource / ChatBotMessageExtra types (decomposition
// U0). Representative message objects + a hostile no-throw sweep. 50+ assertions.
import {
  isChatMessage,
  isChatBotMessage,
  isChatUserMessage,
  isChatMessageSource,
  isChatBotMessageExtra,
  getChatMessageId,
  getChatMessageText,
  chatMessageHasArtifacts,
  isPendingChatMessage,
  chatMessageShowsRouteChips,
  chatMessageSourceModelLabel,
  chatMessageSourceProvider,
  chatMessageReactionEmojis,
  chatMessageReactionCount,
  countChatMessageMemoryRefs,
  type ChatMessage,
  type ChatMessageSource,
} from '../src/lib/chatMessageTypes';

let passed = 0;
let failed = 0;

function assert(label: string, cond: boolean): void {
  if (cond) {
    passed += 1;
  } else {
    failed += 1;
    console.error(`  FAIL: ${label}`);
  }
}

function assertEq<T>(label: string, actual: T, expected: T): void {
  assert(`${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`, actual === expected);
}

function noThrow(label: string, fn: () => unknown): void {
  try {
    fn();
    assert(label, true);
  } catch (e) {
    assert(`${label} — THREW: ${String(e)}`, false);
  }
}

// ─── Representative message objects ──────────────────────────────────────────

const botMsg: ChatMessage = {
  id: 'b1',
  content: 'Hello from the agent',
  isBot: true,
  isUser: false,
  timestamp: new Date('2026-07-14T00:00:00Z'),
  reactions: { '👍': ['u1', 'u2'], '🎉': ['u3'] },
  source: {
    actor: 'swanbot',
    surface: 'chat',
    selectedModel: 'auto',
    effectiveModel: 'claude-haiku-4-5',
    provider: 'anthropic',
    showRouteChips: true,
  },
};

const userMsg: ChatMessage = {
  id: 'u1',
  content: 'hi there',
  isBot: false,
  isUser: true,
  timestamp: new Date('2026-07-14T00:01:00Z'),
  reactions: {},
};

const pendingMsg: ChatMessage = {
  id: 'p1',
  content: '',
  isBot: true,
  isUser: false,
  timestamp: new Date('2026-07-14T00:02:00Z'),
  reactions: {},
  isPending: true,
};

const withArtifacts = {
  ...botMsg,
  artifacts: [{ type: 'code', title: 'snippet' }],
} as unknown as ChatMessage;

const fullSource: ChatMessageSource = {
  actor: 'swanbot',
  surface: 'office',
  selectedModel: 'openrouter/auto',
  effectiveModel: 'anthropic/claude-sonnet-4.6',
  provider: 'openrouter',
  showRouteChips: false,
};

// Cyclic object — property access must not recurse or throw.
const cyclic: Record<string, unknown> = {
  id: 'c1',
  content: 'cyclic',
  isBot: false,
  isUser: true,
  timestamp: new Date('2026-07-14T00:03:00Z'),
  reactions: {},
};
cyclic.self = cyclic;

// Hostile Proxy — every trap throws; helpers must swallow and return neutral.
const throwingProxy = new Proxy(
  {},
  {
    get() {
      throw new Error('boom get');
    },
    ownKeys() {
      throw new Error('boom ownKeys');
    },
    getOwnPropertyDescriptor() {
      throw new Error('boom descriptor');
    },
    has() {
      throw new Error('boom has');
    },
  },
);

// ─── 1. isChatMessage ────────────────────────────────────────────────────────
assert('isChatMessage bot valid', isChatMessage(botMsg) === true);
assert('isChatMessage user valid', isChatMessage(userMsg) === true);
assert('isChatMessage pending valid', isChatMessage(pendingMsg) === true);
assert('isChatMessage cyclic valid', isChatMessage(cyclic) === true);
assert('isChatMessage null', isChatMessage(null) === false);
assert('isChatMessage undefined', isChatMessage(undefined) === false);
assert('isChatMessage empty object', isChatMessage({}) === false);
assert('isChatMessage array', isChatMessage([1, 2, 3]) === false);
assert('isChatMessage number', isChatMessage(42) === false);
assert('isChatMessage string', isChatMessage('msg') === false);
assert('isChatMessage bare Date', isChatMessage(new Date('2026-07-14T00:00:00Z')) === false);
assert('isChatMessage wrong id type', isChatMessage({ ...botMsg, id: 123 }) === false);
assert('isChatMessage missing content', isChatMessage({ id: 'x', isBot: true, isUser: false, timestamp: new Date('2026-07-14T00:00:00Z'), reactions: {} }) === false);
assert('isChatMessage isBot not boolean', isChatMessage({ ...botMsg, isBot: 'yes' }) === false);
assert('isChatMessage isUser not boolean', isChatMessage({ ...botMsg, isUser: 1 }) === false);
assert('isChatMessage timestamp not Date', isChatMessage({ ...botMsg, timestamp: 1_752_000_000_000 }) === false);
assert('isChatMessage reactions missing', isChatMessage({ id: 'x', content: 'c', isBot: true, isUser: false, timestamp: new Date('2026-07-14T00:00:00Z') }) === false);
assert('isChatMessage reactions is array', isChatMessage({ ...botMsg, reactions: [] }) === false);
assert('isChatMessage reactions null', isChatMessage({ ...botMsg, reactions: null }) === false);

// ─── 2. isChatBotMessage / isChatUserMessage ─────────────────────────────────
assert('isChatBotMessage bot true', isChatBotMessage(botMsg) === true);
assert('isChatBotMessage pending (bot) true', isChatBotMessage(pendingMsg) === true);
assert('isChatBotMessage user false', isChatBotMessage(userMsg) === false);
assert('isChatBotMessage null false', isChatBotMessage(null) === false);
assert('isChatBotMessage non-message false', isChatBotMessage({ isBot: true }) === false);
assert('isChatUserMessage user true', isChatUserMessage(userMsg) === true);
assert('isChatUserMessage cyclic (user) true', isChatUserMessage(cyclic) === true);
assert('isChatUserMessage bot false', isChatUserMessage(botMsg) === false);
assert('isChatUserMessage null false', isChatUserMessage(null) === false);

// ─── 3. isChatMessageSource ──────────────────────────────────────────────────
assert('isChatMessageSource empty object', isChatMessageSource({}) === true);
assert('isChatMessageSource full', isChatMessageSource(fullSource) === true);
assert('isChatMessageSource partial actor', isChatMessageSource({ actor: 'x' }) === true);
assert('isChatMessageSource selectedModel null ok', isChatMessageSource({ selectedModel: null }) === true);
assert('isChatMessageSource effectiveModel null ok', isChatMessageSource({ effectiveModel: null }) === true);
assert('isChatMessageSource provider null ok', isChatMessageSource({ provider: null }) === true);
assert('isChatMessageSource actor wrong type', isChatMessageSource({ actor: 5 }) === false);
assert('isChatMessageSource surface wrong type', isChatMessageSource({ surface: true }) === false);
assert('isChatMessageSource effectiveModel wrong type', isChatMessageSource({ effectiveModel: 5 }) === false);
assert('isChatMessageSource showRouteChips wrong type', isChatMessageSource({ showRouteChips: 'yes' }) === false);
assert('isChatMessageSource null', isChatMessageSource(null) === false);
assert('isChatMessageSource array', isChatMessageSource([]) === false);
assert('isChatMessageSource string', isChatMessageSource('src') === false);

// ─── 4. isChatBotMessageExtra ────────────────────────────────────────────────
assert('isChatBotMessageExtra empty object', isChatBotMessageExtra({}) === true);
assert('isChatBotMessageExtra localOnly true', isChatBotMessageExtra({ localOnly: true }) === true);
assert('isChatBotMessageExtra runId null', isChatBotMessageExtra({ runId: null }) === true);
assert('isChatBotMessageExtra runId string', isChatBotMessageExtra({ runId: 'r1' }) === true);
assert('isChatBotMessageExtra commandsHelp true', isChatBotMessageExtra({ commandsHelp: true }) === true);
assert('isChatBotMessageExtra showRunTrace false', isChatBotMessageExtra({ showRunTrace: false }) === true);
assert('isChatBotMessageExtra localOnly wrong type', isChatBotMessageExtra({ localOnly: 'x' }) === false);
assert('isChatBotMessageExtra runId wrong type', isChatBotMessageExtra({ runId: 5 }) === false);
assert('isChatBotMessageExtra commandsHelp wrong type', isChatBotMessageExtra({ commandsHelp: 'x' }) === false);
assert('isChatBotMessageExtra showRunTrace wrong type', isChatBotMessageExtra({ showRunTrace: 1 }) === false);
assert('isChatBotMessageExtra null', isChatBotMessageExtra(null) === false);
assert('isChatBotMessageExtra array', isChatBotMessageExtra([]) === false);

// ─── 5. getChatMessageId / getChatMessageText ────────────────────────────────
assertEq('getChatMessageId bot', getChatMessageId(botMsg), 'b1');
assertEq('getChatMessageId user', getChatMessageId(userMsg), 'u1');
assertEq('getChatMessageId null', getChatMessageId(null), '');
assertEq('getChatMessageId wrong-type id', getChatMessageId({ id: 5 }), '');
assertEq('getChatMessageText bot', getChatMessageText(botMsg), 'Hello from the agent');
assertEq('getChatMessageText user', getChatMessageText(userMsg), 'hi there');
assertEq('getChatMessageText empty content', getChatMessageText(pendingMsg), '');
assertEq('getChatMessageText null', getChatMessageText(null), '');
assertEq('getChatMessageText wrong-type content', getChatMessageText({ content: 5 }), '');

// ─── 6. hasArtifacts / isPending / showsRouteChips ───────────────────────────
assert('chatMessageHasArtifacts withArtifacts true', chatMessageHasArtifacts(withArtifacts) === true);
assert('chatMessageHasArtifacts none false', chatMessageHasArtifacts(botMsg) === false);
assert('chatMessageHasArtifacts empty array false', chatMessageHasArtifacts({ artifacts: [] }) === false);
assert('chatMessageHasArtifacts null false', chatMessageHasArtifacts(null) === false);
assert('isPendingChatMessage pending true', isPendingChatMessage(pendingMsg) === true);
assert('isPendingChatMessage bot false', isPendingChatMessage(botMsg) === false);
assert('isPendingChatMessage null false', isPendingChatMessage(null) === false);
assert('chatMessageShowsRouteChips bot (true source) true', chatMessageShowsRouteChips(botMsg) === true);
assert('chatMessageShowsRouteChips user (no source) false', chatMessageShowsRouteChips(userMsg) === false);
assert('chatMessageShowsRouteChips explicit false', chatMessageShowsRouteChips({ source: { showRouteChips: false } }) === false);
assert('chatMessageShowsRouteChips null false', chatMessageShowsRouteChips(null) === false);

// ─── 7. sourceModelLabel / sourceProvider ────────────────────────────────────
assertEq('modelLabel prefers effective', chatMessageSourceModelLabel(botMsg.source), 'claude-haiku-4-5');
assertEq('modelLabel falls back to selected', chatMessageSourceModelLabel({ selectedModel: 'gpt-4o' }), 'gpt-4o');
assertEq('modelLabel empty effective -> selected', chatMessageSourceModelLabel({ effectiveModel: '  ', selectedModel: 'auto' }), 'auto');
assertEq('modelLabel trims', chatMessageSourceModelLabel({ effectiveModel: '  claude-opus-4-8  ' }), 'claude-opus-4-8');
assertEq('modelLabel empty source', chatMessageSourceModelLabel({}), '');
assertEq('modelLabel null', chatMessageSourceModelLabel(null), '');
assertEq('modelLabel long truncated to 200', chatMessageSourceModelLabel({ effectiveModel: 'm'.repeat(500) }).length, 200);
assertEq('sourceProvider bot', chatMessageSourceProvider(botMsg.source), 'anthropic');
assertEq('sourceProvider empty', chatMessageSourceProvider({}), '');
assertEq('sourceProvider null', chatMessageSourceProvider(null), '');
assertEq('sourceProvider wrong type', chatMessageSourceProvider({ provider: 5 }), '');

// ─── 8. reactions + memory refs ──────────────────────────────────────────────
assertEq('reactionEmojis bot count', chatMessageReactionEmojis(botMsg).length, 2);
assert('reactionEmojis bot includes 👍', chatMessageReactionEmojis(botMsg).includes('👍'));
assert('reactionEmojis bot includes 🎉', chatMessageReactionEmojis(botMsg).includes('🎉'));
assertEq('reactionEmojis user empty', chatMessageReactionEmojis(userMsg).length, 0);
assertEq('reactionEmojis null empty', chatMessageReactionEmojis(null).length, 0);
{
  const bigReactions: Record<string, string[]> = {};
  for (let i = 0; i < 300; i += 1) bigReactions[`e${i}`] = ['u'];
  const bigMsg = { ...userMsg, reactions: bigReactions } as unknown as ChatMessage;
  assertEq('reactionEmojis capped at 128', chatMessageReactionEmojis(bigMsg).length, 128);
}
assertEq('reactionCount 👍 = 2', chatMessageReactionCount(botMsg, '👍'), 2);
assertEq('reactionCount 🎉 = 1', chatMessageReactionCount(botMsg, '🎉'), 1);
assertEq('reactionCount missing emoji = 0', chatMessageReactionCount(botMsg, '❌'), 0);
assertEq('reactionCount non-string emoji = 0', chatMessageReactionCount(botMsg, 123), 0);
assertEq('reactionCount null message = 0', chatMessageReactionCount(null, '👍'), 0);
assertEq('reactionCount __proto__ safe = 0', chatMessageReactionCount(botMsg, '__proto__'), 0);
assertEq('countMemoryRefs two', countChatMessageMemoryRefs({ memoryRefs: [{}, {}] }), 2);
assertEq('countMemoryRefs none', countChatMessageMemoryRefs(botMsg), 0);
assertEq('countMemoryRefs null', countChatMessageMemoryRefs(null), 0);
assertEq('countMemoryRefs wrong type', countChatMessageMemoryRefs({ memoryRefs: 'nope' }), 0);

// ─── 9. HOSTILE no-throw sweep (every export × every hostile input) ───────────
const hostileInputs: unknown[] = [
  null,
  undefined,
  0,
  1,
  -1,
  NaN,
  Infinity,
  '',
  'string',
  true,
  false,
  [],
  [1, 2, 3],
  {},
  () => undefined,
  Symbol('s'),
  123n,
  new Date('2026-07-14T00:00:00Z'),
  { id: 123 },
  { id: 'x' },
  cyclic,
  throwingProxy,
];

const unaryFns: Array<[string, (v: unknown) => unknown]> = [
  ['isChatMessage', isChatMessage],
  ['isChatBotMessage', isChatBotMessage],
  ['isChatUserMessage', isChatUserMessage],
  ['isChatMessageSource', isChatMessageSource],
  ['isChatBotMessageExtra', isChatBotMessageExtra],
  ['getChatMessageId', getChatMessageId],
  ['getChatMessageText', getChatMessageText],
  ['chatMessageHasArtifacts', chatMessageHasArtifacts],
  ['isPendingChatMessage', isPendingChatMessage],
  ['chatMessageShowsRouteChips', chatMessageShowsRouteChips],
  ['chatMessageSourceModelLabel', chatMessageSourceModelLabel],
  ['chatMessageSourceProvider', chatMessageSourceProvider],
  ['chatMessageReactionEmojis', chatMessageReactionEmojis],
  ['countChatMessageMemoryRefs', countChatMessageMemoryRefs],
];

for (const input of hostileInputs) {
  const tag = (() => {
    try {
      return typeof input === 'symbol' ? 'symbol' : String(input);
    } catch {
      return 'unprintable';
    }
  })();
  noThrow(`hostile sweep [${tag}] all unary fns no-throw`, () => {
    for (const [, fn] of unaryFns) fn(input);
    chatMessageReactionCount(input, '👍');
    chatMessageReactionCount(input, input);
  });
}

// Neutral-return spot checks on the nastiest inputs.
assert('throwingProxy isChatMessage -> false', isChatMessage(throwingProxy) === false);
assert('throwingProxy reactionEmojis -> []', chatMessageReactionEmojis(throwingProxy).length === 0);
assertEq('throwingProxy modelLabel -> ""', chatMessageSourceModelLabel(throwingProxy), '');
assertEq('throwingProxy getChatMessageId -> ""', getChatMessageId(throwingProxy), '');
assert('throwingProxy hasArtifacts -> false', chatMessageHasArtifacts(throwingProxy) === false);
assertEq('throwingProxy reactionCount -> 0', chatMessageReactionCount(throwingProxy, '👍'), 0);
assert('function input isChatMessage -> false', isChatMessage(() => undefined) === false);
assert('bigint input isChatMessageSource -> false', isChatMessageSource(123n) === false);

// ─── done ────────────────────────────────────────────────────────────────────
console.log(`chat-message-types smoke: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log('chat-message-types smoke: ALL PASS');
