import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Image,
  useWindowDimensions,
  Platform,
  ActivityIndicator,
} from 'react-native';

interface TokenBalance {
  symbol: string;
  name: string;
  balance: string;
  usdValue: string;
}

interface NFT {
  name: string;
  image: string;
  collection: string;
}

export default function WalletDashboard({ walletAddress, chain }: { walletAddress: string; chain: string }) {
  const [tokens, setTokens] = useState<TokenBalance[]>([]);
  const [nfts, setNfts] = useState<NFT[]>([]);
  const [totalValue, setTotalValue] = useState('0.00');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { width } = useWindowDimensions();

  const fetchBalances = async () => {
    try {
      if (chain === 'ethereum') {
        await fetchEthBalances();
      } else if (chain === 'solana') {
        await fetchSolBalances();
      }
    } catch (e) {
      console.error('Failed to fetch balances:', e);
    }
    setLoading(false);
  };

  const fetchEthBalances = async () => {
    try {
      const response = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd`
      );
      const prices = await response.json();
      const ethPrice = prices.ethereum?.usd || 0;

      // Get ETH balance via public RPC
      const balanceHex = await jsonRpc('https://eth.llamarpc.com', 'eth_getBalance', [walletAddress, 'latest']);
      const balanceWei = parseInt(balanceHex, 16);
      const balanceEth = balanceWei / 1e18;
      const usdValue = (balanceEth * ethPrice).toFixed(2);

      setTokens([{
        symbol: 'ETH',
        name: 'Ethereum',
        balance: balanceEth.toFixed(4),
        usdValue: `$${usdValue}`,
      }]);
      setTotalValue(usdValue);
    } catch (e) {
      console.error('ETH fetch error:', e);
    }
  };

  const fetchSolBalances = async () => {
    try {
      const response = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd`
      );
      const prices = await response.json();
      const solPrice = prices.solana?.usd || 0;

      const balanceResult = await jsonRpc('https://api.mainnet-beta.solana.com', 'getBalance', [walletAddress]);
      const balanceLamports = balanceResult?.value || 0;
      const balanceSol = balanceLamports / 1e9;
      const usdValue = (balanceSol * solPrice).toFixed(2);

      setTokens([{
        symbol: 'SOL',
        name: 'Solana',
        balance: balanceSol.toFixed(4),
        usdValue: `$${usdValue}`,
      }]);
      setTotalValue(usdValue);
    } catch (e) {
      console.error('SOL fetch error:', e);
    }
  };

  const jsonRpc = async (url: string, method: string, params: any[]) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    const data = await res.json();
    return data.result;
  };

  useEffect(() => {
    fetchBalances();
  }, [walletAddress, chain]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchBalances();
    setRefreshing(false);
  };

  const shortenAddress = (addr: string) =>
    `${addr.slice(0, 6)}...${addr.slice(-4)}`;

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#fff" />
        <Text style={styles.loadingText}>Loading wallet...</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />
      }
    >
      {/* Portfolio Value */}
      <View style={styles.portfolioCard}>
        <Text style={styles.portfolioLabel}>PORTFOLIO VALUE</Text>
        <Text style={styles.portfolioValue}>${totalValue}</Text>
        <View style={styles.addressBadge}>
          <Text style={styles.addressChain}>{chain === 'ethereum' ? '⟠ ETH' : '◎ SOL'}</Text>
          <Text style={styles.addressText}>{shortenAddress(walletAddress)}</Text>
        </View>
      </View>

      {/* Token Balances */}
      <Text style={styles.sectionTitle}>TOKENS</Text>
      {tokens.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>No tokens found</Text>
        </View>
      ) : (
        tokens.map((token, i) => (
          <View key={i} style={styles.tokenCard}>
            <View style={styles.tokenLeft}>
              <View style={styles.tokenIcon}>
                <Text style={styles.tokenIconText}>
                  {token.symbol === 'ETH' ? '⟠' : '◎'}
                </Text>
              </View>
              <View>
                <Text style={styles.tokenName}>{token.name}</Text>
                <Text style={styles.tokenSymbol}>{token.symbol}</Text>
              </View>
            </View>
            <View style={styles.tokenRight}>
              <Text style={styles.tokenBalance}>{token.balance}</Text>
              <Text style={styles.tokenUsd}>{token.usdValue}</Text>
            </View>
          </View>
        ))
      )}

      {/* NFTs Section */}
      <Text style={styles.sectionTitle}>NFTs</Text>
      <View style={styles.emptyCard}>
        <Text style={styles.emptyText}>NFT display coming soon</Text>
        <Text style={styles.emptySubtext}>We're building this next 🔥</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  content: {
    padding: 20,
    maxWidth: 500,
    alignSelf: 'center',
    width: '100%',
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#666',
    marginTop: 12,
    fontSize: 14,
  },
  portfolioCard: {
    backgroundColor: '#111',
    borderRadius: 16,
    padding: 28,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#222',
    marginBottom: 28,
  },
  portfolioLabel: {
    color: '#666',
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: '700',
    marginBottom: 8,
  },
  portfolioValue: {
    color: '#fff',
    fontSize: 40,
    fontWeight: '900',
    letterSpacing: 1,
    marginBottom: 16,
  },
  addressBadge: {
    flexDirection: 'row',
    backgroundColor: '#1a1a1a',
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 14,
    alignItems: 'center',
    gap: 8,
  },
  addressChain: {
    color: '#888',
    fontSize: 12,
    fontWeight: '700',
  },
  addressText: {
    color: '#555',
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  sectionTitle: {
    color: '#666',
    fontSize: 12,
    letterSpacing: 2,
    fontWeight: '700',
    marginBottom: 12,
  },
  tokenCard: {
    backgroundColor: '#111',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#222',
    marginBottom: 8,
  },
  tokenLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  tokenIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1a1a2e',
    justifyContent: 'center',
    alignItems: 'center',
  },
  tokenIconText: {
    fontSize: 20,
  },
  tokenName: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  tokenSymbol: {
    color: '#666',
    fontSize: 12,
    marginTop: 2,
  },
  tokenRight: {
    alignItems: 'flex-end',
  },
  tokenBalance: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  tokenUsd: {
    color: '#666',
    fontSize: 12,
    marginTop: 2,
  },
  emptyCard: {
    backgroundColor: '#111',
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#222',
    marginBottom: 20,
  },
  emptyText: {
    color: '#555',
    fontSize: 14,
  },
  emptySubtext: {
    color: '#444',
    fontSize: 12,
    marginTop: 4,
  },
});
