/**
 * ChatThreadHeader
 *
 * Strip above the chat composer that shows the active thread's title,
 * visibility badge, and invite/leave actions. Tapping the title opens a
 * lightweight rename inline. Tapping Invite opens the InviteToThreadModal.
 */

import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
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
import { SESSION_DELEGATION_MODE_OPTIONS, SESSION_PROFILE_OPTIONS, type SessionCodingProfile, type SessionDelegationMode } from '../../../../lib/chatSessionProfile';
import { supabase } from '../../../../lib/supabase';
import OpenSwanServiceMenu from './OpenSwanServiceMenu';
import SkillAdminPanel from './SkillAdminPanel';
import { soulKeyForProfile } from '../../../../lib/serviceProfileSouls';
import { copyToClipboard } from '../../../../lib/dataExport';

function shortModelLabel(modelId: string): string {
  const part = modelId.split('/').pop() || modelId;
  return part
    .replace(/:[a-z0-9_-]+$/i, '')
    .replace(/\b(20\d{4,6})\b/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b(\w)/g, (c) => c.toUpperCase())
    .replace(/\bClaude\s*/i, '')
    .replace(/\bGpt\b/i, 'GPT')
    .trim()
    .slice(0, 22);
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
  selectedModel?: string;
  sessionProfile?: SessionCodingProfile;
  delegationMode?: SessionDelegationMode;
  onSessionProfileChange?: (profile: SessionCodingProfile) => void;
  onDelegationModeChange?: (mode: SessionDelegationMode) => void;
  onOpenControlPanel?: () => void;
  onOpenRunHistory?: () => void;
  resolvedAutoModel?: string | null;
  /** WHY Auto picked that model — one short clause shown next to the id
   *  (P11 transparency: Cursor shows the model, we show the reason). */
  autoModelReason?: string | null;
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

export default function ChatThreadHeader({
  threadId,
  circleId,
  currentUserId,
  openswanGatewayNotice = null,
  onDisableOpenSwanGateway,
  onRetryOpenSwanGateway,
  refreshToken = 0,
  onThreadUpdated,
  selectedModel = 'auto',
  sessionProfile = 'senior',
  delegationMode = 'auto',
  onSessionProfileChange,
  onDelegationModeChange,
  onOpenControlPanel,
  onOpenRunHistory,
  resolvedAutoModel,
  autoModelReason,
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
    let cancelled = false;
    Promise.all([getThread(threadId), listThreadMembers(threadId)])
      .then(([t, ms]) => {
        if (cancelled) return;
        setThread(t);
        setMembers(ms);
      })
      .catch(err => console.warn('[ChatThreadHeader] load failed:', err));
    return () => { cancelled = true; };
  }, [threadId, refreshToken]);

  if (!thread) return null;

  const isOwner = !!currentUserId && thread.created_by === currentUserId;
  const isCircleThread = thread.visibility === 'circle';
  const visibilityLabel =
    thread.visibility === 'circle' ? 'CIRCLE'
    : thread.visibility === 'shared' ? `SHARED · ${members.length}`
    : 'PRIVATE';
  const visibilityTone =
    thread.visibility === 'circle' ? '#f59e0b'
    : thread.visibility === 'shared' ? '#f59e0b'
    : '#94a3b8';
  const currentProfile = SESSION_PROFILE_OPTIONS.find(option => option.id === sessionProfile) || SESSION_PROFILE_OPTIONS[0];
  const currentDelegationMode = SESSION_DELEGATION_MODE_OPTIONS.find(option => option.id === delegationMode) || SESSION_DELEGATION_MODE_OPTIONS[0];
  const isAllAuto = currentProfile.id === 'auto' && currentDelegationMode.id === 'auto';

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
              <Pressable onPress={() => setShowServiceMenu(true)} style={styles.gatewayActionBtn}>
                <Text style={styles.gatewayActionText}>SERVICE</Text>
              </Pressable>
              <Pressable
                onPress={async () => {
                  const ok = await copyToClipboard(openswanGatewayNotice.fixCommand || 'openswan gateway start');
                  setCopiedGatewayCmd(ok);
                  if (ok) setTimeout(() => setCopiedGatewayCmd(false), 1800);
                }}
                style={styles.gatewayActionBtn}
              >
                <Text style={styles.gatewayActionText}>{copiedGatewayCmd ? 'COPIED' : (openswanGatewayNotice.fixLabel || 'COPY FIX')}</Text>
              </Pressable>
              {onRetryOpenSwanGateway ? (
                <Pressable
                  disabled={retryingGateway}
                  onPress={async () => {
                    try {
                      setRetryingGateway(true);
                      await onRetryOpenSwanGateway();
                    } finally {
                      setRetryingGateway(false);
                    }
                  }}
                  style={[styles.gatewayActionBtn, retryingGateway && styles.gatewayActionBtnDisabled]}
                >
                  <Text style={styles.gatewayActionText}>{retryingGateway ? 'RETRYING…' : 'RETRY LOCAL'}</Text>
                </Pressable>
              ) : null}
              {onDisableOpenSwanGateway ? (
                <Pressable
                  disabled={disablingGateway}
                  onPress={async () => {
                    try {
                      setDisablingGateway(true);
                      await onDisableOpenSwanGateway();
                    } finally {
                      setDisablingGateway(false);
                    }
                  }}
                  style={[styles.gatewayActionBtn, disablingGateway && styles.gatewayActionBtnDisabled]}
                >
                  <Text style={styles.gatewayActionText}>{disablingGateway ? 'DISABLING…' : 'DISABLE LOCAL'}</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          {(onSessionProfileChange || onDelegationModeChange) && (
            <Pressable onPress={() => setShowServiceMenu(true)} style={styles.serviceBtn}>
              {isAllAuto ? (
                resolvedAutoModel ? (
                  <>
                    <Text style={[styles.serviceBtnTag, { color: '#f59e0b' }]}>Auto</Text>
                    <Text style={[styles.serviceBtnSep]}>→</Text>
                    <Text style={[styles.serviceBtnTag, { color: '#94a3b8' }]}>{shortModelLabel(resolvedAutoModel)}</Text>
                    {autoModelReason ? (
                      <Text style={[styles.serviceBtnTag, { color: '#64748b' }]} numberOfLines={1}>
                        · {autoModelReason}
                      </Text>
                    ) : null}
                    <Text style={styles.serviceBtnCaret}>▾</Text>
                  </>
                ) : (
                  <Text style={[styles.serviceBtnTag, { color: '#f59e0b' }]}>Auto ▾</Text>
                )
              ) : (
                <>
                  <Text style={[styles.serviceBtnTag, { color: currentProfile.color }]}>{currentProfile.shortLabel}</Text>
                  <Text style={styles.serviceBtnSep}>·</Text>
                  <Text style={[styles.serviceBtnTag, { color: currentDelegationMode.color }]}>{currentDelegationMode.shortLabel}</Text>
                  <Text style={styles.serviceBtnCaret}>▾</Text>
                </>
              )}
            </Pressable>
          )}
        </View>
      </View>

      <View style={styles.actions}>
        {!isCircleThread && (
          <Pressable onPress={onOpenRunHistory} style={styles.actionBtnGhost}>
            <Text style={styles.actionBtnGhostText}>RUNS</Text>
          </Pressable>
        )}
        {!isCircleThread && (
          <Pressable onPress={() => setShowInvite(true)} style={styles.actionBtn}>
            <Text style={styles.actionBtnText}>{isOwner ? '+ INVITE' : 'MEMBERS'}</Text>
          </Pressable>
        )}
        {!isCircleThread && isOwner && (
          <Pressable
            onPress={async () => {
              try {
                await archiveThread(thread.id);
              } catch (err) {
                console.warn('[ChatThreadHeader] archive failed:', err);
              } finally {
                onThreadUpdated?.();
              }
            }}
            style={styles.actionBtnGhost}
          >
            <Text style={styles.actionBtnGhostText}>ARCHIVE</Text>
          </Pressable>
        )}
      </View>

      <OpenSwanServiceMenu
        visible={showServiceMenu}
        sessionProfile={sessionProfile}
        delegationMode={delegationMode}
        onSessionProfileChange={(p) => onSessionProfileChange?.(p)}
        onDelegationModeChange={(m) => onDelegationModeChange?.(m)}
        onOpenControlPanel={onOpenControlPanel}
        onOpenSkills={() => setShowSkills(true)}
        onClose={() => setShowServiceMenu(false)}
      />

      <SkillAdminPanel
        visible={showSkills}
        circleId={circleId}
        soulKey={soulKeyForProfile(sessionProfile)}
        userId={currentUserId || ''}
        onClose={() => setShowSkills(false)}
      />

      {showInvite && (
        <InviteToThreadModal
          threadId={thread.id}
          circleId={circleId}
          currentUserId={currentUserId}
          isOwner={isOwner}
          members={members}
          onClose={() => setShowInvite(false)}
          onMembersChanged={async () => {
            try { setMembers(await listThreadMembers(thread.id)); } catch {}
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
          .select('user:profiles(id, display_name, username)')
          .eq('circle_id', circleId);
        if (cancelled) return;
        const opts: CircleMemberOption[] = (data || [])
          .map((r: any) => r.user)
          .filter(Boolean);
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
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={modalStyles.scrim} onPress={onClose}>
        <Pressable style={modalStyles.card} onPress={(e) => e.stopPropagation()}>
          <View style={modalStyles.header}>
            <Text style={modalStyles.title}>{isOwner ? 'Invite to this thread' : 'Thread members'}</Text>
            <Pressable onPress={onClose} style={modalStyles.closeBtn}>
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
                    >
                      <Text style={modalStyles.smallBtnText}>REMOVE</Text>
                    </Pressable>
                  )}
                  {(!isOwner && m.user_id === currentUserId) && (
                    <Pressable
                      onPress={async () => {
                        setBusy(true);
                        try { await leaveThread(threadId); onMembersChanged(); onClose(); }
                        catch (err) { console.warn('[InviteToThreadModal] leave failed:', err); }
                        finally { setBusy(false); }
                      }}
                      style={modalStyles.smallBtn}
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
        </Pressable>
      </Pressable>
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
  serviceBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 6, borderWidth: 1, borderColor: '#1e293b',
    backgroundColor: '#0b1220',
  },
  serviceBtnLabel: { color: '#94a3b8', fontSize: 9, fontWeight: '900', letterSpacing: 1, fontFamily: 'monospace' },
  serviceBtnTag: { fontSize: 9, fontWeight: '900', letterSpacing: 0.6, fontFamily: 'monospace' },
  serviceBtnSep: { color: '#475569', fontSize: 9, fontWeight: '900' },
  serviceBtnCaret: { color: '#64748b', fontSize: 9, fontWeight: '900' },
  actions: { flexDirection: 'row', gap: 6 },
  actionBtn: {
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 6, borderWidth: 1, borderColor: '#22d3ee',
    backgroundColor: '#0e2030',
  },
  actionBtnText: { color: '#22d3ee', fontSize: 10, fontWeight: '900', letterSpacing: 0.6 },
  actionBtnGhost: {
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 6, borderWidth: 1, borderColor: '#1e293b',
    backgroundColor: '#0f172a',
  },
  actionBtnGhostText: { color: '#94a3b8', fontSize: 10, fontWeight: '900', letterSpacing: 0.6 },
});

const modalStyles = StyleSheet.create({
  scrim: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center', justifyContent: 'center', padding: 16,
  },
  card: {
    width: '100%', maxWidth: 480, borderRadius: 14,
    backgroundColor: '#0a0f1c', borderWidth: 1, borderColor: '#1e293b',
    padding: 16, gap: 16,
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
  candidateAdd: { color: '#22d3ee', fontSize: 10, fontWeight: '900', letterSpacing: 0.6 },
});
