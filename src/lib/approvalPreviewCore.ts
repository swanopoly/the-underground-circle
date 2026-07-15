/**
 * approvalPreviewCore — pure approval-card preview + staleness helpers.
 *
 * Fixes two approval-UX findings:
 *   1. Approval cards never showed WHAT will run — users approved shell
 *      commands, outbound emails, and WordPress edits blind. `buildApprovalPreview`
 *      turns (tool, args) into a secret-redacted human title/detail/risk triple
 *      that the approval requester (`maybeRequestToolApproval` in
 *      `openswanToolRuntime.ts`) can put on the card description + payload.
 *   2. Pending approvals never expired — `classifyApprovalAge` /
 *      `describeApprovalAge` give the reuse path and the card UI a shared
 *      staleness contract (fresh < 5 min ≤ stale < 30 min ≤ expired).
 *
 * PURITY (load-bearing): zero runtime imports, no react-native/supabase/app
 * modules, no Date.now()/Math.random() at module scope. Every export is TOTAL:
 * any input (null/undefined/wrong type/huge) returns a safe bounded value and
 * never throws. Smoke: scripts/approval-preview-core-smoketest.ts.
 */

export interface ApprovalPreview {
  /** Short human action name, e.g. `Run shell command`, `Send email`. ≤120 chars. */
  title: string;
  /** Secret-redacted, whitespace-flattened summary of exactly what will run. <300 chars. */
  detail: string;
  /** Card tint / severity: read (safe), write (mutating), destructive (data-loss / irreversible external). */
  risk: 'read' | 'write' | 'destructive';
}

export type ApprovalStaleness = 'fresh' | 'stale' | 'expired';

/** A pending approval older than this should be visually flagged as stale. */
export const APPROVAL_STALE_MS = 5 * 60_000;
/** A pending approval older than this must not be reused/executed — re-request instead. */
export const APPROVAL_EXPIRED_MS = 30 * 60_000;

const MAX_TITLE_CHARS = 120;
const MAX_DETAIL_CHARS = 280; // contract: detail is always < 300 chars
const MAX_REDACT_OUTPUT_CHARS = 2000;
const MAX_REDACT_SCAN_CHARS = 4000;
const MAX_ARGV_TOKENS = 24;
const MAX_ARGV_TOKEN_CHARS = 80;
const MAX_SUMMARY_KEYS = 6;
const MAX_SUMMARY_VALUE_CHARS = 40;

// ─── tiny total helpers ──────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asRecord(v: unknown): Record<string, unknown> {
  return isRecord(v) ? v : {};
}

/** Primitive-only string coercion; objects/arrays/functions become ''. */
function str(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'boolean') return String(v);
  return '';
}

/** Finite-number coercion from number or numeric string; otherwise null. */
function finiteNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim().length > 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Flatten control chars/newlines to spaces, collapse runs, clamp with '…'. */
function clampText(v: unknown, max: number): string {
  let s = str(v);
  if (s.length === 0) return '';
  // Pre-slice so regex work stays bounded on huge inputs.
  if (s.length > max * 4 + 64) s = s.slice(0, max * 4 + 64);
  s = s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(1, max - 1))}…`;
}

// ─── secret redaction ────────────────────────────────────────────────────────

/**
 * Identifiers that contain a secret-ish word followed by `:`/`=` get their
 * value masked. Substring match on the key errs toward over-redaction on
 * purpose (MY_TOKEN=…, GITHUB_PAT-ish names, "Authorization: …").
 */
const SECRET_KEY_VALUE_RE =
  /([A-Za-z0-9_-]*(?:api[_-]?key|apikey|access[_-]?key|token|secret|passwd|password|pwd|credential|authorization|auth|bearer)[A-Za-z0-9_-]*)(["']?\s*[:=]\s*)((?:bearer\s+)?(?:"[^"]*"|'[^']*'|[^\s,;&"']+))/gi;

/** `scheme://user:password@host` credentials. */
const URL_CREDENTIALS_RE = /(:\/\/[^/\s:@]+):([^/\s@]+)@/g;

/** 1Password secret references. */
const OP_REF_RE = /\bop:\/\/[^\s"']{1,200}/gi;

/** `Bearer <token>` headers (keeps the word Bearer). */
const BEARER_RE = /\b(bearer\s+)[A-Za-z0-9._~+/=-]{6,}/gi;

/** Bare token shapes: sk-… (OpenAI/Anthropic), GitHub gh?_, Slack xox…, AWS AKIA…, JWTs. */
const TOKEN_SHAPE_RES: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{8,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{8,}\b/g,
  /\bAKIA[0-9A-Z]{12,}\b/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g,
];

/**
 * Mask secret-looking material (tokens, keys, passwords, bearer headers,
 * sk-/ghp_/xox/AKIA/JWT shapes, op:// refs, URL credentials) for human
 * previews. Total: any non-string input is coerced (null/undefined → '');
 * output is bounded to 2000 chars. Never throws.
 */
export function redactSecretsForPreview(text: unknown): string {
  try {
    let s: string;
    if (typeof text === 'string') s = text;
    else if (text == null) s = '';
    else if (typeof text === 'number' || typeof text === 'boolean') s = String(text);
    else {
      try {
        s = JSON.stringify(text) ?? '';
      } catch {
        s = '';
      }
    }
    if (s.length === 0) return '';
    if (s.length > MAX_REDACT_SCAN_CHARS) s = s.slice(0, MAX_REDACT_SCAN_CHARS);

    s = s.replace(SECRET_KEY_VALUE_RE, '$1$2[redacted]');
    s = s.replace(URL_CREDENTIALS_RE, '$1:[redacted]@');
    s = s.replace(OP_REF_RE, 'op://[redacted]');
    s = s.replace(BEARER_RE, '$1[redacted]');
    for (const re of TOKEN_SHAPE_RES) s = s.replace(re, '[redacted]');

    if (s.length > MAX_REDACT_OUTPUT_CHARS) s = `${s.slice(0, MAX_REDACT_OUTPUT_CHARS - 1)}…`;
    return s;
  } catch {
    return '';
  }
}

// ─── risk classification ─────────────────────────────────────────────────────

/** Word-level destructive markers inside a shell/git command line. */
const DESTRUCTIVE_COMMAND_WORD_RE = /(^|\s|["'=(])(rm|rmdir|shred|mkfs|dd)(\s|$|["')])|\b(drop|delete|truncate|unlink)\b/i;

const DESTRUCTIVE_NAME_SEGMENTS = new Set([
  'delete', 'remove', 'trash', 'drop', 'destroy', 'wipe', 'purge', 'erase', 'clear', 'kill', 'uninstall',
]);

const EXTERNAL_SEND_NAME_SEGMENTS = new Set(['send', 'notify', 'publish', 'broadcast']);

const READ_NAME_SEGMENTS = new Set([
  'read', 'list', 'get', 'search', 'find', 'status', 'observe', 'describe',
  'preview', 'inspect', 'check', 'view', 'count', 'fetch', 'ls', 'tail',
  'peek', 'watch', 'discover', 'lookup',
]);

const GIT_READ_VERBS = new Set([
  'status', 'log', 'diff', 'show', 'blame', 'rev-parse', 'describe',
  'shortlog', 'ls-files', 'ls-remote', 'grep', 'reflog',
]);

function nameSegments(tool: string): string[] {
  return tool.toLowerCase().split(/[._\-/:\s]+/).filter((p) => p.length > 0);
}

function riskFromToolName(tool: string): ApprovalPreview['risk'] {
  const segments = nameSegments(tool);
  for (const seg of segments) if (DESTRUCTIVE_NAME_SEGMENTS.has(seg)) return 'destructive';
  for (const seg of segments) if (EXTERNAL_SEND_NAME_SEGMENTS.has(seg)) return 'destructive';
  for (const seg of segments) if (READ_NAME_SEGMENTS.has(seg)) return 'read';
  return 'write';
}

// ─── per-tool preview builders ───────────────────────────────────────────────

function finishPreview(title: string, detail: string, risk: ApprovalPreview['risk']): ApprovalPreview {
  return {
    title: clampText(redactSecretsForPreview(title), MAX_TITLE_CHARS) || 'Approval required',
    detail: clampText(redactSecretsForPreview(detail), MAX_DETAIL_CHARS),
    risk: risk === 'read' || risk === 'destructive' ? risk : 'write',
  };
}

function joinArgv(argv: unknown): string {
  if (!Array.isArray(argv)) return '';
  return argv
    .slice(0, MAX_ARGV_TOKENS)
    .map((t) => clampText(str(t), MAX_ARGV_TOKEN_CHARS))
    .filter((t) => t.length > 0)
    .join(' ')
    + (argv.length > MAX_ARGV_TOKENS ? ' …' : '');
}

function previewRunShell(a: Record<string, unknown>): ApprovalPreview {
  const joined = joinArgv(a.argv);
  const cwd = clampText(str(a.cwd), 80);
  const detail = joined.length > 0
    ? `$ ${joined}${cwd ? ` (cwd: ${cwd})` : ''}`
    : 'no command provided';
  const risk: ApprovalPreview['risk'] =
    joined.length > 0 && DESTRUCTIVE_COMMAND_WORD_RE.test(joined) ? 'destructive' : 'write';
  return finishPreview('Run shell command', detail, risk);
}

function previewGitRun(a: Record<string, unknown>): ApprovalPreview {
  const verb = clampText(str(a.verb), 40).toLowerCase();
  const argsJoined = joinArgv(a.args);
  const repo = clampText(str(a.repoPath), 80);
  const line = `git ${verb}${argsJoined ? ` ${argsJoined}` : ''}`.trim();
  const detail = `${verb ? line : 'no git verb provided'}${repo ? ` (repo: ${repo})` : ''}`;

  let risk: ApprovalPreview['risk'] = 'write';
  const argsLower = ` ${argsJoined.toLowerCase()} `;
  const forceFlag = /\s(--force(-with-lease)?|-f)\s/.test(argsLower);
  const deleteFlag = /\s(--delete|-d|-D)\s/.test(` ${argsJoined} `);
  if (verb === 'push' && (forceFlag || deleteFlag)) risk = 'destructive';
  else if (verb === 'reset' && argsLower.includes(' --hard ')) risk = 'destructive';
  else if (verb === 'clean' && /\s-[a-z]*f[a-z]*\s/i.test(argsLower)) risk = 'destructive';
  else if (verb === 'branch' && deleteFlag) risk = 'destructive';
  else if (verb === 'rm' || (verb === 'stash' && /\bdrop\b/i.test(argsJoined))) risk = 'destructive';
  // Generic destructive-word scan — skipped for `commit`, whose -m message is
  // free text ("fix: drop legacy flag" is not a destructive git operation).
  else if (verb !== 'commit' && DESTRUCTIVE_COMMAND_WORD_RE.test(`${verb} ${argsJoined}`)) risk = 'destructive';
  else if (GIT_READ_VERBS.has(verb)) risk = 'read';
  return finishPreview(verb ? `Git: ${verb}` : 'Git command', detail, risk);
}

function previewGmailWrite(a: Record<string, unknown>): ApprovalPreview {
  const action = str(a.action).toLowerCase() === 'draft' ? 'draft' : 'send';
  const to = clampText(str(a.to), 80) || '(no recipient)';
  const cc = clampText(str(a.cc), 60);
  const subject = clampText(str(a.subject), 100);
  const bodyLen = str(a.bodyText).length;
  const detail =
    `To: ${to}${cc ? `, cc: ${cc}` : ''}` +
    `${subject ? ` — Subject: "${subject}"` : ' — (no subject)'}` +
    `${bodyLen > 0 ? ` (${bodyLen} chars)` : ''}`;
  return finishPreview(
    action === 'draft' ? 'Draft email' : 'Send email',
    detail,
    action === 'draft' ? 'write' : 'destructive',
  );
}

function previewWordPress(tool: string, a: Record<string, unknown>): ApprovalPreview {
  const action = tool.slice('wp.'.length).replace(/[_-]+/g, ' ').trim() || 'action';
  const site = clampText(str(a.siteUrl), 80);
  const postId = finiteNum(a.postId);
  const postTitle = clampText(str(a.title) || str(a.expectedTitle) || str(a.postTitle), 80);
  const status = clampText(str(a.status), 20);
  const parts: string[] = [];
  if (site) parts.push(site);
  if (postId !== null || postTitle) {
    parts.push(`post${postId !== null ? ` #${postId}` : ''}${postTitle ? ` "${postTitle}"` : ''}`);
  }
  if (status) parts.push(`status: ${status}`);
  const detail = parts.length > 0 ? parts.join(' — ') : `WordPress ${action}`;

  let risk: ApprovalPreview['risk'] = 'write';
  if (/\b(trash|delete|remove)\b/.test(action)) risk = 'destructive';
  else if (/\b(list|discover|get|search)\b/.test(action)) risk = 'read';
  return finishPreview(`WordPress: ${action}`, detail, risk);
}

function previewEditFile(a: Record<string, unknown>): ApprovalPreview {
  const path = clampText(str(a.path), 120) || '(no path)';
  const editCount = Array.isArray(a.edits)
    ? a.edits.length
    : (a.oldString !== undefined || a.newString !== undefined ? 1 : 0);
  const detail = editCount > 0
    ? `${path} — ${editCount} edit${editCount === 1 ? '' : 's'}`
    : `${path} — no edits specified`;
  return finishPreview('Edit file', detail, 'write');
}

function previewFileWriteText(a: Record<string, unknown>): ApprovalPreview {
  const path = clampText(str(a.path), 120) || '(no path)';
  const contentLen = str(a.content).length;
  const mode = a.append === true ? 'append' : a.overwrite === true ? 'overwrite' : 'write';
  const detail = `${path} — ${mode} ${contentLen} chars`;
  return finishPreview('Write file', detail, mode === 'overwrite' ? 'destructive' : 'write');
}

/** Compact `key=value` arg summary for tools without a bespoke preview. */
function summarizeArgs(a: Record<string, unknown>): string {
  const parts: string[] = [];
  let keys: string[] = [];
  try {
    keys = Object.keys(a);
  } catch {
    keys = [];
  }
  for (const key of keys.slice(0, MAX_SUMMARY_KEYS)) {
    let value: unknown;
    try {
      value = a[key];
    } catch {
      continue;
    }
    if (value === undefined) continue;
    if (value === null) parts.push(`${key}=null`);
    else if (typeof value === 'string') parts.push(`${key}="${clampText(value, MAX_SUMMARY_VALUE_CHARS)}"`);
    else if (typeof value === 'number' || typeof value === 'boolean') parts.push(`${key}=${String(value)}`);
    else if (Array.isArray(value)) parts.push(`${key}=[${value.length} item${value.length === 1 ? '' : 's'}]`);
    else parts.push(`${key}={…}`);
  }
  if (keys.length > MAX_SUMMARY_KEYS) parts.push(`+${keys.length - MAX_SUMMARY_KEYS} more`);
  return parts.join(', ');
}

/**
 * Build a secret-redacted, human-readable approval-card preview for a tool
 * call: what will run (title + bounded detail < 300 chars) and how risky it is
 * (read/write/destructive). Knows local.run_shell, git.run, gmail.write /
 * external sends, wp.*, desktop.edit_file / desktop.file_write_text; every
 * other tool gets `Run <tool>` + a compact arg summary with risk inferred from
 * the tool name. Total: never throws on any input.
 */
export function buildApprovalPreview(toolName: unknown, args: unknown): ApprovalPreview {
  try {
    const tool = str(toolName).trim();
    const a = asRecord(args);

    if (tool === 'local.run_shell') return previewRunShell(a);
    if (tool === 'git.run') return previewGitRun(a);
    if (tool === 'gmail.write') return previewGmailWrite(a);
    if (tool.startsWith('wp.')) return previewWordPress(tool, a);
    if (tool === 'desktop.edit_file') return previewEditFile(a);
    if (tool === 'desktop.file_write_text') return previewFileWriteText(a);

    if (tool.length === 0) {
      const summary = summarizeArgs(a);
      return finishPreview('Approval required', summary || 'no tool specified', 'write');
    }

    // Generic external-send-ish tools surface recipient/subject/channel first.
    const risk = riskFromToolName(tool);
    const summary = summarizeArgs(a);
    if (risk === 'destructive' && nameSegments(tool).some((s) => EXTERNAL_SEND_NAME_SEGMENTS.has(s))) {
      const to = clampText(str(a.to) || str(a.recipient) || str(a.channel), 80);
      const subject = clampText(str(a.subject) || str(a.message) || str(a.bodyText) || str(a.text), 100);
      const sendDetail = to || subject
        ? `${to ? `To: ${to}` : ''}${to && subject ? ' — ' : ''}${subject ? `"${subject}"` : ''}`
        : summary;
      return finishPreview(`Send via ${tool}`, sendDetail || 'no arguments', 'destructive');
    }
    return finishPreview(`Run ${tool}`, summary || 'no arguments', risk);
  } catch {
    return { title: 'Approval required', detail: '', risk: 'write' };
  }
}

// ─── staleness ───────────────────────────────────────────────────────────────

/**
 * Classify a pending approval's age: fresh (< 5 min), stale (5–30 min),
 * expired (≥ 30 min). Fail-closed: an unknown / non-numeric age classifies as
 * 'expired' so an unverifiable approval is never silently reused. Negative
 * ages (clock skew) are fresh. Total: never throws.
 */
export function classifyApprovalAge(ageMs: unknown): ApprovalStaleness {
  const ms = finiteNum(ageMs);
  if (ms === null) return 'expired';
  if (ms < APPROVAL_STALE_MS) return 'fresh';
  if (ms < APPROVAL_EXPIRED_MS) return 'stale';
  return 'expired';
}

/**
 * Human age string for approval cards: 'just now' (< 1 min), 'X min ago'
 * (until expiry), then 'expired (X min old)' / 'expired (X hr old)' /
 * 'expired (X days old)'. Unknown / non-numeric age → 'age unknown'.
 * Total: never throws.
 */
export function describeApprovalAge(ageMs: unknown): string {
  const ms = finiteNum(ageMs);
  if (ms === null) return 'age unknown';
  if (ms < 60_000) return 'just now';
  const min = Math.max(1, Math.floor(ms / 60_000));
  if (ms < APPROVAL_EXPIRED_MS) return `${min} min ago`;
  if (min < 120) return `expired (${min} min old)`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `expired (${hr} hr old)`;
  const days = Math.floor(hr / 24);
  return `expired (${days} days old)`;
}
