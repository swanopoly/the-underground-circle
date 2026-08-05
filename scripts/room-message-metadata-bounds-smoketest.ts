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

import { buildRoomAgentMessageMetadata } from '../src/lib/roomMessageMetadata';

let failures = 0;
function fail(message: string) { failures += 1; console.error('FAIL:', message); }
function pass(message: string) { console.log('pass:', message); }
function expect(condition: unknown, message: string) { if (!condition) fail(message); }

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

if (failures > 0) {
  console.error(`\n${failures} room message metadata bounds smoke failure(s)`);
  process.exit(1);
}
console.log('\nAll room message metadata bounds smoke cases passed.');
