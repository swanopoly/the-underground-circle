/**
 * commandFrecencyCore — per-user "frequent + recent" ranking for the chat
 * slash-command menu (chat-commands expansion v7).
 *
 * A bare `/` lists all ~103 registry commands alpha-sorted
 * (`getMatchingChatCommands` in `src/lib/chatCommandRegistry.ts`). This core
 * lets the composer float the commands THIS user actually reaches for to the
 * top, without disturbing the relative order of everything else.
 *
 * Purity + totality
 * -----------------
 * - Zero imports (type-only shape via a structural `{ command: string }`
 *   constraint), so it loads under tsx. No `Date.now()` / `Math.random()` at
 *   module scope — every function that needs the clock takes `nowMs`.
 * - Every export is TOTAL: null / undefined / wrong-type / huge / hostile /
 *   cyclic input yields a safe neutral value and never throws.
 * - Bounded: the tracked usage map is capped at `MAX_TRACKED_COMMANDS`; a
 *   re-rank is always a permutation of its input (no command dropped or
 *   duplicated). Keys are bounded-length, lowercased `/command` strings.
 * - Secret-safe: only ever stores / echoes a normalized `/command` key — never
 *   a raw token or credential.
 *
 * Model
 * -----
 * `recordCommandUsage` bumps a command's `count` + `lastUsedMs` in a NEW map
 * (it never mutates its input). `frecencyScore` = frequency (count) ×
 * exponential recency decay with a 14-day half-life. `rerankByFrecency` pulls
 * the used commands to the front ranked by summed frecency — argument variants
 * like `/gh cat a.ts` + `/gh cat b.ts` both credit the `/gh cat` candidate via
 * a longest-command-prefix (most-specific) assignment — and leaves every other
 * command in its original relative order.
 */

export interface CommandUsage {
  command: string;
  count: number;
  lastUsedMs: number;
}

/** 14-day half-life for the recency term, in milliseconds. */
export const USAGE_HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000;

/** Hard cap on tracked commands so the persisted usage map stays bounded. */
export const MAX_TRACKED_COMMANDS = 200;

/** Clamp so a hostile count can never produce a non-finite frecency score. */
const MAX_COUNT = 1_000_000;

/** Bound on a stored command key so one giant paste cannot bloat a row. */
const MAX_KEY_LEN = 120;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function sanitizeMs(value: unknown, fallback: number): number {
  return isFiniteNumber(value) ? value : fallback;
}

function sanitizeCount(value: unknown): number {
  if (!isFiniteNumber(value)) return 0;
  const n = Math.floor(value);
  if (n <= 0) return 0;
  return n > MAX_COUNT ? MAX_COUNT : n;
}

/**
 * Normalize a raw command string into a stable usage key: trimmed, lowercased,
 * inner whitespace collapsed, must start with `/`, length-bounded. Returns
 * `null` for anything that is not a usable slash command (non-string, empty,
 * bare `/`, no leading slash).
 */
export function normalizeCommandKey(command: unknown): string | null {
  if (typeof command !== 'string') return null;
  let s = command.trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/\s+/g, ' ');
  if (!s.startsWith('/')) return null;
  if (s === '/') return null;
  if (s.length > MAX_KEY_LEN) s = s.slice(0, MAX_KEY_LEN);
  return s;
}

/**
 * frequency × recency: `count × 0.5 ^ (age / halfLife)`. A fresh use scores its
 * full count; each 14 days of silence halves it. Future `lastUsedMs` (age < 0)
 * is clamped to 0 (no decay); an invalid `nowMs` degrades to frequency-only.
 * Always a finite, non-negative number.
 */
export function frecencyScore(usage: unknown, nowMs: number): number {
  if (!usage || typeof usage !== 'object') return 0;
  const count = sanitizeCount((usage as { count?: unknown }).count);
  if (count <= 0) return 0;
  const rawLast = (usage as { lastUsedMs?: unknown }).lastUsedMs;
  const lastMs = isFiniteNumber(rawLast) ? rawLast : 0;
  const now = isFiniteNumber(nowMs) ? nowMs : lastMs;
  const age = now > lastMs ? now - lastMs : 0;
  const decay = Math.pow(0.5, age / USAGE_HALF_LIFE_MS);
  const score = count * decay;
  return Number.isFinite(score) && score > 0 ? score : 0;
}

/**
 * Build a clean, bounded `Record<string, CommandUsage>` from arbitrary input —
 * dropping non-slash keys and non-object values, clamping counts, merging any
 * keys that collapse to the same normalized command. Always a NEW object.
 */
function sanitizeUsageMap(map: unknown): Record<string, CommandUsage> {
  const out: Record<string, CommandUsage> = {};
  if (!map || typeof map !== 'object') return out;
  let keys: string[];
  try {
    keys = Object.keys(map as Record<string, unknown>);
  } catch {
    return out;
  }
  let size = 0;
  for (const rawKey of keys) {
    const key = normalizeCommandKey(rawKey);
    if (!key) continue;
    let value: unknown;
    try {
      value = (map as Record<string, unknown>)[rawKey];
    } catch {
      continue;
    }
    if (!value || typeof value !== 'object') continue;
    const count = sanitizeCount((value as { count?: unknown }).count);
    const lastUsedMs = sanitizeMs((value as { lastUsedMs?: unknown }).lastUsedMs, 0);
    const existing = out[key];
    if (existing) {
      existing.count = Math.min(existing.count + count, MAX_COUNT);
      if (lastUsedMs > existing.lastUsedMs) existing.lastUsedMs = lastUsedMs;
      continue;
    }
    if (size >= MAX_TRACKED_COMMANDS) continue;
    out[key] = { command: key, count, lastUsedMs };
    size += 1;
  }
  return out;
}

/**
 * Record one use of `command` at `nowMs`. Returns a NEW, sanitized, bounded
 * usage map with that command's `count` bumped and `lastUsedMs` set — never
 * mutating the input. If `command` is not a usable slash command the map is
 * returned sanitized but otherwise unchanged. When adding a new command would
 * exceed `MAX_TRACKED_COMMANDS`, the lowest-frecency existing command is
 * evicted (never the one just recorded).
 */
export function recordCommandUsage(
  map: unknown,
  command: unknown,
  nowMs: number,
): Record<string, CommandUsage> {
  const next = sanitizeUsageMap(map);
  const key = normalizeCommandKey(command);
  if (!key) return next;
  const now = sanitizeMs(nowMs, 0);
  const existing = next[key];
  const prevCount = existing ? existing.count : 0;
  next[key] = {
    command: key,
    count: Math.min(prevCount + 1, MAX_COUNT),
    lastUsedMs: now,
  };
  const keys = Object.keys(next);
  if (keys.length > MAX_TRACKED_COMMANDS) {
    let victim: string | null = null;
    let victimScore = Infinity;
    for (const k of keys) {
      if (k === key) continue;
      const score = frecencyScore(next[k], now);
      if (score < victimScore) {
        victimScore = score;
        victim = k;
      }
    }
    if (victim) delete next[victim];
  }
  return next;
}

/**
 * Re-rank a list of commands so the user's used commands come first (ranked by
 * summed frecency, highest first), followed by every other command in its
 * original relative order. Stable, deterministic, and a strict permutation of
 * the input: no command is ever dropped or duplicated (hostile / junk elements
 * pass through untouched in the trailing block).
 *
 * Each usage key is credited to the single most-specific matching candidate
 * (longest command that is the key itself or a whitespace-delimited prefix of
 * it), so `/gh cat a.ts` boosts `/gh cat` rather than `/gh`.
 */
export function rerankByFrecency<T extends { command: string }>(
  commands: T[],
  usage: unknown,
  nowMs: number,
): T[] {
  if (!Array.isArray(commands)) return [];
  const items = commands;

  const candidates: Array<{ idx: number; cmd: string }> = [];
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i] as unknown;
    if (item && typeof item === 'object' && typeof (item as { command?: unknown }).command === 'string') {
      const cmd = normalizeCommandKey((item as { command: string }).command);
      if (cmd) candidates.push({ idx: i, cmd });
    }
  }
  if (candidates.length === 0) return items.slice();

  const map = sanitizeUsageMap(usage);
  const usageKeys = Object.keys(map);
  if (usageKeys.length === 0) return items.slice();

  const scoreByIdx = new Map<number, number>();
  for (const uKey of usageKeys) {
    let bestIdx = -1;
    let bestLen = -1;
    for (const cand of candidates) {
      const isMatch = uKey === cand.cmd || uKey.startsWith(`${cand.cmd} `);
      // candidates are in ascending index order, so a strict `>` keeps the
      // earliest index when two candidates tie on length.
      if (isMatch && cand.cmd.length > bestLen) {
        bestLen = cand.cmd.length;
        bestIdx = cand.idx;
      }
    }
    if (bestIdx < 0) continue;
    const score = frecencyScore(map[uKey], nowMs);
    if (score > 0) scoreByIdx.set(bestIdx, (scoreByIdx.get(bestIdx) ?? 0) + score);
  }
  if (scoreByIdx.size === 0) return items.slice();

  const usedIdx: number[] = [];
  scoreByIdx.forEach((score, idx) => {
    if (score > 0) usedIdx.push(idx);
  });
  usedIdx.sort((a, b) => {
    const sa = scoreByIdx.get(a) ?? 0;
    const sb = scoreByIdx.get(b) ?? 0;
    if (sb !== sa) return sb - sa;
    return a - b;
  });

  const usedSet = new Set(usedIdx);
  const out: T[] = [];
  for (const idx of usedIdx) out.push(items[idx]);
  for (let i = 0; i < items.length; i += 1) {
    if (!usedSet.has(i)) out.push(items[i]);
  }
  return out;
}
