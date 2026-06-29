import type { ComputerTaskPlanPreview } from './computerTaskPlanner';
import type { ComputerCapabilityAudit, ComputerCapabilityId } from './computerCapabilityRegistry';

export type ComputerTaskComplexityLevel = 'simple' | 'moderate' | 'complex';
export type ComputerTaskCheckpointSurface =
  | 'browser'
  | 'desktop'
  | 'local_files'
  | 'app'
  | 'approval'
  | 'verification'
  | 'recovery';

export interface ComputerTaskCheckpoint {
  id: string;
  label: string;
  surface: ComputerTaskCheckpointSurface;
  objective: string;
  actions: string[];
  verification: string[];
  stopConditions: string[];
  requiresApproval: boolean;
}

export type ComputerTaskStageSurface = 'browser' | 'local_files' | 'desktop_app';

/**
 * One ordered stage of a multi-surface task (D4). Stages are the
 * decomposition layer ABOVE checkpoints: "download from the portal →
 * rename the files → import into the app" becomes three stages, each
 * with its own done-when criterion and an explicit artifact handoff, so
 * the loop completes and verifies one surface before touching the next —
 * and a failure names the stage recovery should resume from, instead of
 * restarting the whole task.
 */
export interface ComputerTaskStage {
  id: string;
  ordinal: number;
  surface: ComputerTaskStageSurface;
  goal: string;
  doneWhen: string;
  handoff: string;
}

/**
 * Wave-2 task→best-app choice threaded into the dispatch contract. Structural
 * mirror of the route's `appResolution` summary (chatComputerRequestRouter)
 * so callers pass it straight through — declared locally because this module
 * sits BELOW the router in the import graph (the router imports the E4 rules
 * from here) and must stay cycle-free and persisted-compatible.
 */
export interface ComputerTaskAppChoiceResolutionOption {
  appId?: string;
  displayName: string;
  surface: 'desktop' | 'browser';
  openVia: 'desktop_launch' | 'url_scheme' | 'browser_url';
  openTarget: string;
  reason: string;
  /** AR: 'installed' | 'maybe' | 'web' — drives the fail-fast open contract. */
  availability?: 'installed' | 'maybe' | 'web';
}

export interface ComputerTaskAppChoiceResolution {
  category?: string;
  best: ComputerTaskAppChoiceResolutionOption;
  /** ≤3 entries, each "displayName — reason". */
  alternativesSummary?: string[];
  explicitAppNamed?: boolean;
  /** Human-readable open-first steps from the route (≤3). */
  openStepLines?: string[];
  /** AR: the user-named app (when explicitAppNamed) so the contract can name it. */
  namedAppIntent?: string | null;
  /** AR: the structured next-best CONFIDENTLY-launchable fallback (not just alternatives[0]). */
  recoveryFallback?: ComputerTaskAppChoiceResolutionOption | null;
}

export interface ComputerTaskComplexityPlan {
  level: ComputerTaskComplexityLevel;
  score: number;
  reasons: string[];
  checkpoints: ComputerTaskCheckpoint[];
  /** Ordered multi-surface stages (D4). Empty when the task is single-surface. */
  stages: ComputerTaskStage[];
  /** Wave-2: app choice for the dispatch contract. Optional for persisted plans. */
  appResolution?: ComputerTaskAppChoiceResolution | null;
  visibleNextSteps: string[];
}

function includesAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

function matchesAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

function compact(values: string[], max = 6): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).slice(0, max);
}

function hasBrowserSurface(task: string, preview: ComputerTaskPlanPreview): boolean {
  return preview.kind === 'browser_task'
    || preview.kind === 'hybrid_task'
    || includesAny(task, ['website', 'browser', 'webpage', 'site', 'url', 'tab', 'shopify', 'wordpress', 'gmail', 'admin']);
}

function hasDesktopSurface(task: string, preview: ComputerTaskPlanPreview): boolean {
  return preview.kind === 'app_task'
    || preview.kind === 'hybrid_task'
    || includesAny(task, [
      'desktop', 'app', 'application', 'window', 'photoshop', 'indesign', 'illustrator',
      'autocad', 'fusion 360', 'solidworks', 'matlab', 'simulink', 'revit', 'sketchup', 'blender', 'figma',
    ]);
}

function hasFileSurface(task: string, preview: ComputerTaskPlanPreview): boolean {
  return preview.kind === 'file_task'
    || preview.kind === 'hybrid_task'
    || includesAny(task, ['file', 'folder', 'downloads', 'desktop', 'upload', 'download', 'export', 'save', 'csv', 'pdf', 'dwg', 'dxf', 'psd', 'indd']);
}

function hasExternalSideEffect(task: string): boolean {
  return matchesAny(task, [
    /\b(submit|send|publish|post|checkout|pay|book|buy|order|invite|delete|remove|overwrite|deploy|rollback|grant|provision)\b/i,
    /\b(save|export|upload|import)\b[\s\S]{0,80}\b(site|website|wordpress|shopify|admin|crm|customer|production|live)\b/i,
  ]);
}

function hasLongSequencing(task: string): boolean {
  return matchesAny(task, [
    /\b(then|after|next|finally|before|once|and then)\b/i,
    /\b(open|launch|go to|log in|download|upload|export|save|edit|update|create|fill|submit)\b[\s\S]{0,120}\b(open|launch|go to|log in|download|upload|export|save|edit|update|create|fill|submit)\b/i,
  ]);
}

function complexityScore(task: string, preview: ComputerTaskPlanPreview): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  const surfaces = [
    hasBrowserSurface(task, preview) ? 'browser' : '',
    hasDesktopSurface(task, preview) ? 'desktop' : '',
    hasFileSurface(task, preview) ? 'files' : '',
  ].filter(Boolean);
  if (preview.kind === 'hybrid_task' || surfaces.length > 1) {
    score += 3;
    reasons.push('cross-surface workflow');
  }
  if (hasLongSequencing(task)) {
    score += 2;
    reasons.push('multi-step sequence');
  }
  if (hasExternalSideEffect(task)) {
    score += 2;
    reasons.push('side-effect or final approval risk');
  }
  if (preview.verificationGate) {
    score += 3;
    reasons.push('human verification gate');
  }
  if (matchesAny(task, [/\b(cad|autocad|fusion\s*360|solidworks|matlab|simulink|simscape|revit|engineering|dimension|units?|scale|drawing|model|simulation|toolbox|photoshop|indesign|layers?|canvas|crop|retouch)\b/i])) {
    score += 2;
    reasons.push('visual or precision desktop work');
  }
  if (matchesAny(task, [/\b(log ?in|sign ?in|credential|password|vault|admin|private|client|production)\b/i])) {
    score += 2;
    reasons.push('credentialed or private surface');
  }
  if (matchesAny(task, [/\b(compare|research|collect|extract|summarize|report|dashboard|regression|screenshots?|proof)\b/i])) {
    score += 1;
    reasons.push('requires evidence/proof summary');
  }
  return { score, reasons: compact(reasons, 8) };
}

function levelForScore(score: number): ComputerTaskComplexityLevel {
  if (score >= 5) return 'complex';
  if (score >= 2) return 'moderate';
  return 'simple';
}

function baseCheckpoints(args: {
  task: string;
  preview: ComputerTaskPlanPreview;
  level: ComputerTaskComplexityLevel;
  reasons: string[];
}): ComputerTaskCheckpoint[] {
  const task = args.task.toLowerCase();
  const checkpoints: ComputerTaskCheckpoint[] = [];
  const browser = hasBrowserSurface(task, args.preview);
  const desktop = hasDesktopSurface(task, args.preview);
  const files = hasFileSurface(task, args.preview);
  const sideEffect = hasExternalSideEffect(task);

  checkpoints.push({
    id: 'scope-readiness',
    label: 'Confirm scope and access',
    surface: 'verification',
    objective: 'Identify every surface, target account/app/file, and permission before execution.',
    actions: [
      'Resolve browser, desktop, file, bridge, vault, and approval requirements.',
      'Use the narrowest available surface for each part of the task.',
    ],
    verification: ['Access plan and missing grants are explicit.'],
    stopConditions: ['Required app/site/file/credential/permission is missing.'],
    requiresApproval: false,
  });

  if (files) {
    checkpoints.push({
      id: 'resolve-files',
      label: 'Resolve local files',
      surface: 'local_files',
      objective: 'Find exact source/output paths before browser or desktop actions use them.',
      actions: ['Search/stat/read only within granted roots.', 'Confirm filenames, sizes, hashes, or staged package manifests when available.'],
      verification: ['Exact path and file identity are known before upload, edit, save, or export.'],
      stopConditions: ['File is missing, ambiguous, outside grant scope, or overwrite risk is unclear.'],
      requiresApproval: /\b(write|save|export|overwrite|delete|remove|rename|move|copy|upload|import)\b/i.test(task),
    });
  }

  if (browser) {
    checkpoints.push({
      id: 'observe-browser',
      label: 'Observe browser state',
      surface: 'browser',
      objective: 'Use DOM/role/session state before clicks, fills, downloads, uploads, or submits.',
      actions: ['Open or focus the requested page/session.', 'Capture DOM/role state and login/verification state.'],
      verification: ['URL/origin and visible target state match the request.'],
      stopConditions: ['Wrong origin, human verification, MFA, login/vault blocker, or automation block.'],
      requiresApproval: false,
    });
  }

  if (desktop) {
    checkpoints.push({
      id: 'observe-desktop',
      label: 'Observe desktop/app state',
      surface: 'desktop',
      objective: 'Confirm target app/window/document before any keyboard, mouse, menu, or file mutation.',
      actions: ['Launch/focus app only if needed.', 'Read window state, accessibility tree, and screenshot when visual state matters.'],
      verification: ['Target app, active document/window, and safe control path are confirmed.'],
      stopConditions: ['App unavailable, Accessibility/Screen Recording missing, stale a11y tree, or unclear focus.'],
      requiresApproval: false,
    });
  }

  checkpoints.push({
    id: 'execute-in-small-steps',
    label: args.level === 'complex' ? 'Execute one checkpoint at a time' : 'Execute carefully',
    surface: desktop ? 'desktop' : browser ? 'browser' : files ? 'local_files' : 'app',
    objective: 'Perform reversible actions first and verify after each state change.',
    actions: ['Prefer semantic tools over screenshots or coordinates.', 'Do one mutation at a time and re-observe after it.'],
    verification: ['Post-action DOM/a11y/screenshot/file state proves the intended change.'],
    stopConditions: ['Same action fails twice, target state is uncertain, or a broader grant would be required.'],
    requiresApproval: sideEffect,
  });

  if (sideEffect) {
    checkpoints.push({
      id: 'approval-before-side-effect',
      label: 'Pause before final side effect',
      surface: 'approval',
      objective: 'Stage the final send/publish/upload/save/submit/delete action and ask before committing it.',
      actions: ['Summarize exact pending action, target, data, and expected result.', 'Request approval before the final side effect.'],
      verification: ['User approval is captured for the exact final action.'],
      stopConditions: ['Approval missing, target changed, price/availability/content changed, or destructive scope is unclear.'],
      requiresApproval: true,
    });
  }

  checkpoints.push({
    id: 'final-proof',
    label: 'Verify and summarize proof',
    surface: 'verification',
    objective: 'Return a compact proof summary with paths, URLs, screenshots, extracted data, or blockers.',
    actions: ['Verify final state through the surface used.', 'Report only user-relevant results and blockers.'],
    verification: ['Final output includes proof or an exact actionable blocker.'],
    stopConditions: ['Proof cannot be captured without extra permission or human action.'],
    requiresApproval: false,
  });

  checkpoints.push({
    id: 'bounded-recovery',
    label: 'Recover safely if blocked',
    surface: 'recovery',
    objective: 'If a checkpoint fails, route to the smallest safe recovery instead of looping.',
    actions: ['Classify the blocker.', 'Retry only after re-observation or a connected-agent capability buildout result.'],
    verification: ['Recovery names the failed checkpoint and the next safe action.'],
    stopConditions: ['CAPTCHA/MFA/login/license/permission/private-file blocker requires the user.'],
    requiresApproval: false,
  });

  return checkpoints;
}

// ─── Stage planning (D4) ────────────────────────────────────────────────────

const STAGE_SPLIT_RE = /\b(?:and then|then|after that|after which|next,|finally|once (?:that|it)(?:'s| is)? (?:done|finished|complete))\b|;/gi;

const STAGE_SURFACE_SIGNALS: Record<ComputerTaskStageSurface, RegExp[]> = {
  browser: [
    /\b(browser|website|web ?page|site|url|portal|log ?in|sign ?in|navigate|scrape|checkout|cart|search (?:on|the web)|gmail|shopify|wordpress|linkedin)\b/i,
    /\b[a-z0-9-]+\.(?:com|org|net|io|ai|dev|app)\b/i,
    /\bdownload\b[\s\S]{0,40}\b(?:from|the latest|invoices?|reports?|statements?)\b/i,
  ],
  local_files: [
    /\b(rename|unzip|zip|move (?:them|the files?|it)|copy (?:them|the files?)|organize|sort (?:them|the files?)|downloads? folder|documents? folder|directory|file ?names?)\b/i,
    /\b(save|put|file) (?:them|it|the files?)\b/i,
  ],
  desktop_app: [
    /\b(photoshop|indesign|illustrator|excel|numbers|quickbooks|xero|finder|preview|notion desktop|figma)\b/i,
    /\b(?:import|open|load|attach) (?:them|it|the files?|everything)?[\s\S]{0,30}\b(?:in|into) (?:my |the )?[\w .-]{2,30}(?: app| application)?\b/i,
    /\bdesktop app\b/i,
  ],
};

function classifyStageSurface(segment: string): ComputerTaskStageSurface | null {
  const scores: Array<[ComputerTaskStageSurface, number]> = (
    Object.keys(STAGE_SURFACE_SIGNALS) as ComputerTaskStageSurface[]
  ).map((surface) => [
    surface,
    STAGE_SURFACE_SIGNALS[surface].reduce((n, re) => n + (re.test(segment) ? 1 : 0), 0),
  ]);
  scores.sort((a, b) => b[1] - a[1]);
  return scores[0][1] > 0 ? scores[0][0] : null;
}

const STAGE_DONE_WHEN: Record<ComputerTaskStageSurface, string> = {
  browser: 'The browser outcome for this stage is verified (page state or downloaded artifact confirmed) before leaving the browser.',
  local_files: 'Exact file paths and names exist and match expectations (list/stat proof) before continuing.',
  desktop_app: 'App-native status or inventory confirms the change before continuing.',
};

/**
 * Decompose a multi-surface task into ordered stages. Pure heuristic:
 * split on sequence connectors, classify each segment's surface, merge
 * adjacent same-surface segments. Returns [] unless the task genuinely
 * crosses surfaces (≥2 stages on ≥2 distinct surfaces) — single-surface
 * tasks don't pay the staging overhead.
 */
export function planComputerTaskStages(task: string): ComputerTaskStage[] {
  const text = String(task || '').trim();
  if (!text) return [];
  const segments = text.split(STAGE_SPLIT_RE).map((s) => String(s || '').trim()).filter((s) => s.length >= 8);
  if (segments.length < 2) return [];

  // Classify; unclassified segments fold into the previous stage's goal
  // (they're usually qualifiers like "by date" or "before 5pm").
  const staged: Array<{ surface: ComputerTaskStageSurface; goal: string }> = [];
  for (const segment of segments) {
    const surface = classifyStageSurface(segment);
    const prev = staged[staged.length - 1];
    if (!surface) {
      if (prev) prev.goal = `${prev.goal}; ${segment}`;
      continue;
    }
    if (prev && prev.surface === surface) {
      prev.goal = `${prev.goal}; ${segment}`;
    } else {
      staged.push({ surface, goal: segment });
    }
  }

  const distinctSurfaces = new Set(staged.map((s) => s.surface));
  if (staged.length < 2 || distinctSurfaces.size < 2) return [];

  return staged.slice(0, 4).map((stage, index) => ({
    id: `stage-${index + 1}-${stage.surface}`,
    ordinal: index + 1,
    surface: stage.surface,
    goal: stage.goal.slice(0, 240),
    doneWhen: STAGE_DONE_WHEN[stage.surface],
    handoff: index < staged.length - 1
      ? 'State the exact artifacts produced (paths, filenames, URLs, ids) before starting the next stage — the next stage may only rely on what is stated here.'
      : 'Include the artifacts from every stage in the final proof summary.',
  }));
}

// ─── Staged pre-flight validation ───────────────────────────────────────────

export interface ComputerTaskStagePreflightBlocker {
  stageId: string;
  ordinal: number;
  surface: ComputerTaskStageSurface;
  missing: ComputerCapabilityId[];
  message: string;
}

const STAGE_SURFACE_LABEL: Record<ComputerTaskStageSurface, string> = {
  browser: 'browser',
  local_files: 'local files',
  desktop_app: 'desktop app',
};

/**
 * Validate every stage's surface against the live capability audit BEFORE
 * the task starts (D4 pre-flight). A 3-stage browser→files→app task whose
 * desktop bridge is offline should fail at launch with "stage 3 needs the
 * desktop app surface" — not at step 9 after the browser and file work
 * already ran. 'partial' capabilities don't block (the runtime can often
 * degrade); only 'missing' does. desktop_app accepts EITHER desktop
 * control or app tools.
 */
export function validateComputerTaskStageSurfaces(
  stages: ComputerTaskStage[],
  audit: ComputerCapabilityAudit | null,
): ComputerTaskStagePreflightBlocker[] {
  if (!stages.length || !audit) return [];
  const statusById = new Map(audit.findings.map((finding) => [finding.id, finding.status]));
  const isMissing = (id: ComputerCapabilityId) => statusById.get(id) === 'missing';

  const blockers: ComputerTaskStagePreflightBlocker[] = [];
  for (const stage of stages) {
    let missing: ComputerCapabilityId[] = [];
    if (stage.surface === 'browser') {
      if (isMissing('browser_automation')) missing = ['browser_automation'];
    } else if (stage.surface === 'local_files') {
      missing = (['file_search', 'file_read'] as ComputerCapabilityId[]).filter(isMissing);
    } else if (stage.surface === 'desktop_app') {
      if (isMissing('desktop_control') && isMissing('app_tools')) {
        missing = ['desktop_control', 'app_tools'];
      }
    }
    if (missing.length > 0) {
      blockers.push({
        stageId: stage.id,
        ordinal: stage.ordinal,
        surface: stage.surface,
        missing,
        message: `Stage ${stage.ordinal} [${STAGE_SURFACE_LABEL[stage.surface]}] cannot run: ${missing.join(' + ')} unavailable. Fix this before starting — earlier stages would otherwise do work the task cannot finish.`,
      });
    }
  }
  return blockers;
}

export function buildComputerTaskComplexityPlan(args: {
  task: string;
  preview: ComputerTaskPlanPreview;
  /**
   * Wave-2: the route's task→best-app resolution, when the caller has one.
   * The plan builder otherwise only sees task text, so this rides in as an
   * optional arg and surfaces in the dispatch block's app-choice contract.
   */
  appResolution?: ComputerTaskAppChoiceResolution | null;
}): ComputerTaskComplexityPlan {
  const task = String(args.task || '').trim();
  const { score, reasons } = complexityScore(task, args.preview);
  const stages = planComputerTaskStages(task);
  // A genuinely staged task is complex by construction — each stage is its
  // own observe/act/verify cycle on a different surface.
  const stagedScore = stages.length >= 2 ? Math.max(score, 5) : score;
  const level = levelForScore(stagedScore);
  const checkpoints = baseCheckpoints({
    task,
    preview: args.preview,
    level,
    reasons,
  });
  return {
    level,
    score: stagedScore,
    reasons: stages.length >= 2 ? compact([...reasons, `staged ${stages.length}-surface workflow`], 8) : reasons,
    checkpoints: level === 'simple'
      ? checkpoints.filter((checkpoint) => ['scope-readiness', 'execute-in-small-steps', 'final-proof'].includes(checkpoint.id))
      : checkpoints,
    stages,
    appResolution: args.appResolution ?? null,
    visibleNextSteps: stages.length >= 2
      ? stages.map((stage) => `Stage ${stage.ordinal}: ${stage.goal.slice(0, 60)}`).slice(0, 5)
      : checkpoints
        .filter((checkpoint) => checkpoint.id !== 'bounded-recovery')
        .slice(0, level === 'complex' ? 5 : 3)
        .map((checkpoint) => checkpoint.label),
  };
}

// ─── Data transfer & precision rules (E4) ───────────────────────────────────

/**
 * Non-visual transfer rules (E4, research finding #6): Operator-class agents
 * corrupt complex strings (API keys, addresses, amounts) when they read them
 * visually from screenshots, and visual text-editing errors compound. These
 * rules are injected into desktop/app/hybrid execution prompts — browser-only
 * cloud tasks already get equivalent rules from the edge-loop prompt. Pure
 * string constants so persisted prompt blocks stay parse-compatible.
 */
export const DATA_TRANSFER_PRECISION_RULES: readonly string[] = [
  'Never read precise strings (keys, codes, addresses, amounts, file paths) from a screenshot — copy them via clipboard or read the field value from the a11y tree/DOM.',
  'Enter precise strings with set_element_value / fill_field / paste — never character-type them from visual memory.',
  'Prefer typed editing surfaces (adapter, script, API) over GUI text editing when both exist.',
  'Prefer keyboard shortcuts over coordinate clicks when a shortcut is known.',
  'After entering a precise value, verify it by reading the field value back (a11y tree/DOM), not from a screenshot.',
];

/** Compact prompt block for the E4 rules — shared by route and dispatch prompts. */
export function formatDataTransferPrecisionRulesBlock(): string {
  return [
    'Data transfer & precision rules (desktop/app surfaces):',
    ...DATA_TRANSFER_PRECISION_RULES.map((rule) => `- ${rule}`),
  ].join('\n');
}

/**
 * True when the plan touches a desktop/app surface (checkpoints or stages) —
 * the gate for injecting the E4 rules into the dispatch block. Browser-only
 * plans return false: the cloud edge loop carries its own transfer rules.
 */
export function complexityPlanTouchesDesktopSurface(plan: ComputerTaskComplexityPlan | null | undefined): boolean {
  if (!plan) return false;
  return plan.checkpoints.some((checkpoint) => checkpoint.surface === 'desktop' || checkpoint.surface === 'app')
    || plan.stages.some((stage) => stage.surface === 'desktop_app');
}

/**
 * Wave-2 app-choice contract (~6 lines): open the chosen app FIRST, verify
 * it is frontmost before acting, and fall back ONCE to the named best
 * alternative before asking the user.
 */
/** "Photopea (full web app)" — how the contract names a structured fallback. */
function describeFallbackOption(option: ComputerTaskAppChoiceResolutionOption): string {
  const how = option.availability === 'web' || option.surface === 'browser'
    ? 'open it in the browser'
    : 'launch it on the desktop';
  return `${option.displayName} (${how} — ${shortReason(option.reason)})`;
}

function shortReason(reason: string): string {
  return String(reason || '').split(';')[0].trim().slice(0, 80);
}

function formatAppChoiceContractLines(resolution: ComputerTaskAppChoiceResolution): string[] {
  const name = resolution.best.displayName;
  const openLines = (resolution.openStepLines && resolution.openStepLines.length > 0
    ? resolution.openStepLines
    : [`Open ${name} via ${resolution.best.openVia.replace(/_/g, ' ')} (${resolution.best.openTarget}).`]
  ).slice(0, 2);
  // AR: prefer the structured, confidently-launchable fallback over a blind
  // alternativesSummary[0] (which can itself be an unconfirmed desktop guess).
  const structuredFallback = resolution.recoveryFallback
    ? describeFallbackOption(resolution.recoveryFallback)
    : null;
  const fallback = structuredFallback
    ?? ((resolution.alternativesSummary || []).map((alt) => String(alt || '').trim()).filter(Boolean)[0] || null);
  // AR: a 'maybe' (bridge online, install unconfirmed) or explicitly-named app
  // must be PROVEN to launch before task work — otherwise an "app not installed"
  // failure surfaces deep in the task instead of at step zero.
  const needsAvailabilityProof = resolution.best.availability === 'maybe'
    || (resolution.explicitAppNamed === true && resolution.best.availability !== 'installed');
  const lines = [
    '### App choice contract',
    `- Chosen app: ${name} (${resolution.best.reason}).`,
    ...openLines.map((line) => `- Open first: ${line}`),
  ];
  if (needsAvailabilityProof) {
    lines.push(
      `- Confirm ${name} actually launched and is frontmost BEFORE any task work — its install is unconfirmed${resolution.namedAppIntent ? ` (you asked for ${resolution.namedAppIntent})` : ''}. A launch/not-installed failure is the fallback trigger, not an error to retry blind.`,
    );
  } else {
    lines.push(`- Verify ${name} is frontmost and ready BEFORE any task action inside it.`);
  }
  lines.push(
    fallback
      ? `- If ${name} fails to open or be ready within the wait, fall back ONCE to ${fallback}; if that also fails, stop and ask the user.`
      : `- If ${name} fails to open or be ready within the wait, stop and ask the user — there is no ranked alternative.`,
  );
  return lines;
}

export function formatComputerTaskComplexityDispatchBlock(plan: ComputerTaskComplexityPlan | null | undefined): string | null {
  if (!plan) return null;
  const appChoiceLines = plan.appResolution ? formatAppChoiceContractLines(plan.appResolution) : [];
  // A simple task with an app choice still gets the open-first contract —
  // opening the right app is step zero regardless of complexity.
  if (plan.level === 'simple') return appChoiceLines.length > 0 ? appChoiceLines.join('\n') : null;
  const lines = [
    '## Complex Computer Task Checkpoints',
    `Complexity: ${plan.level} (score ${plan.score})${plan.reasons.length ? ` — ${plan.reasons.join(', ')}` : ''}`,
    'Run checkpoints in order. Do not skip observation, approval, verification, or recovery checkpoints.',
    ...appChoiceLines,
  ];
  if (plan.stages.length >= 2) {
    lines.push('### Staged execution contract (multi-surface task)');
    for (const stage of plan.stages) {
      lines.push(`- Stage ${stage.ordinal} [${stage.surface.replace(/_/g, ' ')}]: ${stage.goal}`);
      lines.push(`  Done when: ${stage.doneWhen}`);
      lines.push(`  Handoff: ${stage.handoff}`);
    }
    lines.push('Stage rules: complete and VERIFY each stage before starting the next; never interleave surfaces across stages; announce stage transitions in your progress; if a stage fails, name the failed stage and report the artifacts completed stages already produced — recovery resumes from the failed stage, not from the start.');
  }
  for (const checkpoint of plan.checkpoints) {
    lines.push(`- ${checkpoint.id}: ${checkpoint.label} [${checkpoint.surface}]${checkpoint.requiresApproval ? ' (approval gated)' : ''}`);
    lines.push(`  Objective: ${checkpoint.objective}`);
    lines.push(`  Verify: ${checkpoint.verification.join(' | ')}`);
    lines.push(`  Stop if: ${checkpoint.stopConditions.join(' | ')}`);
  }
  if (complexityPlanTouchesDesktopSurface(plan)) {
    lines.push(formatDataTransferPrecisionRulesBlock());
  }
  lines.push('Checkpoint rule: after each mutation, re-observe and verify before moving to the next checkpoint.');
  lines.push('User-output rule: show only approvals, final proof, or actionable blockers; keep internal checkpoint detail in metadata/archive unless debug is requested.');
  return lines.join('\n');
}
