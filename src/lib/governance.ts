// ─── DAO Governance Service ──────────────────────────────────────────
// Proposals, voting, polls, and pinned messages for circles

import { supabase } from './supabase';
import { safeGetUser } from './authSession';
import { Proposal, ProposalVote, VoteSummary, PinnedMessage, ProposalType } from '../types';

// ─── Proposals ──────────────────────────────────────────────────────

export async function createProposal(params: {
  circleId: string;
  title: string;
  description?: string;
  proposalType: ProposalType;
  options?: string[]; // for polls
  expiresInHours?: number;
  quorumPct?: number;
  passPct?: number;
}): Promise<{ ok: boolean; proposal?: Proposal; error?: string }> {
  const { value: user } = await safeGetUser();
  if (!user) return { ok: false, error: 'Not logged in' };

  const expiresAt = params.expiresInHours
    ? new Date(Date.now() + params.expiresInHours * 60 * 60 * 1000).toISOString()
    : new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(); // default 48h

  const options = params.proposalType === 'poll' && params.options
    ? params.options.map(label => ({ label }))
    : [];

  const { data, error } = await supabase.from('proposals').insert({
    circle_id: params.circleId,
    created_by: user.id,
    title: params.title,
    description: params.description || null,
    proposal_type: params.proposalType,
    options,
    quorum_pct: params.quorumPct || 50,
    pass_pct: params.passPct || 51,
    expires_at: expiresAt,
  }).select('*').single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, proposal: data };
}

export async function getProposals(circleId: string, status?: string): Promise<Proposal[]> {
  let query = supabase
    .from('proposals')
    .select('*')
    .eq('circle_id', circleId)
    .order('created_at', { ascending: false });

  if (status) query = query.eq('status', status);

  const { data, error } = await query.limit(50);
  if (error || !data) return [];

  // Get votes for each proposal
  const proposalIds = data.map(p => p.id);
  const { data: votes } = proposalIds.length > 0
    ? await supabase
        .from('proposal_votes')
        .select('*, user:profiles!user_id(username, display_name)')
        .in('proposal_id', proposalIds)
    : { data: [] };

  // Get member count
  const { count: memberCount } = await supabase
    .from('circle_members')
    .select('*', { count: 'exact', head: true })
    .eq('circle_id', circleId);

  return data.map(p => {
    const pVotes = (votes || []).filter(v => v.proposal_id === p.id);
    return {
      ...p,
      votes: pVotes,
      vote_summary: computeVoteSummary(pVotes, p, memberCount || 1),
    };
  });
}

export async function getProposal(proposalId: string): Promise<Proposal | null> {
  const { data, error } = await supabase
    .from('proposals')
    .select('*')
    .eq('id', proposalId)
    .single();

  if (error || !data) return null;

  const { data: votes } = await supabase
    .from('proposal_votes')
    .select('*, user:profiles!user_id(username, display_name)')
    .eq('proposal_id', proposalId);

  const { count: memberCount } = await supabase
    .from('circle_members')
    .select('*', { count: 'exact', head: true })
    .eq('circle_id', data.circle_id);

  return {
    ...data,
    votes: votes || [],
    vote_summary: computeVoteSummary(votes || [], data, memberCount || 1),
  };
}

export async function castVote(proposalId: string, vote: string): Promise<{ ok: boolean; error?: string }> {
  const { value: user } = await safeGetUser();
  if (!user) return { ok: false, error: 'Not logged in' };

  // Check if proposal is still active
  const { data: proposal } = await supabase
    .from('proposals')
    .select('status, expires_at')
    .eq('id', proposalId)
    .single();

  if (!proposal) return { ok: false, error: 'Proposal not found' };
  if (proposal.status !== 'active') return { ok: false, error: 'Proposal is no longer active' };
  if (proposal.expires_at && new Date(proposal.expires_at) < new Date()) {
    return { ok: false, error: 'Proposal has expired' };
  }

  // Upsert vote (allows changing your vote)
  const { error } = await supabase.from('proposal_votes').upsert({
    proposal_id: proposalId,
    user_id: user.id,
    vote,
  }, { onConflict: 'proposal_id,user_id' });

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function resolveProposal(proposalId: string): Promise<{ ok: boolean; status?: string; error?: string }> {
  const proposal = await getProposal(proposalId);
  if (!proposal) return { ok: false, error: 'Not found' };
  if (!proposal.vote_summary) return { ok: false, error: 'No votes' };

  const status = proposal.vote_summary.passed ? 'passed' : 'failed';

  const { error } = await supabase
    .from('proposals')
    .update({ status, resolved_at: new Date().toISOString() })
    .eq('id', proposalId);

  if (error) return { ok: false, error: error.message };
  return { ok: true, status };
}

function computeVoteSummary(votes: ProposalVote[], proposal: any, memberCount: number): VoteSummary {
  const total = votes.length;
  const yes = votes.filter(v => v.vote === 'yes').length;
  const no = votes.filter(v => v.vote === 'no').length;
  const abstain = votes.filter(v => v.vote === 'abstain').length;

  // For polls, count by option index
  const options: Record<string, number> = {};
  if (proposal.proposal_type === 'poll' && proposal.options) {
    proposal.options.forEach((_: any, i: number) => {
      options[String(i)] = votes.filter(v => v.vote === String(i)).length;
    });
  }

  const quorumNeeded = Math.ceil(memberCount * (proposal.quorum_pct || 50) / 100);
  const quorum_met = total >= quorumNeeded;

  // For yes/no proposals
  const yesPercent = total > 0 ? (yes / total) * 100 : 0;
  const passed = quorum_met && yesPercent >= (proposal.pass_pct || 51);

  return { total, yes, no, abstain, options, quorum_met, passed, member_count: memberCount };
}

// ─── Pinned Messages ────────────────────────────────────────────────

export async function pinMessage(circleId: string, messageId: string): Promise<{ ok: boolean; error?: string }> {
  const { value: user } = await safeGetUser();
  if (!user) return { ok: false, error: 'Not logged in' };

  const { error } = await supabase.from('pinned_messages').insert({
    circle_id: circleId,
    message_id: messageId,
    pinned_by: user.id,
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function unpinMessage(circleId: string, messageId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from('pinned_messages')
    .delete()
    .eq('circle_id', circleId)
    .eq('message_id', messageId);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function getPinnedMessages(circleId: string): Promise<PinnedMessage[]> {
  const { data, error } = await supabase
    .from('pinned_messages')
    .select('*, message:messages(content, user:profiles!user_id(display_name))')
    .eq('circle_id', circleId)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error || !data) return [];
  return data.map((p: any) => ({
    ...p,
    message_content: p.message?.content,
    pinned_by_name: p.message?.user?.display_name,
  }));
}

// ─── Quick Polls (simplified proposal creation) ─────────────────────

export async function createQuickPoll(circleId: string, question: string, options: string[], hoursToExpire = 24) {
  return createProposal({
    circleId,
    title: question,
    proposalType: 'poll',
    options,
    expiresInHours: hoursToExpire,
    quorumPct: 30, // Lower quorum for casual polls
  });
}

export async function createYesNoProposal(circleId: string, title: string, description?: string, hoursToExpire = 48) {
  return createProposal({
    circleId,
    title,
    description,
    proposalType: 'general',
    expiresInHours: hoursToExpire,
  });
}
