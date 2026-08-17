export type NormalizedMissionStreak = Readonly<{
  userId: string;
  circleId: string;
  currentStreak: number;
  longestStreak: number;
  lastCompletionDate: string | null;
  totalTasksCompleted: number;
}>;

function exactNonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    ? value
    : null;
}

/**
 * Validate one durable streak row without coercing malformed values to zero.
 * `null` means the exact query proved that no row exists; it is distinct from
 * an invalid or inaccessible response (`undefined`).
 */
export function normalizeMissionStreakRowExact(
  row: unknown,
  authority: Readonly<{ userId: string; circleId: string }>,
): NormalizedMissionStreak | null | undefined {
  if (row === null) return null;
  if (!row || typeof row !== 'object' || Array.isArray(row)) return undefined;
  const record = row as Record<string, unknown>;
  const currentStreak = exactNonNegativeInteger(record.current_streak);
  const longestStreak = exactNonNegativeInteger(record.longest_streak);
  const totalTasksCompleted = exactNonNegativeInteger(record.total_tasks_completed);
  const lastCompletionDate = record.last_completion_date;
  const parsedCompletionDate = typeof lastCompletionDate === 'string'
    ? new Date(`${lastCompletionDate}T00:00:00.000Z`)
    : null;
  if (
    record.user_id !== authority.userId
    || record.circle_id !== authority.circleId
    || currentStreak === null
    || longestStreak === null
    || totalTasksCompleted === null
    || currentStreak > longestStreak
    || currentStreak > totalTasksCompleted
    || (currentStreak > 0 && lastCompletionDate === null)
    || (
      lastCompletionDate !== null
      && (
        typeof lastCompletionDate !== 'string'
        || !/^\d{4}-\d{2}-\d{2}$/.test(lastCompletionDate)
        || !parsedCompletionDate
        || !Number.isFinite(parsedCompletionDate.getTime())
        || parsedCompletionDate.toISOString().slice(0, 10) !== lastCompletionDate
      )
    )
  ) return undefined;
  return {
    userId: authority.userId,
    circleId: authority.circleId,
    currentStreak,
    longestStreak,
    lastCompletionDate: lastCompletionDate as string | null,
    totalTasksCompleted,
  };
}
