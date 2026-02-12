import React, { useState, useEffect } from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { supabase } from '../lib/supabase';
import CirclesScreen from '../screens/circles/CirclesScreen';
import CreateCircleScreen from '../screens/circles/CreateCircleScreen';
import JoinCircleScreen from '../screens/circles/JoinCircleScreen';
import CircleDetailScreen from '../screens/circles/CircleDetailScreen';
import ProfileScreen from '../screens/profile/ProfileScreen';
import ConnectWalletScreen from '../screens/wallet/ConnectWalletScreen';
import WalletDashboard from '../screens/wallet/WalletDashboard';

const Tab = createBottomTabNavigator();
const CirclesStack = createNativeStackNavigator();

function CirclesNavigator() {
  return (
    <CirclesStack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#0a0a0a' },
      }}
    >
      <CirclesStack.Screen name="CirclesList" component={CirclesScreen} />
      <CirclesStack.Screen name="CreateCircle" component={CreateCircleScreen} />
      <CirclesStack.Screen name="JoinCircle" component={JoinCircleScreen} />
      <CirclesStack.Screen name="CircleDetail" component={CircleDetailScreen} />
    </CirclesStack.Navigator>
  );
}

function WalletScreen() {
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletChain, setWalletChain] = useState<string>('ethereum');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkWallet();
  }, []);

  const checkWallet = async () => {
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
    setLoading(false);
  };

  if (loading) return null;

  if (!walletAddress) {
    return (
      <ConnectWalletScreen
        onComplete={() => checkWallet()}
      />
    );
  }

  return <WalletDashboard walletAddress={walletAddress} chain={walletChain} />;
}

export default function MainNavigator() {
  const [showWalletPrompt, setShowWalletPrompt] = useState(true);

  useEffect(() => {
    checkIfWalletConnected();
  }, []);

  const checkIfWalletConnected = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from('profiles')
      .select('wallet_address')
      .eq('id', user.id)
      .single();
    if (data?.wallet_address) {
      setShowWalletPrompt(false);
    }
  };

  if (showWalletPrompt) {
    return <ConnectWalletScreen onComplete={() => setShowWalletPrompt(false)} />;
  }

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#0a0a0a',
          borderTopColor: '#1a1a1a',
          borderTopWidth: 1,
          paddingTop: 8,
          paddingBottom: 8,
          height: 60,
        },
        tabBarActiveTintColor: '#fff',
        tabBarInactiveTintColor: '#555',
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '700',
          letterSpacing: 1,
        },
      }}
    >
      <Tab.Screen
        name="Circles"
        component={CirclesNavigator}
        options={{ tabBarLabel: 'CIRCLES' }}
      />
      <Tab.Screen
        name="Wallet"
        component={WalletScreen}
        options={{ tabBarLabel: 'WALLET' }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{ tabBarLabel: 'PROFILE' }}
      />
    </Tab.Navigator>
  );
}
