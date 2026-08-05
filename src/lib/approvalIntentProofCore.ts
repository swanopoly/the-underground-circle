// approvalIntentProofCore — the PURE "write/spend approval boundary" brain: an
// injection-resistant descriptor for a consequential action (pay/delete/grant/…)
// bound to a stable scope hash, plus verification that a human's resolution
// actually matches THAT action. This is the anti-replay / proof-of-intent gate:
// a stale or injected approval carrying a mismatched scope hash can never be
// replayed to authorize a *different* action.
//
// PURITY: zero imports, tsx-loadable (smoke: approval-intent-proof-core). Every
// time-sensitive function takes `now` (epoch ms) from the caller so it stays
// deterministic; it never reads the clock or a RNG. Never throws.
//
// The scope hash is a dependency-free change-detection hash (FNV-1a(32) +
// djb2(32) + length), NOT a cryptographic MAC — it detects a scope *mismatch*
// (wrong action/target/amount), it does not by itself prove authenticity. The
// runtime is responsible for signing/authenticating the resolution channel.

export const MAX_INTENT_LEN = 500;

export type ConsequentialActionType =
  | 'pay'
  | 'delete'
  | 'login'
  | 'grant'
  | 'external_send'
  | 'publish'
  | 'purchase'
  | 'file_write'
  | 'other';

export interface ApprovalIntent {
  actionType: ConsequentialActionType;
  /** What the action operates on (e.g. an account id, url, path). */
  target: string;
  /** Sanitized, bounded human-readable description of the action. */
  humanReadableIntent: string;
  /** Whether the action can be undone (defaults false — assume worst case). */
  reversible: boolean;
  /** Stable hash binding actionType + target + amount (the anti-replay key). */
  scopeHash: string;
  /** Optional money amount for pay/purchase-style actions. */
  amount?: { value: number; currency: string };
  createdAt: number;
}

export interface ApprovalResolution {
  /** Must equal the intent's scopeHash for the resolution to apply. */
  scopeHash: string;
  decision: 'approve' | 'reject';
  resolvedAt: number;
  resolvedBy: string;
}

// ── Hashing (dependency-free, change-detection grade — NOT cryptographic) ─────
// FNV-1a(32) + djb2(32) + length → 16 hex chars + length. Any change to the
// hashed string changes the hash; collisions are astronomically unlikely here.
function hashString(text: unknown): string {
  const s = typeof text === 'string' ? text : String(text ?? '');
  let h1 = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < s.length; i += 1) {
    h1 ^= s.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193);
  }
  let h2 = 5381; // djb2
  for (let i = 0; i < s.length; i += 1) {
    h2 = (Math.imul(h2, 33) ^ s.charCodeAt(i)) | 0;
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
  return `${hex(h1)}${hex(h2)}-${s.length}`;
}

/** Normalize a numeric amount (finite → itself; else 0). */
function normalizeAmountValue(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/**
 * Sanitize human-readable text so an injected approval prompt can't smuggle
 * line/paragraph separators or control chars into the persisted intent, and so
 * the description stays bounded. Strips ASCII control chars plus the Unicode
 * line/paragraph separators, collapses runs of whitespace, then clamps length.
 */
export function sanitizeIntentText(raw: unknown, maxLen: number = MAX_INTENT_LEN): string {
  let s = typeof raw === 'string' ? raw : String(raw ?? '');
  // Strip ASCII control chars (C0 + DEL).
  s = s.replace(/[\x00-\x1f\x7f]/g, ' ');
  // Strip Unicode LINE SEPARATOR (U+2028) and PARAGRAPH SEPARATOR (U+2029).
  s = s.replace(/[\u2028\u2029]/g, ' ');
  // Collapse whitespace runs and trim.
  s = s.replace(/\s+/g, ' ').trim();
  const limit = typeof maxLen === 'number' && Number.isFinite(maxLen) && maxLen > 0 ? Math.floor(maxLen) : MAX_INTENT_LEN;
  if (s.length > limit) s = s.slice(0, limit);
  return s;
}

/**
 * Stable, dependency-free scope hash. Normalizes actionType + target (trim +
 * lowercase) and folds in the amount value + currency. Changing actionType,
 * target, or amount MUST change the resulting hash — that is what makes an
 * approval for one action un-replayable against another.
 */
export function computeScopeHash(fields: {
  actionType: string;
  target: string;
  amount?: { value: number; currency: string };
}): string {
  const f = (fields ?? {}) as { actionType?: unknown; target?: unknown; amount?: { value?: unknown; currency?: unknown } };
  const actionType = (typeof f.actionType === 'string' ? f.actionType : String(f.actionType ?? '')).trim().toLowerCase();
  const target = (typeof f.target === 'string' ? f.target : String(f.target ?? '')).trim().toLowerCase();
  let amountPart = 'none';
  if (f.amount && typeof f.amount === 'object') {
    const value = normalizeAmountValue(f.amount.value);
    const currency = (typeof f.amount.currency === 'string' ? f.amount.currency : String(f.amount.currency ?? '')).trim().toLowerCase();
    amountPart = `${value}|${currency}`;
  }
  // Field-separated canonical string so distinct fields can't collide by
  // concatenation (e.g. target "ab"+"c" vs "a"+"bc").
  const canonical = `v1${actionType}${target}${amountPart}`;
  return hashString(canonical);
}

/** True for every consequential action type except the catch-all 'other'. */
export function isConsequential(actionType: ConsequentialActionType): boolean {
  return actionType !== 'other';
}

const KNOWN_ACTION_TYPES: ReadonlyArray<ConsequentialActionType> = [
  'pay',
  'delete',
  'login',
  'grant',
  'external_send',
  'publish',
  'purchase',
  'file_write',
  'other',
];

function coerceActionType(raw: unknown): ConsequentialActionType {
  const s = (typeof raw === 'string' ? raw : '').trim().toLowerCase();
  return (KNOWN_ACTION_TYPES as ReadonlyArray<string>).includes(s) ? (s as ConsequentialActionType) : 'other';
}

/**
 * Build a sealed ApprovalIntent from caller input. Sanitizes the human-readable
 * text, defaults `reversible` to false (assume irreversible unless told), binds
 * the scope hash, and stamps createdAt from the caller-supplied `now`. Never
 * throws — malformed input is coerced to safe defaults.
 */
export function buildApprovalIntent(
  input: {
    actionType: ConsequentialActionType;
    target: string;
    humanReadableIntent: string;
    reversible?: boolean;
    amount?: { value: number; currency: string };
  },
  now: number,
): ApprovalIntent {
  const src = (input ?? {}) as {
    actionType?: unknown;
    target?: unknown;
    humanReadableIntent?: unknown;
    reversible?: unknown;
    amount?: { value?: unknown; currency?: unknown };
  };
  const actionType = coerceActionType(src.actionType);
  const target = (typeof src.target === 'string' ? src.target : String(src.target ?? '')).trim();

  let amount: { value: number; currency: string } | undefined;
  if (src.amount && typeof src.amount === 'object') {
    amount = {
      value: normalizeAmountValue(src.amount.value),
      currency: (typeof src.amount.currency === 'string' ? src.amount.currency : String(src.amount.currency ?? '')).trim(),
    };
  }

  const createdAt = typeof now === 'number' && Number.isFinite(now) ? now : 0;

  const intent: ApprovalIntent = {
    actionType,
    target,
    humanReadableIntent: sanitizeIntentText(src.humanReadableIntent),
    reversible: src.reversible === true,
    scopeHash: computeScopeHash({ actionType, target, amount }),
    createdAt,
  };
  if (amount) intent.amount = amount;
  return intent;
}

export interface VerifyResult {
  valid: boolean;
  reason: string;
}

/**
 * Verify that a human resolution actually authorizes THIS intent. Valid ONLY
 * when the resolution's scopeHash matches the intent's scopeHash (proof the
 * human saw this exact action, not a swapped one), the decision is 'approve',
 * and — if a maxAgeMs window is given — the intent has not expired. Any other
 * case fails closed with a human-readable reason. Never throws.
 *
 * Failure reasons: 'rejected' (explicit reject), 'scope mismatch (possible
 * replay)' (a resolution built for a different action), 'expired' (past the
 * freshness window), plus defensive reasons for malformed input.
 */
export function verifyResolution(
  intent: ApprovalIntent,
  resolution: ApprovalResolution,
  opts?: { now?: number; maxAgeMs?: number },
): VerifyResult {
  if (!intent || typeof intent !== 'object') {
    return { valid: false, reason: 'missing intent' };
  }
  if (!resolution || typeof resolution !== 'object') {
    return { valid: false, reason: 'missing resolution' };
  }

  const intentScope = typeof intent.scopeHash === 'string' ? intent.scopeHash : '';
  const resolutionScope = typeof resolution.scopeHash === 'string' ? resolution.scopeHash : '';

  // Scope binding is checked FIRST: an approval whose scope hash matches a
  // different action must be rejected before we ever honor its decision.
  if (!intentScope || !resolutionScope || intentScope !== resolutionScope) {
    return { valid: false, reason: 'scope mismatch (possible replay)' };
  }

  if (resolution.decision !== 'approve') {
    return { valid: false, reason: resolution.decision === 'reject' ? 'rejected' : 'no approval decision' };
  }

  const maxAgeMs = opts && typeof opts.maxAgeMs === 'number' && Number.isFinite(opts.maxAgeMs) ? opts.maxAgeMs : undefined;
  if (maxAgeMs !== undefined) {
    const now = opts && typeof opts.now === 'number' && Number.isFinite(opts.now) ? opts.now : undefined;
    if (now === undefined) {
      return { valid: false, reason: 'now required to enforce maxAgeMs' };
    }
    const createdAt = typeof intent.createdAt === 'number' && Number.isFinite(intent.createdAt) ? intent.createdAt : 0;
    if (now - createdAt > maxAgeMs) {
      return { valid: false, reason: 'expired' };
    }
  }

  return { valid: true, reason: 'approved for this exact action' };
}
