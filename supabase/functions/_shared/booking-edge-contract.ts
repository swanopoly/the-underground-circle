/**
 * booking-edge-contract — pure, dependency-light contract shared by the
 * computer-use-agent edge loop (Deno) and its smoke test (tsx).
 *
 * Kept free of ANY external imports (no esm.sh, no Deno globals) so it loads
 * identically under Deno and under `npx tsx` for unit assertions. This is the
 * "single-confirm booking floor" logic pulled out of index.ts so the pay-floor
 * backstop and the booking-class caps are testable without a live Browserbase.
 *
 * The one surviving guardrail on a zero-friction booking journey is the FINAL
 * pay/book submission confirmation. Navigation, reading, extraction, and
 * filling guest+search details are all zero-ask. Exactly one `ask_user` fires
 * at the final pay/book submit stating amount + merchant. The prompt says so
 * (SAFETY block below) AND a server-side detector (detectFinalPaySubmission)
 * fails closed if the model tries to click a final-submit control without a
 * prior affirmative pay-class confirmation this run.
 */

// ── Prompt fragments ────────────────────────────────────────────────────
// These are asserted verbatim in the smoke, so keep the "exactly one" and the
// "no personal-info ask" invariants stable if you edit them.

/** Replaces the multi-ask SAFETY block. Zero-ask for everything except the
 *  single final pay/book submission. */
export const BOOKING_SAFETY_BLOCK = `SAFETY
- Navigation, reading, extraction, scrolling, and filling search/guest/traveler details (names, dates, email, phone, address) are ZERO-ASK. Do them directly without calling \`ask_user\`.
- Call the \`ask_user\` tool EXACTLY ONCE on the whole task: immediately BEFORE clicking the FINAL pay/book/reserve/purchase submission that commits money or a binding reservation ("Pay", "Book now", "Reserve", "Confirm purchase", "Place order", "Complete booking"). State the specific final amount and the merchant/target in the question so the user confirms real live numbers, not an earlier estimate.
- Do NOT call \`ask_user\` for intermediate steps: room/rate selection, "Continue", "Next", guest-detail forms, "Review your booking", or any non-committing confirmation. Proceed through those silently.
- For saved vault credentials, navigate to the login page, focus the username/email field, call \`ask_user\` for permission to use the saved credential, then call \`fill_saved_login\` with the credential_id plus any grantee/grantee_type from the vault runbook. Never ask the user to paste a password or secret into chat.
- Never guess credentials. If a site requires login you weren't given, call \`ask_user\` with the question "Log in as who?" and wait for direction.
- HUMAN TAKEOVER: if a site shows 2FA, a CAPTCHA, or any human-only verification step (including typing a payment card the user must enter themselves), do NOT keep trying and do NOT give up. Call \`ask_user\` with kind "human_takeover", a question like "The site is asking for a 2FA code — complete it in the live session view, then choose Done", and wait. After the user chooses "Done, continue", take a fresh screenshot to confirm the checkpoint cleared, then continue the task. If they cancel or time out, summarize progress and stop. Never ask the user to tell you the code or solve the CAPTCHA for you to type — they complete it directly in the live view.`;

/** Replaces the old "ask_user before credentials/personal info/payment/final
 *  submit" form-submission profile line. */
export const BOOKING_FORM_SUBMISSION_PROFILE = `- Form submission: wait for fields to load, fill text inputs/selects/radios/checkboxes/uploads in sequence, handle dynamic sections after each selection, then verify success through visible confirmation text, URL change, or validation errors. Filling guest/traveler/contact details is zero-ask; only the single final pay/book submission needs \`ask_user\` (see SAFETY).`;

/** Booking-search behavior: gather options, emit FINDINGS, END THE TURN. Never
 *  proceed to booking unprompted. Appended into the STRUCTURED FINDINGS area. */
export const BOOKING_SEARCH_BEHAVIOR = `BOOKING / SHOPPING SEARCH BEHAVIOR
- When the task is to find/browse bookable options (hotels, flights, tickets, tables, rooms, products) WITHOUT an explicit pre-chosen pick, treat it as a SEARCH: navigate, apply the requested filters (location, dates, guests), read the results, and gather the top matches.
- After you have gathered the options, emit a <FINDINGS> block with them and END YOUR TURN inviting the user to pick (e.g. "Reply 'book option 2' to continue"). Do NOT proceed into a booking/checkout flow on your own — wait for the user to choose.
- Only proceed toward the final pay/book submission when the task explicitly names a chosen option to book. Even then, the single \`ask_user\` at the final submit still fires.`;

// ── Booking-class run caps ──────────────────────────────────────────────
// Non-booking runs keep today's values; a booking-class run raises the ceiling
// so a 20-40-step checkout flow can complete. Callers pass the resolved values
// down into the existing cap math — the hard ceilings below are the absolute
// clamps applied in index.ts.

export interface RunCaps {
  maxIterations: number;
  maxTokensBudget: number;
  maxCostUsd: number;
  deadlineMs: number;
}

/** Today's defaults (unchanged for non-booking runs). */
export const DEFAULT_RUN_CAPS: RunCaps = {
  maxIterations: 12,
  maxTokensBudget: 75_000,
  maxCostUsd: 0.75,
  deadlineMs: 5 * 60 * 1000,
};

/** Booking-class run caps — bigger budget for multi-leg checkout flows. */
export const BOOKING_RUN_CAPS: RunCaps = {
  maxIterations: 30,
  maxTokensBudget: 150_000,
  maxCostUsd: 3,
  deadlineMs: 12 * 60 * 1000,
};

/** Absolute hard ceilings — clamps applied AFTER the caller's request, so a
 *  hostile/oversized client body can't request an unbounded run. A non-booking
 *  run keeps the legacy 20-iteration ceiling (byte-for-byte unchanged); a
 *  booking-class run may go to 40 for a multi-leg checkout. HARD_MAX_ITERATIONS
 *  stays 40 as the outer defense-in-depth clamp in index.ts. */
export const HARD_MAX_ITERATIONS = 40;
export const LEGACY_HARD_MAX_ITERATIONS = 20;
export const HARD_MAX_TOKENS = 200_000;

/** Pay-confirm timeout floor. A final pay/book confirmation waits at least
 *  this long (spec: >=300s) so a human fetching a card / reviewing has time. */
export const PAY_CONFIRM_TIMEOUT_MS = 300_000;
/** Default (non-pay) ask_user timeout — unchanged from today. */
export const DEFAULT_ASK_TIMEOUT_MS = 120_000;

/**
 * Resolve the run caps for this task. `booking === true` selects the raised
 * booking-class ceiling; otherwise today's defaults. An explicit caller
 * override (e.g. a client-supplied maxCostUsd) still wins per-field, but the
 * class defaults fill the gaps so non-booking runs are byte-for-byte
 * unchanged.
 */
export function resolveRunCaps(opts?: {
  booking?: boolean;
  maxIterations?: number;
  maxTokensBudget?: number;
  maxCostUsd?: number;
  deadlineMs?: number;
}): RunCaps {
  const base = opts?.booking ? BOOKING_RUN_CAPS : DEFAULT_RUN_CAPS;
  // Clamp iterations to the class ceiling here so non-booking runs keep the
  // legacy 20 cap regardless of an oversized client body — the "byte-for-byte
  // unchanged" guarantee holds at the source, not just at the index.ts backstop.
  const iterCeiling = opts?.booking ? HARD_MAX_ITERATIONS : LEGACY_HARD_MAX_ITERATIONS;
  const requestedIters = typeof opts?.maxIterations === "number" && opts.maxIterations > 0
    ? opts.maxIterations
    : base.maxIterations;
  return {
    maxIterations: Math.min(requestedIters, iterCeiling),
    maxTokensBudget: typeof opts?.maxTokensBudget === "number" && opts.maxTokensBudget > 0
      ? opts.maxTokensBudget
      : base.maxTokensBudget,
    maxCostUsd: typeof opts?.maxCostUsd === "number" && opts.maxCostUsd > 0
      ? opts.maxCostUsd
      : base.maxCostUsd,
    deadlineMs: typeof opts?.deadlineMs === "number" && opts.deadlineMs > 0
      ? opts.deadlineMs
      : base.deadlineMs,
  };
}

// ── Server-side pay-floor backstop ──────────────────────────────────────

/** Step-level pay verbs. Deliberately BROADER than the route-level floor:
 *  here (at the step) "book"/"reserve" DO count as pay, per spec WI-2/WI-7. */
const STEP_PAY_VERB_RE =
  /\b(pay|paid|payment|purchase|buy|checkout|check\s*out|charge|place\s+(?:the\s+)?order|complete\s+(?:the\s+)?(?:order|purchase|booking)|confirm\s+(?:and\s+)?(?:pay|book|purchase|order|reservation)|book\s+now|reserve\s+now|submit\s+payment|finish\s+booking)\b/i;

/** URL patterns that indicate the page is a checkout / payment / final-book
 *  surface. Matched against the last observed page URL. Includes hotel
 *  reservation/confirm surfaces (e.g. marriott.com/reservation/...) so the
 *  flagship "Reserve" flow is recognized, not just literal /checkout. */
const PAY_URL_RE =
  /(checkout|payment|\/pay\b|\/book\b|booking\/(?:confirm|payment|review)|purchase|order\/(?:confirm|review|place)|complete|reservation|\/reserve\b|\/confirm(?:ation)?\b)/i;

/** Words in the click's own reasoning/label context that mean "this click IS
 *  the final commit". Explicit pay language — evaluated BEFORE nav-suppression,
 *  so keep it to unambiguous commit phrases only (never bare "book"/"reserve",
 *  which appear in nav steps like "continue to book"). */
const PAY_ACTION_RE =
  /\b(pay|purchase|place\s+(?:the\s+)?order|complete\s+(?:the\s+)?(?:order|purchase|booking)|confirm\s+(?:and\s+)?(?:pay|book|purchase|order|reservation)|book\s+now|reserve\s+now|submit\s+payment)\b/i;

/** Bare commit verbs — "book", "reserve", "finalize", "confirm booking", etc.
 *  These are the natural words a model uses for the final CTA ("Clicking the
 *  Reserve button to finalize the booking"). They are matched ONLY when the
 *  reasoning is not a nav/review step (see looksLikeCommit), so "continue to
 *  book" / "review your booking" do not trip them. */
const BARE_COMMIT_VERB_RE =
  /\b(book|books|reserve|reserves|reservation|booking|finali[sz]e|complete\s+(?:the\s+|your\s+|my\s+)?(?:booking|reservation|purchase|order|payment)|submit\s+(?:the\s+|your\s+|my\s+)?(?:booking|reservation|order|payment)|place\s+(?:the\s+|your\s+|my\s+)?order|confirm\s+(?:and\s+)?(?:book|reserve|pay|purchase|order|reservation|booking))\b/i;

/** A money amount or a bookable-object noun — required alongside a bare commit
 *  verb before a `ask_user` question counts as a pay confirmation, so a benign
 *  "Log in as who?" / "complete the 2FA" question never arms the pay floor. */
const MONEY_OR_COMMIT_OBJECT_RE =
  /\$|\bUSD\b|\bEUR\b|\bGBP\b|\d+\.\d{2}|\b(room|rooms|reservation|booking|order|purchase|hotel|flight|ticket|table|rental|night|nights|stay)\b/i;

/** Non-final navigation verbs that must NOT trip the backstop even when the
 *  page URL is checkout-ish (e.g. "continue to payment", "review booking"). */
const NON_FINAL_HINT_RE =
  /\b(continue|next|proceed|review|edit|back|search|filter|select\s+(?:room|rate|option|seat|date)|add\s+guest|see\s+(?:more|options|details))\b/i;

export interface PayBackstopContext {
  /** The tool being dispatched (only click-like actions can be a commit). */
  toolName: string;
  /** The computer-action name from tu.input.action (e.g. "left_click"). */
  action?: string | null;
  /** The action's text payload from tu.input.text — for a `key` action this
   *  is the key combo (e.g. "Return"), used to catch Enter-key submits. */
  actionText?: string | null;
  /** Most recent assistant reasoning text this iteration. */
  lastReasoning?: string | null;
  /** Last observed page URL (from the previous tool result's currentUrl). */
  lastUrl?: string | null;
  /** Whether an affirmative pay-class ask_user confirmation already happened
   *  this run. When true the backstop never fires. */
  payConfirmed: boolean;
  /** Whether this is a booking-class run (body.booking). When true the floor
   *  is deny-by-default: a bare commit-verb click that isn't a nav step is
   *  treated as the final submission even if the page URL isn't recognizably
   *  checkout-ish (SPAs, marriott rateListMenu.mi, etc.). */
  booking?: boolean;
}

/** True when a click looks like a payment/booking confirmation (label or URL
 *  or reasoning is about paying), regardless of whether it was confirmed. */
function looksLikeCommit(ctx: PayBackstopContext): boolean {
  const reasoning = String(ctx.lastReasoning || "");
  const url = String(ctx.lastUrl || "");
  // Explicit pay language ("Pay $X", "place order", "submit payment", "book
  // now") is a commit even without a pay-ish URL — evaluated before the
  // nav-suppression below because it is unambiguous.
  if (PAY_ACTION_RE.test(reasoning)) return true;
  // A non-final navigation/review intent suppresses everything below —
  // "continue to payment" / "review your booking" are not the commit click.
  if (NON_FINAL_HINT_RE.test(reasoning)) return false;

  const urlSaysPay = PAY_URL_RE.test(url);
  const stepPayVerb = STEP_PAY_VERB_RE.test(reasoning);
  const bareCommitVerb = BARE_COMMIT_VERB_RE.test(reasoning);

  // On a checkout/payment/reservation URL, a pay- or commit-verb click is the
  // final submission.
  if (urlSaysPay && (stepPayVerb || bareCommitVerb)) return true;
  // On a pay URL with no reasoning at all, a click is a commit.
  if (urlSaysPay && !reasoning) return true;
  // Deny-by-default for booking-class runs: on a pay/checkout/reservation URL,
  // ANY non-nav click is the commit (reasoning may be vague, e.g. "clicking the
  // orange button"); off a pay-ish URL, a bare book/reserve/finalize click is
  // the commit. This is the backstop for SPA / opaque-URL booking sites.
  if (ctx.booking && urlSaysPay) return true;
  if (ctx.booking && bareCommitVerb) return true;
  return false;
}

/** Only clicks (and Enter-key submits) can BE a commit. Screenshots, scrolls,
 *  typing, navigation reads never trip the backstop. */
function isClickLike(ctx: PayBackstopContext): boolean {
  if (ctx.toolName !== "computer") return false;
  const a = String(ctx.action || "").toLowerCase();
  if (a === "left_click" || a === "double_click") return true;
  // An Enter/Return keypress can submit a focused Pay/Book button, so it is a
  // commit vector too. Other keystrokes (typing into fields) are not.
  if (a === "key" || a === "keypress") {
    return /(?:^|\+|\s)(?:return|enter)\b/i.test(String(ctx.actionText || ""));
  }
  return false;
}

/**
 * Pure pay-floor backstop. Returns true when the loop MUST inject a
 * tool_result error forcing an `ask_user` first: a click that looks like the
 * final pay/book submission with no prior affirmative pay confirmation this
 * run. Silent (false) on search/nav/read clicks and once a confirmation
 * already happened.
 */
export function detectFinalPaySubmission(ctx: PayBackstopContext): boolean {
  if (ctx.payConfirmed) return false;
  if (!isClickLike(ctx)) return false;
  return looksLikeCommit(ctx);
}

/** True when an ask_user question/context is about a pay/book commit (so its
 *  affirmative answer arms `payConfirmed` and its timeout gets the longer
 *  window). */
export function isPayConfirmQuestion(question: string, context?: string | null): boolean {
  const haystack = `${question || ""} ${context || ""}`;
  if (PAY_ACTION_RE.test(haystack) || STEP_PAY_VERB_RE.test(haystack)) return true;
  // Natural phrasings ("Confirm booking this room for $312?", "Shall I book
  // this for $312?", "Reserve the room for $450?") use a bare commit verb plus
  // a money amount / bookable object. Require BOTH so a non-pay confirmation
  // ("Log in as who?", "complete the 2FA") never arms the pay floor early.
  if (BARE_COMMIT_VERB_RE.test(haystack) && MONEY_OR_COMMIT_OBJECT_RE.test(haystack)) return true;
  return false;
}

/** The tool_result text injected when the backstop fires. Instructs the model
 *  to call ask_user first. */
export const PAY_BACKSTOP_TOOL_RESULT =
  "BLOCKED BY PAY FLOOR: this looks like the final pay/book/reserve submission, but you have not confirmed it with the user yet. Do NOT click it. First call the `ask_user` tool stating the exact final amount and merchant/target, and only proceed after the user affirmatively confirms.";
