import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Modal,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { connectViaOAuth } from '../lib/github';
import { createLinkInvite, generateInviteUrl } from '../lib/invites';
import { ensureConnectToken } from '../lib/agentConnect';
import * as Clipboard from 'expo-clipboard';

const ONBOARDING_KEY = 'uc_onboarding_complete';

export function isOnboardingComplete(): boolean {
  if (Platform.OS !== 'web') return true; // mobile: skip for now
  try {
    return localStorage.getItem(ONBOARDING_KEY) === '1';
  } catch {
    return true;
  }
}

function markOnboardingComplete() {
  if (Platform.OS === 'web') {
    try { localStorage.setItem(ONBOARDING_KEY, '1'); } catch {}
  }
}

interface Props {
  userId: string;
  circleId?: string;
  onComplete: () => void;
}

export default function OnboardingFlow({ userId, circleId, onComplete }: Props) {
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectToken, setConnectToken] = useState<string | null>(null);
  const [cmdCopied, setCmdCopied] = useState(false);

  const handleGitHubConnect = useCallback(async () => {
    if (!circleId) {
      setStep(2);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { url, error: oauthErr } = await connectViaOAuth(circleId, userId);
      if (oauthErr || !url) {
        setError(oauthErr || 'Failed to start OAuth');
        return;
      }
      if (Platform.OS === 'web') {
        window.open(url, '_blank');
      }
      setStep(2);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [circleId, userId]);

  const handleGenerateInvite = useCallback(async () => {
    if (!circleId || inviteUrl) return;
    setLoading(true);
    try {
      const { url } = await createLinkInvite(circleId, { expiresInDays: 7 });
      if (url) setInviteUrl(url);
    } catch {
      // Non-critical
    } finally {
      setLoading(false);
    }
  }, [circleId, inviteUrl]);

  const handleCopyInvite = useCallback(async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }, [inviteUrl]);

  const handleFinish = useCallback(() => {
    markOnboardingComplete();
    onComplete();
  }, [onComplete]);

  const totalSteps = 4;

  return (
    <Modal transparent animationType="fade" visible>
      <View style={styles.overlay}>
        <View style={styles.modal}>
          {/* Step indicator */}
          <View style={styles.stepRow}>
            {Array.from({ length: totalSteps }).map((_, i) => (
              <View
                key={i}
                style={[styles.stepDot, i === step && styles.stepDotActive, i < step && styles.stepDotDone]}
              />
            ))}
          </View>

          {/* Step 1: Welcome */}
          {step === 0 && (
            <View style={styles.stepContent}>
              <Text style={styles.heading}>Your team. Your AI.{'\n'}No more standups.</Text>
              <Text style={styles.sub}>
                BlackSwan watches your GitHub and keeps everyone honest about shipping.
              </Text>
              <Pressable onPress={() => setStep(1)} style={styles.ctaBtn}>
                <Text style={styles.ctaBtnText}>Get started</Text>
              </Pressable>
            </View>
          )}

          {/* Step 2: Connect GitHub */}
          {step === 1 && (
            <View style={styles.stepContent}>
              <Text style={styles.heading}>Connect your GitHub repo</Text>
              <Text style={styles.sub}>
                BlackSwan will start watching commits and PRs automatically.
              </Text>
              <Pressable
                onPress={handleGitHubConnect}
                style={[styles.githubBtn, loading && styles.btnDisabled]}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.githubBtnText}>Connect with GitHub</Text>
                )}
              </Pressable>
              {error && <Text style={styles.errorText}>{error}</Text>}
              <Pressable onPress={() => setStep(2)} style={styles.skipBtn}>
                <Text style={styles.skipText}>I'll do this later</Text>
              </Pressable>
            </View>
          )}

          {/* Step 3: Invite team */}
          {step === 2 && (
            <View style={styles.stepContent}>
              <Text style={styles.heading}>Invite your team</Text>
              <Text style={styles.sub}>
                Share the link below. They'll join your circle instantly.
              </Text>

              {circleId && !inviteUrl && (
                <Pressable
                  onPress={handleGenerateInvite}
                  style={[styles.ctaBtn, loading && styles.btnDisabled]}
                  disabled={loading}
                >
                  {loading ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.ctaBtnText}>Generate invite link</Text>
                  )}
                </Pressable>
              )}

              {inviteUrl && (
                <View style={styles.inviteBox}>
                  <Text style={styles.inviteUrl} numberOfLines={1}>{inviteUrl}</Text>
                  <Pressable onPress={handleCopyInvite} style={styles.copyBtn}>
                    <Text style={styles.copyBtnText}>{copied ? 'Copied!' : 'Copy'}</Text>
                  </Pressable>
                </View>
              )}

              {!circleId && (
                <Text style={styles.sub}>Create or join a circle first, then invite your team.</Text>
              )}

              <Pressable onPress={handleFinish} style={[styles.ctaBtn, { marginTop: 16 }]}>
                <Text style={styles.ctaBtnText}>Open the app</Text>
              </Pressable>
            </View>
          )}

          {/* Step 4: Connect your agent */}
          {step === 3 && (
            <View style={styles.stepContent}>
              <Text style={styles.heading}>Connect your AI agent</Text>
              <Text style={styles.sub}>
                Run this command so your agent auto-connects to the circle whenever you work.
              </Text>

              {connectToken ? (
                <View style={{
                  backgroundColor: '#111', borderWidth: 1, borderColor: '#27272a',
                  borderRadius: 2, padding: 12, width: '100%', gap: 8,
                }}>
                  <Text style={{ color: '#a78bfa', fontSize: 12, fontFamily: 'monospace' }} selectable>
                    {'npx @underground-circle/connect --token=' + connectToken}
                  </Text>
                  <Pressable
                    onPress={async () => {
                      await Clipboard.setStringAsync(
                        'npx @underground-circle/connect --token=' + connectToken
                      );
                      setCmdCopied(true);
                      setTimeout(() => setCmdCopied(false), 2000);
                    }}
                    style={styles.copyBtn}
                  >
                    <Text style={styles.copyBtnText}>{cmdCopied ? 'Copied!' : 'Copy command'}</Text>
                  </Pressable>
                </View>
              ) : (
                <Text style={styles.sub}>
                  You can set this up later from the Office tab.
                </Text>
              )}

              <Text style={{ color: '#52525b', fontSize: 11, fontFamily: 'monospace', textAlign: 'center', marginTop: 8, lineHeight: 16 }}>
                {'Supports Claude Code, Codex, Gemini CLI, and Cursor.\nOne command. Works forever.'}
              </Text>

              <Pressable onPress={handleFinish} style={[styles.ctaBtn, { marginTop: 16 }]}>
                <Text style={styles.ctaBtnText}>Open the app</Text>
              </Pressable>
              <Pressable onPress={handleFinish} style={styles.skipBtn}>
                <Text style={styles.skipText}>{"I'll do this later"}</Text>
              </Pressable>
            </View>
          )}

        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modal: {
    backgroundColor: '#0a0a0a',
    borderWidth: 2,
    borderColor: '#1a1a2e',
    borderRadius: 2,
    padding: 32,
    width: '100%',
    maxWidth: 440,
  },
  stepRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 32,
  },
  stepDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#333',
  },
  stepDotActive: {
    backgroundColor: '#6366f1',
    width: 24,
  },
  stepDotDone: {
    backgroundColor: '#22c55e',
  },
  stepContent: {
    alignItems: 'center',
    gap: 12,
  },
  heading: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '800',
    fontFamily: 'monospace',
    textAlign: 'center',
    letterSpacing: 1,
    lineHeight: 28,
  },
  sub: {
    color: '#888',
    fontSize: 13,
    fontFamily: 'monospace',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 8,
  },
  ctaBtn: {
    backgroundColor: '#6366f1',
    borderRadius: 2,
    paddingVertical: 14,
    paddingHorizontal: 32,
    alignItems: 'center',
    width: '100%',
    borderWidth: 2,
    borderColor: '#818cf8',
  },
  ctaBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  githubBtn: {
    backgroundColor: '#238636',
    borderRadius: 2,
    paddingVertical: 14,
    paddingHorizontal: 32,
    alignItems: 'center',
    width: '100%',
    borderWidth: 2,
    borderColor: '#2ea043',
  },
  githubBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  btnDisabled: { opacity: 0.5 },
  skipBtn: {
    paddingVertical: 8,
  },
  skipText: {
    color: '#666',
    fontSize: 12,
    fontFamily: 'monospace',
  },
  errorText: {
    color: '#ef4444',
    fontSize: 12,
    fontFamily: 'monospace',
  },
  inviteBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 2,
    padding: 10,
    width: '100%',
    gap: 8,
  },
  inviteUrl: {
    flex: 1,
    color: '#6366f1',
    fontSize: 12,
    fontFamily: 'monospace',
  },
  copyBtn: {
    backgroundColor: '#6366f1',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 2,
  },
  copyBtnText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
});
