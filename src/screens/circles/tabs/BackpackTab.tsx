/**
 * BackpackTab — "Everything you need for the journey"
 *
 * A unified dashboard that holds all agent analytics, cost tracking,
 * performance metrics, and management tools. Organized as "compartments"
 * in your backpack — tap to open, explore, and navigate back.
 *
 * Inspired by IBM Cognos' interactive analytics, Omni's dynamic tiles,
 * and Giza's dark depth aesthetic.
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Animated,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { useBackpackData } from '../../../hooks/useBackpackData';
import StatCube from '../../../components/StatCube';

// Dashboard components
import CostDashboard from '../../../components/CostDashboard';
import AgentPerformanceMetrics from '../../../components/AgentPerformanceMetrics';
import FarmHealthDashboard from '../../../components/FarmHealthDashboard';
import OfficeAnalyticsPanel from '../../../components/OfficeAnalyticsPanel';
import PixelOfficeCanvas from '../../../components/PixelOfficeCanvas';
import OfficeTerminal from '../../../components/OfficeTerminal';
import SessionTagsDashboard from '../../../components/SessionTagsDashboard';
import SharedMemoryPanel from '../../../components/SharedMemoryPanel';
import ProjectRoomsPanel from '../../../components/ProjectRoomsPanel';
import PromptManagerPanel from './office/PromptManagerPanel';
import TraceViewer from '../../../components/TraceViewer';

type Compartment = 'none' | 'cost' | 'terminal' | 'farm' | 'performance' | 'projects' | 'analytics' | 'canvas' | 'prompts' | 'traces';

const COMPARTMENTS: {
  key: Compartment;
  label: string;
  icon: string;
  color: string;
  description: string;
}[] = [
  { key: 'cost', label: 'Cost Tracker', icon: '💰', color: '#f59e0b', description: 'Spending analytics & budget alerts' },
  { key: 'terminal', label: 'Command Center', icon: '⌨️', color: '#22c55e', description: 'Terminal & agent commands' },
  { key: 'traces', label: 'Traces', icon: '🔍', color: '#06b6d4', description: 'Request traces & replay' },
  { key: 'farm', label: 'Agent Farm', icon: '🏥', color: '#ec4899', description: 'Health monitoring & status' },
  { key: 'performance', label: 'Performance', icon: '🏆', color: '#6366f1', description: 'Top performers & metrics' },
  { key: 'projects', label: 'Projects', icon: '🏷️', color: '#f97316', description: 'Tags, memory & project rooms' },
  { key: 'analytics', label: 'Analytics', icon: '📈', color: '#3b82f6', description: 'Deep office analytics' },
  { key: 'canvas', label: 'Canvas', icon: '🖥️', color: '#8b5cf6', description: 'Pixel agent visualization' },
  { key: 'prompts', label: 'Prompts', icon: '📝', color: '#14b8a6', description: 'Prompt library & management' },
];

interface Props {
  circleId: string;
  accentColor?: string;
}

export default function BackpackTab({ circleId, accentColor = '#6366f1' }: Props) {
  const data = useBackpackData(circleId);
  const [activeCompartment, setActiveCompartment] = useState<Compartment>('none');
  const { width } = useWindowDimensions();
  const isDesktop = width > 768;

  // Terminal shared state — must match OfficeTerminal's expected defaults
  const [terminalInput, setTerminalInput] = useState('');
  const [terminalTargetId, setTerminalTargetId] = useState<string | null>(null);
  const [terminalTargetName, setTerminalTargetName] = useState('@all');
  const [terminalModel, setTerminalModel] = useState<string | null>(null);
  const [terminalTargetIds, setTerminalTargetIds] = useState<string[] | null>(null);

  const handleBack = () => setActiveCompartment('none');

  // ─── Expanded compartment view ─────────────────────────────────
  if (activeCompartment !== 'none') {
    const meta = COMPARTMENTS.find(c => c.key === activeCompartment)!;
    return (
      <View style={styles.container}>
        <Pressable onPress={handleBack} style={styles.backRow}>
          <Text style={[styles.backArrow, { color: meta.color }]}>←</Text>
          <Text style={styles.backText}>Backpack</Text>
          <View style={[styles.compartmentBadge, { backgroundColor: meta.color + '20' }]}>
            <Text style={styles.compartmentBadgeIcon}>{meta.icon}</Text>
            <Text style={[styles.compartmentBadgeText, { color: meta.color }]}>{meta.label}</Text>
          </View>
        </Pressable>

        <View style={styles.compartmentContent}>
          {activeCompartment === 'cost' && (
            <CostDashboard
              sessions={data.enrichedSessions}
              agents={data.enrichedAgents}
              sessionTags={data.sessionTags}
              accentColor={accentColor}
            />
          )}
          {activeCompartment === 'terminal' && (
            <OfficeTerminal
              circleId={circleId}
              userId={data.currentUserId}
              userDisplayName={data.currentUserName}
              agents={data.mergedCircleAgents}
              myAgentIds={data.mergedCircleAgents.filter(a => a.isOwn).map(a => a.id)}
              sharedInput={terminalInput}
              onSharedInputChange={setTerminalInput}
              sharedTargetId={terminalTargetId}
              sharedTargetName={terminalTargetName}
              onSharedSelectTarget={(id: string | null, name: string) => {
                setTerminalTargetId(id);
                setTerminalTargetName(name);
              }}
              sharedModel={terminalModel}
              onSharedModelChange={setTerminalModel}
              sharedTargetIds={terminalTargetIds}
              onSharedSelectTargets={(ids, _names) => setTerminalTargetIds(ids)}
            />
          )}
          {activeCompartment === 'traces' && (
            <TraceViewer
              circleId={circleId}
              accentColor={accentColor}
            />
          )}
          {activeCompartment === 'farm' && (
            <FarmHealthDashboard
              agents={data.enrichedAgents}
              sessions={data.enrichedSessions}
              accentColor={accentColor}
            />
          )}
          {activeCompartment === 'performance' && (
            <AgentPerformanceMetrics
              agents={data.enrichedAgents}
              sessions={data.enrichedSessions}
              accentColor={accentColor}
            />
          )}
          {activeCompartment === 'projects' && (
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16 }}>
              <SharedMemoryPanel circleId={circleId} />
              <ProjectRoomsPanel circleId={circleId} />
              <SessionTagsDashboard
                agents={data.displayAgents}
                sessionTags={data.sessionTags}
              />
            </ScrollView>
          )}
          {activeCompartment === 'analytics' && (
            <OfficeAnalyticsPanel
              circleId={circleId}
              userId={data.currentUserId}
              agents={data.mergedCircleAgents}
            />
          )}
          {activeCompartment === 'canvas' && (
            <PixelOfficeCanvas
              agents={data.mergedCircleAgents}
              currentUserId={data.currentUserId}
            />
          )}
          {activeCompartment === 'prompts' && (
            <PromptManagerPanel
              circleId={circleId}
              userId={data.currentUserId}
              accentColor={accentColor}
            />
          )}
        </View>
      </View>
    );
  }

  // ─── Overview — The open backpack ──────────────────────────────
  if (data.loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color="#6366f1" size="large" />
        <Text style={styles.loadingText}>Packing your backpack...</Text>
      </View>
    );
  }

  // Compute quick stats
  const activeAgents = data.enrichedAgents.filter(a => a.status === 'active').length;
  const healthyAgents = data.enrichedAgents.filter(a => a.status !== 'error').length;
  const healthPct = data.enrichedAgents.length > 0
    ? Math.round((healthyAgents / data.enrichedAgents.length) * 100)
    : 100;
  const tagCount = data.sessionTags.size;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      {/* ─── Header ─── */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerIcon}>🎒</Text>
          <View>
            <Text style={styles.headerTitle}>Backpack</Text>
            <Text style={styles.headerSubtitle}>Everything you need for the journey</Text>
          </View>
        </View>
        <Pressable onPress={data.refresh} style={styles.refreshBtn}>
          <Text style={styles.refreshText}>↻</Text>
        </Pressable>
      </View>

      {/* ─── Journey Dashboard — 3D Stat Cubes ─── */}
      <View style={styles.statsSection}>
        <Text style={styles.sectionLabel}>JOURNEY DASHBOARD</Text>
        <View style={[styles.statsGrid, isDesktop && styles.statsGridDesktop]}>
          <StatCube
            icon="💰"
            label="Spend"
            value={`$${data.periodCosts.today.toFixed(2)}`}
            subtitle="today"
            color="#f59e0b"
            onPress={() => setActiveCompartment('cost')}
            delay={0}
          />
          <StatCube
            icon="🤖"
            label="Agents"
            value={String(data.agentCount)}
            subtitle={`${activeAgents} active`}
            color="#22c55e"
            onPress={() => setActiveCompartment('farm')}
            delay={100}
          />
          <StatCube
            icon="📊"
            label="Sessions"
            value={String(data.sessionCount)}
            subtitle="tracked"
            color="#3b82f6"
            onPress={() => setActiveCompartment('analytics')}
            delay={200}
          />
          <StatCube
            icon="❤️"
            label="Health"
            value={`${healthPct}%`}
            subtitle={`${healthyAgents}/${data.enrichedAgents.length || 1}`}
            color="#ec4899"
            onPress={() => setActiveCompartment('farm')}
            delay={300}
          />
        </View>
      </View>

      {/* ─── Budget Alert (if any) ─── */}
      {data.budgetAlerts.length > 0 && (
        <View style={[styles.alertBanner, {
          borderColor: data.budgetAlerts[0].level === 'critical' ? '#ef4444' :
                        data.budgetAlerts[0].level === 'danger' ? '#f59e0b' : '#6366f140',
          backgroundColor: data.budgetAlerts[0].level === 'critical' ? '#ef444410' :
                            data.budgetAlerts[0].level === 'danger' ? '#f59e0b10' : '#6366f108',
        }]}>
          <Text style={styles.alertIcon}>⚠️</Text>
          <Text style={styles.alertText}>{data.budgetAlerts[0].message}</Text>
        </View>
      )}

      {/* ─── Compartments Grid ─── */}
      <View style={styles.compartmentsSection}>
        <Text style={styles.sectionLabel}>COMPARTMENTS</Text>
        <Text style={styles.sectionHint}>Tap to open</Text>

        <View style={[styles.compartmentGrid, isDesktop && styles.compartmentGridDesktop]}>
          {COMPARTMENTS.map((comp, i) => {
            // Compute mini stat for each compartment
            let miniStat = '';
            switch (comp.key) {
              case 'cost': miniStat = `$${data.periodCosts.today.toFixed(2)} today`; break;
              case 'terminal': miniStat = `${data.agentCount} agents`; break;
              case 'farm': miniStat = `${healthPct}% healthy`; break;
              case 'performance': {
                const top = data.enrichedAgents.reduce((best, a) => a.turns > (best?.turns || 0) ? a : best, data.enrichedAgents[0]);
                miniStat = top ? top.name : 'No data';
                break;
              }
              case 'projects': miniStat = `${tagCount} tags`; break;
              case 'analytics': miniStat = `${data.mergedCircleAgents.length} circle agents`; break;
              case 'canvas': miniStat = `${data.mergedCircleAgents.length} agents`; break;
              case 'prompts': miniStat = 'Library'; break;
            }

            return (
              <CompartmentCard
                key={comp.key}
                icon={comp.icon}
                label={comp.label}
                description={comp.description}
                color={comp.color}
                miniStat={miniStat}
                delay={i * 60}
                onPress={() => setActiveCompartment(comp.key)}
                isDesktop={isDesktop}
              />
            );
          })}
        </View>
      </View>

      {/* ─── Pack Status Footer ─── */}
      <View style={styles.packStatus}>
        <View style={styles.packDivider} />
        <Text style={styles.packStatusText}>
          🎒 {COMPARTMENTS.length} compartments packed — ready to go
        </Text>
      </View>
    </ScrollView>
  );
}

// ─── Compartment Card ─────────────────────────────────────────────

function CompartmentCard({
  icon, label, description, color, miniStat, delay, onPress, isDesktop,
}: {
  icon: string;
  label: string;
  description: string;
  color: string;
  miniStat: string;
  delay: number;
  onPress: () => void;
  isDesktop: boolean;
}) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(12)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 400, delay, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 400, delay, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <Animated.View style={[
      styles.compCardWrap,
      isDesktop && styles.compCardWrapDesktop,
      { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
    ]}>
      <Pressable onPress={onPress} style={[styles.compCard, { borderColor: color + '25' }]}>
        {/* Left accent stripe */}
        <View style={[styles.compStripe, { backgroundColor: color }]} />

        <View style={styles.compBody}>
          <View style={styles.compTop}>
            <View style={[styles.compIconWrap, { backgroundColor: color + '15' }]}>
              <Text style={styles.compIcon}>{icon}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.compLabel, { color }]}>{label}</Text>
              <Text style={styles.compDesc}>{description}</Text>
            </View>
            <Text style={styles.compArrow}>→</Text>
          </View>

          {/* Mini stat bar */}
          <View style={[styles.compStatBar, { backgroundColor: color + '08', borderTopColor: color + '15' }]}>
            <Text style={[styles.compStatText, { color: color + 'cc' }]}>{miniStat}</Text>
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  scrollContent: { paddingBottom: 40 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  loadingText: { color: '#555', fontSize: 12, fontFamily: 'monospace' },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerIcon: { fontSize: 28 },
  headerTitle: { color: '#fff', fontSize: 20, fontWeight: '900', fontFamily: 'monospace', letterSpacing: 1 },
  headerSubtitle: { color: '#555', fontSize: 11, fontFamily: 'monospace', marginTop: 1 },
  refreshBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#1a1a2e',
    justifyContent: 'center',
    alignItems: 'center',
  },
  refreshText: { color: '#888', fontSize: 18 },

  // Stats
  statsSection: { paddingHorizontal: 16, marginBottom: 20 },
  sectionLabel: {
    color: '#555',
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'monospace',
    letterSpacing: 2,
    marginBottom: 10,
  },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statsGridDesktop: { flexWrap: 'nowrap' },

  // Alert
  alertBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 12,
    borderWidth: 1,
    borderRadius: 10,
  },
  alertIcon: { fontSize: 16 },
  alertText: { flex: 1, color: '#ccc', fontSize: 12, fontFamily: 'monospace' },

  // Compartments
  compartmentsSection: { paddingHorizontal: 16 },
  sectionHint: { color: '#333', fontSize: 10, fontFamily: 'monospace', marginBottom: 10, marginTop: -6 },
  compartmentGrid: { gap: 10 },
  compartmentGridDesktop: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },

  // Compartment Card
  compCardWrap: {
    // Mobile: full width; Desktop: overridden to 2-column
  },
  compCardWrapDesktop: {
    flexBasis: '48.5%',
  },
  compCard: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderRadius: 12,
    flexDirection: 'row',
    overflow: 'hidden',
    height: 110,
    ...(Platform.OS === 'web' ? {
      boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
    } as any : {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.2,
      shadowRadius: 4,
      elevation: 3,
    }),
  },
  compStripe: {
    width: 4,
  },
  compBody: { flex: 1, justifyContent: 'space-between' },
  compTop: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 12,
  },
  compIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  compIcon: { fontSize: 18 },
  compLabel: { fontSize: 13, fontWeight: '700', fontFamily: 'monospace' },
  compDesc: { color: '#666', fontSize: 11, fontFamily: 'monospace', marginTop: 1 },
  compArrow: { color: '#333', fontSize: 16, fontFamily: 'monospace' },
  compStatBar: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderTopWidth: 1,
    marginLeft: 4,
  },
  compStatText: { fontSize: 10, fontFamily: 'monospace', fontWeight: '600' },

  // Back navigation
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a2e',
  },
  backArrow: { fontSize: 18, fontWeight: '700' },
  backText: { color: '#888', fontSize: 13, fontFamily: 'monospace' },
  compartmentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginLeft: 4,
  },
  compartmentBadgeIcon: { fontSize: 12 },
  compartmentBadgeText: { fontSize: 11, fontWeight: '700', fontFamily: 'monospace' },
  compartmentContent: { flex: 1 },

  // Pack Status Footer
  packStatus: { paddingHorizontal: 16, paddingVertical: 20, alignItems: 'center' },
  packDivider: {
    width: 60,
    height: 2,
    backgroundColor: '#1a1a2e',
    borderRadius: 1,
    marginBottom: 12,
  },
  packStatusText: { color: '#333', fontSize: 10, fontFamily: 'monospace' },
});
