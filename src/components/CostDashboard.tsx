// Cost Analytics Dashboard - The #1 fundable feature
import React, { useMemo, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Platform, Modal } from 'react-native';
import { OpenClawSession } from '../lib/openclawService';
import { storage } from '../lib/storage';
import { OfficeAgent } from '../lib/officeAgents';
import { SessionTag } from '../lib/sessionTags';
import {
  generateExportData,
  exportToCSV,
  exportToJSON,
  exportToJSONWithSummary,
  downloadFile,
  copyToClipboard,
  generateFilename,
  getMimeType,
} from '../lib/dataExport';

interface CostData {
  today: number;
  todayChange: number;
  week: number;
  weekChange: number;
  month: number;
  monthChange: number;
  dailyHistory: Array<{ date: string; cost: number }>;
  topSpenders: Array<{ name: string; cost: number; percentage: number; sessions: number }>;
  insights: Array<{ type: 'warning' | 'tip' | 'success'; text: string }>;
  modelBreakdown: Array<{ model: string; cost: number; tokens: number; percentage: number; color: string }>;
  tokenBreakdown: { input: number; output: number; cached: number; newInput: number; total: number };
}

interface Props {
  sessions: OpenClawSession[];
  agents: OfficeAgent[];
  sessionTags: Map<string, SessionTag[]>;
  accentColor?: string;
}

const STORAGE_KEY_DATE_RANGE = '@cost_dashboard_date_range';

export default function CostDashboard({ sessions, agents, sessionTags, accentColor = '#6366f1' }: Props) {
  const [dateRange, setDateRange] = useState<7 | 30 | 90>(30);
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportStatus, setExportStatus] = useState<string>('');
  const costData = useMemo(() => calculateCostData(sessions, dateRange), [sessions, dateRange]);

  // Load saved date range preference on mount
  useEffect(() => {
    storage.getItem(STORAGE_KEY_DATE_RANGE).then(saved => {
      if (saved) {
        const parsed = parseInt(saved);
        if (parsed === 7 || parsed === 30 || parsed === 90) {
          setDateRange(parsed);
        }
      }
    }).catch(() => {});
  }, []);

  // Save date range when changed
  const handleDateRangeChange = (range: 7 | 30 | 90) => {
    setDateRange(range);
    storage.setItem(STORAGE_KEY_DATE_RANGE, range.toString()).catch(() => {});
  };

  // Empty state
  if (sessions.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyIcon}>📊</Text>
        <Text style={styles.emptyTitle}>No Agent Data Yet</Text>
        <Text style={styles.emptyText}>
          Connect your agents to see cost analytics, spending trends, and optimization insights.
        </Text>
      </View>
    );
  }


  async function handleExport(format: 'csv' | 'json' | 'json-summary') {
    try {
      setExportStatus('Generating export...');
      
      const exportData = generateExportData(agents, sessions, sessionTags);
      let content: string;
      let mimeType: string;
      let filename: string;

      switch (format) {
        case 'csv':
          content = exportToCSV(exportData);
          mimeType = getMimeType('csv');
          filename = generateFilename('csv');
          break;
        case 'json':
          content = exportToJSON(exportData);
          mimeType = getMimeType('json');
          filename = generateFilename('json');
          break;
        case 'json-summary':
          content = exportToJSONWithSummary(exportData);
          mimeType = getMimeType('json');
          filename = generateFilename('json');
          break;
      }

      downloadFile(content, filename, mimeType);
      setExportStatus(`✅ Downloaded ${filename}`);
      
      setTimeout(() => {
        setExportStatus('');
        setShowExportModal(false);
      }, 2000);
    } catch (error) {
      setExportStatus(`❌ Export failed: ${error}`);
      setTimeout(() => setExportStatus(''), 3000);
    }
  }

  async function handleCopyToClipboard() {
    try {
      setExportStatus('Copying to clipboard...');
      
      const exportData = generateExportData(agents, sessions, sessionTags);
      const content = exportToCSV(exportData);
      
      const success = await copyToClipboard(content);
      
      if (success) {
        setExportStatus('✅ Copied to clipboard!');
        setTimeout(() => {
          setExportStatus('');
          setShowExportModal(false);
        }, 2000);
      } else {
        setExportStatus('❌ Failed to copy');
        setTimeout(() => setExportStatus(''), 3000);
      }
    } catch (error) {
      setExportStatus(`❌ Copy failed: ${error}`);
      setTimeout(() => setExportStatus(''), 3000);
    }
  }
  return (
    <>
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Header with controls */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>COST ANALYTICS</Text>
        <View style={styles.headerControls}>
          {/* Date Range Selector */}
          <View style={styles.dateRangeSelector}>
            {[7, 30, 90].map(days => (
              <Pressable
                key={days}
                onPress={() => handleDateRangeChange(days as 7 | 30 | 90)}
                style={[
                  styles.dateRangeBtn,
                  dateRange === days && [styles.dateRangeBtnActive, { borderColor: accentColor }],
                  Platform.OS === 'web' && { cursor: 'pointer' } as any,
                ]}
              >
                <Text style={[
                  styles.dateRangeBtnText,
                  dateRange === days && [styles.dateRangeBtnTextActive, { color: accentColor }],
                ]}>
                  {days}d
                </Text>
              </Pressable>
            ))}
          </View>
          
          {/* Export Button */}
          <Pressable
            style={[styles.exportBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
            onPress={() => setShowExportModal(true)}
          >
            <Text style={styles.exportBtnText}>📥 EXPORT</Text>
          </Pressable>
        </View>
      </View>

      {/* Total Summary Banner */}
      <View style={[styles.summaryBanner, { borderLeftColor: accentColor }]}>
        <View style={styles.summaryRow}>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>Total Sessions</Text>
            <Text style={[styles.summaryValue, { color: accentColor }]}>
              {sessions.length}
            </Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>Avg Cost/Session</Text>
            <Text style={[styles.summaryValue, { color: accentColor }]}>
              ${sessions.length > 0 ? (costData.month / sessions.length).toFixed(3) : '0.00'}
            </Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>Total Tokens</Text>
            <Text style={[styles.summaryValue, { color: accentColor }]}>
              {formatTokenCount(sessions.reduce((sum, s) => sum + (s.totalInputTokens || 0) + (s.totalOutputTokens || 0), 0))}
            </Text>
          </View>
        </View>
      </View>

      {/* Overview Cards */}
      <View style={styles.overviewGrid}>
        <CostCard
          label="TODAY"
          value={costData.today}
          change={costData.todayChange}
          accentColor={accentColor}
        />
        <CostCard
          label="THIS WEEK"
          value={costData.week}
          change={costData.weekChange}
          accentColor={accentColor}
        />
        <CostCard
          label="THIS MONTH"
          value={costData.month}
          change={costData.monthChange}
          accentColor={accentColor}
        />
      </View>

      {/* Chart Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>DAILY SPEND (LAST {dateRange} DAYS)</Text>
        <View style={styles.chartContainer}>
          <MiniBarChart data={costData.dailyHistory} accentColor={accentColor} />
        </View>
        {/* Period comparison */}
        {costData.dailyHistory.length > 1 && (
          <View style={styles.trendSummary}>
            <View style={styles.trendItem}>
              <Text style={styles.trendLabel}>AVG/DAY</Text>
              <Text style={[styles.trendValue, { color: accentColor }]}>
                ${(costData.dailyHistory.reduce((s, d) => s + d.cost, 0) / costData.dailyHistory.length).toFixed(3)}
              </Text>
            </View>
            <View style={styles.trendItem}>
              <Text style={styles.trendLabel}>PEAK</Text>
              <Text style={[styles.trendValue, { color: '#ef4444' }]}>
                ${Math.max(...costData.dailyHistory.map(d => d.cost)).toFixed(3)}
              </Text>
            </View>
            <View style={styles.trendItem}>
              <Text style={styles.trendLabel}>TREND</Text>
              <Text style={[styles.trendValue, { color: (() => {
                const first = costData.dailyHistory.slice(0, Math.floor(costData.dailyHistory.length / 2));
                const second = costData.dailyHistory.slice(Math.floor(costData.dailyHistory.length / 2));
                const firstAvg = first.reduce((s, d) => s + d.cost, 0) / (first.length || 1);
                const secondAvg = second.reduce((s, d) => s + d.cost, 0) / (second.length || 1);
                return secondAvg > firstAvg ? '#ef4444' : '#22c55e';
              })() }]}>
                {(() => {
                  const first = costData.dailyHistory.slice(0, Math.floor(costData.dailyHistory.length / 2));
                  const second = costData.dailyHistory.slice(Math.floor(costData.dailyHistory.length / 2));
                  const firstAvg = first.reduce((s, d) => s + d.cost, 0) / (first.length || 1);
                  const secondAvg = second.reduce((s, d) => s + d.cost, 0) / (second.length || 1);
                  const change = firstAvg > 0 ? ((secondAvg - firstAvg) / firstAvg) * 100 : 0;
                  return `${change > 0 ? '▲' : '▼'} ${Math.abs(change).toFixed(0)}%`;
                })()}
              </Text>
            </View>
          </View>
        )}
      </View>

      {/* Per-Model Cost Breakdown */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>COST BY MODEL</Text>
        <View style={styles.spendersContainer}>
          {costData.modelBreakdown.map((m, i) => (
            <View key={i} style={styles.modelRow}>
              <View style={styles.modelLeft}>
                <View style={[styles.modelDot, { backgroundColor: m.color }]} />
                <Text style={styles.modelName}>{m.model}</Text>
              </View>
              <View style={styles.modelRight}>
                <Text style={[styles.modelCost, { color: accentColor }]}>${m.cost.toFixed(3)}</Text>
                <Text style={styles.modelTokens}>{formatTokenCount(m.tokens)} tok</Text>
              </View>
              <View style={styles.spenderBar}>
                <View style={[styles.spenderBarFill, { width: (m.percentage + '%') as any, backgroundColor: m.color }]} />
              </View>
            </View>
          ))}
          {costData.modelBreakdown.length === 0 && (
            <Text style={styles.noDataText}>No model data yet</Text>
          )}
        </View>
      </View>

      {/* Token Breakdown */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>TOKEN BREAKDOWN</Text>
        <View style={styles.tokenGrid}>
          <View style={styles.tokenCard}>
            <Text style={styles.tokenLabel}>INPUT</Text>
            <Text style={[styles.tokenValue, { color: '#3b82f6' }]}>
              {formatTokenCount(costData.tokenBreakdown.input)}
            </Text>
          </View>
          <View style={styles.tokenCard}>
            <Text style={styles.tokenLabel}>OUTPUT</Text>
            <Text style={[styles.tokenValue, { color: '#8b5cf6' }]}>
              {formatTokenCount(costData.tokenBreakdown.output)}
            </Text>
          </View>
          <View style={styles.tokenCard}>
            <Text style={styles.tokenLabel}>CACHED</Text>
            <Text style={[styles.tokenValue, { color: '#22c55e' }]}>
              {formatTokenCount(costData.tokenBreakdown.cached)}
            </Text>
          </View>
          <View style={styles.tokenCard}>
            <Text style={styles.tokenLabel}>NEW INPUT</Text>
            <Text style={[styles.tokenValue, { color: '#f59e0b' }]}>
              {formatTokenCount(costData.tokenBreakdown.newInput)}
            </Text>
          </View>
        </View>
        {/* Token bar visualization */}
        <View style={styles.tokenBarContainer}>
          {costData.tokenBreakdown.total > 0 && (
            <View style={styles.tokenBarRow}>
              <View style={[styles.tokenBarSegment, { flex: costData.tokenBreakdown.input || 1, backgroundColor: '#3b82f6' }]} />
              <View style={[styles.tokenBarSegment, { flex: costData.tokenBreakdown.output || 1, backgroundColor: '#8b5cf6' }]} />
            </View>
          )}
          <View style={styles.tokenBarLegend}>
            <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: '#3b82f6' }]} /><Text style={styles.legendText}>Input</Text></View>
            <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: '#8b5cf6' }]} /><Text style={styles.legendText}>Output</Text></View>
            <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: '#22c55e' }]} /><Text style={styles.legendText}>Cached</Text></View>
          </View>
        </View>
      </View>

      {/* Top Spenders */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>TOP SPENDERS</Text>
        <View style={styles.spendersContainer}>
          {costData.topSpenders.slice(0, 5).map((spender, i) => (
            <SpenderRow key={i} {...spender} rank={i + 1} accentColor={accentColor} />
          ))}
        </View>
      </View>

      {/* Insights */}
      {costData.insights.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>💡 INSIGHTS</Text>
          <View style={styles.insightsContainer}>
            {costData.insights.map((insight, i) => (
              <InsightCard key={i} {...insight} />
            ))}
          </View>
        </View>
      )}
    </ScrollView>

    {/* Export Modal */}
    <Modal
      visible={showExportModal}
      transparent
      animationType="fade"
      onRequestClose={() => setShowExportModal(false)}
    >
      <Pressable
        style={styles.modalOverlay}
        onPress={() => setShowExportModal(false)}
      >
        <Pressable
          style={styles.modalContent}
          onPress={e => e.stopPropagation()}
        >
          <Text style={styles.modalTitle}>📥 EXPORT DATA</Text>
          <Text style={styles.modalDesc}>
            Export {agents.length} agents and {sessions.length} sessions
          </Text>

          {exportStatus !== '' && (
            <Text style={styles.exportStatus}>{exportStatus}</Text>
          )}

          <View style={styles.exportButtons}>
            <Pressable
              onPress={() => handleExport('csv')}
              style={[styles.exportOptionBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
            >
              <Text style={styles.exportOptionIcon}>📄</Text>
              <Text style={styles.exportOptionLabel}>CSV</Text>
              <Text style={styles.exportOptionDesc}>Spreadsheet format</Text>
            </Pressable>

            <Pressable
              onPress={() => handleExport('json')}
              style={[styles.exportOptionBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
            >
              <Text style={styles.exportOptionIcon}>📋</Text>
              <Text style={styles.exportOptionLabel}>JSON</Text>
              <Text style={styles.exportOptionDesc}>Developer format</Text>
            </Pressable>

            <Pressable
              onPress={() => handleExport('json-summary')}
              style={[styles.exportOptionBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
            >
              <Text style={styles.exportOptionIcon}>📊</Text>
              <Text style={styles.exportOptionLabel}>JSON + Summary</Text>
              <Text style={styles.exportOptionDesc}>With totals</Text>
            </Pressable>

            <Pressable
              onPress={() => handleCopyToClipboard()}
              style={[styles.exportOptionBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
            >
              <Text style={styles.exportOptionIcon}>📋</Text>
              <Text style={styles.exportOptionLabel}>Copy CSV</Text>
              <Text style={styles.exportOptionDesc}>To clipboard</Text>
            </Pressable>
          </View>

          <Pressable
            onPress={() => setShowExportModal(false)}
            style={[styles.modalCloseBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
          >
            <Text style={styles.modalCloseBtnText}>✕ CLOSE</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  </>
  );
  // ─── Export Handlers ───────────────────────────────────
}

// ─── Cost Card Component ─────────────────────────────────

function CostCard({ label, value, change, accentColor }: {
  label: string;
  value: number;
  change: number;
  accentColor: string;
}) {
  const isPositive = change > 0;
  const changeColor = isPositive ? '#ef4444' : '#22c55e'; // Red = bad (spent more), Green = good (spent less)
  
  return (
    <View style={styles.costCard}>
      <Text style={styles.costLabel}>{label}</Text>
      <Text style={[styles.costValue, { color: accentColor }]}>
        ${value.toFixed(2)}
      </Text>
      <View style={styles.changeRow}>
        <Text style={[styles.changeText, { color: changeColor }]}>
          {isPositive ? '▲' : '▼'} {Math.abs(change).toFixed(1)}%
        </Text>
      </View>
    </View>
  );
}

// ─── Mini Bar Chart ──────────────────────────────────────

function MiniBarChart({ data, accentColor }: {
  data: Array<{ date: string; cost: number }>;
  accentColor: string;
}) {
  const maxCost = Math.max(...data.map(d => d.cost), 1);
  
  return (
    <View style={styles.chart}>
      <View style={styles.chartBars}>
        {data.map((d, i) => {
          const heightPercent = (d.cost / maxCost) * 100;
          const isToday = i === data.length - 1;
          
          return (
            <View key={i} style={styles.barWrapper}>
              <View
                style={[
                  styles.bar,
                  {
                    height: (heightPercent + '%') as any,
                    backgroundColor: isToday ? accentColor : accentColor + '60',
                  },
                ]}
              />
            </View>
          );
        })}
      </View>
      
      {/* X-axis labels (show first, middle, last) */}
      <View style={styles.chartLabels}>
        <Text style={styles.chartLabel}>{formatDate(data[0]?.date)}</Text>
        <Text style={styles.chartLabel}>{formatDate(data[Math.floor(data.length / 2)]?.date)}</Text>
        <Text style={styles.chartLabel}>{formatDate(data[data.length - 1]?.date)}</Text>
      </View>
    </View>
  );
}

// ─── Spender Row ─────────────────────────────────────────

function SpenderRow({ name, cost, percentage, sessions, rank, accentColor }: {
  name: string;
  cost: number;
  percentage: number;
  sessions: number;
  rank: number;
  accentColor: string;
}) {
  const emoji = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '🤖';
  
  return (
    <View style={styles.spenderRow}>
      <View style={styles.spenderLeft}>
        <Text style={styles.spenderEmoji}>{emoji}</Text>
        <View style={styles.spenderInfo}>
          <Text style={styles.spenderName}>{name}</Text>
          <Text style={styles.spenderSessions}>{sessions} sessions</Text>
        </View>
      </View>
      
      <View style={styles.spenderRight}>
        <Text style={[styles.spenderCost, { color: accentColor }]}>
          ${cost.toFixed(2)}
        </Text>
        <Text style={styles.spenderPercent}>{percentage.toFixed(0)}%</Text>
      </View>
      
      {/* Progress bar */}
      <View style={styles.spenderBar}>
        <View
          style={[
            styles.spenderBarFill,
            { width: (percentage + '%') as any, backgroundColor: accentColor },
          ]}
        />
      </View>
    </View>
  );
}

// ─── Insight Card ────────────────────────────────────────

function InsightCard({ type, text }: {
  type: 'warning' | 'tip' | 'success';
  text: string;
}) {
  const config = {
    warning: { bg: '#ef444420', border: '#ef4444', emoji: '⚠️' },
    tip: { bg: '#3b82f620', border: '#3b82f6', emoji: '💡' },
    success: { bg: '#22c55e20', border: '#22c55e', emoji: '✓' },
  };
  
  const style = config[type];
  
  return (
    <View style={[styles.insightCard, { backgroundColor: style.bg, borderColor: style.border }]}>
      <Text style={styles.insightEmoji}>{style.emoji}</Text>
      <Text style={styles.insightText}>{text}</Text>
    </View>
  );
}

// ─── Helper Functions ────────────────────────────────────

function formatTokenCount(tokens: number): string {
  if (tokens >= 1000000) return (tokens / 1000000).toFixed(1) + 'M';
  if (tokens >= 1000) return (tokens / 1000).toFixed(1) + 'K';
  return tokens.toString();
}

// ─── Data Calculation ────────────────────────────────────

function calculateCostData(sessions: OpenClawSession[], dateRange: 7 | 30 | 90 = 30): CostData {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
  const twoWeeksAgo = new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000);
  const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
  const twoMonthsAgo = new Date(today.getTime() - 60 * 24 * 60 * 60 * 1000);

  // Calculate costs by time period
  let todayCost = 0;
  let yesterdayCost = 0;
  let thisWeekCost = 0;
  let lastWeekCost = 0;
  let thisMonthCost = 0;
  let lastMonthCost = 0;

  const agentCosts: Record<string, { cost: number; sessions: number }> = {};
  const dailyCosts: Record<string, number> = {};
  const modelCosts: Record<string, { cost: number; tokens: number }> = {};
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCachedTokens = 0;

  sessions.forEach(s => {
    const cost = s.totalCost || 0;
    const sessionDate = s.lastActivity ? new Date(s.lastActivity) : new Date();

    // Time period totals
    if (sessionDate >= today) todayCost += cost;
    if (sessionDate >= yesterday && sessionDate < today) yesterdayCost += cost;
    if (sessionDate >= weekAgo) thisWeekCost += cost;
    if (sessionDate >= twoWeeksAgo && sessionDate < weekAgo) lastWeekCost += cost;
    if (sessionDate >= monthAgo) thisMonthCost += cost;
    if (sessionDate >= twoMonthsAgo && sessionDate < monthAgo) lastMonthCost += cost;

    // Agent totals
    const agentName = s.agentId || 'unknown';
    if (!agentCosts[agentName]) agentCosts[agentName] = { cost: 0, sessions: 0 };
    agentCosts[agentName].cost += cost;
    agentCosts[agentName].sessions += 1;

    // Model totals
    const model = s.model || 'unknown';
    if (!modelCosts[model]) modelCosts[model] = { cost: 0, tokens: 0 };
    modelCosts[model].cost += cost;
    modelCosts[model].tokens += (s.totalInputTokens || 0) + (s.totalOutputTokens || 0);

    // Token breakdown
    totalInputTokens += s.totalInputTokens || 0;
    totalOutputTokens += s.totalOutputTokens || 0;
    totalCachedTokens += s.cachedTokens || 0;

    // Daily totals (last 30 days)
    const dateKey = sessionDate.toISOString().split('T')[0];
    dailyCosts[dateKey] = (dailyCosts[dateKey] || 0) + cost;
  });

  // Calculate % changes
  const todayChange = yesterdayCost > 0 ? ((todayCost - yesterdayCost) / yesterdayCost) * 100 : 0;
  const weekChange = lastWeekCost > 0 ? ((thisWeekCost - lastWeekCost) / lastWeekCost) * 100 : 0;
  const monthChange = lastMonthCost > 0 ? ((thisMonthCost - lastMonthCost) / lastMonthCost) * 100 : 0;

  // Build daily history (last N days based on dateRange)
  const dailyHistory: Array<{ date: string; cost: number }> = [];
  for (let i = dateRange - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
    const dateKey = d.toISOString().split('T')[0];
    dailyHistory.push({ date: dateKey, cost: dailyCosts[dateKey] || 0 });
  }

  // Top spenders
  const topSpenders = Object.entries(agentCosts)
    .map(([name, data]) => ({
      name,
      cost: data.cost,
      sessions: data.sessions,
      percentage: thisMonthCost > 0 ? (data.cost / thisMonthCost) * 100 : 0,
    }))
    .sort((a, b) => b.cost - a.cost);

  // Generate insights
  const insights: Array<{ type: 'warning' | 'tip' | 'success'; text: string }> = [];

  if (todayChange > 50) {
    insights.push({ type: 'warning', text: `Spending up ${todayChange.toFixed(0)}% today vs yesterday` });
  }

  if (topSpenders[0]?.percentage > 60) {
    insights.push({
      type: 'tip',
      text: `${topSpenders[0].name} accounts for ${topSpenders[0].percentage.toFixed(0)}% of spend. Consider optimizing.`,
    });
  }

  if (thisMonthCost < lastMonthCost && lastMonthCost > 0) {
    insights.push({
      type: 'success',
      text: `Great! You're spending ${Math.abs(monthChange).toFixed(0)}% less than last month.`,
    });
  }

  // Suggest cheaper models for high-cost agents
  const expensiveAgent = topSpenders.find(s => s.cost > thisMonthCost * 0.4);
  if (expensiveAgent) {
    insights.push({
      type: 'tip',
      text: `Switch ${expensiveAgent.name} to Haiku for simple tasks → Save ~60% on cost`,
    });
  }

  // Model breakdown
  const MODEL_COLORS: Record<string, string> = {
    'blackswan': '#ef4444',
    'claude-haiku-4-5-20251001': '#22c55e',
    'claude-sonnet-4-6': '#3b82f6',
    'claude-opus-4-6': '#8b5cf6',
    'mixed': '#f59e0b',
    'unknown': '#666',
  };
  const totalModelCost = Object.values(modelCosts).reduce((s, m) => s + m.cost, 0) || 1;
  const modelBreakdown = Object.entries(modelCosts)
    .map(([model, data]) => ({
      model: model.replace('claude-haiku-4-5-20251001', 'Haiku')
                   .replace('claude-sonnet-4-6', 'Sonnet')
                   .replace('claude-opus-4-6', 'Opus')
                   .replace('blackswan', 'BlackSwan')
                   .replace('mixed', 'Mixed')
                   .replace('unknown', 'Unknown'),
      cost: data.cost,
      tokens: data.tokens,
      percentage: (data.cost / totalModelCost) * 100,
      color: MODEL_COLORS[model] || '#666',
    }))
    .sort((a, b) => b.cost - a.cost);

  // Token breakdown
  const tokenBreakdown = {
    input: totalInputTokens,
    output: totalOutputTokens,
    cached: totalCachedTokens,
    newInput: totalInputTokens - totalCachedTokens,
    total: totalInputTokens + totalOutputTokens,
  };

  return {
    today: todayCost,
    todayChange,
    week: thisWeekCost,
    weekChange,
    month: thisMonthCost,
    monthChange,
    dailyHistory,
    topSpenders,
    insights,
    modelBreakdown,
    tokenBreakdown,
  };
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// ─── Styles ──────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    padding: 16,
  },

  // Empty State
  emptyContainer: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: '#888',
    textAlign: 'center',
    lineHeight: 20,
  },

  // Header
  header: {
    marginBottom: 20,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 2,
    marginBottom: 12,
  },
  headerControls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  // Date Range Selector
  dateRangeSelector: {
    flexDirection: 'row',
    gap: 8,
  },
  dateRangeBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#333',
    backgroundColor: '#1a1a1a',
  },
  dateRangeBtnActive: {
    backgroundColor: '#1a1a1a',
    borderWidth: 2,
  },
  dateRangeBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#666',
  },
  dateRangeBtnTextActive: {
    fontWeight: '800',
  },

  // Export Button
  exportBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#333',
  },
  exportBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#888',
    letterSpacing: 1,
  },

  // Summary Banner
  summaryBanner: {
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#333',
    borderLeftWidth: 3,
    borderRadius: 8,
    padding: 16,
    marginBottom: 20,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  summaryItem: {
    alignItems: 'center',
    flex: 1,
  },
  summaryLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#666',
    letterSpacing: 1,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  summaryValue: {
    fontSize: 22,
    fontWeight: '800',
  },
  summaryDivider: {
    width: 1,
    height: 40,
    backgroundColor: '#333',
  },

  // Overview Grid
  overviewGrid: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  costCard: {
    flex: 1,
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 8,
    padding: 16,
  },
  costLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#888',
    letterSpacing: 1,
    marginBottom: 8,
  },
  costValue: {
    fontSize: 28,
    fontWeight: '800',
    marginBottom: 4,
  },
  changeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  changeText: {
    fontSize: 13,
    fontWeight: '600',
  },

  // Section
  section: {
    marginBottom: 32,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#888',
    letterSpacing: 1.5,
    marginBottom: 12,
  },

  // Chart
  chartContainer: {
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 8,
    padding: 16,
  },
  chart: {
    height: 180,
  },
  chartBars: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
  },
  barWrapper: {
    flex: 1,
    height: '100%',
    justifyContent: 'flex-end',
  },
  bar: {
    width: '100%',
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
    minHeight: 2,
  },
  chartLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  chartLabel: {
    fontSize: 10,
    color: '#666',
    fontWeight: '600',
  },

  // Spenders
  spendersContainer: {
    gap: 12,
  },
  spenderRow: {
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 8,
    padding: 12,
  },
  spenderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  spenderEmoji: {
    fontSize: 24,
    marginRight: 12,
  },
  spenderInfo: {
    flex: 1,
  },
  spenderName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 2,
  },
  spenderSessions: {
    fontSize: 11,
    color: '#666',
  },
  spenderRight: {
    position: 'absolute',
    right: 12,
    top: 12,
    alignItems: 'flex-end',
  },
  spenderCost: {
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 2,
  },
  spenderPercent: {
    fontSize: 11,
    color: '#888',
    fontWeight: '600',
  },
  spenderBar: {
    height: 4,
    backgroundColor: '#333',
    borderRadius: 2,
    overflow: 'hidden',
    marginTop: 8,
  },
  spenderBarFill: {
    height: '100%',
  },

  // Insights
  insightsContainer: {
    gap: 12,
  },
  insightCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  insightEmoji: {
    fontSize: 20,
    marginRight: 12,
  },
  insightText: {
    flex: 1,
    fontSize: 13,
    color: '#fff',
    fontWeight: '500',
    lineHeight: 18,
  },

  // Trend Summary
  trendSummary: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
  },
  trendItem: {
    alignItems: 'center',
  },
  trendLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: '#666',
    letterSpacing: 1,
    marginBottom: 4,
  },
  trendValue: {
    fontSize: 14,
    fontWeight: '800',
  },

  // Model Breakdown
  modelRow: {
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 8,
    padding: 12,
  },
  modelLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  modelDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  modelName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
  },
  modelRight: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  modelCost: {
    fontSize: 16,
    fontWeight: '800',
  },
  modelTokens: {
    fontSize: 12,
    color: '#888',
    fontWeight: '600',
  },
  noDataText: {
    fontSize: 12,
    color: '#666',
    textAlign: 'center',
    padding: 16,
  },

  // Token Breakdown
  tokenGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  tokenCard: {
    flex: 1,
    minWidth: '45%' as any,
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
  },
  tokenLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#888',
    letterSpacing: 1,
    marginBottom: 4,
  },
  tokenValue: {
    fontSize: 18,
    fontWeight: '800',
  },
  tokenBarContainer: {
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 8,
    padding: 12,
  },
  tokenBarRow: {
    flexDirection: 'row',
    height: 12,
    borderRadius: 6,
    overflow: 'hidden',
    marginBottom: 8,
  },
  tokenBarSegment: {
    height: '100%',
  },
  tokenBarLegend: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    fontSize: 10,
    color: '#888',
    fontWeight: '600',
  },

  // Export Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: '#00000080',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#0d0d14',
    borderWidth: 2,
    borderColor: '#6366f1',
    borderRadius: 12,
    padding: 20,
    minWidth: 300,
    maxWidth: 500,
    gap: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 1,
  },
  modalDesc: {
    fontSize: 13,
    color: '#888',
  },
  exportStatus: {
    fontSize: 13,
    color: '#22c55e',
    textAlign: 'center',
    padding: 8,
    backgroundColor: '#22c55e15',
    borderRadius: 6,
  },
  exportButtons: {
    gap: 12,
  },
  exportOptionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    backgroundColor: '#1a1a2e',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 8,
    gap: 12,
  },
  exportOptionIcon: {
    fontSize: 24,
  },
  exportOptionLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
  exportOptionDesc: {
    fontSize: 11,
    color: '#888',
  },
  modalCloseBtn: {
    padding: 12,
    backgroundColor: '#333',
    borderRadius: 8,
    alignItems: 'center',
  },
  modalCloseBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
  },
});
