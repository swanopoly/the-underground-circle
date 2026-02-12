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
import Card from '../../components/Card';

export default function CreateCircleScreen({ navigation }: any) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [maxMembers, setMaxMembers] = useState(8);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { width } = useWindowDimensions();
  const isWide = width > 500;

  const handleCreate = async () => {
    setError('');
    if (!name.trim()) {
      setError('Give your circle a name');
      return;
    }

    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setError('Not logged in');
      setLoading(false);
      return;
    }

    const { data: circle, error: createError } = await supabase
      .from('circles')
      .insert({
        name: name.trim(),
        description: description.trim() || null,
        max_members: maxMembers,
        created_by: user.id,
      })
      .select()
      .single();

    if (createError) {
      setError(createError.message);
      setLoading(false);
      return;
    }

    await supabase.from('circle_members').insert({
      circle_id: circle.id,
      user_id: user.id,
      role: 'creator',
    });

    setLoading(false);
    showAlert('Circle created!', `Invite code: ${circle.invite_code}`);
    navigation.goBack();
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
              <Text style={styles.logoText}>+</Text>
            </View>
            <Text style={styles.title}>CREATE YOUR</Text>
            <Text style={styles.titleBold}>CIRCLE</Text>
            <Text style={styles.subtitle}>Keep it tight. 3-8 real ones only.</Text>
          </View>

          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <View style={styles.form}>
            <Text style={styles.inputLabel}>CIRCLE NAME</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Night Shift Grinders"
              placeholderTextColor="#444"
              value={name}
              onChangeText={setName}
              maxLength={50}
            />

            <Text style={styles.inputLabel}>WHAT'S THE GRIND? (OPTIONAL)</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="What is this circle about?"
              placeholderTextColor="#444"
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={3}
              maxLength={200}
            />

            <Text style={styles.inputLabel}>MAX MEMBERS</Text>
            <View style={styles.memberPicker}>
              {[3, 4, 5, 6, 7, 8].map((n) => (
                <MemberOption
                  key={n}
                  value={n}
                  selected={maxMembers === n}
                  onPress={() => setMaxMembers(n)}
                />
              ))}
            </View>

            <Button
              title={loading ? 'CREATING...' : 'CREATE IT'}
              onPress={handleCreate}
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

function MemberOption({ value, selected, onPress }: { value: number; selected: boolean; onPress: () => void }) {
  const [hovered, setHovered] = useState(false);

  return (
    <Pressable
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={[
        styles.memberOption,
        selected && styles.memberOptionActive,
        hovered && !selected && styles.memberOptionHovered,
      ]}
    >
      <Text style={[
        styles.memberOptionText,
        selected && styles.memberOptionTextActive,
      ]}>
        {value}
      </Text>
    </Pressable>
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
    fontSize: 24,
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
  textArea: {
    minHeight: 70,
    textAlignVertical: 'top',
  },
  memberPicker: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 24,
    gap: 8,
  },
  memberOption: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#0a0a0a',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    justifyContent: 'center',
    alignItems: 'center',
    ...(Platform.OS === 'web' ? { transition: 'all 0.15s ease', cursor: 'pointer' } as any : {}),
  },
  memberOptionHovered: {
    borderColor: '#555',
    backgroundColor: '#1a1a1a',
  },
  memberOptionActive: {
    backgroundColor: '#fff',
    borderColor: '#fff',
  },
  memberOptionText: {
    color: '#888',
    fontSize: 15,
    fontWeight: '700',
  },
  memberOptionTextActive: {
    color: '#0a0a0a',
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
