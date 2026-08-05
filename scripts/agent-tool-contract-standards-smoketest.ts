/**
 * agent-tool-contract-standards-smoketest
 *
 * Verifies the reusable checklist and eval plan for OpenSwan, bridge, MCP, and
 * connected-agent tool contract work.
 *
 * Run: npm run smoke:agent-tool-contract-standards
 */

import {
  AGENT_TOOL_CONTRACT_EVAL_MATRIX,
  AGENT_TOOL_CONTRACT_REQUIRED_FIELDS,
  applyAgentToolContractChecklistToPrompt,
  buildAgentToolContractChecklist,
  buildAgentToolContractEvalPlan,
  buildAgentToolContractSmokeCommands,
  formatAgentToolContractReviewPromptBlock,
  formatAgentToolContractChecklistPromptBlock,
  hasAgentToolContractChecklistPromptBlock,
  inferAgentToolContractRiskTags,
  requiresAgentToolContractApproval,
  reviewAgentToolContractDraft,
} from '../src/lib/agentToolContractStandards';
import {
  buildRelevantAgentDevelopmentStandardsPromptBlock,
} from '../src/lib/agentDevelopmentStandards';

function assert(condition: unknown, label: string, detail?: string): void {
  if (!condition) {
    throw new Error(detail ? `${label}: ${detail}` : label);
  }
  console.log(`pass: ${label}`);
}

assert(AGENT_TOOL_CONTRACT_REQUIRED_FIELDS.length >= 10, 'contract field checklist has coverage');
assert(AGENT_TOOL_CONTRACT_EVAL_MATRIX.length >= 10, 'eval matrix has coverage');

const risks = inferAgentToolContractRiskTags(
  'add a desktop bridge tool that edits a Photoshop layer, exports a PNG, and redacts private file paths',
);
assert(risks.includes('write'), 'risk inference catches write');
assert(risks.includes('export'), 'risk inference catches export');
assert(risks.includes('privacy'), 'risk inference catches privacy');
assert(requiresAgentToolContractApproval(risks), 'write/export/privacy tool requires approval');

const readOnlyRisks = inferAgentToolContractRiskTags('observe public browser state and list visible controls');
assert(readOnlyRisks.includes('read'), 'read-only risk inference catches observe/list');
assert(!requiresAgentToolContractApproval(readOnlyRisks), 'read-only tool does not require approval by default');

const evalPlan = buildAgentToolContractEvalPlan('add MCP bridge tool with approval metadata and recovery evals');
const evalIds = evalPlan.map((item) => item.id);
assert(evalIds.includes('malformed_input'), 'eval plan includes malformed input');
assert(evalIds.includes('missing_permission'), 'eval plan includes missing permission');
assert(evalIds.includes('unsafe_or_destructive'), 'eval plan includes unsafe path for approval metadata task');
assert(evalIds.includes('retry_idempotency'), 'eval plan includes retry/idempotency for privileged task');

const commands = buildAgentToolContractSmokeCommands('add connected agent MCP bridge tool for browser automation');
assert(commands.includes('npm run smoke:agent-tool-contract-standards'), 'commands include self smoke');
assert(commands.includes('npm run smoke:custom-agent-bridge-dispatch'), 'commands include custom-agent bridge smoke');
assert(commands.includes('npm run smoke:browser-bridge'), 'commands include browser bridge smoke');

const checklist = buildAgentToolContractChecklist(
  'add an OpenSwan tool schema with approval metadata, recovery evals, and redaction',
  { toolName: 'desktop.observe_window', surface: 'desktop_bridge' },
);
assert(checklist.toolName === 'desktop.observe_window', 'checklist keeps tool name');
assert(checklist.surface === 'desktop_bridge', 'checklist keeps surface');
assert(checklist.approvalRequired, 'checklist marks privileged tool approval required');
assert(checklist.recoveryFields.includes('requiresFreshEvidence'), 'checklist includes fresh evidence recovery field');
assert(checklist.requiredFields.some((field) => field.id === 'output_shape'), 'checklist includes output shape field');

const block = formatAgentToolContractChecklistPromptBlock(
  'add a bridge tool that writes a local file and retries after recovery',
  { toolName: 'file.write_text', surface: 'desktop_bridge' },
);
assert(block.includes('=== AGENT TOOL CONTRACT CHECKLIST ==='), 'prompt block has marker');
assert(block.includes('Approval required: yes'), 'prompt block shows approval decision');
assert(block.includes('Required evals:'), 'prompt block includes evals');
assert(block.includes('npm run smoke:agent-tool-contract-standards'), 'prompt block includes self smoke');

const wrapped = applyAgentToolContractChecklistToPrompt('add an MCP tool schema with redaction');
assert(hasAgentToolContractChecklistPromptBlock(wrapped), 'wrapper appends tool contract checklist');
assert(applyAgentToolContractChecklistToPrompt(wrapped) === wrapped, 'wrapper is idempotent');

const standardsBlock = buildRelevantAgentDevelopmentStandardsPromptBlock(
  'add an OpenSwan tool schema with approval metadata and recovery evals',
);
assert(standardsBlock?.includes('Agent Tool Contracts And Evals Guide'), 'standards routing still selects tool contract guide');

const blockedReview = reviewAgentToolContractDraft(
  'add a desktop bridge tool that writes a local file and retries after recovery',
  {
    toolName: 'file.write_text',
    purpose: 'Write bounded UTF-8 text',
    inputs: ['path', 'content'],
    riskTags: ['write', 'privacy'],
    outputVariants: ['completed', 'failed'],
    evalIds: ['happy_path'],
  },
  { surface: 'desktop_bridge' },
);
assert(!blockedReview.ok && blockedReview.status === 'blocked', 'draft review blocks incomplete privileged tool');
assert(blockedReview.missingFieldIds.includes('approval_requirement'), 'draft review catches missing approval field');
assert(blockedReview.missingRecoveryFields.includes('requiresFreshEvidence'), 'draft review catches missing recovery field');
assert(blockedReview.missingEvalIds.includes('malformed_input'), 'draft review catches missing malformed-input eval');
assert(blockedReview.issues.some((issue) => issue.fieldId === 'approval_required'), 'draft review catches missing approval gate');

const completeDescription = 'add a desktop bridge tool that writes a local file and retries after recovery';
const completeChecklist = buildAgentToolContractChecklist(completeDescription, {
  toolName: 'file.write_text',
  surface: 'desktop_bridge',
});
const completeReview = reviewAgentToolContractDraft(
  completeDescription,
  {
    toolName: 'file.write_text',
    purpose: 'Write bounded UTF-8 text inside an approved local file scope.',
    inputs: ['path', 'content', 'encoding'],
    trustBoundary: ['user path', 'bridge response'],
    riskTags: ['write', 'privacy'],
    approvalRequired: true,
    idempotency: 'Stable approval id plus write checkpoint prevents duplicate writes.',
    observationRequirement: ['Resolve file path', 'Confirm approval grant', 'Read current hash before write'],
    outputVariants: ['completed', 'blocked', 'unsafe', 'failed'],
    evidence: ['before hash', 'after hash', 'write receipt'],
    redaction: ['private paths', 'file contents'],
    evalIds: completeChecklist.requiredEvals.map((item) => item.id),
    recoveryFields: completeChecklist.recoveryFields,
    smokeCommands: completeChecklist.recommendedSmokeCommands,
  },
  { surface: 'desktop_bridge' },
);
assert(completeReview.ok && completeReview.status === 'ready', 'draft review passes complete privileged tool');
assert(completeReview.score === 100, 'complete review has full score');

const reviewBlock = formatAgentToolContractReviewPromptBlock(blockedReview);
assert(reviewBlock.includes('=== AGENT TOOL CONTRACT REVIEW ==='), 'review prompt block has marker');
assert(reviewBlock.includes('Status: blocked'), 'review prompt block shows blocked status');
assert(reviewBlock.includes('Missing evals:'), 'review prompt block includes missing evals');

console.log('\nAll agent tool contract standards smoke cases passed.');
