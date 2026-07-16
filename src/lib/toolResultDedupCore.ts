/**
 * toolResultDedupCore — the PURE token-saving dedup decision for the tool loop.
 *
 * Failure mode this optimizes: a tool loop re-runs the SAME tool with the SAME
 * args (a re-observe, a "list the files again", a poll that hasn't changed) and
 * gets back a BYTE-IDENTICAL result. `agentExecutionCore` stringifies that
 * `{ok,data}` envelope into the model context every time — so an identical 8KB
 * payload can enter the window three or four times, burning tokens on bytes the
 * model has already seen verbatim. This core lets the loop notice "this exact
 * (tool, args, output) already appeared" and emit a compact reference
 * ("same as result #N") instead of re-including the full payload.
 *
 * Complement to `toolResultSummaryCore` (NOT a duplicate): the summary core
 * clamps ONE oversized result (head + tail + signal lines) the moment it is
 * produced — it makes a big result smaller. This core drops a REPEAT result
 * entirely in favor of a back-reference — it makes an identical result free.
 * Both run on the already-summarized string, at the same append seam, and are
 * orthogonal (a result can be summarized AND, next round, deduped).
 *
 * The dedup identity is `(toolName, argsKey, contentHash)`:
 *   - `argsKey` folds the tool NAME + its ARGS into one bounded digest — the
 *     identity of the CALL. Different tool OR different args → different key.
 *   - `contentHash` is a FULL-content digest — sensitive to ANY change in the
 *     emitted output (length prefix + FNV over the whole string), so "same
 *     call, output changed" is correctly NOT a duplicate. A back-reference is
 *     only safe when the bytes are truly identical, and contentHash guarantees
 *     that. Matching all three fields means we only collapse a result that is
 *     identical in tool, args, AND output — never a coincidental collision.
 *
 * Secret-safe: argsKey and contentHash are one-way FNV-1a digests (never the
 * raw args/content), and the emitted reason / reference text carries only the
 * (bounded) tool name and a numeric index — never the payload. So even when a
 * tool result contains a token or credential, nothing reversible is surfaced.
 *
 * PURITY (load-bearing): zero runtime imports, deterministic (no Date.now /
 * Math.random), bounded output, every export TOTAL — null / undefined /
 * wrong-type / huge / hostile / cyclic input returns a safe neutral value and
 * NEVER throws. This lets it load under tsx/esbuild (no react-native/supabase)
 * and run in Deno edge functions under strict module resolution.
 */

/** Max chars of the canonical (tool+args) JSON folded into `argsKey`. Args are
 *  small (tool inputs); this cap only guards a pathological giant arg blob. The
 *  full pre-cap length is folded into the digest prefix, so two inputs of
 *  differing length never collide even past the cap. */
export const TOOL_RESULT_ARGS_HASH_MAX_CHARS = 8_192;

/** Max chars of content actually run through the content digest. Real tool
 *  results reach this core already clamped by `toolResultSummaryCore` (~20KB),
 *  so 1 MiB is deep headroom that still bounds work against a hostile unbounded
 *  string. The full pre-cap length is folded into the digest prefix. */
export const TOOL_RESULT_CONTENT_HASH_MAX_CHARS = 1_048_576;

/** Upper bound on prior refs scanned per decision — bounds work against a
 *  hostile giant `priorResults` array. A real run holds far fewer distinct
 *  results than this (each distinct output is stored at most once). */
export const DEDUP_MAX_PRIOR_SCAN = 4_096;

/** Max chars of a tool name folded into a key / compared. Tool names are
 *  registry identifiers far below this; the cap only defends against a
 *  model-emitted giant `tool_use.name`. */
export const DEDUP_TOOL_NAME_MAX_CHARS = 200;

/** Max chars of a tool name echoed into a reason / reference string (which flow
 *  into loop events, persisted rows, and model-visible context). */
const DEDUP_REASON_NAME_MAX_CHARS = 60;

/**
 * A stored reference to a tool result the model has already seen in full. The
 * loop keeps a running list of these (one per DISTINCT result) and consults it
 * before appending the next result. `firstIndex` is the model-visible ordinal
 * where this exact output FIRST appeared, so a later duplicate can be rendered
 * as "same as result #firstIndex".
 */
export interface ToolResultRef {
  /** Tool name (bounded, normalized) — kept for readable reasons + defensive matching. */
  toolName: string;
  /** One-way digest of (tool + args): the CALL identity. */
  argsKey: string;
  /** One-way digest of the full emitted content: the OUTPUT identity. */
  contentHash: string;
  /** Model-visible ordinal where this output first appeared (integer >= 0). */
  firstIndex: number;
}

/** Verdict from {@link planToolResultDedup}. `referToIndex` is the earlier
 *  result's `firstIndex` when `duplicate` is true, else null. `reason` is a
 *  short, bounded, secret-safe explanation. */
export interface ToolResultDedupPlan {
  duplicate: boolean;
  referToIndex: number | null;
  reason: string;
}

// ─── Internals (not exported) ────────────────────────────────────────────────

/** String() that never throws (throwing toString/valueOf, Symbol, etc.).
 *  null/undefined collapse to ''. */
function safeString(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return String(value);
  } catch {
    return '';
  }
}

/** Bounded, normalized tool name. Idempotent (slice-to-N of a <=N string is
 *  itself), so folding it into a key on both sides always agrees. */
function normalizeToolName(value: unknown): string {
  const s = safeString(value);
  return s.length > DEDUP_TOOL_NAME_MAX_CHARS ? s.slice(0, DEDUP_TOOL_NAME_MAX_CHARS) : s;
}

/** Tool name clamped for echoing into a human-readable reason / reference. */
function clampReasonName(name: string): string {
  return name.length > DEDUP_REASON_NAME_MAX_CHARS
    ? `${name.slice(0, DEDUP_REASON_NAME_MAX_CHARS)}…`
    : name;
}

/** Coerce an index to a safe integer >= 0, else null (invalid — unusable as a
 *  reference target). */
function coerceIndex(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const n = Math.floor(value);
  return n >= 0 ? n : null;
}

/**
 * Deterministic canonical JSON: object keys sorted (so `{a,b}` and `{b,a}`
 * serialize identically), cycles replaced with a marker (WeakSet — a repeated
 * reference in a diamond reads as `[cyclic]`, which is deterministic and never
 * throws), BigInt/Symbol/function coerced instead of throwing. Any residual
 * failure (deep-nesting stack overflow, throwing getter) falls back to a
 * bounded String() form. Never throws.
 */
function canonicalJson(value: unknown): string {
  try {
    const seen = new WeakSet<object>();
    const out = JSON.stringify(value === undefined ? null : value, (_key, v) => {
      if (typeof v === 'bigint') return `${v.toString()}n`;
      if (typeof v === 'function') return undefined;
      if (typeof v === 'symbol') {
        try { return v.toString(); } catch { return 'symbol'; }
      }
      if (v && typeof v === 'object') {
        if (seen.has(v as object)) return '[cyclic]';
        seen.add(v as object);
        if (!Array.isArray(v)) {
          const rec = v as Record<string, unknown>;
          const sorted: Record<string, unknown> = {};
          for (const k of Object.keys(rec).sort()) sorted[k] = rec[k];
          return sorted;
        }
      }
      return v;
    });
    return typeof out === 'string' ? out : 'null';
  } catch {
    try {
      const s = String(value);
      return s.length > 64 ? s.slice(0, 64) : s;
    } catch {
      return '';
    }
  }
}

/** FNV-1a 32-bit over a string → 8-hex digest. Matches the house hash
 *  (toolLoopStuckCore) so hashing behavior is consistent across the codebase. */
function fnv1a32(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Length-prefixed bounded digest of an already-canonical string. The FULL
 * pre-cap length is folded into the prefix, so two inputs of differing length
 * NEVER collide (different prefix) even if both exceed the cap; inputs within
 * the cap are hashed in full, so any change is reflected. Fixed short output.
 */
function boundedDigest(canonical: string, maxChars: number): string {
  const fullLen = canonical.length;
  const bounded = fullLen > maxChars ? canonical.slice(0, maxChars) : canonical;
  return `${fullLen.toString(16)}:${fnv1a32(bounded)}`;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Compute the two-part dedup key for a tool result. `argsKey` folds the tool
 * NAME and its ARGS into one bounded, one-way digest (the call identity);
 * `contentHash` is a full-content, length-prefixed digest of the emitted
 * output (the output identity). Deterministic (object-key order does not
 * matter), bounded, secret-safe (digests, never raw payloads), and TOTAL —
 * any input shape (null/undefined/cyclic/BigInt/huge) yields two strings and
 * never throws.
 */
export function computeToolResultKey(input: {
  toolName: unknown;
  args: unknown;
  content: unknown;
}): { argsKey: string; contentHash: string } {
  const src = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const toolName = normalizeToolName(src.toolName);
  // Call identity = tool + args, canonicalized (sorted keys) so arg-key order
  // never changes the digest.
  const argsKey = boundedDigest(
    canonicalJson({ tool: toolName, args: src.args }),
    TOOL_RESULT_ARGS_HASH_MAX_CHARS,
  );
  // Output identity: hash the string content directly (the common case — the
  // loop passes the already-stringified, already-summarized envelope); coerce
  // non-strings through the canonicalizer so this stays total.
  const contentCanonical =
    typeof src.content === 'string' ? src.content : canonicalJson(src.content);
  const contentHash = boundedDigest(contentCanonical, TOOL_RESULT_CONTENT_HASH_MAX_CHARS);
  return { argsKey, contentHash };
}

/**
 * Build a {@link ToolResultRef} for a NEW (non-duplicate) result the loop is
 * about to append in full. Convenience over {@link computeToolResultKey}:
 * computes the key and stamps the model-visible ordinal (`index`). Total — an
 * invalid/missing index defaults to 0.
 */
export function buildToolResultRef(input: {
  toolName: unknown;
  args: unknown;
  content: unknown;
  index: unknown;
}): ToolResultRef {
  const src = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const toolName = normalizeToolName(src.toolName);
  const { argsKey, contentHash } = computeToolResultKey({
    toolName,
    args: src.args,
    content: src.content,
  });
  return { toolName, argsKey, contentHash, firstIndex: coerceIndex(src.index) ?? 0 };
}

/** Normalize a stored ref, or null when it can't serve as a reference target
 *  (missing digests, or an invalid firstIndex). */
function normalizeRef(entry: unknown): ToolResultRef | null {
  if (!entry || typeof entry !== 'object') return null;
  const rec = entry as Record<string, unknown>;
  const argsKey = typeof rec.argsKey === 'string' ? rec.argsKey : null;
  const contentHash = typeof rec.contentHash === 'string' ? rec.contentHash : null;
  if (!argsKey || !contentHash) return null;
  const firstIndex = coerceIndex(rec.firstIndex);
  if (firstIndex === null) return null;
  return { toolName: normalizeToolName(rec.toolName), argsKey, contentHash, firstIndex };
}

/** Resolve the candidate's (toolName, argsKey, contentHash). Accepts EITHER a
 *  pre-computed ref-like `{toolName, argsKey, contentHash}` (fast path — the
 *  loop already hashed it) OR a raw `{toolName, args, content}` (hashed here).
 *  Total. */
function resolveCandidateKey(next: unknown): {
  toolName: string;
  argsKey: string;
  contentHash: string;
} {
  const rec = next && typeof next === 'object' ? (next as Record<string, unknown>) : {};
  const toolName = normalizeToolName(rec.toolName);
  const preArgsKey = typeof rec.argsKey === 'string' ? rec.argsKey : null;
  const preContentHash = typeof rec.contentHash === 'string' ? rec.contentHash : null;
  if (preArgsKey && preContentHash) {
    return { toolName, argsKey: preArgsKey, contentHash: preContentHash };
  }
  const { argsKey, contentHash } = computeToolResultKey({
    toolName,
    args: rec.args,
    content: rec.content,
  });
  return { toolName, argsKey, contentHash };
}

/**
 * Decide whether `next` is a byte-identical repeat of a result already seen in
 * `priorResults` (a `ToolResultRef[]`). When an earlier ref matches on tool,
 * args, AND content, returns `{ duplicate: true, referToIndex: <its firstIndex> }`
 * so the loop can append a compact "same as result #N" reference instead of the
 * full payload. Otherwise `{ duplicate: false, referToIndex: null }` and the
 * caller appends the result in full (and records a fresh ref).
 *
 * `next` may be a raw `{toolName, args, content}` OR a pre-hashed
 * `{toolName, argsKey, contentHash}`. Conservative and TOTAL: junk priors are
 * skipped, any indeterminate input fails OPEN (treated as new — never a false
 * "duplicate" that would hide a real result), and it never throws.
 */
export function planToolResultDedup(priorResults: unknown, next: unknown): ToolResultDedupPlan {
  try {
    const cand = resolveCandidateKey(next);
    const priors = Array.isArray(priorResults) ? priorResults : [];
    const scanLimit = Math.min(priors.length, DEDUP_MAX_PRIOR_SCAN);
    for (let i = 0; i < scanLimit; i++) {
      const ref = normalizeRef(priors[i]);
      if (!ref) continue;
      if (
        ref.toolName === cand.toolName &&
        ref.argsKey === cand.argsKey &&
        ref.contentHash === cand.contentHash
      ) {
        const label = clampReasonName(ref.toolName);
        return {
          duplicate: true,
          referToIndex: ref.firstIndex,
          reason:
            `duplicate of result #${ref.firstIndex}${label ? ` (${label})` : ''}` +
            ' — identical tool, args, and output; emit a reference instead of the full payload',
        };
      }
    }
    return {
      duplicate: false,
      referToIndex: null,
      reason: 'new result — no identical (tool, args, output) seen; append in full',
    };
  } catch {
    // Fail OPEN: an indeterminate input reads as "new", so a result is never
    // silently dropped by a dedup that couldn't decide.
    return {
      duplicate: false,
      referToIndex: null,
      reason: 'dedup skipped — indeterminate input treated as new (fail open)',
    };
  }
}

/**
 * The compact, secret-safe text the loop appends to the model IN PLACE OF a
 * deduplicated result's full payload. Carries only the tool name (bounded) and
 * the numeric back-reference — never the payload. When `referToIndex` is an
 * invalid/absent index, it degrades to a generic "identical to an earlier
 * result" note. Total.
 */
export function formatDedupReferenceText(referToIndex: unknown, toolName?: unknown): string {
  const idx = coerceIndex(referToIndex);
  const label =
    toolName == null || toolName === '' ? '' : clampReasonName(normalizeToolName(toolName));
  const from = label ? ` from \`${label}\`` : '';
  if (idx === null) {
    return `[duplicate tool result${from} — identical to an earlier result; full payload omitted to save tokens]`;
  }
  return (
    `[duplicate tool result${from} — identical to result #${idx}; ` +
    `full payload omitted to save tokens. Reuse result #${idx}.]`
  );
}
