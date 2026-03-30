import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { LoadingScreen } from './LoadingWave';
import { HeliusClient, getBacktestRuns, logTrade, saveBacktestRun, SOLANA_TOKEN_REGISTRY, type BacktestRun, USDC_MINT } from '../lib/heliusTrading';
import { BACKTEST_STRATEGIES, runSnapshotBacktest, type BacktestStrategyKey } from '../lib/tradingSim';
import { buildPriceSeriesFromSnapshot, buildSnapshotTimestamps, fetchTokenMarketSnapshot, formatCompactUsd, formatPct, parsePositiveNumber } from '../lib/tradingMarket';
import { PIXEL_COLORS } from '../lib/pixelDesign';

const COMMON_TRADING_SYMBOLS = ['SOL', 'USDC', 'JUP', 'BONK', 'PYTH', 'JTO', 'WIF', 'RAY'] as const;

function getStrategyLabel(key: BacktestStrategyKey): string {
  return BACKTEST_STRATEGIES.find(strategy => strategy.key === key)?.label || BACKTEST_STRATEGIES[0].label;
}

export function TradingBotBacktestTab({ client, userId, circleId }: { client: HeliusClient; userId: string; circleId: string }) {
  const [runs, setRuns] = useState<BacktestRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [selectedToken, setSelectedToken] = useState('SOL');
  const [strategyKey, setStrategyKey] = useState<BacktestStrategyKey>('trend_follow');
  const [initialCapital, setInitialCapital] = useState('10000');
  const [feeBps, setFeeBps] = useState('10');
  const [slippageBps, setSlippageBps] = useState('15');
  const [stopLossPct, setStopLossPct] = useState('6');
  const [takeProfitPct, setTakeProfitPct] = useState('12');
  const [trailingStopPct, setTrailingStopPct] = useState('4');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [latestRun, setLatestRun] = useState<BacktestRun | null>(null);

  useEffect(() => {
    loadRuns();
  }, [userId, circleId]);

  const loadRuns = async () => {
    setLoading(true);
    try {
      const nextRuns = await getBacktestRuns(userId, circleId, 12);
      setRuns(nextRuns);
      setLatestRun(nextRuns[0] || null);
    } catch {
      setRuns([]);
      setLatestRun(null);
    }
    setLoading(false);
  };

  const handleRun = async () => {
    const token = SOLANA_TOKEN_REGISTRY[selectedToken];
    const capital = parsePositiveNumber(initialCapital);
    if (!token) {
      setMessage({ ok: false, text: 'Choose a supported token before running a backtest.' });
      return;
    }
    if (!capital) {
      setMessage({ ok: false, text: 'Enter a valid starting capital.' });
      return;
    }

    setRunning(true);
    setMessage(null);
    try {
      const snapshot = await fetchTokenMarketSnapshot(token.mint);
      if (!snapshot) {
        throw new Error('No DEX market snapshot is available for this token right now.');
      }

      const fee = Math.max(0, parseInt(feeBps || '0', 10) || 0);
      const slippage = Math.max(0, parseInt(slippageBps || '0', 10) || 0);
      const timestamps = buildSnapshotTimestamps(31);
      const simulation = runSnapshotBacktest({
        strategy: strategyKey,
        tokenSymbol: selectedToken,
        tokenMint: token.mint,
        prices: buildPriceSeriesFromSnapshot(snapshot),
        timestamps,
        initialCapitalUsd: capital,
        feeBps: fee,
        slippageBps: slippage,
        stopLossPct: parsePositiveNumber(stopLossPct),
        takeProfitPct: parsePositiveNumber(takeProfitPct),
        trailingStopPct: parsePositiveNumber(trailingStopPct),
      });

      const savedRun = await saveBacktestRun({
        userId,
        circleId,
        strategyKey,
        strategyName: getStrategyLabel(strategyKey),
        tokenMint: token.mint,
        tokenSymbol: selectedToken,
        timeframeLabel: '24h snapshot',
        initialCapitalUsd: capital,
        finalEquityUsd: simulation.finalEquityUsd,
        netPnlUsd: simulation.netPnlUsd,
        netPnlPct: simulation.netPnlPct,
        buyHoldReturnPct: simulation.buyHoldReturnPct,
        maxDrawdownPct: simulation.maxDrawdownPct,
        totalTrades: simulation.trades.length,
        wins: simulation.wins,
        losses: simulation.losses,
        winRatePct: simulation.winRatePct,
        feeBps: fee,
        slippageBps: slippage,
        config: {
          stopLossPct: parsePositiveNumber(stopLossPct),
          takeProfitPct: parsePositiveNumber(takeProfitPct),
          trailingStopPct: parsePositiveNumber(trailingStopPct),
          liquidityUsd: snapshot.liquidityUsd,
          volume24h: snapshot.volume24h,
          priceChange24h: snapshot.priceChange24h,
        },
        equityCurve: simulation.equityCurve,
        tradeLog: simulation.trades,
      });

      if (!savedRun) throw new Error('Could not persist the backtest run.');

      if (simulation.trades.length === 0) {
        await logTrade({
          userId,
          circleId,
          walletAddress: `backtest:${strategyKey}`,
          action: 'portfolio_scan',
          inputMint: token.mint,
          outputMint: USDC_MINT,
          inputAmount: capital.toFixed(2),
          outputAmount: simulation.finalEquityUsd.toFixed(2),
          priceUsd: snapshot.priceUsd,
          status: 'skipped',
          reason: `Backtest completed with no entries for ${selectedToken}`,
          executionMode: 'backtest',
          strategyName: getStrategyLabel(strategyKey),
          backtestRunId: savedRun.id,
          metadata: { buyHoldReturnPct: simulation.buyHoldReturnPct, maxDrawdownPct: simulation.maxDrawdownPct },
          createdAt: timestamps[timestamps.length - 1],
        });
      } else {
        await Promise.all(simulation.trades.flatMap(trade => ([
          logTrade({
            userId,
            circleId,
            walletAddress: `backtest:${strategyKey}`,
            action: 'swap',
            inputMint: USDC_MINT,
            outputMint: token.mint,
            inputAmount: trade.notionalUsd.toFixed(2),
            outputAmount: trade.quantity.toFixed(6),
            priceUsd: trade.entryPrice,
            status: 'success',
            reason: `Backtest entry: ${getStrategyLabel(strategyKey)}`,
            executionMode: 'backtest',
            strategyName: getStrategyLabel(strategyKey),
            backtestRunId: savedRun.id,
            metadata: { leg: 'entry', exitReason: trade.exitReason },
            createdAt: trade.entryTime,
          }),
          logTrade({
            userId,
            circleId,
            walletAddress: `backtest:${strategyKey}`,
            action: 'swap',
            inputMint: token.mint,
            outputMint: USDC_MINT,
            inputAmount: trade.quantity.toFixed(6),
            outputAmount: (trade.notionalUsd + trade.pnlUsd).toFixed(2),
            priceUsd: trade.exitPrice,
            status: trade.pnlUsd >= 0 ? 'success' : 'failed',
            reason: `Backtest exit: ${trade.exitReason}`,
            executionMode: 'backtest',
            strategyName: getStrategyLabel(strategyKey),
            backtestRunId: savedRun.id,
            metadata: { leg: 'exit', pnlUsd: trade.pnlUsd, pnlPct: trade.pnlPct },
            createdAt: trade.exitTime,
          }),
        ])));
      }

      setLatestRun(savedRun);
      setMessage({ ok: true, text: `${getStrategyLabel(strategyKey)} finished on ${selectedToken}. Net ${simulation.netPnlUsd >= 0 ? '+' : ''}${formatCompactUsd(simulation.netPnlUsd)} and buy & hold ${formatPct(simulation.buyHoldReturnPct)}.` });
      await loadRuns();
    } catch (err: any) {
      setMessage({ ok: false, text: `Backtest failed: ${err.message || err}` });
    }
    setRunning(false);
  };

  if (loading) return <LoadingScreen />;

  return (
    <ScrollView contentContainerStyle={s.scrollPad}>
      <Text style={s.label}>SNAPSHOT BACKTEST LAB</Text>
      <Text style={s.desc}>Run lightweight strategy tests against the last 24 hours of live DEX market anchors. Each run persists its summary and writes the generated trade sequence into History with BACKTEST mode.</Text>

      <Text style={s.fieldLabel}>Token</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
        <View style={s.quickRow}>
          {COMMON_TRADING_SYMBOLS.map(symbol => (
            <Pressable key={symbol} onPress={() => setSelectedToken(symbol)} style={[s.quickBtn, selectedToken === symbol && s.quickBtnActive]}>
              <Text style={s.quickText}>{symbol}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>

      <Text style={s.fieldLabel}>Strategy</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
        <View style={s.quickRow}>
          {BACKTEST_STRATEGIES.map(strategy => (
            <Pressable key={strategy.key} onPress={() => setStrategyKey(strategy.key)} style={[s.quickBtn, strategyKey === strategy.key && s.quickBtnOrange]}>
              <Text style={s.quickText}>{strategy.label}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>

      <View style={s.card}>
        <Text style={s.cardMeta}>{BACKTEST_STRATEGIES.find(strategy => strategy.key === strategyKey)?.description}</Text>
        <View style={s.inlineRow}>
          <View style={s.inlineField}>
            <Text style={s.fieldLabel}>Capital ($)</Text>
            <TextInput style={s.input} value={initialCapital} onChangeText={setInitialCapital} keyboardType="decimal-pad" placeholder="10000" placeholderTextColor="#555" />
          </View>
          <View style={s.inlineField}>
            <Text style={s.fieldLabel}>Fee (bps)</Text>
            <TextInput style={s.input} value={feeBps} onChangeText={setFeeBps} keyboardType="number-pad" placeholder="10" placeholderTextColor="#555" />
          </View>
          <View style={s.inlineField}>
            <Text style={s.fieldLabel}>Slippage (bps)</Text>
            <TextInput style={s.input} value={slippageBps} onChangeText={setSlippageBps} keyboardType="number-pad" placeholder="15" placeholderTextColor="#555" />
          </View>
        </View>
        <View style={s.inlineRow}>
          <View style={s.inlineField}>
            <Text style={s.fieldLabel}>Stop loss %</Text>
            <TextInput style={s.input} value={stopLossPct} onChangeText={setStopLossPct} keyboardType="decimal-pad" placeholder="6" placeholderTextColor="#555" />
          </View>
          <View style={s.inlineField}>
            <Text style={s.fieldLabel}>Take profit %</Text>
            <TextInput style={s.input} value={takeProfitPct} onChangeText={setTakeProfitPct} keyboardType="decimal-pad" placeholder="12" placeholderTextColor="#555" />
          </View>
          <View style={s.inlineField}>
            <Text style={s.fieldLabel}>Trailing stop %</Text>
            <TextInput style={s.input} value={trailingStopPct} onChangeText={setTrailingStopPct} keyboardType="decimal-pad" placeholder="4" placeholderTextColor="#555" />
          </View>
        </View>
        <Pressable style={s.actionBtn} onPress={handleRun} disabled={running}>
          {running ? <ActivityIndicator size="small" color="#f97316" /> : <Text style={s.actionText}>RUN SNAPSHOT BACKTEST</Text>}
        </Pressable>
      </View>

      {message && (
        <View style={[s.banner, { borderColor: message.ok ? '#22c55e30' : '#ef444430' }]}>
          <Text style={[s.bannerText, { color: message.ok ? '#22c55e' : '#ef4444' }]}>{message.text}</Text>
        </View>
      )}

      {latestRun && (
        <View style={s.card}>
          <View style={s.rowBetween}>
            <Text style={s.cardTitle}>LATEST RUN</Text>
            <Text style={[s.cardTitle, { color: latestRun.netPnlUsd >= 0 ? '#22c55e' : '#ef4444' }]}>{latestRun.netPnlPct >= 0 ? '+' : ''}{latestRun.netPnlPct.toFixed(2)}%</Text>
          </View>
          <Text style={s.cardMeta}>{latestRun.strategyName} on {latestRun.tokenSymbol}</Text>
          <Text style={s.cardMeta}>Net {latestRun.netPnlUsd >= 0 ? '+' : ''}{formatCompactUsd(latestRun.netPnlUsd)} | Equity {formatCompactUsd(latestRun.finalEquityUsd)}</Text>
          <Text style={s.cardMeta}>Trades {latestRun.totalTrades} | Win rate {latestRun.winRatePct.toFixed(1)}% | DD {latestRun.maxDrawdownPct.toFixed(1)}%</Text>
          <Text style={s.cardMeta}>Buy & hold {formatPct(latestRun.buyHoldReturnPct)}</Text>
        </View>
      )}

      <Text style={s.label}>RECENT RUNS</Text>
      {runs.length === 0 ? (
        <View style={s.card}><Text style={s.desc}>No backtest runs saved yet.</Text></View>
      ) : (
        runs.map(run => (
          <View key={run.id} style={s.card}>
            <View style={s.rowBetween}>
              <View>
                <Text style={s.cardTitle}>{run.strategyName}</Text>
                <Text style={s.cardMeta}>{run.tokenSymbol} • {run.timeframeLabel}</Text>
              </View>
              <Text style={[s.cardTitle, { color: run.netPnlUsd >= 0 ? '#22c55e' : '#ef4444' }]}>{run.netPnlPct >= 0 ? '+' : ''}{run.netPnlPct.toFixed(2)}%</Text>
            </View>
            <Text style={s.cardMeta}>Net {run.netPnlUsd >= 0 ? '+' : ''}{formatCompactUsd(run.netPnlUsd)} | Win rate {run.winRatePct.toFixed(1)}% | DD {run.maxDrawdownPct.toFixed(1)}%</Text>
            {Array.isArray(run.tradeLog) && run.tradeLog.length > 0 && (
              <View style={{ marginTop: 6 }}>
                {(run.tradeLog as any[]).slice(0, 3).map((trade, index) => (
                  <Text key={index} style={s.cardMeta}>Trade {index + 1}: {formatCompactUsd(trade.notionalUsd || 0)} at ${Number(trade.entryPrice || 0).toFixed(4)} {'>'} ${Number(trade.exitPrice || 0).toFixed(4)} ({Number(trade.pnlPct || 0).toFixed(2)}%)</Text>
                ))}
              </View>
            )}
            <Text style={s.time}>{new Date(run.createdAt).toLocaleString()}</Text>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  scrollPad: { padding: 16, paddingBottom: 40 },
  label: { color: '#6f6f6f', fontSize: 10, fontWeight: '700', letterSpacing: 2, fontFamily: 'monospace', marginBottom: 8 },
  desc: { color: '#6f6f6f', fontSize: 13, lineHeight: 20, fontFamily: 'monospace', marginBottom: 12 },
  card: { backgroundColor: '#161616', borderRadius: 10, borderWidth: 1, borderColor: '#1a1a1a', padding: 14, marginBottom: 12 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  cardTitle: { color: '#e8e8e8', fontSize: 13, fontWeight: '700', fontFamily: 'monospace' },
  cardMeta: { color: '#9e9e9e', fontSize: 11, fontFamily: 'monospace', marginTop: 2 },
  fieldLabel: { color: '#9e9e9e', fontSize: 11, fontWeight: '600', fontFamily: 'monospace', marginBottom: 4 },
  input: { backgroundColor: '#0a0a0a', borderWidth: 1, borderColor: '#2a2a2a', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, color: '#e8e8e8', fontSize: 13, fontFamily: 'monospace' },
  quickRow: { flexDirection: 'row', gap: 8 },
  quickBtn: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6, borderWidth: 1, borderColor: '#2a2a2a', backgroundColor: '#161616' },
  quickBtnActive: { borderColor: '#f9731660', backgroundColor: '#f9731615' },
  quickBtnOrange: { borderColor: '#f9731660', backgroundColor: '#f9731615' },
  quickText: { color: '#9e9e9e', fontSize: 11, fontWeight: '600', fontFamily: 'monospace' },
  inlineRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 8 },
  inlineField: { flex: 1, minWidth: 120 },
  actionBtn: { marginTop: 12, paddingVertical: 12, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f9731615', borderWidth: 1, borderColor: '#f9731630' },
  actionText: { color: '#f97316', fontSize: 12, fontWeight: '800', fontFamily: 'monospace' },
  banner: { backgroundColor: '#161616', borderRadius: 10, borderWidth: 1, padding: 12, marginBottom: 12 },
  bannerText: { fontSize: 12, lineHeight: 18, fontFamily: 'monospace' },
  time: { color: PIXEL_COLORS.text3, fontSize: 10, fontFamily: 'monospace', marginTop: 8 },
});

