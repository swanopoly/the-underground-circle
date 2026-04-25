// scripts/hybrid-runtime-smoketest.ts
//
// Pin the pure functions in computerHybridRuntime: token resolution
// and topological ordering. Adapter dispatch is exercised manually
// during live verification — node can't easily mock the React Native
// + Browserbase + MCP stack.
//
// Run: npm run smoke:hybrid-runtime

import { resolveStepTokens, orderHybridSteps } from '../src/lib/computerHybridRuntime';
import type { HybridStep } from '../src/lib/computerHybridTypes';

let failures = 0;
function fail(m: string) { failures += 1; console.error('FAIL:', m); }
function pass(m: string) { console.log('pass:', m); }
function assert(cond: unknown, name: string, detail?: string) {
  if (cond) pass(name); else fail(`${name}${detail ? ' — ' + detail : ''}`);
}

function eq(actual: unknown, expected: unknown): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function main() {
  // ─── resolveStepTokens ─────────────────────────────────────────
  const outputs = {
    step_1: { findings: ['a.pdf', 'b.pdf'], total: 2 },
    step_2: { url: 'https://stripe.com/dash', matches: [{ id: 'ch_1', amount: 4200 }] },
  };

  // No tokens → returns input unchanged.
  assert(
    resolveStepTokens('plain text', outputs) === 'plain text',
    'resolveStepTokens: no token passes through',
  );

  // Simple top-level access.
  assert(
    resolveStepTokens('{{step_1.output.total}}', outputs) === '2',
    'resolveStepTokens: scalar at top of output',
  );

  // Array element + nested.
  assert(
    resolveStepTokens('{{step_2.output.matches[0].id}}', outputs) === 'ch_1',
    'resolveStepTokens: array index + dot path',
  );

  // Inline embed.
  assert(
    resolveStepTokens('Use {{step_1.output.findings}} as input', outputs) ===
      'Use ["a.pdf","b.pdf"] as input',
    'resolveStepTokens: array gets JSON-serialized when embedded',
  );

  // Multiple tokens in one string.
  assert(
    resolveStepTokens('Total: {{step_1.output.total}} from {{step_2.output.url}}', outputs) ===
      'Total: 2 from https://stripe.com/dash',
    'resolveStepTokens: multiple tokens in one string',
  );

  // Missing step → empty string and warning (not throw).
  assert(
    resolveStepTokens('{{step_99.output.x}}', outputs) === '',
    'resolveStepTokens: missing step → empty (does not throw)',
  );

  // Missing path on existing step → empty.
  assert(
    resolveStepTokens('{{step_1.output.nope}}', outputs) === '',
    'resolveStepTokens: missing field → empty',
  );

  // ─── orderHybridSteps ──────────────────────────────────────────
  const stepsLinear: HybridStep[] = [
    { id: 'step_1', kind: 'file', task: '', rationale: '', needsApproval: false, dependsOn: [] },
    { id: 'step_2', kind: 'browser', task: '', rationale: '', needsApproval: false, dependsOn: ['step_1'] },
    { id: 'step_3', kind: 'browser', task: '', rationale: '', needsApproval: false, dependsOn: ['step_2'] },
  ];
  assert(
    eq(orderHybridSteps(stepsLinear).map((s) => s.id), ['step_1', 'step_2', 'step_3']),
    'orderHybridSteps: linear chain preserved',
  );

  // Out-of-order input → topo-sorted output.
  const stepsShuffled: HybridStep[] = [
    { id: 'step_3', kind: 'browser', task: '', rationale: '', needsApproval: false, dependsOn: ['step_1', 'step_2'] },
    { id: 'step_1', kind: 'file', task: '', rationale: '', needsApproval: false, dependsOn: [] },
    { id: 'step_2', kind: 'app', task: '', rationale: '', needsApproval: false, dependsOn: [] },
  ];
  const ordered = orderHybridSteps(stepsShuffled).map((s) => s.id);
  assert(
    ordered.indexOf('step_1') < ordered.indexOf('step_3') &&
      ordered.indexOf('step_2') < ordered.indexOf('step_3'),
    'orderHybridSteps: dependents come after dependencies',
  );

  // Cycle → throws.
  const stepsCycle: HybridStep[] = [
    { id: 'step_1', kind: 'file', task: '', rationale: '', needsApproval: false, dependsOn: ['step_2'] },
    { id: 'step_2', kind: 'app', task: '', rationale: '', needsApproval: false, dependsOn: ['step_1'] },
  ];
  let threw = false;
  try { orderHybridSteps(stepsCycle); } catch { threw = true; }
  assert(threw, 'orderHybridSteps: cycle throws');

  // Reference to nonexistent step → throws.
  const stepsBadRef: HybridStep[] = [
    { id: 'step_1', kind: 'file', task: '', rationale: '', needsApproval: false, dependsOn: ['step_99'] },
  ];
  let threw2 = false;
  try { orderHybridSteps(stepsBadRef); } catch { threw2 = true; }
  assert(threw2, 'orderHybridSteps: dangling dependsOn throws');

  if (failures > 0) {
    console.error(`\n${failures} test(s) failed`);
    process.exit(1);
  }
  console.log('\nall hybrid-runtime smoke tests passed');
}

main();
