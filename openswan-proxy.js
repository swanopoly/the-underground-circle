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
const {
  isAllowedBridgeHostHeader,
  isLoopbackRequest,
} = require('./scripts/desktop-bridge-security');

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

// ─── Request source gate ───────────────────────────────────────────────────
//
// The Origin allowlist alone is NOT sufficient, because it only inspects a
// header the attacker can simply omit:
//
//   * A same-origin GET carries no Origin at all. A page on evil.com whose DNS
//     re-resolves to 127.0.0.1 (classic DNS rebinding) therefore reaches this
//     proxy as a same-origin request, passes the `origin &&` gate by having no
//     Origin, and gets the real gateway token attached. Verified reachable
//     2026-08-06: `Host: evil.com:18790` with no Origin returned HTTP 200.
//   * Any non-browser client sends no Origin either.
//
// Validating the Host header is what actually stops rebinding: the browser
// sends the name the page was loaded from, and only a genuine
// localhost/127.0.0.1/[::1] address can name this listener. This mirrors
// `isBridgeRequestSourceAllowed`, which the four bridges already use.
function checkProxyRequestSource(req) {
  if (!isLoopbackRequest(req)) return { ok: false, code: 'proxy_non_loopback_source' };
  if (!isAllowedBridgeHostHeader(req?.headers?.host, PROXY_PORT)) {
    return { ok: false, code: 'proxy_host_blocked' };
  }
  const origin = req?.headers?.origin || '';
  if (origin && !isAllowedOrigin(origin)) return { ok: false, code: 'proxy_origin_blocked' };
  return { ok: true };
}

// ─── HTTP server ───────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  const origin = req.headers.origin || '';
  const cors = corsHeadersFor(origin);

  // Preflight
  if (req.method === 'OPTIONS') {
    if (!checkProxyRequestSource(req).ok) {
      res.writeHead(403);
      res.end();
      return;
    }
    res.writeHead(204, cors);
    res.end();
    return;
  }

  // Refuse anything that is not a genuine loopback request naming this
  // listener BEFORE the trusted gateway token is attached — this is the
  // CSRF/SSRF/DNS-rebinding gate.
  const sourceCheck = checkProxyRequestSource(req);
  if (!sourceCheck.ok) {
    console.warn(`[proxy] HTTP rejected (${sourceCheck.code}) origin=${origin || '(none)'} host=${req.headers.host || '(none)'}`);
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: sourceCheck.code }));
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
    // Same gate as the HTTP path. A WebSocket upgrade from a browser always
    // carries Origin, but a non-browser client (or a rebound page reaching a
    // raw socket) does not — Host validation is what closes that.
    const sourceCheck = checkProxyRequestSource(info.req);
    if (!sourceCheck.ok) {
      console.warn(`[proxy] WS rejected (${sourceCheck.code}) origin=${info.req.headers.origin || '(none)'} host=${info.req.headers.host || '(none)'}`);
      return done(false, 403, sourceCheck.code);
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

// SECURITY: bind LOOPBACK ONLY.
//
// `server.listen(PORT)` with no host binds 0.0.0.0/:: — every network
// interface. This proxy injects the real gateway bearer token into every
// forwarded request, and the Origin allowlist is its only gate. A browser
// always sends Origin (so a malicious page is blocked), but any NON-browser
// client sends none and was therefore forwarded WITH FULL GATEWAY
// CREDENTIALS. Verified exploitable 2026-08-06: an unauthenticated POST to
// http://<this-machine-LAN-IP>:18790/tools/invoke from the local network
// returned live session data. Anyone on the same Wi-Fi (coffee shop, office,
// hotel) had credentialed access to the coding/file tool surface.
//
// The four bridges already hardcode 127.0.0.1; this was the one listener that
// did not. The app connects via http://localhost:18790, so loopback binding
// is behavior-identical for every legitimate caller.
const PROXY_BIND_HOST = '127.0.0.1';
server.listen(PROXY_PORT, PROXY_BIND_HOST, () => {
  console.log(`🦢 OpenSwan CORS+WS Proxy → http://localhost:${PROXY_PORT} (loopback only)`);
  console.log(`   Forwarding to ws://${GATEWAY_HOST}:${GATEWAY_PORT}`);
  console.log(`   Use http://localhost:${PROXY_PORT} as your endpoint in the app`);
});
