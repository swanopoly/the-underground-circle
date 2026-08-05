/**
 * plan-mode-core-smoketest — exercises the PURE planModeCore module (Plan Mode /
 * Cursor-parity: editable structured plan → approve step-by-step → build from
 * plan). Imports the real module (dependency-free, tsx-loadable).
 *
 * Covers: createPlan id assignment + defaults + clamping; every PlanEdit op
 * (incl. invalid ids / bad payloads as no-ops); dependency-topological ordering;
 * a dependency CYCLE reported as blocked (must not hang); markdown round-trip
 * fidelity; summarizePlan counts.
 *
 * Run: npx tsx scripts/plan-mode-core-smoketest.ts
 */

import {
  createPlan,
  applyPlanEdit,
  selectBuildableSteps,
  renderPlanMarkdown,
  parsePlanMarkdown,
  summarizePlan,
  MAX_TEXT_LEN,
  type AgentPlan,
  type PlanStep,
} from '../src/lib/planModeCore';

let passes = 0;
let failures = 0;
function assert(condition: unknown, message: string, detail?: string): void {
  if (condition) { passes += 1; console.log('pass:', message); }
  else { failures += 1; console.error('FAIL:', `${message}${detail ? ` — ${detail}` : ''}`); }
}
function assertEqual<T>(actual: T, expected: T, message: string): void {
  assert(actual === expected, message, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const NOW = 1_700_000_000_000;

function main(): void {
  // ─── createPlan: id assignment + defaults ──────────────────────────────────
  {
    const plan = createPlan({
      title: 'Ship feature',
      goal: 'Land the thing',
      steps: [
        { title: 'first' } as Partial<PlanStep>,
        { id: 'custom-id', title: 'second', status: 'approved', risk: 'high' } as Partial<PlanStep>,
        { title: 'third', dependsOn: ['step-1', 'step-1', 'custom-id'] } as Partial<PlanStep>,
      ],
      questions: [{ question: 'which env?' } as any, { id: 'q-x', question: 'which repo?' } as any],
      risks: ['data loss', 'data loss', 'downtime'],
    }, NOW);

    assertEqual(plan.steps[0].id, 'step-1', 'createPlan assigns step-1 for a missing id (index-based, not random)');
    assertEqual(plan.steps[1].id, 'custom-id', 'createPlan keeps a caller-supplied step id');
    assertEqual(plan.steps[2].id, 'step-3', 'createPlan assigns step-3 by index even when earlier ids are custom');
    assertEqual(plan.steps[0].status, 'pending', 'createPlan defaults status to pending');
    assertEqual(plan.steps[0].risk, 'low', 'createPlan defaults risk to low');
    assertEqual(plan.steps[1].status, 'approved', 'createPlan preserves a valid status');
    assertEqual(plan.steps[1].risk, 'high', 'createPlan preserves a valid risk');
    assertEqual(plan.steps[2].dependsOn.length, 2, 'createPlan dedupes dependsOn');
    assert(plan.steps[2].dependsOn.includes('step-1') && plan.steps[2].dependsOn.includes('custom-id'), 'createPlan preserves distinct deps');
    assertEqual(plan.questions[0].id, 'question-1', 'createPlan assigns question-1 for a missing id');
    assertEqual(plan.questions[1].id, 'q-x', 'createPlan keeps a caller-supplied question id');
    assertEqual(plan.risks.length, 2, 'createPlan dedupes risks');
    assertEqual(plan.createdAt, NOW, 'createPlan records createdAt from now');
    assert(plan.id.length > 0, 'createPlan assigns a plan id');
  }

  // ─── createPlan: bad-input guards (never throws) ───────────────────────────
  {
    const p1 = createPlan(undefined as any, NOW);
    assertEqual(p1.steps.length, 0, 'createPlan(undefined) → empty steps, no throw');
    const p2 = createPlan({ title: 'x', goal: 'y', steps: 'nope' as any, risks: 42 as any }, NaN as any);
    assertEqual(p2.steps.length, 0, 'createPlan coerces non-array steps to []');
    assertEqual(p2.risks.length, 0, 'createPlan coerces non-array risks to []');
    assertEqual(p2.createdAt, 0, 'createPlan defaults non-finite now to 0');
    const longTitle = 'a'.repeat(MAX_TEXT_LEN + 500);
    const p3 = createPlan({ title: longTitle, goal: 'y' }, NOW);
    assertEqual(p3.title.length, MAX_TEXT_LEN, 'createPlan clamps title to MAX_TEXT_LEN');
    // Colliding explicit ids get a stable fallback (no dupes).
    const p4 = createPlan({ title: 't', goal: 'g', steps: [{ id: 'dup', title: 'a' }, { id: 'dup', title: 'b' }] as any }, NOW);
    assert(p4.steps[0].id !== p4.steps[1].id, 'createPlan resolves colliding explicit step ids to unique ids');
  }

  const base = createPlan({
    title: 'Base',
    goal: 'edit me',
    steps: [
      { id: 's1', title: 'one' },
      { id: 's2', title: 'two' },
      { id: 's3', title: 'three', dependsOn: ['s2'] },
    ] as Partial<PlanStep>[],
    questions: [{ id: 'q1', question: 'why?' }] as any,
  }, NOW);

  // ─── applyPlanEdit: setStepStatus ──────────────────────────────────────────
  {
    const next = applyPlanEdit(base, { op: 'setStepStatus', stepId: 's1', status: 'approved' });
    assertEqual(next.steps[0].status, 'approved', 'setStepStatus updates the target step');
    assertEqual(base.steps[0].status, 'pending', 'applyPlanEdit does not mutate the input plan');
    const noop = applyPlanEdit(base, { op: 'setStepStatus', stepId: 'nope', status: 'done' });
    assertEqual(noop.steps.filter((s) => s.status === 'done').length, 0, 'setStepStatus on a missing id is a no-op');
    const badStatus = applyPlanEdit(base, { op: 'setStepStatus', stepId: 's1', status: 'bogus' as any });
    assertEqual(badStatus.steps[0].status, 'pending', 'setStepStatus with an invalid status is a no-op');
  }

  // ─── applyPlanEdit: editStep ───────────────────────────────────────────────
  {
    const next = applyPlanEdit(base, { op: 'editStep', stepId: 's2', patch: { title: 'TWO!', risk: 'medium', files: ['a.ts', 'a.ts', 'b.ts'] } });
    assertEqual(next.steps[1].title, 'TWO!', 'editStep updates title');
    assertEqual(next.steps[1].risk, 'medium', 'editStep updates risk');
    assertEqual(next.steps[1].files.length, 2, 'editStep normalizes/dedupes files');
    const badRisk = applyPlanEdit(base, { op: 'editStep', stepId: 's2', patch: { risk: 'nuclear' as any } });
    assertEqual(badRisk.steps[1].risk, 'low', 'editStep ignores an invalid risk value');
    const noop = applyPlanEdit(base, { op: 'editStep', stepId: 'ghost', patch: { title: 'x' } });
    assertEqual(noop.steps.length, base.steps.length, 'editStep on a missing id is a no-op');
    const clearDetail = applyPlanEdit(base, { op: 'editStep', stepId: 's1', patch: { detail: undefined } });
    assertEqual(clearDetail.steps[0].detail, undefined, 'editStep can clear detail to undefined');
  }

  // ─── applyPlanEdit: addStep ────────────────────────────────────────────────
  {
    const next = applyPlanEdit(base, { op: 'addStep', step: { title: 'four', risk: 'high' } });
    assertEqual(next.steps.length, base.steps.length + 1, 'addStep appends a step');
    assertEqual(next.steps[next.steps.length - 1].id, 'step-4', 'addStep assigns a deterministic next id (step-4)');
    assertEqual(next.steps[next.steps.length - 1].status, 'pending', 'addStep defaults status to pending');
    const noTitle = applyPlanEdit(base, { op: 'addStep', step: { title: '   ' } as any });
    assertEqual(noTitle.steps.length, base.steps.length, 'addStep with an empty title is a no-op');
    // addStep id collision avoidance.
    const collide = applyPlanEdit(base, { op: 'addStep', step: { id: 's1', title: 'dup try' } });
    assert(!collide.steps.slice(0, base.steps.length).some((_, i) => collide.steps[i].id === collide.steps[collide.steps.length - 1].id) && collide.steps[collide.steps.length - 1].id !== 's1', 'addStep avoids colliding with an existing id');
  }

  // ─── applyPlanEdit: removeStep (and dangling-dep cleanup) ──────────────────
  {
    const next = applyPlanEdit(base, { op: 'removeStep', stepId: 's2' });
    assertEqual(next.steps.length, base.steps.length - 1, 'removeStep drops the step');
    const s3 = next.steps.find((s) => s.id === 's3')!;
    assertEqual(s3.dependsOn.includes('s2'), false, 'removeStep prunes dangling deps to the removed step');
    const noop = applyPlanEdit(base, { op: 'removeStep', stepId: 'ghost' });
    assertEqual(noop.steps.length, base.steps.length, 'removeStep on a missing id is a no-op');
  }

  // ─── applyPlanEdit: answerQuestion ─────────────────────────────────────────
  {
    const next = applyPlanEdit(base, { op: 'answerQuestion', questionId: 'q1', answer: 'because' });
    assertEqual(next.questions[0].answer, 'because', 'answerQuestion sets the answer');
    const noop = applyPlanEdit(base, { op: 'answerQuestion', questionId: 'ghost', answer: 'x' });
    assertEqual(noop.questions[0].answer, undefined, 'answerQuestion on a missing id is a no-op');
  }

  // ─── applyPlanEdit: reorderSteps ───────────────────────────────────────────
  {
    const next = applyPlanEdit(base, { op: 'reorderSteps', orderedIds: ['s3', 's1'] });
    assertEqual(next.steps.map((s) => s.id).join(','), 's3,s1,s2', 'reorderSteps honors given order, appends the rest');
    const partial = applyPlanEdit(base, { op: 'reorderSteps', orderedIds: ['s2', 'ghost', 's2'] });
    assertEqual(partial.steps.map((s) => s.id).join(','), 's2,s1,s3', 'reorderSteps ignores unknown/duplicate ids');
    const empty = applyPlanEdit(base, { op: 'reorderSteps', orderedIds: [] });
    assertEqual(empty.steps.map((s) => s.id).join(','), 's1,s2,s3', 'reorderSteps with [] preserves original order');
  }

  // ─── applyPlanEdit: unknown / malformed op ─────────────────────────────────
  {
    const noop1 = applyPlanEdit(base, { op: 'explode' as any });
    assertEqual(noop1.steps.length, base.steps.length, 'unknown op is a no-op');
    const noop2 = applyPlanEdit(base, undefined as any);
    assertEqual(noop2.steps.length, base.steps.length, 'undefined edit is a no-op');
    const noop3 = applyPlanEdit(base, {} as any);
    assertEqual(noop3.steps.length, base.steps.length, 'edit with no op field is a no-op');
  }

  // ─── selectBuildableSteps: topological ordering ────────────────────────────
  {
    // Approve out of dependency order; expect topo order in the result.
    let p: AgentPlan = createPlan({
      title: 'Topo', goal: 'order',
      steps: [
        { id: 'a', title: 'a' },
        { id: 'b', title: 'b', dependsOn: ['a'] },
        { id: 'c', title: 'c', dependsOn: ['b'] },
      ] as Partial<PlanStep>[],
    }, NOW);
    p = applyPlanEdit(p, { op: 'setStepStatus', stepId: 'c', status: 'approved' });
    p = applyPlanEdit(p, { op: 'setStepStatus', stepId: 'b', status: 'approved' });
    p = applyPlanEdit(p, { op: 'setStepStatus', stepId: 'a', status: 'approved' });
    const sel = selectBuildableSteps(p);
    assertEqual(sel.steps.map((s) => s.id).join(','), 'a,b,c', 'selectBuildableSteps returns approved steps in topo order');
    assertEqual(sel.blocked.length, 0, 'selectBuildableSteps: fully-approved chain has no blockers');

    // A dep that is 'done' (outside the approved set) satisfies the requirement.
    let p2 = createPlan({
      title: 'DoneDep', goal: 'x',
      steps: [{ id: 'x', title: 'x' }, { id: 'y', title: 'y', dependsOn: ['x'] }] as Partial<PlanStep>[],
    }, NOW);
    p2 = applyPlanEdit(p2, { op: 'setStepStatus', stepId: 'x', status: 'done' });
    p2 = applyPlanEdit(p2, { op: 'setStepStatus', stepId: 'y', status: 'approved' });
    const sel2 = selectBuildableSteps(p2);
    assertEqual(sel2.steps.map((s) => s.id).join(','), 'y', 'a done dependency satisfies an approved step');
    assertEqual(sel2.blocked.length, 0, 'done-dependency case has no blockers');
  }

  // ─── selectBuildableSteps: blocked reasons (missing / rejected / pending) ──
  {
    let p = createPlan({
      title: 'Blocked', goal: 'x',
      steps: [
        { id: 'a', title: 'a', status: 'rejected' },
        { id: 'b', title: 'b', dependsOn: ['a'] },       // dep rejected
        { id: 'c', title: 'c', dependsOn: ['ghost'] },   // dep missing
        { id: 'd', title: 'd', dependsOn: ['e'] },       // dep pending (not approved/done)
        { id: 'e', title: 'e' },                          // pending
      ] as Partial<PlanStep>[],
    }, NOW);
    p = applyPlanEdit(p, { op: 'setStepStatus', stepId: 'b', status: 'approved' });
    p = applyPlanEdit(p, { op: 'setStepStatus', stepId: 'c', status: 'approved' });
    p = applyPlanEdit(p, { op: 'setStepStatus', stepId: 'd', status: 'approved' });
    const sel = selectBuildableSteps(p);
    assertEqual(sel.steps.length, 0, 'no step is buildable when all deps are unsatisfiable');
    const reason = (id: string) => sel.blocked.find((x) => x.id === id)?.reason ?? '';
    assert(/rejected/.test(reason('b')), 'blocked reason cites a rejected dependency', reason('b'));
    assert(/missing/.test(reason('c')), 'blocked reason cites a missing dependency', reason('c'));
    assert(/not approved/.test(reason('d')), 'blocked reason cites a not-approved dependency', reason('d'));
  }

  // ─── selectBuildableSteps: dependency CYCLE (must not hang) ────────────────
  {
    let p = createPlan({
      title: 'Cycle', goal: 'x',
      steps: [
        { id: 'a', title: 'a', dependsOn: ['c'] },
        { id: 'b', title: 'b', dependsOn: ['a'] },
        { id: 'c', title: 'c', dependsOn: ['b'] },
        { id: 'z', title: 'z' }, // independent, approved → still buildable
      ] as Partial<PlanStep>[],
    }, NOW);
    for (const id of ['a', 'b', 'c', 'z']) p = applyPlanEdit(p, { op: 'setStepStatus', stepId: id, status: 'approved' });
    const sel = selectBuildableSteps(p);
    assertEqual(sel.steps.map((s) => s.id).join(','), 'z', 'a cyclic component is excluded; independent approved step still builds');
    for (const id of ['a', 'b', 'c']) {
      assertEqual(sel.blocked.find((x) => x.id === id)?.reason, 'dependency cycle', `cycle member ${id} blocked with 'dependency cycle'`);
    }
    // Self-cycle is also caught.
    let sp = createPlan({ title: 'Self', goal: 'x', steps: [{ id: 's', title: 's', dependsOn: ['s'] }] as Partial<PlanStep>[] }, NOW);
    sp = applyPlanEdit(sp, { op: 'setStepStatus', stepId: 's', status: 'approved' });
    const selfSel = selectBuildableSteps(sp);
    assertEqual(selfSel.blocked.find((x) => x.id === 's')?.reason, 'dependency cycle', 'a self-dependency is reported as a cycle (no hang)');
  }

  // ─── markdown round-trip fidelity ──────────────────────────────────────────
  {
    const rich = createPlan({
      title: 'Round Trip',
      goal: 'preserve everything',
      steps: [
        { id: 's1', title: 'Setup', status: 'approved', risk: 'medium', files: ['a.ts', 'b.ts'], detail: 'do setup' },
        { id: 's2', title: 'Build', status: 'done', risk: 'high', dependsOn: ['s1'] },
        { id: 's3', title: 'Verify', status: 'pending', risk: 'low' },
      ] as Partial<PlanStep>[],
      questions: [{ id: 'q1', question: 'ready?', answer: 'yes' }, { id: 'q2', question: 'env?' }] as any,
      risks: ['prod outage', 'data drift'],
    }, NOW);

    const md = renderPlanMarkdown(rich);
    const back = parsePlanMarkdown(md);

    assertEqual(back.title, rich.title, 'round-trip preserves title');
    assertEqual(back.goal, rich.goal, 'round-trip preserves goal');
    assertEqual(back.steps.length, 3, 'round-trip preserves step count');
    assertEqual(back.steps.map((s) => s.id).join(','), 's1,s2,s3', 'round-trip preserves step ids + order');
    assertEqual(back.steps.map((s) => s.status).join(','), 'approved,done,pending', 'round-trip preserves step statuses');
    assertEqual(back.steps.map((s) => s.risk).join(','), 'medium,high,low', 'round-trip preserves step risks');
    assertEqual(back.steps.map((s) => s.title).join('|'), 'Setup|Build|Verify', 'round-trip preserves step titles');
    assertEqual(back.steps[0].files.join(','), 'a.ts,b.ts', 'round-trip preserves files');
    assertEqual(back.steps[0].detail, 'do setup', 'round-trip preserves detail');
    assertEqual(back.steps[1].dependsOn.join(','), 's1', 'round-trip preserves dependsOn');
    assertEqual(back.questions.length, 2, 'round-trip preserves question count');
    assertEqual(back.questions[0].answer, 'yes', 'round-trip preserves a question answer');
    assertEqual(back.questions[1].answer, undefined, 'round-trip keeps an unanswered question unanswered');
    assertEqual(back.risks.join('|'), 'prod outage|data drift', 'round-trip preserves risks');

    // Idempotent: render→parse→render is stable.
    assertEqual(renderPlanMarkdown(back), md, 'render(parse(render(p))) is stable (idempotent)');

    // Empty plan round-trips cleanly.
    const emptyMd = renderPlanMarkdown(createPlan({ title: 'Empty', goal: '' }, NOW));
    const emptyBack = parsePlanMarkdown(emptyMd);
    assertEqual(emptyBack.steps.length, 0, 'empty plan round-trips to zero steps (the "(none)" placeholder is not parsed as a step)');
    assertEqual(emptyBack.title, 'Empty', 'empty plan round-trips its title');
  }

  // ─── parsePlanMarkdown: bad input never throws ─────────────────────────────
  {
    assertEqual(parsePlanMarkdown(undefined).steps.length, 0, 'parsePlanMarkdown(undefined) → empty plan, no throw');
    assertEqual(parsePlanMarkdown('total garbage \n not markdown').steps.length, 0, 'parsePlanMarkdown(garbage) → no steps, no throw');
  }

  // ─── summarizePlan: counts ─────────────────────────────────────────────────
  {
    let p = createPlan({
      title: 'Summary', goal: 'x',
      steps: [
        { id: 'a', title: 'a', status: 'done' },
        { id: 'b', title: 'b', status: 'approved' },
        { id: 'c', title: 'c', status: 'approved', dependsOn: ['rejectedDep'] }, // blocked
        { id: 'rejectedDep', title: 'r', status: 'rejected' },
        { id: 'e', title: 'e', status: 'pending' },
      ] as Partial<PlanStep>[],
      questions: [{ id: 'q1', question: 'open?' }, { id: 'q2', question: 'answered?', answer: 'yes' }] as any,
    }, NOW);
    const summary = summarizePlan(p);
    // approvedOrDone = a(done)+b+c = 3 of 5; done = 1; blocked = c (dep rejected).
    assert(summary.startsWith('3/5 approved'), 'summarizePlan counts approved+done as approved', summary);
    assert(summary.includes('1 done'), 'summarizePlan counts done', summary);
    assert(summary.includes('1 blocked'), 'summarizePlan counts blocked', summary);
    assert(summary.includes('1 open question'), 'summarizePlan counts open (unanswered) questions', summary);

    const emptySummary = summarizePlan(createPlan({ title: 'z', goal: '' }, NOW));
    assertEqual(emptySummary, '0/0 approved · 0 done · 0 blocked', 'summarizePlan handles an empty plan');
    assertEqual(summarizePlan(undefined), '0/0 approved · 0 done · 0 blocked', 'summarizePlan(undefined) does not throw');
  }

  // ─── Final tally ───────────────────────────────────────────────────────────
  console.log(`\nplan-mode-core smoke: ${passes} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}

main();
