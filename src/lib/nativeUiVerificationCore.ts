/**
 * nativeUiVerificationCore — turns a before/after accessibility diff into an
 * HONEST verdict for the twelve generic native UI mutations.
 *
 * WHY THIS EXISTS
 * `executeGuardedGenericNativeUiMutation` used to seal every one of these calls
 * as `outcome_unknown`, because the legacy bridge endpoints return only "I sent
 * it", never an after-state. That is truthful but useless: a user asking an
 * agent to do a task in an app got "the outcome is unknown" for every single
 * step, and no amount of retrying could ever produce a better answer.
 *
 * The missing piece was never the bridge — it is that nobody compared the
 * accessibility tree before and after. `a11yTreeDiff` already computes exactly
 * that diff and is already used for read-only observation. This module is the
 * policy layer on top: what SHOULD have changed for a given tool, and does the
 * observed diff actually prove it did.
 *
 * THE HONESTY RULE THIS MODULE EXISTS TO ENFORCE
 * "Something changed" is NOT proof that THIS action did the intended thing. An
 * app repaints, a clock ticks, a background task finishes. So a change that
 * does not match a strict per-tool expectation stays `unknown` — it never gets
 * promoted to `verified`. Only two things earn `verified`:
 *
 *   1. a value change whose new value actually contains the text we sent, or
 *   2. an expected node appearing/disappearing where the tool named the target.
 *
 * The reverse direction is where most of the new value is: an EMPTY diff after
 * an action that must move the tree is positive evidence of FAILURE, not
 * ignorance. `no_effect` is a far more actionable answer than `unknown` — it
 * tells the caller to re-observe and try a different approach instead of
 * assuming it might have worked.
 *
 * Pure + tsx-loadable (smoke: scripts/native-ui-verification-core-smoketest.ts):
 * type-only imports, no Date.now(), total functions, no I/O.
 */

import {
  a11yDiffMatchesExpectation,
  A11Y_SNAPSHOT_MAX_STRING_LENGTH,
  type A11yDiffExpectation,
  type A11ySummaryDiff,
} from './a11yTreeDiff';
import type { GenericNativeUiMutationTool } from './computerAppGrounding';

/** Bound on any model/user-facing string this module produces. */
export const MAX_REASON_CHARS = 400;

/** Text-entry tools whose sent text must show up in the after-state value. */
const TEXT_ENTRY_TOOLS: readonly GenericNativeUiMutationTool[] = [
  'desktop.type_text',
  'desktop.paste_text',
  'desktop.set_element_value',
];

/**
 * Tools where an accessibility tree that did not move at all is genuine
 * evidence the action MISSED — typing, pasting, setting a field value, and
 * opening a menu all necessarily change something observable.
 *
 * Deliberately excluded: mouse_move/down/up, scroll, and bare clicks. Those
 * routinely produce no accessibility-visible change even when they land
 * perfectly (hover, drag start, a scroll inside a canvas), so calling them
 * `no_effect` would manufacture a failure. They stay `unknown`.
 */
const REQUIRES_VISIBLE_CHANGE: readonly GenericNativeUiMutationTool[] = [
  'desktop.type_text',
  'desktop.paste_text',
  'desktop.set_element_value',
  'desktop.menu_click',
];

export type NativeUiVerdict = 'verified' | 'no_effect' | 'unknown';

export interface NativeUiVerificationPlan {
  /** Strict expectation to evaluate against the diff, or null when the tool has none. */
  expectation: A11yDiffExpectation | null;
  /** For text-entry tools: the exact text whose presence proves the write landed. */
  expectedText: string | null;
  /** True when an unmoved tree proves failure rather than ignorance. */
  requiresVisibleChange: boolean;
  /** Short operator-facing note; safe to log. */
  rationale: string;
}

export interface NativeUiVerificationOutcome {
  verdict: NativeUiVerdict;
  /** Bounded, model-safe explanation. Never echoes the sent text. */
  reason: string;
  /** Total observed changes (added + removed + changed). Telemetry only. */
  changeCount: number;
  /** True when the strict expectation matched. */
  expectationMatched: boolean;
}

function bounded(text: string): string {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  return flat.length > MAX_REASON_CHARS ? `${flat.slice(0, MAX_REASON_CHARS - 1)}…` : flat;
}

function readString(args: Record<string, unknown> | null | undefined, key: string): string {
  if (!args || typeof args !== 'object') return '';
  const raw = (args as Record<string, unknown>)[key];
  return typeof raw === 'string' ? raw : '';
}

/** Normalization shared with the diff matcher: case-fold + collapse whitespace. */
function normalize(text: string): string {
  return String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * What SHOULD change in the accessibility tree if this tool did its job.
 *
 * Returning `expectation: null` is a first-class answer, not a gap — it means
 * this tool has no reliable signature and must never reach `verified` on tree
 * movement alone.
 */
export function planNativeUiVerification(
  tool: GenericNativeUiMutationTool,
  args: Record<string, unknown> | null | undefined,
): NativeUiVerificationPlan {
  const requiresVisibleChange = REQUIRES_VISIBLE_CHANGE.includes(tool);

  if (TEXT_ENTRY_TOOLS.includes(tool)) {
    const text = readString(args, 'text');
    return {
      // No label/role constraint: the focused field's accessibility label is
      // frequently empty or generic ("text entry area"), so pinning the label
      // would fail on correct writes. The value-content check below is the
      // real proof; this only narrows the diff to value transitions.
      expectation: { expectKind: 'value_change' },
      expectedText: text || null,
      requiresVisibleChange,
      rationale: text
        ? 'Verified only if some field value changed AND the new value contains the exact text sent.'
        : 'No text supplied, so no value-content proof is possible; a value change alone is not attributable.',
    };
  }

  if (tool === 'desktop.menu_click') {
    // The LAST menu path segment is the item actually invoked ("File" >
    // "Export" > "PNG" → "PNG"), so that is the label worth expecting.
    const rawPath = args && typeof args === 'object'
      ? (args as Record<string, unknown>).menuPath
      : undefined;
    const segments = Array.isArray(rawPath)
      ? rawPath.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
      : [];
    const leaf = segments.length ? segments[segments.length - 1] : '';
    return {
      // A menu action typically opens a sheet/dialog/panel named after the
      // item. When it does, that is strong attributable evidence.
      expectation: leaf ? { expectKind: 'appear', expectLabel: leaf } : null,
      expectedText: null,
      requiresVisibleChange,
      rationale: leaf
        ? 'Verified if a node whose label matches the invoked menu item appeared.'
        : 'No menu path leaf available, so no attributable expectation could be built.',
    };
  }

  return {
    expectation: null,
    expectedText: null,
    requiresVisibleChange,
    rationale:
      'This action has no accessibility signature that distinguishes it from unrelated app activity, so tree movement alone cannot verify it.',
  };
}

function totalChanges(diff: A11ySummaryDiff | null | undefined): number {
  if (!diff) return 0;
  const n = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
  return (
    n(diff.addedTotal, (diff.added || []).length)
    + n(diff.removedTotal, (diff.removed || []).length)
    + n(diff.changedTotal, (diff.changed || []).length)
  );
}

/**
 * Did any value transition land on a value that proves our text arrived?
 *
 * Two accepted shapes, and the second is why long pastes can verify at all:
 *
 *   1. FORWARD — the new value contains the text we sent. Substring rather than
 *      equality on purpose: typing appends into a field that may already hold
 *      content.
 *
 *   2. TRUNCATED — the snapshot caps every value at
 *      A11Y_SNAPSHOT_MAX_STRING_LENGTH (120), so a 5,000-character paste can
 *      NEVER satisfy (1): the observed value is a 120-char prefix of what we
 *      sent. `desktop.paste_text` accepts up to 20,000 characters, so without
 *      this branch the single most useful "write content into an app" action
 *      would report `unknown` on every successful run.
 *
 * (2) only applies when the observed value is actually at the cap — i.e. the
 * snapshot really did truncate — and requires the sent text to contain it. A
 * short field value that coincidentally sits inside our text does NOT qualify,
 * because it would not be at the cap. A 120-character coincidence is not a
 * realistic false positive.
 */
function afterValueContains(diff: A11ySummaryDiff | null | undefined, text: string): boolean {
  const want = normalize(text);
  if (!want || !diff) return false;
  return (diff.changed || []).some((c) => {
    if (!c || c.field !== 'value' || typeof c.after !== 'string') return false;
    const after = normalize(c.after);
    if (!after) return false;
    if (after.includes(want)) return true;
    const looksTruncated = c.after.length >= A11Y_SNAPSHOT_MAX_STRING_LENGTH;
    return looksTruncated && want.includes(after);
  });
}

/**
 * Turn the observed diff into a verdict.
 *
 * `snapshotsUsable: false` (a missing/failed before or after observation) is
 * always `unknown` — absence of evidence is never evidence of absence, which is
 * exactly the mistake this codebase keeps having to unlearn.
 */
export function verifyNativeUiAfterState(input: {
  tool: GenericNativeUiMutationTool;
  plan: NativeUiVerificationPlan;
  diff: A11ySummaryDiff | null | undefined;
  /** False when either snapshot is missing, empty, or could not be taken. */
  snapshotsUsable: boolean;
}): NativeUiVerificationOutcome {
  const { plan, diff } = input;
  const changeCount = totalChanges(diff);

  if (!input.snapshotsUsable || !diff) {
    return {
      verdict: 'unknown',
      reason: bounded(
        'No usable before/after accessibility snapshot was available, so the outcome could not be checked. Re-observe the app before deciding what to do next.',
      ),
      changeCount: 0,
      expectationMatched: false,
    };
  }

  const expectationMatched = plan.expectation
    ? a11yDiffMatchesExpectation(diff, plan.expectation)
    : false;

  if (changeCount === 0) {
    // Nothing moved. For actions that MUST move the tree this is a real,
    // reportable failure; for the rest it is genuinely uninformative.
    return plan.requiresVisibleChange
      ? {
          verdict: 'no_effect',
          reason: bounded(
            'The accessibility tree is byte-identical before and after, so this action did not take effect. Re-observe the app and try a different approach; do not repeat the same call.',
          ),
          changeCount: 0,
          expectationMatched: false,
        }
      : {
          verdict: 'unknown',
          reason: bounded(
            'The accessibility tree did not change, but this action often lands without a visible accessibility change, so the outcome cannot be determined either way.',
          ),
          changeCount: 0,
          expectationMatched: false,
        };
  }

  // Text entry: the ONLY thing that earns 'verified' is the sent text actually
  // appearing in a changed value. A value change to something else is another
  // app's write, an autocomplete, or a different field.
  if (plan.expectedText) {
    if (expectationMatched && afterValueContains(diff, plan.expectedText)) {
      return {
        verdict: 'verified',
        reason: bounded(
          'A field value changed and the new value contains exactly the text that was sent, confirming the input landed in the app.',
        ),
        changeCount,
        expectationMatched: true,
      };
    }
    return {
      verdict: 'unknown',
      reason: bounded(
        `The app changed (${changeCount} accessibility change(s)) but no changed field value contains the text that was sent, so the input cannot be confirmed as landed. Re-observe before retrying.`,
      ),
      changeCount,
      expectationMatched,
    };
  }

  if (plan.expectation && expectationMatched) {
    return {
      verdict: 'verified',
      reason: bounded(
        'The expected element appeared in the app after the action, which attributes the change to this call.',
      ),
      changeCount,
      expectationMatched: true,
    };
  }

  // Something moved, but nothing ties it to THIS action. Not verified.
  return {
    verdict: 'unknown',
    reason: bounded(
      `The app changed (${changeCount} accessibility change(s)) but nothing in the change is attributable to this specific action, so completion cannot be claimed. ${plan.rationale}`,
    ),
    changeCount,
    expectationMatched,
  };
}
