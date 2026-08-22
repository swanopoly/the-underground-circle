/**
 * Red-first contract for exact Office run-to-agent attribution.
 *
 * Canonical run identity must win over a shared display name. Name matching is
 * retained only for old run nodes that carry no subject/db/session identity.
 * This is a pure in-memory smoke: no React, bridge, provider, or database I/O.
 *
 * Run: npx tsx scripts/office-run-exact-attribution-smoketest.ts
 */

import {
  buildOpsRunNodeLookupKeys,
  getOpsRunNodesForAgent,
  type OfficeRunNodeLike,
} from '../src/lib/officeRunLookup';
import {
  buildOfficeAgentAccountabilityIndex,
  type AgentRunLike,
} from '../src/lib/officeOpsBoard';

let passed = 0;
const failures: string[] = [];

function check(condition: unknown, label: string): condition is true {
  if (condition) {
    passed += 1;
    return true;
  }
  failures.push(label);
  return false;
}

const agentA = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Worker',
  providerType: 'codex',
  sessionKey: 'codex-session-owner-a',
} as any;

const agentB = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Worker',
  providerType: 'codex',
  sessionKey: 'codex-session-owner-b',
} as any;

const runA: OfficeRunNodeLike = {
  runId: 'run-owner-a',
  agentName: 'Worker',
  subjectKey: agentA.id,
  subjectDisplayName: 'Worker',
  subjectDbId: agentA.id,
  subjectAliases: [agentA.sessionKey],
};

const runB: OfficeRunNodeLike = {
  runId: 'run-owner-b',
  agentName: 'Worker',
  subjectKey: agentB.id,
  subjectDisplayName: 'Worker',
  subjectDbId: agentB.id,
  subjectAliases: [agentB.sessionKey],
};

function indexNodes(nodes: OfficeRunNodeLike[]): Map<string, OfficeRunNodeLike[]> {
  const index = new Map<string, OfficeRunNodeLike[]>();
  for (const node of nodes) {
    for (const key of buildOpsRunNodeLookupKeys(node)) {
      const rows = index.get(key) || [];
      rows.push(node);
      index.set(key, rows);
    }
  }
  return index;
}

const exactIndex = indexNodes([runA, runB]);
const matchesA = getOpsRunNodesForAgent(agentA, exactIndex);
const matchesB = getOpsRunNodesForAgent(agentB, exactIndex);

check(
  matchesA.map((node) => node.runId).join(',') === runA.runId,
  'first same-name agent receives only the run carrying its canonical DB subject',
);
check(
  matchesB.map((node) => node.runId).join(',') === runB.runId,
  'second same-name agent receives only the run carrying its canonical DB subject',
);
check(
  !buildOpsRunNodeLookupKeys(runA).includes('worker'),
  'a canonical run is not indexed under its ambiguous display name',
);
check(
  buildOpsRunNodeLookupKeys(runA).includes(agentA.id),
  'a canonical run remains indexed under its exact DB subject',
);
check(
  buildOpsRunNodeLookupKeys(runA).includes(agentA.sessionKey),
  'a canonical run remains indexed under its exact session alias',
);

const sameNameWrongIdentity: OfficeRunNodeLike = {
  runId: 'run-other-owner',
  agentName: agentA.name,
  subjectKey: '33333333-3333-4333-8333-333333333333',
  subjectDisplayName: agentA.name,
  subjectDbId: '33333333-3333-4333-8333-333333333333',
  subjectAliases: ['codex-session-owner-c'],
};
const wrongIdentityMatches = getOpsRunNodesForAgent(agentA, indexNodes([sameNameWrongIdentity]));
check(
  wrongIdentityMatches.length === 0,
  'a canonical subject mismatch cannot fall back to the same display name',
);

const sessionOnlyA: OfficeRunNodeLike = {
  runId: 'run-session-a',
  agentName: 'Worker',
  subjectKey: agentA.sessionKey,
  subjectDisplayName: 'Worker',
  subjectAliases: [],
};
const sessionOnlyIndex = indexNodes([sessionOnlyA]);
check(
  getOpsRunNodesForAgent(agentA, sessionOnlyIndex).map((node) => node.runId).join(',') === sessionOnlyA.runId,
  'an exact session subject attaches to its matching agent',
);
check(
  getOpsRunNodesForAgent(agentB, sessionOnlyIndex).length === 0,
  'an exact session subject never attaches to a same-name different session',
);

const legacyAgent = {
  id: 'legacy-local-agent',
  name: 'Legacy Reviewer',
  providerType: 'generic-agent',
  sessionKey: null,
} as any;
const legacyRun: OfficeRunNodeLike = {
  runId: 'legacy-name-only-run',
  agentName: 'Legacy Reviewer',
  subjectAliases: [],
};
const legacyKeys = buildOpsRunNodeLookupKeys(legacyRun);
check(
  legacyKeys.join(',') === 'legacy reviewer',
  'an identity-less legacy node retains its normalized display-name lookup key',
);
check(
  getOpsRunNodesForAgent(legacyAgent, indexNodes([legacyRun])).map((node) => node.runId).join(',') === legacyRun.runId,
  'an identity-less legacy node still uses the name fallback',
);

const accountabilityNowMs = Date.parse('2026-08-07T12:00:00.000Z');
const completedAccountabilityRuns: AgentRunLike[] = [
  {
    id: 'completed-owner-a',
    status: 'completed',
    title: 'Owner A result',
    delegated_to: 'Worker',
    completed_at: '2026-08-07T11:50:00.000Z',
    metadata: {
      agentSubjectKey: 'office::owner-a',
      agentDbId: agentA.id,
      agentDisplayName: 'Worker',
    },
  },
  {
    id: 'completed-owner-b',
    status: 'completed',
    title: 'Owner B result',
    delegated_to: 'Worker',
    completed_at: '2026-08-07T11:40:00.000Z',
    metadata: {
      agentSubjectKey: 'office::owner-b',
      agentDbId: agentB.id,
      agentDisplayName: 'Worker',
    },
  },
];
const accountabilityIndex = buildOfficeAgentAccountabilityIndex(completedAccountabilityRuns, {
  nowMs: accountabilityNowMs,
});

check(
  !accountabilityIndex.has('worker'),
  'same-name canonical completed runs do not create an ambiguous display-name accountability bucket',
);
check(
  accountabilityIndex.get('office::owner-a')?.completed24h === 1
    && accountabilityIndex.get('office::owner-a')?.lastLine.includes('Owner A result') === true,
  'first canonical subject key indexes only its completed run',
);
check(
  accountabilityIndex.get(agentA.id)?.completed24h === 1
    && accountabilityIndex.get(agentA.id)?.lastLine.includes('Owner A result') === true,
  'first canonical DB subject indexes only its completed run',
);
check(
  accountabilityIndex.get('office::owner-b')?.completed24h === 1
    && accountabilityIndex.get('office::owner-b')?.lastLine.includes('Owner B result') === true,
  'second canonical subject key indexes only its completed run',
);
check(
  accountabilityIndex.get(agentB.id)?.completed24h === 1
    && accountabilityIndex.get(agentB.id)?.lastLine.includes('Owner B result') === true,
  'second canonical DB subject indexes only its completed run',
);

const legacyAccountability = buildOfficeAgentAccountabilityIndex([
  {
    id: 'completed-legacy-name-only',
    status: 'completed',
    title: 'Legacy result',
    delegated_to: 'Legacy Reviewer',
    completed_at: '2026-08-07T11:30:00.000Z',
  },
], { nowMs: accountabilityNowMs });
check(
  legacyAccountability.get('legacy reviewer')?.completed24h === 1,
  'a genuinely identity-less legacy completed run retains accountability name fallback',
);

if (failures.length > 0) {
  console.error(`office run exact attribution smoke: ${failures.length} failed, ${passed} passed`);
  failures.forEach((failure, index) => console.error(`  ${index + 1}. ${failure}`));
  process.exitCode = 1;
} else {
  console.log(`office run exact attribution smoke: all ${passed} assertions passed`);
}
