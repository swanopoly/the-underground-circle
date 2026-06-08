/**
 * appSurfaceLadder — the desktop UI-action "surface ladder": when a given
 * interaction tool fails, which tool(s) to try next, in order, from most
 * semantic/robust to last-resort coordinates.
 *
 * Used to make failure nudges concrete: instead of "escalate the surface
 * ladder", the stuck-loop guard can say "try `desktop.menu_click`, then
 * `desktop.press_keys`, then `desktop.click_at`". This is pure GUIDANCE — it
 * never auto-invokes anything (the model still chooses + any approval gate still
 * fires), so naming the next tool can't bypass intent or consent. It's also the
 * reusable core for a future deterministic next-surface executor.
 *
 * Tool names verified against the desktop catalog (openswanTools). Pure +
 * side-effect free → smoke testable.
 */

export interface SurfaceLadderStep {
  /** The tool to try next. */
  tool: string;
  /** When/why to use it — embedded in the hint so the model picks correctly. */
  why: string;
}

// Ordered from most-semantic/robust to last-resort coordinate. Keyed by the
// tool that just failed. Only UI-interaction tools have a ladder; reads, file
// ops, and app-specific scripted tools return null (no generic next surface).
const LADDER: Record<string, SurfaceLadderStep[]> = {
  'desktop.click_element': [
    { tool: 'desktop.menu_click', why: "if it's a menu command" },
    { tool: 'desktop.press_keys', why: 'if it has a keyboard shortcut' },
    { tool: 'desktop.click_at', why: 'last resort — one bounded coordinate from a fresh screenshot' },
  ],
  'desktop.set_element_value': [
    { tool: 'desktop.type_text', why: 'after focusing the field' },
    { tool: 'desktop.click_at', why: 'last resort — click the field by coordinate, then type' },
  ],
  'desktop.menu_click': [
    { tool: 'desktop.press_keys', why: "the menu item's keyboard shortcut" },
    { tool: 'desktop.click_at', why: 'last resort — open the menu by coordinate' },
  ],
  'desktop.type_text': [
    { tool: 'desktop.set_element_value', why: 'set the field value semantically via the a11y tree' },
    { tool: 'desktop.click_at', why: 'last resort — click the field by coordinate first' },
  ],
  'desktop.click_at': [
    { tool: 'desktop.read_a11y_tree', why: 're-observe, then prefer a semantic desktop.click_element over raw coordinates' },
  ],

  // Browser is a thinner surface set: there is no coordinate click (click_role is
  // the only click), so recovery centers on re-reading the DOM and correcting the
  // locator, with keyboard navigation as the cross-cutting fallback.
  'browser.click_role': [
    { tool: 'browser.press_key', why: 'keyboard-navigate — Tab to the control, then Enter/Space' },
    { tool: 'browser.dom_snapshot', why: 're-read the DOM and retry click_role with the corrected role/name' },
  ],
  'browser.fill_field': [
    { tool: 'browser.click_role', why: 'focus the field by role/label first' },
    { tool: 'browser.press_key', why: 'then type into the focused field via keyboard' },
  ],
  'browser.select_option': [
    { tool: 'browser.click_role', why: 'open the control by role first' },
    { tool: 'browser.dom_snapshot', why: 're-read the option values and retry with an exact match' },
  ],
};

/** The ordered next surfaces to try for a failed action tool, or null. */
export function nextSurfaceForFailedAction(toolName: string): SurfaceLadderStep[] | null {
  return LADDER[toolName] ?? null;
}

/**
 * The read tool that refreshes ground truth for a failed UI action, per surface:
 * the a11y tree for desktop, the DOM snapshot for browser. Null when the tool
 * isn't a known UI action (so there's no ladder / no re-observe to do).
 */
export function observationToolForFailedAction(toolName: string): string | null {
  if (!nextSurfaceForFailedAction(toolName)) return null;
  return String(toolName || '').startsWith('browser.') ? 'browser.dom_snapshot' : 'desktop.read_a11y_tree';
}

/**
 * An inline phrase naming the next surfaces for a failed tool — e.g.
 * "try `desktop.menu_click` (if it's a menu command), then `desktop.press_keys`
 * (if it has a keyboard shortcut), then `desktop.click_at` (last resort …)".
 * Returns null when the tool has no ladder (so callers fall back to generic
 * guidance).
 */
export function formatSurfaceLadderHint(toolName: string): string | null {
  const steps = nextSurfaceForFailedAction(toolName);
  if (!steps || steps.length === 0) return null;
  const parts = steps.map((s, i) => `${i === 0 ? 'try' : 'then'} \`${s.tool}\` (${s.why})`);
  return parts.join(', ');
}
