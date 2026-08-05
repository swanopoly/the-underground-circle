// accountability-audit corpus — a deterministic, model-free golden-case module
// for the ACCOUNTABILITY / AUDIT-TRAIL cores, extending the tier-1 regression net
// in `../coreGoldenCorpus` (docs strategic plan ADD #1: "the safety net that
// makes every consolidation below safe"). It pins the exact output of the three
// pure cores that decide what the accountability surfaces SHOW and RECORD:
//
//   • commandFrecencyCore (rerankByFrecency / frecencyScore / recordCommandUsage
//     / normalizeCommandKey) — the "frequent + recent" re-rank of the chat
//     slash-command menu: a used command floats to the top by summed frecency, an
//     empty/no-usage input is an identity permutation, and argument variants
//     credit the most-specific (longest-prefix) candidate.
//   • approvalAuditCore (normalizeApprovalRows / summarizeApprovalTrail /
//     formatAuditEntry) — the unified, bounded, SECRET-SAFE approval ledger: it
//     folds two approval tables into one newest-first AuditEntry[], counts the
//     decision axis, redacts token-like secrets out of titles/actors, and renders
//     a stable one-line ledger row.
//   • swanbotLaneTelemetryCore (classifyLaneTerminal) — the terminal-lane
//     classifier the v1/v2 consolidation (SWANBOT_V2_MIGRATION_PLAN M5) depends
//     on: it names which lane (`v2`/`v1`/`none`) ended a chat turn and how,
//     including the silent v2→v1 fallback that M5 must measure before deleting v1.
//
// A regression that silently reordered the command menu, leaked a credential into
// the ledger, mis-counted a rejected approval as approved, or mis-attributed a
// fell-back-to-v1 turn as a clean v2 serve would flip a case here from pass→fail.
// Every golden below was CAPTURED from the real core output (throwaway tsx probe),
// never invented, then pinned.
//
// CONTRACT: matches `../coreGoldenCorpus` — each `CoreGoldenCase.run()` executes a
// real core fn on a FROZEN input and returns `true` iff the output equals the
// pinned golden. `run()` is self-contained + total (the local deep-equal never
// throws; the aggregator also catches any throw). Ids are globally-unique CI
// anchors, all prefixed `accountability-audit-`.
//
// PURITY EXCEPTION (as with the parent corpus): this file IMPORTS the cores at
// RUNTIME — that is the point. All three are dependency-light + tsx-loadable
// (smokes: command-frecency-core / approval-audit-core / swanbot-lane-telemetry-
// core), so this module loads under tsx with no react-native / supabase / deno in
// the graph.

import type { CoreGoldenCase } from '../coreGoldenCorpus';
import {
  rerankByFrecency,
  frecencyScore,
  recordCommandUsage,
  normalizeCommandKey,
  USAGE_HALF_LIFE_MS,
} from '../../src/lib/commandFrecencyCore';
import {
  normalizeApprovalRows,
  summarizeApprovalTrail,
  formatAuditEntry,
} from '../../src/lib/approvalAuditCore';
import { classifyLaneTerminal } from '../../src/lib/swanbotLaneTelemetryCore';

// ─── Local total deep-equal (mirrors the parent corpus's `goldenEq`) ──────────
// Arrays compared index-wise (rank/merge order is semantic); object keys compared
// order-insensitively (a cosmetic key reorder must not flip a case); depth-bounded
// and total (never throws on a hostile/cyclic value → returns false). Primitive
// goldens (number / string / null) short-circuit via the `a === b` fast path.
function deepEq(a: unknown, b: unknown, depth = 0): boolean {
  if (depth > 20) return false;
  if (a === b) return true;
  const ta = typeof a;
  if (ta !== typeof b) return false;
  if (a === null || b === null) return a === b;
  const aArr = Array.isArray(a);
  const bArr = Array.isArray(b);
  if (aArr || bArr) {
    if (!aArr || !bArr || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!deepEq(a[i], b[i], depth + 1)) return false;
    }
    return true;
  }
  if (ta === 'object') {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const ak = Object.keys(ao).sort();
    const bk = Object.keys(bo).sort();
    if (ak.length !== bk.length) return false;
    for (let i = 0; i < ak.length; i += 1) {
      if (ak[i] !== bk[i]) return false;
    }
    for (const k of ak) {
      if (!deepEq(ao[k], bo[k], depth + 1)) return false;
    }
    return true;
  }
  return false;
}

// " · " — the exact ledger-row separator approvalAuditCore renders (SEP, a spaced
// U+00B7 middot). Written as an escape so the golden string stays ASCII-clean.
const SEP = ' · ';

export const CASES: CoreGoldenCase[] = [
  // ── suite: command-frecency (rerankByFrecency / frecencyScore / …) ──────────
  {
    id: 'accountability-audit-frecency-recent-frequent-ranks-above-old-rare',
    suite: 'command-frecency',
    describe:
      'a recently+frequently used command (/c) re-ranks above an old+rare one (/a), and an unused command (/b) keeps its original trailing slot',
    run: () => {
      const now = 2 * USAGE_HALF_LIFE_MS;
      const usage = {
        '/a': { command: '/a', count: 2, lastUsedMs: now - USAGE_HALF_LIFE_MS }, // one half-life old, rare → low score
        '/c': { command: '/c', count: 10, lastUsedMs: now }, // fresh + frequent → high score
      };
      return deepEq(
        rerankByFrecency([{ command: '/a' }, { command: '/b' }, { command: '/c' }], usage, now),
        [{ command: '/c' }, { command: '/a' }, { command: '/b' }],
      );
    },
  },
  {
    id: 'accountability-audit-frecency-empty-commands-empty',
    suite: 'command-frecency',
    describe: 'an empty command list re-ranks to an empty list (empty → [])',
    run: () =>
      deepEq(
        rerankByFrecency([], { '/x': { command: '/x', count: 5, lastUsedMs: 1000 } }, 1000),
        [],
      ),
  },
  {
    id: 'accountability-audit-frecency-no-usage-preserves-order',
    suite: 'command-frecency',
    describe:
      'with no recorded usage the re-rank is an identity permutation — original relative order is preserved (deterministic, no reordering)',
    run: () =>
      deepEq(rerankByFrecency([{ command: '/a' }, { command: '/b' }], {}, 2_419_200_000), [
        { command: '/a' },
        { command: '/b' },
      ]),
  },
  {
    id: 'accountability-audit-frecency-longest-prefix-credit',
    suite: 'command-frecency',
    describe:
      "an argument variant ('/gh cat a.ts') credits the most-specific candidate '/gh cat' (longest prefix), floating it above the shorter '/gh'",
    run: () => {
      const now = 2 * USAGE_HALF_LIFE_MS;
      return deepEq(
        rerankByFrecency(
          [{ command: '/gh' }, { command: '/gh cat' }],
          { '/gh cat a.ts': { command: '/gh cat a.ts', count: 5, lastUsedMs: now } },
          now,
        ),
        [{ command: '/gh cat' }, { command: '/gh' }],
      );
    },
  },
  {
    id: 'accountability-audit-frecency-score-half-life-decay',
    suite: 'command-frecency',
    describe:
      'frecencyScore halves per 14-day half-life: count 8 at exactly one half-life old scores 4 (frequency × recency decay)',
    run: () => deepEq(frecencyScore({ count: 8, lastUsedMs: 1000 }, 1000 + USAGE_HALF_LIFE_MS), 4),
  },
  {
    id: 'accountability-audit-frecency-record-bumps-count-newmap',
    suite: 'command-frecency',
    describe:
      'recordCommandUsage returns a NEW map with the command count bumped (2→3) and lastUsedMs advanced to nowMs',
    run: () =>
      deepEq(
        recordCommandUsage({ '/deploy': { command: '/deploy', count: 2, lastUsedMs: 1 } }, '/deploy', 9999),
        { '/deploy': { command: '/deploy', count: 3, lastUsedMs: 9999 } },
      ),
  },
  {
    id: 'accountability-audit-frecency-normalize-key-lowercases-and-guards-nonslash',
    suite: 'command-frecency',
    describe:
      "normalizeCommandKey lowercases + collapses whitespace ('/GH   Cat  A.TS' → '/gh cat a.ts') and rejects a non-slash key (→ null)",
    run: () =>
      deepEq(normalizeCommandKey('/GH   Cat  A.TS'), '/gh cat a.ts') &&
      deepEq(normalizeCommandKey('nope'), null) &&
      deepEq(normalizeCommandKey('/'), null),
  },

  // ── suite: approval-audit (normalizeApprovalRows / summarize / format) ──────
  {
    id: 'accountability-audit-approval-run-row-normalized-record',
    suite: 'approval-audit',
    describe:
      'an agent_run_approvals row folds to one AuditEntry: resolved_at is the state timestamp, resolved_by (a UUID) passes through un-masked as actor, and file_write classifies risk=high',
    run: () =>
      deepEq(
        normalizeApprovalRows(
          [
            {
              id: 'r1',
              approval_kind: 'file_write',
              title: 'Write config',
              status: 'approved',
              requested_at: '2026-07-01T00:00:00.000Z',
              resolved_at: '2026-07-01T00:05:00.000Z',
              requested_by: '11111111-1111-1111-1111-111111111111',
              resolved_by: '22222222-2222-2222-2222-222222222222',
            },
          ],
          [],
        ),
        [
          {
            source: 'run',
            id: 'r1',
            title: 'Write config',
            decision: 'approved',
            at: '2026-07-01T00:05:00.000Z',
            risk: 'high',
            actor: '22222222-2222-2222-2222-222222222222',
          },
        ],
      ),
  },
  {
    id: 'accountability-audit-approval-secret-redacted-in-title',
    suite: 'approval-audit',
    describe:
      "SECRET-SAFE: a token-shaped substring in an approval title ('… sk-abcdef123456 …') is masked to [REDACTED] before it can reach the ledger UI",
    run: () =>
      deepEq(
        normalizeApprovalRows(
          [
            {
              id: 'r2',
              approval_kind: 'external_send',
              title: 'Deploy sk-abcdef123456 token',
              status: 'pending',
              requested_at: '2026-07-01T00:00:00.000Z',
            },
          ],
          [],
        ),
        [
          {
            source: 'run',
            id: 'r2',
            title: 'Deploy [REDACTED] token',
            decision: 'pending',
            at: '2026-07-01T00:00:00.000Z',
            risk: 'high',
          },
        ],
      ),
  },
  {
    id: 'accountability-audit-approval-actor-token-redacted',
    suite: 'approval-audit',
    describe:
      'SECRET-SAFE: a token smuggled into an agent_approvals agent_name is fully redacted in the actor field (a non-UUID actor is never echoed raw)',
    run: () =>
      deepEq(
        normalizeApprovalRows(
          [],
          [
            {
              id: 'h9',
              action_type: 'login',
              description: 'agent login',
              status: 'rejected',
              agent_name: 'sk-secrettoken123456',
              requested_at: '2026-07-01T00:00:00.000Z',
            },
          ],
        ),
        [
          {
            source: 'hitl',
            id: 'h9',
            title: 'agent login',
            decision: 'rejected',
            at: '2026-07-01T00:00:00.000Z',
            risk: 'high',
            actor: '[REDACTED]',
          },
        ],
      ),
  },
  {
    id: 'accountability-audit-approval-summary-counts-decision-axis',
    suite: 'approval-audit',
    describe:
      "summarizeApprovalTrail buckets the decision axis: total counts every entry while 'expired' counts toward total ONLY (never approved) → {total:5, approved:2, rejected:1, pending:1}",
    run: () =>
      deepEq(
        summarizeApprovalTrail([
          { decision: 'approved' },
          { decision: 'rejected' },
          { decision: 'pending' },
          { decision: 'expired' },
          { decision: 'approved' },
        ]),
        { total: 5, approved: 2, rejected: 1, pending: 1 },
      ),
  },
  {
    id: 'accountability-audit-approval-format-ledger-row',
    suite: 'approval-audit',
    describe:
      'formatAuditEntry renders the stable one-line ledger row "<decision> · <title> · <relative age>" for a fixed nowMs (3 minutes after the timestamp → "3m ago")',
    run: () =>
      deepEq(
        // nowMs = Date.parse('2026-07-01T00:03:00.000Z') — 3 min after `at`.
        formatAuditEntry(
          { source: 'run', id: 'x', decision: 'approved', title: 'Publish blog post', at: '2026-07-01T00:00:00.000Z' },
          1_782_864_180_000,
        ),
        `approved${SEP}Publish blog post${SEP}3m ago`,
      ),
  },
  {
    id: 'accountability-audit-approval-merge-newest-first',
    suite: 'approval-audit',
    describe:
      'normalizeApprovalRows folds BOTH tables into one newest-first ledger: a Jul-2 agent_approvals (hitl) row sorts ahead of a Jul-1 agent_run_approvals (run) row',
    run: () =>
      deepEq(
        normalizeApprovalRows(
          [{ id: 'r1', status: 'pending', requested_at: '2026-07-01T00:00:00.000Z', approval_kind: 'tool_use', title: 'A' }],
          [{ id: 'h1', status: 'approved', requested_at: '2026-07-02T00:00:00.000Z', action_type: 'send', description: 'B' }],
        ),
        [
          { source: 'hitl', id: 'h1', title: 'B', decision: 'approved', at: '2026-07-02T00:00:00.000Z', risk: 'medium' },
          { source: 'run', id: 'r1', title: 'A', decision: 'pending', at: '2026-07-01T00:00:00.000Z', risk: 'medium' },
        ],
      ),
  },
  {
    id: 'accountability-audit-approval-idless-and-junk-rows-dropped',
    suite: 'approval-audit',
    describe:
      'a row missing an id and a non-array hitl input both fail closed — normalizeApprovalRows drops them and returns [] (total, never throws)',
    run: () => deepEq(normalizeApprovalRows([{ approval_kind: 'x' }], 'junk'), []),
  },

  // ── suite: swanbot-lane-telemetry (classifyLaneTerminal) ────────────────────
  {
    id: 'accountability-audit-lane-v2-served-terminal-is-v2',
    suite: 'swanbot-lane-telemetry',
    describe: "a clean v2 serve (callSwanBotV2 returned text) classifies lane 'v2' / served_ok, no fallback",
    run: () =>
      deepEq(classifyLaneTerminal({ lane: 'v2', hasResponse: true }), {
        lane: 'v2',
        outcome: 'served_ok',
        fellBack: false,
      }),
  },
  {
    id: 'accountability-audit-lane-fell-back-to-v1-is-v1',
    suite: 'swanbot-lane-telemetry',
    describe:
      "a v2 attempt that did not serve then a v1 answer pins lane 'v1' / fell_back_to_v1 with fellBack=true (the exact silent-fallback count M5 needs)",
    run: () =>
      deepEq(classifyLaneTerminal({ lane: 'v2', hasResponse: true, usedV1AfterV2: true }), {
        lane: 'v1',
        outcome: 'fell_back_to_v1',
        fellBack: true,
      }),
  },
  {
    id: 'accountability-audit-lane-clean-v1-relay-is-v1',
    suite: 'swanbot-lane-telemetry',
    describe: "a clean v1 relay (v2 disabled, v1 returned text) classifies lane 'v1' / served_ok, no fallback",
    run: () =>
      deepEq(classifyLaneTerminal({ lane: 'v1', hasResponse: true }), {
        lane: 'v1',
        outcome: 'served_ok',
        fellBack: false,
      }),
  },
  {
    id: 'accountability-audit-lane-blocked-is-none',
    suite: 'swanbot-lane-telemetry',
    describe: "a strict-local-AI block (pre-invoke gate) terminates the turn as lane 'none' / blocked — no lane served",
    run: () =>
      deepEq(classifyLaneTerminal({ blocked: true }), { lane: 'none', outcome: 'blocked', fellBack: false }),
  },
  {
    id: 'accountability-audit-lane-no-auth-is-none',
    suite: 'swanbot-lane-telemetry',
    describe: "a missing access token (authed=false) terminates as lane 'none' / no_auth — v1 was never invoked",
    run: () =>
      deepEq(classifyLaneTerminal({ authed: false }), { lane: 'none', outcome: 'no_auth', fellBack: false }),
  },
  {
    id: 'accountability-audit-lane-threw-precedes-response',
    suite: 'swanbot-lane-telemetry',
    describe:
      "outcome precedence: a lane that threw is recorded as 'threw' even when hasResponse is also set (transport failure wins over a stale response flag)",
    run: () =>
      deepEq(classifyLaneTerminal({ lane: 'v2', threw: true, hasResponse: true }), {
        lane: 'v2',
        outcome: 'threw',
        fellBack: false,
      }),
  },
  {
    id: 'accountability-audit-lane-hostile-null-input-total-none',
    suite: 'swanbot-lane-telemetry',
    describe:
      "TOTAL: a null/garbage input never throws — it collapses to the safe unattributed terminal lane 'none' / transport_null",
    run: () =>
      deepEq(classifyLaneTerminal(null as never), { lane: 'none', outcome: 'transport_null', fellBack: false }),
  },
  {
    id: 'accountability-audit-lane-unknown-tag-is-not-guessed',
    suite: 'swanbot-lane-telemetry',
    describe:
      "a served turn carrying an UNKNOWN lane tag is attributed to 'none' (never guessed into v1/v2), so it can't bias the v1-vs-v2 counts M5 depends on",
    run: () =>
      deepEq(classifyLaneTerminal({ lane: 'bogus', hasResponse: true }), {
        lane: 'none',
        outcome: 'served_ok',
        fellBack: false,
      }),
  },
];
