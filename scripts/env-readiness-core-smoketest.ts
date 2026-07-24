/**
 * env-readiness-core-smoketest — the pure `uc.environment.json` parse/validate
 * brain (src/lib/envReadinessCore.ts), the Cursor-parity background-agent
 * environment manifest reader. Load-bearing assertions: valid JSON → typed
 * command fields; invalid / non-object / wrong-typed JSON → clean {} (never
 * throws); command collection ignores empty-string fields; missing = required
 * fields absent (default install+test) with a require override; secret-shaped
 * env keys are flagged by NAME only; and — the critical secret-safety invariant
 * — a real secret VALUE never appears ANYWHERE in the emitted result
 * (asserted by checking the value string is absent from JSON.stringify(result)).
 *
 * Pure — loads under tsx (envReadinessCore has zero runtime imports).
 */

import {
  parseUcEnvironment,
  evaluateEnvReadiness,
  KNOWN_COMMAND_FIELDS,
  type UcEnvironment,
} from '../src/lib/envReadinessCore';

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

function main(): void {
  // ─── (1) parse valid JSON → typed command fields ──────────────────────────
  const full = parseUcEnvironment(
    JSON.stringify({
      install: 'npm ci',
      start: 'npm run web',
      test: 'npm test',
      watch: 'npm run watch',
      lint: 'npm run lint',
      typecheck: 'npm run typecheck',
      env: { NODE_ENV: 'test' },
    }),
  );
  assertEq(full.install, 'npm ci', '(1) install parsed');
  assertEq(full.start, 'npm run web', '(1) start parsed');
  assertEq(full.test, 'npm test', '(1) test parsed');
  assertEq(full.watch, 'npm run watch', '(1) watch parsed');
  assertEq(full.lint, 'npm run lint', '(1) lint parsed');
  assertEq(full.typecheck, 'npm run typecheck', '(1) typecheck parsed');
  assertEq(full.env?.NODE_ENV, 'test', '(1) env value parsed');
  assert(Array.isArray(KNOWN_COMMAND_FIELDS) && KNOWN_COMMAND_FIELDS.length === 6, '(1) KNOWN_COMMAND_FIELDS has 6 entries');

  // ─── (2) invalid / non-object / wrong-type JSON → clean {} ────────────────
  for (const bad of ['not json', '[]', '42', '"hello"', 'null', 'true', '', '{', '{"a":}', undefined, null, 42, {}, []]) {
    const r = parseUcEnvironment(bad as unknown as string);
    assertEq(JSON.stringify(r), '{}', `(2) bad input → {} :: ${JSON.stringify(bad)}`);
  }

  // ─── (3) wrong-typed known fields are dropped, good ones survive ──────────
  const mixed = parseUcEnvironment(
    JSON.stringify({ install: 'yarn', start: 123, test: ['a'], watch: {}, lint: null, typecheck: 'tsc' }),
  );
  assertEq(mixed.install, 'yarn', '(3) string field kept');
  assertEq(mixed.typecheck, 'tsc', '(3) string field kept (typecheck)');
  assertEq(mixed.start, undefined, '(3) numeric field dropped');
  assertEq(mixed.test, undefined, '(3) array field dropped');
  assertEq(mixed.watch, undefined, '(3) object field dropped');
  assertEq(mixed.lint, undefined, '(3) null field dropped');

  // ─── (4) empty-string command fields are ignored on parse ─────────────────
  const empties = parseUcEnvironment(JSON.stringify({ install: '', test: '   ', start: 'go run .' }));
  assertEq(empties.install, undefined, '(4) empty install dropped on parse');
  assertEq(empties.test, undefined, '(4) whitespace test dropped on parse');
  assertEq(empties.start, 'go run .', '(4) real start kept');

  // ─── (5) evaluate: command collection ignores empty-string fields ─────────
  const evalEmpty = evaluateEnvReadiness({ install: 'npm ci', start: '', test: '  ', lint: 'eslint .' } as UcEnvironment);
  assert('install' in evalEmpty.commands, '(5) non-empty install collected');
  assert('lint' in evalEmpty.commands, '(5) non-empty lint collected');
  assert(!('start' in evalEmpty.commands), '(5) empty start NOT collected');
  assert(!('test' in evalEmpty.commands), '(5) whitespace test NOT collected');
  assertEq(evalEmpty.commands.install, 'npm ci', '(5) collected value trimmed/exact');

  // ─── (6) valid readiness when required present (default install+test) ─────
  const ready = evaluateEnvReadiness({ install: 'npm ci', test: 'npm test' });
  assertEq(ready.valid, true, '(6) install+test → valid');
  assertEq(JSON.stringify(ready.missing), '[]', '(6) nothing missing');

  // ─── (7) missing required (default install+test) ──────────────────────────
  const noTest = evaluateEnvReadiness({ install: 'npm ci' });
  assertEq(noTest.valid, false, '(7) missing test → invalid');
  assert(noTest.missing.includes('test'), '(7) test in missing');
  assert(!noTest.missing.includes('install'), '(7) install NOT in missing');

  const noInstall = evaluateEnvReadiness({ test: 'npm test' });
  assertEq(noInstall.valid, false, '(7) missing install → invalid');
  assert(noInstall.missing.includes('install'), '(7) install in missing');

  const noneReq = evaluateEnvReadiness({ start: 'run' });
  assertEq(noneReq.valid, false, '(7) neither install nor test → invalid');
  assert(noneReq.missing.includes('install') && noneReq.missing.includes('test'), '(7) both required missing');

  // ─── (8) require override ─────────────────────────────────────────────────
  const reqTypecheck = evaluateEnvReadiness({ install: 'npm ci', test: 'npm test' }, { require: ['typecheck'] });
  assertEq(reqTypecheck.valid, false, '(8) override requires typecheck → invalid (absent)');
  assert(reqTypecheck.missing.includes('typecheck'), '(8) typecheck required-missing');
  assert(!reqTypecheck.missing.includes('install'), '(8) install not required under override');

  const reqStartPresent = evaluateEnvReadiness({ start: 'npm run web' }, { require: ['start'] });
  assertEq(reqStartPresent.valid, true, '(8) override requires start, present → valid');

  const reqEmptyFallsBack = evaluateEnvReadiness({ install: 'x', test: 'y' }, { require: [] });
  assertEq(reqEmptyFallsBack.valid, true, '(8) empty require[] falls back to default (both present)');

  const reqDedup = evaluateEnvReadiness({ install: 'x' }, { require: ['test', 'test', 'test'] });
  assertEq(JSON.stringify(reqDedup.missing), JSON.stringify(['test']), '(8) duplicate required de-duped in missing');

  // ─── (9) warnings for absent test / install ───────────────────────────────
  const warnBoth = evaluateEnvReadiness({ start: 'run' });
  assert(warnBoth.warnings.some((w) => /no install command/i.test(w)), '(9) warns on absent install');
  assert(warnBoth.warnings.some((w) => /no test command/i.test(w) && /cannot verify/i.test(w)), '(9) warns "no test — cannot verify"');

  const warnNeither = evaluateEnvReadiness({ install: 'npm ci', test: 'npm test' });
  assert(!warnNeither.warnings.some((w) => /no install command/i.test(w)), '(9) no install-warning when present');
  assert(!warnNeither.warnings.some((w) => /no test command/i.test(w)), '(9) no test-warning when present');

  // ─── (10) secretish env keys flagged by NAME ──────────────────────────────
  const secretNames = evaluateEnvReadiness({
    env: {
      OPENAI_API_KEY: '',
      GITHUB_TOKEN: '',
      DB_PASSWORD: '',
      MY_SECRET: '',
      SOME_APIKEY: '',
      REDIS_PWD: '',
      NODE_ENV: 'test', // NOT secret-shaped
      LOG_LEVEL: 'info', // NOT secret-shaped
    },
  });
  for (const name of ['OPENAI_API_KEY', 'GITHUB_TOKEN', 'DB_PASSWORD', 'MY_SECRET', 'SOME_APIKEY', 'REDIS_PWD']) {
    assert(secretNames.secretishEnvKeys.includes(name), `(10) "${name}" flagged secret-ish by name`);
  }
  assert(!secretNames.secretishEnvKeys.includes('NODE_ENV'), '(10) NODE_ENV not flagged');
  assert(!secretNames.secretishEnvKeys.includes('LOG_LEVEL'), '(10) LOG_LEVEL not flagged');

  // placeholder-only secret values → flagged by name but NO hardcoding warning
  const placeholderOnly = evaluateEnvReadiness({ env: { API_KEY: '', DB_PASSWORD: '<your-password>', X_TOKEN: '${X_TOKEN}' } });
  assert(placeholderOnly.secretishEnvKeys.length === 3, '(10) all secretish names flagged even when placeholder');
  assert(!placeholderOnly.warnings.some((w) => /hardcoded/i.test(w)), '(10) placeholder values → no hardcoding warning');

  // ─── (11) hardcoded secret VALUE → generic warning, value NEVER echoed ────
  const SECRET_VALUE = 'sk-live-DEADBEEF-super-secret-1234567890';
  const withSecret = evaluateEnvReadiness({
    install: 'npm ci',
    test: 'npm test',
    env: { OPENAI_API_KEY: SECRET_VALUE, PUBLIC_URL: 'https://example.com' },
  });
  assert(withSecret.secretishEnvKeys.includes('OPENAI_API_KEY'), '(11) key name flagged');
  assert(withSecret.warnings.some((w) => /hardcoded/i.test(w) && /securely/i.test(w)), '(11) generic hardcoding warning emitted');
  // THE invariant: the secret value must not appear anywhere in the result.
  const serialized = JSON.stringify(withSecret);
  assert(!serialized.includes(SECRET_VALUE), '(11) secret VALUE absent from full serialized result');
  assert(withSecret.warnings.every((w) => !w.includes(SECRET_VALUE)), '(11) secret VALUE absent from every warning');
  assert(withSecret.secretishEnvKeys.every((k) => !k.includes(SECRET_VALUE)), '(11) secret VALUE absent from secretishEnvKeys');
  assert(Object.values(withSecret.commands).every((c) => !c.includes(SECRET_VALUE)), '(11) secret VALUE absent from commands');
  assert(withSecret.missing.every((m) => !m.includes(SECRET_VALUE)), '(11) secret VALUE absent from missing');

  // parse → evaluate round trip must ALSO never surface the value
  const parsedWithSecret = parseUcEnvironment(
    JSON.stringify({ install: 'npm ci', test: 'npm test', env: { AWS_SECRET_ACCESS_KEY: SECRET_VALUE } }),
  );
  const roundTrip = evaluateEnvReadiness(parsedWithSecret);
  assert(!JSON.stringify(roundTrip).includes(SECRET_VALUE), '(11) round-trip result never contains the secret value');
  assert(roundTrip.secretishEnvKeys.includes('AWS_SECRET_ACCESS_KEY'), '(11) round-trip flags the key name');

  // ─── (12) empty / missing env is safe ─────────────────────────────────────
  const noEnv = evaluateEnvReadiness({ install: 'npm ci', test: 'npm test' });
  assertEq(JSON.stringify(noEnv.secretishEnvKeys), '[]', '(12) no env → no secretish keys');
  const emptyEnv = evaluateEnvReadiness({ install: 'npm ci', test: 'npm test', env: {} });
  assertEq(JSON.stringify(emptyEnv.secretishEnvKeys), '[]', '(12) empty env → no secretish keys');

  // ─── (13) deterministic — same input twice → identical output ─────────────
  const a = evaluateEnvReadiness({ install: 'npm ci', env: { API_TOKEN: 'x', NODE_ENV: 'ci' } });
  const b = evaluateEnvReadiness({ install: 'npm ci', env: { API_TOKEN: 'x', NODE_ENV: 'ci' } });
  assertEq(JSON.stringify(a), JSON.stringify(b), '(13) evaluate is deterministic');

  // ─── (14) numeric/boolean env values coerced to string on parse ───────────
  const coerced = parseUcEnvironment(JSON.stringify({ env: { PORT: 3000, DEBUG: true, NESTED: { a: 1 } } }));
  assertEq(coerced.env?.PORT, '3000', '(14) numeric env coerced to string');
  assertEq(coerced.env?.DEBUG, 'true', '(14) boolean env coerced to string');
  assertEq(coerced.env?.NESTED, undefined, '(14) object env value dropped');

  // ─── (15) degenerate inputs never throw ───────────────────────────────────
  try {
    parseUcEnvironment(undefined as unknown as string);
    parseUcEnvironment(null as unknown as string);
    parseUcEnvironment(12345 as unknown as string);
    parseUcEnvironment({ install: 'x' } as unknown as string);
    evaluateEnvReadiness(undefined);
    evaluateEnvReadiness(null);
    evaluateEnvReadiness('a string' as unknown as UcEnvironment);
    evaluateEnvReadiness(42 as unknown as UcEnvironment);
    evaluateEnvReadiness([] as unknown as UcEnvironment);
    evaluateEnvReadiness({ env: 'not-an-object' } as unknown as UcEnvironment);
    evaluateEnvReadiness({ env: null } as unknown as UcEnvironment);
    evaluateEnvReadiness({ env: [1, 2] } as unknown as UcEnvironment);
    evaluateEnvReadiness({ install: 42 } as unknown as UcEnvironment);
    evaluateEnvReadiness({}, { require: [null, 42, '', 'install'] as unknown as string[] });
    passes += 1;
  } catch (e) {
    failures += 1;
    console.error(`FAIL: (15) degenerate inputs threw: ${(e as Error)?.message}`);
  }

  console.log(`\nenv-readiness-core smoke: ${passes} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}

main();
