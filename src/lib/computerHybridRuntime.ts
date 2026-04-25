// src/lib/computerHybridRuntime.ts
//
// Hybrid task orchestrator. Plans come from the hybrid-task-planner
// edge function as a HybridPlan. This module walks the plan, resolves
// {{step_N.output.X}} tokens, dispatches each step through the matching
// existing adapter, persists status to computer_task_steps, and at the
// end synthesizes a unified summary across step outputs.
//
// This file holds:
//   - resolveStepTokens (pure)
//   - orderHybridSteps  (pure topological sort)
//   - executeHybridTask (orchestrator) — added in later tasks
//   - synthesizeHybridSummary (Claude call) — added in later tasks

import type { HybridStep, HybridPlan, HybridStepRecord } from './computerHybridTypes';

// ─── Token resolution ─────────────────────────────────────────────

const TOKEN_RE = /\{\{step_(\w+)\.output(?:\.([^\s}]+))?\}\}/g;

/**
 * Resolve {{step_<id>.output.<dot.path>}} tokens against a map of
 * completed step outputs. Missing steps or paths resolve to empty
 * string (not thrown) — caller decides whether the missing data
 * matters. Arrays/objects embedded inline are JSON-serialized.
 */
export function resolveStepTokens(
  template: string,
  outputs: Record<string, unknown>,
): string {
  if (!template || typeof template !== 'string') return template ?? '';
  return template.replace(TOKEN_RE, (_match, idSuffix: string, path: string | undefined) => {
    const stepKey = `step_${idSuffix}`;
    const stepOut = outputs[stepKey];
    if (stepOut === undefined || stepOut === null) return '';
    const resolved = path ? readDotPath(stepOut, path) : stepOut;
    if (resolved === undefined || resolved === null) return '';
    if (typeof resolved === 'string') return resolved;
    if (typeof resolved === 'number' || typeof resolved === 'boolean') return String(resolved);
    try {
      return JSON.stringify(resolved);
    } catch {
      return '';
    }
  });
}

/**
 * Read a dot/bracket path from a value. Examples:
 *   readDotPath({ a: { b: 1 } }, 'a.b')        → 1
 *   readDotPath({ xs: [{ y: 2 }] }, 'xs[0].y') → 2
 */
function readDotPath(root: unknown, path: string): unknown {
  if (!path) return root;
  // Normalize bracket notation to dots: xs[0].y → xs.0.y
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let cur: any = root;
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[p];
  }
  return cur;
}

// ─── Topological ordering ─────────────────────────────────────────

/**
 * Return a topological ordering of steps based on `dependsOn`. Throws
 * on cycles or on references to step ids that are not in the input.
 * Stable ordering: independent steps preserve their input order.
 */
export function orderHybridSteps(steps: HybridStep[]): HybridStep[] {
  const byId = new Map<string, HybridStep>();
  for (const s of steps) byId.set(s.id, s);

  // Validate references.
  for (const s of steps) {
    for (const dep of s.dependsOn) {
      if (!byId.has(dep)) {
        throw new Error(`step ${s.id} depends on unknown step ${dep}`);
      }
    }
  }

  const result: HybridStep[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(id: string) {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      throw new Error(`cycle detected at step ${id}`);
    }
    visiting.add(id);
    const step = byId.get(id)!;
    for (const dep of step.dependsOn) visit(dep);
    visiting.delete(id);
    visited.add(id);
    result.push(step);
  }

  for (const s of steps) visit(s.id);
  return result;
}

// ─── executeHybridTask ────────────────────────────────────────────

/**
 * Result of a fully-walked hybrid run, returned to the caller after
 * synthesis. The unified `summary` is what the user sees in chat;
 * stepRecords carry the per-step state for the Focus Chain UI to
 * render even after the hook unsubscribes.
 */
export interface HybridRunResult {
  runId: string;
  summary: string;
  stepRecords: HybridStepRecord[];
  warnings: string[];
}

// ─── synthesizeHybridSummary ──────────────────────────────────────

/**
 * One-shot summarization across completed step outputs. Returns the
 * unified user-facing summary the orchestrator persists into
 * computer_use_runs.summary. Uses Haiku 4.5 — synthesis is one-pass,
 * relatively short context, and Haiku is the right cost tier here.
 *
 * If the call fails for any reason, returns a deterministic fallback
 * summary built from the step records — better than throwing and
 * leaving the run with `status='running'` forever.
 */
export async function synthesizeHybridSummary(args: {
  task: string;
  stepRecords: HybridStepRecord[];
}): Promise<string> {
  const completed = args.stepRecords.filter((s) => s.status === 'completed');

  // Deterministic fallback used when synthesis fails or every step
  // failed. Lists what worked and what didn't, no narrative.
  const fallback = buildDeterministicSummary(args.task, args.stepRecords);

  if (completed.length === 0) return fallback;

  const stepBlocks = args.stepRecords
    .map((s) => {
      const out = s.output ? JSON.stringify(s.output).slice(0, 4000) : null;
      const head = `Step ${s.step_index + 1} (${s.step_kind}): ${s.task}`;
      const status = s.status === 'completed'
        ? 'COMPLETED'
        : `${s.status.toUpperCase()}${s.error ? `: ${s.error}` : ''}`;
      return `${head}\n  status: ${status}${out ? `\n  output: ${out}` : ''}`;
    })
    .join('\n\n');

  const system = [
    'You synthesize the result of a multi-step computer task into one short, useful summary for the user.',
    'Lead with the answer to their original request.',
    'If a step was blocked or skipped, note it briefly — never invent results for skipped steps.',
    'Keep it under ~200 words.',
  ].join('\n');

  const user = `Original request:\n${args.task}\n\nSteps and outputs:\n${stepBlocks}\n\nWrite the unified summary.`;

  try {
    // invokeLLMProxy routes through the llm-proxy edge function, which
    // separates system-role messages into Anthropic's top-level `system`
    // field automatically. Dynamic import keeps this file importable by
    // the smoke test (pure-functions only, no React Native or Supabase).
    const { invokeLLMProxy } = await import('./llmProviders');
    const result = await invokeLLMProxy({
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      maxTokens: 600,
    });
    const text = String(result?.response || '').trim();
    return text || fallback;
  } catch (err: any) {
    console.warn('[hybridRuntime] synthesis failed', err?.message);
    return fallback;
  }
}

function buildDeterministicSummary(task: string, records: HybridStepRecord[]): string {
  const lines = [`Task: ${task}`, '', 'Steps:'];
  for (const r of records) {
    const tag = r.status === 'completed' ? '✓' :
                r.status === 'blocked'   ? '✗' :
                r.status === 'skipped'   ? '·' :
                '?';
    lines.push(`${tag} ${r.step_index + 1}. ${r.task}${r.error ? ` — ${r.error}` : ''}`);
  }
  return lines.join('\n');
}

/**
 * Walk a HybridPlan: persist steps, dispatch each to its adapter in
 * dependency order, capture outputs, halt on errors.
 *
 * Idempotency: caller is responsible for ensuring `plan.steps` haven't
 * already been persisted under `runId`. Re-runs of the same runId will
 * insert duplicates because the table only has UNIQUE(run_id, step_index)
 * — the caller checks before invoking on resume.
 *
 * Returns the ordered step records and any warnings collected from
 * adapter calls. Final summary synthesis is a separate call
 * (synthesizeHybridSummary) so callers can interleave UI updates.
 */
export async function executeHybridTask(args: {
  runId: string;
  circleId: string;
  plan: HybridPlan;
  /**
   * Called when a step needs approval. Resolves with true to proceed
   * or false to mark the step blocked (and halt dependents).
   */
  onApprovalRequired: (step: HybridStepRecord) => Promise<boolean>;
}): Promise<HybridRunResult> {
  const ordered = orderHybridSteps(args.plan.steps);
  const warnings: string[] = [];

  // Dynamic import so the smoke test (pure-function only) doesn't pull
  // in Supabase / React Native at module-load time.
  const { insertHybridSteps, updateStepStatus } = await import('./computerTaskSteps');

  // Persist all steps as pending so the UI can render the chain
  // immediately — even before the first dispatch.
  const records = await insertHybridSteps({
    runId: args.runId,
    circleId: args.circleId,
    steps: ordered,
  });

  if (records.length !== ordered.length) {
    warnings.push('failed to persist all hybrid steps; UI may lag');
  }

  // Map plan-step id → DB record id for status updates.
  const recordById = new Map<string, HybridStepRecord>();
  records.forEach((rec, i) => {
    const planStep = ordered[i];
    if (planStep) recordById.set(planStep.id, rec);
  });

  // In-memory step outputs for token resolution (parallel to DB writes).
  const outputs: Record<string, unknown> = {};
  // Track which steps got blocked so we can cascade-skip dependents.
  const blockedIds = new Set<string>();

  for (const step of ordered) {
    const record = recordById.get(step.id);
    if (!record) {
      warnings.push(`no DB record for plan step ${step.id} — skipping`);
      blockedIds.add(step.id);
      continue;
    }

    // Cascade skip if any dependency was blocked.
    const cascadeBlocked = step.dependsOn.some((d) => blockedIds.has(d));
    if (cascadeBlocked) {
      blockedIds.add(step.id);
      await updateStepStatus({
        stepId: record.id,
        status: 'skipped',
        error: `dependency blocked: ${step.dependsOn.find((d) => blockedIds.has(d))}`,
      });
      continue;
    }

    // Approval gate (if needed).
    if (step.needsApproval) {
      const approved = await args.onApprovalRequired(record);
      if (!approved) {
        blockedIds.add(step.id);
        await updateStepStatus({
          stepId: record.id,
          status: 'blocked',
          error: 'user_declined',
        });
        continue;
      }
    }

    // Resolve {{step_N.output.X}} tokens against in-memory outputs.
    const resolvedTask = step.consumes
      ? `${step.task}\n\nContext:\n${resolveStepTokens(step.consumes, outputs)}`
      : step.task;

    // Mark active.
    await updateStepStatus({ stepId: record.id, status: 'active' });

    // Dispatch.
    try {
      const dispatchOutput = await dispatchHybridStep({
        kind: step.kind,
        circleId: args.circleId,
        task: resolvedTask,
      });
      outputs[step.id] = dispatchOutput.output;
      await updateStepStatus({
        stepId: record.id,
        status: 'completed',
        output: dispatchOutput.output,
      });
      if (dispatchOutput.warnings.length > 0) {
        warnings.push(...dispatchOutput.warnings.map((w) => `[${step.id}] ${w}`));
      }
    } catch (err: any) {
      const msg = err?.message || String(err);
      blockedIds.add(step.id);
      await updateStepStatus({
        stepId: record.id,
        status: 'blocked',
        error: msg,
      });
      warnings.push(`[${step.id}] dispatch failed: ${msg}`);
    }
  }

  // Refresh records so callers get final per-step state (status + output)
  // even if they don't subscribe via useHybridSteps.
  const { fetchHybridSteps } = await import('./computerTaskSteps');
  const freshRecords = await fetchHybridSteps(args.runId);

  return {
    runId: args.runId,
    summary: '', // filled in by synthesizeHybridSummary in Task 5
    stepRecords: freshRecords.length === ordered.length ? freshRecords : records,
    warnings,
  };
}

/**
 * Dispatch a single step through the matching adapter. Wraps the file
 * and app adapters' { ok, message, data } shape into a generic
 * { output, warnings } shape for the orchestrator. Browser steps go
 * through the existing computer-use-agent edge function — same as the
 * standalone browser_task path.
 *
 * Adapter imports are deferred (dynamic import()) so that the pure
 * functions above — which the smoke test imports directly — do not
 * transitively pull in React Native modules at module-load time.
 */
async function dispatchHybridStep(args: {
  kind: 'file' | 'app' | 'browser';
  circleId: string;
  task: string;
}): Promise<{ output: unknown; warnings: string[] }> {
  if (args.kind === 'file') {
    const { executeComputerFileTask } = await import('./computerFileAdapter');
    const r = await executeComputerFileTask({ circleId: args.circleId, task: args.task });
    if (!r.ok) throw new Error(r.message || 'file adapter failed');
    return {
      output: { message: r.message, data: r.data, normalized: r.normalized ?? null },
      warnings: r.warnings,
    };
  }
  if (args.kind === 'app') {
    const { executeComputerAppTask } = await import('./computerAppAdapter');
    const r = await executeComputerAppTask({ circleId: args.circleId, task: args.task });
    if (!r.ok) throw new Error(r.message || 'app adapter failed');
    return { output: { message: r.message, data: r.data }, warnings: r.warnings };
  }
  // browser
  const r = await runBrowserStep({ circleId: args.circleId, task: args.task });
  return { output: r.output, warnings: r.warnings };
}

/**
 * Browser step shim — wraps `startComputerUseAgent` (SSE-streaming,
 * callback-based) in a Promise. Resolves Browserbase credentials from
 * the circle's integration config, then starts the agent and waits for
 * `onResult` or `onError`. Captures summary + findings + session ids
 * as the step's output.
 *
 * Uses dynamic import() for the same reason as dispatchHybridStep —
 * computerUseAgent pulls in React Native and would break the Node-based
 * smoke test if imported at the top level.
 */
async function runBrowserStep(args: {
  circleId: string;
  task: string;
}): Promise<{ output: unknown; warnings: string[] }> {
  const [{ resolveComputerUseCreds }, { startComputerUseAgent }] = await Promise.all([
    import('./computerUseCreds'),
    import('./computerUseAgent'),
  ]);

  // Resolve Browserbase credentials from the circle's integration config.
  const credsResult = await resolveComputerUseCreds(args.circleId);
  if (!credsResult.ok) {
    throw new Error(`browser step cannot start: ${credsResult.reason}`);
  }
  const { browserbase } = credsResult.creds;

  const BROWSER_STEP_TIMEOUT_MS = 5 * 60 * 1000; // 5 min

  // Capture resolve/reject so both the step Promise and the timeout
  // branch can settle the same Promise. These are assigned synchronously
  // inside the Promise constructor below before startComputerUseAgent is
  // called, so it is safe for onResult/onError to reference them.
  let resolveStep!: (value: { output: unknown; warnings: string[] }) => void;
  let rejectStep!: (reason: unknown) => void;

  // Wire the callbacks before starting the agent so the closures are
  // ready even if the agent resolves on the same tick.
  const stepPromise = new Promise<{ output: unknown; warnings: string[] }>((res, rej) => {
    resolveStep = res;
    rejectStep = rej;
  });

  // `handle` must be obtained synchronously before Promise.race so that
  // the timeout branch can call handle.cancel() to stop the SSE stream.
  const handle = startComputerUseAgent({
    task: args.task,
    circleId: args.circleId,
    browserbase,
    onResult: (info) => {
      resolveStep({
        output: {
          summary: info.summary,
          findings: info.findings ?? null,
          sessionId: info.sessionId,
          liveUrl: info.liveUrl,
          runId: info.runId ?? null,
        },
        warnings: [],
      });
    },
    onError: (message) => {
      // Cancel the SSE stream before rejecting so we don't leak the
      // underlying fetch/reader on error paths.
      handle.cancel();
      rejectStep(new Error(message));
    },
  });

  const result = await Promise.race([
    stepPromise,
    new Promise<never>((_, reject) =>
      setTimeout(() => {
        try { handle.cancel?.(); } catch { /* best-effort */ }
        reject(new Error('browser step timed out after 5 minutes'));
      }, BROWSER_STEP_TIMEOUT_MS),
    ),
  ]);
  return result;
}
