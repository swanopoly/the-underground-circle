/**
 * Exact read-evidence routing smoke for bounded OpenSwan A1-A3 turns.
 *
 * The helpers under test intentionally remain private runtime seams. Their
 * declarations are extracted from the TypeScript AST and executed here so
 * this smoke exercises production rules without adding a test-only export.
 *
 * Run:
 *   npx tsx scripts/openswan-multi-action-read-evidence-smoketest.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const runtimePath = resolve(root, 'src/lib/openswanSessionRuntime.ts');
const toolRuntimePath = resolve(root, 'src/lib/openswanToolRuntime.ts');
const runtimeSource = readFileSync(runtimePath, 'utf8');
const toolRuntimeSource = readFileSync(toolRuntimePath, 'utf8');
const runtimeSourceFile = ts.createSourceFile(
  runtimePath,
  runtimeSource,
  ts.ScriptTarget.ES2022,
  true,
  ts.ScriptKind.TS,
);
const toolRuntimeSourceFile = ts.createSourceFile(
  toolRuntimePath,
  toolRuntimeSource,
  ts.ScriptTarget.ES2022,
  true,
  ts.ScriptKind.TS,
);

function declarationText(sourceFile: ts.SourceFile, name: string): string {
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
  assert.fail(`${name} declaration exists in ${sourceFile.fileName}`);
}

function compileDeclarations<T extends Record<string, unknown>>(
  sourceFile: ts.SourceFile,
  declarationNames: readonly string[],
  exportNames: readonly string[],
  injections: Record<string, unknown> = {},
): T {
  const source = declarationNames
    .map((name) => declarationText(sourceFile, name))
    .join('\n\n');
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

type ToolPolicy = Readonly<{
  approvalMode: 'auto' | 'ask';
  mutatesState: boolean;
  externalSideEffect: boolean;
}>;

const policyHelpers = compileDeclarations<{
  getBaseOpenSwanToolPolicy: (tool: string) => ToolPolicy;
}>(
  toolRuntimeSourceFile,
  ['getBaseOpenSwanToolPolicy'],
  ['getBaseOpenSwanToolPolicy'],
);

const runtimeHelpers = compileDeclarations<{
  extractExplicitActionTargetTokens: (actionText: string) => string[];
  sealedToolInputMatchesTarget: (
    toolName: string,
    input: unknown,
    targetTokens: readonly string[],
  ) => boolean;
  selectIntentSpecificCompletionTools: (actionText: string) => readonly string[] | null;
  selectActionCompletionEvidenceTools: (
    actionText: string,
    plannedToolNames: readonly string[],
    requiresMutation: boolean,
  ) => string[];
}>(
  runtimeSourceFile,
  [
    'MULTI_ACTION_PLANNING_ONLY_TOOLS',
    'MULTI_ACTION_IMAGE_DELIVERABLE_RE',
    'MULTI_ACTION_DERIVED_DELIVERABLE_RE',
    'MULTI_ACTION_TARGET_STOP_WORDS',
    'MULTI_ACTION_CANONICAL_TARGET_INPUT_KEYS',
    'extractExplicitActionTargetTokens',
    'collectCanonicalTargetInputValues',
    'targetIdentityKeysForTool',
    'sealedToolInputMatchesTarget',
    'selectIntentSpecificCompletionTools',
    'selectActionCompletionEvidenceTools',
  ],
  [
    'extractExplicitActionTargetTokens',
    'sealedToolInputMatchesTarget',
    'selectIntentSpecificCompletionTools',
    'selectActionCompletionEvidenceTools',
  ],
  {
    getOpenSwanToolPolicy: policyHelpers.getBaseOpenSwanToolPolicy,
  },
);

const SAFE_READ_CASES = [
  ['list recent messages', 'messages.list'],
  ['list goals', 'goals.list'],
  ['show active missions', 'missions.list'],
  ['list project rooms', 'rooms.list'],
  ['show standup updates', 'check_ins.list'],
  ['list circle members', 'list_circle_members'],
  ['list connected integrations', 'integrations.list'],
  ['show office agents', 'office.list_agents'],
  ['show pending approvals', 'approvals.list'],
  ['list GitHub repositories', 'github.list_repos'],
  ['read README.md from GitHub repo circle/app', 'github.read_file'],
  ['read connected custom API endpoint /status', 'custom_api.read'],
  ['list running desktop apps', 'desktop.list_running_apps'],
  ['list browser tabs', 'desktop.list_browser_tabs'],
  ['show active window', 'desktop.window_state'],
  ['read clipboard', 'desktop.clipboard'],
  ['show file metadata /tmp/report.pdf', 'desktop.file_stat'],
  ['list Apple Shortcuts', 'desktop.shortcuts_list'],
  ['list Photoshop layers', 'desktop.photoshop_layer_inventory'],
  ['show InDesign document status', 'desktop.indesign_document_status'],
] as const;

const EXACT_FIRST_CASES = [
  {
    action: 'search chat messages for incident alpha',
    tool: 'messages.search',
    siblings: ['messages.list', 'research.search'],
  },
  {
    action: 'show vault runbook for Acme',
    tool: 'vault.runbook',
    siblings: ['vault.find', 'vault.resolve_for_task', 'vault.grants'],
  },
  {
    action: 'read room file Launch Brief',
    tool: 'rooms.read_file',
    siblings: ['desktop.file_read', 'desktop.file_list', 'rooms.list_files'],
  },
] as const;

const allReadTools = Array.from(new Set([
  ...SAFE_READ_CASES.map(([, tool]) => tool),
  ...EXACT_FIRST_CASES.flatMap(({ tool, siblings }) => [tool, ...siblings]),
]));

let checks = 0;

function check(name: string, assertion: () => void): void {
  checks += 1;
  try {
    assertion();
    console.log('pass:', name);
  } catch (error) {
    const detail = error instanceof Error ? error.stack || error.message : String(error);
    console.error('FAIL:', `${name}\n${detail}`);
    process.exitCode = 1;
  }
}

for (const [action, expectedTool] of SAFE_READ_CASES) {
  check(`${action} maps to only ${expectedTool}`, () => {
    assert.deepEqual(
      runtimeHelpers.selectIntentSpecificCompletionTools(action),
      [expectedTool],
    );
    assert.deepEqual(
      runtimeHelpers.selectActionCompletionEvidenceTools(action, allReadTools, false),
      [expectedTool],
    );
  });

  check(`${action} cannot borrow a read sibling`, () => {
    assert.deepEqual(
      runtimeHelpers.selectActionCompletionEvidenceTools(
        action,
        allReadTools.filter((tool) => tool !== expectedTool),
        false,
      ),
      [],
    );
  });

  check(`${expectedTool} retains an auto-approved read-only policy`, () => {
    const policy = policyHelpers.getBaseOpenSwanToolPolicy(expectedTool);
    assert.equal(policy.approvalMode, 'auto');
    assert.equal(policy.mutatesState, false);
  });
}

for (const { action, tool, siblings } of EXACT_FIRST_CASES) {
  check(`${action} wins before its dangerous broad siblings`, () => {
    assert.deepEqual(runtimeHelpers.selectIntentSpecificCompletionTools(action), [tool]);
    assert.deepEqual(
      runtimeHelpers.selectActionCompletionEvidenceTools(action, [tool, ...siblings], false),
      [tool],
    );
    assert.deepEqual(
      runtimeHelpers.selectActionCompletionEvidenceTools(action, siblings, false),
      [],
    );
  });

  check(`${tool} is read-only and cannot be replaced by a similarly named operation`, () => {
    const policy = policyHelpers.getBaseOpenSwanToolPolicy(tool);
    assert.equal(policy.approvalMode, 'auto');
    assert.equal(policy.mutatesState, false);
  });
}

const TARGET_CASES = [
  {
    action: 'read README.md from GitHub repo circle/app',
    tool: 'github.read_file',
    requiredTokens: ['readme', 'md', 'circle', 'app'],
    input: { owner: 'circle', repo: 'app', path: 'README.md' },
    wrongInput: { owner: 'circle', repo: 'website', path: 'README.md' },
  },
  {
    action: 'read connected custom API endpoint /status',
    tool: 'custom_api.read',
    requiredTokens: ['status'],
    input: { integrationId: 'api-production', path: '/status', method: 'GET' },
    wrongInput: { integrationId: 'api-production', path: '/health', method: 'GET' },
  },
  {
    action: 'show file metadata /tmp/report.pdf',
    tool: 'desktop.file_stat',
    requiredTokens: ['tmp', 'report', 'pdf'],
    input: { path: '/tmp/report.pdf' },
    wrongInput: { path: '/tmp/summary.pdf' },
  },
  {
    action: 'search chat messages for incident alpha',
    tool: 'messages.search',
    requiredTokens: ['incident', 'alpha'],
    input: { query: 'incident alpha' },
    wrongInput: { query: 'incident beta' },
  },
  {
    action: 'show vault runbook for Acme',
    tool: 'vault.runbook',
    requiredTokens: ['acme'],
    input: { query: 'Acme' },
    wrongInput: { query: 'Northstar' },
  },
  {
    action: 'read room file Launch Brief',
    tool: 'rooms.read_file',
    requiredTokens: ['launch', 'brief'],
    input: { fileId: 'launch-brief' },
    wrongInput: { fileId: 'launch-plan' },
  },
] as const;

for (const { action, tool, requiredTokens, input, wrongInput } of TARGET_CASES) {
  check(`${action} carries exact identity into sealed evidence`, () => {
    const extracted = runtimeHelpers.extractExplicitActionTargetTokens(action);
    for (const token of requiredTokens) {
      assert(extracted.includes(token), `${action} retains target token ${token}`);
    }
    assert.equal(
      runtimeHelpers.sealedToolInputMatchesTarget(tool, input, extracted),
      true,
      `${tool} binds the exact requested identity`,
    );
    assert.equal(
      runtimeHelpers.sealedToolInputMatchesTarget(tool, wrongInput, extracted),
      false,
      `${tool} refuses the wrong requested identity`,
    );
    assert.equal(
      runtimeHelpers.sealedToolInputMatchesTarget(
        tool,
        { ...wrongInput, description: action, notes: action },
        extracted,
      ),
      false,
      'irrelevant prose cannot smuggle target evidence',
    );
  });
}

if (process.exitCode) {
  console.error(`\n${checks} read-evidence checks completed with failures.`);
} else {
  console.log(`\n${checks} read-evidence checks passed.`);
}
