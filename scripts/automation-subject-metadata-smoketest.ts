/**
 * automation-subject-metadata-smoketest - pins display-only automation subject
 * metadata extraction across saved automation config and run input contexts.
 *
 * Run: npm run smoke:automation-subject-metadata
 */

import {
  getAgentSubjectSummary,
  type AutomationAgentSubjectSummary,
} from '../src/lib/automationSubjectMetadata';

let failures = 0;

function pass(message: string) {
  console.log('pass:', message);
}

function fail(message: string, detail?: unknown) {
  failures += 1;
  console.error('FAIL:', message);
  if (detail !== undefined) console.error('  detail:', JSON.stringify(detail));
}

function expectSummary(
  source: unknown,
  expected: Partial<AutomationAgentSubjectSummary>,
  message: string,
) {
  const summary = getAgentSubjectSummary(source);
  if (!summary) {
    fail(`${message} - summary missing`, source);
    return;
  }

  for (const [key, value] of Object.entries(expected)) {
    const actual = summary[key as keyof AutomationAgentSubjectSummary];
    const matches = Array.isArray(value)
      ? JSON.stringify(actual) === JSON.stringify(value)
      : actual === value;
    if (!matches) {
      fail(`${message} - ${key} mismatch`, { expected: value, actual, summary });
      return;
    }
  }

  pass(message);
}

expectSummary(
  {
    agentSubjectMetadata: {
      agentSubjectKey: 'default::blackswan',
      agentDisplayName: 'OpenSwan',
      agentDbId: 'agent-db-1',
      agentSessionKey: 'openswan:main_chat',
      agentProvider: 'anthropic',
      agentSpiritId: 'black-swan',
    },
  },
  {
    label: 'OpenSwan',
    subjectKey: 'default::blackswan',
    dbId: 'agent-db-1',
    sessionKey: 'openswan:main_chat',
    provider: 'anthropic',
    spiritId: 'black-swan',
  },
  'eventConfig.agentSubjectMetadata object',
);

expectSummary(
  { agentSubject: 'default::blackswan' },
  { label: 'default::blackswan', subjectKey: 'default::blackswan' },
  'eventConfig.agentSubject string',
);

expectSummary(
  {
    targetAgentSubject: {
      targetAgentSubjectKey: 'target::agent',
      targetAgentName: 'Target Agent',
      targetAgentDbId: 'agent-db-target',
    },
  },
  {
    label: 'Target Agent',
    subjectKey: 'target::agent',
    dbId: 'agent-db-target',
  },
  'eventConfig.targetAgentSubject object',
);

expectSummary(
  {
    agent_subject_metadata: {
      agent_subject_key: 'office::researcher',
      agent_display_name: 'Researcher',
      agent_db_id: 'agent-db-2',
      agent_session_key: 'office:researcher',
      agent_provider: 'openrouter',
      agent_spirit_id: 'research',
    },
  },
  {
    label: 'Researcher',
    subjectKey: 'office::researcher',
    dbId: 'agent-db-2',
    sessionKey: 'office:researcher',
    provider: 'openrouter',
    spiritId: 'research',
  },
  'eventConfig.agent_subject_metadata object',
);

expectSummary(
  {
    agentSubjectKey: 'run::builder',
    agentDisplayName: 'Run Builder',
    agentDbId: 'agent-db-3',
    agentSessionKey: 'session:builder',
    agentProvider: 'local',
  },
  {
    label: 'Run Builder',
    subjectKey: 'run::builder',
    dbId: 'agent-db-3',
    sessionKey: 'session:builder',
    provider: 'local',
  },
  'run inputContext top-level subject fields',
);

expectSummary(
  {
    agentSubjectMetadata: JSON.stringify({
      targetAgentSubjectKey: 'json::agent',
      targetAgentName: 'JSON Agent',
      targetAgentDbId: 'agent-db-4',
    }),
  },
  {
    label: 'JSON Agent',
    subjectKey: 'json::agent',
    dbId: 'agent-db-4',
  },
  'JSON-string subject payload',
);

expectSummary(
  JSON.stringify({
    subject_key: 'raw-json::agent',
    display_name: 'Raw JSON Agent',
    db_agent_id: 'agent-db-5',
  }),
  {
    label: 'Raw JSON Agent',
    subjectKey: 'raw-json::agent',
    dbId: 'agent-db-5',
  },
  'direct JSON-string subject payload',
);

expectSummary(
  {
    agentSubjectMetadata: {
      agentSubjectKey: 'default::blackswan',
      agentDisplayName: 'OpenSwan',
      agentDbId: 'agent-db-1',
      agentSessionKey: 'openswan:main_chat',
      legacyAgentIds: [
        'default::blackswan',
        'DEFAULT::BLACKSWAN',
        'openswan:main_chat',
        'openswan:legacy',
        'OpenSwan',
      ],
      runAgentAliases: ['openswan:legacy', 'openswan:main_chat', 'memory::blackswan'],
      memoryAgentAliases: ['memory::blackswan', 'memory::BLACKSWAN'],
    },
  },
  {
    label: 'OpenSwan',
    aliases: ['openswan:legacy', 'memory::blackswan'],
  },
  'alias dedupe and label/key/session filtering',
);

if (getAgentSubjectSummary({ event: 'message.created' }) !== null) {
  fail('non-subject config should not produce summary');
} else {
  pass('non-subject config ignored');
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}

console.log('\nautomation-subject-metadata smoke OK');
