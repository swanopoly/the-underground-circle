/**
 * Focused wiring smoke for acceptance-only connected-agent run presentation.
 * Pure lifecycle semantics are exercised by office-ops-board-smoketest; this
 * file pins the two React surfaces that must not expose local-runtime controls.
 *
 * Usage:
 *   npx tsx scripts/connected-agent-run-presentation-smoketest.ts
 */

import { readFileSync } from 'node:fs';

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean): void {
  if (condition) {
    passed += 1;
    console.log(`pass: ${name}`);
    return;
  }
  failed += 1;
  console.error(`FAIL: ${name}`);
}

const traceSource = readFileSync(
  'src/screens/circles/tabs/chat/RunTraceCard.tsx',
  'utf8',
);
const boardCardSource = readFileSync(
  'src/components/office/OfficeOpsBoardCards.tsx',
  'utf8',
);
const historyFilterSource = readFileSync(
  'src/components/chat/RunHistoryFilterBar.tsx',
  'utf8',
);
const agentRunsSource = readFileSync(
  'src/screens/circles/tabs/office/AgentRunsPanel.tsx',
  'utf8',
);
const historyDrawerSource = readFileSync(
  'src/components/chat/RunHistoryDrawer.tsx',
  'utf8',
);
const officeSource = readFileSync(
  'src/screens/circles/tabs/OfficeTab.tsx',
  'utf8',
);

check(
  'Run Trace recognizes the shared exact accepted-handoff marker',
  traceSource.includes('isAwaitingConnectedAgentResultMetadata(run?.metadata)'),
);
check(
  'accepted external handoff is excluded from live spinner state',
  /const isLive = !awaitingExternalResult\s*&&/.test(traceSource),
);
check(
  'Run Trace labels the acceptance-only lifecycle explicitly',
  traceSource.includes('ACCEPTED · AWAITING UPDATE')
    && traceSource.includes('CONNECTED AGENT ACCEPTED'),
);
check(
  'Run Trace says completion remains unverified',
  traceSource.includes('Awaiting a connected-agent update. Completion is not yet verified.'),
);
check(
  'Run Trace STOP is hidden for acceptance-only handoffs',
  traceSource.includes('isLive && !readOnly && !awaitingExternalResult'),
);
check(
  'Run Trace Run Again is hidden for acceptance-only handoffs',
  traceSource.includes('!readOnly && !awaitingExternalResult && (isFailed || isDone || run.status === \'cancelled\')'),
);
check(
  'Office row renders the projected acceptance-only marker',
  boardCardSource.includes('node.awaitingExternalResult'),
);
check(
  'Office row labels connected-agent update and unverified completion',
  boardCardSource.includes('ACCEPTED · AWAITING CONNECTED-AGENT UPDATE · COMPLETION UNVERIFIED'),
);
check(
  'Office count copy distinguishes accepted handoffs from ordinary queued work',
  boardCardSource.includes('accepted handoff${awaitingExternalCount === 1 ? \'\' : \'s\'} awaiting update'),
);
check(
  'Office count copy consumes pre-truncation accepted totals',
  boardCardSource.includes('const awaitingExternalCount = counts.awaitingExternalResults;')
    && boardCardSource.includes('counts.queued - counts.awaitingExternalQueued')
    && boardCardSource.includes('counts.activeRoots - counts.awaitingExternalRoots'),
);
check(
  'run history queued-inclusive filter is labeled ACTIVE',
  historyFilterSource.includes("{ key: 'running', label: 'ACTIVE' }"),
);
check(
  'per-agent queued-inclusive filter is labeled ACTIVE',
  agentRunsSource.includes("{ key: 'running', label: 'ACTIVE', color: '#3b82f6' }"),
);
check(
  'run history labels accepted ledgers instead of generic queued state',
  historyDrawerSource.includes("'ACCEPTED · AWAITING UPDATE'")
    && historyDrawerSource.includes('ACCEPTED · AWAITING CONNECTED-AGENT UPDATE · COMPLETION UNVERIFIED'),
);
check(
  'per-agent run history labels accepted ledgers instead of generic queued state',
  agentRunsSource.includes("'ACCEPTED · AWAITING UPDATE'"),
);
check(
  'mobile roster excludes acceptance-only ledgers from runtime freshness',
  officeSource.includes('const ordinaryOpsNodes = opsNodes.filter((node) => !node.awaitingExternalResult);')
    && /pickFreshestRunFreshness\(\s*ordinaryOpsNodes,\s*opsRunFreshness,\s*\)/.test(officeSource),
);
check(
  'mobile roster leads with runtime freshness while also showing a pending accepted update',
  officeSource.includes('`${runFreshness.label} · accepted update pending`')
    && officeSource.includes('FRESHNESS_DOT_COLORS[runFreshness.freshness]'),
);
check(
  'mobile roster keeps truthful accepted-only copy when no runtime-owned run exists',
  officeSource.includes("? 'Accepted · awaiting update'")
    && officeSource.includes("const awaitingConnectedAgentUpdate = opsNodes.some((node) => node.awaitingExternalResult);"),
);

if (failed > 0) {
  console.error(`\nconnected-agent run presentation smoke: ${passed} passed, ${failed} failed`);
  process.exit(1);
}

console.log(`\nconnected-agent run presentation smoke: ${passed} passed, 0 failed`);
