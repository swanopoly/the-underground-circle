/**
 * chat-composer-draft-core-smoketest — the pure draft-preservation brain for the
 * SwanBot chat composer (src/lib/chatComposerDraftCore.ts).
 *
 * The load-bearing property is NEVER LOSE TYPED TEXT: switching threads must save
 * the outgoing draft and restore any saved draft for the thread you enter, while
 * a sent (emptied) box is never resurrected and same-thread re-renders never
 * disturb what the user is typing. Groups below pin: (1) key stability &
 * secret-freedom; (2) the shouldPreserveDraft gate incl. blank/oversized; (3) the
 * full reconcileDraft state machine (keep/restore/save/clear) across switches and
 * sends; (4) a realistic two-thread save→switch→restore round trip; (5) bounds;
 * (6) a degenerate group asserting every export is total (null/undefined/number/
 * object/huge/hostile/cyclic → no throw, safe neutral).
 *
 * Pure — loads under tsx (chatComposerDraftCore has zero imports).
 */

import {
  draftKey,
  shouldPreserveDraft,
  reconcileDraft,
  KEY_PREFIX,
  MAX_KEY_SEGMENT,
  MAX_DRAFT_LENGTH,
  type DraftAction,
  type DraftDecision,
} from '../src/lib/chatComposerDraftCore';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else {
    failures += 1;
    console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`);
  }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

const VALID_ACTIONS: DraftAction[] = ['save', 'restore', 'clear', 'keep'];

/** A decision is always well-shaped and bounded. */
function assertShape(d: DraftDecision, label: string): void {
  assert(!!d && typeof d === 'object', `${label} — is object`);
  assert(VALID_ACTIONS.indexOf(d.action) !== -1, `${label} — action in enum`, String(d.action));
  assertEq(typeof d.value, 'string', `${label} — value is string`);
  assert(d.value.length <= MAX_DRAFT_LENGTH, `${label} — value bounded`);
}

function reconcile(
  current: unknown,
  prevThreadId: unknown,
  incomingThreadId: unknown,
  stored: unknown,
  want: DraftAction,
  label: string,
): DraftDecision {
  const d = reconcileDraft({ current, incomingThreadId, prevThreadId, stored });
  assertShape(d, label);
  assertEq(d.action, want, `${label} — action`);
  return d;
}

// ── 1. draftKey — stable, deterministic, secret-free, bounded ────────────────
{
  const k = draftKey({ circleId: 'circle-1', threadId: 'thread-9', userId: 'user-7' });
  assertEq(k, 'uc_chat_draft::circle-1::thread-9::user-7', '1.1 canonical shape');
  assert(k.startsWith(KEY_PREFIX + '::'), '1.2 uses namespace prefix');

  // Deterministic: same inputs → identical key, every call.
  const a = draftKey({ circleId: 'c', threadId: 't', userId: 'u' });
  const b = draftKey({ circleId: 'c', threadId: 't', userId: 'u' });
  assertEq(a, b, '1.3 deterministic');

  // Different thread → different key (the whole point: per-thread drafts).
  const t1 = draftKey({ circleId: 'c', threadId: 't1', userId: 'u' });
  const t2 = draftKey({ circleId: 'c', threadId: 't2', userId: 'u' });
  assert(t1 !== t2, '1.4 distinct thread → distinct key');

  // Different circle / user also partition.
  assert(
    draftKey({ circleId: 'c1', threadId: 't', userId: 'u' }) !==
      draftKey({ circleId: 'c2', threadId: 't', userId: 'u' }),
    '1.5 distinct circle → distinct key',
  );
  assert(
    draftKey({ circleId: 'c', threadId: 't', userId: 'u1' }) !==
      draftKey({ circleId: 'c', threadId: 't', userId: 'u2' }),
    '1.6 distinct user → distinct key',
  );

  // Missing parts become the placeholder, never blank, still well-formed.
  assertEq(draftKey({}), 'uc_chat_draft::_::_::_', '1.7 all missing → placeholders');
  assertEq(
    draftKey({ circleId: 'c' }),
    'uc_chat_draft::c::_::_',
    '1.8 partial missing → placeholders',
  );
  // null thread (activeThreadId can be null) → placeholder segment.
  assertEq(
    draftKey({ circleId: 'c', threadId: null, userId: 'u' }),
    'uc_chat_draft::c::_::u',
    '1.9 null thread → placeholder',
  );

  // Secret-free: the DRAFT TEXT never influences the key (only ids do). Two very
  // different drafts under the same ids share a key; a "secret" in text can't leak.
  const keyA = draftKey({ circleId: 'c', threadId: 't', userId: 'u' });
  assert(!keyA.includes('sk-'), '1.10 key carries no draft/secret material');

  // A separator can't be injected: ':' in an id is sanitized away.
  const inj = draftKey({ circleId: 'a::b::c', threadId: 't', userId: 'u' });
  assertEq(inj.split('::').length, 4, '1.11 separators cannot be injected');

  // Hostile chars collapse to a safe charset.
  const hostile = draftKey({ circleId: 'a b/c\n\t*?', threadId: 't', userId: 'u' });
  assert(/^uc_chat_draft::[A-Za-z0-9_.-]+::t::u$/.test(hostile), '1.12 charset restricted', hostile);

  // Huge id is truncated per segment (bounded key).
  const bigId = 'x'.repeat(5000);
  const bigKey = draftKey({ circleId: bigId, threadId: 't', userId: 'u' });
  const circleSeg = bigKey.split('::')[1];
  assert(circleSeg.length <= MAX_KEY_SEGMENT, '1.13 segment truncated to bound', String(circleSeg.length));

  // Numeric / boolean ids stringify; whitespace-only id → placeholder.
  assertEq(
    draftKey({ circleId: 42, threadId: true, userId: '  ' }),
    'uc_chat_draft::42::true::_',
    '1.14 number/boolean stringify, blank → placeholder',
  );
}

// ── 2. shouldPreserveDraft — the "worth stashing?" gate ──────────────────────
{
  assertEq(shouldPreserveDraft('hello world'), true, '2.1 normal text preserved');
  assertEq(shouldPreserveDraft('a'), true, '2.2 one char preserved');
  assertEq(shouldPreserveDraft('   trimmed but real   '), true, '2.3 padded real text preserved');
  assertEq(shouldPreserveDraft('多字节 draft ✏️'), true, '2.4 unicode preserved');

  // Empty / whitespace-only → NOT preserved (this is the post-send state).
  assertEq(shouldPreserveDraft(''), false, '2.5 empty not preserved');
  assertEq(shouldPreserveDraft('   '), false, '2.6 spaces not preserved');
  assertEq(shouldPreserveDraft('\n\t\r  \n'), false, '2.7 whitespace not preserved');

  // Oversized → NOT preserved (junk armor; a real message never nears the cap).
  assertEq(shouldPreserveDraft('y'.repeat(MAX_DRAFT_LENGTH)), true, '2.8 exactly at cap preserved');
  assertEq(shouldPreserveDraft('y'.repeat(MAX_DRAFT_LENGTH + 1)), false, '2.9 over cap not preserved');

  // Non-strings → NOT preserved.
  for (const junk of [null, undefined, 0, 123, true, false, {}, [], () => 1, Symbol('x')]) {
    assertEq(shouldPreserveDraft(junk as unknown), false, `2.10 non-string not preserved :: ${String(junk)}`);
  }
}

// ── 3. reconcileDraft — the composer state machine ───────────────────────────
{
  // 3a. NOT a switch (same thread) → keep non-empty, clear empty.
  reconcile('half typed', 't1', 't1', '', 'keep', '3.1 same thread + text → keep');
  {
    const d = reconcile('half typed', 't1', 't1', '', 'keep', '3.1b keep echoes current');
    assertEq(d.value, 'half typed', '3.1c keep value echoes current');
  }
  // Post-send: same thread, box already emptied by setInput('') → clear.
  reconcile('', 't1', 't1', '', 'clear', '3.2 send (empty, same thread) → clear');
  reconcile('   ', 't1', 't1', '', 'clear', '3.3 whitespace same thread → clear');
  // null↔null (before any thread resolves) counts as same thread.
  reconcile('typing', null, null, '', 'keep', '3.4 null↔null + text → keep');

  // 3b. Real switch, incoming thread HAS a saved draft → restore it.
  {
    const d = reconcile('outgoing', 't1', 't2', 'saved for t2', 'restore', '3.5 switch → restore');
    assertEq(d.value, 'saved for t2', '3.6 restore value = incoming saved draft');
  }
  // Restore wins even when there is ALSO an outgoing draft (caller stashes that).
  reconcile('outgoing text', 't1', 't2', 'incoming saved', 'restore', '3.7 restore beats outgoing');

  // 3c. Real switch, NO incoming draft, outgoing worth keeping → save (box empties).
  {
    const d = reconcile('unsent work', 't1', 't2', '', 'save', '3.8 switch, outgoing kept → save');
    assertEq(d.value, '', '3.9 save empties the box');
  }
  reconcile('unsent work', 't1', 't2', '   ', 'save', '3.10 blank stored ignored → save');
  reconcile('unsent work', 't1', 't2', undefined, 'save', '3.11 missing stored → save');

  // 3d. Real switch, nothing on either side → clear.
  reconcile('', 't1', 't2', '', 'clear', '3.12 switch, nothing → clear');
  reconcile('   ', 't1', 't2', '', 'clear', '3.13 switch, blank outgoing → clear');

  // 3e. Switch FROM null (initial thread resolves) with empty box → clear (no spurious save).
  reconcile('', null, 't1', '', 'clear', '3.14 null→t1 empty → clear');
  // Switch from null with text typed pre-resolution → save it under the null bucket.
  reconcile('typed before ready', null, 't1', '', 'save', '3.15 null→t1 with text → save');

  // 3f. Oversized outgoing on a switch is NOT preservable → clear (dropped, junk armor).
  reconcile('z'.repeat(MAX_DRAFT_LENGTH + 5), 't1', 't2', '', 'clear', '3.16 oversized outgoing → clear');
  // Oversized STORED is not restored either.
  reconcile('x', 't1', 't2', 'z'.repeat(MAX_DRAFT_LENGTH + 5), 'save', '3.17 oversized stored not restored');
}

// ── 4. realistic two-thread round trip (the actual user story) ───────────────
{
  // A tiny in-memory store standing in for AsyncStorage, driven exactly like the
  // documented wiring, to prove text survives a switch and comes back.
  const store: Record<string, string> = {};
  const ids = (threadId: string) => ({ circleId: 'demo', threadId, userId: 'me' });

  // On thread A the user types a draft; the composer stashes it live.
  let box = '';
  const typeInThread = (threadId: string, text: string) => {
    box = text;
    const key = draftKey(ids(threadId));
    if (shouldPreserveDraft(text)) store[key] = text.slice(0, MAX_DRAFT_LENGTH);
    else delete store[key];
  };
  // The documented switch routine.
  const switchTo = (prevThreadId: string, incomingThreadId: string) => {
    const outKey = draftKey(ids(prevThreadId));
    if (shouldPreserveDraft(box)) store[outKey] = box.slice(0, MAX_DRAFT_LENGTH);
    else delete store[outKey];
    const inKey = draftKey(ids(incomingThreadId));
    const stored = store[inKey];
    const d = reconcileDraft({ current: box, incomingThreadId, prevThreadId, stored });
    if (d.action !== 'keep') box = d.value;
    if (d.action === 'restore') delete store[inKey];
    return d;
  };

  typeInThread('A', 'draft for alpha');
  assertEq(store[draftKey(ids('A'))], 'draft for alpha', '4.1 draft A stashed live');

  // Switch A → B: A saved, B empty.
  const s1 = switchTo('A', 'B');
  assertEq(s1.action, 'save', '4.2 A→B saves outgoing');
  assertEq(box, '', '4.3 box empty on fresh thread B');
  assertEq(store[draftKey(ids('A'))], 'draft for alpha', '4.4 A draft still stored');

  // Type in B, then switch B → A: B saved, A restored.
  typeInThread('B', 'draft for beta');
  const s2 = switchTo('B', 'A');
  assertEq(s2.action, 'restore', '4.5 B→A restores A draft');
  assertEq(box, 'draft for alpha', '4.6 A draft restored into box');
  assertEq(store[draftKey(ids('B'))], 'draft for beta', '4.7 B draft saved on the way out');
  assert(store[draftKey(ids('A'))] === undefined, '4.8 restored A draft consumed');

  // Send in A (box emptied), same thread → clear, and A key is cleared next type.
  box = '';
  typeInThread('A', '');
  const s3 = reconcileDraft({ current: box, incomingThreadId: 'A', prevThreadId: 'A', stored: store[draftKey(ids('A'))] });
  assertEq(s3.action, 'clear', '4.9 send in A → clear');
  assert(store[draftKey(ids('A'))] === undefined, '4.10 sent A draft not resurrected');

  // Round-trip back to B still has its saved draft.
  const s4 = switchTo('A', 'B');
  assertEq(s4.action, 'restore', '4.11 A→B restores B draft');
  assertEq(box, 'draft for beta', '4.12 B draft intact across trips');
}

// ── 5. bounds — every value/key stays within the documented caps ─────────────
{
  const bigStored = 'q'.repeat(MAX_DRAFT_LENGTH * 3);
  // Oversized stored isn't preservable, so this switch → clear (not a truncated restore).
  const d = reconcileDraft({ current: 'x', incomingThreadId: 't2', prevThreadId: 't1', stored: bigStored });
  assert(d.value.length <= MAX_DRAFT_LENGTH, '5.1 decision value bounded');

  // keep echoes a bounded slice even for an over-cap same-thread box.
  const bigCurrent = 'w'.repeat(MAX_DRAFT_LENGTH * 2);
  const k = reconcileDraft({ current: bigCurrent, incomingThreadId: 't1', prevThreadId: 't1', stored: '' });
  assertEq(k.action, 'keep', '5.2 over-cap same-thread box kept (not cleared)');
  assert(k.value.length <= MAX_DRAFT_LENGTH, '5.3 keep echo bounded');

  // Key stays bounded across all-huge ids.
  const big = 'Z'.repeat(9000);
  const key = draftKey({ circleId: big, threadId: big, userId: big });
  for (const seg of key.split('::').slice(1)) {
    assert(seg.length <= MAX_KEY_SEGMENT, '5.4 every key segment bounded', String(seg.length));
  }
}

// ── 6. degenerate / hostile — every export is TOTAL (no throw) ───────────────
{
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  const throwingId = {
    get circleId() {
      throw new Error('boom');
    },
  };
  const badInputs: unknown[] = [
    null,
    undefined,
    0,
    NaN,
    Infinity,
    -Infinity,
    123,
    true,
    false,
    'a string',
    {},
    [],
    [1, 2, 3],
    () => 42,
    Symbol('s'),
    cyclic,
    new Map(),
    { circleId: {}, threadId: [], userId: () => 1 },
    { current: {}, incomingThreadId: [], prevThreadId: Symbol('t'), stored: 5 },
    throwingId,
  ];

  for (let i = 0; i < badInputs.length; i += 1) {
    const bad = badInputs[i];
    // draftKey never throws and always returns a well-formed key string.
    let key = '';
    let threw = false;
    try {
      key = draftKey(bad as never);
    } catch {
      threw = true;
    }
    assert(!threw, `6.1 draftKey no-throw [${i}]`);
    assert(typeof key === 'string' && key.startsWith(KEY_PREFIX + '::'), `6.2 draftKey well-formed [${i}]`, key);

    // shouldPreserveDraft never throws and returns a boolean.
    let ok: unknown;
    threw = false;
    try {
      ok = shouldPreserveDraft(bad);
    } catch {
      threw = true;
    }
    assert(!threw, `6.3 shouldPreserveDraft no-throw [${i}]`);
    assertEq(typeof ok, 'boolean', `6.4 shouldPreserveDraft boolean [${i}]`);

    // reconcileDraft never throws and returns a well-shaped decision.
    let dec: DraftDecision | undefined;
    threw = false;
    try {
      dec = reconcileDraft(bad as never);
    } catch {
      threw = true;
    }
    assert(!threw, `6.5 reconcileDraft no-throw [${i}]`);
    assertShape(dec as DraftDecision, `6.6 reconcileDraft shape [${i}]`);
  }

  // A getter that throws inside a reconcile field must still resolve safely.
  const hostileReconcile = {
    get current() {
      throw new Error('nope');
    },
    incomingThreadId: 't2',
    prevThreadId: 't1',
    stored: '',
  };
  let threw = false;
  let dec: DraftDecision | undefined;
  try {
    dec = reconcileDraft(hostileReconcile as never);
  } catch {
    threw = true;
  }
  assert(!threw, '6.7 reconcileDraft survives throwing getter');
  assertShape(dec as DraftDecision, '6.8 reconcileDraft safe decision from throwing getter');
}

// ── Summary ──────────────────────────────────────────────────────────────────
if (failures > 0) {
  console.error(`\nchat-composer-draft-core-smoketest: ${passes} passed, ${failures} FAILED`);
  process.exit(1);
}
console.log(`chat-composer-draft-core-smoketest: all ${passes} assertions passed ✔`);
