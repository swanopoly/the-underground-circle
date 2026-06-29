/**
 * openswan-lane-report-smoketest
 *
 * Locks the SwanBot/OpenSwan lane report used to keep broad worktrees from
 * turning into one dirty delivery branch.
 *
 * Run: npm run smoke:openswan-lane-report
 */

import {
  buildOpenSwanLaneReport,
  formatOpenSwanLaneReport,
} from './openswan-lane-report';

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
  console.log(`pass: ${message}`);
}

const broadReport = buildOpenSwanLaneReport({
  taskDescription: 'future SwanBot/OpenSwan/Chat cleanup',
  maxActiveLanes: 2,
  maxChangedPaths: 20,
  statusLines: [
    ' M package.json',
    ' M src/lib/swanbotOpenSwanReadiness.ts',
    ' M src/lib/chatAutomationPlanner.ts',
    ' M src/lib/openswanSessionRuntime.ts',
    ' M src/lib/openswanToolRuntime.ts',
    ' M src/lib/chatComputerRequestRouter.ts',
    '?? src/lib/wordpressRestPayload.ts',
    ' M src/lib/llmProviders.ts',
    ' M src/components/openswan/OpenSwanConsole.tsx',
    ' M src/lib/wikiData.ts',
    '?? supabase/migrations/20260630_agent_runtime_test.sql',
  ],
});

assert(broadReport.status === 'broad', 'multi-lane report is broad');
assert(broadReport.activeLaneCount >= 8, 'multi-lane report counts active lanes');
assert(broadReport.untrackedPathCount === 2, 'multi-lane report counts untracked paths');
assert(broadReport.buckets[0]?.lane.id === 'lane0_traffic_control', 'traffic control lane sorts first');
assert(
  broadReport.buckets.some((bucket) => bucket.lane.id === 'lane6_wordpress_managed_sites'),
  'WordPress files map to managed-site lane',
);
assert(
  broadReport.buckets.some((bucket) => bucket.lane.id === 'lane10_edge_sql'),
  'Supabase migrations map to edge SQL lane',
);
assert(
  broadReport.verificationCommands.includes('npm run check:openswan-lanes'),
  'broad report recommends lane check',
);

const formattedBroad = formatOpenSwanLaneReport(broadReport);
assert(formattedBroad.includes('SwanBot/OpenSwan lane report: broad'), 'formatted broad report has status');
assert(formattedBroad.includes('Lane 6 - WordPress Managed Sites'), 'formatted broad report lists WordPress lane');
assert(formattedBroad.includes('Avoid git add .'), 'formatted broad report includes hunk-stage guardrail');

const narrowReport = buildOpenSwanLaneReport({
  maxActiveLanes: 2,
  maxChangedPaths: 10,
  statusLines: [
    ' M src/lib/chatAutomationPlanner.ts',
    ' M scripts/chat-planner-smoketest.ts',
  ],
});

assert(narrowReport.status === 'narrow', 'single-lane report is narrow');
assert(narrowReport.activeLaneCount === 1, 'single-lane report has one active lane');
assert(narrowReport.buckets[0]?.lane.id === 'lane2_chat_dispatcher', 'chat files map to chat dispatcher lane');
assert(!narrowReport.verificationCommands.includes('npm run check:openswan-lanes'), 'narrow report does not self-loop lane check');

const cleanReport = buildOpenSwanLaneReport({
  statusLines: [],
});

assert(cleanReport.status === 'clean', 'empty status report is clean');
assert(cleanReport.changedPathCount === 0, 'empty status has zero changed paths');

console.log('openswan-lane-report-smoketest: ok');
