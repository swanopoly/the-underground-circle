/**
 * CSV import for the Site Credential Vault.
 *
 * Auto-detects 1Password, Bitwarden, and LastPass export formats based on
 * the header row, normalizes them to a common shape, and emits ready-to-save
 * vault rows. The parser is RFC 4180 compatible (quoted fields, escaped
 * quotes, embedded commas/newlines).
 */
import type { SiteCredentialSecretKind, StoreSiteCredentialVaultInput } from './siteAutomation';

export type VaultImportFormat = '1password' | 'bitwarden' | 'lastpass' | 'generic' | 'unknown';

export interface ParsedImportRow {
  /** Source-row index for stable identification in the UI. */
  index: number;
  /** Display title from the source — used as fallback platform/label. */
  title: string;
  url: string;
  username: string;
  password: string;
  notes: string;
  totp: string;
  /** Free-form folder/section/group/tag values from the source. */
  tags: string[];
  /** Best-guess platform extracted from the URL or title. */
  platform: string;
  /** Best-guess label, defaults to "default" or "imported". */
  label: string;
  /** Whether this row has at least a username + password to be useful. */
  isComplete: boolean;
}

export interface VaultImportParseResult {
  format: VaultImportFormat;
  rows: ParsedImportRow[];
  warnings: string[];
}

// ─── RFC 4180 CSV parser ──────────────────────────────────────────────────

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      // Handle \r\n by skipping the trailing \n.
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      // Skip blank lines.
      if (row.length > 1 || row[0].length > 0) rows.push(row);
      row = [];
      continue;
    }
    field += ch;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.length > 1 || row[0].length > 0) rows.push(row);
  }
  return rows;
}

function detectFormat(headers: string[]): VaultImportFormat {
  const set = new Set(headers.map((h) => h.trim().toLowerCase()));
  // Bitwarden export has a distinctive `login_uri`/`login_password` pair.
  if (set.has('login_password') || set.has('login_uri')) return 'bitwarden';
  // LastPass export: url + grouping + extra.
  if (set.has('url') && set.has('grouping') && (set.has('extra') || set.has('totp'))) return 'lastpass';
  // 1Password export: Title + Url + Username + Password + Notes (capitalized headers).
  if (set.has('title') && set.has('url') && set.has('username') && set.has('password')) return '1password';
  // Generic: any 3-of-4 of the basic shape.
  const generic = ['name', 'url', 'username', 'password'].filter((k) => set.has(k)).length;
  if (generic >= 3) return 'generic';
  return 'unknown';
}

function platformFromUrl(url: string, fallback: string): string {
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    const host = u.hostname.replace(/^www\./, '');
    const root = host.split('.').slice(-2, -1)[0] || host;
    return root || fallback || 'imported';
  } catch {
    return fallback || 'imported';
  }
}

function mapColumn(headers: string[], row: string[], aliases: string[]): string {
  for (const alias of aliases) {
    const idx = headers.findIndex((h) => h.trim().toLowerCase() === alias);
    if (idx >= 0 && row[idx] !== undefined) return row[idx];
  }
  return '';
}

function rowFromMap(format: VaultImportFormat, headers: string[], row: string[], index: number): ParsedImportRow {
  const title = mapColumn(headers, row, ['title', 'name']).trim();
  const url = mapColumn(headers, row, ['url', 'urls', 'login_uri', 'website']).trim();
  const username = mapColumn(headers, row, ['username', 'user_name', 'login_username', 'email']).trim();
  const password = mapColumn(headers, row, ['password', 'login_password', 'pass']).trim();
  const notes = mapColumn(headers, row, ['notes', 'extra', 'comment', 'notesplain']).trim();
  const totp = mapColumn(headers, row, ['otpauth', 'totp', 'login_totp']).trim();
  const folder = mapColumn(headers, row, ['folder', 'grouping', 'section', 'category']).trim();
  const tagsCsv = mapColumn(headers, row, ['tags', 'labels']).trim();

  const tags = [
    ...folder.split(/[\/,]/).map((t) => t.trim()).filter(Boolean),
    ...tagsCsv.split(/[,;]/).map((t) => t.trim()).filter(Boolean),
  ]
    .map((tag) => tag.toLowerCase().replace(/[^a-z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''))
    .filter(Boolean);
  if (format !== 'unknown') tags.push(`imported-${format}`);

  const platform = platformFromUrl(url, title);
  const label = title.toLowerCase().replace(/[^a-z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'default';

  return {
    index,
    title,
    url,
    username,
    password,
    notes,
    totp,
    tags: Array.from(new Set(tags)).slice(0, 8),
    platform,
    label,
    isComplete: !!password && !!(username || url),
  };
}

export function parseVaultCsv(text: string): VaultImportParseResult {
  const warnings: string[] = [];
  const grid = parseCsv(text);
  if (grid.length === 0) {
    return { format: 'unknown', rows: [], warnings: ['File is empty.'] };
  }
  const headers = grid[0];
  const format = detectFormat(headers);
  if (format === 'unknown') {
    warnings.push(
      `Header row could not be matched to a known format. Detected columns: ${headers.join(', ')}. Falling back to generic mapping.`,
    );
  }
  const rows: ParsedImportRow[] = [];
  for (let i = 1; i < grid.length; i++) {
    const row = grid[i];
    if (row.length === 1 && row[0].trim() === '') continue;
    // Bitwarden exports include non-login row types ("note", "card", etc.) — skip them.
    const typeCol = mapColumn(headers, row, ['type']);
    if (typeCol && format === 'bitwarden' && typeCol.trim().toLowerCase() !== 'login') continue;
    rows.push(rowFromMap(format, headers, row, i));
  }
  return { format, rows, warnings };
}

export function buildVaultImportInput(
  row: ParsedImportRow,
  circleId: string,
): StoreSiteCredentialVaultInput {
  // 1P and BW exports rarely tell us the secret kind. Default to 'password';
  // the user can edit secret type after import if it should be a token.
  const secretKind: SiteCredentialSecretKind = 'password';
  const metadata: Record<string, unknown> = {
    source: 'csv_import',
    importedAt: new Date().toISOString(),
    importTitle: row.title || row.label,
    notes: row.notes,
    tags: row.tags,
  };
  if (row.totp) metadata.totp_seed_present = true;
  return {
    circleId,
    platform: row.platform,
    label: row.label,
    siteUrl: row.url || null,
    loginUrl: row.url || null,
    username: row.username || null,
    secret: row.password,
    secretKind,
    accessPolicy: {
      require_approval: true,
      allowed_origins: row.url ? [tryHostname(row.url)].filter(Boolean) : [],
      allowed_actions: ['login'],
      reveal_duration_seconds: 30,
    },
    metadata,
    rotationDueAt: null,
  };
}

function tryHostname(value: string): string {
  try {
    const u = new URL(value.startsWith('http') ? value : `https://${value}`);
    return u.hostname;
  } catch {
    return '';
  }
}
