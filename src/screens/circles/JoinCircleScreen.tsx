import React, { Suspense, lazy, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { showAlert } from '../../lib/alert';
import { awardXP, getXPForAction } from '../../lib/gamification';

// Reuse the same 3D login background so the auth-adjacent flows feel
// like a single experience instead of three different screens.
const LoginBackground3D = lazy(() => import('../../components/LoginBackground3D'));

const ACCENT = '#b8ff61';
const ACCENT_STRONG = '#9be234';
const CARD_BG = 'rgba(11, 15, 12, 0.55)';
const CARD_BORDER = 'rgba(184, 255, 97, 0.18)';

export default function JoinCircleScreen({ navigation }: any) {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleJoin = async () => {
    setError('');
    if (!code.trim()) {
      setError('Enter an invite code');
      return;
    }
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setError('Not logged in');
      setLoading(false);
      return;
    }
    const { data: circle, error: findError } = await supabase
      .from('circles')
      .select('*, circle_members(count)')
      .eq('invite_code', code.trim().toLowerCase())
      .single();
    if (findError || !circle) {
      setError('No circle found with that code.');
      setLoading(false);
      return;
    }
    const memberCount = circle.circle_members?.[0]?.count || 0;
    if (memberCount >= circle.max_members) {
      setError('This circle is full.');
      setLoading(false);
      return;
    }
    const { data: existing } = await supabase
      .from('circle_members')
      .select('id')
      .eq('circle_id', circle.id)
      .eq('user_id', user.id)
      .single();
    if (existing) {
      setError("You're already in this circle.");
      setLoading(false);
      return;
    }
    const { error: joinError } = await supabase.from('circle_members').insert({
      circle_id: circle.id,
      user_id: user.id,
      role: 'member',
    });
    setLoading(false);
    if (joinError) {
      setError(joinError.message);
      return;
    }
    awardXP(user.id, getXPForAction('circle_join'), 'circle_join', { circle_id: circle.id }).catch(console.error);
    showAlert("You're in!", `Welcome to ${circle.name}.`);
    navigation.replace('CircleDetail', { circleId: circle.id, circleName: circle.name, tab: 'OFFICE' });
  };

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.root}>
        {Platform.OS === 'web' && (
          <Suspense fallback={null}>
            <LoginBackground3D />
          </Suspense>
        )}
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={styles.card}>
            <View style={styles.header}>
              <View style={styles.logoCircle}>
                <Text style={styles.logoGlyph}>⟶</Text>
              </View>
              <Text style={styles.kicker}>JOIN A</Text>
              <Text style={styles.title}>CIRCLE</Text>
              <Text style={styles.subtitle}>Got an invite code? Enter it below to drop into the team.</Text>
            </View>

            {error ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <View style={styles.field}>
              <Text style={styles.label}>INVITE CODE</Text>
              <View style={styles.inputShell}>
                <TextInput
                  style={styles.codeInput}
                  placeholder="a1b2c3d4"
                  placeholderTextColor="rgba(184, 255, 97, 0.25)"
                  value={code}
                  onChangeText={setCode}
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={32}
                />
              </View>
              <Text style={styles.helper}>Codes are 8 lowercase characters. Ask the circle's owner for one.</Text>
            </View>

            <Pressable
              onPress={handleJoin}
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
                <Text style={styles.ctaText}>JOIN CIRCLE</Text>
              )}
            </Pressable>

            <Pressable onPress={() => navigation.goBack()} style={styles.cancel}>
              <Text style={styles.cancelText}>Cancel</Text>
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
    gap: 20,
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
    fontSize: 22,
    fontWeight: '900',
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
    maxWidth: 320,
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
    gap: 8,
  },
  label: {
    color: 'rgba(184, 255, 97, 0.55)',
    fontSize: 10,
    letterSpacing: 2.4,
    fontWeight: '900',
    fontFamily: Platform.select({ web: 'ui-monospace, "SF Mono", Menlo, monospace', default: 'monospace' }),
  },
  inputShell: {
    width: 240,
    maxWidth: '100%',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(184, 255, 97, 0.22)',
    backgroundColor: 'rgba(8, 12, 9, 0.55)',
    ...(Platform.select({
      web: { transition: 'border-color 0.18s ease, box-shadow 0.18s ease' },
      default: {},
    }) as any),
  },
  codeInput: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    color: ACCENT,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 4,
    textAlign: 'center',
    fontFamily: Platform.select({ web: 'ui-monospace, "SF Mono", Menlo, monospace', default: 'monospace' }),
    ...(Platform.select({
      web: { outlineStyle: 'none' },
      default: {},
    }) as any),
  },
  helper: {
    color: '#7c8c7c',
    fontSize: 11,
    textAlign: 'center',
    maxWidth: 280,
    lineHeight: 15,
  },
  cta: {
    alignSelf: 'center',
    width: 240,
    maxWidth: '100%',
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: ACCENT,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
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
  cancel: {
    alignSelf: 'center',
    paddingVertical: 6,
  },
  cancelText: {
    color: '#7c8c7c',
    fontSize: 12,
  },
});
