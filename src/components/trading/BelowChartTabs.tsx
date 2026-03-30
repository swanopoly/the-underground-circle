import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import type { HeliusClient, TradingBotWalletInfo, PortfolioSnapshot } from '../../lib/heliusTrading';
import CompactPositionsTable from './CompactPositionsTable';
import CompactHistoryTable from './CompactHistoryTable';

type SubTab = 'positions' | 'history' | 'portfolio';

interface Props {
  client: HeliusClient;
  userId: string;
  walletAddress: string | null;
  portfolio: PortfolioSnapshot | null;
  positionCount?: number;
}

function CompactPortfolio({ portfolio }: { portfolio: PortfolioSnapshot | null }) {
  if (!portfolio) {
    return <Text style={bt.empty}>Link a wallet to view portfolio</Text>;
  }

  return (
    <View style={bt.portfolioContainer}>
      {/* Summary row */}
      <View style={bt.summaryRow}>
        <View style={bt.summaryItem}>
          <Text style={bt.summaryValue}>${portfolio.totalValueUsd.toFixed(2)}</Text>
          <Text style={bt.summaryLabel}>TOTAL</Text>
        </View>
        <View style={bt.summaryItem}>
          <Text style={bt.summaryValue}>{portfolio.solBalance.toFixed(4)}</Text>
          <Text style={bt.summaryLabel}>SOL</Text>
        </View>
        <View style={bt.summaryItem}>
          <Text style={bt.summaryValue}>{portfolio.tokens.length}</Text>
          <Text style={bt.summaryLabel}>TOKENS</Text>
        </View>
      </View>

      {/* Holdings table */}
      <View style={bt.holdingsHeader}>
        <Text style={[bt.holdingsCell, { flex: 1 }]}>TOKEN</Text>
        <Text style={[bt.holdingsCell, { flex: 1, textAlign: 'right' }]}>AMOUNT</Text>
        <Text style={[bt.holdingsCell, { flex: 1, textAlign: 'right' }]}>VALUE</Text>
      </View>
      <ScrollView showsVerticalScrollIndicator={false}>
        {portfolio.tokens
          .filter(t => t.amount > 0)
          .sort((a, b) => b.usdValue - a.usdValue)
          .slice(0, 12)
          .map(token => (
            <View key={token.mint} style={bt.holdingsRow}>
              <View style={{ flex: 1 }}>
                <Text style={bt.holdingsSymbol}>{token.symbol}</Text>
              </View>
              <Text style={[bt.holdingsAmount, { flex: 1, textAlign: 'right' }]}>
                {token.amount < 0.0001 ? '<0.0001' : token.amount.toFixed(4)}
              </Text>
              <Text style={[bt.holdingsValue, { flex: 1, textAlign: 'right' }]}>
                {token.usdValue > 0 ? `$${token.usdValue.toFixed(2)}` : '—'}
              </Text>
            </View>
          ))}
      </ScrollView>
    </View>
  );
}

export default function BelowChartTabs({ client, userId, walletAddress, portfolio, positionCount }: Props) {
  const [subTab, setSubTab] = useState<SubTab>('positions');

  const tabs: { key: SubTab; label: string; badge?: number }[] = [
    { key: 'positions', label: 'Positions', badge: positionCount },
    { key: 'history', label: 'History' },
    { key: 'portfolio', label: 'Portfolio' },
  ];

  return (
    <View style={bt.container}>
      {/* Sub-tab bar */}
      <View style={bt.tabBar}>
        {tabs.map(t => {
          const active = subTab === t.key;
          return (
            <Pressable key={t.key} onPress={() => setSubTab(t.key)} style={[bt.tab, active && bt.tabActive]}>
              <Text style={[bt.tabText, active && bt.tabTextActive]}>
                {t.label}
                {t.badge != null && t.badge > 0 ? ` (${t.badge})` : ''}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Content */}
      <View style={bt.content}>
        {subTab === 'positions' && <CompactPositionsTable client={client} userId={userId} />}
        {subTab === 'history' && <CompactHistoryTable userId={userId} />}
        {subTab === 'portfolio' && <CompactPortfolio portfolio={portfolio} />}
      </View>
    </View>
  );
}

const bt = StyleSheet.create({
  container: {
    borderTopWidth: 2,
    borderTopColor: '#1a1a1a',
    maxHeight: 280,
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#0a0a0a',
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: '#6366f1',
    backgroundColor: '#6366f110',
  },
  tabText: {
    color: '#6f6f6f',
    fontSize: 11,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  tabTextActive: {
    color: '#e8e8e8',
  },
  content: {
    flex: 1,
    backgroundColor: '#050508',
  },
  empty: {
    color: '#6f6f6f',
    fontSize: 11,
    fontFamily: 'monospace',
    textAlign: 'center',
    marginTop: 16,
  },
  portfolioContainer: { flex: 1, padding: 8 },
  summaryRow: { flexDirection: 'row', gap: 16, marginBottom: 10 },
  summaryItem: { alignItems: 'center' },
  summaryValue: { color: '#e8e8e8', fontSize: 14, fontWeight: '700', fontFamily: 'monospace' },
  summaryLabel: { color: '#6f6f6f', fontSize: 9, fontWeight: '600', fontFamily: 'monospace', letterSpacing: 1 },
  holdingsHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
    paddingBottom: 4,
    marginBottom: 4,
  },
  holdingsCell: { color: '#3e3e3e', fontSize: 9, fontWeight: '700', fontFamily: 'monospace', letterSpacing: 1 },
  holdingsRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: '#0a0a0a' },
  holdingsSymbol: { color: '#e8e8e8', fontSize: 11, fontWeight: '700', fontFamily: 'monospace' },
  holdingsAmount: { color: '#9e9e9e', fontSize: 10, fontFamily: 'monospace' },
  holdingsValue: { color: '#9e9e9e', fontSize: 10, fontFamily: 'monospace' },
});
