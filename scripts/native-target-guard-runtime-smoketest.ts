/**
 * Focused transient native-target authority smoke.
 *
 * Run:
 *   npx tsx scripts/native-target-guard-runtime-smoketest.ts
 */

import { readFileSync } from 'node:fs';
import {
  dispatchSwanBotDesktopClientTool,
  serializeSwanBotClientToolResult,
  type SwanBotDesktopClientToolBridge,
} from '../src/lib/swanbotClientToolDispatcher';
import type { DesktopNativeUiTargetGuard } from '../src/lib/desktopBridge';

let failures = 0;
function assert(condition: unknown, message: string): void {
  if (condition) console.log(`pass: ${message}`);
  else {
    failures += 1;
    console.error(`FAIL: ${message}`);
  }
}

const appName = 'Notes';
const exactObservation = (overrides: Record<string, unknown> = {}) => ({
  requestedAppName: appName,
  resolvedAppName: appName,
  app: appName,
  pid: 4_100,
  processIdentityVersion: 1,
  appRunning: true,
  frontmost: true,
  frontmostApp: appName,
  windowCount: 1,
  windowTitles: ['Draft'],
  targetWindow: {
    id: 90_001,
    x: 20,
    y: 30,
    width: 900,
    height: 700,
  },
  tree: null,
  budget_used: 0,
  ...overrides,
});

type GuardCapture = { tool: string; guard: DesktopNativeUiTargetGuard };

function createBridge(args: {
  observation?: Record<string, unknown>;
  captures: GuardCapture[];
  observeCalls: { count: number };
}): SwanBotDesktopClientToolBridge {
  const capture = (
    tool: string,
    guard: DesktopNativeUiTargetGuard,
  ) => {
    args.captures.push({ tool, guard });
    // Deliberately echo the private capability. The dispatcher must redact it
    // before the client tool result can be serialized for a model.
    return Promise.resolve({ ok: true, data: { acknowledged: true, targetGuard: guard } });
  };
  return {
    observeApp: async () => {
      args.observeCalls.count += 1;
      return { ok: true, data: args.observation || exactObservation() };
    },
    typeText: async (_text, guard) => capture('desktop.type_text', guard),
    pasteText: async (_text, options) => capture('desktop.paste_text', options.targetGuard),
    pressKeys: async (_combo, guard) => capture('desktop.press_keys', guard),
    clickMenu: async (options) => capture('desktop.menu_click', options.targetGuard),
    clickAt: async (_x, _y, guard) => capture('desktop.click_at', guard),
    mouseMove: async (_x, _y, guard) => capture('desktop.mouse_move', guard),
    mouseClick: async (options) => capture('desktop.mouse_click', options.targetGuard),
    mouseDown: async (options) => capture('desktop.mouse_down', options.targetGuard),
    mouseUp: async (options) => capture('desktop.mouse_up', options.targetGuard),
    mouseDrag: async (options) => capture('desktop.mouse_drag', options.targetGuard),
    mouseScroll: async (options) => capture('desktop.mouse_scroll', options.targetGuard),
  } as unknown as SwanBotDesktopClientToolBridge;
}

const guardedCalls = [
  { name: 'desktop.type_text', input: { appName, text: 'hello' } },
  { name: 'desktop.paste_text', input: { appName, text: 'hello' } },
  { name: 'desktop.press_keys', input: { appName, combo: 'Cmd+S' } },
  { name: 'desktop.menu_click', input: { appName, menuPath: ['File', 'Save'] } },
  { name: 'desktop.click_at', input: { appName, x: 100, y: 120 } },
  { name: 'desktop.mouse_move', input: { appName, x: 100, y: 120 } },
  { name: 'desktop.mouse_click', input: { appName, x: 100, y: 120 } },
  { name: 'desktop.mouse_down', input: { appName, x: 100, y: 120 } },
  { name: 'desktop.mouse_up', input: { appName, x: 100, y: 120 } },
  {
    name: 'desktop.mouse_drag',
    input: { appName, fromX: 100, fromY: 120, toX: 300, toY: 320 },
  },
  { name: 'desktop.mouse_scroll', input: { appName, x: 100, y: 120, deltaY: 20 } },
] as const;

async function run(): Promise<void> {
  const captures: GuardCapture[] = [];
  const observeCalls = { count: 0 };
  const bridge = createBridge({ captures, observeCalls });
  for (const [index, call] of guardedCalls.entries()) {
    const result = await dispatchSwanBotDesktopClientTool(bridge, {
      id: `guarded-${index}`,
      name: call.name,
      input: call.input,
    });
    assert(result?.ok === true, `${call.name} dispatches after fresh exact observation`);
    const serialized = serializeSwanBotClientToolResult(result!);
    assert(
      !serialized.includes('targetGuard')
        && !serialized.includes('90001')
        && !serialized.includes('targetWindow'),
      `${call.name} result cannot serialize transient target authority`,
    );
  }
  assert(
    observeCalls.count === guardedCalls.length,
    'every native mutation obtains its own fresh observation',
  );
  assert(
    captures.length === guardedCalls.length
      && captures.every(({ guard }) => (
        guard.appName === appName
        && guard.pid === 4_100
        && guard.window.id === 90_001
        && guard.window.width === 900
      )),
    'every bridge mutation receives the exact app/PID/CGWindow/bounds guard',
  );
  assert(
    new Set(captures.map(({ guard }) => guard)).size === guardedCalls.length,
    'each dispatch receives a distinct one-shot target capability',
  );

  const missingAppCaptures: GuardCapture[] = [];
  const missingAppObserve = { count: 0 };
  const missingApp = await dispatchSwanBotDesktopClientTool(
    createBridge({ captures: missingAppCaptures, observeCalls: missingAppObserve }),
    { id: 'missing-app', name: 'desktop.type_text', input: { text: 'hello' } },
  );
  assert(
    missingApp?.ok === false
      && missingAppObserve.count === 0
      && missingAppCaptures.length === 0,
    'missing exact appName fails before observation or input',
  );

  const missingWindowCaptures: GuardCapture[] = [];
  const missingWindow = await dispatchSwanBotDesktopClientTool(
    createBridge({
      captures: missingWindowCaptures,
      observeCalls: { count: 0 },
      observation: exactObservation({ targetWindow: undefined }),
    }),
    { id: 'missing-window', name: 'desktop.press_keys', input: { appName, combo: 'Cmd+S' } },
  );
  assert(
    missingWindow?.ok === false && missingWindowCaptures.length === 0,
    'missing exact CGWindow proof fails closed before key input',
  );

  const overflowCaptures: GuardCapture[] = [];
  const overflow = await dispatchSwanBotDesktopClientTool(
    createBridge({
      captures: overflowCaptures,
      observeCalls: { count: 0 },
      observation: exactObservation({
        targetWindow: { id: 4_294_967_296, x: 20, y: 30, width: 900, height: 700 },
      }),
    }),
    { id: 'overflow', name: 'desktop.mouse_click', input: { appName, x: 100, y: 120 } },
  );
  assert(
    overflow?.ok === false && overflowCaptures.length === 0,
    'UInt32-overflow window identity fails closed before mouse input',
  );

  const unicodeAppName = '🦢'.repeat(160);
  const unicodeCaptures: GuardCapture[] = [];
  const unicodeResult = await dispatchSwanBotDesktopClientTool(
    createBridge({
      captures: unicodeCaptures,
      observeCalls: { count: 0 },
      observation: exactObservation({
        requestedAppName: unicodeAppName,
        resolvedAppName: unicodeAppName,
        app: unicodeAppName,
        frontmostApp: unicodeAppName,
      }),
    }),
    {
      id: 'unicode-boundary',
      name: 'desktop.type_text',
      input: { appName: unicodeAppName, text: 'hello' },
    },
  );
  assert(
    unicodeResult?.ok === true && unicodeCaptures.length === 1,
    '160 Unicode-code-point appName is accepted even when UTF-16 length is larger',
  );

  const overlongObserve = { count: 0 };
  const overlong = await dispatchSwanBotDesktopClientTool(
    createBridge({ captures: [], observeCalls: overlongObserve }),
    {
      id: 'unicode-overflow',
      name: 'desktop.type_text',
      input: { appName: `${unicodeAppName}🦢`, text: 'hello' },
    },
  );
  assert(
    overlong?.ok === false && overlongObserve.count === 0,
    '161 Unicode-code-point appName fails before observation',
  );

  const outsideCaptures: GuardCapture[] = [];
  const outside = await dispatchSwanBotDesktopClientTool(
    createBridge({ captures: outsideCaptures, observeCalls: { count: 0 } }),
    { id: 'outside', name: 'desktop.click_at', input: { appName, x: 1_200, y: 900 } },
  );
  assert(
    outside?.ok === false && outsideCaptures.length === 0,
    'coordinates outside the freshly observed target window fail closed',
  );

  const releaseCaptures: GuardCapture[] = [];
  const releaseObserve = { count: 0 };
  const missingReleasePoint = await dispatchSwanBotDesktopClientTool(
    createBridge({ captures: releaseCaptures, observeCalls: releaseObserve }),
    { id: 'release', name: 'desktop.mouse_up', input: { appName } },
  );
  assert(
    missingReleasePoint?.ok === false
      && releaseObserve.count === 0
      && releaseCaptures.length === 0,
    'mouse_up requires exact x/y before observation or dispatch',
  );

  const runtimeSource = readFileSync('src/lib/openswanToolRuntime.ts', 'utf8');
  const handlerStart = runtimeSource.indexOf('handler: async (sealedArgs) => {',
    runtimeSource.indexOf('normalizedArgs: prepared.dispatchArgs'));
  const captureIndex = runtimeSource.indexOf(
    'prepared.observationDeps.captureFreshTargetGuard()',
    handlerStart,
  );
  const bridgeDispatchIndex = runtimeSource.indexOf(
    'dispatchGenericNativeUiBridgeMutation(',
    captureIndex,
  );
  assert(
    handlerStart >= 0 && captureIndex > handlerStart && bridgeDispatchIndex > captureIndex,
    'OpenSwan durable handler observes and consumes exact target immediately before bridge dispatch',
  );
  assert(
    runtimeSource.includes('windowTitles: [observed.targetGuardFingerprint]'),
    'approval surface binding includes only an opaque exact-window fingerprint',
  );
  assert(
    runtimeSource.includes('Array.from(appName).length <= 160'),
    'OpenSwan target validation uses the canonical Unicode-code-point appName bound',
  );
  const approvalArgsStart = runtimeSource.indexOf(
    'const approvalArgs = deepFreezeOpenSwanApprovalArgs({',
  );
  const approvalArgsEnd = runtimeSource.indexOf('\n  return {', approvalArgsStart);
  const approvalArgsBlock = runtimeSource.slice(approvalArgsStart, approvalArgsEnd);
  assert(
    approvalArgsStart >= 0
      && approvalArgsEnd > approvalArgsStart
      && !approvalArgsBlock.includes('targetGuard')
      && !approvalArgsBlock.includes('targetWindow'),
    'raw target authority is absent from approval arguments',
  );

  if (failures > 0) {
    console.error(`\n${failures} transient native target guard smoke failure(s)`);
    process.exit(1);
  }
  console.log('\nAll transient native target guard runtime smoke cases passed.');
}

run().catch((error) => {
  console.error('FAIL: transient native target guard smoke crashed', error);
  process.exit(1);
});
