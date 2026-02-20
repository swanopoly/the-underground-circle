import { supabase } from './supabase';
import { AgentBot } from '../types';
import { createHash } from 'crypto';

// Agent management
export async function getUserAgents(): Promise<AgentBot[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('User not authenticated');

  const { data, error } = await supabase
    .from('agents_bots')
    .select('*')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function createAgent(
  name: string,
  apiEndpoint: string,
  apiKey: string,
  type: AgentBot['type'] = 'chatbot',
  description?: string,
  avatarUrl?: string,
  metadata?: Record<string, any>
): Promise<AgentBot> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('User not authenticated');

  // Hash the API key for security
  const apiKeyHash = createHash('sha256').update(apiKey).digest('hex');

  const { data, error } = await supabase
    .from('agents_bots')
    .insert({
      owner_id: user.id,
      name,
      api_endpoint: apiEndpoint,
      api_key_hash: apiKeyHash,
      type,
      description,
      avatar_url: avatarUrl,
      metadata: metadata || {},
      is_active: true,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateAgent(
  agentId: string,
  updates: Partial<Pick<AgentBot, 'name' | 'description' | 'avatar_url' | 'is_active' | 'metadata'>>
): Promise<AgentBot> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('User not authenticated');

  const { data, error } = await supabase
    .from('agents_bots')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', agentId)
    .eq('owner_id', user.id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deleteAgent(agentId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('User not authenticated');

  const { error } = await supabase
    .from('agents_bots')
    .delete()
    .eq('id', agentId)
    .eq('owner_id', user.id);

  if (error) throw error;
}

export async function toggleAgentActive(agentId: string, isActive: boolean): Promise<void> {
  await updateAgent(agentId, { is_active: isActive });
}

// Agent communication
export async function sendMessageToAgent(
  agentId: string,
  message: string,
  context?: Record<string, any>
): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('User not authenticated');

  // Get the agent
  const { data: agent, error: agentError } = await supabase
    .from('agents_bots')
    .select('*')
    .eq('id', agentId)
    .eq('owner_id', user.id)
    .single();

  if (agentError || !agent) throw new Error('Agent not found');
  if (!agent.is_active) throw new Error('Agent is not active');

  try {
    // Make API call to the agent's endpoint
    const response = await fetch(agent.api_endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${agent.api_key_hash}`, // In practice, decrypt the stored key
      },
      body: JSON.stringify({
        message,
        context,
        user_id: user.id,
        agent_id: agentId,
      }),
    });

    if (!response.ok) {
      throw new Error(`Agent API error: ${response.status}`);
    }

    const result = await response.json();
    
    // Log the activity
    await logAgentActivity(agentId, 'message_sent', {
      user_message: message,
      agent_response: result.response || 'No response',
      context,
    });

    return result.response || 'Agent did not respond';
  } catch (error) {
    console.error('Agent communication error:', error);
    throw new Error('Failed to communicate with agent');
  }
}

// Agent activity logging
export async function logAgentActivity(
  agentId: string,
  activityType: string,
  metadata: Record<string, any>
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  // Store in XP events table with special agent activity type
  const { error } = await supabase
    .from('xp_events')
    .insert({
      user_id: user.id,
      event_type: 'agent_activity',
      xp_amount: 0,
      metadata: {
        agent_id: agentId,
        activity_type: activityType,
        ...metadata,
      },
    });

  if (error) console.error('Failed to log agent activity:', error);
}

export async function getAgentActivity(agentId?: string, limit: number = 20) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('User not authenticated');

  let query = supabase
    .from('xp_events')
    .select('*')
    .eq('user_id', user.id)
    .eq('event_type', 'agent_activity');

  if (agentId) {
    query = query.eq('metadata->>agent_id', agentId);
  }

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

// Agent templates and presets
export const agentTemplates = {
  chatbot: {
    name: 'Chatbot Assistant',
    description: 'A general-purpose chat assistant',
    type: 'chatbot' as const,
    placeholder_endpoint: 'https://your-api.com/chat',
    example_metadata: {
      model: 'gpt-3.5-turbo',
      max_tokens: 150,
      temperature: 0.7,
    },
  },
  productivity: {
    name: 'Productivity Assistant',
    description: 'Helps with tasks, reminders, and organization',
    type: 'assistant' as const,
    placeholder_endpoint: 'https://your-api.com/productivity',
    example_metadata: {
      features: ['task_management', 'calendar', 'reminders'],
      integrations: ['google_calendar', 'todoist'],
    },
  },
  integration: {
    name: 'Service Integration',
    description: 'Connects to external services and APIs',
    type: 'integration' as const,
    placeholder_endpoint: 'https://your-api.com/integration',
    example_metadata: {
      supported_services: ['slack', 'discord', 'teams'],
      webhook_url: '',
    },
  },
  custom: {
    name: 'Custom Agent',
    description: 'Build your own specialized agent',
    type: 'custom' as const,
    placeholder_endpoint: 'https://your-custom-api.com/webhook',
    example_metadata: {
      custom_config: {},
    },
  },
} as const;

// Agent invitation to circles
export async function inviteAgentToCircle(agentId: string, circleId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('User not authenticated');

  // Verify user owns the agent
  const { data: agent } = await supabase
    .from('agents_bots')
    .select('id')
    .eq('id', agentId)
    .eq('owner_id', user.id)
    .single();

  if (!agent) throw new Error('Agent not found');

  // For now, just log this as an activity
  // In the future, could add agents_circle_members table
  await logAgentActivity(agentId, 'circle_invited', {
    circle_id: circleId,
    invited_by: user.id,
  });
}

// Validate agent endpoint
export async function validateAgentEndpoint(endpoint: string): Promise<boolean> {
  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    
    return response.ok;
  } catch (error) {
    return false;
  }
}

// Agent health check
export async function checkAgentHealth(agentId: string): Promise<{
  isHealthy: boolean;
  lastChecked: string;
  error?: string;
}> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('User not authenticated');

  const { data: agent, error } = await supabase
    .from('agents_bots')
    .select('*')
    .eq('id', agentId)
    .eq('owner_id', user.id)
    .single();

  if (error || !agent) {
    return {
      isHealthy: false,
      lastChecked: new Date().toISOString(),
      error: 'Agent not found',
    };
  }

  const isHealthy = await validateAgentEndpoint(agent.api_endpoint);
  const lastChecked = new Date().toISOString();

  // Update agent health status
  await supabase
    .from('agents_bots')
    .update({
      metadata: {
        ...agent.metadata,
        last_health_check: lastChecked,
        is_healthy: isHealthy,
      },
      updated_at: lastChecked,
    })
    .eq('id', agentId);

  return {
    isHealthy,
    lastChecked,
    error: isHealthy ? undefined : 'Endpoint unreachable',
  };
}