// hybrid-task-planner — decomposes a hybrid computer task into an
// ordered list of typed sub-steps (file/app/browser) with dependency
// edges and {{step_N.output}} consumption tokens.
//
// Sonnet 4.6 is the right tier — cheaper than Opus, smarter than Haiku
// at structured decomposition with implicit dependency reasoning. One
// shot, JSON output, ~2-4K tokens total.
//
// Input:  { task, circleId, audit }
// Output: HybridPlan
//
// Persistence is the client's job (RLS gates writes by auth.uid; this
// edge fn runs with no user context).

import {
  callClaude,
  type CallClaudeOpts,
} from '../_claude/anthropic.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PLANNER_MODEL = 'claude-sonnet-4-6';

interface PlannerRequest {
  task: string;
  circleId: string;
  audit?: { findings?: Array<{ id: string; status: string; label?: string }> };
}

const SYSTEM_PROMPT = [
  'You decompose a computer task that spans multiple surfaces (file system, connected apps, browser) into an ordered list of typed sub-steps.',
  'Each step targets exactly ONE surface: "file", "app", or "browser".',
  'Use {{step_N.output.path.to.field}} tokens to feed prior step output into a later step\'s task description.',
  'Mark a step needsApproval=true if it would: spend money, post publicly, send a message, modify or delete files, or do anything irreversible.',
  'Output STRICT JSON only — no markdown, no commentary. Schema:',
  '{',
  '  "steps": [',
  '    { "id": "step_1", "kind": "file"|"app"|"browser", "task": "...", "rationale": "...", "needsApproval": false, "dependsOn": [], "consumes": "{{step_X.output.Y}}" },',
  '    ...',
  '  ],',
  '  "estimatedCost": { "tokens": <int>, "usd": <float> },',
  '  "requiredCapabilities": ["browser_automation","app_tools","file_search"]',
  '}',
  '',
  'Rules:',
  '- step ids are sequential: step_1, step_2, ...',
  '- dependsOn lists the ids whose outputs are needed first; matches the consumes token (if any).',
  '- consumes is optional — omit if the step does not need prior output.',
  '- prefer ≤4 steps; if a request is single-surface, return ONE step (the surface owner can handle it).',
  '- NEVER invent capabilities not in the audit. If the audit says no filesystem MCP, do not produce file steps.',
].join('\n');

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  let body: PlannerRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid JSON' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!body.task || typeof body.task !== 'string') {
    return new Response(JSON.stringify({ error: 'task required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const auditSummary = (body.audit?.findings || [])
    .map((f) => `- ${f.id}: ${f.status}${f.label ? ` (${f.label})` : ''}`)
    .join('\n') || '(no audit provided — assume browser only)';

  const userMsg = [
    'CIRCLE CAPABILITY AUDIT:',
    auditSummary,
    '',
    'USER TASK:',
    body.task,
    '',
    'Return the JSON plan now.',
  ].join('\n');

  const opts: CallClaudeOpts = {
    apiKey,
    model: PLANNER_MODEL,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMsg }],
    maxTokens: 2000,
  };

  let result;
  try {
    result = await callClaude(opts);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: `planner call failed: ${msg}` }), {
      status: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Extract text from the content array (CallClaudeResult.content is any[]).
  // The first text block is the LLM's JSON response.
  const textBlock = Array.isArray(result.content)
    ? result.content.find((b: any) => b.type === 'text')
    : null;
  const raw = String(textBlock?.text || '').trim();

  const jsonStart = raw.indexOf('{');
  const jsonEnd = raw.lastIndexOf('}');
  if (jsonStart < 0 || jsonEnd < jsonStart) {
    return new Response(JSON.stringify({ error: 'planner returned non-JSON', raw }), {
      status: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const jsonStr = raw.slice(jsonStart, jsonEnd + 1);

  let parsed: any;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: `planner JSON parse failed: ${msg}`, raw }), {
      status: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Lightweight validation — server has the closest view of the LLM
  // output, so we sanitize before sending to the client.
  const steps = Array.isArray(parsed.steps) ? parsed.steps : [];
  const cleanSteps = steps
    .map((s: any, i: number) => ({
      id: typeof s.id === 'string' && s.id ? s.id : `step_${i + 1}`,
      kind: ['file', 'app', 'browser'].includes(s.kind) ? s.kind : 'browser',
      task: String(s.task || '').slice(0, 4000),
      rationale: String(s.rationale || '').slice(0, 500),
      needsApproval: Boolean(s.needsApproval),
      dependsOn: Array.isArray(s.dependsOn) ? s.dependsOn.filter((d: any) => typeof d === 'string') : [],
      consumes: typeof s.consumes === 'string' && s.consumes ? s.consumes.slice(0, 1000) : undefined,
    }))
    .filter((s: any) => s.task);

  const plan = {
    id: crypto.randomUUID(),
    task: body.task,
    steps: cleanSteps,
    estimatedCost: {
      tokens: Number(parsed.estimatedCost?.tokens) || 0,
      usd: Number(parsed.estimatedCost?.usd) || 0,
    },
    requiredCapabilities: Array.isArray(parsed.requiredCapabilities)
      ? parsed.requiredCapabilities.filter((c: any) => typeof c === 'string')
      : [],
  };

  return new Response(JSON.stringify(plan), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
