import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, Platform } from 'react-native';
import { supabase } from '../../../lib/supabase';
import ConnectWalletScreen from '../../wallet/ConnectWalletScreen';

interface Props {
  circleId: string;
}

export default function WalletTab({ circleId }: Props) {
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletChain, setWalletChain] = useState<string>('ethereum');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkWallet();
  }, []);

  const checkWallet = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      const { data } = await supabase
        .from('profiles')
        .select('wallet_address, wallet_chain')
        .eq('id', user.id)
        .single();
      if (data?.wallet_address) {
        setWalletAddress(data.wallet_address);
        setWalletChain(data.wallet_chain || 'ethereum');
      }
    } catch (e) {
      // wallet columns may not exist yet
    }
    setLoading(false);
  };

  const handleDisconnect = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      
      await supabase
        .from('profiles')
        .update({ wallet_address: null, wallet_chain: null })
        .eq('id', user.id);
      
      setWalletAddress(null);
      setWalletChain('ethereum');
    } catch (error) {
      console.error('Error disconnecting wallet:', error);
    }
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  if (!walletAddress) {
    return <ConnectWalletScreen onComplete={() => checkWallet()} />;
  }

  // Wallet connected - show Coming Soon placeholder
  const chainEmoji = walletChain === 'solana' ? '◎' : walletChain === 'ethereum' ? '⟠' : '🔗';
  const shortAddress = `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`;

  return (
    <View style={styles.container}>
      <View style={styles.comingSoonCard}>
        <Text style={styles.icon}>💰</Text>
        <Text style={styles.title}>Wallet Connected</Text>
        
        <View style={styles.addressBox}>
          <Text style={styles.chainEmoji}>{chainEmoji}</Text>
          <Text style={styles.address}>{shortAddress}</Text>
          <Text style={styles.chainLabel}>{walletChain}</Text>
        </View>

        <View style={styles.divider} />

        <Text style={styles.comingSoonTitle}>Portfolio Tracking Coming Soon</Text>
        <Text style={styles.comingSoonText}>
          We're building a comprehensive wallet dashboard with:
        </Text>

        <View style={styles.featureList}>
          <View style={styles.featureItem}>
            <Text style={styles.featureBullet}>•</Text>
            <Text style={styles.featureText}>Real-time token balances & NFTs</Text>
          </View>
          <View style={styles.featureItem}>
            <Text style={styles.featureBullet}>•</Text>
            <Text style={styles.featureText}>Transaction history & analytics</Text>
          </View>
          <View style={styles.featureItem}>
            <Text style={styles.featureBullet}>•</Text>
            <Text style={styles.featureText}>DeFi positions & yield tracking</Text>
          </View>
          <View style={styles.featureItem}>
            <Text style={styles.featureBullet}>•</Text>
            <Text style={styles.featureText}>Circle treasury management</Text>
          </View>
        </View>

        <Pressable
          onPress={handleDisconnect}
          style={[styles.disconnectBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
        >
          <Text style={styles.disconnectBtnText}>DISCONNECT WALLET</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050508',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  loadingText: {
    color: '#888',
    fontSize: 14,
    fontFamily: 'monospace',
  },
  comingSoonCard: {
    backgroundColor: '#0a0a10',
    borderRadius: 16,
    padding: 32,
    maxWidth: 500,
    width: '100%',
    borderWidth: 1,
    borderColor: '#1a1a2e',
    alignItems: 'center',
  },
  icon: {
    fontSize: 48,
    marginBottom: 16,
  },
  title: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 20,
    fontFamily: 'monospace',
    letterSpacing: 1,
  },
  addressBox: {
    backgroundColor: '#111118',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1a1a2e',
    padding: 16,
    width: '100%',
    alignItems: 'center',
    marginBottom: 20,
  },
  chainEmoji: {
    fontSize: 24,
    marginBottom: 8,
  },
  address: {
    color: '#22c55e',
    fontSize: 16,
    fontWeight: '700',
    fontFamily: 'monospace',
    marginBottom: 4,
  },
  chainLabel: {
    color: '#888',
    fontSize: 11,
    textTransform: 'uppercase',
    fontFamily: 'monospace',
    letterSpacing: 1,
  },
  divider: {
    width: '100%',
    height: 1,
    backgroundColor: '#1a1a2e',
    marginBottom: 20,
  },
  comingSoonTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 12,
    fontFamily: 'monospace',
  },
  comingSoonText: {
    color: '#888',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 16,
  },
  featureList: {
    width: '100%',
    marginBottom: 24,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  featureBullet: {
    color: '#22c55e',
    fontSize: 16,
    marginRight: 8,
    marginTop: 2,
  },
  featureText: {
    color: '#aaa',
    fontSize: 13,
    flex: 1,
    lineHeight: 20,
  },
  disconnectBtn: {
    backgroundColor: '#ef444415',
    borderWidth: 1,
    borderColor: '#ef444440',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 24,
    marginTop: 8,
  },
  disconnectBtnText: {
    color: '#ef4444',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
    fontFamily: 'monospace',
  },
});
