import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Pressable,
  Alert,
  Platform,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { User, Achievement } from '../../types';
import Card from '../../components/Card';
import Button from '../../components/Button';
import { getAllAchievements, getUserAchievements } from '../../lib/gamification';

const THEME_COLORS = [
  '#6366f1', // Indigo
  '#a855f7', // Purple
  '#22d3ee', // Cyan
  '#22c55e', // Green
  '#f43f5e', // Rose
  '#f59e0b', // Amber
  '#3b82f6', // Blue
  '#fbbf24', // Gold
];

export default function EditProfileScreen({ navigation }: any) {
  const [profile, setProfile] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [userAchievements, setUserAchievements] = useState<any[]>([]);
  
  // Form fields
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [themeColor, setThemeColor] = useState('#6366f1');
  const [pinnedAchievements, setPinnedAchievements] = useState<string[]>([]);

  useEffect(() => {
    loadProfile();
    loadAchievements();
  }, []);

  const loadProfile = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: profileData } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (profileData) {
      setProfile(profileData);
      setDisplayName(profileData.display_name || '');
      setBio(profileData.bio || '');
      setStatusMessage(profileData.status_message || '');
      setThemeColor(profileData.theme_color || '#6366f1');
      setPinnedAchievements(profileData.pinned_achievements || []);
    }
  };

  const loadAchievements = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const [allAchievements, userAchs] = await Promise.all([
      getAllAchievements(),
      getUserAchievements(user.id),
    ]);

    setAchievements(allAchievements);
    setUserAchievements(userAchs);
  };

  const handleSave = async () => {
    if (!profile) return;
    
    setLoading(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          display_name: displayName.trim(),
          bio: bio.trim(),
          status_message: statusMessage.trim(),
          theme_color: themeColor,
          pinned_achievements: pinnedAchievements,
        })
        .eq('id', profile.id);

      if (error) throw error;

      Alert.alert('Success', 'Profile updated!');
      navigation.goBack();
    } catch (error: any) {
      Alert.alert('Error', error.message);
    }
    setLoading(false);
  };

  const handleSignOut = async () => {
    if (Platform.OS === 'web') {
      if (window.confirm('Sign out now?')) {
        await supabase.auth.signOut({ scope: 'local' });
      }
      return;
    }

    Alert.alert('Sign Out', 'Sign out now?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: () => { void supabase.auth.signOut({ scope: 'local' }); } },
    ]);
  };

  const togglePinnedAchievement = (achievementId: string) => {
    setPinnedAchievements(prev => {
      if (prev.includes(achievementId)) {
        return prev.filter(id => id !== achievementId);
      } else if (prev.length < 3) {
        return [...prev, achievementId];
      } else {
        // Replace the first pinned achievement
        return [prev[1], prev[2], achievementId];
      }
    });
  };

  const unlockedIds = new Set(userAchievements.map(ua => ua.achievement_id));
  const unlockedAchievements = achievements.filter(a => unlockedIds.has(a.id));

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()}>
          <Text style={styles.headerBack}>BACK</Text>
        </Pressable>
        <Text style={styles.headerTitle}>EDIT PROFILE</Text>
        <Pressable onPress={handleSignOut}>
          <Text style={styles.headerSignOut}>SIGN OUT</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.inner}>
          {/* Avatar Section */}
          <Card style={styles.avatarSection}>
            <View style={[styles.avatarRing, { borderColor: themeColor }]}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {displayName.charAt(0)?.toUpperCase() || '?'}
                </Text>
              </View>
            </View>
            <Button
              title="UPLOAD AVATAR"
              variant="ghost"
              onPress={() => Alert.alert('Coming Soon', 'Avatar upload will be available soon!')}
              style={styles.uploadButton}
            />
          </Card>

          {/* Banner Section */}
          <Card style={styles.section}>
            <Text style={styles.sectionTitle}>BANNER</Text>
            <View style={styles.bannerPreview}>
              <Text style={styles.bannerPlaceholder}>Banner Preview</Text>
            </View>
            <Button
              title="UPLOAD BANNER"
              variant="ghost"
              onPress={() => Alert.alert('Coming Soon', 'Banner upload will be available soon!')}
              style={styles.uploadButton}
            />
          </Card>

          {/* Basic Info */}
          <Card style={styles.section}>
            <Text style={styles.sectionTitle}>BASIC INFO</Text>
            
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>DISPLAY NAME</Text>
              <TextInput
                style={styles.textInput}
                value={displayName}
                onChangeText={setDisplayName}
                placeholder="Your display name"
                placeholderTextColor="#444"
                maxLength={50}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>BIO</Text>
              <TextInput
                style={[styles.textInput, styles.textArea]}
                value={bio}
                onChangeText={setBio}
                placeholder="Tell the world about yourself..."
                placeholderTextColor="#444"
                multiline
                maxLength={200}
              />
              <Text style={styles.charCount}>{bio.length}/200</Text>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>STATUS MESSAGE</Text>
              <TextInput
                style={styles.textInput}
                value={statusMessage}
                onChangeText={setStatusMessage}
                placeholder="grinding 24/7, in the zone, etc."
                placeholderTextColor="#444"
                maxLength={50}
              />
            </View>
          </Card>

          {/* Theme Color */}
          <Card style={styles.section}>
            <Text style={styles.sectionTitle}>THEME COLOR</Text>
            <Text style={styles.sectionDesc}>Choose your profile accent color</Text>
            
            <View style={styles.colorGrid}>
              {THEME_COLORS.map(color => (
                <Pressable
                  key={color}
                  style={[
                    styles.colorOption,
                    { backgroundColor: color },
                    themeColor === color && styles.colorSelected,
                  ]}
                  onPress={() => setThemeColor(color)}
                >
                  {themeColor === color && (
                    <Text style={styles.colorCheckmark}>✓</Text>
                  )}
                </Pressable>
              ))}
            </View>
          </Card>

          {/* Pinned Achievements */}
          <Card style={styles.section}>
            <Text style={styles.sectionTitle}>PINNED ACHIEVEMENTS</Text>
            <Text style={styles.sectionDesc}>
              Select up to 3 achievements to showcase ({pinnedAchievements.length}/3)
            </Text>
            
            {unlockedAchievements.length === 0 ? (
              <Text style={styles.emptyText}>No achievements unlocked yet. Start grinding!</Text>
            ) : (
              <View style={styles.achievementGrid}>
                {unlockedAchievements.map(achievement => (
                  <Pressable
                    key={achievement.id}
                    style={[
                      styles.achievementItem,
                      pinnedAchievements.includes(achievement.id) && styles.achievementSelected,
                    ]}
                    onPress={() => togglePinnedAchievement(achievement.id)}
                  >
                    <Text style={styles.achievementIcon}>{achievement.icon}</Text>
                    <Text style={styles.achievementName}>{achievement.name}</Text>
                    {pinnedAchievements.includes(achievement.id) && (
                      <View style={styles.pinnedBadge}>
                        <Text style={styles.pinnedText}>PINNED</Text>
                      </View>
                    )}
                  </Pressable>
                ))}
              </View>
            )}
          </Card>

          <View style={{ height: 20 }} />
          <Button
            title="SAVE CHANGES"
            onPress={handleSave}
            loading={loading}
          />
          <View style={{ height: 40 }} />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 60,
    paddingBottom: 20,
    paddingHorizontal: 24,
    borderBottomWidth: 1,
    borderBottomColor: '#000000',
    maxWidth: 720,
    alignSelf: 'center',
    width: '100%',
  },
  headerBack: { color: '#6366f1', fontSize: 14, fontWeight: '700' },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '900', letterSpacing: 2 },
  headerSignOut: { color: '#ef4444', fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  scrollContent: { flexGrow: 1 },
  inner: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
  },

  // Avatar
  avatarSection: { alignItems: 'center', marginBottom: 16 },
  avatarRing: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 3,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  avatar: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: '#2a2a2a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: { color: '#fff', fontSize: 36, fontWeight: '900' },
  uploadButton: { marginTop: 8 },

  // Banner
  bannerPreview: {
    height: 120,
    backgroundColor: '#000000',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: 12,
  },
  bannerPlaceholder: { color: '#444', fontSize: 14 },

  // Section
  section: { marginBottom: 16 },
  sectionTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 2,
    marginBottom: 8,
  },
  sectionDesc: {
    color: '#666',
    fontSize: 12,
    marginBottom: 12,
    lineHeight: 16,
  },

  // Input
  inputGroup: { marginBottom: 16 },
  inputLabel: {
    color: '#888',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 6,
  },
  textInput: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#222',
    borderRadius: 8,
    padding: 14,
    color: '#fff',
    fontSize: 14,
  },
  textArea: { minHeight: 80, textAlignVertical: 'top' },
  charCount: {
    color: '#444',
    fontSize: 10,
    textAlign: 'right',
    marginTop: 4,
  },

  // Colors
  colorGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  colorOption: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  colorSelected: {
    borderWidth: 3,
    borderColor: '#fff',
  },
  colorCheckmark: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '900',
  },

  // Achievements
  emptyText: { color: '#444', fontSize: 14, textAlign: 'center', padding: 20 },
  achievementGrid: { gap: 8 },
  achievementItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#000000',
    borderWidth: 1,
    borderColor: '#222',
    borderRadius: 8,
    padding: 12,
    position: 'relative',
  },
  achievementSelected: {
    borderColor: '#6366f1',
    backgroundColor: '#6366f115',
  },
  achievementIcon: { fontSize: 24, marginRight: 12 },
  achievementName: { color: '#fff', fontSize: 14, flex: 1 },
  pinnedBadge: {
    backgroundColor: '#6366f1',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  pinnedText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1,
  },
});



