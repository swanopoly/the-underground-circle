/**
 * Focused parity/adversarial smoke for the canonical approval-effect floor.
 *
 * Run: npx tsx scripts/approval-effect-policy-core-smoketest.ts
 */

import {
  APPROVAL_EFFECTS,
  ALWAYS_EXACT_APPROVAL_EFFECTS,
  CATEGORY_AUTO_ELIGIBLE_APPROVAL_EFFECTS,
  CHAT_COMPUTER_ALWAYS_EXACT_CATEGORIES,
  CHAT_COMPUTER_STICKY_GRANTABLE_CATEGORIES,
  APPROVAL_PROMPT_BUDGET_POLICY,
  classifyApprovalEffect,
  classifyAlwaysExactApprovalEffect,
  requiresExactApproval,
  isApprovalCategoryAutoEligible,
} from '../src/lib/approvalEffectPolicyCore';
import {
  ALWAYS_ASK_FLOOR_MARKERS,
  matchesAlwaysAskFloor,
  resolveApprovalDecision,
} from '../src/lib/unifiedApprovalPolicyCore';
import {
  ALWAYS_SEPARATE_FLOOR_MARKERS,
  planApprovalBatch,
} from '../src/lib/openswanApprovalBatchCore';
import {
  FLOOR_ACTION_CATEGORIES,
  checkToolPolicy,
} from '../src/lib/toolPolicyCore';
import {
  STICKY_FLOOR_CATEGORIES,
  STICKY_GRANTABLE_CATEGORIES,
  applyStickyScopes,
  createStickyScope,
  type StickyAllowScope,
} from '../src/lib/computerGrantGate';
import { readFileSync } from 'node:fs';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) passed += 1;
  else {
    failed += 1;
    console.error(`FAIL: ${label}`);
  }
}

function eq(actual: unknown, expected: unknown, label: string): void {
  assert(
    Object.is(actual, expected),
    `${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`,
  );
}

const expectedExactEffects = [
  'persistent_write',
  'credential',
  'login',
  'payment',
  'purchase',
  'checkout',
  'publish',
  'send',
  'post',
  'external_communication',
  'delete',
  'trash',
  'overwrite',
  'destructive',
  'permission',
  'security',
  'private_file',
  'ambiguous',
  'unknown',
] as const;

// Closed taxonomy: every effect is in exactly one policy side.
eq(new Set(APPROVAL_EFFECTS).size, APPROVAL_EFFECTS.length, 'taxonomy has no duplicate effects');
assert(Object.isFrozen(APPROVAL_EFFECTS), 'taxonomy array is runtime immutable');
assert(Object.isFrozen(ALWAYS_EXACT_APPROVAL_EFFECTS), 'exact-floor array is runtime immutable');
assert(Object.isFrozen(CATEGORY_AUTO_ELIGIBLE_APPROVAL_EFFECTS), 'auto-eligible array is runtime immutable');
eq(
  ALWAYS_EXACT_APPROVAL_EFFECTS.join(','),
  expectedExactEffects.join(','),
  'canonical exact-floor order and coverage are pinned',
);
for (const effect of APPROVAL_EFFECTS) {
  const exact = ALWAYS_EXACT_APPROVAL_EFFECTS.includes(effect as never);
  const eligible = CATEGORY_AUTO_ELIGIBLE_APPROVAL_EFFECTS.includes(effect as never);
  assert(exact !== eligible, `effect ${effect} belongs to exactly one policy side`);
}

// Required semantic aliases classify to an exact effect.
const exactAliases = [
  'credential', 'fill_credentials', 'login', 'payment', 'pay', 'purchase', 'checkout',
  'publish', 'send', 'post', 'external communication', 'submit', 'delete', 'trash',
  'overwrite', 'destructive', 'permission', 'grant_access', 'security', 'private-file',
  'read_private_file', 'upload_attachment', 'memory_write', 'ambiguous', 'unknown',
];
for (const alias of exactAliases) {
  assert(requiresExactApproval(alias), `${alias} requires exact approval`);
  assert(classifyAlwaysExactApprovalEffect(alias) !== null, `${alias} returns an exact boundary`);
  assert(!isApprovalCategoryAutoEligible(alias), `${alias} is not category-auto eligible`);
}

// Safe behavior stays explicit and narrow.
const safeCases: Array<[string, string]> = [
  ['memory_read', 'observe'],
  ['browser.dom_snapshot', 'observe'],
  ['desktop.launch_app', 'launch'],
  ['desktop.focus_app', 'focus'],
  ['desktop.set_element_value', 'reversible_non_secret'],
  ['browser.fill_field', 'reversible_non_secret'],
  ['browser.set_toggle', 'reversible_non_secret'],
  ['browser.select_option', 'reversible_non_secret'],
  ['desktop.send_keys', 'reversible_non_secret'],
];
for (const [signal, effect] of safeCases) {
  eq(classifyApprovalEffect(signal), effect, `${signal} classifies as ${effect}`);
  assert(!requiresExactApproval(signal), `${signal} does not require exact approval`);
  eq(classifyAlwaysExactApprovalEffect(signal), null, `${signal} is plan-coverable by effect policy`);
  assert(isApprovalCategoryAutoEligible(signal), `${signal} is category-auto eligible`);
}

// Exact signals dominate safe-looking companions; marker matching has no raw
// substring false positive for "pay" inside payload/display.
eq(classifyApprovalEffect(['memory_read', 'browser.fill_credential_field']), 'credential', 'credential beats read');
eq(classifyApprovalEffect(['external_publish', 'desktop.delete_file']), 'delete', 'destructive boundary wins mixed exact signals');
eq(classifyApprovalEffect(['desktop.send_keys', 'password']), 'credential', 'credential beats send_keys exception');
eq(classifyAlwaysExactApprovalEffect({ effect: 'reversible_non_secret', tool: 'desktop.click' }), null, 'trusted reversible manifest refines generic click');
eq(classifyAlwaysExactApprovalEffect({ effect: 'reversible_non_secret', tool: 'desktop.delete_file' }), 'delete', 'concrete delete beats trusted reversible label');
eq(classifyAlwaysExactApprovalEffect({ effect: 'reversible_non_secret', tool: 'browser.fill_credential_field' }), 'credential', 'concrete credential beats trusted reversible label');
eq(classifyAlwaysExactApprovalEffect({ effect: '', effectClass: 'credential' }), 'credential', 'blank primary effect cannot hide exact fallback class');
eq(classifyApprovalEffect('payload.read'), 'observe', 'payload is not misclassified as payment');
assert(classifyApprovalEffect('ui.display') !== 'payment', 'display is not misclassified as payment');
eq(classifyApprovalEffect('desktop.read_file'), 'private_file', 'private file beats read');

// Total/fail-closed behavior.
const cyclic: unknown[] = [];
cyclic.push(cyclic);
const throwingProxy = new Proxy({}, { get() { throw new Error('boom'); } });
const hostile: unknown[] = [null, undefined, 42, Symbol('x'), {}, [], new Set(), cyclic, throwingProxy];
for (const value of hostile) {
  eq(classifyApprovalEffect(value), 'unknown', 'hostile/empty value classifies unknown');
  eq(classifyAlwaysExactApprovalEffect(value), 'unknown', 'hostile/empty value returns unknown exact boundary');
  assert(requiresExactApproval(value), 'hostile/empty value requires exact approval');
  assert(!isApprovalCategoryAutoEligible(value), 'hostile/empty value cannot category-auto');
}

// All consumers share the exact same canonical array/reference.
assert(ALWAYS_ASK_FLOOR_MARKERS === ALWAYS_EXACT_APPROVAL_EFFECTS, 'unified policy imports canonical floor');
assert(ALWAYS_SEPARATE_FLOOR_MARKERS === ALWAYS_EXACT_APPROVAL_EFFECTS, 'batch policy imports canonical floor');
assert(FLOOR_ACTION_CATEGORIES === ALWAYS_EXACT_APPROVAL_EFFECTS, 'tool policy imports canonical floor');
eq(STICKY_FLOOR_CATEGORIES.join(','), CHAT_COMPUTER_ALWAYS_EXACT_CATEGORIES.join(','), 'sticky floor matches canonical projection');
eq(STICKY_GRANTABLE_CATEGORIES.join(','), CHAT_COMPUTER_STICKY_GRANTABLE_CATEGORIES.join(','), 'sticky grantable projection matches canonical core');

// Broad category preferences cannot waive the exact floor.
eq(
  resolveApprovalDecision({ category: 'memory_read', userAutoApprove: ['memory_read'] }).kind,
  'auto_approve',
  'safe read category preference remains honored',
);
for (const category of ['memory_write', 'skill_run', 'skill_write', 'automation_create', 'automation_run', 'browser_click', 'external_publish', 'desktop_action']) {
  eq(
    resolveApprovalDecision({ category, userAutoApprove: [category] }).kind,
    'require_approval',
    `${category} broad auto preference cannot waive exact/ambiguous effect`,
  );
  assert(!isApprovalCategoryAutoEligible(category), `${category} settings write is ineligible for auto`);
}
assert(isApprovalCategoryAutoEligible('memory_read'), 'memory_read remains eligible for category auto');
eq(matchesAlwaysAskFloor('browser_click'), true, 'ambiguous browser category suppresses standing auto');
eq(matchesAlwaysAskFloor('desktop.send_keys'), false, 'reversible send_keys does not trip communication floor');

// chatAutoApproveSettings imports Supabase/React Native and is deliberately not
// loaded in the Node smoke. Pin its canonical guard wiring without activating
// that environment-specific dependency graph.
const settingsSource = readFileSync(new URL('../src/lib/chatAutoApproveSettings.ts', import.meta.url), 'utf8');
assert(settingsSource.includes("import { isApprovalCategoryAutoEligible } from './approvalEffectPolicyCore';"), 'settings imports canonical eligibility classifier');
assert(settingsSource.includes("decision === 'auto' && !canAutoApproveCategory(category)"), 'settings writes reject ineligible category auto');
assert(settingsSource.includes('safeStoredDecision(category'), 'persisted settings are clamped through the canonical classifier');
const permissionsSource = readFileSync(new URL('../src/components/computer-use/ComputerUseConsole.tsx', import.meta.url), 'utf8');
assert(permissionsSource.includes('standingGrantCreationAvailable = STICKY_GRANTABLE_CATEGORIES.length > 0'), 'permissions UI derives grant creation availability from canonical categories');
assert(permissionsSource.includes('{standingGrantCreationAvailable ? ('), 'permissions UI hides the add form when no category is grantable');
assert(permissionsSource.includes('Broad standing grants are paused.'), 'permissions UI explains the retired broad-grant state');

// Per-tool policy: explicit observe remains auto; unknown and exact tags ask.
const autoPolicy = [{ toolId: 'tool', scope: '*', mode: 'auto' as const }];
eq(checkToolPolicy({ toolId: 'tool', scope: 'x', actionTags: ['read'], policies: autoPolicy, now: 1 }).decision, 'auto', 'tool read stays auto');
eq(checkToolPolicy({ toolId: 'tool', scope: 'x', actionTags: ['save'], policies: autoPolicy, now: 1 }).decision, 'ask', 'tool persistent save asks');
eq(checkToolPolicy({ toolId: 'tool', scope: 'x', policies: autoPolicy, now: 1 }).decision, 'ask', 'missing action tags fail exact');

// Approval batching keeps only explicit safe effects together.
const batch = planApprovalBatch([
  { tool: 'browser.dom_snapshot', category: 'observe', risk: 'low' },
  { tool: 'desktop.set_element_value', category: 'reversible_non_secret', risk: 'medium' },
  { tool: 'gdocs.append', category: 'write', risk: 'medium' },
  { tool: 'desktop.read_file', category: 'read', risk: 'low' },
  { tool: 'mystery', category: 'misc', risk: 'low' },
]);
eq(batch.batches.length, 5, 'mixed safe/exact queue keeps exact effects separate');
eq(batch.batches.filter((item) => item.requiresSeparate).length, 3, 'persistent/private/unknown each require separate consent');

// All currently persisted chat-computer mutation categories are exact; legacy
// or malicious sticky scopes cannot auto-approve them or generic work.
eq(STICKY_GRANTABLE_CATEGORIES.length, 0, 'no broad router mutation category is sticky-grantable');
for (const category of STICKY_FLOOR_CATEGORIES) {
  const created = createStickyScope({ scopeKind: 'site', scopeKey: 'example.com', allowedCategories: [category] });
  assert(!created.ok, `sticky scope rejects exact category ${category}`);
}
const maliciousScope: StickyAllowScope = {
  id: 'malicious',
  scopeKind: 'site',
  scopeKey: 'example.com',
  allowedCategories: [...STICKY_FLOOR_CATEGORIES],
  grantedByUserId: 'user',
  grantedAtIso: '2026-01-01T00:00:00.000Z',
  expiresAtIso: '2099-01-01T00:00:00.000Z',
  lastUsedAtIso: null,
  useCount: 0,
  revoked: null,
};
const sticky = applyStickyScopes(
  [maliciousScope],
  { hostname: 'example.com' },
  ['send', 'save', 'upload'],
  Date.parse('2026-01-02T00:00:00.000Z'),
);
eq(sticky.autoApproved.length, 0, 'malicious sticky scope approves no exact category');
eq(sticky.stillRequired.join(','), 'send,save,upload', 'all exact sticky categories remain required');
eq(sticky.usedScopeIds.length, 0, 'malicious sticky scope cannot cover a generic task');

// Descriptor is a future contract, not a runtime-activation claim.
eq(APPROVAL_PROMPT_BUDGET_POLICY.observe, 0, 'prompt budget: observe is zero');
eq(APPROVAL_PROMPT_BUDGET_POLICY.boundedReversibleWorkflow, 1, 'prompt budget: bounded reversible workflow is one');
eq(APPROVAL_PROMPT_BUDGET_POLICY.distinctExactHardBoundaryOutcome, 1, 'prompt budget: each exact outcome is one');
eq(APPROVAL_PROMPT_BUDGET_POLICY.runtimeIntegrated, false, 'prompt budget explicitly not runtime integrated');
assert(Object.isFrozen(APPROVAL_PROMPT_BUDGET_POLICY), 'prompt budget descriptor is frozen');

console.log(`approval-effect-policy-core smoke: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
