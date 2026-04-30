import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import LandingPage from '../screens/auth/LandingPage';
import LoginScreen from '../screens/auth/LoginScreen';
import SignUpScreen from '../screens/auth/SignUpScreen';

const Stack = createNativeStackNavigator();

function LandingWrapper({ navigation }: any) {
  return (
    <LandingPage
      onLogin={() => navigation.navigate('Login')}
      onSignUp={() => navigation.navigate('SignUp')}
    />
  );
}

export default function AuthNavigator() {
  return (
    // Initial route is Login so unauthenticated visitors land on the
    // login form directly. Landing stays registered so anyone deep-
    // linked to /landing or referred via existing links still resolves;
    // it's just no longer the default entry point.
    <Stack.Navigator screenOptions={{ headerShown: false }} initialRouteName="Login">
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="Landing" component={LandingWrapper} />
      <Stack.Screen name="SignUp" component={SignUpScreen} />
    </Stack.Navigator>
  );
}
