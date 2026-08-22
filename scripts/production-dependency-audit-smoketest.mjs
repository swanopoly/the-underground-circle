#!/usr/bin/env node

import assert from 'node:assert/strict';
import {
  EXPECTED_IMAGE_SIZE_AUDIT_CLOSURE,
  IMAGE_SIZE_ADVISORY_SOURCES,
  IMAGE_SIZE_ADVISORY_URLS,
  classifyProductionDependencyAudit,
  productionAuditLockSubgraphFingerprint,
  productionAuditSubgraphFingerprint,
} from './production-dependency-audit.mjs';

function fixture() {
  const vulnerabilities = {};
  vulnerabilities['image-size'] = {
    severity: 'high',
    via: IMAGE_SIZE_ADVISORY_SOURCES.map((source, index) => ({
      source,
      severity: 'high',
      url: IMAGE_SIZE_ADVISORY_URLS[index === 0 ? 1 : 0],
    })),
  };
  vulnerabilities.metro = { severity: 'high', via: ['image-size'] };
  vulnerabilities['metro-config'] = { severity: 'high', via: ['metro'] };
  vulnerabilities['metro-transform-worker'] = { severity: 'high', via: ['metro'] };
  vulnerabilities['@expo/metro'] = {
    severity: 'high',
    via: ['metro', 'metro-config', 'metro-transform-worker'],
  };
  vulnerabilities['@expo/metro-config'] = { severity: 'high', via: ['@expo/metro'] };
  vulnerabilities['@expo/cli'] = { severity: 'high', via: ['@expo/metro', '@expo/metro-config'] };
  vulnerabilities.expo = { severity: 'high', via: ['@expo/cli', '@expo/metro', '@expo/metro-config'] };

  const result = {
    auditReport: {
      vulnerabilities,
      metadata: { vulnerabilities: { high: EXPECTED_IMAGE_SIZE_AUDIT_CLOSURE.length, critical: 0 } },
    },
    packageJson: { dependencies: { expo: '~54.0.37' } },
    packageLock: {
      packages: {
        'node_modules/image-size': { version: '1.2.1' },
        'node_modules/metro': { dependencies: { 'image-size': '^1.0.2' } },
        'node_modules/expo': { version: '54.0.37' },
      },
    },
    auditStatus: 1,
    auditSignal: null,
    registryStatus: 0,
    registrySignal: null,
    latestImageSizeVersion: '2.0.2',
    installedImageSizeVersion: '1.2.1',
    nowMs: Date.parse('2026-08-20T12:00:00.000Z'),
  };
  result.expectedAuditSubgraphSha256 = productionAuditSubgraphFingerprint(result.auditReport);
  result.expectedLockSubgraphSha256 = productionAuditLockSubgraphFingerprint(result.packageLock);
  return result;
}

assert.equal(classifyProductionDependencyAudit({
  auditReport: { vulnerabilities: {}, metadata: { vulnerabilities: { high: 0, critical: 0 } } },
  packageJson: {},
  packageLock: {},
  auditStatus: 0,
  auditSignal: null,
}).status, 'clean');

assert.equal(classifyProductionDependencyAudit(fixture()).status, 'allowed_unpatched_build_tool');

const extra = fixture();
extra.auditReport.vulnerabilities['other-runtime-package'] = { severity: 'high', via: [{ source: 999 }] };
assert.equal(classifyProductionDependencyAudit(extra).status, 'blocked');

const direct = fixture();
direct.packageJson.dependencies['image-size'] = '1.2.1';
assert.equal(classifyProductionDependencyAudit(direct).status, 'blocked');

const changedVersion = fixture();
changedVersion.packageLock.packages['node_modules/image-size'].version = '2.0.2';
assert.equal(classifyProductionDependencyAudit(changedVersion).status, 'blocked');

const changedAdvisory = fixture();
changedAdvisory.auditReport.vulnerabilities['image-size'].via[0].source = 999;
assert.equal(classifyProductionDependencyAudit(changedAdvisory).status, 'blocked');

const critical = fixture();
critical.auditReport.metadata.vulnerabilities.critical = 1;
assert.equal(classifyProductionDependencyAudit(critical).status, 'blocked');

const changedExpo = fixture();
changedExpo.packageLock.packages['node_modules/expo'].version = '999.0.0';
assert.equal(classifyProductionDependencyAudit(changedExpo).status, 'blocked');

const changedGraph = fixture();
changedGraph.auditReport.vulnerabilities.metro.via.push('expo');
assert.equal(classifyProductionDependencyAudit(changedGraph).status, 'blocked');

const secondInstall = fixture();
secondInstall.packageLock.packages['node_modules/metro/node_modules/image-size'] = { version: '0.0.1' };
assert.equal(classifyProductionDependencyAudit(secondInstall).status, 'blocked');

const fixPublished = fixture();
fixPublished.latestImageSizeVersion = '2.0.3';
assert.equal(classifyProductionDependencyAudit(fixPublished).status, 'blocked');

const fixMetadata = fixture();
fixMetadata.auditReport.vulnerabilities['image-size'].fixAvailable = { name: 'image-size', version: '2.0.3' };
assert.equal(classifyProductionDependencyAudit(fixMetadata).status, 'blocked');

const changedCount = fixture();
changedCount.auditReport.metadata.vulnerabilities.high = 999;
assert.equal(classifyProductionDependencyAudit(changedCount).status, 'blocked');

const auditKilled = fixture();
auditKilled.auditSignal = 'SIGTERM';
assert.equal(classifyProductionDependencyAudit(auditKilled).status, 'blocked');

const auditStatusDrift = fixture();
auditStatusDrift.auditStatus = 2;
assert.equal(classifyProductionDependencyAudit(auditStatusDrift).status, 'blocked');

const expired = fixture();
expired.nowMs = Date.parse('2026-09-20T00:00:00.000Z');
assert.equal(classifyProductionDependencyAudit(expired).status, 'blocked');

console.log('production dependency audit smoke passed (16 decisions)');
