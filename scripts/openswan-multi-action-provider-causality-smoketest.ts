/**
 * Grounded derived-output causality guard.
 *
 * A provider can author several tool calls in one response. Sequential handler
 * dispatch does not mean a later call in that response saw an earlier call's
 * result. A source-grounded summary/report therefore requires its claimed read
 * in a strictly earlier provider iteration than artifact publication.
 *
 * Run:
 *   npx tsx scripts/openswan-multi-action-provider-causality-smoketest.ts
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

import { buildLegacyToolEventFromResult } from '../src/lib/openswanSessionRuntimeAdapters';

const runtimePath = resolve(process.cwd(), 'src/lib/openswanSessionRuntime.ts');
const runtimeSource = readFileSync(runtimePath, 'utf8');
const runtimeSourceFile = ts.createSourceFile(
  runtimePath,
  runtimeSource,
  ts.ScriptTarget.ES2022,
  true,
  ts.ScriptKind.TS,
);
const swanbotPath = resolve(process.cwd(), 'src/lib/swanbot.ts');
const swanbotSource = readFileSync(swanbotPath, 'utf8');
const swanbotSourceFile = ts.createSourceFile(
  swanbotPath,
  swanbotSource,
  ts.ScriptTarget.ES2022,
  true,
  ts.ScriptKind.TS,
);

function declarationText(name: string): string {
  for (const statement of runtimeSourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) {
      return statement.getText(runtimeSourceFile);
    }
    if (
      ts.isVariableStatement(statement)
      && statement.declarationList.declarations.some((declaration) => (
        ts.isIdentifier(declaration.name) && declaration.name.text === name
      ))
    ) {
      return statement.getText(runtimeSourceFile);
    }
  }
  assert.fail(`runtime declaration ${name} exists`);
}

type PersistInput = Readonly<{
  runId: string;
  circleId: string;
  artifactKind: string;
  title: string;
  content?: string;
  metadata?: Record<string, unknown>;
}>;

type PersistenceHelper = (args: Record<string, unknown>) => Promise<{
  evidence: ReadonlyArray<Record<string, unknown>>;
  artifacts: ReadonlyArray<Record<string, unknown>>;
}>;

function buildPersistenceHelper(
  addArtifact: (input: PersistInput) => Promise<Record<string, unknown> | null>,
): PersistenceHelper {
  const source = [
    'MULTI_ACTION_ARTIFACT_TOOL',
    'MULTI_ACTION_EVIDENCE_ID_RE',
    'readToolEventProviderIteration',
    'persistTurnMultiActionArtifacts',
  ].map(declarationText).join('\n\n');
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
      strict: true,
    },
  }).outputText;
  const normalizePublication = (input: any) => ({
    ok: true,
    publication: {
      schemaVersion: 1,
      actionId: input.actionId,
      artifactKind: input.artifactKind,
      title: input.title,
      content: input.content,
    },
  });
  const normalizeReport = (input: any) => ({
    ok: true,
    acknowledgement: { actions: input.actions },
  });
  const factory = new Function(
    'normalizeOpenSwanActionArtifactPublication',
    'normalizeOpenSwanActionOutcomeReport',
    'addArtifact',
    'readAgentRunArtifactContentDigest',
    `'use strict';\n${javascript}\nreturn persistTurnMultiActionArtifacts;`,
  );
  const readDigest = (metadata: unknown): { contentDigestVersion: 1; contentDigest: string } | null => {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
    const record = metadata as Record<string, unknown>;
    return record.contentDigestVersion === 1
      && typeof record.contentDigest === 'string'
      && /^sha256:[0-9a-f]{64}$/.test(record.contentDigest)
      ? { contentDigestVersion: 1, contentDigest: record.contentDigest }
      : null;
  };
  return factory(normalizePublication, normalizeReport, addArtifact, readDigest) as PersistenceHelper;
}

function assertLegacyLoopEventsCarryProviderIteration(): void {
  let loop: ts.FunctionDeclaration | null = null;
  for (const statement of swanbotSourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === 'executeToolUseLoop') {
      loop = statement;
      break;
    }
  }
  assert(loop?.body, 'legacy executeToolUseLoop exists');
  const pushes: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && ts.isIdentifier(node.expression.expression)
      && node.expression.expression.text === 'toolEvents'
      && node.expression.name.text === 'push'
    ) pushes.push(node);
    ts.forEachChild(node, visit);
  };
  visit(loop.body);
  assert(pushes.length > 0, 'legacy loop emits tool events');
  for (const push of pushes) {
    const event = push.arguments[0];
    assert(ts.isObjectLiteralExpression(event), 'legacy event is an explicit object');
    const providerIteration = event.properties.find((property) => (
      ts.isPropertyAssignment(property)
      && ts.isIdentifier(property.name)
      && property.name.text === 'providerIteration'
    ));
    assert(providerIteration && ts.isPropertyAssignment(providerIteration), 'legacy event stamps providerIteration');
    assert.equal(
      providerIteration.initializer.getText(swanbotSourceFile),
      'round + 1',
      'legacy event uses the true one-based provider round',
    );
  }
}

const compositeContract = {
  schemaVersion: 1,
  dispatchMode: 'single_openswan_turn',
  actionCount: 1,
  actions: [{
    id: 'A1',
    ordinal: 1,
    dependsOnActionIds: [],
    evidenceToolNames: ['messages.list'],
    evidenceArtifactKinds: ['summary'],
  }],
};
const pureDraftContract = {
  ...compositeContract,
  actions: [{
    id: 'A1',
    ordinal: 1,
    dependsOnActionIds: [],
    evidenceArtifactKinds: ['draft'],
  }],
};

const sourceEvent = {
  tool: 'messages.list',
  toolUseId: 'toolu_source_A1',
  providerIteration: 1,
  status: 'passed',
  input: {},
  result: 'messages read',
};
const publicationEvent = {
  tool: 'run.publish_action_artifact',
  toolUseId: 'toolu_publish_A1',
  providerIteration: 2,
  status: 'passed',
  input: {
    actionId: 'A1',
    artifactKind: 'summary',
    title: 'Message summary',
    content: 'A bounded grounded summary.',
  },
  result: 'accepted',
};
const reportEvent = {
  tool: 'run.report_action_outcomes',
  toolUseId: 'toolu_report',
  providerIteration: 3,
  status: 'passed',
  input: {
    actions: [{
      actionId: 'A1',
      status: 'completed',
      evidenceToolUseIds: ['toolu_source_A1', 'toolu_publish_A1'],
    }],
  },
  result: 'accepted',
};

function exactRow(input: PersistInput): Record<string, unknown> {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    run_id: input.runId,
    circle_id: input.circleId,
    artifact_kind: input.artifactKind,
    title: input.title,
    content: input.content,
    metadata: {
      ...input.metadata,
      ...(typeof input.content === 'string'
        ? {
            contentDigestVersion: 1,
            contentDigest: `sha256:${createHash('sha256').update(input.content, 'utf8').digest('hex')}`,
          }
        : {}),
    },
  };
}

async function runCase(args: {
  contract?: Record<string, unknown>;
  events: ReadonlyArray<Record<string, unknown>>;
}): Promise<{ calls: number; evidenceCount: number; artifactCount: number }> {
  let calls = 0;
  const helper = buildPersistenceHelper(async (input) => {
    calls += 1;
    return exactRow(input);
  });
  const result = await helper({
    contract: args.contract || compositeContract,
    toolEvents: args.events,
    runId: 'run-causality',
    circleId: 'circle-causality',
  });
  return {
    calls,
    evidenceCount: result.evidence.length,
    artifactCount: result.artifacts.length,
  };
}

async function main(): Promise<void> {
  const mapped = buildLegacyToolEventFromResult({
    toolName: 'messages.list',
    toolUseId: 'toolu_typed',
    providerIteration: 4,
    input: {},
    result: { ok: true, data: { text: 'read' } },
  });
  assert.equal(mapped.providerIteration, 4, 'typed provider iteration survives legacy event mapping');
  const invalidMapped = buildLegacyToolEventFromResult({
    toolName: 'messages.list',
    providerIteration: 0,
    input: {},
    result: { ok: true, data: { text: 'read' } },
  });
  assert.equal(invalidMapped.providerIteration, undefined, 'invalid iterations are not normalized into proof');
  assert.match(
    runtimeSource,
    /providerIteration:\s*event\.iteration/,
    'typed AgentEvent.iteration is passed into the shared tool event',
  );
  assertLegacyLoopEventsCarryProviderIteration();

  assert.deepEqual(
    await runCase({ events: [sourceEvent, publicationEvent, reportEvent] }),
    { calls: 1, evidenceCount: 1, artifactCount: 1 },
    'a strictly later publication is persistable evidence',
  );

  for (const [label, source, publication, report] of [
    [
      'same provider iteration',
      { ...sourceEvent, providerIteration: 2 },
      publicationEvent,
      reportEvent,
    ],
    [
      'missing source iteration',
      { ...sourceEvent, providerIteration: undefined },
      publicationEvent,
      reportEvent,
    ],
    [
      'missing publication iteration',
      sourceEvent,
      { ...publicationEvent, providerIteration: undefined },
      reportEvent,
    ],
    [
      'source is later than publication',
      { ...sourceEvent, providerIteration: 3 },
      publicationEvent,
      reportEvent,
    ],
    [
      'source failed',
      { ...sourceEvent, status: 'failed' },
      publicationEvent,
      reportEvent,
    ],
    [
      'wrong source tool',
      { ...sourceEvent, tool: 'goals.list' },
      publicationEvent,
      reportEvent,
    ],
    [
      'source is not claimed for A1',
      sourceEvent,
      publicationEvent,
      {
        ...reportEvent,
        input: {
          actions: [{
            actionId: 'A1',
            status: 'completed',
            evidenceToolUseIds: ['toolu_publish_A1'],
          }],
        },
      },
    ],
  ] as const) {
    assert.deepEqual(
      await runCase({ events: [source, publication, report] }),
      { calls: 0, evidenceCount: 0, artifactCount: 0 },
      `${label} fails grounded publication closed`,
    );
  }

  const pureDraftPublication = {
    ...publicationEvent,
    providerIteration: undefined,
    input: {
      ...publicationEvent.input,
      artifactKind: 'draft',
      title: 'Draft reply',
    },
  };
  const pureDraftReport = {
    ...reportEvent,
    input: {
      actions: [{
        actionId: 'A1',
        status: 'completed',
        evidenceToolUseIds: ['toolu_publish_A1'],
      }],
    },
  };
  assert.deepEqual(
    await runCase({
      contract: pureDraftContract,
      events: [pureDraftPublication, pureDraftReport],
    }),
    { calls: 1, evidenceCount: 1, artifactCount: 1 },
    'a pure draft does not invent a source-round requirement',
  );

  console.log('OpenSwan multi-action provider causality smoke passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
