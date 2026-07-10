/**
 * watchChatCommands — `/watch` slash command family for Phase 6a
 * "recurring computer-task watches": per-circle standing checks
 * ("check X every day, tell me what changed") stored in
 * `computer_use_schedules` and re-run on a cadence.
 *
 * Grammar (case-insensitive):
 *   /watch                                 → numbered list of watches (active first)
 *   /watch list                            → same as bare /watch
 *   /watch [hourly|daily|weekly] <task…>   → create a watch (cadence defaults to daily)
 *   /watch … --always                      → notify every check (default: changes only)
 *   /watch stop <number|text>              → pause a watch by list number or task text
 *   /watch help                            → usage block
 *
 * Folder-watch tasks ("my Downloads folder for new pdfs") are detected via
 * `folderWatchModel.detectFolderWatchRequest` and stored as the encoded
 * `local-folder: <path> | <pattern>` task on the same row — they run only
 * while the app is open (local desktop bridge; the server-side scheduler
 * skips them). Everything else stays a browser page watch, unchanged.
 *
 * Returns `{ message, success } | null` — null means "not my command, fall
 * through to the next handler". Modeled on `memoryBankChatCommands.ts`.
 *
 * CRITICAL: top-level imports must stay pure — only
 * `computerTaskScheduleModel` (no supabase / react-native) so this module
 * loads under tsx for smoke tests. The supabase CRUD in
 * `computerTaskSchedules.ts` is reached lazily via `await import(...)`
 * inside `resolveWatchDeps`, and only when the caller did not inject
 * `ctx.deps` (the smoke-test seam).
 */

import {
  MAX_ACTIVE_WATCHES,
  describeWatchCadence,
  formatWatchCreatedMessage,
  validateWatchTask,
  type ComputerTaskScheduleCadence,
  type ComputerTaskScheduleNotifyOn,
  type ComputerTaskScheduleRow,
} from './computerTaskScheduleModel';
import {
  decodeFolderWatchTask,
  describeFolderWatchForChat,
  detectFolderWatchRequest,
  encodeFolderWatchTask,
  formatFolderWatchLabel,
} from './folderWatchModel';

export interface WatchCommandContext {
  circleId: string;
  userId: string;
  threadId?: string | null;
  /** Always-confirm floor detector result for a task (caller passes the router's detectAlwaysConfirmFloorCategories). */
  floorCategoriesFor: (task: string) => string[];
  /** Test seam — smoke injects fakes; production omits and gets the real CRUD via lazy import. */
  deps?: {
    list: (circleId: string) => Promise<any[]>;
    create: (input: any) => Promise<{ ok: true; schedule: any } | { ok: false; error: string }>;
    setActive: (id: string, active: boolean) => Promise<boolean>;
  };
}

export interface WatchCommandResult {
  message: string;
  success: boolean;
}

/** List lines bound the task text so oversized watches can't flood chat. */
const WATCH_TASK_DISPLAY_BOUND = 80;

const HELP_TEXT = [
  '**/watch** — recurring computer-task watches for this circle.',
  '',
  '• `/watch` or `/watch list` — list watches (active first)',
  '• `/watch <task>` — check something every day (default cadence)',
  '• `/watch hourly|daily|weekly <task>` — pick how often to check',
  '• `/watch my Downloads folder for new pdfs` — local folder watch (runs while the app is open)',
  '• `/watch … --always` — notify every check (default: only when findings change)',
  '• `/watch stop <number|text>` — pause a watch by its list number or task text',
  '• `/watch help` — this help',
  '',
  `Up to ${MAX_ACTIVE_WATCHES} active watches per circle. Each check runs as a computer task and reports findings back into chat.`,
].join('\n');

export async function executeWatchCommand(
  rawCommand: string,
  ctx: WatchCommandContext,
): Promise<WatchCommandResult | null> {
  const trimmed = String(rawCommand || '').trim();
  if (!trimmed) return null;

  // `/watch` must be a whole token — `/watches …` is not our command.
  const match = trimmed.match(/^\/watch(?:\s+([\s\S]*))?$/i);
  if (!match) return null;

  const rest = (match[1] || '').trim();
  const restLower = rest.toLowerCase();

  if (restLower === 'help' || restLower === '--help' || restLower === '-h') {
    return { success: true, message: HELP_TEXT };
  }

  if (!rest || restLower === 'list') {
    return await renderWatchList(ctx);
  }

  const tokens = rest.split(/\s+/);
  if ((tokens[0] || '').toLowerCase() === 'stop') {
    return await handleStop(ctx, tokens.slice(1).join(' '));
  }

  return await handleCreate(ctx, tokens);
}

// ─── Internals ─────────────────────────────────────────────────────────────

type WatchCommandDeps = NonNullable<WatchCommandContext['deps']>;

/**
 * Injected fakes win; otherwise lazy-import the supabase CRUD. The dynamic
 * import keeps supabase/react-native out of this module's load path so the
 * smoke test can drive the full grammar under tsx with in-memory deps.
 */
async function resolveWatchDeps(ctx: WatchCommandContext): Promise<WatchCommandDeps> {
  if (ctx.deps) return ctx.deps;
  const crud = await import('./computerTaskSchedules');
  return {
    list: (circleId: string) => crud.listComputerTaskSchedules(circleId),
    create: (input: any) => crud.createComputerTaskSchedule(input),
    setActive: (id: string, active: boolean) => crud.setComputerTaskScheduleActive(id, active),
  };
}

async function listWatchesForDisplay(
  ctx: WatchCommandContext,
  deps: WatchCommandDeps,
): Promise<ComputerTaskScheduleRow[]> {
  const rows = (await deps.list(ctx.circleId)) as ComputerTaskScheduleRow[];
  // Active watches first; stable sort preserves the CRUD's soonest-first
  // order within each group. `/watch list` numbering and `/watch stop <n>`
  // must both use this exact order.
  return [...(Array.isArray(rows) ? rows : [])].sort(
    (a, b) => Number(!!b?.active) - Number(!!a?.active),
  );
}

async function renderWatchList(ctx: WatchCommandContext): Promise<WatchCommandResult> {
  const deps = await resolveWatchDeps(ctx);
  const rows = await listWatchesForDisplay(ctx, deps);

  if (rows.length === 0) {
    return {
      success: true,
      message:
        'No watches yet. Start one with `/watch daily <task>` — e.g. ' +
        '`/watch daily check the pricing page for changes`. ' +
        `Up to ${MAX_ACTIVE_WATCHES} active watches per circle (\`/watch help\` for all commands).`,
    };
  }

  return {
    success: true,
    message: [
      `**Watches** (${rows.length}) — recurring computer-task checks.`,
      '',
      ...rows.map((row, index) => renderWatchLine(row, index)),
      '',
      'Pause one with `/watch stop <number|text>` · `/watch help` for all commands.',
    ].join('\n'),
  };
}

function renderWatchLine(row: ComputerTaskScheduleRow, index: number): string {
  const details = [
    describeWatchCadence(row.cadence),
    row.notify_on === 'always' ? 'always notify' : 'changes only',
  ];
  if (row.active && row.next_run_at) {
    details.push(`next check ${formatIsoToMinute(row.next_run_at)}`);
  }
  const pausedSuffix = row.active ? '' : ' (paused)';
  // Folder watches render their decoded label ('📁 ~/Downloads (*.pdf)')
  // instead of the raw encoded task; page watches keep the 🔁 quote form.
  const folder = decodeFolderWatchTask(row.task);
  const label = folder ? formatFolderWatchLabel(folder) : `🔁 "${boundWatchTask(row.task)}"`;
  return `${index + 1}. ${label} — ${details.join(' · ')}${pausedSuffix}`;
}

async function handleStop(ctx: WatchCommandContext, targetRaw: string): Promise<WatchCommandResult> {
  const target = targetRaw.trim();
  if (!target) {
    return {
      success: false,
      message:
        'Which watch? Use `/watch stop <number>` or `/watch stop <task text>` — `/watch list` shows the numbers.',
    };
  }

  const deps = await resolveWatchDeps(ctx);
  const rows = await listWatchesForDisplay(ctx, deps);
  if (rows.length === 0) {
    return {
      success: false,
      message: 'No watches to stop. Start one with `/watch daily <task>`.',
    };
  }

  let matched: ComputerTaskScheduleRow | undefined;
  if (/^\d+$/.test(target)) {
    // 1-based index into the same order `/watch list` renders.
    const index = Number.parseInt(target, 10);
    if (index < 1 || index > rows.length) {
      return {
        success: false,
        message: `No watch #${index} — there ${rows.length === 1 ? 'is 1 watch' : `are ${rows.length} watches`}. \`/watch list\` shows the numbers.`,
      };
    }
    matched = rows[index - 1];
  } else {
    const needle = target.toLowerCase();
    const hits = rows.filter((row) => String(row?.task || '').toLowerCase().includes(needle));
    if (hits.length === 0) {
      return {
        success: false,
        message: `No watch matching "${target}". \`/watch list\` shows the current watches.`,
      };
    }
    if (hits.length > 1) {
      return {
        success: false,
        message: `${hits.length} watches match "${target}" — use the number instead: \`/watch stop <number>\` from \`/watch list\`.`,
      };
    }
    matched = hits[0];
  }

  if (!matched) {
    return { success: false, message: 'Could not resolve that watch. `/watch list` shows the numbers.' };
  }

  const ok = await deps.setActive(matched.id, false);
  if (!ok) {
    return {
      success: false,
      message: `Could not stop "${displayWatchTask(matched.task)}" — please try again.`,
    };
  }
  return {
    success: true,
    message: `⏸️ Stopped watch "${displayWatchTask(matched.task)}". It stays in \`/watch list\` as paused.`,
  };
}

async function handleCreate(ctx: WatchCommandContext, tokens: string[]): Promise<WatchCommandResult> {
  // `--always` may appear anywhere; strip it before reading the cadence token.
  let notifyOn: ComputerTaskScheduleNotifyOn = 'changes_only';
  const kept: string[] = [];
  for (const token of tokens) {
    if (/^--always$/i.test(token)) {
      notifyOn = 'always';
      continue;
    }
    kept.push(token);
  }

  let cadence: ComputerTaskScheduleCadence = 'daily';
  let cadenceExplicit = false;
  const first = (kept[0] || '').toLowerCase();
  if (first === 'hourly' || first === 'daily' || first === 'weekly') {
    cadence = first;
    cadenceExplicit = true;
    kept.shift();
  }

  const task = kept.join(' ').trim();
  if (!task) {
    return {
      success: false,
      message:
        'What should the watch check? Usage: `/watch [hourly|daily|weekly] <task>` — e.g. ' +
        '`/watch daily check the pricing page for changes`.',
    };
  }

  // Local FOLDER watch? Detection runs FIRST, on the reconstructed phrase —
  // the user already typed the watch verb as the /watch command itself,
  // while detectFolderWatchRequest stays conservative (requires the verb,
  // rejects URL/domain-bearing text) for free-text callers. Matched → the
  // stored task is the encoded `local-folder: …` form.
  const folderRequest = detectFolderWatchRequest(`watch ${task}`);
  const encodedFolderTask = folderRequest
    ? encodeFolderWatchTask({ path: folderRequest.path, pattern: folderRequest.pattern })
    : null;
  if (folderRequest && encodedFolderTask && !cadenceExplicit && folderRequest.cadencePhraseHint) {
    // "…every hour" inside the folder phrasing wins only when no explicit
    // hourly|daily|weekly token was given.
    cadence = folderRequest.cadencePhraseHint;
  }

  // Validate (length bounds + always-confirm floor) before touching the CRUD:
  // a floored task must never reach create. The floor detector runs on the
  // user's ORIGINAL phrasing (not the encoded path) so a folder request like
  // "…and delete old files" is rejected instead of silently narrowing to a
  // read-only folder poll.
  const validated = validateWatchTask(encodedFolderTask ?? task, {
    floorCategories: ctx.floorCategoriesFor(task),
  });
  if (!validated.ok) {
    return { success: false, message: validated.error };
  }

  const deps = await resolveWatchDeps(ctx);
  const created = await deps.create({
    circleId: ctx.circleId,
    createdBy: ctx.userId,
    task: validated.task,
    cadence,
    notifyOn,
    threadId: ctx.threadId ?? null,
  });
  if (!created.ok) {
    // Cap reached / table missing / RLS — surface the CRUD's error verbatim.
    return { success: false, message: created.error };
  }

  if (folderRequest && encodedFolderTask) {
    // LOCKSTEP: reporting sentences mirror formatWatchCreatedMessage in
    // computerTaskScheduleModel.ts so folder and page confirmations read
    // the same. describeFolderWatchForChat carries the honest
    // runs-while-the-app-is-open constraint.
    const reporting = notifyOn === 'always'
      ? "I'll report after every check."
      : "I'll report only when something changes.";
    return {
      success: true,
      message:
        `${describeFolderWatchForChat({ path: folderRequest.path, pattern: folderRequest.pattern, cadence })} ` +
        `${reporting} Manage watches in Office.`,
    };
  }

  return {
    success: true,
    message: formatWatchCreatedMessage({ task: validated.task, cadence, notifyOn }),
  };
}

function boundWatchTask(task: string): string {
  const text = String(task || '').trim();
  if (text.length <= WATCH_TASK_DISPLAY_BOUND) return text;
  return text.slice(0, WATCH_TASK_DISPLAY_BOUND - 1).trimEnd() + '…';
}

/** Folder watches show their decoded label; page watches the bounded task. */
function displayWatchTask(task: string): string {
  const folder = decodeFolderWatchTask(task);
  return folder ? formatFolderWatchLabel(folder) : boundWatchTask(task);
}

/** `2026-07-01T14:30:00.000Z` → `2026-07-01 14:30` for list lines. */
function formatIsoToMinute(iso: string): string {
  return String(iso).slice(0, 16).replace('T', ' ');
}
