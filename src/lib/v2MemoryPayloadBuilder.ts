/**
 * v2MemoryPayloadBuilder — P2 of `docs/MEMORY_V2_INTEGRATION_PLAN.md`.
 *
 * P1 taught the `swanbot-v2-ai` edge to ACCEPT an optional `body.memory`
 * payload, fence it with `wrapUntrusted`, priority-clip it, and append it to
 * system **Block 2**. Nothing sends one. This module is the client half: it
 * turns the memory the chat lane already retrieves into the v2 wire payload.
 *
 * THE WIRE CONTRACT (owned by `v2MemoryInjectionCore.normalizeV2MemoryPayload`):
 *
 *     { sections: [ { key: <allowlisted>, text: <RAW, UNFENCED> }, ... ] }
 *
 * Four properties of that contract are load-bearing, and each is enforced here
 * rather than hoped for:
 *
 *   1. ALLOWLISTED KEYS ONLY. `V2_MEMORY_CLIENT_SECTION_KEYS` is DERIVED from
 *      the core's `V2_MEMORY_SECTION_KEYS` minus `SERVER_ONLY_SECTION_KEYS`, so
 *      it cannot drift. `memory_floor` is the server's own fallback key; a
 *      client that claims it is rejected as `unauthorized_key`, which would cost
 *      us the section AND raise an anomaly count on the edge. We never send it.
 *
 *   2. RAW TEXT, NEVER PRE-FENCED. `assembleV2MemoryBlock` calls the injected
 *      `fence` on every section itself. Sending pre-fenced text yields a
 *      `<untrusted_quoted>` inside a `<untrusted_quoted>` — the model reads a
 *      literal marker as content, and any future consumer that counts fences
 *      sees a shape it was never designed for. This is a REAL hazard at this
 *      seam, not a theoretical one: the two obvious sources to reach for are
 *      already fenced —
 *        `retrieveForTurn().formatted`  → `wrapUntrusted(body, …)` (memoryService:1259)
 *        `formatSoulWisdomBlock(entry)` → `wrapUntrusted(entry.body, …)` (memoryService:525)
 *      So this module rebuilds the retrieval body from the RAW `memories` rows
 *      (`formatTurnRetrievalText`), takes soul wisdom as `entry.body`, and — as
 *      defence in depth — STRIPS any surviving fence marker from every section
 *      and reports that it did. Stripping (rather than dropping) is deliberate:
 *      it is the exact transform the edge's `wrapUntrusted` would apply anyway,
 *      so it is lossless for content and total for the hazard.
 *      The four `OpenSwanMemoryStores` fields are already raw — `swanbot.ts`
 *      wraps them at the call site (`:4259-4262`), it does not receive them
 *      wrapped.
 *
 *   3. NO AUTHORITY FIELDS. A section is `{ key, text }` and nothing else. The
 *      core strips and REPORTS `scope` / `visibility` / `userId` / `trusted` /
 *      `cache_control` / … (`IGNORED_AUTHORITY_FIELDS`) precisely so a client
 *      version that still sends them is visible as an anomaly rate. We must not
 *      be that client. We also send no `priority`: the core clamps a hint into
 *      `[0, serverPriority]`, so a hint can only ever LOSE us budget.
 *
 *   4. OMIT, DON'T EMPTY. `buildV2MemoryPayload` returns `payload: null` when
 *      nothing survived. The caller must omit the `memory` field entirely — an
 *      empty `{sections: []}` is not falsy on the edge (`hasPayload` tests
 *      `!== undefined && !== null`), so it would suppress the server-side floor
 *      and leave the turn with LESS memory than sending nothing at all.
 *
 * BOUNDING, AND WHY THESE NUMBERS. The edge is the authority on the final clip
 * (the plan: "have the edge do the final clip with the same priority order"), so
 * the client budget is about WIRE BYTES, not tokens — anything over the edge's
 * `V2_MEMORY_BUDGET_CHARS` is clipped there and costs no input tokens. The wire
 * budget is therefore set generously enough that the edge always has real choice
 * between sections, and no higher. See the constants for the derivation.
 *
 * NEVER FAILS, NEVER STALLS A TURN. `buildV2MemoryPayloadForTurn` races every
 * loader against a deadline and degrades to `null` on ANY error. That is not
 * politeness, it is the correct trade: when the payload is absent the edge falls
 * back to its own bounded, privacy-filtered floor read, so "no payload" costs a
 * quality notch. A turn that failed — or that the user waited an extra two
 * seconds for — costs the whole turn.
 *
 * PURITY CONTRACT (repo convention):
 *   - Top level imports ONE runtime module, `./v2MemoryInjectionCore`, which is
 *     itself import-free. Everything heavy (`openswanMemoryStores`,
 *     `memoryService`) is reached through a DYNAMIC import inside the async
 *     loader, so this file loads under tsx and the pure layer is smoke-testable.
 *   - NO CLOCK, NO RANDOM in the pure layer: identical inputs give a
 *     byte-identical payload.
 *   - TOTAL: every pure export handles null / undefined / wrong type / NaN /
 *     cyclic / throwing-getter / megabyte input by returning a safe bounded
 *     value. Never throws.
 *   - SECRET-SAFE: diagnostics carry keys, counts and char totals — never text.
 */

import {
  SERVER_ONLY_SECTION_KEYS,
  V2_MEMORY_BUDGET_CHARS,
  V2_MEMORY_EMIT_ORDER,
  type V2MemorySectionKey,
} from './v2MemoryInjectionCore';
import type { OpenSwanMemoryStores } from './openswanMemoryStores';
import type { RetrievedMemory } from './memoryService';

// ─── Keys a CLIENT may send ─────────────────────────────────────────────────

/** Every allowlisted key except the server's own fallback key. */
export type V2MemoryClientSectionKey = Exclude<V2MemorySectionKey, 'memory_floor'>;

const SERVER_ONLY: ReadonlySet<string> = new Set<string>(SERVER_ONLY_SECTION_KEYS);

/**
 * The keys this module may emit, in EMIT (= priority-descending) order.
 *
 * DERIVED from the core's own two arrays rather than restated, so a key added to
 * (or promoted inside) `V2_MEMORY_EMIT_ORDER` reaches the client automatically
 * and a key that becomes server-only disappears from here automatically. The
 * smoke pins the derivation against `V2_MEMORY_SECTION_KEYS` so a core change
 * that breaks the relationship fails loudly instead of silently shipping a key
 * the edge will reject as `unauthorized_key`.
 */
export const V2_MEMORY_CLIENT_SECTION_KEYS: ReadonlyArray<V2MemoryClientSectionKey> =
  V2_MEMORY_EMIT_ORDER.filter((k): k is V2MemoryClientSectionKey => !SERVER_ONLY.has(k));

const CLIENT_KEY_SET: ReadonlySet<string> = new Set<string>(V2_MEMORY_CLIENT_SECTION_KEYS);

/** True when `key` is a key a client is allowed to put on the wire. */
export function isV2MemoryClientSectionKey(key: unknown): key is V2MemoryClientSectionKey {
  return typeof key === 'string' && CLIENT_KEY_SET.has(key);
}

// ─── Wire bounds ────────────────────────────────────────────────────────────

/**
 * Per-section clip applied before the wire budget is spent.
 *
 * Set ABOVE the edge's whole-block budget (`V2_MEMORY_BUDGET_CHARS`, 3 000) on
 * purpose: a per-section cap at or below the edge budget would let the CLIENT
 * pre-empt a decision that belongs to the edge's priority clip. At 4 000 it can
 * only ever bite a pathological section — in practice `memory_user_notes`, which
 * is user-authored free text from `user_memory` and is the one field here with
 * no upstream cap of its own (`turn_retrieval` is capped by `budgetChars`,
 * `memory_working` by `buildPromptMemoryBundle`'s 3 200, `memory_user_profile`
 * by its 8-row slice).
 */
export const V2_MEMORY_WIRE_SECTION_MAX_CHARS = 4000;

/**
 * Total section content put on the wire, spent in priority order.
 *
 * 2x the edge budget (3 000). The reasoning is a two-sided bound:
 *   - NOT LOWER, because the edge's job is to choose between sections by
 *     absolute priority. Sending exactly 3 000 chars would hand it a payload
 *     with no slack, i.e. we would have made the choice for it on the client,
 *     where the model's context window and the resume snapshot size are not
 *     known. The plan is explicit that the clip is the edge's.
 *   - NOT HIGHER, because every char past the edge budget is clipped there and
 *     buys nothing but request bytes. At 6 000 the worst-case request growth is
 *     ~6 KB, against a body that already carries `legacy.conversationMessages`.
 * This budget costs NO input tokens: token cost is bounded by the edge at
 * `V2_MEMORY_BUDGET_CHARS` + framing, ~4 200 chars / ~1 050 uncached tokens.
 */
export const V2_MEMORY_WIRE_BUDGET_CHARS = 2 * V2_MEMORY_BUDGET_CHARS;

/** Appended when a section was clipped to `V2_MEMORY_WIRE_SECTION_MAX_CHARS`. */
export const V2_MEMORY_WIRE_CLIP_MARKER = '…';

/** Hard ceiling on any single input string SCANNED, so a megabyte store body is
 *  never fully copied or regex-scanned. Well above the per-section cap. */
const MAX_SCAN_CHARS = 64000;

/** Max retrieval rows rendered by `formatTurnRetrievalText`. `retrieveForTurn`
 *  returns at most `finalCount` (default 12); this is the hostile-input guard. */
export const MAX_RETRIEVAL_ROWS_RENDERED = 32;

/** Per-row clamp inside the rebuilt retrieval text. */
export const MAX_RETRIEVAL_ROW_CHARS = 600;

// ─── Wire types ─────────────────────────────────────────────────────────────

/** One section on the wire. `{ key, text }` and NOTHING else — see (3) above. */
export interface V2MemoryWireSection {
  key: V2MemoryClientSectionKey;
  /** RAW, UNFENCED. The edge fences it. */
  text: string;
}

/** The exact value that goes in the request body as `memory`. */
export interface V2MemoryWirePayload {
  sections: V2MemoryWireSection[];
}

/** Content-free build report. Safe to log; carries keys, counts and lengths. */
export interface V2MemoryPayloadResult {
  /** `null` when nothing survived — the caller must OMIT the field. See (4). */
  payload: V2MemoryWirePayload | null;
  emitted: Array<{
    key: V2MemoryClientSectionKey;
    chars: number;
    /** True when the section hit `sectionMaxChars`. */
    clipped: boolean;
    /**
     * True when a `<untrusted_quoted>` marker was found and removed — i.e. a
     * caller handed us PRE-FENCED text. Always a wiring bug worth logging: the
     * payload is safe, but somebody passed `.formatted` where `.memories` was
     * meant.
     */
    fenceStripped: boolean;
  }>;
  /** Keys that had content but lost the budget, in emit order. */
  dropped: V2MemoryClientSectionKey[];
  /** Sum of emitted `chars`. Always <= `budgetChars`. */
  totalChars: number;
  budgetChars: number;
}

const EMPTY_RESULT: V2MemoryPayloadResult = {
  payload: null,
  emitted: [],
  dropped: [],
  totalChars: 0,
  budgetChars: V2_MEMORY_WIRE_BUDGET_CHARS,
};

function emptyResult(budgetChars = V2_MEMORY_WIRE_BUDGET_CHARS): V2MemoryPayloadResult {
  return { ...EMPTY_RESULT, emitted: [], dropped: [], budgetChars };
}

// ─── Total coercion helpers ─────────────────────────────────────────────────

/** Guarded property read — a throwing getter / hostile proxy yields undefined. */
function readField(obj: unknown, key: string): unknown {
  if (obj === null || typeof obj !== 'object') return undefined;
  try {
    return (obj as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

/** Guarded indexed read — a hostile index getter yields undefined. */
function readIndex(arr: ArrayLike<unknown>, i: number): unknown {
  try {
    return arr[i];
  } catch {
    return undefined;
  }
}

function toFiniteNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string') {
    const t = v.trim();
    if (t === '') return undefined;
    const n = Number(t);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/**
 * The untrusted-fence marker, incl. spaced/cased/closing variants — the SAME
 * source expression the two `wrapUntrusted` copies use
 * (`src/lib/untrustedContent.ts`, `supabase/functions/_shared/untrusted.ts`).
 * Built as a source string so every call gets a FRESH regex: a shared `/g`
 * regex carries `lastIndex` state and would skip matches on alternate calls,
 * which for a security strip is a silent, intermittent hole.
 */
const FENCE_MARKER_SOURCE = '<\\s*\\/?\\s*untrusted_quoted\\s*>';

/** CRLF / lone CR → LF, so char accounting matches what the edge counts. */
const CR_NEWLINES = /\r\n?/g;

interface CleanedText {
  text: string;
  fenceStripped: boolean;
}

/**
 * Normalize one section body for the wire. Deliberately MINIMAL: the edge's
 * `sanitizeSectionText` is the authority on control chars, Unicode tag blocks
 * and blank-line collapsing, and duplicating that here would create a second
 * place to keep in sync for no added safety.
 *
 * The one transform that IS load-bearing here is the fence strip — see (2) in
 * the header. It runs AFTER the scan clamp so a megabyte string is never
 * regex-scanned in full.
 *
 * Non-strings return `''` rather than being stringified: a caller that passes an
 * object must lose the section, not put `"[object Object]"` in a prompt.
 */
function cleanWireText(raw: unknown): CleanedText {
  if (typeof raw !== 'string' || raw === '') return { text: '', fenceStripped: false };
  try {
    const scanned = raw.length > MAX_SCAN_CHARS ? raw.slice(0, MAX_SCAN_CHARS) : raw;
    const stripped = scanned.replace(new RegExp(FENCE_MARKER_SOURCE, 'gi'), '');
    const fenceStripped = stripped.length !== scanned.length;
    return { text: stripped.replace(CR_NEWLINES, '\n').trim(), fenceStripped };
  } catch {
    return { text: '', fenceStripped: false };
  }
}

/** Clip to `max` INCLUDING the marker, backing off to a clean break. Deterministic. */
function clipWireText(text: string, max: number): { text: string; clipped: boolean } {
  if (text.length <= max) return { text, clipped: false };
  const room = max - V2_MEMORY_WIRE_CLIP_MARKER.length;
  if (room <= 0) return { text: '', clipped: true };
  let body = text.slice(0, room);
  const lastBreak = Math.max(body.lastIndexOf('\n'), body.lastIndexOf(' '));
  if (lastBreak > room * 0.7) body = body.slice(0, lastBreak);
  body = body.trimEnd();
  if (body === '') return { text: '', clipped: true };
  return { text: `${body}${V2_MEMORY_WIRE_CLIP_MARKER}`, clipped: true };
}

// ─── Rebuilding the RAW turn-retrieval body ─────────────────────────────────

/**
 * Rebuild the `turn_retrieval` section body from the RAW rows returned by
 * `memoryService.retrieveForTurn(...).memories`.
 *
 * WHY NOT JUST USE `.formatted`: that field is already `wrapUntrusted(...)`-ed
 * (memoryService:1259) plus a trusted `## Relevant memory` heading. Putting it
 * on the wire double-fences it at the edge and smuggles a heading the edge
 * already supplies (`### Retrieved for this message`). The line format below is
 * byte-identical to the one `retrieveForTurn` fences (memoryService:1243-1246),
 * so the model sees exactly what the client-loop lane shows it, minus the fence
 * the edge will add back.
 *
 * Total: any input shape returns a string, never throws.
 */
export function formatTurnRetrievalText(memories: unknown): string {
  try {
    if (!Array.isArray(memories) || memories.length === 0) return '';
    const lines: string[] = [];
    const limit = Math.min(memories.length, MAX_RETRIEVAL_ROWS_RENDERED);
    for (let i = 0; i < limit; i += 1) {
      const m = readIndex(memories, i);
      const kind = typeof readField(m, 'memory_kind') === 'string' ? (readField(m, 'memory_kind') as string).trim() : '';
      const title = typeof readField(m, 'title') === 'string' ? (readField(m, 'title') as string).trim() : '';
      const content = typeof readField(m, 'content') === 'string' ? (readField(m, 'content') as string).trim() : '';
      if (title === '' && content === '') continue;
      const rawReason = readField(m, 'reason');
      const reason = typeof rawReason === 'string' && rawReason.trim() !== '' ? ` (${rawReason.trim()})` : '';
      const line = `- [${kind || 'fact'}] ${title}: ${content}${reason}`.replace(CR_NEWLINES, '\n');
      lines.push(
        line.length > MAX_RETRIEVAL_ROW_CHARS
          ? `${line.slice(0, MAX_RETRIEVAL_ROW_CHARS - 1).trimEnd()}…`
          : line,
      );
    }
    return lines.join('\n');
  } catch {
    return '';
  }
}

// ─── The pure builder ───────────────────────────────────────────────────────

export interface V2MemoryPayloadInput {
  /**
   * `OpenSwanMemoryStores` (or any shape carrying those four fields). RAW —
   * `swanbot.ts` fences these at ITS call site, so what comes out of
   * `buildOpenSwanMemoryStores` is unfenced and is what belongs on the wire.
   */
  stores?: Partial<OpenSwanMemoryStores> | null | unknown;
  /** RAW rows from `retrieveForTurn(...).memories`. NOT `.formatted`. */
  retrievalMemories?: readonly RetrievedMemory[] | null | unknown;
  /**
   * Pre-rendered RAW retrieval text, for a caller that already has it. Used only
   * when `retrievalMemories` produced nothing, so passing both is safe.
   */
  retrievalText?: string | null | unknown;
  /**
   * RAW soul-wisdom body — `SoulWisdomEntry.body`, NOT
   * `formatSoulWisdomBlock(entry)` (that return value is already fenced).
   * `buildV2MemoryPayloadForTurn` never populates this; see its doc comment.
   */
  soulWisdomBody?: string | null | unknown;
  /** Wire budget. Defaults to / clamped by `V2_MEMORY_WIRE_BUDGET_CHARS`. */
  budgetChars?: unknown;
  /** Per-section cap. Defaults to / clamped by `V2_MEMORY_WIRE_SECTION_MAX_CHARS`. */
  sectionMaxChars?: unknown;
}

/**
 * Build the v2 wire payload from already-loaded memory. PURE — no clock, no
 * network, no randomness; identical input gives a byte-identical payload.
 *
 * Sections are considered in EMIT order (= priority descending, derived from the
 * core), and the budget is spent greedily with a `continue` rather than a
 * `break` — so when a large mid-priority section does not fit, a smaller
 * lower-priority one may still ride along. That mirrors the edge's own ceiling
 * pass (`assembleV2MemoryBlock`), which matters: the client should never make a
 * drop decision the edge would not have made.
 *
 * Returns `payload: null` — never `{sections: []}` — when nothing survived.
 *
 * Total: any input shape returns a result, never throws.
 */
export function buildV2MemoryPayload(input?: V2MemoryPayloadInput | unknown): V2MemoryPayloadResult {
  const rawBudget = toFiniteNumber(readField(input, 'budgetChars'));
  const budgetChars =
    rawBudget === undefined
      ? V2_MEMORY_WIRE_BUDGET_CHARS
      : Math.max(0, Math.min(Math.floor(rawBudget), V2_MEMORY_WIRE_BUDGET_CHARS));
  try {
    const rawSectionMax = toFiniteNumber(readField(input, 'sectionMaxChars'));
    const sectionMaxChars =
      rawSectionMax === undefined
        ? V2_MEMORY_WIRE_SECTION_MAX_CHARS
        : Math.max(0, Math.min(Math.floor(rawSectionMax), V2_MEMORY_WIRE_SECTION_MAX_CHARS));

    const stores = readField(input, 'stores');
    let retrieval = formatTurnRetrievalText(readField(input, 'retrievalMemories'));
    if (retrieval === '') {
      const fallback = readField(input, 'retrievalText');
      if (typeof fallback === 'string') retrieval = fallback;
    }

    // Raw candidate text per key. Anything not a non-empty string is skipped.
    const raw: Record<V2MemoryClientSectionKey, unknown> = {
      turn_retrieval: retrieval,
      memory_user_notes: readField(stores, 'userNotes'),
      memory_user_profile: readField(stores, 'userProfile'),
      memory_working: readField(stores, 'workingMemory'),
      memory_runtime: readField(stores, 'runtimeMemory'),
      soul_wisdom: readField(input, 'soulWisdomBody'),
    };

    const emitted: V2MemoryPayloadResult['emitted'] = [];
    const dropped: V2MemoryClientSectionKey[] = [];
    const sections: V2MemoryWireSection[] = [];
    let totalChars = 0;

    for (const key of V2_MEMORY_CLIENT_SECTION_KEYS) {
      const cleaned = cleanWireText(raw[key]);
      if (cleaned.text === '') continue; // absent, not dropped — nothing was lost
      const clip = clipWireText(cleaned.text, sectionMaxChars);
      if (clip.text === '') {
        dropped.push(key);
        continue;
      }
      if (totalChars + clip.text.length > budgetChars) {
        dropped.push(key);
        continue; // a smaller, lower-priority section may still fit
      }
      totalChars += clip.text.length;
      sections.push({ key, text: clip.text });
      emitted.push({
        key,
        chars: clip.text.length,
        clipped: clip.clipped,
        fenceStripped: cleaned.fenceStripped,
      });
    }

    if (sections.length === 0) return { ...emptyResult(budgetChars), dropped };
    return { payload: { sections }, emitted, dropped, totalChars, budgetChars };
  } catch {
    return emptyResult(budgetChars);
  }
}

// ─── The runtime loader (impure; dynamic imports only) ──────────────────────

/**
 * Wall-clock ceiling for the WHOLE memory build.
 *
 * The v2 default path already awaits `buildV2ConnectivitySnapshot`, whose own
 * cap is `V2_CONNECTIVITY_BUILD_CAP_MS` = 1 500 ms (`swanbot.ts:1182`). The
 * caller starts this build BEFORE that await and joins both, so the marginal
 * worst case this adds to a turn is 2 000 - 1 500 = **500 ms**, not 2 000 ms —
 * and only when both loaders are at their limit. Anything slower than this is
 * worth less than the latency it costs: the edge's server-side floor still
 * covers the turn.
 */
export const V2_MEMORY_BUILD_DEADLINE_MS = 2000;

/**
 * `budgetChars` for `retrieveForTurn` on this path.
 *
 * The chat lane picks this per complexity tier from `chatPromptAssembly`
 * (1 200 simple / 1 800 moderate / 2 500 complex). `callSwanBotV2` has no
 * complexity tier — it takes `thinkingLevel` only — so rather than invent a
 * second tiering rule, this sits at the moderate tier's value. It is also below
 * the edge's whole-block budget (3 000), so a retrieval section can never alone
 * consume the edge's budget and starve the user's own notes.
 */
export const V2_MEMORY_TURN_RETRIEVAL_BUDGET_CHARS = 1800;

/** Rows kept by `retrieveForTurn`. Matches the chat lane's moderate tier. */
export const V2_MEMORY_TURN_RETRIEVAL_COUNT = 8;

/** `limit` for `buildOpenSwanMemoryStores`, identical to `swanbot.ts:4245`. */
export const V2_MEMORY_STORE_LIMIT = 8;

export interface V2MemoryTurnArgs {
  circleId?: string | null;
  userId?: string | null;
  /** The user's message — the retrieval query. Blank ⇒ no `turn_retrieval`. */
  message?: string | null;
  agentSubjectKey?: string | null;
  agentLegacyIds?: readonly string[] | null;
  agentName?: string | null;
  /** Override for tests. Clamped to `V2_MEMORY_BUILD_DEADLINE_MS`. */
  deadlineMs?: number;
}

/**
 * Load this turn's memory and return the v2 wire payload, or `null`.
 *
 * `null` means "send no `memory` field at all" — see (4) in the header. It is
 * returned for a missing circle/user, for a total loader failure, for a timeout,
 * and for the ordinary case of a user with no memory yet.
 *
 * BOUNDING, precisely:
 *   - Both loaders run CONCURRENTLY and each is raced against `deadlineMs`.
 *   - Each is individually `.catch`-ed to `null`, so `Promise.all` can never
 *     reject and one dead loader cannot cost the other its result.
 *   - The whole body is inside a `try/catch` returning `null`.
 *   So: no input, no backend state, and no import failure can make this throw or
 *   outlast the deadline.
 *
 * The race does NOT cancel the loser (same as `swanbot.ts`'s `withTimeout`): a
 * slow loader finishes in the background and its result is discarded. Both are
 * reads. `retrieveForTurn` additionally fires a best-effort `memory_access_log`
 * insert that it never awaits — identical to what the client-loop lane already
 * does on every turn, so this adds no new class of write.
 *
 * DELIBERATELY NOT LOADED HERE: `soul_wisdom`. It needs a resolved spirit id
 * (`loadAgentIdentities`) and then `loadSoulWisdomWithFallback`, which on a
 * cache miss SYNTHESIZES wisdom — three further DB round trips over up to 80
 * memory rows. That is a serial chain on the hot default path buying the
 * LOWEST-priority section in the model (44), the one the edge's clip drops whole
 * first whenever `turn_retrieval` + notes + profile are present. The pure
 * builder still accepts `soulWisdomBody`, so a caller that already holds the
 * entry pays nothing to include it.
 */
export async function buildV2MemoryPayloadForTurn(
  args: V2MemoryTurnArgs,
): Promise<V2MemoryWirePayload | null> {
  try {
    const circleId = typeof args?.circleId === 'string' ? args.circleId.trim() : '';
    const userId = typeof args?.userId === 'string' ? args.userId.trim() : '';
    if (circleId === '' || userId === '') return null;
    const message = typeof args?.message === 'string' ? args.message : '';

    const rawDeadline = toFiniteNumber(args?.deadlineMs);
    const deadlineMs =
      rawDeadline === undefined
        ? V2_MEMORY_BUILD_DEADLINE_MS
        : Math.max(0, Math.min(Math.floor(rawDeadline), V2_MEMORY_BUILD_DEADLINE_MS));

    // Mirror of the shared helper in `buildSystemPromptAsync` (`swanbot.ts:4189`)
    // — a Promise.race against a timer, which resolves null rather than
    // rejecting. Restated here because that one is a closure local to the prompt
    // builder, not an export.
    const withTimeout = <T>(p: Promise<T>, ms = deadlineMs): Promise<T | null> =>
      Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);

    const legacyIds = Array.isArray(args?.agentLegacyIds)
      ? args.agentLegacyIds.filter((v): v is string => typeof v === 'string').slice(0, 16)
      : undefined;

    const storesTask = withTimeout(
      import('./openswanMemoryStores')
        .then(({ buildOpenSwanMemoryStores }) =>
          buildOpenSwanMemoryStores({
            circleId,
            userId,
            query: message,
            agentId: args?.agentSubjectKey || undefined,
            agentAliases: legacyIds,
            agentName: args?.agentName || undefined,
            surface: 'main_chat',
            limit: V2_MEMORY_STORE_LIMIT,
          }),
        )
        .catch((e) => {
          console.warn('[SwanBot/v2] memory stores load failed:', e);
          return null;
        }),
    );

    const retrievalTask = message.trim()
      ? withTimeout(
          import('./memoryService')
            .then(({ retrieveForTurn }) =>
              retrieveForTurn({
                queryText: message,
                circleId,
                userId,
                surface: 'main_chat',
                budgetChars: V2_MEMORY_TURN_RETRIEVAL_BUDGET_CHARS,
                finalCount: V2_MEMORY_TURN_RETRIEVAL_COUNT,
              }),
            )
            .catch((e) => {
              console.warn('[SwanBot/v2] turn retrieval failed:', e);
              return null;
            }),
        )
      : Promise.resolve(null);

    const [stores, retrieval] = await Promise.all([storesTask, retrievalTask]);
    if (!stores && !retrieval) return null;

    const result = buildV2MemoryPayload({
      stores,
      // RAW rows, never `retrieval.formatted` — that field is already fenced.
      retrievalMemories: retrieval?.memories,
    });

    // A stripped fence means a caller handed us pre-fenced text. The payload is
    // safe (we removed it), but it is a wiring bug and must be visible. Bounded,
    // content-free.
    const prefenced = result.emitted.filter((e) => e.fenceStripped).map((e) => e.key);
    if (prefenced.length > 0) {
      console.warn('[SwanBot/v2] memory payload carried pre-fenced text (stripped):', prefenced);
    }
    return result.payload;
  } catch (e) {
    console.warn('[SwanBot/v2] memory payload build failed — sending none:', e);
    return null;
  }
}
