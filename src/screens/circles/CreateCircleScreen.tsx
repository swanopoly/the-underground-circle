import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { safeGetUser } from '../../lib/authSession';
import { showAlert } from '../../lib/alert';
import { awardXP, getXPForAction } from '../../lib/gamification';

// The create flow used to push every new user through a 17-tile template
// picker, an icon picker, a color palette, a check-in format picker, and a
// tag editor before they could even name the circle. The strategic focus
// (CLAUDE.md) is small dev teams getting a shared AI agent — so we strip
// the screen down to the four answers we actually need and bake the rest
// as defaults the user can edit from circle settings.
const ACCENT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '#6366f1', label: 'INDIGO' },
  { value: '#22d3ee', label: 'CYAN' },
  { value: '#22c55e', label: 'EMERALD' },
  { value: '#fbbf24', label: 'AMBER' },
  { value: '#f43f5e', label: 'ROSE' },
  { value: '#a855f7', label: 'VIOLET' },
];

const MEMBER_OPTIONS = [3, 5, 8, 12];

export default function CreateCircleScreen({ route, navigation }: any) {
  const orgId = route?.params?.orgId || null;
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [accentColor, setAccentColor] = useState('#6366f1');
  const [maxMembers, setMaxMembers] = useState(5);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async () => {
    setError('');
    if (!name.trim()) {
      setError('Circle needs a name.');
      return;
    }
    setLoading(true);
    const { value: user } = await safeGetUser();
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
        circle_type: 'custom',
        icon: '▲',
        accent_color: accentColor,
        check_in_format: { type: 'text', label: 'Daily Check-in' },
        tags: [],
        ...(orgId ? { org_id: orgId } : {}),
      })
      .select()
      .single();

    if (createError) {
      setError(createError.message);
      setLoading(false);
      return;
    }

    awardXP(user.id, getXPForAction('circle_create'), 'circle_create', { circle_id: circle.id }).catch(
      console.error,
    );

    setLoading(false);
    showAlert('Circle created', `Invite code: ${circle.invite_code}`);
    navigation.replace('CircleDetail', { circleId: circle.id, circleName: circle.name, tab: 'OFFICE' });
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.frame}>
          <Pressable onPress={() => navigation.goBack()} style={styles.backLink}>
            <Text style={styles.backText}>← Back</Text>
          </Pressable>

          <Text style={styles.kicker}>▲ NEW CIRCLE</Text>
          <Text style={styles.title}>A shared AI agent for your team.</Text>
          <Text style={styles.subtitle}>
            BlackSwan watches your repo, runs daily missions, and keeps everyone honest. Built
            for 2–5 person teams shipping together.
          </Text>

          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <View style={styles.field}>
            <Text style={styles.label}>NAME</Text>
            <TextInput
              style={[styles.input, name.trim() ? { borderColor: accentColor + '66' } : null]}
              placeholder="e.g. The Builders"
              placeholderTextColor="#475569"
              value={name}
              onChangeText={setName}
              maxLength={50}
              autoFocus
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>DESCRIPTION (OPTIONAL)</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="One line about what this circle is shipping."
              placeholderTextColor="#475569"
              value={description}
              onChangeText={setDescription}
              multiline
              maxLength={200}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>ACCENT</Text>
            <View style={styles.row}>
              {ACCENT_OPTIONS.map((option) => {
                const active = accentColor === option.value;
                return (
                  <Pressable
                    key={option.value}
                    onPress={() => setAccentColor(option.value)}
                    style={[
                      styles.pill,
                      active && {
                        borderColor: option.value,
                        backgroundColor: option.value + '22',
                      },
                    ]}
                  >
                    <View style={[styles.pillDot, { backgroundColor: option.value }]} />
                    <Text style={[styles.pillText, active && { color: option.value }]}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>MAX MEMBERS</Text>
            <View style={styles.row}>
              {MEMBER_OPTIONS.map((value) => {
                const active = maxMembers === value;
                return (
                  <Pressable
                    key={value}
                    onPress={() => setMaxMembers(value)}
                    style={[
                      styles.pill,
                      styles.pillNumber,
                      active && {
                        borderColor: accentColor,
                        backgroundColor: accentColor + '22',
                      },
                    ]}
                  >
                    <Text style={[styles.pillText, active && { color: accentColor }]}>
                      {value}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <Pressable
            onPress={handleCreate}
            disabled={loading}
            style={[styles.cta, { backgroundColor: accentColor }, loading && styles.ctaDisabled]}
          >
            {loading ? (
              <ActivityIndicator color="#0b1220" size="small" />
            ) : (
              <Text style={styles.ctaText}>Create Circle</Text>
            )}
          </Pressable>

          <Text style={styles.helper}>
            You can rename, recolor, and customize everything from circle settings.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0a0f1c',
  },
  scrollContent: {
    flexGrow: 1,
    padding: 24,
    alignItems: 'center',
  },
  frame: {
    width: '100%',
    maxWidth: 520,
    gap: 18,
  },
  backLink: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  backText: {
    color: '#64748b',
    fontSize: 13,
    fontWeight: '600',
  },
  kicker: {
    color: '#94a3b8',
    fontSize: 11,
    letterSpacing: 1.8,
    fontWeight: '900',
    fontFamily: Platform.select({
      web: 'ui-monospace, "SF Mono", Menlo, monospace',
      default: 'monospace',
    }),
  },
  title: {
    color: '#f8fafc',
    fontSize: 24,
    fontWeight: '900',
    lineHeight: 30,
    marginTop: -8,
  },
  subtitle: {
    color: '#94a3b8',
    fontSize: 13,
    lineHeight: 19,
    marginTop: -10,
    marginBottom: 4,
  },
  errorBox: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#ef444455',
    backgroundColor: '#ef444412',
  },
  errorText: {
    color: '#fca5a5',
    fontSize: 13,
  },
  field: {
    gap: 8,
  },
  label: {
    color: '#64748b',
    fontSize: 10,
    letterSpacing: 1.4,
    fontWeight: '900',
    fontFamily: Platform.select({
      web: 'ui-monospace, "SF Mono", Menlo, monospace',
      default: 'monospace',
    }),
  },
  input: {
    backgroundColor: '#0d1320',
    borderWidth: 1,
    borderColor: '#1e293b',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#f8fafc',
    fontSize: 15,
    ...(Platform.select({
      web: { transition: 'border-color 0.18s ease' },
      default: {},
    }) as any),
  },
  textArea: {
    minHeight: 70,
    textAlignVertical: 'top',
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#1e293b',
    backgroundColor: '#0d1320',
    ...(Platform.select({
      web: { cursor: 'pointer', transition: 'all 0.15s ease' },
      default: {},
    }) as any),
  },
  pillNumber: {
    minWidth: 44,
    justifyContent: 'center',
  },
  pillDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  pillText: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
    fontFamily: Platform.select({
      web: 'ui-monospace, "SF Mono", Menlo, monospace',
      default: 'monospace',
    }),
  },
  cta: {
    marginTop: 8,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    ...(Platform.select({
      web: { cursor: 'pointer', transition: 'opacity 0.15s ease' },
      default: {},
    }) as any),
  },
  ctaDisabled: {
    opacity: 0.7,
  },
  ctaText: {
    color: '#0b1220',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  helper: {
    color: '#475569',
    fontSize: 11,
    textAlign: 'center',
    lineHeight: 16,
  },
});
