/**
 * ChatThreadHeader
 *
 * Strip above the chat composer that shows the active thread's title,
 * visibility badge, and invite/leave actions. Tapping the title opens a
 * lightweight rename inline. Tapping Invite opens the InviteToThreadModal.
 */

import React, { useEffect, useState } from 'react';
import { Alert, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  type CircleChatThread,
  type CircleChatThreadMember,
  addThreadMember,
  archiveThread,
  getThread,
  leaveThread,
  listThreadMembers,
  removeThreadMember,
  renameThread,
} from '../../../../lib/circleChatThreads';
import type { SessionCodingProfile, SessionDelegationMode } from '../../../../lib/chatSessionProfile';
import { supabase } from '../../../../lib/supabase';
import { loadSafeCircleProfiles } from '../../../../lib/safeProfiles';
import OpenSwanServiceMenu from './OpenSwanServiceMenu';
import SkillAdminPanel from './SkillAdminPanel';
import { soulKeyForProfile } from '../../../../lib/serviceProfileSouls';
import { copyToClipboard } from '../../../../lib/dataExport';

function confirmThreadAction(title: string, message: string, confirmLabel: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    return Promise.resolve(typeof window !== 'undefined' && window.confirm(message));
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: confirmLabel, style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
}

interface Props {
  threadId: string | null;
  circleId: string;
  currentUserId: string | null;
  openswanGatewayNotice?: {
    message: string;
    kind: 'offline' | 'auth' | 'proxy' | 'endpoint' | 'cooldown' | 'info';
    fixLabel?: string | null;
    fixCommand?: string | null;
  } | null;
  onDisableOpenSwanGateway?: (() => void | Promise<void>) | undefined;
  onRetryOpenSwanGateway?: (() => void | Promise<void>) | undefined;
  refreshToken?: number;
  onThreadUpdated?: () => void;
  sessionProfile?: SessionCodingProfile;
  delegationMode?: SessionDelegationMode;
  onSessionProfileChange?: (profile: SessionCodingProfile) => void;
  onDelegationModeChange?: (mode: SessionDelegationMode) => void;
  onOpenControlPanel?: () => void;
  onOpenRunHistory?: () => void;
  /**
   * Open another thread in the chat surface (plan §4b) — used by the
   * lineage chip to jump to the parent this thread continues.
   */
  onOpenThread?: (threadId: string) => void;
}

interface CircleMemberOption {
  id: string;
  display_name: string | null;
  username: string | null;
}

// React Native Pressable is already keyboard-operable on supported native
// surfaces. Pin an explicit tab stop only on web so these controls remain
// reachable if react-native-web's implicit Pressable behavior changes.
const WEB_BUTTON_FOCUS_PROPS = Platform.OS === 'web'
  ? ({ focusable: true, tabIndex: 0 } as any)
  : {};

function webDescriptiveLabel(label: string, hint: string): Record<string, unknown> {
  return Platform.OS === 'web'
    ? ({ 'aria-label': `${label}. ${hint}` } as any)
    : {};
}

export default function ChatThreadHeader({
  threadId,
  circleId,
  currentUserId,
  openswanGatewayNotice = null,
  onDisableOpenSwanGateway,
  onRetryOpenSwanGateway,
  refreshToken = 0,
  onThreadUpdated,
  sessionProfile = 'senior',
  delegationMode = 'auto',
  onSessionProfileChange,
  onDelegationModeChange,
  onOpenControlPanel,
  onOpenRunHistory,
  onOpenThread,
}: Props) {
  const [thread, setThread] = useState<CircleChatThread | null>(null);
  const [members, setMembers] = useState<CircleChatThreadMember[]>([]);
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [showInvite, setShowInvite] = useState(false);
  const [showServiceMenu, setShowServiceMenu] = useState(false);
  const [showSkills, setShowSkills] = useState(false);
  const [disablingGateway, setDisablingGateway] = useState(false);
  const [retryingGateway, setRetryingGateway] = useState(false);
  const [copiedGatewayCmd, setCopiedGatewayCmd] = useState(false);

  useEffect(() => {
    if (!threadId) { setThread(null); setMembers([]); return; }
    // Never leave the previous thread's controls/title on screen while the
    // newly selected thread is resolving. The compact service bar below is
    // the safe loading/error fallback and remains useful for recovery.
    setThread(null);
    setMembers([]);
    let cancelled = false;
    Promise.all([getThread(threadId), listThreadMembers(threadId, circleId)])
      .then(([t, ms]) => {
        if (cancelled) return;
        setThread(t);
        setMembers(ms);
      })
      .catch(err => console.warn('[ChatThreadHeader] load failed:', err));
    return () => { cancelled = true; };
  }, [circleId, threadId, refreshToken]);

  const servicePanels = (
    <>
      <OpenSwanServiceMenu
        visible={showServiceMenu}
        sessionProfile={sessionProfile}
        delegationMode={delegationMode}
        onSessionProfileChange={(p) => onSessionProfileChange?.(p)}
        onDelegationModeChange={(m) => onDelegationModeChange?.(m)}
        onOpenControlPanel={onOpenControlPanel}
        onOpenSkills={() => setShowSkills(true)}
        onOpenRunHistory={onOpenRunHistory}
        onClose={() => setShowServiceMenu(false)}
      />

      <SkillAdminPanel
        visible={showSkills}
        circleId={circleId}
        soulKey={soulKeyForProfile(sessionProfile)}
        userId={currentUserId || ''}
        onClose={() => setShowSkills(false)}
      />
    </>
  );

  const compactServiceBar = (
    <View style={[styles.bar, styles.circleBar]}>
      <View style={styles.circleControlCopy}>
        <Text style={styles.circleControlTitle}>OpenSwan controls</Text>
        <Text style={styles.circleControlHint} numberOfLines={1}>
          Agents, modes, models, approvals & recovery
        </Text>
      </View>
      <View style={styles.actions}>
        <Pressable
          {...WEB_BUTTON_FOCUS_PROPS}
          {...webDescriptiveLabel(
            'Open OpenSwan service controls',
            'Choose mode and crew, or continue to agent, model, approval, and tool settings.',
          )}
          onPress={() => setShowServiceMenu(true)}
          accessibilityRole="button"
          accessibilityLabel="Open OpenSwan service controls"
          accessibilityHint="Choose mode and crew, or continue to agent, model, approval, and tool settings."
          style={({ hovered, pressed, focused }: any) => [
            styles.serviceActionBtn,
            hovered && { borderColor: '#f59e0b', backgroundColor: '#241708' },
            pressed && { transform: [{ scale: 0.97 }] },
            focused && Platform.OS === 'web' && styles.keyboardFocus,
            Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
          ]}
        >
          <Text style={styles.serviceActionText}>OPEN</Text>
        </Pressable>
        {onOpenRunHistory ? (
          <Pressable
            {...WEB_BUTTON_FOCUS_PROPS}
            {...webDescriptiveLabel(
              'Open OpenSwan runs and recovery',
              'Review active, completed, or blocked runs and available recovery actions.',
            )}
            onPress={onOpenRunHistory}
            accessibilityRole="button"
            accessibilityLabel="Open OpenSwan runs and recovery"
            accessibilityHint="Review active, completed, or blocked runs and available recovery actions."
            style={({ hovered, pressed, focused }: any) => [
              styles.actionBtnGhost,
              hovered && { borderColor: '#38bdf8', backgroundColor: '#0b2030' },
              pressed && { transform: [{ scale: 0.97 }] },
              focused && Platform.OS === 'web' && styles.keyboardFocus,
              Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
            ]}
          >
            <Text style={styles.actionBtnGhostText}>RUNS</Text>
          </Pressable>
        ) : null}
      </View>
      {servicePanels}
    </View>
  );

  const isCircleThread = thread?.visibility === 'circle';
  if (!thread || isCircleThread) return compactServiceBar;

  const isOwner = !!currentUserId && thread.created_by === currentUserId;

  const visibilityLabel =
    thread.visibility === 'shared' ? `SHARED · ${members.length}`
    : 'PRIVATE';
  const visibilityTone =
    thread.visibility === 'shared' ? '#f59e0b'
    : '#94a3b8';
  const handleSaveTitle = async () => {
    const next = draftTitle.trim();
    if (!next || next === thread.title) { setEditing(false); return; }
    try {
      await renameThread(thread.id, next);
      setThread({ ...thread, title: next });
      onThreadUpdated?.();
    } catch (err) {
      console.warn('[ChatThreadHeader] rename failed:', err);
    } finally {
      setEditing(false);
    }
  };

  return (
    <View style={styles.bar}>
      <View style={styles.titleColumn}>
        {editing ? (
          <TextInput
            autoFocus
            value={draftTitle}
            onChangeText={setDraftTitle}
            onBlur={handleSaveTitle}
            onSubmitEditing={handleSaveTitle}
            style={styles.titleInput}
            placeholder="Thread name"
            placeholderTextColor="#475569"
          />
        ) : (
          <Pressable
            disabled={isCircleThread || !isOwner}
            onPress={() => { setDraftTitle(thread.title); setEditing(true); }}
          >
            <Text style={styles.title}>{thread.title}</Text>
          </Pressable>
        )}
        <View style={styles.metaRow}>
          <Text style={[styles.badge, { color: visibilityTone, borderColor: visibilityTone }]}>{visibilityLabel}</Text>
          {thread.parent_thread_id ? (
            /* Plan §4b: lineage was tracked in the DB but invisible — a
               compressed/forked thread now says so and can jump back. */
            <Pressable
              onPress={onOpenThread ? () => onOpenThread(thread.parent_thread_id!) : undefined}
              disabled={!onOpenThread}
            >
              <Text style={[styles.badge, { color: '#38bdf8', borderColor: '#38bdf8' }]}>
                ↳ CONTINUES EARLIER THREAD{onOpenThread ? ' · OPEN' : ''}
              </Text>
            </Pressable>
          ) : null}
          {openswanGatewayNotice ? (
            <View style={styles.gatewayNoticeWrap}>
              <Text style={styles.gatewayNotice} numberOfLines={1}>
                {openswanGatewayNotice.message}
              </Text>
              <Pressable
                {...WEB_BUTTON_FOCUS_PROPS}
                onPress={() => setShowServiceMenu(true)}
                accessibilityRole="button"
                accessibilityLabel="Open OpenSwan service controls"
                style={styles.gatewayActionBtn}
              >
                <Text style={styles.gatewayActionText}>SERVICE</Text>
              </Pressable>
              <Pressable
                {...WEB_BUTTON_FOCUS_PROPS}
                onPress={async () => {
                  const ok = await copyToClipboard(openswanGatewayNotice.fixCommand || 'openswan gateway start');
                  setCopiedGatewayCmd(ok);
                  if (ok) setTimeout(() => setCopiedGatewayCmd(false), 1800);
                }}
                accessibilityRole="button"
                accessibilityLabel={copiedGatewayCmd ? 'OpenSwan fix command copied' : 'Copy OpenSwan gateway fix command'}
                style={styles.gatewayActionBtn}
              >
                <Text style={styles.gatewayActionText}>{copiedGatewayCmd ? 'COPIED' : (openswanGatewayNotice.fixLabel || 'COPY FIX')}</Text>
              </Pressable>
              {onRetryOpenSwanGateway ? (
                <Pressable
                  {...WEB_BUTTON_FOCUS_PROPS}
                  disabled={retryingGateway}
                  onPress={async () => {
                    try {
                      setRetryingGateway(true);
                      await onRetryOpenSwanGateway();
                    } finally {
                      setRetryingGateway(false);
                    }
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={retryingGateway ? 'Retrying local OpenSwan gateway' : 'Retry local OpenSwan gateway'}
                  accessibilityState={{ disabled: retryingGateway, busy: retryingGateway }}
                  style={[styles.gatewayActionBtn, retryingGateway && styles.gatewayActionBtnDisabled]}
                >
                  <Text style={styles.gatewayActionText}>{retryingGateway ? 'RETRYING…' : 'RETRY LOCAL'}</Text>
                </Pressable>
              ) : null}
              {onDisableOpenSwanGateway ? (
                <Pressable
                  {...WEB_BUTTON_FOCUS_PROPS}
                  disabled={disablingGateway}
                  onPress={async () => {
                    try {
                      setDisablingGateway(true);
                      await onDisableOpenSwanGateway();
                    } finally {
                      setDisablingGateway(false);
                    }
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={disablingGateway ? 'Disabling local OpenSwan gateway' : 'Disable local OpenSwan gateway'}
                  accessibilityState={{ disabled: disablingGateway, busy: disablingGateway }}
                  style={[styles.gatewayActionBtn, disablingGateway && styles.gatewayActionBtnDisabled]}
                >
                  <Text style={styles.gatewayActionText}>{disablingGateway ? 'DISABLING…' : 'DISABLE LOCAL'}</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </View>
      </View>

      <View style={styles.actions}>
        <Pressable
          {...WEB_BUTTON_FOCUS_PROPS}
          {...webDescriptiveLabel(
            'Open OpenSwan service controls',
            'Choose mode and crew, or continue to agent, model, approval, and tool settings.',
          )}
          onPress={() => setShowServiceMenu(true)}
          accessibilityRole="button"
          accessibilityLabel="Open OpenSwan service controls"
          accessibilityHint="Choose mode and crew, or continue to agent, model, approval, and tool settings."
          style={({ hovered, pressed, focused }: any) => [
            styles.serviceActionBtn,
            hovered && { borderColor: '#f59e0b', backgroundColor: '#241708' },
            pressed && { transform: [{ scale: 0.97 }] },
            focused && Platform.OS === 'web' && styles.keyboardFocus,
            Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
          ]}
        >
          <Text style={styles.serviceActionText}>OPENSWAN</Text>
        </Pressable>
        {onOpenRunHistory ? (
          <Pressable
            {...WEB_BUTTON_FOCUS_PROPS}
            {...webDescriptiveLabel(
              'Open OpenSwan runs and recovery',
              'Review active, completed, or blocked runs and available recovery actions.',
            )}
            onPress={onOpenRunHistory}
            accessibilityRole="button"
            accessibilityLabel="Open OpenSwan runs and recovery"
            accessibilityHint="Review active, completed, or blocked runs and available recovery actions."
            style={({ hovered, pressed, focused }: any) => [
              styles.actionBtnGhost,
              hovered && { borderColor: '#38bdf8', backgroundColor: '#0b2030' },
              pressed && { transform: [{ scale: 0.97 }] },
              focused && Platform.OS === 'web' && styles.keyboardFocus,
              Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
            ]}
          >
            <Text style={styles.actionBtnGhostText}>RUNS</Text>
          </Pressable>
        ) : null}
        {!isCircleThread && (
          <Pressable onPress={() => setShowInvite(true)} style={styles.actionBtn} accessibilityRole="button" accessibilityLabel={isOwner ? 'Invite members to this conversation' : 'View conversation members'}>
            <Text style={styles.actionBtnText}>{isOwner ? '+ INVITE' : 'MEMBERS'}</Text>
          </Pressable>
        )}
        {!isCircleThread && isOwner && (
          <Pressable
            onPress={async () => {
              const confirmed = await confirmThreadAction(
                'Archive conversation?',
                'Archive this conversation? It will disappear from the Chat sidebar.',
                'Archive',
              );
              if (!confirmed) return;
              try {
                await archiveThread(thread.id);
              } catch (err) {
                console.warn('[ChatThreadHeader] archive failed:', err);
              } finally {
                onThreadUpdated?.();
              }
            }}
            accessibilityRole="button"
            accessibilityLabel={`Archive ${thread.title}`}
            style={styles.actionBtnGhost}
          >
            <Text style={styles.actionBtnGhostText}>ARCHIVE</Text>
          </Pressable>
        )}
      </View>

      {servicePanels}

      {showInvite && (
        <InviteToThreadModal
          threadId={thread.id}
          circleId={circleId}
          currentUserId={currentUserId}
          isOwner={isOwner}
          members={members}
          onClose={() => setShowInvite(false)}
          onMembersChanged={async () => {
            try { setMembers(await listThreadMembers(thread.id, circleId)); } catch {}
            finally { onThreadUpdated?.(); }
          }}
        />
      )}
    </View>
  );
}

// ─── Invite modal ────────────────────────────────────────────────────────────

function InviteToThreadModal({
  threadId, circleId, currentUserId, isOwner, members, onClose, onMembersChanged,
}: {
  threadId: string;
  circleId: string;
  currentUserId: string | null;
  isOwner: boolean;
  members: CircleChatThreadMember[];
  onClose: () => void;
  onMembersChanged: () => void;
}) {
  const [search, setSearch] = useState('');
  const [circleMembers, setCircleMembers] = useState<CircleMemberOption[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase
          .from('circle_members')
          .select('user_id')
          .eq('circle_id', circleId);
        if (cancelled) return;
        const opts: CircleMemberOption[] = await loadSafeCircleProfiles({
          circleId,
          userIds: (data || []).map((row: any) => row.user_id),
        });
        if (cancelled) return;
        setCircleMembers(opts);
      } catch (err) {
        console.warn('[InviteToThreadModal] members load failed:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [circleId]);

  const memberIds = new Set(members.map(m => m.user_id));
  const q = search.trim().toLowerCase();
  const candidates = circleMembers.filter(m => {
    if (memberIds.has(m.id)) return false;
    if (!q) return true;
    return (m.display_name || '').toLowerCase().includes(q)
        || (m.username || '').toLowerCase().includes(q);
  });

  return (
    <Modal
      transparent
      animationType="fade"
      accessibilityLabel={isOwner ? 'Invite members to this Chat thread' : 'Chat thread members'}
      onRequestClose={onClose}
    >
      <View style={modalStyles.scrim}>
        <View accessibilityViewIsModal style={modalStyles.card}>
          <View style={modalStyles.header}>
            <Text style={modalStyles.title}>{isOwner ? 'Invite to this thread' : 'Thread members'}</Text>
            <Pressable
              {...WEB_BUTTON_FOCUS_PROPS}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close thread members dialog"
              style={({ focused }: any) => [
                modalStyles.closeBtn,
                focused && Platform.OS === 'web' && styles.keyboardFocus,
              ]}
            >
              <Text style={modalStyles.closeBtnText}>×</Text>
            </Pressable>
          </View>

          <View style={modalStyles.section}>
            <Text style={modalStyles.sectionLabel}>CURRENT</Text>
            {members.length === 0 ? (
              <Text style={modalStyles.empty}>Just you so far.</Text>
            ) : (
              members.map(m => (
                <View key={m.user_id} style={modalStyles.memberRow}>
                  <Text style={modalStyles.memberName}>
                    {m.display_name || m.username || m.user_id.slice(0, 8)}
                    {m.role === 'owner' && <Text style={modalStyles.ownerTag}>  OWNER</Text>}
                  </Text>
                  {(isOwner && m.role !== 'owner') && (
                    <Pressable
                      onPress={async () => {
                        setBusy(true);
                        try { await removeThreadMember(threadId, m.user_id); onMembersChanged(); }
                        catch (err) { console.warn('[InviteToThreadModal] remove failed:', err); }
                        finally { setBusy(false); }
                      }}
                      style={modalStyles.smallBtn}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${m.display_name || m.username || 'member'} from this conversation`}
                    >
                      <Text style={modalStyles.smallBtnText}>REMOVE</Text>
                    </Pressable>
                  )}
                  {(!isOwner && m.user_id === currentUserId) && (
                    <Pressable
                      onPress={async () => {
                        const confirmed = await confirmThreadAction(
                          'Leave conversation?',
                          'Leave this shared conversation? You may need another invitation to return.',
                          'Leave',
                        );
                        if (!confirmed) return;
                        setBusy(true);
                        try { await leaveThread(threadId); onMembersChanged(); onClose(); }
                        catch (err) { console.warn('[InviteToThreadModal] leave failed:', err); }
                        finally { setBusy(false); }
                      }}
                      style={modalStyles.smallBtn}
                      accessibilityRole="button"
                      accessibilityLabel="Leave this conversation"
                    >
                      <Text style={modalStyles.smallBtnText}>LEAVE</Text>
                    </Pressable>
                  )}
                </View>
              ))
            )}
          </View>

          {isOwner && (
            <View style={modalStyles.section}>
              <Text style={modalStyles.sectionLabel}>ADD FROM CIRCLE</Text>
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Search members…"
                placeholderTextColor="#475569"
                style={modalStyles.searchInput}
              />
              <ScrollView style={{ maxHeight: 220 }}>
                {candidates.length === 0 ? (
                  <Text style={modalStyles.empty}>No matching circle members.</Text>
                ) : (
                  candidates.map(m => (
                    <Pressable
                      key={m.id}
                      disabled={busy}
                      onPress={async () => {
                        setBusy(true);
                        try { await addThreadMember(threadId, m.id); onMembersChanged(); }
                        catch (err) { console.warn('[InviteToThreadModal] add failed:', err); }
                        finally { setBusy(false); }
                      }}
                      style={modalStyles.candidateRow}
                    >
                      <Text style={modalStyles.candidateName}>{m.display_name || m.username || m.id.slice(0, 8)}</Text>
                      <Text style={modalStyles.candidateAdd}>+ ADD</Text>
                    </Pressable>
                  ))
                )}
              </ScrollView>
            </View>
          )}
        </View>
        <View
          accessible={false}
          style={modalStyles.dismissBackdrop}
          onStartShouldSetResponder={() => true}
          onResponderRelease={onClose}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 8, gap: 12,
    borderBottomWidth: 1, borderBottomColor: '#1a1a28',
    backgroundColor: '#050810',
  },
  circleBar: {
    minHeight: 48,
    flexWrap: 'wrap',
  },
  circleControlCopy: {
    flex: 1,
    minWidth: 180,
    gap: 2,
  },
  circleControlTitle: {
    color: '#f59e0b',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  circleControlHint: {
    color: '#64748b',
    fontSize: 10,
    fontWeight: '700',
  },
  titleColumn: { flex: 1, gap: 2 },
  title: { color: '#f8fafc', fontSize: 14, fontWeight: '800' },
  titleInput: {
    color: '#f8fafc', fontSize: 14, fontWeight: '800',
    paddingVertical: 2, paddingHorizontal: 4,
    borderRadius: 4, backgroundColor: '#111827',
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  badge: {
    fontSize: 9, fontWeight: '900', letterSpacing: 0.6,
    paddingHorizontal: 5, paddingVertical: 2,
    borderRadius: 4, borderWidth: 1,
  },
  gatewayNoticeWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  gatewayNotice: {
    maxWidth: 280,
    color: '#f59e0b',
    fontSize: 10,
    fontWeight: '700',
    flexShrink: 1,
  },
  gatewayActionBtn: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: '#f59e0b55',
    borderRadius: 5,
    backgroundColor: '#f59e0b12',
  },
  gatewayActionBtnDisabled: {
    opacity: 0.5,
  },
  gatewayActionText: {
    color: '#f59e0b',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  metaModel: { color: '#64748b', fontSize: 10, fontWeight: '700' },
  metaModelMuted: { color: '#475569', fontSize: 10, fontWeight: '700' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 6 },
  serviceActionBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#f59e0b66',
    backgroundColor: '#17110a',
  },
  serviceActionText: { color: '#f59e0b', fontSize: 10, fontWeight: '900', letterSpacing: 0.6 },
  actionBtn: {
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 6, borderWidth: 1, borderColor: 'rgba(99, 102, 241, 0.67)',
    backgroundColor: '#0e2030',
  },
  actionBtnText: { color: '#6366f1', fontSize: 10, fontWeight: '900', letterSpacing: 0.6 },
  actionBtnGhost: {
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 6, borderWidth: 1, borderColor: '#1e293b',
    backgroundColor: '#0f172a',
  },
  actionBtnGhostText: { color: '#94a3b8', fontSize: 10, fontWeight: '900', letterSpacing: 0.6 },
  keyboardFocus: Platform.OS === 'web' ? ({
    outlineColor: '#f8fafc',
    outlineOffset: 2,
    outlineStyle: 'solid',
    outlineWidth: 2,
  } as any) : {},
});

const modalStyles = StyleSheet.create({
  scrim: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center', justifyContent: 'center', padding: 16,
  },
  card: {
    width: '100%', maxWidth: 480, borderRadius: 14,
    backgroundColor: '#0a0f1c', borderWidth: 1, borderColor: '#1e293b',
    padding: 16, gap: 16, zIndex: 1,
  },
  dismissBackdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 0,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: '#f8fafc', fontSize: 16, fontWeight: '800' },
  closeBtn: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#1e293b', backgroundColor: '#111827',
  },
  closeBtnText: { color: '#94a3b8', fontSize: 18, fontWeight: '900' },
  section: { gap: 8 },
  sectionLabel: { color: '#475569', fontSize: 10, fontWeight: '900', letterSpacing: 1.2 },
  empty: { color: '#64748b', fontSize: 12, paddingVertical: 8 },
  memberRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 6, paddingHorizontal: 8,
    borderRadius: 6, backgroundColor: '#111827',
  },
  memberName: { color: '#e2e8f0', fontSize: 13, fontWeight: '600' },
  ownerTag: { color: '#facc15', fontSize: 9, fontWeight: '900' },
  smallBtn: {
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 4, borderWidth: 1, borderColor: '#334155', backgroundColor: '#0f172a',
  },
  smallBtnText: { color: '#94a3b8', fontSize: 9, fontWeight: '900', letterSpacing: 0.4 },
  searchInput: {
    paddingHorizontal: 10, paddingVertical: 8, borderRadius: 6,
    borderWidth: 1, borderColor: '#1e293b', backgroundColor: '#111827',
    color: '#e2e8f0', fontSize: 13,
  },
  candidateRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 8, paddingHorizontal: 8, borderRadius: 6,
    borderBottomWidth: 1, borderBottomColor: '#1e293b',
  },
  candidateName: { color: '#e2e8f0', fontSize: 13 },
  candidateAdd: { color: '#6366f1', fontSize: 10, fontWeight: '900', letterSpacing: 0.6 },
});
