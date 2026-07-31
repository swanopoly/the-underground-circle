/**
 * officeBridgeDiagPanelCore — pure model builder for the passive Office
 * bridge/pairing status panel (`OfficeBridgeDiagPanel`).
 *
 * Today bridges are invisible while healthy: `OfficeBridgeReadinessStrip`
 * is deliberately warn/danger-only and per-bridge detail exists only behind
 * the `/desktop diag` chat command. This core turns raw
 * `BridgeProbeResult[]` snapshots (from `bridgeHealthDiag.probeBridges`)
 * into an always-renderable panel model: a one-line collapsed summary
 * ("BRIDGES 4/5") plus bounded per-bridge rows.
 *
 * Contract:
 *   - Pure and total. Malformed / partial / null-ish probe entries never
 *     throw — they become explicit `error` rows.
 *   - Secret-safe. Row detail is sanitized: bearer/token-like strings are
 *     redacted and URLs are reduced to their origin before display.
 *     `raw` bodies from probes are never surfaced.
 *   - No react-native / DOM / Supabase imports so the smoke runner can
 *     load it directly (`import type` only from bridgeHealthDiag).
 */

import type { BridgeProbeResult } from './bridgeHealthDiag';

// ─── Types ─────────────────────────────────────────────────────────

/** Probe result stamped by the caller with the time the probe completed. */
export type TimestampedBridgeProbeResult = BridgeProbeResult & {
  /** Epoch ms when this probe round completed. Optional — absent renders '—'. */
  probedAtMs?: number;
};

export type BridgeDiagRowStatus = 'ok' | 'offline' | 'unpaired' | 'error';

export interface BridgeDiagPanelRow {
  /** Short bridge id, e.g. 'codex'. */
  name: string;
  /** Human display label, e.g. 'Codex'. */
  label: string;
  status: BridgeDiagRowStatus;
  /** Bounded, secret-free one-liner (tokens redacted, URLs origin-only). */
  detail: string;
  /** '30s ago' / '2m ago' / 'just now' / '—'. */
  probedAgoLabel: string;
}

export type BridgeDiagPanelTone = 'ok' | 'warn' | 'danger';

export interface BridgeDiagPanelSummary {
  healthy: number;
  total: number;
  /** e.g. 'BRIDGES 4/5'. */
  label: string;
  tone: BridgeDiagPanelTone;
}

export interface BridgeDiagPanelModel {
  summary: BridgeDiagPanelSummary;
  rows: BridgeDiagPanelRow[];
  /** Ready-made collapsed strip text, e.g.
   *  'BRIDGES 4/5 ✓ · codex offline · 30s ago'. */
  collapsedLine: string;
}

// ─── Sanitization (secret-safety) ──────────────────────────────────

const MAX_DETAIL_LENGTH = 100;

/**
 * Reduce free-form probe detail to a bounded, secret-free string:
 *   - `Bearer <anything>` → 'bearer [redacted]'
 *   - provider-key shapes (sk-…, ghp_…, xoxb-…) → '[redacted]'
 *   - long token-like runs (20+ chars mixing letters and digits) → '[redacted]'
 *   - URLs → origin only (scheme://host[:port]) — path/query/fragment dropped
 *   - bounded to MAX_DETAIL_LENGTH chars
 */
export function sanitizeBridgeDetail(input: unknown): string {
  if (typeof input !== 'string' || input.length === 0) return '';
  let out = input;
  // URLs first: keep only the origin so later token scrubbing can't leave
  // partial paths behind.
  out = out.replace(/(https?:\/\/[^\s/:?#]+(?::\d+)?)[^\s]*/gi, '$1');
  // Explicit bearer credentials.
  out = out.replace(/\bbearer\s+\S+/gi, 'bearer [redacted]');
  // Common provider key prefixes.
  out = out.replace(/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{8,}/g, '[redacted]');
  out = out.replace(/\bgh[pousr]_[A-Za-z0-9]{8,}/g, '[redacted]');
  out = out.replace(/\bxox[a-z]-[A-Za-z0-9-]{8,}/g, '[redacted]');
  // Generic token-like runs: 20+ chars of [A-Za-z0-9_-] containing at least
  // one digit AND one letter (won't hit ordinary words or plain numbers).
  out = out.replace(/(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{20,}/g, '[redacted]');
  out = out.replace(/\s+/g, ' ').trim();
  if (out.length > MAX_DETAIL_LENGTH) out = `${out.slice(0, MAX_DETAIL_LENGTH - 1)}…`;
  return out;
}

// ─── probedAgo formatting ──────────────────────────────────────────

export function formatProbedAgo(probedAtMs: unknown, nowMs: number): string {
  if (typeof probedAtMs !== 'number' || !Number.isFinite(probedAtMs)) return '—';
  const deltaMs = nowMs - probedAtMs;
  if (!Number.isFinite(deltaMs) || deltaMs < 0) return 'just now';
  if (deltaMs < 10_000) return 'just now';
  if (deltaMs < 60_000) return `${Math.floor(deltaMs / 1000)}s ago`;
  if (deltaMs < 3_600_000) return `${Math.floor(deltaMs / 60_000)}m ago`;
  return `${Math.floor(deltaMs / 3_600_000)}h ago`;
}

// ─── Row classification ────────────────────────────────────────────

function classifyStatus(r: Partial<BridgeProbeResult>): BridgeDiagRowStatus {
  switch (r.status) {
    case 'healthy':
      return 'ok';
    case 'offline':
      return 'offline';
    case 'degraded':
      // authMissing == bridge is up but the underlying CLI isn't
      // authenticated/paired; any other degradation is a generic error.
      return r.authMissing === true ? 'unpaired' : 'error';
    default:
      return 'error';
  }
}

const ROW_STATUS_WORD: Record<BridgeDiagRowStatus, string> = {
  ok: 'ok',
  offline: 'offline',
  unpaired: 'unpaired',
  error: 'error',
};

function buildRow(entry: unknown, nowMs: number): BridgeDiagPanelRow {
  if (!entry || typeof entry !== 'object') {
    return {
      name: 'unknown',
      label: 'Unknown',
      status: 'error',
      detail: 'malformed probe result',
      probedAgoLabel: '—',
    };
  }
  const r = entry as Partial<TimestampedBridgeProbeResult>;
  const name = typeof r.name === 'string' && r.name.length > 0 ? r.name : 'unknown';
  const label = typeof r.label === 'string' && r.label.length > 0 ? r.label : name;
  const status = classifyStatus(r);
  const sanitized = sanitizeBridgeDetail(r.detail);
  const detail = sanitized.length > 0 ? sanitized : ROW_STATUS_WORD[status];
  return {
    name,
    label,
    status,
    detail,
    probedAgoLabel: formatProbedAgo(r.probedAtMs, nowMs),
  };
}

// ─── Model builder ─────────────────────────────────────────────────

export function buildBridgeDiagPanelModel(
  probeResults: readonly unknown[] | null | undefined,
  nowMs: number,
): BridgeDiagPanelModel {
  const input = Array.isArray(probeResults) ? probeResults : [];
  const rows = input.map((entry) => buildRow(entry, nowMs));

  const total = rows.length;
  const healthy = rows.filter((r) => r.status === 'ok').length;
  const tone: BridgeDiagPanelTone =
    total === 0 ? 'warn' : healthy === total ? 'ok' : healthy === 0 ? 'danger' : 'warn';
  const summary: BridgeDiagPanelSummary = {
    healthy,
    total,
    label: `BRIDGES ${healthy}/${total}`,
    tone,
  };

  // Collapsed line: 'BRIDGES 4/5 ✓ · codex offline · 30s ago'
  const parts: string[] = [`${summary.label} ${tone === 'ok' ? '✓' : tone === 'warn' ? '⚠' : '✗'}`];
  const problems = rows.filter((r) => r.status !== 'ok');
  if (total === 0) {
    parts.push('no probe results');
  } else if (problems.length > 0 && problems.length <= 2) {
    for (const p of problems) parts.push(`${p.name} ${ROW_STATUS_WORD[p.status]}`);
  } else if (problems.length > 2) {
    parts.push(`${problems.length} bridges need attention`);
  }
  const ago = rows.find((r) => r.probedAgoLabel !== '—')?.probedAgoLabel;
  if (ago) parts.push(ago);

  return { summary, rows, collapsedLine: parts.join(' · ') };
}
