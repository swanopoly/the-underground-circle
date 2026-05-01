import React, { useState, useEffect, useRef, useCallback, Suspense, lazy } from 'react';
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
  Animated,
  Easing,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { signInWithSSO } from '../../lib/sso';
import { signInWithGoogle } from '../../lib/googleCreds';
import LoginPhoenixHero from './LoginPhoenixHero';

// LoginBackground3D pulls in three, @react-three/fiber, @react-three/postprocessing
// (~1-2MB of JS). It only renders on the web login screen, so code-split it out
// of the initial bundle — authenticated users never pay the cost.
const LoginBackground3D = lazy(() => import('../../components/LoginBackground3D'));

const ACCENT = '#b8ff61';
const ACCENT_STRONG = '#9be234';
const CARD_BG = 'rgba(11, 15, 12, 0.45)';
const CARD_BORDER = 'rgba(184, 255, 97, 0.18)';

type FocusField = 'email' | 'password' | 'sso' | null;
type HoverAction = 'login' | 'showSso' | 'submitSso' | 'backToEmail' | 'signup' | 'googleSignin' | null;

// Inject global CSS for focus ring removal + button hover effects (web only, once)
let _loginCssInjected = false;
function injectLoginCSS() {
  if (Platform.OS !== 'web' || _loginCssInjected) return;
  _loginCssInjected = true;
  try {
    const style = document.createElement('style');
    style.textContent = `
      /* Kill all browser focus outlines */
      input:focus, textarea:focus, [role="button"]:focus, button:focus, a:focus, div:focus {
        outline: none !important;
        -webkit-tap-highlight-color: transparent !important;
      }
      *:focus { outline: none !important; }
      *:focus-visible { outline: none !important; }

      /* Glowing border sweep on buttons */
      @keyframes uc-border-sweep {
        0% { background-position: 0% 50%; }
        50% { background-position: 100% 50%; }
        100% { background-position: 0% 50%; }
      }
      @keyframes uc-glow-pulse {
        0%, 100% { box-shadow: 0 0 15px #b8ff6133, 0 4px 20px #b8ff6122; }
        50% { box-shadow: 0 0 25px #b8ff6155, 0 8px 30px #b8ff6133, 0 0 60px #b8ff6111; }
      }
      @keyframes uc-shimmer {
        0% { left: -100%; }
        100% { left: 200%; }
      }
      @keyframes uc-fade-black {
        0% { opacity: 0; }
        100% { opacity: 1; }
      }
    `;
    document.head.appendChild(style);
  } catch (_e) {
    // DOM API unavailable — skip CSS injection gracefully
  }
}

// Hook: cursor-following transparent reveal on a panel
function useCursorReveal() {
  const ref = useRef<View>(null);
  useEffect(() => {
    if (Platform.OS !== 'web' || !ref.current) return;
    try {
      const el = ref.current as unknown as HTMLElement;
      if (!el || typeof el.addEventListener !== 'function') return;
      const onMove = (e: MouseEvent) => {
        try {
          const rect = el.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;
          // Radial gradient mask: transparent circle at cursor, solid elsewhere
          el.style.setProperty(
            '-webkit-mask-image',
            `radial-gradient(circle 120px at ${x}px ${y}px, transparent 0%, transparent 40%, black 100%)`,
          );
          el.style.setProperty(
            'mask-image',
            `radial-gradient(circle 120px at ${x}px ${y}px, transparent 0%, transparent 40%, black 100%)`,
          );
        } catch (_e) {
          // DOM operation failed — ignore gracefully
        }
      };
      const onLeave = () => {
        try {
          el.style.removeProperty('-webkit-mask-image');
          el.style.removeProperty('mask-image');
        } catch (_e) {
          // DOM operation failed — ignore gracefully
        }
      };
      el.addEventListener('mousemove', onMove as any);
      el.addEventListener('mouseleave', onLeave);
      return () => {
        el.removeEventListener('mousemove', onMove as any);
        el.removeEventListener('mouseleave', onLeave);
      };
    } catch (_e) {
      // Element cast or addEventListener failed — skip cursor reveal
    }
  }, []);
  return ref;
}

export default function LoginScreen({ navigation }: any) {
  const { width } = useWindowDimensions();
  const isDesktop = width >= 980;
  // Mobile hero font sizing — "UNDERGROUND" (11 chars at 900-weight bold)
  // is wider than any single phone width allows at 44px. We were
  // computing a width-aware size, but adjustsFontSizeToFit doesn't work
  // on web/Android so even a slight miscalculation surfaced as `…`
  // truncation. Switching to a flat 28px on anything below the desktop
  // breakpoint — comfortably fits 320px viewports up through 768px iPad
  // portrait without the dynamic-math fragility.
  const heroTitleFontSize = isDesktop ? 44 : 28;
  const heroTitleLetterSpacing = isDesktop ? 1 : 0.4;
  // Inject CSS on mount
  useEffect(() => { injectLoginCSS(); }, []);
  const heroRevealRef = useCursorReveal();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showSSO, setShowSSO] = useState(false);
  const [ssoDomain, setSsoDomain] = useState('');
  const [focusedField, setFocusedField] = useState<FocusField>(null);
  const [hoveredAction, setHoveredAction] = useState<HoverAction>(null);

  // Portal suck-in transition — zooms INTO the portal like being pulled in
  const [portalTransition, setPortalTransition] = useState(false);
  const portalAnim = useRef(new Animated.Value(0)).current;
  // Simple zoom: scale up slightly, fade to black fast
  const portalScale = portalAnim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 1.05, 1.15] });
  // No rotation — clean straight zoom
  const portalRotate = portalAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '0deg'] });
  // Fade out quickly — UI gone by 40%
  const portalOpacity = portalAnim.interpolate({ inputRange: [0, 0.15, 0.4, 1], outputRange: [1, 0.6, 0, 0] });
  // No lateral pull — just straight in
  const portalTranslateY = portalAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 0] });
  const portalTranslateX = portalAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 0] });
  // Blur — apply via CSS filter on web (RN Animated doesn't support filter)
  const portalViewRef = useRef<View>(null);
  useEffect(() => {
    if (Platform.OS !== 'web' || !portalTransition) return;
    const listener = portalAnim.addListener(({ value }) => {
      try {
        const el = (portalViewRef.current as any)?._nativeTag
          ? undefined
          : (portalViewRef.current as any);
        // Get the DOM node
        const node = el && (el as any).style ? el : (el as any)?._nativeTag ? undefined : document.querySelector('[data-portal-view]');
        if (node && node.style) {
          const blur = value < 0.15 ? 0 : Math.min((value - 0.15) * 35, 30);
          node.style.filter = blur > 0 ? `blur(${blur}px)` : '';
        }
      } catch (_e) {
        // DOM mutation failed — skip blur effect gracefully
      }
    });
    return () => portalAnim.removeListener(listener);
  }, [portalTransition, portalAnim]);

  const handleLogin = async () => {
    setError('');
    if (!email || !password) {
      setError('Fill in both fields.');
      return;
    }

    setLoading(true);

    // First validate credentials without persisting session yet
    // We'll sign in, but play the animation before navigation happens
    try {
      // Start the portal animation immediately on button press
      setPortalTransition(true);
      // Tell the 3D camera to dive into the portal
      if (Platform.OS === 'web') {
        window.dispatchEvent(new Event('uc-portal-dive'));
      }
      Animated.timing(portalAnim, {
        toValue: 1,
        duration: 1500,
        easing: Easing.in(Easing.quad),
        useNativeDriver: false,
      }).start();

      // Sign in once screen is black
      await new Promise(resolve => setTimeout(resolve, 800));

      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

      if (signInError) {
        // Auth failed — reverse the animation
        setPortalTransition(false);
        portalAnim.setValue(0);
        setLoading(false);
        setError(signInError.message);
      }
      // If success, Supabase session triggers navigation — animation is already playing
    } catch (err) {
      setPortalTransition(false);
      portalAnim.setValue(0);
      setLoading(false);
      setError('Something went wrong.');
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

  const passwordRef = useRef<TextInput | null>(null);

  const renderInput = ({
    label,
    value,
    onChangeText,
    placeholder,
    focusKey,
    secureTextEntry,
    keyboardType,
    onSubmitEditing,
    returnKeyType,
    inputRef,
  }: {
    label: string;
    value: string;
    onChangeText: (text: string) => void;
    placeholder: string;
    focusKey: Exclude<FocusField, null>;
    secureTextEntry?: boolean;
    keyboardType?: 'default' | 'email-address';
    onSubmitEditing?: () => void;
    returnKeyType?: 'next' | 'go' | 'done';
    inputRef?: React.RefObject<TextInput | null>;
  }) => (
    <View style={[styles.fieldShell, focusedField === focusKey && styles.fieldShellFocused]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        ref={inputRef}
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
        onSubmitEditing={onSubmitEditing}
        returnKeyType={returnKeyType}
      />
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.container}>
        {/* Three.js background — web only, renders behind everything.
            Suspense fallback is an empty View so the login form paints
            immediately while three/postprocessing stream in. */}
        {Platform.OS === 'web' && (
          <Suspense fallback={null}>
            <LoginBackground3D />
          </Suspense>
        )}

        {/* Portal overlay — fades to black */}
        {portalTransition && Platform.OS === 'web' && (
          <div style={{
            position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
            zIndex: 100, pointerEvents: 'none',
            background: '#000000',
            animation: 'uc-fade-black 1.2s ease-in forwards',
            opacity: 0,
          }} />
        )}
        <Animated.View
          ref={portalViewRef}
          {...(Platform.OS === 'web' ? { 'data-portal-view': true } as any : {})}
          style={[
            { flex: 1 },
            portalTransition && {
              opacity: portalOpacity,
              transform: [
                { perspective: 800 },
                { scale: portalScale },
                { rotate: portalRotate },
                { translateY: portalTranslateY },
                { translateX: portalTranslateX },
              ],
            },
          ]}
        >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          scrollEnabled={!portalTransition}
        >
          <View style={[styles.shell, isDesktop && styles.shellDesktop]}>
            <View ref={heroRevealRef} style={[styles.heroPanel, isDesktop && styles.heroPanelDesktop]}>
              <LoginPhoenixHero />
              <Text style={styles.heroEyebrow} numberOfLines={1} adjustsFontSizeToFit>UNDERGROUND ACCESS</Text>
              <Text style={styles.heroTitleTop} numberOfLines={1}>The</Text>
              <Text
                style={[styles.heroTitle, { fontSize: heroTitleFontSize, lineHeight: heroTitleFontSize + 2, letterSpacing: heroTitleLetterSpacing }]}
                numberOfLines={1}
                adjustsFontSizeToFit
              >Underground</Text>
              <Text
                style={[styles.heroTitle, { fontSize: heroTitleFontSize, lineHeight: heroTitleFontSize + 2, letterSpacing: heroTitleLetterSpacing }]}
                numberOfLines={1}
              >Circle</Text>
              <Text style={styles.heroSubtitle}>
                Deploy autonomous agents. Collaborate in private circles.{'\n'}
                Ship faster than teams ten times your size.
              </Text>

              {/* Stat chips ("Private circles" / "24/7 agents" / "Zero
                  busywork") are desktop-only — on mobile they pushed
                  the login form below the fold; cutting them lifts the
                  form to the top of the viewport. */}
              {isDesktop && (
                <View style={[styles.statRow, styles.statRowDesktop]}>
                  <View style={styles.statChip}>
                    <Text style={styles.statValue}>Private</Text>
                    <Text style={styles.statLabel}>circles</Text>
                  </View>
                  <View style={styles.statChip}>
                    <Text style={styles.statValue}>24/7</Text>
                    <Text style={styles.statLabel}>agents</Text>
                  </View>
                  <View style={styles.statChip}>
                    <Text style={styles.statValue}>Zero</Text>
                    <Text style={styles.statLabel}>busywork</Text>
                  </View>
                </View>
              )}
            </View>

            <View style={styles.formColumn}>
              <View style={styles.formCard}>
                <Text style={styles.cardEyebrow}>MEMBER LOGIN</Text>
                <Text style={styles.cardTitle}>Get back inside.</Text>
                <Text style={styles.cardSubtitle}>
                  Your agents are waiting. Pick up where you left off.
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
                      returnKeyType: 'next',
                      onSubmitEditing: () => passwordRef.current?.focus(),
                    })}

                    {renderInput({
                      label: 'PASSWORD',
                      value: password,
                      onChangeText: setPassword,
                      placeholder: 'Your password',
                      focusKey: 'password',
                      secureTextEntry: true,
                      returnKeyType: 'go',
                      onSubmitEditing: handleLogin,
                      inputRef: passwordRef,
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
                      {/* Shimmer sweep on hover */}
                      {Platform.OS === 'web' && hoveredAction === 'login' && (
                        <div style={{
                          position: 'absolute', top: 0, left: '-100%', width: '60%', height: '100%',
                          background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent)',
                          animation: 'uc-shimmer 1.2s ease-in-out infinite',
                          pointerEvents: 'none',
                        }} />
                      )}
                      <Text style={styles.primaryButtonText}>
                        {portalTransition ? 'ENTERING THE CIRCLE...' : loading ? 'GETTING IN...' : 'GET IN'}
                      </Text>
                    </Pressable>

                    <Pressable
                      style={[styles.secondaryButton, hoveredAction === 'showSso' && styles.secondaryButtonHovered]}
                      onHoverIn={() => setHoveredAction('showSso')}
                      onHoverOut={() => setHoveredAction((current) => (current === 'showSso' ? null : current))}
                      onPress={() => setShowSSO(true)}
                    >
                      {Platform.OS === 'web' && hoveredAction === 'showSso' && (
                        <div style={{
                          position: 'absolute', top: 0, left: '-100%', width: '50%', height: '100%',
                          background: 'linear-gradient(90deg, transparent, rgba(184,255,97,0.12), transparent)',
                          animation: 'uc-shimmer 1.5s ease-in-out infinite',
                          pointerEvents: 'none',
                        }} />
                      )}
                      <Text style={styles.secondaryButtonText}>Use company SSO</Text>
                    </Pressable>

                    {/* Sign in with Google — hands identity over to
                        Supabase Auth's built-in provider. We ask for the
                        full Google Workspace scope set so users who pick
                        this path land fully wired for Gmail / Calendar
                        / Drive tools right after their first sign-in. */}
                    <Pressable
                      style={[styles.secondaryButton, hoveredAction === 'googleSignin' && styles.secondaryButtonHovered]}
                      onHoverIn={() => setHoveredAction('googleSignin')}
                      onHoverOut={() => setHoveredAction((current) => (current === 'googleSignin' ? null : current))}
                      onPress={async () => {
                        const { ok, reason } = await signInWithGoogle({ withWorkspaceScopes: true });
                        if (!ok && reason) setError(reason);
                      }}
                    >
                      {Platform.OS === 'web' && hoveredAction === 'googleSignin' && (
                        <div style={{
                          position: 'absolute', top: 0, left: '-100%', width: '50%', height: '100%',
                          background: 'linear-gradient(90deg, transparent, rgba(66,133,244,0.12), transparent)',
                          animation: 'uc-shimmer 1.5s ease-in-out infinite',
                          pointerEvents: 'none',
                        }} />
                      )}
                      <Text style={styles.secondaryButtonText}>Sign in with Google</Text>
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
        </Animated.View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 28,
    position: 'relative',
    zIndex: 1,
    // @ts-ignore — web-only: let pointer events pass through to 3D canvas
    pointerEvents: 'box-none',
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
    borderColor: 'rgba(184, 255, 97, 0.1)',
    backgroundColor: 'rgba(9, 13, 10, 0.35)',
    paddingHorizontal: 28,
    paddingVertical: 30,
    overflow: 'hidden',
    // @ts-ignore — web-only backdrop filter
    backdropFilter: 'blur(8px)',
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
    lineHeight: 26,
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
    // @ts-ignore
    backdropFilter: 'blur(10px)',
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
    // @ts-ignore
    backdropFilter: 'blur(10px)',
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
    transition: 'border-color 0.3s ease, background-color 0.3s ease, box-shadow 0.3s ease',
  },
  fieldShellFocused: {
    borderColor: 'rgba(184, 255, 97, 0.35)',
    backgroundColor: 'rgba(184, 255, 97, 0.04)',
    // @ts-ignore
    boxShadow: '0 0 20px rgba(184, 255, 97, 0.1), inset 0 0 15px rgba(184, 255, 97, 0.03)',
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
    outlineWidth: 0,
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
    overflow: 'hidden',
    // @ts-ignore — web transitions
    transition: 'transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.3s ease, background-color 0.2s ease',
    boxShadow: '0 4px 15px rgba(184, 255, 97, 0.2)',
  },
  primaryButtonHovered: {
    transform: [{ translateY: -3 }, { scale: 1.02 }],
    // @ts-ignore
    boxShadow: '0 8px 30px rgba(184, 255, 97, 0.35), 0 0 40px rgba(184, 255, 97, 0.15)',
  },
  primaryButtonPressed: {
    transform: [{ translateY: 0 }, { scale: 0.98 }],
    backgroundColor: ACCENT_STRONG,
    // @ts-ignore
    boxShadow: '0 2px 10px rgba(184, 255, 97, 0.15)',
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
    overflow: 'hidden',
    // @ts-ignore
    transition: 'transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1), border-color 0.3s ease, background-color 0.3s ease, box-shadow 0.3s ease',
  },
  secondaryButtonHovered: {
    borderColor: 'rgba(184, 255, 97, 0.5)',
    backgroundColor: 'rgba(184, 255, 97, 0.06)',
    transform: [{ translateY: -2 }, { scale: 1.01 }],
    // @ts-ignore
    boxShadow: '0 4px 20px rgba(184, 255, 97, 0.1), inset 0 0 20px rgba(184, 255, 97, 0.04)',
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
    // @ts-ignore
    transition: 'color 0.2s ease, text-shadow 0.3s ease',
  },
  footerLinkHovered: {
    color: '#d2ff9c',
    // @ts-ignore
    textShadow: '0 0 12px rgba(184, 255, 97, 0.4)',
  },
});
