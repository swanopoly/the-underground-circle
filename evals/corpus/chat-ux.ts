// chat-ux — a golden-case corpus module extending the deterministic eval net
// (docs/CHAT_ARCHITECTURE_STRATEGIC_PLAN_2026-07-15.md ADD #1: "an eval CI
// merge-gate … the safety net that makes every consolidation below safe"). Like
// its sibling corpora under evals/corpus/, it pins the exact OUTPUT of a batch
// of load-bearing PURE cores on FIXED inputs, so CI catches ANY behavioral drift
// with NO API keys, NO network, and NO flakiness.
//
// Cores covered (each imported AT RUNTIME — that is the whole point, it exercises
// them — and each itself dependency-light + tsx-loadable):
//   • capabilityOverviewCore      — the "what can you do?" catalog + empty-chat
//     starter suggestions + per-feature discovery hints.
//   • memoryIntentCore            — the pre-LLM natural-language memory
//     save/recall intent detector + the `/remember` `/forget` slash grammar.
//   • slashCommandCorrectionCore  — the did-you-mean fuzzy corrector for typo'd
//     slash commands.
//
// Each case's `run()` calls the REAL core fn on a frozen input and returns true
// iff the output equals the GOLDEN value captured from that same core (never
// invented). Every golden here was probed from live core output on 2026-07-15.
// Pure-ASCII outputs are pinned by full `JSON.stringify` equality; outputs that
// contain typographic characters (em dash / middle dot) are pinned by robust
// ASCII prefix + `includes` + `endsWith` field checks so a copy-fidelity slip can
// never mask a real regression. Each `run()` is self-contained + defensive
// (compares via a throw-safe JSON helper or guarded field reads; never throws).

import type { CoreGoldenCase } from '../coreGoldenCorpus';

import {
  buildCapabilityOverview,
  buildEmptyChatSuggestions,
  buildFeatureDiscoveryHint,
  CAPABILITY_CATALOG,
  OVERVIEW_MAX_CHARS,
} from '../../src/lib/capabilityOverviewCore';
import { detectMemoryIntent, parseMemoryCommand } from '../../src/lib/memoryIntentCore';
import {
  suggestSlashCommand,
  buildDidYouMean,
  levenshtein,
} from '../../src/lib/slashCommandCorrectionCore';

/** Throw-safe stable serializer for golden equality (cyclic → sentinel, never throws). */
const j = (v: unknown): string => {
  try {
    return JSON.stringify(v);
  } catch {
    return '__unstringifiable__';
  }
};

/** Frozen known-command list shared by the slash-correction cases (mirrors how
 *  ChatTab passes CHAT_COMMAND_REGISTRY commands + aliases in). */
const GOLDEN_KNOWN_COMMANDS: readonly string[] = [
  '/context',
  '/research',
  '/remember',
  '/memories',
  '/mission',
  '/help',
  '/browser',
  '/create',
];

/** The eight stable capability-catalog section titles (ASCII portion only). */
const CATALOG_TITLES: readonly string[] = [
  '**Coding on your repo**',
  '**Computer, browser & apps**',
  '**Tasks, missions & schedules**',
  '**Memory that sticks**',
  '**Knowledge & research**',
  '**Create anything**',
  '**Team accountability**',
  '**Integrations, models & vault**',
];

export const CASES: CoreGoldenCase[] = [
  // ── suite: capability-overview (capabilityOverviewCore) ─────────────────────
  {
    id: 'chat-ux-capability-catalog-stable-section-set',
    suite: 'capability-overview',
    describe:
      'CAPABILITY_CATALOG pins the exact 8-group section set in order (coding→…→integrations)',
    run: () =>
      j(CAPABILITY_CATALOG.map((g) => g.id)) ===
      '["coding","computer","tasks","memory","knowledge","create","team","integrations"]',
  },
  {
    id: 'chat-ux-capability-overview-default-titles-and-bounds',
    suite: 'capability-overview',
    describe:
      'the default overview leads with the intro, renders all 8 section titles + a real example, ends on the /apps trailer, and stays under OVERVIEW_MAX_CHARS',
    run: () => {
      const out = buildCapabilityOverview();
      return (
        typeof out === 'string' &&
        out.length > 500 &&
        out.length <= OVERVIEW_MAX_CHARS &&
        out.startsWith("**Here's what I can do**") &&
        CATALOG_TITLES.every((t) => out.includes(t)) &&
        out.includes('`/gh pr ship the login fix`') &&
        out.endsWith('`/apps` for which desktop apps I can drive.')
      );
    },
  },
  {
    id: 'chat-ux-capability-overview-compact-one-per-group',
    suite: 'capability-overview',
    describe:
      'the compact overview is the shorter one-bullet-per-group tour: it still names all 8 titles and the first example, and is strictly shorter than the default',
    run: () => {
      const compact = buildCapabilityOverview({ compact: true });
      const full = buildCapabilityOverview();
      return (
        typeof compact === 'string' &&
        compact.startsWith('**What I can do**') &&
        compact.includes('the compact tour:') &&
        CATALOG_TITLES.every((t) => compact.includes(t)) &&
        compact.includes('try `Fix the bug in @file:src/lib/auth.ts and run the tests`') &&
        compact.length < full.length
      );
    },
  },
  {
    id: 'chat-ux-empty-suggestions-default-four',
    suite: 'capability-overview',
    describe:
      'buildEmptyChatSuggestions() returns the four flagship-first starter prompts (coding, computer, create, team) in order',
    run: () =>
      j(buildEmptyChatSuggestions()) ===
      '["Fix the bug in @file:src/lib/auth.ts and run the tests","/browser extract the pricing table from example.com","/create a landing page for our beta waitlist","who checked in"]',
  },
  {
    id: 'chat-ux-empty-suggestions-max-zero-empty',
    suite: 'capability-overview',
    describe: 'a max of 0 yields an empty suggestion list (total, no throw)',
    run: () => j(buildEmptyChatSuggestions({ max: 0 })) === '[]',
  },
  {
    id: 'chat-ux-empty-suggestions-cap-six',
    suite: 'capability-overview',
    describe:
      'the starter list is hard-capped at 6 — an over-large max clamps to the same six-prompt list as max:6',
    run: () =>
      j(buildEmptyChatSuggestions({ max: 99 })) ===
        '["Fix the bug in @file:src/lib/auth.ts and run the tests","/browser extract the pricing table from example.com","/create a landing page for our beta waitlist","who checked in","/remember we deploy to Netlify on Fridays","/wiki habit stacking"]' &&
      j(buildEmptyChatSuggestions({ max: 99 })) === j(buildEmptyChatSuggestions({ max: 6 })),
  },
  {
    id: 'chat-ux-feature-hint-context-normalized',
    suite: 'capability-overview',
    describe:
      "the /context feature hint is stable and slash-prefix-insensitive ('context' and '/context' resolve identically); unknown/degenerate ids return ''",
    run: () => {
      const golden =
        'Tip: /context max loads everything I know each turn, /context lean keeps replies fast, and bare /context shows what I loaded last turn.';
      return (
        buildFeatureDiscoveryHint('context') === golden &&
        buildFeatureDiscoveryHint('/context') === golden &&
        buildFeatureDiscoveryHint('totally-unknown-xyz') === '' &&
        buildFeatureDiscoveryHint(null as unknown as string) === ''
      );
    },
  },
  {
    id: 'chat-ux-feature-hint-mentions-at-prefix',
    suite: 'capability-overview',
    describe: "the '@mentions' id (leading '@' normalized) teaches the @file:/@symbol: code-mention syntax",
    run: () =>
      buildFeatureDiscoveryHint('@mentions') ===
      'Tip: type @file:src/... or @symbol:name to pull real code into the chat.',
  },

  // ── suite: memory-intent (memoryIntentCore) ─────────────────────────────────
  {
    id: 'chat-ux-memory-remember-that-explicit',
    suite: 'memory-intent',
    describe:
      "'remember that X' is an EXPLICIT save whose lead phrase is stripped from content",
    run: () =>
      j(detectMemoryIntent('remember that we deploy on Fridays')) ===
      '{"kind":"remember","content":"we deploy on Fridays","confidence":"explicit"}',
  },
  {
    id: 'chat-ux-memory-question-is-none',
    suite: 'memory-intent',
    describe: 'a plain recall question (ends in ?) is NOT a memory write → neutral none intent',
    run: () =>
      j(detectMemoryIntent('what is the capital of France?')) ===
      '{"kind":"none","content":"","confidence":"implicit"}',
  },
  {
    id: 'chat-ux-memory-forget-that-explicit',
    suite: 'memory-intent',
    describe: "'forget that X' is an EXPLICIT delete intent with the lead phrase stripped",
    run: () =>
      j(detectMemoryIntent('forget that old deploy schedule')) ===
      '{"kind":"forget","content":"old deploy schedule","confidence":"explicit"}',
  },
  {
    id: 'chat-ux-memory-slash-defers-to-command',
    suite: 'memory-intent',
    describe:
      "a slash message ('/remember foo') is NOT handled by the NL detector — it defers to parseMemoryCommand → none",
    run: () =>
      j(detectMemoryIntent('/remember foo')) === '{"kind":"none","content":"","confidence":"implicit"}',
  },
  {
    id: 'chat-ux-memory-interrogative-remember-none',
    suite: 'memory-intent',
    describe:
      "bare 'remember when …' is a recall/nostalgia lead, not a save (interrogative reject) → none",
    run: () =>
      j(detectMemoryIntent('remember when we launched')) ===
      '{"kind":"none","content":"","confidence":"implicit"}',
  },
  {
    id: 'chat-ux-memory-command-remember-parses',
    suite: 'memory-intent',
    describe: "'/remember <fact>' parses to a remember command carrying the cleaned fact",
    run: () =>
      j(parseMemoryCommand('/remember Chris deploys on Fridays')) ===
      '{"action":"remember","content":"Chris deploys on Fridays"}',
  },
  {
    id: 'chat-ux-memory-command-bare-and-non-command',
    suite: 'memory-intent',
    describe:
      "bare '/remember' & '/forget' return the help action; a non-slash line and an unrelated slash command ('/memories') return null",
    run: () =>
      j(parseMemoryCommand('/forget')) === '{"action":"help","content":""}' &&
      j(parseMemoryCommand('/remember')) === '{"action":"help","content":""}' &&
      parseMemoryCommand('hello world') === null &&
      parseMemoryCommand('/memories') === null,
  },

  // ── suite: slash-command-correction (slashCommandCorrectionCore) ────────────
  {
    id: 'chat-ux-slash-typo-suggests-context',
    suite: 'slash-command-correction',
    describe: "a 1-edit typo '/contxt' is a non-exact slash message that suggests '/context'",
    run: () =>
      j(suggestSlashCommand('/contxt', GOLDEN_KNOWN_COMMANDS)) ===
      '{"isSlash":true,"exact":false,"suggestions":["/context"]}',
  },
  {
    id: 'chat-ux-slash-exact-no-suggest',
    suite: 'slash-command-correction',
    describe: "a valid '/context' is flagged exact and NEVER produces a suggestion",
    run: () =>
      j(suggestSlashCommand('/context', GOLDEN_KNOWN_COMMANDS)) ===
      '{"isSlash":true,"exact":true,"suggestions":[]}',
  },
  {
    id: 'chat-ux-slash-non-slash-not-slash',
    suite: 'slash-command-correction',
    describe: 'a non-slash line is not a slash message (isSlash false, no suggestions)',
    run: () =>
      j(suggestSlashCommand('hello world', GOLDEN_KNOWN_COMMANDS)) ===
      '{"isSlash":false,"exact":false,"suggestions":[]}',
  },
  {
    id: 'chat-ux-slash-prefix-surfaces-memories',
    suite: 'slash-command-correction',
    describe: "a partial token '/mem' surfaces the shared-prefix command '/memories' (not the far-off '/remember')",
    run: () =>
      j(suggestSlashCommand('/mem', GOLDEN_KNOWN_COMMANDS)) ===
      '{"isSlash":true,"exact":false,"suggestions":["/memories"]}',
  },
  {
    id: 'chat-ux-levenshtein-bounded-distance',
    suite: 'slash-command-correction',
    describe: 'the bounded Levenshtein distance is exact (kitten→sitting = 3; contxt→context = 1)',
    run: () => levenshtein('kitten', 'sitting') === 3 && levenshtein('contxt', 'context') === 1,
  },
  {
    id: 'chat-ux-slash-did-you-mean-render',
    suite: 'slash-command-correction',
    describe:
      'buildDidYouMean echoes the missed token with its suggestion; an empty suggestion list renders nothing (falls through to plain chat)',
    run: () =>
      buildDidYouMean('/contxt', ['/context']) ===
        "`/contxt` isn't a command I know. Did you mean: /context?  (or just send it as a message)" &&
      buildDidYouMean('/contxt', []) === '',
  },
];
