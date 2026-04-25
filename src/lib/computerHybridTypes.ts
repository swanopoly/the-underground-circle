// computerHybridTypes.ts — shapes shared by the planner edge function,
// the client runtime, the DB layer, and the Focus Chain UI. Keeping
// these in their own file avoids the React Native import cycle that
// would result from putting them in computerHybridRuntime.ts (which
// transitively pulls in the file/app/browser adapters).

export type HybridStepKind = 'file' | 'app' | 'browser';

export type HybridStepStatus =
  | 'pending'
  | 'active'
  | 'completed'
  | 'blocked'
  | 'skipped';

export interface HybridStep {
  /** Stable id, format: 'step_1', 'step_2', ... */
  id: string;
  kind: HybridStepKind;
  /** Sub-task prompt fed to the matching adapter. */
  task: string;
  /** One-sentence justification, surfaced in the Focus Chain UI. */
  rationale: string;
  /** Whether this step requires inline user approval before dispatch. */
  needsApproval: boolean;
  /** Step ids that must complete before this step can run. */
  dependsOn: string[];
  /**
   * Optional template string referencing prior step output. Resolved at
   * dispatch time. Examples:
   *   '{{step_1.output.findings}}'
   *   'Use these PDF paths: {{step_1.output.matches[0].path}}'
   * Token format: {{step_<id>.output.<dot.path>}}
   */
  consumes?: string;
}

export interface HybridPlan {
  /** Stable plan id from the planner edge function. */
  id: string;
  /** Original user request. */
  task: string;
  steps: HybridStep[];
  estimatedCost: { tokens: number; usd: number };
  /** Capability ids the plan needs from the registry. */
  requiredCapabilities: string[];
}

/** Persisted step row (matches computer_task_steps table). */
export interface HybridStepRecord {
  id: string;
  run_id: string;
  circle_id: string;
  step_index: number;
  step_kind: HybridStepKind;
  task: string;
  rationale: string | null;
  status: HybridStepStatus;
  output: unknown | null;
  error: string | null;
  needs_approval: boolean;
  approved_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  depends_on: string[];
  consumes: string | null;
}
