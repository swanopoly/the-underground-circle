/**
 * AutomationsPanel.tsx — Circle Automations Dashboard
 *
 * Full-page automations UI with:
 *   • Stats bar (total, successful 7d, failed 7d, run history)
 *   • Quick-create natural-language bar
 *   • Mine / All tab filter + search
 *   • Automation cards with run history, edit, memory notes
 *   • Suggested templates grid (2-col, collapsible "More")
 *   • Searchable trigger picker (Schedule / Circle Events / GitHub / Slack / Linear)
 *   • Memory Notes modal (per-automation context injected into AI prompts)
 *   • Model picker dropdown
 */

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Modal,
  TextInput,
  Switch,
  ActivityIndicator,
  Platform,
} from 'react-native';
import {
  useCircleAutomations,
  useAutomationRuns,
  useAutomationStats,
  createAutomation,
  updateAutomation,
  deleteAutomation,
  toggleAutomation,
  triggerAutomation,
  CircleAutomation,
  AutomationRun,
  AutomationStats,
  CreateAutomationInput,
  TriggerType,
  OutputTarget,
  useMemoryNotes,
  createMemoryNote,
  updateMemoryNote,
  deleteMemoryNote,
  MemoryNote,
  useDashboardStats,
  loadRecentRuns,
  useCircleRunStream,
} from '../services/automationService';
import {
  AUTOMATION_TEMPLATES,
  AutomationTemplate,
  SUGGESTED_TEMPLATES,
  SUGGESTED_GROUPS,
  TEMPLATE_CATEGORIES,
} from '../lib/automationTemplates';
import { AGENT_SPIRITS, SPIRIT_CATEGORIES, getSpiritById, type AgentSpirit } from '../lib/agentSpirits';
import { supabase } from '../lib/supabase';

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  circleId: string;
  accentColor?: string;
}

// ─── Time helpers ─────────────────────────────────────────────────────────────

function timeAgo(iso: string | null): string {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

function timeUntil(iso: string | null): string {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - Date.now();
  if (ms < 0) return 'overdue';
  if (ms < 3_600_000) return `in ${Math.floor(ms / 60_000)}m`;
  if (ms < 86_400_000) return `in ${Math.floor(ms / 3_600_000)}h`;
  return `in ${Math.floor(ms / 86_400_000)}d`;
}

// ─── Trigger catalog ──────────────────────────────────────────────────────────

export interface TriggerOption {
  id: string;
  label: string;
  description: string;
  icon: string;
  category: string;
  triggerType: TriggerType;
  cronExpression?: string;
  eventTable?: string;
  webhookProvider?: string;
  webhookEvent?: string;
}

const TRIGGER_CATALOG: { category: string; icon: string; items: TriggerOption[] }[] = [
  {
    category: 'Schedule',
    icon: '🕐',
    items: [
      { id: 'schedule:hourly',      label: 'Every hour',    description: 'Runs once per hour',       icon: '⏱️', category: 'Schedule', triggerType: 'schedule', cronExpression: 'hourly' },
      { id: 'schedule:every_6h',    label: 'Every 6 hours', description: 'Runs 4× per day',           icon: '⏲️', category: 'Schedule', triggerType: 'schedule', cronExpression: 'every_6h' },
      { id: 'schedule:twice_daily', label: 'Twice daily',   description: 'Morning & evening',        icon: '🌅', category: 'Schedule', triggerType: 'schedule', cronExpression: 'twice_daily' },
      { id: 'schedule:daily',       label: 'Daily',         description: 'Runs once per day',        icon: '📅', category: 'Schedule', triggerType: 'schedule', cronExpression: 'daily' },
      { id: 'schedule:weekly',      label: 'Weekly',        description: 'Runs every Monday',        icon: '📆', category: 'Schedule', triggerType: 'schedule', cronExpression: 'weekly' },
      { id: 'schedule:monthly',     label: 'Monthly',       description: 'Runs first of month',      icon: '🗓️', category: 'Schedule', triggerType: 'schedule', cronExpression: 'monthly' },
    ],
  },
  {
    category: 'Circle Events',
    icon: '⭕',
    items: [
      { id: 'event:check_ins',      label: 'New check-in',       description: 'Member checks in',          icon: '✅', category: 'Circle Events', triggerType: 'event', eventTable: 'check_ins' },
      { id: 'event:circle_members', label: 'New member joined',  description: 'Someone joins the circle',  icon: '👋', category: 'Circle Events', triggerType: 'event', eventTable: 'circle_members' },
      { id: 'event:tasks',          label: 'Task completed',     description: 'A task is marked done',     icon: '🏁', category: 'Circle Events', triggerType: 'event', eventTable: 'tasks' },
      { id: 'event:messages',       label: 'New circle message', description: 'Message posted to chat',    icon: '💬', category: 'Circle Events', triggerType: 'event', eventTable: 'messages' },
    ],
  },
  {
    category: 'Manual',
    icon: '🖐️',
    items: [
      { id: 'manual:run', label: 'Manual run', description: 'Triggered manually by a member', icon: '▶️', category: 'Manual', triggerType: 'manual' },
    ],
  },
  {
    category: 'GitHub',
    icon: '🐙',
    items: [
      { id: 'webhook:github:push',                 label: 'New push to branch',   description: 'Code pushed to a branch',          icon: '📤', category: 'GitHub', triggerType: 'webhook', webhookProvider: 'github', webhookEvent: 'push' },
      { id: 'webhook:github:ci_completed',         label: 'CI completed',         description: 'GitHub Actions workflow finished',  icon: '🔧', category: 'GitHub', triggerType: 'webhook', webhookProvider: 'github', webhookEvent: 'ci_completed' },
      { id: 'webhook:github:pull_request_opened',  label: 'PR opened',            description: 'Pull request opened',              icon: '🔀', category: 'GitHub', triggerType: 'webhook', webhookProvider: 'github', webhookEvent: 'pull_request_opened' },
      { id: 'webhook:github:pull_request_merged',  label: 'PR merged',            description: 'Pull request merged',              icon: '✅', category: 'GitHub', triggerType: 'webhook', webhookProvider: 'github', webhookEvent: 'pull_request_merged' },
    ],
  },
  {
    category: 'Slack',
    icon: '💼',
    items: [
      { id: 'webhook:slack:message',         label: 'New message in channel', description: 'Message posted in a Slack channel', icon: '💬', category: 'Slack', triggerType: 'webhook', webhookProvider: 'slack', webhookEvent: 'message' },
      { id: 'webhook:slack:channel_created', label: 'Channel created',        description: 'New Slack channel created',         icon: '#️⃣', category: 'Slack', triggerType: 'webhook', webhookProvider: 'slack', webhookEvent: 'channel_created' },
      { id: 'webhook:slack:reaction_added',  label: 'Reaction added',         description: 'Emoji reaction on a message',       icon: '😄', category: 'Slack', triggerType: 'webhook', webhookProvider: 'slack', webhookEvent: 'reaction_added' },
    ],
  },
  {
    category: 'Linear',
    icon: '🔷',
    items: [
      { id: 'webhook:linear:issue_created',   label: 'Issue created',       description: 'New Linear issue',               icon: '🎯', category: 'Linear', triggerType: 'webhook', webhookProvider: 'linear', webhookEvent: 'issue_created' },
      { id: 'webhook:linear:cycle_completed', label: 'End of cycle',        description: 'Linear cycle completes',         icon: '🔄', category: 'Linear', triggerType: 'webhook', webhookProvider: 'linear', webhookEvent: 'cycle_completed' },
      { id: 'webhook:linear:issue_updated',   label: 'Issue status changed', description: 'Issue moved to new status',     icon: '↔️', category: 'Linear', triggerType: 'webhook', webhookProvider: 'linear', webhookEvent: 'issue_updated' },
    ],
  },
];

const ALL_TRIGGER_OPTIONS = TRIGGER_CATALOG.flatMap((g) => g.items);

function getTriggerById(id: string): TriggerOption | undefined {
  return ALL_TRIGGER_OPTIONS.find((t) => t.id === id);
}

// Smart trigger detection from natural language description
function detectTrigger(text: string): TriggerOption | null {
  const t = text.toLowerCase();
  if (/\bci\b|pipeline|github action|build fail/.test(t))       return getTriggerById('webhook:github:ci_completed') ?? null;
  if (/\bpr\b|pull request|merge/.test(t))                       return getTriggerById('webhook:github:pull_request_opened') ?? null;
  if (/\bgithub\b|push|commit|branch/.test(t))                   return getTriggerById('webhook:github:push') ?? null;
  if (/\bslack\b/.test(t))                                       return getTriggerById('webhook:slack:message') ?? null;
  if (/\blinear\b/.test(t))                                      return getTriggerById('webhook:linear:issue_created') ?? null;
  if (/\bdaily\b|every day|each day/.test(t))                   return getTriggerById('schedule:daily') ?? null;
  if (/\bweekly\b|every week|each week/.test(t))                 return getTriggerById('schedule:weekly') ?? null;
  if (/\bhourly\b|every hour/.test(t))                           return getTriggerById('schedule:hourly') ?? null;
  if (/\bcheck.?in\b/.test(t))                                   return getTriggerById('event:check_ins') ?? null;
  return null;
}

// ─── Trigger / output labels ──────────────────────────────────────────────────

const TRIGGER_LABELS: Record<TriggerType, { label: string; color: string }> = {
  schedule: { label: 'SCHEDULE', color: '#6366f1' },
  event:    { label: 'EVENT',    color: '#f59e0b' },
  manual:   { label: 'MANUAL',   color: '#22c55e' },
  webhook:  { label: 'WEBHOOK',  color: '#06b6d4' },
};

const OUTPUT_LABELS: Record<OutputTarget, string> = {
  chat:     'Chat',
  activity: 'Activity Feed',
  webhook:  'Webhook',
  silent:   'Silent',
};

const MODEL_OPTIONS = [
  { value: 'claude-haiku',  label: 'Haiku 4.5',  sub: 'fast · cheap',   color: '#22c55e' },
  { value: 'claude-sonnet', label: 'Sonnet 4.6', sub: 'balanced',        color: '#6366f1' },
  { value: 'claude-opus',   label: 'Opus 4.6',   sub: 'most powerful',   color: '#f59e0b' },
];

function runStatusIcon(status: string): string {
  switch (status) {
    case 'completed': return '✅';
    case 'failed':    return '❌';
    case 'running':   return '⏳';
    case 'skipped':   return '⏭️';
    default:          return '·';
  }
}

// ─── Stats Bar ────────────────────────────────────────────────────────────────

function StatsDashboard({
  circleId,
  automationCount,
  accentColor,
  onRunHistory,
}: {
  circleId: string;
  automationCount: number;
  accentColor: string;
  onRunHistory: () => void;
}) {
  const { stats } = useDashboardStats(circleId);

  return (
    <View style={sd.row}>
      <View style={sd.card}>
        <Text style={sd.cardLabel}>Total Automations</Text>
        <Text style={sd.cardValue}>{automationCount}</Text>
      </View>
      <View style={sd.card}>
        <Text style={sd.cardLabel}>Successful · 7d</Text>
        <Text style={[sd.cardValue, { color: '#22c55e' }]}>{stats.successfulLast7d}</Text>
      </View>
      <View style={sd.card}>
        <Text style={sd.cardLabel}>Failed · 7d</Text>
        <Text style={[sd.cardValue, { color: stats.failedLast7d > 0 ? '#ef4444' : '#888' }]}>
          {stats.failedLast7d}
        </Text>
      </View>
      <Pressable
        onPress={onRunHistory}
        style={[sd.card, sd.historyCard, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
      >
        <Text style={[sd.historyLabel, { color: accentColor }]}>Run History →</Text>
      </Pressable>
    </View>
  );
}

const sd = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  card: {
    flex: 1,
    backgroundColor: '#111',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1e1e1e',
    padding: 12,
    minHeight: 60,
    justifyContent: 'space-between',
  },
  historyCard: {
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  cardLabel: {
    color: '#666',
    fontSize: 10,
    fontFamily: 'monospace',
    letterSpacing: 0.5,
  },
  cardValue: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
    marginTop: 4,
  },
  historyLabel: {
    fontSize: 12,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
});

// ─── Quick Create Bar ─────────────────────────────────────────────────────────

function QuickCreateBar({
  onSubmit,
  accentColor,
}: {
  onSubmit: (prompt: string, detectedTrigger: TriggerOption | null) => void;
  accentColor: string;
}) {
  const [text, setText] = useState('');

  const handleSubmit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const trigger = detectTrigger(trimmed);
    onSubmit(trimmed, trigger);
    setText('');
  };

  return (
    <View style={qc.container}>
      <TextInput
        style={qc.input}
        value={text}
        onChangeText={setText}
        placeholder="Describe what you want to automate... e.g. 'When CI fails on a PR, diagnose and open a fix PR'"
        placeholderTextColor="#3a3a3a"
        multiline
        numberOfLines={2}
        textAlignVertical="top"
        onSubmitEditing={handleSubmit}
      />
      <Pressable
        onPress={handleSubmit}
        disabled={!text.trim()}
        style={[
          qc.submitBtn,
          { backgroundColor: text.trim() ? accentColor : '#222' },
          Platform.OS === 'web' && { cursor: text.trim() ? 'pointer' : 'default' } as any,
        ]}
      >
        <Text style={[qc.submitIcon, { color: text.trim() ? '#fff' : '#555' }]}>↑</Text>
      </Pressable>
    </View>
  );
}

const qc = StyleSheet.create({
  container: {
    backgroundColor: '#111',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e1e1e',
    padding: 12,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  input: {
    flex: 1,
    color: '#ccc',
    fontSize: 13,
    minHeight: 44,
    maxHeight: 80,
    lineHeight: 20,
  },
  submitBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 2,
  },
  submitIcon: {
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 20,
  },
});

// ─── Suggested Templates Grid ─────────────────────────────────────────────────

const GROUPS_VISIBLE = 2; // show first 2 groups by default

function SuggestedSection({
  onApply,
  accentColor,
}: {
  onApply: (template: AutomationTemplate) => void;
  accentColor: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const groups = expanded ? SUGGESTED_GROUPS : SUGGESTED_GROUPS.slice(0, GROUPS_VISIBLE);
  const hasMore = SUGGESTED_GROUPS.length > GROUPS_VISIBLE;

  return (
    <View style={sg.container}>
      <Text style={sg.sectionLabel}>Suggested Automations</Text>
      {groups.map((group) => (
        <View key={group.key} style={sg.groupContainer}>
          <View style={sg.groupHeader}>
            <View style={sg.groupIconBox}>
              <Text style={sg.groupIconText}>{group.icon}</Text>
            </View>
            <Text style={sg.groupLabel}>{group.label}</Text>
            <Text style={sg.groupCount}>{group.templates.length}</Text>
          </View>
          <View style={sg.grid}>
            {group.templates.map((t) => (
              <Pressable
                key={t.id}
                onPress={() => onApply(t)}
                style={[sg.card, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
              >
                <View style={[sg.iconBox, { backgroundColor: t.suggestedIconBg || '#000000' }]}>
                  <Text style={sg.iconEmoji}>{t.icon}</Text>
                </View>
                <Text style={sg.cardTitle}>{t.name}</Text>
                <Text style={sg.cardDesc} numberOfLines={2}>{t.description}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ))}
      {hasMore && (
        <Pressable
          onPress={() => setExpanded(!expanded)}
          style={[sg.moreBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
        >
          <Text style={sg.moreText}>
            {expanded ? 'Show less ∧' : `Show ${SUGGESTED_GROUPS.length - GROUPS_VISIBLE} more groups ∨`}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const sg = StyleSheet.create({
  container: {
    marginTop: 16,
  },
  sectionLabel: {
    color: '#888',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 14,
    letterSpacing: 0.5,
    fontFamily: 'monospace',
    textTransform: 'uppercase',
  },
  groupContainer: {
    marginBottom: 16,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  groupIconBox: {
    width: 24,
    height: 24,
    borderRadius: 4,
    backgroundColor: '#15151e',
    borderWidth: 1,
    borderColor: '#1e1e2e',
    justifyContent: 'center',
    alignItems: 'center',
  },
  groupIconText: {
    color: '#6366f1',
    fontSize: 9,
    fontWeight: '800',
    fontFamily: 'monospace',
  },
  groupLabel: {
    color: '#9090a8',
    fontSize: 12,
    fontWeight: '700',
    fontFamily: 'monospace',
    letterSpacing: 0.5,
    flex: 1,
  },
  groupCount: {
    color: '#444455',
    fontSize: 10,
    fontWeight: '600',
    fontFamily: 'monospace',
    backgroundColor: '#222222',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  card: {
    width: '48.5%',
    backgroundColor: '#0d0d0d',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#000000',
    padding: 14,
    gap: 8,
  },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconEmoji: {
    fontSize: 18,
  },
  cardTitle: {
    color: '#e5e5e5',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
  },
  cardDesc: {
    color: '#555',
    fontSize: 11,
    lineHeight: 16,
  },
  moreBtn: {
    marginTop: 10,
    paddingVertical: 4,
  },
  moreText: {
    color: '#666',
    fontSize: 12,
    fontWeight: '600',
  },
});

// ─── Run History Modal (cross-automation) ─────────────────────────────────────

function RunHistoryModal({
  circleId,
  onClose,
}: {
  circleId: string;
  onClose: () => void;
}) {
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    loadRecentRuns(circleId, 30).then((r) => {
      setRuns(r);
      setLoading(false);
    });
  }, [circleId]);

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={rh.backdrop} onPress={onClose}>
        <Pressable style={rh.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={rh.header}>
            <Text style={rh.title}>Run History</Text>
            <Pressable onPress={onClose} style={rh.closeBtn}>
              <Text style={rh.closeText}>✕</Text>
            </Pressable>
          </View>
          <View style={rh.divider} />
          {loading ? (
            <ActivityIndicator size="small" color="#555" style={{ padding: 24 }} />
          ) : runs.length === 0 ? (
            <Text style={rh.empty}>No runs yet</Text>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false}>
              {runs.map((run) => (
                <View key={run.id} style={rh.row}>
                  <Text style={rh.rowIcon}>{runStatusIcon(run.status)}</Text>
                  <View style={rh.rowInfo}>
                    <Text style={rh.rowTime}>{timeAgo(run.startedAt)}</Text>
                    {run.outputText && (
                      <Text style={rh.rowOutput} numberOfLines={1}>{run.outputText}</Text>
                    )}
                    {run.errorMessage && (
                      <Text style={rh.rowError} numberOfLines={1}>{run.errorMessage}</Text>
                    )}
                  </View>
                  <View style={rh.rowMeta}>
                    {run.durationMs != null && (
                      <Text style={rh.rowMetaText}>{(run.durationMs / 1000).toFixed(1)}s</Text>
                    )}
                    {run.estimatedCost > 0 && (
                      <Text style={rh.rowMetaCost}>${run.estimatedCost.toFixed(4)}</Text>
                    )}
                  </View>
                </View>
              ))}
            </ScrollView>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const rh = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  sheet: {
    backgroundColor: '#111',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#222',
    width: '100%',
    maxWidth: 480,
    maxHeight: '80%',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
  },
  title: { color: '#fff', fontSize: 16, fontWeight: '800' },
  closeBtn: { padding: 4 },
  closeText: { color: '#555', fontSize: 16 },
  divider: { height: 1, backgroundColor: '#000000' },
  empty: { color: '#555', fontSize: 12, textAlign: 'center', padding: 24, fontFamily: 'monospace' },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 10,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#0f0f0f',
    gap: 10,
  },
  rowIcon: { fontSize: 13, marginTop: 1 },
  rowInfo: { flex: 1 },
  rowTime: { color: '#888', fontSize: 10, fontFamily: 'monospace' },
  rowOutput: { color: '#ccc', fontSize: 11, marginTop: 2 },
  rowError: { color: '#ef4444', fontSize: 11, marginTop: 2 },
  rowMeta: { alignItems: 'flex-end', gap: 2 },
  rowMetaText: { color: '#555', fontSize: 10, fontFamily: 'monospace' },
  rowMetaCost: { color: '#f59e0b', fontSize: 10, fontFamily: 'monospace' },
});

// ─── Trigger Picker Modal ─────────────────────────────────────────────────────

function TriggerPickerModal({
  onSelect,
  onClose,
}: {
  onSelect: (trigger: TriggerOption) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    if (!query.trim()) return TRIGGER_CATALOG;
    const q = query.toLowerCase();
    return TRIGGER_CATALOG
      .map((group) => ({
        ...group,
        items: group.items.filter(
          (t) => t.label.toLowerCase().includes(q) || t.description.toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.items.length > 0);
  }, [query]);

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={tp.backdrop} onPress={onClose}>
        <Pressable style={tp.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={tp.searchRow}>
            <Text style={tp.searchIcon}>🔍</Text>
            <TextInput
              style={tp.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Search triggers..."
              placeholderTextColor="#555"
              autoFocus
            />
            <Pressable onPress={onClose} style={tp.closeBtn}>
              <Text style={tp.closeText}>✕</Text>
            </Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} style={tp.scroll}>
            {filtered.map((group) => (
              <View key={group.category}>
                <View style={tp.groupHeader}>
                  <Text style={tp.groupIcon}>{group.icon}</Text>
                  <Text style={tp.groupLabel}>{group.category}</Text>
                </View>
                {group.items.map((item) => (
                  <Pressable
                    key={item.id}
                    onPress={() => { onSelect(item); onClose(); }}
                    style={[tp.item, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                  >
                    <Text style={tp.itemIcon}>{item.icon}</Text>
                    <View style={tp.itemInfo}>
                      <Text style={tp.itemLabel}>{item.label}</Text>
                      <Text style={tp.itemDesc}>{item.description}</Text>
                    </View>
                    <Text style={tp.itemArrow}>›</Text>
                  </Pressable>
                ))}
              </View>
            ))}
            {filtered.length === 0 && (
              <Text style={tp.empty}>No triggers match "{query}"</Text>
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const tp = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  sheet: {
    backgroundColor: '#111',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#222',
    width: '100%',
    maxWidth: 420,
    maxHeight: '80%',
    overflow: 'hidden',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#000000',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  searchIcon: { fontSize: 14, color: '#555' },
  searchInput: { flex: 1, color: '#fff', fontSize: 14, fontFamily: 'monospace' },
  closeBtn: { padding: 4 },
  closeText: { color: '#555', fontSize: 14 },
  scroll: { flex: 1 },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 6,
  },
  groupIcon: { fontSize: 13 },
  groupLabel: {
    color: '#666',
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'monospace',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 10,
  },
  itemIcon: { fontSize: 18, width: 26, textAlign: 'center' },
  itemInfo: { flex: 1 },
  itemLabel: { color: '#e5e5e5', fontSize: 13, fontWeight: '600' },
  itemDesc: { color: '#555', fontSize: 11, marginTop: 1 },
  itemArrow: { color: '#444', fontSize: 16 },
  empty: { color: '#555', fontSize: 12, fontFamily: 'monospace', textAlign: 'center', padding: 24 },
});

// ─── Model Picker Modal ───────────────────────────────────────────────────────

function ModelPickerModal({
  selected,
  onSelect,
  onClose,
}: {
  selected: string;
  onSelect: (v: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={mp.backdrop} onPress={onClose}>
        <Pressable style={mp.sheet} onPress={(e) => e.stopPropagation()}>
          <Text style={mp.title}>Select Model</Text>
          {MODEL_OPTIONS.map((opt) => {
            const active = selected === opt.value;
            return (
              <Pressable
                key={opt.value}
                onPress={() => { onSelect(opt.value); onClose(); }}
                style={[mp.item, active && { borderColor: opt.color, backgroundColor: opt.color + '15' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
              >
                <View style={[mp.dot, { backgroundColor: opt.color }]} />
                <View style={mp.itemInfo}>
                  <Text style={[mp.itemLabel, active && { color: opt.color }]}>{opt.label}</Text>
                  <Text style={mp.itemSub}>{opt.sub}</Text>
                </View>
                {active && <Text style={[mp.check, { color: opt.color }]}>✓</Text>}
              </Pressable>
            );
          })}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const mp = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  sheet: {
    backgroundColor: '#111',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#222',
    width: '100%',
    maxWidth: 320,
    padding: 16,
  },
  title: {
    color: '#888',
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'monospace',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#222',
    borderRadius: 8,
    padding: 12,
    marginBottom: 6,
    gap: 10,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  itemInfo: { flex: 1 },
  itemLabel: { color: '#e5e5e5', fontSize: 13, fontWeight: '700' },
  itemSub: { color: '#555', fontSize: 11, marginTop: 2 },
  check: { fontSize: 16 },
});

// ─── Memory Notes Modal ───────────────────────────────────────────────────────

function MemoryNotesModal({
  automationId,
  automationName,
  circleId,
  onClose,
  accentColor,
}: {
  automationId: string | null;
  automationName: string;
  circleId: string;
  onClose: () => void;
  accentColor: string;
}) {
  const { notes, isLoading, refresh } = useMemoryNotes(automationId);
  const [editingNote, setEditingNote] = useState<MemoryNote | null>(null);
  const [showNew, setShowNew] = useState(false);

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={mn.backdrop} onPress={onClose}>
        <Pressable style={mn.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={mn.header}>
            <View>
              <Text style={mn.title}>Memory Notes</Text>
              <Text style={mn.subtitle}>Context injected into AI prompts when this automation runs</Text>
            </View>
            <Pressable onPress={onClose} style={mn.closeBtn}>
              <Text style={mn.closeText}>✕</Text>
            </Pressable>
          </View>
          <View style={mn.divider} />

          {!automationId ? (
            <View style={mn.unsaved}>
              <Text style={mn.unsavedIcon}>💾</Text>
              <Text style={mn.unsavedText}>Save this automation to enable and configure memory notes.</Text>
            </View>
          ) : isLoading ? (
            <ActivityIndicator size="small" color="#555" style={{ padding: 24 }} />
          ) : (
            <ScrollView style={mn.scroll} showsVerticalScrollIndicator={false}>
              {notes.length === 0 && !showNew && (
                <View style={mn.empty}>
                  <Text style={mn.emptyIcon}>🧠</Text>
                  <Text style={mn.emptyText}>No memory notes yet</Text>
                  <Text style={mn.emptySubtext}>Add context the AI will use every time this automation runs — project goals, team preferences, background info, etc.</Text>
                </View>
              )}
              {notes.map((note) =>
                editingNote?.id === note.id ? (
                  <NoteEditor
                    key={note.id}
                    initialTitle={note.title}
                    initialContent={note.content}
                    accentColor={accentColor}
                    onSave={async (title, content) => {
                      await updateMemoryNote(note.id, { title, content });
                      setEditingNote(null);
                      refresh();
                    }}
                    onCancel={() => setEditingNote(null)}
                  />
                ) : (
                  <NoteCard
                    key={note.id}
                    note={note}
                    onEdit={() => setEditingNote(note)}
                    onDelete={async () => {
                      await deleteMemoryNote(note.id);
                      refresh();
                    }}
                    accentColor={accentColor}
                  />
                ),
              )}
              {showNew && (
                <NoteEditor
                  accentColor={accentColor}
                  onSave={async (title, content) => {
                    if (automationId) {
                      await createMemoryNote(automationId, circleId, title, content);
                      refresh();
                    }
                    setShowNew(false);
                  }}
                  onCancel={() => setShowNew(false)}
                />
              )}
              {!showNew && (
                <Pressable
                  onPress={() => setShowNew(true)}
                  style={[mn.addNoteBtn, { borderColor: accentColor + '40' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                >
                  <Text style={[mn.addNoteBtnText, { color: accentColor }]}>+ Add Memory Note</Text>
                </Pressable>
              )}
            </ScrollView>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function NoteCard({
  note, onEdit, onDelete, accentColor,
}: { note: MemoryNote; onEdit: () => void; onDelete: () => void; accentColor: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={mn.noteCard}>
      <Pressable
        onPress={() => setExpanded(!expanded)}
        style={[mn.noteHeader, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
      >
        <Text style={mn.noteIcon}>📝</Text>
        <Text style={mn.noteTitle} numberOfLines={1}>{note.title}</Text>
        <Text style={mn.noteChevron}>{expanded ? '▲' : '▼'}</Text>
      </Pressable>
      {expanded && (
        <View style={mn.noteBody}>
          <Text style={mn.noteContent} selectable>{note.content || '(empty)'}</Text>
          <View style={mn.noteActions}>
            <Pressable onPress={onEdit} style={[mn.noteActionBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
              <Text style={[mn.noteActionText, { color: accentColor }]}>✏️ Edit</Text>
            </Pressable>
            <Pressable onPress={onDelete} style={[mn.noteActionBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
              <Text style={[mn.noteActionText, { color: '#ef4444' }]}>🗑 Delete</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

function NoteEditor({
  initialTitle = '',
  initialContent = '',
  onSave,
  onCancel,
  accentColor,
}: {
  initialTitle?: string;
  initialContent?: string;
  onSave: (title: string, content: string) => Promise<void>;
  onCancel: () => void;
  accentColor: string;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [content, setContent] = useState(initialContent);
  const [saving, setSaving] = useState(false);

  return (
    <View style={mn.editor}>
      <TextInput
        style={mn.editorTitle}
        value={title}
        onChangeText={setTitle}
        placeholder="Note title (e.g. Team Context, Project Goals)"
        placeholderTextColor="#444"
      />
      <TextInput
        style={mn.editorContent}
        value={content}
        onChangeText={setContent}
        placeholder="Write context the AI should always know when running this automation..."
        placeholderTextColor="#444"
        multiline
        numberOfLines={5}
        textAlignVertical="top"
      />
      <View style={mn.editorActions}>
        <Pressable
          onPress={onCancel}
          style={[mn.editorCancelBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
        >
          <Text style={mn.editorCancelText}>Cancel</Text>
        </Pressable>
        <Pressable
          onPress={async () => {
            if (!title.trim()) return;
            setSaving(true);
            await onSave(title, content);
            setSaving(false);
          }}
          disabled={saving || !title.trim()}
          style={[
            mn.editorSaveBtn,
            { backgroundColor: accentColor, opacity: (saving || !title.trim()) ? 0.5 : 1 },
            Platform.OS === 'web' && { cursor: 'pointer' } as any,
          ]}
        >
          {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={mn.editorSaveText}>Save</Text>}
        </Pressable>
      </View>
    </View>
  );
}

const mn = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  sheet: {
    backgroundColor: '#111',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#222',
    width: '100%',
    maxWidth: 480,
    maxHeight: '85%',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: 20,
    paddingBottom: 14,
  },
  title: { color: '#fff', fontSize: 16, fontWeight: '800' },
  subtitle: { color: '#555', fontSize: 11, marginTop: 3 },
  closeBtn: { padding: 4 },
  closeText: { color: '#555', fontSize: 16 },
  divider: { height: 1, backgroundColor: '#000000' },
  scroll: { maxHeight: 480 },
  unsaved: { alignItems: 'center', padding: 32, gap: 10 },
  unsavedIcon: { fontSize: 32 },
  unsavedText: { color: '#666', fontSize: 13, textAlign: 'center' },
  empty: { alignItems: 'center', padding: 24, gap: 8 },
  emptyIcon: { fontSize: 28 },
  emptyText: { color: '#888', fontSize: 14, fontWeight: '700' },
  emptySubtext: { color: '#555', fontSize: 12, textAlign: 'center', lineHeight: 18 },
  addNoteBtn: {
    margin: 16,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  addNoteBtnText: { fontSize: 13, fontWeight: '700' },
  noteCard: {
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1e1e1e',
    backgroundColor: '#0d0d0d',
    overflow: 'hidden',
  },
  noteHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    gap: 8,
  },
  noteIcon: { fontSize: 14 },
  noteTitle: { flex: 1, color: '#e5e5e5', fontSize: 13, fontWeight: '600' },
  noteChevron: { color: '#444', fontSize: 10 },
  noteBody: { paddingHorizontal: 12, paddingBottom: 12 },
  noteContent: { color: '#888', fontSize: 12, lineHeight: 18, fontFamily: 'monospace' },
  noteActions: { flexDirection: 'row', gap: 12, marginTop: 10 },
  noteActionBtn: {},
  noteActionText: { fontSize: 12, fontWeight: '600' },
  editor: {
    margin: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    backgroundColor: '#0d0d0d',
    overflow: 'hidden',
    padding: 12,
    gap: 8,
  },
  editorTitle: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
    borderBottomWidth: 1,
    borderBottomColor: '#1e1e1e',
    paddingBottom: 8,
  },
  editorContent: { color: '#ccc', fontSize: 12, fontFamily: 'monospace', minHeight: 80, lineHeight: 18 },
  editorActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 4 },
  editorCancelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#333',
  },
  editorCancelText: { color: '#777', fontSize: 12 },
  editorSaveBtn: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 6 },
  editorSaveText: { color: '#fff', fontSize: 12, fontWeight: '700' },
});

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AutomationsPanel({ circleId, accentColor = '#6366f1' }: Props) {
  const { automations, isLoading, refresh } = useCircleAutomations(circleId);
  const { stats, refreshStats } = useAutomationStats(circleId);
  const liveRuns = useCircleRunStream(circleId);

  // Auth
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setCurrentUserId(data.user?.id ?? null));
  }, []);

  // Filter state
  const [activeTab, setActiveTab] = useState<'mine' | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const searchRef = useRef<TextInput>(null);

  // Modal state
  const [showCreate, setShowCreate] = useState(false);
  const [editingAutomation, setEditingAutomation] = useState<CircleAutomation | null>(null);
  const [duplicatingAutomation, setDuplicatingAutomation] = useState<CircleAutomation | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [triggeringId, setTriggeringId] = useState<string | null>(null);
  const [memoryNotesFor, setMemoryNotesFor] = useState<CircleAutomation | null>(null);
  const [showRunHistory, setShowRunHistory] = useState(false);

  // Pre-fill for quick create
  const [quickPrompt, setQuickPrompt] = useState('');
  const [quickTrigger, setQuickTrigger] = useState<TriggerOption | null>(null);
  // Pre-fill for suggested template apply
  const [applyingTemplate, setApplyingTemplate] = useState<AutomationTemplate | null>(null);

  // Filtered automations
  const filteredAutomations = useMemo(() => {
    let list = automations;
    if (activeTab === 'mine' && currentUserId) {
      list = list.filter((a) => a.createdBy === currentUserId);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          (a.description ?? '').toLowerCase().includes(q),
      );
    }
    return list;
  }, [automations, activeTab, currentUserId, searchQuery]);

  const handleToggle = useCallback(async (id: string, enabled: boolean) => {
    await toggleAutomation(id, enabled);
  }, []);

  const handleTrigger = useCallback(async (id: string) => {
    setTriggeringId(id);
    setExpandedId(id); // Auto-expand log so user sees progress
    const result = await triggerAutomation(id, circleId);
    setTriggeringId(null);
    if (result.error) {
      console.warn('[Automation] Trigger error:', result.error);
    }
    // Refresh stats after run completes
    refreshStats();
  }, [circleId, refreshStats]);

  const handleDelete = useCallback(async (id: string) => {
    await deleteAutomation(id);
  }, []);

  const handleQuickCreate = (prompt: string, trigger: TriggerOption | null) => {
    setQuickPrompt(prompt);
    setQuickTrigger(trigger);
    setShowCreate(true);
  };

  const handleApplySuggested = (template: AutomationTemplate) => {
    setApplyingTemplate(template);
    setShowCreate(true);
  };

  const closeForm = () => {
    setShowCreate(false);
    setEditingAutomation(null);
    setDuplicatingAutomation(null);
    setApplyingTemplate(null);
    setQuickPrompt('');
    setQuickTrigger(null);
  };

  const onSaved = () => {
    closeForm();
    refresh();
    refreshStats();
  };

  if (isLoading) {
    return (
      <View style={s.container}>
        <ActivityIndicator size="small" color="#555" style={{ margin: 24 }} />
      </View>
    );
  }

  return (
    <View style={s.container}>
      {/* Page title */}
      <Text style={s.pageTitle}>Automations</Text>

      {/* Stats bar */}
      <StatsDashboard
        circleId={circleId}
        automationCount={automations.length}
        accentColor={accentColor}
        onRunHistory={() => setShowRunHistory(true)}
      />

      {/* Quick create bar */}
      <QuickCreateBar onSubmit={handleQuickCreate} accentColor={accentColor} />

      {/* Filter row: Mine / All + search + New */}
      <View style={s.filterRow}>
        <View style={s.tabs}>
          {(['mine', 'all'] as const).map((tab) => (
            <Pressable
              key={tab}
              onPress={() => setActiveTab(tab)}
              style={[
                s.tab,
                activeTab === tab && { backgroundColor: '#fff' },
                Platform.OS === 'web' && { cursor: 'pointer' } as any,
              ]}
            >
              <Text style={[s.tabText, activeTab === tab && { color: '#000' }]}>
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={s.filterRight}>
          {showSearch ? (
            <TextInput
              ref={searchRef}
              style={s.searchInput}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search..."
              placeholderTextColor="#555"
              autoFocus
              onBlur={() => { if (!searchQuery) setShowSearch(false); }}
            />
          ) : (
            <Pressable
              onPress={() => { setShowSearch(true); setTimeout(() => searchRef.current?.focus(), 50); }}
              style={[s.iconBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
            >
              <Text style={s.iconBtnText}>🔍</Text>
            </Pressable>
          )}
          <Pressable
            onPress={() => setShowCreate(true)}
            style={[s.newBtn, { backgroundColor: '#fff' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
          >
            <Text style={s.newBtnText}>+ New</Text>
          </Pressable>
        </View>
      </View>

      {/* Automation list OR empty state */}
      {filteredAutomations.length === 0 ? (
        <View style={s.emptyState}>
          <Text style={s.emptyTitle}>No Automations Yet</Text>
          <Text style={s.emptySubtitle}>
            Run agents on a schedule or automatically in response to events.
          </Text>
          <Pressable
            onPress={() => setShowCreate(true)}
            style={[s.emptyBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
          >
            <Text style={s.emptyBtnText}>Create Automation</Text>
          </Pressable>
        </View>
      ) : (
        <View style={s.list}>
          {/* Live run banners */}
          {liveRuns.filter(r => r.status === 'running').map(run => {
            const auto = automations.find(a => a.id === run.automationId);
            const logLines = (run.inputContext as any)?.log || [];
            const lastLog = typeof run.errorMessage === 'string' && run.status === 'running'
              ? run.errorMessage.split('\n').filter(Boolean)
              : logLines;
            return (
              <View key={`live-${run.id}`} style={{ backgroundColor: '#2a2a2a', borderWidth: 1, borderColor: '#6366f180', borderRadius: 8, padding: 10, marginBottom: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <ActivityIndicator size="small" color="#6366f1" />
                  <Text style={{ color: '#ddd', fontSize: 13, fontWeight: '700' }}>
                    Running: {auto?.name || 'Automation'}
                  </Text>
                  <Text style={{ color: '#888', fontSize: 11 }}>
                    {run.durationMs != null ? `${(run.durationMs / 1000).toFixed(1)}s` : '...'}
                  </Text>
                </View>
                {lastLog.length > 0 && (
                  <View style={{ backgroundColor: '#111', borderRadius: 4, padding: 6, marginTop: 2 }}>
                    {(Array.isArray(lastLog) ? lastLog : [lastLog]).slice(-5).map((line: string, i: number) => (
                      <Text key={i} style={{ color: '#aaa', fontSize: 10, fontFamily: 'monospace', lineHeight: 14 }}>{line}</Text>
                    ))}
                  </View>
                )}
              </View>
            );
          })}
          {/* Recently completed runs — brief success/fail flash */}
          {liveRuns.filter(r => r.status === 'completed' || r.status === 'failed').map(run => {
            const auto = automations.find(a => a.id === run.automationId);
            const isOk = run.status === 'completed';
            return (
              <View key={`done-${run.id}`} style={{ backgroundColor: isOk ? '#0a2010' : '#200a0a', borderWidth: 1, borderColor: isOk ? '#22c55e40' : '#ef444440', borderRadius: 8, padding: 10, marginBottom: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={{ fontSize: 14 }}>{isOk ? '✅' : '❌'}</Text>
                  <Text style={{ color: isOk ? '#22c55e' : '#ef4444', fontSize: 13, fontWeight: '700', flex: 1 }}>
                    {auto?.name || 'Automation'} — {isOk ? 'Completed' : 'Failed'}
                  </Text>
                  <Text style={{ color: '#888', fontSize: 11 }}>
                    {run.durationMs != null ? `${(run.durationMs / 1000).toFixed(1)}s` : ''} · {run.tokenCount} tok
                  </Text>
                </View>
                {run.outputText && isOk && (
                  <Text style={{ color: '#ccc', fontSize: 11, fontFamily: 'monospace', marginTop: 4 }} numberOfLines={3}>
                    {run.outputText.slice(0, 300)}
                  </Text>
                )}
                {run.errorMessage && !isOk && (
                  <Text style={{ color: '#ef4444', fontSize: 11, fontFamily: 'monospace', marginTop: 4 }} numberOfLines={2}>
                    {run.errorMessage}
                  </Text>
                )}
              </View>
            );
          })}
          {filteredAutomations.map((auto) => (
            <AutomationCard
              key={auto.id}
              automation={auto}
              stats={stats[auto.id]}
              expanded={expandedId === auto.id}
              triggering={triggeringId === auto.id}
              accentColor={accentColor}
              onToggle={handleToggle}
              onTrigger={handleTrigger}
              onDelete={handleDelete}
              onEdit={() => setEditingAutomation(auto)}
              onDuplicate={() => setDuplicatingAutomation(auto)}
              onExpand={() => setExpandedId(expandedId === auto.id ? null : auto.id)}
              onMemoryNotes={() => setMemoryNotesFor(auto)}
            />
          ))}
        </View>
      )}

      {/* Suggested templates (always shown below list) */}
      <SuggestedSection onApply={handleApplySuggested} accentColor={accentColor} />

      {/* ── Modals ── */}

      {(showCreate || editingAutomation || duplicatingAutomation) && (
        <AutomationFormModal
          circleId={circleId}
          accentColor={accentColor}
          editing={editingAutomation || undefined}
          duplicating={duplicatingAutomation || undefined}
          initialPrompt={quickPrompt || undefined}
          initialTrigger={quickTrigger || undefined}
          initialTemplate={applyingTemplate || undefined}
          onClose={closeForm}
          onSaved={onSaved}
        />
      )}

      {memoryNotesFor && (
        <MemoryNotesModal
          automationId={memoryNotesFor.id}
          automationName={memoryNotesFor.name}
          circleId={circleId}
          onClose={() => setMemoryNotesFor(null)}
          accentColor={accentColor}
        />
      )}

      {showRunHistory && (
        <RunHistoryModal
          circleId={circleId}
          onClose={() => setShowRunHistory(false)}
        />
      )}
    </View>
  );
}

// ─── Automation Card ──────────────────────────────────────────────────────────

function AutomationCard({
  automation: auto,
  stats,
  expanded,
  triggering,
  accentColor,
  onToggle,
  onTrigger,
  onDelete,
  onEdit,
  onDuplicate,
  onExpand,
  onMemoryNotes,
}: {
  automation: CircleAutomation;
  stats?: AutomationStats;
  expanded: boolean;
  triggering: boolean;
  accentColor: string;
  onToggle: (id: string, enabled: boolean) => void;
  onTrigger: (id: string) => void;
  onDelete: (id: string) => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onExpand: () => void;
  onMemoryNotes: () => void;
}) {
  const trigger = TRIGGER_LABELS[auto.triggerType] ?? TRIGGER_LABELS.manual;

  return (
    <View style={s.card}>
      <Pressable
        onPress={onExpand}
        style={[s.cardHeader, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
      >
        <Text style={s.cardIcon}>{auto.icon}</Text>
        <View style={s.cardInfo}>
          <Text style={s.cardName} numberOfLines={1}>{auto.name}</Text>
          <View style={s.cardMeta}>
            <View style={[s.triggerBadge, { backgroundColor: trigger.color + '25' }]}>
              <Text style={[s.triggerText, { color: trigger.color }]}>{trigger.label}</Text>
            </View>
            {auto.cronExpression && (
              <Text style={s.cardMetaText}>{auto.cronExpression}</Text>
            )}
            {auto.eventConfig?.provider && (
              <Text style={s.cardMetaText}>{auto.eventConfig.provider}</Text>
            )}
            {auto.eventConfig?.linked_goal_id && (
              <View style={[s.triggerBadge, { backgroundColor: '#22c55e25' }]}>
                <Text style={[s.triggerText, { color: '#22c55e' }]}>🎯 Goal linked</Text>
              </View>
            )}
            <Text style={s.cardMetaText}>·</Text>
            <Text style={s.cardMetaText}>Last: {timeAgo(auto.lastRunAt)}</Text>
            {auto.runCount > 0 && (
              <Text style={s.cardMetaText}>· {auto.runCount} runs</Text>
            )}
          </View>
          {stats && stats.totalRuns > 0 && (
            <View style={s.statsRow}>
              <Text
                style={[
                  s.statText,
                  {
                    color:
                      stats.successRate >= 80
                        ? '#22c55e'
                        : stats.successRate >= 50
                        ? '#f59e0b'
                        : '#ef4444',
                  },
                ]}
              >
                {stats.successRate}% ok
              </Text>
              <Text style={s.statText}>
                {stats.avgDurationMs < 1000
                  ? `${stats.avgDurationMs}ms`
                  : `${(stats.avgDurationMs / 1000).toFixed(1)}s`}{' '}
                avg
              </Text>
              {stats.totalCost > 0 && (
                <Text style={[s.statText, { color: '#f59e0b' }]}>
                  ${stats.totalCost < 0.01 ? stats.totalCost.toFixed(4) : stats.totalCost.toFixed(2)}
                </Text>
              )}
            </View>
          )}
        </View>
        <Switch
          value={auto.enabled}
          onValueChange={(val) => onToggle(auto.id, val)}
          trackColor={{ false: '#333', true: accentColor + '60' }}
          thumbColor={auto.enabled ? accentColor : '#666'}
          style={{ transform: [{ scale: 0.8 }] }}
        />
      </Pressable>

      {auto.lastError && (
        <View style={s.errorRow}>
          <Text style={s.errorText} numberOfLines={1}>⚠ {auto.lastError}</Text>
        </View>
      )}

      {auto.nextRunAt && auto.enabled && (
        <Text style={s.nextRun}>Next: {timeUntil(auto.nextRunAt)}</Text>
      )}

      {/* Actions */}
      <View style={s.cardActions}>
        <Pressable
          onPress={() => onTrigger(auto.id)}
          disabled={triggering}
          style={[s.runBtn, triggering && { backgroundColor: '#22c55e15', borderColor: '#22c55e40' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
        >
          {triggering ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <ActivityIndicator size="small" color="#22c55e" />
              <Text style={[s.runBtnText, { color: '#22c55e' }]}>Running...</Text>
            </View>
          ) : (
            <Text style={s.runBtnText}>▶ Run</Text>
          )}
        </Pressable>
        <Pressable onPress={onEdit} style={[s.actionBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
          <Text style={s.actionBtnText}>✏️</Text>
        </Pressable>
        <Pressable onPress={onMemoryNotes} style={[s.memoryBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
          <Text style={s.memoryBtnText}>🧠 Memory</Text>
        </Pressable>
        <Pressable onPress={onDuplicate} style={[s.actionBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
          <Text style={s.actionBtnText}>📋</Text>
        </Pressable>
        <Pressable onPress={onExpand} style={[s.historyBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
          <Text style={s.historyBtnText}>{expanded ? '▲' : '▼ Log'}</Text>
        </Pressable>
        <View style={{ flex: 1 }} />
        <Pressable onPress={() => onDelete(auto.id)} style={[s.deleteBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
          <Text style={s.deleteBtnText}>✕</Text>
        </Pressable>
      </View>

      {expanded && <RunHistory automationId={auto.id} />}
    </View>
  );
}

// ─── Run History (expandable) ─────────────────────────────────────────────────

function RunHistory({ automationId }: { automationId: string }) {
  const { runs, isLoading } = useAutomationRuns(automationId);

  if (isLoading) return <ActivityIndicator size="small" color="#555" style={{ padding: 8 }} />;
  if (runs.length === 0) return <Text style={s.noRuns}>No runs yet</Text>;

  return (
    <View style={s.runsList}>
      {runs.slice(0, 10).map((run) => (
        <RunRow key={run.id} run={run} />
      ))}
    </View>
  );
}

function RunRow({ run }: { run: AutomationRun }) {
  const [expanded, setExpanded] = useState(run.status === 'running');
  const logSteps: string[] = (run.inputContext as any)?.log || [];

  return (
    <View style={s.runRow}>
      <Pressable
        onPress={() => setExpanded(!expanded)}
        style={[s.runRowHeader, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
      >
        <Text style={s.runIcon}>
          {run.status === 'running' ? '🔄' : runStatusIcon(run.status)}
        </Text>
        <Text style={s.runTime}>{timeAgo(run.startedAt)}</Text>
        {run.durationMs != null && (
          <Text style={s.runDuration}>{(run.durationMs / 1000).toFixed(1)}s</Text>
        )}
        {run.tokenCount > 0 && (
          <Text style={s.runTokens}>{run.tokenCount} tok</Text>
        )}
        {run.estimatedCost > 0 && (
          <Text style={s.runCost}>${run.estimatedCost.toFixed(4)}</Text>
        )}
        {run.status === 'running' && (
          <ActivityIndicator size="small" color="#6366f1" style={{ marginLeft: 4 }} />
        )}
        <Text style={s.runChevron}>{expanded ? '▲' : '▼'}</Text>
      </Pressable>
      {expanded && (
        <View style={s.runDetail}>
          {/* Execution log */}
          {logSteps.length > 0 && (
            <View style={{ backgroundColor: '#0a0a14', borderRadius: 4, padding: 6, marginBottom: 6, borderWidth: 1, borderColor: '#2a2a2a' }}>
              <Text style={{ color: '#666', fontSize: 9, fontWeight: '800', fontFamily: 'monospace', marginBottom: 3, letterSpacing: 1 }}>EXECUTION LOG</Text>
              {logSteps.map((step: string, i: number) => (
                <Text key={i} style={{ color: step.includes('❌') ? '#ef4444' : step.includes('✓') || step.includes('✅') ? '#22c55e' : '#aaa', fontSize: 10, fontFamily: 'monospace', lineHeight: 14 }}>{step}</Text>
              ))}
            </View>
          )}
          {/* AI output */}
          {run.outputText && (
            <View style={{ marginBottom: 4 }}>
              <Text style={{ color: '#666', fontSize: 9, fontWeight: '800', fontFamily: 'monospace', marginBottom: 2, letterSpacing: 1 }}>OUTPUT</Text>
              <Text style={s.runOutput} selectable>{run.outputText.slice(0, 800)}</Text>
            </View>
          )}
          {/* Error */}
          {run.errorMessage && run.status !== 'running' && (
            <Text style={s.runError}>{run.errorMessage}</Text>
          )}
          {/* Live progress for running */}
          {run.status === 'running' && run.errorMessage && (
            <View style={{ marginBottom: 4 }}>
              <Text style={{ color: '#666', fontSize: 9, fontWeight: '800', fontFamily: 'monospace', marginBottom: 2, letterSpacing: 1 }}>PROGRESS</Text>
              {run.errorMessage.split('\n').filter(Boolean).map((line: string, i: number) => (
                <Text key={i} style={{ color: line.includes('✓') ? '#22c55e' : '#aaa', fontSize: 10, fontFamily: 'monospace', lineHeight: 14 }}>{line}</Text>
              ))}
            </View>
          )}
          {/* Meta info */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 2 }}>
            <Text style={s.runMeta}>Model: {run.modelUsed || '?'}</Text>
            <Text style={s.runMeta}>Output: {run.outputTarget || '?'}</Text>
            <Text style={s.runMeta}>Trigger: {run.triggerSource}</Text>
            {(run.inputContext as any)?.memberCount != null && (
              <Text style={s.runMeta}>Members: {(run.inputContext as any).memberCount}</Text>
            )}
            {(run.inputContext as any)?.checkedInCount != null && (
              <Text style={s.runMeta}>Checked in: {(run.inputContext as any).checkedInCount}</Text>
            )}
          </View>
        </View>
      )}
    </View>
  );
}

// ─── Automation Form Modal ────────────────────────────────────────────────────

function AutomationFormModal({
  circleId,
  accentColor,
  onClose,
  onSaved,
  editing,
  duplicating,
  initialPrompt,
  initialTrigger,
  initialTemplate,
}: {
  circleId: string;
  accentColor: string;
  onClose: () => void;
  onSaved: () => void;
  editing?: CircleAutomation;
  duplicating?: CircleAutomation;
  initialPrompt?: string;
  initialTrigger?: TriggerOption;
  initialTemplate?: AutomationTemplate;
}) {
  const prefill = editing || duplicating;
  const isEdit = !!editing;

  // Build initial trigger ID from existing automation
  const initialTriggerId = useMemo<string | null>(() => {
    if (!prefill) return null;
    if (prefill.triggerType === 'schedule' && prefill.cronExpression) return `schedule:${prefill.cronExpression}`;
    if (prefill.triggerType === 'event' && prefill.eventConfig?.table) return `event:${prefill.eventConfig.table}`;
    if (prefill.triggerType === 'manual') return 'manual:run';
    if (prefill.eventConfig?.provider && prefill.eventConfig?.event)
      return `webhook:${prefill.eventConfig.provider}:${prefill.eventConfig.event}`;
    return null;
  }, [prefill]);

  const resolveInitialTrigger = (): TriggerOption | null => {
    if (initialTrigger) return initialTrigger;
    if (initialTemplate) {
      if (initialTemplate.trigger_type === 'schedule' && initialTemplate.cron_expression)
        return getTriggerById(`schedule:${initialTemplate.cron_expression}`) ?? null;
      if (initialTemplate.trigger_type === 'event' && initialTemplate.event_config?.table)
        return getTriggerById(`event:${initialTemplate.event_config.table}`) ?? null;
      if (initialTemplate.trigger_type === 'manual') return getTriggerById('manual:run') ?? null;
      if (initialTemplate.event_config?.provider)
        return getTriggerById(`webhook:${initialTemplate.event_config.provider}:${initialTemplate.event_config.event}`) ?? null;
    }
    if (initialTriggerId) return getTriggerById(initialTriggerId) ?? null;
    return null;
  };

  const [selectedTrigger, setSelectedTrigger] = useState<TriggerOption | null>(resolveInitialTrigger);
  const [showTriggerPicker, setShowTriggerPicker] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [showMemoryNotes, setShowMemoryNotes] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(isEdit ? (editing?.id ?? null) : null);

  const [name, setName] = useState(
    initialTemplate?.name ??
    (prefill ? (duplicating ? `${prefill.name} (copy)` : prefill.name) : ''),
  );
  const [description, setDescription] = useState(
    initialTemplate?.description ?? prefill?.description ?? '',
  );
  const [icon, setIcon] = useState(initialTemplate?.icon ?? prefill?.icon ?? '⚡');
  const [prompt, setPrompt] = useState(
    initialTemplate?.prompt ?? initialPrompt ?? prefill?.prompt ?? '',
  );
  const [model, setModel] = useState(
    initialTemplate?.model ?? prefill?.model ?? 'claude-haiku',
  );
  const [outputTarget, setOutputTarget] = useState<OutputTarget>(
    (initialTemplate?.output_target as OutputTarget | undefined) ?? prefill?.outputTarget ?? 'chat',
  );
  const [includeContext, setIncludeContext] = useState<Record<string, boolean>>(
    initialTemplate?.include_context ??
    prefill?.includeContext ??
    { members: true, check_ins: true, tasks: true, streaks: true, analytics: false },
  );
  const [templateId, setTemplateId] = useState<string | null>(
    initialTemplate?.id ?? prefill?.templateId ?? null,
  );
  const [selectedSpirit, setSelectedSpirit] = useState<string | null>(
    initialTemplate?.spirit ?? (prefill as any)?.spirit ?? null,
  );
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // ── Link to Feed (goal + task) ──
  type LinkMode = 'none' | 'existing' | 'new_goal' | 'new_goal_task' | 'new_task';
  const [linkMode, setLinkMode] = useState<LinkMode>(
    prefill?.eventConfig?.linked_goal_id ? 'existing' : 'none',
  );
  const [linkedGoalId, setLinkedGoalId] = useState<string | null>(
    prefill?.eventConfig?.linked_goal_id ?? null,
  );
  const [newGoalName, setNewGoalName] = useState('');
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [availableGoals, setAvailableGoals] = useState<{ id: string; name: string; status: string }[]>([]);
  const [goalsLoaded, setGoalsLoaded] = useState(false);

  useEffect(() => {
    if (goalsLoaded) return;
    supabase
      .from('goals')
      .select('id, name, status')
      .eq('circle_id', circleId)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (data) setAvailableGoals(data);
        setGoalsLoaded(true);
      });
  }, [circleId, goalsLoaded]);

  const currentModel = MODEL_OPTIONS.find((m) => m.value === model) ?? MODEL_OPTIONS[0];

  const applyTemplate = (t: AutomationTemplate) => {
    setTemplateId(t.id);
    setName(t.name);
    setDescription(t.description);
    setIcon(t.icon);
    setPrompt(t.prompt);
    setModel(t.model);
    setOutputTarget(t.output_target as OutputTarget);
    setIncludeContext(t.include_context);
    setSelectedSpirit(t.spirit ?? null);

    if (t.trigger_type === 'schedule' && t.cron_expression)
      setSelectedTrigger(getTriggerById(`schedule:${t.cron_expression}`) ?? null);
    else if (t.trigger_type === 'event' && t.event_config?.table)
      setSelectedTrigger(getTriggerById(`event:${t.event_config.table}`) ?? null);
    else if (t.trigger_type === 'manual')
      setSelectedTrigger(getTriggerById('manual:run') ?? null);
    else if (t.event_config?.provider)
      setSelectedTrigger(getTriggerById(`webhook:${t.event_config.provider}:${t.event_config.event}`) ?? null);
  };

  const buildTriggerPayload = () => {
    // Map 'webhook' → 'event' for DB (constraint only allows schedule/event/manual)
    const rawType = selectedTrigger?.triggerType ?? 'manual';
    const triggerType: TriggerType = rawType === 'webhook' ? 'event' : rawType;
    const cronExpression = selectedTrigger?.cronExpression;
    const eventConfig = selectedTrigger?.eventTable
      ? { table: selectedTrigger.eventTable, event: 'INSERT' }
      : selectedTrigger?.webhookProvider
      ? { provider: selectedTrigger.webhookProvider, event: selectedTrigger.webhookEvent }
      : undefined;
    return { triggerType, cronExpression, eventConfig };
  };

  const handleSave = async () => {
    if (!name.trim() || !prompt.trim()) {
      setError('Name and prompt are required');
      return;
    }
    setSaving(true);
    setError('');

    const { triggerType, cronExpression, eventConfig } = buildTriggerPayload();

    // ── Create linked goal / task if requested ──
    let finalGoalId = linkedGoalId;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user && (linkMode === 'new_goal' || linkMode === 'new_goal_task') && newGoalName.trim()) {
        const { data: goalData } = await supabase.from('goals').insert({
          circle_id: circleId,
          name: newGoalName.trim(),
          description: `Auto-created from automation: ${name.trim()}`,
          status: 'active',
          assigned_agent_ids: [],
          target_count: 0,
          created_by: user.id,
        }).select('id').single();
        if (goalData) finalGoalId = goalData.id;
      }
      if (user && (linkMode === 'new_goal_task' || linkMode === 'new_task') && newTaskTitle.trim()) {
        const taskGoalId = finalGoalId;
        await supabase.from('tasks').insert({
          circle_id: circleId,
          created_by: user.id,
          title: newTaskTitle.trim(),
          description: `Linked to automation: ${name.trim()}`,
          priority: 'normal',
          status: 'todo',
          goal_id: taskGoalId || null,
          position: 0,
        });
      }
    } catch (e) {
      console.error('Failed to create linked goal/task:', e);
    }

    // Merge linked_goal_id into eventConfig
    const mergedEventConfig = finalGoalId
      ? { ...(eventConfig || {}), linked_goal_id: finalGoalId }
      : eventConfig;

    // Resolve spirit prompt for server-side injection
    const spiritObj = selectedSpirit ? getSpiritById(selectedSpirit) : null;
    const spiritPrompt = spiritObj?.systemPromptPrefix ?? null;

    if (isEdit && editing) {
      const result = await updateAutomation(editing.id, {
        name: name.trim(),
        description: description.trim(),
        icon,
        prompt: prompt.trim(),
        model,
        cronExpression,
        eventConfig: mergedEventConfig,
        includeContext,
        outputTarget,
        spirit: selectedSpirit,
        spiritPrompt,
      });
      setSaving(false);
      if (result.error) { setError(result.error); return; }
      onSaved();
    } else {
      const input: CreateAutomationInput = {
        circleId,
        name: name.trim(),
        description: description.trim() || undefined,
        icon,
        triggerType,
        cronExpression,
        eventConfig: mergedEventConfig,
        prompt: prompt.trim(),
        model,
        includeContext,
        outputTarget,
        templateId: templateId || undefined,
        spirit: selectedSpirit || undefined,
        spiritPrompt: spiritPrompt || undefined,
      };
      const result = await createAutomation(input);
      setSaving(false);
      if (result.error) { setError(result.error); return; }
      setSavedId(result.automation?.id ?? null);
      onSaved();
    }
  };

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={f.backdrop} onPress={onClose}>
        <Pressable style={f.sheet} onPress={(e) => e.stopPropagation()}>
          <ScrollView showsVerticalScrollIndicator={false}>

            {/* Header */}
            <View style={f.headerRow}>
              <Text style={f.title}>{isEdit ? 'Edit Automation' : 'New Automation'}</Text>
              <Pressable
                onPress={() => setShowMemoryNotes(true)}
                style={[f.memoryHeaderBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
              >
                <Text style={f.memoryHeaderText}>🧠 Memory</Text>
              </Pressable>
            </View>

            {/* Template gallery — accordion by category */}
            <Text style={f.label}>TEMPLATES</Text>
            {TEMPLATE_CATEGORIES.map((cat) => {
              const catTemplates = AUTOMATION_TEMPLATES.filter((t) => t.category === cat.key);
              if (catTemplates.length === 0) return null;
              const isExpanded = expandedCategory === cat.key;
              return (
                <View key={cat.key} style={{ marginBottom: 6 }}>
                  <Pressable
                    onPress={() => setExpandedCategory(isExpanded ? null : cat.key)}
                    style={[f.accordionHeader, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                  >
                    <Text style={f.accordionIcon}>{cat.icon}</Text>
                    <Text style={f.accordionLabel}>{cat.label}</Text>
                    <Text style={f.accordionCount}>{catTemplates.length}</Text>
                    <Text style={f.accordionChevron}>{isExpanded ? '▴' : '▾'}</Text>
                  </Pressable>
                  {isExpanded && (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={f.templateScroll}>
                      {catTemplates.map((t) => (
                        <Pressable
                          key={t.id}
                          onPress={() => applyTemplate(t)}
                          style={[
                            f.templateChip,
                            templateId === t.id && { borderColor: accentColor, backgroundColor: accentColor + '15' },
                            Platform.OS === 'web' && { cursor: 'pointer' } as any,
                          ]}
                        >
                          <Text style={f.templateIcon}>{t.icon}</Text>
                          <Text style={[f.templateName, templateId === t.id && { color: accentColor }]}>{t.name}</Text>
                          {t.spirit && (() => {
                            const sp = getSpiritById(t.spirit);
                            return sp ? <Text style={{ fontSize: 10, marginLeft: 2 }}>{sp.emoji}</Text> : null;
                          })()}
                        </Pressable>
                      ))}
                    </ScrollView>
                  )}
                </View>
              );
            })}

            {/* Name */}
            <Text style={f.label}>NAME</Text>
            <TextInput
              style={f.input}
              value={name}
              onChangeText={setName}
              placeholder="e.g. Daily Standup Summary"
              placeholderTextColor="#555"
            />

            {/* Trigger */}
            <Text style={f.label}>TRIGGER</Text>
            {selectedTrigger ? (
              <View style={f.selectedTriggerRow}>
                <View style={[f.selectedTriggerPill, { borderColor: (TRIGGER_LABELS[selectedTrigger.triggerType]?.color ?? '#6366f1') + '60' }]}>
                  <Text style={f.selectedTriggerIcon}>{selectedTrigger.icon}</Text>
                  <View>
                    <Text style={[f.selectedTriggerLabel, { color: TRIGGER_LABELS[selectedTrigger.triggerType]?.color ?? '#6366f1' }]}>
                      {selectedTrigger.label}
                    </Text>
                    <Text style={f.selectedTriggerCat}>{selectedTrigger.category}</Text>
                  </View>
                  <Pressable
                    onPress={() => setSelectedTrigger(null)}
                    style={[f.clearTriggerBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                  >
                    <Text style={f.clearTriggerText}>✕</Text>
                  </Pressable>
                </View>
                <Pressable
                  onPress={() => setShowTriggerPicker(true)}
                  style={[f.changeTriggerBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                >
                  <Text style={f.changeTriggerText}>Change</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable
                onPress={() => setShowTriggerPicker(true)}
                style={[f.addTriggerBtn, { borderColor: accentColor + '40' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
              >
                <Text style={[f.addTriggerPlus, { color: accentColor }]}>+</Text>
                <Text style={[f.addTriggerText, { color: accentColor }]}>Add Trigger</Text>
              </Pressable>
            )}

            {/* Prompt */}
            <Text style={f.label}>INSTRUCTIONS</Text>
            <TextInput
              style={[f.input, f.promptInput]}
              value={prompt}
              onChangeText={setPrompt}
              placeholder="What should the AI do? Use {{circle_name}}, {{member_count}}, {{event}}, etc."
              placeholderTextColor="#555"
              multiline
              numberOfLines={5}
              textAlignVertical="top"
            />

            {/* Model */}
            <Text style={f.label}>MODEL</Text>
            <Pressable
              onPress={() => setShowModelPicker(true)}
              style={[f.modelDropdown, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
            >
              <View style={[f.modelDot, { backgroundColor: currentModel.color }]} />
              <Text style={[f.modelLabel, { color: currentModel.color }]}>{currentModel.label}</Text>
              <Text style={f.modelSub}>{currentModel.sub}</Text>
              <View style={{ flex: 1 }} />
              <Text style={f.modelChevron}>▾</Text>
            </Pressable>

            {/* Spirit */}
            <Text style={f.label}>SOUL / SPIRIT</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }}>
              <View style={f.chipRow}>
                <Pressable
                  onPress={() => setSelectedSpirit(null)}
                  style={[
                    f.chip,
                    !selectedSpirit && { borderColor: '#555', backgroundColor: '#ffffff08' },
                    Platform.OS === 'web' && { cursor: 'pointer' } as any,
                  ]}
                >
                  <Text style={[f.chipText, !selectedSpirit && { color: '#aaa' }]}>None</Text>
                </Pressable>
                {AGENT_SPIRITS.map((sp) => (
                  <Pressable
                    key={sp.id}
                    onPress={() => setSelectedSpirit(sp.id)}
                    style={[
                      f.chip,
                      selectedSpirit === sp.id && { borderColor: sp.color, backgroundColor: sp.color + '20' },
                      Platform.OS === 'web' && { cursor: 'pointer' } as any,
                    ]}
                  >
                    <Text style={[f.chipText, selectedSpirit === sp.id && { color: sp.color }]}>
                      {sp.emoji} {sp.name}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
            {selectedSpirit && (() => {
              const sp = getSpiritById(selectedSpirit);
              return sp ? (
                <Text style={{ color: '#555', fontSize: 10, marginBottom: 8, fontStyle: 'italic' }}>
                  {sp.tagline}
                </Text>
              ) : null;
            })()}

            {/* Output */}
            <Text style={f.label}>OUTPUT</Text>
            <View style={f.chipRow}>
              {(['chat', 'activity', 'webhook', 'silent'] as OutputTarget[]).map((t) => (
                <Pressable
                  key={t}
                  onPress={() => setOutputTarget(t)}
                  style={[
                    f.chip,
                    outputTarget === t && { borderColor: accentColor, backgroundColor: accentColor + '20' },
                    Platform.OS === 'web' && { cursor: 'pointer' } as any,
                  ]}
                >
                  <Text style={[f.chipText, outputTarget === t && { color: accentColor }]}>
                    {OUTPUT_LABELS[t]}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Context */}
            <Text style={f.label}>CONTEXT</Text>
            <View style={f.contextRow}>
              {(['members', 'check_ins', 'tasks', 'streaks', 'analytics'] as const).map((key) => (
                <Pressable
                  key={key}
                  onPress={() => setIncludeContext((prev) => ({ ...prev, [key]: !prev[key] }))}
                  style={[f.contextToggle, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                >
                  <Text style={[f.contextText, includeContext[key] && { color: '#22c55e' }]}>
                    {includeContext[key] ? '☑' : '☐'} {key.replace('_', ' ')}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Link to Feed — goal + task */}
            <Text style={f.label}>LINK TO FEED</Text>
            <View style={f.chipRow}>
              {([
                ['none', 'No link'],
                ['existing', 'Existing Goal'],
                ['new_goal', 'New Goal'],
                ['new_goal_task', 'New Goal + Task'],
                ['new_task', 'New Task'],
              ] as [LinkMode, string][]).map(([mode, label]) => (
                <Pressable
                  key={mode}
                  onPress={() => { setLinkMode(mode); if (mode === 'none') { setLinkedGoalId(null); setNewGoalName(''); setNewTaskTitle(''); } }}
                  style={[
                    f.chip,
                    linkMode === mode && { borderColor: '#22c55e', backgroundColor: '#22c55e20' },
                    Platform.OS === 'web' && { cursor: 'pointer' } as any,
                  ]}
                >
                  <Text style={[f.chipText, linkMode === mode && { color: '#22c55e' }]}>{label}</Text>
                </Pressable>
              ))}
            </View>

            {linkMode === 'existing' && (
              <View style={{ marginTop: 6, marginBottom: 8 }}>
                <Text style={[f.label, { marginTop: 0, marginBottom: 4 }]}>SELECT GOAL</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={f.chipRow}>
                    {availableGoals.map((g) => (
                      <Pressable
                        key={g.id}
                        onPress={() => setLinkedGoalId(g.id)}
                        style={[
                          f.chip,
                          linkedGoalId === g.id && { borderColor: '#22c55e', backgroundColor: '#22c55e20' },
                          Platform.OS === 'web' && { cursor: 'pointer' } as any,
                        ]}
                      >
                        <Text style={[f.chipText, linkedGoalId === g.id && { color: '#22c55e' }]}>
                          🎯 {g.name}
                        </Text>
                      </Pressable>
                    ))}
                    {availableGoals.length === 0 && (
                      <Text style={{ color: '#555', fontSize: 11 }}>No goals yet — create one below</Text>
                    )}
                  </View>
                </ScrollView>
              </View>
            )}

            {(linkMode === 'new_goal' || linkMode === 'new_goal_task') && (
              <View style={{ marginTop: 6 }}>
                <Text style={[f.label, { marginTop: 0, marginBottom: 4 }]}>NEW GOAL NAME</Text>
                <TextInput
                  style={f.input}
                  value={newGoalName}
                  onChangeText={setNewGoalName}
                  placeholder="e.g. Ship v2 by Friday"
                  placeholderTextColor="#555"
                />
              </View>
            )}

            {(linkMode === 'new_goal_task' || linkMode === 'new_task') && (
              <View style={{ marginTop: linkMode === 'new_task' ? 6 : 0 }}>
                <Text style={[f.label, { marginTop: 0, marginBottom: 4 }]}>NEW TASK TITLE</Text>
                <TextInput
                  style={f.input}
                  value={newTaskTitle}
                  onChangeText={setNewTaskTitle}
                  placeholder="e.g. Set up CI pipeline"
                  placeholderTextColor="#555"
                />
                {linkMode === 'new_task' && availableGoals.length > 0 && (
                  <View style={{ marginTop: 4 }}>
                    <Text style={[f.label, { marginTop: 0, marginBottom: 4 }]}>ATTACH TO GOAL (optional)</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      <View style={f.chipRow}>
                        <Pressable
                          onPress={() => setLinkedGoalId(null)}
                          style={[f.chip, !linkedGoalId && { borderColor: '#555', backgroundColor: '#ffffff08' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                        >
                          <Text style={[f.chipText, !linkedGoalId && { color: '#aaa' }]}>None</Text>
                        </Pressable>
                        {availableGoals.map((g) => (
                          <Pressable
                            key={g.id}
                            onPress={() => setLinkedGoalId(g.id)}
                            style={[f.chip, linkedGoalId === g.id && { borderColor: '#22c55e', backgroundColor: '#22c55e20' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                          >
                            <Text style={[f.chipText, linkedGoalId === g.id && { color: '#22c55e' }]}>🎯 {g.name}</Text>
                          </Pressable>
                        ))}
                      </View>
                    </ScrollView>
                  </View>
                )}
              </View>
            )}

            {/* Memory notes section */}
            <View style={f.memorySection}>
              <View style={f.memorySectionRow}>
                <Text style={f.label}>MEMORY NOTES</Text>
                <Pressable
                  onPress={() => setShowMemoryNotes(true)}
                  style={[Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                >
                  <Text style={[f.memoryManageText, { color: accentColor }]}>Manage →</Text>
                </Pressable>
              </View>
              <Text style={f.memorySub}>
                {savedId
                  ? 'View and edit memory-tool files that agents use as context.'
                  : 'Save this automation to enable and configure memory notes.'}
              </Text>
            </View>

            {error ? <Text style={f.errorMsg}>{error}</Text> : null}

            {/* Buttons */}
            <View style={f.btnRow}>
              <Pressable
                onPress={onClose}
                style={[f.cancelBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
              >
                <Text style={f.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleSave}
                disabled={saving}
                style={[f.saveBtn, { backgroundColor: accentColor, opacity: saving ? 0.6 : 1 }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={f.saveText}>{isEdit ? 'Save' : 'Create'}</Text>
                )}
              </Pressable>
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>

      {showTriggerPicker && (
        <TriggerPickerModal
          onSelect={setSelectedTrigger}
          onClose={() => setShowTriggerPicker(false)}
        />
      )}

      {showModelPicker && (
        <ModelPickerModal
          selected={model}
          onSelect={setModel}
          onClose={() => setShowModelPicker(false)}
        />
      )}

      {showMemoryNotes && (
        <MemoryNotesModal
          automationId={savedId}
          automationName={name || 'New Automation'}
          circleId={circleId}
          onClose={() => setShowMemoryNotes(false)}
          accentColor={accentColor}
        />
      )}
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: {
    paddingHorizontal: 12,
    paddingTop: 16,
    paddingBottom: 24,
  },
  pageTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 14,
  },

  // Filter row
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  tabs: {
    flexDirection: 'row',
    backgroundColor: '#000000',
    borderRadius: 8,
    padding: 3,
    gap: 2,
  },
  tab: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 6,
  },
  tabText: {
    color: '#888',
    fontSize: 12,
    fontWeight: '600',
  },
  filterRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconBtn: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconBtnText: { fontSize: 16 },
  searchInput: {
    color: '#fff',
    fontSize: 13,
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    width: 120,
    fontFamily: 'monospace',
  },
  newBtn: {
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  newBtnText: {
    color: '#000',
    fontSize: 12,
    fontWeight: '700',
  },

  // List
  list: { gap: 6, marginBottom: 4 },

  // Empty state
  emptyState: {
    backgroundColor: '#0d0d0d',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#000000',
    padding: 32,
    alignItems: 'center',
    marginBottom: 8,
  },
  emptyTitle: {
    color: '#e5e5e5',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 8,
  },
  emptySubtitle: {
    color: '#666',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
    maxWidth: 280,
  },
  emptyBtn: {
    marginTop: 16,
    backgroundColor: '#000000',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  emptyBtnText: { color: '#e5e5e5', fontSize: 13, fontWeight: '600' },

  // Card
  card: {
    backgroundColor: '#111',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#000000',
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    gap: 8,
  },
  cardIcon: { fontSize: 18 },
  cardInfo: { flex: 1 },
  cardName: { color: '#fff', fontSize: 13, fontWeight: '700' },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3, flexWrap: 'wrap' },
  cardMetaText: { color: '#666', fontSize: 10, fontFamily: 'monospace' },
  triggerBadge: { borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  triggerText: { fontSize: 9, fontWeight: '800', fontFamily: 'monospace' },
  statsRow: { flexDirection: 'row', gap: 10, marginTop: 3 },
  statText: { color: '#555', fontSize: 9, fontFamily: 'monospace' },
  errorRow: { paddingHorizontal: 10, paddingBottom: 4 },
  errorText: { color: '#ef4444', fontSize: 10, fontFamily: 'monospace' },
  nextRun: { color: '#555', fontSize: 10, fontFamily: 'monospace', paddingHorizontal: 10, paddingBottom: 4 },

  // Card actions
  cardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingBottom: 8,
    gap: 6,
    flexWrap: 'wrap',
  },
  runBtn: { backgroundColor: '#22c55e15', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 },
  runBtnText: { color: '#22c55e', fontSize: 11, fontWeight: '700', fontFamily: 'monospace' },
  actionBtn: { backgroundColor: '#1e1e1e', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  actionBtnText: { fontSize: 12 },
  memoryBtn: { backgroundColor: '#8b5cf615', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  memoryBtnText: { color: '#8b5cf6', fontSize: 11, fontWeight: '700', fontFamily: 'monospace' },
  historyBtn: { backgroundColor: '#6366f115', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  historyBtnText: { color: '#6366f1', fontSize: 11, fontWeight: '700', fontFamily: 'monospace' },
  deleteBtn: { padding: 4 },
  deleteBtnText: { color: '#444', fontSize: 12 },

  // Run history
  noRuns: { color: '#555', fontSize: 11, fontFamily: 'monospace', padding: 10, textAlign: 'center' },
  runsList: { borderTopWidth: 1, borderTopColor: '#000000' },
  runRow: { borderBottomWidth: 1, borderBottomColor: '#0f0f0f' },
  runRowHeader: { flexDirection: 'row', alignItems: 'center', padding: 8, paddingHorizontal: 10, gap: 8 },
  runIcon: { fontSize: 12 },
  runTime: { color: '#888', fontSize: 10, fontFamily: 'monospace' },
  runDuration: { color: '#555', fontSize: 10, fontFamily: 'monospace' },
  runTokens: { color: '#555', fontSize: 10, fontFamily: 'monospace' },
  runCost: { color: '#f59e0b', fontSize: 10, fontFamily: 'monospace' },
  runChevron: { color: '#444', fontSize: 9, marginLeft: 'auto' },
  runDetail: { paddingHorizontal: 10, paddingBottom: 10, backgroundColor: '#000000' },
  runOutput: { color: '#ccc', fontSize: 11, fontFamily: 'monospace', lineHeight: 16 },
  runError: { color: '#ef4444', fontSize: 11, fontFamily: 'monospace', marginTop: 4 },
  runMeta: { color: '#444', fontSize: 9, fontFamily: 'monospace', marginTop: 6 },
});

// ─── Form styles ──────────────────────────────────────────────────────────────

const f = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  sheet: {
    backgroundColor: '#111',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#222',
    padding: 20,
    width: '100%',
    maxWidth: 500,
    maxHeight: '92%',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  title: { color: '#fff', fontSize: 18, fontWeight: '800' },
  memoryHeaderBtn: {
    backgroundColor: '#8b5cf615',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: '#8b5cf630',
  },
  memoryHeaderText: { color: '#8b5cf6', fontSize: 11, fontWeight: '700' },
  label: {
    color: '#6B7280',
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'monospace',
    letterSpacing: 1,
    marginTop: 12,
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#000000',
    borderWidth: 1,
    borderColor: '#222',
    borderRadius: 8,
    color: '#fff',
    fontSize: 13,
    padding: 10,
    fontFamily: 'monospace',
  },
  promptInput: { minHeight: 100, textAlignVertical: 'top' },

  // Trigger
  addTriggerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  addTriggerPlus: { fontSize: 16, fontWeight: '700' },
  addTriggerText: { fontSize: 13, fontWeight: '600' },
  selectedTriggerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  selectedTriggerPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: '#0d0d0d',
  },
  selectedTriggerIcon: { fontSize: 16 },
  selectedTriggerLabel: { fontSize: 13, fontWeight: '700' },
  selectedTriggerCat: { color: '#555', fontSize: 10 },
  clearTriggerBtn: { marginLeft: 'auto', padding: 4 },
  clearTriggerText: { color: '#555', fontSize: 12 },
  changeTriggerBtn: { paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderColor: '#333', borderRadius: 8 },
  changeTriggerText: { color: '#888', fontSize: 11 },

  // Model dropdown
  modelDropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#000000',
    borderWidth: 1,
    borderColor: '#222',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  modelDot: { width: 8, height: 8, borderRadius: 4 },
  modelLabel: { fontSize: 13, fontWeight: '700' },
  modelSub: { color: '#555', fontSize: 11 },
  modelChevron: { color: '#555', fontSize: 14 },

  // Chips
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderWidth: 1, borderColor: '#333', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 5 },
  chipText: { color: '#888', fontSize: 11, fontWeight: '600', fontFamily: 'monospace' },

  // Templates
  // Accordion template categories
  accordionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  accordionIcon: { fontSize: 12 },
  accordionLabel: { color: '#9090a8', fontSize: 11, fontWeight: '700', fontFamily: 'monospace', flex: 1 },
  accordionCount: { color: '#555', fontSize: 10, fontWeight: '600', fontFamily: 'monospace', backgroundColor: '#1a1a1a', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 },
  accordionChevron: { color: '#555', fontSize: 10, marginLeft: 2 },
  templateScroll: { marginBottom: 4 },
  templateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#222',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginRight: 6,
    gap: 4,
  },
  templateIcon: { fontSize: 14 },
  templateName: { color: '#888', fontSize: 11, fontWeight: '600' },

  // Context
  contextRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  contextToggle: {},
  contextText: { color: '#666', fontSize: 11, fontFamily: 'monospace' },

  // Memory notes section
  memorySection: {
    marginTop: 16,
    padding: 12,
    backgroundColor: '#000000',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#000000',
  },
  memorySectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  memoryManageText: { fontSize: 11, fontWeight: '700' },
  memorySub: { color: '#555', fontSize: 11, marginTop: 4 },

  errorMsg: { color: '#ef4444', fontSize: 11, marginTop: 8 },

  // Buttons
  btnRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 16, paddingBottom: 4 },
  cancelBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '#333' },
  cancelText: { color: '#888', fontSize: 13, fontWeight: '600' },
  saveBtn: { paddingHorizontal: 20, paddingVertical: 8, borderRadius: 8 },
  saveText: { color: '#fff', fontSize: 13, fontWeight: '700' },
});
