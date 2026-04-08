import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  Platform,
  Alert,
  ActivityIndicator,
  Animated,
  Image,
} from 'react-native';
import { LoadingScreen } from '../../components/LoadingWave';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../../lib/supabase';
import { Circle, CheckInFormat } from '../../types';

// ─── Constants ───────────────────────────────────────────────────────────────

const ACCENT_COLORS = [
  '#6366f1', '#a855f7', '#22d3ee', '#22c55e', '#f43f5e', '#f59e0b',
  '#3b82f6', '#fbbf24', '#ec4899', '#14b8a6', '#8b5cf6', '#ef4444',
];

const EMOJI_CATEGORIES: Record<string, string[]> = {
  'POPULAR': ['⚡', '🔥', '💪', '🎯', '🧠', '💰', '🎮', '📚', '🏋️‍♂️', '🧘‍♂️', '🎨', '🚀', '💎', '👑', '🌙', '⭐', '🦅', '🐺', '🦁', '🏆'],
  'ANIMALS': ['🐶', '🐱', '🐻', '🦊', '🐯', '🦈', '🐉', '🦇', '🐍', '🦄'],
  'SPORTS': ['⚽', '🏀', '🏈', '🎾', '🥊', '🏄', '🚴', '⛷️', '🎳', '🏹'],
  'TECH': ['💻', '🤖', '📱', '🎧', '🕹️', '📡', '⚙️', '🔬', '🧬', '💡'],
  'FOOD': ['🍕', '🍔', '🥗', '☕', '🍜', '🥑', '🍎', '🧁', '🍣', '🌮'],
  'NATURE': ['🌊', '🏔️', '🌸', '🍀', '🌵', '🌈', '❄️', '🌻', '🍂', '🌲'],
  'SYMBOLS': ['♠️', '♦️', '☯️', '⚔️', '🛡️', '🔱', '⚜️', '🔮', '🎭', '♾️'],
};

const CIRCLE_TYPES = [
  'fitness', 'money', 'learning', 'mental-health', 'relationships', 'career',
  'productivity', 'nutrition', 'purpose', 'gaming', 'creative', 'custom',
];

const CHECKIN_TYPES: CheckInFormat['type'][] = ['photo', 'number', 'text', 'yesno', 'rating'];

const SUGGESTED_TAGS = [
  'daily', 'weekly', 'morning', 'night', 'accountability', 'competitive',
  'chill', 'hardcore', 'beginner', 'advanced', 'social', 'solo',
];

// ─── Main Component ──────────────────────────────────────────────────────────

export default function CircleSettingsScreen({ route, navigation }: any) {
  const { circleId } = route.params;
  const [circle, setCircle] = useState<Circle | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isCreator, setIsCreator] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Editable fields
  const [icon, setIcon] = useState('⭕');
  const [accentColor, setAccentColor] = useState('#6366f1');
  const [customHex, setCustomHex] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [circleType, setCircleType] = useState('custom');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [checkInFormat, setCheckInFormat] = useState<CheckInFormat>({ type: 'text' });
  const [vibe, setVibe] = useState('');
  const [rules, setRules] = useState<string[]>([]);
  const [ruleInput, setRuleInput] = useState('');
  const [expandedEmoji, setExpandedEmoji] = useState<string | null>('POPULAR');
  const [circleImageUrl, setCircleImageUrl] = useState<string | undefined>(undefined);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const saveButtonAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (hasChanges) {
      Animated.spring(saveButtonAnim, { toValue: 1, useNativeDriver: true, tension: 80, friction: 10 }).start();
    } else if (!showSaved) {
      Animated.timing(saveButtonAnim, { toValue: 0, useNativeDriver: true, duration: 200 }).start();
    }
  }, [hasChanges, showSaved]);

  useEffect(() => {
    loadData();
  }, [circleId]);

  const loadData = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) setCurrentUserId(user.id);

    const { data } = await supabase.from('circles').select('*').eq('id', circleId).single();
    if (data) {
      setCircle(data);
      setIcon(data.icon || '⭕');
      setAccentColor(data.accent_color || '#6366f1');
      setName(data.name || '');
      setDescription(data.description || '');
      setCircleType(data.circle_type || 'custom');
      setTags(data.tags || []);
      setCheckInFormat(data.check_in_format || { type: 'text' });
      setVibe(data.vibe || '');
      setRules(data.rules || []);
      setCircleImageUrl(data.circle_image_url || undefined);
      setIsCreator(user?.id === data.created_by);
    }
    setLoading(false);
  };

  const markChanged = () => { if (!hasChanges) setHasChanges(true); };

  const saveAll = async () => {
    if (!isCreator) return;
    setSaving(true);
    try {
      const fields = {
        icon, accent_color: accentColor, name: name.trim(), description,
        circle_type: circleType, tags, check_in_format: checkInFormat,
        vibe, rules, circle_image_url: circleImageUrl,
      };
      const { error } = await supabase.from('circles').update(fields).eq('id', circleId);
      if (error) {
        console.error('SaveAll error:', error);
        Alert.alert('Save Error', error.message || 'Failed to save changes');
        setSaving(false);
        return;
      }
      setCircle(prev => prev ? { ...prev, ...fields } : prev);
      setHasChanges(false);
      setShowSaved(true);
      setTimeout(() => {
        setShowSaved(false);
      }, 1500);
    } catch (e) {
      console.error('Save error:', e);
      Alert.alert('Error', 'Failed to save changes');
    }
    setSaving(false);
  };

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.[0]) return;
    setUploadingImage(true);
    try {
      const asset = result.assets[0];
      const ext = asset.uri.split('.').pop()?.toLowerCase() || 'jpg';
      const path = `circles/${circleId}/icon.${ext}`;
      const response = await fetch(asset.uri);
      const blob = await response.blob();
      const arrayBuffer = await new Response(blob).arrayBuffer();
      const { error: uploadError } = await supabase.storage
        .from('circle-images')
        .upload(path, arrayBuffer, { contentType: `image/${ext}`, upsert: true });
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage.from('circle-images').getPublicUrl(path);
      const url = urlData.publicUrl + '?t=' + Date.now();
      setCircleImageUrl(url);
      setIcon('⭕'); // clear emoji when custom image set
      markChanged();
      // Also auto-save this
      await save({ circle_image_url: url, icon: '⭕' });
    } catch (e: any) {
      console.error('Upload error:', e);
      Alert.alert('Upload Failed', e.message || 'Could not upload image');
    }
    setUploadingImage(false);
  };

  const removeImage = () => {
    setCircleImageUrl(undefined);
    markChanged();
    save({ circle_image_url: null });
  };

  const save = async (fields: Record<string, any>) => {
    if (!isCreator) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('circles').update(fields).eq('id', circleId);
      if (error) {
        console.error('Save error:', error);
        Alert.alert('Save Error', error.message || 'Failed to save changes');
      } else {
        setCircle(prev => prev ? { ...prev, ...fields } : prev);
      }
    } catch (e: any) {
      console.error('Save error:', e);
      Alert.alert('Save Error', e.message || 'Failed to save changes');
    }
    setSaving(false);
  };

  const handleDeleteCircle = async () => {
    if (!deleteConfirm) { setDeleteConfirm(true); return; }
    try {
      const { error: membersError } = await supabase.from('circle_members').delete().eq('circle_id', circleId);
      if (membersError) {
        console.error('Failed to delete circle members:', membersError);
        Alert.alert('Delete Error', 'Could not remove circle members. Circle was not deleted.');
        return;
      }
      const { error: circleError } = await supabase.from('circles').delete().eq('id', circleId);
      if (circleError) {
        // Members were already deleted but circle delete failed — log for manual cleanup
        console.error('Circle members deleted but circle delete failed (orphaned state):', circleError);
        Alert.alert('Delete Error', 'Circle members were removed but the circle itself could not be deleted. Please try again.');
        return;
      }
      navigation.navigate('CirclesList');
    } catch (e) {
      console.error('Unexpected error deleting circle:', e);
      Alert.alert('Error', 'Something went wrong while deleting the circle.');
    }
  };

  const handleLeaveCircle = async () => {
    if (!currentUserId) return;
    await supabase.from('circle_members').delete().eq('circle_id', circleId).eq('user_id', currentUserId);
    navigation.navigate('CirclesList');
  };

  const copyInviteCode = async () => {
    if (circle?.invite_code) {
      await Clipboard.setStringAsync(circle.invite_code);
      setCopiedInvite(true);
      setTimeout(() => setCopiedInvite(false), 2000);
    }
  };

  const regenerateInvite = async () => {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    await save({ invite_code: code });
  };

  const addTag = () => {
    const t = tagInput.trim().toLowerCase();
    if (t && !tags.includes(t)) {
      const newTags = [...tags, t];
      setTags(newTags);
      save({ tags: newTags });
    }
    setTagInput('');
  };

  const removeTag = (t: string) => {
    const newTags = tags.filter(x => x !== t);
    setTags(newTags);
    save({ tags: newTags });
  };

  const addRule = () => {
    const r = ruleInput.trim();
    if (r) { setRules([...rules, r]); setRuleInput(''); markChanged(); }
  };

  const removeRule = (i: number) => { setRules(rules.filter((_, idx) => idx !== i)); markChanged(); };

  if (loading) {
    return <LoadingScreen />;
  }

  const readOnly = !isCreator;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: accentColor + '30' }]}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>←</Text>
        </Pressable>
        <View style={[styles.previewBubble, { backgroundColor: accentColor + '20', borderColor: accentColor + '50', overflow: 'hidden' }]}>
          {circleImageUrl ? (
            <Image source={{ uri: circleImageUrl }} style={{ width: 48, height: 48, borderRadius: 24 }} />
          ) : (
            <Text style={{ fontSize: 28 }}>{icon}</Text>
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>{name.toUpperCase() || 'SETTINGS'}</Text>
          <Text style={[styles.headerSub, { color: accentColor }]}>
            {isCreator ? 'CIRCLE SETTINGS' : 'CIRCLE INFO'}
          </Text>
        </View>
        {saving && <ActivityIndicator color={accentColor} size="small" />}
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* ─── Icon Picker ─── */}
        <Section title="CIRCLE ICON" accentColor={accentColor}>
          {!readOnly && (
            <View style={{ marginBottom: 12 }}>
              {circleImageUrl ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <Image source={{ uri: circleImageUrl }} style={{ width: 56, height: 56, borderRadius: 28, borderWidth: 1.5, borderColor: accentColor + '50' }} />
                  <Pressable onPress={removeImage} style={[styles.smallBtn, { backgroundColor: '#ef4444' }]}>
                    <Text style={styles.smallBtnText}>REMOVE</Text>
                  </Pressable>
                </View>
              ) : null}
              <Pressable onPress={pickImage} style={[styles.smallBtn, { backgroundColor: accentColor, marginTop: circleImageUrl ? 8 : 0, alignSelf: 'flex-start' }]}>
                {uploadingImage ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.smallBtnText}>📷 UPLOAD IMAGE</Text>
                )}
              </Pressable>
            </View>
          )}
          {Object.entries(EMOJI_CATEGORIES).map(([cat, emojis]) => (
            <View key={cat}>
              <Pressable
                onPress={() => setExpandedEmoji(expandedEmoji === cat ? null : cat)}
                style={styles.emojiCatHeader}
              >
                <Text style={styles.emojiCatLabel}>{cat}</Text>
                <Text style={styles.emojiCatArrow}>{expandedEmoji === cat ? '▾' : '▸'}</Text>
              </Pressable>
              {expandedEmoji === cat && (
                <View style={styles.emojiGrid}>
                  {emojis.map(e => (
                    <Pressable
                      key={e}
                      onPress={() => { if (!readOnly) { setIcon(e); setCircleImageUrl(undefined); markChanged(); save({ icon: e, circle_image_url: null }); } }}
                      style={[
                        styles.emojiBtn,
                        icon === e && { backgroundColor: accentColor + '30', borderColor: accentColor },
                      ]}
                    >
                      <Text style={{ fontSize: 22 }}>{e}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
          ))}
        </Section>

        {/* ─── Accent Color ─── */}
        <Section title="ACCENT COLOR" accentColor={accentColor}>
          <View style={styles.colorGrid}>
            {ACCENT_COLORS.map(c => (
              <Pressable
                key={c}
                onPress={() => { if (!readOnly) { setAccentColor(c); save({ accent_color: c }); } }}
                style={[
                  styles.colorBtn,
                  { backgroundColor: c },
                  accentColor === c && { borderColor: '#fff', borderWidth: 2.5, transform: [{ scale: 1.15 }] },
                ]}
              />
            ))}
          </View>
          {!readOnly && (
            <View style={styles.hexRow}>
              <Text style={styles.hexLabel}>HEX</Text>
              <TextInput
                style={styles.hexInput}
                value={customHex}
                onChangeText={setCustomHex}
                placeholder="#000000"
                placeholderTextColor="#333"
                maxLength={7}
                onSubmitEditing={() => {
                  if (/^#[0-9a-fA-F]{6}$/.test(customHex)) {
                    setAccentColor(customHex);
                    save({ accent_color: customHex });
                  }
                }}
              />
            </View>
          )}
        </Section>

        {/* ─── Name & Description ─── */}
        <Section title="NAME & DESCRIPTION" accentColor={accentColor}>
          <TextInput
            style={styles.nameInput}
            value={name}
            onChangeText={v => { setName(v); markChanged(); }}
            editable={!readOnly}
            placeholder="CIRCLE NAME"
            placeholderTextColor="#333"
            onBlur={() => name.trim() && save({ name: name.trim() })}
          />
          <Text style={styles.namePreview}>{name.toUpperCase()}</Text>
          <TextInput
            style={styles.descInput}
            value={description}
            onChangeText={v => { setDescription(v); markChanged(); }}
            editable={!readOnly}
            placeholder="What's this circle about?"
            placeholderTextColor="#333"
            multiline
            numberOfLines={3}
            onBlur={() => save({ description })}
          />
        </Section>

        {/* ─── Circle Type ─── */}
        <Section title="CIRCLE TYPE" accentColor={accentColor}>
          <View style={styles.typeGrid}>
            {CIRCLE_TYPES.map(t => (
              <Pressable
                key={t}
                onPress={() => { if (!readOnly) { setCircleType(t); save({ circle_type: t }); } }}
                style={[
                  styles.typeChip,
                  circleType === t && { backgroundColor: accentColor + '25', borderColor: accentColor },
                ]}
              >
                <Text style={[
                  styles.typeChipText,
                  circleType === t && { color: accentColor },
                ]}>
                  {t.toUpperCase()}
                </Text>
              </Pressable>
            ))}
          </View>
        </Section>

        {/* ─── Tags ─── */}
        <Section title="TAGS" accentColor={accentColor}>
          <View style={styles.tagWrap}>
            {tags.map(t => (
              <Pressable key={t} onPress={() => !readOnly && removeTag(t)} style={[styles.tag, { borderColor: accentColor + '50' }]}>
                <Text style={[styles.tagText, { color: accentColor }]}>{t} ✕</Text>
              </Pressable>
            ))}
          </View>
          {!readOnly && (
            <>
              <View style={styles.hexRow}>
                <TextInput
                  style={[styles.hexInput, { flex: 1 }]}
                  value={tagInput}
                  onChangeText={setTagInput}
                  placeholder="Add tag..."
                  placeholderTextColor="#333"
                  onSubmitEditing={addTag}
                />
                <Pressable onPress={addTag} style={[styles.smallBtn, { backgroundColor: accentColor }]}>
                  <Text style={styles.smallBtnText}>ADD</Text>
                </Pressable>
              </View>
              <View style={styles.tagWrap}>
                {SUGGESTED_TAGS.filter(s => !tags.includes(s)).map(s => (
                  <Pressable key={s} onPress={() => { const nt = [...tags, s]; setTags(nt); save({ tags: nt }); }} style={styles.suggestedTag}>
                    <Text style={styles.suggestedTagText}>+ {s}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}
        </Section>

        {/* ─── Check-In Format ─── */}
        <Section title="CHECK-IN FORMAT" accentColor={accentColor}>
          <View style={styles.typeGrid}>
            {CHECKIN_TYPES.map(t => (
              <Pressable
                key={t}
                onPress={() => {
                  if (readOnly) return;
                  const f: CheckInFormat = { type: t };
                  if (t === 'rating') { f.min = 1; f.max = 5; }
                  setCheckInFormat(f);
                  save({ check_in_format: f });
                }}
                style={[
                  styles.typeChip,
                  checkInFormat.type === t && { backgroundColor: accentColor + '25', borderColor: accentColor },
                ]}
              >
                <Text style={[styles.typeChipText, checkInFormat.type === t && { color: accentColor }]}>
                  {t.toUpperCase()}
                </Text>
              </Pressable>
            ))}
          </View>
          {!readOnly && (
            <View style={{ gap: 8, marginTop: 8 }}>
              <TextInput
                style={styles.hexInput}
                value={checkInFormat.label || ''}
                onChangeText={l => setCheckInFormat({ ...checkInFormat, label: l })}
                placeholder="Label (e.g. Daily check-in)"
                placeholderTextColor="#333"
                onBlur={() => save({ check_in_format: checkInFormat })}
              />
              {checkInFormat.type === 'number' && (
                <TextInput
                  style={styles.hexInput}
                  value={checkInFormat.unit || ''}
                  onChangeText={u => setCheckInFormat({ ...checkInFormat, unit: u })}
                  placeholder="Unit (e.g. steps, pages)"
                  placeholderTextColor="#333"
                  onBlur={() => save({ check_in_format: checkInFormat })}
                />
              )}
              {checkInFormat.type === 'rating' && (
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TextInput
                    style={[styles.hexInput, { flex: 1 }]}
                    value={String(checkInFormat.min || 1)}
                    onChangeText={v => setCheckInFormat({ ...checkInFormat, min: Number(v) || 1 })}
                    placeholder="Min"
                    placeholderTextColor="#333"
                    keyboardType="numeric"
                    onBlur={() => save({ check_in_format: checkInFormat })}
                  />
                  <TextInput
                    style={[styles.hexInput, { flex: 1 }]}
                    value={String(checkInFormat.max || 5)}
                    onChangeText={v => setCheckInFormat({ ...checkInFormat, max: Number(v) || 5 })}
                    placeholder="Max"
                    placeholderTextColor="#333"
                    keyboardType="numeric"
                    onBlur={() => save({ check_in_format: checkInFormat })}
                  />
                </View>
              )}
            </View>
          )}
        </Section>

        {/* ─── Fun Extras ─── */}
        <Section title="FUN EXTRAS" accentColor={accentColor}>
          <Text style={styles.fieldLabel}>CIRCLE VIBE</Text>
          <TextInput
            style={styles.hexInput}
            value={vibe}
            onChangeText={v => { setVibe(v); markChanged(); }}
            editable={!readOnly}
            placeholder='e.g. "GRINDING MODE 🔥"'
            placeholderTextColor="#333"
          />

          <Text style={[styles.fieldLabel, { marginTop: 14 }]}>CIRCLE RULES</Text>
          {rules.map((r, i) => (
            <View key={i} style={styles.ruleRow}>
              <Text style={styles.ruleNum}>{i + 1}.</Text>
              <Text style={styles.ruleText}>{r}</Text>
              {!readOnly && (
                <Pressable onPress={() => removeRule(i)}>
                  <Text style={{ color: '#ef4444', fontSize: 12 }}>✕</Text>
                </Pressable>
              )}
            </View>
          ))}
          {!readOnly && (
            <View style={styles.hexRow}>
              <TextInput
                style={[styles.hexInput, { flex: 1 }]}
                value={ruleInput}
                onChangeText={setRuleInput}
                placeholder="Add a rule..."
                placeholderTextColor="#333"
                onSubmitEditing={addRule}
              />
              <Pressable onPress={addRule} style={[styles.smallBtn, { backgroundColor: accentColor }]}>
                <Text style={styles.smallBtnText}>ADD</Text>
              </Pressable>
            </View>
          )}

          <Text style={[styles.fieldLabel, { marginTop: 14 }]}>INVITE CODE</Text>
          <View style={styles.inviteRow}>
            <Text style={styles.inviteCode}>{circle?.invite_code || '—'}</Text>
            <Pressable onPress={copyInviteCode} style={[styles.smallBtn, { backgroundColor: accentColor }]}>
              <Text style={styles.smallBtnText}>{copiedInvite ? 'COPIED!' : 'COPY'}</Text>
            </Pressable>
            {isCreator && (
              <Pressable onPress={regenerateInvite} style={[styles.smallBtn, { backgroundColor: '#333' }]}>
                <Text style={styles.smallBtnText}>REGEN</Text>
              </Pressable>
            )}
          </View>
        </Section>

        {/* ─── Danger Zone ─── */}
        <Section title="DANGER ZONE" accentColor="#ef4444">
          <Pressable onPress={handleLeaveCircle} style={styles.dangerBtn}>
            <Text style={styles.dangerBtnText}>LEAVE CIRCLE</Text>
          </Pressable>
          {isCreator && (
            <Pressable onPress={handleDeleteCircle} style={[styles.dangerBtn, { backgroundColor: '#ef444415', borderColor: '#ef4444' }]}>
              <Text style={[styles.dangerBtnText, { color: '#ef4444' }]}>
                {deleteConfirm ? 'TAP AGAIN TO CONFIRM DELETE' : 'DELETE CIRCLE'}
              </Text>
            </Pressable>
          )}
        </Section>

        <View style={{ height: 80 }} />
      </ScrollView>

      {/* Save Changes Button */}
      {(hasChanges || showSaved) && !readOnly && (
        <Animated.View style={[
          styles.saveButtonContainer,
          { transform: [{ translateY: saveButtonAnim.interpolate({ inputRange: [0, 1], outputRange: [80, 0] }) }] },
        ]}>
          <Pressable
            onPress={showSaved ? undefined : saveAll}
            style={[styles.saveButton, { backgroundColor: showSaved ? '#22c55e' : accentColor }]}
            disabled={saving || showSaved}
          >
            {saving ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.saveButtonText}>{showSaved ? 'SAVED ✓' : 'SAVE CHANGES'}</Text>
            )}
          </Pressable>
        </Animated.View>
      )}
    </View>
  );
}

// ─── Section Component ───────────────────────────────────────────────────────

function Section({ title, accentColor, children }: { title: string; accentColor: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: accentColor }]}>{title}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const web = (s: any) => Platform.OS === 'web' ? s : {};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingTop: 60, paddingHorizontal: 16, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: '#000000',
    maxWidth: 580, alignSelf: 'center', width: '100%',
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: '#111',
    borderWidth: 1, borderColor: '#222', justifyContent: 'center', alignItems: 'center',
    ...web({ cursor: 'pointer' }),
  },
  backText: { color: '#888', fontSize: 18 },
  previewBubble: {
    width: 48, height: 48, borderRadius: 24,
    justifyContent: 'center', alignItems: 'center', borderWidth: 1.5,
  },
  headerTitle: { color: '#fff', fontSize: 14, fontWeight: '900', letterSpacing: 2 },
  headerSub: { fontSize: 9, fontWeight: '800', letterSpacing: 2, marginTop: 2 },

  scroll: { flex: 1 },
  scrollContent: { maxWidth: 580, alignSelf: 'center', width: '100%', padding: 16 },

  section: { marginBottom: 20 },
  sectionTitle: { fontSize: 10, fontWeight: '800', letterSpacing: 2, marginBottom: 8 },
  card: {
    backgroundColor: '#111', borderWidth: 1, borderColor: '#000000',
    borderRadius: 12, padding: 14,
  },

  // Emoji
  emojiCatHeader: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 },
  emojiCatLabel: { color: '#555', fontSize: 9, fontWeight: '800', letterSpacing: 2 },
  emojiCatArrow: { color: '#444', fontSize: 10 },
  emojiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingBottom: 10 },
  emojiBtn: {
    width: 40, height: 40, borderRadius: 10, backgroundColor: '#000000',
    borderWidth: 1, borderColor: '#222', justifyContent: 'center', alignItems: 'center',
    ...web({ cursor: 'pointer', transition: 'all 0.15s ease' }),
  },

  // Colors
  colorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 10 },
  colorBtn: {
    width: 36, height: 36, borderRadius: 18, borderWidth: 1.5, borderColor: 'transparent',
    ...web({ cursor: 'pointer', transition: 'all 0.15s ease' }),
  },

  // Hex
  hexRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  hexLabel: { color: '#555', fontSize: 9, fontWeight: '800', letterSpacing: 2 },
  hexInput: {
    backgroundColor: '#000000', borderWidth: 1, borderColor: '#222', borderRadius: 8,
    color: '#fff', fontSize: 13, fontWeight: '600', paddingHorizontal: 10, paddingVertical: 8,
  },

  // Name
  nameInput: {
    backgroundColor: '#000000', borderWidth: 1, borderColor: '#222', borderRadius: 8,
    color: '#fff', fontSize: 15, fontWeight: '800', paddingHorizontal: 12, paddingVertical: 10,
    letterSpacing: 1,
  },
  namePreview: { color: '#333', fontSize: 10, fontWeight: '800', letterSpacing: 2, marginTop: 6 },
  descInput: {
    backgroundColor: '#000000', borderWidth: 1, borderColor: '#222', borderRadius: 8,
    color: '#ccc', fontSize: 13, paddingHorizontal: 12, paddingVertical: 10, marginTop: 8,
    minHeight: 60, textAlignVertical: 'top',
  },

  // Type chips
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  typeChip: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
    backgroundColor: '#000000', borderWidth: 1, borderColor: '#222',
    ...web({ cursor: 'pointer', transition: 'all 0.15s ease' }),
  },
  typeChipText: { color: '#555', fontSize: 10, fontWeight: '800', letterSpacing: 1 },

  // Tags
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 },
  tag: {
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1,
    ...web({ cursor: 'pointer' }),
  },
  tagText: { fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  suggestedTag: {
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6,
    backgroundColor: '#000000', borderWidth: 1, borderColor: '#000000',
    ...web({ cursor: 'pointer' }),
  },
  suggestedTagText: { color: '#444', fontSize: 10, fontWeight: '700' },

  // Small btn
  smallBtn: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
    ...web({ cursor: 'pointer' }),
  },
  smallBtnText: { color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 1 },

  // Fields
  fieldLabel: { color: '#555', fontSize: 9, fontWeight: '800', letterSpacing: 2, marginBottom: 6 },

  // Rules
  ruleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  ruleNum: { color: '#444', fontSize: 12, fontWeight: '800' },
  ruleText: { color: '#aaa', fontSize: 12, flex: 1 },

  // Invite
  inviteRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  inviteCode: { color: '#fff', fontSize: 16, fontWeight: '900', letterSpacing: 3, fontFamily: Platform.OS === 'web' ? 'monospace' : undefined },

  // Danger
  dangerBtn: {
    paddingVertical: 12, borderRadius: 10, alignItems: 'center',
    backgroundColor: '#ef444410', borderWidth: 1, borderColor: '#ef444440', marginBottom: 8,
    ...web({ cursor: 'pointer', transition: 'all 0.15s ease' }),
  },
  dangerBtnText: { color: '#ef4444', fontSize: 11, fontWeight: '800', letterSpacing: 2 },

  // Save button
  saveButtonContainer: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingHorizontal: 16, paddingBottom: Platform.OS === 'ios' ? 34 : 16, paddingTop: 10,
    backgroundColor: '#000000E0',
    maxWidth: 580, alignSelf: 'center', width: '100%',
  },
  saveButton: {
    borderRadius: 12, paddingVertical: 14, alignItems: 'center', justifyContent: 'center',
    ...web({ cursor: 'pointer', transition: 'all 0.15s ease' }),
  },
  saveButtonText: { color: '#fff', fontSize: 14, fontWeight: '900', letterSpacing: 2 },
});
