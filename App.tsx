import React from 'react';
import { StatusBar } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { useAuth } from './src/hooks/useAuth';
import AuthNavigator from './src/navigation/AuthNavigator';
import MainNavigator from './src/navigation/MainNavigator';

export default function App() {
  const { session, loading } = useAuth();

  if (loading) {
    return null; // TODO: splash screen
  }

  return (
    <NavigationContainer>
      <StatusBar barStyle="light-content" backgroundColor="#0a0a0a" />
      {session ? <MainNavigator /> : <AuthNavigator />}
    </NavigationContainer>
  );
}
