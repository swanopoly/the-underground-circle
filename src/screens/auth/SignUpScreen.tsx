import React, { Suspense, lazy, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { showAlert } from '../../lib/alert';
import { validateUsername, validateEmail, validatePassword, sanitizeString, LENGTH_LIMITS } from '../../lib/validation';
import { signInWithGoogle, readOAuthErrorFromUrl } from '../../lib/googleCreds';
import ErrorBoundary from '../../components/ErrorBoundary';

// Same 3D backdrop as the login screen — keeps the auth flow visually
// continuous instead of bouncing between three different surfaces.
const LoginBackground3D = lazy(() => import('../../components/LoginBackground3D'));

const ACCENT = '#b8ff61';
const ACCENT_STRONG = '#9be234';
const CARD_BG = 'rgba(11, 15, 12, 0.55)';
const CARD_BORDER = 'rgba(184, 255, 97, 0.18)';

export default function SignUpScreen({ navigation }: any) {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const oauthError = readOAuthErrorFromUrl();
    if (oauthError) setError(oauthError);
  }, []);

  const handleSignUp = async () => {
    setError('');
    const sanitizedUsername = sanitizeString(username, LENGTH_LIMITS.username.max);
    const sanitizedEmail = sanitizeString(email, LENGTH_LIMITS.email.max).toLowerCase();
    if (!sanitizedUsername || !sanitizedEmail || !password) {
      setError('Fill in everything');
      return;
    }
    const usernameValidation = validateUsername(sanitizedUsername);
    if (!usernameValidation.isValid) { setError(usernameValidation.error!); return; }
    const emailValidation = validateEmail(sanitizedEmail);
    if (!emailValidation.isValid) { setError(emailValidation.error!); return; }
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.isValid) { setError(passwordValidation.error!); return; }

    setLoading(true);
    try {
      // signUp can THROW (network/AbortError) — without the finally, a throw
      // left `loading` stuck true and the CTA permanently disabled.
      const { error: signUpError } = await supabase.auth.signUp({
        email: sanitizedEmail,
        password,
        options: { data: { username: sanitizedUsername, display_name: sanitizedUsername } },
      });
      if (signUpError) {
        setError(signUpError.message);
        return;
      }
      showAlert('Welcome to the Circle', 'Check your email to verify, then log in.');
      navigation.navigate('Login');
    } catch {
      setError('Sign-up failed to reach the server. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.root}>
        {Platform.OS === 'web' && (
          <ErrorBoundary scope="signup-background" fallback={null}>
            <Suspense fallback={null}>
              <LoginBackground3D />
            </Suspense>
          </ErrorBoundary>
        )}
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={styles.card}>
            <View style={styles.header}>
              <View style={styles.logoCircle}>
                <Text style={styles.logoGlyph}>+</Text>
              </View>
              <Text style={styles.kicker}>JOIN THE</Text>
              <Text style={styles.title}>CIRCLE</Text>
              <Text style={styles.subtitle}>No spectators. Only grinders.</Text>
            </View>

            {error ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <View style={styles.field}>
              <Text style={styles.label}>USERNAME</Text>
              <View style={styles.inputShell}>
                <TextInput
                  style={styles.input}
                  placeholder="grinder42"
                  placeholderTextColor="rgba(184, 255, 97, 0.25)"
                  value={username}
                  onChangeText={(text) => setUsername(text.slice(0, LENGTH_LIMITS.username.max))}
                  autoCapitalize="none"
                  maxLength={LENGTH_LIMITS.username.max}
                />
              </View>
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>EMAIL</Text>
              <View style={styles.inputShell}>
                <TextInput
                  style={styles.input}
                  placeholder="you@domain.com"
                  placeholderTextColor="rgba(184, 255, 97, 0.25)"
                  value={email}
                  onChangeText={(text) => setEmail(text.slice(0, LENGTH_LIMITS.email.max))}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  maxLength={LENGTH_LIMITS.email.max}
                />
              </View>
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>PASSWORD</Text>
              <View style={styles.inputShell}>
                <TextInput
                  style={styles.input}
                  placeholder="••••••••"
                  placeholderTextColor="rgba(184, 255, 97, 0.25)"
                  value={password}
                  onChangeText={(text) => setPassword(text.slice(0, LENGTH_LIMITS.password.max))}
                  secureTextEntry
                  maxLength={LENGTH_LIMITS.password.max}
                />
              </View>
            </View>

            <Pressable
              onPress={handleSignUp}
              disabled={loading}
              style={({ hovered, pressed }: any) => [
                styles.cta,
                loading && styles.ctaDisabled,
                hovered && !loading && { backgroundColor: ACCENT_STRONG, borderColor: ACCENT_STRONG },
                pressed && { transform: [{ scale: 0.98 }] },
              ]}
            >
              {loading ? (
                <ActivityIndicator size="small" color="#0b1220" />
              ) : (
                <Text style={styles.ctaText}>JOIN UP</Text>
              )}
            </Pressable>

            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>OR</Text>
              <View style={styles.dividerLine} />
            </View>

            <Pressable
              onPress={async () => {
                if (googleLoading) return;
                setError('');
                setGoogleLoading(true);
                try {
                  const { ok, reason } = await signInWithGoogle();
                  if (!ok) {
                    setGoogleLoading(false);
                    if (reason) setError(reason);
                  }
                } catch {
                  setGoogleLoading(false);
                  setError('Could not start Google sign-in. Try again.');
                }
              }}
              disabled={loading || googleLoading}
              style={({ hovered }: any) => [
                styles.googleBtn,
                (loading || googleLoading) && styles.ctaDisabled,
                hovered && !loading && !googleLoading && { borderColor: 'rgba(184, 255, 97, 0.45)', backgroundColor: 'rgba(184, 255, 97, 0.05)' },
              ]}
            >
              <Text style={styles.googleBtnText}>
                {googleLoading ? 'Redirecting to Google…' : 'Continue with Google'}
              </Text>
            </Pressable>

            <Pressable onPress={() => navigation.navigate('Login')} style={styles.linkBtn}>
              <Text style={styles.linkText}>
                Already in? <Text style={styles.linkBold}>Log in.</Text>
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 40,
    position: 'relative',
    zIndex: 1,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    backgroundColor: CARD_BG,
    paddingHorizontal: 28,
    paddingVertical: 32,
    gap: 16,
    ...(Platform.select({
      web: {
        backdropFilter: 'blur(10px)',
        boxShadow: '0 24px 64px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(184, 255, 97, 0.05) inset',
      },
      default: {},
    }) as any),
  },
  header: {
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  logoCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(184, 255, 97, 0.3)',
    backgroundColor: 'rgba(184, 255, 97, 0.08)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  logoGlyph: {
    color: ACCENT,
    fontSize: 26,
    fontWeight: '900',
    lineHeight: 28,
  },
  kicker: {
    color: 'rgba(184, 255, 97, 0.65)',
    fontSize: 11,
    letterSpacing: 4,
    fontWeight: '800',
  },
  title: {
    color: '#f5f7f2',
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: 2,
    textAlign: 'center',
  },
  subtitle: {
    color: '#9ca89c',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginTop: 4,
    fontStyle: 'italic',
  },
  errorBox: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 102, 102, 0.26)',
    backgroundColor: 'rgba(122, 24, 24, 0.34)',
  },
  errorText: {
    color: '#ff9a9a',
    fontSize: 13,
    textAlign: 'center',
  },
  field: {
    alignItems: 'center',
    gap: 6,
  },
  label: {
    color: 'rgba(184, 255, 97, 0.55)',
    fontSize: 10,
    letterSpacing: 2.4,
    fontWeight: '900',
    fontFamily: Platform.select({ web: 'ui-monospace, "SF Mono", Menlo, monospace', default: 'monospace' }),
  },
  inputShell: {
    width: 280,
    maxWidth: '100%',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(184, 255, 97, 0.22)',
    backgroundColor: 'rgba(8, 12, 9, 0.55)',
    ...(Platform.select({
      web: { transition: 'border-color 0.18s ease' },
      default: {},
    }) as any),
  },
  input: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    color: '#f5f7f2',
    fontSize: 14,
    ...(Platform.select({
      web: { outlineStyle: 'none' } as any,
      default: {},
    }) as any),
  },
  cta: {
    alignSelf: 'center',
    width: 280,
    maxWidth: '100%',
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: ACCENT,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    ...(Platform.select({
      web: { cursor: 'pointer', transition: 'background-color 0.15s ease, border-color 0.15s ease, transform 0.1s ease' },
      default: {},
    }) as any),
  },
  ctaDisabled: {
    opacity: 0.6,
  },
  ctaText: {
    color: '#0b1220',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 2,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    width: 280,
    maxWidth: '100%',
    alignSelf: 'center',
    marginVertical: 4,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(184, 255, 97, 0.12)',
  },
  dividerText: {
    color: 'rgba(184, 255, 97, 0.4)',
    fontSize: 10,
    letterSpacing: 2,
    fontWeight: '800',
    fontFamily: Platform.select({ web: 'ui-monospace, "SF Mono", Menlo, monospace', default: 'monospace' }),
  },
  googleBtn: {
    alignSelf: 'center',
    width: 280,
    maxWidth: '100%',
    paddingVertical: 11,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(184, 255, 97, 0.22)',
    backgroundColor: 'rgba(8, 12, 9, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    ...(Platform.select({
      web: { cursor: 'pointer', transition: 'border-color 0.15s ease, background-color 0.15s ease' },
      default: {},
    }) as any),
  },
  googleBtnText: {
    color: '#d4e0ce',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.6,
  },
  linkBtn: {
    alignSelf: 'center',
    paddingVertical: 6,
    marginTop: 4,
  },
  linkText: {
    color: '#7c8c7c',
    textAlign: 'center',
    fontSize: 13,
  },
  linkBold: {
    color: ACCENT,
    fontWeight: '800',
  },
});
