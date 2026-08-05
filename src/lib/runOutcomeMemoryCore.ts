/**
 * runOutcomeMemoryCore — PURE "is this run worth remembering, and what exactly
 * should the memory say" logic for the unified agent-run loop.
 *
 * WHY THIS EXISTS
 * ---------------
 * `agentRuntime.executeAgentRun` is the ONE entry point for Chat, Rooms, Feed,
 * Office Terminal and every Computer-Use / app-automation run that routes
 * through it — and until now it distilled ZERO memories. It fires
 * `recordArchiveDerivedMemorySuccess` / `…WeakSignal`, but those SCORE memories
 * the run *consumed* (a `memory_evaluations` insert plus an update on an
 * existing row); they never CREATE one. So the highest-value learnings in the
 * product — which adapter worked for Photoshop, which selector worked in the WP
 * admin, which capability buildout succeeded, which approach failed and why —
 * were discarded every run and the same failures repeated forever.
 *
 * THE SIGNAL/NOISE BAR (the whole point of this file)
 * ---------------------------------------------------
 * A hook that saves noise is WORSE than no hook: every junk row is embedded
 * into pgvector and competes for the bounded memory slots in every later
 * prompt. So capture requires BOTH halves of a lesson:
 *
 *   1. A REUSABLE SUBJECT — something a future run can match on. Ranked:
 *      `lane` (app-automation pipeline / primary surface — the Computer-Use
 *      dimension), `route` (execution kind + route id), `profile`
 *      (task kind + capability profile). No subject → no memory. "The agent did
 *      a thing" is not a subject.
 *   2. A TRANSFERABLE FINDING — a specific, non-obvious fact that changes what
 *      a future run would do: a named tool/adapter, a durable artifact, a
 *      verification result, a concrete failure reason, or a response sentence
 *      carrying a real referent (tool id, path, selector, URL, app name).
 *
 * And it must survive four explicit noise gates:
 *   • PROMPT RESTATEMENT — a sentence whose significant tokens are already in
 *     the prompt teaches nothing; it is dropped before scoring.
 *   • GENERIC COMPLETION — "task completed", "here you go", "all set".
 *   • ONE-OFF VALUE — content dominated by a uuid / timestamp / run id with no
 *     reusable frame around it.
 *   • CREDENTIAL SHAPE — refused outright via the SAME detector the
 *     `saveMemory` chokepoint uses (`userMemoryCaps.detectCredentialMemoryContent`),
 *     so a leaked token can never become a standing prompt-injected secret.
 *     Applied per-sentence (drop the poisoned sentence, keep the lesson) AND to
 *     the final composed text (hard backstop).
 *
 * FAILURES ARE CHEAPER TO CAPTURE THAN SUCCESSES, ON PURPOSE. Not repeating a
 * failure is the product's entire value proposition, and a failure reason is
 * almost always specific. A SUCCESS must clear a higher bar (proof: durable
 * artifacts, a passed verification, or a referent-bearing sentence) because an
 * unproven "it worked" is exactly the class of row that dilutes retrieval —
 * and `terminalStatus: 'inconclusive'` (the honest default when the runtime
 * exposes no structured proof) must NEVER be written down as "this worked".
 *
 * QUALITY BAR REUSE, NOT A SECOND STANDARD
 * ----------------------------------------
 * The shared bar is `memoryConsolidation.isHighQualityMemory`. It cannot be
 * imported here (it pulls `supabase` → react-native, which tsx cannot load), so
 * the CALLER applies the real function as the final gate and this core is built
 * to always clear it: `memoryKind` is always `'finding'` (+1 in its quality
 * score, which is the pass threshold) and `MIN_LESSON_CHARS` sits well above
 * its 15-char floor. `scripts/run-outcome-memory-core-smoketest.ts` asserts
 * those two facts against the real source text, so drift in either file fails
 * loudly instead of silently disabling capture.
 *
 * PURE: `import type` only for heavy deps, plus the dependency-free
 * `userMemoryCaps`. No `Date.now()` — callers pass `nowMs`. Every export is
 * total (never throws, degenerate input → a `capture: false` decision).
 */

import { detectCredentialMemoryContent } from './userMemoryCaps';
import type { CredentialMemoryFinding } from './userMemoryCaps';
import type { AgentTaskTerminalOutcomeStatus } from './computerTaskOutcome';
import type { MemoryKind } from './agentRunSystem';

// ── Bounds ──────────────────────────────────────────────────────────────────
// Nothing here persists a raw prompt or a raw response. The prompt appears only
// as a clamped intent line (retrieval anchor); the response contributes at most
// two clamped, referent-bearing sentences.

export const RUN_OUTCOME_MEMORY_VERSION = 'run_outcome_memory_v1';
/** Always 'finding' — see the quality-bar note in the file header. */
export const RUN_OUTCOME_MEMORY_KIND: MemoryKind = 'finding';
export const MAX_TITLE_CHARS = 110;
export const MAX_CONTENT_CHARS = 1_100;
/** Sub-budget for the lesson itself, reserved BEFORE the retrieval frame
 *  (subject / context / attempted / observed) so a verbose frame can never
 *  squeeze the finding out of the row. */
export const MAX_LESSON_BODY_CHARS = 720;
export const MAX_EXCERPT_CHARS = 220;
export const MAX_INTENT_CHARS = 160;
export const MAX_REASON_CHARS = 220;
export const MAX_EVIDENCE_SENTENCE_CHARS = 240;
export const MAX_EVIDENCE_SENTENCES = 2;
export const MAX_TOOL_NAMES = 5;
export const MAX_BLOCKERS = 3;
export const MAX_ARTIFACT_KINDS = 4;
export const MAX_SUBJECT_CHARS = 72;
export const MAX_SCAN_CHARS = 20_000;

/** Minimum length of the composed lesson body. Must exceed the shared bar's
 *  15-char floor (`memoryConsolidation.isHighQualityMemory`). */
export const MIN_LESSON_CHARS = 48;
export const MIN_EVIDENCE_SENTENCE_CHARS = 40;
/** Distinct reusable tokens required after stripping one-off identifiers. */
export const MIN_REUSABLE_TOKENS = 4;
/** A sentence this contained in the prompt is an echo, not a lesson. */
export const PROMPT_RESTATEMENT_MAX_OVERLAP = 0.72;

/** Mirrors `memoryConsolidation.isHighQualityMemory`'s hard length floor.
 *  Asserted against the real source in the smoke test. */
export const HIGH_QUALITY_BAR_MIN_CONTENT_CHARS = 15;

// ── Public types ────────────────────────────────────────────────────────────

export type RunOutcomeLessonKind = 'failure' | 'success';

export type RunOutcomeSubjectTier = 'lane' | 'route' | 'profile';

export type RunOutcomeSkipReason =
  | 'degenerate_input'
  | 'cancelled_run'
  | 'no_reusable_subject'
  | 'no_transferable_finding'
  | 'prompt_restatement'
  | 'generic_completion'
  | 'one_off_value'
  | 'too_short'
  | 'credential_shaped';

/** The Computer-Use / app-automation dimension, projected off
 *  `ChatAgentContextPack` by the caller. All fields optional and untrusted. */
export type RunOutcomeAutomationInput = {
  executionKind?: string | null;
  routeId?: string | null;
  risk?: string | null;
  pipelineId?: string | null;
  pipelineTitle?: string | null;
  category?: string | null;
  pattern?: string | null;
  primarySurface?: string | null;
  recommendedTools?: readonly string[] | null;
};

/** Structural projection of `OpenSwanObservedEvalSummary` — kept local so the
 *  core never depends on that module's evolution. */
export type RunOutcomeObservedEvalInput = {
  outcome?: string | null;
  score?: number | null;
  verification?: {
    planned?: number | null;
    executed?: number | null;
    passed?: number | null;
    failed?: number | null;
    manualRequired?: number | null;
    blocked?: number | null;
  } | null;
  artifacts?: { total?: number | null; durable?: number | null; kinds?: readonly string[] | null } | null;
  tools?: {
    total?: number | null;
    failed?: number | null;
    manualRequired?: number | null;
    blocked?: number | null;
    names?: readonly string[] | null;
  } | null;
  /** `OpenSwanObservedEvalSummary.blockers` — the runtime's own account of what
   *  stopped the run. The single highest-signal failure input available here. */
  blockers?: readonly string[] | null;
};

export type RunOutcomeMemoryInput = {
  /** Caller-supplied clock. No `Date.now()` in this module. */
  nowMs: number;
  runId?: string | null;
  /** HONEST surface — pass the run's real `AgentSurface`, never a constant. */
  surface?: string | null;
  mode?: string | null;
  taskKind?: string | null;
  profile?: string | null;
  impactDomain?: string | null;
  routingIntent?: string | null;
  prompt?: string | null;
  response?: string | null;
  errorMessage?: string | null;
  terminalStatus?: AgentTaskTerminalOutcomeStatus | string | null;
  terminalReason?: string | null;
  observedEval?: RunOutcomeObservedEvalInput | null;
  artifacts?: readonly { kind?: string | null; title?: string | null }[] | null;
  automation?: RunOutcomeAutomationInput | null;
  toolNames?: readonly string[] | null;
};

export type RunOutcomeMemoryWrite = {
  memoryKind: MemoryKind;
  title: string;
  content: string;
  excerpt: string;
  importance: number;
  retrievalMode: 'on_demand';
  /** Honest run provenance. `null` when the run was never persisted or the id
   *  is not uuid-shaped (`memory_entries.source_run_id` is a uuid column). */
  sourceRunId: string | null;
  /** Honest surface, echoed from the caller. Never a hard-coded lie. */
  sourceSurface: string;
  lessonKind: RunOutcomeLessonKind;
  subjectKey: string;
  subjectTier: RunOutcomeSubjectTier;
  findingStrength: number;
  /** Stable across identical runs — the caller uses it to avoid writing the
   *  same lesson twice (duplicate rows are the dilution risk this file exists
   *  to prevent). */
  fingerprint: string;
  /** Primitive-only, bounded — safe for a jsonb column and for the bounded
   *  metadata projections `agentRunPersistence` already enforces elsewhere. */
  metadata: Record<string, string | number | boolean | null>;
};

export type RunOutcomeMemoryDecision =
  | { capture: false; reason: RunOutcomeSkipReason; detail: string }
  | { capture: true; memory: RunOutcomeMemoryWrite };

// ── Text helpers (all total) ────────────────────────────────────────────────

function asText(value: unknown, maxScan = MAX_SCAN_CHARS): string {
  if (typeof value === 'string') return value.slice(0, maxScan);
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function collapse(value: unknown): string {
  return asText(value).replace(/\s+/g, ' ').trim();
}

/** Word-boundary truncation with an ellipsis. Never returns more than `max`. */
export function clampText(value: unknown, max: number): string {
  const text = collapse(value);
  const limit = Number.isFinite(max) && max > 1 ? Math.floor(max) : 1;
  if (text.length <= limit) return text;
  const head = text.slice(0, limit - 1);
  const cut = head.lastIndexOf(' ');
  const body = cut > limit * 0.6 ? head.slice(0, cut) : head;
  return `${body.replace(/[\s,.;:—-]+$/, '')}…`.slice(0, limit);
}

/**
 * Newline-preserving bound for the composed memory body. `clampText` collapses
 * whitespace (right for a sentence, wrong for a block), so the block is bounded
 * line-wise instead: whole lines are dropped from the tail, and the last kept
 * line is clamped rather than cut mid-token.
 */
export function clampBlock(lines: readonly string[], max: number): string {
  const limit = Number.isFinite(max) && max > 1 ? Math.floor(max) : 1;
  const out: string[] = [];
  let used = 0;
  for (const raw of Array.isArray(lines) ? lines : []) {
    const line = typeof raw === 'string' ? raw : '';
    if (!line) continue;
    const cost = (out.length > 0 ? 1 : 0) + line.length;
    if (used + cost <= limit) {
      out.push(line);
      used += cost;
      continue;
    }
    const remaining = limit - used - (out.length > 0 ? 1 : 0);
    if (remaining >= MIN_EVIDENCE_SENTENCE_CHARS) out.push(clampText(line, remaining));
    break;
  }
  return out.join('\n').slice(0, limit);
}

function toCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function toStringList(value: unknown, max: number, maxChars = 60): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of value) {
    if (out.length >= max) break;
    const item = collapse(raw).slice(0, maxChars);
    if (!item) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'was', 'were', 'been', 'have', 'has',
  'had', 'you', 'your', 'our', 'their', 'they', 'them', 'its', 'are', 'not', 'but', 'can',
  'will', 'would', 'should', 'could', 'into', 'onto', 'over', 'then', 'than', 'when', 'what',
  'which', 'while', 'about', 'after', 'before', 'here', 'there', 'also', 'just', 'like',
  'make', 'made', 'need', 'needs', 'want', 'wants', 'use', 'used', 'using', 'get', 'got',
  'all', 'any', 'one', 'two', 'per', 'via', 'out', 'off', 'now', 'new', 'more', 'most',
  'some', 'such', 'only', 'own', 'same', 'very', 'each', 'both', 'few', 'able', 'please',
]);

/** Lowercased, punctuation-stripped, stop-word-free tokens of length >= 3. */
export function significantTokens(value: unknown): Set<string> {
  const out = new Set<string>();
  const text = collapse(value).toLowerCase();
  if (!text) return out;
  for (const raw of text.split(/[^a-z0-9_./#[\]-]+/)) {
    const token = raw.replace(/^[-._/#[\]]+|[-._/#[\]]+$/g, '');
    if (token.length < 3) continue;
    if (STOP_WORDS.has(token)) continue;
    out.add(token);
  }
  return out;
}

/** Fraction of `subject`'s significant tokens already present in `reference`. */
export function tokenContainment(subject: unknown, reference: unknown): number {
  const subjectTokens = significantTokens(subject);
  if (subjectTokens.size === 0) return 0;
  const referenceTokens = significantTokens(reference);
  if (referenceTokens.size === 0) return 0;
  let hits = 0;
  for (const token of subjectTokens) if (referenceTokens.has(token)) hits += 1;
  return hits / subjectTokens.size;
}

// One-off identifiers: unique to a single run, worthless to a future one.
const ONE_OFF_PATTERNS: RegExp[] = [
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, // uuid
  /\b[0-9a-f]{12,}\b/gi,                                                // long hex / sha
  /\b\d{4}-\d{2}-\d{2}T[\d:.]+Z?\b/g,                                   // iso timestamp
  /\b\d{6,}\b/g,                                                        // long integer ids
];

function stripOneOffIdentifiers(text: string): string {
  let out = text;
  for (const pattern of ONE_OFF_PATTERNS) out = out.replace(pattern, ' ');
  return out;
}

/** True when the text carries no reusable frame around its one-off values. */
export function isOneOffValueOnly(value: unknown): boolean {
  const text = collapse(value);
  if (!text) return true;
  return significantTokens(stripOneOffIdentifiers(text)).size < MIN_REUSABLE_TOKENS;
}

const GENERIC_COMPLETION_PATTERNS: RegExp[] = [
  /^(the\s+)?task\s+(is\s+)?(now\s+)?(complete|completed|done|finished)\b/i,
  /^(i(\s*'ve|\s+have)?\s+)?(successfully\s+)?(completed|finished|handled|taken care of)\b[^.]{0,48}$/i,
  /^(all\s+(set|done)|everything\s+(is\s+)?(done|complete|working)|done|complete|completed|finished)\b[^.]{0,24}$/i,
  /^(here('s|\s+is)\s+(the|your|a)\b|here\s+you\s+go)/i,
  /^(sure|ok|okay|got\s+it|no\s+problem|happy\s+to\s+help|let\s+me\s+know)\b/i,
  /^(i\s+)?(hope\s+this\s+helps|hope\s+that\s+helps)\b/i,
  /^(as\s+requested|per\s+your\s+request)\b[^.]{0,40}$/i,
  /^(the\s+)?(run|operation|action|request)\s+(was\s+)?(successful|completed|succeeded)\b[^.]{0,32}$/i,
];

/** True for restatements of "I did the thing" that carry no transferable fact. */
export function isGenericCompletionText(value: unknown): boolean {
  const text = collapse(value);
  if (!text) return true;
  return GENERIC_COMPLETION_PATTERNS.some((pattern) => pattern.test(text));
}

// A referent is what makes a sentence transferable: something a future run can
// actually act on. Prose without one is narration.
const REFERENT_PATTERNS: RegExp[] = [
  /\b[a-z][a-z0-9_]*\.[a-z][a-z0-9_]{2,}\b/,                            // tool ids: desktop.observe_app
  /(^|\s)\/[\w.-]+\/[\w.\-/]+/,                                          // absolute paths
  /\b[\w-]+\.(tsx?|jsx?|mjs|cjs|json|sql|php|py|rb|go|rs|css|scss|html|psd|ai|indd|dwg|step|stl)\b/i,
  /https?:\/\/\S+/i,                                                     // URLs
  /(^|\s)(#[a-z][\w-]{2,}|\.[a-z][\w-]{2,}(\s|$)|\[[\w-]+[=\]]|data-[\w-]+)/i, // selectors
  /\b(photoshop|illustrator|indesign|extendscript|applescript|firefly|wordpress|dealer\s?inspire|browserbase|stagehand|chrome|safari|finder|figma|fusion\s?360|onshape|solidworks|freecad|accessibility\s+tree|a11y|xcode|terminal)\b/i,
  /\b(selector|adapter|endpoint|permission|entitlement|scope|token\s+scope|rate\s?limit|timeout|retry|fallback|epoch|receipt|grant|allowlist|bridge)\b/i,
  /\b(error|failed|failure|denied|refused|blocked|missing|not\s+found|timed\s+out|unauthorized|forbidden|unsupported|stale|invalid)\b/i,
];

/** True when a sentence names something a future run can act on. */
export function hasConcreteReferent(value: unknown): boolean {
  const text = collapse(value);
  if (!text) return false;
  return REFERENT_PATTERNS.some((pattern) => pattern.test(text));
}

/** Sentence split that survives code fences, lists and missing punctuation. */
export function splitSentences(value: unknown): string[] {
  const text = asText(value);
  if (!text) return [];
  return text
    .replace(/```[\s\S]*?```/g, ' ')   // drop fenced code — bulk, not lesson
    .replace(/\r/g, '')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((line) => collapse(line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '')))
    .filter(Boolean);
}

/** Deterministic, dependency-free 32-bit hash (djb2-xor), base36. */
export function stableHash(value: unknown): string {
  const text = asText(value);
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(i);
    hash |= 0;
  }
  return (hash >>> 0).toString(36);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `memory_entries.source_run_id` is a uuid column — a non-uuid would make the
 *  insert throw inside a fire-and-forget path. Fail to `null`, never to junk. */
export function normalizeSourceRunId(value: unknown): string | null {
  const text = collapse(value);
  return UUID_RE.test(text) ? text.toLowerCase() : null;
}

function slug(value: unknown, max = 48): string {
  return collapse(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max);
}

function utcDay(nowMs: unknown): string {
  const ms = typeof nowMs === 'number' && Number.isFinite(nowMs) ? nowMs : NaN;
  if (!Number.isFinite(ms)) return '';
  const date = new Date(ms);
  const iso = Number.isNaN(date.getTime()) ? '' : date.toISOString();
  return iso ? iso.slice(0, 10) : '';
}

function credentialFinding(value: unknown): CredentialMemoryFinding | null {
  try {
    return detectCredentialMemoryContent(asText(value));
  } catch {
    // The detector is pure and total, but a memory write must never be the
    // thing that throws. Unknown → treat as unsafe.
    return { rule: 'high_entropy_secret', label: 'credential scan unavailable' };
  }
}

// ── Subject resolution ──────────────────────────────────────────────────────
// The subject is what a FUTURE run matches on. Without one there is nothing to
// retrieve the lesson by, so the row would only ever dilute.

/** Execution kinds that actually DO something to another surface. A
 *  `local_reply` / `run_plain_chat` / `ask_clarification` run has no lesson. */
const ACTING_EXECUTION_KINDS = new Set([
  'run_computer_task',
  'run_browser_plan',
  'run_circle_automation',
  'create_circle_automation',
  'run_build_discovery',
  'run_openswan',
  'run_command_handler',
]);

/** Task kinds whose runs change the world. `talk`/`review`/`research` runs can
 *  still be captured — but only via a lane or route subject, never on the task
 *  kind alone, because "research/openswan_researcher" matches everything. */
const LESSON_TASK_KINDS = new Set(['build', 'debug', 'architect', 'automation']);

export type RunOutcomeSubject = {
  label: string;
  key: string;
  tier: RunOutcomeSubjectTier;
};

/** Best available reusable subject, or `null` when the run has none. */
export function resolveRunOutcomeSubject(input: RunOutcomeMemoryInput | null | undefined): RunOutcomeSubject | null {
  const automation = (input && typeof input === 'object' ? input.automation : null) || null;
  const pipelineTitle = collapse(automation?.pipelineTitle);
  const pipelineId = collapse(automation?.pipelineId);
  const primarySurface = collapse(automation?.primarySurface);
  const category = collapse(automation?.category);
  const pattern = collapse(automation?.pattern);
  const executionKind = collapse(automation?.executionKind);
  const routeId = collapse(automation?.routeId);

  // Tier 1 — the app-automation lane. This is the Computer-Use dimension and
  // the most transferable subject the runtime has: "WP admin media upload on
  // desktop_bridge" is exactly what a future run needs to match.
  const laneName = pipelineTitle || pipelineId || (primarySurface && category ? `${category} on ${primarySurface}` : '');
  if (laneName) {
    const label = clampText(
      [laneName, primarySurface && !laneName.includes(primarySurface) ? `on ${primarySurface}` : '']
        .filter(Boolean)
        .join(' '),
      MAX_SUBJECT_CHARS,
    );
    const key = ['lane', slug(pipelineId || pipelineTitle || category), slug(primarySurface)].filter(Boolean).join(':');
    if (label && key.length > 5) return { label, key, tier: 'lane' };
  }

  // Tier 2 — the routed execution kind. Weaker than a lane but still names a
  // concrete pipeline of the app.
  if (executionKind && ACTING_EXECUTION_KINDS.has(executionKind)) {
    const label = clampText(
      [executionKind.replace(/_/g, ' '), routeId ? `(${routeId})` : '', pattern && !routeId ? `(${pattern})` : '']
        .filter(Boolean)
        .join(' '),
      MAX_SUBJECT_CHARS,
    );
    const key = ['route', slug(routeId || executionKind), slug(primarySurface)].filter(Boolean).join(':');
    if (label) return { label, key, tier: 'route' };
  }

  // Tier 3 — task kind + capability profile, the OpenSwan precedent's subject.
  // Deliberately the weakest tier: it carries an extra strength requirement in
  // `buildRunOutcomeMemory` because it matches broadly.
  const taskKind = collapse(input?.taskKind).toLowerCase();
  const profile = collapse(input?.profile);
  if (taskKind && LESSON_TASK_KINDS.has(taskKind)) {
    const label = clampText([taskKind, profile].filter(Boolean).join('/'), MAX_SUBJECT_CHARS);
    const key = ['task', slug(taskKind), slug(profile)].filter(Boolean).join(':');
    if (label) return { label, key, tier: 'profile' };
  }

  return null;
}

// ── Evidence assembly ───────────────────────────────────────────────────────

export type RunOutcomeEvidenceSentence = {
  text: string;
  /** Why a candidate sentence was rejected — drives the honest skip reason. */
  rejected: 'echo' | 'generic' | 'no_referent' | 'too_short' | 'credential' | null;
};

/**
 * Response prose → at most `MAX_EVIDENCE_SENTENCES` clamped, transferable
 * sentences. Everything that is narration, echo, boilerplate or credential-
 * shaped is dropped HERE, so the composed memory never has to be "mostly
 * fine".
 */
export function extractEvidenceSentences(
  response: unknown,
  prompt: unknown,
  limit = MAX_EVIDENCE_SENTENCES,
): { kept: string[]; rejections: RunOutcomeEvidenceSentence[] } {
  const kept: string[] = [];
  const rejections: RunOutcomeEvidenceSentence[] = [];
  const seen = new Set<string>();
  const max = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : MAX_EVIDENCE_SENTENCES;

  for (const sentence of splitSentences(response)) {
    if (kept.length >= max) break;
    const text = clampText(sentence, MAX_EVIDENCE_SENTENCE_CHARS);
    if (!text) continue;
    const dedupeKey = text.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    if (text.length < MIN_EVIDENCE_SENTENCE_CHARS) {
      rejections.push({ text, rejected: 'too_short' });
      continue;
    }
    if (isGenericCompletionText(text)) {
      rejections.push({ text, rejected: 'generic' });
      continue;
    }
    // A sentence already contained in the prompt is the model repeating the
    // ask back. That is the single most common "memory" an unguarded hook
    // would write, and it is pure dilution.
    if (tokenContainment(text, prompt) >= PROMPT_RESTATEMENT_MAX_OVERLAP) {
      rejections.push({ text, rejected: 'echo' });
      continue;
    }
    if (!hasConcreteReferent(text)) {
      rejections.push({ text, rejected: 'no_referent' });
      continue;
    }
    // Drop the poisoned sentence, keep the lesson. The composed text is
    // re-checked as a hard backstop before the decision returns.
    if (credentialFinding(text)) {
      rejections.push({ text: '', rejected: 'credential' });
      continue;
    }
    kept.push(text);
  }

  return { kept, rejections };
}

// ── The decision ────────────────────────────────────────────────────────────

const GENERIC_FAILURE_REASONS = [
  /^unknown error\b/i,
  /^error\.?$/i,
  /^(the\s+)?(run|task|request|operation)\s+failed\.?$/i,
  /^failed\.?$/i,
  /^something went wrong\b/i,
  /^an? (unexpected|unknown) error\b/i,
];

function isSpecificFailureReason(value: unknown): boolean {
  const text = collapse(value);
  if (text.length < 12) return false;
  if (GENERIC_FAILURE_REASONS.some((pattern) => pattern.test(text))) return false;
  return significantTokens(text).size >= 2;
}

function skipReasonForWeakFinding(rejections: RunOutcomeEvidenceSentence[]): RunOutcomeSkipReason {
  let echoes = 0;
  let generics = 0;
  for (const rejection of rejections) {
    if (rejection.rejected === 'echo') echoes += 1;
    else if (rejection.rejected === 'generic') generics += 1;
  }
  if (echoes > 0 && echoes >= generics) return 'prompt_restatement';
  if (generics > 0) return 'generic_completion';
  return 'no_transferable_finding';
}

/**
 * THE hook contract: given everything the run-finalization barrier knows,
 * decide whether a durable lesson exists and compose exactly what it should
 * say. Total — any degenerate input returns a `capture: false` decision rather
 * than throwing, because the caller runs this inside a fire-and-forget path
 * that must never affect the run.
 */
export function buildRunOutcomeMemory(
  input: RunOutcomeMemoryInput | null | undefined,
): RunOutcomeMemoryDecision {
  if (!input || typeof input !== 'object') {
    return { capture: false, reason: 'degenerate_input', detail: 'No run outcome input.' };
  }

  const terminalStatus = collapse(input.terminalStatus).toLowerCase();
  // A user cancel teaches nothing about the world — it is a statement about the
  // user, not about the task. Never capture.
  if (terminalStatus === 'cancelled') {
    return { capture: false, reason: 'cancelled_run', detail: 'The run was cancelled.' };
  }

  const observed = (input.observedEval && typeof input.observedEval === 'object' ? input.observedEval : null) || null;
  const observedOutcome = collapse(observed?.outcome).toLowerCase();
  const verification = observed?.verification || null;
  const planned = toCount(verification?.planned);
  const passed = toCount(verification?.passed);
  const failedChecks = toCount(verification?.failed);
  const manualRequired = toCount(verification?.manualRequired) + toCount(observed?.tools?.manualRequired);
  const blockedCount = toCount(verification?.blocked) + toCount(observed?.tools?.blocked);
  const failedTools = toCount(observed?.tools?.failed);
  const durableArtifacts = toCount(observed?.artifacts?.durable);

  const errorMessage = clampText(input.errorMessage, MAX_REASON_CHARS);
  const terminalReason = clampText(input.terminalReason, MAX_REASON_CHARS);

  const isFailure =
    terminalStatus === 'failed'
    || Boolean(errorMessage)
    || observedOutcome === 'failed'
    || observedOutcome === 'blocked'
    || failedChecks > 0
    || failedTools > 0;
  const lessonKind: RunOutcomeLessonKind = isFailure ? 'failure' : 'success';
  const verified = terminalStatus === 'completed' && !isFailure;

  const subject = resolveRunOutcomeSubject(input);
  if (!subject) {
    return {
      capture: false,
      reason: 'no_reusable_subject',
      detail: 'The run has no app-automation lane, routed execution kind, or acting task kind to file the lesson under.',
    };
  }

  // ── Structured facts (the durable backbone — never model prose) ──────────
  // USED tools are a learned fact. ROUTED tools are re-derivable from the route
  // and are therefore printed for context but score nothing — and they are
  // labelled differently, because calling a merely-recommended tool "in play"
  // would be a small lie in a row that is re-injected as fact forever.
  const usedTools = toStringList(
    Array.isArray(input.toolNames) && input.toolNames.length > 0 ? input.toolNames : (observed?.tools?.names || []),
    MAX_TOOL_NAMES,
    40,
  );
  const routedTools = usedTools.length > 0
    ? []
    : toStringList(input.automation?.recommendedTools, MAX_TOOL_NAMES, 40);
  const blockers = toStringList(observed?.blockers, MAX_BLOCKERS, 120);
  const artifactKinds = toStringList(
    (observed?.artifacts?.kinds && observed.artifacts.kinds.length > 0
      ? observed.artifacts.kinds
      : (Array.isArray(input.artifacts) ? input.artifacts.map((a) => a?.kind) : [])),
    MAX_ARTIFACT_KINDS,
    40,
  );
  const contextClamp = 140;

  const failureReason = errorMessage || (isFailure ? terminalReason : '');
  const specificFailure = lessonKind === 'failure' && isSpecificFailureReason(failureReason);

  const { kept: evidence, rejections } = extractEvidenceSentences(input.response, input.prompt);

  const verificationDetail = planned > 0 && (passed > 0 || failedChecks > 0);
  const blockedSignal = failedTools > 0 || blockedCount > 0 || manualRequired > 0;

  let findingStrength = 0;
  if (specificFailure) findingStrength += 1;
  if (verificationDetail) findingStrength += 1;
  if (durableArtifacts > 0) findingStrength += 1;
  if (usedTools.length > 0) findingStrength += 1;
  if (blockers.length > 0) findingStrength += 1;
  if (blockedSignal) findingStrength += 1;
  findingStrength += evidence.length;

  // Failures are cheap to capture (not repeating them IS the product).
  // Successes must carry proof. The weak `profile` subject tier and an
  // `inconclusive` runtime each cost one extra point.
  let required = lessonKind === 'failure' ? 1 : 2;
  if (subject.tier === 'profile') required += 1;
  if (terminalStatus === 'inconclusive') required += 1;

  const hasSuccessProof = durableArtifacts > 0 || passed > 0 || evidence.length > 0;
  if (findingStrength < required || (lessonKind === 'success' && !hasSuccessProof)) {
    return {
      capture: false,
      reason: skipReasonForWeakFinding(rejections),
      detail: `Finding strength ${findingStrength} < ${required} for ${lessonKind}/${subject.tier}.`,
    };
  }

  // ── Compose ─────────────────────────────────────────────────────────────
  const outcomeLine = lessonKind === 'failure'
    ? `Failure: ${failureReason || `${observedOutcome || 'blocked'} outcome with ${failedChecks + failedTools} failed check(s)`}`
    : verified
      ? 'Outcome: completed with runtime-confirmed proof.'
      : 'Outcome: response returned; completion NOT verified by the runtime.';

  const verificationLine = verificationDetail
    ? `Verification: ${passed} passed, ${failedChecks} failed of ${planned} planned.`
    : '';
  const blockedLine = blockedSignal
    ? `Blocked signal: ${failedTools} failed tool(s), ${blockedCount} blocked, ${manualRequired} manual-required.`
    : '';
  const blockersLine = blockers.length > 0 ? `Blockers: ${blockers.join('; ')}` : '';
  const toolsLine = usedTools.length > 0 ? `Tools in play: ${usedTools.join(', ')}.` : '';
  // Routed tools are re-derivable from the route, so they are FRAME, not
  // lesson: they are printed for context but are excluded from the noise gates
  // and the fingerprint. Otherwise a boilerplate tool list could rescue a
  // hollow body from the one-off-value gate — exactly the dilution this file
  // exists to prevent.
  const routedToolsLine = usedTools.length === 0 && routedTools.length > 0
    ? `Routed tools (recommended, not confirmed used): ${routedTools.join(', ')}.`
    : '';
  const artifactsLine = artifactKinds.length > 0 ? `Durable outputs: ${artifactKinds.join(', ')}.` : '';
  const evidenceLines = evidence.map((sentence) => `Evidence: ${sentence}`);

  // The noise gates measure THE LESSON, not the fixed frame. `Attempted:` /
  // `Context:` / `Observed:` are retrieval anchors and would otherwise mask a
  // hollow body. Evidence sits right behind the outcome because it is the
  // highest-value line and must survive the sub-budget clamp.
  const lessonBody = clampBlock(
    [outcomeLine, blockersLine, ...evidenceLines, verificationLine, blockedLine, toolsLine, artifactsLine].filter(Boolean),
    MAX_LESSON_BODY_CHARS,
  );

  if (lessonBody.length < MIN_LESSON_CHARS) {
    return { capture: false, reason: 'too_short', detail: `Lesson body ${lessonBody.length} < ${MIN_LESSON_CHARS} chars.` };
  }
  if (isGenericCompletionText(lessonBody.split('\n')[0]) && evidence.length === 0) {
    return { capture: false, reason: 'generic_completion', detail: 'Lesson body is a generic completion statement.' };
  }
  if (isOneOffValueOnly(lessonBody)) {
    return {
      capture: false,
      reason: 'one_off_value',
      detail: 'Lesson body is dominated by run-specific identifiers with no reusable frame.',
    };
  }

  const contextBits = [
    collapse(input.surface),
    collapse(input.mode) ? `mode ${collapse(input.mode)}` : '',
    collapse(input.taskKind) ? `task ${collapse(input.taskKind)}` : '',
    collapse(input.profile) ? `profile ${collapse(input.profile)}` : '',
    collapse(input.impactDomain) ? `domain ${collapse(input.impactDomain)}` : '',
    collapse(input.routingIntent) ? `intent ${collapse(input.routingIntent)}` : '',
    collapse(input.automation?.risk) ? `risk ${collapse(input.automation?.risk)}` : '',
  ].filter(Boolean);

  const day = utcDay(input.nowMs);
  const intent = clampText(input.prompt, MAX_INTENT_CHARS);
  const content = clampBlock(
    [
      `Subject: ${subject.label}`,
      // Lesson first (already bounded to MAX_LESSON_BODY_CHARS), frame after —
      // clampBlock drops from the tail, so this ordering is what guarantees the
      // finding survives.
      ...lessonBody.split('\n'),
      routedToolsLine,
      contextBits.length > 0 ? `Context: ${clampText(contextBits.join(' · '), contextClamp)}` : '',
      // Bounded intent line only — the raw prompt is never persisted.
      intent ? `Attempted: ${intent}` : '',
      day ? `Observed: ${day}` : '',
    ].filter(Boolean),
    MAX_CONTENT_CHARS,
  );

  const title = clampText(
    lessonKind === 'failure'
      ? `Run blocker: ${subject.label}`
      : verified
        ? `Run pattern: ${subject.label}`
        : `Run signal (unverified): ${subject.label}`,
    MAX_TITLE_CHARS,
  );

  // HARD BACKSTOP. Everything above already drops credential-shaped sentences,
  // but the composed text is what gets embedded and re-injected into every
  // later prompt, so it is re-checked as a whole. Same detector the
  // `agentRunSystem.saveMemory` chokepoint uses — one standard, two layers.
  const finding = credentialFinding(`${title}\n${content}`);
  if (finding) {
    return {
      capture: false,
      reason: 'credential_shaped',
      // Never the matched value — only the stable rule id / label.
      detail: `Refused: ${finding.label} (rule=${finding.rule}).`,
    };
  }

  const importanceBase = lessonKind === 'failure'
    ? (subject.tier === 'lane' ? 0.82 : subject.tier === 'route' ? 0.78 : 0.74)
    : (subject.tier === 'lane' ? 0.74 : subject.tier === 'route' ? 0.71 : 0.68);
  const importance = Math.round(Math.max(0.5, Math.min(0.9, importanceBase - (verified || lessonKind === 'failure' ? 0 : 0.04))) * 100) / 100;

  const excerpt = clampText(
    lessonKind === 'failure'
      ? (failureReason || blockers[0] || evidence[0] || outcomeLine)
      : (evidence[0] || outcomeLine),
    MAX_EXCERPT_CHARS,
  );

  // Deliberately excludes `nowMs` and `runId`: two runs that learn the SAME
  // lesson must collide so the caller can skip the duplicate write.
  const fingerprint = stableHash(`${subject.key}|${lessonKind}|${verified ? 'v' : 'u'}|${lessonBody.toLowerCase()}`);

  return {
    capture: true,
    memory: {
      memoryKind: RUN_OUTCOME_MEMORY_KIND,
      title,
      content,
      excerpt,
      importance,
      retrievalMode: 'on_demand',
      sourceRunId: normalizeSourceRunId(input.runId),
      // Echoed, never invented. `saveAgentMemory` hard-codes 'feed_task' for
      // every caller; this path refuses to propagate that lie.
      sourceSurface: collapse(input.surface).slice(0, 60) || 'unknown_surface',
      lessonKind,
      subjectKey: subject.key,
      subjectTier: subject.tier,
      findingStrength,
      fingerprint,
      metadata: {
        source: 'agent_run_outcome',
        version: RUN_OUTCOME_MEMORY_VERSION,
        namespace: lessonKind === 'failure' ? 'agent_private_blocker' : 'agent_private_pattern',
        lessonKind,
        subjectTier: subject.tier,
        subjectKey: subject.key,
        runOutcomeFingerprint: fingerprint,
        findingStrength,
        verifiedCompletion: verified,
        surface: collapse(input.surface).slice(0, 60) || null,
        mode: collapse(input.mode).slice(0, 40) || null,
        taskKind: collapse(input.taskKind).slice(0, 40) || null,
        capabilityProfile: collapse(input.profile).slice(0, 60) || null,
        impactDomain: collapse(input.impactDomain).slice(0, 60) || null,
        routingIntent: collapse(input.routingIntent).slice(0, 60) || null,
        executionKind: collapse(input.automation?.executionKind).slice(0, 60) || null,
        routeId: collapse(input.automation?.routeId).slice(0, 120) || null,
        pipelineId: collapse(input.automation?.pipelineId).slice(0, 120) || null,
        primarySurface: collapse(input.automation?.primarySurface).slice(0, 60) || null,
        risk: collapse(input.automation?.risk).slice(0, 40) || null,
        terminalStatus: terminalStatus || null,
        observedOutcome: observedOutcome || null,
        evidenceSentences: evidence.length,
        capturedAtMs: typeof input.nowMs === 'number' && Number.isFinite(input.nowMs) ? input.nowMs : 0,
      },
    },
  };
}
