/**
 * Feed active-runs truth contract.
 *
 * The Feed widget may keep accepted connected-agent handoffs visible as a
 * separate completion-unverified lane, but its ACTIVE count/list must contain
 * only fresh `planning` or `running` rows. Queued, paused, approval-waiting,
 * timestamp-less, and stale rows remain nonterminal without being called
 * active. This smoke executes the canonical history/freshness classifiers and
 * pins the Feed/query wiring without importing React Native or Supabase.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  bucketRunForHistory,
  describeRunHistoryStatus,
  type RunHistoryRunLike,
} from '../src/lib/runHistoryFilterCore';
import { isAwaitingConnectedAgentResultMetadata } from '../src/lib/officeOpsBoard';

const repoRoot = process.cwd();
const read = (relativePath: string): string => readFileSync(resolve(repoRoot, relativePath), 'utf8');

const nowMs = Date.UTC(2026, 7, 12, 16, 0, 0);
const timestamp = (ageMs: number): string => new Date(nowMs - ageMs).toISOString();
const run = (id: string, status: string, ageMs?: number): RunHistoryRunLike => ({
  id,
  status,
  ...(ageMs === undefined ? {} : { updated_at: timestamp(ageMs) }),
});

const fixtures = [
  run('fresh-planning', 'planning', 60_000),
  run('fresh-running', 'running', 5 * 60_000),
  run('queued', 'queued', 60_000),
  run('paused', 'paused', 60_000),
  run('waiting', 'waiting_approval', 60_000),
  run('stale-running', 'running', 31 * 60_000),
  run('stale-planning', 'planning', 31 * 60_000),
  run('timestamp-missing', 'running'),
];

const activeIds = fixtures
  .filter((candidate) => bucketRunForHistory(candidate, nowMs) === 'running')
  .map((candidate) => candidate.id);
assert.deepEqual(activeIds, ['fresh-planning', 'fresh-running'], 'ACTIVE is only fresh planning/running work');

for (const id of ['queued', 'paused', 'waiting', 'stale-running', 'stale-planning', 'timestamp-missing']) {
  const candidate = fixtures.find((item) => item.id === id)!;
  assert.equal(bucketRunForHistory(candidate, nowMs), 'other', `${id} remains non-active`);
  assert.match(describeRunHistoryStatus(candidate, nowMs).label, /NOT ACTIVE/, `${id} has truthful non-active copy`);
}

const acceptedMetadata = {
  externalLifecycle: 'awaiting_typed_result',
  handoffStatus: 'accepted',
  completionVerified: false,
};
assert.equal(isAwaitingConnectedAgentResultMetadata(acceptedMetadata), true, 'exact accepted handoff marker survives');
assert.equal(
  isAwaitingConnectedAgentResultMetadata({ ...acceptedMetadata, completionVerified: true }),
  false,
  'verified work is not retained as awaiting merely from prose/status',
);

const runSystem = read('src/lib/agentRunSystem.ts');
const feed = read('src/screens/circles/tabs/FeedTab.tsx');

assert.match(runSystem, /bucketRunForHistory/, 'run query reuses canonical history freshness semantics');
assert.match(runSystem, /activeOnly\?: boolean/, 'run query exposes an explicit compatibility-safe active-only mode');
assert.match(runSystem, /includeAcceptedHandoffs\?: boolean/, 'run query can preserve exact accepted handoffs');
assert.match(
  runSystem,
  /bucketRunForHistory\(run, nowMs\) === 'running'/,
  'active-only query keeps only canonical fresh processing rows',
);
assert.match(
  runSystem,
  /isAwaitingConnectedAgentResultMetadata\(run\.metadata\)/,
  'active-only query recognizes accepted handoffs structurally',
);

const widgetStart = feed.indexOf('function ActiveRunsWidget');
const widgetEnd = feed.indexOf('// ═══', widgetStart);
assert(widgetStart >= 0 && widgetEnd > widgetStart, 'Feed ActiveRunsWidget section is readable');
const widget = feed.slice(widgetStart, widgetEnd);

assert.match(widget, /activeOnly:\s*true/, 'Feed requests truth-filtered active rows');
assert.match(widget, /includeAcceptedHandoffs:\s*true/, 'Feed requests accepted handoffs for their separate lane');
assert.match(widget, /bucketRunForHistory\(run, nowMs\) === 'running'/, 'Feed defensively rechecks freshness at render time');
assert.match(
  widget,
  /const runtimeRuns = runs\.filter[\s\S]{0,240}bucketRunForHistory\(run, nowMs\) === 'running'/,
  'Feed runtime list itself is the canonical active subset',
);
assert.match(widget, /ACTIVE RUNS \(\{runtimeRuns\.length\}\)/, 'Feed header counts only canonical active rows');
assert.match(widget, /ACCEPTED HANDOFFS \(\{acceptedRuns\.length\}\)/, 'accepted handoffs stay separately labelled');
assert.match(widget, /COMPLETION UNVERIFIED/, 'accepted handoff copy does not imply terminal completion');
assert.doesNotMatch(widget, /ACTIVE RUNS \(\{runs\.length\}\)/, 'Feed never counts every open row as active');

console.log('feed active-runs truth smoketest: all assertions passed');
