/**
 * OpenSwan CORS + WebSocket Proxy
 * Bridges the web app (localhost:8081) → OpenSwan Gateway (localhost:18789)
 * Handles both HTTP REST and WebSocket upgrade connections.
 *
 * Run: node openswan-proxy.js
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const WebSocket = require('./node_modules/ws');
const WebSocketServer = WebSocket.Server;
const { URL } = require('url');

const GATEWAY_HOST = 'localhost';
const GATEWAY_PORT = 18789;
const PROXY_PORT   = 18790;

// ─── Auto-load gateway auth token from OpenClaw/OpenSwan config ─────────────
let GATEWAY_TOKEN = '';
const CONFIG_PATHS = [
  path.join(os.homedir(), '.openclaw', 'openclaw.json'),
  path.join(os.homedir(), '.openswan', 'openswan.json'),
];
for (const configPath of CONFIG_PATHS) {
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    GATEWAY_TOKEN = config?.gateway?.auth?.token || '';
    if (GATEWAY_TOKEN) {
      console.log(`[proxy] Auth token loaded from ${configPath}`);
      break;
    }
  } catch {}
}
if (!GATEWAY_TOKEN) {
  console.warn('[proxy] No auth token found — checked:', CONFIG_PATHS.join(', '));
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-openswan-agent-id, x-openswan-session-key',
};

// ─── HTTP server ───────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  // Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200, CORS_HEADERS);
    res.end();
    return;
  }

  // Build forwarded headers, injecting auth token if missing or empty
  const fwdHeaders = { ...req.headers, host: `${GATEWAY_HOST}:${GATEWAY_PORT}` };
  if (GATEWAY_TOKEN) {
    const auth = fwdHeaders['authorization'] || '';
    if (!auth || auth === 'Bearer' || auth === 'Bearer ') {
      fwdHeaders['authorization'] = `Bearer ${GATEWAY_TOKEN}`;
    }
  }

  const options = {
    hostname: GATEWAY_HOST,
    port:     GATEWAY_PORT,
    path:     req.url,
    method:   req.method,
    headers:  fwdHeaders,
  };

  const proxyReq = http.request(options, (proxyRes) => {
    const headers = { ...proxyRes.headers, ...CORS_HEADERS };
    res.writeHead(proxyRes.statusCode || 200, headers);
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on('error', (err) => {
    console.error('[proxy] HTTP error:', err.message);
    if (!res.headersSent) {
      res.writeHead(502, CORS_HEADERS);
      res.end(JSON.stringify({ error: 'Gateway unreachable', detail: err.message }));
    }
  });

  req.pipe(proxyReq, { end: true });
});

// ─── WebSocket proxy ──────────────────────────────────────────────────────────

const wss = new WebSocketServer({ server });

wss.on('connection', (clientWs, req) => {
  const targetUrl = `ws://${GATEWAY_HOST}:${GATEWAY_PORT}${req.url}`;
  console.log(`[proxy] WS connect → ${targetUrl}`);

  const gatewayWs = new WebSocket(targetUrl, {
    headers: { ...req.headers, host: `${GATEWAY_HOST}:${GATEWAY_PORT}` },
  });

  // Forward client → gateway
  clientWs.on('message', (data, isBinary) => {
    if (gatewayWs.readyState === WebSocket.OPEN) {
      gatewayWs.send(data, { binary: isBinary });
    }
  });

  // Forward gateway → client
  gatewayWs.on('message', (data, isBinary) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(data, { binary: isBinary });
    }
  });

  gatewayWs.on('open', () => {
    console.log('[proxy] WS gateway connected');
  });

  gatewayWs.on('close', (code, reason) => {
    console.log(`[proxy] WS gateway closed (${code})`);
    if (clientWs.readyState === WebSocket.OPEN) clientWs.close(code, reason);
  });

  gatewayWs.on('error', (err) => {
    console.error('[proxy] WS gateway error:', err.message);
    if (clientWs.readyState === WebSocket.OPEN) clientWs.close(1011, 'Gateway error');
  });

  clientWs.on('close', (code, reason) => {
    if (gatewayWs.readyState === WebSocket.OPEN) gatewayWs.close(code, reason);
  });

  clientWs.on('error', (err) => {
    console.error('[proxy] WS client error:', err.message);
    if (gatewayWs.readyState === WebSocket.OPEN) gatewayWs.close(1011);
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PROXY_PORT} already in use — kill it with: lsof -ti:${PROXY_PORT} | xargs kill -9`);
    process.exit(1);
  }
  console.error('[proxy] Server error:', err.message);
});

process.on('uncaughtException', (err) => console.error('[proxy] Uncaught:', err.message));
process.on('unhandledRejection', (r) => console.error('[proxy] Unhandled rejection:', r));

server.listen(PROXY_PORT, () => {
  console.log(`🦢 OpenSwan CORS+WS Proxy → http://localhost:${PROXY_PORT}`);
  console.log(`   Forwarding to ws://${GATEWAY_HOST}:${GATEWAY_PORT}`);
  console.log(`   Use http://localhost:${PROXY_PORT} as your endpoint in the app`);
});
