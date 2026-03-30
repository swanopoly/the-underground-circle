import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { LoadingScreen } from './LoadingWave';
import { HeliusClient, type PaperTradingAccount, getPaperTradingAccount, openPaperPosition, resetPaperTradingAccount, SOLANA_TOKEN_REGISTRY } from '../lib/heliusTrading';
import { PIXEL_COLORS } from '../lib/pixelDesign';

const COMMON_TRADING_SYMBOLS = ['SOL', 'USDC', 'JUP', 'BONK', 'PYTH', 'JTO', 'WIF', 'RAY'] as const;

function parsePositiveNumber(value: string): number | undefined {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function formatCompactUsd(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '$0';
  const prefix = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${prefix}$${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${prefix}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${prefix}$${(abs / 1_000).toFixed(1)}K`;
  return `${prefix}$${abs.toFixed(2)}`;
}

export function TradingBotPaperTab({ client, userId, circleId }: { client: HeliusClient; userId: string; circleId: string }) {
  const [account, setAccount] = useState<PaperTradingAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [placing, setPlacing] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [selectedToken, setSelectedToken] = useState('SOL');
  const [notionalUsd, setNotionalUsd] = useState('500');
  const [stopLossPct, setStopLossPct] = useState('6');
  const [takeProfitPct, setTakeProfitPct] = useState('12');
  const [trailingStopPct, setTrailingStopPct] = useState('4');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    loadAccount();
  }, [userId, circleId]);

  const loadAccount = async () => {
    setLoading(true);
    try {
      setAccount(await getPaperTradingAccount(userId, circleId));
    } catch {
      setAccount(null);
    }
    setLoading(false);
  };

  const handleReset = async () => {
    setResetting(true);
    setMessage(null);
    try {
      const nextAccount = await resetPaperTradingAccount(userId, circleId, account?.startingBalanceUsd || 10000);
      setAccount(nextAccount);
      setMessage({ ok: true, text: 'Paper account reset. Open paper positions were cleared and equity returned to the starting balance.' });
    } catch (err: any) {
      setMessage({ ok: false, text: `Failed to reset paper account: ${err.message || err}` });
    }
    setResetting(false);
  };

  const handleOpenTrade = async () => {
    const token = SOLANA_TOKEN_REGISTRY[selectedToken];
    const notional = parsePositiveNumber(notionalUsd);
    if (!token) {
      setMessage({ ok: false, text: 'Choose a supported token before opening a paper trade.' });
      return;
    }
    if (!notional) {
      setMessage({ ok: false, text: 'Enter a valid paper trade size.' });
      return;
    }

    setPlacing(true);
    setMessage(null);
    try {
      const { price } = await client.getTokenPrice(token.mint);
      if (!price) {
        throw new Error('Live pricing is unavailable for this token right now.');
      }
      const stopLoss = parsePositiveNumber(stopLossPct);
      const takeProfit = parsePositiveNumber(takeProfitPct);
      const trailingStop = parsePositiveNumber(trailingStopPct);
      const result = await openPaperPosition({
        userId,
        circleId,
        tokenMint: token.mint,
        tokenSymbol: selectedToken,
        entryPrice: price,
        notionalUsd: notional,
        stopLossPrice: stopLoss ? price * (1 - (stopLoss / 100)) : undefined,
        takeProfitPrice: takeProfit ? price * (1 + (takeProfit / 100)) : undefined,
        trailingStopPct: trailingStop,
        strategyName: 'Paper Manual',
        reason: `Paper long on ${selectedToken}`,
      });

      if (result.error) {
        setMessage({ ok: false, text: result.error });
      } else {
        setAccount(result.account);
        setMessage({ ok: true, text: `${selectedToken} paper long opened and sent to Positions with PAPER mode.` });
      }
    } catch (err: any) {
      setMessage({ ok: false, text: `Failed to open paper trade: ${err.message || err}` });
    }
    setPlacing(false);
  };

  if (loading) return <LoadingScreen />;

  return (
    <ScrollView contentContainerStyle={s.scrollPad}>
      <Text style={s.label}>PAPER ACCOUNT</Text>
      <Text style={s.desc}>Run simulated spot trades with persistent equity, realistic slippage and fees, and the same protection engine used by Positions.</Text>

      {account && (
        <View style={s.statsRow}>
          <View style={s.statCard}>
            <Text style={s.statValue}>{formatCompactUsd(account.currentEquityUsd)}</Text>
            <Text style={s.statLabel}>Equity</Text>
          </View>
          <View style={s.statCard}>
            <Text style={s.statValue}>{formatCompactUsd(account.cashBalanceUsd)}</Text>
            <Text style={s.statLabel}>Cash</Text>
          </View>
          <View style={s.statCard}>
            <Text style={[s.statValue, { color: account.realizedPnlUsd >= 0 ? '#22c55e' : '#ef4444' }]}>{account.realizedPnlUsd >= 0 ? '+' : ''}{formatCompactUsd(account.realizedPnlUsd)}</Text>
            <Text style={s.statLabel}>Realized</Text>
          </View>
        </View>
      )}

      {account && (
        <View style={s.card}>
          <View style={s.rowBetween}>
            <Text style={s.cardTitle}>ACCOUNT STATE</Text>
            <Pressable onPress={handleReset} style={s.resetBtn} disabled={resetting}>
              <Text style={s.resetText}>{resetting ? 'RESETTING...' : 'RESET'}</Text>
            </Pressable>
          </View>
          <Text style={s.cardMeta}>Starting {formatCompactUsd(account.startingBalanceUsd)} | Open value {formatCompactUsd(account.openPositionValueUsd)}</Text>
          <Text style={s.cardMeta}>Trades {account.totalTrades} | Wins {account.wins} | Losses {account.losses}</Text>
        </View>
      )}

      <Text style={s.fieldLabel}>Quick token</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
        <View style={s.quickRow}>
          {COMMON_TRADING_SYMBOLS.map(symbol => (
            <Pressable key={symbol} onPress={() => setSelectedToken(symbol)} style={[s.quickBtn, selectedToken === symbol && s.quickBtnActive]}>
              <Text style={s.quickText}>{symbol}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>

      <View style={s.card}>
        <View style={s.fieldGroup}>
          <Text style={s.fieldLabel}>Token</Text>
          <TextInput style={s.input} value={selectedToken} onChangeText={(value) => setSelectedToken(value.toUpperCase().replace(/[^A-Z]/g, ''))} placeholder="SOL" placeholderTextColor="#555" maxLength={8} />
        </View>
        <View style={s.fieldGroup}>
          <Text style={s.fieldLabel}>Notional ($)</Text>
          <TextInput style={s.input} value={notionalUsd} onChangeText={setNotionalUsd} placeholder="500" placeholderTextColor="#555" keyboardType="decimal-pad" />
        </View>
        <View style={s.quickRow}>
          {[0.05, 0.1, 0.25, 0.5].map(multiplier => (
            <Pressable key={multiplier} onPress={() => setNotionalUsd(account ? Math.max(25, account.cashBalanceUsd * multiplier).toFixed(0) : String(multiplier * 1000))} style={s.quickBtn}>
              <Text style={s.quickText}>{Math.round(multiplier * 100)}% CASH</Text>
            </Pressable>
          ))}
        </View>
        <View style={s.inlineRow}>
          <View style={s.inlineField}>
            <Text style={s.fieldLabel}>Stop loss %</Text>
            <TextInput style={s.input} value={stopLossPct} onChangeText={setStopLossPct} placeholder="6" placeholderTextColor="#555" keyboardType="decimal-pad" />
          </View>
          <View style={s.inlineField}>
            <Text style={s.fieldLabel}>Take profit %</Text>
            <TextInput style={s.input} value={takeProfitPct} onChangeText={setTakeProfitPct} placeholder="12" placeholderTextColor="#555" keyboardType="decimal-pad" />
          </View>
          <View style={s.inlineField}>
            <Text style={s.fieldLabel}>Trailing stop %</Text>
            <TextInput style={s.input} value={trailingStopPct} onChangeText={setTrailingStopPct} placeholder="4" placeholderTextColor="#555" keyboardType="decimal-pad" />
          </View>
        </View>
        <Pressable style={s.actionBtn} onPress={handleOpenTrade} disabled={placing}>
          {placing ? <ActivityIndicator size="small" color="#14b8a6" /> : <Text style={s.actionText}>OPEN PAPER LONG</Text>}
        </Pressable>
      </View>

      {message && (
        <View style={[s.banner, { borderColor: message.ok ? '#22c55e30' : '#ef444430' }]}>
          <Text style={[s.bannerText, { color: message.ok ? '#22c55e' : '#ef4444' }]}>{message.text}</Text>
        </View>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  scrollPad: { padding: 16, paddingBottom: 40 },
  label: { color: '#6f6f6f', fontSize: 10, fontWeight: '700', letterSpacing: 2, fontFamily: 'monospace', marginBottom: 8 },
  desc: { color: '#6f6f6f', fontSize: 13, lineHeight: 20, fontFamily: 'monospace', marginBottom: 12 },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  statCard: { flex: 1, backgroundColor: '#161616', borderRadius: 10, borderWidth: 1, borderColor: '#1a1a1a', padding: 12, alignItems: 'center' },
  statValue: { color: '#e8e8e8', fontSize: 18, fontWeight: '800', fontFamily: 'monospace' },
  statLabel: { color: '#6f6f6f', fontSize: 10, marginTop: 4, fontFamily: 'monospace' },
  card: { backgroundColor: '#161616', borderRadius: 10, borderWidth: 1, borderColor: '#1a1a1a', padding: 14, marginBottom: 12 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  cardTitle: { color: '#e8e8e8', fontSize: 13, fontWeight: '700', fontFamily: 'monospace' },
  cardMeta: { color: '#9e9e9e', fontSize: 11, fontFamily: 'monospace', marginTop: 2 },
  resetBtn: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: '#ef444430', backgroundColor: '#ef444410' },
  resetText: { color: '#ef4444', fontSize: 11, fontWeight: '700', fontFamily: 'monospace' },
  fieldGroup: { marginBottom: 12 },
  fieldLabel: { color: '#9e9e9e', fontSize: 11, fontWeight: '600', fontFamily: 'monospace', marginBottom: 4 },
  input: { backgroundColor: '#0a0a0a', borderWidth: 1, borderColor: '#2a2a2a', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, color: '#e8e8e8', fontSize: 13, fontFamily: 'monospace' },
  quickRow: { flexDirection: 'row', gap: 8 },
  quickBtn: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6, borderWidth: 1, borderColor: '#2a2a2a', backgroundColor: '#161616' },
  quickBtnActive: { borderColor: '#14b8a660', backgroundColor: '#14b8a615' },
  quickText: { color: '#9e9e9e', fontSize: 11, fontWeight: '600', fontFamily: 'monospace' },
  inlineRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  inlineField: { flex: 1, minWidth: 120 },
  actionBtn: { marginTop: 12, paddingVertical: 12, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#14b8a615', borderWidth: 1, borderColor: '#14b8a630' },
  actionText: { color: '#14b8a6', fontSize: 12, fontWeight: '800', fontFamily: 'monospace' },
  banner: { backgroundColor: '#161616', borderRadius: 10, borderWidth: 1, padding: 12 },
  bannerText: { fontSize: 12, lineHeight: 18, fontFamily: 'monospace' },
});
