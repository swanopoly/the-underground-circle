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

export default function CreateCircleScreen({ navigation }: any) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [maxMembers, setMaxMembers] = useState('8');
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) {
      Alert.alert('Give your circle a name');
      return;
    }

    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      Alert.alert('Not logged in');
      setLoading(false);
      return;
    }

    const { data: circle, error } = await supabase
      .from('circles')
      .insert({
        name: name.trim(),
        description: description.trim() || null,
        max_members: parseInt(maxMembers) || 8,
        created_by: user.id,
      })
      .select()
      .single();

    if (error) {
      Alert.alert('Error', error.message);
      setLoading(false);
      return;
    }

    // Auto-join as creator
    await supabase.from('circle_members').insert({
      circle_id: circle.id,
      user_id: user.id,
      role: 'creator',
    });

    setLoading(false);
    Alert.alert('Circle created!', `Invite code: ${circle.invite_code}`, [
      { text: 'LET\'S GO', onPress: () => navigation.goBack() },
    ]);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.inner}>
        <Text style={styles.title}>CREATE YOUR</Text>
        <Text style={styles.titleBold}>CIRCLE</Text>
        <Text style={styles.subtitle}>Keep it tight. 3-8 real ones only.</Text>

        <TextInput
          style={styles.input}
          placeholder="Circle name"
          placeholderTextColor="#666"
          value={name}
          onChangeText={setName}
          maxLength={50}
        />
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder="What's this circle grinding on? (optional)"
          placeholderTextColor="#666"
          value={description}
          onChangeText={setDescription}
          multiline
          numberOfLines={3}
          maxLength={200}
        />

        <Text style={styles.label}>MAX MEMBERS</Text>
        <View style={styles.memberPicker}>
          {[3, 4, 5, 6, 7, 8].map((n) => (
            <TouchableOpacity
              key={n}
              style={[
                styles.memberOption,
                parseInt(maxMembers) === n && styles.memberOptionActive,
              ]}
              onPress={() => setMaxMembers(n.toString())}
            >
              <Text
                style={[
                  styles.memberOptionText,
                  parseInt(maxMembers) === n && styles.memberOptionTextActive,
                ]}
              >
                {n}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleCreate}
          disabled={loading}
        >
          <Text style={styles.buttonText}>
            {loading ? 'CREATING...' : 'CREATE IT'}
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
    fontSize: 16,
    marginBottom: 16,
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  label: {
    color: '#888',
    fontSize: 12,
    letterSpacing: 2,
    marginBottom: 12,
    fontWeight: '700',
  },
  memberPicker: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 32,
  },
  memberOption: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#333',
    justifyContent: 'center',
    alignItems: 'center',
  },
  memberOptionActive: {
    backgroundColor: '#fff',
    borderColor: '#fff',
  },
  memberOptionText: {
    color: '#888',
    fontSize: 16,
    fontWeight: '700',
  },
  memberOptionTextActive: {
    color: '#0a0a0a',
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
