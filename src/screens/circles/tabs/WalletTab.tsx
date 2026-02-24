import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
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

  useEffect(() => {
    checkWallet();
  }, []);

  const checkWallet = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      const { data } = await supabase
        .from('profiles')
        .select('wallet_address, wallet_chain, wallet_address_eth, wallet_address_sol')
        .eq('id', user.id)
        .single();
      if (data) {
        // Check any wallet address (legacy or chain-specific)
        const addr = data.wallet_address || data.wallet_address_eth || data.wallet_address_sol;
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
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      
      await supabase
        .from('profiles')
        .update({ 
          wallet_address: null, 
          wallet_chain: null,
          wallet_address_eth: null,
          wallet_address_sol: null,
        })
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

  // Full wallet dashboard with all features
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
