/**
 * native-ui-verification-core smoke.
 *
 * The point of this suite is NOT "does it return verified" — it is that it
 * REFUSES to. The whole reason the generic native actions were sealed
 * `outcome_unknown` is that a bridge acknowledgement proves nothing, and the
 * failure mode of fixing that is to accept "the app changed" as proof the
 * action worked. Most cases below assert that unattributable movement stays
 * `unknown`.
 */

import {
  planNativeUiVerification,
  verifyNativeUiAfterState,
  MAX_REASON_CHARS,
} from '../src/lib/nativeUiVerificationCore';
import { A11Y_SNAPSHOT_MAX_STRING_LENGTH, type A11ySummaryDiff } from '../src/lib/a11yTreeDiff';

let passed = 0;
const failures: string[] = [];
function assert(cond: boolean, label: string) {
  if (cond) { passed++; console.log(`pass: ${label}`); }
  else { failures.push(label); console.error(`FAIL: ${label}`); }
}

/** Minimal diff builder — mirrors A11ySummaryDiff's totals contract. */
function makeDiff(parts: Partial<A11ySummaryDiff>): A11ySummaryDiff {
  const added = parts.added ?? [];
  const removed = parts.removed ?? [];
  const changed = parts.changed ?? [];
  return {
    added, removed, changed,
    unchangedCount: parts.unchangedCount ?? 0,
    addedTotal: parts.addedTotal ?? added.length,
    removedTotal: parts.removedTotal ?? removed.length,
    changedTotal: parts.changedTotal ?? changed.length,
    addedTruncated: false, removedTruncated: false, changedTruncated: false,
    truncated: false,
  } as A11ySummaryDiff;
}

const EMPTY = makeDiff({});

function valueChange(after: string, label = '', role = 'AXTextField') {
  return makeDiff({
    changed: [{ key: 'k1', role, label, field: 'value', before: '', after }] as any,
  });
}

function main() {
  // ─── Planning ────────────────────────────────────────────────────
  {
    const p = planNativeUiVerification('desktop.type_text', { text: 'hello world' });
    assert(p.expectation?.expectKind === 'value_change', 'type_text expects a value change');
    assert(p.expectedText === 'hello world', 'type_text carries the sent text as the proof target');
    assert(p.requiresVisibleChange === true, 'type_text must move the tree');

    const noText = planNativeUiVerification('desktop.type_text', {});
    assert(noText.expectedText === null, 'type_text with no text has no proof target');

    const menu = planNativeUiVerification('desktop.menu_click', { menuPath: ['File', 'Export', 'PNG'] });
    assert(menu.expectation?.expectKind === 'appear', 'menu_click expects a node to appear');
    assert(menu.expectation?.expectLabel === 'PNG', 'menu_click expects the LEAF item, not the top menu');
    assert(menu.requiresVisibleChange === true, 'menu_click must move the tree');

    const emptyMenu = planNativeUiVerification('desktop.menu_click', { menuPath: [] });
    assert(emptyMenu.expectation === null, 'menu_click with no path has no expectation');

    // Mouse/scroll/keys: no signature, and crucially NOT required to move.
    for (const t of ['desktop.mouse_move', 'desktop.mouse_scroll', 'desktop.mouse_down', 'desktop.press_keys', 'desktop.click_at'] as const) {
      const q = planNativeUiVerification(t, {});
      assert(q.expectation === null, `${t}: no attributable expectation`);
    }
    assert(planNativeUiVerification('desktop.mouse_move', {}).requiresVisibleChange === false,
      'mouse_move is NOT required to move the tree (hover lands invisibly)');
    assert(planNativeUiVerification('desktop.mouse_scroll', {}).requiresVisibleChange === false,
      'scroll is NOT required to move the tree (canvas scroll is invisible)');
  }

  // ─── Unusable snapshots are ALWAYS unknown ───────────────────────
  {
    const plan = planNativeUiVerification('desktop.type_text', { text: 'abc' });
    const r = verifyNativeUiAfterState({ tool: 'desktop.type_text', plan, diff: valueChange('abc'), snapshotsUsable: false });
    assert(r.verdict === 'unknown', 'no usable snapshot → unknown even when a diff is supplied');
    const r2 = verifyNativeUiAfterState({ tool: 'desktop.type_text', plan, diff: null, snapshotsUsable: true });
    assert(r2.verdict === 'unknown', 'null diff → unknown');
  }

  // ─── The new signal: an unmoved tree is FAILURE, not ignorance ───
  {
    const plan = planNativeUiVerification('desktop.type_text', { text: 'abc' });
    const r = verifyNativeUiAfterState({ tool: 'desktop.type_text', plan, diff: EMPTY, snapshotsUsable: true });
    assert(r.verdict === 'no_effect', 'typing that moved nothing → no_effect (a real, reportable failure)');
    assert(/did not take effect/i.test(r.reason), 'no_effect explains itself');
    assert(/do not repeat the same call/i.test(r.reason), 'no_effect steers away from a blind retry');

    const mouse = planNativeUiVerification('desktop.mouse_move', {});
    const rm = verifyNativeUiAfterState({ tool: 'desktop.mouse_move', plan: mouse, diff: EMPTY, snapshotsUsable: true });
    assert(rm.verdict === 'unknown', 'mouse_move that moved nothing → unknown, NOT a manufactured failure');
  }

  // ─── verified requires the text to actually be there ─────────────
  {
    const plan = planNativeUiVerification('desktop.type_text', { text: 'Invoice 2026' });
    const hit = verifyNativeUiAfterState({
      tool: 'desktop.type_text', plan, snapshotsUsable: true,
      diff: valueChange('Invoice 2026'),
    });
    assert(hit.verdict === 'verified', 'value now contains the sent text → verified');
    assert(hit.expectationMatched === true, 'verified reports the expectation matched');

    const appended = verifyNativeUiAfterState({
      tool: 'desktop.type_text', plan, snapshotsUsable: true,
      diff: valueChange('Draft — Invoice 2026'),
    });
    assert(appended.verdict === 'verified', 'substring match: typing appends into existing content');

    const caseFold = verifyNativeUiAfterState({
      tool: 'desktop.type_text', plan, snapshotsUsable: true,
      diff: valueChange('INVOICE 2026'),
    });
    assert(caseFold.verdict === 'verified', 'match is case-insensitive');

    // THE important one: the app changed, but not with our text.
    const wrong = verifyNativeUiAfterState({
      tool: 'desktop.type_text', plan, snapshotsUsable: true,
      diff: valueChange('something else entirely'),
    });
    assert(wrong.verdict === 'unknown', 'a value change to OTHER content is NOT proof our text landed');
    assert(wrong.verdict !== 'verified', 'unattributable change never promotes to verified');

    // Movement in unrelated parts of the tree must not count either.
    const noise = verifyNativeUiAfterState({
      tool: 'desktop.type_text', plan, snapshotsUsable: true,
      diff: makeDiff({ added: [{ key: 'x', role: 'AXStaticText', label: 'clock' }] as any }),
    });
    assert(noise.verdict === 'unknown', 'unrelated tree movement is not verification');
  }

  // ─── Long text: the snapshot truncates at 120 chars ──────────────
  // paste_text accepts 20,000 chars, so without a truncation branch the single
  // most useful "write content into an app" action could never verify.
  {
    const long = `Chapter one. ${'lorem ipsum dolor sit amet '.repeat(200)}`;
    const plan = planNativeUiVerification('desktop.paste_text', { text: long });
    const truncatedAfter = long.slice(0, A11Y_SNAPSHOT_MAX_STRING_LENGTH);
    const r = verifyNativeUiAfterState({
      tool: 'desktop.paste_text', plan, snapshotsUsable: true,
      diff: valueChange(truncatedAfter),
    });
    assert(r.verdict === 'verified', 'a 120-char truncated prefix of the pasted text verifies');

    // A SHORT value that happens to sit inside our text must NOT qualify —
    // it is not at the cap, so it is not a truncation.
    const coincidence = verifyNativeUiAfterState({
      tool: 'desktop.paste_text', plan, snapshotsUsable: true,
      diff: valueChange('lorem'),
    });
    assert(coincidence.verdict === 'unknown', 'a short coincidental substring is NOT a truncated match');

    // A truncated value that is NOT ours still fails.
    const otherLong = verifyNativeUiAfterState({
      tool: 'desktop.paste_text', plan, snapshotsUsable: true,
      diff: valueChange('z'.repeat(A11Y_SNAPSHOT_MAX_STRING_LENGTH)),
    });
    assert(otherLong.verdict === 'unknown', 'a truncated value that is not our text does not verify');
  }

  // ─── menu_click attribution ──────────────────────────────────────
  {
    const plan = planNativeUiVerification('desktop.menu_click', { menuPath: ['File', 'Export'] });
    const opened = verifyNativeUiAfterState({
      tool: 'desktop.menu_click', plan, snapshotsUsable: true,
      diff: makeDiff({ added: [{ key: 'd1', role: 'AXDialog', label: 'Export' }] as any }),
    });
    assert(opened.verdict === 'verified', 'a dialog named after the menu item appeared → verified');

    const other = verifyNativeUiAfterState({
      tool: 'desktop.menu_click', plan, snapshotsUsable: true,
      diff: makeDiff({ added: [{ key: 'd2', role: 'AXDialog', label: 'Unrelated Panel' }] as any }),
    });
    assert(other.verdict === 'unknown', 'a DIFFERENT dialog appearing is not proof this menu item ran');
  }

  // ─── set_element_value + paste share the text-entry contract ─────
  {
    for (const t of ['desktop.paste_text', 'desktop.set_element_value'] as const) {
      const plan = planNativeUiVerification(t, { text: 'payload' });
      const ok = verifyNativeUiAfterState({ tool: t, plan, diff: valueChange('payload'), snapshotsUsable: true });
      assert(ok.verdict === 'verified', `${t}: text present → verified`);
      const nope = verifyNativeUiAfterState({ tool: t, plan, diff: EMPTY, snapshotsUsable: true });
      assert(nope.verdict === 'no_effect', `${t}: nothing moved → no_effect`);
    }
  }

  // ─── Reasons are bounded and never echo the sent text ────────────
  {
    const secretish = 'x'.repeat(5000);
    const plan = planNativeUiVerification('desktop.type_text', { text: secretish });
    for (const diff of [EMPTY, valueChange('other'), valueChange(secretish)]) {
      const r = verifyNativeUiAfterState({ tool: 'desktop.type_text', plan, diff, snapshotsUsable: true });
      assert(r.reason.length <= MAX_REASON_CHARS, 'reason is bounded');
      assert(!r.reason.includes(secretish), 'reason never echoes the text that was sent');
    }
  }

  // ─── Totals honoured over capped list lengths ────────────────────
  {
    const plan = planNativeUiVerification('desktop.click_at', {});
    const capped = makeDiff({ added: [], addedTotal: 12 });
    const r = verifyNativeUiAfterState({ tool: 'desktop.click_at', plan, diff: capped, snapshotsUsable: true });
    assert(r.changeCount === 12, 'changeCount uses *Total, not the capped list length');
    assert(r.verdict === 'unknown', 'clicks stay unknown even when the tree moved');
  }

  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length) {
    console.error(`\n${failures.length} native-ui-verification-core smoke failure(s)`);
    process.exit(1);
  }
  console.log('All native-ui-verification-core smoke cases passed.');
}

main();
