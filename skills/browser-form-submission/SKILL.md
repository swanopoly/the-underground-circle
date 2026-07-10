---
name: browser-form-submission
description: Fill and submit a web form (login, checkout, booking, CMS post, account change) reliably using semantic locators, with credentials kept in the vault, human-verification gates respected, and the submit gated behind approval. Use for "log into / book / order / submit / update [site]" browser tasks.
version: 1.0.0
tags: [browser, web, form, automation, credentials, observe-act-verify, approval]
---

# Browser Form Submission

Submitting a web form is a side effect — it books, buys, posts, or changes an
account. Treat every submit as approval-gated, fill from the vault (never from
chat), target fields semantically (role/label, not coordinates), and verify both
that the form was accepted and that no human-verification gate is blocking.

## Procedure

1. **Navigate + observe** — `browser.open_url` to the page, then
   `browser.dom_snapshot` to read the accessibility/role tree (fields, buttons,
   current values). Do not act off a screenshot; the DOM/ARIA tree is ground truth.

2. **Check the gate first** — `browser.verification_state` to detect CAPTCHA, MFA,
   OTP, bot checks, or Cloudflare. If a human gate is present, **stop** and ask the
   user to clear it; resume only after re-checking the verification state.

3. **Locate each field semantically** — match by ARIA role + accessible name /
   label / placeholder (e.g. `browser.click_role`, `browser.fill_field`). Confirm
   the locator resolves to exactly one element before typing. Never fall back to
   coordinates while a unique semantic locator exists.

4. **Fill values** — `browser.fill_field` for plain inputs. For usernames,
   passwords, or any secret use `browser.fill_credential_field` (vault-backed) —
   never print or paste raw credentials into chat, logs, or tool results.

5. **Actionability before submit** — confirm the submit control is visible,
   stable, enabled, and event-receiving (not obscured/disabled). Re-read the DOM
   if the form mutated after filling (dynamic validation, revealed fields).

6. **Approval gate the submit** — call `approvals.request` before the click that
   causes the side effect (submit / pay / book / publish / save). Do not submit on
   your own authority; surface exactly what will happen (what is bought/booked/posted).

7. **Submit one bounded step**, then **verify** — after the click, re-read with
   `browser.dom_snapshot`: confirm the success state (confirmation text, new URL,
   order/booking id, the record now present). A returned click is not proof.

8. **Recover, don't resubmit** — if submission fails or is ambiguous, re-observe;
   never blindly re-click a submit (risk of double-charge/double-post). If the page
   exposes no semantic path, `research.search` the site's documented flow or hand
   off a connected-agent buildout; do not brute-force coordinates.

## Pitfalls

- **Double submission** — re-clicking submit after an unverified first click can
  double-charge or double-post. Re-observe before any retry.
- **Credentials in the clear** — only `browser.fill_credential_field`/vault; never
  echo secrets into results or chat.
- **Skipping the verification gate** — CAPTCHA/MFA must be a human stop, not a guess.
- **Coordinate fallback with a valid locator present** — brittle and wrong.
- **Submitting without approval** — every side-effecting submit is approval-gated.
- **Acting on a stale DOM** — dynamic forms reveal/validate fields; re-read first.

## Verification

- **Pre-submit:** unique resolved locator per field, actionability checks pass,
  verification state clear, approval granted.
- **Post-submit:** `browser.dom_snapshot` showing the confirmation/success state —
  confirmation text, changed URL/title, or the new order/booking/record id.
- **A submit is only "done" when the accepted state is observed.** If it cannot be
  observed (no confirmation, error banner, or re-prompt), report the blocker — do
  not claim success.
- **Files** (uploads/downloads): verify with `desktop.file_stat` that the expected
  artifact exists before reporting completion.
