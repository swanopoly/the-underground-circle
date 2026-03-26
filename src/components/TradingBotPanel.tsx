/**
 * TradingBotPanel — Backpack compartment for Solana trading
 *
 * Tabs:
 *   - Portfolio: wallet overview, token balances, total value
 *   - Trade: manual swap via Jupiter
 *   - DCA: dollar-cost averaging configs
 *   - Alerts: price alerts management
 *   - Wallets: tracked whale wallets
 *   - History: trade log with P&L
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Platform as RNPlatform,
} from 'react-native';
import { LoadingScreen } from './LoadingWave';
import { supabase } from '../lib/supabase';
import { PIXEL_COLORS, GRID, PX } from '../lib/pixelDesign';
import {
  createUserHeliusClient,
  HeliusClient,
  type PortfolioSnapshot,
  type TokenBalance,
  type DCAConfig,
  type TradeAlert,
  type SwapQuoteResult,
  type PendingTradeAction,
  type FeaturedTrade,
  type Position,
  type TokenRiskScore,
  type TechnicalAnalysis,
  getUserDCAConfigs,
  getUserAlerts,
  getTrackedWallets,
  getPendingActions,
  approveAction,
  rejectAction,
  markActionExecuted,
  markActionFailed,
  saveDCAConfig,
  saveTradeAlert,
  trackWallet,
  logTrade,
  getFeaturedTrades,
  generateFeaturedTrades,
  executeFeaturedTrade,
  getFeaturedTradeStats,
  getOpenPositions,
  closePosition,
  checkPositionStops,
  scoreTokenRisk,
  calculateTechnicalSignals,
  getPortfolioAllocation,
  expirePendingActions,
  SOL_MINT,
  USDC_MINT,
  SOLANA_TOKEN_REGISTRY,
} from '../lib/heliusTrading';

const ACCENT = '#6366f1';
type Tab = 'featured' | 'pending' | 'positions' | 'signals' | 'portfolio' | 'trade' | 'dca' | 'alerts' | 'wallets' | 'history';

const ALL_TABS: { key: Tab; label: string; icon: string; color: string }[] = [
  { key: 'portfolio', label: 'Portfolio',  icon: '$',  color: '#22c55e' },
  { key: 'trade',     label: 'Trade',      icon: '<>', color: '#3b82f6' },
  { key: 'positions', label: 'Positions',  icon: '[]', color: '#a855f7' },
  { key: 'signals',   label: 'Signals',    icon: '//', color: '#22d3ee' },
  { key: 'featured',  label: 'Ideas',      icon: '*',  color: '#f59e0b' },
  { key: 'dca',       label: 'DCA',        icon: '~',  color: '#6366f1' },
  { key: 'alerts',    label: 'Alerts',     icon: '!',  color: '#ef4444' },
  { key: 'pending',   label: 'Queue',      icon: '..',  color: '#f97316' },
  { key: 'wallets',   label: 'Watch',      icon: '@',  color: '#ec4899' },
  { key: 'history',   label: 'Log',        icon: '#',  color: '#9e9e9e' },
];

interface Props {
  circleId: string;
  userId: string;
  accentColor?: string;
}

export default function TradingBotPanel({ circleId, userId, accentColor = ACCENT }: Props) {
  const [tab, setTab] = useState<Tab>('portfolio');
  const [client, setClient] = useState<HeliusClient | null>(null);
  const [loading, setLoading] = useState(true);
  const [noKey, setNoKey] = useState(false);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [badges, setBadges] = useState<Partial<Record<Tab, number>>>({});

  useEffect(() => {
    init();
  }, [userId]);

  const init = async () => {
    setLoading(true);
    try {
      const c = await createUserHeliusClient(userId);
      if (!c) { setNoKey(true); setLoading(false); return; }
      setClient(c);

      // Parallel: fetch wallet + badge counts
      const countSafe = async (q: any): Promise<number> => {
        try { const r = await q; return r.count || 0; } catch { return 0; }
      };
      const [profileRes, pendingCount, positionCount, alertCount] = await Promise.all([
        supabase.from('profiles').select('wallet_address, wallet_address_sol').eq('id', userId).single(),
        countSafe(supabase.from('trading_pending_actions').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'pending')),
        countSafe(supabase.from('trading_positions').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'open')),
        countSafe(supabase.from('trading_alerts').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('is_active', true)),
      ]);

      const addr = profileRes.data?.wallet_address_sol || profileRes.data?.wallet_address || null;
      if (addr) setWalletAddress(addr);

      const b: Partial<Record<Tab, number>> = {};
      if (pendingCount > 0) b.pending = pendingCount as number;
      if (positionCount > 0) b.positions = positionCount as number;
      if (alertCount > 0) b.alerts = alertCount as number;
      setBadges(b);
    } catch {}
    setLoading(false);
  };

  if (loading) {
    return <LoadingScreen />;
  }

  if (noKey) {
    return (
      <View style={s.center}>
        <Text style={s.emptyIcon}>◎</Text>
        <Text style={s.emptyTitle}>Helius Not Connected</Text>
        <Text style={s.emptyDesc}>
          Add your Helius API key in Integrations to enable the trading bot.
        </Text>
      </View>
    );
  }

  const renderTab = (t: { key: Tab; label: string; icon: string; color: string }) => {
    const isActive = tab === t.key;
    const badge = badges[t.key];
    return (
      <Pressable
        key={t.key}
        onPress={() => setTab(t.key)}
        style={[s.tab, { borderColor: isActive ? t.color + '40' : PIXEL_COLORS.border1 }, isActive && { backgroundColor: t.color + '10' }]}
      >
        <View style={[s.tabIconWrap, { borderColor: t.color + (isActive ? '60' : '30'), backgroundColor: isActive ? t.color + '18' : PIXEL_COLORS.bg2 }]}>
          <Text style={[s.tabIconChar, { color: t.color }]}>{t.icon}</Text>
        </View>
        <Text style={[s.tabText, isActive && { color: PIXEL_COLORS.text0 }]}>{t.label}</Text>
        {badge != null && badge > 0 && (
          <View style={[s.tabBadge, isActive && { backgroundColor: t.color }]}>
            <Text style={s.tabBadgeText}>{badge}</Text>
          </View>
        )}
      </Pressable>
    );
  };

  return (
    <View style={s.container}>
      {/* Tab Bar */}
      <View style={s.tabBar}>
        <View style={s.tabRow}>
          {ALL_TABS.map(renderTab)}
        </View>
      </View>

      {/* Content */}
      <View style={s.content}>
        {tab === 'portfolio' && <PortfolioTab client={client!} walletAddress={walletAddress} userId={userId} />}
        {tab === 'trade' && <TradeTab client={client!} walletAddress={walletAddress} userId={userId} />}
        {tab === 'positions' && <PositionsTab client={client!} userId={userId} />}
        {tab === 'signals' && <SignalsTab client={client!} userId={userId} />}
        {tab === 'featured' && <FeaturedTab client={client!} walletAddress={walletAddress} userId={userId} />}
        {tab === 'dca' && <DCATab client={client!} userId={userId} />}
        {tab === 'alerts' && <AlertsTab client={client!} userId={userId} />}
        {tab === 'pending' && <PendingTab client={client!} walletAddress={walletAddress} userId={userId} />}
        {tab === 'wallets' && <WalletsTab client={client!} userId={userId} />}
        {tab === 'history' && <HistoryTab userId={userId} />}
      </View>
    </View>
  );
}

// ─── Featured Trades Tab ──────────────────────────────────────────────────────

function FeaturedTab({ client, walletAddress, userId }: { client: HeliusClient; walletAddress: string | null; userId: string }) {
  const [trades, setTrades] = useState<FeaturedTrade[]>([]);
  const [stats, setStats] = useState<{ totalGenerated: number; totalExecuted: number; wins: number; losses: number; avgReturnPct: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [executing, setExecuting] = useState<string | null>(null);

  useEffect(() => { loadData(); }, [userId]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [t, st] = await Promise.all([
        getFeaturedTrades(userId).catch(() => [] as FeaturedTrade[]),
        getFeaturedTradeStats(userId).catch(() => ({ totalGenerated: 0, totalExecuted: 0, wins: 0, losses: 0, avgReturnPct: 0 })),
      ]);
      setTrades(t);
      setStats(st);
    } catch {
      setTrades([]);
      setStats(null);
    }
    setLoading(false);
  };

  const handleGenerate = async () => {
    setGenerating(true);
    const result = await generateFeaturedTrades(userId);
    if (result.error) {
      alert(`Generation failed: ${result.error}`);
    } else {
      await loadData();
    }
    setGenerating(false);
  };

  const handleExecute = async (trade: FeaturedTrade) => {
    if (!walletAddress) return;
    setExecuting(trade.id);
    try {
      const amountLamports = Math.floor(trade.suggestedAmountSol * 1e9);
      const result = await client.executeSwap({
        inputMint: trade.inputMint,
        outputMint: trade.outputMint,
        amount: amountLamports,
        slippageBps: trade.suggestedSlippageBps,
        userPublicKey: walletAddress,
      });

      if (result.success && result.txHash) {
        await executeFeaturedTrade(trade.id, result.txHash, result.inputAmount, result.outputAmount);
        await logTrade({
          userId,
          walletAddress,
          action: 'swap',
          inputMint: trade.inputMint,
          outputMint: trade.outputMint,
          inputAmount: result.inputAmount,
          outputAmount: result.outputAmount,
          txHash: result.txHash,
          status: 'success',
          reason: `Featured: ${trade.title}`,
        });
        alert(`Trade executed! TX: ${result.txHash.slice(0, 16)}...`);
        setTrades(prev => prev.filter(t => t.id !== trade.id));
      } else {
        alert(`Trade failed: ${result.error || 'Unknown error'}`);
      }
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
    setExecuting(null);
  };

  if (loading) return <LoadingScreen />;

  const confidenceColors: Record<string, string> = { high: '#22c55e', medium: '#f59e0b', low: '#ef4444' };
  const riskColors: Record<string, string> = { low: '#22c55e', moderate: '#f59e0b', high: '#ef4444', extreme: '#6f6f6f' };
  const timeframeLabels: Record<string, string> = { scalp: '< 1h', day: '1-24h', swing: '2-7d', position: '1w+' };

  return (
    <ScrollView contentContainerStyle={s.scrollPad}>
      {/* Stats Bar */}
      {stats && stats.totalExecuted > 0 && (
        <View style={s.statsRow}>
          <View style={s.statCard}>
            <Text style={s.statValue}>{stats.totalExecuted}</Text>
            <Text style={s.statLabel}>Executed</Text>
          </View>
          <View style={s.statCard}>
            <Text style={[s.statValue, { color: '#22c55e' }]}>{stats.wins}</Text>
            <Text style={s.statLabel}>Wins</Text>
          </View>
          <View style={s.statCard}>
            <Text style={[s.statValue, { color: '#ef4444' }]}>{stats.losses}</Text>
            <Text style={s.statLabel}>Losses</Text>
          </View>
          <View style={s.statCard}>
            <Text style={[s.statValue, { color: stats.avgReturnPct >= 0 ? '#22c55e' : '#ef4444' }]}>
              {stats.avgReturnPct >= 0 ? '+' : ''}{stats.avgReturnPct.toFixed(1)}%
            </Text>
            <Text style={s.statLabel}>Avg Return</Text>
          </View>
        </View>
      )}

      {/* Header */}
      <View style={s.sectionHeader}>
        <View>
          <Text style={s.label}>TODAY'S FEATURED TRADES</Text>
          <Text style={[s.emptyDesc, { textAlign: 'left', fontSize: 11, marginBottom: 0 }]}>
            AI-generated ideas from Trader spirit + live research
          </Text>
        </View>
        <Pressable onPress={handleGenerate} disabled={generating} style={[s.addBtn, generating && { opacity: 0.5 }]}>
          {generating ? (
            <ActivityIndicator size="small" color={ACCENT} />
          ) : (
            <Text style={s.addText}>Generate</Text>
          )}
        </Pressable>
      </View>

      {/* Empty State */}
      {trades.length === 0 && !generating && (
        <View style={s.emptyCard}>
          <Text style={s.emptyTitle}>No Active Trades</Text>
          <Text style={s.emptyDesc}>
            Tap "Generate" to have the Trader spirit analyze markets and create trade ideas using live data from Gemini Search + Claude analysis.
          </Text>
        </View>
      )}

      {/* Trade Cards */}
      {trades.map(trade => {
        const confColor = confidenceColors[trade.confidence] || '#9e9e9e';
        const riskColor = riskColors[trade.riskLevel] || '#9e9e9e';
        const isExecuting = executing === trade.id;
        const hoursLeft = Math.max(0, Math.floor((new Date(trade.expiresAt).getTime() - Date.now()) / 3600000));

        return (
          <View key={trade.id} style={[s.listCard, { borderColor: confColor + '30' }]}>
            {/* Title + Direction */}
            <View style={s.listTop}>
              <View style={{ flex: 1 }}>
                <Text style={s.listTitle}>{trade.title}</Text>
              </View>
              <View style={[s.statusPill, { borderColor: confColor + '40', backgroundColor: confColor + '10' }]}>
                <Text style={[s.statusPillText, { color: confColor }]}>
                  {trade.confidence.toUpperCase()}
                </Text>
              </View>
            </View>

            {/* Tags row */}
            <View style={s.featuredTagRow}>
              <View style={[s.featuredTag, { borderColor: trade.direction === 'buy' ? '#22c55e30' : '#ef444430' }]}>
                <Text style={[s.featuredTagText, { color: trade.direction === 'buy' ? '#22c55e' : '#ef4444' }]}>
                  {trade.direction === 'buy' ? 'BUY' : 'SELL'}
                </Text>
              </View>
              <View style={[s.featuredTag, { borderColor: '#ffffff15' }]}>
                <Text style={s.featuredTagText}>{trade.inputSymbol} → {trade.outputSymbol}</Text>
              </View>
              <View style={[s.featuredTag, { borderColor: '#ffffff15' }]}>
                <Text style={s.featuredTagText}>{timeframeLabels[trade.timeframe] || trade.timeframe}</Text>
              </View>
              <View style={[s.featuredTag, { borderColor: riskColor + '40' }]}>
                <Text style={[s.featuredTagText, { color: riskColor }]}>{trade.riskLevel}</Text>
              </View>
            </View>

            {/* Description */}
            <Text style={s.featuredDesc}>{trade.description}</Text>

            {/* Details grid */}
            <View style={s.pendingDetails}>
              <View style={s.pendingRow}>
                <Text style={s.pendingLabel}>Amount</Text>
                <Text style={s.pendingValue}>{trade.suggestedAmountSol} SOL</Text>
              </View>
              {trade.expectedReturnPct != null && (
                <View style={s.pendingRow}>
                  <Text style={s.pendingLabel}>Expected Return</Text>
                  <Text style={[s.pendingValue, { color: '#22c55e' }]}>+{trade.expectedReturnPct.toFixed(1)}%</Text>
                </View>
              )}
              {trade.stopLossPct != null && (
                <View style={s.pendingRow}>
                  <Text style={s.pendingLabel}>Stop Loss</Text>
                  <Text style={[s.pendingValue, { color: '#ef4444' }]}>-{trade.stopLossPct.toFixed(1)}%</Text>
                </View>
              )}
              <View style={s.pendingRow}>
                <Text style={s.pendingLabel}>Expires</Text>
                <Text style={s.pendingValue}>{hoursLeft}h</Text>
              </View>
            </View>

            {/* Entry reasoning */}
            {trade.entryReasoning && (
              <View style={s.reasonBox}>
                <Text style={[s.reasonText, { color: '#9e9e9e' }]}>{trade.entryReasoning}</Text>
              </View>
            )}

            {/* Exit strategy */}
            {trade.exitStrategy && (
              <View style={[s.reasonBox, { borderColor: '#ffffff08', backgroundColor: '#ffffff03' }]}>
                <Text style={[s.reasonText, { color: '#9e9e9e' }]}>Exit: {trade.exitStrategy}</Text>
              </View>
            )}

            {/* Execute button */}
            <Pressable
              onPress={() => handleExecute(trade)}
              disabled={!walletAddress || isExecuting}
              style={[s.actionBtn, { backgroundColor: trade.direction === 'buy' ? '#22c55e' : '#ef4444', marginTop: 8 }]}
            >
              {isExecuting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={[s.actionText, { color: '#e8e8e8' }]}>
                  {walletAddress ? `Execute ${trade.direction === 'buy' ? 'Buy' : 'Sell'} — ${trade.suggestedAmountSol} SOL` : 'Link Wallet First'}
                </Text>
              )}
            </Pressable>

            {/* Meta */}
            <Text style={s.listTime}>
              Generated by {trade.generatedBy} • {new Date(trade.createdAt).toLocaleString()}
            </Text>
          </View>
        );
      })}

      <Pressable onPress={loadData} style={s.refreshBtn}>
        <Text style={s.refreshText}>Refresh</Text>
      </Pressable>
    </ScrollView>
  );
}

// ─── Pending Actions Tab ──────────────────────────────────────────────────────

function PendingTab({ client, walletAddress, userId }: { client: HeliusClient; walletAddress: string | null; userId: string }) {
  const [actions, setActions] = useState<PendingTradeAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState<string | null>(null);

  useEffect(() => { loadActions(); }, [userId]);

  const loadActions = async () => {
    setLoading(true);
    try {
      const data = await getPendingActions(userId);
      setActions(data);
    } catch { setActions([]); }
    setLoading(false);
  };

  const handleReject = async (id: string) => {
    await rejectAction(id);
    setActions(prev => prev.filter(a => a.id !== id));
  };

  const handleExecute = async (action: PendingTradeAction) => {
    if (!walletAddress) return;
    setExecuting(action.id);
    try {
      // Approve first
      await approveAction(action.id);

      // Execute swap via Jupiter + Phantom
      console.log('[handleExecute] Starting swap...', { inputMint: action.inputMint, outputMint: action.outputMint, amount: action.amountLamports });
      const result = await client.executeSwap({
        inputMint: action.inputMint,
        outputMint: action.outputMint,
        amount: action.amountLamports,
        slippageBps: action.slippageBps,
        userPublicKey: walletAddress,
      });
      console.log('[handleExecute] Swap result:', JSON.stringify(result));

      if (result.success && result.txHash) {
        await markActionExecuted(action.id, result.txHash, result.outputAmount);
        await logTrade({
          userId,
          walletAddress,
          action: action.actionType as any,
          inputMint: action.inputMint,
          outputMint: action.outputMint,
          inputAmount: result.inputAmount,
          outputAmount: result.outputAmount,
          txHash: result.txHash,
          status: 'success',
          reason: action.reason || undefined,
        });
        alert(`Trade successful! TX: ${result.txHash.slice(0, 16)}...`);
        setActions(prev => prev.filter(a => a.id !== action.id));
      } else {
        await markActionFailed(action.id, result.error || 'Swap failed');
        alert(`Trade failed: ${result.error || 'Unknown error'}`);
        setActions(prev => prev.map(a => a.id === action.id ? { ...a, status: 'failed' as const, error: result.error } : a));
      }
    } catch (err: any) {
      await markActionFailed(action.id, err.message);
      setActions(prev => prev.map(a => a.id === action.id ? { ...a, status: 'failed' as const, error: err.message } : a));
    }
    setExecuting(null);
  };

  if (loading) return <LoadingScreen />;

  const pendingActions = actions.filter(a => a.status === 'pending');

  return (
    <ScrollView contentContainerStyle={s.scrollPad}>
      <Text style={s.label}>PENDING TRADE ACTIONS</Text>
      <Text style={[s.emptyDesc, { textAlign: 'left', marginBottom: 16 }]}>
        Automations propose trades here. Review and approve to execute via Phantom.
      </Text>

      {pendingActions.length === 0 && (
        <View style={s.emptyCard}>
          <Text style={s.emptyTitle}>No Pending Actions</Text>
          <Text style={s.emptyDesc}>
            When trading automations (DCA Bot, Price Alerts) detect opportunities, they'll queue trades here for your approval.
          </Text>
        </View>
      )}

      {pendingActions.map(action => {
        const isExpired = new Date(action.expiresAt) < new Date();
        const amountSol = (action.amountLamports / 1e9).toFixed(4);

        return (
          <View key={action.id} style={[s.listCard, { borderColor: isExpired ? '#6f6f6f' : ACCENT + '30' }]}>
            {/* Header */}
            <View style={s.listTop}>
              <View style={{ flex: 1 }}>
                <Text style={s.listTitle}>
                  {action.actionType.toUpperCase().replace('_', ' ')}
                </Text>
                <Text style={[s.listMeta, { marginTop: 2 }]}>
                  Proposed by {action.proposedBy} via {action.source}
                </Text>
              </View>
              {isExpired && (
                <View style={[s.statusPill, { borderColor: '#ffffff15', backgroundColor: '#ffffff05' }]}>
                  <Text style={[s.statusPillText, { color: '#9e9e9e' }]}>Expired</Text>
                </View>
              )}
            </View>

            {/* Details */}
            <View style={s.pendingDetails}>
              <View style={s.pendingRow}>
                <Text style={s.pendingLabel}>Amount</Text>
                <Text style={s.pendingValue}>{amountSol} SOL</Text>
              </View>
              <View style={s.pendingRow}>
                <Text style={s.pendingLabel}>Token</Text>
                <Text style={s.pendingValue}>{action.outputMint.slice(0, 8)}...{action.outputMint.slice(-4)}</Text>
              </View>
              <View style={s.pendingRow}>
                <Text style={s.pendingLabel}>Slippage</Text>
                <Text style={s.pendingValue}>{(action.slippageBps / 100).toFixed(1)}%</Text>
              </View>
              {action.maxPrice && (
                <View style={s.pendingRow}>
                  <Text style={s.pendingLabel}>Max Price</Text>
                  <Text style={s.pendingValue}>${action.maxPrice}</Text>
                </View>
              )}
            </View>

            {/* Reason */}
            {action.reason && (
              <View style={s.reasonBox}>
                <Text style={s.reasonText}>{action.reason}</Text>
              </View>
            )}

            {/* Error */}
            {action.error && (
              <View style={[s.reasonBox, { borderColor: '#ffffff15' }]}>
                <Text style={[s.reasonText, { color: '#9e9e9e' }]}>{action.error}</Text>
              </View>
            )}

            {/* Actions */}
            {!isExpired && action.status === 'pending' && (
              <View style={s.pendingBtnRow}>
                <Pressable onPress={() => handleReject(action.id)} style={[s.pendingBtn, s.pendingBtnReject]}>
                  <Text style={[s.pendingBtnText, { color: '#ef4444' }]}>Reject</Text>
                </Pressable>
                <Pressable
                  onPress={() => handleExecute(action)}
                  disabled={!walletAddress || executing === action.id}
                  style={[s.pendingBtn, s.pendingBtnApprove]}
                >
                  {executing === action.id ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={[s.pendingBtnText, { color: '#e8e8e8' }]}>
                      {walletAddress ? 'Approve & Execute' : 'Link Wallet First'}
                    </Text>
                  )}
                </Pressable>
              </View>
            )}

            <Text style={s.listTime}>{new Date(action.createdAt).toLocaleString()}</Text>
          </View>
        );
      })}

      <Pressable onPress={loadActions} style={s.refreshBtn}>
        <Text style={s.refreshText}>Refresh</Text>
      </Pressable>
    </ScrollView>
  );
}

// ─── Portfolio Tab ────────────────────────────────────────────────────────────

function PortfolioTab({ client, walletAddress, userId }: { client: HeliusClient; walletAddress: string | null; userId: string }) {
  const [portfolio, setPortfolio] = useState<PortfolioSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (walletAddress) loadPortfolio();
    else setLoading(false);
  }, [walletAddress]);

  const loadPortfolio = async () => {
    setLoading(true);
    try {
      const snap = await client.getPortfolio(walletAddress!);
      setPortfolio(snap);
    } catch {}
    setLoading(false);
  };

  if (!walletAddress) {
    return (
      <View style={s.center}>
        <Text style={s.emptyTitle}>No Wallet Linked</Text>
        <Text style={s.emptyDesc}>Link your Phantom wallet in Integrations {'>'} Helius to see your portfolio.</Text>
      </View>
    );
  }

  if (loading) return <LoadingScreen />;
  if (!portfolio) return <View style={s.center}><Text style={s.emptyDesc}>Failed to load portfolio</Text></View>;

  return (
    <ScrollView contentContainerStyle={s.scrollPad}>
      {/* Summary Cards */}
      <View style={s.statsRow}>
        <View style={s.statCard}>
          <Text style={s.statValue}>${portfolio.totalValueUsd.toFixed(2)}</Text>
          <Text style={s.statLabel}>Total Value</Text>
        </View>
        <View style={s.statCard}>
          <Text style={s.statValue}>{portfolio.solBalance.toFixed(4)}</Text>
          <Text style={s.statLabel}>SOL</Text>
        </View>
        <View style={s.statCard}>
          <Text style={s.statValue}>{portfolio.tokens.length}</Text>
          <Text style={s.statLabel}>Tokens</Text>
        </View>
      </View>

      {/* Wallet */}
      <Text style={s.label}>WALLET</Text>
      <View style={s.infoRow}>
        <Text style={s.mono}>{walletAddress.slice(0, 8)}...{walletAddress.slice(-6)}</Text>
      </View>

      {/* Token List */}
      <Text style={[s.label, { marginTop: 16 }]}>HOLDINGS</Text>
      {portfolio.tokens.filter(t => t.amount > 0).sort((a, b) => b.usdValue - a.usdValue).map(token => (
        <View key={token.mint} style={s.tokenRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.tokenSymbol}>{token.symbol}</Text>
            <Text style={s.tokenName}>{token.name}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={s.tokenAmount}>{token.amount < 0.0001 ? '<0.0001' : token.amount.toFixed(4)}</Text>
            {token.usdValue > 0 && <Text style={s.tokenUsd}>${token.usdValue.toFixed(2)}</Text>}
          </View>
        </View>
      ))}

      <Pressable onPress={loadPortfolio} style={s.refreshBtn}>
        <Text style={s.refreshText}>Refresh Portfolio</Text>
      </Pressable>
    </ScrollView>
  );
}

// ─── Trade Tab (Manual Swap) ──────────────────────────────────────────────────

function TradeTab({ client, walletAddress, userId }: { client: HeliusClient; walletAddress: string | null; userId: string }) {
  const [inputMint, setInputMint] = useState(SOL_MINT);
  const [outputMint, setOutputMint] = useState(USDC_MINT);
  const [amount, setAmount] = useState('');
  const [quote, setQuote] = useState<SwapQuoteResult | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const handleQuote = async () => {
    if (!amount || !walletAddress) return;
    setQuoting(true);
    setQuote(null);
    setResult(null);
    try {
      const q = await client.getSwapQuote({
        inputMint,
        outputMint,
        amount: Math.floor(parseFloat(amount) * 1e9), // SOL to lamports
        userPublicKey: walletAddress,
      });
      setQuote(q);
    } catch (err: any) {
      setResult({ ok: false, msg: err.message });
    }
    setQuoting(false);
  };

  const handleSwap = async () => {
    if (!quote || !walletAddress) return;
    setSwapping(true);
    try {
      const res = await client.executeSwap({
        inputMint,
        outputMint,
        amount: Math.floor(parseFloat(amount) * 1e9),
        userPublicKey: walletAddress,
      });

      if (res.success) {
        await logTrade({
          userId, walletAddress,
          action: 'swap',
          inputMint, outputMint,
          inputAmount: res.inputAmount,
          outputAmount: res.outputAmount,
          txHash: res.txHash,
          status: 'success',
        });
        setResult({ ok: true, msg: `Swap successful! TX: ${res.txHash?.slice(0, 12)}...` });
      } else {
        setResult({ ok: false, msg: res.error || 'Swap failed' });
      }
    } catch (err: any) {
      setResult({ ok: false, msg: err.message });
    }
    setSwapping(false);
  };

  if (!walletAddress) {
    return (
      <View style={s.center}>
        <Text style={s.emptyTitle}>Connect Wallet to Trade</Text>
        <Text style={s.emptyDesc}>Link your Phantom wallet in Integrations to execute swaps.</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={s.scrollPad}>
      <Text style={s.label}>SWAP</Text>

      {/* From */}
      <View style={s.fieldGroup}>
        <Text style={s.fieldLabel}>From (mint)</Text>
        <TextInput
          style={s.input}
          value={inputMint}
          onChangeText={setInputMint}
          placeholder="Input token mint..."
          placeholderTextColor="#555"
        />
      </View>

      {/* To */}
      <View style={s.fieldGroup}>
        <Text style={s.fieldLabel}>To (mint)</Text>
        <TextInput
          style={s.input}
          value={outputMint}
          onChangeText={setOutputMint}
          placeholder="Output token mint..."
          placeholderTextColor="#555"
        />
      </View>

      {/* Amount */}
      <View style={s.fieldGroup}>
        <Text style={s.fieldLabel}>Amount (SOL)</Text>
        <TextInput
          style={s.input}
          value={amount}
          onChangeText={setAmount}
          placeholder="0.0"
          placeholderTextColor="#555"
          keyboardType="decimal-pad"
        />
      </View>

      {/* Quick amounts */}
      <View style={s.quickRow}>
        {['0.1', '0.5', '1.0', '5.0'].map(v => (
          <Pressable key={v} onPress={() => setAmount(v)} style={s.quickBtn}>
            <Text style={s.quickText}>{v} SOL</Text>
          </Pressable>
        ))}
      </View>

      {/* Quote */}
      <Pressable onPress={handleQuote} disabled={quoting || !amount} style={[s.actionBtn, { backgroundColor: ACCENT + '20' }]}>
        {quoting ? <ActivityIndicator size="small" color={ACCENT} /> :
          <Text style={[s.actionText, { color: ACCENT }]}>Get Quote</Text>}
      </Pressable>

      {quote && (
        <View style={s.quoteCard}>
          <Text style={s.quoteTitle}>Quote</Text>
          <View style={s.quoteRow}>
            <Text style={s.quoteLabel}>You send</Text>
            <Text style={s.quoteValue}>{(parseInt(quote.inAmount) / 1e9).toFixed(6)} SOL</Text>
          </View>
          <View style={s.quoteRow}>
            <Text style={s.quoteLabel}>You receive</Text>
            <Text style={s.quoteValue}>{(parseInt(quote.outAmount) / 1e6).toFixed(4)}</Text>
          </View>
          <View style={s.quoteRow}>
            <Text style={s.quoteLabel}>Price impact</Text>
            <Text style={[s.quoteValue, quote.priceImpactPct > 1 && { color: '#ef4444' }]}>
              {quote.priceImpactPct.toFixed(3)}%
            </Text>
          </View>
          <View style={s.quoteRow}>
            <Text style={s.quoteLabel}>Route</Text>
            <Text style={s.quoteValue}>
              {quote.routePlan?.map(r => r.swapInfo.label).join(' > ') || 'Direct'}
            </Text>
          </View>

          <Pressable onPress={handleSwap} disabled={swapping} style={[s.actionBtn, { backgroundColor: '#22c55e', marginTop: 12 }]}>
            {swapping ? <ActivityIndicator size="small" color="#fff" /> :
              <Text style={[s.actionText, { color: '#e8e8e8' }]}>Execute Swap</Text>}
          </Pressable>
        </View>
      )}

      {result && (
        <View style={[s.resultBanner, { borderColor: result.ok ? '#22c55e30' : '#ef444430' }]}>
          <Text style={[s.resultText, { color: result.ok ? '#22c55e' : '#ef4444' }]}>{result.msg}</Text>
        </View>
      )}
    </ScrollView>
  );
}

// ─── DCA Tab ──────────────────────────────────────────────────────────────────

function DCATab({ client, userId }: { client: HeliusClient; userId: string }) {
  const [configs, setConfigs] = useState<DCAConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [outputMint, setOutputMint] = useState('');
  const [amountSol, setAmountSol] = useState('0.1');
  const [intervalHrs, setIntervalHrs] = useState('24');
  const [maxPrice, setMaxPrice] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadConfigs(); }, [userId]);

  const loadConfigs = async () => {
    setLoading(true);
    try {
      const data = await getUserDCAConfigs(userId);
      setConfigs(data);
    } catch { setConfigs([]); }
    setLoading(false);
  };

  const handleCreate = async () => {
    if (!outputMint.trim()) return;
    setSaving(true);
    await saveDCAConfig({
      userId,
      inputMint: SOL_MINT,
      outputMint: outputMint.trim(),
      amountPerInterval: Math.floor(parseFloat(amountSol) * 1e9),
      intervalHours: parseInt(intervalHrs) || 24,
      maxPrice: maxPrice ? parseFloat(maxPrice) : undefined,
      isActive: true,
    });
    setShowForm(false);
    setOutputMint('');
    await loadConfigs();
    setSaving(false);
  };

  if (loading) return <LoadingScreen />;

  return (
    <ScrollView contentContainerStyle={s.scrollPad}>
      <View style={s.sectionHeader}>
        <Text style={s.label}>DCA STRATEGIES</Text>
        <Pressable onPress={() => setShowForm(!showForm)} style={s.addBtn}>
          <Text style={s.addText}>{showForm ? 'Cancel' : '+ New'}</Text>
        </Pressable>
      </View>

      {showForm && (
        <View style={s.formCard}>
          <View style={s.fieldGroup}>
            <Text style={s.fieldLabel}>Target Token Mint</Text>
            <TextInput style={s.input} value={outputMint} onChangeText={setOutputMint} placeholder="Token mint address..." placeholderTextColor="#555" />
          </View>
          <View style={s.fieldGroup}>
            <Text style={s.fieldLabel}>Amount per buy (SOL)</Text>
            <TextInput style={s.input} value={amountSol} onChangeText={setAmountSol} keyboardType="decimal-pad" placeholderTextColor="#555" />
          </View>
          <View style={s.fieldGroup}>
            <Text style={s.fieldLabel}>Interval (hours)</Text>
            <TextInput style={s.input} value={intervalHrs} onChangeText={setIntervalHrs} keyboardType="number-pad" placeholderTextColor="#555" />
          </View>
          <View style={s.fieldGroup}>
            <Text style={s.fieldLabel}>Max price (optional)</Text>
            <TextInput style={s.input} value={maxPrice} onChangeText={setMaxPrice} placeholder="Skip if above this price" placeholderTextColor="#555" keyboardType="decimal-pad" />
          </View>
          <Pressable onPress={handleCreate} disabled={saving} style={[s.actionBtn, { backgroundColor: ACCENT }]}>
            {saving ? <ActivityIndicator size="small" color="#fff" /> :
              <Text style={[s.actionText, { color: '#e8e8e8' }]}>Create DCA</Text>}
          </Pressable>
        </View>
      )}

      {configs.length === 0 && !showForm && (
        <Text style={s.emptyDesc}>No DCA strategies configured. Tap + New to create one.</Text>
      )}

      {configs.map(c => (
        <View key={c.id} style={s.listCard}>
          <View style={s.listTop}>
            <Text style={s.listTitle}>{c.outputMint.slice(0, 8)}...</Text>
            <View style={[s.statusPill, c.isActive && s.statusPillActive]}>
              <Text style={[s.statusPillText, c.isActive && { color: '#22c55e' }]}>
                {c.isActive ? 'Active' : 'Paused'}
              </Text>
            </View>
          </View>
          <Text style={s.listMeta}>
            {(c.amountPerInterval / 1e9).toFixed(4)} SOL every {c.intervalHours}h
            {c.maxPrice ? ` | max $${c.maxPrice}` : ''}
          </Text>
          <Text style={s.listMeta}>
            Executed {c.totalExecuted}x | Spent {(c.totalSpent).toFixed(4)} SOL
          </Text>
        </View>
      ))}
    </ScrollView>
  );
}

// ─── Alerts Tab ───────────────────────────────────────────────────────────────

function AlertsTab({ client, userId }: { client: HeliusClient; userId: string }) {
  const [alerts, setAlerts] = useState<TradeAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [tokenMint, setTokenMint] = useState('');
  const [tokenSymbol, setTokenSymbol] = useState('');
  const [alertType, setAlertType] = useState<'price_above' | 'price_below'>('price_above');
  const [targetValue, setTargetValue] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadAlerts(); }, [userId]);

  const loadAlerts = async () => {
    setLoading(true);
    try {
      const data = await getUserAlerts(userId);
      setAlerts(data);
    } catch { setAlerts([]); }
    setLoading(false);
  };

  const handleCreate = async () => {
    if (!tokenMint.trim() || !targetValue) return;
    setSaving(true);
    await saveTradeAlert({
      userId,
      tokenMint: tokenMint.trim(),
      tokenSymbol: tokenSymbol || tokenMint.slice(0, 6),
      alertType,
      targetValue: parseFloat(targetValue),
    });
    setShowForm(false);
    setTokenMint('');
    setTokenSymbol('');
    setTargetValue('');
    await loadAlerts();
    setSaving(false);
  };

  if (loading) return <LoadingScreen />;

  return (
    <ScrollView contentContainerStyle={s.scrollPad}>
      <View style={s.sectionHeader}>
        <Text style={s.label}>PRICE ALERTS</Text>
        <Pressable onPress={() => setShowForm(!showForm)} style={s.addBtn}>
          <Text style={s.addText}>{showForm ? 'Cancel' : '+ New'}</Text>
        </Pressable>
      </View>

      {showForm && (
        <View style={s.formCard}>
          <View style={s.fieldGroup}>
            <Text style={s.fieldLabel}>Token Mint</Text>
            <TextInput style={s.input} value={tokenMint} onChangeText={setTokenMint} placeholder="Token mint address..." placeholderTextColor="#555" />
          </View>
          <View style={s.fieldGroup}>
            <Text style={s.fieldLabel}>Symbol (optional)</Text>
            <TextInput style={s.input} value={tokenSymbol} onChangeText={setTokenSymbol} placeholder="SOL, BONK..." placeholderTextColor="#555" />
          </View>
          <View style={s.fieldGroup}>
            <Text style={s.fieldLabel}>Alert Type</Text>
            <View style={s.toggleRow}>
              <Pressable
                onPress={() => setAlertType('price_above')}
                style={[s.toggleBtn, alertType === 'price_above' && { backgroundColor: '#22c55e10', borderColor: '#22c55e40' }]}
              >
                <Text style={[s.toggleText, alertType === 'price_above' && { color: '#22c55e' }]}>Above</Text>
              </Pressable>
              <Pressable
                onPress={() => setAlertType('price_below')}
                style={[s.toggleBtn, alertType === 'price_below' && { backgroundColor: '#ef444410', borderColor: '#ef444440' }]}
              >
                <Text style={[s.toggleText, alertType === 'price_below' && { color: '#ef4444' }]}>Below</Text>
              </Pressable>
            </View>
          </View>
          <View style={s.fieldGroup}>
            <Text style={s.fieldLabel}>Target Price ($)</Text>
            <TextInput style={s.input} value={targetValue} onChangeText={setTargetValue} placeholder="0.00" placeholderTextColor="#555" keyboardType="decimal-pad" />
          </View>
          <Pressable onPress={handleCreate} disabled={saving} style={[s.actionBtn, { backgroundColor: ACCENT }]}>
            {saving ? <ActivityIndicator size="small" color="#fff" /> :
              <Text style={[s.actionText, { color: '#e8e8e8' }]}>Create Alert</Text>}
          </Pressable>
        </View>
      )}

      {alerts.length === 0 && !showForm && (
        <Text style={s.emptyDesc}>No active alerts. Tap + New to create one.</Text>
      )}

      {alerts.map(a => (
        <View key={a.id} style={s.listCard}>
          <View style={s.listTop}>
            <Text style={s.listTitle}>{a.tokenSymbol}</Text>
            <Text style={[s.alertBadge, a.alertType === 'price_above' ? { color: '#22c55e' } : { color: '#ef4444' }]}>
              {a.alertType === 'price_above' ? 'Above' : 'Below'} ${a.targetValue.toFixed(4)}
            </Text>
          </View>
          <Text style={s.listMeta}>{a.tokenMint.slice(0, 12)}...</Text>
          {a.currentValue !== undefined && (
            <Text style={s.listMeta}>Current: ${a.currentValue.toFixed(4)}</Text>
          )}
        </View>
      ))}
    </ScrollView>
  );
}

// ─── Tracked Wallets Tab ──────────────────────────────────────────────────────

// Notable wallets — auto-displayed with live data
type WalletCategory = 'exchange' | 'market_maker' | 'whale' | 'trader' | 'political' | 'fund' | 'btc_whale';

interface NotableWallet {
  address: string;
  label: string;
  category: WalletCategory;
  chain: 'sol' | 'btc';
  description?: string;
}

const NOTABLE_WALLETS: NotableWallet[] = [
  // ── Solana Exchanges ──
  { address: '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9', label: 'Binance', category: 'exchange', chain: 'sol', description: 'Largest CEX hot wallet' },
  { address: 'GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE', label: 'Coinbase Hot 2', category: 'exchange', chain: 'sol' },
  { address: 'H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS', label: 'Coinbase', category: 'exchange', chain: 'sol' },
  { address: 'AC5RDfQFmDS1deWZos921JfqscXdByf8BKHs5ACWjtW2', label: 'Bybit', category: 'exchange', chain: 'sol' },
  { address: 'AobVSwdW9BbpMdJvTqeCN4hPAmh4rHm7vwLnQ5ATSyrS', label: 'Crypto.com', category: 'exchange', chain: 'sol' },
  // ── Solana Market Makers ──
  { address: '5sTQ5ih7xtctBhMXHr3f1aWdaXazWrWfoehqWdqWnTFP', label: 'Wintermute', category: 'market_maker', chain: 'sol', description: 'Primary trading wallet' },
  { address: 'MfDuWeqSHEqTFVYZ7LoexgAK9dxk7cy4DFJWjWMGVWa', label: 'Wintermute Bot', category: 'market_maker', chain: 'sol', description: 'Automated liquidity bot' },
  // ── Solana Whales ──
  { address: '52C9T2T7JRojtxumYnYZhyUmrN7kqzvCLc4Ksvjk7TxD', label: 'SOL Whale #1', category: 'whale', chain: 'sol', description: '~4.3M SOL (0.85% supply)' },
  { address: '8BseXT9EtoEhBTKFFYkwTnjKSUZwhtmdKY2Jrj8j45Rt', label: 'SOL Whale #2', category: 'whale', chain: 'sol', description: '~3.9M SOL (0.77% supply)' },
  // ── Solana Traders ──
  { address: 'AVAZvHLR2PcWpDf8BXY4rVxNHYRBytycHkcB5z5QNXYm', label: 'Ansem (@blknoiz06)', category: 'trader', chain: 'sol', description: 'Famous memecoin trader' },
  { address: '4Be9CvxqHW6BYiRAxW9Q3xu1ycTMWaL5z8NX4HR3ha7t', label: 'Smart Money Alpha', category: 'trader', chain: 'sol', description: 'Consistent 50x+ flips' },
  { address: '8zFZHuSRuDpuAR7J6FzwyF3vKNx4CVW3DFHJerQhc7Zd', label: 'Insider Signal', category: 'trader', chain: 'sol', description: 'Early entry pattern' },
  // ── Political ──
  { address: '6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN', label: '$TRUMP Token Mint', category: 'political', chain: 'sol', description: 'Official Trump memecoin' },
  // ── BTC Whales (view-only — no Helius data) ──
  { address: '34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo', label: 'Satoshi Nakamoto', category: 'btc_whale', chain: 'btc', description: '~1.1M BTC, genesis blocks' },
  { address: 'bc1qazcm763858nkj2dz7g4cx4k9wy2ualpzyczjmc', label: 'Binance Cold', category: 'btc_whale', chain: 'btc', description: '~248K BTC' },
  { address: 'bc1qm34lsc65zpw79lxes69zkqmk6ee3ewf0j77s3h', label: 'Bitfinex Cold', category: 'btc_whale', chain: 'btc', description: '~180K BTC' },
  { address: '3LYJfcfHPXYJreMsASht2PKsQGbBqbRLqM', label: 'US Gov (Silk Road)', category: 'btc_whale', chain: 'btc', description: 'Seized BTC — DOJ wallet' },
  { address: 'bc1qjasf9z3h7w3jspkhtgatgpyvvzgpa2wwd2lr0p5', label: 'MicroStrategy', category: 'btc_whale', chain: 'btc', description: '~500K+ BTC treasury' },
  { address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', label: 'Genesis Block', category: 'btc_whale', chain: 'btc', description: 'First-ever BTC block reward' },
  { address: 'bc1q4c8n5t00jmj8temxdgcc3t32nkg2wjwz24lywv', label: 'Grayscale GBTC', category: 'btc_whale', chain: 'btc', description: 'Largest BTC fund' },
  { address: '3M219KR5vEneNb47ewrPfWyb5jQ2DjxRP6', label: 'Mt. Gox Trustee', category: 'btc_whale', chain: 'btc', description: 'Creditor distribution' },
];

const CATEGORY_COLORS: Record<string, string> = {
  exchange: '#3b82f6',
  market_maker: '#22d3ee',
  whale: '#a855f7',
  trader: '#22c55e',
  political: '#ef4444',
  fund: '#f59e0b',
  btc_whale: '#f97316',
};

const CATEGORY_LABELS: Record<string, string> = {
  exchange: 'EXCHANGE',
  market_maker: 'MARKET MAKER',
  whale: 'SOL WHALE',
  trader: 'TRADER',
  political: 'POLITICAL',
  fund: 'FUND',
  btc_whale: 'BTC WHALE',
};

type WalletLiveData = { sol: number | null; usd: number | null; tokens: number | null; lastTx: string | null };

function WalletsTab({ client, userId }: { client: HeliusClient; userId: string }) {
  const [wallets, setWallets] = useState<Array<{ address: string; label: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [newAddr, setNewAddr] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [trackingAddr, setTrackingAddr] = useState<string | null>(null);
  const [liveData, setLiveData] = useState<Record<string, WalletLiveData>>({});
  const [loadingLive, setLoadingLive] = useState<Set<string>>(new Set());
  const [filterCat, setFilterCat] = useState<string | null>(null);

  useEffect(() => { loadWallets(); }, [userId]);

  const loadWallets = async () => {
    setLoading(true);
    try {
      const data = await getTrackedWallets(userId);
      setWallets(data);
    } catch { setWallets([]); }
    setLoading(false);
  };

  const handleAdd = async () => {
    if (!newAddr.trim()) return;
    setSaving(true);
    await trackWallet(userId, newAddr.trim(), newLabel || undefined);
    setShowForm(false);
    setNewAddr('');
    setNewLabel('');
    await loadWallets();
    setSaving(false);
  };

  const handleQuickTrack = async (addr: string, label: string) => {
    setTrackingAddr(addr);
    await trackWallet(userId, addr, label);
    await loadWallets();
    setTrackingAddr(null);
  };

  /** Fetch live SOL balance + token count + last tx for a Solana wallet */
  const fetchLiveData = useCallback(async (address: string) => {
    if (liveData[address] || loadingLive.has(address)) return;
    setLoadingLive(prev => new Set(prev).add(address));
    try {
      const [balLamports, tokenBalances, txHistory] = await Promise.all([
        client.getSolBalance(address),
        client.getTokenBalances(address).catch(() => []),
        client.getTransactionHistory(address, 1).catch(() => []),
      ]);
      const solBal = balLamports / 1e9;
      // Rough USD — use SOL price from token balances if available, else estimate
      const solToken = tokenBalances.find((t: TokenBalance) => t.mint === SOL_MINT);
      const solPrice = solToken?.usdValue && solToken.amount ? solToken.usdValue / solToken.amount : null;
      const usdVal = solPrice ? solBal * solPrice : null;
      const lastTxSig = txHistory.length > 0 ? (txHistory[0].signature || txHistory[0].txHash || null) : null;

      setLiveData(prev => ({
        ...prev,
        [address]: { sol: solBal, usd: usdVal, tokens: tokenBalances.length, lastTx: lastTxSig },
      }));
    } catch {
      setLiveData(prev => ({ ...prev, [address]: { sol: null, usd: null, tokens: null, lastTx: null } }));
    }
    setLoadingLive(prev => { const n = new Set(prev); n.delete(address); return n; });
  }, [client, liveData, loadingLive]);

  const trackedAddrs = new Set(wallets.map(w => w.address));

  const categories = [...new Set(NOTABLE_WALLETS.map(w => w.category))];
  const filteredNotable = filterCat ? NOTABLE_WALLETS.filter(w => w.category === filterCat) : NOTABLE_WALLETS;

  if (loading) return <LoadingScreen />;

  const formatSol = (n: number) => n >= 1000000 ? (n / 1000000).toFixed(2) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'K' : n.toFixed(2);
  const formatUsd = (n: number) => n >= 1000000000 ? '$' + (n / 1000000000).toFixed(2) + 'B' : n >= 1000000 ? '$' + (n / 1000000).toFixed(1) + 'M' : n >= 1000 ? '$' + (n / 1000).toFixed(1) + 'K' : '$' + n.toFixed(2);

  return (
    <ScrollView contentContainerStyle={s.scrollPad}>
      {/* Custom tracked wallets */}
      <View style={s.sectionHeader}>
        <Text style={s.label}>YOUR WALLETS</Text>
        <Pressable onPress={() => setShowForm(!showForm)} style={s.addBtn}>
          <Text style={s.addText}>{showForm ? 'Cancel' : '+ Add'}</Text>
        </Pressable>
      </View>

      {showForm && (
        <View style={s.formCard}>
          <View style={s.fieldGroup}>
            <Text style={s.fieldLabel}>Wallet Address</Text>
            <TextInput style={s.input} value={newAddr} onChangeText={setNewAddr} placeholder="Solana wallet address..." placeholderTextColor="#555" />
          </View>
          <View style={s.fieldGroup}>
            <Text style={s.fieldLabel}>Label (optional)</Text>
            <TextInput style={s.input} value={newLabel} onChangeText={setNewLabel} placeholder="Whale, Fund, etc." placeholderTextColor="#555" />
          </View>
          <Pressable onPress={handleAdd} disabled={saving} style={[s.actionBtn, { backgroundColor: ACCENT }]}>
            {saving ? <ActivityIndicator size="small" color="#fff" /> :
              <Text style={[s.actionText, { color: '#e8e8e8' }]}>Track Wallet</Text>}
          </Pressable>
        </View>
      )}

      {wallets.length === 0 && !showForm && (
        <View style={s.emptyCard}>
          <Text style={s.emptyDesc}>No custom wallets. Add your own above or explore notable wallets below.</Text>
        </View>
      )}

      {wallets.map(w => {
        const live = liveData[w.address];
        const isLiveLoading = loadingLive.has(w.address);
        return (
          <View key={w.address} style={s.listCard}>
            <View style={s.listTop}>
              <View style={{ flex: 1 }}>
                <Text style={s.listTitle}>{w.label}</Text>
                <Text style={s.listMeta}>{w.address.slice(0, 14)}...{w.address.slice(-6)}</Text>
              </View>
              <Pressable onPress={() => fetchLiveData(w.address)} style={[s.addBtn, { borderColor: ACCENT + '40' }]}>
                {isLiveLoading ? <ActivityIndicator size="small" color={ACCENT} /> :
                  <Text style={[s.addText, { color: ACCENT }]}>{live ? 'Refresh' : 'Load'}</Text>}
              </Pressable>
            </View>
            {live && live.sol !== null && (
              <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>
                <Text style={s.statValue}>{formatSol(live.sol)} SOL</Text>
                {live.usd !== null && <Text style={[s.statLabel, { marginTop: 0 }]}>{formatUsd(live.usd)}</Text>}
                {live.tokens !== null && <Text style={[s.statLabel, { marginTop: 0 }]}>{live.tokens} tokens</Text>}
              </View>
            )}
          </View>
        );
      })}

      {/* Notable wallets — always visible */}
      <View style={[s.sectionHeader, { marginTop: 20 }]}>
        <Text style={s.label}>WHALE DIRECTORY</Text>
      </View>

      {/* Category filter pills */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <Pressable onPress={() => setFilterCat(null)} style={[s.quickBtn, !filterCat && { borderColor: ACCENT, backgroundColor: ACCENT + '15' }]}>
            <Text style={[s.quickText, !filterCat && { color: ACCENT }]}>ALL</Text>
          </Pressable>
          {categories.map(cat => {
            const c = CATEGORY_COLORS[cat] || '#6f6f6f';
            const active = filterCat === cat;
            return (
              <Pressable key={cat} onPress={() => setFilterCat(active ? null : cat)} style={[s.quickBtn, active && { borderColor: c, backgroundColor: c + '15' }]}>
                <Text style={[s.quickText, active && { color: c }]}>{CATEGORY_LABELS[cat]}</Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      {filteredNotable.map(nw => {
        const isTracked = trackedAddrs.has(nw.address);
        const isTrackLoading = trackingAddr === nw.address;
        const catColor = CATEGORY_COLORS[nw.category] || '#6f6f6f';
        const isSol = nw.chain === 'sol';
        const live = liveData[nw.address];
        const isLiveLoading = loadingLive.has(nw.address);

        return (
          <View key={nw.address} style={[s.listCard, { borderColor: catColor + '20' }]}>
            <View style={s.listTop}>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <Text style={s.listTitle}>{nw.label}</Text>
                  <View style={[s.statusPill, { borderColor: catColor + '40', backgroundColor: catColor + '08' }]}>
                    <Text style={[s.statusPillText, { color: catColor }]}>{CATEGORY_LABELS[nw.category]}</Text>
                  </View>
                  <View style={[s.statusPill, { borderColor: '#ffffff15', backgroundColor: '#ffffff05' }]}>
                    <Text style={[s.statusPillText, { color: '#9e9e9e' }]}>{nw.chain.toUpperCase()}</Text>
                  </View>
                </View>
                {nw.description && <Text style={[s.listMeta, { color: '#9e9e9e' }]}>{nw.description}</Text>}
                <Text style={s.listMeta}>{nw.address.slice(0, 16)}...{nw.address.slice(-6)}</Text>
              </View>
            </View>

            {/* Live data row for SOL wallets */}
            {isSol && live && live.sol !== null && (
              <View style={{ flexDirection: 'row', gap: 12, marginTop: 8, alignItems: 'center' }}>
                <Text style={[s.tokenSymbol, { fontSize: 12 }]}>{formatSol(live.sol)} SOL</Text>
                {live.usd !== null && <Text style={s.listMeta}>{formatUsd(live.usd)}</Text>}
                {live.tokens !== null && <Text style={s.listMeta}>{live.tokens} tokens</Text>}
              </View>
            )}

            {/* Action buttons */}
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
              {isSol && (
                <Pressable onPress={() => fetchLiveData(nw.address)} style={[s.quickBtn, { flex: 1, alignItems: 'center' }]}>
                  {isLiveLoading ? <ActivityIndicator size="small" color={catColor} /> :
                    <Text style={[s.quickText, { color: catColor }]}>{live ? 'REFRESH' : 'LOAD DATA'}</Text>}
                </Pressable>
              )}
              {!isSol && (
                <View style={[s.quickBtn, { flex: 1, alignItems: 'center', borderColor: '#2a2a2a' }]}>
                  <Text style={[s.quickText, { color: '#6f6f6f' }]}>VIEW ONLY</Text>
                </View>
              )}
              {isSol && !isTracked && (
                <Pressable onPress={() => handleQuickTrack(nw.address, nw.label)} disabled={isTrackLoading} style={[s.quickBtn, { flex: 1, alignItems: 'center', borderColor: catColor + '40', backgroundColor: catColor + '10' }]}>
                  {isTrackLoading ? <ActivityIndicator size="small" color={catColor} /> :
                    <Text style={[s.quickText, { color: catColor }]}>+ TRACK</Text>}
                </Pressable>
              )}
              {isSol && isTracked && (
                <View style={[s.quickBtn, { flex: 1, alignItems: 'center', borderColor: '#ffffff20', backgroundColor: '#ffffff05' }]}>
                  <Text style={[s.quickText, { color: '#22c55e' }]}>TRACKED</Text>
                </View>
              )}
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

// ─── History Tab ──────────────────────────────────────────────────────────────

function HistoryTab({ userId }: { userId: string }) {
  const [trades, setTrades] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadHistory(); }, [userId]);

  const loadHistory = async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from('trading_log')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(50);
      setTrades(data || []);
    } catch { setTrades([]); }
    setLoading(false);
  };

  if (loading) return <LoadingScreen />;

  return (
    <ScrollView contentContainerStyle={s.scrollPad}>
      <Text style={s.label}>TRADE HISTORY</Text>

      {trades.length === 0 && (
        <Text style={s.emptyDesc}>No trades recorded yet.</Text>
      )}

      {trades.map(t => (
        <View key={t.id} style={s.listCard}>
          <View style={s.listTop}>
            <Text style={s.listTitle}>{t.action.toUpperCase()}</Text>
            <View style={[s.statusPill, t.status === 'success' ? s.statusPillActive : t.status === 'failed' ? s.statusPillFailed : {}]}>
              <Text style={[s.statusPillText, t.status === 'success' && { color: '#22c55e' }, t.status === 'failed' && { color: '#ef4444' }]}>
                {t.status}
              </Text>
            </View>
          </View>
          {t.input_amount && (
            <Text style={s.listMeta}>
              {t.input_amount} {'>'} {t.output_amount || '—'}
            </Text>
          )}
          {t.price_usd && (
            <Text style={s.listMeta}>Price: ${parseFloat(t.price_usd).toFixed(4)}</Text>
          )}
          {t.tx_hash && (
            <Pressable
              onPress={() => {
                if (RNPlatform.OS === 'web') window.open(`https://solscan.io/tx/${t.tx_hash}`, '_blank');
              }}
            >
              <Text style={s.txLink}>TX: {t.tx_hash.slice(0, 12)}...</Text>
            </Pressable>
          )}
          {t.reason && <Text style={s.listMeta}>{t.reason}</Text>}
          <Text style={s.listTime}>{new Date(t.created_at).toLocaleString()}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

// ─── Positions Tab ────────────────────────────────────────────────────────────

function PositionsTab({ client, userId }: { client: HeliusClient; userId: string }) {
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);

  useEffect(() => { loadPositions(); }, [userId]);

  const loadPositions = async () => {
    setLoading(true);
    try {
      const p = await getOpenPositions(userId);
      setPositions(p);
    } catch {
      setPositions([]);
    }
    setLoading(false);
  };

  const handleCheckStops = async () => {
    setChecking(true);
    try {
      const result = await checkPositionStops(client, userId);
      const total = result.stoppedOut.length + result.tookProfit.length;
      if (total > 0) {
        alert(`${result.stoppedOut.length} stopped out, ${result.tookProfit.length} took profit`);
      }
      await loadPositions();
    } catch (err: any) {
      alert('Error checking stops: ' + (err.message || err));
    }
    setChecking(false);
  };

  const handleClosePosition = async (pos: Position) => {
    try {
      const { price } = await client.getTokenPrice(pos.tokenMint);
      await closePosition(pos.id, price, 'manual');
      await loadPositions();
    } catch (err: any) {
      alert('Error closing position: ' + (err.message || err));
    }
  };

  if (loading) return <LoadingScreen />;

  const totalPnl = positions.reduce((sum, p) => sum + p.unrealizedPnl, 0);
  const totalValue = positions.reduce((sum, p) => sum + p.currentValueUsd, 0);

  return (
    <ScrollView showsVerticalScrollIndicator={false}>
      {/* Summary */}
      {positions.length > 0 && (
        <View style={s.statsRow}>
          <View style={s.statCard}>
            <Text style={[s.statValue, { color: '#e8e8e8' }]}>{positions.length}</Text>
            <Text style={s.statLabel}>Open</Text>
          </View>
          <View style={s.statCard}>
            <Text style={[s.statValue, { color: '#e8e8e8' }]}>${totalValue.toFixed(2)}</Text>
            <Text style={s.statLabel}>Value</Text>
          </View>
          <View style={s.statCard}>
            <Text style={[s.statValue, { color: totalPnl >= 0 ? '#22c55e' : '#ef4444' }]}>
              {totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}
            </Text>
            <Text style={s.statLabel}>Unrealized P&L</Text>
          </View>
        </View>
      )}

      {/* Check Stops Button */}
      <Pressable style={s.refreshBtn} onPress={handleCheckStops} disabled={checking}>
        <Text style={s.refreshText}>{checking ? 'CHECKING STOPS...' : 'CHECK STOP-LOSS / TAKE-PROFIT'}</Text>
      </Pressable>

      {positions.length === 0 ? (
        <View style={[s.emptyCard, { marginTop: 16 }]}>
          <Text style={s.emptyDesc}>No open positions. Positions are created when you execute trades with stop-loss/take-profit levels.</Text>
        </View>
      ) : (
        positions.map(pos => {
          const pnlColor = pos.unrealizedPnl >= 0 ? '#22c55e' : '#ef4444';
          const stopDist = pos.stopLossPrice && pos.currentPrice > 0
            ? ((pos.currentPrice - pos.stopLossPrice) / pos.currentPrice * 100).toFixed(1)
            : null;
          const tpDist = pos.takeProfitPrice && pos.currentPrice > 0
            ? ((pos.takeProfitPrice - pos.currentPrice) / pos.currentPrice * 100).toFixed(1)
            : null;

          return (
            <View key={pos.id} style={[s.listCard, { marginTop: 8 }]}>
              <View style={s.listTop}>
                <Text style={s.listTitle}>{pos.tokenSymbol} {pos.side.toUpperCase()}</Text>
                <Text style={[s.alertBadge, { color: pnlColor }]}>
                  {pos.unrealizedPnlPct >= 0 ? '+' : ''}{pos.unrealizedPnlPct.toFixed(2)}%
                </Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                <View>
                  <Text style={s.listMeta}>Entry: ${pos.entryPrice.toFixed(4)}</Text>
                  <Text style={s.listMeta}>Current: ${pos.currentPrice.toFixed(4)}</Text>
                  <Text style={s.listMeta}>Qty: {pos.quantity.toFixed(4)}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={[s.listMeta, { color: pnlColor }]}>
                    P&L: {pos.unrealizedPnl >= 0 ? '+' : ''}${pos.unrealizedPnl.toFixed(2)}
                  </Text>
                  {pos.stopLossPrice && (
                    <Text style={[s.listMeta, { color: '#ef4444' }]}>SL: ${pos.stopLossPrice.toFixed(4)} ({stopDist}%)</Text>
                  )}
                  {pos.takeProfitPrice && (
                    <Text style={[s.listMeta, { color: '#22c55e' }]}>TP: ${pos.takeProfitPrice.toFixed(4)} ({tpDist}%)</Text>
                  )}
                  {pos.trailingStopPct && (
                    <Text style={[s.listMeta, { color: '#f59e0b' }]}>Trail: {pos.trailingStopPct}%</Text>
                  )}
                </View>
              </View>
              <Pressable
                style={[s.refreshBtn, { marginTop: 8, backgroundColor: '#ffffff08', borderColor: '#ffffff15' }]}
                onPress={() => handleClosePosition(pos)}
              >
                <Text style={[s.refreshText, { color: '#ef4444' }]}>CLOSE POSITION</Text>
              </Pressable>
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

// ─── Signals Tab ──────────────────────────────────────────────────────────────

function SignalsTab({ client, userId }: { client: HeliusClient; userId: string }) {
  const [selectedToken, setSelectedToken] = useState<string>('SOL');
  const [riskScore, setRiskScore] = useState<TokenRiskScore | null>(null);
  const [analysis, setAnalysis] = useState<TechnicalAnalysis | null>(null);
  const [loadingRisk, setLoadingRisk] = useState(false);
  const [loadingTA, setLoadingTA] = useState(false);

  const tokens = Object.entries(SOLANA_TOKEN_REGISTRY).slice(0, 10);

  const handleScanRisk = async () => {
    setLoadingRisk(true);
    try {
      const token = SOLANA_TOKEN_REGISTRY[selectedToken];
      if (token) {
        const score = await scoreTokenRisk(client, token.mint, selectedToken);
        setRiskScore(score);
      }
    } catch (err: any) {
      alert('Risk scan failed: ' + (err.message || err));
    }
    setLoadingRisk(false);
  };

  const handleRunTA = async () => {
    setLoadingTA(true);
    try {
      const token = SOLANA_TOKEN_REGISTRY[selectedToken];
      if (token) {
        // Get current price and generate synthetic price history for demo
        const { price } = await client.getTokenPrice(token.mint);
        if (price > 0) {
          // Generate 30 data points with some variance for TA demo
          const prices: number[] = [];
          for (let i = 29; i >= 0; i--) {
            const variance = (Math.random() - 0.5) * 0.1;
            prices.push(price * (1 + variance - (i * 0.002)));
          }
          prices.push(price); // current price last
          const ta = calculateTechnicalSignals(prices, selectedToken, token.mint);
          setAnalysis(ta);
        }
      }
    } catch (err: any) {
      alert('TA failed: ' + (err.message || err));
    }
    setLoadingTA(false);
  };

  const gradeColor = (grade: string) => {
    switch (grade) {
      case 'A': return '#22c55e';
      case 'B': return '#3b82f6';
      case 'C': return '#f59e0b';
      case 'D': return '#f97316';
      case 'F': return '#ef4444';
      default: return '#9e9e9e';
    }
  };

  const signalColor = (signal: string) => {
    if (signal.includes('buy')) return '#22c55e';
    if (signal.includes('sell')) return '#ef4444';
    return '#f59e0b';
  };

  return (
    <ScrollView showsVerticalScrollIndicator={false}>
      {/* Token Selector */}
      <Text style={s.label}>SELECT TOKEN</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {tokens.map(([sym]) => (
            <Pressable
              key={sym}
              onPress={() => { setSelectedToken(sym); setRiskScore(null); setAnalysis(null); }}
              style={[s.tab, selectedToken === sym && { backgroundColor: ACCENT + '18', borderColor: ACCENT + '40' }]}
            >
              <Text style={[s.tabText, selectedToken === sym && { color: ACCENT }]}>{sym}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>

      {/* Action Buttons */}
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
        <Pressable style={[s.refreshBtn, { flex: 1 }]} onPress={handleScanRisk} disabled={loadingRisk}>
          <Text style={s.refreshText}>{loadingRisk ? 'SCANNING...' : 'RISK SCAN'}</Text>
        </Pressable>
        <Pressable style={[s.refreshBtn, { flex: 1 }]} onPress={handleRunTA} disabled={loadingTA}>
          <Text style={s.refreshText}>{loadingTA ? 'ANALYZING...' : 'TECHNICAL ANALYSIS'}</Text>
        </Pressable>
      </View>

      {/* Risk Score */}
      {riskScore && (
        <View style={[s.listCard, { marginBottom: 12 }]}>
          <View style={s.listTop}>
            <Text style={s.listTitle}>RISK SCORE: {riskScore.symbol}</Text>
            <View style={[s.statusPill, { borderColor: gradeColor(riskScore.grade) + '40', backgroundColor: gradeColor(riskScore.grade) + '08' }]}>
              <Text style={[s.statusPillText, { color: gradeColor(riskScore.grade) }]}>{riskScore.grade} ({riskScore.overallScore}/100)</Text>
            </View>
          </View>

          {/* Factor bars */}
          {Object.entries(riskScore.factors).map(([key, val]) => (
            <View key={key} style={{ marginTop: 8 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={s.listMeta}>{key.replace(/([A-Z])/g, ' $1').trim()}</Text>
                <Text style={s.listMeta}>{val}/20</Text>
              </View>
              <View style={{ height: 4, backgroundColor: '#1a1a1a', borderRadius: 2, marginTop: 2 }}>
                <View style={{
                  height: 4,
                  width: `${(val / 20) * 100}%`,
                  backgroundColor: val >= 15 ? '#22c55e' : val >= 10 ? '#f59e0b' : '#ef4444',
                  borderRadius: 2,
                }} />
              </View>
            </View>
          ))}

          {/* Warnings */}
          {riskScore.warnings.length > 0 && (
            <View style={{ marginTop: 10, padding: 8, backgroundColor: '#ffffff05', borderRadius: 6, borderWidth: 1, borderColor: '#ffffff10' }}>
              {riskScore.warnings.map((w, i) => (
                <Text key={i} style={[s.listMeta, { color: '#f59e0b', marginBottom: 2 }]}>{w}</Text>
              ))}
            </View>
          )}
        </View>
      )}

      {/* Technical Analysis */}
      {analysis && (
        <View style={[s.listCard, { marginBottom: 12 }]}>
          <View style={s.listTop}>
            <Text style={s.listTitle}>SIGNALS: {analysis.symbol}</Text>
            <View style={[s.statusPill, { borderColor: signalColor(analysis.overallSignal) + '40', backgroundColor: signalColor(analysis.overallSignal) + '08' }]}>
              <Text style={[s.statusPillText, { color: signalColor(analysis.overallSignal) }]}>
                {analysis.overallSignal.replace(/_/g, ' ').toUpperCase()} ({analysis.overallScore})
              </Text>
            </View>
          </View>

          <Text style={[s.listMeta, { marginTop: 6 }]}>
            Price: ${analysis.currentPrice.toFixed(4)} | S: ${analysis.support.toFixed(4)} | R: ${analysis.resistance.toFixed(4)}
          </Text>

          {/* Individual signals */}
          {analysis.signals.map((sig, i) => (
            <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
              <Text style={[s.listMeta, { flex: 1 }]}>{sig.indicator}</Text>
              <Text style={[s.listMeta, { flex: 1, textAlign: 'center' }]}>{sig.value}</Text>
              <View style={[s.statusPill, { borderColor: signalColor(sig.signal) + '40', backgroundColor: signalColor(sig.signal) + '08' }]}>
                <Text style={[s.statusPillText, { color: signalColor(sig.signal) }]}>
                  {sig.signal.toUpperCase()} {Math.round(sig.strength * 100)}%
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Info */}
      {!riskScore && !analysis && (
        <View style={s.emptyCard}>
          <Text style={s.emptyDesc}>
            Select a token and run Risk Scan or Technical Analysis to see signals.
            {'\n\n'}Risk Score rates tokens 0-100 across liquidity, holder distribution, contract security, volume, and price stability.
            {'\n\n'}Technical Analysis runs RSI, EMA crossover, MACD, Bollinger Bands, and momentum indicators.
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  scrollPad: { padding: 16, paddingBottom: 40 },

  // Tab bar — pixel-art style matching Backpack
  tabBar: {
    borderBottomWidth: 2,
    borderBottomColor: PIXEL_COLORS.border1,
    backgroundColor: PIXEL_COLORS.bg0,
  },
  tabRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: GRID.sm,
    paddingHorizontal: GRID.sm,
    paddingVertical: GRID.sm,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 2,
    borderWidth: 2,
    backgroundColor: PIXEL_COLORS.bg2,
  },
  tabIconWrap: {
    width: 24,
    height: 24,
    borderRadius: 2,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabIconChar: {
    fontSize: 10,
    fontWeight: '900',
    fontFamily: 'monospace',
  },
  tabText: {
    color: PIXEL_COLORS.text2,
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'monospace',
    letterSpacing: 0.5,
  },
  tabBadge: {
    position: 'absolute' as const,
    top: -4,
    right: -4,
    minWidth: 16,
    height: 16,
    borderRadius: 2,
    borderWidth: 2,
    borderColor: PIXEL_COLORS.bg0,
    backgroundColor: PIXEL_COLORS.red,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  tabBadgeText: { color: '#e8e8e8', fontSize: 8, fontWeight: '900', fontFamily: 'monospace' },

  // Empty state
  emptyIcon: { fontSize: 32, color: ACCENT, marginBottom: 12 },
  emptyTitle: { color: '#e8e8e8', fontSize: 16, fontWeight: '700', fontFamily: 'monospace', marginBottom: 8 },
  emptyDesc: { color: '#6f6f6f', fontSize: 13, fontFamily: 'monospace', textAlign: 'center', lineHeight: 20 },

  // Stats
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  statCard: {
    flex: 1,
    backgroundColor: '#161616',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1a1a1a',
    padding: 12,
    alignItems: 'center',
  },
  statValue: { color: '#e8e8e8', fontSize: 18, fontWeight: '800', fontFamily: 'monospace' },
  statLabel: { color: '#6f6f6f', fontSize: 10, fontFamily: 'monospace', marginTop: 4 },

  // Labels
  label: {
    color: '#6f6f6f',
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'monospace',
    letterSpacing: 2,
    marginBottom: 8,
    textTransform: 'uppercase',
  },

  // Info row
  infoRow: {
    backgroundColor: '#161616',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1a1a1a',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  mono: { color: '#b5b5b5', fontSize: 13, fontFamily: 'monospace' },

  // Token rows
  tokenRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#161616',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1a1a1a',
    marginBottom: 4,
  },
  tokenSymbol: { color: '#e8e8e8', fontSize: 13, fontWeight: '700', fontFamily: 'monospace' },
  tokenName: { color: '#6f6f6f', fontSize: 11, fontFamily: 'monospace' },
  tokenAmount: { color: '#b5b5b5', fontSize: 12, fontFamily: 'monospace' },
  tokenUsd: { color: '#9e9e9e', fontSize: 11, fontFamily: 'monospace' },

  // Form
  fieldGroup: { marginBottom: 12 },
  fieldLabel: { color: '#9e9e9e', fontSize: 11, fontWeight: '600', fontFamily: 'monospace', marginBottom: 4 },
  input: {
    backgroundColor: '#0a0a0a',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#e8e8e8',
    fontSize: 13,
    fontFamily: 'monospace',
  },
  formCard: {
    backgroundColor: '#161616',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: ACCENT + '30',
    padding: 14,
    marginBottom: 16,
  },

  // Quick amounts
  quickRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  quickBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    backgroundColor: '#161616',
  },
  quickText: { color: '#9e9e9e', fontSize: 11, fontFamily: 'monospace', fontWeight: '600' },

  // Action button
  actionBtn: {
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionText: { fontSize: 13, fontWeight: '700', fontFamily: 'monospace' },

  // Refresh
  refreshBtn: {
    marginTop: 16,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: ACCENT + '30',
    backgroundColor: ACCENT + '08',
    alignItems: 'center',
  },
  refreshText: { color: ACCENT, fontSize: 12, fontWeight: '600', fontFamily: 'monospace' },

  // Quote card
  quoteCard: {
    backgroundColor: '#161616',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1a1a1a',
    padding: 14,
    marginTop: 14,
  },
  quoteTitle: { color: '#e8e8e8', fontSize: 13, fontWeight: '700', fontFamily: 'monospace', marginBottom: 10 },
  quoteRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  quoteLabel: { color: '#9e9e9e', fontSize: 12, fontFamily: 'monospace' },
  quoteValue: { color: '#e8e8e8', fontSize: 12, fontFamily: 'monospace', fontWeight: '600' },

  // Result
  resultBanner: {
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: '#0a0a0a',
    marginTop: 12,
  },
  resultText: { fontSize: 12, fontFamily: 'monospace' },

  // Section header
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  addBtn: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 6,
    backgroundColor: ACCENT + '18',
    borderWidth: 1,
    borderColor: ACCENT + '30',
  },
  addText: { color: ACCENT, fontSize: 11, fontWeight: '700', fontFamily: 'monospace' },

  // List card
  listCard: {
    backgroundColor: '#161616',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1a1a1a',
    padding: 12,
    marginBottom: 8,
  },
  listTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  listTitle: { color: '#e8e8e8', fontSize: 13, fontWeight: '700', fontFamily: 'monospace' },
  listMeta: { color: '#6f6f6f', fontSize: 11, fontFamily: 'monospace', marginTop: 2 },
  listTime: { color: '#6f6f6f', fontSize: 10, fontFamily: 'monospace', marginTop: 4 },

  // Status pills
  statusPill: {
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    backgroundColor: '#0a0a0a',
  },
  statusPillActive: { borderColor: '#22c55e30', backgroundColor: '#22c55e10' },
  statusPillFailed: { borderColor: '#ef444430', backgroundColor: '#ef444410' },
  statusPillText: { color: '#6f6f6f', fontSize: 10, fontWeight: '600', fontFamily: 'monospace' },

  // Toggle
  toggleRow: { flexDirection: 'row', gap: 8 },
  toggleBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    alignItems: 'center',
  },
  toggleText: { color: '#6f6f6f', fontSize: 12, fontWeight: '600', fontFamily: 'monospace' },

  // Alert badge
  alertBadge: { fontSize: 11, fontWeight: '700', fontFamily: 'monospace' },

  // TX link
  txLink: { color: ACCENT, fontSize: 11, fontFamily: 'monospace', marginTop: 4 },

  // Featured trades
  featuredTagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 6, marginBottom: 6 },
  featuredTag: {
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  featuredTagText: { color: '#9e9e9e', fontSize: 9, fontWeight: '700', fontFamily: 'monospace', textTransform: 'uppercase' },
  featuredDesc: { color: '#9e9e9e', fontSize: 11.5, fontFamily: 'monospace', lineHeight: 17, marginBottom: 8 },

  // Pending actions
  emptyCard: {
    backgroundColor: '#161616',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1a1a1a',
    padding: 20,
    alignItems: 'center',
  },
  pendingDetails: {
    backgroundColor: '#0a0a0a',
    borderRadius: 8,
    padding: 10,
    marginVertical: 8,
    gap: 4,
  },
  pendingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  pendingLabel: { color: '#9e9e9e', fontSize: 11, fontFamily: 'monospace' },
  pendingValue: { color: '#e8e8e8', fontSize: 11, fontFamily: 'monospace', fontWeight: '600' },
  reasonBox: {
    borderWidth: 1,
    borderColor: ACCENT + '20',
    borderRadius: 6,
    backgroundColor: ACCENT + '05',
    padding: 8,
    marginBottom: 8,
  },
  reasonText: { color: '#9e9e9e', fontSize: 11, fontFamily: 'monospace', lineHeight: 16 },
  pendingBtnRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  pendingBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingBtnReject: {
    borderWidth: 1,
    borderColor: '#ef444430',
    backgroundColor: '#ef444410',
  },
  pendingBtnApprove: {
    backgroundColor: '#22c55e',
  },
  pendingBtnText: { fontSize: 12, fontWeight: '700', fontFamily: 'monospace' },
});
