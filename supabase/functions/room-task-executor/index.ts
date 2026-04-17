/**
 * room-task-executor — Supabase Edge Function
 *
 * Called by the app when a task is assigned to an agent in a Room.
 * Supports multiple task types: general, web_research, run_script, file_ops, db_query, api_call.
 *
 * Deploy:  npx supabase functions deploy room-task-executor
 * Secrets: ANTHROPIC_API_KEY (required), BRAVE_API_KEY (optional, for web_research)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.3';
import { errResponse, getAuthenticatedUser, jsonResponse } from '../_shared/edge.ts';

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function createSupabaseClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

async function postSystemMessage(supabase: any, roomId: string, agentName: string, content: string) {
  await supabase.from('room_messages').insert({
    room_id: roomId,
    agent_name: agentName,
    content,
    message_type: 'system',
  });
}

async function postAgentOutput(supabase: any, roomId: string, agentName: string, content: string, taskId: string, metadata: Record<string, any> = {}) {
  await supabase.from('room_messages').insert({
    room_id: roomId,
    agent_name: agentName,
    content,
    message_type: 'agent_output',
    metadata: { task_reply: true, task_id: taskId, status: 'done', ...metadata },
  });
}

async function updateTaskStatus(supabase: any, taskId: string, status: string, lastResult?: any) {
  const update: Record<string, any> = { status };
  if (status === 'done' || status === 'error') {
    update.last_run_at = new Date().toISOString();
  }
  if (lastResult !== undefined) {
    update.last_result = lastResult;
  }
  await supabase.from('room_tasks').update(update).eq('id', taskId);
}

// ─── Task Type Handlers ───────────────────────────────────────────────────────

async function handleGeneral(supabase: any, body: any): Promise<{ ok: boolean; fileUpdated: boolean; responseLength: number }> {
  const { taskId, roomId, prompt, fileName, fileContent, agentName } = body;

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

    const { data: updated } = await supabase.from('room_files')
      .update({ content: code, size_bytes: code.length, updated_at: new Date().toISOString() })
      .eq('room_id', roomId).eq('name', fileName)
      .select('id').maybeSingle();

    if (updated) {
      fileUpdated = true;
    } else {
      const ext = LANG_TO_EXT[lang] || '';
      const newName = fileName.includes('.') ? fileName : fileName + ext;
      const { error: insertErr } = await supabase.from('room_files').insert({
        room_id: roomId, name: newName, folder: '/',
        file_type: lang || 'text', content: code, size_bytes: code.length,
      });
      if (!insertErr) fileUpdated = true;
      else console.error('File insert error:', insertErr);
    }
  }

  await postAgentOutput(supabase, roomId, agentName || 'Agent', aiResponse, taskId, { file_updated: fileUpdated });
  return { ok: true, fileUpdated, responseLength: aiResponse.length };
}

async function handleWebResearch(supabase: any, body: any): Promise<{ ok: boolean; responseLength: number }> {
  const { taskId, roomId, prompt, agentName } = body;
  const braveKey = Deno.env.get('BRAVE_API_KEY');

  let searchResults: Array<{ title: string; url: string; snippet: string }> = [];
  let fetchedContent: Array<{ url: string; text: string }> = [];

  // Step 1: Search via Brave
  if (braveKey) {
    const searchRes = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(prompt)}&count=5`,
      { headers: { 'Accept': 'application/json', 'Accept-Encoding': 'gzip', 'X-Subscription-Token': braveKey } },
    );
    if (searchRes.ok) {
      const searchData = await searchRes.json();
      searchResults = (searchData.web?.results || []).slice(0, 5).map((r: any) => ({
        title: r.title, url: r.url, snippet: r.description || '',
      }));
    }
  }

  // Step 2: Fetch top 2-3 URLs
  const urlsToFetch = searchResults.slice(0, 3);
  for (const result of urlsToFetch) {
    try {
      const pageRes = await fetch(result.url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; UCBot/1.0)' },
        signal: AbortSignal.timeout(8000),
      });
      if (pageRes.ok) {
        const html = await pageRes.text();
        // Strip HTML tags, keep text, truncate
        const text = html.replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 3000);
        fetchedContent.push({ url: result.url, text });
      }
    } catch { /* timeout or fetch error — skip */ }
  }

  // Step 3: Synthesize with Claude
  const systemPrompt = [
    'You are a research assistant. Synthesize the search results and fetched page content into a clear, well-organized research summary.',
    'Include key findings, cite sources with URLs, and highlight actionable insights.',
    'Format with markdown headers and bullet points.',
  ].join('\n');

  const userMessage = [
    `Research query: ${prompt}`,
    '',
    searchResults.length > 0 ? `## Search Results\n${searchResults.map((r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}`).join('\n\n')}` : 'No search results (BRAVE_API_KEY may not be configured).',
    '',
    fetchedContent.length > 0 ? `## Fetched Page Content\n${fetchedContent.map(f => `### ${f.url}\n${f.text}`).join('\n\n')}` : '',
  ].join('\n');

  const aiResponse = await callClaude(systemPrompt, userMessage);
  await postAgentOutput(supabase, roomId, agentName || 'Agent', `🔍 **Research Summary**\n\n${aiResponse}`, taskId, { task_type: 'web_research', sources: searchResults.map(r => r.url) });
  return { ok: true, responseLength: aiResponse.length };
}

async function handleRunScript(supabase: any, body: any): Promise<{ ok: boolean; responseLength: number }> {
  const { taskId, roomId, prompt, agentName } = body;

  // Step 1: Ask Claude to write the script
  const systemPrompt = [
    'You are a Python scripting expert. Write a Python script that solves the user\'s request.',
    'Put the complete script in a ```python fenced code block.',
    'After the code block, briefly explain what the script does and what output to expect.',
  ].join('\n');

  const aiResponse = await callClaude(systemPrompt, prompt);
  const content = `⚙️ **Script Generated**\n\n${aiResponse}\n\n---\n**Execution note:** direct server-side script execution is disabled for security. Review and run this script in a controlled environment.`;
  await postAgentOutput(supabase, roomId, agentName || 'Agent', content, taskId, { task_type: 'run_script', executed: false, execution_disabled: true });
  return { ok: true, responseLength: content.length };
}

async function handleFileOps(supabase: any, body: any): Promise<{ ok: boolean; responseLength: number }> {
  const { taskId, roomId, prompt, agentName, files } = body;

  const fileList = Array.isArray(files) ? files : [];

  const systemPrompt = [
    'You are a file organization and analysis expert.',
    'Analyze the provided files and prompt, then give structured recommendations.',
    'Use markdown with clear headers, bullet points, and actionable suggestions.',
  ].join('\n');

  const userMessage = [
    `Request: ${prompt}`,
    '',
    fileList.length > 0
      ? `## Files\n${fileList.map((f: any, i: number) => `${i + 1}. **${f.name}** (${f.type || 'unknown'}, ${f.size ? `${f.size} bytes` : 'unknown size'})`).join('\n')}`
      : 'No files provided.',
  ].join('\n');

  const aiResponse = await callClaude(systemPrompt, userMessage);
  await postAgentOutput(supabase, roomId, agentName || 'Agent', `📁 **File Analysis**\n\n${aiResponse}`, taskId, { task_type: 'file_ops', file_count: fileList.length });
  return { ok: true, responseLength: aiResponse.length };
}

async function handleDbQuery(supabase: any, body: any): Promise<{ ok: boolean; responseLength: number }> {
  const { taskId, roomId, prompt, agentName, sql } = body;

  if (sql) {
    const normalized = sql.trim().toUpperCase();
    const forbidden = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'CREATE', 'ALTER', 'TRUNCATE', 'GRANT', 'REVOKE'];
    for (const kw of forbidden) {
      if (normalized.includes(kw)) {
        const errMsg = `🗄️ **Query Rejected**\n\nOnly SELECT queries are allowed. Detected forbidden keyword: \`${kw}\``;
        await postAgentOutput(supabase, roomId, agentName || 'Agent', errMsg, taskId, { task_type: 'db_query', error: 'forbidden_keyword' });
        return { ok: false, responseLength: errMsg.length };
      }
    }
    const aiResponse = await callClaude(
      'You are a database expert. Review the proposed SQL query for correctness, safety, and performance. Explain what it does and call out any risk areas. Do not execute it.',
      `Original request: ${prompt}\n\nSQL:\n${sql}`,
    );
    const content = `🗄️ **Query Review Only**\n\n\`\`\`sql\n${sql}\n\`\`\`\n\n${aiResponse}\n\n---\n**Execution note:** direct database execution is disabled in this edge function for security.`;
    await postAgentOutput(supabase, roomId, agentName || 'Agent', content, taskId, { task_type: 'db_query', execution_disabled: true });
    return { ok: true, responseLength: content.length };
  }

  // No SQL provided — ask Claude to help write the query
  const aiResponse = await callClaude(
    'You are a database expert. Help the user write a SQL query based on their request. Provide the query in a ```sql code block and explain what it does.',
    prompt,
  );
  await postAgentOutput(supabase, roomId, agentName || 'Agent', `🗄️ **Database Assistant**\n\n${aiResponse}`, taskId, { task_type: 'db_query' });
  return { ok: true, responseLength: aiResponse.length };
}

async function handleApiCall(supabase: any, body: any): Promise<{ ok: boolean; responseLength: number }> {
  const { taskId, roomId, prompt, agentName, endpoint, method, headers, body: reqBody } = body;

  if (!endpoint) {
    // No endpoint — ask Claude to help construct the API call
    const aiResponse = await callClaude(
      'You are an API integration expert. Help the user construct an API call based on their request. Provide the endpoint, method, headers, and body.',
      prompt,
    );
    await postAgentOutput(supabase, roomId, agentName || 'Agent', `🌐 **API Assistant**\n\n${aiResponse}`, taskId, { task_type: 'api_call' });
    return { ok: true, responseLength: aiResponse.length };
  }

  const aiResponse = await callClaude(
    'You are an API integration expert. Review the proposed HTTP request, identify security and correctness issues, and provide a safe request example. Do not execute the request.',
    [
      `Original request: ${prompt}`,
      `Endpoint: ${endpoint}`,
      `Method: ${method || 'GET'}`,
      headers ? `Headers: ${JSON.stringify(headers)}` : '',
      reqBody ? `Body: ${typeof reqBody === 'string' ? reqBody : JSON.stringify(reqBody)}` : '',
    ].filter(Boolean).join('\n'),
  );
  const content = `🌐 **API Call Review Only**\n\n**${method || 'GET'}** \`${endpoint}\`\n\n${aiResponse}\n\n---\n**Execution note:** arbitrary outbound API execution is disabled in this edge function for SSRF protection.`;
  await postAgentOutput(supabase, roomId, agentName || 'Agent', content, taskId, { task_type: 'api_call', execution_disabled: true });
  return { ok: true, responseLength: content.length };
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method === 'GET') {
    return jsonResponse({ status: 'ok', service: 'room-task-executor' });
  }

  try {
    const body = await req.json();
    const { taskId, roomId, prompt, agentName, agentId, task_type } = body;
    const taskType = task_type || 'general';

    if (!taskId || !roomId || !prompt) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: taskId, roomId, prompt' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const user = await getAuthenticatedUser(req);
    if (!user) {
      return errResponse(401, 'unauthenticated', 'Valid JWT required.');
    }

    const supabase = createSupabaseClient();
    const { data: room } = await supabase
      .from('circle_rooms')
      .select('id, circle_id')
      .eq('id', roomId)
      .maybeSingle();
    if (!room?.circle_id) {
      return errResponse(404, 'room_not_found', 'Room not found.');
    }
    const { data: membership } = await supabase
      .from('circle_members')
      .select('user_id')
      .eq('circle_id', room.circle_id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (!membership) {
      return errResponse(403, 'forbidden', 'Not authorized for this room.');
    }
    const { data: taskRow } = await supabase
      .from('room_tasks')
      .select('id, room_id')
      .eq('id', taskId)
      .maybeSingle();
    if (!taskRow || taskRow.room_id !== roomId) {
      return errResponse(403, 'task_mismatch', 'Task does not belong to this room.');
    }

    // Post "working on it" system message
    await postSystemMessage(supabase, roomId, agentName || 'Agent', `🤔 ${agentName || 'Agent'} is working on: ${body.taskName || prompt.slice(0, 60)}...`);

    // Mark task as running
    await updateTaskStatus(supabase, taskId, 'running');

    let result: { ok: boolean; fileUpdated?: boolean; responseLength: number };

    switch (taskType) {
      case 'web_research':
        result = await handleWebResearch(supabase, body);
        break;
      case 'run_script':
        result = await handleRunScript(supabase, body);
        break;
      case 'file_ops':
        result = await handleFileOps(supabase, body);
        break;
      case 'db_query':
        result = await handleDbQuery(supabase, body);
        break;
      case 'api_call':
        result = await handleApiCall(supabase, body);
        break;
      default:
        result = await handleGeneral(supabase, body);
        break;
    }

    // Mark task done + store result summary
    await updateTaskStatus(supabase, taskId, 'done', { responseLength: result.responseLength, taskType, completedAt: new Date().toISOString() });

    // Also mark original room_messages task entry if it exists
    const { data: originalTask } = await supabase.from('room_messages')
      .select('metadata').eq('id', taskId).maybeSingle();
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
      JSON.stringify({ taskId, taskType, ...result }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err: any) {
    console.error('room-task-executor error:', err);

    // Try to mark task as error if we have the info
    try {
      const body = await req.clone().json().catch(() => null);
      if (body?.taskId) {
        const supabase = createSupabaseClient();
        await updateTaskStatus(supabase, body.taskId, 'error', { error: err.message });
      }
    } catch { /* best effort */ }

    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
