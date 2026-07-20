/**
 * OfficeAgentPlanQueue - presentational handoff queue for saved Chat plans.
 *
 * OfficeTab owns loading/realtime/polling. This component only renders active
 * plan rows and exposes a Chat handoff action.
 */
import React, { useMemo } from 'react';
import { Platform, Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import type { AgentPlanPersisted, AgentPlanStatus } from '../../lib/agentPlanMode';

const MONO = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'ui-monospace, SFMono-Regular, Menlo, monospace',
}) as string;

const TERMINAL_STATUSES = new Set(['completed', 'archived']);

const STATUS_COLORS: Record<string, string> = {
  draft: '#94a3b8',
  ready: '#38bdf8',
  approved: '#22c55e',
  building: '#3b82f6',
  completed: '#22c55e',
  blocked: '#e8b339',
  archived: '#64748b',
};

type Props = {
  plans: AgentPlanPersisted[];
  accentColor: string;
  maxItems?: number;
  style?: StyleProp<ViewStyle>;
  onOpenChat?: (plan: AgentPlanPersisted) => void;
};

function statusColor(status: AgentPlanStatus | string): string {
  return STATUS_COLORS[status] || '#94a3b8';
}

function compact(value: string | null | undefined, fallback: string): string {
  const clean = String(value || '').trim();
  return clean || fallback;
}

function formatUpdated(value?: string | null): string {
  if (!value) return 'recent';
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return 'recent';
  const age = Math.max(0, Date.now() - ms);
  const minutes = Math.floor(age / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function metadataSummary(plan: AgentPlanPersisted): Record<string, any> {
  const summary = (plan.metadata as any)?.summary;
  return summary && typeof summary === 'object' ? summary : {};
}

export function officeAgentPlanQueueHasContent(plans: AgentPlanPersisted[] | null | undefined): boolean {
  return Array.isArray(plans) && plans.some((plan) => !TERMINAL_STATUSES.has(String(plan.status)));
}

export default function OfficeAgentPlanQueue({
  plans,
  accentColor,
  maxItems = 4,
  style,
  onOpenChat,
}: Props) {
  const activePlans = useMemo(
    () => plans
      .filter((plan) => !TERMINAL_STATUSES.has(String(plan.status)))
      .slice(0, Math.max(1, maxItems)),
    [maxItems, plans],
  );

  if (activePlans.length === 0) return null;

  return (
    <View style={[s.card, style]}>
      <View style={s.headerRow}>
        <Text style={s.header}>AGENT HANDOFF QUEUE</Text>
        <Text style={[s.count, { color: accentColor }]}>{activePlans.length}</Text>
      </View>
      <View style={s.list}>
        {activePlans.map((plan) => {
          const color = statusColor(plan.status);
          const summary = metadataSummary(plan);
          const stepCount = Number(summary.stepCount || 0);
          const questionCount = Number(summary.questionCount || 0);
          const model = compact(plan.selectedModel, 'auto');
          const handoff = plan.buildReady || plan.flow.office.handoffReady ? 'handoff ready' : 'needs review';
          const counts = [
            stepCount > 0 ? `${stepCount} steps` : null,
            questionCount > 0 ? `${questionCount} questions` : null,
            `risk ${plan.risk}`,
            model,
          ].filter(Boolean).join(' - ');

          return (
            <View key={plan.id} style={s.planRow}>
              <View style={s.planTop}>
                <View style={[s.statusDot, { backgroundColor: color }]} />
                <Text style={s.title} numberOfLines={1}>{plan.title}</Text>
                <Text style={[s.status, { color }]}>{String(plan.status).toUpperCase()}</Text>
              </View>
              <Text style={s.summary} numberOfLines={2}>
                {compact(plan.summary, plan.task)}
              </Text>
              <Text style={s.metaLine} numberOfLines={1}>
                {handoff} - {counts} - {formatUpdated(plan.updatedAt || plan.createdAt)}
              </Text>
              <View style={s.flowRow}>
                <Text style={s.flowPill}>Chat {plan.flow.chat.executionKind}</Text>
                <Text style={s.flowPill}>SwanBot {plan.flow.swanbot.role}</Text>
                <Text style={s.flowPill}>OpenSwan {plan.flow.openswan.taskKind}</Text>
              </View>
              {onOpenChat ? (
                <Pressable
                  onPress={() => onOpenChat(plan)}
                  accessibilityRole="button"
                  accessibilityLabel={`Open Chat for plan ${plan.title}`}
                  style={[s.action, { borderColor: `${accentColor}80` }, Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}
                >
                  <Text style={[s.actionText, { color: accentColor }]}>OPEN CHAT</Text>
                </Pressable>
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    backgroundColor: '#161616',
    gap: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  header: {
    color: '#d6d6e1',
    fontSize: 12,
    fontWeight: '800',
    fontFamily: MONO,
  },
  count: {
    marginLeft: 'auto',
    fontSize: 12,
    fontWeight: '800',
    fontFamily: MONO,
  },
  list: {
    gap: 8,
  },
  planRow: {
    borderWidth: 1,
    borderColor: '#2a2a2a',
    backgroundColor: '#101010',
    borderRadius: 6,
    padding: 10,
    gap: 7,
  },
  planTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  title: {
    flex: 1,
    color: '#f4f4f5',
    fontSize: 13,
    fontWeight: '800',
  },
  status: {
    fontSize: 10,
    fontWeight: '800',
    fontFamily: MONO,
  },
  summary: {
    color: '#a3a3b6',
    fontSize: 12,
    lineHeight: 17,
  },
  metaLine: {
    color: '#707086',
    fontSize: 10,
    fontFamily: MONO,
  },
  flowRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  flowPill: {
    color: '#8b8b9a',
    fontSize: 10,
    fontFamily: MONO,
    borderWidth: 1,
    borderColor: '#242436',
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  action: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  actionText: {
    fontSize: 10,
    fontWeight: '800',
    fontFamily: MONO,
  },
});
