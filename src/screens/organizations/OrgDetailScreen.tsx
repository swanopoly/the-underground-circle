import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  FlatList,
  Alert,
  Platform,
  Image,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useOrg } from '../../hooks/useOrg';
import {
  getOrgMembers,
  getOrgCircles,
  removeOrgMember,
  updateOrgMemberRole,
  type OrgMember,
} from '../../lib/organizations';
import { Circle } from '../../types';

type TabKey = 'circles' | 'members' | 'settings' | 'billing';

const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: 'circles', label: 'Circles', icon: '⭕' },
  { key: 'members', label: 'Members', icon: '👥' },
  { key: 'settings', label: 'Settings', icon: '⚙️' },
  { key: 'billing', label: 'Billing', icon: '💳' },
];

const PLAN_COLORS: Record<string, string> = {
  free: '#6b7280',
  pro: '#6366f1',
  business: '#f59e0b',
  enterprise: '#ec4899',
};

export default function OrgDetailScreen({ route, navigation }: any) {
  const { orgId, orgName } = route.params;
  const { org, features, role, loading, refresh, canManage } = useOrg(orgId);
  const [activeTab, setActiveTab] = useState<TabKey>('circles');
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [circles, setCircles] = useState<Circle[]>([]);
  const [dataLoading, setDataLoading] = useState(false);

  useFocusEffect(
    useCallback(() => {
      refresh();
      loadData();
    }, [orgId])
  );

  const loadData = async () => {
    setDataLoading(true);
    try {
      const [membersData, circlesData] = await Promise.all([
        getOrgMembers(orgId),
        getOrgCircles(orgId),
      ]);
      setMembers(membersData);
      setCircles(circlesData);
    } catch (err) {
      console.error('OrgDetail load error:', err);
    } finally {
      setDataLoading(false);
    }
  };

  const handleRemoveMember = async (userId: string, displayName: string) => {
    const doRemove = async () => {
      const { error } = await removeOrgMember(orgId, userId);
      if (error) {
        if (Platform.OS === 'web') alert(error);
        else Alert.alert('Error', error);
      } else {
        loadData();
      }
    };

    if (Platform.OS === 'web') {
      if (confirm(`Remove ${displayName} from the organization?`)) doRemove();
    } else {
      Alert.alert('Remove Member', `Remove ${displayName}?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: doRemove },
      ]);
    }
  };

  const handleRoleChange = async (userId: string, newRole: 'owner' | 'admin' | 'member') => {
    const { error } = await updateOrgMemberRole(orgId, userId, newRole);
    if (error) {
      if (Platform.OS === 'web') alert(error);
      else Alert.alert('Error', error);
    } else {
      loadData();
    }
  };

  const planColor = PLAN_COLORS[org?.plan || 'free'] || '#6b7280';

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.orgName}>{org?.name || orgName}</Text>
          <Text style={styles.orgSlug}>/{org?.slug}</Text>
        </View>
        <View style={[styles.planBadge, { backgroundColor: planColor + '20', borderColor: planColor + '60' }]}>
          <Text style={[styles.planText, { color: planColor }]}>{(org?.plan || 'free').toUpperCase()}</Text>
        </View>
      </View>

      {/* Tab bar */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabBar}>
        {TABS.map((tab) => (
          <Pressable
            key={tab.key}
            onPress={() => setActiveTab(tab.key)}
            style={[styles.tab, activeTab === tab.key && styles.tabActive]}
          >
            <Text style={styles.tabIcon}>{tab.icon}</Text>
            <Text style={[styles.tabLabel, activeTab === tab.key && styles.tabLabelActive]}>
              {tab.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Tab content */}
      <ScrollView style={styles.content} contentContainerStyle={{ paddingBottom: 40 }}>
        {activeTab === 'circles' && (
          <View>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Circles ({circles.length})</Text>
              {canManage && (
                <Pressable
                  onPress={() => navigation.navigate('CreateCircle', { orgId })}
                  style={styles.addBtn}
                >
                  <Text style={styles.addBtnText}>+ Add Circle</Text>
                </Pressable>
              )}
            </View>
            {circles.map((circle) => (
              <Pressable
                key={circle.id}
                onPress={() => navigation.navigate('CircleDetail', { circleId: circle.id, circleName: circle.name })}
                style={styles.listItem}
              >
                <View style={styles.circleIcon}>
                  <Text>{circle.icon || '⭕'}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemName}>{circle.name}</Text>
                  {circle.description ? (
                    <Text style={styles.itemSub} numberOfLines={1}>{circle.description}</Text>
                  ) : null}
                </View>
                <Text style={styles.arrowText}>→</Text>
              </Pressable>
            ))}
            {circles.length === 0 && !dataLoading && (
              <Text style={styles.emptyText}>No circles in this organization yet.</Text>
            )}
          </View>
        )}

        {activeTab === 'members' && (
          <View>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Members ({members.length})</Text>
              {canManage && (
                <Pressable style={styles.addBtn}>
                  <Text style={styles.addBtnText}>+ Invite</Text>
                </Pressable>
              )}
            </View>
            {members.map((member) => (
              <View key={member.id} style={styles.listItem}>
                <View style={styles.memberAvatar}>
                  {member.user?.avatar_url ? (
                    <Image source={{ uri: member.user.avatar_url }} style={{ width: 32, height: 32, borderRadius: 16 }} />
                  ) : (
                    <Text style={styles.memberAvatarText}>
                      {(member.user?.display_name || member.user?.username || '?').charAt(0).toUpperCase()}
                    </Text>
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemName}>
                    {member.user?.display_name || member.user?.username || 'Unknown'}
                  </Text>
                  <Text style={styles.itemSub}>@{member.user?.username}</Text>
                </View>
                <View style={[styles.roleBadge, member.role === 'owner' && styles.roleBadgeOwner, member.role === 'admin' && styles.roleBadgeAdmin]}>
                  <Text style={styles.roleText}>{member.role.toUpperCase()}</Text>
                </View>
                {canManage && member.role !== 'owner' && (
                  <Pressable
                    onPress={() => handleRemoveMember(member.user_id, member.user?.display_name || 'this member')}
                    style={styles.removeBtn}
                  >
                    <Text style={styles.removeBtnText}>×</Text>
                  </Pressable>
                )}
              </View>
            ))}
          </View>
        )}

        {activeTab === 'settings' && (
          <View>
            {canManage ? (
              <Pressable
                onPress={() => navigation.navigate('OrgSettings', { orgId })}
                style={styles.settingsBtn}
              >
                <Text style={styles.settingsBtnText}>Open Organization Settings</Text>
              </Pressable>
            ) : (
              <Text style={styles.emptyText}>Only admins and owners can change settings.</Text>
            )}

            <View style={styles.featureSection}>
              <Text style={styles.sectionTitle}>Plan Features</Text>
              {features && (
                <View style={styles.featureGrid}>
                  <FeatureRow label="Max Circles" value={features.max_circles >= 9999 ? 'Unlimited' : String(features.max_circles)} />
                  <FeatureRow label="Max Members/Circle" value={features.max_members_per_circle >= 9999 ? 'Unlimited' : String(features.max_members_per_circle)} />
                  <FeatureRow label="Analytics" value={features.analytics_enabled ? 'Yes' : 'No'} enabled={features.analytics_enabled} />
                  <FeatureRow label="Slack" value={features.slack_enabled ? 'Yes' : 'No'} enabled={features.slack_enabled} />
                  <FeatureRow label="MS Teams" value={features.teams_enabled ? 'Yes' : 'No'} enabled={features.teams_enabled} />
                  <FeatureRow label="SSO" value={features.sso_enabled ? 'Yes' : 'No'} enabled={features.sso_enabled} />
                  <FeatureRow label="Export" value={features.export_enabled ? 'Yes' : 'No'} enabled={features.export_enabled} />
                  <FeatureRow label="White Label" value={features.whitelabel_enabled ? 'Yes' : 'No'} enabled={features.whitelabel_enabled} />
                  <FeatureRow label="Goal Alignment" value={features.goal_alignment ? 'Yes' : 'No'} enabled={features.goal_alignment} />
                </View>
              )}
            </View>
          </View>
        )}

        {activeTab === 'billing' && (
          <View>
            <View style={styles.billingCard}>
              <Text style={styles.billingLabel}>Current Plan</Text>
              <Text style={[styles.billingPlan, { color: planColor }]}>
                {(org?.plan || 'free').toUpperCase()}
              </Text>
              <Text style={styles.billingStatus}>
                Status: {org?.subscription_status || 'active'}
              </Text>
              <Text style={styles.billingSeats}>
                Seats: {org?.seat_count || 1} | Members: {members.length}
              </Text>
            </View>
            {org?.plan === 'free' && (
              <Pressable style={styles.upgradeBtn}>
                <Text style={styles.upgradeBtnText}>Upgrade to Pro — $29/mo</Text>
              </Pressable>
            )}
            <Text style={styles.comingSoon}>
              Stripe billing integration coming soon.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function FeatureRow({ label, value, enabled }: { label: string; value: string; enabled?: boolean }) {
  return (
    <View style={styles.featureRow}>
      <Text style={styles.featureLabel}>{label}</Text>
      <Text style={[styles.featureValue, enabled === false && styles.featureDisabled]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
    gap: 12,
  },
  backBtn: { paddingRight: 4 },
  backText: { color: '#6366f1', fontSize: 14, fontFamily: 'monospace' },
  orgName: { color: '#fff', fontSize: 18, fontWeight: '700', fontFamily: 'monospace' },
  orgSlug: { color: '#888', fontSize: 12, fontFamily: 'monospace' },
  planBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  planText: { fontSize: 11, fontWeight: '700', fontFamily: 'monospace' },
  tabBar: {
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
    flexGrow: 0,
    paddingHorizontal: 8,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 6,
  },
  tabActive: {
    borderBottomWidth: 2,
    borderBottomColor: '#6366f1',
  },
  tabIcon: { fontSize: 14 },
  tabLabel: { color: '#888', fontSize: 13, fontFamily: 'monospace' },
  tabLabelActive: { color: '#fff' },
  content: { flex: 1, padding: 16 },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: { color: '#fff', fontSize: 15, fontWeight: '700', fontFamily: 'monospace' },
  addBtn: {
    backgroundColor: '#6366f1' + '20',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#6366f1' + '40',
  },
  addBtnText: { color: '#6366f1', fontSize: 12, fontFamily: 'monospace' },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    gap: 10,
  },
  circleIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#2a2a2a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#2a2a2a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberAvatarText: { color: '#6366f1', fontSize: 14, fontWeight: '700' },
  itemName: { color: '#fff', fontSize: 14, fontWeight: '600', fontFamily: 'monospace' },
  itemSub: { color: '#888', fontSize: 11, fontFamily: 'monospace' },
  roleBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: '#2a2a2a',
  },
  roleBadgeOwner: { backgroundColor: '#ec4899' + '20' },
  roleBadgeAdmin: { backgroundColor: '#6366f1' + '20' },
  roleText: { color: '#ccc', fontSize: 10, fontWeight: '700', fontFamily: 'monospace' },
  removeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#ef4444' + '20',
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeBtnText: { color: '#ef4444', fontSize: 18, fontWeight: '700' },
  arrowText: { color: '#555', fontSize: 16, fontFamily: 'monospace' },
  emptyText: { color: '#888', fontSize: 13, fontFamily: 'monospace', textAlign: 'center', paddingTop: 32 },
  settingsBtn: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
    marginBottom: 24,
  },
  settingsBtnText: { color: '#6366f1', fontSize: 14, fontWeight: '600', fontFamily: 'monospace' },
  featureSection: { marginTop: 8 },
  featureGrid: { marginTop: 8 },
  featureRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
  },
  featureLabel: { color: '#ccc', fontSize: 13, fontFamily: 'monospace' },
  featureValue: { color: '#22c55e', fontSize: 13, fontWeight: '600', fontFamily: 'monospace' },
  featureDisabled: { color: '#ef4444' },
  billingCard: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
  },
  billingLabel: { color: '#888', fontSize: 12, fontFamily: 'monospace', marginBottom: 4 },
  billingPlan: { fontSize: 24, fontWeight: '700', fontFamily: 'monospace', marginBottom: 8 },
  billingStatus: { color: '#ccc', fontSize: 13, fontFamily: 'monospace', marginBottom: 4 },
  billingSeats: { color: '#888', fontSize: 12, fontFamily: 'monospace' },
  upgradeBtn: {
    backgroundColor: '#6366f1',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 12,
  },
  upgradeBtnText: { color: '#fff', fontSize: 15, fontWeight: '700', fontFamily: 'monospace' },
  comingSoon: { color: '#555', fontSize: 12, fontFamily: 'monospace', textAlign: 'center', marginTop: 8 },
});
