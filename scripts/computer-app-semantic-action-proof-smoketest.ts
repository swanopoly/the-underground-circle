/**
 * Focused smoke for the exact native semantic-action canary.
 *
 * No GUI is opened. This exercises the real bridge classifier extracted
 * from claude-bridge.js plus the adapter's observe/prepare/approve/
 * perform/proof state machine with deterministic fakes.
 *
 * Run:
 *   /Users/cswanson/.npm/_npx/fd45a72a545557e9/node_modules/.bin/tsx \
 *     scripts/computer-app-semantic-action-proof-smoketest.ts
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

type SemanticActionFn = (
  request: Record<string, any>,
  deps: {
    observeApp: (args: Record<string, any>) => Promise<Record<string, any>>;
    observeSemanticActionTarget: (args: Record<string, any>) => Promise<Record<string, any>>;
    approvalGate: (proposal: Record<string, any>) => Promise<Record<string, any>>;
    performSemanticAction: (args: Record<string, any>) => Promise<Record<string, any>>;
  },
) => Promise<Record<string, any>>;

function extractFunction(source: string, name: string): (...args: any[]) => any {
  const start = `/* UC_SMOKE_EXTRACT_START ${name} */`;
  const end = `/* UC_SMOKE_EXTRACT_END ${name} */`;
  const startAt = source.indexOf(start);
  const endAt = source.indexOf(end);
  assert(startAt >= 0 && endAt > startAt, `${name} extraction markers exist`);
  const body = source.slice(startAt + start.length, endAt);
  return new Function(`${body}\nreturn ${name};`)() as (...args: any[]) => any;
}

function loadSemanticAction(): SemanticActionFn {
  const Module = require('node:module') as { _load: (...args: any[]) => any };
  const originalLoad = Module._load;
  const noOpSubscription = { remove() {} };
  const noOpAsync = async () => null;
  const reactNativeStub = new Proxy({
    Platform: {
      OS: 'web',
      select: (options: Record<string, unknown>) => options.web ?? options.default,
    },
    NativeModules: {},
    StyleSheet: {
      create: <T>(styles: T) => styles,
      flatten: <T>(style: T) => style,
      hairlineWidth: 1,
    },
    AppState: {
      currentState: 'active',
      addEventListener: () => noOpSubscription,
    },
    Dimensions: {
      get: () => ({ width: 1280, height: 800, scale: 1, fontScale: 1 }),
      addEventListener: () => noOpSubscription,
    },
    Linking: {
      addEventListener: () => noOpSubscription,
      canOpenURL: async () => false,
      getInitialURL: noOpAsync,
      openURL: noOpAsync,
    },
  }, {
    get(target, property) {
      if (property in target) return (target as Record<PropertyKey, unknown>)[property];
      return () => null;
    },
  });
  const asyncStorageStub = {
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
    multiGet: async () => [],
    multiSet: async () => undefined,
  };
  Module._load = function patchedLoad(request: string, parent: unknown, isMain: unknown) {
    if (request === 'react-native') return reactNativeStub;
    if (request === '@react-native-async-storage/async-storage') {
      return { __esModule: true, default: asyncStorageStub, ...asyncStorageStub };
    }
    if (request === 'expo-secure-store') {
      return {
        getItemAsync: async () => null,
        setItemAsync: async () => undefined,
        deleteItemAsync: async () => undefined,
      };
    }
    const parentFile = typeof (parent as { filename?: unknown } | null)?.filename === 'string'
      ? String((parent as { filename: string }).filename)
      : '';
    if (request === './supabase' && parentFile.includes('/src/lib/')) {
      return { supabase: {} };
    }
    return originalLoad.apply(this, [request, parent, isMain]);
  };
  try {
    const adapter = require('../src/lib/computerAppAdapter') as {
      __computerAppAdapterTestables?: {
        executeObservedNativeSemanticAction?: SemanticActionFn;
      };
    };
    const semanticAction = adapter.__computerAppAdapterTestables?.executeObservedNativeSemanticAction;
    assert.equal(typeof semanticAction, 'function', 'adapter exports native semantic action testable');
    return semanticAction as SemanticActionFn;
  } finally {
    Module._load = originalLoad;
  }
}

const APP = 'Preview';
const PID = 4242;
const GENERATION = 17;
const TARGET_PATH = '0.0.0';
const TARGET_ROLE = 'AXButton';
const TARGET_LABEL = 'Show Details';
const TARGET_ID = '1'.repeat(48);
const TARGET_FINGERPRINT = '2'.repeat(64);
const TREE_BEFORE = '3'.repeat(64);
const TREE_AFTER = '4'.repeat(64);
const PATH_HASH = '5'.repeat(64);
const LABEL_HASH = '6'.repeat(64);
const APPROVAL_HASH = '7'.repeat(16);
const EVIDENCE_ID = 'native-semantic-smoke-evidence';

function tree(label = TARGET_LABEL, role = TARGET_ROLE, value?: string): Record<string, any> {
  return {
    id: '0',
    role: 'AXApplication',
    label: APP,
    children: [{
      id: '0.0',
      role: 'AXWindow',
      label: 'Document',
      children: [{
        id: TARGET_PATH,
        role,
        label,
        ...(value == null ? {} : { value }),
      }],
    }],
  };
}

function observation(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    ok: true,
    data: {
      requestedAppName: APP,
      resolvedAppName: APP,
      processIdentityVersion: 1,
      app: APP,
      pid: PID,
      appRunning: true,
      frontmost: true,
      frontmostApp: APP,
      windowCount: 1,
      windowTitles: ['SECRET WINDOW TITLE'],
      tree: tree(),
      budget_used: 3,
      indexGeneration: GENERATION,
      ...overrides,
    },
  };
}

function prepared(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    ok: true,
    data: {
      schemaVersion: 1,
      action: 'press',
      targetId: TARGET_ID,
      targetFingerprint: TARGET_FINGERPRINT,
      evidenceId: EVIDENCE_ID,
      observedAt: '2026-07-26T12:00:00.000Z',
      expiresAt: '2026-07-26T12:02:00.000Z',
      app: APP,
      resolvedAppName: APP,
      pid: PID,
      targetPath: TARGET_PATH,
      targetRole: TARGET_ROLE,
      targetLabel: TARGET_LABEL,
      indexGeneration: GENERATION,
      targetSummary: `Press "${TARGET_LABEL}" (${TARGET_ROLE}) in ${APP}`,
      approvalRequired: true,
      risk: 'medium',
      ...overrides,
    },
  };
}

function proof(
  diffKind: string = 'target_semantics_changed',
  overrides: Record<string, any> = {},
): Record<string, any> {
  const completionVerified = diffKind === 'target_semantics_changed' || diffKind === 'target_disappeared';
  return {
    schemaVersion: 1,
    operation: 'native_semantic_press',
    action: 'press',
    app: APP,
    pid: PID,
    targetRole: TARGET_ROLE,
    targetPathHash: PATH_HASH,
    targetLabelHash: LABEL_HASH,
    targetFingerprint: TARGET_FINGERPRINT,
    evidenceId: EVIDENCE_ID,
    approvalRequired: true,
    approvalReceiptHash: APPROVAL_HASH,
    mutationNeeded: true,
    mutationAttempted: true,
    mutationPerformed: completionVerified,
    noOp: false,
    dispatchedAt: '2026-07-26T12:00:01.000Z',
    dispatchAcknowledged: true,
    dispatchMethod: 'ax_press',
    completionVerified,
    outcomeUnknown: !completionVerified,
    outcomeUnknownPolicy: 'verify_before_retry',
    replayAllowed: false,
    before: {
      observedAt: '2026-07-26T12:00:00.500Z',
      app: APP,
      pid: PID,
      nodeCount: 3,
      treeFingerprint: TREE_BEFORE,
      targetPresent: true,
      targetFingerprint: TARGET_FINGERPRINT,
    },
    after: {
      observedAt: '2026-07-26T12:00:01.250Z',
      app: APP,
      pid: PID,
      nodeCount: 3,
      treeFingerprint: TREE_AFTER,
      targetPresent: diffKind !== 'target_disappeared',
      targetFingerprint: diffKind === 'target_disappeared'
        ? null
        : diffKind === 'target_semantics_changed'
          ? '8'.repeat(64)
          : TARGET_FINGERPRINT,
    },
    diff: {
      kind: diffKind,
      treeChanged: true,
      targetPresentBefore: true,
      targetPresentAfter: diffKind !== 'target_disappeared',
    },
    ...overrides,
  };
}

function execution(diffKind = 'target_semantics_changed', overrides: Record<string, any> = {}): Record<string, any> {
  const receipt = proof(diffKind);
  return {
    ok: receipt.completionVerified === true,
    ...(!receipt.completionVerified ? {
      error: 'exact target postcondition not verified',
      errorCode: 'native_semantic_verification_failed',
    } : {}),
    data: {
      app: APP,
      pid: PID,
      action: 'press',
      targetRole: TARGET_ROLE,
      targetPathHash: PATH_HASH,
      targetLabelHash: LABEL_HASH,
      targetFingerprint: TARGET_FINGERPRINT,
      evidenceId: EVIDENCE_ID,
      completionVerified: receipt.completionVerified,
      outcomeUnknown: receipt.outcomeUnknown,
      replayAllowed: false,
      proof: receipt,
      ...overrides,
    },
  };
}

function request(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    action: 'press',
    appName: APP,
    expectedPid: PID,
    targetPath: TARGET_PATH,
    expectedRole: TARGET_ROLE,
    expectedLabel: TARGET_LABEL,
    ...overrides,
  };
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const bridgeSource = fs.readFileSync(path.join(repoRoot, 'scripts/claude-bridge.js'), 'utf8');
  const desktopClientSource = fs.readFileSync(path.join(repoRoot, 'src/lib/desktopBridge.ts'), 'utf8');
  const classify = extractFunction(bridgeSource, 'classifyNativeSemanticActionTarget');
  let assertions = 0;
  const check = (condition: unknown, message: string) => {
    assertions += 1;
    assert.ok(condition, message);
  };

  for (const label of [
    'Show Details',
    'Hide Sidebar',
    'Settings',
    'Preferences',
    'Help',
    'About Preview',
    'Zoom In',
    'Fit to Window',
  ]) {
    check(classify({ role: 'AXButton', label }, '').ok === true, `${label} is in the narrow canary`);
  }
  for (const sample of [
    [{ role: 'AXTextField', label: 'Settings' }, '', 'text field'],
    [{ role: 'AXCheckBox', label: 'Show Details' }, '', 'state control'],
    [{ role: 'AXButton', label: 'Show Details', value: '1' }, '', 'value-bearing button'],
    [{ role: 'AXButton', label: 'Show Details', containerRole: 'AXSheet' }, '', 'modal target'],
    [{ role: 'AXButton', label: 'Delete' }, '', 'destructive label'],
    [{ role: 'AXButton', label: 'Settings' }, 'Payment and billing dialog', 'payment context'],
    [{ role: 'AXMenuItem', label: 'Help' }, 'Sign in to your account', 'login context'],
    [{ role: 'AXButton', label: 'Preferences' }, 'Allow camera permission', 'permission context'],
    [{ role: 'AXButton', label: 'Continue' }, '', 'unknown semantics'],
  ] as const) {
    check(classify(sample[0], sample[1]).ok === false, `${sample[2]} is rejected`);
  }

  check(
    bridgeSource.includes('nativeSemanticActionTargets.delete(targetId);'),
    'one-shot target is deleted by its consume helper',
  );
  const semanticRoute = bridgeSource.slice(
    bridgeSource.indexOf("if (url === '/desktop/semantic_action_target'"),
    bridgeSource.indexOf('// `/desktop/click_element`'),
  );
  check(
    semanticRoute.indexOf('consumeNativeSemanticActionTarget(targetId)')
      < semanticRoute.indexOf('collectFreshFrontmostNativeSemanticTree(capability'),
    'capability is consumed before any fresh validation or dispatch work',
  );
  check(
    bridgeSource.includes("execFile('/usr/bin/osascript', ['-e', frontmostScript]")
      && bridgeSource.includes('the exact target app is no longer frontmost'),
    'fresh pre-dispatch validation requires the exact target app to remain frontmost',
  );
  check(
    semanticRoute.includes("cached.semanticSlice !== 'full'")
      && semanticRoute.includes('cached.semanticMaxDepth !== 10')
      && semanticRoute.includes('cached.semanticMaxNodes !== 400'),
    'target issuance requires the full bounded observation contract',
  );
  check(
    semanticRoute.includes("targetDiffKind === 'target_disappeared'")
      && semanticRoute.includes("targetDiffKind === 'target_semantics_changed'"),
    'completion is pinned to an exact-target local postcondition',
  );
  check(
    !/targetDiffKind\s*!==\s*['"]unchanged['"]/.test(semanticRoute),
    'global tree change is not accepted as completion',
  );
  const proofBuilder = bridgeSource.slice(
    bridgeSource.indexOf('function buildNativeSemanticActionProof'),
    bridgeSource.indexOf('function writeNativeSemanticPreDispatchFailure'),
  );
  check(!/\btargetPath:/.test(proofBuilder), 'execution proof omits the raw AX path');
  check(!/\btargetLabel:/.test(proofBuilder), 'execution proof omits the raw target label');
  check(proofBuilder.includes('targetPathHash') && proofBuilder.includes('targetLabelHash'), 'proof uses path/label hashes');
  check(
    desktopClientSource.includes("attachBodyOnError: true")
      && desktopClientSource.includes('performNativeSemanticAction'),
    'desktop client preserves structured uncertain-outcome proof',
  );

  const run = loadSemanticAction();

  {
    const calls: string[] = [];
    let proposal: Record<string, any> | null = null;
    let performArgs: Record<string, any> | null = null;
    const result = await run(request(), {
      observeApp: async (args) => {
        calls.push('observe');
        check(args.maxDepth === 10 && args.maxNodes === 400, 'adapter requests a bounded full fresh tree');
        check(!('target' in args), 'adapter does not request a lossy target slice');
        return observation();
      },
      observeSemanticActionTarget: async (args) => {
        calls.push('prepare');
        check(args.pid === PID && args.indexGeneration === GENERATION, 'prepare pins PID and tree generation');
        check(args.targetPath === TARGET_PATH, 'prepare pins the exact AX path');
        return prepared();
      },
      approvalGate: async (value) => {
        calls.push('approval');
        proposal = value;
        return { approved: true, approvalId: 'approval:smoke:0001' };
      },
      performSemanticAction: async (args) => {
        calls.push('perform');
        performArgs = args;
        return execution();
      },
    });
    check(result.ok === true, 'exact target fingerprint change verifies completion');
    check(calls.join('>') === 'observe>prepare>approval>perform', 'observe/prepare/approve/perform order is exact');
    check((performArgs as any)?.targetId === TARGET_ID, 'ephemeral capability is used for the one perform call');
    check((performArgs as any)?.approvalId === 'approval:smoke:0001', 'runtime approval receipt gates perform');
    check(!('targetId' in (proposal || {})), 'approval proposal does not expose the capability');
    check(!('targetPath' in (proposal || {})), 'approval proposal does not expose the raw path');
    check(!('targetLabel' in (proposal || {})), 'approval proposal does not expose a raw label field');
    check((proposal as any)?.observedAt === '2026-07-26T12:00:00.000Z', 'approval proposal carries the sealed privacy-safe observation epoch');
    check((proposal as any)?.indexGeneration === GENERATION, 'approval proposal carries the positive sealed tree generation');
    check(result.data?.proof?.diff?.kind === 'target_semantics_changed', 'receipt records the exact-target diff');
    check(result.data?.proof?.noOp === false, 'semantic mutation canary is never reported as a no-op');
    check(result.data?.replayAllowed === false, 'successful action remains non-replayable');
    const serialized = JSON.stringify(result);
    check(!serialized.includes(TARGET_ID), 'execution result omits the bearer target capability');
    check(!serialized.includes(TARGET_PATH), 'execution result omits the raw AX path');
    check(!serialized.includes(TARGET_LABEL), 'execution result omits the raw target label');
    check(!serialized.includes('SECRET WINDOW TITLE'), 'execution result omits untrusted window text');
  }

  {
    const result = await run(request(), {
      observeApp: async () => observation(),
      observeSemanticActionTarget: async () => prepared(),
      approvalGate: async () => ({ approved: true, approvalId: 'approval:smoke:disappeared' }),
      performSemanticAction: async () => execution('target_disappeared'),
    });
    check(result.ok === true, 'exact target disappearance is also valid local completion proof');
  }

  {
    let prepares = 0;
    const result = await run(request(), {
      observeApp: async () => ({
        ok: false,
        error: '401 token=observe-secret /Users/example/private.ax',
        errorCode: 'timeout',
      }),
      observeSemanticActionTarget: async () => {
        prepares += 1;
        return prepared();
      },
      approvalGate: async () => ({ approved: true, approvalId: 'approval:smoke:observe' }),
      performSemanticAction: async () => execution(),
    });
    const serialized = JSON.stringify(result);
    check(result.ok === false && prepares === 0, 'unavailable fresh semantic observation blocks before target preparation');
    check(result.data?.errorCode === 'timeout', 'semantic observation failure preserves a bounded recovery code');
    check(!serialized.includes('observe-secret') && !serialized.includes('/Users/example/private.ax'), 'semantic observation failure redacts provider details and paths');
  }

  {
    let approvals = 0;
    const result = await run(request(), {
      observeApp: async () => observation(),
      observeSemanticActionTarget: async () => ({
        ok: false,
        error: '403 token=prepare-secret /Users/example/private.target',
        errorCode: 'connection_failed',
      }),
      approvalGate: async () => {
        approvals += 1;
        return { approved: true, approvalId: 'approval:smoke:prepare' };
      },
      performSemanticAction: async () => execution(),
    });
    const serialized = JSON.stringify(result);
    check(result.ok === false && approvals === 0, 'failed semantic target preparation blocks before approval');
    check(result.data?.errorCode === 'connection_failed', 'semantic target preparation preserves a bounded recovery code');
    check(!serialized.includes('prepare-secret') && !serialized.includes('/Users/example/private.target'), 'semantic target preparation redacts provider details and paths');
  }

  {
    let performs = 0;
    const result = await run(request(), {
      observeApp: async () => observation(),
      observeSemanticActionTarget: async () => prepared(),
      approvalGate: async () => ({ approved: false, reason: 'user declined token=approval-secret /Users/example/approval.json' }),
      performSemanticAction: async () => {
        performs += 1;
        return execution();
      },
    });
    check(result.ok === false && performs === 0, 'approval denial dispatches nothing');
    check(result.data?.mutationAttempted === false, 'approval denial records no mutation attempt');
    check(result.data?.outcomeUnknown === false, 'approval denial is not outcome-unknown');
    check(result.data?.replayAllowed === false, 'denied target is not advertised as replayable');
    check(!JSON.stringify(result).includes(TARGET_ID), 'denial result does not expose the capability');
    check(!JSON.stringify(result).includes('approval-secret'), 'approval denial does not echo untrusted gate details');
    check(!JSON.stringify(result).includes('/Users/example/approval.json'), 'approval denial does not echo a local path');
  }

  {
    let performs = 0;
    const result = await run(request(), {
      observeApp: async () => observation(),
      observeSemanticActionTarget: async () => prepared(),
      approvalGate: async () => {
        throw new Error('database token=approval-throw-secret /Users/example/db.log');
      },
      performSemanticAction: async () => {
        performs += 1;
        return execution();
      },
    });
    const serialized = JSON.stringify(result);
    check(result.ok === false && performs === 0, 'approval-gate exception fails closed before semantic dispatch');
    check(!serialized.includes('approval-throw-secret') && !serialized.includes('/Users/example/db.log'), 'approval-gate exception details are redacted');
  }

  {
    let prepares = 0;
    let performs = 0;
    const result = await run(request({ expectedLabel: 'Help' }), {
      observeApp: async () => observation(),
      observeSemanticActionTarget: async () => {
        prepares += 1;
        return prepared();
      },
      approvalGate: async () => ({ approved: true, approvalId: 'approval:smoke:0002' }),
      performSemanticAction: async () => {
        performs += 1;
        return execution();
      },
    });
    check(result.ok === false && prepares === 0 && performs === 0, 'exact label mismatch blocks before target issuance');
  }

  {
    let prepares = 0;
    const result = await run(request({ expectedPid: PID + 1 }), {
      observeApp: async () => observation(),
      observeSemanticActionTarget: async () => {
        prepares += 1;
        return prepared();
      },
      approvalGate: async () => ({ approved: true, approvalId: 'approval:smoke:pid' }),
      performSemanticAction: async () => execution(),
    });
    check(result.ok === false && prepares === 0, 'caller-bound expected PID must match the fresh observation');
  }

  {
    let prepares = 0;
    const result = await run(request(), {
      observeApp: async () => observation({ frontmost: false, frontmostApp: 'Finder' }),
      observeSemanticActionTarget: async () => {
        prepares += 1;
        return prepared();
      },
      approvalGate: async () => ({ approved: true, approvalId: 'approval:smoke:frontmost' }),
      performSemanticAction: async () => execution(),
    });
    check(result.ok === false && prepares === 0, 'background app observation cannot issue a semantic mutation target');
  }

  {
    let approvals = 0;
    let performs = 0;
    const result = await run(request(), {
      observeApp: async () => observation(),
      observeSemanticActionTarget: async () => prepared({ pid: PID + 1 }),
      approvalGate: async () => {
        approvals += 1;
        return { approved: true, approvalId: 'approval:smoke:0003' };
      },
      performSemanticAction: async () => {
        performs += 1;
        return execution();
      },
    });
    check(result.ok === false && approvals === 0 && performs === 0, 'prepared PID drift blocks before approval and dispatch');
  }

  {
    let approvals = 0;
    const result = await run(request(), {
      observeApp: async () => observation(),
      observeSemanticActionTarget: async () => prepared({ observedAt: 'not-an-observation-epoch' }),
      approvalGate: async () => {
        approvals += 1;
        return { approved: true, approvalId: 'approval:smoke:bad-epoch' };
      },
      performSemanticAction: async () => execution(),
    });
    check(result.ok === false && approvals === 0, 'malformed sealed observedAt blocks before approval');
  }

  {
    let approvals = 0;
    const result = await run(request(), {
      observeApp: async () => observation(),
      observeSemanticActionTarget: async () => prepared({ indexGeneration: 0 }),
      approvalGate: async () => {
        approvals += 1;
        return { approved: true, approvalId: 'approval:smoke:bad-generation' };
      },
      performSemanticAction: async () => execution(),
    });
    check(result.ok === false && approvals === 0, 'non-positive sealed indexGeneration blocks before approval');
  }

  {
    let performs = 0;
    const result = await run(request(), {
      observeApp: async () => observation(),
      observeSemanticActionTarget: async () => prepared(),
      approvalGate: async () => ({ approved: true, approvalId: 'approval:smoke:0004' }),
      performSemanticAction: async () => {
        performs += 1;
        return execution('tree_changed');
      },
    });
    check(result.ok === false && performs === 1, 'global-only tree change is not completion and is never replayed');
    check(result.data?.outcomeUnknown === true, 'global-only tree change is outcome-unknown');
    check(result.data?.replayAllowed === false, 'global-only tree change forbids replay');
  }

  {
    let performs = 0;
    const forgedTreeOnly = execution('tree_changed');
    forgedTreeOnly.ok = true;
    forgedTreeOnly.data.completionVerified = true;
    forgedTreeOnly.data.outcomeUnknown = false;
    forgedTreeOnly.data.proof.completionVerified = true;
    forgedTreeOnly.data.proof.outcomeUnknown = false;
    forgedTreeOnly.data.proof.mutationPerformed = true;
    const result = await run(request(), {
      observeApp: async () => observation(),
      observeSemanticActionTarget: async () => prepared(),
      approvalGate: async () => ({ approved: true, approvalId: 'approval:smoke:forged' }),
      performSemanticAction: async () => {
        performs += 1;
        return forgedTreeOnly;
      },
    });
    check(result.ok === false && performs === 1, 'forged success with global-only churn still fails closed');
    check(result.data?.outcomeUnknown === true, 'forged global-only success becomes outcome-unknown');
    check(result.data?.replayAllowed === false, 'forged global-only success cannot authorize replay');
  }

  {
    const forgedSameTarget = execution('target_semantics_changed');
    forgedSameTarget.data.proof.after.targetFingerprint = TARGET_FINGERPRINT;
    const result = await run(request(), {
      observeApp: async () => observation(),
      observeSemanticActionTarget: async () => prepared(),
      approvalGate: async () => ({ approved: true, approvalId: 'approval:smoke:same-target' }),
      performSemanticAction: async () => forgedSameTarget,
    });
    check(result.ok === false, 'claimed target diff with identical before/after fingerprint fails closed');
    check(result.data?.outcomeUnknown === true, 'identical exact-target fingerprint is outcome-unknown');
    check(result.data?.replayAllowed === false, 'identical exact-target fingerprint forbids replay');
  }

  {
    const forgedUnknownMethod = execution('target_semantics_changed');
    forgedUnknownMethod.data.proof.dispatchMethod = 'unknown';
    const result = await run(request(), {
      observeApp: async () => observation(),
      observeSemanticActionTarget: async () => prepared(),
      approvalGate: async () => ({ approved: true, approvalId: 'approval:smoke:unknown-method' }),
      performSemanticAction: async () => forgedUnknownMethod,
    });
    check(result.ok === false, 'unknown helper method cannot prove a semantic press');
    check(result.data?.outcomeUnknown === true && result.data?.replayAllowed === false, 'unknown helper method is verify-before-retry only');
  }

  {
    let performs = 0;
    const result = await run(request(), {
      observeApp: async () => observation(),
      observeSemanticActionTarget: async () => prepared(),
      approvalGate: async () => ({ approved: true, approvalId: 'approval:smoke:0005' }),
      performSemanticAction: async () => {
        performs += 1;
        throw new Error('connection reset after write token=perform-secret /Users/example/perform.log');
      },
    });
    check(result.ok === false && performs === 1, 'transport failure performs exactly once');
    check(result.data?.outcomeUnknown === true, 'transport failure is conservatively outcome-unknown');
    check(result.data?.replayAllowed === false, 'transport failure forbids replay');
    check(!JSON.stringify(result).includes(TARGET_ID), 'transport failure does not leak the consumed capability');
    check(!JSON.stringify(result).includes('perform-secret'), 'transport exception details are redacted');
    check(!JSON.stringify(result).includes('/Users/example/perform.log'), 'transport exception local path is redacted');
  }

  {
    let performs = 0;
    const preDispatchProof = proof('not_dispatched', {
      mutationAttempted: false,
      mutationPerformed: false,
      dispatchAcknowledged: false,
      dispatchMethod: 'none',
      completionVerified: false,
      outcomeUnknown: false,
      dispatchedAt: undefined,
      before: null,
      after: null,
      diff: {
        kind: 'not_dispatched',
        treeChanged: false,
        targetPresentBefore: false,
        targetPresentAfter: false,
      },
    });
    const result = await run(request(), {
      observeApp: async () => observation(),
      observeSemanticActionTarget: async () => prepared(),
      approvalGate: async () => ({ approved: true, approvalId: 'approval:smoke:0006' }),
      performSemanticAction: async () => {
        performs += 1;
        return {
          ok: false,
          error: 'fresh target changed token=stale-secret /Users/example/stale.log',
          errorCode: 'native_semantic_target_stale',
          data: {
            ...execution().data,
            completionVerified: false,
            outcomeUnknown: false,
            proof: preDispatchProof,
          },
        };
      },
    });
    check(result.ok === false && performs === 1, 'pre-dispatch freshness failure consumes one target presentation');
    check(result.data?.mutationAttempted === false, 'pre-dispatch proof preserves no mutation attempt');
    check(result.data?.outcomeUnknown === false, 'pre-dispatch failure has a known no-dispatch outcome');
    check(result.data?.replayAllowed === false, 'consumed stale target is not replayable');
    const serialized = JSON.stringify(result);
    check(!serialized.includes('stale-secret') && !serialized.includes('/Users/example/stale.log'), 'pre-dispatch bridge failure details are redacted');
  }

  console.log(`computer-app semantic action proof smoke passed (${assertions} assertions)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
