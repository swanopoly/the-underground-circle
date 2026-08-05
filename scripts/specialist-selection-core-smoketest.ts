/**
 * specialist-selection-core-smoketest — the pure signal-based specialist
 * selector (src/lib/specialistSelectionCore.ts) behind the delegation-expansion
 * work: dormant Security / DevOps / Designer sub-agents are never auto-delegated
 * because subagentRegistry.planSubagentDelegation's task-kind switch only wires a
 * fixed roster. This core scans message + task-plan text for clear domain
 * signals and proposes the extra specialists that were NOT already selected.
 *
 * Load-bearing assertions:
 *   SIGNALS: "fix the SQL injection vuln" → security; "deploy to prod via the
 *   docker pipeline" → devops; figma/layout/color → designer.
 *   CONSERVATIVE: a plain "add a button" (and greetings) → no signal.
 *   EXCLUSION: an already-selected role is never re-proposed (string / {role} /
 *   {subagent:{role}} / Set forms all honored).
 *   TASK PLAN: signals can come from taskPlan text, not just the message.
 *   STRENGTH: priority is high (>=3) / medium (2) / low (1) by match count.
 *   PLUGIN ROLES: unknown roles fall back to their own triggerPatterns literals.
 *   RANK: rankSpecialistsByPriority is a stable high→medium→low sort.
 *   And: every export is total — degenerate/hostile input never throws.
 *
 * Pure — loads under tsx (specialistSelectionCore has zero imports).
 */

import {
  selectSignaledSpecialists,
  rankSpecialistsByPriority,
  type CapabilitySignal,
} from '../src/lib/specialistSelectionCore';

let passes = 0;
let failures = 0;
function assert(c: unknown, m: string, e?: string): void {
  if (c) passes += 1;
  else { failures += 1; console.error('FAIL: ' + m + (e ? ' :: ' + e : '')); }
}
function assertEq(a: unknown, b: unknown, m: string): void {
  assert(a === b, m, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));
}

// Minimal capability fixtures — the core only reads `.role` (+ optional
// `.triggerPatterns` for unknown/plugin roles), so bare { role } objects match
// the real SubagentCapabilityProfile shape for selection purposes.
const caps = (roles: string[]): Array<{ role: string }> => roles.map((role) => ({ role }));
const ALL = caps([
  'planner', 'researcher', 'writer', 'coder', 'reviewer', 'designer',
  'architect', 'debugger', 'tester', 'support', 'security', 'devops',
]);
const roleSet = (signals: CapabilitySignal[]): Set<string> => new Set(signals.map((s) => s.role));
const find = (signals: CapabilitySignal[], role: string): CapabilitySignal | undefined =>
  signals.find((s) => s.role === role);

function main(): void {
  // ── 1. Exports exist and are callable ──────────────────────────────────────
  assertEq(typeof selectSignaledSpecialists, 'function', '(1) selectSignaledSpecialists is a function');
  assertEq(typeof rankSpecialistsByPriority, 'function', '(1) rankSpecialistsByPriority is a function');
  assert(Array.isArray(selectSignaledSpecialists({ message: '', capabilities: ALL })), '(1) returns an array');

  // ── 2. Security signal ("fix the SQL injection vuln") ──────────────────────
  {
    const sig = selectSignaledSpecialists({ message: 'fix the SQL injection vuln', capabilities: ALL });
    assertEq(sig.length, 1, '(2) only security signaled for injection/vuln');
    assertEq(sig[0]?.role, 'security', '(2) role is security');
    assertEq(sig[0]?.priority, 'medium', '(2) two matches → medium');
    assert(sig[0]?.matched.includes('injection'), '(2) matched includes injection');
    assert(sig[0]?.matched.includes('vuln'), '(2) matched includes vuln');
    assert(!roleSet(sig).has('coder'), '(2) generic "fix" does NOT wake coder');
    // more security phrasings
    assert(roleSet(selectSignaledSpecialists({ message: 'rotate the leaked secret credentials', capabilities: ALL })).has('security'), '(2) secret+credentials → security');
    assert(roleSet(selectSignaledSpecialists({ message: 'add oauth authentication and csrf protection', capabilities: ALL })).has('security'), '(2) oauth/auth/csrf → security');
    assert(roleSet(selectSignaledSpecialists({ message: 'this cve is an owasp xss exploit', capabilities: ALL })).has('security'), '(2) cve/owasp/xss/exploit → security');
  }

  // ── 3. DevOps signal ("deploy to prod via the docker pipeline") ────────────
  {
    const sig = selectSignaledSpecialists({ message: 'deploy to prod via the docker pipeline', capabilities: ALL });
    assertEq(sig.length, 1, '(3) only devops signaled for deploy/docker/pipeline');
    assertEq(sig[0]?.role, 'devops', '(3) role is devops');
    assertEq(sig[0]?.priority, 'high', '(3) four matches → high');
    assert(sig[0]?.matched.includes('deploy'), '(3) matched includes deploy');
    assert(sig[0]?.matched.includes('docker'), '(3) matched includes docker');
    assert(sig[0]?.matched.includes('pipeline'), '(3) matched includes pipeline');
    assert(sig[0]?.matched.includes('prod'), '(3) matched includes prod');
    assert(roleSet(selectSignaledSpecialists({ message: 'set up ci/cd with terraform and kubernetes', capabilities: ALL })).has('devops'), '(3) ci/cd/terraform/kubernetes → devops');
    assert(roleSet(selectSignaledSpecialists({ message: 'add a rollback plan for the netlify release', capabilities: ALL })).has('devops'), '(3) rollback/netlify/release → devops');
  }

  // ── 4. Designer signal (figma / layout / color / ui) ───────────────────────
  {
    const sig = selectSignaledSpecialists({ message: 'update the figma layout and color palette for the ui', capabilities: ALL });
    assertEq(sig.length, 1, '(4) only designer signaled for figma/layout/color');
    assertEq(sig[0]?.role, 'designer', '(4) role is designer');
    assertEq(sig[0]?.priority, 'high', '(4) >=3 matches → high');
    assert(sig[0]?.matched.includes('figma'), '(4) matched includes figma');
    assert(sig[0]?.matched.includes('layout'), '(4) matched includes layout');
    assert(roleSet(selectSignaledSpecialists({ message: 'improve the ux and typography', capabilities: ALL })).has('designer'), '(4) ux/typography → designer');
    assert(roleSet(selectSignaledSpecialists({ message: 'make the wireframe responsive', capabilities: ALL })).has('designer'), '(4) wireframe/responsive → designer');
  }

  // ── 5. Conservative: plain requests signal nothing ─────────────────────────
  {
    assertEq(selectSignaledSpecialists({ message: 'add a button', capabilities: ALL }).length, 0, '(5) "add a button" → no signal');
    assertEq(selectSignaledSpecialists({ message: 'hello there, how are you?', capabilities: ALL }).length, 0, '(5) greeting → no signal');
    assertEq(selectSignaledSpecialists({ message: 'what is the weather today', capabilities: ALL }).length, 0, '(5) small talk → no signal');
    assertEq(selectSignaledSpecialists({ message: 'please rename this file', capabilities: ALL }).length, 0, '(5) plain rename → no signal');
    assertEq(selectSignaledSpecialists({ message: '', capabilities: ALL }).length, 0, '(5) empty message → no signal');
    assertEq(selectSignaledSpecialists({ message: '   \n\t  ', capabilities: ALL }).length, 0, '(5) whitespace → no signal');
  }

  // ── 6. Already-selected roles are excluded ─────────────────────────────────
  {
    const msg = 'deploy the docker pipeline then fix the injection vuln';
    const both = selectSignaledSpecialists({ message: msg, capabilities: caps(['devops', 'security']) });
    assertEq(both.length, 2, '(6) devops + security both signaled without exclusion');
    // string-role form
    const s1 = selectSignaledSpecialists({ message: msg, capabilities: caps(['devops', 'security']), alreadySelected: ['devops'] });
    assertEq(s1.length, 1, '(6) devops excluded via string');
    assertEq(s1[0]?.role, 'security', '(6) only security remains');
    // {role} form
    const s2 = selectSignaledSpecialists({ message: msg, capabilities: caps(['devops', 'security']), alreadySelected: [{ role: 'security' }] });
    assertEq(roleSet(s2).has('security'), false, '(6) security excluded via {role}');
    assertEq(roleSet(s2).has('devops'), true, '(6) devops remains');
    // {subagent:{role}} (SubagentTaskSpec) form
    const s3 = selectSignaledSpecialists({
      message: msg,
      capabilities: caps(['devops', 'security']),
      alreadySelected: [{ subagent: { role: 'devops' }, task: 't', reason: 'r', priority: 'high' }],
    });
    assertEq(roleSet(s3).has('devops'), false, '(6) devops excluded via {subagent:{role}}');
    // Set form
    const s4 = selectSignaledSpecialists({ message: msg, capabilities: caps(['devops', 'security']), alreadySelected: new Set(['devops', 'security']) });
    assertEq(s4.length, 0, '(6) both excluded via Set');
  }

  // ── 7. Task-plan text drives signals (not just the message) ────────────────
  {
    const taskPlan = {
      kind: 'build',
      summary: 'set up the docker deployment pipeline',
      verification: [{ label: 'configure ci', reason: 'release safety' }],
      recommendedTools: [{ reason: 'write the dockerfile' }],
    };
    const withPlan = selectSignaledSpecialists({ message: 'please handle this thing', taskPlan, capabilities: caps(['devops']) });
    assertEq(withPlan.length, 1, '(7) devops signaled from taskPlan text');
    assertEq(withPlan[0]?.role, 'devops', '(7) role is devops');
    assertEq(withPlan[0]?.priority, 'high', '(7) many devops terms in plan → high');
    // Same message WITHOUT the plan → nothing (proves the plan drove it).
    assertEq(selectSignaledSpecialists({ message: 'please handle this thing', capabilities: caps(['devops']) }).length, 0, '(7) message alone → no signal');
    // "build" kind string itself is not a keyword (generic terms excluded).
    assertEq(selectSignaledSpecialists({ message: '', taskPlan: { kind: 'build', summary: 'add a feature' }, capabilities: ALL }).length, 0, '(7) plan kind/generic words do not over-signal');
  }

  // ── 8. Priority by match strength (1 low / 2 medium / 3+ high) ──────────────
  {
    const one = selectSignaledSpecialists({ message: 'we run kubernetes', capabilities: caps(['devops']) });
    assertEq(one[0]?.priority, 'low', '(8) single match → low');
    const two = selectSignaledSpecialists({ message: 'docker and kubernetes', capabilities: caps(['devops']) });
    assertEq(two[0]?.priority, 'medium', '(8) two matches → medium');
    const three = selectSignaledSpecialists({ message: 'docker kubernetes terraform', capabilities: caps(['devops']) });
    assertEq(three[0]?.priority, 'high', '(8) three matches → high');
    const four = selectSignaledSpecialists({ message: 'docker kubernetes terraform helm', capabilities: caps(['devops']) });
    assertEq(four[0]?.priority, 'high', '(8) four matches → still high');
  }

  // ── 9. Determinism, dedupe, and bounded output ─────────────────────────────
  {
    const a = selectSignaledSpecialists({ message: 'deploy the docker pipeline', capabilities: caps(['devops']) });
    const b = selectSignaledSpecialists({ message: 'deploy the docker pipeline', capabilities: caps(['devops']) });
    assertEq(JSON.stringify(a), JSON.stringify(b), '(9) deterministic across calls');
    // duplicate capability role → one signal
    const dup = selectSignaledSpecialists({ message: 'docker', capabilities: caps(['devops', 'devops', 'devops']) });
    assertEq(dup.length, 1, '(9) duplicate roles collapse to one signal');
    // matched is bounded at 12 even when many keywords are present
    const many = selectSignaledSpecialists({
      message: 'deploy deployment ci cd pipeline docker dockerfile kubernetes k8s infra infrastructure release rollback terraform ansible helm container staging production prod',
      capabilities: caps(['devops']),
    });
    assert((many[0]?.matched.length ?? 0) <= 12, '(9) matched length bounded to 12');
    assertEq(many[0]?.matched.length, 12, '(9) matched caps at exactly 12 when more present');
    assertEq(many[0]?.priority, 'high', '(9) capped-but-many still high');
  }

  // ── 10. Plugin / unknown roles fall back to their triggerPatterns ──────────
  {
    const growthCap = [{ role: 'growth', triggerPatterns: [/\b(seo|funnel|conversion|acquisition)\b/i] }];
    const sig = selectSignaledSpecialists({ message: 'improve our seo funnel and conversion rate', capabilities: growthCap });
    assertEq(sig.length, 1, '(10) plugin role signaled via its triggerPatterns');
    assertEq(sig[0]?.role, 'growth', '(10) role is growth');
    assertEq(sig[0]?.priority, 'high', '(10) seo/funnel/conversion → high');
    assert(sig[0]?.matched.includes('seo'), '(10) matched includes seo');
    // Unknown role with NO patterns → nothing (conservative).
    assertEq(selectSignaledSpecialists({ message: 'seo funnel conversion', capabilities: [{ role: 'growth' }] }).length, 0, '(10) unknown role without patterns → no signal');
  }

  // ── 11. rankSpecialistsByPriority: stable high → medium → low ───────────────
  {
    const items = [
      { priority: 'low' as const, id: 1 },
      { priority: 'high' as const, id: 2 },
      { priority: 'medium' as const, id: 3 },
      { priority: 'high' as const, id: 4 },
      { priority: 'low' as const, id: 5 },
      { priority: 'medium' as const, id: 6 },
    ];
    const ranked = rankSpecialistsByPriority(items);
    assertEq(ranked.map((r) => r.id).join(','), '2,4,3,6,1,5', '(11) stable high→medium→low ordering');
    // input not mutated
    assertEq(items.map((r) => r.id).join(','), '1,2,3,4,5,6', '(11) input array not mutated');
    // empty + single
    assertEq(rankSpecialistsByPriority([]).length, 0, '(11) empty → empty');
    assertEq(rankSpecialistsByPriority([{ priority: 'medium' as const }]).length, 1, '(11) single preserved');
    // all-same priority preserves order (stable)
    const same = rankSpecialistsByPriority([{ priority: 'high' as const, id: 'a' }, { priority: 'high' as const, id: 'b' }, { priority: 'high' as const, id: 'c' }]);
    assertEq(same.map((r) => r.id).join(','), 'a,b,c', '(11) equal priority order preserved');
  }

  // ── 12. rank on SubagentTaskSpec-like objects (high|medium only) ───────────
  {
    const specs = [
      { priority: 'medium' as const, subagent: { role: 'tester' } },
      { priority: 'high' as const, subagent: { role: 'coder' } },
      { priority: 'medium' as const, subagent: { role: 'reviewer' } },
      { priority: 'high' as const, subagent: { role: 'architect' } },
    ];
    const ranked = rankSpecialistsByPriority(specs);
    assertEq(ranked.map((s) => s.subagent.role).join(','), 'coder,architect,tester,reviewer', '(12) high specs float above medium, stable');
  }

  // ── 13. End-to-end shape: signals rank cleanly for the caller ──────────────
  {
    // "build a login form" style: architect/coder already selected by the switch;
    // security should surface as an additive signal and rank ahead of a low one.
    const signals = selectSignaledSpecialists({
      message: 'build the login form with secure password hashing and a figma layout',
      capabilities: ALL,
      alreadySelected: ['architect', 'coder', 'tester', 'reviewer'],
    });
    const roles = roleSet(signals);
    assert(roles.has('security'), '(13) security surfaces as additive signal');
    assert(roles.has('designer'), '(13) designer surfaces as additive signal');
    assert(!roles.has('coder'), '(13) already-selected coder excluded');
    const ranked = rankSpecialistsByPriority(signals);
    assert(ranked.length === signals.length, '(13) rank preserves count');
    // every ranked entry keeps a valid priority
    assert(ranked.every((s) => s.priority === 'high' || s.priority === 'medium' || s.priority === 'low'), '(13) priorities valid post-rank');
  }

  // ── 14. Degenerate / hostile input never throws (totality) ─────────────────
  try {
    // selectSignaledSpecialists with junk top-level input
    assertEq(selectSignaledSpecialists(null as any).length, 0, '(14) null input → []');
    assertEq(selectSignaledSpecialists(undefined as any).length, 0, '(14) undefined input → []');
    assertEq(selectSignaledSpecialists(42 as any).length, 0, '(14) number input → []');
    assertEq(selectSignaledSpecialists('nope' as any).length, 0, '(14) string input → []');
    assertEq(selectSignaledSpecialists([] as any).length, 0, '(14) array input → []');
    assertEq(selectSignaledSpecialists({} as any).length, 0, '(14) empty object → []');
    // junk capabilities
    assertEq(selectSignaledSpecialists({ message: 'docker', capabilities: null }).length, 0, '(14) null capabilities → []');
    assertEq(selectSignaledSpecialists({ message: 'docker', capabilities: 99 }).length, 0, '(14) number capabilities → []');
    assertEq(selectSignaledSpecialists({ message: 'docker', capabilities: 'devops' }).length, 0, '(14) string capabilities → []');
    // capabilities array full of junk, one valid
    const mixed = selectSignaledSpecialists({ message: 'docker', capabilities: [null, 42, 'x', {}, { role: '' }, { role: '   ' }, { role: 'devops' }] as any });
    assertEq(mixed.length, 1, '(14) junk capability elements skipped, valid one kept');
    assertEq(mixed[0]?.role, 'devops', '(14) surviving role is devops');
    // non-string message harvested (object / number)
    assertEq(selectSignaledSpecialists({ message: { deep: { note: 'ship the docker container' } }, capabilities: caps(['devops']) }).length, 1, '(14) nested object message harvested');
    assertEq(selectSignaledSpecialists({ message: 12345, capabilities: caps(['devops']) }).length, 0, '(14) numeric message → no keyword, no throw');
    // huge message stays bounded
    const huge = selectSignaledSpecialists({ message: 'docker '.repeat(20000), capabilities: caps(['devops']) });
    assertEq(huge.length, 1, '(14) huge message handled');
    assertEq(huge[0]?.matched.length, 1, '(14) huge repeated keyword deduped to 1');
    // cyclic task plan does not hang or throw
    const cyclic: any = { text: 'terraform kubernetes docker' };
    cyclic.self = cyclic;
    const cyc = selectSignaledSpecialists({ message: '', taskPlan: cyclic, capabilities: caps(['devops']) });
    assertEq(cyc.length, 1, '(14) cyclic taskPlan handled');
    assertEq(cyc[0]?.priority, 'high', '(14) cyclic taskPlan still matched keywords');
    // hostile alreadySelected shapes
    assertEq(selectSignaledSpecialists({ message: 'docker', capabilities: caps(['devops']), alreadySelected: 42 as any }).length, 1, '(14) numeric alreadySelected ignored');
    assertEq(selectSignaledSpecialists({ message: 'docker', capabilities: caps(['devops']), alreadySelected: 'devops' as any }).length, 1, '(14) bare-string alreadySelected does not throw');
    assert(Array.isArray(selectSignaledSpecialists({ message: 'docker', capabilities: caps(['devops']), alreadySelected: { role: 'devops' } as any })), '(14) object alreadySelected tolerated');
    // hostile triggerPatterns
    assert(Array.isArray(selectSignaledSpecialists({ message: 'x', capabilities: [{ role: 'plug', triggerPatterns: 'not-an-array' }] as any })), '(14) non-array triggerPatterns tolerated');
    assert(Array.isArray(selectSignaledSpecialists({ message: 'x', capabilities: [{ role: 'plug', triggerPatterns: [null, 42, {}] }] as any })), '(14) junk triggerPatterns entries tolerated');

    // rankSpecialistsByPriority with junk
    assertEq(rankSpecialistsByPriority(null as any).length, 0, '(14) rank(null) → []');
    assertEq(rankSpecialistsByPriority(undefined as any).length, 0, '(14) rank(undefined) → []');
    assertEq(rankSpecialistsByPriority(42 as any).length, 0, '(14) rank(number) → []');
    assertEq(rankSpecialistsByPriority('nope' as any).length, 0, '(14) rank(string) → []');
    // unknown priorities sort last, valid ones first, stable
    const weird = rankSpecialistsByPriority([{ priority: 'weird', id: 1 }, { priority: 'high', id: 2 }, { priority: 'low', id: 3 }, { id: 4 }, { priority: null, id: 5 }] as any);
    assertEq(weird.map((r: any) => r.id).join(','), '2,3,1,4,5', '(14) unknown/missing priorities sort last, valid ones ordered');
    // array of primitives (no priority) → all "other" bucket, order preserved
    assertEq(rankSpecialistsByPriority([1, 2, 3] as any).map((x: any) => x).join(','), '1,2,3', '(14) primitive items tolerated');
    assert(Array.isArray(rankSpecialistsByPriority([null, undefined] as any)), '(14) null/undefined items tolerated');

    passes += 1;
  } catch (e) {
    failures += 1;
    console.error('FAIL: (14) degenerate inputs threw :: ' + ((e as Error)?.message || String(e)));
  }

  if (failures > 0) {
    console.error('\n' + failures + ' failure(s), ' + passes + ' passed');
    process.exit(1);
  }
  console.log('\nAll specialist-selection-core smoke cases passed (' + passes + ' passed).');
}

main();
