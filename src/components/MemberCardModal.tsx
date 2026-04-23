/**
 * MemberCardModal — lightweight profile popup for when an @user mention is
 * clicked. Resolves the profile row in the background and shows a small
 * card: avatar, display name, username, bio, streak, recent activity summary.
 *
 * Style: Feed dashboard surface language. Slate card, 1px borders, rounded.
 */

import React, { useEffect, useState } from "react";
import { View, Text, Modal, Pressable, StyleSheet, Platform, Image } from "react-native";
import { supabase } from "../lib/supabase";

interface Props {
  userId: string | null;
  onClose: () => void;
}

interface ProfileRow {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  current_streak: number | null;
  longest_streak: number | null;
}

export default function MemberCardModal({ userId, onClose }: Props) {
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!userId) { setProfile(null); return; }
    setLoading(true);
    setProfile(null);
    supabase
      .from("profiles")
      .select("id, username, display_name, avatar_url, bio, current_streak, longest_streak")
      .eq("id", userId)
      .single()
      .then(({ data }) => {
        if (cancelled) return;
        setProfile(data as ProfileRow);
        setLoading(false);
      }, () => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [userId]);

  if (!userId) return null;
  const initials = ((profile?.display_name || profile?.username || "?")
    .split(/\s+/).map((n) => n[0]).filter(Boolean).slice(0, 2).join("") || "?").toUpperCase();

  return (
    <Modal visible={!!userId} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.overlay} onPress={onClose}>
        <Pressable style={s.card} onPress={(e) => e.stopPropagation()}>
          <View style={s.header}>
            {profile?.avatar_url ? (
              <Image source={{ uri: profile.avatar_url }} style={s.avatar} />
            ) : (
              <View style={s.avatarFallback}>
                <Text style={s.avatarText}>{initials}</Text>
              </View>
            )}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={s.displayName} numberOfLines={1}>
                {profile?.display_name || profile?.username || (loading ? "Loading…" : "Unknown member")}
              </Text>
              {profile?.username && (
                <Text style={s.username} numberOfLines={1}>@{profile.username}</Text>
              )}
            </View>
            <Pressable onPress={onClose} style={s.closeBtn}>
              <Text style={s.closeText}>×</Text>
            </Pressable>
          </View>

          {profile?.bio ? (
            <Text style={s.bio}>{profile.bio}</Text>
          ) : null}

          {(profile?.current_streak ?? 0) > 0 || (profile?.longest_streak ?? 0) > 0 ? (
            <View style={s.statsRow}>
              <Stat label="CURRENT" value={`${profile?.current_streak ?? 0}d`} accent="#22c55e" />
              <Stat label="LONGEST" value={`${profile?.longest_streak ?? 0}d`} accent="#f59e0b" />
            </View>
          ) : null}

          {loading && !profile ? (
            <Text style={s.loading}>Loading profile…</Text>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <View style={[s.statBox, { borderColor: accent + "40" }]}>
      <Text style={[s.statValue, { color: accent }]}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(3, 7, 18, 0.78)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  card: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: "#111827",
    borderWidth: 1,
    borderColor: "#1f2937",
    borderRadius: 16,
    padding: 18,
    gap: 12,
    ...(Platform.OS === "web" ? { boxShadow: "0 20px 60px rgba(0,0,0,0.5)" } as any : {}),
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#0f172a",
  },
  avatarFallback: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#1f2937",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: "#e5eefc",
    fontSize: 20,
    fontWeight: "700",
  },
  displayName: {
    color: "#e5eefc",
    fontSize: 18,
    fontWeight: "700",
  },
  username: {
    color: "#64748b",
    fontSize: 12,
    fontWeight: "600",
    marginTop: 2,
  },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#243041",
    backgroundColor: "#0f172a",
    alignItems: "center",
    justifyContent: "center",
  },
  closeText: {
    color: "#94a3b8",
    fontSize: 18,
    fontWeight: "700",
  },
  bio: {
    color: "#cbd5e1",
    fontSize: 13,
    lineHeight: 18,
  },
  statsRow: {
    flexDirection: "row",
    gap: 8,
  },
  statBox: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    backgroundColor: "#0f172a",
    alignItems: "center",
    gap: 4,
  },
  statValue: {
    fontSize: 20,
    fontWeight: "800",
    fontFamily: "monospace",
  },
  statLabel: {
    color: "#64748b",
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1.2,
  },
  loading: {
    color: "#64748b",
    fontSize: 12,
    fontWeight: "500",
    textAlign: "center",
  },
});
