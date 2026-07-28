/**
 * computerTaskScheduleRunner — client-side due-watch runner hook for
 * recurring computer-task watches (Phase 6a of
 * `docs/CHAT_UX_INTEGRATION_UPGRADE_PLAN.md`; Phase 7a added atomic
 * due-claiming so this runner can coexist with the server-side cron
 * scheduler polling the same table).
 *
 * While a circle surface is mounted with the runner enabled, it checks
 * `computer_use_schedules` for due rows (on mount + every 60s), ATOMICALLY
 * CLAIMS a due row before running it (`claimComputerTaskScheduleRun` — a
 * compare-and-set that advances `next_run_at` only if it still holds the
 * value this runner just read; the client runner and the server scheduler
 * race on that CAS and whoever lands it first WINS the run, the loser sees
 * zero rows and skips its tick silently), runs AT MOST ONE watch at a time
 * headless via `startComputerUseAgent`, diffs the new findings against the
 * schedule's previous run (`computerRunDiff` — the Phase 5c
 * monitoring-with-memory owner, reused unchanged), re-stamps `next_run_at`
 * from COMPLETION time via `markComputerTaskScheduleRun` (deliberately
 * overwriting the claim's provisional value so the cadence counts from when
 * the check finished), and posts a chat update only when the notify policy
 * says so (`always`, or `changes_only` plus an actual change / a failed
 * check). A quiet `changes_only` watch with nothing new posts NOTHING —
 * that silence is the whole point.
 *
 * SAFETY: watches are created read-only (the create path floor-checks the
 * task at create time), and this runner NEVER grants approvals — it
 * registers no `onConfirmationRequired` handler, so if the agent hits an
 * `ask_user` gate the question simply times out server-side and the run
 * returns partial. That is acceptable and by design: an unattended watch
 * must never answer an approval question on the user's behalf.
 * SAFETY: a watch is only ever executed by the caller that WON the claim
 * CAS — losing the claim means another runner or the server scheduler owns
 * this due tick, and this runner backs off without running or notifying.
 *
 * Failure posture: everything is try/caught — a runner fault must never
 * crash the mounting screen — and the watch cannot hot-loop: the claim
 * itself already advanced `next_run_at` (so even a run that dies mid-flight
 * stays scheduled, not due), and a failed run STILL re-stamps
 * `next_run_at` from completion time.
 *
 * LOCAL FOLDER WATCHES (`local-folder:` encoded tasks, `folderWatchModel`)
 * branch off BEFORE the Browserbase creds gate: they probe the user's
 * desktop bridge (`desktopBridge.listFiles`, lazy import) instead of
 * running a browser agent, so they only ever execute here — the
 * server-side watch-scheduler skips them by task prefix. Bridge offline →
 * the watch is skipped WITHOUT claiming (next_run_at untouched, so it
 * retries next tick once the bridge is back; mirrors the missing-creds
 * skip), with a one-time non-advancing "skipped: desktop bridge offline"
 * note. Failures AFTER the claim follow the page-watch convention above:
 * next_run_at still advances from completion time and the failure posts.
 */

import { useEffect, useRef, useState } from 'react';

import { persistChatMessage } from './chatService';
import {
  diffComputerRunFindings,
  formatComputerRunDiffSummary,
  type ComputerRunFindingLike,
} from './computerRunDiff';
import {
  computeNextRunAtIso,
  formatWatchUpdateMessage,
  type ComputerTaskScheduleRow,
} from './computerTaskScheduleModel';
import {
  claimComputerTaskScheduleRun,
  listDueComputerTaskSchedules,
  markComputerTaskScheduleRun,
  recordComputerTaskScheduleNote,
} from './computerTaskSchedules';
import { fireComputerTaskWebNotification } from './computerTaskState';
import {
  buildComputerUsePolicyEnvelope,
  startComputerUseAgent,
  type AgentHandle,
} from './computerUseAgent';
import { resolveComputerUseCreds } from './computerUseCreds';
import {
  buildFolderSnapshotFindings,
  decodeFolderWatchTask,
  diffFolderSnapshots,
  formatFolderWatchLabel,
  isFolderWatchTask,
  matchesFolderWatchPattern,
} from './folderWatchModel';

/** Due-check cadence. Watches are hourly at the fastest, so a minute of
 *  polling slack is invisible to users and cheap on the network. */
const DUE_CHECK_INTERVAL_MS = 60_000;

type WatchRunOutcome =
  | { ok: true; summary: string; findings: ComputerRunFindingLike[] | null }
  | { ok: false; errorMessage: string };

/** Best-effort coercion of the persisted `last_findings` JSON back into the
 *  diffable shape. Anything that isn't an object with a title is dropped. */
function coerceStoredFindings(
  value: unknown[] | null | undefined,
): ComputerRunFindingLike[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((item): item is ComputerRunFindingLike => {
    if (!item || typeof item !== 'object') return false;
    const title = (item as { title?: unknown }).title;
    return typeof title === 'string' && title.length > 0;
  });
}

// ─── Local folder watches ────────────────────────────────────────────────────

/** Non-advancing note stamped while the bridge is down (written at most once
 *  per outage — guarded against the row's current last_diff_summary). */
const FOLDER_WATCH_OFFLINE_NOTE = 'skipped: desktop bridge offline';

type FolderWatchTickOutcome = 'skipped_offline' | 'handled';

/**
 * Execute one due LOCAL folder watch: claim (same CAS page watches use) →
 * `desktopBridge.listFiles` → pattern filter → snapshot → diff against the
 * row's `last_findings` → re-stamp from completion time → notify per
 * policy through the SAME posting path page watches use.
 *
 * Bridge offline (checked by the caller per tick) → 'skipped_offline'
 * WITHOUT claiming: next_run_at stays untouched so the watch remains due
 * and retries on a later tick — deliberately mirroring the silent
 * missing-creds skip, not the failed-run path. Every failure AFTER the
 * claim (grant denied, folder missing, bridge died mid-call, corrupt
 * encoding) follows the page-watch failure convention: next_run_at still
 * advances from completion time and the failed check posts.
 */
async function runDueFolderWatch(
  schedule: ComputerTaskScheduleRow,
  deps: {
    circleId: string;
    bridgeUp: boolean;
    authorId: string | null;
    isAlive: () => boolean;
    setRunningScheduleId: (id: string | null) => void;
  },
): Promise<FolderWatchTickOutcome> {
  if (!deps.bridgeUp) {
    if (schedule.last_diff_summary !== FOLDER_WATCH_OFFLINE_NOTE) {
      // recordComputerTaskScheduleNote touches ONLY last_diff_summary — the
      // schedule is not advanced, so this cannot burn the run.
      await recordComputerTaskScheduleNote(schedule.id, FOLDER_WATCH_OFFLINE_NOTE);
    }
    return 'skipped_offline';
  }

  // Claim before running — the same compare-and-set the page-watch path
  // uses, so this runner, other open tabs, and the server scheduler can
  // never double-run one due tick. (The server scheduler skips folder
  // watches anyway; the CAS still guards against a second open client.)
  const provisionalNextRunAtIso = computeNextRunAtIso(schedule.cadence, Date.now());
  const claimed = await claimComputerTaskScheduleRun(
    schedule.id,
    schedule.next_run_at,
    provisionalNextRunAtIso,
  );
  if (!deps.isAlive() || !claimed) return 'handled';

  deps.setRunningScheduleId(schedule.id);

  const target = decodeFolderWatchTask(schedule.task);
  const label = target ? formatFolderWatchLabel(target) : schedule.task.slice(0, 80);

  let nextFindings: unknown[] | null = null;
  let diffSummary = '';
  let hasChanges = false;
  let errorMessage: string | undefined;

  if (!target) {
    // Prefix matched but the encoded path/pattern is corrupt. Fail closed —
    // an encoded local-folder task must never reach the browser agent.
    errorMessage = 'This folder watch has an unreadable folder path — stop it and create it again.';
  } else {
    const bridge = await import('./desktopBridge');
    const listed = await bridge.listFiles(target.path);
    if (!deps.isAlive()) return 'handled'; // claim's provisional next_run_at stands
    if (!listed.ok || !listed.data) {
      errorMessage = String(listed.error || 'Could not list the folder via the desktop bridge.').slice(0, 400);
    } else {
      const snapshot = buildFolderSnapshotFindings(
        listed.data.entries
          .filter((entry) => entry.kind === 'file')
          .filter((entry) => matchesFolderWatchPattern(entry.name, target.pattern))
          .map((entry) => ({ name: entry.name, sizeBytes: entry.size, modifiedAt: entry.modifiedAt })),
      );
      const diff = diffFolderSnapshots(schedule.last_findings, snapshot);
      nextFindings = snapshot;
      diffSummary = diff.summary;
      hasChanges = diff.hasChanges;
    }
  }

  // Re-stamp from COMPLETION time BEFORE notifying — identical to the
  // page-watch convention: a failed check STILL advances next_run_at (the
  // claim already advanced it provisionally) and keeps the previous
  // findings as baseline so the next diff is real.
  const now = Date.now();
  const nextRunAtIso = computeNextRunAtIso(schedule.cadence, now);
  const lastRunAtIso = new Date(now).toISOString();
  await markComputerTaskScheduleRun(schedule.id, {
    lastRunAtIso,
    nextRunAtIso,
    lastFindings: errorMessage ? (schedule.last_findings ?? null) : nextFindings,
    lastDiffSummary: errorMessage ? `Check failed: ${errorMessage.slice(0, 160)}` : diffSummary,
  });

  // Notify policy — identical to page watches: failed checks always post;
  // otherwise `always` posts every run, `changes_only` only on a change.
  const shouldNotify = Boolean(errorMessage) || schedule.notify_on === 'always' || hasChanges;
  if (!shouldNotify) return 'handled';

  if (deps.authorId) {
    try {
      await persistChatMessage({
        circleId: deps.circleId,
        userId: deps.authorId,
        content: formatWatchUpdateMessage({
          task: label, // the readable folder label, not the encoded task
          diffSummary,
          runSummary: '',
          errorMessage,
        }),
        isBot: true,
        threadId: schedule.thread_id,
      });
    } catch {
      // Message insert failed — the schedule already advanced, so the next
      // change simply reports again. No retry loop here.
    }
  }
  fireComputerTaskWebNotification({
    kind: errorMessage ? 'failed' : 'completed',
    title: `Watch: ${label.slice(0, 70)}`,
    body: (errorMessage || diffSummary).slice(0, 180),
  });
  return 'handled';
}

export function useComputerTaskScheduleRunner(opts: {
  circleId: string;
  userId?: string | null;
  enabled: boolean;
}): { runningScheduleId: string | null } {
  const { circleId, enabled } = opts;
  const [runningScheduleId, setRunningScheduleId] = useState<string | null>(null);

  // At most ONE watch run in flight EVER. Token-owned (not a boolean) so a
  // stale tick that settles after the effect re-armed cannot clear a newer
  // tick's claim and let two runs overlap.
  const runTokenRef = useRef<object | null>(null);
  const handleRef = useRef<AgentHandle | null>(null);
  const abortActiveRunRef = useRef<(() => void) | null>(null);
  // Latest userId without re-arming the effect — an in-flight watch must
  // not be cancelled just because the auth identity re-resolved.
  const userIdRef = useRef<string | null | undefined>(opts.userId);
  userIdRef.current = opts.userId;

  useEffect(() => {
    if (!enabled || !circleId) return;
    let alive = true;

    const tick = async () => {
      if (!alive || runTokenRef.current) return;
      const token = {};
      runTokenRef.current = token;
      try {
        const due = await listDueComputerTaskSchedules(circleId);
        if (!alive || due.length === 0) return;

        // Pick the first due row this runner can actually attempt. LOCAL
        // FOLDER watches (`local-folder:` tasks) run against the desktop
        // bridge instead of Browserbase, so they branch off here — before
        // the creds gate. A bridge-offline folder watch is skipped WITHOUT
        // claiming (it stays due and retries next tick), and the scan moves
        // on so a permanently-due folder watch can never starve the page
        // watches queued behind it. Still at most ONE actual run per tick.
        let bridgeUp: boolean | null = null;
        let schedule: ComputerTaskScheduleRow | undefined;
        for (const candidate of due) {
          if (!candidate || candidate.active === false) continue;
          if (!isFolderWatchTask(candidate.task)) {
            schedule = candidate;
            break;
          }
          if (bridgeUp === null) {
            // Lazy import: desktopBridge (and its react-native deps) must
            // stay out of this module's static load path. One availability
            // probe per tick covers every due folder watch.
            const bridge = await import('./desktopBridge');
            bridgeUp = await bridge.isDesktopBridgeAvailable();
            if (!alive) return;
          }
          const outcome = await runDueFolderWatch(candidate, {
            circleId,
            bridgeUp,
            authorId: candidate.created_by || userIdRef.current || null,
            isAlive: () => alive,
            setRunningScheduleId,
          });
          if (!alive) return;
          if (outcome === 'skipped_offline') continue;
          return; // ran, failed, or lost the claim — this tick is done
        }
        if (!alive || !schedule) return;

        // Same creds path ChatTab's task hooks use (`resolveComputerUseCreds`
        // → `creds.creds.browserbase`). No creds → skip this tick silently:
        // the user already gets the Marketplace nudge when they run a task by
        // hand; a background poller must not spam errors every 60s.
        const credsResult = await resolveComputerUseCreds(circleId);
        if (!alive || !credsResult.ok) return;

        // Phase 7a: atomically claim the due row before running it. The
        // server-side cron scheduler polls the same table, so ownership is
        // a compare-and-set on next_run_at — whoever advances it first wins
        // this run. Losing means the other runner/scheduler owns the tick:
        // skip silently (the finally below releases the single-flight
        // token). The provisional next_run_at written by the claim also
        // means a run that dies mid-flight cannot hot-loop; the end-of-run
        // mark below overwrites it with a value computed from COMPLETION
        // time, which is the timestamp we actually want the cadence to
        // count from.
        const provisionalNextRunAtIso = computeNextRunAtIso(schedule.cadence, Date.now());
        const claimed = await claimComputerTaskScheduleRun(
          schedule.id,
          schedule.next_run_at,
          provisionalNextRunAtIso,
        );
        if (!alive || !claimed) return;

        setRunningScheduleId(schedule.id);

        // Headless run. The explicit scheduled_observation envelope is
        // enforced server-side before every tool dispatch: reads/navigation
        // can proceed, while any mutation ends as a truthful partial result.
        // No confirmation handler is registered because an unattended watch
        // must never approve an action on the user's behalf.
        const outcome = await new Promise<WatchRunOutcome>((resolve) => {
          let settled = false;
          const settle = (result: WatchRunOutcome) => {
            if (settled) return;
            settled = true;
            abortActiveRunRef.current = null;
            handleRef.current = null;
            resolve(result);
          };
          abortActiveRunRef.current = () =>
            settle({ ok: false, errorMessage: 'Watch run cancelled (screen unmounted).' });
          handleRef.current = startComputerUseAgent({
            task: schedule.task,
            circleId,
            userId: schedule.created_by || userIdRef.current || undefined,
            policy: buildComputerUsePolicyEnvelope({
              executionMode: 'scheduled_observation',
              source: 'watch',
              userConstraints: ['Observe and report only; do not change browser or application data.'],
              alwaysConfirmCategories: [
                'browser_mutation',
                'opaque_target',
                'credentials',
                'external_side_effect',
              ],
            }),
            browserbase: credsResult.creds.browserbase,
            onResult: ({ summary, findings }) =>
              settle({ ok: true, summary, findings: findings ?? null }),
            onError: (message) => settle({ ok: false, errorMessage: message }),
          });
        });
        if (!alive) return; // cancelled by cleanup — nothing to persist

        const now = Date.now();
        const nextRunAtIso = computeNextRunAtIso(schedule.cadence, now);
        const lastRunAtIso = new Date(now).toISOString();
        const previousFindings = coerceStoredFindings(schedule.last_findings);

        let diffSummary = '';
        let runSummary = '';
        let errorMessage: string | undefined;
        let hasChanges = false;

        if (outcome.ok) {
          const previousAgeMs = schedule.last_run_at
            ? Math.max(0, now - Date.parse(schedule.last_run_at))
            : null;
          const diff = diffComputerRunFindings(previousFindings, outcome.findings);
          diffSummary = formatComputerRunDiffSummary(diff, { previousAgeMs });
          runSummary = outcome.summary;
          hasChanges = diff.hasChanges;
          // Re-stamp the schedule BEFORE notifying so a notify failure can
          // never leave the watch due (and hot-looping). This deliberately
          // overwrites the claim's provisional next_run_at with one
          // computed from COMPLETION time.
          await markComputerTaskScheduleRun(schedule.id, {
            lastRunAtIso,
            nextRunAtIso,
            lastFindings: outcome.findings ?? null,
            lastDiffSummary: diffSummary,
          });
        } else {
          errorMessage = String(outcome.errorMessage || 'Watch run failed.').slice(0, 400);
          // A failed run STILL re-stamps next_run_at from completion time
          // (the claim already advanced it — belt and braces against
          // hot-looping); the previous findings stay as baseline so the
          // next diff is real.
          await markComputerTaskScheduleRun(schedule.id, {
            lastRunAtIso,
            nextRunAtIso,
            lastFindings: schedule.last_findings ?? null,
            lastDiffSummary: `Check failed: ${errorMessage.slice(0, 160)}`,
          });
        }

        // Notify policy: failed checks always post; otherwise `always`
        // posts every run, `changes_only` posts only when the diff found
        // something. No change + no error + `changes_only` → NO message.
        const shouldNotify =
          Boolean(errorMessage) || schedule.notify_on === 'always' || hasChanges;
        if (shouldNotify) {
          const authorId = schedule.created_by || userIdRef.current || null;
          if (authorId) {
            try {
              await persistChatMessage({
                circleId,
                userId: authorId,
                content: formatWatchUpdateMessage({
                  task: schedule.task,
                  diffSummary,
                  runSummary,
                  errorMessage,
                }),
                isBot: true,
                threadId: schedule.thread_id,
              });
            } catch {
              // Message insert failed — the schedule already advanced, so
              // the next change simply reports again. No retry loop here.
            }
          }
          // Best-effort native notification: fires only when the page is
          // hidden AND permission was already granted (never requests).
          fireComputerTaskWebNotification({
            kind: errorMessage ? 'failed' : 'completed',
            title: `Watch: ${schedule.task.slice(0, 70)}`,
            body: (errorMessage || diffSummary || runSummary).slice(0, 180),
          });
        }
      } catch (err) {
        // A runner fault must never crash the mounting screen. One quiet
        // warn for debuggability; the next tick retries in 60s.
        try {
          console.warn('[computerTaskScheduleRunner] tick failed:', err);
        } catch {}
      } finally {
        if (runTokenRef.current === token) {
          runTokenRef.current = null;
          setRunningScheduleId(null);
        }
      }
    };

    void tick();
    const timer = setInterval(() => {
      void tick();
    }, DUE_CHECK_INTERVAL_MS);

    return () => {
      alive = false;
      clearInterval(timer);
      const handle = handleRef.current;
      handleRef.current = null;
      if (handle) {
        try {
          handle.cancel();
        } catch {}
      }
      // Settle the awaited run promise so the stale tick unwinds through its
      // own finally (releasing the run token) instead of hanging forever.
      const abort = abortActiveRunRef.current;
      abortActiveRunRef.current = null;
      if (abort) abort();
    };
  }, [circleId, enabled]);

  return { runningScheduleId };
}
