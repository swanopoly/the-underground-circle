// ─── Prompt Manager Panel ───────────────────────────────────────────────────
// Langfuse-style prompt management UI: list, edit, version, label, test
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput,
  Platform, Modal, ActivityIndicator, Alert,
} from 'react-native';
import {
  Prompt, PromptVersion, PromptLabel, PromptConfig, PromptType,
  usePrompts, usePromptDetail,
  createPrompt, updatePrompt, deletePrompt,
  createVersion, setLabel, removeLabel, rollbackToVersion,
  extractVariables, compile,
} from '../../../../lib/promptManager';

interface Props {
  circleId: string;
  userId: string;
  accentColor?: string;
}

type DetailTab = 'edit' | 'versions' | 'labels' | 'test';

// ─── Known models for config dropdown ───────────────────────────────────────
const MODEL_OPTIONS = [
  'claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5',
  'gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini', 'o4-mini',
  'gemini-2.5-flash', 'gemini-2.5-pro',
];

// ─── Label colors ───────────────────────────────────────────────────────────
function labelColor(label: string): string {
  if (label === 'production') return '#22c55e';
  if (label === 'latest') return '#3b82f6';
  if (label.startsWith('prod-')) return '#f59e0b';
  if (label === 'staging') return '#a855f7';
  return '#6b7280';
}

export default function PromptManagerPanel({ circleId, userId, accentColor = '#6366f1' }: Props) {
  const { prompts, loading, refresh } = usePrompts(circleId);
  const [selected, setSelected] = useState<Prompt | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>('edit');
  const [showCreate, setShowCreate] = useState(false);
  const [filter, setFilter] = useState<'all' | 'mine' | 'shared'>('all');
  const [search, setSearch] = useState('');

  // ─── Create modal state ─────────────────────────────────────────────────
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<PromptType>('text');
  const [newDesc, setNewDesc] = useState('');
  const [newShared, setNewShared] = useState(false);
  const [creating, setCreating] = useState(false);

  const filtered = prompts.filter(p => {
    if (filter === 'mine' && p.ownerId !== userId) return false;
    if (filter === 'shared' && !p.isShared) return false;
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    const p = await createPrompt({
      name: newName.trim(),
      type: newType,
      circleId,
      description: newDesc.trim() || undefined,
      isShared: newShared,
    });
    setCreating(false);
    if (p) {
      setShowCreate(false);
      setNewName(''); setNewDesc(''); setNewType('text'); setNewShared(false);
      await refresh();
      setSelected(p);
      setDetailTab('edit');
    }
  };

  const handleDelete = async (p: Prompt) => {
    if (Platform.OS === 'web') {
      if (!window.confirm(`Delete prompt "${p.name}"? All versions will be lost.`)) return;
    }
    await deletePrompt(p.id);
    setSelected(null);
    refresh();
  };

  // ─── Render ─────────────────────────────────────────────────────────────

  if (selected) {
    return (
      <PromptDetail
        prompt={selected}
        tab={detailTab}
        onTabChange={setDetailTab}
        onBack={() => { setSelected(null); refresh(); }}
        onDelete={() => handleDelete(selected)}
        accentColor={accentColor}
        userId={userId}
      />
    );
  }

  return (
    <View style={s.container}>
      {/* Header */}
      <View style={s.header}>
        <Text style={s.title}>PROMPT MANAGER</Text>
        <Pressable
          onPress={() => setShowCreate(true)}
          style={[s.createBtn, { backgroundColor: accentColor }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
        >
          <Text style={s.createBtnText}>+ NEW</Text>
        </Pressable>
      </View>

      {/* Search + filter */}
      <View style={s.filterRow}>
        <TextInput
          style={s.searchInput}
          placeholder="Search prompts..."
          placeholderTextColor="#555"
          value={search}
          onChangeText={setSearch}
        />
        <View style={s.filterPills}>
          {(['all', 'mine', 'shared'] as const).map(f => (
            <Pressable
              key={f}
              onPress={() => setFilter(f)}
              style={[s.filterPill, filter === f && { backgroundColor: accentColor },
                Platform.OS === 'web' && { cursor: 'pointer' } as any]}
            >
              <Text style={[s.filterPillText, filter === f && { color: '#fff' }]}>
                {f.toUpperCase()}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* List */}
      {loading ? (
        <ActivityIndicator color={accentColor} style={{ marginTop: 40 }} />
      ) : filtered.length === 0 ? (
        <View style={s.empty}>
          <Text style={s.emptyIcon}>📝</Text>
          <Text style={s.emptyText}>
            {prompts.length === 0
              ? 'No prompts yet. Create your first one!'
              : 'No prompts match your filter.'}
          </Text>
        </View>
      ) : (
        <ScrollView style={s.list} contentContainerStyle={{ paddingBottom: 40 }}>
          {filtered.map(p => (
            <PromptListItem
              key={p.id}
              prompt={p}
              isOwn={p.ownerId === userId}
              onPress={() => { setSelected(p); setDetailTab('edit'); }}
              accentColor={accentColor}
            />
          ))}
        </ScrollView>
      )}

      {/* Create Modal */}
      <Modal visible={showCreate} transparent animationType="fade">
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>NEW PROMPT</Text>

            <Text style={s.fieldLabel}>NAME</Text>
            <TextInput
              style={s.fieldInput}
              placeholder="e.g. blackswan-system"
              placeholderTextColor="#555"
              value={newName}
              onChangeText={setNewName}
              autoFocus
            />

            <Text style={s.fieldLabel}>TYPE (immutable after creation)</Text>
            <View style={s.typeRow}>
              {(['text', 'chat'] as const).map(t => (
                <Pressable
                  key={t}
                  onPress={() => setNewType(t)}
                  style={[s.typePill, newType === t && { backgroundColor: accentColor },
                    Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                >
                  <Text style={[s.typePillText, newType === t && { color: '#fff' }]}>
                    {t === 'text' ? 'TEXT' : 'CHAT'}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={s.fieldLabel}>DESCRIPTION (optional)</Text>
            <TextInput
              style={[s.fieldInput, { height: 60 }]}
              placeholder="What this prompt does..."
              placeholderTextColor="#555"
              value={newDesc}
              onChangeText={setNewDesc}
              multiline
            />

            <Pressable
              onPress={() => setNewShared(!newShared)}
              style={[s.shareToggle, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
            >
              <View style={[s.checkbox, newShared && { backgroundColor: accentColor, borderColor: accentColor }]}>
                {newShared && <Text style={{ color: '#fff', fontSize: 10 }}>✓</Text>}
              </View>
              <Text style={s.shareLabel}>Share with circle members</Text>
            </Pressable>

            <View style={s.modalActions}>
              <Pressable
                onPress={() => setShowCreate(false)}
                style={[s.modalCancelBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
              >
                <Text style={s.modalCancelText}>CANCEL</Text>
              </Pressable>
              <Pressable
                onPress={handleCreate}
                disabled={creating || !newName.trim()}
                style={[s.modalSaveBtn, { backgroundColor: accentColor, opacity: creating || !newName.trim() ? 0.5 : 1 },
                  Platform.OS === 'web' && { cursor: 'pointer' } as any]}
              >
                <Text style={s.modalSaveText}>{creating ? 'CREATING...' : 'CREATE'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─── Prompt List Item ───────────────────────────────────────────────────────

function PromptListItem({ prompt, isOwn, onPress, accentColor }: {
  prompt: Prompt; isOwn: boolean; onPress: () => void; accentColor: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[s.listItem, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
    >
      <View style={s.listItemTop}>
        <Text style={s.listItemName}>{prompt.name}</Text>
        <View style={[s.typeBadge, { borderColor: accentColor }]}>
          <Text style={[s.typeBadgeText, { color: accentColor }]}>{prompt.type.toUpperCase()}</Text>
        </View>
        {prompt.isShared && (
          <View style={[s.typeBadge, { borderColor: '#22c55e' }]}>
            <Text style={[s.typeBadgeText, { color: '#22c55e' }]}>SHARED</Text>
          </View>
        )}
        {!isOwn && (
          <View style={[s.typeBadge, { borderColor: '#f59e0b' }]}>
            <Text style={[s.typeBadgeText, { color: '#f59e0b' }]}>OTHERS</Text>
          </View>
        )}
      </View>
      {prompt.description && (
        <Text style={s.listItemDesc} numberOfLines={1}>{prompt.description}</Text>
      )}
      <Text style={s.listItemMeta}>
        Updated {new Date(prompt.updatedAt).toLocaleDateString()}
        {prompt.tags.length > 0 && ` · ${prompt.tags.join(', ')}`}
      </Text>
    </Pressable>
  );
}

// ─── Prompt Detail View ─────────────────────────────────────────────────────

function PromptDetail({ prompt, tab, onTabChange, onBack, onDelete, accentColor, userId }: {
  prompt: Prompt;
  tab: DetailTab;
  onTabChange: (t: DetailTab) => void;
  onBack: () => void;
  onDelete: () => void;
  accentColor: string;
  userId: string;
}) {
  const { versions, labels, loading, refresh } = usePromptDetail(prompt.id);
  const isOwn = prompt.ownerId === userId;

  return (
    <View style={s.container}>
      {/* Detail header */}
      <View style={s.detailHeader}>
        <Pressable onPress={onBack} style={[s.backBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
          <Text style={s.backBtnText}>← BACK</Text>
        </Pressable>
        <Text style={s.detailTitle} numberOfLines={1}>{prompt.name}</Text>
        <View style={[s.typeBadge, { borderColor: accentColor }]}>
          <Text style={[s.typeBadgeText, { color: accentColor }]}>{prompt.type.toUpperCase()}</Text>
        </View>
        {isOwn && (
          <Pressable onPress={onDelete} style={[s.deleteBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
            <Text style={s.deleteBtnText}>🗑️</Text>
          </Pressable>
        )}
      </View>

      {/* Tabs */}
      <View style={s.tabRow}>
        {(['edit', 'versions', 'labels', 'test'] as const).map(t => (
          <Pressable
            key={t}
            onPress={() => onTabChange(t)}
            style={[s.tab, tab === t && { borderBottomColor: accentColor },
              Platform.OS === 'web' && { cursor: 'pointer' } as any]}
          >
            <Text style={[s.tabText, tab === t && { color: accentColor }]}>
              {t.toUpperCase()}
            </Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator color={accentColor} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView style={s.list} contentContainerStyle={{ paddingBottom: 40 }}>
          {tab === 'edit' && (
            <EditTab
              prompt={prompt}
              versions={versions}
              labels={labels}
              isOwn={isOwn}
              accentColor={accentColor}
              onRefresh={refresh}
            />
          )}
          {tab === 'versions' && (
            <VersionsTab versions={versions} labels={labels} accentColor={accentColor} />
          )}
          {tab === 'labels' && (
            <LabelsTab
              prompt={prompt}
              versions={versions}
              labels={labels}
              isOwn={isOwn}
              accentColor={accentColor}
              onRefresh={refresh}
            />
          )}
          {tab === 'test' && (
            <TestTab
              prompt={prompt}
              versions={versions}
              labels={labels}
              accentColor={accentColor}
            />
          )}
        </ScrollView>
      )}
    </View>
  );
}

// ─── Edit Tab ───────────────────────────────────────────────────────────────

function EditTab({ prompt, versions, labels, isOwn, accentColor, onRefresh }: {
  prompt: Prompt; versions: PromptVersion[]; labels: PromptLabel[];
  isOwn: boolean; accentColor: string; onRefresh: () => void;
}) {
  const latest = versions[0];
  const [content, setContent] = useState(latest?.content || '');
  const [model, setModel] = useState(latest?.config?.model || '');
  const [temperature, setTemperature] = useState(String(latest?.config?.temperature ?? '0.7'));
  const [maxTokens, setMaxTokens] = useState(String(latest?.config?.max_tokens ?? ''));
  const [saving, setSaving] = useState(false);
  const [promoteOnSave, setPromoteOnSave] = useState(true);

  const vars = extractVariables(content);
  const hasChanges = content !== (latest?.content || '');

  const handleSave = async () => {
    if (!content.trim()) return;
    setSaving(true);
    const config: PromptConfig = {};
    if (model) config.model = model;
    const tempNum = parseFloat(temperature);
    if (!isNaN(tempNum)) config.temperature = tempNum;
    const tokNum = parseInt(maxTokens);
    if (!isNaN(tokNum) && tokNum > 0) config.max_tokens = tokNum;

    const ver = await createVersion(prompt.id, content, config);
    if (ver && promoteOnSave) {
      await setLabel(prompt.id, 'production', ver.id);
    }
    setSaving(false);
    onRefresh();
  };

  return (
    <View style={s.tabContent}>
      <Text style={s.sectionTitle}>CONTENT</Text>
      <Text style={s.hint}>
        Use {'{{variableName}}'} for dynamic values.
        {prompt.type === 'chat' && ' Content is a JSON array of {role, content} messages.'}
      </Text>
      <TextInput
        style={s.contentEditor}
        value={content}
        onChangeText={setContent}
        multiline
        placeholder={prompt.type === 'chat'
          ? '[{"role": "system", "content": "You are {{agentName}}..."}]'
          : 'You are {{agentName}}, a helpful assistant for {{userName}}...'
        }
        placeholderTextColor="#444"
        editable={isOwn}
      />

      {vars.length > 0 && (
        <View style={s.varsRow}>
          <Text style={s.varsLabel}>VARIABLES: </Text>
          {vars.map(v => (
            <View key={v} style={[s.varPill, { borderColor: accentColor }]}>
              <Text style={[s.varPillText, { color: accentColor }]}>{`{{${v}}}`}</Text>
            </View>
          ))}
        </View>
      )}

      <Text style={[s.sectionTitle, { marginTop: 16 }]}>CONFIG</Text>
      <View style={s.configGrid}>
        <View style={s.configField}>
          <Text style={s.configLabel}>MODEL</Text>
          <TextInput
            style={s.configInput}
            value={model}
            onChangeText={setModel}
            placeholder="e.g. claude-sonnet-4-6"
            placeholderTextColor="#444"
            editable={isOwn}
          />
        </View>
        <View style={s.configField}>
          <Text style={s.configLabel}>TEMPERATURE</Text>
          <TextInput
            style={s.configInput}
            value={temperature}
            onChangeText={setTemperature}
            placeholder="0.7"
            placeholderTextColor="#444"
            keyboardType="numeric"
            editable={isOwn}
          />
        </View>
        <View style={s.configField}>
          <Text style={s.configLabel}>MAX TOKENS</Text>
          <TextInput
            style={s.configInput}
            value={maxTokens}
            onChangeText={setMaxTokens}
            placeholder="1024"
            placeholderTextColor="#444"
            keyboardType="numeric"
            editable={isOwn}
          />
        </View>
      </View>

      {isOwn && (
        <>
          <Pressable
            onPress={() => setPromoteOnSave(!promoteOnSave)}
            style={[s.shareToggle, { marginTop: 12 }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
          >
            <View style={[s.checkbox, promoteOnSave && { backgroundColor: '#22c55e', borderColor: '#22c55e' }]}>
              {promoteOnSave && <Text style={{ color: '#fff', fontSize: 10 }}>✓</Text>}
            </View>
            <Text style={s.shareLabel}>Auto-promote to production</Text>
          </Pressable>

          <Pressable
            onPress={handleSave}
            disabled={saving || !content.trim()}
            style={[s.saveBtn, { backgroundColor: hasChanges ? accentColor : '#333', opacity: saving ? 0.5 : 1 },
              Platform.OS === 'web' && { cursor: 'pointer' } as any]}
          >
            <Text style={s.saveBtnText}>
              {saving ? 'SAVING...' : hasChanges ? 'SAVE AS NEW VERSION' : 'SAVE AS NEW VERSION'}
            </Text>
          </Pressable>

          {latest && (
            <Text style={s.versionHint}>
              Current: v{latest.version} · {new Date(latest.createdAt).toLocaleString()}
            </Text>
          )}
        </>
      )}
    </View>
  );
}

// ─── Versions Tab ───────────────────────────────────────────────────────────

function VersionsTab({ versions, labels, accentColor }: {
  versions: PromptVersion[]; labels: PromptLabel[]; accentColor: string;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const labelsForVersion = (vId: string) =>
    labels.filter(l => l.versionId === vId);

  return (
    <View style={s.tabContent}>
      <Text style={s.sectionTitle}>VERSION HISTORY ({versions.length})</Text>
      {versions.map(v => {
        const vLabels = labelsForVersion(v.id);
        const isExpanded = expanded === v.id;
        return (
          <Pressable
            key={v.id}
            onPress={() => setExpanded(isExpanded ? null : v.id)}
            style={[s.versionCard, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
          >
            <View style={s.versionHeader}>
              <Text style={s.versionNum}>v{v.version}</Text>
              {vLabels.map(l => (
                <View key={l.id} style={[s.labelPill, { backgroundColor: labelColor(l.label) + '22', borderColor: labelColor(l.label) }]}>
                  <Text style={[s.labelPillText, { color: labelColor(l.label) }]}>{l.label}</Text>
                </View>
              ))}
              <Text style={s.versionDate}>{new Date(v.createdAt).toLocaleDateString()}</Text>
            </View>
            {v.config?.model && (
              <Text style={s.versionMeta}>Model: {v.config.model}</Text>
            )}
            {v.variables.length > 0 && (
              <Text style={s.versionMeta}>Vars: {v.variables.map(x => `{{${x}}}`).join(', ')}</Text>
            )}
            {isExpanded && (
              <View style={s.versionContentBox}>
                <Text style={s.versionContent} selectable>
                  {v.content.length > 2000 ? v.content.slice(0, 2000) + '...' : v.content}
                </Text>
              </View>
            )}
          </Pressable>
        );
      })}
      {versions.length === 0 && (
        <Text style={s.emptyText}>No versions yet. Edit the prompt and save to create v1.</Text>
      )}
    </View>
  );
}

// ─── Labels Tab ─────────────────────────────────────────────────────────────

function LabelsTab({ prompt, versions, labels, isOwn, accentColor, onRefresh }: {
  prompt: Prompt; versions: PromptVersion[]; labels: PromptLabel[];
  isOwn: boolean; accentColor: string; onRefresh: () => void;
}) {
  const [newLabelName, setNewLabelName] = useState('');
  const [newLabelVersion, setNewLabelVersion] = useState('');
  const [adding, setAdding] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);

  const handleAddLabel = async () => {
    if (!newLabelName.trim() || !newLabelVersion) return;
    setAdding(true);
    await setLabel(prompt.id, newLabelName.trim(), newLabelVersion);
    setAdding(false);
    setNewLabelName('');
    setNewLabelVersion('');
    setShowAddForm(false);
    onRefresh();
  };

  const handleRemove = async (label: string) => {
    await removeLabel(prompt.id, label);
    onRefresh();
  };

  const handleChangeVersion = async (lbl: PromptLabel, vId: string) => {
    await setLabel(prompt.id, lbl.label, vId);
    onRefresh();
  };

  const handleRollback = async (vId: string) => {
    await rollbackToVersion(prompt.id, vId);
    onRefresh();
  };

  return (
    <View style={s.tabContent}>
      <Text style={s.sectionTitle}>LABELS</Text>
      <Text style={s.hint}>Labels are mutable pointers to versions. "production" is fetched by default at runtime.</Text>

      {labels.map(l => {
        const ver = versions.find(v => v.id === l.versionId);
        return (
          <View key={l.id} style={s.labelCard}>
            <View style={s.labelCardTop}>
              <View style={[s.labelPill, { backgroundColor: labelColor(l.label) + '22', borderColor: labelColor(l.label) }]}>
                <Text style={[s.labelPillText, { color: labelColor(l.label) }]}>{l.label}</Text>
              </View>
              <Text style={s.labelArrow}>→</Text>
              <Text style={s.labelVersionRef}>v{ver?.version ?? '?'}</Text>
              {isOwn && l.label !== 'latest' && (
                <Pressable
                  onPress={() => handleRemove(l.label)}
                  style={[s.labelRemoveBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                >
                  <Text style={s.labelRemoveText}>✕</Text>
                </Pressable>
              )}
            </View>
            {isOwn && l.label !== 'latest' && (
              <View style={s.labelVersionPicker}>
                <Text style={s.labelPickerLabel}>Point to:</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {versions.map(v => (
                    <Pressable
                      key={v.id}
                      onPress={() => handleChangeVersion(l, v.id)}
                      style={[
                        s.versionPickerBtn,
                        v.id === l.versionId && { backgroundColor: accentColor },
                        Platform.OS === 'web' && { cursor: 'pointer' } as any,
                      ]}
                    >
                      <Text style={[s.versionPickerText, v.id === l.versionId && { color: '#fff' }]}>
                        v{v.version}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            )}
            <Text style={s.labelMeta}>
              Updated {new Date(l.updatedAt).toLocaleString()}
            </Text>
          </View>
        );
      })}

      {labels.length === 0 && (
        <Text style={s.emptyText}>No labels. Save a version first, then "latest" will appear automatically.</Text>
      )}

      {/* Quick rollback */}
      {isOwn && labels.some(l => l.label === 'production') && versions.length > 1 && (
        <View style={s.rollbackSection}>
          <Text style={[s.sectionTitle, { marginTop: 16 }]}>ROLLBACK</Text>
          <Text style={s.hint}>Move "production" label to a previous version.</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {versions.map(v => {
              const isProd = labels.find(l => l.label === 'production')?.versionId === v.id;
              return (
                <Pressable
                  key={v.id}
                  onPress={() => !isProd && handleRollback(v.id)}
                  disabled={isProd}
                  style={[s.rollbackBtn, isProd && { opacity: 0.3 },
                    Platform.OS === 'web' && { cursor: isProd ? 'default' : 'pointer' } as any]}
                >
                  <Text style={s.rollbackBtnText}>v{v.version}{isProd ? ' (current)' : ''}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* Add label */}
      {isOwn && versions.length > 0 && (
        <>
          {showAddForm ? (
            <View style={s.addLabelForm}>
              <TextInput
                style={s.fieldInput}
                placeholder="Label name (e.g. staging, prod-a)"
                placeholderTextColor="#555"
                value={newLabelName}
                onChangeText={setNewLabelName}
              />
              <Text style={s.labelPickerLabel}>Assign to version:</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
                {versions.map(v => (
                  <Pressable
                    key={v.id}
                    onPress={() => setNewLabelVersion(v.id)}
                    style={[
                      s.versionPickerBtn,
                      v.id === newLabelVersion && { backgroundColor: accentColor },
                      Platform.OS === 'web' && { cursor: 'pointer' } as any,
                    ]}
                  >
                    <Text style={[s.versionPickerText, v.id === newLabelVersion && { color: '#fff' }]}>
                      v{v.version}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Pressable
                  onPress={() => setShowAddForm(false)}
                  style={[s.modalCancelBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                >
                  <Text style={s.modalCancelText}>CANCEL</Text>
                </Pressable>
                <Pressable
                  onPress={handleAddLabel}
                  disabled={adding || !newLabelName.trim() || !newLabelVersion}
                  style={[s.modalSaveBtn, { backgroundColor: accentColor, opacity: adding ? 0.5 : 1 },
                    Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                >
                  <Text style={s.modalSaveText}>{adding ? 'ADDING...' : 'ADD'}</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable
              onPress={() => setShowAddForm(true)}
              style={[s.addLabelBtn, { borderColor: accentColor },
                Platform.OS === 'web' && { cursor: 'pointer' } as any]}
            >
              <Text style={[s.addLabelBtnText, { color: accentColor }]}>+ ADD LABEL</Text>
            </Pressable>
          )}
        </>
      )}
    </View>
  );
}

// ─── Test Tab (compile & preview) ───────────────────────────────────────────

function TestTab({ prompt, versions, labels, accentColor }: {
  prompt: Prompt; versions: PromptVersion[]; labels: PromptLabel[];
  accentColor: string;
}) {
  const latest = versions[0];
  const vars = latest ? extractVariables(latest.content) : [];
  const [varValues, setVarValues] = useState<Record<string, string>>({});
  const [compiled, setCompiled] = useState<string>('');
  const [selectedLabel, setSelectedLabel] = useState('production');

  const handleCompile = () => {
    // Resolve which version the selected label points to
    const lbl = labels.find(l => l.label === selectedLabel);
    const ver = lbl ? versions.find(v => v.id === lbl.versionId) : latest;
    if (!ver) return;

    const result = compile(ver, prompt.type, prompt.name, selectedLabel, varValues);
    setCompiled(result.content);
  };

  return (
    <View style={s.tabContent}>
      <Text style={s.sectionTitle}>TEST PROMPT</Text>
      <Text style={s.hint}>Fill in variables and compile to preview the final output.</Text>

      {/* Label selector */}
      <Text style={s.configLabel}>LABEL</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
        {labels.map(l => (
          <Pressable
            key={l.id}
            onPress={() => setSelectedLabel(l.label)}
            style={[
              s.versionPickerBtn,
              { borderColor: labelColor(l.label) },
              l.label === selectedLabel && { backgroundColor: labelColor(l.label) },
              Platform.OS === 'web' && { cursor: 'pointer' } as any,
            ]}
          >
            <Text style={[
              s.versionPickerText,
              { color: labelColor(l.label) },
              l.label === selectedLabel && { color: '#fff' },
            ]}>
              {l.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Variable inputs */}
      {vars.length > 0 && (
        <>
          <Text style={s.configLabel}>VARIABLES</Text>
          {vars.map(v => (
            <View key={v} style={s.varInputRow}>
              <Text style={s.varInputLabel}>{`{{${v}}}`}</Text>
              <TextInput
                style={s.varInput}
                value={varValues[v] || ''}
                onChangeText={text => setVarValues(prev => ({ ...prev, [v]: text }))}
                placeholder={`Value for ${v}`}
                placeholderTextColor="#444"
              />
            </View>
          ))}
        </>
      )}

      <Pressable
        onPress={handleCompile}
        style={[s.saveBtn, { backgroundColor: accentColor },
          Platform.OS === 'web' && { cursor: 'pointer' } as any]}
      >
        <Text style={s.saveBtnText}>COMPILE</Text>
      </Pressable>

      {compiled !== '' && (
        <View style={s.compiledBox}>
          <Text style={s.compiledLabel}>COMPILED OUTPUT</Text>
          <Text style={s.compiledContent} selectable>{compiled}</Text>
        </View>
      )}
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a14' },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#2a2a4a',
  },
  title: { fontSize: 16, fontWeight: '700', color: '#e0e0ff', letterSpacing: 1 },
  createBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 },
  createBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },

  // Filter
  filterRow: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8, gap: 8,
    borderBottomWidth: 1, borderBottomColor: '#1a1a30',
  },
  searchInput: {
    flex: 1, backgroundColor: '#14142b', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6,
    color: '#e0e0ff', fontSize: 13, borderWidth: 1, borderColor: '#2a2a4a',
  },
  filterPills: { flexDirection: 'row', gap: 4 },
  filterPill: {
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4,
    backgroundColor: '#14142b', borderWidth: 1, borderColor: '#2a2a4a',
  },
  filterPillText: { fontSize: 10, fontWeight: '700', color: '#888' },

  // List
  list: { flex: 1 },
  listItem: {
    marginHorizontal: 12, marginTop: 8, padding: 12, backgroundColor: '#14142b',
    borderRadius: 8, borderWidth: 1, borderColor: '#2a2a4a',
  },
  listItemTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  listItemName: { fontSize: 14, fontWeight: '700', color: '#e0e0ff', flex: 1 },
  listItemDesc: { fontSize: 12, color: '#8888aa', marginTop: 4 },
  listItemMeta: { fontSize: 10, color: '#666', marginTop: 4 },

  // Type badge
  typeBadge: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1 },
  typeBadgeText: { fontSize: 9, fontWeight: '700' },

  // Empty
  empty: { alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  emptyIcon: { fontSize: 40, marginBottom: 12 },
  emptyText: { fontSize: 13, color: '#666', textAlign: 'center' },

  // Detail header
  detailHeader: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: '#2a2a4a', gap: 8,
  },
  backBtn: { paddingRight: 8 },
  backBtnText: { color: '#8888aa', fontSize: 12, fontWeight: '700' },
  detailTitle: { fontSize: 15, fontWeight: '700', color: '#e0e0ff', flex: 1 },
  deleteBtn: { padding: 4 },
  deleteBtnText: { fontSize: 16 },

  // Tabs
  tabRow: {
    flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#2a2a4a',
    paddingHorizontal: 8,
  },
  tab: {
    paddingHorizontal: 14, paddingVertical: 10,
    borderBottomWidth: 2, borderBottomColor: 'transparent',
  },
  tabText: { fontSize: 11, fontWeight: '700', color: '#666', letterSpacing: 0.5 },
  tabContent: { padding: 16 },

  // Section
  sectionTitle: { fontSize: 11, fontWeight: '700', color: '#8888aa', letterSpacing: 1, marginBottom: 8 },
  hint: { fontSize: 11, color: '#555', marginBottom: 10 },

  // Content editor
  contentEditor: {
    backgroundColor: '#0d0d1a', borderWidth: 1, borderColor: '#2a2a4a', borderRadius: 8,
    padding: 12, color: '#e0e0ff', fontSize: 13, fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
    minHeight: 200, textAlignVertical: 'top',
  },

  // Variables
  varsRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: 8, gap: 4 },
  varsLabel: { fontSize: 10, fontWeight: '700', color: '#666' },
  varPill: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  varPillText: { fontSize: 10, fontWeight: '600', fontFamily: Platform.OS === 'web' ? 'monospace' : undefined },

  // Config
  configGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  configField: { minWidth: 140, flex: 1 },
  configLabel: { fontSize: 10, fontWeight: '700', color: '#666', marginBottom: 4 },
  configInput: {
    backgroundColor: '#0d0d1a', borderWidth: 1, borderColor: '#2a2a4a', borderRadius: 6,
    paddingHorizontal: 10, paddingVertical: 6, color: '#e0e0ff', fontSize: 12,
  },

  // Share toggle
  shareToggle: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  checkbox: {
    width: 18, height: 18, borderRadius: 4, borderWidth: 1.5, borderColor: '#555',
    alignItems: 'center', justifyContent: 'center',
  },
  shareLabel: { fontSize: 12, color: '#aaa' },

  // Save button
  saveBtn: { marginTop: 16, paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  versionHint: { fontSize: 10, color: '#555', marginTop: 6, textAlign: 'center' },

  // Versions
  versionCard: {
    backgroundColor: '#14142b', borderWidth: 1, borderColor: '#2a2a4a', borderRadius: 8,
    padding: 10, marginBottom: 8,
  },
  versionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  versionNum: { fontSize: 13, fontWeight: '700', color: '#e0e0ff' },
  versionDate: { fontSize: 10, color: '#666', marginLeft: 'auto' },
  versionMeta: { fontSize: 10, color: '#888', marginTop: 2 },
  versionContentBox: {
    marginTop: 8, backgroundColor: '#0d0d1a', borderRadius: 6, padding: 8,
    borderWidth: 1, borderColor: '#1a1a30',
  },
  versionContent: {
    fontSize: 11, color: '#aaa', fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },

  // Labels
  labelPill: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  labelPillText: { fontSize: 9, fontWeight: '700' },
  labelCard: {
    backgroundColor: '#14142b', borderWidth: 1, borderColor: '#2a2a4a', borderRadius: 8,
    padding: 10, marginBottom: 8,
  },
  labelCardTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  labelArrow: { color: '#555', fontSize: 14 },
  labelVersionRef: { fontSize: 13, fontWeight: '700', color: '#e0e0ff' },
  labelRemoveBtn: { marginLeft: 'auto', padding: 4 },
  labelRemoveText: { color: '#ef4444', fontSize: 14, fontWeight: '700' },
  labelVersionPicker: { marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 6 },
  labelPickerLabel: { fontSize: 10, color: '#666', fontWeight: '600' },
  labelMeta: { fontSize: 9, color: '#555', marginTop: 4 },

  // Version picker buttons
  versionPickerBtn: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4,
    borderWidth: 1, borderColor: '#2a2a4a', marginRight: 4,
  },
  versionPickerText: { fontSize: 11, fontWeight: '700', color: '#888' },

  // Rollback
  rollbackSection: {},
  rollbackBtn: {
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: 6,
    backgroundColor: '#1a1a30', borderWidth: 1, borderColor: '#2a2a4a', marginRight: 6,
  },
  rollbackBtnText: { fontSize: 11, fontWeight: '700', color: '#e0e0ff' },

  // Add label
  addLabelForm: {
    marginTop: 12, padding: 12, backgroundColor: '#14142b', borderRadius: 8,
    borderWidth: 1, borderColor: '#2a2a4a',
  },
  addLabelBtn: {
    marginTop: 12, paddingVertical: 8, borderRadius: 6, alignItems: 'center',
    borderWidth: 1, borderStyle: 'dashed',
  },
  addLabelBtnText: { fontSize: 12, fontWeight: '700' },

  // Test tab
  varInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  varInputLabel: {
    fontSize: 11, fontWeight: '700', color: '#aaa', minWidth: 80,
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },
  varInput: {
    flex: 1, backgroundColor: '#0d0d1a', borderWidth: 1, borderColor: '#2a2a4a',
    borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6, color: '#e0e0ff', fontSize: 12,
  },
  compiledBox: {
    marginTop: 16, backgroundColor: '#0d0d1a', borderWidth: 1, borderColor: '#22c55e44',
    borderRadius: 8, padding: 12,
  },
  compiledLabel: { fontSize: 10, fontWeight: '700', color: '#22c55e', letterSpacing: 1, marginBottom: 6 },
  compiledContent: {
    fontSize: 12, color: '#e0e0ff', fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },

  // Modal
  modalOverlay: {
    flex: 1, backgroundColor: '#00000088', justifyContent: 'center', alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%', maxWidth: 440, backgroundColor: '#14142b', borderRadius: 12,
    borderWidth: 1, borderColor: '#2a2a4a', padding: 20,
  },
  modalTitle: { fontSize: 14, fontWeight: '700', color: '#e0e0ff', letterSpacing: 1, marginBottom: 16 },
  fieldLabel: { fontSize: 10, fontWeight: '700', color: '#888', letterSpacing: 0.5, marginBottom: 4, marginTop: 10 },
  fieldInput: {
    backgroundColor: '#0d0d1a', borderWidth: 1, borderColor: '#2a2a4a', borderRadius: 6,
    paddingHorizontal: 10, paddingVertical: 8, color: '#e0e0ff', fontSize: 13,
  },
  typeRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  typePill: {
    paddingHorizontal: 16, paddingVertical: 6, borderRadius: 6,
    backgroundColor: '#0d0d1a', borderWidth: 1, borderColor: '#2a2a4a',
  },
  typePillText: { fontSize: 12, fontWeight: '700', color: '#888' },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 20 },
  modalCancelBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 6 },
  modalCancelText: { color: '#888', fontSize: 12, fontWeight: '700' },
  modalSaveBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 6 },
  modalSaveText: { color: '#fff', fontSize: 12, fontWeight: '700' },
});
