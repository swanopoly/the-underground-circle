/**
 * Focused smoke for observe-first native app launch/focus proof.
 *
 * Run:
 *   /Users/cswanson/.npm/_npx/fd45a72a545557e9/node_modules/.bin/tsx \
 *     scripts/computer-app-launch-focus-proof-smoketest.ts
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

type ActivationKind = 'open_app' | 'launch_app' | 'focus_app';
type ActivationFn = (
  kind: ActivationKind,
  appName: string,
  deps: {
    observeApp: (args: Record<string, unknown>) => Promise<Record<string, any>>;
    launchApp: (appName: string) => Promise<Record<string, any>>;
    focusApp: (appName: string) => Promise<Record<string, any>>;
    waitForApp?: (appName: string, timeoutMs?: number) => Promise<Record<string, any>>;
    now?: () => string;
  },
) => Promise<Record<string, any>>;

function loadActivation(): ActivationFn {
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
        executeObservedNativeAppActivation?: ActivationFn;
      };
    };
    const activation = adapter.__computerAppAdapterTestables?.executeObservedNativeAppActivation;
    assert.equal(typeof activation, 'function', 'adapter exports native activation testable');
    return activation as ActivationFn;
  } finally {
    Module._load = originalLoad;
  }
}

function appObservation(args: {
  app?: string;
  requestedAppName?: string;
  resolvedAppName?: string;
  pid?: number;
  indexGeneration?: number;
  appRunning: boolean;
  frontmost: boolean;
  windowCount?: number;
}): Record<string, any> {
  const app = args.app || args.resolvedAppName || 'Notes';
  const resolvedAppName = args.resolvedAppName || app;
  return {
    ok: true,
    data: {
      app,
      requestedAppName: args.requestedAppName || app,
      resolvedAppName,
      pid: args.appRunning ? (args.pid ?? 101) : 0,
      processIdentityVersion: 1,
      indexGeneration: args.indexGeneration ?? 7,
      appRunning: args.appRunning,
      frontmost: args.frontmost,
      windowCount: args.windowCount ?? 1,
      // These are deliberately sensitive, unbounded bridge fields. The
      // adapter proof must project them away.
      windowTitles: ['SECRET WINDOW TITLE'],
      tree: { role: 'AXTextArea', value: 'SECRET ACCESSIBILITY CONTENT' },
    },
  };
}

function fixedClock(): () => string {
  let tick = 0;
  return () => `2026-07-25T12:00:0${tick++}.000Z`;
}

function activationDispatch(appName: string): Record<string, any> {
  return {
    ok: true,
    data: {
      appName,
      requestedAppName: appName,
      resolvedAppName: appName,
    },
  };
}

async function main() {
  const activate = loadActivation();
  let assertions = 0;
  const check = (condition: unknown, message: string) => {
    assertions += 1;
    assert.ok(condition, message);
  };

  {
    const observations: Record<string, unknown>[] = [];
    let launches = 0;
    let waits = 0;
    const states = [
      appObservation({ appRunning: false, frontmost: false, windowCount: 0 }),
      appObservation({ appRunning: true, frontmost: true, windowCount: 2 }),
    ];
    const result = await activate('launch_app', 'Notes', {
      observeApp: async (args) => {
        observations.push(args);
        return states.shift()!;
      },
      launchApp: async (appName) => {
        launches += 1;
        return activationDispatch(appName);
      },
      focusApp: async () => ({ ok: false, errorCode: 'unexpected_focus' }),
      waitForApp: async (appName, timeoutMs) => {
        waits += 1;
        return { ok: true, data: { appName, elapsedMs: timeoutMs === 8_000 ? 20 : -1 } };
      },
      now: fixedClock(),
    });
    const proof = result.data?.proof;
    check(result.ok === true, 'launch succeeds only after running and foreground state are observed');
    check(result.data?.completionVerified === true, 'launch carries explicit completion proof');
    check(launches === 1, 'launch dispatch occurs exactly once when needed');
    check(waits === 1, 'launch uses the bounded readiness barrier before final observation');
    check(observations.length === 2, 'launch takes fresh before and after observations');
    check(observations.every((args) => args.maxDepth === 1 && args.maxNodes === 1), 'activation observations request a bounded bridge projection');
    check(proof?.requestedPostcondition === 'running_and_frontmost', 'launch proof records the foreground-safe postcondition');
    check(proof?.mutationNeeded === true && proof?.mutationPerformed === true, 'launch proof distinguishes needed and performed mutation');
    check(proof?.before?.appRunning === false && proof?.after?.appRunning === true, 'launch proof records bounded before/after state');
    const serialized = JSON.stringify(result);
    check(!serialized.includes('SECRET WINDOW TITLE'), 'launch proof omits window titles');
    check(!serialized.includes('SECRET ACCESSIBILITY CONTENT'), 'launch proof omits accessibility content');
  }

  {
    let focuses = 0;
    const states = [
      appObservation({ appRunning: true, frontmost: false }),
      appObservation({ appRunning: true, frontmost: true }),
    ];
    const result = await activate('focus_app', 'Notes', {
      observeApp: async () => states.shift()!,
      launchApp: async () => ({ ok: false, errorCode: 'unexpected_launch' }),
      focusApp: async (appName) => {
        focuses += 1;
        return activationDispatch(appName);
      },
      now: fixedClock(),
    });
    check(result.ok === true, 'focus succeeds after running plus frontmost are observed');
    check(focuses === 1, 'focus dispatch occurs exactly once when needed');
    check(result.data?.proof?.requestedPostcondition === 'running_and_frontmost', 'focus proof records its stronger postcondition');
    check(result.data?.proof?.after?.frontmost === true, 'focus proof records verified frontmost state');
  }

  {
    let launches = 0;
    let focuses = 0;
    let waits = 0;
    const states = [
      appObservation({ appRunning: false, frontmost: false, windowCount: 0 }),
      appObservation({ appRunning: true, frontmost: true, windowCount: 1 }),
    ];
    const result = await activate('open_app', 'Notes', {
      observeApp: async () => states.shift()!,
      launchApp: async (appName) => {
        launches += 1;
        return activationDispatch(appName);
      },
      focusApp: async (appName) => {
        focuses += 1;
        return activationDispatch(appName);
      },
      waitForApp: async () => {
        waits += 1;
        return { ok: true };
      },
      now: fixedClock(),
    });
    check(result.ok === true, 'open launches a stopped app and verifies it frontmost');
    check(launches === 1 && focuses === 0, 'open uses launch as its only activation when initially stopped');
    check(waits === 1, 'open waits only after its launch branch');
    check(result.data?.proof?.dispatchOperation === 'launch_app', 'open proof records the mutually exclusive launch branch');
    check(result.data?.proof?.requestedPostcondition === 'running_and_frontmost', 'open requires foreground proof, not process-only proof');
  }

  {
    let launches = 0;
    let focuses = 0;
    const states = [
      appObservation({ appRunning: true, frontmost: false, pid: 404 }),
      appObservation({ appRunning: true, frontmost: true, pid: 404 }),
    ];
    const result = await activate('open_app', 'Notes', {
      observeApp: async () => states.shift()!,
      launchApp: async (appName) => {
        launches += 1;
        return activationDispatch(appName);
      },
      focusApp: async (appName) => {
        focuses += 1;
        return activationDispatch(appName);
      },
      now: fixedClock(),
    });
    check(result.ok === true, 'open focuses an already-running background app');
    check(launches === 0 && focuses === 1, 'open uses focus as its only activation when initially running');
    check(result.data?.proof?.dispatchOperation === 'focus_app', 'open proof records the mutually exclusive focus branch');
  }

  {
    let mutations = 0;
    const result = await activate('open_app', 'Notes', {
      observeApp: async () => appObservation({ appRunning: true, frontmost: true, pid: 505 }),
      launchApp: async (appName) => {
        mutations += 1;
        return activationDispatch(appName);
      },
      focusApp: async (appName) => {
        mutations += 1;
        return activationDispatch(appName);
      },
      now: fixedClock(),
    });
    check(result.ok === true, 'open is a verified no-op when the app is already frontmost');
    check(mutations === 0, 'already-frontmost open performs no OS activation');
    check(result.data?.proof?.dispatchOperation === 'none', 'open no-op proof records no dispatch');
  }

  {
    let launches = 0;
    let focuses = 0;
    const states = [
      appObservation({ appRunning: false, frontmost: false, windowCount: 0 }),
      appObservation({ appRunning: true, frontmost: false, windowCount: 1 }),
    ];
    const result = await activate('open_app', 'Notes', {
      observeApp: async () => states.shift()!,
      launchApp: async (appName) => {
        launches += 1;
        return activationDispatch(appName);
      },
      focusApp: async (appName) => {
        focuses += 1;
        return activationDispatch(appName);
      },
      waitForApp: async () => ({ ok: true }),
      now: fixedClock(),
    });
    check(result.ok === false, 'open fails closed when a launched app loses foreground before proof');
    check(launches === 1 && focuses === 0, 'open never follows its launch branch with a second focus');
    check(result.data?.proof?.outcomeUnknown === true && result.data?.proof?.replayAllowed === false, 'foreground loss after launch is non-replayable outcome-unknown');
  }

  {
    let launches = 0;
    let observations = 0;
    const result = await activate('launch_app', 'Chrome', {
      observeApp: async (args) => {
        observations += 1;
        return appObservation({
          app: 'Google Chrome',
          requestedAppName: String(args.appName || ''),
          resolvedAppName: 'Google Chrome',
          pid: 202,
          appRunning: true,
          frontmost: true,
          windowCount: 1,
        });
      },
      launchApp: async () => {
        launches += 1;
        return activationDispatch('Chrome');
      },
      focusApp: async () => ({ ok: false, errorCode: 'unexpected_focus' }),
      now: fixedClock(),
    });
    check(result.ok === true, 'already-frontmost launch is a verified success');
    check(launches === 0, 'already-frontmost launch is a no-op');
    check(observations === 2, 'no-op still receives a second fresh observation');
    check(result.data?.proof?.mutationNeeded === false, 'no-op proof reports mutation was unnecessary');
    check(result.data?.proof?.mutationPerformed === false, 'no-op proof reports no mutation was performed');
  }

  {
    let launches = 0;
    let focuses = 0;
    const states = [
      appObservation({
        app: 'Google Chrome',
        requestedAppName: 'Chrome',
        resolvedAppName: 'Google Chrome',
        appRunning: true,
        frontmost: false,
        pid: 202,
      }),
      appObservation({
        app: 'Google Chrome',
        requestedAppName: 'Google Chrome',
        resolvedAppName: 'Google Chrome',
        appRunning: true,
        frontmost: true,
        pid: 202,
      }),
    ];
    const result = await activate('launch_app', 'Chrome', {
      observeApp: async () => states.shift()!,
      launchApp: async (appName) => {
        launches += 1;
        return activationDispatch(appName);
      },
      focusApp: async () => {
        focuses += 1;
        return { ok: false, errorCode: 'unexpected_focus' };
      },
      now: fixedClock(),
    });
    check(result.ok === true, 'background running launch performs one activation and requires fresh foreground proof');
    check(launches === 1 && focuses === 0, 'background running launch never adds a second focus activation');
    check(result.data?.proof?.before?.frontmost === false && result.data?.proof?.after?.frontmost === true, 'launch proof captures the foreground transition');
  }

  {
    let launches = 0;
    const states = [
      appObservation({
        app: 'Google Chrome',
        requestedAppName: 'Chrome',
        resolvedAppName: 'Google Chrome',
        appRunning: true,
        frontmost: false,
        pid: 202,
      }),
      appObservation({
        app: 'Google Chrome',
        requestedAppName: 'Google Chrome',
        resolvedAppName: 'Google Chrome',
        appRunning: true,
        frontmost: false,
        pid: 202,
      }),
    ];
    const result = await activate('launch_app', 'Chrome', {
      observeApp: async () => states.shift()!,
      launchApp: async (appName) => {
        launches += 1;
        return activationDispatch(appName);
      },
      focusApp: async () => ({ ok: false, errorCode: 'unexpected_focus' }),
      now: fixedClock(),
    });
    check(result.ok === false, 'launch fails closed when another app remains frontmost');
    check(launches === 1, 'foreground-proof failure does not replay launch');
    check(result.data?.proof?.outcomeUnknown === true && result.data?.proof?.replayAllowed === false, 'wrong-foreground launch becomes non-replayable outcome-unknown');
  }

  {
    let launches = 0;
    const states = [
      appObservation({ appRunning: false, frontmost: false, windowCount: 0 }),
      appObservation({ appRunning: false, frontmost: false, windowCount: 0 }),
    ];
    const result = await activate('launch_app', 'Notes', {
      observeApp: async () => states.shift()!,
      launchApp: async (appName) => {
        launches += 1;
        return activationDispatch(appName);
      },
      focusApp: async () => ({ ok: false, errorCode: 'unexpected_focus' }),
      now: fixedClock(),
    });
    check(result.ok === false, 'launch fails closed when after-state is not running');
    check(result.data?.completionVerified === false, 'failed verification cannot claim completion');
    check(launches === 1, 'verification failure does not blindly replay the launch');
    check(result.data?.proof?.dispatchAcknowledged === true, 'failure proof preserves the dispatch acknowledgement');
    check(result.data?.proof?.mutationPerformed === false, 'dispatch acknowledgement alone does not claim a performed mutation');
    check(result.data?.proof?.outcomeUnknown === true, 'acknowledged but unverified launch is explicitly outcome-unknown');
    check(result.data?.proof?.outcomeUnknownPolicy === 'verify_before_retry' && result.data?.proof?.replayAllowed === false, 'outcome-unknown proof forbids blind replay');
    check(result.data?.proof?.after?.appRunning === false, 'failure proof preserves the bounded mismatched after-state');
  }

  {
    let observations = 0;
    let focuses = 0;
    const result = await activate('focus_app', 'Notes', {
      observeApp: async () => {
        observations += 1;
        return observations === 1
          ? appObservation({ appRunning: true, frontmost: false })
          : {
              ok: false,
              error: 'timed out token=observation-secret /Users/example/private.txt',
              errorCode: 'timeout',
            };
      },
      launchApp: async () => ({ ok: false, errorCode: 'unexpected_launch' }),
      focusApp: async (appName) => {
        focuses += 1;
        return activationDispatch(appName);
      },
      now: fixedClock(),
    });
    check(result.ok === false, 'focus fails closed when the post-action observation is unavailable');
    check(result.data?.completionVerified === false, 'missing after-state cannot claim completion');
    check(result.data?.proof?.after === null, 'missing after-state is explicit in bounded proof');
    check(result.data?.proof?.mutationPerformed === false, 'missing proof does not promote an acknowledged focus to performed');
    check(result.data?.proof?.outcomeUnknown === true && result.data?.proof?.replayAllowed === false, 'missing verification explicitly blocks blind replay');
    check(focuses === 1 && observations === 2, 'missing verification does not trigger a blind replay');
    const serialized = JSON.stringify(result);
    check(!serialized.includes('observation-secret'), 'post-action observation failure redacts provider details');
    check(!serialized.includes('/Users/example/private.txt'), 'post-action observation failure redacts local paths');
  }

  {
    let mutations = 0;
    const result = await activate('focus_app', 'Notes', {
      observeApp: async () => appObservation({
        app: 'Calculator',
        appRunning: true,
        frontmost: true,
      }),
      launchApp: async () => {
        mutations += 1;
        return activationDispatch('Notes');
      },
      focusApp: async () => {
        mutations += 1;
        return activationDispatch('Notes');
      },
      now: fixedClock(),
    });
    check(result.ok === false, 'mismatched pre-action app identity is rejected');
    check(mutations === 0, 'mismatched pre-action app identity blocks mutation');
    check(result.data?.errorCode === 'uncertain_ui_target', 'identity mismatch reports a typed safe blocker');
  }

  {
    let focuses = 0;
    let observations = 0;
    const result = await activate('focus_app', 'Notes', {
      observeApp: async () => {
        observations += 1;
        return appObservation({ appRunning: false, frontmost: false, windowCount: 0 });
      },
      launchApp: async () => ({ ok: false, errorCode: 'unexpected_launch' }),
      focusApp: async () => {
        focuses += 1;
        return activationDispatch('Notes');
      },
      now: fixedClock(),
    });
    check(result.ok === false, 'focus refuses to turn into an implicit launch');
    check(focuses === 0 && observations === 1, 'non-running focus stops after its fresh pre-observation');
    check(result.data?.errorCode === 'app_not_running', 'non-running focus reports the exact blocker');
    check(result.data?.proof?.mutationAttempted === false, 'non-running focus records that no mutation was attempted');
    check(result.data?.proof?.outcomeUnknown === false, 'a pre-dispatch focus refusal has a known outcome');
  }

  {
    let launches = 0;
    const states = [
      appObservation({ appRunning: false, frontmost: false, windowCount: 0 }),
      appObservation({ appRunning: true, frontmost: false, windowCount: 1 }),
    ];
    const result = await activate('launch_app', 'Notes', {
      observeApp: async () => states.shift()!,
      launchApp: async () => {
        launches += 1;
        return {
          ok: true,
          data: {
            appName: 'Calculator',
            requestedAppName: 'Calculator',
            resolvedAppName: 'Calculator',
          },
        };
      },
      focusApp: async () => ({ ok: false, errorCode: 'unexpected_focus' }),
      now: fixedClock(),
    });
    check(result.ok === false, 'dispatch identity swaps are rejected even when the requested app later appears');
    check(launches === 1, 'an identity-swapped launch is never replayed');
    check(result.data?.errorCode === 'uncertain_ui_target', 'dispatch identity swap reports a typed target blocker');
    check(result.data?.proof?.dispatchTargetMatched === false, 'proof records the dispatch identity mismatch');
    check(result.data?.proof?.outcomeUnknown === true && result.data?.proof?.replayAllowed === false, 'identity-swapped dispatch is outcome-unknown and non-replayable');
  }

  {
    let launches = 0;
    const states = [
      appObservation({ appRunning: false, frontmost: false, windowCount: 0 }),
      appObservation({ appRunning: true, frontmost: false, windowCount: 1 }),
    ];
    const result = await activate('launch_app', 'Notes', {
      observeApp: async () => states.shift()!,
      launchApp: async () => {
        launches += 1;
        return { ok: true, data: { appName: 'Notes' } };
      },
      focusApp: async () => ({ ok: false, errorCode: 'unexpected_focus' }),
      now: fixedClock(),
    });
    check(result.ok === false, 'a bridge acknowledgement without all resolved identity echoes cannot prove completion');
    check(launches === 1, 'incomplete dispatch identity is never replayed');
    check(result.data?.proof?.dispatchTargetMatched === false, 'proof records incomplete dispatch identity as unmatched');
    check(result.data?.proof?.outcomeUnknown === true, 'incomplete dispatch identity after mutation is outcome-unknown');
  }

  {
    let mutations = 0;
    const result = await activate('launch_app', 'Code', {
      observeApp: async () => appObservation({
        app: 'Visual Studio Code',
        requestedAppName: 'Code',
        resolvedAppName: 'Visual Studio Code',
        appRunning: true,
        frontmost: false,
      }),
      launchApp: async () => {
        mutations += 1;
        return activationDispatch('Visual Studio Code');
      },
      focusApp: async () => {
        mutations += 1;
        return activationDispatch('Visual Studio Code');
      },
      now: fixedClock(),
    });
    check(result.ok === false, 'ambiguous substring-like app aliases are not accepted');
    check(mutations === 0, 'ambiguous app identity fails before dispatch');
    check(result.data?.errorCode === 'uncertain_ui_target', 'ambiguous alias uses the safe target mismatch blocker');
  }

  {
    let focuses = 0;
    const states = [
      appObservation({ appRunning: true, frontmost: false, pid: 301 }),
      appObservation({ appRunning: true, frontmost: true, pid: 302 }),
    ];
    const result = await activate('focus_app', 'Notes', {
      observeApp: async () => states.shift()!,
      launchApp: async () => ({ ok: false, errorCode: 'unexpected_launch' }),
      focusApp: async (appName) => {
        focuses += 1;
        return {
          ok: true,
          data: { appName, requestedAppName: appName, resolvedAppName: appName },
        };
      },
      now: fixedClock(),
    });
    check(result.ok === false, 'a process-id swap between native observations fails closed');
    check(focuses === 1, 'pid swap does not replay the focus mutation');
    check(result.data?.proof?.after?.targetMatched === false, 'pid mismatch is explicit in bounded after-state proof');
    check(result.data?.proof?.outcomeUnknown === true, 'pid swap after an attempted mutation is outcome-unknown');
  }

  {
    const states = [
      appObservation({ appRunning: false, frontmost: false, windowCount: 0 }),
      appObservation({ appRunning: true, frontmost: false, windowCount: 1 }),
    ];
    const result = await activate('launch_app', 'Notes', {
      observeApp: async () => states.shift()!,
      launchApp: async () => ({
        ok: false,
        error: 'transport reset token=dispatch-secret /Users/example/.ssh/id_rsa',
        errorCode: 'connection_failed',
      }),
      focusApp: async () => ({ ok: false, errorCode: 'unexpected_focus' }),
      now: fixedClock(),
    });
    check(result.ok === false, 'a failed dispatch acknowledgement cannot be promoted by after-state alone');
    check(result.data?.proof?.after?.appRunning === true, 'fresh after-state remains available for recovery reasoning');
    check(result.data?.proof?.outcomeUnknown === true, 'every attempted mutation without accepted completion is outcome-unknown');
    check(result.data?.proof?.replayAllowed === false, 'transport-uncertain launch cannot be blindly replayed');
    const serialized = JSON.stringify(result);
    check(!serialized.includes('dispatch-secret'), 'activation dispatch failure redacts provider details');
    check(!serialized.includes('/Users/example/.ssh/id_rsa'), 'activation dispatch failure redacts local paths');
    check(result.data?.errorCode === 'connection_failed', 'activation dispatch failure preserves a bounded recovery code');
  }

  {
    const repoRoot = path.resolve(__dirname, '..');
    const bridgeSource = fs.readFileSync(path.join(repoRoot, 'scripts/claude-bridge.js'), 'utf8');
    const runtimeSource = fs.readFileSync(path.join(repoRoot, 'src/lib/openswanToolRuntime.ts'), 'utf8');
    const swanbotSource = fs.readFileSync(path.join(repoRoot, 'src/lib/swanbot.ts'), 'utf8');
    const dispatcherSource = fs.readFileSync(path.join(repoRoot, 'src/lib/swanbotClientToolDispatcher.ts'), 'utf8');
    check(!bridgeSource.includes('name contains targetName'), 'native observation has no fuzzy process substring fallback');
    check(bridgeSource.includes('unix id of targetProc'), 'native observation binds the process id');
    check(runtimeSource.includes('executeObservedNativeAppActivation'), 'OpenSwan reuses the canonical proof-bearing native executor');
    check(runtimeSource.includes("if (tool === 'desktop.launch_app' || tool === 'desktop.focus_app')") && runtimeSource.includes("approvalMode: 'auto'"), 'reversible app launch/focus does not create a redundant approval prompt');
    check(runtimeSource.includes('hasAuthenticatedPersistedOpenSwanCallIdentity(tool, context)'), 'OpenSwan lifecycle action still requires authenticated persisted exact-call identity');
    check(swanbotSource.includes("case 'desktop.launch_app':") && swanbotSource.includes("case 'desktop.focus_app':"), 'SwanBot routes launch and focus through its runtime gateway switch');
    check(swanbotSource.includes('receipt_metadata: result.receipt_metadata'), 'SwanBot sends trusted receipts beside model-visible content');
    check(dispatcherSource.includes('must run through the authenticated typed runtime and fresh native-app proof gateway'), 'legacy SwanBot native dispatch fails closed');
  }

  console.log(`computer-app-launch-focus-proof smoke: ${assertions} assertions passed`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
