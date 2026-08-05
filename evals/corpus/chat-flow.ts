// chat-flow — a golden-case corpus module extending the deterministic eval net
// (docs/CHAT_ARCHITECTURE_STRATEGIC_PLAN_2026-07-15.md ADD #1: "an eval CI
// merge-gate … the safety net that makes every consolidation below safe"). Like
// its sibling `evals/corpus/chat-misc.ts`, it pins the exact OUTPUT of a batch of
// load-bearing PURE cores on FIXED inputs, so CI catches ANY behavioral drift
// with NO API keys, NO network, NO flakiness.
//
// Cores covered (each imported AT RUNTIME — that is the whole point, it exercises
// them — and each itself dependency-light + tsx-loadable):
//   • turnCachePolicyCore   — the success-only gate on the 15s SwanBot turn
//     replay cache (a FAILURE/EMPTY result must NOT be cached, so an immediate
//     retry-after-failure actually re-runs instead of replaying the failure).
//   • clientToolBatchCore   — coalesces consecutive read-only v2 client tools
//     into one parallel-safe group while every write/unknown call stays a serial
//     singleton (a write never reorders past anything).
//   • userActionReceiptCore — turns one tool result into the ONE compact human
//     receipt line the user sees (never raw JSON/fences; per-family phrasing).
//
// Each case's `run()` calls the REAL core fn on a frozen input and returns true
// iff the output equals the GOLDEN value captured from that same core (never
// invented). Every golden here was probed from live core output on 2026-07-15.
// Structured/nested outputs are pinned by full throw-safe `j` (JSON.stringify)
// equality; the receipt lines that contain an em dash (U+2014) are pinned by an
// exact string compare whose golden spells that character as `—`, so the
// comparison is both exact AND immune to a source copy-fidelity slip. Each
// `run()` is self-contained + total (throw-safe serializer / direct primitive
// compares; never depends on mutable state; never throws).

import type { CoreGoldenCase } from '../coreGoldenCorpus';

import {
  classifyTurnResult,
  isCacheableTurnResult,
} from '../../src/lib/turnCachePolicyCore';
import {
  partitionClientToolBatch,
  isReadOnlyClientTool,
} from '../../src/lib/clientToolBatchCore';
import {
  buildUserActionReceipt,
  summarizeToolResultForUser,
  buildActionReceiptList,
} from '../../src/lib/userActionReceiptCore';

/** Throw-safe stable serializer for golden equality (cyclic → sentinel, never throws). */
const j = (v: unknown): string => {
  try {
    return JSON.stringify(v);
  } catch {
    return '__unstringifiable__';
  }
};

export const CASES: CoreGoldenCase[] = [
  // ── suite: turn-cache-policy (turnCachePolicyCore) ─────────────────────────
  {
    id: 'chat-flow-turn-cache-failure-copy-not-cached',
    suite: 'turn-cache-policy',
    describe:
      'THE fix: a leading tool-failure/stop message classifies as failure and is NOT cacheable, so a retry-after-failure re-runs instead of replaying the failure',
    run: () => {
      const failCopy = 'A tool step failed, so I stopped this turn early. Try again in a moment.';
      return classifyTurnResult(failCopy) === 'failure' && isCacheableTurnResult(failCopy) === false;
    },
  },
  {
    id: 'chat-flow-turn-cache-success-cached',
    suite: 'turn-cache-policy',
    describe: 'a genuine substantive answer classifies as success and IS cacheable (the 15s replay cache keeps only real answers)',
    run: () => {
      const ok = 'Here is a perfectly normal substantive answer for you.';
      return classifyTurnResult(ok) === 'success' && isCacheableTurnResult(ok) === true;
    },
  },
  {
    id: 'chat-flow-turn-cache-empty-and-nullish-not-cached',
    suite: 'turn-cache-policy',
    describe: "empty/whitespace strings and null/undefined classify as 'empty' and are never cacheable",
    run: () =>
      classifyTurnResult('') === 'empty' &&
      classifyTurnResult('   \n  ') === 'empty' &&
      classifyTurnResult(null) === 'empty' &&
      classifyTurnResult(undefined) === 'empty' &&
      isCacheableTurnResult('') === false,
  },
  {
    id: 'chat-flow-turn-cache-structured-flags-are-failures',
    suite: 'turn-cache-policy',
    describe: 'a structured result with ok:false or a truthy error classifies as failure and is not cacheable',
    run: () =>
      classifyTurnResult({ ok: false }) === 'failure' &&
      isCacheableTurnResult({ ok: false }) === false &&
      classifyTurnResult({ error: 'boom' }) === 'failure',
  },
  {
    id: 'chat-flow-turn-cache-structured-response-text-classified-both-ways',
    suite: 'turn-cache-policy',
    describe:
      "with no ok/error flag the structured path classifies the human-visible `response` text: failure copy → not cacheable, a real answer → cacheable",
    run: () =>
      classifyTurnResult({ response: 'Something went wrong. Try again.' }) === 'failure' &&
      isCacheableTurnResult({ response: 'Something went wrong. Try again.' }) === false &&
      classifyTurnResult({ response: 'Sure, the capital of France is Paris.' }) === 'success' &&
      isCacheableTurnResult({ response: 'Sure, the capital of France is Paris.' }) === true,
  },
  {
    id: 'chat-flow-turn-cache-long-prose-mentioning-failed-still-cached',
    suite: 'turn-cache-policy',
    describe:
      'a long (>400 char) substantive answer that merely mentions "failed" in prose stays a cacheable success (the length/lead-window guard against false failures)',
    run: () => {
      const longProse =
        'Here is a thorough explanation of the deployment. ' +
        'x'.repeat(360) +
        ' Note the earlier build failed but this one is fine.';
      return (
        longProse.length === 462 &&
        classifyTurnResult(longProse) === 'success' &&
        isCacheableTurnResult(longProse) === true
      );
    },
  },

  // ── suite: client-tool-batch (clientToolBatchCore) ─────────────────────────
  {
    id: 'chat-flow-batch-all-reads-one-parallel-group',
    suite: 'client-tool-batch',
    describe:
      'three consecutive read-only client tools coalesce into ONE parallel-safe group with parallelizable === 3',
    run: () =>
      j(
        partitionClientToolBatch([
          { id: 'a', name: 'desktop.read_a11y_tree' },
          { id: 'b', name: 'desktop.list_running_apps' },
          { id: 'c', name: 'desktop.screenshot' },
        ]),
      ) ===
      '{"groups":[[{"id":"a","name":"desktop.read_a11y_tree"},{"id":"b","name":"desktop.list_running_apps"},{"id":"c","name":"desktop.screenshot"}]],"parallelizable":3}',
  },
  {
    id: 'chat-flow-batch-write-never-merges-serial-singletons',
    suite: 'client-tool-batch',
    describe:
      'a read/write/read sequence yields three singleton groups (parallelizable 0): the write never merges and the reads it separates cannot re-join',
    run: () =>
      j(
        partitionClientToolBatch([
          { id: 'a', name: 'desktop.file_read' },
          { id: 'b', name: 'desktop.edit_file' },
          { id: 'c', name: 'desktop.file_list' },
        ]),
      ) ===
      '{"groups":[[{"id":"a","name":"desktop.file_read"}],[{"id":"b","name":"desktop.edit_file"}],[{"id":"c","name":"desktop.file_list"}]],"parallelizable":0}',
  },
  {
    id: 'chat-flow-batch-leading-reads-coalesce-write-splits',
    suite: 'client-tool-batch',
    describe:
      'leading consecutive reads coalesce into one group and a following write splits into its own singleton (parallelizable 2)',
    run: () =>
      j(
        partitionClientToolBatch([
          { id: 'a', name: 'desktop.file_read' },
          { id: 'b', name: 'desktop.file_list' },
          { id: 'c', name: 'desktop.edit_file' },
        ]),
      ) ===
      '{"groups":[[{"id":"a","name":"desktop.file_read"},{"id":"b","name":"desktop.file_list"}],[{"id":"c","name":"desktop.edit_file"}]],"parallelizable":2}',
  },
  {
    id: 'chat-flow-batch-unknown-tool-fail-closed-singleton',
    suite: 'client-tool-batch',
    describe: 'an unknown/unlisted tool name fails closed — treated as a write, isolated in its own singleton group (parallelizable 0)',
    run: () =>
      j(partitionClientToolBatch([{ id: 'a', name: 'some.unknown_tool' }])) ===
      '{"groups":[[{"id":"a","name":"some.unknown_tool"}]],"parallelizable":0}',
  },
  {
    id: 'chat-flow-batch-readonly-membership-fail-closed',
    suite: 'client-tool-batch',
    describe:
      'isReadOnlyClientTool admits exact read names (file_read, codebase.search), rejects writes (edit_file, git.run), and fails closed on wrong casing / non-strings',
    run: () =>
      isReadOnlyClientTool('desktop.file_read') === true &&
      isReadOnlyClientTool('codebase.search') === true &&
      isReadOnlyClientTool('desktop.edit_file') === false &&
      isReadOnlyClientTool('git.run') === false &&
      isReadOnlyClientTool('DESKTOP.FILE_READ') === false &&
      isReadOnlyClientTool(123 as unknown) === false,
  },
  {
    id: 'chat-flow-batch-degenerate-input-neutral',
    suite: 'client-tool-batch',
    describe: 'an empty array and a non-array input both total-safely yield the neutral empty partition',
    run: () =>
      j(partitionClientToolBatch([])) === '{"groups":[],"parallelizable":0}' &&
      j(partitionClientToolBatch(null as unknown)) === '{"groups":[],"parallelizable":0}',
  },

  // ── suite: user-action-receipt (userActionReceiptCore) ─────────────────────
  {
    id: 'chat-flow-receipt-shell-pass',
    suite: 'user-action-receipt',
    describe: "local.run_shell with an exit-0 exec transcript renders 'Ran `<cmd>` — passed'",
    run: () =>
      buildUserActionReceipt('local.run_shell', '$ npm test\nexit 0\n', true) === 'Ran `npm test` — passed',
  },
  {
    id: 'chat-flow-receipt-shell-fail-carries-exit-code',
    suite: 'user-action-receipt',
    describe: "a failed exec (exit 1) renders 'Ran `<cmd>` — failed (exit 1)' rather than raw stdout",
    run: () =>
      buildUserActionReceipt('local.run_shell', '$ npm test\nexit 1\n', false) ===
      'Ran `npm test` — failed (exit 1)',
  },
  {
    id: 'chat-flow-receipt-edit-file-pluralizes-changes',
    suite: 'user-action-receipt',
    describe: "desktop.edit_file rewrites 'N replacements' to correctly-pluralized 'N change(s)'",
    run: () =>
      buildUserActionReceipt('desktop.edit_file', 'Edited src/app.ts (3 replacements)', true) ===
        'Edited src/app.ts (3 changes)' &&
      buildUserActionReceipt('desktop.edit_file', 'Edited src/app.ts (1 replacements)', true) ===
        'Edited src/app.ts (1 change)',
  },
  {
    id: 'chat-flow-receipt-gmail-to-and-subject',
    suite: 'user-action-receipt',
    describe: 'gmail.write extracts the recipient and quoted subject into \'Sent email to <to> — "<subject>"\'',
    run: () =>
      buildUserActionReceipt('gmail.write', 'Email sent to alice@example.com "Weekly Update"', true) ===
      'Sent email to alice@example.com — "Weekly Update"',
  },
  {
    id: 'chat-flow-receipt-create-noun-quoted-name',
    suite: 'user-action-receipt',
    describe: 'rooms.create / tasks.create use the family verb plus the first quoted name from the result',
    run: () =>
      buildUserActionReceipt('rooms.create', 'Created room "Design Sync"', true) === 'Created room "Design Sync"' &&
      buildUserActionReceipt('tasks.create', 'Added task "Ship the eval net"', true) ===
        'Added task "Ship the eval net"',
  },
  {
    id: 'chat-flow-receipt-failure-couldnt-verb-reason',
    suite: 'user-action-receipt',
    describe: "an ok=false result on an unknown family renders \"Couldn't complete <friendly tool>: <short reason>\"",
    run: () => buildUserActionReceipt('foo.bar', 'error: nope', false) === "Couldn't complete foo bar: nope",
  },
  {
    id: 'chat-flow-receipt-summarize-and-list',
    suite: 'user-action-receipt',
    describe:
      "summarizeToolResultForUser pulls the salient field ('Hello World', '3 items') and buildActionReceiptList composes a bounded 'Done:' block",
    run: () =>
      summarizeToolResultForUser('x', { title: 'Hello World' }) === 'Hello World' &&
      summarizeToolResultForUser('x', { count: 3 }) === '3 items' &&
      buildActionReceiptList([
        { toolName: 'rooms.create', result: 'Created room "Alpha"', ok: true },
        { toolName: 'tasks.create', result: 'Added task "Beta"', ok: true },
      ]) === 'Done:\n- Created room "Alpha"\n- Added task "Beta"' &&
      buildActionReceiptList([]) === '',
  },
];
