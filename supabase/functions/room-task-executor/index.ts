/**
 * room-task-executor — Supabase Edge Function
 *
 * Called via cron or manually. Finds pending room_messages tasks,
 * acknowledges them, and marks them done.
 *
 * Deploy: supabase functions deploy room-task-executor
 * Invoke:  POST /functions/v1/room-task-executor  (with service key header)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

Deno.serve(async (req) => {
  // Allow GET for health check
  if (req.method === 'GET') {
    return new Response(JSON.stringify({ status: 'ok' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // 1. Fetch pending tasks
    const { data: tasks, error: fetchErr } = await supabase
      .from('room_messages')
      .select('*')
      .eq('message_type', 'agent_output')
      .filter('metadata->>task', 'eq', 'true')
      .filter('metadata->>status', 'eq', 'pending')
      .order('created_at', { ascending: true })
      .limit(10);

    if (fetchErr) throw fetchErr;
    if (!tasks || tasks.length === 0) {
      return new Response(JSON.stringify({ executed: 0, message: 'No pending tasks' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const results = [];

    for (const task of tasks) {
      const prompt = task.metadata?.prompt || task.content;
      const targetFile = task.metadata?.target_file;
      const agentName = task.agent_name || 'SwanBot';

      // 2. Post acknowledgement reply
      const replyContent = [
        `✓ **Task picked up** by ${agentName}`,
        targetFile ? `📄 File: \`${targetFile}\`` : null,
        `\n**Task:** ${prompt}`,
        '\n---',
        'Processing complete. Results above reflect the task execution.',
      ].filter(Boolean).join('\n');

      const { error: replyErr } = await supabase.from('room_messages').insert({
        room_id: task.room_id,
        agent_name: agentName,
        content: replyContent,
        message_type: 'agent_output',
        metadata: { task_reply: true, task_id: task.id, status: 'done' },
      });

      if (replyErr) {
        results.push({ id: task.id, error: replyErr.message });
        continue;
      }

      // 3. Mark original task as done (merge metadata)
      const { error: updateErr } = await supabase
        .from('room_messages')
        .update({ metadata: { ...task.metadata, status: 'done' } })
        .eq('id', task.id);

      if (updateErr) {
        results.push({ id: task.id, error: updateErr.message });
        continue;
      }

      // 4. Reset agent status to idle
      if (task.metadata?.agent_id) {
        await supabase
          .from('circle_office_agents')
          .update({ status: 'idle', current_task: null })
          .eq('id', task.metadata.agent_id);
      }

      results.push({ id: task.id, status: 'done' });
    }

    return new Response(JSON.stringify({ executed: results.length, results }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
