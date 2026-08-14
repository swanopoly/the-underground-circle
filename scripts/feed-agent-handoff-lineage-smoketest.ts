/**
 * Source-wiring smoke for connected-agent lineage in Feed/Kanban task runs.
 *
 * This intentionally does not import React Native. It pins the durable JSON
 * contract and the two user-visible task-run renderers so transport acceptance
 * can never be presented as completion-looking provider prose.
 *
 * Run directly:
 *   npx tsx scripts/feed-agent-handoff-lineage-smoketest.ts
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath: string) => readFileSync(resolve(repoRoot, relativePath), 'utf8');

const kanbanTypesSource = read('src/types/kanban.ts');
const kanbanHookSource = read('src/hooks/useKanbanData.ts');
const feedTimelineSource = read('src/lib/feedTimelineMergeCore.ts');
const activityFeedSource = read('src/screens/circles/tabs/kanban/ActivityFeedPanel.tsx');
const taskDetailSource = read('src/screens/circles/tabs/kanban/TaskDetailModal.tsx');

function section(source: string, start: string, end: string, label: string): string {
  const startIndex = source.indexOf(start);
  if (startIndex < 0) throw new Error(`${label}: missing start marker ${JSON.stringify(start)}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (endIndex < 0) throw new Error(`${label}: missing end marker ${JSON.stringify(end)}`);
  return source.slice(startIndex, endIndex);
}

const taskRunOutput = section(
  kanbanTypesSource,
  'export interface TaskRunOutput',
  'export interface TaskRun',
  'TaskRunOutput',
);
const handoffWriter = section(
  kanbanHookSource,
  "if (invocationDisposition === 'accepted' || invocationDisposition === 'outcome_unknown')",
  'if (!result.success)',
  'Feed accepted/outcome-unknown writer',
);
const handoffSnapshotReader = section(
  feedTimelineSource,
  'export function readFeedTaskRunHandoffSnapshot',
  '/** Epoch ms from an ISO-ish string',
  'Feed task-run handoff snapshot reader',
);
const activityTaskRunRenderer = section(
  activityFeedSource,
  'const renderTaskRun =',
  'const renderAutomationRun =',
  'Activity Feed task-run renderer',
);
const taskDetailRunRenderer = section(
  taskDetailSource,
  '{taskRuns.slice(0, 5).map(run => {',
  '{/* ── Execution Runtime Panels',
  'Task detail task-run renderer',
);

const failures: string[] = [];

function check(condition: unknown, label: string): void {
  if (!condition) failures.push(label);
}

function expectMatch(source: string, pattern: RegExp, label: string): void {
  check(pattern.test(source), label);
}

function expectNoMatch(source: string, pattern: RegExp, label: string): void {
  check(!pattern.test(source), label);
}

function lineIndex(source: string, pattern: RegExp): number {
  const match = pattern.exec(source);
  return match?.index ?? -1;
}

function assertTruthfulRenderer(source: string, label: string, primaryStylePattern: RegExp): void {
  expectMatch(source, /Handoff accepted · awaiting verified result/, `${label}: accepted handoff has fixed nonterminal banner`);
  expectMatch(source, /Dispatch outcome unknown · verify before retrying/, `${label}: uncertain handoff has fixed verify-before-retry banner`);
  expectMatch(source, /Task run in progress/, `${label}: ordinary running task keeps generic copy`);
  expectMatch(source, /Task run blocked/, `${label}: ordinary blocked task keeps generic copy`);

  expectMatch(source, /readFeedTaskRunHandoffSnapshot\(run\)/, `${label}: renderer consumes the shared bounded handoff snapshot`);
  const fixedFirst = /handoff\s*\?\s*fallbackSummary\s*:\s*\(?\s*run\.summary\s*\|\|\s*fallbackSummary/.test(source)
    || (/\{handoffBanner\}<\/Text>/.test(source) && /!handoff\s*&&\s*\(?\s*run\.summary/.test(source));
  check(fixedFirst, `${label}: fixed handoff summary is selected before ordinary run summary`);

  expectMatch(source, /Provider acknowledgement/i, `${label}: provider prose is explicitly labelled as acknowledgement`);
  expectMatch(
    source,
    /handoff\?\.providerAcknowledgement/,
    `${label}: only a validated handoff snapshot exposes provider acknowledgement`,
  );

  expectMatch(source, /handoff\.externalConnectionId/, `${label}: renderer consumes bounded external connection id`);
  expectMatch(source, /handoff\.externalSessionId/, `${label}: renderer consumes bounded external session id`);
  expectMatch(source, /handoff\.externalProviderRunId/, `${label}: renderer consumes bounded external provider turn id`);

  expectMatch(source, /Connection/i, `${label}: exact connection lineage is labelled`);
  expectMatch(source, /Session/i, `${label}: exact session lineage is labelled`);
  expectMatch(source, /Turn/i, `${label}: exact provider-turn lineage is labelled`);

  const primaryIndex = lineIndex(source, primaryStylePattern);
  const acknowledgementIndex = lineIndex(source, /Provider acknowledgement/i);
  const lineageIndex = lineIndex(source, /connection \{handoff\.externalConnectionId\}/i);
  check(primaryIndex >= 0, `${label}: primary handoff banner is rendered`);
  check(
    primaryIndex >= 0 && acknowledgementIndex > primaryIndex,
    `${label}: provider acknowledgement renders only after the primary handoff banner`,
  );
  check(
    acknowledgementIndex >= 0 && lineageIndex > acknowledgementIndex,
    `${label}: connection/session/turn lineage renders after provider acknowledgement`,
  );
}

// The shared reader is the trust boundary for both renderers. Persisted jsonb
// is hostile input: require the exact status pair, bound provider prose, and
// admit only safe, bounded external identifiers before either UI sees them.
expectMatch(handoffSnapshotReader, /payload\.completion_verified\s*!==\s*false/, 'snapshot reader requires explicitly unverified completion');
expectMatch(
  handoffSnapshotReader,
  /handoffStatus\s*!==\s*'accepted'\s*\|\|\s*value\.status\s*!==\s*'running'/,
  'snapshot reader pairs accepted only with running task runs',
);
expectMatch(
  handoffSnapshotReader,
  /handoffStatus\s*!==\s*'outcome_unknown'\s*\|\|\s*value\.status\s*!==\s*'blocked'/,
  'snapshot reader pairs outcome_unknown only with blocked task runs',
);
const acknowledgementBound = /value\.summary[\s\S]{0,180}\.slice\(0,\s*(\d+)\)/.exec(handoffSnapshotReader);
check(Boolean(acknowledgementBound), 'snapshot reader concretely bounds provider acknowledgement');
if (acknowledgementBound) {
  const limit = Number(acknowledgementBound[1]);
  check(limit > 0 && limit <= 320, 'snapshot reader provider acknowledgement bound is no larger than 320 characters');
}
for (const [payloadField, snapshotField] of [
  ['external_session_id', 'externalSessionId'],
  ['external_connection_id', 'externalConnectionId'],
  ['external_provider_run_id', 'externalProviderRunId'],
] as const) {
  expectMatch(
    handoffSnapshotReader,
    new RegExp(`${snapshotField}:\\s*safeExternalIdentity\\(payload\\.${payloadField}\\)`),
    `snapshot reader sanitizes and bounds ${payloadField}`,
  );
}

// Durable JSON contract: all IDs remain optional and independently typed. The
// external dispatch kind is a closed vocabulary, not arbitrary provider prose.
for (const field of [
  'external_session_id',
  'external_provider_run_id',
  'canonical_agent_run_id',
] as const) {
  expectMatch(
    taskRunOutput,
    new RegExp(`${field}\\s*\\?:\\s*string\\s*\\|\\s*null`),
    `TaskRunOutput exposes optional ${field} as string | null`,
  );
}
expectMatch(
  taskRunOutput,
  /external_connection_id\s*\?:\s*string\s*\|\s*null/,
  'TaskRunOutput exposes optional external_connection_id as string | null',
);
expectMatch(
  taskRunOutput,
  /external_dispatch_kind\s*\?:\s*'sessions_send'\s*\|\s*'sessions_spawn'\s*\|\s*null/,
  'TaskRunOutput exposes optional external_dispatch_kind as the closed dispatch union',
);

// Writer contract: preserve each provider/local identity in its own field for
// both accepted and outcome_unknown branches. Never manufacture one from a
// different identifier namespace.
expectMatch(handoffWriter, /completion_verified:\s*false/, 'handoff writer keeps completion explicitly unverified');
expectMatch(
  handoffWriter,
  /external_session_id:\s*invocationHandoff\?\.sessionId\s*(?:\?\?|\|\|)\s*null/,
  'handoff writer preserves exact external session id',
);
expectMatch(
  handoffWriter,
  /external_dispatch_kind:\s*invocationHandoff\?\.externalDispatchKind\s*(?:\?\?|\|\|)\s*null/,
  'handoff writer preserves exact external dispatch kind',
);
expectMatch(
  handoffWriter,
  /external_connection_id:\s*invocationHandoff\?\.externalConnectionId\s*(?:\?\?|\|\|)\s*null/,
  'handoff writer preserves exact external connection id',
);
expectMatch(
  handoffWriter,
  /external_provider_run_id:\s*invocationHandoff\?\.providerRunId\s*(?:\?\?|\|\|)\s*null/,
  'handoff writer preserves provider-owned run id separately',
);
expectMatch(
  handoffWriter,
  /canonical_agent_run_id:\s*(?:invocationHandoff\?\.runId|[A-Za-z_$][\w$]*canonical[\w$]*RunId)\s*(?:\?\?|\|\|)?\s*null?/i,
  'handoff writer preserves canonical local agent-run id separately',
);
expectNoMatch(
  handoffWriter,
  /external_session_id:[^\n]*(?:providerRunId|externalConnectionId|\.runId)/,
  'handoff writer never substitutes another identifier for session id',
);
expectNoMatch(
  handoffWriter,
  /external_provider_run_id:[^\n]*(?:sessionId|externalConnectionId|\.runId)/,
  'handoff writer never substitutes another identifier for provider run id',
);
expectNoMatch(
  handoffWriter,
  /canonical_agent_run_id:[^\n]*(?:providerRunId|sessionId|externalConnectionId)/,
  'handoff writer never substitutes an external identifier for local run id',
);

assertTruthfulRenderer(
  activityTaskRunRenderer,
  'Activity Feed',
  /style=\{s\.itemAction\}/,
);
assertTruthfulRenderer(
  taskDetailRunRenderer,
  'Task detail',
  /\{handoffBanner\}<\/Text>/,
);

if (failures.length > 0) {
  console.error(`feed-agent-handoff-lineage smoke: ${failures.length} failure${failures.length === 1 ? '' : 's'}`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exitCode = 1;
} else {
  console.log('feed-agent-handoff-lineage smoke: all assertions passed');
}
