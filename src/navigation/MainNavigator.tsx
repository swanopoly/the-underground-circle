import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import CirclesScreen from '../screens/circles/CirclesScreen';
import CreateCircleScreen from '../screens/circles/CreateCircleScreen';
import JoinCircleScreen from '../screens/circles/JoinCircleScreen';
import CheckInScreen from '../screens/checkin/CheckInScreen';
import ProfileScreen from '../screens/profile/ProfileScreen';

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
      <CirclesStack.Screen name="CircleDetail" component={CheckInScreen} />
    </CirclesStack.Navigator>
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
        options={{
          tabBarLabel: 'CIRCLES',
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          tabBarLabel: 'PROFILE',
        }}
      />
    </Tab.Navigator>
  );
}
