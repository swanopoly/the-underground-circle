/**
 * AutomationProposalCard — preview of an automation parsed from chat.
 *
 * User typed something like "every Friday at 5pm post a weekly summary"
 * → automationChatBuilder.parseAutomationRequest produced an
 * AutomationProposal → this card renders the proposal with name,
 * schedule, prompt, and a CREATE button. Nothing hits the database
 * until the user explicitly approves.
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View, Platform } from 'react-native';
import type { AutomationProposal } from '../../../../lib/automationChatBuilder';
import { createAutomationFromProposal } from '../../../../lib/automationChatBuilder';

interface Props {
  proposal: AutomationProposal;
  circleId: string;
  userId: string;
  accentColor?: string;
}

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

export default function AutomationProposalCard({ proposal, circleId, userId, accentColor = '#f59e0b' }: Props) {
  const [status, setStatus] = useState<'pending' | 'creating' | 'created' | 'failed'>('pending');
  const [error, setError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);

  const handleCreate = async () => {
    if (status !== 'pending') return;
    setStatus('creating');
    const id = await createAutomationFromProposal({ proposal, circleId, userId });
    if (id) {
      setCreatedId(id);
      setStatus('created');
    } else {
      setError('Failed to create automation. Make sure you have circle-member permission.');
      setStatus('failed');
    }
  };

  const handleDismiss = () => setStatus('failed'); // visually equivalent to "won't act"

  return (
    <View style={[s.card, { borderColor: accentColor + '40' }]} nativeID="section-automation-proposal">
      <View style={s.header}>
        <Text style={[s.kicker, { color: accentColor }]}>AUTOMATION PROPOSAL</Text>
        {proposal.confidence < 0.7 ? (
          <Text style={s.lowConfidence}>low confidence</Text>
        ) : null}
      </View>

      <Text style={s.name}>{proposal.name}</Text>

      <View style={s.row}>
        <Text style={s.label}>WHEN</Text>
        <Text style={s.value}>
          {proposal.triggerType === 'schedule'
            ? proposal.scheduleSummary
            : `When ${proposal.eventConfig?.event} on \`${proposal.eventConfig?.table}\``}
        </Text>
      </View>

      <View style={s.row}>
        <Text style={s.label}>DO</Text>
        <Text style={s.value} numberOfLines={4}>{proposal.prompt}</Text>
      </View>

      <View style={s.row}>
        <Text style={s.label}>WHO</Text>
        <Text style={s.value}>{proposal.agent}</Text>
      </View>

      <View style={s.row}>
        <Text style={s.label}>WHERE</Text>
        <Text style={s.value}>{proposal.outputTarget === 'activity' ? 'circle activity feed' : proposal.outputTarget}</Text>
      </View>

      {proposal.cronExpression ? (
        <Text style={s.cronHint}>cron: <Text style={s.cron}>{proposal.cronExpression}</Text> (UTC)</Text>
      ) : null}

      {status === 'pending' ? (
        <View style={s.actionRow}>
          <Pressable
            onPress={handleCreate}
            style={({ pressed }) => [s.createBtn, { borderColor: accentColor, backgroundColor: accentColor + (pressed ? '30' : '15') }]}
          >
            <Text style={[s.createBtnText, { color: accentColor }]}>CREATE AUTOMATION</Text>
          </Pressable>
          <Pressable onPress={handleDismiss} style={s.dismissBtn}>
            <Text style={s.dismissText}>DISMISS</Text>
          </Pressable>
        </View>
      ) : status === 'creating' ? (
        <Text style={s.status}>CREATING…</Text>
      ) : status === 'created' ? (
        <View style={s.successRow}>
          <Text style={[s.status, { color: '#22c55e' }]}>✓ AUTOMATION CREATED</Text>
          {createdId ? <Text style={s.successHint}>id {createdId.slice(0, 8)} · enabled, will fire on schedule</Text> : null}
        </View>
      ) : (
        <Text style={[s.status, { color: '#ef4444' }]}>{error || 'Dismissed'}</Text>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: '#0a0f1c',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    gap: 8,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  kicker: { fontSize: 9, fontWeight: '900', letterSpacing: 1.5, fontFamily: MONO },
  lowConfidence: { fontSize: 9, color: '#94a3b8', fontFamily: MONO },
  name: { color: '#f0f0f5', fontSize: 16, fontWeight: '800' },
  row: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  label: {
    color: '#64748b', fontSize: 9, fontWeight: '900', letterSpacing: 1,
    fontFamily: MONO, width: 56, paddingTop: 1,
  },
  value: { flex: 1, color: '#cbd5e1', fontSize: 12, lineHeight: 17 },
  cronHint: { color: '#64748b', fontSize: 10, fontFamily: MONO },
  cron: { color: '#94a3b8' },
  actionRow: { flexDirection: 'row', gap: 6, marginTop: 4 },
  createBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 8,
    borderRadius: 6, borderWidth: 1,
  },
  createBtnText: {
    fontSize: 11, fontWeight: '900', letterSpacing: 1, fontFamily: MONO,
  },
  dismissBtn: {
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 6, borderWidth: 1, borderColor: '#334155',
    backgroundColor: '#0f172a',
  },
  dismissText: {
    color: '#94a3b8', fontSize: 11, fontWeight: '800',
    letterSpacing: 0.8, fontFamily: MONO,
  },
  status: { fontSize: 11, fontWeight: '900', letterSpacing: 1, fontFamily: MONO, color: '#94a3b8' },
  successRow: { gap: 2 },
  successHint: { color: '#475569', fontSize: 10, fontFamily: MONO },
});
