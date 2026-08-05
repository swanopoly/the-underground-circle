/**
 * automationChatBuilder — turn natural-language phrases into proposed
 * `circle_automations` rows.
 *
 * The parsing logic lives in `automationChatParser.ts` (RN-free so
 * Node smoketests can import it). This file re-exports the parser
 * surface and adds the supabase write path.
 */

import { supabase } from './supabase';
import { buildAutomationProposalInsertRow } from './automationChatParser';
import type { AutomationProposal } from './automationChatParser';
import type { AgentRuntimeSubjectMetadata } from './agentRuntimeSubject';

export type { AutomationProposal } from './automationChatParser';
export {
  buildAutomationProposalInsertRow,
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
  agentSubjectMetadata?: AgentRuntimeSubjectMetadata | null;
}): Promise<string | null> {
  const { proposal, circleId, userId, agentSubjectMetadata } = opts;
  try {
    const row = buildAutomationProposalInsertRow({ proposal, circleId, userId, agentSubjectMetadata });
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
