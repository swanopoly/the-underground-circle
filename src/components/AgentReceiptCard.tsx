import React from 'react';
import { View, Text, Pressable, Platform, Linking } from 'react-native';
import {
  describeApproval,
  describeRiskTier,
  describeVerdict,
  type AgentReceipt,
  type AgentReceiptProof,
} from '../lib/agentReceipt';

/**
 * AgentReceiptCard — the product's SIGNATURE accountability UI. One at-a-glance
 * card answering "what did the agent do → who approved → proof → verified?"
 * from the receipt the pure assembler (src/lib/agentReceipt.ts) built. Purely
 * presentational; surfaces Undo/Retry ONLY when the receipt allows AND a
 * callback was supplied (it owns no undo logic — buttons just call back).
 */

type Props = {
  receipt: AgentReceipt;
  /** Wired only when the caller can undo this turn; button hidden otherwise. */
  onUndo?: () => void;
  /** Wired only when the caller can retry this turn; button hidden otherwise. */
  onRetry?: () => void;
  /** Tap a proof ref (URL / id). Falls back to Linking.openURL for http(s). */
  onOpenProof?: (proof: AgentReceiptProof) => void;
};

const TONE_COLOR: Record<string, string> = {
  green: '#22c55e',
  blue: '#3b82f6',
  amber: '#f59e0b',
  red: '#ef4444',
  neutral: '#94a3b8',
};

const PROOF_ICON: Record<AgentReceiptProof['kind'], string> = {
  artifact: '📄',
  screenshot: '🖼️',
  file: '🗂️',
  link: '🔗',
  receipt: '🧾',
  measurement: '📐',
};

export default function AgentReceiptCard({ receipt, onUndo, onRetry, onOpenProof }: Props) {
  const risk = describeRiskTier(receipt.riskTier);
  const verdict = describeVerdict(receipt.verdict);
  const approval = describeApproval(receipt.approval);
  const riskColor = TONE_COLOR[risk.tone] || TONE_COLOR.neutral;
  const verdictColor = TONE_COLOR[verdict.tone] || TONE_COLOR.neutral;
  const approvalColor = TONE_COLOR[approval.tone] || TONE_COLOR.neutral;
  const showRisk = receipt.riskTier !== null
    && !(
      receipt.riskTier === 'read'
      && (receipt.verdict === 'blocked' || receipt.verdict === 'failed')
      && receipt.proof.length === 0
    );
  const showApproval = receipt.approval.state !== 'not_required';
  const showUndo = receipt.canUndo && typeof onUndo === 'function';
  const showRetry = receipt.canRetry && typeof onRetry === 'function';

  const openProof = (proof: AgentReceiptProof) => {
    if (onOpenProof) return onOpenProof(proof);
    if (proof.ref && /^https?:\/\//i.test(proof.ref)) void Linking.openURL(proof.ref).catch(() => {});
  };

  const summaryLabel =
    `Receipt: ${receipt.action}.` +
    (showRisk ? ` ${risk.label} risk.` : '') +
    (showApproval ? ` ${approval.label}.` : '') +
    ` ${verdict.label}.` +
    (receipt.proof.length ? ` ${receipt.proof.length} proof item${receipt.proof.length === 1 ? '' : 's'}.` : '');

  return (
    <View
      accessible
      accessibilityLabel={summaryLabel}
      style={{
        marginTop: 8,
        borderWidth: 1,
        borderColor: '#2a2a2a',
        borderLeftWidth: 3,
        borderLeftColor: verdictColor,
        borderRadius: 8,
        backgroundColor: '#141414',
        paddingHorizontal: 12,
        paddingVertical: 10,
        gap: 8,
      }}
    >
      {/* Header: label + verdict badge */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Text style={{ color: '#6b7280', fontSize: 9, fontWeight: '800', letterSpacing: 1, fontFamily: 'monospace' }}>
          RECEIPT
        </Text>
        <View style={{ borderWidth: 1, borderColor: `${verdictColor}66`, backgroundColor: `${verdictColor}18`, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
          <Text style={{ color: verdictColor, fontSize: 9, fontWeight: '800', letterSpacing: 0.5 }}>{verdict.label.toUpperCase()}</Text>
        </View>
      </View>

      {/* Action line */}
      <Text style={{ color: '#e5e7eb', fontSize: 13, fontWeight: '600' }} numberOfLines={2}>
        {receipt.action}
      </Text>

      {/* Risk chip + approval line */}
      {showRisk || showApproval ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          {showRisk ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: `${riskColor}55`, backgroundColor: `${riskColor}14`, borderRadius: 4, paddingHorizontal: 7, paddingVertical: 3 }}>
              <Text style={{ fontSize: 10 }}>{risk.icon}</Text>
              <Text style={{ color: riskColor, fontSize: 10, fontWeight: '700' }}>{risk.label}</Text>
            </View>
          ) : null}
          {showApproval ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: approvalColor }} />
              <Text style={{ color: approvalColor, fontSize: 11, fontWeight: '600' }} numberOfLines={1}>{approval.label}</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* Proof list */}
      {receipt.proof.length > 0 ? (
        <View style={{ gap: 4 }}>
          <Text style={{ color: '#6b7280', fontSize: 9, fontWeight: '800', letterSpacing: 1, fontFamily: 'monospace' }}>PROOF</Text>
          {receipt.proof.map((proof, index) => {
            const tappable = !!proof.ref;
            return (
              <Pressable
                key={`${proof.kind}-${index}`}
                disabled={!tappable}
                accessibilityRole={tappable ? 'link' : 'text'}
                accessibilityLabel={tappable ? `Open proof: ${proof.label}` : proof.label}
                onPress={tappable ? () => openProof(proof) : undefined}
                style={({ pressed }) => [
                  { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 2 },
                  tappable && pressed ? { opacity: 0.6 } : null,
                  tappable && Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : null,
                ]}
              >
                <Text style={{ fontSize: 11 }}>{PROOF_ICON[proof.kind] || '•'}</Text>
                <Text
                  style={{ color: tappable ? '#93c5fd' : '#cbd5e1', fontSize: 11, flexShrink: 1, textDecorationLine: tappable ? 'underline' : 'none' }}
                  numberOfLines={1}
                >
                  {proof.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {/* Undo / Retry — only when the receipt allows AND a callback exists */}
      {showUndo || showRetry ? (
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 2 }}>
          {showUndo ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Undo this action"
              onPress={onUndo}
              style={({ pressed }) => [
                { borderWidth: 1, borderColor: '#ef444455', backgroundColor: pressed ? '#ef444424' : '#1a1010', borderRadius: 4, paddingHorizontal: 10, paddingVertical: 5 },
                Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : null,
              ]}
            >
              <Text style={{ color: '#f87171', fontSize: 11, fontWeight: '700' }}>Undo</Text>
            </Pressable>
          ) : null}
          {showRetry ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry this action"
              onPress={onRetry}
              style={({ pressed }) => [
                { borderWidth: 1, borderColor: '#3b82f655', backgroundColor: pressed ? '#3b82f624' : '#0b1220', borderRadius: 4, paddingHorizontal: 10, paddingVertical: 5 },
                Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : null,
              ]}
            >
              <Text style={{ color: '#93c5fd', fontSize: 11, fontWeight: '700' }}>Retry</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
