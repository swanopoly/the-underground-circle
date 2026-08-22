/**
 * Ephemeral authority for opening one exact, durably linked Chat attachment.
 *
 * This module does not stage bytes, open an app, dispatch a bridge call, grant
 * approval, or mint completion evidence. A trusted caller supplies an opaque
 * runtime-private capability only after it has established the exact bytes and
 * durable message link. The capability is retained exclusively in WeakMaps;
 * the value-free authority and description cannot reconstruct it after clone,
 * serialization, or reload.
 */

import type { OpenSwanAttachmentTurnSources } from './openSwanAttachmentTurnSources';
import {
  normalizeOpenSwanAttachmentSourceManifest,
  projectOpenSwanAttachmentSourceManifestForModel,
} from './openSwanAttachmentSourceCore';

export type OpenSwanDesktopAttachmentRequestedOperation = 'desktop_open' | 'desktop_edit';
export type OpenSwanDesktopAttachmentOperation = 'desktop_open';

export type OpenSwanDesktopAttachmentLinkedCandidate = Readonly<{
  linkState: 'durable_linked';
  attachmentId: string;
  messageId: string;
  circleId: string;
  threadId: string;
}>;

/**
 * Public identity token. Its object identity, not these copyable fields, is
 * the authority. It deliberately contains no capability id or file value.
 */
export type OpenSwanDesktopAttachmentAuthority = Readonly<{
  schemaVersion: 1;
  toolName: 'desktop.open_attachment';
  operation: OpenSwanDesktopAttachmentOperation;
}>;

/** Value-free model/runtime description; it is not dispatch or proof. */
export type OpenSwanDesktopAttachmentAuthorityDescription = Readonly<{
  schemaVersion: 1;
  toolName: 'desktop.open_attachment';
  operation: OpenSwanDesktopAttachmentOperation;
  manifestId: string;
  attachmentId: string;
  sha256: string;
  sizeBytes: number;
}>;

export type OpenSwanDesktopAttachmentAuthorityExpected = Readonly<{
  circleId: string;
  threadId: string;
  messageId: string;
  originLocalMessageId: string;
  manifestId: string;
  attachmentId: string;
  sha256: string;
  sizeBytes: number;
  operation: OpenSwanDesktopAttachmentOperation;
}>;

export type OpenSwanDesktopAttachmentAuthorityIssueCode =
  | 'invalid_input'
  | 'desktop_attachment_edit_not_supported'
  | 'attachment_count_unsupported'
  | 'durable_link_required'
  | 'source_manifest_invalid'
  | 'source_projection_mismatch'
  | 'source_scope_mismatch'
  | 'authority_already_issued'
  | 'capability_already_bound';

export type OpenSwanDesktopAttachmentAuthorityIssueResult =
  | Readonly<{
      ok: true;
      authority: OpenSwanDesktopAttachmentAuthority;
      description: OpenSwanDesktopAttachmentAuthorityDescription;
    }>
  | Readonly<{
      ok: false;
      code: OpenSwanDesktopAttachmentAuthorityIssueCode;
    }>;

export type OpenSwanDesktopAttachmentAuthorityResolveCode =
  | 'invalid_input'
  | 'source_identity_mismatch'
  | 'authority_identity_mismatch'
  | 'scope_mismatch'
  | 'binding_drift';

export type OpenSwanDesktopAttachmentAuthorityResolveResult =
  | Readonly<{
      ok: true;
      /** Exact object supplied at issuance; callers must narrow it privately. */
      privateCapability: unknown;
      description: OpenSwanDesktopAttachmentAuthorityDescription;
    }>
  | Readonly<{
      ok: false;
      code: OpenSwanDesktopAttachmentAuthorityResolveCode;
    }>;

export type IssueOpenSwanDesktopAttachmentAuthorityInput = Readonly<{
  sources: OpenSwanAttachmentTurnSources;
  linkedAttachments: ReadonlyArray<OpenSwanDesktopAttachmentLinkedCandidate>;
  operation: OpenSwanDesktopAttachmentRequestedOperation;
  /** Opaque object branded and interpreted only by the runtime-private caller. */
  privateCapability: unknown;
}>;

export type ResolveOpenSwanDesktopAttachmentAuthorityInput = Readonly<{
  sources: OpenSwanAttachmentTurnSources;
  authority: OpenSwanDesktopAttachmentAuthority;
  expected: OpenSwanDesktopAttachmentAuthorityExpected;
}>;

export type ResolveOpenSwanDesktopAttachmentAuthorityForSourcesInput = Readonly<{
  sources: OpenSwanAttachmentTurnSources;
  expected: OpenSwanDesktopAttachmentAuthorityExpected;
}>;

export const OPEN_SWAN_DESKTOP_ATTACHMENT_APPROVAL_RESUME_LIMITS = Object.freeze({
  maxEntries: 64,
  defaultTtlMs: 10 * 60 * 1000,
  maxTtlMs: 30 * 60 * 1000,
  maxOriginalUserTaskChars: 20_000,
} as const);

export type OpenSwanDesktopAttachmentPendingApproval = Readonly<{
  status: 'pending_approval';
  toolName: 'desktop.open_attachment';
  approvalId: string;
  sourceRunId: string;
}>;

export type RegisterOpenSwanDesktopAttachmentApprovalResumeLeaseInput = Readonly<{
  sources: OpenSwanAttachmentTurnSources;
  /** Optional extra identity check; canonical turn plumbing needs only sources. */
  authority?: OpenSwanDesktopAttachmentAuthority;
  expected: OpenSwanDesktopAttachmentAuthorityExpected;
  pendingApproval: OpenSwanDesktopAttachmentPendingApproval;
  userId: string;
  /** Stored exactly and only in this process; never projected or normalized. */
  originalUserTaskText: string;
  /** Exact immutable A-ledger object supplied by the caller. */
  ledgerReference: unknown;
}>;

export type OpenSwanDesktopAttachmentApprovalLeaseClock = Readonly<{
  nowMs?: number;
  ttlMs?: number;
}>;

export type RegisterOpenSwanDesktopAttachmentApprovalResumeLeaseResult =
  | Readonly<{ ok: true; expiresAtMs: number }>
  | Readonly<{
      ok: false;
      code: 'duplicate_approval';
      /** Opaque proof that this exact capability remains owned elsewhere. */
      existingLeaseCustody?: OpenSwanDesktopAttachmentExistingLeaseCustodyReceipt;
    }>
  | Readonly<{
      ok: false;
      code:
        | 'invalid_input'
        | 'authority_mismatch'
        | 'capacity_exceeded';
    }>;

/** Value-free, process-branded custody marker; never continuation authority. */
export type OpenSwanDesktopAttachmentExistingLeaseCustodyReceipt = Readonly<{
  schemaVersion: 1;
  kind: 'desktop_attachment_existing_approval_lease_custody';
}>;

export type ResolveOpenSwanDesktopAttachmentExistingLeaseCustodyInput = Readonly<{
  receipt: OpenSwanDesktopAttachmentExistingLeaseCustodyReceipt;
  sources: OpenSwanAttachmentTurnSources;
  expected: OpenSwanDesktopAttachmentAuthorityExpected;
}>;

export type ClaimOpenSwanDesktopAttachmentApprovalResumeLeaseInput = Readonly<{
  approvalId: string;
  sourceRunId: string;
  userId: string;
  circleId: string;
  threadId: string;
  /** Optional extra message assertion; the retained lease returns exact id. */
  messageId?: string;
  /** Optional additional process-identity assertion; not canonical resume input. */
  sources?: OpenSwanAttachmentTurnSources;
  /** Optional extra identity check; the lease already retains the issued token. */
  authority?: OpenSwanDesktopAttachmentAuthority;
  /** Optional additional exact-task assertion for a caller that still has it. */
  originalUserTaskText?: string;
  /** Optional additional exact-ledger identity assertion. */
  ledgerReference?: unknown;
}>;

export type ClaimOpenSwanDesktopAttachmentApprovalResumeLeaseResult =
  | Readonly<{
      ok: true;
      sources: OpenSwanAttachmentTurnSources;
      authority: OpenSwanDesktopAttachmentAuthority;
      expected: OpenSwanDesktopAttachmentAuthorityExpected;
      privateCapability: unknown;
      originalUserTaskText: string;
      ledgerReference: unknown;
    }>
  | Readonly<{
      ok: false;
      code:
        | 'invalid_input'
        | 'lease_not_found'
        | 'lease_expired'
        | 'scope_mismatch'
        | 'source_identity_mismatch'
        | 'authority_identity_mismatch'
        | 'ledger_identity_mismatch'
        | 'task_mismatch'
        | 'binding_drift';
    }>;

export type RevokeOpenSwanDesktopAttachmentApprovalResumeLeaseInput = Readonly<{
  approvalId: string;
  sourceRunId: string;
  userId: string;
  circleId: string;
  threadId: string;
}>;

export type RevokeOpenSwanDesktopAttachmentApprovalResumeLeaseResult =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; code: 'invalid_input' | 'lease_not_found' | 'scope_mismatch' }>;

type ObjectIdentity = object;

type AuthorityState = Readonly<{
  sources: OpenSwanAttachmentTurnSources;
  manifest: OpenSwanAttachmentTurnSources['manifest'];
  manifestItem: OpenSwanAttachmentTurnSources['manifest']['attachments'][number];
  modelProjection: OpenSwanAttachmentTurnSources['modelProjection'];
  modelProjectionItem: OpenSwanAttachmentTurnSources['modelProjection']['attachments'][number];
  privateSourcesByHandle: OpenSwanAttachmentTurnSources['privateSourcesByHandle'];
  authority: OpenSwanDesktopAttachmentAuthority;
  description: OpenSwanDesktopAttachmentAuthorityDescription;
  expected: OpenSwanDesktopAttachmentAuthorityExpected;
  privateCapability: ObjectIdentity;
}>;

type ApprovalResumeLeaseState = Readonly<{
  approvalId: string;
  sourceRunId: string;
  userId: string;
  sources: OpenSwanAttachmentTurnSources;
  authority: OpenSwanDesktopAttachmentAuthority;
  expected: OpenSwanDesktopAttachmentAuthorityExpected;
  privateCapability: ObjectIdentity;
  originalUserTaskText: string;
  ledgerReference: ObjectIdentity;
  expiresAtMs: number;
}>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_OPAQUE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const MAX_ID_CHARS = 160;
const MAX_ATTACHMENT_SIZE_BYTES = 100 * 1024 * 1024;

const sourceAuthorities = new WeakMap<ObjectIdentity, AuthorityState>();
const issuedAuthorities = new WeakMap<ObjectIdentity, AuthorityState>();
const boundPrivateCapabilities = new WeakMap<ObjectIdentity, AuthorityState>();
const pendingApprovalResumeLeases = new Map<string, ApprovalResumeLeaseState>();
const existingLeaseCustodyReceipts = new WeakMap<ObjectIdentity, ApprovalResumeLeaseState>();

function isObjectIdentity(value: unknown): value is ObjectIdentity {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isRuntimeArray(value: unknown): boolean {
  return Array.isArray(value);
}

function hasExactEnumerableDataKeys(value: object, expected: ReadonlyArray<string>): boolean {
  try {
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== expected.length || ownKeys.some((key) => typeof key !== 'string')) return false;
    const allowed = new Set(expected);
    return ownKeys.every((key) => {
      if (typeof key !== 'string' || !allowed.has(key)) return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return Boolean(descriptor?.enumerable && 'value' in descriptor);
    }) && expected.every((key) => Object.prototype.hasOwnProperty.call(value, key));
  } catch {
    return false;
  }
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

function isSafeOpaqueId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_ID_CHARS
    && value === value.trim()
    && SAFE_OPAQUE_ID_RE.test(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && SHA256_RE.test(value);
}

function isSafeSize(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value > 0
    && value <= MAX_ATTACHMENT_SIZE_BYTES;
}

function issueFailure(
  code: OpenSwanDesktopAttachmentAuthorityIssueCode,
): OpenSwanDesktopAttachmentAuthorityIssueResult {
  return Object.freeze({ ok: false as const, code });
}

function resolveFailure(
  code: OpenSwanDesktopAttachmentAuthorityResolveCode,
): OpenSwanDesktopAttachmentAuthorityResolveResult {
  return Object.freeze({ ok: false as const, code });
}

function isExactLinkedCandidate(
  value: unknown,
): value is OpenSwanDesktopAttachmentLinkedCandidate {
  if (!isObjectIdentity(value)) return false;
  const candidate = value as Partial<OpenSwanDesktopAttachmentLinkedCandidate>;
  return candidate.linkState === 'durable_linked'
    && isUuid(candidate.attachmentId)
    && isUuid(candidate.messageId)
    && isUuid(candidate.circleId)
    && isUuid(candidate.threadId);
}

function sameExpected(
  left: OpenSwanDesktopAttachmentAuthorityExpected,
  right: OpenSwanDesktopAttachmentAuthorityExpected,
): boolean {
  return left.circleId === right.circleId
    && left.threadId === right.threadId
    && left.messageId === right.messageId
    && left.originLocalMessageId === right.originLocalMessageId
    && left.manifestId === right.manifestId
    && left.attachmentId === right.attachmentId
    && left.sha256 === right.sha256
    && left.sizeBytes === right.sizeBytes
    && left.operation === right.operation;
}

function normalizeExpected(
  value: OpenSwanDesktopAttachmentAuthorityExpected,
): OpenSwanDesktopAttachmentAuthorityExpected | null {
  if (!isObjectIdentity(value)) return null;
  if (
    !isUuid(value.circleId)
    || !isUuid(value.threadId)
    || !isUuid(value.messageId)
    || !isSafeOpaqueId(value.originLocalMessageId)
    || !isSafeOpaqueId(value.manifestId)
    || !isUuid(value.attachmentId)
    || !isSha256(value.sha256)
    || !isSafeSize(value.sizeBytes)
    || value.operation !== 'desktop_open'
  ) return null;
  return Object.freeze({
    circleId: value.circleId,
    threadId: value.threadId,
    messageId: value.messageId,
    originLocalMessageId: value.originLocalMessageId,
    manifestId: value.manifestId,
    attachmentId: value.attachmentId,
    sha256: value.sha256,
    sizeBytes: value.sizeBytes,
    operation: 'desktop_open' as const,
  });
}

function sourceBindingStillExact(state: AuthorityState): boolean {
  try {
    const manifestItem = state.sources.manifest.attachments[0];
    const modelItem = state.sources.modelProjection.attachments[0];
    return state.sources.manifest === state.manifest
      && state.sources.modelProjection === state.modelProjection
      && state.sources.privateSourcesByHandle === state.privateSourcesByHandle
      && state.sources.manifest.attachments.length === 1
      && state.sources.modelProjection.attachmentCount === 1
      && state.sources.modelProjection.attachments.length === 1
      && manifestItem === state.manifestItem
      && modelItem === state.modelProjectionItem
      && state.sources.manifest.schemaVersion === 1
      && state.sources.manifest.circleId === state.expected.circleId
      && state.sources.manifest.threadId === state.expected.threadId
      && state.sources.manifest.originLocalMessageId === state.expected.originLocalMessageId
      && state.sources.manifest.manifestId === state.expected.manifestId
      && state.sources.modelProjection.schemaVersion === 1
      && state.sources.modelProjection.manifestId === state.expected.manifestId
      && manifestItem?.attachmentId === state.expected.attachmentId
      && manifestItem.sha256 === state.expected.sha256
      && manifestItem.sizeBytes === state.expected.sizeBytes
      && modelItem?.attachmentId === state.expected.attachmentId
      && modelItem.sha256 === state.expected.sha256
      && modelItem.sizeBytes === state.expected.sizeBytes;
  } catch {
    return false;
  }
}

/**
 * Binds one exact sources object to one opaque, non-serializable open
 * capability. Desktop edits are intentionally unsupported at this boundary.
 */
export function issueOpenSwanDesktopAttachmentAuthority(
  input: IssueOpenSwanDesktopAttachmentAuthorityInput,
): OpenSwanDesktopAttachmentAuthorityIssueResult {
  if (!isObjectIdentity(input)) return issueFailure('invalid_input');
  if (input.operation === 'desktop_edit') {
    return issueFailure('desktop_attachment_edit_not_supported');
  }
  if (input.operation !== 'desktop_open') return issueFailure('invalid_input');
  if (!isObjectIdentity(input.sources) || !isObjectIdentity(input.privateCapability)) {
    return issueFailure('invalid_input');
  }
  if (!hasExactEnumerableDataKeys(input.sources, ['manifest', 'modelProjection', 'privateSourcesByHandle'])) {
    return issueFailure('invalid_input');
  }
  if (!Array.isArray(input.linkedAttachments)) return issueFailure('invalid_input');
  if (sourceAuthorities.has(input.sources)) return issueFailure('authority_already_issued');
  if (boundPrivateCapabilities.has(input.privateCapability)) return issueFailure('capability_already_bound');

  let manifest: OpenSwanAttachmentTurnSources['manifest'];
  let modelProjection: OpenSwanAttachmentTurnSources['modelProjection'];
  let privateSourcesByHandle: OpenSwanAttachmentTurnSources['privateSourcesByHandle'];
  try {
    manifest = input.sources.manifest;
    modelProjection = input.sources.modelProjection;
    privateSourcesByHandle = input.sources.privateSourcesByHandle;
  } catch {
    return issueFailure('invalid_input');
  }
  if (!isObjectIdentity(manifest) || !isObjectIdentity(modelProjection) || !isObjectIdentity(privateSourcesByHandle)) {
    return issueFailure('invalid_input');
  }
  const normalizedManifest = normalizeOpenSwanAttachmentSourceManifest(manifest);
  if (!normalizedManifest.ok) return issueFailure('source_manifest_invalid');
  if (!isRuntimeArray(manifest.attachments) || manifest.attachments.length !== 1) {
    return issueFailure('attachment_count_unsupported');
  }
  if (input.linkedAttachments.length !== 1) {
    return input.linkedAttachments.length === 0
      ? issueFailure('durable_link_required')
      : issueFailure('attachment_count_unsupported');
  }

  const manifestItem = manifest.attachments[0];
  const linked = input.linkedAttachments[0];
  if (!manifestItem || !isObjectIdentity(manifestItem)) return issueFailure('source_manifest_invalid');
  if (!linked || !isExactLinkedCandidate(linked)) return issueFailure('durable_link_required');
  if (
    manifest.schemaVersion !== 1
    || !isSafeOpaqueId(manifest.manifestId)
    || !isUuid(manifest.circleId)
    || !isUuid(manifest.threadId)
    || !isSafeOpaqueId(manifest.originLocalMessageId)
    || !isUuid(manifestItem.attachmentId)
    || !isSha256(manifestItem.sha256)
    || !isSafeSize(manifestItem.sizeBytes)
  ) return issueFailure('source_manifest_invalid');
  if (
    linked.attachmentId !== manifestItem.attachmentId
    || linked.circleId !== manifest.circleId
    || linked.threadId !== manifest.threadId
  ) return issueFailure('source_scope_mismatch');

  if (
    modelProjection.schemaVersion !== 1
    || modelProjection.manifestId !== manifest.manifestId
    || modelProjection.attachmentCount !== 1
    || !isRuntimeArray(modelProjection.attachments)
    || modelProjection.attachments.length !== 1
    || !hasExactEnumerableDataKeys(modelProjection, [
      'schemaVersion',
      'manifestId',
      'attachmentCount',
      'attachments',
    ])
  ) return issueFailure('source_projection_mismatch');
  const modelItem = modelProjection.attachments[0];
  const canonicalProjection = projectOpenSwanAttachmentSourceManifestForModel(manifest);
  const canonicalItem = canonicalProjection?.attachments[0];
  if (
    !modelItem
    || !isObjectIdentity(modelItem)
    || !canonicalProjection
    || !canonicalItem
    || !hasExactEnumerableDataKeys(modelItem, [
      'attachmentId',
      'basename',
      'mimeType',
      'sizeBytes',
      'sha256',
      'contentAvailability',
      'sourceHandleKind',
    ])
    || modelItem.attachmentId !== manifestItem.attachmentId
    || modelItem.sha256 !== manifestItem.sha256
    || modelItem.sizeBytes !== manifestItem.sizeBytes
    || modelItem.basename !== manifestItem.basename
    || modelItem.mimeType !== manifestItem.mimeType
    || modelItem.contentAvailability !== manifestItem.contentAvailability
    || modelItem.sourceHandleKind !== manifestItem.sourceHandle.kind
    || modelItem.attachmentId !== canonicalItem.attachmentId
    || modelItem.basename !== canonicalItem.basename
    || modelItem.mimeType !== canonicalItem.mimeType
    || modelItem.sizeBytes !== canonicalItem.sizeBytes
    || modelItem.sha256 !== canonicalItem.sha256
    || modelItem.contentAvailability !== canonicalItem.contentAvailability
    || modelItem.sourceHandleKind !== canonicalItem.sourceHandleKind
  ) return issueFailure('source_projection_mismatch');

  const expected = Object.freeze({
    circleId: manifest.circleId,
    threadId: manifest.threadId,
    messageId: linked.messageId,
    originLocalMessageId: manifest.originLocalMessageId,
    manifestId: manifest.manifestId,
    attachmentId: manifestItem.attachmentId,
    sha256: manifestItem.sha256,
    sizeBytes: manifestItem.sizeBytes,
    operation: 'desktop_open' as const,
  });
  const authority = Object.freeze({
    schemaVersion: 1 as const,
    toolName: 'desktop.open_attachment' as const,
    operation: 'desktop_open' as const,
  });
  const description = Object.freeze({
    schemaVersion: 1 as const,
    toolName: 'desktop.open_attachment' as const,
    operation: 'desktop_open' as const,
    manifestId: manifest.manifestId,
    attachmentId: manifestItem.attachmentId,
    sha256: manifestItem.sha256,
    sizeBytes: manifestItem.sizeBytes,
  });
  const state: AuthorityState = Object.freeze({
    sources: input.sources,
    manifest,
    manifestItem,
    modelProjection,
    modelProjectionItem: modelItem,
    privateSourcesByHandle,
    authority,
    description,
    expected,
    privateCapability: input.privateCapability,
  });
  sourceAuthorities.set(input.sources, state);
  issuedAuthorities.set(authority, state);
  boundPrivateCapabilities.set(input.privateCapability, state);
  return Object.freeze({ ok: true as const, authority, description });
}

/** Returns only a value-free description for the exact issued identities. */
export function describeOpenSwanDesktopAttachmentAuthority(
  sources: OpenSwanAttachmentTurnSources,
  authority: OpenSwanDesktopAttachmentAuthority,
): OpenSwanDesktopAttachmentAuthorityDescription | null {
  if (!isObjectIdentity(sources) || !isObjectIdentity(authority)) return null;
  const state = sourceAuthorities.get(sources);
  if (!state || state.authority !== authority || issuedAuthorities.get(authority) !== state) return null;
  if (!sourceBindingStillExact(state)) return null;
  return state.description;
}

/**
 * Canonical turn-runtime lookup. The exact sources object is itself the
 * process-private identity, so no redundant token needs to enter turn options,
 * provider input, message metadata, or persisted run state.
 */
export function describeOpenSwanDesktopAttachmentAuthorityForSources(
  sources: OpenSwanAttachmentTurnSources,
): OpenSwanDesktopAttachmentAuthorityDescription | null {
  if (!isObjectIdentity(sources)) return null;
  const state = sourceAuthorities.get(sources);
  if (!state || !sourceBindingStillExact(state)) return null;
  return state.description;
}

/** Source-keyed counterpart to the explicit-token resolver. */
export function resolveOpenSwanDesktopAttachmentAuthorityForSources(
  input: ResolveOpenSwanDesktopAttachmentAuthorityForSourcesInput,
): OpenSwanDesktopAttachmentAuthorityResolveResult {
  if (!isObjectIdentity(input) || !isObjectIdentity(input.sources)) {
    return resolveFailure('invalid_input');
  }
  const state = sourceAuthorities.get(input.sources);
  if (!state) return resolveFailure('source_identity_mismatch');
  if (!sourceBindingStillExact(state)) return resolveFailure('binding_drift');
  const expected = normalizeExpected(input.expected);
  if (!expected || !sameExpected(state.expected, expected)) return resolveFailure('scope_mismatch');
  if (boundPrivateCapabilities.get(state.privateCapability) !== state) return resolveFailure('binding_drift');
  return Object.freeze({
    ok: true as const,
    privateCapability: state.privateCapability,
    description: state.description,
  });
}

/**
 * Resolves the exact private object only when both ephemeral object identities
 * and every persisted/runtime scope field still match. The result is not
 * action evidence and says nothing about desktop completion.
 */
export function resolveOpenSwanDesktopAttachmentAuthority(
  input: ResolveOpenSwanDesktopAttachmentAuthorityInput,
): OpenSwanDesktopAttachmentAuthorityResolveResult {
  if (!isObjectIdentity(input) || !isObjectIdentity(input.sources) || !isObjectIdentity(input.authority)) {
    return resolveFailure('invalid_input');
  }
  const state = sourceAuthorities.get(input.sources);
  if (!state) return resolveFailure('source_identity_mismatch');
  if (state.authority !== input.authority || issuedAuthorities.get(input.authority) !== state) {
    return resolveFailure('authority_identity_mismatch');
  }
  if (!sourceBindingStillExact(state)) return resolveFailure('binding_drift');
  const expected = normalizeExpected(input.expected);
  if (!expected || !sameExpected(state.expected, expected)) return resolveFailure('scope_mismatch');
  if (boundPrivateCapabilities.get(state.privateCapability) !== state) return resolveFailure('binding_drift');
  return Object.freeze({
    ok: true as const,
    privateCapability: state.privateCapability,
    description: state.description,
  });
}

function validClockNow(value: number | undefined): number | null {
  const nowMs = value === undefined ? Date.now() : value;
  return Number.isSafeInteger(nowMs) && nowMs >= 0 ? nowMs : null;
}

function validLeaseTtl(value: number | undefined): number | null {
  const ttlMs = value === undefined
    ? OPEN_SWAN_DESKTOP_ATTACHMENT_APPROVAL_RESUME_LIMITS.defaultTtlMs
    : value;
  return Number.isSafeInteger(ttlMs)
    && ttlMs > 0
    && ttlMs <= OPEN_SWAN_DESKTOP_ATTACHMENT_APPROVAL_RESUME_LIMITS.maxTtlMs
    ? ttlMs
    : null;
}

function validOriginalUserTask(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= OPEN_SWAN_DESKTOP_ATTACHMENT_APPROVAL_RESUME_LIMITS.maxOriginalUserTaskChars
    && value.trim().length > 0;
}

export function isOpenSwanDesktopAttachmentExistingLeaseCustodyReceipt(
  value: unknown,
): value is OpenSwanDesktopAttachmentExistingLeaseCustodyReceipt {
  return isObjectIdentity(value) && existingLeaseCustodyReceipts.has(value);
}

export function resolveOpenSwanDesktopAttachmentExistingLeaseCustody(
  input: ResolveOpenSwanDesktopAttachmentExistingLeaseCustodyInput,
): Readonly<{ ok: true }> | Readonly<{ ok: false }> {
  if (
    !isObjectIdentity(input)
    || !isObjectIdentity(input.receipt)
    || !isObjectIdentity(input.sources)
  ) return Object.freeze({ ok: false as const });
  const receiptState = existingLeaseCustodyReceipts.get(input.receipt);
  const sourceState = sourceAuthorities.get(input.sources);
  const expected = normalizeExpected(input.expected);
  if (
    !receiptState
    || !sourceState
    || receiptState.sources !== sourceState.sources
    || receiptState.authority !== sourceState.authority
    || receiptState.privateCapability !== sourceState.privateCapability
    || !expected
    || !sameExpected(receiptState.expected, expected)
    || !sameExpected(sourceState.expected, expected)
    || !sourceBindingStillExact(sourceState)
    || boundPrivateCapabilities.get(sourceState.privateCapability) !== sourceState
  ) return Object.freeze({ ok: false as const });
  return Object.freeze({ ok: true as const });
}

export function hasOpenSwanDesktopAttachmentApprovalLeaseCustodyForSources(input: Readonly<{
  sources: OpenSwanAttachmentTurnSources;
  expected: OpenSwanDesktopAttachmentAuthorityExpected;
}>, clock: Readonly<{ nowMs?: number }> = {}): boolean {
  if (!isObjectIdentity(input) || !isObjectIdentity(input.sources)) return false;
  const state = sourceAuthorities.get(input.sources);
  const expected = normalizeExpected(input.expected);
  if (
    !state
    || !expected
    || !sameExpected(state.expected, expected)
    || !sourceBindingStillExact(state)
    || boundPrivateCapabilities.get(state.privateCapability) !== state
  ) {
    return false;
  }
  const nowMs = validClockNow(clock.nowMs);
  if (nowMs === null) return false;
  return hasLiveApprovalResumeLeaseForState(state, nowMs);
}

/**
 * Exact process-private custody query for a capability that has already been
 * resolved from the same source authority. This exists for terminal cleanup:
 * an invalid provider retry must not revoke a capability retained by an
 * earlier pending approval, while an unleased capability still fails closed.
 */
export function hasOpenSwanDesktopAttachmentApprovalLeaseCustodyForCapability(input: Readonly<{
  sources: OpenSwanAttachmentTurnSources;
  expected: OpenSwanDesktopAttachmentAuthorityExpected;
  privateCapability: unknown;
}>, clock: Readonly<{ nowMs?: number }> = {}): boolean {
  if (
    !isObjectIdentity(input)
    || !isObjectIdentity(input.sources)
    || !isObjectIdentity(input.privateCapability)
  ) return false;
  const state = sourceAuthorities.get(input.sources);
  const expected = normalizeExpected(input.expected);
  if (
    !state
    || !expected
    || !sameExpected(state.expected, expected)
    || state.privateCapability !== input.privateCapability
    || !sourceBindingStillExact(state)
    || boundPrivateCapabilities.get(input.privateCapability) !== state
  ) return false;
  const nowMs = validClockNow(clock.nowMs);
  if (nowMs === null) return false;
  return hasLiveApprovalResumeLeaseForState(state, nowMs);
}

function hasLiveApprovalResumeLeaseForState(state: AuthorityState, nowMs: number): boolean {
  sweepExpiredApprovalResumeLeases(nowMs);
  for (const lease of pendingApprovalResumeLeases.values()) {
    if (
      lease.sources === state.sources
      && lease.authority === state.authority
      && lease.privateCapability === state.privateCapability
      && sameExpected(lease.expected, state.expected)
    ) return true;
  }
  return false;
}

function sweepExpiredApprovalResumeLeases(nowMs: number): void {
  for (const [approvalId, state] of pendingApprovalResumeLeases) {
    if (nowMs >= state.expiresAtMs) pendingApprovalResumeLeases.delete(approvalId);
  }
}

/**
 * Registers a process-private continuation only for an already issued exact
 * desktop-open authority and an exact pending approval. Nothing here is a
 * bearer token or a serializable source projection.
 */
export function registerOpenSwanDesktopAttachmentApprovalResumeLease(
  input: RegisterOpenSwanDesktopAttachmentApprovalResumeLeaseInput,
  clock: OpenSwanDesktopAttachmentApprovalLeaseClock = {},
): RegisterOpenSwanDesktopAttachmentApprovalResumeLeaseResult {
  if (
    !isObjectIdentity(input)
    || !isObjectIdentity(input.sources)
    || !isObjectIdentity(input.pendingApproval)
    || !isObjectIdentity(input.ledgerReference)
    || !isUuid(input.userId)
    || !validOriginalUserTask(input.originalUserTaskText)
    || input.pendingApproval.status !== 'pending_approval'
    || input.pendingApproval.toolName !== 'desktop.open_attachment'
    || !isUuid(input.pendingApproval.approvalId)
    || !isUuid(input.pendingApproval.sourceRunId)
  ) return Object.freeze({ ok: false as const, code: 'invalid_input' as const });
  const nowMs = validClockNow(clock.nowMs);
  const ttlMs = validLeaseTtl(clock.ttlMs);
  if (nowMs === null || ttlMs === null || !Number.isSafeInteger(nowMs + ttlMs)) {
    return Object.freeze({ ok: false as const, code: 'invalid_input' as const });
  }
  const state = sourceAuthorities.get(input.sources);
  if (
    !state
    || (input.authority !== undefined && state.authority !== input.authority)
    || !sameExpected(state.expected, input.expected)
  ) return Object.freeze({ ok: false as const, code: 'authority_mismatch' as const });
  const resolved = resolveOpenSwanDesktopAttachmentAuthorityForSources({
    sources: input.sources,
    expected: input.expected,
  });
  if (!resolved.ok || resolved.privateCapability !== state.privateCapability) {
    return Object.freeze({ ok: false as const, code: 'authority_mismatch' as const });
  }

  sweepExpiredApprovalResumeLeases(nowMs);
  const existingLease = pendingApprovalResumeLeases.get(input.pendingApproval.approvalId);
  if (existingLease) {
    // A provider may repeat the exact pending tool call before Chat settles
    // the turn. Treat only the same process-private lease identity as an
    // idempotent retain. A copied/mismatched caller cannot adopt, replace,
    // extend, or learn anything about the original lease.
    if (
      existingLease.sources === input.sources
      && existingLease.authority === state.authority
      && existingLease.privateCapability === state.privateCapability
      && sameExpected(existingLease.expected, state.expected)
      && existingLease.sourceRunId === input.pendingApproval.sourceRunId
      && existingLease.userId === input.userId
      && existingLease.originalUserTaskText === input.originalUserTaskText
      && existingLease.ledgerReference === input.ledgerReference
    ) {
      return Object.freeze({ ok: true as const, expiresAtMs: existingLease.expiresAtMs });
    }
    if (
      existingLease.sources === state.sources
      && existingLease.authority === state.authority
      && existingLease.privateCapability === state.privateCapability
      && sameExpected(existingLease.expected, state.expected)
    ) {
      const existingLeaseCustody = Object.freeze({
        schemaVersion: 1 as const,
        kind: 'desktop_attachment_existing_approval_lease_custody' as const,
      });
      existingLeaseCustodyReceipts.set(existingLeaseCustody, existingLease);
      return Object.freeze({
        ok: false as const,
        code: 'duplicate_approval' as const,
        existingLeaseCustody,
      });
    }
    return Object.freeze({ ok: false as const, code: 'duplicate_approval' as const });
  }
  if (pendingApprovalResumeLeases.size >= OPEN_SWAN_DESKTOP_ATTACHMENT_APPROVAL_RESUME_LIMITS.maxEntries) {
    return Object.freeze({ ok: false as const, code: 'capacity_exceeded' as const });
  }
  const expiresAtMs = nowMs + ttlMs;
  const leaseState: ApprovalResumeLeaseState = Object.freeze({
    approvalId: input.pendingApproval.approvalId,
    sourceRunId: input.pendingApproval.sourceRunId,
    userId: input.userId,
    sources: input.sources,
    authority: state.authority,
    expected: state.expected,
    privateCapability: state.privateCapability,
    originalUserTaskText: input.originalUserTaskText,
    ledgerReference: input.ledgerReference,
    expiresAtMs,
  });
  pendingApprovalResumeLeases.set(leaseState.approvalId, leaseState);
  return Object.freeze({ ok: true as const, expiresAtMs });
}

/**
 * Claims and removes one lease synchronously. A successful claim is the only
 * operation that releases its exact in-memory sources/capability/task/ledger.
 */
export function claimOpenSwanDesktopAttachmentApprovalResumeLease(
  input: ClaimOpenSwanDesktopAttachmentApprovalResumeLeaseInput,
  clock: Readonly<{ nowMs?: number }> = {},
): ClaimOpenSwanDesktopAttachmentApprovalResumeLeaseResult {
  if (
    !isObjectIdentity(input)
    || !isUuid(input.approvalId)
    || !isUuid(input.sourceRunId)
    || !isUuid(input.userId)
    || !isUuid(input.circleId)
    || !isUuid(input.threadId)
    || (input.messageId !== undefined && !isUuid(input.messageId))
    || (input.sources !== undefined && !isObjectIdentity(input.sources))
    || (input.ledgerReference !== undefined && !isObjectIdentity(input.ledgerReference))
    || (input.originalUserTaskText !== undefined && !validOriginalUserTask(input.originalUserTaskText))
  ) return Object.freeze({ ok: false as const, code: 'invalid_input' as const });
  const nowMs = validClockNow(clock.nowMs);
  if (nowMs === null) return Object.freeze({ ok: false as const, code: 'invalid_input' as const });
  const state = pendingApprovalResumeLeases.get(input.approvalId);
  if (!state) return Object.freeze({ ok: false as const, code: 'lease_not_found' as const });
  if (nowMs >= state.expiresAtMs) {
    pendingApprovalResumeLeases.delete(input.approvalId);
    return Object.freeze({ ok: false as const, code: 'lease_expired' as const });
  }
  if (
    state.sourceRunId !== input.sourceRunId
    || state.userId !== input.userId
    || state.expected.circleId !== input.circleId
    || state.expected.threadId !== input.threadId
    || (input.messageId !== undefined && state.expected.messageId !== input.messageId)
  ) return Object.freeze({ ok: false as const, code: 'scope_mismatch' as const });
  if (input.sources !== undefined && state.sources !== input.sources) {
    return Object.freeze({ ok: false as const, code: 'source_identity_mismatch' as const });
  }
  if (input.authority !== undefined && state.authority !== input.authority) {
    return Object.freeze({ ok: false as const, code: 'authority_identity_mismatch' as const });
  }
  if (input.ledgerReference !== undefined && state.ledgerReference !== input.ledgerReference) {
    return Object.freeze({ ok: false as const, code: 'ledger_identity_mismatch' as const });
  }
  if (input.originalUserTaskText !== undefined && state.originalUserTaskText !== input.originalUserTaskText) {
    return Object.freeze({ ok: false as const, code: 'task_mismatch' as const });
  }
  const resolved = resolveOpenSwanDesktopAttachmentAuthorityForSources({
    sources: state.sources,
    expected: state.expected,
  });
  if (!resolved.ok || resolved.privateCapability !== state.privateCapability) {
    pendingApprovalResumeLeases.delete(input.approvalId);
    return Object.freeze({ ok: false as const, code: 'binding_drift' as const });
  }

  // Delete before releasing any private object so reentrant/double claims fail.
  pendingApprovalResumeLeases.delete(input.approvalId);
  return Object.freeze({
    ok: true as const,
    sources: state.sources,
    authority: state.authority,
    expected: state.expected,
    privateCapability: state.privateCapability,
    originalUserTaskText: state.originalUserTaskText,
    ledgerReference: state.ledgerReference,
  });
}

/** Exact-scope cancellation; a mismatched caller cannot revoke another lease. */
export function revokeOpenSwanDesktopAttachmentApprovalResumeLease(
  input: RevokeOpenSwanDesktopAttachmentApprovalResumeLeaseInput,
): RevokeOpenSwanDesktopAttachmentApprovalResumeLeaseResult {
  if (
    !isObjectIdentity(input)
    || !isUuid(input.approvalId)
    || !isUuid(input.sourceRunId)
    || !isUuid(input.userId)
    || !isUuid(input.circleId)
    || !isUuid(input.threadId)
  ) return Object.freeze({ ok: false as const, code: 'invalid_input' as const });
  const state = pendingApprovalResumeLeases.get(input.approvalId);
  if (!state) return Object.freeze({ ok: false as const, code: 'lease_not_found' as const });
  if (
    state.sourceRunId !== input.sourceRunId
    || state.userId !== input.userId
    || state.expected.circleId !== input.circleId
    || state.expected.threadId !== input.threadId
  ) return Object.freeze({ ok: false as const, code: 'scope_mismatch' as const });
  pendingApprovalResumeLeases.delete(input.approvalId);
  return Object.freeze({ ok: true as const });
}
