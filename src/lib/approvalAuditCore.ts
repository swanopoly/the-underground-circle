// approvalAuditCore — the PURE normalizer/formatter that folds the app's TWO
// separate approval tables into ONE bounded, secret-safe audit ledger for the
// Office approvals view.
//
// Human-in-the-loop approvals are recorded in two places with different schemas
// and write paths, and there is no unified read:
//   • agent_run_approvals (agentRunSystem / runApprovalsService) — v2 in-chat
//     HITL gates: { id, approval_kind, title, status, requested_at, resolved_at,
//     requested_by, resolved_by, payload }.
//   • agent_approvals (services/hitlService) — kill-switch / per-agent controls:
//     { id, action_type, description, agent_name, status, requested_at,
//     resolved_at, payload }.
// This core maps both row shapes to one AuditEntry, merges them newest-first,
// counts decisions, and renders a one-line ledger row.
//
// PURITY: zero imports, tsx-loadable (smoke: approval-audit-core).
// `normalizeApprovalRows` and `summarizeApprovalTrail` are fully deterministic.
// `formatAuditEntry` takes an optional `nowMs`; only when a caller omits it does
// it read Date.now() *inside the function body* (never at module scope) as a
// convenience so a single-arg call still renders "3m ago" — the smoke always
// passes an explicit nowMs for determinism.
// NEVER throws: every export coerces hostile / cyclic / huge / wrong-typed input
// to a safe neutral ([] / {…zeros} / "").
// SECRET-SAFE: the `payload` column of BOTH tables is never read; every free-text
// field (title, actor) is masked for token-like secrets and clamped, so a
// credential embedded in a description can't reach the ledger UI or logs.

// ── Public contract ─────────────────────────────────────────────────────────

export type ApprovalDecision = 'approved' | 'rejected' | 'pending' | 'expired';

export interface AuditEntry {
  /** Which table the row came from — 'run' = agent_run_approvals, 'hitl' = agent_approvals. */
  source: 'run' | 'hitl';
  id: string;
  /** Redacted + clamped human label (title / description / humanized kind). */
  title: string;
  decision: ApprovalDecision;
  /** ISO timestamp of the row's current state (resolved_at if resolved, else requested_at). */
  at: string;
  /** Who acted/requested — a user id (run) or agent name (hitl). Omitted when unknown. */
  actor?: string;
  /** Coarse risk hint derived from the approval kind: 'low' | 'medium' | 'high'. */
  risk?: string;
}

// ── Bounds / tunables ───────────────────────────────────────────────────────

/** Hard cap on the ledger size — the newest N survive after the newest-first sort. */
export const MAX_AUDIT_ENTRIES = 200;
const MAX_TITLE_LEN = 160;
const MAX_ACTOR_LEN = 80;
const MAX_ID_LEN = 200;
// Guard a hostile huge array before we sort (real inputs are ≤ dozens of rows).
const PRE_SORT_SCAN_CAP = 5000;
// Guard a hostile huge array in the counter.
const SUMMARY_SCAN_CAP = 100_000;

const ELLIPSIS = '…';
const SEP = ' · '; // " · " — the ledger-row field separator (middot)
const REDACTED = '[REDACTED]';

// ── Standalone redactor (no shared imports by design) ───────────────────────
// Masks token-like substrings, then strips control / line-separator chars.
// Order matters: mask secrets first so a separator inside a token can't split
// it past the masker. FAKE-shape patterns only; never echoes a real secret.

const KEY_PREFIX_RE = /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{6,}/g;
const GITHUB_TOKEN_RE = /\bgh[opusr]_[A-Za-z0-9]{16,}/g;
const SLACK_TOKEN_RE = /\bxox[baprs]-[A-Za-z0-9-]{8,}/g;
const JWT_RE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g;
const BEARER_RE = /\bbearer\s+[A-Za-z0-9._~+/=-]{6,}/gi;
const LONG_TOKEN_RE = /[A-Za-z0-9+/_-]{20,}/g;
const CONTROL_RE = /[\x00-\x1f\x7f]/g;
// U+2028 LINE SEPARATOR + U+2029 PARAGRAPH SEPARATOR (via escapes only).
const LINE_SEP_RE = /[\u2028\u2029]/g;

// A canonical user-id (UUID) is an identifier, not a secret — allow it through
// the actor sanitizer un-masked (the generic long-token masker would otherwise
// blank every user id in the ledger).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Truncate to maxLen with a trailing ellipsis marker if it overflows. */
function clamp(s: string, maxLen: number): string {
  const limit = Number.isFinite(maxLen) && maxLen > 0 ? Math.floor(maxLen) : MAX_TITLE_LEN;
  if (s.length <= limit) return s;
  if (limit <= ELLIPSIS.length) return ELLIPSIS.slice(0, limit);
  return s.slice(0, limit - ELLIPSIS.length) + ELLIPSIS;
}

/** Strip control + line-separator chars, collapse whitespace, trim. */
function stripUnsafe(s: string): string {
  return s
    .replace(CONTROL_RE, ' ')
    .replace(LINE_SEP_RE, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Mask token-like secrets, strip control/line-sep chars, collapse, clamp.
 *  Deterministic, never throws; coerces non-strings to ''. */
function redactClamp(raw: unknown, maxLen: number): string {
  let s = typeof raw === 'string' ? raw : '';
  if (!s) return '';
  // Most-specific shapes first so a JWT/GitHub token isn't half-eaten by the
  // generic long-token pass.
  s = s
    .replace(BEARER_RE, REDACTED)
    .replace(JWT_RE, REDACTED)
    .replace(GITHUB_TOKEN_RE, REDACTED)
    .replace(SLACK_TOKEN_RE, REDACTED)
    .replace(KEY_PREFIX_RE, REDACTED)
    .replace(LONG_TOKEN_RE, REDACTED);
  s = stripUnsafe(s);
  return clamp(s, maxLen);
}

/** Sanitize an actor (user id / agent name). A canonical UUID passes through
 *  un-masked (it's an identifier, not a secret); anything else is fully
 *  redacted so a token smuggled into an agent name can't leak. */
function sanitizeActor(raw: unknown, maxLen: number): string {
  let s = typeof raw === 'string' ? raw : '';
  if (!s) return '';
  s = stripUnsafe(s);
  if (!s) return '';
  if (UUID_RE.test(s)) return clamp(s, maxLen);
  return redactClamp(s, maxLen);
}

/** Coerce an id: string/finite-number only, control-stripped and length-capped. */
function coerceId(v: unknown): string {
  let s = typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
  if (!s) return '';
  s = s.replace(CONTROL_RE, '').replace(LINE_SEP_RE, '').trim();
  return s.length > MAX_ID_LEN ? s.slice(0, MAX_ID_LEN) : s;
}

/** First arg that is a non-empty (trimmed) string. */
function firstNonEmpty(...vals: unknown[]): string {
  for (const v of vals) {
    if (typeof v === 'string') {
      const s = v.trim();
      if (s) return s;
    }
  }
  return '';
}

/** "file_write" -> "File write". Safe on a controlled kind string. */
function humanizeKind(kind: unknown): string {
  const raw = typeof kind === 'string' ? kind.trim() : '';
  if (!raw) return '';
  const words = raw.replace(/[_\-]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  if (!words) return '';
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// ── Decision normalization ──────────────────────────────────────────────────

/** Map a raw status string (either table) onto the four-value decision axis.
 *  Unknown / missing → 'pending' (an undecided gate must never read as approved). */
function normalizeDecision(status: unknown): ApprovalDecision {
  const s = typeof status === 'string' ? status.trim().toLowerCase() : '';
  switch (s) {
    case 'approved':
    case 'auto_approved':
    case 'accepted':
      return 'approved';
    case 'rejected':
    case 'denied':
    case 'declined':
      return 'rejected';
    case 'expired':
    case 'timeout':
    case 'timed_out':
      return 'expired';
    case 'pending':
      return 'pending';
    default:
      return 'pending';
  }
}

/** Coerce an already-typed decision from a hand-built entry; junk → 'pending'. */
function decisionWord(d: unknown): ApprovalDecision {
  return d === 'approved' || d === 'rejected' || d === 'expired' || d === 'pending' ? d : 'pending';
}

// ── Risk classification (from the approval kind only — never from payload) ───

const HIGH_RISK_KINDS = new Set([
  'file_write', 'browser_action', 'cost_threshold', 'privileged_action', 'external_send',
  'pay', 'payment', 'purchase', 'delete', 'grant', 'login', 'transfer',
]);
const MEDIUM_RISK_KINDS = new Set([
  'publish', 'tool_use', 'send', 'post', 'email_send', 'message_send',
]);

function classifyKindRisk(kind: unknown): string {
  const k = typeof kind === 'string' ? kind.trim().toLowerCase() : '';
  if (!k) return 'low';
  if (HIGH_RISK_KINDS.has(k)) return 'high';
  if (MEDIUM_RISK_KINDS.has(k)) return 'medium';
  return 'low';
}

// ── Timestamps ──────────────────────────────────────────────────────────────

/** Validate + return the original ISO string, or '' if unparseable. */
function coerceIso(v: unknown): string {
  if (typeof v !== 'string') return '';
  const s = v.trim();
  if (!s) return '';
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? s : '';
}

/** The row's state timestamp: resolved_at when present/valid, else requested_at. */
function pickAt(resolvedAt: unknown, requestedAt: unknown): string {
  const r = coerceIso(resolvedAt);
  if (r) return r;
  return coerceIso(requestedAt);
}

/** Sort key in ms; an invalid/empty `at` sorts oldest (-Infinity). */
function atMs(at: string): number {
  const ms = Date.parse(at);
  return Number.isFinite(ms) ? ms : -Infinity;
}

// ── Row mappers ─────────────────────────────────────────────────────────────

/** agent_run_approvals row → AuditEntry. Null on non-object / id-less rows. */
function mapRunRow(row: unknown): AuditEntry | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const id = coerceId(r.id);
  if (!id) return null;
  const kind = typeof r.approval_kind === 'string' ? r.approval_kind : '';
  const title = redactClamp(firstNonEmpty(r.title) || humanizeKind(kind), MAX_TITLE_LEN) || 'Approval';
  const actor = sanitizeActor(firstNonEmpty(r.resolved_by, r.requested_by), MAX_ACTOR_LEN);
  const entry: AuditEntry = {
    source: 'run',
    id,
    title,
    decision: normalizeDecision(r.status),
    at: pickAt(r.resolved_at, r.requested_at),
    risk: classifyKindRisk(kind),
  };
  if (actor) entry.actor = actor;
  return entry;
}

/** agent_approvals row → AuditEntry. Null on non-object / id-less rows. */
function mapHitlRow(row: unknown): AuditEntry | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const id = coerceId(r.id);
  if (!id) return null;
  const kind = typeof r.action_type === 'string' ? r.action_type : '';
  const title = redactClamp(firstNonEmpty(r.description) || humanizeKind(kind), MAX_TITLE_LEN) || 'Approval';
  const actor = sanitizeActor(r.agent_name, MAX_ACTOR_LEN);
  const entry: AuditEntry = {
    source: 'hitl',
    id,
    title,
    decision: normalizeDecision(r.status),
    at: pickAt(r.resolved_at, r.requested_at),
    risk: classifyKindRisk(kind),
  };
  if (actor) entry.actor = actor;
  return entry;
}

// ── Public: normalize ───────────────────────────────────────────────────────

/**
 * Merge both approval tables into one unified, newest-first, bounded (≤
 * {@link MAX_AUDIT_ENTRIES}), secret-safe AuditEntry[]. Non-array inputs, junk
 * rows, and rows missing an id are skipped. Never throws.
 */
export function normalizeApprovalRows(runRows: unknown, hitlRows: unknown): AuditEntry[] {
  const out: AuditEntry[] = [];

  const collect = (rows: unknown, mapper: (r: unknown) => AuditEntry | null): void => {
    if (!Array.isArray(rows)) return;
    const cap = Math.min(rows.length, PRE_SORT_SCAN_CAP);
    for (let i = 0; i < cap; i += 1) {
      let entry: AuditEntry | null = null;
      try {
        entry = mapper(rows[i]);
      } catch {
        entry = null;
      }
      if (entry) out.push(entry);
    }
  };

  collect(runRows, mapRunRow);
  collect(hitlRows, mapHitlRow);

  out.sort((a, b) => atMs(b.at) - atMs(a.at)); // newest-first
  return out.length > MAX_AUDIT_ENTRIES ? out.slice(0, MAX_AUDIT_ENTRIES) : out;
}

// ── Public: summarize ───────────────────────────────────────────────────────

/**
 * Count decisions across a trail. `total` counts every object entry; `approved`
 * / `rejected` / `pending` are the named buckets (an 'expired' or unrecognized
 * decision counts toward `total` only). Non-array / junk input → all zeros.
 * Never throws.
 */
export function summarizeApprovalTrail(
  entries: unknown,
): { total: number; approved: number; rejected: number; pending: number } {
  const result = { total: 0, approved: 0, rejected: 0, pending: 0 };
  if (!Array.isArray(entries)) return result;
  const cap = Math.min(entries.length, SUMMARY_SCAN_CAP);
  for (let i = 0; i < cap; i += 1) {
    const e = entries[i];
    if (!e || typeof e !== 'object') continue;
    result.total += 1;
    const decision = (e as AuditEntry).decision;
    if (decision === 'approved') result.approved += 1;
    else if (decision === 'rejected') result.rejected += 1;
    else if (decision === 'pending') result.pending += 1;
    // 'expired' and unrecognized values count toward `total` only.
  }
  return result;
}

// ── Public: format ──────────────────────────────────────────────────────────

/** Relative age like "3m ago" / "just now" / "2h ago" / "4d ago". '' when the
 *  timestamp or now is unusable (caller drops the segment). */
function relativeTime(at: unknown, nowMs: number): string {
  if (typeof at !== 'string') return '';
  const t = Date.parse(at);
  if (!Number.isFinite(t) || !Number.isFinite(nowMs)) return '';
  let diff = nowMs - t;
  if (diff < 0) diff = 0; // a future timestamp reads as "just now"
  if (diff < 60_000) return 'just now';
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(diff / 3_600_000);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(diff / 86_400_000);
  if (day < 7) return `${day}d ago`;
  const wk = Math.floor(diff / 604_800_000);
  if (wk < 5) return `${wk}w ago`;
  const mo = Math.floor(diff / 2_592_000_000);
  if (mo < 12) return `${mo}mo ago`;
  const yr = Math.floor(diff / 31_536_000_000);
  return `${yr}y ago`;
}

/**
 * Render one ledger row: `"<decision> · <title> · <relative age>"`, e.g.
 * `"approved · Publish blog post · 3m ago"`. Empty segments are dropped, so a
 * missing title or unusable timestamp shortens the row rather than breaking it.
 *
 * `nowMs` is optional: pass it for deterministic output (tests, or a single
 * clock read shared across a whole ledger). When omitted, Date.now() is read
 * inside this call as a convenience — never at module scope.
 *
 * Re-redacts + re-clamps the title so a hand-built entry can't leak a token.
 * Never throws; a non-object entry → ''.
 */
export function formatAuditEntry(e: AuditEntry, nowMs?: number): string {
  if (!e || typeof e !== 'object') return '';
  const decision = decisionWord((e as AuditEntry).decision);
  const title = redactClamp((e as AuditEntry).title, MAX_TITLE_LEN);
  const now = typeof nowMs === 'number' && Number.isFinite(nowMs) ? nowMs : Date.now();
  const rel = relativeTime((e as AuditEntry).at, now);

  const parts: string[] = [decision];
  if (title) parts.push(title);
  if (rel) parts.push(rel);
  return parts.join(SEP);
}
