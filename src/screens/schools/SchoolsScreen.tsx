import React from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Platform } from 'react-native';

export default function SchoolsScreen({ navigation }: any) {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>{'\u2190'} Back</Text>
        </Pressable>
        <Text style={styles.title}>For Schools</Text>
      </View>

      <ScrollView style={styles.content} contentContainerStyle={{ paddingBottom: 60 }}>
        <View style={styles.hero}>
          <Text style={styles.heroIcon}>🎓</Text>
          <Text style={styles.heroTitle}>The Underground Circle for Education</Text>
          <Text style={styles.heroSub}>
            Accountability circles designed for classrooms, study groups, and school organizations.
          </Text>
        </View>

        <View style={styles.featureCard}>
          <Text style={styles.featureIcon}>👩‍🏫</Text>
          <Text style={styles.featureTitle}>Classroom Circles</Text>
          <Text style={styles.featureDesc}>
            Teachers create circles for their class. Students check in daily, track goals, and build accountability habits together.
          </Text>
        </View>

        <View style={styles.featureCard}>
          <Text style={styles.featureIcon}>📊</Text>
          <Text style={styles.featureTitle}>Teacher Dashboard</Text>
          <Text style={styles.featureDesc}>
            Monitor student engagement, streak data, and participation. Identify students who need support early.
          </Text>
        </View>

        <View style={styles.featureCard}>
          <Text style={styles.featureIcon}>🤖</Text>
          <Text style={styles.featureTitle}>AI Study Assistant</Text>
          <Text style={styles.featureDesc}>
            BlackSwan AI helps students with homework, study plans, and test prep — all within a safe, monitored environment.
          </Text>
        </View>

        <View style={styles.featureCard}>
          <Text style={styles.featureIcon}>🔒</Text>
          <Text style={styles.featureTitle}>Safe & Private</Text>
          <Text style={styles.featureDesc}>
            COPPA-compliant. No ads, no data selling. Teachers control visibility, permissions, and AI access levels.
          </Text>
        </View>

        <View style={styles.featureCard}>
          <Text style={styles.featureIcon}>🏆</Text>
          <Text style={styles.featureTitle}>Gamified Learning</Text>
          <Text style={styles.featureDesc}>
            XP, streaks, leaderboards, and badges motivate students to stay on track and celebrate each other's wins.
          </Text>
        </View>

        <View style={styles.ctaBox}>
          <Text style={styles.ctaTitle}>Coming Soon</Text>
          <Text style={styles.ctaText}>
            We're building the education experience. Interested in bringing The Underground Circle to your school?
          </Text>
          <Pressable style={styles.ctaBtn} onPress={() => {}}>
            <Text style={styles.ctaBtnText}>Join the Waitlist</Text>
          </Pressable>
        </View>
      </ScrollView>
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
  },
  backBtn: { paddingRight: 12 },
  backText: { color: '#6366f1', fontSize: 14, fontFamily: 'monospace' },
  title: { color: '#fff', fontSize: 18, fontWeight: '700', fontFamily: 'monospace' },
  content: { padding: 20 },
  hero: {
    alignItems: 'center',
    paddingVertical: 24,
    marginBottom: 20,
  },
  heroIcon: { fontSize: 48, marginBottom: 12 },
  heroTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '800',
    fontFamily: 'monospace',
    textAlign: 'center',
    marginBottom: 8,
  },
  heroSub: {
    color: '#888',
    fontSize: 13,
    fontFamily: 'monospace',
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 360,
  },
  featureCard: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  featureIcon: { fontSize: 24, marginBottom: 8 },
  featureTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    fontFamily: 'monospace',
    marginBottom: 6,
  },
  featureDesc: {
    color: '#888',
    fontSize: 12,
    fontFamily: 'monospace',
    lineHeight: 18,
  },
  ctaBox: {
    backgroundColor: '#0d0d1a',
    borderWidth: 1,
    borderColor: '#22c55e40',
    borderRadius: 14,
    padding: 24,
    marginTop: 12,
    alignItems: 'center',
  },
  ctaTitle: {
    color: '#22c55e',
    fontSize: 16,
    fontWeight: '800',
    fontFamily: 'monospace',
    marginBottom: 8,
  },
  ctaText: {
    color: '#888',
    fontSize: 12,
    fontFamily: 'monospace',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 16,
  },
  ctaBtn: {
    backgroundColor: '#22c55e',
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 10,
  },
  ctaBtnText: {
    color: '#000',
    fontSize: 14,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
});
