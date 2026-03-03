#!/usr/bin/env node
/**
 * BlackSwan Bridge — HTTP proxy to local Ollama/vLLM on port 7779.
 *
 * Auto-detects backend:
 *   - vLLM on :8000 (preferred, higher throughput)
 *   - Ollama on :11434 (fallback)
 *
 * Exposes OpenAI-compatible /v1/chat/completions endpoint.
 *
 * Usage:
 *   node blackswan-bridge.js
 *   # or with env overrides:
 *   BRIDGE_PORT=7779 OLLAMA_URL=http://localhost:11434 node blackswan-bridge.js
 */

const http = require('http');

const BRIDGE_PORT = parseInt(process.env.BRIDGE_PORT || '7779', 10);
const VLLM_URL = process.env.VLLM_URL || 'http://localhost:8000';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const MODEL_NAME = process.env.MODEL_NAME || 'blackswan';

let activeBackend = null; // 'vllm' | 'ollama' | null
let lastHealthCheck = 0;

// ─── Health check backends ──────────────────────────────────────────────────

async function checkBackend(url, timeout = 2000) {
  return new Promise((resolve) => {
    const parsedUrl = new URL(url);
    const req = http.request(
      {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: '/health',
        method: 'GET',
        timeout,
      },
      (res) => {
        resolve(res.statusCode === 200);
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

async function detectBackend() {
  // Check vLLM first (higher throughput)
  if (await checkBackend(VLLM_URL)) {
    activeBackend = 'vllm';
    return VLLM_URL;
  }

  // Check Ollama (also responds on /api/tags)
  const ollamaUp = await new Promise((resolve) => {
    const parsedUrl = new URL(OLLAMA_URL);
    const req = http.request(
      {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: '/api/tags',
        method: 'GET',
        timeout: 2000,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve(res.statusCode === 200));
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });

  if (ollamaUp) {
    activeBackend = 'ollama';
    return OLLAMA_URL;
  }

  activeBackend = null;
  return null;
}

// ─── Proxy request to backend ───────────────────────────────────────────────

function proxyRequest(backendUrl, path, method, headers, body) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(backendUrl);
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      timeout: 60000,
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        resolve({ status: res.statusCode, headers: res.headers, body: data });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Backend timeout')); });

    if (body) req.write(body);
    req.end();
  });
}

// ─── Request handler ────────────────────────────────────────────────────────

async function handleRequest(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health endpoint
  if (req.url === '/health') {
    const now = Date.now();
    // Re-check backend every 30s
    if (now - lastHealthCheck > 30000) {
      await detectBackend();
      lastHealthCheck = now;
    }

    const healthy = activeBackend !== null;
    res.writeHead(healthy ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: healthy ? 'ok' : 'no_backend',
      backend: activeBackend,
      model: MODEL_NAME,
      timestamp: new Date().toISOString(),
    }));
    return;
  }

  // Chat completions
  if (req.url === '/v1/chat/completions' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', async () => {
      try {
        const parsed = JSON.parse(body);

        // Force model name
        parsed.model = MODEL_NAME;

        // Detect backend if needed
        if (!activeBackend) {
          await detectBackend();
        }

        if (!activeBackend) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: { message: 'No backend available. Start Ollama or vLLM first.', type: 'server_error' },
          }));
          return;
        }

        const backendUrl = activeBackend === 'vllm' ? VLLM_URL : OLLAMA_URL;
        let path = '/v1/chat/completions';

        // Ollama uses a different endpoint
        if (activeBackend === 'ollama') {
          path = '/api/chat';

          // Convert OpenAI format to Ollama format
          const ollamaBody = {
            model: MODEL_NAME,
            messages: parsed.messages || [],
            stream: false,
            options: {
              temperature: parsed.temperature || 0.7,
              top_p: parsed.top_p || 0.9,
              num_predict: parsed.max_tokens || 500,
            },
          };

          const result = await proxyRequest(backendUrl, path, 'POST', {}, JSON.stringify(ollamaBody));

          // Convert Ollama response back to OpenAI format
          const ollamaResp = JSON.parse(result.body);
          const openaiResp = {
            id: `chatcmpl-${Date.now()}`,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: MODEL_NAME,
            choices: [{
              index: 0,
              message: {
                role: 'assistant',
                content: ollamaResp.message?.content || '',
              },
              finish_reason: ollamaResp.done ? 'stop' : 'length',
            }],
            usage: {
              prompt_tokens: ollamaResp.prompt_eval_count || 0,
              completion_tokens: ollamaResp.eval_count || 0,
              total_tokens: (ollamaResp.prompt_eval_count || 0) + (ollamaResp.eval_count || 0),
            },
          };

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(openaiResp));
          return;
        }

        // vLLM already speaks OpenAI format
        const result = await proxyRequest(backendUrl, path, 'POST', {}, JSON.stringify(parsed));
        res.writeHead(result.status, { 'Content-Type': 'application/json' });
        res.end(result.body);
      } catch (err) {
        console.error('[bridge] Error:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: { message: err.message, type: 'server_error' },
        }));
      }
    });
    return;
  }

  // 404 for everything else
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { message: 'Not found', type: 'not_found' } }));
}

// ─── Start server ───────────────────────────────────────────────────────────

const server = http.createServer(handleRequest);

server.listen(BRIDGE_PORT, async () => {
  console.log(`\n🦢 BlackSwan Bridge running on http://localhost:${BRIDGE_PORT}`);
  console.log(`   Endpoints:`);
  console.log(`     POST /v1/chat/completions  — OpenAI-compatible chat`);
  console.log(`     GET  /health               — Health check\n`);

  await detectBackend();
  if (activeBackend) {
    console.log(`   Backend detected: ${activeBackend}`);
    const url = activeBackend === 'vllm' ? VLLM_URL : OLLAMA_URL;
    console.log(`   Proxying to: ${url}`);
  } else {
    console.log(`   ⚠ No backend detected. Start Ollama or vLLM first.`);
    console.log(`   Will auto-detect when requests come in.\n`);
  }
});
