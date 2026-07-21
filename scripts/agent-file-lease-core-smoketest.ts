/**
 * agent-file-lease-core-smoketest — the PURE multi-agent coordination brain
 * (src/lib/agentFileLeaseCore.ts). Load-bearing: lease state machine
 * (grant/renew/held_by_other/reclaim-stale; release outcomes released/
 * released_expired/not_holder/gone with holder+reason on refusal), content-hash
 * CAS (clean/conflict/unknown), deterministic change-detecting hash, TTL expiry
 * + prune, path-free awareness, corrupt-registry defense, never-throws.
 *
 * Pure — loads under tsx (agentFileLeaseCore has zero imports).
 */

import {
  hashContent,
  normalizeLeasePath,
  normalizeRegistry,
  acquireLease,
  renewLease,
  releaseLease,
  checkWriteConflict,
  pruneExpired,
  listActiveLeases,
  isPathFree,
  describeLeases,
  LEASE_DEFAULT_TTL_MS,
  LEASE_MIN_TTL_MS,
  LEASE_MAX_TTL_MS,
} from '../src/lib/agentFileLeaseCore';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

const T0 = 1_000_000; // fixed "now" base (ms)

function main(): void {
  // ─── (1) hashContent — deterministic, change-detecting, length-tagged ─────
  assertEq(hashContent('hello'), hashContent('hello'), '(1) hash is deterministic');
  assert(hashContent('hello') !== hashContent('hellp'), '(1) 1-char change → different hash');
  assert(hashContent('hello') !== hashContent('hello '), '(1) trailing-space change detected');
  assert(hashContent('').endsWith('-0'), '(1) empty content tagged length 0');
  assert(hashContent('abc').endsWith('-3'), '(1) hash carries length');
  assert(hashContent(null) === hashContent(''), '(1) null coerces to empty (never throws)');

  // ─── (2) acquire: grant → renew → held_by_other → reclaim_stale ───────────
  const a1 = acquireLease({ version: 1, leases: {} }, { path: 'src/x.ts', ownerId: 'A', ownerLabel: 'claude', contentHash: hashContent('v1'), intent: 'edit x', ttlMs: LEASE_DEFAULT_TTL_MS }, T0);
  assert(a1.ok && a1.outcome === 'granted', '(2) new lease granted');
  assert(a1.lease?.ownerId === 'A' && a1.lease?.expiresAt === T0 + LEASE_DEFAULT_TTL_MS, '(2) lease fields set');

  // same owner heartbeats via acquire → renewed (keeps acquiredAt)
  const a2 = acquireLease(a1.registry, { path: 'src/x.ts', ownerId: 'A', ttlMs: LEASE_DEFAULT_TTL_MS }, T0 + 10_000);
  assert(a2.ok && a2.outcome === 'renewed', '(2) same owner → renewed');
  assertEq(a2.lease?.acquiredAt, T0, '(2) renew preserves original acquiredAt');
  assertEq(a2.lease?.expiresAt, T0 + 10_000 + LEASE_DEFAULT_TTL_MS, '(2) renew extends expiry');

  // different owner while active → held_by_other (denied)
  const a3 = acquireLease(a2.registry, { path: 'src/x.ts', ownerId: 'B', ownerLabel: 'cursor' }, T0 + 11_000);
  assert(!a3.ok && a3.outcome === 'held_by_other', '(3) active lease blocks a different owner');
  assert(a3.holder?.ownerId === 'A', '(3) denial names the holder');
  // the registry is UNCHANGED on denial (A still holds it)
  assertEq(a3.registry.leases['src/x.ts'].ownerId, 'A', '(3) denied acquire does not mutate the lease');

  // after A's lease expires → B reclaims the stale lease
  const expiredAt = a2.lease!.expiresAt + 1;
  const a4 = acquireLease(a2.registry, { path: 'src/x.ts', ownerId: 'B', ownerLabel: 'cursor' }, expiredAt);
  assert(a4.ok && a4.outcome === 'reclaimed_stale', '(4) expired lease reclaimed by a new owner');
  assertEq(a4.lease?.ownerId, 'B', '(4) reclaimer owns it now');

  // ─── (5) renew: owner ok / non-owner rejected / gone ──────────────────────
  assert(renewLease(a1.registry, { path: 'src/x.ts', ownerId: 'A' }, T0 + 5_000).outcome === 'renewed', '(5) owner renews');
  assert(renewLease(a1.registry, { path: 'src/x.ts', ownerId: 'B' }, T0 + 5_000).outcome === 'not_holder', '(5) non-owner cannot renew');
  assert(renewLease({ version: 1, leases: {} }, { path: 'nope.ts', ownerId: 'A' }, T0).outcome === 'gone', '(5) renew of missing lease → gone');

  // ─── (6) release: owner / non-owner-active / stale-by-anyone / gone ───────
  const relOwn = releaseLease(a1.registry, { path: 'src/x.ts', ownerId: 'A' }, T0 + 1000);
  assert(relOwn.ok && relOwn.outcome === 'released', '(6) owner releases');
  const relByOther = releaseLease(a1.registry, { path: 'src/x.ts', ownerId: 'B' }, T0 + 1000);
  assert(!relByOther.ok && relByOther.outcome === 'not_holder', '(6) non-owner cannot release an ACTIVE lease');
  assert(relByOther.holder?.ownerId === 'A', '(6) release refusal carries the REAL holder');
  assert(/held by claude for \d+s more/.test(relByOther.reason), '(6) refusal reason names holder + remaining time', relByOther.reason);
  assert('src/x.ts' in relByOther.registry.leases, '(6) refused release does not mutate the registry');
  const relStale = releaseLease(a1.registry, { path: 'src/x.ts', ownerId: 'B' }, expiredAt);
  assert(relStale.ok && relStale.outcome === 'released_expired', '(6) anyone may release a STALE lease → released_expired');
  assert(!('src/x.ts' in relStale.registry.leases), '(6) stale release removes the lease from the registry');
  const relOwnExpired = releaseLease(a1.registry, { path: 'src/x.ts', ownerId: 'A' }, expiredAt);
  assert(relOwnExpired.ok && relOwnExpired.outcome === 'released', "(6) owner releasing own EXPIRED lease is still plain 'released'");
  assert(!('src/x.ts' in releaseLease(a1.registry, { path: 'src/x.ts', ownerId: 'A' }, T0 + 1000).registry.leases), '(6) released lease removed from registry');
  const relGone = releaseLease({ version: 1, leases: {} }, { path: 'x', ownerId: 'A' }, T0);
  assert(relGone.ok && relGone.outcome === 'gone', '(6) release of missing → gone (idempotent)');
  assert([relOwn, relByOther, relStale, relGone].every((r) => typeof r.reason === 'string' && r.reason.length > 0), '(6) every release result carries a reason');

  // ─── (7) CONTENT-HASH CAS — the universal guarantee ───────────────────────
  const h = hashContent('same content');
  assertEq(checkWriteConflict({ baselineHash: h, currentHash: h }).verdict, 'clean', '(7) unchanged file → clean');
  assertEq(checkWriteConflict({ baselineHash: h, currentHash: hashContent('CHANGED') }).verdict, 'conflict', '(7) changed file → conflict (refuse write)');
  assertEq(checkWriteConflict({ baselineHash: '', currentHash: h }).verdict, 'unknown', '(7) no baseline → unknown (caller decides)');
  assertEq(checkWriteConflict({ baselineHash: h, currentHash: null }).verdict, 'unknown', '(7) no current hash → unknown');

  // ─── (8) expiry: prune + listActive + isPathFree ──────────────────────────
  const reg = acquireLease(
    acquireLease({ version: 1, leases: {} }, { path: 'a.ts', ownerId: 'A', ttlMs: 10_000 }, T0).registry,
    { path: 'b.ts', ownerId: 'B', ttlMs: 60_000 }, T0,
  ).registry;
  const midway = T0 + 20_000; // a.ts expired (10s), b.ts alive (60s)
  const active = listActiveLeases(reg, midway);
  assertEq(active.length, 1, '(8) only the unexpired lease is active');
  assertEq(active[0].path, 'b.ts', '(8) active lease is b.ts');
  assert(!('a.ts' in pruneExpired(reg, midway).leases) && 'b.ts' in pruneExpired(reg, midway).leases, '(8) prune drops expired, keeps active');
  assert(isPathFree(reg, 'a.ts', 'C', midway), '(8) expired path is free for anyone');
  assert(!isPathFree(reg, 'b.ts', 'C', midway), '(8) active path is NOT free for a non-owner');
  assert(isPathFree(reg, 'b.ts', 'B', midway), '(8) active path IS free for its owner');
  assert(isPathFree(reg, 'never-seen.ts', 'C', midway), '(8) unseen path is free');

  // ─── (9) path normalization + corrupt-registry defense ────────────────────
  assertEq(normalizeLeasePath('  src//lib/x.ts/  '), 'src/lib/x.ts', '(9) trim + collapse slashes + drop trailing');
  assertEq(normalizeLeasePath('a\\b\\c'), 'a/b/c', '(9) backslashes normalized');
  assertEq(Object.keys(normalizeRegistry(null).leases).length, 0, '(9) null → empty registry');
  assertEq(Object.keys(normalizeRegistry({ leases: 'garbage' }).leases).length, 0, '(9) garbage leases → empty');
  assertEq(Object.keys(normalizeRegistry({ leases: { 'x.ts': { ownerId: 'A' } } }).leases).length, 0, '(9) lease missing required fields is dropped');
  // a corrupt registry can never grant a bogus lease — acquire still works cleanly
  assert(acquireLease('not even an object' as any, { path: 'x.ts', ownerId: 'A' }, T0).ok, '(9) acquire on corrupt registry still grants safely');

  // ─── (10) ttl clamp + describe + degenerate never-throws ──────────────────
  assertEq(acquireLease({ version: 1, leases: {} }, { path: 'x', ownerId: 'A', ttlMs: 999_999_999 }, T0).lease?.expiresAt, T0 + LEASE_MAX_TTL_MS, '(10) ttl clamps to max');
  assertEq(acquireLease({ version: 1, leases: {} }, { path: 'x', ownerId: 'A', ttlMs: 1 }, T0).lease?.expiresAt, T0 + LEASE_MIN_TTL_MS, '(10) ttl floors to min');
  assert(describeLeases(reg, T0).includes('a.ts') && describeLeases(reg, T0).includes('b.ts'), '(10) describe lists active territory');
  assert(describeLeases({ version: 1, leases: {} }, T0).toLowerCase().includes('no files'), '(10) describe empty registry');
  // missing path/owner is refused, not thrown
  assertEq(acquireLease({ version: 1, leases: {} }, { path: '', ownerId: 'A' }, T0).ok, false, '(10) empty path refused');
  try {
    acquireLease(undefined as any, undefined as any, T0);
    renewLease(null as any, { path: 'x', ownerId: 'A' }, T0);
    releaseLease(null as any, { path: 'x', ownerId: 'A' }, T0);
    checkWriteConflict({});
    listActiveLeases(undefined, T0);
    describeLeases(null, T0);
    hashContent(undefined);
    passes += 1;
  } catch (e) {
    failures += 1;
    console.error(`FAIL: (10) degenerate inputs threw: ${(e as Error)?.message}`);
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll agent-file-lease-core smoke cases passed (${passes} passed).`);
}

main();
