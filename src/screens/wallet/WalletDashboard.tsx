import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Platform,
  ActivityIndicator,
  Pressable,
  TextInput,
  ScrollView,
  Modal,
  Alert,
  useWindowDimensions,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { fetchMarketData, MarketData, MarketItem } from '../../lib/marketData';
import {
  sendETH, sendSOL, connectWallet, removeWalletFromProfile, saveWalletToProfile,
  verifyWalletOwnership, shortenAddress, getExplorerUrl, getAddressExplorerUrl,
  isValidEthereumAddress, isValidSolanaAddress, getMemberByUsername,
  CryptoChain, WalletInfo, MultiWallet, loadSavedWallets, getConnectedWallets,
  fetchTokenBalances, fetchNFTs, fetchTransactionHistory, getSwapQuote, getStakeAccounts, getTopValidators,
  aggregatePortfolio, formatTokenAmount, formatUSD, formatPercent, checkScamAddress, validateTransactionAmount, previewTransaction,
  CHAIN_CONFIGS,
} from '../../lib/crypto';
import type { Chain, Token, NFT, Transaction, StakeAccount, Portfolio } from '../../types';
import { LoadingScreen } from '../../components/LoadingWave';
import PageContainer from '../../components/PageContainer';
import Card from '../../components/Card';

// ─── Types & Constants ───────────────────────────────────────────────────────

type ActiveTab = 'portfolio' | 'assets' | 'nfts' | 'activity' | 'swap' | 'stake' | 'market';
type ActivePanel = null | 'send' | 'receive';

const TABS = [
  { id: 'portfolio' as const, label: 'Portfolio', icon: '◈' },
  { id: 'assets' as const, label: 'Assets', icon: '◇' },
  { id: 'nfts' as const, label: 'NFTs', icon: '▣' },
  { id: 'activity' as const, label: 'Activity', icon: '≡' },
  { id: 'swap' as const, label: 'Swap', icon: '⇄' },
  { id: 'stake' as const, label: 'Stake', icon: '⬡' },
  { id: 'market' as const, label: 'Market', icon: '▲' },
];

// ─── Sub-Components ──────────────────────────────────────────────────────────

function TabBar({ activeTab, onTabChange }: { activeTab: ActiveTab; onTabChange: (tab: ActiveTab) => void }) {
  const { width } = useWindowDimensions();
  const isDesktop = width > 768;

  return (
    <View style={[s.tabBar, isDesktop && s.tabBarDesktop]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[s.tabScrollContent, isDesktop && s.tabScrollContentDesktop]}
      >
        {TABS.map(tab => (
          <Pressable
            key={tab.id}
            onPress={() => onTabChange(tab.id)}
            style={[s.tab, activeTab === tab.id && s.tabActive]}
          >
            <Text style={[s.tabIcon, activeTab === tab.id && s.tabIconActive]}>{tab.icon}</Text>
            <Text style={[s.tabLabel, activeTab === tab.id && s.tabLabelActive]}>{tab.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function ChainSelector({ 
  chains, selectedChain, onSelect, wallets 
}: { 
  chains: Chain[]; 
  selectedChain: Chain; 
  onSelect: (chain: Chain) => void;
  wallets: MultiWallet;
}) {
  return (
    <View style={s.chainSelector}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {chains.map(chain => {
          const config = CHAIN_CONFIGS[chain];
          const wallet = wallets[chain as keyof MultiWallet];
          const isConnected = !!wallet;
          
          return (
            <Pressable
              key={chain}
              onPress={() => onSelect(chain)}
              style={[
                s.chainChip,
                selectedChain === chain && s.chainChipActive,
                !isConnected && s.chainChipDisabled,
              ]}
            >
              <Text style={s.chainChipIcon}>{config.icon}</Text>
              <Text style={[s.chainChipText, selectedChain === chain && s.chainChipTextActive]}>
                {config.name}
              </Text>
              {isConnected && <View style={[s.chainDot, { backgroundColor: config.color }]} />}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function TokenRow({ token, onPress }: { token: Token; onPress: () => void }) {
  const config = CHAIN_CONFIGS[token.chain];
  const changeColor = (token.change24h || 0) >= 0 ? '#22c55e' : '#ef4444';
  
  return (
    <Pressable onPress={onPress} style={s.tokenRow}>
      <View style={s.tokenLeft}>
        <View style={[s.tokenIcon, { backgroundColor: config.color + '20' }]}>
          <Text style={s.tokenIconText}>{token.isNative ? config.icon : token.symbol[0]}</Text>
        </View>
        <View>
          <Text style={s.tokenName}>{token.name}</Text>
          <Text style={s.tokenSymbol}>{token.symbol} · {config.name}</Text>
        </View>
      </View>
      <View style={s.tokenRight}>
        <Text style={s.tokenBalance}>{formatTokenAmount(token.balance || '0')}</Text>
        <View style={s.tokenMeta}>
          <Text style={s.tokenUsd}>{formatUSD(token.usdValue || 0)}</Text>
          {token.change24h !== undefined && (
            <Text style={[s.tokenChange, { color: changeColor }]}>
              {formatPercent(token.change24h)}
            </Text>
          )}
        </View>
      </View>
    </Pressable>
  );
}

function NFTCard({ nft, onPress }: { nft: NFT; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={s.nftCard}>
      <View style={s.nftImageContainer}>
        {nft.image ? (
          <View style={s.nftPlaceholder}>
            <Text style={s.nftPlaceholderText}>NFT</Text>
          </View>
        ) : (
          <View style={s.nftPlaceholder}>
            <Text style={s.nftPlaceholderText}>ART</Text>
          </View>
        )}
      </View>
      <Text style={s.nftName} numberOfLines={1}>{nft.name}</Text>
      <Text style={s.nftCollection} numberOfLines={1}>{nft.collection || 'Unknown'}</Text>
    </Pressable>
  );
}

function TransactionRow({ tx, onPress }: { tx: Transaction; onPress: () => void }) {
  const config = CHAIN_CONFIGS[tx.chain];
  const isOutgoing = tx.type === 'send';
  const typeIcon = {
    send: '↗', receive: '↙', swap: '⇄', stake: '⬡', unstake: '⬡', mint: '+', burn: '×', approve: '✓'
  }[tx.type] || '·';
  
  return (
    <Pressable onPress={onPress} style={s.txRow}>
      <View style={[s.txIcon, { backgroundColor: config.color + '20' }]}>
        <Text style={s.txIconText}>{typeIcon}</Text>
      </View>
      <View style={s.txContent}>
        <Text style={s.txLabel}>
          {tx.type === 'send' ? 'Sent' : tx.type === 'receive' ? 'Received' : tx.type} {formatTokenAmount(tx.amount)} {tx.token.symbol}
        </Text>
        <Text style={s.txMeta}>
          {isOutgoing ? `To ${shortenAddress(tx.to)}` : `From ${shortenAddress(tx.from)}`} · {config.name}
        </Text>
        <Text style={s.txTime}>{new Date(tx.timestamp).toLocaleDateString()}</Text>
      </View>
      <View style={s.txRight}>
        <View style={[s.txStatus, tx.status === 'confirmed' && s.txStatusConfirmed]}>
          <Text style={s.txStatusText}>
            {tx.status === 'confirmed' ? '✓' : tx.status === 'pending' ? '…' : '✗'}
          </Text>
        </View>
        <Text style={s.txArrow}>→</Text>
      </View>
    </Pressable>
  );
}

function SectionLoader({ label }: { label?: string }) {
  return (
    <View style={{ padding: 32, alignItems: 'center' }}>
      <ActivityIndicator size="small" color="#e8e8e8" />
      {label && <Text style={{ color: '#444', fontSize: 11, marginTop: 8, letterSpacing: 1, textTransform: 'uppercase' }}>{label}</Text>}
    </View>
  );
}

// ─── Main Dashboard ──────────────────────────────────────────────────────────

export default function WalletDashboard({
  walletAddress, chain, onDisconnect,
}: {
  walletAddress: string; chain: string; onDisconnect?: () => void;
}) {
  // Core state — pre-seed from props so data loads immediately without waiting for extension
  const initialWallets: MultiWallet = {
    ethereum: chain === 'ethereum' ? { address: walletAddress, chain: 'ethereum', connected: true } : null,
    solana: chain === 'solana' ? { address: walletAddress, chain: 'solana', connected: true } : null,
  };
  const [wallets, setWallets] = useState<MultiWallet>(initialWallets);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [loading, setLoading] = useState(true); // only for initial wallet detection
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>('portfolio');
  const [selectedChain, setSelectedChain] = useState<Chain>((chain as Chain) || 'ethereum');

  // Per-section loading states
  const [portfolioLoading, setPortfolioLoading] = useState(false);
  const [tokensLoading, setTokensLoading] = useState(false);
  const [nftsLoading, setNftsLoading] = useState(false);
  const [activityLoading, setActivityLoading] = useState(false);
  const [stakeLoading, setStakeLoading] = useState(false);
  const [validatorsLoading, setValidatorsLoading] = useState(false);
  const [marketLoading, setMarketLoading] = useState(false);

  // Data state
  const [tokens, setTokens] = useState<Token[]>([]);
  const [nfts, setNFTs] = useState<NFT[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [stakeAccounts, setStakeAccounts] = useState<StakeAccount[]>([]);
  const [validators, setValidators] = useState<Array<{ address: string; name: string; apy: number; commission: number }>>([]);
  const [marketData, setMarketData] = useState<MarketData | null>(null);

  // UI state
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  const [connectingChain, setConnectingChain] = useState<Chain | null>(null);
  const [selectedToken, setSelectedToken] = useState<Token | null>(null);
  const [selectedNFT, setSelectedNFT] = useState<NFT | null>(null);
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);

  // Send state
  const [sendChain, setSendChain] = useState<Chain>('ethereum');
  const [sendTo, setSendTo] = useState('');
  const [sendAmount, setSendAmount] = useState('');
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ success: boolean; message: string; txHash?: string } | null>(null);

  // Receive state
  const [receiveChain, setReceiveChain] = useState<Chain>('ethereum');

  // Swap state
  const [swapTokenIn, setSwapTokenIn] = useState<Token | null>(null);
  const [swapTokenOut, setSwapTokenOut] = useState<Token | null>(null);
  const [swapAmount, setSwapAmount] = useState('');
  const [swapQuote, setSwapQuote] = useState<any>(null);

  const connectedChains = Object.keys(wallets).filter(chain => wallets[chain as keyof MultiWallet]) as Chain[];
  const hasAnyWallet = connectedChains.length > 0;

  // ─── Load & Refresh Data ─────────────────────────────────────────────────────

  const loadWallets = useCallback(async () => {
    // Props are the source of truth (already read from Supabase by WalletTab).
    // Only use browser detection to pick up additional wallets not yet in Supabase.
    const browser = await getConnectedWallets().catch(() => ({ ethereum: null, solana: null } as MultiWallet));

    const merged: MultiWallet = {
      // Props win — never override with null from browser detection
      ethereum: initialWallets.ethereum || browser.ethereum,
      solana: initialWallets.solana || browser.solana,
    };
    setWallets(merged);

    const chains = Object.keys(merged).filter(c => merged[c as keyof MultiWallet]) as Chain[];
    if (chains.length > 0) {
      setSelectedChain(chains[0]);
      setSendChain(chains[0]);
      setReceiveChain(chains[0]);
    }

    return merged;
  }, []);

  const loadPortfolioData = useCallback(async (w?: MultiWallet) => {
    const currentWallets = w || wallets;
    const walletAddresses: Record<Chain, string> = {} as any;
    if (currentWallets.ethereum) walletAddresses.ethereum = currentWallets.ethereum.address;
    if (currentWallets.solana) walletAddresses.solana = currentWallets.solana.address;

    // Portfolio (tokens + NFTs) — independent section
    setPortfolioLoading(true);
    setTokensLoading(true);
    setNftsLoading(true);
    aggregatePortfolio(walletAddresses)
      .then(portfolioData => {
        setPortfolio(portfolioData);
        setTokens(portfolioData.tokens);
        setNFTs(portfolioData.nfts);
      })
      .catch(e => console.error('Portfolio fetch failed:', e))
      .finally(() => {
        setPortfolioLoading(false);
        setTokensLoading(false);
        setNftsLoading(false);
      });

    // Stake accounts — independent
    if (currentWallets.solana) {
      setStakeLoading(true);
      getStakeAccounts(currentWallets.solana.address)
        .then(setStakeAccounts)
        .catch(e => console.warn('Stake accounts failed (non-blocking):', e))
        .finally(() => setStakeLoading(false));
    }

    // Transaction history — independent
    const txChain = currentWallets[selectedChain] ? selectedChain :
      (Object.keys(walletAddresses) as Chain[])[0];
    if (txChain && currentWallets[txChain as keyof MultiWallet]) {
      setActivityLoading(true);
      fetchTransactionHistory(currentWallets[txChain as keyof MultiWallet]!.address, txChain)
        .then(setTransactions)
        .catch(e => console.error('Tx history failed:', e))
        .finally(() => setActivityLoading(false));
    }
  }, [wallets, selectedChain]);

  const loadMarketData = useCallback(async () => {
    setMarketLoading(true);
    fetchMarketData()
      .then(setMarketData)
      .catch(e => console.error('Market data failed:', e))
      .finally(() => setMarketLoading(false));
  }, []);

  // Auto-refresh market data every 60s when on market tab
  useEffect(() => {
    if (activeTab !== 'market') return;
    loadMarketData();
    const interval = setInterval(loadMarketData, 60000);
    return () => clearInterval(interval);
  }, [activeTab, loadMarketData]);

  const loadValidators = useCallback(async () => {
    setValidatorsLoading(true);
    getTopValidators()
      .then(setValidators)
      .catch(e => console.error('Validators failed:', e))
      .finally(() => setValidatorsLoading(false));
  }, []);

  useEffect(() => {
    (async () => {
      // Step 1: Detect wallets (fast — with timeouts already in getConnectedWallets)
      const w = await loadWallets();
      // Show the UI immediately after wallet detection
      setLoading(false);

      // Step 2: Fire off all data fetches in parallel (non-blocking)
      loadPortfolioData(w);
      loadValidators();
    })();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    const w = await loadWallets();
    loadPortfolioData(w);
    loadValidators();
    // Clear refreshing after a short delay since data loads async
    setTimeout(() => setRefreshing(false), 1500);
  };

  // ─── Chain Management ────────────────────────────────────────────────────────

  const handleChainSelect = (chain: Chain) => {
    setSelectedChain(chain);
    
    // Load chain-specific data
    if (wallets[chain as keyof MultiWallet]) {
      fetchTransactionHistory(wallets[chain as keyof MultiWallet]!.address, chain)
        .then(setTransactions)
        .catch(console.error);
    }
  };

  const handleConnect = async (chain: Chain) => {
    const type = chain === 'ethereum' ? 'metamask' : 'phantom';
    setConnectingChain(chain);

    try {
      const w = await connectWallet(type);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const verify = await verifyWalletOwnership(w.address, w.chain, user.id);
      if (!verify.success) throw new Error(verify.error || 'Verification failed');

      await saveWalletToProfile(w.address, w.chain, user.id);
      const updated = { ...wallets, [w.chain]: w };
      setWallets(updated);
      await loadPortfolioData(updated);
    } catch (e: any) {
      console.error('Connect failed:', e);
      Alert.alert('Connection Failed', e.message);
    }

    setConnectingChain(null);
  };

  const handleDisconnect = async (chain: Chain) => {
    await removeWalletFromProfile(chain as CryptoChain);
    const updated = { ...wallets, [chain]: null };
    setWallets(updated);

    if (!updated.ethereum && !updated.solana) {
      if (onDisconnect) onDisconnect();
    } else {
      await loadPortfolioData(updated);
    }
  };

  // ─── Send Functionality ──────────────────────────────────────────────────────

  const handleSend = async () => {
    if (!sendTo.trim() || !sendAmount.trim()) return;
    const amount = parseFloat(sendAmount);
    if (isNaN(amount) || amount <= 0) {
      setSendResult({ success: false, message: 'Enter a valid amount' });
      return;
    }

    const senderWallet = wallets[sendChain as keyof MultiWallet];
    if (!senderWallet) {
      setSendResult({ success: false, message: `Connect your ${sendChain} wallet first` });
      return;
    }

    // Security checks
    const scamCheck = checkScamAddress(sendTo);
    if (scamCheck.isScam) {
      setSendResult({ success: false, message: `Security Warning: ${scamCheck.reason}` });
      return;
    }

    const tokenBalance = tokens.find(t => t.chain === sendChain && t.isNative)?.raw || 0;
    const validation = validateTransactionAmount(amount, tokenBalance, sendChain as CryptoChain);
    if (!validation.valid) {
      setSendResult({ success: false, message: validation.warning || 'Invalid amount' });
      return;
    }

    setSending(true);
    setSendResult(null);

    let toAddress = sendTo.trim();
    if (!toAddress.startsWith('0x') && !toAddress.match(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)) {
      const member = await getMemberByUsername(toAddress.replace('@', ''));
      if (member?.wallet_address) {
        toAddress = member.wallet_address;
      } else {
        setSendResult({ success: false, message: `Can't find wallet for @${toAddress}` });
        setSending(false);
        return;
      }
    }

    const symbol = sendChain === 'solana' ? 'SOL' : 'ETH';
    const result = sendChain === 'ethereum'
      ? await sendETH(toAddress, amount, true)
      : await sendSOL(toAddress, amount, true);

    if (result.success) {
      setSendResult({ 
        success: true, 
        message: `Sent ${amount} ${symbol} to ${shortenAddress(toAddress)}`, 
        txHash: result.txHash 
      });
      setSendTo('');
      setSendAmount('');
      setTimeout(() => loadPortfolioData(), 3000);
    } else {
      setSendResult({ success: false, message: result.error || 'Transaction failed' });
    }
    setSending(false);
  };

  // ─── Render Methods ──────────────────────────────────────────────────────────

  const renderPortfolioTab = () => (
    <View>
      {/* Total Portfolio Value */}
      <Card style={s.portfolioCard}>
        <Text style={s.portfolioLabel}>TOTAL PORTFOLIO</Text>
        {portfolioLoading && !portfolio ? (
          <SectionLoader label="Loading portfolio" />
        ) : null}
        <Text style={s.portfolioValue}>{formatUSD(portfolio?.totalValue || 0)}</Text>
        <View style={s.portfolioChange}>
          <Text style={[
            s.portfolioChangeText,
            { color: (portfolio?.change24h || 0) >= 0 ? '#22c55e' : '#ef4444' }
          ]}>
            {formatPercent(portfolio?.change24h || 0)} (24h)
          </Text>
        </View>

        {/* Mini chart placeholder */}
        <View style={s.chartPlaceholder}>
          <Text style={s.chartPlaceholderText}>Chart coming soon</Text>
        </View>
        
        {/* Connected wallets */}
        <View style={s.walletBadges}>
          {connectedChains.map(chain => {
            const config = CHAIN_CONFIGS[chain];
            const wallet = wallets[chain as keyof MultiWallet]!;
            return (
              <View key={chain} style={s.badgePill}>
                <Text style={s.badgePillIcon}>{config.icon}</Text>
                <Text style={s.badgePillText}>{shortenAddress(wallet.address)}</Text>
              </View>
            );
          })}
        </View>
      </Card>

      {/* Quick Actions */}
      <View style={s.actionsRow}>
        <Pressable 
          style={s.actionBtn}
          onPress={() => setActivePanel(activePanel === 'send' ? null : 'send')}
        >
          <View style={[s.actionBtnIcon, { backgroundColor: '#6366f120' }]}>
            <Text style={[s.actionBtnEmoji, { color: '#6366f1' }]}>↗</Text>
          </View>
          <Text style={s.actionBtnLabel}>SEND</Text>
        </Pressable>

        <Pressable
          style={s.actionBtn}
          onPress={() => setActivePanel(activePanel === 'receive' ? null : 'receive')}
        >
          <View style={[s.actionBtnIcon, { backgroundColor: '#22c55e20' }]}>
            <Text style={[s.actionBtnEmoji, { color: '#22c55e' }]}>↙</Text>
          </View>
          <Text style={s.actionBtnLabel}>RECEIVE</Text>
        </Pressable>

        <Pressable
          style={s.actionBtn}
          onPress={() => setActiveTab('swap')}
        >
          <View style={[s.actionBtnIcon, { backgroundColor: '#22d3ee20' }]}>
            <Text style={[s.actionBtnEmoji, { color: '#22d3ee' }]}>⇄</Text>
          </View>
          <Text style={s.actionBtnLabel}>SWAP</Text>
        </Pressable>

        <Pressable
          style={s.actionBtn}
          onPress={() => setActiveTab('stake')}
        >
          <View style={[s.actionBtnIcon, { backgroundColor: '#a855f720' }]}>
            <Text style={[s.actionBtnEmoji, { color: '#a855f7' }]}>⬡</Text>
          </View>
          <Text style={s.actionBtnLabel}>STAKE</Text>
        </Pressable>
      </View>
    </View>
  );

  const renderAssetsTab = () => (
    <View>
      <ChainSelector 
        chains={['solana', 'ethereum', 'polygon', 'base']}
        selectedChain={selectedChain}
        onSelect={handleChainSelect}
        wallets={wallets}
      />
      
      <View style={s.assetsHeader}>
        <Text style={s.sectionTitle}>TOKENS</Text>
        <Pressable style={s.addTokenBtn}>
          <Text style={s.addTokenText}>+ ADD TOKEN</Text>
        </Pressable>
      </View>

      {tokensLoading ? (
        <SectionLoader label="Loading tokens" />
      ) : tokens.filter(t => t.chain === selectedChain).length === 0 ? (
        <Card style={s.emptyCard}>
          <Text style={s.emptyText}>No tokens found</Text>
          <Text style={s.emptySubtext}>Connect a wallet to see your tokens</Text>
        </Card>
      ) : (
        tokens
          .filter(t => t.chain === selectedChain)
          .map((token, i) => (
            <TokenRow 
              key={`${token.chain}-${token.address}-${i}`} 
              token={token} 
              onPress={() => setSelectedToken(token)} 
            />
          ))
      )}
    </View>
  );

  const renderNFTsTab = () => (
    <View>
      <ChainSelector 
        chains={['solana', 'ethereum', 'polygon', 'base']}
        selectedChain={selectedChain}
        onSelect={handleChainSelect}
        wallets={wallets}
      />
      
      <Text style={s.sectionTitle}>NFT COLLECTION</Text>
      
      {nftsLoading ? (
        <SectionLoader label="Loading NFTs" />
      ) : nfts.filter(n => n.chain === selectedChain).length === 0 ? (
        <Card style={s.emptyCard}>
          
          <Text style={s.emptyText}>No NFTs found</Text>
          <Text style={s.emptySubtext}>Your NFTs will appear here</Text>
        </Card>
      ) : (
        <View style={s.nftGrid}>
          {nfts
            .filter(n => n.chain === selectedChain)
            .map((nft, i) => (
              <NFTCard 
                key={`${nft.chain}-${nft.mint}-${i}`} 
                nft={nft} 
                onPress={() => setSelectedNFT(nft)} 
              />
            ))}
        </View>
      )}
    </View>
  );

  const renderActivityTab = () => (
    <View>
      <ChainSelector 
        chains={['solana', 'ethereum', 'polygon', 'base']}
        selectedChain={selectedChain}
        onSelect={handleChainSelect}
        wallets={wallets}
      />
      
      <Text style={s.sectionTitle}>TRANSACTION HISTORY</Text>
      
      {activityLoading ? (
        <SectionLoader label="Loading transactions" />
      ) : transactions.filter(tx => tx.chain === selectedChain).length === 0 ? (
        <Card style={s.emptyCard}>
          
          <Text style={s.emptyText}>No transactions yet</Text>
          <Text style={s.emptySubtext}>Your activity will appear here</Text>
        </Card>
      ) : (
        transactions
          .filter(tx => tx.chain === selectedChain)
          .map((tx, i) => (
            <TransactionRow 
              key={`${tx.chain}-${tx.hash}-${i}`} 
              tx={tx} 
              onPress={() => setSelectedTx(tx)} 
            />
          ))
      )}
    </View>
  );

  const renderSwapTab = () => (
    <View>
      <Card style={s.swapCard}>
        <Text style={s.swapTitle}>TOKEN SWAP</Text>
        
        {/* Swap interface placeholder */}
        <View style={s.swapInterface}>
          <View style={s.swapInputContainer}>
            <Text style={s.swapLabel}>FROM</Text>
            <Pressable style={s.swapTokenSelector}>
              <Text style={s.swapTokenText}>Select Token</Text>
              <Text style={s.swapTokenArrow}>↓</Text>
            </Pressable>
            <TextInput
              style={s.swapAmountInput}
              placeholder="0.00"
              placeholderTextColor="#444"
              value={swapAmount}
              onChangeText={setSwapAmount}
              keyboardType="numeric"
            />
          </View>
          
          <View style={s.swapArrowContainer}>
            <Pressable style={s.swapArrowBtn}>
              <Text style={s.swapArrowText}>⇅</Text>
            </Pressable>
          </View>
          
          <View style={s.swapInputContainer}>
            <Text style={s.swapLabel}>TO</Text>
            <Pressable style={s.swapTokenSelector}>
              <Text style={s.swapTokenText}>Select Token</Text>
              <Text style={s.swapTokenArrow}>↓</Text>
            </Pressable>
            <TextInput
              style={s.swapAmountInput}
              placeholder="0.00"
              placeholderTextColor="#444"
              editable={false}
            />
          </View>
        </View>

        {selectedChain === 'solana' ? (
          <View style={s.swapInfo}>
            <Text style={s.swapInfoText}>Powered by Jupiter</Text>
            <Text style={s.swapInfoSubtext}>Best rates across Solana DEXs</Text>
          </View>
        ) : (
          <View style={s.comingSoonBox}>
            <Text style={s.comingSoonText}>Coming Soon</Text>
            <Text style={s.comingSoonSubtext}>EVM swaps in development</Text>
          </View>
        )}
        
        <Pressable 
          style={[s.swapBtn, selectedChain !== 'solana' && s.swapBtnDisabled]} 
          disabled={selectedChain !== 'solana'}
        >
          <Text style={s.swapBtnText}>
            {selectedChain === 'solana' ? 'PREVIEW SWAP' : 'COMING SOON'}
          </Text>
        </Pressable>
      </Card>
    </View>
  );

  const renderStakeTab = () => (
    <View>
      <Card style={s.stakeCard}>
        <Text style={s.stakeTitle}>SOL STAKING</Text>
        
        {connectedChains.includes('solana') ? (
          <View>
            {/* Current stakes */}
            <View style={s.stakeSection}>
              <Text style={s.stakeSectionTitle}>YOUR STAKES</Text>
              {stakeLoading ? (
                <SectionLoader label="Loading stakes" />
              ) : stakeAccounts.length === 0 ? (
                <Text style={s.stakeEmptyText}>No active stakes</Text>
              ) : (
                stakeAccounts.map((stake, i) => (
                  <View key={i} style={s.stakeRow}>
                    <View>
                      <Text style={s.stakeAmount}>{stake.amount} SOL</Text>
                      <Text style={s.stakeValidator}>{stake.validatorName || shortenAddress(stake.validator)}</Text>
                    </View>
                    <View>
                      <Text style={s.stakeRewards}>+{stake.rewards} SOL</Text>
                      <Text style={s.stakeStatus}>{stake.status.toUpperCase()}</Text>
                    </View>
                  </View>
                ))
              )}
            </View>

            {/* Validators */}
            <View style={s.stakeSection}>
              <Text style={s.stakeSectionTitle}>TOP VALIDATORS</Text>
              {validatorsLoading ? (
                <SectionLoader label="Loading validators" />
              ) : validators.map((validator, i) => (
                <View key={i} style={s.validatorRow}>
                  <View>
                    <Text style={s.validatorName}>{validator.name}</Text>
                    <Text style={s.validatorAddress}>{shortenAddress(validator.address)}</Text>
                  </View>
                  <View>
                    <Text style={s.validatorAPY}>{validator.apy.toFixed(1)}% APY</Text>
                    <Text style={s.validatorCommission}>{validator.commission}% fee</Text>
                  </View>
                  <Pressable style={s.stakeSmallBtn}>
                    <Text style={s.stakeSmallBtnText}>STAKE</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          </View>
        ) : (
          <View style={s.comingSoonBox}>
            <Text style={s.comingSoonText}>Connect Phantom</Text>
            <Text style={s.comingSoonSubtext}>Connect your Solana wallet to stake SOL</Text>
            <Pressable 
              style={s.connectBtn} 
              onPress={() => handleConnect('solana')}
            >
              <Text style={s.connectBtnText}>CONNECT PHANTOM</Text>
            </Pressable>
          </View>
        )}
      </Card>
    </View>
  );

  const renderMarketRow = (item: MarketItem, index: number) => {
    const changeColor = item.change24h >= 0 ? '#22c55e' : '#ef4444';
    const changePrefix = item.change24h >= 0 ? '+' : '';
    

    return (
      <View key={`${item.type}-${item.symbol}-${index}`} style={s.marketRow}>
        <View style={s.marketRowLeft}>
          <View style={[s.marketIcon, { backgroundColor: item.change24h >= 0 ? '#22c55e15' : '#ef444415' }]}>
            <Text style={s.marketIconText}>{item.symbol[0]}</Text>
          </View>
          <View>
            <Text style={s.marketSymbol}>{item.symbol}</Text>
            <Text style={s.marketName} numberOfLines={1}>{item.name}</Text>
          </View>
        </View>
        <View style={s.marketRowRight}>
          <Text style={s.marketPrice}>${item.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
          <View style={[s.marketChangeBadge, { backgroundColor: changeColor + '18' }]}>
            <Text style={[s.marketChangeText, { color: changeColor }]}>
              {changePrefix}{item.change24h.toFixed(2)}%
            </Text>
          </View>
        </View>
      </View>
    );
  };

  const renderMarketSection = (title: string, items: MarketItem[]) => (
    <View style={s.marketSection}>
      <Text style={s.marketSectionTitle}>{title}</Text>
      {items.length === 0 ? (
        <Card style={s.emptyCard}>
          <Text style={s.emptyText}>No data available</Text>
        </Card>
      ) : (
        items.map((item, i) => renderMarketRow(item, i))
      )}
    </View>
  );

  const renderMarketTab = () => (
    <View>
      {marketLoading && !marketData ? (
        <SectionLoader label="Loading market data" />
      ) : marketData ? (
        <View style={isDesktop ? s.marketGrid : undefined}>
          <View style={isDesktop ? s.marketGridCol : undefined}>
            {renderMarketSection('TOP CRYPTO', marketData.crypto)}
            {renderMarketSection('TOP GAINERS', marketData.gainers)}
          </View>
          <View style={isDesktop ? s.marketGridCol : undefined}>
            {renderMarketSection('TOP STOCKS', marketData.stocks)}
            {renderMarketSection('TOP LOSERS', marketData.losers)}
          </View>
        </View>
      ) : (
        <Card style={s.emptyCard}>
          <Text style={s.emptyText}>Market data unavailable</Text>
          <Text style={s.emptySubtext}>Pull to refresh or try again later</Text>
        </Card>
      )}
    </View>
  );

  const renderSendPanel = () => (
    <Card style={s.panelCard}>
      <Text style={s.panelTitle}>SEND</Text>

      <Text style={s.inputLabel}>SEND FROM</Text>
      <ChainSelector 
        chains={connectedChains}
        selectedChain={sendChain}
        onSelect={setSendChain}
        wallets={wallets}
      />

      <Text style={s.inputLabel}>TO (username or address)</Text>
      <TextInput 
        style={s.panelInput} 
        placeholder="@username or address" 
        placeholderTextColor="#444"
        value={sendTo} 
        onChangeText={setSendTo} 
        autoCapitalize="none" 
      />

      <Text style={s.inputLabel}>AMOUNT</Text>
      <TextInput 
        style={s.panelInput} 
        placeholder="0.00" 
        placeholderTextColor="#444"
        value={sendAmount} 
        onChangeText={setSendAmount} 
        keyboardType="numeric" 
      />

      <View style={s.quickRow}>
        {['0.001', '0.01', '0.1', '0.5', '1'].map(amt => (
          <Pressable 
            key={amt} 
            onPress={() => setSendAmount(amt)}
            style={[s.quickChip, sendAmount === amt && s.quickChipActive]}
          >
            <Text style={[s.quickChipText, sendAmount === amt && s.quickChipTextActive]}>
              {amt}
            </Text>
          </Pressable>
        ))}
      </View>

      {sendResult && (
        <View style={[s.resultBox, sendResult.success ? s.resultSuccess : s.resultError]}>
          <Text style={s.resultText}>{sendResult.success ? '' : ''} {sendResult.message}</Text>
          {sendResult.txHash && (
            <Pressable onPress={() => {
              if (Platform.OS === 'web') {
                window.open(getExplorerUrl(sendResult.txHash!, sendChain as CryptoChain), '_blank');
              }
            }}>
              <Text style={s.resultLink}>View Explorer →</Text>
            </Pressable>
          )}
        </View>
      )}

      <Pressable 
        onPress={handleSend}
        disabled={!sendTo.trim() || !sendAmount.trim() || sending}
        style={[s.primaryBtn, (!sendTo.trim() || !sendAmount.trim() || sending) && s.primaryBtnDisabled]}
      >
        <Text style={s.primaryBtnText}>
          {sending ? 'CONFIRMING...' : 'SEND'}
        </Text>
      </Pressable>
    </Card>
  );

  const renderReceivePanel = () => {
    const activeWallet = wallets[receiveChain as keyof MultiWallet];
    
    return (
      <Card style={s.panelCard}>
        <Text style={s.panelTitle}>RECEIVE</Text>

        <ChainSelector 
          chains={connectedChains}
          selectedChain={receiveChain}
          onSelect={setReceiveChain}
          wallets={wallets}
        />

        {activeWallet && (
          <View>
            <View style={s.qrPlaceholder}>
              <Text style={s.qrPlaceholderText}>QR</Text>
              <Text style={s.qrPlaceholderSubtext}>QR Code</Text>
              <Text style={s.qrPlaceholderSubtext}>Coming Soon</Text>
            </View>

            <View style={s.fullAddressBox}>
              <Text style={s.fullAddressLabel}>{CHAIN_CONFIGS[receiveChain].name.toUpperCase()} ADDRESS</Text>
              <Text style={s.fullAddressText} selectable>{activeWallet.address}</Text>
            </View>

            <Pressable 
              onPress={() => {
                if (Platform.OS === 'web') {
                  navigator.clipboard?.writeText(activeWallet.address);
                }
              }} 
              style={s.copyBtn}
            >
              <Text style={s.copyBtnText}>COPY ADDRESS</Text>
            </Pressable>

            <View style={s.receiveWarning}>
              <Text style={s.receiveWarningText}>
                Only send <Text style={{ fontWeight: '800' }}>{CHAIN_CONFIGS[receiveChain].name}</Text> tokens to this address.
              </Text>
            </View>
          </View>
        )}
      </Card>
    );
  };

  // ─── Main Render ─────────────────────────────────────────────────────────────

  const { width: screenWidth } = useWindowDimensions();
  const isDesktop = screenWidth > 768;

  if (loading) {
    return <LoadingScreen />;
  }

  return (
    <View style={s.container}>
      {/* Header */}
      <View style={[s.header, isDesktop && s.headerDesktop]}>
        <View style={s.headerLeft}>
          <Text style={s.headerTitle}>WALLET</Text>
          <View style={s.headerChains}>
            {connectedChains.map(c => (
              <View key={c} style={[s.headerChainDot, { backgroundColor: CHAIN_CONFIGS[c].color }]} />
            ))}
          </View>
        </View>
        <View style={s.headerMeta}>
          <Text style={s.headerValue}>{formatUSD(portfolio?.totalValue || 0)}</Text>
          <Text style={[
            s.headerChange,
            { color: (portfolio?.change24h || 0) >= 0 ? '#22c55e' : '#ef4444' }
          ]}>
            {formatPercent(portfolio?.change24h || 0)}
          </Text>
        </View>
      </View>

      {/* Tab Navigation */}
      <TabBar activeTab={activeTab} onTabChange={setActiveTab} />

      {/* Content */}
      <PageContainer refreshing={refreshing} onRefresh={onRefresh} wide>
        {activeTab === 'portfolio' && renderPortfolioTab()}
        {activeTab === 'assets' && renderAssetsTab()}
        {activeTab === 'nfts' && renderNFTsTab()}
        {activeTab === 'activity' && renderActivityTab()}
        {activeTab === 'swap' && renderSwapTab()}
        {activeTab === 'stake' && renderStakeTab()}
        {activeTab === 'market' && renderMarketTab()}

        {/* Send/Receive Panels */}
        {activePanel === 'send' && renderSendPanel()}
        {activePanel === 'receive' && renderReceivePanel()}

        {/* Disconnect */}
        {hasAnyWallet && (
          <View style={s.signOutSection}>
            <Pressable onPress={async () => {
              // Disconnect browser extensions first so ConnectWalletScreen doesn't re-detect them
              try {
                if (Platform.OS === 'web') {
                  if ((window as any).solana?.isPhantom) {
                    await (window as any).solana.disconnect().catch(() => {});
                  }
                  if ((window as any).ethereum) {
                    // MetaMask doesn't have a programmatic disconnect — clear cached accounts
                    // by requesting permissions reset (best-effort)
                    (window as any).ethereum.request({
                      method: 'wallet_revokePermissions',
                      params: [{ eth_accounts: {} }],
                    }).catch(() => {});
                  }
                }
              } catch {}
              if (onDisconnect) onDisconnect();
            }} style={s.signOutBtn}>
              <Text style={s.signOutText}>DISCONNECT ALL WALLETS</Text>
            </Pressable>
            <Text style={s.signOutHint}>Your funds stay safe. Reconnect anytime.</Text>
          </View>
        )}
      </PageContainer>

      {/* Modals for token/NFT/tx details */}
      {/* These would be implemented as full modals in production */}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  
  // Header
  header: {
    paddingTop: 60, paddingBottom: 16, paddingHorizontal: 24,
    borderBottomWidth: 1, borderBottomColor: '#222',
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    maxWidth: 640, alignSelf: 'center' as const, width: '100%',
  },
  headerDesktop: { maxWidth: 960 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerChains: { flexDirection: 'row', gap: 4 },
  headerChainDot: { width: 8, height: 8, borderRadius: 4 },
  headerTitle: { color: '#fff', fontSize: 22, fontWeight: '900', letterSpacing: 3 },
  headerMeta: { alignItems: 'flex-end' },
  headerValue: { color: '#fff', fontSize: 18, fontWeight: '700' },
  headerChange: { fontSize: 12, marginTop: 2 },

  // Loading
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#555', marginTop: 12, fontSize: 14 },

  // Tab bar
  tabBar: {
    borderBottomWidth: 1,
    borderBottomColor: '#222',
    backgroundColor: '#111',
    alignItems: 'center' as const,
  },
  tabBarDesktop: { paddingHorizontal: 16 },
  tabScrollContent: {
    paddingHorizontal: 16, gap: 4,
  },
  tabScrollContentDesktop: {},
  tab: {
    paddingHorizontal: 16, paddingVertical: 12, alignItems: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.15s ease' } as any : {}),
  },
  tabActive: { borderBottomWidth: 2, borderBottomColor: '#6366f1' },
  tabIcon: { fontSize: 16, marginBottom: 4, color: '#555' },
  tabIconActive: { color: '#6366f1' },
  tabLabel: { color: '#666', fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  tabLabelActive: { color: '#6366f1' },

  // Chain selector
  chainSelector: { marginBottom: 16 },
  chainChip: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 8, marginRight: 8,
    backgroundColor: '#111', borderRadius: 20, borderWidth: 1, borderColor: '#222',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  chainChipActive: { borderColor: '#6366f1', backgroundColor: '#6366f110' },
  chainChipDisabled: { opacity: 0.4 },
  chainChipIcon: { fontSize: 16 },
  chainChipText: { color: '#888', fontSize: 12, fontWeight: '600' },
  chainChipTextActive: { color: '#6366f1' },
  chainDot: { width: 6, height: 6, borderRadius: 3 },

  // Portfolio
  portfolioCard: {
    alignItems: 'center', padding: 32, marginBottom: 24,
    ...(Platform.OS === 'web' ? { backgroundImage: 'linear-gradient(180deg, #161616 0%, #111 100%)' } as any : {}),
  },
  portfolioLabel: { color: '#666', fontSize: 11, letterSpacing: 2, fontWeight: '700', marginBottom: 8 },
  portfolioValue: { color: '#fff', fontSize: 48, fontWeight: '900', letterSpacing: 1, marginBottom: 8 },
  portfolioChange: { marginBottom: 20 },
  portfolioChangeText: { fontSize: 14, fontWeight: '600' },
  chartPlaceholder: {
    width: '100%', height: 60, backgroundColor: '#000000', borderRadius: 8,
    justifyContent: 'center', alignItems: 'center', marginBottom: 20,
    borderWidth: 1, borderColor: '#000000',
  },
  chartPlaceholderText: { color: '#444', fontSize: 12 },
  walletBadges: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'center' },
  badgePill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#000000', borderRadius: 16, paddingVertical: 6, paddingHorizontal: 12,
    borderWidth: 1, borderColor: '#222',
  },
  badgePillIcon: { fontSize: 12 },
  badgePillText: { color: '#888', fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },

  // Actions
  actionsRow: { flexDirection: 'row', gap: 8, marginBottom: 24 },
  actionBtn: {
    flex: 1, alignItems: 'center', gap: 8, padding: 16,
    backgroundColor: '#111', borderRadius: 12, borderWidth: 1, borderColor: '#000000',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  actionBtnIcon: { width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  actionBtnEmoji: { fontSize: 16 },
  actionBtnLabel: { color: '#888', fontSize: 10, fontWeight: '700', letterSpacing: 1 },

  // Assets
  assetsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  addTokenBtn: { 
    paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#2a2a2a', borderRadius: 8,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  addTokenText: { color: '#6366f1', fontSize: 10, fontWeight: '700', letterSpacing: 1 },

  tokenRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#111', borderRadius: 12, padding: 16, marginBottom: 8,
    borderWidth: 1, borderColor: '#000000',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  tokenLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  tokenIcon: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  tokenIconText: { fontSize: 16, color: '#fff', fontWeight: '700' },
  tokenName: { color: '#fff', fontSize: 15, fontWeight: '700' },
  tokenSymbol: { color: '#666', fontSize: 11, marginTop: 2 },
  tokenRight: { alignItems: 'flex-end' },
  tokenBalance: { color: '#fff', fontSize: 15, fontWeight: '700' },
  tokenMeta: { alignItems: 'flex-end', gap: 2 },
  tokenUsd: { color: '#888', fontSize: 12 },
  tokenChange: { fontSize: 11, fontWeight: '600' },

  // NFTs
  nftGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  nftCard: {
    width: '48%', backgroundColor: '#111', borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: '#000000',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  nftImageContainer: { aspectRatio: 1, marginBottom: 8, borderRadius: 8, overflow: 'hidden' },
  nftPlaceholder: {
    flex: 1, backgroundColor: '#000000', justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: '#222',
  },
  nftPlaceholderText: { fontSize: 24 },
  nftName: { color: '#fff', fontSize: 12, fontWeight: '700', marginBottom: 2 },
  nftCollection: { color: '#666', fontSize: 10 },

  // Transactions
  txRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#111', borderRadius: 12, padding: 14, marginBottom: 8,
    borderWidth: 1, borderColor: '#000000',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  txIcon: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  txIconText: { fontSize: 14 },
  txContent: { flex: 1 },
  txLabel: { color: '#fff', fontSize: 14, fontWeight: '600' },
  txMeta: { color: '#666', fontSize: 11, marginTop: 2 },
  txTime: { color: '#444', fontSize: 10, marginTop: 2 },
  txRight: { alignItems: 'center', gap: 4 },
  txStatus: { width: 20, height: 20, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  txStatusConfirmed: { backgroundColor: '#22c55e20' },
  txStatusText: { fontSize: 10 },
  txArrow: { color: '#444', fontSize: 16 },

  // Swap
  swapCard: { padding: 20, marginBottom: 24 },
  swapTitle: { color: '#fff', fontSize: 16, fontWeight: '800', letterSpacing: 2, marginBottom: 20 },
  swapInterface: { gap: 16, marginBottom: 16 },
  swapInputContainer: { gap: 8 },
  swapLabel: { color: '#666', fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  swapTokenSelector: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#000000', borderRadius: 10, padding: 14, borderWidth: 1, borderColor: '#222',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  swapTokenText: { color: '#888', fontSize: 14 },
  swapTokenArrow: { color: '#666', fontSize: 16 },
  swapAmountInput: {
    backgroundColor: '#000000', borderRadius: 10, padding: 14, color: '#fff',
    fontSize: 16, borderWidth: 1, borderColor: '#222',
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  swapArrowContainer: { alignItems: 'center' },
  swapArrowBtn: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: '#000000',
    justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#333',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  swapArrowText: { color: '#888', fontSize: 14 },
  swapInfo: { alignItems: 'center', padding: 12, backgroundColor: '#22d3ee10', borderRadius: 8, marginBottom: 16 },
  swapInfoText: { color: '#22d3ee', fontSize: 12, fontWeight: '600' },
  swapInfoSubtext: { color: '#6f6f6f', fontSize: 10, marginTop: 2 },
  swapBtn: {
    backgroundColor: '#22d3ee', borderRadius: 12, paddingVertical: 16, alignItems: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  swapBtnDisabled: { backgroundColor: '#000000', opacity: 0.5 },
  swapBtnText: { color: '#0a0a0a', fontSize: 14, fontWeight: '800', letterSpacing: 2 },

  // Stake
  stakeCard: { padding: 20, marginBottom: 24 },
  stakeTitle: { color: '#fff', fontSize: 16, fontWeight: '800', letterSpacing: 2, marginBottom: 20 },
  stakeSection: { marginBottom: 20 },
  stakeSectionTitle: { color: '#666', fontSize: 11, letterSpacing: 2, fontWeight: '700', marginBottom: 12 },
  stakeEmptyText: { color: '#444', fontSize: 14, textAlign: 'center', padding: 20 },
  stakeRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#000000', borderRadius: 10, padding: 12, marginBottom: 8,
    borderWidth: 1, borderColor: '#222',
  },
  stakeAmount: { color: '#fff', fontSize: 15, fontWeight: '700' },
  stakeValidator: { color: '#666', fontSize: 11, marginTop: 2 },
  stakeRewards: { color: '#22c55e', fontSize: 13, fontWeight: '600', textAlign: 'right' },
  stakeStatus: { color: '#666', fontSize: 10, textAlign: 'right', marginTop: 2 },
  validatorRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#000000', borderRadius: 10, padding: 12, marginBottom: 8,
    borderWidth: 1, borderColor: '#222',
  },
  validatorName: { color: '#fff', fontSize: 14, fontWeight: '600' },
  validatorAddress: { color: '#666', fontSize: 10, marginTop: 2, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  validatorAPY: { color: '#22c55e', fontSize: 12, fontWeight: '700', textAlign: 'right' },
  validatorCommission: { color: '#888', fontSize: 10, textAlign: 'right', marginTop: 2 },
  stakeSmallBtn: {
    backgroundColor: '#252525', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  stakeSmallBtnText: { color: '#22c55e', fontSize: 10, fontWeight: '700', letterSpacing: 1 },

  // Coming Soon
  comingSoonBox: {
    alignItems: 'center', padding: 32, backgroundColor: '#000000', borderRadius: 12,
    borderWidth: 1, borderColor: '#222', marginBottom: 16,
  },
  comingSoonText: { color: '#888', fontSize: 16, marginBottom: 4 },
  comingSoonSubtext: { color: '#444', fontSize: 12, textAlign: 'center', marginBottom: 16 },
  connectBtn: {
    backgroundColor: '#9945FF', borderRadius: 10, paddingHorizontal: 20, paddingVertical: 12,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  connectBtnText: { color: '#fff', fontSize: 12, fontWeight: '800', letterSpacing: 1 },

  // Panels
  panelCard: { padding: 20, marginBottom: 24 },
  panelTitle: { color: '#fff', fontSize: 14, fontWeight: '800', letterSpacing: 2, marginBottom: 16 },
  inputLabel: { color: '#555', fontSize: 10, fontWeight: '700', letterSpacing: 1.5, marginBottom: 6, marginTop: 8 },
  panelInput: {
    backgroundColor: '#000000', borderWidth: 1, borderColor: '#222', borderRadius: 10,
    padding: 14, color: '#fff', fontSize: 15, marginBottom: 8,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  quickRow: { flexDirection: 'row', gap: 6, marginBottom: 12, flexWrap: 'wrap' },
  quickChip: {
    paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8,
    backgroundColor: '#000000', borderWidth: 1, borderColor: '#222',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  quickChipActive: { borderColor: '#6366f1', backgroundColor: '#6366f110' },
  quickChipText: { color: '#666', fontSize: 12, fontWeight: '700' },
  quickChipTextActive: { color: '#6366f1' },
  resultBox: { borderRadius: 10, padding: 12, marginBottom: 12 },
  resultSuccess: { backgroundColor: '#22c55e10', borderWidth: 1, borderColor: '#22c55e30' },
  resultError: { backgroundColor: '#ef444410', borderWidth: 1, borderColor: '#ef444430' },
  resultText: { color: '#ccc', fontSize: 13 },
  resultLink: { color: '#3b82f6', fontSize: 12, marginTop: 6, fontWeight: '600' },
  primaryBtn: {
    backgroundColor: '#6366f1', borderRadius: 12, paddingVertical: 14, alignItems: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  primaryBtnDisabled: { backgroundColor: '#252525', opacity: 0.5 },
  primaryBtnText: { color: '#0a0a0a', fontSize: 14, fontWeight: '800', letterSpacing: 2 },

  // Receive
  qrPlaceholder: {
    aspectRatio: 1, backgroundColor: '#000000', borderRadius: 12, marginBottom: 16,
    justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#222',
  },
  qrPlaceholderText: { fontSize: 48, marginBottom: 8 },
  qrPlaceholderSubtext: { color: '#444', fontSize: 12 },
  fullAddressBox: {
    backgroundColor: '#000000', borderRadius: 12, padding: 16, marginBottom: 12,
    borderWidth: 1, borderColor: '#222',
  },
  fullAddressLabel: { color: '#555', fontSize: 10, letterSpacing: 2, fontWeight: '700', marginBottom: 8 },
  fullAddressText: {
    color: '#fff', fontSize: 13, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    lineHeight: 20,
  },
  copyBtn: {
    backgroundColor: '#252525', borderRadius: 12, paddingVertical: 14, alignItems: 'center',
    borderWidth: 1, borderColor: '#3e3e3e', marginBottom: 12,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  copyBtnText: { color: '#6366f1', fontSize: 13, fontWeight: '700', letterSpacing: 1 },
  receiveWarning: {
    backgroundColor: '#f59e0b10', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#f59e0b30',
  },
  receiveWarningText: { color: '#f59e0b', fontSize: 12, lineHeight: 18 },

  // Common
  sectionTitle: { color: '#666', fontSize: 12, letterSpacing: 2, fontWeight: '700', marginBottom: 16 },
  emptyCard: { alignItems: 'center', padding: 32, marginBottom: 8 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { color: '#555', fontSize: 14, marginBottom: 4 },
  emptySubtext: { color: '#444', fontSize: 12 },
  signOutSection: { marginTop: 32, marginBottom: 40, alignItems: 'center' },
  signOutBtn: {
    paddingVertical: 14, paddingHorizontal: 32, borderRadius: 12,
    backgroundColor: '#161616', borderWidth: 1, borderColor: '#2a2a2a',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  signOutText: { color: '#6f6f6f', fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  signOutHint: { color: '#444', fontSize: 11, textAlign: 'center', marginTop: 10 },

  // Market
  marketSection: { marginBottom: 24 },
  marketSectionTitle: { color: '#888', fontSize: 13, fontWeight: '800', letterSpacing: 1.5, marginBottom: 12 },
  marketRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#111', borderRadius: 12, padding: 14, marginBottom: 8,
    borderWidth: 1, borderColor: '#000000',
  },
  marketRowLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  marketIcon: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  marketIconText: { fontSize: 16 },
  marketSymbol: { color: '#fff', fontSize: 14, fontWeight: '700' },
  marketName: { color: '#555', fontSize: 11, marginTop: 1, maxWidth: 120 },
  marketRowRight: { alignItems: 'flex-end', gap: 4 },
  marketPrice: { color: '#fff', fontSize: 14, fontWeight: '700' },
  marketChangeBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  marketChangeText: { fontSize: 11, fontWeight: '700' },

  // Market grid (desktop 2-column)
  marketGrid: { flexDirection: 'row', gap: 16 },
  marketGridCol: { flex: 1 },
});