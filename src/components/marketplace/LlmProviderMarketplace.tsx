/**
 * LlmProviderMarketplace — Marketplace section for connecting LLM API
 * keys for every provider supported by the authenticated model proxy, plus
 * guarded local/custom and non-chat inference providers.
 * Sits at the top of the Marketplace tab so
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
 * Model inventories are discovered after connection by the shared provider
 * registry, so this component describes provider families instead of freezing
 * one permanent model list in the connection UI.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
  loadProviderModelCatalogSnapshot,
  storeApiKey,
  deleteApiKey,
  testApiKey,
  useUserApiKeys,
  type LLMProvider,
} from '../../lib/llmProviders';
import {
  buildModelCatalogReadinessProfile,
  projectProviderCatalogModels,
  type ModelCatalogReadinessState,
} from '../../lib/modelCatalogReadinessCore';
import {
  buildBillingPreview,
  getProviderRoutingMode,
  setProviderRoutingMode,
  type ProviderRoutingMode,
} from '../../lib/billingPriority';

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
    id: 'openai_compatible',
    label: 'Business Models',
    blurb: 'Private compatible endpoints for guarded OpenSwan and local-agent tools.',
    accent: '#14b8a6',
    glyph: 'B',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    blurb: 'Current GPT-5.6, GPT-5.5/5.4, GPT-4.1, and o3 models.',
    accent: '#10a37f',
    glyph: 'O',
  },
  {
    id: 'google_ai',
    label: 'Google Gemini',
    blurb: 'Current Gemini 3.x long-context and multimodal models.',
    accent: '#4285f4',
    glyph: 'G',
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
    blurb: 'Low-latency GPT-OSS, Compound, and Llama inference.',
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
    blurb: 'Current GLM-5.1 multilingual reasoning and tool-use models.',
    accent: '#0ea5e9',
    glyph: 'Z',
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    blurb: 'MiniMax M2.7 and high-speed long-context agent models.',
    accent: '#ec4899',
    glyph: 'M',
  },
  {
    id: 'github-models',
    label: 'GitHub Models',
    blurb: 'Publisher-qualified models through GitHub\'s inference API.',
    accent: '#64748b',
    glyph: 'GH',
  },
  {
    id: 'mistral_ai',
    label: 'Mistral AI',
    blurb: 'Mistral Medium, Large, Small, Codestral, and Ministral.',
    accent: '#fa520f',
    glyph: 'MS',
  },
  {
    id: 'cohere',
    label: 'Cohere',
    blurb: 'Command A chat and reasoning for enterprise retrieval agents.',
    accent: '#39594d',
    glyph: 'CH',
  },
  {
    id: 'perplexity',
    label: 'Perplexity',
    blurb: 'Sonar search-grounded chat, reasoning, and deep research.',
    accent: '#1fb8cd',
    glyph: 'PX',
  },
  {
    id: 'together_ai',
    label: 'Together AI',
    blurb: 'Managed Qwen, Kimi, DeepSeek, Llama, and other OSS models.',
    accent: '#0f6fff',
    glyph: 'TG',
  },
  {
    id: 'fireworks_ai',
    label: 'Fireworks AI',
    blurb: 'Low-latency GPT-OSS, DeepSeek, Kimi, and tool-use inference.',
    accent: '#5b36bd',
    glyph: 'FW',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    blurb: 'DeepSeek V4 Flash and Pro for long-context reasoning and code.',
    accent: '#1a6fe0',
    glyph: 'DS',
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
  const [endpointInput, setEndpointInput] = useState('');
  const [labelInput, setLabelInput] = useState('');
  const [busy, setBusy] = useState<LLMProvider | null>(null);
  const [errorById, setErrorById] = useState<Partial<Record<LLMProvider, string>>>({});
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'pass' | 'fail'>('idle');
  const [catalogReadinessById, setCatalogReadinessById] = useState<Partial<Record<LLMProvider, {
    state: ModelCatalogReadinessState;
    label: string;
    hint: string;
    modelCount: number;
  }>>>({});

  // A green credential chip proves the key was saved, not that every curated
  // model is listed to the account. Resolve the same typed provider snapshot
  // used by Chat/Rooms and keep all failure copy bounded and secret-free.
  useEffect(() => {
    let cancelled = false;
    const activeProviders = Array.from(new Set(
      keys.filter((key) => key.isActive).map((key) => key.provider),
    ));
    if (activeProviders.length === 0) {
      setCatalogReadinessById({});
      return () => { cancelled = true; };
    }
    void Promise.all(activeProviders.map(async (provider) => {
      const snapshot = await loadProviderModelCatalogSnapshot(provider, _props.circleId ?? null);
      const models = projectProviderCatalogModels(
        provider,
        PROVIDER_MODELS[provider] || [],
        snapshot,
      );
      const profile = buildModelCatalogReadinessProfile({
        connected: true,
        snapshotStatus: snapshot.status,
        selectableModelCount: models.length,
      });
      return [provider, {
        state: profile.state,
        label: profile.label,
        hint: profile.hint,
        modelCount: models.length,
      }] as const;
    })).then((entries) => {
      if (cancelled) return;
      setCatalogReadinessById(Object.fromEntries(entries) as Partial<Record<LLMProvider, {
        state: ModelCatalogReadinessState;
        label: string;
        hint: string;
        modelCount: number;
      }>>);
    }).catch(() => {
      if (!cancelled) setCatalogReadinessById({});
    });
    return () => { cancelled = true; };
  }, [keys, _props.circleId]);

  const connectedCount = useMemo(
    () => PROVIDER_CARDS.filter((c) => c.id && hasProvider(c.id)).length,
    [hasProvider],
  );

  // Billing-priority preview — shows the user the actual order their
  // requests will be routed in, given which keys they've connected
  // and their preferred routing mode. Updates immediately when keys
  // are added / removed because `keys` is the live source.
  const [routingMode, setRoutingMode] = useState<ProviderRoutingMode>(() => getProviderRoutingMode());
  const handleRoutingModeChange = useCallback((mode: ProviderRoutingMode) => {
    setRoutingMode(mode);
    setProviderRoutingMode(mode);
  }, []);
  const billingPreview = useMemo(() => {
    const connected = new Set<LLMProvider | 'openswan'>();
    for (const k of keys) if (k.isActive) connected.add(k.provider);
    return buildBillingPreview(connected, routingMode);
  }, [keys, routingMode]);

  const handleStartConnect = useCallback((id: LLMProvider) => {
    setExpandedId(id);
    setKeyInput('');
    setEndpointInput('');
    setLabelInput('');
    setTestStatus('idle');
    setErrorById((prev) => ({ ...prev, [id]: undefined }));
  }, []);

  const handleCancel = useCallback(() => {
    setExpandedId(null);
    setKeyInput('');
    setEndpointInput('');
    setLabelInput('');
    setTestStatus('idle');
  }, []);

  const handleSave = useCallback(async (provider: LLMProvider) => {
    const trimmedKey = keyInput.trim();
    const trimmedEndpoint = endpointInput.trim();
    if (!trimmedKey) {
      setErrorById((prev) => ({ ...prev, [provider]: 'Paste an API key first.' }));
      return;
    }
    if (provider === 'openai_compatible' && !trimmedEndpoint) {
      setErrorById((prev) => ({ ...prev, [provider]: 'Paste the OpenAI-compatible endpoint URL first.' }));
      return;
    }
    if (provider === 'openai_compatible' && !labelInput.trim()) {
      setErrorById((prev) => ({ ...prev, [provider]: 'Enter the model or deployment ID for this endpoint.' }));
      return;
    }
    setBusy(provider);
    setErrorById((prev) => ({ ...prev, [provider]: undefined }));
    setTestStatus('testing');

    // Validate the key against the live provider before persisting,
    // so users get instant feedback ("invalid key", "rate limited",
    // "model not found") instead of a silent failure later in chat.
    const modelId = provider === 'openai_compatible' ? labelInput.trim() : undefined;
    const test = await testApiKey(provider, trimmedKey, trimmedEndpoint || undefined, modelId);
    if (!test.success) {
      setBusy(null);
      setTestStatus('fail');
      setErrorById((prev) => ({ ...prev, [provider]: test.error || 'Validation failed.' }));
      return;
    }

    const stored = await storeApiKey(provider, trimmedKey, labelInput.trim() || 'default', trimmedEndpoint || undefined);
    setBusy(null);
    if (stored.error) {
      setTestStatus('fail');
      setErrorById((prev) => ({ ...prev, [provider]: stored.error || 'Save failed.' }));
      return;
    }
    setTestStatus('pass');
    setExpandedId(null);
    setKeyInput('');
    setEndpointInput('');
    setLabelInput('');
    await refresh();
  }, [keyInput, endpointInput, labelInput, refresh]);

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

      {/* Billing priority — shown only when 2+ providers are
          connected. Single connection = no decision to surface. */}
      {billingPreview.length >= 2 && (
        <View style={styles.billingBlock}>
          <View style={styles.billingHeaderRow}>
            <Text style={styles.billingHeaderLabel}>Billing priority</Text>
            <View style={styles.billingModeRow}>
              {([
                { key: 'prefer_direct',     label: 'Direct first' },
                { key: 'prefer_openrouter', label: 'OpenRouter first' },
                { key: 'cheapest',          label: 'Cheapest' },
              ] as const).map(opt => {
                const active = routingMode === opt.key;
                return (
                  <Pressable
                    key={opt.key}
                    onPress={() => handleRoutingModeChange(opt.key)}
                    style={[styles.billingModeChip, active && styles.billingModeChipActive]}
                  >
                    <Text style={[styles.billingModeChipText, active && styles.billingModeChipTextActive]}>
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          <Text style={styles.billingHeaderSub}>
            When the model you pick is on multiple providers, here's the order each turn is billed against.
          </Text>
          <View style={styles.billingChain}>
            {billingPreview.map((entry, idx) => (
              <View key={entry.provider} style={[styles.billingRow, idx === 0 && styles.billingRowPrimary]}>
                <View style={styles.billingRowHeader}>
                  <Text style={[styles.billingPosition, idx === 0 && styles.billingPositionPrimary]}>
                    {idx + 1}
                  </Text>
                  <Text style={[styles.billingProviderLabel, idx === 0 && styles.billingProviderLabelPrimary]}>
                    {entry.label}
                  </Text>
                  {idx === 0 && (
                    <View style={styles.billingPrimaryChip}>
                      <Text style={styles.billingPrimaryChipText}>PRIMARY</Text>
                    </View>
                  )}
                  <Text style={styles.billingScope}>{entry.scope}</Text>
                </View>
                <Text style={styles.billingReason}>{entry.reason}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      <View style={styles.grid}>
        {PROVIDER_CARDS.map((card) => {
          const connected = card.id ? hasProvider(card.id) : false;
          const isExpanded = card.id !== null && expandedId === card.id;
          const isBusy = card.id !== null && busy === card.id;
          const error = card.id ? errorById[card.id] : undefined;
          const catalogReadiness = card.id ? catalogReadinessById[card.id] : undefined;
          const modelCount = connected && catalogReadiness
            ? catalogReadiness.modelCount
            : card.id ? (PROVIDER_MODELS[card.id]?.length || 0) : 0;
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

              {card.id && !isExpanded && (
                <Text style={styles.modelLine} numberOfLines={2}>
                  {connected
                    ? catalogReadiness
                      ? `${modelCount} model${modelCount === 1 ? '' : 's'} · ${catalogReadiness.label}`
                      : 'Checking account model catalog…'
                    : `${modelCount} curated model${modelCount === 1 ? '' : 's'} · connect to check this account`}
                </Text>
              )}
              {connected && catalogReadiness && !isExpanded && catalogReadiness.state !== 'account_verified' ? (
                <Text style={styles.catalogHint} numberOfLines={2}>{catalogReadiness.hint}</Text>
              ) : null}

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
                  {card.id === 'openai_compatible' && (
                    <TextInput
                      style={[styles.input, styles.inputCompact]}
                      value={endpointInput}
                      onChangeText={setEndpointInput}
                      placeholder="Endpoint URL (https://models.company.com/v1)"
                      placeholderTextColor="#475569"
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                  )}
                  <TextInput
                    style={[styles.input, styles.inputCompact]}
                    value={labelInput}
                    onChangeText={setLabelInput}
                    placeholder={card.id === 'openai_compatible' ? 'Model/deployment ID (e.g. company-agent)' : 'Optional label (e.g. personal, work)'}
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
  // ── Billing priority block ───────────────────────────────────────
  billingBlock: {
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#1e293b',
    borderRadius: 10,
    padding: 12,
    gap: 8,
  },
  billingHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
  },
  billingHeaderLabel: {
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    flex: 1,
  },
  billingHeaderSub: { color: '#64748b', fontSize: 11, lineHeight: 16 },
  billingModeRow: {
    flexDirection: 'row',
    gap: 4,
  },
  billingModeChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#020617',
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  billingModeChipActive: {
    backgroundColor: '#1e1b4b',
    borderColor: '#6366f1',
  },
  billingModeChipText: { color: '#64748b', fontSize: 10, fontWeight: '700' },
  billingModeChipTextActive: { color: '#a5b4fc' },
  billingChain: { gap: 6 },
  billingRow: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: '#020617',
    borderWidth: 1,
    borderColor: '#1e293b',
    borderRadius: 8,
    gap: 4,
  },
  billingRowPrimary: {
    backgroundColor: '#16a34a11',
    borderColor: '#16a34a55',
  },
  billingRowHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    flexWrap: 'wrap',
  },
  billingPosition: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '800',
    minWidth: 16,
  },
  billingPositionPrimary: { color: '#22c55e' },
  billingProviderLabel: { color: '#e2e8f0', fontSize: 13, fontWeight: '700' },
  billingProviderLabelPrimary: { color: '#86efac' },
  billingPrimaryChip: {
    backgroundColor: '#16a34a22',
    borderWidth: 1,
    borderColor: '#16a34a66',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 999,
  },
  billingPrimaryChipText: { color: '#86efac', fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },
  billingScope: { color: '#64748b', fontSize: 11, marginLeft: 'auto' },
  billingReason: { color: '#94a3b8', fontSize: 11, lineHeight: 16, paddingLeft: 24 },
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
  catalogHint: { color: '#475569', fontSize: 10, lineHeight: 14 },
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
