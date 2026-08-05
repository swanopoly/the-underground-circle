/**
 * Reporting & Export — Generate PDF/CSV reports, manage schedules.
 */

import { supabase } from './supabase';
import { Linking } from 'react-native';
import type { Report, ReportSchedule } from '../types';

// ─── Generate ────────────────────────────────────────────────────────

export async function generateReport(
  orgId: string,
  options: {
    reportType: 'analytics' | 'goals' | 'engagement' | 'comprehensive';
    format: 'pdf' | 'csv';
    dateFrom: string;
    dateTo: string;
    circleIds?: string[];
  }
): Promise<{ data?: Report; error?: string }> {
  // Fail-safe: a backgrounded-tab auth throw must not crash report creation (P67/#101).
  const { data: userData } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
  if (!userData.user) return { error: 'Not authenticated' };

  // Create report record
  const { data: report, error: insertError } = await supabase
    .from('reports')
    .insert({
      org_id: orgId,
      report_type: options.reportType,
      format: options.format,
      date_from: options.dateFrom,
      date_to: options.dateTo,
      created_by: userData.user.id,
      status: 'pending',
      metadata: options.circleIds ? { circle_ids: options.circleIds } : {},
    })
    .select()
    .single();

  if (insertError) return { error: insertError.message };

  // Trigger generation via edge function
  const { error: fnError } = await supabase.functions.invoke('generate-report', {
    body: { reportId: report.id, orgId },
  });

  if (fnError) return { error: fnError.message };
  return { data: report };
}

// ─── History ─────────────────────────────────────────────────────────

export async function getReportHistory(orgId: string): Promise<Report[]> {
  const { data } = await supabase
    .from('reports')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(50);

  return data || [];
}

export async function getReport(reportId: string): Promise<Report | null> {
  const { data } = await supabase
    .from('reports')
    .select('*')
    .eq('id', reportId)
    .single();

  return data;
}

export async function downloadReport(report: Report): Promise<void> {
  if (report.file_url) {
    Linking.openURL(report.file_url);
  }
}

export async function deleteReport(reportId: string): Promise<{ error?: string }> {
  const { error } = await supabase
    .from('reports')
    .delete()
    .eq('id', reportId);

  if (error) return { error: error.message };
  return {};
}

// ─── Schedules ───────────────────────────────────────────────────────

export async function getReportSchedules(orgId: string): Promise<ReportSchedule[]> {
  const { data } = await supabase
    .from('report_schedules')
    .select('*')
    .eq('org_id', orgId)
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  return data || [];
}

export async function createReportSchedule(
  orgId: string,
  schedule: {
    reportType: string;
    frequency: 'daily' | 'weekly' | 'monthly';
    recipients: string[];
  }
): Promise<{ error?: string }> {
  const nextRun = computeNextRun(schedule.frequency);

  const { error } = await supabase
    .from('report_schedules')
    .insert({
      org_id: orgId,
      report_type: schedule.reportType,
      frequency: schedule.frequency,
      recipients: schedule.recipients,
      next_run: nextRun,
      is_active: true,
    });

  if (error) return { error: error.message };
  return {};
}

export async function deleteReportSchedule(scheduleId: string): Promise<{ error?: string }> {
  const { error } = await supabase
    .from('report_schedules')
    .update({ is_active: false })
    .eq('id', scheduleId);

  if (error) return { error: error.message };
  return {};
}

// ─── Helpers ─────────────────────────────────────────────────────────

function computeNextRun(frequency: 'daily' | 'weekly' | 'monthly'): string {
  const now = new Date();
  switch (frequency) {
    case 'daily':
      now.setDate(now.getDate() + 1);
      now.setHours(6, 0, 0, 0);
      break;
    case 'weekly':
      now.setDate(now.getDate() + (7 - now.getDay()) % 7 + 1);
      now.setHours(6, 0, 0, 0);
      break;
    case 'monthly':
      now.setMonth(now.getMonth() + 1, 1);
      now.setHours(6, 0, 0, 0);
      break;
  }
  return now.toISOString();
}

export const REPORT_TYPES = [
  { key: 'analytics', label: 'Analytics Summary', icon: '📊', description: 'Check-ins, streaks, member activity' },
  { key: 'goals', label: 'Goal Progress', icon: '🎯', description: 'OKR progress and alignment' },
  { key: 'engagement', label: 'Engagement Report', icon: '👥', description: 'Member participation and trends' },
  { key: 'comprehensive', label: 'Comprehensive', icon: '📋', description: 'Full org overview with all metrics' },
] as const;
