// taskPRLinkageCore — the PURE extractor that pulls real GitHub PR / commit /
// branch / compare references out of a COMPLETED feed task's deliverable text,
// its agent tool events (esp. git.run commit/push output), and its attachment
// URLs. A feed task can then show "Linked PR #123 (owner/repo)" as a typed link
// artifact, and a later merge webhook can settle it against the same canonical
// URL.
//
// SECURITY / TRUST: the deliverable and tool-event text are UNTRUSTED model
// output. Every URL is HARD-SCOPED to host github.com (or www.github.com):
//   - only http(s):// URLs are ever scanned, so a `javascript:` / `data:` /
//     `file:` scheme is NEVER captured, and
//   - the authority is parsed AFTER any `user@` userinfo and BEFORE any `:port`,
//     then compared for EXACT host equality — so `github.com.evil.com`,
//     `evil.com/github.com/…`, `raw.githubusercontent.com`, and
//     `https://github.com@evil.com/…` are all rejected.
// The STORED url is always CANONICAL — rebuilt from the parsed owner/repo/number
// /sha, never the raw matched string — so a hostile query string, fragment, or
// path tail can never ride along into the artifact link.
//
// Recognized:
//   - pull_request: /owner/repo/pull/123            → { prNumber, repo }
//   - commit:       /owner/repo/commit/<7–40 hex>   → { sha, repo }
//   - compare:      /owner/repo/compare/<spec>      → { repo }
//   - branch:       /owner/repo/tree/<name>         → { repo }
//   - prose:        "opened PR #123" / "PR #45"     → { prNumber }  (no repo/url)
//   - git.run text: "[main 7d3a1f2] subject"        → commit { sha }
//                   remote "github.com/owner/repo" + new-branch → branch { repo }
//
// PURITY: zero imports, tsx-loadable (smoke: task-pr-linkage-core). DETERMINISTIC
// (no Date.now / Math.random). NEVER throws — every scan is guarded and any
// non-string / hostile / cyclic input yields [] / "". Secret-safe: only public
// owner/repo/number/sha values ever appear in output.

export type GitRefType = 'pull_request' | 'commit' | 'branch' | 'compare';

export interface GitReference {
  type: GitRefType;
  /** Canonical github.com URL, or '' for a prose/tool-event ref with no URL. */
  url: string;
  prNumber?: number;
  repo?: string;
  sha?: string;
}

// ─── Bounds (all output is capped; nothing here is unbounded) ────────────────
const MAX_TEXT = 200_000;
const MAX_EVENTS = 200;
const MAX_EVENT_TEXT = 20_000;
const MAX_ATTACHMENTS = 200;
const MAX_MATCHES = 2_000;
const MAX_COLLECT = 500;
const MAX_REFS = 20;
const MAX_LABEL = 300;
const MAX_SPEC = 120;

const ALLOWED_HOSTS = new Set(['github.com', 'www.github.com']);

// http(s) URLs only — a `javascript:`/`data:`/`file:` scheme is never captured.
// Charset excludes whitespace, angle/paren/quote/backtick/bracket so a URL in
// prose or parentheses is captured cleanly.
const URL_RE = /https?:\/\/[^\s<>()"'`\]]+/gi;

// Prose "opened PR #123" / "PR #45" / "pull request #7". Word-boundary guard on
// the left so `supr#3` / `mypr #3` do NOT match; digit-bounded number.
const PROSE_PR_RE = /(?<![A-Za-z0-9])(?:pull request|pr)\s*#\s*(\d{1,12})/gi;

// git commit success line, anchored to line start (git prints it at col 0):
//   [main 7d3a1f2] subject
//   [feature/x (root-commit) e3a1b2c] init
const COMMIT_BRACKET_RE = /(?:^|\n)\s*\[([^\]\s]+)(?:\s+\([^)]*\))?\s+([0-9a-f]{7,40})\]/gi;

// New-branch lines from checkout / push output.
const NEW_BRANCH_CHECKOUT_RE = /Switched to a new branch '([^'\n]{1,120})'/g;
const NEW_BRANCH_PUSH_RE = /\[new branch\]\s+\S+\s*->\s*([A-Za-z0-9._/-]{1,120})/g;

// Remote repo from a git.run push/remote line. Lookbehind rejects `notgithub.com`
// / `evilgithub.com`; the trailing `[/:]` (not `.`) rejects `github.com.evil.com`.
const REMOTE_REPO_RE = /(?<![A-Za-z0-9.-])github\.com[/:]([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)/gi;

/** Guarded global-regex sweep — collects match arrays; never throws, bounded. */
function scanExec(re: RegExp, text: string): RegExpExecArray[] {
  const out: RegExpExecArray[] = [];
  try {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    let guard = 0;
    while ((m = re.exec(text)) !== null) {
      if (guard++ > MAX_MATCHES) break;
      out.push(m);
      // Zero-width match safety — advance so we can't loop forever.
      if (m.index === re.lastIndex) re.lastIndex += 1;
    }
  } catch {
    return out;
  }
  return out;
}

/** First capture group of a non-global regex, guarded. */
function firstMatch(re: RegExp, text: string): string {
  try {
    const m = re.exec(text);
    return m && typeof m[1] === 'string' ? m[1] : '';
  } catch {
    return '';
  }
}

/** Parse the path of an http(s) URL IFF its host is exactly github.com; else
 *  null. Extracts the authority AFTER `user@` and BEFORE `:port` so userinfo
 *  spoofing (`github.com@evil.com`) resolves to the real host. */
function githubPathFromUrl(raw: string): string | null {
  const m = /^https?:\/\/([^/?#]*)([^?#]*)/i.exec(raw);
  if (!m) return null;
  let authority = m[1] || '';
  const at = authority.lastIndexOf('@');
  if (at >= 0) authority = authority.slice(at + 1);
  const host = authority.split(':')[0].toLowerCase();
  if (!ALLOWED_HOSTS.has(host)) return null;
  return m[2] || '/';
}

/** Map a validated github.com path to a canonical typed reference, or null. */
function refFromGithubPath(path: string): GitReference | null {
  let m: RegExpExecArray | null;

  if ((m = /^\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\/pull\/(\d{1,12})/.exec(path))) {
    const repo = `${m[1]}/${m[2]}`;
    const n = parseInt(m[3], 10);
    if (!Number.isFinite(n)) return null;
    return { type: 'pull_request', url: `https://github.com/${repo}/pull/${n}`, prNumber: n, repo };
  }
  if ((m = /^\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\/commit\/([0-9a-fA-F]{7,40})/.exec(path))) {
    const repo = `${m[1]}/${m[2]}`;
    const sha = m[3].toLowerCase();
    return { type: 'commit', url: `https://github.com/${repo}/commit/${sha}`, sha, repo };
  }
  if ((m = /^\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\/compare\/([A-Za-z0-9._:~/-]{1,120})/.exec(path))) {
    const repo = `${m[1]}/${m[2]}`;
    return { type: 'compare', url: `https://github.com/${repo}/compare/${m[3]}`, repo };
  }
  if ((m = /^\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\/tree\/([A-Za-z0-9._-]{1,120})/.exec(path))) {
    const repo = `${m[1]}/${m[2]}`;
    return { type: 'branch', url: `https://github.com/${repo}/tree/${m[3]}`, repo };
  }
  return null;
}

function pushRef(out: GitReference[], ref: GitReference | null): void {
  if (ref && out.length < MAX_COLLECT) out.push(ref);
}

/** Scan any text for host-scoped github.com URL references (safe for any tool). */
function scanGithubUrlRefs(text: string, out: GitReference[]): void {
  for (const m of scanExec(URL_RE, text)) {
    try {
      const raw = (m[0] || '').replace(/[.,;:!?]+$/g, '');
      if (!raw) continue;
      const path = githubPathFromUrl(raw);
      if (path == null) continue;
      pushRef(out, refFromGithubPath(path));
    } catch {
      // one bad candidate never aborts the sweep
    }
  }
}

/** Scan deliverable prose for "PR #123" mentions (no repo/url — a soft signal). */
function scanProsePr(text: string, out: GitReference[]): void {
  for (const m of scanExec(PROSE_PR_RE, text)) {
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n)) pushRef(out, { type: 'pull_request', url: '', prNumber: n });
  }
}

/** First github.com owner/repo mentioned in git.run output, e.g. a push remote
 *  `github.com:owner/repo.git` / `https://github.com/owner/repo`. */
function detectRemoteRepo(text: string): string | undefined {
  for (const m of scanExec(REMOTE_REPO_RE, text)) {
    const owner = m[1];
    const repo = (m[2] || '').replace(/\.git$/i, '');
    if (owner && repo) return `${owner}/${repo}`;
  }
  return undefined;
}

function looksGitish(toolName: string, text: string): boolean {
  if (toolName === 'git.run' || toolName === 'git' || toolName.startsWith('git.')) return true;
  try {
    if (/(?:^|\n)\$ git\s/.test(text)) return true;
    if (/\bgit (?:commit|push|checkout|switch|branch)\b/.test(text)) return true;
  } catch {
    return false;
  }
  return false;
}

/** Parse structured git.run output: `[branch sha]` commit lines, remote repo,
 *  and new-branch lines (a branch ref is only emitted when a repo is known). */
function scanGitOutput(text: string, out: GitReference[]): void {
  const repo = detectRemoteRepo(text);

  for (const m of scanExec(COMMIT_BRACKET_RE, text)) {
    const sha = (m[2] || '').toLowerCase();
    if (sha.length < 7) continue;
    pushRef(
      out,
      repo
        ? { type: 'commit', url: `https://github.com/${repo}/commit/${sha}`, sha, repo }
        : { type: 'commit', url: '', sha },
    );
  }

  if (repo) {
    for (const re of [NEW_BRANCH_CHECKOUT_RE, NEW_BRANCH_PUSH_RE]) {
      for (const m of scanExec(re, text)) {
        const branch = (m[1] || '').replace(/[^A-Za-z0-9._/-]/g, '').slice(0, MAX_SPEC);
        if (branch) pushRef(out, { type: 'branch', url: `https://github.com/${repo}/tree/${branch}`, repo });
      }
    }
  }
}

/** Scan the completed task's agent tool events for git references. */
function scanToolEventRefs(events: unknown, out: GitReference[]): void {
  if (!Array.isArray(events)) return;
  const n = Math.min(events.length, MAX_EVENTS);
  for (let i = 0; i < n; i += 1) {
    try {
      const ev = events[i];
      if (!ev || typeof ev !== 'object') continue;
      const e = ev as Record<string, unknown>;
      const toolName = typeof e.tool === 'string' ? e.tool : '';
      let text = '';
      if (typeof e.summary === 'string') text += `${e.summary}\n`;
      if (typeof e.result === 'string') text += `${e.result}\n`;
      if (typeof e.preview === 'string') text += `${e.preview}\n`;
      if (!text) continue;
      if (text.length > MAX_EVENT_TEXT) text = text.slice(0, MAX_EVENT_TEXT);
      scanGithubUrlRefs(text, out);
      if (looksGitish(toolName, text)) scanGitOutput(text, out);
    } catch {
      // one malformed event never aborts the loop
    }
  }
}

/** Scan attachment URLs (host-scoped) for github references. */
function scanAttachmentRefs(attachments: unknown, out: GitReference[]): void {
  if (!Array.isArray(attachments)) return;
  const n = Math.min(attachments.length, MAX_ATTACHMENTS);
  for (let i = 0; i < n; i += 1) {
    try {
      const a = attachments[i];
      if (!a || typeof a !== 'object') continue;
      const url = (a as Record<string, unknown>).url;
      if (typeof url === 'string' && url) scanGithubUrlRefs(url, out);
    } catch {
      // one malformed attachment never aborts the loop
    }
  }
}

/** Stable identity for dedupe — the canonical url when present, else a typed key
 *  so distinct repo-less prose/tool refs are NOT collapsed into one. */
function refIdentity(ref: GitReference): string {
  if (ref.url) return `u:${ref.url}`;
  return `k:${ref.type}|${ref.prNumber ?? ''}|${(ref.sha ?? '').toLowerCase()}|${ref.repo ?? ''}`;
}

/** Dedupe by identity, then absorb the redundant repo-less prose/tool refs into
 *  their fully-qualified twins, then cap at MAX_REFS — first occurrence wins. */
function dedupeAndBound(refs: GitReference[]): GitReference[] {
  const seen = new Set<string>();
  const stage1: GitReference[] = [];
  for (const ref of refs) {
    const key = refIdentity(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    stage1.push(ref);
  }

  // A url-less "PR #123" is redundant once a real /pull/123 URL is present.
  const fullPrNumbers = new Set<number>();
  // A short bracket sha is redundant once a full commit-URL sha covers it.
  const fullCommitShas: string[] = [];
  for (const r of stage1) {
    if (r.type === 'pull_request' && r.url && typeof r.prNumber === 'number') fullPrNumbers.add(r.prNumber);
    if (r.type === 'commit' && r.url && typeof r.sha === 'string') fullCommitShas.push(r.sha.toLowerCase());
  }

  const out: GitReference[] = [];
  for (const ref of stage1) {
    if (ref.type === 'pull_request' && !ref.url && typeof ref.prNumber === 'number' && fullPrNumbers.has(ref.prNumber)) {
      continue;
    }
    if (ref.type === 'commit' && !ref.url && typeof ref.sha === 'string') {
      const s = ref.sha.toLowerCase();
      if (fullCommitShas.some((f) => f === s || f.startsWith(s) || s.startsWith(f))) continue;
    }
    out.push(ref);
    if (out.length >= MAX_REFS) break;
  }
  return out;
}

/**
 * Extract typed, host-scoped GitHub references from a completed task's
 * deliverable text, agent tool events, and attachment URLs. Deduped, canonical,
 * and bounded (~20). Never throws — any non-object / hostile / cyclic input
 * yields [].
 */
export function extractGitReferences(input: {
  deliverable?: unknown;
  toolEvents?: unknown;
  attachments?: unknown;
}): GitReference[] {
  const collected: GitReference[] = [];
  try {
    const src = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};

    if (typeof src.deliverable === 'string' && src.deliverable) {
      const d = src.deliverable.length > MAX_TEXT ? src.deliverable.slice(0, MAX_TEXT) : src.deliverable;
      scanGithubUrlRefs(d, collected);
      scanProsePr(d, collected);
    }
    scanToolEventRefs(src.toolEvents, collected);
    scanAttachmentRefs(src.attachments, collected);
  } catch {
    // fall through with whatever was collected before the fault
  }
  return dedupeAndBound(collected);
}

/**
 * Render a compact human label for a reference:
 *   'PR #123 (owner/repo)' · 'commit abc1234 (owner/repo)' ·
 *   'branch feature/x (owner/repo)' · 'compare main...feature (owner/repo)'.
 * The `(repo)` suffix is dropped when unknown. Never throws; a non-object or
 * unknown-type ref yields ''. Bounded output.
 */
export function formatGitReferenceLabel(ref: GitReference): string {
  if (!ref || typeof ref !== 'object') return '';
  const repo = typeof ref.repo === 'string' && ref.repo ? ref.repo : '';
  const suffix = repo ? ` (${repo})` : '';
  const url = typeof ref.url === 'string' ? ref.url : '';

  let label: string;
  switch (ref.type) {
    case 'pull_request': {
      const n = typeof ref.prNumber === 'number' && Number.isFinite(ref.prNumber) ? `#${ref.prNumber}` : '';
      label = (n ? `PR ${n}` : 'PR') + suffix;
      break;
    }
    case 'commit': {
      const sha = typeof ref.sha === 'string' && ref.sha ? ref.sha.slice(0, 7) : '';
      label = (sha ? `commit ${sha}` : 'commit') + suffix;
      break;
    }
    case 'branch': {
      const name = firstMatch(/\/tree\/([A-Za-z0-9._/-]{1,120})/, url);
      label = (name ? `branch ${name}` : 'branch') + suffix;
      break;
    }
    case 'compare': {
      const spec = firstMatch(/\/compare\/([A-Za-z0-9._:~/-]{1,120})/, url);
      label = (spec ? `compare ${spec}` : 'compare') + suffix;
      break;
    }
    default:
      return '';
  }
  return label.length > MAX_LABEL ? label.slice(0, MAX_LABEL) : label;
}
