import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { ChatCommandDecision } from '../../lib/chatCommandRegistry';
import type { BrowserPlanCardData } from '../../lib/computerUse';
import type { OpenSwanObservedEvalSummary } from '../../lib/openswanObservedEvals';
import RunRoutingSummary from './RunRoutingSummary';

type Props = {
  commandDecisions?: ChatCommandDecision[];
  delegatedSubagents?: string[];
  activeSkills?: Array<{ name: string; displayName: string; source: string }>;
  browserPlans?: BrowserPlanCardData[];
  modeContext?: {
    key: string | null;
    label: string | null;
    description: string | null;
    outcome: string | null;
  } | null;
  modePresentation?: {
    focusAreas: string[];
    browserTitle: string;
    executionTitle: string;
    verificationTitle: string;
  } | null;
  observedEval?: OpenSwanObservedEvalSummary | null;
  variant?: 'compact' | 'detailed';
  accentColor?: string;
};

function getObservedEvalColors(
  observedEval: OpenSwanObservedEvalSummary | null | undefined,
): { borderColor: string; backgroundColor: string; textColor: string } {
  switch (observedEval?.outcome) {
    case 'strong':
      return {
        borderColor: '#22c55e40',
        backgroundColor: '#052e16',
        textColor: '#86efac',
      };
    case 'blocked':
      return {
        borderColor: '#f59e0b40',
        backgroundColor: '#1f1605',
        textColor: '#fbbf24',
      };
    case 'failed':
      return {
        borderColor: '#ef444440',
        backgroundColor: '#2a0b0b',
        textColor: '#fca5a5',
      };
    case 'partial':
    default:
      return {
        borderColor: '#38bdf840',
        backgroundColor: '#082f49',
        textColor: '#7dd3fc',
      };
  }
}

export default function RunMetadataSummary({
  commandDecisions = [],
  delegatedSubagents = [],
  activeSkills = [],
  browserPlans = [],
  modeContext = null,
  modePresentation = null,
  observedEval = null,
  variant = 'detailed',
  accentColor = '#38bdf8',
}: Props) {
  if (commandDecisions.length === 0 && delegatedSubagents.length === 0 && activeSkills.length === 0 && browserPlans.length === 0 && !modeContext && !observedEval) {
    return null;
  }

  const observedEvalColors = getObservedEvalColors(observedEval);

  if (variant === 'compact') {
    return (
      <View style={styles.compactWrap}>
        {modeContext?.label ? (
          <View style={styles.modeCompactChip}>
            <Text style={styles.modeCompactChipText}>{modeContext.label.toUpperCase()}</Text>
          </View>
        ) : null}
        {observedEval ? (
          <View style={[styles.qualityCompactChip, {
            borderColor: observedEvalColors.borderColor,
            backgroundColor: observedEvalColors.backgroundColor,
          }]}>
            <Text style={[styles.qualityCompactChipText, { color: observedEvalColors.textColor }]}>
              {observedEval.outcome.toUpperCase()} {observedEval.score}
            </Text>
          </View>
        ) : null}
        {commandDecisions.length > 0 ? (
          <RunRoutingSummary decisions={commandDecisions} variant="compact" accentColor={accentColor} />
        ) : null}
        {activeSkills.slice(0, 2).map((skill) => (
          <View key={skill.name} style={styles.skillCompactChip}>
            <Text style={styles.skillCompactChipText}>
              {skill.displayName.toUpperCase()}
            </Text>
          </View>
        ))}
        {delegatedSubagents.length > 0 ? (
          <Text style={styles.compactText}>
            {delegatedSubagents.length} SUBAGENT{delegatedSubagents.length > 1 ? 'S' : ''}
          </Text>
        ) : null}
        {browserPlans.length > 0 ? (
          <Text style={styles.compactText}>
            {browserPlans.length} BROWSER PLAN{browserPlans.length > 1 ? 'S' : ''}
          </Text>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.detailedWrap}>
      {modeContext?.label ? (
        <>
          <Text style={styles.sectionTitle}>MODE</Text>
          <View style={styles.modeDetailedCard}>
            <Text style={styles.modeDetailedLabel}>{modeContext.label.toUpperCase()}</Text>
            {modeContext.description ? (
              <Text style={styles.modeDetailedBody}>{modeContext.description}</Text>
            ) : null}
            {modeContext.outcome ? (
              <Text style={styles.modeDetailedOutcome}>Outcome: {modeContext.outcome}</Text>
            ) : null}
            {modePresentation?.focusAreas?.length ? (
              <View style={styles.modeFocusRow}>
                {modePresentation.focusAreas.map((focus) => (
                  <View key={focus} style={styles.modeFocusChip}>
                    <Text style={styles.modeFocusChipText}>{focus.toUpperCase()}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        </>
      ) : null}

      {observedEval ? (
        <>
          <Text style={styles.sectionTitle}>QUALITY</Text>
          <View style={[styles.qualityDetailedCard, {
            borderColor: observedEvalColors.borderColor,
            backgroundColor: observedEvalColors.backgroundColor,
          }]}>
            <View style={styles.qualityDetailedHeader}>
              <Text style={[styles.qualityDetailedLabel, { color: observedEvalColors.textColor }]}>
                {observedEval.outcome.toUpperCase()}
              </Text>
              <Text style={[styles.qualityDetailedScore, { color: observedEvalColors.textColor }]}>
                SCORE {observedEval.score}
              </Text>
            </View>
            {/* A failed run gets a terse card — outcome, score, and what
                blocked it. Grading the SHAPE of an error notice produced
                absurd output ("Strength: appropriately concise answer" on a
                crash), and the signal/met/missed chip rows were dashboard
                internals, not message-level information (they still feed
                OpenSwanQualityDashboard). */}
            {observedEval.outcome !== 'failed' ? (
              <>
                <View style={styles.qualityStatRow}>
                  <View style={styles.qualityStatChip}>
                    <Text style={styles.qualityStatValue}>
                      {observedEval.verification.passed}/{Math.max(observedEval.verification.planned, observedEval.verification.executed)}
                    </Text>
                    <Text style={styles.qualityStatLabel}>VERIFY</Text>
                  </View>
                  <View style={styles.qualityStatChip}>
                    <Text style={styles.qualityStatValue}>
                      {observedEval.artifacts.durable}/{observedEval.artifacts.total}
                    </Text>
                    <Text style={styles.qualityStatLabel}>ARTIFACTS</Text>
                  </View>
                  <View style={styles.qualityStatChip}>
                    <Text style={styles.qualityStatValue}>{observedEval.blockers.length}</Text>
                    <Text style={styles.qualityStatLabel}>BLOCKERS</Text>
                  </View>
                </View>
                {observedEval.strengths.slice(0, 2).map((item, index) => (
                  <Text key={`${item}-${index}`} style={styles.qualityDetailText}>
                    Strength {index + 1}: {item}
                  </Text>
                ))}
              </>
            ) : null}
            {observedEval.blockers.slice(0, 2).map((item, index) => (
              <Text key={`${item}-${index}`} style={[styles.qualityDetailText, styles.qualityBlockerText]}>
                Blocker {index + 1}: {item}
              </Text>
            ))}
          </View>
        </>
      ) : null}

      {delegatedSubagents.length > 0 ? (
        <>
          <Text style={styles.sectionTitle}>SUB-AGENTS</Text>
          <View style={styles.chipRow}>
            {delegatedSubagents.map((name) => (
              <View key={name} style={styles.subagentChip}>
                <Text style={styles.subagentChipText}>{name.toUpperCase()}</Text>
              </View>
            ))}
          </View>
        </>
      ) : null}

      {activeSkills.length > 0 ? (
        <>
          <Text style={styles.sectionTitle}>ACTIVE SKILLS</Text>
          <View style={styles.chipRow}>
            {activeSkills.slice(0, 6).map((skill) => (
              <View key={skill.name} style={styles.skillChip}>
                <Text style={styles.skillChipText}>{skill.displayName.toUpperCase()}</Text>
                <Text style={styles.skillChipMeta}>{skill.source.toUpperCase()}</Text>
              </View>
            ))}
          </View>
        </>
      ) : null}

      {commandDecisions.length > 0 ? (
        <>
          <Text style={styles.sectionTitle}>ROUTING</Text>
          <RunRoutingSummary decisions={commandDecisions} accentColor={accentColor} />
        </>
      ) : null}

      {browserPlans.length > 0 ? (
        <>
          <Text style={styles.sectionTitle}>BROWSER CONTEXT</Text>
          <View style={styles.browserWrap}>
            {browserPlans.slice(0, 2).map((plan) => (
              <View key={plan.planId} style={styles.browserChip}>
                <Text style={styles.browserChipText} numberOfLines={1}>
                  {plan.task}
                </Text>
              </View>
            ))}
            {browserPlans.length > 2 ? (
              <Text style={styles.browserMore}>+{browserPlans.length - 2} more</Text>
            ) : null}
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  detailedWrap: {
    gap: 8,
  },
  compactWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
  },
  compactText: {
    color: '#8b9bb3',
    fontSize: 11,
    fontFamily: 'monospace',
  },
  modeCompactChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#f59e0b40',
    backgroundColor: '#f59e0b16',
  },
  modeCompactChipText: {
    color: '#fbbf24',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.6,
    fontFamily: 'monospace',
  },
  qualityCompactChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  qualityCompactChipText: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.6,
    fontFamily: 'monospace',
  },
  skillCompactChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#22c55e35',
    backgroundColor: '#052e16',
  },
  skillCompactChipText: {
    color: '#86efac',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.6,
    fontFamily: 'monospace',
  },
  sectionTitle: {
    color: '#64748b',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.8,
    fontFamily: 'monospace',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  subagentChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#6366f140',
    backgroundColor: '#0ea5e915',
  },
  subagentChipText: {
    color: '#67e8f9',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.6,
    fontFamily: 'monospace',
  },
  skillChip: {
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#22c55e30',
    backgroundColor: '#052e16',
    gap: 2,
  },
  skillChipText: {
    color: '#bbf7d0',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
    fontFamily: 'monospace',
  },
  skillChipMeta: {
    color: '#86efac',
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.5,
    fontFamily: 'monospace',
  },
  browserWrap: {
    gap: 6,
  },
  modeDetailedCard: {
    borderWidth: 1,
    borderColor: '#f59e0b35',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: '#1a1307',
    gap: 4,
  },
  modeDetailedLabel: {
    color: '#fbbf24',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.8,
    fontFamily: 'monospace',
  },
  modeDetailedBody: {
    color: '#f8fafc',
    fontSize: 12,
    lineHeight: 17,
  },
  modeDetailedOutcome: {
    color: '#fcd34d',
    fontSize: 11,
    lineHeight: 15,
  },
  modeFocusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 2,
  },
  modeFocusChip: {
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#fbbf2440',
    backgroundColor: '#fbbf2412',
  },
  modeFocusChipText: {
    color: '#fde68a',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.6,
    fontFamily: 'monospace',
  },
  qualityDetailedCard: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 6,
  },
  qualityDetailedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  qualityDetailedLabel: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.8,
    fontFamily: 'monospace',
  },
  qualityDetailedScore: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
    fontFamily: 'monospace',
  },
  qualityStatRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  qualityStatChip: {
    minWidth: 72,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ffffff12',
    backgroundColor: '#ffffff08',
    gap: 2,
  },
  qualityStatValue: {
    color: '#f8fafc',
    fontSize: 12,
    fontWeight: '800',
    fontFamily: 'monospace',
  },
  qualityStatLabel: {
    color: '#94a3b8',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
    fontFamily: 'monospace',
  },
  qualityDetailText: {
    color: '#dbe7f5',
    fontSize: 11,
    lineHeight: 15,
  },
  qualityBlockerText: {
    color: '#fca5a5',
  },
  browserChip: {
    borderWidth: 1,
    borderColor: '#8b5cf640',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#140f23',
  },
  browserChipText: {
    color: '#d8d4fe',
    fontSize: 10,
    fontWeight: '700',
  },
  browserMore: {
    color: '#a78bfa',
    fontSize: 10,
    fontFamily: 'monospace',
  },
});
