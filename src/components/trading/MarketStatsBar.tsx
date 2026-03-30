import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import type { TokenMarketSnapshot } from '../../lib/tradingMarket';
import { formatCompactUsd, formatPct } from '../../lib/tradingMarket';
import SkeletonLoader from './SkeletonLoader';

interface Props {
  snapshot: TokenMarketSnapshot | null;
  loading: boolean;
}

export default function MarketStatsBar({ snapshot, loading }: Props) {
  if (loading || !snapshot) {
    return (
      <View style={ms.bar}>
        <SkeletonLoader width={60} height={18} />
        <SkeletonLoader width={80} height={22} />
        <SkeletonLoader width={55} height={18} />
        <SkeletonLoader width={70} height={18} />
        <SkeletonLoader width={70} height={18} />
        <SkeletonLoader width={70} height={18} />
      </View>
    );
  }

  const changeColor = snapshot.priceChange24h >= 0 ? '#22c55e' : '#ef4444';

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={ms.scroll}>
      <View style={ms.bar}>
        {/* Symbol */}
        <Text style={ms.symbol}>{snapshot.symbol}</Text>

        {/* Price */}
        <Text style={ms.price}>
          ${snapshot.priceUsd < 0.01 ? snapshot.priceUsd.toFixed(6) : snapshot.priceUsd < 1 ? snapshot.priceUsd.toFixed(4) : snapshot.priceUsd.toFixed(2)}
        </Text>

        {/* 24h Change */}
        <View style={[ms.changePill, { borderColor: changeColor + '50', backgroundColor: changeColor + '15' }]}>
          <Text style={[ms.changeText, { color: changeColor }]}>{formatPct(snapshot.priceChange24h)}</Text>
        </View>

        {/* Stats */}
        <View style={ms.stat}>
          <Text style={ms.statLabel}>24H VOL</Text>
          <Text style={ms.statValue}>{formatCompactUsd(snapshot.volume24h)}</Text>
        </View>

        <View style={ms.stat}>
          <Text style={ms.statLabel}>LIQ</Text>
          <Text style={ms.statValue}>{formatCompactUsd(snapshot.liquidityUsd)}</Text>
        </View>

        <View style={ms.stat}>
          <Text style={ms.statLabel}>MCAP</Text>
          <Text style={ms.statValue}>{formatCompactUsd(snapshot.marketCap)}</Text>
        </View>

        <View style={ms.stat}>
          <Text style={ms.statLabel}>1H</Text>
          <Text style={[ms.statValue, { color: snapshot.priceChange1h >= 0 ? '#22c55e' : '#ef4444' }]}>
            {formatPct(snapshot.priceChange1h)}
          </Text>
        </View>

        <View style={ms.stat}>
          <Text style={ms.statLabel}>B/S</Text>
          <Text style={ms.statValue}>{snapshot.buys24h}/{snapshot.sells24h}</Text>
        </View>
      </View>
    </ScrollView>
  );
}

const ms = StyleSheet.create({
  scroll: { flexShrink: 0 },
  bar: {
    backgroundColor: '#000000',
    borderBottomWidth: 2,
    borderBottomColor: '#2a2a2a',
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    minHeight: 48,
  },
  symbol: {
    color: '#e8e8e8',
    fontSize: 14,
    fontWeight: '700',
    fontFamily: 'monospace',
    letterSpacing: 1,
  },
  price: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  changePill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 2,
    borderWidth: 1,
  },
  changeText: {
    fontSize: 12,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  stat: { alignItems: 'center', gap: 2 },
  statLabel: {
    color: '#6f6f6f',
    fontSize: 9,
    fontWeight: '600',
    fontFamily: 'monospace',
    letterSpacing: 1,
  },
  statValue: {
    color: '#9e9e9e',
    fontSize: 12,
    fontWeight: '600',
    fontFamily: 'monospace',
  },
});
