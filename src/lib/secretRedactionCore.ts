// secretRedactionCore — the PURE detect/mask brain for keeping raw secret values
// out of prompts, logs, persisted chat metadata, and the activity feed. This is
// a hard project invariant ("no raw secret values in prompts/logs/feed"), so this
// module exists as the single, reusable place that recognizes secret-SHAPED tokens
// in arbitrary text and replaces them with a mask before that text escapes.
//
// It does NOT decide policy, hit the network, or persist anything — callers run it
// over any string they are about to emit and use the redacted `text`. The pattern
// list is deliberately CONSERVATIVE: normal English prose, short hex, and ordinary
// URLs must never be flagged; the cost of a false positive (masking a real word)
// is worse UX, while a false negative (leaking a secret) is a broken invariant, so
// each pattern is anchored to a recognizable secret prefix/shape rather than raw
// entropy.
//
// Ordering: more-specific patterns come first (sk-ant- before sk-, github_pat_
// before ghp_) so a token is attributed to the right `kind`. Redaction is applied
// sequentially — each pattern runs over the already-masked text — and because the
// mask contains no secret-shaped token, later patterns cannot re-match an earlier
// redaction, so overlapping matches are not double-counted.
//
// PURITY: zero imports, tsx-loadable (smoke: secret-redaction-core).
// DETERMINISTIC: no Date/Math.random. NEVER throws: every pattern is applied inside
// a try/catch so one pathological match can't crash the whole redact — a failing
// pattern is skipped, never fatal.

export interface RedactionResult {
  /** The input with every matched secret replaced by the mask. */
  text: string;
  /** Total number of individual secret matches masked across all patterns. */
  redactionCount: number;
  /** Distinct pattern kinds that matched at least once, in stable first-match order. */
  kinds: string[];
}

export interface SecretPattern {
  kind: string;
  re: RegExp;
}

const DEFAULT_MASK = '[REDACTED]';

// Ordered most-specific → least-specific. Every `re` is global so we can count and
// replace all occurrences; `basic_auth_url` uses capture groups so the surrounding
// host/scheme survives while only the credentials are masked. Keep quantifier
// floors high enough (>=16 for generic shapes) that short hex / plain words are
// never flagged.
export const SECRET_PATTERNS: SecretPattern[] = [
  // PEM private-key blocks (any key type). Non-greedy body so adjacent blocks
  // don't merge into one match.
  {
    kind: 'pem_block',
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  },
  // JWTs — three base64url segments; the header segment begins with the fixed
  // `eyJ` marker so this stays specific.
  {
    kind: 'jwt',
    re: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  },
  // Anthropic keys MUST precede openai (`sk-…`) so `sk-ant-…` is not mis-attributed.
  {
    kind: 'anthropic_key',
    re: /sk-ant-[A-Za-z0-9\-_]{20,}/g,
  },
  {
    kind: 'openai_key',
    re: /sk-[A-Za-z0-9]{20,}/g,
  },
  // GitHub fine-grained PAT (github_pat_…) before classic (ghp_…).
  {
    kind: 'github_pat',
    re: /github_pat_[A-Za-z0-9_]{50,}|gh[pousr]_[A-Za-z0-9]{36,}/g,
  },
  {
    kind: 'aws_access_key',
    re: /AKIA[0-9A-Z]{16}/g,
  },
  {
    kind: 'slack_token',
    re: /xox[a-z]-[A-Za-z0-9-]{10,}/g,
  },
  // Credentials embedded in a URL: `://user:password@host`. Capture scheme-tail +
  // user in $1 and the leading `@`-anchored host boundary in $2 so only the
  // password is masked.
  {
    kind: 'basic_auth_url',
    re: /(:\/\/[^\s:@/]+:)[^\s:@/]+(@)/g,
  },
  // `Bearer <token>` in auth headers / prose.
  {
    kind: 'bearer',
    re: /Bearer\s+[A-Za-z0-9._\-]{16,}/g,
  },
  // Generic `api_key = <value>` / `apikey: "<value>"` style assignments.
  {
    kind: 'generic_api_key',
    re: /api[_-]?key["'\s:=]+[A-Za-z0-9\-_]{16,}/gi,
  },
  // AWS secret access key: 40-char base64-ish value that follows an explicit
  // secret context word. Conservative on purpose — a bare 40-char blob is NOT
  // flagged (too many false positives), only one introduced by a secret label.
  {
    kind: 'aws_secret',
    re: /(?:aws.{0,20})?secret[_-]?(?:access[_-]?)?key["'\s:=]+[A-Za-z0-9/+]{40}/gi,
  },
];

/**
 * Replace credentials in a matched `://user:pass@` URL, keeping scheme+user+host.
 * `$1` = `://user:` , `$2` = `@`. Isolated so basic_auth_url has a custom replacer
 * while every other pattern uses the flat mask.
 */
function replaceBasicAuth(text: string, re: RegExp, mask: string): { out: string; count: number } {
  let count = 0;
  const out = text.replace(re, (_full, prefix: string, at: string) => {
    count += 1;
    return `${prefix}${mask}${at}`;
  });
  return { out, count };
}

/**
 * Apply one pattern to `text`, returning the masked text and how many matches were
 * replaced. Wrapped by the caller in try/catch; on its own it counts via a global
 * replace so a single pass both counts and masks (no separate match() that could
 * disagree with replace()).
 */
function applyPattern(text: string, pattern: SecretPattern, mask: string): { out: string; count: number } {
  // Always work from a fresh, global RegExp so lastIndex state can never leak
  // between calls and so the shared SECRET_PATTERNS entries stay stateless.
  const flags = pattern.re.flags.includes('g') ? pattern.re.flags : `${pattern.re.flags}g`;
  const re = new RegExp(pattern.re.source, flags);

  if (pattern.kind === 'basic_auth_url') {
    return replaceBasicAuth(text, re, mask);
  }

  let count = 0;
  const out = text.replace(re, () => {
    count += 1;
    return mask;
  });
  return { out, count };
}

/**
 * Redact every secret-shaped token in `text`. Returns the masked text, the total
 * number of masked matches, and the distinct kinds that matched (deduped, stable
 * first-match order). Non-string / empty input yields an empty, zero result. Never
 * throws: a pattern that errors is skipped.
 */
export function redactSecrets(text: string, opts?: { mask?: string }): RedactionResult {
  if (typeof text !== 'string' || text.length === 0) {
    return { text: '', redactionCount: 0, kinds: [] };
  }

  const mask = typeof opts?.mask === 'string' ? opts.mask : DEFAULT_MASK;
  let working = text;
  let redactionCount = 0;
  const kinds: string[] = [];

  for (const pattern of SECRET_PATTERNS) {
    try {
      const { out, count } = applyPattern(working, pattern, mask);
      if (count > 0) {
        working = out;
        redactionCount += count;
        if (!kinds.includes(pattern.kind)) {
          kinds.push(pattern.kind);
        }
      }
    } catch {
      // A pathological pattern/input must never break the whole redact — the
      // invariant is "don't leak", and skipping one detector still masks the rest.
      // Intentionally swallow and continue.
    }
  }

  return { text: working, redactionCount, kinds };
}

/**
 * True when `text` contains at least one secret-shaped token. Delegates to
 * redactSecrets so detection and masking can never diverge. Never throws.
 */
export function containsSecret(text: string): boolean {
  return redactSecrets(text).redactionCount > 0;
}
