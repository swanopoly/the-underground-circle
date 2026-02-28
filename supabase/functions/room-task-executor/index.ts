/**
 * room-task-executor — Supabase Edge Function
 *
 * Called by the app when a task is assigned to an agent in a Room.
 * Reads file context, calls Anthropic Claude Haiku, posts result to room_messages,
 * creates/updates room_files, and marks the task done.
 *
 * Deploy:  npx supabase functions deploy room-task-executor
 * Secrets: ANTHROPIC_API_KEY (required)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LANG_TO_EXT: Record<string, string> = {
  html: '.html', css: '.css', js: '.js', javascript: '.js',
  ts: '.ts', typescript: '.ts', tsx: '.tsx', jsx: '.jsx',
  json: '.json', python: '.py', py: '.py', sql: '.sql',
  md: '.md', markdown: '.md', yaml: '.yaml', yml: '.yaml',
  sh: '.sh', bash: '.sh', xml: '.xml', txt: '.txt',
  rust: '.rs', go: '.go', java: '.java', cpp: '.cpp', c: '.c',
  ruby: '.rb', php: '.php', swift: '.swift', kotlin: '.kt',
};

async function callClaude(systemPrompt: string, userMessage: string): Promise<string> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

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

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const systemPrompt = [
      'You are an expert coding agent working inside a collaborative Room workspace.',
      'Your code output will be written directly to the target file.',
      'Put the COMPLETE file content in a single fenced code block with the language tag (e.g. ```html).',
      'Keep explanations minimal — focus on the code.',
      fileName && fileContent
        ? `\nCurrent file "${fileName}":\n\`\`\`\n${fileContent.slice(0, 12000)}${fileContent.length > 12000 ? '\n...[truncated]' : ''}\n\`\`\``
        : '',
    ].join('\n');

    const aiResponse = await callClaude(systemPrompt, prompt);

    const codeMatch = aiResponse.match(/```(\w+)?\n([\s\S]+?)```/);
    let fileUpdated = false;

    if (codeMatch && fileName) {
      const lang = codeMatch[1] || '';
      const code = codeMatch[2].trim();

      // Try update existing file first
      const { data: updated } = await supabase.from('room_files')
        .update({ content: code, size_bytes: code.length, updated_at: new Date().toISOString() })
        .eq('room_id', roomId).eq('name', fileName)
        .select('id').maybeSingle();

      if (updated) {
        fileUpdated = true;
      } else {
        // Create new file
        const ext = LANG_TO_EXT[lang] || '';
        const newName = fileName.includes('.') ? fileName : fileName + ext;
        const { error: insertErr } = await supabase.from('room_files').insert({
          room_id: roomId,
          name: newName,
          folder: '/',
          file_type: lang || 'text',
          content: code,
          size_bytes: code.length,
        });
        if (!insertErr) fileUpdated = true;
        else console.error('File insert error:', insertErr);
      }
    }

    // Post agent response to chat
    await supabase.from('room_messages').insert({
      room_id: roomId,
      agent_name: agentName || 'Agent',
      content: aiResponse,
      message_type: 'agent_output',
      metadata: { task_reply: true, task_id: taskId, status: 'done', file_updated: fileUpdated },
    });

    // Mark original task done
    const { data: originalTask } = await supabase.from('room_messages')
      .select('metadata').eq('id', taskId).single();
    if (originalTask) {
      await supabase.from('room_messages')
        .update({ metadata: { ...originalTask.metadata, status: 'done' } })
        .eq('id', taskId);
    }

    // Reset agent status
    if (agentId) {
      await supabase.from('circle_office_agents')
        .update({ status: 'idle', current_task: null })
        .eq('id', agentId);
    }

    return new Response(
      JSON.stringify({ ok: true, taskId, fileUpdated, responseLength: aiResponse.length }),
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
