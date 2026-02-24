// CORS proxy for OpenClaw Gateway with error handling
// Run: node openclaw-proxy.js
// Then use http://localhost:18790 as your endpoint in the app

const http = require('http');

const OPENCLAW_GATEWAY = 'http://localhost:18789';
const PROXY_PORT = 18790;

const server = http.createServer((req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-openclaw-agent-id, x-openclaw-session-key');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Proxy to OpenClaw
  const options = {
    hostname: 'localhost',
    port: 18789,
    path: req.url,
    method: req.method,
    headers: req.headers,
  };

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error('Proxy error:', err.message);
    if (!res.headersSent) {
      res.writeHead(502);
      res.end(JSON.stringify({ error: 'Gateway unreachable' }));
    }
  });

  req.on('error', (err) => {
    console.error('Request error:', err.message);
  });

  req.pipe(proxyReq);
});

// Error handlers
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PROXY_PORT} is already in use`);
    process.exit(1);
  } else {
    console.error('Server error:', err.message);
  }
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

server.listen(PROXY_PORT, () => {
  console.log(`🦢 OpenClaw CORS Proxy running on http://localhost:${PROXY_PORT}`);
  console.log(`   Forwarding to ${OPENCLAW_GATEWAY}`);
});
