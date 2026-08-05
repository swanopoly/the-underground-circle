// evals/corpus/v2-loop.ts — a SATELLITE golden-case corpus module for the
// deterministic tier-1 eval net (docs/CHAT_ARCHITECTURE_STRATEGIC_PLAN_2026-07-15.md,
// ADD #1: "an eval CI merge-gate … the safety net that makes every
// consolidation below safe"). It mirrors the shape of `evals/coreGoldenCorpus.ts`
// — an array of `CoreGoldenCase`, each pinning the exact OUTPUT of a real pure
// core on a FROZEN input — but scopes to the two load-bearing cores of the v2
// SwanBot client-tool CONTINUATION LOOP:
//
//   • src/lib/v2ToolSelectionCore.ts        — which tool GROUPS a turn receives
//     (the decision that replaced swanbot-v2-ai's ~14 blind single-keyword
//     regexes; a phrasing miss there dropped a whole tool group for the entire
//     run and made the model falsely refuse). The load-bearing invariant: a
//     request that needs a tool GETS that group (incl. the capability-edge and
//     imperative-floor recall fixes), while a plain chat gets NONE.
//   • src/lib/swanbotContinuationBudgetCore.ts — may the loop start ANOTHER
//     continuation round? The load-bearing invariant: below the ceiling →
//     continue; at/over the ceiling → STOP; coding tasks get a deeper ceiling;
//     a hostile/unparseable round count fails CLOSED to STOP (never an unbounded
//     loop).
//
// PURITY EXCEPTION (spec-sanctioned, same as the parent corpus): this module
// IMPORTS the cores AT RUNTIME — that is the whole point, it exercises them.
// Both cores are the DENO-edge-importable, dependency-light, tsx-loadable pure
// cores (zero runtime imports, no Date.now()/random), so this file runs under
// tsx with no react-native / supabase / deno in the graph.
//
// EVERY golden value below was CAPTURED from the REAL core output (via a tsx
// probe), never invented. Each `run()` is self-contained, defensive, and TOTAL
// (the cores never throw, and the compares guard their inputs); it returns
// `true` iff the real output still equals the pinned golden — so any behavioral
// drift flips exactly its case pass→fail.

import type { CoreGoldenCase } from '../coreGoldenCorpus';
import { selectToolGroups, isImperativeActionText } from '../../src/lib/v2ToolSelectionCore';
import { nextContinuationDecision } from '../../src/lib/swanbotContinuationBudgetCore';

// ─── Tiny defensive helpers (self-contained; never throw) ─────────────────────

/** JSON of a selection's `groups` array (the load-bearing decision), or `null`
 *  if the output is malformed — so a broken shape can never accidentally match. */
function groupsJson(sel: unknown): string {
  const g = (sel as { groups?: unknown } | null | undefined)?.groups;
  return JSON.stringify(Array.isArray(g) ? g : null);
}

/** True iff the selection's diagnostic `reason` contains `needle` — used to pin
 *  that the RIGHT mechanism (a capability edge / the imperative floor) fired,
 *  not a coincidental keyword hit. */
function reasonHas(sel: unknown, needle: string): boolean {
  const r = (sel as { reason?: unknown } | null | undefined)?.reason;
  return typeof r === 'string' && r.includes(needle);
}

/** Full-object JSON of a continuation decision, or `null` on a malformed shape.
 *  The whole `{shouldContinue,roundsLeft,atCap,reason}` is load-bearing, so the
 *  budget cases pin the entire object. */
function decisionJson(d: unknown): string {
  if (!d || typeof d !== 'object') return JSON.stringify(null);
  const o = d as Record<string, unknown>;
  if (typeof o.shouldContinue !== 'boolean' || typeof o.atCap !== 'boolean') return JSON.stringify(null);
  return JSON.stringify(d);
}

// ─── The corpus ───────────────────────────────────────────────────────────────

export const CASES: CoreGoldenCase[] = [
  // ══ suite: v2-tool-selection (v2ToolSelectionCore.selectToolGroups) ══════════

  {
    id: 'v2-loop-toolsel-plain-chat-selects-no-groups',
    suite: 'v2-tool-selection',
    describe:
      'a plain conversational turn with no capability signal selects ZERO tool groups (reason "no-signal") — the false-refusal-avoiding baseline the regex block replaced',
    run: () => {
      const sel = selectToolGroups('hello how are you today', '');
      return groupsJson(sel) === '[]' && reasonHas(sel, 'no-signal');
    },
  },
  {
    id: 'v2-loop-toolsel-memory-request-selects-memory',
    suite: 'v2-tool-selection',
    describe: "a request that needs a tool ('remember that I prefer dark mode') selects exactly the memory group",
    run: () => {
      const sel = selectToolGroups('remember that I prefer dark mode', '');
      return groupsJson(sel) === '["memory"]' && reasonHas(sel, 'kw:memory');
    },
  },
  {
    id: 'v2-loop-toolsel-research-citation-selects-research',
    suite: 'v2-tool-selection',
    describe: 'a research+citation request selects the research group (plus browser for the url) — never empty',
    run: () => {
      const sel = selectToolGroups('research the latest docs and cite the source url', '');
      return groupsJson(sel) === '["research","browser"]';
    },
  },
  {
    id: 'v2-loop-toolsel-login-adds-credentials-via-edge',
    suite: 'v2-tool-selection',
    describe: "a browser-login phrasing ('please log in to my account') pulls in credentials via the browser-login→credentials capability edge",
    run: () => {
      const sel = selectToolGroups('please log in to my account', '');
      return groupsJson(sel) === '["browser","credentials"]' && reasonHas(sel, 'edge:browser-login→credentials');
    },
  },
  {
    id: 'v2-loop-toolsel-credential-adds-browser-via-edge',
    suite: 'v2-tool-selection',
    describe: "a credential ask ('get my password from the vault') pulls in browser via the credentials→browser capability edge",
    run: () => {
      const sel = selectToolGroups('get my password from the vault', '');
      return groupsJson(sel) === '["browser","credentials"]' && reasonHas(sel, 'edge:credentials→browser');
    },
  },
  {
    id: 'v2-loop-toolsel-filepath-adds-coding-via-edge',
    suite: 'v2-tool-selection',
    describe: 'a concrete source-file path (~/Users/me/app.ts) adds the coding group via the desktop-file-path→coding edge',
    run: () => {
      const sel = selectToolGroups('open ~/Users/me/app.ts and edit it', '');
      return groupsJson(sel) === '["desktop","coding"]' && reasonHas(sel, 'edge:desktop-file-path→coding');
    },
  },
  {
    id: 'v2-loop-toolsel-imperative-floor-widens-recall',
    suite: 'v2-tool-selection',
    describe: "a genuine imperative command ('fix the failing tests') fires the imperative-floor, adding workspace+tasks+research on top of the keyword hit so an action never starts tool-starved",
    run: () => {
      const sel = selectToolGroups('fix the failing tests', '');
      return groupsJson(sel) === '["research","tasks","workspace","verification"]' && reasonHas(sel, 'imperative-floor');
    },
  },
  {
    id: 'v2-loop-toolsel-interrogative-not-imperative',
    suite: 'v2-tool-selection',
    describe: 'isImperativeActionText fires on a real command but NOT on a question phrased with the same verb ("can you fix the bug?")',
    run: () => isImperativeActionText('fix the bug') === true && isImperativeActionText('can you fix the bug?') === false,
  },
  {
    id: 'v2-loop-toolsel-mode-build-parity',
    suite: 'v2-tool-selection',
    describe: "the 'build' mode alone (empty text) selects workspace+coding, reproducing the edge fn's mode→group block",
    run: () => {
      const sel = selectToolGroups('', 'build');
      return groupsJson(sel) === '["workspace","coding"]' && reasonHas(sel, 'mode:build');
    },
  },
  {
    id: 'v2-loop-toolsel-hostile-input-total-no-groups',
    suite: 'v2-tool-selection',
    describe: 'hostile input (null, and a self-cyclic object) never throws and yields an empty, no-signal selection',
    run: () => {
      const cyc: Record<string, unknown> = {};
      cyc.self = cyc;
      const a = selectToolGroups(null, null);
      const b = selectToolGroups(cyc, '');
      return groupsJson(a) === '[]' && reasonHas(a, 'no-signal') && groupsJson(b) === '[]';
    },
  },

  // ══ suite: swanbot-continuation-budget (nextContinuationDecision) ════════════

  {
    id: 'v2-loop-contbudget-fresh-run-continues',
    suite: 'swanbot-continuation-budget',
    describe: 'a fresh run (0 completed rounds) may continue with the full base budget of 6 rounds left',
    run: () =>
      decisionJson(nextContinuationDecision({ continuationCount: 0 })) ===
      '{"shouldContinue":true,"roundsLeft":6,"atCap":false,"reason":"continue:0/6(base)"}',
  },
  {
    id: 'v2-loop-contbudget-below-ceiling-continues',
    suite: 'swanbot-continuation-budget',
    describe: 'with 5 of 6 base rounds completed the loop may continue, reporting exactly 1 round left and atCap false',
    run: () =>
      decisionJson(nextContinuationDecision({ continuationCount: 5 })) ===
      '{"shouldContinue":true,"roundsLeft":1,"atCap":false,"reason":"continue:5/6(base)"}',
  },
  {
    id: 'v2-loop-contbudget-at-ceiling-stops',
    suite: 'swanbot-continuation-budget',
    describe: 'at the base ceiling (6 of 6 rounds completed) the loop STOPS: shouldContinue false, atCap true, 0 rounds left',
    run: () =>
      decisionJson(nextContinuationDecision({ continuationCount: 6 })) ===
      '{"shouldContinue":false,"roundsLeft":0,"atCap":true,"reason":"at-cap:6/6(base)"}',
  },
  {
    id: 'v2-loop-contbudget-coding-deeper-ceiling',
    suite: 'swanbot-continuation-budget',
    describe: 'at 6 completed rounds a base run STOPS but a coding task CONTINUES (deeper 10-round ceiling, 4 left) — pinning the base↔coding divergence at the same count',
    run: () => {
      const base = nextContinuationDecision({ continuationCount: 6 });
      const coding = nextContinuationDecision({ continuationCount: 6, isCodingTask: true });
      return (
        base.shouldContinue === false &&
        decisionJson(coding) === '{"shouldContinue":true,"roundsLeft":4,"atCap":false,"reason":"continue:6/10(coding)"}'
      );
    },
  },
  {
    id: 'v2-loop-contbudget-coding-caps-at-ten',
    suite: 'swanbot-continuation-budget',
    describe: 'a coding task still caps: at 10 of 10 completed rounds it STOPS (atCap true, 0 left)',
    run: () =>
      decisionJson(nextContinuationDecision({ continuationCount: 10, isCodingTask: true })) ===
      '{"shouldContinue":false,"roundsLeft":0,"atCap":true,"reason":"at-cap:10/10(coding)"}',
  },
  {
    id: 'v2-loop-contbudget-hostile-count-fails-closed',
    suite: 'swanbot-continuation-budget',
    describe: 'an unparseable/hostile round count (negative, NaN, non-numeric string, null input) fails CLOSED to a STOP decision — never treated as "0 → keep going"',
    run: () => {
      const inputs: unknown[] = [
        { continuationCount: -1 },
        { continuationCount: NaN },
        { continuationCount: 'abc' },
        null,
        {},
      ];
      return inputs.every((i) => {
        const d = nextContinuationDecision(i as { continuationCount: unknown });
        return d.shouldContinue === false && d.atCap === true && d.roundsLeft === 0;
      });
    },
  },
  {
    id: 'v2-loop-contbudget-override-clamped-to-hard-max',
    suite: 'swanbot-continuation-budget',
    describe: 'a hostile huge maxOverride (100) is clamped to the hard max of 24, so 3 completed rounds continue with 21 left',
    run: () =>
      decisionJson(nextContinuationDecision({ continuationCount: 3, maxOverride: 100 })) ===
      '{"shouldContinue":true,"roundsLeft":21,"atCap":false,"reason":"continue:3/24(override)"}',
  },
  {
    id: 'v2-loop-contbudget-override-below-count-stops',
    suite: 'swanbot-continuation-budget',
    describe: 'an explicit maxOverride (2) below the completed-round count (3) STOPS the loop — the override takes precedence and caps',
    run: () =>
      decisionJson(nextContinuationDecision({ continuationCount: 3, maxOverride: 2 })) ===
      '{"shouldContinue":false,"roundsLeft":0,"atCap":true,"reason":"at-cap:3/2(override)"}',
  },
  {
    id: 'v2-loop-contbudget-numeric-string-parsed',
    suite: 'swanbot-continuation-budget',
    describe: "a numeric-string round count ('3') is parsed like the number 3 and continues (3/6 base, 3 left)",
    run: () =>
      decisionJson(nextContinuationDecision({ continuationCount: '3' })) ===
      '{"shouldContinue":true,"roundsLeft":3,"atCap":false,"reason":"continue:3/6(base)"}',
  },
];
