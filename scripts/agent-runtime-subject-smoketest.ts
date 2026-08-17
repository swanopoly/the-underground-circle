import assert from 'node:assert/strict';
import {
  buildAgentRuntimeSubject,
  buildAgentRuntimeSubjectPayload,
  isUuidLike,
} from '../src/lib/agentRuntimeSubject';

const defaultOpenSwan = buildAgentRuntimeSubject({
  id: 'default::blackswan',
  name: 'OpenSwan',
  sessionKey: 'blackswan',
  providerType: 'blackswan-local',
});

assert.equal(defaultOpenSwan.subjectKey, 'blackswan');
assert.equal(defaultOpenSwan.memoryAgentId, 'blackswan');
assert.equal(defaultOpenSwan.runAgentId, 'blackswan');
assert.equal(defaultOpenSwan.displayName, 'OpenSwan');
assert.equal(defaultOpenSwan.metadata.agentSubjectKey, 'blackswan');
assert.equal(defaultOpenSwan.metadata.agentDisplayName, 'OpenSwan');
assert.equal(defaultOpenSwan.metadata.agentProvider, 'blackswan-local');
assert.ok(defaultOpenSwan.legacyIds.includes('default::blackswan'));
assert.ok(defaultOpenSwan.legacyIds.includes('openswan:main_chat'));
assert.ok(defaultOpenSwan.memoryAgentAliases.includes('default::blackswan'));
assert.ok(defaultOpenSwan.memoryAgentAliases.includes('openswan:main_chat'));
assert.equal(defaultOpenSwan.runAgentAliases.includes('OpenSwan'), false);

const dbAgentId = '11111111-1111-4111-8111-111111111111';
const dbBackedAgent = buildAgentRuntimeSubject({
  id: 'db::11111111-1111-4111-8111-111111111111',
  name: 'Scout',
  sessionKey: dbAgentId,
  providerType: 'claude',
}, { dbAgentId });

assert.equal(dbBackedAgent.subjectKey, dbAgentId);
assert.equal(dbBackedAgent.memoryAgentId, dbAgentId);
assert.equal(dbBackedAgent.runAgentId, dbAgentId);
assert.equal(dbBackedAgent.metadata.agentDbId, dbAgentId);
assert.equal(dbBackedAgent.metadata.agentSessionKey, dbAgentId);
assert.equal(dbBackedAgent.runAgentAliases.includes('Scout'), false);

const renamedExactAgent = buildAgentRuntimeSubject({
  id: 'local::release-agent',
  name: 'OpenSwan',
  sessionKey: 'release-session',
  providerType: 'openswan',
});
assert.equal(renamedExactAgent.subjectKey, 'release-session');
assert.equal(renamedExactAgent.memoryAgentId, 'release-session');
assert.equal(renamedExactAgent.runAgentId, 'release-session');
assert.equal(renamedExactAgent.runAgentAliases.includes('OpenSwan'), false);
assert.equal(renamedExactAgent.legacyIds.includes('default::blackswan'), false);

const liveSession = buildAgentRuntimeSubject({
  id: 'local::session-alpha',
  name: 'Builder',
  sessionKey: 'session-alpha',
});

assert.equal(liveSession.subjectKey, 'session-alpha');
assert.equal(liveSession.memoryAgentAliases.includes('local::session-alpha'), true);
assert.equal(liveSession.memoryAgentAliases.includes('session-alpha'), true);

assert.equal(isUuidLike(dbAgentId), true);
assert.equal(isUuidLike('default::blackswan'), false);
assert.equal(isUuidLike('openswan:main_chat'), false);

const runtimePayload = buildAgentRuntimeSubjectPayload({
  agentId: 'default::blackswan',
  agentName: 'OpenSwan',
  agentSubjectKey: defaultOpenSwan.subjectKey,
  agentDbId: defaultOpenSwan.dbAgentId,
  agentSessionKey: defaultOpenSwan.sessionKey,
  agentLegacyIds: defaultOpenSwan.legacyIds,
  agentSubjectMetadata: defaultOpenSwan.metadata,
});

assert.equal(runtimePayload.subject?.agentSubjectKey, 'blackswan');
assert.equal(runtimePayload.subject?.agentDisplayName, 'OpenSwan');
assert.deepEqual(runtimePayload.swanContextPatch, {
  agentId: 'blackswan',
  agentName: 'OpenSwan',
  agentSubjectKey: 'blackswan',
  agentDbId: null,
  agentSessionKey: 'blackswan',
  agentLegacyIds: defaultOpenSwan.legacyIds,
  agentSubjectMetadata: runtimePayload.subject,
});
assert.equal(runtimePayload.runMetadata.agentSubjectKey, 'blackswan');
assert.equal(runtimePayload.runMetadata.targetAgentSubjectKey, 'blackswan');
assert.equal(runtimePayload.runMetadata.agentDisplayName, 'OpenSwan');
assert.equal(runtimePayload.runMetadata.targetAgentName, 'OpenSwan');
assert.deepEqual(runtimePayload.runMetadata.agentLegacyIds, defaultOpenSwan.legacyIds);
assert.deepEqual(runtimePayload.runMetadata.targetAgentLegacyIds, defaultOpenSwan.legacyIds);
assert.equal(
  (runtimePayload.runMetadata.agentSubject as Record<string, unknown>).agentSubjectKey,
  'blackswan',
);
assert.equal(
  (runtimePayload.runMetadata.targetAgentSubject as Record<string, unknown>).agentSubjectKey,
  'blackswan',
);

const fallbackPayload = buildAgentRuntimeSubjectPayload({
  agentId: 'local::builder',
  agentName: 'Builder',
  agentSubjectKey: 'session-alpha',
  agentSessionKey: 'session-alpha',
  agentLegacyIds: ['local::builder', 'Builder'],
});

assert.equal(fallbackPayload.subject?.agentSubjectKey, 'session-alpha');
assert.equal(fallbackPayload.subject?.agentDisplayName, 'Builder');
assert.deepEqual(fallbackPayload.swanContextPatch.agentLegacyIds, ['local::builder', 'Builder']);
assert.equal(fallbackPayload.runMetadata.agentId, 'session-alpha');
assert.equal(fallbackPayload.runMetadata.agentName, 'Builder');

console.log('agent-runtime-subject smoketest passed');
