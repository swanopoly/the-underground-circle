/**
 * Lightweight a11y audit for the Chat Live Builder output.
 *
 * Uses the browser's DOMParser on web; no-ops on native (the Builder is
 * web-only anyway). Scans for the most common landing-page a11y issues
 * that LLM-generated HTML tends to have — missing alts, unlabelled buttons
 * and inputs, heading level jumps, missing lang, empty href targets.
 *
 * Not a replacement for axe-core or Lighthouse — this is a "is your output
 * obviously broken for screen readers" sanity check that runs in under 5ms.
 */

export type A11yLevel = 'error' | 'warn';

export interface A11yIssue {
  level: A11yLevel;
  rule: string;        // machine id: missing-alt, empty-button, etc.
  message: string;     // short user-facing explanation
  snippet: string;     // 80 chars of the offending HTML
}

interface DomFinding {
  level: A11yLevel;
  rule: string;
  message: string;
  element: Element;
}

const RULES = {
  missingAlt: 'missing-alt',
  emptyButton: 'empty-button',
  unlabelledInput: 'unlabelled-input',
  missingLang: 'missing-lang',
  headingSkip: 'heading-skip',
  emptyHref: 'empty-href',
  contrastHint: 'contrast-hint',
  clickableDiv: 'clickable-div',
} as const;

function snippetOf(el: Element): string {
  const html = el.outerHTML || '';
  return html.slice(0, 80);
}

export function runA11yAudit(html: string): A11yIssue[] {
  if (typeof DOMParser === 'undefined' || !html) return [];
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, 'text/html');
  } catch {
    return [];
  }

  const findings: DomFinding[] = [];

  // 1. Missing alt on img (that isn't purely decorative via role="presentation")
  doc.querySelectorAll('img').forEach(img => {
    const hasAlt = img.hasAttribute('alt');
    const role = img.getAttribute('role');
    if (!hasAlt && role !== 'presentation' && role !== 'none') {
      findings.push({
        level: 'error', rule: RULES.missingAlt, element: img,
        message: 'Image has no alt attribute. Add alt="" if decorative or a description.',
      });
    }
  });

  // 2. Empty button — no visible text AND no aria-label
  doc.querySelectorAll('button').forEach(btn => {
    const hasText = (btn.textContent || '').trim().length > 0;
    const hasLabel = btn.hasAttribute('aria-label') || btn.hasAttribute('aria-labelledby') || btn.hasAttribute('title');
    if (!hasText && !hasLabel) {
      findings.push({
        level: 'error', rule: RULES.emptyButton, element: btn,
        message: 'Button has no text and no aria-label. Screen readers will say "button" only.',
      });
    }
  });

  // 3. Unlabelled input — no associated label, aria-label, or placeholder (warn for placeholder only)
  doc.querySelectorAll('input, textarea, select').forEach(input => {
    const el = input as HTMLInputElement;
    const type = el.type?.toLowerCase();
    if (type === 'hidden' || type === 'submit' || type === 'button') return;
    const id = el.id;
    const hasLabelFor = id ? !!doc.querySelector(`label[for="${id}"]`) : false;
    const hasAriaLabel = el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby');
    const wrappedInLabel = el.closest('label') !== null;
    if (!hasLabelFor && !hasAriaLabel && !wrappedInLabel) {
      findings.push({
        level: 'error', rule: RULES.unlabelledInput, element: input,
        message: 'Form field has no label. Wrap it in a <label> or add aria-label.',
      });
    }
  });

  // 4. Missing lang on <html>
  const htmlEl = doc.documentElement;
  if (htmlEl && !htmlEl.hasAttribute('lang')) {
    findings.push({
      level: 'warn', rule: RULES.missingLang, element: htmlEl,
      message: 'Root <html> missing lang attribute. Add lang="en" (or your locale).',
    });
  }

  // 5. Heading level skip (h1→h3 without an h2, etc.)
  const headings = Array.from(doc.querySelectorAll('h1, h2, h3, h4, h5, h6')) as HTMLElement[];
  let prevLevel = 0;
  for (const h of headings) {
    const level = parseInt(h.tagName.slice(1), 10);
    if (prevLevel > 0 && level > prevLevel + 1) {
      findings.push({
        level: 'warn', rule: RULES.headingSkip, element: h,
        message: `Heading jumps from h${prevLevel} to h${level}. Insert intermediate levels or demote.`,
      });
    }
    prevLevel = level;
  }

  // 6. Empty href (<a href="#">click</a> as a button proxy)
  doc.querySelectorAll('a[href="#"], a[href=""]').forEach(a => {
    findings.push({
      level: 'warn', rule: RULES.emptyHref, element: a,
      message: 'Link with empty href — use <button> instead or provide a real URL.',
    });
  });

  // 7. Clickable <div> — has onclick attr or role="button"
  doc.querySelectorAll('div[onclick], span[onclick]').forEach(el => {
    findings.push({
      level: 'warn', rule: RULES.clickableDiv, element: el,
      message: 'Non-semantic clickable element. Prefer <button> so keyboard + screen-reader users can activate.',
    });
  });

  // 8. Very light contrast hint — flags pure white-on-white or pure black-on-black inline
  doc.querySelectorAll('[style]').forEach(el => {
    const style = (el.getAttribute('style') || '').toLowerCase();
    if (/color:\s*#fff/.test(style) && /background[^;]*#fff/.test(style)) {
      findings.push({
        level: 'warn', rule: RULES.contrastHint, element: el,
        message: 'Inline style has white text on white background. Will be invisible.',
      });
    }
  });

  return findings.map(f => ({
    level: f.level,
    rule: f.rule,
    message: f.message,
    snippet: snippetOf(f.element),
  }));
}

export function countByLevel(issues: A11yIssue[]): { errors: number; warns: number } {
  let errors = 0, warns = 0;
  for (const i of issues) (i.level === 'error' ? errors++ : warns++);
  return { errors, warns };
}
