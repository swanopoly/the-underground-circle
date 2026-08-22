import {
  buildAssignedAgentSpiritPrompt,
  type AssignedAgentSpiritPromptResult,
  type SwanBotExactAgentTarget,
} from '../../../src/lib/agentSpiritPromptCore.ts';

type SupabaseEdgeClient = any;

type AgentSpiritContextErrorCode =
  | 'target_agent_not_found'
  | 'target_agent_context_unavailable'
  | 'assigned_spirit_unavailable';

export type ExactAgentSpiritContext = {
  exactTarget: boolean;
  canonicalAgentName: string | null;
  spiritId: string | null;
  spiritPrompt: string | null;
  currentGoal: string | null;
};

export type ExactAgentSpiritContextResult =
  | { ok: true; context: ExactAgentSpiritContext }
  | { ok: false; code: AgentSpiritContextErrorCode };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_LABEL_PATTERN = /^[^\u0000-\u001f\u007f]{1,180}$/u;

function exactLabel(value: unknown): string | null {
  return typeof value === 'string'
    && value === value.trim()
    && SAFE_LABEL_PATTERN.test(value)
    ? value
    : null;
}

function customProfileIdForSpirit(spiritId: string): string | null {
  if (!spiritId.startsWith('custom::')) return null;
  const id = spiritId.slice('custom::'.length);
  return UUID_PATTERN.test(id) && id === id.toLowerCase() ? id : null;
}

async function readCustomProfilePrompt(
  supabase: SupabaseEdgeClient,
  ownerId: string,
  spiritId: string,
  expectedProfileId?: string | null,
): Promise<AssignedAgentSpiritPromptResult | null> {
  const profileId = customProfileIdForSpirit(spiritId);
  if (!profileId || (expectedProfileId && expectedProfileId !== profileId)) return null;
  const { data, error } = await supabase
    .from('custom_agent_profiles')
    .select('id,user_id,system_prompt,skill_bundle,risk_tier,action_posture,evidence_posture,communication_density,skepticism,escalation_trigger')
    .eq('id', profileId)
    .eq('user_id', ownerId)
    .maybeSingle();
  if (error || !data) return null;
  return buildAssignedAgentSpiritPrompt({
    spiritId,
    customProfile: data,
    expectedCustomProfileId: profileId,
    expectedOwnerId: ownerId,
  });
}

async function resolvePrompt(
  supabase: SupabaseEdgeClient,
  ownerId: string,
  spiritId: unknown,
  expectedProfileId?: string | null,
): Promise<AssignedAgentSpiritPromptResult | null> {
  if (typeof spiritId === 'string' && spiritId.startsWith('custom::')) {
    return readCustomProfilePrompt(supabase, ownerId, spiritId, expectedProfileId);
  }
  return buildAssignedAgentSpiritPrompt({ spiritId });
}

/**
 * Resolve only an immutable Chat target. An Office UUID is read by
 * id+circle+published state; a private/local identity is read by exact current
 * owner+session key. Display names are never used as a lookup key here.
 */
export async function resolveExactAgentSpiritContext(
  supabase: SupabaseEdgeClient,
  args: {
    circleId: string;
    userId: string;
    target: SwanBotExactAgentTarget;
  },
): Promise<ExactAgentSpiritContextResult> {
  if (args.target.dbId) {
    const { data: officeAgent, error } = await supabase
      .from('circle_office_agents')
      .select('id,circle_id,owner_id,name,spirit,current_goal,is_published')
      .eq('id', args.target.dbId)
      .eq('circle_id', args.circleId)
      .eq('is_published', true)
      .maybeSingle();
    if (error) return { ok: false, code: 'target_agent_context_unavailable' };
    if (
      !officeAgent
      || String(officeAgent.id || '').toLowerCase() !== args.target.dbId
      || String(officeAgent.circle_id || '').toLowerCase() !== args.circleId.toLowerCase()
      || officeAgent.is_published !== true
      || !UUID_PATTERN.test(String(officeAgent.owner_id || ''))
    ) {
      return { ok: false, code: 'target_agent_not_found' };
    }
    const ownerId = String(officeAgent.owner_id).toLowerCase();
    // Published Office visibility does not make an owner's custom prompt
    // circle-readable. The service-role client bypasses RLS, so enforce the
    // owner boundary before issuing any private-profile query. A future shared
    // path must explicitly select and validate its sharing contract.
    if (
      typeof officeAgent.spirit === 'string'
      && officeAgent.spirit.startsWith('custom::')
      && ownerId !== args.userId.toLowerCase()
    ) {
      return { ok: false, code: 'assigned_spirit_unavailable' };
    }
    const prompt = await resolvePrompt(supabase, ownerId, officeAgent.spirit);
    if (!prompt || !prompt.ok) return { ok: false, code: 'assigned_spirit_unavailable' };
    return {
      ok: true,
      context: {
        exactTarget: true,
        canonicalAgentName: exactLabel(officeAgent.name),
        spiritId: prompt.spiritId,
        spiritPrompt: prompt.prompt,
        currentGoal: typeof officeAgent.current_goal === 'string' && officeAgent.current_goal.length <= 100_000
          ? officeAgent.current_goal
          : null,
      },
    };
  }

  if (args.target.sessionKey) {
    const { data: identity, error } = await supabase
      .from('agent_identities')
      .select('user_id,session_key,spirit_id,custom_profile_id')
      .eq('user_id', args.userId)
      .eq('session_key', args.target.sessionKey)
      .maybeSingle();
    if (error) return { ok: false, code: 'target_agent_context_unavailable' };
    if (!identity) {
      return {
        ok: true,
        context: {
          exactTarget: true,
          canonicalAgentName: null,
          spiritId: null,
          spiritPrompt: null,
          currentGoal: null,
        },
      };
    }
    if (
      String(identity.user_id || '').toLowerCase() !== args.userId.toLowerCase()
      || identity.session_key !== args.target.sessionKey
    ) {
      return { ok: false, code: 'target_agent_context_unavailable' };
    }
    const expectedProfileId = typeof identity.custom_profile_id === 'string'
      ? identity.custom_profile_id.toLowerCase()
      : null;
    const assignedSpiritId = typeof identity.spirit_id === 'string'
      ? identity.spirit_id
      : null;
    const assignedCustomProfileId = assignedSpiritId
      ? customProfileIdForSpirit(assignedSpiritId)
      : null;
    if (
      (assignedSpiritId?.startsWith('custom::') && (!assignedCustomProfileId || expectedProfileId !== assignedCustomProfileId))
      || (!assignedSpiritId?.startsWith('custom::') && expectedProfileId !== null)
    ) {
      return { ok: false, code: 'assigned_spirit_unavailable' };
    }
    const prompt = await resolvePrompt(
      supabase,
      args.userId.toLowerCase(),
      assignedSpiritId,
      expectedProfileId,
    );
    if (!prompt || !prompt.ok) return { ok: false, code: 'assigned_spirit_unavailable' };
    return {
      ok: true,
      context: {
        exactTarget: true,
        canonicalAgentName: null,
        spiritId: prompt.spiritId,
        spiritPrompt: prompt.prompt,
        currentGoal: null,
      },
    };
  }

  return {
    ok: true,
    context: {
      exactTarget: false,
      canonicalAgentName: null,
      spiritId: null,
      spiritPrompt: null,
      currentGoal: null,
    },
  };
}

export function exactAgentSpiritContextErrorResponse(code: AgentSpiritContextErrorCode): {
  status: number;
  code: AgentSpiritContextErrorCode;
  message: string;
} {
  if (code === 'target_agent_not_found') {
    return { status: 404, code, message: 'The exact published agent is unavailable in this circle.' };
  }
  if (code === 'assigned_spirit_unavailable') {
    return { status: 409, code, message: 'The assigned Spirit could not be resolved safely. Refresh the agent and retry.' };
  }
  return { status: 503, code, message: 'The exact agent context could not be verified. No model work was started.' };
}
