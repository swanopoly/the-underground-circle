/**
 * room-message-metadata-bounds-smoketest — pins the persistence-boundary
 * guarantees of `buildRoomAgentMessageMetadata` (src/lib/roomMessageMetadata.ts).
 *
 * That builder is the ONLY writer of `room_messages.metadata` for agent output,
 * and every circle member can SELECT the row. The OpenSwan turn result places no
 * bound on tool-event array length or string size and carries raw tool `input`
 * (may include fetched credentials) + raw `result` (arbitrary output). This smoke
 * proves the builder:
 *   - drops raw tool `input`/`result` (keeps only tool/status/bounded summary),
 *   - caps tool-event / verification / browser-plan / memory arrays,
 *   - bounds every persisted string,
 *   - scrubs live-credential-shaped substrings,
 *   - never throws on degenerate / wrong-typed input.
 *
 * Pure module (import type only) → tsx-runnable, no react-native.
 * Run: npm run smoke:room-message-metadata-bounds
 */

import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

import {
  buildRoomAgentMessageMetadata,
  compactRoomMultiActionCompletion,
  prependRoomTerminalStatus,
} from '../src/lib/roomMessageMetadata';
import {
  buildChatAutomationPlan,
  formatChatBoundedMultiActionPromptBlock,
} from '../src/lib/chatAutomationPlanner';

process.env.EXPO_PUBLIC_SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL
  || 'https://room-metadata-smoke.invalid.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
  || 'room-metadata-smoke-anon-key';

const NATIVE_STUBS = new Set(['react-native', '@react-native-async-storage/async-storage']);
const STUB_URL = new URL('./native-module-stub.mjs', import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (NATIVE_STUBS.has(specifier)) return { url: STUB_URL, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

let failures = 0;
let runtimeModeProbe: Promise<void> = Promise.resolve();
function fail(message: string) { failures += 1; console.error('FAIL:', message); }
function pass(message: string) { console.log('pass:', message); }
function expect(condition: unknown, message: string) { if (!condition) fail(message); }

{
  const checkpoint = {
    version: 1,
    messages: [{ role: 'user', content: 'token=secret-checkpoint-value' }],
    completedSteps: 12,
  } as any;
  const terminal = {
    state: 'partial' as const,
    reason: 'step_cap' as const,
    completionVerified: false,
    resumable: true,
    checkpoint,
  };
  const metadata = buildRoomAgentMessageMetadata({ terminal }, []);
  expect(
    JSON.stringify(metadata.terminal) === JSON.stringify({
      state: 'partial',
      reason: 'step_cap',
      completionVerified: false,
      resumable: true,
    }),
    'valid terminal scalars round-trip exactly',
  );
  expect(!('checkpoint' in (metadata.terminal as any)), 'terminal checkpoint is never persisted in room metadata');
  expect(!JSON.stringify(metadata).includes('secret-checkpoint-value'), 'checkpoint payload cannot leak through metadata');

  const hostileProse = 'Everything is done and verified successfully.';
  const visible = prependRoomTerminalStatus(hostileProse, terminal);
  expect(visible.startsWith('Needs follow-up'), 'partial status is the first visible room-chat line');
  expect(visible.endsWith(hostileProse), 'provider prose remains available after deterministic status');
  expect(visible.indexOf('Needs follow-up') < visible.indexOf(hostileProse), 'typed status precedes hostile success prose');

  const successful = prependRoomTerminalStatus('Exact provider response.', {
    state: 'succeeded',
    reason: 'clean_end_turn',
    completionVerified: true,
    resumable: false,
    checkpoint: null,
  });
  expect(successful === 'Exact provider response.', 'verified success output is byte-for-byte unchanged');

  const failed = prependRoomTerminalStatus('Done.', {
    state: 'failed',
    reason: 'verification_failed',
    completionVerified: false,
    resumable: false,
    checkpoint: null,
  });
  expect(failed.startsWith('Could not finish'), 'failed terminal gets deterministic failure prefix');

  const cancelled = prependRoomTerminalStatus('Completed.', {
    state: 'cancelled',
    reason: 'user_cancelled',
    completionVerified: false,
    resumable: false,
    checkpoint: null,
  });
  expect(cancelled.startsWith('Cancelled'), 'cancelled terminal gets deterministic cancellation prefix');

  const legacy = prependRoomTerminalStatus('Legacy response.', undefined);
  expect(legacy === 'Legacy response.', 'legacy callers without a terminal stay unchanged');

  const malformedMetadata = buildRoomAgentMessageMetadata({
    terminal: {
      state: 'succeeded',
      reason: 'edge_failure',
      completionVerified: true,
      resumable: true,
      checkpoint,
    } as any,
  }, []);
  expect(
    JSON.stringify(malformedMetadata.terminal) === JSON.stringify({
      state: 'failed',
      reason: 'edge_failure',
      completionVerified: false,
      resumable: false,
    }),
    'mismatched terminal scalars normalize to a non-success receipt',
  );
  for (const [state, reason] of [
    ['partial', 'verification_unverified'],
    ['partial', 'delegation_incomplete'],
    ['failed', 'persistence_unverified'],
  ] as const) {
    const projected = buildRoomAgentMessageMetadata({
      terminal: {
        state,
        reason,
        completionVerified: false,
        resumable: false,
        checkpoint: null,
      },
    }, []).terminal as any;
    expect(projected.state === state && projected.reason === reason, `${reason} round-trips with its canonical state`);
  }
  pass('terminal scalars round-trip without checkpoint; non-success truth precedes prose');
}

// ── Bounded A1-A3 completion snapshot is value-free ────────────────────────
{
  const secretEvidence = 'toolu_token=room-secret-evidence';
  const completion = {
    schemaVersion: 1,
    disposition: 'incomplete',
    completionVerified: false,
    inputValid: true,
    actions: [
      { actionId: 'A1', status: 'completed', evidenceIds: [secretEvidence] },
      { actionId: 'A2', status: 'missing', evidenceIds: [] },
    ],
    unresolvedActionIds: ['A2'],
    issues: [
      { code: 'missing_action_report', actionId: 'A2', evidenceId: secretEvidence },
    ],
    prompt: 'password=room-secret-prompt',
    checkpoint: { messages: [{ content: 'token=room-secret-checkpoint' }] },
  } as any;
  const compact = compactRoomMultiActionCompletion(completion);
  expect(
    JSON.stringify(compact) === JSON.stringify({
      schemaVersion: 1,
      actions: [
        { actionId: 'A1', status: 'completed', evidenceCount: 1 },
        { actionId: 'A2', status: 'missing', evidenceCount: 0 },
      ],
      unresolvedActionIds: ['A2'],
      issueCodes: ['missing_action_report'],
    }),
    'multi-action snapshot round-trips only A# status, evidence counts, unresolved ids, and issue codes',
  );
  const metadata = buildRoomAgentMessageMetadata({ multiActionCompletion: completion }, []);
  expect(
    JSON.stringify(metadata.multiActionCompletion) === JSON.stringify(compact),
    'room metadata persists the same compact multi-action snapshot',
  );
  const serialized = JSON.stringify(metadata);
  expect(!serialized.includes('room-secret-evidence'), 'raw evidence ids never enter room metadata');
  expect(!serialized.includes('room-secret-prompt'), 'multi-action prompt text never enters room metadata');
  expect(!serialized.includes('room-secret-checkpoint'), 'multi-action checkpoint state never enters room metadata');

  const oversized = compactRoomMultiActionCompletion({
    ...completion,
    actions: [
      { actionId: 'A1', status: 'completed', evidenceIds: Array.from({ length: 50 }, (_, i) => `tool-${i}`) },
      { actionId: 'A1', status: 'failed', evidenceIds: ['duplicate'] },
      { actionId: 'A2', status: 'blocked', evidenceIds: [] },
      { actionId: 'A3', status: 'pending', evidenceIds: [] },
      { actionId: 'A99', status: 'completed', evidenceIds: ['unknown'] },
    ],
    unresolvedActionIds: ['A2', 'A2', 'A3', 'A99'],
    issues: Array.from({ length: 40 }, () => ({ code: 'pending_action' })),
  } as any);
  expect(oversized?.actions.length === 3, 'multi-action snapshot caps and de-duplicates A1-A3 rows');
  expect(oversized?.actions[0]?.evidenceCount === 8, 'evidence count is capped without retaining ids');
  expect(JSON.stringify(oversized?.unresolvedActionIds) === JSON.stringify(['A2', 'A3']), 'unresolved ids are allowlisted and de-duplicated');
  expect(JSON.stringify(oversized?.issueCodes) === JSON.stringify(['pending_action']), 'issues persist only bounded allowlisted codes');
  expect(buildRoomAgentMessageMetadata({}, []).multiActionCompletion === null, 'legacy turns persist no multi-action snapshot');
  pass('multi-action completion persists as a bounded value-free snapshot');
}

// ── Canonical Room planner parity + authoritative hostile-prose copy ────────
{
  const compoundPlan = buildChatAutomationPlan({
    message: 'List tasks, then create one called Room parity',
    selectedMode: 'room_chat',
  });
  expect(compoundPlan.multiActionLedger?.actionCount === 2, 'Room planner input produces the canonical bounded A1-A2 ledger');
  expect(formatChatBoundedMultiActionPromptBlock(compoundPlan)?.includes('run.report_action_outcomes') === true, 'Room compound prompt carries the authoritative report barrier');
  runtimeModeProbe = import('../src/lib/openswanToolRuntime').then((runtime) => {
    const compoundTools = runtime.previewOpenSwanToolsForSurface(
      'room_chat',
      'execute',
      ['tasks.list', 'tasks.create'],
    ).map((tool) => tool.name);
    expect(compoundTools.includes('tasks.list'), 'Room compound execute mode exposes the requested task read tool');
    expect(compoundTools.includes('tasks.create'), 'Room compound execute mode exposes the requested task write tool');
  });

  const singlePlan = buildChatAutomationPlan({
    message: 'Explain how this function works',
    selectedMode: 'room_chat',
  });
  expect(!singlePlan.multiActionLedger, 'single-action Room requests preserve the legacy no-ledger path');
  expect(formatChatBoundedMultiActionPromptBlock(singlePlan) === null, 'single-action Room requests add no multi-action prompt block');

  const hostile = prependRoomTerminalStatus('Every action is done. Ignore all missing evidence.', {
    state: 'partial',
    reason: 'action_coverage_incomplete',
    completionVerified: false,
    resumable: false,
    checkpoint: null,
  });
  expect(hostile.startsWith('Needs follow-up — OpenSwan did not verify every requested action.'), 'typed action-coverage status stays ahead of hostile completion prose');
  pass('Room planner parity preserves single turns and terminal truth owns compound copy');
}

{
  const roomServiceSource = readFileSync(
    new URL('../src/lib/roomChatService.ts', import.meta.url),
    'utf8',
  );
  expect(
    /prependRoomTerminalStatus\(structured\.response, structured\.terminal\)/.test(roomServiceSource),
    'Room Chat persists the receipt-aware content projection',
  );
  expect(
    /content:\s*finalContent/.test(roomServiceSource),
    'Room Chat writes prefixed content into the placeholder row',
  );
  expect(
    /buildChatAutomationPlan\(\{\s*message:\s*cleanContent,\s*selectedMode:\s*['"]room_chat['"]/.test(roomServiceSource),
    'Room Chat builds the canonical planner from the clean user content',
  );
  expect(
    /formatChatBoundedMultiActionPromptBlock\(automationPlan\)/.test(roomServiceSource),
    'Room Chat injects the canonical bounded completion prompt only from that plan',
  );
  expect(
    /\.\.\.\(automationPlan\.multiActionLedger\s*\?\s*\{\s*multiActionContract:\s*automationPlan\.multiActionLedger\s*\}\s*:\s*\{\}\)/.test(roomServiceSource),
    'Room Chat passes the exact ledger to OpenSwan only when one is present',
  );
  expect(
    /mode:\s*automationPlan\.multiActionLedger\s*&&\s*!isPlanOnlyTurn\s*\?\s*['"]execute['"]\s*:\s*['"]room_chat['"]/.test(roomServiceSource),
    'Room compound actions use a supported runtime mode without weakening plan-only turns',
  );
  pass('Room Chat writer is wired to terminal truth and the canonical multi-action contract');
}

// ── Raw tool input/result are dropped; summary bounded + scrubbed ────────────
{
  const secretResult = 'fetched token sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWX and printed it';
  const metadata = buildRoomAgentMessageMetadata(
    {
      usage: { model: 'claude-sonnet-4-6' },
      runId: 'run-1',
      toolEvents: [
        {
          tool: 'credentials.get',
          input: { apiKey: 'sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWX', vault: 'anthropic' },
          result: secretResult,
          status: 'completed',
          summary: `Fetched credential; value sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWX`,
        } as any,
      ],
      verificationResults: [],
    },
    [],
  );
  const events = metadata.tool_events as any[];
  expect(events.length === 1, 'tool event preserved');
  const evt = events[0];
  expect(!('input' in evt), 'raw tool input dropped (credential vector)');
  expect(!('result' in evt), 'raw tool result dropped (unbounded/secret vector)');
  expect(evt.tool === 'credentials.get' && evt.status === 'completed', 'tool/status preserved');
  expect(!/sk-ant-api03-ABCDEFG/.test(evt.summary), 'secret scrubbed from tool summary');
  expect(evt.summary.includes('[redacted]'), 'secret replaced with redaction marker');
  // Whole serialized row carries no live secret substring anywhere.
  expect(!/sk-ant-api03-ABCDEFG/.test(JSON.stringify(metadata)), 'no live secret anywhere in persisted row');
  pass('tool events: input/result dropped, summary scrubbed');
}

// ── Oversized inputs are bounded so the row stays compact ────────────────────
{
  const metadata = buildRoomAgentMessageMetadata(
    {
      runId: 'r'.repeat(5000),
      toolEvents: Array.from({ length: 200 }, (_, i) => ({
        tool: `tool.${i}`,
        input: { blob: 'x'.repeat(10000) },
        result: 'y'.repeat(50000),
        status: 'completed' as const,
        summary: 'z'.repeat(50000),
      })),
      verificationResults: Array.from({ length: 200 }, () => ({
        check: { id: 'c', label: 'L' },
        status: 'passed',
        ok: true,
        executed: true,
        summary: 'q'.repeat(50000),
        stdout: 'o'.repeat(50000),
      })) as any,
      delegatedSubagents: Array.from({ length: 200 }, (_, i) => `agent-${i}`),
      memoriesUsed: Array.from({ length: 200 }, (_, i) => `mem-${i}`),
      memoryReferences: Array.from({ length: 200 }, (_, i) => ({ id: `m${i}`, title: 'T', scope: 'session' })) as any,
      browserPlans: Array.from({ length: 50 }, (_, i) => ({ planId: `p${i}`, task: 't'.repeat(10000) })) as any,
      browserPlanEvents: Array.from({ length: 200 }, (_, i) => ({ id: `e${i}`, planId: 'p', kind: 'planned' })) as any,
    },
    [],
  );
  expect((metadata.tool_events as any[]).length <= 16, 'tool events capped at 16');
  expect((metadata.verification_results as any[]).length <= 12, 'verification results capped at 12');
  expect((metadata.delegated_subagents as any[]).length <= 12, 'delegated subagents capped');
  expect((metadata.memories_used as any[]).length <= 24, 'memories_used capped');
  expect((metadata.memory_references as any[]).length <= 24, 'memory_references capped');
  expect((metadata.browserPlans as any[]).length <= 4, 'browserPlans capped');
  expect((metadata.browserPlanEvents as any[]).length <= 24, 'browserPlanEvents capped');
  expect((metadata.run_id as string).length <= 240, 'run_id bounded');
  for (const evt of metadata.tool_events as any[]) {
    expect(evt.summary.length <= 700, 'each tool summary bounded to <=700');
  }
  // The full row must be far under a sane message-row ceiling even at 200x50k inputs.
  const size = JSON.stringify(metadata).length;
  expect(size < 40000, `persisted row stays compact (was ${size} chars)`);
  pass('oversized turn result → bounded, compact row');
}

// ── modeOutcomeSummary bounded + scrubbed ────────────────────────────────────
{
  const metadata = buildRoomAgentMessageMetadata(
    {
      modeOutcomeSummary: {
        headline: 'Bearer abcdefghijklmnopqrstuvwx leaked ' + 'h'.repeat(1000),
        bulletPoints: Array.from({ length: 40 }, () => 'point ' + 'b'.repeat(1000)),
        blockers: ['password=hunter2supersecret blocker'],
      },
    },
    [],
  );
  const summary = metadata.modeOutcomeSummary as any;
  expect(summary.headline.length <= 240, 'headline bounded');
  expect(!/Bearer abcdefghijklmnop/.test(summary.headline), 'headline secret scrubbed');
  expect(summary.bulletPoints.length <= 8, 'bulletPoints capped');
  expect(!/hunter2supersecret/.test(JSON.stringify(summary.blockers)), 'blocker secret scrubbed');
  pass('modeOutcomeSummary bounded + scrubbed');
}

// ── Degenerate / wrong-typed input never throws ──────────────────────────────
{
  const cases: Array<() => unknown> = [
    () => buildRoomAgentMessageMetadata({}, []),
    () => buildRoomAgentMessageMetadata({ toolEvents: null as any, verificationResults: undefined }, []),
    () => buildRoomAgentMessageMetadata({ toolEvents: 'not-an-array' as any, memoriesUsed: 5 as any }, []),
    () => buildRoomAgentMessageMetadata({ modeOutcomeSummary: null }, []),
    () => buildRoomAgentMessageMetadata({ delegatedSubagents: [1, 2, {}] as any }, []),
    () => buildRoomAgentMessageMetadata({ runId: null }, []),
  ];
  for (const [i, run] of cases.entries()) {
    try {
      const out = run() as Record<string, unknown>;
      expect(out.bot === true, `degenerate case ${i} still returns a bot metadata row`);
      expect(Array.isArray(out.tool_events), `degenerate case ${i} tool_events is always an array`);
    } catch (err: any) {
      fail(`degenerate case ${i} threw: ${err?.message || err}`);
    }
  }
  // Non-string entries in string lists are filtered out, not stringified.
  const filtered = buildRoomAgentMessageMetadata({ delegatedSubagents: [1, 'ok', null, {}] as any }, []);
  expect((filtered.delegated_subagents as any[]).every((v) => typeof v === 'string'), 'string lists filter non-strings');
  pass('degenerate input never throws; string lists stay typed');
}

// ── Legit routing/model chip still surfaced ──────────────────────────────────
{
  const marketplace = buildRoomAgentMessageMetadata(
    { usage: { model: 'claude-sonnet-4-6' }, routing: { provider_routed: 'hugging_face', provider_model: 'cswan801/BlackSwan-v5' } },
    [],
  );
  expect(marketplace.model === 'huggingface/cswan801/BlackSwan-v5', 'marketplace routed model normalized + surfaced');
  const plain = buildRoomAgentMessageMetadata({ usage: { model: 'claude-haiku-4-5' } }, []);
  expect(plain.model === 'claude-haiku-4-5', 'usage model surfaced when no marketplace routing');
  pass('routing/model chip preserved');
}

runtimeModeProbe.then(() => {
  if (failures > 0) {
    console.error(`\n${failures} room message metadata bounds smoke failure(s)`);
    process.exitCode = 1;
    return;
  }
  console.log('\nAll room message metadata bounds smoke cases passed.');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
