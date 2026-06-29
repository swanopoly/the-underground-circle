/**
 * wordpressScheduleDate — pure helper for scheduling WordPress posts at the
 * correct absolute time.
 *
 * Bug it fixes: `handleSchedule` did `new Date(str).toISOString()` and sent the
 * Z-suffixed UTC value in the REST `date` field. WordPress treats `date` as
 * SITE-LOCAL time and `date_gmt` as UTC, so a UTC wall-clock placed in `date`
 * shifts the publish hour by the gap between the runtime timezone and the
 * site's timezone.
 *
 * Fix: send the UTC instant in `date_gmt` (formatted without a timezone
 * designator, which WordPress reads as GMT) and let WordPress derive the local
 * `date`. This makes the scheduled instant independent of the runtime TZ.
 *
 * Dependency-light (no imports) so the smoke harness (tsx/esbuild) can load it.
 */

/**
 * Format a Date as the GMT wall-clock string WordPress expects in `date_gmt`:
 * ISO 8601 without milliseconds or timezone suffix, e.g. `2026-07-01T17:00:00`.
 * Throws on a missing/invalid Date so callers fail loud rather than scheduling
 * at the epoch.
 */
export function toWordPressDateGmt(date: Date): string {
  if (!date || typeof date.getTime !== 'function' || Number.isNaN(date.getTime())) {
    throw new Error('toWordPressDateGmt: invalid Date');
  }
  return date.toISOString().slice(0, 19);
}
