import React, { useEffect, useState } from 'react';
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
import { showAlert } from '../../lib/alert';
import { validateUsername, validateEmail, validatePassword, sanitizeString, LENGTH_LIMITS } from '../../lib/validation';
import { signInWithGoogle, readOAuthErrorFromUrl } from '../../lib/googleCreds';

export default function SignUpScreen({ navigation }: any) {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState('');

  // Surface OAuth errors that Google / Supabase left in the URL after
  // a failed redirect. Without this users bounce back to a clean form
  // with no idea what went wrong.
  useEffect(() => {
    const oauthError = readOAuthErrorFromUrl();
    if (oauthError) setError(oauthError);
  }, []);

  const handleSignUp = async () => {
    setError('');

    // Sanitize and validate inputs
    const sanitizedUsername = sanitizeString(username, LENGTH_LIMITS.username.max);
    const sanitizedEmail = sanitizeString(email, LENGTH_LIMITS.email.max).toLowerCase();

    if (!sanitizedUsername || !sanitizedEmail || !password) {
      setError('Fill in everything');
      return;
    }

    // Validate username
    const usernameValidation = validateUsername(sanitizedUsername);
    if (!usernameValidation.isValid) {
      setError(usernameValidation.error!);
      return;
    }

    // Validate email
    const emailValidation = validateEmail(sanitizedEmail);
    if (!emailValidation.isValid) {
      setError(emailValidation.error!);
      return;
    }

    // Validate password
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.isValid) {
      setError(passwordValidation.error!);
      return;
    }

    setLoading(true);
    const { error: signUpError } = await supabase.auth.signUp({
      email: sanitizedEmail,
      password,
      options: { data: { username: sanitizedUsername, display_name: sanitizedUsername } },
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
        <Text style={styles.title}>JOIN THE</Text>
        <Text style={styles.titleBold}>CIRCLE</Text>
        <Text style={styles.subtitle}>No spectators. Only grinders.</Text>

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <TextInput
          style={styles.input}
          placeholder="Username"
          placeholderTextColor="#666"
          value={username}
          onChangeText={(text) => setUsername(text.slice(0, LENGTH_LIMITS.username.max))}
          autoCapitalize="none"
          maxLength={LENGTH_LIMITS.username.max}
        />
        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor="#666"
          value={email}
          onChangeText={(text) => setEmail(text.slice(0, LENGTH_LIMITS.email.max))}
          autoCapitalize="none"
          keyboardType="email-address"
          maxLength={LENGTH_LIMITS.email.max}
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor="#666"
          value={password}
          onChangeText={(text) => setPassword(text.slice(0, LENGTH_LIMITS.password.max))}
          secureTextEntry
          maxLength={LENGTH_LIMITS.password.max}
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

        {/* Continue with Google — handles BOTH sign-in and sign-up.
            Supabase auto-creates a user row on first OAuth callback so
            new users land here, click once, and are signed in.
            Identity scopes only at sign-up time; Workspace scopes
            (Gmail/Calendar/Drive) get prompted later in Settings to
            avoid the giant first-touch consent sheet that drove drop-
            off. */}
        <TouchableOpacity
          style={[styles.googleButton, (loading || googleLoading) && styles.buttonDisabled]}
          disabled={loading || googleLoading}
          onPress={async () => {
            if (googleLoading) return;
            setError('');
            setGoogleLoading(true);
            const { ok, reason } = await signInWithGoogle();
            if (!ok) {
              setGoogleLoading(false);
              if (reason) setError(reason);
            }
            // If ok, Supabase has already triggered the redirect to
            // Google. Leave googleLoading on so the button stays
            // disabled until navigation completes.
          }}
        >
          <Text style={styles.googleButtonText}>
            {googleLoading ? 'Redirecting to Google…' : 'Continue with Google'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.navigate('Login')}>
          <Text style={styles.linkText}>
            Already in? <Text style={styles.linkBold}>Log in.</Text>
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
    fontSize: 36,
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
  googleButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#3c3c3c',
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
    marginBottom: 16,
    marginTop: -8,
  },
  googleButtonText: {
    color: '#d4d4d4',
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 1,
  },
  linkText: {
    color: '#666',
    textAlign: 'center',
    fontSize: 14,
  },
  linkBold: {
    color: '#fff',
    fontWeight: '700',
  },
});
