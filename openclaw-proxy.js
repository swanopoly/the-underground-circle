// Simple CORS proxy for OpenClaw Gateway
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
    console.error('Proxy error:', err);
    res.writeHead(502);
    res.end('Bad Gateway');
  });

  req.pipe(proxyReq);
});

server.listen(PROXY_PORT, () => {
  console.log(`🦢 OpenClaw CORS Proxy running on http://localhost:${PROXY_PORT}`);
  console.log(`   Forwarding to ${OPENCLAW_GATEWAY}`);
});
