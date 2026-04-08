import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Platform,
  ActivityIndicator,
  ScrollView,
  Image,
  Linking,
} from 'react-native';
import {
  SiteCredential,
  getDecryptedCredential,
  publishToWordPress,
  fetchWordPressCategories,
  WordPressCategory,
} from '../../lib/siteAutomation';

// ─── Props ──────────────────────────────────────────────────────────────────

interface WordPressPostFormProps {
  credential: SiteCredential;
  accentColor: string;
  onPublished: (url: string) => void;
}

// ─── WordPressPostForm ──────────────────────────────────────────────────────

export default function WordPressPostForm({
  credential,
  accentColor,
  onPublished,
}: WordPressPostFormProps) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [status, setStatus] = useState<'publish' | 'draft'>('draft');
  const [categories, setCategories] = useState<WordPressCategory[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<number[]>([]);
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState<{
    success: boolean;
    postUrl?: string;
    error?: string;
  } | null>(null);

  // Load categories on mount
  useEffect(() => {
    loadCategories();
  }, [credential.id]);

  const loadCategories = async () => {
    if (!credential.siteUrl || !credential.username) return;
    setLoadingCategories(true);
    try {
      const appPassword = await getDecryptedCredential(credential.id);
      if (!appPassword) return;
      const cats = await fetchWordPressCategories(
        credential.siteUrl,
        credential.username,
        appPassword,
      );
      setCategories(cats);
    } catch (err) {
      console.warn('[WPPostForm] Failed to load categories:', err);
    } finally {
      setLoadingCategories(false);
    }
  };

  const handlePickImage = async () => {
    try {
      const ImagePicker = await import('expo-image-picker');
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        quality: 0.8,
      });
      if (!result.canceled && result.assets?.[0]?.uri) {
        setImageUri(result.assets[0].uri);
      }
    } catch (err) {
      console.warn('[WPPostForm] Image picker error:', err);
    }
  };

  const toggleCategory = (catId: number) => {
    setSelectedCategories((prev) =>
      prev.includes(catId)
        ? prev.filter((id) => id !== catId)
        : [...prev, catId],
    );
  };

  const handlePublish = async () => {
    if (!title.trim() || !content.trim()) return;
    if (!credential.siteUrl || !credential.username) return;

    setPublishing(true);
    setPublishResult(null);

    try {
      const appPassword = await getDecryptedCredential(credential.id);
      if (!appPassword) {
        setPublishResult({ success: false, error: 'Could not retrieve credentials' });
        return;
      }

      const result = await publishToWordPress({
        siteUrl: credential.siteUrl,
        username: credential.username,
        appPassword,
        title: title.trim(),
        content: content.trim(),
        status,
        featuredImageUrl: imageUri || undefined,
        categories: selectedCategories.length > 0 ? selectedCategories : undefined,
      });

      setPublishResult(result);
      if (result.success && result.postUrl) {
        onPublished(result.postUrl);
      }
    } catch (err: any) {
      setPublishResult({ success: false, error: err.message || 'Publishing failed' });
    } finally {
      setPublishing(false);
    }
  };

  const canPublish = title.trim().length > 0 && content.trim().length > 0 && !publishing;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* ── Header ── */}
      <View style={styles.header} nativeID="section-wp-post-form-header">
        <View style={[styles.iconBox, { borderColor: accentColor + '40', backgroundColor: accentColor + '10' }]}>
          <Text style={[styles.iconText, { color: accentColor }]}>WP</Text>
        </View>
        <View>
          <Text style={styles.title}>New WordPress Post</Text>
          <Text style={styles.subtitle}>
            {credential.siteUrl || 'WordPress'} {'\u2014'} {credential.username || ''}
          </Text>
        </View>
      </View>

      {/* ── Title Input ── */}
      <View style={styles.field}>
        <Text style={styles.label}>POST TITLE</Text>
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          placeholder="Enter post title..."
          placeholderTextColor="#444"
        />
      </View>

      {/* ── Content Editor ── */}
      <View style={styles.field}>
        <Text style={styles.label}>CONTENT</Text>
        <TextInput
          style={[styles.input, styles.contentInput]}
          value={content}
          onChangeText={setContent}
          placeholder="Write your post content here... HTML is supported."
          placeholderTextColor="#444"
          multiline
          textAlignVertical="top"
          numberOfLines={10}
        />
      </View>

      {/* ── Image Picker ── */}
      <View style={styles.field}>
        <Text style={styles.label}>FEATURED IMAGE</Text>
        {imageUri ? (
          <View style={styles.imagePreviewContainer}>
            <Image source={{ uri: imageUri }} style={styles.imagePreview} />
            <Pressable onPress={() => setImageUri(null)} style={styles.removeImageBtn}>
              <Text style={styles.removeImageText}>[X]</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable
            onPress={handlePickImage}
            style={[styles.imagePickerBtn, { borderColor: accentColor + '30' }]}
          >
            <Text style={[styles.imagePickerText, { color: accentColor }]}>
              + Add Featured Image
            </Text>
          </Pressable>
        )}
      </View>

      {/* ── Category Selector ── */}
      <View style={styles.field}>
        <Text style={styles.label}>CATEGORIES</Text>
        {loadingCategories ? (
          <ActivityIndicator size="small" color={accentColor} style={{ alignSelf: 'flex-start' }} />
        ) : categories.length > 0 ? (
          <View style={styles.categoriesGrid}>
            {categories.map((cat) => {
              const selected = selectedCategories.includes(cat.id);
              return (
                <Pressable
                  key={cat.id}
                  onPress={() => toggleCategory(cat.id)}
                  style={[
                    styles.categoryChip,
                    selected && { backgroundColor: accentColor + '20', borderColor: accentColor + '60' },
                  ]}
                >
                  <Text
                    style={[
                      styles.categoryChipText,
                      selected && { color: accentColor },
                    ]}
                  >
                    {cat.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : (
          <Text style={styles.noCategoriesText}>
            No categories loaded. They will load when credentials are available.
          </Text>
        )}
      </View>

      {/* ── Status Toggle ── */}
      <View style={styles.field}>
        <Text style={styles.label}>STATUS</Text>
        <View style={styles.toggleRow}>
          <Pressable
            onPress={() => setStatus('draft')}
            style={[
              styles.toggleOption,
              status === 'draft' && { backgroundColor: accentColor + '20', borderColor: accentColor + '60' },
            ]}
          >
            <Text
              style={[
                styles.toggleText,
                status === 'draft' && { color: accentColor },
              ]}
            >
              Draft
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setStatus('publish')}
            style={[
              styles.toggleOption,
              status === 'publish' && { backgroundColor: '#22c55e20', borderColor: '#22c55e60' },
            ]}
          >
            <Text
              style={[
                styles.toggleText,
                status === 'publish' && { color: '#22c55e' },
              ]}
            >
              Publish
            </Text>
          </Pressable>
        </View>
      </View>

      {/* ── Preview ── */}
      {(title.trim() || content.trim()) && (
        <View style={styles.previewBox} nativeID="section-wp-post-preview">
          <Text style={styles.previewLabel}>PREVIEW</Text>
          <Text style={styles.previewTitle}>{title || 'Untitled'}</Text>
          <Text style={styles.previewContent} numberOfLines={4}>
            {content || 'No content yet...'}
          </Text>
          <Text style={styles.previewStatus}>
            Status: {status === 'publish' ? 'Will be published immediately' : 'Will be saved as draft'}
          </Text>
        </View>
      )}

      {/* ── Publish Button ── */}
      <Pressable
        onPress={handlePublish}
        disabled={!canPublish}
        style={[
          styles.publishButton,
          {
            backgroundColor: canPublish
              ? (status === 'publish' ? '#22c55e' : accentColor)
              : '#1a1a2e',
          },
        ]}
      >
        {publishing ? (
          <ActivityIndicator size="small" color="#050508" />
        ) : (
          <Text style={styles.publishButtonText}>
            {status === 'publish' ? 'Publish Now' : 'Save Draft'}
          </Text>
        )}
      </Pressable>

      {/* ── Publish Result ── */}
      {publishResult && (
        <View
          style={[
            styles.resultBox,
            publishResult.success ? styles.resultSuccess : styles.resultError,
          ]}
        >
          <Text style={styles.resultIcon}>
            {publishResult.success ? '[OK]' : '[ERR]'}
          </Text>
          <View style={{ flex: 1 }}>
            <Text
              style={[
                styles.resultText,
                publishResult.success ? styles.resultTextSuccess : styles.resultTextError,
              ]}
            >
              {publishResult.success
                ? `Post ${status === 'publish' ? 'published' : 'saved as draft'} successfully!`
                : publishResult.error || 'Publishing failed'}
            </Text>
            {publishResult.success && publishResult.postUrl && (
              <Pressable onPress={() => Linking.openURL(publishResult.postUrl!).catch(() => {})}>
                <Text style={[styles.resultLink, { color: accentColor }]}>
                  View post: {publishResult.postUrl}
                </Text>
              </Pressable>
            )}
          </View>
        </View>
      )}
    </ScrollView>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050508',
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 20,
  },
  iconBox: {
    width: 36,
    height: 36,
    borderWidth: 2,
    borderRadius: 2,
    alignItems: 'center' as any,
    justifyContent: 'center' as any,
  },
  iconText: {
    fontFamily: 'monospace',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
  },
  title: {
    fontFamily: 'monospace',
    fontSize: 15,
    fontWeight: '800',
    color: '#f0f0f0',
    letterSpacing: 0.5,
  },
  subtitle: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: '#666',
    marginTop: 2,
  },

  // Fields
  field: {
    marginBottom: 14,
  },
  label: {
    fontFamily: 'monospace',
    fontSize: 10,
    fontWeight: '700',
    color: '#888',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#0a0a10',
    borderWidth: 2,
    borderColor: '#1a1a2e',
    borderRadius: 2,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: 'monospace',
    fontSize: 13,
    color: '#e0e0e0',
    ...(Platform.OS === 'web' ? { outlineWidth: 0 } as any : {}),
  },
  contentInput: {
    minHeight: 200,
    ...(Platform.OS === 'web' ? { resize: 'vertical' } as any : {}),
  },

  // Image
  imagePickerBtn: {
    borderWidth: 2,
    borderStyle: 'dashed' as any,
    borderRadius: 2,
    paddingVertical: 20,
    alignItems: 'center' as any,
    justifyContent: 'center' as any,
  },
  imagePickerText: {
    fontFamily: 'monospace',
    fontSize: 12,
    fontWeight: '700',
  },
  imagePreviewContainer: {
    position: 'relative' as any,
  },
  imagePreview: {
    width: '100%',
    height: 180,
    borderRadius: 2,
    borderWidth: 2,
    borderColor: '#1a1a2e',
    resizeMode: 'cover',
  },
  removeImageBtn: {
    position: 'absolute' as any,
    top: 6,
    right: 6,
    backgroundColor: '#050508cc',
    borderWidth: 1,
    borderColor: '#ef444460',
    borderRadius: 2,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  removeImageText: {
    fontFamily: 'monospace',
    fontSize: 10,
    fontWeight: '800',
    color: '#ef4444',
  },

  // Categories
  categoriesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  categoryChip: {
    borderWidth: 2,
    borderColor: '#1a1a2e',
    borderRadius: 2,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: '#0a0a10',
  },
  categoryChipText: {
    fontFamily: 'monospace',
    fontSize: 11,
    fontWeight: '600',
    color: '#888',
  },
  noCategoriesText: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: '#555',
    fontStyle: 'italic',
  },

  // Status toggle
  toggleRow: {
    flexDirection: 'row',
    gap: 8,
  },
  toggleOption: {
    borderWidth: 2,
    borderColor: '#1a1a2e',
    borderRadius: 2,
    paddingHorizontal: 18,
    paddingVertical: 8,
    backgroundColor: '#0a0a10',
  },
  toggleText: {
    fontFamily: 'monospace',
    fontSize: 12,
    fontWeight: '700',
    color: '#888',
    letterSpacing: 0.5,
  },

  // Preview
  previewBox: {
    backgroundColor: '#0a0a10',
    borderWidth: 2,
    borderColor: '#1a1a2e',
    borderRadius: 2,
    padding: 14,
    marginBottom: 14,
  },
  previewLabel: {
    fontFamily: 'monospace',
    fontSize: 9,
    fontWeight: '700',
    color: '#555',
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  previewTitle: {
    fontFamily: 'monospace',
    fontSize: 14,
    fontWeight: '800',
    color: '#e0e0e0',
    marginBottom: 6,
  },
  previewContent: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: '#888',
    lineHeight: 18,
    marginBottom: 8,
  },
  previewStatus: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: '#666',
    fontStyle: 'italic',
  },

  // Publish button
  publishButton: {
    borderRadius: 2,
    borderWidth: 2,
    borderColor: 'transparent',
    paddingVertical: 14,
    alignItems: 'center' as any,
    justifyContent: 'center' as any,
    marginBottom: 12,
    minHeight: 48,
  },
  publishButtonText: {
    fontFamily: 'monospace',
    fontSize: 13,
    fontWeight: '800',
    color: '#050508',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },

  // Result
  resultBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderWidth: 2,
    borderRadius: 2,
    padding: 10,
    marginBottom: 12,
  },
  resultSuccess: {
    borderColor: '#22c55e40',
    backgroundColor: '#22c55e08',
  },
  resultError: {
    borderColor: '#ef444440',
    backgroundColor: '#ef444408',
  },
  resultIcon: {
    fontFamily: 'monospace',
    fontSize: 11,
    fontWeight: '800',
    color: '#888',
    marginTop: 1,
  },
  resultText: {
    fontFamily: 'monospace',
    fontSize: 12,
    fontWeight: '600',
  },
  resultTextSuccess: {
    color: '#22c55e',
  },
  resultTextError: {
    color: '#ef4444',
  },
  resultLink: {
    fontFamily: 'monospace',
    fontSize: 10,
    fontWeight: '600',
    marginTop: 4,
    textDecorationLine: 'underline',
  },
});
