/**
 * useBackpackData — loads agent, session, and analytics data
 * for the Backpack tab's dashboard compartments.
 *
 * Pulls real data from Supabase DB:
 *   - circle_office_agents → agent status, token/message analytics
 *   - office_terminal_responses → per-response sessions for cost tracking
 *   - profiles → member/streak data
 *
 * Converts DB data into the OfficeAgent / OpenSwanSession shapes
 * that downstream components (CostDashboard, FarmHealth, etc.) expect.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { DEFAULT_AGENT, type OfficeAgent } from '../lib/officeAgents';
import { loadSessionTags, type SessionTag } from '../lib/sessionTags';
import { PROVIDER_META, type ProviderType } from '../lib/connectionManager';
import { calculateBudgetAlerts, type BudgetConfig } from '../lib/budgetAlerts';
import { loadCircleOfficeAgents, type CircleOfficeAgent } from '../lib/circleOffice';
import { createBackpackLoadFence } from '../lib/backpackLoadFence';
import { loadOfficeUserPreferences } from '../lib/officeDashboardPersistence';
import type { OpenSwanSession } from '../lib/openswanService';

export interface BackpackData {
  // Core data
  enrichedAgents: OfficeAgent[];
  enrichedSessions: OpenSwanSession[];
  displayAgents: OfficeAgent[];
  sessionTags: Map<string, SessionTag[]>;
  mergedCircleAgents: CircleOfficeAgent[];

  // Analytics
  budgetConfig: BudgetConfig;
  budgetConfigNotice: string | null;
  periodCosts: { today: number; week: number; month: number };
  budgetAlerts: ReturnType<typeof calculateBudgetAlerts>;

  // Extended stats for compartment cards
  traceCount: number;
  totalTokensToday: number;
  totalMessagesToday: number;
  featuredTradeCount: number;
  recentActivity: Array<{ type: string; text: string; time: string; color: string }>;
  lastRefreshed: string;

  // User
  currentUserId: string;
  currentUserName: string;

  // Meta
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  agentCount: number;
  sessionCount: number;
  refresh: () => Promise<void>;
}

interface TerminalResponseRow {
  id: string | null;
  agent_id: string | null;
  agent_name: string | null;
  token_count: number | null;
  latency_ms: number | null;
  status: string | null;
  created_at: string;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_creation_tokens: number | null;
  cache_read_tokens: number | null;
}

interface BackpackSnapshot {
  scopeCircleId: string;
  enrichedAgents: OfficeAgent[];
  enrichedSessions: OpenSwanSession[];
  sessionTags: Map<string, SessionTag[]>;
  mergedCircleAgents: CircleOfficeAgent[];
  budgetConfig: BudgetConfig;
  budgetConfigNotice: string | null;
  periodCosts: { today: number; week: number; month: number };
  traceCount: number;
  totalTokensToday: number;
  totalMessagesToday: number;
  featuredTradeCount: number;
  recentActivity: BackpackData['recentActivity'];
  lastRefreshed: string;
  currentUserId: string;
  currentUserName: string;
}

const EMPTY_SNAPSHOT: BackpackSnapshot = {
  scopeCircleId: '',
  enrichedAgents: [],
  enrichedSessions: [],
  sessionTags: new Map(),
  mergedCircleAgents: [],
  budgetConfig: { enabled: false },
  budgetConfigNotice: null,
  periodCosts: { today: 0, week: 0, month: 0 },
  traceCount: 0,
  totalTokensToday: 0,
  totalMessagesToday: 0,
  featuredTradeCount: 0,
  recentActivity: [],
  lastRefreshed: '',
  currentUserId: '',
  currentUserName: '',
};

const TERMINAL_RESPONSE_PAGE_SIZE = 1_000;
const TERMINAL_RESPONSE_SELECT = 'id, agent_id, agent_name, token_count, latency_ms, status, created_at, model, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens';

// ─── Helpers: Convert DB data → component-expected shapes ─────────────────

/** Convert a CircleOfficeAgent (from DB) into an OfficeAgent (for Farm/Perf dashboards) */
function circleAgentToOfficeAgent(ca: CircleOfficeAgent, idx: number): OfficeAgent {
  const totalTokens = ca.token_usage_total ?? ca.token_usage_today ?? 0;
  const todayTokens = ca.token_usage_today ?? 0;
  const totalMessages = ca.message_count_total ?? ca.message_count_today ?? 0;
  const inputTokens = ca.input_tokens_total ?? Math.round(totalTokens * 0.6);
  const outputTokens = ca.output_tokens_total ?? Math.round(totalTokens * 0.4);
  const cachedTokens = ca.cached_tokens_total ?? 0;

  return {
    id: ca.id,
    name: ca.name,
    role: ca.provider || 'agent',
    status: ca.status === 'building' || ca.status === 'active'
      ? 'active'
      : ca.status === 'idle'
        ? 'idle'
        : ca.status === 'error'
          ? 'error'
          : 'offline',
    color: ca.color || '#6366f1',
    deskIndex: idx,
    activity: ca.currentTask || (ca.status === 'idle' ? 'Standing by' : 'Offline'),
    messagesProcessed: totalMessages,
    uptimeHours: (ca.uptime_score ?? 1) * 24,
    uptime: ca.lastActiveAt
      ? timeSince(ca.lastActiveAt)
      : 'unknown',
    lastActive: ca.lastActiveAt || ca.updatedAt,
    recentActions: ca.last_command ? [ca.last_command] : [],
    recentMessages: [],
    costToday: ca.estimated_cost_today ?? estimateCostFromTokens(todayTokens),
    costTotal: ca.estimated_cost_total ?? estimateCostFromTokens(totalTokens),
    // Filled from the exact seven-day response window after all rows load.
    costWeek: 0,
    tokensUsed: totalTokens,
    inputTokens,
    outputTokens,
    cachedTokens,
    newTokens: Math.max(0, inputTokens - cachedTokens),
    turns: totalMessages,
    sessionKey: ca.id,
    model: ca.provider === 'blackswan' ? 'blackswan-3b' : ca.provider || 'unknown',
    connectionId: ca.ownerId || 'system',
    connectionName: ca.ownerDisplayName || ca.name,
    providerType: normalizeProviderType(ca.provider),
  };
}

/**
 * Convert terminal response rows into per-response OpenSwanSession objects.
 * Each response becomes its own session so CostDashboard can bucket costs by day.
 */
function responsesToSessions(responses: readonly TerminalResponseRow[]): OpenSwanSession[] {
  return responses.map((r) => {
    const tokens = r.token_count || 0;
    const inputTokens = r.input_tokens || 0;
    const outputTokens = r.output_tokens || 0;
    const cacheRead = r.cache_read_tokens || 0;
    const hasReal = inputTokens > 0 || outputTokens > 0;

    return {
      sessionKey: `resp-${r.id || r.created_at}`,
      kind: 'terminal' as const,
      agentId: r.agent_id || r.agent_name || 'unknown',
      model: r.model || 'unknown',
      lastActivity: r.created_at,
      messageCount: 1,
      totalCost: estimateCostFromTokens(tokens),
      totalInputTokens: hasReal ? inputTokens : Math.round(tokens * 0.6),
      totalOutputTokens: hasReal ? outputTokens : Math.round(tokens * 0.4),
      cachedTokens: cacheRead,
      newTokens: hasReal ? (inputTokens - cacheRead) : tokens,
      turns: 1,
      uptime: timeSince(r.created_at),
    };
  });
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseTerminalResponseRows(value: unknown): TerminalResponseRow[] {
  if (!Array.isArray(value)) return [];
  const rows: TerminalResponseRow[] = [];

  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const createdAt = typeof row.created_at === 'string' ? row.created_at : '';
    if (!createdAt || !Number.isFinite(Date.parse(createdAt))) continue;
    rows.push({
      id: typeof row.id === 'string' ? row.id : null,
      agent_id: typeof row.agent_id === 'string' ? row.agent_id : null,
      agent_name: typeof row.agent_name === 'string' ? row.agent_name : null,
      token_count: finiteNumber(row.token_count),
      latency_ms: finiteNumber(row.latency_ms),
      status: typeof row.status === 'string' ? row.status : null,
      created_at: createdAt,
      model: typeof row.model === 'string' ? row.model : null,
      input_tokens: finiteNumber(row.input_tokens),
      output_tokens: finiteNumber(row.output_tokens),
      cache_creation_tokens: finiteNumber(row.cache_creation_tokens),
      cache_read_tokens: finiteNumber(row.cache_read_tokens),
    });
  }
  return rows;
}

function normalizeBudgetConfig(value: unknown): BudgetConfig | null {
  if (value == null) return { enabled: false };
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (typeof input.enabled !== 'boolean') return null;
  if (input.hardLimit !== undefined && typeof input.hardLimit !== 'boolean') return null;
  const positiveAmount = (candidate: unknown): number | undefined => {
    if (candidate === undefined) return undefined;
    const parsed = finiteNumber(candidate);
    return parsed != null && parsed > 0 ? parsed : undefined;
  };
  for (const period of ['daily', 'weekly', 'monthly'] as const) {
    if (input[period] !== undefined && positiveAmount(input[period]) === undefined) return null;
  }
  return {
    enabled: input.enabled,
    hardLimit: input.hardLimit === true,
    daily: positiveAmount(input.daily),
    weekly: positiveAmount(input.weekly),
    monthly: positiveAmount(input.monthly),
  };
}

async function loadTerminalResponseHistory({
  circleId,
  accessToken,
  historyStart,
  historyEnd,
}: {
  circleId: string;
  accessToken: string;
  historyStart: string;
  historyEnd: string;
}): Promise<TerminalResponseRow[]> {
  const rawRows: unknown[] = [];
  let expectedCount: number | null = null;
  let offset = 0;

  while (expectedCount === null || offset < expectedCount) {
    const { data, error, count } = await supabase
      .from('office_terminal_responses')
      .select(TERMINAL_RESPONSE_SELECT, { count: 'exact' })
      .eq('circle_id', circleId)
      .gte('created_at', historyStart)
      .lte('created_at', historyEnd)
      .setHeader('Authorization', `Bearer ${accessToken}`)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + TERMINAL_RESPONSE_PAGE_SIZE - 1);

    if (error) {
      console.error('[Backpack] Usage query failed:', error.message);
      throw new Error('Usage and cost data could not be loaded. Your previous snapshot was kept.');
    }
    if (
      !Number.isSafeInteger(count)
      || Number(count) < 0
      || (expectedCount !== null && count !== expectedCount)
    ) {
      throw new Error('Usage history changed while it was loading. Retry to obtain a complete snapshot.');
    }
    if (expectedCount === null) expectedCount = Number(count);

    const page = Array.isArray(data) ? data : [];
    rawRows.push(...page);
    offset += page.length;
    if (offset === expectedCount) break;
    if (offset > expectedCount || page.length === 0) {
      throw new Error('Usage history could not be verified as complete. Retry the Backpack.');
    }
  }

  const uniqueRows = new Map<string, TerminalResponseRow>();
  for (const row of parseTerminalResponseRows(rawRows)) {
    const key = row.id || `${row.created_at}:${row.agent_id || row.agent_name || ''}`;
    if (!uniqueRows.has(key)) uniqueRows.set(key, row);
  }
  return [...uniqueRows.values()].sort((a, b) => (
    a.created_at.localeCompare(b.created_at) || String(a.id || '').localeCompare(String(b.id || ''))
  ));
}

function normalizeProviderType(value: string): ProviderType {
  return Object.prototype.hasOwnProperty.call(PROVIDER_META, value)
    ? value as ProviderType
    : 'generic-agent';
}

function matchesResponseAgent(row: TerminalResponseRow, agent: Pick<OfficeAgent, 'id' | 'name'>): boolean {
  const rowId = String(row.agent_id || '').trim().toLowerCase();
  const rowName = String(row.agent_name || '').trim().toLowerCase();
  return rowId === agent.id.toLowerCase() || rowName === agent.name.toLowerCase();
}

function responseCostForAgent(
  responses: readonly TerminalResponseRow[],
  agent: Pick<OfficeAgent, 'id' | 'name'>,
): number {
  return responses.reduce(
    (sum, row) => sum + (matchesResponseAgent(row, agent) ? estimateCostFromTokens(row.token_count || 0) : 0),
    0,
  );
}

function estimateCostFromTokens(tokens: number): number {
  return tokens * 0.0000005;
}

function timeSince(iso: string): string {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return 'unknown';
  const ms = Math.max(0, Date.now() - parsed);
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function backpackLoadErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return 'Backpack data could not be loaded. Check your connection and try again.';
}

// ─── Hook ─────────────────────────────────────────────────────────────────

export function useBackpackData(circleId: string): BackpackData {
  const [snapshot, setSnapshot] = useState<BackpackSnapshot>(EMPTY_SNAPSHOT);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authRevision, setAuthRevision] = useState(0);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadFenceRef = useRef(createBackpackLoadFence());
  const hasSnapshotRef = useRef(false);
  const snapshotCircleIdRef = useRef('');
  const snapshotUserIdRef = useRef('');
  const loadingUserIdRef = useRef('');
  const errorCircleIdRef = useRef('');

  const loadData = useCallback(async () => {
    const normalizedCircleId = circleId.trim();
    const ticket = loadFenceRef.current.begin(normalizedCircleId);
    const scopeChanged = snapshotCircleIdRef.current !== normalizedCircleId;
    const hasCurrentSnapshot = hasSnapshotRef.current && !scopeChanged;

    if (scopeChanged) {
      hasSnapshotRef.current = false;
      snapshotUserIdRef.current = '';
      setSnapshot(EMPTY_SNAPSHOT);
    }
    errorCircleIdRef.current = normalizedCircleId;
    setError(null);
    setLoading(!hasCurrentSnapshot);
    setRefreshing(hasCurrentSnapshot);

    try {
      if (!normalizedCircleId) throw new Error('Choose a circle before opening the Backpack.');

      const { data: authData, error: authError } = await supabase.auth.getSession();
      if (authError) throw new Error('Your Backpack session could not be verified. Sign in again and retry.');
      const session = authData.session;
      if (!session?.user?.id || !session.access_token) {
        throw new Error('Sign in to load this private Backpack.');
      }
      const user = session.user;
      loadingUserIdRef.current = user.id;
      const exactScope = { userId: user.id, accessToken: session.access_token };

      const { data: profile } = await supabase
        .from('profiles')
        .select('display_name, username')
        .eq('id', user.id)
        .setHeader('Authorization', `Bearer ${session.access_token}`)
        .maybeSingle();

      const now = new Date();
      const historyEnd = now.toISOString();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const weekStart = new Date(todayStart);
      weekStart.setDate(weekStart.getDate() - 6);
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const historyStart = new Date(todayStart);
      historyStart.setDate(historyStart.getDate() - 89);
      const todayStartIso = todayStart.toISOString();
      const weekStartIso = weekStart.toISOString();
      const monthStartIso = monthStart.toISOString();
      const historyStartIso = historyStart.toISOString();

      const [tags, budgetResult, circleAgentsResult, allResponses] = await Promise.all([
        loadSessionTags({ userId: user.id, circleId: normalizedCircleId }),
        loadOfficeUserPreferences(normalizedCircleId, exactScope),
        loadCircleOfficeAgents(normalizedCircleId, exactScope),
        loadTerminalResponseHistory({
          circleId: normalizedCircleId,
          accessToken: session.access_token,
          historyStart: historyStartIso,
          historyEnd,
        }),
      ]);

      if (circleAgentsResult.error) {
        throw new Error('Agent status could not be loaded. Check your circle access and retry.');
      }
      const normalizedBudget = budgetResult.ok
        ? normalizeBudgetConfig(budgetResult.preferences?.budgetConfig)
        : null;
      const budget = normalizedBudget || { enabled: false };
      const budgetConfigNotice = !budgetResult.ok
        ? budgetResult.error || 'Budget alert settings could not be loaded from the Office.'
        : normalizedBudget
          ? null
          : 'The saved Office budget settings are invalid. Alerts are unavailable until they are updated.';

      const todayResponses = allResponses.filter(row => row.created_at >= todayStartIso);
      const weekResponses = allResponses.filter(row => row.created_at >= weekStartIso);
      const monthResponses = allResponses.filter(row => row.created_at >= monthStartIso);

      const circleAgents = circleAgentsResult.agents;
      const isBlackSwanCircleAgent = (agent: CircleOfficeAgent) => (
        agent.id === 'blackswan-default' || agent.name.trim().toLowerCase() === 'blackswan'
      );
      const bsAgent = circleAgents.find(isBlackSwanCircleAgent);
      const officeAgents = circleAgents
        .filter(agent => !isBlackSwanCircleAgent(agent))
        .map((ca, index) => {
          const agent = circleAgentToOfficeAgent(ca, index + 1);
          return {
            ...agent,
            costToday: responseCostForAgent(todayResponses, agent) || agent.costToday,
            costWeek: responseCostForAgent(weekResponses, agent),
          };
        });

      const bsResponseMatches = (row: TerminalResponseRow) => (
        String(row.agent_id || '').toLowerCase() === 'blackswan-default'
        || String(row.agent_name || '').toLowerCase().includes('blackswan')
      );
      const bsAllResponses = allResponses.filter(bsResponseMatches);
      const bsTodayResponses = todayResponses.filter(bsResponseMatches);
      const bsWeekResponses = weekResponses.filter(bsResponseMatches);
      const bsTodayTokens = bsTodayResponses.reduce((sum, row) => sum + (row.token_count || 0), 0);
      const bsHistoryTokens = bsAllResponses.reduce((sum, row) => sum + (row.token_count || 0), 0);
      const bsTotalTokens = bsAgent?.token_usage_total ?? bsHistoryTokens;
      const bsMessages = Math.max(bsAllResponses.length, bsAgent?.message_count_total ?? 0);
      const bsOffice: OfficeAgent | null = bsAgent || bsAllResponses.length > 0 ? {
        ...(bsAgent ? circleAgentToOfficeAgent(bsAgent, 0) : DEFAULT_AGENT),
        messagesProcessed: bsMessages,
        tokensUsed: bsTotalTokens,
        costToday: bsAgent?.estimated_cost_today ?? estimateCostFromTokens(bsTodayTokens),
        costWeek: estimateCostFromTokens(
          bsWeekResponses.reduce((sum, row) => sum + (row.token_count || 0), 0),
        ),
        costTotal: bsAgent?.estimated_cost_total ?? estimateCostFromTokens(bsTotalTokens),
        turns: bsMessages,
        status: bsAgent?.status === 'error'
          ? 'error'
          : bsAgent?.status === 'offline'
            ? 'offline'
            : bsAgent?.status === 'building' || bsAgent?.status === 'active'
              ? 'active'
              : 'idle',
      } : null;

      const allSessions = responsesToSessions(allResponses);
      const todayTokens = todayResponses.reduce((sum, row) => sum + (row.token_count || 0), 0);
      const weekTokens = weekResponses.reduce((sum, row) => sum + (row.token_count || 0), 0);
      const monthTokens = monthResponses.reduce((sum, row) => sum + (row.token_count || 0), 0);

      const featuredResult = await supabase
        .from('featured_trades')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('status', 'active')
        .gt('expires_at', now.toISOString())
        .setHeader('Authorization', `Bearer ${session.access_token}`);
      const featuredTradeCount = featuredResult.error ? 0 : featuredResult.count || 0;

      const recent = allResponses.slice(-8).reverse().map((row) => ({
        type: 'terminal' as string,
        text: `${row.agent_name || 'Agent'} ${row.status === 'error' ? 'failed' : row.status === 'done' ? 'responded' : row.status || 'updated'} (${row.token_count || 0} tokens)`,
        time: timeSince(row.created_at),
        color: row.status === 'error' ? '#ef4444' : row.status === 'done' ? '#22c55e' : '#f59e0b',
      }));

      if (!loadFenceRef.current.isCurrent(ticket) || loadingUserIdRef.current !== user.id) return;
      setSnapshot({
        scopeCircleId: normalizedCircleId,
        enrichedAgents: bsOffice ? [bsOffice, ...officeAgents] : officeAgents,
        enrichedSessions: allSessions,
        sessionTags: tags,
        mergedCircleAgents: circleAgents,
        budgetConfig: budget,
        budgetConfigNotice,
        periodCosts: {
          today: estimateCostFromTokens(todayTokens),
          week: estimateCostFromTokens(weekTokens),
          month: estimateCostFromTokens(monthTokens),
        },
        traceCount: allResponses.length,
        totalTokensToday: todayTokens,
        totalMessagesToday: todayResponses.length,
        featuredTradeCount,
        recentActivity: recent,
        lastRefreshed: new Date().toISOString(),
        currentUserId: user.id,
        currentUserName: profile?.display_name || profile?.username || 'User',
      });
      snapshotCircleIdRef.current = normalizedCircleId;
      snapshotUserIdRef.current = user.id;
      hasSnapshotRef.current = true;
    } catch (err) {
      console.error('Backpack data load error:', err);
      if (loadFenceRef.current.isCurrent(ticket)) {
        errorCircleIdRef.current = normalizedCircleId;
        setError(backpackLoadErrorMessage(err));
      }
    } finally {
      if (loadFenceRef.current.isCurrent(ticket)) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [authRevision, circleId]);

  useEffect(() => {
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      const nextUserId = nextSession?.user?.id || '';
      const loadedUserChanged = Boolean(snapshotUserIdRef.current)
        && snapshotUserIdRef.current !== nextUserId;
      const inFlightUserChanged = Boolean(loadingUserIdRef.current)
        && loadingUserIdRef.current !== nextUserId;
      if (!loadedUserChanged && !inFlightUserChanged) return;

      loadFenceRef.current.retire();
      hasSnapshotRef.current = false;
      snapshotCircleIdRef.current = '';
      snapshotUserIdRef.current = '';
      loadingUserIdRef.current = nextUserId;
      errorCircleIdRef.current = '';
      setSnapshot(EMPTY_SNAPSHOT);
      setError(null);
      setLoading(true);
      setRefreshing(false);
      setAuthRevision(revision => revision + 1);
    });
    return () => authListener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    void loadData();
    return () => {
      loadFenceRef.current.retire();
    };
  }, [loadData]);

  // ── Realtime subscription with debounce ──
  useEffect(() => {
    if (!circleId) return;

    const debouncedRefresh = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => { void loadData(); }, 5000);
    };

    const channel = supabase
      .channel(`backpack-live-${circleId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'office_terminal_responses',
        filter: `circle_id=eq.${circleId}`,
      }, debouncedRefresh)
      .subscribe();

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      supabase.removeChannel(channel);
    };
  }, [circleId, loadData]);

  const normalizedCircleId = circleId.trim();
  const snapshotIsVisible = snapshot.scopeCircleId === normalizedCircleId;
  const visibleSnapshot = snapshotIsVisible ? snapshot : EMPTY_SNAPSHOT;
  const visibleError = errorCircleIdRef.current === normalizedCircleId ? error : null;
  const displayAgents = visibleSnapshot.enrichedAgents;

  const budgetAlerts = useMemo(
    () => calculateBudgetAlerts(
      visibleSnapshot.budgetConfig,
      visibleSnapshot.periodCosts.today,
      visibleSnapshot.periodCosts.week,
      visibleSnapshot.periodCosts.month,
    ),
    [visibleSnapshot.budgetConfig, visibleSnapshot.periodCosts],
  );

  return {
    enrichedAgents: visibleSnapshot.enrichedAgents,
    enrichedSessions: visibleSnapshot.enrichedSessions,
    displayAgents,
    sessionTags: visibleSnapshot.sessionTags,
    mergedCircleAgents: visibleSnapshot.mergedCircleAgents,
    budgetConfig: visibleSnapshot.budgetConfig,
    budgetConfigNotice: visibleSnapshot.budgetConfigNotice,
    periodCosts: visibleSnapshot.periodCosts,
    budgetAlerts,
    traceCount: visibleSnapshot.traceCount,
    totalTokensToday: visibleSnapshot.totalTokensToday,
    totalMessagesToday: visibleSnapshot.totalMessagesToday,
    featuredTradeCount: visibleSnapshot.featuredTradeCount,
    recentActivity: visibleSnapshot.recentActivity,
    lastRefreshed: visibleSnapshot.lastRefreshed,
    currentUserId: visibleSnapshot.currentUserId,
    currentUserName: visibleSnapshot.currentUserName,
    loading: loading || (Boolean(normalizedCircleId) && !snapshotIsVisible && !visibleError),
    refreshing: snapshotIsVisible && refreshing,
    error: visibleError,
    agentCount: displayAgents.length,
    sessionCount: visibleSnapshot.enrichedSessions.length,
    refresh: loadData,
  };
}
