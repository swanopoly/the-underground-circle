/**
 * officeRunRowTelemetryCore — pure per-run-row telemetry suffix formatting for
 * the Office ops board.
 *
 * OfficeRunNode has carried `tokens` and `costUsd` since the board model
 * shipped, but RunRow never rendered them — a run row showed elapsed time
 * only. This core turns those fields into one bounded suffix string the row
 * can append after its time label, e.g. " · $0.04 · 12k".
 *
 * Rules (smoke-testable via tsx):
 *   - ZERO runtime imports beyond the pure officeOpsBoard formatter (which is
 *     itself import-type-only), so tsx/esbuild loads this directly.
 *   - Elision over noise: a cost below half a cent or a token count below 500
 *     is dropped rather than rendered as "$0.00" / "3" clutter.
 *   - Totality: null / undefined / NaN / negative / hostile input yields ''
 *     or a partial suffix — never a throw, never "NaN".
 */

import { formatTokenCount } from './officeOpsBoard';

/** Costs below this render as nothing (would round to "$0.00"). */
export const RUN_ROW_MIN_COST_USD = 0.005;

/** Token totals below this are noise on a one-line row and are elided. */
export const RUN_ROW_MIN_TOKENS = 500;

/** Separator used between the row's time label and each telemetry part. */
export const RUN_ROW_TELEMETRY_SEPARATOR = ' · ';

export interface RunRowTelemetryInput {
  /** Board-node token counts (input/output/cached), possibly absent. */
  tokens?: { input?: number; output?: number; cached?: number } | null;
  /** Estimated run cost in USD, possibly absent. */
  costUsd?: number | null;
}

function toNonNegativeFinite(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/** Total token count across input/output/cached; 0 for absent/garbage. */
export function runRowTokenTotal(tokens: RunRowTelemetryInput['tokens']): number {
  if (!tokens || typeof tokens !== 'object') return 0;
  return (
    toNonNegativeFinite(tokens.input) +
    toNonNegativeFinite(tokens.output) +
    toNonNegativeFinite(tokens.cached)
  );
}

/**
 * Format the run-row telemetry suffix: " · $0.04 · 12k", " · $1.20", " · 3.4M",
 * or '' when neither field clears its threshold. Cost renders first (the
 * decision-relevant number), then tokens with the board's k/M convention.
 */
export function formatRunRowTelemetry(input: RunRowTelemetryInput | null | undefined): string {
  const safe = input && typeof input === 'object' ? input : {};
  const parts: string[] = [];

  const cost = toNonNegativeFinite(safe.costUsd);
  if (cost >= RUN_ROW_MIN_COST_USD) {
    parts.push(`$${cost.toFixed(2)}`);
  }

  const totalTokens = runRowTokenTotal(safe.tokens);
  if (totalTokens >= RUN_ROW_MIN_TOKENS) {
    parts.push(formatTokenCount(totalTokens));
  }

  if (parts.length === 0) return '';
  return RUN_ROW_TELEMETRY_SEPARATOR + parts.join(RUN_ROW_TELEMETRY_SEPARATOR);
}
