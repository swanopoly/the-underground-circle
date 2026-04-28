/**
 * MemoryDeepDive — long-form marketing page at /memory.
 *
 * Reachable from LandingPage's "Inside UC's memory engine" CTA.
 * Renders without auth; describes UC's memory architecture honestly
 * (no comparative claims, no unshipped features). Spec:
 * docs/superpowers/specs/2026-04-28-memory-positioning-design.md
 */
import React from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet, Platform, useWindowDimensions,
} from 'react-native';

interface Props {
  onBack: () => void;
  onSignUp: () => void;
}

export default function MemoryDeepDive({ onBack, onSignUp }: Props) {
  const { width } = useWindowDimensions();
  const isMobile = width < 800;

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>
      {/* Nav */}
      <View style={s.nav}>
        <Pressable onPress={onBack} style={s.backLink}>
          <Text style={s.backText}>← The Underground Circle</Text>
        </Pressable>
        <Pressable onPress={onSignUp} style={s.navCta}>
          <Text style={s.navCtaText}>Get Started</Text>
        </Pressable>
      </View>

      {/* Hero */}
      <View style={[s.hero, isMobile && { paddingHorizontal: 20 }]}>
        <Text style={s.heroTag}>MEMORY ARCHITECTURE</Text>
        <Text style={[s.heroTitle, isMobile && { fontSize: 30 }]}>
          Inside UC's memory engine
        </Text>
        <Text style={[s.heroSub, isMobile && { fontSize: 15 }]}>
          A look at how circles remember — and why it gets sharper with use,
          not noisier.
        </Text>
      </View>

      {/* §1 — The problem with stateless chat */}
      <Section
        tag="01 · THE PROBLEM"
        title="Stateless chat is wasteful"
        body={[
          `Most AI tools follow the same loop: retrieve, answer, forget. The next session starts cold. You re-explain your stack, your team, your last decision. The model is good. The substrate around it is empty.`,
          `Bigger context windows don't fix this — attention degrades with size, and re-reading a transcript every turn wastes tokens that should be reasoning. Markdown-and-Obsidian patterns are a clever first move for human knowledge work, but agents don't browse pages. They need facts.`,
          `UC was built around the difference. Identity is human-owned. Operational memory is machine-shaped. They meet at a single audit surface.`,
        ]}
        accent="#94a3b8"
      />

      {/* §2 — What UC's circle remembers */}
      <Section
        tag="02 · CAPTURE"
        title="What every circle remembers"
        body={[
          `On every turn that matters, UC distills the conversation into atomic memories — typed, scoped, and embedded. The categories aren't decorative; they drive how the memory gets routed and retrieved later.`,
        ]}
        accent="#6366f1"
      >
        <View style={s.kindGrid}>
          <KindCard kind="DECISION" desc="Architectural calls, vendor picks, design directions — preserved with their reasoning so the next session inherits the rationale." />
          <KindCard kind="POLICY" desc="Standards the team agreed on. Code style, deploy windows, escalation paths." />
          <KindCard kind="PREFERENCE" desc="How an individual likes to work — diagram format, response length, depth of explanation." />
          <KindCard kind="FACT" desc="Stable truths about the project — repo URL, env vars, who owns which surface." />
          <KindCard kind="FINDING" desc="What a postmortem revealed. Bugs and their root causes, in plain language." />
          <KindCard kind="INSTRUCTION" desc="Standing orders to a soul. ‘Run typecheck before claiming done.’" />
        </View>
      </Section>

      {/* §3 — The four-pillar loop */}
      <Section
        tag="03 · THE LOOP"
        title="Four pillars, one continuous cycle"
        body={[
          `Every UC turn runs the same loop. The pieces are independently inspectable, which means anything that goes wrong in retrieval can be traced back to one of these four steps.`,
        ]}
        accent="#22d3ee"
      >
        <View style={s.loopRow}>
          <LoopCard num="01" code="CAPTURE"  desc="Distill turn → atomic memory. Type, scope, embed in one write." color="#6366f1" />
          <LoopArrow />
          <LoopCard num="02" code="ROUTE"    desc="Pick owners. Soul-aware: architect-mode learnings stay with architect-mode." color="#a855f7" />
          <LoopArrow />
          <LoopCard num="03" code="RETRIEVE" desc="Vector search top-40, score by similarity + soul + recency, keep the few that fit the budget." color="#22d3ee" />
          <LoopArrow />
          <LoopCard num="04" code="INJECT"   desc="Compose prompt. Cite every memory used. Log the access for audit." color="#22c55e" />
        </View>
      </Section>

      {/* §4 — Scoring, decay, conflict */}
      <Section
        tag="04 · QUALITY"
        title="Scored, decayed, never silent"
        body={[
          `Storage is easy. Ranking is hard. UC scores every retrieval candidate on similarity, soul affinity, importance, and freshness — then decays the weight of memories that haven't been touched. A 30-day-old unused memory competes weaker than a fresh one with the same content.`,
          `When two memories disagree, the system doesn't average them or quietly pick one. Contradiction detection runs on new captures and quarantines the loser, with a paper trail for both sides. Newer wins by default; user-pinned memories override that. Disputed memories lose importance immediately and auto-quarantine after three negative signals.`,
          `Memory drift is a reliability problem, not clutter. UC treats it like one.`,
        ]}
        accent="#f59e0b"
      />

      {/* §5 — Inspectable by design */}
      <Section
        tag="05 · TRUST"
        title="Inspectable, editable, deletable"
        body={[
          `Under every assistant reply, UC shows the memories that shaped it. Tap to expand, see the full content, mark it helpful, or mark it not helpful — the next retrieval reflects your call.`,
          `If a memory is wrong, you can pin a corrected version, dispute it, or delete it outright. Every interaction lands in an audit log so you can answer "why did the agent say this?" without spelunking through a database.`,
          `The whole point: the memory layer should serve you, not surprise you.`,
        ]}
        accent="#22c55e"
      />

      {/* §6 — Open architecture */}
      <Section
        tag="06 · OPEN"
        title="Built on what you already trust"
        body={[
          `The memory store runs on Postgres + pgvector with row-level security gating every read and write. No closed-source pipeline; no third-party vector vendor; no PII leaving your circle's boundary.`,
          `The same RLS policies that protect your messages protect your memories. The agent only sees what the user asking the question is allowed to see.`,
        ]}
        accent="#a855f7"
      />

      {/* CTA */}
      <View style={s.ctaSection}>
        <Text style={s.ctaTitle}>Memory that stays yours</Text>
        <Text style={s.ctaSub}>Free to start. Bring your team. Watch the substrate compound.</Text>
        <Pressable onPress={onSignUp} style={s.ctaBtn}>
          <Text style={s.ctaBtnText}>Create Your Circle</Text>
        </Pressable>
      </View>

      {/* Footer */}
      <View style={s.footer}>
        <Text style={s.footerText}>The Underground Circle</Text>
        <Text style={s.footerMuted}>Architecture details: docs/AGENT_MEMORY_GOD_PLAN.md</Text>
      </View>
    </ScrollView>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function Section({
  tag, title, body, accent, children,
}: {
  tag: string;
  title: string;
  body: string[];
  accent: string;
  children?: React.ReactNode;
}) {
  return (
    <View style={s.section}>
      <Text style={[s.sectionTag, { color: accent }]}>{tag}</Text>
      <Text style={s.sectionTitle}>{title}</Text>
      {body.map((p, i) => (
        <Text key={i} style={s.bodyText}>{p}</Text>
      ))}
      {children}
    </View>
  );
}

function KindCard({ kind, desc }: { kind: string; desc: string }) {
  return (
    <View style={s.kindCard}>
      <Text style={s.kindLabel}>{kind}</Text>
      <Text style={s.kindDesc}>{desc}</Text>
    </View>
  );
}

function LoopCard({ num, code, desc, color }: { num: string; code: string; desc: string; color: string }) {
  return (
    <View style={[s.loopCard, { borderColor: color + '25' }]}>
      <View style={s.loopHeader}>
        <Text style={[s.loopNum, { color }]}>{num}</Text>
        <Text style={[s.loopCode, { color }]}>{code}</Text>
      </View>
      <Text style={s.loopDesc}>{desc}</Text>
    </View>
  );
}

function LoopArrow() {
  return (
    <View style={s.loopArrow}>
      <Text style={s.loopArrowText}>→</Text>
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
  backLink: { paddingVertical: 8, paddingHorizontal: 12 },
  backText: { color: '#94a3b8', fontSize: 13, fontWeight: '600', fontFamily: 'monospace' },
  navCta: {
    backgroundColor: '#6366f1', paddingVertical: 8, paddingHorizontal: 18, borderRadius: 8,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  navCtaText: { color: '#fff', fontSize: 13, fontWeight: '700' },

  // Hero
  hero: {
    width: '100%', maxWidth: 800, alignItems: 'center',
    paddingTop: 60, paddingBottom: 40, paddingHorizontal: 40,
  },
  heroTag: {
    fontSize: 11, fontWeight: '800', letterSpacing: 3, marginBottom: 16,
    fontFamily: 'monospace', color: '#22d3ee',
  },
  heroTitle: {
    color: '#f0f0f5', fontSize: 42, fontWeight: '900', textAlign: 'center',
    lineHeight: 50, letterSpacing: -1,
  },
  heroSub: {
    color: '#94a3b8', fontSize: 17, textAlign: 'center', lineHeight: 26,
    marginTop: 16, maxWidth: 600,
  },

  // Section (long-form)
  section: {
    width: '100%', maxWidth: 760, paddingHorizontal: 24,
    paddingVertical: 36, gap: 14,
  },
  sectionTag: {
    fontSize: 11, fontWeight: '800', letterSpacing: 2,
    fontFamily: 'monospace',
  },
  sectionTitle: {
    color: '#f0f0f5', fontSize: 26, fontWeight: '800', marginBottom: 8,
    letterSpacing: -0.3,
  },
  bodyText: {
    color: '#cbd5e1', fontSize: 15, lineHeight: 25,
  },

  // Kind grid (§2)
  kindGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12,
  },
  kindCard: {
    flexBasis: '48%', flexGrow: 1, minWidth: 220,
    backgroundColor: '#0a0f1c', borderWidth: 1, borderColor: '#1e293b',
    borderRadius: 10, padding: 14, gap: 6,
  },
  kindLabel: {
    fontSize: 10, fontWeight: '900', letterSpacing: 2,
    fontFamily: 'monospace', color: '#6366f1',
  },
  kindDesc: { color: '#94a3b8', fontSize: 13, lineHeight: 19 },

  // Loop row (§3)
  loopRow: {
    flexDirection: 'row', alignItems: 'stretch', gap: 6, marginTop: 12,
    flexWrap: 'wrap', justifyContent: 'center',
  },
  loopCard: {
    flex: 1, minWidth: 140, backgroundColor: '#0a0f1c', borderWidth: 1,
    borderRadius: 10, padding: 12, gap: 8,
  },
  loopHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  loopNum: {
    fontSize: 9, fontWeight: '900', letterSpacing: 1.5,
    fontFamily: 'monospace', opacity: 0.8,
  },
  loopCode: {
    fontSize: 12, fontWeight: '900', letterSpacing: 1,
    fontFamily: 'monospace',
  },
  loopDesc: { color: '#94a3b8', fontSize: 12, lineHeight: 17 },
  loopArrow: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 },
  loopArrowText: { color: '#475569', fontSize: 18, fontWeight: '700' },

  // CTA
  ctaSection: {
    alignItems: 'center', paddingVertical: 60, paddingHorizontal: 24,
    width: '100%', maxWidth: 600,
  },
  ctaTitle: { color: '#f0f0f5', fontSize: 30, fontWeight: '900', textAlign: 'center' },
  ctaSub: { color: '#94a3b8', fontSize: 14, marginTop: 8, marginBottom: 24, textAlign: 'center' },
  ctaBtn: {
    backgroundColor: '#6366f1', paddingVertical: 16, paddingHorizontal: 40, borderRadius: 10,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  ctaBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  // Footer
  footer: {
    alignItems: 'center', paddingVertical: 32, borderTopWidth: 1, borderTopColor: '#1e293b',
    width: '100%',
  },
  footerText: { color: '#475569', fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  footerMuted: { color: '#334155', fontSize: 11, marginTop: 4, fontFamily: 'monospace' },
});
