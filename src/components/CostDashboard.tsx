// Cost Analytics Dashboard - period-aligned response and token estimates
import React, { useMemo, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Platform, Modal } from 'react-native';
import { OpenSwanSession } from '../lib/openswanService';
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
  periodCost: number;
  responseCount: number;
  today: number;
  todayChange: number | null;
  week: number;
  weekChange: number | null;
  month: number;
  monthChange: number | null;
  dailyHistory: Array<{ date: string; cost: number }>;
  topSpenders: Array<{ name: string; cost: number; percentage: number; responses: number }>;
  insights: Array<{ type: 'warning' | 'tip' | 'success'; text: string }>;
  modelBreakdown: Array<{ model: string; cost: number; tokens: number; percentage: number; color: string }>;
  tokenBreakdown: { input: number; output: number; cached: number; newInput: number; total: number };
}

interface Props {
  sessions: OpenSwanSession[];
  agents: OfficeAgent[];
  sessionTags: Map<string, SessionTag[]>;
  accentColor?: string;
  costAuthority?: 'recorded' | 'estimated';
}

const STORAGE_KEY_DATE_RANGE = '@cost_dashboard_date_range';

export default function CostDashboard({
  sessions,
  agents,
  sessionTags,
  accentColor = '#e8e8e8',
  costAuthority = 'recorded',
}: Props) {
  const [dateRange, setDateRange] = useState<7 | 30 | 90>(30);
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportStatus, setExportStatus] = useState<string>('');
  const costData = useMemo(() => calculateCostData(sessions, dateRange), [sessions, dateRange]);
  const dailyTrend = useMemo(
    () => calculateDailyTrend(costData.dailyHistory),
    [costData.dailyHistory],
  );

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
        <Text style={styles.emptyIcon}>$</Text>
        <Text style={styles.emptyTitle} accessibilityRole="header">No usage receipts yet</Text>
        <Text style={styles.emptyText}>
          Recorded agent responses will appear here after this circle starts producing usage.
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
        <Text style={styles.headerTitle} accessibilityRole="header">COST ANALYTICS</Text>
        <View style={styles.headerControls}>
          {/* Date Range Selector */}
          <View style={styles.dateRangeSelector} accessibilityRole="tablist">
            {[7, 30, 90].map(days => (
              <Pressable
                key={days}
                accessibilityRole="tab"
                accessibilityLabel={`Show ${days} days of cost history`}
                accessibilityState={{ selected: dateRange === days }}
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
            accessibilityRole="button"
            accessibilityLabel="Export cost data"
            style={[styles.exportBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
            onPress={() => setShowExportModal(true)}
          >
            <Text style={styles.exportBtnText}>📥 EXPORT</Text>
          </Pressable>
        </View>
      </View>

      {costAuthority === 'estimated' && (
        <View style={styles.costAuthorityNotice} accessibilityRole="summary">
          <Text style={styles.costAuthorityTitle}>ESTIMATED COST VIEW</Text>
          <Text style={styles.costAuthorityText}>
            Backpack converts recorded token counts with a flat rate. Use these totals for direction,
            not as provider billing receipts.
          </Text>
        </View>
      )}

      {/* Total Summary Banner */}
      <View style={[styles.summaryBanner, { borderLeftColor: accentColor }]}>
        <View style={styles.summaryRow}>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>Cost ({dateRange}d)</Text>
            <Text style={[styles.summaryValue, { color: accentColor }]}>
              ${costData.periodCost.toFixed(2)}
            </Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>Responses ({dateRange}d)</Text>
            <Text style={[styles.summaryValue, { color: accentColor }]}>
              {costData.responseCount}
            </Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>Avg Cost/Response</Text>
            <Text style={[styles.summaryValue, { color: accentColor }]}>
              ${costData.responseCount > 0 ? (costData.periodCost / costData.responseCount).toFixed(3) : '0.000'}
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
          label="LAST 7 DAYS"
          value={costData.week}
          change={costData.weekChange}
          accentColor={accentColor}
        />
        <CostCard
          label="LAST 30 DAYS"
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
              <Text style={[styles.trendValue, { color: '#9e9e9e' }]}>
                ${Math.max(...costData.dailyHistory.map(d => d.cost)).toFixed(3)}
              </Text>
            </View>
            <View style={styles.trendItem}>
              <Text style={styles.trendLabel}>TREND</Text>
              <Text style={[styles.trendValue, { color: dailyTrend.color }]}>
                {dailyTrend.label}
              </Text>
            </View>
          </View>
        )}
      </View>

      {/* Per-Model Cost Breakdown */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>COST BY MODEL · {dateRange} DAYS</Text>
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
        <Text style={styles.sectionTitle}>TOKEN BREAKDOWN · {dateRange} DAYS</Text>
        <View style={styles.tokenGrid}>
          <View style={styles.tokenCard}>
            <Text style={styles.tokenLabel}>INPUT</Text>
            <Text style={[styles.tokenValue, { color: '#3b82f6' }]}>
              {formatTokenCount(costData.tokenBreakdown.input)}
            </Text>
          </View>
          <View style={styles.tokenCard}>
            <Text style={styles.tokenLabel}>OUTPUT</Text>
            <Text style={[styles.tokenValue, { color: '#a855f7' }]}>
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
              {costData.tokenBreakdown.newInput > 0 && (
                <View style={[styles.tokenBarSegment, { flex: costData.tokenBreakdown.newInput, backgroundColor: '#3b82f6' }]} />
              )}
              {costData.tokenBreakdown.cached > 0 && (
                <View style={[styles.tokenBarSegment, { flex: costData.tokenBreakdown.cached, backgroundColor: '#22c55e' }]} />
              )}
              {costData.tokenBreakdown.output > 0 && (
                <View style={[styles.tokenBarSegment, { flex: costData.tokenBreakdown.output, backgroundColor: '#a855f7' }]} />
              )}
            </View>
          )}
          <View style={styles.tokenBarLegend}>
            <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: '#3b82f6' }]} /><Text style={styles.legendText}>New input</Text></View>
            <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: '#22c55e' }]} /><Text style={styles.legendText}>Cached</Text></View>
            <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: '#a855f7' }]} /><Text style={styles.legendText}>Output</Text></View>
          </View>
        </View>
      </View>

      {/* Top Spenders */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>TOP SPENDERS · {dateRange} DAYS</Text>
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
            Export the available agent summary as CSV or JSON.
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
  change: number | null;
  accentColor: string;
}) {
  const isPositive = change !== null && change > 0;
  const isNeutral = change === null || change === 0;
  const changeColor = isNeutral ? '#6f6f6f' : isPositive ? '#ef4444' : '#22c55e';
  const changeLabel = change === null
    ? '— no prior baseline'
    : `${isNeutral ? '—' : isPositive ? '▲' : '▼'} ${Math.abs(change).toFixed(1)}%`;
  
  return (
    <View style={styles.costCard}>
      <Text style={styles.costLabel}>{label}</Text>
      <Text style={[styles.costValue, { color: accentColor }]}>
        ${value.toFixed(2)}
      </Text>
      <View style={styles.changeRow}>
        <Text style={[styles.changeText, { color: changeColor }]}>
          {changeLabel}
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

function SpenderRow({ name, cost, percentage, responses, rank, accentColor }: {
  name: string;
  cost: number;
  percentage: number;
  responses: number;
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
          <Text style={styles.spenderSessions}>{responses} responses</Text>
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
            { width: (`${Math.min(100, Math.max(0, percentage))}%`) as any, backgroundColor: accentColor },
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
    warning: { bg: '#f59e0b10', border: '#f59e0b', emoji: '⚠️' },
    tip: { bg: '#3b82f610', border: '#3b82f6', emoji: '💡' },
    success: { bg: '#22c55e10', border: '#22c55e', emoji: '✓' },
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

function calculateCostData(sessions: OpenSwanSession[], dateRange: 7 | 30 | 90 = 30): CostData {
  const today = startOfLocalDay(new Date());
  const tomorrow = shiftLocalDays(today, 1);
  const yesterday = shiftLocalDays(today, -1);
  const sevenDayStart = shiftLocalDays(today, -6);
  const previousSevenDayStart = shiftLocalDays(sevenDayStart, -7);
  const thirtyDayStart = shiftLocalDays(today, -29);
  const previousThirtyDayStart = shiftLocalDays(thirtyDayStart, -30);
  const selectedStart = shiftLocalDays(today, 1 - dateRange);

  const datedResponses = sessions.flatMap((response) => {
    const occurredAt = parseResponseDate(response);
    return occurredAt ? [{ response, occurredAt }] : [];
  });
  const responsesBetween = (start: Date, end: Date) => datedResponses.filter(
    ({ occurredAt }) => occurredAt >= start && occurredAt < end,
  );
  const costFor = (rows: typeof datedResponses) => rows.reduce(
    (sum, { response }) => sum + nonNegativeMetric(response.totalCost),
    0,
  );

  const selectedResponses = responsesBetween(selectedStart, tomorrow);
  const periodCost = costFor(selectedResponses);
  const todayCost = costFor(responsesBetween(today, tomorrow));
  const yesterdayCost = costFor(responsesBetween(yesterday, today));
  const thisWeekCost = costFor(responsesBetween(sevenDayStart, tomorrow));
  const lastWeekCost = costFor(responsesBetween(previousSevenDayStart, sevenDayStart));
  const thisMonthCost = costFor(responsesBetween(thirtyDayStart, tomorrow));
  const lastMonthCost = costFor(responsesBetween(previousThirtyDayStart, thirtyDayStart));

  const agentCosts: Record<string, { cost: number; responses: number }> = {};
  const dailyCosts: Record<string, number> = {};
  const modelCosts: Record<string, { cost: number; tokens: number }> = {};
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCachedTokens = 0;

  selectedResponses.forEach(({ response, occurredAt }) => {
    const cost = nonNegativeMetric(response.totalCost);
    const inputTokens = nonNegativeMetric(response.totalInputTokens);
    const outputTokens = nonNegativeMetric(response.totalOutputTokens);
    const cachedTokens = Math.min(inputTokens, nonNegativeMetric(response.cachedTokens));
    const agentName = response.agentId || 'unknown';
    const model = response.model || 'unknown';

    if (!agentCosts[agentName]) agentCosts[agentName] = { cost: 0, responses: 0 };
    agentCosts[agentName].cost += cost;
    agentCosts[agentName].responses += 1;

    if (!modelCosts[model]) modelCosts[model] = { cost: 0, tokens: 0 };
    modelCosts[model].cost += cost;
    modelCosts[model].tokens += inputTokens + outputTokens;

    totalInputTokens += inputTokens;
    totalOutputTokens += outputTokens;
    totalCachedTokens += cachedTokens;

    const dateKey = localDateKey(occurredAt);
    dailyCosts[dateKey] = (dailyCosts[dateKey] || 0) + cost;
  });

  const todayChange = percentageChange(todayCost, yesterdayCost);
  const weekChange = percentageChange(thisWeekCost, lastWeekCost);
  const monthChange = percentageChange(thisMonthCost, lastMonthCost);

  const dailyHistory: Array<{ date: string; cost: number }> = [];
  for (let i = dateRange - 1; i >= 0; i--) {
    const dateKey = localDateKey(shiftLocalDays(today, -i));
    dailyHistory.push({ date: dateKey, cost: dailyCosts[dateKey] || 0 });
  }

  const topSpenders = Object.entries(agentCosts)
    .map(([name, data]) => ({
      name,
      cost: data.cost,
      responses: data.responses,
      percentage: boundedPercentage(data.cost, periodCost),
    }))
    .sort((a, b) => b.cost - a.cost);

  const insights: Array<{ type: 'warning' | 'tip' | 'success'; text: string }> = [];

  if (todayChange !== null && todayChange > 50) {
    insights.push({ type: 'warning', text: `Spend is up ${todayChange.toFixed(0)}% today versus yesterday.` });
  }

  if (topSpenders[0]?.percentage > 60) {
    insights.push({
      type: 'tip',
      text: `${topSpenders[0].name} accounts for ${topSpenders[0].percentage.toFixed(0)}% of selected-period spend. Review routing and workload fit before changing models.`,
    });
  }

  if (monthChange !== null && thisMonthCost < lastMonthCost) {
    insights.push({
      type: 'success',
      text: `Spend is ${Math.abs(monthChange).toFixed(0)}% lower than the previous 30-day period.`,
    });
  }

  // Model breakdown for the same selected local-calendar period.
  const MODEL_COLORS: Record<string, string> = {
    'blackswan': '#a855f7',
    'claude-haiku-4-5-20251001': '#22c55e',
    'claude-sonnet-4-6': '#3b82f6',
    'claude-opus-4-6': '#f59e0b',
    'mixed': '#6366f1',
    'unknown': '#6f6f6f',
  };
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
      percentage: boundedPercentage(data.cost, periodCost),
      color: MODEL_COLORS[model] || '#6f6f6f',
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
    periodCost,
    responseCount: selectedResponses.length,
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

function startOfLocalDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function shiftLocalDays(value: Date, dayOffset: number): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate() + dayOffset);
}

function parseResponseDate(response: OpenSwanSession): Date | null {
  if (!response.lastActivity) return null;
  const parsed = new Date(response.lastActivity);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function localDateKey(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function nonNegativeMetric(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function percentageChange(current: number, previous: number): number | null {
  return previous > 0 ? ((current - previous) / previous) * 100 : null;
}

function boundedPercentage(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, (value / total) * 100));
}

function calculateDailyTrend(data: Array<{ date: string; cost: number }>): {
  color: string;
  label: string;
} {
  const midpoint = Math.floor(data.length / 2);
  const first = data.slice(0, midpoint);
  const second = data.slice(midpoint);
  const firstAverage = first.reduce((sum, day) => sum + day.cost, 0) / (first.length || 1);
  const secondAverage = second.reduce((sum, day) => sum + day.cost, 0) / (second.length || 1);

  if (firstAverage <= 0) {
    return {
      color: '#6f6f6f',
      label: secondAverage > 0 ? '— no prior baseline' : '— 0%',
    };
  }

  const change = ((secondAverage - firstAverage) / firstAverage) * 100;
  if (change === 0) return { color: '#6f6f6f', label: '— 0%' };
  return {
    color: change > 0 ? '#ef4444' : '#22c55e',
    label: `${change > 0 ? '▲' : '▼'} ${Math.abs(change).toFixed(0)}%`,
  };
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  const [, month, day] = dateStr.split('-');
  return month && day ? `${Number(month)}/${Number(day)}` : dateStr;
}

// ─── Styles ──────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
    padding: 16,
  },

  // Empty State
  emptyContainer: {
    flex: 1,
    backgroundColor: '#000000',
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
    color: '#e8e8e8',
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: '#9e9e9e',
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
    color: '#e8e8e8',
    letterSpacing: 2,
    marginBottom: 12,
  },
  headerControls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  costAuthorityNotice: {
    marginBottom: 16,
    paddingHorizontal: 13,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: '#f59e0b44',
    borderRadius: 10,
    backgroundColor: '#f59e0b0d',
  },
  costAuthorityTitle: {
    color: '#e9c46a',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.1,
    marginBottom: 3,
  },
  costAuthorityText: {
    color: '#a79a7f',
    fontSize: 11,
    lineHeight: 16,
  },

  // Date Range Selector
  dateRangeSelector: {
    flexDirection: 'row',
    gap: 8,
  },
  dateRangeBtn: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    backgroundColor: '#000000',
  },
  dateRangeBtnActive: {
    backgroundColor: '#000000',
    borderWidth: 2,
  },
  dateRangeBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6f6f6f',
  },
  dateRangeBtnTextActive: {
    fontWeight: '800',
  },

  // Export Button
  exportBtn: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: '#000000',
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  exportBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9e9e9e',
    letterSpacing: 1,
  },

  // Summary Banner
  summaryBanner: {
    backgroundColor: '#000000',
    borderWidth: 1,
    borderColor: '#2a2a2a',
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
    color: '#6f6f6f',
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
    backgroundColor: '#2a2a2a',
  },

  // Overview Grid
  overviewGrid: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  costCard: {
    flex: 1,
    backgroundColor: '#000000',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 8,
    padding: 16,
  },
  costLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9e9e9e',
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
    color: '#9e9e9e',
    letterSpacing: 1.5,
    marginBottom: 12,
  },

  // Chart
  chartContainer: {
    backgroundColor: '#000000',
    borderWidth: 1,
    borderColor: '#2a2a2a',
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
    color: '#6f6f6f',
    fontWeight: '600',
  },

  // Spenders
  spendersContainer: {
    gap: 12,
  },
  spenderRow: {
    backgroundColor: '#000000',
    borderWidth: 1,
    borderColor: '#2a2a2a',
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
    color: '#e8e8e8',
    marginBottom: 2,
  },
  spenderSessions: {
    fontSize: 11,
    color: '#6f6f6f',
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
    color: '#9e9e9e',
    fontWeight: '600',
  },
  spenderBar: {
    height: 4,
    backgroundColor: '#2a2a2a',
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
    color: '#e8e8e8',
    fontWeight: '500',
    lineHeight: 18,
  },

  // Trend Summary
  trendSummary: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: '#000000',
    borderWidth: 1,
    borderColor: '#2a2a2a',
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
    color: '#6f6f6f',
    letterSpacing: 1,
    marginBottom: 4,
  },
  trendValue: {
    fontSize: 14,
    fontWeight: '800',
  },

  // Model Breakdown
  modelRow: {
    backgroundColor: '#000000',
    borderWidth: 1,
    borderColor: '#2a2a2a',
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
    color: '#e8e8e8',
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
    color: '#9e9e9e',
    fontWeight: '600',
  },
  noDataText: {
    fontSize: 12,
    color: '#6f6f6f',
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
    backgroundColor: '#000000',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
  },
  tokenLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#9e9e9e',
    letterSpacing: 1,
    marginBottom: 4,
  },
  tokenValue: {
    fontSize: 18,
    fontWeight: '800',
  },
  tokenBarContainer: {
    backgroundColor: '#000000',
    borderWidth: 1,
    borderColor: '#2a2a2a',
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
    color: '#9e9e9e',
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
    backgroundColor: '#0a0a0a',
    borderWidth: 2,
    borderColor: '#e8e8e8',
    borderRadius: 12,
    padding: 20,
    minWidth: 300,
    maxWidth: 500,
    gap: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#e8e8e8',
    letterSpacing: 1,
  },
  modalDesc: {
    fontSize: 13,
    color: '#9e9e9e',
  },
  exportStatus: {
    fontSize: 13,
    color: '#22c55e',
    textAlign: 'center',
    padding: 8,
    backgroundColor: '#22c55e08',
    borderRadius: 6,
  },
  exportButtons: {
    gap: 12,
  },
  exportOptionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    backgroundColor: '#2a2a2a',
    borderWidth: 1,
    borderColor: '#2a2a2a',
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
    color: '#e8e8e8',
  },
  exportOptionDesc: {
    fontSize: 11,
    color: '#9e9e9e',
  },
  modalCloseBtn: {
    padding: 12,
    backgroundColor: '#2a2a2a',
    borderRadius: 8,
    alignItems: 'center',
  },
  modalCloseBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#e8e8e8',
  },
});
