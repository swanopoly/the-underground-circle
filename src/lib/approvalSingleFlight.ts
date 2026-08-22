/**
 * Process-local coalescing for approval workers.
 *
 * This avoids duplicate validation/preflight work for the common UI/sweep race.
 * It is only an optimization: each side-effecting handler still owns a durable
 * `applied_at IS NULL` compare-and-set immediately before dispatch so another
 * tab or process cannot enter the same mutation.
 */
export function createApprovalSingleFlight<TResult>(): (
  approvalId: string,
  task: () => Promise<TResult>,
) => Promise<TResult> {
  const inFlight = new Map<string, Promise<TResult>>();

  return (approvalId, task) => {
    const key = String(approvalId || '').trim();
    const existing = inFlight.get(key);
    if (existing) return existing;

    let run!: Promise<TResult>;
    run = Promise.resolve()
      .then(task)
      .finally(() => {
        if (inFlight.get(key) === run) inFlight.delete(key);
      });
    inFlight.set(key, run);
    return run;
  };
}
