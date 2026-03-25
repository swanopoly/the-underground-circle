/**
 * validate.js — Validate connect token against the Supabase edge function
 * Zero npm dependencies (uses Node.js built-in https).
 */

const https = require('https');

const SUPABASE_URL = 'https://rjkniqiqdtroeholxacg.supabase.co';
const AGENT_CONNECT_URL = `${SUPABASE_URL}/functions/v1/agent-connect`;

function validateToken(token) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ event: 'token_validate', agent_type: 'claude-code' });
    const url = new URL(AGENT_CONNECT_URL);

    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 10000,
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode === 200 && parsed.ok) {
            resolve({
              ok: true,
              circleId: parsed.circle_id,
              userId: parsed.user_id,
              displayName: parsed.display_name,
            });
          } else {
            resolve({
              ok: false,
              error: parsed.error || `HTTP ${res.statusCode}`,
            });
          }
        } catch (e) {
          resolve({ ok: false, error: `Invalid response: ${data.slice(0, 100)}` });
        }
      });
    });

    req.on('error', (err) => resolve({ ok: false, error: err.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'Request timed out' }); });
    req.write(body);
    req.end();
  });
}

module.exports = { validateToken, SUPABASE_URL, AGENT_CONNECT_URL };
