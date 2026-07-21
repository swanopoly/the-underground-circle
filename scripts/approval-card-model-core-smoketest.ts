/**
 * Smoke: approvalCardModelCore — shared approval-banner card model.
 *
 * Pins the consolidation contract:
 *   - risk vocab: preview read/write/destructive → tier read/reversible/
 *     irreversible, and destructive MUST land on the red IRREVERSIBLE chip
 *     (the exact miswire the old per-banner vocab split caused);
 *   - liveness: explicit timeout window when set, 30-min staleness cap when
 *     not, unparsable requested_at is dead (fail-closed);
 *   - remember-checkbox floor suppression: pay/delete/login/grant substrings
 *     and credential entry never offer a standing auto-approve;
 *   - RISK_TIER_CHIP_COLORS covers every chip tone.
 *
 * Run: npx tsx scripts/approval-card-model-core-smoketest.ts
 */

import {
  mapPreviewRiskToTier,
  isApprovalRowLive,
  shouldOfferRememberAutoApprove,
  RISK_TIER_CHIP_COLORS,
} from '../src/lib/approvalCardModelCore';
import { describeApprovalRiskChip } from '../src/lib/approvalIntentPreview';
import { APPROVAL_EXPIRED_MS } from '../src/lib/approvalPreviewCore';

let passes = 0,
  failures = 0;
function assert(c: boolean, m: string, e?: string) {
  if (c) passes++;
  else {
    failures++;
    console.error('FAIL: ' + m + (e ? ' :: ' + e : ''));
  }
}
function assertEq(a: any, b: any, m: string) {
  assert(a === b, m, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));
}

function main() {
  // ── Group 1: mapPreviewRiskToTier ──────────────────────────────────────────
  assertEq(mapPreviewRiskToTier('read'), 'read', '1.1 read → read');
  assertEq(mapPreviewRiskToTier('write'), 'reversible', '1.2 write → reversible');
  assertEq(mapPreviewRiskToTier('destructive'), 'irreversible', '1.3 destructive → irreversible');
  assertEq(mapPreviewRiskToTier('  DESTRUCTIVE  '), 'irreversible', '1.4 case/space-tolerant');
  // Hostile / unknown inputs → safest VISIBLE tier, never a throw.
  assertEq(mapPreviewRiskToTier(''), 'reversible', '1.5 empty → reversible');
  assertEq(mapPreviewRiskToTier(null), 'reversible', '1.6 null → reversible');
  assertEq(mapPreviewRiskToTier(undefined), 'reversible', '1.7 undefined → reversible');
  assertEq(mapPreviewRiskToTier(42), 'reversible', '1.8 number → reversible');
  assertEq(mapPreviewRiskToTier({ risk: 'destructive' }), 'reversible', '1.9 object → reversible');
  assertEq(mapPreviewRiskToTier('rm -rf /'), 'reversible', '1.10 arbitrary string → reversible');

  // The exact miswire the old vocab split caused: RunApprovalBanner fed the
  // preview word 'destructive' into a tier keyed map and fell back to blue
  // REVERSIBLE. Through the shared fold it must be the red IRREVERSIBLE chip.
  const destructiveChip = describeApprovalRiskChip(mapPreviewRiskToTier('destructive'));
  assertEq(destructiveChip.label, 'IRREVERSIBLE', '1.11 destructive chip label IRREVERSIBLE');
  assertEq(destructiveChip.tone, 'red', '1.12 destructive chip tone red');
  const readChip = describeApprovalRiskChip(mapPreviewRiskToTier('read'));
  assertEq(readChip.label, 'READ', '1.13 read chip label READ');
  assertEq(readChip.tone, 'green', '1.14 read chip tone green');
  const writeChip = describeApprovalRiskChip(mapPreviewRiskToTier('write'));
  assertEq(writeChip.label, 'REVERSIBLE', '1.15 write chip label REVERSIBLE');
  assertEq(writeChip.tone, 'blue', '1.16 write chip tone blue');

  // ── Group 2: isApprovalRowLive ─────────────────────────────────────────────
  const now = Date.parse('2026-07-20T12:00:00.000Z');
  const secsAgo = (s: number) => new Date(now - s * 1000).toISOString();

  // Explicit timeout window (timeout 300).
  assertEq(isApprovalRowLive(secsAgo(299), 300, now), true, '2.1 timeout 300 at 299s → live');
  assertEq(isApprovalRowLive(secsAgo(301), 300, now), false, '2.2 timeout 300 at 301s → dead');
  assertEq(isApprovalRowLive(secsAgo(300), 300, now), false, '2.3 timeout 300 at exactly 300s → dead (strict >)');
  assertEq(isApprovalRowLive(secsAgo(0), 300, now), true, '2.4 timeout 300 at 0s → live');

  // No timeout (<=0) → 30-min classifyApprovalAge staleness cap.
  assertEq(isApprovalRowLive(secsAgo(29 * 60), 0, now), true, '2.5 no timeout at 29min → live');
  assertEq(isApprovalRowLive(secsAgo(31 * 60), 0, now), false, '2.6 no timeout at 31min → dead');
  assertEq(isApprovalRowLive(secsAgo(30 * 60), 0, now), false, '2.7 no timeout at exactly 30min → dead');
  assertEq(APPROVAL_EXPIRED_MS, 30 * 60_000, '2.8 staleness cap is 30min (contract pin)');
  assertEq(isApprovalRowLive(secsAgo(29 * 60), -5, now), true, '2.9 negative timeout → staleness cap path, live at 29min');
  assertEq(isApprovalRowLive(secsAgo(29 * 60), 'nonsense', now), true, '2.10 non-numeric timeout → staleness cap path');

  // Fail-closed on unverifiable timestamps.
  assertEq(isApprovalRowLive('garbage-not-a-date', 300, now), false, '2.11 unparsable requested_at (with timeout) → dead');
  assertEq(isApprovalRowLive('garbage-not-a-date', 0, now), false, '2.12 unparsable requested_at (no timeout) → dead');
  assertEq(isApprovalRowLive(null, 300, now), false, '2.13 null requested_at → dead');
  assertEq(isApprovalRowLive(undefined, 0, now), false, '2.14 undefined requested_at → dead');
  assertEq(isApprovalRowLive(1234567890, 300, now), false, '2.15 non-string requested_at → dead');
  assertEq(isApprovalRowLive('', 300, now), false, '2.16 empty requested_at → dead');

  // Clock skew: a slightly-future requested_at is fresh, not dead.
  assertEq(isApprovalRowLive(secsAgo(-30), 300, now), true, '2.17 future requested_at within window → live');

  // ── Group 3: shouldOfferRememberAutoApprove ────────────────────────────────
  // Floor substrings in the CATEGORY suppress.
  assertEq(shouldOfferRememberAutoApprove('delete_file', 'files.remove'), false, '3.1 category contains delete → suppressed');
  assertEq(shouldOfferRememberAutoApprove('paywall_purchase', 'shop.buy'), false, '3.2 category contains pay → suppressed');
  assertEq(shouldOfferRememberAutoApprove('login_flow', 'browser.click'), false, '3.3 category contains login → suppressed');
  assertEq(shouldOfferRememberAutoApprove('grant_access', 'perm.set'), false, '3.4 category contains grant → suppressed');
  // Floor substrings in the TOOL suppress even with a benign category.
  assertEq(shouldOfferRememberAutoApprove('desktop_action', 'desktop.delete'), false, '3.5 tool contains delete → suppressed');
  assertEq(shouldOfferRememberAutoApprove('browser_click', 'browser.login_field'), false, '3.6 tool contains login → suppressed');
  assertEq(shouldOfferRememberAutoApprove('external_publish', 'wp.pay_invoice'), false, '3.7 tool contains pay → suppressed');
  assertEq(shouldOfferRememberAutoApprove('desktop_action', 'system.grant_permission'), false, '3.8 tool contains grant → suppressed');
  // Credential entry is login-floor territory even without a literal marker
  // (mirrors toolAutoApproveCategory's explicit null for credential fill).
  assertEq(
    shouldOfferRememberAutoApprove('browser_actions', 'browser.fill_credential_field'),
    false,
    '3.9 credential fill tool → suppressed',
  );
  assertEq(shouldOfferRememberAutoApprove('password_entry', 'browser.type'), false, '3.10 password-ish category → suppressed');
  // Benign categories/tools keep the checkbox.
  assertEq(shouldOfferRememberAutoApprove('memory_read', 'memory.search'), true, '3.11 memory_read/memory.search → offered');
  assertEq(shouldOfferRememberAutoApprove('memory_write', 'save_memory'), true, '3.12 memory_write/save_memory → offered');
  assertEq(shouldOfferRememberAutoApprove('browser_click', 'browser.click'), true, '3.13 browser_click → offered');
  assertEq(shouldOfferRememberAutoApprove('desktop_action', 'desktop.focus_app'), true, '3.14 desktop focus → offered');
  // Hostile input suppresses rather than throwing (fail-closed).
  assertEq(shouldOfferRememberAutoApprove(null, null), true, '3.15 null/null → offered (no floor signal, caller already had a category)');
  assertEq(shouldOfferRememberAutoApprove(undefined, 'desktop.delete'), false, '3.16 undefined category, floor tool → suppressed');
  assertEq(shouldOfferRememberAutoApprove(42 as unknown, {} as unknown), true, '3.17 non-string inputs → no throw');
  assertEq(shouldOfferRememberAutoApprove('DELETE_ALL', 'x'), false, '3.18 case-insensitive floor match → suppressed');

  // ── Group 4: RISK_TIER_CHIP_COLORS completeness ────────────────────────────
  for (const tone of ['green', 'blue', 'amber', 'red'] as const) {
    const c = RISK_TIER_CHIP_COLORS[tone];
    assert(!!c, `4.${tone} tone present`);
    assert(
      typeof c.fg === 'string' && c.fg.startsWith('#') &&
      typeof c.bg === 'string' && c.bg.startsWith('#') &&
      typeof c.border === 'string' && c.border.startsWith('#'),
      `4.${tone} fg/bg/border are hex colors`,
    );
  }
  // Every chip a tier can produce must have colors (no undefined lookups).
  for (const tier of ['read', 'reversible', 'external', 'irreversible'] as const) {
    const chip = describeApprovalRiskChip(tier);
    assert(!!RISK_TIER_CHIP_COLORS[chip.tone], `4.chip ${tier} → tone ${chip.tone} has colors`);
  }

  if (failures > 0) {
    console.error('\n' + failures + ' fail');
    process.exit(1);
  }
  console.log('\nAll approval-card-model-core smoke cases passed (' + passes + ' passed).');
}
main();
