/**
 * Smoke: booking-edge-contract (WI-3 + WI-7).
 *
 * Pure assertions on the single-confirm booking floor pulled out of the
 * computer-use-agent edge loop. No live Browserbase — the behavioral edge
 * paths still need the manual proof recipe (spec §5), but every logic invariant
 * is unit-checked here.
 *
 * Run: npx tsx scripts/booking-edge-contract-smoketest.ts
 */

import {
  BOOKING_SAFETY_BLOCK,
  BOOKING_FORM_SUBMISSION_PROFILE,
  BOOKING_SEARCH_BEHAVIOR,
  DEFAULT_RUN_CAPS,
  BOOKING_RUN_CAPS,
  HARD_MAX_ITERATIONS,
  HARD_MAX_TOKENS,
  PAY_CONFIRM_TIMEOUT_MS,
  DEFAULT_ASK_TIMEOUT_MS,
  resolveRunCaps,
  detectFinalPaySubmission,
  isPayConfirmQuestion,
  type PayBackstopContext,
} from '../supabase/functions/_shared/booking-edge-contract.ts';

let failures = 0;
function assert(cond: boolean, label: string) {
  if (cond) {
    console.log(`  ok  ${label}`);
  } else {
    failures++;
    console.error(`FAIL  ${label}`);
  }
}

// ── WI-3a: SAFETY prompt — exactly one pay-confirm ask, no personal-info ask ─
console.log('SAFETY prompt invariants');
{
  // Count the pay/book confirm instruction. The block states "EXACTLY ONCE"
  // and describes a single final pay/book submit ask. Assert the literal
  // "EXACTLY ONCE" marker is present exactly once.
  const exactlyOnceCount = (BOOKING_SAFETY_BLOCK.match(/EXACTLY ONCE/g) || []).length;
  assert(exactlyOnceCount === 1, 'SAFETY block states "EXACTLY ONCE" exactly one time');

  // The dropped guardrail: no "personal info" ask anywhere in SAFETY or the
  // form-submission profile.
  const combined = `${BOOKING_SAFETY_BLOCK}\n${BOOKING_FORM_SUBMISSION_PROFILE}`;
  assert(!/personal info/i.test(combined), 'no "personal info" ask in SAFETY / form profile');

  // The single ask is anchored to the FINAL pay/book submission and restates
  // amount + merchant.
  assert(/final pay\/book/i.test(BOOKING_SAFETY_BLOCK), 'ask anchored to the FINAL pay/book submission');
  assert(/amount/i.test(BOOKING_SAFETY_BLOCK) && /merchant/i.test(BOOKING_SAFETY_BLOCK),
    'single ask restates amount + merchant');

  // Intermediate steps are explicitly zero-ask.
  assert(/ZERO-ASK/i.test(BOOKING_SAFETY_BLOCK), 'navigation/extraction/guest-detail steps are ZERO-ASK');
  assert(/Do NOT call `ask_user` for intermediate steps/i.test(BOOKING_SAFETY_BLOCK),
    'intermediate steps (room select, continue, guest details) are zero-ask');

  // Credential + human-takeover floors survive (login/credential floor stays).
  assert(/fill_saved_login/.test(BOOKING_SAFETY_BLOCK), 'saved-credential approval floor preserved');
  assert(/human_takeover/.test(BOOKING_SAFETY_BLOCK), 'human-takeover floor preserved');

  // Form-submission profile no longer forces an ask before every submit.
  assert(!/ask_user before credentials\/personal info\/payment\/final submit/i.test(BOOKING_FORM_SUBMISSION_PROFILE),
    'form profile dropped the old multi-ask-before-submit rule');
  assert(/zero-ask/i.test(BOOKING_FORM_SUBMISSION_PROFILE),
    'form profile marks guest/contact filling zero-ask');
}

// ── WI-3a: booking-search behavior — gather, FINDINGS, end turn, no auto-book ─
console.log('Booking-search behavior');
{
  assert(/<FINDINGS>/.test(BOOKING_SEARCH_BEHAVIOR), 'search behavior emits a <FINDINGS> block');
  assert(/END YOUR TURN/i.test(BOOKING_SEARCH_BEHAVIOR), 'search behavior ends the turn after gathering options');
  assert(/Do NOT proceed into a booking\/checkout flow on your own/i.test(BOOKING_SEARCH_BEHAVIOR),
    'never proceeds to booking unprompted');
  assert(/book option/i.test(BOOKING_SEARCH_BEHAVIOR), 'invites the user to pick (e.g. "book option 2")');
}

// ── WI-3b: caps default to old values when no booking flag ────────────────────
console.log('Run caps');
{
  const dflt = resolveRunCaps();
  assert(dflt.maxIterations === 12, 'default maxIterations = 12 (unchanged)');
  assert(dflt.maxTokensBudget === 75_000, 'default tokens = 75k (unchanged)');
  assert(dflt.maxCostUsd === 0.75, 'default cost = $0.75 (unchanged)');
  assert(dflt.deadlineMs === 5 * 60 * 1000, 'default deadline = 5min (unchanged)');

  const dfltFlagOff = resolveRunCaps({ booking: false });
  assert(
    dfltFlagOff.maxIterations === 12 && dfltFlagOff.maxTokensBudget === 75_000 &&
    dfltFlagOff.maxCostUsd === 0.75 && dfltFlagOff.deadlineMs === DEFAULT_RUN_CAPS.deadlineMs,
    'booking:false is byte-for-byte the old defaults',
  );

  const booking = resolveRunCaps({ booking: true });
  assert(booking.maxIterations === 30, 'booking maxIterations ~30');
  assert(booking.maxTokensBudget === 150_000, 'booking tokens ~150k');
  assert(booking.maxCostUsd === 3, 'booking cost ~$3');
  assert(booking.deadlineMs === 12 * 60 * 1000, 'booking deadline ~12min');

  // Hard ceiling raised 20 -> 40 for booking iteration clamp.
  assert(HARD_MAX_ITERATIONS === 40, 'hard iteration ceiling raised to 40');
  assert(HARD_MAX_TOKENS === 200_000, 'hard token ceiling stays 200k');
  assert(Math.min(BOOKING_RUN_CAPS.maxIterations, HARD_MAX_ITERATIONS) === 30,
    'booking iterations fit under the 40 hard cap');

  // Explicit per-field override wins over class default.
  const override = resolveRunCaps({ booking: true, maxCostUsd: 5 });
  assert(override.maxCostUsd === 5, 'explicit maxCostUsd override wins');
  assert(override.maxIterations === 30, 'other fields still fall back to booking class');

  // A zero / negative override is ignored (falls back to class default).
  const bad = resolveRunCaps({ booking: false, maxCostUsd: 0 });
  assert(bad.maxCostUsd === 0.75, 'non-positive override ignored → class default');

  // A non-booking run is clamped to the legacy 20 ceiling even if the client
  // body asks for more — booking runs still reach up to 40.
  assert(resolveRunCaps({ booking: false, maxIterations: 40 }).maxIterations === 20,
    'non-booking run clamps iterations to the legacy 20 ceiling');
  assert(resolveRunCaps({ booking: true, maxIterations: 40 }).maxIterations === 40,
    'booking run allows iterations up to the 40 ceiling');
  assert(resolveRunCaps({ booking: true, maxIterations: 999 }).maxIterations === 40,
    'booking run clamps an oversized request to 40');
}

// ── WI-3c: pay-confirm timeout floor ──────────────────────────────────────────
console.log('Pay-confirm timeout');
{
  assert(PAY_CONFIRM_TIMEOUT_MS >= 300_000, 'pay-confirm timeout >= 300s');
  assert(DEFAULT_ASK_TIMEOUT_MS === 120_000, 'default ask timeout unchanged (120s)');
}

// ── WI-7: pay-floor backstop detector ────────────────────────────────────────
console.log('Pay-floor backstop detector');
{
  const base: Omit<PayBackstopContext, 'lastReasoning' | 'lastUrl'> = {
    toolName: 'computer',
    action: 'left_click',
    payConfirmed: false,
  };

  // FIRES: click with explicit pay-action reasoning, no confirmation.
  assert(detectFinalPaySubmission({
    ...base, lastReasoning: 'Now I will click "Pay $312.40 now" to complete the booking.', lastUrl: null,
  }), 'fires on explicit "Pay now" reasoning without confirmation');

  // FIRES: checkout URL + pay-verb reasoning.
  assert(detectFinalPaySubmission({
    ...base,
    lastReasoning: 'Submitting the payment to finish checkout.',
    lastUrl: 'https://marriott.com/reservation/checkout',
  }), 'fires on checkout URL + payment reasoning');

  // FIRES: "book now" step-pay verb (book counts as pay AT THE STEP).
  assert(detectFinalPaySubmission({
    ...base,
    lastReasoning: 'Clicking "Book now" to confirm the reservation.',
    lastUrl: 'https://marriott.com/book',
  }), 'fires on "Book now" final submit (book == pay at step level)');

  // SILENT: search results click.
  assert(!detectFinalPaySubmission({
    ...base,
    lastReasoning: 'Clicking the search button to see hotels in Chicago.',
    lastUrl: 'https://marriott.com/search',
  }), 'silent on a search-results click');

  // SILENT: plain navigation click.
  assert(!detectFinalPaySubmission({
    ...base,
    lastReasoning: 'Clicking the first hotel to view its details.',
    lastUrl: 'https://marriott.com/hotels/chicago-downtown',
  }), 'silent on a navigation click');

  // SILENT: "continue to payment" is a NAV step, not the commit, even on a
  // checkout URL.
  assert(!detectFinalPaySubmission({
    ...base,
    lastReasoning: 'Clicking Continue to proceed to the payment page.',
    lastUrl: 'https://marriott.com/checkout',
  }), 'silent on "continue to payment" nav step on checkout URL');

  // SILENT: "review your booking" intermediate confirm.
  assert(!detectFinalPaySubmission({
    ...base,
    lastReasoning: 'Clicking Review your booking to check the details.',
    lastUrl: 'https://marriott.com/booking/review',
  }), 'silent on "review your booking" intermediate step');

  // SILENT once confirmed — even on the real commit click.
  assert(!detectFinalPaySubmission({
    ...base,
    payConfirmed: true,
    lastReasoning: 'Now I will click "Pay $312.40 now" to complete the booking.',
    lastUrl: 'https://marriott.com/checkout',
  }), 'silent once an affirmative pay confirmation already happened');

  // SILENT on non-click actions (type/scroll/screenshot) even with pay text.
  assert(!detectFinalPaySubmission({
    toolName: 'computer', action: 'type', payConfirmed: false,
    lastReasoning: 'Typing the card number into the payment field.',
    lastUrl: 'https://marriott.com/checkout',
  }), 'silent on non-click actions (type)');
  assert(!detectFinalPaySubmission({
    toolName: 'computer', action: 'scroll', payConfirmed: false,
    lastReasoning: 'Scrolling to the Pay button.',
    lastUrl: 'https://marriott.com/checkout',
  }), 'silent on scroll toward the pay button');

  // SILENT on ask_user / other tools.
  assert(!detectFinalPaySubmission({
    toolName: 'ask_user', action: null, payConfirmed: false,
    lastReasoning: 'Confirm paying $312.40 to Marriott?', lastUrl: null,
  }), 'silent on the ask_user tool itself');

  // FIRES: Enter/Return keypress submitting a focused Pay button is a commit
  // vector too (not just clicks).
  assert(detectFinalPaySubmission({
    toolName: 'computer', action: 'key', actionText: 'Return', payConfirmed: false,
    lastReasoning: 'Pressing Enter to submit the payment and complete the booking.',
    lastUrl: 'https://marriott.com/checkout',
  }), 'fires on an Enter-key submit of the pay form');

  // SILENT: a non-Enter keystroke (typing into a field) is not a commit.
  assert(!detectFinalPaySubmission({
    toolName: 'computer', action: 'key', actionText: 'a', payConfirmed: false,
    lastReasoning: 'Typing into the card number field.',
    lastUrl: 'https://marriott.com/checkout',
  }), 'silent on a non-Enter keystroke on the checkout page');

  // FIRES: the flagship marriott.com "Reserve" flow — bare "reserve"/"finalize"
  // reasoning on a /reservation/ URL that is NOT literally /checkout.
  assert(detectFinalPaySubmission({
    ...base,
    lastReasoning: 'Clicking the Reserve button to finalize the booking.',
    lastUrl: 'https://www.marriott.com/reservation/rateListMenu.mi',
  }), 'fires on marriott "Reserve"/finalize click on a /reservation/ URL');

  // FIRES: deny-by-default on a booking run — bare commit verb, opaque SPA URL
  // with no checkout-ish token at all.
  assert(detectFinalPaySubmission({
    ...base, booking: true,
    lastReasoning: 'Clicking the highlighted button to confirm and book the room.',
    lastUrl: 'https://hotel.example/app#step=final',
  }), 'fires deny-by-default on a booking run with an opaque URL');

  // SILENT: the same opaque-URL bare-commit click on a NON-booking run stays
  // silent (deny-by-default is scoped to booking runs).
  assert(!detectFinalPaySubmission({
    ...base, booking: false,
    lastReasoning: 'Clicking the button to book the slot.',
    lastUrl: 'https://calendar.example/app#pick',
  }), 'silent on a non-booking run with an opaque URL and bare commit verb');

  // SILENT: "review your booking" on a /reservation/ URL is a nav/review step,
  // not the commit — even though the URL now matches PAY_URL_RE.
  assert(!detectFinalPaySubmission({
    ...base, booking: true,
    lastReasoning: 'Clicking Review your booking to check the details before reserving.',
    lastUrl: 'https://www.marriott.com/reservation/review.mi',
  }), 'silent on "review your booking" nav step even on a reservation URL');
}

// ── WI-7: pay-confirm question classifier ─────────────────────────────────────
console.log('Pay-confirm question classifier');
{
  assert(isPayConfirmQuestion('Confirm paying $312.40 to Marriott and complete the booking?'),
    'classifies a pay/book confirm question as pay');
  assert(isPayConfirmQuestion('Book now for $312.40 at Marriott Chicago?'),
    'classifies "book now" as a pay confirm');
  assert(!isPayConfirmQuestion('Which option should I book — 1, 2, or 3?'),
    'a plain "which option" pick question is NOT a pay confirm');
  assert(!isPayConfirmQuestion('Log in as who?'),
    'a credential question is not a pay confirm');
  // Natural pay-confirm phrasings (bare commit verb + money/object) must arm.
  assert(isPayConfirmQuestion('Confirm booking the Deluxe King room for $312 at Marriott?'),
    'arms on "Confirm booking … room for $312"');
  assert(isPayConfirmQuestion('Shall I book this room for $312?'),
    'arms on "Shall I book this room for $312?"');
  assert(isPayConfirmQuestion('Reserve the room for $450?'),
    'arms on "Reserve the room for $450?"');
  assert(isPayConfirmQuestion('Ready to complete your booking for $312?'),
    'arms on "Ready to complete your booking for $312?"');
  // But a bare commit verb with NO money/object must not arm (defense-in-depth
  // so a stray "confirm" question can not disarm the floor).
  assert(!isPayConfirmQuestion('The 2FA code was entered — confirm you are done?'),
    'a 2FA/human-takeover confirm without money/object does not arm the floor');
}

console.log('');
if (failures > 0) {
  console.error(`booking-edge-contract smoke: ${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log('booking-edge-contract smoke: all assertions passed');
