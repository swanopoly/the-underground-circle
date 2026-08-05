/**
 * watch-chat-commands-smoketest — verifies the `/watch` slash command
 * grammar for Phase 6a recurring computer-task watches: null fall-through,
 * create defaults (daily + changes_only), explicit cadence + `--always`,
 * always-confirm floor rejection (create never called), list rendering
 * (numbering, cadence phrase, 80-char bound, paused marker, order), stop by
 * index / substring / ambiguous / unknown, and empty-task errors.
 *
 * Also covers LOCAL FOLDER WATCHES: folder phrasings store the encoded
 * `local-folder:` task, the confirmation carries the runs-while-the-app-
 * is-open caveat, list/stop render the decoded 📁 label, and page watches
 * stay byte-identical (URL tasks are never folder-encoded).
 *
 * Runs against injected in-memory deps — no supabase, no react-native.
 *
 * Run: npx tsx scripts/watch-chat-commands-smoketest.ts
 */

import {
  executeWatchCommand,
  type WatchCommandContext,
} from '../src/lib/watchChatCommands';
import {
  describeWatchCadence,
  formatWatchCreatedMessage,
} from '../src/lib/computerTaskScheduleModel';
import { encodeFolderWatchTask } from '../src/lib/folderWatchModel';

let failures = 0;

function fail(message: string) {
  failures += 1;
  console.error('FAIL:', message);
}

function pass(message: string) {
  console.log('pass:', message);
}

function expect(condition: unknown, message: string) {
  if (!condition) fail(message);
}

// ── In-memory harness (the ctx.deps test seam) ──────────────────────────────

type FakeRow = Record<string, any>;

function seedRow(partial: Partial<FakeRow> & { id: string; task: string }): FakeRow {
  return {
    circle_id: 'circle-1',
    created_by: 'user-1',
    cadence: 'daily',
    notify_on: 'changes_only',
    thread_id: null,
    active: true,
    last_run_at: null,
    last_findings: null,
    last_diff_summary: null,
    next_run_at: '2026-07-02T09:30:00.000Z',
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-01T00:00:00.000Z',
    ...partial,
  };
}

function makeHarness(options?: {
  seed?: FakeRow[];
  floorCategories?: string[];
  failSetActive?: boolean;
}) {
  const store: FakeRow[] = [...(options?.seed ?? [])];
  const createCalls: any[] = [];
  const setActiveCalls: Array<{ id: string; active: boolean }> = [];
  let nextId = 1;

  const ctx: WatchCommandContext = {
    circleId: 'circle-1',
    userId: 'user-1',
    threadId: 'thread-1',
    floorCategoriesFor: () => options?.floorCategories ?? [],
    deps: {
      list: async (circleId: string) => store.filter((row) => row.circle_id === circleId),
      create: async (input: any) => {
        createCalls.push(input);
        const row = seedRow({
          id: `watch-${nextId++}`,
          task: input.task,
          cadence: input.cadence,
          notify_on: input.notifyOn,
          thread_id: input.threadId ?? null,
          circle_id: input.circleId,
          created_by: input.createdBy,
        });
        store.push(row);
        return { ok: true, schedule: row };
      },
      setActive: async (id: string, active: boolean) => {
        setActiveCalls.push({ id, active });
        const row = store.find((r) => r.id === id);
        if (!row || options?.failSetActive) return false;
        row.active = active;
        return true;
      },
    },
  };

  return { ctx, store, createCalls, setActiveCalls };
}

// ── Cases ───────────────────────────────────────────────────────────────────

async function main() {
  // Non-watch input falls through as null
  {
    const { ctx, createCalls } = makeHarness();
    expect((await executeWatchCommand('hello there', ctx)) === null, 'plain chat → null');
    expect((await executeWatchCommand('/memory-bank brief', ctx)) === null, 'other slash command → null');
    expect((await executeWatchCommand('/watches daily x', ctx)) === null, '/watches (no token boundary) → null');
    expect((await executeWatchCommand('', ctx)) === null, 'empty input → null');
    expect(createCalls.length === 0, 'fall-through never touches deps');
    pass('non-watch input → null');
  }

  // Create: defaults (daily + changes_only)
  {
    const { ctx, createCalls } = makeHarness();
    const result = await executeWatchCommand('/watch check the pricing page for changes', ctx);
    expect(!!result && result.success === true, 'bare task creates a watch');
    expect(createCalls.length === 1, 'create called exactly once');
    const input = createCalls[0];
    expect(input.cadence === 'daily', 'cadence defaults to daily');
    expect(input.notifyOn === 'changes_only', 'notify defaults to changes_only');
    expect(typeof input.task === 'string' && input.task.includes('pricing page'), 'task forwarded to create');
    expect(
      input.circleId === 'circle-1' && input.createdBy === 'user-1' && input.threadId === 'thread-1',
      'circle/user/thread context forwarded',
    );
    expect(
      result!.message === formatWatchCreatedMessage({ task: input.task, cadence: 'daily', notifyOn: 'changes_only' }),
      'success message is formatWatchCreatedMessage verbatim',
    );
    pass('create: default daily + changes_only');
  }

  // Create: explicit cadence + --always flag anywhere
  {
    const { ctx, createCalls } = makeHarness();
    const result = await executeWatchCommand('/watch hourly watch the deploy queue --always', ctx);
    expect(!!result && result.success === true, 'hourly + --always creates');
    expect(createCalls[0]?.cadence === 'hourly', 'hourly cadence token respected');
    expect(createCalls[0]?.notifyOn === 'always', '--always → notify always');
    expect(!/--always/i.test(createCalls[0]?.task || '--always'), 'flag stripped from task');
    expect(createCalls[0]?.task === 'watch the deploy queue', 'task keeps its words');
    expect(
      result!.message ===
        formatWatchCreatedMessage({ task: createCalls[0].task, cadence: 'hourly', notifyOn: 'always' }),
      'created message reflects hourly + always',
    );
    const mid = await executeWatchCommand('/watch WEEKLY --always audit the backlog', ctx);
    expect(!!mid && mid.success === true, 'cadence is case-insensitive, flag can sit mid-command');
    expect(createCalls[1]?.cadence === 'weekly' && createCalls[1]?.notifyOn === 'always', 'WEEKLY + mid --always parsed');
    expect(createCalls[1]?.task === 'audit the backlog', 'mid-position flag stripped from task');
    pass('create: explicit hourly/weekly + --always anywhere');
  }

  // Always-confirm floor rejection — create must never be called
  {
    const { ctx, createCalls } = makeHarness({ floorCategories: ['pay'] });
    const result = await executeWatchCommand('/watch daily pay the hosting invoice', ctx);
    expect(!!result && result.success === false, 'floored task → success:false');
    expect(!!result && /pay/i.test(result!.message), 'floor error names the category (pay)');
    expect(createCalls.length === 0, 'create NOT called for a floored task');
    pass('floor rejection blocks creation');
  }

  // Create failure (cap reached / table missing) surfaces the error verbatim
  {
    const { ctx } = makeHarness();
    const capError = 'This circle already has 5 active watches. Pause or delete one before adding another.';
    ctx.deps!.create = async () => ({ ok: false, error: capError });
    const result = await executeWatchCommand('/watch daily check something new', ctx);
    expect(!!result && result.success === false, 'create failure → success:false');
    expect(!!result && result!.message === capError, 'CRUD error surfaced verbatim');
    pass('create failure surfaces CRUD error verbatim');
  }

  // List rendering: numbering, cadence phrase, bound, paused last
  {
    const seed = [
      seedRow({ id: 'w-paused', task: 'weekly paused sweep', cadence: 'weekly', active: false }),
      seedRow({ id: 'w-daily', task: 'check the pricing page', cadence: 'daily', next_run_at: '2026-07-01T14:30:00.000Z' }),
      seedRow({ id: 'w-long', task: 'A'.repeat(100), cadence: 'hourly', notify_on: 'always' }),
    ];
    const { ctx } = makeHarness({ seed });
    const result = await executeWatchCommand('/watch list', ctx);
    expect(!!result && result.success === true, 'list succeeds');
    const message = result!.message;
    const lines = message.split('\n').filter((line) => /^\d+\. /.test(line));
    expect(lines.length === 3, 'one numbered line per watch');
    expect(lines[0].startsWith('1. 🔁 '), 'lines numbered from 1 with the 🔁 marker');
    expect(lines[0].includes('"check the pricing page"'), 'active watches sort first');
    expect(lines[0].includes(describeWatchCadence('daily')), 'cadence phrase comes from describeWatchCadence');
    expect(lines[0].includes('changes only'), 'changes_only rendered as "changes only"');
    expect(lines[0].includes('next check 2026-07-01 14:30'), 'next check ISO trimmed to YYYY-MM-DD HH:MM');
    expect(lines[1].includes('"' + 'A'.repeat(79) + '…"'), 'long task bounded to 80 chars with ellipsis');
    expect(!lines[1].includes('A'.repeat(80)), 'full oversized task never rendered');
    expect(lines[2].includes('(paused)'), 'paused row marked (paused)');
    expect(lines[2].includes('"weekly paused sweep"') && lines[2].includes(describeWatchCadence('weekly')), 'paused row sorts last and keeps its cadence phrase');
    expect(!lines[0].includes('(paused)') && !lines[1].includes('(paused)'), 'active rows carry no paused marker');
    const bare = await executeWatchCommand('/watch', ctx);
    expect(!!bare && bare.message === message, 'bare /watch renders the same list');
    pass('list rendering: order, numbering, cadence, bound, paused marker');
  }

  // Empty list → helpful pointer at /watch daily <task>
  {
    const { ctx } = makeHarness();
    const result = await executeWatchCommand('/watch', ctx);
    expect(!!result && result.success === true, 'empty list still succeeds');
    expect(!!result && result!.message.includes('/watch daily'), 'empty list points at `/watch daily <task>`');
    pass('empty list → helpful message');
  }

  // Stop by 1-based index (list order: active first)
  {
    const seed = [
      seedRow({ id: 'w-paused', task: 'old paused watch', active: false }),
      seedRow({ id: 'w-a', task: 'check deploy queue' }),
      seedRow({ id: 'w-b', task: 'check pricing page' }),
    ];
    const { ctx, store, setActiveCalls } = makeHarness({ seed });
    const result = await executeWatchCommand('/watch stop 1', ctx);
    expect(!!result && result.success === true, 'stop by index succeeds');
    expect(
      setActiveCalls.length === 1 && setActiveCalls[0].id === 'w-a' && setActiveCalls[0].active === false,
      'index 1 targets the first row in LIST order (active first), via setActive(id,false)',
    );
    expect(store.find((r) => r.id === 'w-a')!.active === false, 'target row is now paused');
    const oob = await executeWatchCommand('/watch stop 99', ctx);
    expect(!!oob && oob.success === false && /watch list/i.test(oob!.message), 'out-of-range index → helpful error');
    const noArg = await executeWatchCommand('/watch stop', ctx);
    expect(!!noArg && noArg.success === false && /number/i.test(noArg!.message), 'stop without a target → usage hint');
    pass('stop by 1-based list index');
  }

  // Stop by case-insensitive substring
  {
    const seed = [
      seedRow({ id: 'w-a', task: 'check deploy queue' }),
      seedRow({ id: 'w-b', task: 'check pricing page' }),
    ];
    const { ctx, setActiveCalls, store } = makeHarness({ seed });
    const result = await executeWatchCommand('/watch stop PRICING', ctx);
    expect(!!result && result.success === true, 'substring stop succeeds (case-insensitive)');
    expect(
      setActiveCalls.length === 1 && setActiveCalls[0].id === 'w-b' && setActiveCalls[0].active === false,
      'substring matched the pricing watch only',
    );
    expect(store.find((r) => r.id === 'w-b')!.active === false, 'matched row paused');
    pass('stop by task substring');
  }

  // Ambiguous substring → ask for the number, deactivate nothing
  {
    const seed = [
      seedRow({ id: 'w-a', task: 'check deploy queue' }),
      seedRow({ id: 'w-b', task: 'check pricing page' }),
    ];
    const { ctx, setActiveCalls } = makeHarness({ seed });
    const result = await executeWatchCommand('/watch stop check', ctx);
    expect(!!result && result.success === false, 'ambiguous substring → success:false');
    expect(!!result && /number/i.test(result!.message), 'ambiguity asks for the list number');
    expect(setActiveCalls.length === 0, 'nothing deactivated on ambiguity');
    pass('ambiguous stop asks for a number');
  }

  // Unknown stop target → helpful "no match" message
  {
    const seed = [seedRow({ id: 'w-a', task: 'check deploy queue' })];
    const { ctx, setActiveCalls } = makeHarness({ seed });
    const result = await executeWatchCommand('/watch stop zzz-nothing-here', ctx);
    expect(!!result && result.success === false, 'unknown stop target → success:false');
    expect(!!result && /no watch matching/i.test(result!.message), 'says no watch matched');
    expect(!!result && /watch list/i.test(result!.message), 'points back at /watch list');
    expect(setActiveCalls.length === 0, 'nothing deactivated on no-match');
    pass('unknown stop target → helpful message');
  }

  // setActive failure fails closed
  {
    const seed = [seedRow({ id: 'w-a', task: 'check deploy queue' })];
    const { ctx } = makeHarness({ seed, failSetActive: true });
    const result = await executeWatchCommand('/watch stop 1', ctx);
    expect(!!result && result.success === false, 'setActive=false → success:false with a retry message');
    pass('setActive failure reported');
  }

  // Empty task → error (create never reached)
  {
    const { ctx, createCalls } = makeHarness();
    const cadenceOnly = await executeWatchCommand('/watch daily', ctx);
    expect(!!cadenceOnly && cadenceOnly.success === false, 'cadence with no task → error');
    expect(!!cadenceOnly && /task/i.test(cadenceOnly!.message), 'error explains a task is needed');
    const flagOnly = await executeWatchCommand('/watch --always', ctx);
    expect(!!flagOnly && flagOnly.success === false, 'flag-only input → error');
    expect(createCalls.length === 0, 'create not called without a task');
    pass('empty task → error');
  }

  // Help block covers all forms
  {
    const { ctx } = makeHarness();
    const result = await executeWatchCommand('/watch help', ctx);
    expect(!!result && result.success === true, 'help succeeds');
    expect(!!result && result!.message.includes('/watch stop'), 'help covers stop');
    expect(!!result && /hourly\|daily\|weekly/.test(result!.message), 'help covers cadence tokens');
    expect(!!result && result!.message.includes('--always'), 'help covers --always');
    expect(!!result && result!.message.includes('/watch list'), 'help covers list');
    pass('help block covers all forms');
  }

  // ── Local folder watches ──────────────────────────────────────────────────

  // Folder create: encoded task + runs-while-open confirmation caveat
  {
    const { ctx, createCalls } = makeHarness();
    const result = await executeWatchCommand('/watch my downloads folder for new pdfs', ctx);
    expect(!!result && result.success === true, 'folder phrasing creates a watch');
    expect(createCalls.length === 1, 'folder create called exactly once');
    expect(createCalls[0]?.task === 'local-folder: ~/Downloads | *.pdf',
      'stored task is the encoded local-folder form (path + pattern)');
    expect(createCalls[0]?.task === encodeFolderWatchTask({ path: '~/Downloads', pattern: '*.pdf' }),
      'stored task matches encodeFolderWatchTask verbatim');
    expect(createCalls[0]?.cadence === 'daily', 'folder watch defaults to daily cadence');
    expect(!!result && result!.message.includes('~/Downloads'), 'confirmation shows the decoded path');
    expect(!!result && result!.message.includes('(*.pdf)'), 'confirmation shows the pattern');
    expect(!!result && result!.message.includes('runs while the app is open'),
      'confirmation carries the honest while-open caveat');
    expect(!!result && result!.message.includes('local desktop bridge'),
      'confirmation names the local desktop bridge');
    expect(!!result && result!.message.includes("I'll report only when something changes."),
      'folder confirmation keeps the changes-only reporting sentence');
    pass('folder create: encoded task + while-open caveat');
  }

  // Folder create: explicit cadence token + --always + cadence phrase hint
  {
    const { ctx, createCalls } = makeHarness();
    await executeWatchCommand('/watch hourly my downloads folder --always', ctx);
    expect(createCalls[0]?.task === 'local-folder: ~/Downloads', 'pattern-less folder task encoded');
    expect(createCalls[0]?.cadence === 'hourly', 'explicit hourly token respected for folder watch');
    expect(createCalls[0]?.notifyOn === 'always', '--always respected for folder watch');

    await executeWatchCommand('/watch my desktop every hour', ctx);
    expect(createCalls[1]?.task === 'local-folder: ~/Desktop', '"my desktop" shorthand encodes ~/Desktop');
    expect(createCalls[1]?.cadence === 'hourly', 'cadence phrase inside the text used when no explicit token');

    await executeWatchCommand('/watch daily my documents folder every hour', ctx);
    expect(createCalls[2]?.cadence === 'daily', 'explicit cadence token beats the in-text phrase');
    pass('folder create: cadence token, hint, --always');
  }

  // Folder list/stop render the decoded 📁 label, never the raw encoding
  {
    const seed = [
      seedRow({ id: 'w-folder', task: 'local-folder: ~/Downloads | *.pdf', cadence: 'daily' }),
      seedRow({ id: 'w-page', task: 'check the pricing page', cadence: 'daily' }),
    ];
    const { ctx, setActiveCalls } = makeHarness({ seed });
    const list = await executeWatchCommand('/watch list', ctx);
    expect(!!list && list.success === true, 'list with a folder watch succeeds');
    const folderLine = list!.message.split('\n').find((line) => line.includes('📁'));
    expect(!!folderLine && folderLine.includes('📁 ~/Downloads (*.pdf)'),
      'folder row renders the decoded 📁 label');
    expect(!!folderLine && !folderLine.includes('local-folder:'),
      'raw encoded task never rendered in the list');
    expect(!!folderLine && folderLine.includes(describeWatchCadence('daily')),
      'folder row keeps the cadence details');
    const pageLine = list!.message.split('\n').find((line) => line.includes('🔁'));
    expect(!!pageLine && pageLine.includes('"check the pricing page"'),
      'page row rendering unchanged next to a folder row');

    const stopped = await executeWatchCommand('/watch stop 1', ctx);
    expect(!!stopped && stopped.success === true && setActiveCalls[0]?.id === 'w-folder',
      'stop by index hits the folder row (list order)');
    expect(!!stopped && stopped.message.includes('📁 ~/Downloads (*.pdf)'),
      'stop confirmation uses the decoded label');
    expect(!!stopped && !stopped.message.includes('local-folder:'),
      'stop confirmation never leaks the raw encoding');
    pass('folder list/stop rendering');
  }

  // Page watches unaffected: URL-bearing and ordinary tasks are never encoded
  {
    const { ctx, createCalls } = makeHarness();
    const urlResult = await executeWatchCommand('/watch daily check https://example.com/pricing for changes', ctx);
    expect(!!urlResult && urlResult.success === true, 'URL task still creates a page watch');
    expect(createCalls[0]?.task === 'check https://example.com/pricing for changes',
      'URL task stored raw, never folder-encoded');
    expect(
      urlResult!.message ===
        formatWatchCreatedMessage({ task: createCalls[0].task, cadence: 'daily', notifyOn: 'changes_only' }),
      'URL task keeps the page-watch confirmation verbatim',
    );

    const pageResult = await executeWatchCommand('/watch check the downloads page for new links', ctx);
    expect(createCalls[1]?.task === 'check the downloads page for new links',
      '"downloads page" phrasing stays a page watch (not folder-encoded)');
    expect(!!pageResult && !pageResult.message.includes('runs while the app is open'),
      'page-watch confirmation carries no folder caveat');
    pass('page watches unaffected by folder detection');
  }

  // Floor rejection still runs on the user's ORIGINAL folder phrasing
  {
    const { ctx, createCalls } = makeHarness({ floorCategories: ['delete'] });
    const result = await executeWatchCommand('/watch my downloads folder and delete old files', ctx);
    expect(!!result && result.success === false, 'floored folder phrasing → success:false');
    expect(!!result && /delete/i.test(result!.message), 'floor error names the category (delete)');
    expect(createCalls.length === 0, 'create NOT called for a floored folder request');
    pass('floor rejection covers folder phrasings');
  }

  if (failures > 0) {
    console.error(`\n${failures} watch chat command smoke failure(s)`);
    process.exit(1);
  }

  console.log('\nAll watch chat command smoke cases passed.');
}

main().catch((error) => {
  console.error('watch-chat-commands smoke crashed:', error);
  process.exit(1);
});
