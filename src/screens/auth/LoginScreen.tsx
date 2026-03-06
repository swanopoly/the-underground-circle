import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { signInWithSSO } from '../../lib/sso';

export default function LoginScreen({ navigation }: any) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showSSO, setShowSSO] = useState(false);
  const [ssoDomain, setSsoDomain] = useState('');
  const { width } = useWindowDimensions();
  const isWide = width > 500;

  const handleLogin = async () => {
    setError('');
    if (!email || !password) {
      setError('Fill in both fields');
      return;
    }
    setLoading(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (signInError) setError(signInError.message);
  };

  const handleSSO = async () => {
    if (!ssoDomain.trim()) {
      setError('Enter your company domain');
      return;
    }
    setLoading(true);
    const { error: ssoError } = await signInWithSSO(ssoDomain.trim());
    setLoading(false);
    if (ssoError) setError(ssoError);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.inner}>
        <View style={[styles.card, isWide && styles.cardWide]}>
          <View style={styles.logoSection}>
            <View style={styles.logoCircle}>
              <Text style={styles.logoText}>UC</Text>
            </View>
            <Text style={styles.title}>THE</Text>
            <Text style={styles.titleBold}>UNDERGROUND</Text>
            <Text style={styles.titleBold}>CIRCLE</Text>
            <Text style={styles.subtitle}>Built for people who actually work.</Text>
          </View>

          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <View style={styles.form}>
            <Text style={styles.inputLabel}>EMAIL</Text>
            <TextInput
              style={styles.input}
              placeholder="you@email.com"
              placeholderTextColor="#444"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
            />
            <Text style={styles.inputLabel}>PASSWORD</Text>
            <TextInput
              style={styles.input}
              placeholder="••••••••"
              placeholderTextColor="#444"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />

            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={handleLogin}
              disabled={loading}
            >
              <Text style={styles.buttonText}>
                {loading ? 'GETTING IN...' : 'GET IN'}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.divider} />

          {showSSO ? (
            <View style={styles.ssoSection}>
              <TextInput
                style={styles.input}
                placeholder="company.com"
                placeholderTextColor="#444"
                value={ssoDomain}
                onChangeText={setSsoDomain}
                autoCapitalize="none"
              />
              <TouchableOpacity
                style={styles.ssoButton}
                onPress={handleSSO}
                disabled={loading}
              >
                <Text style={styles.ssoButtonText}>
                  {loading ? 'REDIRECTING...' : 'SIGN IN WITH SSO'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setShowSSO(false)}>
                <Text style={styles.ssoBackText}>← Back to email login</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity onPress={() => setShowSSO(true)}>
              <Text style={styles.ssoLinkText}>Sign in with SSO</Text>
            </TouchableOpacity>
          )}

          <View style={styles.dividerSmall} />

          <TouchableOpacity onPress={() => navigation.navigate('SignUp')}>
            <Text style={styles.linkText}>
              No account? <Text style={styles.linkBold}>Join the circle.</Text>
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  inner: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#111',
    borderRadius: 16,
    padding: 32,
    borderWidth: 1,
    borderColor: '#222',
  },
  cardWide: {
    padding: 40,
  },
  logoSection: {
    alignItems: 'center',
    marginBottom: 32,
  },
  logoCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 2,
    borderColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  logoText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: 2,
  },
  title: {
    color: '#666',
    fontSize: 13,
    letterSpacing: 6,
    textAlign: 'center',
  },
  titleBold: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: 3,
    textAlign: 'center',
    lineHeight: 30,
  },
  subtitle: {
    color: '#555',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 10,
    fontStyle: 'italic',
  },
  errorBox: {
    backgroundColor: '#2a1515',
    borderWidth: 1,
    borderColor: '#4a2020',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  errorText: {
    color: '#ff6666',
    fontSize: 13,
    textAlign: 'center',
  },
  form: {
    marginBottom: 24,
  },
  inputLabel: {
    color: '#666',
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: '700',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#0a0a0a',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 10,
    padding: 14,
    color: '#fff',
    fontSize: 15,
    marginBottom: 16,
  },
  button: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 15,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: '#0a0a0a',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 2,
  },
  divider: {
    height: 1,
    backgroundColor: '#222',
    marginBottom: 20,
  },
  linkText: {
    color: '#555',
    textAlign: 'center',
    fontSize: 14,
  },
  linkBold: {
    color: '#fff',
    fontWeight: '700',
  },
  ssoSection: {
    marginBottom: 16,
  },
  ssoButton: {
    backgroundColor: '#1a1a2e',
    borderWidth: 1,
    borderColor: '#6366f140',
    borderRadius: 10,
    padding: 15,
    alignItems: 'center',
    marginBottom: 12,
  },
  ssoButtonText: {
    color: '#6366f1',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1,
  },
  ssoBackText: {
    color: '#555',
    textAlign: 'center',
    fontSize: 13,
  },
  ssoLinkText: {
    color: '#6366f1',
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 16,
  },
  dividerSmall: {
    height: 1,
    backgroundColor: '#222',
    marginBottom: 16,
  },
});
