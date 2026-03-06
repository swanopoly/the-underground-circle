import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  Pressable,
  RefreshControl,
  Image,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getMyOrganizations, type OrgWithCounts } from '../../lib/organizations';

const PLAN_COLORS: Record<string, string> = {
  free: '#6b7280',
  pro: '#6366f1',
  business: '#f59e0b',
  enterprise: '#ec4899',
};

function OrgCard({ org, onPress }: { org: OrgWithCounts; onPress: () => void }) {
  const [hovered, setHovered] = useState(false);
  const planColor = PLAN_COLORS[org.plan] || '#6b7280';

  return (
    <Pressable
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={[styles.orgCard, hovered && styles.orgCardHovered]}
    >
      <View style={styles.orgHeader}>
        <View style={styles.orgNameRow}>
          {org.logo_url ? (
            <Image source={{ uri: org.logo_url }} style={styles.orgLogo} />
          ) : (
            <View style={styles.orgLogoPlaceholder}>
              <Text style={styles.orgLogoText}>{org.name.charAt(0).toUpperCase()}</Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.orgName}>{org.name}</Text>
            <Text style={styles.orgSlug}>/{org.slug}</Text>
          </View>
        </View>
        <View style={[styles.planBadge, { backgroundColor: planColor + '20', borderColor: planColor + '60' }]}>
          <Text style={[styles.planText, { color: planColor }]}>{org.plan.toUpperCase()}</Text>
        </View>
      </View>
      <View style={styles.orgStats}>
        <Text style={styles.statText}>{org.member_count || 0} members</Text>
        <Text style={styles.statDot}>&middot;</Text>
        <Text style={styles.statText}>{org.circle_count || 0} circles</Text>
        <View style={{ flex: 1 }} />
        <Text style={styles.arrowText}>→</Text>
      </View>
    </Pressable>
  );
}

export default function OrgListScreen({ navigation }: any) {
  const [orgs, setOrgs] = useState<OrgWithCounts[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchOrgs = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getMyOrganizations();
      setOrgs(data);
    } catch (err) {
      console.error('Error fetching orgs:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchOrgs();
    }, [fetchOrgs])
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </Pressable>
        <Text style={styles.title}>My Organizations</Text>
        <Pressable
          onPress={() => navigation.navigate('CreateOrg')}
          style={styles.createBtn}
        >
          <Text style={styles.createBtnText}>+ New</Text>
        </Pressable>
      </View>

      <FlatList
        data={orgs}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <OrgCard
            org={item}
            onPress={() => navigation.navigate('OrgDetail', { orgId: item.id, orgName: item.name })}
          />
        )}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={fetchOrgs}
            tintColor="#6366f1"
          />
        }
        ListEmptyComponent={
          !loading ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyIcon}>🏢</Text>
              <Text style={styles.emptyTitle}>No organizations yet</Text>
              <Text style={styles.emptyText}>
                Create an organization to manage multiple circles, invite your team, and unlock business features.
              </Text>
              <Pressable
                onPress={() => navigation.navigate('CreateOrg')}
                style={styles.emptyCreateBtn}
              >
                <Text style={styles.emptyCreateBtnText}>Create Organization</Text>
              </Pressable>
            </View>
          ) : null
        }
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a2e',
  },
  backBtn: { paddingRight: 12 },
  backText: { color: '#6366f1', fontSize: 14, fontFamily: 'monospace' },
  title: { flex: 1, color: '#fff', fontSize: 18, fontWeight: '700', fontFamily: 'monospace' },
  createBtn: {
    backgroundColor: '#6366f1',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 6,
  },
  createBtnText: { color: '#fff', fontSize: 13, fontWeight: '600', fontFamily: 'monospace' },
  listContent: { padding: 16 },
  orgCard: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#1a1a2e',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  orgCardHovered: { borderColor: '#6366f1', backgroundColor: '#111827' },
  orgHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  orgNameRow: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 12 },
  orgLogo: { width: 40, height: 40, borderRadius: 10 },
  orgLogoPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#6366f1' + '20',
    alignItems: 'center',
    justifyContent: 'center',
  },
  orgLogoText: { color: '#6366f1', fontSize: 18, fontWeight: '700' },
  orgName: { color: '#fff', fontSize: 16, fontWeight: '600', fontFamily: 'monospace' },
  orgSlug: { color: '#888', fontSize: 12, fontFamily: 'monospace' },
  planBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  planText: { fontSize: 10, fontWeight: '700', fontFamily: 'monospace' },
  orgStats: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    gap: 6,
  },
  statText: { color: '#888', fontSize: 12, fontFamily: 'monospace' },
  statDot: { color: '#555', fontSize: 12 },
  arrowText: { color: '#555', fontSize: 16, fontFamily: 'monospace' },
  emptyContainer: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 32 },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyTitle: { color: '#fff', fontSize: 18, fontWeight: '700', fontFamily: 'monospace', marginBottom: 8 },
  emptyText: { color: '#888', fontSize: 13, textAlign: 'center', fontFamily: 'monospace', lineHeight: 20 },
  emptyCreateBtn: {
    marginTop: 24,
    backgroundColor: '#6366f1',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  emptyCreateBtnText: { color: '#fff', fontSize: 14, fontWeight: '600', fontFamily: 'monospace' },
});
