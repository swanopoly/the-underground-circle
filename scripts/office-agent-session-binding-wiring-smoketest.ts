/**
 * Red-first source/contract smoke for exact Office -> OpenSwan session binding.
 *
 * This smoke deliberately does not contact Supabase or an OpenSwan bridge. It
 * pins the one durable/local seam needed before Office or Feed may call a live
 * session:
 *
 *   durable Office agent UUID
 *     -> authoritative binding row (agent bot UUID + session key)
 *     -> exact current local connection by `remoteId`
 *     -> exact current session on that connection
 *     -> one `connectionId::sessionKey` provider send
 *
 * Run directly while the implementation is in flight:
 *   npx tsx scripts/office-agent-session-binding-wiring-smoketest.ts
 *
 * Package registration belongs to the integrating agent after this turns
 * green. Until then, failures are expected and intentionally descriptive.
 */

import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const root = process.cwd();
let passed = 0;
const failures: string[] = [];

function check(condition: unknown, label: string): condition is true {
  if (condition) {
    passed += 1;
    return true;
  }
  failures.push(label);
  return false;
}

function readSource(relativePath: string, label: string): string {
  const absolutePath = resolve(root, relativePath);
  if (!check(existsSync(absolutePath), `${label}: missing ${relativePath}`)) return '';
  return readFileSync(absolutePath, 'utf8');
}

function expectMatch(source: string, pattern: RegExp, label: string): void {
  check(pattern.test(source), label);
}

function expectNoMatch(source: string, pattern: RegExp, label: string): void {
  check(!pattern.test(source), label);
}

function count(source: string, pattern: RegExp): number {
  return (source.match(pattern) || []).length;
}

function sourceSection(
  source: string,
  startMarker: string,
  endMarkers: string[],
  label: string,
): string {
  const start = source.indexOf(startMarker);
  if (!check(start >= 0, `${label}: missing start marker ${JSON.stringify(startMarker)}`)) return '';
  const end = endMarkers
    .map((marker) => source.indexOf(marker, start + startMarker.length))
    .filter((index) => index > start)
    .sort((a, b) => a - b)[0];
  if (!check(typeof end === 'number', `${label}: missing following section marker`)) return '';
  return source.slice(start, end);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function main(): Promise<void> {
  const bindingSource = readSource(
    'src/lib/officeAgentSessionBinding.ts',
    'canonical binding persistence owner',
  );
  const bindingCoreSource = readSource(
    'src/lib/officeAgentSessionBindingCore.ts',
    'pure binding resolver',
  );
  const gatewaySource = readSource(
    'src/screens/circles/tabs/office/AgentGatewayPanels.tsx',
    'Office agent gateway UI',
  );
  const agentPanelSource = readSource(
    'src/screens/circles/tabs/office/AgentPanel.tsx',
    'Office agent detail panel',
  );
  const invocationSource = readSource(
    'src/lib/agentInvocation.ts',
    'Office/Feed connected-agent invocation',
  );
  const officeSource = readSource(
    'src/screens/circles/tabs/OfficeTab.tsx',
    'Office invocation owner',
  );
  const feedSource = readSource(
    'src/hooks/useKanbanData.ts',
    'Feed invocation owner',
  );
  const terminalSource = readSource(
    'src/components/OfficeTerminal.tsx',
    'Office terminal target presentation',
  );

  // ── Canonical binding persistence ────────────────────────────────────────
  // Read is an exact RLS-visible row lookup. Set/clear share one receipt-bearing
  // server CAS; clients never emulate the compare-and-set with read-then-write.
  expectMatch(
    bindingSource,
    /export\s+async\s+function\s+readOfficeAgentSessionBinding\s*\(/,
    'binding lib exports the exact-row reader',
  );
  expectMatch(
    bindingSource,
    /export\s+async\s+function\s+setOfficeAgentSessionBinding\s*\(/,
    'binding lib exports the authoritative setter',
  );
  expectMatch(
    bindingSource,
    /export\s+async\s+function\s+clearOfficeAgentSessionBinding\s*\(/,
    'binding lib exports the authoritative clearer',
  );
  expectMatch(
    bindingSource,
    /\.from\(\s*['"]office_agent_session_bindings['"]\s*\)/,
    'binding reader uses the canonical binding table',
  );
  expectMatch(bindingSource, /\.eq\(\s*['"]office_agent_id['"]\s*,/, 'binding read is scoped to the exact Office agent UUID');
  expectMatch(bindingSource, /\.maybeSingle\(\s*\)/, 'binding read cannot silently choose among multiple rows');
  expectMatch(
    bindingSource,
    /\.rpc\(\s*['"]compare_and_set_office_agent_session_binding_v1['"]\s*,/,
    'binding mutations cross the dedicated receipt-bearing server CAS',
  );
  check(
    count(bindingSource, /exactClient\.rpc\(\s*'compare_and_set_office_agent_session_binding_v1'/g) === 1,
    'set and clear share one canonical CAS dispatch site',
  );
  const bindingCasStart = bindingSource.indexOf('async function compareAndSetOfficeAgentSessionBinding(');
  const bindingCasEnd = bindingSource.indexOf('/** Bind or move only if', bindingCasStart);
  check(bindingCasStart >= 0 && bindingCasEnd > bindingCasStart, 'binding CAS implementation is present');
  const bindingCasSource = bindingSource.slice(bindingCasStart, bindingCasEnd);
  check(
    bindingCasSource.includes('const exactClient = getSupabaseClientForAccessToken(authority.accessToken);')
      && !bindingCasSource.includes('bindCapturedBearer')
      && !bindingCasSource.includes('.setHeader('),
    'binding CAS dispatch uses the pinned exact-authority client without shared header merging',
  );
  expectNoMatch(
    bindingSource,
    /supabase\.rpc\(\s*['"](?:set|clear)_office_agent_session_binding['"]\s*,/,
    'legacy unconditional set and clear RPCs have no client dispatch path',
  );
  for (const field of [
    'p_office_agent_id',
    'p_circle_id',
    'p_expected_binding_id',
    'p_expected_agent_bot_id',
    'p_expected_session_key',
    'p_expected_updated_at',
    'p_next_agent_bot_id',
    'p_next_session_key',
  ]) {
    expectMatch(bindingSource, new RegExp(`\\b${field}\\b`), `binding CAS carries ${field}`);
  }
  expectMatch(
    bindingSource,
    /expectedBinding\?\.id\s*\?\?\s*null/,
    'first bind sends an explicit expected-null database precondition',
  );
  expectMatch(bindingSource, /p_expected_updated_at:\s*request\.expectedBinding\?\.updatedAt\s*\?\?\s*null/, 'non-null CAS carries the exact observed row version');
  expectMatch(bindingSource, /isAuthorityCurrent:\s*OfficeConnectionAuthorityFence/, 'mutation options require an exact lifecycle fence');
  check(
    count(bindingSource, /mutationAuthorityIsCurrent\(/g) >= 3,
    'mutation authority is fenced before dispatch and after the RPC',
  );
  expectMatch(bindingSource, /parseOfficeAgentSessionBindingMutationReceipt/, 'client accepts only a structured exact mutation receipt');
  expectNoMatch(bindingSource, /\.ilike\s*\(|\.or\s*\(/, 'binding persistence never resolves identity by fuzzy query');

  // ── Pure resolver boundary ───────────────────────────────────────────────
  expectMatch(
    bindingCoreSource,
    /export\s+(?:async\s+)?function\s+resolveOfficeAgentSessionBinding\s*\(/,
    'binding core exports the pure exact resolver',
  );
  expectNoMatch(bindingCoreSource, /from ['"].*supabase|\.from\s*\(|\.rpc\s*\(|fetch\s*\(/, 'binding resolver performs no I/O');
  for (const field of [
    'bindingId',
    'officeAgentId',
    'agentBotId',
    'sessionKey',
    'connections',
    'remoteId',
    'sessionsByConnection',
  ]) {
    expectMatch(bindingCoreSource, new RegExp(`\\b${field}\\b`), `binding resolver consumes ${field}`);
  }

  const corePath = resolve(root, 'src/lib/officeAgentSessionBindingCore.ts');
  if (existsSync(corePath)) {
    try {
      const coreModule = await import(`${pathToFileURL(corePath).href}?smoke=${Date.now()}`);
      const resolveBinding = coreModule.resolveOfficeAgentSessionBinding as ((input: any) => any) | undefined;
      const buildConnectionFingerprint = coreModule.buildOpenSwanConnectionFingerprint as ((input: any) => any) | undefined;
      if (check(typeof resolveBinding === 'function', 'pure resolver is callable')) {
        const IDs = {
          circle: '11111111-1111-4111-8111-111111111111',
          owner: '22222222-2222-4222-8222-222222222222',
          officeAgent: '33333333-3333-4333-8333-333333333333',
          binding: '44444444-4444-4444-8444-444444444444',
          agentBot: '55555555-5555-4555-8555-555555555555',
          localConnection: 'conn_exact',
          otherConnection: 'conn_other',
          session: 'session.exact',
        };
        const exactConnection = {
          id: IDs.localConnection,
          remoteId: IDs.agentBot,
          provider: 'openswan',
          status: 'connected',
          enabled: true,
          endpoint: 'http://127.0.0.1:18790',
          token: 'local-test-token',
        };
        const exactFingerprint = buildConnectionFingerprint?.(exactConnection);
        const exactInput = {
          officeAgentId: IDs.officeAgent,
          binding: {
            id: IDs.binding,
            officeAgentId: IDs.officeAgent,
            agentBotId: IDs.agentBot,
            sessionKey: IDs.session,
          },
          connections: [exactConnection],
          sessionsByConnection: {
            [IDs.localConnection]: [{ sessionKey: IDs.session }],
          },
          sessionFingerprintsByConnection: {
            [IDs.localConnection]: exactFingerprint,
          },
        };

        const exact = resolveBinding(exactInput);
        check(exact?.ok === true, 'pure resolver accepts one exact current binding');
        check(exact?.target?.connectionId === IDs.localConnection, 'pure resolver returns the exact local connection id');
        check(exact?.target?.sessionKey === IDs.session, 'pure resolver returns the exact bound session key');
        check(
          exact?.target?.compositeAgentId === `${IDs.localConnection}::${IDs.session}`,
          'pure resolver builds one exact OpenSwan target id',
        );

        const rejected: Array<[string, (input: any) => void]> = [
          ['missing binding', (input) => { input.binding = null; }],
          ['Office-agent mismatch', (input) => { input.officeAgentId = '66666666-6666-4666-8666-666666666666'; }],
          ['binding agent-bot mismatch', (input) => { input.binding.agentBotId = '88888888-8888-4888-8888-888888888888'; }],
          ['invalid binding session', (input) => { input.binding.sessionKey = ' session.exact '; }],
          ['missing local connection', (input) => { input.connections = []; }],
          ['disabled local connection', (input) => { input.connections[0].enabled = false; }],
          ['disconnected local connection', (input) => { input.connections[0].status = 'disconnected'; }],
          ['error local connection', (input) => { input.connections[0].status = 'error'; }],
          ['non-OpenSwan local connection', (input) => { input.connections[0].provider = 'claude-code'; }],
          ['wrong remote agent-bot id', (input) => { input.connections[0].remoteId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; }],
          ['missing current session', (input) => { input.sessionsByConnection[IDs.localConnection] = []; }],
          ['stale session mismatch', (input) => { input.sessionsByConnection[IDs.localConnection] = [{ sessionKey: 'session.other' }]; }],
          ['ambiguous current session', (input) => { input.sessionsByConnection[IDs.localConnection].push({ sessionKey: IDs.session }); }],
          ['ambiguous bot connection', (input) => { input.connections.push({ ...input.connections[0], id: IDs.otherConnection }); }],
        ];
        for (const [label, mutate] of rejected) {
          const input = clone(exactInput);
          mutate(input);
          const result = resolveBinding(input);
          check(result?.ok !== true, `pure resolver rejects ${label}`);
        }
      }
    } catch (error) {
      failures.push(`pure resolver imports without side effects: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // ── Agent detail binding UX ──────────────────────────────────────────────
  expectMatch(
    gatewaySource,
    /readOfficeAgentSessionBinding/,
    'AgentGatewayPanels reads the displayed agent binding',
  );
  expectMatch(gatewaySource, /setOfficeAgentSessionBinding/, 'AgentGatewayPanels exposes owner binding');
  expectMatch(gatewaySource, /clearOfficeAgentSessionBinding/, 'AgentGatewayPanels exposes owner unbinding');
  expectMatch(
    gatewaySource,
    /\.filter\(\s*\(?\s*connection\s*\)?\s*=>\s*connection\.id\s*===\s*runtimeConnectionId\s*\)/,
    'AgentGatewayPanels resolves the displayed connection by the exact runtime route',
  );
  expectNoMatch(
    gatewaySource,
    /conn\.name\s*===\s*agent\.connectionName/,
    'AgentGatewayPanels never treats a connection name as identity',
  );
  expectNoMatch(
    gatewaySource,
    /\|\|\s*connections\.find\([\s\S]{0,180}provider\s*===\s*['"]openswan['"]/,
    'AgentGatewayPanels never falls back to the first OpenSwan connection',
  );
  expectNoMatch(gatewaySource, /\|\|\s*sessions(?:Result\.sessions)?\?*\[0\]/, 'AgentGatewayPanels never falls back to the first session');
  expectMatch(gatewaySource, /\.remoteId\b/, 'AgentGatewayPanels binds through the exact agentBot remoteId');
  expectMatch(gatewaySource, /agent\.sessionKey\b/, 'AgentGatewayPanels binds the displayed exact session');
  expectMatch(
    gatewaySource,
    /ownerId\s*===\s*userId|userId\s*===\s*[^\n]{0,80}ownerId/,
    'binding choices are restricted to the current owner',
  );
  expectMatch(gatewaySource, /provider\s*===\s*['"]openswan['"]/, 'binding choices are restricted to OpenSwan agents');
  expectMatch(gatewaySource, /isPublished/, 'binding choices require a published Office agent');
  expectMatch(gatewaySource, /officeAgentId\s*:/, 'binding writes one published Office agent UUID');
  expectMatch(gatewaySource, /agentBotId\s*:/, 'binding writes one exact agent-bot UUID');
  expectMatch(gatewaySource, /sessionKey\s*:/, 'binding writes one exact session key');
  expectMatch(gatewaySource, /bindingLoadState\s*!==\s*['"]ready['"][\s\S]{0,180}hasOwnProperty\.call\(sessionBindings,\s*officeAgent\.id\)/, 'first bind requires a verified expected-null snapshot');
  expectMatch(gatewaySource, /setOfficeAgentSessionBinding\([\s\S]{0,320}currentBinding[\s\S]{0,220}isAuthorityCurrent:\s*isIdentityAuthorityCurrent/, 'bind/move passes its expected row and exact authority fence into the CAS');
  const unbindSection = sourceSection(
    gatewaySource,
    'const unbindPublishedAgent = useCallback',
    ['const exactSessionCanBind'],
    'exact binding clear action',
  );
  expectNoMatch(unbindSection, /readOfficeAgentSessionBindingsBatch/, 'clear has no client read-then-unconditional-write race');
  expectMatch(unbindSection, /clearOfficeAgentSessionBinding\([\s\S]{0,180}expectedBinding[\s\S]{0,220}isAuthorityCurrent:\s*isIdentityAuthorityCurrent/, 'clear submits the exact expected row and authority fence to the CAS');
  expectMatch(gatewaySource, /bindingResult\.receipt\.resultBinding|clearResult\.receipt\.resultBinding/, 'Gateway verifies database-authored route postconditions');

  // The gateway panel owns asynchronous connection/session state. Switching
  // between two exact targets must therefore remount the panel, and late work
  // from the previous mount/load must never make the displayed target bindable.
  const openSwanPanelMount = sourceSection(
    agentPanelSource,
    '<gatewayPanelsModule.OpenSwanFrontendPanel',
    ['/>'],
    'exact OpenSwan gateway panel mount',
  );
  expectMatch(
    openSwanPanelMount,
    /key=\{[\s\S]{0,180}runtimeConnectionId[\s\S]{0,180}agent\.sessionKey|key=\{[\s\S]{0,180}agent\.sessionKey[\s\S]{0,180}runtimeConnectionId/,
    'OpenSwan panel remount key includes both exact runtime connection and session key',
  );

  const refreshSection = sourceSection(
    gatewaySource,
    'const refresh = useCallback',
    ['useEffect(() =>'],
    'generation-guarded OpenSwan refresh',
  );
  const refreshEffectSection = sourceSection(
    gatewaySource,
    'useEffect(() =>',
    ['const runAction = useCallback'],
    'OpenSwan refresh lifecycle',
  );
  const generationRefMatch = [
    ...gatewaySource.matchAll(
      /const\s+([A-Za-z_$][\w$]*)\s*=\s*useRef(?:<\s*number\s*>)?\(\s*0\s*\)/g,
    ),
  ].find((match) => /generation|epoch|loadkey|requestkey/i.test(match[1]));
  check(Boolean(generationRefMatch), 'AgentGatewayPanels owns a monotonic refresh generation ref');
  if (generationRefMatch) {
    const generationRef = generationRefMatch[1];
    const escapedGenerationRef = generationRef.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const generationCapture = new RegExp(
      `const\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*(?:\\+\\+${escapedGenerationRef}\\.current|${escapedGenerationRef}\\.current\\s*\\+\\s*1)`,
    ).exec(refreshSection);
    check(Boolean(generationCapture), 'each OpenSwan refresh captures a new generation before awaiting provider data');
    if (generationCapture) {
      const localGeneration = generationCapture[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const staleComparison = new RegExp(
        `(?:${localGeneration}\\s*!==\\s*${escapedGenerationRef}\\.current|${escapedGenerationRef}\\.current\\s*!==\\s*${localGeneration})`,
        'g',
      );
      check(
        count(refreshSection, staleComparison) >= 2,
        'OpenSwan refresh rejects stale generations after multiple async provider boundaries',
      );
    }
    expectMatch(
      refreshEffectSection,
      new RegExp(`return\\s*\\(\\s*\\)\\s*=>[\\s\\S]{0,180}${escapedGenerationRef}\\.current\\s*(?:\\+\\+|\\+=\\s*1)`),
      'OpenSwan refresh cleanup invalidates work from an unmounted exact target',
    );
  }

  const sessionProvenanceMatch = [
    ...gatewaySource.matchAll(
      /const\s*\[\s*([A-Za-z_$][\w$]*)\s*,\s*([A-Za-z_$][\w$]*)\s*\]\s*=\s*useState(?:<[^>\n]+>)?\(\s*null\s*\)/g,
    ),
  ].find((match) => (
    /connectionid/i.test(match[1])
    && /session|loaded|source|provenance/i.test(match[1])
  ));
  check(Boolean(sessionProvenanceMatch), 'session rows carry explicit exact-connection provenance');
  let escapedSessionProvenance = '(?!)';
  let escapedSetSessionProvenance = '(?!)';
  if (sessionProvenanceMatch) {
    escapedSessionProvenance = sessionProvenanceMatch[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    escapedSetSessionProvenance = sessionProvenanceMatch[2].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const clearProvenancePattern = new RegExp(`${escapedSetSessionProvenance}\\(\\s*null\\s*\\)`);
    const clearProvenanceMatch = clearProvenancePattern.exec(refreshSection);
    check(Boolean(clearProvenanceMatch), 'a refresh clears stale session provenance before loading');
    const firstAwait = refreshSection.indexOf('await ');
    check(
      Boolean(clearProvenanceMatch) && firstAwait >= 0 && clearProvenanceMatch!.index < firstAwait,
      'refresh invalidates old session provenance before its first async provider boundary',
    );
    expectMatch(
      refreshSection,
      new RegExp(`${escapedSetSessionProvenance}\\(\\s*(?:config|connection|match|resolvedConnection)\\.(?:id|connectionId)\\s*\\)`),
      'a successful current refresh records the exact source connection id',
    );
  }

  const bindDisplayedSession = sourceSection(
    gatewaySource,
    'const bindDisplayedSession = useCallback',
    ['const unbindPublishedAgent = useCallback'],
    'exact displayed-session bind action',
  );
  const exactSessionReadinessStart = gatewaySource.includes('const exactSessionReady')
    ? 'const exactSessionReady'
    : 'const exactSessionCanBind';
  const exactSessionReadiness = sourceSection(
    gatewaySource,
    exactSessionReadinessStart,
    ['const subagentCount'],
    'exact displayed-session bind readiness',
  );
  const exactSessionMatchesMatch = /const\s+([A-Za-z_$][\w$]*)\s*=\s*[^;]{0,300}\bsessions\.filter\([\s\S]{0,180}session\.sessionKey\s*===\s*agent\.sessionKey/.exec(gatewaySource);
  check(Boolean(exactSessionMatchesMatch), 'displayed session identity preserves every exact-key candidate before deciding uniqueness');
  let escapedExactSessionMatches = '(?!)';
  if (exactSessionMatchesMatch) {
    escapedExactSessionMatches = exactSessionMatchesMatch[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    expectMatch(
      gatewaySource,
      new RegExp(`const\\s+activeSession\\s*=\\s*${escapedExactSessionMatches}\\.length\\s*===\\s*1\\s*\\?\\s*${escapedExactSessionMatches}\\[0\\]\\s*:\\s*null`),
      'one and only one exact session candidate may become active',
    );
  }
  expectNoMatch(
    gatewaySource,
    /sessions\.find\([\s\S]{0,180}session\.sessionKey\s*===\s*agent\.sessionKey/,
    'AgentGatewayPanels never silently chooses the first duplicate exact session',
  );
  expectMatch(bindDisplayedSession, /connection\.id\s*!==\s*runtimeConnectionId/, 'bind action rejects a connection retained from another exact runtime route');
  expectMatch(bindDisplayedSession, new RegExp(`${escapedSessionProvenance}\\s*!==\\s*runtimeConnectionId`), 'bind action rejects session rows loaded for another runtime connection');
  expectMatch(bindDisplayedSession, new RegExp(`${escapedExactSessionMatches}\\.length\\s*!==\\s*1`), 'bind action rejects missing or duplicate exact session rows');
  expectMatch(exactSessionReadiness, /connection\.id\s*===\s*runtimeConnectionId/, 'bind readiness proves the loaded connection is the exact runtime route');
  expectMatch(exactSessionReadiness, new RegExp(`${escapedSessionProvenance}\\s*===\\s*runtimeConnectionId`), 'bind readiness proves session-list provenance matches the exact runtime route');
  expectMatch(exactSessionReadiness, new RegExp(`${escapedExactSessionMatches}\\.length\\s*===\\s*1`), 'bind readiness requires exactly one matching session row');

  // ── Canonical invocation and fail-closed dispatch ────────────────────────
  expectMatch(
    invocationSource,
    /['"]invoke_agent_v2['"]/,
    'Office claims terminal work through invoke_agent_v2',
  );
  for (const returnedField of [
    'binding_contract_version',
    'binding_id',
    'binding_agent_bot_id',
    'binding_session_key',
    'binding_status',
  ]) {
    expectMatch(invocationSource, new RegExp(`\\b${returnedField}\\b`), `versioned claim reads ${returnedField}`);
  }
  expectMatch(invocationSource, /resolveOfficeAgentSessionBinding\s*\(/, 'agentInvocation uses the pure binding resolver');
  expectMatch(invocationSource, /officeSessionSnapshot/, 'agentInvocation accepts current connection/session evidence');
  expectMatch(invocationSource, /bindingAgentBotId|agentBotId/, 'agentInvocation preserves the claimed exact agent-bot UUID for pure resolution');
  expectMatch(invocationSource, /compositeAgentId/, 'provider invocation consumes only the resolver-built exact target');

  const invokeDirect = sourceSection(
    invocationSource,
    'export async function invokeDirect(',
    ['export async function invokeAndStream('],
    'Feed direct invocation',
  );
  const invokeAndStream = sourceSection(
    invocationSource,
    'export async function invokeAndStream(',
    ['// ─── Multi-Agent: Invoke all agents in parallel'],
    'Office claimed invocation',
  );
  for (const [label, section] of [
    ['Feed direct invocation', invokeDirect],
    ['Office claimed invocation', invokeAndStream],
  ] as const) {
    expectMatch(section, /officeSessionSnapshot/, `${label} receives the current snapshot`);
    const openSwanBranchStart = section.indexOf('openSwanSessionAgent) {');
    check(openSwanBranchStart >= 0, `${label} has a dedicated exact OpenSwan branch`);
    if (openSwanBranchStart < 0) continue;
    const followingMarkers = label === 'Feed direct invocation'
      ? ['\n  return callOpenSwanAgent(']
      : ['\n    } else {'];
    const branchEnds = followingMarkers
      .map((marker) => section.indexOf(marker, openSwanBranchStart))
      .filter((index) => index > openSwanBranchStart);
    const openSwanBranchEnd = branchEnds.length > 0 ? Math.min(...branchEnds) : section.length;
    const openSwanBranch = section.slice(openSwanBranchStart, openSwanBranchEnd);
    const resolution = /const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?resolveOfficeAgentSessionBinding\s*\(/.exec(openSwanBranch);
    check(Boolean(resolution), `${label} resolves the authoritative binding before dispatch`);
    if (!resolution) continue;
    const variable = resolution[1];
    const resolutionIndex = resolution.index;
    const providerIndex = openSwanBranch.indexOf('callOpenSwanAgent(', resolutionIndex);
    check(providerIndex > resolutionIndex, `${label} has one provider send only after binding resolution`);
    const explicitFailureGate = new RegExp(`if\\s*\\(\\s*!${variable}\\.ok\\s*\\)\\s*return\\s+buildOpenSwanBindingRequiredResult\\(\\)`).test(openSwanBranch);
    const conditionalFailureGate = new RegExp(`${variable}\\.ok[\\s\\S]{0,500}\\?[\\s\\S]{0,500}callOpenSwanAgent\\([\\s\\S]{0,500}:[\\s\\S]{0,120}buildOpenSwanBindingRequiredResult\\(\\)`).test(openSwanBranch);
    check(
      explicitFailureGate || conditionalFailureGate,
      `${label} maps every failed resolution to a pre-dispatch binding error`,
    );
    check(
      count(openSwanBranch, /callOpenSwanAgent\s*\(/g) === 1,
      `${label} exact OpenSwan branch contains one provider call site`,
    );
  }

  // ── Office/Feed current snapshot plumbing ───────────────────────────────
  expectMatch(officeSource, /officeSessionSnapshot/, 'OfficeTab builds/passes the current connection/session snapshot');
  expectMatch(feedSource, /officeSessionSnapshot/, 'Feed builds/passes the current connection/session snapshot');
  expectMatch(
    officeSource,
    /buildOfficeSessionSnapshot|sessionsByConnection/,
    'Office snapshot includes sessions keyed by exact connection id',
  );
  expectMatch(
    feedSource,
    /buildOfficeSessionSnapshot|sessionsByConnection/,
    'Feed snapshot includes sessions keyed by exact connection id',
  );
  expectMatch(
    officeSource,
    /invokeAndStream\([\s\S]{0,700}officeSessionSnapshot/,
    'Office passes its current snapshot into claimed invocation',
  );
  expectMatch(
    feedSource,
    /invokeDirect\([\s\S]{0,700}officeSessionSnapshot/,
    'Feed passes its current snapshot into direct invocation',
  );

  // ── Explicit BlackSwan routing and truthful connected state ─────────────
  const officeCommandHandler = sourceSection(
    officeSource,
    'const handleCommandSent = useCallback(',
    ['// ─── Terminal command subscription'],
    'Office direct terminal routing',
  );
  const officeSubscription = sourceSection(
    officeSource,
    '// ─── Terminal command subscription',
    ['  useEffect(() => {\n    let cancelled = false;'],
    'Office subscribed terminal routing',
  );
  const blackSwanTargetHelper = sourceSection(
    officeSource,
    'function isVirtualBlackSwanTarget(',
    ["import { NFT }"],
    'explicit BlackSwan target helper',
  );
  expectMatch(blackSwanTargetHelper, /targetAgentId\s*===\s*BLACKSWAN_AGENT_ID/, 'BlackSwan helper recognizes the explicit single virtual ID');
  expectMatch(blackSwanTargetHelper, /targetAgentIds\?\.includes\(BLACKSWAN_AGENT_ID\)/, 'BlackSwan helper recognizes the explicit multi-target virtual ID');
  expectMatch(blackSwanTargetHelper, /if \(input\.targetAgentId \|\| \(input\.targetAgentIds\?\.length \|\| 0\) > 0\) return false;/, 'an explicit durable UUID prevents name-based BlackSwan fallback');
  expectNoMatch(blackSwanTargetHelper, /\.includes\(\s*['"]swan['"]\s*\)/i, 'BlackSwan helper never uses a broad Swan substring');
  for (const [label, section] of [
    ['direct terminal routing', officeCommandHandler],
    ['subscribed terminal routing', officeSubscription],
  ] as const) {
    expectMatch(section, /isVirtualBlackSwanTarget\(/, `${label} delegates BlackSwan identity to the exact helper`);
    expectNoMatch(section, /\.includes\(\s*['"]swan['"]\s*\)/i, `${label} never converts an explicit UUID target through broad includes('swan')`);
  }
  expectMatch(terminalSource, /isConnectedOfficeStatus/, 'OfficeTerminal uses the shared connected-status predicate');
  expectNoMatch(
    terminalSource,
    /status\s*!==\s*['"]offline['"]/,
    'OfficeTerminal does not count error targets as connected merely because they are not offline',
  );
  expectMatch(
    gatewaySource,
    /status\s*===\s*['"]connected['"]/,
    'AgentGatewayPanels enables exact session actions only for a connected bridge',
  );

  if (failures.length > 0) {
    console.error(`office agent session-binding wiring smoke: ${failures.length} failed, ${passed} passed`);
    failures.forEach((failure, index) => console.error(`  ${index + 1}. ${failure}`));
    process.exitCode = 1;
    return;
  }

  console.log(`office agent session-binding wiring smoke: all ${passed} assertions passed`);
}

void main().catch((error) => {
  console.error('office agent session-binding wiring smoke crashed:', error);
  process.exitCode = 1;
});
