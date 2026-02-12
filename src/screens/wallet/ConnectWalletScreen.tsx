import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  useWindowDimensions,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { supabase } from '../../lib/supabase';

type WalletType = 'metamask' | 'phantom' | null;

export default function ConnectWalletScreen({ onComplete }: { onComplete: () => void }) {
  const [connecting, setConnecting] = useState<WalletType>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [error, setError] = useState('');
  const { width } = useWindowDimensions();
  const isWide = width > 500;

  const connectMetaMask = async () => {
    setError('');
    setConnecting('metamask');
    try {
      if (Platform.OS === 'web' && (window as any).ethereum) {
        const accounts = await (window as any).ethereum.request({
          method: 'eth_requestAccounts',
        });
        if (accounts && accounts[0]) {
          await saveWallet(accounts[0], 'ethereum');
          setWalletAddress(accounts[0]);
        }
      } else {
        setError('MetaMask not detected. Install the browser extension.');
      }
    } catch (e: any) {
      setError(e.message || 'Failed to connect MetaMask');
    }
    setConnecting(null);
  };

  const connectPhantom = async () => {
    setError('');
    setConnecting('phantom');
    try {
      if (Platform.OS === 'web' && (window as any).solana?.isPhantom) {
        const response = await (window as any).solana.connect();
        const address = response.publicKey.toString();
        await saveWallet(address, 'solana');
        setWalletAddress(address);
      } else {
        setError('Phantom not detected. Install the browser extension.');
      }
    } catch (e: any) {
      setError(e.message || 'Failed to connect Phantom');
    }
    setConnecting(null);
  };

  const saveWallet = async (address: string, chain: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from('profiles').update({
      wallet_address: address,
      wallet_chain: chain,
    }).eq('id', user.id);
  };

  const shortenAddress = (addr: string) =>
    `${addr.slice(0, 6)}...${addr.slice(-4)}`;

  return (
    <View style={styles.container}>
      <View style={[styles.card, isWide && styles.cardWide]}>
        <View style={styles.header}>
          <View style={styles.walletIcon}>
            <Text style={styles.walletIconText}>💎</Text>
          </View>
          <Text style={styles.title}>CONNECT YOUR</Text>
          <Text style={styles.titleBold}>WALLET</Text>
          <Text style={styles.subtitle}>Link your crypto to the circle.</Text>
        </View>

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {walletAddress ? (
          <View style={styles.connectedBox}>
            <Text style={styles.connectedLabel}>CONNECTED</Text>
            <Text style={styles.connectedAddress}>{shortenAddress(walletAddress)}</Text>
            <TouchableOpacity style={styles.continueButton} onPress={onComplete}>
              <Text style={styles.continueButtonText}>LET'S GO</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.walletOptions}>
            <TouchableOpacity
              style={styles.walletButton}
              onPress={connectMetaMask}
              disabled={connecting !== null}
            >
              <View style={styles.walletButtonInner}>
                <Text style={styles.walletEmoji}>🦊</Text>
                <View style={styles.walletInfo}>
                  <Text style={styles.walletName}>MetaMask</Text>
                  <Text style={styles.walletChain}>Ethereum · ERC-20 · NFTs</Text>
                </View>
                {connecting === 'metamask' ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.walletArrow}>→</Text>
                )}
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.walletButton}
              onPress={connectPhantom}
              disabled={connecting !== null}
            >
              <View style={styles.walletButtonInner}>
                <Text style={styles.walletEmoji}>👻</Text>
                <View style={styles.walletInfo}>
                  <Text style={styles.walletName}>Phantom</Text>
                  <Text style={styles.walletChain}>Solana · SPL Tokens · NFTs</Text>
                </View>
                {connecting === 'phantom' ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.walletArrow}>→</Text>
                )}
              </View>
            </TouchableOpacity>
          </View>
        )}

        {!walletAddress && (
          <TouchableOpacity style={styles.skipButton} onPress={onComplete}>
            <Text style={styles.skipText}>Skip for now</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#111',
    borderRadius: 16,
    padding: 32,
    borderWidth: 1,
    borderColor: '#222',
  },
  cardWide: {
    padding: 40,
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  walletIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#1a1a2e',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  walletIconText: {
    fontSize: 28,
  },
  title: {
    color: '#666',
    fontSize: 13,
    letterSpacing: 6,
    textAlign: 'center',
  },
  titleBold: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: 3,
    textAlign: 'center',
  },
  subtitle: {
    color: '#555',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 10,
    fontStyle: 'italic',
  },
  errorBox: {
    backgroundColor: '#2a1515',
    borderWidth: 1,
    borderColor: '#4a2020',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  errorText: {
    color: '#ff6666',
    fontSize: 13,
    textAlign: 'center',
  },
  walletOptions: {
    gap: 12,
    marginBottom: 24,
  },
  walletButton: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  walletButtonInner: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  walletEmoji: {
    fontSize: 28,
    marginRight: 14,
  },
  walletInfo: {
    flex: 1,
  },
  walletName: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  walletChain: {
    color: '#666',
    fontSize: 12,
    marginTop: 2,
  },
  walletArrow: {
    color: '#555',
    fontSize: 20,
  },
  connectedBox: {
    alignItems: 'center',
    backgroundColor: '#1a2a1a',
    borderRadius: 12,
    padding: 24,
    borderWidth: 1,
    borderColor: '#2a3a2a',
    marginBottom: 20,
  },
  connectedLabel: {
    color: '#4a9a4a',
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: '700',
    marginBottom: 8,
  },
  connectedAddress: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginBottom: 20,
  },
  continueButton: {
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 40,
  },
  continueButtonText: {
    color: '#0a0a0a',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 2,
  },
  skipButton: {
    alignItems: 'center',
    padding: 12,
  },
  skipText: {
    color: '#555',
    fontSize: 14,
  },
});
