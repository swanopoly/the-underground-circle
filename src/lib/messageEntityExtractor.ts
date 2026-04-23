/**
 * messageEntityExtractor.ts — Extracts structured entities from chat messages.
 *
 * Pulls out stack traces, file paths, URLs, GitHub refs, code blocks,
 * error codes, model mentions, and env vars. Used by the smart router
 * to boost intent confidence and by the task planner to auto-recommend tools.
 */

export interface MessageEntities {
  stackTraces: string[];
  filePaths: string[];
  urls: string[];
  githubRefs: Array<{ type: 'issue' | 'pr'; number: number }>;
  codeBlocks: Array<{ lang: string; code: string }>;
  mentionedModels: string[];
  errorCodes: string[];
  envVars: string[];
}

const EMPTY: MessageEntities = {
  stackTraces: [],
  filePaths: [],
  urls: [],
  githubRefs: [],
  codeBlocks: [],
  mentionedModels: [],
  errorCodes: [],
  envVars: [],
};

// ── Stack traces ──────────────────────────────────────────────────────────

const STACK_TRACE_PATTERNS = [
  // JS/TS: "TypeError: Cannot read property..."
  /\b(TypeError|ReferenceError|SyntaxError|RangeError|URIError|EvalError|InternalError)\s*:\s*.{5,120}/g,
  // JS stack frame: "at functionName (file:line:col)"
  /^\s*at\s+.+\(.+:\d+:\d+\)/gm,
  // Python: "Traceback (most recent call last):"
  /Traceback \(most recent call last\):/g,
  // Python frame: 'File "path", line N'
  /File ".+", line \d+/g,
  // Java/Kotlin: "at com.foo.Bar.method(File.java:123)"
  /^\s*at\s+[\w$.]+\([\w.]+:\d+\)/gm,
  // Go: "goroutine N [running]:" or "panic:"
  /\bpanic:\s*.+/g,
  // Rust: "thread 'main' panicked at"
  /thread '.+' panicked at/g,
];

function extractStackTraces(message: string): string[] {
  const traces: string[] = [];
  for (const pattern of STACK_TRACE_PATTERNS) {
    const matches = message.match(new RegExp(pattern.source, pattern.flags));
    if (matches) traces.push(...matches.map(m => m.trim()));
  }
  return traces;
}

// ── File paths ──────────────��─────────────────────────────────────────────

// Matches: src/lib/foo.ts, ./package.json, /Users/x/file.py, components/Bar.tsx
const FILE_PATH_RE = /(?:^|\s|`|\()((?:\.{0,2}\/)?(?:[\w@.-]+\/)+[\w.-]+\.(?:ts|tsx|js|jsx|py|rs|go|java|kt|rb|sql|md|json|yaml|yml|toml|css|scss|html|vue|svelte|sh|bash|zsh|env|lock|config|xml|proto|graphql|prisma))(?::\d+(?::\d+)?)?(?:\s|$|`|,|;|\))/gm;

function extractFilePaths(message: string): string[] {
  const paths: string[] = [];
  let match;
  while ((match = FILE_PATH_RE.exec(message)) !== null) {
    paths.push(match[1]);
  }
  // Reset lastIndex for reuse
  FILE_PATH_RE.lastIndex = 0;
  return [...new Set(paths)];
}

// ── URLs ──────────────────────────────────────────��───────────────────────

const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;

function extractUrls(message: string): string[] {
  return [...new Set(message.match(URL_RE) || [])];
}

// ── GitHub refs ─────────────────���─────────────────────────────────────────

const GH_ISSUE_RE = /(?:^|\s)#(\d{1,6})\b/gm;
const GH_PR_RE = /\bPR\s*#?(\d{1,6})\b/gi;
const GH_URL_RE = /github\.com\/[\w.-]+\/[\w.-]+\/(issues|pull)\/(\d+)/gi;

function extractGithubRefs(message: string): Array<{ type: 'issue' | 'pr'; number: number }> {
  const refs: Array<{ type: 'issue' | 'pr'; number: number }> = [];
  const seen = new Set<string>();

  let match;
  while ((match = GH_ISSUE_RE.exec(message)) !== null) {
    const prefix = message.slice(Math.max(0, match.index - 4), match.index).toUpperCase();
    if (/\bPR\s*$/.test(prefix)) continue;
    const key = `issue:${match[1]}`;
    if (!seen.has(key)) { refs.push({ type: 'issue', number: parseInt(match[1]) }); seen.add(key); }
  }
  GH_ISSUE_RE.lastIndex = 0;

  while ((match = GH_PR_RE.exec(message)) !== null) {
    const key = `pr:${match[1]}`;
    if (!seen.has(key)) { refs.push({ type: 'pr', number: parseInt(match[1]) }); seen.add(key); }
  }
  GH_PR_RE.lastIndex = 0;

  while ((match = GH_URL_RE.exec(message)) !== null) {
    const t = match[1] === 'pull' ? 'pr' : 'issue';
    const key = `${t}:${match[2]}`;
    if (!seen.has(key)) { refs.push({ type: t as 'issue' | 'pr', number: parseInt(match[2]) }); seen.add(key); }
  }
  GH_URL_RE.lastIndex = 0;

  return refs;
}

// ── Code blocks ───────��───────────────────────────────────────────────────

const CODE_BLOCK_RE = /```(\w*)\n([\s\S]*?)```/g;

function extractCodeBlocks(message: string): Array<{ lang: string; code: string }> {
  const blocks: Array<{ lang: string; code: string }> = [];
  let match;
  while ((match = CODE_BLOCK_RE.exec(message)) !== null) {
    blocks.push({ lang: match[1] || 'text', code: match[2].trim() });
  }
  CODE_BLOCK_RE.lastIndex = 0;
  return blocks;
}

// ── Model mentions ────────────���───────────────────────────────────────────

const MODEL_PATTERNS: Array<{ re: RegExp; name: string }> = [
  { re: /\b(opus)\b/i, name: 'opus' },
  { re: /\b(sonnet)\b/i, name: 'sonnet' },
  { re: /\b(haiku)\b/i, name: 'haiku' },
  { re: /\b(gpt-?4[.\d]*|gpt-?5[.\d]*)\b/i, name: 'gpt' },
  { re: /\b(gemini)\b/i, name: 'gemini' },
  { re: /\b(qwen|llama|mistral|deepseek)\b/i, name: 'open-source' },
];

function extractMentionedModels(message: string): string[] {
  return MODEL_PATTERNS.filter(p => p.re.test(message)).map(p => p.name);
}

// ── Error codes ─────────��───────────────────────────��─────────────────────

const ERROR_CODE_RE = /\b(4(?:0[0-9]|1[0-9]|2[0-9]|3[0-1])|5(?:0[0-9]|1[0-9]|2[0-9]))\b/g;
const NAMED_ERROR_RE = /\b(ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|CORS|ERR_CONNECTION_REFUSED|ERR_NAME_NOT_RESOLVED|SIGKILL|SIGTERM|OOM|ENOMEM)\b/gi;
const RUNTIME_ERROR_RE = /\b(TypeError|ReferenceError|SyntaxError|RangeError|URIError|EvalError|InternalError)\b/g;

function extractErrorCodes(message: string): string[] {
  const codes: string[] = [];
  const httpCodes = message.match(ERROR_CODE_RE) || [];
  const namedErrors = message.match(NAMED_ERROR_RE) || [];
  const runtimeErrors = message.match(RUNTIME_ERROR_RE) || [];
  codes.push(...httpCodes, ...namedErrors.map(e => e.toUpperCase()), ...runtimeErrors);
  return [...new Set(codes)];
}

// ── Environment variables ─────────────────────────────────────────────────

const ENV_VAR_RE = /\b((?:EXPO_PUBLIC_|NEXT_PUBLIC_|REACT_APP_|VITE_|SUPABASE_|ANTHROPIC_|OPENAI_|AWS_|GOOGLE_|GITHUB_)[A-Z_]+)\b/g;
const PROCESS_ENV_RE = /process\.env\.([A-Z_]+)/g;

function extractEnvVars(message: string): string[] {
  const vars: string[] = [];
  let match;
  while ((match = ENV_VAR_RE.exec(message)) !== null) vars.push(match[1]);
  ENV_VAR_RE.lastIndex = 0;
  while ((match = PROCESS_ENV_RE.exec(message)) !== null) vars.push(match[1]);
  PROCESS_ENV_RE.lastIndex = 0;
  return [...new Set(vars)];
}

// ── Public API ───────────────────────────────────────────���────────────────

export function extractMessageEntities(message: string): MessageEntities {
  if (!message || message.length < 3) return EMPTY;

  return {
    stackTraces: extractStackTraces(message),
    filePaths: extractFilePaths(message),
    urls: extractUrls(message),
    githubRefs: extractGithubRefs(message),
    codeBlocks: extractCodeBlocks(message),
    mentionedModels: extractMentionedModels(message),
    errorCodes: extractErrorCodes(message),
    envVars: extractEnvVars(message),
  };
}

/** Quick summary for UI display */
export function summarizeEntities(entities: MessageEntities): string | null {
  const parts: string[] = [];
  if (entities.stackTraces.length) parts.push(`${entities.stackTraces.length} trace${entities.stackTraces.length > 1 ? 's' : ''}`);
  if (entities.codeBlocks.length) parts.push(`${entities.codeBlocks.length} code block${entities.codeBlocks.length > 1 ? 's' : ''}`);
  if (entities.filePaths.length) parts.push(`${entities.filePaths.length} file${entities.filePaths.length > 1 ? 's' : ''}`);
  if (entities.githubRefs.length) parts.push(`${entities.githubRefs.length} GH ref${entities.githubRefs.length > 1 ? 's' : ''}`);
  if (entities.urls.length) parts.push(`${entities.urls.length} URL${entities.urls.length > 1 ? 's' : ''}`);
  if (entities.errorCodes.length) parts.push(`${entities.errorCodes.length} error code${entities.errorCodes.length > 1 ? 's' : ''}`);
  return parts.length > 0 ? parts.join(' + ') : null;
}

/** True if any non-trivial entities were found */
export function hasEntities(entities: MessageEntities): boolean {
  return entities.stackTraces.length > 0
    || entities.filePaths.length > 0
    || entities.codeBlocks.length > 0
    || entities.githubRefs.length > 0
    || entities.errorCodes.length > 0;
}
