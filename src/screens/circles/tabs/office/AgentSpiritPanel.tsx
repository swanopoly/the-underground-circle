import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import FlatIcon, { ICON_CATALOG } from '../../../../components/FlatIcon';
import SessionTagInput from '../../../../components/SessionTagInput';
import { OfficeAgent, resolveOfficeAgentExecutionTruth } from '../../../../lib/officeAgents';
import { SessionTag, type OfficeSessionStorageScope } from '../../../../lib/sessionTags';
import { getTemplatesByCategory, detectTemplate } from '../../../../lib/soulTemplates';
import { AGENT_SPIRITS, SPIRIT_CATEGORIES, getSpiritById, type AgentSpirit } from '../../../../lib/agentSpirits';
import {
  buildSoulBlueprint,
  buildSoulEvaluationDraft,
  SOUL_EVALUATION_SCENARIOS,
  type SoulEvaluationScenarioId,
} from '../../../../lib/agentSpiritPromptCore';
import {
  buildSpiritOperationsArtifact,
  getSpiritOperationsProfile,
} from '../../../../lib/spiritOperationsProfiles';
import {
  buildCircleCapabilityPreflightExact,
  classifyCircleOwnershipReadiness,
  getSpiritIntegrationRequirements,
  type CircleCapabilityPreflight,
} from '../../../../lib/circleIntegrations';
import type {
  OfficeConnectionAuthorityFence,
  OfficeConnectionExactAuthority,
} from '../../../../lib/connectionManager';
import {
  deleteUnreferencedCustomAgentProfileExact,
  getAgentIdentityKey,
  syncAgentIdentitiesFromServerExact,
  updateAgentIdentityExact,
  updatePublishedAgentSpiritExact,
  type AgentIdentity,
} from '../../../../lib/agentIdentity';
import {
  loadCircleSiteCredentialsExact,
  loadSiteCredentialsExact,
} from '../../../../lib/siteAutomation';
import { getSupabaseClientForAccessToken } from '../../../../lib/supabase';
import { isUuidLike } from '../../../../lib/agentRuntimeSubject';

export type AgentSpiritPanelAuthority = OfficeConnectionExactAuthority;
export type AgentSpiritPanelAuthorityFence = OfficeConnectionAuthorityFence;

interface Props {
  agent: OfficeAgent;
  circleId?: string;
  sessionKey?: string;
  onAgentIdentityChange?: () => void;
  currentTags?: SessionTag[];
  onAddSessionTag?: (sessionKey: string, tag: SessionTag) => void;
  onRemoveSessionTag?: (sessionKey: string, tagKey: string) => void;
  sessionStorageScope?: OfficeSessionStorageScope;
  identityAuthority: AgentSpiritPanelAuthority | null;
  isIdentityAuthorityCurrent: AgentSpiritPanelAuthorityFence;
  onOpenInChat?: (draft?: string) => void;
}

type SpiritReadState<T> =
  | { status: 'idle' | 'loading'; value: null; error: null }
  | { status: 'ready'; value: T; error: null }
  | { status: 'error'; value: null; error: string };

type WordPressReadiness = {
  connected: boolean;
  siteUrl?: string | null;
  username?: string | null;
  label?: string | null;
};

type SoulCatalogCategory = 'all' | AgentSpirit['category'];

// One absolute budget owns auth verification plus every sequential Spirit
// snapshot query. A stalled tab, auth request, or PostgREST socket must yield a
// retryable error state instead of pinning the entire lazy route on a spinner.
const SPIRIT_SNAPSHOT_TIMEOUT_MS = 8_000;

function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return typeof value === 'string' && options.includes(value as T) ? value as T : fallback;
}

function customProfileInsertErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object' || Array.isArray(error)) return '';
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : '';
}

function normalizeSpiritIdentityAuthority(
  circleId: string | undefined,
  authority: AgentSpiritPanelAuthority | null | undefined,
): AgentSpiritPanelAuthority | null {
  const userId = authority?.userId?.trim();
  const authorityCircleId = authority?.circleId?.trim();
  const accessToken = authority?.accessToken?.trim();
  const generation = Number(authority?.generation);
  if (
    !circleId
    || !userId
    || authorityCircleId !== circleId
    || !accessToken
    || !Number.isSafeInteger(generation)
    || generation <= 0
  ) return null;
  return { userId, circleId: authorityCircleId, accessToken, generation };
}

export default function AgentSpiritPanel({
  agent,
  circleId,
  sessionKey,
  onAgentIdentityChange,
  currentTags = [],
  onAddSessionTag,
  onRemoveSessionTag,
  sessionStorageScope,
  identityAuthority,
  isIdentityAuthorityCurrent,
  onOpenInChat,
}: Props) {
  const [showSoul, setShowSoul] = useState(false);
  const [soulText, setSoulText] = useState('');
  const [soulSaving, setSoulSaving] = useState(false);
  const [soulStatus, setSoulStatus] = useState('');
  const [spiritSnapshotState, setSpiritSnapshotState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [spiritSnapshotReload, setSpiritSnapshotReload] = useState(0);
  const [showSpirits, setShowSpirits] = useState(true);
  const [showSoulLab, setShowSoulLab] = useState(false);
  const [showSoulLibrary, setShowSoulLibrary] = useState(false);
  const [selectedSoulTestScenario, setSelectedSoulTestScenario] = useState<SoulEvaluationScenarioId>('ambiguity');
  const [spiritSearch, setSpiritSearch] = useState('');
  const [spiritCategory, setSpiritCategory] = useState<SoulCatalogCategory>('all');
  const [editingSpirit, setEditingSpirit] = useState(false);
  const [customPrompt, setCustomPrompt] = useState('');
  const [customKnobs, setCustomKnobs] = useState({
    actionPosture: 'propose' as string,
    evidencePosture: 'high' as string,
    communicationDensity: 'normal' as string,
    skepticism: 'medium' as string,
    riskTier: 'medium' as string,
    escalationTrigger: '',
    skillBundle: '',
  });
  const [customProfiles, setCustomProfiles] = useState<any[]>([]);
  const [savingProfile, setSavingProfile] = useState(false);
  const [deletingProfileId, setDeletingProfileId] = useState<string | null>(null);
  const [profileActionStatus, setProfileActionStatus] = useState('');
  const [saveProfileName, setSaveProfileName] = useState('');
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [currentSpirit, setCurrentSpirit] = useState<string | null>(null);
  const [spiritAssignmentBusy, setSpiritAssignmentBusy] = useState(false);
  const [spiritAssignmentStatus, setSpiritAssignmentStatus] = useState('');
  const [dbAgentLink, setDbAgentLink] = useState<{ agentKey: string; dbAgentId: string } | null>(null);
  const [opsArtifact, setOpsArtifact] = useState<{ title: string; content: string } | null>(null);
  const [opsActionStatus, setOpsActionStatus] = useState('');
  const [wordpressRead, setWordpressRead] = useState<SpiritReadState<WordPressReadiness>>({ status: 'idle', value: null, error: null });
  const [wordpressReloadGeneration, setWordpressReloadGeneration] = useState(0);
  const [integrationRead, setIntegrationRead] = useState<SpiritReadState<CircleCapabilityPreflight>>({ status: 'idle', value: null, error: null });
  const [integrationReloadGeneration, setIntegrationReloadGeneration] = useState(0);

  const personalityScrollRef = useRef<ScrollView>(null);
  const personalityScrollX = useRef(0);
  const savingProfileRef = useRef(false);
  const savingProfileTokenRef = useRef(0);
  const spiritAssignmentBusyRef = useRef(false);
  const spiritAssignmentTokenRef = useRef(0);
  const stableSessionKey = sessionKey || getAgentIdentityKey(agent);
  const exactIdentityAuthority = useMemo(
    () => normalizeSpiritIdentityAuthority(circleId, identityAuthority),
    [circleId, identityAuthority?.accessToken, identityAuthority?.circleId, identityAuthority?.generation, identityAuthority?.userId],
  );
  const identityRequestKey = exactIdentityAuthority
    ? `${exactIdentityAuthority.userId}\u0000${exactIdentityAuthority.circleId}\u0000${exactIdentityAuthority.generation}\u0000${agent.id}\u0000${stableSessionKey}`
    : '';
  const latestIdentityRequestKeyRef = useRef(identityRequestKey);
  const latestIdentityAuthorityRef = useRef<AgentSpiritPanelAuthority | null>(exactIdentityAuthority);
  latestIdentityRequestKeyRef.current = identityRequestKey;
  latestIdentityAuthorityRef.current = exactIdentityAuthority;
  const capturedIdentityScope = exactIdentityAuthority
    ? `${exactIdentityAuthority.userId}:${exactIdentityAuthority.circleId}:${exactIdentityAuthority.generation}`
    : 'locked';
  const isIdentityRequestCurrent = useCallback(
    (capturedRequestKey: string) => {
      const current = latestIdentityAuthorityRef.current;
      return !!capturedRequestKey
        && !!current
        && latestIdentityRequestKeyRef.current === capturedRequestKey
        && isIdentityAuthorityCurrent(current);
    },
    [isIdentityAuthorityCurrent],
  );
  useEffect(() => () => {
    latestIdentityRequestKeyRef.current = '';
    latestIdentityAuthorityRef.current = null;
  }, []);
  const publishedDbAgentId = agent.connectionId === 'db-agent' && isUuidLike(agent.sessionKey)
    ? agent.sessionKey
    : null;
  const dbAgentId = dbAgentLink?.agentKey === stableSessionKey ? dbAgentLink.dbAgentId : null;
  const selectedSpirit = useMemo(() => {
    if (!currentSpirit) return null;
    const builtIn = getSpiritById(currentSpirit);
    if (builtIn) return builtIn;
    if (!currentSpirit.startsWith('custom::')) return null;
    const profileId = currentSpirit.slice('custom::'.length);
    const profile = customProfiles.find(candidate => String(candidate?.id || '') === profileId);
    if (!profile) return null;
    const text = (value: unknown, fallback: string, max = 4000) => {
      const normalized = typeof value === 'string' ? value.trim() : '';
      return (normalized || fallback).slice(0, max);
    };
    const customSpirit: AgentSpirit = {
      id: currentSpirit,
      name: text(profile.name, 'Custom Spirit', 200),
      emoji: text(profile.emoji, '🤖', 16),
      color: text(profile.color, '#6366f1', 32),
      category: 'thinking' as const,
      tagline: text(profile.tagline, 'Custom behavioral profile', 300),
      systemPromptPrefix: text(profile.system_prompt, '', 20_000),
      skillBundle: text(profile.skill_bundle, 'custom', 300),
      riskTier: oneOf(profile.risk_tier, ['low', 'medium', 'high', 'critical'] as const, 'medium'),
      actionPosture: oneOf(profile.action_posture, ['act', 'act-gated', 'observe-act-gated', 'observe-propose', 'propose', 'never-act'] as const, 'propose'),
      evidencePosture: oneOf(profile.evidence_posture, ['medium', 'high', 'very-high'] as const, 'high'),
      communicationDensity: oneOf(profile.communication_density, ['terse', 'normal', 'detailed', 'motivational'] as const, 'normal'),
      skepticism: oneOf(profile.skepticism, ['low', 'medium', 'high', 'very-high'] as const, 'medium'),
      escalationTrigger: text(profile.escalation_trigger, 'When requirements, evidence, or risk are unclear.', 500),
    };
    return customSpirit;
  }, [currentSpirit, customProfiles]);
  const filteredSpirits = useMemo(() => {
    const query = spiritSearch.trim().toLowerCase();
    return AGENT_SPIRITS.filter(spirit => {
      if (spiritCategory !== 'all' && spirit.category !== spiritCategory) return false;
      if (!query) return true;
      return [spirit.name, spirit.tagline, spirit.skillBundle]
        .some(value => value.toLowerCase().includes(query));
    });
  }, [spiritCategory, spiritSearch]);
  const executionTruth = resolveOfficeAgentExecutionTruth(agent);
  const activityCopy = executionTruth.state === 'warning'
    ? `Runtime status warning: ${executionTruth.statusWarning}. Refresh the connection before assigning new work.`
    : executionTruth.state === 'active'
      ? executionTruth.activity || 'Agent is active; no current activity label was reported.'
      : executionTruth.state === 'connected'
        ? 'Agent is connected and standing by. No current execution is verified.'
        : 'Agent is offline or unavailable. Reconnect it before assigning new work.';
  const currentOperationsProfile = currentSpirit && !currentSpirit.startsWith('custom::')
    ? getSpiritOperationsProfile(currentSpirit)
    : null;
  const spiritIntegrationRequirements = currentSpirit && !currentSpirit.startsWith('custom::')
    ? getSpiritIntegrationRequirements(currentSpirit)
    : { requiredConnectors: [], requiredCapabilities: [] };
  const integrationReadiness = integrationRead.status === 'ready' ? integrationRead.value : null;
  const ownershipReadiness = integrationReadiness
    ? classifyCircleOwnershipReadiness(integrationReadiness)
    : null;
  const ensureDbAgent = useCallback(async (): Promise<string | null> => {
    if (dbAgentId) return dbAgentId;
    const authority = exactIdentityAuthority;
    const capturedRequestKey = identityRequestKey;
    if (!circleId || !authority || !capturedRequestKey || !publishedDbAgentId) return null;
    // Only an already-published row is eligible for a shared Office Spirit
    // projection. A live session keeps its Spirit in the exact identity store;
    // editing this panel never name-matches or creates a public agent row.
    const exactClient = getSupabaseClientForAccessToken(authority.accessToken);
    const { data, error } = await exactClient
      .from('circle_office_agents')
      .select('id, spirit, spirit_emoji')
      .eq('id', publishedDbAgentId)
      .eq('circle_id', circleId)
      .eq('owner_id', authority.userId)
      .maybeSingle();
    if (
      error
      || !data
      || String(data.id || '') !== publishedDbAgentId
      || !isIdentityRequestCurrent(capturedRequestKey)
    ) return null;
    setDbAgentLink({ agentKey: stableSessionKey, dbAgentId: data.id });
    setCurrentSpirit(data.spirit || null);
    return data.id;
  }, [circleId, dbAgentId, exactIdentityAuthority, identityRequestKey, isIdentityRequestCurrent, publishedDbAgentId, stableSessionKey]);

  const persistIdentityPatch = useCallback(async (updates: Partial<AgentIdentity>): Promise<boolean> => {
    const authority = exactIdentityAuthority;
    const capturedRequestKey = identityRequestKey;
    if (!authority || !capturedRequestKey) return false;
    const receipt = await updateAgentIdentityExact(
      stableSessionKey,
      updates,
      authority,
      isIdentityAuthorityCurrent,
    );
    return receipt.ok
      && receipt.localSaved
      && receipt.serverSaved === true
      && isIdentityRequestCurrent(capturedRequestKey);
  }, [exactIdentityAuthority, identityRequestKey, isIdentityAuthorityCurrent, isIdentityRequestCurrent, stableSessionKey]);

  const persistSpiritSelection = useCallback(async (
    spirit: string | null,
    spiritEmoji: string | null,
    identityUpdates: Partial<AgentIdentity>,
  ): Promise<boolean> => {
    const authority = exactIdentityAuthority;
    const capturedRequestKey = identityRequestKey;
    if (!authority || !capturedRequestKey || !isIdentityRequestCurrent(capturedRequestKey)) return false;
    if (spiritAssignmentBusyRef.current) {
      setSpiritAssignmentStatus('A Spirit change is already in progress.');
      return false;
    }
    spiritAssignmentBusyRef.current = true;
    const mutationToken = spiritAssignmentTokenRef.current + 1;
    spiritAssignmentTokenRef.current = mutationToken;
    setSpiritAssignmentBusy(true);
    setSpiritAssignmentStatus('');
    try {
      let saved = false;
      let durableButLocalRefreshNeeded = false;
      let outcomeUnknown = false;
      if (publishedDbAgentId) {
        const linkedAgentId = await ensureDbAgent();
        if (linkedAgentId && isIdentityRequestCurrent(capturedRequestKey)) {
          const customProfileId = typeof identityUpdates.customProfileId === 'string'
            ? identityUpdates.customProfileId
            : null;
          const receipt = await updatePublishedAgentSpiritExact({
            officeAgentId: linkedAgentId,
            sessionKey: stableSessionKey,
            spiritId: spirit,
            spiritEmoji,
            customProfileId,
          }, authority, isIdentityAuthorityCurrent);
          saved = receipt.ok
            && receipt.localSaved
            && receipt.serverSaved === true
            && isIdentityRequestCurrent(capturedRequestKey);
          durableButLocalRefreshNeeded = receipt.serverSaved === true && !receipt.localSaved;
          outcomeUnknown = receipt.error === 'outcome_unknown';
        }
      } else {
        saved = (await persistIdentityPatch(identityUpdates))
          && isIdentityRequestCurrent(capturedRequestKey);
      }
      if (isIdentityRequestCurrent(capturedRequestKey)) {
        setSpiritAssignmentStatus(
          outcomeUnknown
            ? 'WARNING: Spirit outcome could not be verified. Refresh this Spirit before retrying.'
            : durableButLocalRefreshNeeded
            ? 'WARNING: Spirit was saved on the server, but this view could not refresh. Reload the Spirit panel.'
            : saved
              ? spirit === null ? 'Spirit assignment cleared.' : 'Spirit assignment saved.'
              : 'ERROR: Spirit assignment was not saved. Check the connection and try again.',
        );
      }
      return saved;
    } catch (error) {
      console.warn('[AgentSpiritPanel] Failed to persist Spirit assignment:', error);
      if (isIdentityRequestCurrent(capturedRequestKey)) {
        setSpiritAssignmentStatus('ERROR: Spirit assignment was not saved. Check the connection and try again.');
      }
      return false;
    } finally {
      if (spiritAssignmentTokenRef.current === mutationToken) {
        spiritAssignmentBusyRef.current = false;
        if (isIdentityRequestCurrent(capturedRequestKey)) setSpiritAssignmentBusy(false);
      }
    }
  }, [ensureDbAgent, exactIdentityAuthority, identityRequestKey, isIdentityAuthorityCurrent, isIdentityRequestCurrent, persistIdentityPatch, publishedDbAgentId, stableSessionKey]);

  useEffect(() => {
    setDbAgentLink(null);
    setCurrentSpirit(null);
    setEditingSpirit(false);
    setShowSoul(false);
    setShowSoulLab(false);
    setShowSoulLibrary(false);
    setSelectedSoulTestScenario('ambiguity');
    setSpiritSearch('');
    setSpiritCategory('all');
    setSoulSaving(false);
    setSoulStatus('');
    setOpsArtifact(null);
    setOpsActionStatus('');
    setSoulText('');
    setCustomProfiles([]);
    setSpiritSnapshotState('loading');
    savingProfileTokenRef.current += 1;
    savingProfileRef.current = false;
    setSavingProfile(false);
    setDeletingProfileId(null);
    setProfileActionStatus('');
    spiritAssignmentTokenRef.current += 1;
    spiritAssignmentBusyRef.current = false;
    setSpiritAssignmentBusy(false);
    setSpiritAssignmentStatus('');
    setShowSaveForm(false);
    setSaveProfileName('');
    setWordpressRead({ status: 'idle', value: null, error: null });
    setIntegrationRead({ status: 'idle', value: null, error: null });
    setWordpressReloadGeneration(0);
    setIntegrationReloadGeneration(0);
  }, [agent.id, capturedIdentityScope, identityRequestKey]);

  useEffect(() => {
    setOpsArtifact(null);
    setOpsActionStatus('');
  }, [currentSpirit]);

  useEffect(() => {
    const authority = exactIdentityAuthority;
    const capturedRequestKey = identityRequestKey;
    if (!circleId || !authority || !capturedRequestKey) {
      setSpiritSnapshotState('error');
      return;
    }
    const agentKey = stableSessionKey;
    let cancelled = false;
    const snapshotController = new AbortController();
    const snapshotDeadline = setTimeout(
      () => snapshotController.abort(),
      SPIRIT_SNAPSHOT_TIMEOUT_MS,
    );
    (async () => {
      setSpiritSnapshotState('loading');
      setSoulStatus('');
      try {
        const snapshotClient = getSupabaseClientForAccessToken(authority.accessToken);
        const identityResult = await syncAgentIdentitiesFromServerExact(authority, {
          fence: isIdentityAuthorityCurrent,
          signal: snapshotController.signal,
        });
        if (cancelled || !isIdentityRequestCurrent(capturedRequestKey)) return;
        if (!identityResult.ok) throw new Error('identity snapshot unavailable');

        let publishedRow: any = null;
        if (publishedDbAgentId) {
          const { data, error } = await snapshotClient
            .from('circle_office_agents')
            .select('id, circle_id, owner_id, spirit, spirit_emoji')
            .eq('id', publishedDbAgentId)
            .eq('circle_id', circleId)
            .eq('owner_id', authority.userId)
            .abortSignal(snapshotController.signal)
            .maybeSingle();
          if (
            error
            || !data
            || String(data.id || '') !== publishedDbAgentId
            || String(data.circle_id || '') !== circleId
            || String(data.owner_id || '') !== authority.userId
          ) throw new Error('published Spirit snapshot unavailable');
          publishedRow = data;
        }

        const { data: profiles, error: profilesError } = await snapshotClient
          .from('custom_agent_profiles')
          .select('*')
          .eq('user_id', authority.userId)
          .order('name')
          .abortSignal(snapshotController.signal);
        if (
          profilesError
          || !Array.isArray(profiles)
          || profiles.some(profile => String(profile?.user_id || '') !== authority.userId)
        ) throw new Error('custom Spirit profiles unavailable');
        if (cancelled || !isIdentityRequestCurrent(capturedRequestKey)) return;

        const identity = identityResult.identities.get(stableSessionKey);
        let verifiedSoul = identity?.soulPrompt?.trim() || '';
        if (!verifiedSoul) {
          const { data: defaultData, error: defaultError } = await snapshotClient
            .from('agent_personalities')
            .select('personality')
            .eq('user_id', authority.userId)
            .eq('circle_id', circleId)
            .eq('agent_name', 'default')
            .abortSignal(snapshotController.signal)
            .maybeSingle();
          if (defaultError) {
            setSoulStatus('Default Soul fallback could not be verified. Agent-specific Spirit data is still current.');
          } else {
            verifiedSoul = String(defaultData?.personality || '');
          }
        }
        if (cancelled || !isIdentityRequestCurrent(capturedRequestKey)) return;
        if (publishedRow) setDbAgentLink({ agentKey, dbAgentId: publishedRow.id });
        setCurrentSpirit(identity?.spiritId || publishedRow?.spirit || null);
        setSoulText(verifiedSoul);
        setCustomProfiles(profiles);
        setSpiritSnapshotState('ready');
      } catch {
        if (cancelled || !isIdentityRequestCurrent(capturedRequestKey)) return;
        setSpiritSnapshotState('error');
      } finally {
        clearTimeout(snapshotDeadline);
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(snapshotDeadline);
      snapshotController.abort();
    };
  }, [circleId, exactIdentityAuthority, identityRequestKey, isIdentityAuthorityCurrent, isIdentityRequestCurrent, publishedDbAgentId, spiritSnapshotReload, stableSessionKey]);

  useEffect(() => {
    const capturedRequestKey = identityRequestKey;
    if (!currentOperationsProfile) {
      setWordpressRead({ status: 'idle', value: null, error: null });
      return;
    }
    if (!circleId || !exactIdentityAuthority || !capturedRequestKey) {
      setWordpressRead({ status: 'error', value: null, error: 'WordPress connection status is unavailable until Office authority is restored.' });
      return;
    }
    let cancelled = false;
    const authority = exactIdentityAuthority;
    setWordpressRead({ status: 'loading', value: null, error: null });
    (async () => {
      try {
        const circleRead = await loadCircleSiteCredentialsExact(circleId, 'wordpress', authority);
        if (cancelled || !isIdentityRequestCurrent(capturedRequestKey)) return;
        if (!circleRead.readOk) {
          setWordpressRead({ status: 'error', value: null, error: 'WordPress connection status could not be loaded.' });
          return;
        }
        let credentials = circleRead.credentials;
        if (credentials.length === 0) {
          const userRead = await loadSiteCredentialsExact('wordpress', authority);
          if (cancelled || !isIdentityRequestCurrent(capturedRequestKey)) return;
          if (!userRead.readOk) {
            setWordpressRead({ status: 'error', value: null, error: 'WordPress connection status could not be loaded.' });
            return;
          }
          credentials = userRead.credentials;
        }
        const primary = credentials.find(credential => credential.isActive) || credentials[0];
        setWordpressRead({
          status: 'ready',
          value: primary ? {
            connected: true,
            siteUrl: primary.siteUrl,
            username: primary.username,
            label: primary.label,
          } : { connected: false },
          error: null,
        });
      } catch {
        if (cancelled || !isIdentityRequestCurrent(capturedRequestKey)) return;
        setWordpressRead({ status: 'error', value: null, error: 'WordPress connection status could not be loaded.' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [circleId, currentOperationsProfile?.spiritId, exactIdentityAuthority, identityRequestKey, isIdentityRequestCurrent, wordpressReloadGeneration]);

  useEffect(() => {
    const capturedRequestKey = identityRequestKey;
    let cancelled = false;
    (async () => {
      if (!currentSpirit || currentSpirit.startsWith('custom::')) {
        setIntegrationRead({ status: 'idle', value: null, error: null });
        return;
      }
      if (!circleId || !exactIdentityAuthority || !capturedRequestKey) {
        setIntegrationRead({ status: 'error', value: null, error: 'Integration readiness is unavailable until Office authority is restored.' });
        return;
      }
      const requirements = getSpiritIntegrationRequirements(currentSpirit);
      if (requirements.requiredConnectors.length === 0 && requirements.requiredCapabilities.length === 0) {
        setIntegrationRead({
          status: 'ready',
          value: { ok: true, missingCapabilities: [], missingConnectors: [] },
          error: null,
        });
        return;
      }
      setIntegrationRead({ status: 'loading', value: null, error: null });
      try {
        const result = await buildCircleCapabilityPreflightExact({
          circleId,
          requiredConnectors: requirements.requiredConnectors,
          requiredCapabilities: requirements.requiredCapabilities,
          authority: exactIdentityAuthority,
        });
        if (cancelled || !isIdentityRequestCurrent(capturedRequestKey)) return;
        if (!result.readOk) {
          setIntegrationRead({ status: 'error', value: null, error: 'Integration readiness could not be loaded.' });
          return;
        }
        setIntegrationRead({ status: 'ready', value: result.preflight, error: null });
      } catch {
        if (cancelled || !isIdentityRequestCurrent(capturedRequestKey)) return;
        setIntegrationRead({ status: 'error', value: null, error: 'Integration readiness could not be loaded.' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [circleId, currentSpirit, exactIdentityAuthority, identityRequestKey, integrationReloadGeneration, isIdentityRequestCurrent]);

  const handleSaveSoul = async () => {
    const authority = exactIdentityAuthority;
    const capturedRequestKey = identityRequestKey;
    if (!circleId || !agent || !authority || !capturedRequestKey) return;
    setSoulSaving(true);
    setSoulStatus('');
    try {
      const identitySaved = await persistIdentityPatch({
        soulPrompt: soulText.trim(),
        isCustomized: true,
      });
      if (!isIdentityRequestCurrent(capturedRequestKey)) return;
      if (!identitySaved) {
        setSoulStatus('ERROR: Soul was not saved. Check the connection and try again.');
        return;
      }
      onAgentIdentityChange?.();
      setSoulStatus('Soul saved.');
    } catch (err) {
      console.warn('[AgentSpiritPanel] Failed to save Soul:', err);
      if (isIdentityRequestCurrent(capturedRequestKey)) {
        setSoulStatus('ERROR: Soul was not saved. Check the connection and try again.');
      }
    } finally {
      if (isIdentityRequestCurrent(capturedRequestKey)) setSoulSaving(false);
    }
  };

  const handleGenerateOpsArtifact = async (kind: 'ops_plan' | 'access_checklist' | 'sop') => {
    const artifact = buildSpiritOperationsArtifact(kind, currentOperationsProfile?.spiritId || null);
    setOpsArtifact(artifact);
    setOpsActionStatus(artifact ? `${artifact.title} generated` : 'No company operations profile available');
    setTimeout(() => setOpsActionStatus(''), 2500);
  };

  const handleSaveOpsArtifact = async () => {
    const authority = exactIdentityAuthority;
    const capturedRequestKey = identityRequestKey;
    if (!circleId || !opsArtifact || !authority || !capturedRequestKey) return;
    if (!isIdentityRequestCurrent(capturedRequestKey)) return;
    if (!onOpenInChat) {
      setOpsActionStatus('Continue in Chat to save this artifact with the agent conversation and run lineage.');
      return;
    }
    onOpenInChat([
      'Review this operations artifact and save it as durable Spirit memory only after returning an exact memory receipt.',
      '',
      opsArtifact.title,
      opsArtifact.content,
    ].join('\n').slice(0, 3_500));
  };

  const handleDeleteCustomProfile = async (profile: any) => {
    const authority = exactIdentityAuthority;
    const capturedRequestKey = identityRequestKey;
    const profileId = String(profile?.id || '').trim();
    const profileName = String(profile?.name || 'Untitled profile').trim() || 'Untitled profile';
    if (!authority || !capturedRequestKey || !profileId || deletingProfileId) return;

    setDeletingProfileId(profileId);
    setProfileActionStatus('');
    try {
      const receipt = await deleteUnreferencedCustomAgentProfileExact(
        profileId,
        authority,
        isIdentityAuthorityCurrent,
      );
      if (!isIdentityRequestCurrent(capturedRequestKey)) return;
      if (!receipt.ok || receipt.serverDeleted !== true) {
        if (receipt.error === 'outcome_unknown') {
          setProfileActionStatus(`WARNING: ${profileName} deletion could not be verified. Refresh profiles before retrying.`);
          return;
        }
        if (receipt.error === 'profile_referenced') {
          setProfileActionStatus(`WARNING: ${profileName} is assigned to one or more agents. Clear every assignment before deleting it.`);
          return;
        }
        throw new Error('The profile deletion did not return one exact server receipt.');
      }

      setCustomProfiles(prev => prev.filter(candidate => String(candidate.id) !== profileId));
      setProfileActionStatus(`Deleted custom profile: ${profileName}`);
    } catch (err) {
      console.warn('[AgentSpiritPanel] Failed to delete custom profile:', err);
      if (!isIdentityRequestCurrent(capturedRequestKey)) return;
      setProfileActionStatus(`ERROR: Could not delete custom profile: ${profileName}`);
    } finally {
      if (isIdentityRequestCurrent(capturedRequestKey)) {
        setDeletingProfileId(current => current === profileId ? null : current);
      }
    }
  };

  const requestDeleteCustomProfile = (profile: any) => {
    if (deletingProfileId) return;
    const profileName = String(profile?.name || 'Untitled profile').trim() || 'Untitled profile';
    const message = `Delete "${profileName}"? This cannot be undone. Profiles assigned to any agent must be cleared first.`;
    const confirmDelete = () => { void handleDeleteCustomProfile(profile); };

    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm(message)) confirmDelete();
      return;
    }

    Alert.alert('Delete custom profile?', message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: confirmDelete },
    ]);
  };

  if (spiritSnapshotState === 'loading') {
    return (
      <View accessibilityLiveRegion="polite" style={{ minHeight: 120, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 16 }}>
        <ActivityIndicator
          accessibilityRole="progressbar"
          accessibilityLabel="Loading verified Spirit identity"
          size="small"
          color={agent.color || '#6366f1'}
        />
        <Text style={{ color: '#808090', fontSize: 11, fontFamily: 'monospace' }}>Loading verified Spirit identity…</Text>
      </View>
    );
  }

  if (spiritSnapshotState === 'error') {
    return (
      <View accessibilityRole="alert" accessibilityLiveRegion="assertive" style={{ gap: 10, margin: 8, padding: 12, borderWidth: 1, borderColor: '#ef444455', backgroundColor: '#2a0b0b', borderRadius: 6 }}>
        <Text style={{ color: '#fca5a5', fontSize: 12, lineHeight: 18 }}>
          Spirit identity could not be verified. No assignment or risk posture is being inferred from an empty response.
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry loading verified Spirit identity"
          onPress={() => setSpiritSnapshotReload(value => value + 1)}
          style={[{ minHeight: 44, alignSelf: 'flex-start', paddingHorizontal: 12, borderRadius: 6, borderWidth: 1, borderColor: '#ef444466', justifyContent: 'center' }, Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}
        >
          <Text style={{ color: '#fca5a5', fontSize: 11, fontWeight: '700' }}>TRY AGAIN</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <>
      <Pressable
        onPress={() => setShowSpirits(!showSpirits)}
        accessibilityRole="button"
        accessibilityLabel={showSpirits ? 'Hide Spirit settings' : 'Show Spirit settings'}
        accessibilityState={{ expanded: showSpirits }}
        style={[styles.spiritRow, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
      >
        <Text style={styles.spiritLabel}>
          {showSpirits ? '▼' : '▶'} SOUL
        </Text>
        {selectedSpirit ? (
          <View style={[styles.spiritBadge, { flexDirection: 'row', alignItems: 'center', gap: 6 }]}>
            {ICON_CATALOG[selectedSpirit.id] ? (
              <FlatIcon name={selectedSpirit.id} size={18} />
            ) : (
              <Text style={{ fontSize: 12 }}>{selectedSpirit.emoji}</Text>
            )}
            <Text style={styles.spiritBadgeText}>
              {selectedSpirit.name}
            </Text>
          </View>
        ) : (
          <Text style={styles.spiritNone}>none assigned</Text>
        )}
      </Pressable>

      {showSpirits && (
        <View style={styles.spiritPicker}>
          <Text style={styles.spiritHint}>
            Assign a specialty that shapes how {agent.name} approaches work, communicates, handles evidence, and escalates.
          </Text>
          {(spiritAssignmentBusy || spiritAssignmentStatus) ? (
            <Text
              accessibilityRole={spiritAssignmentStatus.startsWith('ERROR') ? 'alert' : undefined}
              accessibilityLiveRegion="polite"
              style={{
                color: spiritAssignmentStatus.startsWith('ERROR') ? '#fca5a5' : '#94a3b8',
                fontSize: 11,
                fontFamily: 'monospace',
                lineHeight: 16,
                marginBottom: 8,
              }}
            >
              {spiritAssignmentBusy ? 'Saving verified Spirit assignment…' : spiritAssignmentStatus}
            </Text>
          ) : null}
          {selectedSpirit && (() => {
            const s = selectedSpirit;
            const postureColors: Record<string, string> = {
              'act': '#22c55e', 'act-gated': '#3b82f6', 'observe-act-gated': '#f59e0b',
              'observe-propose': '#a855f7', 'propose': '#6366f1', 'never-act': '#ef4444',
            };
            const riskColors: Record<string, string> = {
              'low': '#22c55e', 'medium': '#f59e0b', 'high': '#ef4444', 'critical': '#dc2626',
            };
            const knobs = editingSpirit ? customKnobs : {
              actionPosture: s.actionPosture, evidencePosture: s.evidencePosture,
              communicationDensity: s.communicationDensity, skepticism: s.skepticism,
              riskTier: s.riskTier, escalationTrigger: s.escalationTrigger, skillBundle: s.skillBundle,
            };
            const prompt = editingSpirit ? customPrompt : s.systemPromptPrefix;
            const soulBlueprint = buildSoulBlueprint({
              purpose: s.tagline,
              systemPrompt: prompt,
              skillBundle: knobs.skillBundle,
              escalationTrigger: knobs.escalationTrigger,
              actionPosture: knobs.actionPosture,
              evidencePosture: knobs.evidencePosture,
              communicationDensity: knobs.communicationDensity,
              skepticism: knobs.skepticism,
              riskTier: knobs.riskTier,
            });
            const selectedScenario = SOUL_EVALUATION_SCENARIOS.find(
              scenario => scenario.id === selectedSoulTestScenario,
            ) || SOUL_EVALUATION_SCENARIOS[0];
            const soulTestDisabled = !onOpenInChat || editingSpirit;

            const KnobPicker = ({ label, value, options, colors }: { label: string; value: string; options: string[]; colors?: Record<string, string> }) => (
              <View style={styles.spiritKnob}>
                <Text style={styles.spiritKnobLabel}>{label}</Text>
                {editingSpirit ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 3, justifyContent: 'center' }}>
                    {options.map(opt => (
                      <Pressable
                        key={opt}
                        accessibilityRole="button"
                        accessibilityLabel={`${label.toLowerCase()} ${opt.replace(/-/g, ' ')}`}
                        accessibilityState={{ selected: value === opt }}
                        onPress={() => setCustomKnobs(prev => ({ ...prev, [label === 'ACTION' ? 'actionPosture' : label === 'EVIDENCE' ? 'evidencePosture' : label === 'COMMUNICATION' ? 'communicationDensity' : label === 'SKEPTICISM' ? 'skepticism' : 'riskTier']: opt }))}
                        style={[{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 8, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: value === opt ? (colors?.[opt] || '#6366f1') + '60' : '#1e1e3a', backgroundColor: value === opt ? (colors?.[opt] || '#6366f1') + '15' : 'transparent' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                        <Text style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: '700', color: value === opt ? (colors?.[opt] || '#6366f1') : '#555' }}>{opt.replace(/-/g, ' ').toUpperCase()}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : (
                  <Text style={[styles.spiritKnobValue, { color: (colors?.[value] || '#6366f1') }]}>{value.replace(/-/g, ' ').toUpperCase()}</Text>
                )}
              </View>
            );

            return (
              <View style={styles.spiritDetail}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  {ICON_CATALOG[s.id] ? <FlatIcon name={s.id} size={28} glow /> : <Text style={{ fontSize: 24 }}>{s.emoji}</Text>}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.spiritDetailName}>{s.name}</Text>
                    <Text style={styles.spiritDetailTagline}>{s.tagline}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${editingSpirit ? 'Stop editing' : 'Edit'} ${s.name} Spirit settings`}
                      accessibilityState={{ selected: editingSpirit }}
                      onPress={() => {
                        if (!editingSpirit) {
                          setCustomPrompt(s.systemPromptPrefix);
                          setCustomKnobs({ actionPosture: s.actionPosture, evidencePosture: s.evidencePosture, communicationDensity: s.communicationDensity, skepticism: s.skepticism, riskTier: s.riskTier, escalationTrigger: s.escalationTrigger, skillBundle: s.skillBundle });
                        }
                        setEditingSpirit(!editingSpirit);
                      }}
                      style={[{ minHeight: 44, justifyContent: 'center', paddingVertical: 5, paddingHorizontal: 10, borderRadius: 6, backgroundColor: editingSpirit ? '#6366f120' : '#ffffff08', borderWidth: 1, borderColor: editingSpirit ? '#6366f140' : '#ffffff15' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                    >
                      <Text style={{ fontSize: 13, fontFamily: 'monospace', fontWeight: '700', color: editingSpirit ? '#6366f1' : '#888' }}>{editingSpirit ? 'EDITING' : 'EDIT'}</Text>
                    </Pressable>
                    <Pressable
                      disabled={spiritAssignmentBusy}
                      accessibilityRole="button"
                      accessibilityLabel="Clear Spirit assignment"
                      accessibilityState={{ disabled: spiritAssignmentBusy, busy: spiritAssignmentBusy }}
                      onPress={async () => {
                      const authority = exactIdentityAuthority;
                      const capturedRequestKey = identityRequestKey;
                      if (!authority || !capturedRequestKey) return;
                      const saved = await persistSpiritSelection(null, null, {
                        spiritId: null,
                        spiritEmoji: null,
                        customProfileId: null,
                        customProfileName: null,
                        isCustomized: true,
                      });
                      if (!saved || !isIdentityRequestCurrent(capturedRequestKey)) return;
                      onAgentIdentityChange?.();
                      setCurrentSpirit(null);
                      setEditingSpirit(false);
                    }}
                      style={[styles.spiritClearBtn, spiritAssignmentBusy && { opacity: 0.45 }, Platform.OS === 'web' && { cursor: spiritAssignmentBusy ? 'default' : 'pointer' } as any]}>
                      <Text style={styles.spiritClearText}>{spiritAssignmentBusy ? 'Saving…' : 'Clear'}</Text>
                    </Pressable>
                  </View>
                </View>

                <View style={styles.spiritKnobsGrid}>
                  <KnobPicker label="ACTION" value={knobs.actionPosture} options={['act', 'act-gated', 'observe-act-gated', 'observe-propose', 'propose', 'never-act']} colors={postureColors} />
                  <KnobPicker label="EVIDENCE" value={knobs.evidencePosture} options={['medium', 'high', 'very-high']} />
                  <KnobPicker label="COMMUNICATION" value={knobs.communicationDensity} options={['terse', 'normal', 'detailed', 'motivational']} />
                  <KnobPicker label="SKEPTICISM" value={knobs.skepticism} options={['low', 'medium', 'high', 'very-high']} colors={{ 'low': '#22c55e', 'medium': '#f59e0b', 'high': '#ef4444', 'very-high': '#dc2626' }} />
                  <KnobPicker label="RISK TIER" value={knobs.riskTier} options={['low', 'medium', 'high', 'critical']} colors={riskColors} />
                  <View style={styles.spiritKnob}>
                    <Text style={styles.spiritKnobLabel}>SKILL</Text>
                    {editingSpirit ? (
                      <TextInput accessibilityLabel="Spirit skill bundle" value={customKnobs.skillBundle} onChangeText={v => setCustomKnobs(prev => ({ ...prev, skillBundle: v }))}
                        style={{ fontSize: 12, color: '#6366f1', fontFamily: 'monospace', fontWeight: '700', textAlign: 'center', borderBottomWidth: 1, borderBottomColor: '#1e1e3a', paddingVertical: 6 }} placeholder="skill-name" placeholderTextColor="#333" />
                    ) : (
                      <Text style={[styles.spiritKnobValue, { color: '#6366f1' }]} numberOfLines={1}>{knobs.skillBundle}</Text>
                    )}
                  </View>
                </View>

                <View style={styles.spiritEscalation}>
                  <Text style={styles.spiritKnobLabel}>ESCALATES WHEN</Text>
                  {editingSpirit ? (
                    <TextInput accessibilityLabel="Spirit escalation trigger" value={customKnobs.escalationTrigger} onChangeText={v => setCustomKnobs(prev => ({ ...prev, escalationTrigger: v }))}
                      style={[styles.spiritEscalationText, { borderBottomWidth: 1, borderBottomColor: '#1e1e3a', paddingVertical: 6 }]}
                      placeholder="e.g. failing tests, unclear requirements" placeholderTextColor="#333" />
                  ) : (
                    <Text style={styles.spiritEscalationText}>{knobs.escalationTrigger}</Text>
                  )}
                </View>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${showSoul ? 'Hide' : 'Show'} system prompt`}
                  accessibilityState={{ expanded: showSoul }}
                  onPress={() => setShowSoul(!showSoul)}
                  style={[{ marginTop: 10, minHeight: 44, justifyContent: 'center' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                >
                  <Text style={{ color: '#888', fontSize: 14, fontFamily: 'monospace', fontWeight: '800', letterSpacing: 1 }}>
                    {showSoul ? '▼' : '▶'} SYSTEM PROMPT ({Math.round(prompt.length / 100) * 100}+ chars)
                  </Text>
                </Pressable>
                {showSoul && (
                  <View style={{ marginTop: 4 }}>
                    {editingSpirit ? (
                      <TextInput accessibilityLabel="Spirit system prompt" value={customPrompt} onChangeText={setCustomPrompt} multiline
                        style={{ backgroundColor: '#000', borderWidth: 1, borderColor: '#1e1e3a', borderRadius: 8, padding: 12, color: '#ccc', fontFamily: 'monospace', fontSize: 14, minHeight: 200, maxHeight: 400, textAlignVertical: 'top' }}
                        placeholder="System prompt instructions..." placeholderTextColor="#333" />
                    ) : (
                      <View style={{ backgroundColor: '#000', borderWidth: 1, borderColor: '#1e1e3a', borderRadius: 8, padding: 12 }}>
                        <Text style={{ color: '#aaa', fontFamily: 'monospace', fontSize: 14, lineHeight: 17 }} selectable>{prompt}</Text>
                      </View>
                    )}
                  </View>
                )}

                <View testID="agent-soul-lab" style={styles.soulLab}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${showSoulLab ? 'Hide' : 'Show'} Soul Lab`}
                    accessibilityState={{ expanded: showSoulLab }}
                    onPress={() => setShowSoulLab(value => !value)}
                    style={({ pressed }) => [
                      styles.soulLabHeader,
                      pressed && styles.soulPressed,
                      Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text accessibilityRole="header" style={styles.soulLabTitle}>
                        {showSoulLab ? '▼' : '▶'} SOUL LAB
                      </Text>
                      <Text style={styles.soulLabSubtitle}>Understand the contract, then test it without taking action.</Text>
                    </View>
                    <Text style={styles.soulLabCount}>{soulBlueprint.completeCount}/{soulBlueprint.checks.length} defined</Text>
                  </Pressable>

                  {showSoulLab ? (
                    <View style={styles.soulLabBody}>
                      <Text style={styles.soulLabNotice}>
                        Configuration completeness is not a quality score. Use representative scenarios before changing a working Soul.
                      </Text>

                      <View style={styles.soulContractGrid}>
                        {[
                          ['AUTONOMY', soulBlueprint.autonomy],
                          ['PROOF', soulBlueprint.evidence],
                          ['RISK', soulBlueprint.risk],
                          ['ESCALATION', soulBlueprint.escalation],
                        ].map(([label, value]) => (
                          <View key={label} style={styles.soulContractRow}>
                            <Text style={styles.soulContractLabel}>{label}</Text>
                            <Text style={styles.soulContractValue}>{value}</Text>
                          </View>
                        ))}
                      </View>

                      <View style={styles.soulPromptFootprint}>
                        <Text style={styles.soulContractLabel}>VISIBLE GUIDANCE FOOTPRINT</Text>
                        <Text style={styles.soulContractValue}>
                          {soulBlueprint.promptFootprintLabel} · {soulBlueprint.promptChars.toLocaleString()} characters
                        </Text>
                        <Text style={styles.soulLabFinePrint}>{soulBlueprint.promptGuidance}</Text>
                      </View>

                      <View style={styles.soulCheckRow}>
                        {soulBlueprint.checks.map(check => (
                          <View key={check.id} style={[styles.soulCheckChip, check.ready && styles.soulCheckChipReady]}>
                            <Text style={[styles.soulCheckText, check.ready && styles.soulCheckTextReady]}>
                              {check.ready ? 'READY' : 'MISSING'} · {check.label}
                            </Text>
                          </View>
                        ))}
                      </View>

                      <View>
                        <Text style={styles.soulLabSectionTitle}>NO-ACTION TEST</Text>
                        <Text style={styles.soulLabFinePrint}>
                          Choose a scenario. Chat receives a draft only; nothing is sent or executed automatically.
                        </Text>
                        <View style={styles.soulScenarioRow}>
                          {SOUL_EVALUATION_SCENARIOS.map(scenario => {
                            const selected = scenario.id === selectedSoulTestScenario;
                            return (
                              <Pressable
                                key={scenario.id}
                                accessibilityRole="button"
                                accessibilityLabel={`Select ${scenario.label} Soul test`}
                                accessibilityState={{ selected }}
                                onPress={() => setSelectedSoulTestScenario(scenario.id)}
                                style={({ pressed }) => [
                                  styles.soulScenarioChip,
                                  selected && styles.soulScenarioChipSelected,
                                  pressed && styles.soulPressed,
                                  Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
                                ]}
                              >
                                <Text style={[styles.soulScenarioText, selected && styles.soulScenarioTextSelected]}>
                                  {scenario.label}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </View>
                        <View style={styles.soulScenarioSummary}>
                          <Text style={styles.soulScenarioSummaryTitle}>{selectedScenario.summary}</Text>
                          {selectedScenario.successCriteria.map(criterion => (
                            <Text key={criterion} style={styles.soulScenarioCriterion}>• {criterion}</Text>
                          ))}
                        </View>
                        {editingSpirit ? (
                          <Text accessibilityRole="alert" style={styles.soulLabFinePrint}>
                            Save and assign this draft before testing it. Chat evaluates the persisted assigned Soul.
                          </Text>
                        ) : !onOpenInChat ? (
                          <Text style={styles.soulLabFinePrint}>Chat handoff is unavailable for this agent.</Text>
                        ) : null}
                        <Pressable
                          testID="agent-soul-test-chat"
                          accessibilityRole="button"
                          accessibilityLabel="Test assigned Soul in Chat"
                          accessibilityHint="Prefills a no-action evaluation and does not send or run it"
                          accessibilityState={{ disabled: soulTestDisabled }}
                          disabled={soulTestDisabled}
                          onPress={() => {
                            const draft = buildSoulEvaluationDraft(selectedSoulTestScenario);
                            if (draft) onOpenInChat?.(draft);
                          }}
                          style={({ pressed }) => [
                            styles.soulTestButton,
                            soulTestDisabled && styles.soulDisabled,
                            pressed && !soulTestDisabled && styles.soulPressed,
                            Platform.OS === 'web' && ({ cursor: soulTestDisabled ? 'default' : 'pointer' } as any),
                          ]}
                        >
                          <Text style={styles.soulTestButtonText}>PREFILL TEST IN CHAT</Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : null}
                </View>

                {currentOperationsProfile && (
                  <View style={styles.opsSection}>
                    <Text style={styles.opsTitle}>COMPANY OPERATIONS</Text>
                    <Text style={styles.opsFunction}>{currentOperationsProfile.companyFunction}</Text>
                    <Text style={styles.opsMission}>{currentOperationsProfile.mission}</Text>

                    <View style={styles.roleChipRow}>
                      {currentOperationsProfile.tags.slice(0, 5).map(tag => (
                        <View key={tag} style={styles.opsChip}>
                          <Text style={styles.opsChipText}>{tag}</Text>
                        </View>
                      ))}
                    </View>

                    <View style={styles.opsAccessCard}>
                      <Text style={styles.opsSubheading}>WORDPRESS / CMS ACCESS</Text>
                      <Text accessibilityLiveRegion="polite" style={[
                        styles.opsAccessStatus,
                        wordpressRead.status === 'error' ? styles.opsAccessStatusBlocked : null,
                        wordpressRead.status === 'ready' && wordpressRead.value.connected ? styles.opsAccessStatusReady : null,
                      ]}>
                        {wordpressRead.status === 'loading'
                          ? 'Checking connection…'
                          : wordpressRead.status === 'error'
                            ? 'Connection status unavailable'
                            : wordpressRead.status === 'ready' && wordpressRead.value.connected
                              ? 'Connected'
                              : wordpressRead.status === 'ready'
                                ? 'Not connected'
                                : 'Waiting for verification'}
                      </Text>
                      {wordpressRead.status === 'ready' ? (
                        <Text style={styles.opsAccessDetail}>
                          {wordpressRead.value.connected
                            ? `${wordpressRead.value.siteUrl || wordpressRead.value.label || 'WordPress'}${wordpressRead.value.username ? ` • ${wordpressRead.value.username}` : ''}`
                            : 'No active WordPress credential was found in the verified circle or user credential stores.'}
                        </Text>
                      ) : wordpressRead.status === 'error' ? (
                        <View accessibilityRole="alert" style={{ gap: 8 }}>
                          <Text style={styles.opsAccessDetail}>{wordpressRead.error}</Text>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Retry WordPress connection status"
                            onPress={() => setWordpressReloadGeneration(generation => generation + 1)}
                            style={[{ alignSelf: 'flex-start', minHeight: 44, paddingHorizontal: 12, borderWidth: 1, borderColor: '#ef444455', borderRadius: 6, justifyContent: 'center' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                          >
                            <Text style={{ color: '#fca5a5', fontSize: 11, fontWeight: '800', fontFamily: 'monospace' }}>RETRY</Text>
                          </Pressable>
                        </View>
                      ) : (
                        <Text style={styles.opsAccessDetail}>Verifying exact circle and user credential stores.</Text>
                      )}
                    </View>

                    {integrationRead.status !== 'idle' ? (
                      <View style={styles.opsAccessCard}>
                        <Text style={styles.opsSubheading}>INTEGRATION READINESS</Text>
                        <Text style={[
                          styles.opsAccessStatus,
                          integrationRead.status === 'error' ? styles.opsAccessStatusBlocked : null,
                          ownershipReadiness?.level === 'full' ? styles.opsAccessStatusReady : null,
                          ownershipReadiness?.level === 'assisted' ? styles.opsAccessStatusAssist : null,
                          ownershipReadiness?.level === 'blocked' ? styles.opsAccessStatusBlocked : null,
                        ]}>
                          {integrationRead.status === 'loading'
                            ? 'Checking required systems…'
                            : integrationRead.status === 'error'
                              ? 'Readiness status unavailable'
                              : ownershipReadiness?.headline || (integrationReadiness?.ok ? 'Ready for ownership' : 'Missing required systems')}
                        </Text>
                        {integrationRead.status === 'error' ? (
                          <View accessibilityRole="alert" style={{ gap: 8 }}>
                            <Text style={styles.opsAccessDetail}>{integrationRead.error}</Text>
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel="Retry integration readiness"
                              onPress={() => setIntegrationReloadGeneration(generation => generation + 1)}
                              style={[{ alignSelf: 'flex-start', minHeight: 44, paddingHorizontal: 12, borderWidth: 1, borderColor: '#ef444455', borderRadius: 6, justifyContent: 'center' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                            >
                              <Text style={{ color: '#fca5a5', fontSize: 11, fontWeight: '800', fontFamily: 'monospace' }}>RETRY</Text>
                            </Pressable>
                          </View>
                        ) : integrationRead.status === 'loading' ? (
                          <Text style={styles.opsAccessDetail}>Verifying the circle integration registry with captured Office authority.</Text>
                        ) : ownershipReadiness ? (
                          <Text style={styles.opsAccessDetail}>{ownershipReadiness.detail}</Text>
                        ) : null}
                        {spiritIntegrationRequirements.requiredConnectors.length > 0 ? (
                          <Text style={styles.opsAccessDetail}>
                            Required connectors: {spiritIntegrationRequirements.requiredConnectors.join(', ')}
                          </Text>
                        ) : null}
                        {spiritIntegrationRequirements.requiredCapabilities.length > 0 ? (
                          <Text style={styles.opsAccessDetail}>
                            Required capabilities: {spiritIntegrationRequirements.requiredCapabilities.join(', ')}
                          </Text>
                        ) : null}
                        {integrationReadiness && integrationReadiness.missingConnectors.length > 0 ? (
                          <Text style={styles.opsAccessDetail}>
                            Missing connectors: {integrationReadiness.missingConnectors.join(', ')}
                          </Text>
                        ) : null}
                        {integrationReadiness && integrationReadiness.missingCapabilities.length > 0 ? (
                          <Text style={styles.opsAccessDetail}>
                            Missing capabilities: {integrationReadiness.missingCapabilities.join(', ')}
                          </Text>
                        ) : null}
                        {integrationReadiness?.ok ? (
                          <Text style={styles.opsAccessDetail}>
                            This Soul has the circle integrations it needs to take fuller ownership of its operating domain.
                          </Text>
                        ) : null}
                      </View>
                    ) : null}

                    <View style={styles.opsGrid}>
                      <View style={styles.opsListCard}>
                        <Text style={styles.opsSubheading}>WORKFLOWS</Text>
                        {currentOperationsProfile.workflows.map(item => (
                          <Text key={item} style={styles.opsListItem}>- {item}</Text>
                        ))}
                      </View>

                      <View style={styles.opsListCard}>
                        <Text style={styles.opsSubheading}>OWNED OUTCOMES</Text>
                        {currentOperationsProfile.ownedOutcomes.map(item => (
                          <Text key={item} style={styles.opsListItem}>- {item}</Text>
                        ))}
                      </View>

                      <View style={styles.opsListCard}>
                        <Text style={styles.opsSubheading}>REQUIRED ACCESS</Text>
                        {currentOperationsProfile.requiredAccess.map(item => (
                          <Text key={item} style={styles.opsListItem}>- {item}</Text>
                        ))}
                      </View>

                      <View style={styles.opsListCard}>
                        <Text style={styles.opsSubheading}>TOOLING</Text>
                        {currentOperationsProfile.tooling.map(item => (
                          <Text key={item} style={styles.opsListItem}>- {item}</Text>
                        ))}
                      </View>
                    </View>

                    <View style={styles.roleActionRow}>
                      <Pressable accessibilityRole="button" accessibilityLabel="Draft an operations plan in this Spirit" onPress={() => handleGenerateOpsArtifact('ops_plan')} style={[styles.opsActionBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                        <Text style={styles.opsActionBtnText}>OPS PLAN</Text>
                      </Pressable>
                      <Pressable accessibilityRole="button" accessibilityLabel="Draft an access checklist in this Spirit" onPress={() => handleGenerateOpsArtifact('access_checklist')} style={[styles.opsActionBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                        <Text style={styles.opsActionBtnText}>ACCESS</Text>
                      </Pressable>
                      <Pressable accessibilityRole="button" accessibilityLabel="Draft a standard operating procedure in this Spirit" onPress={() => handleGenerateOpsArtifact('sop')} style={[styles.opsActionBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                        <Text style={styles.opsActionBtnText}>SOP</Text>
                      </Pressable>
                    </View>

                    {opsArtifact ? (
                      <View style={styles.roleArtifactCard}>
                        <Text style={styles.roleArtifactTitle}>{opsArtifact.title}</Text>
                        <View>
                          <Text selectable style={styles.roleArtifactContent}>{opsArtifact.content}</Text>
                        </View>
                        <View style={styles.roleArtifactActionRow}>
                          <Pressable accessibilityRole="button" accessibilityLabel="Continue in Chat with this operations artifact" onPress={handleSaveOpsArtifact} style={[styles.opsSaveBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                            <Text style={styles.opsSaveBtnText}>CONTINUE IN CHAT</Text>
                          </Pressable>
                          <Pressable accessibilityRole="button" accessibilityLabel="Dismiss operations artifact" onPress={() => setOpsArtifact(null)} style={[styles.roleDismissBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                            <Text style={styles.roleDismissBtnText}>DISMISS</Text>
                          </Pressable>
                        </View>
                      </View>
                    ) : null}

                    {opsActionStatus ? (
                      <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.opsStatus}>{opsActionStatus}</Text>
                    ) : null}
                  </View>
                )}

                {editingSpirit && (
                  <View style={{ marginTop: 12 }}>
                    {showSaveForm ? (
                      <View style={{ gap: 8 }}>
                        <TextInput accessibilityLabel="Custom Spirit profile name" value={saveProfileName} onChangeText={setSaveProfileName} placeholder="Profile name..." placeholderTextColor="#555"
                          style={{ backgroundColor: '#000', borderWidth: 1, borderColor: '#1e1e3a', borderRadius: 8, padding: 10, color: '#eee', fontFamily: 'monospace', fontSize: 13 }} />
                        <View style={{ flexDirection: 'row', gap: 8 }}>
                          <Pressable
                            onPress={async () => {
                              if (savingProfileRef.current) return;
                              const requestedProfileName = saveProfileName.trim();
                              if (
                                !requestedProfileName
                                || requestedProfileName.length > 200
                                || /[\u0000-\u001f\u007f]/u.test(requestedProfileName)
                              ) {
                                setProfileActionStatus('ERROR: Enter a valid profile name before saving.');
                                return;
                              }
                              const authority = exactIdentityAuthority;
                              const capturedRequestKey = identityRequestKey;
                              if (!authority || !capturedRequestKey) return;
                              savingProfileRef.current = true;
                              const savingToken = savingProfileTokenRef.current + 1;
                              savingProfileTokenRef.current = savingToken;
                              setSavingProfile(true);
                              setProfileActionStatus('');
                              try {
                                const expectedProfileReceipt = {
                                  user_id: authority.userId, name: requestedProfileName,
                                  system_prompt: customPrompt, skill_bundle: customKnobs.skillBundle,
                                  risk_tier: customKnobs.riskTier, action_posture: customKnobs.actionPosture,
                                  evidence_posture: customKnobs.evidencePosture, communication_density: customKnobs.communicationDensity,
                                  skepticism: customKnobs.skepticism, escalation_trigger: customKnobs.escalationTrigger,
                                  emoji: selectedSpirit.emoji || '🤖', color: selectedSpirit.color || '#6366f1',
                                  tagline: `Custom ${s.name} profile`,
                                };
                                const exactClient = getSupabaseClientForAccessToken(authority.accessToken);
                                const { data: insertedProfiles, error } = await exactClient.from('custom_agent_profiles')
                                  .insert(expectedProfileReceipt)
                                  .select('id, user_id, name, emoji, color, tagline, system_prompt, skill_bundle, risk_tier, action_posture, evidence_posture, communication_density, skepticism, escalation_trigger');
                                if (!isIdentityRequestCurrent(capturedRequestKey)) return;
                                if (error) {
                                  const errorCode = customProfileInsertErrorCode(error);
                                  if (errorCode === '23505') {
                                    setProfileActionStatus('WARNING: That profile name is already in use. Choose a new name; the existing profile was not changed.');
                                  } else {
                                    console.warn('[AgentSpiritPanel] Custom profile insert failed.', { code: errorCode || 'unknown' });
                                    setProfileActionStatus('ERROR: Custom profile was not saved. Check the connection and try again.');
                                  }
                                  return;
                                }
                                if (!Array.isArray(insertedProfiles) || insertedProfiles.length !== 1) {
                                  setProfileActionStatus('WARNING: Custom profile creation could not be verified. No profile was adopted; refresh profiles before retrying.');
                                  return;
                                }
                                const data = insertedProfiles[0];
                                const returnedProfileId = String(data?.id || '');
                                const returnedProfile = data as Record<string, unknown> | null;
                                const receiptMatchesRequestedProfile = returnedProfile !== null
                                  && Object.entries(expectedProfileReceipt).every(([field, requestedValue]) => (
                                    returnedProfile[field] === requestedValue
                                  ));
                                if (
                                  !data
                                  || !isUuidLike(returnedProfileId)
                                  || returnedProfileId !== returnedProfileId.toLowerCase()
                                  || String(data.user_id || '') !== authority.userId
                                  || String(data.name || '') !== requestedProfileName
                                  || !receiptMatchesRequestedProfile
                                ) {
                                  setProfileActionStatus('WARNING: Custom profile outcome could not be verified. No profile was adopted; refresh profiles before retrying.');
                                  return;
                                }
                                setCustomProfiles(prev => [...prev.filter(p => p.id !== data.id), data]);
                                setShowSaveForm(false);
                                setSaveProfileName('');
                                setProfileActionStatus('Custom profile saved.');
                              } catch {
                                console.warn('[AgentSpiritPanel] Custom profile insert failed unexpectedly.');
                                if (isIdentityRequestCurrent(capturedRequestKey)) {
                                  setProfileActionStatus('ERROR: Custom profile was not saved. Check the connection and try again.');
                                }
                              } finally {
                                if (savingProfileTokenRef.current === savingToken) {
                                  savingProfileRef.current = false;
                                  if (isIdentityRequestCurrent(capturedRequestKey)) setSavingProfile(false);
                                }
                              }
                            }}
                            disabled={savingProfile}
                            accessibilityRole="button"
                            accessibilityLabel="Save custom Spirit profile"
                            accessibilityState={{ disabled: savingProfile, busy: savingProfile }}
                            style={[{ flex: 1, minHeight: 44, paddingVertical: 10, borderRadius: 8, backgroundColor: '#22c55e15', borderWidth: 1, borderColor: '#22c55e40', alignItems: 'center', justifyContent: 'center' }, Platform.OS === 'web' && { cursor: savingProfile ? 'default' : 'pointer' } as any]}>
                            <Text style={{ color: '#22c55e', fontSize: 12, fontFamily: 'monospace', fontWeight: '800' }}>{savingProfile ? '...' : 'SAVE PROFILE'}</Text>
                          </Pressable>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Cancel saving custom Spirit profile"
                            accessibilityState={{ disabled: savingProfile }}
                            disabled={savingProfile}
                            onPress={() => setShowSaveForm(false)}
                            style={[{ minHeight: 44, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8, backgroundColor: '#ffffff08', borderWidth: 1, borderColor: '#ffffff15', justifyContent: 'center' }, savingProfile && { opacity: 0.45 }, Platform.OS === 'web' && { cursor: savingProfile ? 'default' : 'pointer' } as any]}>
                            <Text style={{ color: '#888', fontSize: 12, fontFamily: 'monospace', fontWeight: '700' }}>Cancel</Text>
                          </Pressable>
                        </View>
                      </View>
                    ) : (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Save ${s.name} settings as a custom Spirit profile`}
                        onPress={() => { setSaveProfileName(s.name + ' (Custom)'); setShowSaveForm(true); }}
                        style={[{ minHeight: 44, paddingVertical: 10, borderRadius: 8, backgroundColor: '#6366f115', borderWidth: 1, borderColor: '#6366f140', alignItems: 'center', justifyContent: 'center' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                      >
                        <Text style={{ color: '#6366f1', fontSize: 12, fontFamily: 'monospace', fontWeight: '800', letterSpacing: 0.5 }}>SAVE AS CUSTOM PROFILE</Text>
                      </Pressable>
                    )}
                  </View>
                )}
              </View>
            );
          })()}

          {(customProfiles.length > 0 || Boolean(profileActionStatus)) && (
            <View style={{ marginBottom: 10 }}>
              <Text style={[styles.spiritCatLabel, { color: '#22c55e' }]}>Your Custom Profiles</Text>
              {customProfiles.length > 0 ? (
                <View style={styles.spiritGrid}>
                  {customProfiles.map(profile => {
                    const active = currentSpirit === `custom::${profile.id}`;
                    const deleting = deletingProfileId === String(profile.id);
                    return (
                      <View key={profile.id} style={[styles.spiritCard, active && { borderColor: (profile.color || '#22c55e') + '60', backgroundColor: (profile.color || '#22c55e') + '10' }]}>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Use custom profile ${String(profile.name || 'Untitled profile')}`}
                          accessibilityState={{ selected: active, disabled: deletingProfileId !== null || spiritAssignmentBusy, busy: spiritAssignmentBusy }}
                          disabled={deletingProfileId !== null || spiritAssignmentBusy}
                          onPress={async () => {
                            const authority = exactIdentityAuthority;
                            const capturedRequestKey = identityRequestKey;
                            if (!authority || !capturedRequestKey) return;
                            const saved = await persistSpiritSelection(`custom::${profile.id}`, profile.emoji || null, {
                              spiritId: `custom::${profile.id}`,
                              spiritEmoji: profile.emoji || null,
                              customProfileId: profile.id,
                              customProfileName: profile.name,
                              isCustomized: true,
                            });
                            if (!saved || !isIdentityRequestCurrent(capturedRequestKey)) return;
                            onAgentIdentityChange?.();
                            setCurrentSpirit(`custom::${profile.id}`);
                          }}
                          style={[styles.customProfileSelect, (deletingProfileId !== null || spiritAssignmentBusy) && { opacity: 0.45 }, Platform.OS === 'web' && { cursor: deletingProfileId === null && !spiritAssignmentBusy ? 'pointer' : 'default' } as any]}
                        >
                          <View style={{ alignItems: 'center', marginBottom: 10 }}>
                            <Text style={{ fontSize: 28 }}>{profile.emoji || '🤖'}</Text>
                          </View>
                          <Text style={[styles.spiritName, active && { color: profile.color || '#22c55e' }]} numberOfLines={1}>{profile.name}</Text>
                          <Text style={styles.spiritTagline} numberOfLines={1}>{profile.tagline || 'Custom profile'}</Text>
                        </Pressable>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Delete custom profile ${String(profile.name || 'Untitled profile')}`}
                          accessibilityState={{ disabled: deletingProfileId !== null || spiritAssignmentBusy, busy: deleting }}
                          disabled={deletingProfileId !== null || spiritAssignmentBusy}
                          onPress={() => requestDeleteCustomProfile(profile)}
                          style={[styles.customProfileDeleteBtn, (spiritAssignmentBusy || (deletingProfileId !== null && !deleting)) && { opacity: 0.45 }, Platform.OS === 'web' && { cursor: deletingProfileId === null && !spiritAssignmentBusy ? 'pointer' : 'default' } as any]}
                        >
                          <Text style={styles.customProfileDeleteText}>{deleting ? 'DELETING…' : 'DELETE PROFILE'}</Text>
                        </Pressable>
                      </View>
                    );
                  })}
                </View>
              ) : null}
              {profileActionStatus ? (
                <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ color: profileActionStatus.startsWith('ERROR') || profileActionStatus.startsWith('WARNING') ? '#fca5a5' : '#22c55e', fontSize: 11, fontFamily: 'monospace', lineHeight: 16, marginTop: 8 }}>
                  {profileActionStatus}
                </Text>
              ) : null}
            </View>
          )}

          <View testID="agent-soul-library" style={styles.soulLibraryToolbar}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${showSoulLibrary ? 'Hide' : 'Browse'} Soul library`}
              accessibilityState={{ expanded: showSoulLibrary }}
              onPress={() => setShowSoulLibrary(value => !value)}
              style={({ pressed }) => [
                styles.soulLibraryHeadingRow,
                pressed && styles.soulPressed,
                Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text accessibilityRole="header" style={styles.soulLibraryTitle}>
                  {showSoulLibrary ? '▼' : '▶'} SOUL LIBRARY
                </Text>
                <Text style={styles.soulLibrarySubtitle}>Browse {AGENT_SPIRITS.length} built-in specialties</Text>
              </View>
              <Text accessibilityLiveRegion="polite" style={styles.soulLibraryCount}>
                {showSoulLibrary ? `${filteredSpirits.length} shown` : 'BROWSE'}
              </Text>
            </Pressable>
            {showSoulLibrary ? (
              <>
                <View style={styles.soulSearchRow}>
                  <TextInput
                    testID="agent-soul-search"
                    accessibilityLabel="Search Souls"
                    value={spiritSearch}
                    onChangeText={setSpiritSearch}
                    placeholder="Search role, specialty, or skill"
                    placeholderTextColor="#596273"
                    returnKeyType="search"
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={styles.soulSearchInput}
                  />
                  {spiritSearch ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Clear Soul search"
                      onPress={() => setSpiritSearch('')}
                      style={({ pressed }) => [
                        styles.soulSearchClear,
                        pressed && styles.soulPressed,
                        Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
                      ]}
                    >
                      <Text style={styles.soulSearchClearText}>CLEAR</Text>
                    </Pressable>
                  ) : null}
                </View>
                <View style={styles.soulCategoryRow}>
                  {([{ key: 'all', label: 'All' }, ...SPIRIT_CATEGORIES] as const).map(category => {
                    const selected = spiritCategory === category.key;
                    return (
                      <Pressable
                        key={category.key}
                        accessibilityRole="button"
                        accessibilityLabel={`Show ${category.label} Souls`}
                        accessibilityState={{ selected }}
                        onPress={() => setSpiritCategory(category.key)}
                        style={({ pressed }) => [
                          styles.soulCategoryChip,
                          selected && styles.soulCategoryChipSelected,
                          pressed && styles.soulPressed,
                          Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
                        ]}
                      >
                        <Text style={[styles.soulCategoryText, selected && styles.soulCategoryTextSelected]}>
                          {category.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            ) : null}
          </View>

          {showSoulLibrary ? SPIRIT_CATEGORIES
            .filter(cat => spiritCategory === 'all' || cat.key === spiritCategory)
            .map(cat => {
              const categorySpirits = filteredSpirits.filter(spirit => spirit.category === cat.key);
              if (categorySpirits.length === 0) return null;
              return (
                <View key={cat.key}>
                  <Text style={[styles.spiritCatLabel, { color: cat.color }]}>{cat.label}</Text>
                  <View style={styles.spiritGrid}>
                    {categorySpirits.map(spirit => {
                      const active = currentSpirit === spirit.id;
                      return (
                        <Pressable
                          key={spirit.id}
                          disabled={spiritAssignmentBusy}
                          accessibilityRole="button"
                          accessibilityLabel={`Assign ${spirit.name} Spirit`}
                          accessibilityState={{ selected: active, disabled: spiritAssignmentBusy, busy: spiritAssignmentBusy }}
                          onPress={async () => {
                            const authority = exactIdentityAuthority;
                            const capturedRequestKey = identityRequestKey;
                            if (!authority || !capturedRequestKey) return;
                            const saved = await persistSpiritSelection(spirit.id, spirit.emoji, {
                              spiritId: spirit.id,
                              spiritEmoji: spirit.emoji,
                              customProfileId: null,
                              customProfileName: null,
                              isCustomized: true,
                            });
                            if (!saved || !isIdentityRequestCurrent(capturedRequestKey)) return;
                            onAgentIdentityChange?.();
                            setCurrentSpirit(spirit.id);
                          }}
                          style={[
                            styles.spiritCard,
                            active && { borderColor: spirit.color + '60', backgroundColor: spirit.color + '10' },
                            spiritAssignmentBusy && { opacity: 0.45 },
                            Platform.OS === 'web' && { cursor: spiritAssignmentBusy ? 'default' : 'pointer' } as any,
                          ]}
                        >
                          <View style={{ alignItems: 'center', marginBottom: 10 }}>
                            {ICON_CATALOG[spirit.id] ? (
                              <FlatIcon name={spirit.id} size={32} glow={active} />
                            ) : (
                              <Text style={styles.spiritEmoji}>{spirit.emoji}</Text>
                            )}
                          </View>
                          <Text style={[styles.spiritName, active && { color: spirit.color }]} numberOfLines={2}>
                            {spirit.name}
                          </Text>
                          <Text style={styles.spiritTagline} numberOfLines={2}>{spirit.tagline}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              );
            }) : null}
          {showSoulLibrary && filteredSpirits.length === 0 ? (
            <View accessibilityLiveRegion="polite" style={styles.soulEmpty}>
              <Text style={styles.soulEmptyTitle}>No Souls found</Text>
              <Text style={styles.soulEmptyText}>Try a broader search or choose another category.</Text>
            </View>
          ) : null}

          {circleId && (
            <View style={styles.soulInlineSection}>
              <Text style={[styles.spiritCatLabel, { color: '#a855f7' }]}>Personality</Text>
              <Text style={styles.spiritHint}>
                Optional: fine-tune communication style. Prepended to every LLM call alongside the spirit.
              </Text>

              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 4 }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Scroll personality choices left"
                  onPress={() => personalityScrollRef.current?.scrollTo({ x: Math.max(0, (personalityScrollX.current || 0) - 200), animated: true })}
                  style={[styles.scrollArrow, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                >
                  <Text style={styles.scrollArrowText}>‹</Text>
                </Pressable>
                <ScrollView
                  ref={personalityScrollRef}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={{ flex: 1 }}
                  onScroll={(e) => { personalityScrollX.current = e.nativeEvent.contentOffset.x; }}
                  scrollEventThrottle={16}
                >
                  {getTemplatesByCategory('personality').map(tmpl => {
                    const isActive = detectTemplate(soulText)?.id === tmpl.id;
                    return (
                      <Pressable
                        key={tmpl.id}
                        accessibilityRole="button"
                        accessibilityLabel={`Use ${tmpl.name} personality`}
                        accessibilityState={{ selected: isActive }}
                        onPress={() => setSoulText(tmpl.soulText)}
                        style={[
                          styles.personalityChip,
                          isActive && { borderColor: '#6366f1', backgroundColor: '#6366f115' },
                          Platform.OS === 'web' && { cursor: 'pointer' } as any,
                        ]}
                      >
                        <Text style={styles.personalityChipText}>
                          {tmpl.emoji} {tmpl.name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Scroll personality choices right"
                  onPress={() => personalityScrollRef.current?.scrollTo({ x: (personalityScrollX.current || 0) + 200, animated: true })}
                  style={[styles.scrollArrow, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                >
                  <Text style={styles.scrollArrowText}>›</Text>
                </Pressable>
              </View>

              <TextInput
                accessibilityLabel="Custom agent personality instructions"
                style={styles.soulInput}
                value={soulText}
                onChangeText={setSoulText}
                placeholder="Pick a personality or write custom SOUL..."
                placeholderTextColor="#444"
                multiline
                numberOfLines={3}
              />

              <View style={styles.soulActions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Save agent personality instructions"
                  accessibilityState={{ disabled: soulSaving, busy: soulSaving }}
                  onPress={handleSaveSoul}
                  disabled={soulSaving}
                  style={[styles.soulSaveBtn, soulSaving && { opacity: 0.4 }]}
                >
                  <Text style={styles.soulSaveBtnText}>{soulSaving ? 'SAVING...' : 'SAVE SOUL'}</Text>
                </Pressable>
                {soulText.trim() ? (
                  <Pressable accessibilityRole="button" accessibilityLabel="Clear agent personality instructions" onPress={() => setSoulText('')} style={styles.soulClearBtn}>
                    <Text style={styles.soulClearBtnText}>CLEAR</Text>
                  </Pressable>
                ) : null}
                {soulStatus ? (
                  <Text
                    accessibilityRole={soulStatus.startsWith('ERROR') ? 'alert' : undefined}
                    accessibilityLiveRegion={soulStatus.startsWith('ERROR') ? 'assertive' : 'polite'}
                    style={{ fontSize: 11, color: soulStatus.startsWith('ERROR') ? '#ef4444' : '#22c55e', fontFamily: 'monospace' }}
                  >
                    {soulStatus}
                  </Text>
                ) : null}
              </View>
            </View>
          )}
        </View>
      )}

      <View
        accessibilityRole={executionTruth.state === 'warning' ? 'alert' : undefined}
        accessibilityLiveRegion="polite"
        style={styles.activityBar}
      >
        <Text style={styles.activityLabel}>{executionTruth.state === 'active' ? 'NOW:' : 'STATUS:'}</Text>
        <Text style={styles.activityValue}>{activityCopy}</Text>
      </View>

      {onAddSessionTag && onRemoveSessionTag && sessionKey && (
        <View style={styles.tagsSection}>
          <Text style={styles.tagsSectionTitle}>SESSION TAGS</Text>
          <SessionTagInput
            sessionKey={sessionKey}
            currentTags={currentTags}
            onAddTag={(tag) => onAddSessionTag(sessionKey, tag)}
            onRemoveTag={(tagKey) => onRemoveSessionTag(sessionKey, tagKey)}
            storageScope={sessionStorageScope}
          />
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  activityBar: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: '#111',
    padding: 14,
    borderRadius: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#1e1e3a',
  },
  activityLabel: {
    fontSize: 12,
    color: '#666',
    fontFamily: 'monospace',
    fontWeight: '800',
  },
  activityValue: {
    fontSize: 13,
    color: '#ccc',
    fontFamily: 'monospace',
    flex: 1,
  },
  tagsSection: {
    gap: 8,
    marginVertical: 16,
    paddingVertical: 14,
  },
  tagsSectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#888',
    fontFamily: 'monospace',
    letterSpacing: 2,
  },
  spiritRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    minHeight: 44, paddingHorizontal: 8, paddingVertical: 10,
  },
  spiritLabel: {
    color: '#aaa', fontSize: 13, fontWeight: '800', fontFamily: 'monospace', letterSpacing: 1.5,
  },
  spiritBadge: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
    borderWidth: 1, borderColor: '#6366f140', backgroundColor: '#6366f115',
  },
  spiritBadgeText: {
    color: '#6366f1', fontSize: 14, fontWeight: '700', fontFamily: 'monospace',
  },
  spiritNone: {
    color: '#555', fontSize: 14, fontFamily: 'monospace',
  },
  spiritPicker: {
    padding: 12, gap: 10,
  },
  spiritHint: {
    color: '#666', fontSize: 12, fontFamily: 'monospace', lineHeight: 18,
  },
  spiritDetail: {
    backgroundColor: '#08081a',
    borderWidth: 1,
    borderColor: '#1e1e3a',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  spiritDetailName: {
    color: '#fff', fontSize: 15, fontWeight: '800', fontFamily: 'monospace',
  },
  spiritDetailTagline: {
    color: '#888', fontSize: 14, fontFamily: 'monospace', marginTop: 2,
  },
  spiritKnobsGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
  },
  spiritKnob: {
    width: '30%' as any, backgroundColor: '#0a0a1a', borderRadius: 8,
    borderWidth: 1, borderColor: '#1e1e3a', padding: 12, alignItems: 'center',
  },
  spiritKnobLabel: {
    color: '#555', fontSize: 11, fontWeight: '800', fontFamily: 'monospace',
    letterSpacing: 1, marginBottom: 8,
  },
  spiritKnobValue: {
    fontSize: 14, fontWeight: '800', fontFamily: 'monospace', textAlign: 'center',
  },
  spiritEscalation: {
    marginTop: 10, backgroundColor: '#0a0a1a', borderRadius: 8,
    borderWidth: 1, borderColor: '#1e1e3a', padding: 10,
  },
  spiritEscalationText: {
    color: '#ccc', fontSize: 12, fontFamily: 'monospace', marginTop: 4, lineHeight: 18,
  },
  soulLab: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#293351',
    borderRadius: 12,
    backgroundColor: '#0a0f1f',
    overflow: 'hidden',
  },
  soulLabHeader: {
    minHeight: 58,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  soulLabTitle: {
    color: '#c7d2fe',
    fontSize: 12,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 1.2,
  },
  soulLabSubtitle: {
    color: '#7c879d',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 2,
  },
  soulLabCount: {
    color: '#a5b4fc',
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  soulLabBody: {
    padding: 12,
    paddingTop: 2,
    gap: 12,
  },
  soulLabNotice: {
    color: '#cbd5e1',
    fontSize: 11,
    lineHeight: 17,
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#273449',
  },
  soulContractGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  soulContractRow: {
    flexBasis: 220,
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#090d18',
    borderWidth: 1,
    borderColor: '#202a40',
  },
  soulContractLabel: {
    color: '#718096',
    fontSize: 9,
    lineHeight: 13,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 0.8,
  },
  soulContractValue: {
    color: '#dbe4f0',
    fontSize: 11,
    lineHeight: 17,
    marginTop: 4,
  },
  soulPromptFootprint: {
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#090d18',
    borderWidth: 1,
    borderColor: '#202a40',
  },
  soulLabFinePrint: {
    color: '#8490a5',
    fontSize: 10,
    lineHeight: 16,
    marginTop: 4,
  },
  soulCheckRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  soulCheckChip: {
    minHeight: 28,
    justifyContent: 'center',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#4b5563',
    backgroundColor: '#161b25',
  },
  soulCheckChipReady: {
    borderColor: '#256d50',
    backgroundColor: '#0d241b',
  },
  soulCheckText: {
    color: '#9ca3af',
    fontSize: 9,
    lineHeight: 12,
    fontWeight: '800',
    fontFamily: 'monospace',
  },
  soulCheckTextReady: {
    color: '#6ee7b7',
  },
  soulLabSectionTitle: {
    color: '#c7d2fe',
    fontSize: 11,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 1,
  },
  soulScenarioRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  soulScenarioChip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#263047',
    backgroundColor: '#0b1120',
  },
  soulScenarioChipSelected: {
    borderColor: '#6366f1',
    backgroundColor: '#292d65',
  },
  soulScenarioText: {
    color: '#8994a7',
    fontSize: 10,
    fontWeight: '700',
  },
  soulScenarioTextSelected: {
    color: '#eef2ff',
  },
  soulScenarioSummary: {
    marginTop: 8,
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#080c16',
  },
  soulScenarioSummaryTitle: {
    color: '#dbe4f0',
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 16,
    marginBottom: 5,
  },
  soulScenarioCriterion: {
    color: '#8e9aaf',
    fontSize: 10,
    lineHeight: 16,
  },
  soulTestButton: {
    minHeight: 44,
    marginTop: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#4f46e5',
    borderWidth: 1,
    borderColor: '#818cf8',
  },
  soulTestButtonText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 0.8,
  },
  soulDisabled: {
    opacity: 0.4,
  },
  soulPressed: {
    opacity: 0.82,
  },
  spiritClearBtn: {
    minHeight: 44, justifyContent: 'center', paddingVertical: 6, paddingHorizontal: 14, borderRadius: 8,
    backgroundColor: '#ef444415', borderWidth: 1, borderColor: '#ef444430',
  },
  spiritClearText: {
    color: '#ef4444', fontSize: 14, fontWeight: '700', fontFamily: 'monospace',
  },
  spiritCatLabel: {
    fontSize: 12, fontWeight: '800', fontFamily: 'monospace', letterSpacing: 1.5,
    marginBottom: 10, marginTop: 8,
  },
  spiritGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 10,
  },
  spiritCard: {
    width: '48%', minHeight: 128, padding: 12, borderRadius: 10,
    borderWidth: 1, borderColor: '#1e1e3a', backgroundColor: '#0a0a0a',
    alignItems: 'center',
  },
  customProfileSelect: {
    width: '100%',
    minHeight: 88,
    alignItems: 'center',
    justifyContent: 'center',
  },
  customProfileDeleteBtn: {
    width: '100%',
    minHeight: 44,
    marginTop: 10,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ef444450',
    backgroundColor: '#ef444412',
    alignItems: 'center',
    justifyContent: 'center',
  },
  customProfileDeleteText: {
    color: '#ef4444',
    fontSize: 10,
    fontWeight: '800',
    fontFamily: 'monospace',
    textAlign: 'center',
  },
  soulLibraryToolbar: {
    marginTop: 6,
    marginBottom: 4,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#252c3d',
    backgroundColor: '#090c13',
    gap: 8,
  },
  soulLibraryHeadingRow: {
    minHeight: 24,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  soulLibraryTitle: {
    color: '#d9e0ec',
    fontSize: 11,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 1.2,
  },
  soulLibrarySubtitle: {
    color: '#7b8799',
    fontSize: 10,
    lineHeight: 15,
    marginTop: 2,
  },
  soulLibraryCount: {
    color: '#7b8799',
    fontSize: 10,
    fontFamily: 'monospace',
  },
  soulSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  soulSearchInput: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#30384a',
    backgroundColor: '#05070c',
    color: '#e5e7eb',
    fontSize: 12,
  },
  soulSearchClear: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#30384a',
  },
  soulSearchClearText: {
    color: '#aab3c2',
    fontSize: 9,
    fontWeight: '800',
    fontFamily: 'monospace',
  },
  soulCategoryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  soulCategoryChip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#293145',
    backgroundColor: '#0b0f17',
  },
  soulCategoryChipSelected: {
    borderColor: '#6366f1',
    backgroundColor: '#272b59',
  },
  soulCategoryText: {
    color: '#8d98aa',
    fontSize: 10,
    fontWeight: '700',
  },
  soulCategoryTextSelected: {
    color: '#eef2ff',
  },
  soulEmpty: {
    minHeight: 100,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    padding: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#252c3d',
    backgroundColor: '#090c13',
  },
  soulEmptyTitle: {
    color: '#d9e0ec',
    fontSize: 12,
    fontWeight: '800',
  },
  soulEmptyText: {
    color: '#7b8799',
    fontSize: 11,
    textAlign: 'center',
  },
  spiritEmoji: { fontSize: 28, marginBottom: 8 },
  spiritName: {
    color: '#6366f1', fontSize: 12, fontWeight: '800', fontFamily: 'monospace', textAlign: 'center',
  },
  spiritTagline: {
    color: '#666', fontSize: 13, fontFamily: 'monospace', lineHeight: 15, marginTop: 2, textAlign: 'center',
  },
  roleChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  roleActionRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  roleArtifactCard: {
    backgroundColor: '#020617',
    borderWidth: 1,
    borderColor: '#1e293b',
    borderRadius: 10,
    padding: 12,
    gap: 8,
  },
  roleArtifactTitle: {
    color: '#f8fafc',
    fontSize: 13,
    fontWeight: '800',
    fontFamily: 'monospace',
  },
  roleArtifactContent: {
    color: '#cbd5e1',
    fontSize: 12,
    lineHeight: 18,
    fontFamily: 'monospace',
  },
  roleArtifactActionRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  roleDismissBtn: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#374151',
  },
  roleDismissBtnText: {
    color: '#9ca3af',
    fontSize: 11,
    fontFamily: 'monospace',
    fontWeight: '700',
  },
  opsSection: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#1e1e3a',
    gap: 10,
  },
  opsTitle: {
    color: '#f59e0b',
    fontSize: 12,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 1.5,
  },
  opsFunction: {
    color: '#f8fafc',
    fontSize: 15,
    fontWeight: '800',
    fontFamily: 'monospace',
  },
  opsMission: {
    color: '#d6d3d1',
    fontSize: 12,
    lineHeight: 18,
    fontFamily: 'monospace',
  },
  opsChip: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#2b1605',
    borderWidth: 1,
    borderColor: '#5f3b11',
  },
  opsChipText: {
    color: '#fbbf24',
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  opsAccessCard: {
    backgroundColor: '#120d05',
    borderWidth: 1,
    borderColor: '#3f2b10',
    borderRadius: 10,
    padding: 12,
    gap: 4,
  },
  opsSubheading: {
    color: '#f59e0b',
    fontSize: 11,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 1,
    marginBottom: 2,
  },
  opsAccessStatus: {
    color: '#fde68a',
    fontSize: 12,
    fontWeight: '800',
    fontFamily: 'monospace',
  },
  opsAccessStatusReady: {
    color: '#22c55e',
  },
  opsAccessStatusAssist: {
    color: '#f59e0b',
  },
  opsAccessStatusBlocked: {
    color: '#ef4444',
  },
  opsAccessDetail: {
    color: '#cbd5e1',
    fontSize: 11,
    lineHeight: 16,
    fontFamily: 'monospace',
  },
  opsGrid: {
    gap: 8,
  },
  opsListCard: {
    backgroundColor: '#0b0b12',
    borderWidth: 1,
    borderColor: '#2b2b38',
    borderRadius: 10,
    padding: 12,
    gap: 5,
  },
  opsListItem: {
    color: '#d6d3d1',
    fontSize: 12,
    lineHeight: 18,
    fontFamily: 'monospace',
  },
  opsActionBtn: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#1c1205',
    borderWidth: 1,
    borderColor: '#6b3d12',
  },
  opsActionBtnText: {
    color: '#fbbf24',
    fontSize: 11,
    fontFamily: 'monospace',
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  opsSaveBtn: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#3f2b10',
    borderWidth: 1,
    borderColor: '#a16207',
  },
  opsSaveBtnText: {
    color: '#fde68a',
    fontSize: 11,
    fontFamily: 'monospace',
    fontWeight: '800',
    letterSpacing: 0.7,
  },
  opsStatus: {
    color: '#fcd34d',
    fontSize: 11,
    fontFamily: 'monospace',
  },
  soulInlineSection: {
    marginTop: 16, paddingTop: 14,
  },
  scrollArrow: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#ffffff08',
    borderWidth: 1,
    borderColor: '#ffffff15',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollArrowText: {
    color: '#aaa',
    fontSize: 20,
    fontWeight: '600',
    marginTop: -1,
  },
  personalityChip: {
    minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12,
    borderWidth: 1, borderColor: '#1e1e3a', backgroundColor: '#000000',
    marginRight: 8,
  },
  personalityChipText: {
    fontSize: 13, color: '#ccc', fontFamily: 'monospace', fontWeight: '600',
  },
  soulInput: {
    backgroundColor: '#000000', borderWidth: 1, borderColor: '#1e1e3a',
    borderRadius: 10, padding: 12, color: '#ddd', fontFamily: 'monospace',
    fontSize: 13, minHeight: 100, textAlignVertical: 'top',
  },
  soulActions: {
    flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 4,
  },
  soulSaveBtn: {
    minHeight: 44, justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8,
    backgroundColor: '#6366f120', borderWidth: 1, borderColor: '#6366f140',
  },
  soulSaveBtnText: {
    fontSize: 12, color: '#6366f1', fontFamily: 'monospace', fontWeight: '800', letterSpacing: 0.8,
  },
  soulClearBtn: {
    minHeight: 44, justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8,
    backgroundColor: '#ef444420', borderWidth: 1, borderColor: '#ef444440',
  },
  soulClearBtnText: {
    fontSize: 12, color: '#ef4444', fontFamily: 'monospace', fontWeight: '800',
  },
});
