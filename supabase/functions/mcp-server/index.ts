/**
 * MCP Server for The Underground Circle
 * Exposes Circle data (tasks, messages, memory) as MCP resources/tools.
 * Supports MCP-over-HTTP protocol.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.3';
import { getAuthenticatedUser } from '../_shared/edge.ts';

// Bot-authored `messages.content` rows carry a `[[UC_CHAT_META]]`-prefixed
// JSON metadata blob (recovery options, plan, findings, etc.) appended after
// the visible text — see BOT_META_MARKER in src/lib/persistedChatMetadata.ts,
// the single source of truth for this marker string. This MCP resource is
// read directly by MCP clients (LLM apps) as conversation context, so an
// unstripped marker would leak a raw JSON blob into a model prompt.
// Deliberately NOT importing that module here: it has no Deno-runtime
// dependencies (all its imports are `import type`), but pulling its full
// type surface into `deno check` surfaces pre-existing type errors never
// exercised before nothing imported it into a Deno context. Duplicating just
// the marker constant keeps this fix isolated and Deno-clean.
const BOT_META_MARKER = '\n[[UC_CHAT_META]]';
function stripBotMetaMarker(content: string): string {
  const index = content.indexOf(BOT_META_MARKER);
  return index >= 0 ? content.slice(0, index) : content;
}

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

    // ── Authorization ──────────────────────────────────────────────────────
    // The invite code only SELECTS the circle — it is a low-entropy, shareable
    // join token, NOT a credential. Require a real authenticated user who is a
    // member of this circle for every operation. (Previously the invite code
    // alone granted full read of tasks + the last 50 chat messages plus an
    // unauthenticated write that forged a task attributed to the circle creator.)
    // MCP clients must send the user's Supabase access token in Authorization.
    const authUser = await getAuthenticatedUser(req);
    if (!authUser) {
      return new Response(
        JSON.stringify({ error: 'Authentication required: send the user access token in Authorization' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
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
          
          const cleanedMessages = (messages || []).map((m: any) =>
            m.is_bot && typeof m.content === 'string'
              ? { ...m, content: stripBotMetaMarker(m.content) }
              : m
          );

          result = {
            contents: [{
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(cleanedMessages, null, 2)
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
          const { data: newTask, error: taskErr } = await supabase
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
