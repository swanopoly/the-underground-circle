/**
 * Focused smoke for the adapter-level sealed native semantic value contract.
 *
 * No GUI or live bridge is opened. The lower bridge methods are deterministic
 * fakes because the production bridge does not yet expose the required
 * one-shot value-target endpoints.
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

type SemanticValueDeps = {
  observeApp: (args: Record<string, any>) => Promise<Record<string, any>>;
  fingerprint: (value: unknown) => Promise<string | null>;
  observeNativeSemanticValueTarget: (args: Record<string, any>) => Promise<Record<string, any>>;
  approvalGate: (proposal: Record<string, any>) => Promise<Record<string, any>>;
  performNativeSemanticValue: (args: Record<string, any>) => Promise<Record<string, any>>;
  now?: () => string;
};

type SemanticValueFn = (
  request: Record<string, any>,
  deps: SemanticValueDeps,
) => Promise<Record<string, any>>;

function loadSemanticValueMutation(): SemanticValueFn {
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
    if (request === './supabase' && parentFile.includes('/src/lib/')) return { supabase: {} };
    return originalLoad.apply(this, [request, parent, isMain]);
  };
  try {
    const adapter = require('../src/lib/computerAppAdapter') as {
      __computerAppAdapterTestables?: {
        executeObservedNativeSemanticValueMutation?: SemanticValueFn;
      };
    };
    const valueMutation = adapter.__computerAppAdapterTestables?.executeObservedNativeSemanticValueMutation;
    assert.equal(typeof valueMutation, 'function', 'adapter exports native semantic value testable');
    return valueMutation as SemanticValueFn;
  } finally {
    Module._load = originalLoad;
  }
}

const APP = 'TextEdit';
const PID = 7331;
const GENERATION = 41;
const TARGET_PATH = '0.0.1';
const TARGET_ROLE = 'AXTextField';
const TARGET_LABEL = 'Title';
const CURRENT = 'Draft';
const REQUESTED = 'Quarterly summary';
const TARGET_ID = '1'.repeat(48);
const EVIDENCE_ID = 'native-value-smoke-evidence';
const APPROVAL_ID = 'approval:native:value:smoke';
const OBSERVED_AT = '2026-08-05T12:00:00.000Z';
const EXPIRES_AT = '2026-08-05T12:02:00.000Z';
const BEFORE_DISPATCH_AT = '2026-08-05T12:00:02.500Z';
const DISPATCHED_AT = '2026-08-05T12:00:03.000Z';
const AFTER_DISPATCH_AT = '2026-08-05T12:00:04.000Z';

function digest(value: unknown): string {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  return crypto.createHash('sha256').update(serialized, 'utf8').digest('hex');
}

const TARGET_PATH_HASH = digest(TARGET_PATH);
const TARGET_LABEL_HASH = digest(TARGET_LABEL.toLowerCase());
const TARGET_FINGERPRINT = digest({
  schemaVersion: 1,
  operation: 'native_semantic_set_value_target',
  app: 'textedit',
  pid: PID,
  targetPath: TARGET_PATH,
  targetRole: TARGET_ROLE,
  targetLabel: TARGET_LABEL.toLowerCase(),
});
const CURRENT_HASH = digest(CURRENT);
const REQUESTED_HASH = digest(REQUESTED);
const APPROVAL_HASH = digest(APPROVAL_ID);

function tree(options: {
  role?: string;
  label?: string;
  value?: string;
  windowRole?: string;
  windowLabel?: string;
} = {}): Record<string, any> {
  return {
    id: '0',
    role: 'AXApplication',
    label: APP,
    children: [{
      id: '0.0',
      role: options.windowRole || 'AXWindow',
      label: options.windowLabel || 'Document',
      children: [{
        id: TARGET_PATH,
        role: options.role || TARGET_ROLE,
        label: options.label || TARGET_LABEL,
        value: options.value ?? CURRENT,
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
      windowTitles: ['UNTRUSTED WINDOW TITLE'],
      tree: tree(),
      budget_used: 3,
      indexGeneration: GENERATION,
      ...overrides,
    },
  };
}

function request(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    action: 'set_value',
    appName: APP,
    expectedPid: PID,
    targetPath: TARGET_PATH,
    expectedRole: TARGET_ROLE,
    expectedLabel: TARGET_LABEL,
    expectedCurrentValue: CURRENT,
    value: REQUESTED,
    ...overrides,
  };
}

function prepared(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    ok: true,
    data: {
      schemaVersion: 1,
      action: 'set_value',
      targetId: TARGET_ID,
      targetFingerprint: TARGET_FINGERPRINT,
      currentValueHash: CURRENT_HASH,
      requestedValueHash: REQUESTED_HASH,
      currentValueLength: CURRENT.length,
      requestedValueLength: REQUESTED.length,
      valueClass: 'non_secret_text',
      evidenceId: EVIDENCE_ID,
      observedAt: OBSERVED_AT,
      expiresAt: EXPIRES_AT,
      app: APP,
      resolvedAppName: APP,
      pid: PID,
      targetPath: TARGET_PATH,
      targetRole: TARGET_ROLE,
      targetLabel: TARGET_LABEL,
      indexGeneration: GENERATION,
      valueCapable: true,
      mutationNeeded: true,
      targetSummary: `Set one exact non-secret text field in ${APP}`,
      approvalRequired: true,
      risk: 'medium',
      ...overrides,
    },
  };
}

function snapshot(
  valueHash: string,
  valueLength: number,
  indexGeneration = GENERATION,
  observedAt = BEFORE_DISPATCH_AT,
): Record<string, any> {
  return {
    observedAt,
    app: APP,
    pid: PID,
    indexGeneration,
    targetPresent: true,
    valueCapable: true,
    targetFingerprint: TARGET_FINGERPRINT,
    valueHash,
    valueLength,
  };
}

function proof(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    schemaVersion: 1,
    operation: 'native_semantic_set_value',
    action: 'set_value',
    app: APP,
    pid: PID,
    targetRole: TARGET_ROLE,
    targetPathHash: TARGET_PATH_HASH,
    targetLabelHash: TARGET_LABEL_HASH,
    targetFingerprint: TARGET_FINGERPRINT,
    currentValueHash: CURRENT_HASH,
    requestedValueHash: REQUESTED_HASH,
    currentValueLength: CURRENT.length,
    requestedValueLength: REQUESTED.length,
    valueClass: 'non_secret_text',
    evidenceId: EVIDENCE_ID,
    approvalRequired: true,
    approvalReceiptHash: APPROVAL_HASH,
    mutationNeeded: true,
    mutationAttempted: true,
    mutationPerformed: true,
    noOp: false,
    dispatchedAt: DISPATCHED_AT,
    dispatchAcknowledged: true,
    dispatchMethod: 'ax_set_value',
    completionVerified: true,
    outcomeUnknown: false,
    outcomeUnknownPolicy: 'verify_before_retry',
    replayAllowed: false,
    before: snapshot(CURRENT_HASH, CURRENT.length),
    after: snapshot(REQUESTED_HASH, REQUESTED.length, GENERATION + 1, AFTER_DISPATCH_AT),
    diff: {
      kind: 'target_value_changed',
      targetPresentBefore: true,
      targetPresentAfter: true,
      valueChanged: true,
    },
    ...overrides,
  };
}

function execution(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    ok: true,
    data: {
      app: APP,
      pid: PID,
      action: 'set_value',
      targetRole: TARGET_ROLE,
      targetPathHash: TARGET_PATH_HASH,
      targetLabelHash: TARGET_LABEL_HASH,
      targetFingerprint: TARGET_FINGERPRINT,
      currentValueHash: CURRENT_HASH,
      requestedValueHash: REQUESTED_HASH,
      currentValueLength: CURRENT.length,
      requestedValueLength: REQUESTED.length,
      evidenceId: EVIDENCE_ID,
      completionVerified: true,
      outcomeUnknown: false,
      replayAllowed: false,
      proof: proof(),
      ...overrides,
    },
  };
}

function deps(overrides: Partial<SemanticValueDeps> = {}): SemanticValueDeps {
  return {
    observeApp: async () => observation(),
    fingerprint: async (value: unknown) => digest(value),
    observeNativeSemanticValueTarget: async () => prepared(),
    approvalGate: async () => ({ approved: true, approvalId: APPROVAL_ID }),
    performNativeSemanticValue: async () => execution(),
    now: () => '2026-08-05T12:00:02.000Z',
    ...overrides,
  };
}

async function main(): Promise<void> {
  let assertions = 0;
  const check = (condition: unknown, message: string) => {
    assert.ok(condition, message);
    assertions += 1;
  };
  const run = loadSemanticValueMutation();

  const adapterSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/lib/computerAppAdapter.ts'),
    'utf8',
  );
  const functionStart = adapterSource.indexOf('export async function executeObservedNativeSemanticValueMutation(');
  const functionEnd = adapterSource.indexOf('\nfunction toolMatches(', functionStart);
  const functionSource = adapterSource.slice(functionStart, functionEnd);
  check(functionStart >= 0 && functionEnd > functionStart, 'semantic value adapter function is source-visible');
  check(!functionSource.includes('bridgeSetElementValue'), 'sealed adapter never calls the raw set-element-value bridge');
  check(!functionSource.includes('bridgeMouseClick'), 'sealed adapter never falls back to coordinates');
  check(functionSource.includes('deps.observeNativeSemanticValueTarget({'), 'adapter requires one-shot target preparation');
  check(functionSource.includes('deps.performNativeSemanticValue({'), 'adapter requires one-shot value perform');
  check((functionSource.match(/deps\.performNativeSemanticValue\(\{/g) || []).length === 1, 'adapter has exactly one perform call site');

  {
    const calls: string[] = [];
    let proposal: Record<string, any> | null = null;
    let performArgs: Record<string, any> | null = null;
    const result = await run(request(), deps({
      observeApp: async (args: Record<string, any>) => {
        calls.push('observe');
        check(args.maxDepth === 10 && args.maxNodes === 400, 'adapter requests the bounded full semantic tree');
        check(!('target' in args), 'adapter does not accept a lossy target slice');
        return observation();
      },
      observeNativeSemanticValueTarget: async (args: Record<string, any>) => {
        calls.push('prepare');
        check(args.expectedCurrentValue === CURRENT && args.value === REQUESTED, 'raw values go only to transient target preparation');
        check(args.pid === PID && args.indexGeneration === GENERATION, 'target preparation pins PID and generation');
        return prepared();
      },
      approvalGate: async (value: Record<string, any>) => {
        calls.push('approval');
        proposal = value;
        return { approved: true, approvalId: APPROVAL_ID };
      },
      performNativeSemanticValue: async (args: Record<string, any>) => {
        calls.push('perform');
        performArgs = args;
        return execution();
      },
    }));
    check(result.ok === true, 'exact same-target requested-value proof verifies completion');
    check(calls.join('>') === 'observe>prepare>approval>perform', 'observe/prepare/approve/perform order is exact');
    check((performArgs as any)?.targetId === TARGET_ID, 'perform consumes the one-shot target capability');
    check(!('value' in (performArgs || {})), 'perform never receives the raw requested value');
    check((proposal as any)?.currentValueHash === CURRENT_HASH, 'approval binds the exact prior-value hash');
    check((proposal as any)?.requestedValueHash === REQUESTED_HASH, 'approval binds the exact requested-value hash');
    check((proposal as any)?.requestedValueLength === REQUESTED.length, 'approval binds requested length');
    const proposalJson = JSON.stringify(proposal);
    check(!proposalJson.includes(CURRENT) && !proposalJson.includes(REQUESTED), 'approval contains no raw field values');
    check(!proposalJson.includes(TARGET_PATH) && !proposalJson.includes(TARGET_LABEL), 'approval contains no raw path or label');
    const resultJson = JSON.stringify(result);
    check(!resultJson.includes(CURRENT) && !resultJson.includes(REQUESTED), 'receipt contains no raw field values');
    check(!resultJson.includes(TARGET_PATH) && !resultJson.includes(TARGET_LABEL), 'receipt contains no raw path or label');
    check(result.data?.proof?.after?.valueHash === REQUESTED_HASH, 'receipt carries exact requested-value hash proof');
    check(result.data?.replayAllowed === false, 'successful mutation remains non-replayable');
  }

  {
    let approvals = 0;
    let performs = 0;
    const desired = 'Already there';
    const desiredHash = digest(desired);
    const result = await run(request({ expectedCurrentValue: desired, value: desired }), deps({
      observeApp: async () => observation({ tree: tree({ value: desired }) }),
      observeNativeSemanticValueTarget: async () => prepared({
        targetId: null,
        currentValueHash: desiredHash,
        requestedValueHash: desiredHash,
        currentValueLength: desired.length,
        requestedValueLength: desired.length,
        mutationNeeded: false,
        approvalRequired: false,
        risk: 'low',
      }),
      approvalGate: async () => {
        approvals += 1;
        return { approved: true, approvalId: APPROVAL_ID };
      },
      performNativeSemanticValue: async () => {
        performs += 1;
        return execution();
      },
    }));
    check(result.ok === true && result.data?.noOp === true, 'bridge-hash-proven already-desired state returns verified no-op');
    check(approvals === 0 && performs === 0, 'verified no-op needs no approval and dispatches nothing');
    check(result.data?.mutationNeeded === false && result.data?.completionVerified === true, 'no-op receipt is explicit and verified');
  }

  {
    let approvals = 0;
    const result = await run(request(), deps({
      observeNativeSemanticValueTarget: async () => prepared({ requestedValueHash: 'f'.repeat(64) }),
      approvalGate: async () => {
        approvals += 1;
        return { approved: true, approvalId: APPROVAL_ID };
      },
    }));
    check(result.ok === false && approvals === 0, 'prepared requested-value hash mismatch blocks before approval');
  }

  {
    let approvals = 0;
    const result = await run(request(), deps({
      observeNativeSemanticValueTarget: async () => prepared({ observedAt: '2026-08-05T11:59:30.000Z' }),
      approvalGate: async () => {
        approvals += 1;
        return { approved: true, approvalId: APPROVAL_ID };
      },
    }));
    check(result.ok === false && approvals === 0, 'stale prepared evidence blocks before approval');
  }

  for (const [name, observedTree] of [
    ['secure field', tree({ role: 'AXSecureTextField' })],
    ['auth context', tree({ windowLabel: 'Sign in to your account' })],
    ['modal context', tree({ windowRole: 'AXSheet' })],
    ['destructive context', tree({ windowLabel: 'Replace existing document' })],
    ['unsupported control', tree({ role: 'AXComboBox' })],
  ] as const) {
    let prepares = 0;
    const result = await run(request({ expectedRole: observedTree.children[0].children[0].role }), deps({
      observeApp: async () => observation({ tree: observedTree }),
      observeNativeSemanticValueTarget: async () => {
        prepares += 1;
        return prepared();
      },
    }));
    check(result.ok === false && prepares === 0, `${name} is rejected before capability issuance`);
  }

  {
    let observes = 0;
    const secret = 'sk-' + 'a'.repeat(40);
    const result = await run(request({ value: secret }), deps({
      observeApp: async () => {
        observes += 1;
        return observation();
      },
    }));
    check(result.ok === false && observes === 0, 'secret-like requested value blocks before app observation');
    check(!JSON.stringify(result).includes(secret), 'secret-like rejection does not echo the secret');
  }

  {
    let prepares = 0;
    const result = await run(request({ expectedCurrentValue: 'Wrong prior value' }), deps({
      observeNativeSemanticValueTarget: async () => {
        prepares += 1;
        return prepared();
      },
    }));
    check(result.ok === false && prepares === 0, 'fresh exact current-value mismatch blocks before target issuance');
  }

  {
    let performs = 0;
    const result = await run(request(), deps({
      approvalGate: async () => ({ approved: false, reason: `declined ${REQUESTED}` }),
      performNativeSemanticValue: async () => {
        performs += 1;
        return execution();
      },
    }));
    check(result.ok === false && performs === 0, 'approval denial dispatches nothing');
    check(result.data?.mutationAttempted === false && result.data?.outcomeUnknown === false, 'approval denial is known pre-dispatch');
    check(!JSON.stringify(result).includes(REQUESTED), 'approval denial does not echo untrusted gate details or raw value');
  }

  {
    let performs = 0;
    const result = await run(request(), deps({
      performNativeSemanticValue: async () => {
        performs += 1;
        throw new Error(`transport lost after write ${REQUESTED}`);
      },
    }));
    check(result.ok === false && performs === 1, 'transport failure enters the perform boundary exactly once');
    check(result.data?.outcomeUnknown === true && result.data?.replayAllowed === false, 'ambiguous dispatch is outcome-unknown and non-replayable');
    check(!JSON.stringify(result).includes(REQUESTED), 'transport exception cannot leak the raw value');
  }

  {
    const wrongAfter = proof({
      after: snapshot(digest('Different value'), 'Different value'.length, GENERATION + 1),
    });
    const result = await run(request(), deps({
      performNativeSemanticValue: async () => execution({ proof: wrongAfter }),
    }));
    check(result.ok === false, 'wrong after-value hash cannot prove completion');
    check(result.data?.outcomeUnknown === true && result.data?.replayAllowed === false, 'wrong after value becomes non-replayable outcome-unknown');
  }

  {
    const proofWithUntrustedExtras = proof({
      rawValue: REQUESTED,
      targetPath: TARGET_PATH,
      targetLabel: TARGET_LABEL,
      arbitrary: { rawCurrentValue: CURRENT },
    });
    const result = await run(request(), deps({
      performNativeSemanticValue: async () => execution({ proof: proofWithUntrustedExtras }),
    }));
    check(result.ok === true, 'valid proof remains complete when the bridge adds untrusted fields');
    const serialized = JSON.stringify(result);
    check(!serialized.includes(CURRENT) && !serialized.includes(REQUESTED), 'proof projection drops untrusted raw-value extras');
    check(!serialized.includes(TARGET_PATH) && !serialized.includes(TARGET_LABEL), 'proof projection drops untrusted path/label extras');
  }

  {
    const wrongTarget = proof({
      after: { ...snapshot(REQUESTED_HASH, REQUESTED.length, GENERATION + 1), targetFingerprint: '9'.repeat(64) },
    });
    const result = await run(request(), deps({
      performNativeSemanticValue: async () => execution({ proof: wrongTarget }),
    }));
    check(result.ok === false, 'after proof on another target cannot complete');
  }

  {
    const unknownMethod = proof({ dispatchMethod: 'unknown' });
    const result = await run(request(), deps({
      performNativeSemanticValue: async () => execution({ proof: unknownMethod }),
    }));
    check(result.ok === false && result.data?.outcomeUnknown === true, 'unknown dispatch method cannot prove value mutation');
  }

  {
    const outOfOrder = proof({
      after: snapshot(REQUESTED_HASH, REQUESTED.length, GENERATION + 1, '2026-08-05T12:00:01.000Z'),
    });
    const result = await run(request(), deps({
      performNativeSemanticValue: async () => execution({ proof: outOfOrder }),
    }));
    check(result.ok === false && result.data?.outcomeUnknown === true, 'after proof captured before dispatch cannot verify completion');
  }

  {
    const beforeDispatch = proof({
      mutationAttempted: false,
      mutationPerformed: false,
      dispatchAcknowledged: false,
      dispatchMethod: 'none',
      completionVerified: false,
      outcomeUnknown: false,
      before: snapshot(CURRENT_HASH, CURRENT.length),
      after: null,
      diff: {
        kind: 'not_dispatched',
        targetPresentBefore: true,
        targetPresentAfter: false,
        valueChanged: false,
      },
    });
    const failed = execution({
      completionVerified: false,
      outcomeUnknown: false,
      proof: beforeDispatch,
    });
    failed.ok = false;
    failed.errorCode = 'native_semantic_target_stale';
    const result = await run(request(), deps({
      performNativeSemanticValue: async () => failed,
    }));
    check(result.ok === false && result.data?.mutationAttempted === false, 'bridge-proven pre-dispatch staleness remains known no-dispatch');
    check(result.data?.outcomeUnknown === false && result.data?.replayAllowed === false, 'consumed stale target is known but never replayable');
  }

  console.log(`computer-app semantic value proof smoke passed (${assertions} assertions)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
