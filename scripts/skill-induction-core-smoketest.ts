/**
 * skill-induction-core-smoketest — the PURE skill-induction brain
 * (src/lib/skillInductionCore.ts). Load-bearing: fingerprint on
 * surface + ordered tool-NAME sequence + normalized title cluster (never raw
 * tool inputs/outputs); recurrence gating (minOccurrences / minSuccessRatio);
 * multi-tool-only procedures; existing-skill + pending-proposal exclusion;
 * bounded, parameterized SKILL.md draft (When-to-use / Procedure / Pitfalls /
 * Verification); total/never-throws on hostile input.
 *
 * Pure — loads under tsx (skillInductionCore has zero imports).
 */

import {
  fingerprintRun,
  induceSkillCandidates,
  DRAFT_BODY_MAX_CHARS,
  type RunSignatureInput,
  type SkillCandidate,
} from '../src/lib/skillInductionCore';

let passes = 0;
let failures = 0;
function assert(c: unknown, m: string, e?: string): void {
  if (c) passes++;
  else {
    failures++;
    console.error('FAIL: ' + m + (e ? ' :: ' + e : ''));
  }
}
function assertEq(a: unknown, b: unknown, m: string): void {
  assert(a === b, m, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));
}

// A canonical "deploy staging" 3-tool procedure run.
function deployRun(overrides: Partial<RunSignatureInput> = {}): RunSignatureInput {
  return {
    surface: 'office_terminal',
    status: 'completed',
    toolNames: ['git.run', 'local.run_shell', 'desktop.observe_app'],
    title: 'Deploy staging',
    ...overrides,
  };
}

function main(): void {
  // ─── (1) fingerprintRun — identity on surface + tools + title cluster ──────
  const fpA = fingerprintRun(deployRun());
  const fpB = fingerprintRun(deployRun());
  assertEq(fpA, fpB, '(1) identical signatures → identical fingerprint');
  assert(fpA.includes('office_terminal'), '(1) fingerprint carries surface');
  assert(fpA.includes('git.run>local.run_shell>desktop.observe_app'), '(1) fingerprint carries ordered tool sequence');

  // Title id/counter differences cluster together.
  assertEq(
    fingerprintRun(deployRun({ title: 'Deploy staging #1' })),
    fingerprintRun(deployRun({ title: 'Deploy staging #42' })),
    '(1) title ids/counters fold into one cluster',
  );
  // Different meaningful title words → different fingerprint.
  assert(
    fingerprintRun(deployRun({ title: 'Deploy staging' })) !== fingerprintRun(deployRun({ title: 'Rollback staging' })),
    '(1) different title words → different fingerprint',
  );
  // Tool ORDER matters.
  assert(
    fingerprintRun(deployRun({ toolNames: ['a', 'b'] })) !== fingerprintRun(deployRun({ toolNames: ['b', 'a'] })),
    '(1) tool order changes fingerprint',
  );
  // Surface matters.
  assert(
    fingerprintRun(deployRun({ surface: 'main_chat' })) !== fingerprintRun(deployRun({ surface: 'feed_task' })),
    '(1) surface changes fingerprint',
  );
  // Status does NOT change fingerprint (it drives success ratio, not identity).
  assertEq(
    fingerprintRun(deployRun({ status: 'failed' })),
    fingerprintRun(deployRun({ status: 'completed' })),
    '(1) status is not part of identity',
  );
  // Tool rows as objects extract the same names as bare strings.
  assertEq(
    fingerprintRun(deployRun({ toolNames: [{ toolName: 'git.run' }, { tool: 'local.run_shell' }, { name: 'desktop.observe_app' }] })),
    fpA,
    '(1) object tool rows extract toolName/tool/name',
  );

  // ─── (2) fingerprintRun — secret-safety: raw inputs/outputs never folded ───
  const withSecrets: Record<string, unknown> = {
    surface: 'main_chat',
    status: 'completed',
    toolNames: ['browser.fill_credential_field', 'browser.submit'],
    title: 'Login flow',
    // Adversarial sibling fields the core must ignore entirely.
    toolInputs: [{ password: 'SUPER_SECRET_TOKEN_1234' }],
    toolOutputs: ['BEARER_abcdef.secret'],
    input: 'sk-live-DEADBEEF',
  };
  const fpSecret = fingerprintRun(withSecrets as RunSignatureInput);
  assert(!fpSecret.includes('SUPER_SECRET_TOKEN_1234'), '(2) fingerprint excludes tool input secret');
  assert(!fpSecret.includes('BEARER_abcdef'), '(2) fingerprint excludes tool output secret');
  assert(!fpSecret.includes('sk-live'), '(2) fingerprint excludes raw input secret');
  assert(fpSecret.includes('browser.fill_credential_field'), '(2) fingerprint still carries tool names');

  // ─── (3) induce — 3 successful same-signature runs → exactly 1 candidate ───
  const three = induceSkillCandidates([deployRun(), deployRun({ title: 'Deploy staging #2' }), deployRun({ title: 'Deploy staging 3' })]);
  assertEq(three.length, 1, '(3) 3 recurring successful runs → 1 candidate');
  const cand: SkillCandidate = three[0];
  assertEq(cand.occurrences, 3, '(3) occurrences counted');
  assertEq(cand.successRatio, 1, '(3) all-completed → successRatio 1');
  assertEq(cand.surface, 'office_terminal', '(3) surface carried onto candidate');
  assertEq(cand.toolSequence.length, 3, '(3) tool sequence length');
  assertEq(cand.toolSequence[0], 'git.run', '(3) tool sequence preserved in order');
  assert(cand.draftTitle.toLowerCase().includes('deploy staging'), '(3) draft title derived from title cluster');
  assert(cand.fingerprint === fpA, '(3) candidate fingerprint matches run fingerprint');

  // ─── (4) draft body — SKILL.md shape, parameterized, bounded ───────────────
  const body = cand.draftBody;
  assert(body.startsWith('---\n'), '(4) draft opens with YAML frontmatter');
  assert(/\nname: deploy-staging\n/.test(body), '(4) frontmatter name is candidate slug');
  assert(body.includes('version: 1.0.0'), '(4) frontmatter carries version');
  assert(body.includes('## When to use'), '(4) has When-to-use section');
  assert(body.includes('## Procedure'), '(4) has Procedure section');
  assert(body.includes('## Pitfalls'), '(4) has Pitfalls section');
  assert(body.includes('## Verification'), '(4) has Verification section');
  assert(body.includes('`git.run`'), '(4) procedure lists first tool');
  assert(body.includes('{{step_1_input}}'), '(4) procedure has parameter slot');
  assert(body.includes('3 successful'), '(4) body cites recurrence count');
  assert(body.length <= DRAFT_BODY_MAX_CHARS, '(4) draft body bounded to limit');
  assert(!body.includes('SUPER_SECRET_TOKEN'), '(4) draft body carries no secret');

  // ─── (5) threshold — 2 occurrences → none; custom minOccurrences ───────────
  assertEq(induceSkillCandidates([deployRun(), deployRun()]).length, 0, '(5) 2 occurrences < default min 3 → none');
  assertEq(
    induceSkillCandidates([deployRun(), deployRun()], { minOccurrences: 2 }).length,
    1,
    '(5) minOccurrences:2 admits the 2-run group',
  );
  // minOccurrences can never drop below 2 (a recurrence needs a repeat).
  assertEq(induceSkillCandidates([deployRun()], { minOccurrences: 1 }).length, 0, '(5) a lone run is never a candidate');

  // ─── (6) success ratio gate ────────────────────────────────────────────────
  // 2 completed + 1 failed = 0.667 < 0.8 → excluded.
  const mixed = induceSkillCandidates([deployRun(), deployRun(), deployRun({ status: 'failed' })]);
  assertEq(mixed.length, 0, '(6) ratio 0.667 < 0.8 → excluded');
  // 4 completed + 1 failed = 0.8 exactly → included (inclusive boundary).
  const boundary = induceSkillCandidates([
    deployRun(),
    deployRun(),
    deployRun(),
    deployRun(),
    deployRun({ status: 'failed' }),
  ]);
  assertEq(boundary.length, 1, '(6) ratio 0.8 == min → included');
  assertEq(boundary[0].occurrences, 5, '(6) occurrences count failed runs too');
  assertEq(boundary[0].successRatio, 0.8, '(6) successRatio reflects the failure');
  // Lower the bar and the 0.667 group comes back.
  assertEq(
    induceSkillCandidates([deployRun(), deployRun(), deployRun({ status: 'failed' })], { minSuccessRatio: 0.5 }).length,
    1,
    '(6) minSuccessRatio:0.5 admits the mixed group',
  );
  // Non-'completed' terminal statuses do not count as success.
  assertEq(
    induceSkillCandidates([deployRun({ status: 'cancelled' }), deployRun({ status: 'running' }), deployRun({ status: 'paused' })]).length,
    0,
    '(6) non-success statuses → ratio 0 → excluded',
  );

  // ─── (7) multi-tool only — single/zero-tool runs are not procedures ────────
  assertEq(
    induceSkillCandidates([
      deployRun({ toolNames: ['git.run'] }),
      deployRun({ toolNames: ['git.run'] }),
      deployRun({ toolNames: ['git.run'] }),
    ]).length,
    0,
    '(7) single-tool runs never induce a skill',
  );
  assertEq(
    induceSkillCandidates([deployRun({ toolNames: [] }), deployRun({ toolNames: [] }), deployRun({ toolNames: [] })]).length,
    0,
    '(7) zero-tool runs never induce a skill',
  );

  // ─── (8) exclusion — covered by existing skill ─────────────────────────────
  const runs3 = [deployRun(), deployRun(), deployRun()];
  assertEq(
    induceSkillCandidates(runs3, { existingSkillNames: ['Deploy Staging'] }).length,
    0,
    '(8) exact existing skill name covers → excluded',
  );
  assertEq(
    induceSkillCandidates(runs3, { existingSkillNames: ['deploy-staging'] }).length,
    0,
    '(8) existing slug form covers → excluded',
  );
  assertEq(
    induceSkillCandidates(runs3, { existingSkillNames: ['Deploy Staging Site And Notify'] }).length,
    0,
    '(8) superstring existing skill near-covers → excluded',
  );
  assertEq(
    induceSkillCandidates(runs3, { existingSkillNames: ['Rotate Database Backups'] }).length,
    1,
    '(8) unrelated existing skill does NOT cover',
  );

  // ─── (9) exclusion — already a pending proposal ────────────────────────────
  assertEq(
    induceSkillCandidates(runs3, { pendingSkillTitles: ['Deploy Staging'] }).length,
    0,
    '(9) matching pending proposal → excluded',
  );
  assertEq(
    induceSkillCandidates(runs3, { pendingSkillTitles: ['Something Else'] }).length,
    1,
    '(9) unrelated pending proposal → still a candidate',
  );

  // ─── (10) multiple groups — sorting + independence ─────────────────────────
  const groupA = [deployRun(), deployRun(), deployRun()]; // 3 occurrences
  const groupB = [
    deployRun({ surface: 'main_chat', title: 'Publish blog post', toolNames: ['wp.create_post', 'wp.upload_media', 'wp.publish'] }),
    deployRun({ surface: 'main_chat', title: 'Publish blog post', toolNames: ['wp.create_post', 'wp.upload_media', 'wp.publish'] }),
    deployRun({ surface: 'main_chat', title: 'Publish blog post', toolNames: ['wp.create_post', 'wp.upload_media', 'wp.publish'] }),
    deployRun({ surface: 'main_chat', title: 'Publish blog post', toolNames: ['wp.create_post', 'wp.upload_media', 'wp.publish'] }),
  ]; // 4 occurrences → should sort first
  const multi = induceSkillCandidates([...groupA, ...groupB]);
  assertEq(multi.length, 2, '(10) two distinct procedures → two candidates');
  assertEq(multi[0].occurrences, 4, '(10) more-frequent procedure sorts first');
  assert(multi[0].surface === 'main_chat', '(10) top candidate is the publish flow');
  assert(multi[0].fingerprint !== multi[1].fingerprint, '(10) candidates have distinct fingerprints');

  // ─── (11) bounded output — huge tool list + many groups ────────────────────
  const bigTools = Array.from({ length: 500 }, (_, i) => `tool.step_${i}`);
  const bigRuns = [
    deployRun({ toolNames: bigTools }),
    deployRun({ toolNames: bigTools }),
    deployRun({ toolNames: bigTools }),
  ];
  const bigCands = induceSkillCandidates(bigRuns);
  assertEq(bigCands.length, 1, '(11) huge tool list → still one candidate');
  assert(bigCands[0].toolSequence.length <= 40, '(11) tool sequence capped at 40');
  assert(bigCands[0].draftBody.length <= DRAFT_BODY_MAX_CHARS, '(11) draft body still bounded with huge input');
  assert(bigCands[0].draftBody.includes('trimmed to fit the draft budget'), '(11) trimmed procedure notes the elision');

  // Many distinct qualifying groups → capped candidate list.
  const manyRuns: RunSignatureInput[] = [];
  for (let k = 0; k < 30; k++) {
    const t = [`g${k}.a`, `g${k}.b`];
    manyRuns.push(deployRun({ title: `Job ${k}`, toolNames: t }));
    manyRuns.push(deployRun({ title: `Job ${k}`, toolNames: t }));
    manyRuns.push(deployRun({ title: `Job ${k}`, toolNames: t }));
  }
  assert(induceSkillCandidates(manyRuns).length <= 12, '(11) candidate list capped at 12');

  // ─── (12) fallback draft title (empty titles) ──────────────────────────────
  const noTitle = induceSkillCandidates([
    deployRun({ title: '', toolNames: ['alpha.run', 'omega.finish'] }),
    deployRun({ title: '   ', toolNames: ['alpha.run', 'omega.finish'] }),
    deployRun({ title: '###', toolNames: ['alpha.run', 'omega.finish'] }),
  ]);
  assertEq(noTitle.length, 1, '(12) empty titles still cluster + induce');
  assert(noTitle[0].draftTitle.length > 0, '(12) fallback draft title is non-empty');
  assert(noTitle[0].draftTitle.toLowerCase().includes('alpha'), '(12) fallback title derives from tool sequence');

  // ─── (13) hostile / degenerate — never throws, always safe neutral ─────────
  let threw = false;
  try {
    const cyclic: Record<string, unknown> = { surface: 'x', status: 'completed', title: 'c', toolNames: ['a', 'b'] };
    cyclic.self = cyclic;
    (cyclic.toolNames as unknown[]).push(cyclic); // cyclic element inside toolNames

    const throwyToString = { toString() { throw new Error('boom'); } };
    const throwyProxy = new Proxy(
      {},
      {
        get() {
          throw new Error('hostile get');
        },
      },
    );

    // fingerprintRun over every hostile shape.
    const hostileFpInputs: unknown[] = [
      null,
      undefined,
      0,
      42,
      NaN,
      '',
      'a string',
      true,
      [],
      {},
      cyclic,
      throwyProxy,
      { surface: throwyToString, title: throwyToString, toolNames: throwyToString, status: throwyToString },
      { toolNames: [throwyToString, null, 1, true, {}, { toolName: throwyToString }] },
      Symbol('s'),
    ];
    for (const bad of hostileFpInputs) {
      const fp = fingerprintRun(bad as RunSignatureInput);
      assert(typeof fp === 'string', '(13) fingerprintRun always returns a string', 'input=' + safeLabel(bad));
    }

    // induceSkillCandidates over every hostile `runs` shape.
    const hostileRunsInputs: unknown[] = [
      null,
      undefined,
      0,
      'not-an-array',
      true,
      {},
      Symbol('s'),
      [null, undefined, 0, 'x', true, [], {}],
      [cyclic, cyclic, cyclic],
      [throwyProxy, throwyProxy, throwyProxy],
      cyclic,
    ];
    for (const bad of hostileRunsInputs) {
      const out = induceSkillCandidates(bad);
      assert(Array.isArray(out), '(13) induceSkillCandidates always returns an array', 'input=' + safeLabel(bad));
    }

    // Hostile OPTS shapes.
    assert(Array.isArray(induceSkillCandidates(runs3, null as never)), '(13) null opts safe');
    assert(Array.isArray(induceSkillCandidates(runs3, 5 as never)), '(13) numeric opts safe');
    assert(
      Array.isArray(
        induceSkillCandidates(runs3, {
          minOccurrences: NaN,
          minSuccessRatio: 'nonsense' as never,
          existingSkillNames: 'not-an-array',
          pendingSkillTitles: 42,
        }),
      ),
      '(13) garbage opts fields fall back to defaults',
    );
    // Garbage opts should behave like defaults → the clean 3-run group still induces.
    assertEq(
      induceSkillCandidates(runs3, { minOccurrences: NaN, minSuccessRatio: 'x' as never }).length,
      1,
      '(13) NaN/garbage thresholds fall back to defaults (still 1 candidate)',
    );
  } catch (e) {
    threw = true;
    console.error('unexpected throw in hostile group:', e);
  }
  assert(!threw, '(13) hostile/degenerate group never throws');

  // ─── (14) determinism — same input twice → identical result ────────────────
  const d1 = JSON.stringify(induceSkillCandidates([...groupA, ...groupB]));
  const d2 = JSON.stringify(induceSkillCandidates([...groupA, ...groupB]));
  assertEq(d1, d2, '(14) induction is deterministic');
  assertEq(fingerprintRun(deployRun()), fingerprintRun(deployRun()), '(14) fingerprint is deterministic');

  if (failures > 0) {
    console.error('\n' + failures + ' fail');
    process.exit(1);
  }
  console.log('\nAll skillInduction smoke cases passed (' + passes + ' passed).');
}

function safeLabel(v: unknown): string {
  try {
    if (typeof v === 'symbol') return 'symbol';
    return String(v).slice(0, 24);
  } catch {
    return '<unprintable>';
  }
}

main();
