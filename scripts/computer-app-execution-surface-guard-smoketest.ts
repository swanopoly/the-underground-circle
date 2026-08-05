/**
 * Focused smoke for the computer_apps and computer_files execution-surface
 * ceilings.
 *
 * Run:
 *   npx tsx scripts/computer-app-execution-surface-guard-smoketest.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  evaluateTaskExecutionSurfaceToolCall,
  isKnownBrowserAppTarget,
  resolveTaskExecutionSurfaceGuard,
  taskExecutionSurfaceAllowsTool,
} from '../src/lib/taskCapabilityProfiles';

const candidateTools = [
  'desktop.photoshop_document_status',
  'desktop.launch_app',
  'desktop.file_search',
  'desktop.file_stat',
  'desktop.file_read',
  'desktop.open_path',
  'desktop.open_url',
  'browser.open_url',
  'browser.dom_snapshot',
  'tools.search',
] as const;

const appGuard = resolveTaskExecutionSurfaceGuard('computer_apps');
assert.equal(appGuard, 'desktop_app_only');
assert.deepEqual(
  candidateTools.filter((name) => taskExecutionSurfaceAllowsTool(appGuard, name)),
  [
    'desktop.photoshop_document_status',
    'desktop.launch_app',
    'desktop.file_search',
    'desktop.file_stat',
    'desktop.file_read',
    'desktop.open_path',
  ],
  'computer_apps keeps app-native tools and excludes browser/open-url escape paths',
);
assert.equal(
  taskExecutionSurfaceAllowsTool(appGuard, 'BROWSER.OPEN_URL'),
  false,
  'the browser-family block is case-insensitive',
);

const fileGuard = resolveTaskExecutionSurfaceGuard('computer_files');
assert.equal(fileGuard, 'local_file_only');
assert.deepEqual(
  candidateTools.filter((name) => taskExecutionSurfaceAllowsTool(fileGuard, name)),
  [
    'desktop.photoshop_document_status',
    'desktop.launch_app',
    'desktop.file_search',
    'desktop.file_stat',
    'desktop.file_read',
    'desktop.open_path',
  ],
  'computer_files keeps local/native tools and excludes browser/open-url discovery escapes',
);
for (const blockedTool of [
  'browser.open_url',
  'browser.dom_snapshot',
  'desktop.open_url',
  'tools.search',
]) {
  assert.equal(
    taskExecutionSurfaceAllowsTool(fileGuard, blockedTool),
    false,
    `computer_files filters ${blockedTool}`,
  );
}
for (const allowedTool of [
  'desktop.file_search',
  'desktop.file_stat',
  'desktop.file_read',
  'desktop.open_path',
]) {
  assert.equal(
    taskExecutionSurfaceAllowsTool(fileGuard, allowedTool),
    true,
    `computer_files preserves ${allowedTool}`,
  );
}

const hybridGuard = resolveTaskExecutionSurfaceGuard('computer_hybrid');
assert.equal(hybridGuard, undefined);
for (const name of candidateTools) {
  assert.equal(
    taskExecutionSurfaceAllowsTool(hybridGuard, name),
    true,
    `computer_hybrid preserves ${name}`,
  );
}

const browserGuard = resolveTaskExecutionSurfaceGuard('browser_qa');
assert.equal(browserGuard, undefined);
assert.equal(taskExecutionSurfaceAllowsTool(browserGuard, 'browser.open_url'), true);

for (const browserTarget of [
  'Google Chrome',
  'Chrome Canary.app',
  'Chromium',
  'Safari Technology Preview',
  'Firefox Developer Edition',
  'Microsoft Edge',
  'Arc',
  'Brave Browser',
  'Opera GX',
  'Vivaldi',
  'com.google.Chrome.canary',
  'com.apple.Safari',
]) {
  assert.equal(isKnownBrowserAppTarget(browserTarget), true, `${browserTarget} is a browser target`);
  for (const toolName of ['desktop.launch_app', 'desktop.focus_app'] as const) {
    for (const [guardLabel, guard] of [
      ['computer_apps', appGuard],
      ['computer_files', fileGuard],
    ] as const) {
      const verdict = evaluateTaskExecutionSurfaceToolCall(
        guard,
        toolName,
        { appName: browserTarget },
      );
      assert.equal(verdict.allowed, false, `${guardLabel} ${toolName} rejects ${browserTarget}`);
    }
  }
}

assert.equal(isKnownBrowserAppTarget('Adobe Photoshop'), false);
assert.equal(isKnownBrowserAppTarget('ArcGIS Pro'), false, 'Arc prefix requires an app-name boundary');
assert.equal(
  evaluateTaskExecutionSurfaceToolCall(
    appGuard,
    'desktop.launch_app',
    { appName: 'Adobe Photoshop' },
  ).allowed,
  true,
  'desktop_apps can still launch Photoshop',
);
assert.equal(
  evaluateTaskExecutionSurfaceToolCall(
    appGuard,
    'desktop.window_manage',
    { action: 'raise', appName: 'Google Chrome' },
  ).allowed,
  false,
  'desktop_apps cannot raise a known browser window',
);
assert.equal(
  evaluateTaskExecutionSurfaceToolCall(
    appGuard,
    'desktop.window_manage',
    { action: 'focus' },
  ).allowed,
  false,
  'desktop_apps cannot focus an unnamed window whose surface is unproven',
);
assert.equal(
  evaluateTaskExecutionSurfaceToolCall(
    appGuard,
    'desktop.window_manage',
    { action: 'resize', appName: 'Adobe Photoshop', width: 600, height: 600 },
  ).allowed,
  true,
  'desktop_apps retain named non-browser window management',
);
assert.equal(
  evaluateTaskExecutionSurfaceToolCall(
    fileGuard,
    'desktop.open_path',
    { path: '/Users/test/Documents/report.pdf' },
  ).allowed,
  true,
  'computer_files preserves the exact local open_path surface',
);
for (const toolName of ['desktop.launch_app', 'desktop.focus_app'] as const) {
  assert.equal(
    evaluateTaskExecutionSurfaceToolCall(
      fileGuard,
      toolName,
      { appName: 'Preview' },
    ).allowed,
    true,
    `computer_files can use ${toolName} for Preview`,
  );
}
assert.equal(
  evaluateTaskExecutionSurfaceToolCall(
    fileGuard,
    'desktop.window_manage',
    { action: 'raise', appName: 'Preview' },
  ).allowed,
  true,
  'computer_files can raise a named non-browser Preview window',
);
for (const browserTarget of ['Google Chrome', 'Safari']) {
  assert.equal(
    evaluateTaskExecutionSurfaceToolCall(
      fileGuard,
      'desktop.window_manage',
      { action: 'raise', appName: browserTarget },
    ).allowed,
    false,
    `computer_files cannot raise ${browserTarget}`,
  );
}
assert.equal(
  evaluateTaskExecutionSurfaceToolCall(
    fileGuard,
    'desktop.window_manage',
    { action: 'focus' },
  ).allowed,
  false,
  'computer_files cannot focus an unnamed window whose surface is unproven',
);
assert.equal(
  evaluateTaskExecutionSurfaceToolCall(
    appGuard,
    'desktop.type_text',
    { appName: 'Brave Browser', text: 'blocked' },
  ).allowed,
  false,
  'the browser target guard covers every native desktop action with appName',
);
assert.equal(
  evaluateTaskExecutionSurfaceToolCall(
    hybridGuard,
    'desktop.focus_app',
    { appName: 'Google Chrome' },
  ).allowed,
  true,
  'computer_hybrid preserves explicit browser activation',
);

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const agentRuntimeSource = readFileSync(`${repoRoot}/src/lib/agentRuntime.ts`, 'utf8');
const swanbotSource = readFileSync(`${repoRoot}/src/lib/swanbot.ts`, 'utf8');
const batchRuntimeSource = readFileSync(`${repoRoot}/src/lib/swanbotV2BatchRuntime.ts`, 'utf8');
const executionSource = readFileSync(`${repoRoot}/src/lib/computerTaskExecution.ts`, 'utf8');

assert.match(
  executionSource,
  /case 'app_task':\s*return 'computer_apps'/,
  'desktop app tasks select the guarded profile',
);
assert.match(
  executionSource,
  /case 'file_task':\s*return 'computer_files'/,
  'local-file tasks select the guarded profile',
);
assert.match(
  executionSource,
  /case 'hybrid_task':\s*return 'computer_hybrid'/,
  'hybrid tasks keep the unguarded cross-surface profile',
);
assert.match(
  agentRuntimeSource,
  /executionSurfaceGuard: resolveTaskExecutionSurfaceGuard\(inferredProfileKey\)/,
  'AgentRuntime derives the hard ceiling from the selected task profile',
);
assert.match(
  swanbotSource,
  /executionSurfaceGuard: clientLoopContext\?\.executionSurfaceGuard/,
  'SwanBot threads the ceiling into the required local typed loop',
);
assert.match(
  swanbotSource,
  /evaluateTaskExecutionSurfaceToolCall\([\s\S]*?opts\.executionSurfaceGuard,[\s\S]*?block\.name,[\s\S]*?block\.input/,
  'the legacy typed dispatcher checks names and arguments before dispatch',
);
assert.match(
  batchRuntimeSource,
  /getOpenSwanToolsForSurface\([\s\S]*?\.filter\(\(tool\) => taskExecutionSurfaceAllowsTool\([\s\S]*?extra\.executionSurfaceGuard,[\s\S]*?tool\.name/,
  'the canonical v2 loop filters both advertised tools and its handler map',
);
assert.match(
  batchRuntimeSource,
  /const toolConstraintGuard: AgentToolConstraintGuard = async \(call\) => \{[\s\S]*?evaluateTaskExecutionSurfaceToolCall\([\s\S]*?extra\.executionSurfaceGuard,[\s\S]*?call\.toolName,[\s\S]*?call\.input[\s\S]*?return baseToolConstraintGuard\(call\)/,
  'the canonical v2 loop applies the argument guard at its pre-dispatch constraint seam',
);

console.log('computer-app execution-surface guard smoke: passed');
