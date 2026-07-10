/**
 * tableArtifact — pure CSV <-> table helpers behind the `table` structured
 * artifact kind (gap #1 in docs/HUMAN_PARITY_CAPABILITY_MAP.md).
 *
 * LOCKSTEP(src/lib/swanbot.ts): `SwanBotStructuredArtifact` kind `'table'`
 * carries RAW CSV text in `content`. swanbot's artifact parse path upgrades
 * csv code fences to `table` using `looksLikeCsvArtifact`; the chat card
 * (src/components/chat/ChatArtifacts.tsx) renders the grid with
 * `parseCsvText` and downloads with `tableToCsv`.
 *
 * Dependency-light on purpose (no react-native / supabase imports) so the
 * smoke script `scripts/table-artifact-smoketest.ts` can load it with tsx.
 */

export interface ParsedTable {
  headers: string[];
  rows: string[][];
  /**
   * Source dimensions BEFORE the render caps were applied. Set by
   * `parseCsvText` so the UI can caption truncation ("showing first 200 of
   * 512 rows"); optional so hand-built tables round-trip through
   * `tableToCsv` without them.
   */
  sourceRowCount?: number;
  sourceColCount?: number;
}

/** Render caps — parseCsvText silently clamps to this many data rows/cols. */
export const TABLE_MAX_ROWS = 200;
export const TABLE_MAX_COLS = 30;

/**
 * Languages that a code fence can carry while still being CSV-upgrade
 * eligible via the content heuristic (no language, or a generic text tag).
 * Any OTHER explicit language (python, json, ts…) vetoes the upgrade so we
 * never hijack a real code artifact whose lines happen to contain commas.
 */
const CSV_NEUTRAL_LANGUAGES = new Set(['', 'text', 'plaintext', 'txt']);

/**
 * RFC-4180-ish CSV parser: quoted fields, escaped quotes (""), commas and
 * newlines inside quotes, CRLF/CR/LF line endings. Lenient beyond that —
 * a stray quote mid-field is kept literally.
 *
 * Returns null when the input has no header + at least one data row, when
 * the header row is entirely empty, or when the shape is ragged beyond
 * tolerance (more than half the data rows are WIDER than the header row).
 * Short rows are padded with '' to the header width; over-wide rows are
 * truncated. Output is clamped to TABLE_MAX_ROWS x TABLE_MAX_COLS with the
 * pre-clamp dimensions exposed via sourceRowCount/sourceColCount.
 */
export function parseCsvText(csv: string): ParsedTable | null {
  if (typeof csv !== 'string') return null;
  const text = csv.replace(/^\uFEFF/, '');
  if (!text.trim()) return null;

  // ── Character scan ──────────────────────────────────────────────────────
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === '') {
      // Opening quote only counts at field start; elsewhere it is literal.
      inQuotes = true;
      continue;
    }
    if (ch === ',') {
      record.push(field);
      field = '';
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      record.push(field);
      field = '';
      records.push(record);
      record = [];
      continue;
    }
    field += ch;
  }
  // Final field/record (no trailing newline case). An unterminated quote is
  // tolerated: whatever was collected becomes the field.
  if (field !== '' || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  // Drop fully-empty records (blank lines, trailing newline artifacts).
  const meaningful = records.filter((cells) => cells.some((cell) => cell !== ''));
  if (meaningful.length < 2) return null; // need header + >=1 data row

  const rawHeaders = meaningful[0];
  if (!rawHeaders.some((cell) => cell.trim() !== '')) return null;
  const dataRecords = meaningful.slice(1);

  // ── Raggedness tolerance ────────────────────────────────────────────────
  // Short rows are routine (trailing empties omitted) — pad them. Rows WIDER
  // than the header mean the shape is suspect; tolerate a minority, bail
  // when more than half the data rows overflow.
  const overWide = dataRecords.filter((cells) => cells.length > rawHeaders.length).length;
  if (overWide > dataRecords.length / 2) return null;

  const sourceColCount = rawHeaders.length;
  const sourceRowCount = dataRecords.length;
  const width = Math.min(rawHeaders.length, TABLE_MAX_COLS);
  const headers = rawHeaders.slice(0, width);
  const rows = dataRecords.slice(0, TABLE_MAX_ROWS).map((cells) => {
    const clamped = cells.slice(0, width);
    while (clamped.length < width) clamped.push('');
    return clamped;
  });

  return { headers, rows, sourceRowCount, sourceColCount };
}

function escapeCsvField(field: string): string {
  return /[",\n\r]/.test(field) ? `"${field.replace(/"/g, '""')}"` : field;
}

/**
 * Serializes a table back to CSV with round-trip-safe quoting: any field
 * containing a comma, quote, or newline is quoted with internal quotes
 * doubled, so `parseCsvText(tableToCsv(t))` reproduces headers/rows exactly.
 */
export function tableToCsv(table: ParsedTable): string {
  return [table.headers, ...table.rows]
    .map((cells) => cells.map((cell) => escapeCsvField(String(cell ?? ''))).join(','))
    .join('\n');
}

/**
 * Decides whether a fenced block / artifact payload should be treated as a
 * CSV table: the fence language is `csv`, OR the language is absent/generic
 * text AND the content's first 3 non-empty lines share a consistent comma
 * count >= 1 with no ``` markers and no JSON/HTML-looking opener. Explicit
 * non-text languages (python, json, ts…) always veto so code artifacts are
 * never hijacked.
 */
export function looksLikeCsvArtifact(language: string | null | undefined, content: string): boolean {
  const lang = String(language || '').trim().toLowerCase();
  if (lang === 'csv') return true;
  if (!CSV_NEUTRAL_LANGUAGES.has(lang)) return false;

  const text = String(content || '').trim();
  if (!text || text.includes('```')) return false;
  const opener = text.charAt(0);
  if (opener === '{' || opener === '[' || opener === '<') return false;

  const lines = text
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 3);
  if (lines.length < 2) return false; // need header + at least one data row

  const commaCounts = lines.map((line) => (line.match(/,/g) || []).length);
  if (commaCounts[0] < 1) return false;
  return commaCounts.every((count) => count === commaCounts[0]);
}
