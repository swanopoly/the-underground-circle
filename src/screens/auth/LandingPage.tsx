/**
 * LandingPage — first thing visitors see before signing up
 * Dark, sharp, mission-focused. Converts visitors into users.
 */
import React, { useState } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet, Platform, useWindowDimensions,
} from 'react-native';

interface Props {
  onLogin: () => void;
  onSignUp: () => void;
}

export default function LandingPage({ onLogin, onSignUp }: Props) {
  const { width } = useWindowDimensions();
  const isMobile = width < 700;

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>
      {/* Nav */}
      <View style={s.nav}>
        <View style={s.logoRow}>
          <View style={s.logoCircle}>
            <Text style={s.logoText}>UC</Text>
          </View>
          <Text style={s.logoName}>THE UNDERGROUND CIRCLE</Text>
        </View>
        <View style={s.navRight}>
          <Pressable onPress={onLogin} style={s.navLink}>
            <Text style={s.navLinkText}>Log in</Text>
          </Pressable>
          <Pressable onPress={onSignUp} style={s.navCta}>
            <Text style={s.navCtaText}>Get Started</Text>
          </Pressable>
        </View>
      </View>

      {/* Hero */}
      <View style={[s.hero, isMobile && { paddingHorizontal: 20 }]}>
        <Text style={[s.heroTag, { color: '#f59e0b' }]}>FOR TEAMS THAT SHIP</Text>
        <Text style={[s.heroTitle, isMobile && { fontSize: 32 }]}>
          Set missions.{'\n'}Assign agents.{'\n'}Prove you shipped.
        </Text>
        <Text style={[s.heroSub, isMobile && { fontSize: 15 }]}>
          The AI-native accountability platform where people and agents pursue shared goals together — with visible proof-of-work, live coordination, and real incentives.
        </Text>
        <View style={s.heroCtas}>
          <Pressable onPress={onSignUp} style={s.heroBtn}>
            <Text style={s.heroBtnText}>Start Free</Text>
          </Pressable>
          <Pressable onPress={onLogin} style={s.heroSecondary}>
            <Text style={s.heroSecondaryText}>I have an account</Text>
          </Pressable>
        </View>
      </View>

      {/* How it works */}
      <View style={s.section}>
        <Text style={s.sectionTag}>HOW IT WORKS</Text>
        <Text style={s.sectionTitle}>Three steps to accountability</Text>
        <View style={[s.stepsRow, isMobile && { flexDirection: 'column' }]}>
          <StepCard
            number="01"
            color="#6366f1"
            title="Create a Circle"
            desc="Invite your team — 2 to 8 people building something together. Connect your GitHub repo."
          />
          <StepCard
            number="02"
            color="#f59e0b"
            title="Set Missions"
            desc="Define goals with deadlines and tasks. Assign BlackSwan to monitor progress, review code, and nudge slackers."
          />
          <StepCard
            number="03"
            color="#22c55e"
            title="Ship & Prove"
            desc="Every commit, PR, and completed task becomes visible proof-of-work. Your circle sees who shipped."
          />
        </View>
      </View>

      {/* Features */}
      <View style={s.section}>
        <Text style={s.sectionTag}>FEATURES</Text>
        <Text style={s.sectionTitle}>Everything you need to ship</Text>
        <View style={[s.featGrid, isMobile && { gap: 12 }]}>
          <FeatureCard icon=">_" color="#22d3ee" title="AI Agent Office" desc="Pixel-art dashboard where your agents live. See who's working, what they cost, and what they shipped." />
          <FeatureCard icon="[]" color="#a855f7" title="Mission System" desc="Create missions from templates. Assign tasks to humans and agents. Track progress with proof-of-work." />
          <FeatureCard icon="//" color="#f59e0b" title="GitHub Integration" desc="Connect your repo. BlackSwan watches commits, PRs, and CI — posts summaries to your circle." />
          <FeatureCard icon="$" color="#22c55e" title="Cost Tracking" desc="See exactly what each agent costs. Get optimization suggestions. Set budget alerts." />
          <FeatureCard icon="#" color="#6366f1" title="Proof of Work" desc="Every action generates proof. Commits, task completions, agent runs — all visible to your circle." />
          <FeatureCard icon="!" color="#ef4444" title="Accountability" desc="Daily standups, streak tracking, overdue nudges. BlackSwan keeps everyone honest." />
        </View>
      </View>

      {/* Social proof / stats */}
      <View style={s.section}>
        <View style={[s.statsRow, isMobile && { flexDirection: 'column', gap: 16 }]}>
          <StatBlock value="8" label="Mission Templates" color="#6366f1" />
          <StatBlock value="12" label="Office Themes" color="#a855f7" />
          <StatBlock value="6" label="Agent Types" color="#22c55e" />
          <StatBlock value="14" label="Achievement Ranks" color="#f59e0b" />
        </View>
      </View>

      {/* CTA */}
      <View style={s.ctaSection}>
        <Text style={s.ctaTitle}>Ready to ship?</Text>
        <Text style={s.ctaSub}>Free to start. No credit card required.</Text>
        <Pressable onPress={onSignUp} style={s.ctaBtn}>
          <Text style={s.ctaBtnText}>Create Your Circle</Text>
        </Pressable>
      </View>

      {/* Footer */}
      <View style={s.footer}>
        <Text style={s.footerText}>The Underground Circle</Text>
        <Text style={s.footerMuted}>Built by Swan</Text>
      </View>
    </ScrollView>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function StepCard({ number, color, title, desc }: { number: string; color: string; title: string; desc: string }) {
  return (
    <View style={s.stepCard}>
      <View style={[s.stepNumber, { backgroundColor: color + '15', borderColor: color + '40' }]}>
        <Text style={[s.stepNumberText, { color }]}>{number}</Text>
      </View>
      <Text style={s.stepTitle}>{title}</Text>
      <Text style={s.stepDesc}>{desc}</Text>
    </View>
  );
}

function FeatureCard({ icon, color, title, desc }: { icon: string; color: string; title: string; desc: string }) {
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      style={[s.featCard, hovered && { borderColor: color + '40' }]}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
    >
      <View style={[s.featIcon, { backgroundColor: color + '14', borderColor: color + '25' }]}>
        <Text style={{ color, fontSize: 14, fontWeight: '700', fontFamily: 'monospace' }}>{icon}</Text>
      </View>
      <Text style={s.featTitle}>{title}</Text>
      <Text style={s.featDesc}>{desc}</Text>
    </Pressable>
  );
}

function StatBlock({ value, label, color }: { value: string; label: string; color: string }) {
  return (
    <View style={s.statBlock}>
      <Text style={[s.statValue, { color }]}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  content: { alignItems: 'center' },

  // Nav
  nav: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    width: '100%', maxWidth: 1100, paddingHorizontal: 24, paddingVertical: 16,
  },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logoCircle: {
    width: 32, height: 32, borderRadius: 16, borderWidth: 1.5, borderColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
  },
  logoText: { color: '#fff', fontSize: 11, fontWeight: '900', letterSpacing: 2 },
  logoName: { color: '#fff', fontSize: 12, fontWeight: '800', letterSpacing: 2 },
  navRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  navLink: { paddingVertical: 8, paddingHorizontal: 12 },
  navLinkText: { color: '#888', fontSize: 13, fontWeight: '600' },
  navCta: {
    backgroundColor: '#6366f1', paddingVertical: 8, paddingHorizontal: 18, borderRadius: 8,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  navCtaText: { color: '#fff', fontSize: 13, fontWeight: '700' },

  // Hero
  hero: {
    width: '100%', maxWidth: 800, alignItems: 'center',
    paddingTop: 80, paddingBottom: 60, paddingHorizontal: 40,
  },
  heroTag: {
    fontSize: 12, fontWeight: '800', letterSpacing: 3, marginBottom: 16,
    fontFamily: 'monospace',
  },
  heroTitle: {
    color: '#f0f0f5', fontSize: 48, fontWeight: '900', textAlign: 'center',
    lineHeight: 56, letterSpacing: -1,
  },
  heroSub: {
    color: '#888', fontSize: 17, textAlign: 'center', lineHeight: 26,
    marginTop: 20, maxWidth: 600,
  },
  heroCtas: {
    flexDirection: 'row', gap: 12, marginTop: 32, flexWrap: 'wrap', justifyContent: 'center',
  },
  heroBtn: {
    backgroundColor: '#6366f1', paddingVertical: 14, paddingHorizontal: 32, borderRadius: 10,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  heroBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  heroSecondary: {
    paddingVertical: 14, paddingHorizontal: 24, borderRadius: 10,
    borderWidth: 1, borderColor: '#2a2a2a',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  heroSecondaryText: { color: '#888', fontSize: 14, fontWeight: '600' },

  // Section
  section: {
    width: '100%', maxWidth: 1100, paddingHorizontal: 24,
    paddingVertical: 48, alignItems: 'center',
  },
  sectionTag: {
    color: '#6366f1', fontSize: 11, fontWeight: '800', letterSpacing: 3,
    fontFamily: 'monospace', marginBottom: 8,
  },
  sectionTitle: {
    color: '#f0f0f5', fontSize: 28, fontWeight: '800', textAlign: 'center', marginBottom: 32,
  },

  // Steps
  stepsRow: { flexDirection: 'row', gap: 20, width: '100%' },
  stepCard: {
    flex: 1, backgroundColor: '#0a0a10', borderWidth: 1, borderColor: '#1a1a28',
    borderRadius: 14, padding: 24, gap: 12,
  },
  stepNumber: {
    width: 36, height: 36, borderRadius: 10, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  stepNumberText: { fontSize: 14, fontWeight: '800', fontFamily: 'monospace' },
  stepTitle: { color: '#f0f0f5', fontSize: 17, fontWeight: '700' },
  stepDesc: { color: '#888', fontSize: 13, lineHeight: 20 },

  // Features
  featGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 16, width: '100%', justifyContent: 'center',
  },
  featCard: {
    width: 320, backgroundColor: '#0a0a10', borderWidth: 1, borderColor: '#1a1a28',
    borderRadius: 14, padding: 20, gap: 10,
    ...(Platform.OS === 'web' ? { transition: 'border-color 0.2s', cursor: 'default' } as any : {}),
  },
  featIcon: {
    width: 36, height: 36, borderRadius: 10, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  featTitle: { color: '#f0f0f5', fontSize: 15, fontWeight: '700' },
  featDesc: { color: '#888', fontSize: 13, lineHeight: 20 },

  // Stats
  statsRow: {
    flexDirection: 'row', gap: 40, justifyContent: 'center', width: '100%',
    paddingVertical: 24,
  },
  statBlock: { alignItems: 'center', gap: 4 },
  statValue: { fontSize: 36, fontWeight: '900', fontFamily: 'monospace' },
  statLabel: { color: '#666', fontSize: 12, fontWeight: '600', letterSpacing: 0.5 },

  // CTA
  ctaSection: {
    alignItems: 'center', paddingVertical: 60, paddingHorizontal: 24,
    width: '100%', maxWidth: 600,
  },
  ctaTitle: { color: '#f0f0f5', fontSize: 32, fontWeight: '900', textAlign: 'center' },
  ctaSub: { color: '#666', fontSize: 14, marginTop: 8, marginBottom: 24 },
  ctaBtn: {
    backgroundColor: '#6366f1', paddingVertical: 16, paddingHorizontal: 40, borderRadius: 10,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  ctaBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  // Footer
  footer: {
    alignItems: 'center', paddingVertical: 32, borderTopWidth: 1, borderTopColor: '#1a1a28',
    width: '100%',
  },
  footerText: { color: '#444', fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  footerMuted: { color: '#333', fontSize: 11, marginTop: 4 },
});
