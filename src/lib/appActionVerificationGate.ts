/**
 * appActionVerificationGate — enforces the observe→act→VERIFY cadence on
 * multi-step app/desktop/browser automation by attaching a short reminder to
 * the tool_result of every state-mutating action in the tool loop.
 *
 * Why this exists (the gap it closes):
 *   `computerAppGrounding` already *advises* "re-observe after every mutation"
 *   in the system prompt, but in a long tool sequence the model routinely skips
 *   re-observation and assumes a click/type succeeded — the #1 cause of
 *   multi-step app-task failures. Prompt guidance is skippable; a reminder
 *   appended to the tool_result the model is *already reading* is not. This
 *   turns the cadence from advice into an in-loop nudge:
 *     - after a successful mutation → re-observe + confirm the expected change
 *       before the next action; stop + report proof when the completion signal
 *       is observed (do not assume success).
 *     - after a failed mutation → re-observe, then climb the surface ladder
 *       (semantic control → menu → keyboard shortcut → one bounded coordinate
 *       step); never repeat the same failed action; after two failed
 *       observations, stop/report or request a capability buildout.
 *
 * Pure + side-effect free so it is unit/smoke testable. The tool loop calls
 * `appendAppActionVerificationGate(content, toolName, status)` when wrapping a
 * tool_result; read-only/observation tools and non-app tools pass through
 * unchanged.
 */

// State-mutating app/desktop/browser actions (matched on the tool name's verb,
// e.g. "desktop.click_element", "browser.fill_field"). Navigation/launch/focus
// count: they change which surface is live, so the next step must observe the
// new state. Read/observation tools (read_a11y_tree, screenshot, dom_snapshot,
// window_state, list_running_apps, file_stat, file_search, verification_state)
// are intentionally absent — they ARE the observation, not a mutation.
const MUTATING_APP_ACTION_RE = /\b(?:click_element|set_element_value|menu_click|type_text|paste_text|press_keys|click_at|mouse_click|mouse_down|mouse_up|mouse_drag|mouse_scroll|launch_app|focus_app|open_url|open_path|click_role|fill_field|fill_credential_field|press_key)\b/i;

const OBSERVE_HINT = 'desktop.read_a11y_tree / desktop.screenshot (or browser.dom_snapshot / browser.screenshot)';

export function isAppMutatingTool(toolName: string | null | undefined): boolean {
  const name = String(toolName || '');
  // Gate only app-surface tools (desktop.* / browser.*), not same-named verbs
  // elsewhere, AND only state-mutating actions (not read/observation tools).
  const isAppSurface = /(?:^|[._])(?:desktop|browser)(?:[._]|$)/i.test(name);
  return isAppSurface && MUTATING_APP_ACTION_RE.test(name);
}

function isErrorStatus(status: string | null | undefined): boolean {
  return /\b(error|fail|failed|failure)\b/i.test(String(status || ''));
}

function isInertStatus(status: string | null | undefined): boolean {
  // A blocked/skipped action didn't mutate anything; the result text already
  // explains the block, so no verify/retry nudge is appropriate.
  return /\b(blocked|skipped|pending)\b/i.test(String(status || ''));
}

/**
 * The reminder text for a mutating app action, or null when no gate applies
 * (non-app/observation tool, or an inert blocked/skipped status).
 */
export function appActionVerificationReminder(
  toolName: string | null | undefined,
  status?: string | null,
): string | null {
  if (!isAppMutatingTool(toolName)) return null;
  if (isInertStatus(status)) return null;
  if (isErrorStatus(status)) {
    return `[observe-act-verify] This app action did not succeed. Before any retry: re-observe fresh state (${OBSERVE_HINT}), then climb the surface ladder — semantic control → menu → keyboard shortcut → one bounded coordinate step. Do not repeat the same failed action or assume it worked. After two failed fresh observations of the same target, stop and report the blocker or request a connected-agent capability buildout.`;
  }
  return `[observe-act-verify] App state was just mutated. Before the next action: re-observe (${OBSERVE_HINT}) and confirm the expected change actually happened — do not assume success. When the task's completion signal is observed, stop and report proof (after-state + file_stat when files changed) instead of taking more steps.`;
}

/**
 * Append the verification gate to a tool_result `content` string for a
 * mutating app action. Returns `content` unchanged when no gate applies.
 */
export function appendAppActionVerificationGate(
  content: string,
  toolName: string | null | undefined,
  status?: string | null,
): string {
  const reminder = appActionVerificationReminder(toolName, status);
  if (!reminder) return content;
  const base = String(content || '');
  return base ? `${base}\n\n${reminder}` : reminder;
}
