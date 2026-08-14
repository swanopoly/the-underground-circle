/**
 * Adversarial semantic-evidence smoke for bounded OpenSwan turns.
 *
 * This intentionally tests the pure completion and planner exports directly.
 * A few runtime helpers are private implementation seams, so their exact
 * declarations are extracted from the TypeScript AST, transpiled in memory,
 * and executed here. That exercises production logic without exporting test-
 * only APIs or mounting the full Chat surface.
 *
 * Run:
 *   npx tsx scripts/openswan-multi-action-semantic-evidence-smoketest.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

import { buildChatAutomationPlan } from '../src/lib/chatAutomationPlanner';
import {
  classifyOpenSwanMultiActionOperation,
  evaluateOpenSwanMultiActionCompletion,
  type OpenSwanMultiActionCompletionLedger,
} from '../src/lib/openSwanMultiActionCompletionCore';
import { buildOpenSwanTerminalReceipt } from '../src/lib/openswanSessionRuntimeAdapters';
import { projectPersistedOpenSwanMultiActionCompletion } from '../src/lib/persistedChatMetadata';

const root = process.cwd();
const runtimePath = resolve(root, 'src/lib/openswanSessionRuntime.ts');
const chatPath = resolve(root, 'src/screens/circles/tabs/ChatTab.tsx');
const runtimeSource = readFileSync(runtimePath, 'utf8');
const chatSourceText = readFileSync(chatPath, 'utf8');
const runtimeSourceFile = ts.createSourceFile(
  runtimePath,
  runtimeSource,
  ts.ScriptTarget.ES2022,
  true,
  ts.ScriptKind.TS,
);

let checks = 0;
let failures = 0;

async function check(name: string, assertion: () => void | Promise<void>): Promise<void> {
  checks += 1;
  try {
    await assertion();
    console.log('pass:', name);
  } catch (error) {
    failures += 1;
    const detail = error instanceof Error ? error.stack || error.message : String(error);
    console.error('FAIL:', `${name}\n${detail}`);
  }
}

function declarationText(name: string): string {
  for (const statement of runtimeSourceFile.statements) {
    if (
      ts.isFunctionDeclaration(statement)
      && statement.name?.text === name
    ) {
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

function runtimeHelpers<T extends Record<string, unknown>>(
  declarationNames: readonly string[],
  exportNames: readonly string[],
  injections: Record<string, unknown> = {},
): T {
  const source = declarationNames.map(declarationText).join('\n\n');
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
      strict: true,
    },
  }).outputText;
  const injectionNames = Object.keys(injections);
  const factory = new Function(
    ...injectionNames,
    `'use strict';\n${javascript}\nreturn { ${exportNames.join(', ')} };`,
  );
  return factory(...injectionNames.map((name) => injections[name])) as T;
}

function variableInitializerText(name: string): string {
  const matches: ts.VariableDeclaration[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.name.text === name
      && node.initializer
    ) {
      matches.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(runtimeSourceFile);
  assert.equal(matches.length, 1, `${name} has one initializer`);
  return matches[0]!.initializer!.getText(runtimeSourceFile);
}

const ledger: OpenSwanMultiActionCompletionLedger = {
  schemaVersion: 1,
  dispatchMode: 'single_openswan_turn',
  actionCount: 2,
  actions: [
    {
      id: 'A1',
      ordinal: 1,
      dependsOnActionIds: [],
      evidenceToolNames: ['tasks.create'],
      evidenceRequiresMutation: true,
      evidenceRequiresTargetBinding: true,
    },
    {
      id: 'A2',
      ordinal: 2,
      dependsOnActionIds: ['A1'],
      evidenceToolNames: ['tasks.update_status'],
      evidenceRequiresMutation: true,
    },
  ],
};

async function main(): Promise<void> {
  await check('malformed accounting is incomplete, never a fabricated task failure', () => {
    for (const malformed of [
      null,
      { ledger: null, evidence: [], reports: [] },
      { ledger, evidence: [{ evidenceId: 'bad', sequence: 0 }], reports: [] },
      {
        ledger,
        evidence: [],
        reports: [{ actionId: 'A1', status: 'completed', reportedAtSequence: 1, evidenceIds: 'not-an-array' }],
      },
    ]) {
      const outcome = evaluateOpenSwanMultiActionCompletion(malformed);
      assert.equal(outcome.disposition, 'incomplete');
      assert.equal(outcome.completionVerified, false);
      assert.equal(outcome.inputValid, false);
    }
  });

  await check('a stopped prerequisite causally blocks its dependent without fake evidence', () => {
    for (const prerequisiteStatus of ['blocked', 'failed'] as const) {
      const outcome = evaluateOpenSwanMultiActionCompletion({
        ledger: {
          ...ledger,
          actions: [
            { id: 'A1', ordinal: 1, dependsOnActionIds: [] },
            { id: 'A2', ordinal: 2, dependsOnActionIds: ['A1'] },
          ],
        },
        evidence: [{
          evidenceId: 'dependency-stop',
          sequence: 1,
          status: prerequisiteStatus,
          kind: 'tool',
          tool: 'approvals.request',
        }],
        reports: [
          {
            actionId: 'A1',
            status: prerequisiteStatus,
            reportedAtSequence: 3,
            evidenceIds: ['dependency-stop'],
          },
          { actionId: 'A2', status: 'blocked', reportedAtSequence: 3, evidenceIds: [] },
        ],
      });
      assert.equal(outcome.inputValid, true);
      assert.equal(outcome.disposition, prerequisiteStatus === 'failed' ? 'failed' : 'blocked');
      assert.equal(outcome.actions[1]?.status, 'blocked');
      assert.equal(outcome.actions[1]?.evidenceIds.length, 0);
      assert(!outcome.issues.some((issue) => issue.code === 'dependency_inversion'));
    }

    const inverted = evaluateOpenSwanMultiActionCompletion({
      ledger: {
        ...ledger,
        actions: [
          { id: 'A1', ordinal: 1, dependsOnActionIds: [] },
          { id: 'A2', ordinal: 2, dependsOnActionIds: ['A1'] },
        ],
      },
      evidence: [
        { evidenceId: 'stop', sequence: 1, status: 'blocked', kind: 'tool', tool: 'approvals.request' },
        { evidenceId: 'continued', sequence: 2, status: 'succeeded', kind: 'tool', tool: 'tasks.create' },
      ],
      reports: [
        { actionId: 'A1', status: 'blocked', reportedAtSequence: 3, evidenceIds: ['stop'] },
        { actionId: 'A2', status: 'completed', reportedAtSequence: 3, evidenceIds: ['continued'] },
      ],
    });
    assert.equal(inverted.disposition, 'incomplete');
    assert.equal(inverted.inputValid, false);
    assert(inverted.issues.some((issue) => issue.code === 'dependency_inversion'));
  });

  await check('click, press, select, and open all require write evidence', () => {
    for (const action of [
      'click the Submit button',
      'press Command+S',
      'select Dark from the Theme dropdown',
      'open Adobe Illustrator',
      'revoke vault access for Codex',
      'wipe the clipboard',
      'purge old memories',
      'kill the browser',
      'reset the session',
      'erase the file',
    ]) {
      assert.equal(classifyOpenSwanMultiActionOperation(action).requiresMutation, true, action);
    }
    // "open" is an adjective here, not the requested operation. Treating it
    // as a mutation would make the read-only tasks.list evidence unavailable.
    assert.equal(
      classifyOpenSwanMultiActionOperation('list the open tasks').requiresMutation,
      false,
      'an open-task list is still a read',
    );
    assert.equal(classifyOpenSwanMultiActionOperation('read the current page').requiresMutation, false);
    assert.equal(classifyOpenSwanMultiActionOperation('revoke vault access').destructive, true);
  });

  await check('unsupported or proposal-only mutations cannot become completion evidence', () => {
    const helpers = runtimeHelpers<{
      selectActionCompletionEvidenceTools: (
        text: string,
        planned: readonly string[],
        requiresMutation: boolean,
      ) => string[];
    }>(
      [
        'MULTI_ACTION_PLANNING_ONLY_TOOLS',
        'MULTI_ACTION_IMAGE_DELIVERABLE_RE',
        'MULTI_ACTION_DERIVED_DELIVERABLE_RE',
        'selectIntentSpecificCompletionTools',
        'selectActionCompletionEvidenceTools',
      ],
      ['selectActionCompletionEvidenceTools'],
      {
        getOpenSwanToolPolicy: (toolName: string) => ({
          mutatesState: toolName !== 'tasks.list',
          mutationAuthority: toolName === 'tasks.create' ? 'unsupported' : 'action_ledger',
        }),
      },
    );
    assert.deepEqual(
      helpers.selectActionCompletionEvidenceTools(
        'create a task called Launch',
        ['code.generate', 'tasks.list', 'tasks.create'],
        true,
      ),
      [],
    );

    const unsupported = evaluateOpenSwanMultiActionCompletion({
      ledger,
      evidence: [
        {
          evidenceId: 'unsupported-write',
          sequence: 1,
          status: 'succeeded',
          kind: 'tool',
          tool: 'tasks.create',
          mutatesState: false,
          targetBound: true,
        },
        {
          evidenceId: 'second-write',
          sequence: 2,
          status: 'succeeded',
          kind: 'tool',
          tool: 'tasks.update_status',
          mutatesState: true,
        },
      ],
      reports: [
        { actionId: 'A1', status: 'completed', reportedAtSequence: 3, evidenceIds: ['unsupported-write'] },
        { actionId: 'A2', status: 'completed', reportedAtSequence: 3, evidenceIds: ['second-write'] },
      ],
    });
    assert.equal(unsupported.disposition, 'incomplete');
    assert.equal(unsupported.completionVerified, false);
    assert(unsupported.issues.some((issue) => issue.code === 'evidence_not_mutating'));
  });

  await check('operation-specific evidence cannot substitute a different successful mutation', () => {
    const helpers = runtimeHelpers<{
      selectIntentSpecificCompletionTools: (text: string) => readonly string[] | null;
      selectActionCompletionEvidenceTools: (
        text: string,
        planned: readonly string[],
        requiresMutation: boolean,
      ) => string[];
    }>(
      [
        'MULTI_ACTION_PLANNING_ONLY_TOOLS',
        'MULTI_ACTION_IMAGE_DELIVERABLE_RE',
        'MULTI_ACTION_DERIVED_DELIVERABLE_RE',
        'selectIntentSpecificCompletionTools',
        'selectActionCompletionEvidenceTools',
      ],
      ['selectIntentSpecificCompletionTools', 'selectActionCompletionEvidenceTools'],
      {
        getOpenSwanToolPolicy: (toolName: string) => {
          const readOnly = new Set([
            'tasks.list', 'rooms.list_tasks', 'tasks.get', 'code.review',
            'vault.find', 'vault.resolve_for_task', 'vault.grants',
            'browser.dom_snapshot',
          ]).has(toolName);
          return {
            mutatesState: !readOnly,
            mutationAuthority: readOnly ? 'read_only' : 'action_ledger',
          };
        },
      },
    );
    assert.deepEqual(helpers.selectIntentSpecificCompletionTools('create a task called Launch'), [
      'tasks.create',
      'missions.create_task',
      'rooms.create_task',
    ]);
    assert.deepEqual(helpers.selectIntentSpecificCompletionTools('complete the latest task'), [
      'tasks.update_status',
      'missions.complete_task',
    ]);
    assert.deepEqual(helpers.selectIntentSpecificCompletionTools('list the open tasks'), [
      'tasks.list',
      'rooms.list_tasks',
    ]);
    assert.deepEqual(helpers.selectIntentSpecificCompletionTools('get task Launch'), [
      'tasks.get',
    ]);
    assert.deepEqual(helpers.selectIntentSpecificCompletionTools('review the code changes'), [
      'code.review',
    ]);
    assert.deepEqual(helpers.selectIntentSpecificCompletionTools('revoke vault access for Codex'), [
      'vault.revoke',
    ]);
    assert.deepEqual(helpers.selectIntentSpecificCompletionTools('wipe the clipboard'), [
      'desktop.clipboard_clear',
    ]);
    assert.deepEqual(helpers.selectIntentSpecificCompletionTools('purge old memories'), [
      'memory.forget',
    ]);
    assert.deepEqual(helpers.selectIntentSpecificCompletionTools('kill the browser'), [
      'browser.close',
    ]);
    assert.deepEqual(helpers.selectIntentSpecificCompletionTools('find the vault credential'), [
      'vault.find',
      'vault.resolve_for_task',
    ]);
    assert.deepEqual(helpers.selectIntentSpecificCompletionTools('show vault grants'), [
      'vault.grants',
    ]);
    assert.deepEqual(
      helpers.selectActionCompletionEvidenceTools(
        'create a task called Launch',
        ['tasks.update_status', 'tasks.assign', 'tasks.create'],
        true,
      ),
      ['tasks.create'],
    );
    assert.deepEqual(
      helpers.selectActionCompletionEvidenceTools(
        'list the open tasks',
        ['tasks.get', 'browser.dom_snapshot', 'tasks.list', 'rooms.list_tasks'],
        false,
      ),
      ['tasks.list', 'rooms.list_tasks'],
    );

    const wrongOperation = evaluateOpenSwanMultiActionCompletion({
      ledger,
      evidence: [
        {
          evidenceId: 'wrong-operation',
          sequence: 1,
          status: 'succeeded',
          kind: 'tool',
          tool: 'tasks.update_status',
          mutatesState: true,
          targetBound: true,
        },
        {
          evidenceId: 'right-operation',
          sequence: 2,
          status: 'succeeded',
          kind: 'tool',
          tool: 'tasks.update_status',
          mutatesState: true,
        },
      ],
      reports: [
        { actionId: 'A1', status: 'completed', reportedAtSequence: 3, evidenceIds: ['wrong-operation'] },
        { actionId: 'A2', status: 'completed', reportedAtSequence: 3, evidenceIds: ['right-operation'] },
      ],
    });
    assert.equal(wrongOperation.disposition, 'incomplete');
    assert(wrongOperation.issues.some((issue) => issue.code === 'evidence_not_relevant'));
  });

  await check('derived assistant deliverables cannot complete from source reads alone', () => {
    const helpers = runtimeHelpers<{
      selectActionCompletionEvidenceTools: (
        text: string,
        planned: readonly string[],
        requiresMutation: boolean,
      ) => string[];
    }>(
      [
        'MULTI_ACTION_PLANNING_ONLY_TOOLS',
        'MULTI_ACTION_IMAGE_DELIVERABLE_RE',
        'MULTI_ACTION_DERIVED_DELIVERABLE_RE',
        'selectIntentSpecificCompletionTools',
        'selectActionCompletionEvidenceTools',
      ],
      ['selectActionCompletionEvidenceTools'],
      {
        getOpenSwanToolPolicy: () => ({ mutatesState: false, mutationAuthority: 'read_only' }),
      },
    );
    for (const action of [
      'summarize the findings',
      'analyze the results',
      'explain the tradeoffs',
      'translate the report',
      'recommend a path',
      'draft the answer',
      'calculate the total',
      'compute the score',
      'synthesize the evidence',
      'rank the candidates',
      'outline the approach',
      'classify the results',
    ]) {
      assert.deepEqual(
        helpers.selectActionCompletionEvidenceTools(action, ['research.search', 'fetch_url'], false),
        [],
        action,
      );
    }
    // Compare is both a source-gathering operation and a derived deliverable.
    // The read receipts may be required as grounding, but the runtime also
    // requires the separately persisted comparison artifact before completion.
    assert.deepEqual(
      helpers.selectActionCompletionEvidenceTools(
        'compare the options',
        ['research.search', 'fetch_url'],
        false,
      ),
      ['research.search', 'fetch_url'],
    );
  });

  await check('artifact deliverables never substitute an explicit external destination mutation', () => {
    const helpers = runtimeHelpers<{
      selectDerivedActionArtifactKinds: (text: string) => string[];
    }>(
      [
        'MULTI_ACTION_IMAGE_DELIVERABLE_RE',
        'MULTI_ACTION_EXTERNAL_DELIVERABLE_SURFACE',
        'MULTI_ACTION_EXTERNAL_DELIVERABLE_DESTINATION_RE',
        'MULTI_ACTION_EXTERNAL_DELIVERABLE_IN_SURFACE_RE',
        'MULTI_ACTION_PATH_LIKE_RE',
        'MULTI_ACTION_DELIVERABLE_WRITER_RE',
        'MULTI_ACTION_EXTERNAL_DESTINATION_NOUN_RE',
        'MULTI_ACTION_DELIVERABLE_DESTINATION_CLAUSE_RE',
        'MULTI_ACTION_NON_DESTINATION_IN_ON_RE',
        'MULTI_ACTION_NON_DESTINATION_TO_RE',
        'hasGenericDeliverableDestination',
        'selectDerivedActionArtifactKinds',
      ],
      ['selectDerivedActionArtifactKinds'],
    );
    for (const [text, expected] of [
      ['draft an email for my review', ['draft']],
      ['draft a Slack message for my review', ['draft']],
      ['write a report about Slack adoption', ['report']],
      ['summarize this document', ['summary']],
      ['analyze https://example.com/status', ['analysis']],
      ['translate selected text in Illustrator', ['translation']],
      ['write the summary to Teams', []],
      ['draft a summary in Notion', []],
      ['write the report to README.md', []],
      ['write a summary in Illustrator', []],
      ['create a report in Miro', []],
      ['write the report to config.yaml', []],
      ['write the summary into memory', []],
      ['write the summary into a task description', []],
      ['write the summary on the office whiteboard', []],
      ['write a report to Google Calendar', []],
      ['compose a reply in ChatGPT', []],
      ['draft a page in Webflow', []],
      ['write a summary to Supabase', []],
      ['write a summary to an unknown app called Acme', []],
      ['write the summary in miro', []],
      ['write the report in acme', []],
      ['compose the response on foobar', []],
      ['prepare the analysis in quux', []],
      ['create a report on acme', []],
      ['put the report into Acme', []],
      ['add the report to Acme', []],
      ['deliver the report to Acme', []],
      ['move the report into Acme', []],
      ['render the report in Acme', []],
      ['write a report in French', ['report']],
      ['draft a response in a concise style', ['draft']],
      ['write a report on the topic of Slack adoption', ['report']],
      ['write a report to explain the tradeoffs', ['explanation']],
      ['email a summary to the team', []],
    ] as const) {
      assert.deepEqual(helpers.selectDerivedActionArtifactKinds(text), expected, text);
    }
  });

  await check('grounded derived outputs retain an exact source-proof requirement', () => {
    const helpers = runtimeHelpers<{
      selectDerivedActionArtifactKinds: (text: string) => string[];
      derivedActionRequiresGroundedSourceEvidence: (
        text: string,
        artifactKinds: readonly string[],
      ) => boolean;
      selectIntentSpecificCompletionTools: (text: string) => readonly string[] | null;
    }>(
      [
        'MULTI_ACTION_IMAGE_DELIVERABLE_RE',
        'MULTI_ACTION_EXTERNAL_DELIVERABLE_SURFACE',
        'MULTI_ACTION_EXTERNAL_DELIVERABLE_DESTINATION_RE',
        'MULTI_ACTION_EXTERNAL_DELIVERABLE_IN_SURFACE_RE',
        'MULTI_ACTION_PATH_LIKE_RE',
        'MULTI_ACTION_DELIVERABLE_WRITER_RE',
        'MULTI_ACTION_EXTERNAL_DESTINATION_NOUN_RE',
        'MULTI_ACTION_DELIVERABLE_DESTINATION_CLAUSE_RE',
        'MULTI_ACTION_NON_DESTINATION_IN_ON_RE',
        'MULTI_ACTION_NON_DESTINATION_TO_RE',
        'hasGenericDeliverableDestination',
        'MULTI_ACTION_GROUNDED_SOURCE_CUE_RE',
        'MULTI_ACTION_SOURCE_OBJECT',
        'MULTI_ACTION_QUALIFIED_SOURCE_RE',
        'MULTI_ACTION_DERIVED_SOURCE_OBJECT_RE',
        'selectDerivedActionArtifactKinds',
        'derivedActionRequiresGroundedSourceEvidence',
        'selectIntentSpecificCompletionTools',
      ],
      [
        'selectDerivedActionArtifactKinds',
        'derivedActionRequiresGroundedSourceEvidence',
        'selectIntentSpecificCompletionTools',
      ],
    );
    for (const [text, expectedTools] of [
      ['summarize recent check-ins', ['check_ins.list']],
      ['summarize project rooms', ['rooms.list']],
      ['summarize running desktop apps', ['desktop.list_running_apps']],
      ['analyze the active window', ['desktop.window_state']],
      ['summarize connected GitHub repositories', ['github.list_repos']],
      ['summarize room file notes', ['rooms.read_file']],
      ['summarize Photoshop layers', ['desktop.photoshop_layer_inventory']],
      ['summarize Apple Shortcuts', ['desktop.shortcuts_list']],
      ['summarize the vault runbook', ['vault.runbook']],
      ['summarize file metadata', ['desktop.file_stat']],
      ['analyze the current browser tab', ['fetch_url', 'browser.dom_snapshot']],
      ['translate selected text in Illustrator', ['desktop.illustrator_text_inventory']],
      ['summarize my inbox', ['gmail.read']],
      ['summarize recent emails', ['gmail.read']],
      ["summarize today's calendar events", ['gcal.read']],
      ['summarize our Google Drive document', ['gdrive.read']],
      ['summarize GitHub activity', ['github.activity']],
      ['summarize the website', ['fetch_url', 'browser.dom_snapshot']],
      ['analyze the current screen', ['desktop.screenshot']],
      ['summarize the attached PDF', ['desktop.file_read']],
      ['summarize the attached file', ['desktop.file_read']],
      ['summarize the open document', ['desktop.file_read']],
    ] as const) {
      const artifactKinds = helpers.selectDerivedActionArtifactKinds(text);
      assert(artifactKinds.length > 0, `${text}: has a derived artifact`);
      assert.equal(
        helpers.derivedActionRequiresGroundedSourceEvidence(text, artifactKinds),
        true,
        `${text}: source proof remains mandatory even when the child planner omits the tool`,
      );
      assert.deepEqual(helpers.selectIntentSpecificCompletionTools(text), expectedTools, text);
    }
    for (const text of [
      'analyze this screenshot',
      'summarize the Notion page',
      'summarize the Slack channel',
      'analyze the database rows',
      'analyze the Office dashboard',
    ]) {
      const artifactKinds = helpers.selectDerivedActionArtifactKinds(text);
      assert(artifactKinds.length > 0, `${text}: has a derived artifact`);
      assert.equal(
        helpers.derivedActionRequiresGroundedSourceEvidence(text, artifactKinds),
        true,
        `${text}: external source remains mandatory even without a safe exact reader`,
      );
      assert.equal(
        helpers.selectIntentSpecificCompletionTools(text),
        null,
        `${text}: no unrelated reader is substituted`,
      );
    }
    for (const text of [
      'draft an email for my review',
      'write a report about Slack adoption',
      'outline a possible launch plan',
    ]) {
      const artifactKinds = helpers.selectDerivedActionArtifactKinds(text);
      assert(artifactKinds.length > 0, `${text}: has a pure deliverable artifact`);
      assert.equal(
        helpers.derivedActionRequiresGroundedSourceEvidence(text, artifactKinds),
        false,
        `${text}: no live source is claimed`,
      );
    }

    const planningStart = runtimeSource.indexOf('const plannedMultiActionChildren');
    const planningEnd = runtimeSource.indexOf('const toolRoundBudget', planningStart);
    const planning = runtimeSource.slice(planningStart, planningEnd);
    assert.match(planning, /sourceEvidenceRequired\s*&&\s*availableCompletionTools\.length\s*===\s*0/);
  });

  await check('unmapped reads cannot borrow an unrelated advertised read tool', () => {
    const helpers = runtimeHelpers<{
      selectActionCompletionEvidenceTools: (
        text: string,
        planned: readonly string[],
        requiresMutation: boolean,
      ) => string[];
    }>(
      [
        'MULTI_ACTION_PLANNING_ONLY_TOOLS',
        'MULTI_ACTION_IMAGE_DELIVERABLE_RE',
        'MULTI_ACTION_DERIVED_DELIVERABLE_RE',
        'selectIntentSpecificCompletionTools',
        'selectActionCompletionEvidenceTools',
      ],
      ['selectActionCompletionEvidenceTools'],
      {
        getOpenSwanToolPolicy: () => ({ mutatesState: false, mutationAuthority: 'read_only' }),
      },
    );
    assert.deepEqual(
      helpers.selectActionCompletionEvidenceTools(
        'inspect the current situation',
        ['browser.dom_snapshot', 'vault.find'],
        false,
      ),
      [],
    );
    assert.deepEqual(
      helpers.selectActionCompletionEvidenceTools(
        'find the vault credential',
        ['browser.dom_snapshot', 'vault.grants', 'vault.find', 'vault.resolve_for_task'],
        false,
      ),
      ['vault.find', 'vault.resolve_for_task'],
    );
  });

  await check('entity reads retain the explicit requested target', () => {
    const helpers = runtimeHelpers<{
      extractExplicitActionTargetTokens: (text: string) => string[];
    }>(
      ['MULTI_ACTION_TARGET_STOP_WORDS', 'extractExplicitActionTargetTokens'],
      ['extractExplicitActionTargetTokens'],
    );
    assert.deepEqual(
      helpers.extractExplicitActionTargetTokens('find vault credential Acme'),
      ['acme'],
    );
    assert.deepEqual(
      helpers.extractExplicitActionTargetTokens('get task Launch'),
      ['launch'],
    );
    assert.deepEqual(
      helpers.extractExplicitActionTargetTokens('resolve login for Northstar'),
      ['northstar'],
    );
  });

  await check('wrong URL, wrong control, and value in the wrong field never target-bind', () => {
    const helpers = runtimeHelpers<{
      sealedToolInputMatchesTarget: (
        toolName: string,
        input: unknown,
        targetTokens: readonly string[],
      ) => boolean;
    }>(
      [
        'MULTI_ACTION_CANONICAL_TARGET_INPUT_KEYS',
        'collectCanonicalTargetInputValues',
        'targetIdentityKeysForTool',
        'sealedToolInputMatchesTarget',
      ],
      ['sealedToolInputMatchesTarget'],
    );

    assert.equal(helpers.sealedToolInputMatchesTarget(
      'browser.open_url',
      { url: 'https://launch.portal.test/dashboard' },
      ['launch', 'portal'],
    ), true);
    assert.equal(helpers.sealedToolInputMatchesTarget(
      'browser.open_url',
      { url: 'https://wrong.test', value: 'launch portal' },
      ['launch', 'portal'],
    ), false);
    assert.equal(helpers.sealedToolInputMatchesTarget(
      'browser.select_option',
      { selector: '#theme', option: 'dark' },
      ['theme', 'dark'],
    ), true);
    assert.equal(helpers.sealedToolInputMatchesTarget(
      'browser.select_option',
      { selector: '#language', option: 'dark' },
      ['theme', 'dark'],
    ), false);
    assert.equal(helpers.sealedToolInputMatchesTarget(
      'browser.fill_field',
      { selector: '#username', value: 'email' },
      ['email'],
    ), false);
  });

  await check('completion tools are selected fairly before the shared cap', () => {
    const helpers = runtimeHelpers<{
      interleaveBoundedToolGroups: (
        groups: readonly (readonly string[])[],
        fallback: readonly string[],
        limit: number,
      ) => string[];
    }>(
      ['interleaveBoundedToolGroups'],
      ['interleaveBoundedToolGroups'],
    );
    assert.deepEqual(
      helpers.interleaveBoundedToolGroups([
        ['A1.complete', 'A1.plan', 'A1.inspect'],
        ['A2.complete', 'A2.plan', 'A2.inspect'],
        ['A3.complete', 'A3.plan', 'A3.inspect'],
      ], ['fallback'], 4),
      ['A1.complete', 'A2.complete', 'A3.complete', 'A1.plan'],
    );

    const planningStart = runtimeSource.indexOf('const plannedMultiActionChildren');
    const planningEnd = runtimeSource.indexOf('const toolRoundBudget', planningStart);
    assert(planningStart > 0 && planningEnd > planningStart);
    const planning = runtimeSource.slice(planningStart, planningEnd);
    assert(
      planning.indexOf('selectAllRecommendedRuntimeToolNames(childPlan)')
        < planning.indexOf('selectRuntimeToolNames(childPlan, opts.mode || null)'),
      'completion candidates are collected before mode support-tool caps',
    );
    assert.match(
      planning,
      /\.\.\.child\.completionToolNames,\s*\.\.\.child\.runtimeToolNames/,
    );
  });

  await check('more than 24 unrelated tool events are ignored before bounded evaluation', () => {
    const helpers = runtimeHelpers<{
      evaluateTurnMultiActionCompletion: (contract: unknown, events: unknown[]) => ReturnType<
        typeof evaluateOpenSwanMultiActionCompletion
      > | null;
    }>(
      [
        'MULTI_ACTION_REPORT_TOOL',
        'MULTI_ACTION_EVIDENCE_ID_RE',
        'evaluateTurnMultiActionCompletion',
      ],
      ['evaluateTurnMultiActionCompletion'],
      {
        normalizeOpenSwanActionOutcomeReport: (input: unknown) => ({
          ok: true,
          acknowledgement: input,
        }),
        getOpenSwanToolPolicy: () => ({ mutatesState: false, mutationAuthority: 'unsupported' }),
        sealedToolInputMatchesTarget: () => false,
        evaluateOpenSwanMultiActionCompletion,
      },
    );
    const contract: OpenSwanMultiActionCompletionLedger = {
      schemaVersion: 1,
      dispatchMode: 'single_openswan_turn',
      actionCount: 2,
      actions: [
        { id: 'A1', ordinal: 1, dependsOnActionIds: [], evidenceToolNames: ['tasks.list'] },
        { id: 'A2', ordinal: 2, dependsOnActionIds: [], evidenceToolNames: ['research.search'] },
      ],
    };
    const unrelated = Array.from({ length: 30 }, (_, index) => ({
      tool: 'tools.search',
      toolUseId: `unrelated-${index + 1}`,
      status: 'passed',
      input: {},
    }));
    const outcome = helpers.evaluateTurnMultiActionCompletion(contract, [
      ...unrelated,
      { tool: 'tasks.list', toolUseId: 'claimed-A1', status: 'passed', input: {} },
      { tool: 'research.search', toolUseId: 'claimed-A2', status: 'passed', input: {} },
      {
        tool: 'run.report_action_outcomes',
        toolUseId: 'report',
        status: 'passed',
        input: {
          actions: [
            { actionId: 'A1', status: 'completed', evidenceToolUseIds: ['claimed-A1'] },
            { actionId: 'A2', status: 'completed', evidenceToolUseIds: ['claimed-A2'] },
          ],
        },
      },
    ]);
    assert.equal(outcome?.disposition, 'verified');
    assert.equal(outcome?.completionVerified, true);
    assert.deepEqual(outcome?.actions.map((action) => action.evidenceIds), [
      ['claimed-A1'],
      ['claimed-A2'],
    ]);
  });

  await check('a bounded turn without a canonical run fails persistence verification', () => {
    assert.match(
      variableInitializerText('turnPersistenceDisposition'),
      /plannedMultiActionContract\s*&&\s*!run\s*\?\s*['"]unverified['"]\s*:\s*null/,
    );
    const receipt = buildOpenSwanTerminalReceipt({
      cancelled: false,
      incomplete: false,
      actionCoverageDisposition: 'verified',
      persistenceDisposition: 'unverified',
    });
    assert.deepEqual(receipt, {
      state: 'failed',
      reason: 'persistence_unverified',
      completionVerified: false,
      resumable: false,
      checkpoint: null,
    });
  });

  await check('Chat persists only a bounded value-free A# snapshot', () => {
    const outcome = evaluateOpenSwanMultiActionCompletion({
      ledger,
      evidence: [
        {
          evidenceId: 'secret-runtime-id-1',
          sequence: 1,
          status: 'succeeded',
          kind: 'tool',
          tool: 'tasks.create',
          mutatesState: true,
          targetBound: true,
        },
        {
          evidenceId: 'secret-runtime-id-2',
          sequence: 2,
          status: 'succeeded',
          kind: 'tool',
          tool: 'tasks.update_status',
          mutatesState: true,
        },
      ],
      reports: [
        { actionId: 'A1', status: 'completed', reportedAtSequence: 3, evidenceIds: ['secret-runtime-id-1'] },
        { actionId: 'A2', status: 'completed', reportedAtSequence: 3, evidenceIds: ['secret-runtime-id-2'] },
      ],
    });
    const projected = projectPersistedOpenSwanMultiActionCompletion(outcome);
    assert(projected);
    assert.equal(projected.completionVerified, true);
    assert.deepEqual(projected.actions, [
      { actionId: 'A1', status: 'completed', evidenceCount: 1 },
      { actionId: 'A2', status: 'completed', evidenceCount: 1 },
    ]);
    const serialized = JSON.stringify(projected);
    assert(!serialized.includes('secret-runtime-id'));
    assert(!serialized.includes('tasks.create'));
    assert.match(
      chatSourceText,
      /const persistedMultiActionCompletion\s*=\s*projectPersistedOpenSwanMultiActionCompletion\(\s*structured\.multiActionCompletion,?\s*\)/,
    );
    assert.match(
      chatSourceText,
      /openSwanMultiActionCompletion:\s*persistedMultiActionCompletion/,
    );
    assert.match(
      chatSourceText,
      /openSwanMultiActionCompletion:\s*extra\?\.openSwanMultiActionCompletion/,
    );
  });

  await check('generic 2-3 action asks route intact; overflow and human mentions fail closed', () => {
    for (const message of [
      'List tasks, then complete the latest one',
      'Research the issue, then write a report',
      'Review the code, then update the changelog',
      'List tasks, then research the blocker, then create a follow-up task',
    ]) {
      const plan = buildChatAutomationPlan({ message, selectedMode: 'act' });
      assert.equal(plan.execution.kind, 'run_openswan', message);
      assert(plan.multiActionLedger, message);
      assert(plan.multiActionLedger.actionCount === 2 || plan.multiActionLedger.actionCount === 3);
    }

    const overflow = buildChatAutomationPlan({
      message: 'List tasks, then research the blocker, then create a task, then show memories',
      selectedMode: 'act',
    });
    assert.equal(overflow.execution.kind, 'ask_clarification');
    assert.equal(overflow.multiActionLedger, undefined);
    assert.equal(overflow.multiActionOverflow?.actionCount, 4);
    assert.equal(overflow.multiActionOverflow?.maxActionsPerTurn, 3);

    const human = buildChatAutomationPlan({
      message: '@Morgan review the brief, then send feedback',
      selectedMode: 'act',
    });
    assert.equal(human.multiActionLedger, undefined);
    assert.equal(human.multiActionOverflow, undefined);
  });

  await check('schedule in a compound request inherits external approval', () => {
    const plan = buildChatAutomationPlan({
      message: 'List the meetings, then schedule the latest one',
      selectedMode: 'act',
    });
    assert.equal(plan.execution.kind, 'run_openswan');
    assert.equal(plan.multiActionLedger?.actionCount, 2);
    assert.equal(plan.risk, 'external_side_effect');
    assert.equal(plan.approval.required, true);
  });

  await check('destructive compound verbs inherit the destructive approval floor', () => {
    for (const message of [
      'Research Codex, then revoke vault access for Codex',
      'Inspect the clipboard, then wipe the clipboard',
      'List old memories, then purge old memories',
    ]) {
      const plan = buildChatAutomationPlan({ message, selectedMode: 'execute' });
      assert.equal(plan.execution.kind, 'run_openswan', message);
      assert.equal(plan.risk, 'destructive', message);
      assert.equal(plan.approval.required, true, message);
    }
  });

  if (failures > 0) {
    console.error(`\n${failures}/${checks} semantic evidence checks failed.`);
    process.exitCode = 1;
    return;
  }
  console.log(`\nOpenSwan multi-action semantic evidence smoke passed (${checks} groups).`);
}

void main();
