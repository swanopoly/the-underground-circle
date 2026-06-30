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

// ─── Origin allowlist ───────────────────────────────────────────────────────
// This proxy injects the real local gateway token on every forwarded request,
// so it must not be reachable by arbitrary web pages. Wildcard CORS plus
// Private Network Access previously let ANY site the user visited drive their
// local OpenSwan gateway with full credentials (drive-by CSRF into the local
// agent runtime). We now allow only the app's own origins; browser requests
// from anywhere else are refused before the token is attached. Non-browser
// callers (native app, curl) send no Origin header and are unaffected — a
// malicious website's fetch always carries its Origin, so it cannot slip past.
const ALLOWED_ORIGINS = new Set([
  'http://localhost:8081',
  'http://127.0.0.1:8081',
  'https://app.chrisswanson.xyz',
  ...(process.env.OPENSWAN_PROXY_ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
]);

function isAllowedOrigin(origin) {
  return !!origin && ALLOWED_ORIGINS.has(origin);
}

// Echo the specific allow-listed origin (never '*', which is unsafe alongside
// credentials / Private Network Access). Returns {} for disallowed origins so
// no CORS-allow headers are emitted.
function corsHeadersFor(origin) {
  if (!isAllowedOrigin(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-openswan-agent-id, x-openswan-session-key',
    // Private Network Access — required for the live HTTPS site to talk to this
    // localhost proxy without silent Chrome blocking (allow-listed origins only).
    'Access-Control-Allow-Private-Network': 'true',
  };
}

// ─── HTTP server ───────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  const origin = req.headers.origin || '';
  const cors = corsHeadersFor(origin);

  // Preflight
  if (req.method === 'OPTIONS') {
    if (origin && !isAllowedOrigin(origin)) {
      res.writeHead(403);
      res.end();
      return;
    }
    res.writeHead(204, cors);
    res.end();
    return;
  }

  // Refuse cross-origin browser requests from non-allow-listed sites BEFORE
  // the trusted gateway token is attached — this is the CSRF/SSRF gate.
  if (origin && !isAllowedOrigin(origin)) {
    console.warn(`[proxy] HTTP rejected disallowed origin: ${origin}`);
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'origin_not_allowed' }));
    return;
  }

  // Build forwarded headers, injecting auth token.
  // When the local config token is loaded we always overwrite — the gateway
  // is a trusted local process and stale client tokens (from prior installs
  // or from the browser's cached OpenSwanConfig) otherwise survive the hop
  // and produce 401s that `authFailedEndpointCache` then latches on the
  // client side, disabling sessions_list for the rest of the session.
  const fwdHeaders = { ...req.headers, host: `${GATEWAY_HOST}:${GATEWAY_PORT}` };
  if (GATEWAY_TOKEN) {
    fwdHeaders['authorization'] = `Bearer ${GATEWAY_TOKEN}`;
  }

  const options = {
    hostname: GATEWAY_HOST,
    port:     GATEWAY_PORT,
    path:     req.url,
    method:   req.method,
    headers:  fwdHeaders,
  };

  const proxyReq = http.request(options, (proxyRes) => {
    const headers = { ...proxyRes.headers, ...cors };
    res.writeHead(proxyRes.statusCode || 200, headers);
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on('error', (err) => {
    console.error('[proxy] HTTP error:', err.message);
    if (!res.headersSent) {
      res.writeHead(502, cors);
      res.end(JSON.stringify({ error: 'Gateway unreachable', detail: err.message }));
    }
  });

  req.pipe(proxyReq, { end: true });
});

// ─── WebSocket proxy ──────────────────────────────────────────────────────────

const wss = new WebSocketServer({
  server,
  // Reject WS upgrades from non-allow-listed browser origins before the gateway
  // token is injected. Native clients send no Origin and pass through.
  verifyClient: (info, done) => {
    const origin = info.req.headers.origin || '';
    if (origin && !isAllowedOrigin(origin)) {
      console.warn(`[proxy] WS rejected disallowed origin: ${origin}`);
      return done(false, 403, 'origin_not_allowed');
    }
    return done(true);
  },
});

wss.on('connection', (clientWs, req) => {
  const targetUrl = `ws://${GATEWAY_HOST}:${GATEWAY_PORT}${req.url}`;
  console.log(`[proxy] WS connect → ${targetUrl}`);

  // Same token-injection behavior as the HTTP path. Without this, the WS
  // upgrade lands on the gateway with whatever stale/empty token the client
  // sent, and the gateway either rejects the upgrade or silently 403s on
  // the first message — the user just sees "connection closed" with no
  // auth error to act on.
  const wsHeaders = { ...req.headers, host: `${GATEWAY_HOST}:${GATEWAY_PORT}` };
  if (GATEWAY_TOKEN) {
    wsHeaders['authorization'] = `Bearer ${GATEWAY_TOKEN}`;
  }

  const gatewayWs = new WebSocket(targetUrl, {
    headers: wsHeaders,
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
