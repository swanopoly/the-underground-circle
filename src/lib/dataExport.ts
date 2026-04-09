// Data Export System - CSV & JSON exports for cost analytics
import { OfficeAgent } from './officeAgents';
import { OpenSwanSession } from './openswanService';
import { SessionTag } from './sessionTags';

export interface ExportRow {
  date: string;
  agentName: string;
  sessionKey: string;
  model: string;
  status: string;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  messages: number;
  turns: number;
  uptime: string;
  tags: string;
  connectionName: string;
}

// ─── Generate Export Data ──────────────────────────────────

export function generateExportData(
  agents: OfficeAgent[],
  sessions: OpenSwanSession[],
  sessionTags: Map<string, SessionTag[]>,
  startDate?: Date,
  endDate?: Date
): ExportRow[] {
  const rows: ExportRow[] = [];
  const now = new Date();

  for (const agent of agents) {
    // Extract sessionKey from agent.id
    const sessionKey = agent.id.includes('::') ? agent.id.split('::')[1] : agent.id;
    
    // Find matching session for detailed data
    const session = sessions.find(s => s.sessionKey === sessionKey);
    
    // Get tags for this session
    const tags = sessionTags.get(sessionKey) || [];
    const tagString = tags.map(t => t.label).join(', ');

    // Date filtering (if we had historical data, we'd filter here)
    // For now, we export current state
    
    const row: ExportRow = {
      date: now.toISOString().split('T')[0],
      agentName: agent.name,
      sessionKey,
      model: agent.model,
      status: agent.status,
      cost: agent.costToday,
      inputTokens: session?.totalInputTokens || 0,
      outputTokens: session?.totalOutputTokens || 0,
      totalTokens: agent.tokensUsed,
      messages: agent.messagesProcessed,
      turns: session?.turns || 0,
      uptime: session?.uptime || agent.lastActive,
      tags: tagString,
      connectionName: agent.connectionName,
    };

    rows.push(row);
  }

  return rows;
}

// ─── CSV Export ────────────────────────────────────────────

export function exportToCSV(rows: ExportRow[]): string {
  if (rows.length === 0) {
    return 'No data to export';
  }

  // Header row
  const headers = [
    'Date',
    'Agent Name',
    'Session Key',
    'Model',
    'Status',
    'Cost ($)',
    'Input Tokens',
    'Output Tokens',
    'Total Tokens',
    'Messages',
    'Turns',
    'Uptime',
    'Tags',
    'Connection',
  ];

  const csvRows = [headers.join(',')];

  // Data rows
  for (const row of rows) {
    const values = [
      row.date,
      escapeCSV(row.agentName),
      row.sessionKey,
      escapeCSV(row.model),
      row.status,
      row.cost.toFixed(4),
      row.inputTokens,
      row.outputTokens,
      row.totalTokens,
      row.messages,
      row.turns,
      escapeCSV(row.uptime),
      escapeCSV(row.tags),
      escapeCSV(row.connectionName),
    ];
    csvRows.push(values.join(','));
  }

  return csvRows.join('\n');
}

function escapeCSV(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// ─── JSON Export ───────────────────────────────────────────

export function exportToJSON(rows: ExportRow[]): string {
  return JSON.stringify(rows, null, 2);
}

// ─── Download File ─────────────────────────────────────────

export function downloadFile(content: string, filename: string, mimeType: string): void {
  if (typeof window === 'undefined') {
    console.error('Download only works in browser');
    return;
  }

  // Create blob
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);

  // Create temporary download link
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  
  // Trigger download
  link.click();
  
  // Cleanup
  setTimeout(() => {
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, 100);
}

// ─── Export Helpers ────────────────────────────────────────

export function generateFilename(format: 'csv' | 'json'): string {
  const now = new Date();
  const date = now.toISOString().split('T')[0];
  const time = now.toTimeString().split(' ')[0].replace(/:/g, '-');
  return `agent-data-${date}-${time}.${format}`;
}

export function getMimeType(format: 'csv' | 'json'): string {
  return format === 'csv' ? 'text/csv' : 'application/json';
}

// ─── Export with Summary ───────────────────────────────────

export interface ExportSummary {
  exportDate: string;
  agentCount: number;
  totalCost: number;
  totalTokens: number;
  totalMessages: number;
  dateRange: {
    start: string;
    end: string;
  };
}

export function generateExportSummary(rows: ExportRow[]): ExportSummary {
  const now = new Date();
  
  return {
    exportDate: now.toISOString(),
    agentCount: rows.length,
    totalCost: rows.reduce((sum, r) => sum + r.cost, 0),
    totalTokens: rows.reduce((sum, r) => sum + r.totalTokens, 0),
    totalMessages: rows.reduce((sum, r) => sum + r.messages, 0),
    dateRange: {
      start: rows[0]?.date || now.toISOString().split('T')[0],
      end: rows[rows.length - 1]?.date || now.toISOString().split('T')[0],
    },
  };
}

export function exportToJSONWithSummary(rows: ExportRow[]): string {
  const summary = generateExportSummary(rows);
  
  return JSON.stringify({
    summary,
    data: rows,
  }, null, 2);
}

// ─── Clipboard Export ──────────────────────────────────────

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    
    // Fallback for older browsers
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const success = document.execCommand('copy');
    document.body.removeChild(textarea);
    return success;
  } catch (error) {
    console.error('Failed to copy to clipboard:', error);
    return false;
  }
}
