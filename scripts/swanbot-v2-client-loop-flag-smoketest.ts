/**
 * swanbot-v2-client-loop-flag-smoketest — pins the live, default-off
 * loop-convergence canary flag `src/lib/swanbotV2ClientLoopFlag.ts`.
 * Load-bearing assertions:
 *
 *   PURE NORMALIZER (normalizeClientLoopFlagValue): DEFAULT OFF — true ONLY
 *   for the exact byte-for-byte 'true'. Every other value — 'false', '',
 *   whitespace, case variants ('True'/'TRUE'), padded 'true', numeric/verbal
 *   truthy strings, null, undefined, and hostile non-string inputs — reads as
 *   OFF. No trim, no lowercase (exact-match contract, mirroring swanbotRouting's
 *   exact `!== 'false'`). Total: never throws; deterministic.
 *
 *   KEY: SWANBOT_V2_CLIENT_LOOP_FLAG_KEY is exactly 'uc_swanbot_v2_client_loop'
 *   (the stored contract with every device — a rename silently resets everyone).
 *
 *   STATEFUL SURFACE (module is zero-import ⇒ tsx-loadable): against a mock
 *   globalThis.localStorage — default OFF when the key is absent; enable() sets
 *   exactly 'true' at exactly that key and reads back true; disable() sets
 *   'false' and reads back false; toggle() flips both directions; the read is
 *   exact-match (a stored ' true '/'TRUE' still reads OFF, i.e. only enable()'s
 *   own write turns it on).
 *
 *   FAIL-SOFT: with NO localStorage (undefined) and with a THROWING localStorage,
 *   isSwanbotV2ClientLoopEnabled() returns false and enable/disable/toggle never
 *   throw and still return their intended value (true/false).
 *
 * Pure — loads under tsx (swanbotV2ClientLoopFlag has zero imports).
 */

import {
  SWANBOT_V2_CLIENT_LOOP_FLAG_KEY,
  normalizeClientLoopFlagValue,
  isSwanbotV2ClientLoopEnabled,
  enableSwanbotV2ClientLoop,
  disableSwanbotV2ClientLoop,
  toggleSwanbotV2ClientLoop,
} from '../src/lib/swanbotV2ClientLoopFlag';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes++;
  else {
    failures++;
    console.error(`FAIL: ${msg}${extra ? ' :: ' + extra : ''}`);
  }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}
function noThrow(label: string, fn: () => unknown): void {
  try {
    fn();
    assert(true, `${label} does not throw`);
  } catch (e) {
    assert(false, `${label} does not throw`, String(e));
  }
}
/** Never-throwing label for hostile values (e.g. Object.create(null), whose
 *  String() conversion throws). */
function safeLabel(x: unknown): string {
  try {
    return String(x).slice(0, 16);
  } catch {
    return Object.prototype.toString.call(x);
  }
}

// ── Mock localStorage helpers (module reads the bare global `localStorage`). ──
function makeMockStorage(initial: Record<string, string> = {}): Storage {
  const store = new Map<string, string>(Object.entries(initial));
  const mock: Storage = {
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => {
      store.clear();
    },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
  return mock;
}
const THROWING_STORAGE: Storage = {
  getItem: () => {
    throw new Error('boom-get');
  },
  setItem: () => {
    throw new Error('boom-set');
  },
  removeItem: () => {
    throw new Error('boom-remove');
  },
  clear: () => {
    throw new Error('boom-clear');
  },
  key: () => {
    throw new Error('boom-key');
  },
  get length(): number {
    throw new Error('boom-length');
  },
} as Storage;

function setStorage(s: Storage | undefined): void {
  if (s === undefined) delete (globalThis as { localStorage?: Storage }).localStorage;
  else (globalThis as { localStorage?: Storage }).localStorage = s;
}
function readRaw(s: Storage): string | null {
  return s.getItem(SWANBOT_V2_CLIENT_LOOP_FLAG_KEY);
}

function main(): void {
  // ─── (0) The stored key is the exact documented contract. ────────────────
  assertEq(
    SWANBOT_V2_CLIENT_LOOP_FLAG_KEY,
    'uc_swanbot_v2_client_loop',
    'flag key is the exact runbook/task-specified key',
  );

  // ─── (1) Pure normalizer — the ONLY enabled value is byte-exact 'true'. ───
  assertEq(normalizeClientLoopFlagValue('true'), true, "'true' → ON");

  // Everything else reads OFF (default-OFF / opt-in). Exhaustive table.
  const OFF_INPUTS: Array<string | null | undefined> = [
    'false',
    '',
    ' ',
    '  ',
    '\t',
    '\n',
    'True',
    'TRUE',
    'tRuE',
    ' true',
    'true ',
    ' true ',
    '\ttrue',
    'true\n',
    '"true"',
    "'true'",
    'true1',
    '1true',
    'truthy',
    '1',
    '0',
    'yes',
    'no',
    'y',
    'n',
    'on',
    'off',
    't',
    'f',
    'enabled',
    'disabled',
    'null',
    'undefined',
    'NaN',
    'FALSE',
    null,
    undefined,
  ];
  for (const input of OFF_INPUTS) {
    assertEq(
      normalizeClientLoopFlagValue(input),
      false,
      `normalizer OFF for ${JSON.stringify(input)}`,
    );
  }

  // Exact-match, not membership: only the canonical literal counts.
  assert(
    normalizeClientLoopFlagValue('true') === true &&
      normalizeClientLoopFlagValue('TRUE') === false,
    'normalizer is case-sensitive (TRUE ≠ true)',
  );
  assert(
    normalizeClientLoopFlagValue(' true ') === false,
    'normalizer does not trim',
  );

  // Deterministic across repeated calls.
  assertEq(
    normalizeClientLoopFlagValue('true'),
    normalizeClientLoopFlagValue('true'),
    'normalizer deterministic (true)',
  );
  assertEq(
    normalizeClientLoopFlagValue('false'),
    normalizeClientLoopFlagValue('false'),
    'normalizer deterministic (false)',
  );

  // Total — hostile non-string inputs never throw and read OFF.
  const HOSTILE: unknown[] = [
    0,
    1,
    NaN,
    {},
    [],
    { toString: () => 'true' },
    ['true'],
    true,
    false,
    Symbol('true'),
    () => 'true',
    Object.create(null),
  ];
  for (const h of HOSTILE) {
    noThrow(`normalizer(${safeLabel(h)})`, () =>
      normalizeClientLoopFlagValue(h as string),
    );
    assertEq(
      normalizeClientLoopFlagValue(h as string),
      false,
      `hostile input reads OFF: ${safeLabel(h)}`,
    );
  }
  // The boxed String('true') is NOT the primitive 'true' → still OFF (strict ===).
  assertEq(
    // eslint-disable-next-line no-new-wrappers
    normalizeClientLoopFlagValue(new String('true') as unknown as string),
    false,
    'boxed String("true") is not primitive "true" → OFF',
  );

  // ─── (2) Stateful surface against a mock localStorage. ───────────────────
  const mock = makeMockStorage();
  setStorage(mock);

  // Default OFF: absent key reads false.
  assertEq(isSwanbotV2ClientLoopEnabled(), false, 'default OFF when key absent');
  assertEq(readRaw(mock), null, 'no key written by a mere read');

  // enable() writes exactly 'true' at exactly the flag key and returns true.
  assertEq(enableSwanbotV2ClientLoop(), true, 'enable() returns true');
  assertEq(readRaw(mock), 'true', "enable() stores exactly 'true' at the flag key");
  assertEq(isSwanbotV2ClientLoopEnabled(), true, 'reads ON after enable()');

  // disable() writes 'false' and returns false.
  assertEq(disableSwanbotV2ClientLoop(), false, 'disable() returns false');
  assertEq(readRaw(mock), 'false', "disable() stores exactly 'false'");
  assertEq(isSwanbotV2ClientLoopEnabled(), false, 'reads OFF after disable()');

  // toggle() flips both directions and returns the NEW value.
  assertEq(toggleSwanbotV2ClientLoop(), true, 'toggle OFF→ON returns true');
  assertEq(isSwanbotV2ClientLoopEnabled(), true, 'ON after toggle');
  assertEq(readRaw(mock), 'true', "toggle ON stored 'true'");
  assertEq(toggleSwanbotV2ClientLoop(), false, 'toggle ON→OFF returns false');
  assertEq(isSwanbotV2ClientLoopEnabled(), false, 'OFF after toggle back');
  assertEq(readRaw(mock), 'false', "toggle OFF stored 'false'");

  // Read is exact-match end-to-end: a hand-set ' true '/'TRUE' still reads OFF —
  // only enable()'s own canonical write turns it on.
  for (const nonCanonical of [' true ', 'TRUE', 'True', '1', 'yes', 'on', '']) {
    mock.setItem(SWANBOT_V2_CLIENT_LOOP_FLAG_KEY, nonCanonical);
    assertEq(
      isSwanbotV2ClientLoopEnabled(),
      false,
      `hand-set ${JSON.stringify(nonCanonical)} reads OFF (exact-match)`,
    );
  }
  mock.setItem(SWANBOT_V2_CLIENT_LOOP_FLAG_KEY, 'true');
  assertEq(isSwanbotV2ClientLoopEnabled(), true, "hand-set exact 'true' reads ON");

  // enable() does not disturb unrelated keys.
  mock.setItem('unrelated_key', 'keep-me');
  enableSwanbotV2ClientLoop();
  assertEq(mock.getItem('unrelated_key'), 'keep-me', 'enable() leaves other keys intact');

  // ─── (3) Fail-soft: NO localStorage at all. ──────────────────────────────
  setStorage(undefined);
  assertEq(
    isSwanbotV2ClientLoopEnabled(),
    false,
    'fail-soft OFF when localStorage undefined',
  );
  assertEq(enableSwanbotV2ClientLoop(), true, 'enable() returns true w/o localStorage');
  assertEq(disableSwanbotV2ClientLoop(), false, 'disable() returns false w/o localStorage');
  noThrow('toggle() w/o localStorage', () => toggleSwanbotV2ClientLoop());
  assertEq(
    isSwanbotV2ClientLoopEnabled(),
    false,
    'still OFF w/o localStorage after mutators',
  );

  // ─── (4) Fail-soft: THROWING localStorage. ───────────────────────────────
  setStorage(THROWING_STORAGE);
  assertEq(
    isSwanbotV2ClientLoopEnabled(),
    false,
    'fail-soft OFF when getItem throws',
  );
  noThrow('enable() swallows setItem throw', () => enableSwanbotV2ClientLoop());
  noThrow('disable() swallows setItem throw', () => disableSwanbotV2ClientLoop());
  noThrow('toggle() swallows throws', () => toggleSwanbotV2ClientLoop());
  assertEq(enableSwanbotV2ClientLoop(), true, 'enable() still returns true when storage throws');
  assertEq(disableSwanbotV2ClientLoop(), false, 'disable() still returns false when storage throws');
  assertEq(
    isSwanbotV2ClientLoopEnabled(),
    false,
    'still fail-soft OFF after throwing-storage mutators',
  );

  // Clean up the global we installed.
  setStorage(undefined);

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll swanbotV2ClientLoopFlag smoke cases passed (${passes} passed).`);
}

main();
