/**
 * proactive-surfacing-signals-smoketest — the PURE adapter layer
 * (src/lib/proactiveSurfacingSignals.ts) between the app's trouble sources
 * and proactiveSurfacingCore. Pins:
 *
 *   - deriveSnapshotSurfacingSignals: recentRuns failed/error → failed_run
 *     (entityId=id, surface='office', sinceMs=Date.parse(atIso) capped at
 *     nowMs); missions blocked/stalled/at_risk/overdue → stalled_mission
 *     (status-gated, NO fabricated timestamps); credentials with a real
 *     expires_at/rotation_due_at → expiring_credential (entityId=id,
 *     surface='marketplace', expiresAtMs=soonest of the two; null-expiry
 *     skipped; expired→moot; secret-shaped label masked); healthy rows skipped;
 *     overdue_task NEVER emitted (dormant — no due_date column); null/malformed
 *     snapshot → [].
 *   - attentionItemsToSurfacingSignals: approval_pending/approval_expiring/
 *     run_blocked → blocked_approval (key=item.id, entityId=refId,
 *     expiresAtMs=expiresAt, sinceMs=now−waitingMs); other kinds skipped;
 *     null → [].
 *   - renderProactiveSurfacingBody: null on silent decisions (note null /
 *     empty surface / null decision); rendered body carries the untrusted
 *     fence around note + "title — reason" lines and the trusted
 *     instruction line OUTSIDE the fence.
 *   - end-to-end: derived signals flow through selectProactiveSurfacings
 *     into a non-null rendered body.
 *
 * Run: npx tsx scripts/proactive-surfacing-signals-smoketest.ts
 */

import {
  attentionItemsToSurfacingSignals,
  deriveSnapshotSurfacingSignals,
  renderProactiveSurfacingBody,
  PROACTIVE_SURFACING_INSTRUCTION,
  MAX_ATTENTION_ITEMS,
} from '../src/lib/proactiveSurfacingSignals';
import { selectProactiveSurfacings } from '../src/lib/proactiveSurfacingCore';
import { assembleCircleContextSnapshot } from '../src/lib/circleContextSnapshot';
import type { ChatAttentionItem } from '../src/lib/chatAttentionQueue';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

const NOW = Date.parse('2026-07-20T12:00:00.000Z');

function makeSnapshot() {
  return assembleCircleContextSnapshot({
    circleId: 'circle-1',
    nowIso: new Date(NOW).toISOString(),
    recentRuns: [
      { id: 'run_failed_1', title: 'Deploy marketing site', status: 'failed', surface: 'office', atIso: '2026-07-20T10:00:00.000Z' },
      { id: 'run_error_1', title: 'Sync WordPress posts', status: 'error', surface: 'chat', atIso: 'not-a-date' },
      { id: 'run_ok_1', title: 'Nightly summary', status: 'completed', surface: 'office', atIso: '2026-07-20T09:00:00.000Z' },
      { id: 'run_running_1', title: 'Long import', status: 'running', surface: 'office', atIso: '2026-07-20T11:00:00.000Z' },
    ],
    missions: [
      { id: 'mis_blocked', title: 'Launch onboarding revamp', status: 'blocked', taskCount: 4 },
      { id: 'mis_stalled', title: 'Ship API v2', status: 'stalled', taskCount: 2 },
      { id: 'mis_at_risk', title: 'Migrate billing', status: 'at_risk', taskCount: 1 },
      { id: 'mis_overdue', title: 'Close Q3 books', status: 'overdue', taskCount: 3 },
      { id: 'mis_active', title: 'Healthy mission', status: 'active', taskCount: 5 },
    ],
  });
}

// ── (1) snapshot → failed_run derivation ────────────────────────────────────
{
  const snapshot = makeSnapshot();
  const signals = deriveSnapshotSurfacingSignals(snapshot, NOW);
  const failed = signals.filter((s) => s.kind === 'failed_run');
  assertEq(failed.length, 2, '(1) exactly the failed/error runs derive failed_run');
  const first = failed.find((s) => s.entityId === 'run_failed_1');
  assert(Boolean(first), '(1) failed run keeps entityId=id');
  assertEq(first?.title, 'Deploy marketing site', '(1) failed run keeps title');
  assertEq(first?.surface, 'office', '(1) failed run surface pinned to office');
  assertEq(first?.sinceMs, Date.parse('2026-07-20T10:00:00.000Z'), '(1) sinceMs = Date.parse(atIso)');
  const badDate = failed.find((s) => s.entityId === 'run_error_1');
  assertEq(badDate?.sinceMs, null, '(1) unparsable atIso → sinceMs null (not NaN)');
  // Clock-skew guard: a future atIso caps at nowMs instead of vanishing.
  const future = deriveSnapshotSurfacingSignals(assembleCircleContextSnapshot({
    circleId: 'c',
    recentRuns: [{ id: 'r', title: 'Future run', status: 'failed', surface: 'office', atIso: new Date(NOW + 60_000).toISOString() }],
  }), NOW);
  assertEq(future[0]?.sinceMs, NOW, '(1) future atIso capped at nowMs');
}

// ── (2) snapshot → stalled_mission derivation (status-gated only) ───────────
{
  const signals = deriveSnapshotSurfacingSignals(makeSnapshot(), NOW);
  const stalled = signals.filter((s) => s.kind === 'stalled_mission');
  assertEq(stalled.length, 4, '(2) blocked/stalled/at_risk/overdue missions derive stalled_mission');
  assert(!stalled.some((s) => s.entityId === 'mis_active'), '(2) healthy mission skipped');
  for (const s of stalled) {
    assert(s.sinceMs == null && s.expiresAtMs == null,
      '(2) no fabricated timestamps on status-gated missions', JSON.stringify(s));
  }
  assertEq(stalled[0]?.surface, 'feed', '(2) missions point at the feed surface');
  // overdue_task is still dormant (no due_date column). This snapshot carries no
  // credentials, so expiring_credential is absent for lack of data, not dormancy.
  assert(!signals.some((s) => s.kind === 'overdue_task'), '(2) overdue_task stays dormant (no due_date column)');
  assert(!signals.some((s) => s.kind === 'expiring_credential'), '(2) no credentials in snapshot → no expiring_credential');
  // Totality on hostile input.
  assertEq(deriveSnapshotSurfacingSignals(null, NOW).length, 0, '(2) null snapshot → []');
  assertEq(deriveSnapshotSurfacingSignals({} as never, NOW).length, 0, '(2) malformed snapshot → []');
}

// ── (2c) snapshot → expiring_credential derivation ──────────────────────────
{
  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;
  const credSnap = (cred: Record<string, unknown>) =>
    assembleCircleContextSnapshot({ circleId: 'circle-cred', nowIso: new Date(NOW).toISOString(), credentials: [cred as never] });

  // (a) expiring-in-12h derives a signal and SURFACES through the core.
  const soon = credSnap({ id: 'cred_wp', label: 'WordPress admin', platform: 'wordpress', expiresAtIso: new Date(NOW + 12 * HOUR).toISOString() });
  const soonSig = deriveSnapshotSurfacingSignals(soon, NOW).find((s) => s.kind === 'expiring_credential');
  assert(Boolean(soonSig), '(cred) expiring-in-12h derives an expiring_credential signal');
  assertEq(soonSig?.entityId, 'cred_wp', '(cred) entityId = credential id');
  assertEq(soonSig?.title, 'WordPress admin', '(cred) title = label');
  assertEq(soonSig?.surface, 'marketplace', '(cred) surface pinned to marketplace');
  assertEq(soonSig?.expiresAtMs, NOW + 12 * HOUR, '(cred) expiresAtMs = expiry timestamp');
  const soonDecision = selectProactiveSurfacings(deriveSnapshotSurfacingSignals(soon, NOW), { turnIndex: 0, nowMs: NOW });
  const surfacedSoon = soonDecision.surface.find((s) => s.entityId === 'cred_wp');
  assert(Boolean(surfacedSoon), '(cred) expiring-in-12h surfaces through the core');
  assertEq(surfacedSoon?.surface, 'marketplace', '(cred) surfaced credential keeps marketplace surface');

  // (b) already-expired (<= now) is derived but dropped as moot by the core.
  const expired = credSnap({ id: 'cred_exp', label: 'Stripe key', platform: 'stripe', expiresAtIso: new Date(NOW - 1000).toISOString() });
  const expiredSigs = deriveSnapshotSurfacingSignals(expired, NOW);
  assert(expiredSigs.some((s) => s.kind === 'expiring_credential' && s.entityId === 'cred_exp'),
    '(cred) expired credential still derives a signal (moot-drop is the core\'s job)');
  const expiredDecision = selectProactiveSurfacings(expiredSigs, { turnIndex: 0, nowMs: NOW });
  assert(!expiredDecision.surface.some((s) => s.entityId === 'cred_exp'), '(cred) expired credential never surfaces');
  assert(expiredDecision.suppressed.some((s) => s.reason === 'moot' && s.key === 'expiring_credential:cred_exp'),
    '(cred) expired credential suppressed as moot');

  // (c) no expiry AND no rotation date → skipped (never a fabricated deadline).
  const noDate = credSnap({ id: 'cred_null', label: 'GitHub token', platform: 'github' });
  assert(!deriveSnapshotSurfacingSignals(noDate, NOW).some((s) => s.kind === 'expiring_credential'),
    '(cred) credential with no expiry/rotation date is skipped');

  // (d) secret-shaped label is masked to [hidden] by the core; raw never leaks.
  const secretLabel = 'ghp_' + 'x'.repeat(36);
  const secret = credSnap({ id: 'cred_secret', label: secretLabel, platform: 'github', expiresAtIso: new Date(NOW + 12 * HOUR).toISOString() });
  const secretDecision = selectProactiveSurfacings(deriveSnapshotSurfacingSignals(secret, NOW), { turnIndex: 0, nowMs: NOW });
  const surfacedSecret = secretDecision.surface.find((s) => s.entityId === 'cred_secret');
  assert(Boolean(surfacedSecret), '(cred) secret-labelled credential still surfaces');
  assertEq(surfacedSecret?.title, '[hidden]', '(cred) secret-shaped label masked to [hidden]');
  assert(!JSON.stringify(secretDecision).includes(secretLabel), '(cred) raw secret-shaped label never appears in the decision');

  // (e) soonest-of-two: expiry 48h out but rotation due 6h → the 6h drives it.
  const both = credSnap({ id: 'cred_both', label: 'Netlify deploy', platform: 'netlify',
    expiresAtIso: new Date(NOW + 48 * HOUR).toISOString(), rotationDueIso: new Date(NOW + 6 * HOUR).toISOString() });
  const bothSig = deriveSnapshotSurfacingSignals(both, NOW).find((s) => s.kind === 'expiring_credential');
  assertEq(bothSig?.expiresAtMs, NOW + 6 * HOUR, '(cred) expiresAtMs = soonest of expiry/rotation');

  // (f) rotation-due-only (no expires_at) still derives, keyed off rotation.
  const rotOnly = credSnap({ id: 'cred_rot', label: 'Cloudflare API', platform: 'cloudflare', rotationDueIso: new Date(NOW + 8 * HOUR).toISOString() });
  const rotSig = deriveSnapshotSurfacingSignals(rotOnly, NOW).find((s) => s.kind === 'expiring_credential');
  assert(Boolean(rotSig), '(cred) rotation-due-only credential derives a signal');
  assertEq(rotSig?.expiresAtMs, NOW + 8 * HOUR, '(cred) rotation-only expiresAtMs = rotation timestamp');

  // (g) carrier is bounded (cap 25) and secret-safe (only the 5 declared fields).
  const capped = assembleCircleContextSnapshot({
    circleId: 'circle-cred',
    credentials: Array.from({ length: 40 }, (_, i) => ({ id: `c${i}`, label: `Cred ${i}`, platform: 'wordpress', expiresAtIso: new Date(NOW + HOUR).toISOString() })),
  });
  assertEq(capped.credentials?.length, 25, '(cred) credential carrier capped at 25');
  const carrier = both.credentials?.[0];
  assert(
    Boolean(carrier) && Object.keys(carrier!).every((k) => ['id', 'label', 'platform', 'expiresAtIso', 'rotationDueIso'].includes(k)),
    '(cred) credential carrier only exposes secret-safe fields (no username/credential_encrypted)',
  );

  // (h) near-term horizon gate: a deadline weeks/months out is NOT "expiring
  // soon" and must not surface (else it steals top-k priority from real items).
  const farFuture = credSnap({ id: 'cred_far', label: 'WordPress admin', platform: 'wordpress',
    rotationDueIso: new Date(NOW + 45 * DAY).toISOString() });
  assert(
    !deriveSnapshotSurfacingSignals(farFuture, NOW).some((s) => s.kind === 'expiring_credential'),
    '(cred) 45-day-out credential is NOT surfaced (outside the near-term horizon)',
  );
  // Boundary: just inside the 7-day window surfaces; just outside does not.
  const inWindow = credSnap({ id: 'cred_in', label: 'In window', platform: 'wordpress',
    rotationDueIso: new Date(NOW + 6 * DAY).toISOString() });
  assert(deriveSnapshotSurfacingSignals(inWindow, NOW).some((s) => s.kind === 'expiring_credential'),
    '(cred) 6-day-out credential surfaces (inside the near-term horizon)');
  const outWindow = credSnap({ id: 'cred_out', label: 'Out of window', platform: 'wordpress',
    rotationDueIso: new Date(NOW + 8 * DAY).toISOString() });
  assert(!deriveSnapshotSurfacingSignals(outWindow, NOW).some((s) => s.kind === 'expiring_credential'),
    '(cred) 8-day-out credential does NOT surface (outside the near-term horizon)');

  // (i) overdue rotation with a still-future expiry must SURFACE (as age
  // pressure via sinceMs), not vanish as 'moot' — the reminder matters most
  // exactly when it is overdue.
  const overdueRot = credSnap({ id: 'cred_od', label: 'Stripe key', platform: 'stripe',
    expiresAtIso: new Date(NOW + 30 * DAY).toISOString(), rotationDueIso: new Date(NOW - 2 * DAY).toISOString() });
  const odSig = deriveSnapshotSurfacingSignals(overdueRot, NOW).find((s) => s.kind === 'expiring_credential');
  assert(Boolean(odSig), '(cred) overdue rotation (future expiry) still surfaces');
  assertEq(odSig?.sinceMs, NOW - 2 * DAY, '(cred) overdue rotation carried as sinceMs (age pressure)');
  assertEq(odSig?.expiresAtMs, NOW + 30 * DAY, '(cred) overdue rotation keeps the future expiry as expiresAtMs (not the past date → never moot)');
}

// ── (3) attention items → blocked_approval mapping ──────────────────────────
{
  const items: ChatAttentionItem[] = [
    {
      id: 'approval:abc', kind: 'approval_pending', title: 'Approval needed: publish post',
      detail: 'Publish "Summer sale" to WordPress', urgency: 'soon', waitingMs: 120_000,
      expiresAt: NOW + 300_000, primaryAction: { kind: 'review_approval', label: 'Review & decide' },
      secondaryActions: [], refId: 'abc',
    },
    {
      id: 'approval:def', kind: 'approval_expiring', title: 'Approval needed (expires in 2m): run shell',
      detail: 'npm run build', urgency: 'now', waitingMs: 600_000,
      expiresAt: NOW + 120_000, primaryAction: { kind: 'review_approval', label: 'Review & decide' },
      secondaryActions: [], refId: 'def',
    },
    {
      id: 'run:r9', kind: 'run_blocked', title: 'Run paused: nightly deploy',
      detail: 'office · nobody has unblocked it yet', urgency: 'soon', waitingMs: 3_600_000,
      expiresAt: null, primaryAction: { kind: 'open_run', label: 'View run' },
      secondaryActions: [], refId: 'r9',
    },
    {
      id: 'clarification:1', kind: 'clarification_waiting', title: 'Waiting on you: a detail',
      detail: 'parked', urgency: 'soon', waitingMs: 1000, expiresAt: null,
      primaryAction: { kind: 'answer_clarification', label: 'Answer' }, secondaryActions: [], refId: null,
    },
  ];
  const signals = attentionItemsToSurfacingSignals(items, NOW);
  assertEq(signals.length, 3, '(3) only approval_pending/approval_expiring/run_blocked map');
  assert(signals.every((s) => s.kind === 'blocked_approval'), '(3) all mapped as blocked_approval');
  const a = signals.find((s) => s.key === 'approval:abc');
  assert(Boolean(a), '(3) key = item.id');
  assertEq(a?.entityId, 'abc', '(3) entityId = item.refId');
  assertEq(a?.expiresAtMs, NOW + 300_000, '(3) expiresAtMs = item.expiresAt');
  assertEq(a?.sinceMs, NOW - 120_000, '(3) sinceMs = now − waitingMs');
  const r = signals.find((s) => s.key === 'run:r9');
  assertEq(r?.expiresAtMs, null, '(3) null expiresAt passes through as null');
  assertEq(attentionItemsToSurfacingSignals(null, NOW).length, 0, '(3) null items → []');
  const flood = Array.from({ length: 200 }, (_, i) => ({ ...items[0], id: `approval:${i}`, refId: String(i) }));
  assert(attentionItemsToSurfacingSignals(flood, NOW).length <= MAX_ATTENTION_ITEMS,
    '(3) hostile flood bounded to MAX_ATTENTION_ITEMS');
}

// ── (4) renderer: null on silent, fence + instruction when speaking ─────────
{
  assertEq(renderProactiveSurfacingBody(null), null, '(4) null decision → null');
  assertEq(renderProactiveSurfacingBody(undefined), null, '(4) undefined decision → null');
  const silent = selectProactiveSurfacings([], { turnIndex: 0, nowMs: NOW });
  assertEq(silent.note, null, '(4) empty signals decide silence');
  assertEq(renderProactiveSurfacingBody(silent), null, '(4) silent decision renders null');

  const decision = selectProactiveSurfacings(
    deriveSnapshotSurfacingSignals(makeSnapshot(), NOW),
    { turnIndex: 0, nowMs: NOW },
  );
  assert(decision.surface.length > 0 && decision.note, '(4) failed-run snapshot decides to speak');
  const body = renderProactiveSurfacingBody(decision);
  assert(typeof body === 'string' && body.length > 0, '(4) speaking decision renders a body');
  assert(body!.includes('<untrusted_quoted>') && body!.includes('</untrusted_quoted>'),
    '(4) member-authored note/lines ride inside the untrusted fence');
  assert(body!.includes(PROACTIVE_SURFACING_INSTRUCTION), '(4) instruction line present');
  const afterFence = body!.slice(body!.indexOf('</untrusted_quoted>'));
  assert(afterFence.includes(PROACTIVE_SURFACING_INSTRUCTION),
    '(4) instruction line sits OUTSIDE (after) the fence');
  const inFence = body!.slice(body!.indexOf('<untrusted_quoted>'), body!.indexOf('</untrusted_quoted>'));
  assert(inFence.includes(' — '), '(4) "title — reason" lines inside the fence');
  assert(decision.surface.every((s) => inFence.includes(s.title)), '(4) every surfaced title listed');
}

// ── (5) end-to-end: attention + snapshot merge through the core ─────────────
{
  const merged = [
    ...deriveSnapshotSurfacingSignals(makeSnapshot(), NOW),
    ...attentionItemsToSurfacingSignals([
      {
        id: 'approval:merge', kind: 'approval_pending', title: 'Approval needed: send email',
        detail: '', urgency: 'soon', waitingMs: 60_000, expiresAt: NOW + 900_000,
        primaryAction: { kind: 'review_approval', label: 'Review & decide' }, secondaryActions: [], refId: 'merge',
      },
    ], NOW),
  ];
  const decision = selectProactiveSurfacings(merged, { turnIndex: 0, nowMs: NOW });
  assert(decision.surface.length > 0, '(5) merged signals surface');
  const body = renderProactiveSurfacingBody(decision);
  assert(Boolean(body), '(5) merged decision renders');
  // Anti-nag continuity: replay the SAME inputs next turn with nextMemory —
  // the just-shown keys must be on cooldown (unprompted repeat suppressed).
  const next = selectProactiveSurfacings(merged, { turnIndex: 1, nowMs: NOW + 60_000 }, decision.nextMemory);
  for (const shown of decision.surface) {
    assert(!next.surface.some((s) => s.key === shown.key),
      `(5) shown key ${shown.key} suppressed next turn (cooldown)`);
  }
}

console.log(`\nproactive-surfacing-signals smoketest: ${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
