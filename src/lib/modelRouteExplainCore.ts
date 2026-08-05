/**
 * modelRouteExplainCore — pure "why this model / route" explainer (transparency UX).
 *
 * The app makes a lot of INVISIBLE routing decisions per turn: BlackSwan-v5 as
 * app-grounding context with a Haiku tool executor doing the tool loop
 * (`buildBlackSwanRoutingMetadata` / `resolveOpenSwanToolLoopModel` in
 * `blackswanRouting.ts`), a fail-visible endpoint failover when BlackSwan is
 * cold or unconfigured (`planBlackSwanEndpointFailover` — reasons
 * `blackswan_endpoint_cold_or_unreachable` / `blackswan_endpoint_not_configured`),
 * an Auto-lane escalation from BlackSwan to a frontier model on hard turns
 * (`shouldEscalateBlackSwanToFrontier` / `describeBlackSwanEscalation`), or a
 * cross-provider fallback after a 429/529/5xx (`crossProviderRouter` +
 * `isTransientProviderError`). None of that is legible to a user.
 *
 * This core turns any (possibly hostile / partial) routing-decision shape into a
 * friendly, bounded one-liner + optional detail + short badge chips, so a chat
 * route-chip or the OpenSwan console can show WHY a model/route was used:
 *
 *   explainRoute({ model, provider, reason, fallbackFrom, toolExecutor, byok })
 *     -> { short, detail, badges }
 *
 * Grounding (matches the real cited files — no runtime coupling):
 *   - Model prettifier mirrors `describeFallbackModelForNotice` in
 *     blackswanRouting.ts (`claude-haiku-4-5-20251001` -> `Claude Haiku 4.5`;
 *     strip provider prefix + `-20YYMMDD` date suffix).
 *   - BlackSwan detection mirrors `isBlackSwanModel` (a `/blackswan` or
 *     `cswan801/blackswan` substring).
 *   - Reason vocabulary mirrors the failover routingNote slugs, the escalation
 *     reasons from `describeBlackSwanEscalation`, and the transient-error
 *     classes from `isTransientProviderError` (429/408/5xx/overloaded/timeout).
 *   - Provider labels mirror circleIntegrations.ts ('Hugging Face', 'OpenRouter',
 *     'Anthropic', 'Google AI', …) and the `LLMProvider` union in llmProviders.ts.
 *
 * PURITY CONTRACT (load-bearing — the smoke test runs under tsx/esbuild):
 *   - Zero runtime imports; zero import-time side effects; deterministic (no
 *     Date.now()/Math.random()).
 *   - Every export is TOTAL: null / undefined / number / bigint / symbol /
 *     function / array / huge / circular / Proxy-with-throwing-getters input
 *     never throws — a safe neutral value is returned instead.
 *   - Bounded: short/detail/badges are length-capped; badges are deduped and
 *     count-capped.
 *   - Secret-safe: every coerced field is redacted before use and the only
 *     free-text channel (an unrecognized `reason`) is redacted + whitelisted +
 *     bounded, so an API key / bearer / JWT accidentally passed in a reason or
 *     error string can never survive into the copy or a badge.
 */

// ---------------------------------------------------------------------------
// Contract types
// ---------------------------------------------------------------------------

export interface RouteExplanation {
  /** Friendly one-liner for a route chip (bounded, always non-empty). */
  short: string;
  /** Optional longer explanation for a tooltip / expander (bounded; '' when none). */
  detail: string;
  /** Short chip labels, most-relevant first (deduped, bounded, ≤ MAX_BADGES). */
  badges: string[];
}

export interface RouteExplainInput {
  /** The model that actually served / was chosen (e.g. `claude-opus-4-8`). */
  model?: unknown;
  /** The provider / gateway that served it (e.g. `openrouter`, `anthropic`). */
  provider?: unknown;
  /** A reason slug or short phrase (failover slug, escalation reason, error code). */
  reason?: unknown;
  /** The model this turn fell back FROM (e.g. `cswan801/BlackSwan-v5`). */
  fallbackFrom?: unknown;
  /** The tool-executor model swapped in behind BlackSwan (e.g. `claude-haiku-4-5`). */
  toolExecutor?: unknown;
  /** Truthy when the turn is billed to the user's own API key (BYOK). */
  byok?: unknown;
}

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

const SCAN_MAX = 2000;
const SHORT_MAX = 160;
const DETAIL_MAX = 400;
const MODEL_NAME_MAX = 40;
const PROVIDER_LABEL_MAX = 24;
const BADGE_MAX_LEN = 24;
const REASON_FREE_MAX = 40;

/** Hard cap on the number of badge chips. */
export const MAX_BADGES = 6;

// ---------------------------------------------------------------------------
// Secret redaction (self-contained — mirrors failureRecoveryCopyCore intent)
// ---------------------------------------------------------------------------

const REDACTION = '[redacted]';

const SECRET_PATTERNS: readonly RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._\-]{4,}/gi,
  /\bAuthorization\b\s*[:=]\s*["']?[A-Za-z0-9._\-]{4,}["']?/gi,
  /\bsk-ant-[A-Za-z0-9._\-]{6,}/gi,
  /\bsk-[A-Za-z0-9-]{3,}/gi, // hyphen in class → matches multi-segment keys (OpenRouter sk-or-v1-…)
  /\bxox[baprs]-[A-Za-z0-9-]{6,}/gi,
  /\bgh[pousr]_[A-Za-z0-9]{12,}/g,
  /\bAKIA[0-9A-Z]{10,}/g,
  /\bAIza[0-9A-Za-z._\-]{12,}/g,
  /\bhf_[A-Za-z0-9]{8,}/gi,
  /\beyJ[A-Za-z0-9._\-]{6,}\.[A-Za-z0-9._\-]{4,}\.[A-Za-z0-9._\-]{4,}/g,
  /\b(?:api[_-]?key|secret|token|password|passwd|pwd|client[_-]?secret|access[_-]?key|refresh[_-]?token|private[_-]?key|credential|auth[_-]?token|session[_-]?token|bearer)\b\s*[:=]\s*["']?[A-Za-z0-9._\-/+=]{3,}["']?/gi,
];

/** Replace every secret-shaped substring with `[redacted]`. Never throws. */
function redact(text: string): string {
  let out = typeof text === 'string' ? text : '';
  for (const pattern of SECRET_PATTERNS) {
    try {
      out = out.replace(pattern, REDACTION);
    } catch {
      /* a bad replace never breaks totality */
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Total primitives
// ---------------------------------------------------------------------------

/** Read a property off an unknown value without ever throwing (Proxy-safe). */
function safeGet(obj: unknown, key: string): unknown {
  if (obj === null || (typeof obj !== 'object' && typeof obj !== 'function')) return undefined;
  try {
    return (obj as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

/** Coerce an unknown to a bounded string. Objects/symbols/functions -> '' so no
 *  `[object Object]` / throwing toString ever leaks in. Never throws. */
function coerceStr(v: unknown): string {
  try {
    if (typeof v === 'string') return v.length > SCAN_MAX ? v.slice(0, SCAN_MAX) : v;
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
    if (typeof v === 'boolean' || typeof v === 'bigint') return String(v);
    return '';
  } catch {
    return '';
  }
}

/** Truthy-ish BYOK coercion. Recognized negations / empty -> false; any other
 *  non-empty string / non-zero finite number / boolean true -> true. Total. */
function coerceBool(v: unknown): boolean {
  if (v === true) return true;
  if (v === false || v === null || v === undefined) return false;
  if (typeof v === 'number') return Number.isFinite(v) && v !== 0;
  if (typeof v === 'bigint') return v !== BigInt(0);
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (!s) return false;
    return !['false', 'no', '0', 'none', 'off', 'null', 'undefined', 'n'].includes(s);
  }
  return false;
}

/** Collapse control chars + whitespace into single spaces, trimmed. */
function collapseWs(s: string): string {
  return s.replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Cap text to `max` chars; when truncated, end with a single '…'. */
function capText(s: string, max: number): string {
  if (typeof s !== 'string') return '';
  if (max <= 0) return '';
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1)).replace(/\s+$/, '')}…`;
}

function cap(w: string): string {
  return w ? w.charAt(0).toUpperCase() + w.slice(1) : w;
}

function capitalizeFirst(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Title-case a token, splitting on `_`/`-`; digit-bearing words kept as-is. */
function titleCaseToken(s: string): string {
  return collapseWs(s.replace(/[_\-]+/g, ' '))
    .split(' ')
    .filter(Boolean)
    .map((w) => (/\d/.test(w) ? w : cap(w)))
    .join(' ');
}

// ---------------------------------------------------------------------------
// BlackSwan detection (mirrors isBlackSwanModel in blackswanRouting.ts)
// ---------------------------------------------------------------------------

/** True for any BlackSwan id (local Ollama or hosted HF), on a normalized
 *  lowercased id. Mirrors the union predicate's backward-compat matcher. */
function isBlackSwan(norm: string): boolean {
  if (!norm) return false;
  if (norm === 'blackswan') return true;
  return norm.includes('/blackswan') || norm.includes('cswan801/blackswan');
}

// ---------------------------------------------------------------------------
// Model prettifier (mirrors describeFallbackModelForNotice in blackswanRouting.ts)
// ---------------------------------------------------------------------------

function prettifyGpt(s: string): string {
  const rest = s.replace(/^gpt-?/i, '');
  const segs = rest.split('-').filter(Boolean);
  if (!segs.length) return 'GPT';
  const first = segs[0];
  const tail = segs.slice(1).map((w) => (/\d/.test(w) ? w : cap(w))).join(' ');
  return `GPT-${first}${tail ? ` ${tail}` : ''}`;
}

function prettifyGemini(s: string): string {
  const rest = s.replace(/^gemini[-\s]?/i, '');
  const segs = rest.split('-').filter(Boolean);
  if (!segs.length) return 'Gemini';
  const first = segs[0];
  const tail = segs.slice(1).map((w) => (/\d/.test(w) ? w : cap(w))).join(' ');
  return `Gemini ${first}${tail ? ` ${tail}` : ''}`;
}

/**
 * Friendly display name for a model id. BlackSwan (any form) -> 'BlackSwan';
 * claude/gpt/gemini ids get prettified; `openrouter/auto` -> 'Auto-route'; the
 * provider prefix and `-20YYMMDD` date suffix are stripped (mirroring
 * `describeFallbackModelForNotice`). Bounded, redacted, never throws; '' for
 * empty / non-string-coercible input.
 */
export function prettyModelName(model: unknown): string {
  try {
    const raw = coerceStr(model).trim();
    if (!raw) return '';
    const redacted = redact(raw);
    const norm = redacted.toLowerCase();
    if (!norm) return '';
    if (isBlackSwan(norm)) return 'BlackSwan';
    let bare = redacted.replace(/^[^/]*\//, '').replace(/-20\d{6}$/, '').trim();
    if (!bare) bare = redacted.trim();
    if (bare.toLowerCase() === 'auto') return 'Auto-route';
    const cm = bare.match(/^claude-([a-z]+)-(\d+)-(\d+)$/i);
    if (cm) return capText(`Claude ${cap(cm[1])} ${cm[2]}.${cm[3]}`, MODEL_NAME_MAX);
    if (/^gpt-?\d/i.test(bare)) return capText(prettifyGpt(bare), MODEL_NAME_MAX);
    if (/^gemini[-\s]/i.test(bare)) return capText(prettifyGemini(bare), MODEL_NAME_MAX);
    return capText(bare, MODEL_NAME_MAX);
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Provider prettifier (mirrors circleIntegrations labels + LLMProvider union)
// ---------------------------------------------------------------------------

const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  openai_compatible: 'OpenAI-compatible',
  anthropic: 'Anthropic',
  openrouter: 'OpenRouter',
  groq: 'Groq',
  ollama: 'Ollama',
  replicate: 'Replicate',
  'github-models': 'GitHub Models',
  huggingface: 'Hugging Face',
  zai: 'z.ai',
  minimax: 'MiniMax',
  google_ai: 'Google AI',
  mistral_ai: 'Mistral AI',
  cohere: 'Cohere',
  perplexity: 'Perplexity',
  together_ai: 'Together AI',
  fireworks_ai: 'Fireworks AI',
  deepseek: 'DeepSeek',
  openswan: 'OpenSwan',
  blackswan: 'BlackSwan',
};

/** Normalize a provider token to a canonical alias key (mirrors the app's
 *  `hugging_face`->`huggingface`, `z_ai`->`zai`, `anthropic-direct`->`anthropic`
 *  normalization). */
function normProvider(raw: string): string {
  const n = raw.trim().toLowerCase().replace(/\s+/g, '_');
  if (n.startsWith('huggingface') || n === 'hugging_face' || n === 'hugging-face') return 'huggingface';
  if (n === 'z_ai') return 'zai';
  if (n === 'anthropic-direct' || n === 'anthropic_direct') return 'anthropic';
  if (n === 'github_models' || n === 'githubmodels' || n === 'github-models') return 'github-models';
  if (n === 'openai-compatible') return 'openai_compatible';
  return n;
}

/**
 * Friendly display name for a provider / gateway id. Known providers map to the
 * app's labels; unknown tokens are title-cased as a safe fallback. Bounded,
 * redacted, never throws; '' for empty input.
 */
export function prettyProviderName(provider: unknown): string {
  try {
    const raw = coerceStr(provider).trim();
    if (!raw) return '';
    const redacted = redact(raw).trim();
    if (!redacted) return '';
    const n = normProvider(redacted);
    const label = PROVIDER_LABELS[n];
    if (label) return label;
    const titled = titleCaseToken(redacted);
    return capText(titled || redacted, PROVIDER_LABEL_MAX);
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Reason classification
// ---------------------------------------------------------------------------

type ReasonKind =
  | 'cold_start'
  | 'not_connected'
  | 'overloaded'
  | 'rate_limited'
  | 'server_error'
  | 'timeout'
  | 'unavailable'
  | 'escalation_multi_step'
  | 'escalation_action'
  | 'escalation_technical'
  | 'escalation_long'
  | 'escalation_ambiguous'
  | 'none';

interface ReasonInfo {
  kind: ReasonKind;
  /** Friendly clause folded into short/detail (never a raw echo). */
  phrase: string;
  /** Optional badge chip for the reason. */
  badge: string | null;
}

const REASON_INFO: Record<Exclude<ReasonKind, 'none'>, { phrase: string; badge: string }> = {
  cold_start: { phrase: 'the endpoint was waking up', badge: 'Cold start' },
  not_connected: { phrase: "the endpoint isn't connected", badge: 'Not connected' },
  overloaded: { phrase: 'the model was overloaded', badge: 'Overloaded' },
  rate_limited: { phrase: 'the provider was rate-limited', badge: 'Rate-limited' },
  server_error: { phrase: 'the provider hit a server error', badge: 'Server error' },
  timeout: { phrase: 'the request timed out', badge: 'Timed out' },
  unavailable: { phrase: 'the provider was unavailable', badge: 'Unavailable' },
  escalation_multi_step: { phrase: 'a multi-step request', badge: 'Escalated' },
  escalation_action: { phrase: 'an action request', badge: 'Escalated' },
  escalation_technical: { phrase: 'technical reasoning', badge: 'Escalated' },
  escalation_long: { phrase: 'a long, compound request', badge: 'Escalated' },
  escalation_ambiguous: { phrase: 'an ambiguous request', badge: 'Escalated' },
};

/** Classify a lowercased, already-redacted reason string into a canonical kind.
 *  Escalation reasons first (they never collide with error vocabulary), then the
 *  failover / transient-error classes in precedence order. */
function classifyReasonKind(l: string): ReasonKind {
  if (!l) return 'none';
  // Escalation slugs (from describeBlackSwanEscalation / shouldEscalate...).
  if (/multi[_\s-]?step/.test(l)) return 'escalation_multi_step';
  if (/action[_\s-]?verb/.test(l) || /^action$/.test(l)) return 'escalation_action';
  if (/technical[_\s-]?reasoning|technical reasoning/.test(l)) return 'escalation_technical';
  if (/long[_\s-]?compound|long\/compound|long, ?compound/.test(l)) return 'escalation_long';
  if (/^ambiguous$|ambiguous request|\bambiguous\b/.test(l)) return 'escalation_ambiguous';
  // Failover / transient-error classes (order encodes precedence).
  if (/not[_\s-]?connected|not[_\s-]?configured|integration_not_connected|endpoint[_\s]?url[_\s]?not[_\s]?set|not set up/.test(l)) return 'not_connected';
  if (/cold|waking|warming|scal(?:e|es|ed|ing)[_\s-]*to[_\s-]*zero|scale_to_zero|starting|initiali/.test(l)) return 'cold_start';
  if (/overload|at capacity|\b529\b/.test(l)) return 'overloaded';
  if (/rate[_\s-]?limit|quota|too many requests|\b429\b/.test(l)) return 'rate_limited';
  if (/\b5(?:0\d|[1-9]\d)\b|5xx|server error|internal server|bad gateway|service unavailable|gateway timeout|non-?2xx|edge function/.test(l)) return 'server_error';
  if (/time[_\s]?out|timed[_\s]?out|deadline|etimedout/.test(l)) return 'timeout';
  if (/unavailable|unreachable|offline|refused|provider_call_failed|could not be routed|not reachable/.test(l)) return 'unavailable';
  return 'none';
}

/** Sanitize an UNRECOGNIZED reason into a short, secret-free, whitelisted clause
 *  safe to fold into copy. Redact -> whitelist -> collapse -> bound. */
function sanitizeReason(reasonRedacted: string): string {
  let s = redact(reasonRedacted);
  s = s.replace(/[^A-Za-z0-9 .,'\-]+/g, ' ');
  s = collapseWs(s).toLowerCase();
  if (!s) return '';
  return capText(s, REASON_FREE_MAX);
}

/** Resolve a reason into { kind, phrase, badge }, folding an unrecognized reason
 *  through the secret-safe sanitizer. */
function resolveReason(reasonRedacted: string): ReasonInfo {
  const lower = collapseWs(reasonRedacted).toLowerCase();
  const kind = classifyReasonKind(lower);
  if (kind === 'none') {
    return { kind, phrase: reasonRedacted ? sanitizeReason(reasonRedacted) : '', badge: null };
  }
  const info = REASON_INFO[kind];
  return { kind, phrase: info.phrase, badge: info.badge };
}

// ---------------------------------------------------------------------------
// Badge finalization
// ---------------------------------------------------------------------------

function finalizeBadges(list: readonly string[]): string[] {
  const out: string[] = [];
  for (const b of list) {
    if (typeof b !== 'string') continue;
    const t = capText(collapseWs(b), BADGE_MAX_LEN);
    if (!t) continue;
    if (out.includes(t)) continue;
    out.push(t);
    if (out.length >= MAX_BADGES) break;
  }
  return out;
}

function neutral(byok: boolean): RouteExplanation {
  return {
    short: byok ? 'Using your own API key' : 'Route details unavailable',
    detail: byok ? 'Billed to your own API key (BYOK).' : '',
    badges: byok ? ['Your key'] : [],
  };
}

// ---------------------------------------------------------------------------
// Main explainer
// ---------------------------------------------------------------------------

/**
 * Explain a routing decision in plain language: a friendly one-liner (`short`),
 * an optional longer `detail`, and short `badges` chips — for a chat route-chip
 * or the OpenSwan console. Every field is bounded and secret-safe. Never throws:
 * hostile / partial / empty input yields a safe neutral explanation.
 *
 * Scenario precedence for `short`:
 *   fallback  ->  BlackSwan+tool-executor swap  ->  Auto-lane escalation  ->
 *   BlackSwan primary  ->  plain model[+provider]  ->  provider-only  ->  neutral.
 */
export function explainRoute(input: RouteExplainInput): RouteExplanation {
  try {
    const src: unknown = input;
    const byok = coerceBool(safeGet(src, 'byok'));

    const modelRaw = redact(coerceStr(safeGet(src, 'model')).trim());
    const providerRaw = coerceStr(safeGet(src, 'provider'));
    const reasonRaw = redact(coerceStr(safeGet(src, 'reason')).trim());
    const fallbackFromRaw = redact(coerceStr(safeGet(src, 'fallbackFrom')).trim());
    const toolExecutorRaw = redact(coerceStr(safeGet(src, 'toolExecutor')).trim());

    const normModel = modelRaw.toLowerCase();
    const normFallback = fallbackFromRaw.toLowerCase();
    const normToolExec = toolExecutorRaw.toLowerCase();

    const modelPretty = prettyModelName(modelRaw);
    const providerPretty = prettyProviderName(providerRaw);
    const fallbackPretty = prettyModelName(fallbackFromRaw);
    const toolExecPretty = prettyModelName(toolExecutorRaw);

    const reason = resolveReason(reasonRaw);
    const reasonPhrase = reason.phrase;
    const reasonBadge = reason.badge;

    const blackswanModel = isBlackSwan(normModel);
    const blackswanFrom = isBlackSwan(normFallback);
    const escalated = reason.kind.startsWith('escalation_');
    const errorReason =
      reason.kind === 'cold_start' ||
      reason.kind === 'not_connected' ||
      reason.kind === 'overloaded' ||
      reason.kind === 'rate_limited' ||
      reason.kind === 'server_error' ||
      reason.kind === 'timeout' ||
      reason.kind === 'unavailable';
    const explicitFailover = /fell\s*back|fail-?over|fall-?back|endpoint_cold|endpoint_not_configured|blackswan_endpoint/i.test(
      reasonRaw,
    );
    const fallback =
      (normFallback !== '' && normFallback !== normModel) || explicitFailover || (errorReason && !escalated);

    const executorSwap =
      blackswanModel &&
      normToolExec !== '' &&
      normToolExec !== normModel &&
      !isBlackSwan(normToolExec) &&
      !fallback;
    const blackswanPrimary = blackswanModel && !executorSwap && !fallback;

    // ── short ────────────────────────────────────────────────────────────────
    let short: string;
    if (fallback) {
      const to = modelPretty || 'a fallback model';
      const via = providerPretty && providerPretty !== to ? ` via ${providerPretty}` : '';
      const because = reasonPhrase ? ` — ${reasonPhrase}` : '';
      short = `Fell back to ${to}${via}${because}`;
    } else if (executorSwap) {
      const exec = toolExecPretty || 'a tool-calling model';
      short = `BlackSwan grounding + ${exec} tool executor`;
    } else if (escalated) {
      const to = modelPretty || 'a frontier model';
      short = `Escalated to ${to}${reasonPhrase ? ` — ${reasonPhrase}` : ''}`;
    } else if (blackswanPrimary) {
      short = 'BlackSwan (app-trained) handled this';
    } else if (modelPretty) {
      short = providerPretty && providerPretty !== modelPretty
        ? `Using ${modelPretty} via ${providerPretty}`
        : `Using ${modelPretty}`;
    } else if (providerPretty) {
      short = `Routed via ${providerPretty}`;
    } else {
      return neutral(byok);
    }
    short = capText(collapseWs(short), SHORT_MAX);

    // ── detail ─────────────────────────────────────────────────────────────
    const parts: string[] = [];
    if (fallback) {
      const to = modelPretty || 'a fallback model';
      const via = providerPretty && providerPretty !== to ? ` via ${providerPretty}` : '';
      const from = fallbackPretty && fallbackPretty !== to ? ` instead of ${fallbackPretty}` : '';
      parts.push(
        reasonPhrase
          ? `${capitalizeFirst(reasonPhrase)}, so this turn was answered by ${to}${via}${from}.`
          : `This turn was answered by ${to}${via}${from}.`,
      );
    } else if (executorSwap) {
      const exec = toolExecPretty || 'a tool-calling model';
      parts.push(
        `BlackSwan stays in the grounding context; a reliable tool-calling model (${exec}) runs the tool loop because BlackSwan-v5 is a small fine-tune without dependable native tool calling.`,
      );
    } else if (escalated) {
      const to = modelPretty ? ` (${modelPretty})` : '';
      parts.push(
        `This turn looked like ${reasonPhrase || 'a hard request'}, so it was routed to a frontier model${to} instead of the app-trained BlackSwan.`,
      );
    } else if (blackswanPrimary) {
      parts.push(
        'BlackSwan-v5 is trained on your Underground Circle app data, so it has the best grounding for app-domain questions.',
      );
    } else if (modelPretty) {
      parts.push(`Served by ${modelPretty}${providerPretty ? ` through ${providerPretty}` : ''}.`);
      if (reasonPhrase) parts.push(`${capitalizeFirst(reasonPhrase)}.`);
    } else if (providerPretty) {
      parts.push(`Routed through ${providerPretty}.`);
    }
    if (byok) parts.push('Billed to your own API key (BYOK).');
    const detail = capText(collapseWs(parts.join(' ')), DETAIL_MAX);

    // ── badges ─────────────────────────────────────────────────────────────
    const rawBadges: string[] = [];
    if (fallback) rawBadges.push('Fallback');
    if (executorSwap) {
      rawBadges.push('BlackSwan', 'Tool executor');
    } else if (blackswanPrimary) {
      rawBadges.push('BlackSwan', 'App-grounded');
    } else if (blackswanModel || blackswanFrom) {
      rawBadges.push('BlackSwan');
    }
    if (reasonBadge) rawBadges.push(reasonBadge);
    if (providerPretty) rawBadges.push(providerPretty);
    if (byok) rawBadges.push('Your key');

    return { short, detail, badges: finalizeBadges(rawBadges) };
  } catch {
    return { short: 'Route details unavailable', detail: '', badges: [] };
  }
}
