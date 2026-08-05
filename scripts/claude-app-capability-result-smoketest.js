#!/usr/bin/env node

const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

let failures = 0;

function assert(condition, message, detail = '') {
  if (condition) {
    console.log(`pass: ${message}`);
    return;
  }
  failures += 1;
  console.error(`FAIL: ${message}${detail ? ` - ${detail}` : ''}`);
}

function getOpenPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}

function requestJson(port, method, requestPath, body, token) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? '' : JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: requestPath,
      method,
      headers: {
        ...(payload ? {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        } : {}),
        ...(token ? { 'X-UC-Desktop-Token': token } : {}),
      },
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(raw) });
        } catch {
          reject(new Error(`Non-JSON response (${res.statusCode}): ${raw.slice(0, 300)}`));
        }
      });
    });
    req.once('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function waitForHealth(port, child) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Claude bridge exited with ${child.exitCode}`);
    try {
      const response = await requestJson(port, 'GET', '/health');
      if (response.status === 200 && response.body?.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for Claude bridge health');
}

async function pair(port) {
  const challengeResponse = await requestJson(port, 'POST', '/desktop/pair', {});
  if (challengeResponse.status !== 200 || challengeResponse.body?.code !== 'pairing_challenge_required' || !challengeResponse.body?.challenge) {
    throw new Error(`Pairing challenge failed: ${JSON.stringify(challengeResponse.body)}`);
  }
  const pairResponse = await requestJson(port, 'POST', '/desktop/pair', {
    pairingChallenge: challengeResponse.body.challenge,
  });
  if (pairResponse.status !== 200 || !pairResponse.body?.token) {
    throw new Error(`Pairing failed: ${JSON.stringify(pairResponse.body)}`);
  }
  return pairResponse.body.token;
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'uc-claude-capability-smoke-'));
  const sessionDir = path.join(tempRoot, '.claude', 'projects', 'test-project');
  fs.mkdirSync(sessionDir, { recursive: true });

  const managedSessionId = 'managed-capability-result-1';
  const unrelatedManagedSessionId = 'managed-unrelated-session-1';
  const ambiguousManagedSessionId = 'managed-ambiguous-session-1';
  const lateMarkerManagedSessionId = 'managed-late-marker-session-1';
  const boundedManagedSessionId = 'managed-bounded-registry-1';
  const unlabeledManagedSessionId = 'managed-unlabeled-registry-1';
  const transcriptSessionId = 'transcript-random-id-1';
  const now = new Date().toISOString();
  const managedSession = (sessionId, overrides = {}) => ({
    provider: 'claude-code',
    sessionId,
    projectDir: path.resolve(__dirname, '..'),
    projectHash: 'manual-launch',
    model: 'claude-code',
    status: 'active',
    kind: 'main',
    parentSessionId: null,
    slug: sessionId,
    task: 'Managed capability smoke',
    lastActivity: now,
    recentActions: ['Launched in test terminal'],
    terminalTitle: `[UC] Claude Code - ${sessionId}`,
    manageable: true,
    ...overrides,
  });
  fs.writeFileSync(
    path.join(tempRoot, '.uc-terminal-agent-sessions.json'),
    JSON.stringify({
      version: 1,
      sessions: [
        managedSession(managedSessionId),
        managedSession(unrelatedManagedSessionId),
        managedSession(ambiguousManagedSessionId),
        managedSession(lateMarkerManagedSessionId),
        managedSession(boundedManagedSessionId, {
          appCapabilityResultText: `APP_CAPABILITY_SUMMARY: ${'r'.repeat(8_500)}`,
          appCapabilityResultStatus: 'ready_to_retry',
        }),
        managedSession(unlabeledManagedSessionId, {
          appCapabilityResultText: 'arbitrary unlabeled transcript content must not pass through',
          appCapabilityResultStatus: 'ready_to_retry',
        }),
      ],
    }),
  );

  const receiptTailMarker = 'receipt-tail-after-500';
  const receipt = [
    'APP_CAPABILITY_RESULT_JSON:',
    JSON.stringify({
      summary: `Built the adapter. ${'x'.repeat(700)} ${receiptTailMarker}`,
      controlSurface: 'documented app API with accessibility fallback',
      sourceRefs: ['https://example.com/official-docs'],
      filesChanged: ['src/lib/example.ts'],
      retryPlan: 'Retry the original task.',
      verification: 'smoke passed',
      userActionNeeded: 'none',
    }),
  ].join('\n');
  const oversizedReceipt = `APP_CAPABILITY_SUMMARY: ${'z'.repeat(8_500)}`;

  const records = [
    {
      type: 'user',
      timestamp: now,
      message: {
        content: `[UC-CLAUDE-CODE:${managedSessionId}]\nReturn APP_CAPABILITY_RESULT_JSON only after the work is verified.`,
      },
    },
    {
      type: 'assistant',
      timestamp: now,
      message: {
        model: 'claude-test',
        content: [
          { type: 'text', text: receipt.slice(0, 420) },
          { type: 'text', text: receipt.slice(420) },
        ],
      },
    },
  ];
  fs.writeFileSync(
    path.join(sessionDir, `${transcriptSessionId}.jsonl`),
    `${records.map((record) => JSON.stringify(record)).join('\n')}\n`,
  );
  fs.writeFileSync(
    path.join(sessionDir, 'bounded-receipt.jsonl'),
    `${JSON.stringify({
      type: 'assistant',
      timestamp: now,
      message: {
        model: 'claude-test',
        content: [{ type: 'text', text: oversizedReceipt }],
      },
    })}\n`,
  );
  fs.writeFileSync(
    path.join(sessionDir, 'unrelated-transcript-id.jsonl'),
    `${[
      {
        type: 'user',
        timestamp: now,
        message: { content: 'This transcript has no managed-session marker.' },
      },
      {
        type: 'user',
        timestamp: now,
        message: {
          content: `[UC-CLAUDE-CODE:${unrelatedManagedSessionId}]\nA later user message must not retroactively claim a managed session.`,
        },
      },
      {
        type: 'assistant',
        timestamp: now,
        message: {
          model: 'claude-test',
          content: [{
            type: 'text',
            text: 'APP_CAPABILITY_SUMMARY: unrelated-receipt-must-not-attach\nRETRY_PLAN: none\nVERIFICATION: smoke passed\nUSER_ACTION_NEEDED: none',
          }],
        },
      },
    ].map((record) => JSON.stringify(record)).join('\n')}\n`,
  );
  for (const suffix of ['a', 'b']) {
    fs.writeFileSync(
      path.join(sessionDir, `ambiguous-transcript-${suffix}.jsonl`),
      `${[
        {
          type: 'user',
          timestamp: now,
          message: { content: `[UC-CLAUDE-CODE:${ambiguousManagedSessionId}]\nBuild the adapter.` },
        },
        {
          type: 'assistant',
          timestamp: now,
          message: {
            model: 'claude-test',
            content: [{
              type: 'text',
              text: `APP_CAPABILITY_SUMMARY: ambiguous-${suffix}\nRETRY_PLAN: none\nVERIFICATION: smoke passed\nUSER_ACTION_NEEDED: none`,
            }],
          },
        },
      ].map((record) => JSON.stringify(record)).join('\n')}\n`,
    );
  }
  fs.writeFileSync(
    path.join(sessionDir, 'late-marker-transcript.jsonl'),
    `${[
      {
        type: 'user',
        timestamp: now,
        message: {
          content: `Untrusted preamble.\n[UC-CLAUDE-CODE:${lateMarkerManagedSessionId}]\nThis late marker must not attach.`,
        },
      },
      {
        type: 'assistant',
        timestamp: now,
        message: {
          model: 'claude-test',
          content: [{
            type: 'text',
            text: 'APP_CAPABILITY_SUMMARY: late-marker-receipt\nRETRY_PLAN: none\nVERIFICATION: smoke passed\nUSER_ACTION_NEEDED: none',
          }],
        },
      },
    ].map((record) => JSON.stringify(record)).join('\n')}\n`,
  );

  const port = await getOpenPort();
  let stderr = '';
  const child = spawn(process.execPath, ['scripts/claude-bridge.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      HOME: tempRoot,
      UC_CLAUDE_BRIDGE_PORT: String(port),
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });

  try {
    await waitForHealth(port, child);
    const token = await pair(port);
    const response = await requestJson(port, 'GET', '/sessions', undefined, token);
    assert(response.status === 200, 'sessions endpoint returns successfully', String(response.status));

    const sessions = Array.isArray(response.body?.sessions) ? response.body.sessions : [];
    const complete = sessions.find((session) => session.sessionId === managedSessionId);
    const unrelatedManaged = sessions.find((session) => session.sessionId === unrelatedManagedSessionId);
    const ambiguousManaged = sessions.find((session) => session.sessionId === ambiguousManagedSessionId);
    const lateMarkerManaged = sessions.find((session) => session.sessionId === lateMarkerManagedSessionId);
    const boundedManaged = sessions.find((session) => session.sessionId === boundedManagedSessionId);
    const unlabeledManaged = sessions.find((session) => session.sessionId === unlabeledManagedSessionId);
    const bounded = sessions.find((session) => session.sessionId === 'bounded-receipt');

    assert(complete?.transcriptSessionId === transcriptSessionId, 'managed id is joined to its different transcript filename id');
    assert(!sessions.some((session) => session.sessionId === transcriptSessionId), 'merged transcript does not remain as a duplicate session');
    assert(typeof complete?.appCapabilityResultText === 'string', 'complete receipt has a dedicated string field');
    assert(
      complete?.appCapabilityResultText?.includes(receiptTailMarker),
      'dedicated field preserves receipt content beyond the 500-character preview',
    );
    assert(
      typeof complete?.lastAssistantText === 'string'
        && complete.lastAssistantText.length <= 500
        && complete.lastAssistantText.length < complete.appCapabilityResultText.length,
      'normal activity preview remains capped at 500 characters',
      String(complete?.lastAssistantText?.length),
    );
    assert(complete?.appCapabilityResultStatus === 'ready_to_retry', 'strict receipt exposes classified status');
    assert(bounded?.appCapabilityResultText?.length === 8_000, 'dedicated receipt is capped at 8,000 characters', String(bounded?.appCapabilityResultText?.length));
    assert(boundedManaged?.appCapabilityResultText?.length === 8_000, 'loaded managed receipt is also capped at 8,000 characters', String(boundedManaged?.appCapabilityResultText?.length));
    assert(!unlabeledManaged?.appCapabilityResultText, 'loaded managed content without a strict label is discarded');
    assert(!unrelatedManaged?.appCapabilityResultText, 'unmarked unrelated transcript cannot attach to a managed session');
    assert(!ambiguousManaged?.appCapabilityResultText, 'multiple transcript claims for one managed id fail closed');
    assert(!lateMarkerManaged?.appCapabilityResultText, 'a launcher marker after untrusted preamble cannot attach');
    assert(
      !complete?.appCapabilityResultText?.includes('unrelated-receipt-must-not-attach'),
      'unrelated transcript receipt cannot replace the claimed managed receipt',
    );
    assert(
      !complete?.appCapabilityResultText?.startsWith('[UC-CLAUDE-CODE:'),
      'user prompt contract labels are never exposed as assistant receipts',
    );
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => {
      if (child.exitCode !== null) resolve();
      else child.once('exit', resolve);
    });
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  if (failures > 0) {
    console.error(`\n${failures} Claude app-capability bridge smoke failure(s)${stderr ? `\n${stderr.slice(0, 1_000)}` : ''}`);
    process.exit(1);
  }
  console.log('\nAll Claude app-capability bridge smoke cases passed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
