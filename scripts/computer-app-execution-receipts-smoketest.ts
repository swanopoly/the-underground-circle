/**
 * computer-app-execution-receipts-smoketest — verifies desktop/browser
 * execution receipts are generated and audited before agents manipulate
 * user apps.
 *
 * Run: npm run smoke:computer-app-execution-receipts
 */

import {
  auditComputerAppExecutionReceipts,
  buildComputerAppExecutionReceiptPlan,
  buildComputerAppExecutionReceiptPromptBlock,
  type ComputerAppExecutionReceipt,
} from '../src/lib/computerAppExecutionReceipts';
import { buildOpenSwanTaskPlan } from '../src/lib/openswanTaskPlanner';

let failures = 0;
function fail(message: string) { failures += 1; console.error('FAIL:', message); }
function pass(message: string) { console.log('pass:', message); }

function assert(condition: unknown, message: string, detail?: string) {
  if (condition) pass(message);
  else fail(`${message}${detail ? ` - ${detail}` : ''}`);
}

function assertReceiptPlan(input: string, strategyId: string, requiredText: string[]) {
  const plan = buildComputerAppExecutionReceiptPlan(input);
  assert(plan?.strategy.id === strategyId, `${input} receipt strategy is ${strategyId}`, plan?.strategy.id);
  const block = buildComputerAppExecutionReceiptPromptBlock(input) || '';
  for (const text of requiredText) {
    assert(block.includes(text), `${input} prompt includes ${text}`);
  }
}

assertReceiptPlan('Summarize unread emails and prioritize Slack alerts', 'productivity_app_control', [
  'Required receipt fields:',
  'beforeObservation for actions',
  'After each action, capture an afterObservation',
]);

assertReceiptPlan('Book a flight to New York next Friday under $500', 'approval_sensitive_browser', [
  'Approval checkpoints',
  'checkout/payment/subscription',
  'Do not claim completion without',
]);

assertReceiptPlan('Check AWS logs and rollback the failed deploy after approval', 'ops_console_control', [
  'read logs and status',
  'deploy/rollback/restart',
]);

const blindReceipts: ComputerAppExecutionReceipt[] = [
  {
    id: 'act-1',
    phase: 'act',
    surface: 'desktop',
    tool: 'desktop.click_at',
    action: 'click at 400,500',
    status: 'success',
  },
];
const blindAudit = auditComputerAppExecutionReceipts(blindReceipts, buildComputerAppExecutionReceiptPlan('Open Photoshop and crop this image')?.strategy);
assert(blindAudit.ok === false, 'blind coordinate action is blocked', blindAudit.summary);
assert(blindAudit.findings.some((finding) => /Blind action budget/i.test(finding.label)), 'blind action finding is explicit');

const repeatedFailureReceipts: ComputerAppExecutionReceipt[] = [
  {
    id: 'act-1',
    phase: 'act',
    surface: 'browser',
    tool: 'browser.click_role',
    action: 'click Submit',
    beforeObservation: 'Submit button visible',
    status: 'failed',
    stopReason: 'selector timed out',
  },
  {
    id: 'act-2',
    phase: 'act',
    surface: 'browser',
    tool: 'browser.click_role',
    action: 'click Submit',
    beforeObservation: 'Submit button visible',
    status: 'failed',
    stopReason: 'selector timed out',
  },
];
const repeatedAudit = auditComputerAppExecutionReceipts(repeatedFailureReceipts);
assert(repeatedAudit.ok === false, 'repeated action failure is blocked', repeatedAudit.summary);
assert(repeatedAudit.findings.some((finding) => /Repeated action failure/i.test(finding.label)), 'repeated failure finding is explicit');

const safeReceipts: ComputerAppExecutionReceipt[] = [
  {
    id: 'observe-1',
    phase: 'observe',
    surface: 'browser',
    tool: 'browser.dom_snapshot',
    action: 'inspect current page',
    result: 'Form visible',
    status: 'success',
  },
  {
    id: 'act-1',
    phase: 'act',
    surface: 'browser',
    tool: 'browser.fill_field',
    action: 'fill email',
    beforeObservation: 'Email field focused',
    result: 'email entered',
    afterObservation: 'Email value present',
    verification: 'DOM state confirms entered value',
    status: 'success',
  },
];
const safeAudit = auditComputerAppExecutionReceipts(safeReceipts);
assert(safeAudit.ok === true, 'safe observed action receipts pass audit', safeAudit.summary);

const openswanPlan = buildOpenSwanTaskPlan('Book a flight to New York next Friday under $500', 'senior' as any);
assert(openswanPlan.computerAppExecutionReceipts?.strategy.id === 'approval_sensitive_browser', 'OpenSwan task plan includes receipt strategy', openswanPlan.computerAppExecutionReceipts?.strategy.id);

if (failures > 0) {
  console.error(`\n${failures} computer/app execution receipt smoke failure(s)`);
  process.exit(1);
}

console.log('\nAll computer/app execution receipt smoke cases passed.');
