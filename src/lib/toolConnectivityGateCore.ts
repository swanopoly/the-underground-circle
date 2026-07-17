/**
 * toolConnectivityGateCore — the PURE, pre-dispatch tool-catalog GATE that
 * withholds a tool ONLY when the external prerequisite it needs is EXPLICITLY
 * not connected for this circle.
 *
 * ─── Why this exists ─────────────────────────────────────────────────────────
 * Both tool-selection surfaces advertise tools purely from message TEXT + MODE,
 * never from what is actually CONNECTED:
 *   - the v2 edge `selectToolsForTurn` unions whole TOOL_GROUPS (`browser`,
 *     `credentials`, `wordpress`, `desktop`, the g* families) via keyword match;
 *   - the app's `getProgressiveOpenSwanTools` pins a core + prewarm/autopin folds.
 * NEITHER consults connectivity. So when Google Workspace OAuth isn't done,
 * `gmail.*` is still offered; when no browser/computer provider is configured,
 * `browser.*` is offered; when the local bridge is offline, `desktop.*` is
 * offered; when the vault is empty, `credentials.get` /
 * `browser.fill_credential_field` are offered; when no WordPress integration
 * exists, `wp.*` is offered. The model then calls a doomed tool, it fails at
 * runtime (auth / not-connected / bridge-offline), and
 * `swanbotToolErrorRecoveryCore` reacts LATE — a whole tool-loop round is burned
 * and the user hears "actually X isn't connected" after the fact.
 *
 * The connection truth is already loaded (`connectedResourcesRuntime`) but only
 * rendered as SOFT PROSE by `connectedResourcesDigest` (a secret-safe FORMATTER,
 * not a gate). This core turns that SAME boolean snapshot into a deterministic,
 * PROACTIVE, pre-dispatch tool-catalog GATE: the advertised palette adapts to
 * the circle's real connection state, and the connect-first step still reaches
 * the model as a hint/note (so flexibility is preserved, not silently lost).
 *
 * ─── Posture: FAIL OPEN ──────────────────────────────────────────────────────
 * Withholding a NEEDED tool starves flexibility — that is worse than a late
 * recovery. So a tool is gated IFF its prerequisite resolves to EXPLICIT `false`
 * (connected===false). `true` and `unknown` (absent/undefined) BOTH stay
 * available. Any tool with no matching prereq rule is always available. Any
 * exotic/hostile input degrades to "everything available, nothing gated" — every
 * deferred tool stays reachable.
 *
 * ─── Secret safety (by construction) ─────────────────────────────────────────
 * This core consumes BOOLEANS + capability tokens only; it never reads a secret
 * value. Hints are STATIC authored strings. The `note` is built from a FIXED
 * capability→label map — never from snapshot values or user text. The only
 * user-influenced text that flows to output is a tool NAME, which is
 * control/backtick/fence-stripped and clamped (like
 * `swanbotToolErrorRecoveryCore.sanitizeToolLabel`).
 *
 * ─── Purity (load-bearing) ───────────────────────────────────────────────────
 * ZERO runtime imports. No `Date.now()` / `Math.random()`. Deterministic
 * (frozen const maps, stable ordering). Every export is TOTAL: any hostile input
 * (null / undefined / wrong type / huge / throwing getter / Proxy / cyclic /
 * symbol / function) yields a safe bounded default, never a throw. Loadable
 * under tsx/esbuild for smoke testing and safe in Deno edge functions.
 *
 * ─── Not a duplicate of ──────────────────────────────────────────────────────
 *   - v2ToolSelectionCore selects tool GROUPS from message TEXT (connection-
 *     blind); this filters its output by connectivity (complementary).
 *   - swanbotToolErrorRecoveryCore is REACTIVE per-error AFTER dispatch; this is
 *     PROACTIVE pre-dispatch, eliminating the doomed call it would handle late.
 *   - connectedResourcesDigest turns the SAME snapshot into PROSE to READ; this
 *     returns the structured verdict/partition the runtime uses to WITHHOLD.
 *   - toolPolicyCore governs APPROVAL assuming a tool CAN run; this answers
 *     whether its external prerequisite even EXISTS.
 */

// ─── Public types ────────────────────────────────────────────────────────────

/**
 * A connectivity capability token a tool can depend on. The well-known tokens
 * are enumerated for autocomplete; marketplace providers (slack/notion/github/…)
 * are arbitrary strings resolved against `snapshot.integrations`.
 */
export type ConnectivityCapability =
  | 'google'
  | 'google.gmail'
  | 'google.calendar'
  | 'google.drive'
  | 'google.sheets'
  | 'google.docs'
  | 'browser'
  | 'desktopBridge'
  | 'vault'
  | 'wordpress'
  // eslint-disable-next-line @typescript-eslint/ban-types
  | (string & {});

/**
 * What is connected right now — BOOLEANS ONLY, TRISTATE-BY-PRESENCE:
 *   true      = connected.
 *   false     = EXPLICITLY not connected (the ONLY thing that gates a tool).
 *   absent/undefined = unknown (never gates — fail open).
 * The runtime derives this cheaply from reads it already does (integrations
 * rows → integrations{}/wordpress, google status → google/googleServices, vault
 * count → vault). `browser`/`desktopBridge` may stay undefined until a trivial
 * probe exists — undefined never gates.
 */
export interface ConnectivitySnapshot {
  google?: boolean;
  googleServices?: Record<string, boolean>;
  browser?: boolean;
  desktopBridge?: boolean;
  vault?: boolean;
  wordpress?: boolean;
  integrations?: Record<string, boolean>;
}

/**
 * One tool→prerequisite rule. `match` is EITHER an exact tool name
 * (`credentials.get`) OR a family prefix ending in '.' (`gmail.`). `hint` is a
 * STATIC, secret-safe "connect X first" string.
 */
export interface ToolPrereqRule {
  match: string;
  capability: ConnectivityCapability;
  hint: string;
}

/** The per-tool decision. `missing`/`hint` are present only when `gated`. */
export interface ToolConnectivityVerdict {
  tool: string;
  status: 'available' | 'gated';
  missing?: ConnectivityCapability;
  hint?: string;
}

/** The partition a caller uses: advertise `available`, withhold `gated`. */
export interface GateResult {
  available: string[];
  gated: ToolConnectivityVerdict[];
  note: string;
}

/** Options shared by the classify/gate entry points. */
export interface GateOptions {
  extraRules?: ToolPrereqRule[];
  maxGated?: number;
}

// ─── Bounds (exported so callers share the exact same caps) ───────────────────

/** Max candidate tool names classified in one gateToolNames call. */
export const MAX_CANDIDATES = 1000;
/** Max extra rules scanned (accepted) per call. */
export const MAX_RULES_SCANNED = 200;
/** Longest tool name echoed into a verdict (control/backtick/fence-stripped). */
export const MAX_TOOL_NAME_LEN = 200;
/** Longest rule `match` string considered. */
export const MAX_MATCH_LEN = 200;
/** Longest capability token considered. */
export const MAX_CAP_LEN = 80;
/** Longest hint echoed into a gated verdict. */
export const MAX_HINT_LEN = 200;
/** Hard cap on the summary `note`. */
export const MAX_NOTE_LEN = 240;

/** Internal: how many array items gateToolNames will scan before stopping. */
const MAX_CANDIDATE_SCAN = 100_000;
/** Internal: an exact-name match always out-ranks any family prefix. */
const EXACT_SPECIFICITY = 1_000_000;

// ─── Total helpers (never throw) ──────────────────────────────────────────────

/** String() that never throws (throwing toString / Symbol coercion caught).
 *  null/undefined collapse to ''. */
function safeStr(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return String(value);
  } catch {
    return '';
  }
}

function clampStr(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text;
}

/** Read a property off an unknown value without ever throwing (throwing getters
 *  / Proxies caught). Non-objects read as undefined. */
function safeGet(obj: unknown, key: string): unknown {
  if (obj === null || (typeof obj !== 'object' && typeof obj !== 'function')) return undefined;
  try {
    return (obj as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

/**
 * Flatten a user-influenced label (tool name / rule match / capability / hint)
 * to a bounded, single-line, fence-safe string. Backtick + C0/C1 controls + DEL
 * + line/paragraph separators + angle brackets become spaces; whitespace is
 * collapsed and trimmed; the result is clamped. Uses charCodeAt (not a control
 * regex literal) so this source stays pure ASCII. Total — never throws.
 */
function cleanLabelText(value: unknown, max: number): string {
  const cap = max > 0 ? max : 1;
  const raw = clampStr(safeStr(value), cap * 2);
  let out = '';
  for (let i = 0; i < raw.length; i += 1) {
    const c = raw.charCodeAt(i);
    if (
      c <= 0x1f || // C0 controls
      c === 0x7f || // DEL
      (c >= 0x80 && c <= 0x9f) || // C1 controls
      c === 0x60 || // backtick
      c === 0x3c || // <
      c === 0x3e || // >
      c === 0x2028 || // line separator
      c === 0x2029 // paragraph separator
    ) {
      out += ' ';
    } else {
      out += raw[i];
    }
  }
  return clampStr(out.replace(/\s+/g, ' ').trim(), cap);
}

/** Only a literal boolean counts. true→connected, false→explicitly-off,
 *  anything else→unknown (undefined). */
function readBool(value: unknown): boolean | undefined {
  return value === true ? true : value === false ? false : undefined;
}

// ─── Fixed capability→label vocabulary (secret-safe note construction) ─────────

/**
 * The ONLY human labels a `note` may contain for a well-known capability. All
 * Google services collapse to one "Google Workspace" label so a run withholding
 * several g* tools reads "needing: Google Workspace" once. A plain frozen object
 * (accessed only via a hasOwnProperty guard, so `__proto__` can't leak).
 */
const CAPABILITY_LABELS: Readonly<Record<string, string>> = Object.freeze({
  google: 'Google Workspace',
  'google.gmail': 'Google Workspace',
  'google.calendar': 'Google Workspace',
  'google.drive': 'Google Workspace',
  'google.sheets': 'Google Workspace',
  'google.docs': 'Google Workspace',
  browser: 'a browser provider',
  desktopBridge: 'the desktop bridge',
  vault: 'the vault',
  wordpress: 'WordPress',
});

/** A safe short provider token (marketplace capability) we may Title-case into a
 *  note label. Rejects long / secret-shaped / punctuation-heavy strings. */
const PROVIDER_TOKEN_RE = /^[a-z][a-z0-9_-]{1,31}$/i;

/**
 * A fixed, secret-safe display label for a capability token, or '' when the
 * token is unknown AND not a clean short provider id. Never echoes snapshot
 * values or free text. Total.
 */
function capabilityLabel(token: unknown): string {
  if (typeof token !== 'string') return '';
  const t = token.trim();
  if (!t) return '';
  if (Object.prototype.hasOwnProperty.call(CAPABILITY_LABELS, t)) {
    const label = CAPABILITY_LABELS[t];
    if (typeof label === 'string') return label;
  }
  if (PROVIDER_TOKEN_RE.test(t)) return t.charAt(0).toUpperCase() + t.slice(1);
  return '';
}

// ─── Default prereq table (advisory/extensible — NOT the runtime truth) ────────

/**
 * The built-in tool→prerequisite table, kept in lockstep with the v2 TOOL_GROUPS
 * families. Advisory + extensible: callers may pass `extraRules` (which override
 * a default on a specificity tie). This is documentation of the current families,
 * not the single runtime source of truth.
 */
export const DEFAULT_TOOL_PREREQ_RULES: readonly ToolPrereqRule[] = Object.freeze([
  { match: 'gmail.', capability: 'google.gmail', hint: 'Connect Google Workspace (Gmail) to use gmail.* tools.' },
  { match: 'gcal.', capability: 'google.calendar', hint: 'Connect Google Workspace (Calendar) to use gcal.* tools.' },
  { match: 'gsheets.', capability: 'google.sheets', hint: 'Connect Google Workspace (Sheets) to use gsheets.* tools.' },
  { match: 'gdocs.', capability: 'google.docs', hint: 'Connect Google Workspace (Docs) to use gdocs.* tools.' },
  { match: 'gdrive.', capability: 'google.drive', hint: 'Connect Google Workspace (Drive) to use gdrive.* tools.' },
  { match: 'browser.', capability: 'browser', hint: 'Connect a browser/computer-use provider to use browser.* tools.' },
  { match: 'desktop.', capability: 'desktopBridge', hint: 'Start the local desktop bridge to use desktop.* tools.' },
  { match: 'wp.', capability: 'wordpress', hint: 'Connect a WordPress integration to use wp.* tools.' },
  { match: 'credentials.get', capability: 'vault', hint: 'Add a vault credential before fetching one.' },
  {
    match: 'browser.fill_credential_field',
    capability: 'vault',
    hint: 'Save a login in the vault before filling credentials.',
  },
] as const);

// ─── Internal normalized-rule form ─────────────────────────────────────────────

interface NormRule {
  /** Cleaned, non-empty match string. */
  match: string;
  /** A '.'-terminated match is a family prefix; otherwise an exact tool name. */
  matchKind: 'exact' | 'prefix';
  /** Cleaned, non-empty capability token. */
  capability: string;
  /** Cleaned hint ('' when absent). */
  hint: string;
  /** 0 = built-in default, 1 = caller extraRule (wins on a specificity tie). */
  source: 0 | 1;
}

/** Normalize one loosely-typed rule; returns null for anything unusable so a
 *  garbage extraRule is IGNORED (never shadows a real rule). */
function normalizeRule(rule: unknown, source: 0 | 1): NormRule | null {
  if (rule === null || typeof rule !== 'object') return null;
  const rawMatch = safeGet(rule, 'match');
  if (typeof rawMatch !== 'string') return null;
  const match = cleanLabelText(rawMatch, MAX_MATCH_LEN);
  if (!match) return null;
  const rawCap = safeGet(rule, 'capability');
  if (typeof rawCap !== 'string') return null;
  const capability = cleanLabelText(rawCap, MAX_CAP_LEN);
  if (!capability) return null;
  const hint = cleanLabelText(safeGet(rule, 'hint'), MAX_HINT_LEN);
  const matchKind: 'exact' | 'prefix' = match.endsWith('.') ? 'prefix' : 'exact';
  return { match, matchKind, capability, hint, source };
}

function buildNormRules(rules: readonly ToolPrereqRule[], source: 0 | 1): NormRule[] {
  const out: NormRule[] = [];
  for (const rule of rules) {
    const norm = normalizeRule(rule, source);
    if (norm) out.push(norm);
  }
  return out;
}

/** Precomputed once — the defaults never change. */
const DEFAULT_NORM_RULES: readonly NormRule[] = buildNormRules(DEFAULT_TOOL_PREREQ_RULES, 0);

/** Normalize + cap caller-supplied extra rules (scanned ≤ MAX_RULES_SCANNED). */
function normalizeExtraRules(extraRules: unknown): NormRule[] {
  if (!Array.isArray(extraRules)) return [];
  const out: NormRule[] = [];
  const limit = Math.min(extraRules.length, MAX_RULES_SCANNED);
  for (let i = 0; i < limit; i += 1) {
    const norm = normalizeRule(extraRules[i], 1);
    if (norm) out.push(norm);
  }
  return out;
}

// ─── Rule resolution (most-specific match) ─────────────────────────────────────

/** Specificity of a rule for a tool name, or -1 when it does not match. An
 *  exact-name match always out-ranks any family prefix; among prefixes the
 *  longer prefix wins. */
function ruleMatchSpecificity(rule: NormRule, tool: string): number {
  if (!rule.match) return -1;
  if (rule.matchKind === 'prefix') {
    return tool.startsWith(rule.match) ? rule.match.length : -1;
  }
  return tool === rule.match ? EXACT_SPECIFICITY : -1;
}

/**
 * The most-specific matching rule for `tool`, or null. Exact beats longest
 * prefix; on a tie an extraRule beats a default; otherwise the first-seen rule
 * wins (defaults are considered before extras). Deterministic.
 */
function resolveRule(tool: string, extra: readonly NormRule[]): NormRule | null {
  let best: NormRule | null = null;
  let bestSpec = -1;
  for (const rule of DEFAULT_NORM_RULES) {
    const spec = ruleMatchSpecificity(rule, tool);
    if (spec > bestSpec) {
      best = rule;
      bestSpec = spec;
    }
  }
  for (const rule of extra) {
    const spec = ruleMatchSpecificity(rule, tool);
    if (spec < 0) continue;
    if (spec > bestSpec) {
      best = rule;
      bestSpec = spec;
    } else if (spec === bestSpec && best !== null && best.source === 0) {
      // Same specificity: a caller extraRule overrides a default.
      best = rule;
    }
  }
  return best;
}

// ─── Capability resolution against the snapshot ────────────────────────────────

/**
 * Resolve a capability token to true (connected) / false (explicitly off) /
 * undefined (unknown) against the snapshot. Never throws — every read goes
 * through safeGet, so a Proxy/throwing-getter/cyclic snapshot degrades to
 * unknown. Only a literal boolean counts.
 */
function resolveCapability(capability: string, snapshot: unknown): boolean | undefined {
  if (capability === 'google') return readBool(safeGet(snapshot, 'google'));
  if (capability.startsWith('google.')) {
    // The whole account being off gates every service; else consult the service.
    if (readBool(safeGet(snapshot, 'google')) === false) return false;
    const svc = capability.slice('google.'.length);
    return readBool(safeGet(safeGet(snapshot, 'googleServices'), svc));
  }
  if (capability === 'browser') return readBool(safeGet(snapshot, 'browser'));
  if (capability === 'desktopBridge') return readBool(safeGet(snapshot, 'desktopBridge'));
  if (capability === 'vault') return readBool(safeGet(snapshot, 'vault'));
  if (capability === 'wordpress') {
    const direct = readBool(safeGet(snapshot, 'wordpress'));
    if (direct !== undefined) return direct;
    return readBool(safeGet(safeGet(snapshot, 'integrations'), 'wordpress'));
  }
  // Any other token → a marketplace integration keyed by the token itself.
  return readBool(safeGet(safeGet(snapshot, 'integrations'), capability));
}

// ─── Public API ────────────────────────────────────────────────────────────────

/** Classify against an already-normalized rule set (shared by the entry points). */
function classifyWithRules(tool: string, snapshot: unknown, extra: readonly NormRule[]): ToolConnectivityVerdict {
  const best = resolveRule(tool, extra);
  if (!best) return { tool, status: 'available' };
  const resolved = resolveCapability(best.capability, snapshot);
  // FAIL OPEN: gate IFF the prerequisite is EXPLICITLY false. true/unknown pass.
  if (resolved === false) {
    const verdict: ToolConnectivityVerdict = { tool, status: 'gated', missing: best.capability };
    if (best.hint) verdict.hint = best.hint;
    return verdict;
  }
  return { tool, status: 'available' };
}

/**
 * Decide whether ONE tool should be advertised given the connection snapshot.
 * Resolves the most-specific matching prereq rule, then gates IFF its capability
 * is explicitly not connected. No matching rule, or a connected/unknown
 * prerequisite → 'available'. Total — any hostile input → 'available'.
 */
export function classifyToolConnectivity(
  toolName: unknown,
  snapshot: unknown,
  opts?: GateOptions,
): ToolConnectivityVerdict {
  let tool = '';
  try {
    tool = cleanLabelText(toolName, MAX_TOOL_NAME_LEN);
    if (!tool) return { tool: '', status: 'available' };
    const extra = normalizeExtraRules(safeGet(opts, 'extraRules'));
    return classifyWithRules(tool, snapshot, extra);
  } catch {
    return { tool, status: 'available' };
  }
}

/**
 * Partition a candidate tool list into `available` (advertise) vs `gated`
 * (withhold), plus a compact `note`. Candidates are coerced to a bounded
 * (≤ MAX_CANDIDATES), deduped, input-order-preserving string list. Total — any
 * failure fails OPEN: every coerced candidate is returned as available and
 * nothing is gated (no deferred tool is ever silently lost).
 */
export function gateToolNames(candidateNames: unknown, snapshot: unknown, opts?: GateOptions): GateResult {
  let names: string[] = [];
  try {
    names = coerceCandidates(candidateNames);
    const extra = normalizeExtraRules(safeGet(opts, 'extraRules'));
    const maxGated = clampMaxGated(safeGet(opts, 'maxGated'));
    const available: string[] = [];
    const gated: ToolConnectivityVerdict[] = [];
    for (const name of names) {
      const verdict = classifyWithRules(name, snapshot, extra);
      if (verdict.status === 'gated') {
        // A gated tool is NEVER advertised; the gated LIST itself is bounded.
        if (gated.length < maxGated) gated.push(verdict);
      } else {
        available.push(verdict.tool);
      }
    }
    return { available, gated, note: summarizeGates(gated) };
  } catch {
    // Fail OPEN: advertise every candidate we managed to coerce, gate nothing.
    return { available: names.slice(0, MAX_CANDIDATES), gated: [], note: '' };
  }
}

/** Convenience boolean: is this tool withheld by connectivity? Fail open (false). */
export function isToolConnectionGated(toolName: unknown, snapshot: unknown, opts?: GateOptions): boolean {
  try {
    return classifyToolConnectivity(toolName, snapshot, opts).status === 'gated';
  } catch {
    return false;
  }
}

/**
 * A compact, deterministic, secret-safe one-liner summarizing withheld tools,
 * e.g. "Withheld 3 tools needing: Google Workspace, WordPress." Uses ONLY the
 * fixed capability→label vocabulary (distinct labels, first-seen order); '' when
 * nothing is gated. Bounded to MAX_NOTE_LEN. Total.
 */
export function summarizeGates(gated: unknown): string {
  try {
    if (!Array.isArray(gated)) return '';
    const labels: string[] = [];
    const seen = new Set<string>();
    let count = 0;
    const limit = Math.min(gated.length, MAX_CANDIDATES);
    for (let i = 0; i < limit; i += 1) {
      const verdict = gated[i];
      if (verdict === null || typeof verdict !== 'object') continue;
      if (safeGet(verdict, 'status') !== 'gated') continue;
      count += 1;
      const label = capabilityLabel(safeGet(verdict, 'missing'));
      if (label && !seen.has(label)) {
        seen.add(label);
        labels.push(label);
      }
    }
    if (count === 0) return '';
    const noun = count === 1 ? 'tool' : 'tools';
    const head = `Withheld ${count} ${noun}`;
    const note = labels.length > 0 ? `${head} needing: ${labels.join(', ')}.` : `${head}.`;
    return clampStr(note, MAX_NOTE_LEN);
  } catch {
    return '';
  }
}

// ─── Candidate coercion ────────────────────────────────────────────────────────

/** Coerce a candidate list to a bounded, deduped, cleaned, order-preserving
 *  string list. Non-string / empty / duplicate entries are dropped. */
function coerceCandidates(candidateNames: unknown): string[] {
  if (!Array.isArray(candidateNames)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const limit = Math.min(candidateNames.length, MAX_CANDIDATE_SCAN);
  for (let i = 0; i < limit; i += 1) {
    if (out.length >= MAX_CANDIDATES) break;
    const item = candidateNames[i];
    if (typeof item !== 'string') continue;
    const name = cleanLabelText(item, MAX_TOOL_NAME_LEN);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/** Clamp an optional maxGated to [0, MAX_CANDIDATES]; absent/invalid → no extra
 *  cap (MAX_CANDIDATES). */
function clampMaxGated(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return MAX_CANDIDATES;
  const n = Math.floor(value);
  if (n < 0) return 0;
  return n > MAX_CANDIDATES ? MAX_CANDIDATES : n;
}
