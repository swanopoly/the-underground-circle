// Task Execution Runtime — helpers for managing task run steps, artifacts, checks, and approvals

import { supabase } from './supabase';
import { getTaskCapabilityProfile, type TaskCapabilityProfileKey } from './taskCapabilityProfiles';

// ---------------------------------------------------------------------------
// 1. createInitialTaskRunSteps
// ---------------------------------------------------------------------------
export async function createInitialTaskRunSteps(
  runId: string,
  taskId: string,
  circleId: string,
): Promise<{ data: any[] | null; error: any }> {
  try {
    const now = new Date().toISOString();
    const rows = [
      {
        run_id: runId,
        task_id: taskId,
        circle_id: circleId,
        step_index: 0,
        step_kind: 'plan',
        status: 'completed',
        title: 'Plan',
        summary: 'Task execution plan created.',
        started_at: now,
        completed_at: now,
      },
      {
        run_id: runId,
        task_id: taskId,
        circle_id: circleId,
        step_index: 1,
        step_kind: 'execution',
        status: 'running',
        title: 'Execution',
        summary: 'Running task execution.',
        started_at: now,
      },
      {
        run_id: runId,
        task_id: taskId,
        circle_id: circleId,
        step_index: 2,
        step_kind: 'finalize',
        status: 'pending',
        title: 'Finalize',
      },
    ];

    const { data, error } = await supabase.from('task_run_steps').insert(rows).select();
    if (error) {
      console.error('createInitialTaskRunSteps error:', error);
    }
    return { data, error };
  } catch (err) {
    console.error('createInitialTaskRunSteps exception:', err);
    return { data: null, error: err };
  }
}

// ---------------------------------------------------------------------------
// 2. appendTaskRunStep
// ---------------------------------------------------------------------------
export async function appendTaskRunStep(
  runId: string,
  taskId: string,
  circleId: string,
  stepKind: string,
  title: string,
  summary?: string,
  payload?: Record<string, unknown>,
): Promise<{ data: any | null; error: any }> {
  try {
    // Determine next step_index
    const { data: existing, error: countErr } = await supabase
      .from('task_run_steps')
      .select('step_index')
      .eq('run_id', runId)
      .order('step_index', { ascending: false })
      .limit(1);

    if (countErr) {
      console.error('appendTaskRunStep count error:', countErr);
    }

    const nextIndex = existing && existing.length > 0 ? existing[0].step_index + 1 : 0;
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from('task_run_steps')
      .insert({
        run_id: runId,
        task_id: taskId,
        circle_id: circleId,
        step_index: nextIndex,
        step_kind: stepKind,
        status: 'completed',
        title,
        summary: summary ?? null,
        payload: payload ?? {},
        started_at: now,
        completed_at: now,
      })
      .select()
      .single();

    if (error) {
      console.error('appendTaskRunStep insert error:', error);
    }
    return { data, error };
  } catch (err) {
    console.error('appendTaskRunStep exception:', err);
    return { data: null, error: err };
  }
}

// ---------------------------------------------------------------------------
// 3. createTaskRunArtifact
// ---------------------------------------------------------------------------
export async function createTaskRunArtifact(
  runId: string,
  taskId: string,
  circleId: string,
  artifactKind: string,
  label: string,
  content?: string,
  url?: string,
  filePath?: string,
  metadata?: Record<string, unknown>,
): Promise<{ data: any | null; error: any }> {
  try {
    const { data, error } = await supabase
      .from('task_run_artifacts')
      .insert({
        run_id: runId,
        task_id: taskId,
        circle_id: circleId,
        artifact_kind: artifactKind,
        label,
        content: content ?? null,
        url: url ?? null,
        file_path: filePath ?? null,
        metadata: metadata ?? {},
      })
      .select()
      .single();

    if (error) {
      console.error('createTaskRunArtifact error:', error);
    }
    return { data, error };
  } catch (err) {
    console.error('createTaskRunArtifact exception:', err);
    return { data: null, error: err };
  }
}

// ---------------------------------------------------------------------------
// 4. createTaskRunApproval
// ---------------------------------------------------------------------------
export async function createTaskRunApproval(
  runId: string,
  taskId: string,
  circleId: string,
  approvalKind: string,
  title: string,
  summary?: string,
  requestedBy?: string,
  payload?: Record<string, unknown>,
): Promise<{ data: any | null; error: any }> {
  try {
    const { data, error } = await supabase
      .from('task_run_approvals')
      .insert({
        run_id: runId,
        task_id: taskId,
        circle_id: circleId,
        approval_kind: approvalKind,
        title,
        summary: summary ?? null,
        status: 'pending',
        requested_by: requestedBy ?? null,
        payload: payload ?? {},
      })
      .select()
      .single();

    if (error) {
      console.error('createTaskRunApproval error:', error);
    }
    return { data, error };
  } catch (err) {
    console.error('createTaskRunApproval exception:', err);
    return { data: null, error: err };
  }
}

// ---------------------------------------------------------------------------
// 5. ensureTaskAcceptanceChecks
// ---------------------------------------------------------------------------
export async function ensureTaskAcceptanceChecks(
  taskId: string,
  circleId: string,
  profileKey: string,
): Promise<{ data: any[] | null; error: any }> {
  try {
    // If checks already exist for this task, skip
    const { data: existingChecks, error: fetchErr } = await supabase
      .from('task_acceptance_checks')
      .select('id')
      .eq('task_id', taskId)
      .limit(1);

    if (fetchErr) {
      console.error('ensureTaskAcceptanceChecks fetch error:', fetchErr);
      return { data: null, error: fetchErr };
    }

    if (existingChecks && existingChecks.length > 0) {
      // Checks already exist — return them
      const { data: all, error: allErr } = await supabase
        .from('task_acceptance_checks')
        .select('*')
        .eq('task_id', taskId);
      return { data: all, error: allErr };
    }

    const profile = getTaskCapabilityProfile(profileKey);
    if (!profile) {
      return { data: [], error: null };
    }

    const checksToInsert: Array<Record<string, unknown>> = [];

    // Insert artifact_present checks for each required artifact
    if (profile.defaults.required_artifacts) {
      for (const artifact of profile.defaults.required_artifacts) {
        checksToInsert.push({
          task_id: taskId,
          circle_id: circleId,
          check_kind: 'artifact_present',
          label: `Artifact present: ${artifact}`,
          is_required: true,
          config: { artifact_kind: artifact },
        });
      }
    }

    // Insert check kinds from profile.defaults.checks
    if (profile.defaults.checks) {
      for (const checkKind of profile.defaults.checks) {
        checksToInsert.push({
          task_id: taskId,
          circle_id: circleId,
          check_kind: checkKind,
          label: checkKind.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
          is_required: true,
          config: {},
        });
      }
    }

    if (checksToInsert.length === 0) {
      return { data: [], error: null };
    }

    const { data, error } = await supabase
      .from('task_acceptance_checks')
      .insert(checksToInsert)
      .select();

    if (error) {
      console.error('ensureTaskAcceptanceChecks insert error:', error);
    }
    return { data, error };
  } catch (err) {
    console.error('ensureTaskAcceptanceChecks exception:', err);
    return { data: null, error: err };
  }
}

// ---------------------------------------------------------------------------
// 6. evaluateTaskRunChecks
// ---------------------------------------------------------------------------
export async function evaluateTaskRunChecks(
  runId: string,
  taskId: string,
  circleId: string,
): Promise<{ data: any[] | null; error: any }> {
  try {
    // Load all acceptance checks for this task
    const { data: checks, error: checksErr } = await supabase
      .from('task_acceptance_checks')
      .select('*')
      .eq('task_id', taskId);

    if (checksErr || !checks) {
      console.error('evaluateTaskRunChecks load checks error:', checksErr);
      return { data: null, error: checksErr };
    }

    // Load existing artifacts for this run
    const { data: artifacts, error: artifactsErr } = await supabase
      .from('task_run_artifacts')
      .select('artifact_kind')
      .eq('run_id', runId);

    if (artifactsErr) {
      console.error('evaluateTaskRunChecks load artifacts error:', artifactsErr);
    }

    const artifactKinds = new Set((artifacts ?? []).map((a: any) => a.artifact_kind));
    const now = new Date().toISOString();
    const results: Array<Record<string, unknown>> = [];

    for (const check of checks) {
      let status = 'pending';
      let evidence: Record<string, unknown> = {};

      if (check.check_kind === 'artifact_present') {
        const requiredKind = check.config?.artifact_kind;
        if (requiredKind && artifactKinds.has(requiredKind)) {
          status = 'passed';
          evidence = { artifact_kind: requiredKind, found: true };
        } else if (requiredKind) {
          status = 'failed';
          evidence = { artifact_kind: requiredKind, found: false };
        }
      }
      // human_review and other kinds stay pending — require manual resolution

      results.push({
        run_id: runId,
        check_id: check.id,
        task_id: taskId,
        circle_id: circleId,
        status,
        evidence,
        evaluated_at: status !== 'pending' ? now : null,
      });
    }

    if (results.length === 0) {
      return { data: [], error: null };
    }

    // Upsert: delete existing results for this run then insert fresh
    await supabase
      .from('task_run_check_results')
      .delete()
      .eq('run_id', runId);

    const { data, error } = await supabase
      .from('task_run_check_results')
      .insert(results)
      .select();

    if (error) {
      console.error('evaluateTaskRunChecks insert error:', error);
    }
    return { data, error };
  } catch (err) {
    console.error('evaluateTaskRunChecks exception:', err);
    return { data: null, error: err };
  }
}

// ---------------------------------------------------------------------------
// 7. canTaskRunMarkComplete
// ---------------------------------------------------------------------------
export async function canTaskRunMarkComplete(
  runId: string,
  taskId: string,
  circleId: string,
): Promise<boolean> {
  try {
    // Load all required checks for this task
    const { data: checks, error: checksErr } = await supabase
      .from('task_acceptance_checks')
      .select('id')
      .eq('task_id', taskId)
      .eq('is_required', true);

    if (checksErr) {
      console.error('canTaskRunMarkComplete checks error:', checksErr);
      return false;
    }

    const requiredCheckIds = new Set((checks ?? []).map((c: any) => c.id));

    // Load check results for this run
    const { data: results, error: resultsErr } = await supabase
      .from('task_run_check_results')
      .select('check_id, status')
      .eq('run_id', runId);

    if (resultsErr) {
      console.error('canTaskRunMarkComplete results error:', resultsErr);
      return false;
    }

    // Every required check must have a result that is 'passed' or 'skipped'
    const resultsByCheck = new Map<string, string>();
    for (const r of results ?? []) {
      resultsByCheck.set(r.check_id, r.status);
    }

    for (const checkId of requiredCheckIds) {
      const status = resultsByCheck.get(checkId);
      if (!status || (status !== 'passed' && status !== 'skipped')) {
        return false;
      }
    }

    // Load approvals for this run — any pending approval blocks completion
    const { data: approvals, error: approvalsErr } = await supabase
      .from('task_run_approvals')
      .select('status')
      .eq('run_id', runId);

    if (approvalsErr) {
      console.error('canTaskRunMarkComplete approvals error:', approvalsErr);
      return false;
    }

    for (const approval of approvals ?? []) {
      if (approval.status === 'pending') {
        return false;
      }
    }

    return true;
  } catch (err) {
    console.error('canTaskRunMarkComplete exception:', err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// 8. deriveTaskRunSummary
// ---------------------------------------------------------------------------
export async function deriveTaskRunSummary(runId: string): Promise<string | null> {
  try {
    // Load steps
    const { data: steps, error: stepsErr } = await supabase
      .from('task_run_steps')
      .select('step_index, step_kind, status, title, summary')
      .eq('run_id', runId)
      .order('step_index', { ascending: true });

    if (stepsErr) {
      console.error('deriveTaskRunSummary steps error:', stepsErr);
      return null;
    }

    // Load artifacts
    const { data: artifacts, error: artifactsErr } = await supabase
      .from('task_run_artifacts')
      .select('artifact_kind, label')
      .eq('run_id', runId);

    if (artifactsErr) {
      console.error('deriveTaskRunSummary artifacts error:', artifactsErr);
    }

    // Load check results
    const { data: checkResults, error: checkResultsErr } = await supabase
      .from('task_run_check_results')
      .select('status, check_id')
      .eq('run_id', runId);

    if (checkResultsErr) {
      console.error('deriveTaskRunSummary checkResults error:', checkResultsErr);
    }

    const lines: string[] = [];

    // Steps summary
    lines.push('## Steps');
    for (const step of steps ?? []) {
      const statusIcon = step.status === 'completed' ? '[done]' : step.status === 'running' ? '[running]' : `[${step.status}]`;
      lines.push(`${step.step_index}. ${statusIcon} ${step.title}${step.summary ? ' — ' + step.summary : ''}`);
    }

    // Artifacts summary
    if (artifacts && artifacts.length > 0) {
      lines.push('');
      lines.push('## Artifacts');
      for (const a of artifacts) {
        lines.push(`- ${a.artifact_kind}: ${a.label}`);
      }
    }

    // Check results summary
    if (checkResults && checkResults.length > 0) {
      lines.push('');
      lines.push('## Checks');
      const passed = checkResults.filter((r: any) => r.status === 'passed').length;
      const failed = checkResults.filter((r: any) => r.status === 'failed').length;
      const pending = checkResults.filter((r: any) => r.status === 'pending').length;
      lines.push(`Passed: ${passed}, Failed: ${failed}, Pending: ${pending}`);
    }

    return lines.join('\n');
  } catch (err) {
    console.error('deriveTaskRunSummary exception:', err);
    return null;
  }
}
