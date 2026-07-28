import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildDirectImageConversionRuntimeHandoff,
  DIRECT_IMAGE_CONVERSION_REQUIRED_CONTEXT,
  executeDirectImageConversionRequest,
} from '../src/lib/directImageConversionRuntime';

async function main() {
  let convertCalls = 0;
  let statCalls = 0;
  let searchCalls = 0;
  const privateSource = 'UC_PRIVATE_IMAGE_9217.png';
  const privatePath = `/Users/private/Desktop/${privateSource}`;

  const outcome = await executeDirectImageConversionRequest(
    `open "${privatePath}" and convert it to jpeg`,
    {
      async convertImage() {
        convertCalls += 1;
        throw new Error('direct conversion must never execute');
      },
      async statFile() {
        statCalls += 1;
        throw new Error('direct preflight stat must never execute');
      },
      async searchFiles() {
        searchCalls += 1;
        throw new Error('direct preflight search must never execute');
      },
    },
  );

  assert.equal(outcome.handled, true, 'bounded conversion is consumed by the handoff');
  assert.equal(outcome.status, 'handoff', 'conversion never claims completion');
  assert.match(outcome.message, /not executed directly|authenticated OpenSwan typed runtime/i);
  assert.equal(convertCalls, 0, 'convertImage is never called');
  assert.equal(statCalls, 0, 'stat preflight is never called');
  assert.equal(searchCalls, 0, 'search preflight is never called');
  assert.equal('request' in (outcome.data || {}), false, 'parsed source and format are not returned');
  assert.equal('proof' in (outcome.data || {}), false, 'no conversion proof is fabricated');
  assert.equal('proofSignals' in (outcome.data || {}), false, 'no proof signal is fabricated');
  assert.equal('preflightSignals' in (outcome.data || {}), false, 'no direct preflight telemetry is fabricated');

  const handoff = outcome.data?.runtimeHandoff;
  assert(handoff, 'conversion returns a structured typed-runtime handoff');
  assert.deepEqual(handoff, buildDirectImageConversionRuntimeHandoff());
  assert.equal(handoff.kind, 'openswan_typed_tool');
  assert.equal(handoff.tool, 'desktop.convert_image');
  assert.equal(handoff.executable, false);
  assert.equal(handoff.bridgeCalled, false);
  assert.equal(handoff.mutationDispatched, false);
  assert.equal(handoff.completionClaimed, false);
  for (const falseField of [
    'carriesRawPath',
    'carriesRawApp',
    'carriesRawValue',
    'carriesSecret',
    'carriesIdentity',
    'carriesApproval',
    'carriesReceipt',
    'carriesProof',
  ] as const) {
    assert.equal(handoff[falseField], false, `${falseField} remains false`);
  }
  assert.deepEqual(
    handoff.requiredContext,
    [...DIRECT_IMAGE_CONVERSION_REQUIRED_CONTEXT],
    'handoff lists the authenticated execution requirements',
  );

  const serialized = JSON.stringify(outcome);
  assert.equal(serialized.includes(privateSource), false, 'returned metadata omits the source basename');
  assert.equal(serialized.includes(privatePath), false, 'returned metadata omits the source path');
  assert.equal(serialized.includes('/Users/private'), false, 'returned metadata omits the local home path');

  let functionBridgeCalls = 0;
  const functionBridgeOutcome = await executeDirectImageConversionRequest(
    `convert ${privateSource} on my desktop to png`,
    async () => {
      functionBridgeCalls += 1;
      throw new Error('legacy function bridge must never execute');
    },
  );
  assert.equal(functionBridgeOutcome.status, 'handoff');
  assert.equal(functionBridgeCalls, 0, 'legacy function bridge is also inert');

  const unsupportedRenamedExport = await executeDirectImageConversionRequest(
    'open logo.png in Photoshop and rename it private-new-name.png and save it as a jpg',
    async () => {
      convertCalls += 1;
      throw new Error('unsupported renamed export must never execute');
    },
  );
  assert.equal(unsupportedRenamedExport.handled, false, 'unsupported renamed export falls through to the authenticated general agent route');
  assert.equal(unsupportedRenamedExport.data, undefined, 'unsupported task metadata contains no raw values');

  const notConversion = await executeDirectImageConversionRequest(
    'open Notes and create a note',
    async () => {
      convertCalls += 1;
      throw new Error('non-conversion must never execute');
    },
  );
  assert.equal(notConversion.handled, false);
  assert.equal(notConversion.status, 'failed');
  assert.equal(notConversion.data, undefined);
  assert.equal(convertCalls, 0);

  const runtimeSource = readFileSync(
    new URL('../src/lib/directImageConversionRuntime.ts', import.meta.url),
    'utf8',
  );
  for (const forbiddenSource of [
    'await bridge.convertImage',
    'await bridge.statFile',
    'await bridge.searchFiles',
    "status: 'completed'",
    'proofSignals:',
    'preflightSignals:',
  ]) {
    assert.equal(
      runtimeSource.includes(forbiddenSource),
      false,
      `runtime source omits direct-execution primitive ${forbiddenSource}`,
    );
  }
  assert.match(
    runtimeSource,
    /void bridge;[\s\S]*status: 'handoff'/,
    'legacy bridge injection seam is inert before the handoff returns',
  );

  console.log('All direct image conversion runtime smoke cases passed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
