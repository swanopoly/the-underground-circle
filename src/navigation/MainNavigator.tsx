import React, { useState, useEffect } from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { View, Text, Platform } from 'react-native';
import { supabase } from '../lib/supabase';
import CirclesScreen from '../screens/circles/CirclesScreen';
import CreateCircleScreen from '../screens/circles/CreateCircleScreen';
import JoinCircleScreen from '../screens/circles/JoinCircleScreen';
import CircleDetailScreen from '../screens/circles/CircleDetailScreen';
import CircleSettingsScreen from '../screens/circles/CircleSettingsScreen';
import ProfileScreen from '../screens/profile/ProfileScreen';
import EditProfileScreen from '../screens/profile/EditProfileScreen';
import FriendsScreen from '../screens/friends/FriendsScreen';
import DMScreen from '../screens/friends/DMScreen';
import AgentsScreen from '../screens/agents/AgentsScreen';
import IntegrationsScreen from '../screens/integrations/IntegrationsScreen';
import ConnectWalletScreen from '../screens/wallet/ConnectWalletScreen';
import WalletDashboard from '../screens/wallet/WalletDashboard';

const Tab = createBottomTabNavigator();
const CirclesStack = createNativeStackNavigator();
const ProfileStack = createNativeStackNavigator();

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
      <CirclesStack.Screen name="CircleSettings" component={CircleSettingsScreen} />
    </CirclesStack.Navigator>
  );
}

function ProfileNavigator() {
  return (
    <ProfileStack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#0a0a0a' },
      }}
    >
      <ProfileStack.Screen name="ProfileMain" component={ProfileScreen} />
      <ProfileStack.Screen name="EditProfile" component={EditProfileScreen} />
      <ProfileStack.Screen name="Friends" component={FriendsScreen} />
      <ProfileStack.Screen name="DMScreen" component={DMScreen} />
      <ProfileStack.Screen name="Agents" component={AgentsScreen} />
      <ProfileStack.Screen name="Integrations" component={IntegrationsScreen} />
    </ProfileStack.Navigator>
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
      // wallet columns may not exist yet — that's fine
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

function TabIcon({ emoji, label, focused, color }: { emoji: string; label: string; focused: boolean; color: string }) {
  return (
    <View style={{
      alignItems: 'center',
      justifyContent: 'center',
      paddingTop: 6,
      minWidth: 64,
      minHeight: 48,
    }}
    accessibilityRole="tab"
    accessibilityLabel={label}
    accessibilityState={{ selected: focused }}
    >
      {focused && (
        <View style={{
          position: 'absolute',
          top: 2,
          width: 48,
          height: 40,
          borderRadius: 12,
          backgroundColor: color === '#fff' ? '#ffffff18' : color + '18',
        }} />
      )}
      <Text style={{ fontSize: 22, marginBottom: 2 }}>{emoji}</Text>
      <Text style={{
        fontSize: 11,
        fontWeight: focused ? '800' : '600',
        letterSpacing: 1,
        color: focused ? '#fff' : '#888',
      }}>
        {label}
      </Text>
    </View>
  );
}

export default function MainNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#0a0a0a',
          borderTopColor: '#1a1a1a',
          borderTopWidth: 1,
          paddingTop: 4,
          paddingBottom: Platform.OS === 'ios' ? 24 : 8,
          height: Platform.OS === 'ios' ? 88 : 72,
        },
        tabBarActiveTintColor: '#fff',
        tabBarInactiveTintColor: '#888',
        tabBarShowLabel: false,
      }}
    >
      <Tab.Screen
        name="Circles"
        component={CirclesNavigator}
        options={{
          tabBarIcon: ({ focused, color }) => (
            <TabIcon emoji="⭕" label="CIRCLES" focused={focused} color={color} />
          ),
          tabBarAccessibilityLabel: 'Circles tab',
        }}
      />
      <Tab.Screen
        name="Wallet"
        component={WalletScreen}
        options={{
          tabBarIcon: ({ focused, color }) => (
            <TabIcon emoji="💰" label="WALLET" focused={focused} color={color} />
          ),
          tabBarAccessibilityLabel: 'Wallet tab',
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileNavigator}
        options={{
          tabBarIcon: ({ focused, color }) => (
            <TabIcon emoji="👤" label="PROFILE" focused={focused} color={color} />
          ),
          tabBarAccessibilityLabel: 'Profile tab',
        }}
      />
    </Tab.Navigator>
  );
}
