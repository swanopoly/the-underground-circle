import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const hitlService = readFileSync(resolve(process.cwd(), 'src/services/hitlService.ts'), 'utf8');
const hitlBanner = readFileSync(resolve(process.cwd(), 'src/components/HitlApprovalBanner.tsx'), 'utf8');
const runService = readFileSync(resolve(process.cwd(), 'src/services/runApprovalsService.ts'), 'utf8');
const runBanner = readFileSync(resolve(process.cwd(), 'src/components/RunApprovalBanner.tsx'), 'utf8');
const officeTab = readFileSync(resolve(process.cwd(), 'src/screens/circles/tabs/OfficeTab.tsx'), 'utf8');

let assertions = 0;
function check(condition: unknown, message: string): void {
  assert.ok(condition, message);
  assertions += 1;
  console.log(`  ok  ${message}`);
}

function has(source: string, value: string, message: string): void {
  check(source.includes(value), message);
}

function ordered(source: string, first: string, second: string, message: string): void {
  const firstIndex = source.indexOf(first);
  const secondIndex = source.indexOf(second);
  check(firstIndex >= 0 && secondIndex > firstIndex, message);
}

function section(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0 && endIndex > startIndex, `missing source section ${start}`);
  return source.slice(startIndex, endIndex);
}

const hitlExactMutation = section(hitlService, 'export async function resolveApprovalExact', 'export async function getPendingApprovals');
const runExactMutation = section(runService, 'export async function resolveRunApprovalExact', '// ─── Realtime hook');

console.log('HITL exact authority');
has(hitlService, 'export interface AgentApprovalsExactAuthority', 'HITL exposes an exact authority contract');
for (const field of ['userId: string', 'circleId: string', 'accessToken: string', 'authorityGeneration: number']) {
  has(hitlService, field, `HITL authority includes ${field}`);
}
has(hitlService, 'safeGetUserForAccessToken(accessToken)', 'HITL verifies the captured bearer subject');
has(hitlService, ".eq('circle_id', circleId)", 'HITL mutation binds the captured circle');
has(hitlService, ".eq('status', 'pending')", 'HITL mutation is pending-only');
has(hitlService, ".setHeader('Authorization', `Bearer ${accessToken}`)", 'HITL mutation and read carry captured Authorization');
has(hitlService, "row.resolved_by !== userId", 'HITL validates the resolver receipt');
has(hitlService, "`${authority.userId}\\u0000${authority.circleId}\\u0000${authority.accessToken}\\u0000${authority.authorityGeneration}`", 'HITL hook lifecycle keys every exact authority field');
ordered(hitlExactMutation, 'safeGetUserForAccessToken(accessToken)', ".from('agent_approvals')", 'HITL verifies the bearer before its exact table mutation');

console.log('Run approval exact authority');
has(runService, 'export async function getPendingRunApprovalsExact', 'run approvals expose an exact pending read');
has(runService, 'export async function getApprovedUnconsumedRunApprovalsExact', 'run approvals expose an exact recovery read');
has(runService, 'verifyRunApprovalReadAuthority(authority, isCurrent)', 'both exact read paths verify captured authority');
has(runService, "query = query.setHeader('Authorization', `Bearer ${scope.accessToken}`)", 'paged exact reads carry captured Authorization');
has(runService, '!isRunApprovalReadCurrent(scope)', 'paged reads fence late results');
has(runService, 'export async function resolveRunApprovalExact', 'run approvals expose an exact decision mutation');
has(runService, ".eq('requested_by', userId)", 'run approval mutation binds the requester');
has(runService, "row?.resolved_by !== userId", 'run approval mutation validates the resolver receipt');
ordered(runExactMutation, 'safeGetUserForAccessToken(accessToken)', ".from('agent_run_approvals')", 'run approval mutation verifies bearer before update');
has(runService, 'getPendingRunApprovalsExact(capturedAuthority, authorityIsCurrent)', 'realtime refresh uses the exact pending reader');
has(runService, 'getApprovedUnconsumedRunApprovalsExact(capturedAuthority, authorityIsCurrent)', 'realtime recovery refresh uses the exact reader');
has(runService, 'if (capturedAuthority && !authorityIsCurrent()) return;', 'hook withholds retired read results');

console.log('Exact Office component wiring');
has(runBanner, 'exactAuthority,\n    isExactAuthorityCurrent,', 'run banner passes exact authority into its read hook');
has(runBanner, 'allowRemember={!exactAuthority}', 'run banner disables standing grants in exact Office mode');
has(hitlBanner, 'if (!capturedAuthority && status === \'approved\' && !isRuntimeOwnedApproval(approval))', 'exact HITL decisions never invoke the generic side-effect worker');
has(hitlBanner, 'if (!capturedAuthority && status === \'approved\' && rememberPerApproval[approvalId])', 'exact HITL decisions never persist standing grants');
has(hitlBanner, 'let exactRejectConfirmed = !exactAuthority;', 'edit and resend tracks exact rejection custody');
ordered(hitlBanner, 'if (!exactRejectConfirmed) return;', 'onEditAndResend(ap, commandText);', 'retired exact edit approval cannot dispatch a replacement command');
has(officeTab, 'circleId: authority.circleId', 'Office approval snapshot includes the active circle');
check((officeTab.match(/exactAuthority=\{approvalsAuthority\}/g) || []).length >= 2, 'Office passes exact authority to both approval surfaces');
check((officeTab.match(/isExactAuthorityCurrent=\{isApprovalAuthorityCurrent\}/g) || []).length >= 2, 'Office passes the lifecycle fence to both approval surfaces');
has(officeTab, 'isRuntimeOwnedAgentApprovalActionType(approval.action_type)', 'Office HITL surface excludes compatibility worker approvals');

console.log(`office approval exact-authority smoke passed (${assertions} assertions)`);
