// Session Tags Help Dialog
import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Platform } from 'react-native';
import { TAG_CATEGORIES } from '../lib/sessionTags';

interface Props {
  visible: boolean;
  onClose: () => void;
}

export default function SessionTagsHelp({ visible, onClose }: Props) {
  if (!visible) return null;

  return (
    <Pressable style={styles.overlay} onPress={onClose}>
      <Pressable style={styles.modal} onPress={(e) => e.stopPropagation()}>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>🏷️ Session Tags Guide</Text>
            <Pressable
              onPress={onClose}
              style={[styles.closeBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
            >
              <Text style={styles.closeBtnText}>✕</Text>
            </Pressable>
          </View>

          {/* What Are Tags */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>📋 What Are Session Tags?</Text>
            <Text style={styles.text}>
              Session tags let you organize and track your AI agent sessions by project, client, team, priority, or any custom category. This helps you:
            </Text>
            <View style={styles.bulletList}>
              <Text style={styles.bullet}>✓ Track which client/project caused specific costs</Text>
              <Text style={styles.bullet}>✓ Filter sessions by category in cost analytics</Text>
              <Text style={styles.bullet}>✓ Generate cost reports broken down by tags</Text>
              <Text style={styles.bullet}>✓ Organize complex multi-project workflows</Text>
            </View>
          </View>

          {/* Tag Format */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>📝 Tag Format</Text>
            <Text style={styles.text}>
              Tags use the format: <Text style={styles.code}>category:value</Text>
            </Text>
            <Text style={styles.text}>
              The category helps organize tags, and the value is your specific label.
            </Text>
          </View>

          {/* Categories */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>🗂️ Tag Categories</Text>
            {(Object.keys(TAG_CATEGORIES) as Array<keyof typeof TAG_CATEGORIES>).map((category) => {
              const meta = TAG_CATEGORIES[category];
              return (
                <View key={category} style={styles.categoryRow}>
                  <View style={[styles.categoryIcon, { backgroundColor: meta.color + '20' }]}>
                    <Text style={styles.categoryEmoji}>{meta.icon}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.categoryName, { color: meta.color }]}>
                      {meta.label}
                    </Text>
                    <Text style={styles.categoryExample}>
                      {category === 'project' && 'Example: project:website-redesign, project:mobile-app'}
                      {category === 'client' && 'Example: client:acme-corp, client:startup-inc'}
                      {category === 'team' && 'Example: team:frontend, team:backend, team:design'}
                      {category === 'priority' && 'Example: priority:high, priority:urgent, priority:low'}
                      {category === 'status' && 'Example: status:active, status:testing, status:complete'}
                      {category === 'custom' && 'Example: custom:experiment, custom:demo, custom:training'}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>

          {/* How to Use */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>🎯 How to Use Tags</Text>
            
            <View style={styles.step}>
              <Text style={styles.stepNumber}>1</Text>
              <View style={styles.stepContent}>
                <Text style={styles.stepTitle}>Select an Agent</Text>
                <Text style={styles.stepText}>
                  Click on any agent in the Office view to open the Agent Panel
                </Text>
              </View>
            </View>

            <View style={styles.step}>
              <Text style={styles.stepNumber}>2</Text>
              <View style={styles.stepContent}>
                <Text style={styles.stepTitle}>Add Tags</Text>
                <Text style={styles.stepText}>
                  In the Agent Panel, scroll to "Session Tags" section
                </Text>
              </View>
            </View>

            <View style={styles.step}>
              <Text style={styles.stepNumber}>3</Text>
              <View style={styles.stepContent}>
                <Text style={styles.stepTitle}>Enter Tag</Text>
                <Text style={styles.stepText}>
                  Type a tag like <Text style={styles.code}>project:website</Text> and press + or Enter
                </Text>
              </View>
            </View>

            <View style={styles.step}>
              <Text style={styles.stepNumber}>4</Text>
              <View style={styles.stepContent}>
                <Text style={styles.stepTitle}>Use Quick Tags</Text>
                <Text style={styles.stepText}>
                  Click a category button (📁 Project, 🏢 Client, etc.) to auto-fill the category
                </Text>
              </View>
            </View>
          </View>

          {/* Real Examples */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>💡 Real-World Examples</Text>
            
            <View style={styles.example}>
              <Text style={styles.exampleTitle}>🎨 Web Design Agency</Text>
              <View style={styles.exampleTags}>
                <View style={[styles.exampleTag, { borderColor: '#3b82f6' }]}>
                  <Text style={[styles.exampleTagText, { color: '#3b82f6' }]}>project:client-website</Text>
                </View>
                <View style={[styles.exampleTag, { borderColor: '#a855f7' }]}>
                  <Text style={[styles.exampleTagText, { color: '#a855f7' }]}>client:acme-corp</Text>
                </View>
                <View style={[styles.exampleTag, { borderColor: '#22c55e' }]}>
                  <Text style={[styles.exampleTagText, { color: '#22c55e' }]}>team:design</Text>
                </View>
              </View>
              <Text style={styles.exampleDesc}>
                Track costs per client and project. Generate invoices by client tag.
              </Text>
            </View>

            <View style={styles.example}>
              <Text style={styles.exampleTitle}>🚀 Startup Development</Text>
              <View style={styles.exampleTags}>
                <View style={[styles.exampleTag, { borderColor: '#3b82f6' }]}>
                  <Text style={[styles.exampleTagText, { color: '#3b82f6' }]}>project:mvp</Text>
                </View>
                <View style={[styles.exampleTag, { borderColor: '#ef4444' }]}>
                  <Text style={[styles.exampleTagText, { color: '#ef4444' }]}>priority:urgent</Text>
                </View>
                <View style={[styles.exampleTag, { borderColor: '#f59e0b' }]}>
                  <Text style={[styles.exampleTagText, { color: '#f59e0b' }]}>status:testing</Text>
                </View>
              </View>
              <Text style={styles.exampleDesc}>
                Organize by sprint priority. Filter urgent tasks. Track feature status.
              </Text>
            </View>

            <View style={styles.example}>
              <Text style={styles.exampleTitle}>🏢 Enterprise IT</Text>
              <View style={styles.exampleTags}>
                <View style={[styles.exampleTag, { borderColor: '#a855f7' }]}>
                  <Text style={[styles.exampleTagText, { color: '#a855f7' }]}>client:dept-engineering</Text>
                </View>
                <View style={[styles.exampleTag, { borderColor: '#3b82f6' }]}>
                  <Text style={[styles.exampleTagText, { color: '#3b82f6' }]}>project:infrastructure</Text>
                </View>
                <View style={[styles.exampleTag, { borderColor: '#f97316' }]}>
                  <Text style={[styles.exampleTagText, { color: '#f97316' }]}>custom:budget-2024</Text>
                </View>
              </View>
              <Text style={styles.exampleDesc}>
                Charge back costs to departments. Track budget usage by fiscal year.
              </Text>
            </View>
          </View>

          {/* Pro Tips */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>⚡ Pro Tips</Text>
            <View style={styles.tipBox}>
              <Text style={styles.tipIcon}>💰</Text>
              <Text style={styles.tipText}>
                <Text style={styles.tipBold}>Cost Tracking:</Text> Add tags immediately when starting a project. Costs accumulate over time!
              </Text>
            </View>
            <View style={styles.tipBox}>
              <Text style={styles.tipIcon}>🔍</Text>
              <Text style={styles.tipText}>
                <Text style={styles.tipBold}>Filtering:</Text> Use Cost Dashboard to filter sessions by tags and see spending breakdowns
              </Text>
            </View>
            <View style={styles.tipBox}>
              <Text style={styles.tipIcon}>📊</Text>
              <Text style={styles.tipText}>
                <Text style={styles.tipBold}>Reports:</Text> Export tagged data as CSV to generate client invoices or departmental reports
              </Text>
            </View>
            <View style={styles.tipBox}>
              <Text style={styles.tipIcon}>✏️</Text>
              <Text style={styles.tipText}>
                <Text style={styles.tipBold}>Naming:</Text> Use lowercase with hyphens (e.g., "client-acme-corp") for consistency
              </Text>
            </View>
          </View>

          {/* Footer */}
          <View style={styles.footer}>
            <Text style={styles.footerText}>
              Tags are stored locally and persist across sessions. Start tagging to unlock powerful cost analytics! 🎯
            </Text>
          </View>
        </ScrollView>
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#00000090',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    zIndex: 10000,
  },
  modal: {
    backgroundColor: '#0a0a0a',
    borderWidth: 2,
    borderColor: '#6366f1',
    borderRadius: 12,
    maxWidth: 600,
    width: '100%',
    maxHeight: '90%',
    overflow: 'hidden',
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: 20,
  },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    paddingBottom: 16,
    borderBottomWidth: 2,
    borderBottomColor: '#6366f1',
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: '#e8e8e8',
    fontFamily: 'monospace',
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#6366f115',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    fontSize: 18,
    color: '#9e9e9e',
    fontWeight: '700',
  },

  // Sections
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#e8e8e8',
    fontFamily: 'monospace',
    marginBottom: 12,
  },
  text: {
    fontSize: 13,
    color: '#b5b5b5',
    lineHeight: 20,
    marginBottom: 8,
    fontFamily: 'monospace',
  },
  code: {
    fontFamily: 'monospace',
    color: '#22d3ee',
    backgroundColor: '#22d3ee15',
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 4,
  },

  // Bullet List
  bulletList: {
    gap: 6,
    marginTop: 8,
  },
  bullet: {
    fontSize: 12,
    color: '#22c55e',
    lineHeight: 18,
    fontFamily: 'monospace',
    paddingLeft: 8,
  },

  // Categories
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
    backgroundColor: '#000000',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  categoryIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryEmoji: {
    fontSize: 16,
  },
  categoryName: {
    fontSize: 13,
    fontWeight: '700',
    fontFamily: 'monospace',
    marginBottom: 2,
  },
  categoryExample: {
    fontSize: 10,
    color: '#6f6f6f',
    fontFamily: 'monospace',
    lineHeight: 14,
  },

  // Steps
  step: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  stepNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#6366f1',
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
    textAlign: 'center',
    lineHeight: 28,
    fontFamily: 'monospace',
  },
  stepContent: {
    flex: 1,
  },
  stepTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#e8e8e8',
    fontFamily: 'monospace',
    marginBottom: 4,
  },
  stepText: {
    fontSize: 11,
    color: '#9e9e9e',
    lineHeight: 16,
    fontFamily: 'monospace',
  },

  // Examples
  example: {
    backgroundColor: '#000000',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  exampleTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#e8e8e8',
    fontFamily: 'monospace',
    marginBottom: 8,
  },
  exampleTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  exampleTag: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  exampleTagText: {
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  exampleDesc: {
    fontSize: 11,
    color: '#6f6f6f',
    fontStyle: 'italic',
    lineHeight: 16,
    fontFamily: 'monospace',
  },

  // Tips
  tipBox: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: '#6366f108',
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    marginBottom: 8,
  },
  tipIcon: {
    fontSize: 16,
  },
  tipText: {
    flex: 1,
    fontSize: 11,
    color: '#b5b5b5',
    lineHeight: 16,
    fontFamily: 'monospace',
  },
  tipBold: {
    fontWeight: '700',
    color: '#e8e8e8',
  },

  // Footer
  footer: {
    backgroundColor: '#22c55e08',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#22c55e20',
    marginTop: 8,
  },
  footerText: {
    fontSize: 11,
    color: '#e8e8e8',
    textAlign: 'center',
    fontFamily: 'monospace',
    lineHeight: 16,
  },
});
