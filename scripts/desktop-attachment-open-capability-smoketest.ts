/**
 * Red-first behavior smoke for the opaque, one-shot uploaded-attachment
 * native-open capability.
 *
 * The first half exercises desktopBridge.ts with a fake authenticated bridge
 * to prove WeakMap branding, clone/JSON rejection, exact scope, and no-replay.
 * The second half starts the real Claude bridge on a random loopback port with
 * a harmless fake `open` executable and verifies server-side byte binding,
 * private staging, TTL/capacity/revoke/restart behavior, pinned-inode and
 * same-document proof, tamper/symlink rejection, and exactly one argv-only
 * dispatch.
 *
 * No provider, Supabase, production bridge, or native app is contacted.
 *
 * Run:
 *   npx tsx scripts/desktop-attachment-open-capability-smoketest.ts
 */

import assert from 'node:assert/strict';
import { createHash, randomBytes, webcrypto } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer } from 'node:net';
import vm from 'node:vm';
import ts from 'typescript';

const UUIDS = Object.freeze({
  userId: '11111111-1111-4111-8111-111111111111',
  circleId: '22222222-2222-4222-8222-222222222222',
  threadId: '33333333-3333-4333-8333-333333333333',
  messageId: '44444444-4444-4444-8444-444444444444',
  attachmentId: '55555555-5555-4555-8555-555555555555',
});
const SAFE_PROJECTION_KEYS = Object.freeze([
  'attachmentFingerprint',
  'bridgeInstanceId',
  'documentFingerprint',
  'expiresAt',
  'kind',
  'ok',
  'requestedAppFingerprint',
  'resolvedAppFingerprint',
  'scopeFingerprint',
  'sha256',
  'sizeBytes',
]);
const TEST_BYTES = Buffer.from('opaque desktop attachment capability\n', 'utf8');
const TEST_SHA256 = createHash('sha256').update(TEST_BYTES).digest('hex');
const CLAUDE_BRIDGE_SOURCE = readFileSync(resolve('scripts/claude-bridge.js'), 'utf8');

assert.match(CLAUDE_BRIDGE_SOURCE, /return '\/usr\/bin\/open';/u);
assert.match(CLAUDE_BRIDGE_SOURCE, /execFile\(openBinary, openArgs/u);
assert.doesNotMatch(CLAUDE_BRIDGE_SOURCE, /execFile\('open', \['-a', record\.resolvedAppPath/u);
assert.match(CLAUDE_BRIDGE_SOURCE, /Resolved application has no verifiable production code identity/u);
assert.match(CLAUDE_BRIDGE_SOURCE, /desktopAttachmentOpenProductionBundleLocationSafe\(bundleRealPath\)/u);

let assertions = 0;
const failures: string[] = [];
const attachmentRootByInstanceId = new Map<string, string>();

async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  assertions += 1;
  try {
    await fn();
    console.log('pass:', name);
  } catch (error) {
    const detail = error instanceof Error ? error.stack || error.message : String(error);
    failures.push(`${name}: ${detail}`);
    console.error('FAIL:', name);
  }
}

function bearer(): string {
  return randomBytes(32).toString('hex');
}

function testAppBundleId(appName: string): string {
  return `com.undergroundcircle.attachment-open-test.${appName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

function createUnsignedTestAppBundle(appRoot: string, appName: string): string {
  const bundlePath = join(appRoot, `${appName}.app`);
  if (existsSync(bundlePath)) return bundlePath;
  const contentsPath = join(bundlePath, 'Contents');
  const executableRoot = join(contentsPath, 'MacOS');
  mkdirSync(contentsPath, { recursive: true, mode: 0o700 });
  mkdirSync(executableRoot, { recursive: true, mode: 0o700 });
  writeFileSync(join(contentsPath, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>${testAppBundleId(appName)}</string>
<key>CFBundleName</key><string>${appName}</string>
<key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>
`, { mode: 0o600 });
  writeFileSync(join(executableRoot, 'test-app'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  return bundlePath;
}

function stageBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    scope: { ...UUIDS },
    filename: 'artifact.psd',
    mimeType: 'application/vnd.adobe.photoshop',
    base64: TEST_BYTES.toString('base64'),
    sizeBytes: TEST_BYTES.length,
    sha256: TEST_SHA256,
    ...overrides,
  };
}

function assertNoPrivateValues(value: unknown, forbiddenValues: string[] = []): void {
  const serialized = JSON.stringify(value);
  for (const key of ['"path"', '"directory"', '"filename"', '"sourceUrl"', '"storageUrl"', '"base64"', '"capabilityId"', '"bearer"']) {
    assert.equal(serialized.includes(key), false, `public JSON omits ${key}`);
  }
  for (const privateValue of forbiddenValues.filter(Boolean)) {
    assert.equal(serialized.includes(privateValue), false, 'public JSON omits private value');
  }
}

async function exerciseClientBoundary(): Promise<void> {
  const bridgeInstanceId = 'a'.repeat(32);
  const attachmentFingerprint = 'b'.repeat(64);
  const scopeFingerprint = 'c'.repeat(64);
  const requestedAppFingerprint = 'd'.repeat(64);
  const resolvedAppFingerprint = 'e'.repeat(64);
  const documentFingerprint = 'f'.repeat(64);
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  let issuedBearer = '';
  let fetchCount = 0;
  let consumeCount = 0;
  let tamperNextInspection = false;
  let tamperNextConsume = false;

  const projection = {
    ok: true,
    kind: 'desktop_attachment_open',
    attachmentFingerprint,
    scopeFingerprint,
    requestedAppFingerprint,
    resolvedAppFingerprint,
    documentFingerprint,
    sha256: TEST_SHA256,
    sizeBytes: TEST_BYTES.length,
    bridgeInstanceId,
    expiresAt,
  };

  const fakeCallBridge = async (
    _method: string,
    pathname: string,
    body: Record<string, unknown>,
    options: { headers?: Record<string, string> },
  ) => {
    fetchCount += 1;
    const privateHeader = options?.headers?.['X-UC-Attachment-Open-Capability'] || '';
    assert.match(privateHeader, /^[0-9a-f]{64}$/);
    assert.equal(JSON.stringify(body).includes('/Users/'), false);
    if (pathname.endsWith('/stage')) {
      issuedBearer = privateHeader;
      assert.equal(body.base64, TEST_BYTES.toString('base64'));
      return { ok: true, data: projection };
    }
    assert.equal(privateHeader, issuedBearer, 'later calls use the private WeakMap bearer');
    if (pathname.endsWith('/inspect')) {
      const data = {
        ...projection,
        ...(tamperNextInspection ? { resolvedAppFingerprint: '9'.repeat(64) } : {}),
        available: true,
      };
      tamperNextInspection = false;
      return { ok: true, data };
    }
    if (pathname.endsWith('/observe')) {
      return {
        ok: true,
        data: {
          ...projection,
          observedAt: new Date().toISOString(),
          appRunning: consumeCount > 0,
          frontmost: consumeCount > 0,
          documentOpen: consumeCount > 0,
          appProcessFingerprint: '1'.repeat(64),
          windowFingerprint: '2'.repeat(64),
          observationFingerprint: '3'.repeat(64),
        },
      };
    }
    if (pathname.endsWith('/consume')) {
      consumeCount += 1;
      return {
        ok: true,
        data: {
          ...projection,
          ...(tamperNextConsume ? { documentFingerprint: '8'.repeat(64) } : {}),
          dispatched: true,
          dispatchAcknowledged: true,
          completionVerified: false,
          dispatchedAt: new Date().toISOString(),
        },
      };
    }
    throw new Error(`unexpected fake bridge path: ${pathname}`);
  };

  const clientSource = readFileSync(resolve('src/lib/desktopBridge.ts'), 'utf8');
  const sectionStart = clientSource.indexOf('// ─── Opaque, one-shot uploaded-attachment native open');
  const sectionEnd = clientSource.indexOf('/** Phase 1d — mouse click', sectionStart);
  assert(sectionStart >= 0 && sectionEnd > sectionStart);
  const transpiled = ts.transpileModule(clientSource.slice(sectionStart, sectionEnd), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const moduleRecord: { exports: Record<string, any> } = { exports: {} };
  const sandbox: Record<string, any> = {
    module: moduleRecord,
    exports: moduleRecord.exports,
    callBridge: fakeCallBridge,
    isValidAppName: (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9 .\-_()]+$/.test(value),
    crypto: webcrypto,
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(transpiled, sandbox, { filename: 'desktopBridge.attachment-open.extracted.ts' });
  const bridge = moduleRecord.exports;
  {
    const staged = await bridge.stageDesktopAttachmentOpenCapability({
      scope: UUIDS,
      filename: 'artifact.psd',
      mimeType: 'application/vnd.adobe.photoshop',
      base64: TEST_BYTES.toString('base64'),
      sizeBytes: TEST_BYTES.length,
      sha256: TEST_SHA256,
    });
    assert.equal(staged.ok, true);
    assert(staged.data);
    const capability = staged.data;
    assert.equal(Object.isFrozen(capability), true);
    assert.equal(Object.keys(capability).sort().join(','), [
      'attachmentFingerprint',
      'bridgeInstanceId',
      'documentFingerprint',
      'expiresAt',
      'kind',
      'requestedAppFingerprint',
      'resolvedAppFingerprint',
      'schemaVersion',
      'scopeFingerprint',
      'sha256',
      'sizeBytes',
    ].sort().join(','));
    assertNoPrivateValues(capability, [issuedBearer, TEST_BYTES.toString('base64')]);
    assert.equal(bridge.isDesktopAttachmentOpenCapability(capability), true);

    const beforeClone = fetchCount;
    const cloneResult = await bridge.inspectDesktopAttachmentOpenCapability({ ...capability }, UUIDS);
    assert.equal(cloneResult.ok, false);
    assert.equal(fetchCount, beforeClone, 'spread clone fails before bridge I/O');
    const structured = structuredClone(capability);
    const structuredResult = await bridge.inspectDesktopAttachmentOpenCapability(structured, UUIDS);
    assert.equal(structuredResult.ok, false);
    assert.equal(fetchCount, beforeClone, 'structured clone fails before bridge I/O');
    const jsonClone = JSON.parse(JSON.stringify(capability));
    const jsonResult = await bridge.consumeDesktopAttachmentOpenCapability(jsonClone, UUIDS);
    assert.equal(jsonResult.ok, false);
    assert.equal(fetchCount, beforeClone, 'JSON clone fails before bridge I/O');

    const wrongScope = { ...UUIDS, messageId: '66666666-6666-4666-8666-666666666666' };
    const mismatch = await bridge.inspectDesktopAttachmentOpenCapability(capability, wrongScope);
    assert.equal(mismatch.ok, false);
    assert.equal(fetchCount, beforeClone, 'scope mismatch fails before bridge I/O');

    const firstInspect = await bridge.inspectDesktopAttachmentOpenCapability(capability, UUIDS);
    const secondInspect = await bridge.inspectDesktopAttachmentOpenCapability(capability, UUIDS);
    assert.equal(firstInspect.ok, true);
    assert.equal(secondInspect.ok, true, 'inspection is non-consuming');
    assertNoPrivateValues(firstInspect.data, [issuedBearer, TEST_BYTES.toString('base64')]);

    const baseline = await bridge.observeDesktopAttachmentOpenCapability(capability, UUIDS);
    assert.equal(baseline.ok, true);
    assert.equal(baseline.data.documentOpen, false);

    const consumed = await bridge.consumeDesktopAttachmentOpenCapability(capability, UUIDS);
    assert.equal(consumed.ok, true);
    assertNoPrivateValues(consumed.data, [issuedBearer, TEST_BYTES.toString('base64')]);
    const afterConsume = fetchCount;
    const replay = await bridge.consumeDesktopAttachmentOpenCapability(capability, UUIDS);
    assert.equal(replay.ok, false);
    assert.equal(fetchCount, afterConsume, 'spent exact object cannot dispatch again');
    assert.equal(consumeCount, 1);
    const after = await bridge.observeDesktopAttachmentOpenCapability(capability, UUIDS);
    assert.equal(after.ok, true);
    assert.equal(after.data.documentOpen, true);
    assertNoPrivateValues(after.data, [issuedBearer, TEST_BYTES.toString('base64')]);

    const stagedForInspectMismatch = await bridge.stageDesktopAttachmentOpenCapability({
      scope: UUIDS,
      filename: 'artifact.psd',
      mimeType: 'application/vnd.adobe.photoshop',
      base64: TEST_BYTES.toString('base64'),
      sizeBytes: TEST_BYTES.length,
      sha256: TEST_SHA256,
    });
    assert.equal(stagedForInspectMismatch.ok, true);
    tamperNextInspection = true;
    const inspectMismatch = await bridge.inspectDesktopAttachmentOpenCapability(
      stagedForInspectMismatch.data,
      UUIDS,
    );
    assert.equal(inspectMismatch.ok, false);
    assert.equal(bridge.isDesktopAttachmentOpenCapability(stagedForInspectMismatch.data), false);

    const stagedForReceiptMismatch = await bridge.stageDesktopAttachmentOpenCapability({
      scope: UUIDS,
      filename: 'artifact.psd',
      mimeType: 'application/vnd.adobe.photoshop',
      base64: TEST_BYTES.toString('base64'),
      sizeBytes: TEST_BYTES.length,
      sha256: TEST_SHA256,
    });
    assert.equal(stagedForReceiptMismatch.ok, true);
    tamperNextConsume = true;
    const receiptMismatch = await bridge.consumeDesktopAttachmentOpenCapability(
      stagedForReceiptMismatch.data,
      UUIDS,
    );
    tamperNextConsume = false;
    assert.equal(receiptMismatch.ok, false);
    assert.equal(bridge.isDesktopAttachmentOpenCapability(stagedForReceiptMismatch.data), false);
  }
}

async function reservePort(): Promise<number> {
  return await new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close((error) => error ? reject(error) : resolvePort(port));
    });
  });
}

type RunningBridge = {
  child: ChildProcessWithoutNullStreams;
  baseUrl: string;
  instanceId: string;
  attachmentRoot: string;
  testAppRoot: string;
  token: string;
  output: () => string;
};

async function waitForBridge(baseUrl: string, child: ChildProcessWithoutNullStreams, output: () => string): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`bridge exited early (${child.exitCode})\n${output()}`);
    try {
      const response = await fetch(`${baseUrl}/desktop/health`);
      if (response.ok) return await response.json() as Record<string, unknown>;
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 75));
  }
  throw new Error(`bridge did not become ready\n${output()}`);
}

async function pairBridge(baseUrl: string): Promise<string> {
  const first = await fetch(`${baseUrl}/desktop/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const challengeBody = await first.json() as Record<string, unknown>;
  assert.equal(challengeBody.code, 'pairing_challenge_required');
  const challenge = String(challengeBody.challenge || '');
  assert.match(challenge, /^[A-Za-z0-9_-]+$/);
  const second = await fetch(`${baseUrl}/desktop/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pairingChallenge: challenge }),
  });
  const paired = await second.json() as Record<string, unknown>;
  assert.equal(paired.ok, true);
  const token = String(paired.token || '');
  assert(token.length >= 32);
  return token;
}

async function startBridge(
  port: number,
  fakeBin: string,
  dispatchLog: string,
  testOverrides: Record<string, string> = {},
  sharedRoots?: Readonly<{ attachmentRoot: string; testAppRoot: string }>,
): Promise<RunningBridge> {
  const fixtureRoot = resolve(fakeBin, '..');
  const attachmentRoot = sharedRoots?.attachmentRoot || join(fixtureRoot, `attachment-open-root-${port}`);
  const testAppRoot = sharedRoots?.testAppRoot || join(fixtureRoot, 'test-apps');
  for (const appName of [
    'Adobe Photoshop',
    'Preview',
    'Pages',
    'Numbers',
    'Keynote',
    'Microsoft Word',
    'Microsoft Excel',
    'Microsoft PowerPoint',
  ]) createUnsignedTestAppBundle(testAppRoot, appName);
  let captured = '';
  const child = spawn(process.execPath, [resolve('scripts/claude-bridge.js')], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH || ''}`,
      UC_CLAUDE_BRIDGE_PORT: String(port),
      UC_DESKTOP_ATTACHMENT_OPEN_TEST_MODE: '1',
      UC_DESKTOP_ATTACHMENT_OPEN_TEST_ROOT: attachmentRoot,
      UC_ATTACHMENT_OPEN_TEST_APP_ROOT: testAppRoot,
      UC_DESKTOP_ATTACHMENT_OPEN_CAPACITY: '3',
      UC_ATTACHMENT_OPEN_TEST_DISPATCH_LOG: dispatchLog,
      UC_ATTACHMENT_OPEN_TEST_OPEN_BINARY: realpathSync(resolve(fakeBin, 'open')),
      UC_ATTACHMENT_OPEN_TEST_INSTALLED_APPS: [
        'Adobe Photoshop',
        'Preview',
        'Pages',
        'Numbers',
        'Keynote',
        'Microsoft Word',
        'Microsoft Excel',
        'Microsoft PowerPoint',
      ].join('|'),
      UC_ALLOW_CLAUDE_BRIDGE_BILLING: '0',
      ...testOverrides,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const capture = (chunk: Buffer) => {
    captured = `${captured}${chunk.toString('utf8')}`.slice(-16_000);
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  const baseUrl = `http://127.0.0.1:${port}`;
  const health = await waitForBridge(baseUrl, child, () => captured);
  assert.equal(health.supported, true);
  assert(Array.isArray(health.tools) && health.tools.includes('attachment_open_capability'));
  const instanceId = String(health.instanceId || '');
  assert.match(instanceId, /^[0-9a-f]{32}$/);
  attachmentRootByInstanceId.set(instanceId, attachmentRoot);
  const token = await pairBridge(baseUrl);
  return { child, baseUrl, instanceId, attachmentRoot, testAppRoot, token, output: () => captured };
}

async function stopBridge(bridge: RunningBridge): Promise<void> {
  if (bridge.child.exitCode !== null) return;
  bridge.child.kill('SIGTERM');
  await Promise.race([
    new Promise<void>((resolveExit) => bridge.child.once('exit', () => resolveExit())),
    new Promise<void>((resolveTimeout) => setTimeout(() => {
      if (bridge.child.exitCode === null) bridge.child.kill('SIGKILL');
      resolveTimeout();
    }, 3_000)),
  ]);
}

async function crashBridge(bridge: RunningBridge): Promise<void> {
  if (bridge.child.exitCode !== null) return;
  bridge.child.kill('SIGKILL');
  await Promise.race([
    new Promise<void>((resolveExit) => bridge.child.once('exit', () => resolveExit())),
    new Promise<void>((resolveTimeout) => setTimeout(resolveTimeout, 3_000)),
  ]);
}

async function waitUntil(
  predicate: () => boolean,
  timeoutMs: number,
  message: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  assert.fail(message);
}

async function bridgeCall(
  bridge: RunningBridge,
  endpoint: 'stage' | 'inspect' | 'observe' | 'consume' | 'revoke',
  capabilityBearer: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${bridge.baseUrl}/desktop/attachment_open/${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-UC-Desktop-Token': bridge.token,
      'X-UC-Attachment-Open-Capability': capabilityBearer,
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

function processCapabilityFiles(instanceId: string): Array<{ directory: string; file: string }> {
  const attachmentRoot = attachmentRootByInstanceId.get(instanceId);
  if (!attachmentRoot) return [];
  const processRoot = join(attachmentRoot, `instance-${instanceId}`);
  if (!existsSync(processRoot)) return [];
  return readdirSync(processRoot)
    .map((entry) => join(processRoot, entry))
    .filter((directory) => lstatSync(directory).isDirectory())
    .flatMap((directory) => readdirSync(directory).map((entry) => ({ directory, file: join(directory, entry) })));
}

async function stageAndFindFile(
  bridge: RunningBridge,
  capabilityBearer: string,
  body = stageBody(),
): Promise<{ response: Record<string, unknown>; file: string; directory: string }> {
  const before = new Set(processCapabilityFiles(bridge.instanceId).map((item) => item.directory));
  const staged = await bridgeCall(bridge, 'stage', capabilityBearer, body);
  assert.equal(staged.status, 200, JSON.stringify(staged.body));
  assert.equal(staged.body.ok, true);
  const added = processCapabilityFiles(bridge.instanceId).filter((item) => !before.has(item.directory));
  assert.equal(added.length, 1);
  return { response: staged.body, file: added[0]!.file, directory: added[0]!.directory };
}

async function exerciseRealBridge(tempRoot: string): Promise<void> {
  const fakeBin = join(tempRoot, 'bin');
  const dispatchLog = join(tempRoot, 'dispatch.log');
  const fakeOpen = join(fakeBin, 'open');
  writeFileSync(join(tempRoot, '.keep'), '', { mode: 0o600 });
  mkdirSync(fakeBin, { mode: 0o700 });
  writeFileSync(fakeOpen, '#!/bin/sh\nprintf "dispatch\\n" >> "$UC_ATTACHMENT_OPEN_TEST_DISPATCH_LOG"\nexit 0\n', { mode: 0o700 });
  chmodSync(fakeOpen, 0o700);

  const port = await reservePort();
  let bridge = await startBridge(port, fakeBin, dispatchLog);
  try {
    await check('real bridge stage response is a safe value-free projection', async () => {
      const key = bearer();
      const staged = await bridgeCall(bridge, 'stage', key, stageBody());
      assert.equal(staged.status, 200, `${JSON.stringify(staged.body)}\n${bridge.output()}`);
      assert.deepEqual(Object.keys(staged.body).sort(), [...SAFE_PROJECTION_KEYS].sort());
      assertNoPrivateValues(staged.body, [key, TEST_BYTES.toString('base64')]);
      const file = processCapabilityFiles(bridge.instanceId)[0];
      assert(file);
      assert.equal(lstatSync(file.directory).mode & 0o777, 0o700);
      assert.equal(lstatSync(file.file).mode & 0o777, 0o600);
      assert.equal(lstatSync(file.file).isSymbolicLink(), false);
      assert.equal(file.file.startsWith(`${bridge.attachmentRoot}/`), true);
      assert.equal(file.file.includes('/uc-desktop-attachment-open/'), false, 'test bridge never stages in legacy shared root');
      assert.match(basename(file.file), /^document-[0-9a-f]{32}\.psd$/);
      assert.notEqual(basename(file.file), 'attachment.psd');
      const first = await bridgeCall(bridge, 'inspect', key, { scope: UUIDS });
      const second = await bridgeCall(bridge, 'inspect', key, { scope: UUIDS });
      assert.equal(first.body.available, true);
      assert.equal(second.body.available, true, 'inspect does not consume');
      assertNoPrivateValues(first.body, [key]);
      const baseline = await bridgeCall(bridge, 'observe', key, { scope: UUIDS });
      assert.equal(baseline.body.appRunning, false);
      assert.equal(baseline.body.frontmost, false);
      assert.equal(baseline.body.documentOpen, false);
      assertNoPrivateValues(baseline.body, [key, basename(file.file), 'artifact.psd', 'Adobe Photoshop']);
      const revoked = await bridgeCall(bridge, 'revoke', key, { scope: UUIDS });
      assert.equal(revoked.body.revoked, true);
    });

    await check('server independently rejects scope drift without consuming inspect authority', async () => {
      const key = bearer();
      await stageAndFindFile(bridge, key);
      const wrong = await bridgeCall(bridge, 'inspect', key, {
        scope: { ...UUIDS, messageId: '66666666-6666-4666-8666-666666666666' },
      });
      assert.equal(wrong.status, 403);
      assert.equal(wrong.body.errorCode, 'attachment_open_scope_mismatch');
      const right = await bridgeCall(bridge, 'inspect', key, { scope: UUIDS });
      assert.equal(right.body.available, true);
      await bridgeCall(bridge, 'revoke', key, { scope: UUIDS });
    });

    await check('consume spends authority before rejecting a mismatched scope', async () => {
      const key = bearer();
      await stageAndFindFile(bridge, key);
      const wrong = await bridgeCall(bridge, 'consume', key, {
        scope: { ...UUIDS, messageId: '66666666-6666-4666-8666-666666666666' },
      });
      assert.equal(wrong.status, 403);
      assert.equal(wrong.body.errorCode, 'attachment_open_scope_mismatch');
      const replay = await bridgeCall(bridge, 'consume', key, { scope: UUIDS });
      assert.equal(replay.body.errorCode, 'attachment_open_capability_unavailable');
      assert.equal(processCapabilityFiles(bridge.instanceId).length, 0);
    });

    await check('stage rejects bad UUIDs, URL-shaped authority, and byte/hash drift', async () => {
      const badUuid = await bridgeCall(bridge, 'stage', bearer(), stageBody({
        scope: { ...UUIDS, attachmentId: 'attachment-from-filename' },
      }));
      assert.equal(badUuid.status, 400);
      const urlAuthority = await bridgeCall(bridge, 'stage', bearer(), stageBody({
        sourceUrl: 'https://storage.invalid/private?token=secret',
      }));
      assert.equal(urlAuthority.status, 400);
      const badHash = await bridgeCall(bridge, 'stage', bearer(), stageBody({ sha256: '0'.repeat(64) }));
      assert.equal(badHash.status, 400);
      assert.equal(processCapabilityFiles(bridge.instanceId).length, 0);
    });

    await check('stage fails closed when neither an explicit nor extension-default app can resolve', async () => {
      const unavailable = await bridgeCall(bridge, 'stage', bearer(), stageBody({
        filename: 'artifact.bin',
        mimeType: 'application/octet-stream',
        preferredAppName: null,
      }));
      assert.equal(unavailable.status, 409);
      assert.equal(unavailable.body.errorCode, 'attachment_open_app_unavailable');
      assert.equal(processCapabilityFiles(bridge.instanceId).length, 0);
    });

    await check('explicit app selection wins extension defaults and all app identities stay opaque', async () => {
      const cases = [
        { filename: 'report.pdf', mimeType: 'application/pdf', preferredAppName: 'Preview' },
        { filename: 'image.png', mimeType: 'image/png', preferredAppName: 'Preview' },
        { filename: 'draft.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', preferredAppName: 'Pages' },
        { filename: 'budget.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', preferredAppName: 'Numbers' },
      ];
      const fingerprints: string[] = [];
      for (const row of cases) {
        const key = bearer();
        const staged = await bridgeCall(bridge, 'stage', key, stageBody(row));
        assert.equal(staged.status, 200, JSON.stringify(staged.body));
        assert.match(String(staged.body.requestedAppFingerprint || ''), /^[0-9a-f]{64}$/);
        assert.match(String(staged.body.resolvedAppFingerprint || ''), /^[0-9a-f]{64}$/);
        assert.match(String(staged.body.documentFingerprint || ''), /^[0-9a-f]{64}$/);
        assertNoPrivateValues(staged.body, [row.filename, row.preferredAppName]);
        fingerprints.push(String(staged.body.requestedAppFingerprint));
        await bridgeCall(bridge, 'revoke', key, { scope: UUIDS });
      }
      assert.equal(fingerprints[0], fingerprints[1], 'PDF and PNG explicitly bind the same Preview identity');
      assert.notEqual(fingerprints[2], fingerprints[3], 'Pages and Numbers remain distinct identities');

      const defaultCases = [
        { filename: 'report.pdf', mimeType: 'application/pdf', expectedExplicitIndex: 0 },
        { filename: 'draft.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', expectedDifferentIndex: 2 },
        { filename: 'budget.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', expectedDifferentIndex: 3 },
      ];
      for (const row of defaultCases) {
        const key = bearer();
        const staged = await bridgeCall(bridge, 'stage', key, stageBody({
          filename: row.filename,
          mimeType: row.mimeType,
        }));
        assert.equal(staged.status, 200, JSON.stringify(staged.body));
        const fingerprint = String(staged.body.requestedAppFingerprint || '');
        if ('expectedExplicitIndex' in row) assert.equal(fingerprint, fingerprints[row.expectedExplicitIndex!]);
        if ('expectedDifferentIndex' in row) assert.notEqual(fingerprint, fingerprints[row.expectedDifferentIndex!]);
        await bridgeCall(bridge, 'revoke', key, { scope: UUIDS });
      }
    });

    await check('capacity is bounded and revocation releases every slot', async () => {
      const keys = [bearer(), bearer(), bearer()];
      for (const key of keys) {
        const staged = await bridgeCall(bridge, 'stage', key, stageBody());
        assert.equal(staged.status, 200, JSON.stringify(staged.body));
      }
      const overflow = await bridgeCall(bridge, 'stage', bearer(), stageBody());
      assert.equal(overflow.status, 409);
      assert.equal(overflow.body.errorCode, 'attachment_open_capacity_reached');
      for (const key of keys) {
        const revoked = await bridgeCall(bridge, 'revoke', key, { scope: UUIDS });
        assert.equal(revoked.body.revoked, true);
      }
      assert.equal(processCapabilityFiles(bridge.instanceId).length, 0);
    });

    await check('idle timer deletes an expired staged file without another endpoint call', async () => {
      const key = bearer();
      await stageAndFindFile(bridge, key, stageBody({ ttlMs: 80 }));
      await waitUntil(
        () => processCapabilityFiles(bridge.instanceId).length === 0,
        1_000,
        'idle TTL cleanup did not remove abandoned private bytes',
      );
      assert.equal(processCapabilityFiles(bridge.instanceId).length, 0);
      const expired = await bridgeCall(bridge, 'inspect', key, { scope: UUIDS });
      assert.equal(expired.status, 404);
      assert.equal(expired.body.errorCode, 'attachment_open_capability_unavailable');
    });

    await check('same-size content tamper consumes authority before dispatch', async () => {
      const key = bearer();
      const staged = await stageAndFindFile(bridge, key);
      writeFileSync(staged.file, Buffer.alloc(TEST_BYTES.length, 0x58), { mode: 0o600 });
      chmodSync(staged.file, 0o600);
      const beforeDispatches = existsSync(dispatchLog) ? readFileSync(dispatchLog, 'utf8').trim().split('\n').filter(Boolean).length : 0;
      const consumed = await bridgeCall(bridge, 'consume', key, { scope: UUIDS });
      assert.equal(consumed.status, 409);
      assert.equal(consumed.body.errorCode, 'attachment_open_file_tampered');
      const replay = await bridgeCall(bridge, 'consume', key, { scope: UUIDS });
      assert.equal(replay.body.errorCode, 'attachment_open_capability_unavailable');
      const afterDispatches = existsSync(dispatchLog) ? readFileSync(dispatchLog, 'utf8').trim().split('\n').filter(Boolean).length : 0;
      assert.equal(afterDispatches, beforeDispatches);
    });

    await check('byte-identical unlink and recreate is rejected by pinned inode with zero dispatch', async () => {
      const key = bearer();
      const staged = await stageAndFindFile(bridge, key);
      const originalInode = lstatSync(staged.file).ino;
      unlinkSync(staged.file);
      const inodeDecoy = join(staged.directory, 'inode-decoy');
      writeFileSync(inodeDecoy, 'decoy', { mode: 0o600 });
      writeFileSync(staged.file, TEST_BYTES, { mode: 0o600 });
      chmodSync(staged.file, 0o600);
      unlinkSync(inodeDecoy);
      const replacementInode = lstatSync(staged.file).ino;
      assert.notEqual(replacementInode, originalInode, 'test setup replaced the exact staged inode');
      const beforeDispatches = existsSync(dispatchLog)
        ? readFileSync(dispatchLog, 'utf8').trim().split('\n').filter(Boolean).length
        : 0;
      const consumed = await bridgeCall(bridge, 'consume', key, { scope: UUIDS });
      assert.equal(consumed.status, 409);
      assert.equal(consumed.body.errorCode, 'attachment_open_file_tampered');
      const replay = await bridgeCall(bridge, 'consume', key, { scope: UUIDS });
      assert.equal(replay.body.errorCode, 'attachment_open_capability_unavailable');
      const afterDispatches = existsSync(dispatchLog)
        ? readFileSync(dispatchLog, 'utf8').trim().split('\n').filter(Boolean).length
        : 0;
      assert.equal(afterDispatches, beforeDispatches, 'replacement never reaches native dispatch');
    });

    await check('symlink substitution is rejected and never dispatched', async () => {
      const key = bearer();
      const staged = await stageAndFindFile(bridge, key);
      const external = join(tempRoot, 'external.psd');
      writeFileSync(external, TEST_BYTES, { mode: 0o600 });
      unlinkSync(staged.file);
      symlinkSync(external, staged.file);
      const beforeDispatches = existsSync(dispatchLog) ? readFileSync(dispatchLog, 'utf8').trim().split('\n').filter(Boolean).length : 0;
      const consumed = await bridgeCall(bridge, 'consume', key, { scope: UUIDS });
      assert.equal(consumed.status, 409);
      assert.equal(consumed.body.errorCode, 'attachment_open_file_tampered');
      const afterDispatches = existsSync(dispatchLog) ? readFileSync(dispatchLog, 'utf8').trim().split('\n').filter(Boolean).length : 0;
      assert.equal(afterDispatches, beforeDispatches);
    });

    await check('same-path app bundle replacement is rejected and dispatches zero times', async () => {
      const key = bearer();
      const staged = await stageAndFindFile(bridge, key);
      const appPath = join(bridge.testAppRoot, 'Adobe Photoshop.app');
      const originalInode = lstatSync(appPath).ino;
      const replacedPath = join(bridge.testAppRoot, 'Adobe Photoshop.replaced.app');
      renameSync(appPath, replacedPath);
      createUnsignedTestAppBundle(bridge.testAppRoot, 'Adobe Photoshop');
      assert.notEqual(lstatSync(appPath).ino, originalInode, 'test setup replaced the exact app bundle inode');
      const beforeDispatches = existsSync(dispatchLog)
        ? readFileSync(dispatchLog, 'utf8').trim().split('\n').filter(Boolean).length
        : 0;
      const consumed = await bridgeCall(bridge, 'consume', key, { scope: UUIDS });
      assert.equal(consumed.status, 409);
      assert.equal(consumed.body.errorCode, 'attachment_open_app_unavailable');
      const afterDispatches = existsSync(dispatchLog)
        ? readFileSync(dispatchLog, 'utf8').trim().split('\n').filter(Boolean).length
        : 0;
      assert.equal(afterDispatches, beforeDispatches, 'replacement never reaches native dispatch');
      assert.equal(existsSync(staged.file), false, 'failed app identity consumes and cleans staged bytes');
      rmSync(appPath, { recursive: true, force: true });
      renameSync(replacedPath, appPath);
    });

    await check('nested unsigned test executable drift invalidates the complete bundle closure', async () => {
      const key = bearer();
      const staged = await stageAndFindFile(bridge, key);
      const executablePath = join(bridge.testAppRoot, 'Adobe Photoshop.app', 'Contents', 'MacOS', 'test-app');
      const original = readFileSync(executablePath);
      writeFileSync(executablePath, '#!/bin/sh\nexit 7\n', { mode: 0o700 });
      chmodSync(executablePath, 0o700);
      const beforeDispatches = existsSync(dispatchLog)
        ? readFileSync(dispatchLog, 'utf8').trim().split('\n').filter(Boolean).length
        : 0;
      const consumed = await bridgeCall(bridge, 'consume', key, { scope: UUIDS });
      assert.equal(consumed.status, 409);
      assert.equal(consumed.body.errorCode, 'attachment_open_app_unavailable');
      const afterDispatches = existsSync(dispatchLog)
        ? readFileSync(dispatchLog, 'utf8').trim().split('\n').filter(Boolean).length
        : 0;
      assert.equal(afterDispatches, beforeDispatches, 'nested executable drift never reaches native dispatch');
      writeFileSync(executablePath, original, { mode: 0o700 });
      chmodSync(executablePath, 0o700);
      assert.equal(existsSync(staged.file), false, 'identity drift consumes and deletes private staged bytes');
    });

    await check('exact focused document identity performs one argv-only dispatch and cannot replay', async () => {
      const key = bearer();
      const staged = await stageAndFindFile(bridge, key);
      const beforeDispatches = existsSync(dispatchLog) ? readFileSync(dispatchLog, 'utf8').trim().split('\n').filter(Boolean).length : 0;
      const consumed = await bridgeCall(bridge, 'consume', key, { scope: UUIDS });
      assert.equal(consumed.status, 200);
      assert.equal(consumed.body.dispatched, true);
      assert.equal(consumed.body.dispatchAcknowledged, true);
      assert.equal(consumed.body.completionVerified, false);
      assertNoPrivateValues(consumed.body, [key, staged.file, basename(staged.file), 'artifact.psd', 'Adobe Photoshop']);
      assert.equal(existsSync(staged.file), true, 'private bytes remain until exact loaded-document proof');
      const replay = await bridgeCall(bridge, 'consume', key, { scope: UUIDS });
      assert.equal(replay.body.errorCode, 'attachment_open_capability_unavailable');
      const afterDispatches = readFileSync(dispatchLog, 'utf8').trim().split('\n').filter(Boolean).length;
      assert.equal(afterDispatches, beforeDispatches + 1);
      const observed = await bridgeCall(bridge, 'observe', key, { scope: UUIDS });
      assert.equal(observed.status, 200);
      assert.equal(observed.body.appRunning, true);
      assert.equal(observed.body.frontmost, true);
      assert.equal(observed.body.documentOpen, true);
      assert(Date.parse(String(observed.body.observedAt)) > Date.parse(String(consumed.body.dispatchedAt)));
      assertNoPrivateValues(observed.body, [key, staged.file, basename(staged.file), 'artifact.psd', 'Adobe Photoshop']);
      assert.equal(processCapabilityFiles(bridge.instanceId).length, 0);
    });

    await check('wrong app never becomes exact loaded-document proof', async () => {
      await stopBridge(bridge);
      bridge = await startBridge(port, fakeBin, dispatchLog, {
        UC_ATTACHMENT_OPEN_TEST_OBSERVED_APP: 'Preview',
      });
      const key = bearer();
      const staged = await stageAndFindFile(bridge, key);
      const consumed = await bridgeCall(bridge, 'consume', key, { scope: UUIDS });
      assert.equal(consumed.status, 200);
      const observed = await bridgeCall(bridge, 'observe', key, { scope: UUIDS });
      assert.equal(observed.body.appRunning, false);
      assert.equal(observed.body.frontmost, false);
      assert.equal(observed.body.documentOpen, false);
      assert.equal(existsSync(staged.file), true, 'wrong app retains bytes only for bounded verify/revoke');
      await bridgeCall(bridge, 'revoke', key, { scope: UUIDS });
      assert.equal(existsSync(staged.file), false);
      await stopBridge(bridge);
      bridge = await startBridge(port, fakeBin, dispatchLog);
    });

    await check('generic basename in an error message cannot prove a loaded document', async () => {
      await stopBridge(bridge);
      bridge = await startBridge(port, fakeBin, dispatchLog, {
        UC_ATTACHMENT_OPEN_TEST_DOCUMENT_STATE: 'error',
      });
      const key = bearer();
      const staged = await stageAndFindFile(bridge, key);
      assert.notEqual(basename(staged.file), 'attachment.psd');
      await bridgeCall(bridge, 'consume', key, { scope: UUIDS });
      const observed = await bridgeCall(bridge, 'observe', key, { scope: UUIDS });
      assert.equal(observed.body.appRunning, true);
      assert.equal(observed.body.frontmost, true);
      assert.equal(observed.body.documentOpen, false);
      assert.equal(existsSync(staged.file), true);
      await bridgeCall(bridge, 'revoke', key, { scope: UUIDS });
      await stopBridge(bridge);
      bridge = await startBridge(port, fakeBin, dispatchLog);
    });

    await check('same-basename document at a different path cannot prove the pinned focused document', async () => {
      await stopBridge(bridge);
      bridge = await startBridge(port, fakeBin, dispatchLog, {
        UC_ATTACHMENT_OPEN_TEST_DOCUMENT_STATE: 'same_basename_other',
      });
      const key = bearer();
      const staged = await stageAndFindFile(bridge, key);
      await bridgeCall(bridge, 'consume', key, { scope: UUIDS });
      const observed = await bridgeCall(bridge, 'observe', key, { scope: UUIDS });
      assert.equal(observed.status, 200);
      assert.equal(observed.body.appRunning, true);
      assert.equal(observed.body.frontmost, true);
      assert.equal(observed.body.documentOpen, false);
      assert.equal(existsSync(staged.file), true, 'failed exact-document proof retains bytes for bounded revoke');
      await bridgeCall(bridge, 'revoke', key, { scope: UUIDS });
      assert.equal(existsSync(staged.file), false);
      await stopBridge(bridge);
      bridge = await startBridge(port, fakeBin, dispatchLog);
    });

    await check('startup scavenger preserves a different bridge instance while its PID is live', async () => {
      const key = bearer();
      const staged = await stageAndFindFile(bridge, key);
      const siblingPort = await reservePort();
      const sibling = await startBridge(siblingPort, fakeBin, dispatchLog, {}, {
        attachmentRoot: bridge.attachmentRoot,
        testAppRoot: bridge.testAppRoot,
      });
      try {
        assert.notEqual(sibling.instanceId, bridge.instanceId);
        assert.equal(existsSync(staged.file), true, 'live sibling startup must not remove active bytes');
        const inspected = await bridgeCall(bridge, 'inspect', key, { scope: UUIDS });
        assert.equal(inspected.status, 200);
        assert.equal(inspected.body.available, true);
      } finally {
        await stopBridge(sibling);
      }
      const revoked = await bridgeCall(bridge, 'revoke', key, { scope: UUIDS });
      assert.equal(revoked.body.revoked, true);
    });

    await check('SIGKILL restart scavenges exact stale instance bytes and invalidates its bearer', async () => {
      const key = bearer();
      const staged = await stageAndFindFile(bridge, key);
      assert.equal(existsSync(staged.file), true);
      const oldInstanceId = bridge.instanceId;
      await crashBridge(bridge);
      assert.equal(existsSync(staged.file), true, 'SIGKILL leaves crash residue for startup recovery');
      bridge = await startBridge(port, fakeBin, dispatchLog);
      assert.notEqual(bridge.instanceId, oldInstanceId);
      await waitUntil(
        () => processCapabilityFiles(oldInstanceId).length === 0,
        1_000,
        'startup scavenger did not remove stale exact instance bytes',
      );
      const stale = await bridgeCall(bridge, 'inspect', key, { scope: UUIDS });
      assert.equal(stale.status, 404);
      assert.equal(stale.body.errorCode, 'attachment_open_capability_unavailable');
      assert.equal(processCapabilityFiles(oldInstanceId).length, 0);
    });

    await check('startup scavenger leaves symlink and malformed unmarked trees untouched', async () => {
      const root = bridge.attachmentRoot;
      const external = join(tempRoot, 'scavenger-external');
      mkdirSync(external, { mode: 0o700 });
      writeFileSync(join(external, 'keep.txt'), 'keep', { mode: 0o600 });
      const symlinkInstance = join(root, `instance-${'d'.repeat(32)}`);
      symlinkSync(external, symlinkInstance);

      const malformedInstance = join(root, `instance-${'e'.repeat(32)}`);
      mkdirSync(malformedInstance, { mode: 0o700 });
      writeFileSync(join(malformedInstance, 'foreign.txt'), 'keep', { mode: 0o600 });

      const oldInstanceId = bridge.instanceId;
      await stopBridge(bridge);
      bridge = await startBridge(port, fakeBin, dispatchLog);
      assert.notEqual(bridge.instanceId, oldInstanceId);
      assert.equal(lstatSync(symlinkInstance).isSymbolicLink(), true);
      assert.equal(readFileSync(join(external, 'keep.txt'), 'utf8'), 'keep');
      assert.equal(readFileSync(join(malformedInstance, 'foreign.txt'), 'utf8'), 'keep');

      unlinkSync(symlinkInstance);
      rmSync(malformedInstance, { recursive: true, force: true });
    });

    await check('consume route is shell-free and bearer/path-free by source contract', () => {
      const source = readFileSync(resolve('scripts/claude-bridge.js'), 'utf8');
      const start = source.indexOf("if (url === '/desktop/attachment_open/consume'");
      const end = source.indexOf("if (url === '/desktop/stage_attachment'", start);
      assert(start >= 0 && end > start);
      const section = source.slice(start, end);
      assert(section.includes('execFile(openBinary, openArgs'));
      assert(section.includes('resolveDesktopAttachmentOpenDispatchBinary()'));
      assert.equal(section.includes("execFile('open', openArgs"), false);
      assert.equal(/\bexec\s*\(/.test(section), false);
      assert.equal(section.includes('capabilityId'), false);
      assert.equal(section.includes('res.end(JSON.stringify({ ok: true, path:'), false);
      const observationStart = source.indexOf('function buildDesktopAttachmentOpenObservation');
      const observationEnd = source.indexOf('function validateDesktopAttachmentOpenRecord', observationStart);
      assert(observationStart >= 0 && observationEnd > observationStart);
      const observationSection = source.slice(observationStart, observationEnd);
      assert.equal(observationSection.includes('name of front document'), false);
      assert(observationSection.includes('"AXFocusedWindow"'));
      assert(observationSection.includes('"AXDocument"'));
      assert(observationSection.includes("'/usr/sbin/lsof'"));
      assert(observationSection.includes("'/usr/bin/osascript'"));
      assert.equal(/execFile\(\s*['"]osascript['"]/u.test(observationSection), false);
    });
  } finally {
    await stopBridge(bridge);
  }
}

async function main(): Promise<void> {
  await check('client exact-object boundary rejects clones and spends once', exerciseClientBoundary);
  const tempRoot = mkdtempSync(join(tmpdir(), 'uc-attachment-open-smoke-'));
  try {
    await exerciseRealBridge(tempRoot);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} failure(s) across ${assertions} checks:`);
    failures.forEach((failure) => console.error(`- ${failure}`));
    process.exitCode = 1;
    return;
  }
  console.log(`\n${assertions} checks passed.`);
}

void main();
