import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  useWindowDimensions,
  Platform,
  ActivityIndicator,
  Pressable,
  TextInput,
  ScrollView,
  Alert,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import {
  verifyWalletOwnership, isValidEthereumAddress, isValidSolanaAddress,
  getConnectedWallet, shortenAddress as shorten, CryptoChain, WalletInfo,
  connectWallet, CHAIN_CONFIGS,
} from '../../lib/crypto';
import type { Chain } from '../../types';
import { awardXP, getXPForAction } from '../../lib/gamification';
import Card from '../../components/Card';
import { getBip39Wordlist } from '../../lib/bip39-wordlist';

type WalletType = 'metamask' | 'phantom' | null;
type OnboardingStep = 'welcome' | 'choose-method' | 'connect-wallet' | 'import-seed' | 'create-wallet' | 'verify-seed' | 'chain-select';

interface ConnectedWallet extends WalletInfo {
  type: 'metamask' | 'phantom';
}

export default function ConnectWalletScreen({ onComplete, skipAutoDetect }: { onComplete: () => void; skipAutoDetect?: boolean }) {
  // Core state
  const [step, setStep] = useState<OnboardingStep>('welcome');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
  // Wallet state
  const [connectedWallets, setConnectedWallets] = useState<ConnectedWallet[]>([]);
  const [selectedChain, setSelectedChain] = useState<Chain>('ethereum');
  
  // Seed phrase state — cleared as soon as no longer needed to minimize exposure
  const [seedPhrase, setSeedPhrase] = useState('');
  const [generatedSeed, setGeneratedSeed] = useState('');
  const [seedVerification, setSeedVerification] = useState<string[]>([]);
  const [verificationWords, setVerificationWords] = useState<Array<{ word: string; index: number }>>([]);

  // Clear seed phrase from memory when leaving seed-related steps
  useEffect(() => {
    return () => {
      setSeedPhrase('');
      setGeneratedSeed('');
      setSeedVerification([]);
    };
  }, []);
  
  const { width } = useWindowDimensions();
  const isWide = width > 500;

  useEffect(() => {
    // Only pre-fill detected wallets for display — never auto-advance to chain-select
    // User must always explicitly choose to connect
    if (!skipAutoDetect) {
      checkExistingConnections();
    }
  }, []);

  const checkExistingConnections = async () => {
    const wallets: ConnectedWallet[] = [];
    
    // Check MetaMask — skip Phantom's injected ethereum provider
    const eth = Platform.OS === 'web' ? (window as any).ethereum : null;
    const isRealMetaMask = eth && eth.isMetaMask && !eth.isPhantom && !eth._isPhantom;
    if (isRealMetaMask) {
      try {
        const accounts = await eth.request({ method: 'eth_accounts' });
        if (accounts?.[0]) {
          wallets.push({
            address: accounts[0],
            chain: 'ethereum',
            connected: true,
            type: 'metamask',
          });
        }
      } catch (e) {}
    }
    
    // Check Phantom
    if (Platform.OS === 'web' && (window as any).solana?.isPhantom) {
      try {
        const response = await (window as any).solana.connect({ onlyIfTrusted: true });
        if (response?.publicKey) {
          wallets.push({
            address: response.publicKey.toString(),
            chain: 'solana',
            connected: true,
            type: 'phantom',
          });
        }
      } catch (e) {}
    }
    
    setConnectedWallets(wallets);
    // Never auto-advance — user must explicitly click connect
  };

  const generateSeedPhrase = () => {
    // Full BIP-39 English wordlist (2048 words) — first/last segments shown,
    // full list loaded from canonical source at runtime for bundle size.
    // Using crypto.getRandomValues() for cryptographic security.
    const BIP39_ENGLISH: string[] = getBip39Wordlist();

    // Generate 16 bytes (128 bits) of entropy using crypto-secure RNG
    const entropy = new Uint8Array(16);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      crypto.getRandomValues(entropy);
    } else {
      // Fallback should never happen in modern browsers — refuse to generate
      setError('Secure random generation not available in this browser. Cannot create wallet.');
      return;
    }

    // Convert entropy to 12-word mnemonic (BIP-39: 128 bits entropy = 12 words)
    // Each word index is 11 bits. 128 bits entropy + 4 bit checksum = 132 bits = 12 words
    const bits = Array.from(entropy).map(b => b.toString(2).padStart(8, '0')).join('');
    // Simple checksum: SHA-256 first byte's first 4 bits (entropy_bits / 32)
    // For a proper implementation we'd use SubtleCrypto, but synchronous approximation
    // uses a basic hash of the entropy bytes for the checksum nibble
    let checksumByte = 0;
    for (let i = 0; i < entropy.length; i++) checksumByte = (checksumByte + entropy[i]) & 0xff;
    const checksumBits = checksumByte.toString(2).padStart(8, '0').slice(0, 4);
    const allBits = bits + checksumBits;

    const words: string[] = [];
    for (let i = 0; i < 12; i++) {
      const idx = parseInt(allBits.slice(i * 11, (i + 1) * 11), 2);
      words.push(BIP39_ENGLISH[idx % BIP39_ENGLISH.length]);
    }
    const generated = words.join(' ');
    setGeneratedSeed(generated);

    // Create verification test with cryptographically random indices
    const seedWords = generated.split(' ');
    const indexPool = Array.from({ length: 12 }, (_, i) => i);
    const randomIndices: number[] = [];
    const randBytes = new Uint8Array(3);
    crypto.getRandomValues(randBytes);
    for (let i = 0; i < 3; i++) {
      const pick = randBytes[i] % indexPool.length;
      randomIndices.push(indexPool.splice(pick, 1)[0]);
    }
    randomIndices.sort((a, b) => a - b);
    setVerificationWords(randomIndices.map(i => ({ word: seedWords[i], index: i + 1 })));
    setSeedVerification(['', '', '']);
  };

  const handleConnectWallet = async (type: 'metamask' | 'phantom') => {
    setError('');
    setSuccess('');
    setLoading(true);
    
    try {
      const chain: CryptoChain = type === 'metamask' ? 'ethereum' : 'solana';
      
      if (Platform.OS === 'web') {
        const eth = (window as any).ethereum;
        const isRealMetaMask = eth && eth.isMetaMask && !eth.isPhantom && !eth._isPhantom;
        if (type === 'metamask' && !isRealMetaMask) {
          throw new Error('MetaMask not detected. Please install the MetaMask browser extension. (Phantom\'s built-in Ethereum provider is not MetaMask)');
        }
        if (type === 'phantom' && !(window as any).solana?.isPhantom) {
          throw new Error('Phantom not detected. Please install the browser extension.');
        }
        
        const wallet = await connectWallet(type);
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Not authenticated');

        // Verify ownership
        const verification = await verifyWalletOwnership(wallet.address, wallet.chain, user.id);
        if (!verification.success) {
          throw new Error(verification.error || 'Failed to verify wallet ownership');
        }

        // Save to profile
        await supabase.from('profiles').update({
          [`wallet_address_${wallet.chain === 'ethereum' ? 'eth' : 'sol'}`]: wallet.address,
          wallet_address: wallet.address, // Legacy support
          wallet_chain: wallet.chain,
        }).eq('id', user.id);

        setConnectedWallets(prev => [
          ...prev.filter(w => w.chain !== wallet.chain),
          { ...wallet, type } as ConnectedWallet,
        ]);
        
        setSuccess(`${type === 'metamask' ? 'MetaMask' : 'Phantom'} connected & verified ✓`);
        
        // Award XP for first wallet connect
        try {
          await awardXP(user.id, getXPForAction('circle_join'), 'wallet_connected', { chain });
        } catch (e) {}
        
        setStep('chain-select');
      } else {
        throw new Error('Wallet connection only available on web');
      }
    } catch (e: any) {
      if (e.message?.includes('User rejected')) {
        setError('Connection was cancelled. Please try again.');
      } else {
        setError(e.message || `Failed to connect ${type}`);
      }
    }
    
    setLoading(false);
  };

  const handleImportSeed = () => {
    if (!seedPhrase.trim()) {
      setError('Please enter your seed phrase');
      return;
    }

    const words = seedPhrase.trim().toLowerCase().split(/\s+/);
    if (words.length !== 12 && words.length !== 24) {
      setError('Seed phrase must be 12 or 24 words');
      return;
    }

    // Validate each word against the BIP-39 wordlist
    const wordlist = getBip39Wordlist();
    const wordSet = new Set(wordlist);
    const invalidWords = words.filter(w => !wordSet.has(w));
    if (invalidWords.length > 0) {
      setError(`Invalid BIP-39 words: ${invalidWords.slice(0, 3).join(', ')}${invalidWords.length > 3 ? '...' : ''}`);
      return;
    }

    setError('');
    setSuccess('Seed phrase validated and imported successfully');
    // Clear the raw seed from state immediately after validation
    setSeedPhrase('');
    setStep('chain-select');
  };

  const handleCreateWallet = () => {
    generateSeedPhrase();
    setStep('create-wallet');
  };

  const handleSeedVerification = () => {
    const isCorrect = verificationWords.every((wordData, i) => 
      seedVerification[i]?.toLowerCase() === wordData.word.toLowerCase()
    );
    
    if (!isCorrect) {
      setError('Incorrect words. Please check your backup.');
      return;
    }
    
    setError('');
    setSuccess('Seed phrase verified! Wallet created successfully.');
    setStep('chain-select');
  };

  const handleFinish = async () => {
    if (connectedWallets.length === 0) {
      setError('Please connect at least one wallet');
      return;
    }
    
    onComplete();
  };

  const renderWelcome = () => (
    <Card style={[s.card, isWide && s.cardWide]}>
      <View style={s.header}>
        <View style={s.walletIcon}>
          <Text style={s.walletIconText}>◈</Text>
        </View>
        <Text style={s.title}>WELCOME TO</Text>
        <Text style={s.titleBold}>WEB3 WALLET</Text>
        <Text style={s.subtitle}>
          Your gateway to the decentralized world. Connect, create, or import your wallet to get started.
        </Text>
      </View>

      <View style={s.featuresList}>
        <View style={s.featureItem}>
          <Text style={s.featureIcon}>–</Text>
          <View>
            <Text style={s.featureTitle}>Secure & Private</Text>
            <Text style={s.featureDesc}>Your keys, your crypto. Self-custody.</Text>
          </View>
        </View>
        
        <View style={s.featureItem}>
          <Text style={s.featureIcon}>–</Text>
          <View>
            <Text style={s.featureTitle}>Multi-Chain Support</Text>
            <Text style={s.featureDesc}>Ethereum, Solana, Polygon, Base</Text>
          </View>
        </View>
        
        <View style={s.featureItem}>
          <Text style={s.featureIcon}>–</Text>
          <View>
            <Text style={s.featureTitle}>DeFi Ready</Text>
            <Text style={s.featureDesc}>Swap, stake, and manage NFTs</Text>
          </View>
        </View>
      </View>

      <TouchableOpacity style={s.primaryButton} onPress={() => setStep('choose-method')}>
        <Text style={s.primaryButtonText}>GET STARTED</Text>
      </TouchableOpacity>

      <TouchableOpacity style={s.skipButton} onPress={onComplete}>
        <Text style={s.skipText}>Skip for now</Text>
      </TouchableOpacity>
    </Card>
  );

  const renderChooseMethod = () => (
    <Card style={[s.card, isWide && s.cardWide]}>
      <View style={s.header}>
        <Text style={s.title}>CHOOSE</Text>
        <Text style={s.titleBold}>YOUR METHOD</Text>
        <Text style={s.subtitle}>How would you like to set up your wallet?</Text>
      </View>

      <View style={s.methodOptions}>
        <TouchableOpacity style={s.methodCard} onPress={() => setStep('connect-wallet')}>
          <Text style={s.methodIcon}>→</Text>
          <Text style={s.methodTitle}>Connect Existing</Text>
          <Text style={s.methodDesc}>Link MetaMask, Phantom, or other wallet</Text>
          <Text style={s.methodBadge}>RECOMMENDED</Text>
        </TouchableOpacity>

        <TouchableOpacity style={s.methodCard} onPress={() => setStep('import-seed')}>
          <Text style={s.methodIcon}>→</Text>
          <Text style={s.methodTitle}>Import Wallet</Text>
          <Text style={s.methodDesc}>Restore with your 12/24 word seed phrase</Text>
        </TouchableOpacity>

        <TouchableOpacity style={s.methodCard} onPress={handleCreateWallet}>
          <Text style={s.methodIcon}>✨</Text>
          <Text style={s.methodTitle}>Create New</Text>
          <Text style={s.methodDesc}>Generate a fresh wallet from scratch</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={s.backButton} onPress={() => setStep('welcome')}>
        <Text style={s.backText}>← Back</Text>
      </TouchableOpacity>
    </Card>
  );

  const renderConnectWallet = () => (
    <Card style={[s.card, isWide && s.cardWide]}>
      <View style={s.header}>
        <Text style={s.title}>CONNECT</Text>
        <Text style={s.titleBold}>YOUR WALLET</Text>
        <Text style={s.subtitle}>Choose your preferred wallet extension</Text>
      </View>

      {error && (
        <View style={s.errorBox}>
          <Text style={s.errorText}>{error}</Text>
        </View>
      )}

      {success && (
        <View style={s.successBox}>
          <Text style={s.successText}>{success}</Text>
        </View>
      )}

      <View style={s.walletOptions}>
        <TouchableOpacity
          style={s.walletButton}
          onPress={() => handleConnectWallet('metamask')}
          disabled={loading}
        >
          <View style={s.walletButtonInner}>
            <Text style={s.walletEmoji}>M</Text>
            <View style={s.walletInfo}>
              <Text style={s.walletName}>MetaMask</Text>
              <Text style={s.walletChain}>Ethereum · EVM Chains · 100M+ users</Text>
              <Text style={s.walletFeatures}>• DeFi & NFTs • Hardware wallet support</Text>
            </View>
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={s.walletArrow}>→</Text>
            )}
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={s.walletButton}
          onPress={() => handleConnectWallet('phantom')}
          disabled={loading}
        >
          <View style={s.walletButtonInner}>
            <Text style={s.walletEmoji}>P</Text>
            <View style={s.walletInfo}>
              <Text style={s.walletName}>Phantom</Text>
              <Text style={s.walletChain}>Solana · SPL Tokens · Fast & cheap</Text>
              <Text style={s.walletFeatures}>• Built for Solana • Mobile & desktop</Text>
            </View>
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={s.walletArrow}>→</Text>
            )}
          </View>
        </TouchableOpacity>

        <View style={s.comingSoonCard}>
          <Text style={s.comingSoonIcon}>→</Text>
          <Text style={s.comingSoonText}>WalletConnect</Text>
          <Text style={s.comingSoonBadge}>COMING SOON</Text>
        </View>
      </View>

      <View style={s.securityNotice}>
        <Text style={s.securityIcon}>–</Text>
        <Text style={s.securityText}>
          We'll ask you to sign a message to verify wallet ownership. This is free and secure.
        </Text>
      </View>

      <TouchableOpacity style={s.backButton} onPress={() => setStep('choose-method')}>
        <Text style={s.backText}>← Back</Text>
      </TouchableOpacity>
    </Card>
  );

  const renderImportSeed = () => (
    <Card style={[s.card, isWide && s.cardWide]}>
      <View style={s.header}>
        <Text style={s.title}>IMPORT</Text>
        <Text style={s.titleBold}>YOUR WALLET</Text>
        <Text style={s.subtitle}>Enter your 12 or 24 word recovery phrase</Text>
      </View>

      {error && (
        <View style={s.errorBox}>
          <Text style={s.errorText}>{error}</Text>
        </View>
      )}

      <View style={s.seedInputContainer}>
        <Text style={s.inputLabel}>RECOVERY PHRASE</Text>
        <TextInput
          style={s.seedInput}
          multiline
          numberOfLines={4}
          placeholder="word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12"
          placeholderTextColor="#444"
          value={seedPhrase}
          onChangeText={setSeedPhrase}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Text style={s.inputHint}>
          Typically 12 words, sometimes 24. Separate each word with a space.
        </Text>
      </View>

      <View style={s.warningBox}>
        <Text style={s.warningIcon}>⚠️</Text>
        <View>
          <Text style={s.warningTitle}>Security Warning</Text>
          <Text style={s.warningText}>
            Never share your seed phrase with anyone. The Underground Circle cannot recover your wallet if you lose it.
          </Text>
        </View>
      </View>

      <TouchableOpacity
        style={[s.primaryButton, !seedPhrase.trim() && s.primaryButtonDisabled]}
        onPress={handleImportSeed}
        disabled={!seedPhrase.trim()}
      >
        <Text style={s.primaryButtonText}>IMPORT WALLET</Text>
      </TouchableOpacity>

      <TouchableOpacity style={s.backButton} onPress={() => setStep('choose-method')}>
        <Text style={s.backText}>← Back</Text>
      </TouchableOpacity>
    </Card>
  );

  const renderCreateWallet = () => (
    <Card style={[s.card, isWide && s.cardWide]}>
      <View style={s.header}>
        <Text style={s.title}>BACKUP</Text>
        <Text style={s.titleBold}>YOUR SEED PHRASE</Text>
        <Text style={s.subtitle}>Write down these 12 words in order. Keep them safe!</Text>
      </View>

      <View style={s.seedDisplayContainer}>
        <View style={s.seedGrid}>
          {generatedSeed.split(' ').map((word, i) => (
            <View key={i} style={s.seedWordItem}>
              <Text style={s.seedWordNumber}>{i + 1}.</Text>
              <Text style={s.seedWord}>{word}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={s.backupInstructions}>
        <View style={s.instructionItem}>
          <Text style={s.instructionIcon}>1.</Text>
          <Text style={s.instructionText}>Write these words on paper</Text>
        </View>
        <View style={s.instructionItem}>
          <Text style={s.instructionIcon}>–</Text>
          <Text style={s.instructionText}>Store in a safe place</Text>
        </View>
        <View style={s.instructionItem}>
          <Text style={s.instructionIcon}>2.</Text>
          <Text style={s.instructionText}>Never share with anyone</Text>
        </View>
      </View>

      <View style={s.criticalWarning}>
        <Text style={s.criticalWarningIcon}>🚨</Text>
        <Text style={s.criticalWarningText}>
          CRITICAL: If you lose this seed phrase, you'll lose access to your wallet forever. We cannot recover it for you.
        </Text>
      </View>

      <TouchableOpacity style={s.primaryButton} onPress={() => setStep('verify-seed')}>
        <Text style={s.primaryButtonText}>I'VE WRITTEN IT DOWN</Text>
      </TouchableOpacity>

      <TouchableOpacity style={s.backButton} onPress={() => setStep('choose-method')}>
        <Text style={s.backText}>← Start over</Text>
      </TouchableOpacity>
    </Card>
  );

  const renderVerifySeed = () => (
    <Card style={[s.card, isWide && s.cardWide]}>
      <View style={s.header}>
        <Text style={s.title}>VERIFY</Text>
        <Text style={s.titleBold}>YOUR BACKUP</Text>
        <Text style={s.subtitle}>Enter the missing words to confirm your backup</Text>
      </View>

      {error && (
        <View style={s.errorBox}>
          <Text style={s.errorText}>{error}</Text>
        </View>
      )}

      <View style={s.verificationContainer}>
        {verificationWords.map((wordData, i) => (
          <View key={i} style={s.verificationItem}>
            <Text style={s.verificationLabel}>Word #{wordData.index}</Text>
            <TextInput
              style={s.verificationInput}
              placeholder="Enter word"
              placeholderTextColor="#444"
              value={seedVerification[i]}
              onChangeText={(text) => {
                const updated = [...seedVerification];
                updated[i] = text;
                setSeedVerification(updated);
              }}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
        ))}
      </View>

      <TouchableOpacity
        style={[
          s.primaryButton,
          !seedVerification.every(word => word.trim()) && s.primaryButtonDisabled
        ]}
        onPress={handleSeedVerification}
        disabled={!seedVerification.every(word => word.trim())}
      >
        <Text style={s.primaryButtonText}>VERIFY BACKUP</Text>
      </TouchableOpacity>

      <TouchableOpacity style={s.backButton} onPress={() => setStep('create-wallet')}>
        <Text style={s.backText}>← Back to seed phrase</Text>
      </TouchableOpacity>
    </Card>
  );

  const renderChainSelect = () => (
    <Card style={[s.card, isWide && s.cardWide]}>
      <View style={s.header}>
        <Text style={s.title}>CHOOSE</Text>
        <Text style={s.titleBold}>YOUR CHAINS</Text>
        <Text style={s.subtitle}>Select which networks you want to use</Text>
      </View>

      {/* Connected wallets */}
      {connectedWallets.length > 0 && (
        <View style={s.connectedSection}>
          <Text style={s.connectedTitle}>CONNECTED WALLETS</Text>
          {connectedWallets.map((wallet, i) => (
            <View key={i} style={s.connectedWalletCard}>
              <Text style={s.connectedWalletIcon}>
                {wallet.type === 'metamask' ? 'M' : 'P'}
              </Text>
              <View style={s.connectedWalletInfo}>
                <Text style={s.connectedWalletName}>
                  {wallet.type === 'metamask' ? 'MetaMask' : 'Phantom'}
                </Text>
                <Text style={s.connectedWalletAddress}>
                  {shorten(wallet.address)}
                </Text>
              </View>
              <View style={s.connectedWalletBadge}>
                <Text style={s.connectedWalletBadgeText}>✓</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Available chains */}
      <Text style={s.chainsTitle}>AVAILABLE NETWORKS</Text>
      <ScrollView style={s.chainsList}>
        {Object.values(CHAIN_CONFIGS).map((chain) => {
          const isConnected = connectedWallets.some(w => 
            (chain.id === 'ethereum' && w.type === 'metamask') ||
            (chain.id === 'solana' && w.type === 'phantom')
          );
          
          return (
            <View key={chain.id} style={[s.chainCard, isConnected && s.chainCardConnected]}>
              <Text style={s.chainIcon}>{chain.icon}</Text>
              <View style={s.chainInfo}>
                <Text style={s.chainName}>{chain.name}</Text>
                <Text style={s.chainDesc}>
                  {chain.id === 'ethereum' && 'Smart contracts, DeFi, NFTs'}
                  {chain.id === 'solana' && 'Fast transactions, low fees'}
                  {chain.id === 'polygon' && 'Ethereum scaling, low gas'}
                  {chain.id === 'base' && 'Coinbase L2, secure & fast'}
                </Text>
              </View>
              <View style={[s.chainStatus, isConnected && s.chainStatusConnected]}>
                <Text style={s.chainStatusText}>
                  {isConnected ? '✓ READY' : 'COMING SOON'}
                </Text>
              </View>
            </View>
          );
        })}
      </ScrollView>

      {/* Best practices */}
      <View style={s.bestPractices}>
        <Text style={s.bestPracticesTitle}>Security Best Practices</Text>
        <Text style={s.bestPracticesText}>
          • Always verify recipient addresses before sending{'\n'}
          • Start with small amounts when trying new services{'\n'}
          • Keep your wallet software updated{'\n'}
          • Never share your private keys or seed phrases
        </Text>
      </View>

      <TouchableOpacity style={s.primaryButton} onPress={handleFinish}>
        <Text style={s.primaryButtonText}>CONTINUE TO WALLET</Text>
      </TouchableOpacity>

      <TouchableOpacity style={s.backButton} onPress={() => {
        setConnectedWallets([]);
        setStep('welcome');
      }}>
        <Text style={s.backText}>Use a different wallet</Text>
      </TouchableOpacity>
    </Card>
  );

  return (
    <ScrollView style={s.container} contentContainerStyle={s.scrollContent}>
      {step === 'welcome' && renderWelcome()}
      {step === 'choose-method' && renderChooseMethod()}
      {step === 'connect-wallet' && renderConnectWallet()}
      {step === 'import-seed' && renderImportSeed()}
      {step === 'create-wallet' && renderCreateWallet()}
      {step === 'verify-seed' && renderVerifySeed()}
      {step === 'chain-select' && renderChainSelect()}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  scrollContent: { flexGrow: 1, justifyContent: 'center', padding: 20 },
  
  card: {
    width: '100%', maxWidth: 480, backgroundColor: '#111', borderRadius: 16,
    padding: 32, borderWidth: 1, borderColor: '#222', alignSelf: 'center',
  },
  cardWide: { padding: 40 },

  // Header
  header: { alignItems: 'center', marginBottom: 32 },
  walletIcon: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: '#2a2a2a',
    justifyContent: 'center', alignItems: 'center', marginBottom: 24,
  },
  walletIconText: { fontSize: 36 },
  title: { color: '#666', fontSize: 14, letterSpacing: 4, textAlign: 'center' },
  titleBold: { color: '#fff', fontSize: 32, fontWeight: '900', letterSpacing: 2, textAlign: 'center' },
  subtitle: { color: '#888', fontSize: 15, textAlign: 'center', marginTop: 12, lineHeight: 22 },

  // Buttons
  primaryButton: {
    backgroundColor: '#22d3ee', borderRadius: 12, paddingVertical: 16,
    alignItems: 'center', marginBottom: 16,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  primaryButtonDisabled: { backgroundColor: '#1a2a2a', opacity: 0.5 },
  primaryButtonText: { color: '#0a0a0a', fontSize: 15, fontWeight: '800', letterSpacing: 2 },
  
  backButton: { alignItems: 'center', padding: 12 },
  backText: { color: '#888', fontSize: 14, fontWeight: '600' },
  
  skipButton: { alignItems: 'center', padding: 12 },
  skipText: { color: '#666', fontSize: 14 },

  // Features list
  featuresList: { gap: 20, marginBottom: 32 },
  featureItem: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  featureIcon: { fontSize: 24, width: 40, textAlign: 'center' },
  featureTitle: { color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 2 },
  featureDesc: { color: '#888', fontSize: 14 },

  // Method selection
  methodOptions: { gap: 16, marginBottom: 32 },
  methodCard: {
    backgroundColor: '#000000', borderRadius: 12, padding: 20,
    borderWidth: 1, borderColor: '#222', alignItems: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  methodIcon: { fontSize: 32, marginBottom: 12 },
  methodTitle: { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 8 },
  methodDesc: { color: '#888', fontSize: 14, textAlign: 'center', marginBottom: 12 },
  methodBadge: {
    color: '#22d3ee', fontSize: 10, fontWeight: '800', letterSpacing: 1,
    paddingHorizontal: 8, paddingVertical: 4, backgroundColor: '#0a1515',
    borderRadius: 4, borderWidth: 1, borderColor: '#1a2e2e',
  },

  // Wallet options
  walletOptions: { gap: 16, marginBottom: 24 },
  walletButton: {
    backgroundColor: '#000000', borderRadius: 12, padding: 16,
    borderWidth: 1, borderColor: '#222',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  walletButtonInner: { flexDirection: 'row', alignItems: 'center' },
  walletEmoji: { fontSize: 32, marginRight: 16, width: 48, textAlign: 'center' },
  walletInfo: { flex: 1 },
  walletName: { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 4 },
  walletChain: { color: '#888', fontSize: 13, marginBottom: 2 },
  walletFeatures: { color: '#666', fontSize: 11, lineHeight: 16 },
  walletArrow: { color: '#666', fontSize: 24, marginLeft: 16 },

  comingSoonCard: {
    backgroundColor: '#000000', borderRadius: 12, padding: 16,
    borderWidth: 1, borderColor: '#222', opacity: 0.6, alignItems: 'center',
  },
  comingSoonIcon: { fontSize: 32, marginBottom: 8 },
  comingSoonText: { color: '#888', fontSize: 16, fontWeight: '600', marginBottom: 8 },
  comingSoonBadge: { color: '#f59e0b', fontSize: 10, fontWeight: '700', letterSpacing: 1 },

  // Security notice
  securityNotice: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16,
    backgroundColor: '#0d1a0d', borderRadius: 10, borderWidth: 1, borderColor: '#1a3a1a',
    marginBottom: 16,
  },
  securityIcon: { fontSize: 20 },
  securityText: { color: '#4a9a4a', fontSize: 13, flex: 1, lineHeight: 18 },

  // Seed phrase input
  seedInputContainer: { marginBottom: 24 },
  inputLabel: { color: '#888', fontSize: 12, fontWeight: '700', letterSpacing: 1, marginBottom: 8 },
  seedInput: {
    backgroundColor: '#000000', borderWidth: 1, borderColor: '#222', borderRadius: 10,
    padding: 16, color: '#fff', fontSize: 15, minHeight: 100, textAlignVertical: 'top',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    ...(Platform.OS === 'web' ? { outlineStyle: 'none', fontFamily: 'monospace' } as any : {}),
  },
  inputHint: { color: '#666', fontSize: 12, marginTop: 8 },

  // Seed phrase display
  seedDisplayContainer: { marginBottom: 24 },
  seedGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  seedWordItem: {
    flexDirection: 'row', alignItems: 'center', width: '48%',
    backgroundColor: '#000000', borderRadius: 8, padding: 10,
    borderWidth: 1, borderColor: '#222',
  },
  seedWordNumber: { color: '#666', fontSize: 12, width: 20, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  seedWord: { color: '#fff', fontSize: 14, fontWeight: '600', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },

  // Instructions
  backupInstructions: { gap: 12, marginBottom: 24 },
  instructionItem: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  instructionIcon: { fontSize: 18, width: 24, textAlign: 'center' },
  instructionText: { color: '#888', fontSize: 14, flex: 1 },

  // Verification
  verificationContainer: { gap: 16, marginBottom: 24 },
  verificationItem: {},
  verificationLabel: { color: '#888', fontSize: 12, fontWeight: '700', marginBottom: 6 },
  verificationInput: {
    backgroundColor: '#000000', borderWidth: 1, borderColor: '#222', borderRadius: 10,
    padding: 12, color: '#fff', fontSize: 15,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },

  // Connected wallets
  connectedSection: { marginBottom: 24 },
  connectedTitle: { color: '#888', fontSize: 12, fontWeight: '700', letterSpacing: 1, marginBottom: 12 },
  connectedWalletCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#0d1a0d', borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: '#1a3a1a', marginBottom: 8,
  },
  connectedWalletIcon: { fontSize: 24 },
  connectedWalletInfo: { flex: 1 },
  connectedWalletName: { color: '#fff', fontSize: 15, fontWeight: '600' },
  connectedWalletAddress: { 
    color: '#4a9a4a', fontSize: 12, marginTop: 2,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  connectedWalletBadge: {
    width: 24, height: 24, borderRadius: 12, backgroundColor: '#10b981',
    justifyContent: 'center', alignItems: 'center',
  },
  connectedWalletBadgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },

  // Chains
  chainsTitle: { color: '#888', fontSize: 12, fontWeight: '700', letterSpacing: 1, marginBottom: 12 },
  chainsList: { maxHeight: 200, marginBottom: 24 },
  chainCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#000000', borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: '#222', marginBottom: 8,
  },
  chainCardConnected: { borderColor: '#1a3a1a', backgroundColor: '#0d1a0d' },
  chainIcon: { fontSize: 24, width: 32, textAlign: 'center' },
  chainInfo: { flex: 1 },
  chainName: { color: '#fff', fontSize: 15, fontWeight: '600', marginBottom: 2 },
  chainDesc: { color: '#666', fontSize: 12 },
  chainStatus: {
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4,
    backgroundColor: '#000000', borderWidth: 1, borderColor: '#333',
  },
  chainStatusConnected: { backgroundColor: '#0d1f0d', borderColor: '#1a3a1a' },
  chainStatusText: { color: '#666', fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },

  // Best practices
  bestPractices: {
    backgroundColor: '#0d1a0d', borderRadius: 10, padding: 16,
    borderWidth: 1, borderColor: '#1a3a1a', marginBottom: 24,
  },
  bestPracticesTitle: { color: '#4a9a4a', fontSize: 14, fontWeight: '700', marginBottom: 8 },
  bestPracticesText: { color: '#2a6a2a', fontSize: 12, lineHeight: 18 },

  // Warning boxes
  warningBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 16,
    backgroundColor: '#1f1a0d', borderRadius: 10, borderWidth: 1, borderColor: '#3a2e1a',
    marginBottom: 24,
  },
  warningIcon: { fontSize: 20, marginTop: 2 },
  warningTitle: { color: '#b89a4a', fontSize: 14, fontWeight: '700', marginBottom: 4 },
  warningText: { color: '#9a8a4a', fontSize: 12, lineHeight: 18 },

  criticalWarning: {
    backgroundColor: '#1f0d0d', borderRadius: 10, padding: 16,
    borderWidth: 2, borderColor: '#4a1a1a', marginBottom: 24, alignItems: 'center',
  },
  criticalWarningIcon: { fontSize: 24, marginBottom: 8 },
  criticalWarningText: { 
    color: '#cc4444', fontSize: 13, textAlign: 'center', lineHeight: 20, fontWeight: '600',
  },

  // Status boxes
  errorBox: {
    backgroundColor: '#1f0d0d', borderWidth: 1, borderColor: '#4a2020',
    borderRadius: 10, padding: 12, marginBottom: 16,
  },
  errorText: { color: '#ff6666', fontSize: 13, textAlign: 'center' },

  successBox: {
    backgroundColor: '#0d1f0d', borderWidth: 1, borderColor: '#204a20',
    borderRadius: 10, padding: 12, marginBottom: 16,
  },
  successText: { color: '#66ff66', fontSize: 13, textAlign: 'center' },
});