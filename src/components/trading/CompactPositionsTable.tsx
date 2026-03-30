import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import {
  type HeliusClient,
  type Position,
  type TradingExecutionMode,
  getOpenPositions,
  checkPositionStops,
  closePosition,
  closePaperPosition,
} from '../../lib/heliusTrading';

interface Props {
  client: HeliusClient;
  userId: string;
}

function modeColor(mode: TradingExecutionMode): string {
  return mode === 'live' ? '#22c55e' : mode === 'paper' ? '#14b8a6' : '#f97316';
}

function modeLabel(mode: TradingExecutionMode): string {
  return mode === 'live' ? 'LIVE' : mode === 'paper' ? 'PAPER' : 'BACKTEST';
}

export default function CompactPositionsTable({ client, userId }: Props) {
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [modeFilter, setModeFilter] = useState<'all' | 'live' | 'paper'>('all');

  const loadPositions = useCallback(async () => {
    setLoading(true);
    try {
      setPositions(await getOpenPositions(userId, modeFilter));
    } catch {
      setPositions([]);
    }
    setLoading(false);
  }, [userId, modeFilter]);

  useEffect(() => { loadPositions(); }, [loadPositions]);

  const handleCheckStops = async () => {
    setChecking(true);
    try {
      const result = await checkPositionStops(client, userId);
      const total = result.stoppedOut.length + result.tookProfit.length;
      if (total > 0) alert(`${result.stoppedOut.length} stopped out, ${result.tookProfit.length} took profit`);
      await loadPositions();
    } catch (err: any) {
      alert('Error: ' + (err.message || err));
    }
    setChecking(false);
  };

  const handleClose = async (pos: Position) => {
    try {
      const { price } = await client.getTokenPrice(pos.tokenMint);
      if (!price) throw new Error('Price unavailable');
      if (pos.executionMode === 'paper') {
        await closePaperPosition(pos.id, price, 'manual');
      } else {
        await closePosition(pos.id, price, 'manual');
      }
      await loadPositions();
    } catch (err: any) {
      alert('Error: ' + (err.message || err));
    }
  };

  return (
    <View style={cp.container}>
      {/* Mode filter */}
      <View style={cp.filterRow}>
        {(['all', 'live', 'paper'] as const).map(mode => {
          const active = modeFilter === mode;
          const c = mode === 'all' ? '#9e9e9e' : modeColor(mode);
          return (
            <Pressable
              key={mode}
              onPress={() => setModeFilter(mode)}
              style={[cp.filterPill, active && { borderColor: c + '70', backgroundColor: c + '18' }]}
            >
              <Text style={[cp.filterText, active && { color: c }]}>
                {mode === 'all' ? 'ALL' : modeLabel(mode)}
              </Text>
            </Pressable>
          );
        })}
        <Pressable onPress={handleCheckStops} disabled={checking} style={cp.checkBtn}>
          <Text style={cp.checkBtnText}>{checking ? '...' : 'CHECK STOPS'}</Text>
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator size="small" color="#6366f1" style={{ marginTop: 16 }} />
      ) : positions.length === 0 ? (
        <Text style={cp.empty}>No open positions</Text>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false}>
          {/* Header */}
          <View style={cp.headerRow}>
            <Text style={[cp.headerCell, { flex: 1.5 }]}>TOKEN</Text>
            <Text style={[cp.headerCell, { flex: 1 }]}>ENTRY</Text>
            <Text style={[cp.headerCell, { flex: 1 }]}>CURRENT</Text>
            <Text style={[cp.headerCell, { flex: 1 }]}>P&L</Text>
            <Text style={[cp.headerCell, { flex: 1 }]}>SL/TP</Text>
            <Text style={[cp.headerCell, { flex: 0.7 }]}></Text>
          </View>
          {positions.map(pos => {
            const pnlColor = pos.unrealizedPnl >= 0 ? '#22c55e' : '#ef4444';
            const mc = modeColor(pos.executionMode);
            return (
              <View key={pos.id} style={cp.row}>
                <View style={{ flex: 1.5 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Text style={cp.cellBold}>{pos.tokenSymbol}</Text>
                    <Text style={[cp.cellTiny, { color: mc }]}>{modeLabel(pos.executionMode)}</Text>
                  </View>
                  <Text style={cp.cellMuted}>{pos.side.toUpperCase()}</Text>
                </View>
                <Text style={[cp.cell, { flex: 1 }]}>${pos.entryPrice.toFixed(4)}</Text>
                <Text style={[cp.cell, { flex: 1 }]}>${pos.currentPrice.toFixed(4)}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[cp.cellBold, { color: pnlColor }]}>
                    {pos.unrealizedPnlPct >= 0 ? '+' : ''}{pos.unrealizedPnlPct.toFixed(1)}%
                  </Text>
                  <Text style={[cp.cellMuted, { color: pnlColor }]}>
                    ${pos.unrealizedPnl.toFixed(2)}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  {pos.stopLossPrice && <Text style={[cp.cellTiny, { color: '#ef4444' }]}>SL ${pos.stopLossPrice.toFixed(2)}</Text>}
                  {pos.takeProfitPrice && <Text style={[cp.cellTiny, { color: '#22c55e' }]}>TP ${pos.takeProfitPrice.toFixed(2)}</Text>}
                  {pos.trailingStopPct && <Text style={[cp.cellTiny, { color: '#f59e0b' }]}>T {pos.trailingStopPct}%</Text>}
                </View>
                <Pressable onPress={() => handleClose(pos)} style={{ flex: 0.7 }}>
                  <Text style={cp.closeText}>CLOSE</Text>
                </Pressable>
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const cp = StyleSheet.create({
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
  checkBtn: {
    marginLeft: 'auto',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: '#f59e0b40',
    backgroundColor: '#f59e0b10',
  },
  checkBtnText: { color: '#f59e0b', fontSize: 9, fontWeight: '700', fontFamily: 'monospace' },
  empty: { color: '#6f6f6f', fontSize: 11, fontFamily: 'monospace', textAlign: 'center', marginTop: 16 },
  headerRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#1a1a1a', paddingBottom: 4, marginBottom: 4 },
  headerCell: { color: '#3e3e3e', fontSize: 9, fontWeight: '700', fontFamily: 'monospace', letterSpacing: 1 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#0a0a0a' },
  cell: { color: '#9e9e9e', fontSize: 11, fontFamily: 'monospace' },
  cellBold: { color: '#e8e8e8', fontSize: 11, fontWeight: '700', fontFamily: 'monospace' },
  cellMuted: { color: '#6f6f6f', fontSize: 9, fontFamily: 'monospace' },
  cellTiny: { fontSize: 9, fontFamily: 'monospace', fontWeight: '600' },
  closeText: { color: '#ef4444', fontSize: 9, fontWeight: '700', fontFamily: 'monospace', textAlign: 'center' },
});
