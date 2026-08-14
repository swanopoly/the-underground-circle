/**
 * Office cost stability smoke
 *
 * Pins the boundary between cumulative local session meters and durable
 * server-owned daily/lifetime totals. A login/cache restore must never change
 * a value presented as today's cost.
 */

import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';

process.env.EXPO_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||= 'test-anon-key';

const localValues = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    get length() { return localValues.size; },
    clear: () => localValues.clear(),
    getItem: (key: string) => localValues.get(key) ?? null,
    key: (index: number) => Array.from(localValues.keys())[index] ?? null,
    removeItem: (key: string) => { localValues.delete(key); },
    setItem: (key: string, value: string) => { localValues.set(key, String(value)); },
  },
});

const originalLoad = (Module as any)._load;
(Module as any)._load = function loadWithSmokeStubs(
  request: string,
  parent: unknown,
  isMain: boolean,
) {
  if (request === 'react-native') {
    return {
      Platform: {
        OS: 'web',
        select: (options: Record<string, unknown>) => options.web ?? options.default,
      },
    };
  }
  if (request === '@react-native-async-storage/async-storage') {
    return {
      __esModule: true,
      default: {
        getAllKeys: async () => Array.from(localValues.keys()),
        getItem: async (key: string) => localValues.get(key) ?? null,
        multiRemove: async (keys: string[]) => { keys.forEach((key) => localValues.delete(key)); },
        removeItem: async (key: string) => { localValues.delete(key); },
        setItem: async (key: string, value: string) => { localValues.set(key, value); },
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

import type { OfficeAgent } from '../src/lib/officeAgents';

let passed = 0;
let failed = 0;

function check(name: string, condition: unknown, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
    return;
  }
  failed += 1;
  console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
}

function makeAgent(overrides: Partial<OfficeAgent> = {}): OfficeAgent {
  return {
    id: 'codex::session-a',
    name: 'Codex',
    role: 'Agent',
    status: 'idle',
    color: '#10a37f',
    deskIndex: 0,
    activity: 'Ready',
    messagesProcessed: 2,
    uptimeHours: 0,
    uptime: 'recent',
    lastActive: '2026-08-11T12:00:00.000Z',
    recentActions: [],
    recentMessages: [],
    costToday: 9,
    sessionCostToday: 9,
    costTotal: 9,
    costWeek: 0,
    tokensUsed: 100,
    inputTokens: 80,
    outputTokens: 20,
    cachedTokens: 0,
    newTokens: 80,
    turns: 2,
    sessionKey: 'session-a',
    model: 'test-model',
    connectionId: 'codex-auto',
    connectionName: 'Codex (Local)',
    providerType: 'codex',
    ...overrides,
  };
}

async function main(): Promise<void> {
  const {
    applyDurableOfficeAgentCost,
    findDurableOfficeAgentCost,
  } = await import('../src/lib/officeAgents');
  const { applyIdentityToAgent } = await import('../src/lib/agentIdentity');
  const { enrichAgentsWithCache, takeSnapshot } = await import('../src/lib/sessionCache');

  console.log('\n[1] deterministic durable cost selection');
  const exactRow = {
    id: 'db-codex',
    name: 'Codex',
    provider: 'codex',
    estimated_cost_today: 0.25,
    estimated_cost_total: 4.5,
  };
  const exact = findDurableOfficeAgentCost(makeAgent(), [exactRow], { liveProviderAgentCount: 1 });
  check('exact agent name resolves its durable row', exact?.id === 'db-codex');

  const friendlyAgent = makeAgent({ name: 'Project Sparrow' });
  const uniqueProvider = findDurableOfficeAgentCost(friendlyAgent, [exactRow], { liveProviderAgentCount: 1 });
  check('singular live provider may use singular provider row', uniqueProvider?.id === 'db-codex');
  check(
    'multiple live sessions disable provider aggregate fallback',
    findDurableOfficeAgentCost(friendlyAgent, [exactRow], { liveProviderAgentCount: 2 }) === null,
  );
  const ambiguousRows = [
    exactRow,
    { ...exactRow, id: 'db-codex-2', name: 'Codex Two' },
  ];
  check(
    'ambiguous provider rows fail closed',
    findDurableOfficeAgentCost(friendlyAgent, ambiguousRows, { liveProviderAgentCount: 1 }) === null,
  );
  check(
    'ambiguous provider result is independent of row order',
    findDurableOfficeAgentCost(friendlyAgent, [...ambiguousRows].reverse(), { liveProviderAgentCount: 1 }) === null,
  );

  console.log('\n[2] daily/session/lifetime separation');
  const hydrated = applyDurableOfficeAgentCost(makeAgent(), exactRow);
  check('server daily total replaces cumulative session cost', hydrated.costToday === 0.25);
  check('session meter remains available for delta sync', hydrated.sessionCostToday === 9);
  check('server lifetime total remains separate', hydrated.costTotal === 4.5);
  const afterDailyReset = applyDurableOfficeAgentCost(makeAgent(), {
    ...exactRow,
    estimated_cost_today: 0,
  });
  check('server daily reset is not defeated by a stale session total', afterDailyReset.costToday === 0);
  check('daily reset retains cumulative session lineage', afterDailyReset.sessionCostToday === 9);

  const identityHydrated = applyIdentityToAgent(hydrated, {
    sessionKey: 'session-a',
    totalCostAllTime: 99,
    totalTokensAllTime: 500,
    totalSessionsAllTime: 4,
    firstSeen: 1,
    lastSeen: 2,
    totalMessages: 10,
    totalTurns: 8,
  });
  check('identity lifetime history never overwrites cost today', identityHydrated.costToday === 0.25);
  check('identity lifetime history enriches only total cost', identityHydrated.costTotal === 99);

  console.log('\n[3] login cache restore');
  localValues.set('@office_session_cache', JSON.stringify({
    'session-a': {
      sessionKey: 'session-a',
      agentId: 'codex::session-a',
      connectionId: 'codex-auto',
      lastUpdate: Date.now(),
      totalCost: 12,
      totalTokens: 600,
      inputTokens: 400,
      outputTokens: 200,
      turns: 6,
    },
  }));
  localValues.set('@office_daily_costs', JSON.stringify([{
    date: new Date().toISOString().slice(0, 10),
    costs: { 'codex::session-a': 77 },
    tokens: { 'codex::session-a': 700 },
  }]));
  const [cacheHydrated] = await enrichAgentsWithCache([
    makeAgent({ costToday: 0.25, sessionCostToday: 3, costTotal: 4.5, tokensUsed: 100 }),
  ]);
  check('cache restore preserves durable daily value', cacheHydrated.costToday === 0.25);
  check('cache restore affects only cumulative session value', cacheHydrated.sessionCostToday === 12);
  check('token cache remains cumulative', cacheHydrated.tokensUsed === 700);

  await takeSnapshot([cacheHydrated]);
  const savedCache = JSON.parse(localValues.get('@office_session_cache') || '{}');
  check('snapshot persists session cost instead of daily cost', savedCache['session-a']?.totalCost === 12);

  console.log('\n[4] Office source wiring and labels');
  const root = path.resolve(__dirname, '..');
  const officeSource = fs.readFileSync(path.join(root, 'src/screens/circles/tabs/OfficeTab.tsx'), 'utf8');
  const tokenCardSource = fs.readFileSync(path.join(root, 'src/components/office/OfficeOpsBoardCards.tsx'), 'utf8');
  const activitySource = fs.readFileSync(path.join(root, 'src/screens/circles/tabs/office/AgentActivityPanel.tsx'), 'utf8');
  const whiteboardSource = fs.readFileSync(path.join(root, 'src/screens/circles/tabs/office/Whiteboard.tsx'), 'utf8');

  check('Office uses canonical durable row resolver', officeSource.includes('findDurableOfficeAgentCost(agent, ownDbCostRows'));
  check('Office applies canonical durable costs', officeSource.includes('applyDurableOfficeAgentCost(agent, dbMatch)'));
  check('Office no longer max-merges DB daily and session totals', !officeSource.includes('agent.costToday = Math.max'));
  check('Office queries a strict server 24h spend window', officeSource.includes('getClaudeUsageSummaryStrict(circleId, 1)'));
  check('Office queries a strict server 7d spend window', officeSource.includes('getClaudeUsageSummaryStrict(circleId, 7)'));
  check('Office queries a strict server 30d spend window', officeSource.includes('getClaudeUsageSummaryStrict(circleId, 30)'));
  check('transient usage failure retains the prior snapshot', officeSource.includes('opsUsageCacheRef.current = { ...opsUsageCacheRef.current, fetchedAtMs: 0 }'));
  check('Office no longer derives period spend from hydrated sessions', !officeSource.includes('calculatePeriodCosts(enrichedSessions)'));
  check('mobile card renders daily rather than lifetime fallback', officeSource.includes('<Text style={styles.mobileCardCost}>${agent.costToday.toFixed(2)}</Text>'));
  check('old lifetime-as-today expression is gone', !officeSource.includes('(agent.costTotal || agent.costToday).toFixed(2)'));
  check('token card labels rolling server window as 24h', tokenCardSource.includes('`24h ${formatUsd(tracker.spendTodayUsd)}`'));
  check('agent detail labels daily cost honestly', activitySource.includes("label: 'COST TODAY'"));
  check('whiteboard identifies tracked rolling periods', whiteboardSource.includes('TRACKED SPEND') && whiteboardSource.includes('label="24H"') && whiteboardSource.includes('label="30D"'));

  console.log(`\nOffice cost stability smoke: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
