/**
 * LlmProviderMarketplace — Marketplace section for connecting LLM API
 * keys (OpenAI, Anthropic, OpenRouter, Groq, HuggingFace, Replicate,
 * Ollama, Z.AI, MiniMax). Sits at the top of the Marketplace tab so
 * users can wire up the providers their agents will run on without
 * hunting through Settings.
 *
 * How it integrates with the rest of the app:
 *   - Keys persist via `storeApiKey()` in `lib/llmProviders.ts`, which
 *     writes to the per-user `provider_keys` table (encrypted at rest
 *     by Supabase RLS + RPC).
 *   - The `llm-proxy` edge function reads those keys server-side when
 *     the chat / agent layer calls `invokeLLMProxy`. So once a user
 *     pastes a key here, every chat surface, agent invocation, and
 *     model selector that goes through llm-proxy can use it
 *     immediately. No wiring change needed in chat.
 *   - Connection status comes from `useUserApiKeys()` so cards flip to
 *     ✓ Connected the moment a key is saved.
 *
 * Why this is a separate component (not inline in IntegrationsTab):
 *   IntegrationsTab is already 1.7k lines. This component owns its own
 *   state (which provider is expanded, the key input, validation
 *   spinner) and only exposes the connection state upward via the
 *   onChange callback if a parent wants to react.
 *
 * Google Gemini coverage: native Google AI Studio API support requires
 * a small llm-proxy edge function update (the proxy doesn't yet have a
 * Google handler — Gemini today routes via OpenRouter's google/* model
 * IDs). The Google Gemini card therefore points users at OpenRouter
 * with a clear note. Native Google is a small follow-up commit.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  PROVIDER_HELP,
  PROVIDER_MODELS,
  storeApiKey,
  deleteApiKey,
  testApiKey,
  useUserApiKeys,
  type LLMProvider,
} from '../../lib/llmProviders';

interface ProviderCardSpec {
  /** LLMProvider id when the provider has native llm-proxy support, or
   *  `null` when we point users at a different card (e.g. Gemini →
   *  OpenRouter). */
  id: LLMProvider | null;
  label: string;
  /** One-line value prop. Shown under the title before the user
   *  expands the card. */
  blurb: string;
  /** Used for the avatar block on the card and for the accent color of
   *  the connect button. Picked to match each provider's brand-safe
   *  color without lifting their actual logo (no trademark mess). */
  accent: string;
  /** Single-glyph mark — kept short so the avatar block stays sharp. */
  glyph: string;
  /** When `id` is null we show the user a hint instead of a Connect
   *  flow — this is the "via X" pointer. */
  redirectHint?: { providerLabel: string; routeId: LLMProvider };
}

const PROVIDER_CARDS: ProviderCardSpec[] = [
  {
    id: 'anthropic',
    label: 'Anthropic',
    blurb: 'Claude Opus, Sonnet, Haiku — UC\'s default for chat and agents.',
    accent: '#d97706',
    glyph: 'A',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    blurb: 'GPT-4.1, 4o, o3 / o4 reasoning models.',
    accent: '#10a37f',
    glyph: 'O',
  },
  {
    id: null,
    label: 'Google Gemini',
    blurb: 'Gemini 2.5 Pro & Flash. Routed via OpenRouter today.',
    accent: '#4285f4',
    glyph: 'G',
    redirectHint: { providerLabel: 'OpenRouter', routeId: 'openrouter' },
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    blurb: '100+ models behind one key. Covers Claude, GPT, Gemini, Llama, Qwen.',
    accent: '#7c3aed',
    glyph: 'R',
  },
  {
    id: 'groq',
    label: 'Groq',
    blurb: 'Ultra-fast inference for Llama and Mixtral.',
    accent: '#f97316',
    glyph: 'Q',
  },
  {
    id: 'huggingface',
    label: 'Hugging Face',
    blurb: 'Inference API for thousands of community + first-party models.',
    accent: '#ffbd45',
    glyph: 'H',
  },
  {
    id: 'replicate',
    label: 'Replicate',
    blurb: 'Hosted image / video / audio model inference.',
    accent: '#000000',
    glyph: 'P',
  },
  {
    id: 'ollama',
    label: 'Ollama (Local)',
    blurb: 'Run models on your own machine. No key needed if Ollama is local.',
    accent: '#5b21b6',
    glyph: 'L',
  },
  {
    id: 'zai',
    label: 'Z.AI / GLM',
    blurb: 'GLM-4 and other Z.ai hosted models.',
    accent: '#0ea5e9',
    glyph: 'Z',
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    blurb: 'MiniMax-Text and Speech models.',
    accent: '#ec4899',
    glyph: 'M',
  },
];

interface Props {
  /** When non-null, show a "use this provider for the circle" toggle
   *  on each card. Today it's a no-op visual hint — the per-circle
   *  default model picker lives elsewhere — but reserving the prop
   *  keeps the call-site stable when that wiring lands. */
  circleId?: string;
  onChange?: () => void;
}

export default function LlmProviderMarketplace(_props: Props) {
  const { keys, isLoading, refresh, hasProvider } = useUserApiKeys();
  const [expandedId, setExpandedId] = useState<LLMProvider | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [labelInput, setLabelInput] = useState('');
  const [busy, setBusy] = useState<LLMProvider | null>(null);
  const [errorById, setErrorById] = useState<Partial<Record<LLMProvider, string>>>({});
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'pass' | 'fail'>('idle');

  const connectedCount = useMemo(
    () => PROVIDER_CARDS.filter((c) => c.id && hasProvider(c.id)).length,
    [hasProvider],
  );

  const handleStartConnect = useCallback((id: LLMProvider) => {
    setExpandedId(id);
    setKeyInput('');
    setLabelInput('');
    setTestStatus('idle');
    setErrorById((prev) => ({ ...prev, [id]: undefined }));
  }, []);

  const handleCancel = useCallback(() => {
    setExpandedId(null);
    setKeyInput('');
    setLabelInput('');
    setTestStatus('idle');
  }, []);

  const handleSave = useCallback(async (provider: LLMProvider) => {
    const trimmedKey = keyInput.trim();
    if (!trimmedKey) {
      setErrorById((prev) => ({ ...prev, [provider]: 'Paste an API key first.' }));
      return;
    }
    setBusy(provider);
    setErrorById((prev) => ({ ...prev, [provider]: undefined }));
    setTestStatus('testing');

    // Validate the key against the live provider before persisting,
    // so users get instant feedback ("invalid key", "rate limited",
    // "model not found") instead of a silent failure later in chat.
    const test = await testApiKey(provider, trimmedKey);
    if (!test.success) {
      setBusy(null);
      setTestStatus('fail');
      setErrorById((prev) => ({ ...prev, [provider]: test.error || 'Validation failed.' }));
      return;
    }

    const stored = await storeApiKey(provider, trimmedKey, labelInput.trim() || 'default');
    setBusy(null);
    if (stored.error) {
      setTestStatus('fail');
      setErrorById((prev) => ({ ...prev, [provider]: stored.error || 'Save failed.' }));
      return;
    }
    setTestStatus('pass');
    setExpandedId(null);
    setKeyInput('');
    setLabelInput('');
    await refresh();
  }, [keyInput, labelInput, refresh]);

  const handleDisconnect = useCallback(async (provider: LLMProvider) => {
    const match = keys.find((k) => k.provider === provider && k.isActive);
    if (!match) return;
    setBusy(provider);
    await deleteApiKey(match.id);
    setBusy(null);
    await refresh();
  }, [keys, refresh]);

  const handleOpenKeyPage = useCallback((provider: LLMProvider) => {
    const url = PROVIDER_HELP[provider]?.url;
    if (!url) return;
    if (typeof window !== 'undefined') {
      window.open(url, '_blank');
    } else {
      Linking.openURL(url).catch(() => {});
    }
  }, []);

  return (
    <View style={styles.root} nativeID="section-llm-provider-marketplace">
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>AI Models & APIs</Text>
          <Text style={styles.headerSubtitle}>
            Connect once — chat, agents, automations, and the room runtimes will all use these keys.
          </Text>
        </View>
        <View style={styles.headerBadge}>
          <Text style={styles.headerBadgeNum}>{connectedCount}</Text>
          <Text style={styles.headerBadgeSlash}>/{PROVIDER_CARDS.filter((c) => c.id).length}</Text>
        </View>
      </View>

      <View style={styles.grid}>
        {PROVIDER_CARDS.map((card) => {
          const connected = card.id ? hasProvider(card.id) : false;
          const isExpanded = card.id !== null && expandedId === card.id;
          const isBusy = card.id !== null && busy === card.id;
          const error = card.id ? errorById[card.id] : undefined;
          const modelCount = card.id ? (PROVIDER_MODELS[card.id]?.length || 0) : 0;
          const keyHint = card.id ? PROVIDER_HELP[card.id]?.hint : null;

          return (
            <View
              key={card.label}
              style={[
                styles.card,
                connected && { borderColor: '#22c55e55', backgroundColor: '#0f1a14' },
                isExpanded && { borderColor: card.accent + 'aa', backgroundColor: '#0a0f1c' },
              ]}
            >
              <View style={styles.cardHeader}>
                <View style={[styles.avatar, { backgroundColor: card.accent + '22', borderColor: card.accent + '66' }]}>
                  <Text style={[styles.avatarGlyph, { color: card.accent }]}>{card.glyph}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardLabel}>{card.label}</Text>
                  <Text style={styles.cardBlurb} numberOfLines={2}>{card.blurb}</Text>
                </View>
                {connected && !isExpanded && (
                  <View style={styles.connectedChip}>
                    <Text style={styles.connectedChipText}>Connected</Text>
                  </View>
                )}
              </View>

              {modelCount > 0 && !isExpanded && (
                <Text style={styles.modelLine}>{modelCount} model{modelCount === 1 ? '' : 's'} available</Text>
              )}

              {/* Action row — varies by state. */}
              {!isExpanded && (
                <View style={styles.actionsRow}>
                  {card.id === null && card.redirectHint ? (
                    <Pressable
                      onPress={() => card.redirectHint && handleStartConnect(card.redirectHint.routeId)}
                      style={[
                        styles.primaryBtn,
                        { backgroundColor: card.accent },
                        Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
                      ]}
                    >
                      <Text style={styles.primaryBtnText}>
                        Connect via {card.redirectHint.providerLabel}
                      </Text>
                    </Pressable>
                  ) : connected ? (
                    <>
                      <Pressable
                        onPress={() => card.id && handleDisconnect(card.id)}
                        disabled={isBusy}
                        style={[
                          styles.secondaryBtn,
                          isBusy && styles.btnDisabled,
                          Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
                        ]}
                      >
                        {isBusy ? <ActivityIndicator size="small" color="#94a3b8" /> : (
                          <Text style={styles.secondaryBtnText}>Disconnect</Text>
                        )}
                      </Pressable>
                      <Pressable
                        onPress={() => card.id && handleStartConnect(card.id)}
                        style={[styles.tertiaryBtn, Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}
                      >
                        <Text style={styles.tertiaryBtnText}>Replace key</Text>
                      </Pressable>
                    </>
                  ) : (
                    <>
                      <Pressable
                        onPress={() => card.id && handleStartConnect(card.id)}
                        style={[
                          styles.primaryBtn,
                          { backgroundColor: card.accent },
                          Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
                        ]}
                      >
                        <Text style={styles.primaryBtnText}>Connect</Text>
                      </Pressable>
                      {keyHint && (
                        <Pressable
                          onPress={() => card.id && handleOpenKeyPage(card.id)}
                          style={[styles.tertiaryBtn, Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}
                        >
                          <Text style={styles.tertiaryBtnText}>Get key →</Text>
                        </Pressable>
                      )}
                    </>
                  )}
                </View>
              )}

              {/* Expanded edit form. */}
              {isExpanded && card.id && (
                <View style={styles.expandedBlock}>
                  <Text style={styles.expandedHint}>{keyHint}</Text>
                  <TextInput
                    style={styles.input}
                    value={keyInput}
                    onChangeText={setKeyInput}
                    placeholder={`Paste ${card.label} API key`}
                    placeholderTextColor="#475569"
                    autoCapitalize="none"
                    autoCorrect={false}
                    secureTextEntry={Platform.OS !== 'web'}
                  />
                  <TextInput
                    style={[styles.input, styles.inputCompact]}
                    value={labelInput}
                    onChangeText={setLabelInput}
                    placeholder="Optional label (e.g. personal, work)"
                    placeholderTextColor="#475569"
                  />
                  {error && <Text style={styles.errorText}>{error}</Text>}
                  {testStatus === 'testing' && <Text style={styles.statusText}>Validating key…</Text>}
                  <View style={styles.actionsRow}>
                    <Pressable
                      onPress={() => card.id && handleSave(card.id)}
                      disabled={isBusy}
                      style={[
                        styles.primaryBtn,
                        { backgroundColor: card.accent },
                        isBusy && styles.btnDisabled,
                        Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
                      ]}
                    >
                      {isBusy
                        ? <ActivityIndicator size="small" color="#fff" />
                        : <Text style={styles.primaryBtnText}>Save & Test</Text>}
                    </Pressable>
                    <Pressable
                      onPress={handleCancel}
                      disabled={isBusy}
                      style={[styles.secondaryBtn, Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}
                    >
                      <Text style={styles.secondaryBtnText}>Cancel</Text>
                    </Pressable>
                    {keyHint && (
                      <Pressable
                        onPress={() => card.id && handleOpenKeyPage(card.id)}
                        style={[styles.tertiaryBtn, Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}
                      >
                        <Text style={styles.tertiaryBtnText}>Get key →</Text>
                      </Pressable>
                    )}
                  </View>
                </View>
              )}
            </View>
          );
        })}
      </View>

      {isLoading && (
        <Text style={styles.loadingText}>Loading saved keys…</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: '#0a0f1c',
    borderWidth: 1,
    borderColor: '#1e293b',
    borderRadius: 12,
    padding: 14,
    gap: 12,
    marginBottom: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  headerTitle: { color: '#e6edf3', fontSize: 15, fontWeight: '700' },
  headerSubtitle: { color: '#94a3b8', fontSize: 12, marginTop: 2, lineHeight: 18 },
  headerBadge: {
    flexDirection: 'row',
    alignItems: 'baseline',
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#1e293b',
    borderRadius: 999,
  },
  headerBadgeNum: { color: '#a5b4fc', fontSize: 13, fontWeight: '800' },
  headerBadgeSlash: { color: '#64748b', fontSize: 11 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  card: {
    flexBasis: '48%',
    flexGrow: 1,
    minWidth: 280,
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#1e293b',
    borderRadius: 10,
    padding: 12,
    gap: 8,
  },
  cardHeader: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarGlyph: { fontSize: 15, fontWeight: '900' },
  cardLabel: { color: '#e6edf3', fontSize: 13, fontWeight: '700' },
  cardBlurb: { color: '#94a3b8', fontSize: 11, lineHeight: 16, marginTop: 2 },
  connectedChip: {
    backgroundColor: '#16a34a22',
    borderWidth: 1,
    borderColor: '#16a34a55',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    alignSelf: 'flex-start',
  },
  connectedChipText: { color: '#86efac', fontSize: 10, fontWeight: '800' },
  modelLine: { color: '#64748b', fontSize: 11 },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
  },
  primaryBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    minWidth: 96,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  secondaryBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#334155',
  },
  secondaryBtnText: { color: '#cbd5e1', fontSize: 12, fontWeight: '700' },
  tertiaryBtn: {
    paddingHorizontal: 8,
    paddingVertical: 7,
  },
  tertiaryBtnText: { color: '#94a3b8', fontSize: 11, fontWeight: '600' },
  btnDisabled: { opacity: 0.6 },
  expandedBlock: {
    paddingTop: 6,
    gap: 8,
  },
  expandedHint: { color: '#94a3b8', fontSize: 11, lineHeight: 16 },
  input: {
    backgroundColor: '#020617',
    borderWidth: 1,
    borderColor: '#1e293b',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: '#e2e8f0',
    fontSize: 12,
    fontFamily: Platform.select({ web: 'ui-monospace, SFMono-Regular, Menlo, monospace', default: 'monospace' }) as string,
  },
  inputCompact: { paddingVertical: 6 },
  errorText: { color: '#fca5a5', fontSize: 11 },
  statusText: { color: '#a5b4fc', fontSize: 11 },
  loadingText: { color: '#64748b', fontSize: 11 },
});
