/**
 * TradingBotPanel - Backpack compartment for Solana trading
 *
 * Tabs:
 *   - Portfolio: wallet overview, token balances, total value
 *   - Paper: simulated trading with persistent paper equity
 *   - Trade: manual swap via Jupiter
 *   - Backtest: snapshot strategy tests and run history
 *   - DCA: dollar-cost averaging configs
 *   - Alerts: price alerts management
 *   - Wallets: tracked whale wallets
 *   - History: trade log with live, paper, and backtest activity
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  type RebalancePlan,
  type TradeLogEntry,
  type TradingExecutionMode,
  type TradingBotWalletInfo,
  type TradingBotAutopilotConfig,
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
  getTradingLog,
  getFeaturedTrades,
  generateFeaturedTrades,
  executeFeaturedTrade,
  getFeaturedTradeStats,
  getOpenPositions,
  closePosition,
  closePaperPosition,
  checkPositionStops,
  scoreTokenRisk,
  calculateTechnicalSignals,
  generateRebalancePlan,
  getPortfolioAllocation,
  savePosition,
  expirePendingActions,
  getTradingBotWallet,
  createTradingBotWallet,
  setTradingBotWalletStatus,
  executeBotWalletSwap,
  getTradingBotAutopilotConfig,
  saveTradingBotAutopilotConfig,
  runTradingBotAutopilot,
  withdrawFromBotWallet,
  scanBotWalletMomentum,
  type MomentumHolding,
  type MomentumScanResult,
  SOL_MINT,
  USDC_MINT,
  SOLANA_TOKEN_REGISTRY,
} from '../lib/heliusTrading';
import { TradingBotPaperTab } from './TradingBotPaperTab';
import { TradingBotBacktestTab } from './TradingBotBacktestTab';
import TradingTerminalLayout from './trading/TradingTerminalLayout';

const ACCENT = '#6366f1';
type Tab = 'featured' | 'pending' | 'positions' | 'signals' | 'portfolio' | 'paper' | 'trade' | 'backtest' | 'bot' | 'dca' | 'alerts' | 'wallets' | 'history';

const ALL_TABS: { key: Tab; label: string; icon: string; color: string }[] = [
  { key: 'trade',     label: 'Terminal',   icon: 'TV', color: '#3b82f6' },
  { key: 'paper',     label: 'Paper',      icon: 'PP', color: '#14b8a6' },
  { key: 'signals',   label: 'Signals',    icon: '//', color: '#6366f1' },
  { key: 'backtest',  label: 'Lab',        icon: 'BT', color: '#f97316' },
  { key: 'bot',       label: 'Bot',        icon: 'AI', color: '#84cc16' },
  { key: 'featured',  label: 'Ideas',      icon: '*',  color: '#f59e0b' },
  { key: 'dca',       label: 'DCA',        icon: '~',  color: '#6366f1' },
  { key: 'alerts',    label: 'Alerts',     icon: '!',  color: '#ef4444' },
  { key: 'pending',   label: 'Queue',      icon: '..', color: '#f97316' },
  { key: 'wallets',   label: 'Watch',      icon: '@',  color: '#ec4899' },
];

interface Props {
  circleId: string;
  userId: string;
  accentColor?: string;
}


type RebalancePresetId = 'core' | 'balanced' | 'stable';
type RebalanceTargetInput = { symbol: string; targetPct: string };

interface TokenMarketSnapshot {
  mint: string;
  symbol: string;
  priceUsd: number;
  priceChange5m: number;
  priceChange1h: number;
  priceChange6h: number;
  priceChange24h: number;
  volume24h: number;
  liquidityUsd: number;
  marketCap: number;
  fdv: number;
  buys24h: number;
  sells24h: number;
  pairCreatedAt?: number;
  dexId?: string;
  pairUrl?: string;
  activeBoosts: number;
  websites: string[];
  socials: string[];
}

const COMMON_TRADING_SYMBOLS = ['SOL', 'USDC', 'JUP', 'BONK', 'PYTH', 'JTO', 'WIF', 'RAY'] as const;

const REBALANCE_PRESETS: Record<RebalancePresetId, { label: string; targets: Array<{ symbol: string; targetPct: number }> }> = {
  core: {
    label: 'Core',
    targets: [
      { symbol: 'SOL', targetPct: 45 },
      { symbol: 'USDC', targetPct: 20 },
      { symbol: 'JUP', targetPct: 15 },
      { symbol: 'JTO', targetPct: 10 },
      { symbol: 'PYTH', targetPct: 10 },
    ],
  },
  balanced: {
    label: 'Balanced',
    targets: [
      { symbol: 'SOL', targetPct: 35 },
      { symbol: 'USDC', targetPct: 30 },
      { symbol: 'JUP', targetPct: 15 },
      { symbol: 'RAY', targetPct: 10 },
      { symbol: 'PYTH', targetPct: 10 },
    ],
  },
  stable: {
    label: 'Stable',
    targets: [
      { symbol: 'USDC', targetPct: 45 },
      { symbol: 'SOL', targetPct: 30 },
      { symbol: 'JUP', targetPct: 10 },
      { symbol: 'JTO', targetPct: 10 },
      { symbol: 'PYTH', targetPct: 5 },
    ],
  },
};

function getTokenMetaByMint(mint: string): { symbol: string; name: string; decimals: number } {
  const entry = Object.entries(SOLANA_TOKEN_REGISTRY).find(([, token]) => token.mint === mint);
  if (entry) {
    return { symbol: entry[0], name: entry[1].name, decimals: entry[1].decimals };
  }
  return {
    symbol: mint === SOL_MINT ? 'SOL' : mint === USDC_MINT ? 'USDC' : mint.slice(0, 6),
    name: mint === SOL_MINT ? 'Solana' : mint === USDC_MINT ? 'USD Coin' : 'Custom Token',
    decimals: mint === SOL_MINT ? 9 : 6,
  };
}

function getTokenMetaBySymbol(symbol: string): { mint: string; symbol: string; decimals: number; name: string } | null {
  const token = SOLANA_TOKEN_REGISTRY[symbol.toUpperCase()];
  return token
    ? { mint: token.mint, symbol: symbol.toUpperCase(), decimals: token.decimals, name: token.name }
    : null;
}

function parsePositiveNumber(value: string): number | undefined {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function formatCompactUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '$0';
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
}

function formatPct(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
}

function formatAge(pairCreatedAt?: number): string {
  if (!pairCreatedAt) return 'n/a';
  const ageHours = (Date.now() - pairCreatedAt) / 3_600_000;
  if (ageHours < 24) return `${Math.max(1, Math.round(ageHours))}h`;
  return `${Math.max(1, Math.round(ageHours / 24))}d`;
}

function convertFromSmallestUnit(amount: string | number, mint: string): number {
  const value = typeof amount === 'string' ? parseFloat(amount || '0') : amount;
  if (!Number.isFinite(value)) return 0;
  return value / Math.pow(10, getTokenMetaByMint(mint).decimals);
}

function getPairTokenPrice(pair: any, mint: string): number {
  const baseAddress = pair?.baseToken?.address;
  const priceUsd = parseFloat(pair?.priceUsd || '0') || 0;
  if (baseAddress === mint) return priceUsd;
  const priceNative = parseFloat(pair?.priceNative || '0') || 0;
  return priceNative > 0 && priceUsd > 0 ? priceUsd / priceNative : priceUsd;
}

async function fetchTokenMarketSnapshot(mint: string): Promise<TokenMarketSnapshot | null> {
  try {
    const resp = await fetch(`https://api.dexscreener.com/token-pairs/v1/solana/${mint}`);
    if (!resp.ok) return null;
    const pairs = await resp.json();
    if (!Array.isArray(pairs) || pairs.length === 0) return null;

    const bestPair = [...pairs].sort((a, b) => {
      const liquidityDiff = (b?.liquidity?.usd || 0) - (a?.liquidity?.usd || 0);
      if (liquidityDiff !== 0) return liquidityDiff;
      return (b?.volume?.h24 || 0) - (a?.volume?.h24 || 0);
    })[0];

    const meta = getTokenMetaByMint(mint);
    return {
      mint,
      symbol: meta.symbol,
      priceUsd: getPairTokenPrice(bestPair, mint),
      priceChange5m: Number(bestPair?.priceChange?.m5 || 0),
      priceChange1h: Number(bestPair?.priceChange?.h1 || 0),
      priceChange6h: Number(bestPair?.priceChange?.h6 || 0),
      priceChange24h: Number(bestPair?.priceChange?.h24 || 0),
      volume24h: Number(bestPair?.volume?.h24 || 0),
      liquidityUsd: Number(bestPair?.liquidity?.usd || 0),
      marketCap: Number(bestPair?.marketCap || 0),
      fdv: Number(bestPair?.fdv || 0),
      buys24h: Number(bestPair?.txns?.h24?.buys || 0),
      sells24h: Number(bestPair?.txns?.h24?.sells || 0),
      pairCreatedAt: bestPair?.pairCreatedAt,
      dexId: bestPair?.dexId,
      pairUrl: bestPair?.url,
      activeBoosts: Number(bestPair?.boosts?.active || 0),
      websites: Array.isArray(bestPair?.info?.websites) ? bestPair.info.websites.map((site: any) => site?.url).filter(Boolean) : [],
      socials: Array.isArray(bestPair?.info?.socials) ? bestPair.info.socials.map((social: any) => social?.handle || social?.platform).filter(Boolean) : [],
    };
  } catch {
    return null;
  }
}

function anchorPriceFromChange(currentPrice: number, changePct: number): number {
  const ratio = 1 + ((changePct || 0) / 100);
  return ratio > 0.05 ? currentPrice / ratio : currentPrice;
}

function buildPriceSeriesFromSnapshot(snapshot: TokenMarketSnapshot): number[] {
  const current = snapshot.priceUsd || 0;
  if (current <= 0) return Array.from({ length: 31 }, () => 0);

  const anchors = [
    { index: 0, price: anchorPriceFromChange(current, snapshot.priceChange24h) },
    { index: 18, price: anchorPriceFromChange(current, snapshot.priceChange6h) },
    { index: 26, price: anchorPriceFromChange(current, snapshot.priceChange1h) },
    { index: 29, price: anchorPriceFromChange(current, snapshot.priceChange5m) },
    { index: 30, price: current },
  ];

  const series = Array.from({ length: 31 }, () => current);
  for (let i = 0; i < anchors.length - 1; i += 1) {
    const start = anchors[i];
    const end = anchors[i + 1];
    for (let idx = start.index; idx <= end.index; idx += 1) {
      const progress = end.index === start.index ? 1 : (idx - start.index) / (end.index - start.index);
      series[idx] = start.price + ((end.price - start.price) * progress);
    }
  }
  return series.map(value => Math.max(value, 0.0000001));
}

function buildLiveAnalysisFromSnapshot(snapshot: TokenMarketSnapshot, symbol: string, mint: string): TechnicalAnalysis {
  const base = calculateTechnicalSignals(buildPriceSeriesFromSnapshot(snapshot), symbol, mint);
  const totalTxns = snapshot.buys24h + snapshot.sells24h;
  const buyRatio = totalTxns > 0 ? snapshot.buys24h / totalTxns : 0.5;
  const orderFlowSignal = {
    indicator: 'Order Flow 24h',
    value: Math.round(buyRatio * 100),
    signal: buyRatio > 0.56 ? 'buy' as const : buyRatio < 0.44 ? 'sell' as const : 'neutral' as const,
    strength: Math.min(1, Math.abs(buyRatio - 0.5) * 2.4),
  };
  const liquidityStrength = snapshot.liquidityUsd >= 250_000 ? 0.9 : snapshot.liquidityUsd >= 100_000 ? 0.65 : snapshot.liquidityUsd >= 50_000 ? 0.45 : 0.2;
  const liquiditySignal = {
    indicator: 'Liquidity Depth',
    value: Math.round(snapshot.liquidityUsd),
    signal: snapshot.liquidityUsd >= 250_000 ? 'buy' as const : snapshot.liquidityUsd < 50_000 ? 'sell' as const : 'neutral' as const,
    strength: liquidityStrength,
  };
  const boostSignal = {
    indicator: 'Momentum 24h',
    value: Math.round(snapshot.priceChange24h * 10) / 10,
    signal: snapshot.priceChange24h >= 8 ? 'buy' as const : snapshot.priceChange24h <= -8 ? 'sell' as const : 'neutral' as const,
    strength: Math.min(1, Math.abs(snapshot.priceChange24h) / 25),
  };

  const signals = [...base.signals, orderFlowSignal, liquiditySignal, boostSignal];
  const combinedScore = Math.max(
    -100,
    Math.min(
      100,
      Math.round(
        (base.overallScore * 0.7)
        + ((buyRatio - 0.5) * 80)
        + (snapshot.priceChange1h * 1.5)
        + (snapshot.priceChange24h * 0.5)
        + (snapshot.liquidityUsd >= 250_000 ? 10 : snapshot.liquidityUsd < 50_000 ? -10 : 0)
      ),
    ),
  );

  const overallSignal: TechnicalAnalysis['overallSignal'] = combinedScore >= 60
    ? 'strong_buy'
    : combinedScore >= 20
      ? 'buy'
      : combinedScore <= -60
        ? 'strong_sell'
        : combinedScore <= -20
          ? 'sell'
          : 'neutral';

  const volatility = Math.max(Math.abs(snapshot.priceChange5m), Math.abs(snapshot.priceChange1h), Math.abs(snapshot.priceChange6h), 2);
  const support = snapshot.priceUsd * (1 - Math.min(0.12, volatility / 160));
  const resistance = snapshot.priceUsd * (1 + Math.min(0.15, Math.max(0.03, Math.abs(snapshot.priceChange24h) / 100)));

  return {
    ...base,
    currentPrice: snapshot.priceUsd,
    overallScore: combinedScore,
    overallSignal,
    support,
    resistance,
    signals,
  };
}

function buildTargetRows(preset: RebalancePresetId): RebalanceTargetInput[] {
  return REBALANCE_PRESETS[preset].targets.map(target => ({
    symbol: target.symbol,
    targetPct: String(target.targetPct),
  }));
}


function getExecutionModeColor(mode: TradingExecutionMode): string {
  switch (mode) {
    case 'paper':
      return '#14b8a6';
    case 'backtest':
      return '#f97316';
    default:
      return '#22c55e';
  }
}

function getExecutionModeLabel(mode: TradingExecutionMode): string {
  switch (mode) {
    case 'paper':
      return 'PAPER';
    case 'backtest':
      return 'BACKTEST';
    default:
      return 'LIVE';
  }
}

export default function TradingBotPanel({ circleId, userId, accentColor = ACCENT }: Props) {
  const [tab, setTab] = useState<Tab>('trade');
  const [client, setClient] = useState<HeliusClient | null>(null);
  const [loading, setLoading] = useState(true);
  const [noKey, setNoKey] = useState(false);
  const [noKeyMessage, setNoKeyMessage] = useState('Add your Helius API key in Integrations to enable the trading bot.');
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [botWallet, setBotWallet] = useState<TradingBotWalletInfo | null>(null);
  const [badges, setBadges] = useState<Partial<Record<Tab, number>>>({});
  const autopilotBusyRef = useRef(false);

  const refreshBotWallet = useCallback(async () => {
    try {
      setBotWallet(await getTradingBotWallet(circleId));
    } catch {
      setBotWallet(null);
    }
  }, [circleId]);

  const init = useCallback(async () => {
    setLoading(true);
    setNoKey(false);
    setNoKeyMessage('Add your Helius API key in Integrations to enable the trading bot.');
    try {
      const c = await createUserHeliusClient(userId);
      if (!c) {
        setClient(null);
      setBotWallet(null);
        try {
          const { data: allKeys } = await supabase.rpc('list_user_api_keys');
          const hasActiveHelius = (allKeys || []).some((key: any) => key?.provider === 'helius' && key?.is_active);
          if (hasActiveHelius) {
            setNoKeyMessage('Helius is saved in Integrations, but this Supabase project is missing the get_user_api_key RPC. Apply the latest DB migrations, or re-save the Helius key once after this update to refresh the local cache on this device.');
          }
        } catch {
          // Ignore metadata lookup failures and keep the default message.
        }
        setNoKey(true);
        return;
      }
      setClient(c);

      const countSafe = async (q: any): Promise<number> => {
        try { const r = await q; return r.count || 0; } catch { return 0; }
      };
      const [profileRes, pendingCount, positionCount, alertCount, nextBotWallet] = await Promise.all([
        supabase.from('profiles').select('wallet_address, wallet_address_sol').eq('id', userId).single(),
        countSafe(supabase.from('trading_pending_actions').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'pending')),
        countSafe(supabase.from('trading_positions').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'open')),
        countSafe(supabase.from('trading_alerts').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('triggered', false)),
        getTradingBotWallet(circleId).catch(() => null),
      ]);

      const addr = profileRes.data?.wallet_address_sol || profileRes.data?.wallet_address || null;
      setWalletAddress(addr);
      setBotWallet(nextBotWallet);

      const nextBadges: Partial<Record<Tab, number>> = {};
      if (pendingCount > 0) nextBadges.pending = pendingCount as number;
      if (positionCount > 0) nextBadges.positions = positionCount as number;
      if (alertCount > 0) nextBadges.alerts = alertCount as number;
      setBadges(nextBadges);
    } catch (err) {
      console.warn('[TradingBotPanel] init failed', err);
      setClient(null);
      if (`${(err as any)?.message || err || ''}`.includes('get_user_api_key')) {
        setNoKeyMessage('Helius key lookup failed because the backend get_user_api_key RPC is missing. Apply the latest DB migrations, or re-save the Helius key once after this update to refresh the local cache on this device.');
      }
      setNoKey(true);
    } finally {
      setLoading(false);
    }
  }, [circleId, userId]);

  useEffect(() => {
    init();
  }, [init]);

  useEffect(() => {
    if (RNPlatform.OS !== 'web' || typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }
    const handleFocus = () => { init(); };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        init();
      }
    };
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [init]);

  useEffect(() => {
    if (!botWallet || botWallet.status !== 'active') {
      return;
    }

    let cancelled = false;
    const tick = async () => {
      if (cancelled || autopilotBusyRef.current) {
        return;
      }
      if (RNPlatform.OS === 'web' && typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return;
      }

      autopilotBusyRef.current = true;
      try {
        const result = await runTradingBotAutopilot(circleId, { triggerSource: 'dashboard_poll' });
        if (cancelled) {
          return;
        }
        if (result.wallet) {
          setBotWallet(result.wallet);
        }
        if (result.status === 'executed') {
          await init();
        }
      } catch {
        // Ignore background autopilot failures here; the Bot tab surfaces the error state.
      } finally {
        autopilotBusyRef.current = false;
      }
    };

    const warmup = setTimeout(() => { void tick(); }, 15000);
    const interval = setInterval(() => { void tick(); }, 120000);

    return () => {
      cancelled = true;
      clearTimeout(warmup);
      clearInterval(interval);
    };
  }, [botWallet?.id, botWallet?.status, circleId, init]);

  if (loading) {
    return <LoadingScreen />;
  }

  if (noKey) {
    return (
      <View style={s.center}>
        <Text style={s.emptyIcon}>O</Text>
        <Text style={s.emptyTitle}>Helius Not Connected</Text>
        <Text style={s.emptyDesc}>
          {noKeyMessage}
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
        {tab === 'trade' && <TradingTerminalLayout client={client!} walletAddress={walletAddress} userId={userId} circleId={circleId} botWallet={botWallet} onBotWalletRefresh={refreshBotWallet} />}
        {tab === 'paper' && <TradingBotPaperTab client={client!} userId={userId} circleId={circleId} />}
        {tab === 'signals' && <SignalsTab client={client!} userId={userId} />}
        {tab === 'backtest' && <TradingBotBacktestTab client={client!} userId={userId} circleId={circleId} />}
        {tab === 'bot' && <BotWalletTab circleId={circleId} walletAddress={walletAddress} botWallet={botWallet} onBotWalletRefresh={refreshBotWallet} onTradingStateRefresh={init} />}
        {tab === 'featured' && <FeaturedTab client={client!} walletAddress={walletAddress} userId={userId} circleId={circleId} botWallet={botWallet} onBotWalletRefresh={refreshBotWallet} />}
        {tab === 'dca' && <DCATab client={client!} userId={userId} />}
        {tab === 'alerts' && <AlertsTab client={client!} userId={userId} />}
        {tab === 'pending' && <PendingTab client={client!} walletAddress={walletAddress} userId={userId} circleId={circleId} botWallet={botWallet} onBotWalletRefresh={refreshBotWallet} />}
        {tab === 'wallets' && <WalletsTab client={client!} userId={userId} />}
      </View>
    </View>
  );
}

// ??? Bot Wallet Tab ???????????????????????????????????????????????????????????

function BotWalletTab({
  circleId,
  walletAddress,
  botWallet,
  onBotWalletRefresh,
  onTradingStateRefresh,
}: {
  circleId: string;
  walletAddress: string | null;
  botWallet: TradingBotWalletInfo | null;
  onBotWalletRefresh: () => Promise<void>;
  onTradingStateRefresh: () => Promise<void>;
}) {
  const [creating, setCreating] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [runningAutopilot, setRunningAutopilot] = useState(false);
  const [config, setConfig] = useState<TradingBotAutopilotConfig | null>(null);
  const [maxTradeSol, setMaxTradeSol] = useState('0.25');
  const [maxDailyTrades, setMaxDailyTrades] = useState('3');
  const [slippageCap, setSlippageCap] = useState('150');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Withdraw state
  const [withdrawDest, setWithdrawDest] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawAll, setWithdrawAll] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawMessage, setWithdrawMessage] = useState<string | null>(null);

  // Momentum scan state
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<MomentumScanResult | null>(null);

  const syncDrafts = useCallback((nextConfig: TradingBotAutopilotConfig | null) => {
    setConfig(nextConfig);
    if (!nextConfig) return;
    setMaxTradeSol(String(nextConfig.maxTradeSol));
    setMaxDailyTrades(String(nextConfig.maxDailyTrades));
    setSlippageCap(String(nextConfig.slippageBpsCap));
  }, []);

  const loadConfig = useCallback(async () => {
    if (!botWallet) {
      syncDrafts(null);
      return;
    }
    setLoadingConfig(true);
    try {
      const nextConfig = await getTradingBotAutopilotConfig(circleId);
      syncDrafts(nextConfig);
    } catch (err: any) {
      setStatusMessage(`Failed to load autopilot config: ${err.message || err}`);
    }
    setLoadingConfig(false);
  }, [botWallet, circleId, syncDrafts]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const handleCreate = async () => {
    setCreating(true);
    try {
      await createTradingBotWallet(circleId);
      await onTradingStateRefresh();
      setStatusMessage('Bot wallet created. Fund it with a small SOL balance, then configure autopilot.');
    } catch (err: any) {
      alert(`Failed to create bot wallet: ${err.message || err}`);
    }
    setCreating(false);
  };

  const handleToggleStatus = async () => {
    if (!botWallet) return;
    setUpdating(true);
    try {
      await setTradingBotWalletStatus(circleId, botWallet.status === 'active' ? 'paused' : 'active');
      await onTradingStateRefresh();
      setStatusMessage(botWallet.status === 'active' ? 'Bot wallet paused.' : 'Bot wallet resumed.');
    } catch (err: any) {
      alert(`Failed to update bot wallet: ${err.message || err}`);
    }
    setUpdating(false);
  };

  const handleCopyAddress = async () => {
    if (!botWallet?.address || RNPlatform.OS !== 'web' || !navigator?.clipboard) return;
    await navigator.clipboard.writeText(botWallet.address);
    alert('Bot wallet address copied.');
  };

  const handleSaveConfig = async () => {
    if (!config) return;
    setSavingConfig(true);
    setStatusMessage(null);
    try {
      const nextConfig = await saveTradingBotAutopilotConfig(circleId, {
        isEnabled: config.isEnabled,
        strategyMode: config.strategyMode,
        minConfidence: config.minConfidence,
        maxTradeSol: Math.max(0.01, parseFloat(maxTradeSol || '0.25') || 0.25),
        maxDailyTrades: Math.max(1, parseInt(maxDailyTrades || '3', 10) || 3),
        allowFeaturedTrades: config.allowFeaturedTrades,
        allowPendingActions: config.allowPendingActions,
        slippageBpsCap: Math.max(25, parseInt(slippageCap || '150', 10) || 150),
        autoPauseOnError: config.autoPauseOnError,
      });
      syncDrafts(nextConfig);
      setStatusMessage('Autopilot settings saved.');
    } catch (err: any) {
      alert(`Failed to save autopilot settings: ${err.message || err}`);
    }
    setSavingConfig(false);
  };

  const handleRunAutopilot = async () => {
    setRunningAutopilot(true);
    setStatusMessage(null);
    try {
      const result = await runTradingBotAutopilot(circleId, { force: true, triggerSource: 'bot_tab_manual' });
      if (result.config) {
        syncDrafts(result.config);
      }
      if (result.wallet) {
        await onBotWalletRefresh();
      }
      if (result.status === 'executed') {
        await onTradingStateRefresh();
      }
      setStatusMessage(result.message);
    } catch (err: any) {
      setStatusMessage(`Autopilot run failed: ${err.message || err}`);
    }
    setRunningAutopilot(false);
  };

  const handleWithdraw = async () => {
    if (!botWallet || withdrawing) return;
    setWithdrawing(true);
    setWithdrawMessage(null);
    try {
      const result = await withdrawFromBotWallet({
        circleId,
        destination: withdrawDest.trim(),
        amountLamports: withdrawAll ? undefined : Math.floor(parseFloat(withdrawAmount || '0') * 1e9),
        withdrawAll,
      });
      setWithdrawMessage(`Sent ${result.amountSol.toFixed(4)} SOL — TX: ${result.txHash.slice(0, 12)}...`);
      setWithdrawDest('');
      setWithdrawAmount('');
      setWithdrawAll(false);
      await onBotWalletRefresh();
    } catch (err: any) {
      setWithdrawMessage(`Withdraw failed: ${err.message || err}`);
    }
    setWithdrawing(false);
  };

  const handleScanMomentum = async () => {
    setScanning(true);
    setStatusMessage(null);
    try {
      const result = await scanBotWalletMomentum(circleId, { autoExecute: false });
      setScanResult(result);
      setStatusMessage(`Scanned ${result.holdings.length} holdings — ${result.exitCandidates.length} exit / ${result.entryCandidates.length} entry signals`);
    } catch (err: any) {
      setStatusMessage(`Momentum scan failed: ${err.message || err}`);
    }
    setScanning(false);
  };

  if (!botWallet) {
    return (
      <ScrollView contentContainerStyle={s.scrollPad}>
        <Text style={s.label}>BOT WALLET</Text>
        <View style={s.emptyCard}>
          <Text style={s.emptyTitle}>Create an Autopilot Wallet</Text>
          <Text style={s.emptyDesc}>
            This wallet lives on the backend, not in Phantom. It can sign Solana swaps server-side so the trading bot can execute without asking you to approve every trade.
          </Text>
        </View>

        <View style={s.listCard}>
          <Text style={s.listTitle}>How it works</Text>
          <Text style={[s.listMeta, { marginTop: 8 }]}>1. Create the wallet in-app.</Text>
          <Text style={s.listMeta}>2. Fund it with a limited amount of SOL from Phantom or another wallet.</Text>
          <Text style={s.listMeta}>3. Enable autopilot to let the bot execute queued actions and featured trade ideas without Phantom popups.</Text>
          <Text style={[s.listMeta, { marginTop: 8, color: '#f59e0b' }]}>Use a capped balance. Treat it like a hot trading wallet, not your treasury.</Text>
        </View>

        <Pressable onPress={handleCreate} disabled={creating} style={[s.actionBtn, { backgroundColor: '#84cc16', marginTop: 8 }]}>
          {creating ? <ActivityIndicator size="small" color="#0a0a0a" /> : <Text style={[s.actionText, { color: '#0a0a0a' }]}>Create Bot Wallet</Text>}
        </Pressable>

        <Text style={[s.emptyDesc, { textAlign: 'left', marginTop: 12 }]}> 
          {walletAddress ? 'Once created, copy the bot wallet address and fund it from Phantom.' : 'You do not need Phantom for the bot wallet to trade, but you will typically use Phantom to fund it.'}
        </Text>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={s.scrollPad}>
      <Text style={s.label}>BOT WALLET</Text>
      <View style={s.statsRow}>
        <View style={s.statCard}>
          <Text style={s.statValue}>{botWallet.balanceSol.toFixed(4)}</Text>
          <Text style={s.statLabel}>SOL Balance</Text>
        </View>
        <View style={s.statCard}>
          <Text style={[s.statValue, { color: botWallet.status === 'active' ? '#84cc16' : '#f59e0b' }]}>{botWallet.status.toUpperCase()}</Text>
          <Text style={s.statLabel}>Status</Text>
        </View>
      </View>

      <View style={s.listCard}>
        <Text style={s.listTitle}>{botWallet.label}</Text>
        <Text style={[s.listMeta, { marginTop: 8 }]}>Address</Text>
        <Text style={s.mono}>{botWallet.address}</Text>
        <Text style={[s.listMeta, { marginTop: 8 }]}>Created {new Date(botWallet.createdAt).toLocaleString()}</Text>
        {botWallet.lastFundedAt && <Text style={s.listMeta}>Funded {new Date(botWallet.lastFundedAt).toLocaleString()}</Text>}
        {botWallet.lastUsedAt && <Text style={s.listMeta}>Last trade {new Date(botWallet.lastUsedAt).toLocaleString()}</Text>}
      </View>

      <View style={s.pendingBtnRow}>
        <Pressable onPress={onTradingStateRefresh} style={[s.pendingBtn, s.pendingBtnApprove]}>
          <Text style={[s.pendingBtnText, { color: '#e8e8e8' }]}>Refresh Balance</Text>
        </Pressable>
        <Pressable onPress={handleToggleStatus} disabled={updating} style={[s.pendingBtn, s.pendingBtnReject]}>
          {updating ? <ActivityIndicator size="small" color="#ef4444" /> : <Text style={[s.pendingBtnText, { color: '#ef4444' }]}>{botWallet.status === 'active' ? 'Pause' : 'Resume'}</Text>}
        </Pressable>
      </View>

      {RNPlatform.OS === 'web' && (
        <Pressable onPress={handleCopyAddress} style={[s.refreshBtn, { marginTop: 8 }]}>
          <Text style={s.refreshText}>Copy Deposit Address</Text>
        </Pressable>
      )}

      {/* ── Withdraw Section ── */}
      <View style={[s.listCard, { marginTop: 12 }]} nativeID="section-bot-withdraw">
        <Text style={s.listTitle}>Withdraw SOL</Text>
        <Text style={[s.listMeta, { marginTop: 6, marginBottom: 10 }]}>Send SOL out of the bot wallet to any Solana address.</Text>

        <Text style={s.fieldLabel}>Destination address</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
          <TextInput
            value={withdrawDest}
            onChangeText={setWithdrawDest}
            placeholder="Solana address..."
            placeholderTextColor="#6f6f6f"
            style={[s.input, { flex: 1, marginBottom: 0 }]}
          />
          {walletAddress && (
            <Pressable onPress={() => setWithdrawDest(walletAddress)} style={[s.toggleChip, { borderColor: '#6366f140', backgroundColor: '#6366f112' }]}>
              <Text style={[s.toggleChipText, { color: '#818cf8' }]}>My Wallet</Text>
            </Pressable>
          )}
        </View>

        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 10 }}>
          {!withdrawAll && (
            <>
              <Text style={[s.fieldLabel, { marginBottom: 0 }]}>Amount (SOL)</Text>
              <TextInput
                value={withdrawAmount}
                onChangeText={setWithdrawAmount}
                keyboardType="decimal-pad"
                placeholder="0.1"
                placeholderTextColor="#6f6f6f"
                style={[s.input, { flex: 1, marginBottom: 0 }]}
              />
            </>
          )}
          <Pressable
            onPress={() => setWithdrawAll(prev => !prev)}
            style={[s.toggleChip, withdrawAll ? { borderColor: '#f59e0b50', backgroundColor: '#f59e0b18' } : { borderColor: '#ffffff12', backgroundColor: '#ffffff04' }]}
          >
            <Text style={[s.toggleChipText, { color: withdrawAll ? '#f59e0b' : '#6f6f6f' }]}>Withdraw All</Text>
          </Pressable>
        </View>

        <Pressable
          onPress={handleWithdraw}
          disabled={withdrawing || !withdrawDest.trim() || (!withdrawAll && !withdrawAmount)}
          style={[s.toggleChip, { borderColor: '#ef444450', backgroundColor: '#ef4444', opacity: (withdrawing || !withdrawDest.trim()) ? 0.5 : 1 }]}
        >
          {withdrawing ? <ActivityIndicator size="small" color="#e8e8e8" /> : <Text style={[s.toggleChipText, { color: '#e8e8e8' }]}>Withdraw SOL</Text>}
        </Pressable>

        {withdrawMessage && (
          <Text style={[s.listMeta, { marginTop: 8, color: withdrawMessage.startsWith('Sent') ? '#22c55e' : '#ef4444' }]}>{withdrawMessage}</Text>
        )}
      </View>

      <View style={[s.listCard, { marginTop: 12 }]}>
        <View style={s.listTop}>
          <View style={{ flex: 1 }}>
            <Text style={s.listTitle}>Autopilot</Text>
            <Text style={[s.listMeta, { marginTop: 6 }]}>Server-side trading through the bot wallet. First pass auto-executes SOL-funded queued actions and featured ideas that fit your limits.</Text>
          </View>
          {loadingConfig && <ActivityIndicator size="small" color={ACCENT} />}
        </View>

        {config && (
          <>
            <Text style={s.fieldLabel}>Autopilot status</Text>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              <Pressable onPress={() => setConfig(prev => prev ? { ...prev, isEnabled: !prev.isEnabled } : prev)} style={[s.toggleChip, config.isEnabled ? { borderColor: '#22c55e50', backgroundColor: '#22c55e18' } : { borderColor: '#ef444440', backgroundColor: '#ef444412' }]}>
                <Text style={[s.toggleChipText, { color: config.isEnabled ? '#22c55e' : '#ef4444' }]}>{config.isEnabled ? 'Enabled' : 'Disabled'}</Text>
              </Pressable>
              <Pressable onPress={() => setConfig(prev => prev ? { ...prev, autoPauseOnError: !prev.autoPauseOnError } : prev)} style={[s.toggleChip, { borderColor: config.autoPauseOnError ? '#f59e0b30' : '#ffffff12', backgroundColor: config.autoPauseOnError ? '#f59e0b08' : '#ffffff04' }]}>
                <Text style={[s.toggleChipText, { color: config.autoPauseOnError ? '#f59e0b' : '#6f6f6f' }]}>{config.autoPauseOnError ? 'Pause On Error' : 'Keep Running On Error'}</Text>
              </Pressable>
            </View>

            <Text style={s.fieldLabel}>Trade sources</Text>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              <Pressable onPress={() => setConfig(prev => prev ? { ...prev, allowPendingActions: !prev.allowPendingActions } : prev)} style={[s.toggleChip, { borderColor: config.allowPendingActions ? '#84cc1640' : '#ffffff12', backgroundColor: config.allowPendingActions ? '#84cc1612' : '#ffffff04' }]}>
                <Text style={[s.toggleChipText, { color: config.allowPendingActions ? '#84cc16' : '#6f6f6f' }]}>Queue Actions</Text>
              </Pressable>
              <Pressable onPress={() => setConfig(prev => prev ? { ...prev, allowFeaturedTrades: !prev.allowFeaturedTrades } : prev)} style={[s.toggleChip, { borderColor: config.allowFeaturedTrades ? '#f59e0b40' : '#ffffff12', backgroundColor: config.allowFeaturedTrades ? '#f59e0b12' : '#ffffff04' }]}>
                <Text style={[s.toggleChipText, { color: config.allowFeaturedTrades ? '#f59e0b' : '#6f6f6f' }]}>Featured Ideas</Text>
              </Pressable>
            </View>

            <Text style={s.fieldLabel}>Strategy mode</Text>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              {[
                { key: 'hybrid', label: 'Hybrid' },
                { key: 'queue_only', label: 'Queue First' },
                { key: 'featured_only', label: 'Ideas Only' },
                { key: 'momentum_rotation', label: 'Momentum' },
              ].map(option => (
                <Pressable
                  key={option.key}
                  onPress={() => setConfig(prev => prev ? { ...prev, strategyMode: option.key as TradingBotAutopilotConfig['strategyMode'] } : prev)}
                  style={[s.toggleChip, { borderColor: config.strategyMode === option.key ? '#6366f150' : '#ffffff12', backgroundColor: config.strategyMode === option.key ? '#6366f115' : '#ffffff04' }]}
                >
                  <Text style={[s.toggleChipText, { color: config.strategyMode === option.key ? '#818cf8' : '#6f6f6f' }]}>{option.label}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={s.fieldLabel}>Minimum confidence</Text>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              {['high', 'medium', 'low'].map(level => (
                <Pressable
                  key={level}
                  onPress={() => setConfig(prev => prev ? { ...prev, minConfidence: level as TradingBotAutopilotConfig['minConfidence'] } : prev)}
                  style={[s.toggleChip, { borderColor: config.minConfidence === level ? '#22c55e50' : '#ffffff12', backgroundColor: config.minConfidence === level ? '#22c55e15' : '#ffffff04' }]}
                >
                  <Text style={[s.toggleChipText, { color: config.minConfidence === level ? '#22c55e' : '#6f6f6f' }]}>{level.toUpperCase()}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={[s.fieldLabel, { marginTop: 4 }]}>Max trade size (SOL)</Text>
            <TextInput value={maxTradeSol} onChangeText={setMaxTradeSol} keyboardType="decimal-pad" placeholder="0.25" placeholderTextColor="#6f6f6f" style={[s.input, { marginBottom: 10 }]} />

            <Text style={s.fieldLabel}>Max trades per day</Text>
            <TextInput value={maxDailyTrades} onChangeText={setMaxDailyTrades} keyboardType="number-pad" placeholder="3" placeholderTextColor="#6f6f6f" style={[s.input, { marginBottom: 10 }]} />

            <Text style={s.fieldLabel}>Slippage cap (bps)</Text>
            <TextInput value={slippageCap} onChangeText={setSlippageCap} keyboardType="number-pad" placeholder="150" placeholderTextColor="#6f6f6f" style={[s.input, { marginBottom: 14 }]} />

            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable onPress={handleSaveConfig} disabled={savingConfig} style={[s.toggleChip, { flex: 1, borderColor: '#22c55e50', backgroundColor: '#22c55e' }]}>
                {savingConfig ? <ActivityIndicator size="small" color="#e8e8e8" /> : <Text style={[s.toggleChipText, { color: '#e8e8e8' }]}>Save Rules</Text>}
              </Pressable>
              <Pressable onPress={handleRunAutopilot} disabled={runningAutopilot || botWallet.status !== 'active'} style={[s.toggleChip, { flex: 1, borderColor: '#84cc1640', backgroundColor: '#84cc1612' }]}>
                {runningAutopilot ? <ActivityIndicator size="small" color="#84cc16" /> : <Text style={[s.toggleChipText, { color: '#84cc16' }]}>Run Now</Text>}
              </Pressable>
            </View>

            {/* ── Momentum Scan UI ── */}
            {config.strategyMode === 'momentum_rotation' && (
              <View nativeID="section-bot-momentum" style={{ marginTop: 14 }}>
                <Pressable
                  onPress={handleScanMomentum}
                  disabled={scanning || botWallet.status !== 'active'}
                  style={[s.toggleChip, { borderColor: '#06b6d450', backgroundColor: '#06b6d418', opacity: scanning ? 0.6 : 1 }]}
                >
                  {scanning ? <ActivityIndicator size="small" color="#06b6d4" /> : <Text style={[s.toggleChipText, { color: '#06b6d4' }]}>Scan Momentum</Text>}
                </Pressable>

                {scanResult && (
                  <View style={{ marginTop: 12 }}>
                    {/* Holdings */}
                    {scanResult.holdings.length > 0 && (
                      <>
                        <Text style={[s.fieldLabel, { marginBottom: 6 }]}>Holdings</Text>
                        {scanResult.holdings.map((h) => (
                          <View key={h.mint} style={[s.reasonBox, { marginBottom: 6, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}>
                            <View style={{ flex: 1 }}>
                              <Text style={[s.toggleChipText, { color: '#e8e8e8', fontSize: 12 }]}>{h.symbol}</Text>
                              <Text style={[s.listMeta, { fontSize: 10 }]}>${h.price.toFixed(4)} — ${h.valueUsd.toFixed(2)}</Text>
                            </View>
                            <View style={{ alignItems: 'flex-end' }}>
                              <Text style={[s.toggleChipText, {
                                fontSize: 11,
                                color: h.signal.action === 'exit' ? '#ef4444' : h.signal.action === 'enter' ? '#22c55e' : '#6f6f6f',
                              }]}>
                                {h.signal.action.toUpperCase()} ({h.signal.score})
                              </Text>
                              <Text style={[s.listMeta, { fontSize: 9 }]}>{h.signal.reasons.slice(0, 2).join(' | ')}</Text>
                            </View>
                          </View>
                        ))}
                      </>
                    )}

                    {/* Exit signals */}
                    {scanResult.exitCandidates.length > 0 && (
                      <>
                        <Text style={[s.fieldLabel, { color: '#ef4444', marginTop: 8, marginBottom: 4 }]}>Exit Signals</Text>
                        {scanResult.exitCandidates.map((h) => (
                          <View key={h.mint} style={[s.reasonBox, { marginBottom: 4, borderColor: '#ef444430' }]}>
                            <Text style={[s.toggleChipText, { color: '#ef4444', fontSize: 11 }]}>{h.symbol} → USDC (score {h.signal.score})</Text>
                            <Text style={[s.listMeta, { fontSize: 9 }]}>{h.signal.reasons.join(' | ')}</Text>
                          </View>
                        ))}
                      </>
                    )}

                    {/* Entry signals */}
                    {scanResult.entryCandidates.length > 0 && (
                      <>
                        <Text style={[s.fieldLabel, { color: '#22c55e', marginTop: 8, marginBottom: 4 }]}>Entry Signals</Text>
                        {scanResult.entryCandidates.map((h) => (
                          <View key={h.mint} style={[s.reasonBox, { marginBottom: 4, borderColor: '#22c55e30' }]}>
                            <Text style={[s.toggleChipText, { color: '#22c55e', fontSize: 11 }]}>USDC → {h.symbol} (score {h.signal.score})</Text>
                            <Text style={[s.listMeta, { fontSize: 9 }]}>{h.signal.reasons.join(' | ')}</Text>
                          </View>
                        ))}
                      </>
                    )}

                    {scanResult.holdings.length === 0 && scanResult.exitCandidates.length === 0 && scanResult.entryCandidates.length === 0 && (
                      <Text style={[s.listMeta, { marginTop: 8 }]}>No token positions or signals found. Fund the wallet with USDC or tokens to start momentum tracking.</Text>
                    )}
                  </View>
                )}
              </View>
            )}

            <View style={[s.reasonBox, { marginTop: 12 }]}>
              <Text style={s.reasonText}>
                {config.strategyMode === 'momentum_rotation'
                  ? 'Momentum mode scans token positions, exits losers to USDC, and enters gainers from USDC. Autopilot runs this on each cycle.'
                  : 'Autopilot scans every ~2 minutes while the Trading Bot dashboard is open. The same backend action can later be triggered by cron or circle automations.'}
              </Text>
            </View>

            <Text style={[s.listMeta, { marginTop: 8 }]}>Last scan: {config.lastRunAt ? new Date(config.lastRunAt).toLocaleString() : 'Never'}</Text>
            <Text style={s.listMeta}>Last auto trade: {config.lastTradeAt ? new Date(config.lastTradeAt).toLocaleString() : 'None yet'}</Text>
            <Text style={s.listMeta}>Wallet mode: {config.strategyMode === 'momentum_rotation' ? 'Momentum rotation with USDC reserve' : 'SOL-funded autopilot with reserve protection and daily trade caps'}.</Text>
            {config.lastError && <Text style={[s.listMeta, { color: '#ef4444', marginTop: 8 }]}>Last error: {config.lastError}</Text>}
          </>
        )}
      </View>

      {statusMessage && (
        <View style={[s.reasonBox, { marginTop: 12 }]}> 
          <Text style={s.reasonText}>{statusMessage}</Text>
        </View>
      )}
    </ScrollView>
  );
}

// ??? Featured Trades Tab ??????????????????????????????????????????????????????

function FeaturedTab({ client, walletAddress, userId, circleId, botWallet, onBotWalletRefresh }: { client: HeliusClient; walletAddress: string | null; userId: string; circleId: string; botWallet: TradingBotWalletInfo | null; onBotWalletRefresh: () => Promise<void> }) {
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
    const activeBotWallet = botWallet?.status === 'active' ? botWallet : null;
    const executionAddress = activeBotWallet?.address || walletAddress;
    if (!executionAddress) return;
    setExecuting(trade.id);
    try {
      const amountLamports = Math.floor(trade.suggestedAmountSol * 1e9);
      const result = activeBotWallet
        ? await executeBotWalletSwap({
            circleId,
            inputMint: trade.inputMint,
            outputMint: trade.outputMint,
            amount: amountLamports,
            slippageBps: trade.suggestedSlippageBps,
          })
        : {
            ...(await client.executeSwap({
              inputMint: trade.inputMint,
              outputMint: trade.outputMint,
              amount: amountLamports,
              slippageBps: trade.suggestedSlippageBps,
              userPublicKey: executionAddress,
            })),
            walletAddress: undefined,
          };

      if (result.success && result.txHash) {
        await executeFeaturedTrade(trade.id, result.txHash, result.inputAmount, result.outputAmount);
        await logTrade({
          userId,
          circleId,
          walletAddress: result.walletAddress || executionAddress,
          action: 'swap',
          inputMint: trade.inputMint,
          outputMint: trade.outputMint,
          inputAmount: result.inputAmount,
          outputAmount: result.outputAmount,
          txHash: result.txHash,
          status: 'success',
          reason: `Featured: ${trade.title}`,
          strategyName: activeBotWallet ? 'featured_bot_wallet' : 'featured_manual',
          metadata: {
            featuredTradeId: trade.id,
            executionWallet: activeBotWallet ? 'bot_wallet' : 'phantom',
          },
        });
        await onBotWalletRefresh();
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
                <Text style={s.featuredTagText}>{trade.inputSymbol} {'->'} {trade.outputSymbol}</Text>
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
              disabled={!(botWallet?.status === 'active' ? botWallet.address : walletAddress) || isExecuting}
              style={[s.actionBtn, { backgroundColor: trade.direction === 'buy' ? '#22c55e' : '#ef4444', marginTop: 8 }]}
            >
              {isExecuting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={[s.actionText, { color: '#e8e8e8' }]}>
                  {botWallet?.status === 'active' ? `Execute with Bot Wallet - ${trade.suggestedAmountSol} SOL` : walletAddress ? `Execute ${trade.direction === 'buy' ? 'Buy' : 'Sell'} - ${trade.suggestedAmountSol} SOL` : 'Create Bot Wallet or Link Phantom'}
                </Text>
              )}
            </Pressable>

            {/* Meta */}
            <Text style={s.listTime}>
              Generated by {trade.generatedBy} | {new Date(trade.createdAt).toLocaleString()}
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

// ??? Pending Actions Tab ??????????????????????????????????????????????????????

function PendingTab({ client, walletAddress, userId, circleId, botWallet, onBotWalletRefresh }: { client: HeliusClient; walletAddress: string | null; userId: string; circleId: string; botWallet: TradingBotWalletInfo | null; onBotWalletRefresh: () => Promise<void> }) {
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
    const activeBotWallet = botWallet?.status === 'active' ? botWallet : null;
    const executionAddress = activeBotWallet?.address || walletAddress;
    if (!executionAddress) return;
    setExecuting(action.id);
    try {
      // Approve first
      await approveAction(action.id);

      // Execute swap via Jupiter + Phantom
      console.log('[handleExecute] Starting swap...', { inputMint: action.inputMint, outputMint: action.outputMint, amount: action.amountLamports });
      const result = activeBotWallet
        ? await executeBotWalletSwap({
            circleId,
            inputMint: action.inputMint,
            outputMint: action.outputMint,
            amount: action.amountLamports,
            slippageBps: action.slippageBps,
          })
        : {
            ...(await client.executeSwap({
              inputMint: action.inputMint,
              outputMint: action.outputMint,
              amount: action.amountLamports,
              slippageBps: action.slippageBps,
              userPublicKey: executionAddress,
            })),
            walletAddress: undefined,
          };
      console.log('[handleExecute] Swap result:', JSON.stringify(result));

      if (result.success && result.txHash) {
        await markActionExecuted(action.id, result.txHash, result.outputAmount);
        await logTrade({
          userId,
          circleId,
          walletAddress: result.walletAddress || executionAddress,
          action: action.actionType as any,
          inputMint: action.inputMint,
          outputMint: action.outputMint,
          inputAmount: result.inputAmount,
          outputAmount: result.outputAmount,
          txHash: result.txHash,
          status: 'success',
          reason: action.reason || undefined,
          strategyName: activeBotWallet ? 'pending_action_bot_wallet' : 'pending_action_manual',
          metadata: {
            pendingActionId: action.id,
            actionSource: action.source,
            proposedBy: action.proposedBy,
            executionWallet: activeBotWallet ? 'bot_wallet' : 'phantom',
          },
        });
        await onBotWalletRefresh();
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
        Automations propose trades here. Review and execute them with your bot wallet or Phantom.
      </Text>

      {pendingActions.length === 0 && (
        <View style={s.emptyCard}>
          <Text style={s.emptyTitle}>No Pending Actions</Text>
          <Text style={s.emptyDesc}>
            When trading automations (DCA Bot, Price Alerts) detect opportunities, they'll queue trades here for execution with your bot wallet or Phantom.
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
                  disabled={!(botWallet?.status === 'active' ? botWallet.address : walletAddress) || executing === action.id}
                  style={[s.pendingBtn, s.pendingBtnApprove]}
                >
                  {executing === action.id ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={[s.pendingBtnText, { color: '#e8e8e8' }]}>
                      {botWallet?.status === 'active' ? 'Approve & Execute via Bot Wallet' : walletAddress ? 'Approve & Execute' : 'Create Bot Wallet or Link Phantom'}
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

// ??? Portfolio Tab ????????????????????????????????????????????????????????????

function PortfolioTab({ client, walletAddress, userId, circleId }: { client: HeliusClient; walletAddress: string | null; userId: string; circleId: string }) {
  const [portfolio, setPortfolio] = useState<PortfolioSnapshot | null>(null);
  const [allocation, setAllocation] = useState<Array<{ mint: string; symbol: string; valuePct: number; valueUsd: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPreset, setSelectedPreset] = useState<RebalancePresetId>('core');
  const [targetRows, setTargetRows] = useState<RebalanceTargetInput[]>(() => buildTargetRows('core'));
  const [plan, setPlan] = useState<RebalancePlan | null>(null);
  const [planning, setPlanning] = useState(false);
  const [queueing, setQueueing] = useState(false);
  const [plannerMessage, setPlannerMessage] = useState<string | null>(null);

  useEffect(() => {
    if (walletAddress) {
      loadPortfolio();
    } else {
      setLoading(false);
    }
  }, [walletAddress]);

  useEffect(() => {
    setTargetRows(buildTargetRows(selectedPreset));
    setPlan(null);
    setPlannerMessage(null);
  }, [selectedPreset]);

  const loadPortfolio = async () => {
    setLoading(true);
    try {
      const [snap, alloc] = await Promise.all([
        client.getPortfolio(walletAddress!),
        getPortfolioAllocation(client, walletAddress!),
      ]);
      setPortfolio(snap);
      setAllocation(alloc);
    } catch {
      setPortfolio(null);
      setAllocation([]);
    }
    setLoading(false);
  };

  const handleGeneratePlan = async () => {
    if (!walletAddress) return;
    const targets = targetRows
      .map(row => {
        const meta = getTokenMetaBySymbol(row.symbol);
        const targetPct = parseFloat(row.targetPct);
        return meta && Number.isFinite(targetPct) && targetPct > 0
          ? { mint: meta.mint, symbol: meta.symbol, targetPct }
          : null;
      })
      .filter(Boolean) as Array<{ mint: string; symbol: string; targetPct: number }>;

    const totalTargetPct = targets.reduce((sum, target) => sum + target.targetPct, 0);
    if (targets.length === 0) {
      setPlannerMessage('Add at least one target allocation before generating a rebalance plan.');
      return;
    }
    if (Math.abs(totalTargetPct - 100) > 0.1) {
      setPlannerMessage(`Target allocation must total 100%. Current total: ${totalTargetPct.toFixed(1)}%.`);
      return;
    }

    setPlanning(true);
    setPlannerMessage(null);
    try {
      const nextPlan = await generateRebalancePlan(client, walletAddress, targets);
      setPlan(nextPlan);
      if (nextPlan.estimatedSwaps === 0) {
        setPlannerMessage('Portfolio is already within the target drift band. No rebalance trades are needed right now.');
      }
    } catch (err: any) {
      setPlannerMessage(`Failed to generate rebalance plan: ${err.message || err}`);
    }
    setPlanning(false);
  };

  const handleQueuePlan = async () => {
    if (!portfolio || !plan) return;
    setQueueing(true);
    try {
      const tokenLookup = new Map(portfolio.tokens.map(token => [token.mint, token]));
      const solPrice = tokenLookup.get(SOL_MINT)?.priceUsd || (await fetchTokenMarketSnapshot(SOL_MINT))?.priceUsd || 0;
      const actions = [] as any[];

      for (const target of plan.targets.filter(item => item.action !== 'hold' && item.amountUsd > 1)) {
        if (target.action === 'buy') {
          if (solPrice <= 0) continue;
          const amountLamports = Math.max(1, Math.round((target.amountUsd / solPrice) * 1e9));
          actions.push({
            user_id: userId,
            circle_id: circleId,
            action_type: 'swap',
            input_mint: SOL_MINT,
            output_mint: target.tokenMint,
            amount_lamports: amountLamports,
            slippage_bps: 150,
            reason: `Rebalance buy ${target.tokenSymbol}: move from ${target.currentPct.toFixed(1)}% to ${target.targetPct.toFixed(1)}% target allocation.`,
            proposed_by: 'Backpack Rebalance',
            source: 'rebalance',
            metadata: {
              preset: selectedPreset,
              target_pct: target.targetPct,
              current_pct: target.currentPct,
              amount_usd: target.amountUsd,
            },
          });
        } else {
          const token = tokenLookup.get(target.tokenMint);
          const tokenPrice = token?.priceUsd || (await fetchTokenMarketSnapshot(target.tokenMint))?.priceUsd || 0;
          if (tokenPrice <= 0) continue;
          const decimals = token?.decimals || getTokenMetaByMint(target.tokenMint).decimals;
          const tokenQty = target.amountUsd / tokenPrice;
          const amountLamports = Math.max(1, Math.round(tokenQty * Math.pow(10, decimals)));
          actions.push({
            user_id: userId,
            circle_id: circleId,
            action_type: 'swap',
            input_mint: target.tokenMint,
            output_mint: SOL_MINT,
            amount_lamports: amountLamports,
            slippage_bps: 150,
            reason: `Rebalance sell ${target.tokenSymbol}: move from ${target.currentPct.toFixed(1)}% to ${target.targetPct.toFixed(1)}% target allocation.`,
            proposed_by: 'Backpack Rebalance',
            source: 'rebalance',
            metadata: {
              preset: selectedPreset,
              target_pct: target.targetPct,
              current_pct: target.currentPct,
              amount_usd: target.amountUsd,
            },
          });
        }
      }

      if (actions.length === 0) {
        setPlannerMessage('The rebalance plan did not produce any executable swaps. Refresh portfolio data and try again.');
      } else {
        const { error } = await supabase.from('trading_pending_actions').insert(actions);
        if (error) throw error;
        setPlannerMessage(`${actions.length} rebalance actions were added to Queue for review and approval.`);
      }
    } catch (err: any) {
      setPlannerMessage(`Failed to queue rebalance actions: ${err.message || err}`);
    }
    setQueueing(false);
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

      <Text style={s.label}>WALLET</Text>
      <View style={s.infoRow}>
        <Text style={s.mono}>{walletAddress.slice(0, 8)}...{walletAddress.slice(-6)}</Text>
      </View>

      <View style={[s.sectionHeader, { marginTop: 16 }]}> 
        <Text style={s.label}>CURRENT ALLOCATION</Text>
        <Pressable onPress={loadPortfolio} style={s.addBtn}>
          <Text style={s.addText}>Refresh</Text>
        </Pressable>
      </View>

      {allocation.length === 0 ? (
        <View style={s.emptyCard}>
          <Text style={s.emptyDesc}>No priced holdings available yet for allocation analysis.</Text>
        </View>
      ) : (
        allocation.slice(0, 8).map(item => (
          <View key={item.mint} style={[s.listCard, { marginBottom: 8 }]}> 
            <View style={s.listTop}>
              <Text style={s.listTitle}>{item.symbol}</Text>
              <Text style={s.alertBadge}>{item.valuePct.toFixed(1)}%</Text>
            </View>
            <View style={{ height: 6, backgroundColor: '#111111', borderRadius: 999, overflow: 'hidden', marginTop: 8 }}>
              <View style={{ width: `${Math.min(item.valuePct, 100)}%`, height: 6, backgroundColor: ACCENT }} />
            </View>
            <Text style={[s.listMeta, { marginTop: 8 }]}>{formatCompactUsd(item.valueUsd)} deployed</Text>
          </View>
        ))
      )}

      <Text style={[s.label, { marginTop: 20 }]}>REBALANCE PLANNER</Text>
      <Text style={[s.emptyDesc, { textAlign: 'left', marginBottom: 10 }]}>Inspired by popular rebalancing bots: set a target allocation, preview drift, then queue the swaps for approval in Queue.</Text>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {(Object.keys(REBALANCE_PRESETS) as RebalancePresetId[]).map(preset => (
            <Pressable
              key={preset}
              onPress={() => setSelectedPreset(preset)}
              style={[s.tab, selectedPreset === preset && { backgroundColor: ACCENT + '18', borderColor: ACCENT + '40' }]}
            >
              <Text style={[s.tabText, selectedPreset === preset && { color: ACCENT }]}>{REBALANCE_PRESETS[preset].label}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>

      <View style={s.formCard}>
        {targetRows.map((row, index) => (
          <View key={`${row.symbol}-${index}`} style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={s.fieldLabel}>Token</Text>
              <TextInput
                style={s.input}
                value={row.symbol}
                onChangeText={(value) => setTargetRows(prev => prev.map((item, itemIndex) => itemIndex === index ? { ...item, symbol: value.toUpperCase().replace(/[^A-Z]/g, '') } : item))}
                placeholder="SOL"
                placeholderTextColor="#555"
                maxLength={8}
              />
            </View>
            <View style={{ width: 120 }}>
              <Text style={s.fieldLabel}>Target %</Text>
              <TextInput
                style={s.input}
                value={row.targetPct}
                onChangeText={(value) => setTargetRows(prev => prev.map((item, itemIndex) => itemIndex === index ? { ...item, targetPct: value } : item))}
                placeholder="0"
                placeholderTextColor="#555"
                keyboardType="decimal-pad"
              />
            </View>
          </View>
        ))}
        <Text style={[s.listMeta, { marginBottom: 12 }]}>Total target: {targetRows.reduce((sum, row) => sum + (parseFloat(row.targetPct) || 0), 0).toFixed(1)}%</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Pressable style={[s.actionBtn, { flex: 1, backgroundColor: ACCENT + '22' }]} onPress={handleGeneratePlan} disabled={planning}>
            <Text style={[s.actionText, { color: ACCENT }]}>{planning ? 'BUILDING PLAN...' : 'Build Plan'}</Text>
          </Pressable>
          <Pressable
            style={[s.actionBtn, { flex: 1, backgroundColor: '#22c55e15', borderColor: '#22c55e30', opacity: plan && plan.estimatedSwaps > 0 ? 1 : 0.5 }]}
            onPress={handleQueuePlan}
            disabled={!plan || plan.estimatedSwaps === 0 || queueing}
          >
            <Text style={[s.actionText, { color: '#22c55e' }]}>{queueing ? 'QUEUEING...' : 'Queue Actions'}</Text>
          </Pressable>
        </View>
      </View>

      {plannerMessage && (
        <View style={[s.resultBanner, { borderColor: plannerMessage.includes('Failed') ? '#ef444430' : '#22c55e30' }]}>
          <Text style={[s.resultText, { color: plannerMessage.includes('Failed') ? '#ef4444' : '#22c55e' }]}>{plannerMessage}</Text>
        </View>
      )}

      {plan && (
        <View style={[s.listCard, { marginTop: 8 }]}> 
          <View style={s.listTop}>
            <Text style={s.listTitle}>REBALANCE PREVIEW</Text>
            <Text style={s.listMeta}>{formatCompactUsd(plan.totalPortfolioValue)} portfolio</Text>
          </View>
          <Text style={[s.listMeta, { marginTop: 8 }]}>Estimated swaps: {plan.estimatedSwaps} | Estimated fees: ${plan.estimatedFeesUsd.toFixed(2)}</Text>
          {plan.targets.map(target => (
            <View key={target.tokenMint} style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#ffffff08' }}>
              <View style={s.listTop}>
                <Text style={s.listTitle}>{target.tokenSymbol}</Text>
                <Text style={[s.alertBadge, { color: target.action === 'buy' ? '#22c55e' : target.action === 'sell' ? '#ef4444' : '#9e9e9e' }]}>
                  {target.action.toUpperCase()}
                </Text>
              </View>
              <Text style={s.listMeta}>Current {target.currentPct.toFixed(1)}% {'>'} Target {target.targetPct.toFixed(1)}% ({target.diffPct >= 0 ? '+' : ''}{target.diffPct.toFixed(1)} pts)</Text>
              <Text style={[s.listMeta, { marginTop: 4 }]}>Trade size: {formatCompactUsd(target.amountUsd)}</Text>
            </View>
          ))}
        </View>
      )}

      <Text style={[s.label, { marginTop: 20 }]}>HOLDINGS</Text>
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
    </ScrollView>
  );
}

function TradeTab({ client, walletAddress, userId, circleId, botWallet, onBotWalletRefresh }: { client: HeliusClient; walletAddress: string | null; userId: string; circleId: string; botWallet: TradingBotWalletInfo | null; onBotWalletRefresh: () => Promise<void> }) {
  const [inputMint, setInputMint] = useState(SOL_MINT);
  const [outputMint, setOutputMint] = useState(USDC_MINT);
  const [amount, setAmount] = useState('');
  const [slippagePct, setSlippagePct] = useState('1.0');
  const [stopLossPct, setStopLossPct] = useState('');
  const [takeProfitPct, setTakeProfitPct] = useState('');
  const [trailingStopPct, setTrailingStopPct] = useState('');
  const [quote, setQuote] = useState<SwapQuoteResult | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const inputMeta = getTokenMetaByMint(inputMint);
  const activeBotWallet = botWallet?.status === 'active' ? botWallet : null;
  const executionAddress = activeBotWallet?.address || walletAddress;
  const outputMeta = getTokenMetaByMint(outputMint);
  const inputDecimals = inputMeta.decimals;
  const outputDecimals = outputMeta.decimals;

  const handleQuote = async () => {
    if (!executionAddress) return;
    const parsedAmount = parseFloat(amount);
    const parsedSlippage = parseFloat(slippagePct);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setResult({ ok: false, msg: 'Enter a valid trade size before requesting a quote.' });
      return;
    }
    if (inputMint === outputMint) {
      setResult({ ok: false, msg: 'Choose two different tokens for the swap.' });
      return;
    }

    setQuoting(true);
    setQuote(null);
    setResult(null);
    try {
      const q = await client.getSwapQuote({
        inputMint,
        outputMint,
        amount: Math.floor(parsedAmount * Math.pow(10, inputDecimals)),
        slippageBps: Math.round((Number.isFinite(parsedSlippage) ? parsedSlippage : 1) * 100),
        userPublicKey: executionAddress,
      });
      setQuote(q);
    } catch (err: any) {
      setResult({ ok: false, msg: err.message });
    }
    setQuoting(false);
  };

  const handleSwap = async () => {
    if (!quote || !executionAddress) return;
    setSwapping(true);
    try {
      const parsedAmount = parseFloat(amount);
      const parsedSlippage = parseFloat(slippagePct);
      const res = activeBotWallet
        ? await executeBotWalletSwap({
            circleId,
            inputMint,
            outputMint,
            amount: Math.floor(parsedAmount * Math.pow(10, inputDecimals)),
            slippageBps: Math.round((Number.isFinite(parsedSlippage) ? parsedSlippage : 1) * 100),
          })
        : {
            ...(await client.executeSwap({
              inputMint,
              outputMint,
              amount: Math.floor(parsedAmount * Math.pow(10, inputDecimals)),
              slippageBps: Math.round((Number.isFinite(parsedSlippage) ? parsedSlippage : 1) * 100),
              userPublicKey: executionAddress,
            })),
            walletAddress: undefined,
          };

      if (res.success) {
        await logTrade({
          userId,
          circleId,
          walletAddress: res.walletAddress || executionAddress,
          action: 'swap',
          inputMint,
          outputMint,
          inputAmount: res.inputAmount,
          outputAmount: res.outputAmount,
          txHash: res.txHash,
          status: 'success',
          reason: (parsePositiveNumber(stopLossPct) || parsePositiveNumber(takeProfitPct) || parsePositiveNumber(trailingStopPct)) ? 'Protected manual trade' : undefined,
          strategyName: activeBotWallet ? 'smart_trade_bot_wallet' : 'smart_trade_manual',
          metadata: {
            executionWallet: activeBotWallet ? 'bot_wallet' : 'phantom',
            stopLossPct: parsePositiveNumber(stopLossPct) || null,
            takeProfitPct: parsePositiveNumber(takeProfitPct) || null,
            trailingStopPct: parsePositiveNumber(trailingStopPct) || null,
          },
        });

        await onBotWalletRefresh();
        let message = `Swap successful! TX: ${res.txHash?.slice(0, 12)}...`;
        const stopLoss = parsePositiveNumber(stopLossPct);
        const takeProfit = parsePositiveNumber(takeProfitPct);
        const trailingStop = parsePositiveNumber(trailingStopPct);

        if (stopLoss || takeProfit || trailingStop) {
          const outputQty = convertFromSmallestUnit(res.outputAmount, outputMint);
          const outputSnapshot = await fetchTokenMarketSnapshot(outputMint);
          const inputSnapshot = await fetchTokenMarketSnapshot(inputMint);
          const livePrice = outputSnapshot?.priceUsd || 0;
          const derivedPrice = outputQty > 0 && inputSnapshot?.priceUsd
            ? (parsedAmount * inputSnapshot.priceUsd) / outputQty
            : 0;
          const entryPrice = livePrice || derivedPrice;

          if (entryPrice > 0 && outputQty > 0) {
            await savePosition({
              userId,
              tokenMint: outputMint,
              tokenSymbol: outputMeta.symbol,
              side: 'long',
              entryPrice,
              quantity: outputQty,
              stopLossPrice: stopLoss ? entryPrice * (1 - (stopLoss / 100)) : undefined,
              takeProfitPrice: takeProfit ? entryPrice * (1 + (takeProfit / 100)) : undefined,
              trailingStopPct: trailingStop,
              entryTxHash: res.txHash,
              circleId,
              strategyName: activeBotWallet ? 'smart_trade_bot_wallet' : 'smart_trade_manual',
            });
            message += ' Protected position saved to Positions.';
          } else {
            message += ' Swap completed, but a protected position could not be created because live pricing was unavailable.';
          }
        }

        setResult({ ok: true, msg: message });
      } else {
        setResult({ ok: false, msg: res.error || 'Swap failed' });
      }
    } catch (err: any) {
      setResult({ ok: false, msg: err.message });
    }
    setSwapping(false);
  };

  if (!executionAddress) {
    return (
      <View style={s.center}>
        <Text style={s.emptyTitle}>Create a Trading Wallet</Text>
        <Text style={s.emptyDesc}>Create a Bot Wallet in this dashboard or link Phantom to execute swaps.</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={s.scrollPad}>
      <Text style={s.label}>SMART TRADE</Text>
      <Text style={[s.emptyDesc, { textAlign: 'left', marginBottom: 12 }]}>Manual swaps now support SmartTrade-style slippage and optional stop-loss, take-profit, and trailing protection. If a Bot Wallet is active, trades execute server-side without Phantom prompts.</Text>

      <Text style={s.fieldLabel}>Quick input token</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {COMMON_TRADING_SYMBOLS.map(symbol => {
            const meta = getTokenMetaBySymbol(symbol);
            if (!meta) return null;
            return (
              <Pressable key={`in-${symbol}`} onPress={() => setInputMint(meta.mint)} style={[s.quickBtn, inputMint === meta.mint && { borderColor: ACCENT + '60', backgroundColor: ACCENT + '15' }]}>
                <Text style={s.quickText}>{symbol}</Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <View style={s.fieldGroup}>
        <Text style={s.fieldLabel}>From mint</Text>
        <TextInput style={s.input} value={inputMint} onChangeText={setInputMint} placeholder="Input token mint..." placeholderTextColor="#555" />
        <Text style={[s.listMeta, { marginTop: 4 }]}>{inputMeta.name} ({inputMeta.symbol})</Text>
      </View>

      <Text style={s.fieldLabel}>Quick output token</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {COMMON_TRADING_SYMBOLS.map(symbol => {
            const meta = getTokenMetaBySymbol(symbol);
            if (!meta) return null;
            return (
              <Pressable key={`out-${symbol}`} onPress={() => setOutputMint(meta.mint)} style={[s.quickBtn, outputMint === meta.mint && { borderColor: ACCENT + '60', backgroundColor: ACCENT + '15' }]}>
                <Text style={s.quickText}>{symbol}</Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <View style={s.fieldGroup}>
        <Text style={s.fieldLabel}>To mint</Text>
        <TextInput style={s.input} value={outputMint} onChangeText={setOutputMint} placeholder="Output token mint..." placeholderTextColor="#555" />
        <Text style={[s.listMeta, { marginTop: 4 }]}>{outputMeta.name} ({outputMeta.symbol})</Text>
      </View>

      <View style={s.fieldGroup}>
        <Text style={s.fieldLabel}>Amount ({inputMeta.symbol})</Text>
        <TextInput style={s.input} value={amount} onChangeText={setAmount} placeholder="0.0" placeholderTextColor="#555" keyboardType="decimal-pad" />
      </View>

      <View style={s.quickRow}>
        {['0.1', '0.5', '1.0', '5.0'].map(v => (
          <Pressable key={v} onPress={() => setAmount(v)} style={s.quickBtn}>
            <Text style={s.quickText}>{v} {inputMeta.symbol}</Text>
          </Pressable>
        ))}
      </View>

      <View style={s.fieldGroup}>
        <Text style={s.fieldLabel}>Slippage tolerance (%)</Text>
        <TextInput style={s.input} value={slippagePct} onChangeText={setSlippagePct} placeholder="1.0" placeholderTextColor="#555" keyboardType="decimal-pad" />
      </View>

      <View style={[s.formCard, { marginTop: 8 }]}> 
        <Text style={[s.label, { marginBottom: 10 }]}>PROTECTED POSITION</Text>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <View style={{ flex: 1, minWidth: 120 }}>
            <Text style={s.fieldLabel}>Stop loss %</Text>
            <TextInput style={s.input} value={stopLossPct} onChangeText={setStopLossPct} placeholder="8" placeholderTextColor="#555" keyboardType="decimal-pad" />
          </View>
          <View style={{ flex: 1, minWidth: 120 }}>
            <Text style={s.fieldLabel}>Take profit %</Text>
            <TextInput style={s.input} value={takeProfitPct} onChangeText={setTakeProfitPct} placeholder="15" placeholderTextColor="#555" keyboardType="decimal-pad" />
          </View>
          <View style={{ flex: 1, minWidth: 120 }}>
            <Text style={s.fieldLabel}>Trailing stop %</Text>
            <TextInput style={s.input} value={trailingStopPct} onChangeText={setTrailingStopPct} placeholder="5" placeholderTextColor="#555" keyboardType="decimal-pad" />
          </View>
        </View>
        <Text style={[s.listMeta, { marginTop: 8 }]}>If any field is filled, the executed swap will be saved as a tracked long position so stop checks in Positions can manage it later.</Text>
      </View>

      <Pressable onPress={handleQuote} disabled={quoting || !amount} style={[s.actionBtn, { backgroundColor: ACCENT + '20' }]}>
        {quoting ? <ActivityIndicator size="small" color={ACCENT} /> : <Text style={[s.actionText, { color: ACCENT }]}>Get Quote</Text>}
      </Pressable>

      {quote && (
        <View style={s.quoteCard}>
          <Text style={s.quoteTitle}>Quote</Text>
          <View style={s.quoteRow}>
            <Text style={s.quoteLabel}>You send</Text>
            <Text style={s.quoteValue}>{convertFromSmallestUnit(quote.inAmount, inputMint).toFixed(inputDecimals > 6 ? 6 : 4)} {inputMeta.symbol}</Text>
          </View>
          <View style={s.quoteRow}>
            <Text style={s.quoteLabel}>You receive</Text>
            <Text style={s.quoteValue}>{convertFromSmallestUnit(quote.outAmount, outputMint).toFixed(outputDecimals > 6 ? 6 : 4)} {outputMeta.symbol}</Text>
          </View>
          <View style={s.quoteRow}>
            <Text style={s.quoteLabel}>Price impact</Text>
            <Text style={[s.quoteValue, quote.priceImpactPct > 1 && { color: '#ef4444' }]}>{quote.priceImpactPct.toFixed(3)}%</Text>
          </View>
          <View style={s.quoteRow}>
            <Text style={s.quoteLabel}>Slippage</Text>
            <Text style={s.quoteValue}>{slippagePct}%</Text>
          </View>
          <View style={s.quoteRow}>
            <Text style={s.quoteLabel}>Route</Text>
            <Text style={s.quoteValue}>{quote.routePlan?.map(r => r.swapInfo.label).filter(Boolean).join(' > ') || 'Direct'}</Text>
          </View>

          <Pressable onPress={handleSwap} disabled={swapping} style={[s.actionBtn, { backgroundColor: '#22c55e', marginTop: 12 }]}>
            {swapping ? <ActivityIndicator size="small" color="#fff" /> : <Text style={[s.actionText, { color: '#e8e8e8' }]}>Execute Smart Trade</Text>}
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

// ??? Alerts Tab ???????????????????????????????????????????????????????????????

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

// ??? Tracked Wallets Tab ??????????????????????????????????????????????????????

// Notable wallets - auto-displayed with live data
type WalletCategory = 'exchange' | 'market_maker' | 'whale' | 'trader' | 'political' | 'fund' | 'btc_whale';

interface NotableWallet {
  address: string;
  label: string;
  category: WalletCategory;
  chain: 'sol' | 'btc';
  description?: string;
}

const NOTABLE_WALLETS: NotableWallet[] = [
  // ?? Solana Exchanges ??
  { address: '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9', label: 'Binance', category: 'exchange', chain: 'sol', description: 'Largest CEX hot wallet' },
  { address: 'GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE', label: 'Coinbase Hot 2', category: 'exchange', chain: 'sol' },
  { address: 'H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS', label: 'Coinbase', category: 'exchange', chain: 'sol' },
  { address: 'AC5RDfQFmDS1deWZos921JfqscXdByf8BKHs5ACWjtW2', label: 'Bybit', category: 'exchange', chain: 'sol' },
  { address: 'AobVSwdW9BbpMdJvTqeCN4hPAmh4rHm7vwLnQ5ATSyrS', label: 'Crypto.com', category: 'exchange', chain: 'sol' },
  // ?? Solana Market Makers ??
  { address: '5sTQ5ih7xtctBhMXHr3f1aWdaXazWrWfoehqWdqWnTFP', label: 'Wintermute', category: 'market_maker', chain: 'sol', description: 'Primary trading wallet' },
  { address: 'MfDuWeqSHEqTFVYZ7LoexgAK9dxk7cy4DFJWjWMGVWa', label: 'Wintermute Bot', category: 'market_maker', chain: 'sol', description: 'Automated liquidity bot' },
  // ?? Solana Whales ??
  { address: '52C9T2T7JRojtxumYnYZhyUmrN7kqzvCLc4Ksvjk7TxD', label: 'SOL Whale #1', category: 'whale', chain: 'sol', description: '~4.3M SOL (0.85% supply)' },
  { address: '8BseXT9EtoEhBTKFFYkwTnjKSUZwhtmdKY2Jrj8j45Rt', label: 'SOL Whale #2', category: 'whale', chain: 'sol', description: '~3.9M SOL (0.77% supply)' },
  // ?? Solana Traders ??
  { address: 'AVAZvHLR2PcWpDf8BXY4rVxNHYRBytycHkcB5z5QNXYm', label: 'Ansem (@blknoiz06)', category: 'trader', chain: 'sol', description: 'Famous memecoin trader' },
  { address: '4Be9CvxqHW6BYiRAxW9Q3xu1ycTMWaL5z8NX4HR3ha7t', label: 'Smart Money Alpha', category: 'trader', chain: 'sol', description: 'Consistent 50x+ flips' },
  { address: '8zFZHuSRuDpuAR7J6FzwyF3vKNx4CVW3DFHJerQhc7Zd', label: 'Insider Signal', category: 'trader', chain: 'sol', description: 'Early entry pattern' },
  // ?? Political ??
  { address: '6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN', label: '$TRUMP Token Mint', category: 'political', chain: 'sol', description: 'Official Trump memecoin' },
  // ?? BTC Whales (view-only ? no Helius data) ??
  { address: '34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo', label: 'Satoshi Nakamoto', category: 'btc_whale', chain: 'btc', description: '~1.1M BTC, genesis blocks' },
  { address: 'bc1qazcm763858nkj2dz7g4cx4k9wy2ualpzyczjmc', label: 'Binance Cold', category: 'btc_whale', chain: 'btc', description: '~248K BTC' },
  { address: 'bc1qm34lsc65zpw79lxes69zkqmk6ee3ewf0j77s3h', label: 'Bitfinex Cold', category: 'btc_whale', chain: 'btc', description: '~180K BTC' },
  { address: '3LYJfcfHPXYJreMsASht2PKsQGbBqbRLqM', label: 'US Gov (Silk Road)', category: 'btc_whale', chain: 'btc', description: 'Seized BTC - DOJ wallet' },
  { address: 'bc1qjasf9z3h7w3jspkhtgatgpyvvzgpa2wwd2lr0p5', label: 'MicroStrategy', category: 'btc_whale', chain: 'btc', description: '~500K+ BTC treasury' },
  { address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', label: 'Genesis Block', category: 'btc_whale', chain: 'btc', description: 'First-ever BTC block reward' },
  { address: 'bc1q4c8n5t00jmj8temxdgcc3t32nkg2wjwz24lywv', label: 'Grayscale GBTC', category: 'btc_whale', chain: 'btc', description: 'Largest BTC fund' },
  { address: '3M219KR5vEneNb47ewrPfWyb5jQ2DjxRP6', label: 'Mt. Gox Trustee', category: 'btc_whale', chain: 'btc', description: 'Creditor distribution' },
];

const CATEGORY_COLORS: Record<string, string> = {
  exchange: '#3b82f6',
  market_maker: '#6366f1',
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
      // Rough USD ? use SOL price from token balances if available, else estimate
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

      {/* Notable wallets - always visible */}
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

// ??? History Tab ??????????????????????????????????????????????????????????????

function HistoryTab({ userId }: { userId: string }) {
  const [trades, setTrades] = useState<TradeLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [modeFilter, setModeFilter] = useState<'all' | TradingExecutionMode>('all');

  useEffect(() => { loadHistory(); }, [userId, modeFilter]);

  const loadHistory = async () => {
    setLoading(true);
    try {
      setTrades(await getTradingLog(userId, modeFilter, 100));
    } catch {
      setTrades([]);
    }
    setLoading(false);
  };

  if (loading) return <LoadingScreen />;

  return (
    <ScrollView contentContainerStyle={s.scrollPad}>
      <Text style={s.label}>TRADE HISTORY</Text>
      <Text style={s.emptyDesc}>Shared execution log for live swaps, paper trades, and backtest-generated entries and exits.</Text>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
        <View style={s.quickRow}>
          {(['all', 'live', 'paper', 'backtest'] as const).map(mode => {
            const active = modeFilter === mode;
            const color = mode === 'all' ? '#9e9e9e' : getExecutionModeColor(mode);
            return (
              <Pressable
                key={mode}
                onPress={() => setModeFilter(mode)}
                style={[
                  s.quickBtn,
                  active && { borderColor: `${color}70`, backgroundColor: `${color}18` },
                ]}
              >
                <Text style={[s.quickText, active && { color }]}>
                  {mode === 'all' ? 'ALL MODES' : getExecutionModeLabel(mode)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      {trades.length === 0 && (
        <Text style={s.emptyDesc}>No trades recorded for this mode yet.</Text>
      )}

      {trades.map(trade => {
        const modeColor = getExecutionModeColor(trade.executionMode);
        const inputSymbol = trade.inputMint ? getTokenMetaByMint(trade.inputMint).symbol : null;
        const outputSymbol = trade.outputMint ? getTokenMetaByMint(trade.outputMint).symbol : null;
        const pnlUsd = typeof trade.metadata?.pnlUsd === 'number' ? trade.metadata.pnlUsd : undefined;
        return (
          <View key={trade.id} style={s.listCard}>
            <View style={s.listTop}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', flex: 1 }}>
                <Text style={s.listTitle}>{trade.action.toUpperCase()}</Text>
                <View style={[s.statusPill, { borderColor: `${modeColor}50`, backgroundColor: `${modeColor}15` }]}>
                  <Text style={[s.statusPillText, { color: modeColor }]}>
                    {getExecutionModeLabel(trade.executionMode)}
                  </Text>
                </View>
                <View style={[s.statusPill, trade.status === 'success' ? s.statusPillActive : trade.status === 'failed' ? s.statusPillFailed : {}]}>
                  <Text style={[s.statusPillText, trade.status === 'success' && { color: '#22c55e' }, trade.status === 'failed' && { color: '#ef4444' }]}>
                    {trade.status}
                  </Text>
                </View>
              </View>
            </View>
            {(trade.inputAmount || trade.outputAmount) && (
              <Text style={s.listMeta}>
                {trade.inputAmount || '0'} {inputSymbol || ''} {'>'} {trade.outputAmount || '—'} {outputSymbol || ''}
              </Text>
            )}
            {trade.priceUsd && (
              <Text style={s.listMeta}>Price: ${trade.priceUsd.toFixed(4)}</Text>
            )}
            {trade.strategyName && (
              <Text style={s.listMeta}>Strategy: {trade.strategyName}</Text>
            )}
            {typeof pnlUsd === 'number' && (
              <Text style={[s.listMeta, { color: pnlUsd >= 0 ? '#22c55e' : '#ef4444' }]}>
                P&L: {pnlUsd >= 0 ? '+' : ''}{formatCompactUsd(pnlUsd)}
              </Text>
            )}
            {trade.txHash && (
              <Pressable
                onPress={() => {
                  if (RNPlatform.OS === 'web') window.open(`https://solscan.io/tx/${trade.txHash}`, '_blank');
                }}
              >
                <Text style={s.txLink}>TX: {trade.txHash.slice(0, 12)}...</Text>
              </Pressable>
            )}
            {trade.reason && <Text style={s.listMeta}>{trade.reason}</Text>}
            <Text style={s.listTime}>{new Date(trade.createdAt).toLocaleString()}</Text>
          </View>
        );
      })}
    </ScrollView>
  );
}

// ??? Positions Tab ????????????????????????????????????????????????????????????

function PositionsTab({ client, userId }: { client: HeliusClient; userId: string }) {
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [modeFilter, setModeFilter] = useState<'all' | 'live' | 'paper'>('all');

  useEffect(() => { loadPositions(); }, [userId, modeFilter]);

  const loadPositions = async () => {
    setLoading(true);
    try {
      const nextPositions = await getOpenPositions(userId, modeFilter);
      setPositions(nextPositions);
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
      if (!price) {
        throw new Error('Live pricing is unavailable for this position.');
      }
      if (pos.executionMode === 'paper') {
        await closePaperPosition(pos.id, price, 'manual');
      } else {
        await closePosition(pos.id, price, 'manual');
      }
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
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.scrollPad}>
        <View style={s.quickRow}>
          {(['all', 'live', 'paper'] as const).map(mode => {
            const active = modeFilter === mode;
            const color = mode === 'all' ? '#9e9e9e' : getExecutionModeColor(mode);
            return (
              <Pressable
                key={mode}
                onPress={() => setModeFilter(mode)}
                style={[
                  s.quickBtn,
                  active && { borderColor: `${color}70`, backgroundColor: `${color}18` },
                ]}
              >
                <Text style={[s.quickText, active && { color }]}>
                  {mode === 'all' ? 'ALL OPEN' : getExecutionModeLabel(mode)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

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

      <Pressable style={s.refreshBtn} onPress={handleCheckStops} disabled={checking}>
        <Text style={s.refreshText}>{checking ? 'CHECKING STOPS...' : 'CHECK STOP-LOSS / TAKE-PROFIT'}</Text>
      </Pressable>

      {positions.length === 0 ? (
        <View style={[s.emptyCard, { marginTop: 16 }]}>
          <Text style={s.emptyDesc}>No open positions in this mode. Live trades and paper trades both feed this book.</Text>
        </View>
      ) : (
        positions.map(pos => {
          const pnlColor = pos.unrealizedPnl >= 0 ? '#22c55e' : '#ef4444';
          const modeColor = getExecutionModeColor(pos.executionMode);
          const stopDist = pos.stopLossPrice && pos.currentPrice > 0
            ? ((pos.currentPrice - pos.stopLossPrice) / pos.currentPrice * 100).toFixed(1)
            : null;
          const tpDist = pos.takeProfitPrice && pos.currentPrice > 0
            ? ((pos.takeProfitPrice - pos.currentPrice) / pos.currentPrice * 100).toFixed(1)
            : null;

          return (
            <View key={pos.id} style={[s.listCard, { marginTop: 8 }]}>
              <View style={s.listTop}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', flex: 1 }}>
                  <Text style={s.listTitle}>{pos.tokenSymbol} {pos.side.toUpperCase()}</Text>
                  <View style={[s.statusPill, { borderColor: `${modeColor}50`, backgroundColor: `${modeColor}15` }]}>
                    <Text style={[s.statusPillText, { color: modeColor }]}>
                      {getExecutionModeLabel(pos.executionMode)}
                    </Text>
                  </View>
                  {pos.strategyName && (
                    <View style={s.statusPill}>
                      <Text style={s.statusPillText}>{pos.strategyName}</Text>
                    </View>
                  )}
                </View>
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

// ??? Signals Tab ??????????????????????????????????????????????????????????????

function SignalsTab({ client, userId }: { client: HeliusClient; userId: string }) {
  const [selectedToken, setSelectedToken] = useState<string>('SOL');
  const [riskScore, setRiskScore] = useState<TokenRiskScore | null>(null);
  const [analysis, setAnalysis] = useState<TechnicalAnalysis | null>(null);
  const [marketSnapshot, setMarketSnapshot] = useState<TokenMarketSnapshot | null>(null);
  const [loadingRisk, setLoadingRisk] = useState(false);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);

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

  const handleRunLiveAnalysis = async () => {
    setLoadingAnalysis(true);
    try {
      const token = SOLANA_TOKEN_REGISTRY[selectedToken];
      if (token) {
        const snapshot = await fetchTokenMarketSnapshot(token.mint);
        if (!snapshot) {
          throw new Error('No live pair data available for this token');
        }
        setMarketSnapshot(snapshot);
        setAnalysis(buildLiveAnalysisFromSnapshot(snapshot, selectedToken, token.mint));
      }
    } catch (err: any) {
      alert('Live analysis failed: ' + (err.message || err));
    }
    setLoadingAnalysis(false);
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
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scrollPad}>
      <Text style={s.label}>SELECT TOKEN</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {tokens.map(([sym]) => (
            <Pressable
              key={sym}
              onPress={() => {
                setSelectedToken(sym);
                setRiskScore(null);
                setAnalysis(null);
                setMarketSnapshot(null);
              }}
              style={[s.tab, selectedToken === sym && { backgroundColor: ACCENT + '18', borderColor: ACCENT + '40' }]}
            >
              <Text style={[s.tabText, selectedToken === sym && { color: ACCENT }]}>{sym}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>

      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
        <Pressable style={[s.refreshBtn, { flex: 1 }]} onPress={handleScanRisk} disabled={loadingRisk}>
          <Text style={s.refreshText}>{loadingRisk ? 'SCANNING...' : 'RISK SCAN'}</Text>
        </Pressable>
        <Pressable style={[s.refreshBtn, { flex: 1 }]} onPress={handleRunLiveAnalysis} disabled={loadingAnalysis}>
          <Text style={s.refreshText}>{loadingAnalysis ? 'ANALYZING...' : 'LIVE ANALYSIS'}</Text>
        </Pressable>
      </View>

      {marketSnapshot && (
        <View style={[s.listCard, { marginBottom: 12 }]}> 
          <View style={s.listTop}>
            <Text style={s.listTitle}>LIVE MARKET SNAPSHOT: {marketSnapshot.symbol}</Text>
            <View style={[s.statusPill, { borderColor: marketSnapshot.priceChange24h >= 0 ? '#22c55e40' : '#ef444440', backgroundColor: marketSnapshot.priceChange24h >= 0 ? '#22c55e10' : '#ef444410' }]}>
              <Text style={[s.statusPillText, { color: marketSnapshot.priceChange24h >= 0 ? '#22c55e' : '#ef4444' }]}>{formatPct(marketSnapshot.priceChange24h)}</Text>
            </View>
          </View>
          <Text style={[s.listMeta, { marginTop: 6 }]}>Price {formatCompactUsd(marketSnapshot.priceUsd)} | Liquidity {formatCompactUsd(marketSnapshot.liquidityUsd)} | Volume 24h {formatCompactUsd(marketSnapshot.volume24h)}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
            {[
              `5m ${formatPct(marketSnapshot.priceChange5m)}`,
              `1h ${formatPct(marketSnapshot.priceChange1h)}`,
              `6h ${formatPct(marketSnapshot.priceChange6h)}`,
              `Buys ${marketSnapshot.buys24h}`,
              `Sells ${marketSnapshot.sells24h}`,
              `Age ${formatAge(marketSnapshot.pairCreatedAt)}`,
              `DEX ${marketSnapshot.dexId || 'n/a'}`,
              `Boosts ${marketSnapshot.activeBoosts}`,
            ].map(label => (
              <View key={label} style={[s.featuredTag, { borderColor: '#ffffff12' }]}>
                <Text style={s.featuredTagText}>{label}</Text>
              </View>
            ))}
          </View>
          <Text style={[s.listMeta, { marginTop: 10 }]}>Market Cap {formatCompactUsd(marketSnapshot.marketCap)} | FDV {formatCompactUsd(marketSnapshot.fdv)}</Text>
          {(marketSnapshot.websites.length > 0 || marketSnapshot.socials.length > 0) && (
            <Text style={[s.listMeta, { marginTop: 6 }]}>Links: {[...marketSnapshot.websites, ...marketSnapshot.socials].slice(0, 4).join(' ? ')}</Text>
          )}
          {marketSnapshot.pairUrl && RNPlatform.OS === 'web' && (
            <Pressable onPress={() => window.open(marketSnapshot.pairUrl, '_blank')} style={[s.refreshBtn, { marginTop: 12 }]}> 
              <Text style={s.refreshText}>Open Pair on DEX Screener</Text>
            </Pressable>
          )}
        </View>
      )}

      {riskScore && (
        <View style={[s.listCard, { marginBottom: 12 }]}> 
          <View style={s.listTop}>
            <Text style={s.listTitle}>RISK SCORE: {riskScore.symbol}</Text>
            <View style={[s.statusPill, { borderColor: gradeColor(riskScore.grade) + '40', backgroundColor: gradeColor(riskScore.grade) + '08' }]}>
              <Text style={[s.statusPillText, { color: gradeColor(riskScore.grade) }]}>{riskScore.grade} ({riskScore.overallScore}/100)</Text>
            </View>
          </View>
          {Object.entries(riskScore.factors).map(([key, val]) => (
            <View key={key} style={{ marginTop: 8 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={s.listMeta}>{key.replace(/([A-Z])/g, ' $1').trim()}</Text>
                <Text style={s.listMeta}>{val}/20</Text>
              </View>
              <View style={{ height: 4, backgroundColor: '#1a1a1a', borderRadius: 2, marginTop: 2 }}>
                <View style={{ height: 4, width: `${(val / 20) * 100}%`, backgroundColor: val >= 15 ? '#22c55e' : val >= 10 ? '#f59e0b' : '#ef4444', borderRadius: 2 }} />
              </View>
            </View>
          ))}
          {riskScore.warnings.length > 0 && (
            <View style={{ marginTop: 10, padding: 8, backgroundColor: '#ffffff05', borderRadius: 6, borderWidth: 1, borderColor: '#ffffff10' }}>
              {riskScore.warnings.map((warning, index) => (
                <Text key={index} style={[s.listMeta, { color: '#f59e0b', marginBottom: 2 }]}>{warning}</Text>
              ))}
            </View>
          )}
        </View>
      )}

      {analysis && (
        <View style={[s.listCard, { marginBottom: 12 }]}> 
          <View style={s.listTop}>
            <Text style={s.listTitle}>LIVE SIGNALS: {analysis.symbol}</Text>
            <View style={[s.statusPill, { borderColor: signalColor(analysis.overallSignal) + '40', backgroundColor: signalColor(analysis.overallSignal) + '08' }]}>
              <Text style={[s.statusPillText, { color: signalColor(analysis.overallSignal) }]}>{analysis.overallSignal.replace(/_/g, ' ').toUpperCase()} ({analysis.overallScore})</Text>
            </View>
          </View>
          <Text style={[s.listMeta, { marginTop: 6 }]}>Price ${analysis.currentPrice.toFixed(4)} | Support ${analysis.support.toFixed(4)} | Resistance ${analysis.resistance.toFixed(4)}</Text>
          {analysis.signals.map((sig, index) => (
            <View key={index} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
              <Text style={[s.listMeta, { flex: 1 }]}>{sig.indicator}</Text>
              <Text style={[s.listMeta, { flex: 1, textAlign: 'center' }]}>{Math.round(sig.value * 100) / 100}</Text>
              <View style={[s.statusPill, { borderColor: signalColor(sig.signal) + '40', backgroundColor: signalColor(sig.signal) + '08' }]}>
                <Text style={[s.statusPillText, { color: signalColor(sig.signal) }]}>{sig.signal.toUpperCase()} {Math.round(sig.strength * 100)}%</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {!riskScore && !analysis && !marketSnapshot && (
        <View style={s.emptyCard}>
          <Text style={s.emptyDesc}>
            Select a token and run Risk Scan or Live Analysis to see current market structure.
            {'\n\n'}Live Analysis uses DEX Screener pair data for price change, order flow, liquidity, market cap, and pair age, then derives a momentum/structure view from those real market anchors.
            {'\n\n'}Risk Score still focuses on contract security, liquidity, holder distribution, and price stability.
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  scrollPad: { padding: 16, paddingBottom: 40 },

  // Tab bar ? pixel-art style matching Backpack
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

  // Toggle chips (autopilot settings)
  toggleChip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleChipText: {
    fontSize: 11,
    fontWeight: '700',
    fontFamily: 'monospace',
    letterSpacing: 0.5,
  },
});

