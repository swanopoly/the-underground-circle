/**
 * room-task-executor — Supabase Edge Function
 *
 * Called by the app when a task is assigned to an agent in a Room.
 * Reads file context, calls Anthropic Claude, posts result to room_messages,
 * optionally updates room_files, and marks the task done.
 *
 * Deploy:  npx supabase functions deploy room-task-executor
 * Secrets: ANTHROPIC_API_KEY (required)
 *
 * Request body:
 *   { taskId, roomId, prompt, fileName?, fileContent?, agentName?, agentId? }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ─── Anthropic API call ──────────────────────────────────────────────────────

async function callClaude(systemPrompt: string, userMessage: string): Promise<string> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set — add it in Supabase Dashboard → Edge Functions → Secrets');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.content?.[0]?.text || 'No response generated.';
}

// ─── Build system prompt for file-aware agent ────────────────────────────────

function buildSystemPrompt(fileName: string | null, fileContent: string | null): string {
  let prompt = `You are SwanBot 🦢 — an expert coding agent working inside a collaborative Room workspace. You are professional, precise, and thorough.

## Your capabilities:
- Review, analyze, and improve code files
- Write new code, refactor existing code
- Explain technical concepts
- Debug issues and suggest fixes
- Generate documentation

## Response format:
- Be concise but complete
- Use markdown formatting (code blocks, headers, lists)
- When modifying code, show the full updated file or the specific changes with context
- If you suggest file modifications, wrap them in a code block with the language specified
- Start with a brief summary of what you did, then show the work`;

  if (fileName && fileContent) {
    prompt += `\n\n## Active File: \`${fileName}\`\n\`\`\`\n${fileContent.slice(0, 12000)}${fileContent.length > 12000 ? '\n...[truncated at 12K chars]' : ''}\n\`\`\``;
  }

  return prompt;
}

// ─── Check if response contains file modifications ───────────────────────────

function extractFileUpdate(response: string, originalFileName: string | null): string | null {
  if (!originalFileName) return null;

  // Look for a fenced code block that looks like the whole file
  // Heuristic: if response contains a code block that's >50% of the original + mentions "updated" or "modified"
  const codeBlockMatch = response.match(/```(?:\w+)?\n([\s\S]+?)```/);
  if (!codeBlockMatch) return null;

  const code = codeBlockMatch[1].trim();
  // Only consider it a file update if it's substantial and the response indicates a modification
  const updateKeywords = /\b(updated|modified|refactored|fixed|changed|here(?:'s| is) the (?:updated|new|modified|fixed))\b/i;
  if (code.length > 100 && updateKeywords.test(response.slice(0, 500))) {
    return code;
  }

  return null;
}

// ─── Main handler ────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Health check
  if (req.method === 'GET') {
    return new Response(JSON.stringify({ status: 'ok', service: 'room-task-executor' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json();
    const { taskId, roomId, prompt, fileName, fileContent, agentName, agentId } = body;

    if (!taskId || !roomId || !prompt) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: taskId, roomId, prompt' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Create Supabase client with service role for full DB access
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // If no file content provided but fileName exists, try to load it from room_files
    let resolvedContent = fileContent || null;
    let resolvedFileName = fileName || null;
    if (!resolvedContent && resolvedFileName) {
      const { data: fileData } = await supabase
        .from('room_files')
        .select('content, name')
        .eq('room_id', roomId)
        .eq('name', resolvedFileName)
        .eq('is_deleted', false)
        .single();
      if (fileData) {
        resolvedContent = fileData.content;
        resolvedFileName = fileData.name;
      }
    }

    // Call Claude
    const systemPrompt = buildSystemPrompt(resolvedFileName, resolvedContent);
    const aiResponse = await callClaude(systemPrompt, prompt);

    // Post the result to room_messages
    const { error: replyErr } = await supabase.from('room_messages').insert({
      room_id: roomId,
      agent_name: agentName || 'SwanBot 🦢',
      content: aiResponse,
      message_type: 'agent_output',
      metadata: { task_reply: true, task_id: taskId, status: 'done' },
    });
    if (replyErr) console.error('Failed to post reply:', replyErr);

    // Check if response contains file modifications and apply them
    let fileUpdated = false;
    if (resolvedFileName && resolvedContent) {
      const updatedCode = extractFileUpdate(aiResponse, resolvedFileName);
      if (updatedCode) {
        const { error: updateErr } = await supabase
          .from('room_files')
          .update({
            content: updatedCode,
            size_bytes: updatedCode.length,
            updated_at: new Date().toISOString(),
          })
          .eq('room_id', roomId)
          .eq('name', resolvedFileName)
          .eq('is_deleted', false);

        if (!updateErr) {
          fileUpdated = true;
          // Log the file write
          await supabase.from('room_usage').insert({
            room_id: roomId,
            agent_name: agentName || 'SwanBot',
            event_type: 'file_write',
            metadata: { file: resolvedFileName, task_id: taskId },
          });
        }
      }
    }

    // Mark original task as done
    const { data: originalTask } = await supabase
      .from('room_messages')
      .select('metadata')
      .eq('id', taskId)
      .single();

    if (originalTask) {
      await supabase
        .from('room_messages')
        .update({ metadata: { ...originalTask.metadata, status: 'done' } })
        .eq('id', taskId);
    }

    // Reset agent status to idle
    if (agentId) {
      await supabase
        .from('circle_office_agents')
        .update({ status: 'idle', current_task: null })
        .eq('id', agentId);
    }

    // Log usage
    await supabase.from('room_usage').insert({
      room_id: roomId,
      agent_name: agentName || 'SwanBot',
      event_type: 'agent_task',
      metadata: { task_id: taskId, file: resolvedFileName, file_updated: fileUpdated },
    });

    return new Response(
      JSON.stringify({
        ok: true,
        taskId,
        fileUpdated,
        responseLength: aiResponse.length,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err: any) {
    console.error('room-task-executor error:', err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
