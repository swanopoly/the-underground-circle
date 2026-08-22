#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');
const NPM_COMMAND = process.platform === 'win32' ? 'npm.cmd' : 'npm';

export const IMAGE_SIZE_ADVISORY_SOURCES = Object.freeze([1138808, 1138809]);
export const IMAGE_SIZE_ADVISORY_URLS = Object.freeze([
  'https://github.com/advisories/GHSA-5p2g-fcmc-qvqq',
  'https://github.com/advisories/GHSA-w3rx-r6r6-pgpr',
]);
export const EXPECTED_IMAGE_SIZE_AUDIT_CLOSURE = Object.freeze([
  '@expo/cli',
  '@expo/metro',
  '@expo/metro-config',
  'expo',
  'image-size',
  'metro',
  'metro-config',
  'metro-transform-worker',
]);
export const CONTROLLED_EXCEPTION_EXPIRES_AT_MS = Date.parse('2026-09-20T00:00:00.000Z');
export const EXPECTED_AUDIT_SUBGRAPH_SHA256 = 'ea7f8616d2b4b9c2be0b6927bb201e715ec4aae92f9826e9bab9404f82a094fb';
export const EXPECTED_LOCK_SUBGRAPH_SHA256 = '3c4fc3eb86abafa48308ff79597523a82ee5ae7fa7a1ee985a20cb24bf49eb1d';

const EXPECTED_LOCK_NODE_PATHS = Object.freeze([
  'node_modules/@expo/cli',
  'node_modules/@expo/metro',
  'node_modules/@expo/metro-config',
  'node_modules/expo',
  'node_modules/image-size',
  'node_modules/metro',
  'node_modules/metro-config',
  'node_modules/metro-transform-worker',
]);

function sorted(values) {
  return [...values].sort((left, right) => String(left).localeCompare(String(right)));
}

function sameStrings(left, right) {
  const a = sorted(left);
  const b = sorted(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function isHighOrCritical(vulnerability) {
  return vulnerability?.severity === 'high' || vulnerability?.severity === 'critical';
}

function normalizeForFingerprint(value) {
  if (Array.isArray(value)) {
    return value
      .map(normalizeForFingerprint)
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  }
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => [key, normalizeForFingerprint(value[key])]),
  );
}

function sha256(value) {
  return createHash('sha256').update(JSON.stringify(normalizeForFingerprint(value))).digest('hex');
}

export function productionAuditSubgraphFingerprint(auditReport) {
  const vulnerabilities = auditReport?.vulnerabilities ?? {};
  const blocking = Object.fromEntries(
    Object.entries(vulnerabilities)
      .filter(([, vulnerability]) => isHighOrCritical(vulnerability))
      .map(([name, vulnerability]) => [name, {
        isDirect: vulnerability.isDirect,
        name: vulnerability.name,
        nodes: vulnerability.nodes,
        range: vulnerability.range,
        severity: vulnerability.severity,
        via: vulnerability.via,
        // npm derives `effects` and most `fixAvailable` values by walking a
        // cyclic graph, and can assign them to different ancestors between
        // equivalent runs. The leaf value is stable and relevant: a direct
        // image-size repair must retire this exception.
        ...(name === 'image-size' ? { fixAvailable: vulnerability.fixAvailable } : {}),
      }]),
  );
  return sha256({
    metadata: {
      critical: auditReport?.metadata?.vulnerabilities?.critical ?? null,
      high: auditReport?.metadata?.vulnerabilities?.high ?? null,
    },
    vulnerabilities: blocking,
  });
}

export function productionAuditLockSubgraphFingerprint(packageLock) {
  const packages = packageLock?.packages ?? {};
  return sha256({
    imageSizeInstallPaths: Object.keys(packages)
      .filter((packagePath) => packagePath === 'node_modules/image-size' || packagePath.endsWith('/node_modules/image-size')),
    nodes: Object.fromEntries(EXPECTED_LOCK_NODE_PATHS.map((packagePath) => [packagePath, packages[packagePath] ?? null])),
    rootExpoDeclaration: packages['']?.dependencies?.expo ?? null,
  });
}

function dependencyDeclares(packageJson, packageName) {
  return ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']
    .some((field) => Object.prototype.hasOwnProperty.call(packageJson?.[field] ?? {}, packageName));
}

function terminalAdvisorySources(vulnerabilities, packageName, seen = new Set()) {
  // npm's vulnerability graph contains legitimate dependency cycles (for
  // example metro <-> metro-config). Ignore an already visited edge; the
  // caller still requires the complete terminal advisory set below.
  if (seen.has(packageName)) return { ok: true, sources: new Set() };
  const vulnerability = vulnerabilities[packageName];
  if (!vulnerability) return { ok: false, sources: new Set(), reason: `missing vulnerability node ${packageName}` };

  const nextSeen = new Set(seen);
  nextSeen.add(packageName);
  const sources = new Set();

  for (const cause of vulnerability.via ?? []) {
    if (typeof cause === 'string') {
      const nested = terminalAdvisorySources(vulnerabilities, cause, nextSeen);
      if (!nested.ok) return nested;
      for (const source of nested.sources) sources.add(source);
      continue;
    }
    if (!Number.isSafeInteger(cause?.source)) {
      return { ok: false, sources: new Set(), reason: `unrecognized advisory under ${packageName}` };
    }
    sources.add(cause.source);
  }

  return { ok: true, sources };
}

/**
 * Permit only the two currently unpatched image-size build-tool advisories.
 * Any package/version/graph/advisory drift fails closed and returns to the
 * ordinary high/critical audit gate.
 */
export function classifyProductionDependencyAudit({
  auditReport,
  packageJson,
  packageLock,
  auditStatus,
  auditSignal,
  registryStatus,
  registrySignal,
  latestImageSizeVersion,
  installedImageSizeVersion,
  nowMs,
  expectedAuditSubgraphSha256 = EXPECTED_AUDIT_SUBGRAPH_SHA256,
  expectedLockSubgraphSha256 = EXPECTED_LOCK_SUBGRAPH_SHA256,
}) {
  const vulnerabilities = auditReport?.vulnerabilities ?? {};
  const blockingNames = Object.entries(vulnerabilities)
    .filter(([, vulnerability]) => isHighOrCritical(vulnerability))
    .map(([name]) => name);

  if (blockingNames.length === 0) {
    return auditStatus === 0 && !auditSignal
      ? { status: 'clean' }
      : { status: 'blocked', reason: 'npm audit process did not complete cleanly' };
  }
  if (auditStatus !== 1 || auditSignal) {
    return { status: 'blocked', reason: 'npm audit process status was not the expected advisory result' };
  }
  if (registryStatus !== 0 || registrySignal) {
    return { status: 'blocked', reason: 'image-size registry review did not complete cleanly' };
  }
  if (latestImageSizeVersion !== '2.0.2') {
    return { status: 'blocked', reason: 'image-size registry version changed' };
  }
  if (installedImageSizeVersion !== '1.2.1') {
    return { status: 'blocked', reason: 'installed image-size version changed' };
  }
  if (!Number.isFinite(nowMs) || nowMs >= CONTROLLED_EXCEPTION_EXPIRES_AT_MS) {
    return { status: 'blocked', reason: 'controlled exception review expired' };
  }
  if (!sameStrings(blockingNames, EXPECTED_IMAGE_SIZE_AUDIT_CLOSURE)) {
    return { status: 'blocked', reason: 'high/critical dependency set changed' };
  }
  if ((auditReport?.metadata?.vulnerabilities?.critical ?? 0) !== 0) {
    return { status: 'blocked', reason: 'critical dependency advisory present' };
  }
  if ((auditReport?.metadata?.vulnerabilities?.high ?? 0) !== EXPECTED_IMAGE_SIZE_AUDIT_CLOSURE.length) {
    return { status: 'blocked', reason: 'high dependency advisory count changed' };
  }
  if (dependencyDeclares(packageJson, 'image-size')) {
    return { status: 'blocked', reason: 'image-size became a declared application dependency' };
  }

  const lockedImageSize = packageLock?.packages?.['node_modules/image-size'];
  const lockedMetro = packageLock?.packages?.['node_modules/metro'];
  if (lockedImageSize?.version !== '1.2.1') {
    return { status: 'blocked', reason: 'image-size lock version changed' };
  }
  if (lockedMetro?.dependencies?.['image-size'] !== '^1.0.2') {
    return { status: 'blocked', reason: 'Metro image-size dependency contract changed' };
  }
  if (productionAuditSubgraphFingerprint(auditReport) !== expectedAuditSubgraphSha256) {
    return { status: 'blocked', reason: 'normalized npm audit subgraph changed' };
  }
  if (productionAuditLockSubgraphFingerprint(packageLock) !== expectedLockSubgraphSha256) {
    return { status: 'blocked', reason: 'normalized package-lock subgraph changed' };
  }

  for (const name of blockingNames) {
    const terminal = terminalAdvisorySources(vulnerabilities, name);
    if (!terminal.ok || !sameStrings(terminal.sources, IMAGE_SIZE_ADVISORY_SOURCES)) {
      return { status: 'blocked', reason: terminal.reason ?? `unexpected advisory path under ${name}` };
    }
  }

  const imageSizeVia = vulnerabilities['image-size']?.via ?? [];
  const advisoryUrls = imageSizeVia
    .filter((cause) => typeof cause !== 'string')
    .map((cause) => cause?.url)
    .filter((url) => typeof url === 'string');
  if (!sameStrings(advisoryUrls, IMAGE_SIZE_ADVISORY_URLS)) {
    return { status: 'blocked', reason: 'image-size advisory identity changed' };
  }

  return {
    status: 'allowed_unpatched_build_tool',
    advisoryUrls: [...IMAGE_SIZE_ADVISORY_URLS],
  };
}

function readJson(fileName) {
  return JSON.parse(readFileSync(path.join(REPOSITORY_ROOT, fileName), 'utf8'));
}

function runCli() {
  const result = spawnSync(NPM_COMMAND, ['audit', '--omit=dev', '--audit-level=high', '--json'], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;

  let auditReport;
  try {
    auditReport = JSON.parse(result.stdout);
  } catch {
    console.error('[production-dependency-audit] BLOCKED: npm audit did not return valid JSON.');
    if (result.stderr) console.error(result.stderr.trim());
    process.exitCode = 1;
    return;
  }

  const hasBlockingAudit = Object.values(auditReport?.vulnerabilities ?? {}).some(isHighOrCritical);
  const registryResult = hasBlockingAudit
    ? spawnSync(NPM_COMMAND, ['view', 'image-size', 'version', '--json'], {
      cwd: REPOSITORY_ROOT,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    })
    : { status: 0, signal: null, stdout: '"2.0.2"' };
  let latestImageSizeVersion = null;
  try {
    latestImageSizeVersion = JSON.parse(registryResult.stdout);
  } catch {
    latestImageSizeVersion = null;
  }

  let installedImageSizeVersion = null;
  try {
    installedImageSizeVersion = readJson('node_modules/image-size/package.json').version;
  } catch {
    installedImageSizeVersion = null;
  }

  const decision = classifyProductionDependencyAudit({
    auditReport,
    packageJson: readJson('package.json'),
    packageLock: readJson('package-lock.json'),
    auditStatus: result.status,
    auditSignal: result.signal,
    registryStatus: registryResult.status,
    registrySignal: registryResult.signal,
    latestImageSizeVersion,
    installedImageSizeVersion,
    nowMs: Date.now(),
  });

  if (decision.status === 'clean') {
    if (result.status !== 0) {
      console.error('[production-dependency-audit] BLOCKED: npm audit exit status disagreed with its report.');
      process.exitCode = 1;
      return;
    }
    console.log('[production-dependency-audit] PASS: no high or critical production advisories.');
    return;
  }

  if (decision.status === 'allowed_unpatched_build_tool') {
    console.warn(
      '[production-dependency-audit] CONTROLLED EXCEPTION: only the two unpatched image-size build-tool advisories remain; exact package, lock, advisory, and dependency-closure checks passed.',
    );
    for (const url of decision.advisoryUrls) console.warn(`[production-dependency-audit] ${url}`);
    return;
  }

  console.error(`[production-dependency-audit] BLOCKED: ${decision.reason}.`);
  process.exitCode = result.status || 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) runCli();
