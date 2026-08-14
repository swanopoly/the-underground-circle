/**
 * approvalEffectPolicyCore — dependency-free approval effect taxonomy.
 *
 * This is the canonical vocabulary shared by request policy, per-tool policy,
 * sticky grants, category auto-approval, and approval-card batching. An effect
 * is either provably non-interrupting (`observe`, lifecycle, or reversible
 * non-secret input) or an exact human-consent boundary. Unknown and ambiguous
 * effects are exact by design; callers must positively identify a safe effect
 * before a standing/category grant may waive a prompt.
 *
 * This module grants no authority and executes nothing. Every classifier is
 * pure, deterministic, bounded, total, and fail-closed.
 */

export const APPROVAL_EFFECTS = Object.freeze([
  'observe',
  'launch',
  'focus',
  'reversible_non_secret',
  'persistent_write',
  'credential',
  'login',
  'payment',
  'purchase',
  'checkout',
  'publish',
  'send',
  'post',
  'external_communication',
  'delete',
  'trash',
  'overwrite',
  'destructive',
  'permission',
  'security',
  'private_file',
  'ambiguous',
  'unknown',
] as const);

export type ApprovalEffect = (typeof APPROVAL_EFFECTS)[number];

/**
 * Closed, non-waivable approval floor. These effects need exact authority and
 * can never be covered by a broad category auto-setting, sticky scope, or
 * low/medium approval-card batch.
 */
export const ALWAYS_EXACT_APPROVAL_EFFECTS = Object.freeze([
  'persistent_write',
  'credential',
  'login',
  'payment',
  'purchase',
  'checkout',
  'publish',
  'send',
  'post',
  'external_communication',
  'delete',
  'trash',
  'overwrite',
  'destructive',
  'permission',
  'security',
  'private_file',
  'ambiguous',
  'unknown',
] as const satisfies readonly ApprovalEffect[]);

export type AlwaysExactApprovalEffect = (typeof ALWAYS_EXACT_APPROVAL_EFFECTS)[number];

/** Effects a category-level preference may cover without exact per-outcome authority. */
export const CATEGORY_AUTO_ELIGIBLE_APPROVAL_EFFECTS = Object.freeze([
  'observe',
  'launch',
  'focus',
  'reversible_non_secret',
] as const satisfies readonly ApprovalEffect[]);

export type CategoryAutoEligibleApprovalEffect =
  (typeof CATEGORY_AUTO_ELIGIBLE_APPROVAL_EFFECTS)[number];

const EFFECT_SET: ReadonlySet<string> = new Set<string>(APPROVAL_EFFECTS);
const ALWAYS_EXACT_SET: ReadonlySet<string> = new Set<string>(ALWAYS_EXACT_APPROVAL_EFFECTS);
const CATEGORY_AUTO_SET: ReadonlySet<string> = new Set<string>(CATEGORY_AUTO_ELIGIBLE_APPROVAL_EFFECTS);

const MAX_TEXT_CHARS = 240;
const MAX_COLLECTION_VALUES = 32;
const MAX_DEPTH = 3;

function normalizeText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .slice(0, MAX_TEXT_CHARS)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
}

function hasPhrase(normalized: string, ...phrases: string[]): boolean {
  if (!normalized) return false;
  const padded = `_${normalized}_`;
  return phrases.some((phrase) => padded.includes(`_${phrase}_`));
}

function hasPositiveSignal(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === 'string') return value.trim().length > 0 && value.trim().toLowerCase() !== 'false';
  if (typeof value === 'number') return Number.isFinite(value) && value !== 0;
  if (typeof value === 'bigint') return value !== BigInt(0);
  return false;
}

function classifyText(normalized: string): ApprovalEffect {
  if (!normalized) return 'unknown';
  if (EFFECT_SET.has(normalized)) return normalized as ApprovalEffect;

  // Exact effects come first so `read_private_file` never collapses to read,
  // and `fill_credential_field` never collapses to reversible input.
  if (hasPhrase(normalized, 'credential', 'credentials', 'password', 'passcode', 'one_time_password', 'otp', 'mfa', 'two_factor')) {
    return 'credential';
  }
  if (hasPhrase(normalized, 'login', 'log_in', 'logging_in', 'sign_in', 'signin', 'authenticate', 'authentication')) {
    return 'login';
  }
  if (hasPhrase(normalized, 'payment', 'payments', 'pay', 'paying', 'paywall', 'charge', 'charging', 'billing', 'refund', 'spending', 'cost_threshold')) {
    return 'payment';
  }
  if (hasPhrase(normalized, 'purchase', 'purchasing', 'buy', 'buying', 'place_order')) return 'purchase';
  if (hasPhrase(normalized, 'checkout', 'check_out')) return 'checkout';
  if (hasPhrase(normalized, 'publish', 'publishing', 'published', 'go_live')) return 'publish';

  // Desktop `send_keys` means reversible keyboard input, not communication.
  const sendsKeys = hasPhrase(normalized, 'send_key', 'send_keys', 'send_keystroke', 'send_keystrokes');
  if (!sendsKeys && hasPhrase(normalized, 'send', 'sending', 'send_email', 'email_send', 'send_message', 'message_send', 'send_mail', 'mail_send')) {
    return 'send';
  }
  if (hasPhrase(normalized, 'post', 'posting', 'posted', 'post_message', 'social_post', 'http_post')) return 'post';
  if (hasPhrase(
    normalized,
    'external_communication',
    'external_send',
    'external_publish',
    'external_side_effect',
    'submit',
    'submitting',
    'invite',
    'inviting',
    'share',
    'sharing',
  )) return 'external_communication';

  if (hasPhrase(normalized, 'delete', 'deleting', 'deleted', 'deletion')) return 'delete';
  if (hasPhrase(normalized, 'trash', 'trashing', 'trashed', 'move_to_trash')) return 'trash';
  if (hasPhrase(normalized, 'overwrite', 'overwriting', 'overwritten', 'replace_original')) return 'overwrite';
  if (hasPhrase(normalized, 'destructive', 'irreversible', 'destroy', 'destroying', 'wipe', 'wiping', 'erase', 'erasing', 'drop_table', 'permanently_remove')) {
    return 'destructive';
  }
  if (hasPhrase(normalized, 'permission', 'permissions', 'authorize', 'authorization', 'oauth', 'consent', 'grant', 'grant_access', 'connect_account', 'link_account')) {
    return 'permission';
  }
  if (hasPhrase(normalized, 'security', 'privileged', 'privilege', 'admin', 'sudo', 'entitlement', 'keychain')) return 'security';
  if (hasPhrase(
    normalized,
    'private_file',
    'local_file',
    'file',
    'files',
    'folder',
    'folders',
    'directory',
    'directories',
    'attachment',
    'attachments',
    'attach',
    'attaching',
    'upload',
    'uploading',
    'download',
    'downloading',
  )) return 'private_file';
  if (hasPhrase(
    normalized,
    'persistent_write',
    'durable_write',
    'memory_write',
    'skill_write',
    'automation_create',
    'write',
    'writing',
    'append',
    'appending',
    'save',
    'saving',
    'export',
    'exporting',
    'install',
    'installing',
    'uninstall',
    'uninstalling',
  )) return 'persistent_write';

  if (hasPhrase(
    normalized,
    'ambiguous',
    'browser_click',
    'browser_action',
    'desktop_action',
    'skill_run',
    'automation_run',
    'tool_use',
    'action',
    'click',
    'menu',
  )) return 'ambiguous';
  if (hasPhrase(normalized, 'unknown', 'mystery', 'unclassified', 'unspecified')) return 'unknown';

  if (hasPhrase(normalized, 'memory_read', 'observe', 'observation', 'inspect', 'inspection', 'snapshot', 'dom_snapshot', 'summarize', 'summary', 'search', 'read', 'list')) {
    return 'observe';
  }
  if (hasPhrase(normalized, 'launch', 'launch_app', 'open_app', 'start_app')) return 'launch';
  if (hasPhrase(normalized, 'focus', 'focus_app', 'activate_app')) return 'focus';
  if (sendsKeys || hasPhrase(
    normalized,
    'reversible',
    'reversible_non_secret',
    'non_secret_input',
    'set_element_value',
    'fill_field',
    'set_toggle',
    'select_option',
    'type_text',
    'press_key',
    'key_press',
  )) return 'reversible_non_secret';

  return 'unknown';
}

function effectStrength(effect: ApprovalEffect): number {
  switch (effect) {
    case 'destructive':
    case 'delete':
    case 'trash':
    case 'overwrite':
      return 8;
    case 'credential':
    case 'login':
    case 'permission':
    case 'security':
      return 7;
    case 'payment':
    case 'purchase':
    case 'checkout':
      return 6;
    case 'private_file':
      return 5;
    case 'publish':
    case 'send':
    case 'post':
    case 'external_communication':
      return 4;
    case 'persistent_write':
      return 3;
    case 'ambiguous':
      return 2;
    case 'unknown':
      return 1;
    default:
      return 0;
  }
}

function classifyMany(values: Iterable<unknown>, depth: number, seen: WeakSet<object>): ApprovalEffect {
  let best: ApprovalEffect | null = null;
  let count = 0;
  try {
    for (const value of values) {
      if (count++ >= MAX_COLLECTION_VALUES) break;
      if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) continue;
      const effect = classifyInternal(value, depth + 1, seen);
      if (!best || effectStrength(effect) > effectStrength(best)) best = effect;
    }
  } catch {
    return 'unknown';
  }
  return best || 'unknown';
}

function classifyRecord(value: object, depth: number, seen: WeakSet<object>): ApprovalEffect {
  if (seen.has(value) || depth >= MAX_DEPTH) return 'unknown';
  seen.add(value);
  try {
    const record = value as Record<string, unknown>;
    if (hasPositiveSignal(record.containsCredentials) || hasPositiveSignal(record.credentialEntry)) return 'credential';
    if (hasPositiveSignal(record.privateFile) || hasPositiveSignal(record.privateFileAuthority)) return 'private_file';
    if (hasPositiveSignal(record.externalSideEffect)) return 'external_communication';
    if (hasPositiveSignal(record.persistentWrite) || hasPositiveSignal(record.durableMutation) || hasPositiveSignal(record.mutatesState)) {
      return 'persistent_write';
    }
    const explicitSignal = typeof record.effect === 'string' && record.effect.trim()
      ? record.effect
      : record.effectClass;
    const explicit = typeof explicitSignal === 'string' && explicitSignal.trim()
      ? classifyInternal(explicitSignal, depth + 1, seen)
      : null;
    const inferred = classifyMany([
      record.category,
      record.actionType,
      record.actionTags,
      record.tool,
      record.toolName,
      record.kind,
    ], depth, seen);
    // A trusted semantic manifest may positively mark a generic adapter tool
    // (`desktop.click`) as reversible. That explicit safe class can refine only
    // ambiguous/unknown inference; any concrete exact signal still wins.
    if (
      explicit &&
      CATEGORY_AUTO_SET.has(explicit) &&
      (inferred === 'ambiguous' || inferred === 'unknown')
    ) return explicit;
    return explicit ? classifyMany([explicit, inferred], depth, seen) : inferred;
  } catch {
    return 'unknown';
  }
}

function classifyInternal(value: unknown, depth: number, seen: WeakSet<object>): ApprovalEffect {
  if (typeof value === 'string') return classifyText(normalizeText(value));
  if (depth >= MAX_DEPTH) return 'unknown';
  if (Array.isArray(value)) {
    if (seen.has(value)) return 'unknown';
    seen.add(value);
    return classifyMany(value, depth, seen);
  }
  if (value instanceof Set) {
    if (seen.has(value)) return 'unknown';
    seen.add(value);
    return classifyMany(value, depth, seen);
  }
  if (value && typeof value === 'object') return classifyRecord(value, depth, seen);
  return 'unknown';
}

/** Classify any bounded effect signal. Unknown or hostile input returns `unknown`. */
export function classifyApprovalEffect(value: unknown): ApprovalEffect {
  try {
    return classifyInternal(value, 0, new WeakSet<object>());
  } catch {
    return 'unknown';
  }
}

/** True when a signal sits on the non-waivable exact approval floor. */
export function requiresExactApproval(value: unknown): boolean {
  try {
    return ALWAYS_EXACT_SET.has(classifyApprovalEffect(value));
  } catch {
    return true;
  }
}

/**
 * Return the canonical exact boundary, or `null` only for a positively
 * classified observe/lifecycle/reversible-non-secret effect. This is the
 * workflow-authority seam: callers may plan-cover only the `null` branch. A
 * trusted manifest may pass `{ effect: 'reversible_non_secret', tool }`; the
 * explicit safe effect refines generic/unknown tools but never overrides a
 * concrete credential/external/destructive/private/permission marker.
 */
export function classifyAlwaysExactApprovalEffect(
  value: unknown,
): AlwaysExactApprovalEffect | null {
  try {
    const effect = classifyApprovalEffect(value);
    return ALWAYS_EXACT_SET.has(effect) ? effect as AlwaysExactApprovalEffect : null;
  } catch {
    return 'unknown';
  }
}

/**
 * True only for a positively identified safe effect. Unknown, ambiguous, and
 * every exact-floor effect return false.
 */
export function isApprovalCategoryAutoEligible(value: unknown): boolean {
  try {
    return CATEGORY_AUTO_SET.has(classifyApprovalEffect(value));
  } catch {
    return false;
  }
}

/**
 * Existing chat-computer router categories and their canonical effects. Every
 * currently persisted mutation category is an exact outcome, so none may be
 * placed in a sticky standing grant. Future reversible categories must be
 * added here explicitly before they become grantable.
 */
export const CHAT_COMPUTER_CATEGORY_EFFECT_POLICY = [
  ['submit', 'external_communication'],
  ['send', 'send'],
  ['publish', 'publish'],
  ['pay', 'payment'],
  ['delete', 'delete'],
  ['download', 'private_file'],
  ['upload', 'private_file'],
  ['save', 'persistent_write'],
  ['login', 'login'],
  ['grant', 'permission'],
] as const satisfies readonly (readonly [string, ApprovalEffect])[];

export type ChatComputerEffectCategory = (typeof CHAT_COMPUTER_CATEGORY_EFFECT_POLICY)[number][0];

export const CHAT_COMPUTER_ALWAYS_EXACT_CATEGORIES: readonly ChatComputerEffectCategory[] = Object.freeze(
  CHAT_COMPUTER_CATEGORY_EFFECT_POLICY
    .filter(([, effect]) => ALWAYS_EXACT_SET.has(effect))
    .map(([category]) => category),
);

export const CHAT_COMPUTER_STICKY_GRANTABLE_CATEGORIES: readonly ChatComputerEffectCategory[] = Object.freeze(
  CHAT_COMPUTER_CATEGORY_EFFECT_POLICY
    .filter(([, effect]) => CATEGORY_AUTO_SET.has(effect))
    .map(([category]) => category),
);

/**
 * Future runtime prompt-budget contract only. `runtimeIntegrated: false` is
 * explicit so this descriptor cannot be mistaken for active workflow
 * authority or telemetry enforcement.
 */
export const APPROVAL_PROMPT_BUDGET_POLICY = Object.freeze({
  schemaVersion: 1,
  unit: 'user_interruptions',
  observe: 0,
  boundedReversibleWorkflow: 1,
  distinctExactHardBoundaryOutcome: 1,
  runtimeIntegrated: false,
} as const);
