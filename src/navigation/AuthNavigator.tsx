import React, { Suspense } from 'react';
import { View, StyleSheet } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { WEB_MODULE_GRAPH_REVISION } from '../lib/webModuleRecoveryCore';

const Stack = createNativeStackNavigator();

const LoginScreen = React.lazy(() => import('../screens/auth/LoginScreen'));
const SignUpScreen = React.lazy(() => import('../screens/auth/SignUpScreen'));
const LandingPage = React.lazy(() => import('../screens/auth/LandingPage'));

function AuthFallback() {
  return <View style={styles.fallback} />;
}

function withSuspense(Component: React.ComponentType<any>, name: string) {
  function SuspendedAuthScreen(props: any) {
    return (
      <Suspense fallback={<AuthFallback />}>
        <Component {...props} />
      </Suspense>
    );
  }
  SuspendedAuthScreen.displayName = `Suspended${name}@${WEB_MODULE_GRAPH_REVISION}`;
  return SuspendedAuthScreen;
}

const Login = withSuspense(LoginScreen, 'Login');
const SignUp = withSuspense(SignUpScreen, 'SignUp');

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

type AuthNavigatorProps = {
  passwordRecovery?: boolean;
  onPasswordRecoveryComplete?: () => void;
};

export default function AuthNavigator({
  passwordRecovery = false,
  onPasswordRecoveryComplete,
}: AuthNavigatorProps) {
  return (
    <Stack.Navigator
      screenOptions={{ headerShown: false }}
      initialRouteName={passwordRecovery ? 'ResetPassword' : 'Login'}
    >
      <Stack.Screen name="Login" component={Login} />
      <Stack.Screen name="PasswordRecovery" component={Login} />
      <Stack.Screen name="ResetPassword">
        {(screenProps) => (
          <Login
            {...screenProps}
            onPasswordRecoveryComplete={onPasswordRecoveryComplete}
          />
        )}
      </Stack.Screen>
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
