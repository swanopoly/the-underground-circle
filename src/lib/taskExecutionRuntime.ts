// Task Execution Runtime — helpers for managing task run steps, artifacts, checks, and approvals

import { supabase } from './supabase';
import { getTaskCapabilityProfile, type TaskCapabilityProfileKey } from './taskCapabilityProfiles';
import { buildImpactDomainGuidance, getImpactDomain } from './impactDomains';
import {
  retrieveAgentMemories,
  retrieveTaskMemories,
  saveSoulAwareAgentMemory,
  saveSharedTaskMemory,
  promoteAgentMemoriesToSharedPatterns,
} from './memoryService';
import { buildTaskOwnershipClaim } from './circleIntegrations';

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
// 5. buildTaskExecutionMemoryBrief
// ---------------------------------------------------------------------------
export async function buildTaskExecutionMemoryBrief(opts: {
  circleId: string;
  userId: string;
  roomId?: string;
  taskId: string;
  title: string;
  description?: string;
  profileKey?: string;
  agentId?: string;
  agentName?: string;
}): Promise<string> {
  const sections: string[] = [];
  const profile = opts.profileKey ? getTaskCapabilityProfile(opts.profileKey) : undefined;
  const impactDomainKey = profile?.impactDomain;
  const query = [opts.title, opts.description || '', profile?.label || '', opts.profileKey || '']
    .filter(Boolean)
    .join(' ');
  const domainGuidance = buildImpactDomainGuidance({
    title: opts.title,
    description: opts.description,
    query,
    domainKey: profile?.impactDomain,
  });

  if (domainGuidance) {
    sections.push(domainGuidance);
  }

  try {
    const ownershipClaim = await buildTaskOwnershipClaim({
      circleId: opts.circleId,
      title: opts.title,
      description: opts.description,
      profileKey: opts.profileKey,
    });
    if (ownershipClaim.requiredConnectors.length > 0 || ownershipClaim.requiredCapabilities.length > 0) {
      sections.push(
        [
          `=== INTEGRATION PREFLIGHT ===`,
          ownershipClaim.requiredConnectors.length > 0 ? `Required connectors: ${ownershipClaim.requiredConnectors.join(', ')}` : '',
          ownershipClaim.requiredCapabilities.length > 0 ? `Required capabilities: ${ownershipClaim.requiredCapabilities.join(', ')}` : '',
          `Ownership: ${ownershipClaim.ownership.headline}`,
          ownershipClaim.ownership.level === 'full'
            ? `Status: All required integrations are available.`
            : `Status: Missing ${[
                ownershipClaim.missingConnectors.length > 0 ? `connectors (${ownershipClaim.missingConnectors.join(', ')})` : '',
                ownershipClaim.missingCapabilities.length > 0 ? `capabilities (${ownershipClaim.missingCapabilities.join(', ')})` : '',
              ].filter(Boolean).join(' and ')}.`,
          `Guidance: ${ownershipClaim.ownership.detail}`,
        ].filter(Boolean).join('\n')
      );
    }
  } catch {}

  try {
    const { retrieveRelevantMemories } = await import('./memoryService');
    const relevant = await retrieveRelevantMemories({
      circleId: opts.circleId,
      userId: opts.userId,
      roomId: opts.roomId,
      query,
      limit: 6,
    });
    if (relevant.length > 0) {
      sections.push(
        `=== RELEVANT MEMORY ===\n` +
        relevant.map(m => `- [${m.scope}/${m.memory_kind}] ${m.title}: ${m.content.slice(0, 180)}`).join('\n')
      );
    }
  } catch {}

  try {
    if (opts.agentId) {
      const relevantAgentMemories = await retrieveAgentMemories({
        circleId: opts.circleId,
        userId: opts.userId,
        agentId: opts.agentId,
        agentName: opts.agentName,
        types: ['agent_task_completion', 'agent_task_blocker'],
        limit: 4,
        query,
      });

      if (relevantAgentMemories.length > 0) {
        sections.push(
          `=== ${opts.agentName || 'AGENT'} SPECIALIZATION MEMORY ===\n` +
          relevantAgentMemories.map(row => `- ${String(row.content || '').slice(0, 220)}`).join('\n')
        );
      }
    }
  } catch {}

  try {
    const sharedPatterns = await retrieveTaskMemories({
      circleId: opts.circleId,
      userId: opts.userId,
      profileKey: opts.profileKey,
      impactDomain: impactDomainKey,
      taskId: opts.taskId,
      namespaces: ['task_shared_pattern'],
      limit: 3,
      query,
    });

    if (sharedPatterns.length > 0) {
      sections.push(
        `=== SHARED TASK PATTERNS ===\n` +
        sharedPatterns.map(row => `- ${String(row.content || '').slice(0, 220)}`).join('\n')
      );
    }
  } catch {}

  try {
    const { data: sameTaskRuns } = await supabase
      .from('task_runs')
      .select('id, summary, status, run_kind, output_payload, started_at, completed_at')
      .eq('task_id', opts.taskId)
      .order('started_at', { ascending: false })
      .limit(4);

    const resumableRuns = (sameTaskRuns || []).slice(0, 3);
    if (resumableRuns.length > 0) {
      const runIds = resumableRuns.map((run: any) => run.id).filter(Boolean);
      let snapshotsByRun = new Map<string, any>();

      if (runIds.length > 0) {
        const { data: snapshots } = await supabase
          .from('task_run_context_snapshots')
          .select('task_run_id, summary, blockers, next_actions, artifacts_snapshot, deliverable_excerpt, created_at')
          .in('task_run_id', runIds)
          .order('checkpoint_index', { ascending: false });

        for (const snapshot of snapshots || []) {
          if (!snapshotsByRun.has(snapshot.task_run_id)) {
            snapshotsByRun.set(snapshot.task_run_id, snapshot);
          }
        }
      }

      sections.push(
        `=== TASK RESUME CONTEXT ===\n` +
        resumableRuns.map((run: any, index: number) => {
          const output = run.output_payload || {};
          const snapshot = snapshotsByRun.get(run.id) || output.resume_snapshot || {};
          const blockers = Array.isArray(snapshot.blockers)
            ? snapshot.blockers.filter(Boolean).slice(0, 3)
            : Array.isArray(output.blockers) ? output.blockers.filter(Boolean).slice(0, 3) : [];
          const nextActions = Array.isArray(snapshot.next_actions)
            ? snapshot.next_actions.filter(Boolean).slice(0, 3)
            : Array.isArray(output.next_actions) ? output.next_actions.filter(Boolean).slice(0, 3) : [];
          const artifactList = Array.isArray(snapshot.artifacts_snapshot)
            ? snapshot.artifacts_snapshot.map((artifact: any) => artifact?.label || artifact?.name || artifact?.type).filter(Boolean).slice(0, 4)
            : Array.isArray(snapshot.artifacts) ? snapshot.artifacts.slice(0, 4) : [];
          return [
            `- Prior run ${index + 1}: ${run.run_kind || 'execute'} / ${run.status || 'unknown'}`,
            snapshot.summary
              ? `  Summary: ${String(snapshot.summary).slice(0, 180)}`
              : run.summary ? `  Summary: ${String(run.summary).slice(0, 180)}` : '',
            blockers.length > 0 ? `  Blockers: ${blockers.join('; ')}` : '',
            nextActions.length > 0 ? `  Next actions: ${nextActions.join('; ')}` : '',
            artifactList.length > 0
              ? `  Artifacts: ${artifactList.join(', ')}`
              : '',
            snapshot.deliverable_excerpt ? `  Deliverable: ${String(snapshot.deliverable_excerpt).slice(0, 160)}` : '',
          ].filter(Boolean).join('\n');
        }).join('\n')
      );
    }
  } catch {}

  try {
    const { data: runs } = await supabase
      .from('task_runs')
      .select('id, task_id, summary, status, run_kind, input_payload, output_payload, artifact_refs, model_used, completed_at, created_at')
      .eq('circle_id', opts.circleId)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(20);

    const ranked = (runs || [])
      .filter((run: any) => run.task_id !== opts.taskId)
      .map((run: any) => {
        const snapshot = run.input_payload?.task_snapshot || {};
        const title = String(snapshot.title || '');
        const description = String(snapshot.description || '');
        const profileKey = String(snapshot.capability_profile_key || run.input_payload?.profileKey || '');
        const haystack = `${title} ${description} ${run.summary || ''} ${profileKey}`.toLowerCase();
        const needles = [
          opts.profileKey || '',
          profile?.label || '',
          ...[opts.title, opts.description || ''].flatMap(text =>
            String(text)
              .toLowerCase()
              .split(/[^a-z0-9]+/)
              .filter(token => token.length > 4)
              .slice(0, 6)
          ),
        ]
          .map(v => String(v).toLowerCase().trim())
          .filter(Boolean);
        const matches = Array.from(new Set(needles)).filter(needle => haystack.includes(needle)).length;
        return { run, title, profileKey, matches };
      })
      .filter(item => item.matches > 0)
      .sort((a, b) => b.matches - a.matches)
      .slice(0, 3);

    if (ranked.length > 0) {
      sections.push(
        `=== SIMILAR COMPLETED TASKS ===\n` +
        ranked.map(({ run, title, profileKey }) => {
          const artifactKinds = Array.isArray(run.artifact_refs)
            ? run.artifact_refs.map((ref: any) => ref?.type || ref?.kind).filter(Boolean).slice(0, 4).join(', ')
            : '';
          const outcome = run.output_payload?.summary || run.summary || '';
          return [
            `- ${title || 'Past task'}${profileKey ? ` [${profileKey}]` : ''}`,
            outcome ? `  Outcome: ${String(outcome).slice(0, 180)}` : '',
            artifactKinds ? `  Artifacts: ${artifactKinds}` : '',
          ].filter(Boolean).join('\n');
        }).join('\n')
      );
    }
  } catch {}

  try {
    const relevantBlockers = await retrieveTaskMemories({
      circleId: opts.circleId,
      userId: opts.userId,
      profileKey: opts.profileKey,
      impactDomain: impactDomainKey,
      taskId: opts.taskId,
      namespaces: ['task_blocker_pattern'],
      limit: 2,
      query,
    });

    if (relevantBlockers.length > 0) {
      sections.push(
        `=== AVOID THESE BLOCKERS ===\n` +
        relevantBlockers.map(row => `- ${String(row.content || '').slice(0, 220)}`).join('\n')
      );
    }
  } catch {}

  return sections.join('\n\n');
}

// ---------------------------------------------------------------------------
// 6. saveTaskCompletionMemory
// ---------------------------------------------------------------------------
export async function saveTaskCompletionMemory(opts: {
  circleId: string;
  userId: string;
  taskId: string;
  title: string;
  description?: string;
  profileKey?: string;
  agentId?: string;
  agentName?: string;
  summary?: string;
  deliverable?: string;
  artifacts?: Array<{ name?: string; type?: string; language?: string; url?: string }>;
}): Promise<void> {
  const profile = opts.profileKey ? getTaskCapabilityProfile(opts.profileKey) : undefined;
  const impactDomain = getImpactDomain(profile?.impactDomain);
  const artifactLabels = (opts.artifacts || [])
    .map(artifact => artifact.type || artifact.language || artifact.name)
    .filter(Boolean)
    .slice(0, 5);

  try {
    const { saveProceduralMemory } = await import('./memoryConsolidation');
    await saveProceduralMemory({
      circleId: opts.circleId,
      userId: opts.userId,
      taskType: profile?.label || opts.profileKey || 'task execution',
      outcome: 'success',
      steps: [
        `Review task: ${opts.title}`,
        profile ? `Use profile: ${profile.key}` : 'Use general execution flow',
        profile?.impactDomain ? `Work within impact domain: ${impactDomain.label}` : 'Work within general impact domain',
        artifactLabels.length > 0 ? `Produce artifacts: ${artifactLabels.join(', ')}` : 'Produce concrete deliverable',
        'Close with completion summary and next-state decision',
      ],
      learnings: [
        opts.summary ? `Summary: ${opts.summary}` : '',
        opts.description ? `Task shape: ${opts.description.slice(0, 160)}` : '',
        opts.deliverable ? `Deliverable preview: ${opts.deliverable.slice(0, 220)}` : '',
      ].filter(Boolean).join(' | '),
    });
  } catch {}

  try {
    const title = `Completed task pattern: ${opts.profileKey || 'general'}`;
    const content = [
      `Task: ${opts.title}`,
      profile ? `Capability profile: ${profile.label}` : '',
      profile?.impactDomain ? `Impact domain: ${impactDomain.label}` : '',
      opts.summary ? `What worked: ${opts.summary}` : '',
      artifactLabels.length > 0 ? `Useful artifacts: ${artifactLabels.join(', ')}` : '',
      opts.deliverable ? `Deliverable excerpt: ${opts.deliverable.slice(0, 260)}` : '',
    ].filter(Boolean).join('\n');

    await saveSharedTaskMemory({
      circleId: opts.circleId,
      userId: opts.userId,
      title,
      content,
      source: 'task_completion',
      profileKey: opts.profileKey,
      taskId: opts.taskId,
      agentId: opts.agentId,
      agentName: opts.agentName,
      importance: 0.72,
      impactDomain: profile?.impactDomain,
      excerpt: opts.summary || opts.deliverable || opts.title,
      evaluationScore: 0.84,
      feedback: 'Successful task completion pattern captured from feed execution.',
      namespace: 'task_shared_pattern',
      sourceType: 'manual',
    });
  } catch {}

  if (opts.agentId) {
    try {
      await saveSoulAwareAgentMemory({
        circleId: opts.circleId,
        userId: opts.userId,
        agentId: opts.agentId,
        agentName: opts.agentName,
        title: `Agent pattern: ${opts.agentName || opts.agentId}`,
        content: [
          `Agent: ${opts.agentName || opts.agentId}`,
          profile ? `Preferred task type: ${profile.label}` : '',
          profile?.impactDomain ? `Impact domain: ${impactDomain.label}` : '',
          opts.summary ? `Effective approach: ${opts.summary}` : '',
          artifactLabels.length > 0 ? `Typical outputs: ${artifactLabels.join(', ')}` : '',
          opts.deliverable ? `Representative deliverable: ${opts.deliverable.slice(0, 220)}` : '',
        ].filter(Boolean).join('\n'),
        source: 'agent_task_completion',
        profileKey: opts.profileKey,
        impactDomain: profile?.impactDomain,
        taskId: opts.taskId,
        importance: 0.74,
        excerpt: opts.summary || opts.deliverable || opts.title,
        evaluationScore: 0.86,
        feedback: 'Private agent specialization memory from successful feed execution.',
        namespace: 'agent_private_pattern',
        sourceType: 'manual',
      });
      await promoteAgentMemoriesToSharedPatterns({
        circleId: opts.circleId,
        userId: opts.userId,
        agentId: opts.agentId,
        agentName: opts.agentName,
        profileKey: opts.profileKey,
        kind: 'success',
      });
    } catch {}
  }
}

export async function saveTaskBlockerMemory(opts: {
  circleId: string;
  userId: string;
  taskId: string;
  title: string;
  description?: string;
  profileKey?: string;
  agentId?: string;
  agentName?: string;
  blockers?: string[];
  nextActions?: string[];
  summary?: string;
}): Promise<void> {
  const profile = opts.profileKey ? getTaskCapabilityProfile(opts.profileKey) : undefined;
  const impactDomain = getImpactDomain(profile?.impactDomain);
  const blockerLines = (opts.blockers || []).map(b => b.trim()).filter(Boolean).slice(0, 5);
  const nextActionLines = (opts.nextActions || []).map(a => a.trim()).filter(Boolean).slice(0, 5);
  if (blockerLines.length === 0 && nextActionLines.length === 0 && !opts.summary) return;

  try {
    await saveSharedTaskMemory({
      circleId: opts.circleId,
      title: `Blocked task pattern: ${opts.profileKey || 'general'}`,
      content: [
        `Task: ${opts.title}`,
        opts.profileKey ? `Capability profile: ${opts.profileKey}` : '',
        profile?.impactDomain ? `Impact domain: ${impactDomain.label}` : '',
        opts.summary ? `Summary: ${opts.summary}` : '',
        blockerLines.length > 0 ? `Blockers:\n${blockerLines.map(line => `- ${line}`).join('\n')}` : '',
        nextActionLines.length > 0 ? `Next actions:\n${nextActionLines.map(line => `- ${line}`).join('\n')}` : '',
        opts.description ? `Task shape: ${opts.description.slice(0, 180)}` : '',
      ].filter(Boolean).join('\n'),
      userId: opts.userId,
      source: 'task_blocker',
      profileKey: opts.profileKey,
      taskId: opts.taskId,
      agentId: opts.agentId,
      agentName: opts.agentName,
      importance: 0.66,
      impactDomain: profile?.impactDomain,
      excerpt: opts.summary || blockerLines.join('; ') || opts.title,
      evaluationScore: blockerLines.length > 0 ? 0.76 : 0.68,
      feedback: 'Shared blocker pattern captured for future avoidance and recovery.',
      namespace: 'task_blocker_pattern',
      sourceType: 'manual',
    });
  } catch {}

  if (opts.agentId) {
    try {
      await saveSoulAwareAgentMemory({
        circleId: opts.circleId,
        userId: opts.userId,
        agentId: opts.agentId,
        agentName: opts.agentName,
        title: `Agent blocker: ${opts.agentName || opts.agentId}`,
        content: [
          `Agent: ${opts.agentName || opts.agentId}`,
          opts.profileKey ? `Task type: ${opts.profileKey}` : '',
          profile?.impactDomain ? `Impact domain: ${impactDomain.label}` : '',
          opts.summary ? `Failure mode: ${opts.summary}` : '',
          blockerLines.length > 0 ? `Watch for blockers: ${blockerLines.join('; ')}` : '',
          nextActionLines.length > 0 ? `Recovery steps: ${nextActionLines.join('; ')}` : '',
        ].filter(Boolean).join('\n'),
        source: 'agent_task_blocker',
        profileKey: opts.profileKey,
        impactDomain: profile?.impactDomain,
        taskId: opts.taskId,
        importance: 0.68,
        excerpt: opts.summary || blockerLines.join('; ') || opts.title,
        evaluationScore: blockerLines.length > 0 ? 0.8 : 0.7,
        feedback: 'Private agent blocker memory captured from failed or incomplete feed execution.',
        namespace: 'agent_private_blocker',
        sourceType: 'manual',
      });
      await promoteAgentMemoriesToSharedPatterns({
        circleId: opts.circleId,
        userId: opts.userId,
        agentId: opts.agentId,
        agentName: opts.agentName,
        profileKey: opts.profileKey,
        kind: 'blocker',
      });
    } catch {}
  }
}

export async function saveTaskRunResumeSnapshot(opts: {
  taskRunId: string;
  taskId?: string;
  circleId?: string;
  summary?: string;
  blockers?: string[];
  nextActions?: string[];
  artifacts?: Array<{ name?: string; type?: string; language?: string; url?: string }>;
  deliverable?: string;
}): Promise<void> {
  if (!opts.taskRunId) return;

  try {
    const { data: existing } = await supabase
      .from('task_runs')
      .select('output_payload')
      .eq('id', opts.taskRunId)
      .single();

    const outputPayload = existing?.output_payload || {};
    const artifactLabels = (opts.artifacts || [])
      .map(artifact => artifact.type || artifact.language || artifact.name)
      .filter(Boolean)
      .slice(0, 5);

    const resumeSnapshot = {
      summary: opts.summary || null,
      blockers: (opts.blockers || []).filter(Boolean).slice(0, 5),
      next_actions: (opts.nextActions || []).filter(Boolean).slice(0, 5),
      artifacts: artifactLabels,
      deliverable_excerpt: opts.deliverable ? opts.deliverable.slice(0, 280) : null,
      updated_at: new Date().toISOString(),
    };

    await supabase
      .from('task_runs')
      .update({
        output_payload: {
          ...outputPayload,
          resume_snapshot: resumeSnapshot,
        },
      })
      .eq('id', opts.taskRunId);

    if (opts.taskId && opts.circleId) {
      const { count } = await supabase
        .from('task_run_context_snapshots')
        .select('id', { count: 'exact', head: true })
        .eq('task_run_id', opts.taskRunId);

      await supabase
        .from('task_run_context_snapshots')
        .insert({
          task_run_id: opts.taskRunId,
          task_id: opts.taskId,
          circle_id: opts.circleId,
          checkpoint_index: count || 0,
          summary: resumeSnapshot.summary,
          blockers: resumeSnapshot.blockers,
          next_actions: resumeSnapshot.next_actions,
          artifacts_snapshot: (opts.artifacts || []).slice(0, 5).map(artifact => ({
            name: artifact.name || null,
            type: artifact.type || artifact.language || null,
            label: artifact.type || artifact.language || artifact.name || null,
            url: artifact.url || null,
          })),
          deliverable_excerpt: resumeSnapshot.deliverable_excerpt,
          source_step_count: Array.isArray(opts.blockers) ? opts.blockers.length : 0,
          compacted_step_count: Array.isArray(opts.nextActions) ? opts.nextActions.length : 0,
        });
    }
  } catch {}
}

export async function loadCollaborativeHandoffs(opts: {
  taskId: string;
  orchestratorRunId: string;
  agentId: string;
  limit?: number;
}): Promise<Array<{
  id: string;
  from_agent_name?: string | null;
  objective?: string | null;
  summary?: string | null;
  blockers: string[];
  next_actions: string[];
  deliverable_excerpt?: string | null;
}>> {
  const { data, error } = await supabase
    .from('task_run_handoffs')
    .select('id, from_agent_name, objective, summary, blockers, next_actions, deliverable_excerpt')
    .eq('task_id', opts.taskId)
    .eq('orchestrator_run_id', opts.orchestratorRunId)
    .eq('to_agent_id', opts.agentId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(opts.limit || 3);

  if (error) {
    console.warn('[taskExecutionRuntime] loadCollaborativeHandoffs failed:', error.message);
    return [];
  }

  return (data || []).map((row: any) => ({
    id: row.id,
    from_agent_name: row.from_agent_name || null,
    objective: row.objective || null,
    summary: row.summary || null,
    blockers: Array.isArray(row.blockers) ? row.blockers : [],
    next_actions: Array.isArray(row.next_actions) ? row.next_actions : [],
    deliverable_excerpt: row.deliverable_excerpt || null,
  }));
}

export async function markCollaborativeHandoffsConsumed(handoffIds: string[]): Promise<void> {
  if (!handoffIds.length) return;
  const { error } = await supabase
    .from('task_run_handoffs')
    .update({ status: 'consumed', consumed_at: new Date().toISOString() })
    .in('id', handoffIds)
    .eq('status', 'pending');
  if (error) {
    console.warn('[taskExecutionRuntime] markCollaborativeHandoffsConsumed failed:', error.message);
  }
}

export async function saveTaskRunHandoff(opts: {
  taskId: string;
  circleId: string;
  orchestratorRunId?: string | null;
  fromTaskRunId?: string | null;
  fromAgentId: string;
  fromAgentName?: string;
  toAgentId?: string | null;
  toAgentName?: string | null;
  objective?: string;
  summary?: string;
  blockers?: string[];
  nextActions?: string[];
  artifacts?: Array<{ name?: string; type?: string; language?: string; url?: string }>;
  deliverable?: string;
}): Promise<void> {
  if (!opts.toAgentId) return;
  const { error } = await supabase.from('task_run_handoffs').insert({
    task_id: opts.taskId,
    circle_id: opts.circleId,
    orchestrator_run_id: opts.orchestratorRunId || null,
    from_task_run_id: opts.fromTaskRunId || null,
    from_agent_id: opts.fromAgentId,
    from_agent_name: opts.fromAgentName || null,
    to_agent_id: opts.toAgentId,
    to_agent_name: opts.toAgentName || null,
    handoff_kind: 'collaboration',
    objective: opts.objective || null,
    summary: opts.summary || null,
    blockers: (opts.blockers || []).filter(Boolean).slice(0, 5),
    next_actions: (opts.nextActions || []).filter(Boolean).slice(0, 5),
    artifacts: (opts.artifacts || []).slice(0, 5).map(artifact => ({
      name: artifact.name || null,
      type: artifact.type || artifact.language || null,
      url: artifact.url || null,
    })),
    deliverable_excerpt: opts.deliverable ? opts.deliverable.slice(0, 280) : null,
  });
  if (error) {
    console.warn('[taskExecutionRuntime] saveTaskRunHandoff failed:', error.message);
  }
}

// ---------------------------------------------------------------------------
// 7. ensureTaskAcceptanceChecks
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

    // Load approvals for this run — pending OR rejected approvals block
    // completion
    const { data: approvals, error: approvalsErr } = await supabase
      .from('task_run_approvals')
      .select('status')
      .eq('run_id', runId);

    if (approvalsErr) {
      console.error('canTaskRunMarkComplete approvals error:', approvalsErr);
      return false;
    }

    for (const approval of approvals ?? []) {
      // 'pending' blocks (no human decision yet) and 'rejected' blocks (a
      // human explicitly denied the gated action — denial must not unblock
      // completion the way approval does). Only 'approved' — or 'expired',
      // which nothing writes today — lets the run finish. The query is
      // scoped to this run_id, so a rejected gate only pins this run; a
      // later fresh run starts with a clean slate of approvals.
      if (approval.status === 'pending' || approval.status === 'rejected') {
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
