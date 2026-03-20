/**
 * MCP Server — Model Context Protocol gateway for The Underground Circle
 *
 * Exposes circle data to external AI agents (Claude Code, Cursor, VS Code Copilot)
 * via a lightweight HTTP API implementing MCP tool discovery and execution.
 *
 * Run: node scripts/mcp-server.js
 * Port: 7779 (next to claude-bridge at 7778)
 *
 * Auth: Pass a Supabase access token via `Authorization: Bearer <token>`
 *       to authenticate as a user and scope queries to their circles.
 *
 * Zero external dependencies — uses @supabase/supabase-js from node_modules.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

// ── Load .env from project root ─────────────────────────────────────────────

const ENV_PATH = path.join(__dirname, '..', '.env');
try {
  const envContent = fs.readFileSync(ENV_PATH, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
} catch (e) {
  console.warn('[mcp] Warning: could not read .env file:', e.message);
}

// ── Supabase client ─────────────────────────────────────────────────────────

const { createClient } = require(path.join(__dirname, '..', 'node_modules', '@supabase', 'supabase-js', 'dist', 'index.cjs'));

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('[mcp] Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY in .env');
  process.exit(1);
}

// We create a fresh client per-request using the user's access token,
// but keep an anon client for health checks.
const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function createAuthClient(accessToken) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  });
}

// ── Constants ───────────────────────────────────────────────────────────────

const PORT = 7779;
const APP_DOMAIN = 'app.chrisswanson.xyz';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

// ── MCP Tool Definitions ────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'circle_status',
    description: 'Get circle info including name, member count, and active streaks',
    inputSchema: {
      type: 'object',
      properties: {
        circleId: { type: 'string', description: 'Circle UUID' },
      },
      required: ['circleId'],
    },
  },
  {
    name: 'recent_activity',
    description: 'Get recent activity feed entries for a circle',
    inputSchema: {
      type: 'object',
      properties: {
        circleId: { type: 'string', description: 'Circle UUID' },
        limit: { type: 'number', description: 'Max entries to return (default 20)' },
      },
      required: ['circleId'],
    },
  },
  {
    name: 'list_tasks',
    description: 'Get tasks with optional status filtering (open, in_progress, done, blocked)',
    inputSchema: {
      type: 'object',
      properties: {
        circleId: { type: 'string', description: 'Circle UUID' },
        status: { type: 'string', description: 'Filter by status: open, in_progress, done, blocked (optional)' },
        limit: { type: 'number', description: 'Max tasks to return (default 25)' },
      },
      required: ['circleId'],
    },
  },
  {
    name: 'list_members',
    description: 'Get circle members with their roles and online status',
    inputSchema: {
      type: 'object',
      properties: {
        circleId: { type: 'string', description: 'Circle UUID' },
      },
      required: ['circleId'],
    },
  },
  {
    name: 'search_messages',
    description: 'Search terminal/chat messages in a circle by keyword',
    inputSchema: {
      type: 'object',
      properties: {
        circleId: { type: 'string', description: 'Circle UUID' },
        query: { type: 'string', description: 'Search keyword or phrase' },
        limit: { type: 'number', description: 'Max results (default 20)' },
      },
      required: ['circleId', 'query'],
    },
  },
  {
    name: 'get_automations',
    description: 'List configured automations and their last run status for a circle',
    inputSchema: {
      type: 'object',
      properties: {
        circleId: { type: 'string', description: 'Circle UUID' },
      },
      required: ['circleId'],
    },
  },
  {
    name: 'get_github_events',
    description: 'Get recent GitHub events (pushes, PRs, CI runs) for a circle',
    inputSchema: {
      type: 'object',
      properties: {
        circleId: { type: 'string', description: 'Circle UUID' },
        limit: { type: 'number', description: 'Max events to return (default 20)' },
      },
      required: ['circleId'],
    },
  },
  {
    name: 'get_goals',
    description: 'Get circle goals and their progress',
    inputSchema: {
      type: 'object',
      properties: {
        circleId: { type: 'string', description: 'Circle UUID' },
      },
      required: ['circleId'],
    },
  },
];

// ── Tool Handlers ───────────────────────────────────────────────────────────

function mcpText(text) {
  return { content: [{ type: 'text', text }] };
}

function mcpJson(data) {
  return mcpText(JSON.stringify(data, null, 2));
}

function mcpError(message) {
  return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
}

async function handleCircleStatus(sb, args) {
  const { circleId } = args;

  // Get circle info
  const { data: circle, error: circleErr } = await sb
    .from('circles')
    .select('id, name, description, created_at, invite_code')
    .eq('id', circleId)
    .single();

  if (circleErr) return mcpError(`Circle not found: ${circleErr.message}`);

  // Get member count
  const { count: memberCount } = await sb
    .from('circle_members')
    .select('id', { count: 'exact', head: true })
    .eq('circle_id', circleId);

  // Get active streaks
  const { data: streaks } = await sb
    .from('user_streaks')
    .select('user_id, current_streak, longest_streak, profiles(display_name, username)')
    .eq('circle_id', circleId)
    .gt('current_streak', 0)
    .order('current_streak', { ascending: false })
    .limit(10);

  return mcpJson({
    circle: {
      id: circle.id,
      name: circle.name,
      description: circle.description,
      created_at: circle.created_at,
    },
    memberCount: memberCount || 0,
    activeStreaks: (streaks || []).map(s => ({
      userId: s.user_id,
      displayName: s.profiles?.display_name || s.profiles?.username || 'Unknown',
      currentStreak: s.current_streak,
      longestStreak: s.longest_streak,
    })),
  });
}

async function handleRecentActivity(sb, args) {
  const { circleId, limit = 20 } = args;

  const { data, error } = await sb
    .from('activity_feed')
    .select('id, user_id, action, detail, created_at, profiles(display_name, username)')
    .eq('circle_id', circleId)
    .order('created_at', { ascending: false })
    .limit(Math.min(limit, 50));

  if (error) return mcpError(`Failed to fetch activity: ${error.message}`);

  return mcpJson({
    circleId,
    entries: (data || []).map(e => ({
      id: e.id,
      userId: e.user_id,
      user: e.profiles?.display_name || e.profiles?.username || 'Unknown',
      action: e.action,
      detail: e.detail,
      timestamp: e.created_at,
    })),
  });
}

async function handleListTasks(sb, args) {
  const { circleId, status, limit = 25 } = args;

  let query = sb
    .from('tasks')
    .select('id, title, description, status, priority, assigned_to, due_date, created_at, updated_at, profiles(display_name, username)')
    .eq('circle_id', circleId)
    .order('updated_at', { ascending: false })
    .limit(Math.min(limit, 50));

  if (status) {
    query = query.eq('status', status);
  }

  const { data, error } = await query;

  if (error) return mcpError(`Failed to fetch tasks: ${error.message}`);

  return mcpJson({
    circleId,
    statusFilter: status || 'all',
    tasks: (data || []).map(t => ({
      id: t.id,
      title: t.title,
      description: t.description,
      status: t.status,
      priority: t.priority,
      assignedTo: t.profiles?.display_name || t.profiles?.username || null,
      dueDate: t.due_date,
      createdAt: t.created_at,
      updatedAt: t.updated_at,
    })),
  });
}

async function handleListMembers(sb, args) {
  const { circleId } = args;

  const { data, error } = await sb
    .from('circle_members')
    .select('user_id, role, joined_at, profiles(display_name, username, avatar_url, last_seen_at)')
    .eq('circle_id', circleId);

  if (error) return mcpError(`Failed to fetch members: ${error.message}`);

  const now = Date.now();
  const ONLINE_THRESHOLD = 5 * 60 * 1000; // 5 minutes

  return mcpJson({
    circleId,
    members: (data || []).map(m => {
      const lastSeen = m.profiles?.last_seen_at;
      const isOnline = lastSeen && (now - new Date(lastSeen).getTime()) < ONLINE_THRESHOLD;
      return {
        userId: m.user_id,
        displayName: m.profiles?.display_name || m.profiles?.username || 'Unknown',
        username: m.profiles?.username || null,
        role: m.role,
        joinedAt: m.joined_at,
        isOnline,
        lastSeen: lastSeen || null,
      };
    }),
  });
}

async function handleSearchMessages(sb, args) {
  const { circleId, query, limit = 20 } = args;

  const { data, error } = await sb
    .from('office_terminal_messages')
    .select('id, sender_name, command_text, status, created_at')
    .eq('circle_id', circleId)
    .ilike('command_text', `%${query}%`)
    .order('created_at', { ascending: false })
    .limit(Math.min(limit, 50));

  if (error) return mcpError(`Failed to search messages: ${error.message}`);

  return mcpJson({
    circleId,
    query,
    results: (data || []).map(m => ({
      id: m.id,
      sender: m.sender_name,
      text: m.command_text,
      status: m.status,
      timestamp: m.created_at,
    })),
  });
}

async function handleGetAutomations(sb, args) {
  const { circleId } = args;

  const { data, error } = await sb
    .from('automations')
    .select('id, name, description, trigger_type, trigger_config, schedule, enabled, last_run_at, last_run_status, created_at')
    .eq('circle_id', circleId)
    .order('created_at', { ascending: false });

  if (error) return mcpError(`Failed to fetch automations: ${error.message}`);

  return mcpJson({
    circleId,
    automations: (data || []).map(a => ({
      id: a.id,
      name: a.name,
      description: a.description,
      triggerType: a.trigger_type,
      schedule: a.schedule,
      enabled: a.enabled,
      lastRunAt: a.last_run_at,
      lastRunStatus: a.last_run_status,
      createdAt: a.created_at,
    })),
  });
}

async function handleGetGithubEvents(sb, args) {
  const { circleId, limit = 20 } = args;

  const { data, error } = await sb
    .from('github_events')
    .select('id, event_type, repo_full_name, sender_login, sender_avatar, title, body, branch, commit_sha, pr_number, action, payload, created_at')
    .eq('circle_id', circleId)
    .order('created_at', { ascending: false })
    .limit(Math.min(limit, 50));

  if (error) return mcpError(`Failed to fetch GitHub events: ${error.message}`);

  return mcpJson({
    circleId,
    events: (data || []).map(e => ({
      id: e.id,
      eventType: e.event_type,
      repo: e.repo_full_name,
      sender: e.sender_login,
      title: e.title,
      body: e.body ? (e.body.length > 200 ? e.body.slice(0, 200) + '...' : e.body) : null,
      branch: e.branch,
      commitSha: e.commit_sha,
      prNumber: e.pr_number,
      action: e.action,
      timestamp: e.created_at,
    })),
  });
}

async function handleGetGoals(sb, args) {
  const { circleId } = args;

  const { data, error } = await sb
    .from('goals')
    .select('id, user_id, title, description, target_date, status, progress, created_at, profiles(display_name, username)')
    .eq('circle_id', circleId)
    .order('created_at', { ascending: false });

  if (error) return mcpError(`Failed to fetch goals: ${error.message}`);

  return mcpJson({
    circleId,
    goals: (data || []).map(g => ({
      id: g.id,
      userId: g.user_id,
      user: g.profiles?.display_name || g.profiles?.username || 'Unknown',
      title: g.title,
      description: g.description,
      targetDate: g.target_date,
      status: g.status,
      progress: g.progress,
      createdAt: g.created_at,
    })),
  });
}

// Tool name -> handler map
const TOOL_HANDLERS = {
  circle_status: handleCircleStatus,
  recent_activity: handleRecentActivity,
  list_tasks: handleListTasks,
  list_members: handleListMembers,
  search_messages: handleSearchMessages,
  get_automations: handleGetAutomations,
  get_github_events: handleGetGithubEvents,
  get_goals: handleGetGoals,
};

// ── Auth helper ─────────────────────────────────────────────────────────────

function extractToken(req) {
  const authHeader = req.headers['authorization'] || '';
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  return null;
}

// ── Request body parser ─────────────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 65536) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

// ── HTTP Server ─────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200, CORS);
    res.end();
    return;
  }

  const url = req.url.split('?')[0];

  // ── GET /health ─────────────────────────────────────────────────────────
  if (url === '/health' && req.method === 'GET') {
    res.writeHead(200, CORS);
    res.end(JSON.stringify({
      ok: true,
      service: 'underground-circle-mcp',
      version: '1.0.0',
      port: PORT,
      tools: TOOLS.length,
      timestamp: new Date().toISOString(),
    }));
    return;
  }

  // ── GET /tools — MCP tool discovery ─────────────────────────────────────
  if (url === '/tools' && req.method === 'GET') {
    res.writeHead(200, CORS);
    res.end(JSON.stringify({ tools: TOOLS }));
    return;
  }

  // ── POST /call — Execute a tool ─────────────────────────────────────────
  if (url === '/call' && req.method === 'POST') {
    // Auth check
    const token = extractToken(req);
    if (!token) {
      res.writeHead(401, CORS);
      res.end(JSON.stringify(mcpError('Missing Authorization header. Use: Bearer <supabase_access_token>')));
      return;
    }

    // Parse body
    let body;
    try {
      const raw = await readBody(req);
      body = JSON.parse(raw);
    } catch (e) {
      res.writeHead(400, CORS);
      res.end(JSON.stringify(mcpError('Invalid JSON body. Expected: { "tool": "...", "arguments": { ... } }')));
      return;
    }

    const { tool, arguments: args } = body;

    if (!tool || typeof tool !== 'string') {
      res.writeHead(400, CORS);
      res.end(JSON.stringify(mcpError('Missing "tool" field')));
      return;
    }

    const handler = TOOL_HANDLERS[tool];
    if (!handler) {
      res.writeHead(400, CORS);
      res.end(JSON.stringify(mcpError(`Unknown tool: "${tool}". Use GET /tools to see available tools.`)));
      return;
    }

    // Validate required args
    const toolDef = TOOLS.find(t => t.name === tool);
    const requiredArgs = toolDef?.inputSchema?.required || [];
    for (const req_arg of requiredArgs) {
      if (!args || !args[req_arg]) {
        res.writeHead(400, CORS);
        res.end(JSON.stringify(mcpError(`Missing required argument: "${req_arg}"`)));
        return;
      }
    }

    // Create authenticated Supabase client
    const sb = createAuthClient(token);

    // Verify the token is valid by getting the user
    const { data: { user }, error: authError } = await sb.auth.getUser(token);
    if (authError || !user) {
      res.writeHead(401, CORS);
      res.end(JSON.stringify(mcpError('Invalid or expired access token')));
      return;
    }

    // Execute the tool
    try {
      const result = await handler(sb, args || {});
      res.writeHead(200, CORS);
      res.end(JSON.stringify(result));
    } catch (e) {
      console.error(`[mcp] Tool "${tool}" error:`, e.message);
      res.writeHead(500, CORS);
      res.end(JSON.stringify(mcpError(`Internal error executing "${tool}": ${e.message}`)));
    }
    return;
  }

  // ── 404 ─────────────────────────────────────────────────────────────────
  res.writeHead(404, CORS);
  res.end(JSON.stringify({
    error: 'Not found',
    endpoints: {
      'GET /health': 'Server status',
      'GET /tools': 'List available MCP tools',
      'POST /call': 'Execute a tool: { "tool": "...", "arguments": { ... } }',
    },
  }));
});

// ── Error handling ──────────────────────────────────────────────────────────

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[mcp] Port ${PORT} already in use. Kill it with: lsof -ti:${PORT} | xargs kill -9`);
    process.exit(1);
  }
  console.error('[mcp] Server error:', err.message);
});

process.on('uncaughtException', (err) => console.error('[mcp] Uncaught:', err.message));
process.on('unhandledRejection', (err) => console.error('[mcp] Unhandled rejection:', err));

// ── Start ───────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`\n  Underground Circle MCP Server`);
  console.log(`  Serving on http://localhost:${PORT}`);
  console.log(`  Supabase: ${SUPABASE_URL}`);
  console.log(`\n  Endpoints:`);
  console.log(`    GET  /health — Server status`);
  console.log(`    GET  /tools  — List available MCP tools (${TOOLS.length} tools)`);
  console.log(`    POST /call   — Execute a tool (requires Bearer token)\n`);
  console.log(`  Tools:`);
  for (const tool of TOOLS) {
    console.log(`    - ${tool.name}: ${tool.description}`);
  }
  console.log('');
});
