// Enhanced Office Chat Commands - Multi-Agent Collaboration
import { getAgentIdentityKey } from './agentIdentity';
import { OfficeAgent } from './officeAgents';
import { AgentConnection } from './connectionManager';
import { OpenSwanConfig } from './openswanService';
import {
  Project, loadProjects, createProject,
  assignAgentToProject, unassignAgentFromProject, deleteProject,
  migrateLegacyProjectsToSupabase,
} from './projectManagement';
import {
  sendMessageToAgent, broadcastMessage, sendMessageToProject,
  addMessage as addAgentMessage,
} from './agentMessaging';
import { migrateLegacyTasksToSupabase } from './agentCollaboration';

export interface CommandResult {
  response: string;
  success: boolean;
  projects?: Project[]; // Updated projects list
}

/**
 * Process project and messaging commands
 */
export async function processCollaborationCommand(
  command: string,
  agents: OfficeAgent[],
  _connections: AgentConnection[],
  getConfig: (id: string) => OpenSwanConfig | null,
): Promise<CommandResult | null> {
  const cmd = command.toLowerCase().trim();

  // ─── PROJECT COMMANDS ──────────────────────────────────

  if (cmd.startsWith('project create ')) {
    // project create [name] [description]
    const args = command.slice(15).trim();
    const firstSpace = args.indexOf(' ');
    if (firstSpace === -1) {
      return { response: '❌ Usage: project create [name] [description]', success: false };
    }
    
    const name = args.slice(0, firstSpace);
    const description = args.slice(firstSpace + 1);
    
    const project = await createProject(name, description);
    return {
      response: `✅ Project "${project.name}" created!\nID: ${project.id}\n\nUse: project assign ${project.id} @agent`,
      success: true,
    };
  }

  if (cmd.startsWith('project assign ') || cmd.startsWith('project add ')) {
    // project assign [projectId] @agentName
    const args = command.slice(cmd.startsWith('project assign ') ? 15 : 12).trim();
    const [projectId, agentPart] = args.split('@').map(s => s.trim());
    
    if (!projectId || !agentPart) {
      return { response: '❌ Usage: project assign [projectId] @agentName', success: false };
    }
    
    const agent = agents.find(a => a.name.toLowerCase().includes(agentPart.toLowerCase()));
    if (!agent) {
      return { response: `❌ Agent "${agentPart}" not found. Available: ${agents.map(a => a.name).join(', ')}`, success: false };
    }
    
    await assignAgentToProject(projectId, agent.id);
    return {
      response: `✅ ${agent.name} assigned to project ${projectId}`,
      success: true,
    };
  }

  if (cmd.startsWith('project remove ') || cmd.startsWith('project unassign ')) {
    // project remove [projectId] @agentName
    const args = command.slice(cmd.startsWith('project remove ') ? 15 : 17).trim();
    const [projectId, agentPart] = args.split('@').map(s => s.trim());
    
    if (!projectId || !agentPart) {
      return { response: '❌ Usage: project remove [projectId] @agentName', success: false };
    }
    
    const agent = agents.find(a => a.name.toLowerCase().includes(agentPart.toLowerCase()));
    if (!agent) {
      return { response: `❌ Agent "${agentPart}" not found`, success: false };
    }
    
    await unassignAgentFromProject(projectId, agent.id);
    return {
      response: `✅ ${agent.name} removed from project ${projectId}`,
      success: true,
    };
  }

  if (cmd === 'projects' || cmd === 'project list') {
    const projects = await loadProjects();
    
    if (projects.length === 0) {
      return {
        response: '📁 No projects yet.\n\nCreate one: project create [name] [description]',
        success: true,
        projects,
      };
    }
    
    const lines = projects.map(p => {
      const assignedAgents = agents.filter(a => p.agentIds.includes(a.id));
      return `📁 ${p.name} (${p.id})\n   ${p.description}\n   Agents: ${assignedAgents.length > 0 ? assignedAgents.map(a => a.name).join(', ') : 'none assigned'}`;
    });
    
    return {
      response: `📁 Projects\n\n${lines.join('\n\n')}`,
      success: true,
      projects,
    };
  }

  if (cmd.startsWith('project delete ')) {
    const projectId = command.slice(15).trim();
    await deleteProject(projectId);
    return {
      response: `✅ Project ${projectId} deleted`,
      success: true,
    };
  }

  if (
    cmd === 'project migrate legacy'
    || cmd === 'projects migrate legacy'
    || cmd === 'migrate legacy'
  ) {
    try {
      const projectMappings = await migrateLegacyProjectsToSupabase();
      const taskMappings = await migrateLegacyTasksToSupabase(projectMappings);

      const projectPreview = projectMappings
        .slice(0, 5)
        .map(item => `   • ${item.name}: ${item.legacyId} → ${item.roomId}`)
        .join('\n');
      const taskPreview = taskMappings
        .slice(0, 5)
        .map(item => `   • ${item.title}: ${item.legacyTaskId} → ${item.taskId}`)
        .join('\n');

      const responseLines = [
        '✅ Legacy migration complete',
        '',
        `Projects migrated: ${projectMappings.length}`,
        `Tasks migrated: ${taskMappings.length}`,
      ];

      if (projectPreview) {
        responseLines.push('', 'Project mappings:', projectPreview);
      }

      if (taskPreview) {
        responseLines.push('', 'Task mappings:', taskPreview);
      }

      if (projectMappings.length === 0 && taskMappings.length === 0) {
        responseLines.push('', 'No legacy local projects or tasks needed migration.');
      } else {
        responseLines.push(
          '',
          'Migrated local data was archived, and any unmigrated task data remains in local storage for retry.',
        );
      }

      return {
        response: responseLines.join('\n'),
        success: true,
      };
    } catch (error: any) {
      return {
        response: `❌ Legacy migration failed: ${error?.message || 'Unknown error'}`,
        success: false,
      };
    }
  }

  // ─── MESSAGING COMMANDS ──────────────────────────────────

  if (cmd.startsWith('msg @')) {
    // msg @agent [message] or msg @all [message] or msg @project [message]
    const args = command.slice(5).trim();
    const firstSpace = args.indexOf(' ');
    
    if (firstSpace === -1) {
      return { response: '❌ Usage: msg @agent [message] or msg @all [message]', success: false };
    }
    
    const target = args.slice(0, firstSpace).toLowerCase();
    const message = args.slice(firstSpace + 1);
    
    if (target === 'all') {
      // Broadcast to all agents
      const result = await broadcastMessage(agents, getConfig, message);
      
      addAgentMessage({
        id: `msg_${Date.now()}`,
        from: 'user',
        to: 'all',
        content: message,
        timestamp: new Date().toISOString(),
      });
      
      if (result.ok) {
        return {
          response: `✅ Broadcast to ${result.deliveredTo?.length || 0} agents:\n${result.deliveredTo?.map(id => agents.find(a => a.id === id)?.name || id).join(', ')}\n\n${result.error ? `⚠️ Partial failures: ${result.error}` : ''}`,
          success: true,
        };
      } else {
        return {
          response: `❌ Broadcast failed: ${result.error}`,
          success: false,
        };
      }
    } else if (target.startsWith('project:')) {
      // msg @project:projectId [message]
      const projectId = target.slice(8);
      const projects = await loadProjects();
      const project = projects.find(p => p.id === projectId);
      
      if (!project) {
        return { response: `❌ Project "${projectId}" not found`, success: false };
      }
      
      const projectAgents = agents.filter(a => project.agentIds.includes(a.id));
      
      if (projectAgents.length === 0) {
        return { response: `❌ No agents assigned to project "${project.name}"`, success: false };
      }
      
      const result = await sendMessageToProject(projectAgents, getConfig, message);
      
      addAgentMessage({
        id: `msg_${Date.now()}`,
        from: 'user',
        to: 'project',
        content: message,
        projectId,
        timestamp: new Date().toISOString(),
      });
      
      if (result.ok) {
        return {
          response: `✅ Message sent to project "${project.name}"\nDelivered to: ${result.deliveredTo?.map(id => agents.find(a => a.id === id)?.name || id).join(', ')}`,
          success: true,
        };
      } else {
        return {
          response: `❌ Failed: ${result.error}`,
          success: false,
        };
      }
    } else {
      // msg @agent [message]
      const agent = agents.find(a => a.name.toLowerCase().includes(target));
      
      if (!agent) {
        return { response: `❌ Agent "${target}" not found. Try: msg @all or msg @${agents[0]?.name}`, success: false };
      }
      
      const config = getConfig(agent.connectionId);
      if (!config) {
        return { response: `❌ No connection config for ${agent.name}`, success: false };
      }
      
      const sessionKey = getAgentIdentityKey(agent);
      const result = await sendMessageToAgent(config, sessionKey, message);
      
      addAgentMessage({
        id: `msg_${Date.now()}`,
        from: 'user',
        to: agent.id,
        content: message,
        timestamp: new Date().toISOString(),
      });
      
      if (result.ok) {
        return {
          response: `✅ Message sent to ${agent.name}\n"${message}"`,
          success: true,
        };
      } else {
        return {
          response: `❌ Failed to send to ${agent.name}: ${result.error}`,
          success: false,
        };
      }
    }
  }

  if (cmd === 'relay' || cmd === 'messages' || cmd === 'msg history') {
    // Show recent agent messages
    const { getMessageHistory } = await import('./agentMessaging');
    const history = getMessageHistory(10);
    
    if (history.length === 0) {
      return {
        response: '📬 No messages yet. Use: msg @agent [message]',
        success: true,
      };
    }
    
    const lines = history.map(m => {
      const fromName = m.from === 'user' ? 'You' : agents.find(a => a.id === m.from)?.name || m.from;
      const toName = m.to === 'all' ? 'ALL' : m.to === 'project' ? `Project ${m.projectId}` : agents.find(a => a.id === m.to)?.name || m.to;
      return `[${new Date(m.timestamp).toLocaleTimeString()}] ${fromName} → ${toName}\n"${m.content}"`;
    });
    
    return {
      response: `📬 Recent Messages\n\n${lines.join('\n\n')}`,
      success: true,
    };
  }

  // Not a collaboration command
  return null;
}

/**
 * Get help text for collaboration commands
 */
export function getCollaborationHelp(): string {
  return `COLLABORATION:\n` +
    `• projects — List all projects\n` +
    `• project create [name] [desc] — Create project\n` +
    `• project assign [id] @agent — Assign agent\n` +
    `• project remove [id] @agent — Remove agent\n` +
    `• project delete [id] — Delete project\n` +
    `• project migrate legacy — Promote legacy local projects/tasks\n` +
    `\n` +
    `MESSAGING:\n` +
    `• msg @agent [text] — Message one agent\n` +
    `• msg @all [text] — Broadcast to all agents\n` +
    `• msg @project:[id] [text] — Message project team\n` +
    `• messages — View message history\n` +
    `\n` +
    `Example: "project create website Build new site"\n` +
    `         "project assign project_123 @BlackSwan"\n` +
    `         "msg @BlackSwan Start working on the homepage"\n` +
    `         "msg @all Daily standup in 5 minutes!"`;
}
