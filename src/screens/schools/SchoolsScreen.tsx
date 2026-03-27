import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Platform, Alert } from 'react-native';

const FEATURES = [
  {
    icon: '\uD83D\uDC69\u200D\uD83C\uDFEB',
    title: 'Classroom Circles',
    desc: 'Teachers create circles for their class. Students check in daily, track goals, and build accountability habits together.',
  },
  {
    icon: '\uD83D\uDCCA',
    title: 'Teacher Dashboard',
    desc: 'Monitor student engagement, streak data, and participation. Identify students who need support early.',
  },
  {
    icon: '\uD83E\uDD16',
    title: 'AI Study Assistant',
    desc: 'BlackSwan AI helps students with homework, study plans, and test prep \u2014 all within a safe, monitored environment.',
  },
  {
    icon: '\uD83D\uDD12',
    title: 'Safe & Private',
    desc: 'COPPA-compliant. No ads, no data selling. Teachers control visibility, permissions, and AI access levels.',
  },
  {
    icon: '\uD83C\uDFC6',
    title: 'Gamified Learning',
    desc: 'XP, streaks, leaderboards, and badges motivate students to stay on track and celebrate each other\u2019s wins.',
  },
  {
    icon: '\uD83D\uDCDA',
    title: 'Study Groups',
    desc: 'Students form private study circles for specific subjects. Share notes, set group goals, and hold each other accountable before exams.',
  },
  {
    icon: '\uD83D\uDD2C',
    title: 'Research Teams',
    desc: 'Graduate students and research labs can coordinate projects, share milestones, and track thesis progress together.',
  },
  {
    icon: '\uD83C\uDFE2',
    title: 'Campus Organizations',
    desc: 'Clubs, Greek life, student government \u2014 any campus org can use circles to manage members, events, and initiatives.',
  },
];

export default function SchoolsScreen({ navigation }: any) {
  const [requestSent, setRequestSent] = useState(false);

  const handleRequestAccess = () => {
    if (Platform.OS === 'web') {
      window.alert('Thanks! We will be in touch when the education beta opens.');
    } else {
      Alert.alert(
        'Request Received',
        'Thanks! We will be in touch when the education beta opens.',
        [{ text: 'OK' }]
      );
    }
    setRequestSent(true);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>{'\u2190'} Back</Text>
        </Pressable>
        <Text style={styles.title}>For Schools</Text>
        <View style={styles.comingSoonBadge}>
          <Text style={styles.comingSoonText}>COMING SOON</Text>
        </View>
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        <View style={styles.pageWrapper}>
          {/* Hero */}
          <View style={styles.hero}>
            <Text style={styles.heroIcon}>{'\uD83C\uDF93'}</Text>
            <Text style={styles.heroTitle}>The Underground Circle{'\n'}for Education</Text>
            <Text style={styles.heroSub}>
              Accountability circles designed for classrooms, study groups, and school organizations. Empower students to build habits that last.
            </Text>
          </View>

          {/* Stats row */}
          <View style={styles.statsRow}>
            <View style={styles.statBox}>
              <Text style={styles.statNumber}>500+</Text>
              <Text style={styles.statLabel}>Schools Interested</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statNumber}>K-12</Text>
              <Text style={styles.statLabel}>& Universities</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statNumber}>100%</Text>
              <Text style={styles.statLabel}>COPPA Compliant</Text>
            </View>
          </View>

          {/* Section title */}
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Platform Features</Text>
            <Text style={styles.sectionSub}>Everything your school needs to build accountability culture</Text>
          </View>

          {/* Feature cards */}
          {FEATURES.map((f, i) => (
            <View key={i} style={styles.featureCard}>
              <View style={styles.featureRow}>
                <View style={styles.featureIconBox}>
                  <Text style={styles.featureIcon}>{f.icon}</Text>
                </View>
                <View style={styles.featureContent}>
                  <Text style={styles.featureTitle}>{f.title}</Text>
                  <Text style={styles.featureDesc}>{f.desc}</Text>
                </View>
              </View>
            </View>
          ))}

          {/* CTA Box */}
          <View style={styles.ctaBox}>
            <View style={styles.ctaBadge}>
              <Text style={styles.ctaBadgeText}>BETA PROGRAM</Text>
            </View>
            <Text style={styles.ctaTitle}>Bring TUC to Your School</Text>
            <Text style={styles.ctaText}>
              We are building the education experience and looking for pilot schools to shape the product. Get early access, dedicated support, and a free year of the platform.
            </Text>
            <Pressable
              style={[styles.ctaBtn, requestSent && styles.ctaBtnSent]}
              onPress={handleRequestAccess}
              disabled={requestSent}
            >
              <Text style={[styles.ctaBtnText, requestSent && styles.ctaBtnTextSent]}>
                {requestSent ? 'Request Sent!' : 'Request Early Access'}
              </Text>
            </Pressable>
            <Text style={styles.ctaFootnote}>No commitment required. We will reach out to discuss your needs.</Text>
          </View>
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
  title: { color: '#fff', fontSize: 18, fontWeight: '700', fontFamily: 'monospace', flex: 1 },
  comingSoonBadge: {
    backgroundColor: '#22c55e20',
    borderWidth: 1,
    borderColor: '#22c55e60',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  comingSoonText: {
    color: '#22c55e',
    fontSize: 10,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 1,
  },
  scrollView: { flex: 1 },
  scrollContent: { paddingBottom: 60 },
  pageWrapper: {
    maxWidth: 720,
    width: '100%',
    alignSelf: 'center',
    padding: 20,
  },
  hero: {
    alignItems: 'center',
    paddingVertical: 32,
    marginBottom: 8,
  },
  heroIcon: { fontSize: 56, marginBottom: 16 },
  heroTitle: {
    color: '#fff',
    fontSize: 26,
    fontWeight: '800',
    fontFamily: 'monospace',
    textAlign: 'center',
    marginBottom: 12,
    lineHeight: 36,
  },
  heroSub: {
    color: '#999',
    fontSize: 15,
    fontFamily: 'monospace',
    textAlign: 'center',
    lineHeight: 24,
    maxWidth: 520,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 32,
    backgroundColor: '#0a0a1a',
    borderWidth: 1,
    borderColor: '#1a1a3a',
    borderRadius: 14,
    padding: 20,
  },
  statBox: { alignItems: 'center' },
  statNumber: {
    color: '#6366f1',
    fontSize: 22,
    fontWeight: '800',
    fontFamily: 'monospace',
    marginBottom: 4,
  },
  statLabel: {
    color: '#888',
    fontSize: 11,
    fontFamily: 'monospace',
  },
  sectionHeader: {
    marginBottom: 20,
  },
  sectionTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '800',
    fontFamily: 'monospace',
    marginBottom: 6,
  },
  sectionSub: {
    color: '#666',
    fontSize: 13,
    fontFamily: 'monospace',
  },
  featureCard: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 12,
    padding: 18,
    marginBottom: 12,
  },
  featureRow: {
    flexDirection: 'row',
    gap: 14,
  },
  featureIconBox: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#1a1a2e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureIcon: { fontSize: 22 },
  featureContent: { flex: 1 },
  featureTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    fontFamily: 'monospace',
    marginBottom: 6,
  },
  featureDesc: {
    color: '#888',
    fontSize: 13,
    fontFamily: 'monospace',
    lineHeight: 20,
  },
  ctaBox: {
    backgroundColor: '#0d0d1a',
    borderWidth: 1,
    borderColor: '#22c55e40',
    borderRadius: 16,
    padding: 28,
    marginTop: 20,
    alignItems: 'center',
  },
  ctaBadge: {
    backgroundColor: '#22c55e15',
    borderWidth: 1,
    borderColor: '#22c55e40',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 4,
    marginBottom: 16,
  },
  ctaBadgeText: {
    color: '#22c55e',
    fontSize: 10,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 1.5,
  },
  ctaTitle: {
    color: '#22c55e',
    fontSize: 20,
    fontWeight: '800',
    fontFamily: 'monospace',
    marginBottom: 10,
    textAlign: 'center',
  },
  ctaText: {
    color: '#999',
    fontSize: 14,
    fontFamily: 'monospace',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 20,
    maxWidth: 480,
  },
  ctaBtn: {
    backgroundColor: '#22c55e',
    paddingVertical: 14,
    paddingHorizontal: 36,
    borderRadius: 10,
    marginBottom: 12,
  },
  ctaBtnSent: {
    backgroundColor: '#22c55e30',
    borderWidth: 1,
    borderColor: '#22c55e',
  },
  ctaBtnText: {
    color: '#000',
    fontSize: 15,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  ctaBtnTextSent: {
    color: '#22c55e',
  },
  ctaFootnote: {
    color: '#555',
    fontSize: 11,
    fontFamily: 'monospace',
  },
});
