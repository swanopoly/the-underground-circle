/**
 * Focused integration smoke for OpenSwan's generic native UI mutation gate.
 *
 * Run:
 *   npx tsx scripts/openswan-generic-native-ui-runtime-smoketest.ts
 */

import { readFileSync } from 'node:fs';
import {
  buildComputerAppToolArgsFingerprintAsync,
  prepareGenericNativeUiMutationGuard,
  recheckGenericNativeUiMutationGuardAtHandlerEntry,
  type GenericNativeUiFrontmostObservation,
  type GenericNativeUiMutationObservationDeps,
} from '../src/lib/computerAppGrounding';

let failures = 0;
function assert(condition: unknown, message: string): void {
  if (condition) console.log(`pass: ${message}`);
  else {
    failures += 1;
    console.error(`FAIL: ${message}`);
  }
}

const runtimeSource = readFileSync('src/lib/openswanToolRuntime.ts', 'utf8');
const edgeSource = readFileSync('supabase/functions/swanbot-v2-ai/index.ts', 'utf8');
const groundingSource = readFileSync('src/lib/computerAppGrounding.ts', 'utf8');

const guardedTools = [
  'desktop.type_text',
  'desktop.paste_text',
  'desktop.press_keys',
  'desktop.menu_click',
  'desktop.click_at',
  'desktop.mouse_move',
  'desktop.mouse_click',
  'desktop.mouse_down',
  'desktop.mouse_up',
  'desktop.mouse_drag',
  'desktop.mouse_scroll',
  'desktop.set_element_value',
] as const;

function definitionSlice(
  source: string,
  tool: string,
  quote: "'" | '"',
): string {
  const marker = `name: ${quote}${tool}${quote}`;
  const start = source.indexOf(marker);
  if (start < 0) return '';
  const next = source.indexOf(`name: ${quote}`, start + marker.length);
  return source.slice(start, next < 0 ? source.length : next);
}

for (const tool of guardedTools) {
  const runtimeDefinition = definitionSlice(runtimeSource, tool, "'");
  const edgeDefinition = definitionSlice(edgeSource, tool, '"');
  assert(
    runtimeDefinition.includes("appName: { type: 'string'")
      && /required:\s*\[[^\]]*'appName'/.test(runtimeDefinition),
    `${tool} requires exact appName in the OpenSwan catalog`,
  );
  assert(
    edgeDefinition.includes('appName: { type: "string"')
      && /required:\s*\[[^\]]*"appName"/.test(edgeDefinition),
    `${tool} requires exact appName in the SwanBot v2 edge catalog`,
  );
}

assert(
  runtimeSource.includes('const GENERIC_NATIVE_UI_MUTATION_TOOLS')
    && runtimeSource.includes("genericNativeUiMutationFamilyForTool(tool)")
    && !definitionSlice(runtimeSource, 'desktop.click_element', "'")
      .includes('generic native UI observation'),
  'click_element remains on its specialized sealed semantic path',
);

const prepareIndex = runtimeSource.indexOf(
  'prepareGuardedGenericNativeUiMutation(',
  runtimeSource.indexOf('export async function executeOpenSwanRuntimeTool'),
);
const approvalIndex = runtimeSource.indexOf(
  'maybeRequestToolApproval(tool, approvalArgs, context)',
  prepareIndex,
);
const recheckIndex = runtimeSource.indexOf(
  'recheckGenericNativeUiMutationGuardAtHandlerEntry({',
);
const durableIndex = runtimeSource.indexOf(
  'dispatchDurableComputerAppMutation({',
  recheckIndex,
);
assert(
  prepareIndex >= 0
    && approvalIndex > prepareIndex
    && recheckIndex > 0
    && durableIndex > recheckIndex,
  'fresh observation precedes approval and one-shot recheck precedes durable dispatch',
);
assert(
  runtimeSource.includes('approvalBindingSha256: preparedGuard.guard.approvalBindingSha256')
    && runtimeSource.includes('buildOpenSwanToolApprovalKey(\n    prepared.tool,\n    prepared.approvalArgs,'),
  'exact approval args include and later verify the observation/argument approval binding',
);
assert(
  runtimeSource.includes('desktop.window_state or desktop.observe_app is required')
    && runtimeSource.includes('do not infer app identity from task text'),
  'missing app identity fails closed with an observation-first recovery',
);
assert(
  runtimeSource.includes('genericNativeUiCoordinatesFitScreen(')
    && runtimeSource.includes('await desktopBridge.getScreenSize()')
    && runtimeSource.includes('Number(data.windowCount || 0) <= 0'),
  'coordinate and mouse actions require both live screen bounds and a visible target-app window',
);
assert(
  runtimeSource.includes("if (tool === 'desktop.set_element_value')")
    && runtimeSource.includes('cannot yet seal a fresh exact accessibility target generation and dotted-path identity'),
  'set_element_value fails closed before approval until exact accessibility-target sealing is available',
);
const acknowledgedDispatchSection = runtimeSource.slice(
  runtimeSource.indexOf('// These legacy bridge endpoints acknowledge dispatch'),
  runtimeSource.indexOf('export async function executeOpenSwanRuntimeTool'),
);
assert(
  acknowledgedDispatchSection.includes('ok: false')
    && acknowledgedDispatchSection.includes('completionVerified: false')
    && acknowledgedDispatchSection.includes('outcomeUnknown: true'),
  'bridge acknowledgement without after-state proof is explicitly incomplete and outcome-unknown',
);
assert(
  guardedTools.every((tool) => runtimeSource.includes(
    tool === 'desktop.click_at'
      ? 'desktop.click_at is sealed behind the generic native UI observation'
      : tool === 'desktop.set_element_value'
        ? 'desktop.set_element_value is sealed behind the generic native UI observation'
        : tool.startsWith('desktop.mouse_')
          ? `${tool}'`
          : `${tool}'`,
  )),
  'all guarded generic tools remain represented while raw dispatch is sealed',
);

const approvalBindingSection = groundingSource.slice(
  groundingSource.indexOf('const approvalBindingSha256 = await digestGenericNativeUiBinding'),
  groundingSource.indexOf('if (!approvalBindingSha256)', groundingSource.indexOf('const approvalBindingSha256')),
);
assert(
  approvalBindingSection.includes('processIdentitySha256')
    && approvalBindingSection.includes('surfaceIdentitySha256')
    && approvalBindingSection.includes('toolArgsFingerprint')
    && !approvalBindingSection.includes('observationBindingSha256'),
  'manual approval binding is stable across timestamps but changes with args/process/surface',
);

async function runAdversarialBehavior(): Promise<void> {
  const appName = 'Notes';
  const baseMs = Date.parse('2026-07-27T18:00:00.000Z');
  const fingerprint = await buildComputerAppToolArgsFingerprintAsync({
    appName,
    text: 'private draft',
  });
  const observation = (
    pid = 4100,
    windowTitle = 'Draft',
  ): GenericNativeUiFrontmostObservation => ({
    requestedAppName: appName,
    resolvedAppName: appName,
    app: appName,
    pid,
    processIdentityVersion: 1,
    appRunning: true,
    frontmost: true,
    frontmostApp: appName,
    windowCount: 1,
    windowTitles: [windowTitle],
  });
  let now = baseMs;
  let calls = 0;
  let current = observation();
  const deps: GenericNativeUiMutationObservationDeps = {
    now: () => now,
    digest: buildComputerAppToolArgsFingerprintAsync,
    observeFrontmostApp: async () => {
      calls += 1;
      return { ok: true, data: current };
    },
  };

  const missing = await prepareGenericNativeUiMutationGuard({
    tool: 'desktop.type_text',
    expectedResolvedAppName: '',
    toolArgsFingerprint: fingerprint,
    deps,
  });
  assert(
    !missing.ok && missing.errorCode === 'invalid_target_identity' && calls === 0,
    'missing app identity blocks before observation or handler entry',
  );

  const prepared = await prepareGenericNativeUiMutationGuard({
    tool: 'desktop.type_text',
    expectedResolvedAppName: appName,
    toolArgsFingerprint: fingerprint,
    deps,
  });
  assert(prepared.ok, 'adversarial fixture prepares a genuine one-shot guard');
  if (!prepared.ok) return;

  let handlerEntries = 0;
  const enter = async (
    guard: typeof prepared.guard,
    binding: string,
  ) => {
    const checked = await recheckGenericNativeUiMutationGuardAtHandlerEntry({
      guard,
      approvalBindingSha256: binding,
      deps,
    });
    if (checked.ok) handlerEntries += 1;
    return checked;
  };

  const clone = { ...prepared.guard };
  const cloneResult = await enter(
    clone,
    clone.approvalBindingSha256,
  );
  assert(
    !cloneResult.ok
      && cloneResult.errorCode === 'guard_untrusted'
      && handlerEntries === 0,
    'cloned guard cannot enter the mutation handler',
  );

  current = observation(4101);
  now += 100;
  const pidDrift = await enter(
    prepared.guard,
    prepared.guard.approvalBindingSha256,
  );
  assert(
    !pidDrift.ok
      && pidDrift.errorCode === 'target_identity_drift'
      && handlerEntries === 0,
    'PID drift consumes the guard and never enters the mutation handler',
  );
  const pidReplay = await enter(
    prepared.guard,
    prepared.guard.approvalBindingSha256,
  );
  assert(
    !pidReplay.ok
      && pidReplay.errorCode === 'guard_consumed'
      && handlerEntries === 0,
    'failed PID-drift guard cannot be replayed into the handler',
  );

  current = observation();
  const windowPrepared = await prepareGenericNativeUiMutationGuard({
    tool: 'desktop.menu_click',
    expectedResolvedAppName: appName,
    toolArgsFingerprint: fingerprint,
    deps,
  });
  if (windowPrepared.ok) {
    current = observation(4100, 'Other window');
    now += 100;
    const windowDrift = await enter(
      windowPrepared.guard,
      windowPrepared.guard.approvalBindingSha256,
    );
    assert(
      !windowDrift.ok
        && windowDrift.errorCode === 'target_identity_drift'
        && handlerEntries === 0,
      'window drift never enters the mutation handler',
    );
  } else {
    assert(false, 'window-drift fixture prepares a genuine guard');
  }
}

async function main(): Promise<void> {
  await runAdversarialBehavior();
  if (failures > 0) {
    console.error(`\n${failures} generic native UI runtime smoke failure(s)`);
    process.exit(1);
  }
  console.log('\nAll generic native UI runtime smoke cases passed.');
}

main().catch((error) => {
  console.error('FAIL: generic native UI runtime smoke crashed', error);
  process.exit(1);
});
