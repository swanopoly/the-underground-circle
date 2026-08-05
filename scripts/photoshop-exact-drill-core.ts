/**
 * Pure control core for the manual Photoshop 600x600 live drill.
 *
 * This module is deliberately Node-only and dependency-light. It imports the
 * canonical exact-program compiler, but it never imports computerTaskRuntime,
 * desktopBridge, React Native, Supabase, or a browser runtime. The caller must
 * provide a lazy transport factory; dry and refused modes never call it.
 */

import { createHash } from 'node:crypto';
import { compileComputerSequenceProgram } from '../src/lib/computerSequenceProgramCore';

export const PHOTOSHOP_EXACT_DRILL_TASK = 'Open Photoshop and start a new project 600 x 600';
export const PHOTOSHOP_EXACT_DRILL_CONFIRM_ENV = 'UC_PHOTOSHOP_DRILL_CONFIRM';
export const PHOTOSHOP_EXACT_DRILL_VERSION = 1;
export const PHOTOSHOP_EXACT_DRILL_WIDTH_PX = 600;
export const PHOTOSHOP_EXACT_DRILL_HEIGHT_PX = 600;
export const PHOTOSHOP_EXACT_DRILL_MAX_TRACE_ENTRIES = 32;
export const PHOTOSHOP_EXACT_DRILL_READY_ATTEMPTS = 4;
export const PHOTOSHOP_EXACT_DRILL_FINAL_PROOF_ATTEMPTS = 3;
export const PHOTOSHOP_EXACT_DRILL_FINAL_PROOF_DELAY_MS = 250;
export const PHOTOSHOP_EXACT_DRILL_MAX_DOCUMENT_NAME_LENGTH = 120;
export const PHOTOSHOP_EXACT_DRILL_BRIDGE_HOST = '127.0.0.1';
export const PHOTOSHOP_EXACT_DRILL_BRIDGE_PORT = 7778;
export const PHOTOSHOP_EXACT_DRILL_PAIRING_TOKEN_PATTERN = '^[a-f0-9]{48}$';

const PHOTOSHOP_APP_NAME = 'Photoshop';
const WAIT_TIMEOUT_MS = 12_000;

export type PhotoshopExactDrillTool =
  | 'bridge.health'
  | 'bridge.pair'
  | 'desktop.photoshop_document_status'
  | 'desktop.launch_app'
  | 'desktop.wait_for_app'
  | 'desktop.window_state'
  | 'desktop.focus_app'
  | 'desktop.photoshop_create_document';

export type PhotoshopExactDrillTraceStage =
  | 'dispatched'
  | 'succeeded'
  | 'failed'
  | 'ambiguous';

export interface PhotoshopExactDrillCall {
  tool: PhotoshopExactDrillTool;
  method: 'GET' | 'POST';
  path: string;
  body?: Record<string, unknown>;
}

export interface PhotoshopExactDrillTransport {
  request(call: PhotoshopExactDrillCall): Promise<unknown>;
  /** Best-effort cleanup for closure-held credentials. */
  dispose?(): void | Promise<void>;
}

export interface PhotoshopExactDrillTraceEntry {
  index: number;
  tool: PhotoshopExactDrillTool;
  method: 'GET' | 'POST';
  path: string;
  stage: PhotoshopExactDrillTraceStage;
  mutation: boolean;
}

export interface PhotoshopExactDrillManifest {
  version: number;
  task: string;
  programId: 'photoshop_new_document';
  title: string;
  authorizationMode: 'direct_user_request';
  steps: Array<{ tool: string; args: Record<string, unknown> }>;
  executionContract: PhotoshopExactDrillExecutionContract;
  fingerprint: string;
}

export interface PhotoshopExactDrillExecutionContract {
  bridge: {
    host: '127.0.0.1';
    port: 7778;
  };
  callAllowlist: Array<{
    tool: PhotoshopExactDrillTool;
    method: 'GET' | 'POST';
    path: string;
    body: Record<string, unknown> | null;
  }>;
  pairingExchange: {
    endpoint: '/desktop/pair';
    challengeRequestBody: Record<string, never>;
    confirmationBody: 'pairingChallenge_from_immediately_preceding_48_hex_challenge';
    tokenPattern: '^[a-f0-9]{48}$';
  };
  finalStatusProofRetry: {
    tool: 'desktop.photoshop_document_status';
    maxAttempts: 3;
    delayMs: 250;
    retryClass: 'read_only_status_only';
    requiredSuffixOrder: 'one_to_three_status_reads_then_foreground_proof';
    allowedForegroundSuffixes: Array<
      | ['desktop.window_state']
      | ['desktop.window_state', 'desktop.focus_app', 'desktop.window_state']
    >;
    forbiddenToolsAfterCreate: Array<
      | 'desktop.launch_app'
      | 'desktop.wait_for_app'
      | 'desktop.photoshop_create_document'
      | 'browser_surface'
    >;
    createRetryAllowed: false;
    foregroundProofRequired: true;
  };
  safety: {
    browserInvocationAllowed: false;
    originHeaderAllowed: false;
    createAtMostOnceScope: 'node_process_lifetime';
    replayCreateAfterAmbiguityAllowed: false;
    requireExactCreatedAndActiveDocumentName: true;
    documentNameComparison: 'bounded_raw_exact';
    documentNameNormalizationAllowed: false;
    unsafeDocumentNamesAllowed: false;
    receiptDocumentNameRendering: 'escape_after_raw_validation';
    requirePhotoshopFrontmost: true;
  };
}

export type PhotoshopExactDrillModeDecision =
  | { mode: 'dry'; reason: 'default' | 'explicit_dry' }
  | { mode: 'live'; reason: 'explicit_live_fingerprint' }
  | {
      mode: 'refused';
      reason: 'conflicting_modes' | 'unknown_argument' | 'confirmation_missing' | 'confirmation_mismatch';
      detail: string;
      liveRequested: boolean;
    };

export type PhotoshopExactDrillStatus =
  | 'dry_run'
  | 'completed'
  | 'gate_refused'
  | 'blocked_before_mutation'
  | 'verification_incomplete'
  | 'mutation_outcome_unknown';

export interface PhotoshopExactDrillProof {
  source: 'desktop.photoshop_document_status';
  appRunning: true;
  activeDocumentName: string;
  widthPx: 600;
  heightPx: 600;
  frontmostApp: string;
}

export interface PhotoshopExactDrillReceipt {
  version: number;
  mode: 'dry' | 'live';
  status: PhotoshopExactDrillStatus;
  taskFingerprint: string;
  requested: {
    appName: 'Photoshop';
    widthPx: 600;
    heightPx: 600;
  };
  authorization: {
    liveFlag: boolean;
    fingerprintMatched: boolean;
  };
  mutationDispatched: boolean;
  createDispatchCount: number;
  browserInvocationCount: number;
  trace: PhotoshopExactDrillTraceEntry[];
  proof?: PhotoshopExactDrillProof;
  reason: string;
}

export interface PhotoshopExactDrillRunResult {
  /**
   * 0 = dry plan or verified completion
   * 2 = explicit live gate refused
   * 3 = blocked before create dispatch
   * 4 = create acknowledged but final independent proof incomplete
   * 5 = create dispatch crossed the transport boundary with unknown outcome
   */
  exitCode: 0 | 2 | 3 | 4 | 5;
  manifest: PhotoshopExactDrillManifest;
  receipt: PhotoshopExactDrillReceipt;
}

export interface PhotoshopExactDrillRunInput {
  argv?: string[];
  env?: Record<string, string | undefined>;
  transportFactory: () => PhotoshopExactDrillTransport;
}

type MutableRunState = {
  trace: PhotoshopExactDrillTraceEntry[];
  mutationDispatched: boolean;
  createDispatchCount: number;
};

type JsonRecord = Record<string, unknown>;

const CALL_SPECS: Readonly<Record<PhotoshopExactDrillTool, {
  method: 'GET' | 'POST';
  path: string;
  mutation: boolean;
}>> = Object.freeze({
  'bridge.health': { method: 'GET', path: '/desktop/health', mutation: false },
  'bridge.pair': { method: 'POST', path: '/desktop/pair', mutation: false },
  'desktop.photoshop_document_status': { method: 'POST', path: '/desktop/photoshop_document_status', mutation: false },
  'desktop.launch_app': { method: 'POST', path: '/desktop/launch', mutation: false },
  'desktop.wait_for_app': { method: 'POST', path: '/desktop/wait_for_app', mutation: false },
  'desktop.window_state': { method: 'GET', path: '/desktop/window_state', mutation: false },
  'desktop.focus_app': { method: 'POST', path: '/desktop/focus', mutation: false },
  'desktop.photoshop_create_document': { method: 'POST', path: '/desktop/photoshop_create_document', mutation: true },
});

// This latch is intentionally module/process scoped rather than run scoped.
// A process that has crossed the create dispatch boundary cannot issue another
// create, even if a caller attempts to invoke runPhotoshopExactDrill again.
let createDispatchedInThisProcess = false;

const REQUIRED_HEALTH_TOOLS = Object.freeze([
  'launch',
  'focus',
  'wait_for_app',
  'window_state',
  'photoshop_document_status',
  'photoshop_create_document',
]);

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  const serialized = JSON.stringify(value);
  return serialized === undefined ? 'null' : serialized;
}

function safeText(value: unknown, fallback: string, max = 180): string {
  let text = '';
  try {
    text = String(value ?? '');
  } catch {
    text = '';
  }
  text = text
    .replace(/eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, '[redacted]')
    .replace(/(?:sk|ghp|gho|ghu|ghs|ghr|xoxb|xoxp)[-_][A-Za-z0-9_-]{6,}/gi, '[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._-]{8,}/gi, 'Bearer [redacted]')
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff`<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (text || fallback).slice(0, max);
}

function bodyEquals(actual: unknown, expected: Record<string, unknown>): boolean {
  return stableJson(actual ?? {}) === stableJson(expected);
}

function expectedBodyFor(tool: PhotoshopExactDrillTool): Record<string, unknown> | undefined {
  switch (tool) {
    case 'bridge.health':
    case 'desktop.window_state':
      return undefined;
    case 'bridge.pair':
      return {};
    case 'desktop.photoshop_document_status':
    case 'desktop.launch_app':
    case 'desktop.focus_app':
      return { appName: PHOTOSHOP_APP_NAME };
    case 'desktop.wait_for_app':
      return { appName: PHOTOSHOP_APP_NAME, timeoutMs: WAIT_TIMEOUT_MS };
    case 'desktop.photoshop_create_document':
      return {
        appName: PHOTOSHOP_APP_NAME,
        widthPx: PHOTOSHOP_EXACT_DRILL_WIDTH_PX,
        heightPx: PHOTOSHOP_EXACT_DRILL_HEIGHT_PX,
      };
  }
}

export function validatePhotoshopExactDrillCall(call: PhotoshopExactDrillCall): string | null {
  const spec = CALL_SPECS[call.tool];
  if (!spec) return 'tool_not_allowlisted';
  if (call.method !== spec.method) return 'method_mismatch';
  if (call.path !== spec.path) return 'path_mismatch';
  if (/browser|open_url|browser_tabs/i.test(`${call.tool} ${call.path}`)) return 'browser_surface_forbidden';
  const expectedBody = expectedBodyFor(call.tool);
  if (expectedBody === undefined) {
    if (call.body !== undefined) return 'unexpected_body';
  } else if (!bodyEquals(call.body, expectedBody)) {
    return 'body_mismatch';
  }
  const bodyText = stableJson(call.body || {});
  if (/chrome|chromium|safari|firefox|edge|arc|brave|opera|vivaldi/i.test(bodyText)) {
    return 'browser_target_forbidden';
  }
  return null;
}

function buildCall(tool: PhotoshopExactDrillTool): PhotoshopExactDrillCall {
  const spec = CALL_SPECS[tool];
  const body = expectedBodyFor(tool);
  return {
    tool,
    method: spec.method,
    path: spec.path,
    ...(body === undefined ? {} : { body }),
  };
}

function normalizedAppIdentity(value: unknown): string {
  if (typeof value !== 'string' || value.length > 120) return '';
  return value
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/\.app$/i, '')
    .replace(/\s*\(beta\)$/i, ' beta')
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

export function isPhotoshopExactDrillIdentity(value: unknown): boolean {
  const normalized = normalizedAppIdentity(value);
  if (
    normalized === 'photoshop'
    || normalized === 'adobe photoshop'
    || normalized === 'photoshop beta'
    || normalized === 'adobe photoshop beta'
  ) return true;
  // macOS Adobe installs commonly expose versioned process names such as
  // "Adobe Photoshop 2025". Keep the suffix anchored and year-shaped so a
  // label such as "Not Photoshop" or "Photoshop Helper" is rejected.
  return /^(?:adobe )?photoshop 20\d{2}(?: beta)?$/.test(normalized);
}

export function isValidPhotoshopExactDrillPairingSecret(value: unknown): boolean {
  return typeof value === 'string'
    && new RegExp(PHOTOSHOP_EXACT_DRILL_PAIRING_TOKEN_PATTERN, 'i').test(value);
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

export function validatedPhotoshopExactDrillRawDocumentName(value: unknown): string | null {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > PHOTOSHOP_EXACT_DRILL_MAX_DOCUMENT_NAME_LENGTH
    || value.trim().length < 1
    || hasUnpairedSurrogate(value)
  ) return null;
  // These characters can alter terminal/UI structure or visual ordering. Do
  // not delete, collapse, trim, or normalize them into a potentially colliding
  // name: reject the evidence value outright.
  if (/[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufdd0-\ufdef\ufffe\uffff\ufeff]/u.test(value)) {
    return null;
  }
  return value;
}

function renderDocumentNameForReceipt(value: string): string {
  // Preserve distinctions while keeping Markdown/HTML-like delimiters inert.
  // Backslash is escaped first so a literal "\\u003c" cannot collide with
  // the rendered form of a literal "<".
  return value
    .replace(/\\/g, '\\\\')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/`/g, '\\u0060');
}

function activeDocumentName(record: JsonRecord | null): string {
  return validatedPhotoshopExactDrillRawDocumentName(record?.activeDocumentName) || '';
}

function numberValue(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function buildPhotoshopExactDrillManifest(): PhotoshopExactDrillManifest {
  const program = compileComputerSequenceProgram(PHOTOSHOP_EXACT_DRILL_TASK);
  if (!program || program.id !== 'photoshop_new_document') {
    throw new Error('exact_program_missing');
  }
  if (program.authorization.mode !== 'direct_user_request') {
    throw new Error('exact_program_authorization_drift');
  }
  const expectedTools = [
    'desktop.photoshop_document_status',
    'desktop.launch_app',
    'desktop.photoshop_document_status',
    'desktop.photoshop_create_document',
    'desktop.photoshop_document_status',
  ];
  const actualTools = program.steps.map((step) => step.tool);
  if (stableJson(actualTools) !== stableJson(expectedTools)) {
    throw new Error('exact_program_tool_drift');
  }
  const create = program.steps.find((step) => step.tool === 'desktop.photoshop_create_document');
  if (
    numberValue(create?.args.widthPx) !== PHOTOSHOP_EXACT_DRILL_WIDTH_PX
    || numberValue(create?.args.heightPx) !== PHOTOSHOP_EXACT_DRILL_HEIGHT_PX
  ) {
    throw new Error('exact_program_dimension_drift');
  }
  if (program.steps.some((step) => /browser\.|open_url|file_(?:search|stat|read)|screenshot|click|key|type/i.test(step.tool))) {
    throw new Error('exact_program_forbidden_surface');
  }
  const unsigned: Omit<PhotoshopExactDrillManifest, 'fingerprint'> = {
    version: PHOTOSHOP_EXACT_DRILL_VERSION,
    task: PHOTOSHOP_EXACT_DRILL_TASK,
    programId: 'photoshop_new_document',
    title: program.title,
    authorizationMode: 'direct_user_request',
    steps: program.steps.map((step) => ({ tool: step.tool, args: step.args })),
    executionContract: {
      bridge: {
        host: PHOTOSHOP_EXACT_DRILL_BRIDGE_HOST,
        port: PHOTOSHOP_EXACT_DRILL_BRIDGE_PORT,
      },
      callAllowlist: (Object.keys(CALL_SPECS) as PhotoshopExactDrillTool[]).map((tool) => ({
        tool,
        method: CALL_SPECS[tool].method,
        path: CALL_SPECS[tool].path,
        body: expectedBodyFor(tool) ?? null,
      })),
      pairingExchange: {
        endpoint: '/desktop/pair',
        challengeRequestBody: {},
        confirmationBody: 'pairingChallenge_from_immediately_preceding_48_hex_challenge',
        tokenPattern: PHOTOSHOP_EXACT_DRILL_PAIRING_TOKEN_PATTERN,
      },
      finalStatusProofRetry: {
        tool: 'desktop.photoshop_document_status',
        maxAttempts: PHOTOSHOP_EXACT_DRILL_FINAL_PROOF_ATTEMPTS,
        delayMs: PHOTOSHOP_EXACT_DRILL_FINAL_PROOF_DELAY_MS,
        retryClass: 'read_only_status_only',
        requiredSuffixOrder: 'one_to_three_status_reads_then_foreground_proof',
        allowedForegroundSuffixes: [
          ['desktop.window_state'],
          ['desktop.window_state', 'desktop.focus_app', 'desktop.window_state'],
        ],
        forbiddenToolsAfterCreate: [
          'desktop.launch_app',
          'desktop.wait_for_app',
          'desktop.photoshop_create_document',
          'browser_surface',
        ],
        createRetryAllowed: false,
        foregroundProofRequired: true,
      },
      safety: {
        browserInvocationAllowed: false,
        originHeaderAllowed: false,
        createAtMostOnceScope: 'node_process_lifetime',
        replayCreateAfterAmbiguityAllowed: false,
        requireExactCreatedAndActiveDocumentName: true,
        documentNameComparison: 'bounded_raw_exact',
        documentNameNormalizationAllowed: false,
        unsafeDocumentNamesAllowed: false,
        receiptDocumentNameRendering: 'escape_after_raw_validation',
        requirePhotoshopFrontmost: true,
      },
    },
  };
  const fingerprint = `sha256:${createHash('sha256').update(stableJson(unsigned)).digest('hex')}`;
  return { ...unsigned, fingerprint };
}

export function resolvePhotoshopExactDrillMode(input: {
  argv?: string[];
  env?: Record<string, string | undefined>;
  fingerprint: string;
}): PhotoshopExactDrillModeDecision {
  const argv = Array.isArray(input.argv) ? input.argv.map(String) : [];
  const unknown = argv.find((arg) => arg !== '--live' && arg !== '--dry-run');
  if (unknown) {
    return {
      mode: 'refused',
      reason: 'unknown_argument',
      detail: `Unsupported argument: ${safeText(unknown, 'unknown', 80)}`,
      liveRequested: argv.includes('--live'),
    };
  }
  const live = argv.includes('--live');
  const dry = argv.includes('--dry-run');
  if (live && dry) {
    return {
      mode: 'refused',
      reason: 'conflicting_modes',
      detail: 'Choose either --live or --dry-run.',
      liveRequested: true,
    };
  }
  if (!live) return { mode: 'dry', reason: dry ? 'explicit_dry' : 'default' };
  const confirmation = String(input.env?.[PHOTOSHOP_EXACT_DRILL_CONFIRM_ENV] || '').trim();
  if (!confirmation) {
    return {
      mode: 'refused',
      reason: 'confirmation_missing',
      detail: `${PHOTOSHOP_EXACT_DRILL_CONFIRM_ENV} must equal the current dry-run fingerprint.`,
      liveRequested: true,
    };
  }
  if (confirmation !== input.fingerprint) {
    return {
      mode: 'refused',
      reason: 'confirmation_mismatch',
      detail: 'The live confirmation does not match the current exact program fingerprint.',
      liveRequested: true,
    };
  }
  return { mode: 'live', reason: 'explicit_live_fingerprint' };
}

export function countPhotoshopExactDrillBrowserInvocations(
  trace: readonly PhotoshopExactDrillTraceEntry[],
): number {
  return trace.filter((entry) => /browser|open_url|browser_tabs|chrome|safari|firefox/i.test(
    `${entry.tool} ${entry.path}`,
  )).length;
}

export function validatePhotoshopExactDrillTrace(
  trace: readonly PhotoshopExactDrillTraceEntry[],
): string[] {
  const issues: string[] = [];
  if (trace.length > PHOTOSHOP_EXACT_DRILL_MAX_TRACE_ENTRIES) issues.push('trace_too_long');
  if (countPhotoshopExactDrillBrowserInvocations(trace) !== 0) issues.push('browser_invocation');
  const creates = trace.filter((entry) => entry.tool === 'desktop.photoshop_create_document');
  if (creates.length > 1) issues.push('create_replayed');
  for (const entry of trace) {
    const spec = CALL_SPECS[entry.tool];
    if (!spec || entry.method !== spec.method || entry.path !== spec.path) {
      issues.push(`invalid_trace_entry_${entry.index}`);
    } else if (entry.mutation !== spec.mutation) {
      issues.push(`invalid_trace_tool_class_${entry.index}`);
    }
  }

  const createIndex = trace.findIndex((entry) => entry.tool === 'desktop.photoshop_create_document');
  if (createIndex >= 0) {
    const afterCreate = trace.slice(createIndex + 1);
    const statusTool: PhotoshopExactDrillTool = 'desktop.photoshop_document_status';
    const statusReads = afterCreate.filter((entry) => entry.tool === statusTool);
    let consecutiveStatusReads = 0;
    while (afterCreate[consecutiveStatusReads]?.tool === statusTool) {
      consecutiveStatusReads += 1;
    }

    if (statusReads.length < 1) issues.push('post_create_status_read_missing');
    if (statusReads.length > PHOTOSHOP_EXACT_DRILL_FINAL_PROOF_ATTEMPTS) {
      issues.push('post_create_status_reads_exceeded');
    }
    if (consecutiveStatusReads !== statusReads.length) {
      issues.push('post_create_status_reads_not_consecutive');
    }
    if (statusReads.some((entry) => (
      entry.method !== 'POST'
      || entry.path !== '/desktop/photoshop_document_status'
      || entry.mutation
    ))) {
      issues.push('post_create_status_not_read_only');
    }

    const forbiddenAfterCreate = afterCreate.some((entry) => (
      entry.tool === 'desktop.launch_app'
      || entry.tool === 'desktop.wait_for_app'
      || entry.tool === 'desktop.photoshop_create_document'
      || /browser|open_url|browser_tabs|chrome|safari|firefox/i.test(`${entry.tool} ${entry.path}`)
    ));
    if (forbiddenAfterCreate) issues.push('post_create_forbidden_tool');

    const foregroundSuffix = afterCreate.slice(consecutiveStatusReads).map((entry) => entry.tool);
    const directForeground = stableJson(foregroundSuffix) === stableJson([
      'desktop.window_state',
    ]);
    const focusedForeground = stableJson(foregroundSuffix) === stableJson([
      'desktop.window_state',
      'desktop.focus_app',
      'desktop.window_state',
    ]);
    if (!directForeground && !focusedForeground) {
      issues.push('post_create_suffix_invalid');
    }
  }
  return issues.slice(0, 8);
}

function baseReceipt(
  manifest: PhotoshopExactDrillManifest,
  mode: 'dry' | 'live',
  status: PhotoshopExactDrillStatus,
  decision: PhotoshopExactDrillModeDecision,
  state: MutableRunState,
  reason: string,
  proof?: PhotoshopExactDrillProof,
): PhotoshopExactDrillReceipt {
  const trace = state.trace.slice(0, PHOTOSHOP_EXACT_DRILL_MAX_TRACE_ENTRIES).map((entry) => ({ ...entry }));
  return {
    version: PHOTOSHOP_EXACT_DRILL_VERSION,
    mode,
    status,
    taskFingerprint: manifest.fingerprint,
    requested: {
      appName: PHOTOSHOP_APP_NAME,
      widthPx: PHOTOSHOP_EXACT_DRILL_WIDTH_PX,
      heightPx: PHOTOSHOP_EXACT_DRILL_HEIGHT_PX,
    },
    authorization: {
      liveFlag: decision.mode === 'live' || (decision.mode === 'refused' && decision.liveRequested),
      fingerprintMatched: decision.mode === 'live',
    },
    mutationDispatched: state.mutationDispatched,
    createDispatchCount: state.createDispatchCount,
    browserInvocationCount: countPhotoshopExactDrillBrowserInvocations(trace),
    trace,
    ...(proof ? {
      proof: {
        ...proof,
        activeDocumentName: renderDocumentNameForReceipt(proof.activeDocumentName),
      },
    } : {}),
    reason: safeText(reason, status, 220),
  };
}

class DrillCallFailure extends Error {
  readonly tool: PhotoshopExactDrillTool;
  readonly afterCreateDispatch: boolean;

  constructor(tool: PhotoshopExactDrillTool, afterCreateDispatch: boolean, message: string) {
    super(message);
    this.tool = tool;
    this.afterCreateDispatch = afterCreateDispatch;
  }
}

async function dispatchCall(
  transport: PhotoshopExactDrillTransport,
  state: MutableRunState,
  tool: PhotoshopExactDrillTool,
): Promise<JsonRecord | null> {
  const call = buildCall(tool);
  const invalid = validatePhotoshopExactDrillCall(call);
  if (invalid) throw new DrillCallFailure(tool, state.mutationDispatched, invalid);
  if (state.trace.length >= PHOTOSHOP_EXACT_DRILL_MAX_TRACE_ENTRIES) {
    throw new DrillCallFailure(tool, state.mutationDispatched, 'trace_budget_exhausted');
  }
  const mutation = CALL_SPECS[tool].mutation;
  if (mutation) {
    if (state.createDispatchCount >= 1) {
      throw new DrillCallFailure(tool, true, 'create_replay_refused');
    }
    if (createDispatchedInThisProcess) {
      throw new DrillCallFailure(tool, false, 'process_create_latch_already_claimed');
    }
    // Mark before awaiting transport. Once the request crosses this boundary,
    // any exception is outcome-unknown and must never lead to another create.
    createDispatchedInThisProcess = true;
    state.createDispatchCount += 1;
    state.mutationDispatched = true;
  }
  const entry: PhotoshopExactDrillTraceEntry = {
    index: state.trace.length + 1,
    tool,
    method: call.method,
    path: call.path,
    stage: 'dispatched',
    mutation,
  };
  state.trace.push(entry);
  try {
    const result = await transport.request(call);
    entry.stage = 'succeeded';
    return asRecord(result);
  } catch (error) {
    entry.stage = mutation ? 'ambiguous' : 'failed';
    throw new DrillCallFailure(
      tool,
      state.mutationDispatched,
      safeText(error instanceof Error ? error.message : error, 'transport_error'),
    );
  }
}

function markLastTraceStage(state: MutableRunState, stage: PhotoshopExactDrillTraceStage): void {
  const last = state.trace[state.trace.length - 1];
  if (last) last.stage = stage;
}

async function ensurePhotoshopForeground(
  transport: PhotoshopExactDrillTransport,
  state: MutableRunState,
): Promise<{ ok: true; frontmostApp: string } | { ok: false; reason: string }> {
  const first = await dispatchCall(transport, state, 'desktop.window_state');
  if (first?.ok === true && isPhotoshopExactDrillIdentity(first.frontmostApp)) {
    return { ok: true, frontmostApp: safeText(first.frontmostApp, PHOTOSHOP_APP_NAME, 120) };
  }
  const focus = await dispatchCall(transport, state, 'desktop.focus_app');
  if (
    focus?.ok !== true
    || !isPhotoshopExactDrillIdentity(focus.requestedAppName || PHOTOSHOP_APP_NAME)
    || !isPhotoshopExactDrillIdentity(focus.resolvedAppName || focus.appName)
  ) {
    markLastTraceStage(state, 'failed');
    return { ok: false, reason: 'photoshop_focus_not_confirmed' };
  }
  const verified = await dispatchCall(transport, state, 'desktop.window_state');
  if (verified?.ok !== true || !isPhotoshopExactDrillIdentity(verified.frontmostApp)) {
    markLastTraceStage(state, 'failed');
    return { ok: false, reason: 'photoshop_foreground_not_verified' };
  }
  return { ok: true, frontmostApp: safeText(verified.frontmostApp, PHOTOSHOP_APP_NAME, 120) };
}

function proofFromFinalStatus(
  status: JsonRecord | null,
  frontmostApp: string,
  expectedDocumentName: string,
): PhotoshopExactDrillProof | null {
  const name = activeDocumentName(status);
  if (
    status?.ok !== true
    || status.appRunning !== true
    || !name
    || !expectedDocumentName
    || name !== expectedDocumentName
    || numberValue(status.widthPx) !== PHOTOSHOP_EXACT_DRILL_WIDTH_PX
    || numberValue(status.heightPx) !== PHOTOSHOP_EXACT_DRILL_HEIGHT_PX
    || !isPhotoshopExactDrillIdentity(frontmostApp)
  ) return null;
  return {
    source: 'desktop.photoshop_document_status',
    appRunning: true,
    activeDocumentName: name,
    widthPx: PHOTOSHOP_EXACT_DRILL_WIDTH_PX,
    heightPx: PHOTOSHOP_EXACT_DRILL_HEIGHT_PX,
    frontmostApp: safeText(frontmostApp, PHOTOSHOP_APP_NAME, 120),
  };
}

function finalStatusMatchesCreatedDocument(status: JsonRecord | null, expectedDocumentName: string): boolean {
  return status?.ok === true
    && status.appRunning === true
    && activeDocumentName(status) === expectedDocumentName
    && numberValue(status.widthPx) === PHOTOSHOP_EXACT_DRILL_WIDTH_PX
    && numberValue(status.heightPx) === PHOTOSHOP_EXACT_DRILL_HEIGHT_PX;
}

function waitForFinalProofRetry(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, PHOTOSHOP_EXACT_DRILL_FINAL_PROOF_DELAY_MS);
  });
}

function resultWithReceipt(
  exitCode: PhotoshopExactDrillRunResult['exitCode'],
  manifest: PhotoshopExactDrillManifest,
  mode: 'dry' | 'live',
  status: PhotoshopExactDrillStatus,
  decision: PhotoshopExactDrillModeDecision,
  state: MutableRunState,
  reason: string,
  proof?: PhotoshopExactDrillProof,
): PhotoshopExactDrillRunResult {
  return {
    exitCode,
    manifest,
    receipt: baseReceipt(manifest, mode, status, decision, state, reason, proof),
  };
}

export async function runPhotoshopExactDrill(
  input: PhotoshopExactDrillRunInput,
): Promise<PhotoshopExactDrillRunResult> {
  const manifest = buildPhotoshopExactDrillManifest();
  const decision = resolvePhotoshopExactDrillMode({
    argv: input.argv,
    env: input.env,
    fingerprint: manifest.fingerprint,
  });
  const state: MutableRunState = { trace: [], mutationDispatched: false, createDispatchCount: 0 };

  if (decision.mode === 'dry') {
    return resultWithReceipt(
      0,
      manifest,
      'dry',
      'dry_run',
      decision,
      state,
      'Dry run only: no bridge, app, network, launch, focus, or create call was made.',
    );
  }
  if (decision.mode === 'refused') {
    return resultWithReceipt(2, manifest, 'live', 'gate_refused', decision, state, decision.detail);
  }

  let transport: PhotoshopExactDrillTransport;
  try {
    // This is intentionally the first transport touch. Dry/refused modes have
    // already returned, so their transportFactory invocation count is zero.
    transport = input.transportFactory();
  } catch (error) {
    return resultWithReceipt(
      3,
      manifest,
      'live',
      'blocked_before_mutation',
      decision,
      state,
      safeText(error instanceof Error ? error.message : error, 'transport_factory_failed'),
    );
  }

  try {
    const health = await dispatchCall(transport, state, 'bridge.health');
    const tools = Array.isArray(health?.tools) ? health.tools.map(String) : [];
    const missing = REQUIRED_HEALTH_TOOLS.filter((tool) => !tools.includes(tool));
    if (health?.ok !== true || health.supported !== true || missing.length > 0) {
      markLastTraceStage(state, 'failed');
      return resultWithReceipt(
        3,
        manifest,
        'live',
        'blocked_before_mutation',
        decision,
        state,
        missing.length > 0 ? `bridge_missing_capabilities:${missing.join(',')}` : 'desktop_bridge_unavailable',
      );
    }

    const pairing = await dispatchCall(transport, state, 'bridge.pair');
    if (pairing?.ok !== true) {
      markLastTraceStage(state, 'failed');
      return resultWithReceipt(3, manifest, 'live', 'blocked_before_mutation', decision, state, 'desktop_pairing_failed');
    }

    const before = await dispatchCall(transport, state, 'desktop.photoshop_document_status');
    if (before?.ok !== true) {
      markLastTraceStage(state, 'failed');
      return resultWithReceipt(3, manifest, 'live', 'blocked_before_mutation', decision, state, 'initial_photoshop_status_unavailable');
    }

    let ready = before;
    if (before.appRunning !== true) {
      const launch = await dispatchCall(transport, state, 'desktop.launch_app');
      if (
        launch?.ok !== true
        || !isPhotoshopExactDrillIdentity(launch.requestedAppName || PHOTOSHOP_APP_NAME)
        || !isPhotoshopExactDrillIdentity(launch.resolvedAppName || launch.appName)
      ) {
        markLastTraceStage(state, 'failed');
        return resultWithReceipt(3, manifest, 'live', 'blocked_before_mutation', decision, state, 'photoshop_launch_not_confirmed');
      }
      for (let attempt = 0; attempt < PHOTOSHOP_EXACT_DRILL_READY_ATTEMPTS; attempt += 1) {
        await dispatchCall(transport, state, 'desktop.wait_for_app');
        ready = await dispatchCall(transport, state, 'desktop.photoshop_document_status');
        if (ready?.ok === true && ready.appRunning === true) break;
      }
    }
    if (ready?.ok !== true || ready.appRunning !== true) {
      markLastTraceStage(state, 'failed');
      return resultWithReceipt(3, manifest, 'live', 'blocked_before_mutation', decision, state, 'photoshop_not_scriptable');
    }

    const foregroundBefore = await ensurePhotoshopForeground(transport, state);
    if (foregroundBefore.ok === false) {
      return resultWithReceipt(3, manifest, 'live', 'blocked_before_mutation', decision, state, foregroundBefore.reason);
    }

    const created = await dispatchCall(transport, state, 'desktop.photoshop_create_document');
    const createdName = validatedPhotoshopExactDrillRawDocumentName(created?.documentName) || '';
    if (
      created?.ok !== true
      || created.created !== true
      || !createdName
      || numberValue(created.widthPx) !== PHOTOSHOP_EXACT_DRILL_WIDTH_PX
      || numberValue(created.heightPx) !== PHOTOSHOP_EXACT_DRILL_HEIGHT_PX
    ) {
      markLastTraceStage(state, 'ambiguous');
      return resultWithReceipt(
        5,
        manifest,
        'live',
        'mutation_outcome_unknown',
        decision,
        state,
        'The create request was dispatched but its exact result was not confirmed. It was not replayed.',
      );
    }

    let finalStatus: JsonRecord | null = null;
    for (let attempt = 0; attempt < PHOTOSHOP_EXACT_DRILL_FINAL_PROOF_ATTEMPTS; attempt += 1) {
      // Only this read-only app-native status tool is retried. The create latch
      // remains claimed, so observation lag can settle without replaying the
      // document mutation.
      finalStatus = await dispatchCall(transport, state, 'desktop.photoshop_document_status');
      if (finalStatusMatchesCreatedDocument(finalStatus, createdName)) break;
      if (attempt + 1 < PHOTOSHOP_EXACT_DRILL_FINAL_PROOF_ATTEMPTS) {
        await waitForFinalProofRetry();
      }
    }
    const foregroundAfter = await ensurePhotoshopForeground(transport, state);
    if (foregroundAfter.ok === false) {
      return resultWithReceipt(
        4,
        manifest,
        'live',
        'verification_incomplete',
        decision,
        state,
        `The document create was acknowledged, but final foreground proof failed: ${foregroundAfter.reason}. The create was not replayed.`,
      );
    }
    const proof = proofFromFinalStatus(finalStatus, foregroundAfter.frontmostApp, createdName);
    if (!proof) {
      return resultWithReceipt(
        4,
        manifest,
        'live',
        'verification_incomplete',
        decision,
        state,
        'The create was acknowledged, but fresh app-native status did not prove the same active 600x600 document. The create was not replayed.',
      );
    }
    const traceIssues = validatePhotoshopExactDrillTrace(state.trace);
    if (traceIssues.length > 0) {
      return resultWithReceipt(
        4,
        manifest,
        'live',
        'verification_incomplete',
        decision,
        state,
        `The app proof passed, but the bounded trace contract failed: ${traceIssues.join(',')}.`,
        proof,
      );
    }
    return resultWithReceipt(
      0,
      manifest,
      'live',
      'completed',
      decision,
      state,
      `Photoshop app-native status verified ${renderDocumentNameForReceipt(proof.activeDocumentName)} at 600x600 with Photoshop frontmost and zero browser invocations.`,
      proof,
    );
  } catch (error) {
    const failure = error instanceof DrillCallFailure
      ? error
      : new DrillCallFailure('bridge.health', state.mutationDispatched, safeText(error, 'drill_failed'));
    if (state.mutationDispatched || failure.afterCreateDispatch) {
      return resultWithReceipt(
        5,
        manifest,
        'live',
        'mutation_outcome_unknown',
        decision,
        state,
        `The create boundary was crossed and ${failure.tool} failed or became ambiguous. The create was not replayed.`,
      );
    }
    return resultWithReceipt(
      3,
      manifest,
      'live',
      'blocked_before_mutation',
      decision,
      state,
      `${failure.tool} failed before document creation: ${failure.message}`,
    );
  } finally {
    // The live transport keeps its token closure-local. Ask it to erase the
    // retained reference on every terminal path, and never surface cleanup
    // failures into the bounded receipt.
    try {
      await transport.dispose?.();
    } catch {
      // Best-effort credential cleanup only.
    }
  }
}
