/**
 * automationChatBuilder — turn natural-language phrases into proposed
 * `circle_automations` rows.
 *
 * The parsing logic lives in `automationChatParser.ts` (RN-free so
 * Node smoketests can import it). This file re-exports the parser
 * surface and adds the supabase write path.
 */

import { supabase } from './supabase';
import type { AutomationProposal } from './automationChatParser';

export type { AutomationProposal } from './automationChatParser';
export {
  parseAutomationRequest,
  looksLikeAutomationRequest,
} from './automationChatParser';

/**
 * Insert the proposal as a new circle_automations row. Returns the
 * created row's id, or null on failure. Caller should toast on success.
 */
export async function createAutomationFromProposal(opts: {
  proposal: AutomationProposal;
  circleId: string;
  userId: string;
}): Promise<string | null> {
  const { proposal, circleId, userId } = opts;
  try {
    const row: any = {
      circle_id: circleId,
      created_by: userId,
      name: proposal.name,
      description: proposal.description,
      icon: '⚡',
      trigger_type: proposal.triggerType,
      agent: proposal.agent,
      prompt: proposal.prompt,
      output_target: proposal.outputTarget,
      enabled: true,
    };
    if (proposal.triggerType === 'schedule' && proposal.cronExpression) {
      row.cron_expression = proposal.cronExpression;
    }
    if (proposal.triggerType === 'event' && proposal.eventConfig) {
      row.event_config = proposal.eventConfig;
    }
    const { data, error } = await supabase
      .from('circle_automations')
      .insert(row)
      .select('id')
      .single();
    if (error) {
      console.warn('[automationChatBuilder] insert failed:', error.message);
      return null;
    }
    return (data as any)?.id || null;
  } catch (err) {
    console.warn('[automationChatBuilder] threw:', err);
    return null;
  }
}
