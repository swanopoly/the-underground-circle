/**
 * automationCadenceFormat - pure, dependency-light formatters for the
 * OpenSwan Control Panel's saved-automation rows. Kept out of the React
 * component so the mapping is smoke-testable (tsx/esbuild can't load
 * react-native). No imports; display-only string helpers.
 */

// Map the small set of crons the cadence picker emits to a legible label.
// Anything unrecognized falls back to the verbatim cron so we never hide
// information from the user.
const CRON_CADENCE_LABELS: Record<string, string> = {
  '0 9 * * 1': 'Weekly · Mon 9am',
  '0 9 * * *': 'Daily · 9am',
  '0 * * * *': 'Hourly',
};

export function cronToHuman(cron: string | null | undefined): string {
  if (cron == null) return 'Manual';
  const trimmed = cron.trim();
  if (!trimmed) return 'Manual';
  return CRON_CADENCE_LABELS[trimmed] || trimmed;
}

// Compact relative-time formatter for next-run / last-run hints. Returns a
// bounded short string; never throws on bad input.
export function relTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '—';
  const diffMs = then - Date.now();
  const future = diffMs >= 0;
  const abs = Math.abs(diffMs);
  const mins = Math.round(abs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return future ? `in ${mins}m` : `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return future ? `in ${hours}h` : `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return future ? `in ${days}d` : `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return future ? `in ${months}mo` : `${months}mo ago`;
  const years = Math.round(months / 12);
  return future ? `in ${years}y` : `${years}y ago`;
}
