import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { supabase } from '../../lib/supabase';

export default function JoinCircleScreen({ navigation }: any) {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);

  const handleJoin = async () => {
    if (!code.trim()) {
      Alert.alert('Enter an invite code');
      return;
    }

    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      Alert.alert('Not logged in');
      setLoading(false);
      return;
    }

    // Find circle by invite code
    const { data: circle, error: findError } = await supabase
      .from('circles')
      .select('*, circle_members(count)')
      .eq('invite_code', code.trim().toLowerCase())
      .single();

    if (findError || !circle) {
      Alert.alert('Invalid code', 'No circle found with that code.');
      setLoading(false);
      return;
    }

    // Check if full
    const memberCount = circle.circle_members?.[0]?.count || 0;
    if (memberCount >= circle.max_members) {
      Alert.alert('Circle is full', 'This circle has reached its max members.');
      setLoading(false);
      return;
    }

    // Check if already a member
    const { data: existing } = await supabase
      .from('circle_members')
      .select('id')
      .eq('circle_id', circle.id)
      .eq('user_id', user.id)
      .single();

    if (existing) {
      Alert.alert('Already in', 'You\'re already in this circle.');
      setLoading(false);
      return;
    }

    // Join
    const { error: joinError } = await supabase.from('circle_members').insert({
      circle_id: circle.id,
      user_id: user.id,
      role: 'member',
    });

    setLoading(false);
    if (joinError) {
      Alert.alert('Error', joinError.message);
      return;
    }

    Alert.alert('You\'re in!', `Welcome to ${circle.name}.`, [
      { text: 'LET\'S GO', onPress: () => navigation.goBack() },
    ]);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.inner}>
        <Text style={styles.title}>JOIN A</Text>
        <Text style={styles.titleBold}>CIRCLE</Text>
        <Text style={styles.subtitle}>Got an invite code? Enter it below.</Text>

        <TextInput
          style={styles.input}
          placeholder="Invite code"
          placeholderTextColor="#666"
          value={code}
          onChangeText={setCode}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleJoin}
          disabled={loading}
        >
          <Text style={styles.buttonText}>
            {loading ? 'JOINING...' : 'JOIN'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
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
    marginBottom: 40,
    fontStyle: 'italic',
  },
  input: {
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 8,
    padding: 16,
    color: '#fff',
    fontSize: 20,
    marginBottom: 24,
    textAlign: 'center',
    letterSpacing: 4,
    fontWeight: '700',
  },
  button: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    marginBottom: 16,
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
  cancelText: {
    color: '#666',
    textAlign: 'center',
    fontSize: 14,
  },
});
