/**
 * v2ToolSelectionCore — pure, Deno-importable tool-GROUP selector for the
 * swanbot-v2-ai per-turn tool loop.
 *
 * WHY THIS EXISTS
 * ---------------
 * `supabase/functions/swanbot-v2-ai/index.ts :: selectToolsForTurn` picks which
 * tool GROUPS a turn gets by running ~14 single-keyword regexes as a blind
 * union. A phrasing miss makes a whole GROUP absent for the ENTIRE run (the
 * tool list is frozen per request), so the model then falsely refuses with
 * "I don't have a tool for that". This core is a drop-in, regression-safe
 * SUPERSET of that regex block plus three real-gap fixes:
 *
 *   (a) capability co-occurrence edges — credentials⇒browser, real file-path
 *       ⇒coding, browser-login⇒credentials — so a request that names ONE half
 *       of a paired capability still gets the tools for the other half.
 *   (b) an imperative-action recall FLOOR — a genuine do/make/fix/change/build
 *       command (NOT an interrogative like "do you…?" / "can you…?" / "what…")
 *       widens to include workspace+tasks+research visibility, so action asks
 *       never start the run tool-starved.
 *
 * We deliberately SKIP the redundant coding⇒verification edge (the `coding`
 * group already ships verification.* tools) and wordpress⇒browser (the
 * `wordpress` group already ships browser.* tools).
 *
 * PURITY (load-bearing — the DENO edge fn imports this the same way it imports
 * src/lib/toolInputExamples.ts): zero runtime imports, no Date.now()/random at
 * module scope, every export TOTAL (never throws on null/undefined/wrong-type/
 * huge/hostile input → safe neutral value), bounded output. All regexes use
 * bounded quantifiers (no catastrophic backtracking) and input is length-capped.
 *
 * WIRING (edge fn): replace the inline regex block (index.ts ~2148-2161) with
 *   for (const g of selectToolGroups(text, mode).groups) addToolNames(selected, TOOL_GROUPS[g]);
 * The core also reproduces the mode→group block (~2140-2146), so both blocks
 * MAY be collapsed into the single loop; keeping the mode block is harmless
 * (the caller's Set dedupes).
 */

// ─── Public types ────────────────────────────────────────────────────────────

/** One of the swanbot-v2-ai `TOOL_GROUPS` keys. */
export type ToolGroupKey = string;

export interface ToolSelection {
  /** Deduped, canonical-ordered subset of TOOL_GROUP_KEYS. Bounded (≤ keys). */
  groups: ToolGroupKey[];
  /** Bounded, deterministic diagnostic of why these groups were chosen. */
  reason: string;
}

/**
 * The canonical TOOL_GROUPS keys, in stable order. `selectToolGroups` always
 * returns a subset of these in THIS order, so output is deterministic.
 */
export const TOOL_GROUP_KEYS: readonly string[] = [
  'research',
  'memory',
  'tasks',
  'messages',
  'rooms',
  'workspace',
  'approvals',
  'browser',
  'desktop',
  'wordpress',
  'credentials',
  'rewards',
  'verification',
  'coding',
];

const KEY_SET: ReadonlySet<string> = new Set(TOOL_GROUP_KEYS);

/** Total guard: is `value` a real tool-group key? */
export function isToolGroupKey(value: unknown): value is ToolGroupKey {
  return typeof value === 'string' && KEY_SET.has(value);
}

// ─── Bounds ──────────────────────────────────────────────────────────────────

const MAX_TEXT_LEN = 50_000;
const MAX_MODE_LEN = 40;
const MAX_REASON_LEN = 320;

// ─── Coercion (totality) ─────────────────────────────────────────────────────

/**
 * Coerce any input to a bounded, lowercased string. Non-string primitives are
 * stringified (matching the edge's `String(userMessage || "")`); objects,
 * arrays, functions, and symbols become '' rather than risk a hostile/throwing
 * toString. Never throws.
 */
function coerceText(text: unknown): string {
  let s: string;
  if (typeof text === 'string') s = text;
  else if (typeof text === 'number' || typeof text === 'boolean' || typeof text === 'bigint') s = String(text);
  else return '';
  if (s.length > MAX_TEXT_LEN) s = s.slice(0, MAX_TEXT_LEN);
  return s.toLowerCase();
}

function coerceMode(mode: unknown): string {
  if (typeof mode !== 'string') return '';
  const m = mode.trim().toLowerCase();
  return m.length > MAX_MODE_LEN ? '' : m;
}

// ─── Legacy keyword regexes (EXACT copies of index.ts 2148-2161) ─────────────
// Copied character-for-character so the reproduction is provably a superset of
// the current behavior. Applied to the lowercased text, exactly like the edge.

const RES = {
  research: /\b(research|source|cite|docs?|url|website|web page|http|https|latest|github|repo|pull request|workflow|deploy)\b/,
  memory: /\b(remember|memory|preference|decision|save this|recall|forget)\b/,
  tasks: /\b(task|todo|kanban|assign|mission|deadline|complete|done|review|approval)\b/,
  messages: /\b(message|reply|post in chat|send to chat|thread)\b/,
  workspace: /\b(room|workspace|artifact|preview|file|code|build|typecheck|test|lint|component|screen|page)\b/,
  browser: /\b(browser|chrome|safari|website|web app|form|click|fill|login|sign in|tab|url|captcha|cloudflare|verification|not a robot)\b/,
  desktop: /\b(desktop|computer|mac|app|launch|focus|window|clipboard|screenshot|screen|finder|terminal|keyboard|mouse|photoshop|photo shop|illustrator|lightroom|premiere|after effects|figma|canva|blender|image editor|photo editor|image editing|photo editing|retouch|mockup)\b/,
  desktopFilePath: /(?:^|\s)(?:~\/|\/users\/|\/downloads?\/|\/desktop\/)|\b(files?|folders?|finder|desktop|downloads?|documents?|pictures?|photos?|local path|open path)\b|\b[A-Za-z0-9][A-Za-z0-9 ._@()+-]{0,120}\.(?:png|jpe?g|gif|webp|tiff?|bmp|heic|pdf|txt|md|json|csv|docx?|xlsx?|pptx?|psd|psb|indd|idml|zip)\b/i,
  wordpress: /\b(wordpress|wp-|wp |post|page|media|slide|publish|draft|cms|dealer inspire|dealerinspire|di_slide|flavor_di_slides|di slides?|quick edit|expiration_date|admin\.php|reload cache)\b/,
  credentials: /\b(credential|credentials|password|username|email|1password|vault|secret)\b/,
  rewards: /\b(score|scores|points|xp|badge|badges|leaderboard|rank|ranking|streak|karma)\b/,
  verification: /\b(typecheck|tests?|lint|verify|verification|ci|smoke)\b/,
  coding: /\b(code|coding|codebase|git|commit|diff|branch|repo|repository|npm|pnpm|yarn|pytest|vitest|jest|tsc|eslint|typecheck|lint|refactor|debug|stack trace|shell|terminal|run tests?|test suite|smoke|str_replace|edit (?:the )?(?:file|code))\b/,
  approvals: /\b(send|post|publish|delete|update|create|submit|external)\b/,
} as const;

// ─── New capability detectors (edge-fix layer) ───────────────────────────────

// Login phrasings, INCLUDING the space variants the legacy `browser` regex
// misses ("log into", "log in to", "sign into", "log on"). Drives the browser
// surface + the browser-login⇒credentials edge.
const LOGIN_RE = /\b(?:log\s*in|log\s*into|log\s*on|logging\s*in|logging\s*into|sign\s*in|sign\s*into|sign\s*on|signin|signon)\b/;

// STRICT real-file-path / code-or-doc-file detector for the desktop-file-path
// ⇒coding edge. Narrower ON PURPOSE than RES.desktopFilePath (no bare folder
// words like "photos"/"documents") so ONLY a concrete path or a real file with
// an extension pulls in code tools. Bounded quantifier; safe on hostile input.
const DESKTOP_PATH_STRICT_RE =
  /(?:^|\s)(?:~\/|\/users\/|\/downloads?\/|\/desktop\/|\.{0,2}\/[a-z0-9])|\b[a-z0-9][a-z0-9 ._@()+-]{0,120}\.(?:ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|kt|swift|c|cc|cpp|h|hpp|cs|php|css|scss|html?|json|jsonc|md|markdown|txt|csv|tsv|yml|yaml|toml|xml|sh|bash|zsh|sql|psd|psb|indd|idml|pdf|docx?|xlsx?|pptx?|zip)\b/i;

// ─── Imperative-action recall floor ──────────────────────────────────────────

const LEADING_NOISE_RE = /^[\s"'“”‘’([{*_>#\-]+/;

// Interrogatives that must NOT trigger the floor.
const WH_LEAD_RE = /^(?:what|whats|what's|why|when|where|who|whom|whose|which|how)\b/;
// Pure auxiliaries that begin questions but never imperatives ("is it done?",
// "can you…", "should we…"). "do"/"have" are handled separately below because
// they double as imperative main verbs ("do the task", "have it ready").
const AUX_LEAD_RE =
  /^(?:does|did|can|could|would|will|shall|should|is|are|was|were|has|had|am|may|might|isn't|aren't|can't|won't|wouldn't|shouldn't|didn't|doesn't|isnt|arent|cant|wont|wouldnt|shouldnt|didnt|doesnt)\b/;
// "do you / have we / do they …" = subject-aux inversion → question. Note "it"
// is intentionally EXCLUDED ("do it" is imperative, not a question).
const AUX_SUBJECT_LEAD_RE = /^(?:do|have)\s+(?:you|we|they|i|u|ya)\b/;

// A true action command. Optional polite/sequencing prefixes, then a concrete
// imperative verb. Word-boundary anchored so "changelog"/"adding" don't match.
const IMPERATIVE_LEAD_RE =
  /^(?:(?:please|pls|plz|kindly|now|then|also|first|next|finally|hey|ok|okay|just|lets|let['’]?s|let us|go ahead and|go and|go|and|i need (?:you )?to|i want (?:you )?to|i['’]?d like (?:you )?to|we need to|we should|you should|help me)\s+)*(?:do|make|fix|change|build|create|add|implement|update|remove|delete|write|refactor|rename|move|generate|produce|set ?up|install|configure|wire|connect|integrate|deploy|ship|run|edit|rewrite|replace|patch|resolve|scaffold|draft|design|develop|apply|convert|migrate|upgrade|improve|optimize|finish|complete)\b/;

/** Internal: interrogative test on an already-lowercased string. */
function isInterrogativeText(t: string): boolean {
  if (!t) return false;
  if (/\?\s*$/.test(t)) return true; // ends with a question mark
  const s = t.replace(LEADING_NOISE_RE, '');
  if (!s) return false;
  if (WH_LEAD_RE.test(s)) return true;
  if (AUX_LEAD_RE.test(s)) return true;
  if (AUX_SUBJECT_LEAD_RE.test(s)) return true;
  return false;
}

/** Internal: imperative-action test on an already-lowercased string. */
function isImperativeLower(t: string): boolean {
  if (!t) return false;
  if (isInterrogativeText(t)) return false;
  const s = t.replace(LEADING_NOISE_RE, '');
  return IMPERATIVE_LEAD_RE.test(s);
}

/**
 * Total, exported: does `text` read as a genuine do/make/fix/change/build
 * imperative that is NOT phrased as a question? Never throws.
 */
export function isImperativeActionText(text: unknown): boolean {
  return isImperativeLower(coerceText(text));
}

// ─── Core selection ──────────────────────────────────────────────────────────

const IMPERATIVE_FLOOR_GROUPS: readonly string[] = ['workspace', 'tasks', 'research'];

function finalize(groups: Set<string>, reasons: string[]): ToolSelection {
  const ordered = TOOL_GROUP_KEYS.filter((k) => groups.has(k));
  let reason = reasons.join('; ');
  if (reason.length > MAX_REASON_LEN) reason = reason.slice(0, MAX_REASON_LEN);
  if (!reason) reason = 'no-signal';
  return { groups: ordered, reason };
}

/**
 * Select the tool GROUPS a turn should receive. Regression-safe SUPERSET of the
 * edge's mode block (2140-2146) + keyword block (2148-2161), plus capability
 * edges and the imperative floor. Deterministic, deduped, canonically ordered.
 * TOTAL: any input shape yields a valid { groups, reason } — never throws.
 */
export function selectToolGroups(text: unknown, mode: unknown): ToolSelection {
  const t = coerceText(text);
  const m = coerceMode(mode);
  const groups = new Set<string>();
  const reasons: string[] = [];

  // (0) mode→group parity (index.ts 2140-2146).
  const modeGroups: string[] = [];
  if (m === 'research') modeGroups.push('research');
  if (m === 'build' || m === 'design' || m === 'review') modeGroups.push('workspace');
  if (m === 'build' || m === 'design') modeGroups.push('coding');
  if (m === 'execute') {
    modeGroups.push('tasks');
    modeGroups.push('approvals');
  }
  for (const g of modeGroups) groups.add(g);
  if (modeGroups.length > 0) reasons.push('mode:' + m);

  if (!t) return finalize(groups, reasons);

  // (1) legacy keyword→group reproduction (SUPERSET of 2148-2161).
  const loginDetected = LOGIN_RE.test(t);
  const filePathMatched = RES.desktopFilePath.test(t);
  const browserMatched = RES.browser.test(t) || loginDetected; // login extends browser
  const credentialsMatched = RES.credentials.test(t);

  const kw: string[] = [];
  if (RES.research.test(t)) kw.push('research');
  if (RES.memory.test(t)) kw.push('memory');
  if (RES.tasks.test(t)) kw.push('tasks');
  if (RES.messages.test(t)) kw.push('messages');
  if (RES.workspace.test(t)) kw.push('workspace');
  if (browserMatched) kw.push('browser');
  if (RES.desktop.test(t) || filePathMatched) kw.push('desktop');
  if (RES.wordpress.test(t)) kw.push('wordpress');
  if (credentialsMatched) kw.push('credentials');
  if (RES.rewards.test(t)) kw.push('rewards');
  if (RES.verification.test(t)) kw.push('verification');
  if (RES.coding.test(t)) kw.push('coding');
  if (RES.approvals.test(t)) kw.push('approvals');
  for (const g of kw) groups.add(g);
  if (kw.length > 0) reasons.push('kw:' + kw.join(','));

  // (2) capability co-occurrence edges — REAL-GAP fixes only. Computed from the
  // ORIGINAL triggers (no cascading), so the result is order-independent.
  const edges: string[] = [];
  // credentials⇒browser: a credential ask almost always means a browser login.
  if (credentialsMatched && !groups.has('browser')) {
    groups.add('browser');
    edges.push('credentials→browser');
  }
  // browser-login⇒credentials: a login needs the credential/vault tools.
  if (loginDetected && !groups.has('credentials')) {
    groups.add('credentials');
    edges.push('browser-login→credentials');
  }
  // desktop-file-path⇒coding: a concrete file path implies read/edit tools.
  if (filePathMatched && DESKTOP_PATH_STRICT_RE.test(t) && !groups.has('coding')) {
    groups.add('coding');
    edges.push('desktop-file-path→coding');
  }
  // (Intentionally NOT added: coding→verification and wordpress→browser — both
  // redundant because those groups already carry the target tools.)
  if (edges.length > 0) reasons.push('edge:' + edges.join(','));

  // (3) imperative-action recall floor.
  if (isImperativeLower(t)) {
    for (const g of IMPERATIVE_FLOOR_GROUPS) groups.add(g);
    reasons.push('imperative-floor');
  }

  return finalize(groups, reasons);
}
