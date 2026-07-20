// Smoke test for src/lib/responseSelfCheckCore.ts
// Run: npx tsx scripts/response-self-check-core-smoketest.ts
//
// Covers clean answers, each defect kind (placeholder / empty+unclosed fence /
// promise-without-delivery / dangling / unbacked-action-claim), the granular
// helpers, precedence/flag, bounds + secret-safety, determinism, and a dedicated
// hostile-input group proving no throw + safe bounded output.
import {
  scanResponseForDefects,
  hasUnclosedCodeFence,
  endsDangling,
  findPlaceholders,
  selfCheckFlag,
  MAX_SCAN_CHARS,
  TAIL_WINDOW,
  MAX_DEFECTS,
  EVIDENCE_MAX,
  type ResponseSelfCheckResult,
  type ResponseDefect,
  type ResponseDefectKind,
} from '../src/lib/responseSelfCheckCore';

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string): void {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error('  FAIL:', msg);
  }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, `${msg} (got ${JSON.stringify(a)} want ${JSON.stringify(b)})`);
}
function scan(responseText: unknown, toolCallsUsed?: unknown): ResponseSelfCheckResult {
  return scanResponseForDefects({ responseText, toolCallsUsed });
}
function hasKind(r: ResponseSelfCheckResult, kind: ResponseDefectKind): boolean {
  return r.defects.some((d) => d.kind === kind);
}
function kindSeverity(r: ResponseSelfCheckResult, kind: ResponseDefectKind): string {
  const d = r.defects.find((x) => x.kind === kind);
  return d ? d.severity : '(absent)';
}
const NUL = String.fromCharCode(0);

// ── (1) clean answers → flag 'ok' ────────────────────────────────────────────
{
  const clean = [
    'The port is 8081 and the bridge runs on 7778. That is all set.',
    'Sure — here is a closed code block:\n```ts\nconst x = 1;\nexport default x;\n```\nDone.',
    'Steps:\n- connect the repo\n- run the planner\n- verify the proof',
    'See the table below.\n\n| name | port |\n| --- | --- |\n| app | 8081 |',
    'The reference is at https://example.com/docs',
    'I finished reviewing the plan and everything looks correct.',
  ];
  for (const c of clean) {
    const r = scan(c);
    assertEq(r.flag, 'ok', `clean stays ok: ${JSON.stringify(c.slice(0, 24))}`);
    assertEq(r.incomplete, false, 'clean incomplete false');
    assertEq(r.defects.length, 0, 'clean has no defects');
  }
  // empty / whitespace responseText → neutral
  assertEq(scan('').flag, 'ok', 'empty text ok');
  assertEq(scan('   \n  ').defects.length, 0, 'whitespace-only text no defects');
}

// ── (2) placeholders ─────────────────────────────────────────────────────────
{
  const highs = [
    'Set the path here: [TODO]',
    'Open the file at <insert path/to/file> to continue.',
    'Greeting: Hello {{name}}, welcome.',
    'Please fill in ___ before running.',
    'Use <your API key here> in the header.',
    'Replace [INSERT PROJECT NAME] with the real value.',
  ];
  for (const h of highs) {
    const r = scan(h);
    assertEq(r.flag, 'incomplete', `placeholder high → incomplete: ${JSON.stringify(h.slice(0, 20))}`);
    assert(hasKind(r, 'unfilled_placeholder'), 'placeholder defect present');
    assertEq(kindSeverity(r, 'unfilled_placeholder'), 'high', 'placeholder severity high');
  }
  // bare all-caps prose markers → LOW review (legitimate often enough)
  const tbd = scan('The rollout date is TBD for now.');
  assertEq(tbd.flag, 'review', 'bare TBD → review');
  assertEq(kindSeverity(tbd, 'unfilled_placeholder'), 'low', 'bare TBD severity low');
  const fixme = scan('Left a FIXME here we should revisit.');
  assertEq(fixme.flag, 'review', 'bare FIXME → review');

  // annotations & citations & links must NOT be placeholders
  assertEq(scan('See [NOTE] for the caveat and reference [1] below.').flag, 'ok', '[NOTE]/[1] not placeholders');
  assertEq(scan('Read the [docs](https://x.com/y) for details.').flag, 'ok', 'markdown link not a placeholder');
  assertEq(scan('Task list: [x] done and [ ] pending.').flag, 'ok', 'checkbox brackets not placeholders');

  // findPlaceholders granular helper
  const fp = findPlaceholders('a [TODO] b {{v}} c <insert x> d');
  assert(fp.length >= 3, 'findPlaceholders finds the three high tokens');
  assertEq(findPlaceholders('nothing to see here.').length, 0, 'findPlaceholders empty on clean');
  assertEq(findPlaceholders(123).length, 0, 'findPlaceholders non-string → []');
}

// ── (3) code fences ──────────────────────────────────────────────────────────
{
  const empty = scan('Here you are:\n```ts\n```');
  assert(hasKind(empty, 'empty_code_fence'), 'empty fence detected');
  assertEq(empty.flag, 'incomplete', 'empty fence → incomplete');

  const unclosed = scan('```ts\nfoo()');
  assert(hasKind(unclosed, 'unclosed_code_fence'), 'unclosed fence detected');
  assertEq(unclosed.flag, 'incomplete', 'unclosed fence → incomplete');

  // hasUnclosedCodeFence pins
  assertEq(hasUnclosedCodeFence('```ts\nfoo()'), true, 'unclosed → true');
  assertEq(hasUnclosedCodeFence('```ts\nfoo()\n```'), false, 'closed → false');
  assertEq(hasUnclosedCodeFence('```ts\n```'), false, 'empty-but-closed → false');
  assertEq(hasUnclosedCodeFence('no fences at all'), false, 'no fence → false');
  assertEq(hasUnclosedCodeFence('~~~\ncode'), true, 'unclosed tilde fence → true');
  assertEq(hasUnclosedCodeFence(null), false, 'null → false');
}

// ── (4) promise without delivery ─────────────────────────────────────────────
{
  const proms = ['Here is the updated file:', 'The full script is:', 'Done. As follows:', 'Here is the file:\n```ts\n```'];
  for (const p of proms) {
    const r = scan(p);
    assert(hasKind(r, 'promise_without_delivery'), `promise detected: ${JSON.stringify(p.slice(0, 24))}`);
    assertEq(r.flag, 'incomplete', 'promise → incomplete');
  }
  // same lead-in FOLLOWED by real content → ok
  const delivered = scan('Here is the updated file:\n```ts\nconst x = 1;\nexport default x;\n```');
  assert(!hasKind(delivered, 'promise_without_delivery'), 'delivered content → no promise defect');
  assertEq(delivered.flag, 'ok', 'delivered content → ok');
  // an inline delivery ("here is the answer: 42") is not a broken promise
  assertEq(scan('Here is the answer: 42.').flag, 'ok', 'inline answer not a broken promise');
}

// ── (5) endsDangling true / false pins ───────────────────────────────────────
{
  for (const t of [
    'I looked at the config and',
    'It failed because',
    'The next step is to update the',
    'Call the helper (',
    'The remaining items are:',
    'It depends on, ',
  ]) {
    assertEq(endsDangling(t), true, `dangling true: ${JSON.stringify(t.slice(-16))}`);
  }
  for (const t of [
    'That is complete.',
    'Is it ready?',
    'Here is the code:\n```ts\nx\n```',
    'The list:\n- first item',
    'See https://example.com',
    'He said "it is done."',
  ]) {
    assertEq(endsDangling(t), false, `dangling false: ${JSON.stringify(t.slice(-16))}`);
  }
  // dangling surfaces as a HIGH defect in a full scan
  const r = scan('I started the migration and');
  assert(hasKind(r, 'dangling_sentence'), 'dangling defect present');
  assertEq(r.flag, 'incomplete', 'dangling → incomplete');
}

// ── (6) unbacked action claims (opt-in) ──────────────────────────────────────
{
  const claim = "I've edited the file and sent the email.";
  // gmail.search backs neither an edit nor a send → BOTH flagged LOW
  const r1 = scan(claim, ['gmail.search']);
  assert(hasKind(r1, 'unbacked_action_claim'), 'unbacked claim detected with only a search tool');
  assert(r1.defects.filter((d) => d.kind === 'unbacked_action_claim').length >= 2, 'both edit+send flagged');
  assertEq(r1.flag, 'review', 'unbacked claims are LOW → review');

  // the actual edit + send tools present → backed → ok
  const r2 = scan(claim, ['desktop.edit_file', 'gmail.send']);
  assert(!hasKind(r2, 'unbacked_action_claim'), 'claims backed by real tools → no defect');
  assertEq(r2.flag, 'ok', 'backed claims → ok');

  // toolCallsUsed OMITTED → check skipped (unknown ≠ none)
  assertEq(scanResponseForDefects({ responseText: claim }).flag, 'ok', 'omitted toolCallsUsed → skipped');
  // non-array toolCallsUsed → skipped
  assertEq(scan(claim, 'gmail.send').flag, 'ok', 'non-array toolCallsUsed → skipped');

  // known-empty array + claim → flagged LOW
  const r3 = scan(claim, []);
  assert(hasKind(r3, 'unbacked_action_claim'), 'empty tool array + claim → flagged');
  assertEq(r3.flag, 'review', 'empty tool array → review');

  // future tense is NEVER a completion claim
  assertEq(scan("I'll edit the file and send the email.", []).flag, 'ok', 'future tense not flagged');
  assertEq(scan('I will run the tests next.', []).flag, 'ok', 'future "will run" not flagged');
  // a git claim backed by git.run
  assertEq(scan('I committed the change.', ['git.run']).flag, 'ok', 'git claim backed by git.run');
  assert(hasKind(scan('I committed the change.', ['gmail.search']), 'unbacked_action_claim'), 'git claim unbacked by search tool');
}

// ── (7) precedence & selfCheckFlag ───────────────────────────────────────────
{
  // mixed HIGH + LOW → incomplete; a placeholder(high) plus a bare marker(low)
  const mixed = scan('Fill [INSERT NAME] and note TBD later.');
  assertEq(mixed.flag, 'incomplete', 'mixed high+low → incomplete');

  const highDefect: ResponseDefect = { kind: 'unclosed_code_fence', severity: 'high', evidence: 'x' };
  const lowDefect: ResponseDefect = { kind: 'unbacked_action_claim', severity: 'low', evidence: 'y' };
  assertEq(selfCheckFlag([highDefect, lowDefect]), 'incomplete', 'selfCheckFlag any high → incomplete');
  assertEq(selfCheckFlag([lowDefect]), 'review', 'selfCheckFlag only low → review');
  assertEq(selfCheckFlag([]), 'ok', 'selfCheckFlag empty → ok');
  assertEq(selfCheckFlag('nope' as unknown), 'ok', 'selfCheckFlag non-array → ok');
  assertEq(selfCheckFlag([{ severity: 'weird' }, null, 42] as unknown), 'ok', 'selfCheckFlag junk entries → ok');
  // high-severity-first ordering in the full result
  assert(mixed.defects.length >= 2 && mixed.defects[0].severity === 'high', 'defects sorted high-first');
}

// ── (8) bounds & secret-safety ───────────────────────────────────────────────
{
  // MAX_DEFECTS cap on placeholder spam (distinct evidence so they don't dedupe)
  let spam = '';
  for (let i = 0; i < 30; i++) spam += `[INSERT FIELD ${i}] `;
  const spammed = scan(spam);
  assert(spammed.defects.length <= MAX_DEFECTS, 'defects capped at MAX_DEFECTS');
  for (const d of spammed.defects) assert(d.evidence.length <= EVIDENCE_MAX, 'each evidence <= EVIDENCE_MAX');

  // EVIDENCE_MAX clamp on a very long placeholder
  const longInner = '[INSERT ' + 'word '.repeat(60) + ']';
  const longR = scan(longInner);
  for (const d of longR.defects) assert(d.evidence.length <= EVIDENCE_MAX, 'long placeholder evidence clamped');

  // secret redaction: a 64-hex run inside a flagged snippet is masked
  const hex = 'abcdef0123456789'.repeat(4); // 64 hex chars
  const secretR = scan('[INSERT ' + hex + ']');
  const ev = secretR.defects.map((d) => d.evidence).join(' | ');
  assert(ev.indexOf('redacted') >= 0, 'long secret-shaped run is redacted');
  assert(ev.indexOf(hex) < 0, 'raw 64-char secret run not echoed');

  // a NUL in the response never survives into evidence (built via fromCharCode)
  const withNul = scan('Fill [INSERT' + NUL + 'X] now');
  assert(withNul.defects.every((d) => d.evidence.indexOf(NUL) < 0), 'NUL stripped from evidence');

  // huge input is bounded, not throwing, and still catches a tail dangling
  const huge = 'lorem ipsum '.repeat(50000) + 'and'; // > MAX_SCAN_CHARS, ends dangling
  const hugeR = scan(huge);
  assert(hasKind(hugeR, 'dangling_sentence'), 'huge input tail dangling still caught');
  assert(hugeR.defects.length <= MAX_DEFECTS, 'huge input defects bounded');
  assert(MAX_SCAN_CHARS > 0 && TAIL_WINDOW > 0, 'exported bounds are positive');
}

// ── (9) determinism ──────────────────────────────────────────────────────────
{
  const samples: Array<[unknown, unknown]> = [
    ['Here is the updated file:', undefined],
    ['[TODO] and {{x}} and TBD', undefined],
    ["I've edited the file.", ['gmail.search']],
    ['```ts\nunclosed', undefined],
    ['It stopped because', undefined],
  ];
  for (const [txt, tools] of samples) {
    const a = JSON.stringify(scan(txt, tools));
    const b = JSON.stringify(scan(txt, tools));
    assertEq(a, b, `deterministic: ${JSON.stringify(String(typeof txt === 'string' ? txt.slice(0, 16) : txt))}`);
  }
  // repeated calls to a global-regex path do not leak lastIndex state
  assertEq(JSON.stringify(findPlaceholders('[TODO] x')), JSON.stringify(findPlaceholders('[TODO] x')), 'findPlaceholders stable across calls');
  assertEq(endsDangling('ends with and'), endsDangling('ends with and'), 'endsDangling stable');
}

// ── (10) HOSTILE input — never throws, always well-shaped ─────────────────────
{
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  const throwingText = { get responseText() { throw new Error('boom'); } };
  const throwingTools = { responseText: 'I edited the file.', get toolCallsUsed() { throw new Error('boom'); } };
  const throwingProxy = new Proxy({}, { get() { throw new Error('boom'); } });
  const bigStr = 'x'.repeat(1_000_000);
  const bigFences = '```\n'.repeat(200000); // ~1MB of fence markers
  const bigDangle = 'word '.repeat(300000) + 'because';

  // responseText hostiles passed as the whole input (via wrapper) and as raw values
  const hostileInputs: unknown[] = [
    null, undefined, 0, NaN, Infinity, {}, [], true, Symbol('s'),
    (() => { try { return BigInt(9); } catch { return 9; } })(),
    cyclic, throwingProxy, () => 0, 'plain string as input',
    { responseText: null }, { responseText: 42 }, { responseText: {} },
    { responseText: bigStr }, { responseText: bigFences }, { responseText: bigDangle },
    throwingText, throwingTools,
    { responseText: 'I edited the file.', toolCallsUsed: 'notarray' },
    { responseText: 'I edited the file.', toolCallsUsed: [null, 42, {}, Symbol('t')] },
    { responseText: 'I edited the file.', toolCallsUsed: new Proxy([], { get() { throw new Error('boom'); } }) },
  ];
  const labels = [
    'null', 'undefined', '0', 'NaN', 'Infinity', '{}', '[]', 'true', 'Symbol',
    'bigint', 'cyclic', 'throwing-proxy', 'fn', 'raw-string',
    'rt:null', 'rt:number', 'rt:object',
    'rt:1MB-text', 'rt:1MB-fences', 'rt:1MB-dangle',
    'throwing-responseText', 'throwing-toolCallsUsed',
    'tools:non-array', 'tools:junk-elements', 'tools:throwing-array',
  ];
  for (let i = 0; i < hostileInputs.length; i++) {
    const lbl = labels[i];
    let r: ResponseSelfCheckResult;
    try {
      r = scanResponseForDefects(hostileInputs[i]);
    } catch (e) {
      assert(false, `scanResponseForDefects threw on hostile input ${lbl}: ${(e as Error).message}`);
      continue;
    }
    assert(r && typeof r === 'object', `hostile ${lbl} → object result`);
    assert(r.flag === 'ok' || r.flag === 'review' || r.flag === 'incomplete', `hostile ${lbl} → valid flag`);
    assertEq(r.incomplete, r.flag === 'incomplete', `hostile ${lbl} → incomplete mirrors flag`);
    assert(Array.isArray(r.defects) && r.defects.length <= MAX_DEFECTS, `hostile ${lbl} → bounded defects`);
    for (const d of r.defects) assert(d.evidence.length <= EVIDENCE_MAX, `hostile ${lbl} → evidence clamped`);
  }

  // granular helpers also never throw on hostiles (fixed labels; never String() a Proxy)
  const helperHostiles: unknown[] = [null, undefined, 42, {}, [], NaN, throwingProxy, cyclic, bigStr, bigFences];
  const helperLabels = ['null', 'undefined', '42', '{}', '[]', 'NaN', 'throwing-proxy', 'cyclic', '1MB', '1MB-fences'];
  for (let i = 0; i < helperHostiles.length; i++) {
    const lbl = helperLabels[i];
    try {
      assertEq(typeof hasUnclosedCodeFence(helperHostiles[i]), 'boolean', `hasUnclosedCodeFence ${lbl} → boolean`);
      assertEq(typeof endsDangling(helperHostiles[i]), 'boolean', `endsDangling ${lbl} → boolean`);
      assert(Array.isArray(findPlaceholders(helperHostiles[i])), `findPlaceholders ${lbl} → array`);
      assertEq(typeof selfCheckFlag(helperHostiles[i]), 'string', `selfCheckFlag ${lbl} → string`);
    } catch (e) {
      assert(false, `a granular helper threw on ${lbl}: ${(e as Error).message}`);
    }
  }

  // fresh-object contract: mutating one result cannot poison the next
  const first = scanResponseForDefects(null);
  first.defects.push({ kind: 'dangling_sentence', severity: 'high', evidence: 'poison' });
  first.flag = 'incomplete';
  const second = scanResponseForDefects(null);
  assertEq(second.defects.length, 0, 'fresh defects array per call');
  assertEq(second.flag, 'ok', 'fresh flag per call');
}

console.log(`response-self-check-core smoke: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log('All response-self-check-core smoke cases passed (' + passed + ' passed).');
