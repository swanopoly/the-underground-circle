import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { signInWithSSO } from '../../lib/sso';

const ACCENT = '#b8ff61';
const ACCENT_STRONG = '#9be234';
const CARD_BG = 'rgba(11, 15, 12, 0.88)';
const CARD_BORDER = 'rgba(184, 255, 97, 0.18)';

type FocusField = 'email' | 'password' | 'sso' | null;
type HoverAction = 'login' | 'showSso' | 'submitSso' | 'backToEmail' | 'signup' | null;

export default function LoginScreen({ navigation }: any) {
  const { width } = useWindowDimensions();
  const isDesktop = width >= 980;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showSSO, setShowSSO] = useState(false);
  const [ssoDomain, setSsoDomain] = useState('');
  const [focusedField, setFocusedField] = useState<FocusField>(null);
  const [hoveredAction, setHoveredAction] = useState<HoverAction>(null);

  const handleLogin = async () => {
    setError('');
    if (!email || !password) {
      setError('Fill in both fields.');
      return;
    }

    setLoading(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);

    if (signInError) {
      setError(signInError.message);
    }
  };

  const handleSSO = async () => {
    setError('');
    if (!ssoDomain.trim()) {
      setError('Enter your company domain.');
      return;
    }

    setLoading(true);
    const { error: ssoError } = await signInWithSSO(ssoDomain.trim());
    setLoading(false);

    if (ssoError) {
      setError(ssoError);
    }
  };

  const renderInput = ({
    label,
    value,
    onChangeText,
    placeholder,
    focusKey,
    secureTextEntry,
    keyboardType,
  }: {
    label: string;
    value: string;
    onChangeText: (text: string) => void;
    placeholder: string;
    focusKey: Exclude<FocusField, null>;
    secureTextEntry?: boolean;
    keyboardType?: 'default' | 'email-address';
  }) => (
    <View style={[styles.fieldShell, focusedField === focusKey && styles.fieldShellFocused]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        placeholder={placeholder}
        placeholderTextColor="#5f695f"
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setFocusedField(focusKey)}
        onBlur={() => setFocusedField((current) => (current === focusKey ? null : current))}
        autoCapitalize="none"
        keyboardType={keyboardType}
        secureTextEntry={secureTextEntry}
      />
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.container}>
        <View style={[styles.ambientOrb, styles.orbA]} />
        <View style={[styles.ambientOrb, styles.orbB]} />
        <View style={[styles.gridGlow, styles.gridGlowLeft]} />
        <View style={[styles.gridGlow, styles.gridGlowRight]} />

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.shell, isDesktop && styles.shellDesktop]}>
            <View style={[styles.heroPanel, isDesktop && styles.heroPanelDesktop]}>
              <Text style={styles.heroEyebrow}>UNDERGROUND ACCESS</Text>
              <Text style={styles.heroTitleTop}>The</Text>
              <Text style={styles.heroTitle}>Underground</Text>
              <Text style={styles.heroTitle}>Circle</Text>
              <Text style={styles.heroSubtitle}>
                Focused tools for people shipping real work, not floating in tabs all day.
              </Text>

              <View style={[styles.statRow, isDesktop && styles.statRowDesktop]}>
                <View style={styles.statChip}>
                  <Text style={styles.statValue}>Tighter</Text>
                  <Text style={styles.statLabel}>circles</Text>
                </View>
                <View style={styles.statChip}>
                  <Text style={styles.statValue}>Live</Text>
                  <Text style={styles.statLabel}>agents</Text>
                </View>
                <View style={styles.statChip}>
                  <Text style={styles.statValue}>Real</Text>
                  <Text style={styles.statLabel}>execution</Text>
                </View>
              </View>
            </View>

            <View style={styles.formColumn}>
              <View style={styles.formCard}>
                <Text style={styles.cardEyebrow}>MEMBER LOGIN</Text>
                <Text style={styles.cardTitle}>Get back inside.</Text>
                <Text style={styles.cardSubtitle}>
                  Clean session, tighter form, less wasted space.
                </Text>

                {error ? (
                  <View style={styles.errorBox}>
                    <Text style={styles.errorText}>{error}</Text>
                  </View>
                ) : null}

                {showSSO ? (
                  <>
                    {renderInput({
                      label: 'WORKSPACE DOMAIN',
                      value: ssoDomain,
                      onChangeText: setSsoDomain,
                      placeholder: 'company.com',
                      focusKey: 'sso',
                    })}

                    <Pressable
                      style={({ pressed }) => [
                        styles.primaryButton,
                        hoveredAction === 'submitSso' && styles.primaryButtonHovered,
                        pressed && styles.primaryButtonPressed,
                        loading && styles.buttonDisabled,
                      ]}
                      onHoverIn={() => setHoveredAction('submitSso')}
                      onHoverOut={() => setHoveredAction((current) => (current === 'submitSso' ? null : current))}
                      onPress={handleSSO}
                      disabled={loading}
                    >
                      <Text style={styles.primaryButtonText}>
                        {loading ? 'REDIRECTING...' : 'CONTINUE WITH SSO'}
                      </Text>
                    </Pressable>

                    <Pressable
                      style={[styles.secondaryButton, hoveredAction === 'backToEmail' && styles.secondaryButtonHovered]}
                      onHoverIn={() => setHoveredAction('backToEmail')}
                      onHoverOut={() => setHoveredAction((current) => (current === 'backToEmail' ? null : current))}
                      onPress={() => setShowSSO(false)}
                    >
                      <Text style={styles.secondaryButtonText}>Back to email login</Text>
                    </Pressable>
                  </>
                ) : (
                  <>
                    {renderInput({
                      label: 'EMAIL',
                      value: email,
                      onChangeText: setEmail,
                      placeholder: 'you@company.com',
                      focusKey: 'email',
                      keyboardType: 'email-address',
                    })}

                    {renderInput({
                      label: 'PASSWORD',
                      value: password,
                      onChangeText: setPassword,
                      placeholder: 'Your password',
                      focusKey: 'password',
                      secureTextEntry: true,
                    })}

                    <Pressable
                      style={({ pressed }) => [
                        styles.primaryButton,
                        hoveredAction === 'login' && styles.primaryButtonHovered,
                        pressed && styles.primaryButtonPressed,
                        loading && styles.buttonDisabled,
                      ]}
                      onHoverIn={() => setHoveredAction('login')}
                      onHoverOut={() => setHoveredAction((current) => (current === 'login' ? null : current))}
                      onPress={handleLogin}
                      disabled={loading}
                    >
                      <Text style={styles.primaryButtonText}>
                        {loading ? 'GETTING IN...' : 'GET IN'}
                      </Text>
                    </Pressable>

                    <Pressable
                      style={[styles.secondaryButton, hoveredAction === 'showSso' && styles.secondaryButtonHovered]}
                      onHoverIn={() => setHoveredAction('showSso')}
                      onHoverOut={() => setHoveredAction((current) => (current === 'showSso' ? null : current))}
                      onPress={() => setShowSSO(true)}
                    >
                      <Text style={styles.secondaryButtonText}>Use company SSO</Text>
                    </Pressable>
                  </>
                )}

                <View style={styles.footerRow}>
                  <Text style={styles.footerText}>No account yet?</Text>
                  <Pressable
                    onHoverIn={() => setHoveredAction('signup')}
                    onHoverOut={() => setHoveredAction((current) => (current === 'signup' ? null : current))}
                    onPress={() => navigation.navigate('SignUp')}
                  >
                    <Text style={[styles.footerLink, hoveredAction === 'signup' && styles.footerLinkHovered]}>
                      Join the circle
                    </Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </View>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050806',
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 28,
  },
  shell: {
    width: '100%',
    maxWidth: 1120,
    alignSelf: 'center',
    gap: 22,
  },
  shellDesktop: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  heroPanel: {
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(184, 255, 97, 0.12)',
    backgroundColor: 'rgba(9, 13, 10, 0.68)',
    paddingHorizontal: 28,
    paddingVertical: 30,
    overflow: 'hidden',
  },
  heroPanelDesktop: {
    flex: 1.1,
    minHeight: 540,
    justifyContent: 'space-between',
  },
  heroEyebrow: {
    color: ACCENT,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 2,
    marginBottom: 18,
  },
  heroTitleTop: {
    color: '#f5f7f2',
    fontSize: 22,
    letterSpacing: 4,
    textTransform: 'uppercase',
  },
  heroTitle: {
    color: '#f5f7f2',
    fontSize: 44,
    lineHeight: 46,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  heroSubtitle: {
    color: '#9ca89c',
    fontSize: 16,
    lineHeight: 24,
    marginTop: 18,
    maxWidth: 420,
  },
  statRow: {
    gap: 12,
    marginTop: 28,
  },
  statRowDesktop: {
    flexDirection: 'row',
    marginTop: 0,
  },
  statChip: {
    flex: 1,
    minHeight: 92,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.03)',
    paddingHorizontal: 16,
    paddingVertical: 14,
    justifyContent: 'space-between',
  },
  statValue: {
    color: '#f5f7f2',
    fontSize: 24,
    fontWeight: '800',
  },
  statLabel: {
    color: '#859185',
    fontSize: 13,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  formColumn: {
    width: '100%',
    maxWidth: 460,
    alignSelf: 'center',
  },
  formCard: {
    borderRadius: 28,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    backgroundColor: CARD_BG,
    paddingHorizontal: 26,
    paddingVertical: 28,
    shadowColor: '#000000',
    shadowOpacity: 0.35,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 14 },
    elevation: 12,
  },
  cardEyebrow: {
    color: ACCENT,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 2,
    marginBottom: 10,
  },
  cardTitle: {
    color: '#f5f7f2',
    fontSize: 30,
    fontWeight: '900',
    lineHeight: 34,
  },
  cardSubtitle: {
    color: '#8f998f',
    fontSize: 14,
    lineHeight: 22,
    marginTop: 8,
    marginBottom: 22,
  },
  errorBox: {
    backgroundColor: 'rgba(122, 24, 24, 0.34)',
    borderWidth: 1,
    borderColor: 'rgba(255, 102, 102, 0.26)',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 16,
  },
  errorText: {
    color: '#ff9090',
    fontSize: 13,
    lineHeight: 18,
  },
  fieldShell: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    marginBottom: 14,
  },
  fieldShellFocused: {
    borderColor: 'rgba(184, 255, 97, 0.44)',
    backgroundColor: 'rgba(184, 255, 97, 0.06)',
    shadowColor: ACCENT,
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  fieldLabel: {
    color: '#7c877c',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.8,
    marginBottom: 4,
  },
  input: {
    color: '#f5f7f2',
    fontSize: 16,
    paddingVertical: 10,
  },
  primaryButton: {
    minHeight: 58,
    borderRadius: 18,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
    borderWidth: 1,
    borderColor: ACCENT_STRONG,
    shadowColor: ACCENT,
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
  },
  primaryButtonHovered: {
    transform: [{ translateY: -2 }],
    backgroundColor: '#c5ff7d',
    shadowOpacity: 0.28,
    shadowRadius: 22,
  },
  primaryButtonPressed: {
    transform: [{ translateY: 0 }],
    backgroundColor: ACCENT_STRONG,
  },
  primaryButtonText: {
    color: '#091007',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 2,
  },
  secondaryButton: {
    minHeight: 54,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(184, 255, 97, 0.18)',
    backgroundColor: 'rgba(255,255,255,0.02)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  secondaryButtonHovered: {
    borderColor: 'rgba(184, 255, 97, 0.42)',
    backgroundColor: 'rgba(184, 255, 97, 0.08)',
    transform: [{ translateY: -1 }],
  },
  secondaryButtonText: {
    color: '#d6e3d2',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  buttonDisabled: {
    opacity: 0.58,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    marginTop: 18,
    flexWrap: 'wrap',
  },
  footerText: {
    color: '#6f796f',
    fontSize: 14,
  },
  footerLink: {
    color: ACCENT,
    fontSize: 14,
    fontWeight: '800',
  },
  footerLinkHovered: {
    color: '#d2ff9c',
  },
  ambientOrb: {
    position: 'absolute',
    borderRadius: 999,
    opacity: 0.18,
  },
  orbA: {
    width: 360,
    height: 360,
    backgroundColor: '#13351b',
    top: -80,
    left: -110,
  },
  orbB: {
    width: 280,
    height: 280,
    backgroundColor: '#203a32',
    bottom: -90,
    right: -60,
  },
  gridGlow: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: '40%',
    opacity: 0.18,
    borderColor: 'rgba(255,255,255,0.03)',
  },
  gridGlowLeft: {
    left: 0,
    borderRightWidth: 1,
  },
  gridGlowRight: {
    right: 0,
    borderLeftWidth: 1,
  },
});
