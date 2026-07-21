/**
 * TaskDetailModal — task detail/edit modal with comments + peer review workflow
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, StyleSheet,
  Platform, KeyboardAvoidingView, Image, ActivityIndicator,
} from 'react-native';
import {
  KanbanTask, TaskComment, TaskAttachment, TaskStatus, TaskPriority, TaskRun, TaskCompletionPolicy,
  COLUMNS, PRIORITY_COLORS, PRIORITY_LABELS, DEFAULT_AGENT_ROSTER,
} from '../../../../types/kanban';
import type { KanbanData, KanbanMember, ThinkingLevel, AgentModel, AgentMode } from '../../../../hooks/useKanbanData';
import type { GoalWithCount } from '../../../../hooks/useGoals';
import type { CircleOfficeAgent } from '../../../../lib/circleOffice';
import { supabase } from '../../../../lib/supabase';
import MentionPicker, { detectMentionQuery, insertMention } from '../../../../components/MentionPicker';
import MentionText from '../../../../components/MentionText';
import { extractMentionRefs, persistMentions } from '../../../../lib/mentions';
import { dispatchBridgeTask } from '../../../../lib/bridgeTaskDispatcher';
import SpawnAgentPanel from '../../../../components/SpawnAgentPanel';
import RunMetadataSummary from '../../../../components/chat/RunMetadataSummary';
import FocusChainPanel from './FocusChainPanel';
import TaskRunTimeline from './TaskRunTimeline';
import TaskArtifactsPanel from './TaskArtifactsPanel';
import TaskChecksPanel from './TaskChecksPanel';
import TaskApprovalsPanel from './TaskApprovalsPanel';
import TaskNextActionPanel from './TaskNextActionPanel';
import { useProjectRooms } from '../../../../services/projectRooms';
import { listCircleIntegrations } from '../../../../lib/circleIntegrations';
import { getInstalledProviderSet, recommendMarketplaceItemsForWork } from '../../../../lib/marketplaceRecommendations';
import type { CircleIntegrationGroupKey } from '../../../../lib/circleIntegrationCatalog';
import {
  buildRunMetadataSummaryProps,
  fetchTaskRunMetadataByOpenSwanRunId,
} from '../../../../lib/taskRunMetadata';

// ─── Automation Report Section Parser ────────────────────────────────────────

interface ReportSection {
  heading: string;
  content: string;
  type: 'summary' | 'context' | 'members' | 'checkins' | 'tasks' | 'ai' | 'log' | 'prompt' | 'other';
}

function parseReportSections(description: string): ReportSection[] {
  const sections: ReportSection[] = [];
  const lines = description.split('\n');
  let currentHeading = '';
  let currentLines: string[] = [];
  let currentType: ReportSection['type'] = 'summary';

  const typeMap: Record<string, ReportSection['type']> = {
    'AUTOMATION REPORT': 'summary',
    'AUTOMATION FAILED': 'summary',
    'CONTEXT ANALYZED': 'context',
    'MEMBERS REVIEWED': 'members',
    'NOT CHECKED IN TODAY': 'checkins',
    "TODAY'S CHECK-INS": 'checkins',
    'OPEN TASKS REVIEWED': 'tasks',
    'COMPLETED THIS WEEK': 'tasks',
    'AI RESPONSE': 'ai',
    'EXECUTION LOG': 'log',
    'PROMPT SENT TO AI': 'prompt',
  };

  const flush = () => {
    if (currentHeading || currentLines.length > 0) {
      sections.push({
        heading: currentHeading,
        content: currentLines.join('\n').trim(),
        type: currentType,
      });
    }
  };

  for (const line of lines) {
    // Detect section headers (lines followed by === or --- separators, or all-caps lines)
    const isSeparator = /^[=-]{10,}$/.test(line.trim());
    if (isSeparator) continue;

    // Check if this line is a section heading
    const matchedType = Object.entries(typeMap).find(([key]) => line.trim().startsWith(key));
    if (matchedType && line.trim() === line.trim().toUpperCase()) {
      flush();
      currentHeading = line.trim();
      currentLines = [];
      currentType = matchedType[1];
      continue;
    }

    currentLines.push(line);
  }
  flush();
  return sections;
}

function AutomationReportView({ description }: { description: string }) {
  const sections = parseReportSections(description);
  const [expandedSections, setExpandedSections] = React.useState<Set<number>>(new Set([0, 5])); // Summary + AI expanded

  const toggleSection = (idx: number) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const sectionIcons: Record<ReportSection['type'], string> = {
    summary: '\u{1F4CB}',
    context: '\u{1F50D}',
    members: '\u{1F465}',
    checkins: '\u2705',
    tasks: '\u{1F4DD}',
    ai: '\u{1F9E0}',
    log: '\u23F1\uFE0F',
    prompt: '\u{1F4E4}',
    other: '\u{1F4C4}',
  };

  const sectionColors: Record<ReportSection['type'], string> = {
    summary: '#6366f1',
    context: '#3b82f6',
    members: '#a855f7',
    checkins: '#22c55e',
    tasks: '#f59e0b',
    ai: '#22d3ee',
    log: '#6f6f6f',
    prompt: '#6f6f6f',
    other: '#6f6f6f',
  };

  if (sections.length === 0) {
    return <Text style={rs.emptyText}>{description || 'No description'}</Text>;
  }

  return (
    <View style={rs.container}>
      {sections.map((section, idx) => {
        const expanded = expandedSections.has(idx);
        const color = sectionColors[section.type] || '#6f6f6f';
        const icon = sectionIcons[section.type] || '\u{1F4C4}';
        const lineCount = section.content.split('\n').length;

        return (
          <View key={idx} style={[rs.section, { borderLeftColor: color }]}>
            <Pressable onPress={() => toggleSection(idx)} style={rs.sectionHeader}>
              <View style={rs.sectionHeaderLeft}>
                <Text style={rs.sectionIcon}>{icon}</Text>
                <Text style={[rs.sectionTitle, { color }]}>{section.heading || 'Details'}</Text>
                {lineCount > 1 && (
                  <View style={[rs.lineBadge, { backgroundColor: color + '15' }]}>
                    <Text style={[rs.lineBadgeText, { color }]}>{lineCount} lines</Text>
                  </View>
                )}
              </View>
              <Text style={[rs.expandArrow, { color }]}>{expanded ? '\u25BC' : '\u25B6'}</Text>
            </Pressable>
            {expanded && (
              <View style={rs.sectionBody}>
                {section.type === 'ai' ? (
                  <View style={rs.aiOutputBox}>
                    <Text style={rs.aiOutputText} selectable>{section.content}</Text>
                  </View>
                ) : section.type === 'log' ? (
                  <View style={rs.logBox}>
                    {section.content.split('\n').filter(Boolean).map((line, i) => {
                      const isSuccess = line.includes('\u2713') || line.includes('\u2705');
                      const isError = line.includes('\u274C');
                      const isPending = line.includes('\u23F3') || line.includes('\u231B');
                      const lineColor = isError ? '#ef4444' : isSuccess ? '#22c55e' : isPending ? '#f59e0b' : '#9e9e9e';
                      return (
                        <Text key={i} style={[rs.logLine, { color: lineColor }]} selectable>{line.trim()}</Text>
                      );
                    })}
                  </View>
                ) : section.type === 'summary' ? (
                  <View style={rs.summaryBox}>
                    {section.content.split('\n').filter(Boolean).map((line, i) => {
                      const [label, ...rest] = line.split(':');
                      const value = rest.join(':').trim();
                      if (!value) return <Text key={i} style={rs.summaryLine} selectable>{line}</Text>;
                      return (
                        <View key={i} style={rs.summaryRow}>
                          <Text style={rs.summaryLabel}>{label}:</Text>
                          <Text style={[
                            rs.summaryValue,
                            line.startsWith('Status: FAILED') && { color: '#ef4444' },
                            line.startsWith('Status: COMPLETED') && { color: '#22c55e' },
                            line.startsWith('Status: SKIPPED') && { color: '#f59e0b' },
                          ]} selectable>{value}</Text>
                        </View>
                      );
                    })}
                  </View>
                ) : (
                  <Text style={rs.sectionContent} selectable>{section.content}</Text>
                )}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

const rs = StyleSheet.create({
  container: {
    gap: 4,
  },
  emptyText: {
    color: '#3e3e3e',
    fontSize: 14,
    fontStyle: 'italic',
  },
  section: {
    borderLeftWidth: 3,
    borderLeftColor: '#e8e8e8',
    borderRadius: 8,
    backgroundColor: '#0a0a0a',
    overflow: 'hidden',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    ...(Platform.OS === 'web' ? { cursor: 'pointer', userSelect: 'none' } as any : {}),
  },
  sectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  sectionIcon: {
    fontSize: 14,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  lineBadge: {
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  lineBadgeText: {
    fontSize: 9,
    fontWeight: '600',
  },
  expandArrow: {
    fontSize: 10,
  },
  sectionBody: {
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  sectionContent: {
    color: '#9e9e9e',
    fontSize: 12,
    lineHeight: 18,
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },
  // AI output
  aiOutputBox: {
    backgroundColor: '#0a0a0a',
    borderWidth: 1,
    borderColor: '#22d3ee20',
    borderRadius: 8,
    padding: 12,
  },
  aiOutputText: {
    color: '#e8e8e8',
    fontSize: 13,
    lineHeight: 20,
  },
  // Log
  logBox: {
    backgroundColor: '#0a0a0a',
    borderRadius: 8,
    padding: 10,
    gap: 3,
  },
  logLine: {
    fontSize: 11,
    lineHeight: 18,
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },
  // Summary
  summaryBox: {
    gap: 4,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 6,
  },
  summaryLabel: {
    color: '#6f6f6f',
    fontSize: 12,
    fontWeight: '600',
    minWidth: 90,
  },
  summaryValue: {
    color: '#b5b5b5',
    fontSize: 12,
    flex: 1,
  },
  summaryLine: {
    color: '#9e9e9e',
    fontSize: 12,
  },
});

// ─── Main Component ─────────────────────────────────────────────────────────

interface Props {
  task: KanbanTask;
  kanban: KanbanData;
  agents: CircleOfficeAgent[];
  goals?: GoalWithCount[];
  circleId: string;
  onOpenMarketplace?: (focus?: { itemId?: string | null; groupKey?: CircleIntegrationGroupKey | null }) => void;
  onClose: () => void;
}

const AGENT_ASSIGNMENT_STATUS_ORDER: Record<CircleOfficeAgent['status'], number> = {
  active: 0,
  building: 1,
  idle: 2,
  offline: 3,
  error: 4,
};

function sortAgentsForAssignment(agents: CircleOfficeAgent[]): CircleOfficeAgent[] {
  return [...agents].sort((a, b) => {
    const statusDiff =
      (AGENT_ASSIGNMENT_STATUS_ORDER[a.status] ?? 9) - (AGENT_ASSIGNMENT_STATUS_ORDER[b.status] ?? 9);
    if (statusDiff !== 0) return statusDiff;
    return a.name.localeCompare(b.name);
  });
}

export default function TaskDetailModal({ task: initialTask, kanban, agents, goals, circleId, onOpenMarketplace, onClose }: Props) {
  const task = kanban.tasks.find(t => t.id === initialTask.id) || initialTask;

  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description || '');
  // Mention picker state for the description editor. Matches the pattern
  // used in CheckInScreen and ChatTab so @ triggers are consistent.
  const [descriptionMentionQuery, setDescriptionMentionQuery] = useState<string | null>(null);
  const [descriptionCursorPos, setDescriptionCursorPos] = useState(0);
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [assignedTo, setAssignedTo] = useState<string | null>(task.assigned_to);
  const [assignedAgentIds, setAssignedAgentIds] = useState<string[]>(task.assigned_agent_ids || (task.assigned_agent_id ? [task.assigned_agent_id] : []));
  const [completionPolicy, setCompletionPolicy] = useState<TaskCompletionPolicy>(task.completion_policy || ((task.assigned_agent_ids || (task.assigned_agent_id ? [task.assigned_agent_id] : [])).length > 1 ? 'any_assigned' : 'single_owner'));
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(task.room_id || null);
  const [assignmentMode, setAssignmentMode] = useState<'manual' | 'room_team'>('manual');
  const [dueDate, setDueDate] = useState(task.due_date || '');

  const [comments, setComments] = useState<TaskComment[]>([]);
  const [taskRuns, setTaskRuns] = useState<TaskRun[]>(task.recent_runs || []);
  const [taskRunMetadataByRunId, setTaskRunMetadataByRunId] = useState<Record<string, Record<string, any>>>({});
  const [commentText, setCommentText] = useState('');
  const [showDelete, setShowDelete] = useState(false);
  const [showAssignees, setShowAssignees] = useState(false);
  const commentsRef = useRef<ScrollView>(null);

  // Image upload state
  const [uploading, setUploading] = useState(false);
  const [imageExpanded, setImageExpanded] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Agent run state
  const [agentRunning, setAgentRunning] = useState(false);
  const [agentResult, setAgentResult] = useState<string | null>(null);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string>('blackswan-default');
  const [showAgentPicker, setShowAgentPicker] = useState(false);
  const [showSpawnAgent, setShowSpawnAgent] = useState(false);
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>('balanced');
  const [agentModel, setAgentModel] = useState<AgentModel>('auto');
  const [agentMode, setAgentMode] = useState<AgentMode>('execute');
  const [commentAttachments, setCommentAttachments] = useState<TaskAttachment[]>([]);
  const [commentUploading, setCommentUploading] = useState(false);
  const [installedProviders, setInstalledProviders] = useState<Set<string>>(new Set());
  const commentFileRef = useRef<HTMLInputElement | null>(null);

  // Cleanup file inputs on unmount
  useEffect(() => {
    return () => {
      if (fileInputRef.current) {
        try { document.body.removeChild(fileInputRef.current); } catch {}
        fileInputRef.current = null;
      }
      if (commentFileRef.current) {
        try { document.body.removeChild(commentFileRef.current); } catch {}
        commentFileRef.current = null;
      }
    };
  }, []);

  // Sync edited fields when task updates
  useEffect(() => {
    if (!editing) {
      setTitle(task.title);
      setDescription(task.description || '');
      setPriority(task.priority);
      setAssignedTo(task.assigned_to);
      setAssignedAgentIds(task.assigned_agent_ids || (task.assigned_agent_id ? [task.assigned_agent_id] : []));
      setCompletionPolicy(task.completion_policy || ((task.assigned_agent_ids || (task.assigned_agent_id ? [task.assigned_agent_id] : [])).length > 1 ? 'any_assigned' : 'single_owner'));
      setSelectedRoomId(task.room_id || null);
      setAssignmentMode('manual');
      setDueDate(task.due_date || '');
    }
    setSelectedAgentId(task.assigned_agent_ids?.[0] || task.assigned_agent_id || 'blackswan-default');
    setTaskRuns(task.recent_runs || []);
  }, [task, editing]);

  const loadComments = useCallback(async () => {
    const c = await kanban.fetchComments(task.id);
    setComments(c);
  }, [task.id, kanban.fetchComments]);

  const loadTaskRuns = useCallback(async () => {
    if (!kanban.fetchTaskRuns) return;
    const runs = await kanban.fetchTaskRuns(task.id);
    setTaskRuns(runs);
  }, [task.id, kanban.fetchTaskRuns]);

  useEffect(() => { loadComments(); }, [loadComments]);
  useEffect(() => { loadTaskRuns(); }, [loadTaskRuns]);
  useEffect(() => {
    let cancelled = false;
    const openSwanRunIds = taskRuns
      .map((run) => run.openswan_run_id)
      .filter((value): value is string => typeof value === 'string' && value.length > 0);
    if (openSwanRunIds.length === 0) {
      setTaskRunMetadataByRunId({});
      return;
    }
    (async () => {
      const nextMetadata = await fetchTaskRunMetadataByOpenSwanRunId(openSwanRunIds);
      if (cancelled) return;
      setTaskRunMetadataByRunId(nextMetadata);
    })();
    return () => { cancelled = true; };
  }, [taskRuns]);

  const availableAgents = useMemo(
    () => sortAgentsForAssignment(agents.length > 0 ? agents : kanban.agents),
    [agents, kanban.agents],
  );
  const { rooms } = useProjectRooms(circleId);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const integrations = await listCircleIntegrations(circleId);
      if (!cancelled) {
        setInstalledProviders(getInstalledProviderSet(integrations.map(item => item.provider)));
      }
    })();
    return () => { cancelled = true; };
  }, [circleId]);

  // Realtime comments
  useEffect(() => {
    const channel = supabase
      .channel(`task-comments-${task.id}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'task_comments',
        filter: `task_id=eq.${task.id}`,
      }, () => loadComments())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [task.id, loadComments]);

  const handleSave = async () => {
    const baseFields: any = {
      title: title.trim(),
      description: description.trim() || null,
      priority,
      room_id: selectedRoomId || null,
      completion_policy: completionPolicy,
      due_date: dueDate || null,
    };
    if (assignmentMode === 'room_team' && selectedRoomId) {
      baseFields.assigned_to = null;
      baseFields.inherit_room_agents = true;
    } else {
      baseFields.assigned_to = assignedTo;
      baseFields.assigned_agent_id = assignedAgentIds[0] || null;
      baseFields.assigned_agent_ids = assignedAgentIds;
    }
    await kanban.updateTask(task.id, baseFields as any);

    // Persist any @mentions in the description so the target's backlinks
    // panel picks up this task as a reference. Sent as source_type
    // 'mission_task' (the mentions CHECK allows it) using the task id.
    const refs = extractMentionRefs(description);
    if (refs.length > 0) {
      const { data: { user } } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
      if (user?.id) {
        persistMentions({
          circleId,
          sourceType: 'mission_task',
          sourceId: task.id,
          authorId: user.id,
          refs,
        }).catch(() => {});
      }
    }
    setEditing(false);
  };

  const handleAddComment = async () => {
    if (!commentText.trim() && commentAttachments.length === 0) return;
    await kanban.addComment(task.id, commentText, commentAttachments.length > 0 ? commentAttachments : undefined);
    setCommentText('');
    setCommentAttachments([]);
  };

  const handleCommentFileUpload = useCallback(async (file: File) => {
    setCommentUploading(true);
    try {
      const attachment = await kanban.uploadTaskFile(task.id, file);
      if (attachment) {
        setCommentAttachments(prev => [...prev, attachment]);
      }
    } finally {
      setCommentUploading(false);
    }
  }, [task.id, kanban]);

  const handleDelete = async () => {
    await kanban.deleteTask(task.id);
    onClose();
  };

  // ─── Peer Review Actions ───────────────────────────────────────────────
  const handleApprove = async () => {
    if (kanban.approveTask && kanban.currentUserId) {
      await kanban.approveTask(task.id, kanban.currentUserId);
      await kanban.addComment(task.id, '[APPROVED] \u2705 Approved this task');
    }
  };

  const handleRequestChanges = async () => {
    if (kanban.requestChanges) {
      await kanban.requestChanges(task.id);
      await kanban.addComment(task.id, '[CHANGES_REQUESTED] \u{1F504} Requested changes on this task');
    }
  };

  const handleFinalApprove = async () => {
    await kanban.moveTask(task.id, 'approved');
    await kanban.addComment(task.id, '[FINAL_APPROVED] \u2705 Final review approved \u2014 moving to APPROVED');
  };

  const handleSendBack = async () => {
    await kanban.moveTask(task.id, 'peer_review');
    await kanban.addComment(task.id, '[SENT_BACK] \u{1F504} Sent back to peer review');
  };

  // ─── Image Upload ────────────────────────────────────────────────────
  const handleImageUpload = useCallback(async (file: File) => {
    if (!file || !kanban.currentUserId) return;
    setUploading(true);
    try {
      const ext = file.name.split('.').pop() || 'png';
      const path = `${task.id}/${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('task-images')
        .upload(path, file, { cacheControl: '3600', upsert: false });

      if (uploadError) {
        console.error('Image upload error:', uploadError);
        return;
      }

      const { data: urlData } = supabase.storage
        .from('task-images')
        .getPublicUrl(path);

      if (urlData?.publicUrl) {
        await kanban.updateTask(task.id, { image_url: urlData.publicUrl } as any);
      }
    } catch (err) {
      console.error('Image upload unexpected:', err);
    } finally {
      setUploading(false);
    }
  }, [task.id, kanban]);

  const handleRemoveImage = useCallback(async () => {
    await kanban.updateTask(task.id, { image_url: null } as any);
  }, [task.id, kanban]);

  // ─── Run Agent ──────────────────────────────────────────────────────
  const handleRunAgent = useCallback(async () => {
    setAgentRunning(true);
    setAgentResult(null);
    setAgentError(null);
    try {
      const result = await kanban.runAgentOnTask(task.id, selectedAgentId, {
        thinkingLevel,
        model: agentModel,
        mode: agentMode,
      });
      if (result) {
        setAgentResult(result);
        await loadTaskRuns();
      } else {
        setAgentError('Agent returned no response');
      }
    } catch (err) {
      setAgentError('Agent failed to run');
      console.error('handleRunAgent error:', err);
    } finally {
      setAgentRunning(false);
    }
  }, [task.id, selectedAgentId, thinkingLevel, agentModel, agentMode, kanban]);

  const handleRunAssignedAgents = useCallback(async () => {
    setAgentRunning(true);
    setAgentResult(null);
    setAgentError(null);
    try {
      const result = await kanban.runAssignedAgentsOnTask(task.id, {
        thinkingLevel,
        model: agentModel,
        mode: agentMode,
      });
      if (result) {
        setAgentResult(result);
        await loadTaskRuns();
      } else {
        setAgentError('Assigned agents returned no response');
      }
    } catch (err) {
      setAgentError('Assigned agents failed to run');
      console.error('handleRunAssignedAgents error:', err);
    } finally {
      setAgentRunning(false);
    }
  }, [task.id, thinkingLevel, agentModel, agentMode, kanban, loadTaskRuns]);

  const selectedAgent = availableAgents.find(a => a.id === selectedAgentId)
    || { id: 'blackswan-default', name: 'BlackSwan', color: '#b5b5b5' };

  const assignedAgents = assignedAgentIds
    .map(agentId => availableAgents.find(a => a.id === agentId))
    .filter(Boolean) as CircleOfficeAgent[];
  const assignedAgent = assignedAgents[0] || null;
  const ownershipAssignments = (task.agent_assignments || [])
    .filter(assignment => assignedAgentIds.includes(assignment.agent_id))
    .sort((a, b) => (a.order_index ?? 999) - (b.order_index ?? 999));
  const assignedMember = assignedTo
    ? kanban.members.find(m => m.id === assignedTo)
    : null;
  const taskAssignedAgents = (task.assigned_agent_ids || (task.assigned_agent_id ? [task.assigned_agent_id] : []))
    .map(agentId => availableAgents.find(a => a.id === agentId))
    .filter(Boolean) as CircleOfficeAgent[];
  const marketplaceRecommendations = useMemo(
    () => recommendMarketplaceItemsForWork({
      title: task.title,
      description: task.description || undefined,
      installedProviders,
      extraText: [
        ...ownershipAssignments.flatMap(assignment => assignment.required_connectors || []),
        ...ownershipAssignments.flatMap(assignment => assignment.required_capabilities || []),
      ],
    }),
    [installedProviders, ownershipAssignments, task.description, task.title],
  );

  const currentCol = COLUMNS.find(c => c.key === task.status) || COLUMNS[1];

  // Peer review data
  const isPeerReview = task.status === 'peer_review';
  const isFinalReview = task.status === 'review';
  const peerApprovals = task.peer_approvals || [];
  const goalData = goals?.find(g => g.id === task.goal_id);
  const goalAgentIds = goalData?.assigned_agent_ids || [];
  const reviewAgentIds = taskAssignedAgents.length > 0 ? taskAssignedAgents.map(agent => agent.id) : goalAgentIds;
  const isAutoReport = task.title.startsWith('[Auto]');

  const timeSince = (iso: string) => {
    const ms = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(ms / 60000);
    if (mins < 1) return 'now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  const toggleAssignedAgent = (agentId: string) => {
    setAssignedTo(null);
    setAssignedAgentIds(prev => prev.includes(agentId)
      ? prev.filter(id => id !== agentId)
      : [...prev, agentId]);
  };

  useEffect(() => {
    setCompletionPolicy(prev => {
      if (assignedAgentIds.length <= 1 && prev !== 'single_owner') return 'single_owner';
      if (assignedAgentIds.length > 1 && prev === 'single_owner') return 'any_assigned';
      return prev;
    });
  }, [assignedAgentIds]);

  useEffect(() => {
    if (!selectedRoomId && assignmentMode === 'room_team') {
      setAssignmentMode('manual');
    }
  }, [selectedRoomId, assignmentMode]);

  useEffect(() => {
    if (assignmentMode !== 'room_team') return;
    setAssignedTo(null);
    setAssignedAgentIds([]);
    setShowAssignees(false);
  }, [assignmentMode]);

  return (
    <View style={s.overlay}>
      <Pressable style={s.backdrop} onPress={onClose} />
      <KeyboardAvoidingView behavior="padding" style={s.modalWrap}>
        <View style={s.modal}>
          <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false}>
            {/* Peer Review Banner */}
            {isPeerReview && (
              <View style={s.reviewBanner}>
                <View style={[s.reviewBannerDot, { backgroundColor: '#a855f7' }]} />
                <Text style={s.reviewBannerText}>PEER REVIEW</Text>
              </View>
            )}
            {isFinalReview && (
              <View style={[s.reviewBanner, { backgroundColor: '#f59e0b08' }]}>
                <View style={[s.reviewBannerDot, { backgroundColor: '#f59e0b' }]} />
                <Text style={[s.reviewBannerText, { color: '#f59e0b' }]}>FINAL REVIEW</Text>
              </View>
            )}
            {isAutoReport && (
              <View style={[s.reviewBanner, { backgroundColor: '#ffffff08' }]}>
                <Text style={{ fontSize: 12 }}>{'\u{1F916}'}</Text>
                <Text style={[s.reviewBannerText, { color: '#e8e8e8' }]}>AUTOMATION REPORT</Text>
                {task.title.includes('FAILED') && (
                  <View style={{ backgroundColor: '#ef444420', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1, marginLeft: 4 }}>
                    <Text style={{ color: '#ef4444', fontSize: 9, fontWeight: '700' }}>FAILED</Text>
                  </View>
                )}
              </View>
            )}

            {/* Header */}
            <View style={s.headerRow}>
              <View style={s.headerLeft}>
                <View style={[s.columnIndicator, { backgroundColor: currentCol.color + '15' }]}>
                  <View style={[s.columnDot, { backgroundColor: currentCol.color }]} />
                  <Text style={[s.columnLabel, { color: currentCol.color }]}>{currentCol.label}</Text>
                </View>
              </View>
              <View style={s.headerActions}>
                {!editing ? (
                  <Pressable onPress={() => setEditing(true)} style={s.headerBtn}>
                    <Text style={s.editBtnText}>Edit</Text>
                  </Pressable>
                ) : (
                  <Pressable onPress={handleSave} style={[s.headerBtn, s.saveBtnBg]}>
                    <Text style={s.saveBtnText}>Save</Text>
                  </Pressable>
                )}
                <Pressable onPress={onClose} style={s.closeBtn}>
                  <Text style={s.closeBtnText}>x</Text>
                </Pressable>
              </View>
            </View>

            {/* Status progress */}
            <View style={s.statusBar}>
              {COLUMNS.map((col, i) => {
                const isActive = col.key === task.status;
                const isPast = COLUMNS.findIndex(c => c.key === task.status) >= i;
                return (
                  <Pressable
                    key={col.key}
                    onPress={() => kanban.moveTask(task.id, col.key)}
                    style={[
                      s.statusStep,
                      isPast && { backgroundColor: col.color + '12' },
                      isActive && { backgroundColor: col.color + '20', borderColor: col.color + '40' },
                    ]}
                  >
                    <View style={[s.statusDot, isPast ? { backgroundColor: col.color } : { backgroundColor: '#3e3e3e' }]} />
                    <Text style={[
                      s.statusStepText,
                      isActive ? { color: col.color } : isPast ? { color: '#9e9e9e' } : { color: '#3e3e3e' },
                    ]}>
                      {col.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Peer Review Panel */}
            {isPeerReview && reviewAgentIds.length > 0 && (
              <View style={s.peerPanel}>
                <Text style={s.peerPanelTitle}>Reviewers</Text>
                {reviewAgentIds.map((aid, i) => {
                  const approved = peerApprovals.includes(aid);
                  const agent = kanban.agents.find(a => a.id === aid);
                  const roster = DEFAULT_AGENT_ROSTER.find(r => agent?.name?.toLowerCase().includes(r.name.toLowerCase()));
                  return (
                    <View key={i} style={s.peerRow}>
                      <View style={[s.peerIcon, approved ? { backgroundColor: '#22c55e15' } : { backgroundColor: '#1a1a1a' }]}>
                        {roster ? (
                          <Text style={s.peerEmoji}>{roster.emoji}</Text>
                        ) : (
                          <Text style={[s.peerInitial, approved && { color: '#22c55e' }]}>
                            {(agent?.name || '?')[0].toUpperCase()}
                          </Text>
                        )}
                      </View>
                      <Text style={s.peerName}>{agent?.name || aid}</Text>
                      {approved ? (
                        <View style={s.peerApprovedBadge}>
                          <Text style={s.peerApprovedText}>{'\u2713'} Approved</Text>
                        </View>
                      ) : (
                        <View style={s.peerPendingBadge}>
                          <Text style={s.peerPendingText}>{'\u23F3'} Pending</Text>
                        </View>
                      )}
                    </View>
                  );
                })}

                {/* Peer review action buttons */}
                <View style={s.peerActions}>
                  <Pressable onPress={handleApprove} style={s.approveBtn}>
                    <Text style={s.approveBtnText}>{'\u2713'} Approve</Text>
                  </Pressable>
                  <Pressable onPress={handleRequestChanges} style={s.changesBtn}>
                    <Text style={s.changesBtnText}>{'\u{1F504}'} Request Changes</Text>
                  </Pressable>
                </View>
              </View>
            )}

            {/* Final Review Panel */}
            {isFinalReview && (
              <View style={[s.peerPanel, { borderColor: '#f59e0b20' }]}>
                <Text style={[s.peerPanelTitle, { color: '#f59e0b' }]}>Final Review</Text>
                <Text style={s.peerPanelSub}>
                  This task has passed peer review. Approve to mark as complete or send it back.
                </Text>
                <View style={s.peerActions}>
                  <Pressable onPress={handleFinalApprove} style={s.approveBtn}>
                    <Text style={s.approveBtnText}>{'\u2713'} Approve & Complete</Text>
                  </Pressable>
                  <Pressable onPress={handleSendBack} style={s.changesBtn}>
                    <Text style={s.changesBtnText}>{'\u{1F504}'} Send Back</Text>
                  </Pressable>
                </View>
              </View>
            )}

            {/* Title */}
            <Text style={s.sectionLabel}>Title</Text>
            {editing ? (
              <TextInput
                style={s.input}
                value={title}
                onChangeText={setTitle}
                maxLength={200}
              />
            ) : (
              <Text style={s.titleText}>{task.title}</Text>
            )}

            {/* Description */}
            <Text style={s.sectionLabel}>Description</Text>
            {editing ? (
              <View>
                <TextInput
                  style={[s.input, s.textArea]}
                  value={description}
                  onChangeText={(t) => {
                    setDescription(t);
                    setDescriptionMentionQuery(detectMentionQuery(t, descriptionCursorPos));
                  }}
                  onSelectionChange={(e) => {
                    const pos = e.nativeEvent.selection.end;
                    setDescriptionCursorPos(pos);
                    setDescriptionMentionQuery(detectMentionQuery(description, pos));
                  }}
                  multiline
                  maxLength={isAutoReport ? 50000 : 2000}
                  placeholder="Add details. '@' to mention a mission, task, or teammate."
                  placeholderTextColor="#3e3e3e"
                />
                {descriptionMentionQuery !== null && (
                  <View style={{ marginTop: 6, alignSelf: 'flex-start' }}>
                    <MentionPicker
                      circleId={circleId}
                      query={descriptionMentionQuery}
                      onSelect={(cand) => {
                        const { text, cursor } = insertMention(description, descriptionCursorPos, cand);
                        setDescription(text);
                        setDescriptionCursorPos(cursor);
                        setDescriptionMentionQuery(null);
                      }}
                      onDismiss={() => setDescriptionMentionQuery(null)}
                    />
                  </View>
                )}
              </View>
            ) : isAutoReport ? (
              <AutomationReportView description={task.description || ''} />
            ) : (
              task.description
                ? <MentionText content={task.description} style={s.fieldValue} />
                : <Text style={[s.fieldValue, s.fieldEmpty]}>No description</Text>
            )}

            <Text style={s.sectionLabel}>Project Room</Text>
            {editing ? (
              <View style={s.chipRow}>
                <Pressable
                  onPress={() => setSelectedRoomId(null)}
                  style={[s.chip, !selectedRoomId && { backgroundColor: '#e8e8e812', borderColor: '#e8e8e830' }]}
                >
                  <Text style={[s.chipText, !selectedRoomId && { color: '#e8e8e8' }]}>None</Text>
                </Pressable>
                {rooms.map(room => {
                  const active = selectedRoomId === room.id;
                  const color = room.color || '#22d3ee';
                  return (
                    <Pressable
                      key={room.id}
                      onPress={() => setSelectedRoomId(active ? null : room.id)}
                      style={[s.chip, active && { backgroundColor: color + '15', borderColor: color + '30' }]}
                    >
                      <View style={[s.chipDot, { backgroundColor: color }]} />
                      <Text style={[s.chipText, active && { color }]}>{room.name}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <Text style={[s.fieldValue, !task.room?.name && s.fieldEmpty]}>
                {task.room?.name || 'No project room'}
              </Text>
            )}

            {/* Focus Chain (Checklist) */}
            <FocusChainPanel
              taskId={task.id}
              taskTitle={task.title}
              taskDescription={task.description || undefined}
              items={task.focus_chain || []}
              onUpdate={(chain) => kanban.updateFocusChain(task.id, chain)}
              circleId={circleId}
            />

            {/* Image */}
            <Text style={s.sectionLabel}>Image</Text>
            {task.image_url ? (
              <View style={s.imageSection}>
                <Pressable onPress={() => setImageExpanded(e => !e)}>
                  <Image
                    source={{ uri: task.image_url }}
                    style={imageExpanded ? s.imageExpanded : s.imagePreview}
                    resizeMode={imageExpanded ? 'contain' : 'cover'}
                  />
                </Pressable>
                {editing && (
                  <Pressable onPress={handleRemoveImage} style={s.removeImageBtn}>
                    <Text style={s.removeImageText}>Remove image</Text>
                  </Pressable>
                )}
              </View>
            ) : (
              <View>
                {editing && Platform.OS === 'web' && (
                  <View>
                    <Pressable
                      onPress={() => fileInputRef.current?.click()}
                      style={s.addImageBtn}
                      disabled={uploading}
                    >
                      {uploading ? (
                        <ActivityIndicator size="small" color="#e8e8e8" />
                      ) : (
                        <Text style={s.addImageText}>+ Add Image</Text>
                      )}
                    </Pressable>
                  </View>
                )}
                {!editing && (
                  <Text style={s.fieldEmpty}>No image</Text>
                )}
              </View>
            )}
            {/* Hidden file input for web image upload */}
            {Platform.OS === 'web' && (
              <View style={{ height: 0, overflow: 'hidden' }}>
                {(() => {
                  // Render a hidden HTML file input via ref
                  if (typeof document !== 'undefined' && !fileInputRef.current) {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = 'image/*';
                    input.style.display = 'none';
                    input.onchange = (e: any) => {
                      const file = e.target?.files?.[0];
                      if (file) handleImageUpload(file);
                      input.value = '';
                    };
                    document.body.appendChild(input);
                    fileInputRef.current = input;
                  }
                  return null;
                })()}
              </View>
            )}

            {/* Run Agent */}
            <Text style={s.sectionLabel}>AI Agent</Text>
            <View style={s.agentSection}>
              {/* Mode toggle: Plan vs Execute */}
              <View style={s.modeRow}>
                {([
                  { key: 'plan' as AgentMode, label: 'PLAN', icon: '\u{1F4CB}', desc: 'Analyze first' },
                  { key: 'execute' as AgentMode, label: 'EXECUTE', icon: '\u26A1', desc: 'Do the work' },
                ] as const).map(m => {
                  const active = agentMode === m.key;
                  return (
                    <Pressable
                      key={m.key}
                      onPress={() => setAgentMode(m.key)}
                      style={[s.modeBtn, active && s.modeBtnActive]}
                    >
                      <Text style={s.modeBtnIcon}>{m.icon}</Text>
                      <View>
                        <Text style={[s.modeBtnLabel, active && s.modeBtnLabelActive]}>{m.label}</Text>
                        <Text style={s.modeBtnDesc}>{m.desc}</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>

              {/* Thinking level */}
              <View style={s.controlRow}>
                <Text style={s.controlLabel}>Thinking</Text>
                <View style={s.thinkingRow}>
                  {([
                    { key: 'fast' as ThinkingLevel, label: 'FAST', icon: '\u26A1', color: '#f59e0b' },
                    { key: 'balanced' as ThinkingLevel, label: 'BALANCED', icon: '\u{1F3AF}', color: '#6366f1' },
                    { key: 'deep' as ThinkingLevel, label: 'DEEP', icon: '\u{1F9E0}', color: '#a855f7' },
                  ] as const).map(t => {
                    const active = thinkingLevel === t.key;
                    return (
                      <Pressable
                        key={t.key}
                        onPress={() => setThinkingLevel(t.key)}
                        style={[s.thinkingBtn, active && { backgroundColor: t.color + '15', borderColor: t.color + '30' }]}
                      >
                        <Text style={{ fontSize: 11 }}>{t.icon}</Text>
                        <Text style={[s.thinkingBtnText, active && { color: t.color }]}>{t.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              {/* Model picker */}
              <View style={s.controlRow}>
                <Text style={s.controlLabel}>Model</Text>
                <View style={s.thinkingRow}>
                  {([
                    { key: 'auto' as AgentModel, label: 'AUTO', color: '#6366f1' },
                    { key: 'blackswan' as AgentModel, label: 'BSwan', color: '#22d3ee' },
                    { key: 'claude-haiku' as AgentModel, label: 'Haiku', color: '#22c55e' },
                    { key: 'claude-sonnet' as AgentModel, label: 'Sonnet', color: '#f59e0b' },
                    { key: 'claude-opus' as AgentModel, label: 'Opus', color: '#a855f7' },
                  ] as const).map(m => {
                    const active = agentModel === m.key;
                    return (
                      <Pressable
                        key={m.key}
                        onPress={() => setAgentModel(m.key)}
                        style={[s.thinkingBtn, active && { backgroundColor: m.color + '15', borderColor: m.color + '30' }]}
                      >
                        <Text style={[s.thinkingBtnText, active && { color: m.color }]}>{m.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              {/* Agent picker + run */}
              <View style={s.agentPickerRow}>
                <Pressable onPress={() => setShowAgentPicker(p => !p)} style={s.agentPickerToggle}>
                  <View style={[s.agentPickerDot, { backgroundColor: (selectedAgent as any).color || '#b5b5b5' }]} />
                  <Text style={s.agentPickerName}>{(selectedAgent as any).name || 'BlackSwan'}</Text>
                  <Text style={s.agentPickerArrow}>{showAgentPicker ? '\u25B2' : '\u25BC'}</Text>
                </Pressable>
                <Pressable
                  onPress={handleRunAgent}
                  style={[
                    s.runAgentBtn,
                    agentRunning && { opacity: 0.5 },
                    agentMode === 'plan' && { backgroundColor: '#f59e0b15', borderColor: '#f59e0b30' },
                  ]}
                  disabled={agentRunning}
                >
                  {agentRunning ? (
                    <View style={s.runAgentLoadingRow}>
                      <ActivityIndicator size="small" color={agentMode === 'plan' ? '#f59e0b' : '#6366f1'} />
                      <Text style={[s.runAgentBtnText, agentMode === 'plan' && { color: '#f59e0b' }]}>
                        {agentMode === 'plan' ? 'Planning...' : 'Working...'}
                      </Text>
                    </View>
                  ) : (
                    <Text style={[s.runAgentBtnText, agentMode === 'plan' && { color: '#f59e0b' }]}>
                      {agentMode === 'plan' ? 'GENERATE PLAN' : 'RUN AGENT'}
                    </Text>
                  )}
                </Pressable>
              </View>

              {taskAssignedAgents.length > 1 && (
                <Pressable
                  onPress={handleRunAssignedAgents}
                  style={[
                    s.runAgentBtn,
                    { width: '100%', marginTop: 8, backgroundColor: '#22c55e12', borderColor: '#22c55e30' },
                    agentRunning && { opacity: 0.5 },
                  ]}
                  disabled={agentRunning}
                >
                  <Text style={[s.runAgentBtnText, { color: '#22c55e' }]}>
                    {agentMode === 'plan' ? 'PLAN WITH TEAM' : `RUN ${taskAssignedAgents.length} ASSIGNED AGENTS`}
                  </Text>
                </Pressable>
              )}

              {/* Agent picker dropdown */}
              {showAgentPicker && (
                <View style={s.agentPickerList}>
                  <Pressable
                    onPress={() => { setSelectedAgentId('blackswan-default'); setShowAgentPicker(false); }}
                    style={[s.agentPickerOption, selectedAgentId === 'blackswan-default' && s.agentPickerOptionActive]}
                  >
                    <View style={[s.agentPickerDot, { backgroundColor: '#b5b5b5' }]} />
                    <Text style={s.agentPickerOptionText}>BlackSwan</Text>
                    <Text style={s.agentPickerDefault}>default</Text>
                  </Pressable>
                  {availableAgents.filter(a => a.id !== 'blackswan-default').map(a => (
                    <Pressable
                      key={a.id}
                      onPress={() => { setSelectedAgentId(a.id); setShowAgentPicker(false); }}
                      style={[s.agentPickerOption, selectedAgentId === a.id && s.agentPickerOptionActive]}
                    >
                      <View style={[s.agentPickerDot, { backgroundColor: a.color || '#e8e8e8' }]} />
                      <Text style={s.agentPickerOptionText}>{a.name}</Text>
                    </Pressable>
                  ))}
                  <Pressable
                    onPress={() => { setShowAgentPicker(false); setShowSpawnAgent(true); }}
                    style={[s.agentPickerOption, { borderTopWidth: 1, borderTopColor: '#1a1a1a', marginTop: 4, paddingTop: 8 }]}
                  >
                    <Text style={{ color: '#6366f1', fontSize: 12, fontWeight: '700', fontFamily: 'monospace' }}>+ NEW AGENT</Text>
                  </Pressable>
                </View>
              )}

              {/* Spawn Agent Panel */}
              {showSpawnAgent && (
                <View style={s.spawnAgentContainer}>
                  <SpawnAgentPanel
                    circleId={task.circle_id}
                    onCreated={(agentId, agentName) => {
                      setShowSpawnAgent(false);
                      setSelectedAgentId(agentId);
                      kanban.refresh();
                    }}
                    onCancel={() => setShowSpawnAgent(false)}
                  />
                </View>
              )}

              {/* Agent result */}
              {agentResult && (
                <View style={s.agentResultBox}>
                  <View style={s.agentResultHeader}>
                    <Text style={s.agentResultLabel}>
                      {agentMode === 'plan' ? 'Plan' : 'Agent Output'}
                    </Text>
                    {agentMode === 'plan' && (
                      <Pressable
                        onPress={() => { setAgentMode('execute'); handleRunAgent(); }}
                        style={s.approveAndRunBtn}
                      >
                        <Text style={s.approveAndRunText}>{'\u26A1'} Approve & Execute</Text>
                      </Pressable>
                    )}
                  </View>
                  <Text style={s.agentResultText} selectable>{agentResult}</Text>
                </View>
              )}
              {agentError && (
                <View style={s.agentErrorBox}>
                  <Text style={s.agentErrorText}>{agentError}</Text>
                </View>
              )}
            </View>

            {/* Priority */}
            <Text style={s.sectionLabel}>Priority</Text>
            {editing ? (
              <View style={s.chipRow}>
                {(['low', 'normal', 'high', 'urgent'] as TaskPriority[]).map(p => {
                  const active = priority === p;
                  const color = PRIORITY_COLORS[p];
                  return (
                    <Pressable
                      key={p}
                      onPress={() => setPriority(p)}
                      style={[s.chip, active && { backgroundColor: color + '15', borderColor: color + '30' }]}
                    >
                      {active && <View style={[s.chipDot, { backgroundColor: color }]} />}
                      <Text style={[s.chipText, active && { color }]}>{PRIORITY_LABELS[p]}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <View style={[s.inlineBadge, { backgroundColor: PRIORITY_COLORS[task.priority] + '15' }]}>
                <Text style={{ color: PRIORITY_COLORS[task.priority], fontSize: 12, fontWeight: '600' }}>
                  {PRIORITY_LABELS[task.priority]}
                </Text>
              </View>
            )}

            {/* Assignee */}
            <Text style={s.sectionLabel}>Assignment source</Text>
            {editing ? (
              <View style={s.chipRow}>
                <Pressable
                  onPress={() => setAssignmentMode('manual')}
                  style={[s.chip, assignmentMode === 'manual' && { backgroundColor: '#e8e8e812', borderColor: '#e8e8e830' }]}
                >
                  <Text style={[s.chipText, assignmentMode === 'manual' && { color: '#e8e8e8' }]}>Custom assignees</Text>
                </Pressable>
                <Pressable
                  onPress={() => selectedRoomId && setAssignmentMode('room_team')}
                  style={[s.chip, assignmentMode === 'room_team' && { backgroundColor: '#22d3ee15', borderColor: '#22d3ee30' }, !selectedRoomId && { opacity: 0.4 }]}
                  disabled={!selectedRoomId}
                >
                  <Text style={[s.chipText, assignmentMode === 'room_team' && { color: '#22d3ee' }]}>Use room team</Text>
                </Pressable>
              </View>
            ) : (
              <Text style={s.fieldValue}>
                {task.room_id && taskAssignedAgents.length > 0 ? 'Custom assignees or room team' : 'Custom assignees'}
              </Text>
            )}

            <Text style={s.sectionLabel}>Assigned to</Text>
            {editing ? (
              assignmentMode === 'room_team' ? (
                <View style={s.noteBox}>
                  <Text style={s.noteText}>
                    Saving will replace the task assignees with the active agents from the selected project room.
                  </Text>
                </View>
              ) : (
              <View>
                <Pressable onPress={() => setShowAssignees(p => !p)} style={s.assigneeToggle}>
                  <View style={s.assigneeToggleLeft}>
                    {assignedAgents.length > 0 ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <View style={[s.assigneeAvatar, { backgroundColor: assignedAgents[0]?.color || '#e8e8e8' }]}>
                          <Text style={s.assigneeAvatarText}>{assignedAgents[0]?.name?.[0]?.toUpperCase() || '?'}</Text>
                        </View>
                        {assignedAgents.length > 1 && (
                          <View style={[s.assigneeAvatar, { marginLeft: -8, backgroundColor: '#141414', borderWidth: 1, borderColor: '#2a2a2a' }]}>
                            <Text style={s.assigneeAvatarText}>+{assignedAgents.length - 1}</Text>
                          </View>
                        )}
                      </View>
                    ) : assignedMember ? (
                      <View style={[s.assigneeAvatar, { backgroundColor: '#e8e8e8' }]}>
                        <Text style={s.assigneeAvatarText}>
                          {(assignedMember.display_name || assignedMember.username || '?')[0].toUpperCase()}
                        </Text>
                      </View>
                    ) : null}
                    <Text style={s.assigneeToggleText}>
                      {assignedAgents.length > 0
                        ? assignedAgents.map(agent => agent.name).join(', ')
                        : assignedMember
                          ? (assignedMember.display_name || assignedMember.username)
                          : 'Unassigned'}
                    </Text>
                  </View>
                  <Text style={s.assigneeToggleArrow}>{showAssignees ? '-' : '+'}</Text>
                </Pressable>
                {showAssignees && (
                  <View style={s.assigneeList}>
                    <Pressable
                      onPress={() => { setAssignedTo(null); setAssignedAgentIds([]); setShowAssignees(false); }}
                      style={[s.assigneeOption, !assignedTo && assignedAgentIds.length === 0 && s.assigneeOptionActive]}
                    >
                      <Text style={s.assigneeOptionText}>Unassigned</Text>
                    </Pressable>
                    {kanban.members.length > 0 && (
                      <Text style={s.assigneeSectionLabel}>Members</Text>
                    )}
                    {kanban.members.map(m => (
                      <Pressable
                        key={m.id}
                        onPress={() => { setAssignedTo(m.id); setAssignedAgentIds([]); setShowAssignees(false); }}
                        style={[s.assigneeOption, assignedTo === m.id && s.assigneeOptionActive]}
                      >
                        <View style={s.assigneeOptionRow}>
                          <View style={[s.assigneeAvatar, { backgroundColor: '#e8e8e8' }]}>
                            <Text style={s.assigneeAvatarText}>
                              {(m.display_name || m.username || '?')[0].toUpperCase()}
                            </Text>
                          </View>
                          <Text style={s.assigneeOptionText}>{m.display_name || m.username}</Text>
                        </View>
                      </Pressable>
                    ))}
                    {availableAgents.length > 0 && (
                      <Text style={s.assigneeSectionLabel}>Agents</Text>
                    )}
                    {availableAgents.map(a => {
                      const active = assignedAgentIds.includes(a.id);
                      const isOnline = a.status === 'active' || a.status === 'building' || a.status === 'idle';
                      return (
                        <Pressable
                          key={a.id}
                          onPress={() => toggleAssignedAgent(a.id)}
                          style={[s.assigneeOption, active && s.assigneeOptionActive, !isOnline && { opacity: 0.35 }]}
                        >
                          <View style={[s.assigneeOptionRow, { justifyContent: 'space-between' }]}>
                            <View style={[s.assigneeOptionRow, { flex: 1 }]}> 
                              <View style={[s.assigneeAvatar, { backgroundColor: a.color || '#e8e8e8' }]}>
                                <Text style={s.assigneeAvatarText}>{a.name[0].toUpperCase()}</Text>
                              </View>
                              <Text style={s.assigneeOptionText}>{a.name}</Text>
                            </View>
                            <Text style={[s.assigneeOptionText, { color: active ? '#22c55e' : '#6f6f6f', fontWeight: '700' }]}>
                              {active ? 'Selected' : isOnline ? 'Add' : 'Offline'}
                            </Text>
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                )}
              </View>
              )
            ) : (
              <View style={s.assigneeDisplay}>
                {taskAssignedAgents.length > 0 ? (
                  <View style={{ gap: 8 }}>
                    {taskAssignedAgents.map(agent => (
                      <View key={agent.id} style={s.assigneeRow}>
                        <View style={[s.assigneeAvatar, { backgroundColor: agent.color || '#e8e8e8' }]}>
                          <Text style={s.assigneeAvatarText}>{agent.name[0].toUpperCase()}</Text>
                        </View>
                        <Text style={s.fieldValue}>{agent.name}</Text>
                      </View>
                    ))}
                  </View>
                ) : task.assignee ? (
                  <View style={s.assigneeRow}>
                    <View style={[s.assigneeAvatar, { backgroundColor: '#e8e8e8' }]}>
                      <Text style={s.assigneeAvatarText}>
                        {(task.assignee.display_name || task.assignee.username || '?')[0].toUpperCase()}
                      </Text>
                    </View>
                    <Text style={s.fieldValue}>
                      {task.assignee.display_name || task.assignee.username}
                    </Text>
                  </View>
                ) : (
                  <Text style={s.fieldEmpty}>Unassigned</Text>
                )}
              </View>
            )}

            {ownershipAssignments.length > 0 && (
              <>
                <Text style={s.sectionLabel}>Ownership readiness</Text>
                <View style={s.ownershipPanel}>
                  {ownershipAssignments.map(assignment => {
                    const agent = availableAgents.find(item => item.id === assignment.agent_id);
                    const tone = assignment.ownership_status === 'blocked'
                      ? { label: 'BLOCKED', color: '#ef4444', bg: '#ef444415', border: '#ef444430' }
                      : assignment.ownership_status === 'assisted'
                        ? { label: 'ASSISTED', color: '#f59e0b', bg: '#f59e0b15', border: '#f59e0b30' }
                        : { label: 'FULL', color: '#22c55e', bg: '#22c55e15', border: '#22c55e30' };
                    return (
                      <View key={assignment.id} style={s.ownershipRow}>
                        <View style={s.ownershipHeader}>
                          <View style={s.ownershipAgent}>
                            <View style={[s.assigneeAvatar, { backgroundColor: agent?.color || '#e8e8e8' }]}>
                              <Text style={s.assigneeAvatarText}>{(agent?.name || assignment.agent_id)[0].toUpperCase()}</Text>
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={s.ownershipAgentName}>{agent?.name || assignment.agent_id}</Text>
                              <Text style={s.ownershipAgentMeta}>{assignment.role || 'executor'}</Text>
                            </View>
                          </View>
                          <View style={[s.ownershipBadge, { backgroundColor: tone.bg, borderColor: tone.border }]}>
                            <Text style={[s.ownershipBadgeText, { color: tone.color }]}>{tone.label}</Text>
                          </View>
                        </View>
                        {assignment.ownership_summary ? (
                          <Text style={s.ownershipSummary}>{assignment.ownership_summary}</Text>
                        ) : null}
                        {assignment.required_connectors && assignment.required_connectors.length > 0 ? (
                          <Text style={s.ownershipDetail}>Required connectors: {assignment.required_connectors.join(', ')}</Text>
                        ) : null}
                        {assignment.required_capabilities && assignment.required_capabilities.length > 0 ? (
                          <Text style={s.ownershipDetail}>Required capabilities: {assignment.required_capabilities.join(', ')}</Text>
                        ) : null}
                        {assignment.missing_connectors && assignment.missing_connectors.length > 0 ? (
                          <Text style={[s.ownershipDetail, { color: '#fca5a5' }]}>Missing connectors: {assignment.missing_connectors.join(', ')}</Text>
                        ) : null}
                        {assignment.missing_capabilities && assignment.missing_capabilities.length > 0 ? (
                          <Text style={[s.ownershipDetail, { color: '#fcd34d' }]}>Missing capabilities: {assignment.missing_capabilities.join(', ')}</Text>
                        ) : null}
                        {(assignment.missing_connectors?.length || assignment.missing_capabilities?.length) ? (
                          <Text style={s.ownershipHint}>Connect the missing systems in Marketplace before expecting full ownership.</Text>
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              </>
            )}

            {marketplaceRecommendations.length > 0 && (
              <>
                <Text style={s.sectionLabel}>Marketplace guidance</Text>
                <View style={s.ownershipPanel}>
                  <View style={s.marketplaceGuidanceCard}>
                    <View style={s.marketplaceGuidanceRow}>
                      {marketplaceRecommendations.slice(0, 8).map(recommendation => (
                        <Pressable
                          key={recommendation.item.id}
                          onPress={() => onOpenMarketplace?.({ itemId: recommendation.item.id, groupKey: recommendation.item.group })}
                          style={[
                            s.marketplaceGuidanceChip,
                            recommendation.installed ? s.marketplaceGuidanceChipInstalled : s.marketplaceGuidanceChipMissing,
                          ]}
                        >
                          <Text
                            style={[
                              s.marketplaceGuidanceChipText,
                              recommendation.installed && s.marketplaceGuidanceChipTextInstalled,
                            ]}
                          >
                            {recommendation.item.label}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                    <View style={s.marketplaceGuidanceFooter}>
                      <Text style={[s.marketplaceGuidanceText, { flex: 1 }]}>
                        Missing items are the highest-leverage Marketplace installs for this task. Installed items are already usable by the circle runtime.
                      </Text>
                      {onOpenMarketplace ? (
                        <Pressable
                          onPress={() => {
                            const target = marketplaceRecommendations.find(item => !item.installed) || marketplaceRecommendations[0];
                            if (target) onOpenMarketplace({ itemId: target.item.id, groupKey: target.item.group });
                          }}
                          style={s.marketplaceOpenBtn}
                        >
                          <Text style={s.marketplaceOpenBtnText}>Open Marketplace</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  </View>
                </View>
              </>
            )}

            <Text style={s.sectionLabel}>Completion policy</Text>
            {editing ? (
              <View style={s.chipRow}>
                {[
                  { key: 'single_owner' as TaskCompletionPolicy, label: 'Owner finishes', hint: 'One primary assignee is responsible for completion.' },
                  { key: 'any_assigned' as TaskCompletionPolicy, label: 'Any assigned can finish', hint: 'One assigned agent can complete the task while others collaborate.' },
                  { key: 'all_assigned' as TaskCompletionPolicy, label: 'All assigned must finish', hint: 'Use for strict review, handoff, or signoff workflows.' },
                ].map(option => {
                  const active = completionPolicy === option.key;
                  return (
                    <Pressable
                      key={option.key}
                      onPress={() => setCompletionPolicy(option.key)}
                      style={[s.policyChip, active && s.policyChipActive]}
                    >
                      <Text style={[s.policyChipTitle, active && s.policyChipTitleActive]}>{option.label}</Text>
                      <Text style={[s.policyChipHint, active && s.policyChipHintActive]}>{option.hint}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <View style={s.inlineBadge}>
                <Text style={s.fieldValue}>
                  {task.completion_policy === 'all_assigned'
                    ? 'All assigned must finish'
                    : task.completion_policy === 'single_owner'
                      ? 'Owner finishes'
                      : 'Any assigned can finish'}
                </Text>
              </View>
            )}

            {/* Due date */}
            <Text style={s.sectionLabel}>Due date</Text>
            {editing ? (
              <TextInput
                style={s.input}
                value={dueDate}
                onChangeText={setDueDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#3e3e3e"
                maxLength={10}
              />
            ) : (
              <Text style={[s.fieldValue, !task.due_date && s.fieldEmpty]}>
                {task.due_date || 'No due date'}
              </Text>
            )}

            {/* Meta */}
            <View style={s.metaRow}>
              <Text style={s.metaText}>
                Created {timeSince(task.created_at)}
                {task.creator ? ` by ${task.creator.display_name || task.creator.username}` : ''}
              </Text>
              {task.completed_at && (
                <Text style={[s.metaText, { color: '#22c55e' }]}>
                  Completed {timeSince(task.completed_at)}
                </Text>
              )}
            </View>

            {/* Delete */}
            <Pressable onPress={() => setShowDelete(p => !p)} style={s.deleteToggle}>
              <Text style={s.deleteToggleText}>Delete task</Text>
            </Pressable>
            {showDelete && (
              <View style={s.deleteConfirm}>
                <Text style={s.deleteWarning}>This cannot be undone.</Text>
                <Pressable onPress={handleDelete} style={s.deleteBtn}>
                  <Text style={s.deleteBtnText}>Confirm delete</Text>
                </Pressable>
              </View>
            )}

            {/* Surface the agent-computed "next recommended action" persisted
                per run — until now only read server-side into a prompt. */}
            {taskRuns.length > 0 && (
              <View style={{ marginBottom: 16 }}>
                <TaskNextActionPanel runIds={taskRuns.map(r => r.id)} />
              </View>
            )}

            {/* Task Runs */}
            {taskRuns.length > 0 && (
              <>
                <Text style={s.sectionLabel}>Task Runs</Text>
                <View style={{ gap: 8, marginBottom: 16 }}>
                  {taskRuns.slice(0, 5).map(run => {
                    const runAgent = kanban.agents.find(a => a.id === run.agent_id);
                    const runColor = run.status === 'completed' ? '#22c55e' : run.status === 'failed' ? '#ef4444' : '#f59e0b';
                    const runMetadata = run.openswan_run_id ? taskRunMetadataByRunId[run.openswan_run_id] : null;
                    return (
                      <View key={run.id} style={{ borderWidth: 1, borderColor: '#1f1f1f', borderRadius: 10, padding: 10, backgroundColor: '#0a0a0a' }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                          <Text style={{ color: runColor, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' }}>{run.run_kind} ? {run.status}</Text>
                          <Text style={{ color: '#6f6f6f', fontSize: 11 }}>{timeSince(run.started_at)}</Text>
                        </View>
                        <Text style={{ color: '#e8e8e8', fontSize: 13, marginBottom: 4 }}>{runAgent?.name || run.agent_id}</Text>
                        {run.summary ? (
                          <Text style={{ color: '#b5b5b5', fontSize: 12, lineHeight: 18 }}>{run.summary}</Text>
                        ) : null}
                        <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                          {run.model_used ? <Text style={{ color: '#6f6f6f', fontSize: 11 }}>{run.model_used}</Text> : null}
                          {run.duration_ms ? <Text style={{ color: '#6f6f6f', fontSize: 11 }}>{(run.duration_ms / 1000).toFixed(1)}s</Text> : null}
                          {run.token_count ? <Text style={{ color: '#6f6f6f', fontSize: 11 }}>{run.token_count} tok</Text> : null}
                        </View>
                        {runMetadata ? (
                          <View style={{ marginTop: 8 }}>
                            <RunMetadataSummary
                              {...buildRunMetadataSummaryProps(runMetadata)}
                              variant="compact"
                              accentColor="#38bdf8"
                            />
                          </View>
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              </>
            )}

            {/* ── Execution Runtime Panels — Steps, Artifacts, Checks, Approvals ── */}
            {taskRuns.length > 0 && (() => {
              const latestRun = taskRuns[0];
              return (
                <>
                  <Text style={s.sectionLabel}>Run Details — {latestRun.summary?.slice(0, 60) || 'Latest Run'}</Text>
                  <View style={{ gap: 12, marginBottom: 16 }}>
                    <TaskRunTimeline runId={latestRun.id} circleId={task.circle_id} />
                    <TaskArtifactsPanel runId={latestRun.id} circleId={task.circle_id} />
                    <TaskChecksPanel taskId={task.id} runId={latestRun.id} circleId={task.circle_id} />
                    <TaskApprovalsPanel runId={latestRun.id} circleId={task.circle_id} />
                  </View>
                </>
              );
            })()}

            {/* Comments section */}
            <View style={s.commentSection}>
              <Text style={s.commentHeader}>Comments ({comments.length})</Text>

              {comments.map(c => {
                const isApproval = c.content.startsWith('[APPROVED]');
                const isChanges = c.content.startsWith('[CHANGES_REQUESTED]');
                const isFinal = c.content.startsWith('[FINAL_APPROVED]');
                const isSentBack = c.content.startsWith('[SENT_BACK]');
                const isAction = isApproval || isChanges || isFinal || isSentBack;
                const actionColor = isApproval || isFinal ? '#22c55e' : isChanges || isSentBack ? '#f59e0b' : undefined;

                return (
                  <View key={c.id} style={[s.comment, isAction && { backgroundColor: (actionColor || '#e8e8e8') + '08' }]}>
                    <View style={s.commentMeta}>
                      <View style={s.commentAuthorRow}>
                        <View style={[s.commentAvatar, isAction && { backgroundColor: actionColor + '20' }]}>
                          <Text style={[s.commentAvatarText, isAction && { color: actionColor }]}>
                            {((c.user as any)?.display_name || (c.user as any)?.username || '?')[0].toUpperCase()}
                          </Text>
                        </View>
                        <Text style={[s.commentAuthor, isAction && { color: actionColor }]}>
                          {(c.user as any)?.display_name || (c.user as any)?.username || 'User'}
                        </Text>
                      </View>
                      <Text style={s.commentTime}>{timeSince(c.created_at)}</Text>
                    </View>
                    <Text style={[s.commentContent, isAction && { color: actionColor }]}>{c.content}</Text>
                    {/* Render attachments */}
                    {c.attachments && c.attachments.length > 0 && (
                      <View style={s.commentAttachments}>
                        {c.attachments.map((att, ai) => {
                          if (att.type === 'image') {
                            return (
                              <View key={ai} style={s.commentAttImage}>
                                <Image source={{ uri: att.url }} style={s.commentAttImageImg} resizeMode="cover" />
                                <Text style={s.commentAttImageName}>{att.name}</Text>
                              </View>
                            );
                          }
                          if (att.type === 'code') {
                            return (
                              <View key={ai} style={s.commentAttCode}>
                                <View style={s.commentAttCodeHeader}>
                                  <Text style={s.commentAttCodeLang}>{att.language || 'code'}</Text>
                                  <Text style={s.commentAttCodeName}>{att.name}</Text>
                                </View>
                              </View>
                            );
                          }
                          return (
                            <Pressable
                              key={ai}
                              onPress={() => att.url ? (window as any).open?.(att.url, '_blank') : null}
                              style={s.commentAttFile}
                            >
                              <Text style={s.commentAttFileIcon}>{'\u{1F4CE}'}</Text>
                              <Text style={s.commentAttFileName}>{att.name}</Text>
                              {att.size != null && (
                                <Text style={s.commentAttFileSize}>
                                  {att.size < 1024 ? `${att.size}B` : att.size < 1048576 ? `${(att.size / 1024).toFixed(1)}KB` : `${(att.size / 1048576).toFixed(1)}MB`}
                                </Text>
                              )}
                            </Pressable>
                          );
                        })}
                      </View>
                    )}
                  </View>
                );
              })}

              {comments.length === 0 && (
                <Text style={s.noComments}>No comments yet</Text>
              )}
            </View>
          </ScrollView>

          {/* Pending attachment previews */}
          {commentAttachments.length > 0 && (
            <View style={s.pendingAttachments}>
              {commentAttachments.map((att, i) => (
                <View key={i} style={s.pendingAttItem}>
                  {att.type === 'image' ? (
                    <Image source={{ uri: att.url }} style={s.pendingAttThumb} resizeMode="cover" />
                  ) : (
                    <View style={s.pendingAttFileBadge}>
                      <Text style={s.pendingAttFileIcon}>{att.type === 'code' ? '</>' : '\u{1F4CE}'}</Text>
                    </View>
                  )}
                  <Text style={s.pendingAttName} numberOfLines={1}>{att.name}</Text>
                  <Pressable onPress={() => setCommentAttachments(prev => prev.filter((_, j) => j !== i))} style={s.pendingAttRemove}>
                    <Text style={s.pendingAttRemoveText}>x</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          )}

          {/* Comment input */}
          <View style={s.commentInput}>
            {Platform.OS === 'web' && (
              <Pressable
                onPress={() => {
                  if (commentFileRef.current) {
                    commentFileRef.current.click();
                  } else if (typeof document !== 'undefined') {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = 'image/*,.ts,.tsx,.js,.jsx,.py,.rs,.go,.java,.c,.cpp,.h,.css,.html,.json,.yaml,.yml,.toml,.sql,.sh,.md,.txt,.pdf,.zip';
                    input.style.display = 'none';
                    input.onchange = (e: any) => {
                      const file = e.target?.files?.[0];
                      if (file) handleCommentFileUpload(file);
                      input.value = '';
                    };
                    document.body.appendChild(input);
                    commentFileRef.current = input;
                    input.click();
                  }
                }}
                style={s.attachBtn}
                disabled={commentUploading}
              >
                {commentUploading ? (
                  <ActivityIndicator size="small" color="#e8e8e8" />
                ) : (
                  <Text style={s.attachBtnText}>{'\u{1F4CE}'}</Text>
                )}
              </Pressable>
            )}
            <TextInput
              style={s.commentField}
              value={commentText}
              onChangeText={setCommentText}
              placeholder="Add a comment..."
              placeholderTextColor="#3e3e3e"
              onSubmitEditing={handleAddComment}
              returnKeyType="send"
            />
            <Pressable
              onPress={handleAddComment}
              style={[s.commentSend, (!commentText.trim() && commentAttachments.length === 0) && { opacity: 0.3 }]}
              disabled={!commentText.trim() && commentAttachments.length === 0}
            >
              <Text style={s.commentSendText}>Send</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
  },
  backdrop: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
    ...(Platform.OS === 'web' ? { backdropFilter: 'blur(4px)' } as any : {}),
  },
  modalWrap: {
    width: '95%',
    maxWidth: 580,
    maxHeight: '90%',
    zIndex: 101,
  },
  modal: {
    backgroundColor: '#161616',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1a1a1a',
    maxHeight: '100%',
    overflow: 'hidden',
    ...(Platform.OS === 'web' ? { boxShadow: '0 20px 60px rgba(0,0,0,0.5)' } as any : {}),
  },
  scroll: {
    maxHeight: 620,
  },
  scrollContent: {
    padding: 24,
  },

  // Review banners
  reviewBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#ffffff06',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 16,
  },
  reviewBannerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  reviewBannerText: {
    color: '#a855f7',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },

  // Peer review panel
  peerPanel: {
    backgroundColor: '#a855f706',
    borderWidth: 1,
    borderColor: '#a855f715',
    borderRadius: 10,
    padding: 14,
    gap: 8,
    marginBottom: 16,
  },
  peerPanelTitle: {
    color: '#a855f7',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  peerPanelSub: {
    color: '#9e9e9e',
    fontSize: 12,
    lineHeight: 17,
  },
  peerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  peerIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  peerEmoji: {
    fontSize: 12,
  },
  peerInitial: {
    color: '#6f6f6f',
    fontSize: 10,
    fontWeight: '700',
  },
  peerName: {
    color: '#b5b5b5',
    fontSize: 13,
    flex: 1,
  },
  peerApprovedBadge: {
    backgroundColor: '#22c55e15',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  peerApprovedText: {
    color: '#22c55e',
    fontSize: 10,
    fontWeight: '600',
  },
  peerPendingBadge: {
    backgroundColor: '#f59e0b15',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  peerPendingText: {
    color: '#f59e0b',
    fontSize: 10,
    fontWeight: '600',
  },
  peerActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  approveBtn: {
    backgroundColor: '#22c55e15',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'opacity 0.15s' } as any : {}),
  },
  approveBtnText: {
    color: '#22c55e',
    fontSize: 12,
    fontWeight: '600',
  },
  changesBtn: {
    backgroundColor: '#f59e0b15',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'opacity 0.15s' } as any : {}),
  },
  changesBtnText: {
    color: '#f59e0b',
    fontSize: 12,
    fontWeight: '600',
  },

  // Header
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  columnIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  columnDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  columnLabel: {
    fontSize: 11,
    fontWeight: '700',
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  headerBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#1a1a1a',
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'opacity 0.15s' } as any : {}),
  },
  editBtnText: {
    color: '#9e9e9e',
    fontSize: 12,
    fontWeight: '600',
  },
  saveBtnBg: {
    backgroundColor: '#6366f1',
  },
  saveBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: '#1a1a1a',
    justifyContent: 'center',
    alignItems: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  closeBtnText: {
    color: '#6f6f6f',
    fontSize: 16,
    fontWeight: '400',
  },

  // Status bar
  statusBar: {
    flexDirection: 'row',
    gap: 4,
    marginBottom: 24,
  },
  statusStep: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderWidth: 1,
    borderColor: '#1a1a1a',
    borderRadius: 8,
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.15s' } as any : {}),
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusStepText: {
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },

  // Fields
  sectionLabel: {
    color: '#6f6f6f',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
    marginTop: 16,
  },
  titleText: {
    color: '#e8e8e8',
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 22,
  },
  fieldValue: {
    color: '#b5b5b5',
    fontSize: 14,
    lineHeight: 20,
  },
  fieldEmpty: {
    color: '#3e3e3e',
    fontStyle: 'italic',
  },
  noteBox: {
    backgroundColor: '#0a0a0a',
    borderWidth: 1,
    borderColor: '#1a1a1a',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  noteText: {
    color: '#9a9a9a',
    fontSize: 12,
    lineHeight: 18,
  },
  input: {
    backgroundColor: '#0a0a0a',
    borderWidth: 1,
    borderColor: '#1a1a1a',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    color: '#e8e8e8',
    fontSize: 14,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  chipRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#1a1a1a',
    borderRadius: 20,
    backgroundColor: '#0a0a0a',
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.15s' } as any : {}),
  },
  chipDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6f6f6f',
  },
  policyChip: {
    minWidth: 148,
    maxWidth: 220,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#1a1a1a',
    borderRadius: 12,
    backgroundColor: '#0a0a0a',
    gap: 4,
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.15s' } as any : {}),
  },
  policyChipActive: {
    borderColor: '#3a3a3a',
    backgroundColor: '#151515',
  },
  policyChipTitle: {
    color: '#b8b8b8',
    fontSize: 12,
    fontWeight: '700',
  },
  policyChipTitleActive: {
    color: '#e8e8e8',
  },
  policyChipHint: {
    color: '#6f6f6f',
    fontSize: 11,
    lineHeight: 15,
  },
  policyChipHintActive: {
    color: '#9e9e9e',
  },
  inlineBadge: {
    borderRadius: 20,
    paddingVertical: 4,
    paddingHorizontal: 10,
    alignSelf: 'flex-start',
  },

  // Assignee
  assigneeToggle: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#0a0a0a',
    borderWidth: 1,
    borderColor: '#1a1a1a',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  assigneeToggleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  assigneeToggleText: {
    color: '#b5b5b5',
    fontSize: 13,
  },
  assigneeToggleArrow: {
    color: '#6f6f6f',
    fontSize: 16,
    fontWeight: '300',
  },
  assigneeList: {
    backgroundColor: '#0a0a0a',
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: '#1a1a1a',
    borderBottomLeftRadius: 10,
    borderBottomRightRadius: 10,
    maxHeight: 220,
    overflow: 'hidden',
  },
  assigneeSectionLabel: {
    color: '#6f6f6f',
    fontSize: 10,
    fontWeight: '600',
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  assigneeOption: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderTopWidth: 1,
    borderTopColor: '#1a1a1a',
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'background 0.15s' } as any : {}),
  },
  assigneeOptionActive: {
    backgroundColor: '#1a1a1a',
  },
  assigneeOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  assigneeOptionText: {
    color: '#b5b5b5',
    fontSize: 13,
  },
  assigneeAvatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
  },
  assigneeAvatarText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  assigneeDisplay: {},
  assigneeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },

  // Meta
  metaRow: {
    marginTop: 20,
    gap: 4,
  },
  metaText: {
    color: '#3e3e3e',
    fontSize: 12,
  },

  // Delete
  deleteToggle: {
    marginTop: 14,
    alignSelf: 'flex-start',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  deleteToggleText: {
    color: '#6f6f6f',
    fontSize: 12,
    fontWeight: '500',
  },
  deleteConfirm: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
  },
  deleteWarning: {
    color: '#ef4444',
    fontSize: 12,
  },
  deleteBtn: {
    backgroundColor: '#ef444420',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  deleteBtnText: {
    color: '#ef4444',
    fontSize: 12,
    fontWeight: '600',
  },

  // Image section
  imageSection: {
    gap: 8,
  },
  imagePreview: {
    width: '100%' as any,
    height: 160,
    borderRadius: 10,
    backgroundColor: '#1a1a1a',
  },
  imageExpanded: {
    width: '100%' as any,
    height: 360,
    borderRadius: 10,
    backgroundColor: '#1a1a1a',
  },
  addImageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0a0a0a',
    borderWidth: 1,
    borderColor: '#1a1a1a',
    borderStyle: 'dashed' as any,
    borderRadius: 10,
    paddingVertical: 16,
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'border-color 0.15s' } as any : {}),
  },
  addImageText: {
    color: '#6f6f6f',
    fontSize: 13,
    fontWeight: '600',
  },
  removeImageBtn: {
    alignSelf: 'flex-start',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  removeImageText: {
    color: '#6f6f6f',
    fontSize: 11,
    fontWeight: '500',
  },

  // Agent section
  agentSection: {
    gap: 10,
  },
  agentPickerRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  agentPickerToggle: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#0a0a0a',
    borderWidth: 1,
    borderColor: '#1a1a1a',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  agentPickerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  agentPickerName: {
    color: '#b5b5b5',
    fontSize: 13,
    flex: 1,
  },
  agentPickerArrow: {
    color: '#6f6f6f',
    fontSize: 10,
  },
  agentPickerList: {
    backgroundColor: '#0a0a0a',
    borderWidth: 1,
    borderColor: '#1a1a1a',
    borderRadius: 10,
    maxHeight: 220,
    overflow: 'hidden',
  },
  agentPickerOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderTopWidth: 1,
    borderTopColor: '#1a1a1a',
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'background 0.15s' } as any : {}),
  },
  agentPickerOptionActive: {
    backgroundColor: '#1a1a1a',
  },
  agentPickerOptionText: {
    color: '#b5b5b5',
    fontSize: 13,
    flex: 1,
  },
  agentPickerDefault: {
    color: '#6366f1',
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase' as any,
    letterSpacing: 0.5,
  },
  runAgentBtn: {
    backgroundColor: '#6366f120',
    borderWidth: 1,
    borderColor: '#6366f140',
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 10,
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.15s' } as any : {}),
  },
  runAgentBtnText: {
    color: '#6366f1',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase' as any,
  },
  runAgentLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  agentResultBox: {
    backgroundColor: '#0a0a0a',
    borderWidth: 1,
    borderColor: '#22d3ee20',
    borderRadius: 10,
    padding: 14,
    gap: 6,
  },
  agentResultLabel: {
    color: '#22d3ee',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase' as any,
    letterSpacing: 0.5,
  },
  agentResultText: {
    color: '#e8e8e8',
    fontSize: 13,
    lineHeight: 20,
  },
  agentErrorBox: {
    backgroundColor: '#ef444410',
    borderWidth: 1,
    borderColor: '#ef444420',
    borderRadius: 10,
    padding: 12,
  },
  agentErrorText: {
    color: '#ef4444',
    fontSize: 12,
    fontWeight: '500',
  },
  spawnAgentContainer: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#ffffff15',
    borderRadius: 10,
    overflow: 'hidden',
    maxHeight: 500,
  },

  // Mode toggle (Plan / Execute)
  modeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  modeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#0a0a0a',
    borderWidth: 1,
    borderColor: '#1a1a1a',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.15s' } as any : {}),
  },
  modeBtnActive: {
    backgroundColor: '#6366f110',
    borderColor: '#6366f130',
  },
  modeBtnIcon: {
    fontSize: 16,
  },
  modeBtnLabel: {
    color: '#6f6f6f',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  modeBtnLabelActive: {
    color: '#6366f1',
  },
  modeBtnDesc: {
    color: '#3e3e3e',
    fontSize: 10,
  },

  // Thinking level + Model picker shared
  controlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  controlLabel: {
    color: '#6f6f6f',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase' as any,
    letterSpacing: 0.5,
    minWidth: 52,
  },
  thinkingRow: {
    flexDirection: 'row',
    gap: 4,
    flex: 1,
    flexWrap: 'wrap',
  },
  thinkingBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: '#1a1a1a',
    borderRadius: 8,
    backgroundColor: '#0a0a0a',
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.15s' } as any : {}),
  },
  thinkingBtnText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#6f6f6f',
    letterSpacing: 0.3,
  },

  // Agent result header with approve button
  agentResultHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  approveAndRunBtn: {
    backgroundColor: '#22c55e15',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.15s' } as any : {}),
  },
  approveAndRunText: {
    color: '#22c55e',
    fontSize: 10,
    fontWeight: '700',
  },

  // Comments
  commentSection: {
    marginTop: 28,
    borderTopWidth: 1,
    borderTopColor: '#1a1a1a',
    paddingTop: 16,
  },
  commentHeader: {
    color: '#6f6f6f',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 12,
  },
  comment: {
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    backgroundColor: '#0a0a0a',
  },
  commentMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  commentAuthorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  commentAvatar: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#1a1a1a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  commentAvatarText: {
    color: '#6f6f6f',
    fontSize: 9,
    fontWeight: '700',
  },
  commentAuthor: {
    color: '#b5b5b5',
    fontSize: 12,
    fontWeight: '600',
  },
  commentTime: {
    color: '#3e3e3e',
    fontSize: 11,
  },
  commentContent: {
    color: '#b5b5b5',
    fontSize: 13,
    lineHeight: 18,
    paddingLeft: 26,
  },
  noComments: {
    color: '#3e3e3e',
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 20,
  },

  // Comment input
  commentInput: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#1a1a1a',
    padding: 12,
    backgroundColor: '#0a0a0a',
  },
  commentField: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    borderWidth: 1,
    borderColor: '#1a1a1a',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: '#e8e8e8',
    fontSize: 13,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  commentSend: {
    backgroundColor: '#6366f1',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'opacity 0.15s' } as any : {}),
  },
  commentSendText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },

  // Attach button
  attachBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#1a1a1a',
    justifyContent: 'center',
    alignItems: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'background 0.15s' } as any : {}),
  },
  attachBtnText: {
    fontSize: 16,
  },

  // Pending attachment previews
  pendingAttachments: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 4,
    backgroundColor: '#0a0a0a',
    borderTopWidth: 1,
    borderTopColor: '#1a1a1a',
  },
  pendingAttItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 8,
    maxWidth: 180,
  },
  pendingAttThumb: {
    width: 24,
    height: 24,
    borderRadius: 4,
  },
  pendingAttFileBadge: {
    width: 24,
    height: 24,
    borderRadius: 4,
    backgroundColor: '#0a0a0a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pendingAttFileIcon: {
    fontSize: 10,
    color: '#6f6f6f',
  },
  pendingAttName: {
    color: '#9e9e9e',
    fontSize: 11,
    flex: 1,
  },
  pendingAttRemove: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#ffffff10',
    justifyContent: 'center',
    alignItems: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  pendingAttRemoveText: {
    color: '#9e9e9e',
    fontSize: 10,
    fontWeight: '700',
  },

  // Comment attachment rendering
  commentAttachments: {
    paddingLeft: 26,
    marginTop: 8,
    gap: 6,
  },
  commentAttImage: {
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#1a1a1a',
  },
  commentAttImageImg: {
    width: '100%' as any,
    height: 140,
    borderRadius: 8,
  },
  commentAttImageName: {
    color: '#6f6f6f',
    fontSize: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  commentAttCode: {
    backgroundColor: '#0a0a0a',
    borderWidth: 1,
    borderColor: '#1a1a1a',
    borderRadius: 8,
    overflow: 'hidden',
  },
  commentAttCodeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#0a0a0a',
  },
  commentAttCodeLang: {
    color: '#9e9e9e',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase' as any,
    letterSpacing: 0.5,
  },
  commentAttCodeName: {
    color: '#6f6f6f',
    fontSize: 10,
  },
  commentAttFile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    alignSelf: 'flex-start',
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'background 0.15s' } as any : {}),
  },
  commentAttFileIcon: {
    fontSize: 12,
  },
  commentAttFileName: {
    color: '#b5b5b5',
    fontSize: 12,
    fontWeight: '500',
  },
  commentAttFileSize: {
    color: '#6f6f6f',
    fontSize: 10,
  },
  ownershipPanel: {
    gap: 10,
    marginBottom: 6,
  },
  ownershipRow: {
    backgroundColor: '#0f1014',
    borderWidth: 1,
    borderColor: '#1b1d24',
    borderRadius: 12,
    padding: 12,
    gap: 6,
  },
  ownershipHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  ownershipAgent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  ownershipAgentName: {
    color: '#e8e8e8',
    fontSize: 13,
    fontWeight: '700',
  },
  ownershipAgentMeta: {
    color: '#6f6f6f',
    fontSize: 11,
    textTransform: 'uppercase' as any,
    letterSpacing: 0.6,
  },
  ownershipBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  ownershipBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  ownershipSummary: {
    color: '#cfcfcf',
    fontSize: 12,
    lineHeight: 17,
  },
  ownershipDetail: {
    color: '#9e9e9e',
    fontSize: 11,
    lineHeight: 16,
  },
  ownershipHint: {
    color: '#6f6f6f',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 2,
  },
  marketplaceGuidanceCard: {
    backgroundColor: '#0f1014',
    borderWidth: 1,
    borderColor: '#1b1d24',
    borderRadius: 12,
    padding: 12,
    gap: 10,
  },
  marketplaceGuidanceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  marketplaceGuidanceChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  marketplaceGuidanceChipInstalled: {
    backgroundColor: '#102115',
    borderColor: '#1d6b3a',
  },
  marketplaceGuidanceChipMissing: {
    backgroundColor: '#161921',
    borderColor: '#293140',
  },
  marketplaceGuidanceChipText: {
    color: '#cbd5e1',
    fontSize: 11,
    fontWeight: '700',
  },
  marketplaceGuidanceChipTextInstalled: {
    color: '#86efac',
  },
  marketplaceGuidanceText: {
    color: '#7d8798',
    fontSize: 11,
    lineHeight: 16,
  },
  marketplaceGuidanceFooter: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  marketplaceOpenBtn: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#2d3f5e',
    backgroundColor: '#111827',
    paddingHorizontal: 10,
    paddingVertical: 6,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  marketplaceOpenBtnText: {
    color: '#93c5fd',
    fontSize: 11,
    fontWeight: '700',
  },
});
