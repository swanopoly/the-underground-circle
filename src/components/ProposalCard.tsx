// ─── Proposal & Poll Card Component ─────────────────────────────────
// Renders inline in chat for voting/polling

import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import { Proposal, VoteSummary } from '../types';

interface Props {
  proposal: Proposal;
  currentUserId: string;
  accentColor: string;
  onVote: (proposalId: string, vote: string) => void;
  onResolve?: (proposalId: string) => void;
}

export default function ProposalCard({ proposal, currentUserId, accentColor, onVote, onResolve }: Props) {
  const [voting, setVoting] = useState(false);
  const summary = proposal.vote_summary;
  const myVote = proposal.votes?.find(v => v.user_id === currentUserId);
  const isExpired = proposal.expires_at ? new Date(proposal.expires_at) < new Date() : false;
  const isActive = proposal.status === 'active' && !isExpired;
  const isPoll = proposal.proposal_type === 'poll';
  const isCreator = proposal.created_by === currentUserId;

  const typeIcon = {
    general: '📜', rule_change: '⚖️', spending: '💰',
    challenge: '⚔️', member_action: '👤', poll: '📊',
  }[proposal.proposal_type] || '📜';

  const statusColor = {
    active: '#eab308', passed: '#22c55e', failed: '#ef4444', expired: '#6b7280',
  }[isExpired ? 'expired' : proposal.status] || '#6b7280';

  const statusLabel = isExpired ? 'EXPIRED' : proposal.status.toUpperCase();

  const handleVote = async (vote: string) => {
    setVoting(true);
    await onVote(proposal.id, vote);
    setVoting(false);
  };

  const timeLeft = () => {
    if (!proposal.expires_at) return '';
    const diff = new Date(proposal.expires_at).getTime() - Date.now();
    if (diff <= 0) return 'Expired';
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    return hours > 0 ? `${hours}h ${mins}m left` : `${mins}m left`;
  };

  return (
    <View style={[styles.card, { borderColor: accentColor + '30' }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.typeIcon}>{typeIcon}</Text>
        <View style={styles.headerInfo}>
          <Text style={styles.title}>{proposal.title}</Text>
          <Text style={styles.meta}>
            by {(proposal.creator as any)?.display_name || (proposal.creator as any)?.username || 'Unknown'} · {timeLeft()}
          </Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: statusColor + '20', borderColor: statusColor + '40' }]}>
          <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
        </View>
      </View>

      {proposal.description && (
        <Text style={styles.description}>{proposal.description}</Text>
      )}

      {/* Voting area */}
      {isPoll ? (
        // Poll options
        <View style={styles.options}>
          {(proposal.options || []).map((opt: any, i: number) => {
            const voteCount = summary?.options?.[String(i)] || 0;
            const totalVotes = summary?.total || 0;
            const pct = totalVotes > 0 ? Math.round((voteCount / totalVotes) * 100) : 0;
            const isMyVote = myVote?.vote === String(i);
            return (
              <Pressable
                key={i}
                onPress={() => isActive && !voting ? handleVote(String(i)) : null}
                disabled={!isActive || voting}
                style={[
                  styles.optionBtn,
                  isMyVote && { borderColor: accentColor, backgroundColor: accentColor + '15' },
                  !isActive && { opacity: 0.7 },
                  Platform.OS === 'web' && { cursor: isActive ? 'pointer' : 'default' } as any,
                ]}
              >
                <View style={[styles.optionBar, { width: `${pct}%` as any, backgroundColor: isMyVote ? accentColor + '25' : '#ffffff08' }]} />
                <View style={styles.optionContent}>
                  <Text style={[styles.optionLabel, isMyVote && { color: accentColor }]}>{opt.label}</Text>
                  <Text style={styles.optionCount}>{voteCount} ({pct}%)</Text>
                </View>
                {isMyVote && <Text style={styles.checkmark}>✓</Text>}
              </Pressable>
            );
          })}
        </View>
      ) : (
        // Yes/No voting
        <View style={styles.yesNoRow}>
          <Pressable
            onPress={() => isActive && !voting ? handleVote('yes') : null}
            disabled={!isActive || voting}
            style={[
              styles.voteBtn, styles.yesBtn,
              myVote?.vote === 'yes' && { backgroundColor: '#22c55e30', borderColor: '#22c55e' },
              Platform.OS === 'web' && { cursor: isActive ? 'pointer' : 'default' } as any,
            ]}
          >
            <Text style={[styles.voteBtnText, myVote?.vote === 'yes' && { color: '#22c55e' }]}>
              👍 YES {summary ? `(${summary.yes})` : ''}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => isActive && !voting ? handleVote('no') : null}
            disabled={!isActive || voting}
            style={[
              styles.voteBtn, styles.noBtn,
              myVote?.vote === 'no' && { backgroundColor: '#ef444430', borderColor: '#ef4444' },
              Platform.OS === 'web' && { cursor: isActive ? 'pointer' : 'default' } as any,
            ]}
          >
            <Text style={[styles.voteBtnText, myVote?.vote === 'no' && { color: '#ef4444' }]}>
              👎 NO {summary ? `(${summary.no})` : ''}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => isActive && !voting ? handleVote('abstain') : null}
            disabled={!isActive || voting}
            style={[
              styles.voteBtn,
              myVote?.vote === 'abstain' && { backgroundColor: '#eab30830', borderColor: '#eab308' },
              Platform.OS === 'web' && { cursor: isActive ? 'pointer' : 'default' } as any,
            ]}
          >
            <Text style={[styles.voteBtnText, myVote?.vote === 'abstain' && { color: '#eab308' }]}>
              🤷 ({summary?.abstain || 0})
            </Text>
          </Pressable>
        </View>
      )}

      {/* Footer: quorum progress + voter list */}
      {summary && (
        <View style={styles.footer}>
          <View style={styles.quorumRow}>
            <View style={styles.quorumBar}>
              <View style={[styles.quorumFill, {
                width: `${Math.min(100, (summary.total / summary.member_count) * 100)}%` as any,
                backgroundColor: summary.quorum_met ? '#22c55e' : '#eab308',
              }]} />
            </View>
            <Text style={styles.quorumText}>
              {summary.total}/{summary.member_count} voted
              {summary.quorum_met ? ' ✓ Quorum met' : ` (need ${Math.ceil(summary.member_count * (proposal.quorum_pct / 100))})`}
            </Text>
          </View>

          {/* Voter avatars */}
          {proposal.votes && proposal.votes.length > 0 && (
            <View style={styles.voterRow}>
              {proposal.votes.slice(0, 8).map((v, i) => (
                <View key={v.id} style={[styles.voterDot, {
                  backgroundColor: v.vote === 'yes' ? '#22c55e30' : v.vote === 'no' ? '#ef444430' : '#eab30830',
                  borderColor: v.vote === 'yes' ? '#22c55e' : v.vote === 'no' ? '#ef4444' : '#eab308',
                }]}>
                  <Text style={styles.voterText}>
                    {((v.user as any)?.display_name || (v.user as any)?.username || '?').charAt(0)}
                  </Text>
                </View>
              ))}
              {proposal.votes.length > 8 && (
                <Text style={styles.moreVoters}>+{proposal.votes.length - 8}</Text>
              )}
            </View>
          )}

          {/* Resolve button for creator */}
          {isCreator && isActive && summary.quorum_met && onResolve && (
            <Pressable
              onPress={() => onResolve(proposal.id)}
              style={[styles.resolveBtn, { backgroundColor: accentColor },
                Platform.OS === 'web' && { cursor: 'pointer' } as any]}
            >
              <Text style={styles.resolveBtnText}>⚡ FINALIZE VOTE</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#0d0d14', borderWidth: 1, borderRadius: 14,
    padding: 16, gap: 12, marginVertical: 4,
  },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  typeIcon: { fontSize: 24, marginTop: 2 },
  headerInfo: { flex: 1, gap: 2 },
  title: { fontSize: 16, fontWeight: '800', color: '#eee', fontFamily: 'monospace' },
  meta: { fontSize: 12, color: '#888', fontFamily: 'monospace' },
  statusBadge: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, borderWidth: 1,
  },
  statusText: { fontSize: 10, fontWeight: '800', fontFamily: 'monospace', letterSpacing: 0.5 },
  description: { fontSize: 14, color: '#aaa', lineHeight: 20 },

  // Poll options
  options: { gap: 6 },
  optionBtn: {
    borderWidth: 1, borderColor: '#1a1a2e', borderRadius: 10,
    overflow: 'hidden', position: 'relative', minHeight: 48,
    justifyContent: 'center',
  },
  optionBar: {
    position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 9,
  },
  optionContent: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 12, zIndex: 1,
  },
  optionLabel: { fontSize: 14, color: '#ccc', fontWeight: '600' },
  optionCount: { fontSize: 13, color: '#888', fontFamily: 'monospace' },
  checkmark: { position: 'absolute', right: 14, color: '#22c55e', fontSize: 16, fontWeight: '800' },

  // Yes/No buttons
  yesNoRow: { flexDirection: 'row', gap: 8 },
  voteBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1,
    borderColor: '#1a1a2e', alignItems: 'center', minHeight: 48,
    justifyContent: 'center',
  },
  yesBtn: { backgroundColor: '#22c55e08' },
  noBtn: { backgroundColor: '#ef444408' },
  voteBtnText: { fontSize: 14, fontWeight: '700', color: '#888', fontFamily: 'monospace' },

  // Footer
  footer: { gap: 8 },
  quorumRow: { gap: 4 },
  quorumBar: {
    height: 4, backgroundColor: '#1a1a2e', borderRadius: 2, overflow: 'hidden',
  },
  quorumFill: { height: '100%', borderRadius: 2 },
  quorumText: { fontSize: 11, color: '#666', fontFamily: 'monospace' },
  voterRow: { flexDirection: 'row', gap: 4, alignItems: 'center' },
  voterDot: {
    width: 24, height: 24, borderRadius: 12, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  voterText: { fontSize: 10, color: '#ccc', fontWeight: '800' },
  moreVoters: { fontSize: 11, color: '#666', fontFamily: 'monospace', marginLeft: 4 },
  resolveBtn: {
    paddingVertical: 10, borderRadius: 8, alignItems: 'center', marginTop: 4,
  },
  resolveBtnText: { fontSize: 12, color: '#fff', fontWeight: '800', fontFamily: 'monospace', letterSpacing: 1 },
});
