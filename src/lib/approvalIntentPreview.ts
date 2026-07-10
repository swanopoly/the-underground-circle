/**
 * approvalIntentPreview — the verified 2025-26 "Intent Preview" trust pattern
 * for HITL approvals.
 *
 * Background (docs/APP_BRANDING_DESIGN_REVIEW.md §4): the strongest verified
 * 2025-26 trust patterns for agent actions are Intent Preview approvals
 * (plain-language WHAT / WHY / RISK + Proceed / Edit / I'll-do-it-myself —
 * never a bare approve/deny) and risk-tier chips (read / reversible / external
 * / irreversible, which map 1:1 to the app's existing approval floors).
 * OpenAI's Operator system card reports that pre-action confirmations cut
 * risky-action risk by ~90%; this module turns a raw approval row into the
 * structured preview a confirmation UI needs to earn that.
 *
 * This file is PURE (type-only imports) so it can be unit-smoked under tsx
 * without loading react-native, and reused from the banner, chat handoff
 * metadata, or any future surface without duplicating copy.
 *
 * SECURITY: intent/scope text is derived from an untrusted payload. Every
 * string that could carry a raw secret is scrubbed with the same key/value
 * heuristics the run-ledger uses, and known-credential fields are dropped
 * entirely. A raw token, password, api key, cookie, or bearer value must
 * NEVER appear in any field this module returns.
 */

import type { ComputerTaskApprovalRisk } from './computerTaskEvidenceContract';

// ─── Risk tiers ──────────────────────────────────────────────────────────────

/**
 * The four-tier approval vocabulary from the branding review. Maps 1:1 to the
 * app's existing floors:
 *   read         → observation only, no side effect
 *   reversible   → a mutation that can be undone (edit/create/update/write)
 *   external     → reaches outside the workspace (publish/send/submit/upload/login)
 *   irreversible → cannot be cleanly undone (pay/delete/deploy/grant)
 */
export type ApprovalRiskTier = 'read' | 'reversible' | 'external' | 'irreversible';

const RISK_TIERS: readonly ApprovalRiskTier[] = ['read', 'reversible', 'external', 'irreversible'];

export type ApprovalRiskChipTone = 'green' | 'blue' | 'amber' | 'red';

export interface ApprovalRiskChip {
  label: string;
  tone: ApprovalRiskChipTone;
}

/** The three-choice lane. Proceed = approve; Edit = revise & resend; Self = I'll do it myself. */
export type ApprovalChoice = 'proceed' | 'edit' | 'self';

export interface ApprovalIntentPreview {
  /** Plain-language WHAT — e.g. "Will publish a post to acme.com/blog". */
  intentLine: string;
  /** Coarse risk tier for the whole approval. */
  riskTier: ApprovalRiskTier;
  /** The chip to render for that tier. */
  riskChip: ApprovalRiskChip;
  /** Up to 3 bounded, secret-stripped facts about the action's scope. */
  scopeLines: string[];
  /** Which of the three lanes to offer, most-affirmative first. */
  choices: ApprovalChoice[];
}

/** The abstract approval shape this module reads — a superset of what callers hold. */
export interface ApprovalIntentInput {
  action_type?: string | null;
  reason?: string | null;
  payload?: unknown;
  /** Optional caller-supplied tier; wins over derivation when it is a valid tier. */
  riskTier?: string | null;
}

// ─── Secret scrubbing (mirrors agentRunLedgerPersistence) ─────────────────────

/**
 * Key names whose VALUES are secret and must never be surfaced, and value
 * shapes that look like live credentials wherever they appear. Kept in lockstep
 * with `agentRunLedgerPersistence.ts` so the two redaction policies can't drift.
 */
const SECRET_KEY_RE =
  /(password|passwd|passcode|secret|token|api[_-]?key|apikey|authorization|auth|bearer|cookie|credential|private[_-]?key|refresh[_-]?token|access[_-]?token|client[_-]?secret|session[_-]?key|otp|mfa|totp|pin)/i;
const SECRET_VALUE_RE =
  /\b(sk-(?:ant|proj|or|live|test)?[-_a-zA-Z0-9]{12,}|Bearer\s+[-_a-zA-Z0-9.]{12,}|xox[baprs]-[-_a-zA-Z0-9]{12,}|gh[posru]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{12,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{4,})\b/g;

/** Redact live-credential-shaped substrings from a value that is otherwise safe to show. */
function scrubSecretValues(text: string): string {
  return String(text || '').replace(SECRET_VALUE_RE, '[redacted]');
}

/** True when a key name indicates its value is a secret we must never print. */
export function isSecretKeyName(key: string): boolean {
  return SECRET_KEY_RE.test(String(key || ''));
}

/** Collapse whitespace, scrub secret-shaped substrings, and hard-cap length. */
function cleanFact(value: unknown, max = 80): string {
  const raw = typeof value === 'string' ? value : value == null ? '' : String(value);
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  const scrubbed = scrubSecretValues(collapsed);
  if (scrubbed.length <= max) return scrubbed;
  return scrubbed.slice(0, max - 1).trimEnd() + '…';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** First non-empty payload value among the given key names, secret keys skipped. */
function pickString(payload: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    if (isSecretKeyName(key)) continue;
    const v = payload[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return null;
}

/** Host from a URL string, tolerating garbage; null when unparseable/absent. */
function hostFromUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).host || null;
  } catch {
    // Best-effort: strip scheme + path so "acme.com/blog" style inputs still read well.
    const m = String(url).replace(/^[a-z]+:\/\//i, '').split(/[\/?#]/)[0];
    return m && /[.]/.test(m) ? m : null;
  }
}

/** Host + first path segment ("acme.com/blog"), for a compact target string. */
function hostAndPath(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const seg = u.pathname && u.pathname !== '/' ? u.pathname : '';
    return `${u.host}${seg}`.replace(/\/$/, '') || u.host || null;
  } catch {
    return hostFromUrl(url);
  }
}

// ─── Risk tiering ────────────────────────────────────────────────────────────

/**
 * Verb anchors per tier, checked most-severe first so "delete" wins over a
 * generic "update", and money/destructive/irrevocable actions land at
 * 'irreversible'. Matches both action_type identifiers (`wp.publish_post`,
 * `payments.charge`) and free-text reasons ("publish a post publicly").
 */
const IRREVERSIBLE_RE =
  /\b(pay|payment|purchase|buy|checkout|charge|send[_-]?money|wire|transfer[_-]?funds|delete|destroy|wipe|erase|drop|trash|remove|revoke|grant|deploy|go[_-]?live|release|irreversible|terminate|shutdown)\b/i;
const EXTERNAL_RE =
  /\b(publish|post|send|submit|share|invite|email|message|dm|upload|export|push|checkout|login|log[_-]?in|sign[_-]?in|authenticate|purchase|order|book|reserve|external)\b/i;
const REVERSIBLE_RE =
  /\b(edit|modify|change|update|create|insert|add|write|fill|type|set|rename|move|copy|draft|save|stage|patch)\b/i;
const READ_RE =
  /\b(read|list|get|fetch|view|inspect|search|find|scan|observe|screenshot|snapshot|status|preview|describe|check|show)\b/i;

/**
 * Normalize an identifier or free-text string so verb anchors match: split
 * `namespace.verb_object`, kebab, and camelCase into space-separated words so
 * `\bpublish\b` fires on `wp.publish_post` (an underscore is a word char, so
 * without this the boundary between `publish` and `_post` never exists).
 */
function tokenizeForTier(text: string): string {
  return String(text || '')
    .replace(/[._-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}

function tierFromText(text: string): ApprovalRiskTier | null {
  const t = tokenizeForTier(text);
  if (!t.trim()) return null;
  if (IRREVERSIBLE_RE.test(t)) return 'irreversible';
  if (EXTERNAL_RE.test(t)) return 'external';
  if (REVERSIBLE_RE.test(t)) return 'reversible';
  if (READ_RE.test(t)) return 'read';
  return null;
}

/**
 * Bridge the evidence-contract's low/medium/high/critical vocabulary into the
 * four-tier UI vocabulary, so both stay coherent. This mirrors
 * `classifyApprovalReasonRisk` WITHOUT importing it (that module pulls a wide
 * dependency graph unsafe for the pure smoke); the tier order is identical.
 */
export function tierFromComputerTaskRisk(risk: ComputerTaskApprovalRisk): ApprovalRiskTier {
  switch (risk) {
    case 'critical':
      return 'irreversible';
    case 'high':
      return 'external';
    case 'medium':
      return 'reversible';
    case 'low':
    default:
      return 'read';
  }
}

function normalizeTier(value: string | null | undefined): ApprovalRiskTier | null {
  const v = String(value || '').trim().toLowerCase();
  if ((RISK_TIERS as readonly string[]).includes(v)) return v as ApprovalRiskTier;
  // Accept the contract's tier words too, so a caller can pass either vocabulary.
  if (v === 'critical') return 'irreversible';
  if (v === 'high') return 'external';
  if (v === 'medium') return 'reversible';
  if (v === 'low') return 'read';
  return null;
}

/**
 * Derive the coarse risk tier for an approval. Priority:
 *   1. An explicit, valid `riskTier` on the input (caller already classified).
 *   2. The action_type identifier verb (most reliable structured signal).
 *   3. The free-text reason.
 *   4. Fall back to 'reversible' — never silently 'read' when we truly don't
 *      know, because unknown side effects should still gate as a mutation.
 */
export function deriveApprovalRiskTier(input: ApprovalIntentInput): ApprovalRiskTier {
  const explicit = normalizeTier(input.riskTier);
  if (explicit) return explicit;
  return (
    tierFromText(String(input.action_type || '')) ??
    tierFromText(String(input.reason || '')) ??
    'reversible'
  );
}

const RISK_CHIP: Record<ApprovalRiskTier, ApprovalRiskChip> = {
  read: { label: 'READ', tone: 'green' },
  reversible: { label: 'REVERSIBLE', tone: 'blue' },
  external: { label: 'EXTERNAL', tone: 'amber' },
  irreversible: { label: 'IRREVERSIBLE', tone: 'red' },
};

/**
 * The chip (label + tone) for a tier. Accepts the four-tier vocabulary or the
 * contract's low/medium/high/critical words; anything unrecognized falls to the
 * safest visible chip ('reversible') rather than throwing.
 */
export function describeApprovalRiskChip(
  tier: ApprovalRiskTier | ComputerTaskApprovalRisk | string | null | undefined,
): ApprovalRiskChip {
  const normalized = normalizeTier(typeof tier === 'string' ? tier : String(tier ?? ''));
  return RISK_CHIP[normalized ?? 'reversible'];
}

// ─── Intent line ─────────────────────────────────────────────────────────────

/**
 * Human verb + object for an action_type identifier or a bare verb. Returns a
 * lowercase phrase ("publish a post", "delete the file") to slot after "Will ".
 */
function intentVerbPhrase(actionType: string, tier: ApprovalRiskTier): string {
  // action_type is usually "namespace.verb_object" (wp.publish_post) or
  // "chat.<kind>.<route>". Take the most meaningful verb-ish token.
  const tail = actionType.split('.').filter(Boolean).pop() || actionType;
  const words = tail
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase();
  if (words && words !== 'request' && words !== 'action') return words;
  // No usable verb in the identifier — describe by tier instead of echoing junk.
  switch (tier) {
    case 'read':
      return 'read information';
    case 'external':
      return 'take an action outside this workspace';
    case 'irreversible':
      return 'take an irreversible action';
    case 'reversible':
    default:
      return 'make a change';
  }
}

/**
 * Build the plain-language WHAT line ("Will publish a post to acme.com/blog").
 * Prefers a concrete target (host/path, app, or endpoint) drawn from the
 * payload, secret-stripped and bounded. Never throws.
 */
function buildIntentLine(
  input: ApprovalIntentInput,
  payload: Record<string, unknown>,
  tier: ApprovalRiskTier,
): string {
  const actionType = String(input.action_type || '').trim();

  // Prefer a target phrase from the payload.
  const urlish = pickString(payload, ['url', 'site', 'siteUrl', 'endpoint', 'href', 'link']);
  const target =
    hostAndPath(urlish) ||
    pickString(payload, ['host', 'domain', 'apiName', 'app', 'application', 'appName']) ||
    null;
  const method = pickString(payload, ['method']);
  const httpEndpoint = pickString(payload, ['path', 'endpoint']);

  let verbPhrase: string;
  if (actionType) {
    verbPhrase = intentVerbPhrase(actionType, tier);
  } else {
    // No action_type: try the reason's first clause, else tier-based verb.
    const reason = cleanFact(input.reason, 60).toLowerCase();
    verbPhrase = tierFromText(reason)
      ? reason.split(/[.—:;]/)[0].trim() || intentVerbPhrase('', tier)
      : intentVerbPhrase('', tier);
  }

  const targetSuffix = target ? ` to ${cleanFact(target, 60)}` : '';
  // For raw HTTP calls, method + endpoint is the most legible target.
  if (!target && method && httpEndpoint) {
    return cleanFact(`Will call ${method.toUpperCase()} ${httpEndpoint}`, 140);
  }
  const line = `Will ${verbPhrase}${targetSuffix}`;
  return cleanFact(line, 140);
}

// ─── Scope lines ─────────────────────────────────────────────────────────────

/**
 * A short whitelist of payload keys that are safe to surface as scope facts,
 * mapped to a human label. Anything not on this list is NOT shown (so we never
 * leak an unexpected secret-bearing field). Order = display priority.
 */
const SCOPE_FIELDS: Array<{ keys: string[]; label: string; transform?: (v: string) => string }> = [
  { keys: ['site', 'siteUrl', 'host', 'domain', 'url', 'href', 'link'], label: 'Target', transform: (v) => hostAndPath(v) || v },
  { keys: ['app', 'application', 'appName', 'apiName'], label: 'App' },
  { keys: ['category', 'section', 'board', 'collection'], label: 'Category' },
  { keys: ['visibility', 'status', 'state'], label: 'Visibility' },
  { keys: ['method'], label: 'Method', transform: (v) => v.toUpperCase() },
  { keys: ['endpoint', 'path'], label: 'Endpoint' },
  { keys: ['title', 'subject', 'name', 'label'], label: 'Title' },
  { keys: ['recipient', 'to', 'audience'], label: 'Recipient' },
  { keys: ['amount', 'price', 'total', 'cost'], label: 'Amount' },
  { keys: ['file', 'filename', 'basename'], label: 'File', transform: fileBasename },
];

/** Just the basename of a path-like value — never surface a full local path. */
function fileBasename(v: string): string {
  const parts = String(v).split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : v;
}

/**
 * Up to `max` bounded, secret-stripped scope facts from the payload, drawn only
 * from the whitelist above and deduped by label + value. Secret-named keys are
 * skipped by construction (they aren't in the whitelist), and every value is
 * still run through the value scrubber as defense-in-depth.
 */
export function buildApprovalScopeLines(payload: unknown, max = 3): string[] {
  const rec = asRecord(payload);
  const lines: string[] = [];
  const seenLabels = new Set<string>();
  for (const field of SCOPE_FIELDS) {
    if (lines.length >= max) break;
    if (seenLabels.has(field.label)) continue;
    const raw = pickString(rec, field.keys);
    if (!raw) continue;
    const shaped = field.transform ? field.transform(raw) : raw;
    const value = cleanFact(shaped, 60);
    if (!value || value === '[redacted]') continue;
    seenLabels.add(field.label);
    lines.push(`${field.label}: ${value}`);
  }
  return lines;
}

// ─── Choices ─────────────────────────────────────────────────────────────────

/**
 * The three-choice lane for a tier. Read-only actions don't need an
 * "I'll do it myself" escape (there's no side effect to take over), so they
 * offer Proceed + Edit only; every mutating tier offers all three. Edit is
 * always offered so the user can revise WHAT before it runs.
 */
export function approvalChoicesForTier(tier: ApprovalRiskTier): ApprovalChoice[] {
  if (tier === 'read') return ['proceed', 'edit'];
  return ['proceed', 'edit', 'self'];
}

// ─── Assembler ───────────────────────────────────────────────────────────────

/**
 * Turn a raw approval into the structured Intent Preview a confirmation UI
 * renders. Pure and total: any partial/degenerate input yields a safe preview
 * rather than throwing, and no field ever carries a raw secret value.
 */
export function buildApprovalIntentPreview(input: ApprovalIntentInput): ApprovalIntentPreview {
  const safeInput: ApprovalIntentInput = input && typeof input === 'object' ? input : {};
  const payload = asRecord(safeInput.payload);
  const riskTier = deriveApprovalRiskTier(safeInput);
  return {
    intentLine: buildIntentLine(safeInput, payload, riskTier),
    riskTier,
    riskChip: describeApprovalRiskChip(riskTier),
    scopeLines: buildApprovalScopeLines(payload, 3),
    choices: approvalChoicesForTier(riskTier),
  };
}
