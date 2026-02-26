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
  ScrollView,
  Animated,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { showAlert } from '../../lib/alert';
import Button from '../../components/Button';
import Card from '../../components/Card';
import { awardXP, getXPForAction } from '../../lib/gamification';
import { CircleTemplate, CheckInFormat } from '../../types';

const CIRCLE_TEMPLATES: CircleTemplate[] = [
  {
    id: 'fitness',
    name: 'Fitness',
    emoji: '💪',
    category: 'Health',
    description: 'Track workouts, runs, and healthy habits',
    accent_color: '#ef4444',
    suggested_names: ['Iron Temple', 'Sweat Squad', 'Fitness Freaks', 'Grind Gang'],
    check_in_format: { type: 'photo', label: 'Workout Proof' },
    tags: ['fitness', 'health', 'exercise']
  },
  {
    id: 'money',
    name: 'Money',
    emoji: '💰',
    category: 'Finance',
    description: 'Save money, track expenses, build wealth',
    accent_color: '#22c55e',
    suggested_names: ['Money Makers', 'Wealth Builders', 'Cash Crew', 'Profit Pack'],
    check_in_format: { type: 'number', label: 'Amount Saved', unit: 'dollars' },
    tags: ['money', 'finance', 'savings']
  },
  {
    id: 'learning',
    name: 'Learning',
    emoji: '📚',
    category: 'Education',
    description: 'Read books, take courses, learn new skills',
    accent_color: '#3b82f6',
    suggested_names: ['Book Club', 'Knowledge Seekers', 'Learn Squad', 'Study Buddies'],
    check_in_format: { type: 'number', label: 'Pages Read', unit: 'pages' },
    tags: ['learning', 'books', 'education']
  },
  {
    id: 'mental-health',
    name: 'Mental Health',
    emoji: '🧠',
    category: 'Wellness',
    description: 'Meditation, therapy, mindfulness practice',
    accent_color: '#8b5cf6',
    suggested_names: ['Mind Matters', 'Zen Circle', 'Peace Squad', 'Mental Warriors'],
    check_in_format: { type: 'rating', label: 'Mood Rating', min: 1, max: 10 },
    tags: ['mental-health', 'wellness', 'mindfulness']
  },
  {
    id: 'relationships',
    name: 'Relationships',
    emoji: '❤️',
    category: 'Social',
    description: 'Build deeper connections with family & friends',
    accent_color: '#ec4899',
    suggested_names: ['Love Circle', 'Connection Crew', 'Heart Squad', 'Bond Builders'],
    check_in_format: { type: 'text', label: 'Connection Made' },
    tags: ['relationships', 'social', 'family']
  },
  {
    id: 'career',
    name: 'Career',
    emoji: '🎯',
    category: 'Professional',
    description: 'Level up your career and professional skills',
    accent_color: '#f59e0b',
    suggested_names: ['Career Climbers', 'Success Squad', 'Ambition Circle', 'Goal Getters'],
    check_in_format: { type: 'text', label: 'Progress Made' },
    tags: ['career', 'professional', 'goals']
  },
  {
    id: 'productivity',
    name: 'Productivity',
    emoji: '⏰',
    category: 'Efficiency',
    description: 'Get things done, manage time, build systems',
    accent_color: '#06b6d4',
    suggested_names: ['Productivity Pack', 'Efficiency Experts', 'Time Masters', 'Done Squad'],
    check_in_format: { type: 'number', label: 'Tasks Completed', unit: 'tasks' },
    tags: ['productivity', 'time-management', 'efficiency']
  },
  {
    id: 'nutrition',
    name: 'Nutrition',
    emoji: '🍳',
    category: 'Health',
    description: 'Eat better, cook more, build healthy eating habits',
    accent_color: '#84cc16',
    suggested_names: ['Nutrition Squad', 'Healthy Eaters', 'Kitchen Crew', 'Fuel Team'],
    check_in_format: { type: 'photo', label: 'Healthy Meal' },
    tags: ['nutrition', 'cooking', 'health']
  },
  {
    id: 'purpose',
    name: 'Purpose',
    emoji: '🙏',
    category: 'Spiritual',
    description: 'Find meaning, spiritual growth, volunteering',
    accent_color: '#a855f7',
    suggested_names: ['Purpose Squad', 'Meaning Makers', 'Spirit Circle', 'Mission Crew'],
    check_in_format: { type: 'text', label: 'Meaningful Action' },
    tags: ['purpose', 'spiritual', 'meaning']
  },
  {
    id: 'gaming',
    name: 'Gaming',
    emoji: '🎮',
    category: 'Entertainment',
    description: 'Game together, esports training, streaming',
    accent_color: '#7c3aed',
    suggested_names: ['Gaming Squad', 'Esports Elite', 'Game Night', 'Console Crew'],
    check_in_format: { type: 'text', label: 'Games Played' },
    tags: ['gaming', 'esports', 'entertainment']
  },
  {
    id: 'creative',
    name: 'Creative',
    emoji: '🎨',
    category: 'Art',
    description: 'Art, music, writing, creative projects',
    accent_color: '#f97316',
    suggested_names: ['Creative Collective', 'Art Squad', 'Makers Circle', 'Creative Minds'],
    check_in_format: { type: 'photo', label: 'Creative Work' },
    tags: ['creative', 'art', 'music']
  },
  // ─── AI-Era Circles ──────────────────────────────────────────────────
  {
    id: 'builder',
    name: 'Builder',
    emoji: '🚀',
    category: 'AI Builder',
    description: 'Developers using Claude Code, OpenClaw, or any AI coding agent to ship software',
    accent_color: '#6366f1',
    suggested_names: ['Ship It Circle', 'Builder Squad', 'The Code Crew', 'Agent Army'],
    check_in_format: { type: 'text', label: "What did your AI build today?" },
    tags: ['builder', 'developer', 'claude-code', 'openclaw', 'ai-coding']
  },
  {
    id: 'creator',
    name: 'Creator',
    emoji: '✍️',
    category: 'AI Creator',
    description: 'Content creators, marketers, and writers using AI tools to create and publish',
    accent_color: '#f97316',
    suggested_names: ['Create & Ship', 'Content Circle', 'The Creators', 'Publish Squad'],
    check_in_format: { type: 'text', label: "What did you create or publish today?" },
    tags: ['creator', 'content', 'marketing', 'writing', 'cowork']
  },
  {
    id: 'operator',
    name: 'Operator',
    emoji: '💼',
    category: 'AI Business',
    description: 'Business owners and operators using AI (Claude Cowork, ChatGPT, etc.) to run and grow their business',
    accent_color: '#22c55e',
    suggested_names: ['Operators Circle', 'Business Builders', 'The Operators', 'Revenue Circle'],
    check_in_format: { type: 'text', label: "What did your AI handle for your business today?" },
    tags: ['business', 'operator', 'cowork', 'revenue', 'ai-tools']
  },
  {
    id: 'researcher',
    name: 'Researcher',
    emoji: '🔬',
    category: 'AI Research',
    description: 'Analysts, researchers, and knowledge workers using AI to research, synthesize, and decide',
    accent_color: '#06b6d4',
    suggested_names: ['Research Circle', 'The Analysts', 'Deep Dive Crew', 'Signal Squad'],
    check_in_format: { type: 'text', label: "What did you learn or ship from your research today?" },
    tags: ['research', 'analysis', 'knowledge-work', 'cowork']
  },
  {
    id: 'custom',
    name: 'Custom',
    emoji: '✨',
    category: 'Custom',
    description: 'Create your own unique circle type',
    accent_color: '#6366f1',
    suggested_names: ['Custom Circle', 'Unique Squad', 'Special Crew', 'Your Circle'],
    check_in_format: { type: 'text', label: 'Daily Check-in' },
    tags: ['custom']
  }
];

const ACCENT_COLORS = [
  '#6366f1', '#3b82f6', '#06b6d4', '#10b981', '#22c55e', '#84cc16',
  '#eab308', '#f59e0b', '#f97316', '#ef4444', '#ec4899', '#d946ef',
  '#a855f7', '#8b5cf6', '#7c3aed', '#6d28d9'
];

const CIRCLE_ICONS = [
  '🔥', '💪', '🎯', '⚡', '🚀', '💎', '⭐', '🏆', '💯', '🎨',
  '📚', '🧠', '❤️', '🌟', '💰', '⏰', '🍳', '🙏', '🎮', '✨',
  '🖥️', '👥', '✍️', '💼', '🔬', '🤖', '🐾', '📡', '🛠️', '🌐'
];

export default function CreateCircleScreen({ navigation }: any) {
  const [step, setStep] = useState<'template' | 'customize'>('template');
  const [selectedTemplate, setSelectedTemplate] = useState<CircleTemplate | null>(null);
  
  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [maxMembers, setMaxMembers] = useState(12);
  const [icon, setIcon] = useState('✨');
  const [accentColor, setAccentColor] = useState('#6366f1');
  const [checkInFormat, setCheckInFormat] = useState<CheckInFormat>({ type: 'text', label: 'Daily Check-in' });
  const [tags, setTags] = useState<string[]>([]);
  const [customTag, setCustomTag] = useState('');
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { width } = useWindowDimensions();
  const isWide = width > 500;

  const handleTemplateSelect = (template: CircleTemplate) => {
    setSelectedTemplate(template);
    setName(template.suggested_names[0]);
    setDescription(template.description);
    setIcon(template.emoji);
    setAccentColor(template.accent_color);
    setCheckInFormat(template.check_in_format);
    setTags([...template.tags]);
    setStep('customize');
  };

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
        circle_type: selectedTemplate?.id || 'custom',
        icon,
        accent_color: accentColor,
        check_in_format: checkInFormat,
        tags,
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

    // Award XP for creating a circle
    awardXP(user.id, getXPForAction('circle_create'), 'circle_create', { circle_id: circle.id }).catch(console.error);

    setLoading(false);
    showAlert('Circle created!', `Invite code: ${circle.invite_code}`);
    navigation.goBack();
  };

  const addTag = () => {
    if (customTag.trim() && !tags.includes(customTag.trim())) {
      setTags([...tags, customTag.trim()]);
      setCustomTag('');
    }
  };

  const removeTag = (tagToRemove: string) => {
    setTags(tags.filter(tag => tag !== tagToRemove));
  };

  if (step === 'template') {
    return (
      <View style={styles.container}>
        <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
          <View style={styles.headerSection}>
            <View style={styles.logoCircle}>
              <Text style={styles.logoText}>+</Text>
            </View>
            <Text style={styles.title}>CHOOSE YOUR</Text>
            <Text style={styles.titleBold}>CIRCLE TYPE</Text>
            <Text style={styles.subtitle}>Pick a template to get started, customize everything later</Text>
          </View>

          <View style={styles.templatesGrid}>
            {CIRCLE_TEMPLATES.map((template, index) => (
              <TemplateCard
                key={template.id}
                template={template}
                onSelect={() => handleTemplateSelect(template)}
                delay={index * 50}
              />
            ))}
          </View>

          <Pressable onPress={() => navigation.goBack()} style={styles.cancelButton}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        <View style={[styles.card, isWide && styles.cardWide]}>
          <View style={styles.headerSection}>
            <Pressable onPress={() => setStep('template')} style={styles.backButton}>
              <Text style={styles.backText}>← Back to Templates</Text>
            </Pressable>
            
            <View style={[styles.logoCircle, { borderColor: accentColor }]}>
              <Text style={styles.logoText}>{icon}</Text>
            </View>
            <Text style={styles.title}>CUSTOMIZE YOUR</Text>
            <Text style={[styles.titleBold, { color: accentColor }]}>
              {selectedTemplate?.name?.toUpperCase() || 'CUSTOM'} CIRCLE
            </Text>
            <Text style={styles.subtitle}>Everything can be changed later — these are just starting points</Text>
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

            <Text style={styles.inputLabel}>DESCRIPTION</Text>
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

            <Text style={styles.inputLabel}>CIRCLE ICON</Text>
            <View style={styles.iconPicker}>
              {CIRCLE_ICONS.map((emoji) => (
                <Pressable
                  key={emoji}
                  style={[
                    styles.iconOption,
                    icon === emoji && { backgroundColor: accentColor }
                  ]}
                  onPress={() => setIcon(emoji)}
                >
                  <Text style={styles.iconText}>{emoji}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.inputLabel}>ACCENT COLOR</Text>
            <View style={styles.colorPicker}>
              {ACCENT_COLORS.map((color) => (
                <Pressable
                  key={color}
                  style={[
                    styles.colorOption,
                    { backgroundColor: color },
                    accentColor === color && styles.colorOptionSelected
                  ]}
                  onPress={() => setAccentColor(color)}
                />
              ))}
            </View>

            <Text style={styles.inputLabel}>CHECK-IN FORMAT</Text>
            <View style={styles.checkInPicker}>
              <CheckInFormatOption
                label="📝 Text Reflection"
                selected={checkInFormat.type === 'text'}
                onPress={() => setCheckInFormat({ type: 'text', label: 'Daily Check-in' })}
              />
              <CheckInFormatOption
                label="📸 Photo Proof"
                selected={checkInFormat.type === 'photo'}
                onPress={() => setCheckInFormat({ type: 'photo', label: 'Daily Photo' })}
              />
              <CheckInFormatOption
                label="🔢 Number Tracking"
                selected={checkInFormat.type === 'number'}
                onPress={() => setCheckInFormat({ type: 'number', label: 'Daily Count', unit: 'points' })}
              />
              <CheckInFormatOption
                label="✅ Yes/No"
                selected={checkInFormat.type === 'yesno'}
                onPress={() => setCheckInFormat({ type: 'yesno', label: 'Did you do it?' })}
              />
              <CheckInFormatOption
                label="⭐ Rating (1-10)"
                selected={checkInFormat.type === 'rating'}
                onPress={() => setCheckInFormat({ type: 'rating', label: 'Rate your day', min: 1, max: 10 })}
              />
            </View>

            <Text style={styles.inputLabel}>TAGS (OPTIONAL)</Text>
            <View style={styles.tagSection}>
              <View style={styles.tagInput}>
                <TextInput
                  style={styles.tagTextInput}
                  placeholder="Add a tag..."
                  placeholderTextColor="#444"
                  value={customTag}
                  onChangeText={setCustomTag}
                  onSubmitEditing={addTag}
                />
                <Button title="ADD" onPress={addTag} variant="ghost" />
              </View>
              <View style={styles.tagsList}>
                {tags.map((tag) => (
                  <Pressable key={tag} style={[styles.tag, { backgroundColor: accentColor + '20', borderColor: accentColor }]} onPress={() => removeTag(tag)}>
                    <Text style={[styles.tagText, { color: accentColor }]}>#{tag}</Text>
                    <Text style={styles.tagRemove}>×</Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <Text style={styles.inputLabel}>MAX MEMBERS</Text>
            <View style={styles.memberPicker}>
              {[3, 4, 5, 6, 8, 10, 12].map((n) => (
                <MemberOption
                  key={n}
                  value={n}
                  selected={maxMembers === n}
                  onPress={() => setMaxMembers(n)}
                  accentColor={accentColor}
                />
              ))}
            </View>

            <Button
              title={loading ? 'CREATING...' : 'CREATE CIRCLE'}
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
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function TemplateCard({ template, onSelect, delay }: { template: CircleTemplate; onSelect: () => void; delay: number }) {
  const fadeAnim = new Animated.Value(0);
  const slideAnim = new Animated.Value(30);

  React.useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 500,
        delay,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 500,
        delay,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  return (
    <Animated.View
      style={[
        {
          opacity: fadeAnim,
          transform: [{ translateY: slideAnim }]
        }
      ]}
    >
      <Card
        onPress={onSelect}
        style={[
          styles.templateCard,
          { borderColor: template.accent_color + '40' },
          Platform.OS === 'web' && { cursor: 'pointer' } as any
        ]}
      >
        <Text style={styles.templateEmoji}>{template.emoji}</Text>
        <Text style={[styles.templateName, { color: template.accent_color }]}>{template.name}</Text>
        <Text style={styles.templateDescription}>{template.description}</Text>
        <View style={styles.templateTags}>
          {template.tags.slice(0, 2).map((tag) => (
            <View key={tag} style={[styles.templateTag, { backgroundColor: template.accent_color + '20' }]}>
              <Text style={[styles.templateTagText, { color: template.accent_color }]}>#{tag}</Text>
            </View>
          ))}
        </View>
      </Card>
    </Animated.View>
  );
}

function MemberOption({ value, selected, onPress, accentColor }: { value: number; selected: boolean; onPress: () => void; accentColor: string }) {
  const [hovered, setHovered] = useState(false);

  return (
    <Pressable
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={[
        styles.memberOption,
        selected && { backgroundColor: accentColor, borderColor: accentColor },
        hovered && !selected && styles.memberOptionHovered,
      ]}
    >
      <Text style={[
        styles.memberOptionText,
        selected && { color: '#000' },
      ]}>
        {value}
      </Text>
    </Pressable>
  );
}

function CheckInFormatOption({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.checkInOption,
        selected && styles.checkInOptionSelected
      ]}
    >
      <Text style={[
        styles.checkInOptionText,
        selected && styles.checkInOptionTextSelected
      ]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  scrollView: {
    flex: 1,
  },
  card: {
    margin: 20,
    backgroundColor: '#111',
    borderRadius: 16,
    padding: 32,
    borderWidth: 1,
    borderColor: '#222',
  },
  cardWide: {
    marginHorizontal: 'auto',
    maxWidth: 600,
    padding: 40,
  },
  headerSection: {
    alignItems: 'center',
    marginBottom: 28,
  },
  backButton: {
    alignSelf: 'flex-start',
    padding: 8,
    marginBottom: 16,
  },
  backText: {
    color: '#666',
    fontSize: 14,
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
  templatesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    gap: 16,
  },
  templateCard: {
    width: '48%',
    minWidth: 140,
    padding: 16,
    alignItems: 'center',
    backgroundColor: '#111',
    marginBottom: 16,
  },
  templateEmoji: {
    fontSize: 32,
    marginBottom: 8,
  },
  templateName: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
    textAlign: 'center',
  },
  templateDescription: {
    color: '#888',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 8,
  },
  templateTags: {
    flexDirection: 'row',
    gap: 4,
  },
  templateTag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  templateTagText: {
    fontSize: 10,
    fontWeight: '600',
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
  iconPicker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  iconOption: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#0a0a0a',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconText: {
    fontSize: 18,
  },
  colorPicker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  colorOption: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  colorOptionSelected: {
    borderColor: '#fff',
    ...(Platform.OS === 'web'
      ? { boxShadow: '0 0 8px rgba(255,255,255,0.3)' }
      : { shadowColor: '#fff', shadowOpacity: 0.3, shadowRadius: 8, elevation: 5 }),
  },
  checkInPicker: {
    gap: 8,
    marginBottom: 16,
  },
  checkInOption: {
    backgroundColor: '#0a0a0a',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 8,
    padding: 12,
  },
  checkInOptionSelected: {
    borderColor: '#6366f1',
    backgroundColor: '#6366f1' + '20',
  },
  checkInOptionText: {
    color: '#888',
    fontSize: 14,
  },
  checkInOptionTextSelected: {
    color: '#6366f1',
    fontWeight: '600',
  },
  tagSection: {
    marginBottom: 16,
  },
  tagInput: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  tagTextInput: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 8,
    padding: 10,
    color: '#fff',
    fontSize: 14,
  },
  tagsList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    gap: 4,
  },
  tagText: {
    fontSize: 12,
    fontWeight: '600',
  },
  tagRemove: {
    color: '#666',
    fontSize: 14,
    fontWeight: '700',
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
  memberOptionText: {
    color: '#888',
    fontSize: 15,
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