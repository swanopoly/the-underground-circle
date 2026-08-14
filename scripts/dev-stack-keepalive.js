#!/usr/bin/env node
// dev-stack-keepalive — port-checking supervisor for the local dev stack,
// designed to run under a user LaunchAgent (launchd) so the desktop bridges
// are ALWAYS up (the web app cannot start them itself: a browser page cannot
// spawn a local process when nothing local is listening — see
// src/lib/desktopBridgeAutoConnect.ts).
//
// Unlike start-dev.js (which owns its children), this loop only starts what
// is NOT already listening, so it coexists with a manually-run
// `npm run start` / `npm run web` / `npm run bridge`: if a port is occupied,
// whoever owns it keeps it. Kill any service and the next sweep restarts it.
//
// Install/uninstall via `npm run autostart:install` / `autostart:uninstall`.
// Set UC_KEEPALIVE_EXPO=0 in the LaunchAgent env to leave the Expo web
// server manual while keeping bridges+proxy always-on.

const { spawn } = require('child_process');
const crypto = require('crypto');
const http = require('http');
const net = require('net');
const path = require('path');
const {
  captureStableBridgeSource,
  cleanupImmutableBridgeSnapshot,
  createImmutableBridgeSnapshot,
  immutableBridgeSnapshotSpawnSpec,
  readAndVerifyImmutableBridgeSnapshot,
  scavengeStaleImmutableBridgeSnapshots,
} = require('./desktop-bridge-immutable-snapshot');

const REPO = path.resolve(__dirname, '..');
const NODE = process.execPath;
const NODE_DIR = path.dirname(NODE);
const ENV = { ...process.env, PATH: `${NODE_DIR}:${process.env.PATH || '/usr/bin:/bin'}` };

const SWEEP_MS = 15_000;
const LOCK_PORT = 18797; // single-instance guard (loopback)
const MAX_STARTS = 5; // per service per window, then cooldown
const START_WINDOW_MS = 10 * 60_000;
const SAFE_REFRESH_EXIT_CODE = 75;
const BRIDGE_SAFE_REFRESH_IPC_PROTOCOL = 'uc-desktop-bridge-safe-refresh-v2';
const BRIDGE_SAFE_REFRESH_RESERVATION_TTL_MS = process.env.UC_DESKTOP_ATTACHMENT_OPEN_TEST_MODE === '1'
  ? 5_000
  // Five startup files may each consume the 3s syntax-check timeout across
  // multiple fenced reads. Keep the committed entitlement bounded while
  // leaving a wide margin for scan, response-flush, and scheduler latency.
  : 2 * 60_000;
const SAFE_REFRESH_REPLACEMENT_MAX_SPAWN_ATTEMPTS = 3;
const SAFE_REFRESH_REPLACEMENT_RETRY_WINDOW_MS = 30_000;
const SAFE_REFRESH_REPLACEMENT_RETRY_DELAY_MS = 500;
const SAFE_REFRESH_REPLACEMENT_READINESS_TIMEOUT_MS = 8_000;
const SAFE_REFRESH_REPLACEMENT_REAP_TIMEOUT_MS = 2_000;

const EXPO_ENABLED = process.env.UC_KEEPALIVE_EXPO !== '0';

const SERVICES = [
  {
    name: 'claude-bridge',
    port: 7778,
    cmd: NODE,
    args: [path.join(REPO, 'scripts/claude-bridge.js')],
    supervisorKind: 'dev-stack-keepalive',
  },
  { name: 'codex-bridge', port: 7779, cmd: NODE, args: [path.join(REPO, 'scripts/codex-bridge.js')] },
  { name: 'gemini-bridge', port: 7780, cmd: NODE, args: [path.join(REPO, 'scripts/gemini-bridge.js')] },
  { name: 'cursor-bridge', port: 7781, cmd: NODE, args: [path.join(REPO, 'scripts/cursor-bridge.js')] },
  { name: 'openswan-proxy', port: 18790, cmd: NODE, args: [path.join(REPO, 'openswan-proxy.js')] },
  ...(EXPO_ENABLED
    // A keepalive respawn follows a crash/recovery boundary, not the normal
    // edit/refresh loop. Clear Metro's transform cache at that boundary so an
    // already-open Chat tab cannot reconnect to a pre-repair bundle graph.
    ? [{ name: 'expo-web', port: 8081, cmd: path.join(NODE_DIR, 'npx'), args: ['expo', 'start', '--web', '--clear'] }]
    : []),
];

// plannedSafeRefreshRespawn is a bounded controller, not a boolean. It retains
// one immutable snapshot until signed ONLINE plus exact health, so pre-spawn
// or early-start failures cannot strand a bridge whose old generation exited
// 75 or widen the replacement into mutable-checkout execution.
const state = new Map(); // name -> { child, starts: number[], plannedSafeRefreshRespawn }

function bridgeSafeRefreshIpcMac(secret, type, fields) {
  return crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify([BRIDGE_SAFE_REFRESH_IPC_PROTOCOL, type, ...fields]))
    .digest('hex');
}

function bridgeSafeRefreshIpcMacMatches(secret, type, fields, supplied) {
  if (!/^[0-9a-f]{64}$/u.test(String(supplied || ''))) return false;
  const expected = Buffer.from(bridgeSafeRefreshIpcMac(secret, type, fields), 'hex');
  const actual = Buffer.from(supplied, 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function verifyBridgeOnlineHealth(options) {
  const host = options?.host === '::1' ? '::1' : '127.0.0.1';
  const port = Number(options?.port);
  const expectedInstanceId = String(options?.instanceId || '');
  const expectedManifestSha256 = String(options?.manifestSha256 || '');
  const expectedSnapshotId = String(options?.snapshotId || '');
  const timeoutMs = Number(options?.timeoutMs) || 2_000;
  if (
    !Number.isSafeInteger(port)
    || port < 1
    || port > 65_535
    || !/^[0-9a-f]{32}$/u.test(expectedInstanceId)
    || !/^[0-9a-f]{64}$/u.test(expectedManifestSha256)
    || (expectedSnapshotId && !/^[0-9a-f]{32}$/u.test(expectedSnapshotId))
  ) return Promise.resolve(false);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const req = http.get({
      host,
      port,
      path: '/desktop/health',
      headers: { Host: `${host === '::1' ? '[::1]' : host}:${port}` },
      timeout: timeoutMs,
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
        if (body.length > 256 * 1024) res.destroy();
      });
      res.on('end', () => {
        if (res.statusCode !== 200 || body.length > 256 * 1024) {
          finish(false);
          return;
        }
        try {
          const parsed = JSON.parse(body);
          finish(Boolean(
            parsed?.ok === true
            && parsed?.instanceId === expectedInstanceId
            && parsed?.restartSafety?.startupSourceSha256 === expectedManifestSha256
            && String(parsed?.restartSafety?.startupSourceSnapshotId || '') === expectedSnapshotId
            && parsed?.restartSafety?.browserRuntime?.available === true
            && parsed?.restartSafety?.browserRuntime?.unknown === false
          ));
        } catch {
          finish(false);
        }
      });
    });
    req.once('timeout', () => req.destroy(new Error('bridge readiness health timeout')));
    req.once('error', () => finish(false));
  });
}

function inspectServiceStartupManifestSha256(svc) {
  const sourcePath = path.resolve(Array.isArray(svc?.args) ? String(svc.args[0] || '') : '');
  if (!sourcePath || path.basename(sourcePath) !== 'claude-bridge.js') return null;
  try {
    return captureStableBridgeSource(sourcePath).manifestSha256;
  } catch {
    return null;
  }
}

/**
 * Bind a single Claude bridge child generation to a real supervisor IPC peer.
 * The returned controller owns exactly one short-lived replacement reservation
 * and exposes consumption only to the exact child's exit callback.
 */
function attachBridgeSafeRefreshIpcController(child, options) {
  const kind = String(options?.kind || '');
  const secret = String(options?.secret || '');
  const generation = Number(options?.generation);
  const parentPid = Number(options?.parentPid || process.pid);
  const now = options?.now || (() => Date.now());
  const randomHex = options?.randomHex || (() => crypto.randomBytes(32).toString('hex'));
  const reservationTtlMs = Number(options?.reservationTtlMs) || BRIDGE_SAFE_REFRESH_RESERVATION_TTL_MS;
  const allowedKinds = new Set(['dev-stack-keepalive', 'start-dev']);
  const expectedManifestSha256 = String(options?.expectedManifestSha256 || '');
  const expectedSnapshotId = String(options?.expectedSnapshotId || '');
  let reservation = null;
  let reservationExpiryTimer = null;
  let disposed = false;
  let onlineReadinessInFlight = false;
  let onlineReadinessProved = false;
  const sourcePath = path.resolve(String(options?.sourcePath || ''));
  const snapshotFactory = options?.createSnapshot || createImmutableBridgeSnapshot;
  const snapshotCleanup = options?.cleanupSnapshot || cleanupImmutableBridgeSnapshot;
  const snapshotVerify = options?.verifySnapshot || readAndVerifyImmutableBridgeSnapshot;

  const clearReservationExpiryTimer = () => {
    if (reservationExpiryTimer === null) return;
    clearTimeout(reservationExpiryTimer);
    reservationExpiryTimer = null;
  };
  const releaseReservation = (cleanupSnapshot = true) => {
    const released = reservation;
    reservation = null;
    clearReservationExpiryTimer();
    if (cleanupSnapshot && released?.immutableSnapshot) {
      snapshotCleanup(released.immutableSnapshot);
    }
    return released;
  };
  const armReservationExpiry = () => {
    clearReservationExpiryTimer();
    if (!reservation) return;
    const exactReservation = reservation;
    const delayMs = Math.max(1, exactReservation.expiresAtMs - now() + 1);
    reservationExpiryTimer = setTimeout(() => {
      reservationExpiryTimer = null;
      if (reservation !== exactReservation) return;
      if (exactReservation.expiresAtMs > now()) {
        armReservationExpiry();
        return;
      }
      releaseReservation(true);
    }, delayMs);
    reservationExpiryTimer.unref?.();
  };

  if (
    !child
    || typeof child.on !== 'function'
    || typeof child.send !== 'function'
    || !allowedKinds.has(kind)
    || !/^[0-9a-f]{64}$/u.test(secret)
    || !Number.isSafeInteger(generation)
    || generation < 1
  ) throw new Error('Invalid bridge safe-refresh IPC controller configuration.');

  const send = (message) => {
    if (disposed || !child.connected) return false;
    try {
      child.send(message, (error) => {
        if (error && error.code !== 'ERR_IPC_CHANNEL_CLOSED') {
          console.warn(`[supervisor] bridge safe-refresh IPC reply failed: ${error.message}`);
        }
      });
      return true;
    } catch {
      return false;
    }
  };

  const commonFields = (message) => [
    kind,
    parentPid,
    child.pid,
    generation,
    String(message.instanceId || ''),
    String(message.manifestSha256 || ''),
  ];

  const validCommon = (message, type, tailFields) => {
    if (
      !message
      || message.protocol !== BRIDGE_SAFE_REFRESH_IPC_PROTOCOL
      || message.type !== type
      || message.supervisorKind !== kind
      || message.parentPid !== parentPid
      || message.childPid !== child.pid
      || message.generation !== generation
      || !/^[0-9a-f]{32}$/u.test(String(message.instanceId || ''))
      || !/^[0-9a-f]{64}$/u.test(String(message.manifestSha256 || ''))
    ) return false;
    return bridgeSafeRefreshIpcMacMatches(
      secret,
      type,
      [...commonFields(message), ...tailFields],
      message.mac,
    );
  };

  const handleMessage = (message) => {
    if (disposed || !message || typeof message !== 'object') return;

    if (message.type === 'hello') {
      const nonce = String(message.requestNonce || '');
      if (!/^[0-9a-f]{64}$/u.test(nonce) || !validCommon(message, 'hello', [nonce])) return;
      const expiresAtMs = now() + Math.max(1_000, reservationTtlMs);
      const fields = [...commonFields(message), nonce, expiresAtMs];
      send({
        protocol: BRIDGE_SAFE_REFRESH_IPC_PROTOCOL,
        type: 'ready',
        supervisorKind: kind,
        parentPid,
        childPid: child.pid,
        generation,
        instanceId: message.instanceId,
        manifestSha256: message.manifestSha256,
        requestNonce: nonce,
        expiresAtMs,
        mac: bridgeSafeRefreshIpcMac(secret, 'ready', fields),
      });
      return;
    }

    if (message.type === 'online') {
      const nonce = String(message.requestNonce || '');
      const host = String(message.host || '');
      const port = Number(message.port);
      const expectedHost = options?.healthHost || '127.0.0.1';
      const expectedPort = Number(options?.healthPort);
      const snapshotId = String(message.snapshotId || '');
      if (
        !/^[0-9a-f]{64}$/u.test(nonce)
        || host !== expectedHost
        || port !== expectedPort
        || (/^[0-9a-f]{64}$/u.test(expectedManifestSha256)
          && message.manifestSha256 !== expectedManifestSha256)
        || (expectedSnapshotId && snapshotId !== expectedSnapshotId)
        || !validCommon(message, 'online', [nonce, host, port, snapshotId])
        || onlineReadinessInFlight
        || onlineReadinessProved
      ) return;
      // This notification is emitted from the exact server.listen callback.
      // Require a second, bounded observation of that exact instance and
      // startup manifest before consuming replacement custody.
      onlineReadinessInFlight = true;
      const verifyHealth = options?.verifyHealth || verifyBridgeOnlineHealth;
      const healthInput = {
        host,
        port,
        instanceId: message.instanceId,
        manifestSha256: message.manifestSha256,
        snapshotId,
      };
      const healthAttempts = Number.isSafeInteger(options?.healthAttempts) && options.healthAttempts > 0
        ? options.healthAttempts
        : 3;
      const healthRetryDelayMs = Number.isFinite(options?.healthRetryDelayMs) && options.healthRetryDelayMs >= 0
        ? options.healthRetryDelayMs
        : 100;
      const proveHealth = async () => {
        for (let attempt = 1; attempt <= healthAttempts; attempt += 1) {
          if (await verifyHealth(healthInput)) return true;
          if (attempt < healthAttempts) {
            await new Promise((resolve) => setTimeout(resolve, healthRetryDelayMs));
          }
        }
        return false;
      };
      proveHealth().then((healthy) => {
        onlineReadinessInFlight = false;
        if (!healthy || disposed || onlineReadinessProved) return;
        onlineReadinessProved = true;
        options?.onBridgeReady?.({
          child,
          generation,
          instanceId: message.instanceId,
          manifestSha256: message.manifestSha256,
          snapshotId,
          host,
          port,
        });
      }).catch(() => {
        onlineReadinessInFlight = false;
      });
      return;
    }

    if (message.type === 'reserve') {
      const requestNonce = String(message.requestNonce || '');
      if (!/^[0-9a-f]{64}$/u.test(requestNonce) || !validCommon(message, 'reserve', [requestNonce])) return;
      const currentTime = now();
      if (reservation && reservation.expiresAtMs <= currentTime) {
        releaseReservation(true);
      }
      if (reservation) {
        if (
          reservation.requestNonce !== requestNonce
          || reservation.instanceId !== message.instanceId
          || reservation.manifestSha256 !== message.manifestSha256
        ) return;
      } else {
        let immutableSnapshot;
        try {
          immutableSnapshot = snapshotFactory({
            sourcePath,
            expectedManifestSha256: message.manifestSha256,
          });
          if (
            !immutableSnapshot
            || immutableSnapshot.manifestSha256 !== message.manifestSha256
            || immutableSnapshot.fileCount !== 5
          ) throw new Error('Supervisor snapshot did not preserve the exact five-file manifest.');
        } catch (error) {
          options?.onSnapshotFailure?.(error);
          return;
        }
        let reservationId;
        try {
          reservationId = String(randomHex() || '');
        } catch (error) {
          snapshotCleanup(immutableSnapshot);
          options?.onSnapshotFailure?.(error);
          return;
        }
        if (!/^[0-9a-f]{64}$/u.test(reservationId)) {
          snapshotCleanup(immutableSnapshot);
          options?.onSnapshotFailure?.(new Error('Supervisor snapshot reservation identity is invalid.'));
          return;
        }
        reservation = {
          generation,
          childPid: child.pid,
          instanceId: message.instanceId,
          manifestSha256: message.manifestSha256,
          requestNonce,
          reservationId,
          expiresAtMs: currentTime + reservationTtlMs,
          state: 'reserved',
          immutableSnapshot,
        };
        armReservationExpiry();
      }
      const fields = [
        ...commonFields(message),
        reservation.requestNonce,
        reservation.reservationId,
        reservation.expiresAtMs,
      ];
      send({
        protocol: BRIDGE_SAFE_REFRESH_IPC_PROTOCOL,
        type: 'reserved',
        supervisorKind: kind,
        parentPid,
        childPid: child.pid,
        generation,
        instanceId: message.instanceId,
        manifestSha256: message.manifestSha256,
        requestNonce: reservation.requestNonce,
        reservationId: reservation.reservationId,
        expiresAtMs: reservation.expiresAtMs,
        mac: bridgeSafeRefreshIpcMac(secret, 'reserved', fields),
      });
      return;
    }

    if (message.type === 'commit') {
      const requestNonce = String(message.requestNonce || '');
      const reservationId = String(message.reservationId || '');
      if (
        !/^[0-9a-f]{64}$/u.test(requestNonce)
        || !/^[0-9a-f]{64}$/u.test(reservationId)
        || !validCommon(message, 'commit', [requestNonce, reservationId])
      ) return;
      if (
        !reservation
        || reservation.expiresAtMs <= now()
        || reservation.state !== 'reserved'
        || reservation.requestNonce !== requestNonce
        || reservation.reservationId !== reservationId
        || reservation.instanceId !== message.instanceId
        || reservation.manifestSha256 !== message.manifestSha256
      ) return;
      try {
        const committedDescriptor = snapshotVerify(reservation.immutableSnapshot);
        if (
          committedDescriptor?.manifestSha256 !== message.manifestSha256
          || committedDescriptor?.files?.length !== 5
        ) throw new Error('Committed snapshot lineage is incomplete.');
      } catch (error) {
        releaseReservation(true);
        options?.onSnapshotFailure?.(error);
        return;
      }
      // Commit before acknowledging. Only this exact committed record can turn
      // the child's later code-75 exit into a rate-gate-bypassing replacement.
      reservation.state = 'committed';
      reservation.expiresAtMs = now() + reservationTtlMs;
      armReservationExpiry();
      options?.onReservationCommitted?.({
        child,
        generation,
        instanceId: reservation.instanceId,
        manifestSha256: reservation.manifestSha256,
        snapshotId: reservation.immutableSnapshot?.snapshotId || '',
      });
      const fields = [
        ...commonFields(message),
        requestNonce,
        reservationId,
        reservation.expiresAtMs,
      ];
      send({
        protocol: BRIDGE_SAFE_REFRESH_IPC_PROTOCOL,
        type: 'committed',
        supervisorKind: kind,
        parentPid,
        childPid: child.pid,
        generation,
        instanceId: message.instanceId,
        manifestSha256: message.manifestSha256,
        requestNonce,
        reservationId,
        expiresAtMs: reservation.expiresAtMs,
        mac: bridgeSafeRefreshIpcMac(secret, 'committed', fields),
      });
      return;
    }

    if (message.type === 'cancel') {
      const requestNonce = String(message.requestNonce || '');
      const reservationId = String(message.reservationId || '');
      if (
        !/^[0-9a-f]{64}$/u.test(requestNonce)
        || !/^[0-9a-f]{64}$/u.test(reservationId)
        || !validCommon(message, 'cancel', [requestNonce, reservationId])
      ) return;
      if (
        reservation
        && ['reserved', 'committed'].includes(reservation.state)
        && reservation.requestNonce === requestNonce
        && reservation.reservationId === reservationId
      ) {
        releaseReservation(true);
      }
    }
  };

  child.on('message', handleMessage);

  return {
    consumeCommittedExit(code, signal, isCurrentChild) {
      const record = releaseReservation(false);
      if (
        !isCurrentChild
        || code !== SAFE_REFRESH_EXIT_CODE
        || signal !== null
        || !record
        || record.state !== 'committed'
        || record.expiresAtMs <= now()
        || record.generation !== generation
        || record.childPid !== child.pid
      ) {
        snapshotCleanup(record?.immutableSnapshot);
        return false;
      }
      record.state = 'consumed';
      return {
        generation: record.generation,
        childPid: record.childPid,
        instanceId: record.instanceId,
        manifestSha256: record.manifestSha256,
        expiresAtMs: record.expiresAtMs,
        immutableSnapshot: record.immutableSnapshot,
      };
    },
    hasPendingReservation() {
      return Boolean(reservation && reservation.expiresAtMs > now());
    },
    snapshotForTest() {
      return reservation ? { ...reservation } : null;
    },
    dispose() {
      disposed = true;
      releaseReservation(true);
      child.removeListener('message', handleMessage);
    },
  };
}

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function portListening(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host: '127.0.0.1' });
    const done = (up) => { sock.destroy(); resolve(up); };
    sock.setTimeout(1000, () => done(false));
    sock.on('connect', () => done(true));
    sock.on('error', () => done(false));
  });
}

/**
 * Own the one availability entitlement created by a committed safe-refresh
 * exit. Returning a ChildProcess is not success: Node reports an invalid
 * executable with `error` and never emits `spawn` or `exit`. Retain custody
 * across pre-spawn and early-startup failures. Consumption requires signed
 * post-listen ONLINE plus an exact-instance health response.
 */
function createBoundedSafeRefreshReplacementController(options = {}) {
  const now = options.now || (() => Date.now());
  const scheduleImpl = options.schedule || setTimeout;
  const clearScheduleImpl = options.clearSchedule || clearTimeout;
  const maxAttempts = Number.isSafeInteger(options.maxAttempts) && options.maxAttempts > 0
    ? options.maxAttempts
    : SAFE_REFRESH_REPLACEMENT_MAX_SPAWN_ATTEMPTS;
  const retryWindowMs = Number.isFinite(options.retryWindowMs) && options.retryWindowMs > 0
    ? options.retryWindowMs
    : SAFE_REFRESH_REPLACEMENT_RETRY_WINDOW_MS;
  const retryDelayMs = Number.isFinite(options.retryDelayMs) && options.retryDelayMs >= 0
    ? options.retryDelayMs
    : SAFE_REFRESH_REPLACEMENT_RETRY_DELAY_MS;
  const readinessTimeoutMs = Number.isFinite(options.readinessTimeoutMs) && options.readinessTimeoutMs > 0
    ? options.readinessTimeoutMs
    : SAFE_REFRESH_REPLACEMENT_READINESS_TIMEOUT_MS;
  const reapTimeoutMs = Number.isFinite(options.reapTimeoutMs) && options.reapTimeoutMs > 0
    ? options.reapTimeoutMs
    : SAFE_REFRESH_REPLACEMENT_REAP_TIMEOUT_MS;
  const openedAtMs = now();
  const deadlineAtMs = openedAtMs + retryWindowMs;
  let phase = 'reserved';
  let attempts = 0;
  let timer = null;
  let candidate = null;
  let candidateCleanup = null;
  let ordinaryRecoveryCalled = false;

  const active = () => [
    'reserved',
    'attempting',
    'retry_wait',
    'awaiting_readiness',
    'awaiting_exit_after_timeout',
  ].includes(phase);

  const finishWithOrdinaryRecovery = (reason, error = null) => {
    if (!active()) return false;
    phase = 'exhausted';
    candidateCleanup?.();
    candidateCleanup = null;
    candidate = null;
    if (timer !== null) {
      clearScheduleImpl(timer);
      timer = null;
    }
    if (!ordinaryRecoveryCalled) {
      ordinaryRecoveryCalled = true;
      options.onOrdinaryRecovery?.({ reason, error, attempts, openedAtMs, deadlineAtMs });
    }
    return true;
  };

  const scheduleAttempt = (delayMs) => {
    if (!active() || timer !== null) return false;
    if (attempts >= maxAttempts || now() > deadlineAtMs) {
      return finishWithOrdinaryRecovery('bounded_safe_refresh_replacement_exhausted');
    }
    phase = attempts === 0 ? 'reserved' : 'retry_wait';
    timer = scheduleImpl(runAttempt, delayMs);
    return true;
  };

  const failAttempt = (failedCandidate, error) => {
    if (!active() || candidate !== failedCandidate) return false;
    candidateCleanup?.();
    candidateCleanup = null;
    candidate = null;
    if (timer !== null) {
      clearScheduleImpl(timer);
      timer = null;
    }
    if (attempts >= maxAttempts || now() > deadlineAtMs) {
      return finishWithOrdinaryRecovery('bounded_safe_refresh_replacement_exhausted', error);
    }
    options.onAttemptFailure?.({ error, attempts });
    return scheduleAttempt(retryDelayMs);
  };

  function runAttempt() {
    timer = null;
    if (!active()) return;
    if (attempts >= maxAttempts || now() > deadlineAtMs) {
      finishWithOrdinaryRecovery('bounded_safe_refresh_replacement_exhausted');
      return;
    }
    phase = 'attempting';
    attempts += 1;
    let child;
    try {
      child = options.startAttempt?.({ attempt: attempts, openedAtMs, deadlineAtMs });
    } catch (error) {
      // Use a unique sentinel so the same failure path handles synchronous
      // spawn throws without pretending a process was created.
      const thrownAttempt = {};
      candidate = thrownAttempt;
      if (options.isFatalStartError?.(error)) {
        finishWithOrdinaryRecovery('safe_refresh_replacement_lineage_changed', error);
        return;
      }
      failAttempt(thrownAttempt, error);
      return;
    }
    if (!child || typeof child.once !== 'function') {
      const invalidCandidate = {};
      candidate = invalidCandidate;
      failAttempt(invalidCandidate, new Error('Replacement attempt did not return a ChildProcess.'));
      return;
    }
    candidate = child;
    let spawned = false;
    let settled = false;
    const onExitBeforeReady = (code, signal) => {
      if (settled || !active() || candidate !== child) return;
      settled = true;
      child.removeListener('spawn', onSpawn);
      child.removeListener('error', onPreSpawnError);
      failAttempt(
        child,
        Object.assign(new Error('Replacement exited before bridge readiness.'), { code, signal }),
      );
    };
    const onDisconnectBeforeReady = () => {
      if (settled || !active() || candidate !== child || phase !== 'awaiting_readiness') return;
      phase = 'awaiting_exit_after_timeout';
      if (timer !== null) {
        clearScheduleImpl(timer);
        timer = null;
      }
      options.onReadinessTimeout?.({
        child,
        attempts,
        openedAtMs,
        deadlineAtMs,
        reason: 'ipc_disconnected_before_readiness',
      });
      timer = scheduleImpl(() => {
        timer = null;
        if (settled || !active() || candidate !== child) return;
        finishWithOrdinaryRecovery('safe_refresh_replacement_reap_timeout');
      }, reapTimeoutMs);
    };
    const onCloseBeforeReady = (code, signal) => {
      if (settled || !active() || candidate !== child) return;
      settled = true;
      options.onCandidateClosed?.({ child, code, signal, attempts });
      failAttempt(
        child,
        Object.assign(new Error('Replacement closed before bridge readiness.'), { code, signal }),
      );
    };
    const onSpawn = () => {
      if (settled || !active() || candidate !== child) return;
      spawned = true;
      phase = 'awaiting_readiness';
      options.onSpawned?.({ child, attempts, openedAtMs, deadlineAtMs });
      const remainingWindowMs = Math.max(1, deadlineAtMs - now());
      timer = scheduleImpl(() => {
        timer = null;
        if (settled || !active() || candidate !== child || phase !== 'awaiting_readiness') return;
        phase = 'awaiting_exit_after_timeout';
        options.onReadinessTimeout?.({
          child,
          attempts,
          openedAtMs,
          deadlineAtMs,
          reason: 'readiness_timeout',
        });
        timer = scheduleImpl(() => {
          timer = null;
          if (settled || !active() || candidate !== child) return;
          finishWithOrdinaryRecovery('safe_refresh_replacement_reap_timeout');
        }, reapTimeoutMs);
      }, Math.min(readinessTimeoutMs, remainingWindowMs));
    };
    const onPreSpawnError = (error) => {
      if (settled || !active() || candidate !== child) return;
      if (spawned) {
        if (phase !== 'awaiting_readiness') return;
        phase = 'awaiting_exit_after_timeout';
        if (timer !== null) {
          clearScheduleImpl(timer);
          timer = null;
        }
        options.onReadinessTimeout?.({
          child,
          attempts,
          openedAtMs,
          deadlineAtMs,
          reason: 'child_error_before_readiness',
          error,
        });
        timer = scheduleImpl(() => {
          timer = null;
          if (settled || !active() || candidate !== child) return;
          finishWithOrdinaryRecovery('safe_refresh_replacement_reap_timeout', error);
        }, reapTimeoutMs);
        return;
      }
      settled = true;
      child.removeListener('spawn', onSpawn);
      child.removeListener('exit', onExitBeforeReady);
      child.removeListener('close', onCloseBeforeReady);
      child.removeListener('disconnect', onDisconnectBeforeReady);
      failAttempt(child, error);
    };
    child.once('spawn', onSpawn);
    child.once('error', onPreSpawnError);
    child.once('exit', onExitBeforeReady);
    child.once('close', onCloseBeforeReady);
    child.once('disconnect', onDisconnectBeforeReady);
    candidateCleanup = () => {
      child.removeListener('spawn', onSpawn);
      child.removeListener('error', onPreSpawnError);
      child.removeListener('exit', onExitBeforeReady);
      child.removeListener('close', onCloseBeforeReady);
      child.removeListener('disconnect', onDisconnectBeforeReady);
    };
  }

  return {
    scheduleInitial(delayMs = 250) {
      return scheduleAttempt(delayMs);
    },
    cancel() {
      if (!active()) return false;
      phase = 'cancelled';
      candidateCleanup?.();
      candidateCleanup = null;
      candidate = null;
      if (timer !== null) {
        clearScheduleImpl(timer);
        timer = null;
      }
      return true;
    },
    isActive: active,
    ownsCandidate(child) {
      return active() && candidate === child;
    },
    markReady(child) {
      if (!active() || phase !== 'awaiting_readiness' || candidate !== child) return false;
      candidateCleanup?.();
      candidateCleanup = null;
      candidate = null;
      phase = 'consumed';
      if (timer !== null) {
        clearScheduleImpl(timer);
        timer = null;
      }
      options.onReady?.({ child, attempts, openedAtMs, deadlineAtMs });
      return true;
    },
    snapshotForTest() {
      return { phase, attempts, openedAtMs, deadlineAtMs, timerPending: timer !== null };
    },
  };
}

function canStart(svc) {
  const s = state.get(svc.name) || { child: null, starts: [], plannedSafeRefreshRespawn: false };
  const now = Date.now();
  s.starts = s.starts.filter((t) => now - t < START_WINDOW_MS);
  state.set(svc.name, s);
  if (s.child) return false; // our child is alive (port may still be binding)
  if (s.plannedSafeRefreshRespawn) return false; // reserved timer owns the next generation
  if (s.starts.length >= MAX_STARTS) return false; // cooldown until window slides
  return true;
}

function schedulePlannedSafeRefreshRespawn(
  svc,
  serviceState,
  options = {},
) {
  if (serviceState.plannedSafeRefreshRespawn?.isActive?.()) return false;
  const start = options.start || startService;
  const ordinaryRecovery = options.onOrdinaryRecovery || (() => {
    // The bounded entitlement has ended. Preserve the existing crash history
    // and return control to the ordinary port/rate-limited sweep.
    setTimeout(sweep, 0);
  });
  let controller = null;
  const expectedManifestSha256 = String(options.expectedManifestSha256 || '');
  const immutableSnapshot = options.immutableSnapshot;
  const verifySnapshot = options.verifySnapshot || readAndVerifyImmutableBridgeSnapshot;
  const cleanupSnapshot = options.cleanupSnapshot || cleanupImmutableBridgeSnapshot;
  let snapshotCleaned = false;
  const releaseSnapshot = () => {
    if (snapshotCleaned) return false;
    snapshotCleaned = true;
    return cleanupSnapshot(immutableSnapshot);
  };
  controller = createBoundedSafeRefreshReplacementController({
    now: options.now,
    schedule: options.schedule,
    clearSchedule: options.clearSchedule,
    maxAttempts: options.maxAttempts,
    retryWindowMs: options.retryWindowMs,
    retryDelayMs: options.retryDelayMs,
    isFatalStartError: (error) => error?.code === 'SAFE_REFRESH_MANIFEST_LINEAGE_CHANGED',
    startAttempt: ({ attempt }) => {
      if (serviceState.child) {
        throw new Error('Replacement child slot became occupied before spawn.');
      }
      let verifiedSnapshot;
      try {
        verifiedSnapshot = verifySnapshot(immutableSnapshot);
      } catch {
        verifiedSnapshot = null;
      }
      if (!verifiedSnapshot || verifiedSnapshot.manifestSha256 !== expectedManifestSha256) {
        throw Object.assign(
          new Error('Committed immutable safe-refresh snapshot lineage changed before replacement spawn.'),
          { code: 'SAFE_REFRESH_MANIFEST_LINEAGE_CHANGED' },
        );
      }
      // Every attempt belongs to the same exact committed entitlement and may
      // bypass MAX_STARTS. startService still appends to starts, so ordinary
      // crash history is neither reset nor hidden.
      return start(svc, {
        bypassRateLimit: true,
        reason: `idle-safe source refresh attempt ${attempt}`,
        expectedManifestSha256,
        immutableSnapshot,
      });
    },
    onAttemptFailure: ({ error, attempts }) => {
      log(`${svc.name} safe-refresh replacement spawn attempt ${attempts} failed: ${error?.message || 'unknown error'}`);
      options.onAttemptFailure?.({ error, attempts });
    },
    onSpawned: (event) => {
      options.onSpawned?.(event);
    },
    onReadinessTimeout: ({ child, attempts, reason }) => {
      log(`${svc.name} safe-refresh replacement attempt ${attempts} lost readiness (${reason}); terminating it for bounded retry`);
      try {
        child.kill('SIGKILL');
      } catch (error) {
        log(`${svc.name} unready replacement termination failed: ${error.message}`);
      }
      options.onReadinessTimeout?.({ child, attempts, reason });
    },
    onCandidateClosed: ({ child }) => {
      if (serviceState.child === child) {
        serviceState.child = null;
        serviceState.bridgeIpcController = null;
      }
    },
    onReady: (event) => {
      if (serviceState.plannedSafeRefreshRespawn === controller) {
        serviceState.plannedSafeRefreshRespawn = null;
      }
      releaseSnapshot();
      options.onReady?.(event);
    },
    onOrdinaryRecovery: (event) => {
      if (serviceState.plannedSafeRefreshRespawn === controller) {
        serviceState.plannedSafeRefreshRespawn = null;
      }
      releaseSnapshot();
      ordinaryRecovery(event);
    },
  });
  serviceState.plannedSafeRefreshRespawn = controller;
  if (!controller.scheduleInitial(options.delayMs ?? 250)) {
    serviceState.plannedSafeRefreshRespawn = null;
    releaseSnapshot();
    return false;
  }
  const originalCancel = controller.cancel.bind(controller);
  controller.cancel = () => {
    const cancelled = originalCancel();
    releaseSnapshot();
    return cancelled;
  };
  return true;
}

function startService(svc, options = {}) {
  const s = state.get(svc.name);
  if (!s || s.child) return false;
  if (!options.bypassRateLimit && !canStart(svc)) return false;
  s.starts.push(Date.now());
  log(`starting ${svc.name} (port ${svc.port} not listening${options.reason ? `; ${options.reason}` : ''})`);
  const childEnv = { ...ENV };
  let bridgeIpcSecret = null;
  let bridgeIpcGeneration = 0;
  if (svc.supervisorKind) {
    bridgeIpcSecret = crypto.randomBytes(32).toString('hex');
    bridgeIpcGeneration = (s.bridgeIpcGeneration || 0) + 1;
    s.bridgeIpcGeneration = bridgeIpcGeneration;
    childEnv.UC_BRIDGE_SUPERVISOR_KIND = svc.supervisorKind;
    childEnv.UC_BRIDGE_SUPERVISOR_PID = String(process.pid);
    childEnv.UC_BRIDGE_SUPERVISOR_GENERATION = String(bridgeIpcGeneration);
    childEnv.UC_BRIDGE_SUPERVISOR_IPC_SECRET = bridgeIpcSecret;
    childEnv.UC_BRIDGE_SUPERVISOR_IMMUTABLE_HANDOFF_V1 = '1';
  }
  delete childEnv.UC_BRIDGE_IMMUTABLE_STARTUP_MANIFEST_SHA256;
  delete childEnv.UC_BRIDGE_IMMUTABLE_SOURCE_SNAPSHOT_ID;
  delete childEnv.UC_BRIDGE_IMMUTABLE_SNAPSHOT_DESCRIPTOR;
  let spawnArgs = svc.args;
  if (options.immutableSnapshot) {
    let spawnSpec;
    try {
      spawnSpec = immutableBridgeSnapshotSpawnSpec(options.immutableSnapshot);
    } catch {
      return false;
    }
    spawnArgs = spawnSpec.args;
    Object.assign(childEnv, spawnSpec.env);
  } else if (
    options.expectedManifestSha256
    && inspectServiceStartupManifestSha256(svc) !== options.expectedManifestSha256
  ) return false;
  const child = spawn(svc.cmd, spawnArgs, {
    cwd: REPO,
    env: childEnv,
    stdio: svc.supervisorKind
      ? ['ignore', 'inherit', 'inherit', 'ipc']
      : ['ignore', 'inherit', 'inherit'],
    shell: false,
  });
  let childSpawned = false;
  child.once('spawn', () => { childSpawned = true; });
  s.child = child;
  const bridgeIpcController = svc.supervisorKind
      ? attachBridgeSafeRefreshIpcController(child, {
          kind: svc.supervisorKind,
          secret: bridgeIpcSecret,
          generation: bridgeIpcGeneration,
          healthHost: '127.0.0.1',
          healthPort: svc.port,
          expectedManifestSha256: options.expectedManifestSha256,
          expectedSnapshotId: options.immutableSnapshot?.snapshotId,
          sourcePath: path.resolve(String(svc.args[0] || '')),
          onSnapshotFailure: (error) => {
            log(`${svc.name} immutable source snapshot failed closed: ${error?.message || 'unknown error'}`);
          },
          onBridgeReady: ({ child: readyChild }) => {
            s.plannedSafeRefreshRespawn?.markReady?.(readyChild);
          },
        })
    : null;
  s.bridgeIpcController = bridgeIpcController;
  child.on('exit', (code, signal) => {
    log(`${svc.name} exited (code ${code}, signal ${signal || 'none'})`);
    const wasCurrent = s.child === child;
    if (wasCurrent) {
      s.child = null;
      s.bridgeIpcController = null;
    }
    const committedSafeRefresh = bridgeIpcController?.consumeCommittedExit(code, signal, wasCurrent) || null;
    bridgeIpcController?.dispose();
    if (committedSafeRefresh) {
      log(`${svc.name} completed an idle-safe source refresh; reserving one owned replacement`);
      const scheduled = schedulePlannedSafeRefreshRespawn(svc, s, {
        expectedManifestSha256: committedSafeRefresh.manifestSha256,
        immutableSnapshot: committedSafeRefresh.immutableSnapshot,
      });
      if (!scheduled) cleanupImmutableBridgeSnapshot(committedSafeRefresh.immutableSnapshot);
    }
  });
  child.on('error', (err) => {
    log(`${svc.name} spawn error: ${err.message}`);
    const retainedSafeRefreshEntitlement = Boolean(
      s.plannedSafeRefreshRespawn?.ownsCandidate?.(child),
    );
    if (s.child === child && (!childSpawned || !retainedSafeRefreshEntitlement)) {
      s.child = null;
      s.bridgeIpcController = null;
    }
    bridgeIpcController?.dispose();
  });
  return child;
}

async function sweep() {
  for (const svc of SERVICES) {
    try {
      if (await portListening(svc.port)) continue;
      if (canStart(svc)) startService(svc, { bypassRateLimit: true });
    } catch (err) {
      log(`${svc.name} sweep error: ${err.message}`);
    }
  }
}

// Single-instance guard: hold a loopback lock port. A second copy exits 0,
// which the LaunchAgent's KeepAlive/SuccessfulExit=false policy treats as
// "done, do not restart".
function startKeepalive() {
  const lock = net.createServer();
  lock.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      log('another keepalive instance holds the lock — exiting');
      process.exit(0);
    }
    throw err;
  });
  lock.listen(LOCK_PORT, '127.0.0.1', () => {
    log(`dev-stack keepalive up (lock :${LOCK_PORT}; expo ${EXPO_ENABLED ? 'managed' : 'manual'})`);
    const scavenged = scavengeStaleImmutableBridgeSnapshots();
    if (scavenged.removed > 0) {
      log(`removed ${scavenged.removed} stale immutable bridge snapshot(s)`);
    }
    sweep();
    setInterval(sweep, SWEEP_MS);
  });

  process.on('SIGTERM', () => {
    log('SIGTERM — leaving services running (they are independent processes)');
    for (const serviceState of state.values()) {
      serviceState.plannedSafeRefreshRespawn?.cancel?.();
      serviceState.bridgeIpcController?.dispose?.();
    }
    process.exit(0);
  });
  return lock;
}

if (require.main === module) startKeepalive();

module.exports = {
  BRIDGE_SAFE_REFRESH_IPC_PROTOCOL,
  MAX_STARTS,
  SAFE_REFRESH_EXIT_CODE,
  SAFE_REFRESH_REPLACEMENT_MAX_SPAWN_ATTEMPTS,
  SAFE_REFRESH_REPLACEMENT_RETRY_WINDOW_MS,
  attachBridgeSafeRefreshIpcController,
  bridgeSafeRefreshIpcMac,
  canStart,
  createBoundedSafeRefreshReplacementController,
  inspectServiceStartupManifestSha256,
  createImmutableBridgeSnapshot,
  cleanupImmutableBridgeSnapshot,
  immutableBridgeSnapshotSpawnSpec,
  readAndVerifyImmutableBridgeSnapshot,
  scavengeStaleImmutableBridgeSnapshots,
  schedulePlannedSafeRefreshRespawn,
  startKeepalive,
  startService,
};
