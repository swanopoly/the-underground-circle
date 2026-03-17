import React, { useEffect, useRef, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Animated, Pressable } from 'react-native';
import { OfficeAgent, STATUS_COLORS } from '../../../../lib/officeAgents';
import { resolveModelRate } from '../../../../lib/modelPricing';
import {
  calculateAgentScore,
  analyzeWorkloadDistribution,
  performHealthCheck,
  generateCostOptimizations,
  type AgentPerformanceScore,
  type AgentWorkload,
  type HealthCheck,
  type CostOptimization,
} from '../../../../lib/agentFarmMetrics';

/* ─── Blinking LED ─── */
function BlinkingLED({ color, delay, size = 3 }: { color: string; delay: number; size?: number }) {
  const opacity = useRef(new Animated.Value(0.2)).current;

  useEffect(() => {
    const timer = setTimeout(() => {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(opacity, { toValue: 1, duration: 200 + Math.random() * 600, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0.15, duration: 300 + Math.random() * 800, useNativeDriver: true }),
          Animated.delay(Math.random() * 2000),
        ])
      );
      loop.start();
      return () => loop.stop();
    }, delay);
    return () => clearTimeout(timer);
  }, []);

  return (
    <Animated.View style={{ backgroundColor: color, opacity, width: size, height: size, borderRadius: size / 2 }} />
  );
}

/* ─── Activity scanner bar ─── */
function ScanLine() {
  const pos = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pos, { toValue: 1, duration: 2400, useNativeDriver: true }),
        Animated.timing(pos, { toValue: 0, duration: 2400, useNativeDriver: true }),
      ])
    ).start();
  }, []);
  return (
    <Animated.View style={[s.scanLine, { transform: [{ translateX: pos.interpolate({ inputRange: [0, 1], outputRange: [0, 60] }) }] }]} />
  );
}

/* ─── Mini bar chart for metrics ─── */
function MiniBar({ value, max, color, width = 30 }: { value: number; max: number; color: string; width?: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <View style={[s.miniBarTrack, { width }]}>
      <View style={[s.miniBarFill, { width: `${pct}%` as any, backgroundColor: color }]} />
    </View>
  );
}

/* ─── Grade badge ─── */
const GRADE_COLORS: Record<string, string> = {
  S: '#f59e0b', A: '#22c55e', B: '#3b82f6', C: '#eab308', D: '#f97316', F: '#ef4444',
};
function GradeBadge({ grade }: { grade: string }) {
  return (
    <View style={[s.gradeBadge, { backgroundColor: (GRADE_COLORS[grade] || '#555') + '30', borderColor: GRADE_COLORS[grade] || '#555' }]}>
      <Text style={[s.gradeText, { color: GRADE_COLORS[grade] || '#555' }]}>{grade}</Text>
    </View>
  );
}

/* ─── Severity icon ─── */
function SeverityDot({ severity }: { severity: 'critical' | 'warning' | 'info' }) {
  const color = severity === 'critical' ? '#ef4444' : severity === 'warning' ? '#f59e0b' : '#3b82f6';
  return <View style={[s.severityDot, { backgroundColor: color }]} />;
}

/* ─── Per-agent blade server (enhanced) ─── */
function AgentBlade({
  agent,
  index,
  score,
  workload,
}: {
  agent: OfficeAgent;
  index: number;
  score: AgentPerformanceScore | null;
  workload: AgentWorkload | null;
}) {
  const statusColor = STATUS_COLORS[agent.status] || '#6b7280';
  const cacheRate = agent.inputTokens > 0
    ? Math.round((agent.cachedTokens / agent.inputTokens) * 100)
    : 0;
  const totalTok = agent.tokensUsed;
  const tokLabel = totalTok >= 1_000_000
    ? (totalTok / 1_000_000).toFixed(1) + 'M'
    : totalTok >= 1_000
      ? (totalTok / 1_000).toFixed(1) + 'K'
      : String(totalTok);
  const modelShort = agent.model
    .replace('claude-', '')
    .replace('-20251022', '')
    .replace('-20250219', '')
    .replace('-latest', '')
    .slice(0, 12);

  // Model pricing tier
  const rate = resolveModelRate(agent.model);
  const priceTier = rate.inPer1M >= 15 ? 'PREMIUM' : rate.inPer1M >= 3 ? 'STANDARD' : 'ECONOMY';
  const priceColor = priceTier === 'PREMIUM' ? '#f59e0b' : priceTier === 'STANDARD' ? '#3b82f6' : '#22c55e';

  // Derived server metrics
  const cpuLoad = workload?.currentLoad ?? (agent.status === 'active' ? 65 : agent.status === 'idle' ? 12 : 0);
  const memUsage = agent.tokensUsed > 0 ? Math.min(95, Math.round((agent.cachedTokens / Math.max(1, agent.tokensUsed)) * 100 + 20)) : 8;
  const tokPerMsg = agent.messagesProcessed > 0 ? Math.round(agent.tokensUsed / agent.messagesProcessed) : 0;
  const costPerMsg = agent.messagesProcessed > 0 ? (agent.costToday / agent.messagesProcessed) : 0;

  // Uptime display
  const uptimeStr = agent.uptime || (agent.status === 'active' ? 'online' : agent.status === 'idle' ? 'standby' : 'off');

  return (
    <View style={s.blade}>
      {/* Top: status LED + name + grade */}
      <View style={s.bladeHeader}>
        <BlinkingLED color={statusColor} delay={index * 200} size={4} />
        <Text style={s.bladeId} numberOfLines={1}>{agent.name.slice(0, 8)}</Text>
        {score && <GradeBadge grade={score.grade} />}
        <BlinkingLED color="#3b82f6" delay={index * 200 + 100} size={3} />
      </View>

      {/* Model + pricing tier */}
      <View style={s.bladeModelRow}>
        <Text style={s.bladeModel} numberOfLines={1}>{modelShort}</Text>
        <Text style={[s.bladePriceTier, { color: priceColor }]}>{priceTier}</Text>
      </View>

      {/* Role chip */}
      <View style={s.bladeRoleRow}>
        <Text style={s.bladeRole} numberOfLines={1}>{agent.role}</Text>
        <Text style={s.bladeUptime}>{uptimeStr}</Text>
      </View>

      {/* LED bank — activity indicators */}
      <View style={s.bladeLedBank}>
        <BlinkingLED color="#22c55e" delay={index * 150} size={2} />
        <BlinkingLED color="#eab308" delay={index * 150 + 80} size={2} />
        <BlinkingLED color="#3b82f6" delay={index * 150 + 160} size={2} />
        <BlinkingLED color={agent.status === 'active' ? '#22c55e' : '#333'} delay={index * 150 + 240} size={2} />
        <BlinkingLED color={agent.turns > 0 ? '#6366f1' : '#222'} delay={index * 150 + 320} size={2} />
        <BlinkingLED color={cacheRate > 50 ? '#22c55e' : '#222'} delay={index * 150 + 400} size={2} />
      </View>

      {/* CPU / MEM load bars */}
      <View style={s.bladeLoadSection}>
        <View style={s.bladeLoadRow}>
          <Text style={s.bladeLoadLabel}>CPU</Text>
          <MiniBar value={cpuLoad} max={100} color={cpuLoad > 80 ? '#ef4444' : cpuLoad > 50 ? '#eab308' : '#22c55e'} width={32} />
          <Text style={s.bladeLoadPct}>{cpuLoad}%</Text>
        </View>
        <View style={s.bladeLoadRow}>
          <Text style={s.bladeLoadLabel}>MEM</Text>
          <MiniBar value={memUsage} max={100} color={memUsage > 80 ? '#ef4444' : memUsage > 50 ? '#eab308' : '#3b82f6'} width={32} />
          <Text style={s.bladeLoadPct}>{memUsage}%</Text>
        </View>
      </View>

      {/* Mini terminal — token & cost data */}
      <View style={s.bladeTerm}>
        <Text style={s.bladeTermLine}>
          <Text style={s.bladeTermLabel}>TOK  </Text>
          <Text style={s.bladeTermVal}>{tokLabel}</Text>
        </Text>
        <Text style={s.bladeTermLine}>
          <Text style={s.bladeTermLabel}>IN   </Text>
          <Text style={s.bladeTermVal}>{agent.inputTokens >= 1000 ? (agent.inputTokens / 1000).toFixed(0) + 'K' : agent.inputTokens}</Text>
        </Text>
        <Text style={s.bladeTermLine}>
          <Text style={s.bladeTermLabel}>OUT  </Text>
          <Text style={s.bladeTermVal}>{agent.outputTokens >= 1000 ? (agent.outputTokens / 1000).toFixed(0) + 'K' : agent.outputTokens}</Text>
        </Text>
        <Text style={s.bladeTermLine}>
          <Text style={s.bladeTermLabel}>NEW  </Text>
          <Text style={s.bladeTermVal}>{agent.newTokens >= 1000 ? (agent.newTokens / 1000).toFixed(0) + 'K' : agent.newTokens}</Text>
        </Text>
        <Text style={s.bladeTermLine}>
          <Text style={s.bladeTermLabel}>$    </Text>
          <Text style={s.bladeTermCost}>${agent.costToday.toFixed(3)}</Text>
        </Text>
        <Text style={s.bladeTermLine}>
          <Text style={s.bladeTermLabel}>CCHE </Text>
          <Text style={[s.bladeTermVal, cacheRate > 50 ? s.cacheHigh : cacheRate > 0 ? s.cacheMid : null]}>{cacheRate}%</Text>
        </Text>
        <Text style={s.bladeTermLine}>
          <Text style={s.bladeTermLabel}>TRN  </Text>
          <Text style={s.bladeTermVal}>{agent.turns}</Text>
        </Text>
        <Text style={s.bladeTermLine}>
          <Text style={s.bladeTermLabel}>MSG  </Text>
          <Text style={s.bladeTermVal}>{agent.messagesProcessed}</Text>
        </Text>
        <Text style={s.bladeTermLine}>
          <Text style={s.bladeTermLabel}>T/M  </Text>
          <Text style={s.bladeTermVal}>{tokPerMsg > 0 ? tokPerMsg.toLocaleString() : '-'}</Text>
        </Text>
        <Text style={s.bladeTermLine}>
          <Text style={s.bladeTermLabel}>$/M  </Text>
          <Text style={[s.bladeTermCost, costPerMsg > 0.1 ? { color: '#ef4444' } : null]}>
            {costPerMsg > 0 ? '$' + costPerMsg.toFixed(4) : '-'}
          </Text>
        </Text>
      </View>

      {/* Performance breakdown (if score available) */}
      {score && (
        <View style={s.bladeScoreSection}>
          <View style={s.bladeScoreRow}>
            <Text style={s.bladeScoreLabel}>REL</Text>
            <MiniBar value={score.breakdown.reliability} max={100} color="#22c55e" width={24} />
          </View>
          <View style={s.bladeScoreRow}>
            <Text style={s.bladeScoreLabel}>EFF</Text>
            <MiniBar value={score.breakdown.efficiency} max={100} color="#3b82f6" width={24} />
          </View>
          <View style={s.bladeScoreRow}>
            <Text style={s.bladeScoreLabel}>PRD</Text>
            <MiniBar value={score.breakdown.productivity} max={100} color="#eab308" width={24} />
          </View>
          <View style={s.bladeScoreRow}>
            <Text style={s.bladeScoreLabel}>QUA</Text>
            <MiniBar value={score.breakdown.quality} max={100} color="#a855f7" width={24} />
          </View>
          <Text style={s.bladeScoreTotal}>SCORE {score.overall}/100</Text>
        </View>
      )}

      {/* Connection info */}
      <View style={s.bladeConnInfo}>
        <Text style={s.bladeConnText} numberOfLines={1}>{agent.connectionName.slice(0, 12)}</Text>
        <Text style={s.bladeProviderText} numberOfLines={1}>{String(agent.providerType).slice(0, 8)}</Text>
      </View>

      {/* Vent slots */}
      <View style={s.bladeVents}>
        {[0, 1, 2, 3, 4, 5, 6, 7].map(i => (
          <View key={i} style={s.bladeVent} />
        ))}
      </View>

      {/* Status bar at bottom */}
      <View style={[s.bladeStatusBar, { backgroundColor: statusColor + '30' }]}>
        <View style={[s.bladeStatusDot, { backgroundColor: statusColor }]} />
        <Text style={[s.bladeStatusText, { color: statusColor }]}>
          {agent.status.toUpperCase()}
        </Text>
      </View>
    </View>
  );
}

/* ─── Health status color ─── */
const HEALTH_COLORS: Record<string, string> = {
  excellent: '#22c55e', good: '#22c55e', fair: '#eab308', poor: '#f97316', critical: '#ef4444',
};

/* ─── Main horizontal server rack ─── */
export default function ServerRack({ agents = [] }: { agents?: OfficeAgent[] }) {
  const [collapsed, setCollapsed] = useState(true);
  // ── Computed metrics ──
  const activeCount = agents.filter(a => a.status === 'active').length;
  const idleCount = agents.filter(a => a.status === 'idle').length;
  const errorCount = agents.filter(a => a.status === 'error').length;
  const offlineCount = agents.filter(a => a.status === 'offline').length;
  const totalCost = agents.reduce((sum, a) => sum + a.costToday, 0);
  const totalCostWeek = agents.reduce((sum, a) => sum + a.costWeek, 0);
  const totalTokens = agents.reduce((sum, a) => sum + a.tokensUsed, 0);
  const totalInput = agents.reduce((sum, a) => sum + a.inputTokens, 0);
  const totalOutput = agents.reduce((sum, a) => sum + a.outputTokens, 0);
  const totalCached = agents.reduce((sum, a) => sum + a.cachedTokens, 0);
  const totalNew = agents.reduce((sum, a) => sum + a.newTokens, 0);
  const cacheRate = totalInput > 0 ? Math.round((totalCached / totalInput) * 100) : 0;
  const totalTurns = agents.reduce((sum, a) => sum + a.turns, 0);
  const totalMessages = agents.reduce((sum, a) => sum + a.messagesProcessed, 0);
  const models = [...new Set(agents.map(a => a.model).filter(Boolean))];
  const providers = [...new Set(agents.map(a => a.providerType).filter(Boolean))];
  const connections = [...new Set(agents.map(a => a.connectionName).filter(Boolean))];
  const tokLabel = totalTokens >= 1_000_000
    ? (totalTokens / 1_000_000).toFixed(2) + 'M'
    : (totalTokens / 1_000).toFixed(1) + 'K';

  // Avg tokens per message
  const avgTokPerMsg = totalMessages > 0 ? Math.round(totalTokens / totalMessages) : 0;
  const avgCostPerMsg = totalMessages > 0 ? totalCost / totalMessages : 0;

  // ── Farm analytics (memoized) ──
  const scores = useMemo(() =>
    agents.map(a => calculateAgentScore(a, [], agents)),
    [agents]
  );
  const workloads = useMemo(() => analyzeWorkloadDistribution(agents), [agents]);
  const healthCheck = useMemo(() => performHealthCheck(agents, []), [agents]);
  const costOpts = useMemo(() => generateCostOptimizations(agents, []), [agents]);

  const avgScore = scores.length > 0 ? Math.round(scores.reduce((s, sc) => s + sc.overall, 0) / scores.length) : 0;
  const healthStatus = errorCount > 0 ? 'critical' : avgScore >= 80 ? 'excellent' : avgScore >= 70 ? 'good' : avgScore >= 60 ? 'fair' : 'poor';
  const healthColor = HEALTH_COLORS[healthStatus] || '#555';

  // Simulated cluster vitals derived from real data
  const clusterCpu = agents.length > 0 ? Math.round(workloads.reduce((s, w) => s + w.currentLoad, 0) / agents.length) : 0;
  const clusterMem = totalTokens > 0 ? Math.min(92, Math.round(20 + (totalCached / Math.max(1, totalTokens)) * 60 + agents.length * 3)) : 5;
  const clusterDisk = Math.min(88, Math.round(8 + totalMessages * 0.3 + totalTurns * 0.2));
  const clusterNet = Math.min(95, Math.round(5 + (totalInput + totalOutput) / 10000));
  const clusterTemp = Math.round(32 + clusterCpu * 0.35 + agents.length * 2);
  const totalCapacity = workloads.reduce((s, w) => s + w.estimatedCapacity, 0);
  const overloadedCount = workloads.filter(w => w.recommendedAction === 'overloaded').length;
  const optimalCount = workloads.filter(w => w.recommendedAction === 'optimal').length;
  const idleWorkloadCount = workloads.filter(w => w.recommendedAction === 'add_tasks').length;

  // Score helper for blade lookup
  const scoreMap = new Map(scores.map(sc => [sc.agentId, sc]));
  const workloadMap = new Map(workloads.map(w => [w.agentId, w]));

  if (collapsed) {
    return (
      <View style={s.collapsedRack}>
        {/* Top rail */}
        <View style={s.collapsedRail}>
          <View style={s.railScrew} />
          <View style={s.railGroove} />
          <View style={s.railScrew} />
          <View style={s.railGroove} />
          <View style={s.railScrew} />
        </View>

        {/* Main mini chassis */}
        <View style={s.collapsedChassis}>
          {/* Left: health + status LEDs */}
          <View style={s.collapsedLeftCol}>
            <View style={s.collapsedHealthBadge}>
              <BlinkingLED color={healthColor} delay={0} size={4} />
              <Text style={[s.collapsedHealthText, { color: healthColor }]}>{healthStatus.toUpperCase()}</Text>
            </View>
            <View style={s.collapsedLedBank}>
              {agents.slice(0, 12).map((a, i) => (
                <BlinkingLED key={i} color={STATUS_COLORS[a.status] || '#333'} delay={i * 80} size={3} />
              ))}
            </View>
            <View style={s.collapsedPowerRow}>
              <BlinkingLED color="#22c55e" delay={0} size={3} />
              <Text style={s.collapsedPowerLabel}>PWR</Text>
              <View style={s.collapsedPowerTrack}>
                <View style={[s.collapsedPowerFill, { width: `${Math.min(100, Math.max(15, activeCount / Math.max(1, agents.length) * 100))}%` as any }]} />
              </View>
            </View>
          </View>

          {/* Center: node summary grid */}
          <View style={s.collapsedCenter}>
            <View style={s.collapsedCenterHeader}>
              <Text style={s.collapsedTitle}>RACK-01</Text>
              <ScanLine />
              <Text style={s.collapsedUnitCount}>{agents.length} BLADES</Text>
            </View>
            {/* Stats grid */}
            <View style={s.collapsedStatsGrid}>
              <View style={s.collapsedStatCell}>
                <Text style={s.collapsedStatLabel}>ACTV</Text>
                <Text style={[s.collapsedStatVal, { color: '#22c55e' }]}>{activeCount}</Text>
              </View>
              <View style={s.collapsedStatCell}>
                <Text style={s.collapsedStatLabel}>IDLE</Text>
                <Text style={[s.collapsedStatVal, { color: '#eab308' }]}>{idleCount}</Text>
              </View>
              <View style={s.collapsedStatCell}>
                <Text style={s.collapsedStatLabel}>ERR</Text>
                <Text style={[s.collapsedStatVal, { color: errorCount > 0 ? '#ef4444' : '#333' }]}>{errorCount}</Text>
              </View>
              <View style={s.collapsedStatCell}>
                <Text style={s.collapsedStatLabel}>TOKENS</Text>
                <Text style={s.collapsedStatVal}>{tokLabel}</Text>
              </View>
              <View style={s.collapsedStatCell}>
                <Text style={s.collapsedStatLabel}>COST</Text>
                <Text style={[s.collapsedStatVal, { color: '#f59e0b' }]}>${totalCost.toFixed(3)}</Text>
              </View>
              <View style={s.collapsedStatCell}>
                <Text style={s.collapsedStatLabel}>SCORE</Text>
                <Text style={[s.collapsedStatVal, { color: healthColor }]}>{avgScore}pt</Text>
              </View>
              <View style={s.collapsedStatCell}>
                <Text style={s.collapsedStatLabel}>CPU</Text>
                <MiniBar value={clusterCpu} max={100} color={clusterCpu > 80 ? '#ef4444' : clusterCpu > 50 ? '#eab308' : '#22c55e'} width={24} />
              </View>
              <View style={s.collapsedStatCell}>
                <Text style={s.collapsedStatLabel}>MEM</Text>
                <MiniBar value={clusterMem} max={100} color={clusterMem > 80 ? '#ef4444' : '#3b82f6'} width={24} />
              </View>
              <View style={s.collapsedStatCell}>
                <Text style={s.collapsedStatLabel}>CACHE</Text>
                <Text style={[s.collapsedStatVal, cacheRate > 50 ? { color: '#22c55e' } : null]}>{cacheRate}%</Text>
              </View>
            </View>
            {/* Mini blade status row */}
            <View style={s.collapsedBladeRow}>
              {agents.map((a, i) => {
                const sc = scoreMap.get(a.id);
                const gc = sc ? (GRADE_COLORS[sc.grade] || '#555') : '#333';
                return (
                  <View key={i} style={[s.collapsedBladeMini, { borderColor: gc + '60' }]}>
                    <View style={[s.collapsedBladeLed, { backgroundColor: STATUS_COLORS[a.status] || '#333' }]} />
                    <Text style={s.collapsedBladeName}>{a.name.slice(0, 4)}</Text>
                    {sc && <Text style={[s.collapsedBladeGrade, { color: gc }]}>{sc.grade}</Text>}
                  </View>
                );
              })}
            </View>
          </View>

          {/* Right: expand button + quick ops */}
          <View style={s.collapsedRightCol}>
            <Pressable onPress={() => setCollapsed(false)} style={s.collapsedExpandBtn}>
              <Text style={s.collapsedExpandIcon}>⬆</Text>
              <Text style={s.collapsedExpandText}>EXPAND</Text>
            </Pressable>
            {healthCheck.issues.length > 0 && (
              <View style={s.collapsedAlertRow}>
                <SeverityDot severity={healthCheck.issues[0]?.severity || 'info'} />
                <Text style={s.collapsedAlertText} numberOfLines={1}>{healthCheck.issues.length} issue{healthCheck.issues.length !== 1 ? 's' : ''}</Text>
              </View>
            )}
            {costOpts.length > 0 && (
              <View style={s.collapsedAlertRow}>
                <View style={[s.severityDot, { backgroundColor: '#f59e0b' }]} />
                <Text style={s.collapsedAlertText} numberOfLines={1}>{costOpts.length} optim</Text>
              </View>
            )}
            <View style={s.collapsedScrews}>
              <View style={s.railScrew} />
              <View style={s.railScrew} />
            </View>
          </View>
        </View>

        {/* Bottom rail */}
        <View style={s.collapsedRail}>
          <View style={s.railScrew} />
          <View style={s.railGroove} />
          <View style={s.railScrew} />
          <View style={s.railGroove} />
          <View style={s.railScrew} />
        </View>

        {/* Floor label */}
        <Text style={s.collapsedFloorLabel}>RACK-01 · {agents.length} BLADES · {healthStatus.toUpperCase()}</Text>
      </View>
    );
  }

  return (
    <View style={s.expandedRack}>
      {/* Minimize button */}
      <Pressable onPress={() => setCollapsed(true)} style={s.expandedMinBtn}>
        <Text style={s.expandedMinBtnText}>▼ MINIMIZE</Text>
      </Pressable>
      {/* Top mounting rail with screws */}
      <View style={s.mountRail}>
        <View style={s.railScrew} />
        <View style={s.railGroove} />
        <View style={s.railScrew} />
        <View style={s.railGroove} />
        <View style={s.railScrew} />
        <View style={s.railGroove} />
        <View style={s.railScrew} />
      </View>

      {/* Main chassis */}
      <View style={s.chassis}>
        {/* ════ Left panel: System overview ════ */}
        <View style={s.sysPanel}>
          <View style={s.sysPanelHeader}>
            <BlinkingLED color="#22c55e" delay={0} size={4} />
            <Text style={s.sysPanelTitle}>SYS MONITOR</Text>
            <BlinkingLED color="#3b82f6" delay={200} size={3} />
          </View>

          <View style={s.sysTerm}>
            {/* Health status */}
            <View style={s.healthBanner}>
              <BlinkingLED color={healthColor} delay={0} size={4} />
              <Text style={[s.healthText, { color: healthColor }]}>{healthStatus.toUpperCase()}</Text>
              <Text style={s.healthScore}>{avgScore}pt</Text>
            </View>

            {/* Cluster nodes */}
            <Text style={s.sysTermHeader}>◆ CLUSTER</Text>
            <View style={s.sysRow}>
              <Text style={s.sysLabel}>NODES</Text>
              <Text style={s.sysVal}>{agents.length}</Text>
            </View>
            <View style={s.sysRow}>
              <Text style={s.sysLabel}>ACTV</Text>
              <Text style={[s.sysVal, { color: '#22c55e' }]}>{activeCount}</Text>
            </View>
            <View style={s.sysRow}>
              <Text style={s.sysLabel}>IDLE</Text>
              <Text style={[s.sysVal, { color: '#eab308' }]}>{idleCount}</Text>
            </View>
            {errorCount > 0 && (
              <View style={s.sysRow}>
                <Text style={s.sysLabel}>ERR</Text>
                <Text style={[s.sysVal, { color: '#ef4444' }]}>{errorCount}</Text>
              </View>
            )}
            {offlineCount > 0 && (
              <View style={s.sysRow}>
                <Text style={s.sysLabel}>OFF</Text>
                <Text style={[s.sysVal, { color: '#6b7280' }]}>{offlineCount}</Text>
              </View>
            )}

            <View style={s.sysDivider} />

            {/* System vitals */}
            <Text style={s.sysTermHeader}>◆ VITALS</Text>
            <View style={s.sysRow}>
              <Text style={s.sysLabel}>CPU</Text>
              <MiniBar value={clusterCpu} max={100} color={clusterCpu > 80 ? '#ef4444' : clusterCpu > 50 ? '#eab308' : '#22c55e'} width={28} />
              <Text style={s.sysVal}>{clusterCpu}%</Text>
            </View>
            <View style={s.sysRow}>
              <Text style={s.sysLabel}>MEM</Text>
              <MiniBar value={clusterMem} max={100} color={clusterMem > 80 ? '#ef4444' : '#3b82f6'} width={28} />
              <Text style={s.sysVal}>{clusterMem}%</Text>
            </View>
            <View style={s.sysRow}>
              <Text style={s.sysLabel}>DISK</Text>
              <MiniBar value={clusterDisk} max={100} color={clusterDisk > 80 ? '#f97316' : '#3b82f6'} width={28} />
              <Text style={s.sysVal}>{clusterDisk}%</Text>
            </View>
            <View style={s.sysRow}>
              <Text style={s.sysLabel}>NET</Text>
              <MiniBar value={clusterNet} max={100} color={clusterNet > 80 ? '#eab308' : '#22c55e'} width={28} />
              <Text style={s.sysVal}>{clusterNet}%</Text>
            </View>
            <View style={s.sysRow}>
              <Text style={s.sysLabel}>TEMP</Text>
              <Text style={[s.sysVal, clusterTemp > 65 ? { color: '#ef4444' } : clusterTemp > 50 ? { color: '#eab308' } : null]}>{clusterTemp}°C</Text>
            </View>

            <View style={s.sysDivider} />

            {/* Token flow */}
            <Text style={s.sysTermHeader}>◆ TOKEN FLOW</Text>
            <View style={s.sysRow}>
              <Text style={s.sysLabel}>TOTAL</Text>
              <Text style={s.sysVal}>{tokLabel}</Text>
            </View>
            <View style={s.sysRow}>
              <Text style={s.sysLabel}>IN</Text>
              <Text style={s.sysVal}>{totalInput >= 1000 ? (totalInput / 1000).toFixed(1) + 'K' : totalInput}</Text>
            </View>
            <View style={s.sysRow}>
              <Text style={s.sysLabel}>OUT</Text>
              <Text style={s.sysVal}>{totalOutput >= 1000 ? (totalOutput / 1000).toFixed(1) + 'K' : totalOutput}</Text>
            </View>
            <View style={s.sysRow}>
              <Text style={s.sysLabel}>CCHD</Text>
              <Text style={s.sysVal}>{totalCached >= 1000 ? (totalCached / 1000).toFixed(1) + 'K' : totalCached}</Text>
            </View>
            <View style={s.sysRow}>
              <Text style={s.sysLabel}>NEW</Text>
              <Text style={s.sysVal}>{totalNew >= 1000 ? (totalNew / 1000).toFixed(1) + 'K' : totalNew}</Text>
            </View>
            <View style={s.sysRow}>
              <Text style={s.sysLabel}>CACHE</Text>
              <Text style={[s.sysVal, cacheRate > 50 ? { color: '#22c55e' } : cacheRate > 0 ? { color: '#eab308' } : null]}>{cacheRate}%</Text>
            </View>

            <View style={s.sysDivider} />

            {/* Billing */}
            <Text style={s.sysTermHeader}>◆ BILLING</Text>
            <View style={s.sysRow}>
              <Text style={s.sysLabel}>TODAY</Text>
              <Text style={s.sysCost}>${totalCost.toFixed(4)}</Text>
            </View>
            {totalCostWeek > 0 && (
              <View style={s.sysRow}>
                <Text style={s.sysLabel}>WEEK</Text>
                <Text style={s.sysCost}>${totalCostWeek.toFixed(3)}</Text>
              </View>
            )}
            <View style={s.sysRow}>
              <Text style={s.sysLabel}>TURNS</Text>
              <Text style={s.sysVal}>{totalTurns}</Text>
            </View>
            <View style={s.sysRow}>
              <Text style={s.sysLabel}>MSGS</Text>
              <Text style={s.sysVal}>{totalMessages}</Text>
            </View>

            <View style={s.sysDivider} />

            {/* Throughput / efficiency */}
            <Text style={s.sysTermHeader}>◆ EFFICIENCY</Text>
            <View style={s.sysRow}>
              <Text style={s.sysLabel}>T/MSG</Text>
              <Text style={s.sysVal}>{avgTokPerMsg > 0 ? avgTokPerMsg.toLocaleString() : '-'}</Text>
            </View>
            <View style={s.sysRow}>
              <Text style={s.sysLabel}>$/MSG</Text>
              <Text style={[s.sysCost, avgCostPerMsg > 0.1 ? { color: '#ef4444' } : null]}>
                {avgCostPerMsg > 0 ? '$' + avgCostPerMsg.toFixed(4) : '-'}
              </Text>
            </View>
            <View style={s.sysRow}>
              <Text style={s.sysLabel}>CAP</Text>
              <Text style={s.sysVal}>{totalCapacity}/hr</Text>
            </View>

            <View style={s.sysDivider} />

            {/* Workload distribution */}
            <Text style={s.sysTermHeader}>◆ WORKLOAD</Text>
            <View style={s.sysRow}>
              <Text style={s.sysLabel}>OVRLD</Text>
              <Text style={[s.sysVal, overloadedCount > 0 ? { color: '#ef4444' } : null]}>{overloadedCount}</Text>
            </View>
            <View style={s.sysRow}>
              <Text style={s.sysLabel}>OPTIM</Text>
              <Text style={[s.sysVal, { color: '#22c55e' }]}>{optimalCount}</Text>
            </View>
            <View style={s.sysRow}>
              <Text style={s.sysLabel}>AVAIL</Text>
              <Text style={[s.sysVal, { color: '#3b82f6' }]}>{idleWorkloadCount}</Text>
            </View>

            <View style={s.sysDivider} />

            {/* Infra */}
            <Text style={s.sysTermHeader}>◆ INFRA</Text>
            {models.map((m, i) => (
              <View key={i} style={s.sysRow}>
                <Text style={s.sysModelLine} numberOfLines={1}>
                  {m.replace('claude-', '').replace(/-202\d+/, '').slice(0, 14)}
                </Text>
                <Text style={s.sysModelPrice}>${resolveModelRate(m).inPer1M}/M</Text>
              </View>
            ))}
            {connections.map((c, i) => (
              <Text key={`c${i}`} style={s.sysConnLine} numberOfLines={1}>
                ⊕ {c.slice(0, 14)}
              </Text>
            ))}
          </View>

          {/* Power bar */}
          <View style={s.powerBar}>
            <BlinkingLED color="#22c55e" delay={0} size={3} />
            <Text style={s.powerLabel}>PWR</Text>
            <View style={s.powerTrack}>
              <View style={[s.powerFill, { width: `${Math.min(100, Math.max(15, activeCount / Math.max(1, agents.length) * 100))}%` as any }]} />
            </View>
          </View>
        </View>

        {/* ════ Center: Agent blade servers ════ */}
        <View style={s.bladeSection}>
          <View style={s.bladeSectionHeader}>
            <Text style={s.bladeSectionTitle}>AGENT BLADES</Text>
            <ScanLine />
            <Text style={s.bladeSectionCount}>{agents.length} UNITS</Text>
          </View>
          <View style={s.bladeRow}>
            {agents.map((agent, i) => (
              <AgentBlade
                key={agent.id}
                agent={agent}
                index={i}
                score={scoreMap.get(agent.id) ?? null}
                workload={workloadMap.get(agent.id) ?? null}
              />
            ))}
            {/* Empty slots */}
            {agents.length < 6 && Array.from({ length: Math.min(3, 6 - agents.length) }).map((_, i) => (
              <View key={`empty-${i}`} style={s.bladeEmpty}>
                <View style={s.bladeEmptySlot}>
                  <Text style={s.bladeEmptyText}>EMPTY</Text>
                  <View style={s.bladeEmptyVents}>
                    {[0, 1, 2].map(j => (
                      <View key={j} style={s.bladeVent} />
                    ))}
                  </View>
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* ════ Right panel: Network, Health, Optimizations ════ */}
        <View style={s.netPanel}>
          <View style={s.netPanelHeader}>
            <Text style={s.netPanelTitle}>NET / OPS</Text>
            <BlinkingLED color="#3b82f6" delay={100} size={3} />
          </View>

          {/* Network activity LEDs */}
          <View style={s.netLedGrid}>
            {agents.slice(0, 8).map((a, i) => (
              <View key={i} style={s.netLedItem}>
                <BlinkingLED
                  color={a.status === 'active' ? '#22c55e' : a.status === 'idle' ? '#eab308' : '#ef4444'}
                  delay={i * 120}
                  size={3}
                />
                <Text style={s.netLedLabel}>{a.name.slice(0, 3)}</Text>
              </View>
            ))}
          </View>

          {/* Quick stats */}
          <View style={s.netStats}>
            <View style={s.netStatRow}>
              <Text style={s.netStatLabel}>MSG</Text>
              <Text style={s.netStatVal}>{totalMessages}</Text>
            </View>
            <View style={s.netStatRow}>
              <Text style={s.netStatLabel}>CONN</Text>
              <Text style={s.netStatVal}>{connections.length}</Text>
            </View>
            <View style={s.netStatRow}>
              <Text style={s.netStatLabel}>PROV</Text>
              <Text style={s.netStatVal}>{providers.length}</Text>
            </View>
            <View style={s.netStatRow}>
              <Text style={s.netStatLabel}>MDLS</Text>
              <Text style={s.netStatVal}>{models.length}</Text>
            </View>
          </View>

          {/* Provider badges */}
          <View style={s.providerList}>
            {providers.map((p, i) => (
              <View key={i} style={s.providerBadge}>
                <BlinkingLED color="#6366f1" delay={i * 300} size={2} />
                <Text style={s.providerText} numberOfLines={1}>{String(p).slice(0, 10)}</Text>
              </View>
            ))}
          </View>

          {/* Health check issues */}
          {healthCheck.issues.length > 0 && (
            <View style={s.healthSection}>
              <Text style={s.healthSectionTitle}>◆ HEALTH LOG</Text>
              {healthCheck.issues.slice(0, 4).map((issue, i) => (
                <View key={i} style={s.healthIssueRow}>
                  <SeverityDot severity={issue.severity} />
                  <Text style={s.healthIssueText} numberOfLines={1}>{issue.message.slice(0, 20)}</Text>
                </View>
              ))}
              {!healthCheck.passed && (
                <View style={s.healthFailBanner}>
                  <Text style={s.healthFailText}>CHECK FAILED</Text>
                </View>
              )}
            </View>
          )}

          {/* Cost optimization suggestions */}
          {costOpts.length > 0 && (
            <View style={s.optSection}>
              <Text style={s.optSectionTitle}>◆ OPTIMIZE</Text>
              {costOpts.slice(0, 3).map((opt, i) => (
                <View key={i} style={s.optRow}>
                  <View style={[s.optPriorityDot, {
                    backgroundColor: opt.priority === 'high' ? '#ef4444' : opt.priority === 'medium' ? '#f59e0b' : '#3b82f6',
                  }]} />
                  <Text style={s.optText} numberOfLines={2}>
                    {opt.type === 'model_downgrade' ? '↓ DOWNGRADE' :
                     opt.type === 'archive_inactive' ? '📦 ARCHIVE' :
                     opt.type === 'consolidate_agents' ? '🔗 MERGE' : '⚡ BATCH'}
                  </Text>
                  <Text style={s.optSaving}>-${opt.potentialSavings.toFixed(2)}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Bottom screws */}
          <View style={s.netScrews}>
            <View style={s.railScrew} />
            <View style={s.railScrew} />
          </View>
        </View>
      </View>

      {/* Bottom mounting rail */}
      <View style={s.mountRail}>
        <View style={s.railScrew} />
        <View style={s.railGroove} />
        <View style={s.railScrew} />
        <View style={s.railGroove} />
        <View style={s.railScrew} />
        <View style={s.railGroove} />
        <View style={s.railScrew} />
      </View>

      {/* Floor label */}
      <Text style={s.floorLabel}>RACK-01 · {agents.length} BLADES · {tokLabel} TOK · ${totalCost.toFixed(3)} · {healthStatus.toUpperCase()}</Text>
    </View>
  );
}

/* ─── Styles ─── */
const s = StyleSheet.create({
  // ── Collapsed (minimized) rack ──
  collapsedRack: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: 8,
    zIndex: 12,
    alignItems: 'center',
  },
  collapsedRail: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    height: 5,
    backgroundColor: '#2a2a2a',
    borderRadius: 1,
    paddingHorizontal: 6,
  },
  collapsedChassis: {
    flexDirection: 'row',
    width: '100%',
    backgroundColor: '#08080f',
    borderLeftWidth: 2,
    borderRightWidth: 2,
    borderColor: '#2a2a2a',
    minHeight: 70,
  },
  collapsedLeftCol: {
    width: 70,
    backgroundColor: '#0a0a14',
    borderRightWidth: 1,
    borderRightColor: '#2a2a2a',
    padding: 4,
    gap: 3,
  },
  collapsedHealthBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#0c0c18',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 2,
    padding: 2,
  },
  collapsedHealthText: {
    fontSize: 5,
    fontFamily: 'monospace',
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  collapsedLedBank: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 2,
    paddingVertical: 1,
  },
  collapsedPowerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginTop: 'auto',
    paddingTop: 2,
    borderTopWidth: 1,
    borderTopColor: '#2a2a2a',
  },
  collapsedPowerLabel: {
    fontSize: 3.5,
    color: '#333',
    fontFamily: 'monospace',
    fontWeight: '700',
  },
  collapsedPowerTrack: {
    flex: 1,
    height: 3,
    backgroundColor: '#111',
    borderRadius: 1.5,
    overflow: 'hidden',
  },
  collapsedPowerFill: {
    height: '100%',
    backgroundColor: '#22c55e',
    borderRadius: 1.5,
  },
  collapsedCenter: {
    flex: 1,
    padding: 4,
    gap: 3,
  },
  collapsedCenterHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 2,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
    overflow: 'hidden',
  },
  collapsedTitle: {
    fontSize: 6,
    color: '#555',
    fontFamily: 'monospace',
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  collapsedUnitCount: {
    fontSize: 4,
    color: '#333',
    fontFamily: 'monospace',
    fontWeight: '700',
  },
  collapsedStatsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 2,
  },
  collapsedStatCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#0c0c18',
    borderWidth: 0.5,
    borderColor: '#2a2a2a',
    borderRadius: 1,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  collapsedStatLabel: {
    fontSize: 3.5,
    color: '#555',
    fontFamily: 'monospace',
    fontWeight: '700',
  },
  collapsedStatVal: {
    fontSize: 4,
    color: '#aaa',
    fontFamily: 'monospace',
    fontWeight: '800',
  },
  collapsedBladeRow: {
    flexDirection: 'row',
    gap: 2,
    flexWrap: 'wrap',
  },
  collapsedBladeMini: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: '#0c0c18',
    borderWidth: 0.5,
    borderRadius: 1,
    paddingHorizontal: 3,
    paddingVertical: 1,
  },
  collapsedBladeLed: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
  },
  collapsedBladeName: {
    fontSize: 3.5,
    color: '#888',
    fontFamily: 'monospace',
    fontWeight: '700',
  },
  collapsedBladeGrade: {
    fontSize: 3.5,
    fontFamily: 'monospace',
    fontWeight: '800',
  },
  collapsedRightCol: {
    width: 50,
    backgroundColor: '#0a0a14',
    borderLeftWidth: 1,
    borderLeftColor: '#2a2a2a',
    padding: 4,
    alignItems: 'center',
    gap: 3,
  },
  collapsedExpandBtn: {
    alignItems: 'center',
    backgroundColor: '#3b82f615',
    borderWidth: 1,
    borderColor: '#3b82f640',
    borderRadius: 2,
    paddingVertical: 3,
    paddingHorizontal: 6,
    gap: 1,
  },
  collapsedExpandIcon: {
    fontSize: 6,
    color: '#3b82f6',
  },
  collapsedExpandText: {
    fontSize: 3.5,
    color: '#3b82f6',
    fontFamily: 'monospace',
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  collapsedAlertRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  collapsedAlertText: {
    fontSize: 3,
    color: '#888',
    fontFamily: 'monospace',
  },
  collapsedScrews: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 'auto',
    paddingTop: 3,
  },
  collapsedFloorLabel: {
    fontSize: 4,
    color: '#333333',
    fontFamily: 'monospace',
    marginTop: 2,
    letterSpacing: 0.5,
  },

  // ── Expanded rack (anchored to bottom, auto-height) ──
  expandedRack: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: 8,
    zIndex: 12,
    alignItems: 'center',
  },
  expandedMinBtn: {
    alignSelf: 'flex-end',
    backgroundColor: '#3b82f610',
    borderWidth: 1,
    borderColor: '#3b82f630',
    borderRadius: 2,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginBottom: 2,
  },
  expandedMinBtnText: {
    fontSize: 5,
    color: '#3b82f6',
    fontFamily: 'monospace',
    fontWeight: '700',
  },
  // Mounting rails
  mountRail: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    height: 6,
    backgroundColor: '#2a2a2a',
    borderRadius: 1,
    paddingHorizontal: 8,
  },
  railScrew: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#333333',
    borderWidth: 0.5,
    borderColor: '#3d3d3d',
  },
  railGroove: {
    flex: 1,
    height: 1,
    backgroundColor: '#222',
    marginHorizontal: 4,
  },
  // Main chassis
  chassis: {
    flexDirection: 'row',
    width: '100%',
    backgroundColor: '#08080f',
    borderLeftWidth: 2,
    borderRightWidth: 2,
    borderColor: '#2a2a2a',
    minHeight: 130,
  },
  // ── System panel (left) ──
  sysPanel: {
    width: 110,
    backgroundColor: '#0a0a14',
    borderRightWidth: 1,
    borderRightColor: '#2a2a2a',
    padding: 4,
  },
  sysPanelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 3,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
    marginBottom: 3,
  },
  sysPanelTitle: {
    fontSize: 5,
    color: '#22c55e',
    fontFamily: 'monospace',
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  healthBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#0c0c18',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 2,
    padding: 3,
    marginBottom: 2,
  },
  healthText: {
    fontSize: 5,
    fontFamily: 'monospace',
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  healthScore: {
    fontSize: 4,
    color: '#666',
    fontFamily: 'monospace',
    fontWeight: '700',
    marginLeft: 'auto',
  },
  sysTerm: {
    flex: 1,
    gap: 1,
  },
  sysTermHeader: {
    fontSize: 4,
    color: '#6366f1',
    fontFamily: 'monospace',
    fontWeight: '800',
    marginTop: 2,
    marginBottom: 1,
  },
  sysRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  sysLabel: {
    fontSize: 4,
    color: '#555',
    fontFamily: 'monospace',
    fontWeight: '700',
    width: 28,
  },
  sysVal: {
    fontSize: 4,
    color: '#aaa',
    fontFamily: 'monospace',
    fontWeight: '700',
  },
  sysCost: {
    fontSize: 4,
    color: '#f59e0b',
    fontFamily: 'monospace',
    fontWeight: '800',
  },
  sysDivider: {
    height: 1,
    backgroundColor: '#2a2a2a',
    marginVertical: 2,
  },
  sysModelLine: {
    fontSize: 3.5,
    color: '#6366f180',
    fontFamily: 'monospace',
  },
  sysModelPrice: {
    fontSize: 3.5,
    color: '#f59e0b80',
    fontFamily: 'monospace',
    marginLeft: 'auto',
  },
  sysConnLine: {
    fontSize: 3.5,
    color: '#22c55e60',
    fontFamily: 'monospace',
    paddingLeft: 4,
  },
  // Power bar
  powerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingTop: 3,
    borderTopWidth: 1,
    borderTopColor: '#2a2a2a',
    marginTop: 3,
  },
  powerLabel: {
    fontSize: 4,
    color: '#333',
    fontFamily: 'monospace',
    fontWeight: '700',
  },
  powerTrack: {
    flex: 1,
    height: 3,
    backgroundColor: '#111',
    borderRadius: 1.5,
    overflow: 'hidden',
  },
  powerFill: {
    height: '100%',
    backgroundColor: '#22c55e',
    borderRadius: 1.5,
  },
  // ── Mini bar ──
  miniBarTrack: {
    height: 3,
    backgroundColor: '#111',
    borderRadius: 1.5,
    overflow: 'hidden',
  },
  miniBarFill: {
    height: '100%',
    borderRadius: 1.5,
  },
  // ── Grade badge ──
  gradeBadge: {
    width: 12,
    height: 10,
    borderRadius: 1,
    borderWidth: 0.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gradeText: {
    fontSize: 5,
    fontFamily: 'monospace',
    fontWeight: '800',
  },
  // ── Severity dot ──
  severityDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
  },
  // ── Blade section (center) ──
  bladeSection: {
    flex: 1,
    padding: 4,
  },
  bladeSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 3,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
    marginBottom: 4,
    overflow: 'hidden',
  },
  bladeSectionTitle: {
    fontSize: 5,
    color: '#555',
    fontFamily: 'monospace',
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  bladeSectionCount: {
    fontSize: 4,
    color: '#333',
    fontFamily: 'monospace',
    fontWeight: '700',
  },
  scanLine: {
    width: 2,
    height: 4,
    backgroundColor: '#22c55e40',
    borderRadius: 1,
  },
  bladeRow: {
    flexDirection: 'row',
    gap: 4,
    flexWrap: 'wrap',
  },
  // Individual blade
  blade: {
    width: 80,
    backgroundColor: '#0c0c18',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 2,
    padding: 3,
    gap: 2,
  },
  bladeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 2,
  },
  bladeId: {
    flex: 1,
    fontSize: 5,
    color: '#ccc',
    fontFamily: 'monospace',
    fontWeight: '800',
  },
  bladeModelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#111',
    borderRadius: 1,
    paddingHorizontal: 2,
    paddingVertical: 1,
  },
  bladeModel: {
    fontSize: 3.5,
    color: '#6366f1',
    fontFamily: 'monospace',
    fontWeight: '700',
  },
  bladePriceTier: {
    fontSize: 3,
    fontFamily: 'monospace',
    fontWeight: '800',
  },
  bladeRoleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  bladeRole: {
    fontSize: 3.5,
    color: '#555',
    fontFamily: 'monospace',
    fontWeight: '600',
  },
  bladeUptime: {
    fontSize: 3,
    color: '#444',
    fontFamily: 'monospace',
  },
  bladeLedBank: {
    flexDirection: 'row',
    gap: 2,
    paddingVertical: 1,
  },
  bladeLoadSection: {
    gap: 1,
  },
  bladeLoadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  bladeLoadLabel: {
    fontSize: 3,
    color: '#555',
    fontFamily: 'monospace',
    fontWeight: '700',
    width: 14,
  },
  bladeLoadPct: {
    fontSize: 3,
    color: '#777',
    fontFamily: 'monospace',
    fontWeight: '700',
    width: 16,
    textAlign: 'right',
  },
  bladeTerm: {
    backgroundColor: '#000',
    borderWidth: 0.5,
    borderColor: '#2a2a2a',
    borderRadius: 1,
    padding: 2,
    gap: 0.5,
  },
  bladeTermLine: {
    fontSize: 3.5,
    fontFamily: 'monospace',
    lineHeight: 5,
  },
  bladeTermLabel: {
    color: '#555',
    fontWeight: '700',
  },
  bladeTermVal: {
    color: '#aaa',
    fontWeight: '700',
  },
  bladeTermCost: {
    color: '#f59e0b',
    fontWeight: '800',
  },
  cacheHigh: {
    color: '#22c55e',
  },
  cacheMid: {
    color: '#eab308',
  },
  // Performance score section
  bladeScoreSection: {
    backgroundColor: '#0a0a16',
    borderWidth: 0.5,
    borderColor: '#2a2a2a',
    borderRadius: 1,
    padding: 2,
    gap: 1,
  },
  bladeScoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  bladeScoreLabel: {
    fontSize: 3,
    color: '#555',
    fontFamily: 'monospace',
    fontWeight: '700',
    width: 14,
  },
  bladeScoreTotal: {
    fontSize: 3.5,
    color: '#888',
    fontFamily: 'monospace',
    fontWeight: '800',
    textAlign: 'center',
    marginTop: 1,
  },
  // Connection info
  bladeConnInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  bladeConnText: {
    fontSize: 3,
    color: '#22c55e50',
    fontFamily: 'monospace',
  },
  bladeProviderText: {
    fontSize: 3,
    color: '#6366f150',
    fontFamily: 'monospace',
  },
  bladeVents: {
    flexDirection: 'row',
    gap: 1,
    justifyContent: 'center',
  },
  bladeVent: {
    width: 2,
    height: 4,
    backgroundColor: '#0f0f1a',
    borderWidth: 0.5,
    borderColor: '#2a2a2a',
  },
  bladeStatusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    borderRadius: 1,
    paddingVertical: 1,
  },
  bladeStatusDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
  },
  bladeStatusText: {
    fontSize: 3.5,
    fontFamily: 'monospace',
    fontWeight: '800',
  },
  // Empty blade slots
  bladeEmpty: {
    width: 80,
    backgroundColor: '#080810',
    borderWidth: 1,
    borderColor: '#12121e',
    borderRadius: 2,
    borderStyle: 'dashed',
    padding: 3,
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: 80,
  },
  bladeEmptySlot: {
    alignItems: 'center',
    gap: 4,
  },
  bladeEmptyText: {
    fontSize: 4,
    color: '#222',
    fontFamily: 'monospace',
    fontWeight: '700',
  },
  bladeEmptyVents: {
    flexDirection: 'row',
    gap: 2,
  },
  // ── Network / Ops panel (right) ──
  netPanel: {
    width: 80,
    backgroundColor: '#0a0a14',
    borderLeftWidth: 1,
    borderLeftColor: '#2a2a2a',
    padding: 4,
  },
  netPanelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 3,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
    marginBottom: 3,
  },
  netPanelTitle: {
    fontSize: 5,
    color: '#3b82f6',
    fontFamily: 'monospace',
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  netLedGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginBottom: 4,
  },
  netLedItem: {
    alignItems: 'center',
    gap: 1,
  },
  netLedLabel: {
    fontSize: 3,
    color: '#444',
    fontFamily: 'monospace',
    fontWeight: '700',
  },
  netStats: {
    gap: 2,
    borderTopWidth: 1,
    borderTopColor: '#2a2a2a',
    paddingTop: 3,
    marginBottom: 3,
  },
  netStatRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  netStatLabel: {
    fontSize: 4,
    color: '#555',
    fontFamily: 'monospace',
    fontWeight: '700',
  },
  netStatVal: {
    fontSize: 4,
    color: '#aaa',
    fontFamily: 'monospace',
    fontWeight: '700',
  },
  providerList: {
    gap: 2,
    borderTopWidth: 1,
    borderTopColor: '#2a2a2a',
    paddingTop: 3,
    marginBottom: 3,
  },
  providerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  providerText: {
    fontSize: 3.5,
    color: '#6366f180',
    fontFamily: 'monospace',
    fontWeight: '700',
  },
  // Health section
  healthSection: {
    borderTopWidth: 1,
    borderTopColor: '#2a2a2a',
    paddingTop: 3,
    marginBottom: 3,
    gap: 2,
  },
  healthSectionTitle: {
    fontSize: 4,
    color: '#ef4444',
    fontFamily: 'monospace',
    fontWeight: '800',
    marginBottom: 1,
  },
  healthIssueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  healthIssueText: {
    fontSize: 3,
    color: '#888',
    fontFamily: 'monospace',
    flex: 1,
  },
  healthFailBanner: {
    backgroundColor: '#ef444420',
    borderRadius: 1,
    paddingVertical: 1,
    paddingHorizontal: 3,
    marginTop: 1,
    alignItems: 'center',
  },
  healthFailText: {
    fontSize: 3.5,
    color: '#ef4444',
    fontFamily: 'monospace',
    fontWeight: '800',
  },
  // Cost optimization section
  optSection: {
    borderTopWidth: 1,
    borderTopColor: '#2a2a2a',
    paddingTop: 3,
    gap: 2,
  },
  optSectionTitle: {
    fontSize: 4,
    color: '#f59e0b',
    fontFamily: 'monospace',
    fontWeight: '800',
    marginBottom: 1,
  },
  optRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  optPriorityDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
  },
  optText: {
    fontSize: 3,
    color: '#888',
    fontFamily: 'monospace',
    flex: 1,
  },
  optSaving: {
    fontSize: 3.5,
    color: '#22c55e',
    fontFamily: 'monospace',
    fontWeight: '800',
  },
  netScrews: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 'auto',
    paddingTop: 4,
  },
  // Floor label
  floorLabel: {
    fontSize: 5,
    color: '#333',
    fontFamily: 'monospace',
    marginTop: 3,
    letterSpacing: 0.5,
  },
  // (old collapsed styles removed — new ones defined above)
});
