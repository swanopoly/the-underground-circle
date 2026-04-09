// Simple CORS proxy for OpenSwan Gateway
// Run: node cors-proxy.js
// Proxies http://localhost:18790 → http://localhost:18789 with CORS headers

const http = require('http');

const PROXY_PORT = 18790;
const TARGET_HOST = '127.0.0.1';
const TARGET_PORT = 18789;

const server = http.createServer((req, res) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    });
    res.end();
    return;
  }

  // Proxy the request
  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', () => {
    const body = Buffer.concat(chunks);

    const proxyReq = http.request({
      hostname: TARGET_HOST,
      port: TARGET_PORT,
      path: req.url,
      method: req.method,
      headers: {
        ...req.headers,
        host: `${TARGET_HOST}:${TARGET_PORT}`,
      },
    }, (proxyRes) => {
      // Add CORS headers to response
      const headers = {
        ...proxyRes.headers,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      };
      res.writeHead(proxyRes.statusCode, headers);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      console.error(`Proxy error: ${err.message}`);
      res.writeHead(502, {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      });
      res.end(JSON.stringify({ ok: false, error: { type: 'proxy_error', message: err.message } }));
    });

    if (body.length > 0) proxyReq.write(body);
    proxyReq.end();
  });
});

server.listen(PROXY_PORT, () => {
  console.log(`🔀 CORS Proxy running on http://localhost:${PROXY_PORT}`);
  console.log(`   → Forwarding to http://${TARGET_HOST}:${TARGET_PORT}`);
  console.log(`   Use http://localhost:${PROXY_PORT} as your endpoint in The Underground Circle`);
});
