/**
 * mcp-agent-connect-smoketest — end-to-end exercise of the zero-dependency
 * stdio MCP server (scripts/mcp-agent-connect.js).
 *
 * Spawns the REAL script as a child process (newline-delimited JSON-RPC over
 * stdin/stdout) against:
 *   - a local mock agent-connect HTTP server (so the server-backed read tools
 *     uc_list_pending_approvals / uc_list_skills / uc_get_circle_live_info are
 *     exercised over the wire, including Bearer-token propagation), and
 *   - a temp-dir `.uc/agent-locks.json` fixture (so uc_list_file_leases reads
 *     the exact registry format the coordination runtime writes).
 *
 * Verifies: the 3 legacy tools still work unchanged, the heartbeat protocol
 * still fires (session_start observed by the mock with the same token), the 4
 * read tools + the 2 slice-2 tools (uc_list_tasks read, uc_report_receipt
 * append-only write) return bounded text over the wire, expired leases are
 * filtered, sensitive fields (payload/content/contentHash/ownerId, and now
 * task description/created_by UUID) never appear in tool output, the write op
 * carries the same Bearer token to the same endpoint and never sends
 * client-supplied circle_id/user_id (server-forced), a missing receipt title
 * is rejected client-side with no write leaving the process, unknown
 * tools/methods still error, and network/auth failures degrade to isError
 * results without crashing the process.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCRIPT_PATH = path.resolve(__dirname, 'mcp-agent-connect.js');
const TOKEN = 'smoke-token';
const CIRCLE_ID = 'c-123';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

// ─── Mock agent-connect edge function ────────────────────────────────────────

interface SeenRequest { url: string; auth: string; body: any }
const seen: SeenRequest[] = [];

function cannedReadOpResponse(op: string): { status: number; json: unknown } {
  const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
  if (op === 'list_pending_approvals') {
    return {
      status: 200,
      json: {
        ok: true, op, circle_id: CIRCLE_ID, count: 2,
        approvals: [
          {
            id: 'ap-1', source: 'agent_approvals', kind: 'shell_command',
            title: 'Run rm -rf build', requester: 'SwanBot',
            requested_at: ago(120_000), timeout_seconds: 300,
            // Decoy: a compliant server never sends payload; prove the client
            // would not echo it even if one leaked.
            payload: { secret: 'secret-payload-value' },
          },
          {
            id: 'ra-2', source: 'agent_run_approvals', kind: 'file_write',
            title: 'Write deploy.yml', requester: null,
            requested_at: ago(30_000), timeout_seconds: 600,
          },
        ],
      },
    };
  }
  if (op === 'list_skills') {
    return {
      status: 200,
      json: {
        ok: true, op, circle_id: CIRCLE_ID, count: 1,
        skills: [{
          id: 'sk-1', name: 'pr-review', description: 'Reviews pull requests with circle conventions',
          version: '1.2.0', tags: ['git', 'review'], usage_count: 7, success_count: 6,
          updated_at: ago(3_600_000),
          content: 'SECRET-SKILL-BODY', // decoy — must never appear in tool text
        }],
      },
    };
  }
  if (op === 'circle_live_info') {
    return {
      status: 200,
      json: {
        ok: true, op, circle_id: CIRCLE_ID,
        circle: { id: CIRCLE_ID, name: 'The Underground Circle' },
        total_members: 4, today_check_ins: 2, today_messages: 11,
        agents: [{
          name: 'Claude Code', provider: 'claude-code', status: 'building',
          current_task: 'Refactoring auth', last_active_at: ago(60_000),
        }],
      },
    };
  }
  if (op === 'list_tasks') {
    return {
      status: 200,
      json: {
        ok: true, op, circle_id: CIRCLE_ID, count: 2,
        tasks: [
          {
            id: 'task-1', title: 'Ship MCP v2 slice 2', status: 'in_progress',
            priority: 'high', due_date: '2026-07-25', position: 1,
            assigned_agent_id: 'agent-xyz', assignee: 'Chris', creator: 'Chris',
            // Decoys: a compliant server never selects these; prove the client
            // would not echo a description body or raw owner UUID if one leaked.
            description: 'SECRET-TASK-DESCRIPTION', created_by: 'creator-uuid-9999',
          },
          {
            id: 'task-2', title: 'Review write-op gate', status: 'todo',
            priority: 'normal', due_date: null, position: 2,
            assigned_agent_id: null, assignee: null, creator: 'Sam',
          },
        ],
      },
    };
  }
  return { status: 400, json: { error: 'Unknown read op', code: 'unknown_read_op' } };
}

function startMockServer(): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolvePromise) => {
    const server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        let body: any = {};
        try { body = JSON.parse(raw); } catch { /* keep {} */ }
        seen.push({ url: req.url || '', auth: String(req.headers.authorization || ''), body });

        const respond = (status: number, json: unknown) => {
          const s = JSON.stringify(json);
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(s);
        };

        if (req.headers.authorization !== `Bearer ${TOKEN}`) {
          respond(401, { error: 'Invalid connect token', code: 'invalid_token' });
          return;
        }
        if (body.event === 'read_op') {
          const { status, json } = cannedReadOpResponse(String(body.op || ''));
          respond(status, json);
          return;
        }
        if (body.event === 'write_op') {
          // Faithful to the edge write path: report_receipt echoes back an
          // append-only receipt; any other write op is a 400. The real server
          // forces circle_id/user_id from the token — the client never sends
          // them, which section (12) asserts against the recorded body.
          const wop = String(body.op || '');
          if (wop === 'report_receipt') {
            respond(200, {
              ok: true, op: wop, circle_id: CIRCLE_ID,
              receipt: {
                id: 'pow-1',
                pow_type: body.pow_type || 'agent_run',
                title: String(body.title || ''),
                mission_id: body.mission_id || null,
                created_at: new Date().toISOString(),
              },
            });
            return;
          }
          respond(400, { error: 'Unknown write op', code: 'unknown_write_op' });
          return;
        }
        // Presence path (session_start / heartbeat / tool_use / session_end)
        respond(200, { ok: true, agent_id: 'ag-1', circle_id: CIRCLE_ID, status: 'building', event: body.event });
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolvePromise({ server, port });
    });
  });
}

// ─── Lease-registry fixtures (exact runtime format — see agentFileLeaseCore) ─

function writeLeaseFixture(dir: string, leases: Record<string, unknown>): void {
  fs.mkdirSync(path.join(dir, '.uc'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.uc', 'agent-locks.json'), JSON.stringify({ version: 1, leases }, null, 2), 'utf8');
}

function liveLease(p: string, now: number) {
  return {
    path: p, ownerId: 'agent-abc123', ownerLabel: 'cursor:main',
    acquiredAt: now - 60_000, renewedAt: now, expiresAt: now + 300_000,
    contentHash: 'deadbeefcafe0042', intent: 'refactoring auth',
  };
}
function expiredLease(p: string, now: number) {
  return {
    path: p, ownerId: 'agent-old999', ownerLabel: 'claude:stale',
    acquiredAt: now - 900_000, renewedAt: now - 600_000, expiresAt: now - 5_000,
    contentHash: 'feedface00000001', intent: 'long-gone edit',
  };
}

// ─── Minimal MCP client over child stdio ─────────────────────────────────────

class McpClient {
  child: ChildProcess;
  private nextId = 1;
  private pending = new Map<number, (msg: any) => void>();
  private buffer = '';
  stderr = '';

  constructor(env: Record<string, string | undefined>, cwd: string) {
    this.child = spawn(process.execPath, [SCRIPT_PATH], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child.stdout!.setEncoding('utf8');
    this.child.stdout!.on('data', (chunk: string) => {
      this.buffer += chunk;
      let idx: number;
      while ((idx = this.buffer.indexOf('\n')) !== -1) {
        const line = this.buffer.slice(0, idx).trim();
        this.buffer = this.buffer.slice(idx + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          const resolver = this.pending.get(msg.id);
          if (resolver) { this.pending.delete(msg.id); resolver(msg); }
        } catch { /* non-JSON stdout line — ignore */ }
      }
    });
    this.child.stderr!.setEncoding('utf8');
    this.child.stderr!.on('data', (chunk: string) => { this.stderr += chunk; });
  }

  request(method: string, params?: unknown, timeoutMs = 15_000): Promise<any> {
    const id = this.nextId++;
    const line = `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`;
    return new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectPromise(new Error(`timeout waiting for ${method} (id ${id})`));
      }, timeoutMs);
      this.pending.set(id, (msg) => { clearTimeout(timer); resolvePromise(msg); });
      this.child.stdin!.write(line);
    });
  }

  notify(method: string, params?: unknown): void {
    this.child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  callTool(name: string, args?: Record<string, unknown>): Promise<any> {
    return this.request('tools/call', { name, arguments: args || {} });
  }

  kill(): void {
    try { this.child.kill('SIGTERM'); } catch { /* already dead */ }
  }
}

function toolText(msg: any): string {
  return String(msg?.result?.content?.[0]?.text ?? '');
}

function waitFor(cond: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const start = Date.now();
  return new Promise((resolvePromise, rejectPromise) => {
    const tick = () => {
      if (cond()) { resolvePromise(); return; }
      if (Date.now() - start > timeoutMs) { rejectPromise(new Error(`timeout waiting for ${label}`)); return; }
      setTimeout(tick, 25);
    };
    tick();
  });
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const watchdog = setTimeout(() => {
    console.error('FAIL: smoke watchdog fired (90s) — hung');
    process.exit(1);
  }, 90_000);
  watchdog.unref();

  const { server, port } = await startMockServer();
  const mockUrl = `http://127.0.0.1:${port}`;
  const now = Date.now();

  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'uc-mcp-smoke-a-'));
  writeLeaseFixture(dirA, {
    'src/lib/live.ts': liveLease('src/lib/live.ts', now),
    'src/old/expired.ts': expiredLease('src/old/expired.ts', now),
  });
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'uc-mcp-smoke-b-')); // no registry at all
  const dirC = fs.mkdtempSync(path.join(os.tmpdir(), 'uc-mcp-smoke-c-'));
  writeLeaseFixture(dirC, { 'src/only/expired.ts': expiredLease('src/only/expired.ts', now) });

  const clients: McpClient[] = [];
  try {
    // ─── (1) Handshake + heartbeat protocol unchanged ───────────────────────
    const a = new McpClient({ UC_CONNECT_TOKEN: TOKEN, UC_SUPABASE_URL: mockUrl, UC_AGENT_TYPE: 'claude-code' }, dirA);
    clients.push(a);

    const init = await a.request('initialize', { protocolVersion: '2024-11-05', capabilities: {} });
    assertEq(init?.result?.serverInfo?.name, 'underground-circle-agent-connect', '(1) initialize serverInfo.name');
    assert(!!init?.result?.capabilities?.tools, '(1) tools capability advertised');

    a.notify('notifications/initialized');
    await waitFor(() => seen.some((r) => r.body?.event === 'session_start'), 5_000, 'session_start heartbeat');
    const hb = seen.find((r) => r.body?.event === 'session_start')!;
    assertEq(hb.auth, `Bearer ${TOKEN}`, '(1) heartbeat carries Bearer token');
    assertEq(hb.url, '/functions/v1/agent-connect', '(1) heartbeat hits agent-connect path');
    assertEq(hb.body.agent_type, 'claude-code', '(1) heartbeat agent_type unchanged');
    assert(typeof hb.body.cwd === 'string' && hb.body.cwd.length > 0, '(1) heartbeat carries cwd');

    // ─── (2) tools/list: 3 legacy + 4 read + 2 slice-2 (list_tasks, receipt) ─
    const list = await a.request('tools/list');
    const names = (list?.result?.tools || []).map((t: any) => t.name);
    assertEq(names.length, 9, '(2) exactly 9 tools listed');
    for (const expected of [
      'uc_report_progress', 'uc_get_circle_info', 'uc_post_update',
      'uc_list_file_leases', 'uc_list_pending_approvals', 'uc_list_skills', 'uc_get_circle_live_info',
      'uc_list_tasks', 'uc_report_receipt',
    ]) {
      assert(names.includes(expected), `(2) tools/list includes ${expected}`);
    }
    // uc_report_receipt must advertise `title` as required.
    const receiptTool = (list?.result?.tools || []).find((t: any) => t.name === 'uc_report_receipt');
    assert(Array.isArray(receiptTool?.inputSchema?.required) && receiptTool.inputSchema.required.includes('title'), '(2) uc_report_receipt requires title');
    assert((list?.result?.tools || []).every((t: any) => t?.inputSchema?.type === 'object'), '(2) every tool has an object inputSchema');

    // ─── (3) Legacy tools still work unchanged ──────────────────────────────
    const prog = await a.callTool('uc_report_progress', { task: 'Smoke testing MCP v2', status: 'building' });
    assert(toolText(prog).includes('Smoke testing MCP v2'), '(3) uc_report_progress echoes task');

    const info = await a.callTool('uc_get_circle_info');
    assert(toolText(info).includes('Agent: claude-code'), '(3) uc_get_circle_info returns cached info');

    const post = await a.callTool('uc_post_update', { message: 'hello circle' });
    assert(toolText(post).includes('hello circle'), '(3) uc_post_update echoes message');

    // ─── (4) uc_list_file_leases: live kept, expired dropped, no hash/id ────
    const leases = await a.callTool('uc_list_file_leases');
    const leaseText = toolText(leases);
    assert(leaseText.includes('src/lib/live.ts'), '(4) live lease listed', leaseText);
    assert(leaseText.includes('cursor:main'), '(4) owner label shown');
    assert(leaseText.includes('refactoring auth'), '(4) intent shown');
    assert(!leaseText.includes('expired.ts'), '(4) expired lease filtered out');
    assert(!leaseText.includes('deadbeefcafe0042'), '(4) contentHash not exposed');
    assert(!leaseText.includes('agent-abc123'), '(4) ownerId not exposed');
    assert(!leases?.result?.isError, '(4) not an error result');

    // ─── (5) uc_list_pending_approvals: server round-trip + allowlist ───────
    const approvals = await a.callTool('uc_list_pending_approvals');
    const apText = toolText(approvals);
    assert(!approvals?.result?.isError, '(5) approvals call succeeds');
    assert(apText.includes('Run rm -rf build'), '(5) approval title shown', apText);
    assert(apText.includes('shell_command'), '(5) approval kind shown');
    assert(apText.includes('SwanBot'), '(5) requester shown');
    assert(apText.includes('ap-1'), '(5) approval id shown');
    assert(apText.includes('ago'), '(5) age rendered');
    assert(!apText.includes('secret-payload-value'), '(5) payload never echoed even if server leaked it');

    const readReq = seen.find((r) => r.body?.event === 'read_op' && r.body?.op === 'list_pending_approvals')!;
    assert(!!readReq, '(5) read_op request reached the server');
    assertEq(readReq.auth, `Bearer ${TOKEN}`, '(5) read_op carries the same Bearer token');
    assertEq(readReq.url, '/functions/v1/agent-connect', '(5) read_op hits the same endpoint');

    // ─── (6) uc_list_skills: metadata only ──────────────────────────────────
    const skills = await a.callTool('uc_list_skills');
    const skText = toolText(skills);
    assert(!skills?.result?.isError, '(6) skills call succeeds');
    assert(skText.includes('pr-review'), '(6) skill name shown', skText);
    assert(skText.includes('v1.2.0'), '(6) skill version shown');
    assert(skText.includes('git, review'), '(6) tags shown');
    assert(skText.includes('used 7x'), '(6) usage count shown');
    assert(!skText.includes('SECRET-SKILL-BODY'), '(6) skill content never echoed');

    // ─── (7) uc_get_circle_live_info: live server read ──────────────────────
    const live = await a.callTool('uc_get_circle_live_info');
    const liveText = toolText(live);
    assert(!live?.result?.isError, '(7) live info call succeeds');
    assert(liveText.includes('The Underground Circle'), '(7) circle name shown', liveText);
    assert(liveText.includes('Members: 4'), '(7) member count shown');
    assert(liveText.includes('2 check-in(s)'), '(7) check-ins shown');
    assert(liveText.includes('Refactoring auth'), '(7) agent current task shown');

    // ─── (8) Unknown tool / unknown method still error ──────────────────────
    const badTool = await a.callTool('uc_nonexistent');
    assertEq(badTool?.error?.code, -32601, '(8) unknown tool → -32601');
    const badMethod = await a.request('frobnicate');
    assertEq(badMethod?.error?.code, -32601, '(8) unknown method → -32601');
    const ping = await a.request('ping');
    assert(ping && ping.result !== undefined && !ping.error, '(8) ping still works');

    // ─── (9) Auth failure: server 401 → isError result, process survives ────
    const c = new McpClient({ UC_CONNECT_TOKEN: 'wrong-token', UC_SUPABASE_URL: mockUrl }, dirC);
    clients.push(c);
    await c.request('initialize', {});
    const denied = await c.callTool('uc_list_pending_approvals');
    assert(denied?.result?.isError === true, '(9) 401 → isError result');
    assert(toolText(denied).includes('Invalid connect token'), '(9) server error message surfaced', toolText(denied));
    const emptyLeases = await c.callTool('uc_list_file_leases');
    assert(toolText(emptyLeases).includes('No active file leases'), '(9) expired-only registry → none active', toolText(emptyLeases));
    const pingC = await c.request('ping');
    assert(pingC && !pingC.error, '(9) process alive after auth failure');

    // ─── (10) Network failure: unreachable server → isError, no crash ───────
    const b = new McpClient({ UC_CONNECT_TOKEN: TOKEN, UC_SUPABASE_URL: 'http://127.0.0.1:1' }, dirB);
    clients.push(b);
    await b.request('initialize', {});
    const netFail = await b.callTool('uc_list_skills');
    assert(netFail?.result?.isError === true, '(10) network failure → isError result');
    assert(toolText(netFail).startsWith('Could not fetch skills'), '(10) graceful failure text', toolText(netFail));
    const noReg = await b.callTool('uc_list_file_leases');
    assert(toolText(noReg).includes('No file-lease registry found'), '(10) missing registry handled', toolText(noReg));
    const pingB = await b.request('ping');
    assert(pingB && !pingB.error, '(10) process alive after network failure');

    // ─── (11) uc_list_tasks: open tasks, allowlisted fields, no secrets ──────
    const tasks = await a.callTool('uc_list_tasks');
    const tasksText = toolText(tasks);
    assert(!tasks?.result?.isError, '(11) tasks call succeeds', tasksText);
    assert(tasksText.includes('Ship MCP v2 slice 2'), '(11) task title shown', tasksText);
    assert(tasksText.includes('in_progress'), '(11) task status shown');
    assert(tasksText.includes('high'), '(11) task priority shown');
    assert(tasksText.includes('task-1'), '(11) task id shown');
    assert(tasksText.includes('Chris'), '(11) assignee display name shown');
    assert(tasksText.includes('Review write-op gate'), '(11) second task shown');
    assert(!tasksText.includes('SECRET-TASK-DESCRIPTION'), '(11) task description never echoed');
    assert(!tasksText.includes('creator-uuid-9999'), '(11) raw created_by UUID never echoed');
    const taskReadReq = seen.find((r) => r.body?.event === 'read_op' && r.body?.op === 'list_tasks')!;
    assert(!!taskReadReq, '(11) list_tasks read_op reached the server');
    assertEq(taskReadReq.auth, `Bearer ${TOKEN}`, '(11) list_tasks carries the same Bearer token');
    assertEq(taskReadReq.url, '/functions/v1/agent-connect', '(11) list_tasks hits the same endpoint');

    // ─── (12) uc_report_receipt: append-only write_op, server-forced scope ───
    const receiptsBefore = seen.filter((r) => r.body?.event === 'write_op' && r.body?.op === 'report_receipt').length;
    const receipt = await a.callTool('uc_report_receipt', {
      title: 'Opened PR #42', pow_type: 'pr',
      detail: { url: 'https://example.com/pr/42' }, mission_id: 'm-1',
    });
    const receiptText = toolText(receipt);
    assert(!receipt?.result?.isError, '(12) receipt call succeeds', receiptText);
    assert(receiptText.includes('Opened PR #42'), '(12) receipt title echoed', receiptText);
    assert(receiptText.includes('pr'), '(12) receipt pow_type shown');
    assert(receiptText.includes('pow-1'), '(12) receipt id shown');

    const writeReq = seen.find((r) => r.body?.event === 'write_op' && r.body?.op === 'report_receipt' && r.body?.title === 'Opened PR #42')!;
    assert(!!writeReq, '(12) write_op request reached the server');
    assertEq(writeReq.auth, `Bearer ${TOKEN}`, '(12) write_op carries the same Bearer token');
    assertEq(writeReq.url, '/functions/v1/agent-connect', '(12) write_op hits the same endpoint');
    assertEq(writeReq.body.event, 'write_op', '(12) write_op event set');
    assertEq(writeReq.body.pow_type, 'pr', '(12) write_op forwards pow_type');
    assertEq(writeReq.body.mission_id, 'm-1', '(12) write_op forwards mission_id');
    // The client must NOT send circle_id/user_id — the server forces both from
    // the connect token, so a client cannot write into another circle/identity.
    assert(writeReq.body.circle_id === undefined, '(12) client does not send circle_id (server-forced)');
    assert(writeReq.body.user_id === undefined, '(12) client does not send user_id (server-forced)');

    // Missing-title guard: client-side reject, and NO write_op leaves the process.
    const badReceipt = await a.callTool('uc_report_receipt', {});
    assert(badReceipt?.result?.isError === true, '(12) missing title → isError');
    assert(toolText(badReceipt).toLowerCase().includes('title'), '(12) missing-title message mentions title');
    const receiptsAfter = seen.filter((r) => r.body?.event === 'write_op' && r.body?.op === 'report_receipt').length;
    assertEq(receiptsAfter, receiptsBefore + 1, '(12) exactly one write_op sent (bad call sent none)');

    // Auth failure on write: wrong-token client → server 401 surfaced as isError.
    const deniedWrite = await c.callTool('uc_report_receipt', { title: 'nope' });
    assert(deniedWrite?.result?.isError === true, '(12) write with bad token → isError');
    assert(toolText(deniedWrite).includes('Invalid connect token'), '(12) write auth error surfaced', toolText(deniedWrite));
  } catch (err) {
    failures += 1;
    console.error(`FAIL: smoke threw: ${(err as Error)?.message}`);
    for (const cl of clients) {
      if (cl.stderr) console.error(`  child stderr: ${cl.stderr.slice(0, 500)}`);
    }
  } finally {
    for (const cl of clients) cl.kill();
    server.close();
    for (const d of [dirA, dirB, dirC]) {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* temp cleanup best-effort */ }
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll mcp-agent-connect smoke cases passed (${passes} passed).`);
  process.exit(0);
}

main();
