/**
 * openswan-runtime-approval-smoketest
 *
 * Locks approval matching for privileged OpenSwan runtime tools. A completed
 * approval must unblock the exact same tool+args call, while rejected or
 * unrelated approvals must fail closed or request a fresh approval.
 *
 * Run: npm run smoke:openswan-runtime-approval
 */

import { readFileSync } from 'node:fs';
import {
  buildOpenSwanToolApprovalKey,
  resolveOpenSwanRuntimeApprovalDecision,
  stableApprovalJson,
} from '../src/lib/openswanToolApprovals';
import {
  constraintBlocksToolCall,
  resolveChatComputerConstraintInputs,
} from '../src/lib/chatComputerRequestRouter';

let failures = 0;

function fail(message: string) {
  failures += 1;
  console.error('FAIL:', message);
}

function pass(message: string) {
  console.log('pass:', message);
}

function assert(condition: unknown, message: string, detail?: string) {
  if (condition) pass(message);
  else fail(`${message}${detail ? ` - ${detail}` : ''}`);
}

const tool = 'desktop.click_element';
const args = { appName: 'Safari', targetLabel: 'Send', meta: { retries: 1, safe: true } };
const reorderedArgs = { targetLabel: 'Send', meta: { safe: true, retries: 1 }, appName: 'Safari' };
const otherArgs = { appName: 'Safari', targetLabel: 'Delete', meta: { retries: 1, safe: true } };
const key = buildOpenSwanToolApprovalKey(tool, args);

assert(
  stableApprovalJson({ b: 2, a: { d: 4, c: 3 } }) === stableApprovalJson({ a: { c: 3, d: 4 }, b: 2 }),
  'stableApprovalJson sorts nested object keys',
);
assert(
  key === buildOpenSwanToolApprovalKey(tool, reorderedArgs),
  'tool approval key is stable across argument key order',
);

const pending = resolveOpenSwanRuntimeApprovalDecision({
  tool,
  args,
  rows: [{ id: 'p12345678', status: 'pending', payload: { toolApprovalKey: key } }],
});
assert(pending.kind === 'defer', 'pending exact approval defers execution');

const approved = resolveOpenSwanRuntimeApprovalDecision({
  tool,
  args,
  rows: [{ id: 'a12345678', status: 'approved', payload: { toolApprovalKey: key } }],
});
assert(approved.kind === 'pass', 'approved exact approval passes execution');

const autoApproved = resolveOpenSwanRuntimeApprovalDecision({
  tool,
  args,
  rows: [{ id: 'aa123456', status: 'auto_approved', payload: { toolApprovalKey: key } }],
});
assert(autoApproved.kind === 'pass', 'auto-approved exact approval passes execution');

const rejected = resolveOpenSwanRuntimeApprovalDecision({
  tool,
  args,
  rows: [{ id: 'r12345678', status: 'rejected', payload: { toolApprovalKey: key } }],
});
assert(rejected.kind === 'block', 'rejected exact approval blocks execution');

const expired = resolveOpenSwanRuntimeApprovalDecision({
  tool,
  args,
  rows: [{ id: 'e12345678', status: 'expired', payload: { toolApprovalKey: key } }],
});
assert(expired.kind === 'new', 'expired approval does not pass or block execution');

const legacyPending = resolveOpenSwanRuntimeApprovalDecision({
  tool,
  args,
  rows: [{ id: 'oldpending', status: 'pending', payload: {} }],
});
assert(legacyPending.kind === 'defer', 'legacy pending approval payload still defers duplicate requests');

const legacyApprovedWithoutPayload = resolveOpenSwanRuntimeApprovalDecision({
  tool,
  args,
  rows: [{ id: 'oldapproved', status: 'approved', payload: {} }],
});
assert(legacyApprovedWithoutPayload.kind === 'new', 'legacy approved payload without exact args does not pass execution');

const wrongToolArgs = resolveOpenSwanRuntimeApprovalDecision({
  tool,
  args,
  rows: [{ id: 'wrong', status: 'approved', payload: { toolApprovalKey: buildOpenSwanToolApprovalKey(tool, otherArgs) } }],
});
assert(wrongToolArgs.kind === 'new', 'approved approval for different args does not pass execution');

const legacyExact = resolveOpenSwanRuntimeApprovalDecision({
  tool,
  args,
  rows: [{ id: 'legacy-exact', status: 'approved', payload: { tool, args: reorderedArgs } }],
});
assert(legacyExact.kind === 'pass', 'legacy exact tool and args payload passes execution');

// Session-path constraint hydration: the typed-core session runtime must
// populate `context.userConstraints` from the SAME turn-message source the
// chat loop uses, and the runtime backstop must enforce it at dispatch.
// The enforcement itself is pure — exercise the exact hydrate → verdict pair.
const sessionConstraintInputs = resolveChatComputerConstraintInputs(
  'Update the draft but never send any emails while doing it.',
);
assert(
  sessionConstraintInputs.userConstraints !== null
    && sessionConstraintInputs.userConstraints.forbidden.includes('send'),
  'session turn message parses a forbidden send constraint',
);
const sessionConstraintVerdict = constraintBlocksToolCall(
  sessionConstraintInputs.userConstraints,
  'browser.click_element',
  { targetLabel: 'Send email' },
);
assert(sessionConstraintVerdict.blocked === true, 'hydrated session constraints block a send tool call');
const sessionNoConstraint = resolveChatComputerConstraintInputs('Summarize the latest standup notes.');
assert(
  constraintBlocksToolCall(sessionNoConstraint.userConstraints, 'browser.observe_page', {}).blocked === false,
  'constraint-free session turn does not block ordinary tool calls',
);

const sessionRuntimeSource = readFileSync('src/lib/openswanSessionRuntime.ts', 'utf8');
assert(
  sessionRuntimeSource.includes('userConstraints: resolveChatComputerConstraintInputs(args.userMessage).userConstraints'),
  'session runtime hydrates tool-context userConstraints from the turn message',
);

const runtimeSource = readFileSync('src/lib/openswanToolRuntime.ts', 'utf8');
assert(
  runtimeSource.includes('constraintBlocksToolCall(context.userConstraints ?? null, tool, args)'),
  'runtime dispatch backstop reads context.userConstraints for enforcement',
);
assert(runtimeSource.includes("if (tool.startsWith('wp.'))"), 'OpenSwan runtime has explicit wp.* policy branch');
assert(
  /const readOnly = tool === 'wp\.discover_types' \|\| tool === 'wp\.list_posts'/.test(runtimeSource),
  'wp.discover_types and wp.list_posts are the only read-only WP runtime tools',
);
assert(
  /approvalMode:\s*readOnly \? 'auto' : 'ask'/.test(runtimeSource),
  'mutating wp.* runtime tools require approval',
);
assert(
  /approvalKind:\s*readOnly \? undefined : 'publish'/.test(runtimeSource),
  'mutating wp.* runtime tools use publish approval kind',
);
assert(
  /externalSideEffect:\s*!readOnly/.test(runtimeSource),
  'mutating wp.* runtime tools are external side effects',
);

// Self-approval floor (audit 2026-07-10): the OpenSwan client runtime must not
// let a run approve ITS OWN gated action via approvals.resolve — that would
// waive the 'ask' floor (request approval → approvals.resolve('approved') →
// retry passes). Parity with swanbot-v2-ai, which disables model-side
// approvals.resolve entirely (see swanbot-v2-approvals-smoketest).
assert(
  runtimeSource.includes('a run cannot approve its own gated action'),
  'approvals.resolve blocks same-run self-approval (approval floor never waivable)',
);
assert(
  /status === 'approved' && context\.runId/.test(runtimeSource),
  "self-approval guard triggers on 'approved' resolutions with a run context",
);
assert(
  runtimeSource.includes('Could not verify approval'),
  'approvals.resolve fails closed when the approval row cannot be verified',
);

// Policy consistency (audit 2026-07-10): automations.list is a pure read and
// must stay in the read-only knowledge branch, not the mutating catch-all.
assert(
  runtimeSource.includes("tool === 'automations.list' ||"),
  'automations.list is classified in the read-only knowledge policy branch',
);

assert(runtimeSource.includes("name: 'browser.fill_credential_field'"), 'OpenSwan runtime catalogs browser.fill_credential_field');
assert(runtimeSource.includes("'browser.fill_credential_field': BrowserToolExecutionResult"), 'browser.fill_credential_field has a typed execution result');
assert(runtimeSource.includes("'browser.fill_credential_field': { reads: ['vault'], writes: ['browser_page'] }"), 'browser.fill_credential_field declares vault read + browser write dependencies');
assert(runtimeSource.includes("'browser.fill_credential_field': ['execute']"), 'browser.fill_credential_field is exposed only in execute mode');
assert(runtimeSource.includes("case 'browser.fill_credential_field':"), 'OpenSwan runtime executes browser.fill_credential_field');
assert(runtimeSource.includes('without returning raw secret values to the model'), 'browser.fill_credential_field policy names no raw secret return');

if (failures > 0) {
  console.error(`\n${failures} OpenSwan runtime approval smoke-test failure(s)`);
  process.exit(1);
}

console.log('\nAll OpenSwan runtime approval smoke cases passed.');
