/**
 * AutomationsPanel.tsx — Circle Automations UI
 *
 * Cursor-style always-on automations panel.
 * Lives inside OfficeTab as a collapsible section.
 */

import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, Modal, TextInput,
  Switch, ActivityIndicator, Platform, FlatList,
} from 'react-native';
import {
  useCircleAutomations, useAutomationRuns,
  createAutomation, deleteAutomation, toggleAutomation, triggerAutomation,
  CircleAutomation, AutomationRun, CreateAutomationInput,
  TriggerType, OutputTarget,
} from '../services/automationService';
import { AUTOMATION_TEMPLATES, AutomationTemplate, TEMPLATE_CATEGORIES } from '../lib/automationTemplates';

// ─── Props ───────────────────────────────────────────────────────────────────

interface Props {
  circleId: string;
  accentColor?: string;
}

// ─── Time helpers ────────────────────────────────────────────────────────────

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

// ─── Trigger/output labels ──────────────────────────────────────────────────

const TRIGGER_LABELS: Record<TriggerType, { label: string; color: string }> = {
  schedule: { label: 'SCHEDULE', color: '#6366f1' },
  event: { label: 'EVENT', color: '#f59e0b' },
  manual: { label: 'MANUAL', color: '#22c55e' },
};

const OUTPUT_LABELS: Record<OutputTarget, string> = {
  chat: 'Chat',
  activity: 'Activity Feed',
  webhook: 'Webhook',
  silent: 'Silent',
};

const CRON_OPTIONS = [
  { value: 'hourly', label: 'Every hour' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];

const MODEL_OPTIONS = [
  { value: 'claude-haiku', label: 'Haiku (fast, cheap)' },
  { value: 'claude-sonnet', label: 'Sonnet (balanced)' },
  { value: 'claude-opus', label: 'Opus (powerful)' },
];

const EVENT_TABLE_OPTIONS = [
  { value: 'check_ins', label: 'Check-ins' },
  { value: 'circle_members', label: 'New members' },
];

// ─── Status icon helper ─────────────────────────────────────────────────────

function runStatusIcon(status: string): string {
  switch (status) {
    case 'completed': return '✅';
    case 'failed': return '❌';
    case 'running': return '⏳';
    case 'skipped': return '⏭️';
    default: return '·';
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function AutomationsPanel({ circleId, accentColor = '#6366f1' }: Props) {
  const { automations, isLoading, refresh } = useCircleAutomations(circleId);
  const [collapsed, setCollapsed] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [triggeringId, setTriggeringId] = useState<string | null>(null);

  const handleToggle = useCallback(async (id: string, enabled: boolean) => {
    await toggleAutomation(id, enabled);
  }, []);

  const handleTrigger = useCallback(async (id: string) => {
    setTriggeringId(id);
    await triggerAutomation(id, circleId);
    setTriggeringId(null);
    // Refresh will happen via realtime
  }, [circleId]);

  const handleDelete = useCallback(async (id: string) => {
    await deleteAutomation(id);
  }, []);

  if (isLoading) {
    return (
      <View style={s.container}>
        <ActivityIndicator size="small" color="#555" />
      </View>
    );
  }

  return (
    <View style={s.container}>
      {/* Header */}
      <Pressable
        onPress={() => setCollapsed(!collapsed)}
        style={[s.header, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
      >
        <Text style={s.headerIcon}>⚡</Text>
        <Text style={s.headerLabel}>AUTOMATIONS</Text>
        {automations.length > 0 && (
          <View style={[s.countBadge, { backgroundColor: accentColor + '30' }]}>
            <Text style={[s.countText, { color: accentColor }]}>{automations.length}</Text>
          </View>
        )}
        <View style={{ flex: 1 }} />
        {!collapsed && (
          <Pressable
            onPress={(e) => { e.stopPropagation(); setShowCreate(true); }}
            style={[s.addBtn, { borderColor: accentColor + '40' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
          >
            <Text style={[s.addBtnText, { color: accentColor }]}>+ NEW</Text>
          </Pressable>
        )}
        <Text style={s.chevron}>{collapsed ? '▶' : '▼'}</Text>
      </Pressable>

      {!collapsed && (
        <View style={s.body}>
          {automations.length === 0 ? (
            <View style={s.empty}>
              <Text style={s.emptyText}>No automations yet</Text>
              <Text style={s.emptySubtext}>Create one from a template or build your own</Text>
              <Pressable
                onPress={() => setShowCreate(true)}
                style={[s.emptyBtn, { backgroundColor: accentColor }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
              >
                <Text style={s.emptyBtnText}>Create Automation</Text>
              </Pressable>
            </View>
          ) : (
            automations.map((auto) => (
              <AutomationCard
                key={auto.id}
                automation={auto}
                expanded={expandedId === auto.id}
                onToggle={handleToggle}
                onTrigger={handleTrigger}
                onDelete={handleDelete}
                onExpand={() => setExpandedId(expandedId === auto.id ? null : auto.id)}
                triggering={triggeringId === auto.id}
                accentColor={accentColor}
              />
            ))
          )}
        </View>
      )}

      {showCreate && (
        <CreateAutomationModal
          circleId={circleId}
          accentColor={accentColor}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); refresh(); }}
        />
      )}
    </View>
  );
}

// ─── Automation Card ─────────────────────────────────────────────────────────

function AutomationCard({
  automation: auto, expanded, onToggle, onTrigger, onDelete, onExpand, triggering, accentColor,
}: {
  automation: CircleAutomation;
  expanded: boolean;
  onToggle: (id: string, enabled: boolean) => void;
  onTrigger: (id: string) => void;
  onDelete: (id: string) => void;
  onExpand: () => void;
  triggering: boolean;
  accentColor: string;
}) {
  const trigger = TRIGGER_LABELS[auto.triggerType];

  return (
    <View style={s.card}>
      <Pressable onPress={onExpand} style={[s.cardHeader, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
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
            <Text style={s.cardMetaText}>·</Text>
            <Text style={s.cardMetaText}>Last: {timeAgo(auto.lastRunAt)}</Text>
            {auto.runCount > 0 && (
              <Text style={s.cardMetaText}>· {auto.runCount} runs</Text>
            )}
          </View>
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

      {/* Action buttons */}
      <View style={s.cardActions}>
        <Pressable
          onPress={() => onTrigger(auto.id)}
          disabled={triggering}
          style={[s.runBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
        >
          {triggering ? (
            <ActivityIndicator size="small" color="#22c55e" />
          ) : (
            <Text style={s.runBtnText}>▶ Run Now</Text>
          )}
        </Pressable>
        <Pressable
          onPress={onExpand}
          style={[s.historyBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
        >
          <Text style={s.historyBtnText}>{expanded ? '▲ Hide' : '▼ History'}</Text>
        </Pressable>
        <View style={{ flex: 1 }} />
        <Pressable
          onPress={() => onDelete(auto.id)}
          style={[s.deleteBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
        >
          <Text style={s.deleteBtnText}>✕</Text>
        </Pressable>
      </View>

      {expanded && <RunHistory automationId={auto.id} />}
    </View>
  );
}

// ─── Run History (expandable) ────────────────────────────────────────────────

function RunHistory({ automationId }: { automationId: string }) {
  const { runs, isLoading } = useAutomationRuns(automationId);

  if (isLoading) {
    return <ActivityIndicator size="small" color="#555" style={{ padding: 8 }} />;
  }

  if (runs.length === 0) {
    return <Text style={s.noRuns}>No runs yet</Text>;
  }

  return (
    <View style={s.runsList}>
      {runs.slice(0, 10).map((run) => (
        <RunRow key={run.id} run={run} />
      ))}
    </View>
  );
}

function RunRow({ run }: { run: AutomationRun }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <View style={s.runRow}>
      <Pressable
        onPress={() => setExpanded(!expanded)}
        style={[s.runRowHeader, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
      >
        <Text style={s.runIcon}>{runStatusIcon(run.status)}</Text>
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
        <Text style={s.runChevron}>{expanded ? '▲' : '▼'}</Text>
      </Pressable>
      {expanded && (
        <View style={s.runDetail}>
          {run.outputText && (
            <Text style={s.runOutput} selectable>{run.outputText.slice(0, 500)}</Text>
          )}
          {run.errorMessage && (
            <Text style={s.runError}>{run.errorMessage}</Text>
          )}
          <Text style={s.runMeta}>
            Model: {run.modelUsed || '?'} · Output: {run.outputTarget || '?'} · Trigger: {run.triggerSource}
          </Text>
        </View>
      )}
    </View>
  );
}

// ─── Create Automation Modal ─────────────────────────────────────────────────

function CreateAutomationModal({
  circleId, accentColor, onClose, onCreated,
}: {
  circleId: string;
  accentColor: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState('⚡');
  const [triggerType, setTriggerType] = useState<TriggerType>('schedule');
  const [cronExpression, setCronExpression] = useState('daily');
  const [eventTable, setEventTable] = useState('check_ins');
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState('claude-haiku');
  const [outputTarget, setOutputTarget] = useState<OutputTarget>('chat');
  const [includeContext, setIncludeContext] = useState({ members: true, check_ins: true, tasks: true, streaks: true, analytics: false });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);

  const applyTemplate = (t: AutomationTemplate) => {
    setSelectedTemplateId(t.id);
    setName(t.name);
    setDescription(t.description);
    setIcon(t.icon);
    setTriggerType(t.trigger_type);
    if (t.cron_expression) setCronExpression(t.cron_expression);
    if (t.event_config?.table) setEventTable(t.event_config.table);
    setPrompt(t.prompt);
    setModel(t.model);
    setOutputTarget(t.output_target);
    setIncludeContext(t.include_context as any);
  };

  const handleCreate = async () => {
    if (!name.trim() || !prompt.trim()) {
      setError('Name and prompt are required');
      return;
    }
    setSaving(true);
    setError('');

    const input: CreateAutomationInput = {
      circleId,
      name: name.trim(),
      description: description.trim() || undefined,
      icon,
      triggerType,
      cronExpression: triggerType === 'schedule' ? cronExpression : undefined,
      eventConfig: triggerType === 'event' ? { table: eventTable, event: 'INSERT' } : undefined,
      prompt: prompt.trim(),
      model,
      includeContext,
      outputTarget,
      templateId: selectedTemplateId || undefined,
    };

    const result = await createAutomation(input);
    setSaving(false);

    if (result.error) {
      setError(result.error);
    } else {
      onCreated();
    }
  };

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.modalBackdrop} onPress={onClose}>
        <Pressable style={s.modalContent} onPress={(e) => e.stopPropagation()}>
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={s.modalTitle}>Create Automation</Text>

            {/* Template Gallery */}
            <Text style={s.sectionLabel}>TEMPLATES</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.templateScroll}>
              {AUTOMATION_TEMPLATES.map((t) => (
                <Pressable
                  key={t.id}
                  onPress={() => applyTemplate(t)}
                  style={[
                    s.templateChip,
                    selectedTemplateId === t.id && { borderColor: accentColor, backgroundColor: accentColor + '15' },
                    Platform.OS === 'web' && { cursor: 'pointer' } as any,
                  ]}
                >
                  <Text style={s.templateIcon}>{t.icon}</Text>
                  <Text style={[s.templateName, selectedTemplateId === t.id && { color: accentColor }]}>{t.name}</Text>
                </Pressable>
              ))}
            </ScrollView>

            {/* Name */}
            <Text style={s.sectionLabel}>NAME</Text>
            <TextInput
              style={s.input}
              value={name}
              onChangeText={setName}
              placeholder="e.g. Daily Standup Summary"
              placeholderTextColor="#555"
            />

            {/* Description */}
            <Text style={s.sectionLabel}>DESCRIPTION (optional)</Text>
            <TextInput
              style={s.input}
              value={description}
              onChangeText={setDescription}
              placeholder="What does this automation do?"
              placeholderTextColor="#555"
            />

            {/* Trigger Type */}
            <Text style={s.sectionLabel}>TRIGGER</Text>
            <View style={s.chipRow}>
              {(['schedule', 'event', 'manual'] as TriggerType[]).map((t) => {
                const tl = TRIGGER_LABELS[t];
                const sel = triggerType === t;
                return (
                  <Pressable
                    key={t}
                    onPress={() => setTriggerType(t)}
                    style={[s.chip, sel && { borderColor: tl.color, backgroundColor: tl.color + '20' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                  >
                    <Text style={[s.chipText, sel && { color: tl.color }]}>{tl.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Schedule config */}
            {triggerType === 'schedule' && (
              <>
                <Text style={s.sectionLabel}>FREQUENCY</Text>
                <View style={s.chipRow}>
                  {CRON_OPTIONS.map((opt) => (
                    <Pressable
                      key={opt.value}
                      onPress={() => setCronExpression(opt.value)}
                      style={[s.chip, cronExpression === opt.value && { borderColor: accentColor, backgroundColor: accentColor + '20' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                    >
                      <Text style={[s.chipText, cronExpression === opt.value && { color: accentColor }]}>{opt.label}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}

            {/* Event config */}
            {triggerType === 'event' && (
              <>
                <Text style={s.sectionLabel}>EVENT SOURCE</Text>
                <View style={s.chipRow}>
                  {EVENT_TABLE_OPTIONS.map((opt) => (
                    <Pressable
                      key={opt.value}
                      onPress={() => setEventTable(opt.value)}
                      style={[s.chip, eventTable === opt.value && { borderColor: '#f59e0b', backgroundColor: '#f59e0b20' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                    >
                      <Text style={[s.chipText, eventTable === opt.value && { color: '#f59e0b' }]}>{opt.label}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}

            {/* Prompt */}
            <Text style={s.sectionLabel}>PROMPT</Text>
            <TextInput
              style={[s.input, s.promptInput]}
              value={prompt}
              onChangeText={setPrompt}
              placeholder="What should the AI do? Use {{circle_name}}, {{member_count}}, etc."
              placeholderTextColor="#555"
              multiline
              numberOfLines={5}
              textAlignVertical="top"
            />

            {/* Model */}
            <Text style={s.sectionLabel}>MODEL</Text>
            <View style={s.chipRow}>
              {MODEL_OPTIONS.map((opt) => (
                <Pressable
                  key={opt.value}
                  onPress={() => setModel(opt.value)}
                  style={[s.chip, model === opt.value && { borderColor: accentColor, backgroundColor: accentColor + '20' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                >
                  <Text style={[s.chipText, model === opt.value && { color: accentColor }]}>{opt.label}</Text>
                </Pressable>
              ))}
            </View>

            {/* Output Target */}
            <Text style={s.sectionLabel}>OUTPUT</Text>
            <View style={s.chipRow}>
              {(['chat', 'activity', 'webhook', 'silent'] as OutputTarget[]).map((t) => (
                <Pressable
                  key={t}
                  onPress={() => setOutputTarget(t)}
                  style={[s.chip, outputTarget === t && { borderColor: accentColor, backgroundColor: accentColor + '20' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                >
                  <Text style={[s.chipText, outputTarget === t && { color: accentColor }]}>{OUTPUT_LABELS[t]}</Text>
                </Pressable>
              ))}
            </View>

            {/* Context toggles */}
            <Text style={s.sectionLabel}>CONTEXT</Text>
            <View style={s.contextToggles}>
              {(['members', 'check_ins', 'tasks', 'streaks', 'analytics'] as const).map((key) => (
                <Pressable
                  key={key}
                  onPress={() => setIncludeContext((prev) => ({ ...prev, [key]: !prev[key] }))}
                  style={[s.contextToggle, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                >
                  <Text style={[s.contextToggleText, includeContext[key] && { color: '#22c55e' }]}>
                    {includeContext[key] ? '☑' : '☐'} {key.replace('_', ' ')}
                  </Text>
                </Pressable>
              ))}
            </View>

            {error ? <Text style={s.errorMsg}>{error}</Text> : null}

            {/* Buttons */}
            <View style={s.modalButtons}>
              <Pressable
                onPress={onClose}
                style={[s.cancelBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
              >
                <Text style={s.cancelBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleCreate}
                disabled={saving}
                style={[s.createBtn, { backgroundColor: accentColor, opacity: saving ? 0.6 : 1 }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={s.createBtnText}>Create</Text>
                )}
              </Pressable>
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: {
    marginHorizontal: 8,
    marginTop: 12,
    marginBottom: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  headerIcon: { fontSize: 14, marginRight: 6 },
  headerLabel: {
    color: '#6B7280',
    fontSize: 11,
    fontFamily: 'monospace',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  countBadge: {
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 1,
    marginLeft: 6,
  },
  countText: { fontSize: 10, fontWeight: '700', fontFamily: 'monospace' },
  addBtn: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginRight: 8,
  },
  addBtnText: { fontSize: 10, fontWeight: '700', fontFamily: 'monospace' },
  chevron: { color: '#555', fontSize: 10 },
  body: { paddingBottom: 4 },

  // Empty state
  empty: { alignItems: 'center', paddingVertical: 20 },
  emptyText: { color: '#888', fontSize: 13, fontWeight: '600' },
  emptySubtext: { color: '#555', fontSize: 11, marginTop: 4 },
  emptyBtn: {
    marginTop: 12,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  emptyBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },

  // Card
  card: {
    backgroundColor: '#111',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1a1a1a',
    marginBottom: 6,
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
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  cardMetaText: { color: '#666', fontSize: 10, fontFamily: 'monospace' },
  triggerBadge: { borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  triggerText: { fontSize: 9, fontWeight: '800', fontFamily: 'monospace' },
  errorRow: {
    paddingHorizontal: 10,
    paddingBottom: 4,
  },
  errorText: { color: '#ef4444', fontSize: 10, fontFamily: 'monospace' },
  nextRun: {
    color: '#555',
    fontSize: 10,
    fontFamily: 'monospace',
    paddingHorizontal: 10,
    paddingBottom: 4,
  },

  // Card actions
  cardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingBottom: 8,
    gap: 8,
  },
  runBtn: {
    backgroundColor: '#22c55e15',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  runBtnText: { color: '#22c55e', fontSize: 11, fontWeight: '700', fontFamily: 'monospace' },
  historyBtn: {
    backgroundColor: '#6366f115',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  historyBtnText: { color: '#6366f1', fontSize: 11, fontWeight: '700', fontFamily: 'monospace' },
  deleteBtn: {
    padding: 4,
  },
  deleteBtnText: { color: '#555', fontSize: 12 },

  // Run history
  noRuns: {
    color: '#555',
    fontSize: 11,
    fontFamily: 'monospace',
    padding: 10,
    textAlign: 'center',
  },
  runsList: {
    borderTopWidth: 1,
    borderTopColor: '#1a1a1a',
  },
  runRow: {
    borderBottomWidth: 1,
    borderBottomColor: '#0f0f0f',
  },
  runRowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    paddingHorizontal: 10,
    gap: 8,
  },
  runIcon: { fontSize: 12 },
  runTime: { color: '#888', fontSize: 10, fontFamily: 'monospace' },
  runDuration: { color: '#555', fontSize: 10, fontFamily: 'monospace' },
  runTokens: { color: '#555', fontSize: 10, fontFamily: 'monospace' },
  runCost: { color: '#f59e0b', fontSize: 10, fontFamily: 'monospace' },
  runChevron: { color: '#444', fontSize: 9, marginLeft: 'auto' },
  runDetail: {
    paddingHorizontal: 10,
    paddingBottom: 10,
    backgroundColor: '#0a0a0a',
  },
  runOutput: {
    color: '#ccc',
    fontSize: 11,
    fontFamily: 'monospace',
    lineHeight: 16,
  },
  runError: {
    color: '#ef4444',
    fontSize: 11,
    fontFamily: 'monospace',
    marginTop: 4,
  },
  runMeta: {
    color: '#444',
    fontSize: 9,
    fontFamily: 'monospace',
    marginTop: 6,
  },

  // Modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalContent: {
    backgroundColor: '#111',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#222',
    padding: 20,
    width: '100%',
    maxWidth: 500,
    maxHeight: '90%',
  },
  modalTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 16,
  },
  sectionLabel: {
    color: '#6B7280',
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'monospace',
    letterSpacing: 1,
    marginTop: 12,
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#0a0a0a',
    borderWidth: 1,
    borderColor: '#222',
    borderRadius: 8,
    color: '#fff',
    fontSize: 13,
    padding: 10,
    fontFamily: 'monospace',
  },
  promptInput: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  chipText: {
    color: '#888',
    fontSize: 11,
    fontWeight: '600',
    fontFamily: 'monospace',
  },

  // Template chips
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

  // Context toggles
  contextToggles: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  contextToggle: {},
  contextToggleText: {
    color: '#666',
    fontSize: 11,
    fontFamily: 'monospace',
  },

  errorMsg: {
    color: '#ef4444',
    fontSize: 11,
    marginTop: 8,
  },

  // Modal buttons
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 16,
    paddingBottom: 4,
  },
  cancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
  },
  cancelBtnText: { color: '#888', fontSize: 13, fontWeight: '600' },
  createBtn: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 8,
  },
  createBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
});
