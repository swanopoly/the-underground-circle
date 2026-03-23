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
const os = require('os');
const path = require('path');

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
  const req = https.request({
    hostname: url.hostname,
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
            version: '1.0.0',
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

    try {
      const req = JSON.parse(line);
      const res = handleRequest(req);
      if (res) {
        process.stdout.write(JSON.stringify(res) + '\n');
      }
    } catch (err) {
      process.stderr.write(`[uc-mcp] Parse error: ${err.message}\n`);
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
