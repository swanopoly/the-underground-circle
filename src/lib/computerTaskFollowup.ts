/**
 * computerTaskFollowup (WI-5) — pure, dependency-light matcher that lets a plain
 * chat reply like "book option 2" reach the browser run instead of dead-ending
 * in plain SwanBot chat.
 *
 * It has NO react-native / supabase imports so it stays tsx-smoke-testable
 * (`import type` only). ChatTab wires it: after the pendingClarificationRef
 * collision guard and BEFORE buildChatAutomationPlan, call
 * `matchBookingFollowup(message, lastRun)` and act on the discriminated result.
 *
 * Two live paths (spec §4):
 *   - Case A: a pending confirmation is open (agent asked "which option?"). Map
 *     the reply to a choice and call resolveComputerUseConfirmation(id, choice)
 *     — same session resumes, no new route/dialog.
 *   - Case B: the run is terminal but findings are persisted. Synthesize a
 *     "Book: <title> — <url> (continuing run <id>)" task and reuse sessionId via
 *     computerUseTask.run(task, { sessionId }).
 *
 * Conservative by design: unrelated chat, open-clarification chip replies, and
 * ambiguous phrasings return { kind: 'none' } so this never hijacks a message.
 */

export type BookingFollowupFinding = {
  title: string;
  url?: string | null;
  price?: string | null;
  rating?: string | null;
  notes?: string | null;
};

export type BookingFollowupLastRun = {
  runId?: string | null;
  sessionId?: string | null;
  findings?: BookingFollowupFinding[] | null;
  /**
   * Set when the browser run is still alive and blocked on a
   * confirmation_required whose options ARE the findings (Case A).
   */
  pendingConfirmationId?: string | null;
  /** Terminal timestamp; when set (and no pending confirmation), Case B. */
  completedAt?: string | number | null;
};

export type BookingFollowupResult =
  | {
      kind: 'resolve_confirmation';
      confirmationId: string;
      choice: string;
      /** 0-based index into findings when an option was matched (else null). */
      optionIndex: number | null;
      matchedTitle: string | null;
      reason: string;
    }
  | {
      kind: 'continue_session';
      task: string;
      sessionId: string | null;
      optionIndex: number;
      matchedTitle: string;
      reason: string;
    }
  | { kind: 'none'; reason: string };

// ── Lexicon ────────────────────────────────────────────────────────────────

// A leading verb that signals a booking intent. Kept tight so random chat that
// merely contains "the second one" doesn't get hijacked — a selection reply
// must EITHER carry a booking verb OR be a bare, unambiguous option pointer
// (e.g. "option 2", "#2", "the cheapest one").
const BOOKING_VERB_RE = /\b(book|reserve|choose|select|pick|go\s+with|proceed\s+with|take|get|do)\b/i;

// A superlative pointer into the findings list.
const SUPERLATIVE_MAP: Array<{ re: RegExp; kind: 'cheapest' | 'first' | 'last' }> = [
  { re: /\b(cheapest|lowest(?:\s+price(?:d)?)?|least\s+expensive)\b/i, kind: 'cheapest' },
  { re: /\b(first|top)\s+(one|option|result|hotel|room)?\b/i, kind: 'first' },
  { re: /\bthe\s+first\b/i, kind: 'first' },
  { re: /\b(last|final)\s+(one|option|result|hotel|room)?\b/i, kind: 'last' },
  { re: /\bthe\s+last\b/i, kind: 'last' },
];

// Word-form ordinals → 1-based position.
const WORD_ORDINALS: Record<string, number> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
};

const AFFIRM_RE = /^(y|yes|yep|yeah|yup|sure|ok|okay|confirm|do\s+it|go\s+ahead|please\s+do|book\s+it|reserve\s+it)\b/i;

// ── Number / ordinal extraction ──────────────────────────────────────────────

// Returns a 1-based option position the message points to, or null.
function extractOrdinal(message: string): number | null {
  const lower = message.toLowerCase();

  // "option 2", "option #2", "choice 2", "number 2", "result 2"
  const labelled = lower.match(/\b(?:option|choice|number|result|#|no\.?|num)\s*#?\s*(\d{1,2})\b/);
  if (labelled) {
    const n = Number(labelled[1]);
    if (n >= 1 && n <= 10) return n;
  }

  // "#2"
  const hashed = lower.match(/#\s*(\d{1,2})\b/);
  if (hashed) {
    const n = Number(hashed[1]);
    if (n >= 1 && n <= 10) return n;
  }

  // Word ordinal: "the second one", "second option"
  const wordMatch = lower.match(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\b/);
  if (wordMatch) {
    const n = WORD_ORDINALS[wordMatch[1]];
    if (n && n >= 1 && n <= 10) return n;
  }

  // "2nd", "3rd", "1st", "4th"
  const suffixed = lower.match(/\b(\d{1,2})(?:st|nd|rd|th)\b/);
  if (suffixed) {
    const n = Number(suffixed[1]);
    if (n >= 1 && n <= 10) return n;
  }

  return null;
}

function findSuperlativeIndex(
  message: string,
  findings: BookingFollowupFinding[],
): { index: number; kind: string } | null {
  for (const { re, kind } of SUPERLATIVE_MAP) {
    if (!re.test(message)) continue;
    if (findings.length === 0) return null;
    if (kind === 'first') return { index: 0, kind };
    if (kind === 'last') return { index: findings.length - 1, kind };
    if (kind === 'cheapest') {
      const cheapest = pickCheapestIndex(findings);
      if (cheapest !== null) return { index: cheapest, kind };
    }
  }
  return null;
}

// Parse the leading numeric value out of a price string ("$189", "USD 1,299.00",
// "€99/night"). Returns null when no number is present (so it's skipped, not
// treated as 0).
function parsePriceValue(price?: string | null): number | null {
  if (!price || typeof price !== 'string') return null;
  const match = price.replace(/,/g, '').match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  const value = Number(match[0]);
  return Number.isFinite(value) ? value : null;
}

function pickCheapestIndex(findings: BookingFollowupFinding[]): number | null {
  let best: number | null = null;
  let bestValue = Infinity;
  findings.forEach((finding, index) => {
    const value = parsePriceValue(finding.price);
    if (value === null) return;
    if (value < bestValue) {
      bestValue = value;
      best = index;
    }
  });
  return best;
}

// Substring / title match — the message names (part of) a finding title.
function findTitleIndex(message: string, findings: BookingFollowupFinding[]): number | null {
  const lower = message.toLowerCase();
  let match: number | null = null;
  let matchLen = 0;
  findings.forEach((finding, index) => {
    const title = (finding.title || '').trim().toLowerCase();
    // Require a reasonably distinctive title so a 1-2 char token can't match.
    if (title.length < 4) return;
    if (lower.includes(title) && title.length > matchLen) {
      match = index;
      matchLen = title.length;
    }
  });
  return match;
}

// ── Choice resolution ────────────────────────────────────────────────────────

type Resolved = { index: number | null; label: string | null; affirmOnly: boolean };

function resolveChoice(message: string, findings: BookingFollowupFinding[]): Resolved {
  const trimmed = message.trim();

  const ordinal = extractOrdinal(trimmed);
  if (ordinal !== null) {
    const index = ordinal - 1;
    if (index >= 0 && index < findings.length) {
      return { index, label: findings[index].title, affirmOnly: false };
    }
    // Ordinal out of range of the known findings — still a positional choice
    // the caller can forward as text; keep the index so Case A can pass it.
    return { index, label: null, affirmOnly: false };
  }

  const superlative = findSuperlativeIndex(trimmed, findings);
  if (superlative) {
    return { index: superlative.index, label: findings[superlative.index]?.title ?? null, affirmOnly: false };
  }

  const titleIndex = findTitleIndex(trimmed, findings);
  if (titleIndex !== null) {
    return { index: titleIndex, label: findings[titleIndex].title, affirmOnly: false };
  }

  // Bare "yes"/"do it" — only meaningful when a confirmation is already open.
  if (AFFIRM_RE.test(trimmed)) {
    return { index: null, label: null, affirmOnly: true };
  }

  return { index: null, label: null, affirmOnly: false };
}

// Does the message express a booking selection at all? A selection needs either
// a booking verb, an explicit option pointer, a superlative, or (Case A only) a
// bare affirmation. This is the collision guard that keeps unrelated chat out.
function hasSelectionSignal(message: string, findings: BookingFollowupFinding[]): boolean {
  const trimmed = message.trim();
  if (BOOKING_VERB_RE.test(trimmed)) return true;
  if (extractOrdinal(trimmed) !== null) return true;
  if (findSuperlativeIndex(trimmed, findings)) return true;
  if (findTitleIndex(trimmed, findings) !== null) return true;
  return false;
}

// ── Task synthesis (Case B) ──────────────────────────────────────────────────

export function synthesizeBookingTask(
  finding: BookingFollowupFinding,
  runId?: string | null,
): string {
  const title = (finding.title || 'the selected option').trim();
  const url = (finding.url || '').trim();
  const runSuffix = runId ? ` (continuing run ${runId})` : '';
  const urlPart = url ? ` — ${url}` : '';
  return `Book: ${title}${urlPart}${runSuffix}`;
}

// ── Public matcher ───────────────────────────────────────────────────────────

export function matchBookingFollowup(
  message: string,
  lastRun: BookingFollowupLastRun | null | undefined,
): BookingFollowupResult {
  if (typeof message !== 'string' || !message.trim()) {
    return { kind: 'none', reason: 'empty message' };
  }
  if (!lastRun) {
    return { kind: 'none', reason: 'no prior computer run in this thread' };
  }

  const findings = Array.isArray(lastRun.findings)
    ? lastRun.findings.filter((f): f is BookingFollowupFinding => !!f && typeof f.title === 'string' && !!f.title.trim())
    : [];

  const pendingId = typeof lastRun.pendingConfirmationId === 'string' && lastRun.pendingConfirmationId.trim()
    ? lastRun.pendingConfirmationId.trim()
    : null;

  // ── Case A: a confirmation is open on a live run. ──
  // Here we can accept a bare "yes"/ordinal/superlative because the run is
  // already asking the user to choose — the pending question is the context
  // that makes the reply unambiguous.
  if (pendingId) {
    const resolved = resolveChoice(message, findings);
    if (resolved.affirmOnly) {
      return {
        kind: 'resolve_confirmation',
        confirmationId: pendingId,
        choice: 'yes',
        optionIndex: null,
        matchedTitle: null,
        reason: 'affirmative reply to open confirmation',
      };
    }
    if (resolved.index !== null) {
      // Forward a clear positional choice; include the title when we know it so
      // the edge can disambiguate reliably.
      const choice = resolved.label
        ? `option ${resolved.index + 1}: ${resolved.label}`
        : `option ${resolved.index + 1}`;
      return {
        kind: 'resolve_confirmation',
        confirmationId: pendingId,
        choice,
        optionIndex: resolved.index,
        matchedTitle: resolved.label,
        reason: 'mapped selection to open confirmation',
      };
    }
    // Confirmation open but the message isn't a recognizable selection —
    // don't hijack; let normal chat handle it (e.g. the user asked a question).
    return { kind: 'none', reason: 'confirmation open but reply is not a selection' };
  }

  // ── Case B: run terminal, findings persisted. ──
  const terminal = lastRun.completedAt != null;
  if (!terminal || findings.length === 0) {
    return { kind: 'none', reason: 'no open confirmation and no terminal findings to continue' };
  }

  // Conservative: require an actual selection signal so we never hijack an
  // unrelated new message that merely happens to follow a completed run.
  if (!hasSelectionSignal(message, findings)) {
    return { kind: 'none', reason: 'terminal run but message is not a booking selection' };
  }

  const resolved = resolveChoice(message, findings);
  if (resolved.index === null || resolved.index < 0 || resolved.index >= findings.length) {
    // Selection signal present (e.g. a booking verb) but no concrete option —
    // let clarification/routing handle it rather than guessing an option.
    return { kind: 'none', reason: 'booking intent without a resolvable option' };
  }

  const finding = findings[resolved.index];
  const task = synthesizeBookingTask(finding, lastRun.runId);
  return {
    kind: 'continue_session',
    task,
    sessionId: typeof lastRun.sessionId === 'string' && lastRun.sessionId ? lastRun.sessionId : null,
    optionIndex: resolved.index,
    matchedTitle: finding.title,
    reason: 'continuing terminal run with selected option',
  };
}
