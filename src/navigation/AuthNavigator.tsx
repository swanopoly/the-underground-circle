import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import LandingPage from '../screens/auth/LandingPage';
import LoginScreen from '../screens/auth/LoginScreen';
import SignUpScreen from '../screens/auth/SignUpScreen';
import MemoryDeepDive from '../screens/auth/MemoryDeepDive';

const Stack = createNativeStackNavigator();

function LandingWrapper({ navigation }: any) {
  return (
    <LandingPage
      onLogin={() => navigation.navigate('Login')}
      onSignUp={() => navigation.navigate('SignUp')}
      onMemoryDeepDive={() => navigation.navigate('MemoryDeepDive')}
    />
  );
}

function MemoryDeepDiveWrapper({ navigation }: any) {
  return (
    <MemoryDeepDive
      onBack={() => navigation.goBack()}
      onSignUp={() => navigation.navigate('SignUp')}
    />
  );
}

export default function AuthNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Landing" component={LandingWrapper} />
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="SignUp" component={SignUpScreen} />
      <Stack.Screen name="MemoryDeepDive" component={MemoryDeepDiveWrapper} />
    </Stack.Navigator>
  );
}
