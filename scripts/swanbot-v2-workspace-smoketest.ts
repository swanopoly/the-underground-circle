/**
 * swanbot-v2-workspace-smoketest — covers the M3c client dispatchers
 * for workspace.* and verification.*. Validates:
 *   - normalizeArtifact rejects missing kind / title / unknown kind
 *   - normalizeArtifact preserves content, url, metadata; coerces types
 *   - dispatchWorkspaceCreateRoom enforces circleId + valid artifact
 *   - dispatchWorkspaceApplyArtifacts enforces roomId + artifact
 *   - dispatchWorkspaceOpenPreview defaults preferredPanel to playground,
 *     routes through prime (with circleId) vs focus (without)
 *   - dispatchVerification defaults commands per tool name; surfaces
 *     bridge-offline cleanly; trims huge stdout/stderr to 8KB each
 *
 * Offline — no fetch, no Supabase, no real bridge. Run:
 *   npm run smoke:swanbot-v2-workspace
 *
 * Keep in lockstep with the helpers in src/lib/swanbot.ts; duplicating
 * the logic intentionally so the test is self-contained and immune to
 * import-graph noise (Supabase lock shims, Expo registry, etc.).
 */

// ─── Helpers (mirrors of the real ones) ─────────────────────────────
const ALLOWED_KINDS = ['summary', 'image', 'translation', 'classification', 'vision', 'audio', 'code', 'webpage'];

function normalizeArtifact(raw: unknown): any | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as any;
  const kind = String(a.kind || '');
  if (!ALLOWED_KINDS.includes(kind)) return null;
  const title = String(a.title || '').slice(0, 200);
  if (!title) return null;
  return {
    kind,
    title,
    content: typeof a.content === 'string' ? a.content : null,
    url: typeof a.url === 'string' ? a.url : null,
    metadata: a.metadata && typeof a.metadata === 'object' ? a.metadata : undefined,
  };
}

const DEFAULT_VERIFICATION_COMMANDS: Record<string, string> = {
  'verification.typecheck': 'npm run typecheck:app',
  'verification.tests': 'npm test',
  'verification.lint': 'npm run lint',
};

// ─── Stub workspace module ─────────────────────────────────────────
type Stub = {
  createWorkspaceFromArtifact: (circleId: string, artifact: any) => Promise<any>;
  createFilesInRoomFromArtifact: (roomId: string, artifact: any) => Promise<any>;
  primeCalls: Array<{ circleId: string; roomId: string; primaryFileId: string | null; preferredPanel: string }>;
  focusCalls: Array<{ roomId: string; primaryFileId: string | null; preferredPanel: string }>;
  primeRoomWorkspaceLaunch: (args: any) => void;
  focusRoomWorkspaceFile: (args: any) => void;
};

function makeStub(): Stub {
  const primeCalls: Stub['primeCalls'] = [];
  const focusCalls: Stub['focusCalls'] = [];
  return {
    createWorkspaceFromArtifact: async (circleId, artifact) => ({ roomId: `room_${circleId}`, roomName: artifact.title, fileCount: 1, primaryFileId: 'f1' }),
    createFilesInRoomFromArtifact: async (roomId, artifact) => ({ roomId, fileCount: 1, primaryFileId: 'f1', primaryFileName: artifact.title }),
    primeCalls,
    focusCalls,
    primeRoomWorkspaceLaunch: (args) => { primeCalls.push(args); },
    focusRoomWorkspaceFile: (args) => { focusCalls.push(args); },
  };
}

// ─── Dispatcher shims ──────────────────────────────────────────────
async function dispatchWorkspaceCreateRoom(stub: Stub, input: Record<string, any>) {
  const artifact = normalizeArtifact(input.artifact);
  if (!artifact) return { ok: false, error: 'artifact required with valid { kind, title }' };
  const circleId = String(input.circleId || '').trim();
  if (!circleId) return { ok: false, error: 'circleId required' };
  try {
    const result = await stub.createWorkspaceFromArtifact(circleId, artifact);
    if (!result.roomId) return { ok: false, error: 'workspace creation returned no roomId' };
    return { ok: true, data: result };
  } catch (e: any) { return { ok: false, error: e?.message || String(e) }; }
}

async function dispatchWorkspaceApplyArtifacts(stub: Stub, input: Record<string, any>) {
  const roomId = String(input.roomId || '').trim();
  if (!roomId) return { ok: false, error: 'roomId required' };
  const artifact = normalizeArtifact(input.artifact);
  if (!artifact) return { ok: false, error: 'artifact required with valid { kind, title }' };
  try {
    const result = await stub.createFilesInRoomFromArtifact(roomId, artifact);
    return { ok: true, data: result };
  } catch (e: any) { return { ok: false, error: e?.message || String(e) }; }
}

async function dispatchWorkspaceOpenPreview(stub: Stub, input: Record<string, any>) {
  const roomId = String(input.roomId || '').trim();
  if (!roomId) return { ok: false, error: 'roomId required' };
  const preferredPanel = input.preferredPanel === 'chat' ? 'chat' : 'playground';
  if (input.circleId) {
    stub.primeRoomWorkspaceLaunch({
      circleId: String(input.circleId),
      roomId,
      primaryFileId: input.primaryFileId ? String(input.primaryFileId) : null,
      preferredPanel,
    });
  } else {
    stub.focusRoomWorkspaceFile({
      roomId,
      primaryFileId: input.primaryFileId ? String(input.primaryFileId) : null,
      preferredPanel,
    });
  }
  return { ok: true, data: { roomId, preferredPanel } };
}

async function dispatchVerification(
  stubs: { bridgeAlive: boolean; exec: (cmd: string) => Promise<any> },
  name: keyof typeof DEFAULT_VERIFICATION_COMMANDS,
  input: Record<string, any>,
) {
  const command = typeof input.command === 'string' && input.command.trim()
    ? input.command.trim()
    : DEFAULT_VERIFICATION_COMMANDS[name];
  if (!stubs.bridgeAlive) {
    return { ok: false, error: 'Local coding bridge unavailable — start it with `npm run bridge`.' };
  }
  const result = await stubs.exec(command);
  const clip = (s?: string) => (s ? s.slice(0, 8192) : '');
  return {
    ok: !!result.ok,
    data: {
      command,
      ok: !!result.ok,
      stdout: clip(result.stdout),
      stderr: clip(result.stderr),
      truncated: (result.stdout && result.stdout.length > 8192) || (result.stderr && result.stderr.length > 8192),
    },
    error: result.ok ? undefined : (result.error || 'verification failed'),
  };
}

// ─── Test runner ───────────────────────────────────────────────────
let failures = 0;
function fail(m: string) { failures += 1; console.error('FAIL:', m); }
function pass(m: string) { console.log('pass:', m); }
function assert(cond: unknown, name: string, detail?: string) {
  if (cond) pass(name); else fail(`${name}${detail ? ' — ' + detail : ''}`);
}

async function main() {
  // ─── normalizeArtifact ────────────────────────────────────────
  assert(normalizeArtifact(null) === null, 'normalizeArtifact: null rejected');
  assert(normalizeArtifact(undefined) === null, 'normalizeArtifact: undefined rejected');
  assert(normalizeArtifact('str') === null, 'normalizeArtifact: string rejected');
  assert(normalizeArtifact({ kind: 'code' }) === null, 'normalizeArtifact: missing title rejected');
  assert(normalizeArtifact({ kind: 'evil', title: 't' }) === null, 'normalizeArtifact: unknown kind rejected');
  assert(normalizeArtifact({ kind: 'code', title: '' }) === null, 'normalizeArtifact: empty title rejected');
  {
    const ok = normalizeArtifact({ kind: 'code', title: 'Landing Page', content: 'html', url: null, metadata: { lang: 'html' } });
    assert(ok && ok.kind === 'code', 'normalizeArtifact: happy path kind');
    assert(ok && ok.title === 'Landing Page', 'normalizeArtifact: title passthrough');
    assert(ok && ok.content === 'html', 'normalizeArtifact: content preserved');
    assert(ok && ok.metadata?.lang === 'html', 'normalizeArtifact: metadata preserved');
  }
  {
    // Title truncation
    const tooLong = 'a'.repeat(500);
    const t = normalizeArtifact({ kind: 'code', title: tooLong });
    assert(t && t.title.length === 200, 'normalizeArtifact: title capped at 200 chars');
  }
  {
    // content/url non-strings coerced to null
    const t = normalizeArtifact({ kind: 'webpage', title: 'p', content: 42, url: true });
    assert(t && t.content === null, 'normalizeArtifact: non-string content → null');
    assert(t && t.url === null, 'normalizeArtifact: non-string url → null');
  }

  // ─── workspace.create_room ────────────────────────────────────
  {
    const stub = makeStub();
    const r1 = await dispatchWorkspaceCreateRoom(stub, { artifact: { kind: 'code', title: 'Landing' }, circleId: 'c1' });
    assert(r1.ok, 'create_room: happy path ok');
    assert((r1.data as any)?.roomId === 'room_c1', 'create_room: roomId from circleId');

    const r2 = await dispatchWorkspaceCreateRoom(stub, { artifact: { kind: 'evil', title: 't' }, circleId: 'c1' });
    assert(!r2.ok && /artifact required/.test(r2.error!), 'create_room: bad artifact rejected');

    const r3 = await dispatchWorkspaceCreateRoom(stub, { artifact: { kind: 'code', title: 't' } });
    assert(!r3.ok && /circleId required/.test(r3.error!), 'create_room: missing circleId rejected');

    // Stub returns null roomId → surfaces error
    const stub2 = makeStub();
    stub2.createWorkspaceFromArtifact = async () => ({ roomId: null, fileCount: 0 });
    const r4 = await dispatchWorkspaceCreateRoom(stub2, { artifact: { kind: 'code', title: 't' }, circleId: 'c1' });
    assert(!r4.ok && /roomId/.test(r4.error!), 'create_room: null roomId surfaces error');

    // Thrown error surfaced as { ok:false, error }
    const stub3 = makeStub();
    stub3.createWorkspaceFromArtifact = async () => { throw new Error('supabase 500'); };
    const r5 = await dispatchWorkspaceCreateRoom(stub3, { artifact: { kind: 'code', title: 't' }, circleId: 'c1' });
    assert(!r5.ok && /supabase 500/.test(r5.error!), 'create_room: throw surfaced as error');
  }

  // ─── workspace.apply_artifacts ────────────────────────────────
  {
    const stub = makeStub();
    const r1 = await dispatchWorkspaceApplyArtifacts(stub, { roomId: 'r1', artifact: { kind: 'code', title: 'Patch' } });
    assert(r1.ok, 'apply_artifacts: happy path ok');
    assert((r1.data as any)?.roomId === 'r1', 'apply_artifacts: roomId passthrough');

    const r2 = await dispatchWorkspaceApplyArtifacts(stub, { artifact: { kind: 'code', title: 't' } });
    assert(!r2.ok && /roomId required/.test(r2.error!), 'apply_artifacts: missing roomId rejected');

    const r3 = await dispatchWorkspaceApplyArtifacts(stub, { roomId: 'r1', artifact: null });
    assert(!r3.ok, 'apply_artifacts: null artifact rejected');
  }

  // ─── workspace.open_preview ───────────────────────────────────
  {
    const stub = makeStub();
    const r1 = await dispatchWorkspaceOpenPreview(stub, { roomId: 'r1', circleId: 'c1', primaryFileId: 'f1' });
    assert(r1.ok, 'open_preview: with circleId ok');
    assert(stub.primeCalls.length === 1 && stub.focusCalls.length === 0, 'open_preview: prime called (not focus)');
    assert(stub.primeCalls[0].preferredPanel === 'playground', 'open_preview: default panel=playground');
    assert(stub.primeCalls[0].primaryFileId === 'f1', 'open_preview: primaryFileId preserved');

    const r2 = await dispatchWorkspaceOpenPreview(stub, { roomId: 'r1' });
    assert(r2.ok, 'open_preview: without circleId ok');
    assert(stub.focusCalls.length === 1, 'open_preview: focus called when no circleId');
    assert(stub.focusCalls[0].primaryFileId === null, 'open_preview: null primaryFileId default');

    const r3 = await dispatchWorkspaceOpenPreview(stub, { roomId: 'r1', preferredPanel: 'chat' });
    assert(r3.ok && stub.focusCalls.at(-1)!.preferredPanel === 'chat', 'open_preview: chat panel passthrough');

    const r4 = await dispatchWorkspaceOpenPreview(stub, { roomId: 'r1', preferredPanel: 'hacker' });
    assert(r4.ok && stub.focusCalls.at(-1)!.preferredPanel === 'playground', 'open_preview: invalid panel → playground');

    const r5 = await dispatchWorkspaceOpenPreview(stub, {});
    assert(!r5.ok && /roomId required/.test(r5.error!), 'open_preview: missing roomId rejected');
  }

  // ─── verification.* ───────────────────────────────────────────
  {
    const execCalls: string[] = [];
    const liveStubs = {
      bridgeAlive: true,
      exec: async (cmd: string) => { execCalls.push(cmd); return { ok: true, stdout: 'all good', stderr: '' }; },
    };
    const r1 = await dispatchVerification(liveStubs, 'verification.typecheck', {});
    assert(r1.ok, 'typecheck: happy path ok');
    assert(execCalls[0] === 'npm run typecheck:app', 'typecheck: default command used');
    assert((r1.data as any)?.stdout === 'all good', 'typecheck: stdout preserved');

    const r2 = await dispatchVerification(liveStubs, 'verification.tests', {});
    assert(r2.ok && execCalls[1] === 'npm test', 'tests: default command `npm test`');

    const r3 = await dispatchVerification(liveStubs, 'verification.lint', {});
    assert(r3.ok && execCalls[2] === 'npm run lint', 'lint: default command `npm run lint`');

    // Override command
    const r4 = await dispatchVerification(liveStubs, 'verification.tests', { command: 'jest --ci' });
    assert(r4.ok && execCalls[3] === 'jest --ci', 'verification: command override honoured');

    // Empty/whitespace command falls back to default
    const r5 = await dispatchVerification(liveStubs, 'verification.typecheck', { command: '   ' });
    assert(r5.ok && execCalls[4] === 'npm run typecheck:app', 'verification: blank command → default');

    // Bridge offline
    const offlineStubs = { bridgeAlive: false, exec: async () => { throw new Error('should not call'); } };
    const r6 = await dispatchVerification(offlineStubs, 'verification.tests', {});
    assert(!r6.ok && /bridge unavailable/i.test(r6.error!), 'verification: bridge offline → clear error');

    // Failed verification (exec returns ok:false)
    const failStubs = {
      bridgeAlive: true,
      exec: async () => ({ ok: false, stdout: '', stderr: 'TS2304: Cannot find name Foo', error: 'exit 1' }),
    };
    const r7 = await dispatchVerification(failStubs, 'verification.typecheck', {});
    assert(!r7.ok, 'verification: exec failure → ok=false');
    assert((r7.data as any)?.stderr === 'TS2304: Cannot find name Foo', 'verification: stderr preserved on failure');
    assert(/exit 1/.test(r7.error!), 'verification: error passthrough from exec');

    // Huge stdout trimmed to 8KB
    const hugeStubs = {
      bridgeAlive: true,
      exec: async () => ({ ok: true, stdout: 'x'.repeat(20000), stderr: 'y'.repeat(20000) }),
    };
    const r8 = await dispatchVerification(hugeStubs, 'verification.tests', {});
    assert(r8.ok, 'verification: huge output still ok');
    assert((r8.data as any)?.stdout.length === 8192, 'verification: stdout clipped to 8KB');
    assert((r8.data as any)?.stderr.length === 8192, 'verification: stderr clipped to 8KB');
    assert((r8.data as any)?.truncated === true, 'verification: truncated flag set');
  }

  if (failures > 0) {
    console.error(`\n${failures} swanbot-v2-workspace smoke-test failure(s)`);
    process.exit(1);
  }
  console.log('\nAll swanbot-v2-workspace smoke cases passed.');
}

main().catch((err) => { console.error('fatal:', err); process.exit(1); });
