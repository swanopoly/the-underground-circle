/**
 * chat-conversational-cutover-parity-smoketest — guard (C1-G1) that the
 * conversational-intent cutover stays in lockstep across the planner union,
 * the executor case labels, and the ChatTab dispatch allowlist. Also documents
 * the build_webpage dead branch (C1-G2): present in the raw planner union but
 * absent from the executor — a future fix that wires it deliberately flips the
 * assertion. Reads three real files; edits none.
 *
 * Run: npm run smoke:chat-conversational-cutover-parity
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import {
  UNIFIED_CONVERSATIONAL_INTENT_TYPES,
  extractPlannerUnionRaw,
  extractPlannerActionable,
  extractExecutorCaseLabels,
  extractChatTabAllowlist,
} from '../src/lib/chatConversationalCutoverParity';

let failures = 0;
function fail(message: string): void {
  failures += 1;
  console.error('FAIL:', message);
}
function pass(message: string): void {
  console.log('pass:', message);
}
function assert(condition: unknown, message: string, detail?: string): void {
  if (condition) pass(message);
  else fail(`${message}${detail ? ` — ${detail}` : ''}`);
}

function sortedEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

function diff(a: string[], b: string[]): string {
  const sa = new Set(a);
  const sb = new Set(b);
  const onlyA = a.filter((v) => !sb.has(v));
  const onlyB = b.filter((v) => !sa.has(v));
  return `onlyLeft=[${onlyA.join(',')}] onlyRight=[${onlyB.join(',')}]`;
}

const root = process.cwd();
const plannerSrc = readFileSync(join(root, 'src/lib/chatAutomationPlanner.ts'), 'utf8');
const routerSrc = readFileSync(join(root, 'src/lib/conversationalRouter.ts'), 'utf8');
const chatTabSrc = readFileSync(join(root, 'src/screens/circles/tabs/ChatTab.tsx'), 'utf8');

const plannerRaw = extractPlannerUnionRaw(plannerSrc);
const plannerActionable = extractPlannerActionable(plannerSrc);
const executorCases = extractExecutorCaseLabels(routerSrc);
const chatTabAllowlist = extractChatTabAllowlist(chatTabSrc);
const canonical = [...UNIFIED_CONVERSATIONAL_INTENT_TYPES];

console.log(`info: plannerActionable=${plannerActionable.length} executorCases=${executorCases.length} chatTabAllowlist=${chatTabAllowlist.length}`);

assert(plannerActionable.length === 9, 'planner actionable set has 9 members', plannerActionable.join(','));
assert(executorCases.length === 9, 'executor case set has 9 members', executorCases.join(','));
assert(chatTabAllowlist.length === 9, 'ChatTab allowlist has 9 members', chatTabAllowlist.join(','));

assert(sortedEqual(plannerActionable, executorCases), 'plannerActionable === executorCases', diff(plannerActionable, executorCases));
assert(sortedEqual(executorCases, chatTabAllowlist), 'executorCases === chatTabAllowlist', diff(executorCases, chatTabAllowlist));
assert(sortedEqual(chatTabAllowlist, canonical), 'chatTabAllowlist === canonical unified set', diff(chatTabAllowlist, canonical));

// C1-G2: build_webpage is a documented dead branch
assert(plannerRaw.includes('build_webpage'), 'build_webpage IS present in the raw planner union');
assert(!executorCases.includes('build_webpage'), 'build_webpage is NOT in the executor case set (documented dead branch C1-G2)');

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log('\nchat-conversational-cutover-parity-smoketest: all assertions passed.');
