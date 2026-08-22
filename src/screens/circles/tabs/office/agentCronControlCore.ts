export type CronJobControlSnapshot = Readonly<{
  id: string;
  enabled: boolean;
  name?: string;
  schedule?: string;
  payload?: string;
  delivery?: string;
  sessionTarget?: string;
  timezone?: string;
}>;

const normalizedText = (value: unknown): string => (
  typeof value === 'string' ? value.trim() : ''
);

/** Compare the provider-controlled fields that determine a cron action target. */
export function cronJobControlSnapshotMatches(
  expected: CronJobControlSnapshot,
  current: CronJobControlSnapshot,
): boolean {
  return expected.id === current.id
    && expected.enabled === current.enabled
    && normalizedText(expected.name) === normalizedText(current.name)
    && normalizedText(expected.schedule) === normalizedText(current.schedule)
    && normalizedText(expected.payload) === normalizedText(current.payload)
    && normalizedText(expected.delivery) === normalizedText(current.delivery)
    && normalizedText(expected.sessionTarget) === normalizedText(current.sessionTarget)
    && normalizedText(expected.timezone) === normalizedText(current.timezone);
}
