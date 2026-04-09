import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, StyleSheet, Animated, Pressable, Platform, ScrollView, ActivityIndicator } from 'react-native';
import { OfficeAgent, getOfficeStatusColor, getOfficeStatusLabel } from '../../../../lib/officeAgents';
import FlatIcon, { ICON_CATALOG } from '../../../../components/FlatIcon';
import { PROVIDER_META } from '../../../../lib/connectionManager';
import { loadConnections, type AgentConnection } from '../../../../lib/connectionManager';
import { SessionTag } from '../../../../lib/sessionTags';
import SessionTagInput from '../../../../components/SessionTagInput';
import AgentControlCard from '../../../../components/AgentControlCard';
import { useAgentControl } from '../../../../services/hitlService';
import PixelAgent from './PixelAgent';
import AgentEvolutionCard from '../../../../components/rpg/AgentEvolutionCard';
import XPEventFeed from '../../../../components/rpg/XPEventFeed';
import StreakFlame from '../../../../components/rpg/StreakFlame';
import {
  AgentAppearance, DEFAULT_APPEARANCE, EnvironmentType,
  SKIN_TONES, HAIR_COLORS, SHIRT_COLORS, SHOE_COLORS, EYE_COLORS,
} from '../../../../lib/officeConfig';
import {
  getTemplatesByCategory, detectTemplate,
} from '../../../../lib/soulTemplates';
import { AGENT_SPIRITS, SPIRIT_CATEGORIES, getSpiritById, type AgentSpirit } from '../../../../lib/agentSpirits';
import { updateAgentSpirit } from '../../../../lib/circleOffice';
import {
  type OpenClawConfig,
  type OpenClawSession,
  type OpenClawSubAgent,
  type CronJob,
  listSessions,
  listSubAgentsDetailed,
  listCronJobs,
  searchMemory,
  sendSessionMessage,
  spawnSubAgent,
  manageCronJob,
} from '../../../../lib/openclawService';
import { supabase } from '../../../../lib/supabase';

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';
const PANTS_COLORS = ['#2d2d3d', '#2a2a2a', '#3d2b1a', '#1e3a5f', '#2d1b4e', '#1a3d1a'];

interface Props {
  agent: OfficeAgent | null;
  onClose: () => void;
  isDesktop?: boolean;
  onRenameAgent?: (agentId: string, newName: string) => void;
  sessionTags?: Map<string, SessionTag[]>;
  onAddSessionTag?: (sessionKey: string, tag: SessionTag) => void;
  onRemoveSessionTag?: (sessionKey: string, tagKey: string) => void;
  circleId?: string;
  appearances?: Record<string, AgentAppearance>;
  onAppearanceChange?: (id: string, appearance: AgentAppearance) => void;
  environmentType?: EnvironmentType;
  onRunCommand?: (cmd: string) => Promise<{ ok: boolean; stdout?: string; stderr?: string }>;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(0) + 'K';
  return String(n);
}

function formatRelativeTime(iso?: string): string {
  if (!iso) return 'unknown';
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatMsgTime(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  return d.toLocaleDateString();
}

function cacheHitPct(cachedTokens: number, totalInputTokens: number): string {
  if (!totalInputTokens) return '—';
  return Math.round((cachedTokens / totalInputTokens) * 100) + '%';
}

// ── SECTION: agent-memory-panel — Memory viewer/editor for this agent ────────

function AgentMemoryPanel({ circleId, userId, agentName, accentColor }: { circleId: string; userId?: string; agentName: string; accentColor: string }) {
  const [memories, setMemories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [newMemory, setNewMemory] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { getUserMemories } = await import('../../../../lib/agentMemory');
      const data = await getUserMemories(circleId, userId);
      setMemories([...data.circle, ...data.user, ...data.session]);
    } catch {}
    setLoading(false);
  }, [circleId, userId]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (id: string) => {
    try {
      const { editMemory } = await import('../../../../lib/agentMemory');
      await editMemory(id, { content: editContent });
      setEditingId(null);
      load();
    } catch {}
  };

  const handleDelete = async (id: string) => {
    try {
      const { deleteMemory } = await import('../../../../lib/agentMemory');
      await deleteMemory(id);
      load();
    } catch {}
  };

  const handleAdd = async () => {
    if (!newMemory.trim()) return;
    try {
      const { rememberFromChat } = await import('../../../../lib/memoryService');
      await rememberFromChat(circleId, userId || '', newMemory.trim());
      setNewMemory('');
      load();
    } catch {}
  };

  const kindColors: Record<string, string> = { preference: '#a855f7', fact: '#6366f1', decision: '#f59e0b', finding: '#22c55e', instruction: '#ec4899', policy: '#3b82f6', context: '#606075' };

  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Text style={{ color: '#606075', fontSize: 9, fontWeight: '700', letterSpacing: 1, fontFamily: MONO }}>AGENT MEMORY</Text>
        <Text style={{ color: '#3a3a4e', fontSize: 9, fontFamily: MONO }}>({memories.length})</Text>
      </View>

      {/* Add new memory */}
      <View style={{ flexDirection: 'row', gap: 4 }}>
        <TextInput
          value={newMemory}
          onChangeText={setNewMemory}
          placeholder="Add a memory..."
          placeholderTextColor="#3a3a4e"
          style={{ flex: 1, color: '#f0f0f5', fontSize: 10, fontFamily: MONO, backgroundColor: '#05050a', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 2, paddingHorizontal: 8, paddingVertical: 4, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) } as any}
          onSubmitEditing={handleAdd}
          returnKeyType="done"
        />
        <Pressable onPress={handleAdd} style={[{ backgroundColor: accentColor + '20', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 2, borderWidth: 1, borderColor: accentColor + '40' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
          <Text style={{ color: accentColor, fontSize: 9, fontWeight: '700', fontFamily: MONO }}>+</Text>
        </Pressable>
      </View>

      {/* Memory list */}
      <ScrollView style={{ maxHeight: 350 }} nestedScrollEnabled showsVerticalScrollIndicator>
        {loading ? (
          <ActivityIndicator size="small" color={accentColor} style={{ padding: 20 }} />
        ) : memories.length === 0 ? (
          <Text style={{ color: '#3a3a4e', fontSize: 10, fontFamily: MONO, fontStyle: 'italic', padding: 12, textAlign: 'center' }}>No memories yet. Chat with the agent to build memory.</Text>
        ) : (
          memories.map((mem: any) => (
            <View key={mem.id} style={{ backgroundColor: '#0f0f18', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 2, padding: 8, marginBottom: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 3 }}>
                <View style={{ backgroundColor: (kindColors[mem.memory_kind] || '#606075') + '20', paddingHorizontal: 4, paddingVertical: 1, borderRadius: 2 }}>
                  <Text style={{ color: kindColors[mem.memory_kind] || '#606075', fontSize: 7, fontWeight: '700', fontFamily: MONO }}>{(mem.memory_kind || 'fact').toUpperCase()}</Text>
                </View>
                <View style={{ backgroundColor: '#1a1a28', paddingHorizontal: 4, paddingVertical: 1, borderRadius: 2 }}>
                  <Text style={{ color: '#606075', fontSize: 7, fontFamily: MONO }}>{mem.scope}</Text>
                </View>
                <Text style={{ color: '#3a3a4e', fontSize: 7, fontFamily: MONO, marginLeft: 'auto' }}>{new Date(mem.created_at).toLocaleDateString()}</Text>
              </View>
              <Text style={{ color: '#a0a0b0', fontSize: 10, fontWeight: '600', fontFamily: MONO, marginBottom: 2 }}>{mem.title}</Text>
              {editingId === mem.id ? (
                <View style={{ gap: 4 }}>
                  <TextInput value={editContent} onChangeText={setEditContent} multiline autoFocus
                    style={{ color: '#f0f0f5', fontSize: 9, fontFamily: MONO, backgroundColor: '#05050a', borderWidth: 1, borderColor: '#2a2a3e', borderRadius: 2, padding: 6, minHeight: 36, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) } as any} />
                  <View style={{ flexDirection: 'row', gap: 4 }}>
                    <Pressable onPress={() => handleSave(mem.id)} style={{ backgroundColor: '#22c55e20', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 2, borderWidth: 1, borderColor: '#22c55e40' }}><Text style={{ color: '#22c55e', fontSize: 8, fontWeight: '700', fontFamily: MONO }}>Save</Text></Pressable>
                    <Pressable onPress={() => setEditingId(null)} style={{ backgroundColor: '#1a1a28', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 2, borderWidth: 1, borderColor: '#2a2a3e' }}><Text style={{ color: '#606075', fontSize: 8, fontWeight: '700', fontFamily: MONO }}>Cancel</Text></Pressable>
                  </View>
                </View>
              ) : (
                <>
                  <Text style={{ color: '#808090', fontSize: 9, fontFamily: MONO, lineHeight: 14 }}>{mem.content}</Text>
                  <View style={{ flexDirection: 'row', gap: 4, marginTop: 4 }}>
                    <Pressable onPress={() => { setEditingId(mem.id); setEditContent(mem.content); }} style={[{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 2, borderWidth: 1, borderColor: '#2a2a3e' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                      <Text style={{ color: '#a0a0b0', fontSize: 7, fontWeight: '700', fontFamily: MONO }}>Edit</Text>
                    </Pressable>
                    <Pressable onPress={() => handleDelete(mem.id)} style={[{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 2, borderWidth: 1, borderColor: '#2a2a3e' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                      <Text style={{ color: '#ef4444', fontSize: 7, fontWeight: '700', fontFamily: MONO }}>Delete</Text>
                    </Pressable>
                  </View>
                </>
              )}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

// ── SECTION: agent-runs-panel — Recent runs for this agent ───────────────────

function AgentRunsPanel({ circleId, agentName, accentColor }: { circleId: string; agentName: string; accentColor: string }) {
  const [runs, setRuns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [steps, setSteps] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { listRuns } = await import('../../../../lib/agentRunSystem');
        const data = await listRuns(circleId, { limit: 20 });
        setRuns(data);
      } catch {}
      setLoading(false);
    })();
  }, [circleId]);

  const loadSteps = async (runId: string) => {
    try {
      const { getRunSteps } = await import('../../../../lib/agentRunSystem');
      const data = await getRunSteps(runId);
      setSteps(data);
    } catch {}
  };

  const statusColors: Record<string, string> = { completed: '#22c55e', running: '#3b82f6', failed: '#ef4444', queued: '#606075', planning: '#f59e0b', paused: '#f59e0b', waiting_approval: '#f59e0b', cancelled: '#606075' };

  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Text style={{ color: '#606075', fontSize: 9, fontWeight: '700', letterSpacing: 1, fontFamily: MONO }}>AGENT RUNS</Text>
        <Text style={{ color: '#3a3a4e', fontSize: 9, fontFamily: MONO }}>({runs.length})</Text>
      </View>

      <ScrollView style={{ maxHeight: 400 }} nestedScrollEnabled showsVerticalScrollIndicator>
        {loading ? (
          <ActivityIndicator size="small" color={accentColor} style={{ padding: 20 }} />
        ) : runs.length === 0 ? (
          <Text style={{ color: '#3a3a4e', fontSize: 10, fontFamily: MONO, fontStyle: 'italic', padding: 12, textAlign: 'center' }}>No runs yet.</Text>
        ) : (
          runs.map((run: any) => {
            const isExpanded = expandedRun === run.id;
            const sc = statusColors[run.status] || '#606075';
            return (
              <View key={run.id} style={{ backgroundColor: '#0f0f18', borderWidth: 1, borderColor: isExpanded ? sc + '40' : '#1a1a28', borderRadius: 2, marginBottom: 4, overflow: 'hidden' }}>
                <Pressable
                  onPress={() => { if (isExpanded) { setExpandedRun(null); } else { setExpandedRun(run.id); loadSteps(run.id); } }}
                  style={[{ padding: 8 }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: sc }} />
                    <Text style={{ color: '#f0f0f5', fontSize: 10, fontWeight: '600', fontFamily: MONO, flex: 1 }} numberOfLines={1}>{run.title || 'Untitled run'}</Text>
                    <Text style={{ color: '#3a3a4e', fontSize: 8, fontFamily: MONO }}>{run.status.toUpperCase()}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 3 }}>
                    <Text style={{ color: '#3a3a4e', fontSize: 8, fontFamily: MONO }}>{run.surface}</Text>
                    {run.mode !== 'talk' && <Text style={{ color: '#606075', fontSize: 8, fontFamily: MONO }}>{run.mode}</Text>}
                    {run.delegated_to && <Text style={{ color: '#a855f7', fontSize: 8, fontFamily: MONO }}>{run.delegated_to}</Text>}
                    <Text style={{ color: '#3a3a4e', fontSize: 8, fontFamily: MONO, marginLeft: 'auto' }}>{new Date(run.created_at).toLocaleTimeString()}</Text>
                  </View>
                  {(run.input_tokens > 0 || run.output_tokens > 0) && (
                    <View style={{ flexDirection: 'row', gap: 8, marginTop: 2 }}>
                      <Text style={{ color: '#3a3a4e', fontSize: 7, fontFamily: MONO }}>In: {formatTokens(run.input_tokens)}</Text>
                      <Text style={{ color: '#3a3a4e', fontSize: 7, fontFamily: MONO }}>Out: {formatTokens(run.output_tokens)}</Text>
                      {run.estimated_cost > 0 && <Text style={{ color: '#22c55e', fontSize: 7, fontFamily: MONO }}>${run.estimated_cost.toFixed(4)}</Text>}
                    </View>
                  )}
                </Pressable>

                {/* Expanded: show steps */}
                {isExpanded && (
                  <View style={{ paddingHorizontal: 8, paddingBottom: 8, borderTopWidth: 1, borderTopColor: '#1a1a28', paddingTop: 6 }}>
                    {steps.length === 0 ? (
                      <Text style={{ color: '#3a3a4e', fontSize: 9, fontFamily: MONO, fontStyle: 'italic' }}>No steps recorded.</Text>
                    ) : (
                      steps.map((step: any, i: number) => {
                        const stepColors: Record<string, string> = { plan: '#6366f1', message: '#22c55e', tool_call: '#f59e0b', delegation: '#a855f7', error: '#ef4444', finalize: '#22d3ee', thinking: '#606075' };
                        return (
                          <View key={step.id} style={{ flexDirection: 'row', gap: 6, marginBottom: 4 }}>
                            <View style={{ width: 2, backgroundColor: stepColors[step.step_kind] || '#1a1a28', borderRadius: 1 }} />
                            <View style={{ flex: 1 }}>
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                <Text style={{ color: stepColors[step.step_kind] || '#606075', fontSize: 8, fontWeight: '700', fontFamily: MONO }}>{step.step_kind}</Text>
                                {step.tool_name && <Text style={{ color: '#3a3a4e', fontSize: 7, fontFamily: MONO }}>{step.tool_name}</Text>}
                                {step.delegated_to && <Text style={{ color: '#a855f7', fontSize: 7, fontFamily: MONO }}>{step.delegated_to}</Text>}
                              </View>
                              <Text style={{ color: '#808090', fontSize: 9, fontFamily: MONO }} numberOfLines={2}>{step.title}</Text>
                              {step.body && <Text style={{ color: '#606075', fontSize: 8, fontFamily: MONO, marginTop: 1 }} numberOfLines={3}>{step.body.slice(0, 200)}</Text>}
                            </View>
                          </View>
                        );
                      })
                    )}
                  </View>
                )}
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

function OpenClawFrontendPanel({ agent, accentColor }: { agent: OfficeAgent; accentColor: string }) {
  const [connection, setConnection] = useState<AgentConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sessions, setSessions] = useState<OpenClawSession[]>([]);
  const [subagents, setSubagents] = useState<OpenClawSubAgent[]>([]);
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [messageInput, setMessageInput] = useState('');
  const [spawnInput, setSpawnInput] = useState('');
  const [memoryQuery, setMemoryQuery] = useState('');
  const [memoryResult, setMemoryResult] = useState('');
  const [actionState, setActionState] = useState<string | null>(null);

  const resolveConfig = useCallback(async (): Promise<OpenClawConfig | null> => {
    const connections = await loadConnections();
    const match = connections.find((conn) =>
      conn.provider === 'openclaw' && (
        conn.id === agent.connectionId ||
        conn.name === agent.connectionName
      )
    ) || connections.find((conn) => conn.provider === 'openclaw' && conn.status === 'connected');

    if (!match?.endpoint || !match?.token || match.token === '***') {
      setConnection(match || null);
      return null;
    }

    setConnection(match);
    return { endpoint: match.endpoint, token: match.token };
  }, [agent.connectionId, agent.connectionName]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const config = await resolveConfig();
      if (!config) {
        setError('KingClaw connection token is not available in this session.');
        setSessions([]);
        setSubagents([]);
        setJobs([]);
        return;
      }

      const [sessionsResult, subagentsResult, jobsResult] = await Promise.all([
        listSessions(config),
        listSubAgentsDetailed(config),
        listCronJobs(config),
      ]);

      if (!sessionsResult.ok) {
        setError(sessionsResult.error || 'Failed to load sessions');
      }

      setSessions(sessionsResult.sessions || []);
      setSubagents(subagentsResult.subagents || []);
      setJobs(jobsResult.jobs || []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load KingClaw data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [resolveConfig]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const runAction = useCallback(async (label: string, fn: (config: OpenClawConfig) => Promise<void>) => {
    setActionState(label);
    setError(null);
    try {
      const config = await resolveConfig();
      if (!config) throw new Error('KingClaw connection is not available');
      await fn(config);
      await refresh();
    } catch (e: any) {
      setError(e?.message || `Failed to ${label.toLowerCase()}`);
    } finally {
      setActionState(null);
    }
  }, [refresh, resolveConfig]);

  const activeSession = sessions.find((session) => session.sessionKey === agent.sessionKey) || sessions[0] || null;
  const subagentCount = subagents.length || sessions.filter((session) => session.kind === 'subagent').length;
  const enabledJobs = jobs.filter((job) => job.enabled).length;
  const capabilityCards = [
    { label: 'Channels', value: 'Gateway', note: 'shared routing + DMs/groups', color: '#6366f1' },
    { label: 'Media', value: 'Rich IO', note: 'images, audio, video, docs', color: '#22c55e' },
    { label: 'Browser', value: 'Automation', note: 'browser + exec + search', color: '#f59e0b' },
    { label: 'Jobs', value: 'Cron', note: 'scheduled tasks + heartbeats', color: '#a855f7' },
    { label: 'Control UI', value: 'Runtime', note: 'sessions, logs, config', color: '#22d3ee' },
    { label: 'Nodes', value: 'Mobile/Desktop', note: 'paired device commands', color: '#ec4899' },
  ];

  return (
    <View style={{ paddingHorizontal: 8, gap: 8, paddingBottom: 12 }} nativeID="section-openclaw-frontend">
      <View style={{ backgroundColor: '#0a0a10', borderWidth: 1, borderColor: accentColor + '35', borderRadius: 3, padding: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ width: 24, height: 24, borderRadius: 3, backgroundColor: accentColor + '18', borderWidth: 1, borderColor: accentColor + '35', alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: accentColor, fontSize: 11, fontWeight: '800', fontFamily: MONO }}>OC</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: '#f0f0f5', fontSize: 11, fontWeight: '700', fontFamily: MONO }}>KINGCLAW RUNTIME PANEL</Text>
            <Text style={{ color: '#606075', fontSize: 9, fontFamily: MONO }} numberOfLines={1}>
              {connection?.endpoint || 'No active KingClaw endpoint resolved'}
            </Text>
          </View>
          <Pressable
            onPress={refresh}
            style={[{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 3, borderWidth: 1, borderColor: accentColor + '40', backgroundColor: accentColor + '12' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
          >
            <Text style={{ color: accentColor, fontSize: 9, fontWeight: '700', fontFamily: MONO }}>{refreshing ? 'SYNC..' : 'REFRESH'}</Text>
          </Pressable>
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
          {[
            { label: 'Sessions', value: String(sessions.length), color: '#6366f1' },
            { label: 'Subagents', value: String(subagentCount), color: '#a855f7' },
            { label: 'Cron Jobs', value: String(jobs.length), color: '#f59e0b' },
            { label: 'Enabled Jobs', value: String(enabledJobs), color: '#22c55e' },
          ].map((item) => (
            <View key={item.label} style={{ width: '23%', backgroundColor: '#111118', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 2, padding: 8 }}>
              <Text style={{ color: '#3a3a4e', fontSize: 7, fontWeight: '700', fontFamily: MONO }}>{item.label.toUpperCase()}</Text>
              <Text style={{ color: item.color, fontSize: 14, fontWeight: '800', fontFamily: MONO, marginTop: 2 }}>{item.value}</Text>
            </View>
          ))}
        </View>

        {error ? <Text style={{ color: '#ef4444', fontSize: 9, fontFamily: MONO, marginTop: 8 }}>{error}</Text> : null}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {capabilityCards.map((card) => (
          <View key={card.label} style={{ width: '48%', backgroundColor: '#0a0a10', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 3, padding: 9 }}>
            <Text style={{ color: '#3a3a4e', fontSize: 7, fontWeight: '700', fontFamily: MONO }}>{card.label.toUpperCase()}</Text>
            <Text style={{ color: card.color, fontSize: 11, fontWeight: '700', fontFamily: MONO, marginTop: 3 }}>{card.value}</Text>
            <Text style={{ color: '#606075', fontSize: 8, fontFamily: MONO, marginTop: 3, lineHeight: 12 }}>{card.note}</Text>
          </View>
        ))}
      </View>

      <View style={{ backgroundColor: '#0a0a10', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 3, padding: 10, gap: 8 }}>
        <Text style={{ color: '#606075', fontSize: 9, fontWeight: '700', letterSpacing: 1, fontFamily: MONO }}>SESSIONS</Text>
        {loading ? (
          <ActivityIndicator size="small" color={accentColor} />
        ) : activeSession ? (
          <>
            <View style={{ backgroundColor: '#111118', borderWidth: 1, borderColor: accentColor + '30', borderRadius: 3, padding: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={{ color: accentColor, fontSize: 10, fontWeight: '700', fontFamily: MONO }}>{activeSession.kind || 'session'}</Text>
                <Text style={{ color: '#a0a0b0', fontSize: 10, fontFamily: MONO, flex: 1 }} numberOfLines={1}>{activeSession.sessionKey}</Text>
                <Text style={{ color: '#3a3a4e', fontSize: 8, fontFamily: MONO }}>{formatRelativeTime(activeSession.lastActivity)}</Text>
              </View>
              {activeSession.model ? <Text style={{ color: '#6366f1', fontSize: 9, fontFamily: MONO, marginTop: 4 }}>{activeSession.model}</Text> : null}
              {activeSession.lastMessages?.length ? (
                <Text style={{ color: '#808090', fontSize: 8, fontFamily: MONO, marginTop: 5, lineHeight: 12 }} numberOfLines={3}>
                  {activeSession.lastMessages[activeSession.lastMessages.length - 1]?.content}
                </Text>
              ) : null}
            </View>

            {sessions.length > 1 ? (
              <View style={{ gap: 4 }}>
                {sessions.slice(0, 5).map((session) => (
                  <View key={session.sessionKey} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 2 }}>
                    <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: session.sessionKey === activeSession.sessionKey ? accentColor : '#2a2a3e' }} />
                    <Text style={{ color: '#a0a0b0', fontSize: 9, fontFamily: MONO, flex: 1 }} numberOfLines={1}>{session.sessionKey}</Text>
                    <Text style={{ color: '#606075', fontSize: 8, fontFamily: MONO }}>{session.kind}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </>
        ) : (
          <Text style={{ color: '#3a3a4e', fontSize: 9, fontFamily: MONO, fontStyle: 'italic' }}>No sessions returned by the gateway.</Text>
        )}
      </View>

      <View style={{ backgroundColor: '#0a0a10', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 3, padding: 10, gap: 8 }}>
        <Text style={{ color: '#606075', fontSize: 9, fontWeight: '700', letterSpacing: 1, fontFamily: MONO }}>SUBAGENTS + AUTOMATIONS</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ color: '#a855f7', fontSize: 9, fontWeight: '700', fontFamily: MONO }}>Subagents</Text>
            {subagents.length === 0 ? (
              <Text style={{ color: '#3a3a4e', fontSize: 8, fontFamily: MONO, fontStyle: 'italic' }}>No subagents reported.</Text>
            ) : subagents.slice(0, 4).map((subagent) => (
              <View key={subagent.id} style={{ backgroundColor: '#111118', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 2, padding: 6 }}>
                <Text style={{ color: '#f0f0f5', fontSize: 8, fontWeight: '700', fontFamily: MONO }} numberOfLines={1}>{subagent.name || subagent.id}</Text>
                <Text style={{ color: '#606075', fontSize: 7, fontFamily: MONO }} numberOfLines={1}>{subagent.model || subagent.status || 'unknown'}</Text>
                {subagent.task ? <Text style={{ color: '#808090', fontSize: 7, fontFamily: MONO, marginTop: 2 }} numberOfLines={2}>{subagent.task}</Text> : null}
              </View>
            ))}
          </View>

          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ color: '#f59e0b', fontSize: 9, fontWeight: '700', fontFamily: MONO }}>Cron Jobs</Text>
            {jobs.length === 0 ? (
              <Text style={{ color: '#3a3a4e', fontSize: 8, fontFamily: MONO, fontStyle: 'italic' }}>No cron jobs configured.</Text>
            ) : jobs.slice(0, 4).map((job) => (
              <View key={job.id} style={{ backgroundColor: '#111118', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 2, padding: 6 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: job.enabled ? '#22c55e' : '#3a3a4e' }} />
                  <Text style={{ color: '#f0f0f5', fontSize: 8, fontWeight: '700', fontFamily: MONO, flex: 1 }} numberOfLines={1}>{job.name || job.id}</Text>
                  <Pressable
                    onPress={() => runAction(`Run ${job.id}`, async (config) => { await manageCronJob(config, 'run', job.id); })}
                    style={[{ paddingHorizontal: 5, paddingVertical: 2, borderRadius: 2, borderWidth: 1, borderColor: '#f59e0b40', backgroundColor: '#f59e0b12' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                  >
                    <Text style={{ color: '#f59e0b', fontSize: 7, fontWeight: '700', fontFamily: MONO }}>{actionState === `Run ${job.id}` ? '..' : 'RUN'}</Text>
                  </Pressable>
                </View>
                {job.nextRun ? <Text style={{ color: '#606075', fontSize: 7, fontFamily: MONO, marginTop: 2 }} numberOfLines={1}>next {job.nextRun}</Text> : null}
              </View>
            ))}
          </View>
        </View>
      </View>

      <View style={{ backgroundColor: '#0a0a10', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 3, padding: 10, gap: 8 }}>
        <Text style={{ color: '#606075', fontSize: 9, fontWeight: '700', letterSpacing: 1, fontFamily: MONO }}>OPENCLAW ACTIONS</Text>

        <View style={{ gap: 4 }}>
          <Text style={{ color: '#3a3a4e', fontSize: 8, fontWeight: '700', fontFamily: MONO }}>SEND TO SESSION</Text>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <TextInput
              value={messageInput}
              onChangeText={setMessageInput}
              placeholder="send a session message..."
              placeholderTextColor="#3a3a4e"
              style={{ flex: 1, color: '#f0f0f5', fontSize: 10, fontFamily: MONO, backgroundColor: '#05050a', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 2, paddingHorizontal: 8, paddingVertical: 6, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) } as any}
            />
            <Pressable
              onPress={() => messageInput.trim() && runAction('Send message', async (config) => {
                await sendSessionMessage(config, agent.sessionKey, messageInput.trim());
                setMessageInput('');
              })}
              style={[{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 2, borderWidth: 1, borderColor: accentColor + '40', backgroundColor: accentColor + '12' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
            >
              <Text style={{ color: accentColor, fontSize: 8, fontWeight: '700', fontFamily: MONO }}>{actionState === 'Send message' ? '..' : 'SEND'}</Text>
            </Pressable>
          </View>
        </View>

        <View style={{ gap: 4 }}>
          <Text style={{ color: '#3a3a4e', fontSize: 8, fontWeight: '700', fontFamily: MONO }}>SPAWN SUBAGENT</Text>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <TextInput
              value={spawnInput}
              onChangeText={setSpawnInput}
              placeholder="delegate a background task..."
              placeholderTextColor="#3a3a4e"
              style={{ flex: 1, color: '#f0f0f5', fontSize: 10, fontFamily: MONO, backgroundColor: '#05050a', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 2, paddingHorizontal: 8, paddingVertical: 6, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) } as any}
            />
            <Pressable
              onPress={() => spawnInput.trim() && runAction('Spawn subagent', async (config) => {
                await spawnSubAgent(config, spawnInput.trim());
                setSpawnInput('');
              })}
              style={[{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 2, borderWidth: 1, borderColor: '#a855f740', backgroundColor: '#a855f712' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
            >
              <Text style={{ color: '#a855f7', fontSize: 8, fontWeight: '700', fontFamily: MONO }}>{actionState === 'Spawn subagent' ? '..' : 'SPAWN'}</Text>
            </Pressable>
          </View>
        </View>

        <View style={{ gap: 4 }}>
          <Text style={{ color: '#3a3a4e', fontSize: 8, fontWeight: '700', fontFamily: MONO }}>MEMORY SEARCH</Text>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <TextInput
              value={memoryQuery}
              onChangeText={setMemoryQuery}
              placeholder="search agent memory..."
              placeholderTextColor="#3a3a4e"
              style={{ flex: 1, color: '#f0f0f5', fontSize: 10, fontFamily: MONO, backgroundColor: '#05050a', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 2, paddingHorizontal: 8, paddingVertical: 6, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) } as any}
            />
            <Pressable
              onPress={() => memoryQuery.trim() && runAction('Search memory', async (config) => {
                const result = await searchMemory(config, memoryQuery.trim());
                setMemoryResult(result.reply || result.error || 'No result');
              })}
              style={[{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 2, borderWidth: 1, borderColor: '#22c55e40', backgroundColor: '#22c55e12' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
            >
              <Text style={{ color: '#22c55e', fontSize: 8, fontWeight: '700', fontFamily: MONO }}>{actionState === 'Search memory' ? '..' : 'SEARCH'}</Text>
            </Pressable>
          </View>
          {memoryResult ? <Text style={{ color: '#808090', fontSize: 8, fontFamily: MONO, lineHeight: 12 }} selectable>{memoryResult}</Text> : null}
        </View>
      </View>
    </View>
  );
}

// ── SECTION: agent-remote-shell — Run shell commands on the agent's machine ──

const QUICK_COMMANDS = [
  { label: 'pwd',        cmd: 'pwd',                    icon: '>' },
  { label: 'git status', cmd: 'git status',             icon: '~' },
  { label: 'git log',    cmd: 'git log --oneline -5',   icon: '#' },
  { label: 'ls',         cmd: 'ls -la',                 icon: '[]' },
  { label: 'disk',       cmd: 'df -h /',                icon: 'D' },
  { label: 'uptime',     cmd: 'uptime',                 icon: 'U' },
  { label: 'top',        cmd: 'ps aux --sort=-%cpu | head -8', icon: '%' },
  { label: 'node -v',    cmd: 'node -v',                icon: 'N' },
];

function AgentRemoteShell({ onRunCommand }: { onRunCommand: (cmd: string) => Promise<{ ok: boolean; stdout?: string; stderr?: string }> }) {
  const [cmdInput, setCmdInput] = useState('');
  const [cmdOutput, setCmdOutput] = useState('');
  const [cmdRunning, setCmdRunning] = useState(false);
  const [outputHeight, setOutputHeight] = useState(280);
  const scrollRef = useRef<ScrollView>(null);
  const dragStartY = useRef(0);
  const dragStartH = useRef(0);

  const runCmd = useCallback(async (cmd: string) => {
    if (!cmd.trim()) return;
    setCmdRunning(true);
    setCmdOutput('');
    try {
      const r = await onRunCommand(cmd.trim());
      setCmdOutput((r.stdout || '') + (r.stderr ? `\n${r.stderr}` : '') || (r.ok ? '(no output)' : 'Failed'));
    } catch (e: any) {
      setCmdOutput(`Error: ${e.message}`);
    }
    setCmdRunning(false);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
  }, [onRunCommand]);

  const handleResizeStart = (e: any) => {
    if (Platform.OS !== 'web') return;
    dragStartY.current = e.nativeEvent?.pageY || 0;
    dragStartH.current = outputHeight;
    const onMove = (ev: MouseEvent) => setOutputHeight(Math.max(150, Math.min(600, dragStartH.current + (ev.pageY - dragStartY.current))));
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <View style={{ paddingHorizontal: 8, marginBottom: 8 }} nativeID="section-agent-remote-shell">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 }}>
        <View style={{ width: 18, height: 18, borderRadius: 2, backgroundColor: '#22c55e15', borderWidth: 1, borderColor: '#22c55e30', justifyContent: 'center', alignItems: 'center' }}>
          <Text style={{ color: '#22c55e', fontSize: 9, fontWeight: '800', fontFamily: MONO }}>$</Text>
        </View>
        <Text style={{ color: '#606075', fontSize: 9, fontWeight: '700', letterSpacing: 1, fontFamily: MONO }}>REMOTE SHELL</Text>
      </View>

      {/* Quick commands */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 6, maxHeight: 32 }} contentContainerStyle={{ gap: 4 }}>
        {QUICK_COMMANDS.map(q => (
          <Pressable
            key={q.cmd}
            onPress={() => { setCmdInput(q.cmd); runCmd(q.cmd); }}
            style={[
              { backgroundColor: '#0a0a10', borderRadius: 2, borderWidth: 1, borderColor: '#1a1a28', paddingHorizontal: 8, paddingVertical: 4 },
              Platform.OS === 'web' && { cursor: 'pointer' } as any,
            ]}
          >
            <Text style={{ color: '#808090', fontSize: 10, fontFamily: MONO }}>
              <Text style={{ color: '#22c55e', fontWeight: '700' }}>{q.icon}</Text> {q.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Input row */}
      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#05050a', borderRadius: 2, borderWidth: 1, borderColor: '#1a1a28', paddingHorizontal: 8, gap: 6, marginBottom: 4 }}>
        <Text style={{ color: '#22c55e', fontSize: 14, fontWeight: '800', fontFamily: MONO }}>$</Text>
        <TextInput
          style={{ flex: 1, color: '#e8e8f8', fontSize: 12, fontFamily: MONO, paddingVertical: 8, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) } as any}
          value={cmdInput}
          onChangeText={setCmdInput}
          placeholder="run a command..."
          placeholderTextColor="#3b3b5b"
          onSubmitEditing={() => cmdInput.trim() && runCmd(cmdInput.trim())}
          returnKeyType="send"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Pressable
          style={[{ backgroundColor: '#22c55e', borderRadius: 2, paddingHorizontal: 10, paddingVertical: 5 }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
          onPress={() => cmdInput.trim() && runCmd(cmdInput.trim())}
          disabled={cmdRunning}
        >
          <Text style={{ color: '#050508', fontSize: 10, fontWeight: '800', fontFamily: MONO }}>{cmdRunning ? '..' : 'RUN'}</Text>
        </Pressable>
      </View>

      {/* Output */}
      <ScrollView
        ref={scrollRef}
        style={{ height: outputHeight, backgroundColor: '#05050a', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 2, padding: 8 }}
        nestedScrollEnabled
        showsVerticalScrollIndicator
      >
        {!cmdOutput && !cmdRunning && (
          <Text style={{ color: '#3a3a4e', fontSize: 11, fontFamily: MONO, fontStyle: 'italic' }}>Run a command to see output...</Text>
        )}
        {cmdRunning && <ActivityIndicator size="small" color="#22c55e" style={{ marginBottom: 4 }} />}
        {cmdOutput ? <Text style={{ color: '#c9d1e8', fontSize: 11, fontFamily: MONO, lineHeight: 16 }} selectable>{cmdOutput}</Text> : null}
      </ScrollView>

      {/* Resize handle */}
      {Platform.OS === 'web' && (
        <View onPointerDown={handleResizeStart as any} style={{ height: 6, backgroundColor: '#1a1a28', borderRadius: 2, marginVertical: 2, alignItems: 'center' as any, justifyContent: 'center' as any, ...(Platform.OS === 'web' ? { cursor: 'ns-resize' } as any : {}) }}>
          <View style={{ width: 30, height: 2, backgroundColor: '#2a2a3e', borderRadius: 1 }} />
        </View>
      )}
    </View>
  );
}

// ── SECTION: agent-quick-terminal — Inline AI chat with this specific agent ──

function AgentQuickTerminal({ agentName, agentId, circleId }: { agentName: string; agentId: string; circleId: string }) {
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<{ role: 'user' | 'agent' | 'error'; text: string }[]>([]);
  const [sending, setSending] = useState(false);
  const [outputHeight, setOutputHeight] = useState(300);
  const scrollRef = useRef<ScrollView>(null);
  const dragStartY = useRef(0);
  const dragStartH = useRef(0);
  const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

  const handleSend = async () => {
    if (!input.trim() || sending) return;
    const msg = input.trim();
    setInput('');
    setHistory(prev => [...prev, { role: 'user', text: msg }]);
    setSending(true);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    try {
      const { getSwanBotResponse } = await import('../../../../lib/swanbot');
      const resp = await getSwanBotResponse(`@${agentName}: ${msg}`, {
        userId: (await supabase.auth.getUser()).data.user?.id || '',
        circleId,
      });
      setHistory(prev => [...prev, { role: 'agent', text: resp }]);
    } catch (e: any) {
      setHistory(prev => [...prev, { role: 'error', text: e.message || 'Failed' }]);
    }
    setSending(false);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
  };

  const handleResizeStart = (e: any) => {
    if (Platform.OS !== 'web') return;
    dragStartY.current = e.nativeEvent?.pageY || 0;
    dragStartH.current = outputHeight;
    const onMove = (ev: MouseEvent) => setOutputHeight(Math.max(150, Math.min(600, dragStartH.current + (ev.pageY - dragStartY.current))));
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <View style={{ flex: 1, paddingHorizontal: 8 }} nativeID="section-agent-quick-terminal">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: sending ? '#f59e0b' : '#22c55e' }} />
        <Text style={{ color: '#606075', fontSize: 9, fontWeight: '700', letterSpacing: 1, fontFamily: MONO }}>{agentName.toUpperCase()} TERMINAL</Text>
        <Text style={{ color: '#3a3a4e', fontSize: 9, marginLeft: 'auto' as any }}>{history.length} msg</Text>
      </View>
      <ScrollView ref={scrollRef} style={{ height: outputHeight, backgroundColor: '#05050a', borderWidth: 1, borderColor: '#1a1a2e', borderRadius: 2, padding: 8 }} nestedScrollEnabled showsVerticalScrollIndicator>
        {history.length === 0 && <Text style={{ color: '#3a3a4e', fontSize: 11, fontFamily: MONO, fontStyle: 'italic' }}>Type a command to talk to {agentName}...</Text>}
        {history.map((h, i) => (
          <View key={i} style={{ marginBottom: 6 }}>
            <Text style={{ color: h.role === 'user' ? '#8b5cf6' : h.role === 'error' ? '#ef4444' : '#22c55e', fontSize: 9, fontWeight: '700', fontFamily: MONO, marginBottom: 2 }}>
              {h.role === 'user' ? '> YOU' : h.role === 'error' ? '! ERROR' : `< ${agentName.toUpperCase()}`}
            </Text>
            <Text style={{ color: h.role === 'error' ? '#ef4444' : '#c9d1e8', fontSize: 11, fontFamily: MONO, lineHeight: 16 }} selectable>{h.text}</Text>
          </View>
        ))}
        {sending && <Text style={{ color: '#f59e0b', fontSize: 11, fontFamily: MONO }}>thinking...</Text>}
      </ScrollView>
      {Platform.OS === 'web' && (
        <View onPointerDown={handleResizeStart as any} style={{ height: 6, backgroundColor: '#1a1a2e', borderRadius: 3, marginVertical: 2, alignItems: 'center' as any, justifyContent: 'center' as any, ...(Platform.OS === 'web' ? { cursor: 'ns-resize' } as any : {}) }}>
          <View style={{ width: 30, height: 2, backgroundColor: '#2a2a3e', borderRadius: 1 }} />
        </View>
      )}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end' as any, backgroundColor: '#08081a', borderRadius: 2, borderWidth: 1, borderColor: '#1e1e3a', paddingHorizontal: 8, paddingVertical: 4, gap: 6 }}>
        <Text style={{ color: '#8b5cf6', fontSize: 14, fontWeight: '800', fontFamily: MONO, paddingBottom: 4 }}>{'>'}</Text>
        <TextInput
          style={{ flex: 1, color: '#e8e8f8', fontSize: 12, fontFamily: MONO, minHeight: 36, maxHeight: 100, paddingVertical: 6, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) } as any}
          value={input} onChangeText={setInput}
          placeholder={`Command ${agentName}...`} placeholderTextColor="#3b3b5b"
          onSubmitEditing={handleSend} returnKeyType="send" autoCapitalize="none" multiline
        />
        <Pressable onPress={handleSend} disabled={sending || !input.trim()} accessibilityRole="button"
          style={{ backgroundColor: '#8b5cf6', borderRadius: 2, paddingHorizontal: 10, paddingVertical: 6, opacity: sending || !input.trim() ? 0.4 : 1 }}>
          <Text style={{ color: '#fff', fontSize: 11, fontWeight: '800', fontFamily: MONO }}>{sending ? '..' : '>>'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ═════════════════════════════════════════════════════════════════════════════

export default function AgentPanel({
  agent, onClose, isDesktop, onRenameAgent,
  sessionTags, onAddSessionTag, onRemoveSessionTag, circleId,
  appearances, onAppearanceChange, environmentType, onRunCommand,
}: Props) {
  const slideAnim = useRef(new Animated.Value(400)).current;
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [panelTab, setPanelTab] = useState<'overview' | 'openclaw' | 'terminal' | 'spirit' | 'evolution' | 'activity' | 'memory' | 'runs' | 'customize'>('overview');
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => { supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id || null)).catch(() => {}); }, []);
  const [showCustomize, setShowCustomize] = useState(false);
  const [showSoul, setShowSoul] = useState(false); // kept for reset effect
  const [soulText, setSoulText] = useState('');
  const [soulSaving, setSoulSaving] = useState(false);
  const [soulStatus, setSoulStatus] = useState('');
  const [soulLoaded, setSoulLoaded] = useState<string | null>(null); // tracks which agent was loaded
  const [showSpirits, setShowSpirits] = useState(true);
  const [editingSpirit, setEditingSpirit] = useState(false);
  const [customPrompt, setCustomPrompt] = useState('');
  const [customKnobs, setCustomKnobs] = useState({
    actionPosture: 'propose' as string,
    evidencePosture: 'high' as string,
    communicationDensity: 'normal' as string,
    skepticism: 'medium' as string,
    riskTier: 'medium' as string,
    escalationTrigger: '',
    skillBundle: '',
  });
  const [customProfiles, setCustomProfiles] = useState<any[]>([]);
  const [savingProfile, setSavingProfile] = useState(false);
  const [saveProfileName, setSaveProfileName] = useState('');
  const [showSaveForm, setShowSaveForm] = useState(false);
  const personalityScrollRef = useRef<ScrollView>(null);
  const personalityScrollX = useRef(0);
  const [currentSpirit, setCurrentSpirit] = useState<string | null>(null);
  const [dbAgentId, setDbAgentId] = useState<string | null>(null);

  useEffect(() => {
    if (agent) {
      slideAnim.setValue(isDesktop ? 420 : 400);
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: Platform.OS !== 'web',
        tension: 120,
        friction: 16,
      }).start();
    } else {
      Animated.timing(slideAnim, {
        toValue: isDesktop ? 420 : 400,
        duration: 200,
        useNativeDriver: Platform.OS !== 'web',
      }).start();
    }
  }, [agent, isDesktop]);

  // Extract sessionKey early so hooks always run in same order
  const sessionKey = agent
    ? (agent.sessionKey || (agent.id.includes('::') ? agent.id.split('::')[1] : agent.id))
    : undefined;

  const control = useAgentControl(circleId, sessionKey);

  // Load or create DB agent row when panel opens
  const ensureDbAgent = useCallback(async (): Promise<string | null> => {
    if (dbAgentId) return dbAgentId;
    if (!agent || !circleId) return null;
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return null;
    // Try to find existing row
    const { data } = await supabase
      .from('circle_office_agents')
      .select('id, spirit, spirit_emoji')
      .eq('circle_id', circleId)
      .eq('owner_id', auth.user.id)
      .ilike('name', agent.name)
      .maybeSingle();
    if (data) {
      setDbAgentId(data.id);
      setCurrentSpirit(data.spirit || null);
      return data.id;
    }
    // Auto-create if missing
    const { data: created, error } = await supabase
      .from('circle_office_agents')
      .upsert({
        circle_id: circleId,
        owner_id: auth.user.id,
        name: agent.name,
        provider: agent.providerType || 'claude-code',
        status: agent.status || 'idle',
        color: agent.color || '#6366f1',
      }, { onConflict: 'circle_id,owner_id,name' })
      .select('id')
      .single();
    if (created && !error) {
      setDbAgentId(created.id);
      return created.id;
    }
    return null;
  }, [dbAgentId, agent, circleId]);

  useEffect(() => {
    ensureDbAgent();
    // Load custom profiles
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      const { data } = await supabase
        .from('custom_agent_profiles')
        .select('*')
        .eq('user_id', auth.user.id)
        .order('name');
      if (data) setCustomProfiles(data);
    })();
  }, [ensureDbAgent]);

  // Load personality when agent panel opens for a specific agent
  useEffect(() => {
    if (!agent || !circleId) return;
    const agentKey = agent.name || 'default';
    if (soulLoaded === agentKey) return; // already loaded
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      const { data } = await supabase
        .from('agent_personalities')
        .select('personality')
        .eq('user_id', auth.user.id)
        .eq('circle_id', circleId)
        .eq('agent_name', agentKey)
        .maybeSingle();
      // Fallback: if no per-agent personality, try 'default'
      if (!data?.personality) {
        const { data: defaultData } = await supabase
          .from('agent_personalities')
          .select('personality')
          .eq('user_id', auth.user.id)
          .eq('circle_id', circleId)
          .eq('agent_name', 'default')
          .maybeSingle();
        setSoulText(defaultData?.personality || '');
      } else {
        setSoulText(data.personality);
      }
      setSoulLoaded(agentKey);
    })();
  }, [agent?.name, circleId]);

  // Reset loaded state when agent changes
  useEffect(() => {
    if (!agent) {
      setSoulLoaded(null);
      setSoulText('');
      setShowSoul(false);
    }
  }, [agent?.name]);

  const handleSaveSoul = async () => {
    if (!circleId || !agent) return;
    setSoulSaving(true);
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) { setSoulSaving(false); return; }
    const agentKey = agent.name || 'default';
    const { error } = await supabase
      .from('agent_personalities')
      .upsert({
        user_id: auth.user.id,
        circle_id: circleId,
        agent_name: agentKey,
        personality: soulText.trim(),
      }, { onConflict: 'user_id,circle_id,agent_name' });
    setSoulStatus(error ? `Error: ${error.message}` : 'Soul saved!');
    setSoulSaving(false);
    setTimeout(() => setSoulStatus(''), 3000);
  };

  if (!agent) return null;

  const statusColor = getOfficeStatusColor(agent.status);
  const statusLabel = getOfficeStatusLabel(agent.status).toUpperCase();
  const currentTags = sessionTags?.get(sessionKey!) || [];

  return (
    <Animated.View style={[
      styles.panel,
      isDesktop
        ? { transform: [{ translateX: slideAnim }] }
        : { transform: [{ translateY: slideAnim }] },
      isDesktop && styles.panelDesktop,
    ]}>
      {/* Close button (desktop: top-right X, mobile: drag handle) */}
      {isDesktop ? (
        <View style={styles.desktopHeader}>
          <Text style={styles.desktopHeaderTitle}>AGENT PANEL</Text>
          <Pressable onPress={onClose} style={[styles.desktopCloseBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
            <Text style={styles.desktopCloseBtnText}>✕</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable onPress={onClose} style={styles.handleArea}>
          <View style={styles.handle} />
        </Pressable>
      )}

      <ScrollView style={styles.scrollContent} showsVerticalScrollIndicator={false}>
      {/* Agent header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={[styles.avatar, { backgroundColor: agent.color + '20', borderColor: agent.color }]}>
            <Text style={[styles.avatarText, { color: agent.color }]}>
              {agent.name.charAt(0)}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            {editing ? (
              <View style={styles.renameRow}>
                <TextInput
                  style={styles.renameInput}
                  value={editName}
                  onChangeText={setEditName}
                  autoFocus
                  onSubmitEditing={() => {
                    if (editName.trim() && onRenameAgent) {
                      onRenameAgent(agent.id, editName.trim());
                    }
                    setEditing(false);
                  }}
                />
                <Pressable
                  onPress={() => {
                    if (editName.trim() && onRenameAgent) {
                      onRenameAgent(agent.id, editName.trim());
                    }
                    setEditing(false);
                  }}
                  style={[styles.renameSaveBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                >
                  <Text style={styles.renameSaveText}>✓</Text>
                </Pressable>
                <Pressable
                  onPress={() => setEditing(false)}
                  style={[styles.renameCancelBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                >
                  <Text style={styles.renameCancelText}>✕</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable
                onPress={() => { setEditName(agent.name); setEditing(true); }}
                style={[Platform.OS === 'web' && { cursor: 'pointer' } as any]}
              >
                <View style={styles.nameRow}>
                  <Text style={styles.name}>{agent.name}</Text>
                  <Text style={styles.renameHint}>✏️</Text>
                </View>
              </Pressable>
            )}
            <View style={styles.roleRow}>
              <Text style={styles.role}>{agent.role}</Text>
              <View style={styles.modelBadge}>
                <Text style={styles.modelText}>{agent.model}</Text>
              </View>
            </View>
          </View>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: statusColor + '20', borderColor: statusColor + '40' }]}>
          <View style={[styles.statusDotSmall, { backgroundColor: statusColor }]} />
          <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
        </View>
      </View>

      {/* Connection source */}
      <View style={styles.connectionRow}>
        <Text style={styles.connectionIcon}>{PROVIDER_META[agent.providerType]?.icon || '📡'}</Text>
        <Text style={[styles.connectionName, { color: PROVIDER_META[agent.providerType]?.color || '#888' }]}>{agent.connectionName}</Text>
        <Text style={styles.connectionType}>{PROVIDER_META[agent.providerType]?.label || agent.providerType}</Text>
      </View>

      {/* ── Panel Tab Navigation with prev/next ── */}
      {(() => {
        const allTabs = [
          { key: 'overview', label: 'Overview' },
          ...(agent.providerType === 'openclaw' ? [{ key: 'openclaw', label: 'KingClaw' }] : []),
          { key: 'terminal', label: 'Terminal' },
          { key: 'memory', label: 'Memory' },
          { key: 'runs', label: 'Runs' },
          { key: 'evolution', label: 'Evolution' },
          { key: 'spirit', label: 'Spirit' },
          { key: 'activity', label: 'Activity' },
          { key: 'customize', label: 'Customize' },
        ];
        const currentIdx = allTabs.findIndex(t => t.key === panelTab);
        const prevTab = currentIdx > 0 ? allTabs[currentIdx - 1] : null;
        const nextTab = currentIdx < allTabs.length - 1 ? allTabs[currentIdx + 1] : null;

        return (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#1a1a28', marginBottom: 8 }}>
              {/* Prev arrow */}
              <Pressable
                onPress={() => prevTab && setPanelTab(prevTab.key as any)}
                disabled={!prevTab}
                style={[{ paddingHorizontal: 8, paddingVertical: 8, opacity: prevTab ? 1 : 0.2 }, Platform.OS === 'web' && { cursor: prevTab ? 'pointer' : 'default' } as any]}
              >
                <Text style={{ color: '#606075', fontSize: 14, fontWeight: '700', fontFamily: MONO }}>{'<'}</Text>
              </Pressable>

              {/* Scrollable tabs */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1, maxHeight: 36 }} contentContainerStyle={{ gap: 2 }}>
                {allTabs.map(tab => (
                  <Pressable
                    key={tab.key}
                    onPress={() => setPanelTab(tab.key as any)}
                    accessibilityRole="tab"
                    style={[
                      { paddingHorizontal: 10, paddingVertical: 8, borderBottomWidth: 2, borderBottomColor: panelTab === tab.key ? (agent.color || '#6366f1') : 'transparent' },
                      ...(Platform.OS === 'web' ? [{ cursor: 'pointer', transition: 'all 0.15s ease' } as any] : []),
                    ]}
                  >
                    <Text style={{ color: panelTab === tab.key ? '#f0f0f5' : '#606075', fontSize: 10, fontWeight: panelTab === tab.key ? '700' : '500', fontFamily: MONO }}>{tab.label}</Text>
                  </Pressable>
                ))}
              </ScrollView>

              {/* Next arrow */}
              <Pressable
                onPress={() => nextTab && setPanelTab(nextTab.key as any)}
                disabled={!nextTab}
                style={[{ paddingHorizontal: 8, paddingVertical: 8, opacity: nextTab ? 1 : 0.2 }, Platform.OS === 'web' && { cursor: nextTab ? 'pointer' : 'default' } as any]}
              >
                <Text style={{ color: '#606075', fontSize: 14, fontWeight: '700', fontFamily: MONO }}>{'>'}</Text>
              </Pressable>
            </View>

            {/* Tab position indicator */}
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 3, marginBottom: 6 }}>
              {allTabs.map((tab, i) => (
                <View key={tab.key} style={{ width: i === currentIdx ? 12 : 4, height: 3, borderRadius: 2, backgroundColor: i === currentIdx ? (agent.color || '#6366f1') : '#1a1a28' }} />
              ))}
            </View>
          </>
        );
      })()}

      {/* ── OVERVIEW TAB — one-stop agent command center ── */}
      {panelTab === 'overview' && (() => {
        const toolColors: Record<string, string> = {
          Read: '#22c55e', Write: '#ef4444', Edit: '#f59e0b', Bash: '#ec4899',
          Grep: '#6366f1', Glob: '#22d3ee', Agent: '#a855f7', WebSearch: '#14b8a6',
          WebFetch: '#14b8a6', TodoWrite: '#fb923c', TodoRead: '#fb923c',
          Skill: '#f472b6', LSP: '#84cc16', NotebookEdit: '#38bdf8',
        };
        const shortPath = (p: string) => {
          if (!p) return '';
          const parts = p.split('/');
          return parts.length > 3 ? '.../' + parts.slice(-3).join('/') : p;
        };
        const isActive = agent.status === 'active' || agent.status === 'building';
        return (
        <View nativeID="section-agent-overview" style={{ paddingHorizontal: 8, gap: 8, paddingBottom: 12 }}>

          {/* ── LIVE STATUS HERO — what the agent is doing RIGHT NOW ── */}
          <View style={{ backgroundColor: '#0a0a10', borderWidth: 2, borderColor: isActive ? statusColor + '60' : '#1a1a28', borderRadius: 2, padding: 12, ...(isActive && Platform.OS === 'web' ? { boxShadow: `0 0 12px ${statusColor}20` } as any : {}) }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: statusColor, ...(isActive && Platform.OS === 'web' ? { boxShadow: `0 0 6px ${statusColor}` } as any : {}) }} />
              <Text style={{ color: statusColor, fontSize: 14, fontWeight: '800', fontFamily: MONO, letterSpacing: 1 }}>{statusLabel}</Text>
              <Text style={{ color: '#3a3a4e', fontSize: 10, fontFamily: MONO, marginLeft: 'auto' }}>{formatRelativeTime(agent.lastActive)}</Text>
            </View>

            {/* Current tool in use */}
            {agent.currentToolName ? (
              <View style={{ backgroundColor: '#111118', borderWidth: 1, borderColor: (toolColors[agent.currentToolName] || agent.color) + '40', borderRadius: 2, padding: 8, marginBottom: 6 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View style={{ width: 22, height: 22, borderRadius: 2, backgroundColor: (toolColors[agent.currentToolName] || agent.color) + '20', justifyContent: 'center', alignItems: 'center' }}>
                    <Text style={{ color: toolColors[agent.currentToolName] || agent.color, fontSize: 9, fontWeight: '800', fontFamily: MONO }}>
                      {agent.currentToolName === 'Read' ? 'R' : agent.currentToolName === 'Write' ? 'W' : agent.currentToolName === 'Edit' ? 'E' : agent.currentToolName === 'Bash' ? '>_' : agent.currentToolName === 'Grep' ? '?' : agent.currentToolName === 'Agent' ? 'A' : agent.currentToolName.charAt(0)}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: toolColors[agent.currentToolName] || agent.color, fontSize: 12, fontWeight: '700', fontFamily: MONO }}>{agent.currentToolName}</Text>
                    {agent.currentToolFile ? (
                      <Text style={{ color: '#606075', fontSize: 9, fontFamily: MONO, marginTop: 1 }} numberOfLines={1}>{shortPath(agent.currentToolFile)}</Text>
                    ) : null}
                  </View>
                  {isActive && <Text style={{ color: statusColor, fontSize: 8, fontWeight: '700', fontFamily: MONO, letterSpacing: 1 }}>LIVE</Text>}
                </View>
              </View>
            ) : agent.activity && agent.activity !== 'Idle' ? (
              <Text style={{ color: '#a0a0b0', fontSize: 11, fontFamily: MONO, marginBottom: 4 }}>{agent.activity}</Text>
            ) : null}

            {/* Last user request */}
            {agent.lastUserMessage ? (
              <View style={{ marginBottom: 4 }}>
                <Text style={{ color: '#3a3a4e', fontSize: 8, fontWeight: '700', letterSpacing: 1, marginBottom: 2 }}>USER REQUEST</Text>
                <Text style={{ color: '#808090', fontSize: 10, fontFamily: MONO, lineHeight: 15 }} numberOfLines={3}>{agent.lastUserMessage}</Text>
              </View>
            ) : null}

            {/* Last assistant response snippet */}
            {agent.lastAssistantText ? (
              <View style={{ marginTop: 4 }}>
                <Text style={{ color: '#3a3a4e', fontSize: 8, fontWeight: '700', letterSpacing: 1, marginBottom: 2 }}>AGENT RESPONSE</Text>
                <Text style={{ color: '#a0a0b0', fontSize: 10, fontFamily: MONO, lineHeight: 15 }} numberOfLines={3}>{agent.lastAssistantText}</Text>
              </View>
            ) : null}
          </View>

          {/* ── MODEL + PROVIDER BAR ── */}
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <View style={{ flex: 1, backgroundColor: '#0a0a10', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 2, padding: 8 }}>
              <Text style={{ color: '#3a3a4e', fontSize: 8, fontWeight: '700', letterSpacing: 0.5 }}>MODEL</Text>
              <Text style={{ color: '#6366f1', fontSize: 11, fontWeight: '700', fontFamily: MONO, marginTop: 2 }} numberOfLines={1}>{agent.model !== 'unknown' ? agent.model : '—'}</Text>
            </View>
            <View style={{ flex: 1, backgroundColor: '#0a0a10', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 2, padding: 8 }}>
              <Text style={{ color: '#3a3a4e', fontSize: 8, fontWeight: '700', letterSpacing: 0.5 }}>PROVIDER</Text>
              <Text style={{ color: '#a0a0b0', fontSize: 11, fontWeight: '700', fontFamily: MONO, marginTop: 2 }} numberOfLines={1}>{PROVIDER_META[agent.providerType]?.label || agent.providerType}</Text>
            </View>
            <View style={{ flex: 1, backgroundColor: '#0a0a10', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 2, padding: 8 }}>
              <Text style={{ color: '#3a3a4e', fontSize: 8, fontWeight: '700', letterSpacing: 0.5 }}>TURNS</Text>
              <Text style={{ color: '#f0f0f5', fontSize: 11, fontWeight: '700', fontFamily: MONO, marginTop: 2 }}>{agent.turns || agent.messagesProcessed || 0}</Text>
            </View>
          </View>

          {/* ── COST + TOKEN GRID ── */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {[
              { label: 'API Cost', value: `$${agent.costToday.toFixed(4)}`, color: '#22c55e', icon: '$' },
              { label: 'Total Tokens', value: formatTokens(agent.tokensUsed), color: '#6366f1', icon: '#' },
              { label: 'Input', value: formatTokens(agent.inputTokens), color: '#a0a0b0', icon: '>' },
              { label: 'Output', value: formatTokens(agent.outputTokens), color: '#22d3ee', icon: '<' },
              { label: 'Cached', value: formatTokens(agent.cachedTokens), color: '#f59e0b', icon: 'C' },
              { label: 'Cache Hit', value: cacheHitPct(agent.cachedTokens, agent.inputTokens), color: agent.cachedTokens > agent.inputTokens * 0.3 ? '#22c55e' : '#ef4444', icon: '%' },
            ].map((stat, i) => (
              <View key={i} style={{ width: '31%', backgroundColor: '#0a0a10', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 2, padding: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                  <View style={{ width: 14, height: 14, borderRadius: 2, backgroundColor: stat.color + '15', justifyContent: 'center', alignItems: 'center' }}>
                    <Text style={{ color: stat.color, fontSize: 7, fontWeight: '800', fontFamily: MONO }}>{stat.icon}</Text>
                  </View>
                  <Text style={{ color: '#3a3a4e', fontSize: 7, fontWeight: '600', letterSpacing: 0.5 }}>{stat.label.toUpperCase()}</Text>
                </View>
                <Text style={{ color: stat.color, fontSize: 14, fontWeight: '700', fontFamily: MONO }}>{stat.value}</Text>
              </View>
            ))}
          </View>

          {/* ── TOKEN BAR VISUALIZATION ── */}
          {agent.tokensUsed > 0 && (
            <View style={{ backgroundColor: '#0a0a10', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 2, padding: 10 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                <Text style={{ color: '#3a3a4e', fontSize: 8, fontWeight: '700', letterSpacing: 1 }}>TOKEN DISTRIBUTION</Text>
                <Text style={{ color: '#3a3a4e', fontSize: 8, fontFamily: MONO }}>{formatTokens(agent.tokensUsed)} total</Text>
              </View>
              <View style={{ height: 8, borderRadius: 2, backgroundColor: '#1a1a28', flexDirection: 'row', overflow: 'hidden' }}>
                <View style={{ flex: agent.cachedTokens || 0, backgroundColor: '#f59e0b' }} />
                <View style={{ flex: Math.max(0, (agent.inputTokens - (agent.cachedTokens || 0))) || 0, backgroundColor: '#6366f1' }} />
                <View style={{ flex: agent.outputTokens || 1, backgroundColor: '#22c55e' }} />
              </View>
              <View style={{ flexDirection: 'row', gap: 12, marginTop: 4 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}><View style={{ width: 6, height: 6, borderRadius: 1, backgroundColor: '#f59e0b' }} /><Text style={{ color: '#606075', fontSize: 8 }}>Cached</Text></View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}><View style={{ width: 6, height: 6, borderRadius: 1, backgroundColor: '#6366f1' }} /><Text style={{ color: '#606075', fontSize: 8 }}>New Input</Text></View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}><View style={{ width: 6, height: 6, borderRadius: 1, backgroundColor: '#22c55e' }} /><Text style={{ color: '#606075', fontSize: 8 }}>Output</Text></View>
              </View>
            </View>
          )}

          {/* ── RECENT TOOL CALLS — timeline with file context ── */}
          {(agent.recentToolCalls?.length || 0) > 0 ? (
            <View style={{ backgroundColor: '#0a0a10', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 2, padding: 10 }}>
              <Text style={{ color: '#606075', fontSize: 9, fontWeight: '700', letterSpacing: 1, marginBottom: 6 }}>TOOL TIMELINE ({agent.recentToolCalls!.length})</Text>
              {[...agent.recentToolCalls!].reverse().map((tc, i) => {
                const tc_color = toolColors[tc.tool] || agent.color;
                return (
                  <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginBottom: 4, paddingVertical: 2 }}>
                    <Text style={{ color: '#3a3a4e', fontSize: 8, fontFamily: MONO, width: 44, textAlign: 'right', paddingTop: 2 }}>{tc.ts ? formatMsgTime(tc.ts) : '—'}</Text>
                    <View style={{ width: 2, backgroundColor: i === 0 ? tc_color : '#1a1a28', alignSelf: 'stretch', borderRadius: 1 }} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: tc_color, fontSize: 10, fontWeight: '700', fontFamily: MONO }}>{tc.tool}</Text>
                      {tc.file ? <Text style={{ color: '#606075', fontSize: 8, fontFamily: MONO, marginTop: 1 }} numberOfLines={1}>{shortPath(tc.file)}</Text> : null}
                    </View>
                  </View>
                );
              })}
            </View>
          ) : agent.recentActions.length > 0 ? (
            <View style={{ backgroundColor: '#0a0a10', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 2, padding: 10 }}>
              <Text style={{ color: '#606075', fontSize: 9, fontWeight: '700', letterSpacing: 1, marginBottom: 6 }}>TOOLS USED ({agent.recentActions.length})</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                {agent.recentActions.map((action, i) => {
                  const ac = toolColors[action] || agent.color;
                  return (
                    <View key={i} style={{ backgroundColor: ac + '15', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 2, borderWidth: 1, borderColor: ac + '30' }}>
                      <Text style={{ color: ac, fontSize: 9, fontWeight: '700', fontFamily: MONO }}>{action}</Text>
                    </View>
                  );
                })}
              </View>
            </View>
          ) : null}

          {/* ── ACTIVE FILES — what the agent is touching ── */}
          {(agent.activeFiles?.length || 0) > 0 && (
            <View style={{ backgroundColor: '#0a0a10', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 2, padding: 10 }}>
              <Text style={{ color: '#606075', fontSize: 9, fontWeight: '700', letterSpacing: 1, marginBottom: 6 }}>ACTIVE FILES ({agent.activeFiles!.length})</Text>
              {agent.activeFiles!.map((f, i) => {
                const ext = f.split('.').pop() || '';
                const extColor = { ts: '#3178c6', tsx: '#3178c6', js: '#f7df1e', jsx: '#f7df1e', py: '#3776ab', json: '#f59e0b', md: '#606075', sql: '#22c55e', css: '#ec4899' }[ext] || '#a0a0b0';
                return (
                  <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 2 }}>
                    <View style={{ width: 14, height: 14, borderRadius: 2, backgroundColor: extColor + '20', justifyContent: 'center', alignItems: 'center' }}>
                      <Text style={{ color: extColor, fontSize: 6, fontWeight: '800', fontFamily: MONO }}>{ext.slice(0, 3).toUpperCase()}</Text>
                    </View>
                    <Text style={{ color: '#a0a0b0', fontSize: 9, fontFamily: MONO, flex: 1 }} numberOfLines={1}>{shortPath(f)}</Text>
                  </View>
                );
              })}
            </View>
          )}

          {/* ── SESSION DETAILS ── */}
          <View style={{ backgroundColor: '#0a0a10', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 2, padding: 10 }}>
            <Text style={{ color: '#606075', fontSize: 9, fontWeight: '700', letterSpacing: 1, marginBottom: 6 }}>SESSION</Text>
            {[
              { label: 'Session ID', value: agent.sessionKey || agent.id.split('::')[1] || agent.id },
              { label: 'Connection', value: agent.connectionName },
              ...(agent.projectDir ? [{ label: 'Project', value: shortPath(agent.projectDir) }] : []),
              ...(agent.version ? [{ label: 'Version', value: agent.version }] : []),
              ...(agent.slug ? [{ label: 'Slug', value: agent.slug }] : []),
              ...(agent.subagentCount ? [{ label: 'Sub-Agents', value: String(agent.subagentCount) }] : []),
              { label: 'Last Active', value: agent.lastActive ? new Date(agent.lastActive).toLocaleString() : '—' },
              { label: 'Uptime', value: agent.uptime || formatRelativeTime(agent.lastActive) },
              { label: 'Cost/Turn', value: agent.turns > 0 ? `$${(agent.costToday / agent.turns).toFixed(4)}` : '—' },
              { label: 'Tokens/Turn', value: agent.turns > 0 ? formatTokens(Math.round(agent.tokensUsed / agent.turns)) : '—' },
            ].map((row, i, arr) => (
              <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, borderBottomWidth: i < arr.length - 1 ? 1 : 0, borderBottomColor: '#111118' }}>
                <Text style={{ color: '#3a3a4e', fontSize: 9, fontWeight: '600', fontFamily: MONO }}>{row.label}</Text>
                <Text style={{ color: '#a0a0b0', fontSize: 9, fontFamily: MONO, maxWidth: '60%', textAlign: 'right' }} numberOfLines={1}>{row.value}</Text>
              </View>
            ))}
          </View>

          {/* ── RUNTIME HEALTH ── */}
          <View style={{ backgroundColor: '#0a0a10', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 2, padding: 10, marginBottom: 8 }}>
            <Text style={{ color: '#606075', fontSize: 9, fontWeight: '700', letterSpacing: 1, marginBottom: 6 }}>RUNTIME</Text>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              <View style={{ flex: 1, alignItems: 'center', paddingVertical: 4 }}>
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: isActive ? '#22c55e' : agent.status === 'idle' ? '#f59e0b' : '#ef4444', marginBottom: 3 }} />
                <Text style={{ color: '#a0a0b0', fontSize: 9, fontWeight: '700', fontFamily: MONO }}>{isActive ? 'HEALTHY' : agent.status === 'idle' ? 'IDLE' : 'DOWN'}</Text>
                <Text style={{ color: '#3a3a4e', fontSize: 7, fontFamily: MONO }}>Gateway</Text>
              </View>
              <View style={{ flex: 1, alignItems: 'center', paddingVertical: 4 }}>
                <Text style={{ color: '#6366f1', fontSize: 14, fontWeight: '800', fontFamily: MONO }}>{agent.turns || 0}</Text>
                <Text style={{ color: '#3a3a4e', fontSize: 7, fontFamily: MONO }}>Turns</Text>
              </View>
              <View style={{ flex: 1, alignItems: 'center', paddingVertical: 4 }}>
                <Text style={{ color: '#22c55e', fontSize: 14, fontWeight: '800', fontFamily: MONO }}>${agent.costToday.toFixed(2)}</Text>
                <Text style={{ color: '#3a3a4e', fontSize: 7, fontFamily: MONO }}>Cost</Text>
              </View>
              <View style={{ flex: 1, alignItems: 'center', paddingVertical: 4 }}>
                <Text style={{ color: '#a0a0b0', fontSize: 14, fontWeight: '800', fontFamily: MONO }}>{agent.subagentCount || 0}</Text>
                <Text style={{ color: '#3a3a4e', fontSize: 7, fontFamily: MONO }}>Sub-Agents</Text>
              </View>
            </View>
          </View>

          {/* ── BRIDGE CONTROLS ── */}
          {circleId && sessionKey && (
            <View nativeID="section-agent-controls">
              <AgentControlCard
                agent={agent}
                circleId={circleId}
                control={control}
                onClose={() => {}}
                onOpenPanel={() => {}}
                onDisconnect={onClose}
                onRunCommand={onRunCommand}
                embedded
              />
            </View>
          )}
        </View>
        );
      })()}

      {panelTab === 'openclaw' && agent.providerType === 'openclaw' && (
        <OpenClawFrontendPanel agent={agent} accentColor={agent.color || '#6366f1'} />
      )}

      {/* ── TERMINAL TAB — Remote Shell + AI Terminal ── */}
      {panelTab === 'terminal' && (
        <>
          {onRunCommand && (
            <AgentRemoteShell onRunCommand={onRunCommand} />
          )}
          {circleId && (
            <AgentQuickTerminal agentName={agent.name} agentId={agent.id} circleId={circleId} />
          )}
        </>
      )}

      {/* ── EVOLUTION TAB ── */}
      {panelTab === 'evolution' && (
        <>
          <AgentEvolutionCard
            agentName={agent.name}
            bondLevel={3}
            bondTitle="Trusted"
            bondXP={350}
            bondProgress={0.5}
            masteryLevel={2}
            masteryTitle="Capable"
            masteryXP={120}
            masteryProgress={0.6}
            unlocks={['greeting_pack', 'memory_basic']}
            accentColor={agent.color || '#6366f1'}
          />
          {circleId && userId && (
            <View style={{ marginTop: 8 }}>
              <XPEventFeed circleId={circleId} userId={userId} limit={15} />
            </View>
          )}
          <View style={{ alignItems: 'center', marginTop: 12 }}>
            <StreakFlame streakDays={7} accentColor={agent.color || '#6366f1'} />
          </View>
        </>
      )}

      {/* ── SPIRIT TAB ── */}
      {panelTab === 'spirit' && (
        <>
      {/* Agent Spirit & Soul — unified section */}
      <Pressable
        onPress={() => setShowSpirits(!showSpirits)}
        style={[styles.spiritRow, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
      >
        <Text style={styles.spiritLabel}>
          {showSpirits ? '▼' : '▶'} SOUL
        </Text>
        {currentSpirit ? (
          <View style={[styles.spiritBadge, { flexDirection: 'row', alignItems: 'center', gap: 6 }]}>
            {ICON_CATALOG[currentSpirit] ? (
              <FlatIcon name={currentSpirit} size={18} />
            ) : (
              <Text style={{ fontSize: 12 }}>{getSpiritById(currentSpirit)?.emoji}</Text>
            )}
            <Text style={styles.spiritBadgeText}>
              {getSpiritById(currentSpirit)?.name}
            </Text>
          </View>
        ) : (
          <Text style={styles.spiritNone}>none assigned</Text>
        )}
      </Pressable>

      {showSpirits && (
        <View style={styles.spiritPicker}>
          <Text style={styles.spiritHint}>
            Assign a specialty that shapes how {agent.name} thinks, responds, and what it knows.
          </Text>
          {/* Selected spirit detail view — editable */}
          {currentSpirit && getSpiritById(currentSpirit) && (() => {
            const s = getSpiritById(currentSpirit)!;
            const postureColors: Record<string, string> = {
              'act': '#22c55e', 'act-gated': '#3b82f6', 'observe-act-gated': '#f59e0b',
              'observe-propose': '#a855f7', 'propose': '#6366f1', 'never-act': '#ef4444',
            };
            const riskColors: Record<string, string> = {
              'low': '#22c55e', 'medium': '#f59e0b', 'high': '#ef4444', 'critical': '#dc2626',
            };
            const knobs = editingSpirit ? customKnobs : {
              actionPosture: s.actionPosture, evidencePosture: s.evidencePosture,
              communicationDensity: s.communicationDensity, skepticism: s.skepticism,
              riskTier: s.riskTier, escalationTrigger: s.escalationTrigger, skillBundle: s.skillBundle,
            };
            const prompt = editingSpirit ? customPrompt : s.systemPromptPrefix;

            const KnobPicker = ({ label, value, options, colors }: { label: string; value: string; options: string[]; colors?: Record<string, string> }) => (
              <View style={styles.spiritKnob}>
                <Text style={styles.spiritKnobLabel}>{label}</Text>
                {editingSpirit ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 3, justifyContent: 'center' }}>
                    {options.map(opt => (
                      <Pressable key={opt} onPress={() => setCustomKnobs(prev => ({ ...prev, [label === 'ACTION' ? 'actionPosture' : label === 'EVIDENCE' ? 'evidencePosture' : label === 'COMMUNICATION' ? 'communicationDensity' : label === 'SKEPTICISM' ? 'skepticism' : 'riskTier']: opt }))}
                        style={[{ paddingHorizontal: 4, paddingVertical: 2, borderRadius: 4, borderWidth: 1, borderColor: value === opt ? (colors?.[opt] || '#6366f1') + '60' : '#1e1e3a', backgroundColor: value === opt ? (colors?.[opt] || '#6366f1') + '15' : 'transparent' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                        <Text style={{ fontSize: 8, fontFamily: 'monospace', fontWeight: '700', color: value === opt ? (colors?.[opt] || '#6366f1') : '#555' }}>{opt.replace(/-/g, ' ').toUpperCase()}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : (
                  <Text style={[styles.spiritKnobValue, { color: (colors?.[value] || '#6366f1') }]}>{value.replace(/-/g, ' ').toUpperCase()}</Text>
                )}
              </View>
            );

            return (
              <View style={styles.spiritDetail}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  {ICON_CATALOG[s.id] ? <FlatIcon name={s.id} size={28} glow /> : <Text style={{ fontSize: 24 }}>{s.emoji}</Text>}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.spiritDetailName}>{s.name}</Text>
                    <Text style={styles.spiritDetailTagline}>{s.tagline}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    <Pressable
                      onPress={() => {
                        if (!editingSpirit) {
                          setCustomPrompt(s.systemPromptPrefix);
                          setCustomKnobs({ actionPosture: s.actionPosture, evidencePosture: s.evidencePosture, communicationDensity: s.communicationDensity, skepticism: s.skepticism, riskTier: s.riskTier, escalationTrigger: s.escalationTrigger, skillBundle: s.skillBundle });
                        }
                        setEditingSpirit(!editingSpirit);
                      }}
                      style={[{ paddingVertical: 5, paddingHorizontal: 10, borderRadius: 6, backgroundColor: editingSpirit ? '#6366f120' : '#ffffff08', borderWidth: 1, borderColor: editingSpirit ? '#6366f140' : '#ffffff15' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                    >
                      <Text style={{ fontSize: 10, fontFamily: 'monospace', fontWeight: '700', color: editingSpirit ? '#6366f1' : '#888' }}>{editingSpirit ? 'EDITING' : 'EDIT'}</Text>
                    </Pressable>
                    <Pressable onPress={async () => { const id = await ensureDbAgent(); if (id) { await updateAgentSpirit(id, null, null); setCurrentSpirit(null); setEditingSpirit(false); } }}
                      style={[styles.spiritClearBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                      <Text style={styles.spiritClearText}>Clear</Text>
                    </Pressable>
                  </View>
                </View>

                {/* Behavioral knobs */}
                <View style={styles.spiritKnobsGrid}>
                  <KnobPicker label="ACTION" value={knobs.actionPosture} options={['act', 'act-gated', 'observe-act-gated', 'observe-propose', 'propose', 'never-act']} colors={postureColors} />
                  <KnobPicker label="EVIDENCE" value={knobs.evidencePosture} options={['medium', 'high', 'very-high']} />
                  <KnobPicker label="COMMUNICATION" value={knobs.communicationDensity} options={['terse', 'normal', 'detailed', 'motivational']} />
                  <KnobPicker label="SKEPTICISM" value={knobs.skepticism} options={['low', 'medium', 'high', 'very-high']} colors={{ 'low': '#22c55e', 'medium': '#f59e0b', 'high': '#ef4444', 'very-high': '#dc2626' }} />
                  <KnobPicker label="RISK TIER" value={knobs.riskTier} options={['low', 'medium', 'high', 'critical']} colors={riskColors} />
                  <View style={styles.spiritKnob}>
                    <Text style={styles.spiritKnobLabel}>SKILL</Text>
                    {editingSpirit ? (
                      <TextInput value={customKnobs.skillBundle} onChangeText={v => setCustomKnobs(prev => ({ ...prev, skillBundle: v }))}
                        style={{ fontSize: 9, color: '#6366f1', fontFamily: 'monospace', fontWeight: '700', textAlign: 'center', borderBottomWidth: 1, borderBottomColor: '#1e1e3a', paddingVertical: 2 }} placeholder="skill-name" placeholderTextColor="#333" />
                    ) : (
                      <Text style={[styles.spiritKnobValue, { color: '#6366f1' }]} numberOfLines={1}>{knobs.skillBundle}</Text>
                    )}
                  </View>
                </View>

                {/* Escalation trigger */}
                <View style={styles.spiritEscalation}>
                  <Text style={styles.spiritKnobLabel}>ESCALATES WHEN</Text>
                  {editingSpirit ? (
                    <TextInput value={customKnobs.escalationTrigger} onChangeText={v => setCustomKnobs(prev => ({ ...prev, escalationTrigger: v }))}
                      style={[styles.spiritEscalationText, { borderBottomWidth: 1, borderBottomColor: '#1e1e3a', paddingVertical: 4 }]}
                      placeholder="e.g. failing tests, unclear requirements" placeholderTextColor="#333" />
                  ) : (
                    <Text style={styles.spiritEscalationText}>{knobs.escalationTrigger}</Text>
                  )}
                </View>

                {/* System prompt — collapsible, editable */}
                <Pressable onPress={() => setShowSoul(!showSoul)} style={[{ marginTop: 10, paddingVertical: 6 }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                  <Text style={{ color: '#888', fontSize: 11, fontFamily: 'monospace', fontWeight: '800', letterSpacing: 1 }}>
                    {showSoul ? '▼' : '▶'} SYSTEM PROMPT ({Math.round(prompt.length / 100) * 100}+ chars)
                  </Text>
                </Pressable>
                {showSoul && (
                  <View style={{ marginTop: 4 }}>
                    {editingSpirit ? (
                      <TextInput value={customPrompt} onChangeText={setCustomPrompt} multiline
                        style={{ backgroundColor: '#000', borderWidth: 1, borderColor: '#1e1e3a', borderRadius: 8, padding: 12, color: '#ccc', fontFamily: 'monospace', fontSize: 11, minHeight: 200, maxHeight: 400, textAlignVertical: 'top' }}
                        placeholder="System prompt instructions..." placeholderTextColor="#333" />
                    ) : (
                      <ScrollView style={{ maxHeight: 300, backgroundColor: '#000', borderWidth: 1, borderColor: '#1e1e3a', borderRadius: 8, padding: 12 }}>
                        <Text style={{ color: '#aaa', fontFamily: 'monospace', fontSize: 11, lineHeight: 17 }} selectable>{prompt}</Text>
                      </ScrollView>
                    )}
                  </View>
                )}

                {/* Save as custom profile */}
                {editingSpirit && (
                  <View style={{ marginTop: 12 }}>
                    {showSaveForm ? (
                      <View style={{ gap: 8 }}>
                        <TextInput value={saveProfileName} onChangeText={setSaveProfileName} placeholder="Profile name..." placeholderTextColor="#555"
                          style={{ backgroundColor: '#000', borderWidth: 1, borderColor: '#1e1e3a', borderRadius: 8, padding: 10, color: '#eee', fontFamily: 'monospace', fontSize: 13 }} />
                        <View style={{ flexDirection: 'row', gap: 8 }}>
                          <Pressable
                            onPress={async () => {
                              if (!saveProfileName.trim()) return;
                              setSavingProfile(true);
                              const { data: auth } = await supabase.auth.getUser();
                              if (!auth.user) { setSavingProfile(false); return; }
                              const { data, error } = await supabase.from('custom_agent_profiles').upsert({
                                user_id: auth.user.id, name: saveProfileName.trim(),
                                system_prompt: customPrompt, skill_bundle: customKnobs.skillBundle,
                                risk_tier: customKnobs.riskTier, action_posture: customKnobs.actionPosture,
                                evidence_posture: customKnobs.evidencePosture, communication_density: customKnobs.communicationDensity,
                                skepticism: customKnobs.skepticism, escalation_trigger: customKnobs.escalationTrigger,
                                emoji: getSpiritById(currentSpirit)?.emoji || '🤖', color: getSpiritById(currentSpirit)?.color || '#6366f1',
                                tagline: `Custom ${s.name} profile`,
                              }, { onConflict: 'user_id,name' }).select().single();
                              if (!error && data) {
                                setCustomProfiles(prev => [...prev.filter(p => p.id !== data.id), data]);
                                setShowSaveForm(false); setSaveProfileName('');
                              }
                              setSavingProfile(false);
                            }}
                            style={[{ flex: 1, paddingVertical: 10, borderRadius: 8, backgroundColor: '#22c55e15', borderWidth: 1, borderColor: '#22c55e40', alignItems: 'center' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                            <Text style={{ color: '#22c55e', fontSize: 12, fontFamily: 'monospace', fontWeight: '800' }}>{savingProfile ? '...' : 'SAVE PROFILE'}</Text>
                          </Pressable>
                          <Pressable onPress={() => setShowSaveForm(false)}
                            style={[{ paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8, backgroundColor: '#ffffff08', borderWidth: 1, borderColor: '#ffffff15' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                            <Text style={{ color: '#888', fontSize: 12, fontFamily: 'monospace', fontWeight: '700' }}>Cancel</Text>
                          </Pressable>
                        </View>
                      </View>
                    ) : (
                      <Pressable onPress={() => { setSaveProfileName(s.name + ' (Custom)'); setShowSaveForm(true); }}
                        style={[{ paddingVertical: 10, borderRadius: 8, backgroundColor: '#6366f115', borderWidth: 1, borderColor: '#6366f140', alignItems: 'center' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                        <Text style={{ color: '#6366f1', fontSize: 12, fontFamily: 'monospace', fontWeight: '800', letterSpacing: 0.5 }}>💾 SAVE AS CUSTOM PROFILE</Text>
                      </Pressable>
                    )}
                  </View>
                )}
              </View>
            );
          })()}

          {/* Custom profiles section */}
          {customProfiles.length > 0 && (
            <View style={{ marginBottom: 10 }}>
              <Text style={[styles.spiritCatLabel, { color: '#22c55e' }]}>Your Custom Profiles</Text>
              <View style={styles.spiritGrid}>
                {customProfiles.map(profile => {
                  const active = currentSpirit === `custom::${profile.id}`;
                  return (
                    <Pressable key={profile.id}
                      onPress={async () => {
                        const id = await ensureDbAgent();
                        if (id) {
                          await updateAgentSpirit(id, `custom::${profile.id}`, profile.emoji);
                          setCurrentSpirit(`custom::${profile.id}`);
                        }
                      }}
                      onLongPress={async () => {
                        // Delete on long press
                        await supabase.from('custom_agent_profiles').delete().eq('id', profile.id);
                        setCustomProfiles(prev => prev.filter(p => p.id !== profile.id));
                        if (currentSpirit === `custom::${profile.id}`) {
                          const dbId = await ensureDbAgent();
                          if (dbId) { await updateAgentSpirit(dbId, null, null); setCurrentSpirit(null); }
                        }
                      }}
                      style={[styles.spiritCard, active && { borderColor: (profile.color || '#22c55e') + '60', backgroundColor: (profile.color || '#22c55e') + '10' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                      <View style={{ alignItems: 'center', marginBottom: 6 }}>
                        <Text style={{ fontSize: 28 }}>{profile.emoji || '🤖'}</Text>
                      </View>
                      <Text style={[styles.spiritName, active && { color: profile.color || '#22c55e' }]} numberOfLines={1}>{profile.name}</Text>
                      <Text style={styles.spiritTagline} numberOfLines={1}>{profile.tagline || 'Custom profile'}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}

          {SPIRIT_CATEGORIES.map(cat => (
            <View key={cat.key}>
              <Text style={[styles.spiritCatLabel, { color: cat.color }]}>{cat.label}</Text>
              <View style={styles.spiritGrid}>
                {AGENT_SPIRITS.filter(s => s.category === cat.key).map(spirit => {
                  const active = currentSpirit === spirit.id;
                  return (
                    <Pressable
                      key={spirit.id}
                      onPress={async () => {
                        const id = await ensureDbAgent();
                        if (id) {
                          await updateAgentSpirit(id, spirit.id, spirit.emoji);
                          setCurrentSpirit(spirit.id);
                        }
                      }}
                      style={[
                        styles.spiritCard,
                        active && { borderColor: spirit.color + '60', backgroundColor: spirit.color + '10' },
                        Platform.OS === 'web' && { cursor: 'pointer' } as any,
                      ]}
                    >
                      <View style={{ alignItems: 'center', marginBottom: 6 }}>
                        {ICON_CATALOG[spirit.id] ? (
                          <FlatIcon name={spirit.id} size={32} glow={active} />
                        ) : (
                          <Text style={styles.spiritEmoji}>{spirit.emoji}</Text>
                        )}
                      </View>
                      <Text style={[styles.spiritName, active && { color: spirit.color }]} numberOfLines={1}>
                        {spirit.name}
                      </Text>
                      <Text style={styles.spiritTagline} numberOfLines={1}>{spirit.tagline}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}

          {/* Personality (Soul) — inline below spirit grid */}
          {circleId && (
            <View style={styles.soulInlineSection}>
              <Text style={[styles.spiritCatLabel, { color: '#a855f7' }]}>Personality</Text>
              <Text style={styles.spiritHint}>
                Optional: fine-tune communication style. Prepended to every LLM call alongside the spirit.
              </Text>

              {/* Personality template quick-picks with scroll arrows */}
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 4 }}>
                <Pressable
                  onPress={() => personalityScrollRef.current?.scrollTo({ x: Math.max(0, (personalityScrollX.current || 0) - 200), animated: true })}
                  style={[styles.scrollArrow, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                >
                  <Text style={styles.scrollArrowText}>‹</Text>
                </Pressable>
                <ScrollView
                  ref={personalityScrollRef}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={{ flex: 1 }}
                  onScroll={(e) => { personalityScrollX.current = e.nativeEvent.contentOffset.x; }}
                  scrollEventThrottle={16}
                >
                  {getTemplatesByCategory('personality').map(tmpl => {
                    const isActive = detectTemplate(soulText)?.id === tmpl.id;
                    return (
                      <Pressable
                        key={tmpl.id}
                        onPress={() => setSoulText(tmpl.soulText)}
                        style={[
                          styles.personalityChip,
                          isActive && { borderColor: '#6366f1', backgroundColor: '#6366f115' },
                          Platform.OS === 'web' && { cursor: 'pointer' } as any,
                        ]}
                      >
                        <Text style={styles.personalityChipText}>
                          {tmpl.emoji} {tmpl.name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
                <Pressable
                  onPress={() => personalityScrollRef.current?.scrollTo({ x: (personalityScrollX.current || 0) + 200, animated: true })}
                  style={[styles.scrollArrow, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                >
                  <Text style={styles.scrollArrowText}>›</Text>
                </Pressable>
              </View>

              {/* Editable soul text */}
              <TextInput
                style={styles.soulInput}
                value={soulText}
                onChangeText={setSoulText}
                placeholder="Pick a personality or write custom SOUL..."
                placeholderTextColor="#444"
                multiline
                numberOfLines={3}
              />

              {/* Save / Clear row */}
              <View style={styles.soulActions}>
                <Pressable
                  onPress={handleSaveSoul}
                  disabled={soulSaving}
                  style={[styles.soulSaveBtn, soulSaving && { opacity: 0.4 }]}
                >
                  <Text style={styles.soulSaveBtnText}>{soulSaving ? 'SAVING...' : 'SAVE SOUL'}</Text>
                </Pressable>
                {soulText.trim() ? (
                  <Pressable onPress={() => setSoulText('')} style={styles.soulClearBtn}>
                    <Text style={styles.soulClearBtnText}>CLEAR</Text>
                  </Pressable>
                ) : null}
                {soulStatus ? (
                  <Text style={{ fontSize: 8, color: soulStatus.startsWith('Error') ? '#ef4444' : '#22c55e', fontFamily: 'monospace' }}>
                    {soulStatus}
                  </Text>
                ) : null}
              </View>
            </View>
          )}
        </View>
      )}

      {/* Current activity */}
      <View style={styles.activityBar}>
        <Text style={styles.activityLabel}>NOW:</Text>
        <Text style={styles.activityValue}>{agent.activity}</Text>
      </View>

      {/* Session Tags */}
      {onAddSessionTag && onRemoveSessionTag && sessionKey && (
        <View style={styles.tagsSection}>
          <Text style={styles.tagsSectionTitle}>SESSION TAGS</Text>
          <SessionTagInput
            sessionKey={sessionKey}
            currentTags={currentTags}
            onAddTag={(tag) => onAddSessionTag(sessionKey, tag)}
            onRemoveTag={(tagKey) => onRemoveSessionTag(sessionKey, tagKey)}
          />
        </View>
      )}

      {/* Cost grid moved to Overview tab */}

      {/* Close spirit tab */}
        </>
      )}

      {/* ── MEMORY TAB — view and edit agent memories ── */}
      {panelTab === 'memory' && circleId && (
        <View nativeID="section-agent-memory" style={{ paddingHorizontal: 8, paddingBottom: 12 }}>
          <AgentMemoryPanel circleId={circleId} userId={userId || undefined} agentName={agent.name} accentColor={agent.color || '#6366f1'} />
        </View>
      )}

      {/* ── RUNS TAB — recent agent runs and their status ── */}
      {panelTab === 'runs' && circleId && (
        <View nativeID="section-agent-runs" style={{ paddingHorizontal: 8, paddingBottom: 12 }}>
          <AgentRunsPanel circleId={circleId} agentName={agent.name} accentColor={agent.color || '#6366f1'} />
        </View>
      )}

      {/* ── ACTIVITY TAB — comprehensive agent telemetry ── */}
      {panelTab === 'activity' && (
        <View nativeID="section-agent-activity-detail" style={{ paddingHorizontal: 8, gap: 8, paddingBottom: 12 }}>

          {/* ── Session Status Card ── */}
          <View style={{ backgroundColor: '#0a0a10', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 2, padding: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: statusColor }} />
              <Text style={{ color: statusColor, fontSize: 13, fontWeight: '700', fontFamily: MONO }}>{statusLabel.toUpperCase()}</Text>
              <Text style={{ color: '#606075', fontSize: 10, marginLeft: 'auto' }}>{formatRelativeTime(agent.lastActive)}</Text>
            </View>
            {agent.activity && agent.activity !== 'Idle' && (
              <Text style={{ color: '#a0a0b0', fontSize: 11, fontFamily: MONO, marginBottom: 4 }}>{agent.activity}</Text>
            )}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
              <View style={{ backgroundColor: '#1a1a28', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 2, borderWidth: 1, borderColor: '#2a2a3e' }}>
                <Text style={{ color: '#a0a0b0', fontSize: 9, fontFamily: MONO }}>{PROVIDER_META[agent.providerType]?.label || agent.providerType}</Text>
              </View>
              {agent.model !== 'unknown' && (
                <View style={{ backgroundColor: '#1a1a28', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 2, borderWidth: 1, borderColor: '#2a2a3e' }}>
                  <Text style={{ color: '#6366f1', fontSize: 9, fontFamily: MONO }}>{agent.model}</Text>
                </View>
              )}
              <View style={{ backgroundColor: '#1a1a28', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 2, borderWidth: 1, borderColor: '#2a2a3e' }}>
                <Text style={{ color: '#606075', fontSize: 9, fontFamily: MONO }}>{agent.connectionName}</Text>
              </View>
            </View>
          </View>

          {/* ── Token Breakdown ── */}
          <View style={{ backgroundColor: '#0a0a10', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 2, padding: 10 }}>
            <Text style={{ color: '#606075', fontSize: 9, fontWeight: '700', letterSpacing: 1, marginBottom: 8 }}>TOKEN BREAKDOWN</Text>
            {/* Token bar visualization */}
            {agent.tokensUsed > 0 && (
              <View style={{ height: 6, borderRadius: 2, backgroundColor: '#1a1a28', flexDirection: 'row', overflow: 'hidden', marginBottom: 8 }}>
                <View style={{ flex: agent.cachedTokens || 0, backgroundColor: '#f59e0b' }} />
                <View style={{ flex: (agent.inputTokens - (agent.cachedTokens || 0)) || 1, backgroundColor: '#6366f1' }} />
                <View style={{ flex: agent.outputTokens || 1, backgroundColor: '#22c55e' }} />
              </View>
            )}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {[
                { label: 'TOTAL', value: formatTokens(agent.tokensUsed), color: '#f0f0f5' },
                { label: 'INPUT', value: formatTokens(agent.inputTokens), color: '#6366f1' },
                { label: 'OUTPUT', value: formatTokens(agent.outputTokens), color: '#22c55e' },
                { label: 'CACHED', value: formatTokens(agent.cachedTokens), color: '#f59e0b' },
                { label: 'NEW', value: formatTokens(agent.newTokens || (agent.inputTokens - agent.cachedTokens)), color: '#a0a0b0' },
                { label: 'CACHE HIT', value: cacheHitPct(agent.cachedTokens, agent.inputTokens), color: agent.cachedTokens > agent.inputTokens * 0.5 ? '#22c55e' : '#ef4444' },
              ].map((t, i) => (
                <View key={i} style={{ width: '31%', marginBottom: 4 }}>
                  <Text style={{ color: t.color, fontSize: 14, fontWeight: '700', fontFamily: MONO }}>{t.value}</Text>
                  <Text style={{ color: '#3a3a4e', fontSize: 8, fontWeight: '600', letterSpacing: 0.5, marginTop: 1 }}>{t.label}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* ── Cost Analysis ── */}
          <View style={{ backgroundColor: '#0a0a10', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 2, padding: 10 }}>
            <Text style={{ color: '#606075', fontSize: 9, fontWeight: '700', letterSpacing: 1, marginBottom: 8 }}>COST ANALYSIS</Text>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {[
                { label: 'SESSION', value: `$${agent.costToday.toFixed(4)}`, color: '#22c55e' },
                { label: 'TOTAL', value: `$${((agent as any).costTotal || agent.costToday).toFixed(4)}`, color: '#22d3ee' },
                { label: 'COST/TURN', value: agent.turns > 0 ? `$${(agent.costToday / agent.turns).toFixed(4)}` : '—', color: '#a0a0b0' },
              ].map((c, i) => (
                <View key={i} style={{ flex: 1, backgroundColor: '#111118', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 2, padding: 8, alignItems: 'center' }}>
                  <Text style={{ color: c.color, fontSize: 14, fontWeight: '800', fontFamily: MONO }}>{c.value}</Text>
                  <Text style={{ color: '#3a3a4e', fontSize: 8, fontWeight: '600', letterSpacing: 0.5, marginTop: 2 }}>{c.label}</Text>
                </View>
              ))}
            </View>
            {/* Efficiency metrics */}
            <View style={{ flexDirection: 'row', gap: 6, marginTop: 6 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: '#606075', fontSize: 8 }}>Tokens/Turn</Text>
                <Text style={{ color: '#a0a0b0', fontSize: 11, fontWeight: '700', fontFamily: MONO }}>{agent.turns > 0 ? formatTokens(Math.round(agent.tokensUsed / agent.turns)) : '—'}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: '#606075', fontSize: 8 }}>Output Ratio</Text>
                <Text style={{ color: '#a0a0b0', fontSize: 11, fontWeight: '700', fontFamily: MONO }}>{agent.tokensUsed > 0 ? Math.round((agent.outputTokens / agent.tokensUsed) * 100) + '%' : '—'}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: '#606075', fontSize: 8 }}>Turns</Text>
                <Text style={{ color: '#a0a0b0', fontSize: 11, fontWeight: '700', fontFamily: MONO }}>{agent.turns || agent.messagesProcessed || 0}</Text>
              </View>
            </View>
          </View>

          {/* ── Tools Used ── */}
          {agent.recentActions.length > 0 && (
            <View style={{ backgroundColor: '#0a0a10', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 2, padding: 10 }}>
              <Text style={{ color: '#606075', fontSize: 9, fontWeight: '700', letterSpacing: 1, marginBottom: 8 }}>TOOLS USED ({agent.recentActions.length})</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                {agent.recentActions.map((action, i) => {
                  const toolColors: Record<string, string> = {
                    Read: '#22c55e', Write: '#ef4444', Edit: '#f59e0b', Bash: '#ec4899',
                    Grep: '#6366f1', Glob: '#22d3ee', Agent: '#a855f7', WebSearch: '#14b8a6',
                    WebFetch: '#14b8a6', TodoWrite: '#fb923c', TodoRead: '#fb923c',
                  };
                  const tc = toolColors[action] || agent.color;
                  return (
                    <View key={i} style={{ backgroundColor: tc + '15', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 2, borderWidth: 1, borderColor: tc + '30' }}>
                      <Text style={{ color: tc, fontSize: 9, fontWeight: '700', fontFamily: MONO }}>{action}</Text>
                    </View>
                  );
                })}
              </View>
            </View>
          )}

          {/* ── Session Identity ── */}
          <View style={{ backgroundColor: '#0a0a10', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 2, padding: 10 }}>
            <Text style={{ color: '#606075', fontSize: 9, fontWeight: '700', letterSpacing: 1, marginBottom: 6 }}>SESSION INFO</Text>
            {[
              { label: 'Session ID', value: agent.sessionKey || agent.id.split('::')[1] || agent.id },
              { label: 'Connection', value: agent.connectionName },
              { label: 'Provider', value: PROVIDER_META[agent.providerType]?.label || agent.providerType },
              { label: 'Model', value: agent.model !== 'unknown' ? agent.model : '—' },
              { label: 'Agent ID', value: agent.id },
              { label: 'Desk', value: `Position ${agent.deskIndex}` },
              { label: 'Last Active', value: agent.lastActive ? new Date(agent.lastActive).toLocaleString() : '—' },
              { label: 'Uptime', value: agent.uptime || formatRelativeTime(agent.lastActive) },
            ].map((row, i) => (
              <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, borderBottomWidth: i < 7 ? 1 : 0, borderBottomColor: '#1a1a28' }}>
                <Text style={{ color: '#3a3a4e', fontSize: 9, fontWeight: '600', fontFamily: MONO }}>{row.label}</Text>
                <Text style={{ color: '#a0a0b0', fontSize: 9, fontFamily: MONO, maxWidth: '65%', textAlign: 'right' }} numberOfLines={1}>{row.value}</Text>
              </View>
            ))}
          </View>

          {/* ── Message History ── */}
          <View style={{ backgroundColor: '#0a0a10', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 2, padding: 10 }}>
            <Text style={{ color: '#606075', fontSize: 9, fontWeight: '700', letterSpacing: 1, marginBottom: 8 }}>
              MESSAGE LOG {agent.recentMessages.length > 0 ? `(${agent.recentMessages.length})` : ''}
            </Text>
            {agent.recentMessages.length > 0 ? (
              [...agent.recentMessages].reverse().map((msg, i) => (
                <View key={i} style={{ marginBottom: 8, paddingBottom: 8, borderBottomWidth: i < agent.recentMessages.length - 1 ? 1 : 0, borderBottomColor: '#1a1a28' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: msg.role === 'assistant' ? agent.color : '#606075' }} />
                    <Text style={{ color: msg.role === 'assistant' ? agent.color : '#606075', fontSize: 8, fontWeight: '800', fontFamily: MONO, letterSpacing: 1 }}>{msg.role.toUpperCase()}</Text>
                    <Text style={{ color: '#3a3a4e', fontSize: 8, fontFamily: MONO, marginLeft: 'auto' }}>{formatMsgTime(msg.timestamp)}</Text>
                  </View>
                  <Text style={{ color: i === 0 ? '#d0d0d8' : '#808090', fontSize: 11, fontFamily: MONO, lineHeight: 16, paddingLeft: 12 }} numberOfLines={4}>
                    {msg.content}
                  </Text>
                </View>
              ))
            ) : agent.recentActions.length > 0 ? (
              <View>
                <Text style={{ color: '#3a3a4e', fontSize: 9, fontStyle: 'italic', marginBottom: 6 }}>No messages — showing tool activity:</Text>
                {agent.recentActions.map((action, i) => (
                  <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 3 }}>
                    <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: i === 0 ? agent.color : '#2a2a3e' }} />
                    <Text style={{ color: i === 0 ? '#a0a0b0' : '#606075', fontSize: 10, fontFamily: MONO }}>{action}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={{ color: '#3a3a4e', fontSize: 10, fontFamily: MONO, fontStyle: 'italic' }}>No recent activity</Text>
            )}
          </View>

          {/* ── Performance Summary ── */}
          <View style={{ backgroundColor: '#0a0a10', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 2, padding: 10 }}>
            <Text style={{ color: '#606075', fontSize: 9, fontWeight: '700', letterSpacing: 1, marginBottom: 6 }}>PERFORMANCE</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {[
                { label: 'Messages', value: String(agent.messagesProcessed || agent.turns || 0), icon: '>' },
                { label: 'Tools', value: String(agent.recentActions.length), icon: '$' },
                { label: 'Efficiency', value: agent.cachedTokens > 0 ? cacheHitPct(agent.cachedTokens, agent.inputTokens) : '—', icon: '%' },
              ].map((p, i) => (
                <View key={i} style={{ flex: 1, alignItems: 'center', paddingVertical: 6 }}>
                  <View style={{ width: 24, height: 24, borderRadius: 2, backgroundColor: agent.color + '15', borderWidth: 1, borderColor: agent.color + '30', justifyContent: 'center', alignItems: 'center', marginBottom: 4 }}>
                    <Text style={{ color: agent.color, fontSize: 10, fontWeight: '800', fontFamily: MONO }}>{p.icon}</Text>
                  </View>
                  <Text style={{ color: '#f0f0f5', fontSize: 13, fontWeight: '700', fontFamily: MONO }}>{p.value}</Text>
                  <Text style={{ color: '#3a3a4e', fontSize: 8, marginTop: 2 }}>{p.label}</Text>
                </View>
              ))}
            </View>
          </View>

        </View>
      )}

      {/* ── CUSTOMIZE TAB — opens expanded by default ── */}
      {panelTab === 'customize' && onAppearanceChange && (() => {
        // Auto-open customize when tab is selected
        if (!showCustomize) setTimeout(() => setShowCustomize(true), 0);
        return null;
      })()}
      {panelTab === 'customize' && onAppearanceChange && (
        <View style={styles.customizeSection}>

          {showCustomize && (() => {
            const a = appearances?.[agent.id] || appearances?.[agent.name] || { ...DEFAULT_APPEARANCE, shirtColor: agent.color, hairColor: agent.color };
            const update = (patch: Partial<AgentAppearance>) => {
              onAppearanceChange(agent.id, { ...a, ...patch });
            };

            const NEON_SKIN_TONES = ['#ff00ff', '#00ff88', '#00ffff', '#ff4444', '#ffff00', '#aa55ff'];

            const ColorScroll = ({ label, colors, value, onSelect }: { label: string; colors: string[]; value: string; onSelect: (c: string) => void }) => (
              <>
                <Text style={styles.custSectionTitle}>{label}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.custScroll}>
                  {colors.map(c => {
                    const active = value === c;
                    const isNeon = NEON_SKIN_TONES.includes(c);
                    return (
                      <Pressable key={c} onPress={() => onSelect(c)}
                        style={[styles.custItemSwatch, { backgroundColor: c }, isNeon && { shadowColor: c, shadowOffset: { width: 0, height: 0 }, shadowRadius: 8, shadowOpacity: 0.9 }, active && styles.custItemSwatchActive, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                        {active && <Text style={styles.custItemCheck}>✓</Text>}
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </>
            );

            const ItemScroll = ({ label, items }: { label: string; items: { key: string; emoji: string; name: string; active: boolean; glow?: string }[] }) => (
              <>
                <Text style={styles.custSectionTitle}>{label}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.custScroll}>
                  {items.map(item => (
                    <Pressable key={item.key}
                      onPress={() => {
                        const field = label === 'HAT' ? 'hat' : label === 'EXPRESSION' ? 'expression' : label === 'ACCESSORY' ? 'accessory' : label === 'BACK ITEM' ? 'backItem' : label === 'FACIAL HAIR' ? 'facialHair' : label === 'PET' ? 'pet' : label === 'AURA' ? 'aura' : label === 'HAND ITEM' ? 'handItem' : label === 'HAIR STYLE' ? 'hairStyle' : '';
                        if (field) update({ [field]: item.key } as any);
                      }}
                      style={[styles.custItemCard, item.active && styles.custItemCardActive, item.active && item.glow && { shadowColor: item.glow, shadowOffset: { width: 0, height: 0 }, shadowRadius: 10, shadowOpacity: 0.8 }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                      <Text style={styles.custItemEmoji}>{item.emoji}</Text>
                      <Text style={[styles.custItemLabel, item.active && styles.custItemLabelActive]}>{item.name}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </>
            );

            return (
              <View style={styles.custBody}>
                {/* Live preview */}
                <View style={styles.custPreview}>
                  <PixelAgent
                    agent={agent}
                    appearance={a}
                    environmentType={environmentType}
                    onPress={() => {}}
                    selected={false}
                    scale={1.6}
                  />
                </View>

                <ColorScroll label="SKIN" colors={SKIN_TONES} value={a.skinTone} onSelect={c => update({ skinTone: c })} />
                <ColorScroll label="HAIR COLOR" colors={HAIR_COLORS} value={a.hairColor} onSelect={c => update({ hairColor: c })} />
                <ItemScroll label="HAIR STYLE" items={['flat', 'spiky', 'mohawk', 'long', 'curly', 'ponytail', 'cap', 'bald', 'buzzcut', 'afro', 'undercut', 'pigtails'].map(h => {
                  const emojis: Record<string, string> = { flat: '➡️', spiky: '⬆️', mohawk: '🔱', long: '💇', curly: '🌀', ponytail: '🎀', cap: '🧢', bald: '🥚', buzzcut: '✂️', afro: '🟤', undercut: '💈', pigtails: '🎗️' };
                  return { key: h, emoji: emojis[h], name: h.toUpperCase(), active: a.hairStyle === h };
                })} />
                <ColorScroll label="EYES" colors={EYE_COLORS} value={a.eyeColor} onSelect={c => update({ eyeColor: c })} />
                <ColorScroll label="SHIRT" colors={SHIRT_COLORS} value={a.shirtColor} onSelect={c => update({ shirtColor: c })} />
                <ColorScroll label="PANTS" colors={PANTS_COLORS} value={a.pantsColor} onSelect={c => update({ pantsColor: c })} />
                <ColorScroll label="SHOES" colors={SHOE_COLORS} value={a.shoeColor} onSelect={c => update({ shoeColor: c })} />
                <ItemScroll label="EXPRESSION" items={['neutral', 'happy', 'focused', 'sleepy', 'cool', 'angry', 'surprised', 'smirk', 'crying'].map(e => {
                  const emojis: Record<string, string> = { neutral: '😐', happy: '😊', focused: '🤨', sleepy: '😴', cool: '😎', angry: '😠', surprised: '😲', smirk: '😏', crying: '😢' };
                  return { key: e, emoji: emojis[e], name: e.toUpperCase(), active: a.expression === e };
                })} />
                <ItemScroll label="HAT" items={['none', 'cap', 'tophat', 'beanie', 'crown', 'helmet', 'horns', 'space_helmet', 'wizard_hat', 'halo', 'antenna', 'crab_helmet', 'pirate_hat', 'cowboy_hat', 'fez', 'mohawk_spikes'].map(h => {
                  const emojis: Record<string, string> = { none: '🚫', cap: '🧢', tophat: '🎩', beanie: '🧶', crown: '👑', helmet: '⛑️', horns: '😈', space_helmet: '🚀', wizard_hat: '🧙', halo: '😇', antenna: '👽', crab_helmet: '🦀', pirate_hat: '🏴‍☠️', cowboy_hat: '🤠', fez: '🎖️', mohawk_spikes: '🔩' };
                  const names: Record<string, string> = { none: 'NONE', cap: 'CAP', tophat: 'TOP HAT', beanie: 'BEANIE', crown: 'CROWN', helmet: 'HELMET', horns: 'HORNS', space_helmet: 'SPACE', wizard_hat: 'WIZARD', halo: 'HALO', antenna: 'ANTENNA', crab_helmet: 'CRAB', pirate_hat: 'PIRATE', cowboy_hat: 'COWBOY', fez: 'FEZ', mohawk_spikes: 'SPIKES' };
                  return { key: h, emoji: emojis[h], name: names[h], active: a.hat === h };
                })} />
                <ItemScroll label="ACCESSORY" items={['none', 'glasses', 'headphones', 'bowtie', 'scarf', 'hoodie', 'mask', 'monocle', 'eyepatch', 'bandana', 'chain', 'piercing', 'visor_shades', 'gas_mask'].map(x => {
                  const emojis: Record<string, string> = { none: '🚫', glasses: '👓', headphones: '🎧', bowtie: '🎀', scarf: '🧣', hoodie: '🧥', mask: '😷', monocle: '🧐', eyepatch: '🏴‍☠️', bandana: '🥷', chain: '⛓️', piercing: '💎', visor_shades: '🕶️', gas_mask: '☣️' };
                  const names: Record<string, string> = { none: 'NONE', glasses: 'GLASSES', headphones: 'PHONES', bowtie: 'BOWTIE', scarf: 'SCARF', hoodie: 'HOODIE', mask: 'MASK', monocle: 'MONOCLE', eyepatch: 'PATCH', bandana: 'BANDANA', chain: 'CHAIN', piercing: 'PIERCE', visor_shades: 'VISOR', gas_mask: 'GAS MASK' };
                  return { key: x, emoji: emojis[x], name: names[x], active: a.accessory === x };
                })} />
                <ItemScroll label="FACIAL HAIR" items={['none', 'stubble', 'beard', 'mustache', 'goatee', 'fu_manchu', 'sideburns', 'soul_patch'].map(f => {
                  const emojis: Record<string, string> = { none: '🚫', stubble: '🔘', beard: '🧔', mustache: '👨', goatee: '🐐', fu_manchu: '🐉', sideburns: '🔲', soul_patch: '▪️' };
                  const names: Record<string, string> = { none: 'NONE', stubble: 'STUBBLE', beard: 'BEARD', mustache: 'STACHE', goatee: 'GOATEE', fu_manchu: 'FU MANCHU', sideburns: 'BURNS', soul_patch: 'PATCH' };
                  return { key: f, emoji: emojis[f], name: names[f], active: (a.facialHair || 'none') === f };
                })} />
                <ItemScroll label="BACK ITEM" items={['none', 'cape', 'backpack', 'wings', 'jetpack', 'shield', 'sword', 'quiver', 'crab_shell', 'tentacles', 'rocket', 'scroll', 'boombox'].map(b => {
                  const emojis: Record<string, string> = { none: '🚫', cape: '🦸', backpack: '🎒', wings: '🪽', jetpack: '🚀', shield: '🛡️', sword: '⚔️', quiver: '🏹', crab_shell: '🦀', tentacles: '🐙', rocket: '🚀', scroll: '📜', boombox: '📻' };
                  const names: Record<string, string> = { none: 'NONE', cape: 'CAPE', backpack: 'PACK', wings: 'WINGS', jetpack: 'JETPACK', shield: 'SHIELD', sword: 'SWORD', quiver: 'QUIVER', crab_shell: 'SHELL', tentacles: 'TENTACLES', rocket: 'ROCKET', scroll: 'SCROLL', boombox: 'BOOMBOX' };
                  return { key: b, emoji: emojis[b], name: names[b], active: (a.backItem || 'none') === b };
                })} />
                <ItemScroll label="PET" items={['none', 'cat', 'dog', 'bird', 'robot', 'dragon', 'alien', 'crab', 'snake', 'bat', 'skull', 'mushroom', 'spider', 'shark', 'bones'].map(p => {
                  const emojis: Record<string, string> = { none: '🚫', cat: '🐱', dog: '🐕', bird: '🐦', robot: '🤖', dragon: '🐉', alien: '👽', crab: '🦀', snake: '🐍', bat: '🦇', skull: '💀', mushroom: '🍄', spider: '🕷️', shark: '🦈', bones: '🦴' };
                  const names: Record<string, string> = { none: 'NONE', cat: 'CAT', dog: 'DOG', bird: 'BIRD', robot: 'ROBOT', dragon: 'DRAGON', alien: 'ALIEN', crab: 'CRAB', snake: 'SNAKE', bat: 'BAT', skull: 'SKULL', mushroom: 'SHROOM', spider: 'SPIDER', shark: 'SHARK', bones: 'BONES' };
                  return { key: p, emoji: emojis[p], name: names[p], active: (a.pet || 'none') === p };
                })} />
                <ItemScroll label="AURA" items={['none', 'fire', 'ice', 'electric', 'nature', 'shadow', 'rainbow', 'glitch', 'cosmic', 'toxic', 'holy', 'void', 'galaxy'].map(au => {
                  const emojis: Record<string, string> = { none: '🚫', fire: '🔥', ice: '🧊', electric: '⚡', nature: '🌿', shadow: '🌑', rainbow: '🌈', glitch: '📟', cosmic: '✨', toxic: '☢️', holy: '🕊️', void: '🕳️', galaxy: '🌌' };
                  const names: Record<string, string> = { none: 'NONE', fire: 'FIRE', ice: 'ICE', electric: 'BOLT', nature: 'LEAF', shadow: 'SHADOW', rainbow: 'RAINBOW', glitch: 'GLITCH', cosmic: 'COSMIC', toxic: 'TOXIC', holy: 'HOLY', void: 'VOID', galaxy: 'GALAXY' };
                  const glowColors: Record<string, string> = { fire: '#ef4444', ice: '#22d3ee', electric: '#f59e0b', nature: '#22c55e', shadow: '#6f6f6f', rainbow: '#a855f7', cosmic: '#6366f1', toxic: '#22c55e', holy: '#ffd700', galaxy: '#a855f7' };
                  return { key: au, emoji: emojis[au], name: names[au], active: (a.aura || 'none') === au, glow: glowColors[au] };
                })} />
                <ItemScroll label="HAND ITEM" items={['none', 'lightsaber', 'coffee', 'laptop', 'flag', 'wand', 'crab_claws', 'sword_hand', 'pizza', 'microphone', 'torch'].map(hi => {
                  const emojis: Record<string, string> = { none: '🚫', lightsaber: '⚔️', coffee: '☕', laptop: '💻', flag: '🚩', wand: '🪄', crab_claws: '🦞', sword_hand: '🗡️', pizza: '🍕', microphone: '🎤', torch: '🔦' };
                  const names: Record<string, string> = { none: 'NONE', lightsaber: 'SABER', coffee: 'COFFEE', laptop: 'LAPTOP', flag: 'FLAG', wand: 'WAND', crab_claws: 'CLAWS', sword_hand: 'SWORD', pizza: 'PIZZA', microphone: 'MIC', torch: 'TORCH' };
                  return { key: hi, emoji: emojis[hi], name: names[hi], active: (a.handItem || 'none') === hi };
                })} />
              </View>
            );
          })()}
        </View>
      )}

      {/* ── Next Tab Footer ── */}
      {(() => {
        const allTabs = [
          { key: 'overview', label: 'Overview' },
          ...(agent.providerType === 'openclaw' ? [{ key: 'openclaw', label: 'KingClaw' }] : []),
          { key: 'terminal', label: 'Terminal' },
          { key: 'memory', label: 'Memory' },
          { key: 'runs', label: 'Runs' },
          { key: 'evolution', label: 'Evolution' },
          { key: 'spirit', label: 'Spirit' },
          { key: 'activity', label: 'Activity' },
          { key: 'customize', label: 'Customize' },
        ];
        const currentIdx = allTabs.findIndex(t => t.key === panelTab);
        const prevTab = currentIdx > 0 ? allTabs[currentIdx - 1] : null;
        const nextTab = currentIdx < allTabs.length - 1 ? allTabs[currentIdx + 1] : null;

        return (
          <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: 8, paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#1a1a28' }}>
            {prevTab && (
              <Pressable
                onPress={() => setPanelTab(prevTab.key as any)}
                style={[{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 8, backgroundColor: '#0a0a10', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 2 }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
              >
                <Text style={{ color: '#606075', fontSize: 10, fontFamily: MONO }}>{'<'}</Text>
                <Text style={{ color: '#a0a0b0', fontSize: 10, fontWeight: '600', fontFamily: MONO }}>{prevTab.label}</Text>
              </Pressable>
            )}
            {nextTab && (
              <Pressable
                onPress={() => setPanelTab(nextTab.key as any)}
                style={[{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 8, backgroundColor: (agent.color || '#6366f1') + '12', borderWidth: 1, borderColor: (agent.color || '#6366f1') + '30', borderRadius: 2 }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
              >
                <Text style={{ color: agent.color || '#6366f1', fontSize: 10, fontWeight: '600', fontFamily: MONO }}>{nextTab.label}</Text>
                <Text style={{ color: agent.color || '#6366f1', fontSize: 10, fontFamily: MONO }}>{'>'}</Text>
              </Pressable>
            )}
          </View>
        );
      })()}

      </ScrollView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#0a0a0a',
    borderTopWidth: 1,
    borderTopColor: '#1e1e3a',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 20,
    paddingBottom: 24,
    maxHeight: '70%' as any,
  },
  panelDesktop: {
    top: 0,
    bottom: 0,
    left: 'auto' as any,
    right: 0,
    width: 540,
    maxHeight: '100%' as any,
    borderRadius: 0,
    borderTopLeftRadius: 12,
    borderBottomLeftRadius: 12,
    borderTopRightRadius: 0,
    borderTopWidth: 0,
    borderLeftWidth: 1,
    borderLeftColor: '#1e1e3a',
    ...(Platform.OS === 'web' ? {
      boxShadow: '-8px 0 30px rgba(0,0,0,0.5)',
    } as any : {}),
  },
  desktopHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#1e1e3a',
    marginBottom: 8,
  },
  desktopHeaderTitle: {
    color: '#555',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 2,
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },
  desktopCloseBtn: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: '#ffffff08',
    borderWidth: 1,
    borderColor: '#ffffff10',
    alignItems: 'center',
    justifyContent: 'center',
  },
  desktopCloseBtnText: {
    color: '#666',
    fontSize: 14,
    fontWeight: '600',
  },
  handleArea: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: '#333',
    borderRadius: 2,
  },
  scrollContent: {
    flex: 1,
  },
  sectionDivider: {
    height: 1,
    backgroundColor: '#1e1e3a',
    marginVertical: 12,
    marginHorizontal: -4,
  },
  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 20,
    fontWeight: '900',
    fontFamily: 'monospace',
  },
  name: {
    fontSize: 18,
    fontWeight: '800',
    color: '#fff',
    fontFamily: 'monospace',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  renameHint: {
    fontSize: 10,
    opacity: 0.4,
  },
  renameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  renameInput: {
    flex: 1,
    backgroundColor: '#000000',
    borderWidth: 1,
    borderColor: '#6366f1',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    color: '#eee',
    fontFamily: 'monospace',
    fontSize: 14,
    fontWeight: '800',
  },
  renameSaveBtn: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: '#22c55e15',
    borderWidth: 1,
    borderColor: '#22c55e30',
    alignItems: 'center',
    justifyContent: 'center',
  },
  renameSaveText: {
    color: '#22c55e',
    fontSize: 14,
    fontWeight: '800',
  },
  renameCancelBtn: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: '#ef444420',
    borderWidth: 1,
    borderColor: '#ef444440',
    alignItems: 'center',
    justifyContent: 'center',
  },
  renameCancelText: {
    color: '#ef4444',
    fontSize: 12,
    fontWeight: '800',
  },
  roleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  role: {
    fontSize: 13,
    color: '#888',
    fontFamily: 'monospace',
  },
  modelBadge: {
    backgroundColor: '#ffffff08',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#ffffff10',
  },
  modelText: {
    fontSize: 10,
    color: '#777',
    fontFamily: 'monospace',
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
  },
  statusDotSmall: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 0.5,
  },
  // Connection source
  connectionRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginBottom: 10, paddingHorizontal: 4,
  },
  connectionIcon: { fontSize: 16 },
  connectionName: { fontSize: 13, fontWeight: '700', fontFamily: 'monospace' },
  connectionType: { fontSize: 11, color: '#666', fontFamily: 'monospace' },
  // Activity bar
  activityBar: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: '#111',
    padding: 14,
    borderRadius: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#1e1e3a',
  },
  activityLabel: {
    fontSize: 12,
    color: '#666',
    fontFamily: 'monospace',
    fontWeight: '800',
  },
  activityValue: {
    fontSize: 13,
    color: '#ccc',
    fontFamily: 'monospace',
    flex: 1,
  },
  // Cost/perf grid
  gridRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  gridCard: {
    backgroundColor: '#0a0a0a',
    borderWidth: 1,
    borderColor: '#1e1e3a',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
    minWidth: '30%' as any,
    flex: 1,
  },
  gridValue: {
    fontSize: 17,
    fontWeight: '900',
    color: '#fff',
    fontFamily: 'monospace',
  },
  gridLabel: {
    fontSize: 10,
    color: '#666',
    fontFamily: 'monospace',
    marginTop: 3,
    letterSpacing: 0.3,
  },
  // Session key
  sessionKeyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  sessionKeyLabel: {
    fontSize: 9,
    color: '#444',
    fontFamily: 'monospace',
    fontWeight: '800',
    letterSpacing: 1,
  },
  sessionKeyValue: {
    fontSize: 9,
    color: '#555',
    fontFamily: 'monospace',
    flex: 1,
  },
  // Activity log
  actionsSection: {
    gap: 5,
    marginBottom: 8,
  },
  actionsTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#888',
    fontFamily: 'monospace',
    letterSpacing: 2,
    marginBottom: 6,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 6,
  },
  actionTime: {
    fontSize: 10,
    color: '#444',
    fontFamily: 'monospace',
    width: 56,
    textAlign: 'right',
    paddingTop: 2,
  },
  actionDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    marginTop: 4,
  },
  actionRole: {
    fontSize: 7,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 1,
    marginBottom: 1,
  },
  actionText: {
    fontSize: 12,
    color: '#888',
    fontFamily: 'monospace',
    flex: 1,
    lineHeight: 18,
  },
  noActivity: {
    fontSize: 10,
    color: '#333',
    fontFamily: 'monospace',
    fontStyle: 'italic',
    paddingLeft: 12,
  },
  // Tags section
  tagsSection: {
    gap: 8,
    marginVertical: 16,
    paddingVertical: 14,
  },
  tagsSectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#888',
    fontFamily: 'monospace',
    letterSpacing: 2,
  },
  // Customize section
  customizeSection: {
    marginTop: 16,
    paddingTop: 12,
  },
  customizeToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  customizeToggleText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#aaa',
    fontFamily: 'monospace',
    letterSpacing: 1.5,
  },
  custBody: {
    gap: 4,
    paddingTop: 8,
  },
  custPreview: {
    alignItems: 'center',
    paddingVertical: 8,
    backgroundColor: '#0a0a0a',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    marginBottom: 4,
  },
  custSectionTitle: {
    fontSize: 12,
    fontWeight: '900',
    color: '#888',
    fontFamily: 'monospace',
    letterSpacing: 2,
    marginTop: 10,
    marginBottom: 6,
  },
  custScroll: {
    marginBottom: 4,
  },
  custItemSwatch: {
    width: 40,
    height: 40,
    borderRadius: 10,
    borderWidth: 2.5,
    borderColor: 'transparent',
    marginRight: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  custItemSwatchActive: {
    borderColor: '#fff',
    ...(Platform.OS === 'web' ? { boxShadow: '0 0 8px rgba(255,255,255,0.4)' } as any : {}),
  },
  custItemCheck: {
    fontSize: 14,
    color: '#fff',
    fontWeight: '900',
    textShadowColor: '#000',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  custItemCard: {
    width: 70,
    height: 70,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#1e1e3a',
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
    gap: 2,
  },
  custItemCardActive: {
    borderColor: '#6366f1',
    backgroundColor: '#6366f120',
    ...(Platform.OS === 'web' ? { boxShadow: '0 0 10px rgba(99,102,241,0.3)' } as any : {}),
  },
  custItemEmoji: {
    fontSize: 24,
  },
  custItemLabel: {
    fontSize: 9,
    color: '#666',
    fontFamily: 'monospace',
    fontWeight: '700',
    textAlign: 'center',
  },
  custItemLabelActive: {
    color: '#ddd',
  },
  // Spirit styles
  spiritRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 4, paddingVertical: 10,
  },
  spiritLabel: {
    color: '#aaa', fontSize: 13, fontWeight: '800', fontFamily: 'monospace', letterSpacing: 1.5,
  },
  spiritBadge: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8,
    borderWidth: 1, borderColor: '#6366f140', backgroundColor: '#6366f115',
  },
  spiritBadgeText: {
    color: '#6366f1', fontSize: 11, fontWeight: '700', fontFamily: 'monospace',
  },
  spiritNone: {
    color: '#555', fontSize: 11, fontFamily: 'monospace',
  },
  spiritPicker: {
    padding: 12, gap: 10,
  },
  spiritHint: {
    color: '#666', fontSize: 12, fontFamily: 'monospace', lineHeight: 18,
  },
  spiritDetail: {
    backgroundColor: '#08081a',
    borderWidth: 1,
    borderColor: '#1e1e3a',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  spiritDetailName: {
    color: '#fff', fontSize: 15, fontWeight: '800', fontFamily: 'monospace',
  },
  spiritDetailTagline: {
    color: '#888', fontSize: 11, fontFamily: 'monospace', marginTop: 2,
  },
  spiritKnobsGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
  },
  spiritKnob: {
    width: '30%' as any, backgroundColor: '#0a0a1a', borderRadius: 8,
    borderWidth: 1, borderColor: '#1e1e3a', padding: 8, alignItems: 'center',
  },
  spiritKnobLabel: {
    color: '#555', fontSize: 8, fontWeight: '800', fontFamily: 'monospace',
    letterSpacing: 1, marginBottom: 4,
  },
  spiritKnobValue: {
    fontSize: 11, fontWeight: '800', fontFamily: 'monospace', textAlign: 'center',
  },
  spiritEscalation: {
    marginTop: 10, backgroundColor: '#0a0a1a', borderRadius: 8,
    borderWidth: 1, borderColor: '#1e1e3a', padding: 10,
  },
  spiritEscalationText: {
    color: '#ccc', fontSize: 12, fontFamily: 'monospace', marginTop: 4, lineHeight: 18,
  },
  spiritClearBtn: {
    paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8,
    backgroundColor: '#ef444415', borderWidth: 1, borderColor: '#ef444430',
  },
  spiritClearText: {
    color: '#ef4444', fontSize: 11, fontWeight: '700', fontFamily: 'monospace',
  },
  spiritCatLabel: {
    fontSize: 12, fontWeight: '800', fontFamily: 'monospace', letterSpacing: 1.5,
    marginBottom: 6, marginTop: 8,
  },
  spiritGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 6,
  },
  spiritCard: {
    width: '48%', padding: 12, borderRadius: 10,
    borderWidth: 1, borderColor: '#1e1e3a', backgroundColor: '#0a0a0a',
    alignItems: 'center',
  },
  spiritEmoji: { fontSize: 28, marginBottom: 4 },
  spiritName: {
    color: '#6366f1', fontSize: 12, fontWeight: '800', fontFamily: 'monospace', textAlign: 'center',
  },
  spiritTagline: {
    color: '#666', fontSize: 10, fontFamily: 'monospace', lineHeight: 15, marginTop: 2, textAlign: 'center',
  },

  // Inline soul section (inside spirit picker)
  soulInlineSection: {
    marginTop: 16, paddingTop: 14,
  },
  scrollArrow: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#ffffff08',
    borderWidth: 1,
    borderColor: '#ffffff15',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollArrowText: {
    color: '#aaa',
    fontSize: 20,
    fontWeight: '600',
    marginTop: -1,
  },
  personalityChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12,
    borderWidth: 1, borderColor: '#1e1e3a', backgroundColor: '#000000',
    marginRight: 8,
  },
  personalityChipText: {
    fontSize: 13, color: '#ccc', fontFamily: 'monospace', fontWeight: '600',
  },

  // Soul / personality styles
  soulActiveBadge: {
    paddingHorizontal: 10, paddingVertical: 3, borderRadius: 8,
    borderWidth: 1, borderColor: '#6366f140', backgroundColor: '#6366f115',
    marginLeft: 8,
  },
  soulActiveBadgeText: {
    fontSize: 10, color: '#aaa', fontFamily: 'monospace', fontWeight: '700',
  },
  soulBody: {
    gap: 10, paddingTop: 10,
  },
  soulHint: {
    fontSize: 12, color: '#777', fontFamily: 'monospace', fontStyle: 'italic', lineHeight: 18,
  },
  soulCategoryRow: {
    flexDirection: 'row', gap: 6,
  },
  soulCategoryTab: {
    flex: 1, paddingVertical: 8, paddingHorizontal: 6, borderRadius: 8,
    borderWidth: 1, borderColor: '#1e1e3a', backgroundColor: '#000000',
    alignItems: 'center',
  },
  soulCategoryText: {
    fontSize: 11, color: '#666', fontFamily: 'monospace', fontWeight: '700',
  },
  soulCard: {
    backgroundColor: '#000000', borderWidth: 1, borderColor: '#1e1e3a',
    borderRadius: 10, padding: 12, gap: 4, marginBottom: 6,
  },
  soulCardHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  soulCardName: {
    fontSize: 13, fontWeight: '800', color: '#bbb', fontFamily: 'monospace', flex: 1,
  },
  soulCardDesc: {
    fontSize: 11, color: '#666', fontFamily: 'monospace', lineHeight: 16,
  },
  soulInput: {
    backgroundColor: '#000000', borderWidth: 1, borderColor: '#1e1e3a',
    borderRadius: 10, padding: 12, color: '#ddd', fontFamily: 'monospace',
    fontSize: 13, minHeight: 100, textAlignVertical: 'top',
  },
  soulActions: {
    flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 4,
  },
  soulSaveBtn: {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8,
    backgroundColor: '#6366f120', borderWidth: 1, borderColor: '#6366f140',
  },
  soulSaveBtnText: {
    fontSize: 12, color: '#6366f1', fontFamily: 'monospace', fontWeight: '800', letterSpacing: 0.8,
  },
  soulClearBtn: {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8,
    backgroundColor: '#ef444420', borderWidth: 1, borderColor: '#ef444440',
  },
  soulClearBtnText: {
    fontSize: 12, color: '#ef4444', fontFamily: 'monospace', fontWeight: '800',
  },
});
