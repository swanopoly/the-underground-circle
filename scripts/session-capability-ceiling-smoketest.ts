/**
 * session-capability-ceiling-smoketest — pins the per-session / per-task
 * capability CEILING model (Lane B): default-deny, safe-reads-always-on, a
 * granted family passes while an ungranted one is blocked, expiry collapses
 * back to safe-reads-only, the tolerant parser drops garbage, applyCeiling
 * partitions correctly, and the ceiling can NEVER express floor categories.
 *
 * Run: npx tsx scripts/session-capability-ceiling-smoketest.ts
 */

import {
  ALL_CAPABILITY_FAMILIES,
  SAFE_READ_FAMILIES,
  SESSION_CEILING_DEFAULT_TTL_MINUTES,
  SESSION_CEILING_MAX_TTL_MINUTES,
  COARSE_FAMILY_FOR_CAPABILITY,
  applyCeiling,
  clearActiveSessionCeiling,
  coarseFamilyFor,
  createSessionCeiling,
  describeCapabilityOutsideCeiling,
  describeCeiling,
  getActiveSessionCeiling,
  isCapabilityAllowed,
  isCapabilityFamily,
  isCeilingActive,
  isCeilingExpired,
  normalizeCapabilityFamilies,
  parseSessionCeiling,
  serializeSessionCeiling,
  setActiveSessionCeiling,
  type CapabilityFamily,
  type SessionCapabilityCeiling,
} from '../src/lib/sessionCapabilityCeiling';

let failures = 0;
function fail(message: string) { failures += 1; console.error('FAIL:', message); }
function pass(message: string) { console.log('pass:', message); }
function assert(condition: unknown, name: string, detail?: string) {
  if (condition) pass(name);
  else fail(`${name}${detail ? ' - ' + detail : ''}`);
}

const NOW = '2026-06-29T12:00:00Z';
const NOW_MS = Date.parse(NOW);

function makeCeiling(
  allowedFamilies: CapabilityFamily[],
  patch: Partial<{ ttlMinutes: number; taskId: string | null; grantedByUserId: string | null }> = {},
): SessionCapabilityCeiling {
  const created = createSessionCeiling({ allowedFamilies, nowIso: NOW, ...patch });
  if (!created.ok) throw new Error(`test setup: ceiling creation failed: ${created.error}`);
  return created.ceiling;
}

function main() {
  // ── Vocabulary integrity ──────────────────────────────────────────────────
  // Every spec-required family is present, and safe reads are a subset.
  for (const required of [
    'browser_navigate', 'browser_read', 'browser_act', 'browser_download', 'browser_upload',
    'desktop_read', 'desktop_act', 'file_read', 'file_write', 'credential_use',
  ] as const) {
    assert(ALL_CAPABILITY_FAMILIES.includes(required), `vocabulary includes ${required}`);
    assert(isCapabilityFamily(required), `isCapabilityFamily accepts ${required}`);
  }
  assert(SAFE_READ_FAMILIES.every((f) => ALL_CAPABILITY_FAMILIES.includes(f)), 'safe reads are a subset of all families');
  assert(
    SAFE_READ_FAMILIES.slice().sort().join(',') === ['browser_read', 'desktop_read', 'file_read'].sort().join(','),
    'safe reads are exactly the three read families',
  );
  // Floor categories are NOT families (different axis).
  for (const floor of ['pay', 'delete', 'login', 'grant'] as const) {
    assert(!isCapabilityFamily(floor), `floor category ${floor} is not a capability family`);
  }
  assert(!isCapabilityFamily('nonsense'), 'unknown token is not a capability family');
  // Coarse mapping is total and matches the manifest tokens.
  for (const family of ALL_CAPABILITY_FAMILIES) {
    assert(
      COARSE_FAMILY_FOR_CAPABILITY[family] === coarseFamilyFor(family),
      `coarse lookup table matches function for ${family}`,
    );
  }
  assert(coarseFamilyFor('browser_act') === 'browser', 'browser_act rolls up to coarse browser');
  assert(coarseFamilyFor('file_write') === 'desktop', 'file_write rolls up to coarse desktop');
  assert(coarseFamilyFor('credential_use') === 'vault', 'credential_use rolls up to coarse vault');

  // ── Default-deny: null ceiling ⇒ only safe reads ──────────────────────────
  assert(isCapabilityAllowed(null, 'browser_read', NOW_MS), 'null ceiling: browser_read (safe) allowed');
  assert(isCapabilityAllowed(null, 'desktop_read', NOW_MS), 'null ceiling: desktop_read (safe) allowed');
  assert(isCapabilityAllowed(null, 'file_read', NOW_MS), 'null ceiling: file_read (safe) allowed');
  assert(!isCapabilityAllowed(null, 'browser_navigate', NOW_MS), 'null ceiling: browser_navigate DENIED');
  assert(!isCapabilityAllowed(null, 'browser_act', NOW_MS), 'null ceiling: browser_act DENIED');
  assert(!isCapabilityAllowed(null, 'browser_download', NOW_MS), 'null ceiling: browser_download DENIED');
  assert(!isCapabilityAllowed(null, 'desktop_act', NOW_MS), 'null ceiling: desktop_act DENIED');
  assert(!isCapabilityAllowed(null, 'file_write', NOW_MS), 'null ceiling: file_write DENIED');
  assert(!isCapabilityAllowed(null, 'credential_use', NOW_MS), 'null ceiling: credential_use DENIED');
  assert(!isCapabilityAllowed(null, 'bogus_family', NOW_MS), 'null ceiling: unknown family DENIED');
  assert(!isCeilingActive(null, NOW_MS), 'null ceiling is not active');

  // ── Creation validation ───────────────────────────────────────────────────
  assert(!createSessionCeiling({ allowedFamilies: [], nowIso: NOW }).ok, 'creation rejects empty allowlist');
  const onlyGarbage = createSessionCeiling({ allowedFamilies: ['pay', 'nope'] as unknown as CapabilityFamily[], nowIso: NOW });
  assert(!onlyGarbage.ok, 'creation rejects a list with no known families (floor + garbage)');
  const created = createSessionCeiling({
    allowedFamilies: ['browser_download', 'browser_download', 'file_read'] as CapabilityFamily[],
    grantedByUserId: 'user_1',
    taskId: 'task_42',
    nowIso: NOW,
  });
  assert(created.ok, 'valid creation succeeds');
  if (!created.ok) return;
  assert(created.ceiling.allowedFamilies.join(',') === 'browser_download,file_read', 'creation dedupes families, preserves order');
  assert(created.ceiling.taskId === 'task_42' && created.ceiling.grantedByUserId === 'user_1', 'creation carries task + actor');
  assert(
    Date.parse(created.ceiling.expiresAtIso) === NOW_MS + SESSION_CEILING_DEFAULT_TTL_MINUTES * 60 * 1000,
    'creation defaults to the short per-task TTL',
  );
  // TTL clamp: absurd TTL is clamped to the max, not honored.
  const clamped = makeCeiling(['desktop_act'], { ttlMinutes: 100_000 });
  assert(
    Date.parse(clamped.expiresAtIso) === NOW_MS + SESSION_CEILING_MAX_TTL_MINUTES * 60 * 1000,
    'creation clamps an over-long TTL to the max',
  );

  // ── A ceiling that allows browser_download lets it through, still blocks act ──
  const dlCeiling = makeCeiling(['browser_download'], { taskId: 'task_dl' });
  assert(isCeilingActive(dlCeiling, NOW_MS), 'download ceiling is active');
  assert(isCapabilityAllowed(dlCeiling, 'browser_download', NOW_MS), 'ceiling allows granted browser_download');
  assert(isCapabilityAllowed(dlCeiling, 'browser_read', NOW_MS), 'ceiling still allows safe browser_read');
  assert(!isCapabilityAllowed(dlCeiling, 'desktop_act', NOW_MS), 'ceiling that grants download still BLOCKS desktop_act');
  assert(!isCapabilityAllowed(dlCeiling, 'browser_act', NOW_MS), 'ceiling that grants download still BLOCKS browser_act');
  assert(!isCapabilityAllowed(dlCeiling, 'credential_use', NOW_MS), 'ceiling that grants download still BLOCKS credential_use');

  // ── Expiry ⇒ back to safe-reads-only ──────────────────────────────────────
  const afterExpiryMs = NOW_MS + (SESSION_CEILING_DEFAULT_TTL_MINUTES + 1) * 60 * 1000;
  assert(isCeilingExpired(dlCeiling, afterExpiryMs), 'ceiling is expired past its TTL');
  assert(!isCeilingActive(dlCeiling, afterExpiryMs), 'expired ceiling is not active');
  assert(!isCapabilityAllowed(dlCeiling, 'browser_download', afterExpiryMs), 'expired ceiling no longer allows browser_download');
  assert(isCapabilityAllowed(dlCeiling, 'file_read', afterExpiryMs), 'expired ceiling still allows safe reads');

  // ── applyCeiling partitions correctly ─────────────────────────────────────
  const actCeiling = makeCeiling(['browser_act', 'file_write']);
  const part = applyCeiling(
    actCeiling,
    ['browser_read', 'browser_act', 'file_write', 'desktop_act', 'browser_act', 'totally_bogus', ''],
    NOW_MS,
  );
  assert(part.allowed.join(',') === 'browser_read,browser_act,file_write', 'applyCeiling: allowed = safe read + granted act/write, deduped');
  assert(part.blocked.join(',') === 'desktop_act', 'applyCeiling: blocked = ungranted family only');
  assert(part.unknown.join(',') === 'totally_bogus', 'applyCeiling: unknown tokens partitioned separately, empties dropped');

  // applyCeiling under a null ceiling: only safe reads survive.
  const nullPart = applyCeiling(null, ['browser_read', 'browser_download', 'desktop_read', 'file_write'], NOW_MS);
  assert(nullPart.allowed.join(',') === 'browser_read,desktop_read', 'applyCeiling(null): only safe reads allowed');
  assert(nullPart.blocked.join(',') === 'browser_download,file_write', 'applyCeiling(null): non-reads blocked');

  // ── Structured block reason distinguishes missing vs. omitting ceiling ─────
  const missingReason = describeCapabilityOutsideCeiling(null, 'desktop_act', NOW_MS);
  assert(missingReason.code === 'capability_outside_ceiling', 'block reason carries the structured code');
  assert(missingReason.ceilingMissing === true && missingReason.coarseFamily === 'desktop', 'block reason: no active ceiling ⇒ ceilingMissing, coarse desktop');
  const omitReason = describeCapabilityOutsideCeiling(dlCeiling, 'desktop_act', NOW_MS);
  assert(omitReason.ceilingMissing === false, 'block reason: active ceiling omitting family ⇒ not missing');

  // ── Tolerant parser drops garbage ─────────────────────────────────────────
  assert(parseSessionCeiling(null) === null, 'parse: null ⇒ null');
  assert(parseSessionCeiling('garbage') === null, 'parse: non-object ⇒ null');
  assert(parseSessionCeiling({ fams: [], exp: NOW }) === null, 'parse: empty families ⇒ null');
  assert(parseSessionCeiling({ fams: ['pay', 'nonsense'], exp: NOW }) === null, 'parse: only floor/garbage families ⇒ null (fail closed)');
  assert(
    parseSessionCeiling({ fams: ['browser_act'], at: NOW }) === null,
    'parse: missing expiry ⇒ null (never forever)',
  );
  const roundTrip = parseSessionCeiling(serializeSessionCeiling(actCeiling));
  assert(Boolean(roundTrip), 'parse: serialized ceiling round-trips');
  assert(
    roundTrip?.allowedFamilies.join(',') === 'browser_act,file_write' && roundTrip?.expiresAtIso === actCeiling.expiresAtIso,
    'parse: round-trip preserves families + expiry',
  );
  // Parser strips unknown/floor families from an otherwise-valid record but keeps the good ones.
  const mixed = parseSessionCeiling({
    id: 'x',
    fams: ['browser_download', 'pay', 'garbage', 'file_read'],
    at: NOW,
    exp: new Date(NOW_MS + 30 * 60 * 1000).toISOString(),
  });
  assert(mixed?.allowedFamilies.join(',') === 'browser_download,file_read', 'parse: strips floor/unknown, keeps known families');
  // A parsed-but-already-expired ceiling is inert at the gate.
  const staleParsed = parseSessionCeiling({ fams: ['desktop_act'], at: NOW, exp: new Date(NOW_MS - 60_000).toISOString() });
  assert(Boolean(staleParsed), 'parse: past-expiry ceiling still parses (history/audit)');
  assert(!isCeilingActive(staleParsed, NOW_MS), 'parse: past-expiry ceiling is inactive');
  assert(!isCapabilityAllowed(staleParsed, 'desktop_act', NOW_MS), 'parse: past-expiry ceiling grants nothing beyond reads');

  // ── describeCeiling copy ──────────────────────────────────────────────────
  const noneDesc = describeCeiling(null, NOW_MS);
  assert(!noneDesc.active && noneDesc.effectiveFamilies.join(',') === SAFE_READ_FAMILIES.slice().sort().join(',') , 'describe(null): inactive, effective = safe reads', noneDesc.effectiveFamilies.join(','));
  assert(/only safe reads/i.test(noneDesc.summary), 'describe(null): summary states safe-reads-only');
  const dlDesc = describeCeiling(dlCeiling, NOW_MS);
  assert(dlDesc.active && dlDesc.effectiveFamilies.includes('browser_download') && dlDesc.effectiveFamilies.includes('file_read'), 'describe(active): effective = granted + safe reads');
  assert(/browser_download/.test(dlDesc.summary) && !/\bpay\b|\bdelete\b|\blogin\b|\bgrant\b/.test(dlDesc.summary), 'describe(active): summary lists granted family, never floor categories');

  // ── HARD INVARIANT: no floor category is ever a family or grantable ─────────
  for (const floor of ['pay', 'delete', 'login', 'grant']) {
    assert(!ALL_CAPABILITY_FAMILIES.includes(floor as CapabilityFamily), `invariant: floor ${floor} is not in the family vocabulary`);
    // Even if a caller crafts a "ceiling" naming a floor category, it cannot be created or gated on.
    const crafted = createSessionCeiling({ allowedFamilies: ['file_read', floor] as unknown as CapabilityFamily[], nowIso: NOW });
    assert(crafted.ok && !(crafted.ceiling.allowedFamilies as string[]).includes(floor), `invariant: creation drops floor ${floor} from the allowlist`);
    assert(!isCapabilityAllowed(makeCeiling(['browser_act']), floor as CapabilityFamily, NOW_MS), `invariant: gate never allows floor ${floor} as a family`);
  }

  // ── normalizeCapabilityFamilies ───────────────────────────────────────────
  assert(normalizeCapabilityFamilies(['BROWSER_ACT', ' file_read ', 'browser_act']).join(',') === 'browser_act,file_read', 'normalize lowercases, trims, dedupes');
  assert(normalizeCapabilityFamilies('not-an-array' as unknown as unknown[]).length === 0, 'normalize: non-array ⇒ []');
  assert(normalizeCapabilityFamilies(['pay', 42, null]).length === 0, 'normalize: drops floor + non-strings');

  // ── In-memory active registry (host default source) ───────────────────────
  clearActiveSessionCeiling();
  assert(getActiveSessionCeiling() === null, 'registry: starts empty (fail-closed default)');
  setActiveSessionCeiling(dlCeiling);
  // Note: getActiveSessionCeiling checks expiry against Date.now(); dlCeiling was
  // minted at NOW (2026-06-29) which is in the past relative to real now, so it is
  // already expired and the registry self-clears — that IS the fail-closed contract.
  assert(getActiveSessionCeiling() === null, 'registry: an already-expired ceiling self-clears (fail-closed)');
  // A far-future ceiling stays until cleared.
  const future = createSessionCeiling({ allowedFamilies: ['browser_act'], ttlMinutes: SESSION_CEILING_MAX_TTL_MINUTES });
  if (future.ok) {
    setActiveSessionCeiling(future.ceiling);
    assert(getActiveSessionCeiling()?.id === future.ceiling.id, 'registry: active future ceiling is retained');
    clearActiveSessionCeiling();
    assert(getActiveSessionCeiling() === null, 'registry: clear resets to fail-closed');
  }
  setActiveSessionCeiling(null);
  assert(getActiveSessionCeiling() === null, 'registry: setting null resets');

  if (failures > 0) {
    console.error(`\n${failures} session-capability-ceiling smoke-test failure(s)`);
    process.exit(1);
  }
  console.log('\nAll session-capability-ceiling smoke cases passed.');
}

main();
