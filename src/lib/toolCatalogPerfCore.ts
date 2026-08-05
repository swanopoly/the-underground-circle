/**
 * toolCatalogPerfCore — the two pure hot-path helpers behind R4 + R5 of
 * `docs/OPENSWAN_HOTPATH_OPTIMIZATION_PLAN.md` for the OpenSwan tool catalog
 * (`src/lib/openswanToolRuntime.ts`).
 *
 * What it exists to solve
 * -----------------------
 * R5 — kill the O(n^2) linear scan. `getOpenSwanToolDisclosure`
 * (`openswanToolRuntime.ts:5206`) does `TOOL_DEFINITIONS.find((t) => t.name === tool)`
 * on every call, and `listPinnedOpenSwanToolsForSurface` (`:5216-5220`) calls it
 * INSIDE a `.filter` over all ~157 definitions → O(n^2) for pinned-core assembly.
 * `buildOpenSwanToolBrief` (`:5465`) also rebuilds a `new Map(name→def)` on every
 * call. `buildToolDefIndex` builds that name→def `Map` ONCE so both sites become
 * an O(1) `.get`.
 *
 * R4 — memoize per-turn catalog assembly. `listOpenSwanAnthropicToolsForSurface`
 * (`openswanToolRuntime.ts:5381`) walks all definitions through four `.filter`s +
 * `attachToolInputExamples` on EVERY call — once per turn for the pinned core and
 * again every round via `resolveAdditionalTools`. Its inputs are pure
 * (`surface`, `mode`, `allowedToolNames`) and `TOOL_DEFINITIONS` is a module
 * const, so the output can be cached in a module-level `Map`. `toolCatalogMemoKey`
 * produces the STABLE, order-insensitive cache key for that `Map`, and
 * `shouldRebuildCatalog` is the cheap "did the key drift?" predicate.
 *
 * Grounding (READ, not imported — this file must stay tsx-loadable):
 *   - `OpenSwanToolDefinition` = `{ name, label, surfaces, description, ... }`
 *     — the index is keyed on `name`.
 *   - `listOpenSwanAnthropicToolsForSurface(surface, allowedToolNames?, mode?)`
 *     normalizes `modeKey = (typeof mode === 'string' && mode) ? mode : null`
 *     and `allow = allowedToolNames?.length ? new Set(allowedToolNames) : null`.
 *     The memo key mirrors BOTH normalizations so equal effective-inputs → equal
 *     key and (critically) different effective-inputs → different key.
 *
 * The one subtle correctness invariant (do not "simplify" it away)
 * ----------------------------------------------------------------
 * An allowlist that is absent OR an empty array means "NO filter → full catalog";
 * an allowlist with length >= 1 means "filter to this set". A non-empty allowlist
 * whose entries are all non-strings (e.g. `[123]`) still filters (downstream
 * `.length` is truthy) and yields an EMPTY catalog — a DIFFERENT output from the
 * full catalog. So the key carries a separate `hasFilter` flag derived from the
 * ARRAY LENGTH, never from the count of usable string entries. Only string
 * entries can ever match a real tool name, so once `hasFilter` is fixed only the
 * SET of string entries affects output — that set is deduped + sorted (→
 * order-insensitive) and hashed.
 *
 * Purity / safety contract (smoke-tested under tsx):
 *   - ZERO runtime imports (no react-native / supabase / deno). No
 *     Date.now()/Math.random() at module scope. No import-time side effects.
 *   - Every export is TOTAL: null / undefined / wrong-type / huge / hostile
 *     (throwing getters, Proxies, cyclic) input never throws — it degrades to a
 *     safe neutral (empty Map / stable string / boolean). Output is BOUNDED.
 *   - SECRET-SAFE: the allowlist is HASHED (never echoed); only the enum-like
 *     `surface`/`mode` (non-secret) are echoed, clamped, separator-stripped.
 *   - DETERMINISTIC: identical inputs → identical output, across processes.
 */

// ─── Bounds ─────────────────────────────────────────────────────────────────

/** Max definitions folded into the index (bounds a hostile huge `defs` array). */
export const MAX_TOOL_DEFS = 4096;
/**
 * Max tool-name length. Real names (`desktop.read_a11y_tree`) are short; a name
 * longer than this cannot be a real tool, so the index SKIPS it (rather than
 * clamping — clamping could collide two distinct long names) and the memo key
 * clamps it before hashing. Keeps both bounded without breaking real lookups.
 */
export const MAX_TOOL_NAME_CHARS = 512;
/** Max allowlist entries scanned for the memo key (bounds a hostile huge array). */
export const MAX_ALLOWLIST_ENTRIES = 8192;
/** Clamp on the echoed `surface` field (enum-like, tiny in practice). */
export const MAX_SURFACE_CHARS = 128;
/** Clamp on the echoed `mode` field (enum-like, tiny in practice). */
export const MAX_MODE_CHARS = 64;
/** Version tag so a future key-format change can't silently collide with old keys. */
export const TOOL_CATALOG_MEMO_KEY_VERSION = 'v1';

/**
 * Field separator for joined keys. ASCII unit separator (0x1f) essentially never
 * appears in a real surface/mode/name, and echoed fields have it stripped, so the
 * join is unambiguous → collision-resistant.
 */
const FIELD_SEP = '\x1f';

/** Canonical token for "no mode" — mirrors the runtime's `modeKey === null`. */
const NO_MODE_TOKEN = '-';

// ─── Internal helpers (all total, none throw) ────────────────────────────────

/** Only genuine non-null objects are indexable; everything else → null. */
function asObject(input: unknown): Record<string, unknown> | null {
  if (input === null || typeof input !== 'object') return null;
  return input as Record<string, unknown>;
}

/**
 * Read a named property tolerating hostile objects whose getters throw (Proxies,
 * `Object.defineProperty` traps). Never throws → returns undefined on any fault.
 */
function readField(obj: Record<string, unknown> | null, key: string): unknown {
  if (!obj) return undefined;
  try {
    return (obj as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

/**
 * Coerce a scalar to a bounded string. Only strings / finite numbers / booleans
 * pass through; objects/functions/symbols/null/undefined/NaN → '' (we never call
 * String()/toString() on arbitrary values so a hostile/cyclic input can't throw).
 */
function coerceScalar(value: unknown, maxChars: number): string {
  let out: string;
  if (typeof value === 'string') out = value;
  else if (typeof value === 'number' && Number.isFinite(value)) out = String(value);
  else if (typeof value === 'boolean') out = value ? 'true' : 'false';
  else return '';
  return out.length > maxChars ? out.slice(0, maxChars) : out;
}

/** Echoed key field: strip the separator (so it can't forge a field boundary) then clamp. */
function coerceKeyField(value: unknown, maxChars: number): string {
  const s = coerceScalar(value, maxChars);
  return s.indexOf(FIELD_SEP) >= 0 ? s.split(FIELD_SEP).join('') : s;
}

/**
 * Mirror the runtime's mode normalization exactly:
 *   `modeKey = (typeof mode === 'string' && mode) ? mode : null`.
 * A non-empty string mode → that string (clamped/stripped); anything else (null,
 * undefined, '', number, object) → the single NO_MODE_TOKEN. This keeps
 * distinct real modes ('build' vs 'review') on distinct keys while collapsing
 * every "no mode" spelling onto one token.
 */
function coerceModeField(value: unknown): string {
  if (typeof value === 'string' && value.length > 0) {
    const stripped = value.indexOf(FIELD_SEP) >= 0 ? value.split(FIELD_SEP).join('') : value;
    return stripped.length > MAX_MODE_CHARS ? stripped.slice(0, MAX_MODE_CHARS) : stripped;
  }
  return NO_MODE_TOKEN;
}

/**
 * cyrb53 — fast, deterministic, well-mixed 53-bit string hash. Fixed seed (no
 * Math.random) so the digest is stable across processes. Total for any string.
 */
function cyrb53(str: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * Hash a set of already-canonical string tokens. LENGTH-PREFIXED so no token's
 * content can shift a boundary (`"a"+"bc"` never collides with `"ab"+"c"`), and
 * the raw values never survive into output — only the hex digest does. The caller
 * sorts+dedups first, so this is order-insensitive. Total.
 */
function hashTokens(sortedTokens: string[]): string {
  let canonical = TOOL_CATALOG_MEMO_KEY_VERSION;
  for (const t of sortedTokens) canonical += FIELD_SEP + t.length + ':' + t;
  return cyrb53(canonical).toString(16);
}

/**
 * From a raw allowlist value, derive the deduped + sorted set of usable STRING
 * entries plus whether the array imposes a filter at all. Non-array → no filter,
 * empty set. Only string entries are kept (only strings can match a real tool
 * name); non-string entries never affect output but DO make the array non-empty,
 * which `hasFilter` (read from `.length`) captures independently. Bounded by
 * MAX_ALLOWLIST_ENTRIES; each kept name clamped to MAX_TOOL_NAME_CHARS.
 */
function canonicalizeAllowlist(value: unknown): { hasFilter: boolean; tokens: string[] } {
  if (!Array.isArray(value)) return { hasFilter: false, tokens: [] };
  let length = 0;
  try {
    length = value.length;
  } catch {
    return { hasFilter: false, tokens: [] };
  }
  if (!(length >= 1)) return { hasFilter: false, tokens: [] };
  const scan = length > MAX_ALLOWLIST_ENTRIES ? MAX_ALLOWLIST_ENTRIES : length;
  const seen = new Set<string>();
  for (let i = 0; i < scan; i++) {
    let entry: unknown;
    try {
      entry = value[i];
    } catch {
      continue;
    }
    if (typeof entry !== 'string') continue;
    const name = entry.length > MAX_TOOL_NAME_CHARS ? entry.slice(0, MAX_TOOL_NAME_CHARS) : entry;
    seen.add(name);
  }
  const tokens = Array.from(seen).sort();
  return { hasFilter: true, tokens };
}

// ─── Exports ────────────────────────────────────────────────────────────────

/**
 * R5 — build the `name → def` index ONCE so `getOpenSwanToolDisclosure` /
 * `buildOpenSwanToolBrief` become an O(1) `.get` instead of an O(n) `.find` (and
 * the pinned-core assembly O(n) instead of O(n^2)).
 *
 * `defs` is the `TOOL_DEFINITIONS` array (each `{ name, ... }`). Entries that are
 * not objects, or whose `name` is not a non-empty string within
 * MAX_TOOL_NAME_CHARS, are skipped (never throw). Duplicate names are LAST-WINS,
 * matching `new Map(defs.map(d => [d.name, d]))` in `buildOpenSwanToolBrief`
 * (`TOOL_DEFINITIONS` has unique names in practice, so this only matters for
 * hostile input). Values are the original def objects (by reference). Bounded to
 * MAX_TOOL_DEFS entries. Total → returns an empty Map on any non-array/hostile
 * input.
 */
export function buildToolDefIndex(defs: unknown): Map<string, unknown> {
  const index = new Map<string, unknown>();
  if (!Array.isArray(defs)) return index;
  let length = 0;
  try {
    length = defs.length;
  } catch {
    return index;
  }
  const scan = length > MAX_TOOL_DEFS ? MAX_TOOL_DEFS : length;
  for (let i = 0; i < scan; i++) {
    let def: unknown;
    try {
      def = defs[i];
    } catch {
      continue;
    }
    const obj = asObject(def);
    if (!obj) continue;
    const rawName = readField(obj, 'name');
    if (typeof rawName !== 'string') continue;
    if (rawName.length === 0 || rawName.length > MAX_TOOL_NAME_CHARS) continue;
    // Last-wins: a later dup overwrites an earlier one (Map.set semantics).
    index.set(rawName, def);
  }
  return index;
}

/**
 * R4 — the STABLE, order-insensitive cache key for one
 * `listOpenSwanAnthropicToolsForSurface(surface, allowlist, mode)` result.
 *
 * Guarantees:
 *   - Identical effective inputs → identical key, INCLUDING any allowlist
 *     ordering / duplication (the allowlist is deduped + sorted before hashing).
 *   - `surface` change or `mode` change → different key (mode mirrors the
 *     runtime's `(typeof mode === 'string' && mode) ? mode : null`, so null /
 *     undefined / '' collapse to one "no-mode" key while real modes stay
 *     distinct).
 *   - "No filter" (absent / empty allowlist → full catalog) is NEVER confused
 *     with a non-empty allowlist that happens to yield an empty catalog (e.g.
 *     `[123]`): the `hasFilter` flag is derived from array length, not entry
 *     usability.
 *   - SECRET-SAFE + BOUNDED: allowlist hashed to fixed-size hex; surface/mode
 *     clamped + separator-stripped. Total → returns a stable key for any input.
 */
export function toolCatalogMemoKey(input: unknown): string {
  const obj = asObject(input);
  const surface = coerceKeyField(readField(obj, 'surface'), MAX_SURFACE_CHARS);
  const mode = coerceModeField(readField(obj, 'mode'));
  const { hasFilter, tokens } = canonicalizeAllowlist(readField(obj, 'allowlist'));
  const filterFlag = hasFilter ? '1' : '0';
  const count = tokens.length;
  const allowHash = hashTokens(tokens);
  return [
    TOOL_CATALOG_MEMO_KEY_VERSION,
    surface,
    mode,
    filterFlag,
    String(count),
    allowHash,
  ].join(FIELD_SEP);
}

/**
 * Coerce a memo key to a usable non-empty string, or null when it can't be
 * trusted as a cache identity. Clamped so a hostile giant "key" can't blow up the
 * comparison.
 */
function coerceMemoKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (value.length === 0) return null;
  // Real keys from `toolCatalogMemoKey` are short; clamp a hostile giant to a
  // bounded prefix before comparing (comparison stays deterministic).
  return value.length > 8192 ? value.slice(0, 8192) : value;
}

/**
 * True iff the cached catalog for `prevKey` must be REBUILT for `nextKey`.
 *
 * Bias = REBUILD on any doubt. Serving a stale catalog (wrong surface / mode /
 * allowlist in the prompt) is a correctness bug; an unnecessary rebuild is only a
 * perf miss. So a missing/invalid `nextKey`, a missing/invalid `prevKey` (no
 * prior build), or any drift between the two → `true` (rebuild). Only two
 * identical, valid keys → `false` (reuse the cached catalog). Total.
 */
export function shouldRebuildCatalog(prevKey: unknown, nextKey: unknown): boolean {
  const next = coerceMemoKey(nextKey);
  if (next === null) return true;
  const prev = coerceMemoKey(prevKey);
  if (prev === null) return true;
  return prev !== next;
}
