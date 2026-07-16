/**
 * transportFailoverBadgeCore — the render seam for CHAT_OFFICE_FEED_NEXT_GAPS
 * Finding 3: "Provider/transport failover is computed and logged, but invisible
 * to the user in the primary lane."
 *
 * The app already knows when a turn landed on a fallback provider/transport —
 * `chatLaneOutcome.ts` carries `servedBy.fallback` as a first-class
 * "never silent" field (`ChatLaneServedBy` at chatLaneOutcome.ts:110-116) — but
 * that signal is recorded as telemetry only and rendered to the user in exactly
 * one narrow path (the web-search note). A silent provider switch changes model
 * quality, cost, and latency with no signal, which reads as "the bot got
 * dumber/slower for no reason." BlackSwan failover is already made visible
 * (swanbot.ts:3794-3811 prepends a user notice); general marketplace /
 * cross-provider failover has no equivalent surface. This core is that surface.
 *
 * Two pure formatters (the compose is SAFE; the ChatTab render point and the
 * `persistedChatMetadata` merge are the caller's job):
 *
 *   - `buildFailoverBadge(servedBy)` → a compact, non-alarming turn chip when the
 *     turn was served by a FALLBACK ('via OpenRouter (Anthropic 529)'), or `null`
 *     when the turn was served normally (no noise — the whole point is quiet).
 *   - `failoverMetadataPatch(servedBy)` → the tiny, bounded object to spread into
 *     assistant message metadata so the Feed/Office run cards can show the same
 *     route later; `{}` (a no-op merge) when there was no fallback.
 *   - `readFailoverBadgeFromMetadata(metadata)` → rebuild the identical badge from
 *     a persisted row (untrusted after round-trip — re-validated + re-redacted).
 *
 * Grounding (verified against real files):
 *   - `ChatLaneServedBy` — `{ model?, transport?, fallback?, fallbackReason? }`
 *     (chatLaneOutcome.ts:110-116). `normalizeStructuredResponse` builds
 *     `transport = routing.provider_routed`, `model = routing.provider_model`,
 *     and `fallbackReason = \`${fallback.provider}: ${fallback.reason}\``
 *     (chatLaneOutcome.ts:309-331) — the "anthropic: 529" shape this core
 *     prettifies to "Anthropic 529".
 *   - Persisted assistant metadata is a bounded, per-field-clamped record
 *     (persistedChatMetadata.ts) — this patch matches that discipline.
 *
 * PURITY: zero imports (tsx-loadable). No Date.now()/Math.random(). Every export
 * is TOTAL — hostile input (null/undefined/wrong-type/huge/cyclic/hostile)
 * returns a safe neutral (`null` / `{}`) instead of throwing. Bounded (every
 * emitted string is clamped). Secret-safe (every model-visible / persisted string
 * runs the redactor first, so a key/token that leaked into a reason never reaches
 * a chip or a DB row).
 */

// ─── Public shape ───────────────────────────────────────────────────────────

export type FailoverBadgeTone = 'info' | 'warn';

export interface FailoverBadge {
  /** Always true when a badge object is returned — the caller shows it. The
   *  `| null` return already encodes "do not show"; this field lets a render
   *  seam keep the object around and toggle visibility explicitly. */
  show: boolean;
  /** Compact chip text, e.g. 'via OpenRouter (Anthropic 529)'. Bounded. */
  label: string;
  /** 'warn' when the reason signals the primary provider hard-FAILED
   *  (error/overload/rate-limit/timeout/auth/quota); 'info' for a benign or
   *  unexplained reroute. Lets the render seam style a degradation vs a
   *  soft reroute. */
  tone: FailoverBadgeTone;
  /** Longer, still-bounded explanation for a tooltip / expandable. */
  detail: string;
}

// ─── Bounds (every emitted string is clamped) ───────────────────────────────

const MAX_LABEL_CHARS = 72;
const MAX_DETAIL_CHARS = 220;
const MAX_REASON_CHARS = 56;
const MAX_WHO_CHARS = 40;
const MAX_MODEL_CHARS = 80;
const MAX_TRANSPORT_CHARS = 48;
const MAX_META_REASON_CHARS = 120;

// ─── Provider display labels (aliases normalized: hugging_face→huggingface,
//     z_ai→zai, github_models→github-models — mirrors CLAUDE.md provider set) ──

const PROVIDER_LABELS: Record<string, string> = {
  openrouter: 'OpenRouter',
  anthropic: 'Anthropic',
  'anthropic-direct': 'Anthropic',
  openai: 'OpenAI',
  openai_compatible: 'OpenAI-compatible',
  google: 'Google',
  google_ai: 'Google AI',
  groq: 'Groq',
  mistral_ai: 'Mistral AI',
  cohere: 'Cohere',
  perplexity: 'Perplexity',
  together_ai: 'Together AI',
  fireworks_ai: 'Fireworks AI',
  deepseek: 'DeepSeek',
  zai: 'z.ai',
  z_ai: 'z.ai',
  minimax: 'MiniMax',
  ollama: 'Ollama',
  'github-models': 'GitHub Models',
  github_models: 'GitHub Models',
  huggingface: 'Hugging Face',
  hugging_face: 'Hugging Face',
  huggingface_endpoint: 'Hugging Face',
  huggingface_task: 'Hugging Face',
  replicate: 'Replicate',
  openswan: 'OpenSwan',
  swanbot: 'SwanBot',
  blackswan: 'BlackSwan',
  brave: 'Brave Search',
  brave_search: 'Brave Search',
  'chat-stream': 'streaming',
  browserbase: 'Browserbase',
  stagehand: 'Stagehand',
};

// ─── Secret redaction (secret-safe: a token that leaked into a reason must
//     never reach a chip or a DB row). Conservative — pinned to token shapes,
//     so short app reasons like "anthropic: 529" pass through untouched. ──────

// Known key/token prefixes (OpenAI, Anthropic, GitHub, Slack, AWS, HF, Bearer).
const SECRET_PREFIX_RE = /(?:sk-ant-[A-Za-z0-9_-]{6,}|sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{16,}|gho_[A-Za-z0-9]{16,}|ghs_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}|xox[baprs]-[A-Za-z0-9-]{8,}|AKIA[0-9A-Z]{12,}|ASIA[0-9A-Z]{12,}|hf_[A-Za-z0-9]{12,}|Bearer\s+[A-Za-z0-9._-]{8,})/g;
// Explicit assignments: keep the label, redact the value.
const SECRET_ASSIGN_RE = /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|secret|password|passwd|authorization|auth[_-]?token|bearer|apikey|token)\b\s*[:=]\s*['"]?[A-Za-z0-9._\-+/]{6,}['"]?/gi;
// Any long contiguous alphanumeric run (32+) — a hash/base64/hex secret. Model
// ids, UUIDs, and words all carry separators, so this only catches raw tokens.
const LONG_TOKEN_RE = /[A-Za-z0-9]{32,}/g;

function redactSecrets(text: string): string {
  // `.replace` resets a global regex's lastIndex on each call, so reusing these
  // module-level constants is safe (no cross-call state).
  return text
    .replace(SECRET_PREFIX_RE, '[redacted]')
    .replace(SECRET_ASSIGN_RE, '$1: [redacted]')
    .replace(LONG_TOKEN_RE, '[redacted]');
}

// ─── Total helpers ──────────────────────────────────────────────────────────

/** Object guard that rejects null, arrays, and primitives. Never traverses,
 *  so a cyclic input is read only at the top level (cycle-safe). */
function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** The fallback gate. Canonical signal is boolean `true`; string/number forms
 *  are accepted defensively so an untrusted round-tripped row still fires. */
function isFallbackFlag(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

/** Collapse whitespace → redact secrets → clip. Non-strings → ''. */
function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  let text = value.replace(/\s+/g, ' ').trim();
  if (!text) return '';
  text = redactSecrets(text).replace(/\s+/g, ' ').trim();
  return clip(text, max);
}

function titleCase(token: string): string {
  return token
    .replace(/[_\-./]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1) : ''))
    .join(' ');
}

/** A single provider/transport token → a display label. Known ids use the map;
 *  anything else is title-cased. Bounded. */
function prettifyProvider(tokenRaw: unknown): string {
  const cleaned = cleanText(tokenRaw, MAX_WHO_CHARS);
  if (!cleaned) return '';
  const key = cleaned.toLowerCase();
  const mapped = PROVIDER_LABELS[key];
  if (mapped) return mapped;
  // For a slash path ("anthropic/claude-…") prefer the first segment's label.
  const head = key.split('/')[0];
  if (head && head !== key) {
    const headMapped = PROVIDER_LABELS[head];
    if (headMapped) return headMapped;
  }
  return clip(titleCase(cleaned), MAX_WHO_CHARS);
}

/** Who served the turn: the transport if present, else the served model's
 *  provider prefix (only when it's a KNOWN provider — never title-case a whole
 *  model id as "who"). '' when neither yields a clear provider. */
function deriveWho(rec: Record<string, unknown>): string {
  if (typeof rec.transport === 'string' && rec.transport.trim()) {
    return prettifyProvider(rec.transport);
  }
  if (typeof rec.model === 'string' && rec.model.trim()) {
    const prefix = rec.model.trim().split('/')[0];
    if (prefix && PROVIDER_LABELS[prefix.toLowerCase()]) return prettifyProvider(prefix);
  }
  return '';
}

/** Prettify the reason. The app's real shape is "provider: detail"
 *  ("anthropic: 529"), which becomes "Anthropic 529"; any other reason passes
 *  through redacted + clipped. */
function prettifyReason(rawReason: unknown): string {
  const reason = cleanText(rawReason, MAX_REASON_CHARS + 32);
  if (!reason) return '';
  const match = reason.match(/^([a-z0-9][a-z0-9_-]{1,30}):\s*(.+)$/i);
  if (match) {
    const label = PROVIDER_LABELS[match[1].toLowerCase()];
    if (label) return clip(`${label} ${match[2]}`.replace(/\s+/g, ' ').trim(), MAX_REASON_CHARS);
  }
  return clip(reason, MAX_REASON_CHARS);
}

// Non-global (safe for `.test`): the reason signals a hard provider failure.
const HARD_FAIL_RE = /(?:\b5\d\d\b|\b429\b|\b529\b|\b40[1359]\b|overload|rate.?limit|throttl|timed?.?out|timeout|deadline|unavailable|outage|\bdown\b|capacity|exhaust|quota|billing|\berror\b|\bfailed?\b|refus|too many|not connected|missing)/i;

function toneForReason(rawReason: unknown): FailoverBadgeTone {
  if (typeof rawReason !== 'string' || !rawReason.trim()) return 'info';
  return HARD_FAIL_RE.test(rawReason) ? 'warn' : 'info';
}

function rawReasonOf(rec: Record<string, unknown>): string {
  if (typeof rec.fallbackReason === 'string') return rec.fallbackReason;
  if (typeof rec.reason === 'string') return rec.reason;
  return '';
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Compose the visible failover chip from a `chatLaneOutcome.servedBy`.
 * Returns `null` for a normal turn (no fallback → no noise); a compact
 * `FailoverBadge` when the turn landed on a fallback provider/transport.
 * Total, bounded, secret-safe.
 */
export function buildFailoverBadge(servedBy: unknown): FailoverBadge | null {
  const rec = asRecord(servedBy);
  if (!rec || !isFallbackFlag(rec.fallback)) return null;

  const who = deriveWho(rec);
  const rawReason = rawReasonOf(rec);
  const reason = prettifyReason(rawReason);
  const tone = toneForReason(rawReason);

  let label: string;
  if (who && reason) label = `via ${who} (${reason})`;
  else if (who) label = `via ${who}`;
  else if (reason) label = `Fell back — ${reason}`;
  else label = 'Served by a fallback route';
  label = clip(label, MAX_LABEL_CHARS);

  const detailWho = who || 'a fallback route';
  const detail = clip(
    reason
      ? `Served by ${detailWho} instead of your selected route (${reason}). Model quality, cost, and latency may differ.`
      : `Served by ${detailWho} instead of your selected route. Model quality, cost, and latency may differ.`,
    MAX_DETAIL_CHARS,
  );

  return { show: true, label, tone, detail };
}

/**
 * The compact, bounded object to spread into persisted assistant message
 * metadata (`persistedChatMetadata`) so the Feed/Office run cards can render the
 * same route later. Namespaced under `failover` so it merges cleanly; `{}` (a
 * no-op) when there was no fallback. Every persisted string is redacted +
 * clamped.
 */
export function failoverMetadataPatch(servedBy: unknown): Record<string, unknown> {
  const rec = asRecord(servedBy);
  if (!rec || !isFallbackFlag(rec.fallback)) return {};
  const badge = buildFailoverBadge(rec);
  if (!badge) return {};

  const failover: Record<string, unknown> = {
    fallback: true,
    label: badge.label,
    tone: badge.tone,
  };
  const model = cleanText(rec.model, MAX_MODEL_CHARS);
  const transport = cleanText(rec.transport, MAX_TRANSPORT_CHARS);
  const reason = cleanText(rawReasonOf(rec), MAX_META_REASON_CHARS);
  if (model) failover.model = model;
  if (transport) failover.transport = transport;
  if (reason) failover.reason = reason;

  return { failover };
}

/**
 * Rebuild the failover badge from a persisted metadata row (or the inner patch
 * object directly). The row is untrusted after a round-trip, so this
 * re-validates and re-redacts by reconstructing a `servedBy` and running the
 * same `buildFailoverBadge` path — the read badge is byte-identical to the live
 * one. `null` when the row carries no fallback.
 */
export function readFailoverBadgeFromMetadata(metadata: unknown): FailoverBadge | null {
  const rec = asRecord(metadata);
  if (!rec) return null;
  const inner = asRecord(rec.failover) || (isFallbackFlag(rec.fallback) ? rec : null);
  if (!inner || !isFallbackFlag(inner.fallback)) return null;
  return buildFailoverBadge({
    fallback: true,
    model: typeof inner.model === 'string' ? inner.model : null,
    transport: typeof inner.transport === 'string' ? inner.transport : null,
    fallbackReason: typeof inner.reason === 'string' ? inner.reason : null,
  });
}
