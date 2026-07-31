/**
 * accountability-digest-core smoke.
 *
 * Pins buildAccountabilityDigest against hand-built fixtures shaped like the
 * real rows: proof_of_work agent_run rows (detail {verified, git_references,
 * run_id} written by agentRunProofPublisherCore), webhook-shape pr/commit rows
 * (detail.url / pr_number), agent_activity task_completed rows
 * (metadata.run_id), and kanban tasks (status/due_date/completed_at).
 * Covers: counts, unverified-completion detection through BOTH shapes,
 * PR counting across BOTH git-ref shapes with dedupe, window filtering by
 * nowMs, topAgents ordering/bound, runRows override, and totality.
 */

import {
  buildAccountabilityDigest,
  isEmptyAccountabilityDigest,
  type AccountabilityDigest,
} from '../src/lib/accountabilityDigestCore';

let passed = 0;
const failures: string[] = [];
function assert(cond: boolean, label: string) {
  if (cond) { passed++; console.log(`pass: ${label}`); }
  else { failures.push(label); console.error(`FAIL: ${label}`); }
}

// Fixed clock: 2026-07-31T12:00:00Z
const NOW = Date.parse('2026-07-31T12:00:00Z');
const iso = (daysAgo: number) => new Date(NOW - daysAgo * 86_400_000).toISOString();

function main() {
  // ─── 1. Full scenario: counts vs hand-built fixtures ───────────────────────
  {
    const d = buildAccountabilityDigest({
      nowMs: NOW,
      proofRows: [
        // verified agent run with a PR git_reference
        {
          id: 'p1', pow_type: 'agent_run', title: 'Arya completed: ship widget',
          agent_name: 'Arya', created_at: iso(1),
          detail: {
            verified: true, run_id: 'run-1',
            git_references: [
              { type: 'pull_request', url: 'https://github.com/o/r/pull/12', prNumber: 12, repo: 'o/r' },
              { type: 'commit', url: 'https://github.com/o/r/commit/abc', sha: 'abc' }, // NOT a PR
            ],
          },
        },
        // unverified agent run (shape 1 unverified completion)
        {
          id: 'p2', pow_type: 'agent_run', title: 'Tyrion completed: draft copy',
          agent_name: 'Tyrion', created_at: iso(2),
          detail: { verified: false, run_id: 'run-2', git_references: [] },
        },
        // webhook-shape PR row (detail.url)
        {
          id: 'p3', pow_type: 'pr', title: 'chris merged PR: fix', created_at: iso(3),
          detail: { url: 'https://github.com/o/r/pull/34', pr_number: 34, repo: 'o/r' },
        },
        // webhook commit row — never a PR
        {
          id: 'p4', pow_type: 'commit', title: 'chris pushed: wip', created_at: iso(3),
          detail: { url: 'https://github.com/o/r/commit/def', sha: 'def' },
        },
      ],
      activityRows: [
        // matches verified proof by run_id → NOT an unverified completion
        { id: 'a1', activity_type: 'task_completed', title: 'Arya completed: ship widget', created_at: iso(1), metadata: { run_id: 'run-1' } },
        // proof-less completion (shape 2) → +1 unverified
        { id: 'a2', activity_type: 'task_completed', title: 'Sandor completed: review', created_at: iso(2), metadata: { run_id: 'run-99' } },
        // failed task never counts as a completion
        { id: 'a3', activity_type: 'task_failed', title: 'Bran failed: analyze', created_at: iso(1), metadata: {} },
      ],
      taskRows: [
        { id: 't1', status: 'done', completed_at: iso(1), due_date: null },
        { id: 't2', status: 'done', completed_at: iso(2), due_date: iso(3) },
        { id: 't3', status: 'in_progress', completed_at: null, due_date: iso(1) },  // overdue
        { id: 't4', status: 'todo', completed_at: null, due_date: iso(-2) },        // due in future
      ],
    });
    assert(d.counts.runs === 2, 'runs = 2 agent_run proofs (no runRows)');
    assert(d.counts.verifiedRuns === 1, 'verifiedRuns = 1');
    // shape 1 (p2 unverified) + shape 2 (a2 proof-less) = 2
    assert(d.counts.unverifiedCompletions === 2, 'unverifiedCompletions = 2 (one per shape)');
    // PR refs: pull/12 (git_references) + pull/34 (webhook) — commits excluded
    assert(d.counts.prReferences === 2, 'prReferences = 2 (commits not counted)');
    assert(d.counts.tasksCompleted === 2, 'tasksCompleted = 2');
    assert(d.counts.tasksOverdue === 1, 'tasksOverdue = 1 (future due date excluded)');
    assert(d.windowLabel === 'Last 7 days', "windowLabel = 'Last 7 days'");
    assert(d.topAgents.length === 2, 'topAgents has both proof agents');
    assert(d.topAgents[0].runs === 1 && d.topAgents[1].runs === 1, 'topAgents run counts');
    assert(d.highlights.some((h) => h === '2 completions had no verification'), 'unverified highlight text');
    assert(d.highlights.some((h) => h === '1 of 2 runs verified'), 'verified-coverage highlight');
    assert(d.highlights.some((h) => h === '1 task overdue'), 'overdue highlight (singular)');
    assert(d.highlights.some((h) => h === '2 PR references linked'), 'PR highlight');
    assert(d.highlights.length <= 5, 'highlights bounded to 5');
    assert(isEmptyAccountabilityDigest(d) === false, 'non-empty digest is not empty');
  }

  // ─── 2. Unverified-completion detection, edge shapes ───────────────────────
  {
    // 2a. Activity matching an UNVERIFIED proof by run_id → no double count.
    const d = buildAccountabilityDigest({
      nowMs: NOW,
      proofRows: [{
        pow_type: 'agent_run', title: 'T', agent_name: 'A', created_at: iso(1),
        detail: { verified: false, run_id: 'run-x' },
      }],
      activityRows: [{ activity_type: 'task_completed', title: 'T', created_at: iso(1), metadata: { run_id: 'run-x' } }],
      taskRows: [],
    });
    assert(d.counts.unverifiedCompletions === 1, 'run_id-matched activity does not double-count');

    // 2b. No metadata → title fallback match against a verified proof.
    const d2 = buildAccountabilityDigest({
      nowMs: NOW,
      proofRows: [{
        pow_type: 'agent_run', title: 'Arya completed: deploy', agent_name: 'Arya', created_at: iso(1),
        detail: { verified: true, run_id: 'run-y' },
      }],
      activityRows: [{ activity_type: 'task_completed', title: 'Arya completed: deploy', created_at: iso(1) }],
      taskRows: [],
    });
    assert(d2.counts.unverifiedCompletions === 0, 'title-fallback match suppresses proof-less count');

    // 2c. Completely proof-less completion counts even with no metadata.
    const d3 = buildAccountabilityDigest({
      nowMs: NOW,
      proofRows: [],
      activityRows: [{ activity_type: 'task_completed', title: 'ghost completion', created_at: iso(1) }],
      taskRows: [],
    });
    assert(d3.counts.unverifiedCompletions === 1, 'proof-less completion detected with no metadata');
    assert(d3.counts.runs === 0 && d3.counts.verifiedRuns === 0, 'no proofs → zero runs');
    assert(d3.highlights[0] === '1 completion had no verification', 'singular highlight wording');
  }

  // ─── 3. PR counting: dedupe across both shapes ─────────────────────────────
  {
    const url = 'https://github.com/o/r/pull/7';
    const d = buildAccountabilityDigest({
      nowMs: NOW,
      proofRows: [
        { pow_type: 'agent_run', title: 'a', agent_name: 'A', created_at: iso(1),
          detail: { verified: true, git_references: [{ type: 'pull_request', url, prNumber: 7, repo: 'o/r' }] } },
        { pow_type: 'pr', title: 'merged', created_at: iso(1), detail: { url, pr_number: 7, repo: 'o/r' } },
        // URL-less prose ref → repo#number identity
        { pow_type: 'agent_run', title: 'b', agent_name: 'A', created_at: iso(1),
          detail: { verified: true, git_references: [{ type: 'pull_request', url: '', prNumber: 9, repo: 'o/r' }] } },
        // webhook PR with number but no url → repo#number identity
        { pow_type: 'pr', title: 'opened', created_at: iso(2), detail: { pr_number: 9, repo: 'o/r' } },
        // degenerate webhook PR row with neither url nor number → still counted once
        { id: 'raw-pr', pow_type: 'pr', title: 'weird', created_at: iso(2), detail: {} },
      ],
      activityRows: [],
      taskRows: [],
    });
    assert(d.counts.prReferences === 3, 'same PR via both shapes dedupes (7, 9, degenerate = 3)');
  }

  // ─── 4. Window filtering by nowMs ──────────────────────────────────────────
  {
    const d = buildAccountabilityDigest({
      nowMs: NOW,
      windowDays: 7,
      proofRows: [
        { pow_type: 'agent_run', title: 'in', agent_name: 'A', created_at: iso(6), detail: { verified: true } },
        { pow_type: 'agent_run', title: 'out-old', agent_name: 'A', created_at: iso(8), detail: { verified: true } },
        { pow_type: 'agent_run', title: 'out-future', agent_name: 'A', created_at: iso(-1), detail: { verified: true } },
        { pow_type: 'pr', title: 'old-pr', created_at: iso(30), detail: { url: 'https://github.com/o/r/pull/1' } },
        { pow_type: 'agent_run', title: 'no-date', agent_name: 'A', detail: { verified: true } },
      ],
      activityRows: [
        { activity_type: 'task_completed', title: 'stale', created_at: iso(9) },
      ],
      taskRows: [
        { status: 'done', completed_at: iso(10), due_date: null },  // outside window
        { status: 'done', completed_at: iso(2), due_date: null },   // inside
      ],
    });
    assert(d.counts.runs === 1, 'window keeps only the in-window run');
    assert(d.counts.verifiedRuns === 1, 'window filters verified count too');
    assert(d.counts.prReferences === 0, 'old PR outside window not counted');
    assert(d.counts.unverifiedCompletions === 0, 'stale activity outside window ignored');
    assert(d.counts.tasksCompleted === 1, 'completed_at window filter');

    // Narrower window drops the 6-day-old run.
    const d2 = buildAccountabilityDigest({
      nowMs: NOW, windowDays: 3,
      proofRows: [
        { pow_type: 'agent_run', title: 'in', agent_name: 'A', created_at: iso(6), detail: { verified: true } },
      ],
      activityRows: [], taskRows: [],
    });
    assert(d2.counts.runs === 0, 'windowDays=3 excludes 6-day-old run');
    assert(d2.windowLabel === 'Last 3 days', 'windowLabel follows windowDays');
  }

  // ─── 5. topAgents ordering and bound ───────────────────────────────────────
  {
    const proofRows = [
      ...['r1', 'r2', 'r3'].map((r) => ({ pow_type: 'agent_run', title: r, agent_name: 'Arya', created_at: iso(1), detail: { verified: true, run_id: r } })),
      ...['r4', 'r5'].map((r) => ({ pow_type: 'agent_run', title: r, agent_name: 'Bran', created_at: iso(1), detail: { verified: true, run_id: r } })),
      ...['r6', 'r7'].map((r) => ({ pow_type: 'agent_run', title: r, agent_name: 'Tyrion', created_at: iso(1), detail: { verified: true, run_id: r } })),
      { pow_type: 'agent_run', title: 'r8', agent_name: 'Varys', created_at: iso(1), detail: { verified: true, run_id: 'r8' } },
      { pow_type: 'agent_run', title: 'r9', agent_name: '', created_at: iso(1), detail: { verified: true, run_id: 'r9' } }, // nameless skipped
    ];
    const d = buildAccountabilityDigest({ nowMs: NOW, proofRows, activityRows: [], taskRows: [] });
    assert(d.topAgents.length === 3, 'topAgents bounded to 3 (4 named agents)');
    assert(d.topAgents[0].name === 'Arya' && d.topAgents[0].runs === 3, 'topAgents[0] = Arya (3)');
    assert(d.topAgents[1].name === 'Bran' && d.topAgents[1].runs === 2, 'tie at 2 → alphabetical: Bran before Tyrion');
    assert(d.topAgents[2].name === 'Tyrion' && d.topAgents[2].runs === 2, 'topAgents[2] = Tyrion (2)');
    assert(d.highlights.some((h) => h === 'Arya led with 3 runs'), 'top-agent highlight');
  }

  // ─── 6. runRows override ───────────────────────────────────────────────────
  {
    const d = buildAccountabilityDigest({
      nowMs: NOW,
      proofRows: [
        { pow_type: 'agent_run', title: 'p', agent_name: 'ProofAgent', created_at: iso(1), detail: { verified: true } },
      ],
      activityRows: [],
      taskRows: [],
      runRows: [
        { agent_name: 'RunAgent', status: 'completed', started_at: iso(1) },
        { agent_id: 'agent-2', status: 'completed', started_at: iso(2) },  // falls back to agent_id
        { agent_name: 'RunAgent', status: 'failed', created_at: iso(3) },  // created_at fallback
        { agent_name: 'Stale', status: 'completed', started_at: iso(10) }, // outside window
      ],
    });
    assert(d.counts.runs === 3, 'runRows own the runs count (window-filtered)');
    assert(d.topAgents[0].name === 'RunAgent' && d.topAgents[0].runs === 2, 'topAgents from runRows');
    assert(d.topAgents.some((a) => a.name === 'agent-2'), 'agent_id fallback name');
    assert(d.counts.verifiedRuns === 1, 'verifiedRuns still from proofs when runRows present');
  }

  // ─── 7. Totality: never throws, zeros on garbage ───────────────────────────
  {
    const zero = (d: AccountabilityDigest, label: string) => {
      assert(
        d.counts.runs === 0 && d.counts.verifiedRuns === 0 && d.counts.unverifiedCompletions === 0 &&
        d.counts.prReferences === 0 && d.counts.tasksCompleted === 0 && d.counts.tasksOverdue === 0 &&
        d.topAgents.length === 0 && d.highlights.length === 0,
        label,
      );
      assert(isEmptyAccountabilityDigest(d) === true, `${label} — reads as empty`);
    };
    zero(buildAccountabilityDigest(undefined), 'undefined input → zeros');
    zero(buildAccountabilityDigest(null), 'null input → zeros');
    zero(buildAccountabilityDigest({} as any), 'empty object → zeros');
    zero(buildAccountabilityDigest({ nowMs: NOW }), 'missing arrays → zeros');
    zero(
      buildAccountabilityDigest({
        nowMs: NOW,
        proofRows: [null, 42, 'x', { pow_type: 'agent_run', created_at: 'not-a-date', detail: 'nope' }] as any,
        activityRows: [{ activity_type: 'task_completed', created_at: null, metadata: 7 }] as any,
        taskRows: [{ status: 'done', completed_at: 'garbage', due_date: {} }] as any,
        runRows: 'not-an-array' as any,
      }),
      'malformed rows → zeros',
    );
    const dBadWindow = buildAccountabilityDigest({ nowMs: NOW, windowDays: -3 as any });
    assert(dBadWindow.windowLabel === 'Last 7 days', 'invalid windowDays → default 7');
    const dNaN = buildAccountabilityDigest({ nowMs: NaN, proofRows: [], activityRows: [], taskRows: [] });
    assert(typeof dNaN.windowLabel === 'string', 'NaN nowMs still total');
    const dBig = buildAccountabilityDigest({ nowMs: NOW, windowDays: 5000 });
    assert(dBig.windowLabel === 'Last 90 days', 'windowDays clamped to 90');
    const dOne = buildAccountabilityDigest({ nowMs: NOW, windowDays: 1 });
    assert(dOne.windowLabel === 'Last 1 day', 'singular day label');
    assert(isEmptyAccountabilityDigest(null) === true, 'isEmpty(null) = true');
    assert(isEmptyAccountabilityDigest({} as any) === true, 'isEmpty(malformed) = true');
  }

  // ─── Result ────────────────────────────────────────────────────────────────
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    console.error('FAILURES:\n' + failures.map((f) => `  - ${f}`).join('\n'));
    process.exit(1);
  }
}

main();
