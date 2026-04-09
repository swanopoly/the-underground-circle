// Office Action Panel - Quick collaboration buttons
import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Modal, TextInput, Pressable, Platform } from 'react-native';
import PixelButton from './PixelButton';
import { OfficeAgent } from '../lib/officeAgents';
import { Project, loadProjects } from '../lib/projectManagement';
import { OpenSwanConfig } from '../lib/openswanService';
import {
  createConversation, addMessageToConversation, getActiveConversations,
  sendContextualMessage, broadcastMessage, loadTasks, getProjectTasks,
  getBlockedTasks, createTask, suggestAgentForTask, assignTaskToAgent,
  getProjectStatus,
} from '../lib/agentCollaboration';
import { addConversationMessage } from '../lib/conversationLog';

interface Props {
  agents: OfficeAgent[];
  getConfig: (connectionId: string) => OpenSwanConfig | null;
  onResult: (message: string) => void;
  compact?: boolean; // Use smaller button sizes
}

type ActionType = 'standup' | 'sync' | 'assign' | 'chat' | 'broadcast' | 'help' | 'status';

export default function OfficeActionPanel({ agents, getConfig, onResult, compact = false }: Props) {
  const [showModal, setShowModal] = useState(false);
  const [currentAction, setCurrentAction] = useState<ActionType | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const activeAgents = agents.filter(a => a.status === 'active' || a.status === 'idle');
  const hasAgents = activeAgents.length > 0;
  const blockedTasksCount = 0; // Will be calculated when needed
  const buttonSize = compact ? 'small' : 'medium';

  const handleAction = async (action: ActionType) => {
    if (!hasAgents) {
      onResult('❌ No agents available. Connect agents first!');
      return;
    }

    setCurrentAction(action);

    // Actions that don't need modal
    if (action === 'status') {
      await executeStatusCheck();
      return;
    }

    // Actions that need input
    setShowModal(true);
  };

  const executeAction = async () => {
    if (!currentAction) return;

    setLoading(true);
    
    try {
      switch (currentAction) {
        case 'standup':
          await executeDailyStandup();
          break;
        case 'sync':
          await executeProjectSync();
          break;
        case 'assign':
          await executeQuickAssign();
          break;
        case 'chat':
          await executeTeamChat();
          break;
        case 'broadcast':
          await executeBroadcast();
          break;
        case 'help':
          await executeHelpCoordination();
          break;
      }
    } catch (error: any) {
      onResult(`❌ Error: ${error.message}`);
    } finally {
      setLoading(false);
      setShowModal(false);
      setInputValue('');
      setSelectedProject('');
    }
  };

  // ─── Action Executors ──────────────────────────────────

  const executeDailyStandup = async () => {
    const conv = createConversation('Daily Standup', ['user', ...activeAgents.map(a => a.id)]);
    
    const standupMsg = `🌅 Daily Standup!\n\n` +
      `Quick check-in:\n` +
      `1. What did you work on?\n` +
      `2. What are you working on today?\n` +
      `3. Any blockers?\n\n` +
      `Team: ${activeAgents.map(a => a.name).join(', ')}`;

    addMessageToConversation(conv.id, 'user', standupMsg);

    // Send to all agents and log conversations
    const deliveredTo: string[] = [];
    for (const agent of activeAgents) {
      const config = getConfig(agent.connectionId);
      if (config) {
        const sessionKey = agent.id.includes('::') ? agent.id.split('::')[1] : agent.id;
        const result = await sendContextualMessage(
          config,
          sessionKey,
          standupMsg,
          { conversationId: conv.id },
          agents,
          []
        );
        if (result.ok) {
          deliveredTo.push(agent.name);
          // Log outgoing message
          await addConversationMessage({
            direction: 'outgoing',
            agentId: agent.id,
            agentName: agent.name,
            agentColor: agent.color,
            message: standupMsg,
            actionType: 'standup',
            conversationId: conv.id,
            sessionKey,
          });
        }
      }
    }

    onResult(`🌅 Daily Standup Started!\nConversation: ${conv.id}\nDelivered to: ${deliveredTo.join(', ')}\n\nTip: Type "log" in terminal to see conversations`);
  };

  const executeProjectSync = async () => {
    const projects = await loadProjects();
    const project = projects.find(p => p.id === selectedProject);
    
    if (!project) {
      onResult('❌ Project not found');
      return;
    }

    const tasks = await loadTasks();
    const status = await getProjectStatus(selectedProject, project, agents, tasks);

    const syncMsg = `📊 Project Sync: ${project.name}\n\n` +
      `Tasks: ${status.completedTasks}/${status.totalTasks} complete\n` +
      `In Progress: ${status.inProgressTasks}\n` +
      `Blocked: ${status.blockedTasks}\n` +
      `Active Team: ${status.activeAgents.join(', ')}\n` +
      `Cost: $${status.totalCost.toFixed(2)}/day\n\n` +
      `Let's sync up on priorities and next steps!`;

    const projectAgents = activeAgents.filter(a => project.agentIds.includes(a.id));
    const deliveredTo: string[] = [];

    for (const agent of projectAgents) {
      const config = getConfig(agent.connectionId);
      if (config) {
        const sessionKey = agent.id.includes('::') ? agent.id.split('::')[1] : agent.id;
        const result = await sendContextualMessage(
          config,
          sessionKey,
          syncMsg,
          { projectId: project.id },
          agents,
          projects
        );
        if (result.ok) {
          deliveredTo.push(agent.name);
          // Log outgoing message
          await addConversationMessage({
            direction: 'outgoing',
            agentId: agent.id,
            agentName: agent.name,
            agentColor: agent.color,
            message: syncMsg,
            actionType: 'sync',
            sessionKey,
          });
        }
      }
    }

    onResult(`📊 Project synced to team!\nDelivered to: ${deliveredTo.join(', ')}\n\nType "log" to view conversations`);
  };

  const executeQuickAssign = async () => {
    const tasks = await loadTasks();
    const projects = await loadProjects();
    
    const unassignedTasks = tasks.filter(t => t.status === 'pending' && t.assignedTo.length === 0);
    
    if (unassignedTasks.length === 0) {
      onResult('✅ No unassigned tasks found!');
      return;
    }

    const assigned: string[] = [];

    for (const task of unassignedTasks.slice(0, 5)) { // Assign up to 5 tasks
      const project = projects.find(p => p.id === task.projectId);
      if (!project) continue;

      const suggestions = suggestAgentForTask(task, agents, tasks, project);
      if (suggestions.length > 0) {
        const bestAgent = suggestions[0];
        await assignTaskToAgent(task.id, bestAgent.id);
        
        const assignMsg = `New task assigned: "${task.title}"\n\n${task.description}\n\nPriority: ${task.priority}`;
        
        // Notify agent and log
        const config = getConfig(bestAgent.connectionId);
        if (config) {
          const sessionKey = bestAgent.id.includes('::') ? bestAgent.id.split('::')[1] : bestAgent.id;
          await sendContextualMessage(
            config,
            sessionKey,
            assignMsg,
            { taskId: task.id, projectId: task.projectId },
            agents,
            projects
          );
          
          // Log outgoing message
          await addConversationMessage({
            direction: 'outgoing',
            agentId: bestAgent.id,
            agentName: bestAgent.name,
            agentColor: bestAgent.color,
            message: assignMsg,
            actionType: 'assign',
            sessionKey,
          });
        }
        
        assigned.push(`${task.title} → ${bestAgent.name}`);
      }
    }

    onResult(`🎯 Quick Assign Complete!\n\n${assigned.join('\n')}\n\nType "log" to see agent conversations`);
  };

  const executeTeamChat = async () => {
    if (!inputValue.trim()) {
      onResult('❌ Please enter a subject');
      return;
    }

    const conv = createConversation(inputValue, ['user', ...activeAgents.map(a => a.id)]);
    
    onResult(`💬 Team Chat Started: "${inputValue}"\nID: ${conv.id}\nParticipants: ${activeAgents.map(a => a.name).join(', ')}\n\nUse "convo ${conv.id} [message]" to chat`);
  };

  const executeBroadcast = async () => {
    if (!inputValue.trim()) {
      onResult('❌ Please enter a message');
      return;
    }

    // Log to each agent before sending
    for (const agent of activeAgents) {
      await addConversationMessage({
        direction: 'outgoing',
        agentId: agent.id,
        agentName: agent.name,
        agentColor: agent.color,
        message: inputValue,
        actionType: 'broadcast',
      });
    }

    const result = await broadcastMessage(activeAgents, getConfig, inputValue);
    
    if (result.ok) {
      onResult(`📢 Broadcast sent to ${result.deliveredTo?.length || 0} agents!\n\n"${inputValue}"\n\nType "log" to see conversations`);
    } else {
      onResult(`❌ Broadcast failed: ${result.error}`);
    }
  };

  const executeHelpCoordination = async () => {
    const tasks = await loadTasks();
    const blockedTasks = getBlockedTasks(tasks);

    if (blockedTasks.length === 0) {
      onResult('✅ No blocked tasks - team is flowing!');
      return;
    }

    const helpMsg = `🆘 Help Coordination\n\n` +
      `We have ${blockedTasks.length} blocked task${blockedTasks.length !== 1 ? 's' : ''} that need attention:\n\n` +
      blockedTasks.slice(0, 3).map(t => `• ${t.title}\n  Reason: ${t.blockedReason || 'Unknown'}`).join('\n\n') +
      `\n\nWho can help unblock these?`;

    // Log to each agent
    for (const agent of activeAgents) {
      await addConversationMessage({
        direction: 'outgoing',
        agentId: agent.id,
        agentName: agent.name,
        agentColor: agent.color,
        message: helpMsg,
        actionType: 'help',
      });
    }

    const result = await broadcastMessage(activeAgents, getConfig, helpMsg);

    if (result.ok) {
      onResult(`🆘 Help request sent!\n${blockedTasks.length} blocked tasks need team support\n\nType "log" to track responses`);
    } else {
      onResult(`❌ Failed to coordinate: ${result.error}`);
    }
  };

  const executeStatusCheck = async () => {
    setLoading(true);
    
    const statusLines = activeAgents.map(a => {
      const statusIcon = a.status === 'active' ? '🟢' : '🟡';
      return `${statusIcon} ${a.name}: ${a.status} | $${a.costToday.toFixed(2)}/day`;
    });

    const totalCost = activeAgents.reduce((sum, a) => sum + a.costToday, 0);

    onResult(
      `📊 Team Status Check\n\n` +
      `${statusLines.join('\n')}\n\n` +
      `Total: ${activeAgents.length} agents active\n` +
      `Cost: $${totalCost.toFixed(2)}/day`
    );
    
    setLoading(false);
  };

  // ─── Render ────────────────────────────────────────────

  const renderModalContent = () => {
    switch (currentAction) {
      case 'sync':
        return (
          <View>
            <Text style={styles.modalTitle}>📊 Sync Project</Text>
            <Text style={styles.modalDesc}>Select a project to sync with the team</Text>
            <ProjectSelector onSelect={setSelectedProject} selected={selectedProject} />
          </View>
        );
      
      case 'chat':
        return (
          <View>
            <Text style={styles.modalTitle}>💬 Start Team Chat</Text>
            <Text style={styles.modalDesc}>What's the conversation about?</Text>
            <TextInput
              style={styles.input}
              value={inputValue}
              onChangeText={setInputValue}
              placeholder="e.g., Homepage Redesign"
              placeholderTextColor="#6f6f6f"
              autoFocus
            />
          </View>
        );
      
      case 'broadcast':
        return (
          <View>
            <Text style={styles.modalTitle}>📢 Broadcast Message</Text>
            <Text style={styles.modalDesc}>Send to all {activeAgents.length} active agents</Text>
            <TextInput
              style={[styles.input, { height: 80 }]}
              value={inputValue}
              onChangeText={setInputValue}
              placeholder="Your message..."
              placeholderTextColor="#6f6f6f"
              multiline
              autoFocus
            />
          </View>
        );
      
      default:
        return null;
    }
  };

  return (
    <>
      <View style={[styles.container, compact && styles.containerCompact]}>
        {!compact && <Text style={styles.title}>⚡ QUICK ACTIONS</Text>}
        
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.buttonRow}
        >
          <PixelButton
            icon="🌅"
            label="Standup"
            onPress={() => handleAction('standup')}
            color="#f59e0b"
            disabled={!hasAgents}
            size={buttonSize}
            tooltip="Start daily standup: ask all agents what they're working on and any blockers"
          />

          <PixelButton
            icon="📊"
            label="Sync"
            onPress={() => handleAction('sync')}
            color="#3b82f6"
            disabled={!hasAgents}
            size={buttonSize}
            tooltip="Sync project status with team: task progress, blockers, and cost breakdown"
          />

          <PixelButton
            icon="🎯"
            label="Assign"
            onPress={() => handleAction('assign')}
            color="#22c55e"
            disabled={!hasAgents}
            size={buttonSize}
            tooltip="Auto-assign unassigned tasks to best-fit agents based on workload and expertise"
          />

          <PixelButton
            icon="💬"
            label="Chat"
            onPress={() => handleAction('chat')}
            color="#6366f1"
            disabled={!hasAgents}
            size={buttonSize}
            tooltip="Start a new multi-agent conversation on a specific topic"
          />

          <PixelButton
            icon="📢"
            label="Broadcast"
            onPress={() => handleAction('broadcast')}
            color="#a855f7"
            disabled={!hasAgents}
            size={buttonSize}
            tooltip="Send an announcement or message to all active agents at once"
          />

          <PixelButton
            icon="🆘"
            label="Help"
            onPress={() => handleAction('help')}
            color="#ef4444"
            disabled={!hasAgents}
            badge={blockedTasksCount > 0 ? blockedTasksCount : undefined}
            size={buttonSize}
            tooltip="Coordinate help for blocked tasks: notify team of tasks that need support"
          />

          <PixelButton
            icon="📈"
            label="Status"
            onPress={() => handleAction('status')}
            color="#22d3ee"
            disabled={!hasAgents}
            size={buttonSize}
            tooltip="Quick status check: see all active agents, their status, and daily costs"
          />
        </ScrollView>
      </View>

      {/* Action Modal */}
      <Modal
        visible={showModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowModal(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setShowModal(false)}>
          <Pressable style={styles.modalContent} onPress={e => e.stopPropagation()}>
            {renderModalContent()}
            
            <View style={styles.modalButtons}>
              <Pressable
                onPress={executeAction}
                disabled={loading}
                style={[styles.modalButton, styles.modalButtonPrimary, loading && { opacity: 0.5 }]}
              >
                <Text style={styles.modalButtonText}>
                  {loading ? '⏳ EXECUTING...' : '✓ EXECUTE'}
                </Text>
              </Pressable>
              
              <Pressable
                onPress={() => setShowModal(false)}
                disabled={loading}
                style={[styles.modalButton, styles.modalButtonSecondary]}
              >
                <Text style={[styles.modalButtonText, { color: '#9e9e9e' }]}>✕ CANCEL</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

// ─── Project Selector Component ───────────────────────────

function ProjectSelector({ onSelect, selected }: { onSelect: (id: string) => void; selected: string }) {
  const [projects, setProjects] = React.useState<Project[]>([]);

  React.useEffect(() => {
    loadProjects().then(setProjects);
  }, []);

  return (
    <ScrollView style={styles.projectList}>
      {projects.map(p => (
        <Pressable
          key={p.id}
          onPress={() => onSelect(p.id)}
          style={[
            styles.projectItem,
            selected === p.id && styles.projectItemSelected,
            Platform.OS === 'web' && { cursor: 'pointer' } as any,
          ]}
        >
          <View style={[styles.projectDot, { backgroundColor: p.color }]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.projectName}>{p.name}</Text>
            <Text style={styles.projectDesc} numberOfLines={1}>{p.description}</Text>
          </View>
          {selected === p.id && <Text style={styles.projectCheck}>✓</Text>}
        </Pressable>
      ))}
      {projects.length === 0 && (
        <Text style={styles.emptyText}>No projects yet. Create one first!</Text>
      )}
    </ScrollView>
  );
}

// ─── Styles ────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#000000',
    borderTopWidth: 1,
    borderTopColor: '#2a2a2a',
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  containerCompact: {
    paddingVertical: 4,
    paddingHorizontal: 6,
    backgroundColor: 'transparent',
    borderTopWidth: 0,
  },
  title: {
    fontSize: 9,
    fontWeight: '800',
    color: '#9e9e9e',
    fontFamily: 'monospace',
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 8,
    paddingRight: 12,
  },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: '#00000080',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#0a0a0a',
    borderWidth: 2,
    borderColor: '#2a2a2a',
    borderRadius: 12,
    padding: 20,
    minWidth: 300,
    maxWidth: 500,
    gap: 12,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#e8e8e8',
    fontFamily: 'monospace',
    letterSpacing: 1,
  },
  modalDesc: {
    fontSize: 12,
    color: '#9e9e9e',
    fontFamily: 'monospace',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#2a2a2a',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 8,
    padding: 12,
    color: '#e8e8e8',
    fontFamily: 'monospace',
    fontSize: 13,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  modalButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 2,
  },
  modalButtonPrimary: {
    backgroundColor: '#6366f1',
    borderColor: '#4f46e5',
  },
  modalButtonSecondary: {
    backgroundColor: '#2a2a2a',
    borderColor: '#2a2a2a',
  },
  modalButtonText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#ffffff',
    fontFamily: 'monospace',
    letterSpacing: 1,
  },

  // Project selector
  projectList: {
    maxHeight: 200,
  },
  projectItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    backgroundColor: '#2a2a2a',
    borderRadius: 8,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  projectItemSelected: {
    borderColor: '#6366f1',
    backgroundColor: '#6366f115',
  },
  projectDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  projectName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#e8e8e8',
    fontFamily: 'monospace',
  },
  projectDesc: {
    fontSize: 10,
    color: '#6f6f6f',
    fontFamily: 'monospace',
  },
  projectCheck: {
    fontSize: 16,
    color: '#6366f1',
  },
  emptyText: {
    fontSize: 11,
    color: '#6f6f6f',
    fontFamily: 'monospace',
    textAlign: 'center',
    padding: 20,
  },
});
