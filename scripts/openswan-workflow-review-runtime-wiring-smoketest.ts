/** Source-level wiring guard for the typed OpenSwan workflow-review lane. */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const toolSource = readFileSync(`${root}/src/lib/openswanToolRuntime.ts`, 'utf8');
const sessionSource = readFileSync(`${root}/src/lib/openswanSessionRuntime.ts`, 'utf8');
const mcpSource = readFileSync(`${root}/src/lib/mcpToolBridge.ts`, 'utf8');

assert.match(toolSource, /workflowReviewAuthority\?: OpenSwanWorkflowReviewAuthorityV1 \| null/);
assert.match(toolSource, /context\.surface !== 'main_chat'/);
assert.match(toolSource, /takeOpenSwanApprovalSourceCallOrdinal\(\{/);
assert.match(toolSource, /multiActionLedgerReference: context\.multiActionLedgerReference/);
assert.match(toolSource, /inspectOpenSwanWorkflowReviewActionV1\(authority, call\.identity\)/);
assert.match(toolSource, /consumeOpenSwanWorkflowReviewActionV1\(authority, \{/);
assert.match(toolSource, /targetBinding: approvalArgs/);
assert.match(toolSource, /preparedFloorVerdict\.floorConfirmRequired \|\| runtimeFloorVerdict\.floorConfirmRequired/);
assert.match(toolSource, /inspection\.coverage === 'final_confirmation'/);
assert.match(toolSource, /maybeAuthorizeToolWithWorkflowReview\([\s\S]*?desktop\.open_attachment/);
assert.equal(
  [...toolSource.matchAll(/maybeAuthorizeToolWithWorkflowReview\(/g)].length,
  6,
  'the helper plus all five canonical approval call sites use workflow authority',
);

assert.match(sessionSource, /workflowReviewAuthority\?: OpenSwanWorkflowReviewAuthorityV1 \| null/);
assert.match(sessionSource, /workflowReviewAuthority: opts\.workflowReviewAuthority/);
assert.match(sessionSource, /parallelToolConcurrency: args\.forceSequentialToolDispatch \|\| args\.workflowReviewAuthority \? 1 : 4/);
assert.match(sessionSource, /revokeOpenSwanWorkflowReviewAuthorityV1\(opts\.workflowReviewAuthority\)/);
assert.match(sessionSource, /requireDurableMutationAuthority: args\.surface === 'main_chat'/);

assert.match(mcpSource, /mcp_durable_mutation_authority_unavailable/);
assert.match(mcpSource, /It cannot inherit a compact semantic workflow review and was not executed/);

console.log('openswan workflow review runtime wiring smoke passed');
