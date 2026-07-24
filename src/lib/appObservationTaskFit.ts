/**
 * appObservationTaskFit — the proactive, FORWARD counterpart to
 * deterministicReobserve's reactive retry-summary (see ./deterministicReobserve).
 *
 * After a *successful* app observation, resolve the task's target references
 * (the specific layer / object / element the request names) against what the
 * app ACTUALLY shows right now, so the model knows — BEFORE it mutates —
 * whether its target exists, is ambiguous, or is absent. This is the
 * "analyze the app and figure out what to do" step: it turns raw observed
 * element labels + a task hint into a grounded, model-facing readiness verdict
 * so the next action is chosen against real app state instead of the request
 * text alone.
 *
 * Where deterministicReobserve fires AFTER a failed action (re-read ground
 * truth for the retry), this fires on a SUCCESSFUL observation, BEFORE the
 * mutating action, and answers a different question: not "what's on screen"
 * but "does the thing I was asked to act on actually resolve to one element".
 *
 * Precision-first: it only claims a target when the request names one with
 * high confidence (name + design-noun compound, "named/called X", or a quoted
 * name in a find/modify context). Content-to-create (e.g. a headline that says
 * "SALE") is deliberately NOT treated as an existing target — reporting it
 * "not found" would be misleading. When in doubt it emits no target, so the
 * digest stays empty rather than making a false claim.
 *
 * Pure + side-effect free → smoke testable. Observed element labels are
 * app-controlled (UNTRUSTED); the model-facing digest fences them via the
 * caller-supplied fence fn. Target phrases come from the task hint (the
 * request itself), so they are not fenced.
 */

export type AppTaskFitReadiness =
  | 'no_observation' // nothing observable was captured — observe/screenshot first
  | 'no_task_target' // the task hint names no resolvable target — nothing to ground
  | 'target_matched' // every named target resolves to exactly one observed element
  | 'target_ambiguous' // a named target matches multiple observed elements
  | 'target_absent'; // a named target matches no observed element

export interface AppTaskFitTarget {
  /** Normalized target phrase pulled from the task hint (request-derived, trusted). */
  phrase: string;
  status: 'matched' | 'ambiguous' | 'absent';
  /** Observed labels it matched — RAW/UNTRUSTED, fence before model-visible use. */
  matches: string[];
}

export interface AppTaskFitInput {
  /** What the task is trying to do (the request / taskHint). */
  taskHint: string | null | undefined;
  /** Observed element labels (a11y node labels + window titles). Untrusted. */
  observedLabels: Array<string | null | undefined>;
  appName?: string | null;
}

export interface AppTaskFitResult {
  readiness: AppTaskFitReadiness;
  targets: AppTaskFitTarget[];
  /** Structural, safe-to-show sentences (reference the request phrase only, never raw labels). */
  blockers: string[];
}

// ─── Bounds (keep the appended digest small and predictable) ─────────────────
export const APP_TASK_FIT_MAX_TARGETS = 4;
export const APP_TASK_FIT_MAX_MATCHES = 3;
export const APP_TASK_FIT_MAX_PHRASE_CHARS = 60;
export const APP_TASK_FIT_MAX_LABELS = 400;
export const APP_TASK_FIT_DIGEST_MAX_CHARS = 700;

// Design/UI nouns that follow a target name: "the <name> layer", "<name> object".
const TARGET_NOUN = 'layers?|objects?|paths?|artboards?|frames?|groups?|shapes?|swatches?|buttons?|panels?|elements?|images?|photos?|icons?|logos?|text\\s+layers?|type\\s+layers?';
// Generic determiners that are not real names — drop a phrase that is only these.
const GENERIC_NAME = new Set([
  'current', 'active', 'selected', 'same', 'new', 'first', 'last', 'top', 'bottom',
  'next', 'previous', 'this', 'that', 'the', 'a', 'an', 'my', 'our', 'it', 'its',
  'left', 'right', 'front', 'back', 'main', 'other', 'another',
]);
// Stopwords ignored in token-overlap matching so "the logo" doesn't match "the file menu".
const STOPWORD = new Set([
  'the', 'a', 'an', 'of', 'to', 'for', 'and', 'or', 'my', 'our', 'with', 'on', 'in',
  'this', 'that', 'is', 'be', 'at', 'by',
]);

// Leading/trailing tokens stripped from a captured phrase so a greedy capture
// like "set the logo" (verb + determiner + name) reduces to the name "logo".
const LEADING_DROP = new Set([
  'the', 'a', 'an', 'this', 'that', 'my', 'our', 'its', 'it',
  'set', 'change', 'make', 'recolor', 'recolour', 'select', 'move', 'bring', 'put',
  'adjust', 'lower', 'raise', 'reduce', 'increase', 'drop', 'turn', 'fill', 'paint',
  'resize', 'rotate', 'delete', 'remove', 'hide', 'show', 'lock', 'unlock', 'open', 'edit',
  'update', 'give', 'to', 'on', 'of', 'for', 'with', 'and', 'or', 'please', 'can', 'you', 'now',
]);

function collapse(s: string): string {
  return String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Lowercased, whitespace-collapsed, edge-punctuation-stripped form for matching. */
export function normalizeForMatch(s: string): string {
  return collapse(s)
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/[^\p{L}\p{N}]+$/u, '');
}

function tokens(normalized: string): string[] {
  return normalized.split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 0);
}

function cleanPhrase(raw: string): string | null {
  const norm = normalizeForMatch(raw).slice(0, APP_TASK_FIT_MAX_PHRASE_CHARS).trim();
  if (!norm) return null;
  const toks = tokens(norm);
  // Trim leading/trailing determiners + command verbs so a greedy capture like
  // "set the logo" (or "logo to") reduces to the actual name "logo".
  while (toks.length > 1 && LEADING_DROP.has(toks[0])) toks.shift();
  while (toks.length > 1 && LEADING_DROP.has(toks[toks.length - 1])) toks.pop();
  if (toks.length === 0) return null;
  // Drop phrases that are only generic determiners ("the current layer" → "current").
  if (toks.every((t) => GENERIC_NAME.has(t))) return null;
  return toks.join(' ');
}

/**
 * Pull high-confidence target references from the task hint. Precision-first:
 * a phrase is emitted only when the request clearly points at an existing
 * element. Content-to-create is skipped (see file header).
 */
export function extractTaskTargetPhrases(taskHint: string | null | undefined): string[] {
  const text = collapse(taskHint || '');
  if (!text) return [];
  const out: string[] = [];
  const push = (raw: string) => {
    const p = cleanPhrase(raw);
    if (p && !out.includes(p)) out.push(p);
  };

  // A create verb near a noun means the element is being CREATED, not targeted
  // ("create a text layer", "add a fill layer") — those are not existing targets.
  const CREATE_CONTEXT = /\b(add|create|insert|new|place|draw|generate)\b/i;

  // 1. "<name> <design-noun>": "the logo layer", "hero banner object", "CTA button".
  //    Capture the NAME (1-3 words) that precedes the noun.
  const nounRe = new RegExp(
    `\\b(?:the|this|that|a|an|my|our)?\\s*([\\p{L}\\p{N}][\\p{L}\\p{N}'\\-]*(?:\\s+[\\p{L}\\p{N}][\\p{L}\\p{N}'\\-]*){0,2})\\s+(?:${TARGET_NOUN})\\b`,
    'giu',
  );
  for (const m of text.matchAll(nounRe)) {
    if (!m[1]) continue;
    const start = m.index ?? 0;
    const region = text.slice(Math.max(0, start - 20), start) + m[1];
    if (CREATE_CONTEXT.test(region)) continue; // creating this element, not targeting one
    push(m[1]);
  }

  // 2. Explicit naming: 'layer named "X"', "object called X".
  const namedRe = /\b(?:layers?|objects?|paths?|artboards?|frames?|groups?|shapes?|elements?)\s+(?:named|called|titled|labell?ed)\s+["'“‘]?([\p{L}\p{N}][\p{L}\p{N} '\-]{0,40})/giu;
  for (const m of text.matchAll(namedRe)) {
    if (m[1]) push(m[1].replace(/["'”’].*$/u, ''));
  }

  // 3. Quoted names — ONLY in a find/modify context (never create-content).
  //    Guard: skip if a create/"says"/"reading" marker sits just before the quote.
  const quoteRe = /["'“‘]([\p{L}\p{N}][\p{L}\p{N} '\-]{0,40}?)["'”’]/gu;
  const findVerb = /\b(select|find|locate|open|edit|modify|change|update|set|move|delete|remove|rename|recolou?r|resize|hide|show|lock|unlock|target|adjust|the)\b/i;
  const createMarker = /\b(add|create|insert|new|make|type|write|says?|saying|reading|titled|labell?ed|text|headline|caption)\b/i;
  for (const m of text.matchAll(quoteRe)) {
    if (!m[1]) continue;
    const start = m.index ?? 0;
    const before = text.slice(Math.max(0, start - 40), start);
    if (createMarker.test(before)) continue; // content-to-create, not an existing target
    if (!findVerb.test(before)) continue; // require a find/modify cue for a bare quote
    push(m[1]);
  }

  return out.slice(0, APP_TASK_FIT_MAX_TARGETS);
}

/** Observed labels (raw) that a target phrase resolves to. */
export function matchPhraseToLabels(phrase: string, labels: string[]): string[] {
  const np = normalizeForMatch(phrase);
  if (!np) return [];
  const pTokens = tokens(np).filter((t) => !STOPWORD.has(t));
  const hits: string[] = [];
  const seen = new Set<string>();
  for (const raw of labels) {
    const nl = normalizeForMatch(raw);
    if (!nl) continue;
    let matched = false;
    if (nl === np) {
      matched = true;
    } else if (np.length >= 3 && nl.length >= 3 && (nl.includes(np) || np.includes(nl))) {
      matched = true;
    } else if (pTokens.length > 0) {
      const lTokens = new Set(tokens(nl).filter((t) => !STOPWORD.has(t)));
      const shared = pTokens.filter((t) => lTokens.has(t));
      const need = Math.ceil(Math.min(pTokens.length, lTokens.size || 1) / 2);
      if (shared.length >= 1 && shared.length >= need) matched = true;
    }
    if (matched && !seen.has(nl)) {
      seen.add(nl);
      hits.push(collapse(raw));
      if (hits.length >= APP_TASK_FIT_MAX_MATCHES) break;
    }
  }
  return hits;
}

/**
 * Resolve the task's named targets against the observed element labels and
 * return a grounded readiness verdict.
 */
export function buildAppTaskFit(input: AppTaskFitInput): AppTaskFitResult {
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const raw of input.observedLabels || []) {
    const c = collapse(raw || '');
    if (!c) continue;
    const key = c.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    labels.push(c);
    if (labels.length >= APP_TASK_FIT_MAX_LABELS) break;
  }

  const phrases = extractTaskTargetPhrases(input.taskHint);

  if (labels.length === 0) {
    return {
      readiness: 'no_observation',
      targets: [],
      blockers: phrases.length
        ? ['No observable elements were captured — observe the app (or escalate to a screenshot) before acting on a named target.']
        : [],
    };
  }
  if (phrases.length === 0) {
    return { readiness: 'no_task_target', targets: [], blockers: [] };
  }

  const targets: AppTaskFitTarget[] = phrases.map((phrase) => {
    const matches = matchPhraseToLabels(phrase, labels);
    const status: AppTaskFitTarget['status'] = matches.length === 0 ? 'absent' : matches.length === 1 ? 'matched' : 'ambiguous';
    return { phrase, status, matches };
  });

  const anyAbsent = targets.some((t) => t.status === 'absent');
  const anyAmbiguous = targets.some((t) => t.status === 'ambiguous');
  const readiness: AppTaskFitReadiness = anyAbsent
    ? 'target_absent'
    : anyAmbiguous
      ? 'target_ambiguous'
      : 'target_matched';

  const blockers: string[] = [];
  for (const t of targets) {
    if (t.status === 'absent') {
      blockers.push(`Target "${t.phrase}" was not found among the observed elements — reobserve, ask which element, or create it before mutating.`);
    } else if (t.status === 'ambiguous') {
      blockers.push(`Target "${t.phrase}" matches more than one observed element — confirm the exact one before mutating.`);
    }
  }

  return { readiness, targets, blockers };
}

/**
 * Bounded, model-facing digest. Structural wording stays outside the fence;
 * raw observed labels are fenced via `fence`. Returns '' when there is nothing
 * useful to add (no observation, or no target to ground), so callers append
 * nothing rather than noise.
 */
export function describeAppTaskFitForModel(
  result: AppTaskFitResult,
  fence: (s: string) => string,
): string {
  if (result.readiness === 'no_task_target') return '';
  if (result.readiness === 'no_observation') {
    if (!result.blockers.length) return '';
    return `[target grounding] ${result.blockers[0]}`;
  }

  const lines: string[] = ['[target grounding — vs current app state]'];
  for (const t of result.targets) {
    if (t.status === 'matched') {
      lines.push(`• "${t.phrase}" → resolves to observed element ${fence(t.matches.join(', '))}`);
    } else if (t.status === 'ambiguous') {
      lines.push(`• "${t.phrase}" → AMBIGUOUS, matches ${fence(t.matches.join(', '))} — confirm which before mutating`);
    } else {
      lines.push(`• "${t.phrase}" → NOT FOUND among observed elements — reobserve, ask the user, or create it`);
    }
  }
  if (result.readiness === 'target_matched') {
    lines.push('All named targets resolve to a single element — safe to proceed to the approval/act step.');
  } else if (result.readiness === 'target_ambiguous') {
    lines.push('At least one target is ambiguous — confirm the exact element (or narrow by name) before mutating.');
  } else {
    lines.push('At least one target is missing — do not mutate; reobserve, ask the user, or create the element first.');
  }

  let out = lines.join('\n');
  if (out.length > APP_TASK_FIT_DIGEST_MAX_CHARS) out = `${out.slice(0, APP_TASK_FIT_DIGEST_MAX_CHARS)}\n…(truncated)`;
  return out;
}
