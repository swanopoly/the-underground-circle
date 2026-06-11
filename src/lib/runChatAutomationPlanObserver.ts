/**
 * runChatAutomationPlanObserver — the production observer that stamps
 * `chatAutomationDecision` onto `agent_runs.metadata` for every
 * dispatch that created a run. Split out of `runChatAutomationPlan.ts`
 * so the pure dispatcher can be smoke-tested in Node without the
 * Supabase client pulling in React Native.
 *
 * Phase CA-6. Read side lives in `chatAutomationDecisions.ts`.
 */

import { supabase } from './supabase';
import { devLog } from './devLog';
import { persistAgentRunLedgerPreview } from './agentRunLedgerPersistence';
import { summarisePlanForTelemetry } from './chatAutomationPlanner';
import type { ChatAutomationObserver } from './runChatAutomationPlan';

export const attachPlanDecisionToRun: ChatAutomationObserver = async (plan, outcome, ctx) => {
  const runId = outcome.runId;
  if (!runId) {
    // Run-less dispatches (clarification, memory family, plan-mode refusals,
    // handler skips) have no agent_runs row to stamp — keep them visible on
    // the opt-in trace channel so C1 cutovers can be verified without a DB.
    devLog.trace('[chatAutomation] decision (no run)', {
      ...summarisePlanForTelemetry(plan),
      outcomeStatus: outcome.status,
      outcomeDurationMs: outcome.durationMs ?? null,
    });
    return;
  }
  try {
    const { data } = await supabase
      .from('agent_runs')
      .select('metadata')
      .eq('id', runId)
      .maybeSingle();
    const existing = (data?.metadata || {}) as Record<string, unknown>;
    await supabase
      .from('agent_runs')
      .update({
        metadata: {
          ...existing,
          chatAutomationDecision: {
            ...summarisePlanForTelemetry(plan),
            outcomeStatus: outcome.status,
            outcomeDurationMs: outcome.durationMs ?? null,
            approvalId: outcome.approvalId ?? null,
          },
        },
      })
      .eq('id', runId);
    await persistAgentRunLedgerPreview({
      preview: plan.ledgerPreview,
      actualRunId: runId,
      circleId: ctx.circleId,
      userId: ctx.userId,
      outcomeStatus: outcome.status,
      source: 'chat_automation_observer',
    });
  } catch {
    // telemetry only — never block the dispatcher
  }
};
