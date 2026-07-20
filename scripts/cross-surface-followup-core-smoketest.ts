/**
 * cross-surface-followup-core-smoketest — the PURE producer
 * (src/lib/crossSurfaceFollowupCore.ts) that turns a FINALIZED turn's structural
 * outcome (verdict + produced proof/artifacts/git-refs + in-scope
 * mission/room/task/run) into a ranked, deduped, bounded set of cross-surface
 * follow-up actions. Load-bearing assertions:
 *
 *   deriveCrossSurfaceFollowups(input?, opts?): CrossSurfaceFollowupResult
 *     followups[] ranked by score desc (tiebroken by a frozen KIND_ORDER),
 *     deduped by kind, sliced to min(opts.maxFollowups ?? MAX_FOLLOWUPS, 4). Each
 *     carries an EntityHandle {kind,id,surface} that round-trips through
 *     encodeEntityHandle → decodeEntityHandle, or a real `/task new` seedCommand.
 *       - attach_proof_to_mission (100) fires on completed/partial + any proof +
 *         a mission; it suppresses open_mission (the goal-update fallback).
 *       - request_approval (95) fires on a blocked verdict / approvalPending.
 *       - link_pr_to_task (92) fires on a PR/commit ref + a source task; label
 *         is public-only ('#123' / short-sha).
 *       - create_feed_task (85) is the untracked-work safety-net (no source task).
 *       - retry_run (70) fires on failed/partial + a retry/recovery affordance and
 *         suppresses open_run.
 *       - open_room (55) / open_run (50) surface the in-scope entities.
 *
 *   describeFollowupForAnalytics(f): compact PII-free 'kind|surface|reason'.
 *
 *   And: every export is TOTAL — null/undefined/number/{}/[]-as-input, cyclic
 *   input, a throwing-proxy opts, secret-value-shaped actionLabel, an unsafe
 *   entity id, control/line-sep/fence chars, and huge/junk arrays ⇒ a valid
 *   bounded CrossSurfaceFollowupResult, never a throw, never a leaked secret.
 *
 * Pure — loads under tsx (the core imports only `import type` from three
 * zero-import siblings). The smoke also imports entityHandleCore's runtime
 * encode/decode to prove the handle contract end-to-end.
 */

import {
  deriveCrossSurfaceFollowups,
  describeFollowupForAnalytics,
  MAX_FOLLOWUPS,
  MAX_LABEL_LEN,
  MAX_HINT_LEN,
  MAX_TITLE_LEN,
  MAX_SEED_LEN,
  type CrossSurfaceFollowupInput,
  type CrossSurfaceFollowupResult,
  type CrossSurfaceFollowup,
  type FollowupActionKind,
} from '../src/lib/crossSurfaceFollowupCore';
import { encodeEntityHandle, decodeEntityHandle } from '../src/lib/entityHandleCore';
import { deriveOutcomeVerdict } from '../src/lib/chatOutcomeSignals';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}
function assertJson(a: unknown, b: unknown, msg: string): void {
  assert(JSON.stringify(a) === JSON.stringify(b), msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

// ── vocab (validation source of truth, local to the smoke) ───────────────────
const FOLLOWUP_KINDS: FollowupActionKind[] = [
  'attach_proof_to_mission', 'link_pr_to_task', 'create_feed_task', 'open_mission',
  'open_room', 'open_run', 'retry_run', 'request_approval',
];
const FOLLOWUP_REASONS = [
  'completed_with_proof', 'produced_untracked_work', 'git_ref_and_source_task',
  'decision_touches_mission', 'context_room_in_scope', 'context_run_in_scope',
  'failed_recoverable', 'blocked_on_approval',
];
const SURFACES = ['chat', 'office', 'feed', 'rooms'];
// Detect any control / DEL / C1 / fence char (regex literal, no raw bytes) OR the
// two Unicode line separators (built via fromCharCode so no raw bytes in source).
const LINE_SEP = String.fromCharCode(0x2028, 0x2029);
function hasUnsafeChars(s: string): boolean {
  if (/[\x00-\x1f\x7f-\x9f`<>]/.test(s)) return true;
  return s.indexOf(LINE_SEP[0]) >= 0 || s.indexOf(LINE_SEP[1]) >= 0;
}

// ── call wrapper (keeps hostile fixtures cast-free at the call sites) ─────────
function d(input?: unknown, opts?: unknown): CrossSurfaceFollowupResult {
  return deriveCrossSurfaceFollowups(
    input as CrossSurfaceFollowupInput | null,
    opts as { maxFollowups?: number } | undefined,
  );
}

// ── helpers ──────────────────────────────────────────────────────────────────
function find(r: CrossSurfaceFollowupResult, kind: FollowupActionKind): CrossSurfaceFollowup | undefined {
  return r.followups.find((f) => f.kind === kind);
}
function has(r: CrossSurfaceFollowupResult, kind: FollowupActionKind): boolean {
  return !!find(r, kind);
}
function kindsOf(r: CrossSurfaceFollowupResult): string[] {
  return r.followups.map((f) => f.kind);
}

/** Structural invariants any single follow-up must satisfy. */
function followupIsValid(f: unknown): boolean {
  if (!f || typeof f !== 'object') return false;
  const ff = f as CrossSurfaceFollowup;
  if (!FOLLOWUP_KINDS.includes(ff.kind)) return false;
  if (!SURFACES.includes(ff.surface)) return false;
  if (typeof ff.label !== 'string' || ff.label.length === 0 || ff.label.length > MAX_LABEL_LEN) return false;
  if (typeof ff.hint !== 'string' || ff.hint.length === 0 || ff.hint.length > MAX_HINT_LEN) return false;
  if (!(ff.handle === null || (!!ff.handle && typeof ff.handle === 'object' && typeof ff.handle.id === 'string'))) return false;
  if (ff.handle && encodeEntityHandle(ff.handle).length === 0) return false; // must round-trip
  if (!(ff.seedCommand === null || (typeof ff.seedCommand === 'string' && ff.seedCommand.length > 0 && ff.seedCommand.length <= MAX_SEED_LEN))) return false;
  if (typeof ff.score !== 'number' || !Number.isFinite(ff.score)) return false;
  if (!FOLLOWUP_REASONS.includes(ff.reason)) return false;
  // no control / line-sep / fence chars leaked into user-visible strings
  if (hasUnsafeChars(ff.label)) return false;
  if (ff.seedCommand && hasUnsafeChars(ff.seedCommand)) return false;
  if (hasUnsafeChars(ff.hint)) return false;
  return true;
}
function resultIsValid(r: unknown): r is CrossSurfaceFollowupResult {
  if (!r || typeof r !== 'object') return false;
  const rr = r as CrossSurfaceFollowupResult;
  if (!Array.isArray(rr.followups)) return false;
  if (rr.followups.length > MAX_FOLLOWUPS) return false;
  if (typeof rr.line !== 'string') return false;
  if (rr.line.length > 240) return false;
  // scores must be non-increasing (sorted desc) and kinds unique
  const seen = new Set<string>();
  for (let i = 0; i < rr.followups.length; i += 1) {
    const f = rr.followups[i];
    if (!followupIsValid(f)) return false;
    if (seen.has(f.kind)) return false;
    seen.add(f.kind);
    if (i > 0 && rr.followups[i].score > rr.followups[i - 1].score) return false;
  }
  return true;
}
function totalOn(input: unknown, opts?: unknown): boolean {
  try {
    return resultIsValid(d(input, opts));
  } catch {
    return false;
  }
}

function main(): void {
  // ─── (A) attach_proof_to_mission — THE accountability action ────────────────
  {
    const r = d({ verdict: 'completed', proofCount: 2, contextMission: { kind: 'mission', id: 'msn_acme01', title: 'Acme redesign' } });
    const t = r.followups[0];
    assert(!!t, '(A) got a top follow-up');
    assertEq(t?.kind, 'attach_proof_to_mission', '(A) top kind is attach_proof_to_mission');
    assertEq(t?.surface, 'feed', '(A) surface feed');
    assertEq(t?.score, 100, '(A) score 100');
    assertEq(t?.reason, 'completed_with_proof', '(A) reason');
    assertEq(t?.seedCommand, null, '(A) no seed command');
    assert(!!t?.handle, '(A) has a handle');
    assertEq(t?.handle?.kind, 'mission', '(A) handle kind mission');
    assertEq(t?.handle?.id, 'msn_acme01', '(A) handle id');
    assertEq(t?.handle?.surface, 'feed', '(A) handle surface feed');
    assertEq(encodeEntityHandle(t!.handle!), 'feed:mission:msn_acme01', '(A) handle encodes canonically');
    assert(!!decodeEntityHandle(encodeEntityHandle(t!.handle!)), '(A) handle decodes back');
    assert(t!.label.includes('Acme redesign'), '(A) label names the mission', t?.label);
    assert(t!.label.length <= MAX_LABEL_LEN, '(A) label clamped');
    assert(t!.hint.length <= MAX_HINT_LEN, '(A) hint clamped');
    assert(r.line.length > 0 && r.line.includes(t!.label), '(A) line summarizes and includes the label', r.line);
    assert(resultIsValid(r), '(A) result structurally valid');
  }
  // attach also fires on 'partial' and on each proof kind individually
  {
    const partial = d({ verdict: 'partial', hasBrowserProof: true, contextMission: { kind: 'mission', id: 'm1', title: 'M' } });
    assert(has(partial, 'attach_proof_to_mission'), '(A) attach fires on partial + browser proof');
    const byArtifact = d({ verdict: 'completed', artifactCount: 3, contextMission: { kind: 'mission', id: 'm2', title: 'M' } });
    assert(has(byArtifact, 'attach_proof_to_mission'), '(A) attach fires on artifactCount alone');
    const byGit = d({ verdict: 'completed', gitReferences: [{ type: 'commit', url: '', sha: 'aaaaaaa' }], contextMission: { kind: 'mission', id: 'm3', title: 'M' } });
    assert(has(byGit, 'attach_proof_to_mission'), '(A) attach fires on a git ref alone');
    const noProof = d({ verdict: 'completed', contextMission: { kind: 'mission', id: 'm4', title: 'M' } });
    assert(!has(noProof, 'attach_proof_to_mission'), '(A) attach does NOT fire without any proof');
    assert(has(noProof, 'open_mission'), '(A) no-proof completed turn falls back to open_mission');
  }

  // ─── (B) create_feed_task — untracked-work safety-net ───────────────────────
  {
    const r = d({ verdict: 'completed', artifactCount: 1, actionLabel: 'Redesign the homepage hero' });
    const c = find(r, 'create_feed_task');
    assert(!!c, '(B) create_feed_task present for produced work with no source task');
    assertEq(c?.surface, 'feed', '(B) surface feed');
    assertEq(c?.score, 85, '(B) score 85');
    assertEq(c?.reason, 'produced_untracked_work', '(B) reason');
    assertEq(c?.handle, null, '(B) create carries no handle');
    assert(!!c?.seedCommand && c.seedCommand.startsWith('/task new'), '(B) seedCommand is a real /task new command', c?.seedCommand ?? '');
    assert(c!.seedCommand!.includes('Redesign the homepage hero'), '(B) seed carries the action label', c?.seedCommand ?? '');
    assert(c!.seedCommand!.length <= MAX_SEED_LEN, '(B) seed clamped');
    assert(c!.label.includes('Redesign'), '(B) label mentions the action', c?.label);
    assert(!has(r, 'attach_proof_to_mission'), '(B) no mission → no attach');
  }
  {
    // suppressed when alreadyTracked or a source task exists
    const tracked = d({ verdict: 'completed', artifactCount: 1, alreadyTracked: true });
    assert(!has(tracked, 'create_feed_task'), '(B) alreadyTracked suppresses create');
    const withTask = d({ verdict: 'completed', artifactCount: 1, contextTask: { kind: 'task', id: 'task_z', title: 'Z' } });
    assert(!has(withTask, 'create_feed_task'), '(B) an in-scope source task suppresses create');
    // proofCount alone does NOT count as "produced work" for create (only attach)
    const proofOnly = d({ verdict: 'completed', proofCount: 5 });
    assert(!has(proofOnly, 'create_feed_task'), '(B) proofCount alone does not trigger create');
    // seed with no action label is still the bare command
    const bare = d({ verdict: 'completed', artifactCount: 1 });
    assertEq(find(bare, 'create_feed_task')?.seedCommand, '/task new', '(B) bare seed when no action label');
  }

  // ─── (C) link_pr_to_task — public label + source task ───────────────────────
  {
    const r = d({
      verdict: 'completed',
      gitReferences: [{ type: 'pull_request', url: 'https://github.com/acme/web/pull/123', prNumber: 123, repo: 'acme/web' }],
      contextTask: { kind: 'task', id: 'task_login9', title: 'Fix login redirect' },
    });
    const l = find(r, 'link_pr_to_task');
    assert(!!l, '(C) link_pr_to_task present');
    assertEq(l?.surface, 'feed', '(C) surface feed');
    assertEq(l?.score, 92, '(C) score 92');
    assertEq(l?.reason, 'git_ref_and_source_task', '(C) reason');
    assert(l!.label.includes('#123'), '(C) label mentions the PR number', l?.label);
    assertEq(l?.handle?.kind, 'task', '(C) handle kind task');
    assertEq(l?.handle?.id, 'task_login9', '(C) handle id');
    assertEq(encodeEntityHandle(l!.handle!), 'feed:task:task_login9', '(C) handle encodes');
    assert(!has(r, 'create_feed_task'), '(C) a source task suppresses create_feed_task');
  }
  {
    // commit ref → short-sha (7) label
    const r = d({
      verdict: 'partial',
      gitReferences: [{ type: 'commit', url: '', sha: 'abcdef1234567890', repo: 'acme/web' }],
      contextTask: { kind: 'task', id: 'task_c2', title: 'T' },
    });
    const l = find(r, 'link_pr_to_task');
    assert(!!l, '(C) link fires for a commit ref');
    assert(l!.label.includes('abcdef1'), '(C) commit label uses the 7-char short sha', l?.label);
    assert(!l!.label.includes('abcdef12'), '(C) sha is sliced to 7 (no 8th char)', l?.label);
  }
  {
    // a git ref WITHOUT a source task → no link (but create can still fire)
    const r = d({ verdict: 'completed', gitReferences: [{ type: 'pull_request', url: '', prNumber: 9 }] });
    assert(!has(r, 'link_pr_to_task'), '(C) no source task → no link');
    assert(has(r, 'create_feed_task'), '(C) git ref counts as produced work → create fires');
  }

  // ─── (D) retry_run + verdict gate ───────────────────────────────────────────
  {
    const r = d({ verdict: 'failed', canRetry: true });
    const rt = find(r, 'retry_run');
    assert(!!rt, '(D) retry_run present on failed + canRetry');
    assertEq(rt?.surface, 'chat', '(D) retry surface chat without a run');
    assertEq(rt?.handle, null, '(D) retry handle null without a run');
    assertEq(rt?.reason, 'failed_recoverable', '(D) reason');
    assert(!has(r, 'attach_proof_to_mission'), '(D) failed verdict → no attach');
    assert(!has(r, 'create_feed_task'), '(D) failed verdict → no create');
    assert(!has(r, 'link_pr_to_task'), '(D) no git/task → no link');
    assert(!has(r, 'open_mission'), '(D) failed verdict → no open_mission');
  }
  {
    const r = d({ verdict: 'failed', canRetry: true, contextRun: { kind: 'run', id: 'run_x1' } });
    const rt = find(r, 'retry_run');
    assertEq(rt?.surface, 'office', '(D) retry surface office with a run');
    assertEq(rt?.handle?.id, 'run_x1', '(D) retry targets the in-scope run');
    assert(!has(r, 'open_run'), '(D) retry_run suppresses open_run for the same run');
  }
  {
    const r = d({ verdict: 'partial', hasRecoveryOptions: true });
    assert(has(r, 'retry_run'), '(D) retry fires on partial + hasRecoveryOptions');
    const noAff = d({ verdict: 'failed' });
    assert(!has(noAff, 'retry_run'), '(D) failed WITHOUT canRetry/recovery → no retry');
  }

  // ─── (E) request_approval ───────────────────────────────────────────────────
  {
    const r = d({ verdict: 'blocked' });
    const a = find(r, 'request_approval');
    assert(!!a, '(E) request_approval present on blocked verdict');
    assertEq(a?.surface, 'office', '(E) surface office');
    assertEq(a?.score, 95, '(E) score 95');
    assertEq(a?.reason, 'blocked_on_approval', '(E) reason');
    assertEq(a?.handle, null, '(E) handle null without a run');
  }
  {
    const r = d({ verdict: 'completed', approvalPending: true, contextRun: { kind: 'run', id: 'run_ap' } });
    const a = find(r, 'request_approval');
    assert(!!a, '(E) request_approval fires on approvalPending even when completed');
    assertEq(a?.handle?.id, 'run_ap', '(E) approval targets the in-scope run');
    assertEq(encodeEntityHandle(a!.handle!), 'office:run:run_ap', '(E) run handle encodes');
  }

  // ─── (F) open_room + open_run ranking below accountability actions ──────────
  {
    const r = d({
      verdict: 'completed',
      proofCount: 1,
      contextMission: { kind: 'mission', id: 'msn_f', title: 'Mission F' },
      contextRoom: { kind: 'room', id: 'room_f', title: 'Room F' },
      contextRun: { kind: 'run', id: 'run_f' },
    });
    assertEq(r.followups[0]?.kind, 'attach_proof_to_mission', '(F) accountability action ranks #1');
    assert(has(r, 'open_room'), '(F) open_room present');
    assert(has(r, 'open_run'), '(F) open_run present');
    assert(!has(r, 'open_mission'), '(F) attach fired → open_mission suppressed');
    const ks = kindsOf(r);
    assert(ks.indexOf('open_room') > ks.indexOf('attach_proof_to_mission'), '(F) open_room ranked below attach');
    assert(ks.indexOf('open_room') < ks.indexOf('open_run'), '(F) open_room (55) ranked above open_run (50)');
    assertEq(find(r, 'open_room')?.handle?.surface, 'rooms', '(F) room handle surface rooms');
    assertEq(find(r, 'open_run')?.handle?.surface, 'office', '(F) run handle surface office');
  }
  {
    // bare room+run completed turn (no proof/mission)
    const r = d({ verdict: 'completed', contextRoom: { kind: 'room', id: 'room_g', title: 'G' }, contextRun: { kind: 'run', id: 'run_g' } });
    assertJson(kindsOf(r), ['open_room', 'open_run'], '(F) only the two open actions, room before run');
  }

  // ─── (G) determinism ────────────────────────────────────────────────────────
  {
    const gi = {
      verdict: 'partial', proofCount: 1,
      contextMission: { kind: 'mission', id: 'msn_d', title: 'D' },
      gitReferences: [{ type: 'pull_request', url: '', prNumber: 9 }],
      contextTask: { kind: 'task', id: 'task_d', title: 'T' },
      canRetry: true,
      contextRun: { kind: 'run', id: 'run_d' },
      contextRoom: { kind: 'room', id: 'room_d', title: 'R' },
    };
    const a = d(gi);
    const b = d(gi);
    assertJson(a, b, '(G) same input twice → identical result');
    let sorted = true;
    for (let i = 1; i < a.followups.length; i += 1) if (a.followups[i].score > a.followups[i - 1].score) sorted = false;
    assert(sorted, '(G) followups sorted by score descending');
    assert(a.followups.length >= 3, '(G) rich input yields several follow-ups', String(a.followups.length));
  }

  // ─── (H) bounds / cap / clamps ──────────────────────────────────────────────
  {
    // 5 candidates fire; default cap keeps the top 4 by score, drops open_room(55)
    const big = {
      verdict: 'partial', proofCount: 1,
      contextMission: { kind: 'mission', id: 'msn_b', title: 'Big mission' },
      approvalPending: true,
      gitReferences: [{ type: 'pull_request', url: '', prNumber: 7 }],
      contextTask: { kind: 'task', id: 'task_b', title: 'Src' },
      canRetry: true,
      contextRoom: { kind: 'room', id: 'room_b', title: 'Room B' },
      contextRun: { kind: 'run', id: 'run_b' },
    };
    const r = d(big);
    assertEq(r.followups.length, 4, '(H) default cap = MAX_FOLLOWUPS (4)');
    assertJson(kindsOf(r), ['attach_proof_to_mission', 'request_approval', 'link_pr_to_task', 'retry_run'], '(H) top-4 by score kept');
    assert(!has(r, 'open_room'), '(H) the lowest-scored candidate is trimmed by the cap');
    assert(resultIsValid(r), '(H) capped result valid');
    assertEq(d(big, { maxFollowups: 2 }).followups.length, 2, '(H) maxFollowups:2 honored');
    assertEq(d(big, { maxFollowups: 100 }).followups.length, MAX_FOLLOWUPS, '(H) maxFollowups clamped to MAX_FOLLOWUPS');
    assertEq(d(big, { maxFollowups: 0 }).followups.length, 0, '(H) maxFollowups:0 → empty');
    assertEq(d(big, { maxFollowups: -3 }).followups.length, 0, '(H) negative maxFollowups clamps to 0');
    assertEq(d(big, { maxFollowups: NaN }).followups.length, MAX_FOLLOWUPS, '(H) NaN maxFollowups → default');
    assertEq(d(big, { maxFollowups: 2.9 }).followups.length, 2, '(H) fractional maxFollowups floored');
  }
  {
    // huge (spaced, non-secret) action label → seed clamped
    const hugeLabel = 'word '.repeat(3000); // ~15k chars
    const r = d({ verdict: 'completed', artifactCount: 1, actionLabel: hugeLabel });
    const c = find(r, 'create_feed_task');
    assert(!!c && !!c.seedCommand, '(H) create fires for huge label');
    assert(c!.seedCommand!.length <= MAX_SEED_LEN, '(H) huge-label seed clamped to MAX_SEED_LEN', String(c!.seedCommand!.length));
    assert(c!.label.length <= MAX_LABEL_LEN, '(H) huge-label label clamped', String(c!.label.length));
  }
  {
    // 5000 junk git refs → bounded scan, still valid, no link emitted
    const junk: unknown[] = [];
    for (let i = 0; i < 5000; i += 1) junk.push({ type: 'nope', foo: i });
    const r = d({ verdict: 'completed', proofCount: 1, gitReferences: junk, contextMission: { kind: 'mission', id: 'msn_j', title: 'J' } });
    assert(resultIsValid(r), '(H) 5000-junk-refs result valid');
    assert(r.followups.length <= MAX_FOLLOWUPS, '(H) bounded under junk flood');
    assert(!has(r, 'link_pr_to_task'), '(H) junk refs never fabricate a link');
    assert(has(r, 'attach_proof_to_mission'), '(H) a non-empty git array still counts as proof for attach');
  }
  {
    // long entity title clamped inside the label
    const longTitle = 'Zeta ' + 'lorem ipsum dolor sit amet '.repeat(10);
    const r = d({ verdict: 'completed', proofCount: 1, contextMission: { kind: 'mission', id: 'msn_lt', title: longTitle } });
    const a = find(r, 'attach_proof_to_mission');
    assert(!!a && a.label.length <= MAX_LABEL_LEN, '(H) long title clamped within label');
  }

  // ─── (I) exported bound values ──────────────────────────────────────────────
  assertEq(MAX_FOLLOWUPS, 4, '(I) MAX_FOLLOWUPS is 4');
  assertEq(MAX_LABEL_LEN, 48, '(I) MAX_LABEL_LEN is 48');
  assertEq(MAX_HINT_LEN, 80, '(I) MAX_HINT_LEN is 80');
  assertEq(MAX_TITLE_LEN, 60, '(I) MAX_TITLE_LEN is 60');
  assertEq(MAX_SEED_LEN, 120, '(I) MAX_SEED_LEN is 120');

  // ─── (J) describeFollowupForAnalytics ───────────────────────────────────────
  {
    const r = d({ verdict: 'completed', proofCount: 1, contextMission: { kind: 'mission', id: 'm', title: 'M' } });
    assertEq(describeFollowupForAnalytics(r.followups[0]), 'attach_proof_to_mission|feed|completed_with_proof', '(J) analytics token for a real follow-up');
    assertEq(describeFollowupForAnalytics(null as never), 'unknown|unknown|unknown', '(J) null → unknown token');
    assertEq(describeFollowupForAnalytics({} as never), 'unknown|unknown|unknown', '(J) empty → unknown token');
    assertEq(describeFollowupForAnalytics({ kind: 'bogus', surface: 'x', reason: 'y' } as never), 'unknown|unknown|unknown', '(J) junk enums → unknown token');
    assertEq(describeFollowupForAnalytics({ kind: 'open_run', surface: 'office', reason: 'context_run_in_scope' } as never), 'open_run|office|context_run_in_scope', '(J) valid triple echoed');
    // no label/title/seed can leak through the analytics token
    const secret = { kind: 'create_feed_task', surface: 'feed', reason: 'produced_untracked_work', label: 'sk-ant-secret', seedCommand: 'sk-ant-secret' };
    assert(!describeFollowupForAnalytics(secret as never).includes('sk-ant'), '(J) analytics token never echoes label/seed');
  }

  // ─── (HOSTILE) totality: never throw, never leak ────────────────────────────
  try {
    for (const bad of [null, undefined, 42, NaN, true, 'str', {}, [], () => 1, Symbol('s'), 9n]) {
      assert(totalOn(bad), 'hostile input is total', JSON.stringify(String(bad).slice(0, 16)));
      const r = d(bad);
      assertEq(r.followups.length, 0, 'hostile input → no follow-ups');
      assertEq(r.line, '', 'hostile input → empty line');
    }
    // hostile opts
    assert(totalOn({ verdict: 'completed', artifactCount: 1 }, 42), 'numeric opts total');
    assert(totalOn({ verdict: 'completed', artifactCount: 1 }, 'nope'), 'string opts total');
    assert(totalOn({ verdict: 'completed', artifactCount: 1 }, { maxFollowups: Infinity }), 'Infinity maxFollowups total');

    // opts as a throwing proxy
    const throwingOpts = new Proxy({}, { get() { throw new Error('opts boom'); } });
    const rOpts = d({ verdict: 'completed', artifactCount: 1 }, throwingOpts);
    assert(resultIsValid(rOpts), 'throwing-proxy opts falls back to default limit, valid');
    assert(rOpts.followups.length >= 1, 'throwing-proxy opts still produces follow-ups');

    // input as a throwing proxy (every field access throws)
    const throwingInput = new Proxy({}, { get() { throw new Error('input boom'); } });
    assert(totalOn(throwingInput), 'throwing-proxy input is total');
    assertEq(d(throwingInput).followups.length, 0, 'throwing-proxy input → no follow-ups');

    // per-field throwing getters: one bad field must not nuke the whole result
    for (const field of ['verdict', 'artifactCount', 'proofCount', 'gitReferences', 'contextMission', 'contextTask', 'contextRun', 'contextRoom', 'actionLabel', 'canRetry', 'approvalPending']) {
      const o: Record<string, unknown> = { verdict: 'completed', artifactCount: 1, contextMission: { kind: 'mission', id: 'm_g', title: 'G' }, proofCount: 1 };
      Object.defineProperty(o, field, { get() { throw new Error(`boom ${field}`); }, enumerable: true });
      assert(totalOn(o), `throwing getter on ${field} is total`);
    }

    // cyclic input
    const cyc: Record<string, unknown> = { verdict: 'completed', artifactCount: 1 };
    cyc.self = cyc;
    cyc.list = [cyc, cyc];
    assert(totalOn(cyc), 'cyclic input is total');
    assert(has(d(cyc), 'create_feed_task'), 'cyclic input still resolves its scalar fields');

    // cyclic git-ref entry
    const cycRef: Record<string, unknown> = { type: 'pull_request', prNumber: 5 };
    cycRef.self = cycRef;
    const rCycRef = d({ verdict: 'completed', gitReferences: [cycRef], contextTask: { kind: 'task', id: 'task_cy', title: 'T' } });
    assert(resultIsValid(rCycRef), 'cyclic git ref is total');
    assert(has(rCycRef, 'link_pr_to_task'), 'cyclic git ref still yields a link by its scalar fields');

    // secret-value-shaped action label → '[hidden]', never the raw secret
    const SK = 'sk-ant-' + 'a'.repeat(40);
    const rSecret = d({ verdict: 'completed', artifactCount: 1, actionLabel: SK });
    const cSecret = find(rSecret, 'create_feed_task');
    assert(!!cSecret, 'secret-label turn still produces create_feed_task');
    assert(cSecret!.seedCommand!.includes('[hidden]'), 'secret action label → seed shows [hidden]', cSecret?.seedCommand ?? '');
    assert(cSecret!.label.includes('[hidden]'), 'secret action label → label shows [hidden]', cSecret?.label);
    assert(!JSON.stringify(rSecret).includes('sk-ant'), 'the raw secret never appears anywhere in the result', JSON.stringify(rSecret).slice(0, 80));

    // JWT-shaped mission title → '[hidden]', still navigable by its safe id
    const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const rJwt = d({ verdict: 'completed', proofCount: 1, contextMission: { kind: 'mission', id: 'msn_jwt', title: JWT } });
    const aJwt = find(rJwt, 'attach_proof_to_mission');
    assert(!!aJwt, 'JWT-title mission still produces attach');
    assert(aJwt!.label.includes('[hidden]'), 'JWT-shaped title → [hidden] in label', aJwt?.label);
    assert(!JSON.stringify(rJwt).includes('eyJ'), 'JWT never leaks into the result');
    assertEq(encodeEntityHandle(aJwt!.handle!), 'feed:mission:msn_jwt', 'JWT-title mission handle stays navigable');

    // unsafe entity id → handle dropped, action dropped, id never echoed
    const badId = 'has spaces' + String.fromCharCode(10) + '<b>';
    const rBadId = d({ verdict: 'completed', proofCount: 1, contextMission: { kind: 'mission', id: badId, title: 'X' } });
    assert(resultIsValid(rBadId), 'unsafe-id input is total');
    assert(!has(rBadId, 'attach_proof_to_mission'), 'attach dropped when the mission id is unsafe (no dead handle)');
    assert(!has(rBadId, 'open_mission'), 'open_mission dropped when the mission id is unsafe');
    assert(!JSON.stringify(rBadId).includes('<b>'), 'unsafe id never echoed into output');

    // oversized entity id (> MAX_ID_LEN 256) → handle dropped
    const rBigId = d({ verdict: 'completed', proofCount: 1, contextMission: { kind: 'mission', id: 'a'.repeat(300), title: 'X' } });
    assert(!has(rBigId, 'attach_proof_to_mission'), 'oversized mission id → attach dropped');

    // control / line-sep / fence chars in a title are stripped from the label
    const nastyTitle = 'Ctrl' + String.fromCharCode(0) + 'Tab' + String.fromCharCode(9) + String.fromCharCode(0x2028, 0x2029) + ' `code` </untrusted>';
    const rNasty = d({ verdict: 'completed', proofCount: 1, contextMission: { kind: 'mission', id: 'msn_nasty', title: nastyTitle } });
    const aNasty = find(rNasty, 'attach_proof_to_mission');
    assert(!!aNasty, 'control-char title still matched');
    assert(!hasUnsafeChars(aNasty!.label), 'no control/line-sep/fence chars leak into the label', JSON.stringify(aNasty?.label));

    // control chars in the action label are stripped from the seed
    const nastyLabel = 'Do' + String.fromCharCode(0) + 'thing' + String.fromCharCode(0x2028) + '<x>';
    const rNL = d({ verdict: 'completed', artifactCount: 1, actionLabel: nastyLabel });
    const cNL = find(rNL, 'create_feed_task');
    assert(!!cNL && !hasUnsafeChars(cNL.seedCommand!), 'no control/fence chars leak into the seed command');

    // a whole battery: every followup across many inputs obeys the caps
    const battery: unknown[] = [
      { verdict: 'completed', proofCount: 2, contextMission: { kind: 'mission', id: 'b1', title: 'One' }, contextRoom: { kind: 'room', id: 'r1', title: 'Rm' } },
      { verdict: 'blocked', contextRun: { kind: 'run', id: 'run1' } },
      { verdict: 'failed', hasRecoveryOptions: true, contextRun: { kind: 'run', id: 'run2' } },
      { verdict: 'partial', artifactCount: 1, gitReferences: [{ type: 'commit', url: '', sha: 'deadbee' }], contextTask: { kind: 'task', id: 't1', title: 'Tk' } },
      { verdict: 'unknown', gitReferences: [{ type: 'pull_request', url: '', prNumber: 42 }], contextTask: { kind: 'task', id: 't2', title: 'Tk2' } },
    ];
    for (const b of battery) {
      const r = d(b);
      assert(resultIsValid(r), 'battery result valid', JSON.stringify(b).slice(0, 60));
      for (const f of r.followups) {
        assert(f.label.length <= MAX_LABEL_LEN, 'battery label clamped');
        assert(f.hint.length <= MAX_HINT_LEN, 'battery hint clamped');
        if (f.seedCommand) assert(f.seedCommand.length <= MAX_SEED_LEN, 'battery seed clamped');
        if (f.handle) assert(encodeEntityHandle(f.handle).length > 0, 'battery handle round-trips');
        assert(describeFollowupForAnalytics(f).split('|').length === 3, 'battery analytics token well-formed');
      }
    }

    // unknown verdict with nothing else → empty, valid
    assertJson(d({ verdict: 'unknown' }), { followups: [], line: '' }, 'unknown verdict, no signals → empty result');

    passes += 1; // reached the end of the hostile sweep without throwing
  } catch (e) {
    failures += 1;
    console.error(`FAIL: (HOSTILE) sweep threw: ${(e as Error)?.message}`);
  }

  // ── ChatTab wiring regression (followup-chips QA finding) ──────────────────
  // retry_run must be REACHABLE end-to-end. Mirrors ChatTab.addBotMessage's
  // exact derivation for an error turn with NO recovery options
  // (extra.hadError === true): deriveOutcomeVerdict → 'failed'; canRetry is
  // decoupled from hasRecoveryOptions (hadError || hasRecovery) → retry_run
  // emitted; and ChatTab's visibleFollowupChips suppression predicate (drop
  // only when item.recoveryOptions is non-empty, deferring to the recovery
  // card) does NOT fire — so the chip actually renders.
  {
    const recoveryOptions: unknown[] = []; // error turn; recovery flow yielded nothing
    const hadError = true;
    const hasRecovery = recoveryOptions.length > 0;
    const verdict = deriveOutcomeVerdict({
      hadError,
      hadRecoveryOptions: hasRecovery,
      approvalPending: false,
      producedArtifact: false,
      producedText: true,
    });
    assertEq(verdict, 'failed', 'error turn without recovery options → failed verdict');
    const chips = deriveCrossSurfaceFollowups({
      verdict,
      hasRecoveryOptions: hasRecovery,
      canRetry: hadError || hasRecovery,
      approvalPending: false,
    }).followups;
    const retry = chips.find((f) => f.kind === 'retry_run');
    assert(!!retry, 'retry_run chip emitted for a plain error turn (canRetry decoupled from recovery options)');
    const suppressedByRecoveryCard = recoveryOptions.length > 0;
    assert(!suppressedByRecoveryCard && !!retry, 'retry_run survives ChatTab suppression (no recovery options) → visible chip');
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll cross-surface-followup-core smoke cases passed (${passes} passed).`);
}

main();
