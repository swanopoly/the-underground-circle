import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { supabase } from '../../../lib/supabase';
import ConnectWalletScreen from '../../wallet/ConnectWalletScreen';
import WalletDashboard from '../../wallet/WalletDashboard';

interface Props {
  circleId: string;
}

export default function WalletTab({ circleId }: Props) {
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletChain, setWalletChain] = useState<string>('ethereum');
  const [loading, setLoading] = useState(true);
  // When true, render ConnectWalletScreen in "fresh" mode (skip auto-detection)
  const [forceDisconnected, setForceDisconnected] = useState(false);

  useEffect(() => {
    checkWallet();
  }, []);

  const checkWallet = async () => {
    setForceDisconnected(false);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      const { data } = await supabase
        .from('profiles')
        .select('wallet_address, wallet_chain, wallet_address_eth, wallet_address_sol')
        .eq('id', user.id)
        .single();
      if (data) {
        const addr = data.wallet_address_sol || data.wallet_address_eth || data.wallet_address;
        const chain = data.wallet_chain || (data.wallet_address_sol ? 'solana' : 'ethereum');
        if (addr) {
          setWalletAddress(addr);
          setWalletChain(chain);
        }
      }
    } catch (e) {
      // wallet columns may not exist yet
    }
    setLoading(false);
  };

  const handleDisconnect = async () => {
    try {
      // 1. Disconnect browser wallet extensions first
      if (Platform.OS === 'web') {
        try {
          if ((window as any).solana?.isPhantom) {
            await (window as any).solana.disconnect();
          }
        } catch {}
        try {
          if ((window as any).ethereum) {
            await (window as any).ethereum.request({
              method: 'wallet_revokePermissions',
              params: [{ eth_accounts: {} }],
            });
          }
        } catch {}
      }

      // 2. Clear Supabase
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from('profiles').update({
          wallet_address: null,
          wallet_chain: null,
          wallet_address_eth: null,
          wallet_address_sol: null,
        }).eq('id', user.id);
      }

      // 3. Set forceDisconnected so ConnectWalletScreen skips auto-detection
      setForceDisconnected(true);
      setWalletAddress(null);
      setWalletChain('ethereum');
    } catch (error) {
      console.error('Error disconnecting wallet:', error);
      setWalletAddress(null);
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
    return (
      <ConnectWalletScreen
        onComplete={() => checkWallet()}
        skipAutoDetect={forceDisconnected}
      />
    );
  }

  return (
    <WalletDashboard
      walletAddress={walletAddress}
      chain={walletChain}
      onDisconnect={handleDisconnect}
    />
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
});
