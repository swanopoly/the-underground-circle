import React, { Suspense } from 'react';
import { View, StyleSheet } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

const Stack = createNativeStackNavigator();

const LoginScreen = React.lazy(() => import('../screens/auth/LoginScreen'));
const SignUpScreen = React.lazy(() => import('../screens/auth/SignUpScreen'));
const LandingPage = React.lazy(() => import('../screens/auth/LandingPage'));

function AuthFallback() {
  return <View style={styles.fallback} />;
}

function withSuspense(Component: React.ComponentType<any>) {
  return function SuspendedAuthScreen(props: any) {
    return (
      <Suspense fallback={<AuthFallback />}>
        <Component {...props} />
      </Suspense>
    );
  };
}

const Login = withSuspense(LoginScreen);
const SignUp = withSuspense(SignUpScreen);

function LandingWrapper({ navigation }: any) {
  return (
    <Suspense fallback={<AuthFallback />}>
      <LandingPage
        onLogin={() => navigation.navigate('Login')}
        onSignUp={() => navigation.navigate('SignUp')}
      />
    </Suspense>
  );
}

export default function AuthNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }} initialRouteName="Login">
      <Stack.Screen name="Login" component={Login} />
      <Stack.Screen name="Landing" component={LandingWrapper} />
      <Stack.Screen name="SignUp" component={SignUp} />
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  fallback: {
    flex: 1,
    backgroundColor: '#0A0A0A',
  },
});
