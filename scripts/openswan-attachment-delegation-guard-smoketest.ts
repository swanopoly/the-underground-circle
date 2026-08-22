/**
 * Attachment-bound multi-action pre-loop delegation guard.
 *
 * The OpenSwan parent must read an exact current-turn attachment itself before
 * any attachment-dependent mutation can be trusted. A pre-loop child receives
 * only the user's text, so it cannot inherit the parent's sealed source receipt
 * and must not be planned or dispatched for that turn.
 *
 * This smoke executes the private planning predicates from production source
 * and pins the orchestration order without calling a provider, child agent,
 * Supabase, storage, or a desktop bridge.
 *
 * Run:
 *   npx tsx scripts/openswan-attachment-delegation-guard-smoketest.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

const runtimePath = resolve(process.cwd(), 'src/lib/openswanSessionRuntime.ts');
const runtimeSource = readFileSync(runtimePath, 'utf8');
const runtimeAst = ts.createSourceFile(
  runtimePath,
  runtimeSource,
  ts.ScriptTarget.ES2022,
  true,
  ts.ScriptKind.TS,
);

let assertions = 0;

function check(condition: unknown, message: string): asserts condition {
  assertions += 1;
  assert.ok(condition, message);
  console.log('pass:', message);
}

function equal<T>(actual: T, expected: T, message: string): void {
  assertions += 1;
  assert.equal(actual, expected, message);
  console.log('pass:', message);
}

function declarationText(name: string): string {
  for (const statement of runtimeAst.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) {
      return statement.getText(runtimeAst);
    }
    if (
      ts.isVariableStatement(statement)
      && statement.declarationList.declarations.some((declaration) => (
        ts.isIdentifier(declaration.name) && declaration.name.text === name
      ))
    ) return statement.getText(runtimeAst);
  }
  assert.fail(`production declaration ${name} exists`);
}

type TurnSources = Readonly<{
  manifest: Readonly<{
    attachments: ReadonlyArray<Readonly<{
      attachmentId: string;
      basename: string;
    }>>;
  }>;
}>;

type GuardHarness = Readonly<{
  referencesAttachment: (text: string, sources?: TurnSources | null) => boolean;
  suppressesDelegation: (
    sources: TurnSources | null | undefined,
    contract: object | null | undefined,
    attachmentSourceRequested: boolean,
  ) => boolean;
  planDelegation: (args: Record<string, unknown>) => unknown[];
  counters: { should: number; plan: number };
}>;

function buildHarness(): GuardHarness {
  const production = [
    'containsExactCurrentTurnAttachmentReference',
    'hasOnlyCurrentTurnAttachmentQualification',
    'actionReferencesCurrentTurnAttachment',
    'shouldSuppressPreLoopDelegationForAttachmentTurn',
    'planOpenSwanPreLoopDelegation',
  ].map(declarationText).join('\n\n');
  const javascript = ts.transpileModule(production, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
      strict: true,
    },
  }).outputText;
  const counters = { should: 0, plan: 0 };
  const shouldDelegateToSubagents = () => {
    counters.should += 1;
    return true;
  };
  const planSubagentDelegation = () => {
    counters.plan += 1;
    return [{ subagent: { displayName: 'Builder' }, reason: 'ordinary delegation' }];
  };
  const factory = new Function(
    'shouldDelegateToSubagents',
    'planSubagentDelegation',
    `'use strict';\n${javascript}\nreturn {\n`
      + 'referencesAttachment: actionReferencesCurrentTurnAttachment,\n'
      + 'suppressesDelegation: shouldSuppressPreLoopDelegationForAttachmentTurn,\n'
      + 'planDelegation: planOpenSwanPreLoopDelegation,\n'
      + '};',
  );
  return {
    ...factory(shouldDelegateToSubagents, planSubagentDelegation),
    counters,
  } as GuardHarness;
}

const currentTurnSources: TurnSources = {
  manifest: {
    attachments: [{
      attachmentId: 'attachment-db-1',
      basename: 'quarterly-report.pdf',
    }],
  },
};

const authoritativeContract = {
  schemaVersion: 1,
  dispatchMode: 'single_openswan_turn',
  actionCount: 2,
  actions: [{ id: 'A1', ordinal: 1 }, { id: 'A2', ordinal: 2 }],
};

function main(): void {
  const harness = buildHarness();

  check(
    harness.referencesAttachment('Summarize the attached PDF, then draft a response.', currentTurnSources),
    'an ordinary exact current-turn attached-PDF request binds the sealed source',
  );
  check(
    harness.referencesAttachment('Read this attached file and list the totals.', currentTurnSources),
    'a clear this-attached-file phrase binds the sealed source',
  );
  check(
    harness.referencesAttachment('Analyze the file I uploaded here, then recommend next steps.', currentTurnSources),
    'a file-uploaded-here phrase binds the sealed source',
  );
  check(
    harness.referencesAttachment('Summarize quarterly-report.pdf.', currentTurnSources),
    'the exact current basename binds the sealed source',
  );
  check(
    harness.referencesAttachment('Read attachment-db-1 before writing the report.', currentTurnSources),
    'the exact opaque attachment id binds the sealed source',
  );
  check(
    harness.referencesAttachment('Summarize quarterly-report.pdf in three bullets.', currentTurnSources),
    'a bounded presentation qualifier does not look like external source authority',
  );
  check(
    harness.referencesAttachment('Analyze the file I uploaded in this chat.', currentTurnSources),
    'an explicit current-chat upload qualifier binds the sealed source',
  );
  check(
    harness.referencesAttachment('Summarize the current-turn upload.', currentTurnSources),
    'an explicit current-turn upload binds the sealed source',
  );

  check(
    !harness.referencesAttachment('Summarize the attachments in my latest email.', currentTurnSources),
    'attachments in a latest email never bind the current-turn upload',
  );
  check(
    !harness.referencesAttachment('Review the Slack attachments, then update the task.', currentTurnSources),
    'Slack attachments never bind the current-turn upload',
  );
  check(
    !harness.referencesAttachment('Compare the Drive attachments and write a report.', currentTurnSources),
    'Drive attachments never bind the current-turn upload',
  );
  check(
    !harness.referencesAttachment('Summarize the attached PDF from a Slack message.', currentTurnSources),
    'an attached-PDF phrase qualified by Slack never binds the current-turn upload',
  );
  check(
    !harness.referencesAttachment("Analyze this PDF from yesterday's email.", currentTurnSources),
    'deictic wording cannot override an email source qualifier',
  );
  check(
    !harness.referencesAttachment('Summarize quarterly-report.pdf from Drive.', currentTurnSources),
    'even an equal basename cannot substitute when the requested source is qualified as Drive',
  );
  for (const [request, label] of [
    ['Summarize quarterly-report.pdf from the GitHub repository.', 'repository'],
    ['Summarize quarterly-report.pdf from the project folder.', 'project folder'],
    ['Summarize quarterly-report.pdf at https://files.example/report.', 'URL'],
    ['Summarize quarterly-report.pdf from the S3 bucket.', 'bucket'],
    ['Summarize quarterly-report.pdf in Jira.', 'named app'],
    ['Summarize this PDF attached to a Jira ticket.', 'attached-to ticket'],
    ['Summarize this PDF under the project folder.', 'under-folder'],
    ['Summarize this PDF from my inbox.', 'inbox'],
    ['Summarize this PDF from the message.', 'message'],
    ['Summarize this PDF from the upload.', 'ambiguous upload'],
    ['Summarize this PDF through Northstar Connector.', 'unknown future connector'],
  ] as const) {
    check(
      !harness.referencesAttachment(request, currentTurnSources),
      `a ${label} qualifier cannot bind the current-turn upload`,
    );
  }
  check(
    !harness.referencesAttachment('Summarize the attachment.', currentTurnSources),
    'a bare ambiguous attachment reference fails closed',
  );
  check(
    !harness.referencesAttachment('Summarize other-report.pdf.', currentTurnSources),
    'an unrelated filename cannot substitute for the exact current attachment',
  );
  check(
    !harness.referencesAttachment('Summarize this other-report.pdf.', currentTurnSources),
    'deictic wording around the wrong filename cannot mint current-file evidence',
  );
  check(
    !harness.referencesAttachment('The provider says quarterly-report.pdf was read.', null),
    'filename or provider prose cannot bind without sealed current-turn sources',
  );

  check(
    harness.suppressesDelegation(currentTurnSources, authoritativeContract, true),
    'a structurally attachment-bound authoritative turn suppresses pre-loop delegation',
  );
  check(
    !harness.suppressesDelegation(currentTurnSources, null, true),
    'an ordinary attachment turn without the authoritative A-ledger keeps legacy routing',
  );
  check(
    !harness.suppressesDelegation(null, authoritativeContract, true),
    'text alone cannot activate the guard without sealed turn sources',
  );
  check(
    !harness.suppressesDelegation(currentTurnSources, authoritativeContract, false),
    'an unrelated authoritative action does not suppress ordinary delegation',
  );

  const guardedSpecs = harness.planDelegation({
    suppressPreLoopDelegation: true,
    effectiveDelegationMode: 'parallel',
    message: 'Summarize the attached PDF, then edit the workspace.',
    taskPlan: {},
  });
  equal(guardedSpecs.length, 0, 'the guarded attachment contract produces zero child specs');
  equal(harness.counters.should, 0, 'the guard does not consult prose-based auto delegation');
  equal(harness.counters.plan, 0, 'the guard calls no child planner and therefore authorizes no child mutation');

  const ordinarySpecs = harness.planDelegation({
    suppressPreLoopDelegation: false,
    effectiveDelegationMode: 'auto',
    message: 'Review the repository and improve the tests.',
    taskPlan: {},
  });
  equal(ordinarySpecs.length, 1, 'ordinary no-attachment delegation remains enabled');
  equal(harness.counters.should, 1, 'ordinary auto delegation retains its existing decision call');
  equal(harness.counters.plan, 1, 'ordinary auto delegation retains its existing child planner');

  const guardDeclaration = declarationText('shouldSuppressPreLoopDelegationForAttachmentTurn');
  check(
    !/message|prompt|provider|basename|fileName/i.test(guardDeclaration),
    'the delegation guard depends on structural turn state, not provider prose or filenames',
  );

  const runStart = runtimeSource.indexOf('export async function runOpenSwanSessionTurn');
  const runtimeBody = runtimeSource.slice(runStart);
  const guardIndex = runtimeBody.indexOf('const suppressPreLoopDelegation');
  const specsIndex = runtimeBody.indexOf('const delegationSpecs = planOpenSwanPreLoopDelegation');
  const childDispatchIndex = runtimeBody.indexOf('await delegateToSubagents');
  const parentLoopIndex = Math.min(
    ...['await runTypedCoreToolLoop', 'await executeToolUseLoop']
      .map((marker) => runtimeBody.indexOf(marker))
      .filter((index) => index >= 0),
  );
  check(runStart >= 0, 'the canonical session runtime entry point exists');
  check(guardIndex >= 0 && guardIndex < specsIndex, 'the structural guard is resolved before child planning');
  check(specsIndex >= 0 && specsIndex < childDispatchIndex, 'guarded specs own the only pre-loop child dispatch');
  check(childDispatchIndex >= 0 && childDispatchIndex < parentLoopIndex, 'the audited child path is strictly pre-loop');
  check(
    /if\s*\(delegationSpecs\.length\s*>\s*0\s*&&\s*opts\.context\.circleId\)[\s\S]*?await delegateToSubagents/.test(runtimeBody),
    'child dispatch remains unreachable when the guard returns zero specs',
  );
  const childCall = runtimeBody.slice(
    childDispatchIndex,
    runtimeBody.indexOf('});', childDispatchIndex) + 3,
  );
  check(
    !/attachmentTurnSources|privateSourcesByHandle|sourceHandle/.test(childCall),
    'the pre-loop child call carries no private attachment authority',
  );
  check(
    /attachmentTurnSources:\s*opts\.attachmentTurnSources/.test(runtimeBody.slice(parentLoopIndex)),
    'the sealed source remains available to the parent tool loop for its first trusted read',
  );

  console.log(`\nOpenSwan attachment delegation guard smoke passed (${assertions} assertions).`);
}

main();
