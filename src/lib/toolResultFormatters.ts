/**
 * toolResultFormatters — composable, token-budget-aware result formatting
 * for OpenSwan runtime tool results (T10 of `SWANBOT_OPENSWAN_CHAT_NEXT_PLAN`).
 *
 * ## Why
 *
 * Tool results ARE the model's context. `formatOpenSwanRuntimeToolResult`
 * grew ~1,900 lines of hand-rolled per-tool formatting with inconsistent
 * detail levels — some tools dump unbounded lists, others over-truncate.
 * Observation-heavy tools (a11y trees, DOM snapshots, file lists) now take
 * `response_format: 'concise' | 'detailed'` (default concise) so the model
 * gets a bounded high-signal summary by default and only pays for the full
 * payload when it explicitly asks.
 *
 * ## What this module is
 *
 * Small pure helpers (no React Native, no Supabase — smoke-testable with
 * tsx, same precedent as `swanbotV2Retry.ts`). New/updated formatter cases
 * in `openswanToolRuntime.ts` should compose these instead of hand-rolling
 * truncation; legacy cases migrate incrementally.
 */

export type ToolResponseFormat = 'concise' | 'detailed';

/** Marker appended by `truncateText` so the model knows MORE exists and how to get it. */
export function truncationMarker(removedChars: number): string {
  return `…[truncated ${removedChars} chars — ask for detailed if needed]`;
}

/**
 * Normalize an untrusted `response_format` arg. Anything other than the
 * exact string 'detailed' (case-insensitively) resolves to 'concise', so
 * absent/garbage input always takes the bounded path.
 */
export function resolveResponseFormat(value: unknown): ToolResponseFormat {
  return typeof value === 'string' && value.trim().toLowerCase() === 'detailed' ? 'detailed' : 'concise';
}

/**
 * Bound `text` to `maxChars`, appending an explicit truncation marker that
 * tells the model how many chars were dropped and that `detailed` exists.
 * Returns the text unchanged when it already fits.
 */
export function truncateText(
  text: string,
  maxChars: number,
  options?: { note?: string },
): string {
  const input = String(text ?? '');
  const cap = Math.max(0, Math.floor(maxChars));
  if (input.length <= cap) return input;
  const removed = input.length - cap;
  const note = options?.note ? ` ${options.note}` : '';
  return `${input.slice(0, cap)}\n${truncationMarker(removed)}${note}`;
}

/**
 * Render up to `max` items as `- item` bullets; collapses the overflow into
 * a single `… +N more` line (or a custom `more` label) so long lists stay
 * cheap but the model knows the true count.
 */
export function formatBulletList(
  items: ReadonlyArray<string>,
  options?: { max?: number; more?: (hidden: number) => string },
): string {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return '(none)';
  const max = Math.max(1, Math.floor(options?.max ?? 50));
  const shown = list.slice(0, max).map((item) => (item.startsWith('- ') || /^\d+\. /.test(item) ? item : `- ${item}`));
  const hidden = list.length - max;
  if (hidden > 0) {
    shown.push(options?.more ? options.more(hidden) : `… +${hidden} more`);
  }
  return shown.join('\n');
}

/**
 * Render selected keys of an object as `key: value` lines. Skips
 * null/undefined/empty-string values. `keys` controls order + selection
 * (defaults to all own keys); `max` bounds the line count.
 */
export function formatKeyValues(
  obj: Record<string, unknown>,
  options?: { keys?: ReadonlyArray<string>; max?: number },
): string {
  const source = obj && typeof obj === 'object' ? obj : {};
  const keys = options?.keys ?? Object.keys(source);
  const max = Math.max(1, Math.floor(options?.max ?? (keys.length || 1)));
  const lines: string[] = [];
  for (const key of keys) {
    if (lines.length >= max) break;
    const value = (source as Record<string, unknown>)[key];
    if (value === null || value === undefined || value === '') continue;
    lines.push(`${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`);
  }
  return lines.join('\n');
}

/** Pluralized count: `formatCount('file', 3)` → `3 files`; 1 → `1 file`. */
export function formatCount(noun: string, n: number): string {
  const count = Number.isFinite(n) ? n : 0;
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** Success line with the consistent `OK:` prefix. */
export function formatOkLine(message: string): string {
  return `OK: ${message}`;
}

/** Failure line with the consistent `Error:` prefix. */
export function formatErrorLine(message: string): string {
  return `Error: ${message}`;
}

/**
 * Join items with newlines while staying under `charBudget` total chars;
 * drops the tail and appends `… +N more` when the budget runs out. Always
 * includes at least one item (truncated to the budget if necessary) so a
 * single oversized entry can't produce an empty result.
 */
export function boundListWithBudget(
  items: ReadonlyArray<string>,
  charBudget: number,
): string {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return '(none)';
  const budget = Math.max(1, Math.floor(charBudget));
  const shown: string[] = [];
  let used = 0;
  for (const item of list) {
    const cost = item.length + (shown.length > 0 ? 1 : 0); // +1 for the join newline
    if (shown.length > 0 && used + cost > budget) break;
    if (shown.length === 0 && cost > budget) {
      shown.push(truncateText(item, budget));
      used = budget;
      break;
    }
    shown.push(item);
    used += cost;
  }
  const hidden = list.length - shown.length;
  if (hidden > 0) shown.push(`… +${hidden} more`);
  return shown.join('\n');
}
