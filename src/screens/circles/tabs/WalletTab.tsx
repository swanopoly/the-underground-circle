import React, { useState, useEffect } from 'react';
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

  if (loading) return null;

  if (!walletAddress) {
    return <ConnectWalletScreen onComplete={() => checkWallet()} />;
  }

  return (
    <WalletDashboard
      walletAddress={walletAddress}
      chain={walletChain}
      onDisconnect={() => {
        setWalletAddress(null);
        setWalletChain('ethereum');
      }}
    />
  );
}
