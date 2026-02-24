import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import CirclesScreen from '../screens/circles/CirclesScreen';
import CreateCircleScreen from '../screens/circles/CreateCircleScreen';
import JoinCircleScreen from '../screens/circles/JoinCircleScreen';
import CircleDetailScreen from '../screens/circles/CircleDetailScreen';
import CircleSettingsScreen from '../screens/circles/CircleSettingsScreen';
import EditProfileScreen from '../screens/profile/EditProfileScreen';
import FriendsScreen from '../screens/friends/FriendsScreen';
import DMScreen from '../screens/friends/DMScreen';
import AgentsScreen from '../screens/agents/AgentsScreen';
import IntegrationsScreen from '../screens/integrations/IntegrationsScreen';

const Stack = createNativeStackNavigator();

export default function MainNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#0a0a0a' },
      }}
    >
      <Stack.Screen name="CirclesList" component={CirclesScreen} />
      <Stack.Screen name="CreateCircle" component={CreateCircleScreen} />
      <Stack.Screen name="JoinCircle" component={JoinCircleScreen} />
      <Stack.Screen name="CircleDetail" component={CircleDetailScreen} />
      <Stack.Screen name="CircleSettings" component={CircleSettingsScreen} />
      {/* Profile sub-screens (navigated from Profile tab inside circles) */}
      <Stack.Screen name="EditProfile" component={EditProfileScreen} />
      <Stack.Screen name="Friends" component={FriendsScreen} />
      <Stack.Screen name="DMScreen" component={DMScreen} />
      <Stack.Screen name="Agents" component={AgentsScreen} />
      <Stack.Screen name="Integrations" component={IntegrationsScreen} />
    </Stack.Navigator>
  );
}
