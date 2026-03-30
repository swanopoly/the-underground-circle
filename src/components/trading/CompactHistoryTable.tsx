import React, { useState, useEffect } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import {
  type TradeLogEntry,
  type TradingExecutionMode,
  getTradingLog,
  SOLANA_TOKEN_REGISTRY,
  SOL_MINT,
  USDC_MINT,
} from '../../lib/heliusTrading';
import { formatCompactUsd } from '../../lib/tradingMarket';

interface Props {
  userId: string;
}

function getTokenSymbol(mint: string): string {
  const entry = Object.entries(SOLANA_TOKEN_REGISTRY).find(([, t]) => t.mint === mint);
  if (entry) return entry[0];
  if (mint === SOL_MINT) return 'SOL';
  if (mint === USDC_MINT) return 'USDC';
  return mint.slice(0, 4);
}

function modeColor(mode: TradingExecutionMode): string {
  return mode === 'live' ? '#22c55e' : mode === 'paper' ? '#14b8a6' : '#f97316';
}

function modeLabel(mode: TradingExecutionMode): string {
  return mode === 'live' ? 'LIVE' : mode === 'paper' ? 'PAPER' : 'BACKTEST';
}

export default function CompactHistoryTable({ userId }: Props) {
  const [trades, setTrades] = useState<TradeLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [modeFilter, setModeFilter] = useState<'all' | TradingExecutionMode>('all');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await getTradingLog(userId, modeFilter, 50);
        if (!cancelled) setTrades(data);
      } catch {
        if (!cancelled) setTrades([]);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [userId, modeFilter]);

  return (
    <View style={ch.container}>
      {/* Mode filter */}
      <View style={ch.filterRow}>
        {(['all', 'live', 'paper', 'backtest'] as const).map(mode => {
          const active = modeFilter === mode;
          const c = mode === 'all' ? '#9e9e9e' : modeColor(mode);
          return (
            <Pressable
              key={mode}
              onPress={() => setModeFilter(mode)}
              style={[ch.filterPill, active && { borderColor: c + '70', backgroundColor: c + '18' }]}
            >
              <Text style={[ch.filterText, active && { color: c }]}>
                {mode === 'all' ? 'ALL' : modeLabel(mode)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {loading ? (
        <ActivityIndicator size="small" color="#6366f1" style={{ marginTop: 16 }} />
      ) : trades.length === 0 ? (
        <Text style={ch.empty}>No trades recorded</Text>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false}>
          {/* Header */}
          <View style={ch.headerRow}>
            <Text style={[ch.headerCell, { flex: 1 }]}>TIME</Text>
            <Text style={[ch.headerCell, { flex: 1 }]}>ACTION</Text>
            <Text style={[ch.headerCell, { flex: 0.7 }]}>MODE</Text>
            <Text style={[ch.headerCell, { flex: 1.5 }]}>PAIR</Text>
            <Text style={[ch.headerCell, { flex: 0.7 }]}>STATUS</Text>
            <Text style={[ch.headerCell, { flex: 0.7 }]}>TX</Text>
          </View>
          {trades.map(trade => {
            const mc = modeColor(trade.executionMode);
            const inputSym = trade.inputMint ? getTokenSymbol(trade.inputMint) : '';
            const outputSym = trade.outputMint ? getTokenSymbol(trade.outputMint) : '';
            const statusColor = trade.status === 'success' ? '#22c55e' : trade.status === 'failed' ? '#ef4444' : '#9e9e9e';
            const pnlUsd = typeof trade.metadata?.pnlUsd === 'number' ? trade.metadata.pnlUsd : undefined;
            const d = new Date(trade.createdAt);
            const timeStr = `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
            return (
              <View key={trade.id} style={ch.row}>
                <Text style={[ch.cellMuted, { flex: 1 }]}>{timeStr}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={ch.cellBold}>{trade.action.toUpperCase()}</Text>
                  {typeof pnlUsd === 'number' && (
                    <Text style={[ch.cellTiny, { color: pnlUsd >= 0 ? '#22c55e' : '#ef4444' }]}>
                      {pnlUsd >= 0 ? '+' : ''}{formatCompactUsd(Math.abs(pnlUsd))}
                    </Text>
                  )}
                </View>
                <Text style={[ch.cellTiny, { flex: 0.7, color: mc }]}>{modeLabel(trade.executionMode)}</Text>
                <View style={{ flex: 1.5 }}>
                  <Text style={ch.cell} numberOfLines={1}>
                    {inputSym} {'>'} {outputSym}
                  </Text>
                  {trade.priceUsd ? (
                    <Text style={ch.cellMuted}>${trade.priceUsd.toFixed(4)}</Text>
                  ) : null}
                </View>
                <Text style={[ch.cellTiny, { flex: 0.7, color: statusColor }]}>
                  {trade.status.toUpperCase()}
                </Text>
                <View style={{ flex: 0.7 }}>
                  {trade.txHash ? (
                    <Pressable
                      onPress={() => {
                        if (Platform.OS === 'web') window.open(`https://solscan.io/tx/${trade.txHash}`, '_blank');
                      }}
                    >
                      <Text style={ch.txLink}>{trade.txHash.slice(0, 6)}...</Text>
                    </Pressable>
                  ) : (
                    <Text style={ch.cellMuted}>—</Text>
                  )}
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const ch = StyleSheet.create({
  container: { flex: 1, padding: 8 },
  filterRow: { flexDirection: 'row', gap: 6, marginBottom: 8, alignItems: 'center' },
  filterPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: '#1a1a1a',
  },
  filterText: { color: '#6f6f6f', fontSize: 10, fontWeight: '700', fontFamily: 'monospace' },
  empty: { color: '#6f6f6f', fontSize: 11, fontFamily: 'monospace', textAlign: 'center', marginTop: 16 },
  headerRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#1a1a1a', paddingBottom: 4, marginBottom: 4 },
  headerCell: { color: '#3e3e3e', fontSize: 9, fontWeight: '700', fontFamily: 'monospace', letterSpacing: 1 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#0a0a0a' },
  cell: { color: '#9e9e9e', fontSize: 11, fontFamily: 'monospace' },
  cellBold: { color: '#e8e8e8', fontSize: 11, fontWeight: '700', fontFamily: 'monospace' },
  cellMuted: { color: '#6f6f6f', fontSize: 9, fontFamily: 'monospace' },
  cellTiny: { fontSize: 9, fontFamily: 'monospace', fontWeight: '600' },
  txLink: { color: '#6366f1', fontSize: 9, fontFamily: 'monospace', fontWeight: '600' },
});
