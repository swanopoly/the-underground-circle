/**
 * Latest-snapshot queue for durable Office layout saves.
 *
 * Layout edits first land in the verified local cache, then this queue
 * serializes the authenticated server writes. The queue deliberately keeps
 * only the newest waiting snapshot: an older request may finish, fail, or
 * conflict, but it must never erase a newer user edit.
 */

export interface OfficeLayoutSaveQueueItem {
  scope: string;
  version: number;
}

export interface OfficeLayoutSaveQueueResult {
  ok: boolean;
  conflict?: boolean;
}

export interface OfficeLayoutSaveQueueRef<T> {
  current: T;
}

export interface OfficeLayoutSaveQueueState<T extends OfficeLayoutSaveQueueItem> {
  pending: OfficeLayoutSaveQueueRef<T | null>;
  active: OfficeLayoutSaveQueueRef<T | null>;
  inFlight: OfficeLayoutSaveQueueRef<boolean>;
  drainRequested: OfficeLayoutSaveQueueRef<boolean>;
}

export interface OfficeLayoutSaveQueueSettlement<
  T extends OfficeLayoutSaveQueueItem,
  R extends OfficeLayoutSaveQueueResult,
> {
  item: T;
  result: R;
  newerPending: boolean;
}

/**
 * Queue a snapshot without allowing a stale async continuation to replace a
 * newer snapshot from the same authenticated Office scope.
 */
export function queueLatestOfficeLayoutSave<T extends OfficeLayoutSaveQueueItem>(
  state: Pick<OfficeLayoutSaveQueueState<T>, 'pending' | 'active'>,
  item: T,
): boolean {
  const waiting = state.pending.current;
  const active = state.active.current;
  if (waiting && waiting.scope === item.scope && waiting.version > item.version) return false;
  if (active && active.scope === item.scope && active.version >= item.version) return false;
  state.pending.current = item;
  return true;
}

/**
 * Drain one serialized newest-snapshot queue.
 *
 * Important failure behavior:
 * - a non-conflicting failure advances to a newer waiting snapshot once;
 * - without a newer snapshot, the failed item stays queued for explicit retry;
 * - a conflict pauses immediately for a fresh authoritative read, while the
 *   newest waiting snapshot remains queued;
 * - calls made during an in-flight request record a re-drain request instead
 *   of starting a competing writer.
 */
export async function drainLatestOfficeLayoutSaveQueue<
  T extends OfficeLayoutSaveQueueItem,
  R extends OfficeLayoutSaveQueueResult,
>(
  state: OfficeLayoutSaveQueueState<T>,
  handlers: {
    getActiveScope: () => string | null;
    save: (item: T) => Promise<R>;
    onSettled?: (settlement: OfficeLayoutSaveQueueSettlement<T, R>) => void | Promise<void>;
  },
): Promise<void> {
  if (state.inFlight.current) {
    state.drainRequested.current = true;
    return;
  }

  state.inFlight.current = true;
  state.drainRequested.current = false;
  try {
    while (state.pending.current) {
      const item = state.pending.current;
      state.pending.current = null;
      state.active.current = item;
      state.drainRequested.current = false;

      if (handlers.getActiveScope() !== item.scope) {
        state.active.current = null;
        continue;
      }
      let result: R;
      try {
        result = await handlers.save(item);
      } catch (error) {
        // A rejected transport is the same durability outcome as an explicit
        // failed result: restore the exact snapshot unless a newer one is
        // already waiting, then let the caller surface the original error.
        const waiting = state.pending.current as T | null;
        if (!waiting || (waiting.scope === item.scope && waiting.version <= item.version)) {
          state.pending.current = item;
        }
        state.active.current = null;
        throw error;
      }
      state.active.current = null;
      if (handlers.getActiveScope() !== item.scope) continue;

      // The ref may be updated by another flush invocation while `save`
      // awaits; read it as live state instead of retaining the pre-await null
      // control-flow narrowing.
      const waiting = state.pending.current as T | null;
      const newerPending = Boolean(
        waiting
        && waiting.scope === item.scope
        && waiting.version > item.version,
      );

      if (!result.ok && !newerPending) {
        queueLatestOfficeLayoutSave(state, item);
      }
      try {
        await handlers.onSettled?.({ item, result, newerPending });
      } catch (error) {
        if (!result.ok) queueLatestOfficeLayoutSave(state, item);
        throw error;
      }

      if (!result.ok && (result.conflict || !newerPending)) break;
    }
  } finally {
    state.active.current = null;
    state.inFlight.current = false;
    state.drainRequested.current = false;
  }
}

export const OFFICE_LAYOUT_REQUEST_DEADLINE_MS = 12_000;

export class OfficeLayoutRequestDeadlineError extends Error {
  constructor(timeoutMs: number) {
    super(`Office layout request exceeded its ${timeoutMs}ms deadline.`);
    this.name = 'OfficeLayoutRequestDeadlineError';
  }
}

/**
 * Bound and abort a server write. The Promise race is intentional: aborting a
 * transport is advisory, so the caller still settles even if a client ignores
 * the signal. The versioned RPC keeps any late request safe and idempotent.
 */
export async function runOfficeLayoutRequestWithDeadline<T>(
  operation: (signal: AbortSignal) => PromiseLike<T>,
  timeoutMs = OFFICE_LAYOUT_REQUEST_DEADLINE_MS,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new OfficeLayoutRequestDeadlineError(0);
  }
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      Promise.resolve(operation(controller.signal)),
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new OfficeLayoutRequestDeadlineError(timeoutMs));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
