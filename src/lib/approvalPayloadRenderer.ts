/**
 * approvalPayloadRenderer — UC-1b. Pure formatter that turns an
 * agent_run_approvals.payload blob into a human-readable action
 * description for the RunApprovalBanner.
 *
 * Shape of expected payloads (from approvals.request tool):
 *   {
 *     tool?: string,              // "desktop.click_element", etc.
 *     app?: string,               // "zoom.us"
 *     url?: string,               // "https://..."
 *     role?: string,              // "button" | "AXMenuItem" | ...
 *     label?: string,             // accessible name / label
 *     text?: string,              // for typing / filling
 *     combo?: string,             // for press_keys
 *     x?: number, y?: number,     // for click_at fallback
 *     path?: string,              // a11y path (only shown if no label)
 *   }
 *
 * Returns `{ headline, detail? }`. `headline` is the one-liner shown
 * in the banner ("Click **Send** button"); `detail` is optional
 * secondary context ("in Safari on example.com").
 *
 * Keeping this pure + JSON-driven means the v2 edge fn can attach any
 * of the fields above to `approvals.request` payloads and the banner
 * renders them correctly without coordinating schemas.
 */

export interface ApprovalPayload {
  tool?: string;
  app?: string;
  url?: string;
  role?: string;
  label?: string;
  text?: string;
  combo?: string;
  x?: number;
  y?: number;
  path?: string;
  [key: string]: unknown;
}

export interface RenderedApprovalAction {
  headline: string;
  detail?: string;
}

function truncate(s: string, n: number): string {
  const str = String(s || '');
  return str.length <= n ? str : str.slice(0, n - 1) + '…';
}

/**
 * Friendly display name for a tool — maps the `namespace.verb`
 * identifier to a human verb + target hint.
 */
function toolAction(tool: string): { verb: string; target: 'app' | 'browser' | 'file' | 'generic' } {
  switch (tool) {
    case 'desktop.launch_app': return { verb: 'Launch', target: 'app' };
    case 'desktop.focus_app':  return { verb: 'Focus', target: 'app' };
    case 'desktop.click_element':
    case 'desktop.click_at':   return { verb: 'Click', target: 'app' };
    case 'desktop.type_text':  return { verb: 'Type into', target: 'app' };
    case 'desktop.press_keys': return { verb: 'Press keys in', target: 'app' };
    case 'desktop.open_url':   return { verb: 'Open', target: 'browser' };
    case 'desktop.open_path':  return { verb: 'Open', target: 'file' };
    case 'browser.open_url':   return { verb: 'Navigate to', target: 'browser' };
    case 'browser.click_role': return { verb: 'Click', target: 'browser' };
    case 'browser.fill_field': return { verb: 'Fill', target: 'browser' };
    case 'browser.press_key':  return { verb: 'Press', target: 'browser' };
    default: return { verb: tool.replace(/[_.]/g, ' '), target: 'generic' };
  }
}

export function renderApprovalAction(
  payload: ApprovalPayload | null | undefined,
  fallbackTitle: string,
): RenderedApprovalAction {
  const p = (payload || {}) as ApprovalPayload;
  if (!p || typeof p !== 'object' || !p.tool) {
    // No structured payload — banner will keep showing the raw title.
    return { headline: fallbackTitle };
  }

  const { verb, target } = toolAction(p.tool);
  const parts: string[] = [verb];
  const details: string[] = [];

  // Label / role take precedence; fall back to text/url/path if present.
  if (p.label) {
    parts.push(`**${truncate(p.label, 80)}**`);
    if (p.role) details.push(`${p.role.replace(/^AX/, '').toLowerCase()} element`);
  } else if (p.text) {
    parts.push(`**"${truncate(p.text, 60)}"**`);
  } else if (p.combo) {
    parts.push(`**${truncate(p.combo, 40)}**`);
  } else if (p.url) {
    try {
      const u = new URL(p.url);
      parts.push(`**${u.host}${u.pathname === '/' ? '' : u.pathname}**`);
      if (u.search) details.push('with query params');
    } catch {
      parts.push(`**${truncate(p.url, 60)}**`);
    }
  } else if (p.x !== undefined && p.y !== undefined) {
    parts.push(`at (${p.x}, ${p.y})`);
  } else if (p.path) {
    parts.push(`at path ${p.path}`);
  }

  // Where this action targets — app for desktop.*, url/host for browser.*.
  if (target === 'app' && p.app) {
    details.push(`in ${p.app}`);
  } else if (target === 'browser' && p.url) {
    try {
      const u = new URL(p.url);
      if (p.tool !== 'browser.open_url' && p.tool !== 'desktop.open_url') {
        details.push(`on ${u.host}`);
      }
    } catch { /* already shown above */ }
  }

  const headline = parts.join(' ');
  const detail = details.length ? details.join(' · ') : undefined;
  return { headline, detail };
}
