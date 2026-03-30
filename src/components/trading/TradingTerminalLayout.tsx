import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, StyleSheet, useWindowDimensions } from 'react-native';
import type {
  HeliusClient,
  TradingBotWalletInfo,
  PortfolioSnapshot,
} from '../../lib/heliusTrading';
import { SOL_MINT, SOLANA_TOKEN_REGISTRY, getOpenPositions } from '../../lib/heliusTrading';
import { fetchTokenMarketSnapshot, type TokenMarketSnapshot } from '../../lib/tradingMarket';

import MarketStatsBar from './MarketStatsBar';
import TradingViewChart from './TradingViewChart';
import TokenSelectorPanel from './TokenSelectorPanel';
import CompactTradeForm from './CompactTradeForm';
import BelowChartTabs from './BelowChartTabs';

interface Props {
  client: HeliusClient;
  walletAddress: string | null;
  userId: string;
  circleId: string;
  botWallet: TradingBotWalletInfo | null;
  onBotWalletRefresh: () => Promise<void>;
}

function getSymbolForMint(mint: string): string {
  const entry = Object.entries(SOLANA_TOKEN_REGISTRY).find(([, t]) => t.mint === mint);
  return entry ? entry[0] : 'TOKEN';
}

export default function TradingTerminalLayout({
  client,
  walletAddress,
  userId,
  circleId,
  botWallet,
  onBotWalletRefresh,
}: Props) {
  const { width } = useWindowDimensions();
  const isDesktop = width > 900;

  const [selectedMint, setSelectedMint] = useState(SOL_MINT);
  const [snapshot, setSnapshot] = useState<TokenMarketSnapshot | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(true);
  const [positionCount, setPositionCount] = useState(0);
  const [portfolio, setPortfolio] = useState<PortfolioSnapshot | null>(null);
  const fetchedMintRef = useRef('');

  const symbol = getSymbolForMint(selectedMint);

  const loadSnapshot = useCallback(async (mint: string) => {
    setSnapshotLoading(true);
    try {
      const snap = await fetchTokenMarketSnapshot(mint);
      setSnapshot(snap);
    } catch {
      setSnapshot(null);
    }
    setSnapshotLoading(false);
  }, []);

  useEffect(() => {
    if (fetchedMintRef.current !== selectedMint) {
      fetchedMintRef.current = selectedMint;
      loadSnapshot(selectedMint);
    }
  }, [selectedMint, loadSnapshot]);

  // Load position count + portfolio
  useEffect(() => {
    (async () => {
      try {
        const pos = await getOpenPositions(userId, 'all');
        setPositionCount(pos.length);
      } catch {
        setPositionCount(0);
      }
    })();
    if (walletAddress) {
      (async () => {
        try {
          setPortfolio(await client.getPortfolio(walletAddress));
        } catch {
          setPortfolio(null);
        }
      })();
    }
  }, [userId, walletAddress, client]);

  if (isDesktop) {
    return (
      <View style={tl.desktop}>
        {/* Stats bar */}
        <MarketStatsBar snapshot={snapshot} loading={snapshotLoading} />

        {/* Main row: sidebar | chart | trade form */}
        <View style={tl.mainRow}>
          <TokenSelectorPanel
            selectedMint={selectedMint}
            onSelectMint={setSelectedMint}
            isDesktop
          />

          <View style={tl.centerColumn}>
            <TradingViewChart
              symbol={symbol}
              mint={selectedMint}
              snapshot={snapshot}
              height={400}
            />
          </View>

          <CompactTradeForm
            client={client}
            walletAddress={walletAddress}
            userId={userId}
            circleId={circleId}
            botWallet={botWallet}
            onBotWalletRefresh={onBotWalletRefresh}
            selectedMint={selectedMint}
            isDesktop
          />
        </View>

        {/* Below chart tabs */}
        <BelowChartTabs
          client={client}
          userId={userId}
          walletAddress={walletAddress}
          portfolio={portfolio}
          positionCount={positionCount}
        />
      </View>
    );
  }

  // Mobile layout — vertical stack
  return (
    <View style={tl.mobile}>
      <MarketStatsBar snapshot={snapshot} loading={snapshotLoading} />

      <TokenSelectorPanel
        selectedMint={selectedMint}
        onSelectMint={setSelectedMint}
        isDesktop={false}
      />

      <TradingViewChart
        symbol={symbol}
        mint={selectedMint}
        snapshot={snapshot}
        height={300}
      />

      <CompactTradeForm
        client={client}
        walletAddress={walletAddress}
        userId={userId}
        circleId={circleId}
        botWallet={botWallet}
        onBotWalletRefresh={onBotWalletRefresh}
        selectedMint={selectedMint}
        isDesktop={false}
      />

      <BelowChartTabs
        client={client}
        userId={userId}
        walletAddress={walletAddress}
        portfolio={portfolio}
        positionCount={positionCount}
      />
    </View>
  );
}

const tl = StyleSheet.create({
  desktop: {
    flex: 1,
    backgroundColor: '#050508',
  },
  mainRow: {
    flexDirection: 'row',
    flex: 1,
  },
  centerColumn: {
    flex: 1,
  },
  mobile: {
    flex: 1,
    backgroundColor: '#050508',
  },
});
