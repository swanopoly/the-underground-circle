/**
 * Source-contract smoke for an Office agent that lacks an exact OpenSwan
 * connection/session binding. This script does not contact a provider or DB.
 *
 * Run: npx tsx scripts/office-openswan-binding-error-smoketest.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const invocationPath = fileURLToPath(
  new URL('../src/lib/agentInvocation.ts', import.meta.url),
);
const terminalPath = fileURLToPath(
  new URL('../src/components/OfficeTerminal.tsx', import.meta.url),
);

const invocationSource = readFileSync(invocationPath, 'utf8');
const terminalSource = readFileSync(terminalPath, 'utf8');

const BINDING_CODE = 'openswan_session_binding_required';
const BINDING_COPY = 'This Office agent is not linked to a live OpenSwan session. Choose a connected session, then send a new command. Nothing was dispatched.';
const GENERIC_PROVIDER_COPY = 'Agent invocation failed (provider_error).';

function sourceSection(
  source: string,
  startMarker: string,
  endMarker: string,
  label: string,
): string {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `${label}: start marker exists`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `${label}: end marker exists`);
  return source.slice(start, end);
}

function normalized(source: string): string {
  return source.replace(/\s+/g, ' ').trim();
}

const resultContract = sourceSection(
  invocationSource,
  'export interface AgentInvocationResult {',
  'function resolveInvocationDisposition(',
  'AgentInvocationResult contract',
);

const targetParser = sourceSection(
  invocationSource,
  'function parseExactOpenSwanSessionTarget(',
  '/**\n * Send one exact OpenSwan session turn',
  'exact OpenSwan target parser',
);

const openSwanAdapter = sourceSection(
  invocationSource,
  'export async function callOpenSwanAgent(',
  '// ─── Fallback: Estimate tokens',
  'OpenSwan adapter',
);

const bindingGate = sourceSection(
  openSwanAdapter,
  '  if (!target) {',
  '\n  try {',
  'unbound OpenSwan target gate',
);

const failureCopyConstants = sourceSection(
  invocationSource,
  "const OFFICE_PROVIDER_FAILURE =",
  'function getOfficeProviderFailureCopy(',
  'Office provider failure constants',
);

const failureCopyMapper = sourceSection(
  invocationSource,
  'function getOfficeProviderFailureCopy(',
  '// ─── Invoke & Stream: Main entry point',
  'Office provider failure copy mapper',
);

const invokeAndStream = sourceSection(
  invocationSource,
  'export async function invokeAndStream(',
  '// ─── Multi-Agent: Invoke all agents in parallel',
  'invokeAndStream',
);

const providerFailureBranch = sourceSection(
  invokeAndStream,
  '    if (!result.success) {',
  "\n    console.log('[agentInvocation] provider_completed');",
  'invokeAndStream provider failure branch',
);

const responseCard = sourceSection(
  terminalSource,
  'function ResponseCard(',
  'const cardStyles = StyleSheet.create({',
  'Office terminal response card',
);

// The only local failure code exposed by this result contract is allowlisted.
assert.match(
  resultContract,
  /failureCode\?:\s*'openswan_session_binding_required';/,
  'AgentInvocationResult allowlists the binding-required failure code',
);
assert.equal(
  (resultContract.match(/failureCode\?:/g) || []).length,
  1,
  'AgentInvocationResult has one explicit failure-code field',
);

// A normal DB UUID has no exact `connectionId::sessionKey` separator, so the
// parser returns null and the adapter takes the pre-dispatch binding gate.
const unboundDbUuid = '123e4567-e89b-12d3-a456-426614174000';
assert.equal(unboundDbUuid.includes('::'), false, 'fixture is an unbound DB UUID');
assert.match(
  targetParser,
  /const separator = agentId\.indexOf\('::'\);/,
  'exact target parsing requires the structured binding separator',
);
assert.match(
  targetParser,
  /if \(separator <= 0\) return null;/,
  'an identifier without a connection prefix fails exact target parsing',
);
assert.match(
  openSwanAdapter,
  /const target = parseExactOpenSwanSessionTarget\(agentId\);\s*if \(!target\) \{/,
  'the adapter gates an invalid or unbound identifier immediately after parsing',
);

assert.match(bindingGate, /success:\s*false,/);
assert.match(bindingGate, /disposition:\s*'failed',/);
assert.match(bindingGate, /completionVerified:\s*false,/);
assert.ok(
  bindingGate.includes(`failureCode: '${BINDING_CODE}'`),
  'the gate emits the allowlisted binding-required code',
);
assert.ok(
  bindingGate.includes(`error: '${BINDING_COPY}'`),
  'the gate emits the fixed nothing-dispatched copy',
);
assert.doesNotMatch(
  bindingGate,
  /sendSessionMessage\s*\(/,
  'the pre-dispatch failure branch cannot send to the provider',
);
assert.ok(
  openSwanAdapter.indexOf(bindingGate) < openSwanAdapter.indexOf('sendSessionMessage('),
  'the binding gate returns before the provider send site',
);
assert.equal(
  (openSwanAdapter.match(/sendSessionMessage\s*\(/g) || []).length,
  1,
  'the adapter has no alternate or replay send path',
);

assert.ok(
  failureCopyConstants.includes(`const OFFICE_PROVIDER_FAILURE = '${GENERIC_PROVIDER_COPY}'`),
  'generic provider failures retain fixed generic copy',
);
assert.ok(
  failureCopyConstants.includes(`const OFFICE_OPENSWAN_BINDING_REQUIRED = '${BINDING_COPY}'`),
  'the Office binding-required copy is fixed independently of provider prose',
);
assert.equal(
  normalized(failureCopyMapper),
  normalized(`
    function getOfficeProviderFailureCopy(result: AgentInvocationResult): string {
      return result.failureCode === '${BINDING_CODE}'
        ? OFFICE_OPENSWAN_BINDING_REQUIRED
        : OFFICE_PROVIDER_FAILURE;
    }
  `),
  'only the allowlisted binding code maps to specific copy; arbitrary provider errors stay generic',
);

assert.match(
  providerFailureBranch,
  /const providerFailureCopy = getOfficeProviderFailureCopy\(result\);/,
  'invokeAndStream uses the allowlisted failure-copy mapper',
);
assert.match(
  providerFailureBranch,
  /streamResponse\(\s*responseId,\s*providerFailureCopy,\s*'error',\s*\)/,
  'invokeAndStream persists the mapped copy on the error response',
);
assert.match(
  providerFailureBranch,
  /error:\s*providerFailureCopy,/,
  'invokeAndStream returns the same mapped copy to its caller',
);
assert.doesNotMatch(
  providerFailureBranch,
  /result\.(?:error|responseText)/,
  'invokeAndStream never surfaces arbitrary provider prose from this failure branch',
);

const terminalErrorFallback = "resp.errorMessage || resp.responseText || 'Unknown error'";
assert.ok(
  responseCard.includes(`{${terminalErrorFallback}}`),
  'OfficeTerminal error cards prefer errorMessage, then responseText, then Unknown error',
);
const errorMessageIndex = responseCard.indexOf('resp.errorMessage');
const responseTextIndex = responseCard.indexOf('resp.responseText', errorMessageIndex);
const unknownErrorIndex = responseCard.indexOf("'Unknown error'", responseTextIndex);
assert.ok(
  errorMessageIndex >= 0
    && responseTextIndex > errorMessageIndex
    && unknownErrorIndex > responseTextIndex,
  'OfficeTerminal preserves the required error fallback order',
);

console.log('office OpenSwan binding-error smoke passed');
