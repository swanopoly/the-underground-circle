// Advanced Chat Commands - Full collaboration features
import { OfficeAgent } from './officeAgents';
import { AgentConnection, PROVIDER_META } from './connectionManager';
import { OpenClawConfig } from './openclawService';
import { Project, loadProjects } from './projectManagement';
import {
  createTask, updateTask, assignTaskToAgent, completeTask, blockTask,
  loadTasks, getAgentTasks, getProjectTasks, getBlockedTasks, getTaskUpdates,
  createConversation, addMessageToConversation, getActiveConversations,
  requestAgentHelp, respondToCoordination, getCoordinationRequests,
  sendContextualMessage, relayMessageBetweenAgents,
  calculateAgentAvailability, suggestAgentForTask, getProjectStatus,
  Task, Conversation, CoordinationRequest, MessageContext,
} from './agentCollaboration';

export interface AdvancedCommandResult {
  response: string;
  success: boolean;
  data?: {
    tasks?: Task[];
    conversations?: Conversation[];
    coordinationRequests?: CoordinationRequest[];
  };
}

/**
 * Process all advanced collaboration commands
 */
export async function processAdvancedCommands(
  command: string,
  agents: OfficeAgent[],
  connections: AgentConnection[],
  getConfig: (id: string) => OpenClawConfig | null,
): Promise<AdvancedCommandResult | null> {
  const cmd = command.toLowerCase().trim();
  const parts = command.trim().split(' ');

  // ─── TASK MANAGEMENT ───────────────────────────────────

  if (cmd.startsWith('task create ') || cmd.startsWith('create task ')) {
    // task create [projectId] [title] | [description]
    const args = command.slice(cmd.startsWith('task create ') ? 12 : 12).trim();
    const [projectPart, rest] = args.split(' ', 2);
    
    if (!rest) {
      return { response: '❌ Usage: task create [projectId] [title] | [description]', success: false };
    }

    const [title, description] = rest.split('|').map(s => s.trim());
    if (!title) {
      return { response: '❌ Usage: task create [projectId] [title] | [description]', success: false };
    }

    const projects = await loadProjects();
    const project = projects.find(p => p.id === projectPart);
    if (!project) {
      return { response: `❌ Project "${projectPart}" not found`, success: false };
    }

    const task = await createTask(project.id, title, description || title, project.agentIds);
    
    return {
      response: `✅ Task "${task.title}" created!\nID: ${task.id}\nAssigned to: ${project.agentIds.length} agent(s)\nPriority: ${task.priority}`,
      success: true,
      data: { tasks: [task] },
    };
  }

  if (cmd.startsWith('task assign ')) {
    // task assign [taskId] @agent
    const args = command.slice(12).trim();
    const [taskId, agentPart] = args.split('@').map(s => s.trim());
    
    if (!taskId || !agentPart) {
      return { response: '❌ Usage: task assign [taskId] @agentName', success: false };
    }

    const agent = agents.find(a => a.name.toLowerCase().includes(agentPart.toLowerCase()));
    if (!agent) {
      return { response: `❌ Agent "${agentPart}" not found`, success: false };
    }

    const success = await assignTaskToAgent(taskId, agent.id);
    if (!success) {
      return { response: `❌ Task "${taskId}" not found`, success: false };
    }

    // Notify the agent
    const config = getConfig(agent.connectionId);
    if (config) {
      const sessionKey = agent.id.includes('::') ? agent.id.split('::')[1] : agent.id;
      const tasks = await loadTasks();
      const task = tasks.find(t => t.id === taskId);
      
      if (task) {
        await sendContextualMessage(
          config,
          sessionKey,
          `You've been assigned a new task: "${task.title}"\n\n${task.description}\n\nPriority: ${task.priority}\nStatus: ${task.status}`,
          { taskId: task.id, projectId: task.projectId },
          agents,
          await loadProjects()
        );
      }
    }

    return {
      response: `✅ Task ${taskId} assigned to ${agent.name}\n📨 Notification sent to agent`,
      success: true,
    };
  }

  if (cmd.startsWith('task complete ')) {
    // task complete [taskId]
    const taskId = command.slice(14).trim();
    const task = await completeTask(taskId, 'user');
    
    if (!task) {
      return { response: `❌ Task "${taskId}" not found`, success: false };
    }

    return {
      response: `✅ Task "${task.title}" marked as completed! 🎉`,
      success: true,
      data: { tasks: [task] },
    };
  }

  if (cmd.startsWith('task block ')) {
    // task block [taskId] [reason]
    const args = command.slice(11).trim();
    const firstSpace = args.indexOf(' ');
    
    if (firstSpace === -1) {
      return { response: '❌ Usage: task block [taskId] [reason]', success: false };
    }

    const taskId = args.slice(0, firstSpace);
    const reason = args.slice(firstSpace + 1);

    const task = await blockTask(taskId, 'user', reason);
    if (!task) {
      return { response: `❌ Task "${taskId}" not found`, success: false };
    }

    return {
      response: `⚠️ Task "${task.title}" blocked\nReason: ${reason}`,
      success: true,
      data: { tasks: [task] },
    };
  }

  if (cmd === 'tasks' || cmd === 'task list') {
    const tasks = await loadTasks();
    
    if (tasks.length === 0) {
      return {
        response: '📋 No tasks yet.\n\nCreate one: task create [projectId] [title] | [description]',
        success: true,
        data: { tasks: [] },
      };
    }

    const byStatus = {
      'pending': tasks.filter(t => t.status === 'pending'),
      'in-progress': tasks.filter(t => t.status === 'in-progress'),
      'blocked': tasks.filter(t => t.status === 'blocked'),
      'completed': tasks.filter(t => t.status === 'completed'),
    };

    const lines: string[] = [];
    Object.entries(byStatus).forEach(([status, statusTasks]) => {
      if (statusTasks.length > 0) {
        const icon = status === 'completed' ? '✅' : status === 'blocked' ? '⚠️' : status === 'in-progress' ? '🔄' : '📋';
        lines.push(`\n${icon} ${status.toUpperCase()} (${statusTasks.length})`);
        statusTasks.forEach(t => {
          lines.push(`  • ${t.title} [${t.id}]`);
          lines.push(`    Priority: ${t.priority} | Progress: ${t.progress}% | Assigned: ${t.assignedTo.length}`);
        });
      }
    });

    return {
      response: `📋 Tasks Overview\n${lines.join('\n')}`,
      success: true,
      data: { tasks },
    };
  }

  if (cmd.startsWith('task status ')) {
    // task status [taskId]
    const taskId = command.slice(12).trim();
    const tasks = await loadTasks();
    const task = tasks.find(t => t.id === taskId);

    if (!task) {
      return { response: `❌ Task "${taskId}" not found`, success: false };
    }

    const assignedAgents = agents.filter(a => task.assignedTo.includes(a.id));
    const updates = await getTaskUpdates(taskId);
    const recentUpdates = updates.slice(-5);

    let response = `📋 Task: ${task.title}\n` +
      `Status: ${task.status} | Priority: ${task.priority}\n` +
      `Progress: ${task.progress}%\n` +
      `Assigned to: ${assignedAgents.map(a => a.name).join(', ')}\n`;

    if (task.blockedReason) {
      response += `\n⚠️ Blocked: ${task.blockedReason}`;
    }

    if (recentUpdates.length > 0) {
      response += `\n\nRecent Updates:\n`;
      recentUpdates.forEach(u => {
        const agent = agents.find(a => a.id === u.agentId);
        response += `• ${agent?.name || 'Agent'}: ${u.message}\n`;
      });
    }

    return {
      response,
      success: true,
      data: { tasks: [task] },
    };
  }

  if (cmd.startsWith('tasks @')) {
    // tasks @agent - show agent's tasks
    const agentName = command.slice(7).trim().toLowerCase();
    const agent = agents.find(a => a.name.toLowerCase().includes(agentName));

    if (!agent) {
      return { response: `❌ Agent "${agentName}" not found`, success: false };
    }

    const tasks = await loadTasks();
    const agentTasks = getAgentTasks(agent.id, tasks);

    if (agentTasks.length === 0) {
      return {
        response: `📋 ${agent.name} has no tasks assigned`,
        success: true,
        data: { tasks: [] },
      };
    }

    const lines = agentTasks.map(t => {
      const icon = t.status === 'completed' ? '✅' : t.status === 'blocked' ? '⚠️' : t.status === 'in-progress' ? '🔄' : '📋';
      return `${icon} ${t.title} [${t.status}] - ${t.progress}%`;
    });

    return {
      response: `📋 ${agent.name}'s Tasks (${agentTasks.length})\n\n${lines.join('\n')}`,
      success: true,
      data: { tasks: agentTasks },
    };
  }

  // ─── CONVERSATION MANAGEMENT ───────────────────────────

  if (cmd.startsWith('convo start ') || cmd.startsWith('conversation start ')) {
    // convo start @agent1 @agent2 about [subject]
    const args = command.slice(cmd.startsWith('convo start ') ? 12 : 19).trim();
    const matches = args.match(/@(\w+)/g);
    
    if (!matches || matches.length === 0) {
      return { response: '❌ Usage: convo start @agent1 @agent2 about [subject]', success: false };
    }

    const agentNames = matches.map(m => m.slice(1).toLowerCase());
    const participantAgents = agents.filter(a => 
      agentNames.some(name => a.name.toLowerCase().includes(name))
    );

    if (participantAgents.length === 0) {
      return { response: `❌ No agents found matching: ${agentNames.join(', ')}`, success: false };
    }

    const aboutIndex = args.toLowerCase().indexOf('about ');
    const subject = aboutIndex !== -1 ? args.slice(aboutIndex + 6).trim() : 'General Discussion';

    const participants = ['user', ...participantAgents.map(a => a.id)];
    const conv = createConversation(subject, participants);

    return {
      response: `💬 Conversation started: "${subject}"\nParticipants: You, ${participantAgents.map(a => a.name).join(', ')}\nID: ${conv.id}\n\nUse: convo ${conv.id} [message] to chat`,
      success: true,
      data: { conversations: [conv] },
    };
  }

  if (cmd.startsWith('convo ') && !cmd.startsWith('convo start')) {
    // convo [id] [message]
    const args = command.slice(6).trim();
    const firstSpace = args.indexOf(' ');

    if (firstSpace === -1) {
      return { response: '❌ Usage: convo [id] [message]', success: false };
    }

    const convId = args.slice(0, firstSpace);
    const message = args.slice(firstSpace + 1);

    const msg = addMessageToConversation(convId, 'user', message);
    if (!msg) {
      return { response: `❌ Conversation "${convId}" not found`, success: false };
    }

    // Send to all participants except user
    const convs = getActiveConversations();
    const conv = convs.find(c => c.id === convId);
    if (!conv) {
      return { response: `❌ Conversation not found`, success: false };
    }

    const participantAgents = agents.filter(a => conv.participants.includes(a.id));
    const deliveredTo: string[] = [];

    for (const agent of participantAgents) {
      const config = getConfig(agent.connectionId);
      if (config) {
        const sessionKey = agent.id.includes('::') ? agent.id.split('::')[1] : agent.id;
        const context: MessageContext = {
          conversationId: convId,
          mentions: conv.participants.filter(p => p !== 'user' && p !== agent.id),
        };
        
        const result = await sendContextualMessage(
          config,
          sessionKey,
          message,
          context,
          agents,
          await loadProjects()
        );
        
        if (result.ok) {
          deliveredTo.push(agent.name);
        }
      }
    }

    return {
      response: `💬 Message sent to conversation\nDelivered to: ${deliveredTo.join(', ')}`,
      success: true,
    };
  }

  if (cmd === 'conversations' || cmd === 'convos') {
    const convs = getActiveConversations();
    
    if (convs.length === 0) {
      return {
        response: '💬 No active conversations\n\nStart one: convo start @agent about [subject]',
        success: true,
        data: { conversations: [] },
      };
    }

    const lines = convs.map(c => {
      const participantAgents = agents.filter(a => c.participants.includes(a.id));
      return `💬 ${c.subject} [${c.id}]\n  Participants: ${participantAgents.map(a => a.name).join(', ')}\n  Messages: ${c.messages.length}`;
    });

    return {
      response: `💬 Active Conversations\n\n${lines.join('\n\n')}`,
      success: true,
      data: { conversations: convs },
    };
  }

  // ─── AGENT COORDINATION ────────────────────────────────

  if (cmd.startsWith('relay ')) {
    // relay @from @to [message] - Agent-to-agent message
    const args = command.slice(6).trim();
    const matches = args.match(/@(\w+)/g);

    if (!matches || matches.length < 2) {
      return { response: '❌ Usage: relay @fromAgent @toAgent [message]', success: false };
    }

    const fromName = matches[0].slice(1).toLowerCase();
    const toName = matches[1].slice(1).toLowerCase();

    const fromAgent = agents.find(a => a.name.toLowerCase().includes(fromName));
    const toAgent = agents.find(a => a.name.toLowerCase().includes(toName));

    if (!fromAgent || !toAgent) {
      return { response: `❌ Agents not found`, success: false };
    }

    const messageStart = args.indexOf(matches[1]) + matches[1].length;
    const message = args.slice(messageStart).trim();

    if (!message) {
      return { response: '❌ Please provide a message', success: false };
    }

    const result = await relayMessageBetweenAgents(fromAgent, toAgent, message, getConfig);

    if (result.ok) {
      return {
        response: `📨 Message relayed from ${fromAgent.name} to ${toAgent.name}`,
        success: true,
      };
    } else {
      return {
        response: `❌ Failed to relay: ${result.error}`,
        success: false,
      };
    }
  }

  if (cmd.startsWith('help ') || cmd.startsWith('ask help ')) {
    // help @agent1 from @agent2 [request]
    const args = command.slice(cmd.startsWith('help ') ? 5 : 9).trim();
    const matches = args.match(/@(\w+)/g);

    if (!matches || matches.length < 2) {
      return { response: '❌ Usage: help @toAgent from @fromAgent [request]', success: false };
    }

    const toName = matches[0].slice(1).toLowerCase();
    const fromName = matches[1].slice(1).toLowerCase();

    const toAgent = agents.find(a => a.name.toLowerCase().includes(toName));
    const fromAgent = agents.find(a => a.name.toLowerCase().includes(fromName));

    if (!toAgent || !fromAgent) {
      return { response: `❌ Agents not found`, success: false };
    }

    const projects = await loadProjects();
    const sharedProjects = projects.filter(p => 
      p.agentIds.includes(fromAgent.id) && p.agentIds.includes(toAgent.id)
    );

    if (sharedProjects.length === 0) {
      return { response: `⚠️ ${fromAgent.name} and ${toAgent.name} don't share any projects`, success: false };
    }

    const messageStart = args.indexOf(matches[1]) + matches[1].length;
    const request = args.slice(messageStart).trim();

    if (!request) {
      return { response: '❌ Please describe what help is needed', success: false };
    }

    const coordReq = requestAgentHelp(fromAgent.id, toAgent.id, sharedProjects[0].id, request);

    // Notify the agent being asked for help
    const config = getConfig(toAgent.connectionId);
    if (config) {
      const sessionKey = toAgent.id.includes('::') ? toAgent.id.split('::')[1] : toAgent.id;
      await sendContextualMessage(
        config,
        sessionKey,
        `${fromAgent.name} needs your help:\n\n${request}\n\nProject: ${sharedProjects[0].name}`,
        { projectId: sharedProjects[0].id },
        agents,
        projects
      );
    }

    return {
      response: `🆘 Help request sent from ${fromAgent.name} to ${toAgent.name}\nProject: ${sharedProjects[0].name}\nRequest ID: ${coordReq.id}`,
      success: true,
      data: { coordinationRequests: [coordReq] },
    };
  }

  if (cmd === 'requests' || cmd === 'help requests') {
    const reqs = getCoordinationRequests('user'); // Show all pending

    if (reqs.length === 0) {
      return {
        response: '🆘 No pending coordination requests',
        success: true,
        data: { coordinationRequests: [] },
      };
    }

    const lines = reqs.map(r => {
      const fromAgent = agents.find(a => a.id === r.from);
      const toAgent = agents.find(a => a.id === r.to);
      return `🆘 ${fromAgent?.name || 'Agent'} → ${toAgent?.name || 'Agent'}\n  ${r.request}\n  Status: ${r.status}`;
    });

    return {
      response: `🆘 Coordination Requests\n\n${lines.join('\n\n')}`,
      success: true,
      data: { coordinationRequests: reqs },
    };
  }

  // ─── SMART ASSIGNMENT ──────────────────────────────────

  if (cmd.startsWith('suggest ')) {
    // suggest [taskId] - Suggest best agent for task
    const taskId = command.slice(8).trim();
    const tasks = await loadTasks();
    const task = tasks.find(t => t.id === taskId);

    if (!task) {
      return { response: `❌ Task "${taskId}" not found`, success: false };
    }

    const projects = await loadProjects();
    const project = projects.find(p => p.id === task.projectId);

    if (!project) {
      return { response: `❌ Project not found for task`, success: false };
    }

    const suggestions = suggestAgentForTask(task, agents, tasks, project);

    if (suggestions.length === 0) {
      return { response: `❌ No agents available on project ${project.name}`, success: false };
    }

    const lines = suggestions.slice(0, 3).map((agent, i) => {
      const availability = calculateAgentAvailability(agent, tasks);
      const rank = i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉';
      return `${rank} ${agent.name}\n  Status: ${agent.status} | Availability: ${availability.toFixed(0)}% | Cost: $${agent.costToday.toFixed(2)}/day`;
    });

    return {
      response: `🎯 Best agents for "${task.title}":\n\n${lines.join('\n\n')}\n\nUse: task assign ${taskId} @${suggestions[0].name}`,
      success: true,
    };
  }

  if (cmd.startsWith('project status ')) {
    // project status [projectId]
    const projectId = command.slice(15).trim();
    const projects = await loadProjects();
    const project = projects.find(p => p.id === projectId);

    if (!project) {
      return { response: `❌ Project "${projectId}" not found`, success: false };
    }

    const tasks = await loadTasks();
    const status = await getProjectStatus(projectId, project, agents, tasks);

    const progress = status.totalTasks > 0 
      ? ((status.completedTasks / status.totalTasks) * 100).toFixed(0)
      : '0';

    let response = `📊 Project: ${status.projectName}\n\n` +
      `Tasks: ${status.completedTasks}/${status.totalTasks} completed (${progress}%)\n` +
      `In Progress: ${status.inProgressTasks} | Blocked: ${status.blockedTasks}\n` +
      `\nTeam: ${status.agentCount} agents\n` +
      `Active: ${status.activeAgents.join(', ') || 'none'}\n` +
      `Idle: ${status.idleAgents.join(', ') || 'none'}\n` +
      `\nTotal Cost: $${status.totalCost.toFixed(2)}/day`;

    if (status.recentActivity.length > 0) {
      response += `\n\nRecent Activity:\n${status.recentActivity.map(a => `• ${a}`).join('\n')}`;
    }

    return {
      response,
      success: true,
    };
  }

  // Not an advanced command
  return null;
}

/**
 * Get help text for advanced commands
 */
export function getAdvancedHelp(): string {
  return `ADVANCED COLLABORATION:\n\n` +
    `TASKS:\n` +
    `• task create [projectId] [title] | [desc] — Create task\n` +
    `• task assign [id] @agent — Assign task\n` +
    `• task complete [id] — Mark complete\n` +
    `• task block [id] [reason] — Block task\n` +
    `• task status [id] — Detailed task info\n` +
    `• tasks — List all tasks\n` +
    `• tasks @agent — Agent's tasks\n` +
    `• suggest [taskId] — Best agent for task\n` +
    `\n` +
    `CONVERSATIONS:\n` +
    `• convo start @agent1 @agent2 about [subject] — Start group chat\n` +
    `• convo [id] [message] — Send to conversation\n` +
    `• conversations — List active\n` +
    `\n` +
    `COORDINATION:\n` +
    `• relay @from @to [message] — Agent-to-agent message\n` +
    `• help @agent from @agent [request] — Request help\n` +
    `• requests — Pending help requests\n` +
    `\n` +
    `PROJECT INSIGHTS:\n` +
    `• project status [id] — Full project overview`;
}
