// approvalDigestCore — the PURE brain that turns a consequential-action
// descriptor into a bounded, secret-safe, human-readable HITL approval summary
// card. This is what a user sees BEFORE they approve an agent doing something
// with real consequences (paying, deleting, granting access, publishing,
// sending externally, spending money): what will happen, over what scope, at
// what cost, and whether it can be undone.
//
// It answers three questions for the human in the loop:
//   1. WHAT + WHERE — title (actionType on target) + intent + scope lines.
//   2. HOW BAD IF WRONG — a coarse risk tier (low/medium/high) + a reversibility
//      note, so a glance is enough to decide whether to read closely.
//   3. IS IT SAFE TO SHOW — every free-text field runs through a local redactor
//      that masks token-like secrets and strips control / line-separator chars,
//      so an approval card can never leak a credential into the UI/logs.
//
// PURITY: zero imports, tsx-loadable (smoke: approval-digest-core). Fully
// deterministic — no Date.now / Math.random; the caller passes `now` if it ever
// needs one (this core does not). NEVER throws: every field is coerced
// defensively so a malformed/minimal descriptor still yields a valid small card.

// ── Public contract ───────────────────────────────────────────────────────────

export interface ApprovalDigestInput {
  actionType: string;
  target: string;
  humanReadableIntent?: string;
  reversible?: boolean;
  amount?: { value: number; currency: string };
  scope?: string[];
  costUsd?: number;
}

export interface ApprovalDigest {
  title: string;
  lines: string[];
  risk: 'low' | 'medium' | 'high';
  reversibleNote: string;
  text: string;
}

// ── Tunables / bounds ──────────────────────────────────────────────────────────

export const DEFAULT_MAX_LINES = 8;
export const DEFAULT_MAX_LEN = 600;
const MAX_TITLE_LEN = 160;
const MAX_FIELD_LEN = 240; // per free-text field (intent, each scope entry, target in title)
const MAX_SCOPE_ITEMS = 12;
const ELLIPSIS = '…';
const REDACTED = '[REDACTED]';

// actionTypes whose consequences are severe/irreversible by nature.
const HIGH_RISK_ACTIONS = new Set(['pay', 'delete', 'grant', 'login', 'purchase']);
// actionTypes that leave the local boundary but are usually recoverable.
const MEDIUM_RISK_ACTIONS = new Set(['external_send', 'publish', 'send', 'post']);

// ── Small standalone redactor (no shared imports by design) ─────────────────────
// Masks token-like substrings and strips characters that could break a UI line
// or smuggle content. Order matters: mask secrets first, THEN strip separators,
// so a separator embedded inside a token can't split it past the masker.

// Provider/API key prefixes: sk-… (OpenAI/Anthropic), ghp_/gho_/ghu_/ghs_/ghr_
// (GitHub PATs), xoxb-/xoxp- (Slack). Bounded run after the prefix.
const KEY_PREFIX_RE = /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{6,}/g;
const GITHUB_TOKEN_RE = /\bgh[opusr]_[A-Za-z0-9]{16,}/g;
const SLACK_TOKEN_RE = /\bxox[baprs]-[A-Za-z0-9-]{8,}/g;
// JWTs: three base64url segments; the header nearly always starts eyJ… .
const JWT_RE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g;
// "bearer <token>" — mask the whole pair.
const BEARER_RE = /\bbearer\s+[A-Za-z0-9._~+/=-]{6,}/gi;
// Generic long opaque token: a base64/hex-ish run of ≥20 chars. Runs LAST among
// the maskers so the specific patterns above win their shape first.
const LONG_TOKEN_RE = /[A-Za-z0-9+/_-]{20,}/g;

const CONTROL_RE = /[\x00-\x1f\x7f]/g;
// U+2028 LINE SEPARATOR + U+2029 PARAGRAPH SEPARATOR, via escape sequences only
// (never paste the literal chars — they are invisible and corrupt source files).
const LINE_SEP_RE = /[\u2028\u2029]/g;

/** Mask token-like secrets, then strip control + line-separator chars, then
 *  clamp. Deterministic, never throws. Coerces non-strings to ''. */
function redact(raw: unknown, maxLen: number): string {
  let s = typeof raw === 'string' ? raw : '';
  if (!s) return '';
  // Mask most-specific shapes first so a JWT/GitHub token isn't half-eaten by
  // the generic long-token pass.
  s = s.replace(BEARER_RE, REDACTED);
  s = s.replace(JWT_RE, REDACTED);
  s = s.replace(GITHUB_TOKEN_RE, REDACTED);
  s = s.replace(SLACK_TOKEN_RE, REDACTED);
  s = s.replace(KEY_PREFIX_RE, REDACTED);
  s = s.replace(LONG_TOKEN_RE, REDACTED);
  // Strip anything that could break a single logical line or smuggle content.
  s = s.replace(CONTROL_RE, ' ').replace(LINE_SEP_RE, ' ');
  // Collapse runs of whitespace introduced by stripping, and trim.
  s = s.replace(/\s{2,}/g, ' ').trim();
  return clamp(s, maxLen);
}

/** Truncate to maxLen with a trailing ellipsis marker if it overflows. */
function clamp(s: string, maxLen: number): string {
  const limit = Number.isFinite(maxLen) && maxLen > 0 ? Math.floor(maxLen) : DEFAULT_MAX_LEN;
  if (s.length <= limit) return s;
  if (limit <= ELLIPSIS.length) return ELLIPSIS.slice(0, limit);
  return s.slice(0, limit - ELLIPSIS.length) + ELLIPSIS;
}

// ── Risk + reversibility classification ─────────────────────────────────────────

/** Coarse HITL risk tier. High if the action is inherently consequential, or it
 *  is explicitly irreversible, or it moves money (an amount is present). Medium
 *  if it leaves the local boundary. Otherwise low. Never throws. */
export function classifyRisk(input: ApprovalDigestInput): 'low' | 'medium' | 'high' {
  const action = normalizeAction(input?.actionType);
  const hasAmount = isAmount(input?.amount);
  if (HIGH_RISK_ACTIONS.has(action) || input?.reversible === false || hasAmount) return 'high';
  if (MEDIUM_RISK_ACTIONS.has(action)) return 'medium';
  return 'low';
}

/** Human note about undo-ability. */
export function reversibilityNote(reversible: boolean | undefined): string {
  if (reversible === false) return '⚠️ Not reversible';
  if (reversible === true) return 'Reversible';
  return 'Reversibility unknown';
}

// ── Internal coercion helpers ────────────────────────────────────────────────────

function normalizeAction(actionType: unknown): string {
  return typeof actionType === 'string' ? actionType.trim().toLowerCase() : '';
}

function isAmount(amount: unknown): amount is { value: number; currency: string } {
  return (
    !!amount &&
    typeof amount === 'object' &&
    typeof (amount as any).value === 'number' &&
    Number.isFinite((amount as any).value)
  );
}

/** Turn a raw actionType into a readable label: "external_send" -> "External send". */
function labelAction(actionType: unknown): string {
  const raw = typeof actionType === 'string' ? actionType.trim() : '';
  if (!raw) return 'Action';
  const words = raw.replace(/[_\-]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  if (!words) return 'Action';
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Format a number for display without scientific notation or trailing noise. */
function formatNum(n: number): string {
  if (!Number.isFinite(n)) return '0';
  // Keep up to 2 decimals but drop trailing zeros (49.9 -> "49.9", 50 -> "50").
  const rounded = Math.round(n * 100) / 100;
  return String(rounded);
}

function formatCurrency(currency: unknown): string {
  const c = typeof currency === 'string' ? currency.trim().toUpperCase() : '';
  // Only allow a short alpha currency code through; otherwise omit it.
  return /^[A-Z]{2,5}$/.test(c) ? c : '';
}

// ── The card builder ─────────────────────────────────────────────────────────────

/**
 * Build a bounded, secret-safe approval digest from an action descriptor.
 *
 * - `title`: "<Action label>: <redacted target>" (bounded).
 * - `lines`: only the fields that have content — intent, scope (joined), amount,
 *   est. cost, and the reversibility note — clamped to `maxLines`.
 * - `risk`: see {@link classifyRisk}.
 * - `reversibleNote`: see {@link reversibilityNote}.
 * - `text`: `title` + newline-joined `lines`, truncated to `maxLen`.
 *
 * Never throws; a minimal `{ actionType, target }` still yields a valid card.
 */
export function buildApprovalDigest(
  input: ApprovalDigestInput,
  opts?: { maxLines?: number; maxLen?: number },
): ApprovalDigest {
  const safe = (input ?? {}) as ApprovalDigestInput;
  const maxLines =
    opts && Number.isFinite(opts.maxLines as number) && (opts.maxLines as number) > 0
      ? Math.floor(opts.maxLines as number)
      : DEFAULT_MAX_LINES;
  const maxLen =
    opts && Number.isFinite(opts.maxLen as number) && (opts.maxLen as number) > 0
      ? Math.floor(opts.maxLen as number)
      : DEFAULT_MAX_LEN;

  // Title: readable action label + redacted target.
  const actionLabel = labelAction(safe.actionType);
  const redactedTarget = redact(safe.target, MAX_FIELD_LEN);
  const title = clamp(redactedTarget ? `${actionLabel}: ${redactedTarget}` : actionLabel, MAX_TITLE_LEN);

  const risk = classifyRisk(safe);
  const reversibleNote = reversibilityNote(safe.reversible);

  // Assemble candidate lines; only push those with real content.
  const lines: string[] = [];

  const intent = redact(safe.humanReadableIntent, MAX_FIELD_LEN);
  if (intent) lines.push(intent);

  const scopeItems = Array.isArray(safe.scope)
    ? safe.scope
        .slice(0, MAX_SCOPE_ITEMS)
        .map((s) => redact(s, MAX_FIELD_LEN))
        .filter((s) => s.length > 0)
    : [];
  if (scopeItems.length) lines.push(`Scope: ${clamp(scopeItems.join(', '), MAX_FIELD_LEN)}`);

  if (isAmount(safe.amount)) {
    const cur = formatCurrency((safe.amount as any).currency);
    const val = formatNum((safe.amount as any).value);
    lines.push(cur ? `Amount: ${val} ${cur}` : `Amount: ${val}`);
  }

  if (typeof safe.costUsd === 'number' && Number.isFinite(safe.costUsd)) {
    lines.push(`Est. cost: $${formatNum(safe.costUsd)}`);
  }

  // Reversibility is always meaningful for a consequential action → always shown.
  lines.push(reversibleNote);

  // Clamp line count (keep the earliest, most informative lines).
  const clampedLines = lines.slice(0, maxLines);

  const text = clamp([title, ...clampedLines].join('\n'), maxLen);

  return { title, lines: clampedLines, risk, reversibleNote, text };
}
