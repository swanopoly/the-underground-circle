import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import FlatIcon, { ICON_CATALOG } from '../../../../components/FlatIcon';
import SessionTagInput from '../../../../components/SessionTagInput';
import { OfficeAgent } from '../../../../lib/officeAgents';
import { SessionTag } from '../../../../lib/sessionTags';
import { getTemplatesByCategory, detectTemplate } from '../../../../lib/soulTemplates';
import { AGENT_SPIRITS, SPIRIT_CATEGORIES, getSpiritById } from '../../../../lib/agentSpirits';
import {
  buildSpiritCareerArtifact,
  buildSpiritRoleReadinessChecklist,
  getSpiritCareerProfile,
} from '../../../../lib/spiritCareerProfiles';
import {
  buildSpiritOperationsArtifact,
  getSpiritOperationsProfile,
} from '../../../../lib/spiritOperationsProfiles';
import { buildCircleCapabilityPreflight, classifyCircleOwnershipReadiness, getSpiritIntegrationRequirements } from '../../../../lib/circleIntegrations';
import { updateAgentSpirit } from '../../../../lib/circleOffice';
import { getAgentIdentityKey, loadAgentIdentities, updateAgentIdentity } from '../../../../lib/agentIdentity';
import { loadCircleSiteCredentials, loadSiteCredentials } from '../../../../lib/siteAutomation';
import { supabase } from '../../../../lib/supabase';

interface Props {
  agent: OfficeAgent;
  circleId?: string;
  sessionKey?: string;
  onAgentIdentityChange?: () => void;
  currentTags?: SessionTag[];
  onAddSessionTag?: (sessionKey: string, tag: SessionTag) => void;
  onRemoveSessionTag?: (sessionKey: string, tagKey: string) => void;
}

export default function AgentSpiritPanel({
  agent,
  circleId,
  sessionKey,
  onAgentIdentityChange,
  currentTags = [],
  onAddSessionTag,
  onRemoveSessionTag,
}: Props) {
  const [showSoul, setShowSoul] = useState(false);
  const [soulText, setSoulText] = useState('');
  const [soulSaving, setSoulSaving] = useState(false);
  const [soulStatus, setSoulStatus] = useState('');
  const [soulLoaded, setSoulLoaded] = useState<string | null>(null);
  const [customProfilesLoaded, setCustomProfilesLoaded] = useState(false);
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
  const [saveProfileName, setSaveProfileName] = useState('');
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [currentSpirit, setCurrentSpirit] = useState<string | null>(null);
  const [dbAgentId, setDbAgentId] = useState<string | null>(null);
  const [roleArtifact, setRoleArtifact] = useState<{ title: string; content: string } | null>(null);
  const [roleActionStatus, setRoleActionStatus] = useState('');
  const [savingRoleArtifact, setSavingRoleArtifact] = useState(false);
  const [opsArtifact, setOpsArtifact] = useState<{ title: string; content: string } | null>(null);
  const [opsActionStatus, setOpsActionStatus] = useState('');
  const [savingOpsArtifact, setSavingOpsArtifact] = useState(false);
  const [wordpressStatus, setWordpressStatus] = useState<{ connected: boolean; siteUrl?: string | null; username?: string | null; label?: string | null }>({ connected: false });
  const [integrationReadiness, setIntegrationReadiness] = useState<{ ok: boolean; missingCapabilities: string[]; missingConnectors: string[] } | null>(null);

  const personalityScrollRef = useRef<ScrollView>(null);
  const personalityScrollX = useRef(0);
  const stableSessionKey = sessionKey || getAgentIdentityKey(agent);
  const currentSpiritProfile = currentSpirit && !currentSpirit.startsWith('custom::')
    ? getSpiritCareerProfile(currentSpirit)
    : null;
  const currentOperationsProfile = currentSpirit && !currentSpirit.startsWith('custom::')
    ? getSpiritOperationsProfile(currentSpirit)
    : null;
  const spiritIntegrationRequirements = currentSpirit && !currentSpirit.startsWith('custom::')
    ? getSpiritIntegrationRequirements(currentSpirit)
    : { requiredConnectors: [], requiredCapabilities: [] };
  const ownershipReadiness = integrationReadiness
    ? classifyCircleOwnershipReadiness(integrationReadiness)
    : null;
  const roleChecklist = buildSpiritRoleReadinessChecklist(currentSpiritProfile?.spiritId || null);

  const ensureDbAgent = useCallback(async (): Promise<string | null> => {
    if (dbAgentId) return dbAgentId;
    if (!agent || !circleId) return null;
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return null;
    const { data } = await supabase
      .from('circle_office_agents')
      .select('id, spirit, spirit_emoji')
      .eq('circle_id', circleId)
      .eq('owner_id', auth.user.id)
      .ilike('name', agent.name)
      .maybeSingle();
    if (data) {
      setDbAgentId(data.id);
      setCurrentSpirit(data.spirit || null);
      return data.id;
    }
    const { data: created, error } = await supabase
      .from('circle_office_agents')
      .upsert({
        circle_id: circleId,
        owner_id: auth.user.id,
        name: agent.name,
        provider: agent.providerType || 'claude-code',
        status: agent.status || 'idle',
        color: agent.color || '#6366f1',
      }, { onConflict: 'circle_id,owner_id,name' })
      .select('id')
      .single();
    if (created && !error) {
      setDbAgentId(created.id);
      return created.id;
    }
    return null;
  }, [agent, circleId, dbAgentId]);

  useEffect(() => {
    setDbAgentId(null);
    setCurrentSpirit(null);
    setEditingSpirit(false);
    setShowSoul(false);
    setSoulStatus('');
    setRoleArtifact(null);
    setRoleActionStatus('');
    setOpsArtifact(null);
    setOpsActionStatus('');
  }, [agent.id]);

  useEffect(() => {
    setRoleArtifact(null);
    setRoleActionStatus('');
    setOpsArtifact(null);
    setOpsActionStatus('');
  }, [currentSpirit]);

  useEffect(() => {
    ensureDbAgent();
  }, [ensureDbAgent]);

  useEffect(() => {
    if (customProfilesLoaded) return;
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      const { data } = await supabase
        .from('custom_agent_profiles')
        .select('*')
        .eq('user_id', auth.user.id)
        .order('name');
      if (data) setCustomProfiles(data);
      setCustomProfilesLoaded(true);
    })();
  }, [customProfilesLoaded]);

  useEffect(() => {
    if (!agent || !circleId) return;
    const agentKey = agent.name || 'default';
    if (soulLoaded === agentKey) return;
    (async () => {
      const identities = await loadAgentIdentities();
      const identity = identities.get(stableSessionKey);
      if (identity?.spiritId) {
        setCurrentSpirit(identity.spiritId);
      }
      if (identity?.soulPrompt && identity.soulPrompt.trim()) {
        setSoulText(identity.soulPrompt);
        setSoulLoaded(agentKey);
        return;
      }
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      const { data } = await supabase
        .from('agent_personalities')
        .select('personality')
        .eq('user_id', auth.user.id)
        .eq('circle_id', circleId)
        .eq('agent_name', agentKey)
        .maybeSingle();
      if (!data?.personality) {
        const { data: defaultData } = await supabase
          .from('agent_personalities')
          .select('personality')
          .eq('user_id', auth.user.id)
          .eq('circle_id', circleId)
          .eq('agent_name', 'default')
          .maybeSingle();
        setSoulText(defaultData?.personality || '');
      } else {
        setSoulText(data.personality);
      }
      setSoulLoaded(agentKey);
    })();
  }, [agent, circleId, soulLoaded, stableSessionKey]);

  useEffect(() => {
    if (!agent) {
      setSoulLoaded(null);
      setSoulText('');
      setShowSoul(false);
      setCustomProfilesLoaded(false);
    }
  }, [agent]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const credentials = circleId
        ? await loadCircleSiteCredentials(circleId, 'wordpress').then(rows => rows.length > 0 ? rows : loadSiteCredentials('wordpress'))
        : await loadSiteCredentials('wordpress');
      if (cancelled) return;
      const primary = credentials.find(cred => cred.isActive) || credentials[0];
      setWordpressStatus(primary ? {
        connected: true,
        siteUrl: primary.siteUrl,
        username: primary.username,
        label: primary.label,
      } : { connected: false });
    })();
    return () => {
      cancelled = true;
    };
  }, [circleId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!circleId || !currentSpirit || currentSpirit.startsWith('custom::')) {
        setIntegrationReadiness(null);
        return;
      }
      const requirements = getSpiritIntegrationRequirements(currentSpirit);
      if (requirements.requiredConnectors.length === 0 && requirements.requiredCapabilities.length === 0) {
        setIntegrationReadiness({ ok: true, missingCapabilities: [], missingConnectors: [] });
        return;
      }
      const result = await buildCircleCapabilityPreflight({
        circleId,
        requiredConnectors: requirements.requiredConnectors,
        requiredCapabilities: requirements.requiredCapabilities,
      });
      if (!cancelled) setIntegrationReadiness(result);
    })();
    return () => {
      cancelled = true;
    };
  }, [circleId, currentSpirit]);

  const handleSaveSoul = async () => {
    if (!circleId || !agent) return;
    setSoulSaving(true);
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) { setSoulSaving(false); return; }
    const agentKey = agent.name || 'default';
    const { error } = await supabase
      .from('agent_personalities')
      .upsert({
        user_id: auth.user.id,
        circle_id: circleId,
        agent_name: agentKey,
        personality: soulText.trim(),
      }, { onConflict: 'user_id,circle_id,agent_name' });
    await updateAgentIdentity(stableSessionKey, {
      soulPrompt: soulText.trim(),
      isCustomized: true,
    });
    onAgentIdentityChange?.();
    setSoulStatus(error ? `Error: ${error.message}` : 'Soul saved!');
    setSoulSaving(false);
    setTimeout(() => setSoulStatus(''), 3000);
  };

  const handleGenerateRoleArtifact = async (kind: 'resume' | 'interview' | 'portfolio' | 'drill' | 'work_sample') => {
    const artifact = buildSpiritCareerArtifact(kind, currentSpiritProfile?.spiritId || null);
    setRoleArtifact(artifact);
    setRoleActionStatus(artifact ? `${artifact.title} generated` : 'No role profile available');
    setTimeout(() => setRoleActionStatus(''), 2500);
  };

  const handleSaveRoleArtifact = async () => {
    if (!circleId || !roleArtifact) return;
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth.user?.id;
    if (!userId) {
      setRoleActionStatus('Sign in required to save');
      return;
    }
    setSavingRoleArtifact(true);
    try {
      const { saveSoulAwareAgentMemory } = await import('../../../../lib/memoryService');
      await saveSoulAwareAgentMemory({
        circleId,
        userId,
        agentId: agent.id,
        agentName: agent.name,
        memoryKind: 'instruction',
        source: 'spirit_role_readiness',
        namespace: 'agent_private_pattern',
        title: roleArtifact.title,
        content: roleArtifact.content,
        importance: 0.88,
        sourceType: 'manual',
        currentSoulKey: currentSpirit ? `soul:${currentSpirit}` : null,
        feedback: `Saved role readiness artifact for ${currentSpiritProfile?.seniorRoleTitle || currentSpirit || 'active spirit'}.`,
      });
      setRoleActionStatus('Saved to Spirit memory');
      onAgentIdentityChange?.();
    } catch (err: any) {
      setRoleActionStatus(err?.message || 'Failed to save artifact');
    }
    setSavingRoleArtifact(false);
    setTimeout(() => setRoleActionStatus(''), 2500);
  };

  const handleGenerateOpsArtifact = async (kind: 'ops_plan' | 'access_checklist' | 'sop') => {
    const artifact = buildSpiritOperationsArtifact(kind, currentOperationsProfile?.spiritId || null);
    setOpsArtifact(artifact);
    setOpsActionStatus(artifact ? `${artifact.title} generated` : 'No company operations profile available');
    setTimeout(() => setOpsActionStatus(''), 2500);
  };

  const handleSaveOpsArtifact = async () => {
    if (!circleId || !opsArtifact) return;
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth.user?.id;
    if (!userId) {
      setOpsActionStatus('Sign in required to save');
      return;
    }
    setSavingOpsArtifact(true);
    try {
      const { saveSoulAwareAgentMemory } = await import('../../../../lib/memoryService');
      await saveSoulAwareAgentMemory({
        circleId,
        userId,
        agentId: agent.id,
        agentName: agent.name,
        memoryKind: 'instruction',
        source: 'spirit_company_operations',
        namespace: 'agent_private_pattern',
        title: opsArtifact.title,
        content: opsArtifact.content,
        importance: 0.9,
        sourceType: 'manual',
        currentSoulKey: currentSpirit ? `soul:${currentSpirit}` : null,
        feedback: `Saved company operations artifact for ${currentOperationsProfile?.companyFunction || currentSpirit || 'active spirit'}.`,
      });
      setOpsActionStatus('Saved to Spirit memory');
      onAgentIdentityChange?.();
    } catch (err: any) {
      setOpsActionStatus(err?.message || 'Failed to save artifact');
    }
    setSavingOpsArtifact(false);
    setTimeout(() => setOpsActionStatus(''), 2500);
  };

  return (
    <>
      <Pressable
        onPress={() => setShowSpirits(!showSpirits)}
        style={[styles.spiritRow, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
      >
        <Text style={styles.spiritLabel}>
          {showSpirits ? '▼' : '▶'} SOUL
        </Text>
        {currentSpirit ? (
          <View style={[styles.spiritBadge, { flexDirection: 'row', alignItems: 'center', gap: 6 }]}>
            {ICON_CATALOG[currentSpirit] ? (
              <FlatIcon name={currentSpirit} size={18} />
            ) : (
              <Text style={{ fontSize: 12 }}>{getSpiritById(currentSpirit)?.emoji}</Text>
            )}
            <Text style={styles.spiritBadgeText}>
              {getSpiritById(currentSpirit)?.name}
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
          {currentSpirit && getSpiritById(currentSpirit) && (() => {
            const s = getSpiritById(currentSpirit)!;
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
                      <Pressable key={opt} onPress={() => setCustomKnobs(prev => ({ ...prev, [label === 'ACTION' ? 'actionPosture' : label === 'EVIDENCE' ? 'evidencePosture' : label === 'COMMUNICATION' ? 'communicationDensity' : label === 'SKEPTICISM' ? 'skepticism' : 'riskTier']: opt }))}
                        style={[{ paddingHorizontal: 8, paddingVertical: 6, borderRadius: 4, borderWidth: 1, borderColor: value === opt ? (colors?.[opt] || '#6366f1') + '60' : '#1e1e3a', backgroundColor: value === opt ? (colors?.[opt] || '#6366f1') + '15' : 'transparent' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
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
                      onPress={() => {
                        if (!editingSpirit) {
                          setCustomPrompt(s.systemPromptPrefix);
                          setCustomKnobs({ actionPosture: s.actionPosture, evidencePosture: s.evidencePosture, communicationDensity: s.communicationDensity, skepticism: s.skepticism, riskTier: s.riskTier, escalationTrigger: s.escalationTrigger, skillBundle: s.skillBundle });
                        }
                        setEditingSpirit(!editingSpirit);
                      }}
                      style={[{ paddingVertical: 5, paddingHorizontal: 10, borderRadius: 6, backgroundColor: editingSpirit ? '#6366f120' : '#ffffff08', borderWidth: 1, borderColor: editingSpirit ? '#6366f140' : '#ffffff15' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                    >
                      <Text style={{ fontSize: 13, fontFamily: 'monospace', fontWeight: '700', color: editingSpirit ? '#6366f1' : '#888' }}>{editingSpirit ? 'EDITING' : 'EDIT'}</Text>
                    </Pressable>
                    <Pressable onPress={async () => {
                      const id = await ensureDbAgent();
                      if (id) {
                        await updateAgentSpirit(id, null, null);
                        await updateAgentIdentity(stableSessionKey, {
                          spiritId: null,
                          spiritEmoji: null,
                          customProfileId: null,
                          customProfileName: null,
                          isCustomized: true,
                        });
                        onAgentIdentityChange?.();
                        setCurrentSpirit(null);
                        setEditingSpirit(false);
                      }
                    }}
                      style={[styles.spiritClearBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                      <Text style={styles.spiritClearText}>Clear</Text>
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
                      <TextInput value={customKnobs.skillBundle} onChangeText={v => setCustomKnobs(prev => ({ ...prev, skillBundle: v }))}
                        style={{ fontSize: 12, color: '#6366f1', fontFamily: 'monospace', fontWeight: '700', textAlign: 'center', borderBottomWidth: 1, borderBottomColor: '#1e1e3a', paddingVertical: 6 }} placeholder="skill-name" placeholderTextColor="#333" />
                    ) : (
                      <Text style={[styles.spiritKnobValue, { color: '#6366f1' }]} numberOfLines={1}>{knobs.skillBundle}</Text>
                    )}
                  </View>
                </View>

                <View style={styles.spiritEscalation}>
                  <Text style={styles.spiritKnobLabel}>ESCALATES WHEN</Text>
                  {editingSpirit ? (
                    <TextInput value={customKnobs.escalationTrigger} onChangeText={v => setCustomKnobs(prev => ({ ...prev, escalationTrigger: v }))}
                      style={[styles.spiritEscalationText, { borderBottomWidth: 1, borderBottomColor: '#1e1e3a', paddingVertical: 6 }]}
                      placeholder="e.g. failing tests, unclear requirements" placeholderTextColor="#333" />
                  ) : (
                    <Text style={styles.spiritEscalationText}>{knobs.escalationTrigger}</Text>
                  )}
                </View>

                <Pressable onPress={() => setShowSoul(!showSoul)} style={[{ marginTop: 10, paddingVertical: 6 }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                  <Text style={{ color: '#888', fontSize: 14, fontFamily: 'monospace', fontWeight: '800', letterSpacing: 1 }}>
                    {showSoul ? '▼' : '▶'} SYSTEM PROMPT ({Math.round(prompt.length / 100) * 100}+ chars)
                  </Text>
                </Pressable>
                {showSoul && (
                  <View style={{ marginTop: 4 }}>
                    {editingSpirit ? (
                      <TextInput value={customPrompt} onChangeText={setCustomPrompt} multiline
                        style={{ backgroundColor: '#000', borderWidth: 1, borderColor: '#1e1e3a', borderRadius: 8, padding: 12, color: '#ccc', fontFamily: 'monospace', fontSize: 14, minHeight: 200, maxHeight: 400, textAlignVertical: 'top' }}
                        placeholder="System prompt instructions..." placeholderTextColor="#333" />
                    ) : (
                      <ScrollView style={{ maxHeight: 300, backgroundColor: '#000', borderWidth: 1, borderColor: '#1e1e3a', borderRadius: 8, padding: 12 }}>
                        <Text style={{ color: '#aaa', fontFamily: 'monospace', fontSize: 14, lineHeight: 17 }} selectable>{prompt}</Text>
                      </ScrollView>
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
                      <Pressable onPress={() => handleGenerateRoleArtifact('resume')} style={[styles.roleActionBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                        <Text style={styles.roleActionBtnText}>RESUME</Text>
                      </Pressable>
                      <Pressable onPress={() => handleGenerateRoleArtifact('interview')} style={[styles.roleActionBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                        <Text style={styles.roleActionBtnText}>INTERVIEW</Text>
                      </Pressable>
                      <Pressable onPress={() => handleGenerateRoleArtifact('portfolio')} style={[styles.roleActionBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                        <Text style={styles.roleActionBtnText}>PORTFOLIO</Text>
                      </Pressable>
                      <Pressable onPress={() => handleGenerateRoleArtifact('drill')} style={[styles.roleActionBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                        <Text style={styles.roleActionBtnText}>DRILL</Text>
                      </Pressable>
                      <Pressable onPress={() => handleGenerateRoleArtifact('work_sample')} style={[styles.roleActionBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                        <Text style={styles.roleActionBtnText}>WORK SAMPLE</Text>
                      </Pressable>
                    </View>

                    {roleArtifact ? (
                      <View style={styles.roleArtifactCard}>
                        <Text style={styles.roleArtifactTitle}>{roleArtifact.title}</Text>
                        <ScrollView style={{ maxHeight: 240 }}>
                          <Text selectable style={styles.roleArtifactContent}>{roleArtifact.content}</Text>
                        </ScrollView>
                        <View style={styles.roleArtifactActionRow}>
                          <Pressable onPress={handleSaveRoleArtifact} style={[styles.roleSaveBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any, savingRoleArtifact && { opacity: 0.5 }]}>
                            <Text style={styles.roleSaveBtnText}>{savingRoleArtifact ? 'SAVING...' : 'SAVE TO SPIRIT MEMORY'}</Text>
                          </Pressable>
                          <Pressable onPress={() => setRoleArtifact(null)} style={[styles.roleDismissBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                            <Text style={styles.roleDismissBtnText}>DISMISS</Text>
                          </Pressable>
                        </View>
                      </View>
                    ) : null}

                    {roleActionStatus ? (
                      <Text style={styles.roleStatus}>{roleActionStatus}</Text>
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
                      <Text style={styles.opsAccessStatus}>
                        {wordpressStatus.connected ? 'Connected' : 'Not connected'}
                      </Text>
                      <Text style={styles.opsAccessDetail}>
                        {wordpressStatus.connected
                          ? `${wordpressStatus.siteUrl || wordpressStatus.label || 'WordPress'}${wordpressStatus.username ? ` • ${wordpressStatus.username}` : ''}`
                          : 'Connect WordPress credentials so this Soul can publish and manage content with the right access.'}
                      </Text>
                    </View>

                    {integrationReadiness ? (
                      <View style={styles.opsAccessCard}>
                        <Text style={styles.opsSubheading}>INTEGRATION READINESS</Text>
                        <Text style={[
                          styles.opsAccessStatus,
                          ownershipReadiness?.level === 'full' ? styles.opsAccessStatusReady : null,
                          ownershipReadiness?.level === 'assisted' ? styles.opsAccessStatusAssist : null,
                          ownershipReadiness?.level === 'blocked' ? styles.opsAccessStatusBlocked : null,
                        ]}>
                          {ownershipReadiness?.headline || (integrationReadiness.ok ? 'Ready for ownership' : 'Missing required systems')}
                        </Text>
                        {ownershipReadiness ? (
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
                        {integrationReadiness.missingConnectors.length > 0 ? (
                          <Text style={styles.opsAccessDetail}>
                            Missing connectors: {integrationReadiness.missingConnectors.join(', ')}
                          </Text>
                        ) : null}
                        {integrationReadiness.missingCapabilities.length > 0 ? (
                          <Text style={styles.opsAccessDetail}>
                            Missing capabilities: {integrationReadiness.missingCapabilities.join(', ')}
                          </Text>
                        ) : null}
                        {integrationReadiness.ok ? (
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
                      <Pressable onPress={() => handleGenerateOpsArtifact('ops_plan')} style={[styles.opsActionBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                        <Text style={styles.opsActionBtnText}>OPS PLAN</Text>
                      </Pressable>
                      <Pressable onPress={() => handleGenerateOpsArtifact('access_checklist')} style={[styles.opsActionBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                        <Text style={styles.opsActionBtnText}>ACCESS</Text>
                      </Pressable>
                      <Pressable onPress={() => handleGenerateOpsArtifact('sop')} style={[styles.opsActionBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                        <Text style={styles.opsActionBtnText}>SOP</Text>
                      </Pressable>
                    </View>

                    {opsArtifact ? (
                      <View style={styles.roleArtifactCard}>
                        <Text style={styles.roleArtifactTitle}>{opsArtifact.title}</Text>
                        <ScrollView style={{ maxHeight: 240 }}>
                          <Text selectable style={styles.roleArtifactContent}>{opsArtifact.content}</Text>
                        </ScrollView>
                        <View style={styles.roleArtifactActionRow}>
                          <Pressable onPress={handleSaveOpsArtifact} style={[styles.opsSaveBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any, savingOpsArtifact && { opacity: 0.5 }]}>
                            <Text style={styles.opsSaveBtnText}>{savingOpsArtifact ? 'SAVING...' : 'SAVE TO SPIRIT MEMORY'}</Text>
                          </Pressable>
                          <Pressable onPress={() => setOpsArtifact(null)} style={[styles.roleDismissBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                            <Text style={styles.roleDismissBtnText}>DISMISS</Text>
                          </Pressable>
                        </View>
                      </View>
                    ) : null}

                    {opsActionStatus ? (
                      <Text style={styles.opsStatus}>{opsActionStatus}</Text>
                    ) : null}
                  </View>
                )}

                {editingSpirit && (
                  <View style={{ marginTop: 12 }}>
                    {showSaveForm ? (
                      <View style={{ gap: 8 }}>
                        <TextInput value={saveProfileName} onChangeText={setSaveProfileName} placeholder="Profile name..." placeholderTextColor="#555"
                          style={{ backgroundColor: '#000', borderWidth: 1, borderColor: '#1e1e3a', borderRadius: 8, padding: 10, color: '#eee', fontFamily: 'monospace', fontSize: 13 }} />
                        <View style={{ flexDirection: 'row', gap: 8 }}>
                          <Pressable
                            onPress={async () => {
                              if (!saveProfileName.trim()) return;
                              setSavingProfile(true);
                              const { data: auth } = await supabase.auth.getUser();
                              if (!auth.user) {
                                console.warn('[AgentSpiritPanel] Cannot save profile: no authenticated user');
                                setSavingProfile(false);
                                return;
                              }
                              const { data, error } = await supabase.from('custom_agent_profiles').upsert({
                                user_id: auth.user.id, name: saveProfileName.trim(),
                                system_prompt: customPrompt, skill_bundle: customKnobs.skillBundle,
                                risk_tier: customKnobs.riskTier, action_posture: customKnobs.actionPosture,
                                evidence_posture: customKnobs.evidencePosture, communication_density: customKnobs.communicationDensity,
                                skepticism: customKnobs.skepticism, escalation_trigger: customKnobs.escalationTrigger,
                                emoji: getSpiritById(currentSpirit)?.emoji || '🤖', color: getSpiritById(currentSpirit)?.color || '#6366f1',
                                tagline: `Custom ${s.name} profile`,
                              }, { onConflict: 'user_id,name' }).select().single();
                              if (error) {
                                // Surface the failure instead of silently no-op'ing. User
                                // sees an Alert and the console gets the full error.
                                console.warn('[AgentSpiritPanel] Failed to save profile:', error);
                                if (Platform.OS === 'web' && typeof window !== 'undefined') {
                                  window.alert(`Failed to save profile: ${error.message}`);
                                } else {
                                  const { Alert } = await import('react-native');
                                  Alert.alert('Save failed', error.message);
                                }
                              } else if (data) {
                                setCustomProfiles(prev => [...prev.filter(p => p.id !== data.id), data]);
                                setShowSaveForm(false);
                                setSaveProfileName('');
                              }
                              setSavingProfile(false);
                            }}
                            style={[{ flex: 1, paddingVertical: 10, borderRadius: 8, backgroundColor: '#22c55e15', borderWidth: 1, borderColor: '#22c55e40', alignItems: 'center' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                            <Text style={{ color: '#22c55e', fontSize: 12, fontFamily: 'monospace', fontWeight: '800' }}>{savingProfile ? '...' : 'SAVE PROFILE'}</Text>
                          </Pressable>
                          <Pressable onPress={() => setShowSaveForm(false)}
                            style={[{ paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8, backgroundColor: '#ffffff08', borderWidth: 1, borderColor: '#ffffff15' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                            <Text style={{ color: '#888', fontSize: 12, fontFamily: 'monospace', fontWeight: '700' }}>Cancel</Text>
                          </Pressable>
                        </View>
                      </View>
                    ) : (
                      <Pressable onPress={() => { setSaveProfileName(s.name + ' (Custom)'); setShowSaveForm(true); }}
                        style={[{ paddingVertical: 10, borderRadius: 8, backgroundColor: '#6366f115', borderWidth: 1, borderColor: '#6366f140', alignItems: 'center' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                        <Text style={{ color: '#6366f1', fontSize: 12, fontFamily: 'monospace', fontWeight: '800', letterSpacing: 0.5 }}>SAVE AS CUSTOM PROFILE</Text>
                      </Pressable>
                    )}
                  </View>
                )}
              </View>
            );
          })()}

          {customProfiles.length > 0 && (
            <View style={{ marginBottom: 10 }}>
              <Text style={[styles.spiritCatLabel, { color: '#22c55e' }]}>Your Custom Profiles</Text>
              <View style={styles.spiritGrid}>
                {customProfiles.map(profile => {
                  const active = currentSpirit === `custom::${profile.id}`;
                  return (
                    <Pressable key={profile.id}
                      onPress={async () => {
                        const id = await ensureDbAgent();
                        if (id) {
                          await updateAgentSpirit(id, `custom::${profile.id}`, profile.emoji);
                          await updateAgentIdentity(stableSessionKey, {
                            spiritId: `custom::${profile.id}`,
                            spiritEmoji: profile.emoji || null,
                            customProfileId: profile.id,
                            customProfileName: profile.name,
                            isCustomized: true,
                          });
                          onAgentIdentityChange?.();
                          setCurrentSpirit(`custom::${profile.id}`);
                        }
                      }}
                      onLongPress={async () => {
                        await supabase.from('custom_agent_profiles').delete().eq('id', profile.id);
                        setCustomProfiles(prev => prev.filter(p => p.id !== profile.id));
                        if (currentSpirit === `custom::${profile.id}`) {
                          const dbId = await ensureDbAgent();
                          if (dbId) {
                            await updateAgentSpirit(dbId, null, null);
                            await updateAgentIdentity(stableSessionKey, {
                              spiritId: null,
                              spiritEmoji: null,
                              customProfileId: null,
                              customProfileName: null,
                              isCustomized: true,
                            });
                            onAgentIdentityChange?.();
                            setCurrentSpirit(null);
                          }
                        }
                      }}
                      style={[styles.spiritCard, active && { borderColor: (profile.color || '#22c55e') + '60', backgroundColor: (profile.color || '#22c55e') + '10' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                      <View style={{ alignItems: 'center', marginBottom: 10 }}>
                        <Text style={{ fontSize: 28 }}>{profile.emoji || '🤖'}</Text>
                      </View>
                      <Text style={[styles.spiritName, active && { color: profile.color || '#22c55e' }]} numberOfLines={1}>{profile.name}</Text>
                      <Text style={styles.spiritTagline} numberOfLines={1}>{profile.tagline || 'Custom profile'}</Text>
                    </Pressable>
                  );
                })}
              </View>
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
                      onPress={async () => {
                        const id = await ensureDbAgent();
                        if (id) {
                          await updateAgentSpirit(id, spirit.id, spirit.emoji);
                          await updateAgentIdentity(stableSessionKey, {
                            spiritId: spirit.id,
                            spiritEmoji: spirit.emoji,
                            customProfileId: null,
                            customProfileName: null,
                            isCustomized: true,
                          });
                          onAgentIdentityChange?.();
                          setCurrentSpirit(spirit.id);
                        }
                      }}
                      style={[
                        styles.spiritCard,
                        active && { borderColor: spirit.color + '60', backgroundColor: spirit.color + '10' },
                        Platform.OS === 'web' && { cursor: 'pointer' } as any,
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
                  onPress={() => personalityScrollRef.current?.scrollTo({ x: (personalityScrollX.current || 0) + 200, animated: true })}
                  style={[styles.scrollArrow, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                >
                  <Text style={styles.scrollArrowText}>›</Text>
                </Pressable>
              </View>

              <TextInput
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
                  onPress={handleSaveSoul}
                  disabled={soulSaving}
                  style={[styles.soulSaveBtn, soulSaving && { opacity: 0.4 }]}
                >
                  <Text style={styles.soulSaveBtnText}>{soulSaving ? 'SAVING...' : 'SAVE SOUL'}</Text>
                </Pressable>
                {soulText.trim() ? (
                  <Pressable onPress={() => setSoulText('')} style={styles.soulClearBtn}>
                    <Text style={styles.soulClearBtnText}>CLEAR</Text>
                  </Pressable>
                ) : null}
                {soulStatus ? (
                  <Text style={{ fontSize: 11, color: soulStatus.startsWith('Error') ? '#ef4444' : '#22c55e', fontFamily: 'monospace' }}>
                    {soulStatus}
                  </Text>
                ) : null}
              </View>
            </View>
          )}
        </View>
      )}

      <View style={styles.activityBar}>
        <Text style={styles.activityLabel}>NOW:</Text>
        <Text style={styles.activityValue}>{agent.activity}</Text>
      </View>

      {onAddSessionTag && onRemoveSessionTag && sessionKey && (
        <View style={styles.tagsSection}>
          <Text style={styles.tagsSectionTitle}>SESSION TAGS</Text>
          <SessionTagInput
            sessionKey={sessionKey}
            currentTags={currentTags}
            onAddTag={(tag) => onAddSessionTag(sessionKey, tag)}
            onRemoveTag={(tagKey) => onRemoveSessionTag(sessionKey, tagKey)}
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
    paddingHorizontal: 8, paddingVertical: 10,
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
    paddingVertical: 6, paddingHorizontal: 14, borderRadius: 8,
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
    width: 32,
    height: 32,
    borderRadius: 16,
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
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12,
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
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8,
    backgroundColor: '#6366f120', borderWidth: 1, borderColor: '#6366f140',
  },
  soulSaveBtnText: {
    fontSize: 12, color: '#6366f1', fontFamily: 'monospace', fontWeight: '800', letterSpacing: 0.8,
  },
  soulClearBtn: {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8,
    backgroundColor: '#ef444420', borderWidth: 1, borderColor: '#ef444440',
  },
  soulClearBtnText: {
    fontSize: 12, color: '#ef4444', fontFamily: 'monospace', fontWeight: '800',
  },
});
