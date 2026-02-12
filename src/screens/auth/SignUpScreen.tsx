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
import { showAlert } from '../../lib/alert';

export default function SignUpScreen({ navigation }: any) {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { width } = useWindowDimensions();
  const isWide = width > 500;

  const handleSignUp = async () => {
    setError('');
    if (!username || !email || !password) {
      setError('Fill in everything');
      return;
    }
    if (password.length < 6) {
      setError('Password needs at least 6 characters');
      return;
    }
    setLoading(true);
    const { error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { username, display_name: username } },
    });
    setLoading(false);
    if (signUpError) {
      setError(signUpError.message);
      return;
    }
    showAlert('Welcome to the Circle', 'Check your email to verify, then log in.');
    navigation.navigate('Login');
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.inner}>
        <View style={[styles.card, isWide && styles.cardWide]}>
          <View style={styles.headerSection}>
            <View style={styles.logoCircle}>
              <Text style={styles.logoText}>UC</Text>
            </View>
            <Text style={styles.title}>JOIN THE</Text>
            <Text style={styles.titleBold}>CIRCLE</Text>
            <Text style={styles.subtitle}>No spectators. Only grinders.</Text>
          </View>

          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <View style={styles.form}>
            <Text style={styles.inputLabel}>USERNAME</Text>
            <TextInput
              style={styles.input}
              placeholder="your_name"
              placeholderTextColor="#444"
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
            />
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
              onPress={handleSignUp}
              disabled={loading}
            >
              <Text style={styles.buttonText}>
                {loading ? 'JOINING...' : 'JOIN UP'}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.divider} />

          <TouchableOpacity onPress={() => navigation.navigate('Login')}>
            <Text style={styles.linkText}>
              Already in? <Text style={styles.linkBold}>Log in.</Text>
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
  headerSection: {
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
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: 3,
    textAlign: 'center',
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
});
