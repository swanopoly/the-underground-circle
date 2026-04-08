import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Platform,
  ActivityIndicator,
  ScrollView,
  Linking,
} from 'react-native';
import {
  testWordPressConnection,
  storeSiteCredential,
} from '../../lib/siteAutomation';

// ─── Props ──────────────────────────────────────────────────────────────────

interface WordPressConnectorProps {
  circleId: string;
  onConnected: () => void;
  accentColor: string;
}

// ─── WordPressConnector ─────────────────────────────────────────────────────

export default function WordPressConnector({
  circleId,
  onConnected,
  accentColor,
}: WordPressConnectorProps) {
  const [siteUrl, setSiteUrl] = useState('');
  const [username, setUsername] = useState('');
  const [appPassword, setAppPassword] = useState('');
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<{
    connected: boolean;
    siteName?: string;
    error?: string;
  } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showInstructions, setShowInstructions] = useState(false);

  const canTest = siteUrl.trim().length > 0 && username.trim().length > 0 && appPassword.trim().length > 0;
  const canSave = testResult?.connected === true;

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    setSaveError(null);
    try {
      const result = await testWordPressConnection(siteUrl, username, appPassword);
      setTestResult(result);
    } catch (err: any) {
      setTestResult({ connected: false, error: err.message || 'Test failed' });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const result = await storeSiteCredential(
        'wordpress',
        siteUrl.trim(),
        username.trim(),
        appPassword.trim(),
        'default',
        {
          circleId,
          siteName: testResult?.siteName || '',
          connectedAt: new Date().toISOString(),
        },
      );
      if (result.success) {
        onConnected();
      } else {
        setSaveError(result.error || 'Failed to save credentials');
      }
    } catch (err: any) {
      setSaveError(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* ── Header ── */}
      <View style={styles.header} nativeID="section-wp-connector-header">
        <View style={[styles.iconBox, { borderColor: accentColor + '40', backgroundColor: accentColor + '10' }]}>
          <Text style={[styles.iconText, { color: accentColor }]}>WP</Text>
        </View>
        <Text style={styles.title}>Connect WordPress Site</Text>
      </View>

      {/* ── Site URL ── */}
      <View style={styles.field}>
        <Text style={styles.label}>SITE URL</Text>
        <TextInput
          style={styles.input}
          value={siteUrl}
          onChangeText={setSiteUrl}
          placeholder="https://mybusiness.com"
          placeholderTextColor="#444"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
      </View>

      {/* ── Username ── */}
      <View style={styles.field}>
        <Text style={styles.label}>USERNAME</Text>
        <TextInput
          style={styles.input}
          value={username}
          onChangeText={setUsername}
          placeholder="admin"
          placeholderTextColor="#444"
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      {/* ── Application Password ── */}
      <View style={styles.field}>
        <View style={styles.labelRow}>
          <Text style={styles.label}>APPLICATION PASSWORD</Text>
          <Pressable onPress={() => setShowInstructions(!showInstructions)}>
            <Text style={[styles.helpLink, { color: accentColor }]}>
              {showInstructions ? 'Hide help' : 'How to get one?'}
            </Text>
          </Pressable>
        </View>
        <TextInput
          style={styles.input}
          value={appPassword}
          onChangeText={setAppPassword}
          placeholder="xxxx xxxx xxxx xxxx xxxx xxxx"
          placeholderTextColor="#444"
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
        />
      </View>

      {/* ── Instructions ── */}
      {showInstructions && (
        <View style={styles.instructionsBox} nativeID="section-wp-connector-instructions">
          <Text style={styles.instructionsTitle}>How to Get an Application Password</Text>
          <Text style={styles.instructionStep}>1. Log in to your WordPress admin dashboard</Text>
          <Text style={styles.instructionStep}>2. Go to Users {'>'} Profile</Text>
          <Text style={styles.instructionStep}>3. Scroll down to "Application Passwords"</Text>
          <Text style={styles.instructionStep}>4. Enter a name (e.g. "Underground Circle")</Text>
          <Text style={styles.instructionStep}>5. Click "Add New Application Password"</Text>
          <Text style={styles.instructionStep}>6. Copy the generated password and paste it above</Text>
          <Text style={styles.instructionNote}>
            Note: Application Passwords require WordPress 5.6+. Your site must use HTTPS.
          </Text>
          <Pressable
            onPress={() => {
              const wpUrl = siteUrl.trim()
                ? `${siteUrl.trim().replace(/\/+$/, '')}/wp-admin/profile.php`
                : 'https://wordpress.org/documentation/article/application-passwords/';
              Linking.openURL(wpUrl).catch(() => {});
            }}
            style={[styles.helpButton, { borderColor: accentColor + '40' }]}
          >
            <Text style={[styles.helpButtonText, { color: accentColor }]}>
              {siteUrl.trim() ? 'Open Your WP Profile' : 'WordPress Docs'}
            </Text>
          </Pressable>
        </View>
      )}

      {/* ── Test Connection Button ── */}
      <Pressable
        onPress={handleTest}
        disabled={!canTest || testing}
        style={[
          styles.testButton,
          { borderColor: canTest ? accentColor + '60' : '#2a2a3e' },
          !canTest && styles.buttonDisabled,
        ]}
      >
        {testing ? (
          <ActivityIndicator size="small" color={accentColor} />
        ) : (
          <Text
            style={[
              styles.testButtonText,
              { color: canTest ? accentColor : '#555' },
            ]}
          >
            Test Connection
          </Text>
        )}
      </Pressable>

      {/* ── Test Result ── */}
      {testResult && (
        <View
          style={[
            styles.resultBox,
            testResult.connected ? styles.resultSuccess : styles.resultError,
          ]}
        >
          <Text style={styles.resultIcon}>
            {testResult.connected ? '[OK]' : '[ERR]'}
          </Text>
          <Text style={[styles.resultText, testResult.connected ? styles.resultTextSuccess : styles.resultTextError]}>
            {testResult.connected
              ? `Connected to ${testResult.siteName || 'WordPress'}`
              : testResult.error || 'Connection failed'}
          </Text>
        </View>
      )}

      {/* ── Save Button ── */}
      {canSave && (
        <Pressable
          onPress={handleSave}
          disabled={saving}
          style={[styles.saveButton, { backgroundColor: accentColor }]}
        >
          {saving ? (
            <ActivityIndicator size="small" color="#050508" />
          ) : (
            <Text style={styles.saveButtonText}>Save Connection</Text>
          )}
        </Pressable>
      )}

      {/* ── Save Error ── */}
      {saveError && (
        <View style={[styles.resultBox, styles.resultError]}>
          <Text style={styles.resultIcon}>[ERR]</Text>
          <Text style={[styles.resultText, styles.resultTextError]}>{saveError}</Text>
        </View>
      )}

      {/* ── CORS Notice ── */}
      <View style={styles.corsNotice}>
        <Text style={styles.corsText}>
          Note: Some WordPress sites block cross-origin requests (CORS). If the test
          fails with a network error, you may need to install a CORS plugin on your
          WordPress site or use a server-side proxy.
        </Text>
      </View>
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
    fontSize: 16,
    fontWeight: '800',
    color: '#f0f0f0',
    letterSpacing: 0.5,
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
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  helpLink: {
    fontFamily: 'monospace',
    fontSize: 10,
    fontWeight: '600',
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

  // Instructions
  instructionsBox: {
    backgroundColor: '#0a0a10',
    borderWidth: 2,
    borderColor: '#1a1a2e',
    borderRadius: 2,
    padding: 14,
    marginBottom: 14,
  },
  instructionsTitle: {
    fontFamily: 'monospace',
    fontSize: 12,
    fontWeight: '800',
    color: '#ccc',
    marginBottom: 10,
    letterSpacing: 0.5,
  },
  instructionStep: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: '#999',
    lineHeight: 20,
    paddingLeft: 4,
  },
  instructionNote: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: '#666',
    marginTop: 10,
    fontStyle: 'italic',
  },
  helpButton: {
    marginTop: 10,
    borderWidth: 2,
    borderRadius: 2,
    paddingVertical: 8,
    paddingHorizontal: 14,
    alignSelf: 'flex-start' as any,
  },
  helpButtonText: {
    fontFamily: 'monospace',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  // Test Button
  testButton: {
    borderWidth: 2,
    borderRadius: 2,
    paddingVertical: 12,
    alignItems: 'center' as any,
    justifyContent: 'center' as any,
    marginBottom: 12,
    minHeight: 44,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  testButtonText: {
    fontFamily: 'monospace',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },

  // Result
  resultBox: {
    flexDirection: 'row',
    alignItems: 'center',
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
  },
  resultText: {
    fontFamily: 'monospace',
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },
  resultTextSuccess: {
    color: '#22c55e',
  },
  resultTextError: {
    color: '#ef4444',
  },

  // Save Button
  saveButton: {
    borderRadius: 2,
    borderWidth: 2,
    borderColor: 'transparent',
    paddingVertical: 12,
    alignItems: 'center' as any,
    justifyContent: 'center' as any,
    marginBottom: 12,
    minHeight: 44,
  },
  saveButtonText: {
    fontFamily: 'monospace',
    fontSize: 12,
    fontWeight: '800',
    color: '#050508',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },

  // CORS Notice
  corsNotice: {
    marginTop: 8,
    padding: 10,
    backgroundColor: '#0a0a10',
    borderWidth: 1,
    borderColor: '#1a1a2e',
    borderRadius: 2,
  },
  corsText: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: '#555',
    lineHeight: 16,
  },
});
