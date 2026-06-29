/**
 * chatConversationalCutoverParity — pure source extractors that lock the
 * conversational-intent cutover (C1) in lockstep across the three surfaces that
 * must agree: the planner union (`chatAutomationPlanner.ts`), the executor case
 * labels (`conversationalRouter.ts`), and the ChatTab dispatch allowlist
 * (`ChatTab.tsx`). A smoke asserts set-equality so a future un-darkening (e.g.
 * wiring a new intent) cannot land on one surface and silently drift on
 * another.
 *
 * Dependency-light: extractors take file CONTENT (the smoke does the
 * `readFileSync`); no runtime imports.
 */

/**
 * Canonical unified conversational-intent type set: the 9 intents that are
 * fully wired across planner → executor → ChatTab today.
 */
export const UNIFIED_CONVERSATIONAL_INTENT_TYPES: readonly string[] = [
  'wordpress_publish',
  'wordpress_list',
  'wordpress_schedule',
  'create_task',
  'office_agent_task',
  'remember',
  'forget',
  'show_memories',
  'generate_image',
];

/**
 * Planner union members that are intentionally NOT wired into the executor —
 * documented dead branches (C1-G2). `build_webpage` moved to run_build_discovery
 * and has no executor case.
 */
export const KNOWN_DEAD_PLANNER_INTENTS: readonly string[] = ['build_webpage'];

function sortUnique(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}

/**
 * Extract the full raw `PlannerConversationalIntent` union member set from
 * `chatAutomationPlanner.ts` — every `{ type: '<name>' ... }` literal, NOT
 * filtered. Throws if it extracts zero literals (refactor guard).
 */
export function extractPlannerUnionRaw(src: string): string[] {
  const anchor = src.indexOf('export type PlannerConversationalIntent =');
  if (anchor < 0) throw new Error('extractPlannerUnionRaw: union declaration not found');
  // Stop at the next top-level `export ` after the anchor, or the terminating
  // `;` of the union — whichever comes first.
  const after = src.slice(anchor + 'export type PlannerConversationalIntent ='.length);
  const nextExport = after.indexOf('\nexport ');
  const block = nextExport >= 0 ? after.slice(0, nextExport) : after;
  const names = new Set<string>();
  const re = /\{\s*type:\s*'([a-z_]+)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) names.add(m[1]);
  if (names.size === 0) throw new Error('extractPlannerUnionRaw: zero union members extracted');
  return sortUnique(Array.from(names));
}

/**
 * Planner union minus `none` and the known dead branches — the set of intents
 * the planner expects to be actionable downstream.
 */
export function extractPlannerActionable(src: string): string[] {
  const raw = extractPlannerUnionRaw(src);
  const excluded = new Set<string>(['none', ...KNOWN_DEAD_PLANNER_INTENTS]);
  return sortUnique(raw.filter((name) => !excluded.has(name)));
}

/**
 * Extract the `case '<name>'` labels inside `executeDetectedConversationalIntent`
 * in `conversationalRouter.ts`. Throws if it extracts zero labels.
 */
export function extractExecutorCaseLabels(src: string): string[] {
  const fnIdx = src.indexOf('export async function executeDetectedConversationalIntent');
  if (fnIdx < 0) throw new Error('extractExecutorCaseLabels: executor fn not found');
  const switchIdx = src.indexOf('switch (intent.type) {', fnIdx);
  if (switchIdx < 0) throw new Error('extractExecutorCaseLabels: switch not found');
  const after = src.slice(switchIdx);
  // The executor's switch has no `default:` for the unified intents; bound to
  // the next top-level `export ` (the deprecated wrapper) instead.
  const nextExport = after.indexOf('\nexport ');
  const body = nextExport >= 0 ? after.slice(0, nextExport) : after;
  const names = new Set<string>();
  const re = /case\s+'([a-z_]+)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) names.add(m[1]);
  if (names.size === 0) throw new Error('extractExecutorCaseLabels: zero case labels extracted');
  return sortUnique(Array.from(names));
}

/**
 * Extract the `intentType === '<name>'` literals from the
 * `isUnifiedConversationalIntentType` allowlist in `ChatTab.tsx`. Throws if it
 * extracts zero literals.
 */
export function extractChatTabAllowlist(src: string): string[] {
  const idx = src.indexOf('isUnifiedConversationalIntentType');
  if (idx < 0) throw new Error('extractChatTabAllowlist: allowlist fn not found');
  // The arrow body is a chain of `intentType === '...'` clauses; scan a bounded
  // window after the first occurrence (the definition), stopping at the closing
  // `;` of the arrow.
  const after = src.slice(idx);
  const semicolon = after.indexOf(';');
  const body = semicolon >= 0 ? after.slice(0, semicolon) : after.slice(0, 600);
  const names = new Set<string>();
  const re = /intentType\s*===\s*'([a-z_]+)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) names.add(m[1]);
  if (names.size === 0) throw new Error('extractChatTabAllowlist: zero allowlist literals extracted');
  return sortUnique(Array.from(names));
}
