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

const PLAN_LABELS: Record<string, string> = {
  free: 'FREE',
  pro: 'PRO',
  business: 'BUSINESS',
  enterprise: 'ENTERPRISE',
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
            <View style={[styles.orgLogoPlaceholder, { backgroundColor: planColor + '20' }]}>
              <Text style={[styles.orgLogoText, { color: planColor }]}>
                {org.name.charAt(0).toUpperCase()}
              </Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.orgName} numberOfLines={1}>{org.name}</Text>
            <Text style={styles.orgSlug}>/{org.slug}</Text>
          </View>
        </View>
        <View style={[styles.planBadge, { backgroundColor: planColor + '20', borderColor: planColor + '60' }]}>
          <Text style={[styles.planText, { color: planColor }]}>
            {PLAN_LABELS[org.plan] || org.plan.toUpperCase()}
          </Text>
        </View>
      </View>

      {/* Stats row */}
      <View style={styles.orgStatsRow}>
        <View style={styles.orgStatItem}>
          <Text style={styles.orgStatNumber}>{org.member_count || 0}</Text>
          <Text style={styles.orgStatLabel}>Members</Text>
        </View>
        <View style={styles.orgStatDivider} />
        <View style={styles.orgStatItem}>
          <Text style={styles.orgStatNumber}>{org.circle_count || 0}</Text>
          <Text style={styles.orgStatLabel}>Circles</Text>
        </View>
        <View style={{ flex: 1 }} />
        <View style={styles.viewBtn}>
          <Text style={styles.viewBtnText}>View {'\u2192'}</Text>
        </View>
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
      console.error("Error fetching orgs:", err);
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
          <Text style={styles.backText}>{"\u2190"} Back</Text>
        </Pressable>
        <Text style={styles.title}>My Organizations</Text>
        <Pressable
          onPress={() => navigation.navigate("CreateOrg")}
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
            onPress={() => navigation.navigate("OrgDetail", { orgId: item.id, orgName: item.name })}
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
              <View style={styles.emptyIconBox}>
                <Text style={styles.emptyIcon}>{"\uD83C\uDFE2"}</Text>
              </View>
              <Text style={styles.emptyTitle}>No organizations yet</Text>
              <Text style={styles.emptyText}>
                Organizations let you manage multiple circles under one roof. Perfect for teams, companies, and communities.
              </Text>

              <View style={styles.emptyFeatures}>
                <View style={styles.emptyFeatureRow}>
                  <Text style={styles.emptyFeatureBullet}>{"\u2713"}</Text>
                  <Text style={styles.emptyFeatureText}>Centralized billing & member management</Text>
                </View>
                <View style={styles.emptyFeatureRow}>
                  <Text style={styles.emptyFeatureBullet}>{"\u2713"}</Text>
                  <Text style={styles.emptyFeatureText}>Shared circles with role-based access</Text>
                </View>
                <View style={styles.emptyFeatureRow}>
                  <Text style={styles.emptyFeatureBullet}>{"\u2713"}</Text>
                  <Text style={styles.emptyFeatureText}>Analytics & reporting across all circles</Text>
                </View>
                <View style={styles.emptyFeatureRow}>
                  <Text style={styles.emptyFeatureBullet}>{"\u2713"}</Text>
                  <Text style={styles.emptyFeatureText}>Custom branding & white-label options</Text>
                </View>
              </View>

              <Pressable
                onPress={() => navigation.navigate("CreateOrg")}
                style={styles.emptyCreateBtn}
              >
                <Text style={styles.emptyCreateBtnText}>Create Organization</Text>
              </Pressable>
            </View>
          ) : null
        }
        ListFooterComponent={
          orgs.length > 0 ? (
            <Pressable
              onPress={() => navigation.navigate("CreateOrg")}
              style={styles.footerCreateBtn}
            >
              <Text style={styles.footerCreateText}>+ Create Another Organization</Text>
            </Pressable>
          ) : null
        }
        contentContainerStyle={[styles.listContent, { maxWidth: 720, width: "100%", alignSelf: "center" as const }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000000" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#2a2a2a",
  },
  backBtn: { paddingRight: 12 },
  backText: { color: "#6366f1", fontSize: 14, fontFamily: "monospace" },
  title: { flex: 1, color: "#fff", fontSize: 18, fontWeight: "700", fontFamily: "monospace" },
  createBtn: {
    backgroundColor: "#6366f1",
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 6,
  },
  createBtnText: { color: "#fff", fontSize: 13, fontWeight: "600", fontFamily: "monospace" },
  listContent: { padding: 16 },
  orgCard: {
    backgroundColor: "#111",
    borderWidth: 1,
    borderColor: "#2a2a2a",
    borderRadius: 14,
    padding: 20,
    marginBottom: 14,
  },
  orgCardHovered: { borderColor: "#6366f1", backgroundColor: "#111827" },
  orgHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  orgNameRow: { flexDirection: "row", alignItems: "center", flex: 1, gap: 14 },
  orgLogo: { width: 48, height: 48, borderRadius: 12 },
  orgLogoPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  orgLogoText: { fontSize: 20, fontWeight: "700" },
  orgName: { color: "#fff", fontSize: 17, fontWeight: "700", fontFamily: "monospace" },
  orgSlug: { color: "#666", fontSize: 13, fontFamily: "monospace", marginTop: 2 },
  planBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  planText: { fontSize: 10, fontWeight: "800", fontFamily: "monospace", letterSpacing: 0.5 },
  orgStatsRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: "#1a1a1a",
    gap: 12,
  },
  orgStatItem: { alignItems: "center" },
  orgStatNumber: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
    fontFamily: "monospace",
  },
  orgStatLabel: {
    color: "#666",
    fontSize: 10,
    fontFamily: "monospace",
    marginTop: 2,
  },
  orgStatDivider: {
    width: 1,
    height: 28,
    backgroundColor: "#2a2a2a",
  },
  viewBtn: {
    backgroundColor: "#6366f120",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#6366f140",
  },
  viewBtnText: {
    color: "#6366f1",
    fontSize: 12,
    fontWeight: "600",
    fontFamily: "monospace",
  },
  emptyContainer: { alignItems: "center", paddingTop: 48, paddingHorizontal: 28 },
  emptyIconBox: {
    width: 80,
    height: 80,
    borderRadius: 20,
    backgroundColor: "#111",
    borderWidth: 1,
    borderColor: "#2a2a2a",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  emptyIcon: { fontSize: 36 },
  emptyTitle: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "800",
    fontFamily: "monospace",
    marginBottom: 10,
    textAlign: "center",
  },
  emptyText: {
    color: "#888",
    fontSize: 14,
    textAlign: "center",
    fontFamily: "monospace",
    lineHeight: 22,
    marginBottom: 24,
    maxWidth: 400,
  },
  emptyFeatures: {
    alignSelf: "stretch",
    backgroundColor: "#0a0a0a",
    borderWidth: 1,
    borderColor: "#1a1a1a",
    borderRadius: 12,
    padding: 18,
    marginBottom: 28,
    maxWidth: 400,
    width: "100%",
    alignItems: "flex-start",
  },
  emptyFeatureRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 10,
  },
  emptyFeatureBullet: {
    color: "#22c55e",
    fontSize: 14,
    fontWeight: "700",
    fontFamily: "monospace",
  },
  emptyFeatureText: {
    color: "#999",
    fontSize: 13,
    fontFamily: "monospace",
    flex: 1,
  },
  emptyCreateBtn: {
    backgroundColor: "#6366f1",
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 10,
  },
  emptyCreateBtnText: { color: "#fff", fontSize: 15, fontWeight: "700", fontFamily: "monospace" },
  footerCreateBtn: {
    borderWidth: 1,
    borderColor: "#2a2a2a",
    borderStyle: "dashed",
    borderRadius: 14,
    padding: 18,
    alignItems: "center",
    marginTop: 4,
    marginBottom: 20,
  },
  footerCreateText: {
    color: "#666",
    fontSize: 14,
    fontWeight: "600",
    fontFamily: "monospace",
  },
});
