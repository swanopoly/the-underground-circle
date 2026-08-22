/**
 * OpenSwan ordinary-tool terminal truth smoke.
 *
 * Pins the prose-independent rule for non-A-ledger turns: an attempted
 * planner-required tool or mutation owns terminal truth, while a failed
 * optional exploratory read does not poison an otherwise valid answer.
 * Performs no provider, bridge, database, or React Native work.
 *
 * Run:
 *   npx tsx scripts/openswan-ordinary-tool-terminal-truth-smoketest.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildOpenSwanTerminalReceipt,
  resolveOpenSwanRequiredToolDisposition,
} from '../src/lib/openswanSessionRuntimeAdapters';

let assertions = 0;

function equal(actual: unknown, expected: unknown, message: string): void {
  assert.equal(actual, expected, message);
  assertions += 1;
}

function disposition(
  toolEvents: ReadonlyArray<Record<string, unknown>>,
  requiredToolNames: ReadonlyArray<string> = [],
  mutatingToolNames: ReadonlyArray<string> = [],
) {
  return resolveOpenSwanRequiredToolDisposition({
    toolEvents,
    requiredToolNames,
    mutatingToolNames,
  });
}

async function main(): Promise<void> {
  equal(
    disposition([{
      tool_name: 'tasks.update_status',
      status: 'failed',
      metadata: { toolPolicy: { mutatesState: true } },
    }]),
    'failed',
    'typed failed mutation blocks ordinary completion without planner priority',
  );
  equal(
    disposition([{
      tool: 'messages.create',
      status: 'blocked',
      metadata: { toolPolicy: { mutatesState: true } },
    }]),
    'blocked',
    'legacy blocked mutation remains deferred rather than successful',
  );
  equal(
    disposition([{
      tool_name: 'rooms.create_task',
      status: 'manual_required',
      metadata: { toolPolicy: { mutatesState: true } },
    }]),
    'blocked',
    'typed manual-required mutation remains deferred',
  );
  equal(
    disposition([{
      tool: 'fetch_url',
      status: 'failed',
      metadata: { toolPolicy: { mutatesState: false } },
    }], ['fetch_url']),
    'failed',
    'legacy failed planner-high read blocks an unsupported answer',
  );
  equal(
    disposition([{
      tool_name: 'verification.preview',
      status: 'manual_required',
      metadata: { toolPolicy: { mutatesState: false } },
    }], ['verification.preview']),
    'blocked',
    'typed required manual verification remains deferred',
  );
  equal(
    disposition([{
      tool: 'research.search',
      status: 'failed',
      metadata: { toolPolicy: { mutatesState: false } },
    }], ['fetch_url']),
    'none',
    'failed optional exploratory read does not poison a valid answer',
  );
  equal(
    disposition([
      {
        tool_name: 'research.search',
        status: 'failed',
        metadata: { toolPolicy: { mutatesState: false } },
      },
      {
        tool_name: 'fetch_url',
        status: 'completed',
        metadata: { toolPolicy: { mutatesState: false } },
      },
    ], ['fetch_url']),
    'satisfied',
    'successful required read survives an unrelated exploratory failure',
  );
  equal(
    disposition([{
      tool: 'tasks.update_status',
      status: 'passed',
      metadata: { toolPolicy: { mutatesState: true } },
    }]),
    'satisfied',
    'legacy passed mutation satisfies the ordinary terminal gate',
  );
  equal(
    disposition([
      {
        tool: 'tasks.update_status',
        status: 'passed',
        metadata: { toolPolicy: { mutatesState: true } },
      },
      {
        tool: 'tasks.update_status',
        status: 'failed',
        metadata: { toolPolicy: { mutatesState: true } },
      },
    ]),
    'failed',
    'a failed required attempt cannot be hidden by another passed event',
  );
  equal(
    disposition([{
      tool_name: 'fetch_url',
      status: 'future_status',
      metadata: { toolPolicy: { mutatesState: false } },
    }], ['fetch_url']),
    'blocked',
    'unknown required status fails closed to deferred',
  );
  equal(
    disposition([{
      tool_name: 'mcp__trusted__send',
      status: 'failed',
      metadata: { policy: { mutatesState: true } },
    }]),
    'failed',
    'typed MCP mutation policy participates in terminal truth',
  );
  equal(
    disposition([{
      tool_name: 'mcp__trusted__lookup',
      status: 'failed',
      metadata: { policy: { mutatesState: false } },
    }]),
    'none',
    'typed trusted read-only MCP exploration remains non-gating',
  );
  equal(
    disposition([{
      tool: 'custom_mutation',
      status: 'failed',
      metadata: {},
    }], [], ['custom_mutation']),
    'failed',
    'runtime-owned mutating tool names cover policy metadata loss',
  );

  const failed = buildOpenSwanTerminalReceipt({
    cancelled: false,
    incomplete: false,
    requiredToolDisposition: 'failed',
  });
  equal(failed.state, 'failed', 'failed required tool produces a failed terminal');
  equal(failed.reason, 'action_coverage_failed', 'failed required tool uses existing requested-action failure reason');
  equal(failed.completionVerified, false, 'failed required tool cannot verify completion');

  const blocked = buildOpenSwanTerminalReceipt({
    cancelled: false,
    incomplete: false,
    requiredToolDisposition: 'blocked',
  });
  equal(blocked.state, 'partial', 'blocked required tool produces a partial terminal');
  equal(blocked.reason, 'action_coverage_incomplete', 'blocked required tool uses existing requested-action deferred reason');
  equal(blocked.completionVerified, false, 'blocked required tool cannot verify completion');

  equal(
    buildOpenSwanTerminalReceipt({
      cancelled: false,
      incomplete: true,
      incompleteReason: 'cap',
      requiredToolDisposition: 'failed',
    }).state,
    'failed',
    'failed required tool is not softened into a step-cap partial',
  );
  equal(
    buildOpenSwanTerminalReceipt({
      cancelled: true,
      incomplete: true,
      incompleteReason: 'cancelled',
      requiredToolDisposition: 'failed',
    }).state,
    'cancelled',
    'explicit user cancellation still wins terminal precedence',
  );
  equal(
    buildOpenSwanTerminalReceipt({
      cancelled: false,
      incomplete: false,
      requiredToolDisposition: disposition([{
        tool: 'research.search',
        status: 'failed',
        metadata: { toolPolicy: { mutatesState: false } },
      }], ['fetch_url']),
    }).completionVerified,
    true,
    'optional exploratory read failure remains eligible for clean completion',
  );

  const runtime = readFileSync(
    resolve(process.cwd(), 'src/lib/openswanSessionRuntime.ts'),
    'utf8',
  );
  equal(
    runtime.includes('let turnRequiredToolDisposition: OpenSwanRequiredToolDisposition = \'none\';'),
    true,
    'runtime initializes one turn-level required-tool disposition',
  );
  equal(
    runtime.includes("tool.priority === 'high'"),
    true,
    'runtime derives required names from planner-high tool items',
  );
  equal(
    runtime.includes('turnRequiredToolDisposition = resolveOpenSwanRequiredToolDisposition({'),
    true,
    'runtime resolves tool truth from the actual turn events',
  );
  equal(
    (runtime.match(/requiredToolDisposition: turnRequiredToolDisposition/g) || []).length >= 3,
    true,
    'every normal terminal-receipt build consumes the same tool disposition',
  );
  equal(
    runtime.includes("terminalReceipt.completionVerified && terminalReceipt.state === 'succeeded'"),
    true,
    'canonical completeRun remains guarded by verified success',
  );
  equal(
    runtime.includes('memoryRecommendations = terminalReceipt.completionVerified'),
    true,
    'success-memory recommendations remain guarded by terminal verification',
  );
  equal(
    runtime.includes('...(terminalReceipt.completionVerified\n          ? [recordArchiveDerivedMemorySuccess({'),
    true,
    'archive success-memory remains guarded by terminal verification',
  );
  equal(
    runtime.includes('if (terminalReceipt.completionVerified) {\n        void captureOpenSwanOutcomeMemory({'),
    true,
    'outcome success-memory capture remains guarded by terminal verification',
  );

  console.log(`OpenSwan ordinary-tool terminal truth smoke passed (${assertions} assertions).`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
