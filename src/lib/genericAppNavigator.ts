import { isScriptableMacApp } from './scriptableMacApps';
import { findKnownAppInText, matchKnownApp } from './knownAppShortcuts';

export type GenericAppNavigatorPhaseId =
  | 'identify_app'
  | 'observe_window'
  | 'inspect_semantic_tree'
  | 'research_control_surface'
  | 'plan_semantic_action'
  | 'execute_bounded_step'
  | 'verify_or_buildout';

export type GenericAppNavigatorTaskFamily =
  | 'launch_or_read'
  | 'field_or_form_entry'
  | 'menu_or_shortcut'
  | 'toggle_or_select'
  | 'file_open_save_export'
  | 'canvas_or_visual_edit'
  | 'dialog_handling'
  | 'unknown_mutation';

export type GenericAppNavigatorWorkflowGoalKind =
  | 'launch_and_inspect'
  | 'open_requested_file'
  | 'enter_requested_values'
  | 'invoke_menu_or_shortcut'
  | 'set_toggle_or_selection'
  | 'edit_canvas_or_timeline'
  | 'save_or_export'
  | 'commit_external_action'
  | 'handle_dialog'
  | 'perform_requested_semantic_action'
  | 'verify_requested_result';

export type GenericAppNavigatorSemanticSurface =
  | 'existing_app_adapter'
  | 'app_lifecycle'
  | 'app_native_api_or_script'
  | 'documented_file_adapter'
  | 'embedded_app_dom_or_cdp'
  | 'os_accessibility'
  | 'semantic_menu'
  | 'verified_keyboard_shortcut';

export type GenericAppNavigatorMutationClass =
  | 'observation_only'
  | 'app_lifecycle_change'
  | 'local_file_access'
  | 'reversible_input'
  | 'app_or_document_mutation'
  | 'persistent_file_write'
  | 'external_side_effect'
  | 'destructive_or_sensitive';

export type GenericAppNavigatorApprovalClass =
  | 'none'
  | 'shared_workflow_review'
  | 'approval_before_mutation'
  | 'approval_before_persistent_or_external'
  | 'user_choice_if_ambiguous';

export interface GenericAppNavigatorWorkflowCheckpoint {
  id: GenericAppNavigatorWorkflowGoalKind;
  ordinal: number;
  goal: string;
  observeBefore: string[];
  allowedSemanticSurfaces: GenericAppNavigatorSemanticSurface[];
  mutationClass: GenericAppNavigatorMutationClass;
  approvalClass: GenericAppNavigatorApprovalClass;
  expectedPostcondition: string;
  buildoutOrStopRule: string;
}

export interface GenericAppNavigatorSemanticWorkflow {
  schemaVersion: 1;
  /** Exact user text. Classification uses a normalized copy, but this is never rewritten or split. */
  originalRequest: string;
  maxCheckpoints: number;
  wasCapped: boolean;
  checkpoints: GenericAppNavigatorWorkflowCheckpoint[];
  approvalScope: {
    mode: 'single_bounded_workflow_review';
    /** Reversible semantic steps covered by one review, never one prompt per field/control. */
    sharedReviewCheckpointIds: GenericAppNavigatorWorkflowGoalKind[];
    /** Persistent, external, destructive, credential, permission, or ambiguous steps keep an exact floor. */
    exactApprovalCheckpointIds: GenericAppNavigatorWorkflowGoalKind[];
  };
  completionRule: string;
  stopRule: string;
}

export type GenericAppNavigatorSourceType =
  | 'official_vendor'
  | 'official_platform'
  | 'official_framework'
  | 'official_protocol';

export interface GenericAppNavigatorSourceRef {
  label: string;
  url: string;
  takeaway: string;
  sourceType: GenericAppNavigatorSourceType;
  lastReviewedAt: string;
  primaryUse?: string;
  mustConfirm?: string[];
}

export interface GenericAppNavigatorPlan {
  /** The exact request is retained so decomposition cannot silently drop a clause. */
  originalRequest: string;
  targetAppName: string;
  taskFamily: GenericAppNavigatorTaskFamily;
  canNavigateWithoutAdapter: boolean;
  semanticWorkflow: GenericAppNavigatorSemanticWorkflow;
  userEffortPolicy: string[];
  phases: { id: GenericAppNavigatorPhaseId; instruction: string }[];
  observeFirst: string[];
  actionLadder: string[];
  approvalBoundaries: string[];
  stopConditions: string[];
  recoveryRules: string[];
  recommendedTools: string[];
  buildoutTriggers: string[];
  sourceRefs: GenericAppNavigatorSourceRef[];
}

export interface GenericAppNavigatorRouteContext {
  targetAppName: string;
  taskFamily: GenericAppNavigatorTaskFamily;
  taskFamilyLabel: string;
  plan: GenericAppNavigatorPlan;
}

const GENERIC_APP_RESEARCH_REVIEWED_AT = '2026-06-01';

export const GENERIC_APP_NAVIGATOR_SOURCE_REFS: GenericAppNavigatorSourceRef[] = [
  {
    label: 'Apple UI scripting and Accessibility',
    url: 'https://developer.apple.com/library/archive/documentation/LanguagesUtilities/Conceptual/MacAutomationScriptingGuide/AutomatetheUserInterface.html',
    takeaway: 'On macOS, generic app control should query the Accessibility element hierarchy before UI actions and requires Accessibility permission.',
    sourceType: 'official_platform',
    lastReviewedAt: GENERIC_APP_RESEARCH_REVIEWED_AT,
    primaryUse: 'macOS unfamiliar-app control through accessible windows, menus, fields, and buttons',
    mustConfirm: ['Accessibility permission is granted', 'target process/window/control hierarchy is freshly observed'],
  },
  {
    label: 'Microsoft UI Automation',
    url: 'https://learn.microsoft.com/en-us/windows/win32/winauto/ui-automation-specification',
    takeaway: 'Windows native app automation should use the UI Automation tree and control patterns before coordinate input.',
    sourceType: 'official_platform',
    lastReviewedAt: GENERIC_APP_RESEARCH_REVIEWED_AT,
    primaryUse: 'Windows unfamiliar-app control through semantic controls and control patterns',
    mustConfirm: ['target control pattern is available', 'control identity is unique before mutation'],
  },
  {
    label: 'Playwright locators',
    url: 'https://playwright.dev/docs/locators',
    takeaway: 'For browser-like apps, use user-facing locators such as role, label, text, and title before brittle selectors or coordinates.',
    sourceType: 'official_framework',
    lastReviewedAt: GENERIC_APP_RESEARCH_REVIEWED_AT,
    primaryUse: 'semantic browser and Electron-style control targeting',
    mustConfirm: ['locator resolves to the intended element', 'target action is scoped to the approved session'],
  },
  {
    label: 'Playwright auto-waiting and actionability',
    url: 'https://playwright.dev/docs/actionability',
    takeaway: 'Actions should wait for visible, stable, enabled, and event-receiving targets, then return structured recovery when actionability fails.',
    sourceType: 'official_framework',
    lastReviewedAt: GENERIC_APP_RESEARCH_REVIEWED_AT,
    primaryUse: 'readiness checks before semantic browser or hybrid app actions',
    mustConfirm: ['visible/stable/enabled checks pass before action', 'force actions are not used as a shortcut'],
  },
  {
    label: 'Chrome DevTools Protocol',
    url: 'https://chromedevtools.github.io/devtools-protocol/',
    takeaway: 'Browser-like surfaces should inspect page/runtime/session state through protocol data before screenshots or coordinate input.',
    sourceType: 'official_protocol',
    lastReviewedAt: GENERIC_APP_RESEARCH_REVIEWED_AT,
    primaryUse: 'browser and Electron runtime buildout when DOM/ARIA bridge tools are missing',
    mustConfirm: ['debug target belongs to the approved user session', 'protocol commands do not bypass human verification'],
  },
];

const KNOWN_CONFIGURED_APP_NAMES = new Set([
  'adobe photoshop',
  'photoshop',
  'adobe indesign',
  'indesign',
  'in design',
  'illustrator',
  'adobe illustrator',
  'adobe audition',
  'adobe premiere',
  'premiere pro',
  'after effects',
  'autocad',
  'auto cad',
  'fusion 360',
  'solidworks',
  'solid works',
  'matlab',
  'mathworks',
  'simulink',
  'revit',
  'rhino',
  'inventor',
  'browser',
  'chrome',
  'safari',
  'firefox',
  'edge',
]);

const GENERIC_CANDIDATE_STOP_WORDS = new Set([
  'app',
  'application',
  'browser',
  'desktop',
  'file',
  'files',
  'file',
  'files',
  'folder',
  'website',
  'webpage',
  'site',
  'http',
  'https',
  'www',
  'window',
  'program',
  'computer',
  'dialog',
  'document',
  'documents',
  'door',
  'modal',
  'popup',
  'prompt',
  'settings',
  'preferences',
  'my',
  'your',
  'our',
  'it',
  'this',
  'that',
  'there',
  'in',
  'inside',
  'something',
  'anything',
  'chat',
  'swanbot',
  'openswan',
]);

function compactWhitespace(value: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function titleCaseName(value: string): string {
  return value
    .split(/\s+/)
    .map((part) => {
      if (!part) return part;
      if (/[A-Z]/.test(part.slice(1)) || /\d/.test(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(' ');
}

function cleanAppNameCandidate(
  raw: string | undefined,
  options: { trusted?: boolean } = {},
): string | null {
  let value = compactWhitespace(raw || '')
    .replace(/^[\s"'`]+|[\s"'`,.;:]+$/g, '')
    .replace(/^(?:the|a|an)\s+/i, '')
    .replace(/\s+(?:app|application|window|program)$/i, '')
    .trim();
  if (!value) return null;
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length > 5) return null;
  const first = words[0]?.toLowerCase() || '';
  const normalized = value.toLowerCase();
  if (GENERIC_CANDIDATE_STOP_WORDS.has(first) || GENERIC_CANDIDATE_STOP_WORDS.has(normalized)) return null;
  if (/^\d+(?:\s+\d+)*$/.test(value)) return null;
  if (/^(?:https?:\/\/|www\.)/i.test(value) || /\.[a-z0-9]{2,5}\b/i.test(value)) return null;
  if (/\b(?:screenshot|downloads?|documents?|project|workspace|image|pdf|csv|png|jpe?g|psd|indd)\b/i.test(value)) return null;
  // `Photo` is also a legitimate product suffix (Affinity Photo). Keep a
  // bare/local-photo target rejected while preserving a multi-word app name.
  if (
    /\bphoto\b/i.test(value)
    && !options.trusted
    && !(words.length >= 2 && /\bphoto$/i.test(value))
  ) return null;
  // `Desktop` is both a common filesystem location and a legitimate product
  // suffix (Docker Desktop, Microsoft Remote Desktop). Keep rejecting a bare
  // Desktop target via the stop-word check above, and only accept it from
  // inferred text when it is the final token of a multi-word app name. A
  // caller-supplied targetAppName is already a parsed/trusted app identity and
  // may contain Desktop in any position.
  if (
    /\bdesktop\b/i.test(value)
    && !options.trusted
    && !(words.length >= 2 && /\bdesktop$/i.test(value))
  ) return null;
  return titleCaseName(value);
}

export interface StrictNamedAppLifecycleIntent {
  operation: 'open_or_launch' | 'focus';
  /** User-spoken app phrase, with only articles/app suffixes removed. */
  appName: string;
  /** Exact bridge-observed identity used for dispatch when a lowercase long-tail name needs proof. */
  observedAppName?: string;
}

export interface StrictNamedAppLifecycleParseOptions {
  /** Exact installed/running names from the latest bridge-backed app-resolution context. */
  observedAppNames?: readonly string[] | null;
}

export type DirectDesktopCommandModifier =
  | 'greeting'
  | 'discourse_marker'
  | 'request_courtesy'
  | 'scope_limiter'
  | 'recipient_courtesy'
  | 'soft_urgency'
  | 'soft_timing'
  | 'desktop_scope';

/**
 * Bounded, non-operational language around a direct desktop command.
 *
 * `commandCandidates` is ordered from least to most normalized. Lifecycle
 * parsing uses that order to preserve an exact installed app whose real name
 * ends in a modifier-looking word (for example, `Acme Now`) before considering
 * the fully normalized command. Nothing in this envelope may add, remove, or
 * weaken an operation, condition, approval, credential, or schedule.
 */
export interface DirectDesktopCommandEnvelope {
  command: string;
  commandCandidates: readonly string[];
  modifiers: readonly DirectDesktopCommandModifier[];
}

let refreshedLifecycleAppNames: readonly string[] = [];

/**
 * Refresh the narrow lowercase long-tail allowlist consumed by preflight.
 * The router is the owner of bridge freshness and clears this list whenever
 * the app-resolution context is offline or lacks an authoritative probe.
 */
export function setStrictNamedAppLifecycleObservedNames(names: readonly string[] | null | undefined): void {
  refreshedLifecycleAppNames = Array.isArray(names)
    ? names.filter((name): name is string => typeof name === 'string' && Boolean(name.trim())).slice(0, 500)
    : [];
}

function normalizeObservedAppName(value: string): string {
  return compactWhitespace(value)
    .replace(/\.app$/i, '')
    .trim()
    .toLowerCase();
}

function exactObservedAppName(
  candidate: string,
  options: StrictNamedAppLifecycleParseOptions,
): string | null {
  const names = options.observedAppNames === undefined
    ? refreshedLifecycleAppNames
    : options.observedAppNames || [];
  const normalizedCandidate = normalizeObservedAppName(candidate);
  if (!normalizedCandidate) return null;
  for (const rawName of names) {
    const observed = compactWhitespace(rawName).replace(/\.app$/i, '').trim();
    if (
      observed
      && observed.length <= 120
      && /^[A-Za-z0-9 .\-_()]+$/.test(observed)
      && normalizeObservedAppName(observed) === normalizedCandidate
    ) return observed;
  }
  return null;
}

const DIRECT_DESKTOP_COMMAND_MAX_LENGTH = 4_000;
const DIRECT_DESKTOP_MODIFIER_LIMIT = 12;

const DIRECT_DESKTOP_SUFFIX_MODIFIERS: ReadonlyArray<{
  kind: DirectDesktopCommandModifier;
  pattern: RegExp;
}> = [
  {
    kind: 'request_courtesy',
    pattern: /\s*,?\s*(?:please|thanks(?:\s+in\s+advance)?|thank\s+you(?:\s+very\s+much)?|ok(?:ay)?|if\s+that(?:'|’)s\s+ok(?:ay)?)$/i,
  },
  {
    kind: 'recipient_courtesy',
    pattern: /\s+for\s+(?:me|us)$/i,
  },
  {
    kind: 'soft_urgency',
    pattern: /\s*,?\s*(?:now|already|right\s+now|right\s+away|straight\s+away|at\s+once|asap|quick|real(?:ly)?\s+(?:quick|fast)|quickly)$/i,
  },
  {
    kind: 'soft_timing',
    pattern: /\s*,?\s*(?:as\s+soon\s+as\s+you\s+can|when(?:ever)?\s+you\s+can|when(?:ever)?\s+you\s+(?:get|have)\s+(?:a\s+)?(?:chance|moment|second|time)|when(?:ever)?\s+possible|if\s+possible|at\s+your\s+(?:earliest\s+)?convenience|if\s+you\s+(?:do\s+not|don't)\s+mind|no\s+rush)$/i,
  },
  {
    kind: 'desktop_scope',
    pattern: /\s+on\s+(?:(?:my|this|the)\s+)?(?:mac|computer|desktop|machine)$/i,
  },
];

function addDirectDesktopModifier(
  modifiers: DirectDesktopCommandModifier[],
  modifier: DirectDesktopCommandModifier,
): void {
  if (!modifiers.includes(modifier) && modifiers.length < DIRECT_DESKTOP_MODIFIER_LIMIT) {
    modifiers.push(modifier);
  }
}

function stripDirectDesktopTerminalPunctuation(value: string): string {
  return value.replace(/\s*[.!?]+\s*$/g, '').trim();
}

function normalizeWouldYouMindCommand(value: string): string {
  const replacements: Array<[RegExp, string]> = [
    [/^opening\s+up\b/i, 'open up'],
    [/^opening\b/i, 'open'],
    [/^launching\b/i, 'launch'],
    [/^starting\b/i, 'start'],
    [/^focusing\b/i, 'focus'],
    [/^activating\b/i, 'activate'],
    [/^switching\s+over\s+to\b/i, 'switch over to'],
    [/^switching\s+to\b/i, 'switch to'],
    [/^bringing\b/i, 'bring'],
    [/^creating\b/i, 'create'],
    [/^making\b/i, 'make'],
  ];
  let normalized = value;
  for (const [pattern, replacement] of replacements) {
    if (pattern.test(normalized)) {
      normalized = normalized.replace(pattern, replacement);
      break;
    }
  }
  return normalized
    .replace(/\b(and|then)\s+opening\b/gi, '$1 open')
    .replace(/\b(and|then)\s+launching\b/gi, '$1 launch')
    .replace(/\b(and|then)\s+starting\b/gi, '$1 start')
    .replace(/\b(and|then)\s+creating\b/gi, '$1 create')
    .replace(/\b(and|then)\s+making\b/gi, '$1 make');
}

/**
 * Separate the semantic command from harmless conversational wrapping.
 *
 * This intentionally is not a general natural-language parser. It accepts a
 * closed set of greetings, request courtesies, scope limiters, soft urgency,
 * and desktop-scope phrases. Material words remain in `command`, where the
 * exact lifecycle/program grammar rejects them or routes them to the normal
 * model-guided workflow.
 */
export function parseDirectDesktopCommandEnvelope(task: string): DirectDesktopCommandEnvelope | null {
  let text = compactWhitespace(task);
  if (!text || text.length > DIRECT_DESKTOP_COMMAND_MAX_LENGTH) return null;

  const modifiers: DirectDesktopCommandModifier[] = [];
  const greeting = text.match(/^(?:hey|hi|hello)(?:\s+there)?\s*[,!]\s*([\s\S]+)$/i);
  if (greeting?.[1]) {
    text = greeting[1].trim();
    addDirectDesktopModifier(modifiers, 'greeting');
  }

  const discourseMarker = text.match(/^(?:ok(?:ay)?|alright|actually)\s*,\s*([\s\S]+)$/i);
  if (discourseMarker?.[1]) {
    text = discourseMarker[1].trim();
    addDirectDesktopModifier(modifiers, 'discourse_marker');
  }

  // Questions asking what the user should do are guidance, not execution
  // authority, even when wrapped in a greeting or politeness.
  if (/^(?:should|would|could|can|may|might|will|do)\s+i\b/i.test(text)) return null;

  let leadingCourtesy = text.match(/^(?:please|kindly)\s*,?\s*([\s\S]+)$/i);
  while (leadingCourtesy?.[1]) {
    text = leadingCourtesy[1].trim();
    addDirectDesktopModifier(modifiers, 'request_courtesy');
    leadingCourtesy = text.match(/^(?:please|kindly)\s*,?\s*([\s\S]+)$/i);
  }

  let normalizeMindGerund = false;
  const mindRequest = text.match(/^(?:would|do)\s+you\s+mind\b\s*([\s\S]+)$/i);
  const abilityRequest = text.match(/^(?:could|would)\s+you\s+be\s+able\s+to\s+([\s\S]+)$/i);
  const modalRequest = text.match(/^(?:can|could|would|will)\s+you\b\s*([\s\S]+)$/i);
  const personalRequest = text.match(
    /^(?:i\s+(?:want|need|would\s+like)\s+you\s+to|i(?:'|’)d\s+like\s+you\s+to)\s+([\s\S]+)$/i,
  );
  if (mindRequest?.[1]) {
    text = mindRequest[1].trim();
    normalizeMindGerund = true;
    addDirectDesktopModifier(modifiers, 'request_courtesy');
  } else if (abilityRequest?.[1]) {
    text = abilityRequest[1].trim();
    addDirectDesktopModifier(modifiers, 'request_courtesy');
  } else if (modalRequest?.[1]) {
    text = modalRequest[1].trim();
    addDirectDesktopModifier(modifiers, 'request_courtesy');
  } else if (personalRequest?.[1]) {
    text = personalRequest[1].trim();
    addDirectDesktopModifier(modifiers, 'request_courtesy');
  }

  for (let index = 0; index < DIRECT_DESKTOP_MODIFIER_LIMIT; index += 1) {
    const goAhead = text.match(/^go\s+ahead\s+and\s+([\s\S]+)$/i);
    if (goAhead?.[1]) {
      text = goAhead[1].trim();
      addDirectDesktopModifier(modifiers, 'scope_limiter');
      continue;
    }
    const favor = text.match(/^do\s+me\s+a\s+favou?r\s+and\s+([\s\S]+)$/i);
    if (favor?.[1]) {
      text = favor[1].trim();
      addDirectDesktopModifier(modifiers, 'request_courtesy');
      continue;
    }
    const scoped = text.match(/^(?:please|kindly|just|only|simply|quickly|now)\s*,?\s+([\s\S]+)$/i);
    if (scoped?.[1]) {
      text = scoped[1].trim();
      addDirectDesktopModifier(
        modifiers,
        /^(?:please|kindly)\b/i.test(scoped[0]) ? 'request_courtesy' : 'scope_limiter',
      );
      continue;
    }
    // Tentative adverbs are harmless only inside an explicit request frame
    // ("could you maybe open..."). A bare "maybe open..." stays conversational.
    if (mindRequest || abilityRequest || modalRequest || personalRequest) {
      const tentative = text.match(/^(?:maybe|possibly)\s+([\s\S]+)$/i);
      if (tentative?.[1]) {
        text = tentative[1].trim();
        addDirectDesktopModifier(modifiers, 'request_courtesy');
        continue;
      }
    }
    break;
  }

  if (normalizeMindGerund) text = normalizeWouldYouMindCommand(text);
  text = stripDirectDesktopTerminalPunctuation(text);
  if (!text) return null;

  const commandCandidates: string[] = [text];
  let command = text;
  for (let index = 0; index < DIRECT_DESKTOP_MODIFIER_LIMIT; index += 1) {
    let stripped = false;
    for (const suffix of DIRECT_DESKTOP_SUFFIX_MODIFIERS) {
      const match = command.match(suffix.pattern);
      if (!match || match.index === undefined) continue;
      const next = command.slice(0, match.index).replace(/[\s,]+$/g, '').trim();
      // Never consume the entire target (for example, an app genuinely named
      // `Now`). At least an action token and target token must remain.
      if (next.split(/\s+/).filter(Boolean).length < 2) continue;
      command = stripDirectDesktopTerminalPunctuation(next);
      addDirectDesktopModifier(modifiers, suffix.kind);
      if (!commandCandidates.includes(command)) commandCandidates.push(command);
      stripped = true;
      break;
    }
    if (!stripped) break;
  }

  return Object.freeze({
    command,
    commandCandidates: Object.freeze(commandCandidates),
    modifiers: Object.freeze([...modifiers]),
  });
}

/**
 * Return the normalized command shared by strict app lifecycle routing and
 * compiler-owned exact programs. See `parseDirectDesktopCommandEnvelope` for
 * the deliberately narrow language that may be ignored.
 */
export function unwrapDirectDesktopCommand(task: string): string | null {
  return parseDirectDesktopCommandEnvelope(task)?.command || null;
}

function exactlyNamedKnownApp(candidate: string) {
  const known = matchKnownApp(candidate);
  if (!known) return null;
  const normalized = compactWhitespace(candidate).toLowerCase();
  const canonicalNames = [known.displayName, known.macLaunchName]
    .filter(Boolean)
    .map((name) => compactWhitespace(name || '').toLowerCase());
  if (canonicalNames.includes(normalized)) return known;
  // Generic task-noun aliases remain ambiguous even after an "open" verb.
  // Keep only the small OS-settings spelling users naturally use; ordinary
  // lowercase phrases such as "task manager" must not become app identities.
  if (normalized === 'settings') return known;
  const explicit = findKnownAppInText(candidate);
  return explicit?.app.id === known.id && normalized === explicit.matchedAlias
    ? known
    : null;
}

function extractNamedAppLifecycleCommandText(
  command: string,
  normalizeTrailingOpenParticle = false,
): {
  operation: StrictNamedAppLifecycleIntent['operation'];
  rawCandidate: string;
} | null {
  if (!command) return null;
  const direct = command.match(
    /^(open(?:\s+up)?|launch|start|focus|activate|switch(?:\s+over)?\s+to)\s+(.+)$/i,
  );
  if (direct) {
    const verb = String(direct[1] || '');
    const rawCandidate = String(direct[2] || '');
    const normalizedCandidate = normalizeTrailingOpenParticle && /^open$/i.test(verb)
      ? rawCandidate.replace(/\s+up$/i, '').trim() || rawCandidate
      : rawCandidate;
    return {
      operation: /^(?:focus|activate|switch(?:\s+over)?\s+to)$/i.test(verb)
        ? 'focus'
        : 'open_or_launch',
      rawCandidate: normalizedCandidate,
    };
  }
  const bringAfter = command.match(
    /^bring\s+(.+?)\s+(?:to\s+(?:the\s+)?(?:front|foreground|forward)|forward)$/i,
  );
  const bringBefore = command.match(/^bring\s+forward\s+(.+)$/i);
  const rawCandidate = bringAfter?.[1] || bringBefore?.[1] || '';
  return rawCandidate ? { operation: 'focus', rawCandidate } : null;
}

function normalizeLifecycleAppCandidate(rawCandidate: string): string {
  return compactWhitespace(rawCandidate)
    .replace(/^[\s"'`]+|[\s"'`]+$/g, '')
    .replace(/^(?:the|a|an)\s+/i, '')
    .replace(/\s+(?:app|application|program)$/i, '')
    .trim();
}

function isExactLifecycleAppIdentity(
  rawCandidate: string,
  options: StrictNamedAppLifecycleParseOptions,
): boolean {
  const candidate = normalizeLifecycleAppCandidate(rawCandidate);
  if (!candidate || /^(?:task manager)$/i.test(candidate)) return false;
  return Boolean(exactlyNamedKnownApp(candidate) || exactObservedAppName(candidate, options));
}

function extractNamedAppLifecycleCommand(
  task: string,
  options: StrictNamedAppLifecycleParseOptions = {},
): {
  operation: StrictNamedAppLifecycleIntent['operation'];
  rawCandidate: string;
} | null {
  const envelope = parseDirectDesktopCommandEnvelope(task);
  if (!envelope) return null;

  // Prefer the longest exact catalog/observed identity before removing a
  // modifier-looking suffix. This keeps a real installed `Acme Now` target
  // intact while still normalizing `Open Photoshop right now`.
  for (const command of envelope.commandCandidates) {
    const extracted = extractNamedAppLifecycleCommandText(command);
    if (extracted && isExactLifecycleAppIdentity(extracted.rawCandidate, options)) return extracted;
  }
  return extractNamedAppLifecycleCommandText(envelope.command, true);
}

function hasLifecycleFollowUpSyntax(candidate: string): boolean {
  return /[,;:]/.test(candidate)
    || /\b(?:and|or|then|also|but|because|while|after|before|once|to|for|if|unless|until|without|using|with|via|in|on|at)\b/i.test(candidate)
    || /\b(?:again|today|later|tomorrow|tonight|next\s+(?:hour|day|week|month)|this\s+(?:morning|afternoon|evening|weekend))\b/i.test(candidate)
    || /\bat\s+\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?\b/i.test(candidate);
}

export function hasStrictNamedAppLifecycleCommandShape(task: string): boolean {
  const extracted = extractNamedAppLifecycleCommand(task);
  return Boolean(extracted?.rawCandidate && !hasLifecycleFollowUpSyntax(extracted.rawCandidate));
}

/**
 * Parse the complete, single-intent lifecycle grammar used by both Chat's
 * deterministic dispatcher and generic app preflight. The anchored grammar
 * rejects appended reads/mutations; candidate validation rejects local
 * artifacts and ordinary nouns before they can become app launch targets.
 */
export function parseStrictNamedAppLifecycleIntent(
  task: string,
  options: StrictNamedAppLifecycleParseOptions = {},
): StrictNamedAppLifecycleIntent | null {
  const extracted = extractNamedAppLifecycleCommand(task, options);
  if (!extracted?.rawCandidate) return null;
  const { operation, rawCandidate } = extracted;

  const appName = normalizeLifecycleAppCandidate(rawCandidate);
  if (!appName) return null;
  const hasExplicitAppSuffix = /\s+(?:app|application|program)\s*$/i.test(compactWhitespace(rawCandidate));

  // A catalog alias may legitimately contain a connector. Unknown candidates
  // containing clause syntax are follow-up instructions, never part of this
  // no-model lifecycle lane.
  const exactKnownApp = exactlyNamedKnownApp(appName);
  const observedAppName = exactKnownApp ? null : exactObservedAppName(appName, options);
  if (
    !exactKnownApp
    && !observedAppName
    && (
      hasLifecycleFollowUpSyntax(appName)
    )
  ) return null;
  if (!exactKnownApp && !cleanAppNameCandidate(appName)) return null;
  // Keep the existing ambiguous OS noun suppression even if a noisy process
  // inventory happens to contain a matching label.
  if (!exactKnownApp && /^(?:task manager)$/i.test(appName)) return null;
  const looksProductNamed = appName
    .split(/\s+/)
    .every((word) => /^[A-Z0-9]/.test(word))
    || /[a-z][A-Z]|\d/.test(appName);
  if (!exactKnownApp && !observedAppName && !hasExplicitAppSuffix && !looksProductNamed) return null;

  return { operation, appName, ...(observedAppName ? { observedAppName } : {}) };
}

function isGenericFallbackAppName(value: string | null | undefined): boolean {
  return /^(?:native desktop app|native desktop|desktop app|unfamiliar desktop app|unfamiliar desktop|generic app navigator|app automation route)$/i.test(compactWhitespace(value || ''));
}

export function inferGenericAppName(
  task: string,
  options: StrictNamedAppLifecycleParseOptions = {},
): string | null {
  const text = compactWhitespace(task);
  if (!text) return null;
  const strictLifecycle = parseStrictNamedAppLifecycleIntent(text, options);
  if (strictLifecycle) {
    return cleanAppNameCandidate(strictLifecycle.appName, { trusted: true })
      || exactlyNamedKnownApp(strictLifecycle.appName)?.displayName
      || strictLifecycle.appName;
  }
  if (hasStrictNamedAppLifecycleCommandShape(text)) return null;
  const knownApp = findKnownAppInText(text);
  const knownAliasPattern = knownApp
    ? knownApp.matchedAlias.split(/\s+/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+')
    : null;
  const hasDirectKnownAppImperative = Boolean(
    knownApp
    && knownAliasPattern
    && new RegExp(`\\b(?:open|launch|focus|switch\\s+to|use|control|drive|automate|take\\s+over)\\s+(?:the\\s+)?${knownAliasPattern}\\b`, 'i').test(text),
  );
  const patterns = [
    /\b(?:disconnect|maximize|minimize|pause|play|resume|stop|mute|unmute)\s+(?:the\s+)?([A-Za-z0-9][A-Za-z0-9.+#&_-]*(?:\s+[A-Za-z0-9][A-Za-z0-9.+#&_-]*){0,3}\s+Desktop)(?=\s*[,;:!?.]|\s*$)/i,
    /\b(?:open|launch|focus|switch to|use|control|drive|automate|take over)\s+(?:the\s+)?([A-Za-z0-9][A-Za-z0-9.+#&_-]*(?:\s+[A-Za-z0-9][A-Za-z0-9.+#&_-]*){0,4}?)(?:\s+(?:app|application|window|program))?\s+(?:and|then|for|with|to(?=\s+(?:add|create|make|build|edit|change|update|set|fill|enter|type|paste|press|run|open|save|export|render|draw|paint|crop|trim|resize|rotate|record|sync|send|submit|publish|delete|remove|inspect|read)))\b/i,
    /\b(?:open|launch|focus|switch to|use|control|drive|automate|take over)\s+(?:the\s+)?([A-Za-z0-9][A-Za-z0-9.+#&_-]*(?:\s+[A-Za-z0-9][A-Za-z0-9.+#&_-]*){0,4})(?:\s+(?:app|application|window|program))?(?=\s*[,;:!?.]|\s*$)/i,
    /\b(?:in|inside|using|with)\s+(?:the\s+)?([A-Za-z0-9][A-Za-z0-9.+#&_-]*(?:\s+[A-Za-z0-9][A-Za-z0-9.+#&_-]*){0,4})(?:\s+(?:app|application|window|program))\b/i,
    /\b(?:in|inside|using|with)\s+(?:the\s+)?([A-Za-z0-9][A-Za-z0-9.+#&_-]*(?:\s+[A-Za-z0-9][A-Za-z0-9.+#&_-]*){0,4})(?=\s*[,;:!?.])/i,
    /\b(?:open|launch|focus|switch to|use|control|drive|automate|take over)\s+(?:the\s+)?([A-Za-z0-9][A-Za-z0-9.+#&_-]*(?:\s+[A-Za-z0-9][A-Za-z0-9.+#&_-]*){0,3})(?:\s+(?:app|application|window|program))?[.!?]?$/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const candidate = cleanAppNameCandidate(match?.[1]);
    if (candidate) return candidate;
  }
  // Preserve an explicit app identity captured from the request whenever the
  // generic grammar can do so (for example, "Visual Studio Code" should not
  // be rewritten to the catalog label "VS Code"). The catalog is only the
  // fallback for valid product names that contain an otherwise ambiguous task
  // noun, such as "Image Capture".
  if (knownApp && hasDirectKnownAppImperative) return knownApp.app.displayName;
  return null;
}

export function isKnownConfiguredAppName(appName: string | null | undefined): boolean {
  if (!appName) return false;
  return KNOWN_CONFIGURED_APP_NAMES.has(compactWhitespace(appName).toLowerCase());
}

function isReadOnlyGenericAppObservation(task: string): boolean {
  const text = compactWhitespace(task).toLowerCase();
  const hasExplicitReadIntent = (
    /\b(?:inspect|read|summarize|report|describe|list|look at|tell me|what is|what are|what's)\b/.test(text)
    || (
      /\b(?:show|display)\b/.test(text)
      && /\b(?:path|location|size|dimensions?|metadata|properties|information|info|title|name|status|page(?: number)?|duration|count|version)\b/.test(text)
    )
  );
  if (!hasExplicitReadIntent) return false;

  // App launch/focus and read-only file access are allowed here. Any requested
  // mutation or commit keeps its more specific family even when the request
  // also asks to report the result.
  return !/\b(?:create|make|build|add|insert|edit|change|update|set|fill|enter|write|put|click|select|choose|type|paste|press|run|start|stop|disconnect|maximize|minimize|pause|play|resume|seek|skip|record|configure|apply|rename|replace|overwrite|move|convert|sync|synchronize|delete|remove|erase|wipe|reset|save|saving|export|exporting|render|rendering|print|printing|download|downloading|upload|uploading|send|email|submit|publish|post|share|invite|purchase|buy|pay|book|schedule|sign|authenticate|authorize|grant|connect|link|login|log in|sign in|unmute)\b/.test(text);
}

export function classifyGenericAppTaskFamily(
  task: string,
  options: { targetAppName?: string | null; observedAppNames?: readonly string[] | null } = {},
): GenericAppNavigatorTaskFamily {
  if (parseStrictNamedAppLifecycleIntent(task, options)) return 'launch_or_read';
  const normalized = String(task || '').toLowerCase();
  const inferredApp = cleanAppNameCandidate(options.targetAppName || '', { trusted: true })
    || inferGenericAppName(task, options);
  // Product-name nouns such as `Photo`, `Music`, or `Desktop` describe the
  // target, not the requested action. Remove the parsed app span before task
  // family classification so `Launch Affinity Photo` stays launch/read while
  // `Open Affinity Photo and crop the image` still classifies as a mutation.
  const inferredPattern = inferredApp
    ? inferredApp.toLowerCase().split(/\s+/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+')
    : null;
  const text = inferredApp
    ? normalized.replace(new RegExp(`\\b${inferredPattern}\\b`, 'i'), ' ')
    : normalized;
  if (isReadOnlyGenericAppObservation(text)) {
    return 'launch_or_read';
  }
  if (/\b(save(?:\s+as)?|saving|export|exporting|render|rendering|print|printing|download|downloading|upload|uploading|open file|rename|replace|overwrite|png|jpe?g|pdf|mp4|wav|csv|xlsx?|docx?)\b/.test(text)) {
    return 'file_open_save_export';
  }
  if (/\b(?:pause|play|resume|mute|unmute)\b/.test(text)) {
    return 'toggle_or_select';
  }
  if (/\b(?:disconnect|maximize|minimize|stop)\b/.test(text)) {
    return 'menu_or_shortcut';
  }
  if (/\b(canvas|image|photo|video|audio|recording|timeline|track|clip|layer|mask|draw|design|paint|crop|retouch|animate|render|model|drum loop)\b/.test(text)) {
    return 'canvas_or_visual_edit';
  }
  if (/\b(fill|enter|type|paste|set|update|write|put)\b/.test(text) && /\b(field|form|text box|input|name|title|description|prompt|search|project)\b/.test(text)) {
    return 'field_or_form_entry';
  }
  if (/\b(dialog|modal|pop-?up|confirmation|permission prompt|alert)\b/.test(text) && /\b(handle|accept|allow|deny|dismiss|close|cancel|confirm|respond|choose|select)\b/.test(text)) {
    return 'dialog_handling';
  }
  if (
    /\b(toggle|enable|disable|turn on|turn off|check|uncheck|dropdown|checkbox|radio|mute|unmute|pause|play|resume|show|hide|lock|unlock)\b/.test(text)
    || (/\b(select|choose|pick)\b/.test(text) && !/\bmenu\b/.test(text))
  ) {
    return 'toggle_or_select';
  }
  if (/\b(click|select|choose|menu|toolbar|preferences?|settings?|shortcut|press|tab|button|dropdown|checkbox|radio|disconnect|maximize|minimize)\b/.test(text)) {
    return 'menu_or_shortcut';
  }
  if (
    /\b(open|launch|focus|switch to|inspect|read|summarize|look at|show)\b/.test(text)
    && !/\b(create|make|build|add|insert|edit|change|update|set|fill|enter|write|put|click|select|choose|type|paste|press|run|start|stop|disconnect|maximize|minimize|pause|play|resume|record|configure|apply|rename|move|convert|sync|synchronize|delete|remove|save|export|upload|send|submit|publish|purchase|buy|pay|unmute)\b/.test(text)
  ) {
    return 'launch_or_read';
  }
  return 'unknown_mutation';
}

export function formatGenericAppTaskFamilyForUser(
  family: GenericAppNavigatorTaskFamily | string | null | undefined,
): string {
  switch (family) {
    case 'launch_or_read':
      return 'app inspection';
    case 'field_or_form_entry':
      return 'field/form entry';
    case 'menu_or_shortcut':
      return 'menu or shortcut control';
    case 'toggle_or_select':
      return 'toggle or selection control';
    case 'file_open_save_export':
      return 'file/save/export work';
    case 'canvas_or_visual_edit':
      return 'visual/canvas work';
    case 'dialog_handling':
      return 'dialog handling';
    case 'unknown_mutation':
      return 'app change';
    default:
      return compactWhitespace(String(family || '').replace(/[_-]+/g, ' '));
  }
}

const MAX_GENERIC_APP_WORKFLOW_CHECKPOINTS = 10;

type GenericAppNavigatorWorkflowCheckpointTemplate = Omit<GenericAppNavigatorWorkflowCheckpoint, 'ordinal'>;

function checkpointTemplate(
  id: GenericAppNavigatorWorkflowGoalKind,
  goal: string,
  observeBefore: string[],
  allowedSemanticSurfaces: GenericAppNavigatorSemanticSurface[],
  mutationClass: GenericAppNavigatorMutationClass,
  approvalClass: GenericAppNavigatorApprovalClass,
  expectedPostcondition: string,
  buildoutOrStopRule: string,
): GenericAppNavigatorWorkflowCheckpointTemplate {
  return {
    id,
    goal,
    observeBefore,
    allowedSemanticSurfaces,
    mutationClass,
    approvalClass,
    expectedPostcondition,
    buildoutOrStopRule,
  };
}

/**
 * Converts the intact user request into a small semantic program. The program
 * names goals and proof, never guessed labels, selectors, menu paths, or
 * coordinates. Execution still goes through the canonical computer runtime.
 */
export function buildGenericAppSemanticWorkflow(task: string): GenericAppNavigatorSemanticWorkflow {
  const originalRequest = String(task ?? '');
  const text = compactWhitespace(originalRequest).toLowerCase();
  const readOnlyObservation = isReadOnlyGenericAppObservation(text);
  const destructiveOrSensitive = /\b(?:delete|remove|erase|wipe|reset|overwrite|replace existing|purchase|buy|pay|password|passcode|credential|api key|secret|mfa|two-factor|admin|permission|log\s+in(?:to)?|login|sign\s+in(?:to)?|authenticate|authorize|grant access|oauth)\b/.test(text);
  const requestsFileOpen = (
    /\b(?:open|import|load|place|attach)\b(?:(?!\b(?:and|then|to|before|after)\b)[\s\S]){0,80}\b(?:file|document|project|workspace|image|photo|video|audio|drawing|model|spreadsheet|presentation|pdf|csv|png|jpe?g|psd|mp4|wav|xlsx?|docx?)\b/.test(text)
    || /\b(?:open|import|load|place|attach)\b(?:(?!\b(?:and|then|to|before|after)\b)[\s\S]){0,100}\.[a-z0-9]{2,8}\b/.test(text)
  );
  const requestsFieldEntry = (
    /\b(?:fill|enter|type|paste)\b/.test(text)
    || (/\b(?:set|update|write|put|replace|search|find)\b/.test(text)
      && /\b(?:field|form|text|input|name|title|description|query|prompt|value|cell|note|message|caption)\b/.test(text))
  );
  const requestsMenuOrShortcut = /\b(?:menu|shortcut|hotkey|command palette|toolbar|preferences?|settings?|press|keystroke|tab|panel|button|disconnect|maximize|minimize|stop)\b/.test(text);
  const requestsToggleOrSelection = (
    /\b(?:toggle|enable|disable|turn on|turn off|check|uncheck|checkbox|radio|mute|unmute|pause|play|resume|hide|lock|unlock)\b/.test(text)
    || (!readOnlyObservation && /\bshow\b/.test(text))
    || (/\b(?:select|choose|pick)\b/.test(text) && !/\bmenu\b/.test(text))
  );
  const requestsCanvasOrTimelineEdit = (
    /\b(?:canvas|timeline|track|clip|layer|mask|selection|frame|slide|page|image|photo|video|audio|recording|drawing|model|geometry|scene|animation|drum loop|spreadsheet|cell range)\b/.test(text)
    && /\b(?:create|make|add|insert|edit|change|update|start|stop|record|draw|design|paint|crop|retouch|trim|cut|split|merge|move|resize|rotate|adjust|mute|unmute|animate|model|format|apply|generate|render|delete|remove|erase|wipe)\b/.test(text)
  );
  const requestsSaveOrExport = /\b(?:save(?:\s+as)?|export|render|print|download|encode|overwrite|write to disk|create (?:a )?(?:pdf|png|jpe?g|mp4|wav|csv|xlsx?|docx?))\b/.test(text);
  const requestsExternalCommit = /\b(?:upload|send|email|submit|publish|post|share|invite|purchase|buy|pay|book|schedule|sign|log\s+in(?:to)?|login|sign\s+in(?:to)?|authenticate|authorize|grant|connect|link|oauth)\b/.test(text);
  const requestsDialogHandling = (
    /\b(?:dialog|modal|pop-?up|confirmation|permission prompt|alert)\b/.test(text)
    && /\b(?:handle|accept|allow|deny|dismiss|close|cancel|confirm|respond|choose|select)\b/.test(text)
  );

  const requested: GenericAppNavigatorWorkflowCheckpointTemplate[] = [];
  const add = (checkpoint: GenericAppNavigatorWorkflowCheckpointTemplate): void => {
    if (!requested.some((existing) => existing.id === checkpoint.id)) requested.push(checkpoint);
  };

  add(checkpointTemplate(
    'launch_and_inspect',
    'Launch or focus the requested app only if needed, then inspect its current app, window, document, and blocking-dialog state.',
    ['running-app inventory', 'fresh target process and window identity', 'visible document/project identity when one exists', 'blocking modal or permission state'],
    ['existing_app_adapter', 'app_lifecycle', 'app_native_api_or_script', 'os_accessibility'],
    'app_lifecycle_change',
    'none',
    'The intended app is frontmost and its current actionable state is freshly observed; launch/focus/wait does not create an approval prompt.',
    'Stop for install, license, login, OS permission, or ambiguous app identity; do not substitute or foreground a browser for a desktop-app request.',
  ));

  if (requestsFileOpen) {
    add(checkpointTemplate(
      'open_requested_file',
      'Resolve and open the requested source through a file-aware or app-native semantic surface.',
      ['exact source identity and type', 'read permission or file grant', 'current active document/project', 'duplicate or already-open state'],
      ['existing_app_adapter', 'documented_file_adapter', 'app_native_api_or_script', 'semantic_menu', 'os_accessibility'],
      'local_file_access',
      'none',
      'The app reports the intended source as the active document/project without changing the source contents.',
      'Stop for a missing or ambiguous source or missing file permission (permission grants keep their own exact floor); build a narrow open/import adapter if semantic file targeting cannot be proven.',
    ));
  }

  if (requestsFieldEntry) {
    add(checkpointTemplate(
      'enter_requested_values',
      'Enter all requested non-secret values into uniquely observed editable controls without committing an external action.',
      ['fresh focused app/window identity', 'unique editable-control identity from native, embedded semantic, or accessibility state', 'current control value/state', 'absence of a blocking dialog'],
      ['existing_app_adapter', 'app_native_api_or_script', 'embedded_app_dom_or_cdp', 'os_accessibility'],
      destructiveOrSensitive ? 'destructive_or_sensitive' : 'reversible_input',
      destructiveOrSensitive ? 'approval_before_persistent_or_external' : 'shared_workflow_review',
      'Each requested value is present in its intended editable control and no submit, send, save, or publish action has fired.',
      'After two fresh observations without one unique editable target, stop and build the missing semantic field adapter; never guess a label or type into a coordinate.',
    ));
  }

  if (requestsMenuOrShortcut) {
    add(checkpointTemplate(
      'invoke_menu_or_shortcut',
      'Invoke the requested command through an observed semantic command or a documented shortcut bound to the verified target context.',
      ['fresh focused app/window identity', 'observed menu or command inventory', 'documented shortcut binding when a shortcut is proposed', 'command enabled/actionable state'],
      ['existing_app_adapter', 'app_native_api_or_script', 'semantic_menu', 'verified_keyboard_shortcut', 'os_accessibility'],
      destructiveOrSensitive ? 'destructive_or_sensitive' : 'app_or_document_mutation',
      destructiveOrSensitive ? 'approval_before_persistent_or_external' : 'shared_workflow_review',
      'The app exposes the expected semantic state change or command receipt in the same verified window/document.',
      'If the command is not observed or documented, research or build the command adapter and stop; do not invent a menu label, path, or shortcut.',
    ));
  }

  if (requestsToggleOrSelection) {
    add(checkpointTemplate(
      'set_toggle_or_selection',
      'Set the requested toggle, option, or selection through one uniquely identified semantic control.',
      ['fresh focused app/window identity', 'unique control identity and control kind', 'current selected/checked/value state', 'enabled/actionable state'],
      ['existing_app_adapter', 'app_native_api_or_script', 'embedded_app_dom_or_cdp', 'os_accessibility', 'semantic_menu'],
      destructiveOrSensitive ? 'destructive_or_sensitive' : 'reversible_input',
      destructiveOrSensitive ? 'approval_before_persistent_or_external' : 'shared_workflow_review',
      'The same semantic control reports the requested selected, checked, enabled, disabled, or chosen state.',
      'If more than one control matches or after-state cannot be read, refresh once and then stop for buildout or the smallest user choice; never choose by screen position.',
    ));
  }

  if (requestsCanvasOrTimelineEdit) {
    add(checkpointTemplate(
      'edit_canvas_or_timeline',
      'Apply the requested canvas, timeline, layer, model, drawing, media, or structured-document edit through an app-native semantic operation.',
      ['fresh active document/project identity', 'app-native object, layer, selection, track, scene, or document inventory appropriate to the task', 'target object identity and current state', 'undo/rollback and proof capability'],
      ['existing_app_adapter', 'app_native_api_or_script', 'documented_file_adapter', 'os_accessibility'],
      destructiveOrSensitive ? 'destructive_or_sensitive' : 'app_or_document_mutation',
      destructiveOrSensitive ? 'approval_before_persistent_or_external' : 'approval_before_mutation',
      'A refreshed app-native inventory identifies the changed entities and matches the requested edit without unexpected changes.',
      'If no app-native or uniquely semantic operation can express and verify the edit, stop and build a bounded app capability; visual evidence alone does not authorize guessed coordinates.',
    ));
  }

  if (requestsSaveOrExport) {
    add(checkpointTemplate(
      'save_or_export',
      'Save or export only the requested artifact, format, and destination through a deterministic app or file surface.',
      ['fresh active document/project identity', 'requested output kind and destination', 'existing-target conflict or overwrite state', 'current exact approval and app readiness'],
      ['existing_app_adapter', 'app_native_api_or_script', 'documented_file_adapter', 'semantic_menu', 'os_accessibility'],
      destructiveOrSensitive ? 'destructive_or_sensitive' : 'persistent_file_write',
      'approval_before_persistent_or_external',
      'The requested output exists with fresh file metadata or an app-native export receipt and the active source remains correctly identified.',
      'Stop before overwrite, format substitution, an ambiguous destination, or an unverified save dialog; build an app-specific save/export adapter when deterministic proof is unavailable.',
    ));
  }

  if (requestsExternalCommit) {
    add(checkpointTemplate(
      'commit_external_action',
      'Perform the requested external, account, submission, sharing, transaction, or destructive commit exactly once.',
      ['fresh authenticated app/account context', 'exact destination, recipient, target, or transaction scope', 'final payload/selection summary', 'current exact approval and duplicate-action evidence'],
      ['existing_app_adapter', 'app_native_api_or_script', 'embedded_app_dom_or_cdp', 'os_accessibility', 'semantic_menu'],
      destructiveOrSensitive ? 'destructive_or_sensitive' : 'external_side_effect',
      'approval_before_persistent_or_external',
      'An independent app-native or semantic receipt proves the exact external action and target completed once.',
      'Stop for credentials, MFA, CAPTCHA, permission, payment ambiguity, target drift, or missing independent proof; after dispatch uncertainty, verify only and never replay automatically.',
    ));
  }

  if (requestsDialogHandling) {
    add(checkpointTemplate(
      'handle_dialog',
      'Read and classify the observed dialog, then choose only an option that is explicit in the request and safe in the current workflow.',
      ['fresh dialog identity within the target app/window', 'complete visible prompt meaning', 'available semantic actions and default action', 'side effects of each relevant choice'],
      ['existing_app_adapter', 'app_native_api_or_script', 'embedded_app_dom_or_cdp', 'os_accessibility'],
      destructiveOrSensitive ? 'destructive_or_sensitive' : 'app_or_document_mutation',
      destructiveOrSensitive ? 'approval_before_persistent_or_external' : 'user_choice_if_ambiguous',
      'The dialog is resolved through a semantic action and the underlying app returns to the expected verified state.',
      'Stop for destructive, credential, permission, license, ambiguous, or unrecognized prompts; never accept a default merely to continue.',
    ));
  }

  const hasRequestedAction = requested.some((checkpoint) => checkpoint.id !== 'launch_and_inspect');
  const asksForMutation = /\b(?:create|make|build|add|insert|edit|change|update|set|fill|enter|write|put|click|select|choose|type|paste|press|run|start|stop|disconnect|maximize|minimize|pause|play|resume|unmute|record|configure|apply|rename|move|convert|sync|synchronize|delete|remove|erase|wipe|reset|overwrite)\b/.test(text);
  if (!hasRequestedAction && asksForMutation) {
    add(checkpointTemplate(
      'perform_requested_semantic_action',
      'Perform the remaining requested app action through one observed or officially documented semantic capability.',
      ['fresh focused app/window/document identity', 'one unique semantic target or app-native operation', 'current target state', 'expected reversible or persistent effect'],
      ['existing_app_adapter', 'app_native_api_or_script', 'embedded_app_dom_or_cdp', 'os_accessibility', 'semantic_menu', 'verified_keyboard_shortcut'],
      destructiveOrSensitive ? 'destructive_or_sensitive' : 'app_or_document_mutation',
      destructiveOrSensitive ? 'approval_before_persistent_or_external' : 'approval_before_mutation',
      'Fresh semantic or app-native state proves the remaining clause of the original request was completed.',
      'If the action cannot be represented by one unique semantic target or documented operation, stop and build a narrow capability from the intact request instead of improvising UI details.',
    ));
  }

  const verification = checkpointTemplate(
    'verify_requested_result',
    'Verify every clause of the original request against fresh app-native, semantic, and file evidence before reporting completion.',
    ['fresh app/window/document identity after the last action', 'after-state for every prior checkpoint', 'file metadata or external receipt when applicable', 'unexpected dialog, error, or target drift'],
    ['existing_app_adapter', 'app_native_api_or_script', 'documented_file_adapter', 'embedded_app_dom_or_cdp', 'os_accessibility'],
    'observation_only',
    'none',
    'Every requested clause has independent after-state evidence; incomplete or uncertain mutations remain non-complete.',
    'When proof is missing, stop with the exact missing evidence and allow only fresh read-only verification; never replay an uncertain mutation.',
  );

  const roomBeforeVerification = MAX_GENERIC_APP_WORKFLOW_CHECKPOINTS - 1;
  const wasCapped = requested.length > roomBeforeVerification;
  const boundedRequested = requested.slice(0, roomBeforeVerification);
  const checkpoints = [...boundedRequested, verification].map((checkpoint, index) => ({
    ...checkpoint,
    ordinal: index + 1,
  }));
  const sharedReviewCheckpointIds = checkpoints
    .filter((checkpoint) => checkpoint.approvalClass === 'shared_workflow_review')
    .map((checkpoint) => checkpoint.id);
  const exactApprovalCheckpointIds = checkpoints
    .filter((checkpoint) => checkpoint.approvalClass !== 'none' && checkpoint.approvalClass !== 'shared_workflow_review')
    .map((checkpoint) => checkpoint.id);

  return {
    schemaVersion: 1,
    originalRequest,
    maxCheckpoints: MAX_GENERIC_APP_WORKFLOW_CHECKPOINTS,
    wasCapped,
    checkpoints,
    approvalScope: {
      mode: 'single_bounded_workflow_review',
      sharedReviewCheckpointIds,
      exactApprovalCheckpointIds,
    },
    completionRule: 'Complete only when every clause in originalRequest has fresh target-bound after-state evidence; a capped workflow must stop for a newly decomposed continuation before any omitted action.',
    stopRule: 'Stop on target ambiguity, missing permission or approval, unavailable capability, unclassified dialog, target drift, or uncertain post-dispatch outcome; never guess UI labels or coordinates and never replay an uncertain mutation.',
  };
}

function buildoutTriggersFor(task: string, family: GenericAppNavigatorTaskFamily): string[] {
  const text = String(task || '').toLowerCase();
  const triggers = [
    'no existing app recipe, adapter, bridge tool, or documented control path can identify the target app and safe action',
    'the same semantic target is missing, stale, or ambiguous after two fresh observations',
    'the task needs a script/plugin/API surface and the runtime has not implemented it yet',
  ];
  if (family === 'file_open_save_export' || /\b(export|render|save|replace|overwrite|convert|batch)\b/.test(text)) {
    triggers.push('app-specific save/export/render behavior is required before reliable completion');
  }
  if (family === 'canvas_or_visual_edit' || /\b(canvas|timeline|layer|model|geometry|audio|video|animation|drum loop|render|simulation)\b/.test(text)) {
    triggers.push('visual canvas/timeline/model operations cannot be verified through accessible controls alone');
  }
  if (/\b(custom|macro|script|plugin|extension|api|automation)\b/.test(text)) {
    triggers.push('a new macro/script/plugin/API bridge would be needed and must be built with approval plus smoke coverage');
  }
  return Array.from(new Set(triggers));
}

export function shouldUseGenericAppNavigator(task: string): boolean {
  const text = String(task || '');
  if (/\b(?:unfamiliar|not familiar|not configured|without previous configuration|any app|all apps|unknown app|missing pipeline|missing adapter|build what is needed)\b/i.test(text)) {
    return true;
  }
  const inferred = inferGenericAppName(text);
  // Known-configured apps AND AppleScript-scriptable apps (Notes, Reminders,
  // Calendar, …) have a deterministic native control surface, so they must
  // NOT be routed through the unfamiliar-app / buildout path — that's what
  // made "create a note" stall on "unknown app -> needs buildout".
  if (!inferred || isKnownConfiguredAppName(inferred) || isScriptableMacApp(inferred)) return false;
  return /\b(?:open|launch|focus|switch to|use|control|drive|automate|take over|inspect|read|summarize|report|look at|show|find|search|list|click|select|choose|type|paste|press|fill|enter|write|put|set|toggle|enable|disable|mute|unmute|disconnect|maximize|minimize|pause|play|resume|create|make|build|add|insert|edit|change|update|configure|apply|rename|move|resize|rotate|crop|trim|split|merge|retouch|draw|design|paint|animate|record|render|export|save|print|download|upload|send|email|submit|publish|post|share|invite|purchase|buy|pay|book|schedule|sign|delete|remove|erase|wipe|reset|convert|sync|synchronize|authenticate|authorize|grant|connect|link|login|log\s+in(?:to)?|sign\s+in(?:to)?|dismiss|confirm|run|start|stop)\b/i.test(text);
}

export function shouldUseProfessionalAppAutonomy(task: string): boolean {
  const text = String(task || '');
  if (!text.trim()) return false;
  if (/\b(?:any app|all apps|whatever app|no matter what app|doesn'?t matter what app|figure out (?:how|by itself)|use the app like a professional)\b/i.test(text)) {
    return true;
  }
  if (shouldUseGenericAppNavigator(text)) return true;
  const inferred = inferGenericAppName(text);
  const asksToOpenOrDrive = /\b(?:open|launch|focus|switch to|use|control|drive|automate|take over)\b/i.test(text);
  const asksForAppAction = /\b(?:inspect|read|summarize|report|look at|show|find|search|list|add|create|make|build|insert|edit|change|update|set|fill|enter|write|put|click|select|choose|type|paste|press|run|start|stop|disconnect|maximize|minimize|pause|play|resume|record|configure|apply|rename|move|resize|rotate|crop|trim|split|merge|retouch|draw|design|paint|animate|toggle|enable|disable|mute|unmute|export|save|render|print|download|upload|send|email|submit|publish|post|share|invite|purchase|buy|pay|book|schedule|sign|delete|remove|erase|wipe|reset|convert|sync|synchronize|authenticate|authorize|grant|connect|link|login|log\s+in(?:to)?|sign\s+in(?:to)?|dismiss|confirm)\b/i.test(text);
  if (inferred && asksToOpenOrDrive && asksForAppAction) return true;
  return (
    /\b(?:open|launch|focus|switch to|use|control|drive|automate|take over)\b[\s\S]{0,90}\b(?:app|application|window|program)\b/i.test(text) ||
    /\b(?:desktop app|native app|mac app|application)\b[\s\S]{0,120}\b(?:create|make|edit|update|export|save|click|type|paste|press|fill|run|do)\b/i.test(text)
  );
}

export function buildGenericAppNavigatorPlan(
  task: string,
  options: { targetAppName?: string | null } = {},
): GenericAppNavigatorPlan {
  const originalRequest = String(task ?? '');
  const preferredApp = cleanAppNameCandidate(options.targetAppName || '', { trusted: true });
  const inferredApp = (
    preferredApp && !isGenericFallbackAppName(preferredApp)
      ? preferredApp
      : inferGenericAppName(originalRequest)
  ) || 'Unfamiliar desktop app';
  const taskFamily = classifyGenericAppTaskFamily(originalRequest);
  const semanticWorkflow = buildGenericAppSemanticWorkflow(originalRequest);
  return {
    originalRequest,
    targetAppName: inferredApp,
    taskFamily,
    canNavigateWithoutAdapter: true,
    semanticWorkflow,
    userEffortPolicy: [
      'silently observe, launch/focus, read semantic state, and perform safe reversible setup without showing route internals',
      'do not ask approval for pure observation or explicit launch/focus/wait; group non-secret reversible field, menu, and toggle steps under one bounded workflow review instead of prompting per control',
      'ask the user only for approvals, ambiguous target choices, credentials, human verification, missing permissions, install/license blockers, or destructive output decisions',
      'show a concise done/proof message on success; expose technical route details only when the user asks or a blocker needs action',
    ],
    phases: [
      { id: 'identify_app', instruction: 'identify the target app, active window, requested file/project, output path, and task family' },
      { id: 'observe_window', instruction: 'collect fresh window state and screenshot only as evidence, not as the first mutation surface' },
      { id: 'inspect_semantic_tree', instruction: 'read the accessibility/control tree and menu inventory before click/type/menu actions' },
      { id: 'research_control_surface', instruction: 'if the app/operation is unfamiliar, research the official automation/control surface before guessing shortcuts, menus, or coordinates' },
      { id: 'plan_semantic_action', instruction: 'choose one unique named control, menu item, field, or shortcut with a verification signal' },
      { id: 'execute_bounded_step', instruction: 'execute one bounded semantic step, then immediately verify state before continuing' },
      { id: 'verify_or_buildout', instruction: 'if generic control cannot prove progress, hand off a bounded app-capability buildout instead of guessing' },
    ],
    observeFirst: [
      'desktop.list_running_apps or desktop.wait_for_app to confirm the target app is present',
      'desktop.window_state to confirm active app/window/document identity',
      'desktop.read_a11y_tree to list visible controls, fields, menus, dialogs, and values',
      'desktop.screenshot and desktop.screen_size only when the semantic tree is incomplete or the task is visual',
      'desktop.file_search/file_stat/open_path when the request names a local file or output destination',
    ],
    actionLadder: [
      'reuse an existing app-specific adapter, runbook, plugin, script, browser DOM/CDP route, or file-format operation when available',
      'search existing tool/recipe capability first, then research official vendor docs, app help, scripting dictionaries, command palettes, APIs, CLIs, URL schemes, plugins, or file formats before inventing an app-specific action',
      'for scriptable macOS apps, prefer desktop.run_applescript with built-in recipes or researched on-run-argv programs before UI clicking',
      'use OS accessibility tree controls for uniquely named buttons, fields, checkboxes, dialogs, and menu items',
      'use desktop.menu_click for stable menu paths and desktop.set_element_value for named editable fields before typing',
      'use desktop.press_keys only after focus and expected target context are verified',
      'call agent.build_app_capability with app name, task family, missing surface, official refs, desired tool, smoke, and retry contract when generic control is not enough',
      'perform one reversible visual coordinate step only after fresh screenshot, screen size, target bounds, and rollback/stop condition',
    ],
    approvalBoundaries: [
      'saving, exporting, replacing, overwriting, deleting, publishing, sending, buying, or uploading',
      'running new scripts, macros, plugins, extensions, generated code, or paid/generative actions',
      'credentialed/private workflows, human verification, MFA, CAPTCHA, payments, or account/admin changes',
      'destructive edits, irreversible canvas/model/timeline changes, or coordinate-based mutation',
    ],
    stopConditions: [
      'requested result is verified through app/window state, semantic tree, screenshot/proof, and file_stat when files changed',
      'target app, file, license, credential, permission, or human verification is unavailable',
      'no unique semantic target exists after two fresh observations',
      'task needs a missing app-specific adapter, script, plugin, API, recipe, or bridge tool',
      'approval is required before a side effect and has not been granted',
    ],
    recoveryRules: [
      'before mutation, use at most one request-authorized launch or focus dispatch and verify the exact target; if foreground ownership changes afterward, pause in verification-only mode and require an explicit resume with fresh evidence instead of refocusing or relaunching automatically',
      'if a dialog appears, read it with accessibility state, classify the safe/default action, and stop for user choice on destructive or ambiguous prompts',
      'if a semantic click/type fails once, refresh window state and a11y tree before retrying; after a second failure, delegate buildout or ask for the smallest user choice',
      'never escalate from missing semantic state directly into repeated coordinates; one bounded visual step is the maximum without new evidence',
      'after a connected agent adds a recipe/adapter/tool, retry only the failed step with fresh evidence',
    ],
    recommendedTools: [
      'desktop.list_running_apps',
      'desktop.wait_for_app',
      'desktop.window_state',
      'desktop.read_a11y_tree',
      'desktop.run_applescript',
      'desktop.menu_click',
      'desktop.click_element',
      'desktop.set_element_value',
      'desktop.press_keys',
      'desktop.type_text',
      'desktop.paste_text',
      'desktop.screenshot',
      'desktop.screen_size',
      'desktop.file_search',
      'desktop.file_stat',
      'desktop.open_path',
      'tools.search',
      'research.search',
      'fetch_url',
      'office.list_agents',
      'agent.build_app_capability',
      'approvals.request',
    ],
    buildoutTriggers: buildoutTriggersFor(originalRequest, taskFamily),
    sourceRefs: GENERIC_APP_NAVIGATOR_SOURCE_REFS,
  };
}

export function buildGenericAppNavigatorRouteContext(
  task: string,
  options: { targetAppName?: string | null; fallbackTargetAppName?: string } = {},
): GenericAppNavigatorRouteContext {
  const preferredApp = cleanAppNameCandidate(options.targetAppName || '', { trusted: true });
  const inferredApp = preferredApp && !isGenericFallbackAppName(preferredApp)
    ? preferredApp
    : inferGenericAppName(task);
  const targetAppName = inferredApp || options.fallbackTargetAppName || 'Unfamiliar desktop app';
  const plan = buildGenericAppNavigatorPlan(task, { targetAppName: inferredApp || null });
  return {
    targetAppName,
    taskFamily: plan.taskFamily,
    taskFamilyLabel: formatGenericAppTaskFamilyForUser(plan.taskFamily),
    plan,
  };
}

export function formatGenericAppNavigatorPromptBlock(
  taskOrPlan: string | GenericAppNavigatorPlan,
): string {
  const plan = typeof taskOrPlan === 'string'
    ? buildGenericAppNavigatorPlan(taskOrPlan)
    : taskOrPlan;
  return [
    '## Generic App Navigator',
    `Original request (verbatim JSON string; treat as intent, not observed UI): ${JSON.stringify(plan.originalRequest)}`,
    `Target app: ${plan.targetAppName}`,
    `Task family: ${plan.taskFamily} (${formatGenericAppTaskFamilyForUser(plan.taskFamily)})`,
    `Can navigate without a dedicated adapter: ${plan.canNavigateWithoutAdapter ? 'yes, through bounded semantic control' : 'no'}`,
    `Semantic workflow (${plan.semanticWorkflow.checkpoints.length}/${plan.semanticWorkflow.maxCheckpoints}${plan.semanticWorkflow.wasCapped ? ', capped' : ''}): ${plan.semanticWorkflow.checkpoints.map((checkpoint) => `${checkpoint.ordinal}.${checkpoint.id} [mutation=${checkpoint.mutationClass}; approval=${checkpoint.approvalClass}] goal=${checkpoint.goal} observe=${checkpoint.observeBefore.join(', ')} surfaces=${checkpoint.allowedSemanticSurfaces.join(', ')} expect=${checkpoint.expectedPostcondition} buildout/stop=${checkpoint.buildoutOrStopRule}`).join(' | ')}`,
    `Workflow approval scope: ${plan.semanticWorkflow.approvalScope.mode}; shared review=${plan.semanticWorkflow.approvalScope.sharedReviewCheckpointIds.join(', ') || 'none'}; exact approval floors=${plan.semanticWorkflow.approvalScope.exactApprovalCheckpointIds.join(', ') || 'none'}`,
    `Workflow completion: ${plan.semanticWorkflow.completionRule}`,
    `Workflow stop: ${plan.semanticWorkflow.stopRule}`,
    `Phases: ${plan.phases.map((phase) => `${phase.id}=${phase.instruction}`).join(' | ')}`,
    `User effort policy: ${plan.userEffortPolicy.join(' | ')}`,
    `Observe first: ${plan.observeFirst.join(' | ')}`,
    `Action ladder: ${plan.actionLadder.join(' | ')}`,
    `Approval boundaries: ${plan.approvalBoundaries.join(' | ')}`,
    `Recovery: ${plan.recoveryRules.join(' | ')}`,
    `Stop conditions: ${plan.stopConditions.join(' | ')}`,
    `Buildout triggers: ${plan.buildoutTriggers.join(' | ')}`,
    `Recommended tools: ${plan.recommendedTools.join(' | ')}`,
    `Source refs: ${plan.sourceRefs.map((ref) => `${ref.label} (${ref.lastReviewedAt}) <${ref.url}>`).join(' | ')}`,
    'Visibility rule: hide internal route, picker, adapter, recovery, and status details on success; show only Done plus proof unless the user asks for diagnostics.',
    'Execution rule: take one bounded semantic step at a time, verify after each step, and call agent.build_app_capability instead of guessing when app-specific capability is missing.',
  ].join('\n');
}

export function formatProfessionalAppAutonomyPromptBlock(task: string): string | null {
  if (!shouldUseProfessionalAppAutonomy(task)) return null;
  const context = buildGenericAppNavigatorRouteContext(task);
  const plan = context.plan;
  const target = plan.targetAppName;
  const knownStatus = isScriptableMacApp(target)
    ? 'scriptable macOS app'
    : isKnownConfiguredAppName(target)
      ? 'known configured app'
      : 'unfamiliar or long-tail app';

  return [
    '## Professional App Autonomy',
    `Target: ${target} (${knownStatus}); task family: ${context.taskFamilyLabel}`,
    'Operating contract: do not make the user teach the app. Open or focus the app, observe real state, research the control surface when unfamiliar, act through the strongest deterministic surface, and verify proof.',
    'Open/focus first: use desktop.launch_app or desktop.focus_app, then desktop.wait_for_app and desktop.window_state before typing, clicking, or pressing shortcuts.',
    'Research-first rule: before an app-specific mutation, search existing tools/recipes, inspect app menus/help/command palettes, and use official vendor/platform docs via research.search or fetch_url when the control surface is not already known.',
    'Control-surface order: app-native API/script/plugin/CLI/file-format operation -> browser DOM/CDP for web/Electron apps -> OS accessibility/menu/field controls -> one bounded screenshot/coordinate step only after fresh evidence.',
    'Scriptable Mac rule: for Notes, Reminders, Calendar, Mail, Music, Finder, Messages, Safari, TextEdit, or any researched AppleScript-capable app, prefer desktop.run_applescript with user content in args, not inline script text.',
    'Professional execution rule: take one bounded step, verify state, then continue; never chain blind actions from memory, screenshots, or guessed shortcuts.',
    'Buildout rule: if the task needs a missing adapter/recipe/bridge tool or a reusable professional workflow, call agent.build_app_capability with app name, task, researched control surface, source refs, required evidence, and smoke cases, then retry only after fresh observation.',
    `Recommended tools: ${plan.recommendedTools.join(' | ')}`,
    `Proof: ${plan.stopConditions.join(' | ')}`,
  ].join('\n');
}
