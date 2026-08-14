/**
 * Pure adversarial smoke coverage for the canonical Office agent -> OpenSwan
 * session binding resolver. No provider, storage, or database is contacted.
 *
 * Run: npx tsx scripts/office-agent-session-binding-core-smoketest.ts
 */

import assert from 'node:assert/strict';
import {
  buildOpenSwanConnectionFingerprint,
  OFFICE_AGENT_SESSION_BINDING_LIMITS,
  resolveOfficeAgentSessionBinding,
  type OfficeAgentSessionBindingFailureReason,
  type OfficeAgentSessionBindingResolution,
} from '../src/lib/officeAgentSessionBindingCore';

const BINDING_ID = '11111111-1111-4111-8111-111111111111';
const OFFICE_AGENT_ID = '2a222222-2222-4222-8222-222222222222';
const OTHER_OFFICE_AGENT_ID = '4b444444-4444-4444-8444-444444444444';
const AGENT_BOT_ID = '3c333333-3333-4333-8333-333333333333';
const OTHER_AGENT_BOT_ID = '5d555555-5555-4555-8555-555555555555';
const CONNECTION_ID = 'conn_primary';
const OTHER_CONNECTION_ID = 'conn_secondary';
const SESSION_KEY = 'agent:main:Alpha';

const binding = {
  id: BINDING_ID,
  officeAgentId: OFFICE_AGENT_ID,
  agentBotId: AGENT_BOT_ID,
  sessionKey: SESSION_KEY,
};

const connection = {
  id: CONNECTION_ID,
  remoteId: AGENT_BOT_ID,
  provider: 'openswan',
  status: 'connected',
  enabled: true,
  endpoint: 'http://localhost:18789',
  token: 'gateway-secret-value',
};

const sessionsByConnection = {
  [CONNECTION_ID]: [
    { sessionKey: 'agent:main:Other' },
    { sessionKey: SESSION_KEY },
  ],
};
const connectionFingerprint = buildOpenSwanConnectionFingerprint(connection);
if (!connectionFingerprint) throw new Error('test connection fingerprint must be valid');

const baseInput = {
  officeAgentId: OFFICE_AGENT_ID,
  binding,
  connections: [connection],
  sessionsByConnection,
  sessionFingerprintsByConnection: {
    [CONNECTION_ID]: connectionFingerprint,
  },
};

function expectReason(
  result: OfficeAgentSessionBindingResolution,
  reason: OfficeAgentSessionBindingFailureReason,
  label: string,
): void {
  assert.equal(result.ok, false, `${label}: resolution fails`);
  if (result.ok) return;
  assert.equal(result.reason, reason, `${label}: failure reason`);
  assert.ok(Object.isFrozen(result), `${label}: failure result is immutable`);
}

function resolveWith(overrides: Record<string, unknown> = {}): OfficeAgentSessionBindingResolution {
  return resolveOfficeAgentSessionBinding({ ...baseInput, ...overrides });
}

function main(): void {
  const inputSnapshot = JSON.stringify(baseInput);
  const success = resolveOfficeAgentSessionBinding(baseInput);
  assert.equal(success.ok, true, 'an exact live owner-private binding resolves');
  if (!success.ok) throw new Error(`expected success, got ${success.reason}`);
  assert.deepEqual(success.target, {
    bindingId: BINDING_ID,
    officeAgentId: OFFICE_AGENT_ID,
    agentBotId: AGENT_BOT_ID,
    connectionId: CONNECTION_ID,
    provider: 'openswan',
    sessionKey: SESSION_KEY,
    compositeAgentId: `${CONNECTION_ID}::${SESSION_KEY}`,
    config: {
      endpoint: connection.endpoint,
      token: connection.token,
    },
  }, 'resolved target preserves each identity without conflation');
  assert.ok(Object.isFrozen(success), 'success result is immutable');
  assert.ok(Object.isFrozen(success.target), 'resolved target is immutable');
  assert.ok(Object.isFrozen(success.target.config), 'resolved gateway config is immutable');
  assert.equal(JSON.stringify(baseInput), inputSnapshot, 'resolution does not mutate its inputs');

  const cyclicBinding: Record<string, unknown> = { ...binding };
  cyclicBinding.untrustedCycle = cyclicBinding;
  assert.equal(
    resolveWith({ binding: cyclicBinding }).ok,
    true,
    'irrelevant cyclic fields are ignored without cloning or traversal',
  );

  expectReason(resolveOfficeAgentSessionBinding(), 'invalid_input', 'missing input');
  expectReason(resolveOfficeAgentSessionBinding(null), 'invalid_input', 'null input');
  expectReason(resolveOfficeAgentSessionBinding('binding'), 'invalid_input', 'primitive input');

  const throwingInput = new Proxy({}, {
    get() { throw new Error('hostile resolver input'); },
  });
  expectReason(resolveOfficeAgentSessionBinding(throwingInput), 'invalid_input', 'throwing input getter');

  const revocable = Proxy.revocable({}, {});
  revocable.revoke();
  expectReason(resolveOfficeAgentSessionBinding(revocable.proxy), 'invalid_input', 'revoked input proxy');

  expectReason(resolveWith({ officeAgentId: ` ${OFFICE_AGENT_ID}` }), 'invalid_office_agent_id', 'whitespace office UUID');
  expectReason(resolveWith({ officeAgentId: 'office-agent-name' }), 'invalid_office_agent_id', 'non-UUID office identity');
  expectReason(resolveWith({ binding: null }), 'invalid_binding_id', 'missing binding');
  expectReason(resolveWith({ binding: { ...binding, id: 'binding-name' } }), 'invalid_binding_id', 'non-UUID binding id');
  expectReason(
    resolveWith({ binding: { ...binding, officeAgentId: 'agent-name' } }),
    'invalid_binding_office_agent_id',
    'non-UUID bound Office identity',
  );
  expectReason(
    resolveWith({ binding: { ...binding, agentBotId: 'openswan-by-name' } }),
    'invalid_binding_agent_bot_id',
    'non-UUID remote bot identity',
  );
  expectReason(
    resolveWith({ binding: { ...binding, officeAgentId: OTHER_OFFICE_AGENT_ID } }),
    'binding_office_agent_mismatch',
    'binding belongs to another exact Office row',
  );
  expectReason(
    resolveWith({
      officeAgentId: OFFICE_AGENT_ID.toUpperCase(),
      binding: { ...binding, officeAgentId: OFFICE_AGENT_ID },
    }),
    'binding_office_agent_mismatch',
    'UUID comparison is exact rather than case-normalized',
  );

  expectReason(
    resolveWith({ binding: { ...binding, sessionKey: ` ${SESSION_KEY}` } }),
    'invalid_binding_session_key',
    'session identity is not trimmed',
  );
  expectReason(
    resolveWith({ binding: { ...binding, sessionKey: '../private-session' } }),
    'invalid_binding_session_key',
    'unsafe session identity',
  );
  expectReason(
    resolveWith({
      binding: {
        ...binding,
        sessionKey: 's'.repeat(OFFICE_AGENT_SESSION_BINDING_LIMITS.sessionKey + 1),
      },
    }),
    'invalid_binding_session_key',
    'oversized session identity',
  );
  const maxSessionKey = `s${'x'.repeat(OFFICE_AGENT_SESSION_BINDING_LIMITS.sessionKey - 1)}`;
  assert.equal(resolveWith({
    binding: { ...binding, sessionKey: maxSessionKey },
    sessionsByConnection: { [CONNECTION_ID]: [{ sessionKey: maxSessionKey }] },
  }).ok, true, 'a safe session identity at the exact bound is accepted');

  const throwingBinding = new Proxy({ id: BINDING_ID }, {
    get() { throw new Error('hostile binding getter'); },
  });
  expectReason(resolveWith({ binding: throwingBinding }), 'invalid_binding_id', 'throwing binding getter');
  expectReason(
    resolveWith({ binding: Object.create(binding) }),
    'invalid_binding_id',
    'inherited fields cannot become a canonical binding row',
  );

  expectReason(resolveWith({ connections: null }), 'invalid_connections', 'missing connection inventory');
  expectReason(resolveWith({ connections: [null] }), 'invalid_connections', 'malformed connection entry');
  expectReason(
    resolveWith({ connections: new Array(OFFICE_AGENT_SESSION_BINDING_LIMITS.connections + 1) }),
    'invalid_connections',
    'oversized connection inventory',
  );

  const hostileConnection = new Proxy({ remoteId: AGENT_BOT_ID }, {
    get(_target, property) {
      if (property === 'remoteId') throw new Error('hostile remote id');
      return undefined;
    },
  });
  expectReason(resolveWith({ connections: [hostileConnection] }), 'invalid_connections', 'throwing remote-id getter');
  expectReason(
    resolveWith({ connections: [Object.create(connection)] }),
    'connection_not_found',
    'inherited remote identity cannot become an exact local connection',
  );

  expectReason(
    resolveWith({
      connections: [{
        ...connection,
        remoteId: OTHER_AGENT_BOT_ID,
        name: 'matching display name',
        agentId: AGENT_BOT_ID,
        sessionKey: SESSION_KEY,
      }],
    }),
    'connection_not_found',
    'names and noncanonical identity fields cannot replace remoteId',
  );
  expectReason(
    resolveWith({ binding: { ...binding, agentBotId: OTHER_AGENT_BOT_ID } }),
    'connection_not_found',
    'stale remote bot binding fails closed',
  );
  expectReason(
    resolveWith({ connections: [connection, { ...connection, id: OTHER_CONNECTION_ID }] }),
    'connection_ambiguous',
    'duplicate exact remote connection binding',
  );

  expectReason(resolveWith({ connections: [{ ...connection, id: 'bad::connection' }] }), 'invalid_connection_id', 'ambiguous local connection id');
  expectReason(resolveWith({ connections: [{ ...connection, provider: 'OpenSwan' }] }), 'connection_provider_mismatch', 'provider comparison is exact');
  expectReason(resolveWith({ connections: [{ ...connection, provider: 'claude-code' }] }), 'connection_provider_mismatch', 'wrong provider');
  expectReason(resolveWith({ connections: [{ ...connection, enabled: false }] }), 'connection_disabled', 'disabled connection');
  for (const status of ['connecting', 'disconnected', 'error', 'stale']) {
    expectReason(
      resolveWith({ connections: [{ ...connection, status }] }),
      'connection_not_connected',
      `${status} connection`,
    );
  }
  expectReason(resolveWith({ connections: [{ ...connection, endpoint: '' }] }), 'connection_endpoint_invalid', 'missing endpoint');
  expectReason(resolveWith({ connections: [{ ...connection, endpoint: 'localhost:18789' }] }), 'connection_endpoint_invalid', 'non-HTTP endpoint');
  expectReason(resolveWith({ connections: [{ ...connection, endpoint: 'http://user:pass@localhost:18789' }] }), 'connection_endpoint_invalid', 'endpoint credentials');

  for (const token of ['', '   ', '***', '__local_secret__', '[REDACTED]', 'your-token-here']) {
    expectReason(
      resolveWith({ connections: [{ ...connection, token }] }),
      'connection_token_missing',
      `missing or placeholder token ${JSON.stringify(token)}`,
    );
  }

  expectReason(resolveWith({ sessionsByConnection: null }), 'invalid_sessions_by_connection', 'missing session inventory');
  expectReason(resolveWith({ sessionsByConnection: new Map([[CONNECTION_ID, [{ sessionKey: SESSION_KEY }]]]) }), 'session_list_not_found', 'Map cannot become a record-key fallback');
  expectReason(resolveWith({ sessionsByConnection: {} }), 'session_list_not_found', 'selected connection has no current session list');

  const inheritedSessions = Object.create({
    [CONNECTION_ID]: [{ sessionKey: SESSION_KEY }],
  });
  expectReason(
    resolveWith({ sessionsByConnection: inheritedSessions }),
    'session_list_not_found',
    'inherited session lists cannot satisfy an exact local connection key',
  );

  const throwingSessions = new Proxy({}, {
    getOwnPropertyDescriptor() { throw new Error('hostile session inventory'); },
  });
  expectReason(
    resolveWith({ sessionsByConnection: throwingSessions }),
    'invalid_sessions_by_connection',
    'throwing session inventory',
  );

  expectReason(
    resolveWith({ sessionsByConnection: { [CONNECTION_ID]: 'session prose' } }),
    'session_list_invalid',
    'prose cannot become a session list',
  );
  expectReason(
    resolveWith({
      sessionsByConnection: {
        [CONNECTION_ID]: new Array(OFFICE_AGENT_SESSION_BINDING_LIMITS.sessionsPerConnection + 1),
      },
    }),
    'session_list_invalid',
    'oversized selected session list',
  );
  expectReason(
    resolveWith({ sessionsByConnection: { [CONNECTION_ID]: [{ sessionKey: SESSION_KEY.toLowerCase() }] } }),
    'session_not_found',
    'case-mismatched session cannot satisfy the binding',
  );
  expectReason(
    resolveWith({ sessionsByConnection: { [CONNECTION_ID]: [{ sessionKey: 'agent:main:Other' }] } }),
    'session_not_found',
    'stale session binding fails closed',
  );
  expectReason(
    resolveWith({
      sessionsByConnection: {
        [CONNECTION_ID]: [{ sessionKey: SESSION_KEY }, { sessionKey: SESSION_KEY }],
      },
    }),
    'session_ambiguous',
    'duplicate exact session on the selected connection',
  );

  const hostileSession = new Proxy({ sessionKey: SESSION_KEY }, {
    get() { throw new Error('hostile session getter'); },
  });
  expectReason(
    resolveWith({ sessionsByConnection: { [CONNECTION_ID]: [hostileSession] } }),
    'session_list_invalid',
    'throwing session entry',
  );
  expectReason(
    resolveWith({
      sessionsByConnection: {
        [CONNECTION_ID]: [Object.create({ sessionKey: SESSION_KEY })],
      },
    }),
    'session_list_invalid',
    'inherited session identity cannot satisfy the binding',
  );

  const crossConnectionDuplicate = resolveWith({
    connections: [
      connection,
      {
        ...connection,
        id: OTHER_CONNECTION_ID,
        remoteId: OTHER_AGENT_BOT_ID,
      },
    ],
    sessionsByConnection: {
      [CONNECTION_ID]: [{ sessionKey: SESSION_KEY }],
      [OTHER_CONNECTION_ID]: [
        { sessionKey: SESSION_KEY },
        { sessionKey: SESSION_KEY },
      ],
    },
  });
  assert.equal(
    crossConnectionDuplicate.ok,
    true,
    'duplicate keys on another connection do not pollute exact selected-connection resolution',
  );

  expectReason(
    resolveWith({
      connections: [
        connection,
        { ...connection, id: OTHER_CONNECTION_ID, remoteId: OTHER_AGENT_BOT_ID },
      ],
      sessionsByConnection: {
        [CONNECTION_ID]: [{ sessionKey: 'agent:main:Other' }],
        [OTHER_CONNECTION_ID]: [{ sessionKey: SESSION_KEY }],
      },
    }),
    'session_not_found',
    'a session on another connection cannot be used as fallback',
  );

  console.log('office-agent-session-binding-core smoke: all assertions passed');
}

main();
