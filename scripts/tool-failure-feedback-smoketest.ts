/**
 * tool-failure-feedback-smoketest
 *
 * Verifies the classified, actionable recovery-feedback builder: a raw tool
 * error is mapped to the RIGHT category + imperative hint, the original error
 * is clamped (so a giant/secret body can't be re-amplified into the prompt),
 * secrets in a benign-shaped error are not manufactured/leaked by the builder,
 * and anything unrecognized falls back to the generic bucket. Pure helpers →
 * no heavy imports.
 *
 * Run: npx tsx scripts/tool-failure-feedback-smoketest.ts
 */

import assert from 'node:assert/strict';

import {
  classifyToolFailure,
  buildToolFailureFeedback,
  TOOL_FAILURE_ERROR_CLAMP,
  type ToolFailureCategory,
} from '../src/lib/toolFailureFeedback';

let count = 0;
function check(ok: unknown, msg: string) {
  assert(ok, msg);
  count += 1;
}

// ── Each category → the right classification + a short imperative hint ───────

const cat = (tool: string, err: string): ToolFailureCategory => classifyToolFailure(tool, err).category;

// bridge_offline — the desktop/local bridge isn't running.
check(cat('desktop.click_element', 'Error: desktop bridge offline') === 'bridge_offline', 'bridge offline → bridge_offline');
check(cat('desktop.read_a11y_tree', 'the bridge is not running') === 'bridge_offline', 'bridge not running → bridge_offline');
check(cat('desktop.open_url', 'connect ECONNREFUSED 127.0.0.1:7778') === 'bridge_offline', 'ECONNREFUSED to local bridge → bridge_offline');
check(
  classifyToolFailure('desktop.click_element', 'desktop bridge offline').actionableHint.includes('npm run bridge'),
  'bridge_offline hint names `npm run bridge`',
);

// not_found — file/element/app not found.
check(cat('desktop.click_element', 'element not found: Export') === 'not_found', 'element not found → not_found');
check(cat('fs.read_file', 'ENOENT: no such file or directory') === 'not_found', 'no such file → not_found');
check(cat('desktop.focus_app', 'app not found: Photoshop') === 'not_found', 'app not found → not_found');
check(cat('browser.click_role', "couldn't find the button") === 'not_found', "couldn't find → not_found");
check(
  classifyToolFailure('desktop.click_element', 'element not found').actionableHint.toLowerCase().includes('re-observe'),
  'not_found hint says re-observe',
);

// document_mismatch — the active document changed.
check(cat('photoshop.apply', 'document mismatch: active document changed') === 'document_mismatch', 'document mismatch → document_mismatch');
check(cat('indesign.place', 'the active document is no longer the one you observed') === 'document_mismatch', 'active doc no longer → document_mismatch');
check(
  classifyToolFailure('photoshop.apply', 'document changed').actionableHint.toLowerCase().includes('document status'),
  'document_mismatch hint says re-read document status',
);

// approval_required — needs the user's approval.
check(cat('shell.run', 'this action requires user approval') === 'approval_required', 'requires approval → approval_required');
check(cat('fs.delete', 'permission denied by policy') === 'approval_required', 'permission denied → approval_required');
check(cat('wp.publish', 'blocked by a user constraint') === 'approval_required', 'blocked by constraint → approval_required');
check(
  classifyToolFailure('shell.run', 'requires approval').actionableHint.toLowerCase().includes('approval') &&
    /don['’]?t retry/i.test(classifyToolFailure('shell.run', 'requires approval').actionableHint),
  'approval_required hint asks to request approval, not retry',
);

// ambiguous_target — the selector matched more than one thing.
check(cat('desktop.click_element', 'ambiguous match') === 'ambiguous_target', 'ambiguous → ambiguous_target');
check(cat('browser.click_role', 'multiple elements matched the role "button"') === 'ambiguous_target', 'multiple matches → ambiguous_target');
check(cat('desktop.click_element', 'matched 4 candidates') === 'ambiguous_target', 'matched N → ambiguous_target');
check(
  classifyToolFailure('desktop.click_element', 'ambiguous target').actionableHint.toLowerCase().includes('narrow'),
  'ambiguous_target hint says narrow the target',
);

// transient — 429 / 5xx / timeout.
check(cat('llm.call', 'HTTP 429 Too Many Requests') === 'transient', '429 → transient');
check(cat('llm.call', 'rate limited, retry later') === 'transient', 'rate limited → transient');
check(cat('http.get', 'upstream returned 503 Service Unavailable') === 'transient', '503 → transient');
check(cat('http.get', 'socket hang up') === 'transient', 'socket hang up → transient');
check(cat('http.get', 'request timed out after 30s') === 'transient', 'timeout → transient');
check(
  classifyToolFailure('llm.call', 'HTTP 429').actionableHint.toLowerCase().includes('single retry'),
  'transient hint allows a single retry then stop',
);

// generic fallback — unrecognized error.
check(cat('mystery.tool', 'the flux capacitor destabilized') === 'generic', 'unrecognized → generic');
check(cat('x', '') === 'generic', 'empty error → generic');
check(cat('', 'weird') === 'generic', 'empty tool + odd error → generic');

// ── Precedence: sharper buckets beat broad ones ──────────────────────────────
// "permission denied … element not found" must read as approval, not not_found.
check(cat('fs.delete', 'permission denied: file not found in trash') === 'approval_required', 'approval checked before not_found');
// A 403 auth-ish transient with a rate-limit word must NOT be miscas approval.
check(cat('http.get', 'unauthorized: rate limited, try again later') === 'transient', 'rate-limit wins over the approval auth words');

// ── buildToolFailureFeedback shape ───────────────────────────────────────────
{
  const out = buildToolFailureFeedback('desktop.click_element', 'element not found: Export');
  check(out.startsWith('[recovery] '), 'feedback starts with the recovery marker');
  check(out.includes('Re-observe'), 'feedback carries the actionable hint');
  check(out.includes('element not found: Export'), 'feedback echoes the original error');
  const nl = out.indexOf('\n');
  check(nl > 0 && out.slice(0, nl).startsWith('[recovery]'), 'hint is on the first line (max recency)');
  check(out.slice(nl + 1).includes('element not found'), 'original error follows on the next line');
}

// Empty error → hint only, no trailing newline/body.
{
  const out = buildToolFailureFeedback('x', '');
  check(out.startsWith('[recovery] '), 'empty-error feedback still leads with recovery');
  check(!out.includes('\n'), 'no error body appended when the error is empty');
}

// ── Error clamping — a giant body is truncated with a clear marker ───────────
{
  const huge = 'A'.repeat(TOOL_FAILURE_ERROR_CLAMP + 5000);
  const out = buildToolFailureFeedback('http.get', huge);
  check(out.length < huge.length, 'clamp: output shorter than the raw error');
  check(out.includes('[truncated'), 'clamp: truncation marker present');
  // The echoed A-run must be capped at the clamp length (not the full 5000+).
  const aRun = (out.match(/A+/g) || []).reduce((m, s) => Math.max(m, s.length), 0);
  check(aRun <= TOOL_FAILURE_ERROR_CLAMP, 'clamp: echoed body capped at the clamp length');
}

// Whitespace is collapsed so a multi-line error doesn't bloat the prompt.
{
  const out = buildToolFailureFeedback('x', 'line one\n\n\n   line two\t\tline three');
  const body = out.split('\n').slice(1).join('\n');
  check(!/\n/.test(body) && !/\s{2,}/.test(body), 'clamp: internal whitespace collapsed to single spaces');
}

// ── No-secret amplification — the builder invents nothing ────────────────────
// The builder must not manufacture secrets and must not exceed hint + clamped
// error. A benign error with no secret stays secret-free (defense in depth: the
// builder can't add material the error didn't contain).
{
  const out = buildToolFailureFeedback('desktop.click_element', 'element not found');
  check(!/sk-[A-Za-z0-9]/.test(out) && !/token|password|secret/i.test(out), 'no secret material fabricated by the builder');
  // Everything after the hint line is exactly the (clamped) input, nothing more.
  const hint = classifyToolFailure('desktop.click_element', 'element not found').actionableHint;
  check(out === `[recovery] ${hint}\nelement not found`, 'output is exactly hint + original error (no extra content)');
}
// A giant secret-bearing error is CLAMPED, not echoed whole (bounds re-amplification).
{
  const secretHeavy = 'authorization: Bearer sk-' + 'Z'.repeat(TOOL_FAILURE_ERROR_CLAMP + 2000);
  const out = buildToolFailureFeedback('http.get', secretHeavy);
  check(out.length < secretHeavy.length + 100, 'secret-heavy error is bounded, not fully re-amplified');
  check(out.includes('[truncated'), 'secret-heavy error is visibly truncated');
}

console.log(`All tool failure feedback smoke cases passed (${count} assertions).`);
