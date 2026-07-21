#!/usr/bin/env node
/**
 * Underground Circle — MCP Agent Connect Server
 *
 * A Model Context Protocol (MCP) server that:
 *  1. Reports agent presence to the circle via heartbeats
 *  2. Exposes circle context as tools the agent can call
 *  3. Works with Claude Code, Codex, Gemini CLI, or any MCP-compatible agent
 *
 * Usage:
 *   claude mcp add --transport stdio uc-connect \
 *     --env UC_CONNECT_TOKEN=<token> \
 *     -- node scripts/mcp-agent-connect.js
 *
 *   Or via npx (when published):
 *     claude mcp add --transport stdio uc-connect \
 *       --env UC_CONNECT_TOKEN=<token> \
 *       -- npx @underground-circle/agent-connect
 *
 * Environment:
 *   UC_CONNECT_TOKEN  — Required. Your connect token from the app.
 *   UC_AGENT_TYPE     — Optional. Default: "claude-code"
 *   UC_SUPABASE_URL   — Optional. Override Supabase URL.
 *
 * Zero npm dependencies (Node.js built-ins only).
 */

const https = require('https');
const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');

// ── Config ──────────────────────────────────────────────────────────────────

const CONNECT_TOKEN = process.env.UC_CONNECT_TOKEN;
const AGENT_TYPE = process.env.UC_AGENT_TYPE || 'claude-code';
const SUPABASE_URL = process.env.UC_SUPABASE_URL || 'https://rjkniqiqdtroeholxacg.supabase.co';
const AGENT_CONNECT_URL = `${SUPABASE_URL}/functions/v1/agent-connect`;
const HEARTBEAT_INTERVAL = 30_000; // 30s

if (!CONNECT_TOKEN) {
  process.stderr.write('[uc-mcp] ERROR: UC_CONNECT_TOKEN not set\n');
  process.exit(1);
}

// http vs https picked from UC_SUPABASE_URL so tests/dev can point at a local
// mock server. Production URLs are https, so behavior there is unchanged.
const TRANSPORT = AGENT_CONNECT_URL.startsWith('http://') ? http : https;

// ── State ───────────────────────────────────────────────────────────────────

let heartbeatTimer = null;
let lastTask = '';
let circleData = null; // Cached circle context

// ── Heartbeat ───────────────────────────────────────────────────────────────

function sendHeartbeat(event = 'heartbeat', extra = {}) {
  const payload = JSON.stringify({
    event,
    agent_type: AGENT_TYPE,
    cwd: process.cwd(),
    ...extra,
  });

  const url = new URL(AGENT_CONNECT_URL);
  const req = TRANSPORT.request({
    hostname: url.hostname,
    port: url.port || undefined,
    path: url.pathname,
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CONNECT_TOKEN}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    },
  }, (res) => {
    let body = '';
    res.on('data', c => body += c);
    res.on('end', () => {
      try {
        const data = JSON.parse(body);
        if (data.circle_id && !circleData) {
          circleData = { circleId: data.circle_id };
        }
      } catch {}
    });
  });
  req.on('error', () => {}); // Silent fail
  req.setTimeout(5000, () => req.destroy());
  req.write(payload);
  req.end();
}

function startHeartbeat() {
  sendHeartbeat('session_start', { task: `MCP server started in ${path.basename(process.cwd())}` });
  heartbeatTimer = setInterval(() => {
    sendHeartbeat('heartbeat', lastTask ? { task: lastTask } : {});
  }, HEARTBEAT_INTERVAL);
}

function stopHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  sendHeartbeat('session_end');
}

// ── Server read ops (MCP v2 read tools) ─────────────────────────────────────
// Unlike heartbeats (fire-and-forget), read tools need the response body.
// POSTs { event: "read_op", op } to the same agent-connect edge function with
// the same Bearer token; the server validates token + circle membership before
// answering, and returns only bounded, allowlisted fields.

function postReadOp(op) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      event: 'read_op',
      op,
      agent_type: AGENT_TYPE,
      cwd: process.cwd(),
    });

    const url = new URL(AGENT_CONNECT_URL);
    const req = TRANSPORT.request({
      hostname: url.hostname,
      port: url.port || undefined,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CONNECT_TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        let data = null;
        try { data = JSON.parse(body); } catch { /* non-JSON body */ }
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300 && data) {
          if (data.circle_id && !circleData) circleData = { circleId: data.circle_id };
          resolve(data);
        } else {
          const msg = (data && (data.error || data.code)) || `HTTP ${res.statusCode}`;
          reject(new Error(String(msg)));
        }
      });
    });
    req.on('error', (err) => reject(new Error(err && err.message ? err.message : 'network error')));
    req.setTimeout(10_000, () => { req.destroy(new Error('request timed out')); });
    req.write(payload);
    req.end();
  });
}

function truncateText(value, max) {
  const s = value == null ? '' : String(value);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function agoText(iso) {
  const t = Date.parse(String(iso || ''));
  if (!Number.isFinite(t)) return 'unknown age';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

function toolTextResult(id, text, isError) {
  const result = { content: [{ type: 'text', text }] };
  if (isError) result.isError = true;
  return { jsonrpc: '2.0', id, result };
}

// ── Local file-lease registry (multi-agent coordination awareness) ──────────
// Reads the SAME registry the coordination runtime writes:
// `<repoRoot>/.uc/agent-locks.json` (see src/lib/agentFileCoordination.ts and
// scripts/agent-coordination.ts). Shape: { version: 1, leases: { [path]: {
// path, ownerId, ownerLabel, acquiredAt, renewedAt, expiresAt, contentHash,
// intent } } }. Read-only here — never writes, never invents a new format.

function findLeaseRegistryPath() {
  let dir = process.cwd();
  for (let i = 0; i < 12; i += 1) {
    const candidate = path.join(dir, '.uc', 'agent-locks.json');
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch { /* unreadable dir */ }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function listActiveFileLeases() {
  const registryPath = findLeaseRegistryPath();
  if (!registryPath) {
    return { registryPath: path.join(process.cwd(), '.uc', 'agent-locks.json'), leases: [], missing: true };
  }
  let parsed = null;
  try {
    parsed = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  } catch {
    return { registryPath, leases: [], missing: false };
  }
  const now = Date.now();
  const all = parsed && parsed.leases && typeof parsed.leases === 'object' ? Object.values(parsed.leases) : [];
  const live = all
    .filter((l) => l && typeof l === 'object' && Number(l.expiresAt) >= now)
    .sort((a, b) => Number(b.renewedAt || 0) - Number(a.renewedAt || 0))
    .slice(0, 20)
    .map((l) => ({
      path: truncateText(l.path, 300),
      ownerLabel: truncateText(l.ownerLabel, 80),
      intent: truncateText(l.intent, 200),
      expiresInSeconds: Math.max(0, Math.round((Number(l.expiresAt) - now) / 1000)),
    }));
  return { registryPath, leases: live, missing: false };
}

// ── MCP Protocol (stdio JSON-RPC) ──────────────────────────────────────────

const TOOLS = [
  {
    name: 'uc_report_progress',
    description: 'Report what you are currently working on to your circle. Call this whenever you start a new task or make significant progress.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'What you are currently doing (e.g., "Refactoring auth module")' },
        status: { type: 'string', enum: ['building', 'idle', 'done'], description: 'Current status' },
      },
      required: ['task'],
    },
  },
  {
    name: 'uc_get_circle_info',
    description: 'Get information about your Underground Circle — who is online, recent activity, and current tasks.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'uc_post_update',
    description: 'Post a message to your circle\'s activity feed. Use this to share updates, findings, or ask for help.',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'The message to post (supports markdown)' },
        type: { type: 'string', enum: ['info', 'alert', 'celebration'], description: 'Message type' },
      },
      required: ['message'],
    },
  },
  {
    name: 'uc_list_file_leases',
    description: 'List files currently claimed by other agents working in this repo (advisory lease registry at .uc/agent-locks.json). Check before editing shared files so concurrent agents do not clobber each other.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'uc_list_pending_approvals',
    description: 'List pending human-approval requests in your circle (agent actions waiting on a yes/no). Returns id, kind, title, requester, and age — never the action payload.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'uc_list_skills',
    description: 'List reusable skills in your circle\'s skill library (metadata only: name, description, version, tags, usage counts).',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'uc_get_circle_live_info',
    description: 'Fetch live info about your circle from the server: circle name, member count, today\'s check-ins and messages, and which agents are online with their current tasks.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

// Handle a single JSON-RPC request
function handleRequest(req) {
  const { method, params, id } = req;

  switch (method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: {
            name: 'underground-circle-agent-connect',
            version: '1.1.0',
          },
        },
      };

    case 'notifications/initialized':
      // Client acknowledged — start heartbeat
      startHeartbeat();
      return null; // Notifications don't get responses

    case 'tools/list':
      return {
        jsonrpc: '2.0',
        id,
        result: { tools: TOOLS },
      };

    case 'tools/call':
      return handleToolCall(id, params);

    case 'ping':
      return { jsonrpc: '2.0', id, result: {} };

    default:
      // Unknown method — return error
      if (id !== undefined) {
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        };
      }
      return null; // Unknown notification — ignore
  }
}

function handleToolCall(id, params) {
  const { name, arguments: args } = params || {};

  switch (name) {
    case 'uc_report_progress': {
      const task = args?.task || 'Working...';
      const status = args?.status || 'building';
      lastTask = task;
      sendHeartbeat('tool_use', { task, tool_name: 'report_progress' });
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{
            type: 'text',
            text: `Reported to circle: "${task}" (${status})`,
          }],
        },
      };
    }

    case 'uc_get_circle_info': {
      // Return cached info + current state
      const info = [
        `Agent: ${AGENT_TYPE}`,
        `Working directory: ${process.cwd()}`,
        `Heartbeat: active (every ${HEARTBEAT_INTERVAL / 1000}s)`,
        circleData?.circleId ? `Circle ID: ${circleData.circleId}` : 'Circle: connecting...',
        lastTask ? `Last reported task: ${lastTask}` : 'No task reported yet',
      ].join('\n');

      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: info }],
        },
      };
    }

    case 'uc_post_update': {
      const message = args?.message || '';
      const type = args?.type || 'info';
      // Post via heartbeat with special event
      sendHeartbeat('tool_use', {
        task: `Posted: ${message.slice(0, 80)}`,
        tool_name: 'post_update',
      });
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{
            type: 'text',
            text: `Posted to circle feed: "${message.slice(0, 100)}${message.length > 100 ? '...' : ''}"`,
          }],
        },
      };
    }

    case 'uc_list_file_leases': {
      const { registryPath, leases, missing } = listActiveFileLeases();
      if (missing) {
        return toolTextResult(id, `No file-lease registry found (looked for .uc/agent-locks.json from ${process.cwd()} upward). No agents have claimed files here.`);
      }
      if (leases.length === 0) {
        return toolTextResult(id, `No active file leases in ${registryPath} — no other agent has claimed a file right now.`);
      }
      const lines = leases.map((l) => `- ${l.path} — held by ${l.ownerLabel || 'unknown agent'}${l.intent ? ` (${l.intent})` : ''}, expires in ${l.expiresInSeconds}s`);
      return toolTextResult(id, `${leases.length} active file lease(s) in ${registryPath}:\n${lines.join('\n')}\nAvoid editing these files until the lease expires or is released.`);
    }

    case 'uc_list_pending_approvals': {
      return postReadOp('list_pending_approvals').then((data) => {
        const rows = Array.isArray(data.approvals) ? data.approvals.slice(0, 20) : [];
        if (rows.length === 0) return toolTextResult(id, 'No pending approvals in your circle.');
        const lines = rows.map((a) => `- [${truncateText(a.kind, 40) || 'action'}] ${truncateText(a.title, 300) || '(untitled)'} — requested by ${truncateText(a.requester, 80) || 'unknown'}, ${agoText(a.requested_at)} (id: ${a.id})`);
        return toolTextResult(id, `${rows.length} pending approval(s) waiting on a human:\n${lines.join('\n')}`);
      }).catch((err) => toolTextResult(id, `Could not fetch pending approvals: ${err.message}`, true));
    }

    case 'uc_list_skills': {
      return postReadOp('list_skills').then((data) => {
        const rows = Array.isArray(data.skills) ? data.skills.slice(0, 20) : [];
        if (rows.length === 0) return toolTextResult(id, 'No skills in your circle\'s skill library yet.');
        const lines = rows.map((s) => {
          const tags = Array.isArray(s.tags) && s.tags.length ? ` [${s.tags.slice(0, 10).join(', ')}]` : '';
          return `- ${truncateText(s.name, 120)} v${truncateText(s.version, 20) || '?'}${tags} — ${truncateText(s.description, 300) || 'no description'} (used ${Number(s.usage_count) || 0}x)`;
        });
        return toolTextResult(id, `${rows.length} skill(s) in the circle library:\n${lines.join('\n')}`);
      }).catch((err) => toolTextResult(id, `Could not fetch skills: ${err.message}`, true));
    }

    case 'uc_get_circle_live_info': {
      return postReadOp('circle_live_info').then((data) => {
        const circle = data.circle || {};
        const agents = Array.isArray(data.agents) ? data.agents.slice(0, 10) : [];
        const lines = [
          `Circle: ${truncateText(circle.name, 120) || 'unknown'} (${circle.id || 'no id'})`,
          `Members: ${Number(data.total_members) || 0}`,
          `Today: ${Number(data.today_check_ins) || 0} check-in(s), ${Number(data.today_messages) || 0} message(s)`,
        ];
        if (agents.length === 0) {
          lines.push('Agents: none seen recently');
        } else {
          lines.push('Recently active agents:');
          for (const a of agents) {
            lines.push(`- ${truncateText(a.name, 80) || 'agent'} (${truncateText(a.status, 20) || 'unknown'}) — ${truncateText(a.current_task, 160) || 'no task reported'}, last active ${agoText(a.last_active_at)}`);
          }
        }
        return toolTextResult(id, lines.join('\n'));
      }).catch((err) => toolTextResult(id, `Could not fetch circle info: ${err.message}`, true));
    }

    default:
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Unknown tool: ${name}` },
      };
  }
}

// ── stdio transport ─────────────────────────────────────────────────────────

let buffer = '';

process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;

  // MCP uses newline-delimited JSON
  let newlineIdx;
  while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, newlineIdx).trim();
    buffer = buffer.slice(newlineIdx + 1);

    if (!line) continue;

    let req = null;
    try {
      req = JSON.parse(line);
    } catch (err) {
      process.stderr.write(`[uc-mcp] Parse error: ${err.message}\n`);
      continue;
    }

    // Handlers may return a response object (sync tools) or a Promise of one
    // (server-backed read tools). Responses are correlated by JSON-RPC id, so
    // async completions may write out of arrival order — that is legal.
    try {
      Promise.resolve(handleRequest(req)).then((res) => {
        if (res) process.stdout.write(JSON.stringify(res) + '\n');
      }).catch((err) => {
        if (req && req.id !== undefined) {
          process.stdout.write(JSON.stringify({
            jsonrpc: '2.0',
            id: req.id,
            error: { code: -32603, message: `Internal error: ${err && err.message ? err.message : String(err)}` },
          }) + '\n');
        }
      });
    } catch (err) {
      if (req && req.id !== undefined) {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: req.id,
          error: { code: -32603, message: `Internal error: ${err.message}` },
        }) + '\n');
      }
    }
  }
});

process.stdin.on('end', () => {
  stopHeartbeat();
  process.exit(0);
});

process.on('SIGTERM', () => { stopHeartbeat(); process.exit(0); });
process.on('SIGINT', () => { stopHeartbeat(); process.exit(0); });

process.stderr.write(`[uc-mcp] Underground Circle MCP server started\n`);
process.stderr.write(`[uc-mcp] Agent: ${AGENT_TYPE} | CWD: ${process.cwd()}\n`);
process.stderr.write(`[uc-mcp] Heartbeat: every ${HEARTBEAT_INTERVAL / 1000}s → ${AGENT_CONNECT_URL}\n`);
