import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import FlatIcon, { ICON_CATALOG } from '../../../../components/FlatIcon';
import SessionTagInput from '../../../../components/SessionTagInput';
import { OfficeAgent, resolveOfficeAgentExecutionTruth } from '../../../../lib/officeAgents';
import { SessionTag, type OfficeSessionStorageScope } from '../../../../lib/sessionTags';
import { getTemplatesByCategory, detectTemplate } from '../../../../lib/soulTemplates';
import { AGENT_SPIRITS, SPIRIT_CATEGORIES, getSpiritById, type AgentSpirit } from '../../../../lib/agentSpirits';
import {
  buildSpiritCareerArtifact,
  buildSpiritRoleReadinessChecklist,
  getSpiritCareerProfile,
} from '../../../../lib/spiritCareerProfiles';
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
  const [roleArtifact, setRoleArtifact] = useState<{ title: string; content: string } | null>(null);
  const [roleActionStatus, setRoleActionStatus] = useState('');
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
  const executionTruth = resolveOfficeAgentExecutionTruth(agent);
  const activityCopy = executionTruth.state === 'warning'
    ? `Runtime status warning: ${executionTruth.statusWarning}. Refresh the connection before assigning new work.`
    : executionTruth.state === 'active'
      ? executionTruth.activity || 'Agent is active; no current activity label was reported.'
      : executionTruth.state === 'connected'
        ? 'Agent is connected and standing by. No current execution is verified.'
        : 'Agent is offline or unavailable. Reconnect it before assigning new work.';
  const currentSpiritProfile = currentSpirit && !currentSpirit.startsWith('custom::')
    ? getSpiritCareerProfile(currentSpirit)
    : null;
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
  const roleChecklist = buildSpiritRoleReadinessChecklist(currentSpiritProfile?.spiritId || null);

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
    setSoulSaving(false);
    setSoulStatus('');
    setRoleArtifact(null);
    setRoleActionStatus('');
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
    setRoleArtifact(null);
    setRoleActionStatus('');
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

  const handleGenerateRoleArtifact = async (kind: 'resume' | 'interview' | 'portfolio' | 'drill' | 'work_sample') => {
    const artifact = buildSpiritCareerArtifact(kind, currentSpiritProfile?.spiritId || null);
    setRoleArtifact(artifact);
    setRoleActionStatus(artifact ? `${artifact.title} generated` : 'No role profile available');
    setTimeout(() => setRoleActionStatus(''), 2500);
  };

  const handleSaveRoleArtifact = async () => {
    const authority = exactIdentityAuthority;
    const capturedRequestKey = identityRequestKey;
    if (!circleId || !roleArtifact || !authority || !capturedRequestKey) return;
    if (!isIdentityRequestCurrent(capturedRequestKey)) return;
    if (!onOpenInChat) {
      setRoleActionStatus('Continue in Chat to save this artifact with the agent conversation and run lineage.');
      return;
    }
    onOpenInChat([
      'Review this role-readiness artifact and save it as durable Spirit memory only after returning an exact memory receipt.',
      '',
      roleArtifact.title,
      roleArtifact.content,
    ].join('\n').slice(0, 3_500));
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
            Assign a specialty that shapes how {agent.name} thinks, responds, and what it knows.
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
                        style={[{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 8, paddingVertical: 6, borderRadius: 4, borderWidth: 1, borderColor: value === opt ? (colors?.[opt] || '#6366f1') + '60' : '#1e1e3a', backgroundColor: value === opt ? (colors?.[opt] || '#6366f1') + '15' : 'transparent' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
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

                {currentSpiritProfile && (
                  <View style={styles.roleReadinessSection}>
                    <Text style={styles.roleReadinessTitle}>ROLE READINESS</Text>
                    <Text style={styles.roleReadinessRole}>{currentSpiritProfile.seniorRoleTitle}</Text>
                    <Text style={styles.roleReadinessSummary}>{currentSpiritProfile.marketSummary}</Text>

                    <View style={styles.roleChipRow}>
                      {currentSpiritProfile.tags.slice(0, 4).map(tag => (
                        <View key={tag} style={styles.roleChip}>
                          <Text style={styles.roleChipText}>{tag}</Text>
                        </View>
                      ))}
                    </View>

                    <View style={{ gap: 6 }}>
                      {roleChecklist.map(item => (
                        <Text key={item} style={styles.roleChecklistItem}>- {item}</Text>
                      ))}
                    </View>

                    <View style={{ marginTop: 10 }}>
                      <Text style={styles.roleSubheading}>SOURCE LINKS</Text>
                      {currentSpiritProfile.sourceUrls.slice(0, 3).map(url => (
                        <Text key={url} selectable style={styles.roleSourceLink}>{url}</Text>
                      ))}
                    </View>

                    <View style={styles.roleActionRow}>
                      <Pressable accessibilityRole="button" accessibilityLabel="Draft a resume artifact in this Spirit" onPress={() => handleGenerateRoleArtifact('resume')} style={[styles.roleActionBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                        <Text style={styles.roleActionBtnText}>RESUME</Text>
                      </Pressable>
                      <Pressable accessibilityRole="button" accessibilityLabel="Draft interview preparation in this Spirit" onPress={() => handleGenerateRoleArtifact('interview')} style={[styles.roleActionBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                        <Text style={styles.roleActionBtnText}>INTERVIEW</Text>
                      </Pressable>
                      <Pressable accessibilityRole="button" accessibilityLabel="Draft a portfolio artifact in this Spirit" onPress={() => handleGenerateRoleArtifact('portfolio')} style={[styles.roleActionBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                        <Text style={styles.roleActionBtnText}>PORTFOLIO</Text>
                      </Pressable>
                      <Pressable accessibilityRole="button" accessibilityLabel="Draft a practice drill in this Spirit" onPress={() => handleGenerateRoleArtifact('drill')} style={[styles.roleActionBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                        <Text style={styles.roleActionBtnText}>DRILL</Text>
                      </Pressable>
                      <Pressable accessibilityRole="button" accessibilityLabel="Draft a work sample in this Spirit" onPress={() => handleGenerateRoleArtifact('work_sample')} style={[styles.roleActionBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                        <Text style={styles.roleActionBtnText}>WORK SAMPLE</Text>
                      </Pressable>
                    </View>

                    {roleArtifact ? (
                      <View style={styles.roleArtifactCard}>
                        <Text style={styles.roleArtifactTitle}>{roleArtifact.title}</Text>
                        <View>
                          <Text selectable style={styles.roleArtifactContent}>{roleArtifact.content}</Text>
                        </View>
                        <View style={styles.roleArtifactActionRow}>
                          <Pressable accessibilityRole="button" accessibilityLabel="Continue in Chat with this role artifact" onPress={handleSaveRoleArtifact} style={[styles.roleSaveBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                            <Text style={styles.roleSaveBtnText}>CONTINUE IN CHAT</Text>
                          </Pressable>
                          <Pressable accessibilityRole="button" accessibilityLabel="Dismiss role artifact" onPress={() => setRoleArtifact(null)} style={[styles.roleDismissBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                            <Text style={styles.roleDismissBtnText}>DISMISS</Text>
                          </Pressable>
                        </View>
                      </View>
                    ) : null}

                    {roleActionStatus ? (
                      <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.roleStatus}>{roleActionStatus}</Text>
                    ) : null}
                  </View>
                )}

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
                            style={[{ alignSelf: 'flex-start', minHeight: 44, paddingHorizontal: 12, borderWidth: 1, borderColor: '#ef444455', borderRadius: 4, justifyContent: 'center' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
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
                              style={[{ alignSelf: 'flex-start', minHeight: 44, paddingHorizontal: 12, borderWidth: 1, borderColor: '#ef444455', borderRadius: 4, justifyContent: 'center' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
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

          {SPIRIT_CATEGORIES.map(cat => (
            <View key={cat.key}>
              <Text style={[styles.spiritCatLabel, { color: cat.color }]}>{cat.label}</Text>
              <View style={styles.spiritGrid}>
                {AGENT_SPIRITS.filter(s => s.category === cat.key).map(spirit => {
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
                      <Text style={[styles.spiritName, active && { color: spirit.color }]} numberOfLines={1}>
                        {spirit.name}
                      </Text>
                      <Text style={styles.spiritTagline} numberOfLines={1}>{spirit.tagline}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}

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
    width: '48%', padding: 12, borderRadius: 10,
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
  spiritEmoji: { fontSize: 28, marginBottom: 8 },
  spiritName: {
    color: '#6366f1', fontSize: 12, fontWeight: '800', fontFamily: 'monospace', textAlign: 'center',
  },
  spiritTagline: {
    color: '#666', fontSize: 13, fontFamily: 'monospace', lineHeight: 15, marginTop: 2, textAlign: 'center',
  },
  roleReadinessSection: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#1e1e3a',
    gap: 10,
  },
  roleReadinessTitle: {
    color: '#38bdf8',
    fontSize: 12,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 1.5,
  },
  roleReadinessRole: {
    color: '#f8fafc',
    fontSize: 15,
    fontWeight: '800',
    fontFamily: 'monospace',
  },
  roleReadinessSummary: {
    color: '#94a3b8',
    fontSize: 12,
    lineHeight: 18,
    fontFamily: 'monospace',
  },
  roleChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  roleChip: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#082032',
    borderWidth: 1,
    borderColor: '#12324a',
  },
  roleChipText: {
    color: '#7dd3fc',
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  roleChecklistItem: {
    color: '#cbd5e1',
    fontSize: 12,
    lineHeight: 18,
    fontFamily: 'monospace',
  },
  roleSubheading: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 1,
    marginBottom: 4,
  },
  roleSourceLink: {
    color: '#60a5fa',
    fontSize: 11,
    lineHeight: 16,
    fontFamily: 'monospace',
    marginTop: 2,
  },
  roleActionRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  roleActionBtn: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#1e3a5f',
  },
  roleActionBtnText: {
    color: '#7dd3fc',
    fontSize: 11,
    fontFamily: 'monospace',
    fontWeight: '800',
    letterSpacing: 0.8,
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
  roleSaveBtn: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#082f1a',
    borderWidth: 1,
    borderColor: '#166534',
  },
  roleSaveBtnText: {
    color: '#4ade80',
    fontSize: 11,
    fontFamily: 'monospace',
    fontWeight: '800',
    letterSpacing: 0.7,
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
  roleStatus: {
    color: '#86efac',
    fontSize: 11,
    fontFamily: 'monospace',
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
