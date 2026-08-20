#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: projectRoot, stdio: 'pipe', ...opts });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} ${args.join(' ')} failed with code ${code}\n${stderr || stdout}`));
    });
  });
}

function sourceSlice(source, start, end) {
  const startIndex = source.indexOf(start);
  if (startIndex < 0) return '';
  const endIndex = source.indexOf(end, startIndex + start.length);
  return source.slice(startIndex, endIndex < 0 ? source.length : endIndex);
}

async function checkSourceContracts() {
  const [chatTabSource, actionsMenuSource] = await Promise.all([
    fs.readFile(path.join(projectRoot, 'src/screens/circles/tabs/ChatTab.tsx'), 'utf8'),
    fs.readFile(path.join(projectRoot, 'src/screens/circles/tabs/chat/ChatActionsMenu.tsx'), 'utf8'),
  ]);
  const failures = [];
  let passes = 0;
  const check = (condition, message) => {
    if (condition) passes += 1;
    else failures.push(message);
  };

  check(
    chatTabSource.includes("import ChatActionsMenu from './chat/ChatActionsMenu';")
      && chatTabSource.includes('testID="chat-actions-trigger"')
      && chatTabSource.includes('accessibilityLabel="Open chat actions"')
      && chatTabSource.includes('accessibilityState={{ expanded: showQuickActions, disabled: composerDisabled }}')
      && chatTabSource.includes("'aria-haspopup': 'dialog'")
      && chatTabSource.includes("'aria-controls': 'chat-actions-dialog'")
      && chatTabSource.includes('disabled={composerDisabled}'),
    'Actions trigger semantics, state, disabled behavior, or test ID changed.',
  );
  check(
    actionsMenuSource.includes('<Modal')
      && actionsMenuSource.includes('onRequestClose={onClose}')
      && actionsMenuSource.includes('nativeID="chat-actions-dialog"')
      && actionsMenuSource.includes('testID="chat-actions-menu"')
      && actionsMenuSource.includes("role: 'dialog'")
      && actionsMenuSource.includes("'aria-modal': true"),
    'Actions must remain a closeable accessible modal dialog.',
  );
  check(
    actionsMenuSource.includes('testID="chat-actions-search"')
      && actionsMenuSource.includes('testID="chat-actions-close"')
      && actionsMenuSource.includes('testID={`chat-action-${item.id}`}')
      && actionsMenuSource.includes('testID={`chat-action-section-${section.id}`}'),
    'Actions modal search, close, item, or section test IDs changed.',
  );
  check(
    actionsMenuSource.includes("event.key === 'Escape'")
      && actionsMenuSource.includes('searchRef.current?.focus()')
      && actionsMenuSource.includes('returnFocusRef.current = documentRef?.activeElement || null')
      && actionsMenuSource.includes('target?.focus?.()'),
    'Actions modal must support Escape, initial focus, and focus restoration.',
  );
  check(
    actionsMenuSource.includes('const dialogMaxHeight = Math.max(0, height - (height < 600 ? 16 : 40));')
      && actionsMenuSource.includes('maxHeight: dialogMaxHeight')
      && actionsMenuSource.includes('<ScrollView'),
    'Actions modal must retain bounded mobile height and scrolling.',
  );
  const commonSection = actionsMenuSource.indexOf('title="Common"');
  const browseSection = actionsMenuSource.indexOf('title="Browse"');
  check(
    !actionsMenuSource.includes('title="Suggested"')
      && commonSection >= 0
      && browseSection > commonSection,
    'Actions must open with Common first and must not render a Suggested section.',
  );

  const modelTrigger = sourceSlice(chatTabSource, 'const next = !showModelPicker;', 'onHoverIn=');
  const actionsTrigger = sourceSlice(chatTabSource, 'const next = !showQuickActions;', 'accessibilityRole="button"');
  const modeTrigger = sourceSlice(chatTabSource, 'ref={modeTriggerRef}', 'accessibilityRole="button"');
  check(
    modelTrigger.includes('setShowQuickActions(false)') && modelTrigger.includes('setShowModePicker(false)'),
    'Opening the model picker must close Actions and the mode picker.',
  );
  check(
    actionsTrigger.includes('setShowModelPicker(false)') && actionsTrigger.includes('setShowModePicker(false)'),
    'Opening Actions must close the model and mode pickers.',
  );
  check(
    modeTrigger.includes('setShowModelPicker(false)') && modeTrigger.includes('setShowQuickActions(false)'),
    'Opening the mode picker must close the model picker and Actions.',
  );
  check(
    chatTabSource.includes('setInput((current) => mergeChatActionDraft(current, actionText));')
      && chatTabSource.includes("if (mode === 'prefill' || (mode === 'send' && composerHasWork))")
      && chatTabSource.includes('onQuickAction(text, mode);'),
    'Action selection must merge drafts and preserve the catalog execution mode.',
  );
  check(
    /\.from\('messages'\)\s*\.delete\(\)\s*\.eq\('circle_id', circleId\)\s*\.eq\('thread_id', activeThreadId\)\s*\.eq\('user_id', currentUserId\)\s*\.select\('id'\)/s.test(chatTabSource),
    'Delete-chat must select exactly the current circle, thread, and user message IDs.',
  );
  check(
    !chatTabSource.includes('setShowQuickCheckIn')
      && !chatTabSource.includes('setShowQuickNewTask')
      && !chatTabSource.includes('setShowQuickStepAway')
      && !chatTabSource.includes('EnhancedQuickBar')
      && !chatTabSource.includes('EnhancedQuickChip')
      && !chatTabSource.includes('EnhancedPromptCard')
      && !chatTabSource.includes('GlassmorphismCard')
      && !chatTabSource.includes('EnhancedPromptItem')
      && !chatTabSource.includes('function TipCard'),
    'Removed quick-action dead-state setters or legacy quick-bar branches returned.',
  );

  if (failures.length > 0) {
    throw new Error(`Chat actions source wiring failures:\n- ${failures.join('\n- ')}`);
  }
  console.log(`Chat actions source wiring checks passed (${passes} assertions).`);
}

async function main() {
  const tempRoot = await fs.mkdtemp(path.join(projectRoot, '.tmp-command-registry-check-'));
  const runnerPath = path.join(tempRoot, 'runner.ts');
  const tsconfigPath = path.join(tempRoot, 'tsconfig.json');
  const outDir = path.join(tempRoot, 'out');

  const runnerSource = `
import {
  CHAT_COMMAND_REGISTRY,
  buildChatCommandHelpMessage,
  getMatchingChatCommands,
  inferChatCommandExecution,
  inferChatCommandRoute,
  matchesChatCommandRoute,
} from '../src/lib/chatCommandRegistry';
import {
  ALL_QUICK_ACTIONS,
  FEATURED_TOOL_ACTIONS,
  REGISTRY_BACKED_ACTION_SECTIONS,
  buildChatActionMenuCatalog,
  mergeChatActionDraft,
  resolveQuickActionExecution,
} from '../src/lib/chatActions';

declare const process: { exit(code?: number): never };

const failures: string[] = [];
let passes = 0;

function check(condition: boolean, message: string) {
  if (condition) passes += 1;
  else failures.push(message);
}

function hasStableIds(items: ReadonlyArray<{ id: string }>) {
  return items.every((item) => /^[a-z0-9][a-z0-9_-]*$/.test(item.id));
}

function hasUniqueIds(items: ReadonlyArray<{ id: string }>) {
  const ids = items.map((item) => item.id);
  return ids.length === new Set(ids).size;
}

check(matchesChatCommandRoute('/commands', 'help'), '/commands should match the help route.');
check(matchesChatCommandRoute('/status', 'summary'), '/status should match the summary route.');
check(matchesChatCommandRoute('/gh tree', 'github'), '/gh tree should match the GitHub route.');
check(matchesChatCommandRoute('/wp publish 42', 'wordpress'), '/wp publish should match the WordPress route.');
check(matchesChatCommandRoute('/cron cancel abc123', 'schedule'), '/cron cancel should match the schedule route.');
check(matchesChatCommandRoute('/browser plan inspect openai.com pricing', 'browser'), '/browser plan should match the browser route.');
check(getMatchingChatCommands('/gh').some((entry) => entry.command === '/gh'), 'Slash lookup for /gh should include /gh.');
check(inferChatCommandRoute('show me the repo tree and recent pull requests') === 'github', 'GitHub prose should infer the GitHub route.');
check(inferChatCommandRoute('show mission progress and active tasks') === 'mission', 'Mission prose should infer the mission route.');

const execWiki = inferChatCommandExecution('search wiki React hooks');
const execGithub = inferChatCommandExecution('show me the repo tree');
const execBrowser = inferChatCommandExecution('use browser to compare the pricing pages on openai.com and anthropic.com');
check(Boolean(execWiki && execWiki.commandText === '/wiki React hooks'), 'Wiki inference should build a /wiki command.');
check(Boolean(execGithub && execGithub.commandText === '/gh tree'), 'GitHub inference should build /gh tree.');
check(Boolean(execBrowser && execBrowser.routeId === 'browser' && execBrowser.commandText.startsWith('/browser plan ')), 'Browser inference should build a browser plan.');

check(ALL_QUICK_ACTIONS.some((item) => item.routeId === 'browser'), 'Quick actions should expose a browser route.');
check(FEATURED_TOOL_ACTIONS.some((item) => item.routeId === 'browser'), 'Featured tools should expose a browser route.');
check(REGISTRY_BACKED_ACTION_SECTIONS.some((section) => section.items.some((item) => item.routeId === 'browser')), 'Registry sections should expose a browser route.');
check(resolveQuickActionExecution('/browser plan ').routeId === 'browser', 'Quick-action resolution should preserve the browser route.');
const help = buildChatCommandHelpMessage();
check(help.includes('/schedule') && help.includes('/wp publish'), 'Help should include scheduling and WordPress commands.');

const registryMenuEntries = REGISTRY_BACKED_ACTION_SECTIONS.flatMap((section) => section.items);
check(hasStableIds(CHAT_COMMAND_REGISTRY) && hasUniqueIds(CHAT_COMMAND_REGISTRY), 'Command registry IDs must be unique and stable.');
check(hasStableIds(ALL_QUICK_ACTIONS) && hasUniqueIds(ALL_QUICK_ACTIONS), 'Quick-action IDs must be unique and stable.');
check(hasStableIds(FEATURED_TOOL_ACTIONS) && hasUniqueIds(FEATURED_TOOL_ACTIONS), 'Featured-tool IDs must be unique and stable.');
check(hasStableIds(REGISTRY_BACKED_ACTION_SECTIONS) && hasUniqueIds(REGISTRY_BACKED_ACTION_SECTIONS), 'Registry section IDs must be unique and stable.');
check(
  CHAT_COMMAND_REGISTRY.every((command) => {
    const item = registryMenuEntries.find((candidate) => candidate.id === 'command-' + command.id);
    return Boolean(item && item.routeId === command.routeId && item.text === command.insertText);
  }),
  'Registry-backed menu entries must preserve registry route IDs and insertion payloads.',
);

const catalog = buildChatActionMenuCatalog([{
  id: 'surface-audit',
  label: 'Audit actions',
  prompt: 'Review this action surface.',
  color: '#6366f1',
}]);
const allCatalogItems = [
  ...catalog.contextual,
  ...catalog.common,
  ...catalog.sections.flatMap((section) => section.items),
];
const dangerSection = catalog.sections[catalog.sections.length - 1];
const payloads = catalog.searchItems.map((item) => item.mode + ':' + item.text.trim().toLowerCase());
const validModes = new Set(['send', 'prefill', 'special']);
const validPlatforms = new Set(['all', 'web']);
const validRisks = new Set(['routine', 'external', 'sensitive', 'destructive']);

check(catalog.contextual.length > 0 && catalog.contextual.every((item) => item.sectionId === 'suggested'), 'Catalog should expose Suggested contextual actions.');
check(catalog.common.length > 0, 'Catalog should expose Common actions.');
check(dangerSection?.id === 'danger', 'Danger must be the last ordered section.');
check(hasStableIds(catalog.sections) && hasUniqueIds(catalog.sections), 'Catalog section IDs must be unique and stable.');
check(hasStableIds(catalog.searchItems) && hasUniqueIds(catalog.searchItems), 'Search item IDs must be unique and stable.');
check(payloads.length === new Set(payloads).size, 'Search items must not duplicate execution payloads.');
check(
  allCatalogItems.every((item) => validModes.has(item.mode) && validPlatforms.has(item.platform) && validRisks.has(item.risk)),
  'Every catalog item must declare an explicit valid mode, platform, and risk.',
);
check(!allCatalogItems.some((item) => item.label === 'Schedule Draft' || item.text.includes('gmail_draft')), 'Unsupported Gmail Schedule Draft must remain absent.');
check(catalog.sections.slice(0, -1).every((section) => section.items.every((item) => item.risk !== 'destructive')), 'Destructive actions must not appear outside Danger.');
check(Boolean(dangerSection && dangerSection.items.length > 0 && dangerSection.items.every((item) => item.risk === 'destructive')), 'Danger must contain only destructive actions.');
check(Boolean(dangerSection && dangerSection.items.every((item) => item.mode !== 'send')), 'Destructive actions must never use send mode.');

const checkIn = resolveQuickActionExecution('__CHECK_IN__');
const newTask = resolveQuickActionExecution('__NEW_TASK__');
const stepAway = resolveQuickActionExecution('__STEP_AWAY__');
check(checkIn.mode === 'prefill' && checkIn.text === 'Log this check-in: ', 'Check-in sentinel must resolve to truthful prefill text.');
check(newTask.mode === 'prefill' && newTask.text === '/task new ', 'New-task sentinel must resolve to truthful prefill text.');
check(stepAway.mode === 'prefill' && stepAway.text === "I'm stepping away. Help me write a clear handoff for ", 'Step-away sentinel must resolve to truthful handoff prefill text.');

const existingDraft = 'Keep this draft intact';
const mergedDraft = mergeChatActionDraft(existingDraft, '/summarize ');
check(mergedDraft.startsWith(existingDraft) && mergedDraft.includes('/summarize '), 'Draft merging must preserve a nonempty existing draft.');
check(mergeChatActionDraft(existingDraft + '\\n\\n/summarize ', '/summarize ') === existingDraft + '\\n\\n/summarize ', 'Draft merging must not duplicate an existing action.');

const requiredWebIds = new Set(['openswan', 'computer-use', 'pair-desktop', 'send-crypto']);
const requiredWebActions = ALL_QUICK_ACTIONS.filter((item) => requiredWebIds.has(item.id));
check(requiredWebActions.length === requiredWebIds.size, 'Required web-only actions must remain registered.');
check(requiredWebActions.every((item) => item.platform === 'web'), 'Web-only quick actions must explicitly declare platform web.');
check(catalog.searchItems.filter((item) => requiredWebIds.has(item.id)).every((item) => item.platform === 'web'), 'Catalog must preserve platform web on web-only actions.');

if (failures.length) {
  console.error('Chat actions catalog failures:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}

console.log('Chat actions catalog checks passed (' + passes + ' assertions).');
`;

  const tsconfigSource = JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'CommonJS',
      moduleResolution: 'Node',
      esModuleInterop: true,
      strict: true,
      skipLibCheck: true,
      rootDir: projectRoot,
      outDir,
    },
    include: [
      runnerPath,
      path.join(projectRoot, 'src/lib/chatCommandRegistry.ts'),
      path.join(projectRoot, 'src/lib/chatActions.ts'),
    ],
  }, null, 2);

  await fs.writeFile(runnerPath, runnerSource, 'utf8');
  await fs.writeFile(tsconfigPath, tsconfigSource, 'utf8');

  const tscBin = require.resolve('typescript/bin/tsc');
  try {
    await run(process.execPath, [tscBin, '-p', tsconfigPath]);
    const compiledRunner = path.join(outDir, path.relative(projectRoot, runnerPath)).replace(/\.ts$/, '.js');
    const { stdout } = await run(process.execPath, [compiledRunner]);
    process.stdout.write(stdout);
    await checkSourceContracts();
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
