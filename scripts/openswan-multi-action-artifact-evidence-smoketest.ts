/**
 * Truth contract for assistant-authored A1-A3 deliverables.
 *
 * A summary/report/translation is complete only when the runtime has durably
 * recorded a bounded non-empty artifact for that exact action before the
 * singleton outcome report. The accounting envelope stays value-free: raw
 * artifact content belongs in the canonical artifact row / normal Chat
 * artifact payload, never evidence, reports, or persisted A# metadata.
 *
 * Run:
 *   npx tsx scripts/openswan-multi-action-artifact-evidence-smoketest.ts
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { resolve } from 'node:path';
import ts from 'typescript';

import {
  OPEN_SWAN_MULTI_ACTION_COMPLETION_LIMITS,
  evaluateOpenSwanMultiActionCompletion,
  type OpenSwanMultiActionCompletionLedger,
} from '../src/lib/openSwanMultiActionCompletionCore';
import {
  formatPersistedChatBotMessage,
  projectPersistedOpenSwanMultiActionCompletion,
  readPersistedChatBotMetadata,
} from '../src/lib/persistedChatMetadata';
import {
  summarizeToolInputForPersistence,
} from '../src/lib/eventBoundCore';

process.env.EXPO_PUBLIC_SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL
  || 'https://multi-action-artifact-smoke.invalid.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
  || 'multi-action-artifact-smoke-anon-key';

const NATIVE_STUBS = new Set([
  'react-native',
  '@react-native-async-storage/async-storage',
]);
const STUB_URL = new URL('./native-module-stub.mjs', import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (NATIVE_STUBS.has(specifier)) return { url: STUB_URL, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

type ActionId = 'A1' | 'A2' | 'A3';
type ArtifactKind = 'report' | 'summary' | 'translation';

const runtimePath = resolve(process.cwd(), 'src/lib/openswanSessionRuntime.ts');
const runtimeSource = readFileSync(runtimePath, 'utf8');
const runtimeSourceFile = ts.createSourceFile(
  runtimePath,
  runtimeSource,
  ts.ScriptTarget.ES2022,
  true,
  ts.ScriptKind.TS,
);
const chatTabPath = resolve(process.cwd(), 'src/screens/circles/tabs/ChatTab.tsx');
const chatTabSource = readFileSync(chatTabPath, 'utf8');
const chatTabSourceFile = ts.createSourceFile(
  chatTabPath,
  chatTabSource,
  ts.ScriptTarget.ES2022,
  true,
  ts.ScriptKind.TSX,
);
const agentRunSystemPath = resolve(process.cwd(), 'src/lib/agentRunSystem.ts');
const agentRunSystemSource = readFileSync(agentRunSystemPath, 'utf8');
const agentRunSystemSourceFile = ts.createSourceFile(
  agentRunSystemPath,
  agentRunSystemSource,
  ts.ScriptTarget.ES2022,
  true,
  ts.ScriptKind.TS,
);
const secretContent = 'PRIVATE_ARTIFACT_CONTENT_DO_NOT_PERSIST_IN_ACTION_ACCOUNTING';
const canonicalArtifactId = '11111111-1111-4111-8111-111111111111';

function declarationTextFrom(
  sourceFile: ts.SourceFile,
  name: string,
  label: string,
): string {
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) {
      return statement.getText(sourceFile);
    }
    if (
      ts.isVariableStatement(statement)
      && statement.declarationList.declarations.some((declaration) => (
        ts.isIdentifier(declaration.name) && declaration.name.text === name
      ))
    ) {
      return statement.getText(sourceFile);
    }
  }
  assert.fail(`${label} declaration ${name} exists`);
}

function runtimeDeclarationText(name: string): string {
  return declarationTextFrom(runtimeSourceFile, name, 'runtime');
}

type PersistArtifactInput = Readonly<{
  runId: string;
  circleId: string;
  artifactKind: string;
  title: string;
  content?: string;
  metadata?: Record<string, unknown>;
}>;

type PersistArtifactResult = Readonly<{
  evidence: ReadonlyArray<Record<string, unknown>>;
  artifacts: ReadonlyArray<Record<string, unknown>>;
  persistedArtifactIds: ReadonlySet<string>;
}>;

function buildPersistTurnMultiActionArtifactsHelper(
  normalizePublication: (input: unknown) => unknown,
  normalizeReport: (input: unknown) => unknown,
  addArtifactImpl: (input: PersistArtifactInput) => Promise<Record<string, unknown> | null>,
): (args: Record<string, unknown>) => Promise<PersistArtifactResult> {
  const source = [
    'MULTI_ACTION_ARTIFACT_TOOL',
    'MULTI_ACTION_EVIDENCE_ID_RE',
    'persistTurnMultiActionArtifacts',
  ].map(runtimeDeclarationText).join('\n\n');
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
      strict: true,
    },
  }).outputText;
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
  return factory(normalizePublication, normalizeReport, addArtifactImpl, readDigest) as (
    args: Record<string, unknown>,
  ) => Promise<PersistArtifactResult>;
}

type HydratableMessage = Readonly<{
  id: string;
  runId?: string;
  artifacts?: ReadonlyArray<Record<string, any>>;
}>;

function buildHydrateCanonicalActionArtifactsHelper(
  getArtifacts: (
    circleId: string,
    artifactIds: readonly string[],
  ) => Promise<ReadonlyArray<Record<string, any>>>,
): (messages: HydratableMessage[], circleId: string) => Promise<HydratableMessage[]> {
  const source = declarationTextFrom(
    chatTabSourceFile,
    'hydrateCanonicalActionArtifacts',
    'ChatTab',
  );
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
      strict: true,
    },
  }).outputText;
  const factory = new Function(
    'getRunArtifactsByIds',
    'verifyAgentRunArtifactContentDigest',
    `'use strict';\n${javascript}\nreturn hydrateCanonicalActionArtifacts;`,
  );
  const verifyDigest = (
    content: unknown,
    rowMetadata: unknown,
    pointerMetadata: unknown,
  ): boolean => {
    if (typeof content !== 'string' || !rowMetadata || !pointerMetadata) return false;
    const row = rowMetadata as Record<string, unknown>;
    const pointer = pointerMetadata as Record<string, unknown>;
    const digest = `sha256:${createHash('sha256').update(content, 'utf8').digest('hex')}`;
    return row.contentDigestVersion === 1
      && pointer.contentDigestVersion === 1
      && row.contentDigest === digest
      && pointer.contentDigest === digest;
  };
  return factory(getArtifacts, verifyDigest) as (
    messages: HydratableMessage[],
    circleId: string,
  ) => Promise<HydratableMessage[]>;
}

type ArtifactQueryClient = Readonly<{
  from: (table: string) => unknown;
}>;

function buildGetRunArtifactsByIdsHelper(
  supabaseClient: ArtifactQueryClient,
): (circleId: string, artifactIds: readonly string[]) => Promise<Record<string, unknown>[]> {
  const source = declarationTextFrom(
    agentRunSystemSourceFile,
    'getRunArtifactsByIds',
    'agentRunSystem',
  ).replace(/^export\s+/, '');
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
      strict: true,
    },
  }).outputText;
  const factory = new Function(
    'supabase',
    'mapArtifact',
    `'use strict';\n${javascript}\nreturn getRunArtifactsByIds;`,
  );
  return factory(supabaseClient, (row: Record<string, unknown>) => row) as (
    circleId: string,
    artifactIds: readonly string[],
  ) => Promise<Record<string, unknown>[]>;
}

function ledger(
  dependencies: ReadonlyArray<ReadonlyArray<ActionId>> = [[], ['A1']],
): OpenSwanMultiActionCompletionLedger {
  return {
    schemaVersion: 1,
    dispatchMode: 'single_openswan_turn',
    actionCount: 2,
    actions: [
      {
        id: 'A1',
        ordinal: 1,
        dependsOnActionIds: dependencies[0] || [],
        evidenceArtifactKinds: ['report'],
      },
      {
        id: 'A2',
        ordinal: 2,
        dependsOnActionIds: dependencies[1] || [],
        evidenceArtifactKinds: ['translation'],
      },
    ],
  };
}

function artifactEvidence(args: {
  evidenceId: string;
  sequence: number;
  actionId: ActionId;
  artifactKind: ArtifactKind;
  contentPresent?: boolean;
  durablyRecorded?: boolean;
}) {
  return {
    evidenceId: args.evidenceId,
    sequence: args.sequence,
    status: 'succeeded' as const,
    kind: 'artifact' as const,
    actionId: args.actionId,
    artifactKind: args.artifactKind,
    contentPresent: args.contentPresent ?? true,
    durablyRecorded: args.durablyRecorded ?? true,
  };
}

function completedReport(
  actionId: ActionId,
  evidenceId: string,
  reportedAtSequence = 20,
) {
  return {
    actionId,
    status: 'completed' as const,
    reportedAtSequence,
    evidenceIds: [evidenceId],
  };
}

function evaluate(overrides: Record<string, unknown> = {}) {
  return evaluateOpenSwanMultiActionCompletion({
    ledger: ledger(),
    evidence: [
      artifactEvidence({ evidenceId: 'toolu_publish_A1', sequence: 1, actionId: 'A1', artifactKind: 'report' }),
      artifactEvidence({ evidenceId: 'toolu_publish_A2', sequence: 2, actionId: 'A2', artifactKind: 'translation' }),
    ],
    reports: [
      completedReport('A1', 'toolu_publish_A1'),
      completedReport('A2', 'toolu_publish_A2'),
    ],
    ...overrides,
  });
}

function assertNotVerified(outcome: ReturnType<typeof evaluate>, message: string): void {
  assert.equal(outcome.completionVerified, false, message);
  assert.notEqual(outcome.disposition, 'verified', message);
}

async function main(): Promise<void> {
  const {
    acknowledgeOpenSwanActionArtifactPublication,
    normalizeOpenSwanActionArtifactPublication,
    normalizeOpenSwanActionOutcomeReport,
  } = await import('../src/lib/openswanToolRuntime');

  // Publication input is a strict, bounded content boundary. The normalized
  // content may be written to agent_run_artifacts; it is never completion proof
  // until that exact write succeeds.
  const normalized = normalizeOpenSwanActionArtifactPublication({
  actionId: 'A1',
  artifactKind: 'report',
  title: '  Launch findings  ',
  content: `  ${secretContent}  `,
});
assert.equal(normalized.ok, true);
if (!normalized.ok) assert.fail(normalized.errorCode);
assert.deepEqual(normalized.publication, {
  schemaVersion: 1,
  actionId: 'A1',
  artifactKind: 'report',
  title: 'Launch findings',
  content: secretContent,
});
assert(Object.isFrozen(normalized.publication));

const exactLimitPublication = normalizeOpenSwanActionArtifactPublication({
  actionId: 'A2',
  artifactKind: 'translation',
  title: 'T'.repeat(160),
  content: 'C'.repeat(12_000),
});
assert.equal(exactLimitPublication.ok, true);

const acknowledgement = acknowledgeOpenSwanActionArtifactPublication({
  actionId: 'A1',
  artifactKind: 'report',
  title: 'Launch findings',
  content: secretContent,
});
assert.equal(acknowledgement.ok, true);
assert.deepEqual(acknowledgement.acknowledgement, {
  schemaVersion: 1,
  kind: 'bounded_action_artifact_publication',
  actionId: 'A1',
  artifactKind: 'report',
  titleLength: 15,
  contentLength: secretContent.length,
  completionDecision: 'not_evaluated',
});
assert(!JSON.stringify(acknowledgement).includes(secretContent));
assert(!Object.prototype.hasOwnProperty.call(acknowledgement, 'completionVerified'));

for (const invalid of [
  { actionId: 'A4', artifactKind: 'report', title: 'Title', content: 'Body' },
  { actionId: 'A1', artifactKind: 'unknown', title: 'Title', content: 'Body' },
  { actionId: 'A1', artifactKind: 'report', title: '', content: 'Body' },
  { actionId: 'A1', artifactKind: 'report', title: '   ', content: 'Body' },
  { actionId: 'A1', artifactKind: 'report', title: 'T'.repeat(161), content: 'Body' },
  { actionId: 'A1', artifactKind: 'report', title: 'Title', content: '' },
  { actionId: 'A1', artifactKind: 'report', title: 'Title', content: '   ' },
  { actionId: 'A1', artifactKind: 'report', title: 'Title', content: 'C'.repeat(12_001) },
  { actionId: 'A1', artifactKind: 'report', title: 'Title', content: 'Body', prose: 'all done' },
]) {
  assert.equal(normalizeOpenSwanActionArtifactPublication(invalid).ok, false);
}

// Happy path: exact A# + allowed kind + successful durable, content-present
// receipt, followed by the report. Evidence contains no artifact value.
const verified = evaluate();
assert.equal(verified.inputValid, true);
assert.equal(verified.disposition, 'verified');
assert.equal(verified.completionVerified, true);
assert(!JSON.stringify(verified).includes(secretContent));

// A source-grounded deliverable may require both the exact read receipt and
// the durably recorded artifact; neither half can invalidate or replace the
// other.
const grounded = evaluate({
  ledger: {
    ...ledger([[], []]),
    actions: [
      {
        id: 'A1',
        ordinal: 1,
        dependsOnActionIds: [],
        evidenceToolNames: ['messages.list'],
        evidenceArtifactKinds: ['summary'],
      },
      {
        id: 'A2',
        ordinal: 2,
        dependsOnActionIds: [],
        evidenceArtifactKinds: ['translation'],
      },
    ],
  },
  evidence: [
    {
      evidenceId: 'toolu_messages_A1',
      sequence: 1,
      status: 'succeeded',
      kind: 'tool',
      tool: 'messages.list',
    },
    artifactEvidence({ evidenceId: 'toolu_publish_A1', sequence: 2, actionId: 'A1', artifactKind: 'summary' }),
    artifactEvidence({ evidenceId: 'toolu_publish_A2', sequence: 3, actionId: 'A2', artifactKind: 'translation' }),
  ],
  reports: [
    {
      actionId: 'A1',
      status: 'completed',
      reportedAtSequence: 20,
      evidenceIds: ['toolu_messages_A1', 'toolu_publish_A1'],
    },
    completedReport('A2', 'toolu_publish_A2'),
  ],
});
assert.equal(grounded.inputValid, true);
assert.equal(grounded.completionVerified, true);

// A provider-generated sentence cannot substitute for an artifact receipt.
const proseOnly = evaluate({
  evidence: [],
  reports: [],
  providerProse: `A1 and A2 are done. ${secretContent}`,
});
assertNotVerified(proseOnly, 'provider prose must not complete derived actions');
assert(!JSON.stringify(proseOnly).includes(secretContent));

// Missing artifact evidence leaves the derived action honestly incomplete.
const missingArtifact = evaluate({
  evidence: [artifactEvidence({
    evidenceId: 'toolu_publish_A1',
    sequence: 1,
    actionId: 'A1',
    artifactKind: 'report',
  })],
  reports: [completedReport('A1', 'toolu_publish_A1')],
});
assertNotVerified(missingArtifact, 'a missing derived artifact must stay incomplete');
assert(missingArtifact.unresolvedActionIds.includes('A2'));

// A receipt is useful only for its exact A# and allowed artifact kind.
const wrongAction = evaluate({
  evidence: [
    artifactEvidence({ evidenceId: 'toolu_publish_A1', sequence: 1, actionId: 'A2', artifactKind: 'report' }),
    artifactEvidence({ evidenceId: 'toolu_publish_A2', sequence: 2, actionId: 'A2', artifactKind: 'translation' }),
  ],
});
assertNotVerified(wrongAction, 'cross-action artifact binding must fail closed');

const wrongKind = evaluate({
  evidence: [
    artifactEvidence({ evidenceId: 'toolu_publish_A1', sequence: 1, actionId: 'A1', artifactKind: 'translation' }),
    artifactEvidence({ evidenceId: 'toolu_publish_A2', sequence: 2, actionId: 'A2', artifactKind: 'translation' }),
  ],
});
assertNotVerified(wrongKind, 'wrong artifact kind must fail closed');

// A publication after the report is future evidence, never retroactive proof.
const futureArtifact = evaluate({
  reports: [
    completedReport('A1', 'toolu_publish_A1', 1),
    completedReport('A2', 'toolu_publish_A2', 3),
  ],
});
assertNotVerified(futureArtifact, 'artifact publication must precede its report');
assert(futureArtifact.issues.some((issue) => issue.code === 'future_evidence_ref'));

// One runtime evidence id has one action owner, even if both reports cite it.
const crossOwned = evaluate({
  ledger: ledger([[], []]),
  evidence: [artifactEvidence({
    evidenceId: 'toolu_publish_shared',
    sequence: 1,
    actionId: 'A1',
    artifactKind: 'report',
  })],
  reports: [
    completedReport('A1', 'toolu_publish_shared'),
    completedReport('A2', 'toolu_publish_shared'),
  ],
});
assertNotVerified(crossOwned, 'one artifact receipt cannot be cross-owned');
assert(crossOwned.issues.some((issue) => issue.code === 'evidence_cross_owned'));

// Safe runtime/provider tool-use ids only: prose, whitespace, and oversize ids
// are rejected by the same value-free evidence parser.
for (const evidenceId of [
  '<artifact>',
  'contains whitespace',
  'x'.repeat(OPEN_SWAN_MULTI_ACTION_COMPLETION_LIMITS.maxEvidenceIdChars + 1),
]) {
  const unsafe = evaluate({
    evidence: [artifactEvidence({
      evidenceId,
      sequence: 1,
      actionId: 'A1',
      artifactKind: 'report',
    })],
    reports: [completedReport('A1', evidenceId)],
  });
  assertNotVerified(unsafe, `unsafe evidence id must be rejected: ${evidenceId.slice(0, 20)}`);
  assert.equal(unsafe.inputValid, false);
}

// Content-presence and durable-recording facts are runtime-owned booleans.
// A model-shaped artifact, failed insert, or title-only artifact cannot pass.
for (const receipt of [
  artifactEvidence({
    evidenceId: 'toolu_publish_A1',
    sequence: 1,
    actionId: 'A1',
    artifactKind: 'report',
    contentPresent: false,
  }),
  artifactEvidence({
    evidenceId: 'toolu_publish_A1',
    sequence: 1,
    actionId: 'A1',
    artifactKind: 'report',
    durablyRecorded: false,
  }),
]) {
  const unproven = evaluate({
    evidence: [
      receipt,
      artifactEvidence({ evidenceId: 'toolu_publish_A2', sequence: 2, actionId: 'A2', artifactKind: 'translation' }),
    ],
  });
  assertNotVerified(unproven, 'artifact must be both non-empty and durably recorded');
}

// Raw values are forbidden in the evidence envelope, reports, and persisted
// A# projection even though the canonical artifact row owns the content.
for (const rawField of ['content', 'title', 'metadata', 'url']) {
  const rawEvidence = evaluate({
    evidence: [
      {
        ...artifactEvidence({ evidenceId: 'toolu_publish_A1', sequence: 1, actionId: 'A1', artifactKind: 'report' }),
        [rawField]: secretContent,
      },
      artifactEvidence({ evidenceId: 'toolu_publish_A2', sequence: 2, actionId: 'A2', artifactKind: 'translation' }),
    ],
  });
  assertNotVerified(rawEvidence, `raw ${rawField} must not enter artifact evidence`);
  assert.equal(rawEvidence.inputValid, false);
  assert(!JSON.stringify(rawEvidence).includes(secretContent));
}

const persisted = projectPersistedOpenSwanMultiActionCompletion(verified);
assert(persisted);
assert(!JSON.stringify(persisted).includes(secretContent));
assert(!JSON.stringify(persisted).includes('toolu_publish'));

const durableToolInputPreview = summarizeToolInputForPersistence(
  'run.publish_action_artifact',
  normalized.publication,
);
assert.equal(durableToolInputPreview.redacted, true);
assert(!JSON.stringify(durableToolInputPreview).includes(secretContent));
assert(!JSON.stringify(durableToolInputPreview).includes('Launch findings'));

const publicationEvent = {
  tool: 'run.publish_action_artifact',
  toolUseId: 'toolu_publish_A1',
  status: 'passed',
  input: {
    actionId: 'A1',
    artifactKind: 'report',
    title: 'Launch findings',
    content: secretContent,
  },
  result: 'structurally accepted',
};
const reportEvent = {
  tool: 'run.report_action_outcomes',
  toolUseId: 'toolu_report',
  status: 'passed',
  input: {
    actions: [{
      actionId: 'A1',
      status: 'completed',
      evidenceToolUseIds: ['toolu_publish_A1'],
    }],
  },
  result: 'structurally accepted',
};

// Exercise the private persistence owner with an injected database boundary.
// This proves behavior without exporting a test-shaped Supabase API.
const persistedInputs: PersistArtifactInput[] = [];
const exactPersistedRow = (
  input: PersistArtifactInput,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id: canonicalArtifactId,
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
  ...overrides,
});
const persistArtifacts = buildPersistTurnMultiActionArtifactsHelper(
  normalizeOpenSwanActionArtifactPublication,
  normalizeOpenSwanActionOutcomeReport,
  async (input) => {
    persistedInputs.push(input);
    return exactPersistedRow(input);
  },
);
const persistedSuccess = await persistArtifacts({
  contract: ledger(),
  toolEvents: [publicationEvent, reportEvent],
  runId: 'run-exact',
  circleId: 'circle-exact',
});
assert.equal(persistedInputs.length, 1);
assert.deepEqual(persistedInputs[0], {
  runId: 'run-exact',
  circleId: 'circle-exact',
  artifactKind: 'report',
  title: 'Launch findings',
  content: secretContent,
  metadata: {
    source: 'openswan_action_artifact',
    actionId: 'A1',
    artifactKind: 'report',
  },
});
assert.deepEqual(persistedSuccess.evidence, [{
  evidenceId: 'toolu_publish_A1',
  sequence: 1,
  status: 'succeeded',
  kind: 'artifact',
  actionId: 'A1',
  artifactKind: 'report',
  contentPresent: true,
  durablyRecorded: true,
}]);
assert.deepEqual([...persistedSuccess.persistedArtifactIds], [canonicalArtifactId]);
assert.equal(persistedSuccess.artifacts.length, 1);
assert.equal(persistedSuccess.artifacts[0]?.content, secretContent);
assert.equal(
  (persistedSuccess.artifacts[0]?.metadata as Record<string, unknown>)?.canonicalArtifactId,
  canonicalArtifactId,
);
assert.equal(
  (persistedSuccess.artifacts[0]?.metadata as Record<string, unknown>)?.contentDigest,
  `sha256:${createHash('sha256').update(secretContent, 'utf8').digest('hex')}`,
);
assert.match(canonicalArtifactId, /^[0-9a-f-]{36}$/i);
assert(!JSON.stringify(persistedSuccess.artifacts[0]?.metadata).includes(secretContent));
assert(!JSON.stringify(persistedSuccess.evidence).includes(secretContent));
assert(Object.isFrozen(persistedSuccess));
assert(Object.isFrozen(persistedSuccess.evidence));
assert(Object.isFrozen(persistedSuccess.evidence[0]));

async function persistenceFailureCase(
  label: string,
  addArtifactImpl: (input: PersistArtifactInput) => Promise<Record<string, unknown> | null>,
): Promise<void> {
  const helper = buildPersistTurnMultiActionArtifactsHelper(
    normalizeOpenSwanActionArtifactPublication,
    normalizeOpenSwanActionOutcomeReport,
    addArtifactImpl,
  );
  const result = await helper({
    contract: ledger(),
    toolEvents: [publicationEvent, reportEvent],
    runId: 'run-exact',
    circleId: 'circle-exact',
  });
  assert.deepEqual(result.evidence, [], `${label}: no evidence`);
  assert.deepEqual(result.artifacts, [], `${label}: no Chat artifact`);
  assert.deepEqual([...result.persistedArtifactIds], [], `${label}: no persisted id`);
}

await persistenceFailureCase('null insert', async () => null);
await persistenceFailureCase('thrown insert', async () => { throw new Error('database unavailable'); });
await persistenceFailureCase('wrong run row', async (input) => exactPersistedRow(input, {
  id: 'artifact-wrong-run',
  run_id: 'different-run',
}));
await persistenceFailureCase('wrong circle row', async (input) => exactPersistedRow(input, {
  id: 'artifact-wrong-circle',
  circle_id: 'different-circle',
}));
await persistenceFailureCase('wrong artifact kind row', async (input) => exactPersistedRow(input, {
  id: 'artifact-wrong-kind',
  artifact_kind: 'translation',
}));
await persistenceFailureCase('wrong metadata owner row', async (input) => exactPersistedRow(input, {
  id: 'artifact-wrong-owner',
  metadata: {
    source: 'openswan_action_artifact',
    actionId: 'A2',
    artifactKind: input.artifactKind,
  },
}));
await persistenceFailureCase('wrong title row', async (input) => exactPersistedRow(input, {
  id: 'artifact-wrong-title',
  title: 'Different title',
}));
await persistenceFailureCase('wrong content row', async (input) => exactPersistedRow(input, {
  id: 'artifact-wrong-content',
  content: 'Different content',
}));
await persistenceFailureCase('missing returned id', async (input) => exactPersistedRow(input, {
  id: '',
}));

// Invalid, failed, unsafe-id, wrong-A#, wrong-kind, and duplicate publication
// events cannot reach the durable writer or mint evidence.
let rejectedPersistenceCalls = 0;
const rejectUnboundPublications = buildPersistTurnMultiActionArtifactsHelper(
  normalizeOpenSwanActionArtifactPublication,
  normalizeOpenSwanActionOutcomeReport,
  async () => {
    rejectedPersistenceCalls += 1;
    return null;
  },
);
const rejectedPublications = await rejectUnboundPublications({
  contract: ledger(),
  toolEvents: [
    { ...publicationEvent, status: 'failed' },
    { ...publicationEvent, toolUseId: '<unsafe>' },
    { ...publicationEvent, toolUseId: 'wrong-action', input: { ...publicationEvent.input, actionId: 'A3' } },
    { ...publicationEvent, toolUseId: 'wrong-kind', input: { ...publicationEvent.input, artifactKind: 'translation' } },
    { ...publicationEvent, toolUseId: 'malformed', input: { actionId: 'A1' } },
  ],
  runId: 'run-exact',
  circleId: 'circle-exact',
});
assert.equal(rejectedPersistenceCalls, 0);
assert.deepEqual(rejectedPublications.evidence, []);

async function assertPublicationNotPersisted(
  label: string,
  toolEvents: ReadonlyArray<Record<string, unknown>>,
): Promise<void> {
  let calls = 0;
  const helper = buildPersistTurnMultiActionArtifactsHelper(
    normalizeOpenSwanActionArtifactPublication,
    normalizeOpenSwanActionOutcomeReport,
    async (input) => {
      calls += 1;
      return exactPersistedRow(input);
    },
  );
  const result = await helper({
    contract: ledger([[], []]),
    toolEvents,
    runId: 'run-exact',
    circleId: 'circle-exact',
  });
  assert.equal(calls, 0, `${label}: no durable write`);
  assert.deepEqual(result.evidence, [], `${label}: no evidence`);
  assert.deepEqual(result.artifacts, [], `${label}: no Chat artifact`);
}

await assertPublicationNotPersisted('publication is not claimed', [
  publicationEvent,
  {
    ...reportEvent,
    input: {
      actions: [{ actionId: 'A1', status: 'completed', evidenceToolUseIds: [] }],
    },
  },
]);
await assertPublicationNotPersisted('publication follows report', [reportEvent, publicationEvent]);
await assertPublicationNotPersisted('multiple reports make ownership ambiguous', [
  publicationEvent,
  reportEvent,
  reportEvent,
]);
await assertPublicationNotPersisted('failed report is not a terminal barrier', [
  publicationEvent,
  { ...reportEvent, status: 'failed' },
]);
await assertPublicationNotPersisted('report claims artifact for wrong action', [
  publicationEvent,
  {
    ...reportEvent,
    input: {
      actions: [{
        actionId: 'A2',
        status: 'completed',
        evidenceToolUseIds: ['toolu_publish_A1'],
      }],
    },
  },
]);
await assertPublicationNotPersisted('artifact id is cross-owned by reports', [
  publicationEvent,
  {
    ...reportEvent,
    input: {
      actions: [
        { actionId: 'A1', status: 'completed', evidenceToolUseIds: ['toolu_publish_A1'] },
        { actionId: 'A2', status: 'completed', evidenceToolUseIds: ['toolu_publish_A1'] },
      ],
    },
  },
]);

let duplicatePersistenceCalls = 0;
const rejectDuplicateEvidenceId = buildPersistTurnMultiActionArtifactsHelper(
  normalizeOpenSwanActionArtifactPublication,
  normalizeOpenSwanActionOutcomeReport,
  async (input) => {
    duplicatePersistenceCalls += 1;
    return exactPersistedRow(input, { id: `artifact-${duplicatePersistenceCalls}` });
  },
);
const duplicatePublication = await rejectDuplicateEvidenceId({
  contract: ledger(),
  toolEvents: [publicationEvent, publicationEvent, reportEvent],
  runId: 'run-exact',
  circleId: 'circle-exact',
});
assert.equal(duplicatePersistenceCalls, 1);
assert.equal(duplicatePublication.evidence.length, 1);

for (const missingScope of [
  { runId: null, circleId: 'circle-exact' },
  { runId: 'run-exact', circleId: null },
]) {
  const noScope = await persistArtifacts({
    contract: ledger(),
    toolEvents: [publicationEvent],
    ...missingScope,
  });
  assert.deepEqual(noScope.evidence, []);
}

// Saved Chat metadata keeps only a bounded copy and the opaque canonical row
// pointer. A long visible response forces the normal compact persistence tier,
// exercising the real 1,200-character artifact copy boundary.
const longArtifactContent = `FULL:${'a'.repeat(3_995)}`;
const formattedPersistedMessage = formatPersistedChatBotMessage(
  'OpenSwan',
  'v'.repeat(6_400),
  {
    runId: 'run-exact',
    artifacts: [{
      kind: 'summary',
      title: 'Launch findings',
      content: longArtifactContent,
      metadata: {
        source: 'openswan_action_artifact',
        actionId: 'A1',
        artifactKind: 'report',
        canonicalArtifactId,
        contentTruncated: false,
      },
    }],
  },
);
const reloadedMetadata = readPersistedChatBotMetadata(formattedPersistedMessage);
const savedArtifact = reloadedMetadata?.artifacts?.[0];
assert(savedArtifact, 'canonical artifact survives compact saved Chat metadata');
assert.equal(savedArtifact.metadata?.canonicalArtifactId, canonicalArtifactId);
assert.equal(savedArtifact.metadata?.contentTruncated, true);
assert.equal(savedArtifact.metadata?.source, 'openswan_action_artifact');
assert.equal(savedArtifact.metadata?.actionId, 'A1');
assert.equal(savedArtifact.metadata?.artifactKind, 'report');
assert.equal(typeof savedArtifact.content, 'string');
assert((savedArtifact.content?.length || 0) <= 1_200);
assert.notEqual(savedArtifact.content, longArtifactContent);

// The canonical row reader performs one bounded circle-scoped batch. Invalid
// and duplicate ids are removed before query construction, and at most 32 ids
// cross the database boundary.
const candidateArtifactIds = Array.from({ length: 40 }, (_, index) => (
  `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`
));
const artifactQueryCalls: Array<readonly unknown[]> = [];
const queryRows = [{ id: candidateArtifactIds[0], circle_id: 'circle-exact' }];
const queryBuilder = {
  select(fields: string) {
    artifactQueryCalls.push(['select', fields]);
    return this;
  },
  eq(column: string, value: string) {
    artifactQueryCalls.push(['eq', column, value]);
    return this;
  },
  in(column: string, values: readonly string[]) {
    artifactQueryCalls.push(['in', column, [...values]]);
    return this;
  },
  limit(value: number) {
    artifactQueryCalls.push(['limit', value]);
    return Promise.resolve({ data: queryRows, error: null });
  },
};
const getArtifactsByIds = buildGetRunArtifactsByIdsHelper({
  from(table: string) {
    artifactQueryCalls.push(['from', table]);
    return queryBuilder;
  },
});
const queriedArtifacts = await getArtifactsByIds('circle-exact', [
  'not-an-artifact-id',
  candidateArtifactIds[0]!,
  candidateArtifactIds[0]!,
  ...candidateArtifactIds.slice(1),
]);
assert.deepEqual(queriedArtifacts, queryRows);
assert.equal(artifactQueryCalls.filter(([kind]) => kind === 'from').length, 1);
assert.deepEqual(artifactQueryCalls[0], ['from', 'agent_run_artifacts']);
assert.deepEqual(artifactQueryCalls[1], ['select', '*']);
assert.deepEqual(artifactQueryCalls[2], ['eq', 'circle_id', 'circle-exact']);
assert.equal(artifactQueryCalls[3]?.[0], 'in');
assert.equal(artifactQueryCalls[3]?.[1], 'id');
assert.deepEqual(artifactQueryCalls[3]?.[2], candidateArtifactIds.slice(0, 32));
assert.deepEqual(artifactQueryCalls[4], ['limit', 32]);
const callsBeforeEmptyQuery = artifactQueryCalls.length;
assert.deepEqual(await getArtifactsByIds('circle-exact', ['invalid']), []);
assert.deepEqual(await getArtifactsByIds('', [candidateArtifactIds[0]!]), []);
assert.equal(artifactQueryCalls.length, callsBeforeEmptyQuery);

const truncatedArtifact = {
  kind: 'summary',
  title: 'Launch findings',
  content: savedArtifact.content,
  metadata: {
    source: 'openswan_action_artifact',
    actionId: 'A1',
    artifactKind: 'report',
    canonicalArtifactId,
    contentTruncated: true,
    contentDigestVersion: 1,
    contentDigest: `sha256:${createHash('sha256').update(longArtifactContent, 'utf8').digest('hex')}`,
  },
};
const truncatedMessage: HydratableMessage = {
  id: 'message-1',
  runId: 'run-exact',
  artifacts: [truncatedArtifact],
};
const exactCanonicalRow = {
  id: canonicalArtifactId,
  run_id: 'run-exact',
  circle_id: 'circle-exact',
  artifact_kind: 'report',
  title: 'Launch findings',
  content: longArtifactContent,
  metadata: {
    source: 'openswan_action_artifact',
    actionId: 'A1',
    artifactKind: 'report',
    contentDigestVersion: 1,
    contentDigest: `sha256:${createHash('sha256').update(longArtifactContent, 'utf8').digest('hex')}`,
  },
};

// Hydration is one batch and replaces only the copy whose pointer and complete
// durable lineage match the enclosing Chat message.
const hydrationCalls: Array<{ circleId: string; artifactIds: readonly string[] }> = [];
const hydrateExact = buildHydrateCanonicalActionArtifactsHelper(async (circleId, artifactIds) => {
  hydrationCalls.push({ circleId, artifactIds: [...artifactIds] });
  return [exactCanonicalRow];
});
const hydrated = await hydrateExact([truncatedMessage], 'circle-exact');
assert.deepEqual(hydrationCalls, [{ circleId: 'circle-exact', artifactIds: [canonicalArtifactId] }]);
assert.equal(hydrated[0]?.artifacts?.[0]?.content, longArtifactContent);
assert.equal(hydrated[0]?.artifacts?.[0]?.metadata?.contentTruncated, false);
assert.equal(hydrated[0]?.artifacts?.[0]?.metadata?.canonicalArtifactId, canonicalArtifactId);

async function assertHydrationStaysTruncated(
  label: string,
  rows: ReadonlyArray<Record<string, any>>,
  message: HydratableMessage = truncatedMessage,
): Promise<void> {
  let batchCalls = 0;
  const hydrate = buildHydrateCanonicalActionArtifactsHelper(async () => {
    batchCalls += 1;
    return rows;
  });
  const output = await hydrate([message], 'circle-exact');
  const artifact = output[0]?.artifacts?.[0];
  if (message.artifacts?.[0]?.metadata?.contentTruncated === true) {
    assert.equal(batchCalls, 1, `${label}: one batch lookup`);
  }
  assert.equal(artifact?.content, message.artifacts?.[0]?.content, `${label}: preserve bounded copy`);
  assert.equal(artifact?.metadata?.contentTruncated, true, `${label}: remain visibly truncated`);
}

await assertHydrationStaysTruncated('missing row', []);
for (const [label, row] of [
  ['wrong artifact id', { ...exactCanonicalRow, id: '22222222-2222-4222-8222-222222222222' }],
  ['wrong message run', { ...exactCanonicalRow, run_id: 'run-other' }],
  ['wrong circle', { ...exactCanonicalRow, circle_id: 'circle-other' }],
  ['wrong canonical row kind', { ...exactCanonicalRow, artifact_kind: 'translation' }],
  ['wrong title', { ...exactCanonicalRow, title: 'Other findings' }],
  ['wrong source', { ...exactCanonicalRow, metadata: { ...exactCanonicalRow.metadata, source: 'other' } }],
  ['wrong action owner', { ...exactCanonicalRow, metadata: { ...exactCanonicalRow.metadata, actionId: 'A2' } }],
  ['wrong artifact kind', { ...exactCanonicalRow, metadata: { ...exactCanonicalRow.metadata, artifactKind: 'translation' } }],
  ['wrong row content digest', { ...exactCanonicalRow, metadata: { ...exactCanonicalRow.metadata, contentDigest: `sha256:${'f'.repeat(64)}` } }],
  ['missing content', { ...exactCanonicalRow, content: '' }],
] as const) {
  await assertHydrationStaysTruncated(label, [row]);
}
await assertHydrationStaysTruncated(
  'wrong pointer content digest',
  [exactCanonicalRow],
  {
    ...truncatedMessage,
    artifacts: [{
      ...truncatedArtifact,
      metadata: { ...truncatedArtifact.metadata, contentDigest: `sha256:${'e'.repeat(64)}` },
    }],
  },
);

// Non-truncated artifacts never trigger a canonical read, and a message with
// no exact run identity cannot accept otherwise matching row content.
let unnecessaryHydrationCalls = 0;
const skipCompleteArtifact = buildHydrateCanonicalActionArtifactsHelper(async () => {
  unnecessaryHydrationCalls += 1;
  return [exactCanonicalRow];
});
const alreadyCompleteMessage: HydratableMessage = {
  ...truncatedMessage,
  artifacts: [{
    ...truncatedArtifact,
    content: longArtifactContent,
    metadata: { ...truncatedArtifact.metadata, contentTruncated: false },
  }],
};
assert.strictEqual(
  await skipCompleteArtifact([alreadyCompleteMessage], 'circle-exact')
    .then((messages) => messages[0]),
  alreadyCompleteMessage,
);
assert.equal(unnecessaryHydrationCalls, 0);
await assertHydrationStaysTruncated(
  'message lacks run identity',
  [exactCanonicalRow],
  { ...truncatedMessage, runId: undefined },
);

// Runtime wiring guard: the publication tool's provider-issued toolUseId is
// the evidence id, but only after awaited addArtifact success. Content is
// suppressed from generic previews/metadata before the evaluator is called.
assert.match(runtimeSource, /run\.publish_action_artifact/);
assert.match(runtimeSource, /await\s+addArtifact\s*\(/);
assert.match(runtimeSource, /evidenceId\s*:\s*(?:event\.)?toolUseId/);
assert.match(runtimeSource, /actionId\s*:\s*(?:publication\.)?actionId/);
assert.match(runtimeSource, /contentPresent\s*:\s*true/);
assert.match(runtimeSource, /durablyRecorded\s*:\s*true/);
assert(
  runtimeSource.indexOf('await addArtifact(')
    < runtimeSource.indexOf('durablyRecorded: true'),
  'durable insert must happen before the runtime mints artifact evidence',
);

  console.log('OpenSwan multi-action artifact evidence smoke passed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
