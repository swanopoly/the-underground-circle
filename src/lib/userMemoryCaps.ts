/**
 * userMemoryCaps — pure cap-check helpers, split out of `userMemory.ts`
 * so smoke tests can import them in Node without the Supabase client
 * pulling react-native into the graph.
 *
 * Phase CA-8b of `PHASE_CA-8_HERMES_DELTA_PLAN.md`. Per-user
 * `user_memory` is 1-to-1 with Hermes `USER.md` (cap 2,200 chars).
 * When the agent tries to `appendUserMemory` past the cap, we return a
 * structured error it can act on by self-consolidating.
 *
 * Kept independent of any DB / network dep — re-exported from
 * `userMemory.ts`, same API surface.
 */

export const USER_MEMORY_SOFT_CAP = 2_200;  // advisory — warn agent to consolidate
export const USER_MEMORY_HARD_CAP = 2_500;  // enforced — append rejects over this
export const USER_MEMORY_CAP_ERROR = 'memory_cap_exceeded';

export type UserMemoryCapCheck =
  | { ok: true; currentChars: number; capChars: number; nextChars: number; approachingSoftCap: boolean }
  | {
      ok: false;
      error: typeof USER_MEMORY_CAP_ERROR;
      suggestion: 'consolidate';
      currentChars: number;
      capChars: number;
      wouldBeChars: number;
    };

/** Pure — decides whether appending `addition` to `currentContent`
 *  would cross the hard cap. Separator is inserted between existing
 *  content and the new note (default `\n`) so the arithmetic matches
 *  what `appendUserMemory` actually writes. */
export function checkUserMemoryCap(
  currentContent: string,
  addition: string,
  opts?: { softCap?: number; hardCap?: number; separator?: string },
): UserMemoryCapCheck {
  const softCap = opts?.softCap ?? USER_MEMORY_SOFT_CAP;
  const hardCap = opts?.hardCap ?? USER_MEMORY_HARD_CAP;
  const separator = opts?.separator ?? '\n';
  const current = (currentContent || '').trim();
  const add = (addition || '').trim();
  const wouldBe = current
    ? (current + separator + add).length
    : add.length;

  if (wouldBe > hardCap) {
    return {
      ok: false,
      error: USER_MEMORY_CAP_ERROR,
      suggestion: 'consolidate',
      currentChars: current.length,
      capChars: hardCap,
      wouldBeChars: wouldBe,
    };
  }
  return {
    ok: true,
    currentChars: current.length,
    capChars: hardCap,
    nextChars: wouldBe,
    approachingSoftCap: wouldBe >= softCap,
  };
}

export const USER_MEMORY_CREDENTIAL_ERROR = 'memory_credential_blocked';

// ─────────────────────────────────────────────────────────────────────────────
// Credential-shape guard — the APP-WIDE memory secret gate.
//
// SINGLE SOURCE OF TRUTH — no LOCKSTEP duplicate. This module is pure and
// dependency-free (no react-native in its graph), so the Deno edge functions
// import it DIRECTLY via the established `../../../src/lib/*.ts` pattern
// already used for `anthropicContextManagement.ts`, `v2ToolSelectionCore.ts`,
// `toolFailureFeedback.ts`, etc. Do not add a `_shared/` copy — that only
// creates drift. KEEP THIS FILE DEPENDENCY-FREE: adding any import that pulls
// react-native in would break both edge deploys and the smoke test.
//
// Callers:
//   client — `userMemory.ts` (appendUserMemory / replaceUserMemory),
//            `conversationalRouter.ts` (/remember),
//            `agentRunSystem.ts` saveMemory (the single `memory_entries`
//            chokepoint for the whole client — `memoryService.ts`'s
//            `saveMemoryWithContext` and friends all route through it).
//   edge   — `swanbot-ai` saveSwanbotMemoryEntry() (auto-memory extraction +
//            the `store_memory` tool), `swanbot-v2-ai` `save_memory` tool.
//
// WHY it must be strong here: a `memory_entries` row is permanent, embedded
// into pgvector, and re-injected into every future prompt. One pasted key or
// one tool response echoing a bearer token becomes a standing leak.
//
// Layered rules, most-specific first:
//   1. LITERAL provider key shapes (sk-, ghp_, xox*-, AKIA…, PEM, JWT, …) —
//      these are secrets no matter what prose surrounds them.
//   2. SECRET-NAMED ASSIGNMENT (`GITHUB_TOKEN=…`, `DB_PASSWORD: …`). No `\b`
//      before the name so underscore-prefixed env-var names still match.
//   3. CREDENTIAL NOUN + `is`/`was`/`:`/`=` + value (the original rule, now
//      value-aware and with only a short PREPOSITIONAL gap allowed between
//      noun and operator).
//   4. BARE `password/passcode/pin <value>`.
//   5. HIGH-ENTROPY base64-ish run as a backstop for unknown key formats.
//
// FALSE-POSITIVE control — the gate is app-wide now, so an over-block silently
// drops real team knowledge. Rules 2–4 require the assigned value to not be an
// ordinary English continuation (VALUE_STOPWORDS), and rule 3's bounded
// prepositional gap stops nouns being glued to distant operators. So "rotate
// the API key monthly", "the API key is stored in the vault", "her password
// manager is Bitwarden" and "we discussed the password reset flow" all still
// save. Rule 5 additionally requires mixed character classes and rejects runs
// containing a 7+ same-case letter run, so file paths / SCREAMING_SNAKE
// identifiers / camelCase names / git SHAs / UUIDs never trip it.
//
// ReDoS: every pattern uses a single bounded run (`\S{4,}`, `[A-Za-z0-9…]{n,}`)
// with no nested or overlapping quantifiers, so all are linear-time.
// ─────────────────────────────────────────────────────────────────────────────

export type CredentialMemoryRuleId =
  | 'pem_private_key'
  | 'jwt'
  | 'bearer_token'
  | 'aws_access_key_id'
  | 'openai_style_key'
  | 'stripe_key'
  | 'github_token'
  | 'gitlab_token'
  | 'slack_token'
  | 'google_api_key'
  | 'huggingface_token'
  | 'npm_token'
  | 'secret_named_assignment'
  | 'credential_noun_assignment'
  | 'bare_credential_value'
  | 'high_entropy_secret';

export interface CredentialMemoryFinding {
  /** Stable rule id — safe to log / persist. Never contains the matched value. */
  rule: CredentialMemoryRuleId;
  /** Human label for the refusal message. Never contains the matched value. */
  label: string;
}

/** Rule 1 — literal provider key shapes. Trailing `\b` is omitted where the
 *  charset contains `-`/`_` (a `\b` after those is unreliable). */
const LITERAL_SECRET_RULES: ReadonlyArray<{ rule: CredentialMemoryRuleId; label: string; re: RegExp }> = [
  { rule: 'pem_private_key', label: 'PEM private key block', re: /-----BEGIN[A-Z ]{0,40}PRIVATE KEY-----/ },
  { rule: 'jwt', label: 'JSON Web Token', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { rule: 'bearer_token', label: 'bearer/authorization token', re: /\bbearer\s+[A-Za-z0-9._~+/-]{16,}/i },
  { rule: 'aws_access_key_id', label: 'AWS access key id', re: /\b(?:AKIA|ASIA|ABIA|ACCA|AIDA|AROA|AGPA|ANPA)[A-Z0-9]{16}\b/ },
  { rule: 'openai_style_key', label: 'sk- style API key', re: /\bsk-[A-Za-z0-9_-]{14,}/ },
  { rule: 'stripe_key', label: 'Stripe key', re: /\b[rs]k_(?:live|test)_[A-Za-z0-9]{10,}/ },
  { rule: 'github_token', label: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{16,}/ },
  { rule: 'gitlab_token', label: 'GitLab token', re: /\bglpat-[A-Za-z0-9_-]{16,}/ },
  { rule: 'slack_token', label: 'Slack token', re: /\bxox[baprse]-[A-Za-z0-9-]{10,}/ },
  { rule: 'google_api_key', label: 'Google API key', re: /\bAIza[A-Za-z0-9_-]{30,}/ },
  { rule: 'huggingface_token', label: 'Hugging Face token', re: /\bhf_[A-Za-z0-9]{30,}/ },
  { rule: 'npm_token', label: 'npm token', re: /\bnpm_[A-Za-z0-9]{30,}/ },
];

/** Ordinary English continuations. When the "assigned value" is one of these
 *  the sentence is *talking about* a credential, not disclosing one. */
const VALUE_STOPWORDS: ReadonlySet<string> = new Set([
  'about', 'above', 'active', 'already', 'also', 'always', 'available', 'because', 'been', 'before',
  'being', 'below', 'blank', 'checked', 'configured', 'correct', 'created', 'critical', 'current',
  'defined', 'deleted', 'described', 'different', 'disabled', 'documented', 'done', 'down', 'each',
  'either', 'empty', 'enabled', 'encrypted', 'every', 'expired', 'expiring', 'fine', 'from',
  'generated', 'going', 'good', 'handled', 'hashed', 'here', 'hidden', 'important', 'inactive',
  'incorrect', 'invalid', 'issued', 'just', 'kept', 'managed', 'mandatory', 'missing', 'more',
  'needed', 'never', 'none', 'null', 'often', 'only', 'optional', 'other', 'over', 'part',
  'per-user', 'private', 'public', 'reset', 'redacted', 'required', 'revoked', 'rotated',
  'rotating', 'safe', 'same', 'saved', 'secure', 'sensitive', 'separate', 'set', 'shared',
  'similar', 'some', 'still', 'stored', 'that', 'their', 'them', 'then', 'there', 'these',
  'they', 'this', 'those', 'unavailable', 'under', 'unknown', 'unsafe', 'unset', 'unused',
  'updated', 'used', 'valid', 'verified', 'very', 'wrong', 'your',
  // cadence words — "the API key rotation policy: monthly"
  'daily', 'hourly', 'nightly', 'weekly', 'monthly', 'quarterly', 'yearly', 'annually',
  'immediately', 'manually', 'automatically', 'once', 'twice',
  // process/UI nouns that follow a credential noun in ordinary prose —
  // "PIN entry is disabled", "password strength rules", "token expiry"
  'complexity', 'entry', 'expiry', 'field', 'form', 'hash', 'hashing', 'history',
  'hygiene', 'input', 'lifetime', 'manager', 'management', 'policy', 'policies',
  'prompt', 'protection', 'recovery', 'requirement', 'requirements', 'rotation',
  'rules', 'screen', 'sharing', 'storage', 'strength', 'vault', 'flow', 'flows',
]);

/** True when a captured "value" looks like an actual secret rather than the
 *  next word of an English sentence. Quotes/punctuation are stripped first. */
function assignedValueLooksSecret(raw: string): boolean {
  const token = String(raw || '')
    .replace(/^["'`([<]+/, '')
    .replace(/["'`)\]>.,;:!?]+$/, '');
  if (token.length < 4) return false;
  if (VALUE_STOPWORDS.has(token.toLowerCase())) return false;
  return true;
}

/** Rule 2 — a secret-ish NAME (possibly `_`/`-` prefixed, e.g. `STRIPE_SECRET_KEY`)
 *  followed by `:`/`=` and a value. No leading `\b` on purpose: `\b` fails after
 *  `_`, which is exactly where env-var style names live. */
const SECRET_NAME_ASSIGN_SOURCE =
  '(?:password|passwd|passphrase|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|client[_-]?secret|auth[_-]?token|credential|service[_-]?role[_-]?key|signing[_-]?key|encryption[_-]?key)[A-Za-z0-9_.-]*\\s*[:=]\\s*["\'`]?(\\S{4,})';

/** Rule 3 — credential noun followed by `is`/`was`/`:`/`=` and a value.
 *  Only a short PREPOSITIONAL gap is allowed between the noun and the operator
 *  ("the password FOR PROD is …"), never an arbitrary span. That is what keeps
 *  "her password manager is Bitwarden", "the API key rotation policy: monthly"
 *  and "access key permissions are managed in IAM" saveable, while an unrelated
 *  `KEY=value` further down a multi-line note can never be glued to a noun in
 *  the first line. */
const CREDENTIAL_NOUN_SOURCE =
  '(?:password|passcode|passphrase|api[-_\\s]?key|access[-_\\s]?key|secret|token|private\\s+key|seed\\s+phrase|recovery\\s+(?:code|phrase)|pin(?:\\s+(?:code|number))?)';
const CREDENTIAL_GAP_SOURCE = '(?:\\s+(?:for|to|of|on|in|at|from|by)\\s+\\S{1,24}){0,2}';
const CREDENTIAL_ASSIGN_SOURCE =
  CREDENTIAL_NOUN_SOURCE + CREDENTIAL_GAP_SOURCE + '\\s*(?:\\bis\\b|\\bwas\\b|[:=])\\s*["\'`]?(\\S{4,})';

/** Rule 4 — bare `password hunter2` with no operator at all. */
const CREDENTIAL_BARE_SOURCE = '\\b(?:password|passcode|pin)\\b\\s+["\'`]?(\\S{4,})';

/** Rule 5 — high-entropy base64-ish run backstop. Thresholds tuned so that
 *  file paths, UUIDs, git SHAs and SCREAMING_SNAKE identifiers never match
 *  while ~90% of random 32+ char base64 keys do (see smoke test). */
const HIGH_ENTROPY_MIN_LENGTH = 32;
const HIGH_ENTROPY_MIN_BITS = 4.2;
// 7+ consecutive same-case letters ⇒ human identifier (COMPUTER_AGENT_…,
// computerTaskEvidence…), not a random key. Encoded in SAME_CASE_RUN_RE.
const HIGH_ENTROPY_RUN_SOURCE = '[A-Za-z0-9+/=_-]{32,}';
const SAME_CASE_RUN_RE = /[a-z]{7,}|[A-Z]{7,}/;

function shannonBitsPerChar(value: string): number {
  const counts: Record<string, number> = Object.create(null);
  for (const ch of value) counts[ch] = (counts[ch] || 0) + 1;
  let bits = 0;
  for (const key of Object.keys(counts)) {
    const p = counts[key] / value.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

/** Runs a global regex and returns true when ANY capture group 1 looks secret.
 *  Bounded scan (max 200 matches) so pathological input can't spin. */
function anyCapturedValueLooksSecret(source: string, text: string): boolean {
  const re = new RegExp(source, 'gi');
  let match: RegExpExecArray | null;
  let seen = 0;
  while ((match = re.exec(text)) !== null) {
    if (assignedValueLooksSecret(match[1] || '')) return true;
    if (++seen >= 200) break;
    if (re.lastIndex === match.index) re.lastIndex += 1; // zero-width safety
  }
  return false;
}

function hasHighEntropyRun(text: string): boolean {
  const re = new RegExp(HIGH_ENTROPY_RUN_SOURCE, 'g');
  let match: RegExpExecArray | null;
  let seen = 0;
  while ((match = re.exec(text)) !== null) {
    const run = match[0];
    if (++seen > 200) break;
    if (run.length < HIGH_ENTROPY_MIN_LENGTH) continue;
    if (!/[A-Z]/.test(run) || !/[a-z]/.test(run) || !/[0-9]/.test(run)) continue;
    if (SAME_CASE_RUN_RE.test(run)) continue;
    if (shannonBitsPerChar(run) >= HIGH_ENTROPY_MIN_BITS) return true;
  }
  return false;
}

/**
 * Returns the first matching credential rule, or `null` when `content` is safe
 * to persist. Pure; never throws; never returns the matched value.
 */
export function detectCredentialMemoryContent(content: string): CredentialMemoryFinding | null {
  const text = typeof content === 'string' ? content : String(content ?? '');
  if (!text) return null;

  for (const rule of LITERAL_SECRET_RULES) {
    if (rule.re.test(text)) return { rule: rule.rule, label: rule.label };
  }

  if (anyCapturedValueLooksSecret(SECRET_NAME_ASSIGN_SOURCE, text)) {
    return { rule: 'secret_named_assignment', label: 'secret-named assignment (e.g. TOKEN=…)' };
  }

  if (anyCapturedValueLooksSecret(CREDENTIAL_ASSIGN_SOURCE, text)) {
    return { rule: 'credential_noun_assignment', label: 'credential noun with an assigned value' };
  }

  if (anyCapturedValueLooksSecret(CREDENTIAL_BARE_SOURCE, text)) {
    return { rule: 'bare_credential_value', label: 'credential noun followed by a value' };
  }

  if (hasHighEntropyRun(text)) {
    return { rule: 'high_entropy_secret', label: 'long high-entropy token' };
  }

  return null;
}

/**
 * True when `content` looks like a stored secret. Pure; never throws. Callers
 * REFUSE the write and point at the vault instead of persisting — secrets must
 * never live in memory (they are re-injected into every later prompt).
 */
export function looksLikeCredentialMemoryContent(content: string): boolean {
  return detectCredentialMemoryContent(content) !== null;
}

/** Safe, value-free refusal message for logs / tool results / UI. */
export function describeCredentialMemoryBlock(finding: CredentialMemoryFinding | null): string {
  const label = finding?.label || 'credential-shaped content';
  return `${USER_MEMORY_CREDENTIAL_ERROR}: refused to save memory that looks like a stored secret (${label}). Secrets belong in the circle vault / provider keys, never in memory — memory rows are re-injected into every later prompt. Save a pointer instead (e.g. "the deploy token lives in the vault as DEPLOY_TOKEN").`;
}

/** One-line summary suitable for the system prompt's memory block. */
export function describeUserMemoryUsage(currentContent: string): string {
  const current = (currentContent || '').length;
  const soft = USER_MEMORY_SOFT_CAP;
  const hard = USER_MEMORY_HARD_CAP;
  const warn =
    current >= hard ? ' (HARD CAP HIT — rewriting required)'
    : current >= soft ? ' (approaching soft cap — consider consolidating)'
    : '';
  return `USER MEMORY: ${current.toLocaleString()} / ${hard.toLocaleString()} chars used${warn}`;
}
