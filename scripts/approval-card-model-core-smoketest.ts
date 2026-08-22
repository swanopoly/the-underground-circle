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
 *   - RISK_TIER_CHIP_COLORS covers every chip tone;
 *   - batch-card plan: planRunApprovalBatchCards folds same-tool same-risk
 *     runtime-stamped rows into one "Approve all N" entry, and every
 *     narrowing rule (missing toolApprovalKey, non-batchable kind, external
 *     side effect, floor/credential tool, destructive/missing preview,
 *     cross-tool, hostile payloads) fails toward solo cards.
 *
 * Run: npx tsx scripts/approval-card-model-core-smoketest.ts
 */

import {
  mapPreviewRiskToTier,
  isApprovalRowLive,
  shouldOfferRememberAutoApprove,
  planRunApprovalBatchCards,
  RISK_TIER_CHIP_COLORS,
  type RunApprovalCardPlanEntry,
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
  // Only positively identified non-interrupting effects keep the checkbox.
  assertEq(shouldOfferRememberAutoApprove('memory_read', 'memory.search'), true, '3.11 memory_read/memory.search → offered');
  assertEq(shouldOfferRememberAutoApprove('memory_write', 'save_memory'), false, '3.12 persistent memory write → exact only');
  assertEq(shouldOfferRememberAutoApprove('browser_click', 'browser.click'), false, '3.13 ambiguous browser click → exact only');
  assertEq(shouldOfferRememberAutoApprove('desktop_action', 'desktop.focus_app'), false, '3.14 broad desktop category cannot mint a standing grant');
  // Hostile input suppresses rather than throwing (fail-closed).
  assertEq(shouldOfferRememberAutoApprove(null, null), false, '3.15 null/null → suppressed');
  assertEq(shouldOfferRememberAutoApprove(undefined, 'desktop.delete'), false, '3.16 undefined category, floor tool → suppressed');
  assertEq(shouldOfferRememberAutoApprove(42 as unknown, {} as unknown), false, '3.17 non-string inputs → suppressed without throwing');
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

  // ── Group 5: planRunApprovalBatchCards ─────────────────────────────────────
  // Row builder shaped like a runtime-stamped agent_run_approvals row.
  const mkRow = (opts: {
    kind?: string;
    tool?: string;
    noTool?: boolean;
    key?: string;
    noKey?: boolean;
    risk?: string;
    noPreview?: boolean;
    externalSideEffect?: boolean;
    runId?: string | null;
    requestedBy?: string | null;
  } = {}): Record<string, unknown> => {
    const payload: Record<string, unknown> = {};
    if (!opts.noTool) payload.tool = opts.tool ?? 'browser.fill_field';
    if (!opts.noKey) payload.toolApprovalKey = opts.key ?? 'key-1';
    if (!opts.noPreview) payload.approvalPreview = { risk: opts.risk ?? 'write' };
    if (opts.externalSideEffect) payload.externalSideEffect = true;
    return {
      approval_kind: opts.kind ?? 'tool_use',
      title: 't',
      run_id: opts.runId === undefined ? '11111111-1111-4111-8111-111111111111' : opts.runId,
      requested_by: opts.requestedBy === undefined ? '22222222-2222-4222-8222-222222222222' : opts.requestedBy,
      payload,
    };
  };
  // Coverage helper: every index in [0, n) appears in exactly one entry.
  const coveredIndices = (plan: RunApprovalCardPlanEntry[]): number[] =>
    plan
      .flatMap((e) => (e.kind === 'single' ? [e.index] : e.indices))
      .slice()
      .sort((a, b) => a - b);
  const allSingles = (plan: RunApprovalCardPlanEntry[]): boolean =>
    plan.every((e) => e.kind === 'single');

  // 5.1 three same-tool writes → ONE batch(3), medium/reversible.
  const p1 = planRunApprovalBatchCards([mkRow(), mkRow(), mkRow()]);
  assertEq(p1.length, 1, '5.1a 3× same-tool write → one entry');
  assert(p1[0].kind === 'batch', '5.1b entry is a batch');
  if (p1[0].kind === 'batch') {
    assertEq(JSON.stringify(p1[0].indices), '[0,1,2]', '5.1c batch covers all three rows');
    assertEq(p1[0].tool, 'browser.fill_field', '5.1d batch carries the shared tool');
    assertEq(p1[0].combinedRisk, 'medium', '5.1e write tier → medium bucket');
    assertEq(p1[0].tier, 'reversible', '5.1f write batch chip tier reversible');
  }

  // 5.2 read and write NEVER co-mingle, even for the same tool.
  const p2 = planRunApprovalBatchCards([
    mkRow({ tool: 'gdrive.list', risk: 'read' }),
    mkRow({ tool: 'gdrive.list', risk: 'read' }),
    mkRow({ tool: 'gdrive.list', risk: 'write' }),
    mkRow({ tool: 'gdrive.list', risk: 'write' }),
  ]);
  assertEq(p2.length, 2, '5.2a read+write same tool → two entries');
  assert(p2.every((e) => e.kind === 'batch'), '5.2b both entries are batches');
  if (p2[0].kind === 'batch' && p2[1].kind === 'batch') {
    assertEq(JSON.stringify(p2[0].indices), '[0,1]', '5.2c read batch covers reads only');
    assertEq(p2[0].combinedRisk, 'low', '5.2d read batch is low bucket');
    assertEq(p2[0].tier, 'read', '5.2e read batch chip tier read');
    assertEq(JSON.stringify(p2[1].indices), '[2,3]', '5.2f write batch covers writes only');
    assertEq(p2[1].combinedRisk, 'medium', '5.2g write batch is medium bucket');
  }

  // 5.2g matching tool/risk still cannot combine different durable origins.
  assert(
    allSingles(planRunApprovalBatchCards([
      mkRow(),
      mkRow({ runId: '33333333-3333-4333-8333-333333333333' }),
    ])),
    '5.2g different source runs stay separate',
  );
  assert(
    allSingles(planRunApprovalBatchCards([
      mkRow(),
      mkRow({ requestedBy: '44444444-4444-4444-8444-444444444444' }),
    ])),
    '5.2h different requesters stay separate',
  );
  assert(
    allSingles(planRunApprovalBatchCards([
      mkRow({ runId: null }),
      mkRow({ runId: null }),
    ])),
    '5.2i missing source-run identity fails closed to solo cards',
  );

  // 5.3 destructive preview → always solo (critical never batches).
  const p3 = planRunApprovalBatchCards([
    mkRow({ risk: 'destructive' }),
    mkRow({ risk: 'destructive' }),
  ]);
  assertEq(p3.length, 2, '5.3a 2× destructive → two entries');
  assert(allSingles(p3), '5.3b destructive rows stay solo');

  // 5.4 missing/empty toolApprovalKey → solo (only the runtime gate stamps it).
  assert(
    allSingles(planRunApprovalBatchCards([mkRow({ noKey: true }), mkRow({ noKey: true })])),
    '5.4a missing key → solo',
  );
  assert(
    allSingles(planRunApprovalBatchCards([mkRow({ key: '' }), mkRow({ key: '' })])),
    '5.4b empty-string key → solo',
  );
  const p4c = planRunApprovalBatchCards([mkRow(), mkRow({ noKey: true }), mkRow()]);
  assertEq(
    JSON.stringify(p4c.map((e) => e.kind)),
    '["batch","single"]',
    '5.4c keyless row solo while keyed rows still batch',
  );

  // 5.5 payload.externalSideEffect === true → solo.
  assert(
    allSingles(planRunApprovalBatchCards([
      mkRow({ externalSideEffect: true }),
      mkRow({ externalSideEffect: true }),
    ])),
    '5.5 externalSideEffect rows stay solo',
  );

  // 5.6 non-batchable kinds → solo even ×2 same tool.
  for (const kind of ['publish', 'external_send', 'cost_threshold', 'plan_approval', 'deliverable_review', 'made_up_kind']) {
    assert(
      allSingles(planRunApprovalBatchCards([mkRow({ kind }), mkRow({ kind })])),
      `5.6 kind ${kind} → solo`,
    );
  }

  // 5.7 floor/credential tools → solo (fill_credential_field has no literal
  // floor marker — the credential check is load-bearing).
  assert(
    allSingles(planRunApprovalBatchCards([
      mkRow({ tool: 'browser.fill_credential_field' }),
      mkRow({ tool: 'browser.fill_credential_field' }),
    ])),
    '5.7a credential tool → solo',
  );
  assert(
    allSingles(planRunApprovalBatchCards([
      mkRow({ tool: 'desktop.delete_file', risk: 'write' }),
      mkRow({ tool: 'desktop.delete_file', risk: 'write' }),
    ])),
    '5.7b floor-marker tool (delete) → solo',
  );

  // 5.8 no cross-tool merge: different tools never share a batch.
  const p8 = planRunApprovalBatchCards([
    mkRow({ tool: 'browser.fill_field' }),
    mkRow({ tool: 'browser.set_toggle' }),
  ]);
  assertEq(p8.length, 2, '5.8a two tools → two entries');
  assert(allSingles(p8), '5.8b singles, never a cross-tool batch');
  const p8b = planRunApprovalBatchCards([
    mkRow({ tool: 'browser.fill_field' }),
    mkRow({ tool: 'browser.fill_field' }),
    mkRow({ tool: 'browser.set_toggle' }),
  ]);
  assertEq(
    JSON.stringify(p8b.map((e) => e.kind)),
    '["batch","single"]',
    '5.8c same-tool pair batches, odd tool stays single',
  );

  // 5.9 hostile rows → solo; healthy neighbors still batch.
  const hostile: Record<string, unknown> = {};
  Object.defineProperty(hostile, 'payload', {
    get() { throw new Error('boom'); },
    enumerable: true,
  });
  const p9 = planRunApprovalBatchCards([mkRow(), hostile, mkRow()]);
  assertEq(
    JSON.stringify(p9.map((e) => e.kind)),
    '["batch","single"]',
    '5.9a throwing-getter row solo, good rows batch',
  );
  assertEq(JSON.stringify(coveredIndices(p9)), '[0,1,2]', '5.9b hostile plan still covers every row');
  assert(allSingles(planRunApprovalBatchCards([null, undefined, 42, 'x'])), '5.9c non-object rows → solo');
  assertEq(planRunApprovalBatchCards(null as unknown).length, 0, '5.9d non-array input → empty plan');
  assertEq(planRunApprovalBatchCards({ length: 3 } as unknown).length, 0, '5.9e array-like object → empty plan');

  // 5.10 a single eligible row is a single card, never a 1-batch.
  const p10 = planRunApprovalBatchCards([mkRow()]);
  assertEq(JSON.stringify(p10), '[{"kind":"single","index":0}]', '5.10 one row → one single');

  // 5.11 missing preview → solo (risk unknown never batches).
  assert(
    allSingles(planRunApprovalBatchCards([mkRow({ noPreview: true }), mkRow({ noPreview: true })])),
    '5.11a previewless rows → solo',
  );
  assert(
    allSingles(planRunApprovalBatchCards([
      mkRow({ risk: 'reversible' }),
      mkRow({ risk: 'reversible' }),
    ])),
    '5.11b preview risk outside read/write/destructive → solo (no tier laundering)',
  );

  // 5.12 toolless rows → solo even with keys.
  assert(
    allSingles(planRunApprovalBatchCards([mkRow({ noTool: true }), mkRow({ noTool: true })])),
    '5.12 rows without payload.tool → solo',
  );

  // 5.13 ordering + full coverage on an interleaved queue.
  const p13 = planRunApprovalBatchCards([
    mkRow({ tool: 'browser.fill_field' }),     // 0 ┐ batch (medium, exact reversible tool)
    mkRow({ risk: 'destructive' }),            // 1   solo
    mkRow({ tool: 'browser.fill_field' }),     // 2 ┘
    mkRow({ tool: 'gdrive.list', risk: 'read' }), // 3   single (lone read)
  ]);
  assertEq(
    JSON.stringify(p13.map((e) => (e.kind === 'single' ? `s${e.index}` : `b${e.indices.join('+')}`))),
    '["b0+2","s1","s3"]',
    '5.13a entries ordered by first covered index',
  );
  assertEq(JSON.stringify(coveredIndices(p13)), '[0,1,2,3]', '5.13b every row covered exactly once');

  // 5.14 determinism: same input → identical plan.
  const detRows = [mkRow(), mkRow({ risk: 'read', tool: 'gdrive.list' }), mkRow(), hostile];
  assertEq(
    JSON.stringify(planRunApprovalBatchCards(detRows)),
    JSON.stringify(planRunApprovalBatchCards(detRows)),
    '5.14 deterministic plan',
  );

  // 5.15 same exact reversible tool across two generic container kinds still
  // batches (partition key is the tool + durable origin).
  const p15 = planRunApprovalBatchCards([
    mkRow({ kind: 'tool_use' }),
    mkRow({ kind: 'browser_action' }),
  ]);
  assertEq(p15.length, 1, '5.15a same-tool cross-kind pair → one entry');
  assert(p15[0].kind === 'batch', '5.15b entry is a batch');

  if (failures > 0) {
    console.error('\n' + failures + ' fail');
    process.exit(1);
  }
  console.log('\nAll approval-card-model-core smoke cases passed (' + passes + ' passed).');
}
main();
