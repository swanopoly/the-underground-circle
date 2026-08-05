// messageMetadataCore — the PURE serialize/hydrate brain for moving persisted
// bot-message metadata OFF the message `content` text blob and INTO a dedicated
// `messages.metadata` jsonb column (the pattern `room_messages` already uses).
//
// Today `persistedChatMetadata.formatPersistedChatBotMessage` packs the whole
// PersistedChatBotMetadata object into the content string after a `[[UC_CHAT_META]]`
// marker, under a ~9,000-CHAR cap that must also hold the visible answer. Because
// everything competes for that one text budget, it runs a ~1,000-line LOSSY
// full → compact → minimal → tiny → findings-only tier cascade that silently
// DROPS structured fields to make the row fit. Once metadata lives in its own
// jsonb column there is no tier cascade to maintain: we only need to keep the
// stored object BOUNDED (so a hostile/huge tool result can't bloat a row or spin
// JSON.stringify) and SECRET-SAFE — never lossy-by-design.
//
// `serializeMessageMetadata()` deep-clones the metadata object under four
// INDEPENDENT ceilings — recursion depth, per-string length, array/object width,
// and TOTAL serialized size (~16 KB) — is cyclic-safe (an ancestor cycle becomes
// '[cyclic]', never an infinite loop or a stringify throw), and secret-masks every
// kept string. It ALWAYS returns a plain object (never an array / preview blob), so
// it can be handed straight to a jsonb column. When the whole thing is still over
// budget it DROPS the largest whole top-level fields (recording their names) rather
// than collapsing to a lossy tier — structure is preserved, size is guaranteed.
//
// `hydrateMessageMetadata()` reads the jsonb back into the typed shape, tolerant of
// missing rows and legacy snake_case aliases (`memories_used`, `execution_stream`,
// …) that older text-blob rows carried, mirroring `messageMetadataReaders.ts`.
//
// PURITY: zero imports, tsx-loadable (smoke: message-metadata-core). The secret
// masker is intentionally inlined (a compact, conservative subset of
// secretRedactionCore's shapes, identical to eventBoundCore's) so this module stays
// dependency-free. DETERMINISTIC: no Date.now()/Math.random(). Every export is
// TOTAL — null / undefined / wrong-type / huge / hostile / cyclic input yields a
// bounded, JSON-safe value and NEVER throws.

/**
 * The typed view of a persisted `messages.metadata` jsonb row. Every field is
 * `unknown` on purpose: the row is untrusted after a round-trip, and the concrete
 * shapes (SwanBotStructuredResponse['usage'], OpenSwanExecutionContract[], …) live
 * in dependency-heavy modules this pure core must not import. Callers narrow at the
 * point of use. `serializeMessageMetadata` may persist MORE keys than these — this
 * interface names the primary fields `hydrateMessageMetadata` surfaces typed.
 */
export interface PersistedMessageMetadata {
  source?: unknown;
  routing?: unknown;
  usage?: unknown;
  memoriesUsed?: unknown;
  executionStream?: unknown;
  toolEvents?: unknown;
  quickReplies?: unknown;
}

/** Hard ceiling on the serialized size of a stored metadata object (~16 KB). */
export const MESSAGE_METADATA_MAX_BYTES = 16_000;
/** Default recursion-depth ceiling; a node deeper than this becomes a marker. */
export const MESSAGE_METADATA_MAX_DEPTH = 8;

// --- Internal structural caps (tuning knobs, not part of the contract) --------
const MAX_STRING_CHARS = 4_000;
const MAX_ARRAY_ITEMS = 200;
const MAX_OBJECT_KEYS = 200;
const KEY_MAX_CHARS = 200;
// When the whole object overshoots the byte ceiling we drop whole top-level
// fields; the dropped names are recorded here, bounded so the marker itself can
// never re-overflow a small budget.
const OMIT_LIST_MAX = 40;
const OMIT_NAME_MAX = 48;
const OMITTED_FIELDS_KEY = '__metadataOmittedFields';
const CLIPPED_KEY = '__metadataClipped';

const MASK = '[REDACTED]';
const CYCLIC = '[cyclic]';
const DEPTH_MARK = '[max-depth]';
const TRUNC_MARK = '[truncated]';

interface BoundCfg {
  maxDepth: number;
  maxStringChars: number;
  maxArrayItems: number;
  maxObjectKeys: number;
}

interface Budget {
  remaining: number;
}

// -----------------------------------------------------------------------------
// Secret masking (inlined, conservative). Mirrors the high-signal shapes from
// secretRedactionCore/eventBoundCore but carries no dependency so tsx purity is
// guaranteed. Each pattern runs inside its own try/catch: one pathological match
// can never crash the serializer — a failing detector is skipped, the rest mask.
// -----------------------------------------------------------------------------
function maskSecrets(input: string): string {
  let s = input;
  // Credentials embedded in a URL — keep scheme+user+host, mask only the pass.
  try {
    s = s.replace(/(:\/\/[^\s:@/]+:)[^\s:@/]+(@)/g, (_m, prefix: string, at: string) => `${prefix}${MASK}${at}`);
  } catch {
    /* skip */
  }
  // Flat shapes (most-specific first) — the whole token becomes the mask.
  const flat: RegExp[] = [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
    /sk-ant-[A-Za-z0-9\-_]{20,}/g,
    /sk-[A-Za-z0-9]{20,}/g,
    /github_pat_[A-Za-z0-9_]{50,}/g,
    /ghp_[A-Za-z0-9]{36,}/g,
    /AKIA[0-9A-Z]{16}/g,
    /xox[baprs]-[A-Za-z0-9-]{10,}/g,
    /Bearer\s+[A-Za-z0-9._\-]{16,}/g,
    /api[_-]?key["'\s:=]+[A-Za-z0-9\-_]{16,}/gi,
    /(?:aws.{0,20})?secret[_-]?(?:access[_-]?)?key["'\s:=]+[A-Za-z0-9/+]{40}/gi,
  ];
  for (const re of flat) {
    try {
      s = s.replace(re, MASK);
    } catch {
      /* skip a pathological pattern, keep masking the rest */
    }
  }
  return s;
}

// -----------------------------------------------------------------------------
// Small total helpers.
// -----------------------------------------------------------------------------
function clampInt(value: unknown, lo: number, hi: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const n = Math.floor(value);
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

function safeStringify(value: unknown): string {
  try {
    const s = JSON.stringify(value);
    return typeof s === 'string' ? s : '';
  } catch {
    // Our clones never contain a cycle or BigInt, so this should not fire — but
    // a hostile toJSON()/getter could still throw, and the serializer must not.
    return '';
  }
}

function safeToString(value: unknown): string {
  try {
    return String(value);
  } catch {
    return '';
  }
}

function safeOwnKeys(value: object): string[] {
  try {
    return Object.keys(value);
  } catch {
    return [];
  }
}

/** Clip a string to `maxStringChars`, mask secrets, then honor the budget. */
function boundString(value: string, maxStringChars: number, budget: Budget): string {
  // Clip the HEAD first so we never run the secret regexes over a multi-MB
  // hostile string; only then mask secrets within the bounded head.
  const overLong = value.length > maxStringChars;
  let out = maskSecrets(overLong ? value.slice(0, maxStringChars) : value);
  if (overLong) out += `…[+${value.length - maxStringChars} chars]`;
  // Per-string budget clip (already secret-masked, so slicing cannot leak).
  if (out.length + 2 > budget.remaining) {
    out = out.slice(0, Math.max(0, budget.remaining - 2));
    budget.remaining = 0;
  } else {
    budget.remaining -= out.length + 2;
  }
  return out;
}

function boundKey(key: string): string {
  const clipped = key.length > KEY_MAX_CHARS ? `${key.slice(0, KEY_MAX_CHARS)}…` : key;
  return maskSecrets(clipped);
}

/** Assign a key without ever tripping the `__proto__` setter (pollution-safe). */
function assignKey(target: Record<string, unknown>, key: string, val: unknown): void {
  try {
    if (key === '__proto__') {
      Object.defineProperty(target, '__proto__', {
        value: val,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    } else {
      target[key] = val;
    }
  } catch {
    /* skip a key we cannot assign */
  }
}

// -----------------------------------------------------------------------------
// Recursive bounder. `undefined` is the internal "drop this" sentinel (functions,
// symbols, and undefined all bound to it); callers map it to null / skip a key,
// matching JSON.stringify semantics.
// -----------------------------------------------------------------------------
function boundValue(
  value: unknown,
  depth: number,
  ancestors: WeakSet<object>,
  budget: Budget,
  cfg: BoundCfg,
): unknown {
  if (budget.remaining <= 0) return TRUNC_MARK;

  if (value === null) {
    budget.remaining -= 4;
    return null;
  }

  const t = typeof value;
  if (t === 'string') return boundString(value as string, cfg.maxStringChars, budget);
  if (t === 'number') {
    const n = value as number;
    if (!Number.isFinite(n)) {
      // NaN / ±Infinity are not valid JSON; JSON.stringify already emits null.
      budget.remaining -= 4;
      return null;
    }
    budget.remaining -= String(n).length;
    return n;
  }
  if (t === 'boolean') {
    budget.remaining -= 5;
    return value;
  }
  if (t === 'bigint') {
    // BigInt is unserializable by JSON.stringify — preserve it as a string.
    const str = safeToString(value);
    budget.remaining -= str.length + 2;
    return str;
  }
  if (t !== 'object') return undefined; // function / symbol / undefined → drop

  const obj = value as object;
  if (ancestors.has(obj)) {
    budget.remaining -= CYCLIC.length;
    return CYCLIC;
  }
  if (depth >= cfg.maxDepth) {
    budget.remaining -= DEPTH_MARK.length;
    return DEPTH_MARK;
  }

  // Leaf-ish objects that must not recurse (no cycle risk → outside ancestors).
  if (obj instanceof Date) {
    let iso = '[invalid-date]';
    try {
      iso = Number.isNaN(obj.getTime()) ? '[invalid-date]' : obj.toISOString();
    } catch {
      iso = '[invalid-date]';
    }
    budget.remaining -= iso.length + 2;
    return iso;
  }
  if (obj instanceof RegExp) {
    return boundString(safeToString(obj), cfg.maxStringChars, budget);
  }

  ancestors.add(obj);
  try {
    if (Array.isArray(obj)) return boundArray(obj, depth, ancestors, budget, cfg);
    if (obj instanceof Map) return boundMapLike(obj, depth, ancestors, budget, cfg);
    if (obj instanceof Set) return boundSetLike(obj, depth, ancestors, budget, cfg);
    if (obj instanceof Error) return boundError(obj, depth, ancestors, budget, cfg);
    return boundObject(obj as Record<string, unknown>, depth, ancestors, budget, cfg);
  } finally {
    // Ancestor-path semantics: remove on exit so a shared (non-cyclic) sibling
    // reference is NOT mis-flagged as a cycle.
    ancestors.delete(obj);
  }
}

function boundArray(
  arr: unknown[],
  depth: number,
  ancestors: WeakSet<object>,
  budget: Budget,
  cfg: BoundCfg,
): unknown[] {
  const out: unknown[] = [];
  const cap = Math.min(arr.length, cfg.maxArrayItems);
  for (let i = 0; i < cap; i++) {
    if (budget.remaining <= 0) break;
    budget.remaining -= 1; // comma
    const child = boundValue(arr[i], depth + 1, ancestors, budget, cfg);
    out.push(child === undefined ? null : child);
  }
  const omitted = arr.length - out.length;
  if (omitted > 0) out.push(`[+${omitted} more]`);
  budget.remaining -= 2; // brackets
  return out;
}

function boundObject(
  src: Record<string, unknown>,
  depth: number,
  ancestors: WeakSet<object>,
  budget: Budget,
  cfg: BoundCfg,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const keys = safeOwnKeys(src);
  const cap = Math.min(keys.length, cfg.maxObjectKeys);
  let processed = 0;
  for (let i = 0; i < cap; i++) {
    if (budget.remaining <= 0) break;
    const rawKey = keys[i];
    const safeKey = boundKey(rawKey);
    budget.remaining -= safeKey.length + 3;
    processed = i + 1;
    let childVal: unknown;
    try {
      childVal = src[rawKey];
    } catch {
      // A getter that throws — drop the key, keep going.
      continue;
    }
    const child = boundValue(childVal, depth + 1, ancestors, budget, cfg);
    if (child === undefined) continue; // drop undefined/function/symbol-valued keys
    assignKey(out, safeKey, child);
  }
  const omitted = keys.length - processed;
  if (omitted > 0) out.__omittedKeys = omitted;
  budget.remaining -= 2;
  return out;
}

function boundMapLike(
  map: Map<unknown, unknown>,
  depth: number,
  ancestors: WeakSet<object>,
  budget: Budget,
  cfg: BoundCfg,
): Record<string, unknown> {
  const entries: unknown[] = [];
  let size = 0;
  try {
    size = map.size;
  } catch {
    size = 0;
  }
  let count = 0;
  try {
    for (const pair of map) {
      if (count >= cfg.maxArrayItems || budget.remaining <= 0) break;
      const k = boundValue(pair[0], depth + 1, ancestors, budget, cfg);
      const v = boundValue(pair[1], depth + 1, ancestors, budget, cfg);
      entries.push([k === undefined ? null : k, v === undefined ? null : v]);
      count += 1;
    }
  } catch {
    /* stop iterating on any hostile iterator */
  }
  const out: Record<string, unknown> = { __type: 'Map', size, entries };
  if (size > count) out.__omittedEntries = size - count;
  budget.remaining -= 2;
  return out;
}

function boundSetLike(
  set: Set<unknown>,
  depth: number,
  ancestors: WeakSet<object>,
  budget: Budget,
  cfg: BoundCfg,
): Record<string, unknown> {
  const values: unknown[] = [];
  let size = 0;
  try {
    size = set.size;
  } catch {
    size = 0;
  }
  let count = 0;
  try {
    for (const item of set) {
      if (count >= cfg.maxArrayItems || budget.remaining <= 0) break;
      const v = boundValue(item, depth + 1, ancestors, budget, cfg);
      values.push(v === undefined ? null : v);
      count += 1;
    }
  } catch {
    /* stop iterating on any hostile iterator */
  }
  const out: Record<string, unknown> = { __type: 'Set', size, values };
  if (size > count) out.__omittedValues = size - count;
  budget.remaining -= 2;
  return out;
}

function boundError(
  err: Error,
  depth: number,
  ancestors: WeakSet<object>,
  budget: Budget,
  cfg: BoundCfg,
): Record<string, unknown> {
  const out: Record<string, unknown> = { __type: 'Error' };
  try {
    if (typeof err.name === 'string') out.name = boundString(err.name, cfg.maxStringChars, budget);
  } catch {
    /* skip */
  }
  try {
    if (typeof err.message === 'string') out.message = boundString(err.message, cfg.maxStringChars, budget);
  } catch {
    /* skip */
  }
  // Own enumerable extras, but NOT `stack` — it leaks absolute file paths and is
  // mostly noise for persisted metadata.
  const bag = err as unknown as Record<string, unknown>;
  for (const key of safeOwnKeys(bag)) {
    if (budget.remaining <= 0) break;
    if (key === 'name' || key === 'message' || key === 'stack') continue;
    const safeKey = boundKey(key);
    budget.remaining -= safeKey.length + 3;
    let childVal: unknown;
    try {
      childVal = bag[key];
    } catch {
      continue;
    }
    const child = boundValue(childVal, depth + 1, ancestors, budget, cfg);
    if (child === undefined) continue;
    assignKey(out, safeKey, child);
  }
  budget.remaining -= 2;
  return out;
}

// -----------------------------------------------------------------------------
// Total-size guard. The per-node budget is approximate (it does not model JSON
// escaping), so after cloning we verify the real serialized size and, if still
// over, DROP whole top-level fields largest-first (recording their names) until it
// fits. Unlike the old text-blob tiers this never rewrites field CONTENTS — a
// field is either kept whole (already bounded) or dropped whole, so the survivors
// hydrate exactly as stored.
// -----------------------------------------------------------------------------
function buildCandidate(fields: Record<string, unknown>, omitted: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(fields)) assignKey(out, k, fields[k]);
  if (omitted.length > 0) out[OMITTED_FIELDS_KEY] = omitted.slice(0, OMIT_LIST_MAX);
  return out;
}

function enforceTotalBytes(clone: Record<string, unknown>, maxBytes: number): Record<string, unknown> {
  if (safeStringify(clone).length <= maxBytes) return clone;

  // Work on a shallow copy we can shrink. The clone is already a JSON-safe,
  // secret-masked, per-node-bounded object, so dropping keys can never leak.
  const working: Record<string, unknown> = {};
  for (const k of Object.keys(clone)) working[k] = clone[k];
  const omitted: string[] = [];

  for (let guard = 0; guard < MAX_OBJECT_KEYS + 4; guard++) {
    const candidate = buildCandidate(working, omitted);
    if (safeStringify(candidate).length <= maxBytes) return candidate;
    const keys = Object.keys(working);
    if (keys.length === 0) break;
    // Drop the single largest field (by its own serialized footprint).
    let largestKey = keys[0];
    let largestSize = -1;
    for (const k of keys) {
      const sz = safeStringify(working[k]).length + k.length;
      if (sz > largestSize) {
        largestSize = sz;
        largestKey = k;
      }
    }
    delete working[largestKey];
    if (omitted.length < OMIT_LIST_MAX) omitted.push(largestKey.slice(0, OMIT_NAME_MAX));
  }

  // Terminal fallback: even the marker-only object didn't fit (pathologically
  // tiny budget). Return a provably tiny sentinel — always well under any budget.
  return { [CLIPPED_KEY]: true };
}

// -----------------------------------------------------------------------------
// Public API.
// -----------------------------------------------------------------------------

/**
 * Serialize arbitrary bot-message metadata into a bounded, structured object for a
 * `messages.metadata` jsonb column. Deep-clones under depth / string / width /
 * total-size ceilings, is cyclic-safe ('[cyclic]'), and secret-masks every kept
 * string. ALWAYS returns a plain object (never an array / primitive / preview blob)
 * so the result drops straight into jsonb; a non-object input yields `{}`. NEVER
 * throws. This is the non-lossy replacement for the full/minimal/tiny text-blob
 * compaction tiers: it BOUNDS, it does not collapse.
 */
export function serializeMessageMetadata(
  meta: unknown,
  opts?: { maxBytes?: number },
): Record<string, unknown> {
  try {
    // Only a plain-ish record is valid metadata. Arrays, primitives, null, and
    // exotic wrappers (Date/Map/Set/Error/RegExp) are NOT a metadata object → {}.
    if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) return {};
    if (
      meta instanceof Date ||
      meta instanceof RegExp ||
      meta instanceof Map ||
      meta instanceof Set ||
      meta instanceof Error
    ) {
      return {};
    }

    const maxBytes = clampInt(opts?.maxBytes, 1_000, 64_000, MESSAGE_METADATA_MAX_BYTES);
    const cfg: BoundCfg = {
      maxDepth: MESSAGE_METADATA_MAX_DEPTH,
      maxStringChars: MAX_STRING_CHARS,
      maxArrayItems: MAX_ARRAY_ITEMS,
      maxObjectKeys: MAX_OBJECT_KEYS,
    };
    const budget: Budget = { remaining: maxBytes };
    // Seed the root into the ancestor set so a child that points back at the
    // top-level object is caught as '[cyclic]' immediately (uniform with nested
    // cycles) — boundObject is called directly here, bypassing boundValue's add.
    const ancestors = new WeakSet<object>();
    ancestors.add(meta as object);
    const cloned = boundObject(meta as Record<string, unknown>, 0, ancestors, budget, cfg);
    return enforceTotalBytes(cloned, maxBytes);
  } catch {
    // Absolute backstop — persisting metadata must never break a message write.
    return {};
  }
}

/**
 * Read a persisted `messages.metadata` jsonb value back into the typed shape.
 * Tolerant of a missing/null row (→ all fields undefined) and of legacy
 * snake_case aliases (`memories_used`, `execution_stream`, …) that older
 * text-blob rows carried. Only sets a field when it is present and defined, so
 * callers can distinguish "absent" from "explicitly null". NEVER throws.
 */
export function hydrateMessageMetadata(raw: unknown): PersistedMessageMetadata {
  const out: PersistedMessageMetadata = {};
  try {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return out;
    const obj = raw as Record<string, unknown>;

    const read = (...aliases: string[]): unknown => {
      for (const key of aliases) {
        try {
          if (Object.prototype.hasOwnProperty.call(obj, key)) {
            const value = obj[key];
            if (value !== undefined) return value;
          }
        } catch {
          /* skip a hostile getter, try the next alias */
        }
      }
      return undefined;
    };

    const source = read('source');
    if (source !== undefined) out.source = source;
    const routing = read('routing');
    if (routing !== undefined) out.routing = routing;
    const usage = read('usage');
    if (usage !== undefined) out.usage = usage;
    const memoriesUsed = read('memoriesUsed', 'memories_used');
    if (memoriesUsed !== undefined) out.memoriesUsed = memoriesUsed;
    const executionStream = read('executionStream', 'execution_stream');
    if (executionStream !== undefined) out.executionStream = executionStream;
    const toolEvents = read('toolEvents', 'tool_events');
    if (toolEvents !== undefined) out.toolEvents = toolEvents;
    const quickReplies = read('quickReplies', 'quick_replies');
    if (quickReplies !== undefined) out.quickReplies = quickReplies;

    return out;
  } catch {
    return out;
  }
}
