/**
 * Smoke test for src/lib/promptBuildMemoCore.ts
 *
 * Pure — loads under tsx (promptBuildMemoCore has zero runtime imports).
 *
 * Covers (OPTIMIZE #2 — build the system prompt once per turn):
 *   - computePromptMemoKey: fixed 5-string shape; deterministic; frozenInputsHash
 *     derived from the STABLE inputs only (agent identity id / model / grounding
 *     version / tool-catalog signature) and INVARIANT to the user message / chat
 *     history / live context (the whole point).
 *   - each frozen input actually influences the hash (model / grounding / tool
 *     catalog / identity change → hash changes); identity/turn/tier fields echo.
 *   - promptMemoKeyString: stable, compact, collision-resistant for distinct
 *     inputs, secret-free.
 *   - shouldReuseFrozenPrefix / decidePromptBuild: same frozen inputs → reuse;
 *     changed model / turn / tier / circle / user → rebuild with the right
 *     reason; no previous build → rebuild; changed user message but same frozen
 *     inputs → REUSE; boolean and reason never disagree.
 *   - SECRET-SAFETY: secrets routed through frozen fields are hashed (never
 *     echoed); unknown fields are ignored entirely.
 *   - boundedness (huge input clamped) + hostile no-throw across every export.
 *
 * Run: npx tsx scripts/prompt-build-memo-core-smoketest.ts
 */

import {
  computePromptMemoKey,
  promptMemoKeyString,
  shouldReuseFrozenPrefix,
  decidePromptBuild,
  type PromptMemoKey,
  type PromptMemoDecision,
} from '../src/lib/promptBuildMemoCore';

let passes = 0, failures = 0;
function assert(c: boolean, m: string, e?: string) {
  if (c) passes++;
  else { failures++; console.error('FAIL: ' + m + (e ? ' :: ' + e : '')); }
}
function assertEq(a: any, b: any, m: string) {
  assert(a === b, m, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));
}

// Helpers -------------------------------------------------------------------
function noThrow(label: string, fn: () => void): void {
  try { fn(); assert(true, label); }
  catch (e) { assert(false, label, String(e)); }
}
function isKeyShape(k: any): boolean {
  return !!k && typeof k === 'object'
    && typeof k.circleId === 'string'
    && typeof k.userId === 'string'
    && typeof k.turnId === 'string'
    && typeof k.tier === 'string'
    && typeof k.frozenInputsHash === 'string';
}

// A realistic frozen-input turn descriptor. Volatile fields (userMessage /
// chatHistory / liveContext) are included ON PURPOSE — the core must ignore them.
const BASE = {
  circleId: 'circle-abc',
  userId: 'user-123',
  turnId: 'turn-0001',
  tier: 'moderate',
  agentIdentityId: 'agent::default::blackswan',
  model: 'claude-haiku-4-5',
  groundingVersion: 'grounding-v5',
  toolCatalogSignature: 'tools:context.search,desktop.exec_file,gmail.send',
  // volatile — MUST NOT influence the key:
  userMessage: 'hey can you check the deploy',
  chatHistory: 'u: hi\na: hello\nu: ok',
  liveContext: '## Current Context\n- Talking to: Alice',
};

function main() {
  // 1) shape + basic determinism ------------------------------------------
  const k1: PromptMemoKey = computePromptMemoKey(BASE);
  assert(isKeyShape(k1), '1 computePromptMemoKey returns 5-string shape');
  assertEq(k1.circleId, 'circle-abc', '1 circleId echoed');
  assertEq(k1.userId, 'user-123', '1 userId echoed');
  assertEq(k1.turnId, 'turn-0001', '1 turnId echoed');
  assertEq(k1.tier, 'moderate', '1 tier echoed');
  assert(k1.frozenInputsHash.length > 0, '1 frozenInputsHash non-empty');
  assert(/^[0-9a-f]+$/.test(k1.frozenInputsHash), '1 frozenInputsHash is hex');
  const k1b = computePromptMemoKey(BASE);
  assertEq(k1b.frozenInputsHash, k1.frozenInputsHash, '1 deterministic hash (same input)');
  assertEq(promptMemoKeyString(k1), promptMemoKeyString(k1b), '1 deterministic key string');

  // 2) frozenInputsHash IGNORES volatile fields (the whole point) ----------
  // Same frozen inputs + same identity/turn/tier, but different message /
  // history / live context → identical key (message is not in the key).
  const kMsgA = computePromptMemoKey({ ...BASE, userMessage: 'hello there' });
  const kMsgB = computePromptMemoKey({
    ...BASE,
    userMessage: 'a completely different and much longer user message ' + 'x'.repeat(500),
    chatHistory: 'totally different history',
    liveContext: 'different live snapshot',
  });
  assertEq(kMsgA.frozenInputsHash, kMsgB.frozenInputsHash, '2 hash invariant to user message/history/context');
  assertEq(promptMemoKeyString(kMsgA), promptMemoKeyString(kMsgB), '2 key string invariant to volatile fields');
  // extra unknown fields never change the key either
  const kExtra = computePromptMemoKey({ ...BASE, somethingRandom: 42, nested: { a: 1 } });
  assertEq(promptMemoKeyString(kExtra), promptMemoKeyString(k1), '2 unknown fields ignored');

  // 3) each FROZEN input actually influences the hash ----------------------
  const hModel = computePromptMemoKey({ ...BASE, model: 'claude-opus-4-8' }).frozenInputsHash;
  assert(hModel !== k1.frozenInputsHash, '3 changed model → different hash');
  const hGround = computePromptMemoKey({ ...BASE, groundingVersion: 'grounding-v6' }).frozenInputsHash;
  assert(hGround !== k1.frozenInputsHash, '3 changed groundingVersion → different hash');
  const hTools = computePromptMemoKey({ ...BASE, toolCatalogSignature: 'tools:context.search' }).frozenInputsHash;
  assert(hTools !== k1.frozenInputsHash, '3 changed toolCatalogSignature → different hash');
  const hAgent = computePromptMemoKey({ ...BASE, agentIdentityId: 'agent::other' }).frozenInputsHash;
  assert(hAgent !== k1.frozenInputsHash, '3 changed agentIdentityId → different hash');
  // all four distinct from each other (each field is length-prefixed, no boundary bleed)
  const distinct = new Set([k1.frozenInputsHash, hModel, hGround, hTools, hAgent]);
  assertEq(distinct.size, 5, '3 four frozen-field changes give five distinct hashes');
  // boundary-shift guard: moving a char between adjacent frozen fields changes the hash
  const shiftA = computePromptMemoKey({ ...BASE, model: 'ab', groundingVersion: 'c' }).frozenInputsHash;
  const shiftB = computePromptMemoKey({ ...BASE, model: 'a', groundingVersion: 'bc' }).frozenInputsHash;
  assert(shiftA !== shiftB, '3 length-prefixing prevents field-boundary collision');

  // 4) key string: compact + collision-resistant for distinct inputs -------
  const s1 = promptMemoKeyString(k1);
  assert(typeof s1 === 'string' && s1.length > 0, '4 key string non-empty');
  assert(s1.length < 4000, '4 key string is compact');
  assert(s1.includes('circle-abc') && s1.includes('user-123') && s1.includes('turn-0001'),
    '4 key string echoes identity fields');
  assert(s1.includes(k1.frozenInputsHash), '4 key string carries the hash');
  const strings = new Set([
    promptMemoKeyString(computePromptMemoKey({ ...BASE })),
    promptMemoKeyString(computePromptMemoKey({ ...BASE, turnId: 'turn-0002' })),
    promptMemoKeyString(computePromptMemoKey({ ...BASE, tier: 'complex' })),
    promptMemoKeyString(computePromptMemoKey({ ...BASE, circleId: 'circle-xyz' })),
    promptMemoKeyString(computePromptMemoKey({ ...BASE, userId: 'user-999' })),
    promptMemoKeyString(computePromptMemoKey({ ...BASE, model: 'gpt-4o' })),
  ]);
  assertEq(strings.size, 6, '4 distinct inputs → distinct key strings (collision-resistant)');

  // 5) shouldReuseFrozenPrefix — same frozen inputs → reuse TRUE ------------
  // Two assemblies in the SAME turn (e.g. Tier 1 then Tier 1.5) with identical
  // frozen inputs but different volatile context → reuse the frozen prefix.
  const prev = computePromptMemoKey({ ...BASE, userMessage: 'first assembly' });
  const same = computePromptMemoKey({ ...BASE, userMessage: 'second assembly, same turn' });
  assertEq(shouldReuseFrozenPrefix(prev, same), true, '5 same frozen inputs (diff message) → reuse TRUE');
  assertEq(shouldReuseFrozenPrefix(prev, prev), true, '5 identical keys → reuse TRUE');

  // 6) changed frozen input → rebuild --------------------------------------
  const changedModel = computePromptMemoKey({ ...BASE, model: 'claude-opus-4-8' });
  assertEq(shouldReuseFrozenPrefix(prev, changedModel), false, '6 changed model → rebuild');
  const changedTools = computePromptMemoKey({ ...BASE, toolCatalogSignature: 'tools:none' });
  assertEq(shouldReuseFrozenPrefix(prev, changedTools), false, '6 changed tool catalog → rebuild');
  const changedGround = computePromptMemoKey({ ...BASE, groundingVersion: 'grounding-v6' });
  assertEq(shouldReuseFrozenPrefix(prev, changedGround), false, '6 changed grounding → rebuild');

  // 7) changed turn / tier / identity → rebuild ----------------------------
  const nextTurn = computePromptMemoKey({ ...BASE, turnId: 'turn-0002' });
  assertEq(shouldReuseFrozenPrefix(prev, nextTurn), false, '7 changed turnId → rebuild');
  const nextTier = computePromptMemoKey({ ...BASE, tier: 'complex' });
  assertEq(shouldReuseFrozenPrefix(prev, nextTier), false, '7 changed tier → rebuild');
  const nextCircle = computePromptMemoKey({ ...BASE, circleId: 'circle-xyz' });
  assertEq(shouldReuseFrozenPrefix(prev, nextCircle), false, '7 changed circleId → rebuild');
  const nextUser = computePromptMemoKey({ ...BASE, userId: 'user-999' });
  assertEq(shouldReuseFrozenPrefix(prev, nextUser), false, '7 changed userId → rebuild');

  // 8) no previous build / invalid keys → rebuild --------------------------
  assertEq(shouldReuseFrozenPrefix(null, same), false, '8 prev null → rebuild');
  assertEq(shouldReuseFrozenPrefix(undefined, same), false, '8 prev undefined → rebuild');
  assertEq(shouldReuseFrozenPrefix({}, same), false, '8 prev empty object → rebuild');
  assertEq(shouldReuseFrozenPrefix(prev, {}), false, '8 next empty object → rebuild');
  assertEq(shouldReuseFrozenPrefix(null, null), false, '8 both null → rebuild');
  // a key missing turnId can never be reused (can't prove same-turn)
  const noTurn = computePromptMemoKey({ ...BASE, turnId: '' });
  assertEq(shouldReuseFrozenPrefix(noTurn, noTurn), false, '8 empty turnId → rebuild even vs itself');

  // 9) decidePromptBuild — reasons -----------------------------------------
  const dSame: PromptMemoDecision = decidePromptBuild(prev, same);
  assertEq(dSame.reuse, true, '9 decide reuse true for same frozen inputs');
  assertEq(dSame.reason, 'frozen-inputs-match', '9 reason frozen-inputs-match');
  assertEq(decidePromptBuild(prev, changedModel).reason, 'frozen-inputs-changed', '9 reason frozen-inputs-changed');
  assertEq(decidePromptBuild(prev, nextTurn).reason, 'turn-changed', '9 reason turn-changed');
  assertEq(decidePromptBuild(prev, nextTier).reason, 'tier-changed', '9 reason tier-changed');
  assertEq(decidePromptBuild(prev, nextCircle).reason, 'identity-changed', '9 reason identity-changed (circle)');
  assertEq(decidePromptBuild(prev, nextUser).reason, 'identity-changed', '9 reason identity-changed (user)');
  assertEq(decidePromptBuild(null, same).reason, 'no-previous-build', '9 reason no-previous-build');
  assertEq(decidePromptBuild(prev, {}).reason, 'invalid-next-key', '9 reason invalid-next-key');
  assert(typeof dSame.reason === 'string' && dSame.reason.length > 0, '9 reason is a non-empty string');

  // check precedence: invalid next is reported before missing prev
  assertEq(decidePromptBuild(null, {}).reason, 'invalid-next-key', '9 invalid-next takes precedence over no-prev');
  // turn drift reported before tier/identity/hash drift
  const turnAndModel = computePromptMemoKey({ ...BASE, turnId: 'turn-9', model: 'x' });
  assertEq(decidePromptBuild(prev, turnAndModel).reason, 'turn-changed', '9 turn drift precedes frozen drift');

  // 10) boolean and reason never disagree ----------------------------------
  const cases: any[][] = [
    [prev, same], [prev, changedModel], [prev, nextTurn], [prev, nextTier],
    [prev, nextCircle], [prev, nextUser], [null, same], [prev, {}], [null, null],
    [prev, changedTools], [prev, changedGround],
  ];
  for (const [p, n] of cases) {
    const d = decidePromptBuild(p, n);
    assertEq(shouldReuseFrozenPrefix(p, n), d.reuse, '10 shouldReuse agrees with decide.reuse');
  }

  // 11) SECRET-SAFETY — frozen source values are hashed, never echoed ------
  const SECRET = 'sk-live-DEADBEEF-super-secret-key-value';
  const kSecretModel = computePromptMemoKey({ ...BASE, model: SECRET });
  assert(!promptMemoKeyString(kSecretModel).includes(SECRET), '11 secret in model not echoed in key string');
  assert(!kSecretModel.frozenInputsHash.includes(SECRET), '11 secret in model not in hash');
  assert(!JSON.stringify(kSecretModel).includes(SECRET), '11 secret in model absent from whole key');
  const kSecretGround = computePromptMemoKey({ ...BASE, groundingVersion: SECRET, toolCatalogSignature: SECRET });
  assert(!promptMemoKeyString(kSecretGround).includes(SECRET), '11 secret in grounding/tools not echoed');
  // secret parked in an unknown field is never read at all
  const kSecretUnknown = computePromptMemoKey({ ...BASE, apiKey: SECRET, authToken: SECRET });
  assert(!promptMemoKeyString(kSecretUnknown).includes(SECRET), '11 secret in unknown field ignored');
  assert(!JSON.stringify(kSecretUnknown).includes(SECRET), '11 secret in unknown field absent from key');
  // secret in a VOLATILE field (message/history) is likewise never in the key
  const kSecretMsg = computePromptMemoKey({ ...BASE, userMessage: SECRET, chatHistory: SECRET });
  assert(!promptMemoKeyString(kSecretMsg).includes(SECRET), '11 secret in volatile message not in key');
  assertEq(promptMemoKeyString(kSecretMsg), promptMemoKeyString(k1), '11 secret volatile field is a no-op');

  // 12) boundedness — huge inputs clamped ----------------------------------
  const hugeFrozen = computePromptMemoKey({ ...BASE, model: 'x'.repeat(5_000_000) });
  assert(isKeyShape(hugeFrozen), '12 huge frozen field → valid key shape');
  assert(hugeFrozen.frozenInputsHash.length <= 16, '12 huge frozen field → short hash (bounded)');
  const hugeKeyField = computePromptMemoKey({ ...BASE, circleId: 'y'.repeat(5_000_000) });
  assert(hugeKeyField.circleId.length <= 512, '12 huge key field clamped to bound');
  assert(promptMemoKeyString(hugeKeyField).length < 4000, '12 huge-input key string stays compact');

  // 13) hostile no-throw across every export -------------------------------
  const cyclic: any = {}; cyclic.self = cyclic;
  const evil: any = { toString() { throw new Error('boom'); }, valueOf() { throw new Error('boom'); } };
  const evilGetters: any = {};
  Object.defineProperty(evilGetters, 'model', { get() { throw new Error('boom'); }, enumerable: true });
  Object.defineProperty(evilGetters, 'turnId', { get() { throw new Error('boom'); }, enumerable: true });
  Object.defineProperty(evilGetters, 'circleId', { get() { throw new Error('boom'); }, enumerable: true });
  const hostiles: any[] = [
    null, undefined, 0, 1, NaN, Infinity, -Infinity, true, false, '', 'a string',
    {}, [], [1, 2, 3], cyclic, evil, evilGetters, Symbol('x'), () => 1, 123n,
  ];
  for (const h of hostiles) {
    const tag = String(typeof h);
    noThrow('13 computePromptMemoKey no-throw for ' + tag, () => {
      const k = computePromptMemoKey(h);
      assert(isKeyShape(k), '13 computePromptMemoKey returns valid shape for hostile ' + tag);
    });
    noThrow('13 promptMemoKeyString no-throw for ' + tag, () => {
      assert(typeof promptMemoKeyString(h) === 'string', '13 key string is a string for hostile ' + tag);
    });
    noThrow('13 shouldReuseFrozenPrefix no-throw for ' + tag, () => {
      assert(typeof shouldReuseFrozenPrefix(h, h) === 'boolean', '13 reuse is boolean for hostile ' + tag);
    });
    noThrow('13 decidePromptBuild no-throw for ' + tag, () => {
      const d = decidePromptBuild(h, h);
      assert(typeof d.reuse === 'boolean' && typeof d.reason === 'string', '13 decide shape for hostile ' + tag);
    });
  }
  // hostile inputs resolve to the safe neutral (rebuild), never a spurious reuse
  assertEq(shouldReuseFrozenPrefix(evil, evil), false, '13 evil-toString pair → rebuild (no throw)');
  assertEq(shouldReuseFrozenPrefix(evilGetters, evilGetters), false, '13 throwing-getters pair → rebuild');
  assertEq(shouldReuseFrozenPrefix(cyclic, cyclic), false, '13 cyclic pair → rebuild');
  assert(isKeyShape(computePromptMemoKey(evilGetters)), '13 throwing getters coerced to empty fields, valid key');
  assertEq(computePromptMemoKey(evilGetters).turnId, '', '13 throwing turnId getter → empty string');

  if (failures > 0) { console.error('\n' + failures + ' fail'); process.exit(1); }
  console.log('\nAll prompt-build-memo-core smoke cases passed (' + passes + ' passed).');
}
main();
