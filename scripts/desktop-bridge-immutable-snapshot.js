/**
 * Parent-owned immutable source handoff for the Claude desktop bridge.
 *
 * A safe refresh may validate a mutable checkout only once. The direct
 * supervisor copies the exact five-file manifest into a private snapshot
 * while the old bridge still owns the global drain, then starts the next
 * generation from those captured bytes. The bootstrap compiles the captured
 * bytes under their original filenames so CommonJS resolution, __dirname,
 * and resource paths retain their normal repository semantics.
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const IMMUTABLE_SNAPSHOT_SCHEMA_VERSION = 1;
const IMMUTABLE_SNAPSHOT_PREFIX = 'uc-desktop-bridge-source-';
const IMMUTABLE_SNAPSHOT_DESCRIPTOR_NAME = 'snapshot.json';
const IMMUTABLE_SNAPSHOT_FILES_DIR = 'files';
const IMMUTABLE_SNAPSHOT_STALE_MIN_AGE_MS = 24 * 60 * 60_000;
const IMMUTABLE_SNAPSHOT_SCAVENGE_MAX_ENTRIES = 64;

const BRIDGE_SOURCE_MANIFEST = Object.freeze([
  Object.freeze({ name: 'claude-bridge.js', required: true }),
  Object.freeze({ name: 'terminal-launch-utils.js', required: true }),
  Object.freeze({ name: 'desktop-bridge-security.js', required: true }),
  Object.freeze({ name: 'codex-session-summary.js', required: true }),
  Object.freeze({ name: 'browser-bridge.js', required: true }),
]);

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function statFingerprint(stat) {
  return [
    stat.dev,
    stat.ino,
    stat.mode,
    stat.nlink,
    stat.uid,
    stat.gid,
    stat.size,
    stat.mtimeMs,
    stat.ctimeMs,
  ].join(':');
}

function manifestDescriptors(sourcePath) {
  const exactSourcePath = path.resolve(String(sourcePath || ''));
  if (path.basename(exactSourcePath) !== 'claude-bridge.js') {
    throw new Error('Immutable bridge snapshot requires an exact claude-bridge.js source path.');
  }
  const sourceDir = path.dirname(exactSourcePath);
  return BRIDGE_SOURCE_MANIFEST.map((descriptor) => ({
    ...descriptor,
    originalPath: descriptor.name === 'claude-bridge.js'
      ? exactSourcePath
      : path.join(sourceDir, descriptor.name),
  }));
}

function captureStableBridgeSource(sourcePath) {
  const descriptors = manifestDescriptors(sourcePath);
  const first = new Map();

  for (const descriptor of descriptors) {
    const stat = fs.lstatSync(descriptor.originalPath);
    const regularFile = stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1;
    const exactPath = regularFile && fs.realpathSync(descriptor.originalPath) === descriptor.originalPath;
    if (!regularFile || !exactPath) {
      throw new Error(`Bridge snapshot source is not an exact single-link regular file: ${descriptor.name}`);
    }
    const bytes = fs.readFileSync(descriptor.originalPath);
    first.set(descriptor.name, {
      descriptor,
      bytes,
      sha256: sha256(bytes),
      statFingerprint: statFingerprint(stat),
    });
  }

  const aggregate = crypto.createHash('sha256');
  const files = [];
  for (const descriptor of descriptors) {
    const initial = first.get(descriptor.name);
    const afterStat = fs.lstatSync(descriptor.originalPath);
    const regularFile = afterStat.isFile() && !afterStat.isSymbolicLink() && afterStat.nlink === 1;
    const exactPath = regularFile && fs.realpathSync(descriptor.originalPath) === descriptor.originalPath;
    const afterBytes = regularFile && exactPath ? fs.readFileSync(descriptor.originalPath) : null;
    const afterSha256 = afterBytes ? sha256(afterBytes) : null;
    const stable = Boolean(
      regularFile
      && exactPath
      && initial.statFingerprint === statFingerprint(afterStat)
      && initial.sha256 === afterSha256,
    );
    if (!stable) throw new Error(`Bridge snapshot source changed while captured: ${descriptor.name}`);
    aggregate.update(JSON.stringify([
      descriptor.name,
      descriptor.required,
      true,
      true,
      true,
      true,
      afterSha256,
      false,
    ]));
    aggregate.update('\0');
    files.push(Object.freeze({
      name: descriptor.name,
      required: descriptor.required,
      originalPath: descriptor.originalPath,
      bytes: initial.bytes,
      sha256: initial.sha256,
      size: initial.bytes.length,
    }));
  }

  return Object.freeze({
    manifestSha256: aggregate.digest('hex'),
    sourcePath: descriptors[0].originalPath,
    files: Object.freeze(files),
  });
}

function assertPrivateNode(nodePath, expectedMode, kind) {
  const stat = fs.lstatSync(nodePath);
  const exactUid = typeof process.getuid !== 'function' || stat.uid === process.getuid();
  const exactMode = (stat.mode & 0o777) === expectedMode;
  const exactType = kind === 'directory'
    ? stat.isDirectory() && !stat.isSymbolicLink()
    : stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1;
  if (!exactUid || !exactMode || !exactType || fs.realpathSync(nodePath) !== nodePath) {
    throw new Error(`Immutable bridge snapshot ${kind} failed private ownership/mode validation.`);
  }
  return stat;
}

function snapshotRootIsOwned(rootPath) {
  const exactRoot = path.resolve(String(rootPath || ''));
  const base = path.basename(exactRoot);
  const parent = path.dirname(exactRoot);
  return base.startsWith(IMMUTABLE_SNAPSHOT_PREFIX)
    && base.length > IMMUTABLE_SNAPSHOT_PREFIX.length + 4
    && parent === fs.realpathSync(os.tmpdir());
}

function cleanupImmutableBridgeSnapshot(snapshot) {
  const rootPath = path.resolve(String(snapshot?.rootPath || ''));
  try {
    if (!snapshotRootIsOwned(rootPath)) return false;
    if (!fs.existsSync(rootPath)) return true;
    const stat = fs.lstatSync(rootPath);
    if (
      !stat.isDirectory()
      || stat.isSymbolicLink()
      || (typeof process.getuid === 'function' && stat.uid !== process.getuid())
      || fs.realpathSync(rootPath) !== rootPath
    ) return false;
    fs.rmSync(rootPath, { recursive: true, force: true });
    return !fs.existsSync(rootPath);
  } catch {
    return false;
  }
}

function createImmutableBridgeSnapshot(options = {}) {
  const expectedManifestSha256 = String(options.expectedManifestSha256 || '');
  if (!/^[0-9a-f]{64}$/u.test(expectedManifestSha256)) {
    throw new Error('Immutable bridge snapshot requires an exact expected manifest hash.');
  }
  const captured = captureStableBridgeSource(options.sourcePath);
  if (captured.manifestSha256 !== expectedManifestSha256) {
    throw new Error('Bridge source no longer matches the validated manifest.');
  }

  const tempRoot = fs.realpathSync(os.tmpdir());
  const rootPath = fs.mkdtempSync(path.join(tempRoot, IMMUTABLE_SNAPSHOT_PREFIX));
  let complete = false;
  try {
    fs.chmodSync(rootPath, 0o700);
    assertPrivateNode(rootPath, 0o700, 'directory');
    const filesPath = path.join(rootPath, IMMUTABLE_SNAPSHOT_FILES_DIR);
    fs.mkdirSync(filesPath, { mode: 0o700 });
    fs.chmodSync(filesPath, 0o700);
    assertPrivateNode(filesPath, 0o700, 'directory');

    const snapshotId = crypto.randomBytes(16).toString('hex');
    const createdAtMs = Date.now();
    const creatorPid = process.pid;
    const descriptorFiles = [];
    for (const file of captured.files) {
      const snapshotPath = path.join(filesPath, file.name);
      fs.writeFileSync(snapshotPath, file.bytes, { flag: 'wx', mode: 0o600 });
      fs.chmodSync(snapshotPath, 0o600);
      assertPrivateNode(snapshotPath, 0o600, 'file');
      const persisted = fs.readFileSync(snapshotPath);
      if (persisted.length !== file.size || sha256(persisted) !== file.sha256) {
        throw new Error(`Immutable bridge snapshot write verification failed: ${file.name}`);
      }
      descriptorFiles.push({
        name: file.name,
        required: file.required,
        originalPath: file.originalPath,
        sha256: file.sha256,
        size: file.size,
      });
    }

    const descriptor = {
      schemaVersion: IMMUTABLE_SNAPSHOT_SCHEMA_VERSION,
      snapshotId,
      manifestSha256: captured.manifestSha256,
      originalMainPath: captured.sourcePath,
      createdAtMs,
      creatorPid,
      files: descriptorFiles,
    };
    const descriptorPath = path.join(rootPath, IMMUTABLE_SNAPSHOT_DESCRIPTOR_NAME);
    fs.writeFileSync(descriptorPath, `${JSON.stringify(descriptor)}\n`, { flag: 'wx', mode: 0o600 });
    fs.chmodSync(descriptorPath, 0o600);
    assertPrivateNode(descriptorPath, 0o600, 'file');
    complete = true;
    return Object.freeze({
      rootPath,
      descriptorPath,
      snapshotId,
      manifestSha256: captured.manifestSha256,
      originalMainPath: captured.sourcePath,
      createdAtMs,
      creatorPid,
      fileCount: descriptorFiles.length,
    });
  } finally {
    if (!complete) cleanupImmutableBridgeSnapshot({ rootPath });
  }
}

function readAndVerifyImmutableBridgeSnapshot(snapshot) {
  const rootPath = path.resolve(String(snapshot?.rootPath || ''));
  const descriptorPath = path.resolve(String(snapshot?.descriptorPath || ''));
  if (
    !snapshotRootIsOwned(rootPath)
    || descriptorPath !== path.join(rootPath, IMMUTABLE_SNAPSHOT_DESCRIPTOR_NAME)
  ) throw new Error('Immutable bridge snapshot path is not supervisor-owned.');
  assertPrivateNode(rootPath, 0o700, 'directory');
  const filesPath = path.join(rootPath, IMMUTABLE_SNAPSHOT_FILES_DIR);
  assertPrivateNode(filesPath, 0o700, 'directory');
  assertPrivateNode(descriptorPath, 0o600, 'file');
  const descriptorBytes = fs.readFileSync(descriptorPath);
  if (descriptorBytes.length > 64 * 1024) throw new Error('Immutable bridge snapshot descriptor is too large.');
  const descriptor = JSON.parse(descriptorBytes.toString('utf8'));
  if (
    descriptor?.schemaVersion !== IMMUTABLE_SNAPSHOT_SCHEMA_VERSION
    || !/^[0-9a-f]{32}$/u.test(String(descriptor.snapshotId || ''))
    || !/^[0-9a-f]{64}$/u.test(String(descriptor.manifestSha256 || ''))
    || descriptor.snapshotId !== snapshot.snapshotId
    || descriptor.manifestSha256 !== snapshot.manifestSha256
    || descriptor.originalMainPath !== snapshot.originalMainPath
    || !Number.isSafeInteger(descriptor.createdAtMs)
    || descriptor.createdAtMs <= 0
    || !Number.isSafeInteger(descriptor.creatorPid)
    || descriptor.creatorPid < 1
    || (snapshot.createdAtMs !== undefined && descriptor.createdAtMs !== snapshot.createdAtMs)
    || (snapshot.creatorPid !== undefined && descriptor.creatorPid !== snapshot.creatorPid)
    || !Array.isArray(descriptor.files)
    || descriptor.files.length !== BRIDGE_SOURCE_MANIFEST.length
  ) throw new Error('Immutable bridge snapshot descriptor lineage is invalid.');

  for (let index = 0; index < BRIDGE_SOURCE_MANIFEST.length; index += 1) {
    const expected = BRIDGE_SOURCE_MANIFEST[index];
    const file = descriptor.files[index];
    const snapshotPath = path.join(filesPath, expected.name);
    if (
      file?.name !== expected.name
      || file?.required !== true
      || file.originalPath !== (expected.name === 'claude-bridge.js'
        ? descriptor.originalMainPath
        : path.join(path.dirname(descriptor.originalMainPath), expected.name))
      || !/^[0-9a-f]{64}$/u.test(String(file.sha256 || ''))
      || !Number.isSafeInteger(file.size)
      || file.size < 0
    ) throw new Error('Immutable bridge snapshot file descriptor is invalid.');
    assertPrivateNode(snapshotPath, 0o600, 'file');
    const bytes = fs.readFileSync(snapshotPath);
    if (bytes.length !== file.size || sha256(bytes) !== file.sha256) {
      throw new Error(`Immutable bridge snapshot bytes changed: ${expected.name}`);
    }
  }
  const aggregate = crypto.createHash('sha256');
  for (const file of descriptor.files) {
    aggregate.update(JSON.stringify([
      file.name,
      true,
      true,
      true,
      true,
      true,
      file.sha256,
      false,
    ]));
    aggregate.update('\0');
  }
  if (aggregate.digest('hex') !== descriptor.manifestSha256) {
    throw new Error('Immutable bridge snapshot aggregate lineage is invalid.');
  }
  return descriptor;
}

function processDefinitelyGone(pid, killImpl = process.kill.bind(process)) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try {
    killImpl(pid, 0);
    return false;
  } catch (error) {
    return error?.code === 'ESRCH';
  }
}

/**
 * Remove only old, fully valid, same-user snapshot trees whose creating
 * supervisor PID is definitively gone. This is a bounded crash-recovery pass;
 * fresh, malformed, ambiguous, permission-denied, and live-owner entries are
 * always retained.
 */
function scavengeStaleImmutableBridgeSnapshots(options = {}) {
  const now = typeof options.now === 'function' ? Number(options.now()) : Date.now();
  const minAgeMs = Number.isFinite(options.minAgeMs) && options.minAgeMs >= 0
    ? Number(options.minAgeMs)
    : IMMUTABLE_SNAPSHOT_STALE_MIN_AGE_MS;
  const maxEntries = Number.isSafeInteger(options.maxEntries) && options.maxEntries > 0
    ? Math.min(options.maxEntries, IMMUTABLE_SNAPSHOT_SCAVENGE_MAX_ENTRIES)
    : IMMUTABLE_SNAPSHOT_SCAVENGE_MAX_ENTRIES;
  const tempRoot = fs.realpathSync(os.tmpdir());
  let candidateRootPaths;
  if (Array.isArray(options.candidateRootPaths)) {
    candidateRootPaths = options.candidateRootPaths.slice(0, maxEntries);
  } else {
    candidateRootPaths = fs.readdirSync(tempRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(IMMUTABLE_SNAPSHOT_PREFIX))
      .slice(0, maxEntries)
      .map((entry) => path.join(tempRoot, entry.name));
  }
  const result = { scanned: 0, removed: 0, retained: 0 };

  for (const rawRootPath of candidateRootPaths) {
    result.scanned += 1;
    try {
      const rootPath = path.resolve(String(rawRootPath || ''));
      if (!snapshotRootIsOwned(rootPath)) throw new Error('snapshot root is not owned');
      const rootStat = assertPrivateNode(rootPath, 0o700, 'directory');
      const descriptorPath = path.join(rootPath, IMMUTABLE_SNAPSHOT_DESCRIPTOR_NAME);
      const descriptorStat = assertPrivateNode(descriptorPath, 0o600, 'file');
      const descriptorBytes = fs.readFileSync(descriptorPath);
      if (descriptorBytes.length > 64 * 1024) throw new Error('snapshot descriptor is too large');
      const descriptor = JSON.parse(descriptorBytes.toString('utf8'));
      const newestTimestampMs = Math.max(
        Number(descriptor?.createdAtMs) || Number.POSITIVE_INFINITY,
        rootStat.mtimeMs,
        rootStat.ctimeMs,
        descriptorStat.mtimeMs,
        descriptorStat.ctimeMs,
      );
      if (!Number.isFinite(now) || now - newestTimestampMs < minAgeMs) {
        result.retained += 1;
        continue;
      }
      const definitelyGone = typeof options.isProcessDefinitelyGone === 'function'
        ? options.isProcessDefinitelyGone(descriptor?.creatorPid) === true
        : processDefinitelyGone(descriptor?.creatorPid);
      if (!definitelyGone) {
        result.retained += 1;
        continue;
      }
      readAndVerifyImmutableBridgeSnapshot({
        rootPath,
        descriptorPath,
        snapshotId: descriptor.snapshotId,
        manifestSha256: descriptor.manifestSha256,
        originalMainPath: descriptor.originalMainPath,
        createdAtMs: descriptor.createdAtMs,
        creatorPid: descriptor.creatorPid,
      });
      if (cleanupImmutableBridgeSnapshot({ rootPath })) result.removed += 1;
      else result.retained += 1;
    } catch {
      result.retained += 1;
    }
  }
  return Object.freeze(result);
}

// This bootstrap is passed directly to the already-running supervisor's exact
// Node binary. It does not read a bootstrap from the mutable checkout. Every
// manifest byte is loaded and hashed into memory before the main module runs.
const IMMUTABLE_SNAPSHOT_BOOTSTRAP = String.raw`
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const Module = require('module');
const path = require('path');
const descriptorPath = path.resolve(String(process.argv[1] || ''));
const expectedManifestSha256 = String(process.argv[2] || '');
const expectedSnapshotId = String(process.argv[3] || '');
const expectedOriginalMainPath = String(process.argv[4] || '');
const rootPath = path.dirname(descriptorPath);
const filesPath = path.join(rootPath, 'files');
const exactUid = (stat) => typeof process.getuid !== 'function' || stat.uid === process.getuid();
const checkNode = (candidate, mode, directory) => {
  const stat = fs.lstatSync(candidate);
  if (!exactUid(stat) || (stat.mode & 0o777) !== mode || stat.isSymbolicLink()
      || (directory ? !stat.isDirectory() : (!stat.isFile() || stat.nlink !== 1))
      || fs.realpathSync(candidate) !== candidate) throw new Error('immutable_snapshot_node_invalid');
};
checkNode(rootPath, 0o700, true);
checkNode(filesPath, 0o700, true);
checkNode(descriptorPath, 0o600, false);
const descriptorBytes = fs.readFileSync(descriptorPath);
if (descriptorBytes.length > 64 * 1024) throw new Error('immutable_snapshot_descriptor_too_large');
const descriptor = JSON.parse(descriptorBytes.toString('utf8'));
const exactNames = ['claude-bridge.js','terminal-launch-utils.js','desktop-bridge-security.js','codex-session-summary.js','browser-bridge.js'];
if (descriptor.schemaVersion !== 1 || !/^[0-9a-f]{32}$/.test(String(descriptor.snapshotId || ''))
    || !/^[0-9a-f]{64}$/.test(String(descriptor.manifestSha256 || ''))
    || descriptor.manifestSha256 !== expectedManifestSha256
    || descriptor.snapshotId !== expectedSnapshotId
    || descriptor.originalMainPath !== expectedOriginalMainPath
    || !/^[0-9a-f]{64}$/.test(expectedManifestSha256)
    || !/^[0-9a-f]{32}$/.test(expectedSnapshotId)
    || path.resolve(expectedOriginalMainPath) !== expectedOriginalMainPath
    || !Number.isSafeInteger(descriptor.createdAtMs) || descriptor.createdAtMs <= 0
    || !Number.isSafeInteger(descriptor.creatorPid) || descriptor.creatorPid < 1
    || !Array.isArray(descriptor.files) || descriptor.files.length !== exactNames.length
    || path.resolve(String(descriptor.originalMainPath || '')) !== descriptor.originalMainPath) {
  throw new Error('immutable_snapshot_descriptor_invalid');
}
const captured = new Map();
const aggregate = crypto.createHash('sha256');
for (let index = 0; index < exactNames.length; index += 1) {
  const name = exactNames[index];
  const file = descriptor.files[index];
  const snapshotPath = path.join(filesPath, name);
  const expectedOriginalPath = name === 'claude-bridge.js'
    ? descriptor.originalMainPath
    : path.join(path.dirname(descriptor.originalMainPath), name);
  if (!file || file.name !== name || file.required !== true || file.originalPath !== expectedOriginalPath
      || !/^[0-9a-f]{64}$/.test(String(file.sha256 || '')) || !Number.isSafeInteger(file.size) || file.size < 0) {
    throw new Error('immutable_snapshot_file_descriptor_invalid');
  }
  checkNode(snapshotPath, 0o600, false);
  const bytes = fs.readFileSync(snapshotPath);
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  if (bytes.length !== file.size || digest !== file.sha256) throw new Error('immutable_snapshot_file_bytes_invalid');
  captured.set(path.resolve(file.originalPath), bytes.toString('utf8'));
  aggregate.update(JSON.stringify([name,true,true,true,true,true,file.sha256,false]));
  aggregate.update('\0');
}
if (aggregate.digest('hex') !== descriptor.manifestSha256) throw new Error('immutable_snapshot_aggregate_invalid');
const originalExtension = Module._extensions['.js'];
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function immutableSnapshotResolve(request, parent, isMain, options) {
  let candidate = null;
  if (path.isAbsolute(request)) candidate = path.resolve(request);
  else if ((request.startsWith('./') || request.startsWith('../')) && parent && parent.filename) {
    candidate = path.resolve(path.dirname(parent.filename), request);
  }
  if (candidate && !path.extname(candidate)) candidate += '.js';
  if (candidate && captured.has(candidate)) return candidate;
  return originalResolveFilename.call(this, request, parent, isMain, options);
};
Module._extensions['.js'] = function immutableSnapshotExtension(module, filename) {
  const exactFilename = path.resolve(filename);
  if (!captured.has(exactFilename)) return originalExtension(module, filename);
  module._compile(captured.get(exactFilename), exactFilename);
};
process.env.UC_BRIDGE_IMMUTABLE_STARTUP_MANIFEST_SHA256 = descriptor.manifestSha256;
process.env.UC_BRIDGE_IMMUTABLE_SOURCE_SNAPSHOT_ID = descriptor.snapshotId;
process.argv = [process.argv[0], descriptor.originalMainPath];
Module._load(descriptor.originalMainPath, null, true);
`;

function immutableBridgeSnapshotSpawnSpec(snapshot) {
  readAndVerifyImmutableBridgeSnapshot(snapshot);
  return Object.freeze({
    args: Object.freeze([
      '-e',
      IMMUTABLE_SNAPSHOT_BOOTSTRAP,
      snapshot.descriptorPath,
      snapshot.manifestSha256,
      snapshot.snapshotId,
      snapshot.originalMainPath,
    ]),
    env: Object.freeze({
      UC_BRIDGE_SUPERVISOR_IMMUTABLE_HANDOFF_V1: '1',
    }),
  });
}

module.exports = {
  BRIDGE_SOURCE_MANIFEST,
  IMMUTABLE_SNAPSHOT_BOOTSTRAP,
  captureStableBridgeSource,
  cleanupImmutableBridgeSnapshot,
  createImmutableBridgeSnapshot,
  immutableBridgeSnapshotSpawnSpec,
  readAndVerifyImmutableBridgeSnapshot,
  scavengeStaleImmutableBridgeSnapshots,
};
