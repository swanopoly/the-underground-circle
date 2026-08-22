/**
 * MCP Server for The Underground Circle
 * Exposes Circle data (tasks, messages, memory) as MCP resources/tools.
 * Supports MCP-over-HTTP protocol.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.3';
import { getAuthenticatedUser } from '../_shared/edge.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-circle-invite-code',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const authorization = req.headers.get('Authorization') || req.headers.get('authorization') || '';
    const supabase = createClient(
      supabaseUrl,
      serviceRoleKey, // Service role is limited to invite + membership resolution.
    );

    // Authenticate before touching the invite code. Otherwise the difference
    // between "invalid code" and "authentication required" is an oracle for
    // a bearer-like Circle join credential.
    const authUser = await getAuthenticatedUser(req);
    if (!authUser) {
      return new Response(
        JSON.stringify({ error: 'Authentication required: send the user access token in Authorization' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

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

    // ── Authorization ──────────────────────────────────────────────────────
    // The invite code only SELECTS the circle — it is a low-entropy, shareable
    // join token, NOT a credential. Require a real authenticated user who is a
    // member of this circle for every operation. (Previously the invite code
    // alone granted full read of tasks + the last 50 chat messages plus an
    // unauthenticated write that forged a task attributed to the circle creator.)
    // MCP clients must send the user's Supabase access token in Authorization.
    if (!supabaseUrl || !anonKey || !authorization) {
      return new Response(
        JSON.stringify({ error: 'Authenticated Circle data access is unavailable' }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    const { data: membership } = await supabase
      .from('circle_members')
      .select('user_id')
      .eq('circle_id', circle.id)
      .eq('user_id', authUser.id)
      .maybeSingle();
    if (!membership) {
      return new Response(
        JSON.stringify({ error: 'Not authorized for this circle' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // All tenant data reads and writes below must execute as the verified user.
    // A service-role query would bypass message/thread RLS and could export a
    // private/shared Chat thread to any other member holding the Circle invite
    // code. Keep service role authority above at the authentication boundary.
    const callerSupabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    });

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
          const { data: tasks } = await callerSupabase
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
          // This Circle-wide MCP resource intentionally excludes private and
          // shared threads, even when the caller belongs to one. Exporting a
          // mixed resource could replay that private text into a public Circle
          // workflow. A future thread-specific URI must prove exact membership.
          const { data: circleThreads, error: threadError } = await callerSupabase
            .from('circle_chat_threads')
            .select('id')
            .eq('circle_id', circle.id)
            .eq('visibility', 'circle')
            .limit(50);
          if (threadError) throw new Error('Circle Chat visibility could not be verified');
          const visibleThreadIds = (circleThreads || [])
            .map((thread: { id?: unknown }) => typeof thread.id === 'string' ? thread.id : null)
            .filter((id: string | null): id is string => Boolean(id));
          const messagesQuery = callerSupabase
            .from('messages')
            .select('content, is_bot, profiles(display_name), created_at')
            .eq('circle_id', circle.id)
            .order('created_at', { ascending: false })
            .limit(50);
          const { data: messages, error: messagesError } = visibleThreadIds.length > 0
            ? await messagesQuery.in('thread_id', visibleThreadIds)
            : { data: [], error: null };
          if (messagesError) throw new Error('Circle messages could not be read');
          
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
          // Attribute the task to the authenticated member (verified above), not
          // the circle creator — the previous behavior forged tasks under the
          // creator's identity for any caller holding an invite code.
          const { data: newTask, error: taskErr } = await callerSupabase
            .from('tasks')
            .insert({
              circle_id: circle.id,
              created_by: authUser.id,
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
    const message = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
