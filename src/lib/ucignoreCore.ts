// ucignoreCore — the PURE, secret-safe ignore brain for codebase indexing (P4).
// It answers ONE question per path: should the indexer read/embed this file?
//
// Two layers, and the order is non-negotiable:
//   1. A hard secret DENYLIST (DEFAULT_SECRET_PATTERNS). If a path looks like a
//      credential/key/env file it is NEVER indexed — this ALWAYS wins, even if a
//      user `.ucignore` tries to re-include it with a `!` negation. Secrets must
//      not be embedded into any index, ever.
//   2. A user `.ucignore` file (gitignore-style: glob ignores + `!` re-includes).
//
// This module does NOT touch the filesystem or embed anything: it classifies a
// path string and returns a plain decision. A bad/malformed glob never throws —
// it just fails to match. Over-ignoring is safe; the only real failure would be
// letting a secret through, so the denylist is deliberately broad and unbeatable.
//
// PURITY: zero imports, tsx-loadable (smoke: ucignore-core). Never throws.

export interface IgnoreRules {
  /** Glob patterns that mark a path as ignored (gitignore-style). */
  ignoreGlobs: string[];
  /** `!`-prefixed re-includes (the leading `!` is stripped). */
  negations: string[];
}

export interface IndexDecision {
  /** true = safe to read/embed this path; false = skip it. */
  index: boolean;
  /** 'secret' | 'ignored' | 'ok' — why we decided. */
  reason: string;
}

// Hard secret denylist. Patterns are matched against BOTH the full path and its
// basename (see isSecretPath), so `.env`, `config/.env.production`, `**/secrets/x`,
// and `~/.aws/credentials` are all caught. Broad on purpose — a secret indexed is
// unrecoverable; a false-positive skip merely omits one file from the index.
export const DEFAULT_SECRET_PATTERNS: string[] = [
  // env files (any suffix: .env, .env.local, .env.production, …)
  '.env',
  '.env.*',
  // private keys / certs / signing material
  '*.pem',
  '*.key',
  '*.p12',
  '*.p8',
  '*.jks',
  '*.keystore',
  'id_rsa',
  'id_ed25519',
  // apple provisioning
  '*.mobileprovision',
  // service-account / credential blobs
  'credentials.json',
  // package + cloud + ssh credential locations (anywhere in the tree)
  '.npmrc',
  // a `secrets/` dir anywhere — both root-level and nested. `**/secrets/**`
  // (gitignore semantics) requires a parent dir, so `secrets/**` covers root.
  'secrets/**',
  '**/secrets/**',
  '.aws/**',
  '.ssh/**',
];

// Escape every RegExp metacharacter EXCEPT the glob wildcards (* ? ) which the
// translator handles itself. Applied to the literal chunks between wildcards.
function escapeLiteral(chunk: string): string {
  return chunk.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

/**
 * Translate a single gitignore-ish glob into a RegExp source string.
 *  - `**` → `.*`         (matches anything, including `/`)
 *  - `*`  → `[^/]*`      (matches within one path segment)
 *  - `?`  → `[^/]`       (one non-slash char)
 *  - leading `/`         → anchor to root (drop the slash; match from start)
 *  - trailing `/`        → directory prefix (pattern matches the dir and anything under it)
 *  - no leading `/`      → may match at any path segment boundary
 * Never throws — returns null if the pattern is empty after trimming.
 */
function globToRegExpSource(patternRaw: string): string | null {
  let pattern = patternRaw;
  if (!pattern) return null;

  const anchored = pattern.startsWith('/');
  if (anchored) pattern = pattern.slice(1);

  let dirPrefix = false;
  if (pattern.endsWith('/')) {
    dirPrefix = true;
    pattern = pattern.slice(0, -1);
  }
  if (!pattern) return null;

  // Walk the pattern, translating wildcards and escaping literal runs. We handle
  // `**` before `*` by peeking at the next char.
  let out = '';
  let literal = '';
  const flush = () => {
    if (literal) {
      out += escapeLiteral(literal);
      literal = '';
    }
  };
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === '*') {
      flush();
      if (pattern[i + 1] === '*') {
        out += '.*';
        i += 1; // consume the second star
      } else {
        out += '[^/]*';
      }
    } else if (ch === '?') {
      flush();
      out += '[^/]';
    } else {
      literal += ch;
    }
  }
  flush();

  // Left side: anchored patterns must start at the path root; unanchored ones may
  // begin at the start OR just after a `/` (a path-segment boundary).
  const left = anchored ? '^' : '(?:^|/)';
  // Right side: a directory prefix (or a `**` prefix like `.aws/**`) matches the
  // dir itself and everything beneath it; otherwise the whole remaining path.
  const right = dirPrefix ? '(?:/.*)?$' : '$';
  return `${left}(?:${out})${right}`;
}

/**
 * Minimal gitignore-style glob match. Never throws — a pattern that can't be
 * translated or compiled simply returns false.
 */
export function matchGlob(path: unknown, pattern: unknown): boolean {
  try {
    if (typeof path !== 'string' || typeof pattern !== 'string') return false;
    const p = normalizePath(path);
    const trimmed = pattern.trim();
    if (!p || !trimmed) return false;
    const source = globToRegExpSource(trimmed);
    if (source == null) return false;
    return new RegExp(source).test(p);
  } catch {
    return false;
  }
}

/** Strip a leading `./` and collapse redundant slashes; leave content otherwise. */
function normalizePath(path: string): string {
  let p = path.trim().replace(/\\/g, '/');
  while (p.startsWith('./')) p = p.slice(2);
  p = p.replace(/\/{2,}/g, '/');
  // A single leading slash on the subject is not meaningful for matching against
  // our anchored/unanchored globs (globs anchor via `^`/`(?:^|/)`), so drop it.
  if (p.length > 1 && p.startsWith('/')) p = p.slice(1);
  return p;
}

function basename(path: string): string {
  const p = normalizePath(path);
  const idx = p.lastIndexOf('/');
  return idx === -1 ? p : p.slice(idx + 1);
}

/**
 * True when a path matches ANY secret pattern (checked against full path AND
 * basename). This is the unbeatable layer — nothing re-includes a secret.
 * Never throws.
 */
export function isSecretPath(path: unknown): boolean {
  try {
    if (typeof path !== 'string' || !path.trim()) return false;
    const full = normalizePath(path);
    const base = basename(full);
    for (const pat of DEFAULT_SECRET_PATTERNS) {
      // Match the pattern against the full path (catches `**/secrets/**`, `.aws/**`)
      // and against the basename (catches `.env`, `*.pem`, `id_rsa` at any depth).
      if (matchGlob(full, pat)) return true;
      if (matchGlob(base, pat)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Parse `.ucignore` text into rules. gitignore-style:
 *  - blank lines and `#` comments are dropped (a leading `\#` escapes a literal `#`),
 *  - a leading `!` marks a negation (re-include); the `!` is stripped,
 *  - trailing whitespace is trimmed (unless backslash-escaped — kept minimal here),
 *  - everything else is an ignore glob.
 * Never throws; non-string input yields empty rules.
 */
export function parseUcignore(text: unknown): IgnoreRules {
  const ignoreGlobs: string[] = [];
  const negations: string[] = [];
  if (typeof text !== 'string') return { ignoreGlobs, negations };
  try {
    const lines = text.split(/\r?\n/);
    for (const rawLine of lines) {
      let line = rawLine.trim();
      if (!line) continue;
      if (line.startsWith('#')) continue; // full-line comment
      if (line.startsWith('\\#')) line = line.slice(1); // escaped leading '#'
      if (line.startsWith('!')) {
        const neg = line.slice(1).trim();
        if (neg) negations.push(neg);
        continue;
      }
      if (line.startsWith('\\!')) line = line.slice(1); // escaped leading '!'
      ignoreGlobs.push(line);
    }
  } catch {
    // fall through to whatever we collected
  }
  return { ignoreGlobs, negations };
}

/**
 * The one decision the indexer asks. Order matters and is non-negotiable:
 *   1. secret path            → { index:false, reason:'secret' }  (ALWAYS wins)
 *   2. ignored & not negated  → { index:false, reason:'ignored' }
 *   3. otherwise              → { index:true,  reason:'ok' }
 * Never throws.
 */
export function shouldIndexPath(path: unknown, rules: unknown): IndexDecision {
  try {
    // 1) Secret denylist beats everything — including `.ucignore` negations.
    if (isSecretPath(path)) return { index: false, reason: 'secret' };

    const r = coerceRules(rules);
    const anyIgnore = r.ignoreGlobs.some((g) => matchGlob(path as string, g));
    if (anyIgnore) {
      const negated = r.negations.some((n) => matchGlob(path as string, n));
      if (!negated) return { index: false, reason: 'ignored' };
    }
    return { index: true, reason: 'ok' };
  } catch {
    // Fail-open to indexing would risk leaking a secret, but we already ran the
    // secret check first; any error past that point is a glob issue → default to
    // NOT indexing is the safe posture for an unexpected failure.
    return { index: false, reason: 'ignored' };
  }
}

function coerceRules(rules: unknown): IgnoreRules {
  if (!rules || typeof rules !== 'object') return { ignoreGlobs: [], negations: [] };
  const r = rules as Partial<IgnoreRules>;
  return {
    ignoreGlobs: Array.isArray(r.ignoreGlobs) ? r.ignoreGlobs.filter((x): x is string => typeof x === 'string') : [],
    negations: Array.isArray(r.negations) ? r.negations.filter((x): x is string => typeof x === 'string') : [],
  };
}
