import type { ComputerTaskPlanPreview } from './computerTaskPlanner';

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

export interface ComputerTaskComplexityPlan {
  level: ComputerTaskComplexityLevel;
  score: number;
  reasons: string[];
  checkpoints: ComputerTaskCheckpoint[];
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
      'autocad', 'fusion 360', 'solidworks', 'revit', 'sketchup', 'blender', 'figma',
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
  if (matchesAny(task, [/\b(cad|autocad|fusion\s*360|solidworks|revit|engineering|dimension|units?|scale|drawing|model|photoshop|indesign|layers?|canvas|crop|retouch)\b/i])) {
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

export function buildComputerTaskComplexityPlan(args: {
  task: string;
  preview: ComputerTaskPlanPreview;
}): ComputerTaskComplexityPlan {
  const task = String(args.task || '').trim();
  const { score, reasons } = complexityScore(task, args.preview);
  const level = levelForScore(score);
  const checkpoints = baseCheckpoints({
    task,
    preview: args.preview,
    level,
    reasons,
  });
  return {
    level,
    score,
    reasons,
    checkpoints: level === 'simple'
      ? checkpoints.filter((checkpoint) => ['scope-readiness', 'execute-in-small-steps', 'final-proof'].includes(checkpoint.id))
      : checkpoints,
    visibleNextSteps: checkpoints
      .filter((checkpoint) => checkpoint.id !== 'bounded-recovery')
      .slice(0, level === 'complex' ? 5 : 3)
      .map((checkpoint) => checkpoint.label),
  };
}

export function formatComputerTaskComplexityDispatchBlock(plan: ComputerTaskComplexityPlan | null | undefined): string | null {
  if (!plan || plan.level === 'simple') return null;
  const lines = [
    '## Complex Computer Task Checkpoints',
    `Complexity: ${plan.level} (score ${plan.score})${plan.reasons.length ? ` — ${plan.reasons.join(', ')}` : ''}`,
    'Run checkpoints in order. Do not skip observation, approval, verification, or recovery checkpoints.',
  ];
  for (const checkpoint of plan.checkpoints) {
    lines.push(`- ${checkpoint.id}: ${checkpoint.label} [${checkpoint.surface}]${checkpoint.requiresApproval ? ' (approval gated)' : ''}`);
    lines.push(`  Objective: ${checkpoint.objective}`);
    lines.push(`  Verify: ${checkpoint.verification.join(' | ')}`);
    lines.push(`  Stop if: ${checkpoint.stopConditions.join(' | ')}`);
  }
  lines.push('Checkpoint rule: after each mutation, re-observe and verify before moving to the next checkpoint.');
  lines.push('User-output rule: show only approvals, final proof, or actionable blockers; keep internal checkpoint detail in metadata/archive unless debug is requested.');
  return lines.join('\n');
}
