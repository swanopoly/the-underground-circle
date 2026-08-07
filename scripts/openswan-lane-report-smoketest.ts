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
  isValidOpenSwanLaneBaseRef,
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

const traceReport = buildOpenSwanLaneReport({
  maxActiveLanes: 2,
  maxChangedPaths: 10,
  statusLines: [
    ' M scripts/export-traces.ts',
    '?? scripts/export-traces-smoketest.ts',
  ],
});

assert(traceReport.status === 'narrow', 'trace exporter report is narrow');
assert(traceReport.activeLaneCount === 1, 'trace exporter maps to one lane');
assert(traceReport.buckets[0]?.lane.id === 'lane3_openswan_typed_core', 'trace exporter maps to OpenSwan typed core lane');
assert(traceReport.unmappedPaths.length === 0, 'trace exporter paths are not unmapped');
assert(traceReport.verificationCommands.includes('npm run smoke:export-traces'), 'trace exporter report recommends export smoke');

const runtimePlanReport = buildOpenSwanLaneReport({
  maxActiveLanes: 2,
  maxChangedPaths: 10,
  statusLines: [
    ' M docs/AGENT_RUNTIME_INTEGRATION_PLAN.md',
  ],
});

assert(runtimePlanReport.status === 'narrow', 'runtime integration plan report is narrow');
assert(runtimePlanReport.buckets[0]?.lane.id === 'lane3_openswan_typed_core', 'runtime integration plan maps to OpenSwan typed core lane');
assert(runtimePlanReport.unmappedPaths.length === 0, 'runtime integration plan is not unmapped');

const universalTaskKernelReport = buildOpenSwanLaneReport({
  maxActiveLanes: 2,
  maxChangedPaths: 10,
  statusLines: [
    ' M docs/UC_APP_TASK_RELIABILITY_ARCHITECTURE.md',
    '?? scripts/exact-program-authority-smoketest.ts',
    '?? scripts/thinking-label-hook-order-smoketest.ts',
  ],
});

assert(universalTaskKernelReport.status === 'narrow', 'universal task kernel ownership stays reviewable');
assert(universalTaskKernelReport.activeLaneCount === 2, 'universal task kernel artifacts map to two declared lanes');
assert(
  universalTaskKernelReport.buckets.some((bucket) => bucket.lane.id === 'lane5_computer_app_evidence'),
  'kernel architecture and exact-authority smoke map to computer/app evidence',
);
assert(
  universalTaskKernelReport.buckets.some((bucket) => bucket.lane.id === 'lane8_product_ui_console'),
  'thinking-label hook smoke maps to product UI',
);
assert(universalTaskKernelReport.unmappedPaths.length === 0, 'universal task kernel artifacts are not unmapped');

const databaseAuthorityReport = buildOpenSwanLaneReport({
  maxActiveLanes: 2,
  maxChangedPaths: 10,
  statusLines: [
    ' M scripts/database-authority-guards-smoketest.ts',
    '?? supabase/migrations/20260806_chat_v2_approval_auto_approve_category.sql',
  ],
});

assert(databaseAuthorityReport.status === 'narrow', 'database authority artifacts stay reviewable');
assert(databaseAuthorityReport.activeLaneCount === 1, 'database authority artifacts share the Edge SQL lane');
assert(databaseAuthorityReport.buckets[0]?.lane.id === 'lane10_edge_sql', 'database authority smoke maps to Edge SQL');
assert(databaseAuthorityReport.unmappedPaths.length === 0, 'database authority artifacts are not unmapped');
assert(isValidOpenSwanLaneBaseRef('origin/main'), 'CI lane base accepts a remote branch');
assert(isValidOpenSwanLaneBaseRef('a'.repeat(40)), 'CI lane base accepts an exact commit SHA');
assert(!isValidOpenSwanLaneBaseRef('--output=/tmp/file'), 'CI lane base rejects Git options');
assert(!isValidOpenSwanLaneBaseRef('main...HEAD'), 'CI lane base rejects revision expressions');
assert(!isValidOpenSwanLaneBaseRef('main HEAD'), 'CI lane base rejects whitespace injection');

const exactApprovalContinuityReport = buildOpenSwanLaneReport({
  maxActiveLanes: 2,
  maxChangedPaths: 10,
  statusLines: [
    ' M src/lib/exactPlanApprovalContinuityCore.ts',
    ' M src/screens/circles/tabs/ChatTab.tsx',
  ],
});
assert(exactApprovalContinuityReport.status === 'narrow', 'exact approval continuity stays in one review lane');
assert(exactApprovalContinuityReport.activeLaneCount === 1, 'exact approval continuity maps to one declared lane');
assert(
  exactApprovalContinuityReport.buckets[0]?.lane.id === 'lane2_chat_dispatcher',
  'exact approval continuity maps to the Chat dispatcher lane',
);
assert(exactApprovalContinuityReport.unmappedPaths.length === 0, 'exact approval continuity has no unmapped path');

const cleanReport = buildOpenSwanLaneReport({
  statusLines: [],
});

assert(cleanReport.status === 'clean', 'empty status report is clean');
assert(cleanReport.changedPathCount === 0, 'empty status has zero changed paths');

console.log('openswan-lane-report-smoketest: ok');
