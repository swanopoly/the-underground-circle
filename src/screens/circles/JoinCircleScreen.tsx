import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  useWindowDimensions,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { showAlert } from '../../lib/alert';
import Button from '../../components/Button';
import { awardXP, getXPForAction } from '../../lib/gamification';

export default function JoinCircleScreen({ navigation }: any) {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { width } = useWindowDimensions();
  const isWide = width > 500;

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

    // Award XP for joining a circle
    awardXP(user.id, getXPForAction('circle_join'), 'circle_join', { circle_id: circle.id }).catch(console.error);

    showAlert("You're in!", `Welcome to ${circle.name}.`);
    navigation.replace('CircleDetail', { circleId: circle.id, circleName: circle.name });
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
              <Text style={styles.logoText}>⟶</Text>
            </View>
            <Text style={styles.title}>JOIN A</Text>
            <Text style={styles.titleBold}>CIRCLE</Text>
            <Text style={styles.subtitle}>Got an invite code? Enter it below.</Text>
          </View>

          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <View style={styles.form}>
            <Text style={styles.inputLabel}>INVITE CODE</Text>
            <TextInput
              style={styles.codeInput}
              placeholder="e.g. a1b2c3d4"
              placeholderTextColor="#444"
              value={code}
              onChangeText={setCode}
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Button
              title={loading ? 'JOINING...' : 'JOIN'}
              onPress={handleJoin}
              loading={loading}
              disabled={loading}
            />
          </View>

          <View style={styles.divider} />

          <Pressable onPress={() => navigation.goBack()} style={styles.cancelButton}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </View>
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
    marginBottom: 28,
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
  codeInput: {
    backgroundColor: '#000000',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 10,
    padding: 16,
    color: '#fff',
    fontSize: 20,
    marginBottom: 20,
    textAlign: 'center',
    letterSpacing: 4,
    fontWeight: '700',
  },
  divider: {
    height: 1,
    backgroundColor: '#222',
    marginBottom: 16,
  },
  cancelButton: {
    alignItems: 'center',
    padding: 8,
  },
  cancelText: {
    color: '#555',
    fontSize: 14,
  },
});
