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

import type { HybridStep } from './computerHybridTypes';

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
