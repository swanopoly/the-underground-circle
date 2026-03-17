/**
 * useBackpackData — loads agent, session, and analytics data
 * for the Backpack tab's dashboard compartments.
 *
 * Pulls real data from Supabase DB:
 *   - circle_office_agents → agent status, token/message analytics
 *   - office_terminal_responses → per-response sessions for cost tracking
 *   - profiles → member/streak data
 *
 * Converts DB data into the OfficeAgent / OpenClawSession shapes
 * that downstream components (CostDashboard, FarmHealth, etc.) expect.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { OfficeAgent, DEFAULT_AGENT } from '../lib/officeAgents';
import { SessionTag, loadSessionTags } from '../lib/sessionTags';
import { AgentConnection, loadConnections } from '../lib/connectionManager';
import { BudgetConfig, loadBudgetConfig, calculateBudgetAlerts } from '../lib/budgetAlerts';
import { CircleOfficeAgent, loadCircleOfficeAgents } from '../lib/circleOffice';
import type { OpenClawSession } from '../lib/openclawService';

export interface BackpackData {
  // Core data
  enrichedAgents: OfficeAgent[];
  enrichedSessions: OpenClawSession[];
  displayAgents: OfficeAgent[];
  sessionTags: Map<string, SessionTag[]>;
  connections: AgentConnection[];
  mergedCircleAgents: CircleOfficeAgent[];

  // Analytics
  budgetConfig: BudgetConfig;
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
  agentCount: number;
  sessionCount: number;
  refresh: () => void;
}

// ─── Helpers: Convert DB data → component-expected shapes ─────────────────

/** Convert a CircleOfficeAgent (from DB) into an OfficeAgent (for Farm/Perf dashboards) */
function circleAgentToOfficeAgent(ca: CircleOfficeAgent, idx: number): OfficeAgent {
  return {
    id: ca.id,
    name: ca.name,
    role: ca.provider || 'agent',
    status: ca.status === 'building' ? 'active' : ca.status === 'idle' ? 'idle' : ca.status === 'error' ? 'error' : 'offline',
    color: ca.color || '#6366f1',
    deskIndex: idx,
    activity: ca.currentTask || (ca.status === 'idle' ? 'Standing by' : 'Offline'),
    messagesProcessed: (ca.message_count_today ?? 0) + (ca.message_count_total ?? 0),
    uptimeHours: (ca.uptime_score ?? 1) * 24,
    uptime: ca.lastActiveAt
      ? timeSince(ca.lastActiveAt)
      : 'unknown',
    lastActive: ca.lastActiveAt || ca.updatedAt,
    recentActions: ca.last_command ? [ca.last_command] : [],
    recentMessages: [],
    costToday: estimateCostFromTokens(ca.token_usage_today ?? 0),
    costWeek: estimateCostFromTokens(ca.token_usage_total ?? 0),
    tokensUsed: (ca.token_usage_today ?? 0) + (ca.token_usage_total ?? 0),
    inputTokens: (ca as any).input_tokens_total ?? Math.round(((ca.token_usage_today ?? 0) + (ca.token_usage_total ?? 0)) * 0.6),
    outputTokens: (ca as any).output_tokens_total ?? Math.round(((ca.token_usage_today ?? 0) + (ca.token_usage_total ?? 0)) * 0.4),
    cachedTokens: (ca as any).cache_read_tokens_total ?? 0,
    newTokens: (ca as any).input_tokens_total
      ? ((ca as any).input_tokens_total - ((ca as any).cache_read_tokens_total ?? 0))
      : ((ca.token_usage_today ?? 0) + (ca.token_usage_total ?? 0)),
    turns: (ca.message_count_today ?? 0) + (ca.message_count_total ?? 0),
    sessionKey: ca.id,
    model: ca.provider === 'blackswan' ? 'blackswan-3b' : ca.provider || 'unknown',
    connectionId: ca.ownerId || 'system',
    connectionName: ca.ownerDisplayName || ca.name,
    providerType: (ca.provider as any) || 'generic-agent',
  };
}

/**
 * Convert terminal response rows into per-response OpenClawSession objects.
 * Each response becomes its own session so CostDashboard can bucket costs by day.
 */
function responsesToSessions(responses: any[]): OpenClawSession[] {
  return responses.map((r: any) => {
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

function estimateCostFromTokens(tokens: number): number {
  return tokens * 0.0000005;
}

function timeSince(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ─── Hook ─────────────────────────────────────────────────────────────────

export function useBackpackData(circleId: string): BackpackData {
  const [enrichedAgents, setEnrichedAgents] = useState<OfficeAgent[]>([]);
  const [enrichedSessions, setEnrichedSessions] = useState<OpenClawSession[]>([]);
  const [sessionTags, setSessionTags] = useState<Map<string, SessionTag[]>>(new Map());
  const [connections, setConnections] = useState<AgentConnection[]>([]);
  const [mergedCircleAgents, setMergedCircleAgents] = useState<CircleOfficeAgent[]>([]);
  const [budgetConfig, setBudgetConfig] = useState<BudgetConfig>({ enabled: false });
  const [periodCosts, setPeriodCosts] = useState({ today: 0, week: 0, month: 0 });
  const [currentUserId, setCurrentUserId] = useState('');
  const [currentUserName, setCurrentUserName] = useState('');
  const [loading, setLoading] = useState(true);
  const [traceCount, setTraceCount] = useState(0);
  const [totalTokensToday, setTotalTokensToday] = useState(0);
  const [totalMessagesToday, setTotalMessagesToday] = useState(0);
  const [featuredTradeCount, setFeaturedTradeCount] = useState(0);
  const [recentActivity, setRecentActivity] = useState<Array<{ type: string; text: string; time: string; color: string }>>([]);
  const [lastRefreshed, setLastRefreshed] = useState('');

  // Debounce ref for realtime updates
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialLoadDone = useRef(false);

  const loadData = useCallback(async () => {
    // Only show loading spinner on first load — not on realtime refreshes
    if (!initialLoadDone.current) setLoading(true);
    try {
      // ── Get user ──
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setCurrentUserId(user.id);
        const { data: profile } = await supabase
          .from('profiles')
          .select('display_name, username')
          .eq('id', user.id)
          .single();
        setCurrentUserName(profile?.display_name || profile?.username || 'User');
      }

      // ── Load parallel data (single month query, filter in-memory) ──
      const now = new Date();
      const todayStr = now.toISOString().split('T')[0];
      const weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString();
      const monthAgo = new Date(now.getTime() - 30 * 86400000).toISOString();

      const [conns, tags, budget, circleAgentsResult, allResponses] = await Promise.all([
        loadConnections(),
        loadSessionTags(),
        loadBudgetConfig(),
        circleId ? loadCircleOfficeAgents(circleId) : Promise.resolve({ agents: [] }),
        // Single query for all responses in the last 30 days
        circleId ? supabase
          .from('office_terminal_responses')
          .select('id, agent_id, agent_name, token_count, latency_ms, status, created_at, model, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens')
          .eq('circle_id', circleId)
          .gte('created_at', monthAgo)
          .eq('status', 'done')
          .order('created_at', { ascending: true })
          .then(r => r.data || [])
        : Promise.resolve([]),
      ]);

      // ── Filter in-memory for today/week subsets ──
      const todayResponses = allResponses.filter((r: any) => r.created_at >= todayStr);
      const weekResponses = allResponses.filter((r: any) => r.created_at >= weekAgo);

      setConnections(conns);
      setSessionTags(tags);
      setBudgetConfig(budget);

      // ── Circle agents → enriched agents ──
      const circleAgents = circleAgentsResult.agents;
      setMergedCircleAgents(circleAgents);

      const officeAgents = circleAgents
        .filter(a => a.id !== 'blackswan-default')
        .map((ca, i) => circleAgentToOfficeAgent(ca, i + 1));

      const bsAgent = circleAgents.find(a => a.id === 'blackswan-default' || a.name.toLowerCase() === 'blackswan');
      const bsResponses = todayResponses.filter((r: any) => r.agent_name?.toLowerCase().includes('blackswan'));
      const bsOffice: OfficeAgent = {
        ...DEFAULT_AGENT,
        messagesProcessed: bsResponses.length + (bsAgent?.message_count_total ?? 0),
        tokensUsed: bsResponses.reduce((sum: number, r: any) => sum + (r.token_count || 0), 0),
        costToday: estimateCostFromTokens(
          bsResponses.reduce((sum: number, r: any) => sum + (r.token_count || 0), 0)
        ),
        turns: bsResponses.length,
        status: 'idle',
      };

      setEnrichedAgents([bsOffice, ...officeAgents]);

      // ── Per-response sessions for CostDashboard (accurate daily bucketing) ──
      const allSessions = responsesToSessions(allResponses);
      setEnrichedSessions(allSessions);

      // ── Period costs from in-memory filtered data ──
      const todayTokens = todayResponses.reduce((sum: number, r: any) => sum + (r.token_count || 0), 0);
      const weekTokens = weekResponses.reduce((sum: number, r: any) => sum + (r.token_count || 0), 0);
      const monthTokens = allResponses.reduce((sum: number, r: any) => sum + (r.token_count || 0), 0);
      setPeriodCosts({
        today: estimateCostFromTokens(todayTokens),
        week: estimateCostFromTokens(weekTokens),
        month: estimateCostFromTokens(monthTokens),
      });

      // ── Extended stats ──
      setTraceCount(allResponses.length);
      setTotalTokensToday(todayTokens);
      setTotalMessagesToday(todayResponses.length);

      // Featured trades count — table may not exist, safe query
      if (user) {
        try {
          const { count } = await supabase
            .from('featured_trades')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', user.id)
            .eq('status', 'active')
            .gt('expires_at', new Date().toISOString());
          setFeaturedTradeCount(count || 0);
        } catch {
          setFeaturedTradeCount(0);
        }
      }

      // Build recent activity from latest responses
      const recent = allResponses.slice(-8).reverse().map((r: any) => ({
        type: 'terminal' as string,
        text: `${r.agent_name || 'Agent'} responded (${r.token_count || 0} tokens)`,
        time: timeSince(r.created_at),
        color: r.status === 'done' ? '#22c55e' : r.status === 'error' ? '#ef4444' : '#f59e0b',
      }));
      setRecentActivity(recent);
      setLastRefreshed(new Date().toISOString());
    } catch (err) {
      console.error('Backpack data load error:', err);
    } finally {
      setLoading(false);
      initialLoadDone.current = true;
    }
  }, [circleId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ── Realtime subscription with debounce ──
  useEffect(() => {
    if (!circleId) return;

    const debouncedRefresh = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => loadData(), 5000);
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

  // Memoized computed values
  const displayAgents = useMemo(
    () => enrichedAgents.length > 0 ? enrichedAgents : [DEFAULT_AGENT],
    [enrichedAgents]
  );

  const budgetAlerts = useMemo(
    () => calculateBudgetAlerts(budgetConfig, periodCosts.today, periodCosts.week, periodCosts.month),
    [budgetConfig, periodCosts]
  );

  return {
    enrichedAgents,
    enrichedSessions,
    displayAgents,
    sessionTags,
    connections,
    mergedCircleAgents,
    budgetConfig,
    periodCosts,
    budgetAlerts,
    traceCount,
    totalTokensToday,
    totalMessagesToday,
    featuredTradeCount,
    recentActivity,
    lastRefreshed,
    currentUserId,
    currentUserName,
    loading,
    agentCount: displayAgents.length,
    sessionCount: enrichedSessions.length,
    refresh: loadData,
  };
}
