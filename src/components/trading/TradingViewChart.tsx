import React, { useState } from 'react';
import { View, Text, Platform, ActivityIndicator, StyleSheet } from 'react-native';
import type { TokenMarketSnapshot } from '../../lib/tradingMarket';
import { buildPriceSeriesFromSnapshot } from '../../lib/tradingMarket';

const TRADINGVIEW_SYMBOLS: Record<string, string> = {
  SOL: 'BINANCE:SOLUSDT',
  JUP: 'RAYDIUM:JUPUSD',
  BONK: 'RAYDIUM:BONKUSD',
  RAY: 'RAYDIUM:RAYUSD',
  JTO: 'RAYDIUM:JTOUSD',
  PYTH: 'RAYDIUM:PYTHUSD',
  WIF: 'RAYDIUM:WIFUSD',
  RNDR: 'RAYDIUM:RNDRUSD',
  ORCA: 'RAYDIUM:ORCAUSD',
  HNT: 'RAYDIUM:HNTUSD',
  W: 'RAYDIUM:WUSD',
  USDC: 'BINANCE:USDCUSDT',
  USDT: 'BINANCE:USDTUSD',
  MNDE: 'RAYDIUM:MNDEUSD',
};

interface Props {
  symbol: string;
  mint: string;
  snapshot: TokenMarketSnapshot | null;
  height?: number;
}

function buildTradingViewUrl(tvSymbol: string): string {
  const params = new URLSearchParams({
    symbol: tvSymbol,
    interval: '60',
    theme: 'dark',
    style: '1',
    locale: 'en',
    hide_top_toolbar: '0',
    hide_side_toolbar: '0',
    allow_symbol_change: '0',
    save_image: '0',
    backgroundColor: 'rgba(0, 0, 0, 1)',
    gridColor: 'rgba(26, 26, 46, 0.5)',
    withdateranges: '1',
  });
  return `https://s.tradingview.com/widgetembed/?frameElementId=tv_chart&${params.toString()}`;
}

function FallbackChart({ snapshot, height }: { snapshot: TokenMarketSnapshot; height: number }) {
  const series = buildPriceSeriesFromSnapshot(snapshot);
  if (series.length === 0) {
    return (
      <View style={[tc.fallback, { height }]}>
        <Text style={tc.fallbackText}>No price data</Text>
      </View>
    );
  }

  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = max - min || 1;
  const chartH = height - 40;
  const isPositive = snapshot.priceChange24h >= 0;
  const lineColor = isPositive ? '#22c55e' : '#ef4444';

  return (
    <View style={[tc.fallback, { height }]}>
      <View style={tc.chartArea}>
        {series.map((price, i) => {
          if (i === 0) return null;
          const x1 = ((i - 1) / (series.length - 1)) * 100;
          const x2 = (i / (series.length - 1)) * 100;
          const y1 = chartH - ((series[i - 1] - min) / range) * chartH;
          const y2 = chartH - ((price - min) / range) * chartH;
          return (
            <View
              key={i}
              style={{
                position: 'absolute',
                left: `${x1}%`,
                top: Math.min(y1, y2),
                width: `${x2 - x1}%`,
                height: Math.abs(y2 - y1) || 2,
                backgroundColor: lineColor,
                opacity: 0.8,
              }}
            />
          );
        })}
      </View>
      <View style={tc.priceRow}>
        <Text style={[tc.priceText, { color: '#6f6f6f' }]}>${min.toFixed(4)}</Text>
        <Text style={[tc.priceText, { color: lineColor }]}>${snapshot.priceUsd.toFixed(4)}</Text>
        <Text style={[tc.priceText, { color: '#6f6f6f' }]}>${max.toFixed(4)}</Text>
      </View>
    </View>
  );
}

export default function TradingViewChart({ symbol, mint, snapshot, height = 400 }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const tvSymbol = TRADINGVIEW_SYMBOLS[symbol.toUpperCase()];

  // Fallback for native or unmapped tokens
  if (Platform.OS !== 'web' || !tvSymbol) {
    if (snapshot) {
      return <FallbackChart snapshot={snapshot} height={height} />;
    }
    return (
      <View style={[tc.fallback, { height }]}>
        <Text style={tc.fallbackText}>Select a token to view chart</Text>
      </View>
    );
  }

  const url = buildTradingViewUrl(tvSymbol);

  return (
    <View style={[tc.container, { height }]}>
      {loading && (
        <View style={tc.loadingOverlay}>
          <ActivityIndicator size="large" color="#6366f1" />
          <Text style={tc.loadingText}>Loading chart...</Text>
        </View>
      )}
      <iframe
        src={url}
        style={{
          width: '100%',
          height: height,
          border: 'none',
          backgroundColor: '#000000',
        }}
        onLoad={() => { setLoading(false); setError(false); }}
        onError={() => { setLoading(false); setError(true); }}
        sandbox="allow-scripts allow-same-origin allow-popups"
      />
      {error && snapshot && <FallbackChart snapshot={snapshot} height={height} />}
    </View>
  );
}

const tc = StyleSheet.create({
  container: {
    backgroundColor: '#000000',
    borderWidth: 2,
    borderColor: '#1a1a1a',
    borderRadius: 2,
    overflow: 'hidden',
    position: 'relative',
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000000',
    zIndex: 10,
  },
  loadingText: {
    color: '#6f6f6f',
    fontSize: 11,
    fontFamily: 'monospace',
    marginTop: 8,
  },
  fallback: {
    backgroundColor: '#000000',
    borderWidth: 2,
    borderColor: '#1a1a1a',
    borderRadius: 2,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 12,
  },
  fallbackText: {
    color: '#6f6f6f',
    fontSize: 12,
    fontFamily: 'monospace',
  },
  chartArea: {
    flex: 1,
    width: '100%',
    position: 'relative',
  },
  priceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 8,
  },
  priceText: {
    fontSize: 10,
    fontFamily: 'monospace',
    fontWeight: '600',
  },
});
