/**
 * MCP Server for The Underground Circle
 * Exposes Circle data (tasks, messages, memory) as MCP resources/tools.
 * Supports MCP-over-HTTP protocol.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-circle-invite-code',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '' // Service role for internal data access
    );

    const inviteCode = req.headers.get('x-circle-invite-code');
    if (!inviteCode) {
      throw new Error('Circle invite code is required for authentication');
    }

    // Verify invite code and get circle_id
    const { data: circle, error: circleErr } = await supabase
      .from('circles')
      .select('id, name')
      .eq('invite_code', inviteCode)
      .single();

    if (circleErr || !circle) {
      throw new Error('Invalid circle invite code');
    }

    const { method, params, id: jsonRpcId } = await req.json();

    // MCP JSON-RPC handlers
    let result = null;

    switch (method) {
      case 'initialize':
        result = {
          protocolVersion: '2024-11-05',
          capabilities: {
            resources: {},
            tools: {}
          },
          serverInfo: {
            name: 'The Underground Circle MCP Server',
            version: '1.0.0'
          }
        };
        break;

      case 'resources/list':
        result = {
          resources: [
            {
              uri: `circle://${circle.id}/tasks`,
              name: `Tasks in ${circle.name}`,
              mimeType: 'application/json',
              description: 'Current active tasks for this circle'
            },
            {
              uri: `circle://${circle.id}/messages`,
              name: `Recent Messages in ${circle.name}`,
              mimeType: 'application/json',
              description: 'The last 50 messages in the circle chat'
            }
          ]
        };
        break;

      case 'resources/read':
        const uri = params.uri;
        if (uri.endsWith('/tasks')) {
          const { data: tasks } = await supabase
            .from('tasks')
            .select('title, status, assigned_to(display_name), due_date')
            .eq('circle_id', circle.id)
            .order('created_at', { ascending: false })
            .limit(20);
          
          result = {
            contents: [{
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(tasks, null, 2)
            }]
          };
        } else if (uri.endsWith('/messages')) {
          const { data: messages } = await supabase
            .from('messages')
            .select('content, is_bot, profiles(display_name), created_at')
            .eq('circle_id', circle.id)
            .order('created_at', { ascending: false })
            .limit(50);
          
          result = {
            contents: [{
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(messages, null, 2)
            }]
          };
        }
        break;

      case 'tools/list':
        result = {
          tools: [
            {
              name: 'create_circle_task',
              description: 'Creates a new task in the circle task board',
              inputSchema: {
                type: 'object',
                properties: {
                  title: { type: 'string', description: 'The task title' },
                  description: { type: 'string', description: 'Optional detailed description' }
                },
                required: ['title']
              }
            }
          ]
        };
        break;

      case 'tools/call':
        if (params.name === 'create_circle_task') {
          const { title, description } = params.arguments;
          // Note: In a real scenario, we'd need a valid user_id. 
          // For now, we'll assign it to the circle creator.
          const { data: circleCreator } = await supabase.from('circles').select('created_by').eq('id', circle.id).single();
          
          const { data: newTask, error: taskErr } = await supabase
            .from('tasks')
            .insert({
              circle_id: circle.id,
              created_by: circleCreator?.created_by,
              title,
              description,
              status: 'open'
            })
            .select()
            .single();

          if (taskErr) throw taskErr;
          
          result = {
            content: [{
              type: 'text',
              text: `Successfully created task: ${newTask.title} (ID: ${newTask.id})`
            }]
          };
        }
        break;

      default:
        throw new Error(`Method not found: ${method}`);
    }

    return new Response(JSON.stringify({ jsonrpc: '2.0', id: jsonRpcId, result }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
