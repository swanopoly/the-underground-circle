/**
 * delegationBriefCore — the PURE outbound "what do we actually hand a delegated
 * sub-agent?" brain for OpenSwan fan-out. It assembles the bounded, complete
 * brief a child receives from parent state: a scoped SUBTASK, a MINIMAL RELEVANT
 * context slice (not the parent's whole history), explicit SUCCESS CRITERIA
 * (from the task plan's verification checks), BOUNDARIES / what-not-to-touch
 * (derived from the sibling specs so parallel specialists don't redo each
 * other's work), and a summary-aware RETURN contract.
 *
 * Why this exists (the asymmetry it closes):
 *   OpenSwan's sub-agent delegation has a well-engineered RETURN path
 *   (`delegationGate.redactSubagentOutput` boils each child's output down to a
 *   ~1200-char summary-only digest for the parent) but an ad-hoc OUTBOUND path
 *   (`subagentRegistry.delegateToSubagent` concatenates the child's system
 *   prompt + the parent's FULL chat history + the raw parent message). The
 *   intended contract is "the child does NOT inherit the parent's full context;
 *   only the task brief goes in, only the child's final summary comes back out."
 *   This core builds the missing brief half. `buildReturnContract` is designed so
 *   the child's output survives `redactSubagentOutput`'s cap — its default budget
 *   (`DEFAULT_RETURN_BUDGET_CHARS = 1200`) is deliberately the same 1200 chars.
 *
 * Relationship to siblings (all disjoint):
 *   - delegationSizingCore decides HOW MANY specs survive; this decides WHAT each
 *     surviving spec is handed. Runs after sizing, once per kept spec.
 *   - delegationGate owns the child→parent RETURN redaction + the depth/spend
 *     gate; this owns the parent→child OUTBOUND brief. Opposite directions.
 *   - specialistSelectionCore decides WHICH roles wake; this builds their briefs.
 *   - openswanTaskPlanner PRODUCES the plan (kind + verification[]); this CONSUMES
 *     it (verification → successCriteria).
 *   - agentPromptBuilder composes cache-disciplined SYSTEM blocks; this produces a
 *     plain-text per-delegation USER brief it can consume downstream.
 *
 * PURITY (load-bearing): ZERO runtime imports — nothing is imported at all — so it
 * loads under tsx/esbuild for smoke testing (which cannot load react-native /
 * supabase). Loose structural views are declared locally (like
 * delegationSizingCore / specialistSelectionCore).
 * DETERMINISTIC: no Date.now / Math.random / argless `new Date`. Frozen const
 * maps. Object-map lookups go through `Object.prototype.hasOwnProperty.call` with
 * role keys sanitized to [a-z0-9], so `"constructor"` / `"__proto__"` can never
 * reach a prototype slot; dedup uses `Set` (pollution-safe). Text scans are
 * code-POINT aware (`Array.from` / `for..of` / `codePointAt`) so an astral char /
 * emoji surrogate pair is never split or double-counted. Stable sorts key on
 * score-desc then original-index (a total order — indexes are unique).
 * BOUNDED: every output is clamped by the exported MAX_* caps; scans are capped;
 * huge / hostile input is pre-sliced before any per-code-point work.
 * TOTAL: every export tolerates null / undefined / wrong-type / NaN / bigint /
 * cyclic / throwing-proxy / huge / hostile input and returns a safe neutral value
 * — never throws (outer try/catch + per-helper guards).
 * SECRET-SAFE: fetches nothing, redacts nothing itself — it passes through
 * caller-provided context which the CALLER is expected to have already run through
 * `secretRedactionCore` — but it still strips control / line-separator characters
 * from every rendered string so no injected fence / newline can escape a section.
 */

// ── Bounds (exported caps) ──────────────────────────────────────────────────

/** Longest scoped subtask body kept (matches delegationGate's redaction cap). */
export const MAX_SUBTASK_CHARS = 1200;
/** Longest single-line headline (first non-empty line of the subtask). */
export const MAX_HEADLINE_CHARS = 140;
/** Most relevant-context lines kept in the slice. */
export const MAX_CONTEXT_LINES = 6;
/** Longest single context line. */
export const MAX_CONTEXT_LINE_CHARS = 240;
/** Most candidate snippets scanned when selecting the context slice. */
export const MAX_CANDIDATE_SCAN = 200;
/** Most success criteria rendered. */
export const MAX_CRITERIA = 6;
/** Most boundary lines rendered (siblings truncated first; fence always last). */
export const MAX_BOUNDARIES = 6;
/** Most return-contract lines rendered. */
export const MAX_RETURN_LINES = 6;
/** Hard cap on the whole rendered brief text. */
export const MAX_BRIEF_CHARS = 4000;
/** Default forwarded-summary budget — cohesive with delegationGate's 1200 cap. */
export const DEFAULT_RETURN_BUDGET_CHARS = 1200;

// ── Internal caps (not exported — implementation detail) ────────────────────

const MAX_ROLE_CHARS = 40;
const MAX_DISPLAY_NAME_CHARS = 60;
const MAX_CRITERIA_CHARS = 200;
const MAX_BOUNDARY_FOCUS_CHARS = 80;
const MAX_BOUNDARY_LINE_CHARS = 220;
const MAX_VERIFICATION_SCAN = 200;
const MAX_SIBLING_SCAN = 200;
const MIN_QUERY_TOKEN_LEN = 3;
const MAX_TOKEN_LEN = 40;
const MAX_QUERY_TOKENS = 64;
const MAX_LINE_TOKENS = 200;
const MIN_RETURN_BUDGET_CHARS = 50;
const MAX_RETURN_BUDGET_CHARS = 100_000;
/** Absolute UTF-16-unit ceiling any raw string is pre-sliced to before scanning. */
const ABS_RAW_SCAN_UNITS = 40_000;
/** Single-code-point ellipsis appended when a string is truncated. */
const ELLIPSIS = '…';

// ── Structural views + result types ─────────────────────────────────────────

/** Loose structural view of a delegation spec this module reasons over. */
export interface BriefSpecView {
  role: string;
  displayName?: string;
  task?: string;
  reason?: string;
}

/** Input to `assembleDelegationBrief`. Every field is optional + defensive. */
export interface AssembleDelegationBriefInput {
  /** The raw parent request (fallback subtask source). */
  parentMessage?: unknown;
  /** The spec for THIS delegated child (role + optional task/displayName). */
  spec?: unknown;
  /** The parent's task plan (source of verification → success criteria). */
  taskPlan?: unknown;
  /** The OTHER specs fanning out in parallel (source of boundaries). */
  siblingSpecs?: readonly unknown[] | null;
  /** Candidate context snippets to select a minimal relevant slice from. */
  contextCandidates?: readonly unknown[] | null;
  /** Forwarded-summary budget the child is told about. */
  returnBudgetChars?: number;
}

/** The bounded, complete brief handed to a delegated sub-agent. */
export interface DelegationBrief {
  role: string;
  headline: string;
  subtask: string;
  contextSlice: string[];
  successCriteria: string[];
  boundaries: string[];
  returnContract: string[];
  text: string;
  meta: {
    contextLineCount: number;
    criteriaCount: number;
    boundaryCount: number;
    truncated: boolean;
    chars: number;
  };
}

// ── Frozen const data (deterministic; guarded lookups) ──────────────────────

/** Candidate object keys (allow-list) read for display text, in priority order.
 *  Deliberately excludes `constructor` / `__proto__`, so those keys are never
 *  read even if present. */
const CANDIDATE_TEXT_KEYS: readonly string[] = Object.freeze([
  'text',
  'title',
  'content',
  'summary',
  'label',
]);

const EMPTY_TOKENS: readonly string[] = Object.freeze([]);

/** Extra query tokens per role so the relevant-context slice leans toward that
 *  role's domain. Curated + specific; added to the subtask's own query tokens. */
const ROLE_HINTS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  coder: Object.freeze(['code', 'function', 'file', 'implement', 'refactor', 'module', 'endpoint', 'component']),
  debugger: Object.freeze(['bug', 'error', 'stack', 'trace', 'crash', 'regression', 'reproduce', 'root']),
  reviewer: Object.freeze(['review', 'finding', 'severity', 'risk', 'quality', 'regression']),
  tester: Object.freeze(['test', 'coverage', 'assert', 'fixture', 'expected', 'case']),
  architect: Object.freeze(['architecture', 'boundary', 'coupling', 'module', 'interface', 'dependency']),
  planner: Object.freeze(['plan', 'step', 'milestone', 'sequence', 'order', 'phase']),
  researcher: Object.freeze(['research', 'compare', 'tradeoff', 'option', 'evidence', 'recommendation']),
  security: Object.freeze(['security', 'auth', 'secret', 'vulnerability', 'injection', 'exploit']),
  devops: Object.freeze(['deploy', 'pipeline', 'docker', 'release', 'infra', 'rollback']),
  designer: Object.freeze(['layout', 'color', 'spacing', 'visual', 'responsive', 'typography']),
  writer: Object.freeze(['documentation', 'readme', 'changelog', 'copy', 'content']),
});

/** Role-flavored RETURN line. Guarded lookup by [a-z0-9]-sanitized role key. */
const ROLE_RETURN_HINTS: Readonly<Record<string, string>> = Object.freeze({
  coder: 'Name the exact files and functions you changed.',
  debugger: 'Name the root cause plus the exact files and functions you changed.',
  reviewer: 'List findings ranked by severity, most critical first.',
  tester: 'List the exact checks you ran and their expected outcomes.',
  architect: 'State the chosen boundary and one key tradeoff you weighed.',
  planner: 'Give an ordered, numbered list of steps.',
  researcher: 'Give a decision-ready recommendation and the single key tradeoff.',
  security: 'Rank the issues by exploitability, most exploitable first.',
  devops: 'Give the exact commands or pipeline steps, in order.',
  designer: 'State the concrete layout and visual decisions you made.',
});

const ROLE_RETURN_DEFAULT = 'Give the concrete deliverable, not a restatement of the task.';

const GENERIC_FENCE = "Stay within this subtask; don't expand scope beyond what's stated above.";

/** Common English function words dropped from the query token set so a
 *  zero-overlap line (e.g. "the weather is nice") never scores against a shared
 *  stopword. */
const STOPWORDS: ReadonlySet<string> = new Set<string>([
  'the', 'and', 'for', 'are', 'was', 'were', 'this', 'that', 'with', 'from',
  'into', 'onto', 'your', 'yours', 'our', 'ours', 'you', 'but', 'not', 'can',
  'will', 'would', 'should', 'could', 'has', 'have', 'had', 'its', 'all', 'any',
  'out', 'use', 'via', 'per', 'off', 'than', 'then', 'them', 'they', 'their',
  'there', 'here', 'what', 'when', 'where', 'which', 'who', 'whom', 'how', 'why',
  'does', 'did', 'done', 'been', 'being', 'also', 'just', 'only', 'some', 'such',
  'over', 'under', 'more', 'most', 'less', 'very', 'much', 'many', 'upon',
  'about', 'above', 'below', 'after', 'before', 'again', 'once', 'each', 'few',
  'both', 'either', 'neither', 'nor', 'yet', 'get', 'got', 'make', 'made', 'need',
  'want', 'like', 'let', 'set', 'put', 'may', 'might', 'must', 'shall', 'still',
]);

// ── Coercion + sanitization helpers (total, code-point aware) ────────────────

/** Coerce an arbitrary value to a plain string WITHOUT ever `String()`-ing a
 *  symbol / object / function (which can throw or leak `[object Object]`). */
function toStr(v: unknown): string {
  try {
    const t = typeof v;
    if (t === 'string') return v as string;
    if (t === 'number') return Number.isFinite(v as number) ? String(v) : '';
    if (t === 'boolean') return v ? 'true' : 'false';
    if (t === 'bigint') return (v as bigint).toString();
    return '';
  } catch {
    return '';
  }
}

/** Arrays only — a non-array (or null) coerces to an empty array. */
function coerceArray(v: unknown): unknown[] {
  return Array.isArray(v) ? (v as unknown[]) : [];
}

/** Clamp a requested count to `[0, ceil]`, defaulting junk to `fallback`. */
function clampCount(v: unknown, fallback: number, ceil: number): number {
  let n: number;
  if (typeof v === 'number' && Number.isFinite(v)) n = Math.floor(v);
  else n = fallback;
  if (n < 0) n = 0;
  if (n > ceil) n = ceil;
  return n;
}

/** Truncate to at most `cap` CODE POINTS (not UTF-16 units), appending an
 *  ellipsis when clipped. Never splits a surrogate pair. */
function clipToPoints(s: string, cap: number): string {
  if (cap <= 0 || !s) return '';
  const points = Array.from(s);
  if (points.length <= cap) return s;
  if (cap === 1) return points.slice(0, 1).join('');
  return points.slice(0, cap - 1).join('') + ELLIPSIS;
}

/** Strip control / DEL / C1 / line-separator chars; map tab/newline/CR/line-sep
 *  to a space; collapse whitespace runs; trim. Yields a safe single line. */
function sanitizeLine(s: string): string {
  const arr: string[] = [];
  for (const ch of s) {
    const c = ch.codePointAt(0) as number;
    if (c === 9 || c === 10 || c === 13 || c === 0x2028 || c === 0x2029) { arr.push(' '); continue; }
    if (c < 0x20 || c === 0x7f || (c >= 0x80 && c <= 0x9f)) continue;
    if (ch.length === 1 && c >= 0xd800 && c <= 0xdfff) continue; // drop a lone surrogate (never valid standalone; e.g. a pair split by clipText's UTF-16 pre-slice)
    arr.push(ch);
  }
  return arr.join('').replace(/\s+/g, ' ').trim();
}

/** Like `sanitizeLine` but preserves newlines as structure (line-separators and
 *  tabs normalized), so a multi-line subtask keeps its shape without leaking
 *  control chars or U+2028/U+2029. */
function sanitizeMultiline(s: string): string {
  const arr: string[] = [];
  for (const ch of s) {
    const c = ch.codePointAt(0) as number;
    if (c === 10 || c === 0x2028 || c === 0x2029) { arr.push('\n'); continue; }
    if (c === 13) continue; // drop CR (avoid \r\n dupes)
    if (c === 9) { arr.push(' '); continue; }
    if (c < 0x20 || c === 0x7f || (c >= 0x80 && c <= 0x9f)) continue;
    if (ch.length === 1 && c >= 0xd800 && c <= 0xdfff) continue; // drop a lone surrogate (never valid standalone; e.g. a pair split by clipText's UTF-16 pre-slice)
    arr.push(ch);
  }
  return arr.join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Coerce + pre-slice + sanitize + clip in one shot. Bounds all per-code-point
 *  work by pre-slicing the raw string first (control-char density is tolerated:
 *  a slightly shorter safe string is fine). */
function clipText(v: unknown, maxCodePoints: number, multiline: boolean): string {
  const cap = maxCodePoints > 0 ? Math.floor(maxCodePoints) : 0;
  if (cap <= 0) return '';
  let raw = toStr(v);
  if (!raw) return '';
  const ceil = Math.min(raw.length, cap * 4 + 64, ABS_RAW_SCAN_UNITS);
  if (raw.length > ceil) raw = raw.slice(0, ceil);
  const clean = multiline ? sanitizeMultiline(raw) : sanitizeLine(raw);
  return clipToPoints(clean, cap);
}

const clipLine = (v: unknown, cap: number): string => clipText(v, cap, false);
const clipMultiline = (v: unknown, cap: number): string => clipText(v, cap, true);

/** First non-empty line of an already-sanitized multi-line string. */
function firstNonEmptyLine(s: string): string {
  const str = toStr(s);
  if (!str) return '';
  const lines = str.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const t = lines[i].trim();
    if (t) return t;
  }
  return '';
}

/** Normalize a rendered line for dedupe (trim + lowercase + collapse space). */
function normalizeForDedupe(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

// ── Guarded own-property readers ─────────────────────────────────────────────

/** Read an own string/number/bigint property; guarded against prototype-chain
 *  walking + throwing getters. Never returns inherited values. */
function ownStr(o: Record<string, unknown>, key: string): string {
  try {
    if (!Object.prototype.hasOwnProperty.call(o, key)) return '';
    const v = o[key];
    if (typeof v === 'string') return v;
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    if (typeof v === 'bigint') return v.toString();
    return '';
  } catch {
    return '';
  }
}

/** Read an own boolean flag with STRICT `=== true` semantics (a truthy-but-not
 *  -true value is not treated as set). Guarded. */
function ownBool(o: Record<string, unknown>, key: string): boolean {
  try {
    return Object.prototype.hasOwnProperty.call(o, key) && o[key] === true;
  } catch {
    return false;
  }
}

// ── Role helpers ─────────────────────────────────────────────────────────────

/** Sanitized, lowercased display role (control-stripped, clipped). Parallel to
 *  delegationSizingCore.extractSpecRole but hardened for prompt rendering. */
function cleanRole(v: unknown): string {
  return clipToPoints(sanitizeLine(toStr(v).toLowerCase()), MAX_ROLE_CHARS);
}

/** [a-z0-9]-only key for a plain-object map lookup — code-point aware so an
 *  astral char is dropped whole, and `"__proto__"` collapses to `"proto"`. */
function roleKey(role: unknown): string {
  const s = toStr(role).toLowerCase();
  const arr: string[] = [];
  for (const ch of s) {
    const c = ch.codePointAt(0) as number;
    if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57)) {
      arr.push(ch);
      if (arr.length >= MAX_ROLE_CHARS) break;
    }
  }
  return arr.join('');
}

function readRole(o: Record<string, unknown>): string {
  // Role must be an actual string (a numeric/bool role is not a role) — mirrors
  // delegationSizingCore.extractSpecRole, which only accepts `typeof === 'string'`.
  try {
    if (!Object.prototype.hasOwnProperty.call(o, 'role')) return '';
    const r = o.role;
    return typeof r === 'string' ? cleanRole(r) : '';
  } catch {
    return '';
  }
}

/**
 * Pull a lowercased, sanitized role from `spec.role` OR `spec.subagent.role`,
 * else `''`. Total: null / non-object / throwing-proxy input yields `''`.
 * (Local parallel to delegationSizingCore.extractSpecRole so this module has
 * zero imports.)
 */
export function extractBriefRole(spec: unknown): string {
  try {
    if (!spec || typeof spec !== 'object') return '';
    const rec = spec as Record<string, unknown>;
    const direct = readRole(rec);
    if (direct) return direct;
    let sub: unknown;
    try {
      sub = rec.subagent;
    } catch {
      sub = undefined;
    }
    if (sub && typeof sub === 'object') {
      const nested = readRole(sub as Record<string, unknown>);
      if (nested) return nested;
    }
    return '';
  } catch {
    return '';
  }
}

/** Read a field from `spec[key]` else `spec.subagent[key]` (own props only). */
function specField(spec: unknown, key: string): string {
  if (!spec || typeof spec !== 'object') return '';
  const direct = ownStr(spec as Record<string, unknown>, key);
  if (direct) return direct;
  let sub: unknown;
  try {
    sub = (spec as Record<string, unknown>).subagent;
  } catch {
    sub = undefined;
  }
  if (sub && typeof sub === 'object') {
    const nested = ownStr(sub as Record<string, unknown>, key);
    if (nested) return nested;
  }
  return '';
}

// ── Tokenization ─────────────────────────────────────────────────────────────

/** Lowercase + split into a bounded list of ASCII-alphanumeric word tokens.
 *  Non-ASCII (incl. astral) chars act as delimiters — never split mid-token. */
function tokenizeToArray(s: string): string[] {
  const lower = toStr(s).toLowerCase();
  const clipped = lower.length > ABS_RAW_SCAN_UNITS ? lower.slice(0, ABS_RAW_SCAN_UNITS) : lower;
  const parts = clipped.split(/[^a-z0-9]+/);
  const out: string[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    const p = parts[i];
    if (p) {
      out.push(p);
      if (out.length >= MAX_LINE_TOKENS) break;
    }
  }
  return out;
}

/** Curated hint tokens for a role (guarded lookup), else none. */
function roleHintTokens(role: string): readonly string[] {
  const k = roleKey(role);
  if (k && Object.prototype.hasOwnProperty.call(ROLE_HINTS, k)) return ROLE_HINTS[k];
  return EMPTY_TOKENS;
}

/** Build the distinct query token set from the subtask + role-hint keywords.
 *  Short tokens and stopwords are dropped from the subtask side so a shared
 *  function word can't make an unrelated line score. */
function buildQuerySet(subtask: string, role: string): Set<string> {
  const set = new Set<string>();
  const subTokens = tokenizeToArray(subtask);
  for (let i = 0; i < subTokens.length; i += 1) {
    const t = subTokens[i];
    if (t.length >= MIN_QUERY_TOKEN_LEN && t.length <= MAX_TOKEN_LEN && !STOPWORDS.has(t)) {
      set.add(t);
      if (set.size >= MAX_QUERY_TOKENS) return set;
    }
  }
  const hints = roleHintTokens(role);
  for (let i = 0; i < hints.length; i += 1) {
    set.add(hints[i]);
    if (set.size >= MAX_QUERY_TOKENS) return set;
  }
  return set;
}

/** Distinct token set for one candidate line. */
function lineTokenSet(line: string): Set<string> {
  const set = new Set<string>();
  const tokens = tokenizeToArray(line);
  for (let i = 0; i < tokens.length; i += 1) {
    set.add(tokens[i]);
    if (set.size >= MAX_LINE_TOKENS) break;
  }
  return set;
}

/** Count DISTINCT query tokens present as whole tokens in a candidate line. */
function scoreLine(lineTokens: Set<string>, query: Set<string>): number {
  let s = 0;
  for (const q of query) if (lineTokens.has(q)) s += 1;
  return s;
}

// ── Candidate text extraction ────────────────────────────────────────────────

/** Coerce a context candidate to display text: a string, a number, or the first
 *  present of {text|title|content|summary|label} via guarded own-key lookup. */
function candidateToString(c: unknown): string {
  if (typeof c === 'string') return c;
  if (typeof c === 'number') return Number.isFinite(c) ? String(c) : '';
  if (typeof c === 'bigint') {
    try {
      return c.toString();
    } catch {
      return '';
    }
  }
  if (c && typeof c === 'object') {
    for (let i = 0; i < CANDIDATE_TEXT_KEYS.length; i += 1) {
      const v = ownStr(c as Record<string, unknown>, CANDIDATE_TEXT_KEYS[i]);
      if (v) return v;
    }
  }
  return '';
}

// ── Public API ───────────────────────────────────────────────────────────────

interface ScoredLine {
  text: string;
  score: number;
  index: number;
  norm: string;
}

/**
 * Select a MINIMAL RELEVANT context slice for the child from candidate snippets.
 * This is what makes the brief a slice, not the parent's whole history: when the
 * subtask/role yields query tokens, ONLY lines that share at least one whole
 * query token are kept (zero-overlap lines dropped, an empty result is allowed);
 * with no query tokens it falls back to the first-N chronological lines. Deduped
 * by normalized text, ranked score-desc then original-index, each line clipped,
 * capped at `max` (never above `MAX_CONTEXT_LINES`). Total + deterministic.
 */
export function selectRelevantContext(
  subtask: string,
  role: string,
  candidates: readonly unknown[] | null,
  max: number = MAX_CONTEXT_LINES,
): string[] {
  try {
    const cap = clampCount(max, MAX_CONTEXT_LINES, MAX_CONTEXT_LINES);
    if (cap <= 0) return [];
    const arr = coerceArray(candidates);
    if (arr.length === 0) return [];

    const query = buildQuerySet(toStr(subtask), toStr(role));
    const hasQuery = query.size > 0;

    const entries: ScoredLine[] = [];
    const scanLimit = Math.min(arr.length, MAX_CANDIDATE_SCAN);
    for (let i = 0; i < scanLimit; i += 1) {
      const raw = candidateToString(arr[i]);
      const line = clipLine(raw, MAX_CONTEXT_LINE_CHARS);
      if (!line) continue;
      const norm = normalizeForDedupe(line);
      if (!norm) continue;
      let score = 0;
      if (hasQuery) {
        score = scoreLine(lineTokenSet(line), query);
        if (score <= 0) continue; // minimal relevant slice: drop zero-overlap lines
      }
      entries.push({ text: line, score, index: i, norm });
    }

    // Dedupe by normalized text — keep the best-scoring (earliest on tie).
    const byNorm = new Map<string, ScoredLine>();
    for (let i = 0; i < entries.length; i += 1) {
      const e = entries[i];
      const prev = byNorm.get(e.norm);
      if (!prev || e.score > prev.score || (e.score === prev.score && e.index < prev.index)) {
        byNorm.set(e.norm, e);
      }
    }
    const deduped = Array.from(byNorm.values());

    // Rank score-desc then original-index-asc (a total order — indexes unique).
    deduped.sort((a, b) => (b.score - a.score) || (a.index - b.index));

    const out: string[] = [];
    for (let i = 0; i < deduped.length && out.length < cap; i += 1) {
      out.push(deduped[i].text);
    }
    return out;
  } catch {
    return [];
  }
}

interface Criterion {
  label: string;
  required: boolean;
  index: number;
  norm: string;
}

/** Coerce one verification entry to {label, required}. */
function coerceCheck(v: unknown): { label: string; required: boolean } {
  if (typeof v === 'string') return { label: v, required: false };
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const label = ownStr(o, 'label') || ownStr(o, 'id') || ownStr(o, 'kind') || ownStr(o, 'reason');
    return { label, required: ownBool(o, 'required') };
  }
  return { label: '', required: false };
}

function readVerificationArray(taskPlan: unknown): unknown[] {
  try {
    if (taskPlan && typeof taskPlan === 'object' && Object.prototype.hasOwnProperty.call(taskPlan, 'verification')) {
      const v = (taskPlan as Record<string, unknown>).verification;
      if (Array.isArray(v)) return v;
    }
  } catch {
    /* fall through */
  }
  return [];
}

/**
 * Derive explicit SUCCESS CRITERIA from a task plan's `verification[]` checks —
 * the criteria the parent already computed but never threaded to the child.
 * Required checks come first (stable within group), labels are clipped + deduped,
 * capped at `max` (never above `MAX_CRITERIA`). Empty / malformed verification
 * yields `[]`. Total + deterministic.
 */
export function deriveSuccessCriteria(taskPlan: unknown, max: number = MAX_CRITERIA): string[] {
  try {
    const verification = readVerificationArray(taskPlan);
    if (verification.length === 0) return [];
    const cap = clampCount(max, MAX_CRITERIA, MAX_CRITERIA);
    if (cap <= 0) return [];

    const items: Criterion[] = [];
    const scan = Math.min(verification.length, MAX_VERIFICATION_SCAN);
    for (let i = 0; i < scan; i += 1) {
      const { label, required } = coerceCheck(verification[i]);
      const clipped = clipLine(label, MAX_CRITERIA_CHARS);
      if (!clipped) continue;
      const norm = normalizeForDedupe(clipped);
      if (!norm) continue;
      items.push({ label: clipped, required, index: i, norm });
    }

    // Dedupe by normalized label, preserving first (index) order.
    const seen = new Set<string>();
    const deduped: Criterion[] = [];
    for (let i = 0; i < items.length; i += 1) {
      if (seen.has(items[i].norm)) continue;
      seen.add(items[i].norm);
      deduped.push(items[i]);
    }

    // Required-first, stable within each group (filter preserves index order).
    const out: string[] = [];
    for (let i = 0; i < deduped.length; i += 1) if (deduped[i].required) out.push(deduped[i].label);
    for (let i = 0; i < deduped.length; i += 1) if (!deduped[i].required) out.push(deduped[i].label);
    return out.slice(0, cap);
  } catch {
    return [];
  }
}

/**
 * Derive BOUNDARIES / what-not-to-touch from the sibling specs so parallel
 * specialists coordinate instead of redoing each other's work. Each sibling
 * (role ≠ this role, deduped by role, empty roles skipped) contributes one fence
 * line naming what it owns; the generic scope fence is ALWAYS appended last (a
 * slot is reserved for it — siblings are truncated first). Capped at `max` (never
 * above `MAX_BOUNDARIES`). Total + deterministic.
 */
export function deriveBoundaries(
  role: string,
  siblingSpecs: readonly unknown[] | null,
  max: number = MAX_BOUNDARIES,
): string[] {
  try {
    const cap = clampCount(max, MAX_BOUNDARIES, MAX_BOUNDARIES);
    if (cap <= 0) return [];
    const thisRole = cleanRole(role);
    const arr = coerceArray(siblingSpecs);

    const out: string[] = [];
    const seenRoles = new Set<string>();
    const siblingSlots = cap - 1; // reserve one slot for the always-last fence
    const scan = Math.min(arr.length, MAX_SIBLING_SCAN);
    for (let i = 0; i < scan && out.length < siblingSlots; i += 1) {
      const sibling = arr[i];
      const sRole = extractBriefRole(sibling);
      if (!sRole) continue; // empty roles skipped
      if (sRole === thisRole) continue; // role ≠ this
      if (seenRoles.has(sRole)) continue; // deduped by role
      seenRoles.add(sRole);

      const display = clipLine(specField(sibling, 'displayName'), MAX_DISPLAY_NAME_CHARS);
      const owner = display || sRole;
      const focusRaw = firstNonEmptyLine(clipMultiline(specField(sibling, 'task') || specField(sibling, 'reason'), MAX_BOUNDARY_FOCUS_CHARS * 3));
      const focus = clipLine(focusRaw, MAX_BOUNDARY_FOCUS_CHARS);
      const line = focus
        ? `${owner} owns "${focus}" — coordinate, don't redo their work.`
        : `${owner} owns a parallel subtask — coordinate, don't redo their work.`;
      out.push(clipLine(line, MAX_BOUNDARY_LINE_CHARS));
    }

    out.push(GENERIC_FENCE); // always last, if there is any room at all
    return out.slice(0, cap);
  } catch {
    return [];
  }
}

/** Clamp the forwarded-summary budget the child is told about. */
function clampBudget(v: unknown): number {
  let n: number;
  if (typeof v === 'number' && Number.isFinite(v)) n = Math.floor(v);
  else n = DEFAULT_RETURN_BUDGET_CHARS;
  if (n < MIN_RETURN_BUDGET_CHARS) n = MIN_RETURN_BUDGET_CHARS;
  if (n > MAX_RETURN_BUDGET_CHARS) n = MAX_RETURN_BUDGET_CHARS;
  return n;
}

function roleReturnHint(role: unknown): string {
  const k = roleKey(role);
  if (k && Object.prototype.hasOwnProperty.call(ROLE_RETURN_HINTS, k)) return ROLE_RETURN_HINTS[k];
  return ROLE_RETURN_DEFAULT;
}

/**
 * Build the summary-aware RETURN contract. The child is told the parent only
 * forwards the first `~budget` chars (default `DEFAULT_RETURN_BUDGET_CHARS`,
 * cohesive with delegationGate's redaction cap), to state done/blocked/partial,
 * a role-flavored deliverable line, and to omit its working transcript. Capped
 * at `MAX_RETURN_LINES`. Total + deterministic.
 */
export function buildReturnContract(
  role: string,
  returnBudgetChars: number = DEFAULT_RETURN_BUDGET_CHARS,
): string[] {
  try {
    const budget = clampBudget(returnBudgetChars);
    const lines: string[] = [
      `Return a concise summary — only the first ~${budget} chars are forwarded to the parent, so lead with the single most important result.`,
      'State explicitly whether you are done, blocked, or partial.',
      roleReturnHint(role),
      'Do not include your full working transcript — the parent only needs the outcome.',
    ];
    return lines.slice(0, MAX_RETURN_LINES);
  } catch {
    return [ROLE_RETURN_DEFAULT];
  }
}

/** Render a bounded bullet list. */
function bullets(items: string[]): string {
  const out: string[] = [];
  for (let i = 0; i < items.length; i += 1) out.push(`- ${items[i]}`);
  return out.join('\n');
}

function emptyBrief(subtask: string): DelegationBrief {
  return {
    role: '',
    headline: clipLine(firstNonEmptyLine(subtask), MAX_HEADLINE_CHARS),
    subtask,
    contextSlice: [],
    successCriteria: [],
    boundaries: [],
    returnContract: [],
    text: subtask,
    meta: {
      contextLineCount: 0,
      criteriaCount: 0,
      boundaryCount: 0,
      truncated: false,
      chars: Array.from(subtask).length,
    },
  };
}

/**
 * Assemble the complete, bounded brief for one delegated sub-agent from parent
 * state: a scoped subtask, a minimal relevant context slice, explicit success
 * criteria, coordination boundaries, and a summary-aware return contract — plus
 * the rendered markdown `text` (each empty optional section skipped) clipped to
 * `MAX_BRIEF_CHARS` with a `truncated` flag. Total: any failure returns a safe
 * minimal brief built from the parent message alone. Deterministic + bounded.
 */
export function assembleDelegationBrief(input?: AssembleDelegationBriefInput | null): DelegationBrief {
  // Compute the fail-safe fallback subtask up front so the catch can reuse it.
  let fallbackSubtask = '';
  try {
    const rawParent = input && typeof input === 'object' ? (input as AssembleDelegationBriefInput).parentMessage : undefined;
    fallbackSubtask = clipMultiline(rawParent, MAX_SUBTASK_CHARS);
  } catch {
    fallbackSubtask = '';
  }

  try {
    const inp: AssembleDelegationBriefInput = input && typeof input === 'object' ? input : {};
    const spec = inp.spec;

    const role = extractBriefRole(spec);
    const subtaskSource = specField(spec, 'task') || toStr(inp.parentMessage);
    const subtask = clipMultiline(subtaskSource, MAX_SUBTASK_CHARS);
    const headline = clipLine(firstNonEmptyLine(subtask), MAX_HEADLINE_CHARS);

    const contextSlice = selectRelevantContext(subtask, role, inp.contextCandidates ?? null, MAX_CONTEXT_LINES);
    const successCriteria = deriveSuccessCriteria(inp.taskPlan, MAX_CRITERIA);
    const boundaries = deriveBoundaries(role, inp.siblingSpecs ?? null, MAX_BOUNDARIES);
    const returnContract = buildReturnContract(
      role,
      typeof inp.returnBudgetChars === 'number' ? inp.returnBudgetChars : DEFAULT_RETURN_BUDGET_CHARS,
    );

    const roleLabel = role || 'specialist';
    const sections: string[] = [];
    sections.push(`## SUBTASK (${roleLabel})\n${subtask || headline || '(no task provided)'}`);
    if (contextSlice.length) sections.push(`## RELEVANT CONTEXT\n${bullets(contextSlice)}`);
    if (successCriteria.length) sections.push(`## SUCCESS CRITERIA\n${bullets(successCriteria)}`);
    if (boundaries.length) sections.push(`## BOUNDARIES — DO NOT TOUCH\n${bullets(boundaries)}`);
    if (returnContract.length) sections.push(`## RETURN\n${bullets(returnContract)}`);

    let text = sections.join('\n\n');
    let truncated = false;
    const points = Array.from(text);
    if (points.length > MAX_BRIEF_CHARS) {
      truncated = true;
      text = points.slice(0, MAX_BRIEF_CHARS - 1).join('') + ELLIPSIS;
    }

    return {
      role,
      headline,
      subtask,
      contextSlice,
      successCriteria,
      boundaries,
      returnContract,
      text,
      meta: {
        contextLineCount: contextSlice.length,
        criteriaCount: successCriteria.length,
        boundaryCount: boundaries.length,
        truncated,
        chars: Array.from(text).length,
      },
    };
  } catch {
    return emptyBrief(fallbackSubtask);
  }
}
