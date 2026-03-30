import React, { useState, useEffect, useRef } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SOLANA_TOKEN_REGISTRY, SOL_MINT } from '../../lib/heliusTrading';
import { fetchTokenMarketSnapshot, formatPct, type TokenMarketSnapshot } from '../../lib/tradingMarket';
import SkeletonLoader from './SkeletonLoader';

interface Props {
  selectedMint: string;
  onSelectMint: (mint: string) => void;
  isDesktop: boolean;
}

type TokenEntry = { key: string; mint: string; symbol: string; name: string };

const TOKEN_LIST: TokenEntry[] = Object.entries(SOLANA_TOKEN_REGISTRY)
  .filter(([sym]) => sym !== 'USDT' && sym !== 'TENSOR')
  .map(([sym, info]) => ({ key: sym, mint: info.mint, symbol: sym, name: info.name }));

export default function TokenSelectorPanel({ selectedMint, onSelectMint, isDesktop }: Props) {
  const [snapshots, setSnapshots] = useState<Record<string, TokenMarketSnapshot>>({});
  const [loading, setLoading] = useState(true);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    let cancelled = false;

    (async () => {
      setLoading(true);
      const results: Record<string, TokenMarketSnapshot> = {};
      const settled = await Promise.allSettled(
        TOKEN_LIST.map(async (t) => {
          const snap = await fetchTokenMarketSnapshot(t.mint);
          if (snap && !cancelled) results[t.mint] = snap;
        })
      );
      if (!cancelled) {
        setSnapshots(results);
        setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  if (isDesktop) {
    return (
      <ScrollView style={ts.sidebar} showsVerticalScrollIndicator={false}>
        {TOKEN_LIST.map((t) => {
          const active = selectedMint === t.mint;
          const snap = snapshots[t.mint];
          const change = snap?.priceChange24h ?? 0;
          const changeColor = change >= 0 ? '#22c55e' : '#ef4444';
          return (
            <Pressable
              key={t.key}
              onPress={() => onSelectMint(t.mint)}
              style={[ts.tokenCard, active && ts.tokenCardActive]}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={[ts.tokenSymbol, active && { color: '#e8e8e8' }]}>{t.symbol}</Text>
                {!loading && snap ? (
                  <Text style={[ts.tokenChange, { color: changeColor }]}>{formatPct(change)}</Text>
                ) : (
                  <SkeletonLoader width={40} height={12} />
                )}
              </View>
              {!loading && snap ? (
                <Text style={ts.tokenPrice}>
                  ${snap.priceUsd < 0.01 ? snap.priceUsd.toFixed(6) : snap.priceUsd < 1 ? snap.priceUsd.toFixed(4) : snap.priceUsd.toFixed(2)}
                </Text>
              ) : (
                <SkeletonLoader width={60} height={12} />
              )}
            </Pressable>
          );
        })}
      </ScrollView>
    );
  }

  // Mobile: horizontal scroll
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={ts.mobileScroll}>
      <View style={ts.mobileRow}>
        {TOKEN_LIST.map((t) => {
          const active = selectedMint === t.mint;
          const snap = snapshots[t.mint];
          const change = snap?.priceChange24h ?? 0;
          const changeColor = change >= 0 ? '#22c55e' : '#ef4444';
          return (
            <Pressable
              key={t.key}
              onPress={() => onSelectMint(t.mint)}
              style={[ts.mobilePill, active && ts.mobilePillActive]}
            >
              <Text style={[ts.mobileSymbol, active && { color: '#e8e8e8' }]}>{t.symbol}</Text>
              {snap && (
                <Text style={[ts.mobileChange, { color: changeColor }]}>{formatPct(change)}</Text>
              )}
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

const ts = StyleSheet.create({
  sidebar: {
    width: 180,
    backgroundColor: '#0a0a0a',
    borderRightWidth: 2,
    borderRightColor: '#1a1a1a',
  },
  tokenCard: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
    gap: 2,
  },
  tokenCardActive: {
    backgroundColor: '#6366f115',
    borderLeftWidth: 3,
    borderLeftColor: '#6366f1',
  },
  tokenSymbol: {
    color: '#9e9e9e',
    fontSize: 12,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  tokenPrice: {
    color: '#6f6f6f',
    fontSize: 11,
    fontFamily: 'monospace',
  },
  tokenChange: {
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  mobileScroll: {
    flexShrink: 0,
    backgroundColor: '#0a0a0a',
    borderBottomWidth: 2,
    borderBottomColor: '#1a1a1a',
  },
  mobileRow: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  mobilePill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 2,
    borderWidth: 2,
    borderColor: '#1a1a1a',
    backgroundColor: '#0a0a0a',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  mobilePillActive: {
    borderColor: '#6366f150',
    backgroundColor: '#6366f115',
  },
  mobileSymbol: {
    color: '#9e9e9e',
    fontSize: 11,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  mobileChange: {
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
});
