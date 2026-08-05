import assert from 'node:assert/strict';
import { getRunSubjectSummary, runMatchesAgent } from '../src/lib/agentRunSubjectSummary';

const dbId = '11111111-1111-4111-8111-111111111111';

const directSummary = getRunSubjectSummary({
  agent_id: dbId,
  metadata: {
    agentSubjectKey: dbId,
    agentDisplayName: 'Scout',
    agentDbId: dbId,
    legacyAgentIds: ['scout', 'Scout', dbId, 'default::scout'],
    runAgentAliases: ['Scout', 'office::scout'],
    agentSubject: {
      agentSubjectKey: dbId,
      legacyAgentIds: ['scout', 'session::scout'],
    },
  },
}, 'Fallback');

assert.equal(directSummary.subjectKey, dbId);
assert.equal(directSummary.displayName, 'Scout');
assert.equal(directSummary.dbId, dbId);
assert.deepEqual(directSummary.aliases, [
  'scout',
  'default::scout',
  'office::scout',
  'session::scout',
]);

const targetSummary = getRunSubjectSummary({
  metadata: {
    targetAgentSubjectKey: 'blackswan',
    targetAgentName: 'OpenSwan',
    targetAgentDbId: null,
    targetAgentLegacyIds: ['default::blackswan', 'openswan:main_chat'],
    targetAgentSubject: {
      agentSubjectKey: 'blackswan',
      legacyAgentIds: ['openswan:main_chat', 'BlackSwan'],
    },
  },
}, 'Fallback');

assert.equal(targetSummary.subjectKey, 'blackswan');
assert.equal(targetSummary.displayName, 'OpenSwan');
assert.equal(targetSummary.dbId, null);
assert.deepEqual(targetSummary.aliases, ['default::blackswan', 'openswan:main_chat']);

const fallbackSummary = getRunSubjectSummary({ agent_id: 'local::builder', metadata: {} }, 'Builder');
assert.equal(fallbackSummary.subjectKey, 'local::builder');
assert.equal(fallbackSummary.displayName, 'Builder');

assert.equal(runMatchesAgent({
  metadata: {
    targetAgentSubject: {
      agentSubjectKey: 'blackswan',
      legacyAgentIds: ['openswan:main_chat'],
    },
  },
}, ['openswan:main_chat'], 'OpenSwan'), true);

assert.equal(runMatchesAgent({
  title: 'Scout investigated the failing deploy',
  metadata: {},
}, [], 'Scout'), true);

assert.equal(runMatchesAgent({
  surface: 'main_chat',
  metadata: {},
}, ['openswan:main_chat'], 'OpenSwan'), true);

assert.equal(runMatchesAgent({
  agent_id: 'other-agent',
  title: 'Unrelated run',
  metadata: {
    legacyAgentIds: ['other-alias'],
  },
}, ['scout'], 'Scout'), false);

console.log('agent-run-subject-summary smoketest passed');
