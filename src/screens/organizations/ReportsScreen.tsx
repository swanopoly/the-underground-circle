import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Alert,
  Platform,
} from 'react-native';
import { LoadingScreen } from '../../components/LoadingWave';
import { useOrg } from '../../hooks/useOrg';
import {
  generateReport,
  getReportHistory,
  downloadReport,
  deleteReport,
  getReportSchedules,
  createReportSchedule,
  deleteReportSchedule,
  REPORT_TYPES,
} from '../../lib/reporting';
import type { Report, ReportSchedule } from '../../types';

export default function ReportsScreen({ route, navigation }: any) {
  const { orgId } = route.params;
  const { isAdmin } = useOrg(orgId);
  const [reports, setReports] = useState<Report[]>([]);
  const [schedules, setSchedules] = useState<ReportSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [selectedType, setSelectedType] = useState('analytics');
  const [selectedFormat, setSelectedFormat] = useState<'pdf' | 'csv'>('pdf');
  const [dateRange, setDateRange] = useState('30d');

  useEffect(() => {
    loadData();
  }, [orgId]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [reportsData, schedulesData] = await Promise.all([
        getReportHistory(orgId),
        getReportSchedules(orgId),
      ]);
      setReports(reportsData);
      setSchedules(schedulesData);
    } catch (err) {
      console.error('Reports load error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async () => {
    const now = new Date();
    const daysBack = dateRange === '7d' ? 7 : dateRange === '30d' ? 30 : 90;
    const dateFrom = new Date(now.getTime() - daysBack * 86400000).toISOString().split('T')[0];
    const dateTo = now.toISOString().split('T')[0];

    setGenerating(true);
    const { error } = await generateReport(orgId, {
      reportType: selectedType as any,
      format: selectedFormat,
      dateFrom,
      dateTo,
    });
    setGenerating(false);

    if (error) {
      if (Platform.OS === 'web') alert(error);
      else Alert.alert('Error', error);
    } else {
      const msg = 'Report generation started. It will appear below when ready.';
      if (Platform.OS === 'web') alert(msg);
      else Alert.alert('Report Queued', msg);
      loadData();
    }
  };

  const handleDownload = (report: Report) => {
    if (report.status !== 'ready') {
      const msg = 'Report is still generating...';
      if (Platform.OS === 'web') alert(msg);
      else Alert.alert('Not Ready', msg);
      return;
    }
    downloadReport(report);
  };

  const handleDeleteReport = async (reportId: string) => {
    const { error } = await deleteReport(reportId);
    if (!error) loadData();
  };

  const handleSchedule = async (frequency: 'daily' | 'weekly' | 'monthly') => {
    const { error } = await createReportSchedule(orgId, {
      reportType: selectedType,
      frequency,
      recipients: [],
    });

    if (error) {
      if (Platform.OS === 'web') alert(error);
      else Alert.alert('Error', error);
    } else {
      loadData();
    }
  };

  if (loading) {
    return <LoadingScreen />;
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </Pressable>
        <Text style={styles.title}>Reports</Text>
      </View>

      <ScrollView style={styles.content} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Report type selector */}
        <Text style={styles.sectionTitle}>Report Type</Text>
        <View style={styles.typeGrid}>
          {REPORT_TYPES.map(rt => (
            <Pressable
              key={rt.key}
              onPress={() => setSelectedType(rt.key)}
              style={[
                styles.typeCard,
                selectedType === rt.key && styles.typeCardActive,
              ]}
            >
              <Text style={styles.typeIcon}>{rt.icon}</Text>
              <Text style={[styles.typeLabel, selectedType === rt.key && { color: '#6366f1' }]}>
                {rt.label}
              </Text>
              <Text style={styles.typeDesc}>{rt.description}</Text>
            </Pressable>
          ))}
        </View>

        {/* Format & date range */}
        <View style={styles.optionsRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.optionLabel}>Format</Text>
            <View style={styles.pillRow}>
              {(['pdf', 'csv'] as const).map(f => (
                <Pressable
                  key={f}
                  onPress={() => setSelectedFormat(f)}
                  style={[styles.pill, selectedFormat === f && styles.pillActive]}
                >
                  <Text style={[styles.pillText, selectedFormat === f && styles.pillTextActive]}>
                    {f.toUpperCase()}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.optionLabel}>Date Range</Text>
            <View style={styles.pillRow}>
              {['7d', '30d', '90d'].map(d => (
                <Pressable
                  key={d}
                  onPress={() => setDateRange(d)}
                  style={[styles.pill, dateRange === d && styles.pillActive]}
                >
                  <Text style={[styles.pillText, dateRange === d && styles.pillTextActive]}>{d}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </View>

        {/* Generate button */}
        <Pressable onPress={handleGenerate} style={styles.generateBtn} disabled={generating}>
          <Text style={styles.generateBtnText}>
            {generating ? 'Generating...' : 'Generate Report'}
          </Text>
        </Pressable>

        {/* Scheduled reports */}
        <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Scheduled Reports</Text>
        {schedules.length === 0 ? (
          <View style={styles.scheduleEmpty}>
            <Text style={styles.scheduleEmptyText}>No scheduled reports</Text>
            <View style={styles.scheduleActions}>
              {(['weekly', 'monthly'] as const).map(freq => (
                <Pressable key={freq} onPress={() => handleSchedule(freq)} style={styles.scheduleBtn}>
                  <Text style={styles.scheduleBtnText}>Schedule {freq}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : (
          schedules.map(s => (
            <View key={s.id} style={styles.scheduleRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.scheduleType}>{s.report_type}</Text>
                <Text style={styles.scheduleFreq}>
                  {s.frequency} — next: {new Date(s.next_run).toLocaleDateString()}
                </Text>
              </View>
              <Pressable onPress={() => deleteReportSchedule(s.id).then(loadData)} style={styles.removeBtn}>
                <Text style={styles.removeBtnText}>Remove</Text>
              </Pressable>
            </View>
          ))
        )}

        {/* Report history */}
        <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Report History</Text>
        {reports.length === 0 ? (
          <Text style={styles.emptyText}>No reports generated yet</Text>
        ) : (
          reports.map(r => (
            <Pressable key={r.id} onPress={() => handleDownload(r)} style={styles.reportRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.reportType}>
                  {r.report_type} ({r.format.toUpperCase()})
                </Text>
                <Text style={styles.reportDate}>
                  {r.date_from} → {r.date_to}
                </Text>
              </View>
              <View style={[
                styles.statusBadge,
                r.status === 'ready' && styles.statusReady,
                r.status === 'failed' && styles.statusFailed,
              ]}>
                <Text style={[
                  styles.statusBadgeText,
                  r.status === 'ready' && { color: '#22c55e' },
                  r.status === 'failed' && { color: '#ef4444' },
                ]}>
                  {r.status}
                </Text>
              </View>
            </Pressable>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
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
  content: { flex: 1, padding: 16 },
  sectionTitle: { color: '#fff', fontSize: 14, fontWeight: '700', fontFamily: 'monospace', marginBottom: 10 },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  typeCard: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 10,
    padding: 12,
    width: '48%',
    minWidth: 140,
  },
  typeCardActive: { borderColor: '#6366f1', backgroundColor: '#6366f108' },
  typeIcon: { fontSize: 20, marginBottom: 6 },
  typeLabel: { color: '#fff', fontSize: 12, fontWeight: '700', fontFamily: 'monospace', marginBottom: 2 },
  typeDesc: { color: '#888', fontSize: 10, fontFamily: 'monospace' },
  optionsRow: { flexDirection: 'row', gap: 16, marginBottom: 16 },
  optionLabel: { color: '#ccc', fontSize: 12, fontFamily: 'monospace', marginBottom: 6 },
  pillRow: { flexDirection: 'row', gap: 6 },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  pillActive: { borderColor: '#6366f1', backgroundColor: '#6366f120' },
  pillText: { color: '#888', fontSize: 12, fontFamily: 'monospace' },
  pillTextActive: { color: '#6366f1' },
  generateBtn: {
    backgroundColor: '#6366f1',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  generateBtnText: { color: '#fff', fontSize: 15, fontWeight: '700', fontFamily: 'monospace' },
  scheduleEmpty: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
  },
  scheduleEmptyText: { color: '#888', fontSize: 12, fontFamily: 'monospace', marginBottom: 10 },
  scheduleActions: { flexDirection: 'row', gap: 8 },
  scheduleBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#6366f120',
    borderWidth: 1,
    borderColor: '#6366f140',
  },
  scheduleBtnText: { color: '#6366f1', fontSize: 12, fontFamily: 'monospace' },
  scheduleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 10,
    padding: 12,
    marginBottom: 6,
  },
  scheduleType: { color: '#fff', fontSize: 13, fontWeight: '700', fontFamily: 'monospace' },
  scheduleFreq: { color: '#888', fontSize: 11, fontFamily: 'monospace' },
  removeBtn: {
    backgroundColor: '#ef444415',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  removeBtnText: { color: '#ef4444', fontSize: 11, fontFamily: 'monospace' },
  emptyText: { color: '#888', fontSize: 12, fontFamily: 'monospace', textAlign: 'center', paddingVertical: 20 },
  reportRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 10,
    padding: 12,
    marginBottom: 6,
  },
  reportType: { color: '#fff', fontSize: 12, fontWeight: '700', fontFamily: 'monospace' },
  reportDate: { color: '#888', fontSize: 11, fontFamily: 'monospace' },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#f59e0b15',
  },
  statusReady: { backgroundColor: '#22c55e15' },
  statusFailed: { backgroundColor: '#ef444415' },
  statusBadgeText: { color: '#f59e0b', fontSize: 11, fontFamily: 'monospace' },
});
