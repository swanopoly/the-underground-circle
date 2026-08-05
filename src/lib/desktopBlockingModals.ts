export type DesktopA11yNodeLike = {
  id: string;
  role: string;
  label?: string;
  value?: string;
  bbox?: [number, number, number, number];
  children?: DesktopA11yNodeLike[];
};

type BlockingAppModalPolicy = {
  id: string;
  label: string;
  appPattern?: RegExp;
  match: RegExp;
  // Strict allow-list. Mutating options like Replace Fonts, Update Links,
  // Relink, Activate, Save, and Discard are intentionally not included.
  preferredButtons: RegExp[];
};

export type BlockingAppModalPlan = {
  policyId: string;
  policyLabel: string;
  app: string | null;
  buttonLabel: string;
  buttonPath: string;
  summary: string;
};

const BLOCKING_APP_MODAL_POLICIES: BlockingAppModalPolicy[] = [
  {
    id: 'indesign_missing_fonts',
    label: 'InDesign missing fonts',
    appPattern: /indesign/i,
    match: /\b(missing fonts?|fonts? (?:are )?missing|find fonts?|auto-activate adobe fonts?|font activation|type\s*1 fonts?)\b/i,
    preferredButtons: [/^skip$/i, /^ok$/i, /^continue$/i, /^open$/i, /^done$/i, /^close$/i],
  },
  {
    id: 'indesign_missing_or_modified_links',
    label: 'InDesign missing or modified links',
    appPattern: /indesign/i,
    match: /\b(missing links?|links? (?:are )?(?:missing|modified|changed)|linked files? (?:are )?missing|cannot find linked|update links?)\b/i,
    preferredButtons: [/^don'?t update(?: links?)?$/i, /^skip$/i, /^ok$/i, /^continue$/i, /^open$/i, /^done$/i],
  },
  {
    id: 'adobe_profile_warning',
    label: 'Adobe color profile warning',
    appPattern: /adobe|photoshop|illustrator|indesign/i,
    match: /\b(embedded profile mismatch|missing profile|color settings|working space|profile mismatch|document profile)\b/i,
    preferredButtons: [/^ok$/i, /^continue$/i, /^open$/i, /^use embedded/i, /^preserve/i, /^leave as is$/i],
  },
  {
    id: 'adobe_safe_acknowledgement',
    label: 'Adobe blocking acknowledgement',
    appPattern: /adobe|photoshop|illustrator|indesign/i,
    match: /\b(alert|warning|problem|missing|modified|mismatch|unavailable|cannot|could not|error)\b/i,
    preferredButtons: [/^ok$/i, /^continue$/i, /^skip$/i, /^open$/i, /^done$/i, /^close$/i],
  },
];

function flattenA11yNodes(node: DesktopA11yNodeLike | null | undefined, out: DesktopA11yNodeLike[] = []): DesktopA11yNodeLike[] {
  if (!node) return out;
  out.push(node);
  for (const child of node.children || []) flattenA11yNodes(child, out);
  return out;
}

function normalizeA11yLabel(value: string | undefined): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeA11yRole(value: string | undefined): string {
  return String(value || '')
    .replace(/^AX/i, '')
    .trim()
    .toLowerCase();
}

function roleIs(node: DesktopA11yNodeLike, ...roles: string[]): boolean {
  const role = normalizeA11yRole(node.role);
  return roles.some((candidate) => role === candidate.toLowerCase());
}

function a11yNodeText(node: DesktopA11yNodeLike): string {
  return normalizeA11yLabel(`${node.role || ''} ${node.label || ''} ${node.value || ''}`);
}

function treeVisibleText(root: DesktopA11yNodeLike): string {
  return flattenA11yNodes(root)
    .slice(0, 300)
    .map(a11yNodeText)
    .filter(Boolean)
    .join(' ');
}

function isLikelyBlockingModalTree(root: DesktopA11yNodeLike): boolean {
  const nodes = flattenA11yNodes(root).slice(0, 220);
  const hasModalRole = nodes.some((node) => roleIs(node, 'dialog', 'sheet', 'popover'));
  const hasWindowWithDialogButtons = nodes.some((node) => roleIs(node, 'window')) &&
    nodes.filter((node) => roleIs(node, 'button') && normalizeA11yLabel(node.label || node.value)).length >= 1;
  return hasModalRole || hasWindowWithDialogButtons;
}

function buttonLabel(node: DesktopA11yNodeLike): string {
  return normalizeA11yLabel(node.label || node.value || '');
}

function scoreModalButton(node: DesktopA11yNodeLike, policy: BlockingAppModalPolicy): number {
  const label = buttonLabel(node);
  if (!label || !node.id) return 0;
  if (!roleIs(node, 'button')) return 0;
  const index = policy.preferredButtons.findIndex((pattern) => pattern.test(label));
  if (index === -1) return 0;
  return 200 - index * 10 + (node.bbox ? 5 : 0);
}

function findBlockingModalButton(root: DesktopA11yNodeLike, policy: BlockingAppModalPolicy): DesktopA11yNodeLike | null {
  const buttons = flattenA11yNodes(root).filter((node) => node.id && roleIs(node, 'button'));
  let best: { node: DesktopA11yNodeLike; score: number } | null = null;
  for (const node of buttons) {
    const score = scoreModalButton(node, policy);
    if (score <= 0) continue;
    if (!best || score > best.score) best = { node, score };
  }
  return best?.node || null;
}

export function detectBlockingAppModalPlan(root: DesktopA11yNodeLike | null | undefined, appQuery?: string): BlockingAppModalPlan | null {
  if (!root || !isLikelyBlockingModalTree(root)) return null;
  const app = normalizeA11yLabel(appQuery || '');
  const summary = treeVisibleText(root);
  for (const policy of BLOCKING_APP_MODAL_POLICIES) {
    if (policy.appPattern && !policy.appPattern.test(`${app} ${summary}`)) continue;
    if (!policy.match.test(summary)) continue;
    const button = findBlockingModalButton(root, policy);
    if (!button?.id) continue;
    return {
      policyId: policy.id,
      policyLabel: policy.label,
      app: app || null,
      buttonLabel: buttonLabel(button),
      buttonPath: button.id,
      summary: summary.slice(0, 600),
    };
  }
  return null;
}
