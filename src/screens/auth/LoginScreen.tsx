import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
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
        <Text style={styles.title}>THE</Text>
        <Text style={styles.titleBold}>UNDERGROUND</Text>
        <Text style={styles.titleBold}>CIRCLE</Text>
        <Text style={styles.subtitle}>Built for people who actually work.</Text>

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor="#666"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor="#666"
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

        {showSSO ? (
          <View style={styles.ssoSection}>
            <TextInput
              style={styles.input}
              placeholder="company.com"
              placeholderTextColor="#666"
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

        <TouchableOpacity onPress={() => navigation.navigate('SignUp')}>
          <Text style={styles.linkText}>
            No account? <Text style={styles.linkBold}>Join the circle.</Text>
          </Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  inner: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  title: {
    color: '#fff',
    fontSize: 18,
    letterSpacing: 6,
    textAlign: 'center',
  },
  titleBold: {
    color: '#fff',
    fontSize: 32,
    fontWeight: '900',
    letterSpacing: 4,
    textAlign: 'center',
  },
  subtitle: {
    color: '#888',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 48,
    fontStyle: 'italic',
  },
  errorBox: {
    backgroundColor: '#2a1515',
    borderWidth: 1,
    borderColor: '#4a2020',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  errorText: {
    color: '#ff6666',
    fontSize: 13,
    textAlign: 'center',
  },
  input: {
    backgroundColor: '#000000',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 8,
    padding: 16,
    color: '#fff',
    fontSize: 16,
    marginBottom: 16,
  },
  button: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 24,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: '#0a0a0a',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 2,
  },
  linkText: {
    color: '#666',
    textAlign: 'center',
    fontSize: 14,
    marginTop: 8,
  },
  linkBold: {
    color: '#fff',
    fontWeight: '700',
  },
  ssoSection: {
    marginBottom: 16,
  },
  ssoButton: {
    backgroundColor: '#2a2a2a',
    borderWidth: 1,
    borderColor: '#6366f140',
    borderRadius: 8,
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
    marginBottom: 16,
  },
  ssoLinkText: {
    color: '#6366f1',
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 16,
  },
});
