/**
 * computerUseExport — serialize a completed Computer Use run to clean
 * markdown that the user can paste into Notion, a PR, a doc, etc.
 *
 * Intentionally text-only: we don't try to inline the final screenshot
 * because most targets (GitHub issues, Slack, Notion) strip data-URIs.
 * A "live session" link is included instead — Browserbase sessions stay
 * viewable for a while after the run completes.
 */

export interface ExportableRun {
  task: string;
  summary: string;
  findings?: Array<{
    title: string;
    url?: string;
    price?: string;
    rating?: string;
    notes?: string;
    thumbnail?: string;
  }> | null;
  liveUrl?: string | null;
  sessionId?: string | null;
  iterations?: number;
  tokens?: { input: number; output: number };
  createdAt?: Date | string;
}

export function runToMarkdown(run: ExportableRun): string {
  const lines: string[] = [];
  lines.push(`# ${run.task}`);
  if (run.createdAt) {
    const d = typeof run.createdAt === 'string' ? new Date(run.createdAt) : run.createdAt;
    if (!Number.isNaN(d.getTime())) {
      lines.push(`_${d.toLocaleString()}_`);
    }
  }
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(run.summary.trim() || '_(no summary)_');

  if (run.findings && run.findings.length) {
    lines.push('');
    lines.push('## Findings');
    lines.push('');
    run.findings.forEach((f, i) => {
      const title = f.url ? `[${f.title}](${f.url})` : f.title;
      const bits: string[] = [`${i + 1}. **${title}**`];
      const meta: string[] = [];
      if (f.price) meta.push(f.price);
      if (f.rating) meta.push(`★ ${f.rating}`);
      if (meta.length) bits.push(` — _${meta.join(' · ')}_`);
      lines.push(bits.join(''));
      if (f.notes) lines.push(`   ${f.notes}`);
    });
  }

  lines.push('');
  lines.push('---');
  const footer: string[] = [];
  if (run.iterations) footer.push(`${run.iterations} step${run.iterations === 1 ? '' : 's'}`);
  if (run.tokens) footer.push(`${run.tokens.input + run.tokens.output} tokens`);
  if (run.liveUrl) footer.push(`[Live session](${run.liveUrl})`);
  if (footer.length) lines.push(`_${footer.join(' · ')}_`);

  return lines.join('\n');
}

export async function copyRunAsMarkdown(run: ExportableRun): Promise<boolean> {
  const md = runToMarkdown(run);
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(md);
      return true;
    } catch {
      // fall through to textarea fallback
    }
  }
  if (typeof document !== 'undefined') {
    try {
      const ta = document.createElement('textarea');
      ta.value = md;
      ta.style.position = 'fixed';
      ta.style.left = '-10000px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return true;
    } catch {}
  }
  return false;
}
